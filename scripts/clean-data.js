// Удаляет тестовые данные: клиентов, заказы, чаты, гостей, уведомления.
// Сайт (тексты, проекты, новости, команда, планы) и админ остаются. Перед очисткой делается копия.
// Запуск (сервер остановить):  npm run clean-data
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'data', 'fcc_data.json');
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(file, file + '.backup-' + stamp);
const before = { users: (db.users || []).length, orders: (db.orders || []).length, messages: (db.messages || []).length };
db.users = (db.users || []).filter(u => u.role === 'admin' || u.role === 'dev');
['orders', 'guests', 'messages', 'comments', 'notifications', 'dev_messages', 'learning_applications'].forEach(k => { if (Array.isArray(db[k])) db[k] = []; });
fs.writeFileSync(file, JSON.stringify(db, null, 2));
console.log('Очищено. Было: клиентов+персонала ' + before.users + ', заказов ' + before.orders + ', сообщений ' + before.messages);
console.log('Осталось сотрудников: ' + db.users.length + '. Копия: data/fcc_data.json.backup-' + stamp);
