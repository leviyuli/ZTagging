import type { DisplayCleanup, DisplayPaper, DisplaySuggestion, DisplayTag, ManagerAPI, ManagerPage, ManagerSettings, ManagerSnapshot, Scope } from './ui-contract';
import { createDropdown, cleanupDropdowns } from './dropdown';

type Child = Node | string | null | undefined | false;
type ModalState = { kind: 'apply' | 'cleanup'; ids: string[] } | { kind: 'search' } | null;
const facets = ['system', 'component', 'phenomenon', 'method'] as const;
const facetNames: Record<string, string> = { system: 'Systems', component: 'Components & materials', phenomenon: 'Phenomena', method: 'Methods' };
const pageTitles: Record<ManagerPage, [string, string]> = {
  overview: ['Your library, clearly tagged', 'Build a vocabulary you trust, then let it organize new papers.'],
  vocabulary: ['Vocabulary', 'Review definitions and aliases before they guide automatic assignment.'],
  review: ['Review suggestions', 'Check the evidence, keep useful tags, and teach Smart Tags your preferences.'],
  library: ['Explore your library', 'Combine approved tags and discover papers with related content.'],
  activity: ['Queue & history', 'Follow analysis progress and review changes that have been applied.'],
  settings: ['Connections & settings', 'Choose an AI connection and control automatic assignment and API spending.'],
};
const pageNames: Record<ManagerPage, string> = { overview: 'Overview', vocabulary: 'Vocabulary', review: 'Review', library: 'Explore library', activity: 'Queue & history', settings: 'Settings' };
const iconPaths = {
  overview: ['M3 10.5 12 3l9 7.5', 'M5 9v12h14V9', 'M9 21v-7h6v7'],
  vocabulary: ['M20 13 13 20a2 2 0 0 1-3 0l-7-7V4h9l8 6a2 2 0 0 1 0 3Z', 'M7.5 8h.01'],
  review: ['M9 4H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-4', 'M9 2h6v5H9z', 'm8 13 3 3 5-5'],
  library: ['M12 5v16', 'M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1Z'],
  activity: ['M21 12a9 9 0 1 1-3-6.7', 'M21 3v6h-6', 'M12 7v5l3 2'],
  settings: ['M4 4v16M12 4v16M20 4v16', 'M1 8h6M9 16h6M17 10h6'],
} as const;

/** Mount a credential-free manager. All data access and writes go through the host. */
export function mountManager(win: Window, api: ManagerAPI): { refresh: () => Promise<void>; destroy: () => void } {
  const doc = win.document;
  const app = doc.getElementById('app');
  if (!app) throw new Error('Smart Tags manager is missing its app container.');
  let state: ManagerSnapshot | null = null;
  let page: ManagerPage = 'overview';
  let scope: Scope = 'pilot';
  let busy = false;
  let signingIn = false;
  let disposed = false;
  let refreshing = false;
  let refreshAgain = false;
  let toast = '';
  let toastError = false;
  let toastTimer = 0;
  let vocabQuery = '';
  let vocabStatus = 'all';
  let reviewFilter = 'pending';
  let reviewPage = 0;
  let libraryPage = 0;
  let modalPage = 0;
  let paperQuery = '';
  let selectedPaper = '';
  let editorTag: DisplayTag | null = null;
  let settingsDraft: ManagerSettings | null = null;
  let settingsDirty = false;
  const apiKeyDrafts: Record<'api' | 'deepseek', string> = { api: '', deepseek: '' };
  let searchName = '';
  let modal: ModalState = null;
  const selectedSuggestions = new Set<string>();
  const selectedCleanup = new Set<string>();
  const combination = new Set<string>();
  let paperMap = new Map<string, DisplayPaper>();
  let tagMap = new Map<string, DisplayTag>();
  let suggestionMap = new Map<string, DisplaySuggestion>();
  let paperTagNames = new Map<string, Set<string>>();
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
    element.addEventListener('input', () => onInput(element.value));
    return element;
  }
  function textarea(id: string, value: string, onInput: (value: string) => void, placeholder = '') {
    const element = h('textarea');
    element.id = id;
    element.value = value;
    element.placeholder = placeholder;
    element.addEventListener('input', () => onInput(element.value));
    return element;
  }
  function select<T extends string>(id: string, value: T, choices: [T, string][], onChange: (value: T) => void, accessibleName?: string) {
    const control = createDropdown(win, { id, value, choices, onChange: next => onChange(next as T), disabled: busy });
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
    toastTimer = win.setTimeout(() => { toast = ''; render(); }, error ? 12000 : 5500);
    render();
  }
  function showError(error: unknown) { notify(error instanceof Error ? error.message : String(error), true); }
  function diagnostic(message: string) {
    try { Zotero.debug?.(`[Smart Tags] Manager UI ${message}`, 3); } catch { /* Keep diagnostics optional in UI tests. */ }
  }
  async function run(action: string, payload?: any, message?: string) {
    if (busy) return;
    busy = true;
    render();
    try {
      const result = await api.invoke(action, payload);
      if (message) { toast = message; toastError = false; }
      await refresh();
      return result;
    } catch (error) {
      toast = error instanceof Error ? error.message : String(error);
      toastError = true;
      throw error;
    } finally {
      busy = false;
      render();
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
            new Promise<never>((_resolve, reject) => { snapshotTimer = win.setTimeout(() => reject(new Error('Local settings took too long to load. Close and reopen Smart Tags, then check Zotero’s Error Console if this continues.')), 15000); }),
          ]);
        } finally { if (snapshotTimer) win.clearTimeout(snapshotTimer); }
        if (disposed) return;
        diagnostic(`snapshot complete: ${state.papers.length} papers, ${state.tags.length} definitions`);
        paperMap = new Map(state.papers.map(paper => [paper.id, paper]));
        tagMap = new Map(state.tags.map(tag => [tag.id, tag]));
        suggestionMap = new Map(state.suggestions.map(suggestion => [suggestion.id, suggestion]));
        paperTagNames = new Map(state.papers.map(paper => [paper.id, new Set(paper.tags || [])]));
        for (const id of searchCache.keys()) if (!paperMap.has(id)) searchCache.delete(id);
        if (!settingsDirty) settingsDraft = { ...state.settings };
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
  function tagName(id: string) { return tagById(id)?.name || id; }
  function paperTitle(id: string) { return paperById(id)?.title || id; }
  function openPaper(id: string) { return run('show-paper', { id }); }
  function paperButton(id: string) { return button(paperTitle(id), () => openPaper(id), 'paper-title-button'); }
  function approvedTags() { return currentState().tags.filter(tag => tag.status === 'approved'); }
  function pagination(total: number, pageIndex: number, change: (next: number) => void) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return h('div', 'inline between', h('span', 'muted', total ? `${pageIndex * PAGE_SIZE + 1}–${Math.min(total, (pageIndex + 1) * PAGE_SIZE)} of ${total}` : '0 results'),
      h('div', 'inline', button('Previous', () => { change(pageIndex - 1); render(); }, 'small', pageIndex <= 0), h('span', 'muted', `${pageIndex + 1} / ${pages}`), button('Next', () => { change(pageIndex + 1); render(); }, 'small', pageIndex >= pages - 1)));
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
        button('Rebuild vocabulary', () => run('rebuild', { scope }, 'Vocabulary analysis queued. Review its draft before approving.'), 'primary', !canAnalyze() || s.queue.status === 'running'),
        button('Suggest paper tags', () => run('tag', { scope }, 'Tag analysis queued.'), '', !canAnalyze() || !approvedTags().length || s.queue.status === 'running')),
      !canAnalyze() ? h('p', 'card-description', 'Choose a connection and a model in Settings to start analysis.') : null,
      h('p', 'card-description', 'Analysis creates proposals. Approving a vocabulary and applying paper tags are separate steps.'));
  }
  function queueStrip() {
    const q = currentState().queue;
    if (q.status === 'idle' && !q.total) return null;
    const percent = q.total ? Math.min(100, (q.completed + q.failed) / q.total * 100) : 0;
    const fill = h('span');
    fill.style.width = `${percent}%`;
    return h('div', 'run-strip',
      h('div', 'inline between', h('div', '', h('strong', '', q.status === 'running' ? 'Analyzing papers' : q.status === 'paused' ? 'Analysis paused' : 'Analysis complete'), h('span', 'muted', ` · ${q.completed} of ${q.total} completed${q.failed ? ` · ${q.failed} need attention` : ''}`)),
        h('div', 'inline', q.status === 'running' ? button('Pause', () => run('pause'), 'small') : q.status === 'paused' ? button('Resume', () => run('resume'), 'small') : null, button('View activity', () => nav('activity'), 'quiet small'))),
      q.message ? h('p', 'card-description', q.message) : null,
      h('div', 'progress-bar', fill));
  }

  function renderOverview() {
    const s = currentState();
    const stats = h('div', 'stats');
    for (const [count, label] of [[approvedTags().length, 'approved tags'], [s.papers.length, 'papers analyzed'], [s.suggestions.filter(item => item.status === 'pending' && !item.applied).length, 'suggestions to review'], [s.tags.filter(tag => tag.custom).length, 'custom definitions']] as [number, string][]) {
      stats.append(h('div', 'stat', h('strong', '', count.toLocaleString()), h('span', '', label)));
    }
    const steps = h('ol', 'step-list');
    [
      ['Connect an AI model', 'Use your eligible ChatGPT plan or a separately billed OpenAI or DeepSeek API key.'],
      ['Build a vocabulary', 'Start with 50 papers. Review names, definitions, aliases, and coverage.'],
      ['Review paper suggestions', 'Inspect evidence, accept useful tags, and reject unwanted matches.'],
      ['Enable routine assignment', 'Approve the pilot first. New papers can then use the same vocabulary.'],
    ].forEach(([title, description], index) => steps.append(h('li', 'step', h('span', 'step-number', String(index + 1)), h('div', '', h('h3', '', title), h('p', '', description)))));
    const pilot = h('div', '', h('p', '', s.pilotReviewed ? 'Your pilot has been marked as reviewed. Automatic assignment can be enabled in Settings.' : 'Review the pilot vocabulary and its paper suggestions before enabling automatic assignment.'), h('div', 'actions', button('Open review', () => nav('review')), button(s.pilotReviewed ? 'Pilot reviewed' : 'Mark pilot reviewed', () => run('mark-pilot-reviewed', undefined, 'Pilot review recorded.'), 'primary', s.pilotReviewed || !approvedTags().length || !s.papers.length)));
    return h('div', '', stats, h('div', 'grid', card('Start an analysis', 'A small pilot is a useful first step.', runControls(), undefined, 'overview-primary'), card('How Smart Tags works', '', steps, undefined, 'overview-guide')), h('div', 'section-gap', card('Pilot review', 'Your decisions guide future assignments.', pilot)), h('div', 'notice section-gap', 'Your existing collections and Zotero columns stay as they are. Smart Tags organizes content through native tags and optional saved searches.'));
  }

  function newTag(custom = false) {
    editorTag = { id: '', name: custom ? 'RCL' : '', description: custom ? 'Catalyst-layer resistance in water electrolysis or fuel cells.' : '', facet: 'phenomenon', aliases: [], inclusions: [], exclusions: [], examples: [], custom, status: 'draft', broaderIds: [] };
    render();
  }
  function editTag(tag: DisplayTag) {
    editorTag = { ...tag, aliases: [...tag.aliases], inclusions: [...tag.inclusions], exclusions: [...tag.exclusions], examples: [...tag.examples], broaderIds: [...tag.broaderIds] };
    render();
  }
  function tagEditor() {
    if (!editorTag) return h('section', 'card editor', empty('Define a topic once', 'Select a tag to edit its meaning, or add a custom topic such as RCL.', button('Add custom tag', () => newTag(true), 'primary')));
    const tag = editorTag;
    const lineField = (key: 'aliases' | 'inclusions' | 'exclusions' | 'examples' | 'broaderIds', label: string, note: string) => field(label, textarea(`tag-${key}`, tag[key].join('\n'), value => { tag[key] = value.split('\n').map(line => line.trim()).filter(Boolean); }), note);
    const form = h('form', '',
      field('Tag name', input('tag-name', tag.name, value => { tag.name = value; }, 'A short, recognizable name')),
      field('Definition', textarea('tag-description', tag.description, value => { tag.description = value; }, 'What must a paper discuss to receive this tag?')),
      field('Category', select('tag-facet', tag.facet, facets.map(value => [value, facetNames[value]]), value => { tag.facet = value; })),
      checkbox('tag-custom', tag.custom, 'Custom topic · evaluated in addition to the core tags', value => { tag.custom = value; }),
      h('div', 'divider'),
      lineField('aliases', 'Aliases', 'One alternative name per line. Acronyms still require contextual evidence.'),
      lineField('inclusions', 'Include when', 'Optional matching guidance, one rule per line.'),
      lineField('exclusions', 'Exclude when', 'Optional exclusions, one rule per line.'),
      lineField('examples', 'Example papers or passages', 'One positive example per line.'),
      lineField('broaderIds', 'Broader concept IDs', 'Optional parent IDs from this vocabulary; one per line.'),
      tag.id ? h('p', 'card-description', `Concept ID: ${tag.id}`) : null,
      h('div', 'actions', button('Save definition', async () => {
        if (!tag.name.trim() || !tag.description.trim()) throw new Error('Add a tag name and a definition before saving.');
        await run('save-tag', { tag }, 'Definition saved. Review changed definitions before approving.');
        editorTag = null;
        render();
      }, 'primary'), button('Cancel', () => { editorTag = null; render(); }, 'quiet')),
      tag.id ? h('div', 'actions', button('Remove definition', async () => {
        if (!win.confirm(`Remove the definition “${tag.name}”? Existing native Zotero tags are preserved.`)) return;
        await run('delete-tag', { id: tag.id }, 'Definition removed.');
        editorTag = null;
        render();
      }, 'danger small')) : null);
    form.addEventListener('submit', event => event.preventDefault());
    return h('section', 'card editor', h('div', 'card-header', h('h2', '', tag.id ? 'Edit definition' : 'New definition'), badge(tag.status, tag.status)), h('div', 'card-body', form));
  }
  function renderVocabulary() {
    const s = currentState();
    const query = vocabQuery.toLocaleLowerCase();
    const tags = s.tags.filter(tag => (vocabStatus === 'all' || tag.status === vocabStatus || (vocabStatus === 'custom' && tag.custom)) && (!query || `${tag.name} ${tag.description} ${tag.aliases.join(' ')}`.toLocaleLowerCase().includes(query)));
    const search = input('vocabulary-search', vocabQuery, value => { vocabQuery = value; render(); }, 'Find a tag or concept…', 'search');
    const toolbar = h('div', 'toolbar', search, select('vocabulary-status', vocabStatus, [['all', 'All definitions'], ['draft', 'Drafts'], ['approved', 'Approved'], ['custom', 'Custom topics']], value => { vocabStatus = value; render(); }, 'Vocabulary status'), button('New tag', () => newTag()), button('Custom topic', () => newTag(true), 'primary'));
    const draftIds = s.tags.filter(tag => tag.status === 'draft').map(tag => tag.id);
    const list = h('div', '');
    if (!tags.length) list.append(h('div', 'card', empty('No matching definitions', s.tags.length ? 'Try another search, or add the concept you need.' : 'Run a vocabulary rebuild from Overview, or start by defining a custom topic.')));
    for (const facet of facets) {
      const grouped = tags.filter(tag => tag.facet === facet);
      if (!grouped.length) continue;
      list.append(h('h3', 'facet-heading', facetNames[facet]));
      const rows = h('div', 'tag-list');
      for (const tag of grouped) {
        const row = h('div', `tag-row ${editorTag?.id && editorTag.id === tag.id ? 'selected' : ''}`,
          h('div', 'inline between', h('div', 'tag-heading', h('strong', '', tag.name), badge(tag.status, tag.status), tag.custom ? badge('custom', 'custom') : null), button('Edit', () => editTag(tag), 'quiet small')),
          h('p', '', tag.description),
          h('div', 'tag-meta', h('span', '', `${tag.coverage ?? 0} papers`), tag.aliases.length ? h('span', '', `Aliases: ${tag.aliases.join(', ')}`) : null, tag.broaderIds.length ? h('span', '', `Broader: ${tag.broaderIds.map(tagName).join(', ')}`) : null));
        if (tag.representativePaperIds?.length) {
          const details = h('details', 'section-gap', h('summary', 'muted', 'Representative papers'));
          const examples = h('ul', 'detail-list');
          for (const id of tag.representativePaperIds.slice(0, 5)) examples.append(h('li', '', paperButton(id)));
          details.append(examples);
          row.append(details);
        }
        rows.append(row);
      }
      list.append(rows);
    }
    const reviewBar = h('div', 'notice info inline between', h('div', '', h('strong', '', `${draftIds.length} draft definitions`), h('p', '', 'Approval makes these definitions available to automatic assignment. It does not change paper tags.')), button('Approve draft vocabulary', () => run('approve-vocabulary', { ids: draftIds }, 'Draft vocabulary approved.'), 'primary', !draftIds.length));
    const transfer = h('div', 'inline section-gap', button('Import definitions…', () => run('import-vocabulary', undefined, 'Definitions imported as drafts.')), button('Export definitions…', () => run('export-vocabulary')));
    return h('div', 'stack', reviewBar, toolbar, h('div', 'split', list, tagEditor()), transfer);
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
  function cleanupSection() {
    const cleanup = currentState().cleanup;
    const body = h('div', '');
    if (!cleanup.length) body.append(empty('No cleanup proposals', 'Vocabulary rebuilds can suggest aliases and duplicate-tag merges. Each merge is reviewed separately from new tag assignments.'));
    else {
      const table = h('table');
      table.append(h('thead', '', h('tr', '', h('th', '', ''), h('th', '', 'Existing tag → proposed tag'), h('th', '', 'Affected papers'), h('th', '', 'Manually tagged'), h('th', '', 'Reason'))));
      const tbody = h('tbody');
      for (const item of cleanup) {
        const check = h('input');
        check.type = 'checkbox'; check.checked = selectedCleanup.has(item.id); check.disabled = busy;
        check.setAttribute('aria-label', `Select merge ${item.from} to ${item.to}`);
        check.addEventListener('change', () => { check.checked ? selectedCleanup.add(item.id) : selectedCleanup.delete(item.id); render(); });
        tbody.append(h('tr', '', h('td', '', check), h('td', '', h('strong', '', item.from), ' → ', h('strong', '', item.to)), h('td', '', String(item.affectedCount)), h('td', '', item.manualCount ? badge(String(item.manualCount), 'draft') : '0'), h('td', '', item.reason)));
      }
      table.append(tbody);
      body.append(h('div', 'table-wrap', table));
    }
    return h('section', 'card section-gap', h('div', 'card-header', h('div', '', h('h2', '', 'Existing-tag cleanup'), h('p', 'card-description', 'Merges can affect manually assigned tags. Review the specific changes before applying.')), button('Find cleanup proposals', () => run('preview-cleanup', undefined, 'Cleanup proposals refreshed. Select the replacements you want to review.'))), body, cleanup.length ? h('div', 'card-footer', button('Review selected cleanup', async () => { const ids = [...selectedCleanup]; await run('preview-cleanup', { ids }); modal = { kind: 'cleanup', ids }; render(); }, 'primary', !selectedCleanup.size)) : null);
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
    if (!suggestions.length) list.append(empty('Nothing in this review view', 'Run tag analysis against your approved vocabulary, or select another review filter.', button('Go to Overview', () => nav('overview'), 'quiet')));
    for (const suggestion of visible) list.append(suggestionCard(suggestion));
    return h('div', 'stack', toolbar, actions, list, pagination(suggestions.length, reviewPage, next => { reviewPage = next; }), cleanupSection());
  }

  function tagMatches(paper: DisplayPaper, tagId: string) {
    const name = tagName(tagId);
    return paperTagNames.get(paper.id)?.has(name) || false;
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
    const selectedTagIds = [...combination];
    const papers = s.papers.filter(paper => (!query || searchable(paper).includes(query)) && selectedTagIds.every(id => tagMatches(paper, id)));
    libraryPage = Math.min(libraryPage, Math.max(0, Math.ceil(papers.length / PAGE_SIZE) - 1));
    const toolbar = h('div', 'toolbar', input('paper-search', paperQuery, value => { paperQuery = value; libraryPage = 0; render(); }, 'Search analyzed titles, abstracts, and summaries…', 'search'), button('Save tag search…', () => { modal = { kind: 'search' }; searchName = [...combination].map(tagName).join(' + '); render(); }, '', !combination.size), h('span', 'search-results', `${papers.length} papers`));
    const filters = h('div', '');
    for (const facet of facets) {
      const grouped = tags.filter(tag => tag.facet === facet);
      if (!grouped.length) continue;
      filters.append(h('h3', 'facet-heading', facetNames[facet]));
      const chips = h('div', 'chips');
      for (const tag of grouped) chips.append(button(tag.name, () => { combination.has(tag.id) ? combination.delete(tag.id) : combination.add(tag.id); libraryPage = 0; render(); }, `tag-chip ${combination.has(tag.id) ? 'active' : ''}`));
      filters.append(chips);
    }
    const filterCard = card('Combine tags', 'Papers must have every selected tag.', filters, button('Clear filters', () => { combination.clear(); libraryPage = 0; render(); }, 'quiet small', !combination.size));
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
    const progress = h('div', '', h('div', 'inline between', badge(q.status, q.status === 'running' ? 'approved' : q.status === 'paused' ? 'draft' : ''), h('span', 'muted', `${q.completed} completed · ${q.failed} need attention · ${q.total} total`)), q.message ? h('p', 'card-description', q.message) : null,
      h('div', 'actions', button('Resume', () => run('resume'), 'primary', q.status !== 'paused'), button('Pause', () => run('pause'), '', q.status !== 'running'), button('Cancel remaining', () => run('cancel', undefined, 'Remaining jobs canceled. Completed analysis is kept.'), 'danger', q.status === 'idle')),
      h('p', 'card-description', runProvider !== 'chatgpt' ? `Estimated API cost: ${number(q.spentUSD)} · metadata-only estimate (lower bound): ${number(q.estimatedUSD)}. PDF follow-ups and vocabulary synthesis can add requests; each request is checked against the remaining budget.` : `${(q.spentUSD ?? 0) > 0 ? `Estimated API cost before switching: ${number(q.spentUSD)}. ` : ''}This run uses your ChatGPT plan allowance. A plan limit pauses work; it does not switch to paid API usage.`));
    const jobs = h('div', '');
    if (!q.jobs?.length) jobs.append(empty('No queued work', 'Start an analysis from Overview. Completed results are cached for later runs.'));
    else {
      const table = h('table', '', h('thead', '', h('tr', '', h('th', '', 'Paper'), h('th', '', 'Status'), h('th', '', 'Details'))));
      const tbody = h('tbody');
      for (const job of q.jobs.slice(0, 150)) tbody.append(h('tr', '', h('td', '', job.title || job.id), h('td', '', badge(job.status)), h('td', '', job.error || '')));
      table.append(tbody); jobs.append(h('div', 'table-wrap', table));
      if (q.jobs.length > 150) jobs.append(h('div', 'notice', 'Showing the first 150 jobs. Counts above include the full queue.'));
    }
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
    return h('div', 'stack', card('Analysis queue', 'Work can pause and resume without discarding completed results.', progress), h('section', 'card', h('div', 'card-header', h('h2', '', 'Jobs')), jobs), h('section', 'card', h('div', 'card-header', h('h2', '', 'Applied changes')), history));
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
      connection.append(h('div', 'notice', h('strong', '', s.connection.chatgptSignedIn ? s.connection.accountLabel || 'ChatGPT account connected' : 'Use an eligible ChatGPT plan'), h('p', '', 'Sign-in requests permission to use your plan for AI analysis. Availability and limits depend on your account.')),
        h('div', 'actions', button('Continue with ChatGPT', async () => {
          await saveSettings();
          signingIn = true;
          try { await run('sign-in', undefined, 'ChatGPT sign-in complete. Discover models and test the connection.'); }
          finally { signingIn = false; render(); }
        }, 'primary'), button('Sign out', () => run('sign-out', undefined, 'ChatGPT account disconnected.'), '', !s.connection.chatgptSignedIn)));
      if (s.connection.accounts && s.connection.accounts.length > 1) connection.append(h('div', 'section-gap', field('ChatGPT account', select('settings-chatgpt-account', s.connection.selectedAccountId || s.connection.accounts[0].id, s.connection.accounts.map(account => [account.id, account.label]), value => { void run('select-account', { id: value }, 'ChatGPT account selected.').catch(showError); }))));
    } else {
      const keyProvider = draft.provider;
      const hasKey = keyProvider === 'deepseek' ? s.connection.deepseekKeyStored === true : s.connection.apiKeyStored;
      const secret = input(keyProvider === 'deepseek' ? 'settings-deepseek-key' : 'settings-api-key', apiKeyDrafts[keyProvider], value => { apiKeyDrafts[keyProvider] = value; }, hasKey ? `A ${providerName} key is saved. Enter a new key to replace it.` : `Paste your ${providerName} API key`, 'password');
      secret.autocomplete = 'off';
      secret.setAttribute('spellcheck', 'false');
      connection.append(field(`${providerName} API key`, secret, 'Each provider’s key is saved separately and encrypted. Keys never appear in library exports or manager snapshots.'), h('div', 'actions', button(`Save ${providerName} key`, async () => {
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
    const numberField = (key: 'budgetUSD' | 'inputPricePerMillion' | 'outputPricePerMillion' | 'maxOutputTokens', label: string, note: string, step: string) => {
      const control = input(`settings-${key}`, String(draft[key]), value => { const n = Number(value); if (Number.isFinite(n)) mark(key, n); }, '', 'number');
      control.min = key === 'maxOutputTokens' ? '1' : '0'; control.step = step;
      return field(label, control, note);
    };
    const budgets = h('div', '',
      h('div', 'notice', 'Budget controls apply to the selected API provider. Set its published model rates before analysis; cost estimates use those rates. Model discovery is available while rates are unset.'),
      h('div', 'section-gap', numberField('budgetUSD', 'Per-run API budget · USD', 'The queue pauses before dispatching requests that would exceed its remaining estimate.', '0.01')),
      h('div', 'field-grid', numberField('inputPricePerMillion', 'Input · USD / million tokens', 'Use the standard input rate.', '0.001'), numberField('outputPricePerMillion', 'Output · USD / million tokens', 'Use the standard output rate.', '0.001')),
      h('div', 'section-gap', numberField('maxOutputTokens', 'API output-token limit', 'This request limit is used for API-key requests.', '1')));
    const automatic = h('div', '', checkbox('settings-auto-assign', draft.autoAssign, 'Automatically assign supported tags when a new paper is added', value => mark('autoAssign', value), !s.pilotReviewed),
      h('p', 'card-description', s.pilotReviewed ? 'Only approved definitions and evidence-backed eligible matches are used. Ambiguous matches remain in Review.' : 'Complete and mark your pilot review on Overview to enable automatic assignment.'),
      h('p', 'card-description', 'Manual removals, rejected matches, and locked assignments are remembered. Existing collections and workflow labels remain under your control.'));
    return h('div', 'stack', h('div', 'grid', card('AI connection', 'Select the account and model used for analysis.', connection), card(draft.provider === 'chatgpt' ? 'API budget' : `${providerName} API budget`, 'Model rates are configurable rather than assumed.', budgets)), card('Automatic assignment', 'Use the approved vocabulary for new papers.', automatic), h('div', 'inline', button('Save settings', () => saveSettings(), 'primary'), settingsDirty ? h('span', 'muted', 'Unsaved changes') : h('span', 'muted', 'Settings saved')));
  }
  async function saveSettings() {
    if (!settingsDraft) return;
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
    } else if (active.kind === 'cleanup') {
      const changes = currentState().cleanup.filter(item => active.ids.includes(item.id));
      title = 'Review existing-tag cleanup';
      applyLabel = `Apply ${changes.length} reviewed merges`;
      const manualCount = changes.reduce((total, item) => total + item.manualCount, 0);
      body.append(h('div', `notice ${manualCount ? 'warning' : ''}`, manualCount ? `These merges affect ${manualCount} manually tagged item assignments. Applying explicitly approves the displayed replacements.` : 'These replacements will be recorded in change history with undo.'));
      const table = h('table', 'section-gap', h('thead', '', h('tr', '', h('th', '', 'Replace'), h('th', '', 'With'), h('th', '', 'Papers'), h('th', '', 'Manual assignments'))));
      const tbody = h('tbody');
      for (const item of changes) tbody.append(h('tr', '', h('td', '', item.from), h('td', '', item.to), h('td', '', String(item.affectedCount)), h('td', '', String(item.manualCount))));
      table.append(tbody); body.append(h('div', 'table-wrap', table));
      apply = async () => { await run('apply-cleanup', { ids: active.ids }, 'Reviewed cleanup applied.'); selectedCleanup.clear(); modal = null; render(); };
    } else {
      title = 'Save a Zotero tag search';
      applyLabel = 'Create saved search';
      body.append(h('p', '', 'Create a native saved search requiring all selected tags.'), h('div', 'section-gap', field('Search name', input('saved-search-name', searchName, value => { searchName = value; }))), h('div', 'chips', ...[...combination].map(id => h('span', 'tag-chip', tagName(id)))));
      apply = async () => { if (!searchName.trim()) throw new Error('Enter a name for this saved search.'); await run('save-search', { name: searchName.trim(), tagIds: [...combination] }, 'Saved search created in Zotero.'); modal = null; render(); };
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
    const navItems: [ManagerPage, number?][] = [['overview'], ['vocabulary', s.tags.length], ['review', s.suggestions.filter(item => item.status === 'pending' && !item.applied).length], ['library'], ['activity'], ['settings']];
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
    sidebar.append(h('div', '', h('div', 'sidebar-section-label', 'Workspace'), navigation), h('div', 'sidebar-utilities', h('div', 'sidebar-section-label', 'Tools'), utilities), h('div', 'sidebar-footer', h('p', '', connected ? h('span', 'status-dot') : null, connected ? connectionLabel : 'Connection needed'), h('p', '', `Vocabulary v${s.vocabularyVersion} · Stored locally`)));
    const home = button('Personal library', () => nav('overview'), 'breadcrumb-home');
    home.id = 'workspace-home';
    home.disabled = false;
    const breadcrumbs = h('nav', 'breadcrumbs', home, h('span', 'breadcrumb-divider', '/'), h('span', 'breadcrumb-current', pageNames[page]));
    breadcrumbs.setAttribute('aria-label', 'Breadcrumb');
    const currentCrumb = breadcrumbs.lastElementChild;
    currentCrumb?.setAttribute('aria-current', 'page');
    const topbar = h('div', 'workspace-topbar', breadcrumbs, h('div', 'header-status', busy ? h('span', 'busy-indicator', 'Working…') : s.settings.autoAssign ? 'Automatic assignment on' : 'Review before applying'));
    const workspace = h('main', 'workspace', h('header', 'page-header', h('div', '', h('div', 'workspace-page-icon', icon(page)), h('h1', '', pageTitles[page][0]), h('p', 'subtitle', pageTitles[page][1]))));
    const strip = queueStrip();
    if (strip) workspace.append(strip);
    if (signingIn) {
      const cancel = button('Cancel sign-in', async () => { await api.invoke('cancel-sign-in'); }, 'small');
      cancel.disabled = false;
      workspace.append(h('div', 'notice info inline between', h('span', '', 'Complete sign-in in your browser, or cancel this attempt.'), cancel));
    }
    for (const warning of s.warnings || []) workspace.append(h('div', 'notice warning', warning));
    const contents = page === 'overview' ? renderOverview() : page === 'vocabulary' ? renderVocabulary() : page === 'review' ? renderReview() : page === 'library' ? renderLibrary() : page === 'activity' ? renderActivity() : renderSettings();
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

  const unsubscribe = api.subscribe(() => { void refresh(); });
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
  };
  win.addEventListener('unload', destroy, { once: true });
  void refresh();
  return { refresh, destroy };
}
