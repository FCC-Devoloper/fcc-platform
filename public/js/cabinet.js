/* ==========================================
   FCC MATRIX — CABINET SECURE CONTROLLER
   ========================================== */

(function () {
    'use strict';

    let DEV_NOTIFICATIONS = [];

    function showLiveNotificationToast(notification) {
        if (!notification) return;
        let toast = document.getElementById('fcc-live-notification-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'fcc-live-notification-toast';
            toast.style.position = 'fixed';
            toast.style.right = '20px';
            toast.style.bottom = '20px';
            toast.style.zIndex = '99999';
            toast.style.maxWidth = '360px';
            toast.style.padding = '14px 16px';
            toast.style.borderRadius = '12px';
            toast.style.background = 'rgba(15, 20, 30, .96)';
            toast.style.color = '#fff';
            toast.style.boxShadow = '0 10px 35px rgba(0,0,0,.35)';
            document.body.appendChild(toast);
        }
        toast.innerHTML = '<strong>' + escapeHtml(notification.title || 'Уведомление') + '</strong><div style="margin-top:6px;opacity:.86;">' + escapeHtml(notification.text || '') + '</div>';
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.remove(), 5000);
    }

    function handleIncomingNotification(notification) {
        if (!notification || !notification.id) return;
        if (!Array.isArray(DEV_NOTIFICATIONS)) DEV_NOTIFICATIONS = [];
        const exists = DEV_NOTIFICATIONS.some(item => String(item.id) === String(notification.id));
        if (!exists) DEV_NOTIFICATIONS.unshift(notification);
        renderNotifications();
        renderNotifications('modal-notifications-list');
        showLiveNotificationToast(notification);
    }

    async function loadNotifications() {
        const clientId = localStorage.getItem('fcc_client_id') || null;
        const token = localStorage.getItem('fcc_token');
        const headers = {};
        if (token) headers.Authorization = 'Bearer ' + token;
        try {
            const res = await fetch('/api/notifications' + (clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''), { headers });
            const data = await res.json();
            if (data.success) {
                DEV_NOTIFICATIONS = data.notifications || [];
                renderNotifications();
                renderNotifications('modal-notifications-list');
            }
        } catch (e) {
            console.error('[Cabinet] loadNotifications error', e);
        }
    }

    function renderNotifications(targetId = 'cab-notifications-list') {
        const container = document.getElementById(targetId);
        if (!container) return;

        if (DEV_NOTIFICATIONS.length === 0) {
            container.innerHTML = '<p class="muted" style="text-align:center; padding:20px;">Нет новых уведомлений.</p>';
            return;
        }

        const clientId = localStorage.getItem('fcc_client_id') || '';
        const user = getLoggedUser();
        const readerIds = [clientId, user && user.id].filter(Boolean);

        container.innerHTML = DEV_NOTIFICATIONS.map(item => {
            const isRead = (item.readBy || []).some(id => readerIds.includes(id));
            const tagClass = item.tag === 'Система' ? 'tag-system' :
                             item.tag === 'Фича' ? 'tag-feature' : 'tag-info';

            return `
                <div class="notification-card ${isRead ? 'read' : 'unread'}">
                    <div class="notification-card-header">
                        <span class="notification-badge ${tagClass}">${escapeHtml(item.tag)}</span>
                        <span class="notification-date">${escapeHtml(item.date)}</span>
                    </div>
                    <h4 class="notification-title">${escapeHtml(item.title)}</h4>
                    <p class="notification-body">${escapeHtml(item.text)}</p>
                    ${!isRead ? `<button class="btn-outline" style="margin-top:8px;padding:4px 10px;font-size:12px;" 
                        onclick="markNotificationRead('${item.id}')">Отметить прочитанным</button>` : 
                        '<span style="font-size:11px;color:#00ff88;margin-top:6px;display:inline-block;">✓ Прочитано</span>'}
                </div>
            `;
        }).join('');
    }

    async function markNotificationRead(id) {
        const clientId = localStorage.getItem('fcc_client_id');
        const token = localStorage.getItem('fcc_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;

        try {
            await fetch('/api/notifications/read', {
                method: 'POST',
                headers,
                body: JSON.stringify({ notificationId: id, clientId })
            });
            const n = DEV_NOTIFICATIONS.find(x => x.id === id);
            const user = getLoggedUser();
            const keys = [clientId, user && user.id].filter(Boolean);
            if (n) {
                if (!Array.isArray(n.readBy)) n.readBy = [];
                keys.forEach(k => { if (!n.readBy.includes(k)) n.readBy.push(k); });
            }
            renderNotifications();
            renderNotifications('modal-notifications-list');
        } catch (e) {}
    }

    const ORDER_LABELS = {
        new: 'Новая',
        in_progress: 'В работе',
        waiting_client: 'Ждём вас',
        done: 'Готово',
        rejected: 'Отказ',
        cancelled: 'Отмена'
    };

    async function loadOrders() {
        const token = localStorage.getItem('fcc_token');
        const clientId = localStorage.getItem('fcc_client_id');
        const headers = {};
        if (token) headers.Authorization = 'Bearer ' + token;
        try {
            const url = token ? '/api/orders/mine' : ('/api/orders?clientId=' + encodeURIComponent(clientId || ''));
            const res = await fetch(url, { headers });
            const data = await res.json();
            const orders = data.orders || (Array.isArray(data) ? data : []);
            renderOrders(orders);
        } catch (e) {
            console.error('[Cabinet] loadOrders', e);
        }
    }

    function renderOrders(orders) {
        const container = document.getElementById('cab-orders-list');
        if (!container) return;
        if (!orders || !orders.length) {
            container.innerHTML = '<p class="muted" style="text-align:center; padding:20px;">Заявок пока нет. Оформите первую с главной.</p>';
            return;
        }
        container.innerHTML = orders.map(o => `
            <div class="notification-card">
                <div class="notification-card-header">
                    <span class="notification-badge tag-info">${escapeHtml(ORDER_LABELS[o.status] || o.status)}</span>
                    <span class="notification-date">${escapeHtml(o.created_at ? new Date(o.created_at).toLocaleDateString('ru-RU') : '')}</span>
                </div>
                <h4 class="notification-title">${escapeHtml(o.title)}</h4>
                <p class="notification-body">${escapeHtml(o.description || o.category || '')}</p>
                ${o.rejection_reason ? '<p class="notification-body">Причина: ' + escapeHtml(o.rejection_reason) + '</p>' : ''}
                ${o.result_url ? '<p class="notification-body"><a href="' + escapeHtml(o.result_url) + '" target="_blank" rel="noopener">Результат</a></p>' : ''}
            </div>
        `).join('');
    }

    function handleOrderStatus(order) {
        if (!order) return;
        showLiveNotificationToast({
            title: 'Заявка обновлена',
            text: (order.title || 'Заявка') + ' — ' + (ORDER_LABELS[order.status] || order.status)
        });
        loadOrders();
    }

    function getLoggedUser() {
        const userRaw = localStorage.getItem('fcc_user');
        if (!userRaw) return null;
        try {
            return JSON.parse(userRaw);
        } catch (e) {
            console.error('[Cabinet] Failed to parse user session:', e);
            localStorage.removeItem('fcc_user');
            return null;
        }
    }

    function updateHeaderUI(user) {
        const wrapper = document.getElementById('auth-btn-wrapper');
        if (!wrapper) return;

        if (user) {
            const username = user.username || 'Пользователь';
            const initials = username.substring(0, 2).toUpperCase();
            wrapper.innerHTML = `
                <button class="btn-user-profile" type="button" onclick="openCabinetModal()">
                    <span class="avatar-mini">${initials}</span>
                    <span class="user-name">${escapeHtml(username)}</span>
                </button>
            `;
        } else {
            wrapper.innerHTML = `
                <button class="btn-outline" type="button" id="auth-header-btn" onclick="openAuthModal()">Вход</button>
            `;
        }
    }

    function renderUserCabinet(user) {
        const guestBox = document.getElementById('cabinet-guest');
        const userBox = document.getElementById('cabinet-user');

        if (guestBox) guestBox.style.display = 'none';
        if (userBox) userBox.style.display = 'grid';

        const username = user.username || 'Пользователь';
        const userId = user.id || user.userId || '—';
        const guestId = localStorage.getItem('fcc_client_id') || '—';
        const role = user.role || 'client';

        setText('cab-username', username);
        setText('cab-user-id', userId);
        setText('cab-guest-id', guestId);
        setText('cab-role', role);

        const avatarEl = document.getElementById('cab-avatar');
        if (avatarEl) {
            avatarEl.textContent = username.substring(0, 2).toUpperCase();
        }
    }

    function renderGuestCabinet() {
        const guestBox = document.getElementById('cabinet-guest');
        const userBox = document.getElementById('cabinet-user');

        if (userBox) userBox.style.display = 'none';
        if (guestBox) guestBox.style.display = 'block';
    }

    // Добавлена функция инициализации кабинета
    function initCabinet() {
        const user = getLoggedUser();
        updateHeaderUI(user);

        if (user) {
            renderUserCabinet(user);
            loadNotifications();
            loadOrders();
        } else {
            renderGuestCabinet();
        }
    }

    function openCabinetModal() {
        const user = getLoggedUser();
        if (!user) {
            if (typeof window.openAuthModal === 'function') window.openAuthModal();
            return;
        }

        const modal = document.getElementById('cabinet-modal');
        if (!modal) return;

        const username = user.username || 'Пользователь';
        const userId = user.id || user.userId || '—';
        const guestId = localStorage.getItem('fcc_client_id') || '—';
        const role = user.role || 'client';

        setText('modal-username', username);
        setText('modal-user-id', userId);
        setText('modal-guest-id', guestId);
        setText('modal-role', role);

        const avatarEl = document.getElementById('modal-avatar');
        if (avatarEl) {
            avatarEl.textContent = username.substring(0, 2).toUpperCase();
        }

        modal.style.display = 'flex';
        
        loadNotifications(); // ← Запрашиваем уведомления при открытии модального окна
    }

    function closeCabinetModal() {
        const modal = document.getElementById('cabinet-modal');
        if (modal) modal.style.display = 'none';
    }

    function handleLogout() {
        if (!confirm('Вы действительно хотите выйти из аккаунта?')) return;
        if (typeof window.resetGuestSession === 'function') {
            window.resetGuestSession();
        } else {
            localStorage.removeItem('fcc_token');
            localStorage.removeItem('fcc_user');
            localStorage.removeItem('fcc_canonical_id');
        }
        closeCabinetModal();
        updateHeaderUI(null);
        renderGuestCabinet();
        if (typeof window.updateAuthUI === 'function') {
            window.updateAuthUI();
        }
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Exports
    window.updateCabinetUI = initCabinet;
    window.markNotificationRead = markNotificationRead;
    window.reloadNotifications = loadNotifications;
    window.handleIncomingNotification = handleIncomingNotification;
    window.reloadCabinetOrders = loadOrders;
    window.handleOrderStatus = handleOrderStatus;
    window.handleCabinetLogout = handleLogout;
    window.openCabinetModal = openCabinetModal;
    window.closeCabinetModal = closeCabinetModal;

    document.addEventListener('DOMContentLoaded', initCabinet);
})();




function openDeleteAccountPrompt() {
    let modal = document.getElementById('fcc-delete-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'fcc-delete-modal';
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        modal.innerHTML =
            '<div class="modal-content" style="max-width:360px;text-align:center;">' +
            '<h3 style="margin:0 0 10px;">Удалить аккаунт?</h3>' +
            '<p class="muted" style="font-size:14px;line-height:1.45;margin:0 0 18px;">Сообщения очистятся, заявки обезличатся. Это действие необратимо.</p>' +
            '<div style="display:flex;gap:10px;justify-content:center;">' +
            '<button type="button" class="btn-outline" id="fcc-delete-cancel">Отмена</button>' +
            '<button type="button" class="btn-danger-outline" id="fcc-delete-confirm">Удалить</button>' +
            '</div></div>';
        document.body.appendChild(modal);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeDeleteAccountModal();
        });
        document.getElementById('fcc-delete-cancel').onclick = closeDeleteAccountModal;
        document.getElementById('fcc-delete-confirm').onclick = function () {
            closeDeleteAccountModal();
            handleDeleteAccount();
        };
    }
    modal.style.display = 'flex';
}
function closeDeleteAccountModal() {
    const modal = document.getElementById('fcc-delete-modal');
    if (modal) modal.style.display = 'none';
}
window.openDeleteAccountPrompt = openDeleteAccountPrompt;
window.closeDeleteAccountModal = closeDeleteAccountModal;

async function handleDeleteAccount() {
    const token = localStorage.getItem('fcc_token');
    if (!token) {
        if (typeof showToast === 'function') showToast('Нужно войти в аккаунт', 'error');
        else alert('Нужно войти в аккаунт');
        return false;
    }
    try {
        const u = JSON.parse(localStorage.getItem('fcc_user') || '{}');
        if (u && u.role === 'admin') {
            alert('Админ-аккаунт здесь не удаляется.');
            return false;
        }
    } catch (e) {}

    try {
        const res = await fetch('/api/auth/account', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({})
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.error || ('Не удалось удалить (' + res.status + ')'));
            return false;
        }
        localStorage.removeItem('fcc_token');
        localStorage.removeItem('fcc_user');
        localStorage.removeItem('fcc_client_id');
        localStorage.removeItem('fcc_admin_token');
        if (typeof window.resetGuestSession === 'function') window.resetGuestSession();
        window.location.href = '/';
    } catch (err) {
        alert('Ошибка сети');
    }
    return false;
}
window.handleDeleteAccount = handleDeleteAccount;
