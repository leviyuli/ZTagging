import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController, initialState } from '../src/controller.ts';
import type { AppState, ControllerEnvironment } from '../src/controller.ts';
import { paperFingerprint } from '../src/core.ts';
import type { PaperRecord } from '../src/core.ts';
import type { LibraryHost, NativeTag, TagPatch } from '../src/platform.ts';
import type { CompletionResult, ProviderSettings } from '../src/providers.ts';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const PDF = 'Electrochemical impedance spectroscopy resolves transport resistance in the electrode.';

function paper(itemID: number): PaperRecord {
  const value: PaperRecord = { id: `1:WARNING${itemID}`, itemID, libraryID: 1, key: `WARNING${itemID}`,
    title: `Electrode measurements ${itemID}`, abstract: '', keywords: [], fingerprint: '' };
  value.fingerprint = paperFingerprint(value); return value;
}

class MemoryHost implements LibraryHost {
  papers = new Map<number, PaperRecord>();
  pdfs = new Map<number, string>();
  pdfReads: number[] = [];
  writes: TagPatch[][] = [];
  shown: number[] = [];
  constructor(size: number) { for (let id = 1; id <= size; id++) this.papers.set(id, paper(id)); }
  async read(itemID: number) {
    const stored = this.papers.get(itemID); if (!stored) return null;
    const value = copy(stored); delete value.pdfText; value.fingerprint = paperFingerprint(value); return value;
  }
  async list() { return Promise.all([...this.papers.keys()].map(id => this.read(id))) as Promise<PaperRecord[]>; }
  async readTags(): Promise<NativeTag[]> { return []; }
  async pdfText(itemID: number) { this.pdfReads.push(itemID); return this.pdfs.get(itemID) ?? ''; }
  async apply(patches: TagPatch[]) { this.writes.push(copy(patches)); }
  async show(itemID: number) { this.shown.push(itemID); }
  async saveSearch() {}
}

type Call = { kind: 'facts' | 'taxonomy' | 'assignment' | 'correction'; data: any; settings: ProviderSettings };
class AI {
  calls: Call[] = [];
  failure?: Error;
  async completeJson(_system: string, prompt: string, settings: ProviderSettings): Promise<CompletionResult> {
    const marker = 'INPUT_DATA_JSON:\n', at = prompt.indexOf(marker); assert.ok(at >= 0);
    const data = JSON.parse(prompt.slice(at + marker.length));
    const kind = data.permittedRegistry ? 'correction' : data.protocolVersion === 2 ? 'taxonomy' : data.approvedVocabulary ? 'assignment' : 'facts';
    this.calls.push({ kind, data, settings: copy(settings) });
    if (this.failure) throw this.failure;
    let value: unknown;
    if (kind === 'taxonomy') {
      const ids = (data.conceptRegistry as any[]).filter(entry => entry.sources.some((source: any) => source.label === 'Electrochemical impedance spectroscopy')).map(entry => entry.registryId);
      value = { tags: ids.length ? [{ key: 'eis', name: 'EIS', fullName: 'Electrochemical impedance spectroscopy',
        description: 'Electrochemical impedance spectroscopy measurements.', facet: 'method', aliases: [],
        parentKeys: [], relatedKeys: [], supportRegistryIds: ids }] : [], merges: [], excluded: [] };
    } else if (kind === 'facts') {
      value = { summary: data.paper.pdf ? 'EIS measures transport resistance.' : 'The available metadata does not establish the scientific method.',
        concepts: data.paper.pdf ? [{ name: 'Electrochemical impedance spectroscopy', facet: 'method', evidence: [{ source: 'pdf', text: PDF }] }] : [],
        needsPDF: !data.paper.pdf };
    } else if (kind === 'assignment') {
      value = { summary: data.paper.pdf ? 'EIS measures transport resistance.' : 'More evidence is required.',
        concepts: data.paper.pdf ? ['EIS'] : [], needsPDF: !data.paper.pdf, suggestions: [], newTagCandidates: [] };
    } else value = { repairs: [] };
    return { value, text: JSON.stringify(value), usage: { inputTokens: 30, outputTokens: 20 }, usageKnown: true, estimatedCostUSD: null };
  }
  async hasApiKey() { return false; }
  async getSession() { return { connected: true, sharing: true, email: null, accountId: null, accounts: [] }; }
  async setApiKey() {} async removeApiKey() {} async listModels() { return []; }
  async testConnection(): Promise<CompletionResult> { return { value: { ok: true }, text: '{"ok":true}', usage: { inputTokens: 1, outputTokens: 1 }, usageKnown: true, estimatedCostUSD: null }; }
  async signIn() { return this.getSession(); } cancelSignIn() {} async signOut() { return { revoked: true }; } async selectAccount() {}
}

function harness(size = 1, restored?: AppState, host = new MemoryHost(size)) {
  const state = restored ?? initialState(), ai = new AI(), saves: AppState[] = [];
  if (!restored) { state.settings.model = 'test-model'; state.tags[0].status = 'approved'; }
  const env: ControllerEnvironment = { host, ai, persist: async value => { saves.push(copy(value)); } };
  return { state, ai, host, saves, controller: new AppController(state, env) };
}
type Harness = ReturnType<typeof harness>;
async function run(h: Harness, kind: 'rebuild' | 'tag' = 'rebuild') {
  await h.controller.invoke(kind, { scope: 'library' }); await h.controller.waitForIdle();
  assert.equal(h.state.run?.status, 'idle', h.state.run?.message);
}
function gaps(h: Harness, context?: string) { return h.state.warnings.filter(record => record.code === 'evidence-gap' && (context === undefined || record.context === context)); }

test('evidence gaps identify each affected paper and preserve independent factual and assignment phases', async () => {
  const h = harness(2); await run(h);
  const factRunId = h.state.run!.id;
  assert.deepEqual(gaps(h, 'facts').map(record => record.paperIds), [['1:WARNING1'], ['1:WARNING2']]);
  assert.ok(gaps(h, 'facts').every(record => record.status === 'active' && record.runIds.includes(factRunId)));
  await run(h, 'tag');
  assert.equal(gaps(h, 'facts').filter(record => record.status === 'active').length, 2);
  assert.equal(gaps(h, 'assignment:core').filter(record => record.status === 'active').length, 2);
  assert.ok(gaps(h, 'assignment:core').every(record => record.runIds.includes(h.state.run!.id)));
  assert.equal(h.host.writes.length, 0);
  assert.equal(h.ai.calls.filter(call => call.kind === 'correction').length, 0, 'an evidence gap is not an invalid reference to repair');
});

test('controller dismissal persists through restart and an unchanged cached factual rebuild', async () => {
  const first = harness(); await run(first); const warning = gaps(first, 'facts')[0];
  await first.controller.invoke('dismiss-warning', { id: warning.id });
  const restored = harness(1, copy(first.state), first.host); await restored.controller.initialize();
  const priorReads = restored.host.pdfReads.length; await run(restored);
  const records = gaps(restored, 'facts'); assert.equal(records.length, 1); assert.equal(records[0].id, warning.id);
  assert.equal(records[0].status, 'dismissed'); assert.ok(restored.host.pdfReads.length > priorReads, 'a cached gap must check local PDF availability again');
  assert.equal(restored.ai.calls.filter(call => call.kind === 'facts').length, 0, 'unchanged local evidence reuses extraction');
});

test('new readable PDF evidence refreshes cached facts and resolves only the factual evidence gap', async () => {
  const h = harness(); await run(h); await run(h, 'tag');
  const oldFactWarning = gaps(h, 'facts')[0].id, oldAssignmentWarning = gaps(h, 'assignment:core')[0].id;
  const factCalls = h.ai.calls.filter(call => call.kind === 'facts').length, reads = h.host.pdfReads.length;
  h.host.pdfs.set(1, PDF); await run(h);
  assert.ok(h.host.pdfReads.length > reads); assert.ok(h.ai.calls.filter(call => call.kind === 'facts').length > factCalls);
  assert.equal(h.state.facts['1:WARNING1'].needsPDF, false);
  assert.deepEqual(h.state.facts['1:WARNING1'].concepts[0].evidence, [{ source: 'pdf', text: PDF }]);
  assert.equal(h.state.warnings.find(record => record.id === oldFactWarning)!.status, 'resolved');
  assert.equal(h.state.warnings.find(record => record.id === oldAssignmentWarning)!.status, 'active', 'facts cannot resolve an assignment-phase condition');
  assert.equal(h.host.writes.length, 0);
});

test('new readable PDF evidence refreshes a cached assignment gap instead of returning stale analysis', async () => {
  const h = harness(); await run(h, 'tag'); const old = gaps(h, 'assignment:core')[0].id;
  const before = h.ai.calls.filter(call => call.kind === 'assignment').length, reads = h.host.pdfReads.length;
  h.host.pdfs.set(1, PDF); await run(h, 'tag');
  assert.ok(h.host.pdfReads.length > reads); assert.ok(h.ai.calls.filter(call => call.kind === 'assignment').length > before);
  assert.equal(h.state.warnings.find(record => record.id === old)!.status, 'resolved');
  assert.equal(gaps(h, 'assignment:core').filter(record => record.status === 'active').length, 0);
  assert.ok(h.state.papers['1:WARNING1'].pdfText?.includes(PDF)); assert.equal(h.host.writes.length, 0);
});

test('custom-detail previews track and resolve their own phase without hiding core-assignment gaps', async () => {
  const h = harness(); await run(h, 'tag');
  await h.controller.invoke('preview-detail', { tagId: 'custom-rcl', scope: 'library' }); await h.controller.waitForIdle();
  assert.equal(h.state.run?.status, 'idle', h.state.run?.message);
  assert.equal(gaps(h, 'assignment:custom-rcl').filter(record => record.status === 'active').length, 1);
  h.host.pdfs.set(1, PDF);
  await h.controller.invoke('preview-detail', { tagId: 'custom-rcl', scope: 'library' }); await h.controller.waitForIdle();
  assert.equal(gaps(h, 'assignment:custom-rcl').filter(record => record.status === 'active').length, 0);
  assert.equal(gaps(h, 'assignment:core').filter(record => record.status === 'active').length, 1);
});

test('more than twenty affected papers remain individually actionable and Dismiss all retains their history', async () => {
  const h = harness(25); await run(h);
  assert.equal(gaps(h, 'facts').filter(record => record.status === 'active').length, 25);
  const snapshot = await h.controller.snapshot(); assert.equal(snapshot.warnings!.filter(record => record.status === 'active').length, 25);
  await h.controller.invoke('dismiss-warnings');
  assert.equal(gaps(h, 'facts').length, 25); assert.ok(gaps(h, 'facts').every(record => record.status === 'dismissed'));
  const restored = harness(25, copy(h.state), h.host); await restored.controller.initialize();
  assert.ok(gaps(restored, 'facts').every(record => record.status === 'dismissed'));
});

test('repeated manager snapshots do not count as new warning observations', async () => {
  const h = harness(); await run(h); const before = JSON.stringify(h.state.warnings);
  for (let i = 0; i < 5; i++) await h.controller.snapshot();
  assert.equal(JSON.stringify(h.state.warnings), before); assert.equal(gaps(h, 'facts')[0].occurrenceCount, 1);
});

test('changed paper evidence creates an active warning episode while retaining dismissed historical evidence', async () => {
  const h = harness(); await run(h, 'tag'); const old = copy(gaps(h, 'assignment:core')[0]);
  await h.controller.invoke('dismiss-warnings');
  h.host.papers.get(1)!.title = 'Revised electrode measurements with incomplete metadata';
  await run(h, 'tag'); const records = gaps(h, 'assignment:core');
  assert.equal(records.length, 2); assert.equal(records.find(record => record.id === old.id)!.status, 'dismissed');
  const active = records.find(record => record.status === 'active')!; assert.ok(active); assert.notEqual(active.id, old.id);
  assert.notEqual(active.conditionFingerprint, old.conditionFingerprint); assert.deepEqual(active.paperIds, old.paperIds);
  assert.equal(h.host.writes.length, 0);
});

test('a recovered evidence gap recurring after PDF removal starts a new active episode', async () => {
  const h = harness(); await run(h, 'tag'); const original = copy(gaps(h, 'assignment:core')[0]);
  h.host.pdfs.set(1, PDF); await run(h, 'tag');
  assert.equal(h.state.warnings.find(record => record.id === original.id)!.status, 'resolved');
  h.host.pdfs.delete(1); await run(h, 'tag');
  const records = gaps(h, 'assignment:core'); assert.equal(records.length, 2);
  const active = records.find(record => record.status === 'active')!;
  assert.ok(active); assert.notEqual(active.id, original.id); assert.equal(active.conditionFingerprint, original.conditionFingerprint);
  assert.equal(active.occurrenceCount, 1);
});

test('failed reevaluation leaves the prior warning active rather than claiming recovery', async () => {
  const h = harness(); await run(h, 'tag'); const original = copy(gaps(h, 'assignment:core')[0]);
  h.host.pdfs.set(1, PDF); h.ai.failure = new Error('Authentication failed during evidence reevaluation');
  await h.controller.invoke('tag', { scope: 'library' }); await h.controller.waitForIdle();
  assert.equal(h.state.run?.status, 'paused'); assert.match(h.state.run!.message, /Authentication failed/);
  assert.deepEqual(h.state.warnings.find(record => record.id === original.id), original);
});

test('Resume requeues only completed factual jobs whose formerly missing local PDF evidence changed', async () => {
  const h = harness(2); await run(h);
  const unchangedFacts = JSON.stringify(h.state.facts['1:WARNING2']);
  const priorFactRequests = h.ai.calls.filter(call => call.kind === 'facts').length;
  const oldGeneration = h.state.run!.consolidation!.generationId;
  await h.controller.invoke('pause'); h.host.pdfs.set(1, PDF);
  await h.controller.invoke('resume'); await h.controller.waitForIdle();
  assert.equal(h.state.run!.status, 'idle', h.state.run!.message);
  assert.equal(h.ai.calls.filter(call => call.kind === 'facts').length, priorFactRequests + 1);
  assert.equal(h.state.facts['1:WARNING1'].needsPDF, false); assert.equal(JSON.stringify(h.state.facts['1:WARNING2']), unchangedFacts);
  assert.notEqual(h.state.run!.consolidation!.generationId, oldGeneration);
  assert.equal(gaps(h, 'facts').find(record => record.paperIds.includes('1:WARNING1'))!.status, 'resolved');
  assert.equal(gaps(h, 'facts').find(record => record.paperIds.includes('1:WARNING2'))!.status, 'active');
  assert.ok(h.state.run!.jobs.every(job => job.status === 'completed')); assert.equal(h.host.writes.length, 0);
});
