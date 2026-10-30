import test from 'node:test';
import assert from 'node:assert/strict';
import { conceptLocations, mountNavigator, navigatorReady, readLibraryTagItems, searchNavigatorConcepts } from '../src/navigator.ts';
import type { DisplayTag } from '../src/ui-contract.ts';

function tag(id: string, name: string, extra: Partial<DisplayTag> = {}): DisplayTag {
  return { id, name, description: name, facet: 'system', aliases: [], inclusions: [], exclusions: [], examples: [],
    custom: false, status: 'approved', broaderIds: [], ...extra };
}
const tags = [tag('fc', 'FC', { fullName: 'fuel cell', aliases: ['Fuel Cell'] }),
  tag('aemfc', 'AEMFC', { fullName: 'anion exchange membrane fuel cell', broaderIds: ['fc'] }),
  tag('pemfc', 'PEMFC', { fullName: 'proton exchange membrane fuel cell', broaderIds: ['fc'] }),
  tag('rcl', 'RCL', { description: 'Catalyst-layer resistance in water electrolysis or fuel cells', custom: true, relatedIds: ['fc'], matchingMode: 'suggest' }),
  tag('draft', 'Unapproved', { status: 'draft' })];
function item(id: number, names: string[], extra: any = {}) {
  return { id, libraryID: 1, deleted: false, isRegularItem: () => true, getTags: () => names.map(tag => ({ tag, type: 0 })), ...extra };
}

function harness(ready = true, available = true) {
  class Element {
    ownerDocument: any;
    localName: string;
    id = '';
    className = '';
    children: Element[] = [];
    parentNode: Element | null = null;
    attrs = new Map<string, string>();
    listeners = new Map<string, (() => void)[]>();
    style = { setProperty() {} };
    ownText = '';
    hidden = false;
    disabled = false;
    value = '';
    selectionStart: number | null = 0;
    constructor(name: string) { this.localName = name; this.ownerDocument = doc; }
    get firstChild() { return this.children[0] || null; }
    get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
    set textContent(value: string) { this.ownText = value; this.children = []; }
    get classList() {
      return { add: (name: string) => { if (!this.className.split(' ').includes(name)) this.className += ` ${name}`; },
        toggle: (name: string, enabled: boolean) => { this.className = this.className.split(' ').filter(value => value !== name).concat(enabled ? [name] : []).join(' '); } };
    }
    append(...nodes: Element[]) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
    appendChild(node: Element) { this.append(node); return node; }
    insertBefore(node: Element, next: Element | null) { const index = next ? this.children.indexOf(next) : -1; node.parentNode = this; if (index < 0) this.children.push(node); else this.children.splice(index, 0, node); }
    replaceChildren(...nodes: Element[]) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.ownText = ''; this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    setAttribute(name: string, value: string) { this.attrs.set(name, value); }
    getAttribute(name: string) { return this.attrs.get(name) ?? null; }
    removeAttribute(name: string) { this.attrs.delete(name); }
    addEventListener(type: string, listener: () => void) { this.listeners.set(type, [...this.listeners.get(type) || [], listener]); }
    fire(type: string) { if (!this.disabled) for (const listener of this.listeners.get(type) || []) listener(); }
    focus() { doc.activeElement = this; }
    setSelectionRange(start: number) { this.selectionStart = start; }
    querySelector(selector: string): Element | null { return descendants(this).find(node => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : node.localName === selector) || null; }
  }
  const doc: any = { activeElement: null,
    createElement() { throw new Error('Native XHTML elements need an explicit namespace.'); },
    createElementNS(namespace: string, name: string) { assert.equal(namespace, 'http://www.w3.org/1999/xhtml'); return new Element(name); },
    getElementById(id: string) { return [doc.documentElement, ...descendants(doc.documentElement)].find(node => node.id === id) || null; } };
  doc.documentElement = new Element('window'); doc.head = new Element('head'); doc.documentElement.append(doc.head);
  const sidebar = new Element('vbox'); sidebar.id = 'zotero-collections-pane'; doc.documentElement.append(sidebar);
  for (const id of ['zotero-toolbar-collection-tree', 'zotero-collections-tree-container', 'zotero-tags-splitter', 'zotero-tag-selector-container']) { const native = new Element('vbox'); native.id = id; sidebar.append(native); }
  const textbox = new Element('input'); textbox.id = 'zotero-tb-search-textbox'; textbox.value = 'native search'; doc.documentElement.append(textbox);
  const nativeRow: any = { id: 'C1', tags: new Set(['native']), searchText: 'native search', searchMode: 'everything', setSearch() {}, setTags() {} };
  const pane: any = { getSelectedItems: () => [item(2, ['AEMFC', 'RCL'])] };
  if (available) Object.assign(pane, {
    itemsView: { collectionTreeRows: [nativeRow], async changeCollectionTreeRows(rows: any[]) { this.collectionTreeRows = rows; }, async setFilter() {} },
    collectionsView: { selection: { focused: 0, selectEventsSuppressed: false, select() {} }, getSelectedRows: () => [nativeRow], getRowIndexByID: () => 0, selectedTreeRow: nativeRow },
    getCollectionTreeRows: () => [nativeRow], async onCollectionSelected() {},
  });
  class Search { conditions: any[] = []; scope: any; libraryID: any; addCondition(...args: any[]) { this.conditions.push(args); } setScope(scope: any) { this.scope = scope; } }
  class Row { ref: any; constructor(_tree: any, _type: string, ref: any) { this.ref = ref; } async getSearchObject() { const search = new Search(); search.setScope(this.ref); return search; } setSearch() {} }
  const observers = new Map<number, any>(); let nextObserver = 0;
  const items = [item(1, ['FC']), item(2, ['AEMFC', 'RCL']), item(2, ['AEMFC', 'RCL']), item(3, ['PEMFC', 'RCL']), item(4, ['RCL']),
    item(5, ['FC'], { deleted: true }), item(6, ['FC'], { libraryID: 2 }), item(7, ['FC'], { isRegularItem: () => false }), item(8, ['FC'], { parentItemID: 2 })];
  const scans: any[] = [];
  (globalThis as any).Zotero = { Search, CollectionTreeRow: Row, Libraries: { userLibraryID: 1 },
    Items: { async getAll(...args: any[]) { scans.push(args); return items; } },
    Notifier: { registerObserver(observer: any) { const id = ++nextObserver; observers.set(id, observer); return id; }, unregisterObserver(id: number) { observers.delete(id); } } };
  const timers = new Map<number, () => void>(); let nextTimer = 0;
  const win: any = { document: doc, ZoteroPane: pane, setTimeout(callback: () => void) { const id = ++nextTimer; timers.set(id, callback); return id; }, clearTimeout(id: number) { timers.delete(id); } };
  let snapshot: any = { tags, taxonomyReady: ready, vocabularyVersion: 2, papers: [{ id: 'pilot-only' }] };
  const subscriptions = new Set<() => void>(); const invocations: any[] = [];
  const api: any = { async snapshot() { return snapshot; }, async invoke(...args: any[]) { invocations.push(args); }, subscribe(callback: () => void) { subscriptions.add(callback); return () => subscriptions.delete(callback); } };
  function descendants(node: Element): Element[] { return node.children.flatMap(child => [child, ...descendants(child)]); }
  const nodes = () => descendants(sidebar);
  const label = (value: string) => nodes().find(node => node.getAttribute('aria-label') === value);
  const text = (value: string) => nodes().find(node => node.localName === 'button' && node.textContent === value);
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  return { win, api, sidebar, nodes, label, text, scans, observers, subscriptions, invocations, timers, items, flush,
    setSnapshot(value: any) { snapshot = { ...snapshot, ...value }; for (const callback of subscriptions) callback(); },
    async runTimers() { for (const [id, callback] of timers) { timers.delete(id); callback(); } await flush(); } };
}

test('global search covers full names, aliases and descriptions, deduplicating locations', () => {
  assert.deepEqual(searchNavigatorConcepts([...tags, tags[0]], 'proton exchange').map(tag => tag.id), ['pemfc']);
  assert.deepEqual(searchNavigatorConcepts(tags, 'catalyst-layer').map(tag => tag.id), ['rcl']);
  assert.equal(searchNavigatorConcepts(tags, 'Fuel Cell').some(tag => tag.id === 'fc'), true);
  assert.deepEqual(searchNavigatorConcepts(tags, 'Unapproved'), []);
  assert.deepEqual(conceptLocations(tags[1], tags), ['Systems › FC › AEMFC']);
  assert.deepEqual(conceptLocations(tags[3], tags), ['Systems › FC › RCL']);
});

test('native counts include every eligible personal paper, deduplicating parents and ignoring the pilot index', async () => {
  const h = harness();
  assert.deepEqual((await readLibraryTagItems()).map(item => item.itemID), [1, 2, 3, 4]);
  assert.deepEqual(h.scans[0], [1, true, false]);
  const navigator = mountNavigator(h.win, h.api); await navigator.refresh();
  assert.equal(navigator.mode, 'tags');
  assert.equal(h.sidebar.getAttribute('data-smart-tags-mode'), 'tags');
  assert.equal(h.label('FC')?.textContent, 'FC3');
  assert.equal(h.nodes().some(node => node.textContent === '4 papers'), true);
  assert.equal(h.label('AEMFC'), undefined, 'narrower branches start collapsed');
  await navigator.destroy();
  assert.equal(h.sidebar.getAttribute('data-smart-tags-mode'), null);
  assert.equal(h.sidebar.children.some(node => node.id === 'zotero-collections-tree-container'), true);
  assert.equal(h.observers.size, 0); assert.equal(h.subscriptions.size, 0);
});

test('selection expands independently, contextual details stay compound, and clearing search retains selected filters', async () => {
  const h = harness(); const created: (string | undefined)[] = [];
  const navigator = mountNavigator(h.win, h.api, { onCreateDetail: context => { created.push(context); } }); await navigator.refresh();
  h.label('Expand FC')!.fire('click'); await h.flush();
  assert.equal(navigator.filter.selections.length, 0, 'expanding must not select');
  assert.ok(h.label('AEMFC'));
  h.label('FC')!.fire('click'); await h.flush();
  assert.deepEqual(navigator.filter, { mode: 'all', selections: [{ conceptId: 'fc' }] });
  h.text('＋ Create tag')!.fire('click'); await h.flush(); assert.deepEqual(created, ['fc']);
  h.label('RCL within FC')!.fire('click'); await h.flush();
  h.text('Any')!.fire('click'); await h.flush();
  assert.equal(navigator.filter.mode, 'any');
  assert.deepEqual(navigator.filter.selections[1], { conceptId: 'rcl', contextId: 'fc' });
  let search = h.nodes().find(node => node.className === 'smart-tags-search')!;
  search.value = 'RCL'; search.fire('input'); await h.flush();
  assert.equal(h.nodes().filter(node => node.className === 'smart-tags-search-result').length, 1);
  assert.ok(h.label('RCL'), 'global detail search omits context');
  h.label('RCL')!.fire('click'); await h.flush();
  assert.deepEqual(navigator.filter.selections.at(-1), { conceptId: 'rcl' });
  search = h.nodes().find(node => node.className === 'smart-tags-search')!;
  search.value = ''; search.fire('input'); await h.flush();
  assert.ok(h.label('AEMFC'), 'search clearing restores expansion');
  assert.equal(navigator.filter.selections.length, 3);
  h.text('Assign to selected papers')!.fire('click'); await h.flush();
  assert.deepEqual(h.invocations[0], ['assign-detail', { tagId: 'rcl', scope: 'selected', itemIDs: [2] }]);
  h.text('Preview matches')!.fire('click'); await h.flush();
  assert.deepEqual(h.invocations[1], ['preview-detail', { tagId: 'rcl', scope: 'library' }]);
  await navigator.destroy();
});

test('Collections remains the default before approval; the first approved taxonomy enables Tags once', async () => {
  const h = harness(false); const navigator = mountNavigator(h.win, h.api); await navigator.refresh();
  assert.equal(navigator.mode, 'collections');
  h.setSnapshot({ taxonomyReady: true }); await h.runTimers(); await navigator.refresh();
  assert.equal(navigator.mode, 'tags');
  await navigator.setMode('collections');
  h.setSnapshot({ vocabularyVersion: 3 }); await h.runTimers(); await navigator.refresh();
  assert.equal(navigator.mode, 'collections', 'background updates respect the user switching back');
  await navigator.destroy();
});

test('Smart Tags remains discoverable with no approved list and readiness covers all required native nodes',async()=>{
  const h=harness(false);h.setSnapshot({tags:[]});assert.equal(navigatorReady(h.win),true);
  const navigator=mountNavigator(h.win,h.api);await navigator.refresh();assert.ok(h.text('Smart Tags'));assert.ok(h.text('Collections'));assert.equal(navigator.mode,'collections');assert.equal(navigator.available,true);
  await navigator.setMode('tags');assert.match(h.sidebar.textContent,/Prepare and apply a tag list/);assert.doesNotMatch(h.sidebar.textContent,/consolidated vocabulary/);
  await navigator.destroy();const delayed=h.nodes().find(node=>node.id==='zotero-tag-selector-container')!;delayed.remove();assert.equal(navigatorReady(h.win),false);h.sidebar.append(delayed);assert.equal(navigatorReady(h.win),true);
});

test('builtin no_tag is a standalone searchable filter without DIY matching or editing actions',async()=>{
  const builtin=tag('smart-tags:no-tag','no_tag',{builtin:'no_tag',custom:true,matchingMode:'manual',description:'Papers excluded from tagging.'}),h=harness(false);h.setSnapshot({tags:[builtin],taxonomyReady:false});h.items.find(value=>value.id===4)!.getTags=()=>[{tag:'RCL',type:0},{tag:'no_tag',type:0}];
  const navigator=mountNavigator(h.win,h.api,{onEditTag(){throw new Error('Builtin tags are not editable.');}});await navigator.refresh();await navigator.setMode('tags');assert.ok(h.label('no_tag'));assert.equal(h.label('no_tag')!.textContent,'no_tag1');assert.match(h.sidebar.textContent,/Excluded from tagging/);assert.doesNotMatch(h.sidebar.textContent,/Shared details/);h.label('no_tag')!.fire('click');await h.flush();assert.deepEqual(navigator.filter.selections,[{conceptId:'smart-tags:no-tag'}]);assert.equal(h.text('Assign to selected papers'),undefined);assert.equal(h.text('Preview matches'),undefined);assert.equal(h.text('Edit definition'),undefined);assert.deepEqual(searchNavigatorConcepts([builtin],'no_tag').map(value=>value.id),[builtin.id]);assert.deepEqual(conceptLocations(builtin,[builtin]),['Excluded from tagging › no_tag']);await navigator.destroy();
});

test('unsupported native interfaces display a fallback and preserve Collections', async () => {
  const h = harness(true, false); const navigator = mountNavigator(h.win, h.api); await navigator.refresh();
  await navigator.setMode('tags');
  assert.equal(navigator.mode, 'collections');
  assert.match(h.sidebar.textContent, /collections remain available/i);
  await navigator.destroy();
});

test('native counts refresh on item notifications while analysis progress reuses the local index', async () => {
  const h = harness(); const navigator = mountNavigator(h.win, h.api); await navigator.refresh();
  const scans = h.scans.length;
  h.label('FC')!.fire('click'); await h.flush();
  const viewID = h.win.ZoteroPane.itemsView.collectionTreeRows[0].id;
  h.setSnapshot({ queue: { completed: 12 } }); await h.runTimers(); await navigator.refresh();
  assert.equal(h.scans.length, scans, 'unrelated controller progress must not rescan the library');
  h.items.push(item(10, ['AEMFC']));
  for (const observer of h.observers.values()) observer.notify('add', 'item');
  await h.runTimers(); await navigator.refresh();
  assert.equal(h.scans.length, scans + 1);
  assert.equal(h.win.ZoteroPane.itemsView.collectionTreeRows[0].id, viewID, 'ordinary native updates refresh counts without replacing the native view');
  assert.equal(h.label('FC')?.textContent, '✓FC4');
  assert.equal(h.nodes().some(node => node.textContent === '4 papers'), true);
  await navigator.destroy();
  assert.equal(h.timers.size, 0);
});

test('a newly observed legacy spelling recompiles only the affected active query', async () => {
  const h = harness(); const navigator = mountNavigator(h.win, h.api); await navigator.refresh();
  h.label('FC')!.fire('click'); await h.flush();
  const original = h.win.ZoteroPane.itemsView.collectionTreeRows[0].id;
  h.items.push(item(11, ['Fuel cell']));
  for (const observer of h.observers.values()) observer.notify('add', 'item');
  await h.runTimers(); await navigator.refresh();
  const expanded = h.win.ZoteroPane.itemsView.collectionTreeRows[0].id;
  assert.notEqual(expanded, original, 'new capitalization needs an additional literal native alternative');
  for (const observer of h.observers.values()) observer.notify('modify', 'item');
  await h.runTimers(); await navigator.refresh();
  assert.equal(h.win.ZoteroPane.itemsView.collectionTreeRows[0].id, expanded, 'known alternatives do not repeatedly rebuild the row');
  await navigator.destroy();
});

test('detail definition changes recompile navigation without changing the core vocabulary version', async () => {
  const h = harness(); const navigator = mountNavigator(h.win, h.api); await navigator.refresh();
  const before = h.win.ZoteroPane.itemsView.collectionTreeRows[0].id;
  h.setSnapshot({ tags: tags.map(value => value.id === 'rcl' ? { ...value, name: 'CL resistance', aliases: ['RCL'] } : value) });
  await h.runTimers(); await navigator.refresh();
  assert.notEqual(h.win.ZoteroPane.itemsView.collectionTreeRows[0].id, before);
  assert.equal(navigator.mode, 'tags');
  await navigator.destroy();
});

test('a changed native sidebar structure falls back to Collections before hiding native controls', async () => {
  const h = harness();
  h.nodes().find(node => node.id === 'zotero-tags-splitter')!.remove();
  const navigator = mountNavigator(h.win, h.api); await navigator.refresh();
  assert.equal(navigator.mode, 'collections');
  assert.equal(h.sidebar.getAttribute('data-smart-tags-mode'), 'collections');
  assert.match(h.sidebar.textContent, /collections remain available/i);
  await navigator.destroy();
});

test('shared-detail locations include outgoing, incoming and legacy contexts without duplicate paths', async () => {
  const legacy = tag('legacy', 'Legacy detail', { custom: true, facet: 'phenomenon', broaderIds: ['fc'], relatedIds: ['fc'] });
  const reverse = tag('reverse', 'Reverse detail', { custom: true, facet: 'phenomenon', relatedIds: [] });
  const linked = tags.map(value => value.id === 'fc' ? { ...value, relatedIds: ['reverse'] } : value);
  const definitions = [...linked, legacy, reverse];
  assert.deepEqual(conceptLocations(legacy, definitions), ['Systems › FC › Legacy detail']);
  assert.deepEqual(conceptLocations(reverse, definitions), ['Systems › FC › Reverse detail']);
  const h = harness(); h.setSnapshot({ tags: definitions });
  h.items.push(item(11, ['Legacy detail']), item(12, ['Legacy detail', 'AEMFC']));
  const navigator = mountNavigator(h.win, h.api); await navigator.refresh();
  h.label('Expand FC')!.fire('click'); await h.flush();
  assert.ok(h.label('Legacy detail within FC'));
  assert.ok(h.label('Reverse detail within FC'));
  assert.equal(h.label('FC')!.textContent, 'FC4');
  assert.equal(h.label('Legacy detail within FC')!.textContent, 'Legacy detail1', 'context count excludes a shared detail in another field');
  h.label('Legacy detail within FC')!.fire('click'); await h.flush();
  assert.deepEqual(navigator.filter.selections, [{ conceptId: 'legacy', contextId: 'fc' }]);
  let search = h.nodes().find(node => node.className === 'smart-tags-search')!;
  search.value = 'Reverse detail'; search.fire('input'); await h.flush();
  assert.equal(h.nodes().filter(node => node.className === 'smart-tags-search-result').length, 1);
  assert.ok(h.nodes().some(node => node.className === 'smart-tags-location' && node.textContent === 'Systems › FC › Reverse detail'));
  await navigator.destroy();
});

test('all saved definitions appear directly under scientific categories and offer the same actions',async()=>{
 const h=harness(),navigator=mountNavigator(h.win,h.api,{onEditTag(){}});await navigator.refresh();assert.ok(h.label('RCL'),'A researcher-authored definition is visible without opening a separate class.');assert.doesNotMatch(h.sidebar.textContent,/Shared details|Your topics|User details/);assert.ok(h.text('＋ Create tag'));h.label('FC')!.fire('click');await h.flush();assert.ok(h.text('Assign to selected papers'));assert.ok(h.text('Preview matches'));assert.ok(h.text('Edit definition'));h.text('Assign to selected papers')!.fire('click');await h.flush();assert.deepEqual(h.invocations[0],['assign-detail',{tagId:'fc',scope:'selected',itemIDs:[2]}]);await navigator.destroy();
});
