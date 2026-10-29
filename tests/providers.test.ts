import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { ProviderClient, ProviderError, readResponsesStream } from "../src/providers.ts";
import type { ProviderEnvironment, CallbackResponse, ProviderSettings } from "../src/providers.ts";

const crypto = webcrypto as unknown as Crypto;
const NOW = 1_790_000_000_000;
const encoder = new TextEncoder();
const settings: ProviderSettings = { mode: "api", model: "test-model", inputCostPerMillion: 1, outputCostPerMillion: 4 };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "x-request-id": "request-test" } });
}
function sse(events: unknown[], chunkSize = 17): Response {
  const bytes = encoder.encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream", "x-request-id": "request-test" } });
}
function completed(text = '{"ok":true}'): Response {
  return sse([{ type: "response.output_text.delta", delta: text }, { type: "response.completed", response: { status: "completed", usage: { input_tokens: 10, output_tokens: 5 } } }]);
}
function harness(fetcher: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const credentials = new Map<string, string>(), metadata = new Map<string, string>();
  let externalURL = "", disposed = 0;
  let callback: ((query: Record<string, string>) => Promise<CallbackResponse>) | undefined;
  const env: ProviderEnvironment = {
    fetch: ((input: RequestInfo | URL, init: RequestInit = {}) => fetcher(String(input), init)) as typeof fetch,
    crypto, now: () => NOW,
    credentials: { load: async key => credentials.get(key) ?? null, save: async (key, value) => { credentials.set(key, value); }, remove: async key => { credentials.delete(key); } },
    metadata: { get: async key => metadata.get(key) ?? null, set: async (key, value) => { metadata.set(key, value); } },
    openExternal: url => { externalURL = url; },
    registerCallback: async (path, handler) => {
      assert.equal(path, "/smart-tags/oauth/callback"); callback = handler;
      return { port: 23119, dispose: () => { disposed++; } };
    },
  };
  return { env, credentials, metadata, client: new ProviderClient(env), externalURL: () => externalURL, callback: (query: Record<string, string>) => {
    assert.ok(callback); return callback!(query);
  }, disposed: () => disposed };
}
async function waitForURL(h: ReturnType<typeof harness>): Promise<URL> {
  for (let i = 0; i < 100; i++) { if (h.externalURL()) return new URL(h.externalURL()); await new Promise(resolve => setTimeout(resolve, 1)); }
  throw new Error("Browser authorization was not opened.");
}
function encode(bytes: Uint8Array): string { return Buffer.from(bytes).toString("base64url"); }
const signingKeys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const publicKey = { ...await crypto.subtle.exportKey("jwk", signingKeys.publicKey), kid: "test-key", use: "sig", alg: "RS256" };
async function identityToken(nonce: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const header = encode(encoder.encode(JSON.stringify({ alg: "RS256", kid: "test-key" })));
  const payload = encode(encoder.encode(JSON.stringify({ iss: "https://auth.openai.com", aud: "oaiapp_test123", sub: "subject-test", email: "test@example.com", exp: NOW / 1000 + 3600, nonce, ...overrides })));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKeys.privateKey, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${encode(new Uint8Array(signature))}`;
}
function seedAccount(h: ReturnType<typeof harness>, overrides: Record<string, unknown> = {}) {
  const account = { id: "oaiapp_test123", clientId: "oaiapp_test123", email: "test@example.com", subject: "subject-test", label: "Test account" };
  h.metadata.set("chatgpt.accounts", JSON.stringify([account])); h.metadata.set("chatgpt.active", account.id);
  h.credentials.set("chatgpt:oaiapp_test123", JSON.stringify({ clientId: account.clientId, issuer: "https://auth.openai.com", subject: account.subject, email: account.email, accessToken: "plan-access-token", refreshToken: "plan-refresh-token", idToken: "old-id-token", scopes: ["chatgpt.tokens.use.direct", "resource.invoke"], expiresAt: NOW + 3600000, ...overrides }));
}

test("API inference uses only the explicitly selected key, reports usage/cost, and accepts completed JSON", async () => {
  let requestBody: any;
  const h = harness((url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal((init.headers as any).Authorization, "Bearer api-secret");
    requestBody = JSON.parse(String(init.body)); return completed();
  });
  await h.client.setApiKey("api-secret");
  const result = await h.client.completeJson("Classify", "A paper", settings);
  assert.deepEqual(result.value, { ok: true });
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5 });
  assert.equal(result.estimatedCostUSD, 0.00003);
  assert.equal(requestBody.stream, true); assert.equal(requestBody.store, false);
  assert.equal(requestBody.max_output_tokens, 4096); assert.ok(Array.isArray(requestBody.input));
  assert.equal(requestBody.input[0].role, "user"); assert.equal(requestBody.background, undefined);
});

test("ChatGPT discovers the account catalog, uses the plan bearer token, and omits unsupported API fields", async () => {
  const requests: any[] = [];
  const h = harness((url, init) => {
    assert.equal((init.headers as any).Authorization, "Bearer plan-access-token");
    if (url.endsWith("/models")) return json({ models: [{ slug: "hidden", display_name: "Hidden", visibility: "hide" }, { slug: "plan-model", display_name: "Plan model", visibility: "list" }] });
    requests.push(JSON.parse(String(init.body))); return completed();
  });
  seedAccount(h); await h.client.setApiKey("paid-api-must-not-be-used");
  const models = await h.client.listModels("chatgpt");
  assert.deepEqual(models, [{ id: "plan-model", name: "Plan model" }]);
  const result = await h.client.completeJson("Classify", "A paper", { ...settings, mode: "chatgpt", model: "plan-model", maxOutputTokens: 5000 });
  assert.equal(result.estimatedCostUSD, null);
  assert.equal(requests[0].max_output_tokens, undefined);
  for (const forbidden of ["temperature", "background", "metadata", "conversation", "previous_response_id", "max_tool_calls"]) assert.equal(requests[0][forbidden], undefined);
});

test("ChatGPT identity without inference permission cannot silently charge the API key", async () => {
  let calls = 0;
  const h = harness(() => { calls++; throw new Error("No network should be called"); });
  seedAccount(h, { scopes: ["openid", "profile"] });
  await h.client.setApiKey("paid-api-must-not-be-used");
  await assert.rejects(() => h.client.completeJson("Classify", "A paper", { ...settings, mode: "chatgpt" }), (error: any) => error.category === "permission");
  assert.equal(calls, 0);
});

test("model discovery failures retain status/category/request ID and never try a paid fallback", async () => {
  let calls = 0;
  const h = harness(() => { calls++; return json({ detail: "Serving region is unavailable" }, 403); });
  seedAccount(h); await h.client.setApiKey("other-key");
  await assert.rejects(() => h.client.listModels("chatgpt"), (error: any) => error instanceof ProviderError && error.status === 403 && error.category === "permission" && error.requestId === "request-test");
  assert.equal(calls, 1);
});

test("API catalog preserves explicit model IDs", async () => {
  const h = harness(() => json({ data: [{ id: "model-b" }, { id: "model-a" }] }));
  await h.client.setApiKey("key");
  assert.deepEqual(await h.client.listModels("api"), [{ id: "model-a", name: "model-a" }, { id: "model-b", name: "model-b" }]);
});

test("SSE handles split UTF-8, CRLF, comments, multi-line data, and output supplied at completion", async () => {
  const raw = ': heartbeat\r\nevent: ignored\r\ndata: {"type":"response.completed",\r\ndata: "response":{"status":"completed","output":[{"content":[{"type":"output_text","text":"catalyst μm"}]}]}}\r\n\r\n';
  const bytes = encoder.encode(raw);
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }));
  const result = await readResponsesStream(response);
  assert.equal(result.text, "catalyst μm"); assert.equal(result.usageKnown, false);
});

test("partial output and [DONE] alone are never accepted", async () => {
  await assert.rejects(() => readResponsesStream(sse([{ type: "response.output_text.delta", delta: '{"ok":true}' }])), (error: any) => error.category === "network");
  await assert.rejects(() => readResponsesStream(new Response("data: [DONE]\n\n")), /response.completed/);
});

test("mid-stream usage-limit errors pause instead of returning partial tags", async () => {
  await assert.rejects(() => readResponsesStream(sse([{ type: "response.output_text.delta", delta: "partial" }, { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "Usage limit reached" } } }])), (error: any) => error.category === "quota" && error.code === "subscription_sharing_usage_limit_exceeded");
});

test("incomplete streams and malformed JSON produce no usable result", async () => {
  await assert.rejects(() => readResponsesStream(sse([{ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }])), /incomplete/);
  const h = harness(() => completed("Not a JSON response")); await h.client.setApiKey("key");
  await assert.rejects(() => h.client.completeJson("Classify", "paper", settings), (error: any) => error.category === "invalid-response");
});

test('malformed completed model output remains an invalid response with exact bounded text and known usage',async()=>{
  const raw='  This is not JSON.\nA completed model answer.  ',h=harness(()=>completed(raw));await h.client.setApiKey('private-api-key');
  await assert.rejects(()=>h.client.completeJson('Classify','paper',settings),(error:unknown)=>{
    assert.ok(error instanceof ProviderError);assert.equal(error.category,'invalid-response');assert.equal(error.rawText,raw);assert.equal(error.completion!.text,raw);
    assert.deepEqual(error.completion!.usage,{inputTokens:10,outputTokens:5});assert.equal(error.completion!.usageKnown,true);assert.equal(error.completion!.estimatedCostUSD,0.00003);assert.equal(error.completion!.requestId,'request-test');
    assert.equal(Object.hasOwn(error.completion!,'value'),false);assert.equal(JSON.stringify(error).includes('private-api-key'),false);return true;
  });
});

test('malformed model output with unavailable usage never claims free API inference',async()=>{
  const h=harness(()=>sse([{type:'response.output_text.delta',delta:'Malformed answer'},{type:'response.completed',response:{status:'completed'}}]));await h.client.setApiKey('private-key');
  await assert.rejects(()=>h.client.completeJson('Classify','paper',settings),(error:unknown)=>{assert.ok(error instanceof ProviderError);assert.equal(error.rawText,'Malformed answer');assert.equal(error.completion!.usageKnown,false);assert.equal(error.completion!.estimatedCostUSD,null);return true;});
});

test('HTTP authentication errors never retain transport bodies as model output',async()=>{
  const h=harness(()=>json({error:{message:'Unauthorized HTTP body must not become model evidence',code:'invalid_api_key'}},401));await h.client.setApiKey('private-api-key');
  await assert.rejects(()=>h.client.completeJson('Classify','paper',settings),(error:unknown)=>{assert.ok(error instanceof ProviderError);assert.equal(error.category,'authentication');assert.equal(error.rawText,undefined);assert.equal(error.completion,undefined);return true;});
});

test('retained malformed model text is capped by UTF-8 bytes without attaching diagnostics to authentication errors',()=>{
  const text='μ'.repeat(1_100_000),completion={text,usage:{inputTokens:10,outputTokens:5},usageKnown:true,estimatedCostUSD:0.00003};
  const error=new ProviderError('Malformed','invalid-response',{rawText:text,completion});assert.equal(encoder.encode(error.rawText!).byteLength,2_000_000);assert.equal(encoder.encode(error.completion!.text).byteLength,2_000_000);assert.ok(!error.rawText!.includes('\uFFFD'));
  const auth=new ProviderError('Unauthorized','authentication',{rawText:text,completion});assert.equal(auth.rawText,undefined);assert.equal(auth.completion,undefined);
});

test("OAuth dynamically registers, validates signature and nonce, then persists an isolated connection", async () => {
  let exchange: URLSearchParams | undefined;
  let h: ReturnType<typeof harness>;
  h = harness(async (url, init) => {
    if (url.endsWith("/oauth/token")) {
      exchange = new URLSearchParams(String(init.body));
      const nonce = new URL(h.externalURL()).searchParams.get("nonce")!;
      return json({ access_token: "access", refresh_token: "refresh", id_token: await identityToken(nonce), token_type: "Bearer", expires_in: 3600, scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct" });
    }
    if (url.endsWith("openid-configuration")) return json({ issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/keys", revocation_endpoint: "https://auth.openai.com/revoke" });
    if (url.endsWith("/keys")) return json({ keys: [publicKey] });
    throw new Error(`Unexpected URL ${url}`);
  });
  const login = h.client.signIn();
  const auth = await waitForURL(h);
  assert.equal(auth.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  assert.equal(auth.searchParams.get("agent_name_hint"), "Smart Tags for Zotero");
  assert.match(auth.searchParams.get("ext_agent_host_id")!, /^urn:uuid:/);
  const invalid = await h.callback({ state: "wrong-state", code: "code", client_id: "oaiapp_test123" });
  assert.equal(invalid.status, 400); assert.equal(h.disposed(), 0);
  const response = await h.callback({ state: auth.searchParams.get("state")!, code: "code", client_id: "oaiapp_test123" });
  assert.equal(response.status, 200);
  const session = await login;
  assert.equal(session.connected, true); assert.equal(session.sharing, true); assert.equal(session.email, "test@example.com");
  assert.equal(exchange!.get("client_id"), "oaiapp_test123");
  assert.equal(exchange!.get("redirect_uri"), "http://127.0.0.1:23119/smart-tags/oauth/callback");
  assert.ok(exchange!.get("code_verifier")); assert.equal(exchange!.get("client_secret"), null);
  assert.equal(h.disposed(), 1);
  assert.ok(h.credentials.has("chatgpt:oaiapp_test123"));
  assert.ok(!JSON.stringify([...h.metadata]).includes("access_token"));
  assert.equal((await h.callback({ state: auth.searchParams.get("state")!, code: "replayed", client_id: "oaiapp_test123" })).status, 400);
});

test("OAuth rejects signed tokens with the wrong nonce or audience", async t => {
  for (const overrides of [{ nonce: "wrong" }, { aud: "attacker-client" }, { exp: NOW / 1000 - 1000 }]) {
    await t.test(JSON.stringify(overrides), async () => {
      let h: ReturnType<typeof harness>;
      h = harness(async url => {
        if (url.endsWith("/oauth/token")) return json({ access_token: "access", expires_in: 3600, scope: "resource.invoke chatgpt.tokens.use.direct", id_token: await identityToken(new URL(h.externalURL()).searchParams.get("nonce")!, overrides) });
        if (url.endsWith("openid-configuration")) return json({ issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/keys" });
        return json({ keys: [publicKey] });
      });
      const login = h.client.signIn(); const rejected = assert.rejects(login, (error: any) => error.category === "authentication");
      const auth = await waitForURL(h);
      assert.equal((await h.callback({ state: auth.searchParams.get("state")!, code: "code", client_id: "oaiapp_test123" })).status, 400);
      await rejected; assert.equal(h.credentials.size, 0);
    });
  }
});

test("OAuth rejects tampered JWT signatures", async () => {
  let h: ReturnType<typeof harness>;
  h = harness(async url => {
    if (url.endsWith("/oauth/token")) {
      const token = await identityToken(new URL(h.externalURL()).searchParams.get("nonce")!);
      const parts = token.split("."); parts[1] = encode(encoder.encode(JSON.stringify({ iss: "https://auth.openai.com", aud: "oaiapp_test123", sub: "attacker", exp: NOW / 1000 + 3600 })));
      return json({ access_token: "access", expires_in: 3600, id_token: parts.join(".") });
    }
    if (url.endsWith("openid-configuration")) return json({ issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/keys" });
    return json({ keys: [publicKey] });
  });
  const login = h.client.signIn(); const rejected = assert.rejects(login, /signature/);
  const auth = await waitForURL(h); await h.callback({ state: auth.searchParams.get("state")!, code: "code", client_id: "oaiapp_test123" }); await rejected;
  assert.equal(h.credentials.size, 0);
});

test("returning sign-in retains registration/host and rejects a different returned client ID", async () => {
  let calls = 0;
  const h = harness(() => { calls++; throw new Error("No exchange permitted"); }); seedAccount(h);
  h.metadata.set("chatgpt.hostId", "urn:uuid:11111111-1111-4111-8111-111111111111");
  h.metadata.set("chatgpt.pendingClientId", "oaiapp_stale_other_workspace");
  const login = h.client.signIn(); const rejected = assert.rejects(login, /different client/);
  const auth = await waitForURL(h);
  assert.equal(auth.searchParams.get("client_id"), "oaiapp_test123");
  assert.equal(auth.searchParams.get("agent_name_hint"), null);
  assert.equal(auth.searchParams.get("id_token_hint"), "old-id-token");
  assert.equal(auth.searchParams.get("login_hint"), "test@example.com");
  await h.callback({ state: auth.searchParams.get("state")!, code: "code", client_id: "oaiapp_wrong" });
  await rejected; assert.equal(calls, 0); assert.equal((await h.client.getSession()).email, "test@example.com");
});

test("adding a ChatGPT account starts fresh without changing saved connections when cancelled", async t => {
  for (const hasActiveAccount of [true, false]) {
    await t.test(hasActiveAccount ? "active registration and stale pending registration" : "stale pending registration only", async () => {
      let calls = 0;
      const h = harness(() => { calls++; throw new Error("No exchange permitted"); });
      if (hasActiveAccount) seedAccount(h);
      const hostId = "urn:uuid:11111111-1111-4111-8111-111111111111";
      h.metadata.set("chatgpt.hostId", hostId);
      h.metadata.set("chatgpt.pendingClientId", "oaiapp_stale_other_workspace");
      const savedMetadata = new Map(h.metadata), savedCredentials = new Map(h.credentials);
      const login = h.client.signIn({ newAccount: true });
      const cancelled = assert.rejects(login, (error: unknown) => error instanceof ProviderError && error.category === "cancelled");
      const auth = await waitForURL(h);
      assert.equal(auth.searchParams.get("client_id"), "dynamic_agent_client");
      assert.equal(auth.searchParams.get("agent_name_hint"), "Smart Tags for Zotero");
      assert.equal(auth.searchParams.get("ext_agent_host_id"), hostId);
      assert.equal(auth.searchParams.get("id_token_hint"), null);
      assert.equal(auth.searchParams.get("login_hint"), null);
      h.client.cancelSignIn(); await cancelled;
      assert.deepEqual(h.metadata, savedMetadata);
      assert.deepEqual(h.credentials, savedCredentials);
      assert.equal((await h.client.getSession()).accountId, hasActiveAccount ? "oaiapp_test123" : null);
      assert.equal(h.disposed(), 1); assert.equal(calls, 0);
    });
  }
});

test("ordinary Continue retries the pending issued registration when no account is selected", async () => {
  let calls = 0;
  const h = harness(() => { calls++; throw new Error("No exchange permitted"); });
  seedAccount(h); h.metadata.delete("chatgpt.active");
  const hostId = "urn:uuid:11111111-1111-4111-8111-111111111111";
  h.metadata.set("chatgpt.hostId", hostId);
  h.metadata.set("chatgpt.pendingClientId", "oaiapp_pending_workspace");
  const savedMetadata = new Map(h.metadata), savedCredentials = new Map(h.credentials);
  const login = h.client.signIn();
  const cancelled = assert.rejects(login, (error: unknown) => error instanceof ProviderError && error.category === "cancelled");
  const auth = await waitForURL(h);
  assert.equal(auth.searchParams.get("client_id"), "oaiapp_pending_workspace");
  assert.equal(auth.searchParams.get("ext_agent_host_id"), hostId);
  assert.equal(auth.searchParams.get("agent_name_hint"), null);
  assert.equal(auth.searchParams.get("id_token_hint"), null);
  assert.equal(auth.searchParams.get("login_hint"), null);
  h.client.cancelSignIn(); await cancelled;
  assert.deepEqual(h.metadata, savedMetadata); assert.deepEqual(h.credentials, savedCredentials);
  assert.equal(calls, 0);
});

test("OAuth access-denied and local cancellation remove callback listeners", async () => {
  const h = harness(() => { throw new Error("No network should run"); });
  const login = h.client.signIn(); const rejected = assert.rejects(login, /declined/);
  const auth = await waitForURL(h);
  await h.callback({ state: auth.searchParams.get("state")!, error: "access_denied" }); await rejected;
  assert.equal(h.disposed(), 1);
  const loginAgain = h.client.signIn(); const cancelled = assert.rejects(loginAgain, (error: any) => error.category === "cancelled");
  for (let i = 0; i < 20 && h.disposed() === 1; i++) { await new Promise(resolve => setTimeout(resolve, 1)); h.client.cancelSignIn(); }
  await cancelled; assert.equal(h.disposed(), 2);
});

test("rotating refresh is serialized and replacement credentials are stored together", async () => {
  let refreshCount = 0;
  const h = harness(async (url, init) => {
    if (url.endsWith("/oauth/token")) {
      refreshCount++; const fields = new URLSearchParams(String(init.body));
      assert.equal(fields.get("client_id"), "oaiapp_test123"); assert.equal(fields.get("refresh_token"), "plan-refresh-token"); assert.equal(fields.get("scope"), null);
      await new Promise(resolve => setTimeout(resolve, 10));
      return json({ access_token: "replacement-access", refresh_token: "replacement-refresh", expires_in: 3600, token_type: "Bearer" });
    }
    assert.equal((init.headers as any).Authorization, "Bearer replacement-access");
    return json({ models: [{ slug: "plan-model", visibility: "list" }] });
  });
  seedAccount(h, { expiresAt: NOW - 1 });
  await Promise.all([h.client.listModels("chatgpt"), h.client.listModels("chatgpt")]);
  assert.equal(refreshCount, 1);
  const saved = JSON.parse(h.credentials.get("chatgpt:oaiapp_test123")!);
  assert.equal(saved.accessToken, "replacement-access"); assert.equal(saved.refreshToken, "replacement-refresh");
  assert.deepEqual(saved.scopes, ["chatgpt.tokens.use.direct", "resource.invoke"]);
});

test("sign-out revokes only this registration and retains nonsecret registration metadata", async () => {
  let revoked = false;
  const h = harness((url, init) => {
    if (url.endsWith("openid-configuration")) return json({ issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/keys", revocation_endpoint: "https://auth.openai.com/revoke" });
    const fields = new URLSearchParams(String(init.body)); assert.equal(fields.get("token_type_hint"), "refresh_token");
    assert.equal(fields.get("client_id"), "oaiapp_test123"); revoked = true; return new Response("", { status: 200 });
  });
  seedAccount(h); await h.client.setApiKey("independent-api-key");
  assert.deepEqual(await h.client.signOut(), { revoked: true }); assert.equal(revoked, true);
  assert.equal((await h.client.getSession()).connected, false); assert.equal((await h.client.getSession()).accounts.length, 1);
  assert.equal(await h.client.hasApiKey(), true);
});

test("unknown sign-in model is rejected before inference", async () => {
  let calls = 0;
  const h = harness(() => { calls++; return json({ models: [{ slug: "allowed", visibility: "list" }] }); }); seedAccount(h);
  await assert.rejects(() => h.client.completeJson("Classify", "paper", { ...settings, mode: "chatgpt", model: "other" }), /not available/);
  assert.equal(calls, 1);
});

test("request cancellation discards streamed text", async () => {
  const controller = new AbortController();
  const response = new Response(new ReadableStream({ start(stream) { stream.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')); } }));
  const result = readResponsesStream(response, controller.signal);
  controller.abort();
  await assert.rejects(result, (error: any) => error.category === "cancelled");
});

test("disposing the extension aborts in-flight inference without accepting partial output", async () => {
  let streaming!: () => void;
  const started = new Promise<void>(resolve => { streaming = resolve; });
  const h = harness(() => new Response(new ReadableStream({ start(stream) {
    stream.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n'));
    streaming();
  } })));
  await h.client.setApiKey("key");
  const result = h.client.completeJson("Classify", "paper", settings);
  const rejected = assert.rejects(result, (error: any) => error.category === "cancelled");
  await started; h.client.dispose(); await rejected;
});

test("disposing during an OAuth code exchange settles both login and callback without saving credentials", async () => {
  let tokenRequestStarted!: () => void;
  const started = new Promise<void>(resolve => { tokenRequestStarted = resolve; });
  const h = harness((_url, init) => new Promise<Response>((_resolve, reject) => {
    const fail = () => reject(new DOMException('Aborted', 'AbortError'));
    init.signal?.addEventListener('abort', fail, { once: true });
    tokenRequestStarted();
  }));
  const login = h.client.signIn();
  const rejected = assert.rejects(login, (error: any) => error.category === 'cancelled');
  const auth = await waitForURL(h);
  const callback = h.callback({ state: auth.searchParams.get('state')!, code: 'code', client_id: 'oaiapp_test123' });
  await started;
  await h.client.dispose();
  await rejected;
  assert.equal((await callback).status, 400);
  assert.equal(h.credentials.size, 0);
  assert.equal(h.disposed(), 1);
  await assert.rejects(() => h.client.listModels('api'), (error: any) => error.category === 'cancelled');
});

test("disposing aborts a model catalog whose JSON body has not finished", async () => {
  let bodyOpened!: () => void;
  const started = new Promise<void>(resolve => { bodyOpened = resolve; });
  const h = harness((_url, init) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('{"data":['));
    init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    bodyOpened();
  } }), { headers: { 'Content-Type': 'application/json' } }));
  await h.client.setApiKey('key');
  const catalog = h.client.listModels('api');
  const rejected = assert.rejects(catalog, (error: any) => error.category === 'cancelled');
  await started; await h.client.dispose(); await rejected;
});

test("disposing while the loopback listener starts never opens the browser or leaks its route", async () => {
  const h = harness(() => { throw new Error('No network permitted'); });
  let release!: () => void, listenerStarted!: () => void, disposed = 0;
  const started = new Promise<void>(resolve => { listenerStarted = resolve; });
  h.env.registerCallback = async () => {
    listenerStarted();
    await new Promise<void>(resolve => { release = resolve; });
    return { port: 23119, dispose: () => { disposed++; } };
  };
  const login = h.client.signIn();
  const rejected = assert.rejects(login, (error: any) => error.category === 'cancelled');
  await started; await h.client.dispose(); release(); await rejected;
  assert.equal(disposed, 1); assert.equal(h.externalURL(), '');
});
