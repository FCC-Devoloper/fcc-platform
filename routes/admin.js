const express = require('express');
const router = express.Router();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { saveBase64Upload } = require('../lib/upload');
const { UPLOAD_DIR, ensureUploadDir } = require('../lib/storage');
const { resolveIdentity } = require('../lib/identity');
const content = require('../lib/content-defaults');

const ORDER_STATUSES = ['new', 'in_progress', 'waiting_client', 'done', 'rejected', 'cancelled'];

function isPromoLive(p, now = new Date()) {
    if (!p || p.is_active === 0) return false;
    if (p.visibility === 'HIDDEN' || p.visibility === 'hidden') return false;
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

// ===== Общие помощники для редакторов =====
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const has = (b, k) => Object.prototype.hasOwnProperty.call(b, k);
const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') ? 1 : 0;

function safeUrl(v, allowRelative = true) {
    const u = str(v, 600);
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (allowRelative && /^(\/|#|mailto:|tel:)/i.test(u)) return u;
    return null; // недопустимая ссылка
}

/** Копирует в target только те поля, которые реально пришли в запросе. */
function applyFields(target, body, spec) {
    for (const [field, rule] of Object.entries(spec)) {
        if (!has(body, field)) continue;
        const raw = body[field];
        if (rule.type === 'text') target[field] = str(raw, rule.max || 300);
        else if (rule.type === 'url') {
            const u = safeUrl(raw, rule.relative !== false);
            if (u === null) return 'Недопустимая ссылка в поле «' + (rule.label || field) + '»';
            target[field] = u;
        }
        else if (rule.type === 'flag') target[field] = flag(raw);
        else if (rule.type === 'int') target[field] = Number.isFinite(Number(raw)) ? Math.round(Number(raw)) : 0;
        else if (rule.type === 'list') target[field] = db.toList(raw).slice(0, rule.max || 20).map(x => x.slice(0, 120));
        else if (rule.type === 'enum') target[field] = rule.values.includes(String(raw)) ? String(raw) : rule.values[0];
        else if (rule.type === 'date') {
            const d = str(raw, 40);
            target[field] = d && !Number.isNaN(new Date(d).getTime()) ? d : '';
        }
    }
    return null;
}

const PROJECT_SPEC = {
    title_ru: { type: 'text', max: 160, label: 'Название' },
    description_ru: { type: 'text', max: 600, label: 'Краткое описание' },
    full_description: { type: 'text', max: 8000, label: 'Подробное описание' },
    category: { type: 'text', max: 60, label: 'Категория' },
    client: { type: 'text', max: 120, label: 'Заказчик' },
    year: { type: 'text', max: 10, label: 'Год' },
    results: { type: 'text', max: 1000, label: 'Результат' },
    technologies: { type: 'text', max: 300, label: 'Технологии' },
    features: { type: 'list', max: 12 },
    image: { type: 'url', label: 'Картинка' },
    demo_url: { type: 'url', relative: false, label: 'Ссылка на демо' },
    runtime: { type: 'enum', values: ['', 'html', 'python'] },
    html_code: { type: 'text', max: 200000 },
    python_code: { type: 'text', max: 100000 },
    is_published: { type: 'flag' },
    is_featured: { type: 'flag' },
    sort: { type: 'int' }
};

const NEWS_SPEC = {
    title_ru: { type: 'text', max: 200, label: 'Заголовок' },
    subtitle: { type: 'text', max: 300, label: 'Подзаголовок' },
    content_ru: { type: 'text', max: 20000, label: 'Текст' },
    category: { type: 'text', max: 60, label: 'Рубрика' },
    media_type: { type: 'enum', values: ['image', 'video'] },
    media_url: { type: 'url', label: 'Медиа' },
    media_align: { type: 'enum', values: ['full', 'left', 'center'] },
    media_scale: { type: 'int' },
    btn_text: { type: 'text', max: 60, label: 'Текст кнопки' },
    btn_url: { type: 'url', label: 'Ссылка кнопки' },
    is_published: { type: 'flag' },
    pinned: { type: 'flag' },
    published_at: { type: 'date' }
};

const ZERO_REACTIONS = () => ({ like: 0, fire: 0, heart: 0, wow: 0 });

router.get('/projects', (req, res) => {
    const list = (db.getData().projects || []).slice()
        .sort((a, b) => (b.sort || 0) - (a.sort || 0) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
    res.json({ success: true, projects: list });
});

router.post('/projects', async (req, res) => {
    const store = db.getData();
    if (!store.projects) store.projects = [];
    const body = req.body || {};
    const id = body.id ? String(body.id) : '';
    let p = id ? store.projects.find(x => String(x.id) === id) : null;
    if (id && !p) return res.status(404).json({ error: 'Проект не найден (возможно, уже удалён)' });

    const isNew = !p;
    const draft = isNew
        ? { id: 'proj_' + uuidv4().slice(0, 8), is_published: 1, is_featured: 0, sort: 0, features: [], reactions: ZERO_REACTIONS(), created_at: new Date().toISOString() }
        : p;
    const target = isNew ? draft : { ...p };
    const err = applyFields(target, body, PROJECT_SPEC);
    if (err) return res.status(400).json({ error: err });
    if (!str(target.title_ru, 160)) return res.status(400).json({ error: 'Укажите название проекта' });

    if (isNew) store.projects.push(target);
    else Object.assign(p, target, { updated_at: new Date().toISOString() });
    await db.saveDB();
    res.json({ success: true, project: isNew ? target : p });
});

router.patch('/projects/:id/publish', async (req, res) => {
    const p = (db.getData().projects || []).find(x => String(x.id) === String(req.params.id));
    if (!p) return res.status(404).json({ error: 'Проект не найден' });
    p.is_published = has(req.body || {}, 'is_published') ? flag(req.body.is_published) : (p.is_published === 0 ? 1 : 0);
    await db.saveDB();
    res.json({ success: true, is_published: p.is_published });
});

router.delete('/projects/:id', async (req, res) => {
    const store = db.getData();
    const before = (store.projects || []).length;
    store.projects = (store.projects || []).filter(p => String(p.id) !== String(req.params.id));
    if (store.projects.length === before) return res.status(404).json({ error: 'Проект не найден' });
    await db.saveDB();
    res.json({ success: true });
});

router.get('/news', (req, res) => {
    const list = (db.getData().news || []).slice()
        .sort((a, b) => (b.pinned || 0) - (a.pinned || 0) || String(b.published_at || b.created_at || '').localeCompare(String(a.published_at || a.created_at || '')));
    res.json({ success: true, news: list });
});

router.post('/news', async (req, res) => {
    const store = db.getData();
    if (!store.news) store.news = [];
    const body = req.body || {};
    const id = body.id ? String(body.id) : '';
    const existing = id ? store.news.find(x => String(x.id) === id) : null;

    // Старые клиенты присылали свой id для новой записи — это допустимо.
    const isNew = !existing;
    const target = isNew
        ? { id: id || 'news_' + uuidv4().slice(0, 8), is_published: 1, pinned: 0, media_type: 'image', media_align: 'full', media_scale: 100, reactions: ZERO_REACTIONS(), created_at: new Date().toISOString() }
        : { ...existing };
    const err = applyFields(target, body, NEWS_SPEC);
    if (err) return res.status(400).json({ error: err });
    if (!str(target.title_ru, 200)) return res.status(400).json({ error: 'Укажите заголовок новости' });
    target.media_scale = Math.min(100, Math.max(20, Number(target.media_scale) || 100));

    if (isNew) store.news.push(target);
    else Object.assign(existing, target, { updated_at: new Date().toISOString() });
    await db.saveDB();
    res.json({ success: true, news: isNew ? target : existing });
});

router.patch('/news/:id/publish', async (req, res) => {
    const n = (db.getData().news || []).find(x => String(x.id) === String(req.params.id));
    if (!n) return res.status(404).json({ error: 'Новость не найдена' });
    n.is_published = has(req.body || {}, 'is_published') ? flag(req.body.is_published) : (n.is_published === 0 ? 1 : 0);
    await db.saveDB();
    res.json({ success: true, is_published: n.is_published });
});

router.delete('/news/:id', async (req, res) => {
    const store = db.getData();
    const before = (store.news || []).length;
    store.news = (store.news || []).filter(n => String(n.id) !== String(req.params.id));
    if (store.news.length === before) return res.status(404).json({ error: 'Новость не найдена' });
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
    const pos = String(payload.position || existing?.position || 'BOTTOM').toUpperCase();
    const position = ['TOP', 'MIDDLE', 'BOTTOM', 'CHAT'].includes(pos) ? pos : 'BOTTOM';
    const vis = String(payload.visibility || existing?.visibility || 'VISIBLE').toUpperCase();
    const visibility = vis === 'HIDDEN' ? 'HIDDEN' : 'VISIBLE';
    const body = {
        title_ru: payload.title_ru || '',
        description_ru: payload.description_ru || '',
        discount: payload.discount || '',
        target: payload.target || 'Все услуги',
        action_link: payload.action_link || '',
        details_link: payload.details_link || '',
        position,
        visibility,
        is_active: payload.is_active === undefined ? 1 : (payload.is_active ? 1 : 0),
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

/** Схема всех текстов сайта: группы, подписи, значения по умолчанию + текущие значения. */
router.get('/content-schema', (req, res) => {
    res.json({ success: true, groups: content.GROUPS, values: db.getData().site_texts || {} });
});

function saveTextItem(key, value, extra) {
    const v = str(value, 4000);
    return db.setContent(key, v, extra);
}

router.post('/settings', async (req, res) => {
    const { key, value_ru, value_en } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key required' });
    saveTextItem(String(key).slice(0, 80), value_ru !== undefined ? value_ru : (value_en || ''));
    await db.saveDB();
    res.json({ success: true });
});

/** Сохранить сразу много текстов: { items: { "hero.title": "…", … } } */
router.put('/settings/bulk', async (req, res) => {
    const items = (req.body && req.body.items) || {};
    const keys = Object.keys(items);
    if (!keys.length) return res.status(400).json({ error: 'Нет данных для сохранения' });
    if (keys.length > 300) return res.status(400).json({ error: 'Слишком много полей' });
    let saved = 0;
    keys.forEach((key) => {
        if (!content.FIELDS[key]) return; // принимаем только известные поля
        saveTextItem(key, items[key]);
        saved += 1;
    });
    await db.saveDB();
    const broadcast = req.app.get('broadcastToAdmins');
    if (broadcast) broadcast({ type: 'content_update' });
    res.json({ success: true, saved });
});

/** Правка одного элемента из визуального редактора: текст + стиль + действие кнопки. */
router.put('/content', async (req, res) => {
    const { key, value, action, url, styles } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key required' });
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(String(key))) return res.status(400).json({ error: 'Недопустимый ключ' });
    const act = action === undefined ? undefined : (content.ACTIONS.includes(action) ? action : '');
    let cleanedUrl;
    if (url !== undefined) {
        if (act === 'scroll') {
            const id = String(url).trim().replace(/^#/, '');
            cleanedUrl = /^[A-Za-z][\w-]{0,60}$/.test(id) ? id : '';
        } else {
            cleanedUrl = content.cleanUrl(url);
        }
    }
    if (act === 'url' && !cleanedUrl) return res.status(400).json({ error: 'Для действия «Перейти по ссылке» нужна корректная ссылка (https://…)' });
    if (act === 'scroll' && !cleanedUrl) return res.status(400).json({ error: 'Для прокрутки укажите id раздела, например services' });
    db.setContent(String(key), str(value, 4000), {
        action: act,
        url: (act === '' || act === 'modal' || act === 'chat') ? '' : cleanedUrl,
        styles: styles === undefined ? undefined : content.cleanStyles(styles)
    });
    await db.saveDB();
    const broadcast = req.app.get('broadcastToAdmins');
    if (broadcast) broadcast({ type: 'content_update', key });
    res.json({ success: true, item: db.getData().site_texts[String(key)] });
});

/** Сбросить элемент к исходному тексту из HTML. */
router.delete('/content/:key', async (req, res) => {
    const removed = db.deleteContent(String(req.params.key));
    if (removed) await db.saveDB();
    res.json({ success: true, removed });
});

router.get('/orders', async (req, res) => {
    const store = db.getData();
    // Auto-remove rejected older than 24h
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let changed = false;
    (store.orders || []).forEach((o) => {
        if (o.status === 'rejected' && !o.deleted_at) {
            const t = new Date(o.updated_at || o.created_at || 0).getTime();
            if (t && t < dayAgo) {
                o.deleted_at = new Date().toISOString();
                o.auto_purged = true;
                changed = true;
            }
        }
    });
    if (changed) await db.saveDB();

    const includeDeleted = req.query.all === '1';
    const orders = (store.orders || []).filter(o => includeDeleted || !o.deleted_at);
    orders.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const folders = {
        new: orders.filter(o => o.status === 'new'),
        in_progress: orders.filter(o => o.status === 'in_progress'),
        waiting_client: orders.filter(o => o.status === 'waiting_client'),
        done: orders.filter(o => o.status === 'done'),
        rejected: orders.filter(o => o.status === 'rejected')
    };
    res.json({ success: true, orders, folders });
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
    if (!str(req.body.title_ru, 160)) return res.status(400).json({ error: 'Укажите название этапа' });
    store.plans.push({
        id: 'plan_' + uuidv4().slice(0, 8),
        title_ru: str(req.body.title_ru, 160),
        description_ru: str(req.body.description_ru, 600),
        status: ['now', 'next', 'later', 'done'].includes(req.body.status) ? req.body.status : 'now',
        eta: str(req.body.eta, 40),
        created_at: new Date().toISOString()
    });
    await db.saveDB();
    res.json({ success: true });
});

router.patch('/plans/:id', async (req, res) => {
    const plan = (db.getData().plans || []).find(p => String(p.id) === String(req.params.id));
    if (!plan) return res.status(404).json({ error: 'План не найден' });
    const b = req.body || {};
    if (has(b, 'title_ru')) {
        if (!str(b.title_ru, 160)) return res.status(400).json({ error: 'Укажите название этапа' });
        plan.title_ru = str(b.title_ru, 160);
    }
    if (has(b, 'description_ru')) plan.description_ru = str(b.description_ru, 600);
    if (has(b, 'status')) plan.status = ['now', 'next', 'later', 'done'].includes(b.status) ? b.status : 'now';
    if (has(b, 'eta')) plan.eta = str(b.eta, 40);
    plan.updated_at = new Date().toISOString();
    await db.saveDB();
    res.json({ success: true, plan });
});

router.delete('/plans/:id', async (req, res) => {
    const store = db.getData();
    store.plans = (store.plans || []).filter(p => String(p.id) !== String(req.params.id));
    await db.saveDB();
    res.json({ success: true });
});

router.get('/users', (req, res) => {
    const store = db.getData();
    // Staff only: admin + dev — never clients
    const users = (store.users || [])
        .filter(u => u.role === 'admin' || u.role === 'dev')
        .map(u => ({
            id: u.id,
            username: u.username,
            role: u.role,
            name: u.name || u.username,
            email: u.email || '',
            access_key: u.access_key || null,
            last_seen: u.last_seen
        }));
    res.json({ success: true, users });
});

router.get('/devs', (req, res) => {
    const store = db.getData();
    const users = (store.users || [])
        .filter(u => u.role === 'dev')
        .map(u => ({
            id: u.id,
            username: u.username,
            role: 'dev',
            email: u.email || '',
            name: u.name || u.username,
            access_key: u.access_key || null,
            last_seen: u.last_seen
        }));
    res.json({ success: true, users });
});

router.get('/clients', (req, res) => {
    const store = db.getData();
    const getClientList = req.app.get('getClientList');
    const live = getClientList ? getClientList() : [];
    const registered = (store.users || [])
        .filter(u => u.role === 'client')
        .map(u => ({
            id: u.id,
            username: u.username,
            name: u.name || u.username,
            email: u.email || '',
            role: 'client',
            last_seen: u.last_seen,
            linked_guest_ids: u.linked_guest_ids || []
        }));
    res.json({ success: true, clients: registered, live });
});

router.delete('/clients/:id', async (req, res) => {
    const store = db.getData();
    const id = String(req.params.id);
    const user = (store.users || []).find(u => String(u.id) === id);
    if (user && user.role === 'admin') {
        return res.status(403).json({ error: 'Нельзя удалить администратора этим методом' });
    }
    const { purgeClient } = require('../lib/identity');
    const result = purgeClient(store, id);
    if (!result.found) return res.status(404).json({ error: 'Клиент не найден' });
    await db.saveDB();
    const broadcast = req.app.get('broadcastToAdmins');
    const getClientList = req.app.get('getClientList');
    if (broadcast && getClientList) {
        broadcast({ type: 'clients_update', clients: getClientList() });
    }
    res.json({ success: true, purged: result });
});

router.post('/users', async (req, res) => {
    const { username, password, inviteCode } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    // Two-step: only an already-authenticated admin (route middleware) + invite code
    const expected = process.env.ADMIN_INVITE_CODE;
    if (!expected || expected.length < 12 || String(inviteCode || '') !== String(expected)) {
        return res.status(403).json({ error: 'Неверный код приглашения администратора' });
    }

    const store = db.getData();
    if ((store.users || []).find(u => String(u.username).toLowerCase() === String(username).toLowerCase())) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
    }

    const hash = await bcrypt.hash(password, 10);
    if (!store.users) store.users = [];
    // ONLY ONE admin exists (seeded). New staff are ALWAYS developers.
    const role = 'dev';
    const access_key = 'FCC-' + uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase();
    const email = String(req.body.email || '').trim().toLowerCase();
    const newId = 'user_' + uuidv4().slice(0, 8);
    store.users.push({
        id: newId,
        username: String(username).trim(),
        password: hash,
        role,
        email: email || '',
        name: String(username).trim(),
        linked_guest_ids: [],
        access_key,
        is_super_admin: false,
        created_at: new Date().toISOString()
    });
    await db.saveDB();
    res.json({ success: true, id: newId, role, access_key });
});

/** Edit staff (dev or admin fields). Cannot demote last admin. */
router.patch('/users/:id', async (req, res) => {
    const store = db.getData();
    const id = String(req.params.id);
    const user = (store.users || []).find(u => String(u.id) === id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.role !== 'admin' && user.role !== 'dev') {
        return res.status(400).json({ error: 'Редактировать здесь можно только staff' });
    }

    const body = req.body || {};
    if (body.username != null) {
        const next = String(body.username).trim();
        if (next.length < 2) return res.status(400).json({ error: 'Логин слишком короткий' });
        const clash = (store.users || []).find(
            u => String(u.id) !== id && String(u.username).toLowerCase() === next.toLowerCase()
        );
        if (clash) return res.status(400).json({ error: 'Логин уже занят' });
        user.username = next;
        user.name = next;
    }
    if (body.email != null) {
        user.email = String(body.email).trim().toLowerCase();
    }
    if (body.password && String(body.password).length >= 4) {
        user.password = await bcrypt.hash(String(body.password), 10);
    }
    // Role: only allow admin → keep admin; never promote second admin via this form.
    // Dev stays dev. Optional regenerate key.
    if (body.regenerate_key === true || body.regenerate_key === '1') {
        user.access_key = 'FCC-' + uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase();
    }
    if (!user.access_key && (user.role === 'dev' || user.role === 'admin')) {
        user.access_key = 'FCC-' + uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase();
    }
    user.updated_at = new Date().toISOString();
    await db.saveDB();
    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            email: user.email || '',
            access_key: user.access_key || null
        }
    });
});

/**
 * Delete staff.
 * - Root/last admin cannot be deleted.
 * - Admin can only be deleted if another admin remains.
 * - Dev can always be deleted by admin.
 */
router.delete('/users/:id', async (req, res) => {
    const store = db.getData();
    const id = String(req.params.id);
    const user = (store.users || []).find(u => String(u.id) === id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.role !== 'admin' && user.role !== 'dev') {
        return res.status(400).json({ error: 'Через этот метод удаляется только staff' });
    }

    if (String(req.user && req.user.id) === id) {
        return res.status(403).json({ error: 'Нельзя удалить свой текущий аккаунт' });
    }

    if (user.role === 'admin') {
        const admins = (store.users || []).filter(u => u.role === 'admin');
        if (admins.length <= 1) {
            return res.status(403).json({ error: 'Нельзя удалить последнего (корневого) администратора' });
        }
    }

    store.users = (store.users || []).filter(u => String(u.id) !== id);
    // Unlink public team cards pointing at this login
    if (Array.isArray(store.team)) {
        store.team.forEach(t => {
            if (t && String(t.user_id || '') === id) t.user_id = null;
        });
    }
    await db.saveDB();
    res.json({ success: true, deleted: id });
});

router.post('/upload', async (req, res) => {
    const dest = ensureUploadDir();
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


router.get('/team', (req, res) => {
    res.json({ success: true, team: db.getData().team || [] });
});

router.post('/team', async (req, res) => {
    const store = db.getData();
    if (!store.team) store.team = [];
    const b = req.body || {};
    const existing = b.id ? store.team.find(x => String(x.id) === String(b.id)) : null;
    if (b.id && !existing) return res.status(404).json({ error: 'Участник не найден' });
    if (!str(b.name, 100)) return res.status(400).json({ error: 'Укажите имя' });
    const photo = safeUrl(b.photo);
    if (photo === null) return res.status(400).json({ error: 'Недопустимая ссылка на фото' });
    const row = {
        name: str(b.name, 100),
        role_title: str(b.role_title, 100),
        skills: str(b.skills, 300),
        bio: str(b.bio, 1000),
        photo,
        user_id: b.user_id || null,
        is_public: b.is_public === undefined ? 1 : (b.is_public ? 1 : 0),
        sort: Number(b.sort) || 0
    };
    if (existing) Object.assign(existing, row);
    else store.team.push({ id: 'dev_' + uuidv4().slice(0, 8), ...row, created_at: new Date().toISOString() });
    await db.saveDB();
    res.json({ success: true, team: store.team });
});

router.delete('/team/:id', async (req, res) => {
    const store = db.getData();
    store.team = (store.team || []).filter(x => String(x.id) !== String(req.params.id));
    await db.saveDB();
    res.json({ success: true });
});

/** Assign order to a developer (or self null) */
router.patch('/orders/:id/assign', async (req, res) => {
    const store = db.getData();
    const order = (store.orders || []).find(o => o.id === req.params.id);
    if (!order || order.deleted_at) return res.status(404).json({ error: 'not found' });
    const assigneeId = req.body.assignee_id || null; // user id of dev, or null = unassigned (main only)
    order.assignee_id = assigneeId;
    order.assigned_at = new Date().toISOString();
    order.updated_at = order.assigned_at;
    if (!Array.isArray(order.status_history)) order.status_history = [];
    order.status_history.push({
        status: order.status,
        at: order.assigned_at,
        by: req.user ? req.user.username : 'admin',
        reason: assigneeId ? ('assigned:' + assigneeId) : 'unassigned'
    });
    await db.saveDB();
    const broadcast = req.app.get('broadcastToAdmins');
    if (broadcast) broadcast({ type: 'orders_update', order });
    res.json({ success: true, order });
});

/** Message from main admin to a developer */
router.post('/dev-messages', async (req, res) => {
    const { to_user_id, text } = req.body || {};
    if (!to_user_id || !text) return res.status(400).json({ error: 'to_user_id и text обязательны' });
    const store = db.getData();
    if (!store.dev_messages) store.dev_messages = [];
    const msg = {
        id: uuidv4(),
        from_user_id: req.user ? req.user.id : null,
        from_name: req.user ? req.user.username : 'admin',
        to_user_id: String(to_user_id),
        text: String(text).trim(),
        created_at: new Date().toISOString(),
        read: false
    };
    store.dev_messages.push(msg);
    await db.saveDB();
    res.json({ success: true, message: msg });
});

router.get('/dev-messages', (req, res) => {
    const store = db.getData();
    let list = store.dev_messages || [];
    // main admin sees all; if somehow dev hits this with admin middleware they won't
    res.json({ success: true, messages: list.slice().reverse() });
});



// ===== FCC Learning Center map settings (isolated module) =====
router.get('/learning-center-map', (req, res) => {
    const settings = db.getData().settings || {};
    const raw = settings.learning_center_map || {};
    const latitude = Number(raw.latitude);
    const longitude = Number(raw.longitude);
    res.json({ success: true, location: {
        city: String(raw.city || 'Гиссар').slice(0, 120),
        country: String(raw.country || 'Таджикистан').slice(0, 120),
        village: String(raw.village || '').slice(0, 120),
        address: String(raw.address || '').slice(0, 250),
        latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : 38.52504,
        longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : 68.55124
    }});
});

router.put('/learning-center-map', async (req, res) => {
    const body = req.body || {};
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        return res.status(400).json({ error: 'Укажите корректные координаты.' });
    }
    const settings = db.getData().settings || {};
    settings.learning_center_map = {
        city: String(body.city || '').trim().slice(0, 120) || 'Гиссар',
        country: String(body.country || '').trim().slice(0, 120) || 'Таджикистан',
        village: String(body.village || '').trim().slice(0, 120),
        address: String(body.address || '').trim().slice(0, 250),
        latitude,
        longitude
    };
    db.getData().settings = settings;
    await db.saveDB();
    res.json({ success: true, location: settings.learning_center_map });
});

// ===== FCC Learning Center applications (isolated module) =====
router.get('/learning-center', (req, res) => {
    const store = db.getData();
    const items = (store.learning_applications || []).filter(a => !a.deleted_at).slice();
    items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const stats = {
        total: items.length,
        new: items.filter(a => a.status === 'new').length,
        contacted: items.filter(a => a.status === 'contacted').length,
        approved: items.filter(a => a.status === 'approved').length,
        rejected: items.filter(a => a.status === 'rejected').length,
        tariffs: { basic: 0, standard: 0, intensive: 0 },
        browsers: {},
        devices: {}
    };
    items.forEach(a => {
        if (stats.tariffs[a.tariff] !== undefined) stats.tariffs[a.tariff]++;
        stats.browsers[a.browser || 'Другое'] = (stats.browsers[a.browser || 'Другое'] || 0) + 1;
        stats.devices[a.device || 'unknown'] = (stats.devices[a.device || 'unknown'] || 0) + 1;
    });
    res.json({ success: true, applications: items, stats });
});

router.patch('/learning-center/:id/status', async (req, res) => {
    const store = db.getData();
    const item = (store.learning_applications || []).find(a => String(a.id) === String(req.params.id));
    if (!item || item.deleted_at) return res.status(404).json({ error: 'Заявка не найдена' });
    const allowed = ['new', 'contacted', 'approved', 'rejected', 'completed'];
    const status = String(req.body.status || 'new');
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Неизвестный статус' });
    item.status = status;
    item.updated_at = new Date().toISOString();
    if (!Array.isArray(item.history)) item.history = [];
    item.history.push({ status, at: item.updated_at, by: req.user ? req.user.username : 'admin', comment: String(req.body.comment || '').slice(0, 500) });
    await db.saveDB();
    const broadcast = req.app.get('broadcastToAdmins');
    if (broadcast) broadcast({ type: 'learning_center_update', application: item });
    res.json({ success: true, application: item });
});

router.delete('/learning-center/:id', async (req, res) => {
    const store = db.getData();
    const item = (store.learning_applications || []).find(a => String(a.id) === String(req.params.id));
    if (!item || item.deleted_at) return res.status(404).json({ error: 'Заявка не найдена' });
    item.deleted_at = new Date().toISOString();
    await db.saveDB();
    res.json({ success: true });
});

router.isPromoLive = isPromoLive;
module.exports = router;
