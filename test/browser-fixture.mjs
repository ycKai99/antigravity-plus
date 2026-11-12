import vm from 'node:vm';

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type, event = {}) { for (const callback of this.listeners.get(type) || []) callback(event); }
  count(type) { return this.listeners.get(type)?.size || 0; }
}
class Style {
  constructor() { this.values = new Map(); }
  setProperty(key, value, priority = '') { this.values.set(key, { value, priority }); }
  getPropertyValue(key) { return this.values.get(key)?.value || ''; }
  getPropertyPriority(key) { return this.values.get(key)?.priority || ''; }
  removeProperty(key) { this.values.delete(key); }
}
function matches(node, selector) {
  selector = selector.trim();
  const tag = selector.match(/^[a-z]+/i)?.[0];
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  const id = selector.match(/^#([\w-]+)/)?.[1];
  if (id && node.id !== id) return false;
  const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
  if (classes.some(name => !node.classList.contains(name))) return false;
  for (const match of selector.matchAll(/\[([\w-]+)(\^?=)?["']?([^\]"']*)["']?\]/g)) {
    const [, name, operator, value] = match;
    const actual = node.getAttribute(name);
    if (!operator && actual === null) return false;
    if (operator === '=' && actual !== value) return false;
    if (operator === '^=' && !actual?.startsWith(value)) return false;
  }
  return true;
}
class Element extends Events {
  constructor(tag) {
    super(); this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map();
    this.parentElement = null; this.style = new Style(); this.textContent = '';
    this.clientWidth = 0; this.offsetWidth = 0; this.scrollWidth = 0;
    this.classList = {
      contains: name => (this.getAttribute('class') || '').split(/\s+/).includes(name),
      remove: (...names) => this.setAttribute('class', (this.getAttribute('class') || '').split(/\s+/).filter(name => !names.includes(name)).join(' '))
    };
  }
  set id(value) { this.setAttribute('id', value); }
  get id() { return this.getAttribute('id') || ''; }
  set className(value) { this.setAttribute('class', value); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) {
    child.remove(); this.children.push(child); child.parentElement = this; return child;
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  after(child) {
    const parent = this.parentElement;
    child.remove();
    parent.children.splice(parent.children.indexOf(this) + 1, 0, child); child.parentElement = parent;
  }
  get previousElementSibling() {
    return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null;
  }
  get lastElementChild() { return this.children.at(-1) || null; }
  get parentNode() { return this.parentElement; }
  querySelectorAll(selector) {
    const selectors = selector.split(',');
    const result = [];
    function visit(parent) {
      for (const child of parent.children) {
        if (selectors.some(selector => matches(child, selector))) result.push(child);
        visit(child);
      }
    }
    visit(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector.split(',').some(selector => matches(node, selector))) return node;
    }
    return null;
  }
  set innerHTML(value) {
    this._html = value;
    this.children.forEach(child => child.parentElement = null); this.children = [];
    const id = value.match(/<span id="([^"]+)"><\/span>/)?.[1];
    if (id) { const span = new Element('span'); span.id = id; this.appendChild(span); }
  }
  get innerHTML() { return this._html || ''; }
  getBoundingClientRect() { return { left: 100, top: 600 }; }
}

export function browserFixture() {
  class Storage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
  }
  const html = new Element('html');
  const head = html.appendChild(new Element('head'));
  const body = html.appendChild(new Element('body'));
  const document = new Events();
  Object.assign(document, { documentElement: html, head, body, hidden: false, createElement: tag => new Element(tag),
    getElementById: id => [html, ...html.querySelectorAll('[id]')].find(node => node.id === id) || null,
    querySelector: selector => html.querySelector(selector),
    querySelectorAll: selector => html.querySelectorAll(selector) });
  const window = new Events();
  window.top = window;
  let location = new URL('https://127.0.0.1:3000/c/12345678-1234-1234-1234-123456789abc');
  Object.defineProperty(window, 'location', { get: () => location });
  const history = { state: { __TSR_key: 'route' },
    pushState(state, _, url) { this.state = state; if (url) location = new URL(url, location); },
    replaceState(state, _, url) { this.state = state; if (url) location = new URL(url, location); } };
  const intervals = new Map(), rafs = new Map(), observers = [];
  let timerId = 0;
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.active = true; observers.push(this); }
    observe(node) { this.target = node; }
    disconnect() { this.active = false; }
  }
  const errors = [];
  const context = vm.createContext({
    window, document, Storage, localStorage: new Storage(), history, URL, URLSearchParams,
    get location() { return location; },
    ResizeObserver,
    getComputedStyle: element => element.style,
    requestAnimationFrame(callback) { const id = ++timerId; rafs.set(id, callback); return id; },
    cancelAnimationFrame(id) { rafs.delete(id); },
    setInterval(callback) { const id = ++timerId; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    console: { error: (...args) => errors.push(args) }
  });
  window.innerWidth = 1200; window.innerHeight = 800;
  const box = body.appendChild(new Element('div')); box.id = 'antigravity.agentSidePanelInputBox';
  const card = box.appendChild(new Element('div'));
  const row = card.appendChild(new Element('div')); row.className = 'flex w-full items-center justify-between'; row.clientWidth = 800;
  const left = row.appendChild(new Element('div'));
  const model = left.appendChild(new Element('button')); model.setAttribute('data-testid', 'model-selector-trigger'); model.offsetWidth = 100;
  const quota = left.appendChild(new Element('div')); quota.className = 'custom-limits-container'; quota.offsetWidth = 100;
  const right = row.appendChild(new Element('div')); right.offsetWidth = 80;
  const send = right.appendChild(new Element('button')); send.setAttribute('data-testid', 'send-button');
  window.localStorage = context.localStorage;
  return { context, window, document, html, head, body, box, card, row, left, right, quota, history, Storage, intervals, rafs, observers, errors };
}

export function boot(overrides = {}) {
  return {
    version: 'antigravity-plus-theme-v1-stable-test',
    platform: 'win32', enabled: true, preset: 'high-contrast', cssText: ':root { --test: 1; }',
    customCss: '', customJs: '', fontCss: '', themeVars: {}, selectors: {},
    modules: { metrics: true, composerWaxSeal: true, deadlockHealer: true, customCss: true, customJs: true },
    config: { contextLimit: 256000 }, ...overrides
  };
}

