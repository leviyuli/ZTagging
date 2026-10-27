import test from 'node:test';
import assert from 'node:assert/strict';
import { createDropdown, cleanupDropdowns } from '../src/dropdown.ts';

const XHTML = 'http://www.w3.org/1999/xhtml';
type Listener = { callback: any; capture: boolean; once: boolean };

/** A small XML chrome DOM, including event propagation rather than inert listeners. */
function chromeDOM() {
  class EventTarget {
    listeners = new Map<string, Listener[]>();
    addEventListener(type: string, callback: any, options: any = false) {
      const capture = typeof options === 'boolean' ? options : !!options.capture;
      const entries = this.listeners.get(type) || [];
      if (!entries.some(entry => entry.callback === callback && entry.capture === capture)) {
        entries.push({ callback, capture, once: !!options?.once });
        this.listeners.set(type, entries);
      }
    }
    removeEventListener(type: string, callback: any, options: any = false) {
      const capture = typeof options === 'boolean' ? options : !!options.capture;
      this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.callback !== callback || entry.capture !== capture));
    }
    dispatchEvent(event: any) { return dispatch(this, event); }
    listenerCount() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.length, 0); }
  }

  class Element extends EventTarget {
    nodeType = 1;
    namespaceURI = XHTML;
    id = '';
    className = '';
    children: Element[] = [];
    parentNode: any = null;
    attributes = new Map<string, string>();
    style: any = {
      setProperty(name: string, value: string) { this[name] = value; },
      removeProperty(name: string) { delete this[name]; },
    };
    dataset: Record<string, string> = {};
    disabled = false;
    hidden = false;
    type = '';
    value = '';
    tabIndex = 0;
    scrollTop = 0;
    scrollCalls: any[] = [];
    rect: { left: number; top: number; width: number; height: number } | undefined;
    ownText = '';
    ownerDocument: any;
    localName: string;
    tagName: string;
    constructor(name: string) { super(); this.ownerDocument = doc; this.localName = name; this.tagName = name.toUpperCase(); }
    get childNodes() { return this.children; }
    get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
    get firstChild() { return this.children[0] || null; }
    get firstElementChild() { return this.firstChild; }
    get isConnected(): boolean { return this === doc.documentElement || !!this.parentNode?.isConnected; }
    get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
    set textContent(value: string) { this.ownText = value; this.replaceChildren(); }
    get classList() {
      return {
        add: (...names: string[]) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names: string[]) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        contains: (name: string) => this.className.split(/\s+/).includes(name),
        toggle: (name: string, force?: boolean) => {
          const enabled = force ?? !this.className.split(/\s+/).includes(name);
          if (enabled) this.classList.add(name); else this.classList.remove(name);
          return enabled;
        },
      };
    }
    append(...nodes: (Element | string)[]) {
      for (const node of nodes) {
        const child = typeof node === 'string' ? doc.createTextNode(node) : node;
        child.remove(); child.parentNode = this; this.children.push(child);
      }
    }
    appendChild(node: Element) { this.append(node); return node; }
    removeChild(node: Element) { node.remove(); return node; }
    remove() {
      if (this.parentNode?.children) this.parentNode.children = this.parentNode.children.filter((node: Element) => node !== this);
      this.parentNode = null;
    }
    replaceChildren(...nodes: (Element | string)[]) {
      for (const child of this.children) child.parentNode = null;
      this.children = []; this.append(...nodes);
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, String(value));
      if (name === 'id') this.id = String(value);
      if (name === 'class') this.className = String(value);
    }
    getAttribute(name: string) {
      if (name === 'id') return this.id || null;
      if (name === 'class') return this.className || null;
      return this.attributes.get(name) ?? null;
    }
    hasAttribute(name: string) { return this.getAttribute(name) !== null; }
    removeAttribute(name: string) { this.attributes.delete(name); }
    contains(node: any): boolean { return node === this || this.children.some(child => child.contains(node)); }
    querySelectorAll(selector: string) { return descendants(this).filter(node => matches(node, selector)); }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector: string): Element | null { return matches(this, selector) ? this : this.parentElement?.closest(selector) || null; }
    focus() {
      if (doc.activeElement === this) return;
      doc.activeElement = this;
      fire(this, 'focusin');
    }
    scrollIntoView(options: any) { this.scrollCalls.push(options); }
    get offsetTop() { return this.getAttribute('role') === 'option' ? (this.parentNode?.children.indexOf(this) || 0) * 34 + 4 : 0; }
    get offsetHeight() { return this.getAttribute('role') === 'option' ? 34 : this.localName === 'button' ? 40 : Math.min(this.scrollHeight, parseFloat(this.style.maxHeight) || 280); }
    get offsetWidth() { return parseFloat(this.style.width) || parseFloat(this.style.minWidth) || 220; }
    get clientHeight() { return this.offsetHeight; }
    get scrollHeight(): number { return this.getAttribute('role') === 'listbox' ? this.children.length * 34 + 8 : 40; }
    getBoundingClientRect() {
      const rect = this.rect || {
        left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0,
        width: this.offsetWidth, height: this.offsetHeight,
      };
      return { ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON() { return this; } };
    }
  }

  const doc: any = new EventTarget();
  doc.nodeType = 9;
  doc.createElement = () => { throw new Error('Chrome XML documents require createElementNS(XHTML).'); };
  doc.createElementNS = (namespace: string, name: string) => { assert.equal(namespace, XHTML); return new Element(name); };
  doc.createTextNode = (value: string) => { const node = new Element('#text'); node.textContent = value; return node; };
  doc.documentElement = new Element('html');
  doc.body = new Element('body');
  doc.documentElement.append(doc.body);
  doc.documentElement.parentNode = doc;
  doc.activeElement = doc.body;
  doc.getElementById = (id: string) => [doc.documentElement, ...descendants(doc.documentElement)].find(node => node.id === id) || null;
  doc.querySelectorAll = (selector: string) => [doc.documentElement, ...descendants(doc.documentElement)].filter(node => matches(node, selector));
  doc.querySelector = (selector: string) => doc.querySelectorAll(selector)[0] || null;

  const timers = new Map<number, () => void>();
  let timerID = 0;
  const win: any = new EventTarget();
  Object.assign(win, {
    document: doc, innerWidth: 800, innerHeight: 600,
    setTimeout(callback: () => void) { const id = ++timerID; timers.set(id, callback); return id; },
    clearTimeout(id: number) { timers.delete(id); },
    getComputedStyle() { return { direction: 'ltr', fontSize: '14px' }; },
  });
  doc.defaultView = win;

  function descendants(root: Element): Element[] { return root.children.flatMap(child => [child, ...descendants(child)]); }
  function matches(node: Element, selector: string): boolean {
    return selector.split(',').some(part => {
      const simple = part.trim();
      if (simple.startsWith('#')) return node.id === simple.slice(1);
      if (simple.startsWith('.')) return node.classList.contains(simple.slice(1));
      const attribute = simple.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
      if (attribute) return attribute[2] === undefined ? node.hasAttribute(attribute[1]) : node.getAttribute(attribute[1]) === attribute[2];
      return node.localName === simple.toLowerCase();
    });
  }
  function dispatch(target: any, raw: any) {
    const event = Object.assign({
      bubbles: true, cancelable: true, defaultPrevented: false, cancelBubble: false,
      key: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; },
      stopPropagation() { this.cancelBubble = true; },
      stopImmediatePropagation() { this.cancelBubble = true; this.immediateStopped = true; },
    }, raw, { target });
    const path: any[] = [target];
    for (let ancestor = target.parentNode; ancestor; ancestor = ancestor.parentNode) path.push(ancestor);
    if (path.includes(doc)) path.push(win);
    event.composedPath = () => [...path];
    function invoke(current: any, capture: boolean) {
      event.currentTarget = current;
      for (const entry of [...(current.listeners.get(event.type) || [])] as Listener[]) {
        if (entry.capture !== capture) continue;
        if (entry.once) current.removeEventListener(event.type, entry.callback, capture);
        if (typeof entry.callback === 'function') entry.callback.call(current, event); else entry.callback.handleEvent(event);
        if (event.immediateStopped) break;
      }
    }
    for (const current of [...path].reverse()) { invoke(current, true); if (event.cancelBubble) break; }
    if (!event.cancelBubble) for (const current of event.bubbles ? path : [target]) { invoke(current, false); if (event.cancelBubble) break; }
    return !event.defaultPrevented;
  }
  function fire(target: any, type: string, properties: any = {}) {
    return { defaultPrevented: !dispatch(target, { type, ...properties }) };
  }
  function pointerClick(target: any) {
    const pointerDown = fire(target, 'pointerdown');
    const mouseDown = fire(target, 'mousedown');
    if (!pointerDown.defaultPrevented && !mouseDown.defaultPrevented && target.localName === 'button' && !target.disabled) target.focus();
    fire(target, 'pointerup'); fire(target, 'mouseup'); fire(target, 'click');
  }
  function key(target: any, value: string, properties: any = {}) { return fire(target, 'keydown', { key: value, ...properties }); }
  function popup() { return doc.querySelector('[role="listbox"]') as Element | null; }
  function options() { return popup()?.querySelectorAll('[role="option"]') || []; }
  function active(button: any) { return doc.getElementById(button.getAttribute('aria-activedescendant')); }
  function dropdown(overrides: any = {}) {
    const changes: string[] = [];
    const button = createDropdown(win, {
      id: 'scope', value: 'pilot', choices: [['pilot', 'Pilot · 50 papers'], ['selected', 'Selected papers in Zotero'], ['collections', 'Selected collections'], ['library', 'Whole personal library']],
      onChange: (value: string) => changes.push(value), ...overrides,
    }) as any as Element;
    button.rect = { left: 100, top: 100, width: 240, height: 40 };
    const card = doc.createElementNS(XHTML, 'section'); card.style.overflow = 'hidden';
    card.append(button); doc.body.append(card);
    return { button, changes, card };
  }
  return { win, doc, timers, fire, pointerClick, key, popup, options, active, dropdown };
}

test('dropdown uses one XHTML button with the selected label and combobox semantics', () => {
  const dom = chromeDOM();
  const { button } = dom.dropdown({ value: 'collections' });
  assert.equal(button.localName, 'button');
  assert.equal(button.namespaceURI, XHTML);
  assert.equal(button.type, 'button');
  assert.equal(button.id, 'scope');
  assert.match(button.textContent, /Selected collections/);
  assert.equal(button.getAttribute('role'), 'combobox');
  assert.equal(button.getAttribute('aria-haspopup'), 'listbox');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.ok(button.getAttribute('aria-controls'));
  assert.equal(dom.doc.querySelectorAll('select, option').length, 0);
  assert.equal(dom.popup(), null);
});

test('opening portals exactly one option per choice outside clipping cards', () => {
  const dom = chromeDOM();
  const { button, card } = dom.dropdown();
  dom.pointerClick(button);
  const popup = dom.popup()!;
  assert.ok(popup);
  assert.equal(popup.parentNode, dom.doc.body);
  assert.equal(card.contains(popup), false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(button.getAttribute('aria-controls'), popup.id);
  assert.deepEqual(dom.options().map(option => option.textContent), ['Pilot · 50 papers', 'Selected papers in Zotero', 'Selected collections', 'Whole personal library']);
  assert.equal(dom.options().filter(option => option.getAttribute('aria-selected') === 'true').length, 1);
  assert.equal(dom.doc.querySelectorAll('select, option').length, 0);
});

test('pointer selection commits once, updates the label, and retains trigger focus', () => {
  const dom = chromeDOM();
  const { button, changes } = dom.dropdown();
  button.focus(); dom.pointerClick(button);
  dom.pointerClick(dom.options()[2]);
  assert.deepEqual(changes, ['collections']);
  assert.match(button.textContent, /Selected collections/);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(dom.popup(), null);
  assert.equal(dom.doc.activeElement, button);
  dom.pointerClick(button); dom.pointerClick(dom.options()[2]);
  assert.deepEqual(changes, ['collections'], 'Choosing the current value must not write the same setting twice.');
});

test('selection closes before callbacks that synchronously rerender the manager', () => {
  const dom = chromeDOM();
  let callbacks = 0;
  const { button, card } = dom.dropdown({ onChange(value: string) {
    callbacks++;
    assert.equal(value, 'library');
    assert.equal(dom.popup(), null);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    cleanupDropdowns(dom.doc);
    card.replaceChildren();
  } });
  dom.pointerClick(button); dom.pointerClick(dom.options()[3]);
  assert.equal(callbacks, 1);
  assert.equal(button.isConnected, false);
  assert.equal(dom.popup(), null);
  assert.equal(dom.doc.listenerCount(), 0);
  assert.equal(dom.win.listenerCount(), 0);
});

test('arrow keys, Home, End and Enter navigate without committing until requested', () => {
  const dom = chromeDOM();
  const { button, changes } = dom.dropdown();
  assert.equal(dom.key(button, 'ArrowDown').defaultPrevented, true);
  assert.equal(dom.active(button)?.textContent, 'Pilot · 50 papers');
  dom.key(button, 'ArrowDown');
  assert.equal(dom.active(button)?.textContent, 'Selected papers in Zotero');
  dom.key(button, 'ArrowUp');
  assert.equal(dom.active(button)?.textContent, 'Pilot · 50 papers');
  dom.key(button, 'End');
  assert.equal(dom.active(button)?.textContent, 'Whole personal library');
  dom.key(button, 'Home');
  assert.equal(dom.active(button)?.textContent, 'Pilot · 50 papers');
  dom.key(button, 'End');
  assert.deepEqual(changes, []);
  dom.key(button, 'Enter');
  assert.deepEqual(changes, ['library']);
  assert.equal(dom.popup(), null);
});

test('Space opens and commits an active choice', () => {
  const dom = chromeDOM();
  const { button, changes } = dom.dropdown();
  assert.equal(dom.key(button, ' ').defaultPrevented, true);
  dom.key(button, 'ArrowDown');
  assert.equal(dom.key(button, ' ').defaultPrevented, true);
  assert.deepEqual(changes, ['selected']);
  assert.equal(dom.popup(), null);
});

test('Escape cancels pending navigation and Tab dismisses without trapping focus', () => {
  const dom = chromeDOM();
  const { button, changes } = dom.dropdown();
  dom.key(button, 'ArrowDown'); dom.key(button, 'End');
  assert.equal(dom.key(button, 'Escape').defaultPrevented, true);
  assert.equal(dom.popup(), null);
  assert.deepEqual(changes, []);
  dom.key(button, 'ArrowDown');
  assert.equal(dom.active(button)?.textContent, 'Pilot · 50 papers', 'Cancelled navigation must not replace the selected value.');
  assert.equal(dom.key(button, 'Tab').defaultPrevented, false);
  assert.equal(dom.popup(), null);
  assert.deepEqual(changes, []);
});

test('printable typeahead finds a label and commits only on Enter', () => {
  const dom = chromeDOM();
  const { button, changes } = dom.dropdown({ value: 'all', choices: [['all', 'All definitions'], ['approved', 'Approved'], ['custom', 'Custom topics'], ['drafts', 'Drafts']] });
  dom.key(button, 'c'); dom.key(button, 'u');
  assert.equal(dom.active(button)?.textContent, 'Custom topics');
  assert.deepEqual(changes, []);
  assert.ok(dom.timers.size > 0, 'Typeahead should reset its buffer after a short timeout.');
  dom.key(button, 'Enter');
  assert.deepEqual(changes, ['custom']);
  assert.equal(dom.timers.size, 0);
});

test('typeahead forgets an expired prefix before the next character', () => {
  const dom = chromeDOM();
  const { button, changes } = dom.dropdown({ value: 'all', choices: [['all', 'All definitions'], ['custom', 'Custom topics'], ['drafts', 'Drafts']] });
  dom.key(button, 'c');
  assert.equal(dom.active(button)?.textContent, 'Custom topics');
  for (const [id, callback] of [...dom.timers]) { dom.timers.delete(id); callback(); }
  dom.key(button, 'd');
  assert.equal(dom.active(button)?.textContent, 'Drafts');
  dom.key(button, 'Enter');
  assert.deepEqual(changes, ['drafts']);
});

test('long-list navigation keeps the active option live and scrolls it into view', () => {
  const dom = chromeDOM();
  const choices = Array.from({ length: 80 }, (_, index) => [`account-${index}`, `Account ${index}`]);
  const { button, changes } = dom.dropdown({ value: 'account-0', choices });
  dom.key(button, 'End');
  const active = dom.active(button)!;
  assert.equal(active, dom.options()[79]);
  assert.equal(active.textContent, 'Account 79');
  const popup = dom.popup()!;
  assert.ok(active.offsetTop >= popup.scrollTop, 'The active option must not be clipped above the scrolling viewport.');
  assert.ok(active.offsetTop + active.offsetHeight <= popup.scrollTop + popup.clientHeight, 'The active option must not be clipped below the scrolling viewport.');
  assert.ok(parseFloat(dom.popup()!.style.maxHeight) > 0);
  assert.ok(dom.popup()!.getBoundingClientRect().height < dom.popup()!.scrollHeight);
  dom.key(button, 'Enter');
  assert.deepEqual(changes, ['account-79']);
});

test('outside pointer presses close without committing and only one popup stays open', () => {
  const dom = chromeDOM();
  const first = dom.dropdown();
  const second = dom.dropdown({ id: 'status' });
  dom.pointerClick(first.button); dom.key(first.button, 'End');
  dom.pointerClick(second.button);
  assert.equal(first.button.getAttribute('aria-expanded'), 'false');
  assert.equal(second.button.getAttribute('aria-expanded'), 'true');
  assert.equal(dom.doc.querySelectorAll('[role="listbox"]').length, 1);
  assert.deepEqual(first.changes, []);
  dom.fire(dom.doc.body, 'pointerdown');
  assert.equal(dom.popup(), null);
  assert.equal(second.button.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(second.changes, []);
});

test('a popup fits below a trigger and flips above it near the viewport bottom', () => {
  const dom = chromeDOM();
  const { button } = dom.dropdown();
  dom.pointerClick(button);
  let rect = dom.popup()!.getBoundingClientRect();
  assert.ok(rect.top >= button.getBoundingClientRect().bottom);
  assert.ok(rect.bottom <= dom.win.innerHeight);
  cleanupDropdowns(dom.doc);
  button.rect = { left: 730, top: 548, width: 60, height: 40 };
  dom.pointerClick(button);
  rect = dom.popup()!.getBoundingClientRect();
  assert.ok(rect.top < button.getBoundingClientRect().top);
  assert.ok(rect.bottom <= button.getBoundingClientRect().top);
  assert.ok(rect.left >= 0);
  assert.ok(rect.right <= dom.win.innerWidth);
});

test('scrolling inside the popup is allowed; outside scroll, resize and focus changes dismiss it', () => {
  const dom = chromeDOM();
  const { button, changes } = dom.dropdown();
  dom.pointerClick(button);
  dom.fire(dom.popup(), 'scroll', { bubbles: false });
  assert.ok(dom.popup());
  dom.fire(dom.doc.body, 'scroll', { bubbles: false });
  assert.equal(dom.popup(), null);
  dom.pointerClick(button); dom.fire(dom.win, 'resize');
  assert.equal(dom.popup(), null);
  dom.pointerClick(button); dom.doc.body.focus();
  assert.equal(dom.popup(), null);
  assert.deepEqual(changes, []);
});

test('rerender cleanup and window unload remove portals, timers and active global listeners', () => {
  const dom = chromeDOM();
  const { button, card, changes } = dom.dropdown();
  const baseline = { document: dom.doc.listenerCount(), window: dom.win.listenerCount() };
  dom.key(button, 'w');
  assert.ok(dom.popup());
  cleanupDropdowns(dom.doc);
  card.replaceChildren();
  assert.equal(dom.popup(), null);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-activedescendant'), null);
  assert.equal(dom.timers.size, 0);
  assert.equal(dom.doc.listenerCount(), baseline.document);
  assert.equal(dom.win.listenerCount(), baseline.window);
  const replacement = dom.dropdown({ id: 'replacement' });
  dom.pointerClick(replacement.button);
  dom.fire(dom.win, 'unload');
  assert.equal(dom.popup(), null);
  assert.equal(dom.doc.listenerCount(), baseline.document);
  assert.equal(dom.win.listenerCount(), baseline.window);
  assert.deepEqual(changes, []);
  assert.deepEqual(replacement.changes, []);
});

test('disabled controls cannot open from pointer, keyboard or typeahead', () => {
  const dom = chromeDOM();
  const { button, changes } = dom.dropdown({ disabled: true });
  assert.equal(button.disabled, true);
  dom.pointerClick(button);
  for (const value of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'w']) dom.key(button, value);
  assert.equal(dom.popup(), null);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(changes, []);
  assert.equal(dom.timers.size, 0);
});
