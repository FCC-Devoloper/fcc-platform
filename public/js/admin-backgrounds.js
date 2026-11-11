// Админка: вкладка «Фоны» + применение фонов админ-панели.
(function () {
    const SITE = [['page','Весь сайт (фон страницы)'],['header','Шапка'],['hero','Главный экран'],['about','О нас'],['services','Услуги'],['projects','Проекты'],['process','Процесс'],['features','Возможности'],['news','Новости'],['plans','Планы'],['team','Команда'],['learning-center','Learning Center'],['contacts','Контакты / «Готовы воплотить идею»'],['footer','Подвал']];
    const ADMIN = [['admin.main','Админка: основная область'],['admin.sidebar','Админка: левое меню'],['admin.live','Админка: Live / Hub'],['admin.news','Админка: Новости'],['admin.projects','Админка: Проекты'],['admin.orders','Админка: Заявки'],['admin.site-cms','Админка: Тексты сайта'],['admin.plans','Админка: Планы'],['admin.team','Админка: Команда']];
    const ADMIN_SEL = { 'admin.main': '.main-content', 'admin.sidebar': '.sidebar' };
    const $ = (id) => document.getElementById(id);
    const hdr = () => { const h = { 'Content-Type': 'application/json' }; const t = localStorage.getItem('fcc_admin_token'); if (t) h.Authorization = 'Bearer ' + t; return h; };
    let cache = {};

    function adminEl(id) { return ADMIN_SEL[id] ? document.querySelector(ADMIN_SEL[id]) : document.getElementById('tab-' + id.replace('admin.', '')); }
    function specFor(key) { try { return JSON.parse((cache[key] || {}).value_ru || ''); } catch (e) { return null; } }

    async function loadCache() {
        try { const r = await fetch('/api/content'); const d = await r.json(); cache = d.content || {}; } catch (e) { cache = {}; }
    }
    function applyAdminBackgrounds() {
        ADMIN.forEach(([id]) => { const s = specFor('bg.' + id); const el = adminEl(id); if (s && el && window.FCCBg) window.FCCBg.applyTo(el, s); });
    }
    function readForm() {
        return {
            color: $('bg-use-color').checked ? $('bg-color').value : '',
            gradient: $('bg-gradient').value,
            image: $('bg-image').value.trim(),
            overlay: Number($('bg-overlay').value) || 0,
            size: $('bg-size').value,
            fixed: $('bg-fixed').checked
        };
    }
    function fillForm() {
        const s = specFor('bg.' + $('bg-target').value) || {};
        $('bg-use-color').checked = !!s.color; if (s.color) $('bg-color').value = s.color;
        $('bg-gradient').value = s.gradient || ''; $('bg-image').value = s.image || '';
        $('bg-overlay').value = s.overlay != null ? s.overlay : 30; $('bg-overlay-val').textContent = $('bg-overlay').value;
        $('bg-size').value = s.size || 'cover'; $('bg-fixed').checked = !!s.fixed;
        preview();
    }
    function preview() {
        const box = $('bg-preview'); if (!box) return;
        box.style.cssText = ''; box.style.backgroundImage = '';
        if (window.FCCBg) window.FCCBg.applyTo(box, readForm());
    }
    async function save(spec) {
        const key = 'bg.' + $('bg-target').value;
        const r = await fetch('/api/admin/content', { method: 'PUT', headers: hdr(), body: JSON.stringify({ key, value: spec ? JSON.stringify(spec) : '' }) });
        if (!r.ok) { if (window.showNotification) showNotification('Не удалось сохранить фон'); return; }
        cache[key] = { value_ru: spec ? JSON.stringify(spec) : '' };
        if (window.showNotification) showNotification(spec ? 'Фон сохранён' : 'Фон сброшен');
        if (!spec) location.reload(); else applyAdminBackgrounds();
    }
    async function upload(file) {
        const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }).catch(() => null);
        if (!data) return;
        const r = await fetch('/api/admin/upload', { method: 'POST', headers: hdr(), body: JSON.stringify({ filename: file.name, mime: file.type, data }) });
        const j = await r.json().catch(() => ({}));
        if (j.url) { $('bg-image').value = j.url; preview(); } else if (window.showNotification) showNotification(j.error || 'Не удалось загрузить');
    }
    window.initBackgroundsTab = async function () {
        await loadCache();
        const sel = $('bg-target'); if (!sel || sel.dataset.ready) { fillForm(); return; }
        sel.dataset.ready = '1';
        sel.innerHTML = '<optgroup label="Сайт">' + SITE.map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('') + '</optgroup><optgroup label="Админ-панель">' + ADMIN.map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('') + '</optgroup>';
        sel.onchange = fillForm;
        ['bg-color', 'bg-use-color', 'bg-gradient', 'bg-image', 'bg-size', 'bg-fixed'].forEach((id) => $(id).addEventListener('input', preview));
        $('bg-overlay').addEventListener('input', () => { $('bg-overlay-val').textContent = $('bg-overlay').value; preview(); });
        $('bg-file').addEventListener('change', (e) => e.target.files[0] && upload(e.target.files[0]));
        $('bg-save').onclick = () => save(readForm());
        $('bg-reset').onclick = () => save(null);
        fillForm();
    };
    document.addEventListener('DOMContentLoaded', async () => { await loadCache(); applyAdminBackgrounds(); });
})();
