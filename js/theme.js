/* ==========================================================================
   Patch Bay — theme picker.
   Shared by both apps. Applies/persists the chosen theme, builds a picker
   UI into any #theme-picker container found on the page, and dispatches a
   window "patchbay-themechange" event other scripts can listen for (e.g.
   js/panel-render.js re-reading resolved colors, js/app.js invalidating
   its generated-panel cache).

   Pairs with the tiny inline bootstrap script each HTML page carries in
   <head> (sets data-theme from localStorage before first paint, avoiding a
   flash of the wrong theme) — this file re-applies the same choice once
   loaded (idempotent) and takes over from there.
   ========================================================================== */

(function () {
  'use strict';

  const STORAGE_KEY = 'patchbay-theme';

  const THEMES = [
    { id: 'solarized-dark',  label: 'Solarized', mode: 'dark' },
    { id: 'nord-dark',       label: 'Nord',       mode: 'dark' },
    { id: 'gruvbox-dark',    label: 'Gruvbox',    mode: 'dark' },
    { id: 'solarized-light', label: 'Solarized', mode: 'light' },
    { id: 'nord-light',      label: 'Nord',       mode: 'light' },
    { id: 'gruvbox-light',   label: 'Gruvbox',    mode: 'light' },
  ];

  function themeById(id) { return THEMES.find(t => t.id === id); }

  function getSaved() {
    try { return localStorage.getItem(STORAGE_KEY) || 'system'; }
    catch (_) { return 'system'; }
  }

  function currentLabel(id) {
    if (id === 'system') return 'System';
    const t = themeById(id);
    return t ? `${t.label} ${t.mode === 'dark' ? 'Dark' : 'Light'}` : 'System';
  }

  function applyTheme(id) {
    if (id === 'system' || !themeById(id)) {
      id = 'system';
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = id;
    }
    try { localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
    window.dispatchEvent(new CustomEvent('patchbay-themechange', { detail: { id } }));
    return id;
  }

  function buildPicker(container) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-picker-btn';
    btn.setAttribute('aria-haspopup', 'true');

    const menu = document.createElement('div');
    menu.className = 'theme-picker-menu';
    menu.hidden = true;

    function addOption(id, text) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'theme-picker-option';
      opt.dataset.themeId = id;
      opt.textContent = text;
      opt.addEventListener('click', () => {
        applyTheme(id);
        sync();
        menu.hidden = true;
      });
      menu.appendChild(opt);
      return opt;
    }

    addOption('system', 'System');

    const groupLabel = (text) => {
      const d = document.createElement('div');
      d.className = 'theme-picker-group';
      d.textContent = text;
      menu.appendChild(d);
    };
    groupLabel('Dark');
    THEMES.filter(t => t.mode === 'dark').forEach(t => addOption(t.id, t.label));
    groupLabel('Light');
    THEMES.filter(t => t.mode === 'light').forEach(t => addOption(t.id, t.label));

    function sync() {
      const active = getSaved();
      btn.textContent = currentLabel(active);
      menu.querySelectorAll('.theme-picker-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.themeId === active);
      });
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', () => { menu.hidden = true; });
    menu.addEventListener('click', (e) => e.stopPropagation());

    container.appendChild(btn);
    container.appendChild(menu);
    sync();
  }

  // Re-apply the saved choice (idempotent with the inline bootstrap — mainly
  // ensures "system" is explicitly persisted on a first-ever visit).
  applyTheme(getSaved());

  // While in "system" mode, an OS-level preference change should still
  // notify listeners (panel-artwork colors etc.) even though the CSS side
  // updates itself automatically via the media query.
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onMediaChange = () => {
    if (getSaved() === 'system') {
      window.dispatchEvent(new CustomEvent('patchbay-themechange', { detail: { id: 'system' } }));
    }
  };
  if (media.addEventListener) media.addEventListener('change', onMediaChange);
  else if (media.addListener) media.addListener(onMediaChange); // older Safari

  const picker = document.getElementById('theme-picker');
  if (picker) buildPicker(picker);
}());
