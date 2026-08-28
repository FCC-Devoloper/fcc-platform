(function () {
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function qs(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function show(id, visible) {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    }

    async function loadProject() {
        const id = qs('id');
        if (!id) {
            showError('Проект не указан.');
            return;
        }
        try {
            const response = await fetch('/api/projects/' + encodeURIComponent(id), { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok || !data.success || !data.project) {
                showError(data.error || 'Проект не найден.');
                return;
            }
            renderProject(data.project);
        } catch (error) {
            showError('Не удалось загрузить проект.');
        }
    }

    function renderProject(project) {
        setText('project-title', project.title_ru || 'Проект');
        setText('project-description', project.description_ru || '');

        const runtime = String(project.runtime || '').toLowerCase();
        const htmlCode = project.html_code || '';
        const pythonCode = project.python_code || '';
        const hasHtml = !!htmlCode;
        const hasPython = !!pythonCode;

        const mode = runtime || (hasPython && !hasHtml ? 'python' : 'html');
        if (mode === 'python' && hasPython) {
            show('html-runner', false);
            show('python-runner', true);
            runPython(pythonCode);
        } else if (hasHtml) {
            show('python-runner', false);
            show('html-runner', true);
            runHtml(htmlCode);
        } else if (project.demo_url) {
            show('python-runner', false);
            show('html-runner', true);
            const frame = document.getElementById('html-frame');
            if (frame) frame.src = project.demo_url;
            setText('runner-status', 'Открывается готовое демо…');
        } else {
            showError('Для этого проекта пока не добавлено интерактивное демо.');
        }
    }

    function runHtml(code) {
        const frame = document.getElementById('html-frame');
        if (!frame) return;
        frame.removeAttribute('src');
        frame.setAttribute('sandbox', 'allow-scripts allow-forms');
        frame.srcdoc = code;
        setText('runner-status', 'HTML-демо готово.');
    }

    async function runPython(code) {
        const output = document.getElementById('python-output');
        if (!output) return;
        output.textContent = 'Загрузка Python…\n';
        try {
            if (!window.loadPyodide) {
                await loadPyodideScript();
            }
            const pyodide = await window.loadPyodide({
                indexURL: 'https://cdn.jsdelivr.net/pyodide/v314.0.5/full/'
            });
            pyodide.setStdout({
                batched: function (text) {
                    output.textContent += text + '\n';
                }
            });
            pyodide.setStderr({
                batched: function (text) {
                    output.textContent += text + '\n';
                }
            });
            output.textContent = '';
            await pyodide.runPythonAsync(code);
            setText('runner-status', 'Python-код выполнен в браузере.');
        } catch (error) {
            output.textContent += '\nОшибка:\n' + (error && error.message ? error.message : String(error));
            setText('runner-status', 'Python завершился с ошибкой.');
        }
    }

    function loadPyodideScript() {
        if (window.__fccPyodideLoading) return window.__fccPyodideLoading;
        window.__fccPyodideLoading = new Promise(function (resolve, reject) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/pyodide/v314.0.5/full/pyodide.js';
            script.onload = resolve;
            script.onerror = function () { reject(new Error('Не удалось загрузить Pyodide.')); };
            document.head.appendChild(script);
        });
        return window.__fccPyodideLoading;
    }

    function showError(message) {
        show('runner-shell', false);
        const error = document.getElementById('runner-error');
        if (error) {
            error.style.display = 'block';
            error.textContent = message;
        }
    }

    document.addEventListener('DOMContentLoaded', loadProject);
})();
