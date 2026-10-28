import type { TagDefinition } from './core.ts';
import { canonicalTagKey } from './core.ts';
import { compileConceptFilter, type ConceptFilter } from './concept-filter.ts';

/** A snapshot query: descendants and approved legacy names are resolved at creation. */
export function buildConceptSearch(definitions: TagDefinition[], filter: ConceptFilter, libraryID = Zotero.Libraries.userLibraryID, nativeTagNames: readonly string[] = []): any {
  const search = new Zotero.Search();
  search.libraryID = libraryID;
  search.addCondition('joinMode', 'all');
  search.addCondition('noChildren', 'true');
  search.addCondition('itemType', 'isNot', 'attachment');
  search.addCondition('itemType', 'isNot', 'note');
  search.addCondition('itemType', 'isNot', 'annotation');
  const compiled = compileConceptFilter(definitions, filter);
  if (compiled.empty) {
    // Empty native groups are discarded by Zotero. An impossible item ID is explicit.
    search.addCondition('itemID', 'is', 0);
    return search;
  }
  if (!compiled.clauses.length) return search;
  search.addCondition('groupStart', 'true', '');
  search.addCondition('joinMode', compiled.mode);
  for (const clause of compiled.clauses) {
    search.addCondition('groupStart', 'true', '');
    search.addCondition('joinMode', 'all');
    for (const names of clause.groups) {
      search.addCondition('groupStart', 'true', '');
      search.addCondition('joinMode', 'any');
      // Preserve scientifically significant case while recognizing legacy prose capitalization.
      const keys = new Set(names.map(canonicalTagKey));
      const alternatives = new Set([...names, ...nativeTagNames.filter(name => keys.has(canonicalTagKey(name)))]);
      for (const name of alternatives) search.addCondition('tag', 'is', name);
      search.addCondition('groupEnd', 'true', '');
    }
    search.addCondition('groupEnd', 'true', '');
  }
  search.addCondition('groupEnd', 'true', '');
  return search;
}

export interface NativeFilterAdapter {
  readonly available: boolean;
  readonly active: boolean;
  apply(definitions: TagDefinition[], filter: ConceptFilter): Promise<void>;
  restore(): Promise<void>;
  destroy(): Promise<void>;
}

let nextWindowID = 0;
const quickSearch = (win: any) => win.document?.getElementById('zotero-tb-search');
const searchTextbox = (win: any) => quickSearch(win)?.searchTextbox || win.document?.getElementById('zotero-tb-search-textbox') || quickSearch(win);

/** Match ZoteroPane's library-load guard before reading or replacing a native item view. */
export async function waitForNativeLibrary(libraryID = Zotero.Libraries.userLibraryID): Promise<void> {
  const library = Zotero.Libraries.get?.(libraryID);
  await library?.waitForDataLoad?.('item');
  await Zotero.DB?.waitForTransaction?.();
}

/** Private native interfaces live here, never on Zotero prototypes or other windows. */
export function createNativeFilterAdapter(win: any): NativeFilterAdapter {
  const pane = win.ZoteroPane;
  const available = !!(pane?.itemsView?.changeCollectionTreeRows && pane.itemsView.setFilter
    && pane.collectionsView?.getSelectedRows && pane.collectionsView?.getRowIndexByID
    && pane.collectionsView?.selection?.select && pane.getCollectionTreeRows
    && typeof Zotero.Search === 'function' && typeof Zotero.CollectionTreeRow === 'function');
  const windowID = ++nextWindowID;
  let generation = 0;
  let active = false;
  let destroyed = false;
  let tail: Promise<void> = Promise.resolve();
  let captured: {
    rows: any[]; rowIDs: string[]; focusedID?: string; tags: string[];
    search: string; searchMode: string | null;
    rowFilters: { row: any; searchText: string; searchMode: string | null; tags: string[]; advancedSearch: any }[];
  } | null = null;

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const task = tail.then(operation);
    tail = task.catch(() => {});
    return task;
  }

  function capture() {
    const rows = pane.getCollectionTreeRows();
    const selected = pane.collectionsView.getSelectedRows();
    const first = rows[0];
    captured = {
      rows: [...rows], rowIDs: selected.map((row: any) => row.id),
      focusedID: pane.collectionsView.selectedTreeRow?.id,
      tags: [...(pane.tagSelector?.getTagSelection?.() || first?.tags || [])],
      search: searchTextbox(win)?.value ?? first?.searchText ?? '',
      searchMode: first?.searchMode || null,
      rowFilters: rows.map((row: any) => ({ row, searchText: row.searchText || '', searchMode: row.searchMode || null,
        tags: [...(row.tags || [])], advancedSearch: row.advancedSearch })),
    };
  }

  async function restoreCaptured() {
    if (!captured) return;
    await waitForNativeLibrary();
    const saved = captured;
    const tree = pane.collectionsView;
    const selection = tree.selection;
    const suppressed = selection.selectEventsSuppressed;
    selection.selectEventsSuppressed = true;
    try {
      // Usually the hidden native selection is unchanged. Resolve IDs again after deletion/reordering.
      const indices = saved.rowIDs.map(id => tree.getRowIndexByID(id)).filter((index: any) => index !== false && index >= 0);
      if (indices.length) {
        selection.select(indices[0]);
        for (const index of indices.slice(1)) {
          if (!selection.toggleSelect) throw new Error('Zotero cannot restore the previous multiple-collection selection.');
          selection.toggleSelect(index);
        }
        const focused = saved.focusedID && tree.getRowIndexByID(saved.focusedID);
        if (focused !== undefined && focused !== false) selection.focused = focused;
      } else {
        const index = tree.getRowIndexByID(`L${Zotero.Libraries.userLibraryID}`);
        if (index === false) throw new Error('The personal-library row is unavailable.');
        selection.select(index);
      }
    } finally { selection.selectEventsSuppressed = suppressed; }
    // selectByID/selectWait can no-op when the original row is still selected. Restore explicitly.
    if (pane.onCollectionSelected) {
      try { await pane.onCollectionSelected(); }
      catch (error) {
        // A native ancillary UI callback must not strand the items list on our temporary row.
        // The explicit view restoration below is independent of that callback.
        Zotero.logError?.(error);
      }
    }
    const restored = pane.getCollectionTreeRows();
    await pane.itemsView.changeCollectionTreeRows(restored.length ? restored : saved.rows);
    for (const rowFilter of saved.rowFilters) {
      if (rowFilter.advancedSearch && rowFilter.row.advancedSearch !== rowFilter.advancedSearch) rowFilter.row.setAdvancedSearch?.(rowFilter.advancedSearch);
    }
    if (pane.tagSelector) {
      // Zotero 10 exposes get/clear and its public selectedTags property, but no setter method.
      if (pane.tagSelector.setTagSelection) pane.tagSelector.setTagSelection(new Set(saved.tags));
      else pane.tagSelector.selectedTags = new Set(saved.tags);
      if (pane.tagSelector.forceUpdate) pane.tagSelector.forceUpdate();
      else pane.tagSelector.setState?.({});
    }
    if (searchTextbox(win)) searchTextbox(win).value = saved.search;
    // Let native setters change row state and refresh the visible list. Pre-setting row filters
    // here would make these calls no-ops after onCollectionSelected() loaded an unfiltered list.
    // Apply directly: ZoteroPane.search() deliberately waits for Enter on quoted queries.
    await pane.itemsView.setFilter('tags', new Set(saved.tags));
    await pane.itemsView.setFilter('search', saved.search);
    captured = null;
  }

  return {
    get available() { return available; },
    get active() { return active; },
    apply(definitions, filter) {
      const request = ++generation;
      return enqueue(async () => {
        if (destroyed || request !== generation) return;
        if (!available) throw new Error('This Zotero window does not provide the interfaces required for tag navigation. Collections remain available.');
        await waitForNativeLibrary();
        if (destroyed || request !== generation) return;
        if (!active) capture();
        const text = searchTextbox(win)?.value ?? captured?.search ?? '';
        const priorMode = pane.itemsView.collectionTreeRows?.[0]?.searchMode || captured?.searchMode || null;
        // Newly constructed native rows use the placeholder "search", not a quick-search mode.
        const mode = priorMode === 'search' ? null : priorMode;
        const nativeTags = Zotero.Tags?.getAll ? await Zotero.Tags.getAll(Zotero.Libraries.userLibraryID) : [];
        if (request !== generation || destroyed) return;
        const search = buildConceptSearch(definitions, filter, Zotero.Libraries.userLibraryID, nativeTags.map((tag: any) => tag.tag));
        const row = new Zotero.CollectionTreeRow(null, 'search', search, 0, false);
        Object.defineProperty(row, 'id', { value: `smart-tags-view-${windowID}-${request}`, configurable: true });
        row.getName = () => 'Tags';
        row.setSearch?.(text, mode);
        const original = row.getSearchObject;
        if (typeof original !== 'function') throw new Error('Zotero search-backed rows are unavailable.');
        row.getSearchObject = async function (options: any = {}) {
          const filtered = await original.call(this, options);
          // Native search-backed rows exclude child evidence from their outer scope by default.
          if (filtered.scope) filtered.setScope(filtered.scope, true);
          return filtered;
        };
        active = true;
        try {
          await pane.itemsView.changeCollectionTreeRows([row]);
          if (request !== generation || destroyed) return;
          // Native tag-selector filters belong to Collections and must not constrain this query.
          await pane.itemsView.setFilter('tags', new Set());
          await pane.itemsView.setFilter('search', text);
        } catch (error) {
          active = false;
          await restoreCaptured();
          throw error;
        }
      });
    },
    restore() {
      ++generation;
      return enqueue(async () => { if (active || captured) { active = false; await restoreCaptured(); } });
    },
    destroy() {
      destroyed = true;
      ++generation;
      return enqueue(async () => { active = false; await restoreCaptured(); });
    },
  };
}
