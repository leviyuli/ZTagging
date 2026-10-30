import type { BuildMode, DisplayAssignmentReview, DisplayPaper, DisplaySuggestion, DisplayTag, ManagerAPI, ManagerPage, ManagerSettings, ManagerSnapshot, Scope } from './ui-contract';
import { createDropdown, cleanupDropdowns } from './dropdown';
import { compileConceptFilter, descendantIds } from './concept-filter';
import type { ConceptFilter } from './concept-filter';
import { canonicalTagKey } from './core';
import type { WarningRecord } from './warnings';

type Child = Node | string | null | undefined | false;
type MenuAction = { id: string; label: string; run: () => void | Promise<unknown> };
type ModalState = { kind: 'apply' | 'create-diy'; ids: string[] } | { kind: 'finish'; ids: string[]; runId: string; acceptRemaining: boolean } | { kind: 'search' | 'reset-analysis' } | null;
const facets = ['system', 'component', 'phenomenon', 'method'] as const;
const facetNames: Record<string, string> = { system: 'Systems', component: 'Components & materials', phenomenon: 'Phenomena', method: 'Methods' };
const pageTitles: Record<ManagerPage, [string, string]> = {
  overview: ['Your library, clearly tagged', 'Prepare a useful tag list, then review its paper suggestions.'],
  connection: ['Connect AI', 'Choose the connection and model used for your papers.'],
  build: ['Build tags', 'Choose papers to learn from, then review the suggested tag list.'],
  cleanup: ['Build tags', 'Choose papers, then review and save the resulting tag list here.'],
  assignment: ['Assign & automate', 'Choose the papers to tag, review their suggestions, and set up routine assignment.'],
  vocabulary: ['Tag library', 'Edit saved tags and add topics you want to follow.'],
  'existing-tags': ['Existing tags', 'Bring useful library tags into Smart Tags and review any paper changes.'],
  review: ['Review suggestions', 'Check the evidence, keep useful tags, and teach Smart Tags your preferences.'],
  library: ['Explore your library', 'Combine approved tags and discover papers with related content.'],
  activity: ['Queue & history', 'Follow analysis progress and review changes that have been applied.'],
  settings: ['Settings', 'Manage tag preferences, library navigation, imports, and updates.'],
};
const pageNames: Record<ManagerPage, string> = { overview: 'Overview', connection: 'Connect AI', build: 'Build tags', cleanup: 'Build tags', assignment: 'Assign & automate', vocabulary: 'Tag library', 'existing-tags': 'Earlier tag tools', review: 'Paper suggestions', library: 'Find papers', activity: 'Activity', settings: 'Settings' };
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
export interface ManagerUIOptions { page?: ManagerPage; createDetail?: boolean; detailContextId?: string; tagId?: string }

/** Mount a credential-free manager. All data access and writes go through the host. */
export function mountManager(win: Window, api: ManagerAPI, options: ManagerUIOptions = {}): { refresh: () => Promise<void>; destroy: () => void; navigate: (options: ManagerUIOptions) => void } {
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
  let reviewDetailsOpen = false;
  let legacyToolsOpen = false;
  let buildMode: BuildMode = 'replace';
  let buildSetupOpen = false;
  let additionalTagTarget: number | null = null;
  let topicAdditionalTarget: number | null = null;
  let workflowInitialized = false;
  let assignmentView: 'setup' | 'suggestions' = 'setup';
  let routineDraft: boolean | null = null;
  let routineSettingsOpen = false;
  let dataDetailsOpen = false;
  let busy = false;
  let signingIn = false;
  let disposed = false;
  let refreshing = false;
  let refreshAgain = false;
  let refreshDeferred = false;
  let toast = '';
  let toastError = false;
  let toastTimer = 0;
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
  let selectedPaper = '';
  let editorTag: DisplayTag | null = null;
  let editorPreparationId = '';
  const tagScrollPositions = new Map<string, number>();
  const editorDrafts = new Map<string, DisplayTag>();
  let editorAdvancedOpen = false;
  let detailScope: Scope = 'selected';
  const relationQueries = new Map<string, string>();
  const openRelationshipPickers = new Set<string>();
  const expandedConcepts = new Set<string>();
  let conceptQuery = '';
  let settingsDraft: ManagerSettings | null = null;
  let settingsDirty = false;
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
    element.addEventListener('click', () => { Promise.resolve().then(action).catch(showError); });
    return element;
  }
  function actionMenu(id: string, label: string, accessibleName: string, commands: MenuAction[]) {
    if (!commands.length) return null;
    let popup: HTMLDivElement | null = null;
    let items: HTMLButtonElement[] = [];
    let active = 0;
    const trigger = button(label, () => { if (popup) close();else open(0); }, 'quiet small attention-menu-trigger');
    trigger.id = id;
    trigger.setAttribute('aria-label', accessibleName);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${id}-menu`);
    const contains = (node: Node, target: EventTarget | null) => !!target && typeof (target as Node).nodeType === 'number' && node.contains(target as Node);
    function close(restoreFocus = true) {
      if (!popup) return;
      popup.remove();popup = null;items = [];
      trigger.setAttribute('aria-expanded', 'false');
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('focusin', outside);
      doc.removeEventListener('scroll', scrolled, true);
      win.removeEventListener('resize', viewportChanged);
      win.removeEventListener('unload', viewportChanged);
      if (closeActionMenu === close) closeActionMenu = null;
      if (restoreFocus && trigger.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
    }
    function outside(event: Event) { if (!contains(trigger, event.target) && (!popup || !contains(popup, event.target))) close(false); }
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
      if (trigger.disabled || !trigger.isConnected || !doc.body) return;
      closeActionMenu?.();cleanupDropdowns(doc);
      popup = h('div', 'smart-tags-action-menu');popup.id = `${id}-menu`;
      popup.setAttribute('role', 'menu');popup.setAttribute('aria-labelledby', id);
      items = commands.map(command => {
        const item = button(command.label, () => { close();return command.run(); }, 'smart-tags-action-item');
        item.id = `${id}-item-${command.id}`;item.tabIndex = -1;item.setAttribute('role', 'menuitem');item.addEventListener('keydown', keydown);popup!.append(item);return item;
      });
      doc.body.append(popup);
      const rect = trigger.getBoundingClientRect(), edge = 8;
      const width = Math.min(280, Math.max(1, win.innerWidth - edge * 2));
      const height = Math.min(popup.scrollHeight + 2, 320, Math.max(1, win.innerHeight - edge * 2));
      popup.style.width = `${width}px`;popup.style.maxHeight = `${height}px`;
      popup.style.left = `${Math.max(edge, Math.min(rect.right - width, win.innerWidth - width - edge))}px`;
      popup.style.top = `${Math.max(edge, Math.min(rect.bottom + 4 + height <= win.innerHeight - edge ? rect.bottom + 4 : rect.top - height - 4, win.innerHeight - height - edge))}px`;
      trigger.setAttribute('aria-expanded', 'true');closeActionMenu = close;
      doc.addEventListener('pointerdown', outside, true);doc.addEventListener('focusin', outside);doc.addEventListener('scroll', scrolled, true);
      win.addEventListener('resize', viewportChanged);win.addEventListener('unload', viewportChanged);focusItem(index);
    }
    trigger.addEventListener('keydown', keydown);
    return trigger;
  }
  function nav(target: ManagerPage) { page = target; if (target === 'review') assignmentView = 'suggestions';modal = null;render(); }
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
    element.value = value;
    element.placeholder = placeholder;
    element.addEventListener('input', () => { onInput(element.value);updateTagApplyState(); });
    return element;
  }
  function textarea(id: string, value: string, onInput: (value: string) => void, placeholder = '') {
    const element = h('textarea');
    element.id = id;
    element.value = value;
    element.placeholder = placeholder;
    element.addEventListener('input', () => { onInput(element.value);updateTagApplyState(); });
    return element;
  }
  function select<T extends string>(id: string, value: T, choices: [T, string][], onChange: (value: T) => void, accessibleName?: string) {
    const control = createDropdown(win, { id, value, choices, onChange: next => { onChange(next as T);updateTagApplyState(); }, disabled: busy });
    if (accessibleName) control.setAttribute('aria-label', accessibleName);
    return control;
  }
  function checkbox(id: string, checked: boolean, label: string, onChange: (value: boolean) => void, disabled = false) {
    const element = h('input');
    element.id = id;
    element.type = 'checkbox';
    element.checked = checked;
    element.disabled = disabled || busy;
    element.addEventListener('change', () => onChange(element.checked));
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
    summary.addEventListener('click', event => { event.preventDefault();changed(!open);render(); });
    panel.addEventListener('toggle', () => { if (panel.isConnected && panel.open !== open) { changed(panel.open);render(); } });
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
      const result = await api.invoke(action, payload);
      refreshDeferred = false;
      await refresh();
      if (message) notify(message);
      return result;
    } finally {
      busy = false;
      render();
      if (refreshDeferred) { refreshDeferred = false;void refresh(); }
    }
  }
  async function refresh() {
    if (disposed) return;
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        diagnostic('snapshot begin');
        if (!state) app!.setAttribute('data-smart-tags-state', 'loading');
        let snapshotTimer = 0;
        try {
          state = await Promise.race([
            api.snapshot(),
            new Promise<never>((_resolve, reject) => { snapshotTimer = win.setTimeout(() => reject(new Error('Your library is taking longer than expected to load. Try reopening Smart Tags.')), 15000); }),
          ]);
        } finally { if (snapshotTimer) win.clearTimeout(snapshotTimer); }
        if (disposed) return;
        diagnostic(`snapshot complete: ${state.papers.length} papers, ${state.tags.length} definitions`);
        paperMap = new Map(state.papers.map(paper => [paper.id, paper]));
        tagMap = new Map(state.tags.map(tag => [tag.id, tag]));
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
        if (!workflowInitialized) {
          buildScope = state.workflow?.buildScope || (state.taxonomyReady ? 'selected' : 'pilot');
          assignmentScope = state.workflow?.assignmentScope || 'library';
          assignmentTagShelfId = state.workflow?.assignmentTagShelfId || 'all';
          buildMode = state.taxonomyReady ? 'extend' : state.workflow?.buildMode || 'replace';
          workflowInitialized = true;
        }
        if (pendingNavigation) { const next = pendingNavigation; pendingNavigation = null; navigate(next, false); }
      } while (refreshAgain && !disposed);
      render();
    } catch (error) { diagnostic(`snapshot failed: ${error instanceof Error ? error.message : String(error)}`); showError(error); }
    finally { refreshing = false; }
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
  function approvedTags() { return currentState().tags.filter(tag => tag.status === 'approved' && !tag.builtin); }
  function pagination(total: number, pageIndex: number, change: (next: number) => void, pageSize = PAGE_SIZE, noun = '') {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return h('div', 'inline between', h('span', 'muted', total ? `${pageIndex * pageSize + 1}–${Math.min(total, (pageIndex + 1) * pageSize)} of ${total}` : '0 results'),
      h('div', 'inline', button(`Previous${noun ? ` ${noun}` : ''}`, () => { change(pageIndex - 1); render(); }, 'small', pageIndex <= 0), h('span', 'muted', `${pageIndex + 1} / ${pages}`), button(`Next${noun ? ` ${noun}` : ''}`, () => { change(pageIndex + 1); render(); }, 'small', pageIndex >= pages - 1)));
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
    const s = currentState();
    const mode = s.taxonomyReady ? buildMode : 'replace';
    const target = additionalTagTarget ?? s.settings.extensionTagTarget ?? 30;
    const targetInput = input('additional-tag-target', String(target), value => { additionalTagTarget = Number(value);render(); }, '', 'number');targetInput.min = '1';targetInput.max = '500';targetInput.step = '1';
    const modeField = s.taxonomyReady ? field('Tag list', select<BuildMode>('build-mode', mode, [['extend', 'Extend my saved tag list'], ['replace', 'Replace the full tag list']], value => { buildMode = value;render(); })) : null;
    const explanation = !s.taxonomyReady ? 'Create your first tag list from this group of papers. Review it before saving, then choose which papers to tag.' : mode === 'extend' ? 'Keep your saved tags and use this group of papers to suggest additions and useful updates.' : 'Build a replacement for the full saved tag list. Review the result before replacing it. Existing paper tags change only through a separate reviewed action.';
    const body = h('div', 'stack', field('Papers for building tags', scopeSelect('build-scope', buildScope, value => { buildScope = value;render(); }), 'Select papers or collections in Zotero when using those groups.'), modeField, mode === 'extend' ? field('New tags to suggest', targetInput, `${approvedTags().length} saved tags are kept. The combined library may grow beyond 60.`) : null, h('div', 'notice', explanation), s.tagPreparation ? h('p', 'card-description', 'Your current suggestions stay here until you choose Prepare tags. Starting another build replaces the unsaved list.') : null, h('div', 'actions', button('Prepare tags', async () => { await run('prepare-tags', { scope: buildScope, mode, ...(mode === 'extend' ? { additionalTargetCount: target } : {}) }, 'Preparing your tag list.');buildSetupOpen = false;render(); }, 'primary', !canAnalyze() || s.queue.status === 'running' || mode === 'extend' && (!Number.isInteger(target) || target < 1 || target > 500))));
    return h('div', 'stack', !canAnalyze() ? h('div', 'notice info inline between', h('span', '', 'Choose an AI connection and model before building tags.'), button('Connect AI', () => nav('connection'), 'small')) : null, card(s.taxonomyReady ? 'Extend your tag library' : 'Start with a small group', s.taxonomyReady ? 'Selected papers can add new topics while your saved list remains available.' : 'A 50-paper pilot gives you a manageable first list to review.', body), h('p', 'card-description', 'This group builds the tag list. You will choose which papers receive tags in Assign & automate.'));
  }
  function queueStrip() {
    const q = currentState().queue;
    if (q.status === 'idle' && !q.total) return null;
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
    if (q.selection?.verificationScope === 'representative') return { completed: q.selection.tagsPrepared ?? 0, total: q.selection.tagsTotal ?? 0, label: 'Tags prepared' };
    return q.selection ? { completed: q.selection.sourceCompleted, total: q.selection.sourceTotal, label: 'Supporting findings checked' } : q.phaseProgress || (q.phase && q.phase !== 'reading' ? { completed: 0, total: 0, label: '' } : { completed: q.completed + q.failed, total: q.total, label: '' });
  }
  function fasterBuildButton(kind = '') {
    const q = currentState().queue;
    if (!q.canUseFasterBuild && !q.switchingToFasterBuild) return null;
    if (q.switchingToFasterBuild && q.status === 'paused') return null;
    return button(q.switchingToFasterBuild ? 'Switching to faster build…' : 'Use faster build', () => run('use-faster-build', { targetCount: 60 }, 'Switching to faster build. Completed paper analysis is kept.'), kind, q.switchingToFasterBuild === true);
  }
  function resumeQueueButton(kind = '', disabled = false) {
    const q = currentState().queue, fasterBuild = q.status === 'paused' && q.switchingToFasterBuild, retry = !fasterBuild && q.status === 'paused' && q.selection?.failed === true;
    return button(fasterBuild ? 'Retry faster build' : retry ? 'Retry this step' : 'Resume', () => run(retry ? 'retry-selection' : 'resume'), kind, disabled);
  }
  function queuePhaseLabel() {
    const q = currentState().queue;
    if (q.taskLabel) return q.status === 'paused' ? `${q.taskLabel} · paused` : q.taskLabel;
    if (q.status === 'paused') return q.switchingToFasterBuild ? 'Faster build paused' : 'Analysis paused';
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
      ['connection', 'Connect AI', 'Choose a connection and model.'],
      ['cleanup', 'Build tags', 'Prepare and review a tag list from your chosen papers.'],
      ['assignment', 'Assign & automate', 'Choose papers to tag, then review their suggestions.'],
    ];
    const workflow = h('ol', 'step-list');
    steps.forEach(([target, title, description], index) => workflow.append(h('li', 'step', h('span', 'step-number', String(index + 1)), h('div', '', button(title, () => nav(target), 'workflow-link'), h('p', '', description)))));
    const next: ManagerPage = !canAnalyze() ? 'connection' : s.tagPreparation ? 'cleanup' : s.taxonomyReady ? 'assignment' : 'build';
    const nextLabel = next === 'connection' ? 'Connect your AI model' : next === 'cleanup' ? 'Review your prepared tags' : next === 'assignment' ? 'Choose papers to tag' : 'Prepare your first tag list';
    return h('div', '', stats, h('div', 'grid', card(s.taxonomyReady ? 'Your tag library is ready' : 'Set up your tag library', 'Building the tag list and assigning paper tags are separate steps.', h('div', '', h('p', '', s.taxonomyReady ? 'Use the saved list for another group of papers, or extend it when your research changes.' : 'Begin with a small group, review its topics, then choose where to use those tags.'), h('div', 'actions', button(nextLabel, () => nav(next), 'primary'), s.taxonomyReady ? button('Open tag library', () => nav('vocabulary')) : null)), undefined, 'overview-primary'), card('Your workflow', 'You can open any step at any time.', workflow, undefined, 'overview-guide')));
  }

  function newTag(custom = false, contextId?: string, shouldRender = true) {
    rememberEditorDraft();
    editorPreparationId = '';
    const shelf = currentState().tagShelves?.find(shelf => shelf.id === libraryTagShelfId);
    newTagShelfId = shelf && shelf.kind !== 'existing' ? shelf.id : undefined;
    relationQueries.clear();
    openRelationshipPickers.clear();
    editorTag = { id: '', name: '', description: '', facet: 'phenomenon', aliases: [], inclusions: [], exclusions: [], examples: [], custom, status: 'draft', broaderIds: [], relatedIds: contextId ? [contextId] : [], matchingMode: custom ? 'suggest' : 'auto' };
    if (shouldRender) render();
  }
  function copyTag(tag: DisplayTag): DisplayTag { return { ...tag, aliases: [...tag.aliases], inclusions: [...tag.inclusions], exclusions: [...tag.exclusions], examples: [...tag.examples], broaderIds: [...tag.broaderIds], relatedIds: [...(tag.relatedIds || [])] }; }
  function rememberEditorDraft() { if (editorTag) editorDrafts.set(`${editorPreparationId}:${editorTag.id || 'new'}`, copyTag(editorTag)); }
  function editTag(tag: DisplayTag, preparationId = '', shouldRender = true) {
    if (tag.builtin) return;
    rememberEditorDraft();
    editorPreparationId = preparationId;
    relationQueries.clear();
    openRelationshipPickers.clear();
    editorTag = copyTag(editorDrafts.get(`${preparationId}:${tag.id}`) || tag);
    if (shouldRender) { render(); doc.getElementById('tag-name')?.focus(); }
  }
  function navigate(next: ManagerUIOptions, shouldRender = true) {
    if (disposed) return;
    if (!state) { pendingNavigation = next; return; }
    if (next.page) page = next.page;
    if (next.page === 'review') assignmentView = 'suggestions';
    modal = null;
    if (next.createDetail) { page = 'vocabulary'; newTag(true, next.detailContextId, false); }
    else if (next.tagId) { const tag = tagById(next.tagId); if (tag) { page = 'vocabulary'; editTag(tag, '', false); } }
    if (shouldRender) render();
  }
  function relationshipPicker(tag: DisplayTag, key: 'broaderIds' | 'relatedIds', label: string, description: string) {
    const choices = (editorPreparationId ? currentState().tagPreparation?.tags || [] : currentState().tags).filter(other => other.id !== tag.id && !other.builtin);
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
    picker.addEventListener('toggle', () => { if (picker.isConnected) picker.open ? openRelationshipPickers.add(key) : openRelationshipPickers.delete(key); });
    return picker;
  }
  function definitionKey(tag: DisplayTag) {
    return JSON.stringify([tag.name, tag.fullName || '', tag.description, tag.facet, tag.aliases, tag.inclusions, tag.exclusions, tag.examples, tag.broaderIds, tag.relatedIds || [], tag.matchingMode || (tag.custom ? 'suggest' : 'auto')]);
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
    const orphaned = !!preparationId && state?.tagPreparation?.id === preparationId && !state.tagPreparation.tags.some(saved => saved.id === tag.id);
    const lineField = (key: 'aliases' | 'inclusions' | 'exclusions' | 'examples', label: string, note: string) => field(label, textarea(`tag-${key}`, tag[key].join('\n'), value => { tag[key] = value.split('\n').map(line => line.trim()).filter(Boolean); }), note);
    const advanced = h('details', 'editor-advanced', h('summary', '', 'More options'),
      lineField('aliases', 'Other names', 'Alternative names and abbreviations, one per line.'),
      lineField('inclusions', 'Use when', 'Optional guidance about papers that belong here.'),
      lineField('exclusions', 'Do not use when', 'Optional guidance about papers that do not belong here.'),
      lineField('examples', 'Examples', 'Helpful paper titles or passages, one per line.'),
      relationshipPicker(tag, 'broaderIds', 'Type of', 'Choose a broader topic only when this tag is a type of it.'),
      relationshipPicker(tag, 'relatedIds', 'Related topics', 'Connect topics that overlap without meaning the same thing.'),
      field('Paper matching', select('tag-matching-mode', tag.matchingMode || (tag.custom ? 'suggest' : 'auto'), [['manual', 'Only when I choose'], ['suggest', 'Suggest paper matches'], ['auto', 'Match automatically']], value => { tag.matchingMode = value; }), 'Automatic matching also needs your completed pilot review and the setting for new papers.'),
      tag.custom && !tag.id ? button('Use RCL example', () => { tag.name = 'RCL';tag.fullName = 'Catalyst-layer resistance';tag.description = 'Catalyst-layer resistance in water electrolysis or fuel cells.';render(); }, 'quiet small') : null);
    advanced.open = editorAdvancedOpen;
    advanced.addEventListener('toggle', () => { if (advanced.isConnected) editorAdvancedOpen = advanced.open; });
    const form = h('form', 'editor-scroll',
      orphaned ? h('p', 'notice warning', 'This tag left the suggested list. Copy your changes, save them to your tag library, or cancel this draft. Matching will start with suggestions; suggested-list relationships are not copied.') : null,
      field('Tag name', input('tag-name', tag.name, value => { tag.name = value; }, 'A short name you recognize')),
      field('Full name', input('tag-full-name', tag.fullName || '', value => { tag.fullName = value; }, 'Expand an abbreviation when helpful')),
      field('Meaning', textarea('tag-description', tag.description, value => { tag.description = value; }, 'What should papers with this tag discuss?')),
      field('Group', select('tag-facet', tag.facet, facets.map(value => [value, facetNames[value]]), value => { tag.facet = value; })), advanced);
    form.id = 'tag-editor-form';
    if (tag.id && !preparationId) {
      const saved = tagById(tag.id);
      const unsaved = !saved || definitionKey(tag) !== definitionKey(saved);
      form.append(h('details', 'section-gap', h('summary', '', 'More actions'), field('Find matches in', select<Scope>('detail-preview-scope', detailScope, [['selected', 'Selected papers in Zotero'], ['collections', 'Selected collections'], ['library', 'Whole personal library'], ['pilot', 'Pilot · 50 papers']], value => { detailScope = value; })), h('div', 'actions', button('Preview matches', () => { requireSavedDetail(tag);return run('preview-detail', { tagId: tag.id, scope: detailScope }, 'Preparing paper suggestions.'); }, '', !canAnalyze() || unsaved || tag.matchingMode === 'manual'), button('Assign to selected papers', () => { requireSavedDetail(tag);return run('assign-detail', { tagId: tag.id, scope: 'selected' }, 'Tag assigned to the selected papers.'); }, '', unsaved)), h('p', 'card-description', 'Save your changes before matching or assigning papers.')));
    }
    const save = async () => {
      if (busy) return;
      if (orphaned) throw new Error('This tag left the suggested list. Save it to your tag library or cancel the draft.');
      if (!tag.name.trim() || !tag.description.trim()) throw new Error('Add a tag name and meaning before saving.');
      const submitted = copyTag(tag);
      if (preparationId) {
        if (currentState().tagPreparation?.id !== preparationId) throw new Error('This tag list has changed. Open the tag again before saving.');
        await run('edit-prepared-tag', { id: preparationId, tag: submitted }, 'Tag saved.');
      } else await run(!tag.id ? 'create-detail' : 'save-tag', { tag: submitted, ...(!tag.id && newTagShelfId ? { tagShelfId: newTagShelfId } : {}) }, 'Tag saved.');
      editorDrafts.delete(`${preparationId}:${tag.id || 'new'}`);
      if (editorTag === tag) { editorTag = null;editorPreparationId = '';render(); }
    };
    const saveAsDetail = async () => {
      if (busy) return;
      if (!tag.name.trim() || !tag.description.trim()) throw new Error('Add a tag name and meaning before saving.');
      await run('create-detail', { tag: { ...copyTag(tag), id: '', custom: true, status: 'draft', matchingMode: 'suggest', broaderIds: [], relatedIds: [] } }, 'Tag saved.');
      editorDrafts.delete(`${preparationId}:${tag.id}`);
      if (editorTag === tag) { editorTag = null;editorPreparationId = '';render(); }
    };
    form.addEventListener('submit', event => { event.preventDefault();void save().catch(showError); });
    const cancel = () => { editorDrafts.delete(`${preparationId}:${tag.id || 'new'}`);editorTag = null;editorPreparationId = '';render(); };
    return h('section', 'card editor tag-editor', h('div', 'card-header', h('h2', '', tag.id ? `Edit ${tag.name}` : 'Add a tag')), form, h('div', 'card-footer editor-footer', button('Save', save, orphaned ? '' : 'primary', orphaned), orphaned ? button('Save to tag library', saveAsDetail, 'primary') : null, button('Cancel', cancel, 'quiet')));
  }
  function workingTags(preparation?: ManagerSnapshot['tagPreparation']) { return (preparation?.tags || approvedTags()).filter(tag => !tag.builtin); }
  function tagShelfOptions(assignment = false): [string,string][] {
    return [['all', `All saved tags · ${approvedTags().length}`], ...(currentState().tagShelves || []).map(shelf => [shelf.id, `${shelf.name} · ${assignment ? approvedTags().filter(tag => shelf.tagIds.includes(tag.id)).length : shelf.count}`] as [string,string])];
  }
  function libraryShelfControls() {
    const shelf = currentState().tagShelves?.find(shelf => shelf.id === libraryTagShelfId);
    const controls = h('div', 'toolbar', field('Shelf', select('tag-library-shelf', libraryTagShelfId, tagShelfOptions(), value => { libraryTagShelfId = value;vocabularyPage = 0;renamingShelf = '';render(); }, 'Tag library shelf')));
    if (shelf) controls.append(button('Rename shelf…', () => { renamingShelf = shelf.id;shelfNameDrafts.set(shelf.id, shelf.name);render(); }, 'quiet small'));
    if (shelf && renamingShelf === shelf.id) controls.append(field('Shelf name', input('tag-shelf-name', shelfNameDrafts.get(shelf.id) ?? shelf.name, value => { shelfNameDrafts.set(shelf.id, value); })), button('Save shelf name', async () => { await run('rename-tag-shelf', { id: shelf.id, name: (shelfNameDrafts.get(shelf.id) || '').trim() }, 'Shelf renamed.');renamingShelf = '';render(); }, 'small'), button('Cancel rename', () => { renamingShelf = '';render(); }, 'small quiet'));
    return controls;
  }
  function currentDrafts() {
    const drafts = new Map(editorDrafts);
    if (editorTag) drafts.set(`${editorPreparationId}:${editorTag.id || 'new'}`, editorTag);
    return drafts;
  }
  function orphanedPreparedDrafts() {
    const preparation = state?.tagPreparation;
    if (!preparation) return [];
    const ids = new Set(preparation.tags.map(tag => tag.id));
    return [...currentDrafts()].filter(([key, draft]) => key.startsWith(`${preparation.id}:`) && !ids.has(draft.id)).map(([, draft]) => draft);
  }
  function hasUnsavedPreparedChanges() {
    const preparation = state?.tagPreparation;
    if (!preparation) return false;
    for (const [key, draft] of currentDrafts()) {
      const relevant = key.startsWith(`${preparation.id}:`) || (key.startsWith(':') && draft.custom);
      if (!relevant) continue;
      const saved = preparation.tags.find(tag => tag.id === draft.id);
      if (!saved || definitionKey(saved) !== definitionKey(draft)) return true;
    }
    return false;
  }
  function updateTagApplyState() {
    const apply = doc.getElementById('apply-tag-list') as HTMLButtonElement | null;
    if (!apply || !state?.tagPreparation) return;
    const dirty = hasUnsavedPreparedChanges();
    apply.disabled = busy || !state.tagPreparation.canApply || state.tagPreparation.status === 'checking' || dirty;
    const note = doc.getElementById('tag-apply-note');
    if (note) note.textContent = dirty ? 'Save or cancel your edits before applying this tag list.' : 'Next, choose which papers to tag. No paper tags change yet.';
  }
  function renderVocabulary(prepared = false) {
    const s = currentState();
    const preparation = prepared ? s.tagPreparation : undefined;
    const editorVisible = !!editorTag && (preparation ? editorPreparationId === preparation.id || editorTag.custom : !editorPreparationId);
    const extending = !!preparation && s.workflow?.buildMode === 'extend';
    const query = vocabQuery.trim().toLocaleLowerCase();
    const shelf = !prepared ? s.tagShelves?.find(shelf => shelf.id === libraryTagShelfId) : undefined;
    const nativeNames = shelf?.kind === 'existing' ? (shelf.nativeNames || []).filter(entry => !query || `${entry.name} ${entry.tagId ? tagById(entry.tagId)?.description || '' : ''}`.toLocaleLowerCase().includes(query)) : undefined;
    const tags = workingTags(preparation).filter(tag => (!shelf || shelf.tagIds.includes(tag.id)) && (!query || conceptText(tag).includes(query)));
    const questions = preparation?.questions || [];
    const view = preparation && questions.length ? tagView : 'tags';
    const savedIds = new Set(approvedTags().map(tag => tag.id));
    const addedCount = preparation?.tags.filter(tag => !savedIds.has(tag.id)).length || 0;
    vocabularyPage = Math.min(vocabularyPage, Math.max(0, Math.ceil((nativeNames?.length ?? tags.length) / 20) - 1));
    tagQuestionPage = Math.min(tagQuestionPage, Math.max(0, Math.ceil(questions.length / 10) - 1));
    const status = preparation?.status === 'checking' ? 'Checking your tags…' : preparation?.status === 'questions' ? `${questions.length} ${questions.length === 1 ? 'question needs' : 'questions need'} your choice` : preparation?.status === 'failed' ? 'Your tag list needs another try' : preparation ? 'Your tag list is ready' : shelf?.name || 'Your tags';
    const header = h('div', 'tag-workspace-header', h('div', '', h('h2', '', status), h('p', 'card-description', extending ? `${savedIds.size} saved + ${addedCount} new = ${savedIds.size + addedCount} total · ${preparation!.scopeCount} papers` : preparation ? `${preparation.tags.length} tags · ${preparation.scopeCount} papers · preferred count ${preparation.targetCount}` : nativeNames ? `${nativeNames.length} existing names · adding a meaning is optional` : `${tags.length} saved tags`), extending ? h('p', 'card-description', 'Suggested additions and updates; your other saved tags are kept.') : null), h('div', 'inline', button('Add tag', () => newTag(true), preparation ? 'quiet' : 'primary'), preparation ? button('Apply tag list', async () => { await run('apply-tag-list', { id: preparation.id }, 'Tag list saved. Choose which papers to tag next.');buildMode = 'extend';buildScope = 'selected';assignmentView = 'setup';nav('assignment'); }, 'primary', !preparation.canApply || preparation.status === 'checking') : null));
    if (preparation) header.querySelector<HTMLButtonElement>('.primary')!.id = 'apply-tag-list';
    const tabs = h('div', 'tag-workspace-tabs');
    tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', 'Tags and questions');
    for (const [value, label] of [['tags', 'Tags'], ['questions', `Questions (${questions.length})`]] as const) {
      const tab = button(label, () => { tagView = value;render(); }, view === value ? 'selected' : 'quiet');
      tab.setAttribute('role', 'tab');tab.setAttribute('aria-selected', String(view === value));tabs.append(tab);
    }
    const content = h('div', 'tag-workspace-list card');
    content.id = 'tag-list-scroll';content.setAttribute('data-view-key', `${preparation?.id || s.vocabularyVersion}:${view}:${view === 'tags' ? vocabularyPage : tagQuestionPage}`);
    if (preparation?.status === 'failed') content.append(h('div', 'notice warning', h('p', '', humanMessage(preparation.error || 'We could not finish preparing tags. Your completed paper analysis is saved.')), button('Try again', () => run('retry-tag-preparation', { id: preparation.id }, 'Checking your tags again.'), 'small')));
    if (preparation?.status === 'checking') content.append(h('div', 'notice info', h('p', '', 'Your papers have been read. We are checking the tag names and meanings.'), s.queue.status !== 'running' ? button('Resume checks', () => run('retry-tag-preparation', { id: preparation.id }, 'Checking your tags.'), 'small') : null));
    if (view === 'questions') {
      if (!questions.length) content.append(empty('No questions waiting', 'You can browse or edit the tags before applying the list.', button('Back to tags', () => { tagView = 'tags';render(); }, 'quiet')));
      for (const question of questions.slice(tagQuestionPage * 10, (tagQuestionPage + 1) * 10)) {
        const cardBody = h('article', 'tag-question', h('h3', '', question.title), h('p', '', question.description));
        if (question.paperIds.length) cardBody.append(h('div', 'warning-papers', ...question.paperIds.slice(0, 3).map(id => paperButton(id))));
        const choices = h('div', 'question-choices');
        for (const choice of question.choices) {
          const answer = button(choice.label, () => run('answer-tag-question', { id: preparation!.id, questionId: question.id, choiceId: choice.id }, 'Choice saved.'), 'question-choice');
          answer.setAttribute('aria-label', choice.label);
          if (choice.description) answer.append(h('small', '', choice.description));choices.append(answer);
        }
        cardBody.append(choices);content.append(cardBody);
      }
      if (questions.length > 10) content.append(pagination(questions.length, tagQuestionPage, next => { tagQuestionPage = next; }, 10, 'questions'));
    } else {
      if (!prepared && s.tagShelves?.length) content.append(libraryShelfControls());
      content.append(h('div', 'tag-list-search', input('vocabulary-search', vocabQuery, value => { vocabQuery = value;vocabularyPage = 0;render(); }, 'Find a tag or another name…', 'search')));
      if (!(nativeNames?.length ?? tags.length)) content.append(empty('No tags here yet', nativeNames ? 'Existing library names will appear here. You can leave them as they are.' : 'Build tags from a few papers, or add a tag of your own.'));
      for (const entry of (nativeNames || []).slice(vocabularyPage * 20, (vocabularyPage + 1) * 20)) {
        const tag = entry.tagId ? tagById(entry.tagId) : undefined;
        const protectedName = entry.protected || entry.name === 'no_tag' || tag?.builtin;
        const edit = !protectedName ? button(tag ? 'Edit meaning' : 'Add meaning', () => {
          if (tag) editTag(tag);
          else { newTag(true, undefined, false);editorTag!.name = entry.name;editorTag!.fullName = entry.name;editorTag!.aliases = [entry.name];render();doc.getElementById('tag-description')?.focus(); }
        }, 'quiet small') : null;
        edit?.setAttribute('aria-label', `${tag ? 'Edit' : 'Add'} meaning for ${entry.name}`);
        content.append(h('article', 'tag-row', h('div', 'inline between', h('strong', '', entry.name), edit), h('p', 'card-description', `${entry.paperCount} papers · ${protectedName ? 'Excluded from tagging' : tag ? 'Meaning saved' : 'No meaning added'}`), tag ? h('p', '', tag.description) : null));
      }
      for (const tag of (nativeNames ? [] : tags).slice(vocabularyPage * 20, (vocabularyPage + 1) * 20)) {
        const retained = !!preparation && tag.retained === true;
        const edit = button(retained ? 'Edit in tag library' : 'Edit', () => retained ? navigate({ page: 'vocabulary', tagId: tag.id }) : editTag(tag, preparation?.id || ''), 'small quiet');edit.setAttribute('aria-label', retained ? `Edit saved tag ${tag.name} in tag library` : `Edit tag ${tag.name}`);
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
        const countLabel = preparation && !retained ? `${tag.coverage ?? 0} ${preparation.verificationScope === 'representative' ? 'verified example papers' : 'papers in this build'}` : `${tagById(tag.id)?.currentlyTaggedCount ?? tag.currentlyTaggedCount ?? 0} papers tagged`;
        content.append(h('article', 'tag-row', h('div', 'inline between', h('div', 'tag-heading', h('strong', '', tag.name), retained ? badge('Saved tag · kept unchanged') : null), actions), tag.fullName && tag.fullName !== tag.name ? h('p', 'concept-full-name', tag.fullName) : null, h('p', '', tag.description), h('div', 'tag-meta', h('span', '', countLabel), tag.aliases.length ? h('span', '', `Other names: ${tag.aliases.join(', ')}`) : null)));
      }
      if ((nativeNames?.length ?? tags.length) > 20) content.append(pagination(nativeNames?.length ?? tags.length, vocabularyPage, next => { vocabularyPage = next; }, 20, 'tags'));
    }
    const note = h('p', 'card-description', preparation ? 'Next, choose which papers to tag. No paper tags change yet.' : 'Project collections and existing paper tags stay under your control.');
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
    const workspace = h('div', `tag-workspace ${editorVisible ? 'has-editor' : ''}`, header, preparation && questions.length ? tabs : null, note, recovery, h('div', 'tag-workspace-columns', content, tagEditor(editorVisible)));
    return workspace;
  }

  function renderCleanup() {
    const s = currentState();
    return s.tagPreparation ? h('div', 'stack', h('div', 'actions', button(buildSetupOpen ? 'Hide build setup' : 'Change build group', () => { buildSetupOpen = !buildSetupOpen;render(); }, 'quiet small')), buildSetupOpen ? renderBuild() : null, renderVocabulary(true)) : renderBuild();
  }

  function renderAssignment() {
    const s = currentState();
    const tabs = h('div', 'tag-workspace-tabs');tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', 'Assignment views');
    const pending = s.suggestions.filter(item => item.status === 'pending' && !item.applied).length;
    for (const [value, label] of [['setup', 'Assignment setup'], ['suggestions', `Paper suggestions (${pending})`]] as const) {
      const tab = button(label, () => { assignmentView = value;render(); }, assignmentView === value ? 'selected' : 'quiet');tab.setAttribute('role', 'tab');tab.setAttribute('aria-selected', String(assignmentView === value));tabs.append(tab);
    }
    if (assignmentView === 'suggestions') return h('div', 'stack', tabs, renderReview());
    const shelf = s.tagShelves?.find(shelf => shelf.id === assignmentTagShelfId);
    const shelfTags = approvedTags().filter(tag => !shelf || shelf.tagIds.includes(tag.id));
    const unavailable = !canAnalyze() || !shelfTags.length || s.queue.status === 'running';
    const suggest = async (scope: Scope) => { assignmentRunSelection = null;selectedSuggestions.clear();await run('tag', { scope, tagShelfId: assignmentTagShelfId }, 'Paper suggestions queued.');assignmentView = 'suggestions';render(); };
    const group = h('div', 'stack', field('Tags to use', select('assignment-tag-shelf', assignmentTagShelfId, tagShelfOptions(true), value => { assignmentTagShelfId = value;render(); }, 'Assignment tag shelf')), field('Papers to assign tags', scopeSelect('assignment-scope', assignmentScope, value => { assignmentScope = value;render(); }), 'This group is independent of the papers used to build your tag list.'), shelf && !shelfTags.length ? h('p', 'notice info', 'This shelf has no tags with meanings yet. Add a meaning or choose another shelf.') : null, s.workflow?.assignmentScope === assignmentScope ? h('p', 'card-description', `${s.workflow.assignmentPaperCount} papers in the last chosen group · ${s.workflow.assignedPaperCount} with Smart Tags assignments`) : null, h('div', 'actions', button('Suggest paper tags', () => suggest(assignmentScope), 'primary', unavailable)), h('p', 'card-description', 'Existing paper tags stay unchanged until you apply reviewed suggestions.'));
    const pilot = h('div', '', h('p', '', s.pilotReviewed ? 'Your assignment pilot is reviewed. You can enable routine assignment below.' : 'Complete and review a 50-paper assignment pilot before enabling routine assignment. You can still tag another chosen group manually.'), h('div', 'actions', button('Run assignment pilot', () => suggest('pilot'), '', unavailable), button(s.pilotReviewed ? 'Pilot reviewed' : 'Mark pilot reviewed', () => run('mark-pilot-reviewed', undefined, 'Pilot review recorded.'), '', s.pilotReviewed || !s.workflow?.assignmentPilotReady || s.queue.status === 'running')));
    const routineValue = routineDraft ?? s.settings.autoAssign;
    const routine = h('div', '', checkbox('assignment-auto-assign', routineValue, 'Automatically assign supported tags when a new paper is added', value => { routineDraft = value;render(); }, !s.pilotReviewed), h('p', 'card-description', 'Unclear matches remain suggestions. Manual removals, rejected matches, and locked assignments are remembered.'), h('div', 'actions', button('Save routine assignment', async () => { await run('save-settings', { settings: { ...currentState().settings, autoAssign: routineValue } }, 'Routine assignment saved.');routineDraft = null;render(); }, 'primary', routineValue === s.settings.autoAssign || !s.pilotReviewed)), routineValue !== s.settings.autoAssign ? h('p', 'card-description', 'Unsaved routine-assignment change') : null);
    return h('div', 'stack', tabs, !approvedTags().length ? h('div', 'notice info inline between', h('span', '', 'Save a tag list before assigning paper tags.'), button('Build tags', () => nav('cleanup'), 'small')) : !canAnalyze() ? h('div', 'notice info inline between', h('span', '', 'Connect an AI model before requesting suggestions.'), button('Connect AI', () => nav('connection'), 'small')) : null, card('Choose the papers to tag', 'Saving tags does not start paper assignment.', group), details('Routine assignment settings', routineSettingsOpen, value => { routineSettingsOpen = value; }, () => h('div', 'stack', card('Assignment pilot', 'The pilot checks paper matching before routine assignment.', pilot), card('Routine assignment', 'Enable this only when you are ready to use the saved list for incoming papers.', routine))));
  }

  function nativeChanges(changes: { paperId: string; title: string; before: string[]; after: string[] }[], pageIndex: number, changed: (page: number) => void, noun: string) {
    const index = Math.min(pageIndex, Math.max(0, Math.ceil(changes.length / 50) - 1));
    const list = h('div', 'native-change-preview');
    for (const change of changes.slice(index * 50, (index + 1) * 50)) list.append(h('article', 'paper-card', h('strong', '', change.title), h('p', '', `Before: ${change.before.join(', ') || 'No tags'}`), h('p', '', `After: ${change.after.join(', ') || 'No tags'}`)));
    if (!changes.length) list.append(h('p', 'card-description', 'No paper tags need to change.'));
    if (changes.length > 50) list.append(pagination(changes.length, index, changed, 50, noun));
    return list;
  }
  function syncKeepChoices() {
    const existing = currentState().existingTags;
    if (!existing) return;
    const inventory = JSON.stringify(existing.rows.map(row => [row.name, row.paperIds, !!row.protected, !!row.locked]));
    if (keepPlanId && keepDraftDirty && (keepPlanId !== existing.id || keepInventoryKey !== inventory)) { keepDraftStale = true;return; }
    if (!keepPlanId || !keepDraftDirty) {
      keptNames.clear();for (const row of existing.rows) if (row.kept || row.protected) keptNames.add(row.name);
      keepPlanId = existing.id;keepInventoryKey = inventory;keepDraftStale = false;
    }
  }
  function renderKeepTags() {
    const existing = currentState().existingTags;syncKeepChoices();
    const all = existing?.rows || [], rows = all.filter(row => (!existingTagQuery || row.name.toLocaleLowerCase().includes(existingTagQuery.toLocaleLowerCase())) && (keepFilter === 'all' || keepFilter === 'kept' && keptNames.has(row.name) || keepFilter === 'remove' && !keptNames.has(row.name) || keepFilter === 'protected' && row.protected));
    const running = existing?.status === 'queued' || existing?.status === 'running';
    existingTagPage = Math.min(existingTagPage, Math.max(0, Math.ceil(rows.length / 30) - 1));
    const controls = h('div', 'toolbar', input('keep-tag-search', existingTagQuery, value => { existingTagQuery = value;existingTagPage = 0;render(); }, 'Find a tag name…', 'search'), select('keep-tag-filter', keepFilter, [['all', 'All names'], ['kept', 'Kept names'], ['remove', 'Names to remove'], ['protected', 'Always kept']], value => { keepFilter = value;existingTagPage = 0;render(); }, 'Keep choices'), button('Read library tags', () => run('refresh-existing-tags', {}, 'Existing tags refreshed.'), '', running));
    const list = h('section', 'card existing-tags-list');
    for (const row of rows.slice(existingTagPage * 30, (existingTagPage + 1) * 30)) {
      list.append(h('article', 'existing-tag-row', checkbox(`keep-name-${row.id}`, keptNames.has(row.name) || row.protected === true, row.name, checked => { checked ? keptNames.add(row.name) : keptNames.delete(row.name);keepDraftDirty = true;render(); }, row.protected), h('div', 'inline', h('span', 'muted', `${row.affectedCount} papers · ${row.manualCount} manual`), row.protected ? badge('Always kept') : row.locked ? badge('Earlier protected choice') : null)));
    }
    if (!rows.length) list.append(empty(existing ? 'No matching names' : 'Read the tags already on your papers', existing ? 'Try another search or Keep filter.' : 'Choose the names to retain before previewing removal of the others.'));
    if (rows.length > 30) list.append(pagination(rows.length, existingTagPage, next => { existingTagPage = next; }, 30, 'names'));
    const preview = existing?.keepPreview;
    return h('div', 'stack', h('p', 'card-description', 'Keep the names you want on your papers. Every other name in this inventory will be removed only after you review the paper changes. no_tag always stays.'), controls,
      h('div', 'notice inline between', h('span', '', `${all.filter(row => keptNames.has(row.name) || row.protected).length} kept · ${all.filter(row => !keptNames.has(row.name) && !row.protected).length} names to remove across the full inventory`), button('Keep shown names', () => { for (const row of rows) keptNames.add(row.name);keepDraftDirty = true;render(); }, 'small quiet', !rows.length)),
      keepDraftStale ? h('div', 'notice warning', h('p', '', 'The inventory or protected choices changed. Reload saved Keep choices before previewing removals.'), button('Reload saved Keep choices', () => { keepDraftDirty = false;keepPlanId = '';render(); }, 'small')) : null,
      list, h('div', 'actions', button('Preview removal of other tags', async () => {
        keepPreviewPage = 0;await run('set-kept-existing-tags', { planId: existing!.id, names: [...keptNames] });keepDraftDirty = false;
        await run('preview-keep-removals', { planId: currentState().existingTags!.id });
      }, 'primary', !existing || running || keepDraftStale), button('Define kept topics…', async () => {
        if (keepDraftDirty) { await run('set-kept-existing-tags', { planId: existing!.id, names: [...keptNames] });keepDraftDirty = false; }
        existingTagView = 'compare';existingTagFilter = 'kept';existingTagQuery = '';existingTagFacet = 'all';existingTagAction = 'replace';existingTagPage = 0;selectedExistingTags.clear();render();
      }, '', !existing || running || keepDraftStale || !all.some(row => keptNames.has(row.name) && !row.protected))),
      preview ? card('Review removal of other tags', `${preview.removedNames.length} names · ${preview.paperCount} papers · ${preview.overrideCount} earlier protections explicitly replaced`, h('div', '', keepDraftDirty || keepDraftStale ? h('p', 'notice warning', 'Keep choices changed. Preview again before applying.') : null, h('p', '', `Names to remove: ${preview.removedNames.join(', ') || 'None'}`), nativeChanges(preview.changes, keepPreviewPage, next => { keepPreviewPage = next; }, 'removal changes')), button('Apply reviewed removals', () => run('apply-keep-removals', { previewId: preview.id }, 'Reviewed tag removals applied. Undo is available in Activity.'), 'primary', keepDraftDirty || keepDraftStale || !preview.changes.length)) : null);
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
    diyComparisonPage = Math.min(diyComparisonPage, Math.max(0, Math.ceil(comparison.pairs.length / 20) - 1));
    for (const pair of comparison.pairs.slice(diyComparisonPage * 20, (diyComparisonPage + 1) * 20)) body.append(h('article', 'tag-row', h('div', 'inline between', h('strong', '', `${pair.diyName} → ${pair.targetName}`), badge(labels[pair.relation])), h('p', '', pair.reason), pair.relation === 'equivalent' ? checkbox(`diy-merge-${pair.id}`, selectedDIYComparisons.has(pair.id), `Merge ${pair.diyName} into ${pair.targetName}`, checked => { if (checked) { for (const other of comparison.pairs) if (other.diyId === pair.diyId) selectedDIYComparisons.delete(other.id);selectedDIYComparisons.add(pair.id); }else selectedDIYComparisons.delete(pair.id);overrideDIYConflicts = false;render(); }) : null, pair.conflict ? h('p', 'card-description', 'This merge affects a remembered choice and requires an explicit override.') : null));
    if (comparison.pairs.length > 20) body.append(pagination(comparison.pairs.length, diyComparisonPage, next => { diyComparisonPage = next; }, 20, 'comparisons'));
    if (conflict) body.append(checkbox('diy-override-conflicts', overrideDIYConflicts, 'Replace conflicting remembered choices for these selected merges', value => { overrideDIYConflicts = value;render(); }));
    body.append(h('div', 'actions', button('Preview selected merges', async () => { diyPreviewPage = 0;await run('preview-diy-merges', { id: comparison.id, pairIds: selected.map(pair => pair.id), ...(overrideDIYConflicts ? { overrideConflicts: true } : {}) });diyPreviewKey = key;render(); }, 'primary', !selected.length || conflict && !overrideDIYConflicts || ['queued', 'running'].includes(comparison.status))));
    const preview = comparison.preview;
    if (preview) body.append(card('Review tag merges', `${preview.mergeCount} definitions to merge · ${preview.overrideCount} earlier choices replaced`, h('div', '', diyPreviewKey !== key ? h('p', 'notice warning', 'Choose the matches and preview them before applying.') : null, nativeChanges(preview.changes, diyPreviewPage, next => { diyPreviewPage = next; }, 'merge changes')), button('Apply reviewed merges', () => run('apply-diy-merges', { previewId: preview.id }, 'Reviewed tag merges applied. Undo is available in Activity.'), 'primary', diyPreviewKey !== key || ['queued', 'running'].includes(comparison.status))));
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
    const rows = sourceRows.filter(row => (existingTagFilter === 'all' || existingTagFilter === 'kept' && row.kept && !row.protected || row.status === existingTagFilter)
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
    existingTagPage = Math.min(existingTagPage, Math.max(0, Math.ceil(rows.length / 30) - 1));
    const visible = rows.slice(existingTagPage * 30, (existingTagPage + 1) * 30);
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
      existingPreviewPage = Math.min(existingPreviewPage, Math.max(0, Math.ceil(preview.changes.length / 50) - 1));
      for (const change of preview.changes.slice(existingPreviewPage * 50, (existingPreviewPage + 1) * 50)) changes.append(h('article', 'paper-card', h('strong', '', change.title), h('p', '', `Before: ${change.before.join(', ') || 'No tags'}`), h('p', '', `After: ${change.after.join(', ') || 'No tags'}`)));
      changes.append(pagination(preview.changes.length, existingPreviewPage, next => { existingPreviewPage = next; }, 50, 'paper changes'));
      review = card('Review paper tag changes', preview.changes.length ? `${preview.changes.length} papers. These changes include any existing manual tags shown below.` : 'The selected choices leave paper tags unchanged.', changes, button(preview.changes.length ? 'Apply reviewed tag changes' : 'Confirm reviewed choices', async () => { await run('apply-existing-tag-changes', { previewId: preview.id }, 'Reviewed choices saved.');selectedExistingTags.clear();render(); }, 'primary'));
    }
    return h('div', 'stack', toolbar, controls, existingTagFilter === 'kept' ? h('p', 'card-description', 'Select the scientific topics you want to define, then choose Create tags from selected names. Project and workflow names can stay ordinary tags.') : null, existing?.message ? h('p', 'card-description', humanMessage(existing.message)) : null, bulk, actions, list, pagination(rows.length, existingTagPage, next => { existingTagPage = next; }, 30, 'existing tags'), review);
  }

  function paperAttention() {
    const all = [...new Map((currentState().paperAttention?.papers || []).map(paper => [paper.id, paper])).values()];
    const papers = all.filter(paper => (attentionFilter === 'all' || (attentionFilter === 'attention' ? paper.status === 'needsInformation' || paper.status === 'failed' : paper.status === attentionFilter))
      && (!attentionQuery || paper.title.toLocaleLowerCase().includes(attentionQuery.toLocaleLowerCase())));
    attentionPage = Math.min(attentionPage, Math.max(0, Math.ceil(papers.length / 25) - 1));
    const visible = papers.slice(attentionPage * 25, (attentionPage + 1) * 25);
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
    list.append(h('div', 'inline between attention-select-page', selectPage, h('span', 'muted', `${papers.length} papers`)));
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
    if (papers.length > 25) list.append(pagination(papers.length, attentionPage, next => { attentionPage = next; }, 25, 'papers'));
    return list;
  }

  function paperExclusionReview() {
    const preview = currentState().paperExclusionPreview;
    if (!preview) return null;
    paperExclusionPage = Math.min(paperExclusionPage, Math.max(0, Math.ceil(preview.changes.length / 50) - 1));
    const body = h('div', 'paper-exclusion-preview');
    for (const change of preview.changes.slice(paperExclusionPage * 50, (paperExclusionPage + 1) * 50)) body.append(h('article', 'paper-card', h('strong', '', change.title), h('p', '', `Before: ${change.before.join(', ') || 'No tags'}`), h('p', '', `After: ${change.after.join(', ') || 'No tags'}`)));
    body.append(pagination(preview.changes.length, paperExclusionPage, next => { paperExclusionPage = next; }, 50, 'exclusion changes'));
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
    check.addEventListener('change', () => { check.checked ? selectedSuggestions.add(suggestion.id) : selectedSuggestions.delete(suggestion.id); render(); });
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
    if (review.status !== 'finished' || !review.report) return null;
    const topics = review.report.topics.filter(topic => !topic.resolved);
    topicPage = Math.min(topicPage, Math.max(0, Math.ceil(topics.length / 20) - 1));
    const selected = topics.filter(topic => selectedTopicIds.has(topic.id));
    const paperIds = [...new Set(selected.flatMap(topic => topic.paperIds))];
    const target = topicAdditionalTarget ?? currentState().settings.extensionTagTarget ?? 30;
    const targetInput = input('topic-additional-tag-target', String(target), value => { topicAdditionalTarget = Number(value);render(); }, '', 'number');targetInput.min = '1';targetInput.max = '500';targetInput.step = '1';
    const body = h('div', '', h('p', 'card-description', 'These topics were reported by the completed assignment. They have not been added to your tag list.'));
    for (const topic of topics.slice(topicPage * 20, (topicPage + 1) * 20)) body.append(h('article', 'tag-row', checkbox(`assignment-topic-${topic.id}`, selectedTopicIds.has(topic.id), topic.name, checked => { checked ? selectedTopicIds.add(topic.id) : selectedTopicIds.delete(topic.id);render(); }), h('p', 'card-description', `${topic.paperIds.length} papers${topic.reason ? ` · ${topic.reason}` : ''}`), h('div', 'warning-papers', ...topic.paperIds.slice(0, 3).map(id => paperButton(id)))));
    if (!topics.length) body.append(h('p', '', 'No uncovered topics are waiting.'));
    if (topics.length > 20) body.append(pagination(topics.length, topicPage, next => { topicPage = next; }, 20, 'topics'));
    if (topics.length) body.append(field('New tags to suggest', targetInput, 'Saved tags are kept. Your combined tag library can grow beyond 60.'), h('div', 'actions', button('Extend from selected topics', async () => { await run('extend-assignment-topics', { runId: review.id, paperIds, additionalTargetCount: target }, 'Preparing additions from the selected topic papers.');if (!currentState().paperExclusionPreview) nav('cleanup'); }, 'primary', !paperIds.length || !Number.isInteger(target) || target < 1 || target > 500 || currentState().queue.status === 'running')));
    return card('Topics outside your saved list', `${topics.length} topics · ${review.report.paperIds.length} papers`, body);
  }
  function renderReview() {
    const s = currentState();
    const reviews = assignmentReviews(), review = selectedAssignmentReview(), scope = scopedSuggestions(), scopeIds = new Set(scope.map(item => item.id));
    const suggestions = relevantSuggestions();
    reviewPage = Math.min(reviewPage, Math.max(0, Math.ceil(suggestions.length / PAGE_SIZE) - 1));
    const visible = suggestions.slice(reviewPage * PAGE_SIZE, (reviewPage + 1) * PAGE_SIZE);
    const applicableSelected = [...selectedSuggestions].filter(id => { const item = suggestionMap.get(id); return scopeIds.has(id) && !!item && !item.applied && item.status !== 'rejected'; });
    const accepted = scope.filter(item => item.status === 'accepted' && !item.applied && (!review || review.acceptedIds.includes(item.id))).map(item => item.id);
    const older = s.suggestions.some(item => !item.runId || !reviews.some(review => review.id === item.runId));
    const runOptions: [string,string][] = reviews.map((review, index) => [review.id, review.label || `Assignment ${index + 1} · ${review.scopeCount} papers`]);if (older) runOptions.push(['legacy', 'Earlier suggestions']);
    const runSelector = reviews.length ? select('assignment-result', assignmentRunSelection || reviews[0].id, runOptions, value => { assignmentRunSelection = value;selectedSuggestions.clear();selectedTopicIds.clear();reviewPage = 0;topicPage = 0;render(); }, 'Assignment result') : null;
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
    return compiled.mode === 'all' ? intersect(clauses) : new Set(clauses.flatMap(ids => [...ids]));
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
    const coreTags = tags;
    const details = tags.filter(tag => (tag.relatedIds || []).length > 0);
    const query = paperQuery.toLocaleLowerCase();
    const matches = matchingPaperIds(conceptFilter);
    const papers = s.papers.filter(paper => matches.has(paper.id) && (!query || searchable(paper).includes(query)));
    libraryPage = Math.min(libraryPage, Math.max(0, Math.ceil(papers.length / PAGE_SIZE) - 1));
    const toolbar = h('div', 'toolbar', input('paper-search', paperQuery, value => { paperQuery = value; libraryPage = 0; render(); }, 'Search titles, abstracts, and summaries…', 'search'), button('Save tag search…', () => { modal = { kind: 'search' }; searchName = conceptFilter.selections.map(selection => `${tagName(selection.conceptId)}${selection.contextId ? ` in ${tagName(selection.contextId)}` : ''}`).join(conceptFilter.mode === 'all' ? ' + ' : ' or '); render(); }, '', !conceptFilter.selections.length), h('span', 'search-results', `${papers.length} papers`));
    const filters = h('div', '', h('div', 'toolbar', input('concept-search', conceptQuery, value => { conceptQuery = value; render(); }, 'Find a tag, abbreviation, other name, or meaning…', 'search'), select('concept-filter-mode', conceptFilter.mode, [['all', 'All · every selection'], ['any', 'Any · at least one selection']], value => { conceptFilter = { ...conceptFilter, mode: value }; libraryPage = 0; render(); }, 'Combine selected tags')));
    const counts = new Map<string, number>();
    const count = (conceptId: string, contextId?: string) => {
      const key = filterSelectionKey(conceptId, contextId);
      if (!counts.has(key)) counts.set(key, matchingPaperIds({ mode: 'all', selections: [{ conceptId, ...(contextId ? { contextId } : {}) }] }).size);
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
    const associatedDetails = (id: string) => details.filter(tag => (tag.relatedIds || []).includes(id) || (tagById(id)?.relatedIds || []).includes(tag.id) || tag.broaderIds.includes(id));
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
      branch.addEventListener('toggle', () => { if (branch.isConnected) branch.open ? expandedConcepts.add(tag.id) : expandedConcepts.delete(tag.id); });
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
    if (!coreTags.length && !details.length) filters.append(empty('No tags ready yet', 'Prepare a tag list, or add a topic of your own.'));
    const noTag = s.tags.find(tag => tag.builtin === 'no_tag');
    if (noTag) filters.append(h('div', 'section-gap', h('h3', '', 'Excluded from tagging'), h('div', 'concept-tree-row', checkbox('explore-builtin-no-tag', isConceptSelected(noTag.id), 'no_tag', () => toggleConcept(noTag.id)), h('span', 'concept-count', String(count(noTag.id))))));
    const selections = h('div', 'selected-concepts');
    for (const selection of conceptFilter.selections) selections.append(h('div', 'selected-concept', h('span', '', `${tagName(selection.conceptId)}${selection.contextId ? ` in ${tagName(selection.contextId)}` : ''}`), button('Remove', () => toggleConcept(selection.conceptId, selection.contextId), 'quiet small')));
    const filterCard = card('Browse tags', 'A broader tag includes its narrower topics. A related tag chosen inside another tag requires both. Match all your selections or any selection.', h('div', '', filters, selections), button('Clear filters', () => { conceptFilter = { ...conceptFilter, selections: [] }; libraryPage = 0; render(); }, 'quiet small', !conceptFilter.selections.length));
    const list = h('section', 'card');
    if (!papers.length) list.append(empty('No papers match', s.papers.length ? 'Try fewer tags or a broader search.' : 'Analyze a pilot or your library to create a local content index.'));
    for (const paper of papers.slice(libraryPage * PAGE_SIZE, (libraryPage + 1) * PAGE_SIZE)) {
      const chips = h('div', 'chips');
      for (const tag of (paper.tags || []).slice(0, 12)) chips.append(h('span', 'tag-chip', tag));
      list.append(h('article', 'paper-card', paperButton(paper.id), paper.summary ? h('p', 'muted', paper.summary) : null, chips, paper.evidenceStatus ? h('p', 'muted', paper.evidenceStatus) : null, h('div', 'actions', button('Related papers', () => { selectedPaper = paper.id; render(); }, 'quiet small'))));
    }
    const selected = paperById(selectedPaper);
    const related = h('div', '');
    if (selected) {
      related.append(h('p', 'paper-title', selected.title), h('div', 'divider'));
      const neighbors = s.neighbors[selected.id] || [];
      if (!neighbors.length) related.append(h('p', 'muted', 'No content neighbors are available yet. Analyze more papers to expand the index.'));
      for (const neighbor of neighbors.slice(0, 10)) related.append(h('div', 'paper-card', paperButton(neighbor.paperId), h('p', 'muted', `Content similarity · ${Math.round(neighbor.score * 100)}%`)));
    } else related.append(h('p', 'muted', 'Choose “Related papers” on a paper to see its nearest content neighbors. These are similarity suggestions, not citation relationships.'));
    return h('div', 'stack', toolbar, filterCard, h('div', 'split', h('div', 'stack', list, pagination(papers.length, libraryPage, next => { libraryPage = next; })), h('div', 'editor', card('Related papers', '', related))));
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
    const progress = h('div', '', h('div', 'inline between', badge(queuePhaseLabel(), q.status === 'running' ? 'approved' : q.status === 'paused' ? 'draft' : ''), !q.taskLabel ? h('span', 'muted', `${q.completed} papers read · ${q.failed} failed · ${q.needsInformation ?? 0} need information · ${q.skipped ?? 0} skipped`) : null), q.selection ? h('div', 'section-gap', h('p', '', `${currentProgress.label}: ${currentProgress.completed} of ${currentProgress.total}`), q.selection.verificationScope === 'representative' ? h('p', '', `Examples checked: ${q.selection.examplesChecked ?? 0} of ${q.selection.examplesTotal ?? 0}`) : null, h('p', 'card-description', `${q.selection.completedRequests} requests completed · ${q.selection.queuedRequests} requests queued`), corrections) : q.phaseProgress && q.phaseProgress.total > 0 ? h('p', '', `${q.phaseProgress.label}: ${q.phaseProgress.completed} of ${q.phaseProgress.total}`) : null, q.message ? h('p', 'card-description', humanMessage(q.message)) : null,
      h('div', 'actions', fasterBuildButton('primary'), resumeQueueButton(q.canUseFasterBuild || q.switchingToFasterBuild && q.status !== 'paused' ? '' : 'primary', q.status !== 'paused'), button('Pause', () => run('pause'), '', q.status !== 'running'), button('Cancel remaining', () => run('cancel', undefined, 'Remaining jobs canceled. Completed analysis is kept.'), 'danger', q.status === 'idle')),
      h('p', 'card-description', runProvider !== 'chatgpt' ? apiCost : 'This work uses your ChatGPT allowance. It pauses when the allowance is reached.'));
    if (s.tagPreparation) progress.append(h('div', 'section-gap', h('h3', '', s.tagPreparation.status === 'ready' ? 'Your tag list is ready' : s.tagPreparation.status === 'questions' ? 'A few tag choices are waiting' : 'Your tag list is saved'), button('Open tags', () => nav('cleanup'), 'small')));
    const history = h('div', '');
    if (!s.history.length) history.append(empty('No applied changes yet', 'Approved tag assignments and cleanup batches will appear here with their undo status.'));
    else {
      const table = h('table', '', h('thead', '', h('tr', '', h('th', '', 'Change'), h('th', '', 'Date'), h('th', '', 'Items'), h('th', '', 'Action'))));
      const tbody = h('tbody');
      for (const record of s.history.slice(0, 100)) {
        const date = new Date(record.date);
        tbody.append(h('tr', '', h('td', '', h('strong', '', record.label), record.status ? h('span', 'muted', record.status) : null), h('td', '', Number.isNaN(date.getTime()) ? record.date : date.toLocaleString()), h('td', '', String(record.count)), h('td', '', button('Undo', () => run('undo', { id: record.id }, 'Undo completed. Later manual edits are preserved.'), 'small', !record.canUndo))));
      }
      table.append(tbody); history.append(h('div', 'table-wrap', table));
    }
    const active = (s.warnings || []).filter(warning => warning.status === 'active' && !warning.legacy && !['evidence-gap', 'unapproved-topics'].includes(warning.code));
    const notices = active.length ? card('Needs attention', '', h('div', '', ...active.map(warning => warningEntry(warning, true)))) : null;
    return h('div', 'stack', card(q.taskLabel || 'Paper analysis', 'Completed work is kept if you pause or close Zotero.', progress), notices, card('Papers that need attention', s.paperAttention?.queued ? `${s.paperAttention.queued} papers queued` : '', paperAttention()), paperExclusionReview(), metadataReview(), warningHistory(), h('section', 'card', h('div', 'card-header', h('h2', '', 'Applied changes')), history));
  }

  function renderSettings(connectionOnly = false) {
    const s = currentState();
    const draft = settingsDraft || { ...s.settings };
    settingsDraft = draft;
    const mark = <K extends keyof ManagerSettings>(key: K, value: ManagerSettings[K]) => { draft[key] = value; settingsDirty = true; };
    const providerName = draft.provider === 'deepseek' ? 'DeepSeek' : draft.provider === 'api' ? 'OpenAI' : 'ChatGPT';
    const availableModels = draft.provider === s.settings.provider ? s.models : [];
    const connection = h('div', '',
      field('AI connection', select('settings-provider', draft.provider, [['chatgpt', 'ChatGPT plan · Continue with ChatGPT'], ['api', 'OpenAI API key · separately billed'], ['deepseek', 'DeepSeek API key · separately billed']], value => {
        if (value === draft.provider) return;
        mark('provider', value);
        mark('model', '');
        mark('inputPricePerMillion', 0);
        mark('outputPricePerMillion', 0);
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
    const modelInput = input('settings-model', draft.model, value => { mark('model', value); render(); }, `Enter a model ID available through ${providerName}`);
    connection.append(h('div', 'divider'), field('Model', modelInput, 'Enter a model ID or choose from discovered models below.'));
    if (availableModels.length) connection.append(field('Discovered models', select('settings-discovered-model', availableModels.includes(draft.model) ? draft.model : '', [
      ...(!availableModels.includes(draft.model) ? [['', 'Choose a discovered model'] as [string, string]] : []),
      ...availableModels.map(model => [model, model] as [string, string]),
    ], value => { if (value) { mark('model', value); render(); } })));
    connection.append(
      h('div', 'actions', button('Discover models', async () => { await saveSettings(); await run('discover-models', undefined, `${providerName} model list updated.`); }), button('Test connection', async () => { await saveSettings(); await run('test-connection', undefined, `${providerName} connection test succeeded.`); }, 'primary', !draft.model.trim())),
      h('p', 'card-description', 'Testing sends a small AI request through the selected connection.'));
    if (s.connection.credentialStorage) connection.append(h('p', 'card-description', `Credential storage: ${s.connection.credentialStorage}`));
    const numberField = (key: 'budgetUSD' | 'inputPricePerMillion' | 'outputPricePerMillion' | 'maxOutputTokens' | 'coreConceptLimit' | 'extensionTagTarget', label: string, note: string, step: string) => {
      const control = input(`settings-${key}`, String(draft[key] ?? (key === 'extensionTagTarget' ? 30 : 60)), value => { const n = Number(value); if (Number.isFinite(n)) mark(key, n); }, '', 'number');
      control.min = key === 'maxOutputTokens' || key === 'coreConceptLimit' || key === 'extensionTagTarget' ? '1' : '0'; control.step = step;
      if (key === 'coreConceptLimit' || key === 'extensionTagTarget') control.max = '500';
      return field(label, control, note);
    };
    const budgets = h('div', '',
      h('div', 'notice', 'Budget controls apply to the selected API provider. Set its published model rates before analysis; cost estimates use those rates. Model discovery is available while rates are unset.'),
      h('div', 'section-gap', numberField('budgetUSD', 'Per-run API budget · USD', 'The queue pauses before dispatching requests that would exceed its remaining estimate.', '0.01')),
      h('div', 'field-grid', numberField('inputPricePerMillion', 'Input · USD / million tokens', 'Use the standard input rate.', '0.001'), numberField('outputPricePerMillion', 'Output · USD / million tokens', 'Use the standard output rate.', '0.001')),
      h('div', 'section-gap', numberField('maxOutputTokens', 'API output-token limit', 'This request limit is used for API-key requests.', '1')));
    const vocabulary = h('div', '', numberField('coreConceptLimit', 'Preferred number of tags', '60 is a starting point for a new list. Later additions can grow the library beyond it.', '1'), numberField('extensionTagTarget', 'Default new tags per extension', 'Each extension keeps saved definitions and suggests this many additions.', '1'));
    const transfers = h('details', 'section-gap', h('summary', '', 'Import, export, and previous tag lists'), h('div', 'actions', button('Import tags…', () => run('import-vocabulary', undefined, 'Tags imported.')), button('Export tags…', () => run('export-vocabulary'))), s.tagPreparation ? h('div', 'section-gap', button('Export analysis with paper text…', () => run('export-tag-analysis', { id: s.tagPreparation!.id })), h('p', 'card-description', 'This private export includes paper text and quotations.')) : null);
    for (const archive of s.taxonomyArchives || []) transfers.append(h('div', 'inline section-gap', h('span', '', archive.date), button('Open previous tag list', () => run('restore-taxonomy', { id: archive.id }, 'Previous tag list opened. Check it before applying.'), 'small')));
    const navigationLabels = { starting: 'Starting', ready: 'Available', hidden: 'Sidebar hidden', unavailable: 'Unavailable in this window' };
    const navigation = h('div', '', h('p', '', s.pluginVersion ? `Installed version ${s.pluginVersion}` : 'Version information is available when opened in Zotero.'), h('p', '', `Library navigation: ${s.navigation ? navigationLabels[s.navigation.status] : 'Open Zotero to check'}`), s.navigation?.message ? h('p', 'card-description', humanMessage(s.navigation.message)) : null, h('div', 'actions', button('Show tag navigation', () => run('show-tag-navigation')), button('Restore navigation', () => run('show-tag-navigation', { restore: true })), button('Check for updates', () => run('check-plugin-updates'))), h('p', 'card-description', 'Updates are managed by Zotero’s Plugins window. Your library and saved settings stay in place.'));
    const save = h('div', 'inline', button('Save settings', () => saveSettings(), 'primary'), settingsDirty ? h('span', 'muted', 'Unsaved changes') : h('span', 'muted', 'Settings saved'));
    if (connectionOnly) return h('div', 'stack', h('div', 'grid', card('AI connection', 'Select the account and model used for analysis.', connection), card(draft.provider === 'chatgpt' ? 'API budget' : `${providerName} API budget`, 'Model rates are configurable rather than assumed.', budgets)), save, canAnalyze() ? h('div', 'actions', button('Continue to Build tags', () => nav('build'))) : null);
    return h('div', 'stack', card('Smart Tags in Zotero', 'Use Smart Tags or Collections in Zotero’s left library pane.', navigation), card('Tags', 'Choose a starting point for tag preparation.', vocabulary), save, h('div', 'workflow-section-links', button('AI connection and budget', () => nav('connection')), button('Routine assignment', () => { assignmentView = 'setup';nav('assignment'); })), transfers, details('Data', dataDetailsOpen, value => { dataDetailsOpen = value; }, () => h('div', 'section-gap', button('Reset paper analysis…', () => { modal = { kind: 'reset-analysis' };render(); }, 'quiet'))));
  }
  async function saveSettings() {
    if (!settingsDraft) return;
    if (!Number.isInteger(settingsDraft.coreConceptLimit ?? 60) || (settingsDraft.coreConceptLimit ?? 60) < 1 || (settingsDraft.coreConceptLimit ?? 60) > 500) throw new Error('Set the preferred number of tags to a whole number from 1 to 500.');
    if (!Number.isInteger(settingsDraft.extensionTagTarget ?? 30) || (settingsDraft.extensionTagTarget ?? 30) < 1 || (settingsDraft.extensionTagTarget ?? 30) > 500) throw new Error('Set new tags per extension to a whole number from 1 to 500.');
    if (settingsDraft.provider !== 'chatgpt' && (settingsDraft.budgetUSD <= 0 || settingsDraft.inputPricePerMillion < 0 || settingsDraft.outputPricePerMillion < 0 || settingsDraft.maxOutputTokens < 1)) throw new Error('Set a positive API budget and output-token limit. Model rates must be zero or greater.');
    const result = await run('save-settings', { settings: { ...settingsDraft, autoAssign: currentState().settings.autoAssign } }, 'Settings saved.');
    settingsDirty = false;
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
    } else if (active.kind === 'reset-analysis') {
      title = 'Reset paper analysis?';
      applyLabel = 'Reset paper analysis';
      body.append(h('p', '', 'This clears reusable paper analyses and paper-tag suggestions. Your Zotero items, PDFs, paper tags, saved tag definitions, credentials, spending records, and audit history stay in place.'), h('p', 'section-gap', 'The next build will read the papers afresh.'));
      apply = async () => { await run('reset-paper-analysis', undefined, 'Paper analysis reset. The next build will start fresh.');modal = null;render(); };
    } else {
      title = 'Save a Zotero tag search';
      applyLabel = 'Create saved search';
      body.append(h('p', '', `Create a Zotero saved search matching ${conceptFilter.mode === 'all' ? 'all' : 'any'} of your selected tags. Other names and narrower topics are included. A topic chosen within another tag keeps that combination.`), h('div', 'section-gap', field('Search name', input('saved-search-name', searchName, value => { searchName = value; }))), h('div', 'chips', ...conceptFilter.selections.map(selection => h('span', 'tag-chip', `${tagName(selection.conceptId)}${selection.contextId ? ` in ${tagName(selection.contextId)}` : ''}`))));
      apply = async () => { if (!searchName.trim()) throw new Error('Enter a name for this saved search.'); await run('save-search', { name: searchName.trim(), filter: { mode: conceptFilter.mode, selections: conceptFilter.selections.map(selection => ({ ...selection })) } }, 'Saved search created in Zotero.'); modal = null; render(); };
    }
    const close = () => { modal = null; render(); };
    const content = h('section', 'modal', h('div', 'card-header', h('h2', '', title), button('Close', close, 'quiet small')), body, h('div', 'card-footer', button(applyLabel, apply, 'primary'), button('Cancel', close)));
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-modal', 'true');
    content.setAttribute('aria-label', title);
    content.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const focusable = [...content.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')];
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
      } else app!.replaceChildren(h('div', 'boot-message', toast || 'Opening Smart Tags…'));
      return;
    }
    const s = state;
    const sidebar = h('aside', 'sidebar', h('div', 'brand', h('span', 'brand-mark', icon('vocabulary')), h('div', '', h('strong', '', 'ZTagging'), h('small', '', 'Personal library'))));
    const navigation = h('nav', 'nav');navigation.setAttribute('aria-label', 'Library pages');
    const workflow = h('nav', 'nav workflow-nav');workflow.setAttribute('aria-label', 'Workflow steps');
    const utilities = h('nav', 'nav');
    utilities.setAttribute('aria-label', 'Library tools');
    const activePage = page === 'existing-tags' ? 'vocabulary' : page === 'review' ? 'assignment' : page === 'build' ? 'cleanup' : page;
    const addNavigation = (container: HTMLElement, target: ManagerPage, count?: number, step?: number) => {
      const navButton = button('', () => nav(target), `nav-button ${activePage === target ? 'active' : ''}`);
      navButton.id = `nav-${target}`;
      navButton.setAttribute('aria-label', pageNames[target]);
      navButton.disabled = false;
      navButton.append(step ? h('span', 'nav-step-number', String(step)) : h('span', 'nav-icon', icon(target)), h('span', '', pageNames[target]));
      if (count !== undefined && count > 0) navButton.append(h('span', 'nav-count', count.toLocaleString()));
      if (activePage === target) navButton.setAttribute('aria-current', 'page');container.append(navButton);
    };
    const homeNavigation = h('nav', 'nav');homeNavigation.setAttribute('aria-label', 'Workspace overview');addNavigation(homeNavigation, 'overview');
    (['connection', 'cleanup', 'assignment'] as const).forEach((target, index) => addNavigation(workflow, target, undefined, index + 1));
    addNavigation(navigation, 'vocabulary', approvedTags().length);addNavigation(navigation, 'library');
    addNavigation(utilities, 'activity');addNavigation(utilities, 'settings');
    const connected = connectionReady(s);
    const connectionLabel = s.settings.provider === 'deepseek' ? 'DeepSeek API connected' : s.settings.provider === 'api' ? 'OpenAI API connected' : 'ChatGPT connected';
    sidebar.append(homeNavigation, h('div', '', h('div', 'sidebar-section-label', 'Workflow'), workflow), h('div', '', h('div', 'sidebar-section-label', 'Library'), navigation), h('div', 'sidebar-utilities', h('div', 'sidebar-section-label', 'Tools'), utilities), h('div', 'sidebar-footer', h('p', '', connected ? h('span', 'status-dot') : null, connected ? connectionLabel : 'Connection needed'), h('p', '', 'Stored on this computer')));
    const home = button('Personal library', () => nav('overview'), 'breadcrumb-home');
    home.id = 'workspace-home';
    home.disabled = false;
    const breadcrumbs = h('nav', 'breadcrumbs', home, h('span', 'breadcrumb-divider', '/'), h('span', 'breadcrumb-current', pageNames[page]));
    breadcrumbs.setAttribute('aria-label', 'Breadcrumb');
    const currentCrumb = breadcrumbs.lastElementChild;
    currentCrumb?.setAttribute('aria-current', 'page');
    const topbar = h('div', 'workspace-topbar', breadcrumbs, h('div', 'header-status', busy ? h('span', 'busy-indicator', 'Working…') : s.settings.autoAssign ? 'Automatic assignment on' : 'Review before applying'));
    const workspace = h('main', `workspace ${page === 'vocabulary' || page === 'cleanup' ? 'tag-workspace-page' : ''}`, h('header', 'page-header', h('div', '', h('div', 'workspace-page-icon', icon(page)), h('h1', '', pageTitles[page][0]), h('p', 'subtitle', pageTitles[page][1]))));
    const strip = queueStrip();
    if (strip) workspace.append(strip);
    if (signingIn) {
      const cancel = button('Cancel sign-in', async () => { await api.invoke('cancel-sign-in'); }, 'small');
      cancel.disabled = false;
      workspace.append(h('div', 'notice info inline between', h('span', '', 'Complete sign-in in your browser, or cancel this attempt.'), cancel));
    }
    const warnings = activeWarnings();
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
    workspace.append(renderers[page]());
    const shell = h('div', 'shell', sidebar, h('div', 'workspace-frame', topbar, workspace));
    if (toast) {
      const toastElement = h('div', `toast ${toastError ? 'error' : ''}`, toast);
      toastElement.setAttribute('role', toastError ? 'alert' : 'status');
      shell.append(toastElement);
    }
    const modalElement = renderModal();
    if (modalElement) shell.append(modalElement);
    app!.replaceChildren(shell);
    updateTagApplyState();
    const proposalRows = doc.getElementById('tag-list-scroll');
    if (proposalRows) proposalRows.scrollTop = tagScrollPositions.get(proposalRows.getAttribute('data-view-key') || '') || 0;
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
    if (modalElement && !modalElement.contains(doc.activeElement)) {
      const first = modalElement.querySelector<HTMLElement>(modal?.kind === 'search' ? '#saved-search-name' : 'button:not(:disabled)');
      first?.focus({ preventScroll: true });
    }
    win.scrollTo(0, scrollY);
    fitTagWorkspace();
  }
  function render() {
    closeActionMenu?.();
    cleanupDropdowns(doc);
    try { renderContent(); }
    catch (error) {
      closeActionMenu?.();
      cleanupDropdowns(doc);
      diagnostic(`render failed: ${error instanceof Error ? error.message : String(error)}`);
      try {
        app!.setAttribute('data-smart-tags-state', 'error');
        const retry = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button');
        retry.textContent = 'Retry loading';
        retry.addEventListener('click', () => { void refresh(); });
        const details = doc.createElementNS('http://www.w3.org/1999/xhtml', 'p');
        details.textContent = `${error instanceof Error ? error.message : String(error)} Close and reopen Smart Tags if retry does not help. Details are logged in Zotero’s Error Console.`;
        app!.replaceChildren(h('div', 'boot-message', h('strong', '', 'Smart Tags could not render'), details, retry));
      } catch { app!.textContent = 'Smart Tags could not render. Close this window and reopen it from Zotero’s Tools menu.'; }
    }
  }
  function fitTagWorkspace() {
    for (const selector of ['.tag-editor', '.tag-workspace-list']) {
      const panel = doc.querySelector<HTMLElement>(selector);
      if (!panel || (selector === '.tag-editor' && (win.innerWidth <= 900 || win.innerHeight <= 600))) continue;
      const available = Math.max(100, win.innerHeight - Math.max(16, panel.getBoundingClientRect().top) - 16);
      panel.style.maxHeight = `${available}px`;
      if (selector === '.tag-editor') panel.style.height = `${available}px`;
    }
  }

  const unsubscribe = api.subscribe(() => { if (busy) refreshDeferred = true;else void refresh(); });
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    closeActionMenu?.(false);
    cleanupDropdowns(doc);
    unsubscribe();
    if (signingIn) void api.invoke('cancel-sign-in').catch(() => {});
    if (toastTimer) win.clearTimeout(toastTimer);
    apiKeyDrafts.api = '';
    apiKeyDrafts.deepseek = '';
    settingsDraft = null;
    win.removeEventListener('resize', fitTagWorkspace);
  };
  win.addEventListener('unload', destroy, { once: true });
  win.addEventListener('resize', fitTagWorkspace);
  void refresh();
  return { refresh, destroy, navigate };
}
