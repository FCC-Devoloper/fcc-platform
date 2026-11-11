// Лёгкая защита без внешних зависимостей: заголовки + rate limit (в памяти).

function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.removeHeader('X-Powered-By');
    next();
}

function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, message = 'Слишком много попыток. Попробуйте позже.' } = {}) {
    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    }, windowMs).unref();

    return function (req, res, next) {
        const now = Date.now();
        const key = req.ip || 'unknown';
        let rec = hits.get(key);
        if (!rec || rec.reset <= now) rec = { count: 0, reset: now + windowMs };
        rec.count += 1;
        hits.set(key, rec);
        if (rec.count > max) {
            res.setHeader('Retry-After', Math.ceil((rec.reset - now) / 1000));
            return res.status(429).json({ error: message });
        }
        next();
    };
}

module.exports = { securityHeaders, rateLimit };
