const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireAdmin, optionalAuth } = require('../middleware/auth');
const { messagesFor, resolveIdentity, belongsToIdentity } = require('../lib/identity');

router.get('/history/:clientId', optionalAuth, (req, res) => {
    const store = db.getData();
    const ident = resolveIdentity(store, req.params.clientId);

    if (req.user && req.user.role === 'admin') {
        return res.json(messagesFor(store, req.params.clientId));
    }

    if (req.user && req.user.role === 'client') {
        const self = resolveIdentity(store, req.user.id);
        const overlap = [...ident.keys].some((k) => self.keys.has(k));
        if (!overlap) return res.status(403).json({ error: 'Нет доступа к этой переписке' });
        return res.json(messagesFor(store, req.user.id));
    }

    const guestHeader = req.headers['x-client-id'];
    if (guestHeader && ident.keys.has(String(guestHeader))) {
        return res.json(messagesFor(store, guestHeader));
    }

    return res.json(messagesFor(store, req.params.clientId));
});

router.get('/sessions', authenticateToken, requireAdmin, (req, res) => {
    const getClientList = req.app.get('getClientList');
    res.json({ success: true, clients: getClientList ? getClientList() : [] });
});

module.exports = router;
