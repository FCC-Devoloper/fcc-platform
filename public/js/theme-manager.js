
function fccWhenReady(fn) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn);
    } else {
        fn();
    }
}

(function () {
    'use strict';

    const STORAGE_KEY = 'fcc-theme';
    const DEFAULT_THEME = 'theme-original.css';

    function getThemeLink() {
        return document.getElementById('site-theme');
    }

    function getMenuElements() {
        return {
            switcher: document.querySelector('.theme-switcher'),
            toggle: document.getElementById('theme-toggle'),
            menu: document.getElementById('theme-menu')
        };
    }

    function saveTheme(themeFile) {
        try {
            localStorage.setItem(STORAGE_KEY, themeFile);
        } catch (error) {}
    }

    function loadThemeName() {
        try {
            return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
        } catch (error) {
            return DEFAULT_THEME;
        }
    }

    function applyTheme(themeFile) {
        const themeLink = getThemeLink();
        if (!themeLink) return;

        const theme = String(themeFile || DEFAULT_THEME).trim();
        const href = theme.indexOf('css/') === 0 ? theme : ('css/' + theme);
        themeLink.href = href;
        saveTheme(theme.replace(/^css\//, ''));
        document.documentElement.dataset.theme = theme.replace('.css', '').replace(/^css\//, '');
        document.documentElement.style.setProperty('--theme-ready', '1');
    }

    function initThemeMenu() {
        const { switcher, toggle, menu } = getMenuElements();
        if (!switcher || !toggle || !menu) return;

        toggle.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            menu.classList.toggle('active');
        });

        menu.addEventListener('click', function (event) {
            const button = event.target.closest('[data-theme]');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            applyTheme(button.dataset.theme);
            menu.classList.remove('active');
        });

        document.addEventListener('click', function (event) {
            if (!switcher.contains(event.target)) {
                menu.classList.remove('active');
            }
        });
    }

    fccWhenReady( function () {
        applyTheme(loadThemeName());
        initThemeMenu();
    });

    window.FCCTheme = { apply: applyTheme };
})();
