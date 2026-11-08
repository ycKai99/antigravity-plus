import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('metrics refresh preserves expanded details, summary focus and scroll', () => {
  const source = fs.readFileSync(new URL('../theme/user/custom.js', import.meta.url), 'utf8');
  const hook = source.slice(source.indexOf('  const baseRender'), source.indexOf('  // 初始化'));
  const summary = {};
  let details = { open: true, querySelector: () => summary };
  let focused = false;
  const tt = { scrollTop: 120, querySelector: selector => selector === 'details' ? details : { focus: () => { focused = true; } } };
  const context = vm.createContext({
    window: { __ag_render_metrics: () => { details = null; tt.scrollTop = 0; } },
    document: { activeElement: summary, getElementById: () => tt },
    updatePosition() {},
    renderClaudeStyleCard() { details = { open: vm.runInContext('detailsOpen', context) }; }
  });
  vm.runInContext('let detailsOpen = false;\n' + hook, context);
  context.window.__ag_render_metrics({});
  assert.equal(details.open, true);
  assert.equal(focused, true);
  assert.equal(tt.scrollTop, 120);
});

test('context bar excludes current-step output from capacity segments', () => {
  const source = fs.readFileSync(new URL('../theme/user/custom.js', import.meta.url), 'utf8');
  const parser = source.slice(source.indexOf('  function parseMetricsHtml'), source.indexOf('  let detailsOpen'));
  const context = vm.createContext({});
  vm.runInContext(parser, context);
  const data = context.parseMetricsHtml('当前上下文</span><span class="ag-tt-val">128,000 (新增 64,000 + 缓存 64,000, 50%) 本步输出量</span><span class="ag-tt-val">20,000 (思考链 10,000 + 正文/工具 10,000) 压缩水位线</span><span class="ag-tt-val">128k / 256k (50%) · 距压缩余 128k<');
  assert.equal(data.cache.rawPct + data.input.rawPct + data.free.rawPct, 100);
  const bar = source.slice(source.indexOf('<div class="claude-ctx-bar"'), source.indexOf('<div class="claude-ctx-list"'));
  assert.doesNotMatch(bar, /seg-think|seg-output/);
});

test('Context stays below Overview even when fixed positioning has no offsetParent', () => {
  const source = fs.readFileSync(new URL('../theme/user/custom.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf("  let lastTop"), source.indexOf('  function parseMetricsHtml'));
  const properties = {};
  const attributes = {};
  let siblingAvailable = true;
  const sibling = { offsetParent: null, getBoundingClientRect: () => ({ width: 320, height: 200, top: 80, right: 980, bottom: 280 }) };
  const card = { parentElement: null };
  sibling.appendChild = element => { element.parentElement = sibling; };
  const panel = { getBoundingClientRect: () => ({ width: 318, height: 250, top: 80, right: 979, bottom: 330 }) };
  const context = vm.createContext({
    getComputedStyle: element => element === sibling
      ? { backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(20, 20, 20)', border: '1px solid rgb(80, 80, 80)', borderTopWidth: '1px', borderRadius: '12px' }
      : { backgroundColor: 'transparent', color: 'rgb(20, 20, 20)', border: '0px solid rgb(80, 80, 80)', borderRadius: '0px' },
    window: { innerWidth: 1000, innerHeight: 900 },
    document: {
      getElementById: () => card,
      documentElement: {
        style: { setProperty: (key, value) => { properties[key] = value; } },
        getAttribute: key => attributes[key],
        setAttribute: (key, value) => { attributes[key] = value; }
      },
      querySelector: selector => selector.includes('host-sibling') ? (siblingAvailable ? sibling : null) : selector.includes('"overview-panel"') ? panel : null
    }
  });
  vm.runInContext(body + '\nupdatePosition();', context);
  assert.equal(card.parentElement, sibling);
  context.document.getElementById = () => null;
  card.parentElement = null;
  vm.runInContext('updatePosition();', context);
  assert.equal(card.parentElement, sibling);
  context.document.getElementById = () => card;
  assert.equal(properties['--ag-overview-top'], '336px');
  assert.equal(properties['--ag-overview-right'], '20px');
  assert.equal(properties['--ag-overview-width'], '320px');
  assert.equal(properties['--ag-overview-radius'], '12px');
  assert.equal(properties['--ag-overview-background'], 'rgb(255, 255, 255)');
  assert.equal(properties['--ag-overview-border'], '1px solid rgb(80, 80, 80)');
  siblingAvailable = false;
  vm.runInContext('updatePosition();', context);
  assert.equal(properties['--ag-overview-border'], '1px solid rgb(80, 80, 80)');
  assert.equal(properties['--ag-overview-radius'], '12px');
  assert.equal(properties['--ag-overview-background'], 'rgb(255, 255, 255)');
  siblingAvailable = true;
  assert.equal(attributes['data-ag-overview-visible'], 'true');
  context.window.innerHeight = 400;
  vm.runInContext('updatePosition();', context);
  assert.equal(properties['--ag-overview-top'], '160px');
  context.window.innerHeight = 180;
  vm.runInContext('updatePosition();', context);
  assert.equal(properties['--ag-overview-top'], '8px');
  context.window.innerHeight = 900;
  const getStyle = context.getComputedStyle;
  context.getComputedStyle = element => ({ ...getStyle(element), transform: element === sibling ? 'matrix(0.95, 0, 0, 0.95, 0, -8)' : 'none' });
  context.DOMMatrixReadOnly = class { constructor() { this.a = 0.95; this.f = -8; } };
  sibling.getBoundingClientRect = () => ({ width: 304, height: 190, top: 72, right: 980, bottom: 262 });
  panel.getBoundingClientRect = () => ({ width: 302, height: 188, top: 73, right: 979, bottom: 261 });
  vm.runInContext('updatePosition();', context);
  assert.equal(properties['--ag-overview-width'], '320px');
  assert.equal(properties['--ag-overview-top'], '286px');
  const query = context.document.querySelector;
  let pressed = 'true';
  context.document.querySelector = selector => selector.includes('toggle-overview-panel')
    ? { getAttribute: () => pressed } : query(selector);
  siblingAvailable = false;
  vm.runInContext('updatePosition();', context);
  assert.equal(attributes['data-ag-overview-visible'], 'true');
  assert.equal(properties['--ag-overview-width'], '320px');
  pressed = 'false';
  vm.runInContext('updatePosition();', context);
  assert.equal(attributes['data-ag-overview-visible'], 'false');
  context.document.querySelector = query;
  siblingAvailable = true;
  sibling.hasAttribute = name => name === 'data-ending-style';
  vm.runInContext('updatePosition();', context);
  assert.equal(attributes['data-ag-overview-visible'], 'true');
  sibling.hasAttribute = name => name === 'data-starting-style';
  vm.runInContext('updatePosition();', context);
  assert.equal(attributes['data-ag-overview-visible'], 'true');
  sibling.hasAttribute = () => false;
  const expandedRect = panel.getBoundingClientRect;
  panel.getBoundingClientRect = () => ({ width: 0, height: 0 });
  vm.runInContext('updatePosition();', context);
  assert.equal(attributes['data-ag-overview-visible'], 'false');
  panel.getBoundingClientRect = expandedRect;
  vm.runInContext('updatePosition();', context);
  assert.equal(attributes['data-ag-overview-visible'], 'true');
});

test('Context schedules one update per change and does not keep an idle animation loop', () => {
  const source = fs.readFileSync(new URL('../theme/user/custom.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('  let positionFrame = null;'), source.indexOf("  if (typeof ctx !== 'undefined'"));
  let resizeCallback, mutationCallback, updates = 0;
  const frames = [];
  const context = vm.createContext({
    ResizeObserver: class { constructor(callback) { resizeCallback = callback; } disconnect() {} observe() {} },
    MutationObserver: class { constructor(callback) { mutationCallback = callback; } observe() {} },
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    document: { body: {}, querySelector: () => null, addEventListener() {} },
    window: { addEventListener() {} },
    updatePosition: () => updates++
  });
  vm.runInContext(body, context);
  assert.equal(updates, 1);
  assert.equal(frames.length, 0);
  resizeCallback();
  resizeCallback();
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(updates, 2);
  assert.equal(frames.length, 0);
  mutationCallback([{ type: 'childList', target: { closest: () => true } }]);
  assert.equal(frames.length, 0);
  mutationCallback([{ type: 'attributes', target: { matches: () => true } }]);
  assert.equal(frames.length, 1);
});
