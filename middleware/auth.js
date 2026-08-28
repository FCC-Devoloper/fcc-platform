const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fcc_secret_key_2026';

function extractToken(req) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (authHeader && String(authHeader).startsWith('Bearer ')) {
        return String(authHeader).slice(7);
    }
    if (req.query && req.query.token) return String(req.query.token);
    if (req.body && req.body.token) return String(req.body.token);
    return null;
}

function authenticateToken(req, res, next) {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Доступ запрещен. Токен отсутствует.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен.' });
        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Требуются права администратора.' });
    }
}

function optionalAuth(req, res, next) {
    const token = extractToken(req);
    if (!token) return next();
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err) req.user = user;
        next();
    });
}

function verifyWsToken(token) {
    if (!token) return null;
    try {
        return jwt.verify(token, JWT_SECRET);
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
