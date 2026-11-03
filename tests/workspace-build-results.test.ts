import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import type {TagDefinition} from '../src/core.ts';
import type {DisplayBuildResult} from '../src/ui-contract.ts';
import {projectBuildResult,seedBuildResult} from '../src/workspace/build-results.ts';
import {WorkspaceStore,RETENTION_MS} from '../src/workspace/storage.ts';
import {memorySql} from './workspace-storage-adapter.ts';

const tag=(id:string):TagDefinition=>({id,name:id,description:'A scientific retrieval concept.',facet:'phenomenon',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],custom:false,status:'approved'});
const result=(runId='build-1',extra:Partial<DisplayBuildResult>={}):DisplayBuildResult=>({runId,status:'completed',paperCount:3,completedPaperCount:3,savedCount:2,questionCount:0,reason:'saved',...extra});
function controller(state:AppState){
  const unexpected=async():Promise<never>=>{throw new Error('Build result projection must not request AI or touch native papers.');};
  const env:ControllerEnvironment={persist:async()=>{},host:{list:unexpected,read:unexpected,readTags:unexpected,pdfText:unexpected,apply:unexpected,show:unexpected,saveSearch:unexpected},ai:{hasApiKey:unexpected,getSession:unexpected,completeJson:unexpected,testConnection:unexpected,listModels:unexpected,setApiKey:unexpected,removeApiKey:unexpected,signIn:unexpected,cancelSignIn(){},signOut:unexpected,selectAccount:unexpected}};
  return new AppController(state,env);
}
function buildState(){
  const state=initialState();state.tags=[tag('existing'),tag('saved-one'),tag('saved-two')];state.taxonomyReady=true;
  state.run={id:'current-run',kind:'rebuild',scope:'selected',automatic:false,status:'idle',processingPolicy:'auto-clear',jobs:['p1','p2','p3'].map(paperId=>({id:'job-'+paperId,paperId,status:'completed'})),vocabCursor:3,vocabFinished:true,message:'Build finished.',spentUSD:0,settings:state.settings,vocabularyVersion:0};
  state.taxonomyProposal={id:'current-proposal',createdAt:'2026-11-03',inputFingerprint:'input',baseVersion:0,coreLimit:60,tags:[...state.tags,tag('not-yet-saved')],support:{},merges:[],excluded:[],issues:[],paperIds:['p1','p2','p3']};
  state.tagPreparation={id:'current-preparation',proposalId:'current-proposal',snapshotId:'snapshot',policyVersion:2,status:'ready',judgements:{},questions:[],answers:{},diagnostics:[],excluded:[],processingPolicy:'auto-clear',shelfId:'generated-current',admissions:{'saved-one':{changeId:'admission-1',definitionFingerprint:'one'},'saved-two':{changeId:'admission-2',definitionFingerprint:'two'}}};
  return state;
}

test('build outcome identifies only saved admissions and distinguishes completed choices from unfinished processing',()=>{
  const state=buildState(),app=controller(state),view=app.workerViews();
  assert.deepEqual(view.buildResultTagIds,['saved-one','saved-two']);assert.equal(view.buildResult?.status,'completed');assert.equal(view.buildResult?.savedCount,2);assert.equal(view.buildResult?.shelfId,'generated-current');assert.equal(view.buildResult?.paperCount,3);
  state.tagPreparation!.questions.push({id:'choice',title:'Choose a meaning',description:'A remaining scientific question.',paperIds:['p1'],sourceIds:[],choices:[],kind:'meaning',contextFingerprint:'choice'});state.tagPreparation!.status='questions';
  assert.equal(app.workerViews().buildResult?.status,'completed');assert.equal(app.workerViews().buildResult?.questionCount,1);
  state.run!.status='paused';assert.equal(app.workerViews().buildResult?.status,'paused');assert.equal(app.workerViews().buildResult?.savedCount,2);
});

test('build outcomes preserve explicit zero-new reasons and never include an earlier preparation in a new run',()=>{
  const state=buildState(),app=controller(state);delete state.tagPreparation;state.taxonomyProposal=null;
  state.run!.buildOutcome={reason:'reused'};assert.equal(app.workerViews().buildResult?.reason,'reused');assert.equal(app.workerViews().buildResult?.status,'completed');assert.equal(app.workerViews().buildResult?.savedCount,0);
  state.run!.buildOutcome={reason:'needs-information'};assert.equal(app.workerViews().buildResult?.status,'needs-information');
  state.run!.buildOutcome={reason:'no-eligible-papers'};assert.equal(app.workerViews().buildResult?.reason,'no-eligible-papers');assert.equal(app.workerViews().buildResult?.status,'needs-information');
  state.run!.kind='tag';assert.equal(app.workerViews().buildResult,undefined);assert.deepEqual(app.workerViews().buildResultTagIds,[]);
});

test('build outcome excludes removed or undone admissions and captures a manually saved replacement',()=>{
  const state=buildState(),app=controller(state);state.tags=state.tags.filter(tag=>tag.id!=='saved-one');
  assert.equal(app.workerViews().buildResult?.savedCount,1);assert.deepEqual(app.workerViews().buildResultTagIds,['saved-two']);
  state.tags=state.tags.filter(tag=>tag.id!=='saved-two');assert.equal(app.workerViews().buildResult?.savedCount,0);assert.equal(app.workerViews().buildResult?.reason,'saved');state.tags.push(tag('saved-two'));
  delete state.tagPreparation;state.taxonomyProposal=null;state.run!.buildOutcome={reason:'saved',savedTagIds:['saved-two'],shelfId:'replacement-shelf'};
  assert.equal(app.workerViews().buildResult?.shelfId,'replacement-shelf');assert.deepEqual(app.workerViews().buildResult?.tagNames,['saved-two']);
});

test('saved build membership is exact per run, bounded by query pages and survives a storage reopen',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);for(const id of ['existing','first','second','third'])await store.put('tags',id,tag(id),{title:id});
  await projectBuildResult(store,result(),['first','second']);await projectBuildResult(store,result('build-2',{savedCount:1}),['third']);
  assert.equal(await store.get('state','latestBuildRunId'),'build-2');assert.equal((await store.scan('buildResultTags',{taskId:'build-1',limit:1})).total,2);assert.equal((await store.scan('buildResultTags',{taskId:'build-2',limit:1})).total,1);
  const first=await store.scan('buildResultTags',{taskId:'build-1',limit:50}),ids=[];for(const row of first.rows)ids.push((await store.codec.read(row.token) as {tagId:string}).tagId);assert.deepEqual(ids.sort(),['first','second']);
  const reopened=await WorkspaceStore.open(sql.port);assert.equal((await reopened.get('buildResults','build-1') as DisplayBuildResult).savedCount,2);assert.equal((await reopened.scan('buildResultTags',{taskId:'build-1',limit:1})).rows.length,1);await reopened.close();
});

test('build projection removes stale membership, retains the original completion date and expires after seven days',async()=>{
  let now=10*RETENTION_MS;const sql=memorySql(),store=await WorkspaceStore.open(sql.port,{clock:()=>now});for(const id of ['first','second'])await store.put('tags',id,tag(id),{title:id});
  await projectBuildResult(store,result(),['first','second'],()=>now);const completed=(await store.reference('buildResults','build-1'))!.metadata.completedAt;
  now+=RETENTION_MS/2;await store.delete('tags','first');await projectBuildResult(store,result(),['first','second'],()=>now);
  assert.equal((await store.reference('buildResults','build-1'))!.metadata.completedAt,completed);assert.equal((await store.scan('buildResultTags',{taskId:'build-1',limit:50})).total,1);assert.equal((await store.get('buildResults','build-1') as DisplayBuildResult).savedCount,1);assert.equal(await store.reference('tags','first'),undefined);
  now=completed!+RETENTION_MS+1;for(let pass=0;pass<20;pass++){if(!(await store.retain()).more)break;}
  assert.equal(await store.reference('buildResults','build-1'),undefined);assert.equal((await store.scan('buildResultTags',{taskId:'build-1',limit:50})).total,0);assert.ok(await store.reference('tags','second'));await store.close();
});

test('build projection commits the result, exact membership and latest pointer atomically',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);await store.put('tags','saved',tag('saved'),{title:'Saved'});
  sql.fail((statement,parameters)=>statement.startsWith('INSERT INTO workspace_records')&&parameters[0]==='buildResults');await assert.rejects(projectBuildResult(store,result(),['saved']),/Synthetic SQL failure/);sql.fail();
  assert.equal(await store.reference('buildResults','build-1'),undefined);assert.equal((await store.scan('buildResultTags',{taskId:'build-1',limit:50})).total,0);assert.equal(await store.get('state','latestBuildRunId'),undefined);await store.close();
});

test('upgrade seeding reads only bounded build fields and preserves current saved membership',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),state=buildState();
  await store.put('state','run',{...state.run,jobs:undefined,selection:{id:'current-proposal',paidReply:'large paid run archive '.repeat(150_000)}},{category:'history',completedAt:1234});
  await store.put('state','tagPreparation',{...state.tagPreparation,judgements:{large:'Large proof map '.repeat(150_000)}});
  await store.put('state','taxonomyProposal',state.taxonomyProposal);for(const saved of state.tags)await store.put('tags',saved.id,saved,{title:saved.name});
  for(const job of state.run!.jobs)await store.put('runJobs',job.id,job,{taskId:state.run!.id,status:job.status});
  const runRoot=(await store.reference('state','run'))!.token,prepRoot=(await store.reference('state','tagPreparation'))!.token,original=store.codec.read.bind(store.codec);
  store.codec.read=async(token,options)=>{assert.notDeepEqual(token,runRoot,'Run archives must not be decoded for a result summary.');assert.notDeepEqual(token,prepRoot,'Proof archives must not be decoded for a result summary.');return original(token,options);};
  await seedBuildResult(store,()=>9000);const build=await store.get('buildResults','current-run') as DisplayBuildResult;
  assert.equal(build.status,'completed');assert.equal(build.savedCount,2);assert.equal(build.paperCount,3);assert.equal(build.completedPaperCount,3);assert.equal((await store.scan('buildResultTags',{taskId:'current-run',limit:50})).total,2);assert.equal((await store.reference('buildResults','current-run'))!.metadata.completedAt,1234);
  await store.put('state','run',{id:'new-unrelated-run',kind:'rebuild',vocabFinished:true});await seedBuildResult(store);assert.equal(await store.get('state','latestBuildRunId'),'current-run');await store.close();
});

test('upgrade seeding distinguishes explicit zero-new reuse from an unavailable older result',async()=>{
  for(const captured of [true,false]){
    const sql=memorySql(),store=await WorkspaceStore.open(sql.port);await store.put('state','run',{id:'legacy-build',kind:'rebuild',status:'idle',vocabFinished:true,message:'Old processing ended.',...(captured?{buildOutcome:{reason:'reused'}}:{})});
    await seedBuildResult(store);const build=await store.get('buildResults','legacy-build') as DisplayBuildResult;
    assert.equal(build.status,captured?'completed':'unknown');assert.equal(build.reason,captured?'reused':undefined);assert.equal(build.savedCount,0);if(!captured)assert.match(build.message!,/no detailed completion record/);await store.close();
  }
});
