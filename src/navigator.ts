import { canonicalTagKey, type TagDefinition } from './core.ts';
import { compileConceptFilter, matchCompiledConceptFilter, type ConceptFilter } from './concept-filter.ts';
import { createNativeFilterAdapter, waitForNativeLibrary } from './native-filter.ts';
import type { DisplayTag, ManagerAPI, ManagerSnapshot } from './ui-contract.ts';

const XHTML = 'http://www.w3.org/1999/xhtml';
const CATEGORY_LABELS = { system: 'Systems', component: 'Components & materials', phenomenon: 'Phenomena', method: 'Methods' };
const STYLE_URL = 'chrome://smart-tags/content/navigator.css';
type Mode = 'tags' | 'collections';
export interface NavigatorOptions {
  openManager?: () => void;
  onCreateDetail?: (contextId?: string) => void;
  onEditTag?: (tagId: string) => void;
}
export interface NavigatorHandle {
  refresh(): Promise<void>;
  destroy(): Promise<void>;
  setMode(mode: Mode): Promise<void>;
  readonly mode: Mode;
  readonly filter: ConceptFilter;
  readonly available: boolean;
  readonly message: string;
}
export interface LibraryTagItem { itemID: number; names: string[] }

export function navigatorReady(win: any): boolean {
  const pane = win.ZoteroPane;
  return !!win.document?.getElementById?.('zotero-collections-pane')
    && ['zotero-toolbar-collection-tree', 'zotero-collections-tree-container', 'zotero-tags-splitter', 'zotero-tag-selector-container'].every(id => !!win.document.getElementById(id))
    && !!(pane?.itemsView?.changeCollectionTreeRows && pane.itemsView.setFilter
      && pane.collectionsView?.getSelectedRows && pane.collectionsView?.getRowIndexByID
      && pane.collectionsView?.selection?.select && pane.getCollectionTreeRows
      && typeof Zotero.Search === 'function' && typeof Zotero.CollectionTreeRow === 'function');
}

/** Native data supplies counts and retrieval, including papers outside the analysis pilot. */
export async function readLibraryTagItems(): Promise<LibraryTagItem[]> {
  const libraryID = Zotero.Libraries.userLibraryID;
  await waitForNativeLibrary(libraryID);
  const items = await Zotero.Items.getAll(libraryID, true, false);
  const unique = new Map<number, LibraryTagItem>();
  for (const item of items) {
    if (!item?.isRegularItem?.() || item.deleted || item.libraryID !== libraryID || item.parentItemID) continue;
    unique.set(item.id, { itemID: item.id, names: item.getTags().map((tag: any) => tag.tag) });
  }
  return [...unique.values()];
}

/** Search is global and deduplicated; tree locations explain multiple parent/context links. */
export function searchNavigatorConcepts(definitions: DisplayTag[], query: string): DisplayTag[] {
  const needle = query.normalize('NFC').trim().toLocaleLowerCase();
  const approved = definitions.filter(tag => tag.status === 'approved');
  if (!needle) return [];
  return [...new Map(approved.filter(tag => [tag.name, tag.fullName || '', ...tag.aliases, tag.description]
    .some(value => value.normalize('NFC').toLocaleLowerCase().includes(needle))).map(tag => [tag.id, tag])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function conceptLocations(tag: DisplayTag, definitions: DisplayTag[]): string[] {
  if (tag.builtin === 'no_tag') return ['Excluded from tagging › no_tag'];
  const byID = new Map(definitions.filter(value => value.status === 'approved').map(value => [value.id, value]));
  const paths = (id: string, visited = new Set<string>()): string[] => {
    const current = byID.get(id);
    if (!current || visited.has(id)) return [];
    const seen = new Set([...visited, id]);
    const parents = current.custom ? detailContextIds(current, [...byID.values()]) : current.broaderIds;
    const prefixes = parents.flatMap(parent => paths(parent, seen));
    return prefixes.length ? prefixes.map(prefix => `${prefix} › ${current.name}`)
      : [`${current.custom ? 'Details' : CATEGORY_LABELS[current.facet]} › ${current.name}`];
  };
  return [...new Set(paths(tag.id))];
}

/** Older DIY parent fields mean placement within a context, never inherited core membership. */
function detailContextIds(tag: DisplayTag, definitions: DisplayTag[]): string[] {
  const core = definitions.filter(value => value.status === 'approved' && !value.custom && !value.builtin);
  const known = new Set(core.map(value => value.id));
  return [...new Set([...(tag.relatedIds || []), ...tag.broaderIds,
    ...core.filter(value => (value.relatedIds || []).includes(tag.id)).map(value => value.id)])].filter(id => known.has(id));
}

export function mountNavigator(win: any, api: ManagerAPI, options: NavigatorOptions = {}): NavigatorHandle {
  const doc: Document = win.document;
  const pane = doc?.getElementById?.('zotero-collections-pane');
  const nativeDOMAvailable = ['zotero-toolbar-collection-tree', 'zotero-collections-tree-container', 'zotero-tags-splitter', 'zotero-tag-selector-container']
    .every(id => !!doc?.getElementById?.(id));
  const adapter = createNativeFilterAdapter(win);
  let mode: Mode = 'collections';
  let filter: ConceptFilter = { mode: 'all', selections: [] };
  let snapshot: ManagerSnapshot | undefined;
  let libraryItems: LibraryTagItem[] = [];
  let query = '';
  let destroyed = false;
  let timer: any;
  let refreshGeneration = 0;
  let refreshTail: Promise<void> = Promise.resolve();
  let sawApprovedTaxonomy = false;
  let definitionKey = '';
  let nativeDataDirty = true;
  let nativeDataGeneration = 0;
  let installedNativeAlternatives = new Set<string>();
  let error = '';
  const expanded = new Set<string>();
  const counts = new Map<string, number>();
  let detailExpanded = false;
  let observerID: any;
  let unsubscribe = () => {};
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
    const node = doc.createElementNS(XHTML, tag) as HTMLElementTagNameMap[K];
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  let root: HTMLElement | undefined;
  let content: HTMLElement | undefined;
  let status: HTMLElement | undefined;
  let tabs: { tags: HTMLButtonElement; collections: HTMLButtonElement } | undefined;
  let stylesheet: Element | undefined;

  function button(text: string, action: () => void | Promise<void>, className = '') {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', () => { Promise.resolve().then(action).catch(reportError); });
    return node;
  }
  function reportError(cause: any) { error = cause?.message || String(cause); render(); }
  const definitions = () => (snapshot?.tags || []).filter(tag => tag.status === 'approved');
  const currentDefinitions = () => definitions() as TagDefinition[];
  const selectionKey = (conceptId: string, contextId?: string) => `${contextId || ''}\u0000${conceptId}`;
  function count(selection: ConceptFilter['selections'][number]) {
    const key = selectionKey(selection.conceptId, selection.contextId);
    if (counts.has(key)) return counts.get(key)!;
    const single: ConceptFilter = { mode: 'all', selections: [selection] };
    const compiled = compileConceptFilter(currentDefinitions(), single);
    const value = libraryItems.filter(item => matchCompiledConceptFilter(item.names, compiled)).length;
    counts.set(key, value);
    return value;
  }
  function updateVisibility() {
    if (!root || !pane || !content || !tabs) return;
    pane.setAttribute('data-smart-tags-mode', mode);
    content.hidden = mode !== 'tags';
    for (const value of ['tags', 'collections'] as const) {
      tabs[value].setAttribute('aria-selected', String(mode === value));
      tabs[value].classList.toggle('is-active', mode === value);
    }
  }
  async function applyFilter() {
    if (mode !== 'tags' || destroyed) return;
    const alternatives = nativeAlternatives();
    try { await adapter.apply(currentDefinitions(), filter); installedNativeAlternatives = alternatives; }
    catch (cause) {
      error = `${(cause as any)?.message || cause} Switched back to Collections.`;
      mode = 'collections';
      await adapter.restore();
      updateVisibility();
      render();
    }
  }
  function nativeAlternatives() {
    const groups = compileConceptFilter(currentDefinitions(), filter).clauses.flatMap(clause => clause.groups);
    const literalNames = new Set(groups.flat());
    const keys = new Set([...literalNames].map(canonicalTagKey));
    return new Set(libraryItems.flatMap(item => item.names).filter(name => !literalNames.has(name) && keys.has(canonicalTagKey(name))));
  }
  async function setMode(next: Mode) {
    if (destroyed || !pane) return;
    if (next === 'tags' && (!adapter.available || !nativeDOMAvailable)) {
      error = 'Tag navigation is unavailable in this Zotero window. Your collections remain available.';
      render(); return;
    }
    if (next === mode) { if (next === 'tags') await applyFilter(); return; }
    error = '';
    mode = next;
    if (next === 'collections') await adapter.restore();
    else await applyFilter();
    updateVisibility(); render();
  }
  async function toggleSelection(tag: DisplayTag, contextId?: string) {
    const key = selectionKey(tag.id, contextId);
    const selected = filter.selections.some(value => selectionKey(value.conceptId, value.contextId) === key);
    filter = { ...filter, selections: selected
      ? filter.selections.filter(value => selectionKey(value.conceptId, value.contextId) !== key)
      : [...filter.selections, { conceptId: tag.id, ...(contextId ? { contextId } : {}) }] };
    if (!selected) expanded.add(tag.id);
    error = ''; render(); await applyFilter();
  }
  function renderConcept(tag: DisplayTag, parent: HTMLElement, depth = 0, contextId?: string, ancestors = new Set<string>(), allowExpansion = true) {
    if (ancestors.has(tag.id)) return;
    const all = definitions();
    const children = tag.custom || tag.builtin || !allowExpansion ? [] : all.filter(child => !child.custom && !child.builtin && child.broaderIds.includes(tag.id)).sort((a, b) => a.name.localeCompare(b.name));
    const details = tag.custom || tag.builtin || !allowExpansion ? [] : all.filter(child => child.custom && !child.builtin && detailContextIds(child, all).includes(tag.id)).sort((a, b) => a.name.localeCompare(b.name));
    const branches = children.length + details.length;
    const row = el('div', 'smart-tags-concept-row');
    row.style.setProperty('--smart-tags-depth', String(depth));
    const open = expanded.has(tag.id);
    const expander = button(branches ? (open ? '⌄' : '›') : '', () => {
      if (expanded.has(tag.id)) expanded.delete(tag.id); else expanded.add(tag.id);
      render();
    }, 'smart-tags-expander');
    expander.disabled = !branches;
    expander.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${tag.name}`);
    if (branches) expander.setAttribute('aria-expanded', String(open));
    const selected = filter.selections.some(value => selectionKey(value.conceptId, value.contextId) === selectionKey(tag.id, contextId));
    const select = button('', () => toggleSelection(tag, contextId), 'smart-tags-concept-select');
    select.setAttribute('role', 'checkbox');
    select.setAttribute('aria-checked', String(selected));
    select.setAttribute('aria-label', contextId ? `${tag.name} within ${all.find(value => value.id === contextId)?.name || contextId}` : tag.name);
    select.title = [tag.fullName, tag.description].filter(Boolean).join('\n');
    if (selected) select.classList.add('is-selected');
    select.append(el('span', 'smart-tags-check', selected ? '✓' : ''), el('span', 'smart-tags-concept-name', tag.name),
      el('span', 'smart-tags-count', String(count({ conceptId: tag.id, ...(contextId ? { contextId } : {}) }))));
    row.append(expander, select);
    parent.append(row);
    if (open && branches) {
      const nextAncestors = new Set([...ancestors, tag.id]);
      for (const child of children) renderConcept(child, parent, depth + 1, undefined, nextAncestors);
      for (const detail of details) renderConcept(detail, parent, depth + 1, tag.id, nextAncestors);
    }
  }
  function render() {
    if (!root || !content || !status || !tabs || destroyed) return;
    updateVisibility();
    status.textContent = error;
    status.hidden = !error;
    content.replaceChildren();
    const search = el('input', 'smart-tags-search');
    search.type = 'search'; search.placeholder = 'Search tags'; search.value = query;
    search.setAttribute('aria-label', 'Search names, full names, aliases and definitions');
    search.addEventListener('input', () => {
      const start = search.selectionStart;
      query = search.value; render();
      const next = content?.querySelector<HTMLInputElement>('.smart-tags-search');
      next?.focus();
      if (next && start !== null) { try { next.setSelectionRange(start, start); } catch {} }
    });
    const tools = el('div', 'smart-tags-tools');
    const all = button('All', async () => { filter = { ...filter, mode: 'all' }; render(); await applyFilter(); });
    const any = button('Any', async () => { filter = { ...filter, mode: 'any' }; render(); await applyFilter(); });
    for (const [node, value] of [[all, 'all'], [any, 'any']] as const) {
      node.classList.toggle('is-active', filter.mode === value); node.setAttribute('aria-pressed', String(filter.mode === value));
    }
    tools.append(el('span', 'smart-tags-combine-label', 'Match'), all, any);
    const compiled = compileConceptFilter(currentDefinitions(), filter);
    const total = libraryItems.filter(item => matchCompiledConceptFilter(item.names, compiled)).length;
    tools.append(el('span', 'smart-tags-result-count', `${total} papers`));
    content.append(search, tools);
    if (filter.selections.length) {
      const chips = el('div', 'smart-tags-filter-chips');
      for (const selection of filter.selections) {
        const tag = definitions().find(value => value.id === selection.conceptId);
        const context = definitions().find(value => value.id === selection.contextId);
        const chip = button(`${context ? `${context.name} + ` : ''}${tag?.name || 'Unavailable concept'} ×`, async () => {
          filter = { ...filter, selections: filter.selections.filter(value => value !== selection) }; render(); await applyFilter();
        }, 'smart-tags-filter-chip');
        chip.setAttribute('aria-label', `Remove ${context ? `${context.name} and ` : ''}${tag?.name || 'unavailable concept'} filter`);
        chips.append(chip);
      }
      chips.append(button('Clear', async () => { filter = { ...filter, selections: [] }; render(); await applyFilter(); }, 'smart-tags-clear'));
      content.append(chips);
    }
    const tree = el('div', 'smart-tags-tree');
    tree.setAttribute('aria-label', query ? 'Tag search results' : 'Tag concepts');
    if (query.trim()) {
      const matches = searchNavigatorConcepts(definitions(), query);
      if (!matches.length) tree.append(el('p', 'smart-tags-empty', 'No matching concepts.'));
      for (const tag of matches) {
        const result = el('div', 'smart-tags-search-result');
        renderConcept(tag, result, 0, undefined, new Set(), false);
        result.append(el('div', 'smart-tags-location', conceptLocations(tag, definitions()).join(' · ')));
        tree.append(result);
      }
    } else {
      for (const facet of Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]) {
        const all = definitions();
        const roots = all.filter(tag => !tag.custom && !tag.builtin && tag.facet === facet && !tag.broaderIds.some(id => all.some(value => value.id === id && !value.custom && !value.builtin))).sort((a, b) => a.name.localeCompare(b.name));
        if (!roots.length) continue;
        tree.append(el('h3', 'smart-tags-category', CATEGORY_LABELS[facet]));
        for (const tag of roots) renderConcept(tag, tree);
      }
      const details = definitions().filter(tag => tag.custom && !tag.builtin).sort((a, b) => a.name.localeCompare(b.name));
      if (details.length) {
        const heading = button(`${detailExpanded ? '⌄' : '›'} Shared details`, () => { detailExpanded = !detailExpanded; render(); }, 'smart-tags-category smart-tags-detail-heading');
        heading.setAttribute('aria-expanded', String(detailExpanded)); tree.append(heading);
        if (detailExpanded) for (const tag of details) renderConcept(tag, tree);
      }
      if (!definitions().some(tag => !tag.builtin)) tree.append(el('p', 'smart-tags-empty', 'Prepare and apply a tag list in Smart Tags to browse your papers here.'));
      const noTag = definitions().find(tag => tag.builtin === 'no_tag');
      if (noTag) {
        tree.append(el('h3', 'smart-tags-category', 'Excluded from tagging'));
        renderConcept(noTag, tree, 0, undefined, new Set(), false);
      }
    }
    content.append(tree);
    const actions = el('div', 'smart-tags-actions');
    const context = [...filter.selections].reverse().map(selection => definitions().find(tag => tag.id === selection.conceptId && !tag.custom && !tag.builtin)).find(Boolean);
    actions.append(button('＋ Create detail', () => {
      if (options.onCreateDetail) options.onCreateDetail(context?.id); else options.openManager?.();
    }));
    const selectedDetail = [...filter.selections].reverse().map(selection => definitions().find(tag => tag.id === selection.conceptId && tag.custom && !tag.builtin)).find(Boolean);
    if (selectedDetail) {
      actions.append(el('div', 'smart-tags-detail-title', selectedDetail.name));
      actions.append(button('Assign to selected papers', async () => {
        const itemIDs = (win.ZoteroPane?.getSelectedItems?.() || []).filter((item: any) => item.isRegularItem?.() && !item.deleted && item.libraryID === Zotero.Libraries.userLibraryID).map((item: any) => item.id);
        await api.invoke('assign-detail', { tagId: selectedDetail.id, scope: 'selected', itemIDs });
        await refresh();
      }));
      actions.append(button('Preview matches', async () => {
        await api.invoke('preview-detail', { tagId: selectedDetail.id, scope: 'library' }); options.openManager?.();
      }));
      if (options.onEditTag) actions.append(button('Edit definition', () => options.onEditTag!(selectedDetail.id)));
    }
    if (options.openManager) actions.append(button('Open tag manager ↗', options.openManager, 'smart-tags-manage'));
    content.append(actions);
  }
  function scheduleRefresh() {
    if (destroyed || !root) return;
    if (timer !== undefined) win.clearTimeout(timer);
    timer = win.setTimeout(() => { timer = undefined; void refresh().catch(reportError); }, 120);
  }
  function refresh(): Promise<void> {
    const request = ++refreshGeneration;
    const task = refreshTail.then(async () => {
      if (destroyed || !root || request !== refreshGeneration) return;
      const scanNative = nativeDataDirty;
      const indexGeneration = nativeDataGeneration;
      const [next, items] = await Promise.all([api.snapshot(), scanNative ? readLibraryTagItems() : Promise.resolve(libraryItems)]);
      if (destroyed || request !== refreshGeneration) return;
      const wasReady = !!snapshot?.taxonomyReady;
      const priorKey = definitionKey;
      definitionKey = JSON.stringify(next.tags.map(tag => [tag.id, tag.name, tag.fullName, tag.aliases, tag.broaderIds, tag.relatedIds, tag.status, tag.custom]));
      snapshot = next; libraryItems = items;
      if (indexGeneration === nativeDataGeneration) nativeDataDirty = false;
      counts.clear();
      render();
      if (next.taxonomyReady && !sawApprovedTaxonomy) {
        sawApprovedTaxonomy = true;
        await setMode('tags');
      } else if (mode === 'tags' && (priorKey !== definitionKey || (!wasReady && next.taxonomyReady)
        || (scanNative && [...nativeAlternatives()].some(name => !installedNativeAlternatives.has(name))))) await applyFilter();
    });
    refreshTail = task.catch(() => {});
    return task;
  }

  if (pane && doc.createElementNS && typeof pane.insertBefore === 'function') {
    root = el('div', 'smart-tags-navigator'); root.id = 'smart-tags-navigator';
    const bar = el('div', 'smart-tags-tabs'); bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Library navigation');
    tabs = { tags: button('Smart Tags', () => setMode('tags')), collections: button('Collections', () => setMode('collections')) };
    tabs.tags.setAttribute('role', 'tab'); tabs.collections.setAttribute('role', 'tab');
    bar.append(tabs.tags, tabs.collections);
    status = el('div', 'smart-tags-status'); status.setAttribute('role', 'status'); status.hidden = true;
    content = el('div', 'smart-tags-content'); content.hidden = true;
    root.append(bar, status, content);
    pane.insertBefore(root, pane.firstChild);
    stylesheet = doc.createElementNS(XHTML, 'link');
    stylesheet.setAttribute('rel', 'stylesheet'); stylesheet.setAttribute('href', STYLE_URL);
    (doc.head || doc.documentElement).appendChild(stylesheet);
    unsubscribe = api.subscribe(scheduleRefresh);
    if (Zotero.Notifier?.registerObserver) observerID = Zotero.Notifier.registerObserver({ notify(_event: string, type: string) {
      if (['item', 'item-tag', 'tag'].includes(type)) { nativeDataDirty = true; ++nativeDataGeneration; scheduleRefresh(); }
    } }, ['item', 'item-tag', 'tag'], 'smart-tags-navigator');
    updateVisibility();
    void refresh().catch(reportError);
  }
  return {
    refresh, setMode,
    get mode() { return mode; },
    get available() { return !!root && adapter.available && nativeDOMAvailable; },
    get message() { return error; },
    get filter() { return { mode: filter.mode, selections: filter.selections.map(selection => ({ ...selection })) }; },
    async destroy() {
      if (destroyed) return;
      destroyed = true; ++refreshGeneration;
      if (timer !== undefined) win.clearTimeout(timer);
      unsubscribe();
      if (observerID !== undefined) Zotero.Notifier.unregisterObserver(observerID);
      try { await adapter.destroy(); }
      finally { pane?.removeAttribute('data-smart-tags-mode'); root?.remove(); stylesheet?.remove(); }
    },
  };
}
