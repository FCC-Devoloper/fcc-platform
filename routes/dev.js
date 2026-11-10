const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

function requireDev(req, res, next) {
    if (req.user && (req.user.role === 'dev' || req.user.role === 'admin')) return next();
    return res.status(403).json({ error: 'Только для разработчиков команды' });
}

router.use(authenticateToken, requireDev);

router.get('/me', (req, res) => {
    const store = db.getData();
    const profile = (store.team || []).find(t => t.user_id && String(t.user_id) === String(req.user.id));
    res.json({
        success: true,
        user: { id: req.user.id, username: req.user.username, role: req.user.role },
        profile: profile || null
    });
});

router.get('/orders', (req, res) => {
    const store = db.getData();
    const mine = (store.orders || []).filter(o =>
        !o.deleted_at && String(o.assignee_id || '') === String(req.user.id)
    );
    res.json({ success: true, orders: mine });
});

router.get('/messages', (req, res) => {
    const store = db.getData();
    const list = (store.dev_messages || []).filter(m => String(m.to_user_id) === String(req.user.id));
    res.json({ success: true, messages: list.slice().reverse() });
});

router.post('/messages/read', async (req, res) => {
    const store = db.getData();
    (store.dev_messages || []).forEach(m => {
        if (String(m.to_user_id) === String(req.user.id)) m.read = true;
    });
    await db.saveDB();
    res.json({ success: true });
});

module.exports = router;
