import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/controller.ts';
import type {ControllerEnvironment} from '../src/controller.ts';
import {paperFingerprint} from '../src/core.ts';
import {WorkspaceEngine} from '../src/workspace/engine.ts';
import type {LibraryHost} from '../src/platform.ts';
import {WorkspaceStore,RETENTION_MS} from '../src/workspace/storage.ts';
import {WorkingContext} from '../src/workspace/context.ts';
import {buildView} from '../src/workspace/views.ts';
import {newRunOperations,updateRun} from '../src/workspace/runs.ts';
import {buildOriginOperation} from '../src/workspace/workflow-policy.ts';
import {memorySql} from './workspace-storage-adapter.ts';
import {scientificFixtureReply,fixtureTagName} from '../scripts/workspace-scientific-fixture.js';

async function harness(empty=false){
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),state=initialState();
  state.settings={...state.settings,provider:'api',model:'fixture',inputPricePerMillion:1,outputPricePerMillion:1};
  state.tags[0]={...state.tags[0],status:'approved',matchingMode:'auto'};state.taxonomyReady=true;
  if(empty){state.tags=[];state.taxonomyReady=false;}
  const context=new WorkingContext(store);context.setState(state);await context.seed();
  if(state.tags.length)await store.commitRecords([buildOriginOperation({tagId:state.tags[0].id,definition:state.tags[0],workId:'fixture-build'})]);
  const paper={id:'1:p',itemID:1,libraryID:1,key:'p',title:'Measured proton transport',abstract:'Experiments directly measure membrane proton transport.',keywords:[],summary:'',concepts:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
  let calls=0;const native: {tag:string;type:number}[]=[];
  const ai:ControllerEnvironment['ai']={async hasApiKey(){return true;},async getSession(){return {connected:false,sharing:false,accountId:null,email:null,accounts:[]};},async completeJson(_system,prompt){calls++;const input=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]);const value={summary:'Direct membrane transport measurements.',concepts:[],needsPDF:false,newTagCandidates:[],suggestions:input.approvedVocabulary.map((tag:{id:string})=>({tagId:tag.id,confidence:'high',match:'substantive',reason:'Direct experimental evidence.',evidence:[{source:'abstract',text:paper.abstract}]}))};return {value,text:JSON.stringify(value),usage:{inputTokens:1,outputTokens:1},usageKnown:true,estimatedCostUSD:0};},async testConnection(){throw new Error('unused');},async listModels(){return [];},async setApiKey(){},async removeApiKey(){},async signIn(){throw new Error('unused');},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}};
  const host:LibraryHost={async list(){return [structuredClone(paper)];},async read(){return structuredClone(paper);},async readTags(){return structuredClone(native);},async pdfText(){return '';},async apply(patches){native.splice(0,native.length,...patches[0].after);},async show(){},async saveSearch(){}};
  const engine=new WorkspaceEngine({store,ai,host,yieldControl:async()=>{}});
  await engine.open();return {store,sql,engine,paper,ai,native,host,get calls(){return calls;}};
}

test('a migrated empty evidence header builds and saves through commands without repeating paid work',async()=>{
  const h=await harness(true);let requests=0;
  try{
    await h.store.put('state','evidenceCatalog',{});
    h.ai.completeJson=async(_system,prompt)=>{requests++;const input=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]),value=scientificFixtureReply(input);assert.ok(value,'Fixture must recognize every scientific request');return {value,text:JSON.stringify(value),usage:{inputTokens:1,outputTokens:1},usageKnown:true,estimatedCostUSD:0};};
    const receipt=await h.engine.execute({type:'prepare-tags',payload:{scope:'selected',mode:'extend'}},{commandId:'build-migrated'});await h.engine.idle();
    const view=await buildView(h.store,{page:'build',params:{runId:receipt.runId}});
    assert.equal(view.model!.run!.status,'completed',JSON.stringify(view.model!.run));assert.equal(view.model!.buildResult!.savedCount,1);assert.equal(view.model!.buildResult!.questionCount,0);
    const library=await buildView(h.store,{page:'vocabulary',params:{buildRunId:view.model!.run!.resultRunId}});assert.equal(library.model!.tags[0].name,fixtureTagName);assert.equal(library.total,1);assert.ok(await h.store.reference('definitionOrigins',library.model!.tags[0].id));
    const paid=requests;await h.engine.execute({type:'resume'},{commandId:'already-finished'});await h.engine.idle();assert.equal(requests,paid);
    const repeated=await h.engine.execute({type:'prepare-tags',payload:{scope:'selected',mode:'extend'}},{commandId:'repeat-build'});await h.engine.idle();
    const repeat=await buildView(h.store,{page:'build',params:{runId:repeated.runId}});assert.equal(repeat.model!.run!.status,'completed');assert.equal(repeat.model!.buildResult!.savedCount,0);assert.equal(repeat.model!.buildResult!.reusedCount,1);assert.equal(repeat.model!.buildResult!.reason,'reused');
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('saved scientific filters stay in the plugin and never become native label searches',async()=>{
  const h=await harness();try{
    await h.engine.execute({type:'save-search',payload:{name:'My scientific filter',filter:{mode:'all',selections:[{conceptId:'custom-rcl'}]}}},{commandId:'saved-filter'});
    const view=await buildView(h.store,{page:'library'});assert.equal(view.model!.savedFilters!.length,1);assert.equal(view.model!.savedFilters![0].filter.selections[0].conceptId,'custom-rcl');assert.equal(h.calls,0);
    await h.engine.execute({type:'delete-saved-filter',payload:{id:view.model!.savedFilters![0].id}},{commandId:'delete-filter'});assert.equal((await buildView(h.store,{page:'library'})).model!.savedFilters!.length,0);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('a queued assignment has one durable logical run before hydration and retry reuses it',async()=>{
  const h=await harness(),catalog=h.engine.context.catalog.bind(h.engine.context);
  try{
    h.engine.context.catalog=async()=>{throw new Error('Synthetic migrated-header failure');};
    const receipt=await h.engine.execute({type:'prepare-tags',payload:{scope:'selected',mode:'extend'}},{commandId:'prestart'});
    assert.ok(receipt.runId);await h.engine.idle();
    const failed=await buildView(h.store,{page:'build',params:{runId:receipt.runId}});assert.equal(failed.model!.run!.status,'failed');assert.match(failed.model!.run!.error!,/migrated-header/);assert.equal(h.calls,0);
    h.engine.context.catalog=catalog;
    // A source-loading failure remains the same user action on its next attempt.
    h.engine.context.catalog=async()=>{throw new Error('Second synthetic failure');};
    const retry=await h.engine.execute({type:'retry-run',payload:{id:receipt.runId}},{commandId:'retry'});await h.engine.idle();
    assert.equal(retry.runId,receipt.runId);const runs=await buildView(h.store,{page:'activity'});assert.equal(runs.total,1);assert.equal(runs.model!.runs![0].attemptCount,2);assert.equal(h.calls,0);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('a clear assignment exposes completed results and exact underlying run identity',async()=>{
  const h=await harness();try{
    const receipt=await h.engine.execute({type:'tag',payload:{scope:'selected',processingPolicy:'auto-clear'}},{commandId:'clear'});await h.engine.idle();
    const view=await buildView(h.store,{page:'assignment',params:{runId:receipt.runId}}),run=view.model!.run!;
    assert.equal(run.status,'completed',JSON.stringify(run));assert.equal(run.paperCount,1);assert.equal(run.completedPaperCount,1);assert.ok(run.resultRunId);assert.equal(run.appliedCount,1);assert.equal(h.calls,1);
    const source=await h.store.get('state','run',{path:['id']});assert.equal(run.resultRunId,source);assert.equal((await buildView(h.store,{page:'activity'})).total,1);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('run pages stay bounded and completed inputs and links expire with their run',async()=>{
  let now=RETENTION_MS*3;const store=await WorkspaceStore.open(memorySql().port,{clock:()=>now});
  try{
    for(let index=0;index<70;index++){const id='run-'+index;await store.commitRecords(newRunOperations(id,{type:'prepare-tags',payload:{scope:'selected'}},now));await store.put('runLinks','source-'+index,{id},{category:'ledger'});await updateRun(store,id,{status:'completed',sourceRunId:'source-'+index},now);}
    const page=await buildView(store,{page:'activity'},{clock:()=>now});assert.equal(page.total,70);assert.equal(page.model!.runs!.length,50);assert.equal(page.nextCursor,'50');assert.ok(Buffer.byteLength(JSON.stringify(page))<=256*1024);
    now+=RETENTION_MS+1;for(let pass=0;pass<20;pass++)if(!(await store.retain(now,50)).more)break;
    assert.equal((await store.scan('runs',{limit:1})).total,0);assert.equal((await store.scan('runInputs',{limit:1})).total,0);assert.equal((await store.scan('runLinks',{limit:1})).total,0);
  }finally{await store.close();}
});

test('terminal run metadata and retry intents roll back together when persistence fails',async()=>{
  const h=await harness();try{
    await h.store.commitRecords(newRunOperations('atomic',{type:'tag',payload:{scope:'selected'}},10));
    h.sql.fail((sql,params)=>sql.startsWith('INSERT INTO workspace_records')&&params[0]==='runInputs');
    await assert.rejects(updateRun(h.store,'atomic',{status:'completed'},20),/Synthetic SQL failure/);h.sql.fail();
    assert.equal(await h.store.get('runs','atomic',{path:['status']}),'queued');assert.equal((await h.store.reference('runInputs','atomic'))!.metadata.category,'active');
    await updateRun(h.store,'atomic',{status:'failed',canRetry:true},30);
    h.sql.fail((sql,params)=>sql.startsWith('INSERT INTO workspace_records')&&params[0]==='commandLedger');
    await assert.rejects(h.engine.execute({type:'retry-run',payload:{id:'atomic'}},{commandId:'failed-enqueue'}),/Synthetic SQL failure/);h.sql.fail();
    assert.equal(await h.store.get('runs','atomic',{path:['status']}),'failed');assert.equal(await h.store.get('runs','atomic',{path:['canRetry']}),true);
  }finally{h.sql.fail();await h.engine.close('disable');await h.store.close();}
});

test('native-only indexing preserves PDF-grounded input while real metadata changes clear derived text',async()=>{
  const h=await harness();try{
    const original={...h.paper,pdfText:'Original verified PDF excerpt.',summary:'A validated synopsis.',concepts:['proton transport']};original.fingerprint=paperFingerprint(original);
    await h.store.put('papers',original.id,original,{nativeItemId:1,title:original.title});
    await h.engine.ingestIndexed([{itemID:1,paperId:original.id,version:'labels-only'}]);
    assert.equal(await h.store.get('papers',original.id,{path:['fingerprint']}),original.fingerprint);assert.equal(await h.store.get('papers',original.id,{path:['pdfText']}),original.pdfText);assert.equal((await h.store.reference('papers',original.id))!.metadata.nativeItemId,1);
    h.paper.abstract='A materially changed abstract with new scientific input.';
    await h.engine.ingestIndexed([{itemID:1,paperId:original.id,version:'source-edit'}]);
    assert.equal(await h.store.get('papers',original.id,{path:['summary']}),'');assert.deepEqual(await h.store.get('papers',original.id,{path:['concepts']}),[]);assert.notEqual(await h.store.get('papers',original.id,{path:['fingerprint']}),original.fingerprint);assert.equal(h.calls,0);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('cancelling an intent waiting behind maintenance stops its logical row without an AI request',async()=>{
  const h=await harness(),retain=h.store.retain.bind(h.store);let release!:()=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  h.store.retain=async()=>{entered();await gate;return {recordsRemoved:0,payloadsRemoved:0,bytesRemoved:0,more:false};};
  try{
    await h.engine.execute({type:'clean-expired-data'},{commandId:'maintenance-gate'});await waiting;
    const receipt=await h.engine.execute({type:'tag',payload:{scope:'selected'}},{commandId:'cancel-before-start'});h.engine.cancel('cancel-before-start');release();await h.engine.idle();
    assert.equal(await h.store.get('runs',receipt.runId!,{path:['status']}),'stopped');assert.equal((await h.store.reference('runInputs',receipt.runId!))!.metadata.category,'history');assert.equal(h.calls,0);
  }finally{release();h.store.retain=retain;await h.engine.close('disable');await h.store.close();}
});

test('an existing native label is searchable as a scientific match only after validated AI classification',async()=>{
  const h=await harness();try{
    h.native.push({tag:'RCL',type:0});await h.engine.ingestIndexed([{itemID:1,paperId:h.paper.id,version:'native-label'}]);
    const query={page:'library' as const,params:{conceptFilter:{mode:'all',selections:[{conceptId:'custom-rcl'}]}}};
    assert.equal((await buildView(h.store,query)).total,0);
    await h.engine.execute({type:'tag',payload:{scope:'selected',processingPolicy:'auto-clear'}},{commandId:'classify-existing-label'});await h.engine.idle();
    assert.equal((await buildView(h.store,query)).total,1);assert.deepEqual(h.native,[{tag:'RCL',type:0}]);assert.equal((await h.store.scan('history',{limit:1})).total,0);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('a topic extension keeps one logical run while waiting for an explicit inclusion choice',async()=>{
  const h=await harness(),complete=h.ai.completeJson.bind(h.ai);
  try{
    h.ai.completeJson=async(...args)=>{const response=await complete(...args);response.value.newTagCandidates=[{name:'membrane proton transport',reason:'A useful uncovered retrieval topic.',evidence:[{source:'abstract',text:h.paper.abstract}]}];return response;};
    await h.engine.execute({type:'tag',payload:{scope:'selected',processingPolicy:'auto-clear'}},{commandId:'topics'});await h.engine.idle();
    const source=String(await h.store.get('state','run',{path:['id']}));h.native.push({tag:'no_tag',type:0});
    const receipt=await h.engine.execute({type:'extend-assignment-topics',payload:{runId:source,paperIds:[h.paper.id],additionalTargetCount:5,processingPolicy:'auto-clear'}},{commandId:'extend-excluded'});await h.engine.idle();
    const view=await buildView(h.store,{page:'build',params:{runId:receipt.runId}});assert.ok(view.model!.paperExclusionPreview);assert.equal(view.model!.run!.status,'paused');assert.equal(view.model!.run!.canRetry,false);assert.equal((await h.store.scan('pendingRunIntents',{limit:1})).total,1);
    await h.engine.execute({type:'cancel-paper-exclusion'},{commandId:'cancel-inclusion'});assert.equal(await h.store.get('runs',receipt.runId!,{path:['status']}),'stopped');assert.equal((await h.store.scan('pendingRunIntents',{limit:1})).total,0);assert.ok(h.native.some(tag=>tag.tag==='no_tag'));
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('stopping an unknown paid request marks its run stopped rather than completed',async()=>{
  const h=await harness();try{
    h.ai.completeJson=async()=>{throw new Error('Lost after dispatch.');};
    const receipt=await h.engine.execute({type:'tag',payload:{scope:'selected',processingPolicy:'auto-clear'}},{commandId:'unknown-outcome'});await h.engine.idle();
    assert.equal(await h.store.get('runs',receipt.runId!,{path:['status']}),'paused');
    const unknown=(await h.store.scan('providerDispatches',{status:'unknown',limit:1})).rows[0];assert.ok(unknown);
    const reservation=await h.store.get('state','run',{path:['spentUSD']});
    await h.engine.execute({type:'stop-unknown-request',payload:{id:unknown.id}},{commandId:'stop-unknown'});await h.engine.idle();
    const run=(await buildView(h.store,{page:'activity'})).model!.runs![0];assert.equal(run.status,'stopped');assert.equal(run.completedPaperCount,0);assert.equal(run.canRetry,false);assert.equal(await h.store.get('state','run',{path:['spentUSD']}),reservation);assert.deepEqual(h.native,[]);
  }finally{await h.engine.close('disable');await h.store.close();}
});

test('pausing a queued intent preserves Resume and retry keeps assignment and build pointers separate',async()=>{
  const h=await harness(),retain=h.store.retain.bind(h.store);let release!:()=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  h.store.retain=async()=>{entered();await gate;return {recordsRemoved:0,payloadsRemoved:0,bytesRemoved:0,more:false};};
  try{
    await h.store.commitRecords(newRunOperations('previous-build',{type:'prepare-tags',payload:{scope:'selected'}},10));await h.store.put('state','latestBuildLogicalRunId','previous-build');
    await h.engine.execute({type:'clean-expired-data'},{commandId:'pause-gate'});await waiting;
    const receipt=await h.engine.execute({type:'tag',payload:{scope:'selected',processingPolicy:'auto-clear'}},{commandId:'queued-to-pause'});
    await h.engine.execute({type:'pause-run',payload:{id:receipt.runId}},{commandId:'pause-queued'});release();await h.engine.idle();
    assert.equal(await h.store.get('runs',receipt.runId!,{path:['status']}),'paused');assert.equal(await h.store.get('runs',receipt.runId!,{path:['canRetry']}),true);assert.equal(h.calls,0);
    await h.engine.execute({type:'retry-run',payload:{id:receipt.runId}},{commandId:'resume-queued'});await h.engine.idle();assert.equal(h.calls,1);assert.equal(await h.store.get('state','latestBuildLogicalRunId'),'previous-build');assert.equal(await h.store.get('state','latestAssignmentLogicalRunId'),receipt.runId);
  }finally{release();h.store.retain=retain;await h.engine.close('disable');await h.store.close();}
});

test('Runs can retry a cold paused source without resending an unknown request, and stopped consent allows a fresh run',async()=>{
  const h=await harness(),complete=h.ai.completeJson.bind(h.ai);let engine=h.engine,dispatches=0;
  h.ai.completeJson=async()=>{dispatches++;throw new Error('Interrupted after dispatch.');};
  try{
    const receipt=await engine.execute({type:'tag',payload:{scope:'selected',processingPolicy:'auto-clear'}},{commandId:'pause-before-close'});await engine.idle();await engine.close('disable');
    engine=new WorkspaceEngine({store:h.store,host:h.host,ai:h.ai,yieldControl:async()=>{}});await engine.open();assert.equal(engine.context.state.run,null);
    const retry=await engine.execute({type:'retry-run',payload:{id:receipt.runId}},{commandId:'cold-retry'});await engine.idle();assert.equal(retry.runId,receipt.runId);assert.equal(await h.store.get('runs',receipt.runId!,{path:['status']}),'paused');assert.equal(dispatches,1);
    const unknown=(await h.store.scan('providerDispatches',{status:'unknown',limit:1})).rows[0];await engine.execute({type:'stop-unknown-request',payload:{id:unknown.id}},{commandId:'stop-cold-request'});
    const authorized=await engine.execute({type:'retry-unknown-request',payload:{id:unknown.id}},{commandId:'allow-new-attempt'});await engine.idle();assert.equal((authorized.result as {startNewRun:boolean}).startNewRun,true);assert.equal(await h.store.get('runs',receipt.runId!,{path:['status']}),'stopped');assert.equal(dispatches,1);assert.ok((await h.store.links('providerDispatches',unknown.id,{limit:50})).rows.some(ref=>ref.collection==='providerScopes'));
    h.ai.completeJson=complete;
    await engine.execute({type:'tag',payload:{scope:'selected',processingPolicy:'auto-clear'}},{commandId:'fresh-authorized-run'});await engine.idle();assert.ok(h.native.some(tag=>tag.tag==='RCL'));assert.equal(h.calls,1);
  }finally{await engine.close('disable');await h.store.close();}
});
