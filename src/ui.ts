import type {Workspace,ViewEvent,ViewQuery} from './workspace-contract.ts';
import type { BuildMode, DisplayAssignmentReview, DisplayPaper, DisplayReviewItem, DisplayRun, DisplaySuggestion, DisplayTag, ManagerPage, ManagerSettings, ManagerSnapshot, Scope } from './ui-contract';
import { createDropdown, cleanupDropdowns, updateDropdown } from './dropdown';
import type {DropdownOptions} from './dropdown';
import { descendantIds } from './concept-filter';
import type { ConceptFilter } from './concept-filter';
import type { WarningRecord } from './warnings';

type Child = Node | string | null | undefined | false;
type MenuAction = { id: string; label: string; run: () => void | Promise<unknown> };
type ModalState = { kind: 'apply'; ids: string[] } | { kind: 'finish'; ids: string[]; runId: string; acceptRemaining: boolean } | { kind: 'cleanup-history'; records: number; bytes: number } | { kind: 'search' | 'reset-analysis' } | null;
const facets = ['system', 'component', 'phenomenon', 'method'] as const;
const facetNames: Record<string, string> = { system: 'Systems', component: 'Components & materials', phenomenon: 'Phenomena', method: 'Methods' };
const pageTitles: Record<ManagerPage, [string, string]> = {
  overview: ['Your library, clearly tagged', 'Prepare a useful tag list, then review its paper suggestions.'],
  connection: ['Connect AI', 'Choose the connection and model used for your papers.'],
  build: ['Build tags', 'Learn a compact tag vocabulary from your papers.'],
  cleanup: ['Build tags', 'Learn a compact tag vocabulary from your papers.'],
  assignment: ['Assign tags', 'Add supported tags to your papers and handle remaining choices when convenient.'],
  vocabulary: ['Tag library', 'Search and correct the tags AI built from your papers.'],
  'existing-tags': ['Tag library', 'Search and correct AI-built tags.'],
  review: ['Review suggestions', 'Check the evidence, keep useful tags, and teach Smart Tags your preferences.'],
  library: ['Find papers', 'Search your papers or narrow the results by tag.'],
  activity: ['Runs', 'Follow your builds and assignments, retry interrupted work, and open results.'],
  settings: ['Settings', 'Manage your AI connection, tag defaults, and saved data.'],
};
const pageNames: Record<ManagerPage, string> = { overview: 'Overview', connection: 'Connect AI', build: 'Build tags', cleanup: 'Build tags', assignment: 'Assign tags', vocabulary: 'Tag library', 'existing-tags': 'Tag library', review: 'Paper suggestions', library: 'Find papers', activity: 'Runs', settings: 'Settings' };
const iconPaths = {
  overview: ['M3 10.5 12 3l9 7.5', 'M5 9v12h14V9', 'M9 21v-7h6v7'],
  connection: ['M8 3v5M16 3v5M6 8h12v4a6 6 0 0 1-12 0V8Z', 'M12 18v4'],
  build: ['M12 3 3 8l9 5 9-5-9-5Z', 'm3 12 9 5 9-5M3 16l9 5 9-5'],
  cleanup: ['M9 4H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-4', 'M9 2h6v5H9z', 'm8 13 3 3 5-5'],
  assignment: ['M3 6h15M14 2l4 4-4 4', 'M21 18H6M10 14l-4 4 4 4'],
  vocabulary: ['M20 13 13 20a2 2 0 0 1-3 0l-7-7V4h9l8 6a2 2 0 0 1 0 3Z', 'M7.5 8h.01'],
  'existing-tags': ['M4 4h16v16H4z', 'M8 8h8M8 12h8M8 16h5'],
  review: ['M9 4H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-4', 'M9 2h6v5H9z', 'm8 13 3 3 5-5'],
  library: ['M12 5v16', 'M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1Z'],
  activity: ['M21 12a9 9 0 1 1-3-6.7', 'M21 3v6h-6', 'M12 7v5l3 2'],
  settings: ['M4 4v16M12 4v16M20 4v16', 'M1 8h6M9 16h6M17 10h6'],
} as const;
export interface ManagerUIOptions { page?: ManagerPage; createDetail?: boolean; detailContextId?: string; tagId?: string; assignmentRunId?: string }

/** Mount a credential-free manager. All data access and writes go through the host. */
export function mountManager(win: Window, api: Workspace, options: ManagerUIOptions = {}): { refresh: () => Promise<void>; destroy: () => void; navigate: (options: ManagerUIOptions) => void } {
  const doc = win.document;
  const app = doc.getElementById('app');
  if (!app) throw new Error('Smart Tags manager is missing its app container.');
  let state: ManagerSnapshot | null = null;
  let page: ManagerPage = options.page === 'existing-tags' ? 'vocabulary' : options.page || 'overview';
  let pendingNavigation: ManagerUIOptions | null = options;
  let buildScope: Scope = 'pilot';
  let assignmentScope: Scope = 'library';
  let selectedLogicalRunId: string | undefined;
  let queuedRunReceipt: DisplayRun | undefined;
  let selectedSavedFilterId = '';
  let assignmentSelectionMode: 'all' | 'selected' = 'all';
  let assignmentTagQuery = '';
  let assignmentTagPage = 0;
  const selectedAssignmentTagIds = new Set<string>();
  const runDetailsOpen = new Set<string>();
  let runsPage = 0;
  let runNoticesOpen = false;
  let buildRunFilter:{runId:string;savedCount:number}|null=null;
  let reviewDetailsOpen = false;
  let buildMode: BuildMode = 'extend';
  let buildAdvancedOpen = false;
  let initialTagTarget: number | null = null;
  let additionalTagTarget: number | null = null;
  let topicAdditionalTarget: number | null = null;
  let workflowInitialized = false;
  let assignmentView: 'setup' | 'suggestions' = 'setup';
  let assignmentViewInitialized = false;
  let incomingSettingsOpen = false;
  let dataDetailsOpen = false;
  let activityHistoryOpen = false;
  let activityPaperInfoOpen = false;
  let activityHistoryQuery = '';
  let activityHistoryPage = 0;
  let deferredReviewOpen = false;
  let busy = false;
  let signingIn = false;
  let disposed = false;
  let viewEpoch = 0;
  let viewRevision = -1;
  let viewQueryKey = '';
  let viewSearchKey = '';
  let viewController: AbortController | null = null;
  let stopView: (() => void) | null = null;
  let searchTimer = 0;
  let viewTotal: number | undefined;
  let viewNextCursor: string | undefined;
  let viewOffset=0,viewRowCount=0;
  const viewCursors=new Map<string,Map<number,string>>(),queryPageIndexes=new WeakMap<ViewQuery,number>();
  let commandSequence = 0;
  const commandPrefix = `manager-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let toast = '';
  let toastError = false;
  let toastTimer = 0;
  let loadingMessage='';
  let loadingProgress:ViewEvent['progress'];
  let closeActionMenu: ((restoreFocus?: boolean) => void) | null = null;
  let vocabQuery = '';
  let vocabularyPage = 0;
  let reviewFilter = 'pending';
  let reviewPage = 0;
  let assignmentRunSelection: string | null = null;
  const selectedTopicIds = new Set<string>();
  let topicPage = 0;
  let libraryPage = 0;
  let warningHistoryPage = 0;
  let attentionFilter = 'attention';
  let attentionQuery = '';
  let attentionPage = 0;
  let paperExclusionPage = 0;
  const selectedAttentionPapers = new Set<string>();
  let metadataIdentifier = '';
  let modalPage = 0;
  let paperQuery = '';
  let libraryFiltersOpen = false;
  let selectedPaper = '';
  let editorTag: DisplayTag | null = null;
  let editorPreparationId = '';
  const tagScrollPositions = new Map<string, number>();
  const editorScrollPositions = new Map<string, number>();
  const editorDrafts = new Map<string, DisplayTag>();
  let editorAdvancedOpen = false;
  let editorReturnFocus = '';
  let pendingEditorFocus = '';
  const relationQueries = new Map<string, string>();
  const openRelationshipPickers = new Set<string>();
  const expandedConcepts = new Set<string>();
  let conceptQuery = '';
  let settingsDraft: ManagerSettings | null = null;
  let settingsDirty = false;
  let settingsTagsOpen = false;
  let settingsIntegrationOpen = false;
  let settingsTransfersOpen = false;
  let settingsValidation: { key: keyof ManagerSettings; message: string } | null = null;
  let customModelInput: boolean | null = null;
  const apiKeyDrafts: Record<'api' | 'deepseek', string> = { api: '', deepseek: '' };
  let searchName = '';
  let modal: ModalState = null;
  const selectedSuggestions = new Set<string>();
  let conceptFilter: ConceptFilter = { mode: 'all', selections: [] };
  let paperMap = new Map<string, DisplayPaper>();
  let tagMap = new Map<string, DisplayTag>();
  let suggestionMap = new Map<string, DisplaySuggestion>();
  const searchCache = new Map<string, { title: string; abstract?: string; summary?: string; keywords?: string[]; text: string }>();
  const PAGE_SIZE = 50;

  type ListenerBinding={type:string;listener:EventListener;options?:boolean|AddEventListenerOptions};
  const nodeListeners=new WeakMap<EventTarget,ListenerBinding[]>();
  const dropdownOptions=new WeakMap<HTMLButtonElement,DropdownOptions>();
  function listen<K extends keyof HTMLElementEventMap>(target:HTMLElement,type:K,handler:(event:HTMLElementEventMap[K])=>void,options?:boolean|AddEventListenerOptions) {
    const listener:EventListener=event=>handler(event as HTMLElementEventMap[K]);
    target.addEventListener(type,listener,options);
    const bindings=nodeListeners.get(target)||[];bindings.push({type,listener,options});nodeListeners.set(target,bindings);
  }
  function nodeChildren(node:Node):Node[] {return Array.from(node.childNodes);}
  function nodeKey(node:Node):string {
    if(node.nodeType!==1)return '';
    const element=node as HTMLElement;return element.id?`id:${element.id}`:element.getAttribute('data-ui-key')||'';
  }
  function sameNodeKind(left:Node,right:Node):boolean {return left.nodeType===right.nodeType&&(left.nodeType!==1||(left as Element).localName===(right as Element).localName);}
  function attributePairs(element:Element):[string,string][] {return Array.from(element.attributes).map(attribute=>Array.isArray(attribute)?[String(attribute[0]),String(attribute[1])]:[attribute.name,attribute.value]);}
  function patchNode(current:Node,desired:Node,keys:Map<string,Node>):Node {
    if(!sameNodeKind(current,desired))return desired;
    if(current.nodeType===3){if(current.textContent!==desired.textContent)current.textContent=desired.textContent;return current;}
    if(current.nodeType!==1)return current;
    const before=current as HTMLElement,after=desired as HTMLElement;
    const dropdown=dropdownOptions.get(after as HTMLButtonElement);
    if(dropdown&&updateDropdown(before as HTMLButtonElement,dropdown))return before;
    const oldBindings=nodeListeners.get(before)||[],newBindings=nodeListeners.get(after)||[];
    for(const binding of oldBindings)before.removeEventListener(binding.type,binding.listener,binding.options);
    for(const binding of newBindings)before.addEventListener(binding.type,binding.listener,binding.options);
    nodeListeners.set(before,newBindings);
    const attributes=new Map(attributePairs(after));
    for(const [name] of attributePairs(before))if(!attributes.has(name))before.removeAttribute(name);
    for(const [name,value] of attributes)if(before.getAttribute(name)!==value){if(name==='aria-expanded'&&before.getAttribute(name)==='true'&&doc.getElementById(before.getAttribute('aria-controls')||''))continue;before.setAttribute(name,value);}
    if(typeof before.className==='string'&&typeof after.className==='string'&&before.className!==after.className)before.className=after.className;
    before.style.cssText=after.style.cssText;
    for(const name of ['disabled','checked','value','type','open','tabIndex','hidden','title','placeholder','noValidate','htmlFor'] as const){
      if(name in before&&name in after){const old=Reflect.get(before,name),next=Reflect.get(after,name);if(old!==next)Reflect.set(before,name,next);}
    }
    patchChildren(before,after,keys);return before;
  }
  function patchChildren(parent:Node,desired:Node,keys:Map<string,Node>) {
    const old=nodeChildren(parent),used=new Set<Node>();
    nodeChildren(desired).forEach((next,index)=>{
      const key=nodeKey(next),candidate=key?keys.get(key):old[index];
      const current=candidate&&!used.has(candidate)&&sameNodeKind(candidate,next)&&(key||!nodeKey(candidate))?candidate:undefined;
      const target=current?patchNode(current,next,keys):next;used.add(target);
      const reference=parent.childNodes[index]||null;if(reference!==target)parent.insertBefore(target,reference);
    });
    for(const child of nodeChildren(parent))if(!used.has(child))child.parentNode?.removeChild(child);
  }
  function patchRoot(desired:HTMLElement) {
    const keys=new Map<string,Node>(),duplicates=new Set<string>();
    const collect=(node:Node)=>{const key=nodeKey(node);if(key){if(keys.has(key)){keys.delete(key);duplicates.add(key);}else if(!duplicates.has(key))keys.set(key,node);}for(const child of nodeChildren(node))collect(child);};collect(app!);
    const container=doc.createElementNS('http://www.w3.org/1999/xhtml','div');container.append(desired);patchChildren(app!,container,keys);
  }
  function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: Child[]): HTMLElementTagNameMap[K] {
    // A chrome XHTML window is an XMLDocument; explicit HTML namespace is required.
    const element = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
    if (className) element.className = className;
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      element.append(typeof child === 'string' ? doc.createTextNode(child) : child);
    }
    return element;
  }
  function keyed<T extends HTMLElement>(element:T,key:string):T {element.setAttribute('data-ui-key',key);return element;}
  function icon(name: ManagerPage): SVGSVGElement {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(namespace, 'svg');
    for (const [key, value] of Object.entries({ class: 'ui-icon', viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
    for (const path of iconPaths[name]) {
      const element = doc.createElementNS(namespace, 'path');
      element.setAttribute('d', path);
      svg.append(element);
    }
    return svg;
  }
  function badge(text: string, type = '') { return h('span', `pill ${type}`, text); }
  function button(text: string, action: () => void | Promise<unknown>, kind = '', disabled = false): HTMLButtonElement {
    const element = h('button', kind, text);
    element.type = 'button';
    element.disabled = disabled || busy;
    listen(element,'click', () => { Promise.resolve().then(action).catch(showError); });
    return element;
  }
  function actionMenu(id: string, label: string, accessibleName: string, commands: MenuAction[]) {
    if (!commands.length) return null;
    let popup: HTMLDivElement | null = null;
    let items: HTMLButtonElement[] = [];
    let active = 0;
    const trigger = button(label, () => { if (doc.getElementById(`${id}-menu`)) closeActionMenu?.();else open(0); }, 'quiet small attention-menu-trigger');
    trigger.id = id;
    trigger.setAttribute('aria-label', accessibleName);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${id}-menu`);
    const contains = (node: Node, target: EventTarget | null) => !!target && typeof (target as Node).nodeType === 'number' && node.contains(target as Node);
    const mountedTrigger=()=>doc.getElementById(id) as HTMLButtonElement||trigger;
    function close(restoreFocus = true) {
      if (!popup) return;
      popup.remove();popup = null;items = [];
      mountedTrigger().setAttribute('aria-expanded', 'false');
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('focusin', outside);
      doc.removeEventListener('scroll', scrolled, true);
      win.removeEventListener('resize', viewportChanged);
      win.removeEventListener('unload', viewportChanged);
      if (closeActionMenu === close) closeActionMenu = null;
      if (restoreFocus && mountedTrigger().isConnected && !mountedTrigger().disabled) mountedTrigger().focus({ preventScroll: true });
    }
    function outside(event: Event) { if (!contains(mountedTrigger(), event.target) && (!popup || !contains(popup, event.target))) close(false); }
    function scrolled(event: Event) { if (!popup || !contains(popup, event.target)) close(false); }
    function viewportChanged() { close(false); }
    function focusItem(index: number) {
      active = (index + items.length) % items.length;
      const item = items[active];
      item?.focus({ preventScroll: true });
      if (!popup || !item) return;
      const top = item.offsetTop, bottom = top + item.offsetHeight;
      if (top < popup.scrollTop) popup.scrollTop = top;
      else if (bottom > popup.scrollTop + popup.clientHeight) popup.scrollTop = bottom - popup.clientHeight;
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();event.stopPropagation();if (event.repeat) return;
        if (!popup) open(0);
        else { const index = items.indexOf(event.target as HTMLButtonElement), command = commands[index < 0 ? active : index];close();Promise.resolve().then(command.run).catch(showError); }
        return;
      }
      if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();close();return; }
      if (event.key === 'Tab') { close();return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();event.stopPropagation();
        if (!popup) open(event.key === 'ArrowUp' || event.key === 'End' ? commands.length - 1 : 0);
        else focusItem(event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : active + (event.key === 'ArrowDown' ? 1 : -1));
      }
    }
    function open(index: number) {
      if (mountedTrigger().disabled || !mountedTrigger().isConnected || !doc.body) return;
      closeActionMenu?.();cleanupDropdowns(doc);
      popup = h('div', 'smart-tags-action-menu');popup.id = `${id}-menu`;
      popup.setAttribute('role', 'menu');popup.setAttribute('aria-labelledby', id);
      items = commands.map(command => {
        const item = button(command.label, () => { close();return command.run(); }, 'smart-tags-action-item');
        item.id = `${id}-item-${command.id}`;item.tabIndex = -1;item.setAttribute('role', 'menuitem');listen(item,'keydown', keydown);popup!.append(item);return item;
      });
      doc.body.append(popup);
      const rect = mountedTrigger().getBoundingClientRect(), edge = 8;
      const width = Math.min(280, Math.max(1, win.innerWidth - edge * 2));
      const height = Math.min(popup.scrollHeight + 2, 320, Math.max(1, win.innerHeight - edge * 2));
      popup.style.width = `${width}px`;popup.style.maxHeight = `${height}px`;
      popup.style.left = `${Math.max(edge, Math.min(rect.right - width, win.innerWidth - width - edge))}px`;
      popup.style.top = `${Math.max(edge, Math.min(rect.bottom + 4 + height <= win.innerHeight - edge ? rect.bottom + 4 : rect.top - height - 4, win.innerHeight - height - edge))}px`;
      mountedTrigger().setAttribute('aria-expanded', 'true');closeActionMenu = close;
      doc.addEventListener('pointerdown', outside, true);doc.addEventListener('focusin', outside);doc.addEventListener('scroll', scrolled, true);
      win.addEventListener('resize', viewportChanged);win.addEventListener('unload', viewportChanged);focusItem(index);
    }
    listen(trigger,'keydown', keydown);
    return trigger;
  }
  function hideEditor() { rememberEditorDraft();editorTag = null;editorPreparationId = ''; }
  function closeEditor() { hideEditor();pendingEditorFocus = editorReturnFocus;render(); }
  function rememberEditorOrigin(fallback: string) {
    const active = doc.activeElement as HTMLElement | null;
    editorReturnFocus = active?.id && !doc.getElementById('tag-editor-form')?.contains(active) ? active.id : fallback;
  }
  function nav(target:ManagerPage){hideEditor();page=target==='existing-tags'?'vocabulary':target;if(target==='review')assignmentView='suggestions';modal=null;win.scrollTo(0,0);render();}
  function empty(title: string, message: string, action?: Node) {
    return h('div', 'empty', h('strong', '', title), h('p', '', message), action ? h('div', 'actions', action) : null);
  }
  function field(label: string, input: HTMLElement, note?: string) {
    const labelElement = h('label', '', label);
    if (input.id) labelElement.htmlFor = input.id;
    return h('div', 'field', labelElement, input, note ? h('small', '', note) : null);
  }
  function input(id: string, value: string, onInput: (value: string) => void, placeholder = '', type = 'text') {
    const element = h('input');
    element.id = id;
    element.type = type;
    if(type==='search')element.maxLength=512;
    element.value = value;
    element.placeholder = placeholder;
    listen(element,'input', event => { onInput((event.currentTarget as HTMLInputElement).value);updateTagApplyState(); });
    return element;
  }
  function textarea(id: string, value: string, onInput: (value: string) => void, placeholder = '') {
    const element = h('textarea');
    element.id = id;
    element.value = value;
    element.placeholder = placeholder;
    listen(element,'input', event => { onInput((event.currentTarget as HTMLTextAreaElement).value);updateTagApplyState(); });
    return element;
  }
  function select<T extends string>(id: string, value: T, choices: [T, string][], onChange: (value: T) => void, accessibleName?: string, disabled=false) {
    const options:DropdownOptions={ id, value, choices, onChange: next => { onChange(next as T);updateTagApplyState(); }, disabled: busy||disabled };
    const control = createDropdown(win,options);dropdownOptions.set(control,options);
    if (accessibleName) control.setAttribute('aria-label', accessibleName);
    return control;
  }
  function checkbox(id: string, checked: boolean, label: string, onChange: (value: boolean) => void, disabled = false) {
    const element = h('input');
    element.id = id;
    element.type = 'checkbox';
    element.checked = checked;
    element.disabled = disabled || busy;
    listen(element,'change', event => onChange((event.currentTarget as HTMLInputElement).checked));
    const labelElement = h('label', 'check-label', element, h('span', '', label));
    labelElement.htmlFor = id;
    return labelElement;
  }
  function card(title: string, description: string, body: Node, footer?: Node, className = '') {
    return h('section', `card ${className}`.trim(), h('div', 'card-header', h('div', '', h('h2', '', title), description ? h('p', 'card-description', description) : null)), h('div', 'card-body', body), footer ? h('div', 'card-footer', footer) : null);
  }
  function details(label: string, open: boolean, changed: (open: boolean) => void, content: () => Node) {
    const summary = h('summary', '', label);summary.id = `details-${label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const panel = h('details', 'section-gap', summary);panel.open = open;
    if (open) panel.append(content());
    listen(summary,'click', event => { event.preventDefault();changed(!open);render(); });
    listen(panel,'toggle', event => { const current=event.currentTarget as HTMLDetailsElement;if (current.isConnected && current.open !== open) { changed(current.open);render(); } });
    return panel;
  }
  function notify(message: string, error = false) {
    toast = message;
    toastError = error;
    if (toastTimer) win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => { toast = '';render(); }, error ? 12000 : 4000);
    render();
  }
  function humanMessage(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/authenticat|unauthori|HTTP 40[13]|sign.?in|invalid.*key/i.test(message)) return 'Please check your connection in Connect AI, then try again.';
    if (/budget|quota|usage limit|insufficient.balance/i.test(message)) return 'This analysis reached its usage or spending limit. Check Connect AI before continuing.';
    if (/registry|fingerprint|snapshot|schema|taxonomy|supportRegistryIds|(?:tag|fact|registry)-[a-z0-9]{10}/i.test(message)) return 'Some tags need another check. Your completed paper analysis is saved.';
    if (/HTTP \d|invalid.response|malformed|JSON|endpoint|token/i.test(message)) return 'The AI connection could not finish this request. Your completed work is saved. Try again.';
    return message;
  }
  function showError(error: unknown) { diagnostic(`action failed: ${error instanceof Error ? error.message : String(error)}`);notify(humanMessage(error), true); }
  function diagnostic(message: string) {
    try { Zotero.debug?.(`[Smart Tags] Manager UI ${message}`, 3); } catch { /* Keep diagnostics optional in UI tests. */ }
  }
  async function run(action: string, payload?: any, message?: string) {
    if (busy) return;
    busy = true;
    render();
    try {
      const result = await invoke(action, payload);
      if (message) notify(message);
      return result;
    } finally {
      busy = false;
      render();
    }
  }
  async function invoke(action:string,payload?:any):Promise<any> {
    const receipt=await api.execute({type:action,...(payload===undefined?{}:{payload})},{commandId:`${commandPrefix}-${++commandSequence}`});
    const result=receipt.result;return receipt.runId?{...(result&&typeof result==='object'?result:{}),runId:receipt.runId}:result;
  }
  function viewQuery():ViewQuery {
    const params={paperQuery,vocabQuery,runId:selectedLogicalRunId,...(page==='vocabulary'?{buildRunId:buildRunFilter?.runId}:{}),...(page==='build'||page==='cleanup'?{buildScope,buildMode}:{}),...(page==='assignment'?{assignmentScope,assignmentTagQuery,assignmentSelectionMode,selectedAssignmentTagIds:[...selectedAssignmentTagIds]}:{}),...(page==='settings'?{settingsTransfersOpen}:{}),conceptFilter,conceptQuery,expandedConceptIds:[...expandedConcepts],selectedPaper,assignmentRunId:assignmentRunSelection,reviewFilter,activityHistoryQuery,activityHistoryPage,activityHistoryOpen,activityPaperInfoOpen,deferredReviewOpen,attentionQuery,attentionFilter,attentionPage,paperExclusionPage,topicPage,editorTagId:editorTag?.id,editorPreparationId,relationshipQueries:Object.fromEntries(relationQueries),openRelationshipPickers:[...openRelationshipPickers],libraryFiltersOpen,assignmentView};
    const pageSize=page==='vocabulary'||page==='cleanup'||page==='build'?20:PAGE_SIZE,pageIndex=page==='vocabulary'||page==='cleanup'||page==='build'?vocabularyPage:page==='library'?libraryPage:page==='activity'?runsPage:page==='assignment'||page==='review'?assignmentView==='setup'?assignmentTagPage:reviewPage:0;
    const query:ViewQuery={page,params:{...params,pageSize},limit:pageSize},key=cursorScope(query);let cursors=viewCursors.get(key);if(!cursors){cursors=new Map([[0,'0']]);viewCursors.set(key,cursors);if(viewCursors.size>32)viewCursors.delete(viewCursors.keys().next().value!);}query.cursor=cursors.get(pageIndex)??String(pageIndex*pageSize);queryPageIndexes.set(query,pageIndex);return query;
  }
  function cursorScope(query:ViewQuery):string {
    const p=query.params??{},scope=query.page==='library'?[p.paperQuery,p.conceptFilter]:query.page==='vocabulary'?[p.vocabQuery,p.buildRunId]:query.page==='activity'?['runs']:query.page==='assignment'||query.page==='review'?p.assignmentView==='setup'?['setup',p.assignmentTagQuery,p.assignmentSelectionMode]:['results',p.assignmentRunId,p.reviewFilter]:[state?.tagPreparation?.id,p.vocabQuery];return JSON.stringify([query.page,query.limit,scope]);
  }
  function primaryRowCount(query:ViewQuery,model:ManagerSnapshot){if(query.page==='library')return model.papers.length;if(query.page==='activity')return model.runs?.length??0;if(query.page==='assignment'||query.page==='review')return query.params?.assignmentView==='setup'?model.tags.length:model.suggestions.length;return model.tagPreparation?.processingPolicy!=='auto-clear'&&query.page!=='vocabulary'?model.tagPreparation?.tags.length??model.tags.length:model.tags.length;}

  function acceptViewModel(model:ManagerSnapshot) {
    state=model;if(model.run?.id===queuedRunReceipt?.id)queuedRunReceipt=undefined;if(model.run?.kind==='assignment'&&model.run.resultRunId&&model.run.id===selectedLogicalRunId)assignmentRunSelection=model.run.resultRunId;
    if(model.connection.signingIn!==undefined)signingIn=model.connection.signingIn;
    paperMap = new Map([...state.papers,...(state.detailPapers||[])].map(paper => [paper.id, paper]));
    tagMap = new Map([...state.tags,...(state.detailTags||[])].map(tag => [tag.id, tag]));
    suggestionMap = new Map(state.suggestions.map(suggestion => [suggestion.id, suggestion]));
    for (const id of searchCache.keys()) if (!paperMap.has(id)) searchCache.delete(id);
    if (!settingsDirty) settingsDraft = { ...state.settings };
    if (assignmentRunSelection === null&&!selectedLogicalRunId) assignmentRunSelection = state.assignmentReview?.id || state.assignmentReviews?.[0]?.id || null;
    if (!assignmentViewInitialized) {
      const active = (state.assignmentReviews || (state.assignmentReview ? [state.assignmentReview] : [])).find(review => review.status !== 'finished');
      if (active) { assignmentRunSelection = active.id;assignmentView = 'suggestions'; }
      if (active || page === 'assignment' || page === 'review') assignmentViewInitialized = true;
    }
    if (!workflowInitialized) {
      if (!options.page && !options.createDetail && !options.tagId) page = state.taxonomyReady ? 'vocabulary' : 'cleanup';
      buildScope = state.workflow?.buildScope || (state.taxonomyReady ? 'selected' : 'pilot');
      assignmentScope = state.workflow?.assignmentScope || 'library';
      buildMode='extend';
      workflowInitialized = true;
    }
    if (pendingNavigation) { const next = pendingNavigation; pendingNavigation = null; navigate(next, false); }
  }
  function observeView(query:ViewQuery):Promise<void> {
    const epoch=++viewEpoch;
    cleanupDropdowns(doc);
    viewController?.abort();stopView?.();
    viewController=new AbortController();viewRevision=-1;
    viewQueryKey=JSON.stringify(query);
    viewSearchKey=JSON.stringify([paperQuery,vocabQuery,conceptQuery,activityHistoryQuery,attentionQuery,assignmentTagQuery]);
    if(!state)app!.setAttribute('data-smart-tags-state','loading');
    return new Promise<void>((resolve,reject)=>{
      let settled=false;
      const timeout=()=>{if(settled)return;settled=true;reject(new Error('This page is taking longer than expected to load. Try again.'));};
      let timer=win.setTimeout(timeout,15000);
      const finish=(error?:Error)=>{if(settled)return;settled=true;win.clearTimeout(timer);error?reject(error):resolve();};
      const receive=(event:ViewEvent)=>{
        if(disposed||epoch!==viewEpoch||viewController?.signal.aborted)return;
        if(event.revision<viewRevision)return;
        if(event.phase==='loading'){
          if(!settled){win.clearTimeout(timer);timer=win.setTimeout(timeout,15000);}
          if(!state){loadingMessage=event.message||'Opening Smart Tags…';loadingProgress=event.progress;render(true);}return;
        }
        if(event.phase==='error'){const error=new Error(event.error||'This page could not be loaded.');finish(error);showError(error);return;}
        if(event.phase!=='ready'||!event.model)return;
        loadingMessage='';loadingProgress=undefined;viewRevision=event.revision;viewTotal=event.total;viewOffset=Number(query.cursor)||0;viewRowCount=primaryRowCount(query,event.model);viewNextCursor=event.nextCursor??(event.total!==undefined&&viewRowCount&&viewOffset+viewRowCount<event.total?String(viewOffset+viewRowCount):undefined);
        const cursorKey=cursorScope(query),cursors=viewCursors.get(cursorKey),index=queryPageIndexes.get(query)??0;
        if(cursors){for(const key of cursors.keys())if(key>index+1)cursors.delete(key);if(viewNextCursor!==undefined)cursors.set(index+1,viewNextCursor);else cursors.delete(index+1);}
        acceptViewModel(event.model);finish();
        if(!busy)render(true);
      };
      try{stopView=api.watch(query,receive,{signal:viewController!.signal});}
      catch(error){finish(error instanceof Error?error:new Error(String(error)));}
      viewController!.signal.addEventListener('abort',()=>finish(),{once:true});
    });
  }
  async function refresh() {
    if(disposed)return;
    if(searchTimer){win.clearTimeout(searchTimer);searchTimer=0;}
    try{await observeView(viewQuery());if(!disposed)render();}
    catch(error){if(!disposed){diagnostic(`view failed: ${error instanceof Error?error.message:String(error)}`);showError(error);}}
  }
  function ensureView() {
    if(disposed)return;
    const query=viewQuery(),key=JSON.stringify(query);
    if(key===viewQueryKey)return;
    const searchKey=JSON.stringify([paperQuery,vocabQuery,conceptQuery,activityHistoryQuery,attentionQuery,assignmentTagQuery]);
    const changedSearch=!!viewQueryKey&&searchKey!==viewSearchKey;viewSearchKey=searchKey;
    if(searchTimer)win.clearTimeout(searchTimer);
    if(changedSearch){
      ++viewEpoch;viewController?.abort();stopView?.();stopView=null;viewQueryKey=key;
      searchTimer=win.setTimeout(()=>{searchTimer=0;void observeView(query).catch(showError);},100);
    }else void observeView(query).catch(showError);
  }
  function currentState(): ManagerSnapshot {
    if (!state) throw new Error('Smart Tags is still loading.');
    return state;
  }
  function paperById(id: string) { return paperMap.get(id); }
  function tagById(id: string) { return tagMap.get(id); }
  function tagName(id: string) { return tagById(id)?.name || 'Other topic'; }
  function conceptLabel(tag: DisplayTag) { return tag.fullName && tag.fullName !== tag.name ? `${tag.name} · ${tag.fullName}` : tag.name; }
  function conceptText(tag: DisplayTag) { return `${tag.name} ${tag.fullName || ''} ${tag.description} ${tag.aliases.join(' ')}`.toLocaleLowerCase(); }
  function paperTitle(id: string) { return paperById(id)?.title || 'Paper not available'; }
  function openPaper(id: string) { return run('show-paper', { id }); }
  function paperButton(id: string) { return button(paperTitle(id), () => openPaper(id), 'paper-title-button'); }
  function warningEntry(warning: WarningRecord, active: boolean) {
    const status = warning.legacy || warning.code === 'unapproved-topics' ? 'Earlier notice' : warning.supersededBy ? 'Updated' : active ? 'Needs attention' : warning.status;
    const heading = h('div', 'inline between', h('div', 'tag-heading', badge(status, active ? 'draft' : warning.status === 'resolved' ? 'approved' : '')), active ? button('Dismiss', () => run('dismiss-warning', { id: warning.id }, 'Notice dismissed.'), 'quiet small') : null);
    const details = h('div', 'warning-record', heading, h('p', 'warning-message', humanMessage(warning.message)));
    if (warning.paperIds.length) details.append(h('div', 'warning-papers', ...warning.paperIds.map(id => paperButton(id))));
    const metadata: string[] = [];
    if (warning.occurrenceCount !== null) metadata.push(`${warning.occurrenceCount} ${warning.occurrenceCount === 1 ? 'occurrence' : 'occurrences'}`);
    if (warning.firstSeenAt) metadata.push(`First seen: ${formatDate(warning.firstSeenAt)}`);
    if (warning.lastSeenAt && warning.lastSeenAt !== warning.firstSeenAt) metadata.push(`Last seen: ${formatDate(warning.lastSeenAt)}`);
    if (warning.legacy) metadata.push('Details from this older notice are unavailable.');
    else if (warning.supersededBy) metadata.push('Replaced by a changed condition.');
    if (metadata.length) details.append(h('p', 'warning-metadata', metadata.join(' · ')));
    return details;
  }
  function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
  function formatBytes(bytes:number) {return bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KiB`:`${(bytes/(1024*1024)).toFixed(1)} MiB`;}
  function activeWarnings() {
    const records = (currentState().warnings || []).filter(warning => warning.status === 'active' && !warning.legacy && !['evidence-gap', 'unapproved-topics'].includes(warning.code));
    if (!records.length) return null;
    const notice = h('section', 'notice warning active-warning-summary', h('div', 'inline between', h('div', '', h('strong', '', `${records.length} ${records.length === 1 ? 'notice' : 'notices'} to check`), h('p', '', humanMessage(records[0].message))), h('div', 'inline', button('View details', () => nav('activity'), 'quiet small'), button('Dismiss all', () => run('dismiss-warnings', undefined, 'Notices dismissed.'), 'quiet small'))));
    notice.setAttribute('aria-label', 'Needs attention');
    return notice;
  }
  function warningHistory() {
    const records = (currentState().warnings || []).filter(warning => warning.status !== 'active' || warning.legacy || warning.code === 'unapproved-topics');
    warningHistoryPage = Math.min(warningHistoryPage, Math.max(0, Math.ceil(records.length / PAGE_SIZE) - 1));
    const body = h('div', 'warning-history');
    if (!records.length) body.append(empty('No warning history', 'Resolved and dismissed warnings are kept here.'));
    else {
      for (const warning of records.slice(warningHistoryPage * PAGE_SIZE, (warningHistoryPage + 1) * PAGE_SIZE)) body.append(warningEntry(warning, false));
      body.append(h('div', 'warning-history-pagination', pagination(records.length, warningHistoryPage, next => { warningHistoryPage = next; })));
    }
    return card('Warning history', 'Resolved, dismissed, and imported historical notices remain available for review.', body);
  }
  async function openReviewItem(item: DisplayReviewItem) {
    if(item.kind!=='assignment')return;
    const destination=await run('open-review-item',{id:item.id});assignmentRunSelection=destination?.runId||item.taskId;assignmentView='suggestions';nav('assignment');
  }
  function reviewItemBody(item:DisplayReviewItem):Node {
    if(item.state==='deferred')return h('div','inline between',h('span','',item.label),button('Reopen',()=>run('reopen-review-item',{id:item.id}),'small'));
    const suggestion=currentState().suggestions.find(value=>value.id===item.suggestionId);
    if(!suggestion)return h('div','',h('p','',item.message||item.label),button('Open assignment',()=>openReviewItem(item),'small'));
    const tag=tagById(suggestion.tagId),verb=tag?.builtin==='no_tag'?'Exclude from future tagging':suggestion.operation==='remove'?`Remove ${tagName(suggestion.tagId)}`:`Add ${tagName(suggestion.tagId)}`;
    return keyed(h('div','review-choice',h('strong','',tagName(suggestion.tagId)),h('p','',suggestion.reason),h('details','section-gap',h('summary','','Evidence'),...suggestion.evidence.map(value=>h('blockquote','evidence',h('cite','',value.source),value.text))),h('div','actions',button(verb,()=>run('resolve-review-item',{id:item.id,action:'accept'},'Choice applied.'),'primary small'),button('Reject and remember',()=>run('resolve-review-item',{id:item.id,action:'reject'},'Rejection remembered.'),'small'),button('Later',()=>run('defer-review-item',{id:item.id},'Left for later.'),'quiet small'))),`choice:${item.id}`);
  }
  function reviewInbox(items:DisplayReviewItem[],title='Needs your choice'):Node|null {
    const assignments=items.filter(item=>item.kind==='assignment'),open=assignments.filter(item=>item.state==='open'),deferred=assignments.filter(item=>item.state==='deferred');if(!open.length&&!deferred.length)return null;
    const papers=new Map<string,DisplayReviewItem[]>();for(const item of open){const key=item.paperId||item.id;papers.set(key,[...papers.get(key)||[],item]);}
    return h('section','review-inbox',h('h2','',title),h('p','card-description',`${papers.size} ${papers.size===1?'paper':'papers'}`),...Array.from(papers,([paperId,group])=>keyed(h('article','review-group',paperMap.has(paperId)?paperButton(paperId):h('strong','',group[0].label),...group.map(reviewItemBody)),`paper-choice:${paperId}`)),deferred.length?details(`Later (${deferred.length})`,deferredReviewOpen,value=>{deferredReviewOpen=value;},()=>h('div','stack',...deferred.map(reviewItemBody))):null);
  }
  function preparationTags(preparation=currentState().tagPreparation){return [...preparation?.tags||[],...preparation?.detailTags||[]];}

  function taskUndo(changeId: string | undefined, id: string) {
    if (!changeId || currentState().history.find(change => change.id === changeId)?.canUndo !== true) return null;
    const undo = button('Undo last change', () => run('undo', { id: changeId }, 'Change undone.'), 'quiet small');undo.id = id;return undo;
  }
  function approvedTags() { return currentState().tags.filter(tag => tag.status === 'approved' && !tag.builtin); }
  function assignmentTags(){return approvedTags().filter(tag=>tag.matchingMode!=='manual');}
  function assignmentTagCount() {return currentState().totals?.assignableTags??assignmentTags().length;}
  function remotePage(noun=''):boolean {if(viewTotal===undefined)return false;return page==='library'&&!noun||page==='activity'&&noun==='runs'||(page==='assignment'||page==='review')&&(assignmentView==='setup'?noun==='assignment-tags':!noun)||page==='vocabulary'&&noun==='tags'||(page==='cleanup'||page==='build')&&noun==='tags';}
  function pageRows<T>(rows:T[],pageIndex:number,size:number,noun=''):T[] {return remotePage(noun)?rows:rows.slice(pageIndex*size,(pageIndex+1)*size);}
  function pageTotal(local:number,noun=''):number {return remotePage(noun)?viewTotal!:local;}
  function hasPages(local:number,size:number,noun=''){return remotePage(noun)?viewOffset>0||viewNextCursor!==undefined:local>size;}
  function pagination(total: number, pageIndex: number, change: (next: number) => void, pageSize = PAGE_SIZE, noun = '') {
    total=pageTotal(total,noun);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const remote=remotePage(noun),offset=remote?viewOffset:pageIndex*pageSize,count=remote?viewRowCount:pageSize;
    return h('div', 'inline between', h('span', 'muted', total ? `${offset + 1}–${Math.min(total, offset+count)} of ${total}` : '0 results'),
      h('div', 'inline', button(`Previous${noun ? ` ${noun}` : ''}`, () => { change(pageIndex - 1); render(); }, 'small', pageIndex <= 0), h('span', 'muted', remote?`Page ${pageIndex+1}`:`${pageIndex + 1} / ${pages}`), button(`Next${noun ? ` ${noun}` : ''}`, () => { change(pageIndex + 1); render(); }, 'small', remote?viewNextCursor===undefined:pageIndex >= pages - 1)));
  }
  function assignmentReviews(): DisplayAssignmentReview[] { const s = currentState();return s.assignmentReviews?.length ? s.assignmentReviews : s.assignmentReview ? [s.assignmentReview] : []; }
  function selectedAssignmentReview() { return assignmentReviews().find(review => review.id === assignmentRunSelection); }
  function scopedSuggestions() {
    const reviews = assignmentReviews(), suggestions = currentState().suggestions;
    if (!reviews.length) return suggestions;
    if (assignmentRunSelection === 'legacy') return suggestions.filter(item => !item.runId || !reviews.some(review => review.id === item.runId));
    return suggestions.filter(item => item.runId === assignmentRunSelection);
  }
  function relevantSuggestions() { return scopedSuggestions().filter(item => reviewFilter === 'all' || (reviewFilter === 'applied' ? item.applied : item.status === reviewFilter && !item.applied)); }
  function scopeSelect(id: string, value: Scope, changed: (value: Scope) => void) {
    return select<Scope>(id, value, [['pilot', 'Pilot · 50 papers'], ['selected', 'Selected papers in Zotero'], ['collections', 'Selected collections'], ['library', 'Whole personal library']], changed);
  }
  function canAnalyze() {
    const s = currentState();
    return !!s.settings.model && connectionReady(s);
  }
  function connectionReady(snapshot: ManagerSnapshot) {
    if (snapshot.settings.provider === 'api') return snapshot.connection.apiKeyStored;
    if (snapshot.settings.provider === 'deepseek') return snapshot.connection.deepseekKeyStored === true;
    return snapshot.connection.chatgptSignedIn;
  }
  function renderBuild() {
    const s = currentState(), mode = s.taxonomyReady ? buildMode : 'extend';
    const manualReplacement = !!s.taxonomyReady && mode === 'replace';
    const limit = mode === 'extend' ? additionalTagTarget ?? s.settings.extensionTagTarget ?? 30 : initialTagTarget ?? s.settings.coreConceptLimit ?? 60;
    const limitInput = input('additional-tag-target', String(limit), value => { if (mode === 'extend') additionalTagTarget = Number(value);else initialTagTarget = Number(value);render(); }, '', 'number');
    limitInput.min = '1';limitInput.max = '500';limitInput.step = '1';
    const advanced = details('More options', buildAdvancedOpen, value => { buildAdvancedOpen = value; }, () => h('div', 'stack',
      s.taxonomyReady ? field('Tag list', select<BuildMode>('build-mode', mode, [['extend', 'Extend my saved tag list'], ['replace', 'Replace the full tag list']], value => { buildMode = value;render(); })) : null,
      field(mode === 'extend' ? 'Maximum new tags' : 'Maximum tags', limitInput, 'An upper limit, not a quota. Unsupported or redundant topics are left out.')));
    const explanation = !s.taxonomyReady ? 'Create your first tag list from this group of papers.' : mode === 'extend' ? 'Keep your saved tags and add useful topics from these papers.' : 'Build a replacement for the full saved tag list. Existing paper tags stay unchanged.';
    const start = async () => {
      const explicitLimit = mode === 'extend' ? additionalTagTarget : initialTagTarget;
      const result=await run('prepare-tags', { scope: buildScope, mode, processingPolicy: 'auto-clear', ...(explicitLimit !== null ? mode === 'extend' ? { additionalTargetCount: explicitLimit } : { targetCount: explicitLimit } : {}) }, manualReplacement ? 'Building a replacement. Review it before applying.' : 'Building tags. Supported meanings are saved automatically.');
      if(result?.runId){selectedLogicalRunId=result.runId;queuedRunReceipt={id:result.runId,kind:'build',status:'queued',phase:'queued',paperCount:0,completedPaperCount:0,canStop:true};}render();
    };
    const startButton = button(mode === 'extend' ? 'Extend tags' : 'Build tags', start, 'primary', !canAnalyze() || ['queued','running','paused'].includes(logicalRun('build')?.status??'') || !Number.isInteger(limit) || limit < 1 || limit > 500);
    startButton.id = 'start-build';startButton.setAttribute('aria-label', 'Build tags from these papers');
    const body = h('section', 'task-setup', field('Papers', scopeSelect('build-scope', buildScope, value => { buildScope = value;render(); }), buildScope === 'selected' || buildScope === 'collections' ? 'Use your current Zotero selection.' : undefined),
      h('p', 'card-description', `${explanation} ${manualReplacement ? 'Review it before saving.' : 'Supported meanings are saved automatically.'}`),h('p', 'muted', `Up to ${limit} ${mode === 'extend' ? 'new ' : ''}tags · upper limit, not a quota`),advanced,
      s.tagPreparation?.processingPolicy !== 'auto-clear' && s.tagPreparation ? h('p', 'card-description', 'Your current suggestions stay here until you choose Build tags. Starting another build replaces the unsaved list.') : null,
      h('div', 'task-actions', startButton));
    const setup=h('div', 'stack', !canAnalyze() ? h('div', 'notice info inline between', h('span', '', 'Choose an AI connection and model before building tags.'), button('Connect AI', () => nav('connection'), 'small')) : null,
      body);setup.id='build-setup-panel';return setup;
  }
  function renderOverview() {
    const s = currentState();
    const stats = h('div', 'stats');
    for (const [count, label] of [[approvedTags().length, 'tags ready'], [s.analyzedPaperCount ?? s.papers.length, 'papers read'], [s.suggestions.filter(item => item.status === 'pending' && !item.applied).length, 'paper suggestions']] as [number, string][]) {
      stats.append(h('div', 'stat', h('strong', '', count.toLocaleString()), h('span', '', label)));
    }
    const steps: [ManagerPage, string, string][] = [
      ['cleanup', 'Build tags', 'Learn useful meanings from your papers.'],
      ['vocabulary', 'Tag library', 'Search and correct your AI-built tags.'],
      ['assignment', 'Assign tags', 'Apply supported matches; other choices can wait.'],
    ];
    const workflow = h('ol', 'step-list');
    steps.forEach(([target, title, description], index) => workflow.append(h('li', 'step', h('span', 'step-number', String(index + 1)), h('div', '', button(title, () => nav(target), 'workflow-link'), h('p', '', description)))));
    const next: ManagerPage = !canAnalyze() ? 'connection' : s.tagPreparation ? 'cleanup' : s.taxonomyReady ? 'assignment' : 'build';
    const nextLabel = next === 'connection' ? 'Connect your AI model' : next === 'cleanup' ? 'View your build' : next === 'assignment' ? 'Choose papers to tag' : 'Prepare your first tag list';
    return h('div', '', stats, h('div', 'grid', card(s.taxonomyReady ? 'Your tag library is ready' : 'Set up your tag library', 'Building the tag list and assigning paper tags are separate steps.', h('div', '', h('p', '', s.taxonomyReady ? 'Use the saved list for another group of papers, or extend it when your research changes.' : 'Begin with a small group. Supported tags save automatically; then choose where to assign them.'), h('div', 'actions', button(nextLabel, () => nav(next), 'primary'), s.taxonomyReady ? button('Open tag library', () => nav('vocabulary')) : null)), undefined, 'overview-primary'), card('Your workflow', 'You can open any step at any time.', workflow, undefined, 'overview-guide')));
  }
  function focusTagEditorField(id: string) {
    const field = doc.getElementById(id), body = doc.getElementById('tag-editor-form');
    field?.focus({preventScroll:true});
    if (!field || !body) return;
    const control = field.getBoundingClientRect(), viewport = body.getBoundingClientRect();
    if (control.top < viewport.top || control.bottom > viewport.bottom) body.scrollTop += control.top - viewport.top;
  }
  function copyTag(tag: DisplayTag): DisplayTag { return { ...tag, aliases: [...tag.aliases], inclusions: [...tag.inclusions], exclusions: [...tag.exclusions], examples: [...tag.examples], broaderIds: [...tag.broaderIds], relatedIds: [...(tag.relatedIds || [])] }; }
  function editorDraftKey(tag: DisplayTag, preparationId = editorPreparationId) {return `${preparationId}:${tag.id}`;}
  function rememberEditorDraft() { if (editorTag) editorDrafts.set(editorDraftKey(editorTag), copyTag(editorTag)); }
  function editTag(tag: DisplayTag, preparationId = '', shouldRender = true) {
    if (tag.builtin) return;
    rememberEditorOrigin(`edit-tag-${encodeURIComponent(tag.id)}`);
    rememberEditorDraft();
    editorPreparationId = preparationId;
    relationQueries.clear();
    openRelationshipPickers.clear();
    editorTag = copyTag(editorDrafts.get(`${preparationId}:${tag.id}`) || tag);
    if (shouldRender) { render();focusTagEditorField('tag-name'); }
  }
  function navigate(next: ManagerUIOptions, shouldRender = true) {
    if (disposed) return;
    if (!state) { pendingNavigation = next; return; }
    if (next.page) { hideEditor();page = next.page==='existing-tags'?'vocabulary':next.page;win.scrollTo(0,0); }
    if (next.page === 'review') assignmentView = 'suggestions';
    if (next.assignmentRunId) { assignmentRunSelection = next.assignmentRunId;assignmentView = 'suggestions'; }
    modal = null;
    if (next.tagId) { const tag = tagById(next.tagId); if (tag) { page = 'vocabulary';win.scrollTo(0,0);editTag(tag, '', false); } }
    if (shouldRender) render();
  }
  function relationshipPicker(tag: DisplayTag, key: 'broaderIds' | 'relatedIds', label: string, description: string) {
    const choices = (editorPreparationId ? preparationTags() : [...currentState().tags,...(currentState().detailTags||[])]).filter(other => other.id !== tag.id && !other.builtin);
    const query = relationQueries.get(key) || '';
    const selected = tag[key] || [];
    const list = h('div', 'concept-picker-list');
    const visible = choices.filter(other => !query || conceptText(other).includes(query.toLocaleLowerCase())).sort((a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)) || a.name.localeCompare(b.name));
    for (const other of visible.slice(0, 100)) list.append(checkbox(`tag-${key}-${other.id}`, selected.includes(other.id), conceptLabel(other), checked => {
      tag[key] = checked ? [...new Set([...(tag[key] || []), other.id])] : (tag[key] || []).filter(id => id !== other.id);
      openRelationshipPickers.add(key);
      render();
    }));
    if (!visible.length) list.append(h('p', 'muted', 'No matching tags.'));
    if (visible.length > 100) list.append(h('p', 'muted', 'Refine the search to see more tags.'));
    const picker = h('details', 'relationship-picker', h('summary', '', `${label} · ${selected.length} selected`), h('p', 'card-description', description), input(`tag-${key}-search`, query, value => { relationQueries.set(key, value); openRelationshipPickers.add(key); render(); }, 'Find a tag…', 'search'), list);
    picker.open = openRelationshipPickers.has(key);
    listen(picker,'toggle', event => { const current=event.currentTarget as HTMLDetailsElement;if (current.isConnected) current.open ? openRelationshipPickers.add(key) : openRelationshipPickers.delete(key); });
    return picker;
  }
  function definitionKey(tag: DisplayTag) {
    return JSON.stringify([tag.name, tag.fullName || '', tag.description, tag.facet, tag.aliases, tag.inclusions, tag.exclusions, tag.examples, tag.broaderIds, tag.relatedIds || [], tag.matchingMode || (tag.custom ? 'suggest' : 'auto')]);
  }
  function editorDirty() {
    if (!editorTag) return false;
    const baseline = editorPreparationId ? preparationTags().find(tag => tag.id === editorTag!.id) : tagById(editorTag.id);
    if (baseline) return definitionKey(editorTag) !== definitionKey(baseline);
    return !!(editorTag.name || editorTag.description || editorTag.fullName || editorTag.aliases.length || editorTag.inclusions.length || editorTag.exclusions.length || editorTag.examples.length || editorTag.broaderIds.length || editorTag.relatedIds?.length);
  }
  function updateEditorState() {
    const status = doc.getElementById('tag-editor-status');
    if (status) { status.hidden = !editorDirty();status.textContent = 'Unsaved changes'; }
    for (const [id,value] of [['tag-name',editorTag?.name],['tag-description',editorTag?.description]] as const) if (value?.trim()) doc.getElementById(id)?.removeAttribute('aria-invalid');
  }
  function tagEditor() {
    if(!editorTag)return h('div','');const tag=editorTag,draftKey=editorDraftKey(tag),preparationId=editorPreparationId;
    const lines=(key:'aliases'|'inclusions'|'exclusions'|'examples',label:string)=>field(label,textarea(`tag-${key}`,tag[key].join('\n'),value=>{tag[key]=value.split('\n').map(line=>line.trim()).filter(Boolean);}));
    const advanced=details('More options',editorAdvancedOpen,value=>{editorAdvancedOpen=value;},()=>h('div','stack',field('Full name',input('tag-full-name',tag.fullName||'',value=>{tag.fullName=value;})),field('Group',select('tag-facet',tag.facet,facets.map(value=>[value,facetNames[value]]),value=>{tag.facet=value;})),lines('aliases','Other names'),lines('inclusions','Use when'),lines('exclusions','Do not use when'),lines('examples','Examples'),relationshipPicker(tag,'broaderIds','Type of','Broader scientific topics.'),relationshipPicker(tag,'relatedIds','Related topics','Related topics with a different meaning.')));
    advanced.classList.add('editor-advanced');const form=h('form','editor-scroll',field('Tag name',input('tag-name',tag.name,value=>{tag.name=value;})),field('Meaning',textarea('tag-description',tag.description,value=>{tag.description=value;})),checkbox('tag-enabled',tag.matchingMode!=='manual','Use this tag for assignment',enabled=>{tag.matchingMode=enabled?'auto':'manual';updateEditorState();}),advanced);form.id='tag-editor-form';form.setAttribute('data-view-key',draftKey);
    const save=async()=>{if(busy)return;if(!tag.name.trim()||!tag.description.trim()){const control=doc.getElementById(!tag.name.trim()?'tag-name':'tag-description');control?.setAttribute('aria-invalid','true');control?.focus();throw new Error('Enter a tag name and meaning before saving.');}const submitted=copyTag(tag);delete submitted.nativeBindingExclusions;await run(preparationId?'edit-prepared-tag':'save-tag',preparationId?{id:preparationId,tag:submitted}:{tag:submitted},'Tag saved.');editorDrafts.delete(draftKey);hideEditor();pendingEditorFocus=editorReturnFocus;render();};
    listen(form,'submit',event=>{event.preventDefault();void save().catch(showError);});const saveButton=h('button','primary','Save');saveButton.type='submit';saveButton.id='save-tag';saveButton.setAttribute('form',form.id);saveButton.disabled=busy;
    const discard=button('Discard changes',()=>{editorDrafts.delete(draftKey);editorTag=null;editorPreparationId='';pendingEditorFocus=editorReturnFocus;render();},'quiet');discard.id='discard-tag-draft';const close=button('Close editor',closeEditor,'quiet small');close.id='close-tag-editor';
    const status=h('span','editor-status','Unsaved changes');status.id='tag-editor-status';status.hidden=!editorDirty();status.setAttribute('aria-live','polite');
    const editor=h('section','card editor tag-editor',h('div','card-header inline between',h('h2','',`Edit ${tag.name}`),close),form,h('div','card-footer editor-footer',status,saveButton,discard));editor.id='tag-editor';listen(editor,'keydown',event=>{if(busy||event.defaultPrevented||event.isComposing)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeEditor();}else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.stopPropagation();void save().catch(showError);}});return editor;
  }

  function hasUnsavedPreparedChanges(){const id=currentState().tagPreparation?.id;if(!id)return false;return [...editorDrafts].some(([key,draft])=>key.startsWith(`${id}:`)&&definitionKey(draft)!==definitionKey(preparationTags().find(tag=>tag.id===draft.id)??draft))||!!editorPreparationId&&editorDirty();}
  function updateTagApplyState(){updateEditorState();const apply=doc.getElementById('apply-tag-list') as HTMLButtonElement|null;if(apply)apply.disabled=busy||!currentState().tagPreparation?.canApply||hasUnsavedPreparedChanges();}
  async function applyTagList(preparation:NonNullable<ManagerSnapshot['tagPreparation']>){if(hasUnsavedPreparedChanges())throw new Error('Save or discard edits before applying this replacement.');await run('apply-tag-list',{id:preparation.id},'Replacement saved.');}

  function renderVocabulary(prepared=false) {
    const s=currentState(),preparation=prepared?s.tagPreparation:undefined,query=vocabQuery.trim().toLocaleLowerCase(),candidates=preparation?preparationTags(preparation):approvedTags(),tags=remotePage('tags')?candidates:candidates.filter(tag=>!query||conceptText(tag).includes(query));
    const editorVisible=!!editorTag&&(prepared?editorPreparationId===preparation?.id:!editorPreparationId),total=pageTotal(tags.length,'tags');
    const clearSearch=()=>{vocabQuery='';vocabularyPage=0;render();doc.getElementById('vocabulary-search')?.focus({preventScroll:true});};
    const search=input('vocabulary-search',vocabQuery,value=>{vocabQuery=value;vocabularyPage=0;render();},'Find a tag, meaning, or other name…','search');search.setAttribute('aria-label','Search tags');listen(search,'keydown',event=>{if(event.key==='Escape'&&vocabQuery){event.preventDefault();event.stopPropagation();clearSearch();}});
    const toolbar=h('div','library-search-row',search,vocabQuery?button('Clear search',clearSearch,'quiet small'):null),list=h('section','tag-workspace-list');list.id='tag-list-scroll';list.setAttribute('data-view-key',`${prepared?preparation?.id:'saved'}:${buildRunFilter?.runId||'all'}`);
    for(const tag of pageRows(tags,vocabularyPage,20,'tags')){
      const edit=button('Edit',()=>editTag(tag,preparation?.id||''),'quiet small');edit.id=`edit-tag-${encodeURIComponent(tag.id)}`;edit.setAttribute('aria-label',`Edit tag ${tag.name}`);
      const remove=button('Remove',async()=>{await run(preparation?'remove-prepared-tag':'delete-tag',preparation?{id:preparation.id,tagId:tag.id}:{id:tag.id},'Tag removed from the active list.');editorDrafts.delete(`${preparation?.id||''}:${tag.id}`);if(editorTag?.id===tag.id)hideEditor();},'quiet small');remove.setAttribute('aria-label',`Remove tag ${tag.name}`);
      const disabled=tag.matchingMode==='manual',count=tag.currentlyTaggedCount??0;list.append(keyed(h('article','tag-row',h('div','inline between',h('div','tag-heading',h('strong','',tag.name),disabled?badge('Disabled'):null),h('div','inline',edit,remove)),tag.fullName&&tag.fullName!==tag.name?h('p','concept-full-name',tag.fullName):null,h('p','',tag.description),h('div','tag-meta',h('span','',disabled?'Not used for assignment':`${count} ${count===1?'paper':'papers'} tagged`),tag.aliases.length?h('span','',`Other names: ${tag.aliases.join(', ')}`):null)),`tag:${preparation?.id||'saved'}:${tag.id}`));
    }
    if(!tags.length)list.append(query?empty('No matching tags','Try another name or clear the search.',button('Clear search',clearSearch,'small')):empty('No AI-built tags yet','Choose a few papers and build your first tag list.',button('Build tags',()=>nav('cleanup'),'primary')));
    if(hasPages(tags.length,20,'tags'))list.append(pagination(tags.length,vocabularyPage,next=>{vocabularyPage=next;},20,'tags'));
    const scoped=!prepared&&buildRunFilter?h('div','notice info inline between',h('span','',`${total} ${total===1?'tag':'tags'} from this build`),button('Back to library',()=>{buildRunFilter=null;vocabQuery='';vocabularyPage=0;render();},'quiet small')):null;if(scoped)scoped.id='build-tag-filter';
    const header=h('div','tag-workspace-header library-overview',h('p','card-description',prepared?`${total} proposed tags · ${preparation!.scopeCount} papers`:`${s.totals?.tags??total} active AI-built ${(s.totals?.tags??total)===1?'tag':'tags'}`),prepared?button('Apply replacement',()=>applyTagList(preparation!),'primary',!preparation?.canApply||hasUnsavedPreparedChanges()):null);if(prepared)header.querySelector('button')!.id='apply-tag-list';
    return h('div',`tag-workspace tag-library ${editorVisible?'has-editor':''}`,header,scoped,toolbar,prepared?h('p','notice warning','Applying this replacement changes the active tag list. Existing Zotero paper tags stay in place.'):null,h('div','tag-workspace-columns',list,editorVisible?tagEditor():null));
  }
  function renderCleanup() {
    const s=currentState(),replacement=s.tagPreparation&&s.tagPreparation.processingPolicy!=='auto-clear'&&s.tagPreparation.canApply;return h('div','stack',runProgress('build'),buildOutcome(),paperExclusionReview(),renderBuild(),replacement?renderVocabulary(true):null);
  }
  function buildCounts(fresh:number,reused=0,skipped=0,unavailable=0){return `${fresh} new · ${reused} reused · ${skipped} ambiguous ${skipped===1?'concept':'concepts'} skipped · ${unavailable} ${unavailable===1?'paper':'papers'} unavailable`;}
  function buildOutcome():Node|null {
    const s=currentState(),result=s.buildResult;if(!result)return null;
    const unknown=result.status==='unknown',live=['running','paused'].includes(result.status),failed=result.status==='failed',unavailable=result.unavailableCount??(result.status==='needs-information'?result.paperCount-result.completedPaperCount:0),manualReview=result.requiresChangeReview||result.status==='completed'&&!result.savedCount&&s.tagPreparation?.processingPolicy!=='auto-clear'&&s.tagPreparation?.canApply;
    const title=unknown?'Earlier build':manualReview?'Replacement ready for review':failed?'Build stopped':result.status==='needs-information'?'Build finished with unavailable papers':live?'Build results so far':'Build complete',counts=buildCounts(result.savedCount,result.reusedCount,result.skippedCount,unavailable);
    const view=()=>{buildRunFilter={runId:result.runId,savedCount:result.savedCount};vocabQuery='';vocabularyPage=0;nav('vocabulary');},names=result.tagNames?.slice(0,8);
    const summary=h('section','task-summary',h('h2','',title),h('p','',unknown?'This earlier build has no saved outcome details.':manualReview?'Review the proposed list below before replacing your active tags.':counts),!unknown?h('p','card-description',`${result.completedPaperCount} of ${result.paperCount} ${result.paperCount===1?'paper':'papers'} read`):null,names?.length?h('p','card-description',`Saved: ${names.join(', ')}${result.savedCount>names.length?` and ${result.savedCount-names.length} more`:''}.`):null,!live&&!failed&&result.message?h('p','card-description',humanMessage(result.message)):null,h('div','task-actions',result.savedCount?button('View built tags',view,'primary'):null,taskUndo(s.tagPreparation?.lastChangeId,'undo-build-change'),(result.savedCount||result.reusedCount)?button('Assign tags',()=>{assignmentSelectionMode='all';assignmentView='setup';nav('assignment');},'small'):null,failed?button('Open Runs',()=>nav('activity'),'small'):null));summary.id='build-result';return summary;
  }

  function renderAssignment() {
    const s=currentState(),tabs=h('div','tag-workspace-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Assignment views');
    for(const [value,label] of [['setup','New assignment'],['suggestions','Results']] as const){const tab=button(label,()=>{assignmentView=value;render();},assignmentView===value?'selected':'quiet');tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(assignmentView===value));if(value==='setup'){tab.id='assignment-setup-toggle';tab.setAttribute('aria-label','Assignment setup');}tabs.append(tab);}
    if(assignmentView==='suggestions'){const current=logicalRun('assignment'),waiting=!!current&&!current.resultRunId&&['queued','running'].includes(current.status);return h('div','stack',tabs,runProgress('assignment'),waiting?h('p','card-description','Results will appear here as papers finish.'):renderReview());}
    const available=assignmentTagCount(),query=assignmentTagQuery.trim().toLocaleLowerCase(),choices=assignmentTags().filter(tag=>tag.matchingMode!=='manual'&&(remotePage('assignment-tags')||!query||conceptText(tag).includes(query))),selected=assignmentSelectionMode==='selected',count=selected?selectedAssignmentTagIds.size:available;
    const picker=h('div','assignment-tag-picker',field('Tags to use',select('assignment-tag-mode',assignmentSelectionMode,[['all',`All enabled tags (${available})`],['selected','Choose tags…']],value=>{assignmentSelectionMode=value;assignmentTagPage=0;render();},'Tags to use')));
    if(selected){const search=input('assignment-tag-search',assignmentTagQuery,value=>{assignmentTagQuery=value;assignmentTagPage=0;render();},'Find tags…','search');search.setAttribute('aria-label','Search assignment tags');picker.append(search,h('p','card-description',`${count} selected`));const list=h('div','assignment-tag-options');for(const tag of pageRows(choices,assignmentTagPage,50,'assignment-tags'))list.append(checkbox(`assignment-tag-${tag.id}`,selectedAssignmentTagIds.has(tag.id),conceptLabel(tag),checked=>{checked?selectedAssignmentTagIds.add(tag.id):selectedAssignmentTagIds.delete(tag.id);render();}));if(!choices.length)list.append(h('p','muted','No enabled tags match this search.'));picker.append(list);if(hasPages(choices.length,50,'assignment-tags'))picker.append(pagination(choices.length,assignmentTagPage,next=>{assignmentTagPage=next;},50,'assignment-tags'));}
    const start=async()=>{assignmentRunSelection=null;selectedSuggestions.clear();const receipt=await run('tag',{scope:assignmentScope,...(selected?{tagIds:[...selectedAssignmentTagIds]}:{}),processingPolicy:'auto-clear'});if(receipt?.runId){selectedLogicalRunId=receipt.runId;queuedRunReceipt={id:receipt.runId,kind:'assignment',status:'queued',phase:'queued',paperCount:0,completedPaperCount:0,canStop:true};}assignmentView='suggestions';render();};
    const startButton=button('Assign tags',start,'primary',!canAnalyze()||!count||['queued','running','paused'].includes(logicalRun('assignment')?.status??''));startButton.id='start-assignment';startButton.setAttribute('aria-label','Assign tags to these papers');
    const group=h('section','task-setup',picker,field('Papers',scopeSelect('assignment-scope',assignmentScope,value=>{assignmentScope=value;render();})),s.workflow?.assignmentScope===assignmentScope?h('p','card-description',`${s.workflow.assignmentPaperCount} papers in the last chosen group · ${s.workflow.assignedPaperCount} with Smart Tags assignments`):null,h('p','card-description','Supported high-confidence additions apply automatically. Other choices can wait.'),h('div','task-actions',startButton));group.id='assignment-setup-panel';
    const routine=details(`For new papers · ${s.settings.autoAssign?'On':'Off'}`,incomingSettingsOpen,value=>{incomingSettingsOpen=value;},()=>h('div','stack',checkbox('assignment-auto-assign',s.settings.autoAssign,'Tag new papers automatically',value=>{void run('save-settings',{settings:{...currentState().settings,autoAssign:value}},value?'Automatic tagging enabled.':'Automatic tagging disabled.').catch(showError);},!available||!canAnalyze()),h('p','card-description','Uses all enabled AI-built tags within your spending limit.')));
    return h('div','stack',tabs,runProgress('assignment'),!available?empty('Build tags first','Assignment uses your enabled AI-built definitions.',button('Build tags',()=>nav('cleanup'),'primary')):null,!canAnalyze()?h('div','notice info inline between',h('span','','Connect an AI model before assigning tags.'),button('Connect AI',()=>nav('connection'),'small')):null,group,routine);
  }

  function paperAttention() {
    const projection=currentState().paperAttention;
    const all = [...new Map((currentState().paperAttention?.papers || []).map(paper => [paper.id, paper])).values()];
    const papers = projection?.total!==undefined?all:all.filter(paper => (attentionFilter === 'all' || (attentionFilter === 'attention' ? paper.status === 'needsInformation' || paper.status === 'failed' : paper.status === attentionFilter))
      && (!attentionQuery || paper.title.toLocaleLowerCase().includes(attentionQuery.toLocaleLowerCase())));
    const total=projection?.total??papers.length;attentionPage = Math.min(attentionPage, Math.max(0, Math.ceil(total / 25) - 1));
    const visible = projection?.total!==undefined?papers:papers.slice(attentionPage * 25, (attentionPage + 1) * 25);
    const selected = papers.filter(paper => selectedAttentionPapers.has(paper.id));
    const dismissible = (paper: typeof all[number]) => paper.canDismiss ?? (paper.status === 'needsInformation' || paper.status === 'failed');
    const dismiss = async (ids: string[]) => { await run('dismiss-paper-attention', { ids }, 'Current notices dismissed.');for (const id of ids) selectedAttentionPapers.delete(id);render(); };
    const previewExclusion = (ids: string[], exclude: boolean) => { paperExclusionPage = 0;return run('preview-paper-exclusion', { ids, exclude }); };
    const headerMenu = actionMenu('attention-more', 'More', 'More paper actions', [{ id: 'exclude-zotero', label: 'Exclude selected Zotero items…', run: () => { paperExclusionPage = 0;return run('preview-paper-exclusion', { exclude: true }); } }]);
    const list = h('div', 'paper-attention-list');
    list.append(h('div', 'toolbar attention-toolbar', input('attention-search', attentionQuery, value => { attentionQuery = value;attentionPage = 0;selectedAttentionPapers.clear();render(); }, 'Find a paper…', 'search'), select('attention-status', attentionFilter, [['attention', 'Needs attention'], ['all', 'All checked papers'], ['usable', 'Ready to use'], ['needsInformation', 'Needs information'], ['failed', 'Analysis failed'], ['skipped', 'Skipped'], ['excluded', 'Excluded from tagging']], value => { attentionFilter = value;attentionPage = 0;selectedAttentionPapers.clear();render(); }, 'Paper information status'), headerMenu));
    if (!papers.length) {
      list.append(h('div', 'attention-empty', h('strong', '', attentionFilter === 'attention' && !attentionQuery ? 'No papers need attention' : 'No matching papers')));
      return list;
    }
    const selectPage = checkbox('attention-select-page', visible.every(paper => selectedAttentionPapers.has(paper.id)), 'Select this page', checked => { for (const paper of visible) checked ? selectedAttentionPapers.add(paper.id) : selectedAttentionPapers.delete(paper.id);render(); });
    selectPage.querySelector('input')!.indeterminate = visible.some(paper => selectedAttentionPapers.has(paper.id)) && !visible.every(paper => selectedAttentionPapers.has(paper.id));
    list.append(h('div', 'inline between attention-select-page', selectPage, h('span', 'muted', `${total} ${total===1?'paper':'papers'}`)));
    if (selected.length) {
      const eligible = (predicate: (paper: typeof all[number]) => boolean) => selected.filter(predicate).map(paper => paper.id);
      const retryIds = eligible(paper => paper.canRetry && paper.status !== 'excluded');
      const commands: MenuAction[] = [];
      const dismissIds = eligible(dismissible), excludeIds = eligible(paper => paper.status !== 'excluded'), skipIds = eligible(paper => paper.canSkip && paper.status !== 'excluded'), includeIds = eligible(paper => paper.status === 'excluded');
      if (dismissIds.length) commands.push({ id: 'dismiss', label: 'Dismiss selected', run: () => dismiss(dismissIds) });
      if (excludeIds.length) commands.push({ id: 'exclude', label: 'Exclude selected from tagging', run: () => previewExclusion(excludeIds, true) });
      if (skipIds.length) commands.push({ id: 'skip', label: 'Skip selected for this build', run: () => run('skip-paper-analysis', { ids: skipIds }, 'Selected papers skipped for this build.') });
      if (includeIds.length) commands.push({ id: 'include', label: 'Include selected again', run: () => previewExclusion(includeIds, false) });
      list.append(h('div', 'attention-bulk-bar', h('span', '', `${selected.length} selected`), h('div', 'inline', button('Clear', () => { selectedAttentionPapers.clear();render(); }, 'small quiet'), retryIds.length ? button('Retry selected', () => run('retry-papers', { ids: retryIds }, 'Selected papers queued.'), 'small primary') : null, actionMenu('attention-bulk-actions', 'Actions', 'Actions for selected papers', commands))));
    }
    const labels = { usable: 'Ready to use', needsInformation: 'Needs information', failed: 'Analysis failed', skipped: 'Skipped for this build', excluded: 'Excluded from tagging' };
    for (const paper of visible) {
      const recovery: MenuAction[] = [];
      if (paper.status === 'excluded') recovery.push({ id: 'include', label: 'Include again', run: () => previewExclusion([paper.id], false) });
      else {
        if (paper.canLookupMetadata) recovery.push({ id: 'metadata', label: 'Find metadata', run: () => { metadataIdentifier = '';return run('preview-metadata', { id: paper.id }); } });
        if (paper.canRecheck) recovery.push({ id: 'pdf', label: 'Recheck PDF', run: () => run('recheck-paper-inputs', { id: paper.id }, 'Local paper information checked.') });
        if (paper.canRetry) recovery.push({ id: 'retry', label: 'Retry analysis', run: () => run('retry-papers', { ids: [paper.id] }, 'Paper queued.') });
      }
      const primary = recovery.shift();
      if (paper.status !== 'excluded') {
        if (dismissible(paper)) recovery.push({ id: 'dismiss', label: 'Dismiss', run: () => dismiss([paper.id]) });
        recovery.push({ id: 'exclude', label: 'Exclude from tagging', run: () => previewExclusion([paper.id], true) });
        if (paper.canSkip) recovery.push({ id: 'skip', label: 'Skip for this build', run: () => run('skip-paper-analysis', { ids: [paper.id] }, 'Paper skipped for this build.') });
      }
      const selection = checkbox(`attention-${paper.id}`, selectedAttentionPapers.has(paper.id), '', checked => { checked ? selectedAttentionPapers.add(paper.id) : selectedAttentionPapers.delete(paper.id);render(); });
      selection.querySelector('input')!.setAttribute('aria-label', `Select ${paper.title}`);
      list.append(h('article', 'paper-attention-row', selection, h('div', 'attention-row-content', paperButton(paper.id), h('div', 'inline attention-row-status', badge(labels[paper.status]), paper.queued ? badge('Queued') : null), h('p', 'card-description', humanMessage(paper.message))), h('div', 'attention-row-actions', primary ? button(primary.label, primary.run, 'small') : null, actionMenu(`attention-more-${paper.id}`, 'More', `More actions for ${paper.title}`, recovery))));
    }
    if (total > 25) list.append(pagination(total, attentionPage, next => { attentionPage = next; }, 25, 'papers'));
    return list;
  }

  function paperExclusionReview() {
    const preview = currentState().paperExclusionPreview;
    if (!preview) return null;
    const total=preview.total??preview.changes.length,size=preview.pageSize??50;paperExclusionPage = Math.min(paperExclusionPage, Math.max(0, Math.ceil(total / size) - 1));
    const body = h('div', 'paper-exclusion-preview');
    for (const change of preview.total!==undefined?preview.changes:preview.changes.slice(paperExclusionPage * size, (paperExclusionPage + 1) * size)) body.append(h('article', 'paper-card', h('strong', '', change.title), h('p', '', `Before: ${change.before.join(', ') || 'No tags'}`), h('p', '', `After: ${change.after.join(', ') || 'No tags'}`)));
    body.append(pagination(total, paperExclusionPage, next => { paperExclusionPage = next; }, size, 'exclusion changes'));
    return card(preview.exclude ? 'Mark no_tag and exclude from tagging' : 'Include papers in tagging again', preview.exclude ? 'Apply this mark to leave the reviewed papers out of future builds and assignments. Undo is available in Runs.' : 'Remove no_tag from the reviewed papers so future builds can include them.', body, h('div', 'actions', button(preview.exclude ? 'Apply no_tag and exclude' : 'Apply inclusion', async () => { const result = await run('apply-paper-exclusion', { previewId: preview.id }, preview.exclude ? 'Papers excluded from tagging.' : 'Papers included in tagging again.');selectedAttentionPapers.clear();if (result?.page === 'cleanup') nav('cleanup');else render(); }, 'primary', !preview.changes.length), button('Cancel exclusion change', () => run('cancel-paper-exclusion'), 'quiet')));
  }

  function metadataReview() {
    const preview = currentState().metadataPreview;
    if (!preview) return null;
    const body = h('div', '', h('p', '', humanMessage(preview.message)), h('div', 'toolbar', input('metadata-identifier', metadataIdentifier, value => { metadataIdentifier = value;render(); }, 'DOI or other supported identifier'), button('Find with identifier', () => run('preview-metadata', { id: preview.paperId, identifier: metadataIdentifier.trim() }), '', !metadataIdentifier.trim())));
    const names: Record<string,string> = { abstractNote: 'Abstract', publicationTitle: 'Publication', title: 'Title', date: 'Date', DOI: 'DOI' };
    for (const change of preview.changes) body.append(h('div', 'metadata-change', h('strong', '', names[change.field] || change.field), h('p', '', `Before: ${change.before || 'Empty'}`), h('p', '', `After: ${change.after}`)));
    return card('Review missing metadata', 'Only empty fields are filled. Existing information stays under your control.', body, button('Apply metadata', () => run('apply-metadata', { previewId: preview.id }, 'Missing metadata filled.'), 'primary', !preview.changes.length));
  }

  function suggestionCard(suggestion: DisplaySuggestion) {
    const tag = tagById(suggestion.tagId);
    const check = h('input');
    check.type = 'checkbox';
    check.checked = selectedSuggestions.has(suggestion.id);
    check.disabled = busy || !!suggestion.applied || suggestion.status === 'rejected';
    check.setAttribute('aria-label', `Select ${tag?.name || suggestion.tagId} for ${paperTitle(suggestion.paperId)}`);
    listen(check,'change', event => { (event.currentTarget as HTMLInputElement).checked ? selectedSuggestions.add(suggestion.id) : selectedSuggestions.delete(suggestion.id); render(); });
    const body = h('div', '', h('div', 'suggestion-header', h('div', '', paperButton(suggestion.paperId), h('div', 'inline section-gap', h('strong', '', tag?.name || suggestion.tagId), suggestion.operation === 'remove' ? badge('remove managed tag', 'removal') : badge('add tag'), badge(suggestion.confidence, suggestion.confidence), tag?.builtin === 'no_tag' ? badge('Exclude from tagging') : null, suggestion.applied ? badge('applied', 'approved') : badge(suggestion.status, suggestion.status === 'accepted' ? 'approved' : suggestion.status === 'pending' ? 'draft' : ''))), suggestion.locked ? badge('locked') : null), h('p', 'suggestion-reason', suggestion.reason));
    for (const evidence of suggestion.evidence) body.append(h('blockquote', 'evidence', h('cite', '', evidence.source), evidence.text));
    if (!suggestion.evidence.length) body.append(h('p', 'card-description', tag?.builtin === 'no_tag' ? 'Review the completed analysis before excluding this paper from future tagging.' : 'No supporting passage is available. Inspect this paper before accepting.'));
    body.append(h('div', 'actions',
      !suggestion.applied && suggestion.status !== 'accepted' && (suggestion.status !== 'rejected' || suggestion.decisionOrigin === 'automatic') ? button('Accept', () => run('accept-suggestion', { id: suggestion.id }, 'Suggestion accepted. Apply reviewed suggestions to write native tags.'), 'small primary') : null,
      !suggestion.applied && suggestion.status !== 'rejected' ? button('Reject', () => run('reject-suggestion', { id: suggestion.id }, 'Rejected. This choice will be remembered.'), 'small') : null,
      suggestion.status === 'rejected' && suggestion.decisionOrigin !== 'automatic' ? button('Clear rejection', () => run('clear-rejection', { paperId: suggestion.paperId, tagId: suggestion.tagId }, 'Rejection cleared; the paper can be evaluated again.'), 'small') : null,
      button(suggestion.locked ? 'Unlock assignment' : 'Lock assignment', () => run(suggestion.locked ? 'unlock-assignment' : 'lock-assignment', { paperId: suggestion.paperId, tagId: suggestion.tagId }, suggestion.locked ? 'Assignment unlocked.' : 'Assignment locked.'), 'small quiet')));
    return h('article', 'paper-card suggestion', check, body);
  }
  function assignmentTopicReport(review: DisplayAssignmentReview) {
    if ((review.processingPolicy === 'auto-clear' ? !review.analysisComplete : review.status !== 'finished') || !review.report) return null;
    const topics = review.report.topics.filter(topic => !topic.resolved);
    topicPage = Math.min(topicPage, Math.max(0, Math.ceil(topics.length / 20) - 1));
    const selected = topics.filter(topic => selectedTopicIds.has(topic.id));
    const paperIds = [...new Set(selected.flatMap(topic => topic.paperIds))];
    const target = topicAdditionalTarget ?? currentState().settings.extensionTagTarget ?? 30;
    const targetInput = input('topic-additional-tag-target', String(target), value => { topicAdditionalTarget = Number(value);render(); }, '', 'number');targetInput.min = '1';targetInput.max = '500';targetInput.step = '1';
    const body = h('div', '', h('p', 'card-description', 'Choose topics to build additions from these papers. New tags are compared with your saved meanings.'));
    for (const topic of topics.slice(topicPage * 20, (topicPage + 1) * 20)) body.append(h('article', 'tag-row', checkbox(`assignment-topic-${topic.id}`, selectedTopicIds.has(topic.id), topic.name, checked => { checked ? selectedTopicIds.add(topic.id) : selectedTopicIds.delete(topic.id);render(); }), h('p', 'card-description', `${topic.paperIds.length} ${topic.paperIds.length === 1 ? 'paper' : 'papers'}`), h('div', 'warning-papers', ...topic.paperIds.slice(0, 3).map(id => paperButton(id)))));
    if (!topics.length) body.append(h('p', '', 'No uncovered topics are waiting.'));
    if (topics.length > 20) body.append(pagination(topics.length, topicPage, next => { topicPage = next; }, 20, 'topics'));
    if (topics.length) body.append(field('Maximum new tags', targetInput, 'Saved tags are kept. The limit is not a quota.'), h('div', 'actions', button('Extend from selected topics', async () => { const receipt=await run('extend-assignment-topics', { runId: review.id, paperIds, additionalTargetCount: target, processingPolicy: 'auto-clear' }, 'Building additions from the selected topic papers.');if(receipt?.runId){selectedLogicalRunId=receipt.runId;queuedRunReceipt={id:receipt.runId,kind:'build',status:'queued',phase:'queued',paperCount:0,completedPaperCount:0,canStop:true};}if (!currentState().paperExclusionPreview) nav('cleanup');else render(); }, 'primary', !paperIds.length || !Number.isInteger(target) || target < 1 || target > 500 || currentState().queue.status === 'running')));
    return card('Topics outside your saved list', `${topics.length} topics · ${review.report.paperIds.length} papers`, body);
  }
  function renderReview() {
    const s = currentState();
    const reviews = assignmentReviews(), review = selectedAssignmentReview(), scope = scopedSuggestions(), scopeIds = new Set(scope.map(item => item.id));
    const suggestions = relevantSuggestions();
    if(!remotePage())reviewPage = Math.min(reviewPage, Math.max(0, Math.ceil(suggestions.length / PAGE_SIZE) - 1));
    const visible = pageRows(suggestions,reviewPage,PAGE_SIZE);
    const applicableSelected = [...selectedSuggestions].filter(id => { const item = suggestionMap.get(id); return scopeIds.has(id) && !!item && !item.applied && item.status !== 'rejected'; });
    const accepted = scope.filter(item => item.status === 'accepted' && !item.applied && (!review || review.acceptedIds.includes(item.id))).map(item => item.id);
    const older = s.suggestions.some(item => !item.runId || !reviews.some(review => review.id === item.runId));
    const runOptions: [string,string][] = reviews.map((review, index) => [review.id, review.label || `Assignment ${index + 1} · ${review.scopeCount} papers`]);if (older) runOptions.push(['legacy', 'Earlier suggestions']);
    const runSelector = reviews.length ? select('assignment-result', assignmentRunSelection || reviews[0].id, runOptions, value => { assignmentRunSelection = value;selectedSuggestions.clear();selectedTopicIds.clear();reviewPage = 0;topicPage = 0;render(); }, 'Assignment result') : null;
    if (review?.processingPolicy === 'auto-clear') {
      const items = (s.reviewItems || []).filter(item => item.kind === 'assignment' && item.taskId === review.id);
      const waiting = new Set(items.filter(item => item.state === 'open').map(item => item.paperId)).size;
      const outcomes = scope.filter(item => item.applied || item.status === 'rejected');
      const appliedCount = review.appliedCount ?? scope.filter(item => item.applied && item.operation !== 'remove').length;
      const resultRun = s.run?.kind === 'assignment' && s.run.resultRunId === review.id ? s.run : s.runs?.find(item => item.kind === 'assignment' && item.resultRunId === review.id);
      const progressMessage = resultRun?.status === 'stopped' ? 'This run was stopped. Completed results are kept; remaining choices can wait.'
        : resultRun?.status === 'failed' ? 'This run stopped after an error. Completed results are kept; remaining choices can wait.'
        : resultRun?.status === 'paused' ? 'Matching is paused. Completed results and remaining choices are kept.'
        : review.analysisComplete || review.status === 'finished' || resultRun?.status === 'completed' ? 'Supported additions are saved. Other choices can wait.'
        : resultRun?.status === 'queued' ? 'This assignment is queued. Results will appear as papers finish.'
        : 'Validated high-confidence additions are being written as matching finishes.';
      const summary = h('div', '',h('p', '', `${appliedCount} ${appliedCount === 1 ? 'tag change' : 'tag changes'} applied${waiting ? ` · ${waiting} ${waiting === 1 ? 'paper needs' : 'papers need'} your choice` : ''}.`),
        h('p', 'card-description',progressMessage));
      const fallback = !s.reviewItems ? h('div', 'stack',...scope.filter(item => !item.applied && item.status === 'pending').map(item => h('article', 'paper-card',paperButton(item.paperId),h('p', '', item.reason),
        button(item.operation === 'remove' ? `Remove ${tagName(item.tagId)}` : `Add ${tagName(item.tagId)}`,() => run('accept-suggestion',{id:item.id},'Choice applied.'),'small'),button('Reject and remember',() => run('reject-suggestion',{id:item.id}),'small')))) : null;
      return h('div', 'stack',runSelector,h('section','task-summary',summary,taskUndo(review.lastChangeId,'undo-assignment-change')),reviewInbox(items),fallback,
        outcomes.length ? details('Applied and declined',reviewDetailsOpen,value => { reviewDetailsOpen = value; },() => h('div', 'stack',...outcomes.map(item => h('article', 'tag-row',paperButton(item.paperId),h('strong', '', tagName(item.tagId)),badge(item.applied ? 'Applied' : 'Declined'),h('p', '', item.reason))))) : null,
        assignmentTopicReport(review),paperExclusionReview());
    }
    const toolbar = h('div', 'toolbar', select('review-filter', reviewFilter, [['pending', 'Pending review'], ['accepted', 'Accepted, not applied'], ['rejected', 'Rejected'], ['applied', 'Applied'], ['all', 'All suggestions']], value => { reviewFilter = value; reviewPage = 0; render(); }, 'Suggestion status'),
      button('Select this page', () => { for (const item of visible) if (!item.applied && item.status !== 'rejected') selectedSuggestions.add(item.id); render(); }),
      button('Clear selection', () => { selectedSuggestions.clear(); render(); }, 'quiet'),
      h('span', 'search-results', `${suggestions.length} suggestions`));
    const actions = h('div', 'notice inline between', h('span', '', h('span', 'batch-count', `${applicableSelected.length} selected`), ` · ${accepted.length} accepted and ready to apply`), h('div', 'inline', button('Review selected changes', () => { modalPage = 0; modal = { kind: 'apply', ids: applicableSelected }; render(); }, '', !applicableSelected.length), button('Apply accepted…', () => { modalPage = 0; modal = { kind: 'apply', ids: accepted }; render(); }, 'primary', !accepted.length)));
    const list = h('section', 'card');
    if (!suggestions.length) list.append(empty(s.queue.status === 'running' && s.queue.kind !== 'rebuild' ? 'Preparing paper suggestions…' : 'No paper suggestions here yet', s.queue.status === 'running' && s.queue.kind !== 'rebuild' ? 'Paper matches will appear here as they finish.' : 'Choose a group in Assignment setup to request suggestions.', button('Assignment setup', () => { assignmentView = 'setup';nav('assignment'); }, 'quiet')));
    for (const suggestion of visible) list.append(suggestionCard(suggestion));
    const bulkIds = new Set(review?.bulkAcceptIds || []);
    const choices = scope.filter(item => item.status === 'pending' && !bulkIds.has(item.id));
    const bulkCount = review?.bulkAcceptCount ?? 0;
    const needsChoice = review?.needsChoiceCount ?? choices.length;
    const finish = (acceptRemaining: boolean) => {
      const ids = [...new Set([...accepted, ...(acceptRemaining ? scope.filter(item => bulkIds.has(item.id) && !item.applied).map(item => item.id) : [])])];
      if (ids.length) { modalPage = 0;modal = { kind: 'finish', ids, runId: review!.id, acceptRemaining };render(); }
      else void run('finish-assignment', { runId: review!.id }, 'Assignment finished.').catch(showError);
    };
    const primary = review && review.status !== 'finished' ? bulkCount > 0 && needsChoice === 0
      ? button('Accept remaining and finish', () => finish(true), 'primary', !review.analysisComplete)
      : bulkCount > 0
        ? button(`Accept ${bulkCount} suggested matches`, () => run('accept-run-suggestions', { runId: review.id }, 'Suggested matches accepted.'), 'primary', !review.analysisComplete)
        : button(accepted.length ? 'Apply accepted and finish' : 'Finish assignment', () => finish(false), 'primary', !review.canFinish || !review.analysisComplete)
      : undefined;
    const summary = review ? card(review.label || 'This assignment', `${review.scopeCount} papers`, h('div', '', h('p', '', `${review.highAccepted} high matches accepted · ${needsChoice} choices waiting · ${review.lowRejected} declined automatically`), h('p', 'card-description', review.status === 'finished' ? 'This assignment is finished. Its topic report is below.' : review.analysisComplete ? 'Ready matches can be accepted together. Review the paper tag changes once before applying them.' : 'Paper matching is in progress. Completed matches are kept.')), primary) : empty('No assignment results yet', 'Choose the papers and tags to use in Assignment setup.', button('Assignment setup', () => { assignmentView = 'setup';nav('assignment'); }, 'primary'));
    const meaningful = h('div', 'stack');
    if (review && review.status !== 'finished') for (const item of choices.slice(0, PAGE_SIZE)) meaningful.append(h('article', 'card', h('div', 'card-header', h('div', '', paperButton(item.paperId), h('h3', '', `${item.operation === 'remove' ? 'Remove' : 'Use'} ${tagName(item.tagId)}?`))), h('p', '', item.reason), h('div', 'actions', button('Accept', () => run('accept-suggestion', { id: item.id }, 'Choice saved.'), 'primary small'), button('Reject', () => run('reject-suggestion', { id: item.id }, 'Choice saved.'), 'small'))));
    if (choices.length > PAGE_SIZE) meaningful.append(h('p', 'card-description', `${choices.length - PAGE_SIZE} more choices are available in Details.`));
    return h('div', 'stack', runSelector, summary, meaningful, details('Details', reviewDetailsOpen, value => { reviewDetailsOpen = value; }, () => h('div', 'stack', toolbar, actions, list, pagination(suggestions.length, reviewPage, next => { reviewPage = next; }))), review ? assignmentTopicReport(review) : null, paperExclusionReview());
  }

  function matchingPaperIds(filter:ConceptFilter):Set<string> {
    if(!filter.selections.length)return new Set(paperMap.keys());
    const clauses=filter.selections.map(selection=>[selection.conceptId,...(selection.contextId?[selection.contextId]:[])].map(id=>new Set(descendantIds(id,currentState().tags))));
    return new Set([...paperMap].filter(([,paper])=>{const ids=new Set(paper.matchedTagIds??[]),matches=clauses.map(groups=>groups.every(group=>[...ids].some(id=>group.has(id))));return filter.mode==='all'?matches.every(Boolean):matches.some(Boolean);}).map(([id])=>id));
  }
  function filterSelectionKey(conceptId: string, contextId?: string) { return `${conceptId}\u0000${contextId || ''}`; }
  function isConceptSelected(conceptId: string, contextId?: string) { return conceptFilter.selections.some(selection => selection.conceptId === conceptId && selection.contextId === contextId); }
  function toggleConcept(conceptId: string, contextId?: string) {
    selectedSavedFilterId='';conceptFilter = { ...conceptFilter, selections: isConceptSelected(conceptId, contextId) ? conceptFilter.selections.filter(selection => selection.conceptId !== conceptId || selection.contextId !== contextId) : [...conceptFilter.selections, { conceptId, ...(contextId ? { contextId } : {}) }] };
    libraryPage = 0;
    render();
  }
  function searchable(paper: DisplayPaper) {
    const prior = searchCache.get(paper.id);
    if (prior && prior.title === paper.title && prior.abstract === paper.abstract && prior.summary === paper.summary && prior.keywords === paper.keywords) return prior.text;
    const text = `${paper.title} ${paper.abstract || ''} ${paper.summary || ''} ${(paper.keywords || []).join(' ')}`.toLocaleLowerCase();
    searchCache.set(paper.id, { title: paper.title, abstract: paper.abstract, summary: paper.summary, keywords: paper.keywords, text });
    return text;
  }
  function renderLibrary() {
    const s = currentState();
    const tags = approvedTags();
    const query = paperQuery.toLocaleLowerCase();
    const matches = remotePage()?undefined:matchingPaperIds(conceptFilter);
    const papers = remotePage()?s.papers:s.papers.filter(paper => matches!.has(paper.id) && (!query || searchable(paper).includes(query)));
    const total=pageTotal(papers.length);
    if(!remotePage())libraryPage = Math.min(libraryPage, Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
    const search = input('paper-search', paperQuery, value => { paperQuery = value; libraryPage = 0; render(); }, 'Search titles, abstracts, and summaries…', 'search');
    const focusResults = () => doc.getElementById('find-result-count')?.focus();
    listen(search,'keydown', event => { if (event.key === 'Enter') { event.preventDefault();focusResults(); } });
    const reset = button('Clear search', () => { selectedSavedFilterId='';paperQuery = '';conceptQuery = '';conceptFilter = { ...conceptFilter, selections: [] };libraryPage = 0;render();doc.getElementById('paper-search')?.focus(); }, 'quiet small');reset.id = 'reset-find-filters';
    const toolbar = h('form', 'find-search-form',field('Search papers',search),paperQuery || conceptQuery || conceptFilter.selections.length ? reset : null);
    toolbar.id = 'find-papers-form';toolbar.setAttribute('role','search');listen(toolbar,'submit',event => { event.preventDefault();focusResults(); });
    const filterContent = () => {
      const coreTags = tags;
      const relatedTags = tags.filter(tag => (tag.relatedIds || []).length > 0);
      const tagSearch = input('concept-search', conceptQuery, value => { conceptQuery = value; render(); }, 'Find a tag, abbreviation, other name, or meaning…', 'search');tagSearch.setAttribute('aria-label','Search tags');
      const filters = h('div', '', h('div', 'toolbar',tagSearch, select('concept-filter-mode', conceptFilter.mode, [['all', 'All · every selection'], ['any', 'Any · at least one selection']], value => { conceptFilter = { ...conceptFilter, mode: value }; libraryPage = 0; render(); }, 'Combine selected tags')));
      const counts = new Map<string, number>();
      const count = (conceptId: string, contextId?: string) => {
        const key = filterSelectionKey(conceptId, contextId);
        if (!counts.has(key)) counts.set(key, s.conceptCounts?.[key]??(remotePage()?tagById(conceptId)?.currentlyTaggedCount??0:matchingPaperIds({ mode: 'all', selections: [{ conceptId, ...(contextId ? { contextId } : {}) }] }).size));
        return counts.get(key)!;
      };
      const conceptQueryKey = conceptQuery.toLocaleLowerCase();
      const visible = (tag: DisplayTag) => !conceptQueryKey || conceptText(tag).includes(conceptQueryKey);
      const detailRow = (tag: DisplayTag, contextId?: string, location = 'global') => h('div', 'concept-tree-row detail-node', checkbox(`explore-detail-${encodeURIComponent(tag.id)}-${encodeURIComponent(contextId || 'global')}-${encodeURIComponent(location)}`, isConceptSelected(tag.id, contextId), conceptLabel(tag), () => toggleConcept(tag.id, contextId)), h('span', 'concept-count', String(count(tag.id, contextId))));
      const children = new Map<string, DisplayTag[]>();
      for (const tag of coreTags) for (const parent of tag.broaderIds) {
        if (!coreTags.some(other => other.id === parent)) continue;
        const group = children.get(parent) || []; group.push(tag); children.set(parent, group);
      }
      const associatedDetails = (id: string) => relatedTags.filter(tag => (tag.relatedIds || []).includes(id) || (tagById(id)?.relatedIds || []).includes(tag.id) || tag.broaderIds.includes(id));
      const treeVisible = (tag: DisplayTag) => visible(tag) || descendantIds(tag.id, tags).some(id => { const other = tagById(id); return other ? visible(other) || associatedDetails(id).some(visible) : false; });
      const renderNode = (tag: DisplayTag, path: Set<string>): Node => {
        if (path.has(tag.id)) return h('span');
        const nextPath = new Set([...path, tag.id]);
        const subtypes = (children.get(tag.id) || []).filter(treeVisible);
        const sharedDetails = associatedDetails(tag.id).filter(visible);
        const row = h('div', 'concept-tree-row', checkbox(`explore-core-${[...path, tag.id].join('-')}`, isConceptSelected(tag.id), conceptLabel(tag), () => toggleConcept(tag.id)), h('span', 'concept-count', String(count(tag.id))));
        row.title = tag.description;
        if (!subtypes.length && !sharedDetails.length) return h('div', 'concept-tree-node', row);
        const branch = h('details', 'concept-tree-branch', h('summary', '', h('span', 'branch-label', conceptLabel(tag)), h('span', 'concept-count', String(count(tag.id)))));
        branch.open = !!conceptQueryKey || expandedConcepts.has(tag.id);
        listen(branch,'toggle', event => { const current=event.currentTarget as HTMLDetailsElement;if (current.isConnected) { current.open ? expandedConcepts.add(tag.id) : expandedConcepts.delete(tag.id);ensureView(); } });
        const nested = h('div', 'concept-tree-children', row);
        for (const child of subtypes) nested.append(renderNode(child, nextPath));
        if (sharedDetails.length) {
          nested.append(h('p', 'context-caption', `Related tags · matched together with ${tag.name}`));
          for (const detail of sharedDetails.slice(0, 100)) nested.append(detailRow(detail, tag.id, [...nextPath].join('/')));
          if (sharedDetails.length > 100) nested.append(h('p', 'muted', 'Refine the tag search to see more topics.'));
        }
        branch.append(nested);
        return branch;
      };
      for (const facet of facets) {
        const grouped = coreTags.filter(tag => tag.facet === facet && !tag.broaderIds.some(id => coreTags.some(other => other.id === id)) && treeVisible(tag));
        if (!grouped.length) continue;
        filters.append(h('h3', 'facet-heading', facetNames[facet]));
        const tree = h('div', 'concept-tree');
        for (const tag of grouped) tree.append(renderNode(tag, new Set()));
        filters.append(tree);
      }
      if (!coreTags.length && !relatedTags.length) filters.append(empty('No tags ready yet', 'Build a tag list from your papers.'));
      const noTag = s.tags.find(tag => tag.builtin === 'no_tag');
      if (noTag) filters.append(h('div', 'section-gap', h('h3', '', 'Excluded from tagging'), h('div', 'concept-tree-row', checkbox('explore-builtin-no-tag', isConceptSelected(noTag.id), 'no_tag', () => toggleConcept(noTag.id)), h('span', 'concept-count', String(count(noTag.id))))));
      return h('div','find-tag-filter-body',h('p','card-description','A broader tag includes its narrower topics. A related tag chosen inside another tag requires both. Match all your selections or any selection.'),filters,button('Clear filters', () => { conceptFilter = { ...conceptFilter, selections: [] };conceptQuery = '';libraryPage = 0;render(); }, 'quiet small', !conceptFilter.selections.length && !conceptQuery));
    };
    const selections = h('div', 'selected-concepts');
    for (const selection of conceptFilter.selections) {
      const label = `${tagName(selection.conceptId)}${selection.contextId ? ` in ${tagName(selection.contextId)}` : ''}`;
      const remove = button('Remove', () => toggleConcept(selection.conceptId, selection.contextId), 'quiet small');remove.setAttribute('aria-label',`Remove ${label} filter`);
      selections.append(h('div', 'selected-concept', h('span', '', label),remove));
    }
    const filterPanel = details('Filter by tags',libraryFiltersOpen,value => { libraryFiltersOpen = value; },filterContent);
    filterPanel.id = 'find-tag-filters';filterPanel.classList.add('find-tag-filters');
    const countLabel = h('h2', '', `${total} ${total === 1 ? 'paper' : 'papers'}`);countLabel.id = 'find-result-count';countLabel.tabIndex = -1;countLabel.setAttribute('aria-live','polite');
    const saveSearch = conceptFilter.selections.length ? button('Save filter…', () => { modal = { kind: 'search' };searchName = conceptFilter.selections.map(selection => `${tagName(selection.conceptId)}${selection.contextId ? ` in ${tagName(selection.contextId)}` : ''}`).join(conceptFilter.mode === 'all' ? ' + ' : ' or ');render(); }) : null;
    const resultHeader = h('div','inline between find-result-header',countLabel,saveSearch);
    const list = h('section', 'paper-results');list.setAttribute('aria-label','Matching papers');
    if (!papers.length) list.append(empty('No papers match', (s.totals?.papers??s.papers.length) ? 'Try fewer tags or a broader search.' : 'Your papers will appear as the library is read.'));
    for (const paper of pageRows(papers,libraryPage,PAGE_SIZE)) {
      const chips = h('div', 'chips');
      for (const tagId of (paper.matchedTagIds || []).slice(0, 12)) chips.append(h('span', 'tag-chip', tagName(tagId)));
      const triggerId = `related-papers-${encodeURIComponent(paper.id)}`,panelId = `related-paper-results-${encodeURIComponent(paper.id)}`;
      const closeRelated = () => { selectedPaper = '';render();doc.getElementById(triggerId)?.focus(); };
      const trigger = button('Related papers', () => { selectedPaper = selectedPaper === paper.id ? '' : paper.id;render(); }, 'quiet small');trigger.id = triggerId;trigger.setAttribute('aria-label',`Related papers for ${paper.title}`);trigger.setAttribute('aria-expanded',String(selectedPaper === paper.id));trigger.setAttribute('aria-controls',panelId);
      const row = h('article', 'paper-card', paperButton(paper.id), paper.summary ? h('p', 'muted', paper.summary) : null, chips, paper.evidenceStatus ? h('p', 'muted', paper.evidenceStatus) : null, h('div', 'actions',trigger));
      row.setAttribute('data-ui-key',`paper:${paper.id}`);
      if (selectedPaper === paper.id) {
        const related = h('section','related-paper-results',h('div','inline between',h('h3','','Related papers'),button('Close related papers',closeRelated,'quiet small')),h('p','card-description','Content similarity suggests related reading, not citation relationships.'));
        related.id = panelId;related.setAttribute('aria-label',`Related papers for ${paper.title}`);
        const neighbors = s.neighbors[paper.id] || [];
        if (!neighbors.length) related.append(h('p','muted','More papers are needed to find related reading.'));
        for (const neighbor of neighbors.slice(0,10)) related.append(h('div','related-paper-row',paperButton(neighbor.paperId),h('span','muted',`Content similarity · ${Math.round(neighbor.score * 100)}%`)));
        listen(row,'keydown',event => { if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();closeRelated(); } });row.append(related);
      }
      list.append(row);
    }
    const saved=s.savedFilters??[],selected=saved.find(item=>item.id===selectedSavedFilterId);const savedControls=saved.length?h('div','inline saved-filter-controls',select('saved-filter',selectedSavedFilterId,[['','Saved filters'],...saved.map(item=>[item.id,item.name] as [string,string])],value=>{const item=saved.find(item=>item.id===value);selectedSavedFilterId=value;if(item){conceptFilter={mode:item.filter.mode,selections:item.filter.selections.map(selection=>({...selection}))};selectedPaper='';libraryPage=0;render();}},'Saved filters'),selected?button('Delete filter',async()=>{await run('delete-saved-filter',{id:selected.id},'Filter deleted.');selectedSavedFilterId='';render();},'quiet small'):null):null;
    return h('div', 'stack find-papers',toolbar,savedControls,filterPanel,conceptFilter.selections.length ? selections : null,resultHeader,list,hasPages(papers.length,PAGE_SIZE) ? pagination(papers.length, libraryPage, next => { libraryPage = next; }) : null);
  }

  function logicalRun(kind?:DisplayRun['kind']) {const s=currentState();if(s.run&&s.run.id===selectedLogicalRunId&&(!kind||s.run.kind===kind))return s.run;if(queuedRunReceipt&&queuedRunReceipt.id===selectedLogicalRunId&&(!kind||queuedRunReceipt.kind===kind))return queuedRunReceipt;return s.run&&(!kind||s.run.kind===kind)?s.run:s.runs?.find(item=>(!kind||item.kind===kind)&&(!selectedLogicalRunId||item.id===selectedLogicalRunId));}
  function runLabel(item:DisplayRun){return item.kind==='build'?'Build tags':'Assign tags';}
  function runPhase(item:DisplayRun){if(item.requiresChangeReview)return 'Replacement ready for review';const labels:Record<string,string>={queued:'Queued',preparing:'Preparing papers',reading:'Reading papers',building:'Building tags',checking:'Checking support',saving:'Saving results'};return item.status==='queued'?'Queued':item.status==='running'?labels[item.phase||'']||'Processing':item.status==='paused'?'Paused':item.status==='failed'?'Stopped by an error':item.status==='stopped'?'Stopped':'Completed';}
  function openRunResult(item:DisplayRun){selectedLogicalRunId=item.id;if(item.kind==='build')nav('cleanup');else{assignmentRunSelection=item.resultRunId||null;assignmentView='suggestions';nav('assignment');}}
  function runActions(item:DisplayRun,results=true){return h('div','inline',item.status==='running'?button('Pause',()=>run('pause-run',{id:item.id}),'small'):null,item.status==='paused'&&item.canRetry!==false||item.canRetry?button(item.status==='paused'?'Resume':'Retry',()=>run('retry-run',{id:item.id}),'primary small'):null,item.canStop||['queued','running','paused','failed'].includes(item.status)?button('Stop',()=>run('stop-run',{id:item.id}),'quiet small'):null,results&&(item.resultRunId||item.status==='completed')?button('View result',()=>openRunResult(item),'small'):null);}
  function runProgress(kind:DisplayRun['kind']):Node|null {
    const item=logicalRun(kind);if(!item||!['queued','running','paused','failed'].includes(item.status))return null;
    const progress=h('progress');if(item.paperCount>0){progress.max=item.paperCount;progress.value=Math.min(item.completedPaperCount,item.paperCount);}progress.setAttribute('aria-label',`${runLabel(item)} progress`);
    progress.setAttribute('max',String(Math.max(1,item.paperCount)));if(item.paperCount>0)progress.setAttribute('value',String(Math.min(item.completedPaperCount,item.paperCount)));const row=keyed(h('section','run-progress',h('div','inline between',h('div','',h('strong','',runPhase(item)),h('span','muted',item.paperCount?` · ${item.completedPaperCount} of ${item.paperCount} ${item.paperCount===1?'paper':'papers'}`:'')),runActions(item,false)),item.status==='failed'?h('p','card-description','This run stopped before it could finish. Retry it or stop this attempt.'):item.message?h('p','card-description',humanMessage(item.message)):null,progress),`run-progress:${item.id}`);row.id='current-run-progress';row.setAttribute('role','status');return row;
  }
  function renderActivity(){
    const s=currentState(),runs=s.runs??(s.run?[s.run]:[]),list=h('section','runs-list');
    for(const item of runs){const outcomes=item.requiresChangeReview?'Review this replacement before changing your active tag list.':item.kind==='build'?buildCounts(item.newCount??0,item.reusedCount,item.skippedCount,item.unavailableCount):`${item.appliedCount??0} tag changes applied · ${item.choiceCount??0} choices waiting`,date=item.createdAt?new Date(item.createdAt).toLocaleString():'';
      const more=details('Details',runDetailsOpen.has(item.id),open=>{open?runDetailsOpen.add(item.id):runDetailsOpen.delete(item.id);},()=>h('div','run-diagnostics',h('p','card-description',`${item.attemptCount??1} ${(item.attemptCount??1)===1?'attempt':'attempts'}`),item.message?h('p','',item.message):null,item.error?h('pre','',item.error):null));
      list.append(keyed(h('article','run-row',h('div','inline between',h('div','',h('h2','',runLabel(item)),h('p','card-description',[date,`${item.completedPaperCount} of ${item.paperCount} ${item.paperCount===1?'paper':'papers'}`].filter(Boolean).join(' · '))),badge(runPhase(item))),h('p','',outcomes),item.status==='failed'?h('p','card-description','This run stopped before it could finish. Completed results are kept.'):null,runActions(item),more),`run:${item.id}`));}
    if(!runs.length)list.append(empty('No runs yet','Build tags from a few papers, then assign them when you are ready.',button('Build tags',()=>nav('cleanup'),'primary')));if(hasPages(runs.length,PAGE_SIZE,'runs'))list.append(pagination(runs.length,runsPage,next=>{runsPage=next;},PAGE_SIZE,'runs'));
    const history=details('Recent changes and Undo',activityHistoryOpen,value=>{activityHistoryOpen=value;},()=>{const body=h('div','stack',input('history-search',activityHistoryQuery,value=>{activityHistoryQuery=value;activityHistoryPage=0;render();},'Find a change…','search'));if(s.transitionSummary){const transition=s.transitionSummary,event=keyed(h('p','card-description',`AI-only tagging · ${transition.keptDefinitions} kept · ${transition.retiredDefinitions} archived. Zotero labels were kept.`),'workflow-transition');event.id='workflow-transition-history';body.append(event);}for(const record of s.history)body.append(keyed(h('div','inline between',h('div','',h('strong','',record.label),h('p','card-description',`${formatDate(record.date)} · ${record.count} items`)),button('Undo',()=>run('undo',{id:record.id},'Change undone. Later edits are preserved.'),'small',!record.canUndo)),`history:${record.id}`));if(!s.history.length&&!s.transitionSummary)body.append(h('p','muted','No recent changes. Undo is kept for seven days.'));const total=s.totals?.history??s.history.length;if(total>25)body.append(h('div','inline between',h('span','muted',`Page ${activityHistoryPage+1}`),h('div','inline',button('Previous changes',()=>{activityHistoryPage--;render();},'small',activityHistoryPage===0),button('Next changes',()=>{activityHistoryPage++;render();},'small',(activityHistoryPage+1)*25>=total))));body.append(warningHistory());return body;});history.id='activity-history';
    const requests=(s.recoveryRequests??[]).map(request=>{
      const stopped=request.status==='stopped';
      const retry=async()=>{const result=await run('retry-unknown-request',{id:request.id});notify(stopped||result?.startNewRun?'Retry allowed. Start a new build or assignment.':'Retry authorized. Resuming saved work.');};
      return keyed(h('article','recovery-request',h('h3','',stopped?'AI request stopped':'AI request interrupted'),h('p','',request.message),stopped?h('p','card-description','Allow another attempt, then start a new build or assignment.'):null,h('p','card-description',stopped?'The provider may already have charged for the original request. A new attempt can create another charge.':'The provider may already have charged for this request. Retry only if you want to send it again.'),h('div','actions',button(stopped?'Allow a new attempt':'Retry request',retry,'primary small'),!stopped?button('Stop this attempt',()=>run('stop-unknown-request',{id:request.id},'Attempt stopped.'),'quiet small'):null)),`request-recovery:${request.id}`);
    });
    const paperInfo=details('Paper information',activityPaperInfoOpen,value=>{activityPaperInfoOpen=value;},paperAttention);paperInfo.id='activity-paper-information';const active=(s.warnings??[]).filter(warning=>warning.status==='active'&&!warning.legacy&&!['evidence-gap','unapproved-topics'].includes(warning.code));const notices=active.length?details(`Notices (${active.length})`,runNoticesOpen,value=>{runNoticesOpen=value;},()=>h('div','stack',button('Dismiss all',()=>run('dismiss-warnings',undefined,'Notices dismissed.'),'quiet small'),...active.map(warning=>warningEntry(warning,true)))):null;const hasProblems=s.paperAttention?.papers.some(paper=>paper.status==='failed'||paper.status==='needsInformation');const recovery=h('section','activity-recovery',h('h2','','Recovery'),...requests,notices,hasProblems?paperAttention():paperInfo,paperExclusionReview(),metadataReview());recovery.id='activity-recovery';return h('div','stack runs-page',list,reviewInbox(s.reviewItems??[]),recovery,history);
  }

  function renderSettings(connectionOnly = false) {
    const s = currentState();
    const draft = settingsDraft || { ...s.settings };
    settingsDraft = draft;
    const mark = <K extends keyof ManagerSettings>(key: K, value: ManagerSettings[K]) => {
      const wasDirty = settingsDirty, hadError = settingsValidation?.key === key;
      draft[key] = value;settingsDirty = true;if (hadError) settingsValidation = null;
      if (!wasDirty || hadError) render();
    };
    const providerName = draft.provider === 'deepseek' ? 'DeepSeek' : draft.provider === 'api' ? 'OpenAI' : 'ChatGPT';
    const availableModels = draft.provider === s.settings.provider ? s.models : [];
    const connection = h('div', '',
      field('AI connection', select('settings-provider', draft.provider, [['chatgpt', 'ChatGPT plan · Continue with ChatGPT'], ['api', 'OpenAI API key · separately billed'], ['deepseek', 'DeepSeek API key · separately billed']], value => {
        if (value === draft.provider) return;
        mark('provider', value);
        mark('model', '');
        mark('inputPricePerMillion', 0);
        mark('outputPricePerMillion', 0);
        customModelInput = null;
        render();
      }), 'Connection changes take effect when you save settings. There is no automatic paid fallback.'));
    connection.append(h('p', 'card-description', `Analysis sends selected paper metadata and, when needed, PDF text to ${providerName}.`));
    if (draft.provider === 'chatgpt') {
      const startSignIn = async (newAccount = false) => {
        await saveSettings();
        signingIn = true;
        try { await run('sign-in', newAccount ? { newAccount: true } : undefined, 'ChatGPT sign-in complete. Discover models and test the connection.'); }
        finally { signingIn = false; render(); }
      };
      connection.append(h('div', 'notice', h('strong', '', s.connection.chatgptSignedIn ? s.connection.accountLabel || 'ChatGPT account connected' : 'Use an eligible ChatGPT plan'), h('p', '', 'Sign-in requests permission to use your plan for AI analysis. Availability and limits depend on your account.')),
        h('div', 'actions', button('Continue with ChatGPT', () => startSignIn(), 'primary'), button('Use another account or workspace', () => startSignIn(true)), button('Sign out', () => run('sign-out', undefined, 'ChatGPT account disconnected.'), '', !s.connection.chatgptSignedIn)),
        h('p', 'card-description', 'If OpenAI shows a workspace error, cancel the current attempt, then use “Use another account or workspace” and select your personal Pro workspace.'));
      if (s.connection.accounts && s.connection.accounts.length > 1) connection.append(h('div', 'section-gap', field('ChatGPT account', select('settings-chatgpt-account', s.connection.selectedAccountId || s.connection.accounts[0].id, s.connection.accounts.map(account => [account.id, account.label]), value => { void run('select-account', { id: value }, 'ChatGPT account selected.').catch(showError); }))));
    } else {
      const keyProvider = draft.provider;
      const hasKey = keyProvider === 'deepseek' ? s.connection.deepseekKeyStored === true : s.connection.apiKeyStored;
      const secret = input(keyProvider === 'deepseek' ? 'settings-deepseek-key' : 'settings-api-key', apiKeyDrafts[keyProvider], value => { apiKeyDrafts[keyProvider] = value; }, hasKey ? `A ${providerName} key is saved. Enter a new key to replace it.` : `Paste your ${providerName} API key`, 'password');
      secret.autocomplete = 'off';
      secret.setAttribute('spellcheck', 'false');
      connection.append(field(`${providerName} API key`, secret, 'Each provider’s key is saved separately and encrypted. Keys are hidden from this window and exported tags.'), h('div', 'actions', button(`Save ${providerName} key`, async () => {
        const key = apiKeyDrafts[keyProvider].trim();
        if (!key) throw new Error(`Enter a ${providerName} API key first.`);
        await run('save-api-key', { key, provider: keyProvider }, `${providerName} API key saved.`);
        apiKeyDrafts[keyProvider] = '';
        render();
      }, 'primary'), button(`Remove ${providerName} key`, () => run('remove-api-key', { provider: keyProvider }, `Saved ${providerName} API key removed.`), 'danger', !hasKey)));
    }
    connection.append(h('div', 'divider'));
    const customModel = customModelInput ?? (!!draft.model && !availableModels.includes(draft.model));
    if (!availableModels.length || customModel) {
      const modelInput = input('settings-model', draft.model, value => { mark('model', value);render(); }, `Enter a model ID available through ${providerName}`);
      connection.append(field('Model',modelInput));if (availableModels.length) connection.append(button('Choose discovered model',() => { customModelInput = false;render(); },'quiet small'));
    } else connection.append(field('Model', select('settings-discovered-model', availableModels.includes(draft.model) ? draft.model : '', [
      ...(!availableModels.includes(draft.model) ? [['', 'Choose a model'] as [string, string]] : []),
      ...availableModels.map(model => [model, model] as [string, string]),['__custom-model__','Enter model ID…'],
    ], value => { if (value === '__custom-model__') { customModelInput = true;render();doc.getElementById('settings-model')?.focus(); }else if (value) { mark('model', value);customModelInput = false;render(); } })));
    connection.append(
      h('div', 'task-actions', button('Discover models', async () => { if (settingsDirty) await saveSettings();await run('discover-models', undefined, `${providerName} model list updated.`); }), button(settingsDirty ? 'Save and test' : 'Test connection', async () => { if (settingsDirty) await saveSettings();await run('test-connection', undefined, `${providerName} connection test succeeded.`); }, 'primary', !draft.model.trim())),
      h('p', 'card-description', 'Testing sends a small AI request through the selected connection.'));
    if (s.connection.credentialStorage) connection.append(h('p', 'card-description', `Credential storage: ${s.connection.credentialStorage}`));
    const numberField = (key: 'budgetUSD' | 'inputPricePerMillion' | 'outputPricePerMillion' | 'maxOutputTokens' | 'coreConceptLimit' | 'extensionTagTarget', label: string, note: string, step: string) => {
      const control = input(`settings-${key}`, String(draft[key] ?? (key === 'extensionTagTarget' ? 30 : 60)), value => { const n = Number(value); if (Number.isFinite(n)) mark(key, n); }, '', 'number');
      control.min = key === 'maxOutputTokens' || key === 'coreConceptLimit' || key === 'extensionTagTarget' ? '1' : '0'; control.step = step;
      if (key === 'coreConceptLimit' || key === 'extensionTagTarget') control.max = '500';
      const error = settingsValidation?.key === key ? settingsValidation.message : '';
      if (error) { control.setAttribute('aria-invalid','true');control.setAttribute('aria-describedby',`settings-${key}-error`); }
      const row = field(label, control, note);
      if (error) { const message = h('p','field-error',error);message.id = `settings-${key}-error`;row.append(message); }
      return row;
    };
    const budgets = h('div', '',
      h('div', 'notice', 'Budget controls apply to the selected API provider. Set its published model rates before analysis; cost estimates use those rates. Model discovery is available while rates are unset.'),
      h('div', 'section-gap', numberField('budgetUSD', 'Per-run API budget · USD', 'The queue pauses before dispatching requests that would exceed its remaining estimate.', '0.01')),
      h('div', 'field-grid', numberField('inputPricePerMillion', 'Input · USD / million tokens', 'Use the standard input rate.', '0.001'), numberField('outputPricePerMillion', 'Output · USD / million tokens', 'Use the standard output rate.', '0.001')),
      h('div', 'section-gap', numberField('maxOutputTokens', 'API output-token limit', 'This request limit is used for API-key requests.', '1')));
    const vocabulary = h('div', 'field-grid', numberField('coreConceptLimit', 'Maximum tags for an initial build', 'An upper limit, not a quota. Compact vocabularies keep supported, distinct topics.', '1'), numberField('extensionTagTarget', 'Maximum new tags per build', 'Extensions keep saved definitions and add up to this many supported topics.', '1'));
    const transfers = details('Export and previous builds',settingsTransfersOpen,value => { settingsTransfersOpen = value; },() => h('div','',button('Export tags…',()=>run('export-vocabulary')),s.tagPreparation?h('div','section-gap',button('Export analysis with paper text…',()=>run('export-tag-analysis',{id:s.tagPreparation!.id})),h('p','card-description','This private export includes paper text and quotations.')):null,...(s.taxonomyArchives||[]).map(archive=>h('p','card-description section-gap',`${formatDate(archive.date)} · ${archive.count} tags`))));
    const integrationStatus = h('div', '', h('p', '', s.pluginVersion ? `Installed version ${s.pluginVersion}` : 'Version information is available when opened in Zotero.'), h('div', 'actions', button('Check for updates', () => run('check-plugin-updates'))), h('p', 'card-description', 'Updates are managed by Zotero’s Plugins window. Your library and saved settings stay in place.'));
    const saveButton = h('button',connectionOnly ? 'quiet' : 'primary','Save settings');saveButton.type = 'submit';saveButton.id = 'save-settings';saveButton.disabled = busy;
    const discard = button('Discard changes',() => { settingsDraft = { ...currentState().settings };settingsDirty = false;settingsValidation = null;customModelInput = null;render();doc.getElementById(connectionOnly ? 'settings-provider' : 'details-tag-limits')?.focus(); },'quiet');discard.id = 'discard-settings-changes';
    const dirty = h('span','muted','Unsaved changes');dirty.setAttribute('role','status');
    const save = settingsDirty ? h('div','settings-save-bar',dirty,h('div','inline',discard,saveButton)) : null;
    const form = h('form',connectionOnly ? 'connection-form' : 'settings-form');form.id = 'settings-form';form.noValidate = true;
    const feedback = h('div','settings-feedback');feedback.id = 'settings-feedback';
    const submit = () => { if (!busy && settingsDirty) void saveSettings().catch(showError); };
    listen(form,'submit',event => { event.preventDefault();submit(); });
    listen(form,'keydown',event => { if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') { event.preventDefault();submit(); } });
    if (connectionOnly) { form.append(h('section','task-setup',connection));if (draft.provider !== 'chatgpt') form.append(h('section','task-setup',h('h2','',`${providerName} API budget`),budgets));form.append(feedback);if (save) form.append(save);if (canAnalyze() && !settingsDirty) form.append(h('div', 'task-actions', button('Continue to Build tags', () => nav('build'))));return form; }
    const savedProviderName = s.settings.provider === 'deepseek' ? 'DeepSeek' : s.settings.provider === 'api' ? 'OpenAI' : 'ChatGPT';
    const connectionSummary = h('section','settings-row',h('div','',h('h2','','AI connection'),h('p','card-description',`${savedProviderName} · ${s.settings.model || 'Choose a model'}`),h('p','card-description',connectionReady(s) ? 'Connected' : 'Connection needed')),button('AI connection and budget',() => nav('connection'),connectionReady(s) ? '' : 'primary'));
    const incoming = h('section','settings-row',h('div','',h('h2','','New papers'),h('p','card-description',s.settings.autoAssign ? 'Automatic tagging is on.' : 'Automatic tagging is off.')),button('Routine assignment',() => { assignmentView = 'setup';nav('assignment'); }));
    const tags = details('Tag limits',settingsTagsOpen,value => { settingsTagsOpen = value; },() => vocabulary);tags.id = 'settings-tags';
    const integration = details('Zotero integration',settingsIntegrationOpen,value => { settingsIntegrationOpen = value; },() => integrationStatus);integration.id = 'settings-integration';
    const storage=s.storage;
    const sizes=storage?h('div','section-gap',storage.databaseBytes!==undefined?h('div','inline between',h('strong','','Database on disk'),h('strong','',formatBytes(storage.databaseBytes))):null,h('p','card-description','The categories below describe the content before sharing and compression. Shared content appears in each category that uses it.'),...([['Active data',storage.activeBytes],['Recent history and Undo',storage.historyBytes],['Unused AI results',storage.cacheBytes],['Separate migration backup',storage.backupBytes]] as const).map(([label,bytes])=>h('div','inline between',h('span','',label),h('span','muted',formatBytes(bytes)))),h('p','card-description',`Completed history and Undo expire after ${storage.retentionDays} days. Unused AI results expire ${storage.retentionDays} days after their last reuse. Saved meanings, supporting evidence and unfinished work are kept.`),storage.backupBytes?h('p','card-description','The migration backup is removed after seven days and two successful restarts, once recovery is complete.'):null):null;
    const data = details('Data',dataDetailsOpen,value => { dataDetailsOpen = value; },() => h('div','',sizes,h('div','actions section-gap',storage?button('Clean up expired data',()=>run('clean-expired-data',undefined,'Cleaning up expired data. Saved meanings and unfinished work are kept.'),'quiet'):button('Clean up old processing history…',async () => {
      const summary = await run('inspect-old-processing-history');
      if (!summary) return;
      if (!summary.records) { await run('clean-old-processing-history', { expectEmpty: true }, 'History is already clean. Future history stays compact.');return; }
      modal = { kind: 'cleanup-history',records: summary.records,bytes: summary.bytes };render();
    },'quiet'),button('Reset paper analysis…',() => { modal = { kind: 'reset-analysis' };render(); },'quiet'))));data.id = 'settings-data';
    form.append(connectionSummary,incoming,tags,integration,transfers,data,feedback);if (save) form.append(save);return form;
  }
  async function saveSettings() {
    if (!settingsDraft) return;
    const invalid = (key: keyof ManagerSettings,message: string): never => { settingsValidation = { key,message };if (key === 'coreConceptLimit' || key === 'extensionTagTarget') settingsTagsOpen = true;else page = 'connection';render();doc.getElementById(`settings-${key}`)?.focus();throw new Error(message); };
    if (!Number.isInteger(settingsDraft.coreConceptLimit ?? 60) || (settingsDraft.coreConceptLimit ?? 60) < 1 || (settingsDraft.coreConceptLimit ?? 60) > 500) invalid('coreConceptLimit','Set the initial tag limit to a whole number from 1 to 500.');
    if (!Number.isInteger(settingsDraft.extensionTagTarget ?? 30) || (settingsDraft.extensionTagTarget ?? 30) < 1 || (settingsDraft.extensionTagTarget ?? 30) > 500) invalid('extensionTagTarget','Set the new-tag limit to a whole number from 1 to 500.');
    if (settingsDraft.provider !== 'chatgpt') {
      if (settingsDraft.budgetUSD <= 0) invalid('budgetUSD','Set an API budget greater than zero.');
      if (settingsDraft.inputPricePerMillion < 0) invalid('inputPricePerMillion','Set an input model rate of zero or greater.');
      if (settingsDraft.outputPricePerMillion < 0) invalid('outputPricePerMillion','Set an output model rate of zero or greater.');
      if (settingsDraft.maxOutputTokens < 1) invalid('maxOutputTokens','Set an API output-token limit of at least 1.');
    }
    const result = await run('save-settings', { settings: { ...settingsDraft, autoAssign: currentState().settings.autoAssign } }, 'Settings saved.');
    settingsDirty = false;
    settingsValidation = null;
    settingsDraft = { ...currentState().settings };
    render();
    return result;
  }

  function renderModal() {
    if (!modal) return null;
    const active = modal;
    const body = h('div', 'modal-scroll');
    let title = '';
    let applyLabel = '';
    let applyDisabled = false;
    let apply: () => Promise<unknown>;
    if (active.kind === 'apply' || active.kind === 'finish') {
      const ids = new Set(active.ids);
      const suggestions = currentState().suggestions.filter(item => ids.has(item.id));
      modalPage = Math.min(modalPage, Math.max(0, Math.ceil(suggestions.length / PAGE_SIZE) - 1));
      title = 'Review paper tag changes';
      applyLabel = active.kind === 'finish' ? 'Apply and finish' : `Apply ${suggestions.length} tag changes`;
      body.append(h('p', '', 'Review the additions and removals below. Removals apply only to obsolete tags owned by Smart Tags. Existing manual tags are preserved. Stale proposals are checked again before writing.'));
      if (suggestions.some(item => tagById(item.tagId)?.builtin === 'no_tag')) body.append(h('p', 'notice', 'Applying no_tag excludes the affected papers from future tagging. Their other tags stay in place.'));
      const table = h('table', 'section-gap', h('thead', '', h('tr', '', h('th', '', 'Paper'), h('th', '', 'Change'), h('th', '', 'Tag'), h('th', '', 'Evidence'))));
      const tbody = h('tbody');
      for (const item of suggestions.slice(modalPage * PAGE_SIZE, (modalPage + 1) * PAGE_SIZE)) tbody.append(h('tr', '', h('td', '', paperTitle(item.paperId)), h('td', '', badge(item.operation === 'remove' ? 'Remove' : 'Add', item.operation === 'remove' ? 'removal' : 'approved')), h('td', '', h('strong', '', tagName(item.tagId))), h('td', '', item.evidence[0]?.text || 'Review manually')));
      table.append(tbody); body.append(h('div', 'table-wrap', table), pagination(suggestions.length, modalPage, next => { modalPage = next; }));
      apply = async () => { await run(active.kind === 'finish' ? 'finish-assignment' : 'apply-suggestions', active.kind === 'finish' ? { runId: active.runId, ...(active.acceptRemaining ? { acceptRemaining: true } : {}) } : { ids: active.ids }, active.kind === 'finish' ? 'Assignment finished.' : 'Reviewed tag assignments applied.'); selectedSuggestions.clear(); modal = null; render(); };

    } else if (active.kind === 'cleanup-history') {
      title = 'Clean up old processing history?';
      applyLabel = 'Clean up history';
      const size = active.bytes < 1_000_000 ? `${Math.max(1,Math.round(active.bytes / 1000))} KB` : `${(active.bytes / 1_000_000).toFixed(1)} MB`;
      body.append(h('p', '', `${active.records} ${active.records === 1 ? 'record' : 'records'} · about ${size} of saved data.`),h('p', 'section-gap', 'Permanently remove obsolete analysis, vocabulary and tag-comparison audit copies, superseded paper facts, and duplicate meaning checkpoints.'),h('p', 'section-gap', 'Current paper analysis, saved tags, unfinished reviews, reusable vocabulary progress, and Undo records stay in place.'),h('p', 'section-gap', 'Future saves will also stop accumulating these obsolete copies.'));
      apply = async () => { await run('clean-old-processing-history', undefined, 'Old processing history removed. Future history stays compact.');modal = null;render(); };
    } else if (active.kind === 'reset-analysis') {
      title = 'Reset paper analysis?';
      applyLabel = 'Reset paper analysis';
      body.append(h('p', '', 'This clears reusable paper analyses and paper-tag suggestions. Your Zotero items, PDFs, paper tags, saved tag definitions, credentials, spending records, and Undo history stay in place.'), h('p', 'section-gap', 'The next build will read the papers afresh.'));
      apply = async () => { await run('reset-paper-analysis', undefined, 'Paper analysis reset. The next build will start fresh.');modal = null;render(); };
    } else {
      title = 'Save filter';
      applyLabel = 'Save filter';
      body.append(h('p', '', 'Save this combination of AI tags for later. The filter uses verified assignments and stays in Smart Tags.'), h('div', 'section-gap', field('Filter name', input('saved-search-name', searchName, value => { searchName = value; }))), h('div', 'chips', ...conceptFilter.selections.map(selection => h('span', 'tag-chip', `${tagName(selection.conceptId)}${selection.contextId ? ` in ${tagName(selection.contextId)}` : ''}`))));
      apply = async () => { if (!searchName.trim()) throw new Error('Enter a name for this filter.'); await run('save-search', { name: searchName.trim(), filter: { mode: conceptFilter.mode, selections: conceptFilter.selections.map(selection => ({ ...selection })) } }, 'Filter saved.'); modal = null; render(); };
    }
    const close = () => { modal = null; render(); };
    const content = h('section', 'modal', h('div', 'card-header', h('h2', '', title), button('Close', close, 'quiet small')), body, h('div', 'card-footer', button(applyLabel, apply, 'primary', applyDisabled), button('Cancel', close)));
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-modal', 'true');
    content.setAttribute('aria-label', title);
    listen(content,'keydown', event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const focusable = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (first && last && event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (first && last && !event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    return h('div', 'modal-backdrop', content);
  }

  function renderContent() {
    const priorProposalRows = doc.getElementById('tag-list-scroll');
    const priorProposalKey = priorProposalRows?.getAttribute('data-view-key');
    if (priorProposalRows && priorProposalKey) tagScrollPositions.set(priorProposalKey, priorProposalRows.scrollTop);
    const priorEditor = doc.getElementById('tag-editor-form'), priorEditorKey = priorEditor?.getAttribute('data-view-key');
    if (priorEditor && priorEditorKey) editorScrollPositions.set(priorEditorKey,priorEditor.scrollTop);
    if (disposed) return;
    const focused = doc.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const focusId = focused?.id;
    const selectionStart = focused && 'selectionStart' in focused ? focused.selectionStart : null;
    const selectionEnd = focused && 'selectionEnd' in focused ? focused.selectionEnd : null;
    const scrollY = win.scrollY;
    if (!state) {
      if (toastError) {
        app!.setAttribute('data-smart-tags-state', 'error');
        app!.replaceChildren(h('div', 'boot-message', h('strong', '', 'Smart Tags could not load local settings'), h('p', '', toast), button('Retry loading', () => refresh())));
      } else {
        const box=h('div','boot-message',toast||loadingMessage||'Opening Smart Tags…');
        if(loadingProgress){const meter=h('progress');if(loadingProgress.total>0){meter.max=loadingProgress.total;meter.value=Math.min(meter.max,loadingProgress.completed);}box.append(h('p','muted',loadingProgress.label),meter);}
        app!.replaceChildren(box);
      }
      return;
    }
    const s = state;
    const sidebar = h('aside', 'sidebar', h('div', 'brand', h('span', 'brand-mark', icon('vocabulary')), h('div', '', h('strong', '', 'ZTagging'), h('small', '', 'Personal library'))));
    const navigation = h('nav', 'nav');navigation.setAttribute('aria-label', 'Library pages');
    const workflow = h('nav', 'nav workflow-nav');workflow.setAttribute('aria-label', 'Workflow steps');
    const utilities = h('nav', 'nav');
    utilities.setAttribute('aria-label', 'Library tools');
    const activePage = page === 'existing-tags' ? 'vocabulary' : page === 'review' ? 'assignment' : page === 'build' ? 'cleanup' : page === 'connection' ? 'settings' : page;
    const addNavigation = (container: HTMLElement, target: ManagerPage, count?: number, step?: number) => {
      const navButton = button('', () => nav(target), `nav-button ${activePage === target ? 'active' : ''}`);
      navButton.id = `nav-${target}`;
      navButton.setAttribute('aria-label', pageNames[target]);
      navButton.disabled = false;
      navButton.append(step ? h('span', 'nav-step-number', String(step)) : h('span', 'nav-icon', icon(target)), h('span', '', pageNames[target]));
      if (count !== undefined && count > 0) navButton.append(h('span', 'nav-count', count.toLocaleString()));
      if (activePage === target) navButton.setAttribute('aria-current', 'page');container.append(navButton);
    };
    (['cleanup', 'vocabulary', 'assignment'] as const).forEach(target => addNavigation(workflow, target, target === 'vocabulary' ? s.totals?.tags??s.tagLibraryEntries?.length??approvedTags().length : undefined));
    addNavigation(navigation, 'library');
    addNavigation(utilities, 'activity',s.totals?.openChoices??s.reviewItems?.filter(item => item.state === 'open').length);addNavigation(utilities, 'settings');
    const connected = connectionReady(s);
    const connectionLabel = s.settings.provider === 'deepseek' ? 'DeepSeek API connected' : s.settings.provider === 'api' ? 'OpenAI API connected' : 'ChatGPT connected';
    sidebar.append(h('div', '', h('div', 'sidebar-section-label', 'Workflow'), workflow), h('div', '', h('div', 'sidebar-section-label', 'Library'), navigation), h('div', 'sidebar-utilities', h('div', 'sidebar-section-label', 'Tools'), utilities), h('div', 'sidebar-footer', h('p', '', connected ? h('span', 'status-dot') : null, connected ? connectionLabel : 'Connection needed'), h('p', '', 'Stored on this computer')));
    const home = button('Personal library', () => nav('overview'), 'breadcrumb-home');
    home.id = 'workspace-home';
    home.disabled = false;
    const breadcrumbs = h('nav', 'breadcrumbs', home, h('span', 'breadcrumb-divider', '/'), h('span', 'breadcrumb-current', pageNames[page]));
    breadcrumbs.setAttribute('aria-label', 'Breadcrumb');
    const currentCrumb = breadcrumbs.lastElementChild;
    currentCrumb?.setAttribute('aria-current', 'page');
    const topbar = h('div', 'workspace-topbar', breadcrumbs, h('div', 'header-status', busy ? h('span', 'busy-indicator', 'Working…') : s.settings.autoAssign ? 'New papers: automatic tagging on' : 'New papers: automatic tagging off'));
    const workspace = h('main', `workspace ${page === 'vocabulary' || page === 'cleanup' ? 'tag-workspace-page' : ''}`, h('header', 'page-header',h('h1', '', pageTitles[page][0]),page === 'vocabulary' ? null : h('p', 'subtitle', pageTitles[page][1])));
    const indexing=s.libraryIndexProgress;
    if(indexing&&indexing.phase!=='completed'&&['library','vocabulary','activity'].includes(page)){const progress=h('div','notice info inline between',h('span','',indexing.error?'Library reading paused. Your saved work is kept.':`Reading your library · ${indexing.checked.toLocaleString()} of ${indexing.total.toLocaleString()} papers`),indexing.error?button('Retry library reading',()=>run('refresh-library-index',undefined,'Reading your library.'),'small'):null);progress.id='library-index-progress';progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');workspace.append(progress);}
    if (signingIn) {
      const cancel = button('Cancel sign-in', async () => { await invoke('cancel-sign-in'); }, 'small');
      cancel.disabled = false;
      workspace.append(h('div', 'notice info inline between', h('span', '', 'Complete sign-in in your browser, or cancel this attempt.'), cancel));
    }
    const warnings = page === 'activity' ? null : activeWarnings();
    if (warnings) workspace.append(warnings);
    const renderers: Record<ManagerPage, () => Node> = {
      overview: renderOverview,
      connection: () => renderSettings(true),
      build: renderCleanup,
      cleanup: renderCleanup,
      assignment: renderAssignment,
      vocabulary: renderVocabulary,
      'existing-tags': renderVocabulary,
      review: renderAssignment,
      library: renderLibrary,
      activity: renderActivity,
      settings: renderSettings,
    };
    const pageBody=renderers[page]();if(pageBody.nodeType===1)(pageBody as HTMLElement).setAttribute('data-ui-key',`page:${page}`);workspace.append(pageBody);
    if(page === 'vocabulary') {
      const header=workspace.querySelector('.page-header'),overview=workspace.querySelector('.library-overview');
      if(header && overview){header.classList.add('library-page-header');header.append(overview);}
    }
    const shell = h('div', 'shell', sidebar, h('div', 'workspace-frame', topbar, workspace));
    if (toast) {
      const toastElement = h('div', `toast ${toastError ? 'error' : ''}`, toast);
      toastElement.setAttribute('role', toastError ? 'alert' : 'status');
      const feedback = workspace.querySelector('#settings-feedback');
      if (feedback) feedback.append(toastElement);else shell.append(toastElement);
    }
    const modalElement = renderModal();
    if (modalElement) shell.append(modalElement);
    shell.id='smart-tags-shell';patchRoot(shell);
    updateTagApplyState();
    const proposalRows = doc.getElementById('tag-list-scroll');
    const editor = doc.getElementById('tag-editor-form');
    app!.setAttribute('data-smart-tags-state', 'ready');
    if (focusId) {
      const restored = doc.getElementById(focusId) as HTMLInputElement | HTMLTextAreaElement | null;
      if (restored) {
        restored.focus({ preventScroll: true });
        if (selectionStart !== null && selectionEnd !== null && typeof restored.setSelectionRange === 'function' && !['number', 'checkbox'].includes(restored.type)) {
          try { restored.setSelectionRange(selectionStart, selectionEnd); } catch { /* Not all input types support selection. */ }
        }
      }
    }
    if (pendingEditorFocus) {
      const target = doc.getElementById(pendingEditorFocus) || doc.getElementById('vocabulary-search');pendingEditorFocus = '';target?.focus({preventScroll:true});
    }
    if (modalElement && !modalElement.contains(doc.activeElement)) {
      const first = modalElement.querySelector<HTMLElement>(modal?.kind === 'search' ? '#saved-search-name' : 'button:not(:disabled)');
      first?.focus({ preventScroll: true });
    }
    win.scrollTo(0, scrollY);
    fitTagWorkspace();
    if (proposalRows) proposalRows.scrollTop = tagScrollPositions.get(proposalRows.getAttribute('data-view-key') || '') || 0;
    if (editor) editor.scrollTop = editorScrollPositions.get(editor.getAttribute('data-view-key') || '') || 0;
  }
  function render(preserveMenu=false) {
    ensureView();
    if(!preserveMenu)closeActionMenu?.();
    try { renderContent(); }
    catch (error) {
      closeActionMenu?.();
      cleanupDropdowns(doc);
      diagnostic(`render failed: ${error instanceof Error ? error.message : String(error)}`);
      try {
        app!.setAttribute('data-smart-tags-state', 'error');
        const retry = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button');
        retry.textContent = 'Retry loading';
        listen(retry,'click', () => { void refresh(); });
        const details = doc.createElementNS('http://www.w3.org/1999/xhtml', 'p');
        details.textContent = `${error instanceof Error ? error.message : String(error)} Close and reopen Smart Tags if retry does not help. Details are logged in Zotero’s Error Console.`;
        app!.replaceChildren(h('div', 'boot-message', h('strong', '', 'Smart Tags could not render'), details, retry));
      } catch { app!.textContent = 'Smart Tags could not render. Close this window and reopen it from Zotero’s Tools menu.'; }
    }
  }
  function fitTagWorkspace() {
    const editor = doc.querySelector<HTMLElement>('.tag-editor');
    if (editor) {
      const top = doc.querySelector<HTMLElement>('.tag-workspace-columns')?.getBoundingClientRect().top ?? editor.getBoundingClientRect().top;
      const available = win.innerHeight - Math.max(16, top) - 16;
      const drawer = win.innerWidth <= 900 || win.innerHeight <= 600 || available < 420;
      if (drawer) editor.classList.add('editor-drawer');else editor.classList.remove('editor-drawer');
      editor.style.height = drawer ? '' : `${available}px`;
      editor.style.maxHeight = drawer ? '' : `${available}px`;
    }
    for (const selector of ['.tag-workspace-list']) {
      const panel = doc.querySelector<HTMLElement>(selector);
      if (!panel) continue;
      const available = Math.max(100, win.innerHeight - Math.max(16, panel.getBoundingClientRect().top) - 16);
      panel.style.maxHeight = `${available}px`;

    }
  }

  const libraryShortcut = (event: KeyboardEvent) => {
    if(page !== 'vocabulary' || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.key !== '/' || editorTag || modal) return;
    const active=doc.activeElement;
    if(active && (['input','textarea','select'].includes(active.localName) || active.getAttribute('role') === 'combobox' || active.getAttribute('contenteditable') === 'true')) return;
    const search=doc.getElementById('vocabulary-search');if(search){event.preventDefault();search.focus({preventScroll:true});}
  };
  win.addEventListener('keydown',libraryShortcut);

  const destroy = () => {
    if (disposed) return;
    disposed = true;
    closeActionMenu?.(false);
    cleanupDropdowns(doc);
    ++viewEpoch;viewController?.abort();stopView?.();stopView=null;
    if(searchTimer)win.clearTimeout(searchTimer);
    if (signingIn) void invoke('cancel-sign-in').catch(() => {});
    if (toastTimer) win.clearTimeout(toastTimer);
    apiKeyDrafts.api = '';
    apiKeyDrafts.deepseek = '';
    settingsDraft = null;
    win.removeEventListener('resize', fitTagWorkspace);
    win.removeEventListener('keydown',libraryShortcut);
  };
  win.addEventListener('unload', destroy, { once: true });
  win.addEventListener('resize', fitTagWorkspace);
  void refresh();
  return { refresh, destroy, navigate };
}
