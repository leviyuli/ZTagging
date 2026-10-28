import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, migrateState, validLegacyState, validState } from '../src/controller.ts';
import { paperFingerprint } from '../src/core.ts';
import type { Facet, PaperRecord, TagDefinition } from '../src/core.ts';
import { normalizeFacts } from '../src/taxonomy.ts';
import { validateSnapshotAgainstFacts } from '../src/evidence.ts';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const EIS = 'Electrochemical impedance spectroscopy';
function tag(id: string, name: string, fullName = name, facet: Facet = 'method', extra: Partial<TagDefinition> = {}): TagDefinition {
  return { id, name, fullName, description: `Scientific scope of ${fullName}.`, facet, aliases: [], inclusions: [], exclusions: [], examples: [],
    status: 'approved', custom: false, broaderIds: [], relatedIds: [], matchingMode: 'auto', ...extra };
}
function legacy(tags: TagDefinition[]) {
  const value = copy(initialState()) as any; value.schemaVersion = 2; value.tags = tags; value.taxonomyReady = true;
  delete value.evidenceCatalog; delete value.taxonomyEvidence; return value;
}
function addPaper(old: any, id: string, concepts: { name: string; facet?: Facet; quote?: string }[], abstract = `${EIS} measures transport resistance.`) {
  const paper: PaperRecord = { id, itemID: Object.keys(old.papers).length + 1, libraryID: 1, key: id, title: `Synthetic paper ${id}`, abstract, keywords: [], fingerprint: '' };
  paper.fingerprint = paperFingerprint(paper); old.papers[id] = paper; old.nativeTags[id] = [{ tag: 'Manual project', type: 0 }];
  const facts = normalizeFacts({ summary: 'A synthetic validated factual record.', concepts: concepts.map(concept => ({ name: concept.name, facet: concept.facet ?? 'method', evidence: [{ source: 'abstract', text: concept.quote ?? abstract }] })), needsPDF: false }, paper, 'deepseek', 'retained-model');
  for (const concept of facts.concepts) delete concept.factConceptId; old.facts[id] = facts; return paper;
}
function support(old: any, tagId: string, ids: string[], quotes: { paperId: string; text: string; source?: string }[] = []) {
  old.taxonomySupport[tagId] = { paperIds: ids, evidence: quotes.map(quote => ({ source: 'abstract', ...quote })) };
}

test('unique approved legacy support gains stable source IDs scoped to its original papers while exact legacy evidence remains retained', () => {
  const old = legacy([tag('eis', 'EIS', EIS)]); const paper = addPaper(old, 'selected', [{ name: EIS }]);
  addPaper(old, 'outside', [{ name: EIS }]); support(old, 'eis', ['selected'], [{ paperId: 'selected', text: paper.abstract }]);
  const before = JSON.stringify(old), originalSupport = copy(old.taxonomySupport), next = migrateState(old), linked = next.taxonomySupport.eis;
  assert.equal(validLegacyState(old), true); assert.equal(validState(next), true); assert.equal(JSON.stringify(old), before);
  assert.deepEqual(next.legacyTaxonomySupport, originalSupport); assert.deepEqual(linked.paperIds, ['selected']);
  assert.equal(linked.sourceIds!.length, 1); assert.equal(linked.registryIds!.length, 1);
  const source = next.taxonomyEvidence!.sources[linked.sourceIds![0]];
  assert.equal(source.name, EIS); assert.equal(source.provider, 'deepseek'); assert.equal(source.model, 'retained-model'); assert.equal(source.extractionVersion, 1);
  assert.deepEqual(source.evidence, old.facts.selected.concepts[0].evidence); assert.deepEqual(next.taxonomyEvidence!.paperIds, ['selected']);
  assert.ok(Object.values(next.taxonomyEvidence!.sources).every(source => source.paperId === 'selected'));
  assert.equal(Object.keys(next.evidenceCatalog.sources).length, 2, 'unselected cached evidence remains available without entering this support snapshot');
  assert.deepEqual(validateSnapshotAgainstFacts(next.taxonomyEvidence!, [next.facts.selected]), []);
  assert.deepEqual(next.legacySupportMigration!.convertedTagIds, ['eis']); assert.deepEqual(next.legacySupportMigration!.unresolved, []);
  assert.equal(next.taxonomyReview!.mappingConfirmations, undefined, 'migration does not invent scientific review confirmations');
  assert.equal(migrateState(next), next, 'the persisted migration is idempotent and does not allocate fresh identities');
});

test('ambiguous equivalent factual concepts remain unresolved instead of picking one by label', () => {
  const old = legacy([tag('eis', 'EIS', EIS)]); addPaper(old, 'paper', [{ name: 'EIS' }, { name: EIS }]); support(old, 'eis', ['paper']);
  const next = migrateState(old); assert.deepEqual(next.taxonomySupport, {}); assert.equal(next.taxonomyEvidence, null);
  assert.match(next.legacySupportMigration!.unresolved[0].reason, /Multiple validated factual concepts/);
  assert.deepEqual(next.legacyTaxonomySupport, old.taxonomySupport); assert.equal(next.facts.paper.concepts.length, 2);
});

test('invented quotations, mismatched old quotations, and stale retained fingerprints cannot produce migrated support', () => {
  for (const damage of ['invented-fact-quote', 'unmatched-old-quote', 'changed-source']) {
    const old = legacy([tag('eis', 'EIS', EIS)]); const paper = addPaper(old, 'paper', [{ name: EIS }]);
    support(old, 'eis', ['paper'], [{ paperId: 'paper', text: paper.abstract }]);
    if (damage === 'invented-fact-quote') old.facts.paper.concepts[0].evidence[0].text = 'An invented scientific finding.';
    if (damage === 'unmatched-old-quote') old.taxonomySupport.eis.evidence[0].text = 'An unrelated old support quotation.';
    if (damage === 'changed-source') old.papers.paper.abstract = 'The retained source changed after the legacy extraction.';
    const next = migrateState(old); assert.deepEqual(next.taxonomySupport, {}, damage); assert.equal(next.taxonomyEvidence, null, damage);
    assert.equal(next.legacySupportMigration!.unresolved.length, 1, damage); assert.deepEqual(next.legacyTaxonomySupport, old.taxonomySupport);
  }
});

test('finite technology terminology converts AEMWE variants without changing source wording or existing presentation labels', () => {
  const old = legacy([tag('aemwe', 'AEMWE', 'Anion-exchange membrane water electrolyzer', 'system')]);
  const wording = 'Anion exchange membrane water electrolyzers (AEMWEs)';
  addPaper(old, 'paper', [{ name: wording, facet: 'system' }], `${wording} are characterized experimentally.`); support(old, 'aemwe', ['paper']);
  const next = migrateState(old), source = next.taxonomyEvidence!.sources[next.taxonomySupport.aemwe.sourceIds![0]];
  assert.equal(source.name, wording); assert.equal(next.tags[0].name, 'AEMWE'); assert.equal(next.tags[0].fullName, old.tags[0].fullName);
  assert.deepEqual(next.taxonomySupport.aemwe.paperIds, ['paper']); assert.deepEqual(next.legacySupportMigration!.unresolved, []);
});

test('Co and CO retain separate evidence identities and contradictory preferred/full names cannot migrate', () => {
  const old = legacy([tag('cobalt', 'Co', 'cobalt', 'component'), tag('carbon-monoxide', 'CO', 'carbon monoxide', 'component')]);
  addPaper(old, 'paper', [{ name: 'Co', facet: 'component', quote: 'Co nanoparticles' }, { name: 'CO', facet: 'component', quote: 'CO into products.' }], 'Co nanoparticles catalyze the conversion of CO into products.');
  support(old, 'cobalt', ['paper'], [{ paperId: 'paper', text: 'Co nanoparticles' }]); support(old, 'carbon-monoxide', ['paper'], [{ paperId: 'paper', text: 'CO into products.' }]);
  const next = migrateState(old); assert.notEqual(next.taxonomySupport.cobalt.sourceIds![0], next.taxonomySupport['carbon-monoxide'].sourceIds![0]);
  assert.notEqual(next.taxonomySupport.cobalt.registryIds![0], next.taxonomySupport['carbon-monoxide'].registryIds![0]);
  const contradictory = copy(old); contradictory.tags = [tag('cobalt', 'Co', 'carbon monoxide', 'component')]; delete contradictory.taxonomySupport['carbon-monoxide'];
  const rejected = migrateState(contradictory); assert.deepEqual(rejected.taxonomySupport, {});
  assert.match(rejected.legacySupportMigration!.unresolved[0].reason, /different scientific concepts/);
});

test('arbitrary aliases and competing approved alias owners do not establish a migration mapping', () => {
  const aliasOnly = legacy([tag('eis', 'EIS', EIS, 'method', { aliases: ['battery cycling'] })]);
  addPaper(aliasOnly, 'paper', [{ name: 'battery cycling' }], 'Battery cycling is measured.'); support(aliasOnly, 'eis', ['paper']);
  assert.deepEqual(migrateState(aliasOnly).taxonomySupport, {});
  const competing = legacy([tag('eis', 'EIS', EIS), tag('other', 'Other method', 'Other method', 'method', { aliases: ['EIS'] })]);
  addPaper(competing, 'paper', [{ name: EIS }]); support(competing, 'eis', ['paper']);
  const next = migrateState(competing); assert.deepEqual(next.taxonomySupport, {}); assert.match(next.legacySupportMigration!.unresolved[0].reason, /multiple approved definitions/);
});

test('unknown acronyms cannot authorize unrelated meanings without a validated expanded scientific phrase', () => {
  const old = legacy([tag('ml', 'ML', 'machine learning')]);
  addPaper(old, 'paper', [{ name: 'ML' }], 'ML denotes mass loss measured during the experiment.'); support(old, 'ml', ['paper']);
  const uncertain = migrateState(old); assert.deepEqual(uncertain.taxonomySupport, {});
  assert.match(uncertain.legacySupportMigration!.unresolved[0].reason, /uncertain acronym|expanded scientific meaning/);
  assert.equal(uncertain.taxonomyReview?.mappingConfirmations, undefined);
  const reversed = copy(old); reversed.tags = [tag('ml', 'machine learning', 'ML')];
  assert.deepEqual(migrateState(reversed).taxonomySupport, {}, 'moving an uncertain acronym into fullName does not establish its scientific meaning');
  const substring = legacy([tag('ml', 'ML', 'machine learning')]);
  addPaper(substring, 'paper', [{ name: 'ML' }], 'The phrase machine learningness does not expand ML.'); support(substring, 'ml', ['paper']);
  assert.deepEqual(migrateState(substring).taxonomySupport, {}, 'an expanded phrase must have word boundaries');
  const supported = legacy([tag('ml', 'ML', 'machine learning')]);
  addPaper(supported, 'paper', [{ name: 'ML' }], 'Machine learning (ML) classifies the experimental transport data.'); support(supported, 'ml', ['paper']);
  assert.deepEqual(migrateState(supported).taxonomySupport.ml.paperIds, ['paper']);
});

test('approved subtype support expands by validated IDs while contextual components remain outside the parent concept', () => {
  const old = legacy([tag('fc', 'FC', 'fuel cell', 'system'), tag('pem', 'PEMFC', 'proton exchange membrane fuel cell', 'system', { broaderIds: ['fc'] }), tag('cl', 'CL', 'catalyst layer', 'component', { relatedIds: ['fc'] })]);
  const fuelCell = addPaper(old, 'fuel-cell', [{ name: 'proton exchange membrane fuel cell', facet: 'system' }], 'A proton exchange membrane fuel cell is characterized.');
  const component = addPaper(old, 'component', [{ name: 'catalyst layer', facet: 'component' }], 'A catalyst layer is characterized.');
  support(old, 'pem', ['fuel-cell'], [{ paperId: 'fuel-cell', text: fuelCell.abstract }]); support(old, 'cl', ['component'], [{ paperId: 'component', text: component.abstract }]);
  support(old, 'fc', ['fuel-cell', 'component'], [{ paperId: 'fuel-cell', text: fuelCell.abstract }, { paperId: 'component', text: component.abstract }]);
  const next = migrateState(old); assert.deepEqual(next.taxonomySupport.fc.paperIds, ['fuel-cell']);
  assert.deepEqual(next.taxonomySupport.fc.sourceIds, next.taxonomySupport.pem.sourceIds); assert.deepEqual(next.taxonomySupport.fc.registryIds, []);
  assert.ok(!next.taxonomySupport.fc.sourceIds!.includes(next.taxonomySupport.cl.sourceIds![0]));
  assert.ok(next.legacySupportMigration!.unresolved.some(issue => issue.tagId === 'fc' && issue.paperId === 'component'));
  assert.ok(!next.legacySupportMigration!.unresolved.some(issue => issue.tagId === 'fc' && issue.paperId === 'fuel-cell'));
  assert.deepEqual(validateSnapshotAgainstFacts(next.taxonomyEvidence!, Object.values(next.facts)), []);
});
