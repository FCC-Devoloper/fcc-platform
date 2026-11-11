// FCC: отрисовка проектов, новостей, планов, команды и контактов на публичном сайте.
(function () {
    // ---------- помощники ----------
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Пропускаем только безопасные ссылки (никаких javascript:)
    function safeUrl(url) {
        const u = String(url || '').trim();
        if (!u) return '';
        return /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(u) ? u : '';
    }

    function fmtDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function toList(v) {
        if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
        return String(v || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);
    }

    function paragraphs(text) {
        return String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
            .map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
    }

    function opts(o) {
        return typeof o === 'number' ? { limit: o } : (o || {});
    }

    async function getJson(url) {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(url + ' ' + res.status);
        return res.json();
    }

    function emptyBox(text) {
        return '<p class="muted empty-note">' + esc(text) + '</p>';
    }

    // ---------- модальное окно ----------
    let modalEl = null;
    function closeModal() {
        if (!modalEl) return;
        modalEl.classList.remove('open');
        document.body.classList.remove('fcc-modal-lock');
    }
    function openModal(html) {
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.className = 'fcc-modal';
            modalEl.setAttribute('role', 'dialog');
            modalEl.setAttribute('aria-modal', 'true');
            modalEl.innerHTML = '<div class="fcc-modal-box"><button type="button" class="fcc-modal-close" aria-label="Закрыть">✕</button><div class="fcc-modal-body"></div></div>';
            document.body.appendChild(modalEl);
            modalEl.addEventListener('click', (e) => {
                if (e.target === modalEl || e.target.closest('.fcc-modal-close')) closeModal();
            });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
        }
        modalEl.querySelector('.fcc-modal-body').innerHTML = html;
        modalEl.querySelector('.fcc-modal-box').scrollTop = 0;
        modalEl.classList.add('open');
        document.body.classList.add('fcc-modal-lock');
    }

    // ---------- фильтры по категориям ----------
    function buildFilters(box, items, onPick) {
        const prev = box.previousElementSibling;
        if (prev && prev.classList.contains('filter-bar')) prev.remove();
        const cats = [];
        items.forEach(i => { if (i.category && !cats.includes(i.category)) cats.push(i.category); });
        if (cats.length < 1) return;
        const bar = document.createElement('div');
        bar.className = 'filter-bar';
        bar.innerHTML = ['Все'].concat(cats).map((c, i) =>
            '<button type="button" class="filter-chip' + (i === 0 ? ' on' : '') + '" data-cat="' + (i === 0 ? '' : esc(c)) + '">' + esc(c) + '</button>'
        ).join('');
        bar.addEventListener('click', (e) => {
            const b = e.target.closest('.filter-chip');
            if (!b) return;
            bar.querySelectorAll('.filter-chip').forEach(x => x.classList.toggle('on', x === b));
            onPick(b.getAttribute('data-cat'));
        });
        box.parentNode.insertBefore(bar, box);
    }

    // ---------- проекты ----------
    function projectMedia(p) {
        const img = safeUrl(p.image);
        if (img) return '<div class="card-media"><img src="' + esc(img) + '" alt="' + esc(p.title_ru || '') + '" loading="lazy"></div>';
        const letters = String(p.title_ru || 'FCC').trim().slice(0, 2).toUpperCase();
        return '<div class="card-media card-media-ph"><span>' + esc(letters) + '</span></div>';
    }

    function demoButton(p, cls) {
        const hasCode = p.has_demo || p.html_code || p.python_code;
        const demoUrl = safeUrl(p.demo_url);
        if (hasCode) return '<a class="' + cls + '" href="project-runner.html?id=' + encodeURIComponent(p.id) + '">▶ Запустить демо</a>';
        if (demoUrl) return '<a class="' + cls + '" href="' + esc(demoUrl) + '" target="_blank" rel="noopener noreferrer">Открыть демо</a>';
        return '';
    }

    function projectCard(p) {
        const tags = toList(p.technologies).slice(0, 4);
        const r = p.reactions || {};
        const emo = (key, icon) =>
            '<button type="button" class="emo-btn" data-emo="' + key + '" data-id="' + esc(p.id) + '" aria-label="' + key + '">' + icon + ' <b>' + (r[key] || 0) + '</b></button>';
        return (
            '<article class="project-card" data-project-id="' + esc(p.id) + '">' +
            projectMedia(p) +
            '<div class="project-info">' +
            '<div class="card-badges">' +
            (p.category ? '<span class="badge">' + esc(p.category) + '</span>' : '') +
            (p.is_featured ? '<span class="badge badge-hot">★ Выбор студии</span>' : '') +
            (p.year ? '<span class="badge badge-dim">' + esc(p.year) + '</span>' : '') +
            '</div>' +
            '<h3>' + esc(p.title_ru || '') + '</h3>' +
            '<p class="card-text">' + esc(p.description_ru || '') + '</p>' +
            (tags.length ? '<div class="tags">' + tags.map(t => '<span>' + esc(t) + '</span>').join('') + '</div>' : '') +
            '<div class="card-actions">' +
            '<button type="button" class="btn-outline project-more" data-id="' + esc(p.id) + '">Подробнее</button>' +
            demoButton(p, 'btn-primary project-demo') +
            '</div>' +
            '<div class="emotion-bar">' + emo('like', '👍') + emo('fire', '🔥') + emo('heart', '❤️') + emo('wow', '😮') + '</div>' +
            '</div></article>'
        );
    }

    function projectModal(p) {
        const tags = toList(p.technologies);
        const feats = toList(p.features);
        const meta = [
            p.category ? ['Категория', p.category] : null,
            p.client ? ['Заказчик', p.client] : null,
            p.year ? ['Год', p.year] : null
        ].filter(Boolean);
        const img = safeUrl(p.image);
        return (
            (img ? '<img class="modal-cover" src="' + esc(img) + '" alt="">' : '') +
            '<h2>' + esc(p.title_ru || '') + '</h2>' +
            (meta.length ? '<dl class="modal-meta">' + meta.map(m => '<div><dt>' + esc(m[0]) + '</dt><dd>' + esc(m[1]) + '</dd></div>').join('') + '</dl>' : '') +
            '<div class="modal-text">' + (paragraphs(p.full_description) || paragraphs(p.description_ru)) + '</div>' +
            (p.results ? '<div class="modal-result"><strong>Результат</strong>' + paragraphs(p.results) + '</div>' : '') +
            (feats.length ? '<h4>Что умеет</h4><ul class="feat-list">' + feats.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '') +
            (tags.length ? '<h4>Технологии</h4><div class="tags">' + tags.map(t => '<span>' + esc(t) + '</span>').join('') + '</div>' : '') +
            '<div class="card-actions modal-actions">' + demoButton(p, 'btn-primary') +
            '<button type="button" class="btn-outline" onclick="openOrderModal()">Хочу такой же проект</button></div>'
        );
    }

    async function renderProjects(sel, o) {
        const box = document.querySelector(sel);
        if (!box) return;
        const options = opts(o);
        let all = [];
        try {
            all = (await getJson('/api/projects')).projects || [];
        } catch (e) {
            box.innerHTML = emptyBox('Не удалось загрузить проекты. Обновите страницу.');
            return;
        }
        const byId = {};
        all.forEach(p => { byId[p.id] = p; });

        const draw = (cat) => {
            let list = cat ? all.filter(p => p.category === cat) : all.slice();
            if (options.limit) list = list.slice(0, options.limit);
            box.innerHTML = list.length ? list.map(projectCard).join('') : emptyBox('Проекты появятся здесь.');
        };
        draw('');
        if (options.filters) buildFilters(box, all, draw);

        if (!box.dataset.bound) {
            box.dataset.bound = '1';
            box.addEventListener('click', (e) => {
                const emo = e.target.closest('.emo-btn');
                if (emo) return react(emo);
                const more = e.target.closest('.project-more');
                if (more && byId[more.getAttribute('data-id')]) openModal(projectModal(byId[more.getAttribute('data-id')]));
            });
        }
    }

    async function react(btn) {
        const id = btn.getAttribute('data-id');
        const emotion = btn.getAttribute('data-emo');
        const key = 'fcc-react-' + id + '-' + emotion;
        try { if (localStorage.getItem(key)) return; } catch (e) {}
        try {
            const res = await fetch('/api/projects/' + encodeURIComponent(id) + '/react', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emotion })
            });
            const data = await res.json();
            if (data.success) {
                try { localStorage.setItem(key, '1'); } catch (e) {}
                const b = btn.querySelector('b');
                if (b) b.textContent = data.reactions[emotion];
                btn.classList.add('on');
            }
        } catch (e) {}
    }

    // ---------- новости ----------
    function newsMedia(n) {
        const url = safeUrl(n.media_url);
        if (!url) return '';
        const type = n.media_type || (/\.(mp4|webm|ogg)(\?|$)/i.test(url) ? 'video' : 'image');
        const inner = type === 'video'
            ? '<video controls playsinline preload="metadata" src="' + esc(url) + '"></video>'
            : '<img src="' + esc(url) + '" alt="' + esc(n.title_ru || '') + '" loading="lazy">';
        return '<div class="card-media">' + inner + '</div>';
    }

    function newsCard(n) {
        const date = fmtDate(n.published_at || n.created_at);
        const excerpt = n.subtitle || n.content_ru || n.description_ru || '';
        return (
            '<article class="news-card' + (n.pinned ? ' is-pinned' : '') + '" data-news-id="' + esc(n.id) + '" tabindex="0">' +
            newsMedia(n) +
            '<div class="news-body">' +
            '<div class="card-badges">' +
            (n.pinned ? '<span class="badge badge-hot">📌 Важное</span>' : '') +
            (n.category ? '<span class="badge">' + esc(n.category) + '</span>' : '') +
            (date ? '<time class="badge badge-dim" datetime="' + esc(String(n.published_at || n.created_at || '').slice(0, 10)) + '">' + esc(date) + '</time>' : '') +
            '</div>' +
            '<h3>' + esc(n.title_ru || '') + '</h3>' +
            '<p class="card-text">' + esc(excerpt) + '</p>' +
            '<span class="read-more">Читать далее →</span>' +
            '</div></article>'
        );
    }

    function newsModal(n) {
        const date = fmtDate(n.published_at || n.created_at);
        const btnUrl = safeUrl(n.btn_url);
        const media = safeUrl(n.media_url);
        const mediaHtml = !media ? '' : (n.media_type === 'video'
            ? '<video class="modal-cover" controls playsinline src="' + esc(media) + '"></video>'
            : '<img class="modal-cover" src="' + esc(media) + '" alt="">');
        let btn = '';
        if (btnUrl) {
            const ext = /^https?:\/\//i.test(btnUrl);
            const isOrder = btnUrl === '#order';
            btn = isOrder
                ? '<button type="button" class="btn-primary" onclick="openOrderModal()">' + esc(n.btn_text || 'Оставить заявку') + '</button>'
                : '<a class="btn-primary" href="' + esc(btnUrl) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + esc(n.btn_text || 'Узнать больше') + '</a>';
        }
        return (
            mediaHtml +
            '<div class="card-badges">' + (n.category ? '<span class="badge">' + esc(n.category) + '</span>' : '') +
            (date ? '<span class="badge badge-dim">' + esc(date) + '</span>' : '') + '</div>' +
            '<h2>' + esc(n.title_ru || '') + '</h2>' +
            (n.subtitle ? '<p class="modal-lead">' + esc(n.subtitle) + '</p>' : '') +
            '<div class="modal-text">' + paragraphs(n.content_ru) + '</div>' +
            (btn ? '<div class="card-actions modal-actions">' + btn + '</div>' : '')
        );
    }

    async function renderNews(sel, o) {
        const box = document.querySelector(sel);
        if (!box) return;
        const options = opts(o);
        let all = [];
        try {
            all = (await getJson('/api/news')).news || [];
        } catch (e) {
            box.innerHTML = emptyBox('Не удалось загрузить новости. Обновите страницу.');
            return;
        }
        const byId = {};
        all.forEach(n => { byId[n.id] = n; });

        const draw = (cat) => {
            let list = cat ? all.filter(n => n.category === cat) : all.slice();
            if (options.limit) list = list.slice(0, options.limit);
            box.innerHTML = list.length ? list.map(newsCard).join('') : emptyBox('Новостей пока нет.');
        };
        draw('');
        if (options.filters) buildFilters(box, all, draw);

        if (!box.dataset.bound) {
            box.dataset.bound = '1';
            const open = (target) => {
                const card = target.closest('.news-card');
                if (card && byId[card.getAttribute('data-news-id')]) openModal(newsModal(byId[card.getAttribute('data-news-id')]));
            };
            box.addEventListener('click', (e) => { if (!e.target.closest('video')) open(e.target); });
            box.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e.target); });
        }
    }

    // ---------- планы ----------
    const PLAN_LABELS = { now: 'Сейчас', next: 'Дальше', later: 'Позже', done: 'Готово' };

    async function renderPlans(sel) {
        const box = document.querySelector(sel);
        if (!box) return;
        try {
            const list = (await getJson('/api/plans')).plans || [];
            box.innerHTML = list.length ? list.map(p => (
                '<article class="plan-card status-' + esc(p.status || 'next') + '">' +
                '<span class="plan-status">' + esc(PLAN_LABELS[p.status] || p.status || '') + '</span>' +
                '<h3>' + esc(p.title_ru) + '</h3>' +
                '<p>' + esc(p.description_ru || '') + '</p>' +
                (p.eta ? '<time>' + esc(p.eta) + '</time>' : '') +
                '</article>'
            )).join('') : emptyBox('Планы скоро появятся.');
        } catch (e) {
            box.innerHTML = emptyBox('Не удалось загрузить планы.');
        }
    }

    // ---------- команда ----------
    async function renderTeam(selector) {
        const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!el) return;
        try {
            const list = ((await getJson('/api/team')).team || [])
                .filter(m => m.is_public !== 0)
                .sort((a, b) => (b.sort || 0) - (a.sort || 0));
            if (!list.length) { el.innerHTML = emptyBox('Команда скоро появится'); return; }
            el.innerHTML = list.map(m => {
                const photo = safeUrl(m.photo);
                const skills = toList(m.skills);
                return '<article class="team-card">' +
                    (photo ? '<img class="team-photo" src="' + esc(photo) + '" alt="' + esc(m.name || '') + '" loading="lazy">'
                        : '<div class="team-photo team-photo-placeholder">' + esc(String(m.name || 'F').slice(0, 1).toUpperCase()) + '</div>') +
                    '<h3>' + esc(m.name || '') + '</h3>' +
                    '<div class="team-role">' + esc(m.role_title || '') + '</div>' +
                    (skills.length ? '<div class="tags tags-center">' + skills.map(s => '<span>' + esc(s) + '</span>').join('') + '</div>' : '') +
                    (m.bio ? '<p class="team-bio">' + esc(m.bio) + '</p>' : '') +
                    '<button type="button" class="btn-outline" onclick="openOrderModal()">Связаться / заявка</button>' +
                    '</article>';
            }).join('');
        } catch (e) {
            el.innerHTML = emptyBox('Не удалось загрузить команду');
        }
    }

    // ---------- контакты ----------
    async function renderContacts() {
        let s = {};
        try { s = (await getJson('/api/content')).content || {}; } catch (e) { return; }
        const val = (k) => String((s[k] && (s[k].value_ru || s[k].value)) || '').trim();

        const tgRaw = val('contact.telegram');
        const tgHref = !tgRaw ? '' : (/^https?:\/\//i.test(tgRaw) ? tgRaw : 'https://t.me/' + tgRaw.replace(/^@/, ''));
        const tgText = tgRaw.replace(/^https?:\/\/t\.me\//i, '@');
        const items = [
            { id: 'telegram', text: tgText, href: tgHref },
            { id: 'email', text: val('contact.email'), href: val('contact.email') ? 'mailto:' + val('contact.email') : '' },
            { id: 'phone', text: val('contact.phone'), href: val('contact.phone') ? 'tel:' + val('contact.phone').replace(/[^\d+]/g, '') : '' },
            { id: 'hours', text: val('contact.hours'), href: '' }
        ];
        items.forEach((it) => {
            const el = document.getElementById('contact-' + it.id);
            const link = document.getElementById('contact-' + it.id + '-link');
            const holder = link || (el && el.closest('.contact-card'));
            if (el && it.text) el.textContent = it.text;
            if (link && it.href) {
                link.href = it.href;
                if (/^https?:/i.test(it.href)) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
            }
            // Пустой контакт не показываем вместо заглушек вроде «hello@fcc.replace»
            if (holder && !it.text && it.id !== 'telegram') holder.style.display = 'none';
        });
        // Блок «Связаться с нами» в разделе «О нас»: значения из админки, иначе остаются временные из HTML
        const handle = (v) => v.replace(/^https?:\/\/(t\.me|instagram\.com)\//i, '').replace(/^@/, '');
        const chips = {
            telegram: () => val('contact.telegram') && { text: '@' + handle(val('contact.telegram')), href: 'https://t.me/' + handle(val('contact.telegram')) },
            whatsapp: () => val('contact.whatsapp') && { text: val('contact.whatsapp'), href: 'https://wa.me/' + val('contact.whatsapp').replace(/\D/g, '') },
            email: () => val('contact.email') && { text: val('contact.email'), href: 'mailto:' + val('contact.email') },
            phone: () => val('contact.phone') && { text: val('contact.phone'), href: 'tel:' + val('contact.phone').replace(/[^\d+]/g, '') },
            instagram: () => val('contact.instagram') && { text: '@' + handle(val('contact.instagram')), href: 'https://instagram.com/' + handle(val('contact.instagram')) }
        };
        document.querySelectorAll('[data-contact]').forEach((a) => {
            const fn = chips[a.getAttribute('data-contact')];
            const v = fn && fn();
            if (!v) return;
            a.href = v.href;
            const span = a.querySelector('span');
            if (span) span.textContent = v.text;
        });
        const hours = document.getElementById('contact-hours');
        if (hours && !val('contact.hours')) hours.style.display = 'none';
    }

    window.FCCRender = Object.assign(window.FCCRender || {}, {
        renderProjects, renderNews, renderPlans, renderContacts, renderTeam,
        projectCard, newsCard, esc, safeUrl, openModal, closeModal
    });
})();
