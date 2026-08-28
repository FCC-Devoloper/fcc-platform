const express = require('express');
const router = express.Router();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { saveBase64Upload } = require('../lib/upload');
const { resolveIdentity } = require('../lib/identity');

const ORDER_STATUSES = ['new', 'in_progress', 'waiting_client', 'done', 'rejected', 'cancelled'];

function isPromoLive(p, now = new Date()) {
    if (!p || p.is_active === 0) return false;
    if (p.start_date) {
        const start = new Date(p.start_date);
        if (!Number.isNaN(start.getTime()) && now < start) return false;
    }
    if (p.end_date) {
        const end = new Date(p.end_date);
        if (!Number.isNaN(end.getTime())) {
            const endDay = new Date(end);
            if (String(p.end_date).length <= 10) endDay.setHours(23, 59, 59, 999);
            if (now > endDay) return false;
        }
    }
    return true;
}

router.get('/hub', (req, res) => {
    try {
        const getClientList = req.app.get('getClientList');
        const clients = getClientList ? getClientList() : [];
        const store = db.getData();
        const orders = (store.orders || []).filter(o => !o.deleted_at);
        const newOrders = orders.filter(o => o.status === 'new').length;
        const unreadMessages = (store.messages || []).filter(m => m.sender === 'client' && !m.is_read).length;

        res.json({
            success: true,
            onlineClients: clients.filter(c => c.is_online).length,
            newOrders,
            unreadMessages,
            clients
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/projects', (req, res) => {
    res.json({ success: true, projects: db.getData().projects || [] });
});

router.post('/projects', async (req, res) => {
    const store = db.getData();
    const { id, title_ru, description_ru, demo_url, technologies, features, image, runtime, html_code, python_code } = req.body;

    if (id) {
        const p = (store.projects || []).find(x => x.id === id);
        if (p) Object.assign(p, { title_ru, description_ru, demo_url, technologies, features, image, runtime: runtime || '', html_code: html_code || '', python_code: python_code || '' });
    } else {
        if (!store.projects) store.projects = [];
        store.projects.push({
            id: 'proj_' + uuidv4().slice(0, 8),
            title_ru: title_ru || '',
            description_ru: description_ru || '',
            demo_url: demo_url || '',
            technologies: technologies || '',
            features: features || '',
            image: image || '',
            runtime: runtime || '',
            html_code: html_code || '',
            python_code: python_code || '',
            is_published: 1,
            reactions: { like: 0, fire: 0, heart: 0, wow: 0 },
            created_at: new Date().toISOString()
        });
    }
    await db.saveDB();
    res.json({ success: true });
});

router.delete('/projects/:id', async (req, res) => {
    const store = db.getData();
    store.projects = (store.projects || []).filter(p => p.id !== req.params.id);
    await db.saveDB();
    res.json({ success: true });
});

router.get('/news', (req, res) => {
    res.json({ success: true, news: db.getData().news || [] });
});

router.post('/news', async (req, res) => {
    const store = db.getData();
    const { id, title_ru, content_ru, media_type, media_url, subtitle, media_align, media_scale, btn_text, btn_url } = req.body;

    if (id) {
        const n = (store.news || []).find(x => x.id === id);
        if (n) {
            Object.assign(n, {
                title_ru,
                content_ru,
                media_type,
                media_url,
                subtitle: subtitle || '',
                media_align: media_align || n.media_align || 'full',
                media_scale: media_scale || n.media_scale || '100',
                btn_text: btn_text || '',
                btn_url: btn_url || ''
            });
        } else {
            if (!store.news) store.news = [];
            store.news.push({
                id,
                title_ru: title_ru || '',
                content_ru: content_ru || '',
                subtitle: subtitle || '',
                media_type: media_type || 'image',
                media_url: media_url || '',
                media_align: media_align || 'full',
                media_scale: media_scale || '100',
                btn_text: btn_text || '',
                btn_url: btn_url || '',
                is_published: 1,
                reactions: { like: 0, fire: 0, heart: 0, wow: 0 },
                created_at: new Date().toISOString()
            });
        }
    } else {
        if (!store.news) store.news = [];
        store.news.push({
            id: 'news_' + uuidv4().slice(0, 8),
            title_ru: title_ru || '',
            content_ru: content_ru || '',
            subtitle: subtitle || '',
            media_type: media_type || 'image',
            media_url: media_url || '',
            media_align: media_align || 'full',
            media_scale: media_scale || '100',
            btn_text: btn_text || '',
            btn_url: btn_url || '',
            is_published: 1,
            reactions: { like: 0, fire: 0, heart: 0, wow: 0 },
            created_at: new Date().toISOString()
        });
    }
    await db.saveDB();
    res.json({ success: true });
});

router.delete('/news/:id', async (req, res) => {
    const store = db.getData();
    store.news = (store.news || []).filter(n => n.id !== req.params.id);
    await db.saveDB();
    res.json({ success: true });
});

router.get('/promotions', (req, res) => {
    res.json({ success: true, promotions: db.getData().promotions || [] });
});

router.post('/promotions', async (req, res) => {
    const store = db.getData();
    if (!store.promotions) store.promotions = [];
    const payload = req.body || {};
    const existing = payload.id ? store.promotions.find(p => String(p.id) === String(payload.id)) : null;
    const body = {
        title_ru: payload.title_ru || '',
        description_ru: payload.description_ru || '',
        discount: payload.discount || '',
        target: payload.target || 'Все услуги',
        action_link: payload.action_link || '',
        is_active: payload.is_active === undefined ? 1 : payload.is_active,
        start_date: payload.start_date || null,
        end_date: payload.end_date || null
    };
    if (existing) {
        Object.assign(existing, body);
    } else {
        store.promotions.push({
            id: payload.id || 'promo_' + uuidv4().slice(0, 8),
            ...body,
            created_at: new Date().toISOString()
        });
    }
    await db.saveDB();
    res.json({ success: true });
});

router.delete('/promotions/:id', async (req, res) => {
    const store = db.getData();
    store.promotions = (store.promotions || []).filter(p => String(p.id) !== String(req.params.id));
    await db.saveDB();
    res.json({ success: true });
});

router.get('/settings', (req, res) => {
    res.json({ success: true, settings: db.getData().site_texts || {} });
});

router.post('/settings', async (req, res) => {
    const { key, value_ru, value_en } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });
    db.setContent(key, value_ru !== undefined ? value_ru : (value_en || ''));
    await db.saveDB();
    res.json({ success: true });
});

router.put('/content', async (req, res) => {
    const { key, value, action, url, styles } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });
    db.setContent(key, value, { action, url, styles });
    await db.saveDB();
    const broadcast = req.app.get('broadcastToAdmins');
    if (broadcast) broadcast({ type: 'content_update', key });
    res.json({ success: true });
});

router.get('/orders', (req, res) => {
    const store = db.getData();
    const includeDeleted = req.query.all === '1';
    const orders = (store.orders || []).filter(o => includeDeleted || !o.deleted_at);
    orders.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    res.json({ success: true, orders });
});

router.patch('/orders/:id/status', async (req, res) => {
    const store = db.getData();
    const order = (store.orders || []).find(o => o.id === req.params.id);
    if (!order || order.deleted_at) return res.status(404).json({ error: 'not found' });

    const status = req.body.status || order.status;
    if (!ORDER_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Неизвестный статус' });
    }
    if (status === 'rejected' && !String(req.body.reason || req.body.rejection_reason || '').trim()) {
        return res.status(400).json({ error: 'Укажите причину отказа' });
    }

    const reason = String(req.body.reason || req.body.rejection_reason || '').trim() || null;
    const resultUrl = req.body.result_url || req.body.result_file || null;

    order.status = status;
    order.updated_at = new Date().toISOString();
    if (status === 'rejected') order.rejection_reason = reason;
    if (resultUrl) {
        order.result_url = resultUrl;
        order.result_file = resultUrl;
    }
    if (!Array.isArray(order.status_history)) order.status_history = [];
    order.status_history.push({
        status,
        at: order.updated_at,
        by: req.user ? req.user.username : 'admin',
        reason
    });

    await db.saveDB();

    const notify = req.app.get('notifyClientOrderStatus');
    if (notify) notify(order);

    const broadcast = req.app.get('broadcastToAdmins');
    if (broadcast) broadcast({ type: 'orders_update', order });

    res.json({ success: true, order });
});

router.delete('/orders/:id', async (req, res) => {
    const store = db.getData();
    const order = (store.orders || []).find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'not found' });
    order.deleted_at = new Date().toISOString();
    await db.saveDB();
    const broadcast = req.app.get('broadcastToAdmins');
    if (broadcast) broadcast({ type: 'orders_update' });
    res.json({ success: true });
});

router.get('/plans', (req, res) => {
    res.json({ success: true, plans: db.getData().plans || [] });
});

router.post('/plans', async (req, res) => {
    const store = db.getData();
    if (!store.plans) store.plans = [];
    store.plans.push({
        id: 'plan_' + uuidv4().slice(0, 8),
        title_ru: req.body.title_ru || '',
        description_ru: req.body.description_ru || '',
        status: req.body.status || 'now',
        eta: req.body.eta || '',
        created_at: new Date().toISOString()
    });
    await db.saveDB();
    res.json({ success: true });
});

router.delete('/plans/:id', async (req, res) => {
    const store = db.getData();
    store.plans = (store.plans || []).filter(p => p.id !== req.params.id);
    await db.saveDB();
    res.json({ success: true });
});

router.get('/users', (req, res) => {
    const store = db.getData();
    const users = (store.users || []).map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        name: u.name || u.username,
        last_seen: u.last_seen,
        linked_guest_ids: u.linked_guest_ids || []
    }));
    res.json({ success: true, users });
});

router.post('/users', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    const store = db.getData();
    if ((store.users || []).find(u => u.username === username)) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
    }

    const hash = await bcrypt.hash(password, 10);
    if (!store.users) store.users = [];
    store.users.push({
        id: 'user_' + uuidv4().slice(0, 8),
        username,
        password: hash,
        role: 'admin',
        name: username,
        linked_guest_ids: [],
        created_at: new Date().toISOString()
    });
    await db.saveDB();
    res.json({ success: true });
});

router.post('/upload', async (req, res) => {
    const dest = path.join(__dirname, '..', 'public', 'uploads');
    const result = saveBase64Upload(req.body || {}, dest);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json({ success: true, url: result.url, mime: result.mime, size: result.size });
});

router.get('/notifications', (req, res) => {
    try {
        const store = db.getData();
        const notifications = Array.isArray(store.notifications) ? [...store.notifications] : [];
        notifications.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        res.json({ success: true, notifications });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/notifications', async (req, res) => {
    const { title, tag, date, text, target, targetClientId, type, expires_at } = req.body;
    if (!title || !text) return res.status(400).json({ error: 'title и text обязательны' });

    const store = db.getData();
    const targetType = target || 'all';
    let targetId = targetType === 'specific' ? (targetClientId || null) : null;
    if (targetId) {
        const ident = resolveIdentity(store, targetId);
        targetId = ident.id;
    }

    const notification = {
        id: uuidv4(),
        title: String(title).trim(),
        tag: tag || 'Инфо',
        type: type || (tag === 'Система' ? 'system' : tag === 'Фича' ? 'feature' : 'info'),
        date: date || new Date().toLocaleDateString('ru-RU'),
        text: String(text).trim(),
        created_at: new Date().toISOString(),
        target: targetType,
        target_type: targetType === 'specific' ? 'user' : targetType,
        target_id: targetId,
        targetClientId: targetId,
        expires_at: expires_at || null,
        readBy: []
    };

    store.notifications.push(notification);
    await db.saveDB();

    const push = req.app.get('pushNotification');
    if (push) push(notification);

    res.json({ success: true, notification });
});

router.delete('/notifications/:id', async (req, res) => {
    try {
        const store = db.getData();
        const before = (store.notifications || []).length;
        store.notifications = (store.notifications || []).filter(n => String(n.id) !== String(req.params.id));
        if (store.notifications.length !== before) await db.saveDB();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/guests', (req, res) => {
    res.json({ success: true, guests: db.getData().guests || [] });
});

router.delete('/guests/:clientId', async (req, res) => {
    const store = db.getData();
    store.guests = (store.guests || []).filter(g => g.client_id !== req.params.clientId);
    await db.saveDB();

    const broadcast = req.app.get('broadcastToAdmins');
    if (broadcast) {
        const getClientList = req.app.get('getClientList');
        broadcast({ type: 'clients_update', clients: getClientList ? getClientList() : [] });
    }

    res.json({ success: true });
});

router.isPromoLive = isPromoLive;
module.exports = router;
