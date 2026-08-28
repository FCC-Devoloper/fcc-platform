const fs = require('fs');
const path = require('path');
const { migrateIdentities } = require('./lib/identity');

const DATA_FILE = path.join(__dirname, 'data', 'fcc_data.json');
const BACKUP_FILE = path.join(__dirname, 'data', 'fcc_data.json.bak');

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
    notifications: []
};

function initDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            store = { ...store, ...parsed };
            if (!Array.isArray(store.projects)) store.projects = [];
            if (!Array.isArray(store.news)) store.news = [];
            if (!Array.isArray(store.promotions)) store.promotions = [];
            if (!Array.isArray(store.users)) store.users = [];
            if (!Array.isArray(store.orders)) store.orders = [];
            if (!Array.isArray(store.guests)) store.guests = [];
            if (!Array.isArray(store.messages)) store.messages = [];
            if (!Array.isArray(store.notifications)) store.notifications = [];
            if (!store.site_texts || typeof store.site_texts !== 'object') store.site_texts = {};
            if (!Array.isArray(store.plans)) store.plans = [];
            if (!Array.isArray(store.team)) store.team = [];
            if (!store.settings || typeof store.settings !== 'object') store.settings = {};

            if (!store.site_texts['contact.telegram']) {
                store.site_texts['contact.telegram'] = { value_ru: '@FCC_REPLACE_ME', value_en: '@FCC_REPLACE_ME' };
            }
            if (!store.site_texts['contact.email']) {
                store.site_texts['contact.email'] = { value_ru: 'hello@fcc.replace', value_en: 'hello@fcc.replace' };
            }
            if (!store.site_texts['contact.phone']) {
                store.site_texts['contact.phone'] = { value_ru: '+000 000 00 00', value_en: '+000 000 00 00' };
            }
            if (!store.site_texts['contact.hours']) {
                store.site_texts['contact.hours'] = { value_ru: '24/7 диспетчерская', value_en: '24/7 dispatch' };
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
                if (!p.features) p.features = [];
            });

            if (!fs.existsSync(BACKUP_FILE)) {
                try { fs.copyFileSync(DATA_FILE, BACKUP_FILE); } catch (e) {}
            }

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

function saveDBSync() {
    try {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
        console.error('[DB] Ошибка синхронной записи:', err);
    }
}

async function saveDB() {
    try {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        await fs.promises.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
        console.error('[DB] Ошибка асинхронной записи:', err);
    }
}

function setContent(key, value, extra) {
    if (!store.site_texts) store.site_texts = {};
    const prev = store.site_texts[key] || {};
    store.site_texts[key] = {
        ...prev,
        value_ru: value,
        value_en: value,
        ...(extra || {})
    };
    return store.site_texts[key];
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
    getContentValue
};
