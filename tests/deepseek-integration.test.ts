import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { AppController, initialState, validState } from '../src/controller.ts';
import { ProviderClient } from '../src/providers.ts';
import { paperFingerprint } from '../src/core.ts';
import type { PaperRecord } from '../src/core.ts';
import type { LibraryHost, NativeTag } from '../src/platform.ts';

const evidence = 'We measure catalyst-layer resistance in a PEM water electrolyzer.';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function integration(fail = false) {
  const paper: PaperRecord = {
    id: '1:DEEPSEEK', itemID: 1, libraryID: 1, key: 'DEEPSEEK',
    title: 'Catalyst-layer resistance in PEM electrolysis', abstract: evidence,
    keywords: [], summary: '', concepts: [], fingerprint: '',
  };
  paper.fingerprint = paperFingerprint(paper);
  let nativeTags: NativeTag[] = [{ tag: 'Project manuscript', type: 0 }];
  const host: LibraryHost = {
    list: async () => [copy(paper)], read: async () => copy(paper),
    readTags: async () => copy(nativeTags), pdfText: async () => '',
    apply: async patches => {
      for (const patch of patches) {
        assert.deepEqual(nativeTags, patch.before);
        nativeTags = copy(patch.after);
      }
    },
    show: async () => {}, saveSearch: async () => {},
  };
  const credentials = new Map<string, string>();
  const metadata = new Map<string, string>();
  const requests: string[] = [];
  const ai = new ProviderClient({
    crypto: webcrypto as unknown as Crypto,
    credentials: {
      load: async key => credentials.get(key) ?? null,
      save: async (key, value) => { credentials.set(key, value); },
      remove: async key => { credentials.delete(key); },
    },
    metadata: { get: async key => metadata.get(key) ?? null, set: async (key, value) => { metadata.set(key, value); } },
    openExternal: () => { throw new Error('DeepSeek must not open an OAuth page'); },
    registerCallback: async () => { throw new Error('DeepSeek must not register an OAuth callback'); },
    fetch: (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      requests.push(String(url));
      assert.equal(String(url), 'https://api.deepseek.com/chat/completions');
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer integration-deepseek-key');
      const body = JSON.parse(String(init.body));
      assert.equal(body.model, 'integration-model');
      assert.equal(body.response_format.type, 'json_object');
      const marker = 'INPUT_DATA_JSON:\n';
      const prompt = body.messages.find((message: any) => message.role === 'user').content;
      const input = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length));
      assert.equal(input.paper.abstract, evidence);
      if (fail) return new Response(JSON.stringify({ error: { message: 'Insufficient balance', code: 'insufficient_balance' } }), { status: 402 });
      return new Response(JSON.stringify({
        id: 'integration-response', object: 'chat.completion',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
          summary: 'Measures catalyst-layer resistance in a PEM water electrolyzer.',
          concepts: ['catalyst-layer resistance'], needsPDF: false, newTagCandidates: [],
          suggestions: [{ tagId: 'custom-rcl', reason: 'Direct abstract evidence.', confidence: 'high', match: 'substantive', evidence: [{ source: 'abstract', text: evidence }] }],
        }) } }],
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
      }), { headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch,
  });
  await ai.setApiKey('integration-openai-key');
  await ai.setApiKey('integration-deepseek-key', 'deepseek');
  const state = initialState();
  state.settings = { ...state.settings, provider: 'deepseek', model: 'integration-model', inputPricePerMillion: 1, outputPricePerMillion: 2, budgetUSD: 1 };
  state.tags[0].status = 'approved';
  state.vocabularyVersion = 1;
  const persisted: string[] = [];
  const controller = new AppController(state, { host, ai, persist: async next => { persisted.push(JSON.stringify(next)); } });
  return { ai, controller, state, requests, persisted, tags: () => copy(nativeTags) };
}

test('DeepSeek transport feeds reviewed, reversible native tag changes through the real controller', async t => {
  const h = await integration();
  t.after(async () => { await h.controller.shutdown(); await h.ai.dispose(); });
  assert.equal(validState(h.state), true);
  await h.controller.invoke('tag', { scope: 'library' });
  await h.controller.waitForIdle();
  assert.equal(h.state.run?.status, 'idle');
  assert.equal(h.requests.length, 1);
  assert.ok(Math.abs(h.state.run!.spentUSD - 0.00007) < 1e-12);
  assert.deepEqual(h.tags(), [{ tag: 'Project manuscript', type: 0 }], 'analysis alone does not change native tags');
  const suggestion = h.state.suggestions[0];
  assert.equal(suggestion.tagId, 'custom-rcl');
  assert.equal(suggestion.status, 'accepted');assert.equal(suggestion.decisionOrigin,'automatic');assert.equal(suggestion.applied??false,false);
  await h.controller.invoke('accept-suggestion', { id: suggestion.id });
  await h.controller.invoke('apply-suggestions', { ids: [suggestion.id] });
  assert.deepEqual(h.tags().map(tag => tag.tag).sort(), ['Project manuscript', 'RCL']);
  await h.controller.invoke('undo', { id: h.state.history[0].id });
  assert.deepEqual(h.tags(), [{ tag: 'Project manuscript', type: 0 }]);
  assert.ok(h.persisted.every(value => !value.includes('integration-deepseek-key') && !value.includes('integration-openai-key')));
});

test('DeepSeek insufficient balance pauses the real queue without changing tags or using OpenAI', async t => {
  const h = await integration(true);
  t.after(async () => { await h.controller.shutdown(); await h.ai.dispose(); });
  await h.controller.invoke('tag', { scope: 'library' });
  await h.controller.waitForIdle();
  assert.equal(h.state.run?.status, 'paused');
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests.every(url => url.startsWith('https://api.deepseek.com/')));
  assert.deepEqual(h.tags(), [{ tag: 'Project manuscript', type: 0 }]);
  assert.equal(h.state.suggestions.length, 0);
  assert.ok(h.state.run!.spentUSD > 0, 'failed requests retain the conservative budget reservation');
  await h.controller.invoke('save-settings', { settings: { ...h.state.settings, provider: 'chatgpt', model: 'explicit-plan-model' } });
  const snapshot = await h.controller.snapshot();
  assert.equal(snapshot.queue.provider, 'deepseek', 'a paused paid run retains its billing identity until explicit resume');
  assert.ok(snapshot.queue.spentUSD! > 0);
});
