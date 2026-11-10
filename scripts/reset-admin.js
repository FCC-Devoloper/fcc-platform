// Сброс пароля админа и показ ключа доступа.
// Запуск (сервер можно остановить):  npm run reset-admin -- НовыйПароль123
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const file = path.join(__dirname, '..', 'data', 'fcc_data.json');
const pass = process.argv[2];
if (!pass || pass.length < 8) {
    console.log('Укажите новый пароль (минимум 8 символов):\n  npm run reset-admin -- НовыйПароль123');
    process.exit(1);
}
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const admin = (db.users || []).find(u => u.role === 'admin');
if (!admin) { console.log('Админ не найден в базе'); process.exit(1); }
fs.copyFileSync(file, file + '.before-reset');
admin.password = bcrypt.hashSync(pass, 10);
if (!admin.access_key) admin.access_key = 'FCC-' + require('crypto').randomBytes(6).toString('hex').toUpperCase();
fs.writeFileSync(file, JSON.stringify(db, null, 2));
console.log('\nГотово. Остановите сервер перед запуском скрипта и запустите заново после него.\n');
console.log('Логин админа:  ' + admin.username);
console.log('Новый пароль:  ' + pass);
console.log('Ключ доступа:  ' + admin.access_key);
console.log('\nВход: http://localhost:' + (process.env.PORT || 3000) + '/team-portal.html');
console.log('1) введите ключ доступа  2) нажмите 5 раз на заголовок  3) логин + пароль');
