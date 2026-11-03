import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceStore} from '../src/workspace/storage.ts';
import {ensureNativeReviewIndex,NATIVE_REVIEW_INDEX_TYPE} from '../src/workspace/native-review.ts';
import {memorySql} from './workspace-storage-adapter.ts';

async function fixture(){
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);
  await store.put('viewHeaders','nativeDefinitionPreparation',{id:'work',questionCount:6,savedCount:36,leftUndefinedCount:2},{title:'Meaning preparation',status:'ready',refs:[{collection:'maintenanceTasks',id:'task'}]});
  await store.put('state','nativeDefinitionPreparation',{work:{id:'work'},taskId:'task'});
  for(let index=0;index<44;index++){
    const id='entry-'+String(index).padStart(3,'0');
    await store.put('nativeMeaningEntries',id,{id,status:index>=36&&index<38?'left-undefined':'question',...(index<36?{meaningAdmission:{tagId:'tag-'+index}}:{}),judgments:{private:'Never decode a source judgment. '.repeat(500)}},{taskId:'work',order:index});
    await store.put('nativeMeaningDisplays',id,{id,status:index>=36&&index<38?'left-undefined':'question',applied:index<36,sourceIssues:[{private:'Never decode source details. '.repeat(500)}]},{taskId:'work'});
  }
  await store.put('reviewItems','later',{id:'later',kind:'definition',workId:'work',taskId:'task',questionId:'entry-043',state:'deferred'},{taskId:'task',status:'deferred'});
  await store.put('reviewItems','open',{id:'open',kind:'definition',workId:'work',taskId:'task',questionId:'entry-042',state:'open'},{taskId:'task',status:'open'});
  await store.put('nativeMeaningQueue','obsolete',{entryId:'obsolete'},{taskId:'old-work',status:'open'});
  return {sql,store};
}

test('native review backfill indexes only six actionable identities without loading saved proofs',async()=>{
  const {store}=await fixture(),header=(await store.reference('viewHeaders','nativeDefinitionPreparation'))!,forbidden=[];
  for(const collection of ['nativeMeaningEntries','nativeMeaningDisplays'])for(const row of (await store.scan(collection)).rows)forbidden.push(row.token);
  const read=store.codec.read.bind(store.codec);store.codec.read=async(token,options)=>{for(const body of forbidden)assert.notDeepEqual(token,body,'Only minimal scalar paths may be decoded');return read(token,options);};
  await ensureNativeReviewIndex(store,{yieldControl:async()=>{}});
  const page=await store.scan('nativeMeaningQueue',{taskId:'work',status:'open',orderBy:'order'});assert.equal(page.total,5);assert.deepEqual(page.rows.map(row=>row.id),['entry-038','entry-039','entry-040','entry-041','entry-042']);assert.equal((await store.scan('nativeMeaningQueue',{taskId:'work',status:'deferred'})).total,1);assert.equal(await store.get('nativeMeaningQueue','entry-043',{path:['reviewId']}),'later');assert.equal(await store.reference('nativeMeaningQueue','obsolete'),undefined);
  const marked=(await store.reference('viewHeaders','nativeDefinitionPreparation'))!;assert.equal(marked.metadata.type,NATIVE_REVIEW_INDEX_TYPE);assert.deepEqual(marked.token,header.token);assert.equal(marked.metadata.title,header.metadata.title);assert.equal((await store.links(marked.collection,marked.id)).rows[0].id,'task');await store.close();
});

test('a completed native review index is an O(1) warm-start check',async()=>{
  const {store}=await fixture();await ensureNativeReviewIndex(store,{yieldControl:async()=>{}});store.scan=async()=>{throw new Error('Warm check must not scan any saved or pending rows.');};store.codec.read=async()=>{throw new Error('Warm check must not decode a body.');};await ensureNativeReviewIndex(store);await store.close();
});

test('a cancelled partial queue repair leaves the marker unset and resumes without duplicates',async()=>{
  const {store}=await fixture(),abort=new AbortController();let yields=0;
  await assert.rejects(ensureNativeReviewIndex(store,{signal:abort.signal,yieldControl:async()=>{if(++yields===3)abort.abort(new Error('cancel queue repair'));}}),/cancel queue repair/);assert.notEqual((await store.reference('viewHeaders','nativeDefinitionPreparation'))!.metadata.type,NATIVE_REVIEW_INDEX_TYPE);
  await ensureNativeReviewIndex(store,{yieldControl:async()=>{}});assert.equal((await store.scan('nativeMeaningQueue',{taskId:'work'})).total,6);assert.equal((await store.reference('viewHeaders','nativeDefinitionPreparation'))!.metadata.type,NATIVE_REVIEW_INDEX_TYPE);await store.close();
});

test('legacy headers without a source task match deferred choices by work and ignore unrelated rows',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);await store.put('viewHeaders','nativeDefinitionPreparation',{id:'work'});await store.put('nativeMeaningEntries','entry',{status:'question'},{taskId:'work'});
  await store.put('reviewItems','other',{kind:'definition',workId:'other-work',taskId:'other-task',questionId:'entry',state:'open'},{taskId:'other-task',status:'open'});await store.put('reviewItems','later',{kind:'definition',workId:'work',taskId:'legacy-task',questionId:'entry',state:'deferred'},{taskId:'legacy-task',status:'deferred'});
  await ensureNativeReviewIndex(store,{yieldControl:async()=>{}});assert.equal((await store.reference('nativeMeaningQueue','entry'))!.metadata.status,'deferred');assert.equal(await store.get('nativeMeaningQueue','entry',{path:['reviewId']}),'later');await store.close();
});
