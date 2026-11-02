import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

async function bundleMain(_disposeGate = false, mockUI = false) {
  const result = await build({
    entryPoints: ['src/main.ts'], bundle: true, write: false, format: 'iife',
    globalName: 'SmartTags', target: 'firefox140', platform: 'browser',
    plugins: [{
      name: 'lifecycle-workspace-adapter',
      setup(plugin) {
        plugin.onLoad({filter:/[/\\]workspace\.ts$/},()=>({loader:'ts',contents:`
          export function createNativeWorkspace(options) {
            const observer=(globalThis as any).__lifecycleWorkspace;
            const workspace={ready:Promise.resolve(),host:{host:{mutating:new Set()}},diagnostics:{phase:'ready',revision:0},
              async execute(command,options){observer.commands.push(command);if(command.type==='check-plugin-updates'){await observer.openManager({page:'settings'});Zotero.getMainWindow()?.document.getElementById('menu_addons')?.doCommand();}return {commandId:options.commandId,revision:0};},
              watch(query,receive,{signal}){const update=()=>receive(observer.error?{phase:'error',revision:0,error:observer.error}:{phase:'ready',revision:0,model:observer.model});observer.watchers.add(update);update();const stop=()=>observer.watchers.delete(update);signal.addEventListener('abort',stop,{once:true});return stop;},
              async notify(changes){await observer.notify(changes);},
              async close(reason){observer.closed.push(reason);await (globalThis as any).__lifecycleDisposeGate?.();observer.watchers.clear();}
            };observer.current=workspace;observer.openManager=options.openManager;return workspace;
          }
        `}));
      },
    }, ...(mockUI ? [{
      name: 'observe-manager-mount',
      setup(plugin: any) {
        plugin.onLoad({ filter: /[/\\]ui\.ts$/ }, () => ({ loader: 'ts', contents: `
          export function mountManager(_win, api) {
            const observer = (globalThis as any).__lifecycleUI;
            observer.api = api;
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
  const copies: { source: string; destination: string }[] = [];
  const menus = new Map<string, any>();
  const sections = new Map<string, any>();
  const observers = new Map<string, any>();
  const locale = new Set<string>();
  const timers = new Map<number, () => void>();
  const errors: unknown[] = [];
  const workspace:any={commands:[],closed:[],watchers:new Set<()=>void>(),error:undefined,notify:async()=>{},model:{vocabularyVersion:0,pilotReviewed:false,taxonomyReady:false,tags:[],papers:[],suggestions:[],cleanup:[],history:[],neighbors:{},queue:{status:'idle',total:0,completed:0,failed:0},settings:{provider:'chatgpt',model:'',autoAssign:false,budgetUSD:5,inputPricePerMillion:0,outputPricePerMillion:0,maxOutputTokens:8192,coreConceptLimit:60},models:[],connection:{apiKeyStored:false,deepseekKeyStored:false,chatgptSignedIn:false}}};
  let timerID = 0;
  let fetchCalls = 0;
  let libraryWrites = 0;
  let libraryReads = 0;
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
    openDialog(url: string, _name: string, _features: string, bridge: unknown) { assert.equal(url, `chrome://smart-tags/content/manager.xhtml?v=${startup.version}`); if (!options.manager) throw new Error('No test manager window supplied'); options.manager.arguments = [bridge]; return options.manager; },
  };
  const Zotero: any = {
    initializationPromise: Promise.resolve(),
    getMainWindows: () => [win], getMainWindow: () => win,
    getActiveZoteroPane: () => null,
    Libraries: { userLibraryID: 1 },
    Items: { getAsync: async (id: number) => id === regular.id ? regular : null, getAll: async () => { libraryReads++;return [regular]; } },
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
      read: async (path: string) => { if (!files.has(path)) throw new Error('Missing test file'); return new TextEncoder().encode(files.get(path)!); },
      exists: async (path: string) => files.has(path),
      writeUTF8: async (path: string, text: string, options: { tmpPath: string }) => { writes.push({ path, tmpPath: options.tmpPath }); files.set(path, text); },
      copy: async (source: string, destination: string, options: { noOverwrite?: boolean }) => {
        assert.equal(options.noOverwrite, true, 'Migration backups must refuse replacement');
        if (!files.has(source)) throw new Error('Missing copy source');
        if (files.has(destination)) throw new Error('Destination already exists');
        copies.push({ source, destination }); files.set(destination, files.get(source)!);
      },
    },
    PathUtils: { join: (...parts: string[]) => parts.join('/') },
    fetch: async () => { fetchCalls++; throw new Error('Unexpected API request during lifecycle test'); },
    crypto: webcrypto, TextEncoder, TextDecoder, URL, URLSearchParams, AbortController, AbortSignal,
    ReadableStream, Response, Request, Headers, atob, btoa, console,
    setTimeout: (callback: () => void) => { const id = ++timerID; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    __lifecycleDisposeGate: options.disposeGate,
    __lifecycleUI: options.ui,
    __lifecycleWorkspace: workspace,
  });
  if (options.manager) {
    options.manager.setTimeout = context.setTimeout;
    options.manager.clearTimeout = context.clearTimeout;
  }
  vm.runInContext(code, context);
  return {
    app: context.SmartTags, Zotero, win, regular, files, writes, copies, menus, sections, observers, locale, timers, errors,workspace,
    get fetchCalls() { return fetchCalls; },
    get libraryWrites() { return libraryWrites; },
    get libraryReads() { return libraryReads; },
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
    nodeType = 1;
    parentNode: Element | null = null;
    private ownText = '';
    constructor(ownerDocument: any, tagName: string) { this.ownerDocument = ownerDocument; this.tagName = tagName; }
    get localName() { return this.tagName; }
    get childNodes() { return this.children; }
    get textContent(): string { return this.ownText + this.children.map(child => typeof child === 'string' ? child : child.textContent || '').join(''); }
    set textContent(value: string) { this.ownText = value; this.children = []; }
    append(...children: any[]) { for(const child of children){child.remove?.();if(typeof child==='object')child.parentNode=this;this.children.push(child);} }
    replaceChildren(...children: any[]) { this.ownText = '';for(const child of this.children)if(typeof child==='object')child.parentNode=null;this.children=[];this.append(...children); }
    insertBefore(child:Element,before:Element|null) { child.remove();child.parentNode=this;const index=before?this.children.indexOf(before):-1;if(index<0)this.children.push(child);else this.children.splice(index,0,child);return child; }
    remove() { if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null; }
    removeChild(child:Element) { child.remove();return child; }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    getAttribute(key: string) { return this.attributes.get(key) || null; }
    removeAttribute(key:string) { this.attributes.delete(key); }
    addEventListener() {}
    removeEventListener() {}
    focus() { this.ownerDocument.activeElement = this; }
    contains(node: any) { return node === this || this.children.some(child => typeof child !== 'string' && child.contains?.(node)); }
    querySelector(selector: string) {
      const find = (element: any): any => (selector.startsWith('#') ? element?.id === selector.slice(1) : element?.className?.split(/\s+/).includes(selector.slice(1))) ? element : element?.children?.map(find).find(Boolean);
      return this.children.map(find).find(Boolean) || null;
    }
  }
  let app: Element | null = null;
  const listeners = new Map<string, Set<() => void>>();
  const doc: any = {
    readyState: 'loading', documentURI: 'about:blank', activeElement: null,
    getElementById(id: string) {
      const find = (element: any): any => element?.id === id ? element : element?.children?.map(find).find(Boolean);
      return find(app) || null;
    },
    querySelector(selector: string) {
      const find = (element: any): any => element?.className?.split(/\s+/).includes(selector.slice(1)) ? element : element?.children?.map(find).find(Boolean);
      return find(app) || null;
    },
    createElement() { throw new Error('An XML manager document requires the explicit HTML namespace'); },
    createElementNS(namespace: string, name: string) {
      assert.ok(['http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg'].includes(namespace), `Unexpected element namespace: ${namespace}`);
      return new Element(doc, name);
    },
    createTextNode(text: string) { const textNode = new Element(doc, '#text');textNode.nodeType=3;textNode.textContent = text; return textNode; },
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
    ready() { doc.readyState = 'complete'; doc.documentURI = 'chrome://smart-tags/content/manager.xhtml'; app = new Element(doc, 'div'); app.id = 'app'; app.append(doc.createTextNode('Opening Smart Tags…')); },
    get app() { return app; },
  };
}

function runNextTimer(timers: Map<number, () => void>) {
  const next = timers.entries().next().value;
  assert.ok(next, 'expected a pending manager-readiness timer');
  timers.delete(next[0]); next[1]();
}

async function startNative(native: ReturnType<typeof nativeHarness>) {
  await native.app.startup(startup);
}

test('native startup registers UI and notifier, persists only plugin state, and makes no AI or library writes', async () => {
  const native = nativeHarness(await normalBundle);
  await startNative(native);
  assert.deepEqual([...native.menus.keys()], ['smart-tags-tools', 'smart-tags-items', 'smart-tags-collections']);
  assert.equal(native.sections.size, 0, "right item and information panes stay unchanged");
  assert.equal(native.observers.size, 1);
  assert.equal(native.locale.has('smart-tags.ftl'), true);
  assert.ok(native.Zotero.SmartTags.workspace);
  assert.equal(native.Zotero.SmartTags.controller, undefined);
  assert.equal(native.Zotero.SmartTags.version, '0.1.0');
  assert.equal(native.Zotero.SmartTags.stateDirectory, '/test-profile/smart-tags');
  assert.equal(native.writes.length, 0, "The main lifecycle delegates persistence to Workspace.");
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
  await startNative(native);
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
  await startNative(native);
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

test('disabling an idle native plugin releases registrations without serializing its saved history', async () => {
  const native = nativeHarness(await normalBundle);
  await startNative(native);
  const writes = native.writes.length;
  await native.app.shutdown();
  assert.equal(native.writes.length, writes);
  assert.equal(native.Zotero.SmartTags, undefined);
  assert.equal(native.observers.size, 0);
  assert.equal(native.menus.size, 0);
  assert.equal(native.timers.size, 0);
  assert.equal(native.errors.length, 0);
});

test('main shutdown awaits durable Workspace close after removing native registrations', async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const atClose = new Promise<void>(resolve => { entered = resolve; });
  const native = nativeHarness(await normalBundle, { disposeGate: () => { entered(); return gate; } });
  await startNative(native);
  let finished = false;
  const stopping = native.app.shutdown().then(() => { finished = true; });
  await atClose;
  assert.equal(finished, false);
  assert.equal(native.observers.size, 0);
  assert.equal(native.menus.size, 0);
  assert.deepEqual(native.workspace.closed, ['disable']);
  release();await stopping;
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
  await startNative(native);
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
  await startNative(native);
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
  await startNative(native);
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
  await startNative(native);
  await native.app.openManager();
  for (let turn = 0; turn < 20 && dialog.app!.getAttribute('data-smart-tags-state') !== 'ready'; turn++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(dialog.app!.getAttribute('data-smart-tags-state'), 'ready', dialog.app!.textContent);
  assert.match(dialog.app!.textContent, /Create your first tag list/);
  assert.match(dialog.app!.textContent, /Build tags/);
  assert.doesNotMatch(dialog.app!.textContent, /Opening Smart Tags/);
  assert.equal(native.errors.length, 0);
  await native.app.shutdown();
});

test('a failed first page query shows a retryable error and recovers on the next update', async () => {
  const dialog = managerDialog(); dialog.ready();
  const native = nativeHarness(await normalBundle, { manager: dialog.win });
  await startNative(native);
  native.workspace.error='Local settings are temporarily unavailable';
  await native.app.openManager();
  for (let turn=0;turn<20&&dialog.app!.getAttribute('data-smart-tags-state')!=='error';turn++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(dialog.app!.getAttribute('data-smart-tags-state'),'error');
  assert.match(dialog.app!.textContent,/temporarily unavailable/);
  assert.match(dialog.app!.textContent,/Retry loading/);
  native.workspace.error=undefined;
  for(const update of native.workspace.watchers)update();
  for(let turn=0;turn<20&&dialog.app!.getAttribute('data-smart-tags-state')!=='ready';turn++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(dialog.app!.getAttribute('data-smart-tags-state'),'ready');
  await native.app.shutdown();
});

test('manager readiness polling is bounded when no app document arrives', async () => {
  const dialog = managerDialog();
  const ui = { mounts: 0, destroys: 0, fail: false };
  const native = nativeHarness(await bundleMain(false, true), { manager: dialog.win, ui });
  await startNative(native);
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
  await startNative(native);
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

test('main windows keep native Collections without a panel, startup scans or idle timers',async()=>{
  const dialog=managerDialog();dialog.ready();const ui:any={mounts:0,destroys:0,fail:false};
  const native=nativeHarness(await bundleMain(false,true),{manager:dialog.win,ui});await native.app.startup(startup);
  assert.equal(native.Zotero.SmartTags.getNavigator,undefined);assert.equal(native.timers.size,0);assert.equal(native.libraryReads,0);
  assert.deepEqual([...native.observers.keys()],['smart-tags']);assert.equal(ui.mounts,0);
  native.app.onMainWindowLoad(native.win);const second:any={document:{querySelectorAll:()=>[]}};native.app.onMainWindowLoad(second);
  assert.equal(native.timers.size,0);assert.equal(native.libraryReads,0,'closed pages never request library snapshots');
  let updates=0;(native.win.document as any).getElementById=(id:string)=>id==='menu_addons'?{doCommand(){updates++;}}:null;
  await native.app.openManager();let model:any;
  const abort=new AbortController();ui.api.watch({page:'settings'},(event:any)=>{model=event.model;},{signal:abort.signal});abort.abort();
  assert.equal(model.pluginVersion,startup.version);assert.equal(model.navigation,undefined);
  await ui.api.execute({type:'check-plugin-updates'},{commandId:'updates'});assert.equal(updates,1);assert.equal(native.fetchCalls,0);assert.equal(native.libraryWrites,0);
  await native.app.shutdown();assert.equal(native.timers.size,0);assert.equal(native.observers.size,0);
});

test('an open manager sends plugin updates to a surviving library window only after its original closes',async()=>{
  const dialog=managerDialog();dialog.ready();const ui:any={mounts:0,destroys:0,fail:false};
  const native=nativeHarness(await bundleMain(false,true),{manager:dialog.win,ui});await native.app.startup(startup);
  let firstUpdates=0,secondUpdates=0;(native.win.document as any).getElementById=(id:string)=>id==='menu_addons'?{doCommand(){firstUpdates++;}}:null;
  await native.app.openManager();const second:any={closed:false,document:{getElementById:(id:string)=>id==='menu_addons'?{doCommand(){secondUpdates++;}}:null,querySelectorAll:()=>[]}};
  native.Zotero.getMainWindow=()=>second;native.app.onMainWindowLoad(second);await ui.api.execute({type:'check-plugin-updates'},{commandId:crypto.randomUUID()});assert.equal(firstUpdates,0);assert.equal(secondUpdates,1);
  (native.win as any).closed=true;native.app.onMainWindowUnload(native.win);await ui.api.execute({type:'check-plugin-updates'},{commandId:crypto.randomUUID()});assert.equal(firstUpdates,0);assert.equal(secondUpdates,2);
  assert.equal(native.timers.size,0);assert.equal(native.fetchCalls,0);assert.equal(native.libraryWrites,0);await native.app.shutdown();
});

test('item notification bursts use one deduplicated timer and preserve changes received during a flush',async()=>{
  const native=nativeHarness(await normalBundle);await startNative(native);const batches:any[]=[];
  native.Zotero.Items.getAsync=async(id:number)=>id===999?{id,isRegularItem:()=>false,isAttachment:()=>true,parentID:42}:{...native.regular,id,key:'PAPER'+id};
  const observer=native.observers.get('smart-tags').observer;
  native.workspace.notify=async(changes:any[])=>{batches.push(changes);if(batches.length===1)await observer.notify('modify','item',[44]);};
  for(let index=0;index<40;index++)await observer.notify('modify','item',[42,43,42]);
  await observer.notify('modify','item',[999]);
  assert.equal(native.timers.size,1);assert.equal(batches.length,0);runNextTimer(native.timers);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(batches.length,1);assert.deepEqual(JSON.parse(JSON.stringify(batches[0])),[{itemID:42,attachment:true},{itemID:43,attachment:false}]);assert.equal(native.timers.size,1);
  runNextTimer(native.timers);await new Promise(resolve=>setImmediate(resolve));assert.equal(batches.length,2);assert.equal(batches[1][0].itemID,44);assert.equal(native.timers.size,0);
  await observer.notify('modify','item',[45]);assert.equal(native.timers.size,1);await native.app.shutdown();assert.equal(native.timers.size,0);
});

test('closed Smart Tags pages forward deleted and trashed identities without scanning the library',async()=>{
  const native=nativeHarness(await normalBundle);await startNative(native);const batches:any[]=[];const reads:number[]=[];
  const observer=native.observers.get('smart-tags').observer;
  native.workspace.notify=async(changes:any[])=>{batches.push(changes);};
  native.Zotero.Items.getAsync=async(id:number)=>{reads.push(id);return id===42?{...native.regular,deleted:true}:id===43?{...native.regular,id,libraryID:2,deleted:true}:null;};
  await observer.notify('trash','item',[42,42,'NaN',0,-1]);
  await observer.notify('delete','item',[44,44,45],{44:{libraryID:1},45:{libraryID:2}});
  await observer.notify('trash','item',[43]);
  await observer.notify('delete','item',[46]);
  assert.equal(native.timers.size,1);assert.equal(batches.length,0);
  runNextTimer(native.timers);await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(batches)),[[{itemID:42,attachment:false},{itemID:44,attachment:false},{itemID:46,attachment:false}]]);
  assert.deepEqual(reads,[42,44,43,46]);assert.equal(native.libraryReads,0);assert.equal(native.fetchCalls,0);assert.equal(native.libraryWrites,0);
  await native.app.shutdown();
});

test('attachment removal follows Zotero parent refresh and does not guess a deleted attachment parent',async()=>{
  const native=nativeHarness(await normalBundle);await startNative(native);const batches:any[]=[];
  const observer=native.observers.get('smart-tags').observer;
  native.workspace.notify=async(changes:any[])=>{batches.push(changes);};
  native.Zotero.Items.getAsync=async(id:number)=>id===42?native.regular:id===90?{id,isRegularItem:()=>false,isAttachment:()=>true,parentID:42}:null;
  await observer.notify('trash','item',[90]);
  await observer.notify('delete','item',[91],{91:{libraryID:1,key:'ATTACH91',parentID:999}});
  await observer.notify('refresh','item',[42]);
  runNextTimer(native.timers);await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(batches)),[[{itemID:42,attachment:true},{itemID:91,attachment:false}]]);
  assert.equal(native.libraryReads,0);await native.app.shutdown();
});

test('an item read failure cannot masquerade as a deletion or bypass native-write suppression',async()=>{
  const native=nativeHarness(await normalBundle);await startNative(native);const batches:any[]=[];
  const observer=native.observers.get('smart-tags').observer;
  native.workspace.notify=async(changes:any[])=>{batches.push(changes);};
  native.Zotero.Items.getAsync=async(id:number)=>{if(id===42)throw new Error('Native read unavailable');return null;};
  native.workspace.current.host.host.mutating.add(44);
  await observer.notify('delete','item',[42,44]);assert.equal(native.timers.size,0);assert.equal(native.errors.length,1);
  await observer.notify('delete','item',[45]);native.workspace.current.host.host.mutating.add(45);
  runNextTimer(native.timers);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(batches.length,0);assert.equal(native.libraryReads,0);await native.app.shutdown();
});
