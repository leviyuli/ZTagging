import {fingerprint} from './core.ts';

/** A warning is a persisted episode of a condition, rather than a disposable UI message. */
export interface WarningRecord {
  id: string;
  code: string;
  message: string;
  paperIds: string[];
  runIds: string[];
  context: string;
  conditionFingerprint: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  occurrenceCount: number | null;
  status: 'active' | 'resolved' | 'dismissed';
  legacy?: boolean;
  importedAt?: string;
  /** A changed condition supersedes an active episode without claiming successful recovery. */
  supersededBy?: string;
}

export interface WarningInput {
  code: string;
  message: string;
  context: string;
  conditionFingerprint: string;
  paperIds?: string[];
  runIds?: string[];
  /** Time of this observation; rendering a warning must never call upsertWarning. */
  now?: string;
}

export interface WarningSelector {
  ids?: string[];
  code?: string;
  context?: string;
  conditionFingerprint?: string;
  /** An exact affected-paper set, so reevaluating one paper cannot resolve another. */
  paperIds?: string[];
  /** Require these run associations when supplied. Runs are not part of condition identity. */
  runIds?: string[];
}

function unique(values: readonly string[]): string[] { return [...new Set(values)].sort(); }
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = unique(left), b = unique(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function newId(): string {
  return `warning-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}`;
}

/** Record an observed failure. An unchanged dismissed condition stays dismissed across runs. */
export function upsertWarning(records: readonly WarningRecord[], input: WarningInput): WarningRecord[] {
  const paperIds = unique(input.paperIds ?? []), now = input.now ?? new Date().toISOString();
  const sameCondition = (record: WarningRecord) => !record.legacy && record.code === input.code
    && record.context === input.context && sameSet(record.paperIds, paperIds);
  const index = records.findLastIndex(sameCondition);
  if (index >= 0 && records[index].conditionFingerprint === input.conditionFingerprint
      && records[index].status !== 'resolved' && !records[index].supersededBy) {
    return records.map((record, current) => current === index ? {
      ...record,
      message: input.message,
      runIds: unique([...record.runIds, ...(input.runIds ?? [])]),
      lastSeenAt: now,
      occurrenceCount: (record.occurrenceCount ?? 0) + 1,
    } : record);
  }
  const id = newId();
  return [...records.map(record => sameCondition(record) && record.status === 'active'
    ? { ...record, status: 'dismissed' as const, supersededBy: id } : record), {
    id, code: input.code, message: input.message, paperIds,
    runIds: unique(input.runIds ?? []), context: input.context,
    conditionFingerprint: input.conditionFingerprint,
    firstSeenAt: now, lastSeenAt: now, occurrenceCount: 1, status: 'active',
  }];
}

function matches(record: WarningRecord, selector: WarningSelector): boolean {
  return (!selector.ids || selector.ids.includes(record.id))
    && (selector.code === undefined || record.code === selector.code)
    && (selector.context === undefined || record.context === selector.context)
    && (selector.conditionFingerprint === undefined || record.conditionFingerprint === selector.conditionFingerprint)
    && (!selector.paperIds || sameSet(record.paperIds, selector.paperIds))
    && (!selector.runIds || selector.runIds.every(id => record.runIds.includes(id)));
}

/** Call only after successfully reevaluating the corresponding condition and processing phase. */
export function resolveWarnings(records: readonly WarningRecord[], selector: WarningSelector): WarningRecord[] {
  // An accidental empty selector must not declare every condition successfully reevaluated.
  if (!Object.values(selector).some(value => value !== undefined)) return [...records];
  return records.map(record => !record.legacy && record.status !== 'resolved' && matches(record, selector)
    ? { ...record, status: 'resolved' } : record);
}

/** Omitted IDs implements the historical dismiss-warnings action without deleting history. */
export function dismissWarnings(records: readonly WarningRecord[], ids?: readonly string[]): WarningRecord[] {
  const selected = ids && new Set(ids);
  return records.map(record => record.status === 'active' && (!selected || selected.has(record.id))
    ? { ...record, status: 'dismissed' } : record);
}

/** Completed operations belong in history; recording them must not create a persistent banner. */
export function recordWarningNotice(records:readonly WarningRecord[],input:WarningInput):WarningRecord[] {
  const next=upsertWarning(records,input),latest=next.findLast(record=>record.code===input.code&&record.context===input.context&&sameSet(record.paperIds,input.paperIds??[]));
  return latest?resolveWarnings(next,{ids:[latest.id]}):next;
}

export interface TopicWarningInput {
  paperId:string;runId?:string;context:string;conditionFingerprint:string;topics:readonly string[];now?:string;
}
/** Success in one assignment phase cannot hide another paper's unresolved topics. */
export function updateTopicWarnings(records:readonly WarningRecord[],input:TopicWarningInput):WarningRecord[] {
  if(!input.topics.length)return resolveWarnings(records,{code:'unapproved-topics',context:input.context,paperIds:[input.paperId]});
  const topics=unique(input.topics);
  return upsertWarning(records,{code:'unapproved-topics',context:input.context,paperIds:[input.paperId],runIds:input.runId?[input.runId]:[],
    conditionFingerprint:fingerprint({input:input.conditionFingerprint,topics}),now:input.now,
    message:`Unapproved topics found: ${topics.slice(0,6).join(', ')}. Add definitions or rebuild the vocabulary to review them.`});
}

/** Old completed merge-review notices already describe a successful corrective action. */
export function migrateWarningEpisodes(records:readonly WarningRecord[]):WarningRecord[] {
  return records.map(record=>!record.legacy&&record.code==='merge-review-notice'&&record.status==='active'?{...record,status:'resolved'}:record);
}

/** Legacy strings contain no trustworthy observation dates, counts, phase, or paper associations. */
export function migrateLegacyWarnings(messages: readonly string[], importedAt = new Date().toISOString()): WarningRecord[] {
  return messages.map(message => ({
    id: newId(), code: 'legacy-unverified', message,
    paperIds: [], runIds: [], context: 'historical-unverified',
    conditionFingerprint: 'legacy-unverified',
    firstSeenAt: null, lastSeenAt: null, occurrenceCount: null,
    status: 'dismissed', legacy: true, importedAt,
  }));
}

export function validWarningRecord(value: unknown): value is WarningRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as WarningRecord;
  const strings = (list: unknown): list is string[] => Array.isArray(list) && list.every(item => typeof item === 'string');
  const time = (date: unknown) => date === null || typeof date === 'string' && Number.isFinite(Date.parse(date));
  return (['id', 'code', 'message', 'context', 'conditionFingerprint'] as const).every(key => typeof record[key] === 'string')
    && !!record.id && !!record.code && strings(record.paperIds) && strings(record.runIds)
    && time(record.firstSeenAt) && time(record.lastSeenAt)
    && (record.occurrenceCount === null || Number.isSafeInteger(record.occurrenceCount) && record.occurrenceCount >= 1)
    && ['active', 'resolved', 'dismissed'].includes(record.status)
    && (record.legacy === undefined || typeof record.legacy === 'boolean')
    && (record.supersededBy === undefined || typeof record.supersededBy === 'string' && !!record.supersededBy)
    && (record.importedAt === undefined || typeof record.importedAt === 'string' && Number.isFinite(Date.parse(record.importedAt)));
}
