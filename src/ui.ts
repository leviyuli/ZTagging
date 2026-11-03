import type {Workspace,ViewEvent,ViewQuery} from './workspace-contract.ts';
import type { BuildMode, DisplayAssignmentReview, DisplayPaper, DisplayReviewItem, DisplaySuggestion, DisplayTag, ManagerPage, ManagerSettings, ManagerSnapshot, Scope } from './ui-contract';
import { createDropdown, cleanupDropdowns, updateDropdown } from './dropdown';
import type {DropdownOptions} from './dropdown';
import { compileConceptFilter, descendantIds, matchCompiledConceptFilter } from './concept-filter';
import type { ConceptFilter } from './concept-filter';
import { canonicalTagKey } from './core';
import type { WarningRecord } from './warnings';

type Child = Node | string | null | undefined | false;
type NativeMeaningRow = NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>['rows'][number];
type MenuAction = { id: string; label: string; run: () => void | Promise<unknown> };
type ModalState = { kind: 'apply' | 'create-diy'; ids: string[] } | { kind: 'finish'; ids: string[]; runId: string; acceptRemaining: boolean } | { kind: 'cleanup-history'; records: number; bytes: number } | { kind: 'search' | 'reset-analysis' | 'merge-shelves' } | null;
const facets = ['system', 'component', 'phenomenon', 'method'] as const;
const facetNames: Record<string, string> = { system: 'Systems', component: 'Components & materials', phenomenon: 'Phenomena', method: 'Methods' };
const UNDEFINED_TAGS_SHELF='my-undefined-tags';
const pageTitles: Record<ManagerPage, [string, string]> = {
  overview: ['Your library, clearly tagged', 'Prepare a useful tag list, then review its paper suggestions.'],
  connection: ['Connect AI', 'Choose the connection and model used for your papers.'],
  build: ['Build tags', 'Learn a compact tag vocabulary from your papers.'],
  cleanup: ['Build tags', 'Learn a compact tag vocabulary from your papers.'],
  assignment: ['Assign tags', 'Add supported tags to your papers and handle remaining choices when convenient.'],
  vocabulary: ['Tag library', 'Edit saved tags and add topics you want to follow.'],
  'existing-tags': ['Existing tags', 'Bring useful library tags into Smart Tags and review any paper changes.'],
  review: ['Review suggestions', 'Check the evidence, keep useful tags, and teach Smart Tags your preferences.'],
  library: ['Find papers', 'Search your papers or narrow the results by tag.'],
  activity: ['Activity', 'Follow progress, resolve choices, and undo changes.'],
  settings: ['Settings', 'Manage your AI connection, tag defaults, and saved data.'],
};
const pageNames: Record<ManagerPage, string> = { overview: 'Overview', connection: 'Connect AI', build: 'Build tags', cleanup: 'Build tags', assignment: 'Assign tags', vocabulary: 'Tag library', 'existing-tags': 'Earlier tag tools', review: 'Paper suggestions', library: 'Find papers', activity: 'Activity', settings: 'Settings' };
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
  let page: ManagerPage = options.page || 'overview';
  let pendingNavigation: ManagerUIOptions | null = options;
  let buildScope: Scope = 'pilot';
  let assignmentScope: Scope = 'library';
  let assignmentTagShelfId = 'all';
  let libraryTagShelfId = 'all';
  let newTagShelfId: string | undefined;
  const shelfNameDrafts = new Map<string,string>();
  let renamingShelf = '';
  let libraryShelfOptionsOpen = false;
  const libraryLinkedPapersOpen = new Set<string>();
  const libraryNotesOpen = new Set<string>();
  let libraryTagStatus: 'all' | 'ready' | 'undefined' = 'all';
  const selectedNativeNames = new Set<string>();
  const mergeShelfIds = new Set<string>();
  let mergedShelfName = '';
  let replaceMergedShelves = true;
  let nativeMeaningWorkId = '';
  let nativeMeaningReviewHidden = true;
  let pendingNativeReview:{workId:string;entryId:string}|null=null;
  let requestedNativeWorkId:string|undefined;
  let buildRunFilter:{runId:string;savedCount:number}|null=null;
  let nativeMeaningPage = 0;
  const excludedNativeMeaningRows = new Set<string>();
  let reviewDetailsOpen = false;
  let legacyToolsOpen = false;
  let buildMode: BuildMode = 'replace';
  let buildSetupOpen = false;
  let buildAdvancedOpen = false;
  let initialTagTarget: number | null = null;
  let additionalTagTarget: number | null = null;
  let topicAdditionalTarget: number | null = null;
  let workflowInitialized = false;
  let assignmentView: 'setup' | 'suggestions' = 'setup';
  let assignmentViewInitialized = false;
  let incomingSettingsOpen = false;
  let dataDetailsOpen = false;
  let queueDetailsOpen = false;
  let completedActivityOpen = false;
  let activityHistoryOpen = false;
  let activityPaperInfoOpen = false;
  let activityHistoryQuery = '';
  let activityHistoryPage = 0;
  let deferredReviewOpen = false;
  const nativeEditOptionsOpen = new Set<string>();
  let busy = false;
  let signingIn = false;
  let requestingFasterBuild = false;
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
  let tagView: 'tags' | 'questions' = 'tags';
  let tagQuestionPage = 0;
  let reviewFilter = 'pending';
  let reviewPage = 0;
  let assignmentRunSelection: string | null = null;
  const selectedTopicIds = new Set<string>();
  let topicPage = 0;
  let libraryPage = 0;
  let warningHistoryPage = 0;
  let existingTagQuery = '';
  let existingTagView: 'keep' | 'compare' = 'keep';
  let keepPlanId = '';
  let keepInventoryKey = '';
  let keepDraftDirty = false;
  let keepDraftStale = false;
  let keepFilter = 'all';
  let keepPreviewPage = 0;
  const keptNames = new Set<string>();
  const keepDecisions = new Map<string,boolean>();
  const selectedDIYComparisons = new Set<string>();
  let diyComparisonId = '';
  let diyComparisonPage = 0;
  let diyPreviewPage = 0;
  let overrideDIYConflicts = false;
  let diyPreviewKey = '';
  let existingTagFilter = 'all';
  let existingTagFacet = 'all';
  let existingTagPage = 0;
  let existingPreviewPage = 0;
  let existingTagAction: 'replace' | 'remove' | 'keep' = 'replace';
  const selectedExistingTags = new Set<string>();
  const existingTagTargets = new Map<string,string>();
  const existingPaperTargets = new Map<string,string>();
  const selectedExistingPapers = new Set<string>();
  const overriddenExistingPapers = new Set<string>();
  const expandedExistingGroups = new Set<string>();
  const existingPaperPages = new Map<string,number>();
  const existingDIYDrafts = new Map<string,{ name: string; description: string }>();
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
  let editorNativeEntry: { workId: string; entryId: string } | null = null;
  const tagScrollPositions = new Map<string, number>();
  const editorScrollPositions = new Map<string, number>();
  const editorDrafts = new Map<string, DisplayTag>();
  let editorAdvancedOpen = false;
  let editorReturnFocus = '';
  let pendingEditorFocus = '';
  let detailScope: Scope = 'selected';
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
  let papersByNativeTag = new Map<string, Set<string>>();
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
  function hideEditor() { rememberEditorDraft();editorTag = null;editorPreparationId = '';editorNativeEntry = null; }
  function closeEditor() { hideEditor();pendingEditorFocus = editorReturnFocus;render(); }
  function rememberEditorOrigin(fallback: string) {
    const active = doc.activeElement as HTMLElement | null;
    editorReturnFocus = active?.id && !doc.getElementById('tag-editor-form')?.contains(active) ? active.id : fallback;
  }
  function browseTags() { nativeMeaningReviewHidden = true;pendingNativeReview=null;requestedNativeWorkId=undefined;if (editorNativeEntry) hideEditor(); }
  function nav(target: ManagerPage, showMeanings = false) { hideEditor();page = target; if (target === 'review') assignmentView = 'suggestions';if(target==='vocabulary'){if(showMeanings)nativeMeaningReviewHidden=false;else browseTags();}else{pendingNativeReview=null;requestedNativeWorkId=undefined;}modal = null;win.scrollTo(0,0);render(); }
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
    return receipt.result;
  }
  function viewQuery():ViewQuery {
    const params={paperQuery,vocabQuery,libraryTagShelfId,libraryTagStatus,...(page==='vocabulary'?{buildRunId:buildRunFilter?.runId}:{}),...(page==='build'||page==='cleanup'?{buildScope,buildMode}:{}),...(page==='assignment'?{assignmentScope,assignmentTagShelfId}:{}),...(page==='settings'?{settingsTransfersOpen}:{}),conceptFilter,conceptQuery,expandedConceptIds:[...expandedConcepts],selectedPaper,assignmentRunId:assignmentRunSelection,reviewFilter,activityHistoryQuery,activityHistoryOpen,completedActivityOpen,activityPaperInfoOpen,deferredReviewOpen,attentionQuery,attentionFilter,attentionPage,paperExclusionPage,keepPreviewPage,existingTagQuery,existingTagView,keepFilter,existingTagFilter,existingTagFacet,existingTagPage,existingPreviewPage,diyComparisonPage,diyPreviewPage,topicPage,expandedExistingGroups:[...expandedExistingGroups],existingPaperPages:Object.fromEntries(existingPaperPages),nativeMeaningReviewHidden,nativeMeaningWorkId:requestedNativeWorkId,nativeReviewTarget:pendingNativeReview,tagView,editorTagId:editorTag?.id,editorPreparationId,editorNativeEntry,libraryLinkedPaperNames:[...libraryLinkedPapersOpen],libraryNoteNames:[...libraryNotesOpen],relationshipQueries:Object.fromEntries(relationQueries),openRelationshipPickers:[...openRelationshipPickers],libraryFiltersOpen,assignmentView};
    const pageSize=page==='vocabulary'?20:page==='cleanup'||page==='build'?tagView==='questions'?10:20:PAGE_SIZE;
    const pageIndex=page==='vocabulary'?nativeMeaningReviewHidden?vocabularyPage:nativeMeaningPage:page==='library'?libraryPage:page==='activity'?activityHistoryPage:page==='assignment'||page==='review'?reviewPage:page==='cleanup'||page==='build'?tagView==='questions'?tagQuestionPage:vocabularyPage:0;
    const query:ViewQuery={page,params:{...params,pageSize},limit:pageSize},key=JSON.stringify(query);
    let cursors=viewCursors.get(key);if(!cursors){cursors=new Map([[0,'0']]);viewCursors.set(key,cursors);if(viewCursors.size>32)viewCursors.delete(viewCursors.keys().next().value!);}
    query.cursor=cursors.get(pageIndex)??String(pageIndex*pageSize);queryPageIndexes.set(query,pageIndex);return query;
  }
  function primaryRowCount(query:ViewQuery,model:ManagerSnapshot){
    if(query.page==='library')return model.papers.length;
    if(query.page==='activity')return model.history.length;
    if(query.page==='assignment'||query.page==='review')return model.suggestions.length;
    if(query.page==='vocabulary'&&!query.params?.nativeMeaningReviewHidden)return model.nativeDefinitionPreparation?.rows.length??model.tagLibraryEntries?.length??model.tags.length;
    if((query.page==='cleanup'||query.page==='build')&&query.params?.tagView==='questions')return model.tagPreparation?.questions.length??0;
    return model.tagLibraryEntries?.length??model.tagPreparation?.tags.length??model.tags.length;
  }
  function acceptViewModel(model:ManagerSnapshot) {
    if(model.nativeDefinitionPreparation?.id&&model.nativeDefinitionPreparation.id!==state?.nativeDefinitionPreparation?.id)nativeMeaningPage=0;
    state=model;
    if(model.queue.switchingToFasterBuild||!model.queue.canUseFasterBuild)requestingFasterBuild=false;
    if(model.connection.signingIn!==undefined)signingIn=model.connection.signingIn;
    paperMap = new Map([...state.papers,...(state.detailPapers||[])].map(paper => [paper.id, paper]));
    tagMap = new Map([...state.tags,...(state.detailTags||[])].map(tag => [tag.id, tag]));
    suggestionMap = new Map(state.suggestions.map(suggestion => [suggestion.id, suggestion]));
    papersByNativeTag = new Map();
    for (const paper of state.papers) for (const name of paper.tags || []) {
      const key = canonicalTagKey(name);
      const items = papersByNativeTag.get(key) || new Set<string>();
      items.add(paper.id); papersByNativeTag.set(key, items);
    }
    for (const id of searchCache.keys()) if (!paperMap.has(id)) searchCache.delete(id);
    if (!settingsDirty) settingsDraft = { ...state.settings };
    if (assignmentRunSelection === null) assignmentRunSelection = state.assignmentReview?.id || state.assignmentReviews?.[0]?.id || null;
    if (!assignmentViewInitialized) {
      const active = (state.assignmentReviews || (state.assignmentReview ? [state.assignmentReview] : [])).find(review => review.status !== 'finished');
      if (active) { assignmentRunSelection = active.id;assignmentView = 'suggestions'; }
      if (active || page === 'assignment' || page === 'review') assignmentViewInitialized = true;
    }
    if (!workflowInitialized) {
      if (!options.page && !options.createDetail && !options.tagId) page = state.taxonomyReady ? 'vocabulary' : 'cleanup';
      buildScope = state.workflow?.buildScope || (state.taxonomyReady ? 'selected' : 'pilot');
      assignmentScope = state.workflow?.assignmentScope || 'library';
      assignmentTagShelfId = state.workflow?.assignmentTagShelfId || 'all';
      buildMode = state.taxonomyReady ? 'extend' : state.workflow?.buildMode || 'replace';
      workflowInitialized = true;
    }
    if (state.tagShelves) {
      const shelfIds = new Set(state.tagShelves.map(shelf => shelf.id));
      if (libraryTagShelfId !== 'all' && libraryTagShelfId!==UNDEFINED_TAGS_SHELF&&!shelfIds.has(libraryTagShelfId)) { libraryTagShelfId = 'all';vocabularyPage = 0;renamingShelf = ''; }
      if (assignmentTagShelfId !== 'all' && !shelfIds.has(assignmentTagShelfId)) assignmentTagShelfId = state.workflow?.assignmentTagShelfId && shelfIds.has(state.workflow.assignmentTagShelfId) ? state.workflow.assignmentTagShelfId : 'all';
    }
    if (pendingNavigation) { const next = pendingNavigation; pendingNavigation = null; navigate(next, false); }
  }
  function observeView(query:ViewQuery):Promise<void> {
    const epoch=++viewEpoch;
    cleanupDropdowns(doc);
    viewController?.abort();stopView?.();
    viewController=new AbortController();viewRevision=-1;
    viewQueryKey=JSON.stringify(query);
    viewSearchKey=JSON.stringify([paperQuery,vocabQuery,conceptQuery,activityHistoryQuery,attentionQuery,existingTagQuery]);
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
        const cursorKey=JSON.stringify({page:query.page,params:query.params,limit:query.limit}),cursors=viewCursors.get(cursorKey),index=queryPageIndexes.get(query)??0;
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
    const searchKey=JSON.stringify([paperQuery,vocabQuery,conceptQuery,activityHistoryQuery,attentionQuery,existingTagQuery]);
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
    const destination = await run('open-review-item', { id: item.id });
    if (item.kind === 'assignment') { assignmentRunSelection = destination?.runId || item.taskId;assignmentView = 'suggestions';nav('assignment');return; }
    if (item.ownerPage === 'vocabulary') {openNativeMeanings({workId:item.workId||item.taskId,entryId:item.questionId||''});if(item.state==='deferred'){deferredReviewOpen=true;render();}}
    else { tagView = 'questions';nav(destination?.page || 'cleanup'); }
  }
  function nativeReviewRow(item: DisplayReviewItem) {
    const work = currentState().nativeDefinitionPreparation;
    return work && (work.id === item.taskId || work.id === item.workId) ? nativeMeaningRows().find(row => row.reviewId === item.id || row.id === item.questionId) : undefined;
  }
  function nativeMeaningRows() {const s=currentState();return [...s.nativeDefinitionPreparation?.rows||[],...s.detailNativeMeaningRows||[]];}
  function preparationTags(preparation=currentState().tagPreparation) {return [...preparation?.tags||[],...preparation?.detailTags||[]];}
  function nativeSourceReview(row?: NativeMeaningRow) {
    return !!row?.chosenMeaning && row.questionKind !== 'protection' && !nativePersonalReview(row) && row.personalTreatment !== 'personal' && !!row.sourceIssues?.length;
  }
  function nativePersonalReview(row?: NativeMeaningRow) { return row?.questionKind === 'personal' || row?.resolution === 'personal'; }
  function nativeHasDraft(row: NativeMeaningRow) { return !!row.name?.trim() && !!row.description?.trim(); }
  function nativeDraftMeaning(row: NativeMeaningRow) { return !row.chosenMeaning && !nativePersonalReview(row) && nativeHasDraft(row) ? h('div','native-meaning-status',h('p','meaning-selected',`AI proposal: ${row.name}`),h('p','',row.description!)) : null; }
  function nativeSavedMeanings(row: NativeMeaningRow) {
    return row.savedMeaningConflicts?.length ? h('div','native-saved-meanings',...row.savedMeaningConflicts.map(saved => h('div','native-meaning-status',h('p','meaning-selected',`Saved meaning: ${saved.name}`),h('p','meaning-description',saved.description)))) : null;
  }
  function nativeDecisionMessage(row: NativeMeaningRow) {
    if (row.savedMeaningConflicts?.length) return 'This name already has a saved meaning. Keep the saved meaning and close this proposal, or skip the proposal.';
    if (row.questionKind === 'protection') return row.question || 'An earlier tag choice is protected. You can skip defining this tag.';
    if (nativeSourceReview(row)) return nativeSourceMessage(row);
    if (nativeHasDraft(row)) return row.canUseProposedMeaning || row.canConfirmClear || row.choices?.length ? 'Use this meaning or skip defining this tag.' : 'AI has not supported this proposal yet. Skip this tag, or ask AI to try again.';
    return 'AI has not found a supported scientific meaning. Skip this tag, or ask AI to try again.';
  }
  async function defineScientificMeaning(name: string, row?: NativeMeaningRow) {
    const work=currentState().nativeDefinitionPreparation;
    await run('set-native-tag-treatment',{name,treatment:'scientific',...(row && work ? {id:work.id,entryId:row.id} : {})},'AI is preparing a scientific meaning. You can use its proposal or skip this tag.');
  }
  function nativePersonalActions(workId: string, row: NativeMeaningRow, disabled = false) {
    const locked=disabled || row.canSetTreatment !== true;
    const keep=button('Keep as personal label',() => run('set-native-tag-treatment',{name:row.sourceName,treatment:'personal',id:workId,entryId:row.id},'Kept as a personal label. Automatic assignment is off for this name.'),'primary small',locked);keep.id=`keep-native-personal-${row.id}`;
    const define=button('Ask AI for a scientific meaning',() => defineScientificMeaning(row.sourceName,row),'small',locked || !canAnalyze());define.id=`define-native-scientific-${row.id}`;
    return h('div','',h('p','card-description','Recommended: keep this label for your own organization. It stays on your papers and will not be assigned automatically; other scientific tags can still be assigned to those papers.'),h('div','actions',keep,define),locked ? h('p','card-description','Choose a treatment after the current processing finishes.') : null);
  }
  function clearNativeMeanings(work: NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>, compact = false) {
    if (!(work.clearChoiceCount && work.clearChoiceCount > 0)) return null;
    const use=button('Use clear meanings',() => run('use-clear-tag-meanings',{id:work.id},'Clear meanings selected.'),'primary small',!work.canUseClearMeanings || work.rows.some(row => row.canConfirmClear && nativeMeaningChanged(work.id,row)));use.id='use-clear-native-meanings';
    return h('div','native-clear-meanings',h('p','card-description',compact ? `${work.clearChoiceCount} clear ${work.clearChoiceCount === 1 ? 'meaning' : 'meanings'} ready` : `${work.clearChoiceCount} clear ${work.clearChoiceCount === 1 ? 'draft is' : 'drafts are'} ready to use. Use these meanings together, or choose individual proposals below.`),use);
  }
  function nativeSourceCounts(row: NativeMeaningRow) {
    const counts={different:0,uncertain:0,unchecked:0};
    for (const issue of row.sourceIssues || []) counts[issue.status]++;
    return counts;
  }
  function nativeSourceMessage(row: NativeMeaningRow) {
    return `${row.applied ? 'Meaning saved.' : 'Use this meaning or skip defining this tag.'} Existing paper tags stay unchanged.`;
  }
  function nativeReviewTarget(element: HTMLElement, row: NativeMeaningRow) { element.id=`native-review-${row.id}`;element.tabIndex=-1;return element; }
  function nativeMeaningSaveMessage(workId: string, entryId: string) {
    const work=currentState().nativeDefinitionPreparation,row=work?.id === workId ? nativeMeaningRows().find(row => row.id === entryId) : undefined;
    if (row?.applied) return 'Meaning saved to your tag library.';
    if (work?.id === workId) {
      if (work.status === 'queued') return 'Meaning kept. Linked papers are queued for checking.';
      if (work.status === 'running') return 'Meaning kept. Checking the linked papers.';
      if (work.status === 'paused') return 'Meaning kept. Source checks are paused.';
    }
    if (nativeSourceReview(row)) return 'Meaning kept. You can use the AI proposal or skip defining this tag.';
    if (row?.questionKind === 'protection') return 'Meaning kept. A protected tag choice still needs review.';
    if (row?.status === 'ready') return 'Meaning ready to save.';
    return row?.status === 'question' ? 'Meaning kept. A review choice is still open.' : 'Meaning kept.';
  }
  function nativeMeaningSupport(row: NativeMeaningRow) {
    if (!row.chosenMeaning) return null;
    const issues = row.sourceIssues || [],counts=nativeSourceCounts(row),summary=[counts.different ? `${counts.different} conflicting` : '',counts.uncertain ? `${counts.uncertain} uncertain` : '',counts.unchecked ? `${counts.unchecked} not checked` : ''].filter(Boolean).join(' · ');
    const panel = h('details','native-meaning-support',h('summary','',`AI source notes${summary ? ` · ${summary}` : ''}`),h('p','card-description','AI findings are shown for reference. You do not need to review or change the papers.'));
    const labels = { uncertain: 'Uncertain match', different: 'Does not support this meaning', unchecked: 'Not checked' };
    for (const issue of issues) panel.append(h('div','native-source-issue',paperButton(issue.paperId),h('p','card-description',labels[issue.status]),h('p','',issue.reason)));
    return h('div','native-meaning-status',h('p','meaning-selected',`${row.applied ? 'Meaning saved' : row.selectionOrigin === 'automatic' ? 'Meaning selected automatically' : 'Meaning selected'}: ${row.chosenMeaning.name}`),h('p','meaning-description',row.chosenMeaning.description),issues.length ? panel : null);
  }
  function nativeDecisionActions(workId: string, row: NativeMeaningRow, item?: DisplayReviewItem, disabled = false, later?: () => void | Promise<unknown>) {
    const actions=h('div','actions'),saved=row.savedMeaningConflicts || [];
    if (saved.length && !row.applied) { const keep=button(saved.length === 1 ? 'Keep saved meaning' : 'Keep saved meanings',() => run(item ? 'resolve-review-item' : 'leave-tag-undefined',item ? {id:item.id,action:'leave'} : {id:workId,entryId:row.id},'Saved meaning kept. Duplicate proposal closed.'),'primary small',disabled);keep.id=`keep-saved-native-meaning-${row.id}`;actions.append(keep); }
    else if (row.canUseProposedMeaning && !row.choices?.length && !row.applied) { const use=button('Use this meaning',() => run('use-proposed-tag-meaning',{id:workId,entryId:row.id},'Meaning saved. Paper tags stay unchanged.'),'primary small',disabled);use.id=`use-native-proposed-${row.id}`;actions.append(use); }
    else for (const choice of row.choices || []) { const compact=page === 'vocabulary' && row.choices?.length === 1 && choice.description === row.description;const use=button(compact ? 'Use this meaning' : choice.label,() => run(item ? 'resolve-review-item' : 'answer-tag-meaning',item ? {id:item.id,choiceId:choice.id} : {id:workId,entryId:row.id,choiceId:choice.id},'Meaning selected. AI is checking the proposal.'),'primary small meaning-choice-option',disabled);use.id=`answer-native-meaning-${row.id}-${choice.id}`;use.setAttribute('aria-label',choice.label);if(choice.description && !compact)use.append(h('small','',choice.description));actions.append(use); }
    if (!row.applied) { const skip=button('Skip this tag',() => run(item ? 'resolve-review-item' : 'leave-tag-undefined',item ? {id:item.id,action:'leave'} : {id:workId,entryId:row.id},'Skipped defining this tag. Its existing paper tags stay unchanged.'),'quiet small',disabled);skip.id=`leave-native-meaning-${row.id}`;skip.setAttribute('aria-label',`Skip defining ${row.sourceName}`);actions.append(skip); }
    if(later)actions.append(button('Later',later,'quiet small',disabled));
    const optional=h('details','native-meaning-options',h('summary','','Edit options'));
    optional.id=`native-edit-options-${row.id}`;optional.open=nativeEditOptionsOpen.has(row.id);
    listen(optional,'toggle',event => { const current=event.currentTarget as HTMLDetailsElement;if(current.isConnected)current.open ? nativeEditOptionsOpen.add(row.id) : nativeEditOptionsOpen.delete(row.id); });
    if (!saved.length && (row.status === 'question' || row.status === 'failed') && !row.applied && !row.canUseProposedMeaning && !row.choices?.length && row.questionKind !== 'protection') { const retry=button('Ask AI again',() => run('retry-proposed-tag-meaning',{id:workId,entryId:row.id},'AI is preparing another proposal.'),'small',disabled || !canAnalyze() || currentState().canPrepareNativeMeanings === false);retry.id=`retry-native-proposed-${row.id}`;retry.setAttribute('aria-label',`Ask AI again for ${row.sourceName}`);actions.append(retry); }
    const currentWork=currentState().nativeDefinitionPreparation;
    const edit=button('Edit meaning',() => { if(page !== 'vocabulary')nav('vocabulary',true);nativeMeaningReviewHidden=false;editNativeMeaning(workId,row); },'quiet small',currentWork?.status === 'queued' || currentWork?.status === 'running');edit.id=`edit-native-meaning-${row.id}`;edit.setAttribute('aria-label',`Edit meaning for ${row.sourceName}`);optional.append(edit);
    return h('div','native-decision-footer',actions,optional);
  }
  function reviewItemBody(item: DisplayReviewItem, library = false): Node {
    const s = currentState();
    const later = () => run('defer-review-item', { id: item.id }, 'Left for later. Other work can continue.');
    if (item.state === 'deferred') { const row=h('div', 'inline between', h('span', '', item.label),button('Reopen', async () => {await run('reopen-review-item', { id: item.id });if(library){deferredReviewOpen=false;nativeMeaningPage=0;render();}}, 'small'));row.id=`deferred-review-${item.id}`;row.tabIndex=-1;return row; }
    if (item.kind === 'assignment') {
      const suggestion = s.suggestions.find(value => value.id === item.suggestionId);
      if (!suggestion) return h('div', '', h('p', '', item.message || item.label),button('Open assignment', () => openReviewItem(item), 'small'));
      const tag = tagById(suggestion.tagId), verb = tag?.builtin === 'no_tag' ? 'Exclude from future tagging' : suggestion.operation === 'remove' ? `Remove ${tagName(suggestion.tagId)}` : `Add ${tagName(suggestion.tagId)}`;
      const evidence = h('details', 'section-gap',h('summary', '', 'Evidence'),...suggestion.evidence.map(value => h('blockquote', 'evidence',h('cite', '', value.source),value.text)));
      return h('div', 'review-choice',h('strong', '', tagName(suggestion.tagId)),h('p', '', suggestion.reason),evidence,h('div', 'actions',
        button(verb, () => run('resolve-review-item', { id: item.id, action: 'accept' }, 'Choice applied.'), 'primary small'),
        button('Reject and remember', () => run('resolve-review-item', { id: item.id, action: 'reject' }, 'Rejection remembered.'), 'small'),button('Later', later, 'quiet small')));
    }
    const work = s.nativeDefinitionPreparation;
    const native = nativeReviewRow(item);
    const preparation = s.tagPreparation;
    const question = preparation && (preparation.id === item.taskId || preparation.id === item.workId) ? preparation.questions.find(question => question.reviewId === item.id || question.id === item.questionId) : undefined;
    const choices = native?.canConfirmClear ? [] : native?.choices || question?.choices || [];
    const unsaved = !!native && !!work && nativeMeaningChanged(work.id,native);
    if (native && work && nativePersonalReview(native)) return nativeReviewTarget(h('article','review-choice',h('strong','',native.sourceName),h('p','','How should Smart Tags use this personal label?'),nativePersonalActions(work.id,native,unsaved),button('Later',later,'quiet small')),native);
    if (native && work) return nativeReviewTarget(h('article','review-choice',h('strong','',native.sourceName),nativeMeaningSupport(native) || nativeDraftMeaning(native),nativeSavedMeanings(native),library && native.canUseProposedMeaning && !native.savedMeaningConflicts?.length && native.questionKind !== 'protection' ? null : h('p','',nativeDecisionMessage(native)),nativeDecisionActions(work.id,native,item,unsaved,later)),native);
    const actions = h('div', 'actions',...choices.map(choice => {
      const answer = button(choice.label, () => run('resolve-review-item', { id: item.id, choiceId: choice.id }, 'Meaning selected. Supported definitions are saved automatically.'), 'small primary meaning-choice-option',unsaved);
      answer.setAttribute('aria-label', choice.label);
      if (native) answer.id = `answer-native-meaning-${native.id}-${choice.id}`;
      if (choice.description) answer.append(h('small', '', choice.description));return answer;
    }));
    if (item.tagId && preparation?.tags.some(tag => tag.id === item.tagId)) actions.append(button('Edit meaning', () => { nav('cleanup');editTag(preparation.tags.find(tag => tag.id === item.tagId)!,preparation.id); }, 'small'));
    if (native) { const leave = button('Leave undefined', () => run('resolve-review-item', { id: item.id, action: 'leave' }, 'Name left undefined.'), 'small',unsaved);leave.id = `leave-native-meaning-${native.id}`;actions.append(leave); }
    if (!choices.length && !native) actions.append(button('Open meaning', () => openReviewItem(item), 'small'));
    actions.append(button('Later', later, 'quiet small'));
    const article=h('article', 'review-choice',h('strong', '', item.sourceName || item.label),native ? nativeMeaningSupport(native) || nativeDraftMeaning(native) : null,h('p', '', native?.question || item.message || question?.description || ''),actions);
    return native ? nativeReviewTarget(article,native) : article;
  }
  function reviewInbox(items: DisplayReviewItem[], title = 'Needs your choice', library = false,deferredTotal?:number): Node | null {
    const open = items.filter(item => item.state === 'open'), deferred = items.filter(item => item.state === 'deferred');
    const deferredCount=deferredTotal??deferred.length;
    if (!open.length && !deferred.length&&!deferredCount) return null;
    const definitions = open.filter(item => item.kind === 'definition'), papers = new Map<string, DisplayReviewItem[]>();
    for (const item of open.filter(item => item.kind === 'assignment')) { const key = item.paperId || item.id;const group = papers.get(key) || [];group.push(item);papers.set(key,group); }
    const body = h('div', 'stack');
    const nativeWork=currentState().nativeDefinitionPreparation;
    if (nativeWork && definitions.some(item => nativeReviewRow(item)?.canConfirmClear)) { const clear=clearNativeMeanings(nativeWork,library);if (clear) body.append(clear); }
    if (definitions.length) body.append(h('section', 'review-group',library && !papers.size ? null : h('h3', '', 'Tag meanings'),...definitions.map(item => reviewItemBody(item,library))));
    if (papers.size) body.append(h('section', '',h('h3', '', 'Paper tags'),...[...papers].map(([paperId, group]) => h('article', 'review-group',paperMap.has(paperId) ? paperButton(paperId) : h('strong', '', group[0].label),...group.map(item => reviewItemBody(item,library))))));
    if (deferredCount) body.append(details(`Later (${deferredCount})`, deferredReviewOpen, value => { deferredReviewOpen = value;if(library)nativeMeaningPage=0; }, () => h('div', 'stack',...deferred.map(item => reviewItemBody(item,library)))));
    const count = [definitions.length ? `${definitions.length} ${definitions.length === 1 ? 'meaning' : 'meanings'}` : '',papers.size ? `${papers.size} ${papers.size === 1 ? 'paper' : 'papers'}` : ''].filter(Boolean).join(' · ');
    const heading=title === 'Needs your choice' && definitions.length > 0 && !papers.size && definitions.every(item => nativeReviewRow(item)?.canConfirmClear) ? 'Clear meanings ready' : title;
    return h('section', `review-inbox${library ? ' library-review-inbox' : ''}`,h('h2', '', heading),h('p', 'card-description',count || 'Other work can continue.'),body);
  }
  function taskUndo(changeId: string | undefined, id: string) {
    if (!changeId || currentState().history.find(change => change.id === changeId)?.canUndo === false) return null;
    const undo = button('Undo last change', () => run('undo', { id: changeId }, 'Change undone.'), 'quiet small');undo.id = id;return undo;
  }
  function approvedTags() { return currentState().tags.filter(tag => tag.status === 'approved' && !tag.builtin); }
  function personalTag(tag: DisplayTag) {
    const treatments=currentState().nativeTagTreatments;
    return !!treatments && [tag.name,tag.fullName,...tag.aliases].some(name => name ? treatments[canonicalTagKey(name)] === 'personal' : false);
  }
  function assignmentTags() { return approvedTags().filter(tag => !personalTag(tag)); }
  function assignmentTagCount() {return currentState().totals?.assignableTags??assignmentTags().length;}
  function remotePage(noun=''):boolean {
    if(viewTotal===undefined)return false;
    return page==='library'&&!noun||page==='activity'&&noun==='changes'||(page==='assignment'||page==='review')&&!noun||page==='vocabulary'&&noun===(nativeMeaningReviewHidden?'tags':'meanings')||(page==='cleanup'||page==='build')&&noun===(tagView==='questions'?'questions':'tags');
  }
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
    const s = currentState(), mode = s.taxonomyReady ? buildMode : 'replace';
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
      await run('prepare-tags', { scope: buildScope, mode, processingPolicy: 'auto-clear', ...(explicitLimit !== null ? mode === 'extend' ? { additionalTargetCount: explicitLimit } : { targetCount: explicitLimit } : {}) }, manualReplacement ? 'Building a replacement. Review it before applying.' : 'Building tags. Supported meanings are saved automatically.');
      buildSetupOpen = false;render();
    };
    const startButton = button(mode === 'extend' ? 'Extend tags' : 'Build tags', start, 'primary', !canAnalyze() || s.queue.status === 'running' || !Number.isInteger(limit) || limit < 1 || limit > 500);
    startButton.id = 'start-build';startButton.setAttribute('aria-label', 'Build tags from these papers');
    const body = h('section', 'task-setup', field('Papers', scopeSelect('build-scope', buildScope, value => { buildScope = value;render(); }), buildScope === 'selected' || buildScope === 'collections' ? 'Use your current Zotero selection.' : undefined),
      h('p', 'card-description', `${explanation} ${manualReplacement ? 'Review it before saving.' : 'Supported meanings are saved automatically.'}`),h('p', 'muted', `Up to ${limit} ${mode === 'extend' ? 'new ' : ''}tags · upper limit, not a quota`),advanced,
      s.tagPreparation?.processingPolicy !== 'auto-clear' && s.tagPreparation ? h('p', 'card-description', 'Your current suggestions stay here until you choose Build tags. Starting another build replaces the unsaved list.') : null,
      h('div', 'task-actions', startButton));
    return h('div', 'stack', !canAnalyze() ? h('div', 'notice info inline between', h('span', '', 'Choose an AI connection and model before building tags.'), button('Connect AI', () => nav('connection'), 'small')) : null,
      body);
  }
  function queueStrip() {
    const q = currentState().queue;
    if (page === 'activity' && currentState().activityTasks) return null;
    if (q.status === 'idle' && !q.total) return null;
    if (page !== 'activity') {
      if (q.status === 'idle' && !(q.kind === 'rebuild' && currentState().tagPreparation)) return null;
      const owner = q.ownerPage || (q.taskLabel ? undefined : q.kind === 'rebuild' ? 'cleanup' : q.kind === 'tag' ? 'assignment' : undefined);
      if (!(owner === 'cleanup' && (page === 'build' || page === 'cleanup') || owner === 'assignment' && (page === 'assignment' || page === 'review') || owner === 'vocabulary' && page === 'vocabulary')) return null;
    }
    const progress = queueProgress();
    const percent = progress.total ? Math.min(100, progress.completed / progress.total * 100) : 0;
    const fill = h('span');
    fill.style.width = `${percent}%`;
    return h('div', 'run-strip',
      h('div', 'inline between', h('div', '', h('strong', '', queuePhaseLabel()), progress.total ? h('span', 'muted', ` · ${q.selection || q.phaseProgress ? `${progress.label}: ${progress.completed} of ${progress.total}` : `${q.completed} of ${q.total} papers read`}`) : null),
        h('div', 'inline', fasterBuildButton('small'), q.status === 'running' ? button('Pause', () => run('pause'), 'small') : q.status === 'paused' ? resumeQueueButton('small') : null, button('View activity', () => nav('activity'), 'quiet small'))),
      q.message ? h('p', 'card-description', humanMessage(q.message)) : null,
      progress.total ? h('div', 'progress-bar', fill) : null);
  }
  function queueProgress() {
    const q = currentState().queue;
    if (q.taskLabel && !q.phaseProgress) return { completed: 0, total: 0, label: '' };
    if (q.phase === 'reading') return { completed: q.completed, total: q.total, label: 'Papers read' };
    if (q.phase === 'choosing' && !q.selection?.tagsTotal) return { completed: 0, total: 0, label: '' };
    if (q.selection?.verificationScope === 'representative') return { completed: q.selection.tagsPrepared ?? 0, total: q.selection.tagsTotal ?? 0, label: 'Tags prepared' };
    return q.selection ? { completed: q.selection.sourceCompleted, total: q.selection.sourceTotal, label: 'Supporting findings checked' } : q.phaseProgress || (q.phase ? { completed: 0, total: 0, label: '' } : { completed: q.completed + q.failed, total: q.total, label: '' });
  }
  function fasterBuildButton(kind = '') {
    const q = currentState().queue;
    if (!q.canUseFasterBuild && !q.switchingToFasterBuild) return null;
    if (q.switchingToFasterBuild && q.status === 'paused') return null;
    return button(q.switchingToFasterBuild ? 'Switching to faster build…' : 'Use faster build', async () => {requestingFasterBuild=true;try{await run('use-faster-build', { targetCount: 60 }, 'Switching to faster build. Completed paper analysis is kept.');}catch(error){requestingFasterBuild=false;render();throw error;}}, kind, q.switchingToFasterBuild === true||requestingFasterBuild);
  }
  function resumeQueueButton(kind = '', disabled = false) {
    const q = currentState().queue, fasterBuild = q.status === 'paused' && q.switchingToFasterBuild, retry = !fasterBuild && q.status === 'paused' && q.selection?.failed === true;
    return button(fasterBuild ? 'Retry faster build' : retry ? 'Retry this step' : 'Resume', () => run(retry ? 'retry-selection' : 'resume'), kind, disabled);
  }
  function queuePhaseLabel() {
    const q = currentState().queue;
    if (q.taskLabel) return q.status === 'paused' ? `${q.taskLabel} · paused` : q.taskLabel;
    if (q.status === 'paused') return q.switchingToFasterBuild ? 'Faster build paused' : q.phase === 'choosing' ? 'Choosing tags · paused' : q.phase === 'reading' ? 'Reading papers · paused' : 'Analysis paused';
    if (q.kind === 'rebuild' && q.status === 'idle' && q.phase === 'ready' && !currentState().tagPreparation) return 'Tag list saved';
    if (q.phase === 'mapping' && q.selection?.verificationScope === 'representative') return 'Checking examples';
    const labels = { reading: 'Reading papers', organizing: 'Organizing tags', choosing: 'Choosing tags', mapping: 'Checking supporting findings', checking: 'Checking tag meanings', ready: 'Ready for review' };
    return q.phase ? labels[q.phase] : q.status === 'running' ? 'Analyzing papers' : 'Analysis complete';
  }

  function renderOverview() {
    const s = currentState();
    const stats = h('div', 'stats');
    for (const [count, label] of [[approvedTags().length, 'tags ready'], [s.analyzedPaperCount ?? s.papers.length, 'papers read'], [s.suggestions.filter(item => item.status === 'pending' && !item.applied).length, 'paper suggestions']] as [number, string][]) {
      stats.append(h('div', 'stat', h('strong', '', count.toLocaleString()), h('span', '', label)));
    }
    const steps: [ManagerPage, string, string][] = [
      ['cleanup', 'Build tags', 'Learn useful meanings from your papers.'],
      ['vocabulary', 'Tag library', 'Browse saved meanings and add your own.'],
      ['assignment', 'Assign tags', 'Apply supported matches; other choices can wait.'],
    ];
    const workflow = h('ol', 'step-list');
    steps.forEach(([target, title, description], index) => workflow.append(h('li', 'step', h('span', 'step-number', String(index + 1)), h('div', '', button(title, () => nav(target), 'workflow-link'), h('p', '', description)))));
    const next: ManagerPage = !canAnalyze() ? 'connection' : s.tagPreparation ? 'cleanup' : s.taxonomyReady ? 'assignment' : 'build';
    const nextLabel = next === 'connection' ? 'Connect your AI model' : next === 'cleanup' ? 'Review your prepared tags' : next === 'assignment' ? 'Choose papers to tag' : 'Prepare your first tag list';
    return h('div', '', stats, h('div', 'grid', card(s.taxonomyReady ? 'Your tag library is ready' : 'Set up your tag library', 'Building the tag list and assigning paper tags are separate steps.', h('div', '', h('p', '', s.taxonomyReady ? 'Use the saved list for another group of papers, or extend it when your research changes.' : 'Begin with a small group, review its topics, then choose where to use those tags.'), h('div', 'actions', button(nextLabel, () => nav(next), 'primary'), s.taxonomyReady ? button('Open tag library', () => nav('vocabulary')) : null)), undefined, 'overview-primary'), card('Your workflow', 'You can open any step at any time.', workflow, undefined, 'overview-guide')));
  }

  function newTag(custom = false, contextId?: string, shouldRender = true) {
    rememberEditorOrigin('add-tag');
    rememberEditorDraft();
    editorPreparationId = '';
    editorNativeEntry = null;
    const shelf = currentState().tagShelves?.find(shelf => shelf.id === libraryTagShelfId);
    newTagShelfId = shelf && shelf.kind !== 'existing' ? shelf.id : undefined;
    relationQueries.clear();
    openRelationshipPickers.clear();
    editorTag = copyTag(editorDrafts.get(':new') || { id: '', name: '', description: '', facet: 'phenomenon', aliases: [], inclusions: [], exclusions: [], examples: [], custom, status: 'draft', broaderIds: [], relatedIds: contextId ? [contextId] : [], matchingMode: custom ? 'suggest' : 'auto' });
    if (shouldRender) { render();focusTagEditorField('tag-name'); }
  }
  function focusTagEditorField(id: string) {
    const field = doc.getElementById(id), body = doc.getElementById('tag-editor-form');
    field?.focus({preventScroll:true});
    if (!field || !body) return;
    const control = field.getBoundingClientRect(), viewport = body.getBoundingClientRect();
    if (control.top < viewport.top || control.bottom > viewport.bottom) body.scrollTop += control.top - viewport.top;
  }
  function copyTag(tag: DisplayTag): DisplayTag { return { ...tag, aliases: [...tag.aliases], inclusions: [...tag.inclusions], exclusions: [...tag.exclusions], examples: [...tag.examples], broaderIds: [...tag.broaderIds], relatedIds: [...(tag.relatedIds || [])] }; }
  function editorDraftKey(tag: DisplayTag, preparationId = editorPreparationId, nativeEntry = editorNativeEntry) { return nativeEntry ? `native:${nativeEntry.workId}:${nativeEntry.entryId}` : `${preparationId}:${tag.id || 'new'}`; }
  function rememberEditorDraft() { if (editorTag) editorDrafts.set(editorDraftKey(editorTag), copyTag(editorTag)); }
  function editTag(tag: DisplayTag, preparationId = '', shouldRender = true) {
    if (tag.builtin) return;
    rememberEditorOrigin(`edit-tag-${encodeURIComponent(tag.id)}`);
    rememberEditorDraft();
    editorPreparationId = preparationId;
    editorNativeEntry = null;
    relationQueries.clear();
    openRelationshipPickers.clear();
    editorTag = copyTag(editorDrafts.get(`${preparationId}:${tag.id}`) || tag);
    if (shouldRender) { render();focusTagEditorField('tag-name'); }
  }
  function navigate(next: ManagerUIOptions, shouldRender = true) {
    if (disposed) return;
    if (!state) { pendingNavigation = next; return; }
    if (next.page) { hideEditor();page = next.page;if (next.page === 'vocabulary') browseTags();win.scrollTo(0,0); }
    if (next.page === 'review') assignmentView = 'suggestions';
    if (next.assignmentRunId) { assignmentRunSelection = next.assignmentRunId;assignmentView = 'suggestions'; }
    modal = null;
    if (next.createDetail) { page = 'vocabulary';browseTags();win.scrollTo(0,0);newTag(true, next.detailContextId, false); }
    else if (next.tagId) { const tag = tagById(next.tagId); if (tag) { page = 'vocabulary';browseTags();win.scrollTo(0,0);editTag(tag, '', false); } }
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
    const native = editorNativeEntry && nativeMeaningRows().find(row => row.id === editorNativeEntry!.entryId);
    const baseline = native ? nativeMeaningTag(native) : editorPreparationId ? preparationTags().find(tag => tag.id === editorTag!.id) : tagById(editorTag.id);
    if (baseline) return definitionKey(editorTag) !== definitionKey(baseline);
    return !!(editorTag.name || editorTag.description || editorTag.fullName || editorTag.aliases.length || editorTag.inclusions.length || editorTag.exclusions.length || editorTag.examples.length || editorTag.broaderIds.length || editorTag.relatedIds?.length);
  }
  function updateEditorState() {
    const status = doc.getElementById('tag-editor-status');
    if (status) { status.hidden = !editorDirty();status.textContent = 'Unsaved changes'; }
    for (const [id,value] of [['tag-name',editorTag?.name],['tag-description',editorTag?.description]] as const) if (value?.trim()) doc.getElementById(id)?.removeAttribute('aria-invalid');
  }
  function requireSavedDetail(tag: DisplayTag) {
    const saved = tagById(tag.id);
    if (!saved || definitionKey(tag) !== definitionKey(saved)) throw new Error('Save your changes before finding matches or assigning this tag.');
    return saved;
  }
  function tagEditor(visible = true) {
    if (!editorTag || !visible) return h('section', 'card editor editor-placeholder', empty('Make the tags yours', 'Choose Edit beside a tag, or add a topic you want to follow.'));
    const tag = editorTag;
    const preparationId = editorPreparationId;
    const nativeEntry = editorNativeEntry;
    const nativeRow=nativeEntry && currentState().nativeDefinitionPreparation?.id === nativeEntry.workId ? nativeMeaningRows().find(row => row.id === nativeEntry.entryId) : undefined;
    const draftKey = editorDraftKey(tag);
    const orphaned = !!preparationId && state?.tagPreparation?.id === preparationId && !preparationTags().some(saved => saved.id === tag.id);
    const lineField = (key: 'aliases' | 'inclusions' | 'exclusions' | 'examples', label: string, note: string) => field(label, textarea(`tag-${key}`, tag[key].join('\n'), value => { tag[key] = value.split('\n').map(line => line.trim()).filter(Boolean); }), note);
    const advanced = h('details', 'editor-advanced', h('summary', '', 'More options'),
      field('Full name', input('tag-full-name', tag.fullName || '', value => { tag.fullName = value; }, 'Expand an abbreviation when helpful')),
      field('Group', select('tag-facet', tag.facet, facets.map(value => [value, facetNames[value]]), value => { tag.facet = value; })),
      lineField('aliases', 'Other names', 'Alternative names and abbreviations, one per line.'),
      lineField('inclusions', 'Use when', 'Optional guidance about papers that belong here.'),
      lineField('exclusions', 'Do not use when', 'Optional guidance about papers that do not belong here.'),
      lineField('examples', 'Examples', 'Helpful paper titles or passages, one per line.'),
      relationshipPicker(tag, 'broaderIds', 'Type of', 'Choose a broader topic only when this tag is a type of it.'),
      relationshipPicker(tag, 'relatedIds', 'Related topics', 'Connect topics that overlap without meaning the same thing.'),
      field('Paper matching', select('tag-matching-mode', tag.matchingMode || (tag.custom ? 'suggest' : 'auto'), [['manual', 'Only when I choose'], ['suggest', 'Suggest paper matches'], ['auto', 'Match automatically']], value => { tag.matchingMode = value; }), 'Matching new papers automatically also needs your explicit switch on Assign tags.'),
      tag.custom && !tag.id ? button('Use RCL example', () => { tag.name = 'RCL';tag.fullName = 'Catalyst-layer resistance';tag.description = 'Catalyst-layer resistance in water electrolysis or fuel cells.';render(); }, 'quiet small') : null);
    advanced.open = editorAdvancedOpen;
    listen(advanced,'toggle', event => { const current=event.currentTarget as HTMLDetailsElement;if (current.isConnected) editorAdvancedOpen = current.open; });
    const form = h('form', 'editor-scroll',
      orphaned ? h('p', 'notice warning', 'This tag left the suggested list. Copy your changes, save them to your tag library, or cancel this draft. Matching will start with suggestions; suggested-list relationships are not copied.') : null,
      nativeRow ? h('p','card-description',nativeRow.chosenMeaning ? 'Your meaning is selected. Revisions may require new checks of the linked papers.' : nativeHasDraft(nativeRow) ? 'This draft is not selected yet. Saving uses this meaning in your tag library. Existing paper tags stay unchanged.' : 'Saving uses this meaning in your tag library. Existing paper tags stay unchanged.') : null,
      field('Tag name', input('tag-name', tag.name, value => { tag.name = value; }, 'A short name you recognize')),
      field('Meaning', textarea('tag-description', tag.description, value => { tag.description = value; }, 'What should papers with this tag discuss?')),
      advanced);
    form.id = 'tag-editor-form';
    form.setAttribute('data-view-key',draftKey);
    if (tag.id && !preparationId && !nativeEntry) {
      const saved = tagById(tag.id);
      const unsaved = !saved || definitionKey(tag) !== definitionKey(saved);
      form.append(h('details', 'section-gap', h('summary', '', 'More actions'), field('Find matches in', select<Scope>('detail-preview-scope', detailScope, [['selected', 'Selected papers in Zotero'], ['collections', 'Selected collections'], ['library', 'Whole personal library'], ['pilot', 'Pilot · 50 papers']], value => { detailScope = value; })), h('div', 'actions', button('Preview matches', async () => { requireSavedDetail(tag);const result = await run('preview-detail', { tagId: tag.id, scope: detailScope, processingPolicy: 'auto-clear' });navigate({page:'assignment',assignmentRunId:result?.runId});assignmentView = 'suggestions';render(); }, '', !canAnalyze() || unsaved || tag.matchingMode === 'manual'), button('Assign to selected papers', () => { requireSavedDetail(tag);return run('assign-detail', { tagId: tag.id, scope: 'selected' }, 'Tag assigned to the selected papers.'); }, '', unsaved)), h('p', 'card-description', 'Save your changes before matching or assigning papers.')));
    }
    const save = async () => {
      if (busy) return;
      if (orphaned) throw new Error('This tag left the suggested list. Save it to your tag library or cancel the draft.');
      if (!tag.name.trim() || !tag.description.trim()) {
        const missing = doc.getElementById(!tag.name.trim() ? 'tag-name' : 'tag-description');missing?.setAttribute('aria-invalid', 'true');missing?.focus();
        throw new Error('Add a tag name and meaning before saving.');
      }
      const submitted = copyTag(tag);
      delete submitted.nativeBindingExclusions;
      if (nativeEntry) {
        const work = currentState().nativeDefinitionPreparation;
        if (work?.id !== nativeEntry.workId || !nativeMeaningRows().some(row => row.id === nativeEntry.entryId)) throw new Error('This meaning preparation changed. Reopen the tag before saving.');
        await run('edit-tag-meaning', { id: nativeEntry.workId, entryId: nativeEntry.entryId, tag: submitted });
        notify(nativeMeaningSaveMessage(nativeEntry.workId,nativeEntry.entryId));
      } else if (preparationId) {
        if (currentState().tagPreparation?.id !== preparationId) throw new Error('This tag list has changed. Open the tag again before saving.');
        await run('edit-prepared-tag', { id: preparationId, tag: submitted }, 'Tag saved.');
      } else await run(!tag.id ? 'create-detail' : 'save-tag', { tag: submitted, ...(!tag.id && newTagShelfId ? { tagShelfId: newTagShelfId } : {}) }, 'Tag saved.');
      editorDrafts.delete(draftKey);
      if (editorTag === tag) { editorTag = null;editorPreparationId = '';editorNativeEntry = null;pendingEditorFocus = editorReturnFocus;render(); }
    };
    const saveAsDetail = async () => {
      if (busy) return;
      if (!tag.name.trim() || !tag.description.trim()) throw new Error('Add a tag name and meaning before saving.');
      await run('create-detail', { tag: { ...copyTag(tag), id: '', custom: true, status: 'draft', matchingMode: 'suggest', broaderIds: [], relatedIds: [] } }, 'Tag saved.');
      editorDrafts.delete(`${preparationId}:${tag.id}`);
      if (editorTag === tag) { editorTag = null;editorPreparationId = '';render(); }
    };
    listen(form,'submit', event => { event.preventDefault();void save().catch(showError); });
    const cancel = () => { editorDrafts.delete(draftKey);editorTag = null;editorPreparationId = '';editorNativeEntry = null;pendingEditorFocus = editorReturnFocus;render(); };
    const saveButton = h('button', orphaned ? '' : 'primary', 'Save');saveButton.id = 'save-tag';saveButton.type = 'submit';saveButton.setAttribute('form',form.id);saveButton.disabled = orphaned || busy;
    const close = button('Close editor',closeEditor,'quiet small');close.id = 'close-tag-editor';
    const discard = button('Discard changes',cancel,'quiet');discard.id = 'discard-tag-draft';
    const status = h('span', 'editor-status','Unsaved changes');status.id = 'tag-editor-status';status.hidden = !editorDirty();status.setAttribute('aria-live','polite');
    const editor = h('section', 'card editor tag-editor', h('div', 'card-header inline between', h('h2', '', tag.id ? `Edit ${tag.name}` : 'Add a tag'),close), form, h('div', 'card-footer editor-footer',status,saveButton,orphaned ? button('Save to tag library', saveAsDetail, 'primary') : null,discard));editor.id='tag-editor';
    listen(editor,'keydown', event => {
      if (busy || event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();closeEditor(); }
      else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault();event.stopPropagation();void save().catch(showError); }
    });
    return editor;
  }
  function workingTags(preparation?: ManagerSnapshot['tagPreparation']) { return (preparation?.tags || approvedTags()).filter(tag => !tag.builtin); }
  function tagShelfOptions(forAssignment = false): [string,string][] {
    const s = currentState();
    const readyTags=forAssignment ? assignmentTags() : approvedTags();
    const label = (name: string, total: number, ready: number) => `${name} · ${total}${total === ready ? ' tags' : ` total · ${ready} ready`}`;
    return [['all', label('All tags', s.totals?.tags??s.tagLibraryEntries?.length??approvedTags().length, forAssignment?s.totals?.assignableTags??readyTags.length:s.totals?.definedTags??readyTags.length)], ...(s.tagShelves || []).filter(shelf=>shelf.id!==UNDEFINED_TAGS_SHELF).map(shelf => [shelf.id, label(shelf.name, shelf.count, (forAssignment?shelf.assignableCount:shelf.readyCount)??readyTags.filter(tag => shelf.tagIds.includes(tag.id)).length)] as [string,string]),...(!forAssignment?[[UNDEFINED_TAGS_SHELF,'My tags without meanings'] as [string,string]]:[])];
  }
  function libraryShelfControls(search: HTMLElement) {
    const virtual=libraryTagShelfId===UNDEFINED_TAGS_SHELF,shelf = virtual?undefined:currentState().tagShelves?.find(shelf => shelf.id === libraryTagShelfId);
    const merge = () => {
      mergeShelfIds.clear();if (shelf) mergeShelfIds.add(shelf.id);
      mergedShelfName = 'Combined tags';let suffix = 2;while (currentState().tagShelves?.some(value => value.name === mergedShelfName)) mergedShelfName = `Combined tags ${suffix++}`;
      modal = {kind:'merge-shelves'};render();
    };
    const controls = h('div', 'shelf-controls', field('Shelf', select('tag-library-shelf', libraryTagShelfId, tagShelfOptions(), value => { browseTags();buildRunFilter=null;libraryTagShelfId = value;if(value===UNDEFINED_TAGS_SHELF)libraryTagStatus='undefined';vocabularyPage = 0;renamingShelf = '';render(); }, 'Tag library shelf')), field('Show', select('tag-library-status', virtual?'undefined':libraryTagStatus, [['all','All tags'],['ready','Defined'],['undefined','Needs meaning']], value => { browseTags();buildRunFilter=null;libraryTagStatus = value;vocabularyPage = 0;render(); }, 'Tag readiness',virtual)), !virtual?details('Shelf options',libraryShelfOptionsOpen,value => { libraryShelfOptionsOpen = value; },() => h('div','shelf-buttons',button('Merge shelves…',merge,'small',(currentState().tagShelves?.length || 0) < 2),shelf ? button('Rename shelf…',() => { renamingShelf = shelf.id;shelfNameDrafts.set(shelf.id,shelf.name);render(); },'quiet small') : null)):null);
    if (shelf && renamingShelf === shelf.id) controls.append(field('Shelf name', input('tag-shelf-name', shelfNameDrafts.get(shelf.id) ?? shelf.name, value => { shelfNameDrafts.set(shelf.id, value); })), button('Save shelf name', async () => { await run('rename-tag-shelf', { id: shelf.id, name: (shelfNameDrafts.get(shelf.id) || '').trim() }, 'Shelf renamed.');renamingShelf = '';render(); }, 'small'), button('Cancel rename', () => { renamingShelf = '';render(); }, 'small quiet'));
    controls.querySelector('details')?.classList.add('library-shelf-options');
    return h('div','library-toolbar',search,h('div','shelf-toolbar',controls));
  }
  function currentDrafts() {
    const drafts = new Map(editorDrafts);
    if (editorTag) drafts.set(editorDraftKey(editorTag), editorTag);
    return drafts;
  }
  function orphanedPreparedDrafts() {
    const preparation = state?.tagPreparation;
    if (!preparation) return [];
    const ids = new Set(preparationTags(preparation).map(tag => tag.id));
    return [...currentDrafts()].filter(([key, draft]) => key.startsWith(`${preparation.id}:`) && !ids.has(draft.id)).map(([, draft]) => draft);
  }
  function hasUnsavedPreparedChanges() {
    const preparation = state?.tagPreparation;
    if (!preparation) return false;
    for (const [key, draft] of currentDrafts()) {
      const relevant = key.startsWith(`${preparation.id}:`) || (key.startsWith(':') && draft.custom);
      if (!relevant) continue;
      const saved = preparationTags(preparation).find(tag => tag.id === draft.id);
      if (!saved || definitionKey(saved) !== definitionKey(draft)) return true;
    }
    return false;
  }
  function updateTagApplyState() {
    updateEditorState();
    updateNativeMeaningState();
    const apply = doc.getElementById('apply-tag-list') as HTMLButtonElement | null;
    if (!apply || !state?.tagPreparation) return;
    const dirty = hasUnsavedPreparedChanges();
    apply.disabled = busy || !state.tagPreparation.canApply || state.tagPreparation.status === 'checking' || dirty;
    const note = doc.getElementById('tag-apply-note');
    if (note) note.textContent = dirty ? 'Save or cancel your edits before applying this tag list.' : 'Next, choose which papers to tag. No paper tags change yet.';
  }
  async function applyTagList(preparation: NonNullable<ManagerSnapshot['tagPreparation']>) {
    const result = await run('apply-tag-list', { id: preparation.id });
    if (result?.page === 'cleanup') { notify(currentState().tagPreparation?.status === 'questions' ? 'Answer the remaining questions before applying.' : 'Your additions are being compared with the current tag list.');return; }
    notify('Tag list saved. Choose which papers to tag next.');
    buildMode = 'extend';buildScope = 'selected';assignmentView = 'setup';nav('assignment');
  }
  function addNativeMeaning(name: string) {
    newTag(true, undefined, false);editorTag!.name = name;editorTag!.fullName = name;editorTag!.aliases = [name];render();focusTagEditorField('tag-description');
  }
  function nativeMeaningTag(row: NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>['rows'][number]): DisplayTag {
    return {id:row.tagId || row.id,name:row.name || row.sourceName,fullName:row.fullName ?? (row.name || row.sourceName),description:row.description || '',facet:row.facet || 'phenomenon',aliases:[...(row.aliases || [])],inclusions:[...(row.inclusions || [])],exclusions:[...(row.exclusions || [])],examples:[...(row.examples || [])],broaderIds:[...(row.broaderIds || [])],relatedIds:[...(row.relatedIds || [])],matchingMode:row.matchingMode || 'suggest',custom:false,status:'approved'};
  }
  function nativeMeaningChanged(workId: string, row: NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>['rows'][number]) {
    const draft = currentDrafts().get(`native:${workId}:${row.id}`);
    return !!draft && definitionKey(draft) !== definitionKey(nativeMeaningTag(row));
  }
  function updateNativeMeaningState() {
    const work = state?.nativeDefinitionPreparation;if (!work) return;
    const running = work.status === 'queued' || work.status === 'running';
    const unsaved = new Set(work.rows.filter(row => nativeMeaningChanged(work.id,row)).map(row => row.id));
    const ready = work.rows.filter(row => row.status === 'ready' && !row.applied && !excludedNativeMeaningRows.has(row.id));
    const disable = (id: string, value: boolean) => { const control = doc.getElementById(id) as HTMLButtonElement | null;if (control) control.disabled = busy || value; };
    disable('save-native-meanings',running || !work.canApply || ready.some(row => unsaved.has(row.id)));
    disable('finish-native-meanings',!!unsaved.size);
    disable('continue-native-meanings',running || work.rows.some(row => row.needsContinuation && unsaved.has(row.id)));
    disable('use-clear-native-meanings',!work.canUseClearMeanings || work.rows.some(row => row.canConfirmClear && unsaved.has(row.id)));
    for (const row of work.rows) {
      disable(`leave-native-meaning-${row.id}`,running || unsaved.has(row.id));
      disable(`use-native-proposed-${row.id}`,running || unsaved.has(row.id));
      disable(`retry-native-proposed-${row.id}`,running || unsaved.has(row.id) || !canAnalyze() || currentState().canPrepareNativeMeanings === false);
      disable(`suggest-native-meaning-${row.id}`,running || unsaved.has(row.id));
      for (const choice of row.choices || []) disable(`answer-native-meaning-${row.id}-${choice.id}`,running || unsaved.has(row.id));
    }
    const note = doc.getElementById('native-meaning-edit-note');
    if (note) { note.hidden = !unsaved.size;note.textContent = unsaved.size ? 'Save or cancel your edits before saving or answering those meanings.' : ''; }
  }
  function editNativeMeaning(workId: string, row: NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>['rows'][number]) {
    rememberEditorOrigin(`edit-native-meaning-${row.id}`);
    rememberEditorDraft();editorPreparationId = '';editorNativeEntry = {workId,entryId:row.id};
    const proposed = nativeMeaningTag(row);
    editorTag = copyTag(editorDrafts.get(editorDraftKey(proposed)) || proposed);relationQueries.clear();openRelationshipPickers.clear();render();focusTagEditorField('tag-description');
  }
  function openNativeMeanings(target?:{workId:string;entryId:string}) { nativeMeaningPage=0;deferredReviewOpen=false;pendingNativeReview=target??null;requestedNativeWorkId=target?.workId??currentState().nativeDefinitionPreparation?.id;nav('vocabulary',true); }
  async function openMeaningTask(task:NonNullable<ManagerSnapshot['activityTasks']>[number]) {
    const workId=task.workId,current=currentState();
    if(workId&&current.nativeDefinitionPreparation?.id!==workId){
      const item=current.reviewItems?.find(item=>item.ownerPage==='vocabulary'&&item.state!=='resolved'&&(item.workId===workId||item.taskId===task.id));
      if(item){await openReviewItem(item);return;}
      const result=await run('open-meaning-work',{id:workId,taskId:task.id});openNativeMeanings({workId,entryId:typeof result?.entryId==='string'?result.entryId:''});return;
    }
    openNativeMeanings(workId?{workId,entryId:''}:undefined);
  }
  function openNativeSourceReview(row: NativeMeaningRow) {
    const work=currentState().nativeDefinitionPreparation,item=(currentState().reviewItems || []).find(item => item.ownerPage === 'vocabulary' && item.workId === work?.id && item.questionId === row.id && item.state !== 'resolved');
    if (item?.state === 'deferred') deferredReviewOpen=true;
    if (work && work.processingPolicy !== 'auto-clear' && row.status === 'question') {
      if (nativeMeaningWorkId !== work.id) { nativeMeaningWorkId=work.id;excludedNativeMeaningRows.clear(); }
      const index=work.rows.filter(row => !row.applied && row.status !== 'left-undefined').findIndex(entry => entry.id === row.id);
      if (index >= 0) nativeMeaningPage=Math.floor(index/20);
    }
    requestedNativeWorkId=work?.id;pendingNativeReview=work?{workId:work.id,entryId:row.id}:null;nativeMeaningReviewHidden=false;render();
    const target=row.status === 'question' ? doc.getElementById(`native-review-${row.id}`) || (item ? doc.getElementById(`deferred-review-${item.id}`) : null) || doc.getElementById(`edit-native-meaning-${row.id}`) || doc.getElementById('native-meaning-summary') : doc.getElementById('native-meaning-summary');
    target?.scrollIntoView({block:'nearest'});target?.focus({preventScroll:true});
  }
  function nativeMeaningsReview() {
    const work = currentState().nativeDefinitionPreparation;
    if (!work || work.status === 'finished' && !(work.questionCount||work.deferredCount||nativeMeaningRows().some(row=>!row.applied&&row.status==='question'))&&!(work.processingPolicy === 'auto-clear' && work.lastChangeId)) return null;
    if (work.processingPolicy === 'auto-clear') {
      const displayedRows=nativeMeaningRows(),displayedIds=new Set(displayedRows.map(row=>row.id));
      const items = (currentState().reviewItems || []).filter(item => item.kind === 'definition' && (item.taskId === work.id || item.workId === work.id)&&(!remotePage('meanings')||!!item.questionId&&displayedIds.has(item.questionId)));
      const itemFor=(row:NativeMeaningRow)=>items.find(item=>item.questionId===row.id||item.id===row.reviewId);
      const questions = displayedRows.filter(row => !row.applied && row.status === 'question' && !['deferred','resolved'].includes(itemFor(row)?.state??''));
      const deferredCount = work.deferredCount??items.filter(item => item.state === 'deferred').length;
      const meaningQuestions = work.rows.length>=work.total?questions.length:Math.max(questions.length,Math.max(0,(work.questionCount??questions.length+deferredCount)-deferredCount));
      const savedCount = work.savedCount ?? 0;
      const summary = h('div', '',h('p', '', `${work.status === 'running' || work.status === 'queued' ? 'Defining tag meanings · ' : ''}${savedCount} ${savedCount === 1 ? 'meaning' : 'meanings'} saved${meaningQuestions ? ` · ${meaningQuestions} to use or skip` : ''}${deferredCount ? ` · ${deferredCount} left for later` : ''}.`),
        work.status === 'running' || work.status === 'queued' ? h('p', 'card-description',`${work.completed} of ${work.total} names checked. You can keep browsing.`) : null,
        work.error ? h('p', 'notice warning',humanMessage(work.error)) : null);
      if (!currentState().reviewItems) { const clear=clearNativeMeanings(work);if (clear) summary.append(clear); }
      const actions = h('div', 'task-actions',nativeMeaningReviewHidden && (meaningQuestions || deferredCount) ? button(meaningQuestions ? 'Choose meanings' : 'Open deferred meanings',() => {openNativeMeanings();if(!meaningQuestions&&deferredCount){deferredReviewOpen=true;render();}},'small') : null,
        !nativeMeaningReviewHidden ? button('Back to tags',() => { browseTags();render(); },'quiet small') : null,
        work.status === 'paused' ? button('Retry meanings',() => run('retry-tag-meanings',{id:work.id}),'small') : null,taskUndo(work.lastChangeId,'undo-native-meaning-change'));
      const fallbackRows=questions.filter(row=>!itemFor(row));
      const fallback = fallbackRows.length&&!nativeMeaningReviewHidden ? h('div', 'stack',...fallbackRows.map(row => nativePersonalReview(row) ? nativeReviewTarget(h('article','tag-row',h('strong','',row.sourceName),h('p','','How should Smart Tags use this personal label?'),nativePersonalActions(work.id,row)),row) : nativeReviewTarget(h('article', 'tag-row',h('strong', '', row.sourceName),nativeMeaningSupport(row) || nativeDraftMeaning(row),nativeSavedMeanings(row),h('p', '',nativeDecisionMessage(row)),nativeDecisionActions(work.id,row)),row))) : null;
      const taskSummary=h('section','task-summary library-meaning-summary',summary,actions);taskSummary.id='native-meaning-summary';taskSummary.tabIndex=-1;
      return h('div', 'stack',taskSummary,
        !nativeMeaningReviewHidden ? reviewInbox(items,'Needs your choice',true,deferredCount) : null,fallback,!nativeMeaningReviewHidden&&!meaningQuestions&&!deferredCount&&!['queued','running'].includes(work.status)?h('p','card-description','All checked meanings are saved or skipped.'):null,!nativeMeaningReviewHidden&&hasPages(work.rows.length,20,'meanings')?pagination(work.rows.length,nativeMeaningPage,next=>{nativeMeaningPage=next;},20,'meanings'):null);
    }
    if (work.id !== nativeMeaningWorkId) { nativeMeaningWorkId = work.id;nativeMeaningPage = 0;excludedNativeMeaningRows.clear(); }
    if (nativeMeaningReviewHidden) return null;
    const rows = nativeMeaningRows().filter(row => !row.applied && row.status !== 'left-undefined'), ready = rows.filter(row => row.status === 'ready' && !excludedNativeMeaningRows.has(row.id));
    const questions = rows.filter(row => row.status === 'question').length;
    const unsaved = new Set(work.rows.filter(row => nativeMeaningChanged(work.id,row)).map(row => row.id));
    const savedCount = work.savedCount ?? work.rows.filter(row => row.applied).length;
    const leftCount = work.leftUndefinedCount ?? work.rows.filter(row => row.status === 'left-undefined').length;
    if(!remotePage('meanings'))nativeMeaningPage = Math.min(nativeMeaningPage,Math.max(0,Math.ceil(rows.length / 20) - 1));
    const running = work.status === 'running' || work.status === 'queued';
    const summary = running ? `${work.completed} of ${work.total} names prepared` : questions ? `${questions} ${questions === 1 ? 'tag needs' : 'tags need'} attention.${ready.length ? ' Ready meanings can be saved separately.' : ' Use the actions below, or leave a name undefined.'}` : rows.length ? 'Save the ready meanings together. Paper tags stay unchanged.' : `${savedCount} saved · ${leftCount} left undefined. Paper tags are unchanged.`;
    const body = h('div','native-meaning-review',h('p','card-description',summary));
    const editNote = h('p','notice info');editNote.id = 'native-meaning-edit-note';editNote.hidden = !unsaved.size;body.append(editNote);
    const spentUSD = work.spentUSD ?? 0;
    if (spentUSD > 0) body.append(h('p','card-description',`Estimated API use: $${spentUSD.toFixed(4)}${work.budgetUSD === undefined ? '' : ` of $${work.budgetUSD.toFixed(2)}`}`));
    if (work.error) body.append(h('p','notice warning',humanMessage(work.error)));
    const clear=clearNativeMeanings(work);if (clear) body.append(clear);
    for (const row of pageRows(rows,nativeMeaningPage,20,'meanings')) {
      if (nativePersonalReview(row)) { body.append(nativeReviewTarget(h('article','tag-row',h('div','inline between',h('strong','',row.sourceName),badge('Personal label','draft')),h('p','','How should Smart Tags use this personal label?'),nativePersonalActions(work.id,row,unsaved.has(row.id))),row));continue; }
      const suggestible = row.canSuggestMeaning ?? row.needsContinuation;
      const source = row.name && row.name !== row.sourceName ? h('p','card-description',`From: ${row.sourceName}`) : null;
      const heading = row.status === 'ready' ? checkbox(`prepared-native-tag-${row.id}`,!excludedNativeMeaningRows.has(row.id),row.name || row.sourceName,checked => { checked ? excludedNativeMeaningRows.delete(row.id) : excludedNativeMeaningRows.add(row.id);render(); }) : h('strong','',row.sourceName);
      const article = h('article','tag-row',h('div','inline between',heading,row.status === 'ready' ? badge(row.targetTagId ? 'Use saved tag' : 'New tag','approved') : row.status === 'pending' ? badge('Waiting') : badge(nativeSourceReview(row) ? 'Meaning selected' : row.canConfirmClear ? 'Clear draft' : suggestible ? 'Needs a draft' : row.questionKind === 'information' ? 'Needs information' : row.questionKind === 'protection' ? 'Protected choice' : 'Needs your choice','draft')),source,nativeMeaningSupport(row) || nativeDraftMeaning(row),nativeSavedMeanings(row),row.status === 'question' || row.status === 'failed' ? h('p','card-description',row.questionKind === 'protection' ? 'An earlier tag choice is protected. You can skip defining this tag; its paper tags stay unchanged.' : nativeDecisionMessage(row)) : null,row.paperIds.length && !row.chosenMeaning ? h('div','warning-papers',...row.paperIds.slice(0,3).map(id => paperButton(id))) : null);
      nativeReviewTarget(article,row);
      if (row.status !== 'pending') article.append(nativeDecisionActions(work.id,row,undefined,running || unsaved.has(row.id)));
      body.append(article);
    }
    if (hasPages(rows.length,20,'meanings')) body.append(pagination(rows.length,nativeMeaningPage,next => { nativeMeaningPage = next; },20,'meanings'));
    const saveReady = async () => {
      await run('apply-tag-meanings',{id:work.id,rowIds:ready.map(row => row.id)},'Tag meanings saved. Paper tags are unchanged.');
      const saved = currentState().nativeDefinitionPreparation?.rows.filter(row => row.applied).map(row => row.id) || [];
      for (const id of saved) editorDrafts.delete(`native:${work.id}:${id}`);
      if (editorNativeEntry?.workId === work.id && saved.includes(editorNativeEntry.entryId)) { editorTag = null;editorNativeEntry = null;render(); }
    };
    const continueInFooter = work.canContinue && rows.some(row => row.needsContinuation && row.questionKind !== 'information' && row.questionKind !== 'protection') && !rows.some(row => row.canSuggestMeaning ?? row.needsContinuation);
    const actions = h('div','inline',ready.length ? button(`Save ${ready.length} ${ready.length === 1 ? 'meaning' : 'meanings'}`,saveReady,'primary',running || !work.canApply || ready.some(row => unsaved.has(row.id))) : null,!rows.length && !running ? button('Done',async () => { await run('finish-tag-meanings',{id:work.id},'Meaning preparation finished.');browseTags();render(); },'primary',!!unsaved.size) : null,continueInFooter ? button('Continue preparation',() => run('continue-tag-meanings',{id:work.id},'Preparing the remaining choices.'),ready.length ? 'small' : 'primary',running || rows.some(row => row.needsContinuation && unsaved.has(row.id))) : work.status === 'paused' ? button('Resume preparation',() => run('retry-tag-meanings',{id:work.id},'Preparing the remaining meanings.'),'small') : null,button('Back to tags',() => { browseTags();render(); },'quiet small'),rows.length ? button('Close preparation',() => run('cancel-tag-meanings',{id:work.id},'Preparation closed. Paid work remains in history.'),'quiet small') : null);
    if (ready.length) actions.children[0].id = 'save-native-meanings';
    else if (!rows.length && !running) actions.children[0].id = 'finish-native-meanings';
    if (continueInFooter) [...actions.children].find(control => control.textContent === 'Continue preparation')!.id = 'continue-native-meanings';
    const panel = card(work.status === 'queued' ? 'Meanings queued' : running ? 'Preparing meanings…' : work.status === 'paused' ? 'Meaning preparation paused' : 'Prepared meanings',work.status === 'queued' ? 'Starts after the current analysis finishes.' : 'Names and meanings are based on the linked papers.',body,actions,'native-meaning-panel');
    panel.id='native-meaning-summary';panel.tabIndex=-1;
    const scroll = panel.querySelector<HTMLElement>('.card-body')!;scroll.id = 'tag-list-scroll';scroll.setAttribute('data-view-key',`meanings:${work.id}:${nativeMeaningPage}`);
    return panel;
  }
  function renderVocabulary(prepared = false) {
    const s = currentState();
    const preparation = prepared ? s.tagPreparation : undefined;
    const editorVisible = !!editorTag && (!editorNativeEntry || !nativeMeaningReviewHidden && s.nativeDefinitionPreparation?.id === editorNativeEntry.workId) && (preparation ? editorPreparationId === preparation.id || editorTag.custom : !editorPreparationId);
    const extending = !!preparation && s.workflow?.buildMode === 'extend';
    const query = vocabQuery.trim().toLocaleLowerCase();
    const shelf = !prepared ? s.tagShelves?.find(shelf => shelf.id === libraryTagShelfId) : undefined;
    const libraryEntries = !prepared ? shelf ? shelf.nativeNames : s.tagLibraryEntries : undefined;
    const nativeRows=new Map((s.nativeDefinitionPreparation?.rows || []).map(row => [row.sourceName,row]));
    const personalName=(name: string) => (s.nativeTagTreatments?.[canonicalTagKey(name)] ?? nativeRows.get(name)?.personalTreatment) === 'personal';
    const personalQuestions=new Map((s.nativeDefinitionPreparation?.rows || []).filter(row => !row.applied && row.status === 'question' && nativePersonalReview(row)).map(row => [row.sourceName,row]));
    const nativeSourceRows=new Map((s.nativeDefinitionPreparation?.rows || []).filter(row => !row.applied && row.status !== 'left-undefined' && !nativePersonalReview(row)).map(row => [row.sourceName,row]));
    if (!prepared) for (const name of selectedNativeNames) if (personalName(name) || personalQuestions.has(name) || nativeSourceRows.has(name)) selectedNativeNames.delete(name);
    if (!prepared && s.tagLibraryEntries && !remotePage('tags')) {
      const available = new Set(s.tagLibraryEntries.filter(entry => !entry.tagId && !entry.protected && entry.name !== 'no_tag' && !nativeSourceRows.has(entry.name) && !personalQuestions.has(entry.name) && !personalName(entry.name)).map(entry => entry.name));
      for (const name of selectedNativeNames) if (!available.has(name)) selectedNativeNames.delete(name);
    }
    const nativeNames = remotePage('tags')?libraryEntries:libraryEntries?.filter(entry => { const tag = entry.tagId ? tagById(entry.tagId) : undefined;return (libraryTagStatus === 'all' || libraryTagStatus === 'ready' && !!tag || libraryTagStatus === 'undefined' && !tag && !entry.protected && entry.name !== 'no_tag' && !personalName(entry.name)) && (!query || (tag ? conceptText(tag) : entry.name.toLocaleLowerCase()).includes(query)); });
    const tags = remotePage('tags')?workingTags(preparation):workingTags(preparation).filter(tag => (!shelf || shelf.tagIds.includes(tag.id)) && (!query || conceptText(tag).includes(query)) && (prepared || libraryTagStatus !== 'undefined'));
    const questions = preparation?.questions || [];
    const view = preparation && questions.length ? tagView : 'tags';
    const savedIds = new Set(approvedTags().map(tag => tag.id));
    const addedCount = preparation?.tags.filter(tag => !savedIds.has(tag.id)).length || 0;
    if(!remotePage('tags'))vocabularyPage = Math.min(vocabularyPage, Math.max(0, Math.ceil((nativeNames?.length??tags.length)/20) - 1));
    if(!remotePage('questions'))tagQuestionPage = Math.min(tagQuestionPage, Math.max(0, Math.ceil(questions.length/10) - 1));
    const status = preparation?.status === 'checking' ? 'Checking your tags…' : preparation?.status === 'questions' ? `${questions.length} ${questions.length === 1 ? 'question needs' : 'questions need'} your choice` : preparation?.status === 'failed' ? 'Your tag list needs another try' : preparation ? 'Your tag list is ready' : shelf?.name || 'Your tags';
    const add = button('Add tag', () => newTag(true), preparation ? 'quiet' : 'primary');add.id = 'add-tag';
    const header = h('div', `tag-workspace-header${preparation ? '' : ' library-overview'}`, h('div', '', preparation ? h('h2', '', status) : null, h('p', 'card-description', extending ? `${savedIds.size} saved + ${addedCount} new = ${savedIds.size + addedCount} total · ${preparation!.scopeCount} papers` : preparation ? `${pageTotal(preparation.tags.length,'tags')} tags · ${preparation.scopeCount} papers · preferred count ${preparation.targetCount}` : libraryEntries ? `${s.totals?.tags??libraryEntries.length} tags` : `${s.totals?.tags??workingTags().filter(tag => !shelf || shelf.tagIds.includes(tag.id)).length} saved tags`), extending ? h('p', 'card-description', preparation?.needsRefresh ? 'Your saved tags changed. Compare these additions with the current list and apply.' : 'Your saved tags are kept.') : null), h('div', 'inline', add, preparation ? button(preparation.needsRefresh ? 'Update and apply' : 'Apply tag list', () => applyTagList(preparation), 'primary', !preparation.canApply || preparation.status === 'checking') : null));
    if (preparation) header.querySelector<HTMLButtonElement>('.primary')!.id = 'apply-tag-list';
    const tabs = h('div', 'tag-workspace-tabs');
    tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', 'Tags and questions');
    for (const [value, label] of [['tags', 'Tags'], ['questions', `Questions (${questions.length})`]] as const) {
      const tab = button(label, () => { tagView = value;render(); }, view === value ? 'selected' : 'quiet');
      tab.setAttribute('role', 'tab');tab.setAttribute('aria-selected', String(view === value));tabs.append(tab);
    }
    function clearLibrarySearch() { vocabQuery = '';vocabularyPage = 0;if(!prepared)browseTags();render();doc.getElementById('vocabulary-search')?.focus({preventScroll:true}); }
    function librarySearch() {
      const search=input('vocabulary-search',vocabQuery,value => { vocabQuery=value;vocabularyPage=0;if(!prepared)browseTags();render(); },'Find a tag or another name…','search');
      search.setAttribute('aria-label','Search tags');
      listen(search,'keydown',event => { if(event.key==='Escape' && vocabQuery) { event.preventDefault();event.stopPropagation();clearLibrarySearch(); } });
      const clear=vocabQuery ? button('Clear search',clearLibrarySearch,'quiet small') : null;
      if(clear){clear.id='clear-library-search';clear.setAttribute('aria-label','Clear tag search');}
      return h('div','library-search',field('Search tags',search),clear);
    }
    function linkedPapers(name:string,paperIds:string[]) {
      const panel=details('Linked papers',libraryLinkedPapersOpen.has(name),open => { open ? libraryLinkedPapersOpen.add(name) : libraryLinkedPapersOpen.delete(name); },() => h('div','warning-papers',...paperIds.slice(0,3).map(id => paperButton(id))));
      panel.classList.add('library-source-papers');panel.querySelector('summary')!.id=`linked-papers-${encodeURIComponent(name)}`;return panel;
    }
    const content = h('div', 'tag-workspace-list card');
    content.id = 'tag-list-scroll';content.setAttribute('data-view-key', `${preparation?.id || `library:${libraryTagShelfId}:${libraryTagStatus}:${vocabQuery}`}:${view}:${view === 'tags' ? vocabularyPage : tagQuestionPage}`);
    if (preparation?.status === 'failed') content.append(h('div', 'notice warning', h('p', '', humanMessage(preparation.error || 'We could not finish preparing tags. Your completed paper analysis is saved.')), button('Try again', () => run('retry-tag-preparation', { id: preparation.id }, 'Checking your tags again.'), 'small')));
    if (preparation?.status === 'checking') content.append(h('div', 'notice info', h('p', '', 'Your papers have been read. We are checking the tag names and meanings.'), s.queue.status !== 'running' ? button('Resume checks', () => run('retry-tag-preparation', { id: preparation.id }, 'Checking your tags.'), 'small') : null));
    if (view === 'questions') {
      if (!questions.length) content.append(empty('No questions waiting', 'You can browse or edit the tags before applying the list.', button('Back to tags', () => { tagView = 'tags';render(); }, 'quiet')));
      for (const question of pageRows(questions,tagQuestionPage,10,'questions')) {
        const cardBody = keyed(h('article', 'tag-question', h('h3', '', question.title), h('p', '', question.description)),`tag-question:${question.id}`);
        if (question.paperIds.length) cardBody.append(h('div', 'warning-papers', ...question.paperIds.slice(0, 3).map(id => paperButton(id))));
        const choices = h('div', 'question-choices');
        for (const choice of question.choices) {
          const answer = button(choice.label, () => run('answer-tag-question', { id: preparation!.id, questionId: question.id, choiceId: choice.id }, 'Choice saved.'), 'question-choice');
          answer.setAttribute('aria-label', choice.label);
          if (choice.description) answer.append(h('small', '', choice.description));choices.append(answer);
        }
        cardBody.append(choices);content.append(cardBody);
      }
      if (hasPages(questions.length,10,'questions')) content.append(pagination(questions.length, tagQuestionPage, next => { tagQuestionPage = next; }, 10, 'questions'));
    } else {
      if (prepared) content.append(h('div', 'tag-list-search', librarySearch()));
      else if (query) {const count=pageTotal(nativeNames?.length??tags.length,'tags');content.append(h('p','library-result-count',`${count} matching ${count===1?'tag':'tags'}`));}
      const selectable = (nativeNames || []).filter(entry => !entry.tagId && !entry.protected && entry.name !== 'no_tag' && !nativeSourceRows.has(entry.name) && !personalQuestions.has(entry.name) && !personalName(entry.name));
      if (!preparation && (selectable.length || selectedNativeNames.size)) {
        const selection = h('div','tag-meaning-selection',selectable.length ? button('Select all names',() => { for(const entry of selectable)selectedNativeNames.add(entry.name);render(); },'quiet small') : null);
        if (selectedNativeNames.size) selection.append(h('span','muted',`${selectedNativeNames.size} selected`),button('Suggest meanings',async () => { await run('prepare-tag-meanings',{names:[...selectedNativeNames],shelfId:libraryTagShelfId,processingPolicy:'auto-clear'},'Defining meanings from the selected tags and their papers.');selectedNativeNames.clear();render(); },'primary small',!canAnalyze() || s.canPrepareNativeMeanings === false || s.nativeDefinitionPreparation?.status === 'queued' || s.nativeDefinitionPreparation?.status === 'running'),button('Clear selection',() => { selectedNativeNames.clear();render(); },'quiet small'));
        content.append(selection);
      }
      if (!(nativeNames?.length ?? tags.length)) content.append(query ? empty('No matching tags', 'Try another name, or clear the search.',button('Clear search',clearLibrarySearch,'small')) : libraryTagStatus === 'undefined' ? empty('No meanings needed', 'The tags in this view already have meanings, or are kept as personal labels.') : libraryTagStatus === 'ready' ? empty('No defined tags here', 'Choose All tags to see names that still need a meaning.') : empty('No tags here yet', 'Build tags from a few papers, or add a tag of your own.'));
      for (const entry of pageRows(nativeNames||[],vocabularyPage,20,'tags')) {
        const tag = entry.tagId ? tagById(entry.tagId) : undefined;
        const protectedName = entry.protected || entry.name === 'no_tag' || tag?.builtin;
        if (personalName(entry.name) && !protectedName) {
          const row=nativeRows.get(entry.name),define=button('Ask AI for a scientific meaning',() => defineScientificMeaning(entry.name,row),'quiet small',!canAnalyze() || (row ? row.canSetTreatment !== true : s.canPrepareNativeMeanings === false));define.setAttribute('aria-label',`Ask AI for a scientific meaning for ${entry.name}`);
          content.append(h('article','tag-row',h('div','inline between',h('strong','',entry.name),define),h('p','card-description',`${entry.paperCount} ${entry.paperCount === 1 ? 'paper' : 'papers'} · Personal label · Automatic assignment off`)));continue;
        }
        const personal=personalQuestions.get(entry.name);
        if (personal && !protectedName) {
          const review=button('Review label',() => openNativeSourceReview(personal),'quiet small');review.setAttribute('aria-label',`Review personal label ${entry.name}`);
          content.append(h('article','tag-row',h('div','inline between',h('strong','',entry.name),review),h('p','card-description',`${entry.paperCount} ${entry.paperCount === 1 ? 'paper' : 'papers'} · Choose how to use this personal label`)));continue;
        }
        const sourceReview=nativeSourceRows.get(entry.name);
        if (sourceReview && !protectedName) {
          const action=sourceReview.status === 'question' ? 'Choose meaning' : s.nativeDefinitionPreparation?.status === 'paused' || sourceReview.status === 'failed' ? 'View paused checks' : 'View checks';
          const review=button(action,() => openNativeSourceReview(sourceReview),'quiet small');review.setAttribute('aria-label',`${action} for ${entry.name}`);
          content.append(h('article','tag-row',h('div','inline between',h('strong','',entry.name),review),h('p','card-description',`${entry.paperCount} ${entry.paperCount === 1 ? 'paper' : 'papers'} · ${sourceReview.chosenMeaning ? `Meaning selected: ${sourceReview.chosenMeaning.name}` : sourceReview.name ? `AI proposal: ${sourceReview.name}` : 'AI meaning preparation'}`),nativeSourceReview(sourceReview) ? h('p','card-description',nativeSourceMessage(sourceReview)) : null));continue;
        }
        const native=nativeRows.get(entry.name),savedMeaning=tag || (native?.applied ? tagById(native.targetTagId || native.tagId || '') : undefined);
        if (savedMeaning && !protectedName) { const savedRow=savedTagRow(savedMeaning,savedMeaning.currentlyTaggedCount ?? (native?.applied ? undefined : entry.paperCount)),notes=native?.applied && native.sourceIssues?.length ? nativeMeaningSupport(native) : null;if(notes){const noteKey=native!.id,panel=notes.querySelector('details');if(panel){panel.classList.add('library-saved-notes');panel.querySelector('summary')!.id=`saved-source-notes-${encodeURIComponent(noteKey)}`;panel.open=libraryNotesOpen.has(noteKey);listen(panel,'toggle',event => { const current=event.currentTarget as HTMLDetailsElement;if(current.isConnected)current.open ? libraryNotesOpen.add(noteKey) : libraryNotesOpen.delete(noteKey); });savedRow.append(panel);}}content.append(savedRow);continue; }
        const edit = !protectedName ? button('Add meaning', () => addNativeMeaning(entry.name), 'quiet small') : null;
        edit?.setAttribute('aria-label', `Add meaning for ${entry.name}`);
        content.append(keyed(h('article', 'tag-row', h('div', 'inline between', protectedName ? h('strong','',entry.name) : checkbox(`select-native-tag-${encodeURIComponent(entry.name)}`,selectedNativeNames.has(entry.name),entry.name,checked => { checked ? selectedNativeNames.add(entry.name) : selectedNativeNames.delete(entry.name);render(); }), edit), h('p', 'card-description', `${entry.paperCount} ${entry.paperCount === 1 ? 'paper' : 'papers'} · ${protectedName ? 'Excluded from tagging' : 'No meaning added'}`), entry.paperIds?.length ? linkedPapers(entry.name,entry.paperIds) : null),`native-tag:${entry.name}`));
      }
      for (const tag of pageRows(nativeNames?[]:tags,vocabularyPage,20,'tags')) {
        content.append(savedTagRow(tag));
      }
      if (hasPages(nativeNames?.length??tags.length,20,'tags')) content.append(pagination(nativeNames?.length ?? tags.length, vocabularyPage, next => { vocabularyPage = next; }, 20, 'tags'));
    }
    function savedTagRow(tag: DisplayTag, paperCount?: number) {
      const retained = !!preparation && tag.retained === true;
      const edit = button(retained ? 'Edit in tag library' : 'Edit', () => retained ? navigate({ page: 'vocabulary', tagId: tag.id }) : editTag(tag, preparation?.id || ''), 'small quiet');edit.setAttribute('aria-label', retained ? `Edit saved tag ${tag.name} in tag library` : `Edit tag ${tag.name}`);
      edit.id = `edit-tag-${encodeURIComponent(tag.id)}`;
      const actions = h('div', 'inline', edit);
      if (!retained) {
        const remove = button('Remove', async () => {
          if (busy) return;
          if (!preparation) { await run('delete-tag', { id: tag.id }, 'Tag removed from your list.'); }
          else await run('remove-prepared-tag', { id: preparation.id, tagId: tag.id }, 'Tag removed from this list.');
          editorDrafts.delete(`${preparation?.id || ''}:${tag.id}`);
          if (editorTag?.id === tag.id && editorPreparationId === (preparation?.id || '')) { editorTag = null;editorPreparationId = '';render(); }
        }, 'small quiet');remove.setAttribute('aria-label', `Remove tag ${tag.name}`);actions.append(remove);
      }
      const taggedCount = paperCount ?? tagById(tag.id)?.currentlyTaggedCount ?? tag.currentlyTaggedCount ?? 0;
      const countLabel = preparation && !retained ? `${tag.coverage ?? 0} ${preparation.verificationScope === 'representative' ? 'verified example papers' : 'papers in this build'}` : `${taggedCount} ${taggedCount === 1 ? 'paper' : 'papers'} tagged`;
      return keyed(h('article', 'tag-row', h('div', 'inline between', h('div', 'tag-heading', h('strong', '', tag.name), retained ? badge('Saved tag · kept unchanged') : null), actions), tag.fullName && tag.fullName !== tag.name ? h('p', 'concept-full-name', tag.fullName) : null, h('p', '', tag.description), h('div', 'tag-meta', h('span', '', countLabel), tag.aliases.length ? h('span', '', `Other names: ${tag.aliases.join(', ')}`) : null)),`tag:${preparation?.id||'saved'}:${tag.id}`);
    }
    const note = h('p', 'card-description', preparation ? 'Next, choose which papers to tag. No paper tags change yet.' : '');note.hidden = !preparation;
    note.id = 'tag-apply-note';
    const orphans = preparation ? orphanedPreparedDrafts() : [], draft = orphans[0];
    const reviewDraft = draft ? button('Review draft', () => editTag(draft, preparation!.id), 'small') : null;
    reviewDraft?.setAttribute('aria-label', `Review unsaved draft ${draft?.name}`);
    const discardDraft = draft ? button('Discard', () => {
      editorDrafts.delete(`${preparation!.id}:${draft.id}`);
      if (editorPreparationId === preparation!.id && editorTag?.id === draft.id) { editorTag = null;editorPreparationId = ''; }
      render();
    }, 'small quiet') : null;
    discardDraft?.setAttribute('aria-label', `Discard unsaved draft ${draft?.name}`);
    const recovery = draft ? h('div', 'notice warning inline between', h('span', '', `${draft.name} left the suggested list. Your unsaved edits are kept.${orphans.length > 1 ? ` ${orphans.length} drafts need a choice.` : ''}`), h('div', 'inline', reviewDraft, discardDraft)) : null;
    const meanings = !preparation ? nativeMeaningsReview() : null;
    const nativeWork = s.nativeDefinitionPreparation;
    const automaticMeanings = nativeWork?.processingPolicy === 'auto-clear';
    const reopenMeanings = !preparation && nativeWork && !automaticMeanings && nativeWork.status !== 'finished' && nativeMeaningReviewHidden ? h('div','notice info inline between',h('span','',nativeWork.status === 'running' || nativeWork.status === 'queued' ? 'Your tag meanings are being prepared. You can keep browsing.' : 'Prepared tag meanings are available. Your tag library is ready to browse.'),button('Review meanings',openNativeMeanings,'small')) : null;
    const buildScope=!prepared&&buildRunFilter?h('div','notice info inline between',h('span','',`${buildRunFilter.savedCount} ${buildRunFilter.savedCount===1?'tag':'tags'} saved by this build`),button('Back to library',()=>{buildRunFilter=null;libraryTagShelfId='all';libraryTagStatus='all';vocabularyPage=0;render();},'quiet small')):null;if(buildScope)buildScope.id='build-tag-filter';
    const workspace = h('div', `tag-workspace${prepared ? '' : ' tag-library'} ${editorVisible ? 'has-editor' : ''}`, header,buildScope, !prepared ? libraryShelfControls(librarySearch()) : null, preparation && questions.length ? tabs : null, note, recovery, reopenMeanings,automaticMeanings ? meanings : null, h('div', 'tag-workspace-columns', automaticMeanings ? content : meanings || content, tagEditor(editorVisible)));
    return workspace;
  }

  function renderCleanup() {
    const s = currentState();
    const outcome=buildOutcome();
    if (s.tagPreparation?.processingPolicy === 'auto-clear') {
      const preparation = s.tagPreparation, items = (s.reviewItems || []).filter(item => item.kind === 'definition' && (item.taskId === preparation.id || item.workId === preparation.id));
      const choices = s.reviewItems ? items.filter(item => item.state === 'open').length : preparation.questions.length;
      const deferredCount = items.filter(item => item.state === 'deferred').length;
      const openLibrary = () => { if (preparation.shelfId) libraryTagShelfId = preparation.shelfId;nav('vocabulary'); };
      const body = h('div', 'stack',h('p', '', `${preparation.savedCount ?? 0} tags saved${choices ? ` · ${choices} meanings need your choice` : ''}${deferredCount ? ` · ${deferredCount} left for later` : ''}.`),
        h('p', 'card-description', preparation.status === 'checking' ? 'Supported meanings are saved as their checks finish. Other choices can wait.' : 'Saved definitions are ready to use. Remaining choices do not block them.'),
        preparation.error ? h('p', 'notice warning',humanMessage(preparation.error)) : null,
        h('div', 'task-actions',button('Open tag library',openLibrary,'small'),button('Assign tags',() => { if (preparation.shelfId) assignmentTagShelfId = preparation.shelfId;assignmentView = 'setup';nav('assignment'); },'primary',!assignmentTagCount()),taskUndo(preparation.lastChangeId,'undo-build-change'),
          preparation.status === 'failed' ? button('Retry build',() => run('retry-tag-preparation',{id:preparation.id}),'small') : null));
      const fallback = !s.reviewItems && preparation.questions.length ? h('div', 'stack',...preparation.questions.map(question => h('article', 'tag-question',h('h3', '', question.title),h('p', '', question.description),
        ...question.choices.map(choice => button(choice.label,() => run('answer-tag-question',{id:preparation.id,questionId:question.id,choiceId:choice.id},'Meaning selected.'),'small'))))) : null;
      return h('div','stack',h('div','actions',button(buildSetupOpen ? 'Hide build setup' : 'Change build group',() => { buildSetupOpen = !buildSetupOpen;render(); },'quiet small')),buildSetupOpen ? renderBuild() : null,
        outcome??h('section','task-summary',h('h2','',preparation.status === 'checking' ? 'Building tags' : preparation.status === 'failed' ? 'Build needs attention' : 'Your tags are saved'),body),reviewInbox(items),fallback,editorPreparationId === preparation.id ? tagEditor() : null);
    }
    return s.tagPreparation ? h('div', 'stack',outcome, h('div', 'actions', button(buildSetupOpen ? 'Hide build setup' : 'Change build group', () => { buildSetupOpen = !buildSetupOpen;render(); }, 'quiet small')), buildSetupOpen ? renderBuild() : null, renderVocabulary(true)) : outcome?h('div','stack',outcome,renderBuild()):renderBuild();
  }
  function buildOutcome():Node|null {
    const result=currentState().buildResult;if(!result)return null;
    const running=result.status==='running',incomplete=result.status==='needs-information'||result.reason==='needs-information',failed=result.status==='failed',paused=result.status==='paused',unknown=result.status==='unknown';
    const preparation=currentState().tagPreparation,manualReview=result.status==='completed'&&!result.savedCount&&preparation&&preparation.processingPolicy!=='auto-clear'&&preparation.canApply;
    const title=running?'Building tags':paused?'Build paused':failed?'Build needs another try':incomplete?'More paper information is needed':unknown?'Earlier build':manualReview?'Tag list ready for review':'Build complete';
    const saved=`${result.savedCount} ${result.savedCount===1?'tag':'tags'} saved`,choices=result.questionCount?`${result.questionCount} ${result.questionCount===1?'meaning needs':'meanings need'} your choice`:'';
    const outcome=manualReview?'Your proposed replacement is ready. Review and save it to replace the current tag list.':result.savedCount||result.questionCount?[saved,choices].filter(Boolean).join(' · '):unknown?'This earlier build has no saved outcome details.':result.reason==='saved'?'No tags from this build remain in the saved library.':result.reason==='reused'?'Your existing tags already cover this group. No new tags were needed.':result.reason==='no-eligible-papers'?'No eligible papers were found in this group.':incomplete?'No tags were saved from the available paper information.':running?'Supported tags will appear as their checks finish.':paused||failed?'Completed work is saved.':'No new tags were needed for these papers.';
    const view=()=>{buildRunFilter={runId:result.runId,savedCount:result.savedCount};libraryTagShelfId='all';libraryTagStatus='all';vocabQuery='';vocabularyPage=0;nav('vocabulary');};
    const assign=()=>{if(result.shelfId)assignmentTagShelfId=result.shelfId;assignmentView='setup';nav('assignment');};
    const names=result.tagNames?.slice(0,8),summary=h('section','task-summary',h('h2','',title),h('p','',outcome),!unknown||result.paperCount?h('p','card-description',`${result.completedPaperCount} of ${result.paperCount} papers read`):null,names?.length?h('p','card-description',`Saved: ${names.join(', ')}${result.savedCount>names.length?` and ${result.savedCount-names.length} more`:''}.`):null,result.message?h('p',paused||failed||incomplete?'notice warning':'card-description',humanMessage(result.message)):null,h('div','task-actions',manualReview?button('Review tag list',()=>{doc.getElementById('apply-tag-list')?.scrollIntoView({block:'nearest'});doc.getElementById('apply-tag-list')?.focus({preventScroll:true});},'primary'):null,result.savedCount?button('View built tags',view,'primary'):null,result.savedCount?button('Assign tags',assign,'small'):null,result.questionCount?button('Choose meanings',()=>nav('activity'),'small'):null,incomplete||failed?button('Open Activity',()=>nav('activity'),'small'):null));summary.id='build-result';summary.setAttribute('aria-label','Tag build result');return summary;
  }

  function renderAssignment() {
    const s = currentState();
    const tabs = h('div', 'tag-workspace-tabs');tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', 'Assignment views');
    const pending = s.reviewItems ? new Set(s.reviewItems.filter(item => item.kind === 'assignment' && item.state === 'open').map(item => item.paperId)).size : s.suggestions.filter(item => item.status === 'pending' && !item.applied).length;
    for (const [value, label] of [['setup', 'New assignment'], ['suggestions', `Results (${pending})`]] as const) {
      const tab = button(label, () => { assignmentView = value;render(); }, assignmentView === value ? 'selected' : 'quiet');tab.setAttribute('role', 'tab');tab.setAttribute('aria-selected', String(assignmentView === value));
      if (value === 'setup') { tab.id = 'assignment-setup-toggle';tab.setAttribute('aria-label','Assignment setup'); }tabs.append(tab);
    }
    if (assignmentView === 'suggestions') return h('div', 'stack', tabs, renderReview());
    const shelf = s.tagShelves?.find(shelf => shelf.id === assignmentTagShelfId);
    const shelfTags = assignmentTags().filter(tag => !shelf || shelf.tagIds.includes(tag.id));
    const shelfTagCount=(shelf?shelf.assignableCount:undefined)??(shelf?shelfTags.length:assignmentTagCount());
    const unavailable = !canAnalyze() || !shelfTagCount || s.queue.status === 'running';
    const suggest = async () => { assignmentRunSelection = null;selectedSuggestions.clear();const result = await run('tag', { scope: assignmentScope, tagShelfId: assignmentTagShelfId, processingPolicy: 'auto-clear' }, 'Assigning supported tags. Other choices can wait.');if (result?.runId) assignmentRunSelection = result.runId;assignmentView = 'suggestions';render(); };
    const assignButton = button('Assign tags', suggest, 'primary', unavailable);assignButton.id = 'start-assignment';assignButton.setAttribute('aria-label', 'Assign tags to these papers');
    const group = h('section', 'task-setup', field('Tags to use', select('assignment-tag-shelf', assignmentTagShelfId, tagShelfOptions(true), value => { assignmentTagShelfId = value;render(); }, 'Assignment tag shelf')),
      field('Papers', scopeSelect('assignment-scope', assignmentScope, value => { assignmentScope = value;render(); })),
      shelf && !shelfTagCount ? h('p', 'notice info', 'This shelf has no scientific tags available for assignment. Define a scientific meaning or choose another shelf.') : null,
      s.workflow?.assignmentScope === assignmentScope ? h('p', 'card-description', `${s.workflow.assignmentPaperCount} papers in the last chosen group · ${s.workflow.assignedPaperCount} with Smart Tags assignments`) : null,
      h('p', 'card-description', 'High-confidence additions apply automatically; other changes wait for your choice.'),h('div', 'task-actions', assignButton));
    const incoming = checkbox('assignment-auto-assign', s.settings.autoAssign, 'Tag new papers automatically', value => {
      void run('save-settings', { settings: { ...currentState().settings, autoAssign: value } }, value ? 'Automatic tagging enabled for new papers.' : 'Automatic tagging disabled.').catch(showError);
    }, !shelfTagCount || !canAnalyze());
    const routine = h('details','incoming-settings',h('summary','',`For new papers · ${s.settings.autoAssign ? 'On' : 'Off'}`),incoming,h('p','card-description','Uses saved tags eligible for automatic matching, within your connection and spending limit.'));
    routine.open = incomingSettingsOpen;listen(routine,'toggle',event => { const current=event.currentTarget as HTMLDetailsElement;if (current.isConnected) incomingSettingsOpen = current.open; });
    return h('div', 'stack', tabs, !(s.totals?.definedTags??approvedTags().length) ? h('div', 'notice info inline between', h('span', '', 'Save a tag list before assigning paper tags.'), button('Build tags', () => nav('cleanup'), 'small')) : !canAnalyze() ? h('div', 'notice info inline between', h('span', '', 'Connect an AI model before assigning tags.'), button('Connect AI', () => nav('connection'), 'small')) : null,
      group,routine);
  }

  function nativeChanges(changes: { paperId: string; title: string; before: string[]; after: string[] }[], pageIndex: number, changed: (page: number) => void, noun: string,totalInput?:number,size=50) {
    const total=totalInput??changes.length,index = Math.min(pageIndex, Math.max(0, Math.ceil(total / size) - 1));
    const list = h('div', 'native-change-preview');
    for (const change of totalInput!==undefined?changes:changes.slice(index * size, (index + 1) * size)) list.append(h('article', 'paper-card', h('strong', '', change.title), h('p', '', `Before: ${change.before.join(', ') || 'No tags'}`), h('p', '', `After: ${change.after.join(', ') || 'No tags'}`)));
    if (!changes.length) list.append(h('p', 'card-description', 'No paper tags need to change.'));
    if (total > size) list.append(pagination(total, index, changed, size, noun));
    return list;
  }
  function syncKeepChoices() {
    const existing = currentState().existingTags;
    if (!existing) return;
    if(existing.total!==undefined){
      if(keepPlanId!==existing.id){keptNames.clear();keepDecisions.clear();keepDraftDirty=false;keepDraftStale=false;keepPlanId=existing.id;}
      for(const row of existing.rows)if(!keepDecisions.has(row.name)){if(row.kept||row.protected)keptNames.add(row.name);else keptNames.delete(row.name);}return;
    }
    const inventory = JSON.stringify(existing.rows.map(row => [row.name, row.paperIds, !!row.protected, !!row.locked]));
    if (keepPlanId && keepDraftDirty && (keepPlanId !== existing.id || keepInventoryKey !== inventory)) { keepDraftStale = true;return; }
    if (!keepPlanId || !keepDraftDirty) {
      keptNames.clear();for (const row of existing.rows) if (row.kept || row.protected) keptNames.add(row.name);
      keepPlanId = existing.id;keepInventoryKey = inventory;keepDraftStale = false;
    }
  }
  function renderKeepTags() {
    const existing = currentState().existingTags;syncKeepChoices();
    const all = existing?.rows || [], rows = existing?.total!==undefined?all:all.filter(row => (!existingTagQuery || row.name.toLocaleLowerCase().includes(existingTagQuery.toLocaleLowerCase())) && (keepFilter === 'all' || keepFilter === 'kept' && keptNames.has(row.name) || keepFilter === 'remove' && !keptNames.has(row.name) || keepFilter === 'protected' && row.protected));
    const total=existing?.total??rows.length;
    const running = existing?.status === 'queued' || existing?.status === 'running';
    existingTagPage = Math.min(existingTagPage, Math.max(0, Math.ceil(total / 30) - 1));
    const controls = h('div', 'toolbar', input('keep-tag-search', existingTagQuery, value => { existingTagQuery = value;existingTagPage = 0;render(); }, 'Find a tag name…', 'search'), select('keep-tag-filter', keepFilter, [['all', 'All names'], ['kept', 'Kept names'], ['remove', 'Names to remove'], ['protected', 'Always kept']], value => { keepFilter = value;existingTagPage = 0;render(); }, 'Keep choices'), button('Read library tags', () => run('refresh-existing-tags', {}, 'Existing tags refreshed.'), '', running));
    const list = h('section', 'card existing-tags-list');
    for (const row of existing?.total!==undefined?rows:rows.slice(existingTagPage * 30, (existingTagPage + 1) * 30)) {
      list.append(h('article', 'existing-tag-row', checkbox(`keep-name-${row.id}`, keptNames.has(row.name) || row.protected === true, row.name, checked => { checked ? keptNames.add(row.name) : keptNames.delete(row.name);keepDecisions.set(row.name,checked);keepDraftDirty = true;render(); }, row.protected), h('div', 'inline', h('span', 'muted', `${row.affectedCount} papers · ${row.manualCount} manual`), row.protected ? badge('Always kept') : row.locked ? badge('Earlier protected choice') : null)));
    }
    if (!rows.length) list.append(empty(existing ? 'No matching names' : 'Read the tags already on your papers', existing ? 'Try another search or Keep filter.' : 'Choose the names to retain before previewing removal of the others.'));
    if (total > 30) list.append(pagination(total, existingTagPage, next => { existingTagPage = next; }, 30, 'names'));
    const preview = existing?.keepPreview;
    return h('div', 'stack', h('p', 'card-description', 'Keep the names you want on your papers. Every other name in this inventory will be removed only after you review the paper changes. no_tag always stays.'), controls,
      h('div', 'notice inline between', h('span', '', existing?.total!==undefined?'Saved choices on other pages stay in place.':`${all.filter(row => keptNames.has(row.name) || row.protected).length} kept · ${all.filter(row => !keptNames.has(row.name) && !row.protected).length} names to remove across the full inventory`), button('Keep shown names', () => { for (const row of rows){keptNames.add(row.name);keepDecisions.set(row.name,true);}keepDraftDirty = true;render(); }, 'small quiet', !rows.length)),
      keepDraftStale ? h('div', 'notice warning', h('p', '', 'The inventory or protected choices changed. Reload saved Keep choices before previewing removals.'), button('Reload saved Keep choices', () => { keepDraftDirty = false;keepPlanId = '';render(); }, 'small')) : null,
      list, h('div', 'actions', button('Preview removal of other tags', async () => {
        keepPreviewPage = 0;await run('set-kept-existing-tags', { planId: existing!.id, ...(existing!.total!==undefined?{changes:[...keepDecisions].map(([name,kept])=>({name,kept}))}:{names:[...keptNames]}) });keepDraftDirty = false;keepDecisions.clear();
        await run('preview-keep-removals', { planId: currentState().existingTags!.id });
      }, 'primary', !existing || running || keepDraftStale), button('Define kept topics…', async () => {
        if (keepDraftDirty) { await run('set-kept-existing-tags', { planId: existing!.id, ...(existing!.total!==undefined?{changes:[...keepDecisions].map(([name,kept])=>({name,kept}))}:{names:[...keptNames]}) });keepDraftDirty = false;keepDecisions.clear(); }
        existingTagView = 'compare';existingTagFilter = 'kept';existingTagQuery = '';existingTagFacet = 'all';existingTagAction = 'replace';existingTagPage = 0;selectedExistingTags.clear();render();
      }, '', !existing || running || keepDraftStale || !all.some(row => keptNames.has(row.name) && !row.protected))),
      preview ? card('Review removal of other tags', `${preview.removedNames.length} names · ${preview.paperCount} papers · ${preview.overrideCount} earlier protections explicitly replaced`, h('div', '', keepDraftDirty || keepDraftStale ? h('p', 'notice warning', 'Keep choices changed. Preview again before applying.') : null, h('p', '', `Names to remove: ${preview.removedNames.join(', ') || 'None'}`), nativeChanges(preview.changes, keepPreviewPage, next => { keepPreviewPage = next; }, 'removal changes',preview.total,preview.pageSize)), button('Apply reviewed removals', () => run('apply-keep-removals', { previewId: preview.id }, 'Reviewed tag removals applied. Undo is available in Activity.'), 'primary', keepDraftDirty || keepDraftStale || !preview.changes.length)) : null);
  }
  function renderDIYComparison() {
    const comparison = currentState().diyComparison;
    if (!comparison) return h('div');
    if (comparison.id !== diyComparisonId) { diyComparisonId = comparison.id;selectedDIYComparisons.clear();overrideDIYConflicts = false;diyPreviewKey = '';diyComparisonPage = 0;diyPreviewPage = 0; }
    const selected = comparison.pairs.filter(pair => selectedDIYComparisons.has(pair.id) && pair.relation === 'equivalent');
    const conflict = selected.some(pair => pair.conflict);
    const key = JSON.stringify([[...selectedDIYComparisons].sort(), overrideDIYConflicts]);
    const labels = { equivalent: 'Same meaning', broader: 'This tag is broader', narrower: 'This tag is narrower', related: 'Related topics', distinct: 'Different meanings', uncertain: 'Needs your choice' };
    const heading = h('h2', '', 'Compare saved tags');heading.id = 'diy-comparison-heading';heading.tabIndex = -1;
    const body = h('div', 'card-body', h('p', 'card-description', 'Only equivalent meanings can be merged. All merges start unselected; broader, narrower, and related topics remain separate.'), comparison.message ? h('p', '', humanMessage(comparison.message)) : null);
    const total=comparison.total??comparison.pairs.length;diyComparisonPage = Math.min(diyComparisonPage, Math.max(0, Math.ceil(total / 20) - 1));
    for (const pair of comparison.total!==undefined?comparison.pairs:comparison.pairs.slice(diyComparisonPage * 20, (diyComparisonPage + 1) * 20)) body.append(h('article', 'tag-row', h('div', 'inline between', h('strong', '', `${pair.diyName} → ${pair.targetName}`), badge(labels[pair.relation])), h('p', '', pair.reason), pair.relation === 'equivalent' ? checkbox(`diy-merge-${pair.id}`, selectedDIYComparisons.has(pair.id), `Merge ${pair.diyName} into ${pair.targetName}`, checked => { if (checked) { for (const other of comparison.pairs) if (other.diyId === pair.diyId) selectedDIYComparisons.delete(other.id);selectedDIYComparisons.add(pair.id); }else selectedDIYComparisons.delete(pair.id);overrideDIYConflicts = false;render(); }) : null, pair.conflict ? h('p', 'card-description', 'This merge affects a remembered choice and requires an explicit override.') : null));
    if (total > 20) body.append(pagination(total, diyComparisonPage, next => { diyComparisonPage = next; }, 20, 'comparisons'));
    if (conflict) body.append(checkbox('diy-override-conflicts', overrideDIYConflicts, 'Replace conflicting remembered choices for these selected merges', value => { overrideDIYConflicts = value;render(); }));
    body.append(h('div', 'actions', button('Preview selected merges', async () => { diyPreviewPage = 0;await run('preview-diy-merges', { id: comparison.id, pairIds: selected.map(pair => pair.id), ...(overrideDIYConflicts ? { overrideConflicts: true } : {}) });diyPreviewKey = key;render(); }, 'primary', !selected.length || conflict && !overrideDIYConflicts || ['queued', 'running'].includes(comparison.status))));
    const preview = comparison.preview;
    if (preview) body.append(card('Review tag merges', `${preview.mergeCount} definitions to merge · ${preview.overrideCount} earlier choices replaced`, h('div', '', diyPreviewKey !== key ? h('p', 'notice warning', 'Choose the matches and preview them before applying.') : null, nativeChanges(preview.changes, diyPreviewPage, next => { diyPreviewPage = next; }, 'merge changes',preview.total,preview.pageSize)), button('Apply reviewed merges', () => run('apply-diy-merges', { previewId: preview.id }, 'Reviewed tag merges applied. Undo is available in Activity.'), 'primary', diyPreviewKey !== key || ['queued', 'running'].includes(comparison.status))));
    const panel = h('section', 'card', h('div', 'card-header', heading), body);panel.id = 'diy-comparison';return panel;
  }
  function renderExistingTags() {
    const tabs = h('div', 'tag-workspace-tabs');tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', 'Existing tag tools');
    for (const [value, label] of [['keep', 'Keep tags'], ['compare', 'Compare names']] as const) { const tab = button(label, () => { existingTagView = value;existingTagPage = 0;render(); }, existingTagView === value ? 'selected' : 'quiet');tab.setAttribute('role', 'tab');tab.setAttribute('aria-selected', String(existingTagView === value));tabs.append(tab); }
    return h('div', 'stack', h('p', 'card-description', 'Earlier tag tools are retained for compatibility. Existing paper tags are left as they are unless you explicitly use these tools.'), details('Details', legacyToolsOpen, value => { legacyToolsOpen = value; }, () => h('div', 'stack', tabs, existingTagView === 'keep' ? renderKeepTags() : renderCompareExistingTags(), currentState().diyComparison ? renderDIYComparison() : null)));
  }
  function renderCompareExistingTags() {
    const existing = currentState().existingTags;
    const sourceRows = existing?.rows || [];
    const rows = existing?.total!==undefined?sourceRows:sourceRows.filter(row => (existingTagFilter === 'all' || existingTagFilter === 'kept' && row.kept && !row.protected || row.status === existingTagFilter)
      && (!existingTagQuery || `${row.name} ${row.meaning || ''} ${row.targetNames.join(' ')}`.toLocaleLowerCase().includes(existingTagQuery.toLocaleLowerCase()))
      && (existingTagFacet === 'all' || row.facet === existingTagFacet || row.targetNames.some(name => currentState().tags.some(tag => tag.name === name && tag.facet === existingTagFacet))));
    const selectable = (row: typeof sourceRows[number]) => !row.protected && row.name !== 'no_tag';
    const selected = sourceRows.filter(row => selectable(row) && selectedExistingTags.has(row.id));
    const replacementPapers = (row: typeof sourceRows[number]) => row.assignments?.filter(assignment => {
      const key = `${row.id}:${assignment.paperId}`;
      return (!assignment.conflict || overriddenExistingPapers.has(key)) && (assignment.status === 'match' || selectedExistingPapers.has(key) && existingPaperTargets.has(key));
    }).map(assignment => assignment.paperId);
    const removalPapers = (row: typeof sourceRows[number]) => row.assignments?.filter(assignment => !assignment.conflict || overriddenExistingPapers.has(`${row.id}:${assignment.paperId}`)).map(assignment => assignment.paperId);
    const canReplace = (row: typeof sourceRows[number]) => row.assignments ? !!replacementPapers(row)?.length : !!row.targetNames.length && (row.status !== 'choice' || !!existingTagTargets.get(row.id));
    const selection = (row: typeof sourceRows[number]) => {
      const targetId = existingTagTargets.get(row.id);
      const base = { groupId: row.id, action: existingTagAction, ...(existingTagAction === 'replace' && targetId ? { targetId } : {}) };
      if (existingTagAction === 'keep' || !row.assignments) return base;
      const paperIds = (existingTagAction === 'remove' ? removalPapers(row) : replacementPapers(row)) || [];
      const included = new Set(paperIds);
      const paperTargets = row.assignments.flatMap(assignment => {
        const key = `${row.id}:${assignment.paperId}`, target = existingTagAction === 'replace' ? existingPaperTargets.get(key) : undefined;
        if (!included.has(assignment.paperId) || (!overriddenExistingPapers.has(key) && !(selectedExistingPapers.has(key) && target))) return [];
        return [{ paperId: assignment.paperId, targetIds: existingTagAction === 'remove' ? [] : target ? [target] : assignment.targetIds, ...(overriddenExistingPapers.has(key) ? { overrideConflicts: true } : {}) }];
      });
      return { ...base, paperIds, paperTargets };
    };
    const running = existing?.status === 'running' || existing?.status === 'queued';
    const total=existing?.total??rows.length;existingTagPage = Math.min(existingTagPage, Math.max(0, Math.ceil(total / 30) - 1));
    const visible = existing?.total!==undefined?rows:rows.slice(existingTagPage * 30, (existingTagPage + 1) * 30);
    const toolbar = h('div', 'toolbar', input('existing-tag-search', existingTagQuery, value => { existingTagQuery = value;existingTagPage = 0;render(); }, 'Search existing names and meanings…', 'search'), select('existing-tag-status', existingTagFilter, [['all', 'All existing tags'], ['match', 'Matched to Smart Tags'], ['choice', 'Needs your choice'], ['unmatched', 'Other tags'], ['kept', 'Kept names']], value => { existingTagFilter = value;existingTagPage = 0;render(); }, 'Existing tag group'), select('existing-tag-category', existingTagFacet, [['all', 'All categories'], ...facets.map(facet => [facet, facetNames[facet]] as [string,string])], value => { existingTagFacet = value;existingTagPage = 0;render(); }, 'Existing tag category'));
    const controls = h('div', 'inline', button('Read library tags', () => run('refresh-existing-tags', {}, 'Existing tags refreshed.'), '', running), button('Analyze selected names', () => run('analyze-existing-tags', { groupIds: selected.map(row => row.id) }, 'Checking selected tag meanings.'), '', !selected.length || running || !canAnalyze() || !existing?.applied), button('Create tags from selected names…', () => { modalPage = 0;modal = { kind: 'create-diy', ids: selected.map(row => row.id) };render(); }, '', !selected.length || running));
    const bulk = h('div', 'notice inline between', h('span', '', `${selected.length} selected · ${rows.length} shown`), h('div', 'inline', button('Select this page', () => { for (const row of visible) if (selectable(row)) selectedExistingTags.add(row.id);render(); }, 'quiet'), button('Clear selection', () => { selectedExistingTags.clear();render(); }, 'quiet')));
    const actions = h('div', 'toolbar', select('existing-tag-action', existingTagAction, [['replace', 'Use matched Smart Tags name'], ['remove', 'Remove from papers'], ['keep', 'Keep as it is']], value => { existingTagAction = value;render(); }, 'Action for selected existing tags'), button('Review paper changes', () => run('preview-existing-tag-changes', { selections: selected.map(selection) }), 'primary', !selected.length || running || (existingTagAction === 'replace' && selected.some(row => !canReplace(row))) || (existingTagAction === 'remove' && selected.some(row => row.assignments && !removalPapers(row)?.length))));
    const list = h('section', 'card existing-tags-list');
    if (!existing) list.append(empty('Start with the tags already in your library', 'Read their names and counts first. Analysis and any paper changes remain separate steps.', button('Read library tags', () => run('refresh-existing-tags', {}), 'primary')));
    else if (!rows.length) list.append(empty('No matching tags', 'Try another search or group.'));
    for (const row of visible) {
      const protectedName = !selectable(row);
      const status = protectedName ? 'Always kept' : row.status === 'match' ? 'Matched' : row.status === 'choice' ? 'Needs your choice' : 'Other tag';
      const targetChoices = currentState().tags.filter(tag => !tag.builtin && row.targetNames.includes(tag.name)).map(tag => [tag.id, tag.name] as [string,string]);
      const article = h('article', 'existing-tag-row', checkbox(`existing-${row.id}`, !protectedName && selectedExistingTags.has(row.id), row.name, checked => { checked ? selectedExistingTags.add(row.id) : selectedExistingTags.delete(row.id);render(); }, protectedName), h('div', 'inline', badge(status), h('span', 'muted', `${row.affectedCount} papers · ${row.manualCount} manual`)), row.meaning ? h('p', '', `${row.meaningInferred ? 'Inferred meaning' : 'Meaning'}: ${row.meaning}`) : null, row.targetNames.length ? h('p', '', `Smart Tags: ${row.targetNames.join(', ')}`) : null, !protectedName && row.status === 'choice' && !row.assignments && targetChoices.length ? select(`existing-target-${row.id}`, existingTagTargets.get(row.id) || '', [['', 'Choose a matching tag'], ...targetChoices], value => { existingTagTargets.set(row.id, value);render(); }, `Matching tag for ${row.name}`) : null, h('p', 'card-description', protectedName ? row.name === 'no_tag' ? 'Use Include again from the excluded-paper list to remove this marker.' : 'This name is protected from cleanup.' : row.diyQuestion || row.reason));
      if (!protectedName && row.assignments?.length && (row.status !== 'match' || row.assignments.some(assignment => assignment.conflict))) {
        article.append(button(`${expandedExistingGroups.has(row.id) ? 'Hide' : 'Review'} paper matches`, () => { expandedExistingGroups.has(row.id) ? expandedExistingGroups.delete(row.id) : expandedExistingGroups.add(row.id);render(); }, 'small'));
        const paperPage = Math.min(existingPaperPages.get(row.id) || 0, Math.max(0, Math.ceil(row.assignments.length / 30) - 1));
        if (expandedExistingGroups.has(row.id)) for (const assignment of row.assignments.slice(paperPage * 30, (paperPage + 1) * 30)) {
          const key = `${row.id}:${assignment.paperId}`;
          const choices = currentState().tags.filter(tag => tag.status === 'approved' && !tag.builtin).map(tag => [tag.id, tag.name] as [string,string]);
          article.append(h('div', 'existing-paper-choice', paperButton(assignment.paperId), assignment.meaning ? h('p', '', `Inferred meaning: ${assignment.meaning}`) : null, h('p', 'card-description', assignment.status === 'match' ? `Matched: ${assignment.targetNames.join(', ')}` : assignment.reason), assignment.status !== 'match' ? h('div', 'toolbar', checkbox(`existing-paper-${row.id}-${assignment.paperId}`, selectedExistingPapers.has(key), 'Use my selected match', checked => { checked ? selectedExistingPapers.add(key) : selectedExistingPapers.delete(key);render(); }), select(`existing-paper-target-${row.id}-${assignment.paperId}`, existingPaperTargets.get(key) || '', [['', 'Leave unchanged'], ...choices], value => { value ? existingPaperTargets.set(key, value) : existingPaperTargets.delete(key);render(); }, `Matching tag for ${paperTitle(assignment.paperId)}`)) : null, assignment.conflict ? h('div', 'section-gap', h('p', 'card-description', 'An earlier manual choice protects this paper. It stays unchanged unless you replace that choice.'), checkbox(`existing-override-${row.id}-${assignment.paperId}`, overriddenExistingPapers.has(key), 'Replace my earlier choice for this paper', checked => { checked ? overriddenExistingPapers.add(key) : overriddenExistingPapers.delete(key);render(); })) : null));
        }
        if (expandedExistingGroups.has(row.id)) article.append(pagination(row.assignments.length, paperPage, next => { existingPaperPages.set(row.id, next); }, 30, `paper matches for ${row.name}`));
      }
      list.append(article);
    }
    const preview = existing?.preview;
    let review: HTMLElement | null = null;
    if (preview) {
      const changes = h('div', 'native-change-preview');
      const total=preview.total??preview.changes.length,size=preview.pageSize??50;existingPreviewPage = Math.min(existingPreviewPage, Math.max(0, Math.ceil(total / size) - 1));
      for (const change of preview.total!==undefined?preview.changes:preview.changes.slice(existingPreviewPage * size, (existingPreviewPage + 1) * size)) changes.append(h('article', 'paper-card', h('strong', '', change.title), h('p', '', `Before: ${change.before.join(', ') || 'No tags'}`), h('p', '', `After: ${change.after.join(', ') || 'No tags'}`)));
      changes.append(pagination(total, existingPreviewPage, next => { existingPreviewPage = next; }, size, 'paper changes'));
      review = card('Review paper tag changes', total ? `${total} papers. These changes include any existing manual tags shown below.` : 'The selected choices leave paper tags unchanged.', changes, button(total ? 'Apply reviewed tag changes' : 'Confirm reviewed choices', async () => { await run('apply-existing-tag-changes', { previewId: preview.id }, 'Reviewed choices saved.');selectedExistingTags.clear();render(); }, 'primary'));
    }
    return h('div', 'stack', toolbar, controls, existingTagFilter === 'kept' ? h('p', 'card-description', 'Select the scientific topics you want to define, then choose Create tags from selected names. Project and workflow names can stay ordinary tags.') : null, existing?.message ? h('p', 'card-description', humanMessage(existing.message)) : null, bulk, actions, list, pagination(total, existingTagPage, next => { existingTagPage = next; }, 30, 'existing tags'), review);
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
    return card(preview.exclude ? 'Mark no_tag and exclude from tagging' : 'Include papers in tagging again', preview.exclude ? 'Apply this mark to leave the reviewed papers out of future builds and assignments. Undo is available in Activity.' : 'Remove no_tag from the reviewed papers so future builds can include them.', body, h('div', 'actions', button(preview.exclude ? 'Apply no_tag and exclude' : 'Apply inclusion', async () => { const result = await run('apply-paper-exclusion', { previewId: preview.id }, preview.exclude ? 'Papers excluded from tagging.' : 'Papers included in tagging again.');selectedAttentionPapers.clear();if (result?.page === 'cleanup') nav('cleanup');else render(); }, 'primary', !preview.changes.length), button('Cancel exclusion change', () => run('cancel-paper-exclusion'), 'quiet')));
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
    if (topics.length) body.append(field('Maximum new tags', targetInput, 'Saved tags are kept. The limit is not a quota.'), h('div', 'actions', button('Extend from selected topics', async () => { await run('extend-assignment-topics', { runId: review.id, paperIds, additionalTargetCount: target, processingPolicy: 'auto-clear' }, 'Building additions from the selected topic papers.');if (!currentState().paperExclusionPreview) nav('cleanup'); }, 'primary', !paperIds.length || !Number.isInteger(target) || target < 1 || target > 500 || currentState().queue.status === 'running')));
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
      const summary = h('div', '',h('p', '', `${appliedCount} ${appliedCount === 1 ? 'tag change' : 'tag changes'} applied${waiting ? ` · ${waiting} ${waiting === 1 ? 'paper needs' : 'papers need'} your choice` : ''}.`),
        h('p', 'card-description',review.analysisComplete ? 'Supported additions are saved. Other choices can wait.' : 'Validated high-confidence additions are being written as matching finishes.'));
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

  function matchingPaperIds(filter: ConceptFilter): Set<string> {
    const compiled = compileConceptFilter(currentState().tags, filter);
    if (compiled.empty) return new Set();
    if (!compiled.clauses.length) return new Set(paperMap.keys());
    const intersect = (sets: Set<string>[]) => {
      if (!sets.length) return new Set<string>();
      sets.sort((a, b) => a.size - b.size);
      return new Set([...sets[0]].filter(id => sets.every(set => set.has(id))));
    };
    const clauses = compiled.clauses.map(clause => intersect(clause.groups.map(group => {
      const ids = new Set<string>();
      for (const name of group) for (const id of papersByNativeTag.get(canonicalTagKey(name)) || []) ids.add(id);
      return ids;
    })));
    const candidates=compiled.mode === 'all' ? intersect(clauses) : new Set(clauses.flatMap(ids => [...ids]));
    return compiled.clauses.some(clause => clause.bindings) ? new Set([...candidates].filter(id => matchCompiledConceptFilter(paperMap.get(id)?.tags || [],compiled,id))) : candidates;
  }
  function filterSelectionKey(conceptId: string, contextId?: string) { return `${conceptId}\u0000${contextId || ''}`; }
  function isConceptSelected(conceptId: string, contextId?: string) { return conceptFilter.selections.some(selection => selection.conceptId === conceptId && selection.contextId === contextId); }
  function toggleConcept(conceptId: string, contextId?: string) {
    conceptFilter = { ...conceptFilter, selections: isConceptSelected(conceptId, contextId) ? conceptFilter.selections.filter(selection => selection.conceptId !== conceptId || selection.contextId !== contextId) : [...conceptFilter.selections, { conceptId, ...(contextId ? { contextId } : {}) }] };
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
    const reset = button('Clear search', () => { paperQuery = '';conceptQuery = '';conceptFilter = { ...conceptFilter, selections: [] };libraryPage = 0;render();doc.getElementById('paper-search')?.focus(); }, 'quiet small');reset.id = 'reset-find-filters';
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
        const row = h('div', 'concept-tree-row', checkbox(`explore-core-${[...path, tag.id].join('-')}`, isConceptSelected(tag.id), conceptLabel(tag), () => toggleConcept(tag.id)), h('span', 'concept-count', String(count(tag.id))), button('Add tag', () => { page = 'vocabulary'; newTag(true, tag.id); }, 'quiet small'));
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
      if (!coreTags.length && !relatedTags.length) filters.append(empty('No tags ready yet', 'Prepare a tag list, or add a topic of your own.'));
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
    const saveSearch = conceptFilter.selections.length ? button('Save tag search…', () => { modal = { kind: 'search' };searchName = conceptFilter.selections.map(selection => `${tagName(selection.conceptId)}${selection.contextId ? ` in ${tagName(selection.contextId)}` : ''}`).join(conceptFilter.mode === 'all' ? ' + ' : ' or ');render(); }) : null;
    const resultHeader = h('div','inline between find-result-header',countLabel,saveSearch);
    const list = h('section', 'paper-results');list.setAttribute('aria-label','Matching papers');
    if (!papers.length) list.append(empty('No papers match', (s.totals?.papers??s.papers.length) ? 'Try fewer tags or a broader search.' : 'Analyze a pilot or your library to create a local content index.'));
    for (const paper of pageRows(papers,libraryPage,PAGE_SIZE)) {
      const chips = h('div', 'chips');
      for (const tag of (paper.tags || []).slice(0, 12)) chips.append(h('span', 'tag-chip', tag));
      const triggerId = `related-papers-${encodeURIComponent(paper.id)}`,panelId = `related-paper-results-${encodeURIComponent(paper.id)}`;
      const closeRelated = () => { selectedPaper = '';render();doc.getElementById(triggerId)?.focus(); };
      const trigger = button('Related papers', () => { selectedPaper = selectedPaper === paper.id ? '' : paper.id;render(); }, 'quiet small');trigger.id = triggerId;trigger.setAttribute('aria-label',`Related papers for ${paper.title}`);trigger.setAttribute('aria-expanded',String(selectedPaper === paper.id));trigger.setAttribute('aria-controls',panelId);
      const row = h('article', 'paper-card', paperButton(paper.id), paper.summary ? h('p', 'muted', paper.summary) : null, chips, paper.evidenceStatus ? h('p', 'muted', paper.evidenceStatus) : null, h('div', 'actions',trigger));
      row.setAttribute('data-ui-key',`paper:${paper.id}`);
      if (selectedPaper === paper.id) {
        const related = h('section','related-paper-results',h('div','inline between',h('h3','','Related papers'),button('Close related papers',closeRelated,'quiet small')),h('p','card-description','Content similarity suggests related reading, not citation relationships.'));
        related.id = panelId;related.setAttribute('aria-label',`Related papers for ${paper.title}`);
        const neighbors = s.neighbors[paper.id] || [];
        if (!neighbors.length) related.append(h('p','muted','No content neighbors are available yet. Analyze more papers to expand the index.'));
        for (const neighbor of neighbors.slice(0,10)) related.append(h('div','related-paper-row',paperButton(neighbor.paperId),h('span','muted',`Content similarity · ${Math.round(neighbor.score * 100)}%`)));
        listen(row,'keydown',event => { if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();closeRelated(); } });row.append(related);
      }
      list.append(row);
    }
    return h('div', 'stack find-papers',toolbar,filterPanel,conceptFilter.selections.length ? selections : null,resultHeader,list,hasPages(papers.length,PAGE_SIZE) ? pagination(papers.length, libraryPage, next => { libraryPage = next; }) : null);
  }

  function renderActivity() {
    const s = currentState();
    const q = s.queue;
    const number = (value?: number) => value === undefined ? '—' : `$${value.toFixed(4)}`;
    const runProvider = q.provider || s.settings.provider;
    const remainingUSD = q.estimatedUSD !== undefined && q.spentUSD !== undefined ? Math.max(0, q.estimatedUSD - q.spentUSD) : undefined;
    const apiCost = q.estimatePending ? `Estimated cost so far: ${number(q.spentUSD)}. Remaining work is still being estimated.` : `Estimated cost so far: ${number(q.spentUSD)} · estimated remaining: ${number(remainingUSD)}. Requests stay within your chosen spending limit.`;
    const corrections = q.selection?.semanticRepairAllowance !== undefined && q.selection.mappingCorrectionAllowance !== undefined
      ? h('div', '', h('p', 'card-description', `Tag selection repairs: ${q.selection.semanticRepairsUsed ?? 0} of ${q.selection.semanticRepairAllowance} used`), h('p', 'card-description', `Source check corrections: ${q.selection.mappingCorrectionsUsed ?? 0} of ${q.selection.mappingCorrectionAllowance} used`))
      : q.selection ? h('p', 'card-description', `Additional correction requests: ${q.selection.correctionsUsed} of ${q.selection.correctionAllowance} used`) : null;
    const currentProgress = queueProgress();
    const requestCounts = q.selection ? [q.selection.completedRequests > 0 ? `${q.selection.completedRequests} requests completed` : '', q.selection.queuedRequests > 0 ? `${q.selection.queuedRequests} requests queued` : ''].filter(Boolean).join(' · ') : '';
    const selectionProgress = q.phase !== 'reading' && q.selection ? h('div', 'section-gap', currentProgress.total > 0 ? h('p', '', `${currentProgress.label}: ${currentProgress.completed} of ${currentProgress.total}`) : null, q.selection.verificationScope === 'representative' && (q.selection.examplesTotal ?? 0) > 0 ? h('p', '', `Examples checked: ${q.selection.examplesChecked ?? 0} of ${q.selection.examplesTotal}`) : null, requestCounts ? h('p', 'card-description', requestCounts) : null, details('Details', queueDetailsOpen, value => { queueDetailsOpen = value; }, () => corrections!)) : null;
    const stageProgress = q.phase === 'reading'
      ? !q.taskLabel && currentProgress.total > 0 ? h('p', '', `Papers read: ${currentProgress.completed} of ${currentProgress.total}`) : null
      : selectionProgress || (q.phaseProgress && q.phaseProgress.total > 0 ? h('p', '', `${q.phaseProgress.label}: ${q.phaseProgress.completed} of ${q.phaseProgress.total}`) : null);
    const progress = h('div', '', h('div', 'inline between', badge(queuePhaseLabel(), q.status === 'running' ? 'approved' : q.status === 'paused' ? 'draft' : ''), !q.taskLabel ? h('span', 'muted', `${q.completed} papers read · ${q.failed} failed · ${q.needsInformation ?? 0} need information · ${q.skipped ?? 0} skipped`) : null), stageProgress, q.message ? h('p', 'card-description', humanMessage(q.message)) : null,
      h('div', 'actions', fasterBuildButton('primary'), q.status === 'paused' ? resumeQueueButton(q.canUseFasterBuild ? '' : 'primary') : null, q.status === 'running' ? button('Pause', () => run('pause')) : null, ['running','paused'].includes(q.status) ? actionMenu('queue-more-actions','More','More task actions',[{id:'cancel',label:'Cancel remaining',run:() => run('cancel', undefined, 'Remaining jobs canceled. Completed analysis is kept.')}]) : null),
      h('p', 'card-description', runProvider !== 'chatgpt' ? apiCost : 'This work uses your ChatGPT allowance. It pauses when the allowance is reached.'));
    if (s.tagPreparation) progress.append(h('div', 'section-gap', h('h3', '', s.tagPreparation.status === 'ready' ? 'Your tag list is ready' : s.tagPreparation.status === 'questions' ? 'A few tag choices are waiting' : 'Your tag list is saved'), button('Open tags', () => nav('cleanup'), 'small')));
    const history = h('div', '');
    if (!s.history.length) history.append(empty('No applied changes yet', 'Approved tag assignments and cleanup batches will appear here with their undo status.'));
    else {
      const query = activityHistoryQuery.toLocaleLowerCase();
      const records = remotePage('changes')?s.history:s.history.filter(record => !query || `${record.label} ${record.status || ''}`.toLocaleLowerCase().includes(query));
      if(!remotePage('changes'))activityHistoryPage = Math.min(activityHistoryPage,Math.max(0,Math.ceil(records.length / PAGE_SIZE) - 1));
      const search = input('history-search',activityHistoryQuery,value => { activityHistoryQuery = value;activityHistoryPage = 0;render(); },'Find a change…','search');search.setAttribute('aria-label','Search applied changes');history.append(search);
      const table = h('table', '', h('thead', '', h('tr', '', h('th', '', 'Change'), h('th', '', 'Date'), h('th', '', 'Items'), h('th', '', 'Action'))));
      const tbody = h('tbody');
      for (const record of pageRows(records,activityHistoryPage,PAGE_SIZE,'changes')) {
        const date = new Date(record.date);
        tbody.append(keyed(h('tr', '', h('td', '', h('strong', '', record.label), record.status ? h('span', 'muted', record.status) : null), h('td', '', Number.isNaN(date.getTime()) ? record.date : date.toLocaleString()), h('td', '', String(record.count)), h('td', '', button('Undo', () => run('undo', { id: record.id }, 'Undo completed. Later manual edits are preserved.'), 'small', !record.canUndo))),`history:${record.id}`));
      }
      table.append(tbody);history.append(records.length ? h('div', 'table-wrap', table) : empty('No matching changes','Try a different name or clear the search.'));
      if (hasPages(records.length,PAGE_SIZE,'changes')) history.append(pagination(records.length,activityHistoryPage,next => { activityHistoryPage = next; },PAGE_SIZE,'changes'));
    }
    const active = (s.warnings || []).filter(warning => warning.status === 'active' && !warning.legacy && !['evidence-gap', 'unapproved-topics'].includes(warning.code));
    const notices = active.length ? h('section','activity-notices',h('div','inline between',h('h3','','Notices'),button('Dismiss all',() => run('dismiss-warnings',undefined,'Notices dismissed.'),'quiet small')),...active.map(warning => warningEntry(warning, true))) : null;
    const tasks = s.activityTasks;
    const paperWork = !tasks && (!!s.tagPreparation || q.total > 0) || (q.status === 'running' || q.status === 'paused') && q.ownerPage !== 'vocabulary' ? h('section','activity-task',h('h2','',q.taskLabel || 'Paper analysis'),h('p','card-description','Completed work is kept if you pause or close Zotero.'),progress) : null;
    const isQueuedFailure=(task:NonNullable<ManagerSnapshot['activityTasks']>[number])=>task.state==='paused'&&!task.workId&&(task.queuedAttempt||task.id.startsWith('task-'));
    const currentTasks = tasks?.filter(task => task.state !== 'completed' && !(task.state === 'needs-choice' && s.reviewItems?.some(item => item.state !== 'resolved' && (item.taskId === task.id || !!task.workId && (item.taskId === task.workId || item.workId === task.workId)))) && (isQueuedFailure(task)||task.kind === 'meanings' || !['running','paused'].includes(task.state) || !paperWork)) || [];
    const current = currentTasks.map(task => {
      const meaning = task.kind === 'meanings';
      const queuedFailure=isQueuedFailure(task);
      const title = queuedFailure?task.label:meaning ? task.state === 'needs-choice' ? `${task.questionCount ?? 1} ${(task.questionCount ?? 1) === 1 ? 'tag meaning needs' : 'tag meanings need'} your choice` : task.state === 'ready-to-save' ? `${task.readyCount ?? 0} ${(task.readyCount ?? 0) === 1 ? 'meaning ready' : 'meanings ready'} to save` : task.state === 'queued' ? 'Meanings queued' : task.state === 'paused' ? 'Meaning preparation paused' : 'Preparing meanings…' : task.label;
      const currentMeanings = meaning && (!task.workId || task.workId === s.nativeDefinitionPreparation?.id);
      const sourceProgress = currentMeanings && q.ownerPage === 'vocabulary' && ['running','queued','paused'].includes(task.state) && q.phaseProgress && q.phaseProgress.total > 0 ? q.phaseProgress : null;
      const body = h('div','',task.message ? h('p','',humanMessage(task.message)) : null,sourceProgress ? h('p','card-description',`${sourceProgress.label}: ${sourceProgress.completed} of ${sourceProgress.total}`) : meaning && task.total !== undefined && ['running','queued'].includes(task.state) ? h('p','card-description',`${task.completed ?? 0} of ${task.total} names prepared`) : null,task.spentUSD ? h('p','card-description',`Estimated API use: ${number(task.spentUSD)}`) : null);
      const ownsQueue = currentMeanings && q.ownerPage === 'vocabulary' && ['running','paused'].includes(q.status) && ['running','paused'].includes(task.state);
      const open = button(meaning ? 'Open meanings' : task.ownerPage === 'assignment' ? 'Open assignment' : 'Open tags',() => {
        if (meaning) return openMeaningTask(task);
        else if (task.ownerPage === 'assignment') { assignmentRunSelection = task.workId || null;assignmentView = 'suggestions';nav('assignment'); }
        else nav(task.ownerPage === 'activity' ? 'activity' : task.ownerPage);
      },ownsQueue ? 'small' : 'primary small');
      const actions = queuedFailure?h('div','inline',button('Stop this attempt',()=>run('stop-queued-task',{id:task.id},'Attempt stopped. Completed results are kept.'),'quiet small')):h('div','inline',ownsQueue && q.status === 'paused' ? resumeQueueButton('primary small') : null,open,ownsQueue && q.status === 'running' ? button('Pause',() => run('pause'),'small') : null,ownsQueue ? actionMenu('meaning-queue-actions','More','More meaning task actions',[{id:'cancel',label:'Cancel remaining',run:() => run('cancel',undefined,'Remaining jobs canceled. Completed analysis is kept.')}]) : null);
      return h('article','activity-task',h('div','inline between',h('div','',h('h2','',title),h('p','card-description',meaning ? 'Tag library' : pageNames[task.ownerPage])),actions),body);
    });
    const completed = tasks?.filter(task => task.state === 'completed') || [];
    const completedWork = completed.length ? details('Completed work',completedActivityOpen,value => { completedActivityOpen = value; },() => h('div','completed-task-list',...completed.map(task => {
      const meaningCounts = [task.savedCount === undefined ? '' : `${task.savedCount} meanings saved`,task.leftUndefinedCount === undefined ? '' : `${task.leftUndefinedCount} left undefined`].filter(Boolean).join(' · ');
      return h('article','completed-task',h('strong','',task.label),task.kind === 'meanings' ? meaningCounts ? h('p','card-description',meaningCounts) : null : task.total !== undefined ? h('p','card-description',`${task.completed ?? task.total} of ${task.total} papers`) : null,task.message ? h('p','card-description',humanMessage(task.message)) : null,task.spentUSD ? h('p','card-description',`Estimated API use: ${number(task.spentUSD)}`) : null);
    }))) : null;
    const inbox = reviewInbox(s.reviewItems || []);
    const hasPaperProblems = s.paperAttention?.papers.some(paper => paper.status === 'needsInformation' || paper.status === 'failed');
    const paperInfo = details('Paper information',activityPaperInfoOpen,value => { activityPaperInfoOpen = value; },paperAttention);paperInfo.id = 'activity-paper-information';
    const requests=(s.recoveryRequests??[]).map(request=>keyed(h('article','activity-task',h('h3','',request.status==='stopped'?'AI request stopped':'AI request interrupted'),h('p','card-description',request.message),h('div','',h('p','card-description','The provider may already have charged for this request. Retry only if you want to send it again.'),h('div','actions',button('Retry request',()=>run('retry-unknown-request',{id:request.id},'Retry authorized. Resuming the saved work.'),'primary small'),request.status==='unknown'?button('Stop this attempt',()=>run('stop-unknown-request',{id:request.id},'Attempt stopped. Completed results are kept.'),'quiet small'):null))),`request-recovery:${request.id}`));
    const recovery = h('section','activity-recovery',h('h2','','Recovery'),...requests,notices,hasPaperProblems ? h('div','section-gap',h('h3','','Papers that need attention'),paperAttention()) : paperInfo,paperExclusionReview(),metadataReview());recovery.id = 'activity-recovery';
    const past = details('History',activityHistoryOpen,value => { activityHistoryOpen = value; },() => h('div','activity-history-body',h('section','',h('h3','','Applied changes'),h('p','card-description','Undo checks for later edits before changing a saved batch.'),history),completedWork,warningHistory()));past.id = 'activity-history';
    const hasRecovery = hasPaperProblems || requests.length || active.length || s.paperExclusionPreview || s.metadataPreview;
    return h('div', 'stack activity-page',inbox,paperWork,...current,!paperWork && !current.length && !inbox && !hasRecovery ? empty('No work waiting','Build tags, define meanings, or choose papers to tag.') : null,hasRecovery ? recovery : paperInfo,past);
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
    const transfers = details('Import, export, and previous tag lists',settingsTransfersOpen,value => { settingsTransfersOpen = value; },() => h('div','',h('div', 'actions', button('Import tags…', () => run('import-vocabulary', undefined, 'Tags imported.')), button('Export tags…', () => run('export-vocabulary'))), s.tagPreparation ? h('div', 'section-gap', button('Export analysis with paper text…', () => run('export-tag-analysis', { id: s.tagPreparation!.id })), h('p', 'card-description', 'This private export includes paper text and quotations.')) : null,...(s.taxonomyArchives || []).map(archive => h('div', 'inline section-gap', h('span', '', archive.date), button('Open previous tag list', () => run('restore-taxonomy', { id: archive.id }, 'Previous tag list opened. Check it before applying.'), 'small')))));
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
      title = 'Review native tag changes';
      applyLabel = active.kind === 'finish' ? 'Apply and finish' : `Apply ${suggestions.length} tag changes`;
      body.append(h('p', '', 'Review the additions and removals below. Removals apply only to obsolete tags owned by Smart Tags. Existing manual tags are preserved. Stale proposals are checked again before writing.'));
      if (suggestions.some(item => tagById(item.tagId)?.builtin === 'no_tag')) body.append(h('p', 'notice', 'Applying no_tag excludes the affected papers from future tagging. Their other tags stay in place.'));
      const table = h('table', 'section-gap', h('thead', '', h('tr', '', h('th', '', 'Paper'), h('th', '', 'Change'), h('th', '', 'Tag'), h('th', '', 'Evidence'))));
      const tbody = h('tbody');
      for (const item of suggestions.slice(modalPage * PAGE_SIZE, (modalPage + 1) * PAGE_SIZE)) tbody.append(h('tr', '', h('td', '', paperTitle(item.paperId)), h('td', '', badge(item.operation === 'remove' ? 'Remove' : 'Add', item.operation === 'remove' ? 'removal' : 'approved')), h('td', '', h('strong', '', tagName(item.tagId))), h('td', '', item.evidence[0]?.text || 'Review manually')));
      table.append(tbody); body.append(h('div', 'table-wrap', table), pagination(suggestions.length, modalPage, next => { modalPage = next; }));
      apply = async () => { await run(active.kind === 'finish' ? 'finish-assignment' : 'apply-suggestions', active.kind === 'finish' ? { runId: active.runId, ...(active.acceptRemaining ? { acceptRemaining: true } : {}) } : { ids: active.ids }, active.kind === 'finish' ? 'Assignment finished.' : 'Reviewed tag assignments applied.'); selectedSuggestions.clear(); modal = null; render(); };
    } else if (active.kind === 'merge-shelves') {
      title = 'Merge shelves';applyLabel = 'Merge shelves';
      const shelves = currentState().tagShelves || [], selected = shelves.filter(shelf => mergeShelfIds.has(shelf.id));
      const unique = new Set(selected.flatMap(shelf => (shelf.nativeNames || approvedTags().filter(tag => shelf.tagIds.includes(tag.id)).map(tag => ({name:tag.name,tagId:tag.id}))).map(entry => entry.tagId ? `tag:${entry.tagId}` : `name:${entry.name}`)));
      body.append(h('p','','Combine shelf contents without merging tag meanings or changing paper tags.'),h('div','shelf-merge-sources',...shelves.map(shelf => checkbox(`merge-shelf-${shelf.id}`,mergeShelfIds.has(shelf.id),`${shelf.name} · ${shelf.count}`,checked => { checked ? mergeShelfIds.add(shelf.id) : mergeShelfIds.delete(shelf.id);render(); }))),field('Combined shelf name',input('merged-shelf-name',mergedShelfName,value => { mergedShelfName = value;render(); })),h('p','card-description',`${selected.length} shelves · ${unique.size} unique tags`),checkbox('replace-merged-shelves',replaceMergedShelves,'Replace selected shelves',checked => { replaceMergedShelves = checked;render(); }),h('p','card-description',replaceMergedShelves && mergeShelfIds.has('tag-shelf-my-tags') ? 'Native Zotero names stay available in the combined shelf.' : 'Tags and paper assignments are preserved.'));
      applyDisabled = selected.length < 2 || !mergedShelfName.trim();
      apply = async () => {
        const result = await run('merge-tag-shelves',{sourceIds:[...mergeShelfIds],name:mergedShelfName.trim(),replaceSources:replaceMergedShelves},'Shelves merged.');
        if (replaceMergedShelves && mergeShelfIds.has(assignmentTagShelfId)) assignmentTagShelfId = result?.shelfId || 'all';
        libraryTagShelfId = result?.shelfId || 'all';vocabularyPage = 0;renamingShelf = '';modal = null;render();
      };
    } else if (active.kind === 'create-diy') {
      title = 'Create tag definitions';
      applyLabel = 'Analyze and create tags';
      body.append(h('p', '', 'The selected names and supporting paper information will be analyzed through your chosen connection. This uses your ChatGPT allowance or API budget. Clear meanings become available automatically; unresolved choices appear for review.'));
      modalPage = Math.min(modalPage, Math.max(0, Math.ceil(active.ids.length / 25) - 1));
      for (const id of active.ids.slice(modalPage * 25, (modalPage + 1) * 25)) {
        const row = currentState().existingTags?.rows.find(row => row.id === id);
        if (!row) continue;
        const draft = existingDIYDrafts.get(id) || { name: row.name, description: '' };existingDIYDrafts.set(id, draft);
        body.append(h('div', 'section-gap', field('Tag name', input(`diy-name-${id}`, draft.name, value => { draft.name = value; })), field('Meaning (optional)', textarea(`diy-meaning-${id}`, draft.description, value => { draft.description = value; }, row.diyQuestion || 'Add a meaning if this name could refer to several topics.'))));
      }
      body.append(pagination(active.ids.length, modalPage, next => { modalPage = next; }, 25, 'names'));
      apply = async () => { await run('create-diy-from-existing', { groupIds: active.ids, choices: active.ids.map(groupId => ({ groupId, ...(existingDIYDrafts.get(groupId) || { name: currentState().existingTags?.rows.find(row => row.id === groupId)?.name, description: '' }) })) }, 'Tag meanings are being checked.');modal = null;render(); };
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
      title = 'Save a Zotero tag search';
      applyLabel = 'Create saved search';
      body.append(h('p', '', `Create a Zotero saved search matching ${conceptFilter.mode === 'all' ? 'all' : 'any'} of your selected tags. Other names and narrower topics are included. A topic chosen within another tag keeps that combination.`), h('div', 'section-gap', field('Search name', input('saved-search-name', searchName, value => { searchName = value; }))), h('div', 'chips', ...conceptFilter.selections.map(selection => h('span', 'tag-chip', `${tagName(selection.conceptId)}${selection.contextId ? ` in ${tagName(selection.contextId)}` : ''}`))));
      apply = async () => { if (!searchName.trim()) throw new Error('Enter a name for this saved search.'); await run('save-search', { name: searchName.trim(), filter: { mode: conceptFilter.mode, selections: conceptFilter.selections.map(selection => ({ ...selection })) } }, 'Saved search created in Zotero.'); modal = null; render(); };
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
    const strip = queueStrip();
    if (strip) workspace.append(strip);
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
      'existing-tags': () => h('div', 'stack', h('div', 'workflow-section-links', button('Review tag list', () => nav('cleanup')), button('Open tag library', () => nav('vocabulary'))), renderExistingTags()),
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
      const target = doc.getElementById(pendingEditorFocus) || doc.getElementById('add-tag');pendingEditorFocus = '';target?.focus({preventScroll:true});
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
    for (const selector of ['.tag-workspace-list', '.native-meaning-panel']) {
      const panel = doc.querySelector<HTMLElement>(selector);
      if (!panel) continue;
      const available = Math.max(100, win.innerHeight - Math.max(16, panel.getBoundingClientRect().top) - 16);
      panel.style.maxHeight = `${available}px`;
      if (selector !== '.tag-workspace-list') panel.style.height = `${available}px`;
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
