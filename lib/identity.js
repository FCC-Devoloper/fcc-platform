'use strict';

/**
 * ONE PERSON = ONE CLIENT RECORD = ONE IDENTITY
 *
 * Dual-key lookup: after register/login the canonical id is user.id.
 * Guest ids stay on messages/orders (client_id) and on user.linked_guest_ids.
 */

function ensureUserShape(user) {
    if (!user) return user;
    if (!Array.isArray(user.linked_guest_ids)) user.linked_guest_ids = [];
    return user;
}

function allKeysForUser(user) {
    const keys = new Set();
    if (!user) return keys;
    if (user.id) keys.add(String(user.id));
    (user.linked_guest_ids || []).forEach((id) => {
        if (id) keys.add(String(id));
    });
    return keys;
}

function belongsToIdentity(record, keys) {
    if (!record || !keys || !keys.size) return false;
    const fields = [record.user_id, record.client_id, record.guest_id, record.thread_id, record.id];
    return fields.some((v) => v != null && keys.has(String(v)));
}

function resolveIdentity(store, anyId) {
    const empty = { kind: 'unknown', id: null, user: null, guest: null, keys: new Set() };
    if (!anyId) return empty;

    const id = String(anyId);
    const users = store.users || [];
    const guests = store.guests || [];

    let user = users.find((u) => String(u.id) === id);
    if (user) {
        ensureUserShape(user);
        return { kind: 'user', id: user.id, user, guest: null, keys: allKeysForUser(user) };
    }

    user = users.find((u) => (u.linked_guest_ids || []).map(String).includes(id));
    if (user) {
        ensureUserShape(user);
        return { kind: 'user', id: user.id, user, guest: null, keys: allKeysForUser(user) };
    }

    const guest = guests.find((g) => String(g.client_id) === id);
    if (guest) {
        if (guest.user_id) {
            user = users.find((u) => String(u.id) === String(guest.user_id));
            if (user) {
                ensureUserShape(user);
                if (!user.linked_guest_ids.map(String).includes(String(guest.client_id))) {
                    user.linked_guest_ids.push(guest.client_id);
                }
                return { kind: 'user', id: user.id, user, guest, keys: allKeysForUser(user) };
            }
        }
        return {
            kind: 'guest',
            id: guest.client_id,
            user: null,
            guest,
            keys: new Set([String(guest.client_id)])
        };
    }

    return { kind: 'guest', id, user: null, guest: null, keys: new Set([id]) };
}

function messagesFor(store, anyId) {
    const ident = resolveIdentity(store, anyId);
    return (store.messages || [])
        .filter((m) => belongsToIdentity(m, ident.keys))
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
}

function ordersFor(store, anyId) {
    const ident = resolveIdentity(store, anyId);
    return (store.orders || []).filter((o) => !o.deleted_at && belongsToIdentity(o, ident.keys));
}

function stampRecord(record, ident) {
    if (!record || !ident) return record;
    if (ident.kind === 'user' && ident.user) {
        record.user_id = ident.user.id;
        record.thread_id = ident.user.id;
        if (!record.client_id) record.client_id = ident.user.id;
    } else if (ident.id) {
        record.thread_id = ident.id;
        if (!record.client_id) record.client_id = ident.id;
    }
    return record;
}

function mergeGuestIntoUser(store, clientId, userId, username) {
    if (!clientId || !userId) return { merged: false, mergedGuestId: null };

    if (!store.guests) store.guests = [];
    if (!store.messages) store.messages = [];
    if (!store.orders) store.orders = [];
    if (!store.users) store.users = [];

    const user = store.users.find((u) => String(u.id) === String(userId));
    if (!user) return { merged: false, mergedGuestId: null };
    ensureUserShape(user);

    const guestId = String(clientId);
    if (guestId === String(userId)) {
        user.last_seen = new Date().toISOString();
        if (username) user.name = username;
        return { merged: false, mergedGuestId: null };
    }

    if (!user.linked_guest_ids.map(String).includes(guestId)) {
        user.linked_guest_ids.push(guestId);
    }

    store.messages.forEach((m) => {
        if (String(m.client_id) === guestId || String(m.thread_id) === guestId) {
            m.user_id = userId;
            m.thread_id = userId;
        }
    });

    store.orders.forEach((o) => {
        if (String(o.client_id) === guestId || String(o.guest_id) === guestId || String(o.thread_id) === guestId) {
            o.user_id = userId;
            o.thread_id = userId;
            if (username) o.client_name = username;
        }
    });

    store.guests = store.guests.filter((g) => String(g.client_id) !== guestId);

    if (username) user.name = username;
    user.last_seen = new Date().toISOString();

    return { merged: true, mergedGuestId: guestId };
}

function migrateIdentities(store) {
    const report = { guestsMerged: 0, messagesStamped: 0, ordersStamped: 0, zombieGuestsRemoved: 0 };

    (store.users || []).forEach(ensureUserShape);

    const zombies = (store.guests || []).filter((g) => g.user_id);
    zombies.forEach((g) => {
        const result = mergeGuestIntoUser(store, g.client_id, g.user_id, g.name);
        if (result.merged) report.guestsMerged += 1;
    });

    (store.messages || []).forEach((m) => {
        if (m.user_id) return;
        const ident = resolveIdentity(store, m.client_id);
        if (ident.kind === 'user' && ident.user) {
            m.user_id = ident.user.id;
            m.thread_id = ident.user.id;
            report.messagesStamped += 1;
        } else if (!m.thread_id) {
            m.thread_id = m.client_id;
        }
    });

    (store.orders || []).forEach((o) => {
        if (!o.user_id) {
            const ident = resolveIdentity(store, o.client_id || o.guest_id);
            if (ident.kind === 'user' && ident.user) {
                o.user_id = ident.user.id;
                o.thread_id = ident.user.id;
                if (!o.client_name) o.client_name = ident.user.name || ident.user.username;
                report.ordersStamped += 1;
            } else if (!o.thread_id) {
                o.thread_id = o.client_id;
            }
        }
        if (!Array.isArray(o.status_history) || !o.status_history.length) {
            o.status_history = [{
                status: o.status || 'new',
                at: o.created_at || new Date().toISOString(),
                by: 'system',
                reason: null
            }];
        }
    });

    const before = (store.guests || []).length;
    store.guests = (store.guests || []).filter((g) => !g.user_id);
    report.zombieGuestsRemoved = before - store.guests.length;

    return report;
}

function isSocketOnline(clientsMap, ident) {
    if (!clientsMap || !ident || !ident.keys) return false;
    for (const key of ident.keys) {
        const set = clientsMap.get(key);
        if (set && set.size > 0) return true;
    }
    return false;
}

function bindSocket(clientsMap, ident, ws) {
    if (!clientsMap || !ident || !ws) return;
    ident.keys.forEach((key) => {
        if (!clientsMap.has(key)) clientsMap.set(key, new Set());
        clientsMap.get(key).add(ws);
    });
}

function unbindSocket(clientsMap, ident, ws) {
    if (!clientsMap || !ident || !ws) return [];
    const emptied = [];
    ident.keys.forEach((key) => {
        const set = clientsMap.get(key);
        if (!set) return;
        set.delete(ws);
        if (set.size === 0) {
            clientsMap.delete(key);
            emptied.push(key);
        }
    });
    return emptied;
}

function sendToIdentity(clientsMap, ident, data) {
    if (!clientsMap || !ident) return 0;
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    const sent = new Set();
    ident.keys.forEach((key) => {
        const sockets = clientsMap.get(key);
        if (!sockets) return;
        sockets.forEach((ws) => {
            if (sent.has(ws)) return;
            sent.add(ws);
            if (ws.readyState === 1) ws.send(msg);
        });
    });
    return sent.size;
}

function buildClientList(store, clientsMap) {
    const guests = store.guests || [];
    const users = store.users || [];
    const messages = store.messages || [];
    const orders = store.orders || [];
    const result = [];
    const linkedGuestIds = new Set();

    users.forEach((u) => {
        (u.linked_guest_ids || []).forEach((id) => linkedGuestIds.add(String(id)));
    });

    guests.forEach((g) => {
        if (g.user_id) return;
        if (linkedGuestIds.has(String(g.client_id))) return;

        const ident = resolveIdentity(store, g.client_id);
        const clientMsgs = messages.filter((m) => belongsToIdentity(m, ident.keys));
        const lastMsg = clientMsgs[clientMsgs.length - 1];
        const unread = clientMsgs.filter((m) => m.sender === 'client' && !m.is_read).length;
        const clientOrders = orders.filter((o) => !o.deleted_at && belongsToIdentity(o, ident.keys));
        const online = isSocketOnline(clientsMap, ident);

        result.push({
            id: g.client_id,
            client_id: g.client_id,
            user_id: null,
            name: g.name || g.client_id,
            username: null,
            is_guest: true,
            is_registered: false,
            is_online: online ? 1 : 0,
            last_seen: g.last_seen,
            last_message: lastMsg ? lastMsg.content : null,
            last_message_time: lastMsg ? lastMsg.created_at : null,
            unread,
            messages_count: clientMsgs.length,
            orders_count: clientOrders.length,
            linked_ids: Array.from(ident.keys)
        });
    });

    users
        .filter((u) => u.role === 'client')
        .forEach((u) => {
            const ident = resolveIdentity(store, u.id);
            const userMsgs = messages.filter((m) => belongsToIdentity(m, ident.keys));
            const lastMsg = userMsgs[userMsgs.length - 1];
            const unread = userMsgs.filter((m) => m.sender === 'client' && !m.is_read).length;
            const userOrders = orders.filter((o) => !o.deleted_at && belongsToIdentity(o, ident.keys));
            const online = isSocketOnline(clientsMap, ident);

            result.push({
                id: u.id,
                client_id: u.id,
                user_id: u.id,
                name: u.name || u.username,
                username: u.username,
                is_guest: false,
                is_registered: true,
                is_online: online ? 1 : 0,
                last_seen: u.last_seen || u.created_at,
                last_message: lastMsg ? lastMsg.content : null,
                last_message_time: lastMsg ? lastMsg.created_at : null,
                unread,
                messages_count: userMsgs.length,
                orders_count: userOrders.length,
                linked_ids: Array.from(ident.keys)
            });
        });

    return result.sort((a, b) => {
        const ta = new Date(a.last_message_time || a.last_seen || 0).getTime();
        const tb = new Date(b.last_message_time || b.last_seen || 0).getTime();
        return tb - ta;
    });
}

function markRead(store, anyId) {
    const ident = resolveIdentity(store, anyId);
    let changed = 0;
    (store.messages || []).forEach((m) => {
        if (belongsToIdentity(m, ident.keys) && m.sender === 'client' && !m.is_read) {
            m.is_read = 1;
            changed += 1;
        }
    });
    return changed;
}


function purgeClient(store, anyId) {
    if (!store || !anyId) return { found: false };
    const id = String(anyId);
    const ident = resolveIdentity(store, id);
    const keys = ident.keys && ident.keys.size ? ident.keys : new Set([id]);
    let found = false;
    let removedUser = false;
    let removedGuests = 0;
    let anonymizedOrders = 0;
    let removedMessages = 0;

    if (ident.kind === 'user' && ident.user && ident.user.role === 'admin') {
        return { found: false, error: 'admin_protected' };
    }

    const beforeUsers = (store.users || []).length;
    store.users = (store.users || []).filter((u) => {
        if (u.role === 'admin') return true;
        if (String(u.id) === id || keys.has(String(u.id))) {
            found = true;
            removedUser = true;
            return false;
        }
        return true;
    });

    const beforeGuests = (store.guests || []).length;
    store.guests = (store.guests || []).filter((g) => {
        if (keys.has(String(g.client_id)) || String(g.user_id) === id) {
            found = true;
            return false;
        }
        return true;
    });
    removedGuests = beforeGuests - store.guests.length;

    (store.orders || []).forEach((o) => {
        if (belongsToIdentity(o, keys)) {
            o.client_name = 'Удалённый клиент';
            o.user_id = null;
            o.client_id = o.client_id || id;
            o.purged = true;
            anonymizedOrders += 1;
            found = true;
        }
    });

    const beforeMsg = (store.messages || []).length;
    store.messages = (store.messages || []).filter((m) => {
        if (belongsToIdentity(m, keys)) {
            found = true;
            return false;
        }
        return true;
    });
    removedMessages = beforeMsg - store.messages.length;

    // notifications readBy cleanup
    (store.notifications || []).forEach((n) => {
        if (Array.isArray(n.readBy)) {
            n.readBy = n.readBy.filter((rid) => !keys.has(String(rid)));
        }
    });

    return {
        found: found || removedUser || removedGuests > 0,
        removedUser,
        removedGuests,
        anonymizedOrders,
        removedMessages
    };
}

module.exports = {
    ensureUserShape,
    allKeysForUser,
    belongsToIdentity,
    resolveIdentity,
    messagesFor,
    ordersFor,
    stampRecord,
    mergeGuestIntoUser,
    migrateIdentities,
    isSocketOnline,
    bindSocket,
    unbindSocket,
    sendToIdentity,
    buildClientList,
    markRead,
    purgeClient
};
