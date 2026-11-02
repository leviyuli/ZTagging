import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceStore,RETENTION_MS} from '../src/workspace/storage.ts';
import {memorySql} from './workspace-storage-adapter.ts';
import {WorkingContext,metadataFor} from '../src/workspace/context.ts';
import {createNativeTagDefinitionWork} from '../src/native-tag-definition.ts';
import {initialState} from '../src/controller.ts';

test('seven-day expiry preserves live roots, shared evidence and compact decision ledgers',async()=>{
  let now=10*RETENTION_MS;const sql=memorySql(),store=await WorkspaceStore.open(sql.port,{clock:()=>now});
  await store.put('source','shared',{text:'Source required by a current definition.'},{category:'cache',lastUsedAt:now-2*RETENTION_MS});
  await store.put('tags','active',{name:'FC'},{refs:[{collection:'source',id:'shared'}]});
  await store.put('history','expired',{patches:['old undo body']},{category:'history',completedAt:now-RETENTION_MS-1});
  await store.put('history','recent',{patches:['recent undo body']},{category:'history',completedAt:now-RETENTION_MS+1});
  await store.put('choices','later',{meaning:'Unresolved meaning'},{category:'history',completedAt:now-2*RETENTION_MS,status:'deferred'});
  await store.put('decisions','suppression',{key:'prevent immediate reapplication'},{category:'ledger',updatedAt:0});
  await store.retain();assert.equal(await store.get('history','expired'),undefined);assert.ok(await store.get('history','recent'));assert.ok(await store.get('source','shared'));assert.ok(await store.get('choices','later'));assert.ok(await store.get('decisions','suppression'));
  now+=2;await store.retain();assert.equal(await store.get('history','recent'),undefined);await store.close();
});

test('viewing cache records does not refresh reuse time; actual cache reuse does',async()=>{
  let now=20*RETENTION_MS;const sql=memorySql(),store=await WorkspaceStore.open(sql.port,{clock:()=>now});
  await store.put('analyses','viewed',{paid:'cached result'},{category:'cache',lastUsedAt:now});await store.put('analyses','reused',{paid:'cached result'},{category:'cache',lastUsedAt:now});
  now+=RETENTION_MS-1;await store.get('analyses','viewed');await store.scan('analyses');await store.touch('analyses','reused');now+=2;
  await store.retain();assert.equal(await store.get('analyses','viewed'),undefined);assert.deepEqual(await store.get('analyses','reused'),{paid:'cached result'});await store.close();
});

test('unknown timestamps receive import-time grace and staging leases prevent premature collection',async()=>{
  let now=30*RETENTION_MS;const sql=memorySql(),store=await WorkspaceStore.open(sql.port,{clock:()=>now});
  await store.put('history','unknown',{old:'Unknown timestamp'},{category:'history'});await store.retain();assert.ok(await store.get('history','unknown'));
  const release=store.lease();const token=await store.codec.encode({pending:'A streamed migration record'});await store.codec.flush();now+=RETENTION_MS+1;
  assert.equal((await store.retain()).recordsRemoved,0);await store.putReference('work','streamed',token);release();await store.retain();assert.equal(await store.get('history','unknown'),undefined);assert.deepEqual(await store.get('work','streamed'),{pending:'A streamed migration record'});await store.close();
});

test('repeated writes and expiry reclaim unreachable content while keeping shared current values',async()=>{
  let now=40*RETENTION_MS;const sql=memorySql(),store=await WorkspaceStore.open(sql.port,{clock:()=>now});
  for(let index=0;index<40;index++)await store.put('history','run-'+index,{reply:'Identical paid content. '.repeat(200)},{category:'history',completedAt:now});
  const full=await store.stats();assert.equal(full.records,40);assert.ok(full.payloads<20);
  now+=RETENTION_MS+1;for(let index=0;index<10;index++){const result=await store.retain();if(!result.more)break;}
  const empty=await store.stats();assert.equal(empty.records,0);assert.equal(empty.payloads,0);assert.equal(empty.payloadBytes,0);await store.close();
});

test('idle retention reclaims SQLite pages incrementally outside its record transaction',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);await sql.port.query('CREATE TABLE test_scratch(body BLOB)');await sql.port.batch('INSERT INTO test_scratch VALUES(?)',Array.from({length:100},()=>[new Uint8Array(8000)]));await sql.port.query('DELETE FROM test_scratch');
  const before=Number((await sql.port.query('PRAGMA freelist_count'))[0].freelist_count);assert.ok(before>32);const start=sql.statements.length,result=await store.retain();const after=Number((await sql.port.query('PRAGMA freelist_count'))[0].freelist_count);
  assert.equal(before-after,32);assert.equal(result.more,true);assert.ok(sql.statements.slice(start).some(row=>row.sql==='PRAGMA incremental_vacuum(32)'));assert.ok(!sql.statements.some(row=>/^VACUUM\b/.test(row.sql)));await store.close();
});

test('retention cancellation rolls back a partially collected record chunk',async()=>{
  let now=70*RETENTION_MS;const sql=memorySql(),abort=new AbortController(),port={...sql.port,async query(statement:string,parameters:Parameters<typeof sql.port.query>[1]=[]){const result=await sql.port.query(statement,parameters);if(statement.startsWith('DELETE FROM workspace_records'))abort.abort(new Error('cancelled maintenance'));return result;}};
  const store=await WorkspaceStore.open(port,{clock:()=>now});await store.put('history','a',{old:1},{category:'history',completedAt:now});await store.put('history','b',{old:2},{category:'history',completedAt:now});now+=RETENTION_MS+1;
  await assert.rejects(store.retain(now,50,abort.signal),/cancelled maintenance/);assert.deepEqual(await store.get('history','a'),{old:1});assert.deepEqual(await store.get('history','b'),{old:2});await store.close();
});

test('completed native preparations expire after runtime checkpoints while admitted proof and deferred choices survive',async()=>{
  let now=80*RETENTION_MS;const sql=memorySql(),store=await WorkspaceStore.open(sql.port,{clock:()=>now}),context=new WorkingContext(store,{clock:()=>now});await context.seed();
  const input={papers:[],nativeTags:{},definitions:[],facts:{},decisions:{},vocabularyVersion:0,applied:false};
  for(let index=0;index<4;index++){
    const work=createNativeTagDefinitionWork(input,['FC']);work.status='ready';work.tasks=[];
    const definition={...initialState().tags[0],id:'saved-native-'+index,name:'FC '+index},entry=work.entries[0];entry.status='question';entry.definition=definition;entry.meaningAdmission={tagId:definition.id,definitionFingerprint:'meaning',candidateFingerprint:'candidate',changeId:'change-'+index,bindingVerified:false};
    context.state.nativeDefinitionPreparation={work,taskId:'task-'+index,shelfId:'all',appliedEntryIds:[entry.id],finishedAt:new Date(now).toISOString()};
    context.state.tags.push(definition);await context.checkpoint(context.state);
  }
  const current=context.state.nativeDefinitionPreparation!,lastEntry=current.work.entries[0],proofId=JSON.stringify([current.work.id,lastEntry.id,lastEntry.meaningAdmission!.changeId]);
  assert.equal((await store.reference('state','nativeDefinitionPreparation'))!.metadata.category,'history');assert.equal((await store.reference('nativeMeaningEntries',lastEntry.id))!.metadata.pinned,undefined);
  await store.put('nativeMeaningEntries','deferred',{status:'question'},{category:'active',status:'question',pinned:true});await store.put('reviewItems','later',{state:'deferred'},{category:'active',status:'deferred',refs:[{collection:'nativeMeaningEntries',id:'deferred'}]});
  now+=RETENTION_MS+1;for(let index=0;index<100;index++){const result=await store.retain();context.pruneExpired(result.removed??[]);if(!result.more)break;}
  assert.equal((await store.scan('nativeMeaningEntries')).total,1);assert.equal(await store.reference('state','nativeDefinitionPreparation'),undefined);assert.ok(await store.reference('nativeMeaningAdmissions',proofId));assert.ok(await store.reference('nativeMeaningScopes',current.work.id+':'+current.work.fingerprint));assert.ok(await store.reference('reviewItems','later'));assert.ok(await store.reference('tags',lastEntry.meaningAdmission!.tagId));await store.close();
});

test('archived preparation indexes identify the exact originating work',()=>{
  assert.equal(metadataFor('preparationHistory',{preparation:{id:'build'}}).taskId,'build');assert.equal(metadataFor('tagSelectionHistory',{work:{id:'selection'}}).taskId,'selection');
});

test('unfinished native archives protect their original task after its completed-body retention period',async()=>{
  let now=90*RETENTION_MS;const sql=memorySql(),store=await WorkspaceStore.open(sql.port,{clock:()=>now}),review={work:{id:'archived-work'},taskId:'archived-task'};
  await store.put('maintenanceTasks','archived-task',{response:{raw:'Paid reply retained for the unanswered meaning'}},{category:'history',completedAt:now});await store.put('nativeDefinitionHistory','archive',review,metadataFor('nativeDefinitionHistory',review,now));now+=RETENTION_MS+1;await store.retain();assert.ok(await store.reference('maintenanceTasks','archived-task'));await store.close();
});

test('one automatic Undo group remains live until its run finishes and expires from the latest write',async()=>{
  let now=100*RETENTION_MS;const sql=memorySql(),store=await WorkspaceStore.open(sql.port,{clock:()=>now}),context=new WorkingContext(store,{clock:()=>now});await context.seed();
  context.assignField('run',{id:'run',kind:'tag',scope:'library',automatic:true,status:'running',jobs:[],vocabCursor:0,vocabFinished:true,message:'',spentUSD:0,settings:context.state.settings,vocabularyVersion:0});
  context.assignField('history',[{id:'automatic-assignment:run',taskId:'run',automaticGroupId:'automatic-assignment:run',date:new Date(now).toISOString(),label:'Automatic tag assignments',patches:[],beforeOwnership:{},afterOwnership:{},suggestionIds:[],status:'applied'}]);await context.checkpoint(context.state);
  assert.equal((await store.reference('history','automatic-assignment:run'))!.metadata.pinned,true);now+=RETENTION_MS+1;await store.retain();assert.ok(await store.reference('history','automatic-assignment:run'));
  context.state.history[0].date=new Date(now).toISOString();await context.checkpoint(context.state);assert.equal((await store.reference('history','automatic-assignment:run'))!.metadata.completedAt,now);
  context.state.run!.status='idle';await context.checkpoint(context.state);assert.equal((await store.reference('history','automatic-assignment:run'))!.metadata.pinned,false);
  now+=RETENTION_MS-1;await store.retain();assert.ok(await store.reference('history','automatic-assignment:run'));now+=2;await store.retain();assert.equal(await store.reference('history','automatic-assignment:run'),undefined);await store.close();
});
