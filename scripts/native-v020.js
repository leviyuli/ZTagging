/** TEST ONLY. Native fixture writes require the exact isolated profile and data directory. */
import { buildConceptSearch, createNativeFilterAdapter } from '../src/native-filter.ts';
import { readLibraryTagItems } from '../src/navigator.ts';
import { matchConceptFilter } from '../src/concept-filter.ts';

const normalizePath = value => String(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, limit = 25_000) {
  const start = Date.now();
  while (Date.now() - start < limit) { const value = predicate(); if (value) return value; await delay(50); }
  throw new Error('Native v0.2.0 timeout: ' + label);
}
const sorted = values => [...new Set(values)].sort((a, b) => a - b);
const equal = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
function definition(id, name, extra = {}) {
  return { id: 'native-v020-' + id, name, fullName: name, description: name, facet: 'system', aliases: [],
    inclusions: [], exclusions: [], examples: [], broaderIds: [], relatedIds: [], custom: false, status: 'approved', matchingMode: 'auto', ...extra };
}
function pdfDocument(text) {
  const escaped = text.replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 12 Tf 40 740 Td (${escaped}) Tj ET\n`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}endstream`];
  let result = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(result.length); result += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = result.length;
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) result += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return result + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
function columns(view) { return JSON.stringify(view.getColumns().map(column => [column.dataKey, !!column.hidden, column.width, column.ordinal, column.sortActive, column.sortDirection])); }
function textbox(win) { return win.document.getElementById('zotero-tb-search').searchTextbox; }
async function regularParents(ids, libraryID) {
  const parents = new Set();
  for (const id of ids) {
    let item = await Zotero.Items.getAsync(id);
    const visited = new Set();
    while (item && !item.isRegularItem() && (item.parentID || item.parentItemID) && !visited.has(item.id)) {
      visited.add(item.id); item = await Zotero.Items.getAsync(item.parentID || item.parentItemID);
    }
    if (item?.isRegularItem() && !item.deleted && item.libraryID === libraryID) parents.add(item.id);
  }
  return sorted(parents);
}
async function shownParents(win, libraryID) {
  const rows = win.ZoteroPane.itemsView.collectionTreeRows;
  const ids = (await Promise.all(rows.map(row => row.getSearchResults(false)))).flat();
  return regularParents(ids, libraryID);
}

export async function runNativeV020(app, check, config) {
  check('v020IsolatedDataGuard', normalizePath(Zotero.DataDirectory.dir) === normalizePath(config.data));
  check('v020IsolatedProfileGuard', normalizePath(Services.dirsvc.get('ProfD', Ci.nsIFile).path) === normalizePath(config.profile));
  const libraryID = Zotero.Libraries.userLibraryID;
  const main = Zotero.getMainWindow();
  await until(() => main?.ZoteroPane?.itemsView && main.ZoteroPane.collectionsView, 'main window items view');
  const oldTaxonomyReady = app.state.taxonomyReady;
  await Zotero.SmartTags.getNavigator(main)?.refresh();
  if(oldTaxonomyReady)check('v020ApprovedStartupDefaultsToTags',Zotero.SmartTags.getNavigator(main)?.mode==='tags');
  await Zotero.SmartTags.getNavigator(main)?.setMode('collections');
  const oldQuickSearchMode = Zotero.Prefs.get('search.quicksearch-mode');
  app.state.taxonomyReady = false;
  app.state.settings.autoAssign = false;
  await app.save();
  let secondary;
  const adapters = [];
  let staged = false;
  const stamp = Date.now().toString(36);
  try {
    // Only previous synthetic parent items in this already-verified isolated library are trashed.
    for (const previous of await Zotero.Items.getAll(libraryID, true, false)) {
      if (previous.isRegularItem() && !previous.deleted && String(previous.getField('title')).startsWith('V020QA ')) {
        previous.deleted = true; await previous.saveTx({ skipSelect: true });
      }
    }
    const defs = [
      definition('fc', 'FC', { fullName: 'fuel cell', aliases: ['Fuel Cell'] }),
      definition('aemfc', 'AEMFC', { fullName: 'anion exchange membrane fuel cell', broaderIds: ['native-v020-fc'] }),
      definition('pemfc', 'PEMFC', { fullName: 'proton exchange membrane fuel cell', broaderIds: ['native-v020-fc'] }),
      definition('schottky', 'Schottky barrier', { custom: true, facet: 'phenomenon', relatedIds: ['native-v020-fc'], matchingMode: 'suggest' }),
      definition('eis', 'EIS', { fullName: 'electrochemical impedance spectroscopy', facet: 'method' }),
      definition('cobalt', 'Co', { fullName: 'Cobalt', facet: 'component' }),
      definition('carbon-monoxide', 'CO', { fullName: 'Carbon monoxide', facet: 'component' }),
    ];
    const samples = [
      ['Broad technology', ['FC']],
      ['AEMFC porous ordered electrode', ['AEMFC', 'Schottky barrier', 'Co']],
      ['PEMFC catalyst assessment', ['PEMFC']],
      ['Comparison of membrane technologies', ['AEMFC', 'PEMFC']],
      ['Shared detail outside fuel cells', ['Schottky barrier', 'CO']],
      ['Legacy capitalization', ['Fuel cell']],
      ['Independent measurement technique', ['EIS', 'CO']],
      ['Solid oxide technology', ['SOFC']],
    ];
    const items = [];
    for (const [title, names] of samples) {
      const item = new Zotero.Item('journalArticle'); item.libraryID = libraryID;
      item.setField('title', `V020QA ${stamp} ${title}`);
      item.setField('abstractNote', 'Synthetic isolated native navigation fixture.');
      item.setField('publicationTitle', 'V020QA Synthetic Journal');
      for (const name of names) item.addTag(name, 0);
      await item.saveTx({ skipSelect: true }); items.push(item);
    }
    const pid = index => items[index].id;
    const fcExpected = [0, 1, 2, 3, 5].map(pid);
    const names = (await Zotero.Tags.getAll(libraryID)).map(tag => tag.tag);
    const query = async (filter, definitions = defs) => sorted(await buildConceptSearch(definitions, filter, libraryID, names).search());
    const filter = (conceptId, contextId) => ({ mode: 'all', selections: [{ conceptId: 'native-v020-' + conceptId, ...(contextId ? { contextId: 'native-v020-' + contextId } : {}) }] });
    check('v020NativeDescendantsAndLegacyAliases', equal(await query(filter('fc')), fcExpected));
    check('v020NativeSpecificSubtypeExcludesBroadOnly', equal(await query(filter('aemfc')), [pid(1), pid(3)]));
    check('v020NativeContextDetailAll', equal(await query(filter('schottky', 'fc')), [pid(1)]));
    check('v020NativeGlobalDetail', equal(await query(filter('schottky')), [pid(1), pid(4)]));
    const legacyDetailDefs = defs.map(tag => tag.id === 'native-v020-schottky' ? { ...tag, broaderIds: ['native-v020-fc'], relatedIds: [] } : tag);
    check('v020NativeLegacyDetailDoesNotExpandParent', equal(await query(filter('fc'), legacyDetailDefs), fcExpected));
    check('v020NativeLegacyDetailKeepsCompoundContext', equal(await query(filter('schottky', 'fc'), legacyDetailDefs), [pid(1)]));
    const contextualAny = { mode: 'any', selections: [{ conceptId: 'native-v020-schottky', contextId: 'native-v020-fc' }, { conceptId: 'native-v020-eis' }] };
    check('v020NativeContextCompoundAny', equal(await query(contextualAny), [pid(1), pid(6)]));
    check('v020NativeScientificCaseCo', equal(await query(filter('cobalt')), [pid(1)]));
    check('v020NativeScientificCaseCO', equal(await query(filter('carbon-monoxide')), [pid(4), pid(6)]));
    check('v020NativeInvalidConceptMatchesNone', (await query(filter('missing'))).length === 0);
    const nativeIndex = await readLibraryTagItems();
    const counted = nativeIndex.filter(item => matchConceptFilter(item.names, defs, filter('fc'))).map(item => item.itemID);
    check('v020NativeCountsDeduplicateAndIncludeUnindexedPapers', equal(counted, fcExpected) && items.every(item => !app.state.papers[`${libraryID}:${item.key}`]), { count: counted.length });
    const saved = buildConceptSearch(defs, filter('fc'), libraryID, names);
    saved.name = 'V020QA hierarchy snapshot ' + stamp; await saved.saveTx();
    const changed = [...defs, definition('sofc', 'SOFC', { fullName: 'solid oxide fuel cell', broaderIds: ['native-v020-fc'] })];
    check('v020NativeSavedSearchFreezesHierarchy', equal(await saved.search(), fcExpected) && equal(await query(filter('fc'), changed), [...fcExpected, pid(7)]));

    const note = new Zotero.Item('note'); note.libraryID = libraryID; note.parentID = pid(1);
    note.setNote('<p>v020qanotewitness evidence from a child note only.</p>'); await note.saveTx({ skipSelect: true });
    const pdfPath = PathUtils.join(config.data, 'v020-qa-native-evidence.pdf');
    await IOUtils.writeUTF8(pdfPath, pdfDocument('v020qapdfwitness unique searchable evidence in a PDF attachment.'));
    const attachment = await Zotero.Attachments.importFromFile({ file: pdfPath, parentItemID: pid(1), title: 'V020QA evidence PDF', contentType: 'application/pdf', saveOptions: { skipSelect: true } });
    await Zotero.Fulltext.indexItems([attachment.id], { complete: true, ignoreErrors: false });
    const extracted = await attachment.attachmentText;
    check('v020NativePDFTextExtractedAndIndexed', extracted.includes('v020qapdfwitness'), { extraction: 'Zotero PDFWorker via Fulltext.indexItems', attachmentID: attachment.id });
    const annotation = await Zotero.Annotations.saveFromJSON(attachment, { key: Zotero.Utilities.generateObjectKey(), type: 'highlight',
      text: 'v020qaannotationwitness', comment: 'Native annotation-only search witness.', color: '#ffd400', pageLabel: '1', sortIndex: '00000|000000|00000',
      position: { pageIndex: 0, rects: [[40, 730, 170, 744]] }, tags: [] });
    check('v020NativeChildEvidenceFixtures', note.parentID === pid(1) && annotation.parentID === attachment.id);
    const pane = main.ZoteroPane;
    await pane.collectionsView.selectLibrary(libraryID); await pane.onCollectionSelected();
    await pane.itemsView.setFilter('tags', new Set());
    const initialColumns = columns(pane.itemsView);
    const baseline = new Map();
    const cases = [
      { mode: 'titleCreatorYear', text: 'porous', expected: [pid(1)], label: 'Title' },
      { mode: 'everything', text: 'v020qapdfwitness', expected: [pid(1)], label: 'PDF' },
      { mode: 'everything', text: 'v020qanotewitness', expected: [pid(1)], label: 'Note' },
      { mode: 'everything', text: 'v020qaannotationwitness', expected: [pid(1)], label: 'Annotation' },
      { mode: 'everything', text: '"porous ordered"', expected: [pid(1)], label: 'Quoted' },
      { mode: 'everything', text: 'porous electrode', expected: [pid(1)], label: 'Multiword' },
    ];
    for (const search of cases) {
      Zotero.Prefs.set('search.quicksearch-mode', search.mode); textbox(main).value = search.text;
      await pane.itemsView.setFilter('search', search.text);
      const ids = await shownParents(main, libraryID); baseline.set(search.label, ids);
      check('v020Baseline' + search.label + 'Search', equal(ids, search.expected), { query: search.text, ids });
    }
    const adapter = createNativeFilterAdapter(main); adapters.push(adapter);
    check('v020NativeAdapterAvailable', adapter.available);
    for (const search of cases) {
      Zotero.Prefs.set('search.quicksearch-mode', search.mode); textbox(main).value = search.text;
      await adapter.apply(defs, filter('fc'));
      const ids = await shownParents(main, libraryID);
      check('v020TagMode' + search.label + 'Search', equal(ids, baseline.get(search.label)), { query: search.text, ids });
    }
    textbox(main).value = 'nothingcanmatchv020qa'; await pane.itemsView.setFilter('search', textbox(main).value);
    check('v020NativeEmptyQuickSearch', (await shownParents(main, libraryID)).length === 0);
    textbox(main).value = ''; await pane.itemsView.setFilter('search', '');
    await adapter.apply(defs, filter('fc'));
    const incomingViewID = pane.itemsView.collectionTreeRows[0].id;
    const incoming = new Zotero.Item('journalArticle'); incoming.libraryID = libraryID;
    incoming.setField('title', `V020QA ${stamp} newly imported membrane study`); incoming.addTag('AEMFC', 0);
    await incoming.saveTx({ skipSelect: true });
    await until(() => pane.itemsView.getSortedItems(true).includes(incoming.id), 'native view includes incoming AEMFC paper');
    check('v020NativeIncomingPaperRefreshesExistingView', pane.itemsView.collectionTreeRows[0].id === incomingViewID);
    incoming.removeTag('AEMFC'); await incoming.saveTx({ skipSelect: true });
    await until(() => !pane.itemsView.getSortedItems(true).includes(incoming.id), 'native view excludes paper after subtype tag removal');
    check('v020NativeTagRemovalRefreshesExistingView', pane.itemsView.collectionTreeRows[0].id === incomingViewID);
    incoming.deleted = true; await incoming.saveTx({ skipSelect: true });
    await adapter.restore();
    check('v020NativeColumnsPreserved', columns(pane.itemsView) === initialColumns);

    const collections = [];
    for (const label of ['A', 'B']) {
      const collection = new Zotero.Collection(); collection.libraryID = libraryID; collection.name = `V020QA ${stamp} ${label}`; await collection.saveTx(); collections.push(collection);
    }
    for (let i = 0; i < items.length; i++) { items[i].addToCollection(collections[i < 4 ? 0 : 1].id); await items[i].saveTx({ skipSelect: true }); }
    await pane.collectionsView.selectByID('C' + collections[0].id);
    await pane.collectionsView.expandToCollection(collections[1].id);
    const selection = pane.collectionsView.selection;
    selection.selectEventsSuppressed = true;
    try { selection.select(pane.collectionsView.getRowIndexByID('C' + collections[0].id)); selection.toggleSelect(pane.collectionsView.getRowIndexByID('C' + collections[1].id)); }
    finally { selection.selectEventsSuppressed = false; }
    await pane.onCollectionSelected();
    Zotero.Prefs.set('search.quicksearch-mode', 'everything');
    const originalText = '"V020QA"'; textbox(main).value = originalText;
    pane.tagSelector.selectedTags = new Set(['FC']); pane.tagSelector.forceUpdate();
    await pane.itemsView.setFilter('tags', new Set(['FC'])); await pane.itemsView.setFilter('search', originalText);
    const originalIDs = pane.getCollectionTreeRows().map(row => row.id).sort();
    const expectedVisible = await shownParents(main, libraryID);
    const multiColumns = columns(pane.itemsView);
    await adapter.apply(defs, filter('fc'));
    const firstIdentity = pane.itemsView.collectionTreeRows[0].id;
    const existingWindows = new Set(Zotero.getMainWindows()); Zotero.openMainWindow();
    secondary = await until(() => Zotero.getMainWindows().find(win => !existingWindows.has(win) && win.ZoteroPane?.itemsView && win.ZoteroPane?.collectionsView), 'second main window');
    await until(() => Zotero.SmartTags.getNavigator(secondary), 'second navigator mount');
    await Zotero.SmartTags.getNavigator(secondary).setMode('collections');
    const secondaryColumns = columns(secondary.ZoteroPane.itemsView);
    const secondAdapter = createNativeFilterAdapter(secondary); adapters.push(secondAdapter);
    textbox(secondary).value = ''; await secondAdapter.apply(defs, filter('pemfc'));
    check('v020NativeIndependentWindows', firstIdentity !== secondary.ZoteroPane.itemsView.collectionTreeRows[0].id && equal(await shownParents(secondary, libraryID), [pid(2), pid(3)]));
    await adapter.destroy();
    check('v020NativeDestroyRestoresCollectionsAndFilters', JSON.stringify(pane.getCollectionTreeRows().map(row => row.id).sort()) === JSON.stringify(originalIDs)
      && textbox(main).value === originalText && pane.tagSelector.getTagSelection().has('FC') && equal(await shownParents(main, libraryID), expectedVisible)
      && columns(pane.itemsView) === multiColumns);
    check('v020NativeOtherWindowRemainsFiltered', equal(await shownParents(secondary, libraryID), [pid(2), pid(3)]));
    await secondAdapter.destroy();
    check('v020NativeOtherWindowColumnsRestored', columns(secondary.ZoteroPane.itemsView) === secondaryColumns);
    secondary.close(); secondary = undefined;

    // These are synthetic approved concepts only in the verified isolated profile, for visual QA.
    await app.invoke('scan', { scope: 'library' });
    app.state.taxonomyArchives.unshift({ id: 'native-v020-archive-' + stamp, date: new Date().toISOString(), version: app.state.vocabularyVersion,
      tags: JSON.parse(JSON.stringify(app.state.tags)), redirects: { ...app.state.taxonomyRedirects }, reason: 'Before synthetic native v0.2.0 visual-QA fixture' });
    app.state.tags = [...app.state.tags.filter(tag => tag.custom && !tag.id.startsWith('native-v020-')), ...changed];
    app.state.taxonomyReady = true; app.state.vocabularyVersion++; app.state.settings.autoAssign = false; app.state.pilotReviewed = false;
    await app.save(); staged = true;
    const navigator = Zotero.SmartTags.getNavigator(main); await navigator.refresh();
    if(oldTaxonomyReady){check('v020CollectionsChoiceSurvivesTaxonomyUpdate',navigator.mode==='collections');await navigator.setMode('tags');}
    check('v020MountedNavigatorDefaultsToApprovedTags', navigator.mode === 'tags' && !!main.document.getElementById('smart-tags-navigator'));
    return { fixtureItemIDs: items.map(item => item.id), pdfAttachmentID: attachment.id, noteID: note.id, annotationID: annotation.id, nativeQueryCases: cases.length,
      pdfEvidence: 'Real minimal PDF extracted and indexed through Zotero.Fulltext.indexItems; no synthetic fulltext database injection.' };
  } finally {
    for (const adapter of adapters) await adapter.destroy();
    if (secondary && !secondary.closed) secondary.close();
    Zotero.Prefs.set('search.quicksearch-mode', oldQuickSearchMode);
    if (!staged) { app.state.taxonomyReady = oldTaxonomyReady; await app.save(); }
  }
}
