import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConceptSearch, createNativeFilterAdapter } from '../src/native-filter.ts';
import type { TagDefinition } from '../src/core.ts';

function definition(id: string, name: string, extra: Partial<TagDefinition> = {}): TagDefinition {
  return { id, name, description: name, facet: 'system', aliases: [], inclusions: [], exclusions: [], examples: [],
    custom: false, status: 'approved', broaderIds: [], ...extra };
}
const definitions = [definition('fc', 'FC', { fullName: 'fuel cell', aliases: ['Fuel Cell'] }),
  definition('aemfc', 'AEMFC', { broaderIds: ['fc'] }), definition('pemfc', 'PEMFC', { broaderIds: ['fc'] }),
  definition('detail', 'Schottky barrier', { custom: true, relatedIds: ['fc'], matchingMode: 'suggest' }),
  definition('eis', 'EIS', { facet: 'method' }), definition('co', 'Co'), definition('CO', 'CO')];

class Search {
  libraryID = 0;
  conditions: any[][] = [];
  scope: any;
  includeChildren = false;
  saved = false;
  addCondition(...args: any[]) { this.conditions.push(args); }
  setScope(search: any, children: boolean) { this.scope = search; this.includeChildren = children; }
  save() { this.saved = true; throw new Error('A navigator query must never save itself.'); }
}
class Row {
  ref: Search;
  searchText = '';
  searchMode: string | null = null;
  tags = new Set<string>();
  constructor(_tree: any, _type: string, ref: Search) { this.ref = ref; }
  get id() { return 'Snull'; }
  getName() { return 'Search'; }
  setSearch(value: string, mode: string | null) { this.searchText = value; this.searchMode = mode; }
  setTags(tags: Set<string>) { this.tags = tags; }
  async getSearchObject() { const outer = new Search(); outer.setScope(this.ref, false); return outer; }
}

function install() {
  (globalThis as any).Zotero = { Libraries: { userLibraryID: 1 }, Search, CollectionTreeRow: Row };
}
/** Evaluate native condition groups to catch accidental flattening of contextual Any clauses. */
function evaluate(search: Search, names: string[]) {
  const root: any = { mode: 'all', children: [] };
  const stack = [root];
  for (const [condition, operator, value] of search.conditions) {
    const group = stack.at(-1)!;
    if (condition === 'groupStart') { const child = { mode: 'all', children: [] }; group.children.push(child); stack.push(child); }
    else if (condition === 'groupEnd') stack.pop();
    else if (condition === 'joinMode') group.mode = operator;
    else if (condition === 'tag') group.children.push(names.includes(value));
    else if (condition === 'itemID') group.children.push(value !== 0);
  }
  assert.equal(stack.length, 1, 'native groups must balance');
  const match = (node: any): boolean => typeof node === 'boolean' ? node : node.mode === 'any' ? node.children.some(match) : node.children.every(match);
  return match(root);
}

function windowHarness(initial = '"quoted native phrase"') {
  const first = { id: 'C10', tags: new Set(['native-tag']), searchText: initial, searchMode: 'everything',
    setSearch(value: string, mode: string) { this.searchText = value; this.searchMode = mode; },
    setTags(value: Set<string>) { this.tags = value; } };
  const second = { ...first, id: 'C20', tags: new Set(['native-tag']) };
  const rows: any[] = [first, second];
  const selection: any = { selected: new Set([0, 1]), focused: 1, selectEventsSuppressed: false,
    select(index: number) { this.selected = new Set([index]); this.focused = index; },
    toggleSelect(index: number) { if (this.selected.has(index)) this.selected.delete(index); else this.selected.add(index); } };
  const search = { searchTextbox: { value: initial } };
  const changes: any[][] = [];
  const filters: any[][] = [];
  const pane: any = {
    collectionsView: { selection, getSelectedRows: () => [...selection.selected].map((index: number) => rows[index]),
      getRowIndexByID: (id: string) => { const index = rows.findIndex(row => row.id === id); return index < 0 ? false : index; },
      get selectedTreeRow() { return rows[selection.focused]; } },
    getCollectionTreeRows() { return this.collectionsView.getSelectedRows(); },
    itemsView: { collectionTreeRows: [first, second], async changeCollectionTreeRows(next: any[]) { this.collectionTreeRows = next; changes.push(next); },
      async setFilter(kind: string, value: any) { filters.push([kind, value]); for (const row of this.collectionTreeRows) { if (kind === 'search') row.searchText = value; if (kind === 'tags') row.tags = value; } } },
    tagSelector: { selectedTags: new Set(['native-tag']), getTagSelection() { return this.selectedTags; }, setState() {} },
    collectionCalls: 0,
    async onCollectionSelected() { this.collectionCalls++; search.searchTextbox.value = ''; this.tagSelector.selectedTags.clear(); this.itemsView.collectionTreeRows = this.getCollectionTreeRows(); },
  };
  const win: any = { ZoteroPane: pane, document: { getElementById: (id: string) => id === 'zotero-tb-search' ? search : null } };
  return { win, pane, search, changes, filters, first, second, selection };
}

test('native snapshot query preserves descendants, aliases and contextual All/Any grouping', () => {
  install();
  const search = buildConceptSearch(definitions, { mode: 'any', selections: [{ conceptId: 'detail', contextId: 'fc' }, { conceptId: 'eis' }] });
  assert.equal(search.libraryID, 1);
  assert.equal(search.saved, false);
  assert.equal(evaluate(search, ['Schottky barrier']), false, 'context cannot disappear when global Any is used');
  assert.equal(evaluate(search, ['Schottky barrier', 'AEMFC']), true);
  assert.equal(evaluate(search, ['EIS']), true);
  assert.equal(evaluate(search, ['FC']), false);
  assert.equal(evaluate(buildConceptSearch(definitions, { mode: 'all', selections: [{ conceptId: 'fc' }] }), ['Fuel Cell']), true);
  assert.equal(evaluate(buildConceptSearch(definitions, { mode: 'all', selections: [{ conceptId: 'aemfc' }] }), ['FC']), false);
  assert.equal(evaluate(buildConceptSearch(definitions, { mode: 'all', selections: [{ conceptId: 'co' }] }), ['CO']), false);
  const legacy = buildConceptSearch(definitions, { mode: 'all', selections: [{ conceptId: 'fc' }] }, 1, ['Fuel cell', 'CO']);
  assert.equal(evaluate(legacy, ['Fuel cell']), true, 'native legacy capitalization agrees with local counts');
  assert.equal(evaluate(buildConceptSearch(definitions, { mode: 'all', selections: [{ conceptId: 'co' }] }, 1, ['CO', 'Co']), ['CO']), false);
});

test('clear filters match the library while invalid concepts explicitly match none', () => {
  install();
  const cleared = buildConceptSearch(definitions, { mode: 'all', selections: [] });
  assert.equal(evaluate(cleared, []), true);
  const missing = buildConceptSearch(definitions, { mode: 'all', selections: [{ conceptId: 'missing' }] });
  assert.deepEqual(missing.conditions.at(-1), ['itemID', 'is', 0]);
  assert.equal(evaluate(missing, ['FC']), false);
  assert.equal(missing.conditions.some(([name]: string[]) => name === 'resultLevel'), false);
});

test('per-window unsaved views retain quick search, include children and restore native multi-selection explicitly', async () => {
  install();
  const harness = windowHarness();
  const adapter = createNativeFilterAdapter(harness.win);
  assert.equal(adapter.available, true);
  const original = Row.prototype.getSearchObject;
  await adapter.apply(definitions, { mode: 'all', selections: [{ conceptId: 'fc' }] });
  const firstRow = harness.pane.itemsView.collectionTreeRows[0];
  assert.match(firstRow.id, /^smart-tags-view-/);
  assert.equal(firstRow.searchText, '"quoted native phrase"');
  assert.equal((await firstRow.getSearchObject()).includeChildren, true);
  assert.equal(Row.prototype.getSearchObject, original, 'only the plugin-owned instance is wrapped');
  harness.search.searchTextbox.value = 'new PDF note annotation terms';
  await adapter.apply(definitions, { mode: 'all', selections: [{ conceptId: 'aemfc' }] });
  assert.notEqual(harness.pane.itemsView.collectionTreeRows[0].id, firstRow.id);
  assert.equal(harness.pane.itemsView.collectionTreeRows[0].searchText, 'new PDF note annotation terms');
  assert.ok(harness.filters.every(([kind]) => kind !== 'advanced-search'));
  await adapter.restore();
  assert.deepEqual([...harness.selection.selected], [0, 1]);
  assert.equal(harness.selection.focused, 1);
  assert.deepEqual(harness.pane.itemsView.collectionTreeRows.map((row: any) => row.id), ['C10', 'C20']);
  assert.equal(harness.pane.collectionCalls, 1, 'even an unchanged native collection selection is restored');
  assert.equal(harness.search.searchTextbox.value, '"quoted native phrase"');
  assert.deepEqual([...harness.pane.tagSelector.getTagSelection()], ['native-tag']);
  assert.deepEqual(harness.filters.slice(-2).map(([kind, value]) => [kind, value instanceof Set ? [...value] : value]), [['tags', ['native-tag']], ['search', '"quoted native phrase"']]);
  assert.equal(adapter.active, false);
});

test('independent windows have unique identities and restore without changing another window', async () => {
  install();
  const one = windowHarness('one'); const two = windowHarness('two');
  const a = createNativeFilterAdapter(one.win); const b = createNativeFilterAdapter(two.win);
  await Promise.all([a.apply(definitions, { mode: 'all', selections: [] }), b.apply(definitions, { mode: 'any', selections: [{ conceptId: 'pemfc' }] })]);
  const otherID = two.pane.itemsView.collectionTreeRows[0].id;
  assert.notEqual(one.pane.itemsView.collectionTreeRows[0].id, otherID);
  await a.destroy();
  assert.equal(two.pane.itemsView.collectionTreeRows[0].id, otherID);
  assert.equal(b.active, true);
  await b.destroy();
  assert.equal(two.search.searchTextbox.value, 'two');
});

test('missing native interfaces leave Collections intact and are safe to destroy', async () => {
  install();
  const adapter = createNativeFilterAdapter({ document: { getElementById: () => null } });
  assert.equal(adapter.available, false);
  await assert.rejects(adapter.apply(definitions, { mode: 'all', selections: [] }), /Collections remain available/);
  await adapter.restore(); await adapter.destroy();
});

test('leaving during an in-flight query restores after the pending native operation', async () => {
  install();
  const harness = windowHarness();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const began = new Promise<void>(resolve => { entered = resolve; });
  const change = harness.pane.itemsView.changeCollectionTreeRows;
  let block = true;
  harness.pane.itemsView.changeCollectionTreeRows = async function (rows: any[]) {
    if (block) { block = false; entered(); await gate; }
    await change.call(this, rows);
  };
  const adapter = createNativeFilterAdapter(harness.win);
  const applying = adapter.apply(definitions, { mode: 'all', selections: [{ conceptId: 'fc' }] });
  await began;
  const restoring = adapter.restore();
  release();
  await Promise.all([applying, restoring]);
  assert.deepEqual(harness.pane.itemsView.collectionTreeRows.map((row: any) => row.id), ['C10', 'C20']);
  assert.equal(adapter.active, false);
});

test('native title, PDF, note, annotation, quoted and multiword text is forwarded verbatim', async () => {
  install();
  for (const text of ['Title token', 'PDF-only-token', 'note-only-token', 'annotation-only-token', '"a quoted phrase"', 'several words together', '']) {
    const harness = windowHarness(text);
    const columns = ['title', 'publicationTitle', 'dateAdded'];
    harness.pane.itemsView.columns = columns;
    const adapter = createNativeFilterAdapter(harness.win);
    await adapter.apply(definitions, { mode: 'all', selections: [{ conceptId: 'fc' }] });
    assert.equal(harness.pane.itemsView.collectionTreeRows[0].searchText, text);
    assert.deepEqual(harness.filters.at(-1), ['search', text]);
    assert.equal(harness.pane.itemsView.columns, columns);
    await adapter.destroy();
    assert.equal(harness.search.searchTextbox.value, text);
    assert.deepEqual(harness.filters.at(-1), ['search', text]);
    assert.equal(harness.pane.itemsView.columns, columns, 'the adapter does not touch item-list columns');
  }
});

test('queued obsolete generations never replace the latest concept query', async () => {
  install();
  const harness = windowHarness();
  const adapter = createNativeFilterAdapter(harness.win);
  const old = adapter.apply(definitions, { mode: 'all', selections: [{ conceptId: 'fc' }] });
  const latest = adapter.apply(definitions, { mode: 'all', selections: [{ conceptId: 'pemfc' }] });
  await Promise.all([old, latest]);
  assert.equal(harness.changes.length, 1);
  const row = harness.pane.itemsView.collectionTreeRows[0];
  assert.equal(evaluate(row.ref, ['AEMFC']), false);
  assert.equal(evaluate(row.ref, ['PEMFC']), true);
  await adapter.destroy();
});

test('destroy during native tag loading cancels installation and restores exact captured filters', async () => {
  install();
  const harness = windowHarness('"original phrase" two words');
  let release!: (tags: any[]) => void;
  let began!: () => void;
  const entered = new Promise<void>(resolve => { began = resolve; });
  const tags = new Promise<any[]>(resolve => { release = resolve; });
  (globalThis as any).Zotero.Tags = { getAll() { began(); return tags; } };
  const adapter = createNativeFilterAdapter(harness.win);
  const applying = adapter.apply(definitions, { mode: 'all', selections: [{ conceptId: 'fc' }] });
  await entered;
  const destroying = adapter.destroy();
  release([{ tag: 'Fuel cell' }]);
  await Promise.all([applying, destroying]);
  assert.ok(harness.changes.every(rows => rows.every(row => !row.id.startsWith('smart-tags-view-'))), 'cancelled generation must not install a view');
  assert.equal(harness.search.searchTextbox.value, '"original phrase" two words');
  assert.deepEqual([...harness.pane.tagSelector.selectedTags], ['native-tag']);
  assert.deepEqual([...harness.selection.selected], [0, 1]);
  assert.equal(harness.selection.focused, 1);
  assert.equal(adapter.active, false);
  await adapter.apply(definitions, { mode: 'all', selections: [] });
  assert.equal(adapter.active, false, 'a disposed adapter cannot reactivate');
});

test('failed native view installation recovers the original collection and filters', async () => {
  install();
  const harness = windowHarness('native original');
  const change = harness.pane.itemsView.changeCollectionTreeRows;
  let fail = true;
  harness.pane.itemsView.changeCollectionTreeRows = async function (rows: any[]) {
    if (fail) { fail = false; this.collectionTreeRows = rows; throw new Error('Failed native view'); }
    await change.call(this, rows);
  };
  const adapter = createNativeFilterAdapter(harness.win);
  await assert.rejects(adapter.apply(definitions, { mode: 'all', selections: [{ conceptId: 'fc' }] }), /Failed native view/);
  assert.deepEqual(harness.pane.itemsView.collectionTreeRows.map((row: any) => row.id), ['C10', 'C20']);
  assert.equal(harness.search.searchTextbox.value, 'native original');
  assert.deepEqual([...harness.pane.tagSelector.selectedTags], ['native-tag']);
  assert.equal(adapter.active, false);
  await adapter.destroy();
});

test('an ancillary collection callback failure cannot leave a temporary row installed', async () => {
  install();
  const harness = windowHarness('native original');
  const errors: any[] = [];
  (globalThis as any).Zotero.logError = (error: any) => errors.push(error);
  const adapter = createNativeFilterAdapter(harness.win);
  await adapter.apply(definitions, { mode: 'all', selections: [] });
  harness.pane.onCollectionSelected = async () => { throw new Error('Unrelated native UI callback failed'); };
  await adapter.restore();
  assert.deepEqual(harness.pane.itemsView.collectionTreeRows.map((row: any) => row.id), ['C10', 'C20']);
  assert.equal(harness.search.searchTextbox.value, 'native original');
  assert.equal(errors.length, 1);
  assert.equal(adapter.active, false);
});

test('deleted captured collections fall back to the personal library and retain original native filters', async () => {
  install();
  const harness = windowHarness('original query');
  const adapter = createNativeFilterAdapter(harness.win);
  await adapter.apply(definitions, { mode: 'all', selections: [] });
  const library = { ...harness.first, id: 'L1' };
  harness.pane.collectionsView.getRowIndexByID = (id: string) => id === 'L1' ? 0 : false;
  harness.pane.collectionsView.getSelectedRows = () => [library];
  harness.pane.getCollectionTreeRows = () => [library];
  await adapter.restore();
  assert.deepEqual(harness.pane.itemsView.collectionTreeRows.map((row: any) => row.id), ['L1']);
  assert.equal(harness.search.searchTextbox.value, 'original query');
  assert.deepEqual([...harness.pane.tagSelector.selectedTags], ['native-tag']);
});

test('restoration refreshes the visible native query instead of merely changing row properties', async () => {
  install();
  const harness = windowHarness('"original native phrase"');
  let visible = '';
  const view = harness.pane.itemsView;
  view.changeCollectionTreeRows = async function (rows: any[]) {
    const same = rows.map(row => row.id).join() === this.collectionTreeRows.map((row: any) => row.id).join();
    this.collectionTreeRows = rows;
    if (!same) visible = `${rows[0].searchText}|${[...rows[0].tags].join()}`;
  };
  view.setFilter = async function (kind: string, value: any) {
    let changed = false;
    for (const row of this.collectionTreeRows) {
      if (kind === 'search' && row.searchText !== value) { row.searchText = value; changed = true; }
      if (kind === 'tags' && [...row.tags].join() !== [...value].join()) { row.tags = new Set(value); changed = true; }
    }
    if (changed) visible = `${this.collectionTreeRows[0].searchText}|${[...this.collectionTreeRows[0].tags].join()}`;
  };
  harness.pane.onCollectionSelected = async function () {
    const rows = this.getCollectionTreeRows();
    for (const row of rows) { row.searchText = ''; row.tags = new Set(); }
    harness.search.searchTextbox.value = '';
    this.tagSelector.selectedTags.clear();
    await this.itemsView.changeCollectionTreeRows(rows);
  };
  const adapter = createNativeFilterAdapter(harness.win);
  await adapter.apply(definitions, { mode: 'all', selections: [] });
  await adapter.restore();
  assert.equal(visible, '"original native phrase"|native-tag', 'restoring row fields alone does not refresh native results');
});

test('legacy DIY parent placements remain contextual and never expand a core search to detail-only papers', () => {
  install();
  const legacy = [...definitions, definition('legacy-detail', 'Legacy detail', { custom: true, facet: 'phenomenon', broaderIds: ['fc'] })];
  const parent = buildConceptSearch(legacy, { mode: 'all', selections: [{ conceptId: 'fc' }] });
  assert.equal(evaluate(parent, ['Legacy detail']), false);
  const contextual = buildConceptSearch(legacy, { mode: 'all', selections: [{ conceptId: 'legacy-detail', contextId: 'fc' }] });
  assert.equal(evaluate(contextual, ['Legacy detail']), false);
  assert.equal(evaluate(contextual, ['Legacy detail', 'AEMFC']), true);
  const global = buildConceptSearch(legacy, { mode: 'all', selections: [{ conceptId: 'legacy-detail' }] });
  assert.equal(evaluate(global, ['Legacy detail']), true);
});

test('a native view waits for initial library data and an active write transaction before installation', async () => {
  install();
  const h = windowHarness();
  let loaded!: () => void; let committed!: () => void;
  const libraryReady = new Promise<void>(resolve => { loaded = resolve; });
  const transactionReady = new Promise<void>(resolve => { committed = resolve; });
  const order: string[] = [];
  (globalThis as any).Zotero.Libraries.get = () => ({ async waitForDataLoad(type: string) { order.push(type); await libraryReady; } });
  (globalThis as any).Zotero.DB = { async waitForTransaction() { order.push('transaction'); await transactionReady; } };
  const adapter = createNativeFilterAdapter(h.win);
  const installing = adapter.apply(definitions, { mode: 'all', selections: [{ conceptId: 'fc' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['item']); assert.equal(h.changes.length, 0);
  loaded(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['item', 'transaction']); assert.equal(h.changes.length, 0);
  committed(); await installing;
  assert.equal(h.changes.length, 1);
  await adapter.destroy();
});

test('initial collection restoration and item loading finish before capturing and installing a tag view',async()=>{
  install();const h=windowHarness('pre-startup query');let collectionsLoaded!:()=>void,itemsLoaded!:()=>void;
  const collectionReady=new Promise<void>(resolve=>{collectionsLoaded=resolve;}),itemReady=new Promise<void>(resolve=>{itemsLoaded=resolve;}),order:string[]=[];
  h.pane.collectionsView.waitForLoad=async()=>{order.push('collections');await collectionReady;};h.pane.itemsView.waitForLoad=async()=>{order.push('items');await itemReady;};
  const adapter=createNativeFilterAdapter(h.win),applying=adapter.apply(definitions,{mode:'all',selections:[{conceptId:'fc'}]});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(order,['collections']);assert.equal(h.changes.length,0);
  // This is Zotero's late makeVisible()/onCollectionSelected() restoration.
  h.selection.select(1);await h.pane.onCollectionSelected();collectionsLoaded();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(order,['collections','items']);assert.equal(h.changes.length,0);assert.equal(adapter.active,false);
  itemsLoaded();await applying;assert.equal(h.changes.length,1);assert.match(h.pane.itemsView.collectionTreeRows[0].id,/^smart-tags-view-/);assert.equal(h.pane.itemsView.collectionTreeRows[0].searchText,'');
  await adapter.restore();assert.deepEqual([...h.selection.selected],[1]);assert.deepEqual(h.pane.itemsView.collectionTreeRows.map((row:any)=>row.id),['C20']);assert.equal(h.search.searchTextbox.value,'');assert.equal(adapter.active,false);
});

test('leaving Tags or disabling during initial collection loading cancels without waiting for window readiness',async t=>{
  for(const action of ['restore','destroy'] as const)await t.test(action,async()=>{
    install();const h=windowHarness('native startup query');let loaded!:()=>void,entered!:()=>void;const collectionReady=new Promise<void>(resolve=>{loaded=resolve;}),waiting=new Promise<void>(resolve=>{entered=resolve;});let itemWaits=0;
    h.pane.collectionsView.waitForLoad=()=>{entered();return collectionReady;};h.pane.itemsView.waitForLoad=async()=>{itemWaits++;};
    const adapter=createNativeFilterAdapter(h.win),applying=adapter.apply(definitions,{mode:'all',selections:[{conceptId:'fc'}]});await waiting;
    // Neither operation may wait for a load event that a closing window will never fire.
    await Promise.all([applying,adapter[action]()]);assert.equal(h.changes.length,0);assert.equal(itemWaits,0);assert.equal(adapter.active,false);assert.equal(h.search.searchTextbox.value,'native startup query');
    h.selection.select(1);await h.pane.onCollectionSelected();loaded();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.pane.itemsView.collectionTreeRows.map((row:any)=>row.id),['C20']);assert.equal(h.changes.length,0);await adapter.destroy();
  });
});
