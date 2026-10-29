import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { AppController, initialState, validState } from '../src/controller.ts';
import type { AppState, ControllerEnvironment } from '../src/controller.ts';
import { ProviderClient } from '../src/providers.ts';
import { paperFingerprint } from '../src/core.ts';
import type { PaperRecord } from '../src/core.ts';
import type { LibraryHost, NativeTag, TagPatch } from '../src/platform.ts';
import {normalizeFacts,createTaxonomyProposal,buildConsolidationPrompt} from '../src/taxonomy.ts';
import {createRegistrySnapshot} from '../src/evidence.ts';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const QUOTE = 'Electrochemical impedance spectroscopy measures catalyst-layer transport resistance.';
const KEY = 'synthetic-diagnostics-deepseek-secret';
const MALFORMED = 'This completed assistant reply is not JSON: }';
const BAD_REGISTRY = 'registry-not-permitted-in-this-snapshot';
const REQUEST_COST = (30 + 20 * 2) / 1_000_000;
type Call = { kind: 'facts' | 'taxonomy' | 'correction' | 'assignment'; data: any };
type Handler = (call: Call, index: number) => Response | Promise<Response>;

function completion(content: unknown, finish = 'stop'): Response {
  return new Response(JSON.stringify({ id: 'synthetic-response', object: 'chat.completion',
    choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) } }],
    usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
  }), { headers: { 'Content-Type': 'application/json', 'x-request-id': 'synthetic-request-id' } });
}
function facts() { return { summary: 'EIS measures catalyst-layer transport resistance.', needsPDF: false,
  concepts: [{ name: 'Electrochemical impedance spectroscopy', facet: 'method', evidence: [{ source: 'abstract', text: QUOTE }] }] }; }
function taxonomy(data: any, invalid = false) {
  return { tags: [{ key: 'eis', name: 'EIS', fullName: 'Electrochemical impedance spectroscopy',
    description: 'Electrochemical impedance spectroscopy measurements.', facet: 'method', aliases: [], parentKeys: invalid ? [BAD_REGISTRY] : [], relatedKeys: [],
    supportRegistryIds: data.conceptRegistry.filter((entry: any) => entry.sources.some((source: any) => source.label === 'Electrochemical impedance spectroscopy')).map((entry: any) => entry.registryId),
  }], merges: [], excluded: [] };
}

async function harness(handler: Handler) {
  const paper: PaperRecord = { id: '1:DIAGNOSTICS', itemID: 1, libraryID: 1, key: 'DIAGNOSTICS',
    title: 'Impedance measurements in an electrode', abstract: QUOTE, keywords: [], fingerprint: '' };
  paper.fingerprint = paperFingerprint(paper);
  let native: NativeTag[] = [{ tag: 'Manual project', type: 0 }];
  const writes: TagPatch[][] = [], calls: Call[] = [], persisted: string[] = [];
  const host: LibraryHost = { list: async () => [copy(paper)], read: async () => copy(paper), readTags: async () => copy(native),
    pdfText: async () => '', apply: async patches => { writes.push(copy(patches)); native = copy(patches[0]?.after ?? native); },
    show: async () => {}, saveSearch: async () => {} };
  const credentials = new Map<string, string>(), metadata = new Map<string, string>();
  const ai = new ProviderClient({ crypto: webcrypto as unknown as Crypto,
    credentials: { load: async key => credentials.get(key) ?? null, save: async (key, value) => { credentials.set(key, value); }, remove: async key => { credentials.delete(key); } },
    metadata: { get: async key => metadata.get(key) ?? null, set: async (key, value) => { metadata.set(key, value); } },
    openExternal: () => { throw new Error('DeepSeek must not open OAuth'); },
    registerCallback: async () => { throw new Error('DeepSeek must not register OAuth callbacks'); },
    fetch: (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      assert.equal(String(url), 'https://api.deepseek.com/chat/completions');
      assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${KEY}`);
      const request = JSON.parse(String(init.body)); assert.equal(request.model, 'diagnostics-model');
      const prompt = request.messages.find((message: any) => message.role === 'user').content;
      const marker = 'INPUT_DATA_JSON:\n', at = prompt.indexOf(marker); assert.ok(at >= 0);
      const data = JSON.parse(prompt.slice(at + marker.length));
      const kind = data.preparationPolicyVersion || data.permittedRegistry ? 'correction' : data.protocolVersion === 2 ? 'taxonomy' : data.approvedVocabulary ? 'assignment' : 'facts';
      const call: Call = { kind, data }; calls.push(call); return handler(call, calls.length - 1);
    }) as typeof fetch,
  });
  await ai.setApiKey(KEY, 'deepseek');
  const state = initialState(); state.tags[0].status = 'approved'; state.vocabularyVersion = 1;
  Object.assign(state.settings, { provider: 'deepseek', model: 'diagnostics-model', inputPricePerMillion: 1, outputPricePerMillion: 2, budgetUSD: 2, maxOutputTokens: 1024 });
  const env: ControllerEnvironment = { host, ai, persist: async next => { persisted.push(JSON.stringify(next)); } };
  return { state, ai, env, calls, persisted, writes, host, controller: new AppController(state, env), native: () => copy(native) };
}
type Harness = Awaited<ReturnType<typeof harness>>;
async function run(h: Harness, kind = 'rebuild') { await h.controller.invoke(kind, { scope: 'library' }); await h.controller.waitForIdle(); }
async function legacyReview(h:Harness){
  await h.controller.invoke('scan',{scope:'library'});const paper=(await h.host.read(1))!,fact=normalizeFacts(facts(),paper,'deepseek','historical-model'),snapshot=createRegistrySnapshot([fact],h.state.evidenceCatalog),data=JSON.parse(buildConsolidationPrompt([fact],h.state.tags,60,snapshot).split('INPUT_DATA_JSON:\n')[1]),raw=taxonomy(data,true),proposal=createTaxonomyProposal(raw,[fact],h.state.tags,{snapshot,baseVersion:h.state.vocabularyVersion});
  h.state.facts[paper.id]=fact;h.state.taxonomyProposal=proposal;h.state.run={id:'historical-diagnostics',kind:'rebuild',scope:'library',automatic:false,status:'idle',jobs:[{id:'historical-job',paperId:paper.id,status:'completed'}],vocabCursor:1,vocabFinished:false,message:'A saved proposal awaits reference checks.',spentUSD:2*REQUEST_COST,settings:copy(h.state.settings),vocabularyVersion:h.state.vocabularyVersion,preparationOnly:true,consolidation:{protocolVersion:2,generationId:proposal.id,inputFingerprint:proposal.inputFingerprint,snapshot,candidateIds:copy(proposal.candidateIds??{}),value:raw,correctionAttempts:0,phase:'needs-review'}};
  await h.controller.initialize();await h.controller.invoke('resume');await h.controller.waitForIdle();
}
function assertSafe(h: Harness) {
  assert.equal(h.writes.length, 0); assert.deepEqual(h.native(), [{ tag: 'Manual project', type: 0 }]);
  assert.ok(h.persisted.every(value => !value.includes(KEY)), 'credentials remain only in the credential store');
}

test('completed malformed chooser replies retain diagnostics and actual usage without repeating exhausted requests on Resume', async t => {
  const h = await harness(call => call.kind === 'facts' ? completion(facts()) : completion(MALFORMED));
  t.after(async () => { await h.controller.shutdown(); await h.ai.dispose(); });
  await run(h); const work=h.state.run!.selection!,task=work.tasks.find(task=>task.kind==='plan')!;
  assert.equal(h.state.run!.status, 'paused'); assert.equal(h.state.run!.jobs[0].status, 'completed');
  assert.equal(work.status,'failed');assert.equal(task.invalidResponses,4);assert.equal(task.attempts.length,4);assert.ok(task.attempts.every(attempt=>attempt.raw===MALFORMED&&/not valid JSON/i.test(attempt.error??'')));assert.equal(h.state.taxonomyProposal,null);
  assert.ok(Math.abs(h.state.run!.spentUSD - 5 * REQUEST_COST) < 1e-12, 'initial and bounded repair replies retain their actual token usage');
  const snapshot = await h.controller.snapshot(); assert.equal(snapshot.queue.consolidation, undefined);assert.equal(snapshot.queue.selection!.failed,true);assert.ok(!JSON.stringify(snapshot).includes(MALFORMED));
  assert.equal(validState(h.state), true); assertSafe(h);
  const count = h.calls.length, restored: AppState = copy(h.state);
  restored.run!.status = 'paused'; restored.run!.vocabFinished = false; restored.taxonomyProposal = null;
  const restarted = new AppController(restored, h.env); t.after(async () => { await restarted.shutdown(); });
  await restarted.initialize(); await restarted.invoke('resume'); await restarted.waitForIdle();
  assert.equal(restored.run!.status, 'paused'); assert.equal(h.calls.length, count);assert.deepEqual(restored.run!.selection!.tasks.find(task=>task.id===work.tasks[0].id)!.attempts,task.attempts);
  assert.ok(Math.abs(restored.run!.spentUSD - 5 * REQUEST_COST) < 1e-12);
  assert.equal(restored.taxonomyProposal,null);await assert.rejects(restarted.invoke('approve-taxonomy', { id: work.id }), /changed|proposal/i);
});

test('malformed assignment output pauses before suggestions or native writes while retaining actual completed-request cost', async t => {
  const h = await harness(() => completion(MALFORMED)); t.after(async () => { await h.controller.shutdown(); await h.ai.dispose(); });
  await run(h, 'tag');
  assert.equal(h.state.run!.status, 'paused'); assert.match(h.state.run!.message, /not valid JSON/);
  assert.equal(h.state.suggestions.length, 0); assert.equal(h.state.run!.consolidation, undefined);
  assert.ok(Math.abs(h.state.run!.spentUSD - REQUEST_COST) < 1e-12); assertSafe(h);
});

test('malformed preparation repairs preserve candidate identities and valid evidence until an explicit edit', async t => {
  const badCorrection = 'A completed reference correction with malformed JSON: }';
  const h = await harness(call => call.kind === 'facts' ? completion(facts()) : call.kind === 'taxonomy' ? completion(taxonomy(call.data, true)) : completion(badCorrection));
  t.after(async () => { await h.controller.shutdown(); await h.ai.dispose(); }); await legacyReview(h);
  const checkpoint = h.state.run!.consolidation!, proposal = h.state.taxonomyProposal!, tag = proposal.tags.find(tag => tag.name === 'EIS')!;
  assert.equal(h.state.run!.status, 'idle'); assert.equal(checkpoint.phase, 'needs-review'); assert.equal(checkpoint.correctionAttempts, 0);
  assert.equal(h.state.run!.preparation!.attempts,3);assert.ok(h.state.run!.preparation!.responses.every(reply=>reply.raw===badCorrection));assert.ok(h.state.tagPreparation!.diagnostics.some(issue=>/read|JSON/i.test(issue)));
  const initial = copy(checkpoint.value), originalTag = copy(tag), originalSources = [...proposal.support[tag.id].sourceIds!];
  const correction = h.calls.find(call => call.kind === 'correction')!;
  assert.equal(correction.data.tags.find((candidate: any) => candidate.name === 'EIS').id, tag.id);
  assert.equal(checkpoint.candidateIds.eis, tag.id); assert.deepEqual(proposal.support[tag.id].paperIds, ['1:DIAGNOSTICS']);
  assert.ok(proposal.unresolvedRelationships!.some(value=>value.reference===BAD_REGISTRY));
  assert.ok(Math.abs(h.state.run!.spentUSD - 5 * REQUEST_COST) < 1e-12); assertSafe(h);
  const snapshot = await h.controller.snapshot(); assert.equal(snapshot.queue.consolidation, undefined);assert.ok(!JSON.stringify(snapshot).includes(badCorrection));
  const restored = copy(h.state), requestsBeforeRestart = h.calls.length;
  restored.run!.status = 'paused'; restored.run!.vocabFinished = false;
  const restarted = new AppController(restored, h.env); t.after(async () => { await restarted.shutdown(); });
  await restarted.initialize(); await restarted.invoke('resume'); await restarted.waitForIdle();
  assert.equal(h.calls.length, requestsBeforeRestart, 'reparsing a completed malformed correction cannot send another automatic attempt');
  assert.equal(restored.run!.preparation!.attempts, 3); assert.ok(restored.run!.preparation!.responses.every(reply=>reply.raw===badCorrection));
  assert.deepEqual(restored.taxonomyProposal!.tags.find(candidate => candidate.id === tag.id), originalTag);
  assert.deepEqual(restored.taxonomyProposal!.support[tag.id].sourceIds, originalSources);
  assert.ok(Math.abs(restored.run!.spentUSD - 5 * REQUEST_COST) < 1e-12);
  await assert.rejects(h.controller.invoke('approve-taxonomy', { id: proposal.id }), /registry|support|evidence|relationship/i);
  const requestCount = h.calls.length;
  proposal.unresolvedRelationships=[];await h.controller.invoke('save-taxonomy-proposal',{id:proposal.id,tags:proposal.tags});
  assert.deepEqual(proposal.tags.find(candidate => candidate.id === tag.id), originalTag);
  assert.deepEqual(proposal.support[tag.id].sourceIds, originalSources); assert.deepEqual(proposal.issues, []);
  assert.deepEqual(checkpoint.value, initial, 'manual recovery does not rewrite the original model response');
  assert.equal(h.calls.length, requestCount); assert.equal(h.state.run!.preparation!.responses.length,3);
  await h.controller.invoke('approve-taxonomy', { id: proposal.id }); assert.equal(h.state.taxonomyReady, true); assertSafe(h);
});

test('truncated provider output cannot be approved even if its partial assistant text is valid taxonomy JSON', async t => {
  const h = await harness(call => call.kind === 'facts' ? completion(facts()) : call.kind==='taxonomy'?completion(taxonomy(call.data), 'length'):completion(MALFORMED));
  t.after(async () => { await h.controller.shutdown(); await h.ai.dispose(); }); await run(h);
  const work=h.state.run!.selection!,task=work.tasks.find(task=>task.kind==='plan')!;
  assert.equal(h.state.run!.status,'paused');assert.equal(work.status,'failed');assert.equal(task.attempts.length,4);assert.ok(task.attempts.every(attempt=>attempt.diagnosticOnly&&typeof attempt.raw==='string'&&JSON.parse(attempt.raw).tags.some((tag:any)=>tag.name==='EIS')),'valid-looking partial text stays available only as retained diagnostics');
  assert.equal(work.plan,undefined);assert.equal(h.state.taxonomyProposal,null);await assert.rejects(h.controller.invoke('approve-taxonomy',{id:work.id}),/proposal|changed/i);assert.equal(h.calls.filter(call=>call.kind==='taxonomy').length,4);assertSafe(h);
});

test('HTTP authentication bodies never become model diagnostics or leak credentials into checkpoints and snapshots', async t => {
  const bodyMarker = 'PRIVATE_HTTP_DIAGNOSTIC_BODY';
  const h = await harness(call => call.kind === 'facts' ? completion(facts()) : new Response(JSON.stringify({
    error: { code: 'invalid_api_key', message: 'Synthetic authentication denied', diagnostic: bodyMarker }, requestCredential: KEY,
  }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
  t.after(async () => { await h.controller.shutdown(); await h.ai.dispose(); }); await run(h);
  assert.equal(h.state.run!.status, 'paused'); assert.match(h.state.run!.message, /authentication denied/i);
  const task=h.state.run!.selection!.tasks.find(task=>task.kind==='plan')!;assert.ok(task.transportPaused);assert.ok(task.attempts.every(attempt=>attempt.raw===null));assert.equal(h.state.run!.selectionReplies?.length??0,0);
  assert.equal(h.state.taxonomyProposal, null); assert.equal(h.state.run!.jobs[0].status, 'completed');
  const snapshot = await h.controller.snapshot(), serialized = JSON.stringify({ state: h.state, snapshot, persisted: h.persisted });
  assert.ok(!serialized.includes(KEY)); assert.ok(!serialized.includes(bodyMarker));
  assert.equal(snapshot.queue.consolidation, undefined); assertSafe(h);
});
