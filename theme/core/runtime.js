/**
 * Antigravity Plus theme runtime, adapted from Chuanban v5.0.0.
 * See ../UPSTREAM.md. Typography remains owned by inject-font.js.
 */
(function applyTheme(boot) {
  if (window.top !== window || !boot) return;
  if (!document.documentElement || !document.body) {
    window.__antigravity_theme_dispose?.();
    const pending = window.__antigravity_theme_pending;
    if (pending) document.removeEventListener('DOMContentLoaded', pending);
    const start = () => {
      delete window.__antigravity_theme_pending;
      applyTheme(boot);
    };
    window.__antigravity_theme_pending = start;
    document.addEventListener('DOMContentLoaded', start, { once: true });
    window.__antigravity_theme_dispose = () => {
      document.removeEventListener('DOMContentLoaded', start);
      delete window.__antigravity_theme_pending;
      delete window.__antigravity_theme_dispose;
    };
    return;
  }
  window.__antigravity_theme_dispose?.();
  if (boot.enabled === false) {
    window.__ag_patch_version = boot.version;
    return { enabled: false, version: boot.version };
  }

  const PATCH_VERSION = boot.version;
  const MODULES = boot.modules;
  const DEFAULT_PRESET = boot.preset;
  const SELECTORS = {
    inputBoxId: 'antigravity.agentSidePanelInputBox',
    branchPillInBox: '[data-testid="branch-pill-trigger"], [aria-label^="Select project"]',
    homeGreeting: '[data-testid="home-greeting"]',
    ...boot.selectors
  };
  const MIDDLE_MIN_WIDTH_PX = 150;
  const cleanups = [];
  const originalGlobals = new Map();
  const html = document.documentElement;
  const attributes = ['data-ag-preset', 'data-ag-page-type', 'data-ag-wax-seal', 'data-ag-os', 'data-ag-custom-font-size'];
  const oldAttributes = new Map(attributes.map(name => [name, html.getAttribute(name)]));
  const oldVars = new Map();
  const rows = new Map();
  let disposed = false;

  function setGlobal(name, value) {
    if (!originalGlobals.has(name)) {
      originalGlobals.set(name, { present: Object.prototype.hasOwnProperty.call(window, name), value: window[name] });
    }
    window[name] = value;
  }

  function rememberRow(row) {
    if (!rows.has(row)) rows.set(row, row.getAttribute('data-ag-row-mode'));
  }

  function listen(target, event, callback, options) {
    target.addEventListener(event, callback, options);
    cleanups.push(() => target.removeEventListener(event, callback, options));
  }

  function addStyle(id, css) {
    if (!css.trim()) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
    cleanups.push(() => style.remove());
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.__ag_metrics_ro?.disconnect();
    if (window.__ag_metrics_raf) cancelAnimationFrame(window.__ag_metrics_raf);
    for (const cleanup of cleanups.reverse()) {
      try { cleanup(); } catch (error) { console.error('[Theme] Cleanup failed:', error); }
    }
    document.getElementById('ag-live-metrics-pill')?.remove();
    document.getElementById('ag-live-metrics-tooltip')?.remove();
    for (const [row, value] of rows) {
      if (value === null) row.removeAttribute('data-ag-row-mode');
      else row.setAttribute('data-ag-row-mode', value);
    }
    for (const [name, value] of oldAttributes) {
      if (value === null) html.removeAttribute(name);
      else html.setAttribute(name, value);
    }
    for (const [name, value] of oldVars) {
      if (value.value) html.style.setProperty(name, value.value, value.priority);
      else html.style.removeProperty(name);
    }
    for (const [name, record] of originalGlobals) {
      if (record.present) window[name] = record.value;
      else delete window[name];
    }
    delete window.__antigravity_theme_dispose;
  }
  window.__antigravity_theme_dispose = dispose;
  setGlobal('__ag_patch_version', PATCH_VERSION);
  for (const name of [
    '__ag_metrics_ro', '__ag_metrics_ro_target', '__ag_metrics_ro_ver', '__ag_metrics_raf',
    '__ag_last_row_width', '__ag_watched_cascade_id', '__ag_last_metrics'
  ]) setGlobal(name, null);
  for (const name of ['__ag_ensure_metrics_pill_fn', '__ag_render_metrics', '__ag_update_live_metrics', '__ag_check_route_fn', '__AG_PATCH_CTX__']) {
    setGlobal(name, window[name]);
  }

  addStyle('ag-custom-fonts', boot.cssText);
  if (boot.fontCss && !document.getElementById('antigravity-custom-font-style')) {
    addStyle('antigravity-custom-font-style', boot.fontCss);
  }
  if (MODULES.customCss) addStyle('antigravity-user-custom-style', boot.customCss);
  for (const [name, value] of Object.entries(boot.themeVars)) {
    oldVars.set(name, { value: html.style.getPropertyValue(name), priority: html.style.getPropertyPriority(name) });
    html.style.setProperty(name, value);
  }
  if (boot.themeVars['--ag-chat-font-size']) html.setAttribute('data-ag-custom-font-size', 'true');
  html.setAttribute('data-ag-wax-seal', MODULES.composerWaxSeal ? 'on' : 'off');
  html.setAttribute('data-ag-os', boot.platform);

  // Keep native theme-preset-light valid; store the selected patch preset separately.
  const customPresets = new Set([
    'high-contrast', 'claude-desktop-purewhite', 'vintage-deep',
    'chuanban-warm-white', 'claude-desktop-official', 'absoulutely-chuanban'
  ]);
  const storagePrototype = Storage.prototype;
  const getItem = storagePrototype.getItem;
  const setItem = storagePrototype.setItem;
  const storageBefore = new Map(['theme-color-flavor', 'theme-preset-light'].map(key => [key, getItem.call(localStorage, key)]));
  function syncPreset() {
    const stored = getItem.call(localStorage, 'theme-preset-light');
    if (MODULES.deadlockHealer && customPresets.has(stored)) {
      setItem.call(localStorage, 'theme-preset-light', 'Default Light');
    }
    html.setAttribute('data-ag-preset', DEFAULT_PRESET);
  }
  setItem.call(localStorage, 'theme-color-flavor', DEFAULT_PRESET);
  if (MODULES.deadlockHealer) {
    const getDescriptor = Object.getOwnPropertyDescriptor(storagePrototype, 'getItem');
    const setDescriptor = Object.getOwnPropertyDescriptor(storagePrototype, 'setItem');
    function guardedGet(key) {
      const value = getItem.call(this, key);
      return this === localStorage && key === 'theme-preset-light' && customPresets.has(value) ? 'Default Light' : value;
    }
    function guardedSet(key, value) {
      if (this === localStorage && key === 'theme-preset-light' && customPresets.has(String(value))) value = 'Default Light';
      return setItem.call(this, key, value);
    }
    Object.defineProperty(storagePrototype, 'getItem', { ...getDescriptor, value: guardedGet });
    Object.defineProperty(storagePrototype, 'setItem', { ...setDescriptor, value: guardedSet });
    cleanups.push(() => {
      if (storagePrototype.getItem === guardedGet) Object.defineProperty(storagePrototype, 'getItem', getDescriptor);
      if (storagePrototype.setItem === guardedSet) Object.defineProperty(storagePrototype, 'setItem', setDescriptor);
    });
    listen(document, 'click', event => {
      if (!event.target?.closest?.('[data-testid="settings-button"]')) return;
      if (!document.querySelector('[role="dialog"]') && new URLSearchParams(location.search).get('settingsOpen') === 'true') {
        const url = new URL(location.href);
        url.searchParams.delete('settingsOpen');
        url.searchParams.delete('settingsScreen');
        history.replaceState(history.state, '', url.toString());
      }
    }, true);
    listen(window, 'keydown', event => {
      const isMac = boot.platform === 'darwin';
      const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!modifier || event.altKey) return;
      let method;
      if (!event.shiftKey && ['Minus', 'NumpadSubtract'].includes(event.code)) method = 'zoomOut';
      else if (['Equal', 'NumpadAdd'].includes(event.code)) method = 'zoomIn';
      else if (!event.shiftKey && ['Digit0', 'Numpad0'].includes(event.code)) method = 'zoomReset';
      if (method && typeof window.electronNative?.[method] === 'function') {
        event.preventDefault();
        event.stopPropagation();
        window.electronNative[method]();
      }
    }, true);
  }
  cleanups.push(() => {
    for (const [key, value] of storageBefore) {
      if (value === null) localStorage.removeItem(key);
      else setItem.call(localStorage, key, value);
    }
  });
  syncPreset();

  function extractCascadeId() {
    try {
      const m = window.location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
      if (m) return m[1];
      const q = new URLSearchParams(window.location.search).get('cascadeId');
      if (q && /^[0-9a-f-]{36}$/i.test(q)) return q;
      const selected = document.querySelector('[data-testid=conversation-row-sidebar][data-selected=true]');
      if (selected) {
        const cid = selected.getAttribute('data-cascade-id');
        if (cid && /^[0-9a-f-]{36}$/i.test(cid)) return cid;
      }
    } catch (e) {}
    return '';
  }

  function ensureMetricsTooltip() {
    let tt = document.getElementById('ag-live-metrics-tooltip');
    if (!tt && document.body) {
      tt = document.createElement('div');
      tt.id = 'ag-live-metrics-tooltip';
      document.body.appendChild(tt);
    } else if (tt && tt.parentElement !== document.body && document.body) {
      document.body.appendChild(tt);
    }
    return tt;
  }

  function findFooterRow(box) {
    if (!box) return null;
    const rows = box.querySelectorAll('div.flex.w-full.items-center.justify-between');
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.querySelector('[data-testid="model-selector-trigger"], [data-testid="send-button"]')) {
        return r;
      }
    }
    return rows[rows.length - 1] || null;
  }

  function measureNaturalLeftWidth(leftGroup) {
    let w = 0;
    for (let i = 0; i < leftGroup.children.length; i++) {
      const ch = leftGroup.children[i];
      if (ch.id === 'ag-live-metrics-pill') continue;
      const cw = Math.max(ch.offsetWidth || 0, ch.scrollWidth || 0);
      if (cw > 0) w += cw;
    }
    return w;
  }

  function ensureMetricsPill(forceLayout = false) {
    if (!MODULES.metrics) {
      const existing = document.getElementById('ag-live-metrics-pill');
      if (existing) existing.style.display = 'none';
      return null;
    }
    const box = document.getElementById(SELECTORS.inputBoxId);
    if (!box) return null;
    const bottomRow = findFooterRow(box);
    if (!bottomRow || !bottomRow.children[0]) return null;
    const leftGroup = bottomRow.children[0];
    const rightGroup = Array.from(bottomRow.children).find(el => el !== leftGroup && el.querySelector('[data-testid="send-button"]')) || bottomRow.lastElementChild;

    rememberRow(bottomRow);
    let pill = document.getElementById('ag-live-metrics-pill');
    if (pill && (pill.getAttribute('data-v') !== '3' || pill.classList.contains('ag-pill-middle') || pill.classList.contains('ag-pill-wrapped'))) {
      pill.classList.remove('ag-pill-middle', 'ag-pill-wrapped');
    }
    let isNewPill = false;
    if (!pill) {
      isNewPill = true;
      pill = document.createElement('div');
      pill.id = 'ag-live-metrics-pill';
      pill.setAttribute('data-v', '3');
      pill.innerHTML = '<span id="ag-live-metrics-text"></span>';
      pill.addEventListener('mouseenter', () => {
        const tt = ensureMetricsTooltip();
        if (!tt || !tt.innerHTML) return;
        const r = pill.getBoundingClientRect();
        const ttWidth = Math.min(440, Math.max(370, tt.offsetWidth || 400));
        const left = Math.max(12, Math.min(r.left, window.innerWidth - ttWidth - 16));
        const bottomPx = Math.min(window.innerHeight - r.top + 8, window.innerHeight - (tt.offsetHeight || 220) - 12);
        tt.style.left = left + 'px';
        tt.style.bottom = Math.max(8, bottomPx) + 'px';
        tt.setAttribute('data-visible', '1');
      });
      pill.addEventListener('mouseleave', () => {
        const tt = document.getElementById('ag-live-metrics-tooltip');
        if (tt) tt.removeAttribute('data-visible');
      });
    }

    if (
      typeof ResizeObserver !== 'undefined' &&
      (window.__ag_metrics_ro_target !== bottomRow || window.__ag_metrics_ro_ver !== PATCH_VERSION)
    ) {
      if (window.__ag_metrics_ro) {
        try {
          window.__ag_metrics_ro.disconnect();
        } catch (e) {}
      }
      window.__ag_metrics_ro_target = bottomRow;
      window.__ag_metrics_ro_ver = PATCH_VERSION;
      window.__ag_last_row_width = -1;
      window.__ag_metrics_ro = new ResizeObserver(() => {
        if (window.__ag_metrics_raf) return;
        window.__ag_metrics_raf = requestAnimationFrame(() => {
          window.__ag_metrics_raf = 0;
          const w = bottomRow.clientWidth || 0;
          if (w > 0 && Math.abs(w - (window.__ag_last_row_width || 0)) >= 1) {
            window.__ag_last_row_width = w;
            if (typeof window.__ag_ensure_metrics_pill_fn === 'function') {
              window.__ag_ensure_metrics_pill_fn(true);
            }
          }
        });
      });
      window.__ag_metrics_ro.observe(bottomRow);
    }

    const isMountedHere =
      pill.parentElement === leftGroup || (bottomRow.parentElement && pill.parentElement === bottomRow.parentElement);
    if (!forceLayout && !isNewPill && isMountedHere) {
      return pill;
    }

    const rowW = bottomRow.clientWidth || 0;
    window.__ag_last_row_width = rowW;
    const leftW = measureNaturalLeftWidth(leftGroup);
    const rightW = rightGroup ? rightGroup.offsetWidth || 0 : 0;
    const availMiddleW = rowW - leftW - rightW - 14;
    const useBottomRow = rowW > 0 && availMiddleW < MIDDLE_MIN_WIDTH_PX;
    const rowMode = useBottomRow ? 'bottom' : 'middle';

    if (bottomRow.getAttribute('data-ag-row-mode') !== rowMode) {
      bottomRow.setAttribute('data-ag-row-mode', rowMode);
    }
    if (pill.getAttribute('data-ag-row-mode') !== rowMode) {
      pill.setAttribute('data-ag-row-mode', rowMode);
    }

    if (useBottomRow) {
      const cardParent = bottomRow.parentElement;
      if (cardParent && (pill.parentElement !== cardParent || pill.previousElementSibling !== bottomRow)) {
        bottomRow.after(pill);
      }
    } else {
      if (pill.parentElement !== leftGroup) {
        leftGroup.appendChild(pill);
      }
    }

    return pill;
  }

  window.__ag_ensure_metrics_pill_fn = ensureMetricsPill;

  window.__ag_render_metrics = function (payload) {
    try {
      if (!MODULES.metrics) return;
      window.__ag_last_metrics = payload;
      const currentId = extractCascadeId();
      const pill = ensureMetricsPill(false);
      const ttEl = ensureMetricsTooltip();
      if (!pill) return;
      if (!currentId || !payload || !payload.hasData || payload.cascadeId !== currentId) {
        if (pill.style.display !== 'none') pill.style.display = 'none';
        if (ttEl) ttEl.removeAttribute('data-visible');
        return;
      }
      const textEl = pill.querySelector('#ag-live-metrics-text');
      let textChanged = false;
      if (textEl && textEl.innerHTML !== payload.inlineHtml) {
        textEl.innerHTML = payload.inlineHtml;
        textChanged = true;
      }
      if (ttEl && ttEl.innerHTML !== payload.tooltipHtml) {
        ttEl.innerHTML = payload.tooltipHtml;
      }
      if (pill.style.display !== 'inline-flex') {
        pill.style.display = 'inline-flex';
        textChanged = true;
      }
      if (textChanged) {
        ensureMetricsPill(true);
      }
    } catch (e) {}
  };

  window.__ag_update_live_metrics = window.__ag_render_metrics;

  function checkRouteAndMountMetrics() {
    try {
      if (document.hidden) return;
      const box = document.getElementById(SELECTORS.inputBoxId);
      const hasBranchPillInBox = !!(box && box.querySelector(SELECTORS.branchPillInBox));
      const isHome =
        hasBranchPillInBox ||
        !!document.querySelector(SELECTORS.homeGreeting) ||
        window.location.pathname === '/' ||
        !window.location.pathname.startsWith('/c/');
      const pageType = isHome ? 'home' : 'chat';
      if (document.documentElement.getAttribute('data-ag-page-type') !== pageType) {
        document.documentElement.setAttribute('data-ag-page-type', pageType);
      }
      if (document.body && document.body.hasAttribute('data-ag-page-type')) {
        document.body.removeAttribute('data-ag-page-type');
      }

      if (!MODULES.metrics) {
        const existing = document.getElementById('ag-live-metrics-pill');
        if (existing) existing.style.display = 'none';
        return;
      }

      const cid = extractCascadeId();
      if (!cid) {
        window.__ag_watched_cascade_id = '';
        const pill = document.getElementById('ag-live-metrics-pill');
        if (pill && pill.style.display !== 'none') {
          pill.style.display = 'none';
        }
        const ttEl = document.getElementById('ag-live-metrics-tooltip');
        if (ttEl) ttEl.removeAttribute('data-visible');
        return;
      }

      if (cid !== window.__ag_watched_cascade_id) {
        window.__ag_watched_cascade_id = cid;
        const pill = document.getElementById('ag-live-metrics-pill');
        if (pill && (!window.__ag_last_metrics || window.__ag_last_metrics.cascadeId !== cid)) {
          pill.style.display = 'none';
        }
        if (typeof window.__agRequestMetrics === 'function') {
          try {
            window.__agRequestMetrics(cid);
          } catch (e) {}
        }
      } else if (window.__ag_last_metrics && window.__ag_last_metrics.cascadeId === cid) {
        const pill = ensureMetricsPill(false);
        if (pill && window.__ag_last_metrics.hasData && pill.style.display === 'none') {
          window.__ag_render_metrics(window.__ag_last_metrics);
        }
      }
    } catch (e) {}
  }

  setGlobal('__ag_ensure_metrics_pill_fn', ensureMetricsPill);
  setGlobal('__ag_render_metrics', window.__ag_render_metrics);
  setGlobal('__ag_check_route_fn', checkRouteAndMountMetrics);
  // History hooks and the polling fallback cover route changes and React remounts.
  const routeCheck = () => checkRouteAndMountMetrics();
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      routeCheck();
      return result;
    };
    history[method] = wrapped;
    cleanups.push(() => { if (history[method] === wrapped) history[method] = original; });
  }
  listen(window, 'popstate', routeCheck);
  listen(document, 'visibilitychange', routeCheck);
  const interval = setInterval(routeCheck, 1500);
  cleanups.push(() => clearInterval(interval));
  routeCheck();

  const ctx = {
    version: PATCH_VERSION,
    preset: DEFAULT_PRESET,
    config: boot.config,
    modules: MODULES,
    themeVars: boot.themeVars,
    get metrics() { return window.__ag_last_metrics || null; },
    syncPreset,
    ensureMetricsPill,
    onDispose(callback) {
      if (typeof callback !== 'function') throw new TypeError('onDispose expects a function');
      cleanups.push(callback);
    }
  };
  setGlobal('__AG_PATCH_CTX__', ctx);
  if (MODULES.customJs && boot.customJs.trim()) {
    try {
      const cleanup = new Function('ctx', 'boot', boot.customJs)(ctx, ctx);
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    } catch (error) {
      console.error('[Theme] Error in user/custom.js:', error);
    }
  }
  return { enabled: true, version: PATCH_VERSION, preset: DEFAULT_PRESET };
})(__AG_BOOT_PAYLOAD__);

