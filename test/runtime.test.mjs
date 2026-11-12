import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { browserFixture, boot } from './browser-fixture.mjs';

const runtime = fs.readFileSync(new URL('../theme/core/runtime.js', import.meta.url), 'utf8');
function apply(fixture, options = {}) {
  const script = runtime.replace('__AG_BOOT_PAYLOAD__', JSON.stringify(boot(options)));
  return vm.runInContext(script, fixture.context);
}

test('hot reload/dispose restores native hooks, storage, CSS variables and listener counts', () => {
  const f = browserFixture();
  const originalPush = f.history.pushState, originalGet = f.Storage.prototype.getItem, originalSet = f.Storage.prototype.setItem;
  f.context.localStorage.setItem('theme-color-flavor', 'original');
  f.html.style.setProperty('--ag-chat-font-size', '14px', 'important');
  f.html.setAttribute('data-ag-preset', 'native');
  apply(f, { themeVars: { '--ag-chat-font-size': '18px' } });
  assert.equal(f.window.count('keydown'), 1);
  assert.equal(f.document.count('click'), 1);
  assert.equal(f.intervals.size, 1);
  assert.equal(f.html.style.getPropertyValue('--ag-chat-font-size'), '18px');
  apply(f, { version: 'changed', preset: 'vintage-deep' });
  assert.equal(f.window.count('keydown'), 1);
  assert.equal(f.document.count('click'), 1);
  assert.equal(f.intervals.size, 1);
  assert.equal(f.html.style.getPropertyValue('--ag-chat-font-size'), '14px');
  assert.equal(f.document.querySelectorAll('#ag-custom-fonts').length, 1);
  f.window.__antigravity_theme_dispose();
  assert.equal(f.window.count('keydown'), 0);
  assert.equal(f.document.count('click'), 0);
  assert.equal(f.window.count('popstate'), 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.Storage.prototype.getItem, originalGet);
  assert.equal(f.Storage.prototype.setItem, originalSet);
  assert.equal(f.history.pushState, originalPush);
  assert.equal(f.html.getAttribute('data-ag-preset'), 'native');
  assert.equal(f.context.localStorage.getItem('theme-color-flavor'), 'original');
  assert.equal(f.html.style.getPropertyPriority('--ag-chat-font-size'), 'important');
  assert.equal(f.window.__ag_render_metrics, undefined);
  assert.equal(f.window.__ag_patch_version, undefined);
  assert.equal(f.observers.filter(observer => observer.active).length, 0);
  assert.deepEqual(f.errors, []);
});

test('composer retains native surface colors and removes the override on dispose', () => {
  const f = browserFixture();
  f.body.style.setProperty('--card', '#303030');
  f.body.style.setProperty('--background', '#202020');
  apply(f);
  const style = f.document.getElementById('antigravity-native-composer-colors');
  assert.match(style.textContent, /--card: #303030 !important/);
  assert.match(style.textContent, /--background: #202020 !important/);
  apply(f, { version: 'reloaded' });
  assert.equal(f.document.querySelectorAll('#antigravity-native-composer-colors').length, 1);
  f.window.__antigravity_theme_dispose();
  assert.equal(f.document.getElementById('antigravity-native-composer-colors'), null);
});

test('storage-denied documents still initialize, reload and dispose the theme', () => {
  const f = browserFixture();
  const originalGet = f.Storage.prototype.getItem;
  const originalSet = f.Storage.prototype.setItem;
  Object.defineProperty(f.window, 'localStorage', { get() {
    const error = new Error('Access is denied for this document');
    error.name = 'SecurityError';
    throw error;
  } });
  apply(f);
  assert.equal(f.html.getAttribute('data-ag-preset'), boot().preset);
  assert.ok(f.document.getElementById('ag-custom-fonts'));
  assert.equal(f.Storage.prototype.getItem, originalGet);
  assert.equal(f.Storage.prototype.setItem, originalSet);
  apply(f, { version: 'reloaded' });
  assert.equal(f.window.__ag_patch_version, 'reloaded');
  f.window.__antigravity_theme_dispose();
  assert.equal(f.intervals.size, 0);
  assert.equal(f.window.count('keydown'), 0);
  assert.equal(f.document.getElementById('ag-custom-fonts'), null);
  assert.deepEqual(f.errors, []);
});

test('metrics wraps below a narrow footer without moving the quota or send group', () => {
  const f = browserFixture();
  apply(f);
  const id = '12345678-1234-1234-1234-123456789abc';
  f.window.__ag_render_metrics({ cascadeId: id, hasData: true, inlineHtml: '42 tok/s', tooltipHtml: 'TTFT 1s' });
  const pill = f.document.getElementById('ag-live-metrics-pill');
  assert.ok(pill);
  assert.equal(pill.parentElement, f.left);
  assert.equal(f.quota.parentElement, f.left);
  f.row.clientWidth = 300;
  f.window.__AG_PATCH_CTX__.ensureMetricsPill(true);
  assert.equal(pill.parentElement, f.card);
  assert.equal(pill.previousElementSibling, f.row);
  assert.equal(f.quota.parentElement, f.left);
  assert.equal(f.right.parentElement, f.row);
  f.row.clientWidth = 900;
  f.window.__AG_PATCH_CTX__.ensureMetricsPill(true);
  assert.equal(pill.parentElement, f.left);
  f.window.__antigravity_theme_dispose();
  assert.equal(f.document.getElementById('ag-live-metrics-pill'), null);
  assert.equal(f.row.getAttribute('data-ag-row-mode'), null);
  assert.equal(f.quota.parentElement, f.left);
  assert.deepEqual(f.errors, []);
});

test('stale session metrics are hidden after changing conversations', () => {
  const f = browserFixture(); apply(f);
  const first = '12345678-1234-1234-1234-123456789abc';
  f.window.__ag_render_metrics({ cascadeId: first, hasData: true, inlineHtml: 'first', tooltipHtml: 'detail' });
  const pill = f.document.getElementById('ag-live-metrics-pill');
  assert.equal(pill.style.display, 'inline-flex');
  f.history.pushState({}, '', '/c/22345678-1234-1234-1234-123456789abc');
  assert.equal(pill.style.display, 'none');
  f.window.__ag_render_metrics({ cascadeId: first, hasData: true, inlineHtml: 'old', tooltipHtml: 'old' });
  assert.equal(pill.style.display, 'none');
  f.window.__antigravity_theme_dispose();
});

test('settings and zoom guards handle their concrete failures and fully detach', () => {
  const f = browserFixture(); apply(f);
  f.history.replaceState(f.history.state, '', '?settingsOpen=true&settingsScreen=general&other=value');
  const state = f.history.state;
  const button = f.document.createElement('button'); button.setAttribute('data-testid', 'settings-button');
  f.document.dispatch('click', { target: button });
  assert.equal(new URLSearchParams(f.window.location.search).has('settingsOpen'), false);
  assert.equal(new URLSearchParams(f.window.location.search).get('other'), 'value');
  assert.equal(f.history.state, state);
  let zoom = 0, prevented = 0;
  f.window.electronNative = { zoomIn() { zoom++; } };
  f.window.dispatch('keydown', { ctrlKey: true, code: 'Equal', preventDefault() { prevented++; }, stopPropagation() {} });
  assert.equal(zoom, 1); assert.equal(prevented, 1);
  for (const preset of ['vintage-deep', 'high-contrast-dark']) {
    f.context.localStorage.setItem('theme-preset-light', preset);
    assert.equal(f.context.localStorage.getItem('theme-preset-light'), 'Default Light');
  }
  f.window.__antigravity_theme_dispose();
  f.context.localStorage.setItem('theme-preset-light', 'vintage-deep');
  assert.equal(f.context.localStorage.getItem('theme-preset-light'), 'vintage-deep');
});

test('disabled/re-enabled theme and custom-JS cleanup leave no active runtime', () => {
  const f = browserFixture();
  apply(f, { customJs: 'window.customActive = (window.customActive || 0) + 1; ctx.onDispose(() => window.customActive--);' });
  assert.equal(f.window.customActive, 1);
  apply(f, { version: 'disabled', enabled: false });
  assert.equal(f.window.customActive, 0);
  assert.equal(f.document.getElementById('ag-custom-fonts'), null);
  assert.equal(f.window.__ag_patch_version, 'disabled');
  assert.equal(f.intervals.size, 0);
  apply(f, { version: 're-enabled' });
  assert.ok(f.document.getElementById('ag-custom-fonts'));
  assert.equal(f.intervals.size, 1);
  f.window.__antigravity_theme_dispose();
});

test('shared current font CSS survives preset changes and respects standalone font ownership', () => {
  const f = browserFixture();
  const existing = f.document.createElement('style'); existing.id = 'antigravity-custom-font-style';
  existing.textContent = 'Maple Mono NF'; f.head.appendChild(existing);
  apply(f, { fontCss: 'Maple Mono NF' });
  apply(f, { preset: 'claude-desktop-purewhite', fontCss: 'Maple Mono NF' });
  assert.equal(f.document.getElementById(existing.id), existing);
  f.window.__antigravity_theme_dispose();
  assert.equal(f.document.getElementById(existing.id), existing);
  existing.remove();
  apply(f, { fontCss: 'Maple Mono NF' });
  assert.equal(f.document.getElementById(existing.id).textContent, 'Maple Mono NF');
  f.window.__antigravity_theme_dispose();
  assert.equal(f.document.getElementById(existing.id), null);
});

test('runtime defers early document injection and never modifies child iframe content', () => {
  const f = browserFixture();
  f.window.top = {};
  apply(f);
  assert.equal(f.document.getElementById('ag-custom-fonts'), null);
  f.window.top = f.window;
  const body = f.document.body; f.document.body = null;
  apply(f); apply(f, { version: 'latest' });
  assert.equal(f.document.count('DOMContentLoaded'), 1);
  f.document.body = body;
  f.document.dispatch('DOMContentLoaded');
  assert.equal(f.window.__ag_patch_version, 'latest');
  f.window.__antigravity_theme_dispose();
  f.document.body = null;
  apply(f);
  f.window.__antigravity_theme_dispose();
  assert.equal(f.document.count('DOMContentLoaded'), 0);
  f.document.body = body;
  f.document.dispatch('DOMContentLoaded');
  assert.equal(f.document.getElementById('ag-custom-fonts'), null);
});

