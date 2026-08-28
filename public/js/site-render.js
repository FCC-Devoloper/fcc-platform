(function () {
    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&')
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/"/g, '"');
    }

    function mediaHtml(item) {
        const url = item.media_url || item.image || '';
        if (!url) return '';
        const type = item.media_type || (/\.(mp4|webm|ogg)(\?|$)/i.test(url) ? 'video' : 'image');
        if (type === 'video') {
            return '<video class="media-frame" controls playsinline src="' + esc(url) + '"></video>';
        }
        return '<img class="media-frame" alt="" src="' + esc(url) + '">';
    }

    function projectCard(p) {
        const tags = Array.isArray(p.tags)
            ? p.tags
            : String(p.technologies || '').split(',').map(t => t.trim()).filter(Boolean);
        const feats = Array.isArray(p.features) ? p.features : String(p.features || '').split(',').map(t => t.trim()).filter(Boolean);
        const r = p.reactions || { like: 0, fire: 0, heart: 0, wow: 0 };
        const hasCodeDemo = !!(p.html_code || p.python_code);
        const demo = hasCodeDemo
            ? '<a class="btn-primary project-demo" href="project-runner.html?id=' + encodeURIComponent(p.id) + '">▶ Запустить демо</a>'
            : p.demo_url
                ? '<a class="btn-primary project-demo" href="' + esc(p.demo_url) + '" target="_blank" rel="noopener">Открыть демо</a>'
                : '<span class="muted">Демо скоро</span>';
        const runtime = p.runtime ? '<span class="project-runtime">' + esc(String(p.runtime).toUpperCase()) + '</span>' : '';
        return (
            '<article class="project-card" data-project-id="' + esc(p.id) + '">' +
            (p.image ? '<img class="media-frame" src="' + esc(p.image) + '" alt="">' : '<div class="project-preview">[ ' + esc(p.title_ru || 'Project') + ' ]</div>') +
            '<div class="project-info">' +
            '<h3>' + esc(p.title_ru || '') + '</h3>' +
            '<p>' + esc(p.description_ru || '') + '</p>' +
            '<div class="tags">' + runtime + tags.map(t => '<span>' + esc(t) + '</span>').join('') + '</div>' +
            (feats.length ? '<ul class="feat-list">' + feats.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '') +
            '<div class="project-launch">' + demo + '</div>' +
            '<div class="emotion-bar">' +
            btn('like', '👍', r.like) +
            btn('fire', '🔥', r.fire) +
            btn('heart', '❤️', r.heart) +
            btn('wow', '😮', r.wow) +
            '</div></div></article>'
        );
        function btn(key, icon, count) {
            return '<button type="button" class="emo-btn" data-emo="' + key + '" data-id="' + esc(p.id) + '">' + icon + ' <b>' + (count || 0) + '</b></button>';
        }
    }

    function newsCard(n) {
        return (
            '<article class="news-card">' +
            mediaHtml(n) +
            '<h3>' + esc(n.title_ru || '') + '</h3>' +
            '<p>' + esc(n.content_ru || n.description_ru || '') + '</p>' +
            '<time>' + esc((n.created_at || '').slice(0, 10)) + '</time>' +
            '</article>'
        );
    }

    async function renderProjects(sel) {
        const box = document.querySelector(sel);
        if (!box) return;
        const data = await (await fetch('/api/projects')).json();
        const list = (data.projects || []).filter(p => p.is_published !== 0);
        box.innerHTML = list.length ? list.map(projectCard).join('') : '<p class="muted">Проекты появятся здесь.</p>';
        box.querySelectorAll('.emo-btn').forEach(btn => {
            btn.addEventListener('click', () => react(btn));
        });
    }

    async function react(btn) {
        const id = btn.getAttribute('data-id');
        const emotion = btn.getAttribute('data-emo');
        const key = 'fcc-react-' + id + '-' + emotion;
        if (localStorage.getItem(key)) return;
        try {
            const res = await fetch('/api/projects/' + id + '/react', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emotion })
            });
            const data = await res.json();
            if (data.success) {
                localStorage.setItem(key, '1');
                const b = btn.querySelector('b');
                if (b) b.textContent = data.reactions[emotion];
                btn.classList.add('on');
            }
        } catch (e) {}
    }

    async function renderNews(sel, limit) {
        const box = document.querySelector(sel);
        if (!box) return;
        const data = await (await fetch('/api/news')).json();
        let list = Array.isArray(data.news) ? data.news.slice() : [];
        list = list.filter(n => n && n.is_published !== 0);
        list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        if (Number.isFinite(limit) && limit > 0) list = list.slice(0, limit);
        box.innerHTML = list.length ? list.map(newsCard).join('') : '<p class="muted">Новостей пока нет.</p>';
    }

    async function renderPlans(sel) {
        const box = document.querySelector(sel);
        if (!box) return;
        const data = await (await fetch('/api/plans')).json();
        const list = data.plans || [];
        box.innerHTML = list.map(p => (
            '<article class="plan-card status-' + esc(p.status || 'next') + '">' +
            '<span class="plan-status">' + esc(p.status || 'next') + '</span>' +
            '<h3>' + esc(p.title_ru) + '</h3>' +
            '<p>' + esc(p.description_ru || '') + '</p>' +
            '<time>' + esc(p.eta || '') + '</time>' +
            '</article>'
        )).join('');
    }

    async function renderContacts() {
        const data = await (await fetch('/api/content')).json();
        const s = data.content || {};
        const val = (k, fb) => (s[k] && s[k].value_ru) || fb;
        const map = {
            'contact-telegram': val('contact.telegram', '@FCC_REPLACE_ME'),
            'contact-email': val('contact.email', 'hello@fcc.replace'),
            'contact-phone': val('contact.phone', '+000 000 00 00'),
            'contact-hours': val('contact.hours', 'Онлайн каждый день')
        };
        Object.keys(map).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = map[id];
        });
        const tg = document.getElementById('contact-telegram-link');
        if (tg) tg.href = 'https://t.me/' + map['contact-telegram'].replace('@', '');
        const em = document.getElementById('contact-email-link');
        if (em) em.href = 'mailto:' + map['contact-email'];
        const ph = document.getElementById('contact-phone-link');
        if (ph) ph.href = 'tel:' + map['contact-phone'].replace(/\s/g, '');
    }

    window.FCCRender = { renderProjects, renderNews, renderPlans, renderContacts, projectCard, newsCard };
})();
