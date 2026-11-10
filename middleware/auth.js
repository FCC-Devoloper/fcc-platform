const jwt = require('jsonwebtoken');
try { require('dotenv').config(); } catch (e) {}
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 24 || /change_me/i.test(JWT_SECRET)) {
    console.error('[FATAL] JWT_SECRET не задан или слишком короткий. Заполни .env (см. .env.example).');
    process.exit(1);
}

// Токен действует только пока пользователь существует в базе (удалённый аккаунт сразу теряет доступ)
function userExists(payload) {
    if (!payload || !payload.id) return false;
    try {
        const users = require('../db').getData().users || [];
        return users.some(u => String(u.id) === String(payload.id));
    } catch (e) { return true; }
}

function extractToken(req) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (authHeader && String(authHeader).startsWith('Bearer ')) {
        return String(authHeader).slice(7);
    }
    return null;
}

function authenticateToken(req, res, next) {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Доступ запрещен. Токен отсутствует.', code: 'auth_required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен.', code: 'auth_required' });
        if (!userExists(user)) return res.status(401).json({ error: 'Аккаунт не найден. Войдите заново.', code: 'auth_required' });
        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Требуются права администратора.', code: 'auth_required' });
    }
}

function optionalAuth(req, res, next) {
    const token = extractToken(req);
    if (!token) return next();
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err && userExists(user)) req.user = user;
        next();
    });
}

function verifyWsToken(token) {
    if (!token) return null;
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        return userExists(payload) ? payload : null;
    } catch (e) {
        return null;
    }
}

module.exports = {
    authenticateToken,
    requireAdmin,
    optionalAuth,
    verifyWsToken,
    JWT_SECRET
};
