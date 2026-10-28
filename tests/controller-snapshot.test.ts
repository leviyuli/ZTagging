import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController, initialState } from '../src/controller.ts';
import type { AppState, ControllerEnvironment } from '../src/controller.ts';
import type { PaperRecord, TagDefinition } from '../src/core.ts';
import type { NativeTag } from '../src/platform.ts';
import { compileConceptFilter, matchCompiledConceptFilter } from '../src/concept-filter.ts';

function tag(id: string, name: string, extra: Partial<TagDefinition> = {}): TagDefinition {
  return { id, name, fullName: name, description: `Definition of ${name}.`, facet: 'system', aliases: [], inclusions: [], exclusions: [], examples: [],
    custom: false, status: 'approved', broaderIds: [], relatedIds: [], matchingMode: 'auto', ...extra };
}
function paper(id: string, itemID = 1): PaperRecord { return { id, itemID, libraryID: 1, key: id, title: `Synthetic paper ${id}`, abstract: '', keywords: [], fingerprint: id }; }
function harness(state: AppState, library?: () => Promise<{ papers: PaperRecord[]; nativeTags: Record<string, NativeTag[]> }>) {
  const env = { host: {}, ai: { hasApiKey: async () => false, getSession: async () => ({ connected: false, sharing: false, email: null, accountId: null, accounts: [] }) },
    persist: async () => { throw new Error('A snapshot must not persist changes'); }, ...(library ? { librarySnapshot: library } : {}) } as ControllerEnvironment;
  return new AppController(state, env);
}
function expected(state: AppState, native: Record<string, NativeTag[]>, id: string) {
  const compiled = compileConceptFilter(state.tags, { mode: 'all', selections: [{ conceptId: id }] });
  return Object.entries(native).filter(([, names]) => matchCompiledConceptFilter(names.map(value => value.tag), compiled)).map(([paperId]) => paperId);
}

test('snapshot indexed counts exactly retain approved descendant, legacy alias, shared-detail, and chemical-symbol filter meanings', async () => {
  const state = initialState(); state.tags = [tag('fc', 'FC', { aliases: ['fuel cell'] }), tag('aem', 'AEMFC', { broaderIds: ['fc'], aliases: ['anion exchange membrane fuel cell'] }),
    tag('pem', 'PEMFC', { broaderIds: ['fc'] }), tag('rcl', 'RCL', { custom: true, facet: 'phenomenon', relatedIds: ['fc'], broaderIds: ['fc'] }),
    tag('cobalt', 'Co', { facet: 'component' }), tag('carbon-monoxide', 'CO', { facet: 'component' }), tag('draft', 'Unapproved concept', { status: 'draft' })];
  state.nativeTags = { first: [{ tag: 'anion exchange membrane fuel cell', type: 1 }, { tag: 'AEMFC', type: 0 }, { tag: 'RCL', type: 0 }],
    second: [{ tag: 'FC', type: 0 }], third: [{ tag: 'PEMFC', type: 0 }], fourth: [{ tag: 'Co', type: 0 }],
    fifth: [{ tag: 'CO', type: 0 }], sixth: [{ tag: 'RCL', type: 0 }], seventh: [{ tag: 'Unapproved concept', type: 0 }] };
  for (const id of Object.keys(state.nativeTags)) state.papers[id] = paper(id);
  const controller = harness(state), snapshot = await controller.snapshot();
  for (const definition of state.tags) {
    const found = snapshot.tags.find(value => value.id === definition.id)!; const matches = expected(state, state.nativeTags, definition.id);
    assert.equal(found.currentlyTaggedCount, matches.length, definition.id); assert.deepEqual(found.representativePaperIds, matches.slice(0, 3), definition.id);
  }
  assert.equal(snapshot.tags.find(value => value.id === 'fc')!.currentlyTaggedCount, 3);
  assert.equal(snapshot.tags.find(value => value.id === 'rcl')!.currentlyTaggedCount, 2, 'a shared detail counts globally rather than inheriting an FC context');
  assert.equal(snapshot.tags.find(value => value.id === 'cobalt')!.currentlyTaggedCount, 1);
  assert.equal(snapshot.tags.find(value => value.id === 'carbon-monoxide')!.currentlyTaggedCount, 1);
  assert.equal(snapshot.tags.find(value => value.id === 'draft')!.currentlyTaggedCount, 0);
});

test('snapshot representatives preserve native paper order across different aliases and then use proposed support as fallback', async () => {
  const state = initialState(); state.tags = [tag('fc', 'FC', { aliases: ['fuel cell'] })];
  state.nativeTags = { first: [{ tag: 'fuel cell', type: 0 }], second: [{ tag: 'FC', type: 0 }], third: [{ tag: 'fuel cell', type: 1 }], fourth: [{ tag: 'FC', type: 0 }] };
  state.taxonomySupport.fc = { paperIds: ['support-only', 'first'] };
  const controller = harness(state);
  let snapshot = await controller.snapshot(); assert.deepEqual(snapshot.tags[0].representativePaperIds, ['first', 'second', 'third']);
  delete state.nativeTags.third; delete state.nativeTags.fourth;
  snapshot = await controller.snapshot(); assert.deepEqual(snapshot.tags[0].representativePaperIds, ['first', 'second', 'support-only']);
});

test('every snapshot rebuilds its local index after native tags, definitions, or hierarchy changes', async () => {
  const state = initialState(); state.tags = [tag('fc', 'FC'), tag('aem', 'AEMFC', { broaderIds: ['fc'] })];
  state.nativeTags = { one: [{ tag: 'AEMFC', type: 0 }] }; const controller = harness(state);
  let snapshot = await controller.snapshot(); assert.equal(snapshot.tags[0].currentlyTaggedCount, 1);
  state.nativeTags.one = [{ tag: 'manual legacy name', type: 0 }]; snapshot = await controller.snapshot(); assert.equal(snapshot.tags[0].currentlyTaggedCount, 0);
  state.tags[1].aliases.push('manual legacy name'); snapshot = await controller.snapshot(); assert.equal(snapshot.tags[0].currentlyTaggedCount, 1);
  state.tags[1].broaderIds = []; snapshot = await controller.snapshot(); assert.equal(snapshot.tags[0].currentlyTaggedCount, 0); assert.equal(snapshot.tags[1].currentlyTaggedCount, 1);
  state.tags[1].status = 'draft'; snapshot = await controller.snapshot(); assert.equal(snapshot.tags[1].currentlyTaggedCount, 0);
});

test('large library snapshot canonicalizes each native assignment once for coverage and covers papers outside the pilot index', async () => {
  const state = initialState(); state.tags = Array.from({ length: 60 }, (_, i) => tag(`tag-${i}`, `concept ${i}`)); state.papers.pilot = paper('pilot');
  let reads = 0; const native: Record<string, NativeTag[]> = {}, papers: PaperRecord[] = [];
  for (let i = 0; i < 945; i++) {
    const id = `library-${i}`; papers.push(paper(id, i + 1));
    native[id] = [{ get tag() { reads++; return `concept ${i % 60}`; }, type: 0 }, { get tag() { reads++; return 'Other native tag'; }, type: 0 }];
  }
  let libraryCalls = 0; const controller = harness(state, async () => { libraryCalls++; return { papers, nativeTags: native }; });
  const snapshot = await controller.snapshot();
  assert.equal(snapshot.papers.length, 945); assert.equal(snapshot.tags[0].currentlyTaggedCount, 16);
  assert.equal(snapshot.tags[59].currentlyTaggedCount, 15); assert.equal(libraryCalls, 1);
  assert.equal(reads, 945 * 2 * 2, 'each assignment is read once for coverage and once for displayed native tags, independent of definition count');
  native['library-0'] = [{ tag: 'concept 59', type: 0 }];
  const refreshed = await controller.snapshot(); assert.equal(refreshed.tags[0].currentlyTaggedCount, 15); assert.equal(refreshed.tags[59].currentlyTaggedCount, 16); assert.equal(libraryCalls, 2);
});

test('draft-only snapshots skip coverage work without reading every native assignment per definition', async () => {
  const state = initialState(); state.tags = Array.from({ length: 107 }, (_, i) => tag(`draft-${i}`, `Draft ${i}`, { status: 'draft' }));
  state.papers.one = paper('one'); let reads = 0;
  state.nativeTags.one = [{ get tag() { reads++; return 'Draft 1'; }, type: 0 }];
  const snapshot = await harness(state).snapshot();
  assert.ok(snapshot.tags.every(value => value.currentlyTaggedCount === 0)); assert.equal(reads, 1, 'only native-tag display reads the assignment');
});
