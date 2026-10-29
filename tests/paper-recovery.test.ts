import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetadataPreview, classifyPaperAttention, extractPaperIdentifiers, parsePaperIdentifier, reverseMetadataPatch, sameMetadata } from '../src/paper-recovery.ts';
import type { MetadataSnapshot, PaperInputAssessment, PDFInputStatus } from '../src/paper-recovery.ts';

function assessment(status: PDFInputStatus = 'readable'): PaperInputAssessment {
  return { paperId: '1:RECOVERY', itemID: 1, checkedAt: '2026-10-29T00:00:00.000Z', metadata: { title: true, abstract: true, keywords: false }, pdf: { status, attachmentCount: status === 'missing' ? 0 : 1, localCount: status === 'readable' ? 1 : 0, characters: status === 'readable' ? 800 : 0, rechecked: false } };
}
function metadata(): MetadataSnapshot {
  return { paperId: '1:RECOVERY', itemID: 1, itemType: 'journalArticle', fields: { title: 'Researcher title', abstractNote: '', DOI: '10.1234/example', date: '', publicationTitle: '' }, creators: [], identifiers: [{ kind: 'DOI', value: '10.1234/example' }] };
}

test('validated concepts stay usable when the provider requested more context, including a missing PDF', () => {
  for (const status of ['readable', 'missing', 'nonlocal', 'readError'] as const) {
    const result = classifyPaperAttention(assessment(status), { validatedConcepts: 9, needsPDF: true });
    assert.equal(result.status, 'usable'); assert.equal(result.reason, 'additionalContext');
    assert.match(result.message, /9 supported findings.*usable/);
    assert.doesNotMatch(result.message, /insufficient|confidence|failed/i);
  }
  assert.equal(classifyPaperAttention(assessment(), { validatedConcepts: 1, needsPDF: false }).reason, 'validatedEvidence');
});

test('attention describes observed input conditions without claiming OCR, confidence, or missing metadata', () => {
  const expected = { nonlocal: 'pdfNotLocal', textUnavailable: 'pdfTextUnavailable', readError: 'pdfReadError', unknown: 'inputsUnverified', readable: 'noValidatedConcepts', missing: 'noValidatedConcepts' };
  for (const [status, reason] of Object.entries(expected)) {
    const result = classifyPaperAttention(assessment(status as PDFInputStatus), { validatedConcepts: 0, needsPDF: true });
    assert.equal(result.status, 'needsAttention'); assert.equal(result.reason, reason);
    assert.doesNotMatch(result.message, /scanned|OCR|confidence|abstract.*missing/i);
  }
  const absent = assessment('missing'); absent.metadata = { title: false, abstract: false, keywords: false };
  const result = classifyPaperAttention(absent, { validatedConcepts: 0, needsPDF: false });
  assert.equal(result.reason, 'missingEvidence'); assert.equal(result.canRetry, false); assert.equal(result.canLookupMetadata, true);
});

test('identifier normalization validates DOI, PMID, ISBN checksums, and versioned arXiv forms', () => {
  assert.deepEqual(parsePaperIdentifier('https://doi.org/10.1234/Example'), { kind: 'DOI', value: '10.1234/example' });
  assert.deepEqual(parsePaperIdentifier('PMID: 12345678'), { kind: 'PMID', value: '12345678' });
  assert.deepEqual(parsePaperIdentifier('ISBN-13: 978-0-306-40615-7'), { kind: 'ISBN', value: '9780306406157' });
  assert.deepEqual(parsePaperIdentifier('0-306-40615-2'), { kind: 'ISBN', value: '0306406152' });
  assert.equal(parsePaperIdentifier('9780306406158'), undefined);
  assert.deepEqual(parsePaperIdentifier('https://arxiv.org/pdf/2401.01234v2.pdf'), { kind: 'arXiv', value: '2401.01234' });
  assert.deepEqual(parsePaperIdentifier('arXiv: hep-th/9901001v3'), { kind: 'arXiv', value: 'hep-th/9901001' });
  assert.equal(parsePaperIdentifier('a title with 12345678 in it'), undefined);
  assert.equal(parsePaperIdentifier({ kind: 'PMID', value: '10.1234/example' }), undefined);
});

test('identifiers come from explicit bibliographic data and are deduplicated across equivalent ISBNs', () => {
  assert.deepEqual(extractPaperIdentifiers({ DOI: '10.1234/example', title: 'PMID: 999', extra: 'Research note\nPMID: 12345678', url: 'https://doi.org/10.1234/example' }), [{ kind: 'DOI', value: '10.1234/example' }, { kind: 'PMID', value: '12345678' }]);
  assert.equal(extractPaperIdentifiers({ ISBN: '0306406152', extra: 'ISBN: 9780306406157' }).length, 1);
  assert.ok(extractPaperIdentifiers({ DOI: '10.48550/arXiv.2401.01234' }).some(identifier => identifier.kind === 'arXiv' && identifier.value === '2401.01234'));
});

test('a matching metadata preview fills only empty allowed fields and preserves existing choices', () => {
  const before = metadata(), original = JSON.stringify(before);
  const result = buildMetadataPreview(before, [{ DOI: '10.1234/EXAMPLE', title: 'Translator title', abstractNote: 'Verified abstract', date: '2026', publicationTitle: 'Journal', creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Example' }], extra: 'arbitrary notes', tags: ['AI label'], collections: ['folder'], itemType: 'book', dateAdded: '1900' }]);
  assert.equal(result.status, 'ready'); assert.ok(result.patch);
  assert.equal(result.patch.after.fields.title, 'Researcher title'); assert.equal(result.patch.after.itemType, 'journalArticle');
  assert.equal(result.patch.after.fields.abstractNote, 'Verified abstract');
  assert.deepEqual(result.changes.map(change => change.field), ['abstractNote', 'date', 'publicationTitle', 'creators']);
  assert.deepEqual(result.patch.after.creators, [{ creatorType: 'author', firstName: 'Ada', lastName: 'Example' }]);
  assert.equal(Object.hasOwn(result.patch.after.fields, 'extra'), false); assert.equal(JSON.stringify(before), original);
});

test('metadata results require identifier confirmation and reject ambiguous or conflicting matches', () => {
  const before = metadata();
  assert.equal(buildMetadataPreview({ ...before, identifiers: [] }, []).status, 'noIdentifier');
  assert.equal(buildMetadataPreview(before, []).status, 'notFound');
  assert.equal(buildMetadataPreview(before, [{ abstractNote: 'Unidentified abstract' }]).status, 'mismatch');
  assert.equal(buildMetadataPreview(before, [{ DOI: '10.1234/other', abstractNote: 'Wrong abstract' }]).status, 'mismatch');
  assert.equal(buildMetadataPreview(before, [{ DOI: '10.1234/example' }, { DOI: '10.1234/example' }]).status, 'ambiguous');
  assert.equal(buildMetadataPreview(before, [{ DOI: '10.1234/other', abstractNote: 'Different paper' }], '10.1234/other').status, 'mismatch');
  assert.equal(buildMetadataPreview(before, [{ DOI: '10.1234/example', PMID: '12345678', abstractNote: 'Other paper' }], 'PMID: 12345678').status, 'ready');
  before.identifiers.push({ kind: 'PMID', value: '87654321' });
  assert.equal(buildMetadataPreview(before, [{ DOI: '10.1234/example', PMID: '12345678', abstractNote: 'Other paper' }]).status, 'mismatch');
});

test('creator choices are never augmented or overwritten and equivalent ISBN results are accepted', () => {
  const before = metadata(); before.creators = [{ creatorType: 'author', name: 'Researcher Group' }];
  const result = buildMetadataPreview(before, [{ DOI: '10.1234/example', creators: [{ creatorType: 'author', name: 'Other Group' }] }]);
  assert.equal(result.status, 'unchanged'); assert.equal(result.patch, undefined);
  before.identifiers = [{ kind: 'ISBN', value: '0306406152' }]; before.fields.ISBN = '0306406152'; delete before.fields.DOI;
  assert.equal(buildMetadataPreview(before, [{ ISBN: '9780306406157', abstractNote: 'Book abstract' }]).status, 'ready');
});

test('metadata snapshots compare exact fields and creator order, and inverse patches retain independent snapshots', () => {
  const before = metadata(), preview = buildMetadataPreview(before, [{ DOI: '10.1234/example', abstractNote: 'New abstract' }]);
  const patch = preview.patch!;
  assert.equal(sameMetadata(before, patch.before), true); assert.equal(sameMetadata(before, patch.after), false);
  assert.equal(sameMetadata(before, { ...before, itemType: 'book' }), false);
  const reverse = reverseMetadataPatch(patch);
  assert.equal(sameMetadata(reverse.before, patch.after), true); assert.equal(sameMetadata(reverse.after, patch.before), true);
  reverse.after.fields.title = 'Changed elsewhere'; assert.equal(patch.before.fields.title, 'Researcher title');
  const authors = [{ creatorType: 'author', name: 'A' }, { creatorType: 'author', name: 'B' }];
  assert.equal(sameMetadata({ ...before, creators: authors }, { ...before, creators: [...authors].reverse() }), false);
});
