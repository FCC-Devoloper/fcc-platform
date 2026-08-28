
function fccWhenReady(fn) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn);
    } else {
        fn();
    }
}

let socket = null;
let clientId = null;
let unread = 0;
let reconnectTimer = null;

function getAuthToken() {
    return localStorage.getItem('fcc_token') || '';
}

function getLoggedUser() {
    try {
        const raw = localStorage.getItem('fcc_user');
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function getOrCreateClientId() {
    let id = localStorage.getItem('fcc_client_id');
    if (id && id.length > 8) return id;

    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        id = 'guest_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
    } else {
        id = 'guest_' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();
    }

    localStorage.setItem('fcc_client_id', id);
    return id;
}

clientId = getOrCreateClientId();

fccWhenReady(() => {
    initWebSocket();
});

function initWebSocket() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    try {
        socket = new WebSocket(protocol + '//' + window.location.host);
    } catch (e) {
        scheduleReconnect();
        return;
    }

    socket.onopen = () => {
        const user = getLoggedUser();
        socket.send(JSON.stringify({
            type: 'init',
            clientId: clientId,
            token: getAuthToken() || undefined,
            name: user ? (user.username || user.name) : undefined
        }));
    };

    socket.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            return;
        }

        if (data.type === 'init_ok') {
            if (data.clientId) {
                clientId = data.clientId;
                localStorage.setItem('fcc_client_id', clientId);
            }
            if (data.canonicalId) {
                localStorage.setItem('fcc_canonical_id', data.canonicalId);
            }

            if (typeof data.online === 'boolean' && typeof updateServerStatus === 'function') {
                updateServerStatus(data.online);
            }

            if (Array.isArray(data.history) && data.history.length) {
                const container = document.getElementById('chat-messages');
                if (container) {
                    container.innerHTML = '';
                    data.history.forEach(m => {
                        const sender = m.sender === 'client' ? 'client' :
                                      (m.sender === 'admin' ? 'admin' : 'bot');
                        appendMessage(sender, m.content, formatTime(m.created_at));
                    });
                }
            }
        }
        else if (data.type === 'new_message' && data.message) {
            const m = data.message;
            if (m.sender === 'client') return;

            const sender = m.sender === 'admin' ? 'admin' : 'bot';
            appendMessage(sender, m.content, formatTime(m.created_at));
            bumpUnread();
        }
        else if (data.type === 'message') {
            appendMessage(data.sender || 'bot', data.text || data.content, data.time);
            bumpUnread();
        }
        else if (data.type === 'new_notification' && data.notification) {
            if (typeof window.handleIncomingNotification === 'function') {
                window.handleIncomingNotification(data.notification);
            } else {
                showClientNotificationToast(data.notification);
            }
        }
        else if (data.type === 'order_status' && data.order) {
            if (typeof window.handleOrderStatus === 'function') {
                window.handleOrderStatus(data.order);
            } else {
                showClientNotificationToast({
                    title: 'Заявка обновлена',
                    text: (data.order.title || 'Заявка') + ' → ' + (data.order.status || '')
                });
            }
        }
        else if (data.type === 'status' || data.type === 'status_update') {
            if (typeof updateServerStatus === 'function') {
                updateServerStatus(data.online);
            }
        }
    };

    socket.onclose = () => scheduleReconnect();
    socket.onerror = () => {};
}

function reconnectChatIdentity() {
    clientId = getOrCreateClientId();
    if (socket && socket.readyState === 1) {
        try { socket.close(); } catch (e) {}
    } else {
        initWebSocket();
    }
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(initWebSocket, 3000);
}

function showClientNotificationToast(notification) {
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

function formatTime(iso) {
    if (!iso) {
        return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    try {
        return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '';
    }
}

function bumpUnread() {
    const drawer = document.getElementById('chat-drawer');
    if (drawer && drawer.classList.contains('active')) return;

    unread += 1;
    const badge = document.getElementById('unread-count');
    if (!badge) return;
    badge.style.display = 'flex';
    badge.textContent = String(unread);
}

function toggleChatWindow() {
    if (typeof closePromoPopup === 'function') closePromoPopup();
    const drawer = document.getElementById('chat-drawer');
    if (!drawer) return;

    drawer.classList.toggle('active');

    if (drawer.classList.contains('active')) {
        unread = 0;
        const badge = document.getElementById('unread-count');
        if (badge) badge.style.display = 'none';
    }
}

function sendChatMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    appendMessage('client', text, time);

    if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({
            type: 'message',
            clientId: clientId,
            content: text
        }));
    }

    input.value = '';
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '&#39;');
}

function appendMessage(sender, text, time) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const cls = (sender === 'user' || sender === 'client') ? 'client' :
                (sender === 'admin' ? 'admin' : 'bot');

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message ' + cls;
    msgDiv.innerHTML =
        '<div class="msg-text">' + escapeHtml(text) + '</div>' +
        '<div class="msg-time">' + escapeHtml(time || '') + '</div>';

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

window.toggleChatWindow = toggleChatWindow;
window.sendChatMessage = sendChatMessage;
window.openDirectChat = toggleChatWindow;
window.reconnectChatIdentity = reconnectChatIdentity;
window.getOrCreateClientId = getOrCreateClientId;
