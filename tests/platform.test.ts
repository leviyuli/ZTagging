import test from 'node:test';
import assert from 'node:assert/strict';
import { SecureCredentials, ZoteroHost, registerOAuthCallback, sameTags } from '../src/platform.ts';

function globals(t: any, values: Record<string, unknown>) {
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; } });
}
function item(id: number, options: any = {}) {
  const state = { tags: options.tags ?? [{ tag: 'imported keyword', type: 1 }, { tag: 'manual choice', type: 0 }] };
  return {
    id, key: `KEY${id}`, libraryID: options.libraryID ?? 1, deleted: options.deleted ?? false,
    isRegularItem: () => options.regular !== false,
    getField: (field: string) => field === 'title' ? options.title ?? `Paper ${id}` : '<i>Abstract</i> &amp; evidence',
    getTags: () => state.tags, setTags: (tags: any[]) => { state.tags = tags; }, save: async () => {},
    getAttachments: () => options.attachments ?? [],
  };
}

test('host limits scans to eligible personal-library parent items and preserves source tag roles', async t => {
  const values = [item(1), item(2, { libraryID: 2 }), item(3, { deleted: true }), item(4, { regular: false }), item(1)];
  globals(t, { Zotero: { Libraries: { userLibraryID: 1 }, getActiveZoteroPane: () => null, Items: { getAll: async () => values, getAsync: async (id: number) => values.find(v => v.id === id) } } });
  const host = new ZoteroHost();
  const papers = await host.list('library');
  assert.equal(papers.length, 1); assert.deepEqual(papers[0].keywords, ['imported keyword']);
  assert.equal(papers[0].abstract, 'Abstract & evidence');
  assert.equal(await host.read(2), null);
  await assert.rejects(() => host.readTags(2), /outside your personal library/);
});

test('pilot samples exactly fifty unique eligible papers and selected scope stays selected', async t => {
  const values = Array.from({ length: 140 }, (_, i) => item(i + 1));
  globals(t, { Zotero: { Libraries: { userLibraryID: 1 }, getActiveZoteroPane: () => ({ getSelectedItems: () => [values[3], values[2]] }), Items: { getAll: async () => values } } });
  const host = new ZoteroHost();
  const pilot = await host.list('pilot');
  assert.equal(pilot.length, 50); assert.equal(new Set(pilot.map(p => p.id)).size, 50);
  assert.deepEqual((await host.list('selected')).map(p => p.itemID).sort(), [3, 4]);
});

test('collection scans load descendant membership before traversing unvisited subcollections', async t => {
  function collection(id: number, papers: any[], children: any[], initiallyLoaded: boolean) {
    const loaded = new Set(initiallyLoaded ? ['childItems', 'childCollections'] : []);
    return {
      id,
      loadDataType: async (type: string) => { loaded.add(type); },
      getChildItems: () => { if (!loaded.has('childItems')) throw new Error('childItems not loaded'); return papers; },
      getChildCollections: () => { if (!loaded.has('childCollections')) throw new Error('childCollections not loaded'); return children; },
    };
  }
  const child = collection(2, [item(2)], [], false);
  const parent = collection(1, [item(1)], [child], true);
  globals(t, { Zotero: { Libraries: { userLibraryID: 1 }, getActiveZoteroPane: () => ({ getSelectedCollections: () => [parent] }) } });
  assert.deepEqual((await new ZoteroHost().list('collections')).map(p => p.itemID), [1, 2]);
});

test('host PDF extraction uses readable PDFs and never treats a web snapshot as PDF evidence', async t => {
  const parent = item(1, { attachments: [11, 12, 13] });
  const attachments: Record<number, any> = { 11: { attachmentContentType: 'text/html', attachmentText: 'snapshot text' }, 12: { attachmentContentType: 'application/pdf', attachmentText: '' }, 13: { attachmentContentType: 'application/pdf', attachmentText: 'PDF evidence text' } };
  globals(t, { Zotero: { Libraries: { userLibraryID: 1 }, Items: { getAsync: async (id: number) => id === 1 ? parent : attachments[id] } } });
  assert.equal(await new ZoteroHost().pdfText(1), 'PDF evidence text');
});

test('tag patches require an exact current snapshot, group native undo, and release mutation guards', async t => {
  const paper = item(1, { tags: [{ tag: 'manual', type: 0 }] });
  let label = '', transactions = 0;
  globals(t, { Zotero: { Libraries: { userLibraryID: 1 }, Items: { getAsync: async () => paper }, UndoHistory: { stageAction: (action: string) => { label = action; } }, DB: { executeTransaction: async (task: () => Promise<void>) => { transactions++; await task(); } } } });
  const host = new ZoteroHost();
  await host.apply([{ paperId: '1:KEY1', itemID: 1, before: [{ tag: 'manual', type: 0 }], after: [{ tag: 'manual', type: 0 }, { tag: 'RCL', type: 0 }] }], 'Assign tags');
  assert.equal(transactions, 1); assert.equal(label, 'smart-tags-undo'); assert.equal(host.mutating.size, 0);
  await assert.rejects(() => host.apply([{ paperId: '1:KEY1', itemID: 1, before: [], after: [] }], 'Stale'), /Tags changed/);
  assert.equal(paper.getTags().length, 2); assert.equal(host.mutating.size, 0);
  assert.equal(sameTags([{ tag: 'a', type: 0 }, { tag: 'b', type: 1 }], [{ tag: 'b', type: 1 }, { tag: 'a', type: 0 }]), true);
});

function credentialHarness(t: any, encrypt: (value: string) => Promise<string> = async value => `oskv1:${value}`) {
  const logins: any[] = [];
  const services = { logins: {
    findLogins: (origin: string, _form: null, realm: string) => logins.filter(v => v.origin === origin && v.realm === realm),
    addLoginAsync: async (login: any) => { logins.push(login); },
    modifyLogin: (old: any, value: any) => { logins.splice(logins.indexOf(old), 1, value); },
    removeLogin: (login: any) => { logins.splice(logins.indexOf(login), 1); },
  } };
  globals(t, {
    Zotero: { OSKeyStore: { encrypt, isEncrypted: (v: string) => v.startsWith('oskv1:'), decrypt: async (v: string) => v.slice(6) } },
    Services: services, Ci: { nsILoginInfo: {} },
    Cc: { '@mozilla.org/login-manager/loginInfo;1': { createInstance: () => ({ init(origin: string, _form: null, realm: string, username: string, password: string) { Object.assign(this, { origin, realm, username, password }); } }) } },
  });
  return { logins, credentials: new SecureCredentials() };
}

test('credentials persist ciphertext only inside the extension realm', async t => {
  const h = credentialHarness(t);
  await h.credentials.save('api-key', 'secret-value');
  assert.equal(h.logins[0].password, 'oskv1:secret-value');
  assert.equal(h.logins[0].realm, 'Smart Tags credentials');
  h.credentials.clearMemory(); assert.equal(await h.credentials.load('api-key'), 'secret-value');
  await h.credentials.remove('api-key'); assert.equal(await h.credentials.load('api-key'), null);
});

test('unavailable encryption keeps new tokens in memory and removes stale persisted credentials', async t => {
  const h = credentialHarness(t, async () => { throw new Error('Key store unavailable'); });
  h.logins.push({ origin: 'chrome://smart-tags', realm: 'Smart Tags credentials', username: 'api-key', password: 'oskv1:old' });
  await h.credentials.save('api-key', 'new-secret');
  assert.equal(h.credentials.sessionOnly, true); assert.equal(h.logins.length, 0);
  assert.equal(await h.credentials.load('api-key'), 'new-secret');
  h.credentials.clearMemory(); assert.equal(await h.credentials.load('api-key'), null);
});

test('legacy plaintext credentials are rejected instead of silently decrypted', async t => {
  const h = credentialHarness(t);
  h.logins.push({ origin: 'chrome://smart-tags', realm: 'Smart Tags credentials', username: 'api-key', password: 'plaintext' });
  await assert.rejects(() => h.credentials.load('api-key'), /unencrypted/);
});

test('OAuth callback permits browser GET only on its own temporary route and preserves shared server', async t => {
  const endpoints: Record<string, any> = { '/existing': function Existing() {} };
  globals(t, { Zotero: { Server: { port: 23119, Endpoints: endpoints } } });
  let query: Record<string, string> = {};
  const callback = await registerOAuthCallback('/smart-tags/oauth/callback', async value => { query = value; return { status: 200, body: '<plain text>' }; });
  const endpoint = new endpoints['/smart-tags/oauth/callback']();
  assert.deepEqual(endpoint.supportedMethods, ['GET']); assert.equal(endpoint.allowRequestsFromUnsafeWebContent, true);
  const response = await endpoint.init({ searchParams: new URLSearchParams('state=abc&code=secret') });
  assert.equal(query.code, 'secret'); assert.equal(response[1]['Content-Type'], 'text/plain; charset=utf-8'); assert.equal(response[1]['Cache-Control'], 'no-store');
  callback.dispose(); assert.equal(endpoints['/smart-tags/oauth/callback'], undefined); assert.ok(endpoints['/existing']);
});

test('OAuth registration refuses to replace another active callback', async t => {
  const existing = function Existing() {};
  globals(t, { Zotero: { Server: { port: 23119, Endpoints: { '/smart-tags/oauth/callback': existing } } } });
  await assert.rejects(() => registerOAuthCallback('/smart-tags/oauth/callback', async () => ({ status: 200, body: 'ok' })), /already active/);
});
