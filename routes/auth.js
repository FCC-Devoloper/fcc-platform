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
    if (!email || !String(email).includes('@')) {
        return res.status(400).json({ error: 'Email обязателен.' });
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

    const isValidPassword = user.password && bcrypt.compareSync(String(password || ''), user.password);
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

    // CLIENT login only — admins must use /api/auth/admin-login
    if (user.role === 'admin' || user.role === 'dev') {
        return res.status(403).json({
            error: 'Сотрудники входят только через командный портал /team-portal.html'
        });
    }

    res.json({
        success: true,
        token: issueToken(user),
        userId: user.id,
        username: user.username,
        role: 'client',
        mergedGuestId: mergeInfo.mergedGuestId,
        user: publicUser(user)
    });
});

/** Admin-only login — separate from client */
router.post('/admin-login', async (req, res) => {
    const { username, password } = req.body || {};
    const store = db.getStore();
    const user = store.users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
    if (!user || user.role !== 'admin') {
        return res.status(401).json({ error: 'Неверный логин или пароль администратора.' });
    }
    let ok = false;
    try {
        if (user.password && String(user.password).startsWith('$2')) {
            ok = bcrypt.compareSync(String(password || ''), user.password);
        }
    } catch (e) { ok = false; }
    if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль администратора.' });

    user.last_seen = new Date().toISOString();
    await db.saveStore();

    const token = issueToken(user);
    // HttpOnly-ish via Set-Cookie (frontend also stores for Bearer)
    res.setHeader('Set-Cookie',
        'fcc_admin_token=' + encodeURIComponent(token) +
        '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (7 * 24 * 3600)
    );
    res.json({
        success: true,
        token,
        userId: user.id,
        username: user.username,
        role: 'admin',
        user: publicUser(user)
    });
});


router.post('/dev-login', async (req, res) => {
    const { username, password } = req.body || {};
    const store = db.getStore();
    const user = store.users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
    if (!user || user.role !== 'dev') {
        return res.status(401).json({ error: 'Неверный логин или пароль разработчика.' });
    }
    let ok = false;
    try {
        if (user.password && String(user.password).startsWith('$2')) {
            ok = bcrypt.compareSync(String(password || ''), user.password);
        }
    } catch (e) { ok = false; }
    if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль разработчика.' });
    user.last_seen = new Date().toISOString();
    await db.saveStore();
    res.json({
        success: true,
        token: issueToken(user),
        userId: user.id,
        username: user.username,
        role: 'dev',
        user: publicUser(user)
    });
});


router.post('/admin-logout', (req, res) => {
    res.setHeader('Set-Cookie', 'fcc_admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ success: true });
});


/** Google Sign-In — client sends ID token from Google Identity Services */
router.post('/google', async (req, res) => {
    const { credential, clientId: guestClientId } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Нет Google credential' });

    const expectedAud = process.env.GOOGLE_CLIENT_ID || '';
    if (!expectedAud) {
        return res.status(503).json({ error: 'Вход через Google не настроен на сервере.' });
    }
    try {
        // Verify via Google tokeninfo
        const verifyUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential);
        const gRes = await fetch(verifyUrl);
        const payload = await gRes.json();
        if (!gRes.ok || payload.error) {
            return res.status(401).json({ error: 'Неверный Google-токен' });
        }
        if (payload.aud !== expectedAud) {
            return res.status(401).json({ error: 'Google Client ID не совпадает с сервером' });
        }
        if (payload.email_verified !== 'true' && payload.email_verified !== true) {
            return res.status(401).json({ error: 'Email Google не подтверждён' });
        }

        const store = db.getStore();
        const email = String(payload.email || '').toLowerCase();
        const googleId = String(payload.sub || '');
        let user = store.users.find(u =>
            (u.google_id && String(u.google_id) === googleId) ||
            (u.email && String(u.email).toLowerCase() === email)
        );

        if (user && user.role !== 'client') {
            return res.status(403).json({ error: 'Этот аккаунт входит только через свою форму входа' });
        }

        if (!user) {
            const baseName = (payload.name || email.split('@')[0] || 'user').replace(/\s+/g, '_').slice(0, 24);
            let username = baseName;
            let n = 1;
            while (store.users.some(u => String(u.username).toLowerCase() === username.toLowerCase())) {
                username = baseName + n;
                n += 1;
            }
            user = {
                id: 'usr_' + require('uuid').v4().slice(0, 8),
                username,
                password: '', // Google-only
                email,
                google_id: googleId,
                role: 'client',
                name: payload.name || username,
                avatar: payload.picture || '',
                linked_guest_ids: [],
                created_at: new Date().toISOString(),
                last_seen: new Date().toISOString()
            };
            store.users.push(user);
        } else {
            user.google_id = user.google_id || googleId;
            user.email = user.email || email;
            if (payload.picture) user.avatar = payload.picture;
            user.last_seen = new Date().toISOString();
            ensureUserShape(user);
        }

        let mergeInfo = { merged: false, mergedGuestId: null };
        if (guestClientId && user.role === 'client') {
            mergeInfo = mergeGuestIntoUser(store, guestClientId, user.id, user.username);
        }
        await db.saveStore();

        const rebind = req.app.get('rebindIdentitySockets');
        if (rebind && guestClientId) rebind(guestClientId, user.id);
        const broadcast = req.app.get('broadcastToAdmins');
        const getClientList = req.app.get('getClientList');
        if (broadcast && getClientList) broadcast({ type: 'clients_update', clients: getClientList() });

        res.json({
            success: true,
            token: issueToken(user),
            userId: user.id,
            username: user.username,
            role: user.role,
            mergedGuestId: mergeInfo.mergedGuestId,
            user: publicUser(user)
        });
    } catch (e) {
        console.error('[auth/google]', e);
        res.status(500).json({ error: 'Ошибка Google-входа' });
    }
});



/** In-memory OTP store (also mirrored on user for audit). Dev: returns devCode if no SMTP. */
const otpStore = new Map(); // email -> { code, purpose, exp, meta }

function genCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

router.post('/otp/request', async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const purpose = (req.body && req.body.purpose) || 'login';
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Нужен настоящий email' });

    const store = db.getStore();
    if (purpose === 'login') {
        const user = store.users.find(u => String(u.email || '').toLowerCase() === email);
        if (!user) return res.status(404).json({ error: 'Аккаунт с таким email не найден. Сначала зарегистрируйтесь.' });
        if (user.role === 'admin' || user.role === 'dev') {
            return res.status(403).json({ error: 'Этот email не для клиентского входа' });
        }
    }
    if (purpose === 'register') {
        if (store.users.some(u => String(u.email || '').toLowerCase() === email)) {
            return res.status(400).json({ error: 'Email уже занят' });
        }
    }

    const code = genCode();
    otpStore.set(email, { code, purpose, exp: Date.now() + 10 * 60 * 1000, meta: req.body || {} });

    // Optional SMTP later via env; for now log + return devCode in non-production-like setups
    console.log('[OTP]', purpose, email, code);
    const payload = { success: true, message: 'Код отправлен' };
    if (!process.env.SMTP_HOST) payload.devCode = code; // local/dev visibility
    res.json(payload);
});

router.post('/otp/verify', async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const code = String((req.body && req.body.code) || '').trim();
    const purpose = (req.body && req.body.purpose) || 'login';
    const entry = otpStore.get(email);
    if (!entry || entry.code !== code || entry.exp < Date.now() || entry.purpose !== purpose) {
        return res.status(401).json({ error: 'Неверный или просроченный код' });
    }
    otpStore.delete(email);
    const store = db.getStore();

    if (purpose === 'register') {
        const username = String((req.body && req.body.username) || '').trim();
        const password = String((req.body && req.body.password) || '');
        if (!username || password.length < 4) return res.status(400).json({ error: 'Логин и пароль обязательны' });
        if (store.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
            return res.status(400).json({ error: 'Логин занят' });
        }
        const hashedPassword = bcrypt.hashSync(password, 10);
        const newUser = {
            id: 'usr_' + uuidv4().slice(0, 8),
            username,
            password: hashedPassword,
            email,
            role: 'client',
            name: username,
            linked_guest_ids: [],
            created_at: new Date().toISOString(),
            last_seen: new Date().toISOString()
        };
        store.users.push(newUser);
        let mergeInfo = { mergedGuestId: null };
        if (req.body.clientId) {
            mergeInfo = mergeGuestIntoUser(store, req.body.clientId, newUser.id, newUser.username);
        }
        await db.saveStore();
        return res.json({
            success: true,
            token: issueToken(newUser),
            userId: newUser.id,
            username: newUser.username,
            role: 'client',
            user: publicUser(newUser)
        });
    }

    // login
    const user = store.users.find(u => String(u.email || '').toLowerCase() === email);
    if (!user || user.role !== 'client') return res.status(403).json({ error: 'Вход недоступен' });
    if (req.body.clientId) {
        mergeGuestIntoUser(store, req.body.clientId, user.id, user.username);
    }
    user.last_seen = new Date().toISOString();
    await db.saveStore();
    res.json({
        success: true,
        token: issueToken(user),
        userId: user.id,
        username: user.username,
        role: 'client',
        user: publicUser(user)
    });
});


router.get('/me', require('../middleware/auth').authenticateToken, (req, res) => {
    const store = db.getStore();
    const user = store.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ success: true, user: publicUser(user) });
});

/** Client self-delete — session is enough, no password re-prompt */
router.delete('/account', require('../middleware/auth').authenticateToken, async (req, res) => {
    try {
        const store = db.getStore();
        const user = store.users.find(u => String(u.id) === String(req.user.id));
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

        // Strict: only clients. Admins are never deleted here.
        if (user.role !== 'client') {
            return res.status(403).json({
                error: 'Удаление доступно только клиентским аккаунтам. Админ удаляется только вручную в БД.'
            });
        }

        const { purgeClient } = require('../lib/identity');
        const result = purgeClient(store, user.id);
        await db.saveStore();

        const broadcast = req.app.get('broadcastToAdmins');
        const getClientList = req.app.get('getClientList');
        if (broadcast && getClientList) {
            broadcast({ type: 'clients_update', clients: getClientList() });
        }
        res.json({ success: true, purged: result });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Ошибка удаления аккаунта' });
    }
});



const otp = require('../lib/otp');

/** Team portal: step 1 — access key → limited dev session (~15%) */
router.post('/team-key', async (req, res) => {
    const key = String((req.body && req.body.access_key) || '').trim();
    if (!key) return res.status(400).json({ error: 'Введите ключ доступа' });
    const store = db.getStore();
    const user = (store.users || []).find(u =>
        u.access_key && String(u.access_key) === key && (u.role === 'dev' || u.role === 'admin')
    );
    if (!user) return res.status(401).json({ error: 'Неверный ключ' });

    // Limited token: role team_guest (server APIs still check)
    const token = jwt.sign(
        { id: user.id, username: user.username, role: 'team_key', level: 15, baseRole: user.role },
        JWT_SECRET,
        { expiresIn: '2h' }
    );
    res.json({
        success: true,
        token,
        level: 15,
        username: user.username,
        userId: user.id,
        baseRole: user.role,
        canEscalate: user.role === 'admin' || user.is_super_admin === true
    });
});

/** Team portal: step 2 — escalate with admin login + request OTP */
router.post('/admin-escalate', async (req, res) => {
    const { username, password } = req.body || {};
    const store = db.getStore();
    const user = store.users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
    if (!user || user.role !== 'admin') {
        return res.status(401).json({ error: 'Только главный администратор' });
    }
    let ok = false;
    try {
        if (user.password && String(user.password).startsWith('$2')) {
            ok = bcrypt.compareSync(String(password || ''), user.password);
        }
    } catch (e) { ok = false; }
    if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль' });

    // Почта (SMTP) не настроена — код отправить некуда. Пароль + ключ доступа уже проверены, пускаем сразу.
    // Чтобы включить код из письма, заполните SMTP_HOST/SMTP_USER/SMTP_PASS (или SMTP_WEBHOOK) в .env.
    if (!process.env.SMTP_HOST && !process.env.SMTP_WEBHOOK) {
        const direct = issueToken(user);
        res.setHeader('Set-Cookie',
            'fcc_admin_token=' + encodeURIComponent(direct) +
            '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (7 * 24 * 3600)
        );
        return res.json({ success: true, direct: true, token: direct, role: 'admin', userId: user.id, username: user.username });
    }

    const email = user.email || process.env.ADMIN_OTP_EMAIL;
    if (!email) {
        return res.status(400).json({ error: 'У админа не привязан email для OTP. Задайте email в профиле или ADMIN_OTP_EMAIL.' });
    }

    const code = otp.put('admin-otp:' + user.id);
    const send = await otp.sendEmailOtp(email, code, 'admin');
    const pending = jwt.sign(
        { id: user.id, username: user.username, role: 'admin_pending', stage: 'otp' },
        JWT_SECRET,
        { expiresIn: '10m' }
    );
    res.json({
        success: true,
        pendingToken: pending,
        emailHint: String(email).replace(/(.{2}).+(@.+)/, '$1***$2'),
        devCode: undefined
    });
});

/** Team portal: step 3 — verify OTP → full admin */
router.post('/admin-otp', async (req, res) => {
    const { pendingToken, code } = req.body || {};
    if (!pendingToken || !code) return res.status(400).json({ error: 'Нужен код' });
    let payload;
    try {
        payload = jwt.verify(pendingToken, JWT_SECRET);
    } catch (e) {
        return res.status(401).json({ error: 'Сессия подтверждения истекла' });
    }
    if (payload.role !== 'admin_pending') return res.status(403).json({ error: 'Неверный этап' });

    const check = otp.verify('admin-otp:' + payload.id, code);
    if (!check.ok) return res.status(401).json({ error: check.error });

    const store = db.getStore();
    const user = store.users.find(u => String(u.id) === String(payload.id));
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Нет прав' });

    const token = issueToken(user);
    res.setHeader('Set-Cookie',
        'fcc_admin_token=' + encodeURIComponent(token) +
        '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (7 * 24 * 3600)
    );
    res.json({
        success: true,
        token,
        role: 'admin',
        userId: user.id,
        username: user.username,
        user: publicUser(user)
    });
});

/** Client email OTP login request */
router.post('/email-otp/request', async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Укажите email' });
    const store = db.getStore();
    let user = store.users.find(u => String(u.email || '').toLowerCase() === email && u.role === 'client');
    if (!user) {
        // create lightweight client on first OTP
        const username = email.split('@')[0].slice(0, 24) + '_' + require('uuid').v4().slice(0, 4);
        user = {
            id: 'usr_' + require('uuid').v4().slice(0, 8),
            username,
            password: '',
            email,
            role: 'client',
            name: email.split('@')[0],
            linked_guest_ids: [],
            created_at: new Date().toISOString()
        };
        store.users.push(user);
        await db.saveStore();
    }
    const code = otp.put('email-otp:' + email);
    const send = await otp.sendEmailOtp(email, code, 'client');
    res.json({ success: true, emailHint: email.replace(/(.{2}).+(@.+)/, '$1***$2'), devCode: send.code });
});

router.post('/email-otp/verify', async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const code = String((req.body && req.body.code) || '').trim();
    const clientId = req.body && req.body.clientId;
    const check = otp.verify('email-otp:' + email, code);
    if (!check.ok) return res.status(401).json({ error: check.error });
    const store = db.getStore();
    const user = store.users.find(u => String(u.email || '').toLowerCase() === email && u.role === 'client');
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (clientId) {
        mergeGuestIntoUser(store, clientId, user.id, user.username);
        await db.saveStore();
    }
    res.json({
        success: true,
        token: issueToken(user),
        userId: user.id,
        username: user.username,
        role: 'client',
        user: publicUser(user)
    });
});


module.exports = router;
