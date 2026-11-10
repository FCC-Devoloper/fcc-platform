/* FCC promos — fixed corner widget (opposite chat), never page-bottom glue */
(function (global) {
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function isDismissed(id) {
        try {
            const set = JSON.parse(sessionStorage.getItem('fcc_promo_dismissed') || '[]');
            return set.map(String).includes(String(id));
        } catch (e) { return false; }
    }
    function dismissPromo(id) {
        try {
            const set = JSON.parse(sessionStorage.getItem('fcc_promo_dismissed') || '[]');
            if (!set.map(String).includes(String(id))) set.push(String(id));
            sessionStorage.setItem('fcc_promo_dismissed', JSON.stringify(set));
        } catch (e) {}
        render(_cache);
    }
    function normalize(p) {
        return {
            id: p.id,
            title: p.title_ru || p.title || 'Акция',
            description: p.description_ru || p.desc || '',
            discount: p.discount || '%',
            target: p.target || '',
            action_link: p.action_link || '',
            is_active: p.is_active
        };
    }

    let _cache = [];
    let open = false;
    function setOpen(v) {
        open = !!v;
        const panel = document.getElementById('fcc-promo-panel');
        const fab = document.getElementById('fcc-promo-fab');
        if (!panel) return;
        panel.hidden = !open;
        panel.classList.toggle('open', open);
        if (fab) fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function ensureRoot() {
        let root = document.getElementById('fcc-promo-fab-root');
        if (root) return root;
        root = document.createElement('div');
        root.id = 'fcc-promo-fab-root';
        root.innerHTML =
            '<button type="button" id="fcc-promo-fab" class="fcc-promo-fab" aria-label="Акции" style="display:none;">' +
            '<span class="fcc-promo-fab-pct" id="fcc-promo-fab-pct">%</span>' +
            '<span class="fcc-promo-fab-label" id="fcc-promo-fab-label">Акция</span></button>' +
            '<div id="fcc-promo-panel" class="fcc-promo-panel" hidden></div>';
        document.body.appendChild(root);
        const fab = document.getElementById('fcc-promo-fab');
        fab.setAttribute('aria-expanded', 'false');
        fab.onclick = (e) => { e.stopPropagation(); setOpen(!open); };
        // клик в любое другое место закрывает панель
        document.addEventListener('mousedown', (e) => {
            if (open && !root.contains(e.target)) setOpen(false);
        });
        return root;
    }

    function panelHtml(items) {
        return items.map(p => (
            '<article class="fcc-promo-card" data-id="' + esc(p.id) + '">' +
            '<button type="button" class="fcc-promo-x" data-close="1" aria-label="Закрыть">✕</button>' +
            '<div class="fcc-promo-disc">' + esc(p.discount) + '</div>' +
            '<h4>' + esc(p.title) + '</h4>' +
            (p.target ? '<div class="muted">' + esc(p.target) + '</div>' : '') +
            '<p>' + esc(p.description) + '</p>' +
            '<p class="fcc-promo-full" hidden>Условия уточняйте у диспетчера в чате или оставьте заявку.</p>' +
            '<div class="fcc-promo-acts">' +
            '<button type="button" class="btn-outline fcc-promo-more" data-more="' + esc(p.id) + '">Подробнее</button>' +
            '<button type="button" class="fcc-promo-hide" data-x="' + esc(p.id) + '">Скрыть</button>' +
            (p.action_link ? '<a class="btn-primary" href="' + esc(p.action_link) + '">Перейти</a>' : '') +
            '</div></article>'
        )).join('');
    }

    function openDetails(id) {
        const p = _cache.find(x => String(x.id) === String(id));
        if (!p) return;
        const full = document.querySelector('.fcc-promo-card[data-id="' + String(id).replace(/"/g, '') + '"] .fcc-promo-full');
        if (full) full.hidden = !full.hidden;
    }

    function render(list) {
        // hide legacy slots so nothing sticks to page bottom
        ['promo-slot-top','promo-slot-middle','promo-slot-bottom','promo-slot-chat','client-promo-row'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.innerHTML = ''; el.style.display = 'none'; }
        });
        const legacyBtn = document.getElementById('promo-widget-btn');
        if (legacyBtn) legacyBtn.style.display = 'none';

        const items = (list || []).map(normalize).filter(p => p.is_active !== 0 && !isDismissed(p.id));
        _cache = items;
        ensureRoot();
        const fab = document.getElementById('fcc-promo-fab');
        const panel = document.getElementById('fcc-promo-panel');
        const label = document.getElementById('fcc-promo-fab-label');
        const pct = document.getElementById('fcc-promo-fab-pct');
        if (!items.length) {
            fab.style.display = 'none';
            panel.hidden = true;
            return;
        }
        fab.style.display = 'flex';
        label.textContent = items.length > 1 ? 'Акции' : 'Акция';
        pct.textContent = items[0].discount || '%';
        panel.innerHTML = panelHtml(items);
        panel.querySelectorAll('[data-x]').forEach(btn => {
            btn.onclick = (e) => { e.stopPropagation(); dismissPromo(btn.getAttribute('data-x')); };
        });
        panel.querySelectorAll('[data-close]').forEach(btn => { btn.onclick = (e) => { e.stopPropagation(); setOpen(false); }; });
        panel.querySelectorAll('[data-more]').forEach(btn => {
            btn.onclick = () => openDetails(btn.getAttribute('data-more'));
        });
    }

    global.FCCPromos = { render, close: () => setOpen(false) };
})(window);
