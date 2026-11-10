
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
    if (isPreviewMode()) document.body.classList.add('ve-active');
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

function applyTelegramLinks(map) {
    map = map || {};
    const tgLink = document.getElementById('contact-telegram-link');
    if (tgLink) {
        const raw = (map['contact.telegram'] && (map['contact.telegram'].value_ru || map['contact.telegram'].value)) || 'https://t.me/fcc_studio';
        const href = String(raw).startsWith('http') ? String(raw) : ('https://t.me/' + String(raw).replace(/^@/, ''));
        tgLink.href = href;
        tgLink.target = '_blank';
        tgLink.rel = 'noopener noreferrer';
    }
    document.querySelectorAll('a[data-contact="telegram"], a.contact-telegram').forEach((a) => {
        a.href = (map['contact.telegram'] && map['contact.telegram'].value_ru) || 'https://t.me/fcc_studio';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
    });
}

// Режим предпросмотра внутри визуального редактора админки: /?preview=1 в iframe
function isPreviewMode() {
    return window.self !== window.top && new URLSearchParams(window.location.search).has('preview');
}

function cmsSafeUrl(url) {
    const v = String(url || '').trim();
    return /^(https?:\/\/|mailto:|tel:|#|\/)/i.test(v) ? v : '';
}

function cmsRunAction(action, url) {
    if (action === 'modal' && typeof openOrderModal === 'function') openOrderModal();
    else if (action === 'chat' && typeof toggleChatWindow === 'function') toggleChatWindow();
    else if (action === 'scroll') {
        const id = String(url || '').replace(/^#/, '');
        const target = id && document.getElementById(id);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
    } else if (action === 'url') {
        const safe = cmsSafeUrl(url);
        if (!safe) return;
        if (/^https?:\/\//i.test(safe)) window.open(safe, '_blank', 'noopener');
        else window.location.href = safe;
    }
}

/** Применяет к элементу сохранённый в админке текст, стиль и действие. */
function applyCmsItem(el, item) {
    if (!el || !item) return;
    if (el.dataset.cmsDefault === undefined) el.dataset.cmsDefault = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el.value : el.innerText;
    if (item.value_ru != null && item.value_ru !== '') {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = item.value_ru;
        else el.innerText = item.value_ru;
    }
    const st = item.styles || {};
    el.style.color = st.color || '';
    el.style.fontSize = st.fontSize ? st.fontSize + 'px' : '';
    el.style.textAlign = st.textAlign || '';

    if (item.action) {
        el.setAttribute('data-cms-action', item.action);
        el.setAttribute('data-cms-url', item.url || '');
        if (!isPreviewMode() && !el._cmsBound) {
            el._cmsBound = true;
            el.removeAttribute('onclick');
            el.addEventListener('click', (e) => {
                const act = el.getAttribute('data-cms-action');
                if (!act) return;
                e.preventDefault();
                cmsRunAction(act, el.getAttribute('data-cms-url'));
            });
        }
    }
}

function applyCmsMap(settings) {
    if (window.FCCBg) window.FCCBg.apply(settings);
    document.querySelectorAll('[data-cms-key]').forEach(el => {
        applyCmsItem(el, settings[el.getAttribute('data-cms-key')]);
    });
    const seoTitle = settings['seo.title'] && settings['seo.title'].value_ru;
    if (seoTitle) document.title = seoTitle;
    const seoDesc = settings['seo.description'] && settings['seo.description'].value_ru;
    if (seoDesc) {
        let meta = document.querySelector('meta[name="description"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'description');
            document.head.appendChild(meta);
        }
        meta.setAttribute('content', seoDesc);
    }
}

window.FCCCms = { applyItem: applyCmsItem, isPreview: isPreviewMode };

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
        // Public content only — never /api/admin/* (requires JWT)
        try {
            const resContent = await fetch('/api/content');
            const contentData = await resContent.json().catch(() => ({}));
            if (contentData.success && contentData.content) {
                applyCmsMap(contentData.content);
                applyTelegramLinks(contentData.content);
            }
        } catch (e) { console.warn('[cms] content', e); }

        if (window.FCCRender) {
            await window.FCCRender.renderProjects('#client-projects-grid', { limit: 3 });
            await window.FCCRender.renderNews('#client-news-grid', { limit: 3 });
            await window.FCCRender.renderPlans('#client-plans-grid');
            await window.FCCRender.renderContacts();
            if (window.FCCRender.renderTeam) await window.FCCRender.renderTeam('#client-team-grid');
        }

        try {
            const promoRes = await fetch('/api/promotions');
            const promoData = await promoRes.json().catch(() => ({}));
            const promotions = Array.isArray(promoData.promotions) ? promoData.promotions : [];
            if (window.FCCPromos) {
                window.FCCPromos.render(promotions);
            } else {
                const promoBox = document.getElementById('client-promo-row');
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
            }
        } catch (e) { console.warn('[cms] promos', e); }
    } catch (err) {
        console.error('Ошибка загрузки данных:', err);
    } finally {
        window.__fccContentReady = true;
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
