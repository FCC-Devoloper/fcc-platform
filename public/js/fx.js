/* v2.2: анимации прокрутки (вверх/вниз), ripple на кнопках, прогресс-бар, кнопка «наверх». */
(function () {
  if (window.__fxInit) return; window.__fxInit = true;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lastY = window.scrollY, dir = 'down';
  window.addEventListener('scroll', function () {
    var y = window.scrollY; if (Math.abs(y - lastY) > 2) { dir = y > lastY ? 'down' : 'up'; lastY = y; }
    var h = document.documentElement.scrollHeight - innerHeight;
    var bar = document.getElementById('fx-progress'); if (bar) bar.style.width = (h > 0 ? y / h * 100 : 0) + '%';
    var t = document.getElementById('fx-top'); if (t) t.classList.toggle('show', y > 600);
  }, { passive: true });

  var bar = document.createElement('div'); bar.id = 'fx-progress'; document.body.appendChild(bar);
  var top = document.createElement('button'); top.id = 'fx-top'; top.type = 'button'; top.setAttribute('aria-label', 'Наверх'); top.textContent = '↑';
  top.onclick = function () { window.scrollTo({ top: 0, behavior: 'smooth' }); }; document.body.appendChild(top);

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.btn-primary, .btn-secondary, .btn-outline, .btn-python, .filter-btn');
    if (!b || reduce) return;
    var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
    var d = document.createElement('span'); d.className = 'fx-ripple';
    d.style.cssText = 'width:' + s + 'px;height:' + s + 'px;left:' + (e.clientX - r.left - s / 2) + 'px;top:' + (e.clientY - r.top - s / 2) + 'px';
    b.appendChild(d); setTimeout(function () { d.remove(); }, 650);
  });

  if (reduce || !('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.remove('fx-up'); en.target.classList.add('fx-in'); }
      else if (en.boundingClientRect.top > 0) { // ушёл вниз за экран — при прокрутке вверх снова въедет сверху
        en.target.classList.remove('fx-in'); en.target.classList.toggle('fx-up', false);
      } else { en.target.classList.remove('fx-in'); en.target.classList.add('fx-up'); }
    });
  }, { threshold: 0.12 });
  var seen = new WeakSet();
  function scan() {
    document.querySelectorAll('section .section-header, section .card, .project-card, .news-card, .plan-card, .team-card, .about-contacts, .stats-strip, .cta-box, footer .footer-grid').forEach(function (el) {
      if (seen.has(el) || el.closest('#start-overlay')) return; seen.add(el);
      el.classList.add('fx-reveal'); io.observe(el);
    });
  }
  scan(); new MutationObserver(function () { scan(); }).observe(document.body, { childList: true, subtree: true });
})();
