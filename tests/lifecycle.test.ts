import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

async function bundleMain(disposeGate = false, mockUI = false) {
  const result = await build({
    entryPoints: ['src/main.ts'], bundle: true, write: false, format: 'iife',
    globalName: 'SmartTags', target: 'firefox140', platform: 'browser',
    plugins: [...(disposeGate ? [{
      name: 'observe-provider-disposal',
      setup(plugin) {
        plugin.onLoad({ filter: /[/\\]providers\.ts$/ }, async args => ({
          // Keep the real provider and append an asynchronous observation boundary.
          // This proves main awaits disposal rather than merely calling it.
          contents: (await readFile(args.path, 'utf8')) + `
            const originalDisposeForLifecycleTest = ProviderClient.prototype.dispose;
            ProviderClient.prototype.dispose = async function () {
              await originalDisposeForLifecycleTest.call(this);
              await (globalThis as any).__lifecycleDisposeGate();
            };
          `,
          loader: 'ts',
        }));
      },
    }] : []), ...(mockUI ? [{
      name: 'observe-manager-mount',
      setup(plugin: any) {
        plugin.onLoad({ filter: /[/\\]ui\.ts$/ }, () => ({ loader: 'ts', contents: `
          export function mountManager() {
            const observer = (globalThis as any).__lifecycleUI;
            observer.mounts++;
            if (observer.fail) throw new Error('A deliberate manager mount failure');
            return {refresh: async () => {}, destroy() {observer.destroys++;}};
          }
        ` }));
      },
    }] : [])],
  });
  return result.outputFiles[0].text;
}

const normalBundle = bundleMain();
const startup = { id: 'smart-tags@lifecycle.test', version: '0.1.0', rootURI: 'file:///test-addon/' };

function nativeHarness(code: string, options: { failingMenu?: string; disposeGate?: () => Promise<void>; manager?: any; ui?: any } = {}) {
  const files = new Map<string, string>();
  const writes: { path: string; tmpPath: string }[] = [];
  const menus = new Map<string, any>();
  const sections = new Map<string, any>();
  const observers = new Map<string, any>();
  const locale = new Set<string>();
  const timers = new Map<number, () => void>();
  const errors: unknown[] = [];
  let timerID = 0;
  let fetchCalls = 0;
  let libraryWrites = 0;
  let localizedWindows = 0;
  const regular = {
    id: 42, key: 'PAPER042', libraryID: 1, deleted: false,
    isRegularItem: () => true,
    getField: (name: string) => name === 'title' ? 'A catalyst-layer resistance study' : '',
    getTags: () => [],
  };
  const win = {
    MozXULElement: { insertFTLIfNeeded() { localizedWindows++; } },
    document: { querySelectorAll: () => [], l10n: { removeResourceIds() {} } },
    openDialog(_url: string, _name: string, _features: string, bridge: unknown) { if (!options.manager) throw new Error('No test manager window supplied'); options.manager.arguments = [bridge]; return options.manager; },
  };
  const Zotero: any = {
    initializationPromise: Promise.resolve(),
    getMainWindows: () => [win], getMainWindow: () => win,
    getActiveZoteroPane: () => null,
    Libraries: { userLibraryID: 1 },
    Items: { getAsync: async (id: number) => id === regular.id ? regular : null, getAll: async () => [regular] },
    ftl: {
      addResourceIds: (ids: string[]) => ids.forEach(id => locale.add(id)),
      removeResourceIds: (ids: string[]) => ids.forEach(id => locale.delete(id)),
    },
    MenuManager: {
      registerMenu: (entry: any) => {
        if (entry.target === options.failingMenu) return false;
        menus.set(entry.menuID, entry); return entry.menuID;
      },
      unregisterMenu: (id: string) => menus.delete(id),
    },
    ItemPaneManager: {
      registerSection: (entry: any) => { sections.set(entry.paneID, entry); return entry.paneID; },
      unregisterSection: (id: string) => sections.delete(id),
    },
    Notifier: {
      registerObserver: (observer: any, types: string[], id: string) => { observers.set(id, { observer, types }); return id; },
      unregisterObserver: (id: string) => observers.delete(id),
    },
    DB: { executeTransaction() { libraryWrites++; throw new Error('Unexpected library write during lifecycle test'); } },
    logError: (error: unknown) => errors.push(error),
  };
  const context = vm.createContext({
    Zotero, Services: { dirsvc: { get: () => ({ path: '/test-profile' }) }, prompt: { alert() {} } },
    Cc: {}, Ci: { nsIFile: {} }, ChromeUtils: {},
    IOUtils: {
      makeDirectory: async () => {},
      readUTF8: async (path: string) => { if (!files.has(path)) throw new Error('Missing test file'); return files.get(path); },
      exists: async (path: string) => files.has(path),
      writeUTF8: async (path: string, text: string, options: { tmpPath: string }) => { writes.push({ path, tmpPath: options.tmpPath }); files.set(path, text); },
    },
    PathUtils: { join: (...parts: string[]) => parts.join('/') },
    fetch: async () => { fetchCalls++; throw new Error('Unexpected API request during lifecycle test'); },
    crypto: webcrypto, TextEncoder, TextDecoder, URL, URLSearchParams, AbortController, AbortSignal,
    ReadableStream, Response, Request, Headers, atob, btoa, console,
    setTimeout: (callback: () => void) => { const id = ++timerID; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    __lifecycleDisposeGate: options.disposeGate,
    __lifecycleUI: options.ui,
  });
  if (options.manager) {
    options.manager.setTimeout = context.setTimeout;
    options.manager.clearTimeout = context.clearTimeout;
  }
  vm.runInContext(code, context);
  return {
    app: context.SmartTags, Zotero, win, regular, files, writes, menus, sections, observers, locale, timers, errors,
    get fetchCalls() { return fetchCalls; },
    get libraryWrites() { return libraryWrites; },
    get localizedWindows() { return localizedWindows; },
  };
}

/** An XML-style chrome document: unnamespaced creation is deliberately forbidden. */
function managerDialog() {
  class Element {
    id = '';
    className = '';
    children: any[] = [];
    attributes = new Map<string, string>();
    style: any = {};
    ownerDocument: any;
    tagName: string;
    private ownText = '';
    constructor(ownerDocument: any, tagName: string) { this.ownerDocument = ownerDocument; this.tagName = tagName; }
    get textContent(): string { return this.ownText + this.children.map(child => typeof child === 'string' ? child : child.textContent || '').join(''); }
    set textContent(value: string) { this.ownText = value; this.children = []; }
    append(...children: any[]) { this.children.push(...children); }
    replaceChildren(...children: any[]) { this.ownText = ''; this.children = [...children]; }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    getAttribute(key: string) { return this.attributes.get(key) || null; }
    addEventListener() {}
    removeEventListener() {}
    focus() { this.ownerDocument.activeElement = this; }
    contains(node: any) { return node === this || this.children.some(child => typeof child !== 'string' && child.contains?.(node)); }
  }
  let app: Element | null = null;
  const listeners = new Map<string, Set<() => void>>();
  const doc: any = {
    readyState: 'loading', documentURI: 'about:blank', activeElement: null,
    getElementById(id: string) {
      const find = (element: any): any => element?.id === id ? element : element?.children?.map(find).find(Boolean);
      return find(app) || null;
    },
    createElement() { throw new Error('An XML manager document requires the explicit HTML namespace'); },
    createElementNS(namespace: string, name: string) {
      assert.ok(['http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg'].includes(namespace), `Unexpected element namespace: ${namespace}`);
      return new Element(doc, name);
    },
    createTextNode(text: string) { const textNode = new Element(doc, '#text'); textNode.textContent = text; return textNode; },
  };
  const win: any = {
    document: doc, closed: false, scrollY: 0, focus() {}, scrollTo() {},
    addEventListener(name: string, listener: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(listener); },
    removeEventListener(name: string, listener: () => void) { listeners.get(name)?.delete(listener); },
    dispatch(name: string) { for (const listener of [...listeners.get(name) || []]) listener(); },
    close() { win.closed = true; win.dispatch('unload'); },
  };
  return {
    win,
    ready() { doc.readyState = 'complete'; doc.documentURI = 'chrome://smart-tags/content/manager.xhtml'; app = new Element(doc, 'div'); app.id = 'app'; app.textContent = 'Opening Smart Tags…'; },
    get app() { return app; },
  };
}

function runNextTimer(timers: Map<number, () => void>) {
  const next = timers.entries().next().value;
  assert.ok(next, 'expected a pending manager-readiness timer');
  timers.delete(next[0]); next[1]();
}

test('native startup registers UI and notifier, persists only plugin state, and makes no AI or library writes', async () => {
  const native = nativeHarness(await normalBundle);
  await native.app.startup(startup);
  assert.deepEqual([...native.menus.keys()], ['smart-tags-tools', 'smart-tags-items', 'smart-tags-collections']);
  assert.equal(native.sections.size, 0, "right item and information panes stay unchanged");
  assert.equal(native.observers.size, 1);
  assert.equal(native.locale.has('smart-tags.ftl'), true);
  assert.ok(native.Zotero.SmartTags.controller);
  assert.equal(native.Zotero.SmartTags.version, '0.1.0');
  assert.equal(native.Zotero.SmartTags.stateDirectory, '/test-profile/smart-tags');
  const state = JSON.parse(native.files.get('/test-profile/smart-tags/state.json')!);
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.settings.autoAssign, false);
  assert.equal(state.run, null);
  assert.ok(native.writes.every(write => write.tmpPath === `${write.path}.tmp`));
  assert.equal(native.fetchCalls, 0);
  assert.equal(native.libraryWrites, 0);
  native.app.onMainWindowLoad(native.win);
  assert.equal(native.localizedWindows, 1, 'repeated window notifications must not duplicate localization setup');
  await native.app.shutdown();
  assert.equal(native.menus.size, 0);
  assert.equal(native.sections.size, 0);
  assert.equal(native.observers.size, 0);
  assert.equal(native.locale.size, 0);
  assert.equal(native.Zotero.SmartTags, undefined);
  assert.equal(native.errors.length, 0);
});

test('native collection menus use Zotero 10 plural context without registering item-pane sections', async () => {
  const native = nativeHarness(await normalBundle);
  await native.app.startup(startup);
  try {
    let visible: boolean | undefined, enabled: boolean | undefined;
    const menu = native.menus.get('smart-tags-collections').menus[0];
    const context = {
      collectionTreeRows: [{ isCollection: () => true, ref: { libraryID: 1 } }],
      get collectionTreeRow() { throw new Error('The removed singular context must never be accessed'); },
      setVisible(value: boolean) { visible = value; }, setEnabled(value: boolean) { enabled = value; },
    };
    menu.onShowing(null, context);
    assert.equal(visible, true); assert.equal(enabled, true);
    context.collectionTreeRows[0].ref.libraryID = 2;
    menu.onShowing(null, context);
    assert.equal(visible, false); assert.equal(enabled, false);
    assert.equal(native.sections.size, 0, "no item-pane section is registered");
  } finally { await native.app.shutdown(); }
});

test('shutdown clears debounced item work before it can analyze a paper', async () => {
  const native = nativeHarness(await normalBundle);
  await native.app.startup(startup);
  const observer = native.observers.get('smart-tags').observer;
  await observer.notify('modify', 'item', [42]);
  assert.equal(native.timers.size, 1);
  await observer.notify('add', 'item-tag', ['42-9']);
  assert.equal(native.timers.size, 1, 'successive item/tag notifications are debounced together');
  await native.app.shutdown();
  assert.equal(native.timers.size, 0);
  assert.equal(native.fetchCalls, 0);
  assert.equal(native.libraryWrites, 0);
  assert.equal(native.errors.length, 0);
});

test('main shutdown awaits asynchronous provider disposal before waiting on controller shutdown', async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const atDispose = new Promise<void>(resolve => { entered = resolve; });
  const native = nativeHarness(await bundleMain(true), { disposeGate: () => { entered(); return gate; } });
  await native.app.startup(startup);
  const app = native.Zotero.SmartTags.controller;
  const originalShutdown = app.shutdown.bind(app);
  let controllerStarted = false, finished = false;
  app.shutdown = async () => { controllerStarted = true; await originalShutdown(); };
  const stopping = native.app.shutdown().then(() => { finished = true; });
  await atDispose;
  assert.equal(finished, false);
  assert.equal(controllerStarted, false, 'controller work must wait until provider disposal settles');
  release();
  await stopping;
  assert.equal(controllerStarted, true);
  assert.equal(finished, true);
  assert.equal(native.Zotero.SmartTags, undefined);
  assert.equal(native.errors.length, 0);
});

test('a failed native registration cleans earlier registrations instead of leaving half a plugin active', async () => {
  const native = nativeHarness(await normalBundle, { failingMenu: 'main/library/item' });
  await assert.rejects(() => native.app.startup(startup), /Could not register Smart Tags menu/);
  assert.equal(native.menus.size, 0);
  assert.equal(native.sections.size, 0);
  assert.equal(native.observers.size, 0);
  assert.equal(native.locale.size, 0);
  assert.equal(native.Zotero.SmartTags, undefined);
  assert.equal(native.fetchCalls, 0);
  assert.equal(native.libraryWrites, 0);
});

test('manager polling mounts once when native load events were missed and clears readiness work', async () => {
  const dialog = managerDialog();
  const ui = { mounts: 0, destroys: 0, fail: false };
  const native = nativeHarness(await bundleMain(false, true), { manager: dialog.win, ui });
  await native.app.startup(startup);
  await native.app.openManager();
  assert.equal(ui.mounts, 0);
  assert.equal(native.timers.size, 1);
  dialog.ready();
  runNextTimer(native.timers);
  assert.equal(ui.mounts, 1);
  assert.equal(native.timers.size, 0);
  dialog.win.dispatch('DOMContentLoaded'); dialog.win.dispatch('load');
  assert.equal(ui.mounts, 1, 'late native events must not duplicate subscriptions or rendering');
  await native.app.shutdown();
  assert.equal(ui.destroys, 1);
  assert.equal(native.timers.size, 0);
});

test('manager mount failures replace the opening placeholder with an actionable error', async () => {
  const dialog = managerDialog(); dialog.ready();
  const ui = { mounts: 0, destroys: 0, fail: true };
  const native = nativeHarness(await bundleMain(false, true), { manager: dialog.win, ui });
  await native.app.startup(startup);
  await native.app.openManager();
  assert.equal(ui.mounts, 1);
  assert.equal(dialog.app!.getAttribute('data-smart-tags-state'), 'error');
  assert.match(dialog.app!.textContent, /could not finish opening/);
  assert.match(dialog.app!.textContent, /deliberate manager mount failure/);
  assert.match(dialog.app!.textContent, /reopen Smart Tags/);
  assert.equal(native.timers.size, 0);
  assert.equal(native.errors.length, 1);
  await native.app.shutdown();
});

test('closing the manager before its document is ready cancels pending polling', async () => {
  const dialog = managerDialog();
  const ui = { mounts: 0, destroys: 0, fail: false };
  const native = nativeHarness(await bundleMain(false, true), { manager: dialog.win, ui });
  await native.app.startup(startup);
  await native.app.openManager();
  assert.equal(native.timers.size, 1);
  dialog.win.close();
  runNextTimer(native.timers);
  assert.equal(native.timers.size, 0);
  assert.equal(ui.mounts, 0);
  await native.app.shutdown();
});

test('the real manager renders in an XML chrome document using explicit HTML namespaces', async () => {
  const dialog = managerDialog(); dialog.ready();
  const native = nativeHarness(await normalBundle, { manager: dialog.win });
  await native.app.startup(startup);
  await native.app.openManager();
  for (let turn = 0; turn < 20 && dialog.app!.getAttribute('data-smart-tags-state') !== 'ready'; turn++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(dialog.app!.getAttribute('data-smart-tags-state'), 'ready', dialog.app!.textContent);
  assert.match(dialog.app!.textContent, /Your library, clearly tagged/);
  assert.match(dialog.app!.textContent, /Rebuild vocabulary/);
  assert.doesNotMatch(dialog.app!.textContent, /Opening Smart Tags/);
  assert.equal(native.errors.length, 0);
  await native.app.shutdown();
});

test('a failed first snapshot shows a retryable error instead of keeping the opening placeholder', async () => {
  const dialog = managerDialog(); dialog.ready();
  const native = nativeHarness(await normalBundle, { manager: dialog.win });
  await native.app.startup(startup);
  const controller = native.Zotero.SmartTags.controller;
  const originalSnapshot = controller.snapshot.bind(controller);
  controller.snapshot = async () => { throw new Error('Local settings are temporarily unavailable'); };
  await native.app.openManager();
  for (let turn = 0; turn < 20 && dialog.app!.getAttribute('data-smart-tags-state') !== 'error'; turn++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(dialog.app!.getAttribute('data-smart-tags-state'), 'error');
  assert.match(dialog.app!.textContent, /could not load local settings/);
  assert.match(dialog.app!.textContent, /temporarily unavailable/);
  assert.match(dialog.app!.textContent, /Retry loading/);
  assert.doesNotMatch(dialog.app!.textContent, /Opening Smart Tags/);
  controller.snapshot = originalSnapshot;
  await controller.save();
  for (let turn = 0; turn < 20 && dialog.app!.getAttribute('data-smart-tags-state') !== 'ready'; turn++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(dialog.app!.getAttribute('data-smart-tags-state'), 'ready');
  assert.match(dialog.app!.textContent, /Your library, clearly tagged/);
  await native.app.shutdown();
});

test('manager readiness polling is bounded when no app document arrives', async () => {
  const dialog = managerDialog();
  const ui = { mounts: 0, destroys: 0, fail: false };
  const native = nativeHarness(await bundleMain(false, true), { manager: dialog.win, ui });
  await native.app.startup(startup);
  await native.app.openManager();
  for (let attempt = 0; attempt < 200; attempt++) runNextTimer(native.timers);
  assert.equal(native.timers.size, 0);
  assert.equal(ui.mounts, 0);
  assert.equal(native.errors.length, 1);
  assert.match(String(native.errors[0]), /within 20 seconds/);
  await native.app.shutdown();
});

test('final-document loader survives initial about:blank unload and mounts the actual child Window', async () => {
  const initial = managerDialog();
  const final = managerDialog();
  const ui = { mounts: 0, destroys: 0, fail: false };
  const native = nativeHarness(await bundleMain(false, true), { manager: initial.win, ui });
  await native.app.startup(startup);
  await native.app.openManager();
  initial.win.dispatch('unload');
  assert.equal(native.timers.size, 1, 'initial about:blank unload must not cancel the parent-owned fallback timer');
  Object.defineProperty(initial.win, 'document', { get() { throw new Error('The initial Window has navigated away'); } });
  runNextTimer(native.timers);
  assert.equal(native.timers.size, 1, 'an inaccessible initial Window must not prevent the final loader from arriving');
  final.ready();
  final.win.arguments = initial.win.arguments;
  const loader = await readFile('addon/content/manager-loader.js', 'utf8');
  vm.runInNewContext(loader, { window: final.win, document: final.win.document });
  assert.equal(ui.mounts, 1);
  assert.equal(native.timers.size, 0);
  final.win.close();
  assert.equal(ui.destroys, 1, 'only the final document unload should destroy the mounted UI');
  await native.app.shutdown();
  assert.equal(native.errors.length, 0);
});

test('the manager XHTML references its own final-document loader', async () => {
  const markup = await readFile('addon/content/manager.xhtml', 'utf8');
  assert.match(markup, /<script[^>]+src="chrome:\/\/smart-tags\/content\/manager-loader\.js"[^>]+defer="defer"/);
});
