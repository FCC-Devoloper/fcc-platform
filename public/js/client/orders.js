// FCC client module: orders.js

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

    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('fcc_token');
    if (token) headers.Authorization = 'Bearer ' + token;

    try {
        const res = await fetch('/api/orders', {
            method: 'POST',
            headers,
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
