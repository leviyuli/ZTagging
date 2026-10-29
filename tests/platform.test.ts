import test from 'node:test';
import assert from 'node:assert/strict';
import { SecureCredentials, ZoteroHost, registerOAuthCallback, sameTags } from '../src/platform.ts';
import { buildMetadataPreview, reverseMetadataPatch } from '../src/paper-recovery.ts';
import type { MetadataCreator } from '../src/paper-recovery.ts';

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

test('input inspection distinguishes observed PDF states without downloading, reindexing, or exposing text', async t => {
  const parent=item(1,{title:'',attachments:[]}),attachments=new Map<number,unknown>();
  let reindexes=0,textReads=0;
  globals(t,{Zotero:{Libraries:{userLibraryID:1},Items:{getAsync:async(id:number)=>id===1?parent:attachments.get(id)},Fulltext:{indexItems:async()=>{reindexes++;}}}});
  const host=new ZoteroHost();
  assert.equal((await host.inspectInputs(1)).pdf.status,'missing');
  parent.getAttachments=()=>[11];
  attachments.set(11,{id:11,attachmentContentType:'text/html',attachmentText:'web snapshot'});
  assert.equal((await host.inspectInputs(1)).pdf.status,'missing');
  attachments.set(11,{id:11,attachmentContentType:'application/pdf',fileExists:async()=>false,get attachmentText(){textReads++;return 'cached text';}});
  assert.equal((await host.inspectInputs(1)).pdf.status,'nonlocal');assert.equal(textReads,0);
  attachments.set(11,{id:11,attachmentContentType:'application/pdf',fileExists:async()=>true,attachmentText:''});
  assert.equal((await host.inspectInputs(1)).pdf.status,'textUnavailable');
  attachments.set(11,{id:11,attachmentContentType:'application/pdf',fileExists:async()=>true,get attachmentText(){throw new Error('read failed');}});
  assert.equal((await host.inspectInputs(1)).pdf.status,'readError');
  attachments.set(11,{id:11,attachmentContentType:'application/pdf',attachmentText:'unverified availability'});
  assert.equal((await host.inspectInputs(1)).pdf.status,'unknown');
  attachments.set(11,{id:11,attachmentContentType:'application/pdf',fileExists:async()=>true,attachmentText:'PRIVATE PDF EVIDENCE'});
  const result=await host.inspectInputs(1);
  assert.equal(result.metadata.title,false);assert.equal(result.metadata.abstract,true);assert.equal(result.metadata.keywords,true);
  assert.equal(result.pdf.status,'readable');assert.equal(result.pdf.characters,20);assert.equal(result.pdf.localCount,1);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(reindexes,0);
  assert.equal(Number.isFinite(Date.parse(result.checkedAt)),true);
});

test('explicit local recheck indexes only locally available PDFs before reading text', async t => {
  const parent=item(1,{attachments:[11,12,13]}),calls:unknown[]=[];
  let localText='';
  const attachments:Record<number,unknown>={11:{id:11,attachmentContentType:'application/pdf',fileExists:async()=>false},12:{id:12,attachmentContentType:'text/html'},13:{id:13,attachmentContentType:'application/pdf',fileExists:async()=>true,get attachmentText(){return localText;}}};
  globals(t,{Zotero:{Libraries:{userLibraryID:1},Items:{getAsync:async(id:number)=>id===1?parent:attachments[id]},Fulltext:{indexItems:async(ids:number[],options:unknown)=>{calls.push({ids,options});localText='new locally extracted text';}}}});
  const host=new ZoteroHost();
  assert.equal((await host.inspectInputs(1)).pdf.status,'textUnavailable');assert.equal(calls.length,0);
  const result=await host.inspectInputs(1,true);
  assert.deepEqual(calls,[{ids:[13],options:{complete:true}}]);assert.equal(result.pdf.status,'readable');assert.equal(result.pdf.rechecked,true);
  assert.equal(result.pdf.attachmentCount,2);assert.equal(result.pdf.localCount,1);
});

function metadataHost(t:any,candidates:unknown[]=[]){
  const fields:Record<string,string>={title:'Researcher title',abstractNote:'',DOI:'10.1234/example',date:''};
  const supported=new Set(Object.keys(fields));
  const papers=[1,2].map(id=>{
    const paperFields={...fields},state={creators:[] as MetadataCreator[],saves:0};
    return {...item(id),itemType:'journalArticle',itemTypeID:22,fields:paperFields,state,
      getField:(field:string)=>paperFields[field]??'',setField:(field:string,value:string)=>{paperFields[field]=value;},
      getCreatorsJSON:()=>structuredClone(state.creators),setCreators:(creators:MetadataCreator[],options:unknown)=>{assert.deepEqual(options,{strict:true});state.creators=structuredClone(creators);},save:async()=>{state.saves++;},
    };
  });
  const calls:{identifiers:unknown[];translate:unknown[];translators:unknown[];transactions:number;undo:string[]}={identifiers:[],translate:[],translators:[],transactions:0,undo:[]};
  let translators:unknown[]=[{translatorID:'metadata-test'}];
  class Search{
    setIdentifier(value:unknown){calls.identifiers.push(value);}
    async getTranslators(){return translators;}
    setTranslator(value:unknown){calls.translators.push(value);}
    async translate(options:unknown){calls.translate.push(options);return candidates;}
  }
  globals(t,{Zotero:{Libraries:{userLibraryID:1},Items:{getAsync:async(id:number)=>papers.find(paper=>paper.id===id)},ItemFields:{getID:(field:string)=>supported.has(field)?field:undefined,isValidForType:(field:string,type:number)=>supported.has(field)&&type===22},ItemTypes:{getID:(type:string)=>type==='journalArticle'?22:0},CreatorTypes:{getID:(role:string)=>role==='author'?1:role==='editor'?2:0,isValidForItemType:(role:number,type:number)=>role>0&&type===22},Translate:{Search},UndoHistory:{stageAction:(action:string)=>{calls.undo.push(action);}},DB:{executeTransaction:async(task:()=>Promise<void>)=>{calls.transactions++;await task();}}}});
  return {host:new ZoteroHost(),papers,calls,setTranslators:(value:unknown[])=>{translators=value;}};
}

test('identifier lookup uses Zotero translators in unsaved mode and previews only supported empty fields',async t=>{
  const h=metadataHost(t,[{DOI:'10.1234/EXAMPLE',title:'Other title',abstractNote:'Fetched abstract',date:'2026',publisher:'Unsupported publisher',creators:[{creatorType:'author',firstName:'Ada',lastName:'Example'},{creatorType:'author',lastName:'Institutional Group',fieldMode:1},{creatorType:'invented',name:'Invalid role'}],tags:[{tag:'unwanted'}]}]);
  const before=await h.host.readMetadata(1),result=await h.host.lookupMetadata(1);
  assert.equal(result.status,'ready');assert.deepEqual(h.calls.identifiers,[{DOI:'10.1234/example'}]);
  assert.deepEqual(h.calls.translate,[{libraryID:false,saveAttachments:false}]);
  assert.equal(result.patch!.after.fields.title,'Researcher title');assert.equal(result.patch!.after.fields.abstractNote,'Fetched abstract');
  assert.equal(Object.hasOwn(result.patch!.after.fields,'publisher'),false);assert.equal(result.patch!.after.creators.length,2);
  assert.deepEqual(result.patch!.after.creators[1],{creatorType:'author',name:'Institutional Group'});
  assert.deepEqual(await h.host.readMetadata(1),before);assert.equal(h.papers[0].state.saves,0);assert.equal(h.calls.transactions,0);
  h.setTranslators([]);assert.equal((await h.host.lookupMetadata(1)).status,'notFound');assert.equal(h.calls.translate.length,1);
});

test('metadata lookup rejects unconfirmed identifiers and never performs a title-only lookup',async t=>{
  const h=metadataHost(t,[{DOI:'10.1234/wrong',abstractNote:'Wrong abstract'}]);
  assert.equal((await h.host.lookupMetadata(1)).status,'mismatch');
  h.papers[0].fields.DOI='';
  assert.equal((await h.host.lookupMetadata(1)).status,'noIdentifier');assert.equal(h.calls.translate.length,1);
  assert.equal((await h.host.lookupMetadata(1,'a paper title')).status,'noIdentifier');assert.equal(h.calls.translate.length,1);
  assert.equal(h.papers[0].state.saves,0);
});

test('metadata patches apply atomically through the native transaction and exact inverse patches support undo',async t=>{
  const h=metadataHost(t,[{DOI:'10.1234/example',abstractNote:'Fetched abstract',creators:[{creatorType:'author',name:'Example Group'}]}]);
  const patch=(await h.host.lookupMetadata(1)).patch!;
  await h.host.applyMetadata([patch],'Fill missing metadata');
  assert.equal(h.papers[0].fields.abstractNote,'Fetched abstract');assert.deepEqual(h.papers[0].state.creators,[{creatorType:'author',name:'Example Group'}]);
  assert.equal(h.papers[0].fields.title,'Researcher title');assert.equal(h.host.mutating.size,0);assert.equal(h.calls.transactions,1);assert.deepEqual(h.calls.undo,['smart-tags-undo']);
  await h.host.applyMetadata([reverseMetadataPatch(patch)],'Undo metadata fill');
  assert.equal(h.papers[0].fields.abstractNote,'');assert.deepEqual(h.papers[0].state.creators,[]);assert.equal(h.host.mutating.size,0);
});

test('metadata batches preflight every paper before mutation and protect later manual edits',async t=>{
  const h=metadataHost(t),first=buildMetadataPreview(await h.host.readMetadata(1),[{DOI:'10.1234/example',abstractNote:'New abstract'}]).patch!,second=buildMetadataPreview(await h.host.readMetadata(2),[{DOI:'10.1234/example',abstractNote:'New abstract'}]).patch!;
  h.papers[1].fields.title='Later researcher title';
  await assert.rejects(()=>h.host.applyMetadata([first,second],'Stale batch'),/Metadata changed after the preview/);
  assert.equal(h.papers[0].fields.abstractNote,'');assert.equal(h.papers[0].state.saves,0);assert.equal(h.host.mutating.size,0);assert.deepEqual(h.calls.undo,[]);
  await assert.rejects(()=>h.host.applyMetadata([first,first],'Duplicate paper'),/same paper twice/);
  const unsafe=structuredClone(first);unsafe.after.fields.extra='Unreviewed note';
  await assert.rejects(()=>h.host.applyMetadata([unsafe],'Unsupported field'),/unsupported fields/);assert.equal(h.papers[0].state.saves,0);
  unsafe.after=structuredClone(first.after);unsafe.after.creators=[{creatorType:'invented',name:'Invalid role'}];
  await assert.rejects(()=>h.host.applyMetadata([unsafe],'Invalid creator'),/unsupported creator role/);
  assert.equal(h.host.mutating.size,0);
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
