import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {ReconciliationInput} from '../src/tag-reconciliation.ts';
import {createNativeTagDefinitionWork,nextNativeTagDefinitionRequests,noteNativeTagDefinitionDispatch,acceptNativeTagDefinitionResult,failNativeTagDefinitionTask,resumeNativeTagDefinitionWork,retainNativeTagDefinitionSnapshot,isRetainedNativeTagDefinitionSnapshot,resolveNativeTagDefinition,continueNativeTagDefinitionWork,compileNativeTagDefinitions,validNativeTagDefinitionWork} from '../src/native-tag-definition.ts';
import type {NativeTagDefinitionRequest,NativeTagDefinitionWork,NativeTagDefinitionRevision} from '../src/native-tag-definition.ts';

const NAME='transport marker';
function input(count=3,pdf=''):ReconciliationInput {
  const papers=Array.from({length:count},(_,index)=>{const paper={id:'1:SOURCE'+index,itemID:index+1,libraryID:1,key:'SOURCE'+index,title:'Membrane resistance experiment '+index,abstract:'Membrane ionic resistance was measured experimentally in study '+index+'.',keywords:[],fingerprint:'',...(pdf?{pdfText:pdf}:{})};paper.fingerprint=paperFingerprint(paper);return paper;});
  return {papers,nativeTags:Object.fromEntries(papers.map(paper=>[paper.id,[{tag:NAME,type:0}]])),definitions:[],facts:{},decisions:{},vocabularyVersion:0,applied:false};
}
function reply(request:NativeTagDefinitionRequest,uncertain=false){
  const data=JSON.parse(request.prompt.split('INPUT_DATA_JSON:\n')[1]);
  return {workId:data.workId,fingerprint:data.fingerprint,taskId:data.taskId,definitions:data.phase==='draft'?data.entries.map((entry:{entryId:string})=>({entryId:entry.entryId,name:'membrane ionic resistance',fullName:'membrane ionic resistance',description:'Electrical resistance to ionic transport through a membrane.',facet:'phenomenon',aliases:[]})):[],judgments:data.papers.map((paper:{entryId:string;paperId:string;sourceFingerprint:string;paper:{abstract:string}},index:number)=>({entryId:paper.entryId,paperId:paper.paperId,sourceFingerprint:paper.sourceFingerprint,relation:uncertain&&index>0?'uncertain':'same-meaning',reason:'The exact experimental source establishes this meaning.',evidence:[{source:'abstract',text:paper.paper.abstract}],supportFactConceptIds:[]}))};
}
function accept(work:NativeTagDefinitionWork,uncertain=false){const request=nextNativeTagDefinitionRequests(work)[0];return acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(work,request.id),request.id,reply(request,uncertain),{provider:'retained-provider',model:'retained-model'});}

test('opted-in dispatch and pause/restart share a source larger than32MiB and immutable audit revisions',t=>{
  const data=input(520,'Retained PDF source context. '.repeat(2500)),work=createNativeTagDefinitionWork(data,[NAME]);
  assert.ok(work.snapshot.papers.reduce((sum,paper)=>sum+(paper.pdfText?.length??0),0)>32*1024*1024);
  const revision:NativeTagDefinitionRevision={reason:'continue',protocolVersion:work.protocolVersion,fingerprint:work.fingerprint,snapshot:work.snapshot,entries:structuredClone(work.entries),tasks:structuredClone(work.tasks),status:work.status,diagnostics:[]};work.history=[revision];
  const expected=nextNativeTagDefinitionRequests(work)[0];retainNativeTagDefinitionSnapshot(work);const start=performance.now(),running=noteNativeTagDefinitionDispatch(work,expected.id),elapsed=performance.now()-start;
  t.diagnostic('Dispatch with retained'+Math.round(data.papers.length*(data.papers[0].pdfText?.length??0)/1048576)+'MiB source:'+elapsed.toFixed(2)+'ms');
  assert.equal(running.snapshot,work.snapshot);assert.equal(running.history![0],revision);assert.notEqual(running.history,work.history);assert.notEqual(running.entries,work.entries);assert.notEqual(running.tasks,work.tasks);assert.equal(work.tasks[0].dispatches,0);assert.equal(running.tasks[0].dispatches,1);
  assert.throws(()=>{running.snapshot.papers[0].abstract='Cannot mutate retained scientific provenance.';},TypeError);
  running.entries[0].paperIds.pop();running.diagnostics.push('Only the new state changed.');assert.equal(work.entries[0].paperIds.length,520);assert.equal(revision.entries[0].paperIds.length,520);assert.deepEqual(work.diagnostics,[]);
  const failed=failNativeTagDefinitionTask(noteNativeTagDefinitionDispatch(work,expected.id),expected.id,'Exact retained paid bytes\r\n','Interrupted',{retryable:true}),resumed=resumeNativeTagDefinitionWork(failed);
  assert.equal(resumed.snapshot,work.snapshot);assert.equal(resumed.history![0],revision);assert.equal(resumed.tasks[0].attempts[0].raw,'Exact retained paid bytes\r\n');assert.equal(nextNativeTagDefinitionRequests(resumed)[0].prompt,expected.prompt);
});

test('ordinary domain callers retain independent mutable snapshots and persisted corruption guards',()=>{
  const work=createNativeTagDefinitionWork(input(),[NAME]),next=noteNativeTagDefinitionDispatch(work,nextNativeTagDefinitionRequests(work)[0].id);assert.notEqual(next.snapshot,work.snapshot);next.snapshot.papers[0].abstract='A changed local copy.';assert.notEqual(next.snapshot.papers[0].abstract,work.snapshot.papers[0].abstract);
  const finished=accept(createNativeTagDefinitionWork(input(),[NAME]));retainNativeTagDefinitionSnapshot(finished);const restarted=structuredClone(finished);assert.equal(isRetainedNativeTagDefinitionSnapshot(restarted.snapshot),false);assert.equal(validNativeTagDefinitionWork(restarted),true);restarted.snapshot.papers[0].abstract+='Changed retained evidence.';assert.equal(validNativeTagDefinitionWork(restarted),false);
});

test('retained source indexes preserve exact prompts while mutable current input is always revalidated',()=>{
  const current=input(),work=createNativeTagDefinitionWork(current,[NAME]),before=nextNativeTagDefinitionRequests(work)[0].prompt;retainNativeTagDefinitionSnapshot(work);assert.equal(nextNativeTagDefinitionRequests(work)[0].prompt,before);
  const ready=accept(work);assert.equal(ready.snapshot,work.snapshot);assert.equal(compileNativeTagDefinitions(ready,current).entries.length,1);
  current.papers[0].abstract+='The current source changed.';assert.match(compileNativeTagDefinitions(ready,current).questions[0].message,/changed/);current.papers[0].abstract=work.snapshot.papers[0].abstract;
  current.nativeTags[current.papers[0].id]=[];assert.match(compileNativeTagDefinitions(ready,current).questions[0].message,/changed/);assert.equal(ready.snapshot.nativeTags[current.papers[0].id].length,1);
});

test('continuing an opted-in question replaces its captured source and keeps prior revision values immutable',()=>{
  const current=input(),work=accept(createNativeTagDefinitionWork(current,[NAME]),true);retainNativeTagDefinitionSnapshot(work);const oldFingerprint=work.fingerprint,oldQuestion=fingerprint(work.entries[0]);current.papers[0].abstract+='A new source observation.';
  const next=continueNativeTagDefinitionWork(work,current,[work.entries[0].id]);assert.notEqual(next.snapshot,work.snapshot);assert.equal(isRetainedNativeTagDefinitionSnapshot(next.snapshot),true);assert.equal(next.history!.at(-1)!.snapshot,work.snapshot);assert.equal(next.history!.at(-1)!.fingerprint,oldFingerprint);assert.equal(fingerprint(work.entries[0]),oldQuestion);assert.notEqual(next.fingerprint,oldFingerprint);assert.equal(noteNativeTagDefinitionDispatch(next,nextNativeTagDefinitionRequests(next)[0].id).snapshot,next.snapshot);
});

test('only compatible cached judgments actually restored by a choice report cache reuse',()=>{
  const current=input(6),work=accept(createNativeTagDefinitionWork(current,[NAME]),true),entry=work.entries[0],request=JSON.parse(nextNativeTagDefinitionRequests(createNativeTagDefinitionWork(current,[NAME]))[0].prompt.split('INPUT_DATA_JSON:\n')[1]),first=Object.values(entry.judgments)[0],second=request.papers[1],third=request.papers[2];
  work.cachedJudgments=[{cacheId:'used',entryId:entry.id,paperId:second.paperId,judgment:{...structuredClone(first),sourceFingerprint:second.sourceFingerprint,evidence:[{source:'abstract',text:second.paper.abstract}]}},{cacheId:'already-present',entryId:entry.id,paperId:entry.paperIds[0],judgment:structuredClone(first)},{cacheId:'uncertain',entryId:entry.id,paperId:third.paperId,judgment:{...structuredClone(first),relation:'uncertain',sourceFingerprint:third.sourceFingerprint}},{cacheId:'stale',entryId:entry.id,paperId:entry.paperIds[3],judgment:{...structuredClone(first),sourceFingerprint:'changed'}}];
  retainNativeTagDefinitionSnapshot(work);const next=resolveNativeTagDefinition(work,current,{entryId:entry.id,choiceId:entry.questionDetails!.choices[0].id});assert.deepEqual(next.reusedJudgmentIds,['used']);assert.equal(next.entries[0].judgments[second.paperId].relation,'same-meaning');assert.equal(next.entries[0].judgments[third.paperId],undefined);assert.equal(next.history?.some(revision=>Object.hasOwn(revision,'cachedJudgments')||Object.hasOwn(revision,'reusedJudgmentIds')),false);assert.equal(validNativeTagDefinitionWork(next),true);
});
