const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { migrateIdentities } = require('./lib/identity');
const bcrypt = require('bcryptjs');
const { LEGACY_KEYS } = require('./lib/content-defaults');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'fcc_data.json');
const BACKUP_FILE = path.join(DATA_DIR, 'fcc_data.json.bak');

function bootstrapDatabaseFromEnvironment() {
    const encoded = String(process.env.FCC_BOOTSTRAP_DATA_GZIP_B64 || '').trim();
    if (!encoded || fs.existsSync(DATA_FILE)) return false;

    const raw = zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.users) || !Array.isArray(parsed.projects)) {
        throw new Error('FCC_BOOTSTRAP_DATA_GZIP_B64 contains an invalid FCC database');
    }

    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tempFile = DATA_FILE + '.bootstrap.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(parsed, null, 2), 'utf8');
    fs.renameSync(tempFile, DATA_FILE);
    console.log('[DB] Existing FCC data imported into persistent storage.');
    return true;
}

let store = {
    site_texts: {},
    projects: [],
    news: [],
    promotions: [],
    users: [],
    orders: [],
    guests: [],
    messages: [],
    comments: [],
    team: [],
    plans: [],
    settings: {},
    notifications: [],
    learning_applications: []
};

function readStoreFile() {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
}

function initDB() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        bootstrapDatabaseFromEnvironment();
        if (fs.existsSync(DATA_FILE)) {
            let parsed;
            try {
                parsed = readStoreFile();
            } catch (parseErr) {
                // Файл повреждён: сохраняем его копию и пробуем поднять из резервной копии.
                const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                try { fs.copyFileSync(DATA_FILE, DATA_FILE + '.corrupt-' + stamp); } catch (e) {}
                console.error('[DB] fcc_data.json повреждён, копия сохранена как .corrupt-' + stamp);
                if (fs.existsSync(BACKUP_FILE)) {
                    parsed = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
                    console.error('[DB] Данные восстановлены из fcc_data.json.bak');
                } else {
                    console.error('[DB] Резервной копии нет. Сервер остановлен, чтобы не затереть данные.');
                    process.exit(1);
                }
            }
            store = { ...store, ...parsed };
            if (!Array.isArray(store.projects)) store.projects = [];
            if (!Array.isArray(store.news)) store.news = [];
            if (!Array.isArray(store.promotions)) store.promotions = [];
            if (!Array.isArray(store.users)) store.users = [];
            if (!Array.isArray(store.orders)) store.orders = [];
            if (!Array.isArray(store.guests)) store.guests = [];
            if (!Array.isArray(store.messages)) store.messages = [];
            if (!Array.isArray(store.notifications)) store.notifications = [];
            if (!Array.isArray(store.learning_applications)) store.learning_applications = [];
            if (!store.site_texts || typeof store.site_texts !== 'object') store.site_texts = {};
            if (!Array.isArray(store.plans)) store.plans = [];
            if (!Array.isArray(store.team)) store.team = [];
            if (!store.settings || typeof store.settings !== 'object') store.settings = {};
            if (!store.settings.learning_center_map || typeof store.settings.learning_center_map !== 'object') {
                store.settings.learning_center_map = { city: 'Гиссар', country: 'Таджикистан', village: '', address: '', latitude: 38.52504, longitude: 68.55124 };
            }

            if (!store.plans.length) {
                store.plans = [
                    { id: 'plan-python', title_ru: 'Python Learning Module', status: 'now', eta: 'Q3 2026', description_ru: 'Полноценный трек обучения Python внутри FCC.' },
                    { id: 'plan-visual', title_ru: 'Visual Emulator 2.0', status: 'now', eta: 'Q3 2026', description_ru: 'Клик-редактор всего сайта, кнопки и медиа.' },
                    { id: 'plan-bots', title_ru: 'Telegram Ops Bot', status: 'next', eta: 'Q4 2026', description_ru: 'Заявки и чат в Telegram для диспетчера.' },
                    { id: 'plan-3d', title_ru: 'WebGL showroom', status: 'later', eta: '2027', description_ru: '3D-витрина проектов FCC.' }
                ];
            }
            store.projects.forEach(p => {
                if (!p.reactions) p.reactions = { like: 0, fire: 0, heart: 0, wow: 0 };
                p.features = toList(p.features);
                if (p.is_published === undefined) p.is_published = 1;
                if (p.category === undefined) p.category = '';
                if (p.sort === undefined) p.sort = 0;
            });
            store.news.forEach(n => {
                if (!n.reactions) n.reactions = { like: 0, fire: 0, heart: 0, wow: 0 };
                if (n.is_published === undefined) n.is_published = 1;
                if (n.category === undefined) n.category = '';
                if (n.pinned === undefined) n.pinned = 0;
            });

            // Старые ключи текстов (hero_tag → hero.tag) и заглушки контактов
            Object.keys(LEGACY_KEYS).forEach((oldKey) => {
                const item = store.site_texts[oldKey];
                const newKey = LEGACY_KEYS[oldKey];
                if (item && !store.site_texts[newKey]) store.site_texts[newKey] = item;
                delete store.site_texts[oldKey];
            });
            ['contact.email', 'contact.phone'].forEach((k) => {
                const it = store.site_texts[k];
                if (it && /fcc\.replace|^\+000/.test(String(it.value_ru || ''))) it.value_ru = it.value_en = '';
            });

            try {
                const stale = !fs.existsSync(BACKUP_FILE) ||
                    Date.now() - fs.statSync(BACKUP_FILE).mtimeMs > 24 * 60 * 60 * 1000;
                if (stale) fs.copyFileSync(DATA_FILE, BACKUP_FILE);
            } catch (e) {}


            // Promo field migration: position, visibility, details_link
            (store.promotions || []).forEach((pr) => {
                if (!pr.position) pr.position = 'BOTTOM';
                if (!pr.visibility) pr.visibility = 'VISIBLE';
                if (pr.details_link === undefined) pr.details_link = '';
                if (pr.is_active === undefined) pr.is_active = 1;
            });


            (store.users || []).forEach((u) => {
                if ((u.role === 'dev' || u.role === 'admin') && !u.access_key) {
                    const { v4: uuidv4 } = require('uuid');
                    u.access_key = 'FCC-' + uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase();
                    console.log('[DB] access_key for', u.username, u.access_key);
                }
                if (u.role === 'admin' && !u.email) {
                    u.email = process.env.ADMIN_OTP_EMAIL || 'admin@fcc.local';
                }
            });

            // Hash any leftover plaintext passwords
            (store.users || []).forEach((u) => {
                if (u.password && !String(u.password).startsWith('$2')) {
                    try {
                        u.password = bcrypt.hashSync(String(u.password), 10);
                        console.log('[DB] hashed plaintext password for', u.username);
                    } catch (e) {}
                }
            });

            const report = migrateIdentities(store);
            (store.guests || []).forEach((g) => { g.is_online = 0; });
            if (!store.settings.identity_migrated_at) {
                store.settings.identity_migrated_at = new Date().toISOString();
                store.settings.identity_migration = report;
                console.log('[DB] identity migration', report);
            }

            seedDemoContent();
            saveDBSync();
            console.log('[DB] fcc_data.json загружен.');
        } else {
            console.log('[DB] fcc_data.json не найден. Создаю новый...');
            seedDemoContent();
            saveDBSync();
        }
    } catch (err) {
        console.error('[DB] Ошибка инициализации JSON БД:', err);
    }
}

function seedDemoContent() {
    if (!Array.isArray(store.promotions)) store.promotions = [];
    if (!store.promotions.length) {
        const start = new Date();
        const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        store.promotions.push({
            id: 'promo_launch',
            title_ru: 'Летний буст — первый проект',
            description_ru: 'Скидка на первый лендинг или Telegram-бота для новых клиентов FCC MATRIX.',
            discount: '-20%',
            target: 'Веб и боты',
            action_link: '#order',
            details_link: '',
            position: 'BOTTOM',
            visibility: 'VISIBLE',
            is_active: 1,
            start_date: start.toISOString().slice(0, 10),
            end_date: end.toISOString().slice(0, 10),
            created_at: new Date().toISOString()
        });
    }
    if (!Array.isArray(store.notifications)) store.notifications = [];
    if (!store.notifications.length) {
        store.notifications.push({
            id: 'notif_welcome',
            title: 'Диспетчерская FCC онлайн',
            tag: 'Система',
            type: 'system',
            date: new Date().toLocaleDateString('ru-RU'),
            text: 'Личный кабинет, чат и заявки теперь живут под одной записью клиента. История не теряется после регистрации.',
            created_at: new Date().toISOString(),
            target: 'all',
            target_type: 'all',
            target_id: null,
            expires_at: null,
            readBy: []
        });
    }
}

function toList(v) {
    if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
    return String(v || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);
}

function writeAtomicSync() {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
}

function saveDBSync() {
    try {
        writeAtomicSync();
    } catch (err) {
        console.error('[DB] Ошибка синхронной записи:', err);
    }
}

// Записи идут строго по очереди и через временный файл:
// два одновременных сохранения больше не портят fcc_data.json.
let saveQueued = false;
let saveRunning = null;

function saveDB() {
    if (saveRunning) {
        saveQueued = true;
        return saveRunning;
    }
    saveRunning = new Promise((resolve) => {
        setImmediate(() => {
            try {
                writeAtomicSync();
            } catch (err) {
                console.error('[DB] Ошибка записи:', err);
            }
            saveRunning = null;
            if (saveQueued) {
                saveQueued = false;
                saveDB().then(resolve);
            } else {
                resolve();
            }
        });
    });
    return saveRunning;
}

function setContent(key, value, extra) {
    if (!store.site_texts) store.site_texts = {};
    const prev = store.site_texts[key] || {};
    const next = { ...prev, value_ru: value, value_en: value };
    if (extra) {
        Object.keys(extra).forEach((k) => {
            if (extra[k] === undefined) return;
            if (extra[k] === null || extra[k] === '' || (typeof extra[k] === 'object' && !Object.keys(extra[k]).length)) delete next[k];
            else next[k] = extra[k];
        });
    }
    store.site_texts[key] = next;
    return next;
}

function deleteContent(key) {
    if (store.site_texts && store.site_texts[key]) {
        delete store.site_texts[key];
        return true;
    }
    return false;
}

function getContentValue(key, fallback) {
    const item = store.site_texts && store.site_texts[key];
    if (!item) return fallback;
    return item.value_ru != null ? item.value_ru : fallback;
}

const getData = () => store;

module.exports = {
    initDB,
    saveDB,
    saveDBSync,
    getData,
    getStore: getData,
    saveStore: saveDB,
    read: getData,
    setContent,
    deleteContent,
    toList,
    getContentValue
};
