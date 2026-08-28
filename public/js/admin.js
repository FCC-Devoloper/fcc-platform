let currentWs = null;
let selectedClientId = null;
let selectedLinkedIds = [];
let heartbeatTimer = null;
let editingElement = null;


const _partialsLoaded = new Set();

async function loadPartial(name) {
    if (_partialsLoaded.has(name)) return true;
    const el = document.getElementById('tab-' + name);
    if (!el) return false;
    try {
        const res = await fetch('/admin-partials/' + name + '.html');
        if (!res.ok) throw new Error('partial ' + name + ' not found');
        const html = await res.text();
        el.innerHTML = html;
        _partialsLoaded.add(name);
        return true;
    } catch (err) {
        console.error('[Admin] loadPartial', name, err);
        el.innerHTML = '<p class="muted">Не удалось загрузить раздел</p>';
        return false;
    }
}

async function ensurePartialAndRun(name, fn) {
    await loadPartial(name);
    if (typeof fn === 'function') await fn();
}


function authHeaders() {
    const token = localStorage.getItem('fcc_admin_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
}

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupTabNavigation();
});

function checkAuth() {
    const token = localStorage.getItem('fcc_admin_token');
    const overlay = document.getElementById('admin-auth-overlay');
    if (token) {
        if (overlay) overlay.style.display = 'none';
        initAdminWS();
        loadInitialData();
    } else if (overlay) {
        overlay.style.display = 'flex';
    }
}

async function handleAdminLogin(e) {
    if (e) e.preventDefault();
    const userEl = document.getElementById('admin-user');
    const passEl = document.getElementById('admin-pass');
    const errorEl = document.getElementById('auth-error');
    if (!userEl || !passEl) return;
    
    const username = userEl.value.trim();
    const password = passEl.value.trim();

    if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.innerText = '';
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        
        // Строгая валидация ролей сервера
        if (res.ok && data.success && data.role === 'admin' && data.token) {
            localStorage.setItem('fcc_admin_token', data.token);
            localStorage.setItem('fcc_token', data.token);
            const overlay = document.getElementById('admin-auth-overlay');
            if (overlay) overlay.style.display = 'none';
            initAdminWS();
            loadInitialData();
        } else {
            if (errorEl) {
                errorEl.innerText = data.error || 'Доступ запрещен. Неверный логин или пароль.';
                errorEl.style.display = 'block';
            }
        }
    } catch (err) {
        if (errorEl) {
            errorEl.innerText = 'Ошибка соединения с сервером авторизации';
            errorEl.style.display = 'block';
        }
    }
}

function logoutAdmin() {
    localStorage.removeItem('fcc_admin_token');
    if (currentWs) currentWs.close();
    window.location.reload();
}

function setupTabNavigation() {
    const tabs = document.querySelectorAll('[data-tab]');
    tabs.forEach(tab => {
        tab.addEventListener('click', async () => {
            const target = tab.getAttribute('data-tab');
            document.querySelectorAll('[data-tab]').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => {
                c.classList.remove('active');
                c.style.display = 'none';
            });
            tab.classList.add('active');
            const targetEl = document.getElementById('tab-' + target);
            if (targetEl) {
                targetEl.classList.add('active');
                targetEl.style.display = 'block';
            }
            // Загружаем partial один раз, потом вызываем нужный loader
            await loadPartial(target);
            if (target === 'notifications') loadDevNotifications();
            if (target === 'projects') loadProjects();
            if (target === 'news') loadNews();
            if (target === 'promos') loadPromotions();
            if (target === 'site-cms' || target === 'config') loadSettings();
            if (target === 'orders') loadOrders();
            if (target === 'users') loadAdmins();
            if (target === 'visual') initVisualEditor();
            if (target === 'live') loadHub();
            if (target === 'contacts') loadContacts();
            if (target === 'plans') loadPlans();
        });
    });
}

async function loadInitialData() {
    // Сначала подгружаем partials которые нужны сразу
    await loadPartial('live');
    loadHub();
    // Остальные подгрузятся при первом клике на вкладку
    // (можно раскомментировать если нужно предзагружать)
    // await Promise.all(['notifications','projects','news','promos','site-cms','orders'].map(loadPartial));
}

async function api(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: { ...authHeaders(), ...(options.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
        if (url.indexOf('/api/admin') === 0) {
            localStorage.removeItem('fcc_admin_token');
            const overlay = document.getElementById('admin-auth-overlay');
            if (overlay) overlay.style.display = 'flex';
        }
    }
    return data;
}

/* ==========================================
   ОЧИСТКА СЕССИЙ (LIVE HUB LOGIC)
   ========================================== */

function renderActiveClients(clients) {
    const container = document.getElementById('active-clients-list');
    if (!container) return;

    const filteredClients = (clients || []).filter(c => c.is_online || c.is_registered || c.username);

    const onlineCount = filteredClients.filter(c => c.is_online).length;
    const onlineEl = document.getElementById('stat-online');
    if (onlineEl) onlineEl.textContent = onlineCount;

    if (filteredClients.length === 0) {
        container.innerHTML = '<p class="muted">Нет активных пользователей или авторизованных клиентов.</p>';
        return;
    }

    container.innerHTML = filteredClients.map(c => {
        const id = c.user_id || c.client_id || c.id;
        const isOnline = !!c.is_online;
        const registered = !!(c.is_registered || c.username || c.user_id);
        const displayName = registered ? (c.username || c.name || id) : ('Гость ' + String(id).slice(0, 10));
        const onClass = isOnline ? 'online' : 'off';
        const roleBadge = registered
            ? '<span class="status-pill" style="margin-left:auto;">Клиент</span>'
            : '<span class="muted" style="margin-left:auto; font-size:0.75rem;">Гость</span>';
        const preview = c.last_message ? '<div class="muted" style="font-size:11px;margin-top:4px;">' + esc(String(c.last_message).slice(0, 80)) + '</div>' : '';
        const linked = (c.linked_ids || []).join(',');

        return (
            '<button type="button" class="session-row" data-id="' + esc(id) + '" data-linked="' + esc(linked) + '" onclick="openAdminChat(\'' + esc(id) + '\')">' +
            '<span class="dot ' + onClass + '"></span>' +
            '<div style="text-align:left;flex:1;min-width:0;">' +
            '<strong style="color:' + (registered ? '#00ff9d' : '#ddd') + ';">' + esc(displayName) + '</strong>' +
            preview +
            '</div>' +
            roleBadge +
            (c.unread ? '<b class="unread-badge">' + c.unread + '</b>' : '') +
            '</button>'
        );
    }).join('');
}

async function loadHub() {
    try {
        const data = await api('/api/admin/hub', { headers: authHeaders() });
        if (!data.success) return;
        const n = document.getElementById('stat-orders');
        const u = document.getElementById('stat-unread');
        if (n) n.textContent = data.newOrders;
        if (u) u.textContent = data.unreadMessages;
        renderActiveClients(data.clients || []);
    } catch (e) {}
}

/* ==========================================
   КРАСНЫЕ АКЦИИ & СКИДКИ
   ========================================== */

async function loadPromotions() {
    const container = document.getElementById('promotions-list');
    if (!container) return;
    try {
        const data = await api('/api/admin/promotions');
        let list = (data && data.success) ? data.promotions : null;

        if (!list) {
            const local = localStorage.getItem('fcc_promos');
            list = local ? JSON.parse(local) : [];
        }

        if (list.length === 0) {
            container.innerHTML = '<p class="muted">АКТИВНЫХ АКЦИЙ НЕТ.</p>';
            return;
        }

        container.innerHTML = list.map(p => `
            <div class="list-row promo-admin-card">
                <div class="promo-main-info">
                    <div class="promo-head">
                        <span class="promo-badge-red">${esc(p.discount || '-0%')}</span>
                        <div>
                            <strong>${esc(p.title_ru || p.title)}</strong>
                            <div class="promo-target-text">На что: ${esc(p.target || 'Все услуги')}</div>
                        </div>
                    </div>
                    <p class="muted" style="margin: 8px 0 0;">${esc(p.description_ru || p.desc || '')}</p>
                    <p class="muted" style="margin: 4px 0 0; font-size:12px;">${esc(p.start_date || '—')} → ${esc(p.end_date || 'без срока')}</p>
                </div>
                <div style="display:flex; gap:6px;">
                    <button type="button" class="btn-action" onclick="openPromoModal('${esc(p.title_ru || p.title)}', '${esc(p.discount)}', '${esc(p.target)}', '${esc(p.description_ru || p.desc)}')">Условия</button>
                    <button type="button" class="btn-danger" onclick="deletePromo('${p.id}')">Удалить</button>
                </div>
            </div>
        `).join('');

    } catch (e) {}
}

async function savePromotion(e) {
    e.preventDefault();
    const payload = {
        id: Date.now().toString(),
        title_ru: document.getElementById('promo-title').value.trim(),
        discount: document.getElementById('promo-discount').value.trim(),
        target: document.getElementById('promo-target').value.trim(),
        description_ru: document.getElementById('promo-desc').value.trim(),
        action_link: document.getElementById('promo-action-link').value.trim(),
        start_date: (document.getElementById('promo-start') && document.getElementById('promo-start').value) || null,
        end_date: (document.getElementById('promo-end') && document.getElementById('promo-end').value) || null,
        is_active: 1
    };

    try {
        await fetch('/api/admin/promotions', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    } catch (err) {
        const local = localStorage.getItem('fcc_promos');
        const list = local ? JSON.parse(local) : [];
        list.unshift(payload);
        localStorage.setItem('fcc_promos', JSON.stringify(list));
    }

    document.getElementById('form-promo').reset();
    showNotification('Акция успешно создана');
    loadPromotions();
}

async function deletePromo(id) {
    if (!confirm('Удалить эту акцию?')) return;
    try {
        await fetch('/api/admin/promotions/' + id, { method: 'DELETE', headers: authHeaders() });
    } catch (e) {
        const local = localStorage.getItem('fcc_promos');
        if (local) {
            let list = JSON.parse(local).filter(p => String(p.id) !== String(id));
            localStorage.setItem('fcc_promos', JSON.stringify(list));
        }
    }
    loadPromotions();
}

function openPromoModal(title, discount, target, desc) {
    document.getElementById('modal-promo-title').innerText = title;
    document.getElementById('modal-promo-badge').innerText = discount;
    document.getElementById('modal-promo-target').innerText = 'Применяется к: ' + target;
    document.getElementById('modal-promo-desc').innerText = desc || 'Условия не указаны.';
    document.getElementById('promo-modal-overlay').style.display = 'flex';
}

function closePromoModal(e) {
    if (!e || e.target.id === 'promo-modal-overlay' || e.target.className === 'modal-close' || e.target.tagName === 'BUTTON') {
        document.getElementById('promo-modal-overlay').style.display = 'none';
    }
}

/* ==========================================
   ВИЗУАЛЬНЫЕ НОВОСТИ & РЕДАКТОР МЕДИА
   ========================================== */

async function loadNews() {
    try {
        const data = await api('/api/admin/news');
        const container = document.getElementById('news-list-container');
        if (!container) return;

        let list = (data && data.success) ? data.news : null;

        if (!list) {
            const local = localStorage.getItem('fcc_news');
            list = local ? JSON.parse(local) : [];
        }

        if (list.length > 0) {
            container.innerHTML = list.map(n => (
                '<div class="list-row news-admin-card">' +
                '<div class="news-info-box">' +
                '<strong>' + esc(n.title_ru || n.title) + '</strong>' +
                (n.subtitle ? '<div class="muted"><em>' + esc(n.subtitle) + '</em></div>' : '') +
                '<p class="muted">' + esc(n.content_ru || n.content || '') + '</p>' +
                '<div class="news-meta-tags">' +
                '<span class="status-pill">Медиа: ' + esc(n.media_align || 'full') + ' (' + esc(n.media_scale || 100) + '%)</span>' +
                (n.btn_url ? '<a href="' + esc(n.btn_url) + '" target="_blank" class="muted">Ссылка: ' + esc(n.btn_text || 'Кнопка') + '</a>' : '') +
                '</div>' +
                '</div>' +
                '<button type="button" class="btn-danger" onclick="deleteNews(\'' + n.id + '\')">Удалить</button></div>'
            )).join('');
        } else container.innerHTML = '<p class="muted">Новостей нет.</p>';
    } catch (e) {}
}

async function saveNews(e) {
    e.preventDefault();
    let media_url = document.getElementById('news-media-url').value;
    const fileEl = document.getElementById('news-file');
    
    if (fileEl && fileEl.files && fileEl.files[0]) {
        const file = fileEl.files[0];
        const data = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(file);
        });
        const up = await fetch('/api/admin/upload', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ filename: file.name, mime: file.type, data })
        });
        const upData = await up.json();
        if (upData.url) media_url = upData.url;
    }

    const payload = {
        id: document.getElementById('news-id').value || Date.now().toString(),
        title_ru: document.getElementById('news-title').value,
        subtitle: document.getElementById('news-subtitle').value,
        content_ru: document.getElementById('news-content').value,
        media_type: document.getElementById('news-media-type').value,
        media_align: document.getElementById('news-media-align').value,
        media_scale: document.getElementById('news-media-scale').value || '100',
        media_url: media_url,
        btn_text: document.getElementById('news-btn-text').value,
        btn_url: document.getElementById('news-btn-url').value
    };

    try {
        await fetch('/api/admin/news', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    } catch (err) {
        const local = localStorage.getItem('fcc_news');
        const list = local ? JSON.parse(local) : [];
        list.unshift(payload);
        localStorage.setItem('fcc_news', JSON.stringify(list));
    }

    document.getElementById('form-news').reset();
    showNotification('Новость с визуальными настройками опубликована');
    loadNews();
}

async function deleteNews(id) {
    if (!confirm('Удалить новость?')) return;
    try {
        await fetch('/api/admin/news/' + id, { method: 'DELETE', headers: authHeaders() });
    } catch (e) {
        const local = localStorage.getItem('fcc_news');
        if (local) {
            let list = JSON.parse(local).filter(n => String(n.id) !== String(id));
            localStorage.setItem('fcc_news', JSON.stringify(list));
        }
    }
    loadNews();
}

/* ==========================================
   РАСШИРЕННЫЙ VISUAL EDITOR
   ========================================== */

function initVisualEditor() {
    const frame = document.getElementById('visual-frame');
    if (!frame) return;
    frame.src = '/?preview=1';
    frame.onload = () => {
        const doc = frame.contentDocument;
        if (!doc) return;
        
        doc.querySelectorAll('[data-cms-key]').forEach(el => {
            el.style.outline = '1px dashed rgba(0,255,157,0.45)';
            el.style.cursor = 'pointer';
            
            el.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                
                editingElement = el;
                const bar = document.getElementById('ve-toolbar');
                if (bar) bar.hidden = false;
                
                document.getElementById('ve-text').value = el.innerText.trim();
                document.getElementById('ve-size').value = parseInt(window.getComputedStyle(el).fontSize) || '';
                document.getElementById('ve-align').value = window.getComputedStyle(el).textAlign || 'left';
                document.getElementById('ve-action').value = el.getAttribute('data-cms-action') || 'modal';
                document.getElementById('ve-url').value = el.getAttribute('data-cms-url') || '';
            });

            el.addEventListener('blur', async () => {
                const key = el.getAttribute('data-cms-key');
                const value = el.innerText.trim();
                await fetch('/api/admin/content', {
                    method: 'PUT',
                    headers: authHeaders(),
                    body: JSON.stringify({ key, value })
                });
            });
        });
    };
}

async function saveElementMeta() {
    if (!editingElement) return;
    
    const text = document.getElementById('ve-text').value;
    const color = document.getElementById('ve-color').value;
    const size = document.getElementById('ve-size').value;
    const align = document.getElementById('ve-align').value;
    const action = document.getElementById('ve-action').value;
    const url = document.getElementById('ve-url').value;

    editingElement.innerText = text;
    editingElement.style.color = color;
    if (size) editingElement.style.fontSize = size + 'px';
    editingElement.style.textAlign = align;
    
    editingElement.setAttribute('data-cms-action', action);
    editingElement.setAttribute('data-cms-url', url);

    const key = editingElement.getAttribute('data-cms-key');

    await fetch('/api/admin/content', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ 
            key, 
            value: text, 
            styles: { color, fontSize: size, textAlign: align }, 
            action, 
            url 
        })
    });
    
    showNotification('Элемент визуально обновлен');
}

/* ==========================================
   УВЕДОМЛЕНИЯ ПОЛЬЗОВАТЕЛЕЙ
   ========================================== */

async function loadDevNotifications() {
    const container = document.getElementById('notifications-list-container');
    if (!container) return;
    try {
        const data = await api('/api/admin/notifications', { headers: authHeaders() });
        let list = (data && data.success) ? data.notifications : null;
        if (!list) {
            const localData = localStorage.getItem('fcc_dev_notifications');
            list = localData ? JSON.parse(localData) : [];
        }

        if (list.length === 0) {
            container.innerHTML = '<p class="muted">Уведомлений нет.</p>';
            return;
        }

        container.innerHTML = list.map(item => `
            <div class="list-row">
                <div style="flex:1;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                        <span class="status-pill">${esc(item.tag || 'Инфо')}</span>
                        <strong>${esc(item.title)}</strong>
                        <span class="muted" style="font-size:0.8rem;">${esc(item.date || '')}</span>
                    </div>
                    <p class="muted" style="margin:0;">${esc(item.text || item.content || '')}</p>
                </div>
                <button type="button" class="btn-danger" onclick="deleteDevNotification('${item.id}')">Удалить</button>
            </div>
        `).join('');

    } catch (e) {}
}


async function deleteDevNotification(id) {
    if (!confirm('Удалить уведомление?')) return;
    try {
        await fetch('/api/admin/notifications/' + id, { method: 'DELETE', headers: authHeaders() });
    } catch (err) {
        const localData = localStorage.getItem('fcc_dev_notifications');
        if (localData) {
            let list = JSON.parse(localData).filter(item => String(item.id) !== String(id));
            localStorage.setItem('fcc_dev_notifications', JSON.stringify(list));
        }
    }
    showNotification('Уведомление удалено');
    loadDevNotifications();
}

/* ==========================================
   ОСТАЛЬНЫЕ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
   ========================================== */

async function loadProjects() {
    try {
        const data = await api('/api/admin/projects');
        const container = document.getElementById('projects-list-container');
        if (!container) return;
        if (data.success && data.projects.length > 0) {
            container.innerHTML = data.projects.map(p => (
                '<div class="list-row"><div><strong>' + esc(p.title_ru) + '</strong>' +
                '<p class="muted">' + esc(p.description_ru || '') + '</p>' +
                (p.runtime ? '<span class="status-pill">' + esc(String(p.runtime).toUpperCase()) + '</span>' : '') + ' ' +
                ((p.html_code || p.python_code) ? '<span class="status-pill">Демо-код готов</span>' : '') +
                (p.demo_url ? '<a href="' + esc(p.demo_url) + '" target="_blank">Внешнее демо</a>' : '') +
                '</div><button type="button" class="btn-danger" onclick="deleteProject(\'' + p.id + '\')">Удалить</button></div>'
            )).join('');
        } else container.innerHTML = '<p class="muted">Проекты не добавлены.</p>';
    } catch (e) {}
}

async function saveProject(e) {
    e.preventDefault();
    const payload = {
        id: document.getElementById('project-id').value || null,
        title_ru: document.getElementById('project-title').value,
        description_ru: document.getElementById('project-desc').value,
        demo_url: document.getElementById('project-demo').value,
        technologies: document.getElementById('project-tech').value,
        features: (document.getElementById('project-features') || {}).value || '',
        image: (document.getElementById('project-image') || {}).value || '',
        runtime: (document.getElementById('project-runtime') || {}).value || '',
        html_code: (document.getElementById('project-html') || {}).value || '',
        python_code: (document.getElementById('project-python') || {}).value || ''
    };
    await fetch('/api/admin/projects', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    document.getElementById('form-project').reset();
    showNotification('Проект сохранён');
    loadProjects();
}

async function deleteProject(id) {
    if (!confirm('Удалить проект?')) return;
    await fetch('/api/admin/projects/' + id, { method: 'DELETE', headers: authHeaders() });
    loadProjects();
}

async function loadSettings() {
    try {
        const data = await api('/api/admin/settings');
        if (!data.success || !data.settings) return;
        const s = data.settings;
        const tag = document.getElementById('setting-hero-tag');
        const title = document.getElementById('setting-hero-title');
        const desc = document.getElementById('setting-hero-desc');
        if (tag) tag.value = (s['hero.tag'] || s.hero_tag || {}).value_ru || '';
        if (title) title.value = (s['hero.title'] || s.hero_title || {}).value_ru || '';
        if (desc) desc.value = (s['hero.description'] || s.hero_desc || {}).value_ru || '';
    } catch (e) {}
}

async function saveAllSiteTexts() {
    const fields = [
        { keys: ['hero_tag', 'hero.tag'], el: 'setting-hero-tag' },
        { keys: ['hero_title', 'hero.title'], el: 'setting-hero-title' },
        { keys: ['hero_desc', 'hero.description'], el: 'setting-hero-desc' }
    ];
    for (const item of fields) {
        const val = document.getElementById(item.el).value;
        for (const key of item.keys) {
            await fetch('/api/admin/settings', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ key, value_ru: val, value_en: val })
            });
        }
    }
    showNotification('Тексты сайта обновлены');
}

async function loadOrders() {
    try {
        const data = await api('/api/admin/orders', { headers: authHeaders() });
        const container = document.getElementById('orders-list-container');
        if (!container) return;
        const orders = data.orders || [];
        if (!orders.length) {
            container.innerHTML = '<p class="muted">Заявок пока нет</p>';
            return;
        }
        const labels = {
            new: 'Новая',
            in_progress: 'В работе',
            waiting_client: 'Ждём клиента',
            done: 'Готово',
            rejected: 'Отказ',
            cancelled: 'Отмена'
        };
        container.innerHTML = orders.map(o => {
            const history = (o.status_history || []).map(h =>
                '<li>' + esc(h.at ? new Date(h.at).toLocaleString('ru-RU') : '') + ' — ' + esc(labels[h.status] || h.status) +
                (h.reason ? ' (' + esc(h.reason) + ')' : '') + '</li>'
            ).join('');
            return (
                '<div class="list-row order-row" data-id="' + esc(o.id) + '"><div style="flex:1;">' +
                '<strong>' + esc(o.title) + '</strong> <span class="status-pill">' + esc(labels[o.status] || o.status) + '</span>' +
                '<p class="muted">' + esc(o.description || '') + '</p>' +
                '<p class="muted">' + esc(o.contact) + ' · ' + esc(o.category) + ' · ' + esc(o.client_name || o.client_id || '') + '</p>' +
                (o.rejection_reason ? '<p class="muted">Отказ: ' + esc(o.rejection_reason) + '</p>' : '') +
                (o.result_url ? '<p class="muted">Результат: <a href="' + esc(o.result_url) + '" target="_blank" rel="noopener">' + esc(o.result_url) + '</a></p>' : '') +
                (history ? '<ul class="order-history muted">' + history + '</ul>' : '') +
                '</div>' +
                '<div class="order-actions">' +
                '<button type="button" onclick="setOrderStatus(\'' + o.id + '\',\'new\')">Новая</button>' +
                '<button type="button" onclick="setOrderStatus(\'' + o.id + '\',\'in_progress\')">В работе</button>' +
                '<button type="button" onclick="setOrderStatus(\'' + o.id + '\',\'waiting_client\')">Ждём</button>' +
                '<button type="button" onclick="setOrderStatus(\'' + o.id + '\',\'done\')">Готово</button>' +
                '<button type="button" onclick="setOrderStatus(\'' + o.id + '\',\'rejected\')">Отказ</button>' +
                '<button type="button" class="btn-danger" onclick="deleteOrder(\'' + o.id + '\')">Скрыть</button>' +
                '</div></div>'
            );
        }).join('');
    } catch (e) {}
}

async function setOrderStatus(id, status) {
    const body = { status };
    if (status === 'rejected') {
        const reason = prompt('Причина отказа (обязательно):');
        if (!reason || !reason.trim()) {
            showNotification('Нужна причина отказа');
            return;
        }
        body.reason = reason.trim();
        body.rejection_reason = reason.trim();
    }
    if (status === 'done') {
        const result = prompt('Ссылка на результат (необязательно):') || '';
        if (result.trim()) body.result_url = result.trim();
    }
    const res = await fetch('/api/admin/orders/' + id + '/status', {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        showNotification(data.error || 'Не удалось сменить статус');
        return;
    }
    loadOrders();
    loadHub();
}

async function deleteOrder(id) {
    if (!confirm('Скрыть заявку из списка?')) return;
    await fetch('/api/admin/orders/' + id, { method: 'DELETE', headers: authHeaders() });
    loadOrders();
    loadHub();
}

async function loadContacts() {
    const data = await api('/api/admin/settings');
    const s = data.settings || {};
    const v = k => (s[k] && s[k].value_ru) || '';
    if (document.getElementById('contact-tg')) document.getElementById('contact-tg').value = v('contact.telegram');
    if (document.getElementById('contact-em')) document.getElementById('contact-em').value = v('contact.email');
    if (document.getElementById('contact-ph')) document.getElementById('contact-ph').value = v('contact.phone');
    if (document.getElementById('contact-hr')) document.getElementById('contact-hr').value = v('contact.hours');
}

async function saveContacts() {
    const pairs = [['contact.telegram', 'contact-tg'], ['contact.email', 'contact-em'], ['contact.phone', 'contact-ph'], ['contact.hours', 'contact-hr']];
    for (const [key, id] of pairs) {
        const val = document.getElementById(id).value;
        await fetch('/api/admin/settings', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ key, value_ru: val, value_en: val }) });
    }
    showNotification('Контакты сохранены');
}

async function loadPlans() {
    const data = await api('/api/admin/plans');
    const box = document.getElementById('plans-list');
    if (!box) return;
    box.innerHTML = (data.plans || []).map(p => (
        '<div class="list-row"><div><strong>' + esc(p.title_ru) + '</strong> <span class="muted">' + esc(p.status) + ' · ' + esc(p.eta || '') + '</span><p class="muted">' + esc(p.description_ru || '') + '</p></div>' +
        '<button type="button" class="btn-danger" onclick="deletePlan(\'' + p.id + '\')">Удалить</button></div>'
    )).join('');
}

async function savePlan(e) {
    e.preventDefault();
    await fetch('/api/admin/plans', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
            title_ru: document.getElementById('plan-title').value,
            description_ru: document.getElementById('plan-desc').value,
            status: document.getElementById('plan-status').value,
            eta: document.getElementById('plan-eta').value
        })
    });
    e.target.reset();
    showNotification('План добавлен');
    loadPlans();
}

async function deletePlan(id) {
    await fetch('/api/admin/plans/' + id, { method: 'DELETE', headers: authHeaders() });
    loadPlans();
}

async function loadAdmins() {
    try {
        const data = await api('/api/admin/users', { headers: authHeaders() });
        const box = document.getElementById('admins-list');
        if (!box) return;
        box.innerHTML = (data.users || []).map(u => (
            '<div class="list-row"><strong>' + esc(u.username) + '</strong> <span class="muted">' + esc(u.role) + '</span></div>'
        )).join('');
    } catch (e) {}
}

async function createNewAdmin(e) {
    e.preventDefault();
    const username = document.getElementById('new-admin-user').value;
    const password = document.getElementById('new-admin-pass').value;
    const res = await fetch('/api/admin/users', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (data.success) {
        showNotification('Админ добавлен');
        e.target.reset();
        loadAdmins();
    } else showNotification(data.error || 'Ошибка');
}

function initAdminWS() {
    if (currentWs) currentWs.close();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    currentWs = new WebSocket(protocol + '//' + window.location.host);
    const badge = document.getElementById('ws-status-badge');

    currentWs.onopen = () => {
        currentWs.send(JSON.stringify({
            type: 'init',
            role: 'admin',
            token: localStorage.getItem('fcc_admin_token')
        }));
        if (badge) badge.textContent = 'ONLINE';
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
            if (currentWs && currentWs.readyState === 1) {
                currentWs.send(JSON.stringify({ type: 'heartbeat' }));
            }
        }, 8000);
    };
    currentWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'error' && data.error === 'admin_auth_required') {
            localStorage.removeItem('fcc_admin_token');
            const overlay = document.getElementById('admin-auth-overlay');
            if (overlay) overlay.style.display = 'flex';
            return;
        }
        if (data.type === 'clients_update') renderActiveClients(data.clients || []);
        if (data.type === 'new_message' && data.message) {
            if (messageBelongsToSelected(data.message)) appendAdminMsg(data.message);
            loadHub();
        }
        if (data.type === 'orders_update') loadOrders();
        if (data.type === 'notifications_update') loadDevNotifications();
    };
    currentWs.onclose = () => {
        if (badge) badge.textContent = 'OFF';
        setTimeout(initAdminWS, 3000);
    };
}

function messageBelongsToSelected(m) {
    if (!selectedClientId || !m) return false;
    const keys = new Set([String(selectedClientId)].concat(selectedLinkedIds.map(String)));
    return keys.has(String(m.client_id)) || keys.has(String(m.user_id)) || keys.has(String(m.thread_id));
}

async function openAdminChat(id) {
    selectedClientId = id;
    const row = document.querySelector('#active-clients-list .session-row[data-id="' + id + '"]');
    selectedLinkedIds = row && row.getAttribute('data-linked')
        ? row.getAttribute('data-linked').split(',').filter(Boolean)
        : [id];
    const title = document.getElementById('admin-chat-title');
    if (title) title.textContent = 'Чат · ' + id;
    const log = document.getElementById('admin-chat-log');
    if (log) log.innerHTML = '';
    try {
        const history = await api('/api/chat/history/' + encodeURIComponent(id));
        const list = Array.isArray(history) ? history : (history.messages || []);
        list.forEach(appendAdminMsg);
    } catch (e) {}
    if (currentWs && currentWs.readyState === 1) {
        currentWs.send(JSON.stringify({ type: 'mark_read', clientId: id }));
    }
}

function appendAdminMsg(m) {
    const log = document.getElementById('admin-chat-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'message ' + (m.sender === 'client' ? 'client' : 'admin');
    div.innerHTML = '<div class="msg-text">' + esc(m.content) + '</div>';
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

async function sendAdminChat(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('admin-chat-input');
    const fileInput = document.getElementById('admin-chat-file');
    if (!selectedClientId || !currentWs || currentWs.readyState !== 1) return;

    let text = input ? input.value.trim() : '';
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    if (!text && !file) return;

    try {
        if (file) {
            const data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const up = await fetch('/api/admin/upload', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ filename: file.name, mime: file.type, data })
            });
            const upData = await up.json().catch(() => ({}));
            if (!up.ok || !upData.url) {
                showNotification(upData.error || 'Не удалось загрузить файл');
                return;
            }

            const fileLine = `[Файл] ${file.name}: ${upData.url}`;
            text = text ? `${text}\n${fileLine}` : fileLine;
        }

        currentWs.send(JSON.stringify({
            type: 'admin_message',
            clientId: selectedClientId,
            content: text
        }));

        if (input) input.value = '';
        if (fileInput) fileInput.value = '';
    } catch (err) {
        console.error('[Admin] sendAdminChat:', err);
        showNotification('Ошибка отправки сообщения');
    }
}

function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showNotification(msg) {
    const notif = document.createElement('div');
    notif.className = 'fcc-toast';
    notif.textContent = msg;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}
document.getElementById('notif-target')?.addEventListener('change', function() {
    const idInput = document.getElementById('notif-target-id');
    if (idInput) {
        idInput.style.display = this.value === 'specific' ? 'block' : 'none';
    }
});
// ===== Уведомления =====
document.addEventListener('DOMContentLoaded', () => {
    const targetSelect = document.getElementById('notif-target');
    const targetIdInput = document.getElementById('notif-target-id');

    if (targetSelect && targetIdInput) {
        targetSelect.addEventListener('change', function () {
            targetIdInput.style.display = this.value === 'specific' ? 'block' : 'none';
            if (this.value === 'specific') {
                fillClientSelect();
            }
        });
    }
});

function fillClientSelect() {
    const input = document.getElementById('notif-target-id');
    if (!input) return;

    const rows = document.querySelectorAll('#active-clients-list .session-row');
    let datalist = document.getElementById('client-ids-list');

    if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = 'client-ids-list';
        document.body.appendChild(datalist);
        input.setAttribute('list', 'client-ids-list');
    }

    datalist.innerHTML = '';
    rows.forEach(row => {
        const spans = row.querySelectorAll('span');
        const id = spans[1] ? spans[1].textContent.trim() : null;
        if (id) {
            const opt = document.createElement('option');
            opt.value = id;
            datalist.appendChild(opt);
        }
    });

    if (rows.length === 0) {
        input.placeholder = 'Нет активных клиентов — открой вкладку Live Hub';
    } else {
        input.placeholder = 'Выбери или введи client_id';
    }
}


async function saveDevNotification(e) {
    if (e) e.preventDefault();

    const titleEl = document.getElementById('notif-title');
    const tagEl = document.getElementById('notif-tag');
    const dateEl = document.getElementById('notif-date');
    const textEl = document.getElementById('notif-text');
    const targetEl = document.getElementById('notif-target');
    const targetIdEl = document.getElementById('notif-target-id');

    const title = titleEl ? titleEl.value.trim() : '';
    const tag = tagEl ? tagEl.value : 'Инфо';
    const date = dateEl && dateEl.value.trim() ? dateEl.value.trim() : new Date().toLocaleDateString('ru-RU');
    const text = textEl ? textEl.value.trim() : '';
    const target = targetEl ? targetEl.value : 'all';
    const targetClientId = targetIdEl ? targetIdEl.value.trim() : '';

    if (!title || !text) {
        showNotification('Заголовок и текст обязательны');
        return;
    }
    if (target === 'specific' && !targetClientId) {
        showNotification('Укажите client_id');
        return;
    }

    try {
        const res = await fetch('/api/admin/notifications', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                title,
                tag,
                date,
                text,
                target,
                targetClientId: target === 'specific' ? targetClientId : null,
                expires_at: (document.getElementById('notif-expires') && document.getElementById('notif-expires').value) || null
            })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            showNotification(data.error || `Ошибка сервера (${res.status})`);
            return;
        }

        if (e && e.target && typeof e.target.reset === 'function') e.target.reset();
        if (targetIdEl) targetIdEl.style.display = 'none';
        showNotification('Уведомление отправлено!');
        await loadDevNotifications();
    } catch (err) {
        console.error('[Admin] saveDevNotification:', err);
        showNotification('Сервер уведомлений недоступен');
    }
}

window.saveDevNotification = saveDevNotification;
window.handleAdminLogin = handleAdminLogin;
window.logoutAdmin = logoutAdmin;
window.saveDevNotification = saveDevNotification;
window.deleteDevNotification = deleteDevNotification;
window.savePromotion = savePromotion;
window.deletePromo = deletePromo;
window.openPromoModal = openPromoModal;
window.closePromoModal = closePromoModal;
window.saveNews = saveNews;
window.deleteNews = deleteNews;
window.saveProject = saveProject;
window.deleteProject = deleteProject;
window.saveAllSiteTexts = saveAllSiteTexts;
window.createNewAdmin = createNewAdmin;
window.sendAdminChat = sendAdminChat;
window.openAdminChat = openAdminChat;
window.setOrderStatus = setOrderStatus;
window.deleteOrder = deleteOrder;
window.saveContacts = saveContacts;
window.savePlan = savePlan;
window.deletePlan = deletePlan;
window.saveElementMeta = saveElementMeta;