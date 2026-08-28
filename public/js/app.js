/* ==========================================
   FCC MATRIX — MAIN APP CONTROLLER (CLEAN)
   ========================================== */

let currentAuthTab = 'login';

// ===== 1. КАСТОМНЫЕ УВЕДОМЛЕНИЯ (БЕЗ БРАУЗЕРНЫХ ALERT) =====
function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `fcc-toast ${type === 'error' ? 'error' : ''}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

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

        if (data.token) {
            localStorage.setItem('fcc_token', data.token);
            localStorage.setItem('fcc_user', JSON.stringify({
                id: data.userId || data.id,
                username: data.username,
                role: data.role || 'client',
                linked_guest_ids: (data.user && data.user.linked_guest_ids) || []
            }));

            if (data.role === 'admin') {
                localStorage.setItem('fcc_admin_token', data.token);
                window.location.href = '/admin.html';
                return;
            }
        }

        closeAuthModal();
        updateAuthUI();
        showToast(isRegister ? 'Регистрация успешна! История чата сохранена.' : 'Вы вошли в аккаунт.');
        if (typeof window.reconnectChatIdentity === 'function') window.reconnectChatIdentity();
        if (typeof window.reloadNotifications === 'function') window.reloadNotifications();
        if (typeof window.reloadCabinetOrders === 'function') window.reloadCabinetOrders();

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

// ===== 3. ЗАЯВКИ И ОБУЧЕНИЕ =====
function openOrderModal() {
    const el = document.getElementById('order-modal');
    if (el) el.classList.add('active');
}

function closeOrderModal() {
    const el = document.getElementById('order-modal');
    if (el) el.classList.remove('active');
}

function openPythonModal() {
    const el = document.getElementById('python-modal');
    if (el) el.classList.add('active');
}

function closePythonModal() {
    const el = document.getElementById('python-modal');
    if (el) el.classList.remove('active');
}

function startPythonTrack() {
    closePythonModal();
    const title = document.getElementById('order-title');
    const cat = document.getElementById('order-category');
    const desc = document.getElementById('order-desc');
    if (title) title.value = 'Хочу учить Python';
    if (cat) cat.value = 'python';
    if (desc) desc.value = 'Хочу начать обучение Python с нуля. Нужен трек и первый проект.';
    openOrderModal();
}

async function submitOrder(e) {
    e.preventDefault();
    const titleEl = document.getElementById('order-title');
    const catEl = document.getElementById('order-category');
    const descEl = document.getElementById('order-desc');
    const contactEl = document.getElementById('order-contact');
    if (!titleEl || !contactEl) return;

    const payload = {
        title: titleEl.value,
        category: catEl ? catEl.value : 'web',
        description: descEl ? descEl.value : '',
        contact: contactEl.value,
        clientId: localStorage.getItem('fcc_client_id')
    };

    try {
        const res = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast('Заявка успешно отправлена!');
            closeOrderModal();
            const form = document.getElementById('order-form');
            if (form) form.reset();
        } else {
            showToast('Ошибка при отправке заявки.', 'error');
        }
    } catch (err) {
        showToast('Нет соединения с сервером.', 'error');
    }
}

// ===== 4. СИСТЕМНАЯ ЛОГИКА И CMS =====
function maybeSkipIntro() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('preview') && !params.has('nointro') && window.self === window.top) return;
    const intro = document.getElementById('intro-screen');
    const main = document.getElementById('main-content');
    if (intro) intro.style.display = 'none';
    if (main) {
        main.style.display = 'block';
        main.style.opacity = '1';
    }
}

function setupNavToggle() {
    const toggle = document.getElementById('nav-toggle');
    const nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;
    toggle.addEventListener('click', () => nav.classList.toggle('open'));
    nav.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => nav.classList.remove('open'));
    });
}

async function checkStatus() {
    try {
        const res = await fetch('/api/status');
        if (res.ok) {
            const data = await res.json();
            updateServerStatus(data.online);
        }
    } catch (e) {}
}

function updateServerStatus(isOnline) {
    const badge = document.getElementById('status-badge');
    const text = document.getElementById('status-text');
    if (!badge || !text) return;
    if (isOnline) {
        badge.classList.add('online');
        text.innerText = 'ONLINE';
    } else {
        badge.classList.remove('online');
        text.innerText = 'OFFLINE';
    }
}

function applyCmsMap(settings) {
    const map = [
        ['hero.tag', 'client-hero-tag'],
        ['hero_tag', 'client-hero-tag'],
        ['hero.title', 'client-hero-title'],
        ['hero_title', 'client-hero-title'],
        ['hero.description', 'client-hero-desc'],
        ['hero_desc', 'client-hero-desc']
    ];
    map.forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el && settings[key] && settings[key].value_ru) el.innerText = settings[key].value_ru;
    });

    document.querySelectorAll('[data-cms-key]').forEach(el => {
        const key = el.getAttribute('data-cms-key');
        const item = settings[key];
        if (!item || item.value_ru == null || item.value_ru === '') return;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = item.value_ru;
        else el.innerText = item.value_ru;
    });
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function loadSiteContent() {
    try {
        const resSettings = await fetch('/api/admin/settings');
        const settingsData = await resSettings.json();
        if (settingsData.success && settingsData.settings) {
            applyCmsMap(settingsData.settings);
        }

        if (window.FCCRender) {
            await window.FCCRender.renderProjects('#client-projects-grid');
            await window.FCCRender.renderNews('#client-news-grid', 3);
            await window.FCCRender.renderPlans('#client-plans-grid');
            await window.FCCRender.renderContacts();
        }

        const promoRes = await fetch('/api/promotions');
        const promoData = await promoRes.json();
        const promoBox = document.getElementById('client-promo-row');
        const promotions = Array.isArray(promoData.promotions) ? promoData.promotions : [];
        if (promoBox && promotions.length) {
            promoBox.innerHTML = promotions.map(p => (
                '<div class="promo-chip"><strong>' + escapeHtml(p.title_ru || p.discount || '') + '</strong> ' +
                escapeHtml(p.description_ru || '') + '</div>'
            )).join('');
            setupPromoWidget(promotions);
        } else {
            if (promoBox) promoBox.innerHTML = '';
            hidePromoWidget();
        }
    } catch (err) {
        console.error('Ошибка загрузки данных:', err);
    }
}

function hidePromoWidget() {
    const button = document.getElementById('promo-widget-btn');
    const popup = document.getElementById('promo-popup');
    if (button) button.style.display = 'none';
    if (popup) {
        popup.classList.remove('open');
        popup.setAttribute('aria-hidden', 'true');
    }
}

function setupPromoWidget(promotions) {
    const button = document.getElementById('promo-widget-btn');
    const percent = document.getElementById('promo-widget-percent');
    const popupDiscount = document.getElementById('promo-popup-discount');
    const title = document.getElementById('promo-popup-title');
    const target = document.getElementById('promo-popup-target');
    const description = document.getElementById('promo-popup-description');
    const action = document.getElementById('promo-popup-action');
    const promo = [...promotions].filter(p => p && p.is_active !== 0).sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || promotions[0];
    if (!button || !promo) return;

    const discount = promo.discount || promo.title_ru || '-0%';
    const titleText = promo.title_ru || 'Акция';
    const targetText = promo.target || 'Для всех услуг';
    const descriptionText = promo.description_ru || 'Условия акции уточняются при обращении.';

    button.style.display = 'flex';
    if (percent) percent.textContent = discount;
    if (popupDiscount) popupDiscount.textContent = discount;
    if (title) title.textContent = titleText;
    if (target) target.textContent = 'Действует: ' + targetText;
    if (description) description.textContent = descriptionText;

    if (action) {
        const url = promo.action_link || '';
        if (url) {
            action.href = url;
            action.style.display = 'inline-flex';
            action.target = /^https?:\/\//i.test(url) ? '_blank' : '_self';
            action.rel = action.target === '_blank' ? 'noopener noreferrer' : '';
        } else {
            action.style.display = 'none';
        }
    }
}

function openPromoPopup() {
    const popup = document.getElementById('promo-popup');
    if (!popup) return;
    popup.classList.add('open');
    popup.setAttribute('aria-hidden', 'false');
}

function togglePromoPopup() {
    const popup = document.getElementById('promo-popup');
    if (!popup) return;
    const open = popup.classList.toggle('open');
    popup.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function closePromoPopup() {
    const popup = document.getElementById('promo-popup');
    if (!popup) return;
    popup.classList.remove('open');
    popup.setAttribute('aria-hidden', 'true');
}

function goToCabinet() {
    const userRaw = localStorage.getItem('fcc_user');
    if (userRaw) {
        window.location.href = '/cabinet.html';
    } else {
        openAuthModal();
    }
}

// ===== 5. ИНИЦИАЛИЗАЦИЯ И ЭКСПОРТ =====
document.addEventListener('DOMContentLoaded', () => {
    updateAuthUI();
    maybeSkipIntro();
    checkStatus();
    loadSiteContent();
    setupNavToggle();
});

// Глобальный экспорт функций
window.handleRegister = (e) => { currentAuthTab = 'register'; return handleAuthSubmit(e); };
window.handleAuth = handleAuthSubmit;
window.handleAuthSubmit = handleAuthSubmit;
window.openOrderModal = openOrderModal;
window.closeOrderModal = closeOrderModal;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.openRegisterModal = openRegisterModal;
window.closeRegisterModal = closeRegisterModal;
window.openPythonModal = openPythonModal;
window.closePythonModal = closePythonModal;
window.startPythonTrack = startPythonTrack;
window.submitOrder = submitOrder;
window.updateServerStatus = updateServerStatus;
window.goToCabinet = goToCabinet;
window.showToast = showToast;
window.escapeHtml = escapeHtml;
window.openPromoPopup = openPromoPopup;
window.togglePromoPopup = togglePromoPopup;
window.closePromoPopup = closePromoPopup;
