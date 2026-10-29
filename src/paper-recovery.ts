export type PDFInputStatus = 'missing' | 'nonlocal' | 'readable' | 'textUnavailable' | 'readError' | 'unknown';
export interface PaperInputAssessment {
  paperId: string;
  itemID: number;
  checkedAt: string;
  metadata: { title: boolean; abstract: boolean; keywords: boolean };
  pdf: { status: PDFInputStatus; attachmentCount: number; localCount: number; characters: number; rechecked: boolean };
}
export interface PaperAttention {
  status: 'usable' | 'needsAttention';
  reason: string;
  message: string;
  canLookupMetadata: boolean;
  canRecheck: boolean;
  canRetry: boolean;
}

export function classifyPaperAttention(assessment: PaperInputAssessment, facts: { validatedConcepts: number; needsPDF: boolean }): PaperAttention {
  const available = assessment.metadata.title || assessment.metadata.abstract || assessment.metadata.keywords || assessment.pdf.status === 'readable';
  const actions = { canLookupMetadata: !assessment.metadata.title || !assessment.metadata.abstract, canRecheck: true, canRetry: available };
  if (facts.validatedConcepts > 0) return {
    ...actions, status: 'usable', reason: facts.needsPDF ? 'additionalContext' : 'validatedEvidence',
    message: `${facts.validatedConcepts} supported ${facts.validatedConcepts === 1 ? 'finding is' : 'findings are'} available for building tags.${facts.needsPDF ? ' More context may help, but these results are usable.' : ''}`,
  };
  const reason = assessment.pdf.status === 'nonlocal' ? 'pdfNotLocal'
    : assessment.pdf.status === 'textUnavailable' ? 'pdfTextUnavailable'
    : assessment.pdf.status === 'readError' ? 'pdfReadError'
    : assessment.pdf.status === 'unknown' ? 'inputsUnverified'
    : !assessment.metadata.abstract && assessment.pdf.status === 'missing' ? 'missingEvidence' : 'noValidatedConcepts';
  const messages: Record<string, string> = {
    pdfNotLocal: 'Download the attached PDF in Zotero, then recheck its text or retry analysis.',
    pdfTextUnavailable: 'The local PDF has no readable text. Check the PDF or find missing metadata before retrying.',
    pdfReadError: 'Zotero could not read the attached PDF. Open it to check the file, then recheck its text.',
    inputsUnverified: 'Check whether a local PDF is available, or find missing metadata before retrying.',
    missingEvidence: 'The abstract and a PDF attachment are missing. Find metadata or add a PDF before retrying.',
    noValidatedConcepts: 'The available information did not support useful tags. Check the paper information before retrying analysis.',
  };
  return { ...actions, status: 'needsAttention', reason, message: messages[reason] };
}

export type IdentifierKind = 'DOI' | 'PMID' | 'ISBN' | 'arXiv';
export interface PaperIdentifier { kind: IdentifierKind; value: string }
export interface MetadataCreator { creatorType: string; firstName?: string; lastName?: string; name?: string }
export interface MetadataSnapshot {
  paperId: string;
  itemID: number;
  itemType: string;
  fields: Record<string, string>;
  creators: MetadataCreator[];
  identifiers: PaperIdentifier[];
}
export interface MetadataPatch { paperId: string; itemID: number; before: MetadataSnapshot; after: MetadataSnapshot }
export interface MetadataPreview {
  paperId: string;
  itemID: number;
  status: 'ready' | 'noIdentifier' | 'notFound' | 'mismatch' | 'ambiguous' | 'unchanged';
  identifier?: PaperIdentifier;
  message: string;
  patch?: MetadataPatch;
  changes: { field: string; before: string; after: string }[];
}

export const METADATA_FIELDS = [
  'title', 'abstractNote', 'publicationTitle', 'date', 'volume', 'issue', 'pages', 'DOI', 'ISBN', 'ISSN',
  'url', 'language', 'shortTitle', 'publisher', 'place', 'edition', 'series', 'seriesTitle', 'seriesText',
  'numPages', 'numberOfVolumes', 'journalAbbreviation', 'archive', 'archiveLocation', 'libraryCatalog', 'callNumber',
] as const;
const allowedFields = new Set<string>(METADATA_FIELDS);
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function isbn(value: string): string | undefined {
  const normalized = value.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(normalized)) {
    const sum = [...normalized].reduce((total, character, index) => total + (character === 'X' ? 10 : Number(character)) * (10 - index), 0);
    return sum % 11 === 0 ? normalized : undefined;
  }
  if (/^97[89]\d{10}$/.test(normalized)) {
    const sum = [...normalized].reduce((total, character, index) => total + Number(character) * (index % 2 ? 3 : 1), 0);
    return sum % 10 === 0 ? normalized : undefined;
  }
  return undefined;
}

export function parsePaperIdentifier(input: string | PaperIdentifier): PaperIdentifier | undefined {
  const expected = typeof input === 'string' ? undefined : input.kind;
  let value = typeof input === 'string' ? input.trim() : input.value.trim();
  try { value = decodeURIComponent(value); } catch { return undefined; }
  const doi = value.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)/i, '');
  if ((!expected || expected === 'DOI') && /^10\.\d{4,9}\/[^\s]+$/i.test(doi)) return { kind: 'DOI', value: doi.toLowerCase() };
  const book = isbn(value.replace(/^ISBN(?:-1[03])?\s*:\s*/i, ''));
  if ((!expected || expected === 'ISBN') && book) return { kind: 'ISBN', value: book };
  const arxiv = value.replace(/^(?:https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/|arxiv\s*:\s*)/i, '').replace(/\.pdf$/i, '');
  if ((!expected || expected === 'arXiv') && /^(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]*\/\d{7})(?:v\d+)?$/i.test(arxiv)) return { kind: 'arXiv', value: arxiv.replace(/v\d+$/i, '').toLowerCase() };
  const pmid = value.replace(/^(?:PMID\s*:\s*|https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)/i, '').replace(/\/$/, '');
  if ((!expected || expected === 'PMID') && /^[1-9]\d{0,8}$/.test(pmid)) return { kind: 'PMID', value: pmid };
  return undefined;
}

function identifierKey(identifier: PaperIdentifier): string {
  if (identifier.kind !== 'ISBN' || identifier.value.length !== 10) return `${identifier.kind}:${identifier.value}`;
  const base = `978${identifier.value.slice(0, 9)}`;
  const sum = [...base].reduce((total, character, index) => total + Number(character) * (index % 2 ? 3 : 1), 0);
  return `ISBN:${base}${(10 - sum % 10) % 10}`;
}

export function extractPaperIdentifiers(fields: Record<string, unknown>): PaperIdentifier[] {
  const inputs: (string | PaperIdentifier)[] = [];
  for (const kind of ['DOI', 'PMID', 'ISBN', 'arXiv'] as const) if (text(fields[kind])) inputs.push({ kind, value: text(fields[kind]) });
  if (text(fields.url)) inputs.push(text(fields.url));
  for (const line of text(fields.extra).split(/\r?\n/)) if (/^\s*(?:DOI|PMID|ISBN|arXiv)\s*:/i.test(line)) inputs.push(line);
  if (text(fields.archive).toLowerCase() === 'arxiv' && text(fields.archiveLocation)) inputs.push({ kind: 'arXiv', value: text(fields.archiveLocation) });
  const result = new Map<string, PaperIdentifier>();
  for (const input of inputs) {
    const identifier = parsePaperIdentifier(input);
    if (identifier) {
      result.set(identifierKey(identifier), identifier);
      if (identifier.kind === 'DOI' && identifier.value.startsWith('10.48550/arxiv.')) {
        const equivalent = parsePaperIdentifier({ kind: 'arXiv', value: identifier.value.slice('10.48550/arxiv.'.length) });
        if (equivalent) result.set(identifierKey(equivalent), equivalent);
      }
    }
  }
  return [...result.values()];
}

export function normalizeMetadataCreators(value: unknown): MetadataCreator[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<MetadataCreator>(entry => {
    const creator = object(entry), creatorType = text(creator?.creatorType);
    if (!creatorType) return [];
    const firstName = text(creator?.firstName), lastName = text(creator?.lastName);
    const name = text(creator?.name) || (creator?.fieldMode === 1 ? lastName || firstName : '');
    return name ? [{ creatorType, name }] : firstName || lastName ? [{ creatorType, firstName, lastName }] : [];
  });
}

export function sameMetadata(left: MetadataSnapshot, right: MetadataSnapshot): boolean {
  if (left.paperId !== right.paperId || left.itemID !== right.itemID || left.itemType !== right.itemType) return false;
  const fields = new Set([...Object.keys(left.fields), ...Object.keys(right.fields)]);
  return [...fields].every(field => (left.fields[field] ?? '') === (right.fields[field] ?? '')) && JSON.stringify(left.creators) === JSON.stringify(right.creators);
}

export function reverseMetadataPatch(patch: MetadataPatch): MetadataPatch {
  return { paperId: patch.paperId, itemID: patch.itemID, before: copy(patch.after), after: copy(patch.before) };
}

export function buildMetadataPreview(before: MetadataSnapshot, candidates: readonly unknown[], supplied?: string | PaperIdentifier): MetadataPreview {
  const identifier = supplied === undefined ? before.identifiers[0] : parsePaperIdentifier(supplied);
  const result: MetadataPreview = { paperId: before.paperId, itemID: before.itemID, status: 'noIdentifier', message: 'Add a DOI, PMID, ISBN, or arXiv identifier to look up this paper.', changes: [] };
  if (!identifier) return result;
  result.identifier = identifier;
  if (!candidates.length) return { ...result, status: 'notFound', message: 'Zotero did not find metadata for this identifier.' };
  const matches = candidates.map(object).filter((candidate): candidate is Record<string, unknown> => !!candidate && extractPaperIdentifiers(candidate).some(value => identifierKey(value) === identifierKey(identifier)));
  if (!matches.length) return { ...result, status: 'mismatch', message: 'The returned metadata did not confirm the requested identifier. Nothing will be applied.' };
  if (matches.length > 1) return { ...result, status: 'ambiguous', message: 'More than one result confirms this identifier. Review the source in Zotero before applying metadata.' };
  const candidate = matches[0], after = copy(before);
  const returnedIdentifiers = [...extractPaperIdentifiers(candidate), identifier];
  if (before.identifiers.some(existing => returnedIdentifiers.some(returned => returned.kind === existing.kind && identifierKey(returned) !== identifierKey(existing)))) return { ...result, status: 'mismatch', message: 'The result conflicts with an identifier already stored on this paper. Existing metadata was preserved.' };
  for (const [field, value] of Object.entries(candidate)) if (allowedFields.has(field) && Object.hasOwn(before.fields, field) && !before.fields[field].trim() && text(value)) {
    after.fields[field] = text(value);
    result.changes.push({ field, before: before.fields[field], after: after.fields[field] });
  }
  if (!before.creators.length) {
    after.creators = normalizeMetadataCreators(candidate.creators);
    if (after.creators.length) result.changes.push({ field: 'creators', before: '', after: after.creators.map(creator => creator.name || `${creator.firstName} ${creator.lastName}`.trim()).join('; ') });
  }
  if (!result.changes.length) return { ...result, status: 'unchanged', message: 'No empty bibliographic fields could be filled. Existing metadata was preserved.' };
  return { ...result, status: 'ready', message: 'Review these additions. Existing metadata will be preserved.', patch: { paperId: before.paperId, itemID: before.itemID, before: copy(before), after } };
}
