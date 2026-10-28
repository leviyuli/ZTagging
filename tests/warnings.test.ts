import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissWarnings, migrateLegacyWarnings, resolveWarnings, upsertWarning, validWarningRecord, recordWarningNotice, updateTopicWarnings, migrateWarningEpisodes } from '../src/warnings.ts';
import type { WarningInput, WarningRecord } from '../src/warnings.ts';

const observed = '2026-10-28T10:00:00.000Z';
function input(overrides: Partial<WarningInput> = {}): WarningInput {
  return { code: 'evidence-gap', message: 'No readable PDF evidence.', paperIds: ['1:PAPER'],
    runIds: ['run-1'], context: 'extract-facts', conditionFingerprint: 'metadata-1/pdf-none', now: observed, ...overrides };
}

test('warning observations are immutable, deduplicated by condition, and preserve processing associations', () => {
  const first = upsertWarning([], input()), frozen = JSON.stringify(first);
  const second = upsertWarning(first, input({ paperIds: ['1:PAPER', '1:PAPER'], runIds: ['run-2'], now: '2026-10-28T11:00:00.000Z' }));
  assert.equal(second.length, 1); assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].firstSeenAt, observed); assert.equal(second[0].lastSeenAt, '2026-10-28T11:00:00.000Z');
  assert.equal(second[0].occurrenceCount, 2); assert.deepEqual(second[0].runIds, ['run-1', 'run-2']);
  assert.equal(JSON.stringify(first), frozen, 'helpers never mutate a persisted generation');
});

test('dismissal survives serialization, restart, and unchanged observations in another run', () => {
  let records = upsertWarning([], input()); const id = records[0].id;
  records = dismissWarnings(records, [id]);
  records = JSON.parse(JSON.stringify(records));
  records = upsertWarning(records, input({ runIds: ['run-after-restart'] }));
  assert.equal(records.length, 1); assert.equal(records[0].id, id);
  assert.equal(records[0].status, 'dismissed'); assert.equal(records[0].occurrenceCount, 2);
  assert.ok(records[0].runIds.includes('run-after-restart'));
});

test('a changed condition and recurrence after successful reevaluation create new active episodes', () => {
  let records = dismissWarnings(upsertWarning([], input()));
  records = upsertWarning(records, input({ conditionFingerprint: 'metadata-2/pdf-unreadable' }));
  assert.equal(records.length, 2); assert.equal(records[0].status, 'dismissed'); assert.equal(records[1].status, 'active');
  const currentId = records[1].id;
  records = resolveWarnings(records, { code: 'evidence-gap', context: 'extract-facts', paperIds: ['1:PAPER'], conditionFingerprint: 'metadata-2/pdf-unreadable' });
  assert.equal(records[1].status, 'resolved');
  records = upsertWarning(records, input({ conditionFingerprint: 'metadata-2/pdf-unreadable' }));
  assert.equal(records.length, 3); assert.equal(records[2].status, 'active'); assert.notEqual(records[2].id, currentId);
  assert.equal(records[2].occurrenceCount, 1);
});

test('a changed fingerprint supersedes the old active episode without claiming successful reevaluation', () => {
  const original = upsertWarning([], input())[0], before = JSON.stringify(original);
  let records = upsertWarning([original], input({ conditionFingerprint: 'metadata-changed', runIds: ['run-2'], now: '2026-10-28T11:00:00.000Z' }));
  assert.equal(records.filter(record => record.status === 'active').length, 1);
  assert.equal(records[0].status, 'dismissed'); assert.equal(records[0].supersededBy, records[1].id);
  assert.deepEqual({ ...records[0], status: 'active', supersededBy: undefined }, { ...original, supersededBy: undefined });
  assert.equal(JSON.stringify(original), before);
  records = upsertWarning(records, input());
  assert.equal(records.length, 3, 'a previously superseded fingerprint returning is a new episode');
  assert.equal(records[2].status, 'active'); assert.notEqual(records[2].id, original.id);
  assert.equal(records[1].supersededBy, records[2].id);
});

test('successful reevaluation resolves only the same condition, paper set, and processing phase', () => {
  let records: WarningRecord[] = [];
  for (const change of [{}, { context: 'assign-tags' }, { paperIds: ['1:OTHER'] }, { code: 'other-gap' }]) records = upsertWarning(records, input(change));
  const result = resolveWarnings(records, { code: 'evidence-gap', context: 'extract-facts', paperIds: ['1:PAPER'], conditionFingerprint: 'metadata-1/pdf-none' });
  assert.deepEqual(result.map(record => record.status), ['resolved', 'active', 'active', 'active']);
  assert.deepEqual(resolveWarnings(records, {}).map(record => record.status), ['active', 'active', 'active', 'active']);
});

test('reevaluating one paper cannot resolve a combined affected-paper condition', () => {
  const records = upsertWarning([], input({ paperIds: ['1:A', '1:B'] }));
  assert.equal(resolveWarnings(records, { code: 'evidence-gap', context: 'extract-facts', paperIds: ['1:A'] })[0].status, 'active');
  assert.equal(resolveWarnings(records, { code: 'evidence-gap', context: 'extract-facts', paperIds: ['1:B', '1:A'] })[0].status, 'resolved');
});

test('Dismiss all preserves history and has no twenty-warning truncation', () => {
  let records: WarningRecord[] = [];
  for (let i = 0; i < 61; i++) records = upsertWarning(records, input({ paperIds: [`1:P${i}`] }));
  assert.equal(records.filter(record => record.status === 'active').length, 61);
  const one = dismissWarnings(records, [records[30].id]);
  assert.equal(one.filter(record => record.status === 'active').length, 60);
  const all = dismissWarnings(one);
  assert.equal(all.length, 61); assert.ok(all.every(record => record.status === 'dismissed'));
  assert.equal(records.filter(record => record.status === 'active').length, 61);
});

test('legacy warnings remain explicitly unverified with no invented occurrence dates, counts, or papers', () => {
  const records = migrateLegacyWarnings(['Old PDF warning', 'Another old warning'], observed);
  assert.equal(records.length, 2); assert.notEqual(records[0].id, records[1].id);
  for (const record of records) {
    assert.equal(record.legacy, true); assert.equal(record.code, 'legacy-unverified');
    assert.equal(record.context, 'historical-unverified'); assert.equal(record.status, 'dismissed');
    assert.equal(record.firstSeenAt, null); assert.equal(record.lastSeenAt, null); assert.equal(record.occurrenceCount, null);
    assert.deepEqual(record.paperIds, []); assert.deepEqual(record.runIds, []); assert.equal(record.importedAt, observed);
    assert.equal(validWarningRecord(record), true);
  }
  assert.deepEqual(resolveWarnings(records, { code: 'legacy-unverified' }), records, 'unverified notices cannot be resolved through unrelated new work');
});

test('rendering or filtering warnings does not change persisted observations or counts', () => {
  const records = upsertWarning([], input()), before = JSON.stringify(records);
  for (let i = 0; i < 10; i++) records.filter(record => record.status === 'active').map(record => record.message);
  assert.equal(JSON.stringify(records), before); assert.equal(records[0].occurrenceCount, 1);
});

test('warning schema rejects malformed associations, statuses, and invented invalid counts', () => {
  const record = upsertWarning([], input())[0]; assert.equal(validWarningRecord(record), true);
  for (const override of [{ paperIds: [1] }, { status: 'hidden' }, { occurrenceCount: 0 }, { firstSeenAt: 'unknown' }, { id: '' }]) {
    assert.equal(validWarningRecord({ ...record, ...override }), false);
  }
});

test('completed merge reviews enter history immediately without creating active banners',()=>{
  const records=recordWarningNotice([],{code:'merge-review-notice',message:'Discarded invalid merge suggestions after review.',context:'taxonomy-review',conditionFingerprint:'proposal-one',now:observed});
  assert.equal(records.length,1);assert.equal(records[0].status,'resolved');assert.equal(records[0].firstSeenAt,observed);assert.equal(records[0].occurrenceCount,1);
  const existing=upsertWarning([],{code:'merge-review-notice',message:'Completed merge review.',context:'application',conditionFingerprint:'old-notice',now:observed});
  const migrated=migrateWarningEpisodes(existing);assert.equal(migrated[0].status,'resolved');assert.equal(migrated[0].firstSeenAt,observed);assert.equal(existing[0].status,'active');
});

test('unapproved topics resolve only after successful reevaluation of that paper and assignment phase',()=>{
  const details={paperId:'paper-one',runId:'run-one',context:'assignment:core',conditionFingerprint:'input-one',topics:['Co topic'],now:observed};
  let records=updateTopicWarnings([],details);records=updateTopicWarnings(records,{...details,paperId:'paper-two'});records=updateTopicWarnings(records,{...details,context:'assignment:detail'});
  records=updateTopicWarnings(records,{...details,topics:[]});assert.deepEqual(records.map(record=>record.status),['resolved','active','active']);
  assert.deepEqual(records[0].paperIds,['paper-one']);assert.deepEqual(records[0].runIds,['run-one']);
});

test('topic dismissal survives restart and changed topic conditions can create a new episode',()=>{
  const details={paperId:'paper',context:'assignment:core',conditionFingerprint:'same-paper',topics:['topic one'],now:observed};
  let records=dismissWarnings(updateTopicWarnings([],details)),first=records[0].id;records=JSON.parse(JSON.stringify(records));
  records=updateTopicWarnings(records,{...details,runId:'later-run'});assert.equal(records.length,1);assert.equal(records[0].status,'dismissed');assert.equal(records[0].id,first);
  records=updateTopicWarnings(records,{...details,topics:['topic two']});assert.equal(records.length,2);assert.equal(records[1].status,'active');assert.notEqual(records[1].id,first);
});
