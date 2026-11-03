import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {initialState,migrateState,validState} from '../src/controller.ts';
import type {AppState} from '../src/controller.ts';
import type {TagDefinition} from '../src/core.ts';
import {canonicalTagKey,fingerprint,paperFingerprint} from '../src/core.ts';
import {normalizeFacts} from '../src/taxonomy.ts';
import {WorkspaceStore} from '../src/workspace/storage.ts';
import {memorySql} from './workspace-storage-adapter.ts';
import {importIntoStore,readLocator} from '../src/workspace/migration.ts';
import {StorageMigrationTarget,cleanupMigrationBackups,markVerifiedWorkspaceRestart} from '../src/workspace/migration-target.ts';
import type {MigrationIO} from '../src/workspace/migration-contract.ts';
import {fingerprintGraph} from '../src/workspace/migration-graph.ts';
import {createNativeTagDefinitionWork} from '../src/native-tag-definition.ts';
import {createRegistrySnapshot} from '../src/evidence.ts';
import {createTagSelection,validTagSelectionWork} from '../src/tag-selection.ts';

const DATE=1_794_033_600_000,DAY=24*60*60*1000;
const tag=(id='tag-fc'):TagDefinition=>({id,name:'FC',fullName:'fuel cell',description:'Electrochemical devices converting fuel into electricity.',facet:'system',aliases:['fuel cells'],broaderIds:[],relatedIds:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',matchingMode:'auto'});
function state(){
  const value=initialState();value.tags=[tag()];
  const paper={id:'1:PAPER',itemID:1,libraryID:1,key:'PAPER',title:'Fuel-cell transport',abstract:'A fuel cell was characterized experimentally.',keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
  value.papers[paper.id]=paper;value.nativeTags[paper.id]=[{tag:'FC',type:0},{tag:'Project',type:0}];return value;
}
function files(value:unknown){
  const original=new TextEncoder().encode(JSON.stringify(value)),data=new Map<string,Uint8Array>([['state.json',original]]);
  const io:MigrationIO={async exists(path){return data.has(path);},async stat(path){return {size:data.get(path)!.length};},async read(path,{offset,maxBytes}){return data.get(path)!.slice(offset,offset+maxBytes);},async copyExact(source,destination){assert.equal(data.has(destination),false);data.set(destination,data.get(source)!.slice());},async writeAtomic(path,value){data.set(path,value.slice());},async remove(path){data.delete(path);}};
  return {io,data,original};
}
async function migrate(value:unknown,options:{baseline?:TagDefinition[];clock?:()=>number}={}){
  const mem=files(value),sql=memorySql(),store=await WorkspaceStore.open(sql.port,{crypto:webcrypto as Crypto,clock:options.clock??(()=>DATE),yield:async()=>{}}),target=new StorageMigrationTarget(store,{clock:options.clock??(()=>DATE),legacyBaseline:options.baseline});
  const result=await importIntoStore(mem.io,'state.json',target,{crypto:webcrypto as Crypto,clock:options.clock??(()=>DATE),generation:()=> 'target-generation'});
  return {mem,sql,store,target,result};
}

test('the concrete target publishes indexed records and drops duplicate state containers',async()=>{
  const source=state(),h=await migrate(source);
  assert.equal((await readLocator(h.mem.io,'state.json'))!.schemaVersion,14);assert.deepEqual(h.mem.data.get('state.json.pre-v14.json'),h.mem.original);
  assert.deepEqual(await h.store.get('tags','tag-fc'),source.tags[0]);assert.deepEqual(await h.store.get('papers','1:PAPER'),source.papers['1:PAPER']);
  assert.equal((await h.store.reference('papers','1:PAPER'))!.metadata.nativeItemId,1);assert.equal((await h.store.scan('papers',{nativeItemId:1})).rows[0].id,'1:PAPER');assert.equal((await h.store.scan('papers',{nativeItemId:99})).total,0);
  for(const key of ['tags','papers','nativeTags','facts','history','metadata'])assert.equal(await h.store.reference('state',key),undefined,key+' container must not pin all historic records');
  assert.deepEqual(await h.store.get('metadata','storage.processingHistoryPolicy'),'compact-v1');
  assert.equal((await h.store.scan('papers',{references:[[{collection:'tags',id:'tag-fc',relation:'matches'}]]})).total,1);
  assert.equal((await h.store.scan('papers',{search:'characterized'})).total,1);assert.equal((await h.store.scan('libraryTags',{search:'fuel cells'})).total,1);
  const names=await h.store.scan('nativeNames');assert.equal(names.total,2);assert.equal((await h.store.get('nativeNames',canonicalTagKey('FC')) as {paperCount:number}).paperCount,1);
  assert.equal((await h.store.scan('nativeNamePapers',{taskId:canonicalTagKey('FC')})).total,1);assert.equal((await h.store.scan('migrationBackups')).total,1);
  assert.equal(await h.store.get('nativeNames',canonicalTagKey('Project'),{path:['manualCount']}),1);assert.equal((await h.store.reference('libraryTags','native:'+canonicalTagKey('Project')))!.metadata.type,'manual-native');assert.equal(await h.store.get('workspace','nativeTagIndexPolicy',{path:['phase']}),'complete');
  assert.equal((await h.store.get('workspace','active') as {generation:string}).generation,'target-generation');await h.store.close();
});

test('unverified native bindings cannot become a grounded match during migration',async()=>{
  const source=state();source.nativeBindingExclusions={'tag-fc':{'1:PAPER':['FC']}};const h=await migrate(source);
  assert.equal((await h.store.scan('papers',{references:[[{collection:'tags',id:'tag-fc',relation:'matches'}]]})).total,0);
  assert.deepEqual(await h.store.get('nativeTags','1:PAPER'),source.nativeTags['1:PAPER']);await h.store.close();
});

test('array ordering and schema-three draft protection agree with the legacy migration',async()=>{
  const source={...state(),schemaVersion:3};source.tags=[{...tag('tag-unused'),name:'old draft',fullName:'old draft',status:'draft' as const},tag('tag-kept')];source.nativeTags['1:PAPER']=[];
  const before=structuredClone(source),expected=migrateState(source,{legacyBaseline:source.tags});
  const h=await migrate(source,{baseline:source.tags});const tags=await h.store.scan('tags',{orderBy:'order'});
  assert.deepEqual(await Promise.all(tags.rows.map(row=>h.store.codec.read(row.token))),expected.tags);assert.deepEqual(source,before);
  assert.deepEqual(await Promise.all((await h.store.scan('tagShelves',{orderBy:'order'})).rows.map(row=>h.store.codec.read(row.token))),expected.tagShelves);await h.store.close();
});

for(const version of [1,2,4,5,6,7,8,9,10,11,12,13])test('schema '+version+' retains IDs, settings, definitions and native labels',async()=>{
  const source={...state(),schemaVersion:version},expected=migrateState(source),h=await migrate(source);
  assert.deepEqual(await h.store.get('tags','tag-fc'),expected.tags[0]);assert.deepEqual(await h.store.get('papers','1:PAPER'),expected.papers['1:PAPER']);
  assert.deepEqual(await h.store.get('nativeTags','1:PAPER'),expected.nativeTags['1:PAPER']);assert.deepEqual(await h.store.get('state','settings'),expected.settings);
  assert.deepEqual(h.mem.data.get('state.json.pre-v14.json'),h.mem.original);await h.store.close();
});

test('legacy fact identity allocation and catalog normalization preserve current evidence',async()=>{
  const source={...state(),schemaVersion:2};const paper=source.papers['1:PAPER'];source.facts[paper.id]=normalizeFacts({summary:'A retained finding.',needsPDF:false,concepts:[{name:'FC',facet:'system',evidence:[{source:'abstract',text:paper.abstract}]}]},paper,'original-provider','original-model');
  delete source.facts[paper.id].concepts[0].factConceptId;const h=await migrate(source);
  const facts=await h.store.get('facts',paper.id) as AppState['facts'][string];assert.ok(facts.concepts[0].factConceptId);assert.equal(facts.provider,'original-provider');
  const stored=await h.store.get('evidenceSources',facts.concepts[0].factConceptId!) as {metadataFingerprint:string};assert.equal(stored.metadataFingerprint,paper.fingerprint);
  assert.equal((await h.store.get('state','evidenceCatalog') as {sources?:unknown}).sources,undefined);await h.store.close();
});

test('older unfinished policies and obsolete maintenance tasks follow the established migration',async()=>{
  const source={...state(),schemaVersion:8};source.run={id:'old-run',kind:'rebuild',scope:'selected',automatic:false,status:'paused',jobs:[],vocabCursor:0,vocabFinished:false,spentUSD:0.25,settings:{...source.settings},vocabularyVersion:0};
  source.maintenanceTasks=[{id:'old-cleanup',kind:'reconcile',status:'paused',run:structuredClone(source.run),cursor:0,createdAt:'2026-10-29T00:00:00.000Z',groupIds:[],paperIds:[]}];const expected=migrateState(source),h=await migrate(source);
  const projected=structuredClone(expected.maintenanceTasks![0]);delete (projected.run as Partial<typeof projected.run>).jobs;assert.deepEqual(await h.store.get('maintenanceTasks','old-cleanup'),projected);assert.equal((await h.store.get('state','run') as {processingPolicy?:string}).processingPolicy,undefined);await h.store.close();
});

test('backup expiry requires seven days, two distinct verified starts and no recovery',async()=>{
  let now=DATE;const h=await migrate(state(),{clock:()=>now});const settings={crypto:webcrypto as Crypto,clock:()=>now,recoveryOutstanding:async()=>false};
  await markVerifiedWorkspaceRestart(h.store,'target-generation','first-start');await markVerifiedWorkspaceRestart(h.store,'target-generation','first-start');now+=8*DAY;
  assert.deepEqual(await cleanupMigrationBackups(h.store,h.mem.io,settings),{removed:0,preserved:1});
  await markVerifiedWorkspaceRestart(h.store,'target-generation','second-start');assert.deepEqual(await cleanupMigrationBackups(h.store,h.mem.io,{...settings,recoveryOutstanding:async()=>true}),{removed:0,preserved:0});
  assert.equal(await h.store.get('state','backupBytes'),h.mem.original.length);assert.equal(h.mem.data.has('state.json.pre-v14.json'),true);assert.deepEqual(await cleanupMigrationBackups(h.store,h.mem.io,settings),{removed:1,preserved:0});assert.equal(h.mem.data.has('state.json.pre-v14.json'),false);assert.equal((await h.store.scan('migrationBackups')).total,0);assert.equal(await h.store.get('state','backupBytes'),0);await h.store.close();
});

test('a user-modified registered backup is preserved after the retention period',async()=>{
  let now=DATE;const h=await migrate(state(),{clock:()=>now});await markVerifiedWorkspaceRestart(h.store,'target-generation','a');await markVerifiedWorkspaceRestart(h.store,'target-generation','b');now+=8*DAY;
  h.mem.data.set('state.json.pre-v14.json',new TextEncoder().encode('User preserved replacement'));
  assert.deepEqual(await cleanupMigrationBackups(h.store,h.mem.io,{clock:()=>now,crypto:webcrypto as Crypto,recoveryOutstanding:async()=>false}),{removed:0,preserved:1});assert.equal(h.mem.data.has('state.json.pre-v14.json'),true);await h.store.close();
});

test('process-based backup verification discards unverifiable older worker-open counts',async()=>{
  const h=await migrate(state()),backup=await h.store.get('migrationBackups','target-generation') as Record<string,unknown>;
  await h.store.put('migrationBackups','target-generation',{...backup,verifiedRestarts:2,lastStartupId:'older-random-worker-id'},{category:'ledger',pinned:true});
  for(const [session,expected] of [['native-process-a',0],['native-process-a',0],['native-process-b',1],['native-process-b',1],['native-process-c',2]] as const){await markVerifiedWorkspaceRestart(h.store,'target-generation',session,{requireBaseline:true});assert.equal(await h.store.get('migrationBackups','target-generation',{path:['verifiedRestarts']}),expected);}
  await h.store.close();
});

test('an active database refuses a stale legacy entry point',async()=>{
  const h=await migrate(state());h.mem.data.set('state.json',h.mem.original.slice());
  await assert.rejects(importIntoStore(h.mem.io,'state.json',new StorageMigrationTarget(h.store),{crypto:webcrypto as Crypto}),/active workspace already exists/);assert.deepEqual(h.mem.data.get('state.json'),h.mem.original);await h.store.close();
});

test('the streamed scientific fingerprint exactly preserves keys, Unicode and large strings',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port,{crypto:webcrypto as Crypto,yield:async()=>{}});
  const value={z:'Exact paid response: '+('🔬 \" \\ \n \ud800 '.repeat(20000)),A:[null,true,12.5,'\udfff'],a:{'20':'second','2':'first','':false,'🔬':'研究'}};
  assert.equal(await fingerprintGraph(store.codec,await store.codec.encode(value)),fingerprint(value));await store.close();
});

test('a large native snapshot validates one meaning source projection and preserves raw paid replies',async()=>{
  const source=state(),paper=source.papers['1:PAPER'];
  const work=createNativeTagDefinitionWork({papers:[paper],nativeTags:{[paper.id]:source.nativeTags[paper.id]},definitions:source.tags,facts:{},decisions:{},vocabularyVersion:0,applied:false},['FC']);
  // Unrelated source payloads make the immutable snapshot large without enlarging
  // the one meaning's scientific validation projection.
  for(let index=0;index<180;index++){const id='unrelated:'+index;work.snapshot.papers.push({...paper,id,itemID:index+10,abstract:'Unrelated retained source context. '.repeat(450)});work.snapshot.nativeTags[id]=[];}
  work.fingerprint=fingerprint(work.snapshot);work.tasks.push({id:'paid-large',kind:'draft',entryIds:[work.entries[0].id],pairs:[],status:'completed',dispatches:1,invalidResponses:0,generation:0,attempts:[{raw:'Exact unmodified paid bytes\r\n'+('retained reply '.repeat(180000)),provider:'provider-original',model:'model-original'}]});
  source.nativeDefinitionPreparation={work,taskId:'meaning-task',shelfId:'tag-shelf-my-tags',appliedEntryIds:[]};
  assert.equal(validState(source),true);const h=await migrate(source);
  const entry=await h.store.get('nativeMeaningEntries',work.entries[0].id);assert.deepEqual(entry,work.entries[0]);
  const task=await h.store.get('nativeMeaningTasks','paid-large',{path:['attempts',0,'raw'],maxBytes:4*1024*1024});assert.equal(task,work.tasks[0].attempts[0].raw);
  assert.equal((await h.store.get('state','nativeDefinitionPreparation',{path:['work','history']})),undefined);await h.store.close();
});

test('a corrupt large native snapshot is never activated',async()=>{
  const source=state(),paper=source.papers['1:PAPER'];const work=createNativeTagDefinitionWork({papers:[paper],nativeTags:{[paper.id]:source.nativeTags[paper.id]},definitions:source.tags,facts:{},decisions:{},vocabularyVersion:0,applied:false},['FC']);
  work.snapshot.papers[0]={...paper,pdfText:'Wrong retained source. '.repeat(130000)};
  source.nativeDefinitionPreparation={work,taskId:'meaning-task',shelfId:'tag-shelf-my-tags',appliedEntryIds:[]};
  const mem=files(source),sql=memorySql(),store=await WorkspaceStore.open(sql.port,{crypto:webcrypto as Crypto,yield:async()=>{}});
  await assert.rejects(importIntoStore(mem.io,'state.json',new StorageMigrationTarget(store),{crypto:webcrypto as Crypto}),/could not be validated/);assert.deepEqual(mem.data.get('state.json'),mem.original);assert.equal(await store.reference('workspace','active'),undefined);await store.close();
});

test('a published prepared generation finishes activation after restart without importing again',async()=>{
  const mem=files(state()),sql=memorySql(),store=await WorkspaceStore.open(sql.port,{crypto:webcrypto as Crypto,yield:async()=>{}}),target=new StorageMigrationTarget(store,{clock:()=>DATE});
  target.activate=async()=>{throw new Error('Synthetic crash after publication');};
  await assert.rejects(importIntoStore(mem.io,'state.json',target,{crypto:webcrypto as Crypto,generation:()=> 'prepared-generation'}),/crash after publication/);
  const locator=(await readLocator(mem.io,'state.json'))!,reopened=new StorageMigrationTarget(store,{clock:()=>DATE});
  assert.equal(await reopened.resumePrepared(locator),true);assert.equal(await reopened.resumePrepared(locator),false);assert.equal((await store.get('workspace','active') as {generation:string}).generation,locator.storage.generation);
  assert.equal((await store.scan('tags')).total,1);assert.equal((await store.scan('migrationBackups')).total,1);assert.deepEqual(mem.data.get('state.json.pre-v14.json'),mem.original);await store.close();
});

test('a prepublication failure leaves original authority and a retry replaces its staged generation',async()=>{
  const original=state(),mem=files(original),sql=memorySql(),store=await WorkspaceStore.open(sql.port,{crypto:webcrypto as Crypto,yield:async()=>{}}),target=new StorageMigrationTarget(store);
  const save=mem.io.writeAtomic;mem.io.writeAtomic=async()=>{throw new Error('Synthetic locator failure');};
  await assert.rejects(importIntoStore(mem.io,'state.json',target,{crypto:webcrypto as Crypto,generation:()=> 'abandoned-generation'}),/locator failure/);assert.deepEqual(mem.data.get('state.json'),mem.original);assert.equal(await store.reference('workspace','active'),undefined);
  original.tags=[{...tag('replacement'),name:'Replacement'}];original.nativeTags['1:PAPER']=[];mem.data.set('state.json',new TextEncoder().encode(JSON.stringify(original)));mem.io.writeAtomic=save;
  await importIntoStore(mem.io,'state.json',new StorageMigrationTarget(store),{crypto:webcrypto as Crypto,generation:()=> 'replacement-generation'});
  assert.equal(await store.reference('tags','tag-fc'),undefined);assert.ok(await store.reference('tags','replacement'));assert.equal(await store.reference('workspace','importing'),undefined);assert.equal((await store.scan('nativeNames')).total,0);await store.close();
});

for(const version of [1,2])test('schema '+version+' streams an archive larger than a whole-state projection',async()=>{
  const source={...state(),schemaVersion:version,unknownRetainedArchive:{raw:'Preserved paid scope\r\n'+('unmodified opaque context '.repeat(135000))}};
  const h=await migrate(source);assert.equal(await h.store.get('state','unknownRetainedArchive',{path:['raw'],maxBytes:4*1024*1024}),source.unknownRetainedArchive.raw);assert.equal((await h.store.scan('tags')).total,1);await h.store.close();
});

test('open work pins compatible cached results, while unused facts and replies expire after seven days',async()=>{
  let now=DATE;const source=state(),paper=source.papers['1:PAPER'];source.facts[paper.id]=normalizeFacts({summary:'Retained evidence.',needsPDF:false,concepts:[{name:'FC',evidence:[{source:'abstract',text:paper.abstract}]}]},paper,'provider','model');
  source.analyses[paper.id]={raw:'Retained paid reply',inputFingerprint:'scope-original'} as unknown as AppState['analyses'][string];source.analyses.unused={raw:'Unused paid reply'} as unknown as AppState['analyses'][string];
  source.run={id:'work-pins-cache',kind:'tag',scope:'selected',automatic:false,status:'paused',jobs:[{id:'job-pins-cache',paperId:paper.id,status:'pending'}],vocabCursor:0,vocabFinished:false,spentUSD:0.1,settings:{...source.settings},vocabularyVersion:0};
  const h=await migrate(source,{clock:()=>now});now+=8*DAY;await h.store.retain(now,100);
  assert.ok(await h.store.reference('facts',paper.id));assert.ok(await h.store.reference('analyses',paper.id));assert.equal(await h.store.reference('analyses','unused'),undefined);assert.equal((await h.store.scan('runJobs',{taskId:source.run.id})).total,1);
  assert.equal(await h.store.get('state','run',{path:['jobs']}),undefined);await h.store.close();
});

test('large archived scopes, selection replies and opaque diagnostics migrate through bounded validators',async()=>{
  const source=state(),paper=source.papers['1:PAPER'],fact=normalizeFacts({summary:'Retained scientific context.',needsPDF:false,concepts:[{name:'fuel cell',evidence:[{source:'abstract',text:paper.abstract}]}]},paper,'provider','model'),snapshot=createRegistrySnapshot([fact],{sources:{},entries:{}});
  const work=createTagSelection([fact],source.tags,snapshot,{targetCount:60,maxOutputTokens:8192}),registry=Object.values(work.snapshot.entries)[0],original=Object.values(work.snapshot.sources)[0];
  for(let index=0;index<800;index++){const id='retained-source-'+index;work.snapshot.sources[id]={...original,factConceptId:id,summary:'Scientific retained source summary. '.repeat(110)};registry.sourceIds.push(id);work.sourceRegistryIds[id]=registry.registryId;work.sourceLedger[id]={status:'unexamined',tagIds:[]};}
  work.census.sourceCount=Object.keys(work.snapshot.sources).length;const raw='Exact historical paid reply\r\n'+('unmodified raw bytes '.repeat(140000));work.tasks[0].attempts=[{raw,provider:'original-provider'}];
  assert.equal(validTagSelectionWork(work),true);source.tagSelectionHistory=[{runId:'preserved-run',work}];source.taxonomyArchives=[{id:'large-archive',date:new Date(DATE).toISOString(),version:0,tags:source.tags,redirects:{},reason:'Retained history',evidenceScopes:[{support:{},evidenceSnapshot:work.snapshot}]}];
  source.preparationHistory=[{id:'large-preparation',date:new Date(DATE).toISOString(),proposal:{id:'proposal',tags:source.tags,merges:[],rawResponse:raw} as unknown as NonNullable<AppState['preparationHistory']>[number]['proposal'],spentUSD:0.12}];
  source.legacyConsolidationHistory=[{runId:'legacy-checkpoint',checkpoint:{raw} as unknown as NonNullable<AppState['legacyConsolidationHistory']>[number]['checkpoint']}];
  source.analysisResetHistory=[{id:'diagnostics',date:new Date(DATE).toISOString(),factsCount:0,analysesCount:0,analyses:{},discardedSuggestions:[],unfinishedReviews:[],raw} as unknown as NonNullable<AppState['analysisResetHistory']>[number]];
  source.run={id:'large-paused-run',kind:'rebuild',scope:'library',automatic:false,status:'paused',jobs:[],vocabCursor:0,vocabFinished:false,spentUSD:0.12,settings:{...source.settings},vocabularyVersion:0,selection:work};
  assert.equal(validState(source),true);const h=await migrate(source);
  assert.equal(await h.store.get('tagSelectionHistory','index:000000000000',{path:['work','tasks',0,'attempts',0,'raw'],maxBytes:4*1024*1024}),raw);
  assert.equal(await h.store.get('state','run',{path:['selection','tasks',0,'attempts',0,'raw'],maxBytes:4*1024*1024}),raw);
  assert.equal((await h.store.scan('taxonomyArchives')).total,1);assert.equal((await h.store.scan('preparationHistory')).total,1);assert.equal((await h.store.scan('analysisResetHistory')).total,1);await h.store.close();
});

for(const version of [11,12])test('schema '+version+' preserves captured review policy and deferred choice identities correctly',async()=>{
  const source={...state(),schemaVersion:version},paper=source.papers['1:PAPER'],work=createNativeTagDefinitionWork({papers:[paper],nativeTags:source.nativeTags,definitions:source.tags,facts:{},decisions:{},vocabularyVersion:0,applied:false},['FC']);
  source.nativeDefinitionPreparation={work,taskId:'originating-meaning-task',shelfId:'tag-shelf-my-tags',appliedEntryIds:[],processingPolicy:'auto-clear'};
  source.tagPreparation={id:'captured-preparation',proposalId:'captured-proposal',snapshotId:'captured-snapshot',policyVersion:3,status:'questions',judgements:{},questions:[],answers:{},diagnostics:[],excluded:[],processingPolicy:'auto-clear'};
  if(version>=12){source.reviewItems=[{id:'retained-deferred-choice',conditionFingerprint:'source-and-meaning-exact',taskId:work.id,label:'FC',kind:'definition',state:'deferred',ownerPage:'vocabulary',questionId:work.entries[0].id,workId:work.id}];source.automaticSuppressions=['retained-undo-suppression'];}
  const h=await migrate(source);assert.equal(await h.store.get('state','nativeDefinitionPreparation',{path:['processingPolicy']}),version>=12?'auto-clear':undefined);assert.equal(await h.store.get('state','tagPreparation',{path:['processingPolicy']}),version>=12?'auto-clear':undefined);
  assert.equal(await h.store.get('state','nativeDefinitionPreparation',{path:['work','fingerprint']}),work.fingerprint);assert.deepEqual(await h.store.get('nativeMeaningEntries',work.entries[0].id),work.entries[0]);
  if(version>=12){assert.deepEqual(await h.store.get('reviewItems','retained-deferred-choice'),source.reviewItems![0]);assert.equal((await h.store.scan('automaticSuppressions')).total,1);}await h.store.close();
});

test('legacy in-flight dispatches become bounded explicit recovery decisions, while paid replies stay reusable',async()=>{
  for(const replySaved of [false,true]){
    const source=state(),paper=source.papers['1:PAPER'];source.run={id:'legacy-assignment',kind:'tag',scope:'selected',automatic:false,status:'running',jobs:[{id:'unknown-paper-job',paperId:paper.id,status:'running'}],vocabCursor:0,vocabFinished:false,spentUSD:0.21,settings:{...source.settings},vocabularyVersion:0};
    const work=createNativeTagDefinitionWork({papers:[paper],nativeTags:source.nativeTags,definitions:[],facts:{},decisions:{},vocabularyVersion:0,applied:false},['FC']);work.tasks[0].status='running';work.tasks[0].dispatches=1;work.status='running';
    source.nativeDefinitionPreparation={work,taskId:'legacy-native-task',shelfId:'tag-shelf-my-tags',appliedEntryIds:[]};source.maintenanceTasks=[{id:'legacy-native-task',kind:'define-native',status:'running',run:{...source.run,id:'legacy-native-run',jobs:[]},cursor:0,createdAt:new Date(DATE).toISOString(),groupIds:[],paperIds:[paper.id],...(replySaved?{response:{cursor:0,raw:'Exact durable paid reply',applied:false}}:{})}];
    assert.equal(validState(source),true);const h=await migrate(source),assignment=await h.store.scan('providerDispatches',{status:'unknown',taskId:source.run.id});assert.equal(assignment.total,1);
    const marker=await h.store.codec.read(assignment.rows[0].token) as {legacy:boolean;ownerRunId:string;requestIds:string[];dispatchedAt?:number};assert.equal(marker.legacy,true);assert.equal(marker.ownerRunId,source.run.id);assert.deepEqual(marker.requestIds,['unknown-paper-job']);assert.equal(marker.dispatchedAt,undefined);
    assert.equal((await h.store.scan('providerDispatches',{status:'unknown',taskId:'legacy-native-run'})).total,replySaved?0:1);
    if(replySaved)assert.equal(await h.store.get('maintenanceTasks','legacy-native-task',{path:['response','raw']}),'Exact durable paid reply');await h.store.close();
  }
});

test('current native meanings retain immutable admitted evidence after their old review and Undo expire',async()=>{
  let now=DATE;const source=state(),paper=source.papers['1:PAPER'],work=createNativeTagDefinitionWork({papers:[paper],nativeTags:source.nativeTags,definitions:[],facts:{},decisions:{},vocabularyVersion:0,applied:false},['FC']),entry=work.entries[0],definition={...tag(entry.tagId),matchingMode:'suggest' as const};
  entry.definition=definition;entry.status='ready';entry.judgments={[paper.id]:{relation:'same-meaning',reason:'The abstract establishes the fuel-cell device.',evidence:[{source:'abstract',text:paper.abstract}],supportFactConceptIds:[],sourceFingerprint:fingerprint({sourceName:'FC',paper:paperFingerprint(paper),facts:undefined,assignment:source.nativeTags[paper.id].filter(label=>label.tag==='FC')}),definitionFingerprint:fingerprint(definition)}};work.status='ready';work.tasks=[];source.tags=[definition];
  source.nativeDefinitionPreparation={work,taskId:'completed-native-task',shelfId:'tag-shelf-my-tags',appliedEntryIds:[entry.id],finishedAt:new Date(DATE-8*DAY).toISOString()};assert.equal(validState(source),true);
  const h=await migrate(source,{clock:()=>now});const proof=(await h.store.links('tags',definition.id)).rows.find(ref=>ref.collection==='nativeMeaningAdmissions');assert.ok(proof);
  now+=8*DAY;await h.store.retain(now,100);assert.ok(await h.store.reference('nativeMeaningAdmissions',proof!.id));assert.ok(await h.store.reference('nativeMeaningScopes',work.id+':'+work.fingerprint));assert.deepEqual(await h.store.get('nativeMeaningAdmissions',proof!.id,{path:['entry','definition']}),definition);assert.equal(await h.store.reference('state','nativeDefinitionPreparation'),undefined);await h.store.close();
});
