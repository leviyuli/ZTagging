import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { ProviderClient, ProviderError } from '../src/providers.ts';
import type { ProviderEnvironment, ProviderSettings } from '../src/providers.ts';

const crypto = webcrypto as unknown as Crypto;
const encoder = new TextEncoder();
const settings: ProviderSettings = { mode: 'deepseek', model: 'discovered-test-model', maxOutputTokens: 2000, inputCostPerMillion: 1.5, outputCostPerMillion: 3.2 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'x-request-id': 'deepseek-test-request' } });
function reply(content: unknown = '{"ok":true}', overrides: Record<string, unknown> = {}) {
  return { id: 'completion-test', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 100, completion_tokens: 50 }, ...overrides };
}
function harness(fetcher: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const credentials = new Map<string, string>(), metadata = new Map<string, string>();
  const calls: { url: string; init: RequestInit }[] = [];
  const env: ProviderEnvironment = {
    crypto,
    fetch: ((input: RequestInfo | URL, init: RequestInit = {}) => { calls.push({ url: String(input), init }); return fetcher(String(input), init); }) as typeof fetch,
    credentials: { load: async key => credentials.get(key) ?? null, save: async (key, value) => { credentials.set(key, value); }, remove: async key => { credentials.delete(key); } },
    metadata: { get: async key => metadata.get(key) ?? null, set: async (key, value) => { metadata.set(key, value); } },
    openExternal: () => { throw new Error('DeepSeek must not open OAuth'); },
    registerCallback: async () => { throw new Error('DeepSeek must not register OAuth'); },
  };
  return { client: new ProviderClient(env), calls, credentials };
}
const rejectsInvalid = (operation: () => Promise<unknown>) => assert.rejects(operation, (error: unknown) => error instanceof ProviderError && error.category === 'invalid-response' && error.message.includes('DeepSeek'));

test('DeepSeek keys are normalized and stored independently from the backwards-compatible OpenAI slot', async () => {
  const h = harness(() => { throw new Error('No requests expected'); });
  assert.equal(await h.client.hasApiKey(), false); assert.equal(await h.client.hasApiKey('deepseek'), false);
  await h.client.setApiKey('  openai-key  ');
  await h.client.setApiKey('  deepseek-key  ', 'deepseek');
  assert.equal(h.credentials.get('api-key'), 'openai-key'); assert.equal(h.credentials.get('deepseek-api-key'), 'deepseek-key');
  assert.equal(await h.client.hasApiKey(), true); assert.equal(await h.client.hasApiKey('deepseek'), true);
  await h.client.removeApiKey('deepseek');
  assert.equal(await h.client.hasApiKey('deepseek'), false); assert.equal(await h.client.hasApiKey(), true);
  await assert.rejects(() => h.client.setApiKey('key with spaces', 'deepseek'), /without spaces/);
  await assert.rejects(() => h.client.setApiKey('key', 'chatgpt' as any), /OpenAI API or DeepSeek/);
  assert.equal(h.calls.length, 0);
});

test('DeepSeek JSON requests use its endpoint, own bearer key, disabled thinking, and bounded non-streaming chat body', async () => {
  let body: any;
  const h = harness((url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal((init.headers as any).Authorization, 'Bearer deepseek-secret');
    body = JSON.parse(String(init.body)); return json(reply());
  });
  await h.client.setApiKey('openai-secret'); await h.client.setApiKey('deepseek-secret', 'deepseek');
  const result = await h.client.completeJson('Classify this paper', 'Title and abstract', settings);
  assert.deepEqual(result.value, { ok: true }); assert.equal(result.text, '{"ok":true}');
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 50 }); assert.equal(result.usageKnown, true);
  assert.ok(Math.abs(result.estimatedCostUSD! - 0.00031) < 1e-12);
  assert.equal(result.requestId, 'deepseek-test-request');
  assert.equal(body.model, 'discovered-test-model'); assert.equal(body.max_tokens, 2000); assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, { type: 'json_object' }); assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.messages[0].role, 'system'); assert.match(body.messages[0].content, /JSON object/);
  assert.equal(body.messages[1].role, 'user'); assert.equal(body.messages[1].content, 'Title and abstract');
  for (const absent of ['input', 'instructions', 'store', 'max_output_tokens', 'reasoning_content', 'tools', 'temperature']) assert.equal(body[absent], undefined);
});

test('DeepSeek respects a small configured output cap and bounds oversized caps', async () => {
  const limits: number[] = [];
  const h = harness((_url, init) => { limits.push(JSON.parse(String(init.body)).max_tokens); return json(reply()); });
  await h.client.setApiKey('key', 'deepseek');
  await h.client.completeJson('JSON', 'paper', { ...settings, maxOutputTokens: 42 });
  await h.client.completeJson('JSON', 'paper', { ...settings, maxOutputTokens: 1_000_000 });
  assert.deepEqual(limits, [42, 32768]);
  await assert.rejects(() => h.client.completeJson('JSON', 'paper', { ...settings, maxOutputTokens: 0 }), /positive DeepSeek/);
});

test('DeepSeek model discovery reads dynamic server IDs with its own key and preserves OpenAI route separation', async () => {
  const h = harness((url, init) => {
    if (url === 'https://api.deepseek.com/models') {
      assert.equal((init.headers as any).Authorization, 'Bearer deepseek-key');
      return json({ data: [{ id: 'future-model-z' }, { id: 'future-model-a' }] });
    }
    assert.equal(url, 'https://api.openai.com/v1/models'); assert.equal((init.headers as any).Authorization, 'Bearer openai-key');
    return json({ data: [{ id: 'openai-model' }] });
  });
  await h.client.setApiKey('openai-key'); await h.client.setApiKey('deepseek-key', 'deepseek');
  assert.deepEqual(await h.client.listModels('deepseek'), [{ id: 'future-model-a', name: 'future-model-a' }, { id: 'future-model-z', name: 'future-model-z' }]);
  assert.deepEqual(await h.client.listModels('api'), [{ id: 'openai-model', name: 'openai-model' }]);
  assert.equal(h.calls.length, 2);
});

test('a missing DeepSeek key never falls back to an OpenAI key, and vice versa', async () => {
  const h = harness(() => { throw new Error('No request permitted'); });
  await h.client.setApiKey('only-openai-key');
  await assert.rejects(() => h.client.completeJson('JSON', 'paper', settings), /DeepSeek API key/);
  await h.client.removeApiKey(); await h.client.setApiKey('only-deepseek-key', 'deepseek');
  await assert.rejects(() => h.client.completeJson('JSON', 'paper', { ...settings, mode: 'api' }), /OpenAI API key/);
  assert.equal(h.calls.length, 0);
});

test('DeepSeek HTTP errors retain category/status/request ID, identify the provider, and never retry another route', async t => {
  for (const [status, category] of [[401, 'authentication'], [402, 'quota'], [429, 'quota'], [403, 'permission'], [500, 'network']] as const) {
    await t.test(String(status), async () => {
      const h = harness(() => json({ error: { code: 'test_error', message: 'DeepSeek service message' } }, status));
      await h.client.setApiKey('paid-openai-key'); await h.client.setApiKey('deepseek-key', 'deepseek');
      await assert.rejects(() => h.client.completeJson('JSON', 'paper', settings), (error: any) => error.category === category && error.status === status && error.requestId === 'deepseek-test-request' && error.message.startsWith('DeepSeek'));
      assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, 'https://api.deepseek.com/chat/completions');
    });
  }
});

test('DeepSeek network failures and non-JSON payment errors stay provider-specific', async () => {
  const offline = harness(() => { throw new Error('sensitive transport detail'); });
  await offline.client.setApiKey('key', 'deepseek');
  await assert.rejects(() => offline.client.completeJson('JSON', 'paper', settings), (error: any) => error.category === 'network' && error.message.includes('DeepSeek') && !error.message.includes('sensitive'));
  const billing = harness(() => new Response('Payment required', { status: 402 }));
  await billing.client.setApiKey('key', 'deepseek');
  await assert.rejects(() => billing.client.listModels('deepseek'), (error: any) => error.category === 'quota' && error.status === 402 && error.message.includes('DeepSeek'));
});

test('DeepSeek service error messages redact echoed credentials', async () => {
  const h = harness(() => json({ error: { message: 'Invalid Bearer sk-secret-token and sk-another-secret' } }, 401));
  await h.client.setApiKey('key', 'deepseek');
  await assert.rejects(() => h.client.completeJson('JSON', 'paper', settings), (error: any) => !error.message.includes('sk-secret-token') && !error.message.includes('sk-another-secret'));
});

test('DeepSeek rejects every non-stop finish reason even if partial content looks valid', async t => {
  for (const reason of ['length', 'content_filter', 'tool_calls', 'aborted', 'insufficient_system_resource', undefined]) {
    await t.test(String(reason), async () => {
      const data = reply(); data.choices[0].finish_reason = reason as any;
      const h = harness(() => json(data)); await h.client.setApiKey('key', 'deepseek');
      await rejectsInvalid(() => h.client.completeJson('JSON', 'paper', settings));
    });
  }
});

test('DeepSeek rejects empty, malformed, fenced, non-object, or missing content', async t => {
  for (const content of ['', '   ', null, undefined, '{bad json', '```json\n{"ok":true}\n```', '[]', 'null', '1', 'true']) {
    await t.test(String(content), async () => {
      const data = reply(); data.choices[0].message.content = content;
      const h = harness(() => json(data)); await h.client.setApiKey('key', 'deepseek');
      await rejectsInvalid(() => h.client.completeJson('JSON', 'paper', settings));
    });
  }
});

test('DeepSeek malformed completed model content preserves only final text and completed usage metadata',async()=>{
  const text='  {bad JSON\n  ',h=harness(()=>json(reply(text,{choices:[{finish_reason:'stop',message:{role:'assistant',content:text,reasoning_content:'Private reasoning must never enter diagnostics'}}]})));
  await h.client.setApiKey('private-deepseek-key','deepseek');
  await assert.rejects(()=>h.client.completeJson('JSON','paper',settings),(error:unknown)=>{
    assert.ok(error instanceof ProviderError);assert.equal(error.category,'invalid-response');assert.equal(error.rawText,text);assert.equal(error.completion!.text,text);assert.deepEqual(error.completion!.usage,{inputTokens:100,outputTokens:50});assert.equal(error.completion!.usageKnown,true);assert.equal(error.completion!.estimatedCostUSD,0.00031);
    assert.equal(error.completion!.requestId,'deepseek-test-request');assert.equal(JSON.stringify(error).includes('Private reasoning'),false);assert.equal(JSON.stringify(error).includes('private-deepseek-key'),false);return true;
  });
});

test('DeepSeek truncated model text remains rejected diagnostic text without completed-inference metadata',async()=>{
  const text='{"incomplete":',h=harness(()=>json(reply(text,{choices:[{finish_reason:'length',message:{role:'assistant',content:text,reasoning_content:'Never retain this'}}]})));await h.client.setApiKey('key','deepseek');
  await assert.rejects(()=>h.client.completeJson('JSON','paper',settings),(error:unknown)=>{assert.ok(error instanceof ProviderError);assert.equal(error.category,'invalid-response');assert.equal(error.rawText,text);assert.equal(error.completion,undefined);assert.equal(JSON.stringify(error).includes('Never retain this'),false);return true;});
});

test('DeepSeek HTTP errors and reasoning-only messages never supply raw model diagnostics',async()=>{
  for(const response of [()=>json({error:{message:'Unauthorized private HTTP body'}},401),()=>json(reply(null,{choices:[{finish_reason:'stop',message:{role:'assistant',content:null,reasoning_content:'Secret reasoning'}}]}))]){
    const h=harness(response);await h.client.setApiKey('key','deepseek');
    await assert.rejects(()=>h.client.completeJson('JSON','paper',settings),(error:unknown)=>{assert.ok(error instanceof ProviderError);assert.equal(error.rawText,undefined);assert.equal(error.completion,undefined);assert.equal(JSON.stringify(error).includes('Secret reasoning'),false);return true;});
  }
});

test('DeepSeek rejects tool-call or reasoning-only messages and never reads reasoning_content as an answer', async () => {
  const h = harness(() => json(reply(null, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: null, reasoning_content: '{"ok":true}' } }] })));
  await h.client.setApiKey('key', 'deepseek'); await rejectsInvalid(() => h.client.completeJson('JSON', 'paper', settings));
  const tools = harness(() => json(reply('{"ok":true}', { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}', tool_calls: [{ id: 'call', function: { name: 'tool' } }] } }] })));
  await tools.client.setApiKey('key', 'deepseek'); await rejectsInvalid(() => tools.client.completeJson('JSON', 'paper', settings));
  const answer = harness(() => json(reply('{"answer":"final"}', { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"answer":"final"}', reasoning_content: 'Never expose this reasoning' } }] })));
  await answer.client.setApiKey('key', 'deepseek');
  const result = await answer.client.completeJson('JSON', 'paper', settings);
  assert.deepEqual(result.value, { answer: 'final' }); assert.equal(JSON.stringify(result).includes('reasoning'), false);
});

test('DeepSeek validates the first choice only and refuses malformed completion envelopes', async t => {
  for (const data of [{}, { choices: [] }, { choices: 'not-an-array' }, { choices: [{ finish_reason: 'stop', message: [] }] }, { choices: [{ finish_reason: 'stop', message: { role: 'user', content: '{"ok":true}' } }] }, { choices: [{ finish_reason: 'length', message: { content: '{"bad":true}' } }, { finish_reason: 'stop', message: { content: '{"ok":true}' } }] }]) {
    await t.test(JSON.stringify(data), async () => {
      const h = harness(() => json(data)); await h.client.setApiKey('key', 'deepseek'); await rejectsInvalid(() => h.client.completeJson('JSON', 'paper', settings));
    });
  }
});

test('missing or invalid DeepSeek usage remains unknown instead of appearing as free paid inference', async t => {
  for (const usage of [undefined, null, {}, { prompt_tokens: -1, completion_tokens: 2 }, { prompt_tokens: 1, completion_tokens: '2' }]) {
    await t.test(JSON.stringify(usage), async () => {
      const h = harness(() => json(reply('{"ok":true}', { usage }))); await h.client.setApiKey('key', 'deepseek');
      const result = await h.client.completeJson('JSON', 'paper', settings);
      assert.equal(result.usageKnown, false); assert.equal(result.estimatedCostUSD, null);
    });
  }
});

test('DeepSeek rejects oversized bodies before JSON results become available', async () => {
  const h = harness(() => json(reply(JSON.stringify({ text: 'x'.repeat(2_000_000) }))));
  await h.client.setApiKey('key', 'deepseek');
  await assert.rejects(() => h.client.completeJson('JSON', 'paper', settings), (error: any) => error.category === 'invalid-response' && error.message.includes('size limit'));
});

test('DeepSeek rejects invalid model catalogs rather than silently reusing another provider catalog', async t => {
  for (const data of [{ models: [{ slug: 'openai-format' }] }, { data: 'wrong' }, { data: [{ id: '' }] }, { data: [null] }]) {
    await t.test(JSON.stringify(data), async () => {
      const h = harness(() => json(data)); await h.client.setApiKey('key', 'deepseek');
      await rejectsInvalid(() => h.client.listModels('deepseek'));
    });
  }
});

function pendingBody() {
  let ready!: () => void, close!: (value: unknown) => void, cancelled = false;
  const opened = new Promise<void>(resolve => { ready = resolve; });
  const response = () => new Response(new ReadableStream({ start(controller) {
    close = value => { controller.enqueue(encoder.encode(JSON.stringify(value))); controller.close(); };
    ready();
  }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/json' } });
  return { opened, response, finish: (value: unknown) => close(value), cancelled: () => cancelled };
}

test('removing the OpenAI key does not cancel an active DeepSeek response', async () => {
  const body = pendingBody();
  const h = harness(() => body.response());
  await h.client.setApiKey('openai-key'); await h.client.setApiKey('deepseek-key', 'deepseek');
  const completion = h.client.completeJson('JSON', 'paper', settings);
  await body.opened; await h.client.removeApiKey();
  assert.equal(body.cancelled(), false); body.finish(reply());
  assert.deepEqual((await completion).value, { ok: true });
});

test('replacing the DeepSeek key cancels its active response and accepts no partial result', async () => {
  const body = pendingBody(); const h = harness(() => body.response());
  await h.client.setApiKey('old-key', 'deepseek');
  const completion = h.client.completeJson('JSON', 'paper', settings);
  const rejected = assert.rejects(completion, (error: any) => error.category === 'cancelled');
  await body.opened; await h.client.setApiKey('new-key', 'deepseek'); await rejected;
  assert.equal(body.cancelled(), true); assert.equal(h.credentials.get('deepseek-api-key'), 'new-key');
});

test('external cancellation and disposal abort DeepSeek body reads without stuck promises', async t => {
  for (const kind of ['signal', 'dispose'] as const) {
    await t.test(kind, async () => {
      const body = pendingBody(); const h = harness(() => body.response());
      await h.client.setApiKey('key', 'deepseek');
      const abort = new AbortController();
      const completion = h.client.completeJson('JSON', 'paper', settings, abort.signal);
      const rejected = assert.rejects(completion, (error: any) => error.category === 'cancelled');
      await body.opened;
      await new Promise(resolve => setTimeout(resolve, 1));
      if (kind === 'signal') abort.abort(); else await h.client.dispose();
      await rejected; assert.equal(body.cancelled(), true);
    });
  }
});

test('DeepSeek model body reads are cancelled when its key is removed', async () => {
  const body = pendingBody(); const h = harness(() => body.response());
  await h.client.setApiKey('key', 'deepseek');
  const models = h.client.listModels('deepseek');
  const rejected = assert.rejects(models, (error: any) => error.category === 'cancelled');
  await body.opened; await new Promise(resolve => setTimeout(resolve, 1));
  await h.client.removeApiKey('deepseek'); await rejected; assert.equal(body.cancelled(), true);
});

test('DeepSeek request deadlines remain active while a non-streaming JSON body is pending', async () => {
  const body = pendingBody(); const h = harness(() => body.response());
  await h.client.setApiKey('key', 'deepseek');
  await assert.rejects(() => h.client.completeJson('JSON', 'paper', { ...settings, timeoutMs: 20 }), (error: any) => error.category === 'cancelled');
  assert.equal(body.cancelled(), true);
});

test('DeepSeek connectivity test requires a completed valid ok object and uses the selected backend', async () => {
  const h = harness((url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions'); assert.equal(JSON.parse(String(init.body)).max_tokens, 256);
    return json(reply());
  });
  await h.client.setApiKey('key', 'deepseek');
  assert.deepEqual((await h.client.testConnection(settings)).value, { ok: true }); assert.equal(h.calls.length, 1);
});
