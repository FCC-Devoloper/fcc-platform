
function fccWhenReady(fn) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn);
    } else {
        fn();
    }
}

// FCC client module: cms.js

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
fccWhenReady( () => {
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
