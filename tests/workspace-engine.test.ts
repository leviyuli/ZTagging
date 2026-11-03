import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceEngine,createWorkerHost,requestIdentity} from '../src/workspace/engine.ts';
import {WorkingContext} from '../src/workspace/context.ts';
import {WorkspaceStore} from '../src/workspace/storage.ts';
import {memorySql} from './workspace-storage-adapter.ts';
import {AppController,automaticAssignmentHistoryId,initialState} from '../src/controller.ts';
import type {ControllerEnvironment} from '../src/controller.ts';
import {paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
import type {LibraryHost,NativeTag,TagPatch} from '../src/platform.ts';
import {ProviderError} from '../src/providers.ts';
import {createNativeTagDefinitionWork} from '../src/native-tag-definition.ts';

const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
function paper(index=1):PaperRecord{const value:PaperRecord={id:`1:P${index}`,itemID:index,libraryID:1,key:`P${index}`,title:`Catalyst-layer resistance ${index}`,abstract:'We measure catalyst-layer resistance in water electrolysis.',keywords:[],summary:'',concepts:[],fingerprint:''};value.fingerprint=paperFingerprint(value);return value;}
function fixture(papers=[paper()]){
  const native=new Map(papers.map(item=>[item.itemID,[] as NativeTag[]])),writes:TagPatch[][]=[];
  const host:LibraryHost={async list(){return copy(papers);},async read(id){return copy(papers.find(item=>item.itemID===id)??null);},async readTags(id){return copy(native.get(id)??[]);},async pdfText(){return '';},async apply(patches){writes.push(copy(patches));for(const patch of patches)native.set(patch.itemID,copy(patch.after));},async show(){},async saveSearch(){}};
  let requests=0,fail=false,inFlight=0,peakRequests=0;
  const ai:ControllerEnvironment['ai']={async hasApiKey(){return true;},async getSession(){return {connected:true,sharing:true,accountId:null,email:null,accounts:[]};},async testConnection(){return {value:{ok:true},text:'{}',usage:{inputTokens:1,outputTokens:1},usageKnown:true,estimatedCostUSD:0};},async listModels(){return [];},async setApiKey(){},async removeApiKey(){},async signIn(){return this.getSession();},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){},async completeJson(_system,prompt){
    requests++;inFlight++;peakRequests=Math.max(peakRequests,inFlight);await Promise.resolve();inFlight--;if(fail)throw new ProviderError('Connection ended after dispatch.','network');
    const marker='INPUT_DATA_JSON:\n',input=JSON.parse(prompt.slice(prompt.indexOf(marker)+marker.length)),value={summary:'The paper measures catalyst-layer resistance.',concepts:['catalyst-layer resistance'],needsPDF:false,newTagCandidates:[],suggestions:(input.approvedVocabulary??[]).map((tag:{id:string})=>({tagId:tag.id,reason:'The abstract measures this resistance.',confidence:input.paper.title.endsWith('100')?'medium':'high',match:'substantive',evidence:[{source:'abstract',text:input.paper.abstract}]}))};
    return {value,text:JSON.stringify(value),usage:{inputTokens:100,outputTokens:100},usageKnown:true,estimatedCostUSD:0.0001};
  }};
  return {host,ai,native,writes,get requests(){return requests;},get peakRequests(){return peakRequests;},set fail(value:boolean){fail=value;}};
}
async function readyEngine(papers=[paper()]){
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),f=fixture(papers),context=new WorkingContext(store);
  const state=initialState();state.settings={...state.settings,provider:'api',model:'test-model',inputPricePerMillion:1,outputPricePerMillion:1};state.tags[0]={...state.tags[0],status:'approved',matchingMode:'auto'};state.taxonomyReady=true;context.setState(state);await context.seed();
  const engine=new WorkspaceEngine({store,host:f.host,ai:f.ai,yieldControl:async()=>{}});await engine.open();
  return {sql,store,engine,...f,get requests(){return f.requests;},get peakRequests(){return f.peakRequests;},set fail(value:boolean){f.fail=value;}};
}

test('Workspace commands preserve semantic results and command identity without global snapshots',async()=>{
  const h=await readyEngine();const original=AppController.prototype.snapshot;AppController.prototype.snapshot=async()=>{throw new Error('A full-library snapshot must never be used.');};
  try{
    const settings={...initialState().settings,budgetUSD:12};const first=await h.engine.execute({type:'save-settings',payload:{settings}},{commandId:'settings-once'}),second=await h.engine.execute({type:'save-settings',payload:{settings:{...settings,budgetUSD:99}}},{commandId:'settings-once'});
    assert.deepEqual(second,first);assert.equal((await h.store.get('state','settings') as typeof settings).budgetUSD,12);assert.equal(h.requests,0);
    await h.engine.execute({type:'create-detail',payload:{tag:{...initialState().tags[0],id:'',name:'Water electrolysis',fullName:'Water electrolysis',aliases:[],description:'Electrochemical splitting of water.',status:'approved'}}},{commandId:'create-once'});
    assert.equal((await h.store.scan('tags',{limit:50})).total,2);
  }finally{AppController.prototype.snapshot=original;await h.engine.close('disable');await h.store.close();}
});

test('one assignment completes automatically through durable records and bounded native chunks',async()=>{
  const h=await readyEngine();
  try{
    const receipt=await h.engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'assign-1'});assert.ok(receipt.taskId);
    await h.engine.idle();assert.equal(await h.store.get('state','run',{path:['status']}),'idle');
    assert.equal(h.requests,1);assert.equal(h.native.get(1)?.some(tag=>tag.tag==='RCL'),true);assert.equal(h.writes.length,1);assert.ok(h.writes.every(chunk=>chunk.length<=20));
    assert.equal((await h.store.scan('providerReplies',{limit:50})).total,1);assert.equal((await h.store.scan('nativeChunks',{limit:50})).total,1);
    const run=await h.store.get('state','run') as {jobs?:unknown[]};assert.equal(run.jobs,undefined);assert.equal((await h.store.scan('runJobs',{limit:50})).total,1);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('unknown dispatched outcomes pause and cannot be charged again by resume',async()=>{
  const h=await readyEngine();h.fail=true;
  try{
    await h.engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'network-1'});
    await h.engine.idle();assert.equal(await h.store.get('state','run',{path:['status']}),'paused');assert.equal(h.requests,1);assert.equal(h.writes.length,0);const reserved=await h.store.get('state','run',{path:['spentUSD']});
    await h.engine.execute({type:'resume'},{commandId:'resume-1'});await h.engine.idle();assert.equal(await h.store.get('state','run',{path:['status']}),'paused');
    assert.equal(h.requests,1);assert.match(String(await h.store.get('state','run',{path:['message']})),/unknown outcome/);assert.equal(await h.store.get('state','run',{path:['spentUSD']}),reserved);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('an explicit retry dispatches once after an invalid paid reply and preserves its raw bytes and cost',async()=>{
  const h=await readyEngine(),complete=h.ai.completeJson.bind(h.ai);let attempts=0,invalid=true;
  h.ai.completeJson=async(...args)=>{attempts++;if(invalid)throw new ProviderError('The paid response was malformed.','invalid-response',{rawText:'ORIGINAL INVALID PAID BYTES',completion:{text:'ORIGINAL INVALID PAID BYTES',usage:{inputTokens:10,outputTokens:10},usageKnown:true,estimatedCostUSD:0.01}});return complete(...args);};
  try{
    await h.engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'invalid-first'});await h.engine.idle();assert.equal(attempts,1);assert.equal(await h.store.get('state','run',{path:['status']}),'paused');assert.equal(await h.store.get('state','run',{path:['spentUSD']}),0.01);
    await h.engine.idle();assert.equal(attempts,1);invalid=false;
    await h.engine.execute({type:'resume'},{commandId:'invalid-explicit-retry'});await h.engine.idle();assert.equal(attempts,2);assert.equal(await h.store.get('state','run',{path:['status']}),'idle');assert.equal(h.native.get(1)?.some(tag=>tag.tag==='RCL'),true);assert.ok(Number(await h.store.get('state','run',{path:['spentUSD']}))>=0.0101-1e-10);
    const old=(await h.store.scan('providerReplyHistory',{limit:50})).rows;assert.equal(old.length,1);assert.equal(await h.store.codec.read((await h.store.codec.lookup(old[0].token,['rawText']))!),'ORIGINAL INVALID PAID BYTES');
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('concurrent submissions of one command identity execute its source action once',async()=>{
  const h=await readyEngine();
  try{const command={type:'create-detail',payload:{tag:{...initialState().tags[0],id:'',name:'One new topic',fullName:'One new topic',aliases:[],description:'One explicit meaning.',status:'approved'}}};const receipts=await Promise.all([h.engine.execute(command,{commandId:'concurrent-once'}),h.engine.execute(command,{commandId:'concurrent-once'})]);assert.deepEqual(receipts[0],receipts[1]);assert.equal((await h.store.scan('tags',{limit:50})).total,2);}
  finally{await h.engine.close('disable');await h.store.close();}
});

test('queued intents persist only allowlisted scientific inputs and become seven-day history after starting',async()=>{
  const h=await readyEngine();
  try{
    await h.engine.execute({type:'scan',payload:{scope:'selected',frozenPaperIDs:[{itemID:1,paperId:'1:P1'}],apiKey:'DO NOT SAVE THIS KEY',credentials:{secret:'NO SECRET'},message:'PRIVATE MESSAGE'}},{commandId:'durable-scan'});await h.engine.idle();
    const input=await h.store.get('queuedInputs','durable-scan') as {command:{payload:Record<string,unknown>}};assert.deepEqual(input.command.payload,{scope:'selected',frozenPaperIDs:[{itemID:1,paperId:'1:P1'}]});assert.doesNotMatch(JSON.stringify(input),/SAVE THIS KEY|NO SECRET|PRIVATE MESSAGE/);assert.equal((await h.store.reference('queuedInputs','durable-scan'))!.metadata.category,'history');assert.equal((await h.store.reference('queuedInputs','durable-scan'))!.metadata.pinned,undefined);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('a pre-start queued intent resumes after readiness with its captured selection rather than the current pane',async()=>{
  const h=await readyEngine([paper(1),paper(2)]);let engine=h.engine;
  try{
    await engine.close('disable');const command={type:'tag',payload:{scope:'selected',processingPolicy:'auto-clear',frozenPaperIDs:[{itemID:1,paperId:'1:P1'}]}};
    await h.store.put('commandLedger','prestart',{command:{type:'tag'},status:'queued',taskId:'prestart-task',createdAt:Date.now()},{category:'ledger',status:'queued',taskId:'prestart-task',refs:[{collection:'queuedInputs',id:'prestart'}]});await h.store.put('queuedInputs','prestart',{command,createdAt:Date.now()},{category:'active',status:'queued',taskId:'prestart-task',pinned:true});
    h.host.list=async()=>[paper(2)];engine=new WorkspaceEngine({store:h.store,host:h.host,ai:h.ai,yieldControl:async()=>{}});await engine.open();assert.equal(h.requests,0);assert.equal(h.writes.length,0);
    await engine.resumeQueued();await engine.idle();assert.equal(h.requests,1);assert.equal(h.native.get(1)?.some(tag=>tag.tag==='RCL'),true);assert.equal(h.native.get(2)?.length,0);assert.equal(await h.store.get('commandLedger','prestart',{path:['status']}),'completed');
  }finally{await engine.close('disable');await h.store.close();}
});

test('a changed captured identity stops a queued task before provider dispatch',async()=>{
  const h=await readyEngine();
  try{
    await h.engine.execute({type:'tag',payload:{scope:'selected',processingPolicy:'auto-clear',frozenPaperIDs:[{itemID:1,paperId:'1:REMOVED-KEY'}]}},{commandId:'changed-selection'});await h.engine.idle();assert.equal(h.requests,0);assert.equal(h.writes.length,0);assert.equal(await h.store.get('commandLedger','changed-selection',{path:['status']}),'failed');assert.match(String(await h.store.get('commandLedger','changed-selection',{path:['error']})),/changed identity/);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('stopping a failed queued attempt expires its inputs without cancelling active scientific work',async()=>{
  const h=await readyEngine();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),waiting=new Promise<void>(resolve=>entered=resolve),complete=h.ai.completeJson.bind(h.ai);
  try{
    const failed=await h.engine.execute({type:'scan',payload:{scope:'selected',frozenPaperIDs:[{itemID:1,paperId:'1:OLD-KEY'}]}},{commandId:'failed-before-stop'});await h.engine.idle();
    h.ai.completeJson=async(...args)=>{entered();await gate;return complete(...args);};await h.engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'active-while-stopping'});await waiting;
    await h.engine.execute({type:'stop-queued-task',payload:{id:failed.taskId}},{commandId:'stop-failed-marker'});assert.equal(await h.store.get('state','run',{path:['status']}),'running');assert.equal(await h.store.get('activityTasks',failed.taskId!,{path:['state']}),'completed');assert.equal((await h.store.reference('queuedInputs','failed-before-stop'))!.metadata.category,'history');
    release();await h.engine.idle();assert.equal(h.native.get(1)?.some(tag=>tag.tag==='RCL'),true);
    let more=true;while(more){const result=await h.store.retain(Date.now()+8*86400000,50);await h.engine.afterRetention(result);more=result.more;}assert.equal(await h.store.reference('activityTasks',failed.taskId!),undefined);assert.equal(await h.store.reference('queuedInputs','failed-before-stop'),undefined);
  }finally{release?.();await h.engine.close('disable');await h.store.close();}
});

test('an unknown request requires its explicit recovery action before dispatching again',async()=>{
  const h=await readyEngine();h.fail=true;
  try{
    await h.engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'unknown-explicit'});await h.engine.idle();
    const unknown=(await h.store.scan('providerDispatches',{status:'unknown',limit:1})).rows[0];assert.ok(unknown);h.fail=false;
    await h.engine.execute({type:'retry-unknown-request',payload:{id:unknown.id}},{commandId:'explicit-retry'});await h.engine.idle();
    assert.equal(h.requests,2);assert.equal(h.native.get(1)?.some(tag=>tag.tag==='RCL'),true);assert.equal((await h.store.get('providerDispatches',unknown.id) as {status:string}).status,'replied');
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('a migrated legacy dispatch blocks Resume until explicit recovery authorizes another request',async()=>{
  const h=await readyEngine();h.fail=true;
  try{
    await h.engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'legacy-origin'});await h.engine.idle();
    const original=(await h.store.scan('providerDispatches',{status:'unknown',limit:1})).rows[0];await h.store.delete('providerDispatches',original.id);
    const runId=String(await h.store.get('state','run',{path:['id']}));await h.store.put('providerDispatches','legacy-request',{status:'unknown',legacy:true,taskId:runId,ownerRunId:runId,error:'The previous extension was interrupted.'},{category:'ledger',status:'unknown',taskId:runId,pinned:true});h.fail=false;
    const reserved=await h.store.get('state','run',{path:['spentUSD']});await h.engine.execute({type:'resume'},{commandId:'legacy-resume'});await h.engine.idle();assert.equal(h.requests,1);assert.equal(await h.store.get('state','run',{path:['spentUSD']}),reserved);
    await h.engine.execute({type:'retry-unknown-request',payload:{id:'legacy-request'}},{commandId:'legacy-authorize'});await h.engine.idle();assert.equal(h.requests,2);assert.equal(h.native.get(1)?.some(tag=>tag.tag==='RCL'),true);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('retention evicts completed working records so later runs do not resurrect expired data',async()=>{
  const h=await readyEngine();
  try{
    await h.engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'before-expiry'});await h.engine.idle();const runId=String(await h.store.get('state','run',{path:['id']}));
    let more=true;while(more){const result=await h.store.retain(Date.now()+8*86400000,50);await h.engine.afterRetention(result);more=result.more;}
    assert.equal(await h.store.reference('state','run'),undefined);assert.equal(await h.store.reference('assignmentRuns',runId),undefined);assert.equal(await h.store.reference('ownership','1:P1')!==undefined,true);
    await h.engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'after-expiry'});await h.engine.idle();assert.equal(await h.store.get('state','run',{path:['status']}),'idle');assert.equal(h.requests,2);assert.equal((await h.store.scan('history',{limit:50})).total,0);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('new unkeyed historical records do not overwrite archives that were never loaded',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),context=new WorkingContext(store);
  await store.put('factHistory','index:000000000000',{date:'2026-01-01',reason:'Original archived facts',facts:{paperId:'old'}},{category:'history',completedAt:Date.now()});
  context.state.factHistory=[{date:'2026-11-02',reason:'New archived facts',facts:{paperId:'new'} as any}];await context.checkpoint(context.state);
  assert.ok(await store.reference('factHistory','index:000000000000'));assert.equal((await store.scan('factHistory',{limit:50})).total,2);await store.close();
});

test('indexed reset clears unloaded reusable bodies while preserving tags, paid ledgers and recent Undo',async()=>{
  const h=await readyEngine();
  try{
    await h.store.put('analyses','unloaded',{raw:'Large reusable paid reply '.repeat(5000)},{category:'cache'});await h.store.put('facts','unloaded',{concepts:[]},{category:'cache'});
    await h.store.put('history','recent-undo',{id:'recent-undo',date:new Date().toISOString(),label:'Keep this native Undo',patches:[],beforeOwnership:{},afterOwnership:{},suggestionIds:[],status:'applied'},{category:'history',completedAt:Date.now()});
    await h.engine.execute({type:'reset-paper-analysis'},{commandId:'indexed-reset'});await h.engine.idle();
    assert.equal(await h.store.reference('analyses','unloaded'),undefined);assert.equal(await h.store.reference('facts','unloaded'),undefined);assert.ok(await h.store.reference('history','recent-undo'));assert.equal((await h.store.scan('tags',{limit:50})).total,1);assert.equal(await h.store.reference('workspace','analysisReset'),undefined);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('current definition evidence survives an edit and expiry while unrelated cache expires',async()=>{
  let now=Date.UTC(2026,10,2);const sql=memorySql(),store=await WorkspaceStore.open(sql.port,{clock:()=>now}),f=fixture(),context=new WorkingContext(store,{clock:()=>now}),state=initialState();state.tags[0].status='approved';state.settings.model='test-model';context.setState(state);await context.seed();
  await store.put('evidenceSources','current',{quote:'Current supporting quotation'},{category:'cache',lastUsedAt:now});await store.put('evidenceSources','unused',{quote:'Unused old quotation'},{category:'cache',lastUsedAt:now});
  const tag=(await store.reference('tags','custom-rcl'))!;await store.putReference('tags',tag.id,tag.token,{...tag.metadata,refs:[{collection:'evidenceSources',id:'current',relation:'source'}]});
  const engine=new WorkspaceEngine({store,host:f.host,ai:f.ai,clock:()=>now,yieldControl:async()=>{}});await engine.open();
  try{
    await engine.execute({type:'save-tag',payload:{tag:{...state.tags[0],description:'A refined meaning for catalyst-layer resistance.'}}},{commandId:'edit-with-proof'});
    now+=8*86400000;await engine.execute({type:'clean-expired-data'},{commandId:'expire-cache'});await engine.idle();
    assert.ok(await store.reference('evidenceSources','current'));assert.equal(await store.reference('evidenceSources','unused'),undefined);
  }finally{await engine.close('disable');await store.close();}
});

test('one uncertain paper leaves the other ninety-nine applied without another interaction',async()=>{
  const h=await readyEngine(Array.from({length:100},(_,index)=>paper(index+1)));
  try{
    await h.engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'one-hundred'});await h.engine.idle();
    assert.equal(await h.store.get('state','run',{path:['status']}),'idle');assert.equal(h.requests,100);assert.equal(h.peakRequests,1);
    assert.equal([...h.native.values()].filter(tags=>tags.some(tag=>tag.tag==='RCL')).length,99);assert.equal(h.native.get(100)?.length,0);
    assert.equal((await h.store.scan('reviewItems',{status:'open',limit:50})).total,1);assert.ok(h.writes.every(chunk=>chunk.length<=20));
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('working checkpoints leave unloaded archives untouched and share unchanged leaf payloads',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),state=initialState(),context=new WorkingContext(store);context.setState(state);await context.seed();
  await store.put('history','cold',{id:'cold',paid:'Do not decode this archive. '.repeat(50000)},{category:'history'});
  const cold=(await store.reference('history','cold'))!.token,before=await store.stats();await context.field('settings');context.state.settings.budgetUSD=15;await context.checkpoint(context.state);
  assert.deepEqual((await store.reference('history','cold'))!.token,cold);assert.equal((await store.stats()).records,before.records);
  assert.equal((await store.get('state','settings') as {budgetUSD:number}).budgetUSD,15);await store.close();
});

test('publishing a cloned state changes only the edited record version',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),context=new WorkingContext(store),state=initialState();
  state.tags.push({...state.tags[0],id:'unchanged-tag',name:'Unchanged topic'});state.papers['1:P1']=paper();state.factHistory=[{date:'2026-11-02',reason:'Unchanged archived facts',facts:{paperId:'old'} as any}];context.setState(state);await context.seed();
  const tagVersion=(await store.reference('tags','unchanged-tag'))!.version,paperVersion=(await store.reference('papers','1:P1'))!.version,settingsVersion=(await store.reference('state','settings'))!.version;
  const next=copy(context.state);next.tags[0].description='A refined meaning.';const changed=await context.checkpoint(next);
  assert.equal((await store.reference('tags','unchanged-tag'))!.version,tagVersion);assert.equal((await store.reference('papers','1:P1'))!.version,paperVersion);assert.equal((await store.reference('state','settings'))!.version,settingsVersion);assert.equal((await store.scan('factHistory',{limit:50})).total,1);assert.deepEqual([...changed.keys()],['tags']);assert.deepEqual([...changed.get('tags')!],['custom-rcl']);await store.close();
});

test('Pause cancels a manual cleanup slice without turning it into failed work',async()=>{
  const h=await readyEngine();let entered!:()=>void,wasAborted=false;const waiting=new Promise<void>(resolve=>entered=resolve),retain=h.store.retain.bind(h.store);
  h.store.retain=async(_now,_limit,signal)=>{entered();return new Promise((_resolve,reject)=>{signal!.addEventListener('abort',()=>{wasAborted=true;reject(signal!.reason);},{once:true});});};
  try{
    await h.engine.execute({type:'clean-expired-data'},{commandId:'cleanup-cancel'});await waiting;await h.engine.execute({type:'pause'},{commandId:'pause-cleanup'});await h.engine.idle();
    assert.equal(wasAborted,true);assert.equal(await h.store.get('commandLedger','cleanup-cancel',{path:['status']}),'completed');assert.equal(await h.store.get('commandLedger','cleanup-cancel',{path:['result','cancelled']}),true);assert.equal((await h.store.scan('activityTasks',{status:'paused',limit:50})).total,0);
  }finally{h.store.retain=retain;await h.engine.close('disable');await h.store.close();}
});

test('native deletion removes a cold indexed paper while retaining captured scientific evidence',async()=>{
  const h=await readyEngine(),deleted=paper(2);
  try{
    await h.store.put('papers',deleted.id,deleted,{category:'active',title:deleted.title,nativeItemId:2,refs:[{collection:'tags',id:'custom-rcl',relation:'matches'}]});await h.store.put('nativeTags',deleted.id,[{tag:'RCL',type:1}],{category:'active'});
    await h.store.put('nativeNamePapers',JSON.stringify(['rcl',deleted.id]),deleted.id,{category:'active',taskId:'rcl',refs:[{collection:'papers',id:deleted.id}]});await h.store.put('nativeNames','rcl',{name:'RCL',paperCount:1},{category:'active'});
    await h.store.put('providerScopes','preserved-proof',{paper:deleted,paid:'Unmodified captured context'},{category:'cache',lastUsedAt:Date.now()});
    await h.engine.itemsChanged([{itemID:2}]);
    assert.equal(await h.store.reference('papers',deleted.id),undefined);assert.equal(await h.store.reference('nativeTags',deleted.id),undefined);assert.equal((await h.store.scan('nativeNamePapers',{taskId:'rcl',limit:1})).total,0);assert.equal(await h.store.reference('nativeNames','rcl'),undefined);assert.equal(await h.store.get('libraryTags','custom-rcl',{path:['paperCount']}),0);assert.ok(await h.store.reference('providerScopes','preserved-proof'));assert.equal(h.requests,0);assert.equal(h.writes.length,0);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('only a complete library scan removes cold papers absent from the host',async()=>{
  const h=await readyEngine(),deleted=paper(2);
  try{
    await h.store.put('papers',deleted.id,deleted,{category:'active',title:deleted.title,nativeItemId:2});
    await h.engine.execute({type:'scan',payload:{scope:'selected'}},{commandId:'selected-scan'});await h.engine.idle();assert.ok(await h.store.reference('papers',deleted.id));
    await h.engine.execute({type:'scan',payload:{scope:'library'}},{commandId:'library-scan'});await h.engine.idle();assert.equal(await h.store.reference('papers',deleted.id),undefined);assert.ok(await h.store.reference('papers','1:P1'));assert.equal(h.requests,0);assert.equal(h.writes.length,0);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('a deleted source keeps its unresolved choice and paid context visible for recovery',async()=>{
  const h=await readyEngine([paper(100)]);
  try{
    await h.engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'uncertain-before-delete'});await h.engine.idle();const choices=(await h.store.scan('reviewItems',{status:'open',limit:50})).total,paid=(await h.store.scan('providerScopes',{limit:50})).total;assert.equal(choices,1);
    h.host.read=async()=>null;await h.engine.itemsChanged([{itemID:100}]);
    assert.equal(await h.store.reference('papers','1:P100'),undefined);assert.equal((await h.store.scan('reviewItems',{status:'open',limit:50})).total,choices);assert.equal((await h.store.scan('providerScopes',{limit:50})).total,paid);assert.equal(await h.store.get('paperAttentionRows','1:P100',{path:['status']}),'failed');assert.equal(h.requests,1);assert.equal(h.writes.length,0);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('background indexing saves bounded current rows and versions without AI or native writes',async()=>{
  const h=await readyEngine();
  try{
    await h.engine.ingestIndexed([{itemID:1,paperId:'1:P1',version:'native-v1'}]);assert.ok(await h.store.reference('papers','1:P1'));assert.equal((await h.store.reference('papers','1:P1'))!.metadata.nativeVersion,'native-v1');assert.equal((await h.store.reference('papers','1:P1'))!.metadata.nativeItemId,1);assert.equal(h.engine.context.state.papers['1:P1'],undefined);assert.equal(h.requests,0);assert.equal(h.writes.length,0);
    h.host.read=async()=>null;await h.engine.removeMissingIds(['1:P1']);assert.equal(await h.store.reference('papers','1:P1'),undefined);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('missing-ID reconciliation preserves a source created or restored after its identity page',async()=>{
  const h=await readyEngine();
  try{await h.engine.ingestIndexed([{itemID:1,paperId:'1:P1',version:'current'}]);await h.engine.removeMissingIds(['1:P1']);assert.ok(await h.store.reference('papers','1:P1'));h.host.read=async()=>{throw new Error('Temporary native read failure');};await h.engine.removeMissingIds(['1:P1']);assert.ok(await h.store.reference('papers','1:P1'));assert.equal(await h.store.get('paperAttentionRows','1:P1',{path:['status']}),'failed');}
  finally{await h.engine.close('disable');await h.store.close();}
});

test('derived indexing never marks cold records as loaded or deletes them on the next source edit',async()=>{
  const h=await readyEngine(),cold=paper(2);
  try{
    await h.store.put('papers',cold.id,cold,{category:'active',title:cold.title,nativeItemId:2});const version=(await h.store.reference('papers',cold.id))!.version;
    const tag=copy(h.engine.context.state.tags[0]);tag.description='An updated saved meaning.';await h.engine.execute({type:'save-tag',payload:{tag}},{commandId:'edit-before-cold'});
    assert.ok(await h.store.reference('papers',cold.id));assert.equal((await h.store.reference('papers',cold.id))!.version,version);
    h.engine.context.state.papers['1:P1']=paper();await h.engine.context.checkpoint(h.engine.context.state);assert.ok(await h.store.reference('papers',cold.id));
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('a job checkpoint writes only its changed indexed job and keeps an injected completion clock',async()=>{
  let now=123456789;const sql=memorySql(),store=await WorkspaceStore.open(sql.port,{clock:()=>now}),state=initialState(),context=new WorkingContext(store,{clock:()=>now});
  state.run={id:'bounded-run',kind:'tag',scope:'library',automatic:false,status:'paused',jobs:Array.from({length:100},(_,index)=>({id:`job-${index}`,paperId:`1:P${index}`,status:'pending'})),vocabCursor:0,vocabFinished:false,spentUSD:0,settings:state.settings,vocabularyVersion:0};context.setState(state);await context.seed();
  const before=new Map<string,number>();let after:string|undefined;do{const page=await store.scan('runJobs',{after,limit:50});for(const row of page.rows)before.set(row.id,row.version);after=page.next;}while(after);
  now+=1000;context.state.run!.jobs[50].status='completed';await context.checkpoint(context.state);
  for(const [id,version] of before){const current=(await store.reference('runJobs',id))!;assert.equal(current.version===version,id!=='job-50');}assert.equal((await store.reference('runJobs','job-50'))!.metadata.completedAt,now);assert.equal((await store.reference('runJobs','job-50'))!.metadata.category,'history');await store.close();
});

test('a change made during a durable checkpoint remains dirty until its own checkpoint',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),context=new WorkingContext(store);await context.seed();
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),waiting=new Promise<void>(resolve=>entered=resolve),flush=store.codec.flush.bind(store.codec);let block=true;
  store.codec.flush=async()=>{if(block){block=false;entered();await gate;}await flush();};
  context.state.settings.budgetUSD=10;const first=context.checkpoint(context.state);await waiting;context.state.settings.budgetUSD=20;release();await first;
  assert.equal(context.changedFields().has('settings'),true);await context.checkpoint(context.state);assert.equal((await store.get('state','settings') as {budgetUSD:number}).budgetUSD,20);assert.equal(context.changedFields().size,0);await store.close();
});

test('the worker host pages identities and computes scientific fingerprints after RPC',async()=>{
  const calls:{method:string;args:unknown[]}[]=[],source=paper();source.fingerprint='';
  const host=createWorkerHost(async(method,args)=>{calls.push({method,args});if(method==='host.ids')return args[1]?{ids:[2]}:{ids:[1],cursor:'next'};if(method==='host.read')return {...source,itemID:Number(args[0]),id:`1:P${args[0]}`};if(method==='host.pdfSource')return 'cache.txt';return [];},async(_path,offset)=>new TextEncoder().encode(offset?'':'PDF excerpt'),'group');
  const result=await host.list('library');assert.equal(result.length,2);assert.ok(result.every(paper=>paper.fingerprint===paperFingerprint(paper)));assert.equal(await host.pdfText(1),'PDF excerpt');assert.deepEqual(calls.filter(call=>call.method==='host.ids').map(call=>call.args),[['library',undefined],['library','next']]);
});

test('a paid reply and applied native chunk survive restart, and Undo suppresses immediate reapplication',async()=>{
  const h=await readyEngine();let engine=h.engine,failAck=true;
  h.sql.fail((statement,parameters)=>{if(failAck&&statement.startsWith('INSERT INTO workspace_records')&&parameters[0]==='nativeChunks'){failAck=false;return true;}return false;});
  try{
    await engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'interrupted-chunk'});await engine.idle();h.sql.fail();
    assert.equal(h.requests,1);assert.equal(h.native.get(1)?.some(tag=>tag.tag==='RCL'),true);assert.equal(await h.store.get('state','run',{path:['status']}),'paused');
    await engine.close('disable');engine=new WorkspaceEngine({store:h.store,host:h.host,ai:h.ai,yieldControl:async()=>{}});await engine.open();
    await engine.execute({type:'resume'},{commandId:'restart-resume'});await engine.idle();assert.equal(await h.store.get('state','run',{path:['status']}),'idle');assert.equal(h.requests,1);assert.equal(h.writes.length,1);
    const applied=(await h.store.scan('history',{status:'applied',limit:50})).rows;assert.equal(applied.length,1);
    await engine.execute({type:'undo',payload:{id:applied[0].id}},{commandId:'undo-chunk'});assert.equal(h.native.get(1)?.length,0);
    await engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'after-undo'});await engine.idle();assert.equal(h.native.get(1)?.length,0);assert.equal(h.requests,1);
  }finally{h.sql.fail();await engine.close('disable');await h.store.close();}
});

test('one automatic run retains a single logical Undo across more than twenty native papers and restart',async()=>{
  const h=await readyEngine(Array.from({length:25},(_,index)=>paper(index+1)));let engine=h.engine;
  try{
    await engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'grouped-twenty-five'});await engine.idle();const runId=String(await h.store.get('state','run',{path:['id']})),id=automaticAssignmentHistoryId(runId),histories=await h.store.scan('history',{status:'applied',limit:50});assert.equal(histories.total,1);assert.equal(histories.rows[0].id,id);assert.equal((await h.store.get('history',id,{path:['patches']}) as unknown[]).length,25);
    await engine.close('disable');engine=new WorkspaceEngine({store:h.store,host:h.host,ai:h.ai,yieldControl:async()=>{}});await engine.open();const written=h.writes.length;await engine.execute({type:'undo',payload:{id}},{commandId:'undo-entire-run'});assert.equal([...h.native.values()].filter(tags=>tags.some(tag=>tag.tag==='RCL')).length,0);assert.deepEqual(h.writes.slice(written).map(chunk=>chunk.length),[20,5]);assert.equal(h.requests,25);
    await engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'after-run-undo'});await engine.idle();assert.equal([...h.native.values()].filter(tags=>tags.some(tag=>tag.tag==='RCL')).length,0);assert.equal(h.requests,25);
  }finally{await engine.close('disable');await h.store.close();}
});

test('history append checkpoints encode only newly appended native patch bodies',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),context=new WorkingContext(store),state=initialState(),first={paperId:'1:P1',itemID:1,before:[],after:[{tag:'Original native patch body',type:1}]};
  state.history=[{id:'append-history',date:new Date().toISOString(),label:'Native patches',patches:[first],beforeOwnership:{},afterOwnership:{},suggestionIds:[],status:'applied'}];context.setState(state);await context.seed();const encoded:unknown[]=[],encode=store.codec.encode.bind(store.codec);store.codec.encode=async value=>{encoded.push(value);return encode(value);};
  context.state.history[0].patches.push({paperId:'1:P2',itemID:2,before:[],after:[{tag:'New native patch body',type:1}]});await context.checkpoint(context.state);assert.ok(encoded.some(value=>value&&typeof value==='object'&&(value as {itemID?:number}).itemID===2));assert.equal(encoded.some(value=>Array.isArray(value)&&value.some(value=>value?.itemID===1)),false);assert.equal((await store.get('history','append-history',{path:['patches']}) as unknown[]).length,2);
  context.state.history[0].patches[0].after=[{tag:'Corrected first patch',type:1}];await context.checkpoint(context.state);assert.equal(await store.get('history','append-history',{path:['patches',0,'after',0,'tag']}),'Corrected first patch');await store.close();
});

test('opening an archived native choice hydrates its exact protected context and task after restart',async()=>{
  const h=await readyEngine();let engine=h.engine;const source=paper(),work=createNativeTagDefinitionWork({papers:[source],nativeTags:{[source.id]:[{tag:'Important',type:0}]},definitions:[],facts:{},decisions:{},vocabularyVersion:1,applied:false},['Important'],{selectionPolicyVersion:1}),taskId='archived-native-task';
  try{
    engine.context.state.nativeDefinitionHistory=[{work,taskId,shelfId:'all',appliedEntryIds:[],processingPolicy:'auto-clear'}];engine.context.state.maintenanceTasks=[{id:taskId,kind:'define-native',status:'completed',run:{id:'archived-native-run',kind:'rebuild',scope:'library',automatic:false,status:'idle',jobs:[],vocabCursor:0,vocabFinished:true,spentUSD:0,settings:engine.context.state.settings,vocabularyVersion:1},cursor:0,createdAt:new Date().toISOString(),groupIds:[],paperIds:[source.id],definitionWorkId:work.id}];engine.context.state.reviewItems=[{id:'archived-native-choice',kind:'definition',state:'open',taskId,workId:work.id,questionId:work.entries[0].id,ownerPage:'vocabulary',label:'Important',conditionFingerprint:'archived-condition'}];await engine.context.checkpoint(engine.context.state);await engine.close('disable');
    engine=new WorkspaceEngine({store:h.store,host:h.host,ai:h.ai,yieldControl:async()=>{}});await engine.open();assert.equal(engine.context.state.nativeDefinitionHistory?.length??0,0);await engine.execute({type:'open-meaning-work',payload:{id:work.id,taskId}},{commandId:'open-old-native-task'});assert.equal(await h.store.get('state','nativeDefinitionPreparation',{path:['work','id']}),work.id);const pending=await h.store.scan('reviewItems',{taskId,status:'open',limit:50});assert.ok(pending.rows.length);await engine.execute({type:'open-review-item',payload:{id:pending.rows[0].id}},{commandId:'open-old-native'});assert.ok(engine.context.state.maintenanceTasks?.some(task=>task.id===taskId));assert.equal(h.requests,0);assert.equal(h.writes.length,0);
  }finally{await engine.close('disable');await h.store.close();}
});

test('unrelated worker saves preserve unloaded archived choices and cold assignment decisions',async()=>{
  const h=await readyEngine();
  try{
    await h.store.put('reviewItems','cold-meaning',{id:'cold-meaning',kind:'definition',state:'deferred',taskId:'archived-task',workId:'archived-work',questionId:'archived-question',ownerPage:'vocabulary',label:'A saved meaning',conditionFingerprint:'archived-input'},{category:'active',status:'deferred',pinned:true});await h.store.put('reviewItems','cold-assignment',{id:'cold-assignment',kind:'assignment',state:'open',taskId:'older-assignment',suggestionId:'cold-suggestion',paperId:'1:OLD',tagId:'custom-rcl',ownerPage:'assignment',label:'A saved assignment',conditionFingerprint:'older-input'},{category:'active',status:'open',pinned:true});
    const tag={...h.engine.context.state.tags[0],description:'An unrelated definition edit.'};await h.engine.execute({type:'save-tag',payload:{tag}},{commandId:'unrelated-to-cold-choices'});assert.equal(await h.store.get('reviewItems','cold-meaning',{path:['state']}),'deferred');assert.equal(await h.store.get('reviewItems','cold-assignment',{path:['state']}),'open');assert.equal(h.requests,0);assert.equal(h.writes.length,0);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('a saved assignment choice applies directly after restart with only its own paper context',async()=>{
  const h=await readyEngine([paper(100)]);let engine=h.engine;
  try{await engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'saved-medium-match'});await engine.idle();const item=(await h.store.scan('reviewItems',{status:'open',limit:1})).rows[0];assert.ok(item);await engine.close('disable');engine=new WorkspaceEngine({store:h.store,host:h.host,ai:h.ai,yieldControl:async()=>{}});await engine.open();assert.equal(engine.context.state.papers['1:P100'],undefined);await engine.execute({type:'resolve-review-item',payload:{id:item.id,action:'accept'}},{commandId:'accept-cold-assignment'});assert.equal(h.native.get(100)?.some(tag=>tag.tag==='RCL'),true);assert.equal(h.requests,1);assert.equal(await h.store.get('reviewItems',item.id,{path:['state']}),'resolved');}
  finally{await engine.close('disable');await h.store.close();}
});

test('native meanings retain compatible factual context after a cold restart without loading unrelated facts',async()=>{
  const h=await readyEngine();let engine=h.engine;const p=paper(),facts={paperId:p.id,metadataFingerprint:p.fingerprint,inputFingerprint:p.fingerprint,provider:'api',model:'test-model',extractionVersion:1,summary:'Exact retained source findings.',needsPDF:false,concepts:[{factConceptId:'retained-native-fact',name:'catalyst-layer resistance',facet:'phenomenon',evidence:[{source:'abstract',text:p.abstract}]}]};
  try{
    h.native.set(1,[{tag:'Important',type:0}]);await h.store.put('facts',p.id,facts,{category:'cache',lastUsedAt:Date.now()-5*86400000});await h.store.put('facts','unrelated-source',{...facts,paperId:'unrelated-source'},{category:'cache',lastUsedAt:Date.now()-5*86400000});await engine.close('disable');engine=new WorkspaceEngine({store:h.store,host:h.host,ai:h.ai,yieldControl:async()=>{}});await engine.open();assert.equal(engine.context.state.facts[p.id],undefined);
    await engine.execute({type:'prepare-tag-meanings',payload:{names:['Important'],shelfId:'all',processingPolicy:'auto-clear'}},{commandId:'cold-native-facts'});await engine.idle();const review=engine.context.state.nativeDefinitionPreparation!;assert.equal(review.work.snapshot.facts[p.id].concepts[0].factConceptId,'retained-native-fact');assert.equal(engine.context.state.facts['unrelated-source'],undefined);assert.equal(h.requests,0);assert.equal(h.writes.length,0);
    await engine.close('disable');engine=new WorkspaceEngine({store:h.store,host:h.host,ai:h.ai,yieldControl:async()=>{}});await engine.open();await engine.execute({type:'set-native-tag-treatment',payload:{name:'Important',treatment:'personal',id:review.work.id,entryId:review.work.entries[0].id}},{commandId:'cold-native-personal'});assert.equal(engine.context.state.nativeTagTreatments?.important,'personal');assert.equal(h.requests,0);
  }finally{await engine.close('disable');await h.store.close();}
});

test('restart recovery of a partial grouped Undo preserves suppression for its acknowledged papers',async()=>{
  const h=await readyEngine(Array.from({length:25},(_,index)=>paper(index+1)));let engine=h.engine;
  try{
    await engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'before-partial-group-undo'});await engine.idle();const id=automaticAssignmentHistoryId(String(await h.store.get('state','run',{path:['id']}))),original=await h.store.get('history',id) as any;await engine.close('disable');
    const undo={id:'interrupted-group-undo',date:new Date().toISOString(),label:'Undo: Automatic tag assignments',patches:original.patches.map((patch:TagPatch)=>({...patch,before:patch.after,after:patch.before})),beforeOwnership:original.afterOwnership,afterOwnership:original.beforeOwnership,beforeDecisions:original.afterDecisions,afterDecisions:original.beforeDecisions,suggestionIds:[],status:'prepared',undoOfId:id};await h.store.put('state','pendingChange',undo,{category:'active',pinned:true});await h.host.apply(undo.patches.slice(0,20),'Synthetic interrupted Undo chunk');
    engine=new WorkspaceEngine({store:h.store,host:h.host,ai:h.ai,yieldControl:async()=>{}});await engine.open();assert.equal((await h.store.scan('automaticSuppressions',{limit:50})).total,20);assert.equal([...h.native.values()].filter(tags=>tags.some(tag=>tag.tag==='RCL')).length,5);
    await engine.execute({type:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}},{commandId:'after-partial-group-undo'});await engine.idle();assert.equal([...h.native.values()].filter(tags=>tags.some(tag=>tag.tag==='RCL')).length,5);assert.equal(h.requests,25);
  }finally{await engine.close('disable');await h.store.close();}
});

test('API credentials never enter the durable command ledger',async()=>{
  const h=await readyEngine();
  try{
    const key='fixture-secret-do-not-store';await h.engine.execute({type:'save-api-key',payload:{key,provider:'api'}},{commandId:'credential-change'});
    const ledger=await h.store.get('commandLedger','credential-change');assert.equal(JSON.stringify(ledger).includes(key),false);assert.deepEqual((ledger as {command:unknown}).command,{type:'save-api-key'});
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('worker paper leases reassemble large raw fields, release resources and preserve input assessment',async()=>{
  const p=paper(),abstract='<p>'+('An exact long scientific quotation. '.repeat(700))+'</p>',keyword='a'.repeat(9000),released:string[]=[],reads:number[]=[];
  const host=createWorkerHost(async(method,args)=>{
    if(method==='host.read')return {paper:{...p,abstract:'',keywords:[]},lease:'source',fields:{abstract:abstract.length,keywords:1}};
    if(method==='host.paperField'){assert.equal(args[3],8192);const value=args[1]==='abstract'?abstract:keyword;return value.slice(Number(args[2]),Number(args[2])+8192);}
    if(method==='host.releasePaper'){released.push(String(args[0]));return;}
    if(method==='host.inspectInputs')return {paperId:p.id,itemID:p.itemID,checkedAt:'2026-11-02',metadata:{title:true,abstract:true,keywords:false},pdf:{status:'textUnavailable',attachmentCount:1,localCount:1,characters:0,rechecked:false},cachePaths:['cache']};
    throw new Error('Unexpected host call '+method);
  },async(_path,offset,length)=>{reads.push(length);return new TextEncoder().encode(offset?'':'  Exact PDF quotation.  ');},()=> 'group');
  const result=await host.read(1);assert.equal(result!.abstract,abstract.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());assert.deepEqual(result!.keywords,[keyword]);assert.deepEqual(released,['source']);assert.equal(result!.fingerprint,paperFingerprint(result!));
  const assessment=await host.inspectInputs!(1);assert.equal(assessment.pdf.status,'readable');assert.equal(assessment.pdf.characters,'Exact PDF quotation.'.length);assert.ok(reads.every(length=>length===64*1024));assert.equal('cachePaths' in assessment,false);
});

test('request identities are semantic SHA-256 values independent of storage and pricing',async()=>{
  const settings={mode:'api' as const,model:'test-model',timeoutMs:1,inputCostPerMillion:1,maxOutputTokens:512};
  const first=await requestIdentity('Scientific checks','Actual paper input',settings);assert.match(first,/^[a-f0-9]{64}$/);
  assert.equal(await requestIdentity('Scientific checks','Actual paper input',{...settings,timeoutMs:120000,inputCostPerMillion:8,maxOutputTokens:2048}),first);
  assert.notEqual(await requestIdentity('Scientific checks','Changed paper input',settings),first);assert.notEqual(await requestIdentity('Scientific checks','Actual paper input',{...settings,model:'other-model'}),first);
});

test('an active native work larger than the decoded-cache budget loads exactly in the worker context',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port,{cacheBytes:256*1024}),source=paper();source.pdfText='Exact source text. '.repeat(2_000_000);source.fingerprint=paperFingerprint(source);
  const input={papers:[source],nativeTags:{[source.id]:[{tag:'Batteries',type:0}]},definitions:[],facts:{},decisions:{},vocabularyVersion:1,applied:false},work=createNativeTagDefinitionWork(input,['Batteries']);
  await store.put('state','nativeDefinitionPreparation',{work,taskId:'large-native-task',shelfId:'all',appliedEntryIds:[]},{category:'active'});assert.ok((await store.reference('state','nativeDefinitionPreparation'))!.bytes>32*1024*1024);
  const context=new WorkingContext(store);await context.field('nativeDefinitionPreparation');const restored=context.state.nativeDefinitionPreparation!.work;
  assert.equal(restored.fingerprint,work.fingerprint);assert.equal(restored.snapshot.papers[0].pdfText,source.pdfText);assert.ok((await store.stats()).decodedCacheBytes<=256*1024);await store.close();
});
