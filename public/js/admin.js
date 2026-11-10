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


// Если токен просрочен или недействителен, сервер отвечает code:'auth_required' — тогда выходим на страницу входа.
let _sessionExpiring = false;
function handleSessionExpired() {
    if (_sessionExpiring) return;
    _sessionExpiring = true;
    localStorage.removeItem('fcc_admin_token');
    document.cookie = 'fcc_admin_token=; path=/; max-age=0';
    showNotification('Сессия истекла. Войдите заново.');
    setTimeout(() => window.location.reload(), 1200);
}
const _origFetch = window.fetch.bind(window);
window.fetch = async function (input, init) {
    const res = await _origFetch(input, init);
    const url = String((input && input.url) || input || '');
    if ((res.status === 401 || res.status === 403) && url.indexOf('/api/admin') === 0) {
        res.clone().json().then((d) => { if (d && d.code === 'auth_required') handleSessionExpired(); }).catch(() => {});
    }
    return res;
};

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
        const res = await fetch('/api/auth/admin-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        
        // Строгая валидация ролей сервера
        if (res.ok && data.success && data.role === 'admin' && data.token) {
            document.cookie = 'fcc_admin_token=' + encodeURIComponent(data.token) + '; path=/; SameSite=Lax; max-age=' + (7*24*3600);
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
            document.cookie = 'fcc_admin_token=; path=/; max-age=0';
            fetch('/api/auth/admin-logout', { method: 'POST' }).catch(() => {});
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
            if (target === 'site-cms') loadSiteTexts();
            if (target === 'orders') loadOrders();
            if (target === 'learning-center') loadLearningCenter();
            if (target === 'users') { loadAdmins(); loadDevsList(); }
            if (target === 'team') loadTeamAdmin();
            if (target === 'visual') initVisualEditor();
            if (target === 'backgrounds' && window.initBackgroundsTab) window.initBackgroundsTab();
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
    return res.json().catch(() => ({}));
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
            '<div class="session-row-wrap" style="display:flex;gap:6px;align-items:stretch;margin-bottom:6px;">' +
            '<button type="button" class="session-row" style="flex:1;" data-id="' + esc(id) + '" data-linked="' + esc(linked) + '" onclick="openAdminChat(\'' + esc(id) + '\')">' +
            '<span class="dot ' + onClass + '"></span>' +
            '<div style="text-align:left;flex:1;min-width:0;">' +
            '<strong style="color:' + (registered ? '#00ff9d' : '#ddd') + ';">' + esc(displayName) + '</strong>' +
            preview +
            '</div>' +
            roleBadge +
            (c.unread ? '<b class="unread-badge">' + c.unread + '</b>' : '') +
            '</button>' +
            '<button type="button" class="btn-danger" style="padding:6px 10px;" title="Удалить клиента" onclick="deleteClientFromHub(\'' + esc(id) + '\', ' + (registered ? 'true' : 'false') + ')">✕</button>' +
            '</div>'
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

        container.innerHTML = list.map(p => {
            const pos = esc(p.position || 'BOTTOM');
            const vis = esc(p.visibility || 'VISIBLE');
            const active = p.is_active === 0 ? 'off' : 'on';
            return '<div class="list-row promo-admin-card">' +
                '<div class="promo-main-info">' +
                '<div class="promo-head">' +
                '<span class="promo-badge-red">' + esc(p.discount || '-0%') + '</span>' +
                '<div><strong>' + esc(p.title_ru || p.title) + '</strong>' +
                '<div class="promo-target-text">На что: ' + esc(p.target || 'Все услуги') + '</div></div></div>' +
                '<p class="muted" style="margin: 8px 0 0;">' + esc(p.description_ru || p.desc || '') + '</p>' +
                '<p class="muted" style="margin: 4px 0 0; font-size:12px;">' +
                esc(p.start_date || '—') + ' → ' + esc(p.end_date || 'без срока') +
                ' · <b>' + pos + '</b> · <b>' + vis + '</b></p></div>' +
                '<div style="display:flex; gap:6px; flex-wrap:wrap;">' +
                '<button type="button" class="btn-action" onclick="editPromo(' + qa(p.id) + ')">Редакт.</button>' +
                '<button type="button" class="btn-action" onclick="openPromoModal(' +
                qa(p.title_ru || p.title || '') + ',' +
                qa(p.discount || '') + ',' +
                qa(p.target || '') + ',' +
                qa(p.description_ru || p.desc || '') +
                ')">Условия</button>' +
                '<button type="button" class="btn-danger" onclick="deletePromo(' + qa(p.id) + ')">Удалить</button>' +
                '</div></div>';
        }).join('');

    } catch (e) {}
}

async function savePromotion(e) {
    e.preventDefault();
    const existingId = (document.getElementById('promo-id') && document.getElementById('promo-id').value) || '';
    const payload = {
        id: existingId || undefined,
        title_ru: document.getElementById('promo-title').value.trim(),
        discount: document.getElementById('promo-discount').value.trim(),
        target: document.getElementById('promo-target').value.trim(),
        description_ru: document.getElementById('promo-desc').value.trim(),
        action_link: document.getElementById('promo-action-link').value.trim(),
        details_link: (document.getElementById('promo-details-link') && document.getElementById('promo-details-link').value.trim()) || '',
        position: (document.getElementById('promo-position') && document.getElementById('promo-position').value) || 'BOTTOM',
        visibility: (document.getElementById('promo-visibility') && document.getElementById('promo-visibility').value) || 'VISIBLE',
        start_date: (document.getElementById('promo-start') && document.getElementById('promo-start').value) || null,
        end_date: (document.getElementById('promo-end') && document.getElementById('promo-end').value) || null,
        is_active: 1
    };

    try {
        const res = await fetch('/api/admin/promotions', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showNotification(data.error || 'Ошибка сохранения акции');
            return;
        }
    } catch (err) {
        showNotification('Нет связи с сервером');
        return;
    }

    document.getElementById('form-promo').reset();
    if (document.getElementById('promo-id')) document.getElementById('promo-id').value = '';
    showNotification(existingId ? 'Акция обновлена' : 'Акция успешно создана');
    loadPromotions();
}

async function editPromo(id) {
    try {
        const data = await api('/api/admin/promotions');
        const list = (data && data.promotions) || [];
        const p = list.find(x => String(x.id) === String(id));
        if (!p) return showNotification('Акция не найдена');
        if (document.getElementById('promo-id')) document.getElementById('promo-id').value = p.id;
        document.getElementById('promo-title').value = p.title_ru || '';
        document.getElementById('promo-discount').value = p.discount || '';
        document.getElementById('promo-target').value = p.target || '';
        document.getElementById('promo-desc').value = p.description_ru || '';
        document.getElementById('promo-action-link').value = p.action_link || '';
        if (document.getElementById('promo-details-link')) document.getElementById('promo-details-link').value = p.details_link || '';
        if (document.getElementById('promo-position')) document.getElementById('promo-position').value = p.position || 'BOTTOM';
        if (document.getElementById('promo-visibility')) document.getElementById('promo-visibility').value = p.visibility || 'VISIBLE';
        if (document.getElementById('promo-start')) document.getElementById('promo-start').value = (p.start_date || '').slice(0, 10);
        if (document.getElementById('promo-end')) document.getElementById('promo-end').value = (p.end_date || '').slice(0, 10);
        showNotification('Редактирование: ' + (p.title_ru || p.id));
    } catch (e) {
        showNotification('Не удалось загрузить акцию');
    }
}
window.editPromo = editPromo;

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

async function loadOrders(folder) {
    try {
        if (!window._ordersFolder) window._ordersFolder = 'new';
        if (folder) window._ordersFolder = folder;
        const data = await api('/api/admin/orders', { headers: authHeaders() });
        const container = document.getElementById('orders-list-container');
        if (!container) return;
        const all = data.orders || [];
        const labels = {
            new: 'Новая', in_progress: 'В работе', waiting_client: 'Ждём',
            done: 'Готово', rejected: 'Отказ', cancelled: 'Отмена'
        };
        const colors = {
            new: '#5b8cff', in_progress: '#00c853', waiting_client: '#ffb300',
            done: '#00e5ff', rejected: '#ff5b4d'
        };
        let list = all;
        const f = window._ordersFolder;
        if (f === 'new') list = all.filter(o => o.status === 'new');
        else if (f === 'old') list = all.filter(o => o.status !== 'new');
        // all = no filter

        document.querySelectorAll('.orders-tab').forEach(btn => {
            const on = btn.getAttribute('data-folder') === f;
            btn.classList.toggle('active', on);
            btn.classList.toggle('btn-action', on);
            btn.classList.toggle('btn-outline', !on);
        });

        if (!list.length) {
            container.innerHTML = '<p class="muted">В этой папке пусто</p>';
            return;
        }

        // Compact scrollable list — tabs only filter, no client notify
        container.innerHTML =
            '<div class="orders-scroll">' +
            list.map(o => {
                const st = o.status || 'new';
                let actions = '';
                if (st === 'new') {
                    actions = '<button type="button" class="btn-action" onclick="setOrderStatus(\'' + o.id + '\',\'in_progress\')">В работе</button>' +
                        '<button type="button" onclick="setOrderStatus(\'' + o.id + '\',\'rejected\')">Отказ</button>' +
                        '<button type="button" onclick="promptAssign(\'' + o.id + '\')">Назначить</button>';
                } else if (st === 'in_progress' || st === 'waiting_client') {
                    actions = '<button type="button" onclick="setOrderStatus(\'' + o.id + '\',\'waiting_client\')">Ждём</button>' +
                        '<button type="button" class="btn-action" onclick="setOrderStatus(\'' + o.id + '\',\'done\')">Готово</button>' +
                        '<button type="button" onclick="setOrderStatus(\'' + o.id + '\',\'rejected\')">Отказ</button>' +
                        '<button type="button" onclick="promptAssign(\'' + o.id + '\')">Назначить</button>';
                } else if (st === 'rejected') {
                    actions = '<span class="muted" style="font-size:11px">~24ч</span>';
                }
                const desc = (o.description || '').slice(0, 120);
                return '<div class="list-row order-row compact" style="border-left:3px solid ' + (colors[st] || '#666') + '">' +
                    '<div style="flex:1;min-width:0">' +
                    '<div class="order-title-line"><strong>' + esc(o.title) + '</strong> ' +
                    '<span class="status-pill">' + esc(labels[st] || st) + '</span></div>' +
                    '<div class="muted order-meta">' + esc(o.contact || '') +
                    (o.client_name || o.client_id ? ' · ' + esc(o.client_name || o.client_id) : '') +
                    (o.assignee_id ? ' · → ' + esc(o.assignee_id) : '') + '</div>' +
                    (desc ? '<div class="muted order-desc">' + esc(desc) + (o.description && o.description.length > 120 ? '…' : '') + '</div>' : '') +
                    '</div>' +
                    '<div class="order-actions">' + actions + '</div></div>';
            }).join('') +
            '</div>';
    } catch (e) { console.error(e); }
}

document.addEventListener('click', (e) => {
    const tab = e.target.closest && e.target.closest('.orders-tab');
    if (tab) loadOrders(tab.getAttribute('data-folder'));
});

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

async function loadAdmins() {
    try {
        const data = await api('/api/admin/users', { headers: authHeaders() });
        const box = document.getElementById('admins-list');
        if (!box) return;
        const staff = (data.users || []).filter(u => u.role === 'admin' || u.role === 'dev');
        if (!staff.length) {
            box.innerHTML = '<p class="muted">Пока нет staff</p>';
            return;
        }
        const adminCount = staff.filter(u => u.role === 'admin').length;
        box.innerHTML = staff.map(u => {
            const canDelete = u.role === 'dev' || (u.role === 'admin' && adminCount > 1);
            return (
                '<div class="list-row staff-row" data-id="' + esc(u.id) + '">' +
                '<div style="flex:1">' +
                '<strong>' + esc(u.username) + '</strong> ' +
                '<span class="status-pill">' + esc(u.role) + '</span>' +
                (u.email ? '<div class="muted">' + esc(u.email) + '</div>' : '') +
                (u.access_key ? '<div class="muted">key: <code>' + esc(u.access_key) + '</code></div>' : '') +
                '<div class="muted">id: ' + esc(u.id) + '</div></div>' +
                '<div class="order-actions" style="display:flex;flex-wrap:wrap;gap:6px">' +
                '<button type="button" class="btn-outline" onclick="editStaff(\'' + esc(u.id) + '\')">Редактировать</button>' +
                (canDelete
                    ? '<button type="button" onclick="deleteStaff(\'' + esc(u.id) + '\',\'' + esc(u.username) + '\')">Удалить</button>'
                    : '<span class="muted" style="font-size:11px">корневой admin</span>') +
                '</div></div>'
            );
        }).join('');
    } catch (e) { console.error(e); }
}

async function createNewAdmin(e) {
    e.preventDefault();
    const username = document.getElementById('new-admin-user').value.trim();
    const password = document.getElementById('new-admin-pass').value;
    const email = (document.getElementById('new-admin-email') || {}).value || '';
    const inviteCode = (document.getElementById('new-admin-invite') || {}).value || '';
    if (!inviteCode) { showNotification('Нужен код приглашения'); return; }
    const res = await fetch('/api/admin/users', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ username, password, inviteCode, role: 'dev', email })
    });
    const data = await res.json().catch(() => ({}));
    const out = document.getElementById('new-user-result');
    if (!res.ok) {
        showNotification(data.error || 'Ошибка');
        if (out) out.textContent = data.error || 'Ошибка';
        return;
    }
    showNotification('Создан dev');
    let msg = 'role: ' + data.role + '\nid: ' + data.id;
    if (data.access_key) msg += '\nACCESS KEY: ' + data.access_key + '\n(вход: /dev.html или /team-portal.html)';
    if (out) out.textContent = msg;
    e.target.reset();
    loadAdmins();
}

async function editStaff(id) {
    const username = prompt('Новый логин (пусто = без изменений):');
    if (username === null) return;
    const email = prompt('Email (пусто = без изменений):');
    if (email === null) return;
    const password = prompt('Новый пароль (пусто = без изменений, мин. 4):');
    if (password === null) return;
    const regen = confirm('Перевыпустить access_key?');
    const body = {};
    if (username && username.trim()) body.username = username.trim();
    if (email !== undefined && email !== null) body.email = email.trim();
    if (password && password.trim().length >= 4) body.password = password.trim();
    if (regen) body.regenerate_key = true;
    if (!Object.keys(body).length) {
        showNotification('Нечего менять');
        return;
    }
    const res = await fetch('/api/admin/users/' + encodeURIComponent(id), {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        showNotification(data.error || 'Ошибка редактирования');
        return;
    }
    showNotification('Staff обновлён' + (data.user && data.user.access_key ? ' · key: ' + data.user.access_key : ''));
    loadAdmins();
}

async function deleteStaff(id, username) {
    if (!confirm('Удалить staff «' + (username || id) + '»? Это необратимо.')) return;
    const res = await fetch('/api/admin/users/' + encodeURIComponent(id), {
        method: 'DELETE', headers: authHeaders()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        showNotification(data.error || 'Не удалось удалить');
        return;
    }
    showNotification('Удалено');
    loadAdmins();
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
            document.cookie = 'fcc_admin_token=; path=/; max-age=0';
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

// Безопасная вставка значения в onclick="…": JSON + экранирование кавычек для HTML-атрибута
function qa(v) {
    return esc(JSON.stringify(String(v == null ? '' : v)));
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
window.createNewAdmin = createNewAdmin;
window.sendAdminChat = sendAdminChat;
window.openAdminChat = openAdminChat;
window.setOrderStatus = setOrderStatus;
window.deleteOrder = deleteOrder;
window.saveContacts = saveContacts;

async function deleteClientFromHub(id, isRegistered) {
    if (!id) return;
    if (!confirm('Полностью удалить клиента и связанные данные? Это необратимо.')) return;
    try {
        let res;
        if (isRegistered) {
            res = await fetch('/api/admin/clients/' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders() });
        } else {
            res = await fetch('/api/admin/guests/' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders() });
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showNotification(data.error || 'Не удалось удалить');
            return;
        }
        showNotification('Клиент удалён');
        loadHub();
    } catch (e) {
        showNotification('Ошибка сети');
    }
}
window.deleteClientFromHub = deleteClientFromHub;


async function sendDevMessage(e) {
    e.preventDefault();
    const to_user_id = document.getElementById('devmsg-to').value.trim();
    const text = document.getElementById('devmsg-text').value.trim();
    const res = await fetch('/api/admin/dev-messages', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ to_user_id, text })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showNotification(data.error || 'Ошибка');
    showNotification('Сообщение отправлено');
    e.target.reset();
}
async function assignOrder(orderId, assigneeId) {
    const res = await fetch('/api/admin/orders/' + encodeURIComponent(orderId) + '/assign', {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ assignee_id: assigneeId || null })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showNotification(data.error || 'Не удалось назначить');
    showNotification('Назначено');
    loadOrders();
}
window.sendDevMessage = sendDevMessage;
window.assignOrder = assignOrder;


function promptAssign(orderId) {
    const id = prompt('user_id разработчика (роль dev). Пусто = снять назначение');
    if (id === null) return;
    assignOrder(orderId, id.trim() || null);
}
window.promptAssign = promptAssign;



async function loadLearningCenterMapSettings() {
    const form = document.getElementById('learning-center-map-form');
    if (!form) return;
    try {
        const data = await api('/api/admin/learning-center-map', { headers: authHeaders() });
        const loc = data.location || {};
        document.getElementById('lc-map-city').value = loc.city || 'Гиссар';
        document.getElementById('lc-map-village').value = loc.village || '';
        document.getElementById('lc-map-address').value = loc.address || '';
        document.getElementById('lc-map-lat').value = Number(loc.latitude || 38.52504);
        document.getElementById('lc-map-lon').value = Number(loc.longitude || 68.55124);
        form.onsubmit = async (e) => {
            e.preventDefault();
            const msg = document.getElementById('lc-map-settings-msg');
            const res = await fetch('/api/admin/learning-center-map', {
                method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    city: document.getElementById('lc-map-city').value,
                    village: document.getElementById('lc-map-village').value,
                    address: document.getElementById('lc-map-address').value,
                    latitude: document.getElementById('lc-map-lat').value,
                    longitude: document.getElementById('lc-map-lon').value
                })
            });
            const out = await res.json().catch(() => ({}));
            if (!res.ok) { if (msg) msg.textContent = out.error || 'Ошибка'; return; }
            if (msg) msg.textContent = 'Сохранено ✓';
        };
    } catch (e) {}
}

async function loadLearningCenter() {
    const box = document.getElementById('learning-center-admin-list');
    const statsBox = document.getElementById('learning-center-admin-stats');
    if (!box) return;
    try {
        const data = await api('/api/admin/learning-center', { headers: authHeaders() });
        if (!data.success) throw new Error(data.error || 'error');
        const s = data.stats || {};
        if (statsBox) {
            statsBox.innerHTML = [
                ['Всего', s.total || 0],
                ['Новые', s.new || 0],
                ['Связались', s.contacted || 0],
                ['Приняты', s.approved || 0],
                ['Отклонены', s.rejected || 0],
                ['Базовый', (s.tariffs || {}).basic || 0],
                ['Стандарт', (s.tariffs || {}).standard || 0],
                ['Интенсив', (s.tariffs || {}).intensive || 0]
            ].map(x => '<div class="card" style="padding:14px"><b style="font-size:1.35rem">' + esc(x[1]) + '</b><div class="muted" style="margin-top:4px">' + esc(x[0]) + '</div></div>').join('');
        }
        const list = data.applications || [];
        if (!list.length) {
            box.innerHTML = '<p class="muted">Заявок Learning Center пока нет.</p>';
            return;
        }
        const labels = { new: 'Новая', contacted: 'Связались', approved: 'Принят', rejected: 'Отклонён', completed: 'Завершён' };
        box.innerHTML = list.map(a => {
            const loc = a.location || {};
            const history = Array.isArray(a.history) ? a.history : [];
            const comment = history.length ? history[history.length - 1].comment : '';
            return '<div class="list-row" style="display:block;margin-bottom:10px">' +
                '<div style="display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap">' +
                '<div><strong>' + esc(a.student_name) + '</strong> — ' + esc(a.tariff_name || a.tariff) + ' <span class="status-pill">' + esc(labels[a.status] || a.status) + '</span>' +
                '<div class="muted" style="font-size:12px;margin-top:4px">Родитель: ' + esc(a.parent_name) + ' · ' + esc(a.phone) + (a.email ? ' · ' + esc(a.email) : '') + '</div>' +
                '<div class="muted" style="font-size:12px">Место: ' + esc(loc.city || 'Гиссар') + (loc.village ? ' · ' + esc(loc.village) : '') + (loc.address ? ' · ' + esc(loc.address) : '') + '</div>' +
                '<div class="muted" style="font-size:12px">Браузер: ' + esc(a.browser || '—') + ' · Устройство: ' + esc(a.device || '—') + '</div>' +
                '<div class="muted" style="font-size:12px">Создано: ' + esc(String(a.created_at || '').replace('T',' ').slice(0,19)) + '</div>' +
                (a.comment ? '<p style="margin:8px 0 0">Комментарий: ' + esc(a.comment) + '</p>' : '') +
                (comment ? '<p class="muted" style="margin:5px 0 0">Последняя отметка: ' + esc(comment) + '</p>' : '') +
                '</div>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                ['new','contacted','approved','rejected','completed'].map(st => '<button type="button" class="btn-outline" onclick="setLearningCenterStatus(\'' + esc(a.id) + '\',\'' + st + '\')">' + esc(labels[st]) + '</button>').join('') +
                '<button type="button" class="btn-danger" onclick="deleteLearningCenterApplication(\'' + esc(a.id) + '\')">Удалить</button>' +
                '</div></div></div>';
        }).join('');
    } catch (e) {
        box.innerHTML = '<p class="muted">Не удалось загрузить заявки Learning Center.</p>';
    }
}

async function setLearningCenterStatus(id, status) {
    const comment = prompt('Комментарий к изменению статуса (необязательно):', '') || '';
    const res = await fetch('/api/admin/learning-center/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status, comment })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showNotification(data.error || 'Ошибка');
    showNotification('Статус Learning Center обновлён');
    loadLearningCenter();
}

async function deleteLearningCenterApplication(id) {
    if (!confirm('Удалить заявку Learning Center?')) return;
    const res = await fetch('/api/admin/learning-center/' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showNotification(data.error || 'Ошибка');
    showNotification('Заявка удалена');
    loadLearningCenter();
}
window.loadLearningCenter = loadLearningCenter;
window.setLearningCenterStatus = setLearningCenterStatus;
window.deleteLearningCenterApplication = deleteLearningCenterApplication;

async function loadDevsList() {
    const box = document.getElementById('admins-list');
    if (!box) return;
    try {
        const data = await api('/api/admin/devs', { headers: authHeaders() });
        const devs = data.users || [];
        if (!devs.length) return;
        box.innerHTML += '<h3 style="margin-top:16px">Разработчики (dev)</h3>' + devs.map(u => (
            '<div class="list-row"><strong>' + esc(u.username) + '</strong> <span class="status-pill">dev</span>' +
            (u.access_key ? '<div class="muted" style="font-size:11px">key: ' + esc(u.access_key) + '</div>' : '') +
            (u.id ? '<div class="muted" style="font-size:11px">id: ' + esc(u.id) + '</div>' : '') +
            '</div>'
        )).join('');
    } catch (e) {}
}
window.loadDevsList = loadDevsList;
