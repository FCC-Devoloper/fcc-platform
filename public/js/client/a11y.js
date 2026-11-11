// FCC a11y: клавиатура, закрытие по клику мимо, активный пункт меню.
(function () {
    function closeAll(except) {
        document.querySelectorAll('.modal-overlay.active').forEach(function (m) { if (m !== except) m.classList.remove('active'); });
        var chat = document.getElementById('chat-drawer');
        if (chat && chat.classList.contains('active')) chat.classList.remove('active');
        var tm = document.getElementById('theme-menu'); if (tm) tm.classList.remove('active');
        var nav = document.getElementById('site-nav'); if (nav) nav.classList.remove('open');
        if (window.FCCPromos && window.FCCPromos.close) window.FCCPromos.close();
    }
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeAll(); return; }
        var t = e.target;
        if ((e.key === 'Enter' || e.key === ' ') && t && t.getAttribute && t.getAttribute('role') === 'button') {
            e.preventDefault(); t.click();
        }
    });
    // клик по тёмному фону модалки закрывает её
    document.addEventListener('mousedown', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) e.target.classList.remove('active');
    });
    // чат-кнопка и прочие div-кнопки доступны с клавиатуры
    function mark() {
        document.querySelectorAll('#chat-widget-btn, .promo-widget-btn').forEach(function (el) {
            if (!el.getAttribute('role')) { el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); }
        });
        // активный пункт меню
        var path = location.pathname.replace(/\/$/, '') || '/';
        document.querySelectorAll('#site-nav a[href]').forEach(function (a) {
            var h = a.getAttribute('href');
            var file = h.split('#')[0].replace(/^\//, '');
            var isHome = (path === '/' || /index\.html$/.test(path));
            var on = (!h.includes('#') && file && path.endsWith('/' + file)) || (h === '/' && isHome);
            a.classList.toggle('active', !!on);
            if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mark); else mark();
    window.addEventListener('fcc-partials-ready', mark);
    setTimeout(mark, 800);
    window.FCCA11y = { closeAll: closeAll };
})();
