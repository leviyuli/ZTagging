import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceStore,PAYLOAD_CHUNK_BYTES,DECODED_CACHE_BYTES} from '../src/workspace/storage.ts';
import {memorySql} from './workspace-storage-adapter.ts';

test('record commits preserve exact values, bounded projections and durable command identity',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);
  const value={title:'燃料电池',raw:'A paid response \ud800 😀 '+ 'large quote '.repeat(10000),nested:[1,null,true,{empty:[]}],suspicious:JSON.parse('{"__proto__":"not a prototype","constructor":"kept"}')};
  const command={commandId:'paid-result-1',operations:[{kind:'put' as const,collection:'papers',id:'1:A',value,metadata:{title:value.title,searchText:'Full searchable abstract about battery fuel cells',status:'ready'}}],receipt:{taskId:'task-1'}};
  const first=await store.commit(command),before=await store.stats();assert.deepEqual(await store.get('papers','1:A'),value);
  assert.deepEqual(await store.commit(command),first);assert.deepEqual(await store.stats(),before);
  const result=await store.scan('papers',{search:'battery'});assert.equal(result.rows.length,1);assert.equal(result.rows[0].metadata.title,value.title);
  const sizes=await sql.port.query('SELECT MAX(raw_bytes) AS size FROM workspace_payloads');assert.ok(Number(sizes[0].size)<=PAYLOAD_CHUNK_BYTES);assert.ok((await store.stats()).decodedCacheBytes<=DECODED_CACHE_BYTES);
  await store.close();
});

test('immutable sources share payloads across records and only changes allocate new bodies',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),source={abstract:'Reusable scientific evidence. '.repeat(5000),facts:[{name:'proton transport',evidence:'exact quote'}]};
  await store.put('source','first',source);const first=await store.stats();await store.put('source','second',source);const second=await store.stats();
  assert.equal(second.payloads,first.payloads);assert.equal(second.payloadBytes,first.payloadBytes);
  await store.put('source','second',{...source,facts:[{name:'proton transport',evidence:'different exact quote'}]});assert.ok((await store.stats()).payloadBytes>first.payloadBytes);
  assert.deepEqual(await store.get('source','first'),source);await store.close();
});

test('small final transactions roll back all visible records after a write failure',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);await store.put('tags','saved',{meaning:'Original meaning'});
  sql.fail((statement,parameters)=>statement.startsWith('INSERT INTO workspace_records')&&parameters[1]==='second');
  await assert.rejects(store.commit({commandId:'atomic-meaning-batch',operations:[{kind:'put',collection:'tags',id:'saved',value:{meaning:'Replacement'}},{kind:'put',collection:'tags',id:'second',value:{meaning:'New meaning'}}]}),/Synthetic SQL failure/);
  assert.deepEqual(await store.get('tags','saved'),{meaning:'Original meaning'});assert.equal(await store.get('tags','second'),undefined);
  sql.fail();await store.commit({commandId:'atomic-meaning-batch',operations:[{kind:'put',collection:'tags',id:'saved',value:{meaning:'Replacement'}}]});assert.deepEqual(await store.get('tags','saved'),{meaning:'Replacement'});await store.close();
});

test('record guards reject stale edits without publishing another revision',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);const receipt=await store.put('tags','t',{description:'first'}),before=await store.stats();
  await assert.rejects(store.commit({commandId:'stale',operations:[{kind:'put',collection:'tags',id:'t',value:{description:'stale'},expectedVersion:receipt.revision-1}]}),/changed/);
  assert.equal((await store.stats()).revision,before.revision);assert.deepEqual(await store.get('tags','t'),{description:'first'});await store.close();
});

test('streamed builders support partial traversal without loading historical bodies',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),array=store.codec.arrayBuilder();
  for(let index=0;index<600;index++)await array.append(await store.codec.encode({id:index,paidReply:'reply '+index+' '.repeat(400)}));
  const root=await array.finish();await store.putReference('history','run',root,{category:'history'});
  const selected=await store.codec.lookup(root,[513,'id']);assert.ok(selected);assert.equal(await store.codec.read(selected!),513);
  const page=await store.codec.entries(root,{after:510,limit:500});assert.equal(page.entries.length,50);assert.equal(page.total,600);assert.equal(page.next,560);
  await store.close();
});

test('corrupt or missing payloads fail closed instead of returning partial scientific evidence',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);await store.put('source','x',{text:'A scientific quotation'});const root=(await store.reference('source','x'))!.token;assert.ok('ref' in root);
  store.codec.clear();await sql.port.query('UPDATE workspace_payloads SET data=? WHERE hash=?',[new Uint8Array([0]),'ref' in root?root.ref:'']);
  await assert.rejects(store.get('source','x'),/integrity/);await store.close();
});

test('streamed text preserves escaped UTF-16 and never splits a valid pair for fingerprint consumers',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),parts=['A'.repeat(8191)+'\ud83d','\ude00 middle \ud800',' unpaired low \udc00'];
  const token=await store.codec.text((async function*(){yield* parts;})());await store.putReference('raw','unicode',token);
  assert.equal(await store.get('raw','unicode'),parts.join(''));assert.equal(await store.codec.kind(token),'string');
  const chunks:string[]=[];for await(const chunk of store.codec.stringChunks(token))chunks.push(chunk);
  assert.equal(chunks.join(''),parts.join(''));for(let index=0;index<chunks.length-1;index++){const last=chunks[index].charCodeAt(chunks[index].length-1),first=chunks[index+1].charCodeAt(0);assert.ok(!(last>=0xd800&&last<=0xdbff&&first>=0xdc00&&first<=0xdfff));}
  await store.close();
});

test('read-only query connections perform no schema changes and cannot stage payloads or commands',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);await store.put('tags','t',{meaning:'kept'});const start=sql.statements.length;
  const reader=await WorkspaceStore.open({...sql.port,close:async()=>{}},{readOnly:true});assert.deepEqual(await reader.get('tags','t'),{meaning:'kept'});
  assert.ok(!sql.statements.slice(start).some(value=>/CREATE|INSERT|UPDATE|DELETE|BEGIN/.test(value.sql)));
  await assert.rejects(reader.put('tags','t',{meaning:'changed'}),/read-only/);await assert.rejects(reader.codec.encode({large:'source '.repeat(1000)}),/read-only/);
  await reader.close();assert.deepEqual(await store.get('tags','t'),{meaning:'kept'});await store.close();
});

test('bounded staging commits amortize fsync and roll back failed payload batches for retry',async()=>{
  const sql=memorySql();let depth=0,staged=0;
  const native={...sql.port,async transaction<T>(operation:()=>Promise<T>){return sql.port.transaction(async()=>{depth++;try{return await operation();}finally{depth--;}});},async batch(statement:string,bindings:Parameters<typeof sql.port.batch>[1]){assert.equal(depth,1,'payload and edge staging must use a short transaction');staged++;return sql.port.batch(statement,bindings);}};
  const store=await WorkspaceStore.open(native),source={text:'Exact evidence. '.repeat(40000)};
  sql.fail(statement=>statement.startsWith('INSERT INTO workspace_edges'));
  await assert.rejects(store.put('source','retry',source),/Synthetic SQL failure/);assert.equal(await store.reference('source','retry'),undefined);
  sql.fail();await store.put('source','retry',source);assert.deepEqual(await store.get('source','retry'),source);assert.ok(staged>1);await store.close();
});

test('repeated internal updates retain one record without accumulating permanent random command receipts',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);for(let index=0;index<100;index++)await store.put('progress','task',{completed:index});
  assert.equal((await store.stats()).records,1);assert.equal(Number((await sql.port.query('SELECT COUNT(*) AS count FROM workspace_commands'))[0].count),0);
  const command={commandId:'external-stable',operations:[{kind:'put' as const,collection:'progress',id:'task',value:{completed:100}}]},receipt=await store.commit(command);
  assert.deepEqual(await store.commit(command),receipt);assert.equal(Number((await sql.port.query('SELECT COUNT(*) AS count FROM workspace_commands'))[0].count),1);await store.close();
});

test('reference updates and staged activation retain full search indexes without transferring their text',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);await store.put('stage:papers','p',{title:'A source',abstract:'electrochemical transport'},{title:'A source',searchText:'A source electrochemical transport'});
  const staged=(await store.reference('stage:papers','p'))!;assert.equal(staged.metadata.searchText,undefined);
  await store.commit({commandId:'activate-index',operations:[{kind:'reference',collection:'papers',id:'p',token:staged.token,metadata:staged.metadata,copyIndexFrom:staged}]});await store.delete('stage:papers','p');
  assert.equal((await store.scan('papers',{search:'electrochemical'})).total,1);const active=(await store.reference('papers','p'))!;
  await store.putReference('papers','p',active.token,{...active.metadata,refs:[{collection:'tags',id:'FC',relation:'matches'}]});assert.equal((await store.scan('papers',{search:'transport'})).total,1);
  assert.ok(!JSON.stringify((await store.scan('papers')).rows).includes('electrochemical'));await store.close();
});

test('internal graph edges use compact integer identities while manifest hashes stay unchanged',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);await store.put('papers','p',{text:'A referenced source. '.repeat(300),more:['one','two']});const root=(await store.reference('papers','p'))!.token;assert.ok('ref' in root&&/^[0-9a-f]{64}$/.test(root.ref));
  const edges=await sql.port.query('SELECT typeof(parent) AS parent,typeof(child) AS child FROM workspace_edges LIMIT 1');assert.equal(edges[0].parent,'integer');assert.equal(edges[0].child,'integer');
  const record=(await sql.port.query('SELECT typeof(root_ref) AS type FROM workspace_records LIMIT 1'))[0];assert.equal(record.type,'integer');assert.equal((await sql.port.query('PRAGMA foreign_key_check')).length,0);await store.close();
});

test('large full-text indexes transfer bounded chunks and match across chunk boundaries',async()=>{
  const sql=memorySql();let largest=0;const guard=(values:unknown[])=>{for(const value of values)if(typeof value==='string'){largest=Math.max(largest,value.length);assert.ok(value.length<=16*1024,'large search text must never be an SQL transfer argument');}};
  const port={...sql.port,async query(statement:string,parameters:Parameters<typeof sql.port.query>[1]=[]){guard(parameters);return sql.port.query(statement,parameters);},async batch(statement:string,rows:Parameters<typeof sql.port.batch>[1]){for(const row of rows)guard(row);return sql.port.batch(statement,rows);}},store=await WorkspaceStore.open(port);
  const text='a'.repeat(16380)+' Exact cross-boundary phrase '+'b'.repeat(100000);await store.put('papers','p',{title:'A source',abstract:text},{title:'A source',searchText:text});
  assert.equal((await store.scan('papers',{search:'aaa Exact cross-boundary phrase bbb'})).total,1);assert.ok(largest<=16*1024);assert.equal(Number((await sql.port.query('SELECT MAX(length(body)) AS size FROM workspace_search'))[0].size),16*1024);
  await assert.rejects(store.scan('papers',{search:'x'.repeat(513)}),/512 characters/);await store.delete('papers','p');assert.equal(Number((await sql.port.query('SELECT COUNT(*) AS count FROM workspace_search'))[0].count),0);await store.close();
});

test('streamed encoding inlines short strings and canonicalizes fragments across input boundaries',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),short=await store.codec.text((async function*(){yield 'A';yield ' short';yield ' string';})());assert.deepEqual(short,{value:'A short string'});assert.equal((await store.stats()).payloads,0);
  const source='x'.repeat(8191)+'😀'+'different chunks and lone \ud800 '+ 'scientific evidence '.repeat(900),first=await store.codec.value(source),before=await store.stats();
  const second=await store.codec.text((async function*(){for(let offset=0;offset<source.length;offset+=127)yield source.slice(offset,offset+127);})());await store.codec.flush();
  assert.deepEqual(second,first);assert.equal(await store.codec.logicalSize(first),Buffer.byteLength(JSON.stringify(source)));assert.equal(await store.codec.read(second),source);assert.ok((await store.stats()).payloads<20);assert.ok(before.payloads<20);
  const one=store.codec.arrayBuilder();await one.append({value:1});const token=await store.codec.reference(await one.finish());await store.codec.flush();const row=(await sql.port.query('SELECT raw_bytes FROM workspace_payloads WHERE hash=?',['ref' in token?token.ref:'']))[0];assert.ok(Number(row.raw_bytes)<40,'one-element arrays should be one leaf, not a manifest');await store.close();
});

test('small literal containers traverse without nodes, return independent values and own hashed record roots',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),source={title:'A scientific quotation of useful length. '.repeat(10),nested:[1,true,null,{proof:'Exact text'}],safe:JSON.parse('{"__proto__":"an ordinary field"}')},token=await store.codec.encode(source);
  assert.ok('inline' in token);assert.equal((await store.stats()).payloads,0);assert.equal(await store.codec.kind(token),'object');assert.equal((await store.codec.entries(token)).total,3);
  const first=await store.codec.read(token) as typeof source;first.nested.push(false);first.title='Changed consumer copy';assert.deepEqual(await store.codec.read(token),source);
  const leaf=await store.codec.lookup(token,['nested',3,'proof']);assert.equal(await store.codec.read(leaf!),'Exact text');
  await store.putReference('evidence','literal',token);const record=(await store.reference('evidence','literal'))!;assert.ok('ref' in record.token);assert.deepEqual(await store.get('evidence','literal'),source);assert.ok((await store.stats()).payloads<=2);await store.close();
});

test('database size uses SQLite page metadata only when explicitly requested',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);await store.put('history','large',{body:'Shared compressed evidence. '.repeat(10000)},{category:'history'});
  const start=sql.statements.length,ordinary=await store.stats();assert.equal(ordinary.databaseBytes,undefined);assert.ok(!sql.statements.slice(start).some(row=>row.sql==='PRAGMA page_count'||row.sql==='PRAGMA page_size'));
  const measured=await store.stats({includeDatabase:true}),count=Number((await sql.port.query('PRAGMA page_count'))[0].page_count),size=Number((await sql.port.query('PRAGMA page_size'))[0].page_size);assert.equal(measured.databaseBytes,count*size);assert.ok(measured.databaseBytes!>measured.payloadBytes);await store.close();
});

test('identical payload, references and search preserve record versions across index refreshes',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),body={title:'A saved source'},metadata={title:'A saved source',searchText:'s'.repeat(16384),updatedAt:10,refs:[{collection:'tags',id:'a',relation:'matches'},{collection:'tags',id:'b',relation:'matches'}]};
  await store.put('papers','p',body,metadata);const before=(await store.reference('papers','p'))!;
  await store.put('papers','p',structuredClone(body),{...metadata,updatedAt:20,refs:[metadata.refs[1],metadata.refs[0],metadata.refs[0]]});assert.equal((await store.reference('papers','p'))!.version,before.version);
  await store.putReference('papers','p',before.token,{...before.metadata,updatedAt:30,refs:metadata.refs});assert.equal((await store.reference('papers','p'))!.version,before.version);
  await store.putReference('papers','p',before.token,{...before.metadata,searchText:'A different searchable alias',refs:metadata.refs});assert.ok((await store.reference('papers','p'))!.version>before.version);assert.equal((await store.scan('papers',{search:'different'})).total,1);
  const next=(await store.reference('papers','p'))!;await store.putReference('papers','p',next.token,{...next.metadata,refs:[metadata.refs[0]]});assert.ok((await store.reference('papers','p'))!.version>next.version);await store.close();
});

test('native item lookup uses a bounded partial paper index without loading bodies',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);await store.put('papers','p',{id:'p',title:'Native source',body:'Large source. '.repeat(10000)},{nativeItemId:42,title:'Native source'});
  const page=await store.scan('papers',{nativeItemId:42,limit:50});assert.equal(page.total,1);assert.equal(page.rows[0].metadata.nativeItemId,42);assert.equal((await store.scan('papers',{nativeItemId:43})).total,0);
  const plan=await sql.port.query("EXPLAIN QUERY PLAN SELECT id FROM workspace_records WHERE collection=? AND collection='papers' AND native_item_id=?",['papers',42]);assert.ok(plan.some(row=>String(row.detail).includes('workspace_records_native_item')));await assert.rejects(store.scan('papers',{nativeItemId:0}),/positive integer/);await store.close();
});
