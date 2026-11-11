(function () {
    'use strict';

    async function getAccess() {
        try {
            const res = await fetch('/api/learning-center/access', { cache: 'no-store' });
            const data = await res.json();
            return data && data.allowed ? data : null;
        } catch (e) {
            return null;
        }
    }

    async function gateHeader() {
        const link = document.getElementById('learning-center-nav');
        if (!link) return;
        link.hidden = true;
        const access = await getAccess();
        if (access) {
            link.hidden = false;
            link.title = 'FCC Learning Center — ' + (access.city || 'Гиссар');
        }
    }

    async function getMapConfig() {
        const fallback = { city: 'Гиссар', country: 'Таджикистан', address: '', latitude: 38.52504, longitude: 68.55124 };
        try {
            const res = await fetch('/api/learning-center/tariffs', { cache: 'no-store' });
            const data = await res.json();
            return (data && data.location) ? { ...fallback, ...data.location } : fallback;
        } catch (e) { return fallback; }
    }

    async function initMap() {
        const el = document.getElementById('lc-map');
        if (!el || !window.L || el.dataset.ready) return;
        el.dataset.ready = '1';

        const location = await getMapConfig();
        const center = [Number(location.latitude) || 38.52504, Number(location.longitude) || 68.55124];
        const map = L.map(el, { scrollWheelZoom: false }).setView(center, 13);
        const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
        const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri'
        });

        L.marker(center).addTo(map).bindPopup('<b>FCC Learning Center</b><br>' + (location.city || 'Гиссар') + ', ' + (location.country || 'Таджикистан') + (location.address ? '<br>' + location.address : '')).openPopup();
        const links = document.querySelector('.lc-map-links');
        if (links) {
            const mapLink = links.querySelector('a');
            const text = links.querySelector('span');
            const lat = center[0].toFixed(6), lon = center[1].toFixed(6);
            if (mapLink) mapLink.href = 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=15/' + lat + '/' + lon;
            if (text) text.textContent = (location.city || 'Гиссар') + (location.village ? ' · ' + location.village : '') + (location.address ? ' · ' + location.address : '');
        }

        document.querySelectorAll('.lc-map-layer').forEach(btn => {
            btn.addEventListener('click', function () {
                const layer = this.dataset.layer;
                document.querySelectorAll('.lc-map-layer').forEach(x => x.classList.remove('active'));
                this.classList.add('active');
                if (layer === 'satellite') {
                    if (map.hasLayer(street)) map.removeLayer(street);
                    satellite.addTo(map);
                } else {
                    if (map.hasLayer(satellite)) map.removeLayer(satellite);
                    street.addTo(map);
                }
            });
        });
    }

    async function initForm() {
        const form = document.getElementById('learning-center-form');
        if (!form) return;
        const message = document.getElementById('lc-form-message');
        const submit = form.querySelector('button[type="submit"]');

        function setMessage(text, error) {
            if (!message) return;
            message.textContent = text || '';
            message.style.color = error ? '#ff6b5c' : '';
        }

        function analytics() {
            return {
                page: window.location.pathname + window.location.search,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                screen: window.screen ? window.screen.width + 'x' + window.screen.height : '',
                clientId: localStorage.getItem('fcc_client_id') || ''
            };
        }

        function restoreDraft() {
            try {
                const raw = localStorage.getItem('fcc_lc_draft');
                if (!raw) return;
                const d = JSON.parse(raw);
                ['studentName','parentName','phone','email','village','address','comment'].forEach(name => {
                    const el = form.elements[name];
                    if (el && d[name]) el.value = d[name];
                });
                if (d.tariff) {
                    const r = form.querySelector('input[name="tariff"][value="' + CSS.escape(d.tariff) + '"]');
                    if (r) r.checked = true;
                }
            } catch (e) {}
        }

        function saveDraft() {
            try {
                const d = {};
                ['studentName','parentName','phone','email','village','address','comment'].forEach(name => {
                    const el = form.elements[name];
                    if (el) d[name] = el.value;
                });
                const tariff = form.querySelector('input[name="tariff"]:checked');
                d.tariff = tariff ? tariff.value : 'basic';
                localStorage.setItem('fcc_lc_draft', JSON.stringify(d));
            } catch (e) {}
        }

        form.addEventListener('input', saveDraft);
        restoreDraft();

        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            setMessage('');
            const studentName = form.elements.studentName.value.trim();
            const parentName = form.elements.parentName.value.trim();
            const phone = form.elements.phone.value.trim();
            const email = form.elements.email.value.trim();
            const village = form.elements.village.value.trim();
            const address = form.elements.address.value.trim();
            const comment = form.elements.comment.value.trim();
            const tariff = form.querySelector('input[name="tariff"]:checked');
            const consent = document.getElementById('lc-consent').checked;
            if (!studentName || !parentName || !phone || !tariff || !consent) {
                setMessage('Заполните обязательные поля и подтвердите согласие.', true);
                return;
            }
            submit.disabled = true;
            const oldText = submit.textContent;
            submit.textContent = 'Отправляем...';
            try {
                const res = await fetch('/api/learning-center/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ studentName, parentName, phone, email, village, address, comment, tariff: tariff.value, consent, ...analytics() })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) throw new Error(data.error || 'Не удалось отправить заявку');
                setMessage('Готово! Заявка отправлена. Мы свяжемся с вами.');
                form.reset();
                const basic = form.querySelector('input[name="tariff"][value="basic"]');
                if (basic) basic.checked = true;
                localStorage.removeItem('fcc_lc_draft');
                if (typeof window.showToast === 'function') window.showToast('Заявка FCC Learning Center отправлена!');
            } catch (e) {
                setMessage(e.message || 'Ошибка соединения с сервером.', true);
            } finally {
                submit.disabled = false;
                submit.textContent = oldText;
            }
        });
    }

    gateHeader();
    initMap();
    initForm();
})();
