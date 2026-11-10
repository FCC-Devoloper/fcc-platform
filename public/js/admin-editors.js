/* FCC Admin — редакторы: новости, проекты, планы, команда, тексты сайта, Visual Editor.
   Загружается после admin.js и использует его функции: authHeaders, esc, showNotification, api. */
(function () {
    const $ = (id) => document.getElementById(id);
    const val = (id) => ($(id) ? $(id).value : '');
    const setVal = (id, v) => { if ($(id)) $(id).value = v == null ? '' : v; };
    const setChecked = (id, v) => { if ($(id)) $(id).checked = !!v; };

    /** Запрос к API админки: возвращает { ok, status, data } и никогда не бросает исключение. */
    async function call(method, url, body) {
        try {
            const res = await fetch(url, {
                method,
                headers: authHeaders(),
                body: body === undefined ? undefined : JSON.stringify(body)
            });
            const data = await res.json().catch(() => ({}));
            return { ok: res.ok && data.success !== false, status: res.status, data };
        } catch (e) {
            return { ok: false, status: 0, data: { error: 'Нет связи с сервером' } };
        }
    }

    function fail(r, fallback) {
        showNotification((r && r.data && r.data.error) || fallback || 'Ошибка');
    }

    /** Загружает выбранный файл на сервер. Возвращает URL, '' (файла нет) или null (ошибка). */
    async function uploadFrom(fileId) {
        const el = $(fileId);
        const file = el && el.files && el.files[0];
        if (!file) return '';
        if (file.size > 5 * 1024 * 1024) { showNotification('Файл больше 5 МБ'); return null; }
        const data = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(file);
        }).catch(() => null);
        if (!data) { showNotification('Не удалось прочитать файл'); return null; }
        const r = await call('POST', '/api/admin/upload', { filename: file.name, mime: file.type, data });
        if (!r.ok || !r.data.url) { fail(r, 'Не удалось загрузить файл'); return null; }
        return r.data.url;
    }

    function showPreview(boxId, url, type) {
        const box = $(boxId);
        if (!box) return;
        if (!url) { box.hidden = true; box.innerHTML = ''; return; }
        box.hidden = false;
        box.innerHTML = type === 'video'
            ? '<video src="' + esc(url) + '" controls muted></video>'
            : '<img src="' + esc(url) + '" alt="">';
    }

    function bindPreview(urlId, fileId, boxId, typeId) {
        const upd = () => showPreview(boxId, val(urlId).trim(), typeId ? val(typeId) : 'image');
        if ($(urlId)) $(urlId).addEventListener('input', upd);
        if ($(fileId)) $(fileId).addEventListener('change', () => {
            const f = $(fileId).files[0];
            if (f) showPreview(boxId, URL.createObjectURL(f), f.type.startsWith('video') ? 'video' : 'image');
            else upd();
        });
    }

    function fillDatalist(id, items) {
        const dl = $(id);
        if (!dl) return;
        const cats = [...new Set(items.map(i => i.category).filter(Boolean))];
        dl.innerHTML = cats.map(c => '<option value="' + esc(c) + '">').join('');
    }

    function banner(prefix, name) {
        const b = $(prefix + '-edit-banner');
        if (!b) return;
        b.hidden = !name;
        if ($(prefix + '-edit-name')) $(prefix + '-edit-name').textContent = name || '';
    }

    function scrollToForm(formId) {
        const f = $(formId);
        if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function day(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    }

    function dateRu(iso) {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU');
    }

    function thumb(url, type) {
        if (!url) return '<div class="thumb thumb-empty">нет<br>медиа</div>';
        if (type === 'video') return '<div class="thumb thumb-empty">▶<br>видео</div>';
        return '<div class="thumb"><img src="' + esc(url) + '" alt="" loading="lazy"></div>';
    }

    // ================= НОВОСТИ =================
    let newsCache = [];

    async function loadNews() {
        const box = $('news-list-container');
        if (!box) return;
        bindNewsOnce();
        const r = await call('GET', '/api/admin/news');
        if (!r.ok) { box.innerHTML = '<p class="muted">Не удалось загрузить новости.</p>'; return; }
        newsCache = r.data.news || [];
        fillDatalist('news-cat-list', newsCache);
        const f = val('news-filter') || 'all';
        const list = newsCache.filter(n => f === 'all' || (f === 'published' ? n.is_published !== 0 : n.is_published === 0));
        if ($('news-total')) $('news-total').textContent = '(' + list.length + ' из ' + newsCache.length + ')';
        if (!list.length) { box.innerHTML = '<p class="muted">Новостей нет.</p>'; return; }
        box.innerHTML = list.map(n => {
            const hidden = n.is_published === 0;
            return '<div class="list-row item-row' + (hidden ? ' is-hidden' : '') + '">' +
                thumb(n.media_url, n.media_type) +
                '<div class="item-info">' +
                '<strong>' + esc(n.title_ru) + '</strong>' +
                '<div class="item-badges">' +
                (hidden ? '<span class="status-pill pill-off">Скрыта</span>' : '<span class="status-pill">Опубликована</span>') +
                (n.pinned ? '<span class="status-pill pill-hot">📌 Закреплена</span>' : '') +
                (n.category ? '<span class="status-pill">' + esc(n.category) + '</span>' : '') +
                '<span class="muted">' + esc(dateRu(n.published_at || n.created_at)) + '</span></div>' +
                (n.subtitle ? '<div class="muted"><em>' + esc(n.subtitle) + '</em></div>' : '') +
                '<p class="muted item-desc">' + esc(String(n.content_ru || '').slice(0, 160)) + '</p>' +
                '</div>' +
                '<div class="item-actions">' +
                '<button type="button" class="btn-action" onclick="editNews(' + qa(n.id) + ')">Редактировать</button>' +
                '<button type="button" class="btn-outline" onclick="toggleNewsPublish(' + qa(n.id) + ')">' + (hidden ? 'Опубликовать' : 'Скрыть') + '</button>' +
                '<button type="button" class="btn-danger" onclick="deleteNews(' + qa(n.id) + ')">Удалить</button>' +
                '</div></div>';
        }).join('');
    }

    let newsBound = false;
    function bindNewsOnce() {
        if (newsBound || !$('form-news')) return;
        newsBound = true;
        bindPreview('news-media-url', 'news-file', 'news-media-preview', 'news-media-type');
        const counter = () => { if ($('news-content-count')) $('news-content-count').textContent = '· ' + val('news-content').length + ' симв.'; };
        $('news-content').addEventListener('input', counter);
        counter();
    }

    function editNews(id) {
        const n = newsCache.find(x => String(x.id) === String(id));
        if (!n) return showNotification('Новость не найдена. Обновите список.');
        bindNewsOnce();
        setVal('news-id', n.id);
        setVal('news-title', n.title_ru);
        setVal('news-subtitle', n.subtitle);
        setVal('news-content', n.content_ru);
        setVal('news-category', n.category);
        setVal('news-published-at', day(n.published_at));
        setVal('news-media-type', n.media_type || 'image');
        setVal('news-media-align', n.media_align || 'full');
        setVal('news-media-scale', n.media_scale || 100);
        setVal('news-media-url', n.media_url);
        setVal('news-btn-text', n.btn_text);
        setVal('news-btn-url', n.btn_url);
        setChecked('news-published', n.is_published !== 0);
        setChecked('news-pinned', !!n.pinned);
        if ($('news-file')) $('news-file').value = '';
        showPreview('news-media-preview', n.media_url, n.media_type);
        $('news-content').dispatchEvent(new Event('input'));
        $('news-save-btn').textContent = 'Сохранить изменения';
        banner('news', n.title_ru);
        scrollToForm('form-news');
    }

    function resetNewsForm() {
        $('form-news').reset();
        setVal('news-id', '');
        showPreview('news-media-preview', '');
        $('news-save-btn').textContent = 'Опубликовать новость';
        banner('news', '');
        if ($('news-content')) $('news-content').dispatchEvent(new Event('input'));
    }

    async function saveNews(e) {
        e.preventDefault();
        const btn = $('news-save-btn');
        btn.disabled = true;
        try {
            let media = val('news-media-url').trim();
            const uploaded = await uploadFrom('news-file');
            if (uploaded === null) return;
            if (uploaded) media = uploaded;
            const id = val('news-id');
            const r = await call('POST', '/api/admin/news', {
                id: id || undefined,
                title_ru: val('news-title'),
                subtitle: val('news-subtitle'),
                content_ru: val('news-content'),
                category: val('news-category'),
                published_at: val('news-published-at'),
                media_type: val('news-media-type'),
                media_align: val('news-media-align'),
                media_scale: val('news-media-scale') || 100,
                media_url: media,
                btn_text: val('news-btn-text'),
                btn_url: val('news-btn-url').trim(),
                is_published: $('news-published').checked ? 1 : 0,
                pinned: $('news-pinned').checked ? 1 : 0
            });
            if (!r.ok) return fail(r, 'Не удалось сохранить новость');
            showNotification(id ? 'Новость обновлена' : 'Новость создана');
            resetNewsForm();
            loadNews();
        } finally {
            btn.disabled = false;
        }
    }

    async function toggleNewsPublish(id) {
        const r = await call('PATCH', '/api/admin/news/' + encodeURIComponent(id) + '/publish', {});
        if (!r.ok) return fail(r);
        showNotification(r.data.is_published ? 'Новость опубликована' : 'Новость скрыта с сайта');
        loadNews();
    }

    async function deleteNews(id) {
        if (!confirm('Удалить новость навсегда? Чтобы просто убрать с сайта, используйте «Скрыть».')) return;
        const r = await call('DELETE', '/api/admin/news/' + encodeURIComponent(id));
        if (!r.ok) return fail(r);
        if (val('news-id') === String(id)) resetNewsForm();
        loadNews();
    }

    // ================= ПРОЕКТЫ =================
    let projectsCache = [];
    let projectsBound = false;

    function bindProjectsOnce() {
        if (projectsBound || !$('form-project')) return;
        projectsBound = true;
        bindPreview('project-image', 'project-file', 'project-media-preview', null);
    }

    async function loadProjects() {
        const box = $('projects-list-container');
        if (!box) return;
        bindProjectsOnce();
        const r = await call('GET', '/api/admin/projects');
        if (!r.ok) { box.innerHTML = '<p class="muted">Не удалось загрузить проекты.</p>'; return; }
        projectsCache = r.data.projects || [];
        fillDatalist('project-cat-list', projectsCache);
        if ($('projects-total')) $('projects-total').textContent = '(' + projectsCache.length + ')';
        if (!projectsCache.length) { box.innerHTML = '<p class="muted">Проекты не добавлены.</p>'; return; }
        box.innerHTML = projectsCache.map(p => {
            const hidden = p.is_published === 0;
            const hasCode = !!(p.html_code || p.python_code);
            return '<div class="list-row item-row' + (hidden ? ' is-hidden' : '') + '">' +
                thumb(p.image, 'image') +
                '<div class="item-info">' +
                '<strong>' + esc(p.title_ru) + '</strong>' +
                '<div class="item-badges">' +
                (hidden ? '<span class="status-pill pill-off">Скрыт</span>' : '<span class="status-pill">На сайте</span>') +
                (p.is_featured ? '<span class="status-pill pill-hot">★ Выбор студии</span>' : '') +
                (p.category ? '<span class="status-pill">' + esc(p.category) + '</span>' : '') +
                (hasCode ? '<span class="status-pill">Демо-код: ' + esc(p.runtime || 'html') + '</span>' : '') +
                (p.demo_url ? '<a href="' + esc(p.demo_url) + '" target="_blank" rel="noopener">Внешнее демо</a>' : '') +
                '</div>' +
                '<p class="muted item-desc">' + esc(p.description_ru || '') + '</p></div>' +
                '<div class="item-actions">' +
                '<button type="button" class="btn-action" onclick="editProject(' + qa(p.id) + ')">Редактировать</button>' +
                '<button type="button" class="btn-outline" onclick="toggleProjectPublish(' + qa(p.id) + ')">' + (hidden ? 'Показать' : 'Скрыть') + '</button>' +
                '<button type="button" class="btn-danger" onclick="deleteProject(' + qa(p.id) + ')">Удалить</button>' +
                '</div></div>';
        }).join('');
    }

    function editProject(id) {
        const p = projectsCache.find(x => String(x.id) === String(id));
        if (!p) return showNotification('Проект не найден. Обновите список.');
        bindProjectsOnce();
        setVal('project-id', p.id);
        setVal('project-title', p.title_ru);
        setVal('project-desc', p.description_ru);
        setVal('project-full', p.full_description);
        setVal('project-results', p.results);
        setVal('project-category', p.category);
        setVal('project-client', p.client);
        setVal('project-year', p.year);
        setVal('project-tech', p.technologies);
        setVal('project-features', (Array.isArray(p.features) ? p.features : []).join(', '));
        setVal('project-image', p.image);
        setVal('project-demo', p.demo_url);
        setVal('project-runtime', p.runtime || '');
        setVal('project-html', p.html_code);
        setVal('project-python', p.python_code);
        setVal('project-sort', p.sort || 0);
        setChecked('project-published', p.is_published !== 0);
        setChecked('project-featured', !!p.is_featured);
        if ($('project-file')) $('project-file').value = '';
        showPreview('project-media-preview', p.image, 'image');
        $('project-save-btn').textContent = 'Сохранить изменения';
        banner('project', p.title_ru);
        scrollToForm('form-project');
    }

    function resetProjectForm() {
        $('form-project').reset();
        setVal('project-id', '');
        showPreview('project-media-preview', '');
        $('project-save-btn').textContent = 'Сохранить проект';
        banner('project', '');
    }

    async function saveProject(e) {
        e.preventDefault();
        const btn = $('project-save-btn');
        btn.disabled = true;
        try {
            let image = val('project-image').trim();
            const uploaded = await uploadFrom('project-file');
            if (uploaded === null) return;
            if (uploaded) image = uploaded;
            const id = val('project-id');
            const r = await call('POST', '/api/admin/projects', {
                id: id || undefined,
                title_ru: val('project-title'),
                description_ru: val('project-desc'),
                full_description: val('project-full'),
                results: val('project-results'),
                category: val('project-category'),
                client: val('project-client'),
                year: val('project-year'),
                technologies: val('project-tech'),
                features: val('project-features'),
                image,
                demo_url: val('project-demo').trim(),
                runtime: val('project-runtime'),
                html_code: val('project-html'),
                python_code: val('project-python'),
                sort: val('project-sort') || 0,
                is_published: $('project-published').checked ? 1 : 0,
                is_featured: $('project-featured').checked ? 1 : 0
            });
            if (!r.ok) return fail(r, 'Не удалось сохранить проект');
            showNotification(id ? 'Проект обновлён' : 'Проект создан');
            resetProjectForm();
            loadProjects();
        } finally {
            btn.disabled = false;
        }
    }

    async function toggleProjectPublish(id) {
        const r = await call('PATCH', '/api/admin/projects/' + encodeURIComponent(id) + '/publish', {});
        if (!r.ok) return fail(r);
        showNotification(r.data.is_published ? 'Проект показан на сайте' : 'Проект скрыт с сайта');
        loadProjects();
    }

    async function deleteProject(id) {
        if (!confirm('Удалить проект навсегда? Чтобы просто убрать с сайта, используйте «Скрыть».')) return;
        const r = await call('DELETE', '/api/admin/projects/' + encodeURIComponent(id));
        if (!r.ok) return fail(r);
        if (val('project-id') === String(id)) resetProjectForm();
        loadProjects();
    }

    // ================= ПЛАНЫ =================
    let plansCache = [];
    const PLAN_LABEL = { now: 'Сейчас', next: 'Дальше', later: 'Позже', done: 'Готово' };

    async function loadPlans() {
        const box = $('plans-list');
        if (!box) return;
        const r = await call('GET', '/api/admin/plans');
        plansCache = (r.data && r.data.plans) || [];
        box.innerHTML = plansCache.length ? plansCache.map(p =>
            '<div class="list-row item-row"><div class="item-info"><strong>' + esc(p.title_ru) + '</strong> ' +
            '<span class="status-pill">' + esc(PLAN_LABEL[p.status] || p.status) + '</span> <span class="muted">' + esc(p.eta || '') + '</span>' +
            '<p class="muted item-desc">' + esc(p.description_ru || '') + '</p></div>' +
            '<div class="item-actions">' +
            '<button type="button" class="btn-action" onclick="editPlan(' + qa(p.id) + ')">Редактировать</button>' +
            '<button type="button" class="btn-danger" onclick="deletePlan(' + qa(p.id) + ')">Удалить</button></div></div>'
        ).join('') : '<p class="muted">Планов пока нет.</p>';
    }

    function editPlan(id) {
        const p = plansCache.find(x => String(x.id) === String(id));
        if (!p) return;
        setVal('plan-id', p.id);
        setVal('plan-title', p.title_ru);
        setVal('plan-desc', p.description_ru);
        setVal('plan-status', p.status || 'now');
        setVal('plan-eta', p.eta);
        $('plan-save-btn').textContent = 'Сохранить изменения';
        banner('plan', p.title_ru);
        scrollToForm('form-plan');
    }

    function resetPlanForm() {
        $('form-plan').reset();
        setVal('plan-id', '');
        $('plan-save-btn').textContent = 'Добавить план';
        banner('plan', '');
    }

    async function savePlan(e) {
        e.preventDefault();
        const id = val('plan-id');
        const body = { title_ru: val('plan-title'), description_ru: val('plan-desc'), status: val('plan-status'), eta: val('plan-eta') };
        const r = id
            ? await call('PATCH', '/api/admin/plans/' + encodeURIComponent(id), body)
            : await call('POST', '/api/admin/plans', body);
        if (!r.ok) return fail(r, 'Не удалось сохранить план');
        showNotification(id ? 'План обновлён' : 'План добавлен');
        resetPlanForm();
        loadPlans();
    }

    async function deletePlan(id) {
        if (!confirm('Удалить этот план?')) return;
        const r = await call('DELETE', '/api/admin/plans/' + encodeURIComponent(id));
        if (!r.ok) return fail(r);
        if (val('plan-id') === String(id)) resetPlanForm();
        loadPlans();
    }

    // ================= КОМАНДА =================
    let teamCache = [];

    async function loadTeamAdmin() {
        const box = $('team-admin-list');
        if (!box) return;
        if (typeof loadLearningCenterMapSettings === 'function') loadLearningCenterMapSettings();
        const r = await call('GET', '/api/admin/team');
        teamCache = (r.data && r.data.team) || [];
        box.innerHTML = teamCache.length ? teamCache.map(m =>
            '<div class="list-row item-row' + (m.is_public === 0 ? ' is-hidden' : '') + '">' +
            thumb(m.photo, 'image') +
            '<div class="item-info"><strong>' + esc(m.name) + '</strong> <span class="status-pill">' + esc(m.role_title || '') + '</span>' +
            (m.is_public === 0 ? ' <span class="status-pill pill-off">Скрыт</span>' : '') +
            '<p class="muted">' + esc(m.skills || '') + '</p>' +
            '<p class="muted item-desc">' + esc(m.bio || '') + '</p>' +
            (m.user_id ? '<p class="muted">user_id: ' + esc(m.user_id) + '</p>' : '') + '</div>' +
            '<div class="item-actions">' +
            '<button type="button" class="btn-action" onclick="editTeamMember(' + qa(m.id) + ')">Редактировать</button>' +
            '<button type="button" class="btn-danger" onclick="deleteTeamMember(' + qa(m.id) + ')">Удалить</button></div></div>'
        ).join('') : '<p class="muted">Команда пуста</p>';
    }

    function editTeamMember(id) {
        const m = teamCache.find(x => String(x.id) === String(id));
        if (!m) return;
        setVal('team-id', m.id);
        setVal('team-name', m.name);
        setVal('team-role', m.role_title);
        setVal('team-skills', m.skills);
        setVal('team-bio', m.bio);
        setVal('team-photo', m.photo);
        setVal('team-user-id', m.user_id || '');
        setVal('team-sort', m.sort || 0);
        setChecked('team-public', m.is_public !== 0);
        if ($('team-file')) $('team-file').value = '';
        $('team-save-btn').textContent = 'Сохранить изменения';
        banner('team', m.name);
        scrollToForm('form-team');
    }

    function resetTeamForm() {
        $('form-team').reset();
        setVal('team-id', '');
        $('team-save-btn').textContent = 'Сохранить в команду';
        banner('team', '');
    }

    async function saveTeamMember(e) {
        e.preventDefault();
        let photo = val('team-photo').trim();
        const uploaded = await uploadFrom('team-file');
        if (uploaded === null) return;
        if (uploaded) photo = uploaded;
        const id = val('team-id');
        const r = await call('POST', '/api/admin/team', {
            id: id || undefined,
            name: val('team-name'),
            role_title: val('team-role'),
            skills: val('team-skills'),
            bio: val('team-bio'),
            photo,
            user_id: val('team-user-id').trim() || null,
            sort: val('team-sort') || 0,
            is_public: $('team-public').checked ? 1 : 0
        });
        if (!r.ok) return fail(r, 'Не удалось сохранить');
        showNotification(id ? 'Участник обновлён' : 'Участник добавлен');
        resetTeamForm();
        loadTeamAdmin();
    }

    async function deleteTeamMember(id) {
        if (!confirm('Удалить из команды?')) return;
        const r = await call('DELETE', '/api/admin/team/' + encodeURIComponent(id));
        if (!r.ok) return fail(r);
        if (val('team-id') === String(id)) resetTeamForm();
        loadTeamAdmin();
    }

    // ================= ТЕКСТЫ САЙТА =================
    let textsDirty = false;
    const LONG_FIELD = 90;

    async function loadSiteTexts() {
        const box = $('site-texts-form');
        if (!box) return;
        const r = await call('GET', '/api/admin/content-schema');
        if (!r.ok) { box.innerHTML = '<p class="muted">Не удалось загрузить тексты.</p>'; return; }
        const values = r.data.values || {};
        box.innerHTML = r.data.groups.map((g, gi) =>
            '<details class="texts-group"' + (gi === 0 ? ' open' : '') + '><summary>' + esc(g.title) + '</summary><div class="texts-fields">' +
            g.fields.map(f => {
                const cur = values[f.key] && values[f.key].value_ru ? values[f.key].value_ru : '';
                const area = f.type === 'textarea' || String(f.def).length > LONG_FIELD;
                const common = ' data-key="' + esc(f.key) + '" placeholder="' + esc(f.def || 'по умолчанию — пусто') + '"';
                return '<label class="text-field"><span>' + esc(f.label) + ' <code>' + esc(f.key) + '</code></span>' +
                    (area ? '<textarea rows="3"' + common + '>' + esc(cur) + '</textarea>'
                        : '<input type="text"' + common + ' value="' + esc(cur) + '">') + '</label>';
            }).join('') + '</div></details>'
        ).join('');
        textsDirty = false;
        if ($('texts-dirty')) $('texts-dirty').textContent = '';
        box.oninput = () => {
            textsDirty = true;
            if ($('texts-dirty')) $('texts-dirty').textContent = '● есть несохранённые изменения';
        };
    }

    function toggleTextGroups(open) {
        document.querySelectorAll('#site-texts-form details').forEach(d => { d.open = open; });
    }

    async function saveAllSiteTexts() {
        const items = {};
        document.querySelectorAll('#site-texts-form [data-key]').forEach(el => { items[el.getAttribute('data-key')] = el.value.trim(); });
        if (!Object.keys(items).length) return showNotification('Тексты ещё не загружены');
        const r = await call('PUT', '/api/admin/settings/bulk', { items });
        if (!r.ok) return fail(r, 'Не удалось сохранить тексты');
        textsDirty = false;
        if ($('texts-dirty')) $('texts-dirty').textContent = '';
        showNotification('Тексты сохранены (' + r.data.saved + ')');
    }

    window.addEventListener('beforeunload', (e) => { if (textsDirty) { e.preventDefault(); e.returnValue = ''; } });

    // ================= VISUAL EDITOR =================
    let veEl = null;
    let veInit = null;
    let veDirty = false;
    let veDocCleanup = null;

    function rgbToHex(rgb) {
        const m = String(rgb).match(/\d+(\.\d+)?/g);
        if (!m || m.length < 3) return '#ffffff';
        return '#' + m.slice(0, 3).map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join('');
    }

    function veWin() {
        const f = $('visual-frame');
        try { return f && f.contentWindow; } catch (e) { return null; }
    }

    function setVeStatus(t) { if ($('ve-status')) $('ve-status').textContent = t || ''; }

    function setVeDirty(on) {
        veDirty = on;
        if ($('ve-dirty')) $('ve-dirty').textContent = on ? '● не сохранено' : '';
    }

    function initVisualEditor() {
        const frame = $('visual-frame');
        if (!frame) return;
        closeVeToolbar(true);
        setVeStatus('Загрузка превью…');
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            const w = veWin();
            let ready = false;
            try { ready = !!(w && w.__fccContentReady && w.FCCCms && w.document.querySelectorAll('[data-cms-key]').length > 10); } catch (e) {}
            if (ready) {
                clearInterval(timer);
                setTimeout(() => bindVePreview(w), 300);
            } else if (tries > 100) {
                clearInterval(timer);
                setVeStatus('Превью не загрузилось. Нажмите «Обновить превью».');
            }
        }, 200);
        frame.src = '/?preview=1&_=' + Date.now();
    }

    function bindVePreview(win) {
        const doc = win.document;
        if (veDocCleanup) veDocCleanup();
        const onClick = (ev) => {
            // В предпросмотре никакие кнопки и ссылки не работают — только выбор элемента
            ev.preventDefault();
            ev.stopPropagation();
            const target = ev.target.closest && ev.target.closest('[data-cms-key]');
            if (target) selectVeElement(target);
        };
        const onSubmit = (ev) => ev.preventDefault();
        doc.addEventListener('click', onClick, true);
        doc.addEventListener('submit', onSubmit, true);
        veDocCleanup = () => {
            try { doc.removeEventListener('click', onClick, true); doc.removeEventListener('submit', onSubmit, true); } catch (e) {}
        };
        const count = doc.querySelectorAll('[data-cms-key]').length;
        setVeStatus('Готово: можно править ' + count + ' элементов. Нажмите на подсвеченный текст.');
    }

    function selectVeElement(el) {
        if (veDirty && veEl && veEl !== el && !confirm('Есть несохранённые правки. Отбросить их?')) return;
        const w = veWin();
        if (veEl) veEl.classList.remove('ve-selected');
        veEl = el;
        el.classList.add('ve-selected');
        const cs = w.getComputedStyle(el);
        veInit = {
            text: el.innerText.trim(),
            color: rgbToHex(cs.color),
            size: String(parseInt(cs.fontSize, 10) || ''),
            align: el.style.textAlign || '',
            action: el.getAttribute('data-cms-action') || '',
            url: el.getAttribute('data-cms-url') || ''
        };
        $('ve-toolbar').hidden = false;
        $('ve-key').textContent = el.getAttribute('data-cms-key');
        setVal('ve-text', veInit.text);
        setVal('ve-color', veInit.color);
        setVal('ve-size', veInit.size);
        setVal('ve-align', veInit.align);
        setVal('ve-action', veInit.action);
        setVal('ve-url', veInit.url);
        setVeDirty(false);
        $('ve-toolbar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function closeVeToolbar(silent) {
        if (!silent && veDirty && !confirm('Есть несохранённые правки. Закрыть без сохранения?')) return;
        if (veEl) veEl.classList.remove('ve-selected');
        veEl = null;
        setVeDirty(false);
        if ($('ve-toolbar')) $('ve-toolbar').hidden = true;
    }

    /** Собирает из панели то, что реально изменили (нетронутые значения не записываем). */
    function readVePanel() {
        const styles = {};
        const color = val('ve-color');
        if (color !== veInit.color || veEl.style.color) styles.color = color;
        const size = val('ve-size');
        if (size && (size !== veInit.size || veEl.style.fontSize)) styles.fontSize = size;
        const align = val('ve-align');
        if (align) styles.textAlign = align;
        return { value: val('ve-text').trim(), styles, action: val('ve-action'), url: val('ve-url').trim() };
    }

    function previewElementMeta() {
        if (!veEl) return;
        const d = readVePanel();
        if (d.value) veEl.innerText = d.value;
        veEl.style.color = d.styles.color || '';
        veEl.style.fontSize = d.styles.fontSize ? d.styles.fontSize + 'px' : '';
        veEl.style.textAlign = d.styles.textAlign || '';
    }

    async function saveElementMeta() {
        if (!veEl) return;
        const d = readVePanel();
        if (!d.value) return showNotification('Текст не может быть пустым. Чтобы вернуть исходный — «Вернуть исходный текст».');
        if (d.action === 'url' && !/^(https?:\/\/|mailto:|tel:|#|\/)/i.test(d.url)) return showNotification('Для действия «Перейти по ссылке» укажите ссылку, начиная с https://');
        const r = await call('PUT', '/api/admin/content', { key: veEl.getAttribute('data-cms-key'), value: d.value, styles: d.styles, action: d.action, url: d.url });
        if (!r.ok) return fail(r, 'Не удалось сохранить элемент');
        const w = veWin();
        if (w && w.FCCCms && r.data.item) w.FCCCms.applyItem(veEl, r.data.item);
        if (!d.action) { veEl.removeAttribute('data-cms-action'); veEl.removeAttribute('data-cms-url'); }
        showNotification('Сохранено — уже видно на сайте');
        selectVeElement(veEl);
    }

    async function resetElementMeta() {
        if (!veEl) return;
        if (!confirm('Вернуть исходный текст и оформление этого элемента?')) return;
        const key = veEl.getAttribute('data-cms-key');
        const r = await call('DELETE', '/api/admin/content/' + encodeURIComponent(key));
        if (!r.ok) return fail(r, 'Не удалось сбросить');
        if (veEl.dataset.cmsDefault !== undefined) veEl.innerText = veEl.dataset.cmsDefault;
        veEl.removeAttribute('style');
        veEl.removeAttribute('data-cms-action');
        veEl.removeAttribute('data-cms-url');
        showNotification('Возвращён исходный вид');
        selectVeElement(veEl);
    }

    function setVeDevice(btn) {
        document.querySelectorAll('.ve-devices button[data-w]').forEach(b => b.classList.toggle('on', b === btn));
        const frame = $('visual-frame');
        if (frame) frame.style.width = btn.getAttribute('data-w');
    }

    document.addEventListener('input', (e) => {
        if (e.target && e.target.closest && e.target.closest('#ve-toolbar') && veEl) setVeDirty(true);
    });

    // Экспорт для inline-обработчиков в партиалах
    Object.assign(window, {
        loadNews, editNews, saveNews, resetNewsForm, toggleNewsPublish, deleteNews,
        loadProjects, editProject, saveProject, resetProjectForm, toggleProjectPublish, deleteProject,
        loadPlans, editPlan, savePlan, resetPlanForm, deletePlan,
        loadTeamAdmin, editTeamMember, saveTeamMember, resetTeamForm, deleteTeamMember,
        loadSiteTexts, saveAllSiteTexts, toggleTextGroups,
        initVisualEditor, saveElementMeta, previewElementMeta, resetElementMeta, closeVeToolbar, setVeDevice
    });
})();
