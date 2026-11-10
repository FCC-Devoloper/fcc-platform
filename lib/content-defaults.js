'use strict';
// Единый список редактируемых текстов сайта: ключ, подпись в админке, тип, значение по умолчанию.
// Админка строит форму из этого списка, сайт берёт значения через /api/content.
// Если в админке поле очистить — сайт вернёт значение по умолчанию (то, что в HTML).

const GROUPS = [
    {
        id: 'hero', title: 'Главный экран', fields: [
            { key: 'hero.tag', label: 'Верхний тег', type: 'text', def: '[ РАЗРАБОТКА ПОД КЛЮЧ ]' },
            { key: 'hero.title', label: 'Главный заголовок', type: 'text', def: 'Создаём цифровую инфраструктуру будущего' },
            { key: 'hero.description', label: 'Описание', type: 'textarea', def: 'Веб-сервисы, архитектура высоконагруженных систем, Telegram-боты и 3D-интерфейсы под ключ.' },
            { key: 'hero.primaryButton', label: 'Кнопка «Заказать»', type: 'text', def: 'Заказать проект' },
            { key: 'hero.chatButton', label: 'Кнопка «Чат»', type: 'text', def: 'Чат с поддержкой' },
            { key: 'hero.pythonButton', label: 'Кнопка «Обучение»', type: 'text', def: 'Хочу учить Python' }
        ]
    },
    {
        id: 'about', title: 'О нас', fields: [
            { key: 'about.kicker', label: 'Маленький заголовок', type: 'text', def: 'О студии' },
            { key: 'about.title', label: 'Заголовок', type: 'text', def: 'Fast Coding Crew — небольшая команда, которая делает цифровые продукты от идеи до запуска' },
            { key: 'about.text1', label: 'Абзац 1 (кто мы)', type: 'textarea', def: 'Мы — студия разработки из Таджикистана. Делаем сайты и веб-сервисы, Telegram-боты, интерактивные 3D-интерфейсы и внутренние системы для бизнеса. Работаем напрямую с заказчиком: без цепочки менеджеров, вы общаетесь с теми, кто пишет код.' },
            { key: 'about.text2', label: 'Абзац 2 (как работаем)', type: 'textarea', def: 'Каждая заявка попадает к диспетчеру, который подбирает разработчика под задачу. Статус заказа виден в личном кабинете, а любой вопрос можно задать в чате прямо на сайте. Перед стартом согласуем объём, сроки и стоимость — без скрытых платежей.' },
            { key: 'about.text3', label: 'Абзац 3 (образование)', type: 'textarea', def: 'Отдельное направление студии — Learning Center: обучаем школьников и начинающих программированию на практических задачах, чтобы они могли делать реальные проекты.' },
            { key: 'about.value1.title', label: 'Принцип 1 — заголовок', type: 'text', def: 'Прозрачность' },
            { key: 'about.value1.text', label: 'Принцип 1 — текст', type: 'textarea', def: 'Понятные сроки, этапы и цена. Вы всегда знаете, на каком этапе проект.' },
            { key: 'about.value2.title', label: 'Принцип 2 — заголовок', type: 'text', def: 'Качество кода' },
            { key: 'about.value2.text', label: 'Принцип 2 — текст', type: 'textarea', def: 'Пишем так, чтобы проект можно было развивать и поддерживать, а не переписывать с нуля.' },
            { key: 'about.value3.title', label: 'Принцип 3 — заголовок', type: 'text', def: 'Поддержка после запуска' },
            { key: 'about.value3.text', label: 'Принцип 3 — текст', type: 'textarea', def: 'Не бросаем проект после сдачи: исправляем ошибки, обновляем и дорабатываем.' }
        ]
    },
    {
        id: 'stats', title: 'Цифры о нас', fields: [
            { key: 'stats.1.value', label: 'Цифра 1 — значение', type: 'text', def: '4' },
            { key: 'stats.1.label', label: 'Цифра 1 — подпись', type: 'text', def: 'направления работы' },
            { key: 'stats.2.value', label: 'Цифра 2 — значение', type: 'text', def: '24/7' },
            { key: 'stats.2.label', label: 'Цифра 2 — подпись', type: 'text', def: 'чат и приём заявок' },
            { key: 'stats.3.value', label: 'Цифра 3 — значение', type: 'text', def: '4' },
            { key: 'stats.3.label', label: 'Цифра 3 — подпись', type: 'text', def: 'темы оформления сайта' },
            { key: 'stats.4.value', label: 'Цифра 4 — значение', type: 'text', def: '100%' },
            { key: 'stats.4.label', label: 'Цифра 4 — подпись', type: 'text', def: 'работа под ключ' }
        ]
    },
    {
        id: 'services', title: 'Услуги', fields: [
            { key: 'services.title', label: 'Заголовок раздела', type: 'text', def: 'Наши компетенции' },
            { key: 'services.subtitle', label: 'Подзаголовок', type: 'text', def: 'Решаем сложные технические задачи без потери визуальной эстетики' },
            { key: 'services.1.title', label: 'Услуга 1 — название', type: 'text', def: 'Веб-разработка' },
            { key: 'services.1.text', label: 'Услуга 1 — описание', type: 'textarea', def: 'Сайты, лендинги и веб-приложения: быстрая вёрстка, удобная админка, серверная часть на Node.js и Python.' },
            { key: 'services.2.title', label: 'Услуга 2 — название', type: 'text', def: 'Telegram-боты и AI' },
            { key: 'services.2.text', label: 'Услуга 2 — описание', type: 'textarea', def: 'Боты для приёма заявок, поддержки и продаж, интеграция с нейросетями, автоматизация рутины.' },
            { key: 'services.3.title', label: 'Услуга 3 — название', type: 'text', def: '3D и WebGL' },
            { key: 'services.3.text', label: 'Услуга 3 — описание', type: 'textarea', def: 'Интерактивная графика прямо в браузере: витрины, визуализации, нестандартные интерфейсы.' },
            { key: 'services.4.title', label: 'Услуга 4 — название', type: 'text', def: 'Проекты «под ключ»' },
            { key: 'services.4.text', label: 'Услуга 4 — описание', type: 'textarea', def: 'Полный цикл: проектирование, база данных, API, запуск на сервере и дальнейшая техподдержка.' }
        ]
    },
    {
        id: 'process', title: 'Как мы работаем', fields: [
            { key: 'process.title', label: 'Заголовок раздела', type: 'text', def: 'Как мы работаем' },
            { key: 'process.subtitle', label: 'Подзаголовок', type: 'text', def: 'Четыре понятных шага от заявки до запуска' },
            { key: 'process.1.title', label: 'Шаг 1 — название', type: 'text', def: 'Заявка' },
            { key: 'process.1.text', label: 'Шаг 1 — описание', type: 'textarea', def: 'Вы оставляете заявку на сайте или пишете в чат и описываете задачу своими словами.' },
            { key: 'process.2.title', label: 'Шаг 2 — название', type: 'text', def: 'Согласование' },
            { key: 'process.2.text', label: 'Шаг 2 — описание', type: 'textarea', def: 'Диспетчер уточняет детали, называет сроки и стоимость, подбирает разработчика.' },
            { key: 'process.3.title', label: 'Шаг 3 — название', type: 'text', def: 'Разработка' },
            { key: 'process.3.text', label: 'Шаг 3 — описание', type: 'textarea', def: 'Делаем проект по этапам. Статус заявки можно смотреть в личном кабинете.' },
            { key: 'process.4.title', label: 'Шаг 4 — название', type: 'text', def: 'Запуск и поддержка' },
            { key: 'process.4.text', label: 'Шаг 4 — описание', type: 'textarea', def: 'Передаём результат, помогаем запустить и остаёмся на связи после сдачи.' }
        ]
    },
    {
        id: 'sections', title: 'Заголовки разделов', fields: [
            { key: 'projects.title', label: 'Проекты — заголовок', type: 'text', def: 'Избранные проекты' },
            { key: 'projects.subtitle', label: 'Проекты — подзаголовок', type: 'text', def: 'Работы студии: что сделали, на чём и что получилось' },
            { key: 'news.title', label: 'Новости — заголовок', type: 'text', def: 'Новости и акции' },
            { key: 'news.subtitle', label: 'Новости — подзаголовок', type: 'text', def: 'Обновления, события и актуальные предложения FCC' },
            { key: 'plans.title', label: 'Планы — заголовок', type: 'text', def: 'Наши планы' },
            { key: 'plans.subtitle', label: 'Планы — подзаголовок', type: 'text', def: 'Дорожная карта FCC — живой список' },
            { key: 'team.title', label: 'Команда — заголовок', type: 'text', def: 'Команда FCC' },
            { key: 'team.subtitle', label: 'Команда — подзаголовок', type: 'text', def: 'Разработчики студии — навыки и связь через заявку' },
            { key: 'features.title', label: 'Возможности — заголовок', type: 'text', def: 'Возможности FCC' },
            { key: 'features.subtitle', label: 'Возможности — подзаголовок', type: 'text', def: 'Инструменты, которые уже доступны на сайте' }
        ]
    },
    {
        id: 'cta', title: 'Призыв к действию и подвал', fields: [
            { key: 'cta.title', label: 'Призыв — заголовок', type: 'text', def: 'Готовы воплотить идею в код?' },
            { key: 'cta.subtitle', label: 'Призыв — текст', type: 'textarea', def: 'Напишите нам в чат или оставьте заявку прямо сейчас.' },
            { key: 'footer.about', label: 'Подвал — коротко о нас', type: 'textarea', def: 'Fast Coding Crew — студия веб-разработки, Telegram-ботов и 3D-интерфейсов из Таджикистана.' },
            { key: 'footer.location', label: 'Подвал — где мы', type: 'text', def: 'Таджикистан, Гиссар' },
            { key: 'footer.copyright', label: 'Подвал — копирайт', type: 'text', def: '© 2026 Fast Coding Crew. Все права защищены.' }
        ]
    },
    {
        id: 'contacts', title: 'Контакты', fields: [
            { key: 'contact.telegram', label: 'Telegram (ссылка или @имя)', type: 'text', def: '@fcc_studio' },
            { key: 'contact.whatsapp', label: 'WhatsApp (номер)', type: 'text', def: '+992 00 000 00 00' },
            { key: 'contact.email', label: 'Email', type: 'text', def: 'info@example.com' },
            { key: 'contact.phone', label: 'Телефон', type: 'text', def: '+992 00 000 00 00' },
            { key: 'contact.instagram', label: 'Instagram (@имя)', type: 'text', def: '@fcc_studio' },
            { key: 'contact.hours', label: 'Режим работы', type: 'text', def: '24/7 диспетчерская' }
        ]
    },
    {
        id: 'seo', title: 'Поиск и соцсети', fields: [
            { key: 'seo.title', label: 'Заголовок вкладки браузера', type: 'text', def: 'FCC MATRIX — Цифровая инфраструктура будущего' },
            { key: 'seo.description', label: 'Описание для поисковиков', type: 'textarea', def: 'Fast Coding Crew — разработка сайтов, Telegram-ботов и 3D-интерфейсов под ключ.' }
        ]
    }
];

const FIELDS = {};
GROUPS.forEach(g => g.fields.forEach(f => { FIELDS[f.key] = f; }));

// Старые ключи, которые использовались раньше → новые
const LEGACY_KEYS = {
    hero_tag: 'hero.tag',
    hero_title: 'hero.title',
    hero_desc: 'hero.description'
};

// Разрешённые действия кнопки и стили (всё остальное отбрасывается)
const ACTIONS = ['', 'modal', 'url', 'scroll', 'chat'];
const ALIGNS = ['left', 'center', 'right'];

function cleanUrl(url) {
    const v = String(url || '').trim().slice(0, 500);
    if (!v) return '';
    if (/^(https?:\/\/|mailto:|tel:|#|\/)/i.test(v)) return v;
    return '';
}

function cleanStyles(styles) {
    const out = {};
    if (!styles || typeof styles !== 'object') return out;
    if (typeof styles.color === 'string' && /^#[0-9a-f]{6}$/i.test(styles.color)) out.color = styles.color;
    const size = Number(styles.fontSize);
    if (Number.isFinite(size) && size >= 8 && size <= 120) out.fontSize = String(Math.round(size));
    if (ALIGNS.includes(styles.textAlign)) out.textAlign = styles.textAlign;
    return out;
}

module.exports = { GROUPS, FIELDS, LEGACY_KEYS, ACTIONS, cleanUrl, cleanStyles };
