const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { optionalAuth, authenticateToken } = require('../middleware/auth');
const { resolveIdentity, stampRecord, ordersFor } = require('../lib/identity');

const PUBLIC_STATUSES = ['new', 'in_progress', 'waiting_client', 'done', 'rejected', 'cancelled'];

router.post('/', optionalAuth, async (req, res) => {
    const { title, category, description, contact, clientId } = req.body;
    if (!title || !contact) return res.status(400).json({ error: 'Заполните обязательные поля.' });

    try {
        const store = db.getData();
        const lookupId = (req.user && req.user.role === 'client' && req.user.id) || clientId || 'guest';
        const ident = resolveIdentity(store, lookupId);

        const newOrder = stampRecord({
            id: 'ord_' + uuidv4().slice(0, 8),
            title: String(title).trim(),
            category: category || 'web',
            description: description || '',
            contact: String(contact).trim(),
            client_id: ident.kind === 'user' ? (clientId || ident.id) : (clientId || ident.id || 'guest'),
            client_name: ident.user ? (ident.user.name || ident.user.username) : null,
            status: 'new',
            rejection_reason: null,
            result_url: null,
            result_file: null,
            deleted_at: null,
            status_history: [{
                status: 'new',
                at: new Date().toISOString(),
                by: ident.kind === 'user' ? ident.user.id : 'guest',
                reason: null
            }],
            created_at: new Date().toISOString()
        }, ident);

        store.orders.push(newOrder);
        await db.saveDB();

        const broadcast = req.app.get('broadcastToAdmins');
        if (broadcast) broadcast({ type: 'orders_update', order: newOrder });

        res.json({ success: true, orderId: newOrder.id, order: newOrder });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Ошибка сохранения заявки.' });
    }
});

router.get('/', optionalAuth, (req, res) => {
    const store = db.getData();
    if (req.user && req.user.role === 'admin') {
        return res.json({ success: true, orders: (store.orders || []).filter(o => !o.deleted_at) });
    }
    const lookupId = (req.user && req.user.id) || req.query.clientId;
    if (!lookupId) return res.json({ success: true, orders: [] });
    res.json({ success: true, orders: ordersFor(store, lookupId) });
});

router.get('/mine', authenticateToken, (req, res) => {
    const store = db.getData();
    res.json({ success: true, orders: ordersFor(store, req.user.id) });
});

router.patch('/:id/status', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Только администратор меняет статус' });
    }
    const { status } = req.body;
    if (status && !PUBLIC_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Неизвестный статус' });
    }
    const store = db.getData();
    const order = store.orders.find(o => String(o.id) === String(req.params.id));
    if (!order || order.deleted_at) return res.status(404).json({ error: 'Заявка не найдена' });

    order.status = status || order.status;
    order.updated_at = new Date().toISOString();
    await db.saveDB();
    res.json({ success: true });
});

module.exports = router;
