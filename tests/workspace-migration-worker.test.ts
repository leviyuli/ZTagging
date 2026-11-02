import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/controller.ts';
import {paperFingerprint} from '../src/core.ts';
import type {ProviderClient} from '../src/providers.ts';
import {createCommandRuntime} from '../src/workspace/worker-entry.ts';
import type {MigrationIO} from '../src/workspace/migration-contract.ts';
import {memorySql} from './workspace-storage-adapter.ts';
import {WorkspaceStore} from '../src/workspace/storage.ts';

const encoder=new TextEncoder(),DATE=1_794_033_600_000;
function fixture(){
  const source=initialState(),paper={id:'1:INTERRUPTED',itemID:1,libraryID:1,key:'INTERRUPTED',title:'Retained source',abstract:'A retained scientific source.',keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);source.papers[paper.id]=paper;source.nativeTags[paper.id]=[];
  source.run={id:'interrupted-run',kind:'tag',scope:'selected',automatic:false,status:'running',jobs:[{id:'interrupted-job',paperId:paper.id,status:'running'}],vocabCursor:0,vocabFinished:false,spentUSD:0.43,settings:{...source.settings},vocabularyVersion:0,processingPolicy:'auto-clear'};
  return source;
}
function harness(source:unknown){
  const sql=memorySql(),original=encoder.encode(JSON.stringify(source)),files=new Map([['/profile/state.json',original]]),calls:{method:string;args:unknown[]}[]=[],reads:number[]=[];
  let paid=0,native=0,writes=0,providerCreated=0,dispose=0,now=DATE;
  let inspect:((method:string,args:unknown[])=>Promise<void>)|undefined;
  let nativeReply:((method:string,args:unknown[])=>Promise<unknown>)|undefined;
  const io:MigrationIO={async exists(path){return files.has(path);},async stat(path){return {size:files.get(path)!.length};},async read(path,{offset,maxBytes}){reads.push(maxBytes);return files.get(path)!.slice(offset,offset+maxBytes);},async copyExact(from,to){assert.equal(files.has(to),false);files.set(to,files.get(from)!.slice());},async writeAtomic(path,bytes){writes++;files.set(path,bytes.slice());},async remove(path){files.delete(path);}};
  const call=async(method:string,args:unknown[])=>{
    calls.push({method,args});
    await inspect?.(method,args);
    if(method==='sql.query')return sql.port.query(String(args[0]),args[1] as never);
    if(method==='sql.batch')return sql.port.batch(String(args[0]),args[1] as never);
    if(method==='sql.begin'){sql.database.exec('BEGIN IMMEDIATE');return;}
    if(method==='sql.commit'){sql.database.exec('COMMIT');return;}
    if(method==='sql.rollback'){sql.database.exec('ROLLBACK');return;}
    if(method==='sql.close'||method==='phase'||method==='changed')return;
    if(method==='credentials.status')return 'Injected protected credentials';
    if(method.startsWith('host.')){native++;if(nativeReply)return nativeReply(method,args);throw new Error('Startup must not operate on the library.');}
    throw new Error('Unexpected worker host call: '+method);
  };
  const createProvider=()=>{providerCreated++;return new Proxy({async hasApiKey(){return false;},async getSession(){return {connected:false,sharing:false,email:null,accountId:null,accounts:[]};},async completeJson(){paid++;throw new Error('Startup must not dispatch AI.');},cancelSignIn(){},async dispose(){dispose++;}},{get(target,key){return Reflect.get(target,key)??(async()=>{throw new Error('Startup must not invoke a provider action: '+String(key));});}}) as unknown as ProviderClient;};
  return {sql,io,files,original,calls,reads,runtime:()=>createCommandRuntime({call,io,clock:()=>now,createProvider}),set clock(value:number){now=value;},set inspect(value:typeof inspect){inspect=value;},set nativeReply(value:typeof nativeReply){nativeReply=value;},get paid(){return paid;},get native(){return native;},get writes(){return writes;},get providerCreated(){return providerCreated;},get disposed(){return dispose;}};
}
async function inspectStorage(h:ReturnType<typeof harness>){return WorkspaceStore.open({...h.sql.port,close:async()=>{}});}

test('the worker migrates and recovers interrupted work without dispatching or native writes',async()=>{
  const source=fixture(),h=harness(source),runtime=h.runtime();
  await runtime.open({directory:'/profile'});
  const row=h.sql.database.prepare("SELECT token FROM workspace_records WHERE collection='state' AND id='run'").get() as {token:string};assert.ok(row);
  const stateLocator=JSON.parse(new TextDecoder().decode(h.files.get('/profile/state.json')));assert.equal(stateLocator.schemaVersion,14);
  assert.equal(h.paid,0);assert.equal(h.native,0);assert.equal(h.writes,1);assert.equal(h.providerCreated,1);assert.ok(h.reads.every(size=>size<=64*1024));
  assert.deepEqual(h.files.get('/profile/state.json.pre-v14.json'),h.original);
  assert.equal((h.sql.database.prepare("SELECT COUNT(*) AS count FROM workspace_records WHERE collection='providerDispatches' AND status='unknown' AND task_id=?").get(source.run!.id) as {count:number}).count,1);
  const statuses=h.sql.database.prepare("SELECT status FROM workspace_records WHERE collection='runJobs'").all() as {status:string}[];assert.equal(statuses.length,1);
  await runtime.close('disable');assert.equal(h.disposed,1);assert.equal(h.paid,0);assert.equal(h.native,0);await h.sql.port.close();
});

test('verified worker restarts reuse the exact migration generation and register two successful starts',async()=>{
  const h=harness(fixture());let runtime=h.runtime();await runtime.open({directory:'/profile',processSessionId:'process-1'});await runtime.close('shutdown');
  const first=h.files.get('/profile/state.json')!.slice(),backup=h.files.get('/profile/state.json.pre-v14.json')!.slice();
  for(const [processSessionId,expected] of [['process-1',0],['process-1',0],['process-2',1],['process-2',1],['process-3',2]] as const){runtime=h.runtime();await runtime.open({directory:'/profile',processSessionId});await runtime.close('disable');const inspector=await inspectStorage(h),row=(await inspector.scan('migrationBackups')).rows[0];assert.equal(await inspector.get('migrationBackups',row.id,{path:['verifiedRestarts']}),expected);await inspector.close();}
  assert.deepEqual(h.files.get('/profile/state.json'),first);assert.deepEqual(h.files.get('/profile/state.json.pre-v14.json'),backup);assert.deepEqual(backup,h.original);assert.equal(h.writes,1);assert.equal(h.paid,0);assert.equal(h.native,0);
  // Backup descriptors remain protected ledger rows; seven-day cleanup is a
  // separate cancellable maintenance operation, never part of shutdown.
  const record=h.sql.database.prepare("SELECT category,pinned FROM workspace_records WHERE collection='migrationBackups'").get() as {category:string;pinned:number};assert.equal(record.category,'ledger');assert.equal(record.pinned,1);await h.sql.port.close();
});

for(const recovery of ['history-conflict','unknown-command','failed-paper'] as const)test('migration backup expiry remains blocked by '+recovery+' recovery',async()=>{
  const h=harness(initialState());let runtime=h.runtime();await runtime.open({directory:'/profile',processSessionId:'process-1'});await runtime.close('shutdown');
  const inspector=await inspectStorage(h);
  if(recovery==='history-conflict')await inspector.put('history','interrupted',{id:'interrupted',date:new Date(DATE).toISOString(),label:'Interrupted native write',patches:[],suggestionIds:[],beforeOwnership:{},afterOwnership:{},status:'conflict'},{category:'history',status:'conflict',completedAt:DATE,pinned:true});
  if(recovery==='unknown-command')await inspector.put('commandLedger','interrupted',{command:{type:'tag'},status:'unknown',createdAt:DATE,error:'The native outcome needs recovery.'},{category:'ledger',status:'unknown',pinned:true});
  if(recovery==='failed-paper')await inspector.put('paperAttentionRows','unavailable',{id:'unavailable',title:'Unavailable source',status:'failed',message:'Restore the source.'},{category:'active',status:'failed'});
  await inspector.close();h.clock=DATE+8*86400000;
  for(const processSessionId of ['process-2','process-3']){runtime=h.runtime();await runtime.open({directory:'/profile',processSessionId});if(processSessionId==='process-2')await runtime.close('shutdown');}
  await runtime.execute({type:'clean-expired-data'},{commandId:'cleanup-with-recovery'});
  for(let attempt=0;attempt<1000;attempt++){const row=h.sql.database.prepare("SELECT status FROM workspace_records WHERE collection='commandLedger' AND id='cleanup-with-recovery'").get() as {status:string}|undefined;if(row?.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,2));}
  assert.equal((h.sql.database.prepare("SELECT status FROM workspace_records WHERE collection='commandLedger' AND id='cleanup-with-recovery'").get() as {status:string}).status,'completed');assert.equal(h.files.has('/profile/state.json.pre-v14.json'),true);assert.equal((h.sql.database.prepare("SELECT COUNT(*) AS count FROM workspace_records WHERE collection='migrationBackups'").get() as {count:number}).count,1);await runtime.close('disable');await h.sql.port.close();
});

test('closing during streamed migration cancels before provider creation and drains no archive work',async()=>{
  const h=harness({...fixture(),opaqueArchive:{raw:'Preserved archive. '.repeat(15000)}}),runtime=h.runtime();
  const actual=h.io.read;let unblock!:()=>void,entered!:()=>void;const paused=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>unblock=resolve);let blocked=false;
  h.io.read=async(path,range)=>{if(!blocked){blocked=true;entered();await gate;}return actual(path,range);};
  const opening=runtime.open({directory:'/profile'}),rejected=assert.rejects(opening,/closed/);await paused;
  const start=performance.now(),closing=runtime.close('disable');unblock();await closing;await rejected;
  assert.ok(performance.now()-start<250,'An interrupted import must not delete or serialize its archive during close.');assert.equal(h.providerCreated,0);assert.equal(h.paid,0);assert.equal(h.native,0);assert.equal(h.writes,0);assert.deepEqual(h.files.get('/profile/state.json'),h.original);
  await runtime.close('disable');await assert.rejects(runtime.execute({type:'resume'},{commandId:'after-close'}),/closed|not open/);await h.sql.port.close();
});

test('closing during archive validation stops the migration before backup or activation',async()=>{
  const source=fixture();source.taxonomyArchives=[{id:'history-source',date:new Date(DATE).toISOString(),version:1,tags:source.tags,redirects:{},reason:'Previous build'}];
  const h=harness(source),runtime=h.runtime();let blocked=false,entered!:()=>void,release!:()=>void;const paused=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  h.inspect=async(method,args)=>{if(!blocked&&method==='sql.query'&&String(args[0]).startsWith('SELECT COUNT(*) AS count')&&String((args[1] as unknown[])?.[0]).endsWith(':taxonomyArchives')){blocked=true;entered();await gate;}};
  const opening=runtime.open({directory:'/profile'}),rejected=assert.rejects(opening,/closed/);await paused;const start=performance.now(),closing=runtime.close('disable');release();await closing;await rejected;
  assert.ok(performance.now()-start<250);assert.equal(h.providerCreated,0);assert.equal(h.paid,0);assert.equal(h.native,0);assert.equal(h.writes,0);assert.deepEqual(h.files.get('/profile/state.json'),h.original);await h.sql.port.close();
});

test('a fresh workspace starts metadata indexing after reader readiness and reuses unchanged native versions',async()=>{
  const h=harness(fixture());h.files.delete('/profile/state.json');const source=fixture().papers['1:INTERRUPTED'];let bodies=0,pages=0;
  h.nativeReply=async(method,args)=>{
    if(method==='host.libraryPage'){pages++;return {items:[{itemID:source.itemID,paperId:source.id,version:'native-v1'}],total:1};}
    if(method==='host.read'){bodies++;assert.equal(args[0],source.itemID);return source;}
    if(method==='host.readTags')return [{tag:'Scientific tag',type:0}];
    throw new Error('Background indexing must only read metadata and native tags: '+method);
  };
  const runtime=h.runtime();await runtime.open({directory:'/profile'});assert.equal(h.native,0);
  const completed=()=>!!h.sql.database.prepare("SELECT 1 FROM workspace_records WHERE collection='state' AND id='libraryIndexProgress' AND status='completed'").get();
  await runtime.startIndexing();for(let attempt=0;!completed()&&attempt<1000;attempt++)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(completed());
  assert.equal(bodies,1);assert.equal((h.sql.database.prepare("SELECT COUNT(*) AS count FROM workspace_records WHERE collection='papers' AND native_item_id=1").get() as {count:number}).count,1);assert.equal(h.paid,0);
  const version=()=>Number((h.sql.database.prepare("SELECT version FROM workspace_records WHERE collection='state' AND id='libraryIndexProgress'").get() as {version:number}).version),firstVersion=version();
  await runtime.startIndexing();for(let attempt=0;(pages<2||version()===firstVersion)&&attempt<1000;attempt++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(pages,2);assert.ok(version()>firstVersion);assert.equal(bodies,1,'An unchanged native version must not hydrate its source again.');assert.equal(h.paid,0);
  await runtime.close('shutdown');await h.sql.port.close();
});

test('close cancels a background identity read before hydration or missing-source reconciliation',async()=>{
  const h=harness(fixture()),runtime=h.runtime();await runtime.open({directory:'/profile'});let entered!:()=>void,release!:()=>void;
  const paused=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  h.nativeReply=async method=>{assert.equal(method,'host.libraryPage');entered();await gate;return {items:[],total:0};};
  await runtime.startIndexing();await paused;const start=performance.now(),closing=runtime.close('disable');release();await closing;
  assert.ok(performance.now()-start<250);assert.equal((h.sql.database.prepare("SELECT COUNT(*) AS count FROM workspace_records WHERE collection='papers'").get() as {count:number}).count,1);assert.equal(h.paid,0);
  assert.deepEqual(h.calls.filter(call=>call.method.startsWith('host.')).map(call=>call.method),['host.libraryPage']);await h.sql.port.close();
});

test('library refresh queues a durable idempotent command and waits for the reader-ready signal',async()=>{
  const h=harness(fixture());h.files.delete('/profile/state.json');let pages=0;
  h.nativeReply=async method=>{assert.equal(method,'host.libraryPage');pages++;return {items:[],total:0};};
  const runtime=h.runtime();await runtime.open({directory:'/profile'});
  const [first,duplicate]=await Promise.all([runtime.execute({type:'refresh-library-index'},{commandId:'refresh-1'}),runtime.execute({type:'refresh-library-index'},{commandId:'refresh-1'})]);
  assert.deepEqual(first,duplicate);assert.equal(h.native,0,'A queued refresh waits until its query worker is ready.');assert.deepEqual(first.result,{queued:true,taskId:'library-index'});
  const request=()=>h.sql.database.prepare("SELECT status FROM workspace_records WHERE collection='libraryIndexRequests' AND id='refresh-1'").get() as {status:string};assert.equal(request().status,'queued');
  await runtime.startIndexing();for(let attempt=0;request().status!=='completed'&&attempt<1000;attempt++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(request().status,'completed');
  const before=pages;assert.deepEqual(await runtime.execute({type:'refresh-library-index'},{commandId:'refresh-1'}),first);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(pages,before);assert.equal(h.paid,0);
  await runtime.close('disable');await h.sql.port.close();
});

test('a failed background read keeps indexed sources and an explicit refresh retries without AI',async()=>{
  const h=harness(fixture()),runtime=h.runtime();let failed=true;
  h.nativeReply=async method=>{assert.equal(method,'host.libraryPage');if(failed)throw new Error('Native metadata is temporarily unavailable');return {items:[],total:0};};
  await runtime.open({directory:'/profile'});await runtime.startIndexing();
  const progress=()=>h.sql.database.prepare("SELECT status FROM workspace_records WHERE collection='state' AND id='libraryIndexProgress'").get() as {status:string}|undefined;
  for(let attempt=0;progress()?.status!=='failed'&&attempt<1000;attempt++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(progress()?.status,'failed');
  assert.equal((h.sql.database.prepare("SELECT COUNT(*) AS count FROM workspace_records WHERE collection='papers'").get() as {count:number}).count,1);
  failed=false;h.nativeReply=async method=>method==='host.libraryPage'?{items:[],total:0}:method==='host.read'?null:Promise.reject(new Error('Unexpected native operation'));
  await runtime.execute({type:'refresh-library-index'},{commandId:'retry-index'});
  const request=()=>h.sql.database.prepare("SELECT status FROM workspace_records WHERE collection='libraryIndexRequests' AND id='retry-index'").get() as {status:string};
  for(let attempt=0;request().status!=='completed'&&attempt<1000;attempt++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(request().status,'completed');assert.equal(h.paid,0);
  assert.equal((h.sql.database.prepare("SELECT COUNT(*) AS count FROM workspace_records WHERE collection='papers'").get() as {count:number}).count,0);
  await runtime.close('disable');await h.sql.port.close();
});
