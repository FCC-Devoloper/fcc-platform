# Как включить вход через Google (5 шагов)

1. Открой https://console.cloud.google.com → создай проект (например FCC).
2. Меню «APIs & Services» → «OAuth consent screen» → External → заполни название и свой email → Save.
3. «Credentials» → «Create credentials» → «OAuth client ID» → тип **Web application**.
4. В «Authorized JavaScript origins» добавь:
   - http://localhost:8080 (для теста)
   - https://ТВОЙ-ДОМЕН (когда выложишь сайт)
   Redirect URI не нужен.
5. Скопируй **Client ID** (…apps.googleusercontent.com) и вставь в `.env`:
   GOOGLE_CLIENT_ID=твой_id
   Перезапусти сервер: `npm install` затем `npm start`.

Проверка: открой /login.html — должна появиться кнопка Google. Если пишет
«не настроен» — Client ID не попал в .env.

# Новые секреты (если захочешь поменять)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
