// FCC backgrounds: фон любого блока из админки. Ключи: bg.<target> → JSON.
(function () {
    var TARGETS = {
        'page': 'body',
        'hero': '.hero-section',
        'about': '#about', 'services': '#services', 'projects': '#projects', 'process': '#process',
        'features': '#features', 'news': '#news', 'plans': '#plans', 'team': '#team',
        'learning-center': '#learning-center', 'contacts': '#contacts', 'header': '#navbar', 'footer': 'footer'
    };
    function css(spec) {
        var layers = [];
        var o = Math.max(0, Math.min(90, Number(spec.overlay) || 0)) / 100;
        if (spec.image) {
            if (o > 0) layers.push('linear-gradient(rgba(0,0,0,' + o + '),rgba(0,0,0,' + o + '))');
            layers.push('url("' + String(spec.image).replace(/"/g, '%22') + '")');
        }
        if (spec.gradient) layers.push(spec.gradient);
        return layers;
    }
    function applyTo(el, spec) {
        if (!el || !spec) return;
        var layers = css(spec);
        if (layers.length) {
            el.style.backgroundImage = layers.join(',');
            el.style.backgroundSize = spec.size === 'repeat' ? 'auto' : (spec.size || 'cover');
            el.style.backgroundRepeat = spec.size === 'repeat' ? 'repeat' : 'no-repeat';
            el.style.backgroundPosition = spec.position || 'center';
            el.style.backgroundAttachment = spec.fixed ? 'fixed' : 'scroll';
        }
        if (spec.color) el.style.backgroundColor = spec.color;
    }
    function parse(item) {
        try { return JSON.parse((item && (item.value_ru || item.value)) || ''); } catch (e) { return null; }
    }
    function apply(settings) {
        Object.keys(settings || {}).forEach(function (k) {
            if (k.indexOf('bg.') !== 0) return;
            var id = k.slice(3), spec = parse(settings[k]);
            var sel = TARGETS[id];
            if (!sel || !spec) return;
            document.querySelectorAll(sel).forEach(function (el) { applyTo(el, spec); });
        });
    }
    window.FCCBg = { apply: apply, applyTo: applyTo, parse: parse, TARGETS: TARGETS };
})();
