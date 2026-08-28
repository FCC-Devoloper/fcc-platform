const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { getBotReply } = require('./routes/bot');
const { authenticateToken, requireAdmin, optionalAuth, verifyWsToken } = require('./middleware/auth');
const identity = require('./lib/identity');
const adminRoutes = require('./routes/admin');

db.initDB();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const clients = new Map();
const adminSockets = new Set();
let adminOnline = false;
let adminLastHeartbeat = 0;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.set('db', db);
app.set('clients', clients);
app.set('adminSockets', adminSockets);

app.get('/cabinet', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cabinet.html'));
});

function broadcastToAdmins(data) {
    const msg = JSON.stringify(data);
    adminSockets.forEach(ws => {
        if (ws.readyState === 1) ws.send(msg);
    });
}

function sendToClient(clientId, data) {
    const store = db.getData();
    const ident = identity.resolveIdentity(store, clientId);
    if (ident.keys.size) {
        identity.sendToIdentity(clients, ident, data);
        return;
    }
    const sockets = clients.get(clientId);
    if (!sockets) return;
    const msg = JSON.stringify(data);
    sockets.forEach(ws => {
        if (ws.readyState === 1) ws.send(msg);
    });
}

function getClientList() {
    return identity.buildClientList(db.getData(), clients);
}

function rebindIdentitySockets(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const fromSet = clients.get(fromId);
    if (!fromSet || !fromSet.size) return;
    if (!clients.has(toId)) clients.set(toId, new Set());
    fromSet.forEach(ws => {
        clients.get(toId).add(ws);
        if (ws._fccIdent) {
            ws._fccIdent = identity.resolveIdentity(db.getData(), toId);
        }
    });
}

function isNotificationExpired(n, now = Date.now()) {
    if (!n || !n.expires_at) return false;
    const t = new Date(n.expires_at).getTime();
    return Number.isFinite(t) && t < now;
}

function notificationVisibleTo(n, ident, isOnlineNow) {
    if (!n) return false;
    if (isNotificationExpired(n)) return false;
    const target = n.target_type || n.target || 'all';
    if (target === 'all') return true;
    if (target === 'online') return !!isOnlineNow;
    const targetId = n.target_id || n.targetClientId;
    if (!targetId) return false;
    return ident.keys.has(String(targetId));
}

function pushNotification(notification) {
    const payload = { type: 'new_notification', notification };
    const store = db.getData();
    const target = notification.target_type || notification.target || 'all';

    if (target === 'all' || target === 'online') {
        const sent = new Set();
        clients.forEach((sockets, cid) => {
            sockets.forEach(ws => {
                if (sent.has(ws) || ws.readyState !== 1) return;
                sent.add(ws);
                ws.send(JSON.stringify(payload));
            });
        });
    } else if (notification.target_id || notification.targetClientId) {
        sendToClient(notification.target_id || notification.targetClientId, payload);
    }

    broadcastToAdmins({ type: 'notifications_update' });
}

function notifyClientOrderStatus(order) {
    if (!order) return;
    const ident = identity.resolveIdentity(db.getData(), order.user_id || order.client_id);
    const payload = { type: 'order_status', order };
    identity.sendToIdentity(clients, ident, payload);

    const store = db.getData();
    const labels = {
        new: 'принята',
        in_progress: 'взята в работу',
        waiting_client: 'ожидает вашего ответа',
        done: 'выполнена',
        rejected: 'отклонена',
        cancelled: 'отменена'
    };
    const n = {
        id: uuidv4(),
        title: 'Заявка «' + (order.title || order.id) + '»',
        tag: 'Система',
        type: 'order',
        date: new Date().toLocaleDateString('ru-RU'),
        text: 'Статус заявки: ' + (labels[order.status] || order.status) +
            (order.rejection_reason ? '. Причина: ' + order.rejection_reason : '') +
            (order.result_url ? '. Результат: ' + order.result_url : ''),
        created_at: new Date().toISOString(),
        target: 'specific',
        target_type: 'user',
        target_id: ident.id,
        targetClientId: ident.id,
        expires_at: null,
        readBy: []
    };
    store.notifications.push(n);
    db.saveDB();
    identity.sendToIdentity(clients, ident, { type: 'new_notification', notification: n });
}

app.set('broadcastToAdmins', broadcastToAdmins);
app.set('sendToClient', sendToClient);
app.set('getClientList', getClientList);
app.set('notifyClientOrderStatus', notifyClientOrderStatus);
app.set('rebindIdentitySockets', rebindIdentitySockets);
app.set('pushNotification', pushNotification);

app.get('/api/projects', (req, res) => {
    res.json({ success: true, projects: db.getData().projects || [] });
});

app.get('/api/projects/:id', (req, res) => {
    const project = (db.getData().projects || []).find(p => String(p.id) === String(req.params.id));
    if (!project || project.is_published === 0) {
        return res.status(404).json({ success: false, error: 'Проект не найден' });
    }
    res.json({ success: true, project });
});

app.get('/api/news', (req, res) => {
    const news = (db.getData().news || []).filter(n => n.is_published !== 0);
    res.json({ success: true, news });
});

app.get('/api/promotions', (req, res) => {
    const now = new Date();
    const promotions = (db.getData().promotions || []).filter(p => adminRoutes.isPromoLive(p, now));
    res.json({ success: true, promotions });
});

app.get('/api/content', (req, res) => {
    res.json({ success: true, content: db.getData().site_texts || {} });
});

app.get('/api/team', (req, res) => {
    res.json({ success: true, team: db.getData().team || [] });
});

app.get('/api/plans', (req, res) => {
    res.json({ success: true, plans: db.getData().plans || [] });
});

app.post('/api/projects/:id/react', async (req, res) => {
    const emotion = String(req.body.emotion || '').toLowerCase();
    const allowed = ['like', 'fire', 'heart', 'wow'];
    if (!allowed.includes(emotion)) return res.status(400).json({ error: 'Неизвестная реакция' });
    const store = db.getData();
    const project = (store.projects || []).find(p => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    if (!project.reactions) project.reactions = { like: 0, fire: 0, heart: 0, wow: 0 };
    project.reactions[emotion] = (project.reactions[emotion] || 0) + 1;
    await db.saveDB();
    res.json({ success: true, reactions: project.reactions });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/admin', authenticateToken, requireAdmin, adminRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', adminOnline, time: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
    res.json({ online: adminOnline });
});

app.get('/api/notifications', optionalAuth, (req, res) => {
    const store = db.getData();
    const lookupId = (req.user && req.user.id) || req.query.clientId || null;
    const ident = identity.resolveIdentity(store, lookupId);
    const isOnlineNow = identity.isSocketOnline(clients, ident);
    let list = (store.notifications || []).filter(n => notificationVisibleTo(n, ident, isOnlineNow));
    list = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ success: true, notifications: list });
});

app.post('/api/notifications/read', optionalAuth, async (req, res) => {
    const { notificationId, clientId } = req.body;
    if (!notificationId) return res.status(400).json({ error: 'нужны id' });

    const store = db.getData();
    const n = (store.notifications || []).find(x => x.id === notificationId);
    if (!n) return res.status(404).json({ error: 'не найдено' });

    const reader = (req.user && req.user.id) || clientId;
    if (!reader) return res.status(400).json({ error: 'нужны id' });
    if (!Array.isArray(n.readBy)) n.readBy = [];
    if (!n.readBy.includes(reader)) {
        n.readBy.push(reader);
        const ident = identity.resolveIdentity(store, reader);
        ident.keys.forEach(k => {
            if (!n.readBy.includes(k)) n.readBy.push(k);
        });
        await db.saveDB();
    }

    res.json({ success: true });
});

wss.on('connection', (ws) => {
    let clientId = null;
    let isAdmin = false;
    ws._fccIdent = null;

    ws.on('message', async (raw) => {
        try {
            const data = JSON.parse(raw.toString());
            const store = db.getData();

            if (data.type === 'init' || data.type === 'register') {
                if (data.role === 'admin') {
                    const payload = verifyWsToken(data.token);
                    if (!payload || payload.role !== 'admin') {
                        ws.send(JSON.stringify({ type: 'error', error: 'admin_auth_required' }));
                        ws.close();
                        return;
                    }
                    isAdmin = true;
                    adminSockets.add(ws);
                    adminOnline = true;
                    adminLastHeartbeat = Date.now();
                    ws.send(JSON.stringify({ type: 'admin_connected' }));
                    broadcastToAdmins({ type: 'clients_update', clients: getClientList() });
                    clients.forEach((_, cid) => {
                        sendToClient(cid, { type: 'status', online: true });
                        sendToClient(cid, { type: 'status_update', online: true });
                    });
                } else {
                    const tokenUser = verifyWsToken(data.token);
                    const requestedId = data.clientId || (tokenUser && tokenUser.id) || ('guest_' + uuidv4().slice(0, 6).toUpperCase());
                    let ident = identity.resolveIdentity(store, requestedId);

                    if (tokenUser && tokenUser.role === 'client') {
                        ident = identity.resolveIdentity(store, tokenUser.id);
                        if (data.clientId && data.clientId !== tokenUser.id) {
                            identity.mergeGuestIntoUser(store, data.clientId, tokenUser.id, tokenUser.username);
                            ident = identity.resolveIdentity(store, tokenUser.id);
                            await db.saveDB();
                        }
                    } else if (ident.kind === 'user') {
                        // guest id already linked — do not recreate a guest row
                    } else {
                        let guest = store.guests.find(g => g.client_id === requestedId);
                        if (!guest) {
                            guest = {
                                client_id: requestedId,
                                name: data.name || null,
                                is_online: 1,
                                last_seen: new Date().toISOString()
                            };
                            store.guests.push(guest);
                        } else {
                            guest.is_online = 1;
                            guest.last_seen = new Date().toISOString();
                            if (data.name) guest.name = data.name;
                        }
                        await db.saveDB();
                        ident = identity.resolveIdentity(store, requestedId);
                    }

                    clientId = ident.id;
                    ws._fccIdent = ident;
                    identity.bindSocket(clients, ident, ws);

                    const history = identity.messagesFor(store, clientId);
                    ws.send(JSON.stringify({
                        type: 'init_ok',
                        clientId: ident.kind === 'guest' ? (ident.guest ? ident.guest.client_id : requestedId) : requestedId,
                        canonicalId: ident.id,
                        userId: ident.user ? ident.user.id : null,
                        history,
                        online: adminOnline
                    }));
                    ws.send(JSON.stringify({ type: 'status', online: adminOnline }));
                    broadcastToAdmins({ type: 'clients_update', clients: getClientList() });
                }
                return;
            }

            if (data.type === 'heartbeat' && isAdmin) {
                adminLastHeartbeat = Date.now();
                adminOnline = true;
                return;
            }

            if (data.type === 'message' && !isAdmin) {
                if (!clientId) {
                    clientId = data.clientId || ('guest_' + uuidv4().slice(0, 6).toUpperCase());
                    ws._fccIdent = identity.resolveIdentity(store, clientId);
                    identity.bindSocket(clients, ws._fccIdent, ws);
                }

                const content = String(data.content || data.text || '').trim();
                if (!content) return;

                const ident = ws._fccIdent || identity.resolveIdentity(store, clientId);
                const msgObj = identity.stampRecord({
                    id: uuidv4(),
                    client_id: ident.kind === 'user' ? (data.clientId || ident.id) : clientId,
                    sender: 'client',
                    content,
                    is_read: 0,
                    created_at: new Date().toISOString()
                }, ident);

                store.messages.push(msgObj);
                await db.saveDB();

                identity.sendToIdentity(clients, ident, { type: 'new_message', message: msgObj });
                broadcastToAdmins({ type: 'new_message', message: msgObj });
                broadcastToAdmins({ type: 'clients_update', clients: getClientList() });

                if (!adminOnline) {
                    const botText = getBotReply(content);
                    const botMsg = identity.stampRecord({
                        id: uuidv4(),
                        client_id: msgObj.client_id,
                        sender: 'bot',
                        content: botText,
                        is_read: 1,
                        created_at: new Date().toISOString()
                    }, ident);
                    store.messages.push(botMsg);
                    await db.saveDB();
                    identity.sendToIdentity(clients, ident, { type: 'new_message', message: botMsg });
                    broadcastToAdmins({ type: 'new_message', message: botMsg });
                }
                return;
            }

            if (data.type === 'admin_message' && isAdmin) {
                const targetId = data.clientId;
                const content = String(data.content || data.text || '').trim();
                if (!targetId || !content) return;

                const ident = identity.resolveIdentity(store, targetId);
                const msgObj = identity.stampRecord({
                    id: uuidv4(),
                    client_id: ident.kind === 'user' ? ident.id : targetId,
                    sender: 'admin',
                    content,
                    is_read: 1,
                    created_at: new Date().toISOString()
                }, ident);

                store.messages.push(msgObj);
                await db.saveDB();

                identity.sendToIdentity(clients, ident, { type: 'new_message', message: msgObj });
                broadcastToAdmins({ type: 'new_message', message: msgObj });
                broadcastToAdmins({ type: 'clients_update', clients: getClientList() });
            }

            if (data.type === 'mark_read' && isAdmin) {
                identity.markRead(store, data.clientId);
                await db.saveDB();
                broadcastToAdmins({ type: 'clients_update', clients: getClientList() });
            }

        } catch (err) {
            console.error('WS Error:', err);
        }
    });

    ws.on('close', async () => {
        if (isAdmin) {
            adminSockets.delete(ws);
            if (adminSockets.size === 0) {
                setTimeout(() => {
                    if (adminSockets.size === 0) {
                        adminOnline = false;
                        const seen = new Set();
                        getClientList().forEach(c => {
                            if (seen.has(c.id)) return;
                            seen.add(c.id);
                            sendToClient(c.id, { type: 'status', online: false });
                            sendToClient(c.id, { type: 'status_update', online: false });
                        });
                    }
                }, 5000);
            }
        }
        if (clientId) {
            const ident = ws._fccIdent || identity.resolveIdentity(db.getData(), clientId);
            const emptied = identity.unbindSocket(clients, ident, ws);
            if (emptied.length && !identity.isSocketOnline(clients, ident)) {
                const store = db.getData();
                if (ident.kind === 'user' && ident.user) {
                    ident.user.last_seen = new Date().toISOString();
                    await db.saveDB();
                } else {
                    const guest = store.guests.find(g => g.client_id === clientId);
                    if (guest) {
                        guest.is_online = 0;
                        guest.last_seen = new Date().toISOString();
                        await db.saveDB();
                    }
                }
                broadcastToAdmins({ type: 'clients_update', clients: getClientList() });
            }
        }
    });
});

setInterval(() => {
    if (adminOnline && Date.now() - adminLastHeartbeat > 20000) {
        adminOnline = false;
        const seen = new Set();
        getClientList().forEach(c => {
            if (seen.has(c.id)) return;
            seen.add(c.id);
            sendToClient(c.id, { type: 'status', online: false });
            sendToClient(c.id, { type: 'status_update', online: false });
        });
    }
}, 5000);

server.listen(PORT, HOST, () => {
    console.log(`FCC Server: http://${HOST}:${PORT}`);
});
