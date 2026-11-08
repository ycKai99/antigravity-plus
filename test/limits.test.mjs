import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('quota pills toggle top-layer details and reflect open state', () => {
  const source = fs.readFileSync(new URL('../inject-limits.js', import.meta.url), 'utf8');
  const handlers = source.slice(source.indexOf('        const tooltip = container.querySelector'), source.indexOf('        agentInputEl.parentNode.insertBefore'));
  let opened = false, onToggle;
  const tooltipEvents = {};
  const tooltip = {
    style: {},
    togglePopover() { opened = !opened; onToggle(); },
    showPopover() { opened = true; onToggle(); },
    hidePopover() { opened = false; onToggle(); },
    matches: () => opened,
    addEventListener(type, handler) { tooltipEvents[type] = handler; if (type === 'toggle') onToggle = handler; }
  };
  const pills = Array.from({ length: 2 }, () => ({
    addEventListener(type, handler) { this[type] = handler; },
    getBoundingClientRect: () => ({ left: 700, top: 400 }),
    setAttribute(name, value) { this[name] = value; }
  }));
  vm.runInNewContext(handlers, {
    container: { querySelector: () => tooltip, querySelectorAll: () => pills },
    window: { innerWidth: 800, innerHeight: 600 },
    setTimeout: handler => { tooltipEvents.pendingHide = handler; return 1; },
    clearTimeout: () => { delete tooltipEvents.pendingHide; }
  });
  pills[0].click({ stopPropagation() {} });
  assert.equal(opened, true);
  assert.equal(tooltip.style.left, '516px');
  assert.equal(tooltip.style.bottom, '208px');
  assert.equal(pills[0]['aria-expanded'], 'true');
  pills[1].click({ stopPropagation() {} });
  assert.equal(opened, false);
  assert.equal(pills[1]['aria-expanded'], 'false');
  pills[0].mouseenter();
  assert.equal(opened, true);
  pills[0].mouseleave();
  tooltipEvents.mouseenter();
  assert.equal(tooltipEvents.pendingHide, undefined);
  tooltipEvents.mouseleave();
  tooltipEvents.pendingHide();
  assert.equal(opened, false);
  assert.match(source, /class="custom-limits-tooltip" popover="auto"/);
});
