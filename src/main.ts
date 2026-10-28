import { AppController, initialState, validState, validLegacyState, migrateState } from './controller.ts';
import { normalizeTagDefinitions } from './core.ts';
import type { AppState } from './controller.ts';
import { ZoteroHost, SecureCredentials, registerOAuthCallback, chooseJSONFile } from './platform.ts';
import { ProviderClient } from './providers.ts';
import { AtomicStore } from './store.ts';
import { mountManager } from './ui.ts';
import type { ManagerUIOptions } from './ui.ts';
import { mountNavigator } from './navigator.ts';
import { upsertWarning } from './warnings.ts';

type StartupData = { id: string; version: string; rootURI: string };

const HTML = 'http://www.w3.org/1999/xhtml';
const LOCALE = 'smart-tags.ftl';
const MANAGER_URL = 'chrome://smart-tags/content/manager.xhtml';
let controller: AppController | null = null;
let host: ZoteroHost | null = null;
let credentials: SecureCredentials | null = null;
let aiClient: ProviderClient | null = null;
let store: AtomicStore<AppState> | null = null;
let managerWindow: Window | null = null;
let managerUI: ReturnType<typeof mountManager> | null = null;
let managerReadinessCleanup: (() => void) | null = null;
let notifierID: string | number | null = null;
let startupData: StartupData | null = null;
let stopping = false;
const menuIDs: string[] = [];
const mainWindows = new Set<any>();
const navigators = new Map<any,ReturnType<typeof mountNavigator>>();
const navigatorTimers = new Map<any,ReturnType<typeof setTimeout>>();
let libraryCache:Promise<{papers:import('./core.ts').PaperRecord[];nativeTags:Record<string,import('./platform.ts').NativeTag[]>}>|null=null;
const itemTimers = new Map<number, { timer: ReturnType<typeof setTimeout>; attachment: boolean }>();

function logError(error: unknown) {
  try { Zotero.logError(error instanceof Error ? error : new Error(String(error))); }
  catch { /* Shutdown and error reporting must remain independent. */ }
}

function actionError(error: unknown) {
  logError(error);
  const message = error instanceof Error ? error.message : String(error);
  try { Services.prompt.alert(Zotero.getMainWindow(), 'Smart Tags', message); }
  catch { /* The main window may have closed during an action. */ }
}

function personal(item: any) {
  return !!item && item.isRegularItem?.() && !item.deleted && item.libraryID === Zotero.Libraries.userLibraryID;
}

function mainWindowList(): any[] {
  return typeof Zotero.getMainWindows === 'function' ? Zotero.getMainWindows() : [Zotero.getMainWindow()].filter(Boolean);
}

async function importVocabulary() {
  const path = await chooseJSONFile('open');
  if (!path) return null;
  const info = await IOUtils.stat(path);
  if (info.size > 10 * 1024 * 1024) throw new Error('Choose a vocabulary JSON file smaller than 10 MB.');
  let value: unknown;
  try { value = JSON.parse(await IOUtils.readUTF8(path)); }
  catch { throw new Error('The selected file is not valid vocabulary JSON.'); }
  return value;
}

async function exportVocabulary(value: unknown) {
  const path = await chooseJSONFile('save',(value as any)?.format==='zotero-smart-tags-proposal'?'smart-tags-proposal-with-evidence.json':'smart-tags-vocabulary.json');
  if (!path) return;
  await IOUtils.writeUTF8(path, JSON.stringify(value, null, 2) + '\n', { tmpPath: `${path}.tmp` });
}

async function analyzeScope(scope: 'selected' | 'collections') {
  await openManager();
  if (!controller) return;
  await controller.invoke('tag', { scope });
}

function registerMenus(data: StartupData) {
  const add = (menuID: string, target: string, menus: any[]) => {
    const registered = Zotero.MenuManager.registerMenu({ menuID, pluginID: data.id, target, menus });
    if (!registered) throw new Error(`Could not register Smart Tags menu: ${menuID}.`);
    menuIDs.push(registered);
  };
  add('smart-tags-tools', 'main/menubar/tools', [{
    menuType: 'menuitem', l10nID: 'smart-tags-open', icon: data.rootURI + 'content/icon.svg',
    onCommand: () => { void openManager().catch(actionError); },
  }]);
  add('smart-tags-items', 'main/library/item', [{
    menuType: 'menuitem', l10nID: 'smart-tags-analyze-selected',
    onShowing: (_event: unknown, context: any) => {
      const items = context.items || [];
      context.setVisible(items.length > 0 && items.some(personal));
      context.setEnabled(items.length > 0 && items.every(personal));
    },
    onCommand: () => { void analyzeScope('selected').catch(actionError); },
  }]);
  add('smart-tags-collections', 'main/library/collection', [{
    menuType: 'menuitem', l10nID: 'smart-tags-analyze-collections',
    onShowing: (_event: unknown, context: any) => {
      // Zotero 10 supports multiple collection rows. Singular getters now throw.
      const rows = context.collectionTreeRows || [];
      const collections = rows.filter((row: any) => row.isCollection?.());
      const visible = collections.length > 0 && collections.length === rows.length
        && collections.every((row: any) => row.ref?.libraryID === Zotero.Libraries.userLibraryID);
      context.setVisible(visible);
      context.setEnabled(visible);
    },
    onCommand: () => { void analyzeScope('collections').catch(actionError); },
  }]);
}

function scheduleItem(itemID: number, attachment: boolean) {
  if (stopping || !controller || !host || host.mutating.has(itemID)) return;
  const prior = itemTimers.get(itemID);
  if (prior) clearTimeout(prior.timer);
  const pending = {
    attachment: attachment || !!prior?.attachment,
    timer: setTimeout(() => {
      itemTimers.delete(itemID);
      const app = controller;
      if (!app || stopping || host?.mutating.has(itemID)) return;
      const operation = pending.attachment ? app.onAttachmentChanged(itemID) : app.onItemChanged(itemID);
      void operation.catch(logError);
    }, 2000),
  };
  itemTimers.set(itemID, pending);
}

async function notifyItems(event: string, type: string, ids: (number | string)[]) {
  libraryCache=null;
  if (stopping || !controller || !host) return;
  if (!['add', 'modify', 'remove', 'delete', 'trash', 'refresh'].includes(event)) return;
  const itemIDs = new Set<number>();
  for (const id of ids) {
    const value = Number(type === 'item-tag' ? String(id).split('-')[0] : id);
    if (Number.isSafeInteger(value) && value > 0) itemIDs.add(value);
  }
  for (const id of itemIDs) {
    if (host.mutating.has(id)) continue;
    const item = await Zotero.Items.getAsync(id).catch(() => null);
    if (!item) continue;
    if (personal(item)) scheduleItem(id, false);
    else if (type === 'item' && item.isAttachment?.() && item.parentID) {
      const parent = await Zotero.Items.getAsync(item.parentID).catch(() => null);
      if (personal(parent) && !host.mutating.has(parent.id)) scheduleItem(parent.id, true);
    }
  }
}

export async function startup(data: StartupData) {
  if (controller) return;
  stopping = false;
  startupData = data;
  if (Zotero.initializationPromise) await Zotero.initializationPromise;
  const profilePath = Services.dirsvc.get('ProfD', Ci.nsIFile).path;
  const directory = PathUtils.join(profilePath, 'smart-tags');
  await IOUtils.makeDirectory(directory, { ignoreExisting: true, createAncestors: true });
  let legacyBaseline: import('./core.ts').TagDefinition[] | undefined;
  const baselinePath=PathUtils.join(directory,'state.json.pre-v3.json');
  if(await IOUtils.exists(baselinePath)) {
    try {
      const baseline=JSON.parse(await IOUtils.readUTF8(baselinePath));
      if(validLegacyState(baseline)&&Array.isArray(baseline.tags))legacyBaseline=baseline.tags.filter((tag:import('./core.ts').TagDefinition)=>normalizeTagDefinitions([tag]).length===1);
    } catch { /* Without a readable baseline, legacy definitions are preserved. */ }
  }
  store = new AtomicStore<AppState>({
    read: path => IOUtils.readUTF8(path),
    exists: path => IOUtils.exists(path),
    writeAtomic: (path, text) => IOUtils.writeUTF8(path, text, { tmpPath: `${path}.tmp` }),
    readBytes:path=>IOUtils.read(path),
    copyExact:async(source,destination)=>{await IOUtils.copy(source,destination,{noOverwrite:true});},
  }, PathUtils.join(directory, 'state.json'), initialState, validState, value=>migrateState(value,{legacyBaseline}), validLegacyState);
  const loaded = await store.load();
  if (store.recovered) loaded.warnings=upsertWarning(loaded.warnings,{code:'state-recovery',message:'Smart Tags restored its previous valid state from the local backup.',context:'startup',conditionFingerprint:'state-backup-recovery'});
  credentials = new SecureCredentials();
  host = new ZoteroHost();
  const secure = credentials;
  const stateStore = store;
  const ai = new ProviderClient({
    fetch: globalThis.fetch.bind(globalThis), crypto: globalThis.crypto,
    credentials: { load: key => secure.load(key), save: (key, value) => secure.save(key, value), remove: key => secure.remove(key) },
    metadata: {
      get: async key => (controller?.state || loaded).metadata[key] || null,
      set: async (key, value) => {
        const state = controller?.state || loaded;
        state.metadata[key] = value;
        if (controller) await controller.save(); else await stateStore.save(state);
      },
    },
    registerCallback: registerOAuthCallback,
    openExternal: url => { Zotero.launchURL(url); },
  });
  aiClient = ai;
  controller = new AppController(loaded, {
    host, ai, persist: state => stateStore.save(state), importFile: importVocabulary, exportFile: exportVocabulary,
    credentialStatus: () => secure.sessionOnly ? 'Session only · OS credential encryption unavailable' : 'Encrypted with the operating-system keystore',
    librarySnapshot:()=>libraryCache??=(async()=>{const papers=await host!.list('library');const nativeTags:Record<string,import('./platform.ts').NativeTag[]>={};for(const paper of papers)nativeTags[paper.id]=await host!.readTags(paper.itemID);return {papers,nativeTags};})(),
  });
  try {
    await controller.initialize();
    Zotero.ftl.addResourceIds([LOCALE]);
    for (const win of mainWindowList()) onMainWindowLoad(win);
    registerMenus(data);
    notifierID = Zotero.Notifier.registerObserver({ notify: notifyItems }, ['item', 'item-tag'], 'smart-tags', 50);
    Zotero.SmartTags = { openManager, controller, getNavigator:(win:any)=>navigators.get(win), version: data.version, stateDirectory: directory };
  } catch (error) {
    await shutdown().catch(logError);
    throw error;
  }
}

export async function openManager(options:ManagerUIOptions={}): Promise<Window | null> {
  if (!controller || stopping) throw new Error('Smart Tags is not ready yet.');
  if (managerWindow && !managerWindow.closed) { managerUI?.navigate?.(options);managerWindow.focus(); return managerWindow; }
  const main = Zotero.getMainWindow();
  if (!main) throw new Error('Open Zotero’s library window before opening Smart Tags.');
  let initialWindow: Window | null = null;
  let finalWindow: Window | null = null;
  let mounted = false;
  let readinessStopped = false;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  const diagnostic = (message: string) => {
    try { Zotero.debug?.(`[Smart Tags] Manager ${message}`, 3); } catch { /* Diagnostics must never prevent opening. */ }
  };
  const cleanupReadiness = () => {
    readinessStopped = true;
    if (readyTimer !== null) { clearTimeout(readyTimer); readyTimer = null; }
    try {
      initialWindow?.removeEventListener('DOMContentLoaded', attachFromEvent);
      initialWindow?.removeEventListener('load', attachFromEvent);
    } catch { /* The initial about:blank Window may already be gone. */ }
    if (managerReadinessCleanup === cleanupReadiness) managerReadinessCleanup = null;
  };
  const showFailure = (error: unknown) => {
    logError(error);
    diagnostic(`failed: ${error instanceof Error ? error.message : String(error)}`);
    try {
      const doc = (finalWindow || initialWindow)?.document;
      if (!doc) return;
      const app = doc.getElementById('app');
      if (!app) return;
      app.setAttribute('data-smart-tags-state', 'error');
      app.textContent = '';
      const box = doc.createElementNS(HTML, 'div');
      box.setAttribute('style', 'padding:35px;font:14px/1.5 system-ui,sans-serif;max-width:760px;');
      const title = doc.createElementNS(HTML, 'h2');
      title.textContent = 'Smart Tags could not finish opening';
      const details = doc.createElementNS(HTML, 'p');
      details.textContent = `${error instanceof Error ? error.message : String(error)} Close this window and reopen Smart Tags from Zotero’s Tools menu. If it continues, inspect Tools → Developer → Error Console.`;
      box.append(title, details);
      app.append(box);
    } catch (renderError) { logError(renderError); }
  };
  const attach = (candidate?: Window | null) => {
    if (mounted || readinessStopped) return;
    if (!controller || stopping) { cleanupReadiness(); return; }
    const target = candidate || finalWindow || initialWindow;
    if (!target) return;
    let foundApp = false;
    try {
      if (target.closed) { cleanupReadiness(); return; }
      const doc = target.document;
      const app = doc?.getElementById('app');
      if (attempts < 3 || attempts % 20 === 0) diagnostic(`readyState=${doc?.readyState || 'unavailable'}, uri=${doc?.documentURI || 'unavailable'}, app=${!!app}, attempt=${attempts}`);
      if (!app) return;
      foundApp = true;
      finalWindow = target;
      managerWindow = target;
      mounted = true;
      cleanupReadiness();
      app.setAttribute('data-smart-tags-state', 'mounting');
      diagnostic('mount begin');
      managerUI = mountManager(target, controller,options);
      diagnostic('mount attached; awaiting local snapshot');
    } catch (error) {
      if (!foundApp && !finalWindow) { diagnostic('initial window unavailable; waiting for final document loader'); return; }
      mounted = true; cleanupReadiness(); showFailure(error);
    }
  };
  const attachFromEvent = () => attach();
  const poll = () => {
    readyTimer = null;
    attempts++;
    attach();
    if (mounted || stopping || readinessStopped) return;
    if (attempts >= 200) { cleanupReadiness(); showFailure(new Error('The manager document did not become ready within 20 seconds.')); return; }
    readyTimer = setTimeout(poll, 100);
  };
  managerReadinessCleanup?.();
  managerReadinessCleanup = cleanupReadiness;
  // The loader runs inside the final XHTML document. about:blank listeners/timers
  // belong to an initial Window and can disappear during native navigation.
  const bridge = {
    onReady(child: Window) {
      diagnostic('final document loader ready');
      finalWindow = child;
      attach(child);
    },
    onClosed(child: Window) {
      if (finalWindow !== child) return;
      cleanupReadiness();
      if (managerWindow === child) {
        managerUI?.destroy(); managerUI = null; managerWindow = null;
      }
    },
    onFailure(error: unknown) { showFailure(error); },
  };
  initialWindow = main.openDialog(MANAGER_URL, 'zotero-smart-tags-manager', 'chrome,dialog=no,resizable,centerscreen,width=1180,height=820', bridge) as Window;
  if (!initialWindow) { cleanupReadiness(); throw new Error('Zotero could not open the Smart Tags manager.'); }
  managerWindow = finalWindow || initialWindow;
  if (!mounted) {
    initialWindow.addEventListener('DOMContentLoaded', attachFromEvent);
    initialWindow.addEventListener('load', attachFromEvent);
  }
  // Never attach an unload listener to the initial about:blank Window.
  attach();
  if (!mounted) readyTimer = setTimeout(poll, 100);
  managerWindow.focus();
  return managerWindow;
}

export function onMainWindowLoad(win: any) {
  if (!win || mainWindows.has(win) || stopping) return;
  mainWindows.add(win);
  try {
    if (win.MozXULElement?.insertFTLIfNeeded) win.MozXULElement.insertFTLIfNeeded(LOCALE);
    else if (win.document?.l10n) win.document.l10n.addResourceIds([LOCALE]);
  } catch (error) { logError(error); }
  const mount=(attempt=0)=>{
    navigatorTimers.delete(win);if(!controller||stopping||!mainWindows.has(win)||win.closed)return;
    if(win.document?.getElementById?.('zotero-collections-pane')&&(!win.ZoteroPane?.itemsView||!win.ZoteroPane?.collectionsView)&&attempt<200){navigatorTimers.set(win,setTimeout(()=>mount(attempt+1),100));return;}
    try {navigators.set(win,mountNavigator(win,controller,{
    openManager:()=>{void openManager({page:'library'}).catch(actionError);},
    onCreateDetail:contextId=>{void openManager({page:'vocabulary',createDetail:true,detailContextId:contextId}).catch(actionError);},
    onEditTag:tagId=>{void openManager({page:'vocabulary',tagId}).catch(actionError);},
    }));}catch(error){logError(error);}
  };mount();
}

export function onMainWindowUnload(win: any) {
  if (!win) return;
  mainWindows.delete(win);
  if(navigatorTimers.has(win)){clearTimeout(navigatorTimers.get(win)!);navigatorTimers.delete(win);}
  const navigator=navigators.get(win);navigators.delete(win);if(navigator)void navigator.destroy().catch(logError);
  try {
    for (const link of win.document?.querySelectorAll(`link[rel="localization"][href="${LOCALE}"]`) || []) link.remove();
    win.document?.l10n?.removeResourceIds([LOCALE]);
  } catch { /* A closing document can no longer accept localization changes. */ }
}

export async function shutdown() {
  stopping = true;
  for(const timer of navigatorTimers.values())clearTimeout(timer);navigatorTimers.clear();
  for (const { timer } of itemTimers.values()) clearTimeout(timer);
  itemTimers.clear();
  if (notifierID !== null) { try { Zotero.Notifier.unregisterObserver(notifierID); } catch (error) { logError(error); } notifierID = null; }
  managerReadinessCleanup?.(); managerReadinessCleanup = null;
  managerUI?.destroy(); managerUI = null;
  if (managerWindow && !managerWindow.closed) managerWindow.close();
  managerWindow = null;
  await Promise.allSettled([...navigators.values()].map(navigator=>navigator.destroy()));navigators.clear();libraryCache=null;
  for (const id of menuIDs.splice(0)) { try { Zotero.MenuManager.unregisterMenu(id); } catch (error) { logError(error); } }
  for (const win of [...mainWindows]) onMainWindowUnload(win);
  try { Zotero.ftl.removeResourceIds([LOCALE]); } catch (error) { logError(error); }
  const app = controller;
  // Abort OAuth, refreshes, and requests before waiting for queued controller work.
  await aiClient?.dispose();
  aiClient = null;
  try { if (app) await app.shutdown(); if (store) await store.flush(); }
  finally {
    credentials?.clearMemory();
    if (Zotero.SmartTags?.controller === app) delete Zotero.SmartTags;
    controller = null; host = null; credentials = null; store = null; startupData = null;
  }
}
