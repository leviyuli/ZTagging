import type { DisplayPaper, DisplaySuggestion, DisplayTag, ManagerAPI, ManagerPage, ManagerSettings, ManagerSnapshot, Scope } from './ui-contract';
import { createDropdown, cleanupDropdowns } from './dropdown';
import { compileConceptFilter, descendantIds } from './concept-filter';
import type { ConceptFilter } from './concept-filter';
import { canonicalTagKey } from './core';
import type { WarningRecord } from './warnings';

type Child = Node | string | null | undefined | false;
type ModalState = { kind: 'apply' | 'create-diy'; ids: string[] } | { kind: 'search' } | null;
const facets = ['system', 'component', 'phenomenon', 'method'] as const;
const facetNames: Record<string, string> = { system: 'Systems', component: 'Components & materials', phenomenon: 'Phenomena', method: 'Methods' };
const pageTitles: Record<ManagerPage, [string, string]> = {
  overview: ['Your library, clearly tagged', 'Prepare a useful tag list, then review its paper suggestions.'],
  vocabulary: ['Tags', 'Keep useful topics together, with only the questions that need your choice.'],
  'existing-tags': ['Existing tags', 'Bring useful library tags into Smart Tags and review any paper changes.'],
  review: ['Review suggestions', 'Check the evidence, keep useful tags, and teach Smart Tags your preferences.'],
  library: ['Explore your library', 'Combine approved tags and discover papers with related content.'],
  activity: ['Queue & history', 'Follow analysis progress and review changes that have been applied.'],
  settings: ['Connections & settings', 'Choose an AI connection and control automatic assignment and API spending.'],
};
const pageNames: Record<ManagerPage, string> = { overview: 'Overview', vocabulary: 'Tags', 'existing-tags': 'Existing tags', review: 'Paper suggestions', library: 'Find papers', activity: 'Activity', settings: 'Settings' };
const iconPaths = {
  overview: ['M3 10.5 12 3l9 7.5', 'M5 9v12h14V9', 'M9 21v-7h6v7'],
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
  let scope: Scope = 'pilot';
  let busy = false;
  let signingIn = false;
  let disposed = false;
  let refreshing = false;
  let refreshAgain = false;
  let refreshDeferred = false;
  let toast = '';
  let toastError = false;
  let toastTimer = 0;
  let vocabQuery = '';
  let vocabularyPage = 0;
  let tagView: 'tags' | 'questions' = 'tags';
  let tagQuestionPage = 0;
  let reviewFilter = 'pending';
  let reviewPage = 0;
  let libraryPage = 0;
  let warningHistoryPage = 0;
  let existingTagQuery = '';
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
  function nav(target: ManagerPage) { page = target; modal = null; render(); }
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
  function notify(message: string, error = false) {
    toast = message;
    toastError = error;
    if (toastTimer) win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => { toast = '';render(); }, error ? 12000 : 4000);
    render();
  }
  function humanMessage(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/authenticat|unauthori|HTTP 40[13]|sign.?in|invalid.*key/i.test(message)) return 'Please check your connection in Settings, then try again.';
    if (/budget|quota|usage limit|insufficient.balance/i.test(message)) return 'This analysis reached its usage or spending limit. Check Settings before continuing.';
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
    const status = warning.legacy ? 'Earlier notice' : warning.supersededBy ? 'Updated' : active ? 'Needs attention' : warning.status;
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
    const records = (currentState().warnings || []).filter(warning => warning.status === 'active' && !warning.legacy && warning.code !== 'evidence-gap');
    if (!records.length) return null;
    const notice = h('section', 'notice warning active-warning-summary', h('div', 'inline between', h('div', '', h('strong', '', `${records.length} ${records.length === 1 ? 'notice' : 'notices'} to check`), h('p', '', humanMessage(records[0].message))), h('div', 'inline', button('View details', () => nav('activity'), 'quiet small'), button('Dismiss all', () => run('dismiss-warnings', undefined, 'Notices dismissed.'), 'quiet small'))));
    notice.setAttribute('aria-label', 'Needs attention');
    return notice;
  }
  function warningHistory() {
    const records = (currentState().warnings || []).filter(warning => warning.status !== 'active' || warning.legacy);
    warningHistoryPage = Math.min(warningHistoryPage, Math.max(0, Math.ceil(records.length / PAGE_SIZE) - 1));
    const body = h('div', 'warning-history');
    if (!records.length) body.append(empty('No warning history', 'Resolved and dismissed warnings are kept here.'));
    else {
      for (const warning of records.slice(warningHistoryPage * PAGE_SIZE, (warningHistoryPage + 1) * PAGE_SIZE)) body.append(warningEntry(warning, false));
      body.append(h('div', 'warning-history-pagination', pagination(records.length, warningHistoryPage, next => { warningHistoryPage = next; })));
    }
    return card('Warning history', 'Resolved, dismissed, and imported historical notices remain available for review.', body);
  }
  function approvedTags() { return currentState().tags.filter(tag => tag.status === 'approved'); }
  function pagination(total: number, pageIndex: number, change: (next: number) => void, pageSize = PAGE_SIZE, noun = '') {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return h('div', 'inline between', h('span', 'muted', total ? `${pageIndex * pageSize + 1}–${Math.min(total, (pageIndex + 1) * pageSize)} of ${total}` : '0 results'),
      h('div', 'inline', button(`Previous${noun ? ` ${noun}` : ''}`, () => { change(pageIndex - 1); render(); }, 'small', pageIndex <= 0), h('span', 'muted', `${pageIndex + 1} / ${pages}`), button(`Next${noun ? ` ${noun}` : ''}`, () => { change(pageIndex + 1); render(); }, 'small', pageIndex >= pages - 1)));
  }
  function relevantSuggestions() { return currentState().suggestions.filter(item => reviewFilter === 'all' || (reviewFilter === 'applied' ? item.applied : item.status === reviewFilter && !item.applied)); }
  function scopeSelect() {
    return select<Scope>('analysis-scope', scope, [['pilot', 'Pilot · 50 papers'], ['selected', 'Selected papers in Zotero'], ['collections', 'Selected collections'], ['library', 'Whole personal library']], value => { scope = value; });
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
  function runControls() {
    const s = currentState();
    return h('div', '',
      field('Analyze', scopeSelect()),
      h('div', 'actions',
        button('Prepare tags', async () => { await run('prepare-tags', { scope }, 'Preparing your tag list.');nav('vocabulary'); }, 'primary', !canAnalyze() || s.queue.status === 'running'),
        button('Suggest paper tags', () => run('tag', { scope }, 'Tag analysis queued.'), '', !canAnalyze() || !approvedTags().length || s.queue.status === 'running')),
      !canAnalyze() ? h('p', 'card-description', 'Choose a connection and a model in Settings to start analysis.') : null,
      h('p', 'card-description', 'Start with a tag list. You will review paper changes before applying them.'));
  }
  function queueStrip() {
    const q = currentState().queue;
    if (q.status === 'idle' && !q.total) return null;
    const progress = q.phaseProgress || (q.phase && q.phase !== 'reading' ? { completed: 0, total: 0, label: '' } : { completed: q.completed + q.failed, total: q.total, label: '' });
    const percent = progress.total ? Math.min(100, progress.completed / progress.total * 100) : 0;
    const fill = h('span');
    fill.style.width = `${percent}%`;
    return h('div', 'run-strip',
      h('div', 'inline between', h('div', '', h('strong', '', queuePhaseLabel()), h('span', 'muted', ` · ${q.phaseProgress ? `${q.phaseProgress.label}: ${q.phaseProgress.completed} of ${q.phaseProgress.total}` : `${q.completed} of ${q.total} papers read`}`)),
        h('div', 'inline', q.status === 'running' ? button('Pause', () => run('pause'), 'small') : q.status === 'paused' ? button('Resume', () => run('resume'), 'small') : null, button('View activity', () => nav('activity'), 'quiet small'))),
      q.message ? h('p', 'card-description', humanMessage(q.message)) : null,
      h('div', 'progress-bar', fill));
  }
  function queuePhaseLabel() {
    const q = currentState().queue;
    if (q.status === 'paused') return 'Analysis paused';
    const labels = { reading: 'Reading papers', organizing: 'Organizing tags', checking: 'Checking tag meanings', ready: 'Ready for review' };
    return q.phase ? labels[q.phase] : q.status === 'running' ? 'Analyzing papers' : 'Analysis complete';
  }

  function renderOverview() {
    const s = currentState();
    const stats = h('div', 'stats');
    for (const [count, label] of [[approvedTags().length, 'tags ready'], [s.analyzedPaperCount ?? s.papers.length, 'papers read'], [s.suggestions.filter(item => item.status === 'pending' && !item.applied).length, 'paper suggestions'], [s.tags.filter(tag => tag.custom).length, 'your topics']] as [number, string][]) {
      stats.append(h('div', 'stat', h('strong', '', count.toLocaleString()), h('span', '', label)));
    }
    const steps = h('ol', 'step-list');
    [
      ['Connect an AI model', 'Use your eligible ChatGPT plan or a separately billed OpenAI or DeepSeek API key.'],
      ['Prepare your tags', 'Start with 50 papers. Change any names or meanings you want.'],
      ['Review paper suggestions', 'Inspect evidence, accept useful tags, and reject unwanted matches.'],
      ['Enable routine assignment', 'Review the pilot first. New papers can then use the same tags.'],
    ].forEach(([title, description], index) => steps.append(h('li', 'step', h('span', 'step-number', String(index + 1)), h('div', '', h('h3', '', title), h('p', '', description)))));
    const pilot = h('div', '', h('p', '', s.pilotReviewed ? 'Your pilot has been reviewed. Automatic assignment can be enabled in Settings.' : 'Review the pilot tags and paper suggestions before enabling automatic assignment.'), h('div', 'actions', button('Open paper suggestions', () => nav('review')), button(s.pilotReviewed ? 'Pilot reviewed' : 'Mark pilot reviewed', () => run('mark-pilot-reviewed', undefined, 'Pilot review recorded.'), 'primary', s.pilotReviewed || !approvedTags().length || !s.papers.length)));
    return h('div', '', stats, h('div', 'grid', card('Start an analysis', 'A small pilot is a useful first step.', runControls(), undefined, 'overview-primary'), card('How Smart Tags works', '', steps, undefined, 'overview-guide')), h('div', 'section-gap', card('Pilot review', 'Your decisions guide future assignments.', pilot)), h('div', 'notice section-gap', 'Your existing collections and Zotero columns stay as they are. Smart Tags organizes content through native tags and optional saved searches.'));
  }

  function newTag(custom = false, contextId?: string, shouldRender = true) {
    rememberEditorDraft();
    editorPreparationId = '';
    relationQueries.clear();
    openRelationshipPickers.clear();
    editorTag = { id: '', name: '', description: '', facet: 'phenomenon', aliases: [], inclusions: [], exclusions: [], examples: [], custom, status: 'draft', broaderIds: [], relatedIds: contextId ? [contextId] : [], matchingMode: custom ? 'suggest' : 'auto' };
    if (shouldRender) render();
  }
  function copyTag(tag: DisplayTag): DisplayTag { return { ...tag, aliases: [...tag.aliases], inclusions: [...tag.inclusions], exclusions: [...tag.exclusions], examples: [...tag.examples], broaderIds: [...tag.broaderIds], relatedIds: [...(tag.relatedIds || [])] }; }
  function rememberEditorDraft() { if (editorTag) editorDrafts.set(`${editorPreparationId}:${editorTag.id || 'new'}`, copyTag(editorTag)); }
  function editTag(tag: DisplayTag, preparationId = '', shouldRender = true) {
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
    modal = null;
    if (next.createDetail) { page = 'vocabulary'; newTag(true, next.detailContextId, false); }
    else if (next.tagId) { const tag = tagById(next.tagId); if (tag) { page = 'vocabulary'; editTag(tag, '', false); } }
    if (shouldRender) render();
  }
  function relationshipPicker(tag: DisplayTag, key: 'broaderIds' | 'relatedIds', label: string, description: string) {
    const choices = (editorPreparationId ? currentState().tagPreparation?.tags || [] : currentState().tags).filter(other => other.id !== tag.id && !other.custom);
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
  function tagEditor() {
    if (!editorTag) return h('section', 'card editor editor-placeholder', empty('Make the tags yours', 'Choose Edit beside a tag, or add a topic you want to follow.'));
    const tag = editorTag;
    const preparationId = editorPreparationId;
    const lineField = (key: 'aliases' | 'inclusions' | 'exclusions' | 'examples', label: string, note: string) => field(label, textarea(`tag-${key}`, tag[key].join('\n'), value => { tag[key] = value.split('\n').map(line => line.trim()).filter(Boolean); }), note);
    const advanced = h('details', 'editor-advanced', h('summary', '', 'More options'),
      lineField('aliases', 'Other names', 'Alternative names and abbreviations, one per line.'),
      lineField('inclusions', 'Use when', 'Optional guidance about papers that belong here.'),
      lineField('exclusions', 'Do not use when', 'Optional guidance about papers that do not belong here.'),
      lineField('examples', 'Examples', 'Helpful paper titles or passages, one per line.'),
      relationshipPicker(tag, 'broaderIds', 'Type of', 'Choose a broader topic only when this tag is a type of it.'),
      relationshipPicker(tag, 'relatedIds', 'Related topics', 'Connect topics that overlap without meaning the same thing.'),
      tag.custom ? field('Paper matching', select('tag-matching-mode', tag.matchingMode || 'suggest', [['manual', 'Only when I choose'], ['suggest', 'Suggest paper matches'], ['auto', 'Match automatically']], value => { tag.matchingMode = value; }), 'Automatic matching also needs your completed pilot review and the setting for new papers.') : null,
      tag.custom && !tag.id ? button('Use RCL example', () => { tag.name = 'RCL';tag.fullName = 'Catalyst-layer resistance';tag.description = 'Catalyst-layer resistance in water electrolysis or fuel cells.';render(); }, 'quiet small') : null);
    advanced.open = editorAdvancedOpen;
    advanced.addEventListener('toggle', () => { if (advanced.isConnected) editorAdvancedOpen = advanced.open; });
    const form = h('form', 'editor-scroll',
      field('Tag name', input('tag-name', tag.name, value => { tag.name = value; }, 'A short name you recognize')),
      field('Full name', input('tag-full-name', tag.fullName || '', value => { tag.fullName = value; }, 'Expand an abbreviation when helpful')),
      field('Meaning', textarea('tag-description', tag.description, value => { tag.description = value; }, 'What should papers with this tag discuss?')),
      field('Group', select('tag-facet', tag.facet, facets.map(value => [value, facetNames[value]]), value => { tag.facet = value; })), advanced);
    form.id = 'tag-editor-form';
    if (tag.id && tag.custom && !preparationId) {
      const saved = tagById(tag.id);
      const unsaved = !saved || definitionKey(tag) !== definitionKey(saved);
      form.append(h('div', 'section-gap', field('Find matches in', select<Scope>('detail-preview-scope', detailScope, [['selected', 'Selected papers in Zotero'], ['collections', 'Selected collections'], ['library', 'Whole personal library'], ['pilot', 'Pilot · 50 papers']], value => { detailScope = value; })), h('div', 'actions', button('Preview matches', () => { requireSavedDetail(tag);return run('preview-detail', { tagId: tag.id, scope: detailScope }, 'Preparing paper suggestions.'); }, '', !canAnalyze() || unsaved || tag.matchingMode === 'manual'), button('Assign to selected papers', () => { requireSavedDetail(tag);return run('assign-detail', { tagId: tag.id, scope: 'selected' }, 'Tag assigned to the selected papers.'); }, '', unsaved)), h('p', 'card-description', 'Save your changes before matching or assigning papers.')));
    }
    const save = async () => {
      if (busy) return;
      if (!tag.name.trim() || !tag.description.trim()) throw new Error('Add a tag name and meaning before saving.');
      const submitted = copyTag(tag);
      if (preparationId) {
        if (currentState().tagPreparation?.id !== preparationId) throw new Error('This tag list has changed. Open the tag again before saving.');
        await run('edit-prepared-tag', { id: preparationId, tag: submitted }, 'Tag saved.');
      } else await run(tag.custom && !tag.id ? 'create-detail' : 'save-tag', { tag: submitted }, 'Tag saved.');
      editorDrafts.delete(`${preparationId}:${tag.id || 'new'}`);
      if (editorTag === tag) { editorTag = null;editorPreparationId = '';render(); }
    };
    form.addEventListener('submit', event => { event.preventDefault();void save().catch(showError); });
    const cancel = () => { editorDrafts.delete(`${preparationId}:${tag.id || 'new'}`);editorTag = null;editorPreparationId = '';render(); };
    return h('section', 'card editor tag-editor', h('div', 'card-header', h('h2', '', tag.id ? `Edit ${tag.name}` : 'Add a tag')), form, h('div', 'card-footer editor-footer', button('Save', save, 'primary'), button('Cancel', cancel, 'quiet')));
  }
  function workingTags() { return currentState().tagPreparation?.tags || currentState().tags.filter(tag => tag.status === 'approved' || tag.custom); }
  function hasUnsavedPreparedChanges() {
    const preparation = state?.tagPreparation;
    if (!preparation) return false;
    const drafts = new Map(editorDrafts);
    if (editorTag) drafts.set(`${editorPreparationId}:${editorTag.id || 'new'}`, editorTag);
    for (const [key, draft] of drafts) {
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
    if (note) note.textContent = dirty ? 'Save or cancel your edits before applying this tag list.' : 'You will review paper changes before they are applied.';
  }
  function renderVocabulary() {
    const s = currentState();
    const preparation = s.tagPreparation;
    const query = vocabQuery.trim().toLocaleLowerCase();
    const tags = workingTags().filter(tag => !query || conceptText(tag).includes(query));
    const questions = preparation?.questions || [];
    vocabularyPage = Math.min(vocabularyPage, Math.max(0, Math.ceil(tags.length / 20) - 1));
    tagQuestionPage = Math.min(tagQuestionPage, Math.max(0, Math.ceil(questions.length / 10) - 1));
    const status = preparation?.status === 'checking' ? 'Checking your tags…' : preparation?.status === 'questions' ? `${questions.length} ${questions.length === 1 ? 'question needs' : 'questions need'} your choice` : preparation?.status === 'failed' ? 'Your tag list needs another try' : preparation ? 'Your tag list is ready' : 'Your tags';
    const header = h('div', 'tag-workspace-header', h('div', '', h('h2', '', status), h('p', 'card-description', preparation ? `${preparation.tags.length} tags · ${preparation.scopeCount} papers · preferred count ${preparation.targetCount}` : `${tags.length} tags ready to use`)), h('div', 'inline', button('Add tag', () => newTag(true)), preparation ? button('Apply tag list', async () => { await run('apply-tag-list', { id: preparation.id }, 'Tag list saved. Preparing paper suggestions.'); nav('review'); }, 'primary', !preparation.canApply || preparation.status === 'checking') : button('Prepare tags', () => run('prepare-tags', { scope }, 'Preparing your tag list.'), 'primary', !canAnalyze() || s.queue.status === 'running')));
    if (preparation) header.querySelector<HTMLButtonElement>('.primary')!.id = 'apply-tag-list';
    const tabs = h('div', 'tag-workspace-tabs');
    tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', 'Tags and questions');
    for (const [value, label] of [['tags', 'Tags'], ['questions', `Questions (${questions.length})`]] as const) {
      const tab = button(label, () => { tagView = value;render(); }, tagView === value ? 'selected' : 'quiet');
      tab.setAttribute('role', 'tab');tab.setAttribute('aria-selected', String(tagView === value));tabs.append(tab);
    }
    const content = h('div', 'tag-workspace-list card');
    content.id = 'tag-list-scroll';content.setAttribute('data-view-key', `${preparation?.id || s.vocabularyVersion}:${tagView}:${tagView === 'tags' ? vocabularyPage : tagQuestionPage}`);
    if (preparation?.status === 'failed') content.append(h('div', 'notice warning', h('p', '', humanMessage(preparation.error || 'We could not finish preparing tags. Your completed paper analysis is saved.')), button('Try again', () => run('retry-tag-preparation', { id: preparation.id }, 'Checking your tags again.'), 'small')));
    if (preparation?.status === 'checking') content.append(h('div', 'notice info', h('p', '', 'Your papers have been read. We are checking the tag names and meanings.'), s.queue.status !== 'running' ? button('Resume checks', () => run('retry-tag-preparation', { id: preparation.id }, 'Checking your tags.'), 'small') : null));
    if (tagView === 'questions') {
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
      content.append(h('div', 'tag-list-search', input('vocabulary-search', vocabQuery, value => { vocabQuery = value;vocabularyPage = 0;render(); }, 'Find a tag or another name…', 'search')));
      if (!tags.length) content.append(empty('No tags here yet', 'Prepare tags from a few papers, or add a topic of your own.'));
      for (const tag of tags.slice(vocabularyPage * 20, (vocabularyPage + 1) * 20)) {
        const edit = button('Edit', () => editTag(tag, preparation?.id || ''), 'small quiet');edit.setAttribute('aria-label', `Edit tag ${tag.name}`);
        const remove = button('Remove', async () => {
          if (busy) return;
          if (!preparation) { await run('delete-tag', { id: tag.id }, 'Tag removed from your list.'); }
          else await run('remove-prepared-tag', { id: preparation.id, tagId: tag.id }, 'Tag removed from this list.');
          editorDrafts.delete(`${preparation?.id || ''}:${tag.id}`);
          if (editorTag?.id === tag.id && editorPreparationId === (preparation?.id || '')) { editorTag = null;editorPreparationId = '';render(); }
        }, 'small quiet');remove.setAttribute('aria-label', `Remove tag ${tag.name}`);
        content.append(h('article', 'tag-row', h('div', 'inline between', h('div', 'tag-heading', h('strong', '', tag.name), tag.custom ? badge('Your topic', 'custom') : null), h('div', 'inline', edit, remove)), tag.fullName && tag.fullName !== tag.name ? h('p', 'concept-full-name', tag.fullName) : null, h('p', '', tag.description), h('div', 'tag-meta', h('span', '', `${tag.coverage ?? tag.currentlyTaggedCount ?? 0} papers`), tag.aliases.length ? h('span', '', `Other names: ${tag.aliases.join(', ')}`) : null)));
      }
      if (tags.length > 20) content.append(pagination(tags.length, vocabularyPage, next => { vocabularyPage = next; }, 20, 'tags'));
    }
    const note = h('p', 'card-description', preparation ? 'You will review paper changes before they are applied.' : 'Project collections and existing paper tags stay under your control.');
    note.id = 'tag-apply-note';
    return h('div', `tag-workspace ${editorTag ? 'has-editor' : ''}`, header, tabs, note, h('div', 'tag-workspace-columns', content, tagEditor()));
  }

  function renderExistingTags() {
    const existing = currentState().existingTags;
    const sourceRows = existing?.rows || [];
    const rows = sourceRows.filter(row => (existingTagFilter === 'all' || row.status === existingTagFilter)
      && (!existingTagQuery || `${row.name} ${row.meaning || ''} ${row.targetNames.join(' ')}`.toLocaleLowerCase().includes(existingTagQuery.toLocaleLowerCase()))
      && (existingTagFacet === 'all' || row.facet === existingTagFacet || row.targetNames.some(name => currentState().tags.some(tag => tag.name === name && tag.facet === existingTagFacet))));
    const selected = sourceRows.filter(row => selectedExistingTags.has(row.id));
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
    const toolbar = h('div', 'toolbar', input('existing-tag-search', existingTagQuery, value => { existingTagQuery = value;existingTagPage = 0;render(); }, 'Search existing names and meanings…', 'search'), select('existing-tag-status', existingTagFilter, [['all', 'All existing tags'], ['match', 'Matched to Smart Tags'], ['choice', 'Needs your choice'], ['unmatched', 'Other tags']], value => { existingTagFilter = value;existingTagPage = 0;render(); }, 'Existing tag group'), select('existing-tag-category', existingTagFacet, [['all', 'All categories'], ...facets.map(facet => [facet, facetNames[facet]] as [string,string])], value => { existingTagFacet = value;existingTagPage = 0;render(); }, 'Existing tag category'));
    const controls = h('div', 'inline', button('Read library tags', () => run('refresh-existing-tags', {}, 'Existing tags refreshed.'), '', running), button('Analyze selected names', () => run('analyze-existing-tags', { groupIds: selected.map(row => row.id) }, 'Checking selected tag meanings.'), '', !selected.length || running || !canAnalyze() || !existing?.applied), button('Create DIY tags…', () => { modalPage = 0;modal = { kind: 'create-diy', ids: selected.map(row => row.id) };render(); }, '', !selected.length || running));
    const bulk = h('div', 'notice inline between', h('span', '', `${selected.length} selected · ${rows.length} shown`), h('div', 'inline', button('Select this page', () => { for (const row of visible) selectedExistingTags.add(row.id);render(); }, 'quiet'), button('Clear selection', () => { selectedExistingTags.clear();render(); }, 'quiet')));
    const actions = h('div', 'toolbar', select('existing-tag-action', existingTagAction, [['replace', 'Use matched Smart Tags name'], ['remove', 'Remove from papers'], ['keep', 'Keep as it is']], value => { existingTagAction = value;render(); }, 'Action for selected existing tags'), button('Review paper changes', () => run('preview-existing-tag-changes', { selections: selected.map(selection) }), 'primary', !selected.length || running || (existingTagAction === 'replace' && selected.some(row => !canReplace(row))) || (existingTagAction === 'remove' && selected.some(row => row.assignments && !removalPapers(row)?.length))));
    const list = h('section', 'card existing-tags-list');
    if (!existing) list.append(empty('Start with the tags already in your library', 'Read their names and counts first. Analysis and any paper changes remain separate steps.', button('Read library tags', () => run('refresh-existing-tags', {}), 'primary')));
    else if (!rows.length) list.append(empty('No matching tags', 'Try another search or group.'));
    for (const row of visible) {
      const status = row.status === 'match' ? 'Matched' : row.status === 'choice' ? 'Needs your choice' : 'Other tag';
      const targetChoices = currentState().tags.filter(tag => row.targetNames.includes(tag.name)).map(tag => [tag.id, tag.name] as [string,string]);
      const article = h('article', 'existing-tag-row', checkbox(`existing-${row.id}`, selectedExistingTags.has(row.id), row.name, checked => { checked ? selectedExistingTags.add(row.id) : selectedExistingTags.delete(row.id);render(); }), h('div', 'inline', badge(status), h('span', 'muted', `${row.affectedCount} papers · ${row.manualCount} manual`)), row.meaning ? h('p', '', `${row.meaningInferred ? 'Inferred meaning' : 'Meaning'}: ${row.meaning}`) : null, row.targetNames.length ? h('p', '', `Smart Tags: ${row.targetNames.join(', ')}`) : null, row.status === 'choice' && !row.assignments && targetChoices.length ? select(`existing-target-${row.id}`, existingTagTargets.get(row.id) || '', [['', 'Choose a matching tag'], ...targetChoices], value => { existingTagTargets.set(row.id, value);render(); }, `Matching tag for ${row.name}`) : null, h('p', 'card-description', row.diyQuestion || row.reason));
      if (row.assignments?.length && (row.status !== 'match' || row.assignments.some(assignment => assignment.conflict))) {
        article.append(button(`${expandedExistingGroups.has(row.id) ? 'Hide' : 'Review'} paper matches`, () => { expandedExistingGroups.has(row.id) ? expandedExistingGroups.delete(row.id) : expandedExistingGroups.add(row.id);render(); }, 'small'));
        const paperPage = Math.min(existingPaperPages.get(row.id) || 0, Math.max(0, Math.ceil(row.assignments.length / 30) - 1));
        if (expandedExistingGroups.has(row.id)) for (const assignment of row.assignments.slice(paperPage * 30, (paperPage + 1) * 30)) {
          const key = `${row.id}:${assignment.paperId}`;
          const choices = currentState().tags.filter(tag => tag.status === 'approved').map(tag => [tag.id, tag.name] as [string,string]);
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
    return h('div', 'stack', toolbar, controls, existing?.message ? h('p', 'card-description', humanMessage(existing.message)) : null, bulk, actions, list, pagination(rows.length, existingTagPage, next => { existingTagPage = next; }, 30, 'existing tags'), review);
  }

  function paperAttention() {
    const attention = currentState().paperAttention;
    if (!attention) return empty('No papers need attention', 'Papers with missing information or failed analysis will appear here.');
    const all = [...new Map(attention.papers.map(paper => [paper.id, paper])).values()];
    const papers = all.filter(paper => (attentionFilter === 'all' || (attentionFilter === 'attention' ? paper.status === 'needsInformation' || paper.status === 'failed' : paper.status === attentionFilter))
      && (!attentionQuery || paper.title.toLocaleLowerCase().includes(attentionQuery.toLocaleLowerCase())));
    attentionPage = Math.min(attentionPage, Math.max(0, Math.ceil(papers.length / 25) - 1));
    const visible = papers.slice(attentionPage * 25, (attentionPage + 1) * 25);
    const selected = all.filter(paper => selectedAttentionPapers.has(paper.id));
    const list = h('div', 'paper-attention-list');
    list.append(h('div', 'toolbar', input('attention-search', attentionQuery, value => { attentionQuery = value;attentionPage = 0;render(); }, 'Find a paper…', 'search'), select('attention-status', attentionFilter, [['attention', 'Needs attention'], ['all', 'All checked papers'], ['usable', 'Ready to use'], ['needsInformation', 'Needs information'], ['failed', 'Analysis failed'], ['skipped', 'Skipped']], value => { attentionFilter = value;attentionPage = 0;render(); }, 'Paper information status')));
    list.append(h('div', 'actions', button('Select this page', () => { for (const paper of visible) selectedAttentionPapers.add(paper.id);render(); }), button('Clear selection', () => { selectedAttentionPapers.clear();render(); }, 'quiet'), button('Retry selected', () => run('retry-papers', { ids: selected.filter(paper => paper.canRetry).map(paper => paper.id) }, 'Selected papers queued.'), '', !selected.some(paper => paper.canRetry)), button('Skip selected for this build', () => run('skip-paper-analysis', { ids: selected.filter(paper => paper.canSkip).map(paper => paper.id) }, 'Selected papers skipped for this build.'), 'quiet', !selected.some(paper => paper.canSkip))));
    if (!papers.length) list.append(empty('No papers in this view', 'Completed papers remain available in your library.'));
    const labels = { usable: 'Ready to use', needsInformation: 'Needs information', failed: 'Analysis failed', skipped: 'Skipped for this build' };
    for (const paper of visible) list.append(h('article', 'paper-attention-row', checkbox(`attention-${paper.id}`, selectedAttentionPapers.has(paper.id), paper.title, checked => { checked ? selectedAttentionPapers.add(paper.id) : selectedAttentionPapers.delete(paper.id);render(); }), h('div', 'inline', badge(labels[paper.status]), paper.queued ? badge('Queued') : null), h('p', 'card-description', humanMessage(paper.message)), h('div', 'actions', button('Open in Zotero', () => openPaper(paper.id), 'small'), paper.canLookupMetadata ? button('Find metadata', () => { metadataIdentifier = '';return run('preview-metadata', { id: paper.id }); }, 'small') : null, paper.canRecheck ? button('Recheck PDF', () => run('recheck-paper-inputs', { id: paper.id }, 'Local paper information checked.'), 'small') : null, paper.canRetry ? button('Retry analysis', () => run('retry-papers', { ids: [paper.id] }, 'Paper queued.'), 'small') : null, paper.canSkip ? button('Skip for this build', () => run('skip-paper-analysis', { ids: [paper.id] }, 'Paper skipped for this build.'), 'small quiet') : null)));
    list.append(pagination(papers.length, attentionPage, next => { attentionPage = next; }, 25, 'papers'));
    return list;
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
    const body = h('div', '', h('div', 'suggestion-header', h('div', '', paperButton(suggestion.paperId), h('div', 'inline section-gap', h('strong', '', tag?.name || suggestion.tagId), suggestion.operation === 'remove' ? badge('remove managed tag', 'removal') : badge('add tag'), badge(suggestion.confidence, suggestion.confidence), tag?.custom ? badge('custom', 'custom') : null, suggestion.applied ? badge('applied', 'approved') : badge(suggestion.status, suggestion.status === 'accepted' ? 'approved' : suggestion.status === 'pending' ? 'draft' : ''))), suggestion.locked ? badge('locked') : null), h('p', 'suggestion-reason', suggestion.reason));
    for (const evidence of suggestion.evidence) body.append(h('blockquote', 'evidence', h('cite', '', evidence.source), evidence.text));
    if (!suggestion.evidence.length) body.append(h('p', 'card-description', 'No supporting passage is available. Inspect this paper before accepting.'));
    body.append(h('div', 'actions',
      !suggestion.applied && suggestion.status !== 'accepted' && suggestion.status !== 'rejected' ? button('Accept', () => run('accept-suggestion', { id: suggestion.id }, 'Suggestion accepted. Apply reviewed suggestions to write native tags.'), 'small primary') : null,
      !suggestion.applied && suggestion.status !== 'rejected' ? button('Reject', () => run('reject-suggestion', { id: suggestion.id }, 'Rejected. This choice will be remembered.'), 'small') : null,
      suggestion.status === 'rejected' ? button('Clear rejection', () => run('clear-rejection', { paperId: suggestion.paperId, tagId: suggestion.tagId }, 'Rejection cleared; the paper can be evaluated again.'), 'small') : null,
      button(suggestion.locked ? 'Unlock assignment' : 'Lock assignment', () => run(suggestion.locked ? 'unlock-assignment' : 'lock-assignment', { paperId: suggestion.paperId, tagId: suggestion.tagId }, suggestion.locked ? 'Assignment unlocked.' : 'Assignment locked.'), 'small quiet')));
    return h('article', 'paper-card suggestion', check, body);
  }
  function renderReview() {
    const s = currentState();
    const suggestions = relevantSuggestions();
    reviewPage = Math.min(reviewPage, Math.max(0, Math.ceil(suggestions.length / PAGE_SIZE) - 1));
    const visible = suggestions.slice(reviewPage * PAGE_SIZE, (reviewPage + 1) * PAGE_SIZE);
    const applicableSelected = [...selectedSuggestions].filter(id => { const item = suggestionMap.get(id); return !!item && !item.applied && item.status !== 'rejected'; });
    const accepted = s.suggestions.filter(item => item.status === 'accepted' && !item.applied).map(item => item.id);
    const toolbar = h('div', 'toolbar', select('review-filter', reviewFilter, [['pending', 'Pending review'], ['accepted', 'Accepted, not applied'], ['rejected', 'Rejected'], ['applied', 'Applied'], ['all', 'All suggestions']], value => { reviewFilter = value; reviewPage = 0; render(); }, 'Suggestion status'),
      button('Select this page', () => { for (const item of visible) if (!item.applied && item.status !== 'rejected') selectedSuggestions.add(item.id); render(); }),
      button('Clear selection', () => { selectedSuggestions.clear(); render(); }, 'quiet'),
      h('span', 'search-results', `${suggestions.length} suggestions`));
    const actions = h('div', 'notice inline between', h('span', '', h('span', 'batch-count', `${applicableSelected.length} selected`), ` · ${accepted.length} accepted and ready to apply`), h('div', 'inline', button('Review selected changes', () => { modalPage = 0; modal = { kind: 'apply', ids: applicableSelected }; render(); }, '', !applicableSelected.length), button('Apply accepted…', () => { modalPage = 0; modal = { kind: 'apply', ids: accepted }; render(); }, 'primary', !accepted.length)));
    const list = h('section', 'card');
    if (!suggestions.length) list.append(empty(s.queue.status === 'running' ? 'Preparing paper suggestions…' : 'No paper suggestions here yet', s.queue.status === 'running' ? 'Your tag list is ready. Paper matches will appear here as they finish.' : 'Apply your tag list or choose another paper view.', button('Go to Overview', () => nav('overview'), 'quiet')));
    for (const suggestion of visible) list.append(suggestionCard(suggestion));
    return h('div', 'stack', toolbar, actions, list, pagination(suggestions.length, reviewPage, next => { reviewPage = next; }));
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
    const coreTags = tags.filter(tag => !tag.custom);
    const details = tags.filter(tag => tag.custom);
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
    const detailRow = (tag: DisplayTag, contextId?: string, location = 'global') => h('div', 'concept-tree-row detail-node', checkbox(`explore-detail-${encodeURIComponent(tag.id)}-${encodeURIComponent(contextId || 'global')}-${encodeURIComponent(location)}`, isConceptSelected(tag.id, contextId), conceptLabel(tag), () => toggleConcept(tag.id, contextId)), badge('Your topic', 'custom'), h('span', 'concept-count', String(count(tag.id, contextId))));
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
        nested.append(h('p', 'context-caption', `User details · matched together with ${tag.name}`));
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
    const visibleDetails = details.filter(visible);
    if (visibleDetails.length) {
      const allDetails = h('details', 'concept-tree-branch section-gap', h('summary', '', `Your additional topics · ${visibleDetails.length}`));
      allDetails.open = !!conceptQueryKey || expandedConcepts.has('__user-details');
      allDetails.addEventListener('toggle', () => { if (allDetails.isConnected) allDetails.open ? expandedConcepts.add('__user-details') : expandedConcepts.delete('__user-details'); });
      const detailList = h('div', 'concept-tree-children');
      for (const tag of visibleDetails.slice(0, 100)) detailList.append(detailRow(tag));
      if (visibleDetails.length > 100) detailList.append(h('p', 'muted', 'Refine the tag search to see more topics.'));
      allDetails.append(detailList); filters.append(allDetails);
    }
    if (!coreTags.length && !details.length) filters.append(empty('No tags ready yet', 'Prepare a tag list, or add a topic of your own.'));
    const selections = h('div', 'selected-concepts');
    for (const selection of conceptFilter.selections) selections.append(h('div', 'selected-concept', h('span', '', `${tagName(selection.conceptId)}${selection.contextId ? ` in ${tagName(selection.contextId)}` : ''}`), button('Remove', () => toggleConcept(selection.conceptId, selection.contextId), 'quiet small')));
    const filterCard = card('Browse tags', 'A broader tag includes its narrower topics. An additional topic chosen inside a tag requires both. Match all your selections or any selection.', h('div', '', filters, selections), button('Clear filters', () => { conceptFilter = { ...conceptFilter, selections: [] }; libraryPage = 0; render(); }, 'quiet small', !conceptFilter.selections.length));
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
    const progress = h('div', '', h('div', 'inline between', badge(queuePhaseLabel(), q.status === 'running' ? 'approved' : q.status === 'paused' ? 'draft' : ''), h('span', 'muted', `${q.completed} papers read · ${q.failed} failed · ${q.needsInformation ?? 0} need information · ${q.skipped ?? 0} skipped`)), q.phaseProgress ? h('p', '', `${q.phaseProgress.label}: ${q.phaseProgress.completed} of ${q.phaseProgress.total}`) : null, q.message ? h('p', 'card-description', humanMessage(q.message)) : null,
      h('div', 'actions', button('Resume', () => run('resume'), 'primary', q.status !== 'paused'), button('Pause', () => run('pause'), '', q.status !== 'running'), button('Cancel remaining', () => run('cancel', undefined, 'Remaining jobs canceled. Completed analysis is kept.'), 'danger', q.status === 'idle')),
      h('p', 'card-description', runProvider !== 'chatgpt' ? `Estimated cost so far: ${number(q.spentUSD)} · estimated total: ${number(q.estimatedUSD)}. Requests stay within your chosen spending limit.` : 'This work uses your ChatGPT allowance. It pauses when the allowance is reached.'));
    if (s.tagPreparation) progress.append(h('div', 'section-gap', h('h3', '', s.tagPreparation.status === 'ready' ? 'Your tag list is ready' : s.tagPreparation.status === 'questions' ? 'A few tag choices are waiting' : 'Your tag list is saved'), button('Open tags', () => nav('vocabulary'), 'small')));
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
    const active = (s.warnings || []).filter(warning => warning.status === 'active' && !warning.legacy && warning.code !== 'evidence-gap');
    const notices = active.length ? card('Needs attention', '', h('div', '', ...active.map(warning => warningEntry(warning, true)))) : null;
    return h('div', 'stack', card('Paper analysis', 'Completed work is kept if you pause or close Zotero.', progress), notices, card('Papers that need attention', s.paperAttention ? `${s.paperAttention.queued} papers queued. Each paper appears once.` : '', paperAttention()), metadataReview(), warningHistory(), h('section', 'card', h('div', 'card-header', h('h2', '', 'Applied changes')), history));
  }

  function renderSettings() {
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
    const numberField = (key: 'budgetUSD' | 'inputPricePerMillion' | 'outputPricePerMillion' | 'maxOutputTokens' | 'coreConceptLimit', label: string, note: string, step: string) => {
      const control = input(`settings-${key}`, String(draft[key] ?? 60), value => { const n = Number(value); if (Number.isFinite(n)) mark(key, n); }, '', 'number');
      control.min = key === 'maxOutputTokens' || key === 'coreConceptLimit' ? '1' : '0'; control.step = step;
      if (key === 'coreConceptLimit') control.max = '500';
      return field(label, control, note);
    };
    const budgets = h('div', '',
      h('div', 'notice', 'Budget controls apply to the selected API provider. Set its published model rates before analysis; cost estimates use those rates. Model discovery is available while rates are unset.'),
      h('div', 'section-gap', numberField('budgetUSD', 'Per-run API budget · USD', 'The queue pauses before dispatching requests that would exceed its remaining estimate.', '0.01')),
      h('div', 'field-grid', numberField('inputPricePerMillion', 'Input · USD / million tokens', 'Use the standard input rate.', '0.001'), numberField('outputPricePerMillion', 'Output · USD / million tokens', 'Use the standard output rate.', '0.001')),
      h('div', 'section-gap', numberField('maxOutputTokens', 'API output-token limit', 'This request limit is used for API-key requests.', '1')));
    const automatic = h('div', '', checkbox('settings-auto-assign', draft.autoAssign, 'Automatically assign supported tags when a new paper is added', value => mark('autoAssign', value), !s.pilotReviewed),
      h('p', 'card-description', s.pilotReviewed ? 'New papers use your saved tag meanings. Unclear matches stay in Paper suggestions for your review.' : 'Complete and mark your pilot review on Overview to enable automatic assignment.'),
      h('p', 'card-description', 'Manual removals, rejected matches, and locked assignments are remembered. Existing collections and workflow labels remain under your control.'));
    const vocabulary = h('div', '', numberField('coreConceptLimit', 'Preferred number of tags', '60 is a starting point. Distinct topics can stay separate when more tags are useful.', '1'));
    const transfers = h('details', 'section-gap', h('summary', '', 'Import, export, and previous tag lists'), h('div', 'actions', button('Import tags…', () => run('import-vocabulary', undefined, 'Tags imported.')), button('Export tags…', () => run('export-vocabulary'))), s.tagPreparation ? h('div', 'section-gap', button('Export analysis with paper text…', () => run('export-tag-analysis', { id: s.tagPreparation!.id })), h('p', 'card-description', 'This private export includes paper text and quotations.')) : null);
    for (const archive of s.taxonomyArchives || []) transfers.append(h('div', 'inline section-gap', h('span', '', archive.date), button('Open previous tag list', () => run('restore-taxonomy', { id: archive.id }, 'Previous tag list opened. Check it before applying.'), 'small')));
    transfers.append(h('div', 'actions', button('Manage existing tags', () => nav('existing-tags'))));
    const navigationLabels = { starting: 'Starting', ready: 'Available', hidden: 'Sidebar hidden', unavailable: 'Unavailable in this window' };
    const navigation = h('div', '', h('p', '', s.pluginVersion ? `Installed version ${s.pluginVersion}` : 'Version information is available when opened in Zotero.'), h('p', '', `Library navigation: ${s.navigation ? navigationLabels[s.navigation.status] : 'Open Zotero to check'}`), s.navigation?.message ? h('p', 'card-description', humanMessage(s.navigation.message)) : null, h('div', 'actions', button('Show tag navigation', () => run('show-tag-navigation')), button('Restore navigation', () => run('show-tag-navigation', { restore: true })), button('Check for updates', () => run('check-plugin-updates'))), h('p', 'card-description', 'Updates are managed by Zotero’s Plugins window. Your library and saved settings stay in place.'));
    return h('div', 'stack', card('Smart Tags in Zotero', 'Use Smart Tags or Collections in Zotero’s left library pane.', navigation), h('div', 'grid', card('AI connection', 'Select the account and model used for analysis.', connection), card(draft.provider === 'chatgpt' ? 'API budget' : `${providerName} API budget`, 'Model rates are configurable rather than assumed.', budgets)), card('Tags', 'Choose a starting point for tag preparation.', vocabulary), card('Automatic assignment', 'Use your tag list for new papers.', automatic), h('div', 'inline', button('Save settings', () => saveSettings(), 'primary'), settingsDirty ? h('span', 'muted', 'Unsaved changes') : h('span', 'muted', 'Settings saved')), transfers);
  }
  async function saveSettings() {
    if (!settingsDraft) return;
    if (!Number.isInteger(settingsDraft.coreConceptLimit ?? 60) || (settingsDraft.coreConceptLimit ?? 60) < 1 || (settingsDraft.coreConceptLimit ?? 60) > 500) throw new Error('Set the preferred number of tags to a whole number from 1 to 500.');
    if (settingsDraft.provider !== 'chatgpt' && (settingsDraft.budgetUSD <= 0 || settingsDraft.inputPricePerMillion < 0 || settingsDraft.outputPricePerMillion < 0 || settingsDraft.maxOutputTokens < 1)) throw new Error('Set a positive API budget and output-token limit. Model rates must be zero or greater.');
    const result = await run('save-settings', { settings: { ...settingsDraft } }, 'Settings saved.');
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
    if (active.kind === 'apply') {
      const ids = new Set(active.ids);
      const suggestions = currentState().suggestions.filter(item => ids.has(item.id));
      modalPage = Math.min(modalPage, Math.max(0, Math.ceil(suggestions.length / PAGE_SIZE) - 1));
      title = 'Review native tag changes';
      applyLabel = `Apply ${suggestions.length} tag changes`;
      body.append(h('p', '', 'Review the additions and removals below. Removals apply only to obsolete tags owned by Smart Tags. Existing manual tags are preserved. Stale proposals are checked again before writing.'));
      const table = h('table', 'section-gap', h('thead', '', h('tr', '', h('th', '', 'Paper'), h('th', '', 'Change'), h('th', '', 'Tag'), h('th', '', 'Evidence'))));
      const tbody = h('tbody');
      for (const item of suggestions.slice(modalPage * PAGE_SIZE, (modalPage + 1) * PAGE_SIZE)) tbody.append(h('tr', '', h('td', '', paperTitle(item.paperId)), h('td', '', badge(item.operation === 'remove' ? 'Remove' : 'Add', item.operation === 'remove' ? 'removal' : 'approved')), h('td', '', h('strong', '', tagName(item.tagId))), h('td', '', item.evidence[0]?.text || 'Review manually')));
      table.append(tbody); body.append(h('div', 'table-wrap', table), pagination(suggestions.length, modalPage, next => { modalPage = next; }));
      apply = async () => { await run('apply-suggestions', { ids: active.ids }, 'Reviewed tag assignments applied.'); selectedSuggestions.clear(); modal = null; render(); };
    } else if (active.kind === 'create-diy') {
      title = 'Create DIY tags';
      applyLabel = 'Analyze and create DIY tags';
      body.append(h('p', '', 'The selected names and supporting paper information will be analyzed through your chosen connection. This uses your ChatGPT allowance or API budget. Clear meanings become available automatically; unresolved choices appear for review.'));
      modalPage = Math.min(modalPage, Math.max(0, Math.ceil(active.ids.length / 25) - 1));
      for (const id of active.ids.slice(modalPage * 25, (modalPage + 1) * 25)) {
        const row = currentState().existingTags?.rows.find(row => row.id === id);
        if (!row) continue;
        const draft = existingDIYDrafts.get(id) || { name: row.name, description: '' };existingDIYDrafts.set(id, draft);
        body.append(h('div', 'section-gap', field('Tag name', input(`diy-name-${id}`, draft.name, value => { draft.name = value; })), field('Meaning (optional)', textarea(`diy-meaning-${id}`, draft.description, value => { draft.description = value; }, row.diyQuestion || 'Add a meaning if this name could refer to several topics.'))));
      }
      body.append(pagination(active.ids.length, modalPage, next => { modalPage = next; }, 25, 'DIY names'));
      apply = async () => { await run('create-diy-from-existing', { groupIds: active.ids, choices: active.ids.map(groupId => ({ groupId, ...(existingDIYDrafts.get(groupId) || { name: currentState().existingTags?.rows.find(row => row.id === groupId)?.name, description: '' }) })) }, 'DIY tag meanings are being checked.');modal = null;render(); };
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
    const navigation = h('nav', 'nav');
    navigation.setAttribute('aria-label', 'Library pages');
    const utilities = h('nav', 'nav');
    utilities.setAttribute('aria-label', 'Library tools');
    const navItems: [ManagerPage, number?][] = [['overview'], ['vocabulary', workingTags().length], ['existing-tags'], ['review', s.suggestions.filter(item => item.status === 'pending' && !item.applied).length], ['library'], ['activity'], ['settings']];
    for (const [target, count] of navItems) {
      const navButton = button('', () => nav(target), `nav-button ${page === target ? 'active' : ''}`);
      navButton.id = `nav-${target}`;
      navButton.disabled = false;
      navButton.append(h('span', 'nav-icon', icon(target)), h('span', '', pageNames[target]));
      if (count !== undefined && count > 0) navButton.append(h('span', 'nav-count', count.toLocaleString()));
      if (page === target) navButton.setAttribute('aria-current', 'page');
      (target === 'activity' || target === 'settings' ? utilities : navigation).append(navButton);
    }
    const connected = connectionReady(s);
    const connectionLabel = s.settings.provider === 'deepseek' ? 'DeepSeek API connected' : s.settings.provider === 'api' ? 'OpenAI API connected' : 'ChatGPT connected';
    sidebar.append(h('div', '', h('div', 'sidebar-section-label', 'Workspace'), navigation), h('div', 'sidebar-utilities', h('div', 'sidebar-section-label', 'Tools'), utilities), h('div', 'sidebar-footer', h('p', '', connected ? h('span', 'status-dot') : null, connected ? connectionLabel : 'Connection needed'), h('p', '', 'Stored on this computer')));
    const home = button('Personal library', () => nav('overview'), 'breadcrumb-home');
    home.id = 'workspace-home';
    home.disabled = false;
    const breadcrumbs = h('nav', 'breadcrumbs', home, h('span', 'breadcrumb-divider', '/'), h('span', 'breadcrumb-current', pageNames[page]));
    breadcrumbs.setAttribute('aria-label', 'Breadcrumb');
    const currentCrumb = breadcrumbs.lastElementChild;
    currentCrumb?.setAttribute('aria-current', 'page');
    const topbar = h('div', 'workspace-topbar', breadcrumbs, h('div', 'header-status', busy ? h('span', 'busy-indicator', 'Working…') : s.settings.autoAssign ? 'Automatic assignment on' : 'Review before applying'));
    const workspace = h('main', `workspace ${page === 'vocabulary' ? 'tag-workspace-page' : ''}`, h('header', 'page-header', h('div', '', h('div', 'workspace-page-icon', icon(page)), h('h1', '', pageTitles[page][0]), h('p', 'subtitle', pageTitles[page][1]))));
    const strip = queueStrip();
    if (strip) workspace.append(strip);
    if (signingIn) {
      const cancel = button('Cancel sign-in', async () => { await api.invoke('cancel-sign-in'); }, 'small');
      cancel.disabled = false;
      workspace.append(h('div', 'notice info inline between', h('span', '', 'Complete sign-in in your browser, or cancel this attempt.'), cancel));
    }
    const warnings = activeWarnings();
    if (warnings) workspace.append(warnings);
    const contents = page === 'overview' ? renderOverview() : page === 'vocabulary' ? renderVocabulary() : page === 'existing-tags' ? renderExistingTags() : page === 'review' ? renderReview() : page === 'library' ? renderLibrary() : page === 'activity' ? renderActivity() : renderSettings();
    workspace.append(contents);
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
    cleanupDropdowns(doc);
    try { renderContent(); }
    catch (error) {
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
