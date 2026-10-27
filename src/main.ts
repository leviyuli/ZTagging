import { AppController, initialState, validState } from './controller.ts';
import type { AppState } from './controller.ts';
import { ZoteroHost, SecureCredentials, registerOAuthCallback, chooseJSONFile } from './platform.ts';
import { ProviderClient } from './providers.ts';
import { AtomicStore } from './store.ts';
import { mountManager } from './ui.ts';

type StartupData = { id: string; version: string; rootURI: string };
type SectionProps = {
  body: HTMLElement;
  doc?: Document;
  item?: any;
  refresh?: () => Promise<void>;
  setEnabled?: (enabled: boolean) => void;
  setSectionSummary?: (summary: string) => void;
};

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
let sectionID: string | null = null;
let startupData: StartupData | null = null;
let unsubscribe: (() => void) | null = null;
let stopping = false;
const menuIDs: string[] = [];
const mainWindows = new Set<any>();
const sectionRefreshers = new Map<HTMLElement, () => Promise<void>>();
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

function refreshSections() {
  for (const [body, refresh] of sectionRefreshers) {
    if (!body.isConnected) { sectionRefreshers.delete(body); continue; }
    void Promise.resolve().then(refresh).catch(logError);
  }
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
  const path = await chooseJSONFile('save');
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

function renderSection(props: SectionProps) {
  const { body, item } = props;
  const app = controller;
  const doc = body.ownerDocument;
  const element = <K extends keyof HTMLElementTagNameMap>(name: K, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElementNS(HTML, name) as HTMLElementTagNameMap[K];
    if (text !== undefined) node.textContent = text;
    return node;
  };
  body.replaceChildren();
  body.style.cssText = 'display:block;padding:10px 12px;font:12px/1.5 system-ui,sans-serif;';
  if (!app || !personal(item)) {
    props.setEnabled?.(false);
    return;
  }
  const paperId = `${item.libraryID}:${item.key}`;
  const suggestions = app.state.suggestions.filter(suggestion => suggestion.paperId === paperId && suggestion.status !== 'rejected');
  const pending = suggestions.filter(suggestion => !suggestion.applied);
  props.setSectionSummary?.(`${pending.length} suggestions`);
  const managerButton = element('button', 'Open Smart Tags');
  managerButton.type = 'button';
  managerButton.style.cssText = 'margin:2px 0 12px;padding:5px 9px;cursor:pointer;';
  managerButton.addEventListener('click', () => { void openManager().catch(actionError); });
  body.append(managerButton);
  if (!suggestions.length) {
    const help = element('p', 'Analyze this paper against your approved vocabulary to see evidence-backed tag suggestions.');
    help.style.cssText = 'margin:0;color:var(--fill-secondary,#6b7280);';
    body.append(help);
    return;
  }
  for (const suggestion of suggestions.slice(0, 8)) {
    const tag = app.state.tags.find(definition => definition.id === suggestion.tagId);
    const section = element('div');
    section.style.cssText = 'padding:10px 0;border-top:1px solid var(--material-border,#d7dce3);';
    const name = element('strong', `${suggestion.operation === 'remove' ? 'Remove: ' : ''}${tag?.name || suggestion.tagId}`);
    section.append(name, element('span', ` · ${suggestion.applied ? 'applied' : suggestion.status === 'accepted' ? 'accepted' : suggestion.confidence + ' confidence'}`));
    const reason = element('p', suggestion.reason);
    reason.style.cssText = 'margin:5px 0;';
    section.append(reason);
    for (const evidence of suggestion.evidence.slice(0, 2)) {
      const quote = element('blockquote', evidence.text);
      quote.style.cssText = 'margin:6px 0;padding:5px 8px;border-left:2px solid #8ea3c4;color:var(--fill-secondary,#6b7280);overflow-wrap:anywhere;';
      quote.title = `Evidence: ${evidence.source}`;
      section.append(quote);
    }
    if (!suggestion.applied) {
      const actions = element('div');
      actions.style.cssText = 'display:flex;gap:7px;margin-top:7px;';
      for (const [label, action] of [['Accept', 'accept-suggestion'], ['Reject', 'reject-suggestion']]) {
        if (label === 'Accept' && suggestion.status === 'accepted') continue;
        const button = element('button', label);
        button.type = 'button';
        button.style.cssText = 'padding:3px 8px;cursor:pointer;';
        button.addEventListener('click', () => {
          button.disabled = true;
          void app.invoke(action, { id: suggestion.id }).catch(actionError).finally(() => { if (button.isConnected) button.disabled = false; });
        });
        actions.append(button);
      }
      section.append(actions);
    }
    body.append(section);
  }
  if (suggestions.length > 8) body.append(element('p', `Open Smart Tags to see all ${suggestions.length} suggestions and apply reviewed changes.`));
  else if (pending.some(suggestion => suggestion.status === 'accepted')) body.append(element('p', 'Apply accepted changes from Review in Smart Tags.'));
}

function registerSection(data: StartupData) {
  const registered = Zotero.ItemPaneManager.registerSection({
    paneID: 'smart-tags-suggestions', pluginID: data.id,
    header: { l10nID: 'smart-tags-section', icon: data.rootURI + 'content/icon.svg' },
    sidenav: { l10nID: 'smart-tags-section', icon: data.rootURI + 'content/icon.svg' },
    onInit: (props: SectionProps) => { if (props.refresh) sectionRefreshers.set(props.body, props.refresh); },
    onDestroy: (props: SectionProps) => { sectionRefreshers.delete(props.body); },
    onItemChange: (props: SectionProps) => { props.setEnabled?.(personal(props.item)); },
    onRender: renderSection,
  });
  if (!registered) throw new Error('Could not register the Smart Tags item-pane section.');
  sectionID = registered;
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
  store = new AtomicStore<AppState>({
    read: path => IOUtils.readUTF8(path),
    exists: path => IOUtils.exists(path),
    writeAtomic: (path, text) => IOUtils.writeUTF8(path, text, { tmpPath: `${path}.tmp` }),
  }, PathUtils.join(directory, 'state.json'), initialState, validState);
  const loaded = await store.load();
  if (store.recovered) loaded.warnings.push('Smart Tags restored its previous valid state from the local backup.');
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
  });
  try {
    await controller.initialize();
    Zotero.ftl.addResourceIds([LOCALE]);
    for (const win of mainWindowList()) onMainWindowLoad(win);
    registerMenus(data);
    registerSection(data);
    unsubscribe = controller.subscribe(refreshSections);
    notifierID = Zotero.Notifier.registerObserver({ notify: notifyItems }, ['item', 'item-tag'], 'smart-tags', 50);
    Zotero.SmartTags = { openManager, controller, version: data.version, stateDirectory: directory };
  } catch (error) {
    await shutdown().catch(logError);
    throw error;
  }
}

export async function openManager(): Promise<Window | null> {
  if (!controller || stopping) throw new Error('Smart Tags is not ready yet.');
  if (managerWindow && !managerWindow.closed) { managerWindow.focus(); return managerWindow; }
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
      managerUI = mountManager(target, controller);
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
}

export function onMainWindowUnload(win: any) {
  if (!win) return;
  mainWindows.delete(win);
  for (const body of sectionRefreshers.keys()) if (body.ownerDocument.defaultView === win) sectionRefreshers.delete(body);
  try {
    for (const link of win.document?.querySelectorAll(`link[rel="localization"][href="${LOCALE}"]`) || []) link.remove();
    win.document?.l10n?.removeResourceIds([LOCALE]);
  } catch { /* A closing document can no longer accept localization changes. */ }
}

export async function shutdown() {
  stopping = true;
  for (const { timer } of itemTimers.values()) clearTimeout(timer);
  itemTimers.clear();
  if (notifierID !== null) { try { Zotero.Notifier.unregisterObserver(notifierID); } catch (error) { logError(error); } notifierID = null; }
  unsubscribe?.(); unsubscribe = null;
  managerReadinessCleanup?.(); managerReadinessCleanup = null;
  managerUI?.destroy(); managerUI = null;
  if (managerWindow && !managerWindow.closed) managerWindow.close();
  managerWindow = null;
  if (sectionID) { try { Zotero.ItemPaneManager.unregisterSection(sectionID); } catch (error) { logError(error); } sectionID = null; }
  sectionRefreshers.clear();
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
