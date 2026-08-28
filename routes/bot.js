const responses = [
    { keywords: ['цена', 'стоимость', 'прайс'], text: 'Стоимость проектов рассчитывается индивидуально. Оставьте заявку через форму или напишите диспетчеру!' },
    { keywords: ['сроки', 'время'], text: 'Простые боты и лендинги делаем за 3-5 дней. Сложные сервисы — от 2 недель.' },
    { keywords: ['стек', 'технологии'], text: 'Наш основной стек: Node.js, Express, Python, SQLite/PostgreSQL, WebGL и Vanilla JS.' }
];

function getBotReply(userMessage) {
    const lower = userMessage.toLowerCase();
    for (const item of responses) {
        if (item.keywords.some(kw => lower.includes(kw))) {
            return item.text;
        }
    }
    return 'Ваше сообщение перенаправлено диспетчеру. Он ответит при первой возможности!';
}

module.exports = { getBotReply };