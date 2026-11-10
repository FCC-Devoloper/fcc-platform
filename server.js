try { require('dotenv').config(); } catch (e) {}
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
const { securityHeaders, rateLimit } = require('./middleware/security');
const adminRoutes = require('./routes/admin');
const { UPLOAD_DIR, ensureUploadDir } = require('./lib/storage');

db.initDB();

const app = express();
// Railway/other reverse proxies forward the real visitor IP in X-Forwarded-For.
// Trust only the first proxy hop so req.ip resolves to the visitor address.
app.set('trust proxy', 1);
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const clients = new Map();
const adminSockets = new Set();
let adminOnline = false;
let adminLastHeartbeat = 0;

app.use(securityHeaders);
// CORS: по умолчанию только свой сайт. Другие адреса — через CORS_ORIGINS=https://a.com,https://b.com в .env
const corsOrigins = String(process.env.CORS_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
if (corsOrigins.length) {
    app.use(cors({ origin: corsOrigins, credentials: true }));
}
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));


// ===== FCC Learning Center — geo gate (isolated module) =====
const learningGeoCache = new Map();
const LEARNING_GEO_TTL_MS = 30 * 60 * 1000;

function getVisitorIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '');
    const firstForwarded = forwarded.split(',')[0].trim();
    const ip = firstForwarded || String(req.ip || req.socket?.remoteAddress || '').trim();
    return ip.replace(/^::ffff:/i, '');
}

function normalizePlace(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zа-яё0-9]+/gi, ' ')
        .trim();
}

function isLearningCity(city) {
    const c = normalizePlace(city);
    if (!c) return false;
    const aliases = [
        'hisor', 'gissar', 'hissar', 'hisor city', 'gissar city',
        'dushanbe', 'dushанбе'
    ];
    return aliases.some(alias => c === alias || c.startsWith(alias + ' '));
}

function isPrivateOrLocalIp(ip) {
    const v = String(ip || '').toLowerCase();
    if (!v || v === '::1' || v === 'localhost') return true;
    if (/^127\./.test(v) || /^10\./.test(v) || /^192\.168\./.test(v)) return true;
    const m = v.match(/^172\.(\d+)\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
    if (v.includes(':') && (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb'))) return true;
    return false;
}

async function resolveLearningLocation(req) {
    const ip = getVisitorIp(req);
    const cached = learningGeoCache.get(ip);
    if (cached && cached.expires > Date.now()) return cached.data;

    if (isPrivateOrLocalIp(ip)) {
        const data = { allowed: false, city: '', country: '', source: 'local' };
        learningGeoCache.set(ip, { expires: Date.now() + 5 * 60 * 1000, data });
        return data;
    }

    try {
        const url = `https://ipapi.co/${encodeURIComponent(ip)}/json/`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'FCC-Learning-Center/1.0' }
        });
        clearTimeout(timer);
        if (!response.ok) throw new Error('Geo provider HTTP ' + response.status);
        const geo = await response.json();
        const city = String(geo.city || '').trim();
        const country = String(geo.country_code || geo.country || '').trim();
        const data = {
            allowed: (country === 'TJ' || country === 'Tajikistan') && isLearningCity(city),
            city,
            country,
            latitude: Number.isFinite(Number(geo.latitude)) ? Number(geo.latitude) : null,
            longitude: Number.isFinite(Number(geo.longitude)) ? Number(geo.longitude) : null,
            source: 'ipapi'
        };
        learningGeoCache.set(ip, { expires: Date.now() + LEARNING_GEO_TTL_MS, data });
        return data;
    } catch (e) {
        console.warn('[Learning Center] geo lookup failed:', e.message);
        const data = { allowed: false, city: '', country: '', source: 'error' };
        learningGeoCache.set(ip, { expires: Date.now() + 2 * 60 * 1000, data });
        return data;
    }
}

function learningCenterUnavailable(res) {
    return res.status(404).send(`<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FCC Learning Center</title><link rel="stylesheet" href="/css/main.css"></head><body><main style="max-width:760px;margin:12vh auto;padding:32px;text-align:center"><div class="card"><h1>FCC Learning Center</h1><p class="muted">Раздел доступен только посетителям из Гиссара и Душанбе.</p><a class="btn-primary" href="/">Вернуться на FCC</a></div></main></body></html>`);
}
// Server-gate admin page: require valid admin JWT via Authorization or cookie
function extractBearerOrCookie(req) {
    const h = req.headers['authorization'] || req.headers['Authorization'];
    if (h && String(h).startsWith('Bearer ')) return String(h).slice(7);
    const raw = req.headers.cookie || '';
    const m = String(raw).match(/(?:^|;\s*)fcc_admin_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
}

function gateAdminPage(req, res, next) {
    const token = extractBearerOrCookie(req);
    // Allow login page assets; HTML itself is gated
    if (!token) {
        return res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
    }
    try {
        const payload = require('jsonwebtoken').verify(token, require('./middleware/auth').JWT_SECRET);
        if (payload && payload.role === 'admin') return next();
    } catch (e) {}
    return res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
}

app.get('/team-portal.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'team-portal.html'));
});
app.get('/dev.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dev.html'));
});

app.get(['/admin.html', '/admin'], gateAdminPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin-partials/*', (req, res, next) => {
    // partials only useful inside admin; still require token
    const token = extractBearerOrCookie(req);
    if (!token) return res.status(401).send('Unauthorized');
    try {
        const payload = require('jsonwebtoken').verify(token, require('./middleware/auth').JWT_SECRET);
        if (payload && payload.role === 'admin') return next();
    } catch (e) {}
    return res.status(401).send('Unauthorized');
});

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

app.set('resolveLearningLocation', resolveLearningLocation);
app.set('broadcastToAdmins', broadcastToAdmins);
app.set('sendToClient', sendToClient);
app.set('getClientList', getClientList);
app.set('notifyClientOrderStatus', notifyClientOrderStatus);
app.set('rebindIdentitySockets', rebindIdentitySockets);
app.set('pushNotification', pushNotification);

app.get('/api/learning-center/access', async (req, res) => {
    const geo = await resolveLearningLocation(req);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, allowed: !!geo.allowed, city: geo.city || '', country: geo.country || '', source: geo.source || '' });
});

app.get('/learning-center', async (req, res) => {
    const geo = await resolveLearningLocation(req);
    if (!geo.allowed) return learningCenterUnavailable(res);
    return res.sendFile(path.join(__dirname, 'public', 'learning-center.html'));
});

function byNewest(a, b) {
    return String(b.published_at || b.created_at || '').localeCompare(String(a.published_at || a.created_at || ''));
}

// Список проектов: только опубликованные, без исходного кода демо (код отдаётся по id)
app.get('/api/projects', (req, res) => {
    const projects = (db.getData().projects || [])
        .filter(p => p.is_published !== 0)
        .sort((a, b) => (b.is_featured || 0) - (a.is_featured || 0) || (b.sort || 0) - (a.sort || 0) || byNewest(a, b))
        .map(p => {
            const { html_code, python_code, ...rest } = p;
            return { ...rest, has_demo: !!(html_code || python_code) };
        });
    res.json({ success: true, projects });
});

app.get('/api/projects/:id', (req, res) => {
    const project = (db.getData().projects || []).find(p => String(p.id) === String(req.params.id));
    if (!project || project.is_published === 0) {
        return res.status(404).json({ success: false, error: 'Проект не найден' });
    }
    res.json({ success: true, project });
});

app.get('/api/news', (req, res) => {
    let news = (db.getData().news || [])
        .filter(n => n.is_published !== 0)
        .filter(n => !n.published_at || new Date(n.published_at).getTime() <= Date.now())
        .sort((a, b) => (b.pinned || 0) - (a.pinned || 0) || byNewest(a, b));
    const limit = Number(req.query.limit);
    if (Number.isFinite(limit) && limit > 0) news = news.slice(0, Math.min(limit, 100));
    res.json({ success: true, news });
});

app.get('/api/news/:id', (req, res) => {
    const item = (db.getData().news || []).find(n => String(n.id) === String(req.params.id));
    if (!item || item.is_published === 0) return res.status(404).json({ success: false, error: 'Новость не найдена' });
    res.json({ success: true, news: item });
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

app.post('/api/projects/:id/react', rateLimit({ windowMs: 60 * 1000, max: 30, message: 'Слишком часто. Попробуйте через минуту.' }), async (req, res) => {
    const emotion = String((req.body && req.body.emotion) || '').toLowerCase();
    const allowed = ['like', 'fire', 'heart', 'wow'];
    if (!allowed.includes(emotion)) return res.status(400).json({ error: 'Неизвестная реакция' });
    const store = db.getData();
    const project = (store.projects || []).find(p => String(p.id) === String(req.params.id));
    if (!project || project.is_published === 0) return res.status(404).json({ error: 'Проект не найден' });
    if (!project.reactions) project.reactions = { like: 0, fire: 0, heart: 0, wow: 0 };
    project.reactions[emotion] = (project.reactions[emotion] || 0) + 1;
    await db.saveDB();
    res.json({ success: true, reactions: project.reactions });
});

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }), require('./routes/auth'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/learning-center', require('./routes/learning-center').router);
app.use('/api/chat', require('./routes/chat'));
app.use('/api/admin', authenticateToken, requireAdmin, adminRoutes);
app.use('/api/dev', require('./routes/dev'));

app.get('/api/public-config', (req, res) => {
    res.json({
        success: true,
        googleClientId: process.env.GOOGLE_CLIENT_ID || '',
        inviteHint: true
    });
});

// Интро показываем не чаще раза в 8 часов (для вошедших — по аккаунту, для гостей — по браузеру)
const INTRO_COOLDOWN_MS = 8 * 60 * 60 * 1000;

app.get('/api/intro/status', optionalAuth, (req, res) => {
    const store = db.getData();
    if (req.user && req.user.id) {
        const user = (store.users || []).find(u => String(u.id) === String(req.user.id));
        const last = Number(user && user.intro_seen_at) || 0;
        return res.json({ success: true, show: Date.now() - last >= INTRO_COOLDOWN_MS });
    }
    res.json({ success: true, show: true, guest: true });
});

app.post('/api/intro/seen', optionalAuth, async (req, res) => {
    const store = db.getData();
    if (req.user && req.user.id) {
        const user = (store.users || []).find(u => String(u.id) === String(req.user.id));
        if (user) {
            user.intro_seen_at = Date.now();
            await db.saveDB();
        }
    }
    res.json({ success: true });
});

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

// Static AFTER all /api/* routes
app.use(express.static(path.join(__dirname, 'public')));
ensureUploadDir();
app.use('/uploads', express.static(UPLOAD_DIR));

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

                    const history = identity.messagesFor(store, ident.id || clientId);
                    // Always prefer server canonical identity (user.id after login)
                    const publicClientId = ident.kind === 'user' && ident.user
                        ? ident.user.id
                        : (ident.guest ? ident.guest.client_id : (ident.id || requestedId));
                    ws.send(JSON.stringify({
                        type: 'init_ok',
                        clientId: publicClientId,
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
