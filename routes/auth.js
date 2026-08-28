const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { mergeGuestIntoUser, ensureUserShape } = require('../lib/identity');

function issueToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            role: user.role,
            name: user.name || user.username
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name || user.username,
        email: user.email || '',
        linked_guest_ids: user.linked_guest_ids || []
    };
}

router.post('/register', async (req, res) => {
    const { username, password, email, clientId } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все обязательные поля.' });
    }
    if (String(password).length < 4) {
        return res.status(400).json({ error: 'Пароль слишком короткий.' });
    }

    const store = db.getStore();
    const exists = store.users.some(u => u.username.toLowerCase() === String(username).toLowerCase());
    if (exists) {
        return res.status(400).json({ error: 'Пользователь с таким именем уже существует.' });
    }

    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        const newUser = {
            id: 'usr_' + uuidv4().slice(0, 8),
            username: String(username).trim(),
            password: hashedPassword,
            email: email || '',
            role: 'client',
            name: String(username).trim(),
            linked_guest_ids: [],
            created_at: new Date().toISOString(),
            last_seen: new Date().toISOString()
        };

        store.users.push(newUser);

        let mergeInfo = { merged: false, mergedGuestId: null };
        if (clientId) {
            mergeInfo = mergeGuestIntoUser(store, clientId, newUser.id, newUser.username);
        }

        await db.saveStore();

        const rebind = req.app.get('rebindIdentitySockets');
        if (rebind && clientId) rebind(clientId, newUser.id);

        const broadcast = req.app.get('broadcastToAdmins');
        const getClientList = req.app.get('getClientList');
        if (broadcast && getClientList) {
            broadcast({ type: 'clients_update', clients: getClientList() });
        }

        res.json({
            success: true,
            token: issueToken(newUser),
            userId: newUser.id,
            username: newUser.username,
            role: newUser.role,
            mergedGuestId: mergeInfo.mergedGuestId,
            user: publicUser(newUser)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при регистрации.' });
    }
});

router.post('/login', async (req, res) => {
    const { username, password, clientId } = req.body;
    const store = db.getStore();

    const user = store.users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
    if (!user) {
        return res.status(401).json({ error: 'Неверный логин или пароль.' });
    }

    const isValidPassword = bcrypt.compareSync(password, user.password) || password === user.password;
    if (!isValidPassword) {
        return res.status(401).json({ error: 'Неверный логин или пароль.' });
    }

    ensureUserShape(user);

    let mergeInfo = { merged: false, mergedGuestId: null };
    if (clientId && user.role === 'client') {
        mergeInfo = mergeGuestIntoUser(store, clientId, user.id, user.username);
    }

    user.last_seen = new Date().toISOString();
    await db.saveStore();

    const rebind = req.app.get('rebindIdentitySockets');
    if (rebind && clientId && user.role === 'client') rebind(clientId, user.id);

    const broadcast = req.app.get('broadcastToAdmins');
    const getClientList = req.app.get('getClientList');
    if (broadcast && getClientList) {
        broadcast({ type: 'clients_update', clients: getClientList() });
    }

    res.json({
        success: true,
        token: issueToken(user),
        userId: user.id,
        username: user.username,
        role: user.role,
        mergedGuestId: mergeInfo.mergedGuestId,
        user: publicUser(user)
    });
});

router.get('/me', require('../middleware/auth').authenticateToken, (req, res) => {
    const store = db.getStore();
    const user = store.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ success: true, user: publicUser(user) });
});

module.exports = router;
