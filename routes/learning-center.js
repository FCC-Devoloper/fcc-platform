const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { optionalAuth } = require('../middleware/auth');

const DEFAULT_CENTER_LOCATION = { city: 'Гиссар', country: 'Таджикистан', village: '', address: '', latitude: 38.52504, longitude: 68.55124 };

const TARIFFS = {
    basic: { name: 'Базовый', oldPrice: 250, price: 187.5, lessons: '4 рӯз дар ҳафта', duration: '60–90 дақиқа', details: 'Мантиқ + Амалия' },
    standard: { name: 'Стандарт', oldPrice: 300, price: 225, lessons: '6 рӯз дар ҳафта', duration: '60–90 дақиқа', details: 'Ҳамарӯза' },
    intensive: { name: 'Интенсив', oldPrice: 500, price: 375, lessons: '6 рӯз дар ҳафта', duration: '2 соат', details: 'Компютер + Барномасозӣ' }
};

function getCenterLocation() {
    try {
        const settings = db.getData().settings || {};
        const raw = settings.learning_center_map || {};
        const latitude = Number(raw.latitude);
        const longitude = Number(raw.longitude);
        return {
            city: clean(raw.city || DEFAULT_CENTER_LOCATION.city, 120),
            country: clean(raw.country || DEFAULT_CENTER_LOCATION.country, 120),
            village: clean(raw.village || DEFAULT_CENTER_LOCATION.village, 120),
            address: clean(raw.address || DEFAULT_CENTER_LOCATION.address, 250),
            latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : DEFAULT_CENTER_LOCATION.latitude,
            longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : DEFAULT_CENTER_LOCATION.longitude
        };
    } catch (e) {
        return { ...DEFAULT_CENTER_LOCATION };
    }
}

function clean(value, max = 1000) {
    return String(value == null ? '' : value).trim().slice(0, max);
}

function detectBrowser(userAgent) {
    const ua = String(userAgent || '');
    if (/Edg\//i.test(ua)) return 'Edge';
    if (/OPR\//i.test(ua)) return 'Opera';
    if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return 'Chrome';
    if (/Firefox\//i.test(ua)) return 'Firefox';
    if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
    if (/MSIE|Trident\//i.test(ua)) return 'Internet Explorer';
    return 'Другое';
}

function detectDevice(userAgent) {
    const ua = String(userAgent || '');
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    if (/mobile|android|iphone|ipod/i.test(ua)) return 'mobile';
    return 'desktop';
}

router.get('/tariffs', async (req, res) => {
    const geoResolver = req.app.get('resolveLearningLocation');
    if (geoResolver) {
        const geo = await geoResolver(req);
        if (!geo.allowed) return res.status(404).json({ error: 'Learning Center доступен только в Гиссаре и Душанбе.' });
    }
    res.json({ success: true, discountPercent: 25, location: getCenterLocation(), tariffs: TARIFFS });
});

router.post('/apply', optionalAuth, async (req, res) => {
    const geoResolver = req.app.get('resolveLearningLocation');
    if (geoResolver) {
        const geo = await geoResolver(req);
        if (!geo.allowed) return res.status(403).json({ error: 'Запись доступна только посетителям из Гиссара и Душанбе.' });
    }
    const body = req.body || {};
    const studentName = clean(body.studentName, 120);
    const parentName = clean(body.parentName, 120);
    const phone = clean(body.phone, 40);
    const email = clean(body.email, 160);
    const tariffId = clean(body.tariff, 30).toLowerCase();
    const village = clean(body.village, 120);
    const address = clean(body.address, 250);
    const comment = clean(body.comment, 1000);
    const consent = !!body.consent;

    if (!studentName || !parentName || !phone || !tariffId || !consent) {
        return res.status(400).json({ error: 'Заполните имя ученика, имя родителя, телефон, тариф и подтвердите согласие.' });
    }
    if (!TARIFFS[tariffId]) return res.status(400).json({ error: 'Неизвестный тариф.' });
    if (phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Проверьте номер телефона.' });

    try {
        const store = db.getData();
        if (!Array.isArray(store.learning_applications)) store.learning_applications = [];

        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const duplicate = store.learning_applications.find(a =>
            !a.deleted_at &&
            String(a.phone || '').replace(/\D/g, '') === phone.replace(/\D/g, '') &&
            new Date(a.created_at || 0).getTime() > sevenDaysAgo &&
            ['new', 'contacted'].includes(a.status)
        );
        if (duplicate) {
            return res.status(409).json({ error: 'Заявка с этим номером уже есть. Мы свяжемся с вами.' });
        }

        const tariff = TARIFFS[tariffId];
        const now = new Date().toISOString();
        const application = {
            id: 'lc_' + uuidv4().slice(0, 10),
            student_name: studentName,
            parent_name: parentName,
            phone,
            email,
            tariff: tariffId,
            tariff_name: tariff.name,
            old_price: tariff.oldPrice,
            price: tariff.price,
            discount_percent: 25,
            location: {
                ...getCenterLocation(),
                village: village || '',
                address: address || getCenterLocation().address || ''
            },
            comment,
            consent: true,
            status: 'new',
            created_at: now,
            updated_at: now,
            browser: detectBrowser(req.headers['user-agent']),
            device: detectDevice(req.headers['user-agent']),
            user_agent: clean(req.headers['user-agent'], 500),
            language: clean(req.headers['accept-language'], 120),
            referrer: clean(req.headers.referer || req.headers.referrer, 500),
            page: clean(body.page || '', 300),
            timezone: clean(body.timezone || '', 100),
            screen: clean(body.screen || '', 50),
            client_id: clean(body.clientId || '', 100),
            user_id: req.user && req.user.role === 'client' ? req.user.id : null,
            history: [{ status: 'new', at: now, by: 'client' }]
        };

        store.learning_applications.push(application);
        await db.saveDB();

        const broadcast = req.app.get('broadcastToAdmins');
        if (broadcast) broadcast({ type: 'learning_center_update', application });

        res.json({ success: true, applicationId: application.id, application: { ...application, user_agent: undefined } });
    } catch (e) {
        console.error('[Learning Center] apply error', e);
        res.status(500).json({ error: 'Не удалось сохранить заявку.' });
    }
});

router.get('/status/:id', optionalAuth, async (req, res) => {
    const geoResolver = req.app.get('resolveLearningLocation');
    if (geoResolver) {
        const geo = await geoResolver(req);
        if (!geo.allowed) return res.status(404).json({ error: 'Раздел недоступен.' });
    }
    const store = db.getData();
    const item = (store.learning_applications || []).find(a => String(a.id) === String(req.params.id));
    if (!item || item.deleted_at) return res.status(404).json({ error: 'Заявка не найдена.' });
    if (req.user && req.user.role === 'client' && item.user_id && String(item.user_id) !== String(req.user.id)) {
        return res.status(403).json({ error: 'Нет доступа к этой заявке.' });
    }
    if (!req.user && item.client_id && req.headers['x-client-id'] && String(item.client_id) !== String(req.headers['x-client-id'])) {
        return res.status(403).json({ error: 'Нет доступа к этой заявке.' });
    }
    const safe = { ...item, user_agent: undefined };
    res.json({ success: true, status: item.status, application: safe });
});

module.exports = { router, TARIFFS };
