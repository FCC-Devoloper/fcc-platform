// FCC client module: auth.js

// ===== 2. АВТОРИЗАЦИЯ И МОДАЛЬНЫЕ ОКНА =====
function openAuthModal() {
    const el = document.getElementById('auth-modal');
    if (el) el.classList.add('active');
    switchAuthTab('login');
}

function closeAuthModal() {
    const el = document.getElementById('auth-modal');
    if (el) el.classList.remove('active');
    const err = document.getElementById('auth-error');
    if (err) { 
        err.style.display = 'none'; 
        err.textContent = ''; 
    }
}

function openRegisterModal() { 
    openAuthModal(); 
    switchAuthTab('register'); 
}

function closeRegisterModal() { 
    closeAuthModal(); 
}

function switchAuthTab(tab) {
    currentAuthTab = tab;
    const title = document.getElementById('auth-title');
    const email = document.getElementById('auth-email');
    const btn = document.getElementById('auth-submit-btn');
    const tabLogin = document.getElementById('tab-login');
    const tabReg = document.getElementById('tab-register');

    if (tab === 'login') {
        if (title) title.textContent = 'Вход в аккаунт';
        if (email) email.style.display = 'none';
        if (btn) btn.textContent = 'Войти';
        if (tabLogin) tabLogin.classList.add('active');
        if (tabReg) tabReg.classList.remove('active');
    } else {
        if (title) title.textContent = 'Регистрация';
        if (email) email.style.display = 'block';
        if (btn) btn.textContent = 'Зарегистрироваться';
        if (tabLogin) tabLogin.classList.remove('active');
        if (tabReg) tabReg.classList.add('active');
    }
}

async function handleAuthSubmit(e) {
    e.preventDefault();

    const usernameEl = document.getElementById('auth-username');
    const passwordEl = document.getElementById('auth-password');
    const emailEl = document.getElementById('auth-email');
    const errEl = document.getElementById('auth-error');

    if (!usernameEl || !passwordEl) return;

    const username = usernameEl.value.trim();
    const password = passwordEl.value;
    const email = emailEl ? emailEl.value.trim() : '';
    const clientId = localStorage.getItem('fcc_client_id');

    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    const isRegister = currentAuthTab === 'register';
    const url = isRegister ? '/api/auth/register' : '/api/auth/login';

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                email: isRegister ? email : undefined,
                clientId: clientId || undefined
            })
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            if (errEl) {
                errEl.textContent = data.error || 'Ошибка авторизации';
                errEl.style.display = 'block';
            }
            return;
        }

        // Admin never enters via client site
        if (data.role === 'admin') {
            if (errEl) {
                errEl.textContent = 'Админ входит только на /admin-login.html';
                errEl.style.display = 'block';
            }
            return;
        }

        if (data.token) {
            localStorage.setItem('fcc_token', data.token);
            localStorage.removeItem('fcc_admin_token');
            document.cookie = 'fcc_admin_token=; path=/; max-age=0';
            const uid = data.userId || (data.user && data.user.id) || data.id;
            localStorage.setItem('fcc_user', JSON.stringify({
                id: uid,
                username: data.username,
                role: 'client',
                linked_guest_ids: (data.user && data.user.linked_guest_ids) || []
            }));
            // Bind browser session to server user id (history lives on server)
            if (uid) {
                localStorage.setItem('fcc_client_id', uid);
                localStorage.setItem('fcc_canonical_id', uid);
            }
        }

        closeAuthModal();
        updateAuthUI();
        showToast(isRegister ? 'Регистрация успешна! История чата сохранена.' : 'Вы вошли в аккаунт.');

        if (typeof window.reconnectChatIdentity === 'function') {
            window.reconnectChatIdentity();
        }
        // drop any cached promo/news that belonged to previous guest session keys
        try {
            localStorage.removeItem('fcc_guest_chat_cache');
        } catch (e) {}
        if (typeof window.reloadNotifications === 'function') {
            window.reloadNotifications();
        }
        if (typeof window.reloadCabinetOrders === 'function') {
            window.reloadCabinetOrders();
        }

        const form = document.getElementById('auth-form');
        if (form) form.reset();

    } catch (err) {
        if (errEl) {
            errEl.textContent = 'Нет соединения с сервером';
            errEl.style.display = 'block';
        }
    }
}

function updateAuthUI() {
    const btn = document.getElementById('auth-header-btn');
    if (!btn) return;

    const userRaw = localStorage.getItem('fcc_user');
    if (userRaw) {
        try {
            const user = JSON.parse(userRaw);
            btn.textContent = user.username || 'Кабинет';
            btn.onclick = () => window.location.href = '/cabinet.html';
        } catch (e) {
            btn.textContent = 'Вход / Регистрация';
            btn.onclick = openAuthModal;
        }
    } else {
        btn.textContent = 'Вход / Регистрация';
        btn.onclick = openAuthModal;
    }

    if (typeof updateCabinetUI === 'function') {
        updateCabinetUI();
    }
}


async function handleGoogleCredential(response) {
    const errEl = document.getElementById('auth-error');
    try {
        const clientId = localStorage.getItem('fcc_client_id') || '';
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential, clientId })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            if (errEl) {
                errEl.textContent = data.error || 'Google вход не удался';
                errEl.style.display = 'block';
            }
            return;
        }
        if (data.role === 'admin') {
            if (errEl) {
                errEl.textContent = 'Админ — только через /admin-login.html';
                errEl.style.display = 'block';
            }
            return;
        }
        localStorage.setItem('fcc_token', data.token);
        localStorage.setItem('fcc_user', JSON.stringify({
            id: data.userId || (data.user && data.user.id),
            username: data.username,
            role: data.role || 'client',
            linked_guest_ids: (data.user && data.user.linked_guest_ids) || []
        }));
        if (typeof closeAuthModal === 'function') closeAuthModal();
        if (typeof updateAuthUI === 'function') updateAuthUI();
        if (typeof showToast === 'function') showToast('Вход через Google выполнен');
        if (typeof window.reconnectChatIdentity === 'function') window.reconnectChatIdentity();
    } catch (e) {
        if (errEl) {
            errEl.textContent = 'Нет связи с сервером';
            errEl.style.display = 'block';
        }
    }
}
window.handleGoogleCredential = handleGoogleCredential;

async function initGoogleSignIn() {
    try {
        if (!window.FCC_GOOGLE_CLIENT_ID) {
            const r = await fetch('/api/public-config');
            const j = await r.json();
            if (j && j.googleClientId) window.FCC_GOOGLE_CLIENT_ID = j.googleClientId;
        }
    } catch (e) {}
    const clientId = window.FCC_GOOGLE_CLIENT_ID || '';
    if (!clientId) return;
    const onload = document.getElementById('g_id_onload');
    if (onload) onload.setAttribute('data-client_id', clientId);
    if (!document.getElementById('google-gsi-script')) {
        const s = document.createElement('script');
        s.id = 'google-gsi-script';
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        document.head.appendChild(s);
    }
}
window.initGoogleSignIn = initGoogleSignIn;
document.addEventListener('DOMContentLoaded', initGoogleSignIn);
window.addEventListener('fcc-partials-ready', initGoogleSignIn);


function toggleEmailAuth() {
    const form = document.getElementById('auth-form');
    if (!form) return;
    const show = form.style.display === 'none' || !form.style.display;
    form.style.display = show ? 'block' : 'none';
    const err = document.getElementById('auth-error');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
}

function startGoogleLogin() {
    const err = document.getElementById('auth-error');
    const clientId = window.FCC_GOOGLE_CLIENT_ID || '';
    if (!clientId) {
        if (err) {
            err.style.display = 'block';
            err.textContent = 'Google ещё не настроен. Добавьте GOOGLE_CLIENT_ID на сервере. Пока можно войти через email/логин.';
        }
        // still show GIS wrap if script loads later
        const wrap = document.getElementById('google-signin-wrap');
        if (wrap) wrap.style.display = 'block';
        toggleEmailAuth();
        return;
    }
    const wrap = document.getElementById('google-signin-wrap');
    if (wrap) wrap.style.display = 'block';
    initGoogleSignIn();
    // If GIS rendered a button, user clicks it; otherwise prompt
    if (err) {
        err.style.display = 'block';
        err.style.color = '#8af';
        err.textContent = 'Выберите Google-аккаунт в кнопке ниже';
    }
}

window.toggleEmailAuth = toggleEmailAuth;
window.startGoogleLogin = startGoogleLogin;


async function requestEmailOtp() {
    const email = prompt('Email для входа:');
    if (!email) return;
    const err = document.getElementById('auth-error');
    try {
        const res = await fetch('/api/auth/email-otp/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok) {
            if (err) { err.style.display = 'block'; err.textContent = data.error || 'Ошибка'; }
            return;
        }
        const msg = 'Код отправлен' + (data.emailHint ? ' на ' + data.emailHint : '') +
            (data.devCode ? ('\nDev-код: ' + data.devCode) : '');
        const code = prompt(msg + '\nВведите код:');
        if (!code) return;
        const res2 = await fetch('/api/auth/email-otp/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code, clientId: localStorage.getItem('fcc_client_id') })
        });
        const data2 = await res2.json();
        if (!res2.ok) {
            if (err) { err.style.display = 'block'; err.textContent = data2.error || 'Неверный код'; }
            return;
        }
        localStorage.setItem('fcc_token', data2.token);
        localStorage.setItem('fcc_user', JSON.stringify({
            id: data2.userId, username: data2.username, role: 'client'
        }));
        localStorage.setItem('fcc_client_id', data2.userId);
        if (typeof closeAuthModal === 'function') closeAuthModal();
        if (typeof updateAuthUI === 'function') updateAuthUI();
        if (typeof window.reconnectChatIdentity === 'function') window.reconnectChatIdentity();
        if (typeof showToast === 'function') showToast('Вход выполнен');
    } catch (e) {
        if (err) { err.style.display = 'block'; err.textContent = 'Нет связи'; }
    }
}
window.requestEmailOtp = requestEmailOtp;

// Wire email button to prefer OTP
const _oldToggle = window.toggleEmailAuth;
window.toggleEmailAuth = function () {
    if (confirm('Войти по коду на email?\nОК — код на почту\nОтмена — логин и пароль')) {
        requestEmailOtp();
        return;
    }
    if (typeof _oldToggle === 'function') _oldToggle();
    else {
        const form = document.getElementById('auth-form');
        if (form) form.style.display = 'block';
    }
};


// Если аккаунт удалён (или токен недействителен) — сразу выходим, а не показываем старые данные
async function verifyStoredSession() {
    const token = localStorage.getItem('fcc_token');
    if (!token) return;
    try {
        const res = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
        if (res.status === 401 || res.status === 403 || res.status === 404) {
            ['fcc_token', 'fcc_user', 'fcc_client_id', 'fcc_canonical_id', 'fcc_guest_chat_cache'].forEach(k => localStorage.removeItem(k));
            updateAuthUI();
            if (/cabinet\.html/.test(location.pathname)) location.href = '/';
        }
    } catch (e) {}
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', verifyStoredSession); else verifyStoredSession();
