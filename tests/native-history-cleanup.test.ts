import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
import type {ReconciliationInput} from '../src/tag-reconciliation.ts';
import {acceptNativeTagDefinitionResult,createNativeTagDefinitionWork,nextNativeTagDefinitionRequests,noteNativeTagDefinitionDispatch,resolveNativeTagDefinition,validNativeTagDefinitionWork} from '../src/native-tag-definition.ts';
import type {NativeTagDefinitionRevision,NativeTagDefinitionWork} from '../src/native-tag-definition.ts';
import {compactNativeDefinitionHistory} from '../src/native-history-cleanup.ts';

const clone=<T>(value:T):T=>structuredClone(value);
function fixture() {
  const paper:PaperRecord={id:'1:PAPER',itemID:1,libraryID:1,key:'PAPER',title:'Membrane resistance',abstract:'The membrane ionic resistance was measured experimentally.',keywords:[],fingerprint:''};
  paper.fingerprint=paperFingerprint(paper);
  const input:ReconciliationInput={papers:[paper],nativeTags:{[paper.id]:[{tag:'membrane resistance',type:0}]},definitions:[],facts:{},decisions:{},vocabularyVersion:1,applied:true};
  let work=createNativeTagDefinitionWork(input,['membrane resistance']);
  const request=nextNativeTagDefinitionRequests(work)[0],data=JSON.parse(request.prompt.split('INPUT_DATA_JSON:\n')[1]);
  work=acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(work,request.id),request.id,{workId:data.workId,fingerprint:data.fingerprint,taskId:data.taskId,definitions:[{entryId:data.entries[0].entryId,name:'membrane ionic resistance',description:'Resistance to ionic movement through a membrane.',facet:'phenomenon',aliases:[]}],judgments:[{entryId:data.entries[0].entryId,paperId:paper.id,sourceFingerprint:data.papers[0].sourceFingerprint,relation:'same-meaning',reason:'The measured membrane resistance establishes this scope.',evidence:[{source:'abstract',text:paper.abstract}],supportFactConceptIds:[]}]},{provider:'synthetic',model:'history-fixture'});
  assert.equal(validNativeTagDefinitionWork(work),true);
  return {work,input,paperId:paper.id};
}
function revision(work:NativeTagDefinitionWork):NativeTagDefinitionRevision {
  const {protocolVersion,fingerprint,snapshot,entries,tasks,status,diagnostics,selectionPolicyVersion,treatments}=work;
  return clone({reason:'answer',protocolVersion,fingerprint,snapshot,entries,tasks,status,diagnostics,...(selectionPolicyVersion?{selectionPolicyVersion}:{}),...(treatments?{treatments}:{})});
}

test('native history cleanup returns the same work when history is absent or already minimal',()=>{
  const {work}=fixture();assert.equal(compactNativeDefinitionHistory(work),work);
  work.history=[];assert.equal(compactNativeDefinitionHistory(work),work);
  work.history=[revision(work)];assert.equal(compactNativeDefinitionHistory(work),work);
});

test('duplicate native snapshots compact without changing current work or mutating the source',()=>{
  const {work}=fixture();work.history=[revision(work),revision(work),revision(work)];const before=clone(work),last=work.history.at(-1)!;
  const result=compactNativeDefinitionHistory(work);
  assert.notEqual(result,work);assert.deepEqual(result.history,[last]);assert.equal(result.history![0],last);
  for(const field of ['entries','tasks','snapshot'] as const)assert.equal(result[field],work[field]);
  assert.deepEqual(work,before);assert.equal(validNativeTagDefinitionWork(result),true);assert.equal(compactNativeDefinitionHistory(result),result);
});

test('a current verdict cannot replace the only archived copy of a prior meaning',()=>{
  const {work,paperId}=fixture(),first=revision(work),last=revision(work);
  last.entries[0].judgments[paperId].definitionFingerprint='another-meaning';work.history=[first,last];
  assert.equal(compactNativeDefinitionHistory(work),work);
});

for(const field of ['id','paperId','definitionFingerprint','sourceFingerprint','relation','reason','evidence','supportFactConceptIds'] as const){
  test('native history retains distinct '+field+' evidence',()=>{
    const {work,paperId}=fixture(),first=revision(work),last=revision(work),entry=first.entries[0],judgment=entry.judgments[paperId];
    if(field==='id')entry.id+='-older';
    else if(field==='paperId'){entry.judgments['1:OTHER']=judgment;delete entry.judgments[paperId];}
    else if(field==='relation')judgment.relation='different';
    else if(field==='evidence')judgment.evidence=[{source:'title',text:'A distinct supporting passage.'}];
    else if(field==='supportFactConceptIds')judgment.supportFactConceptIds=['unique-fact'];
    else judgment[field]+='-older';
    work.history=[first,last];assert.equal(compactNativeDefinitionHistory(work),work);
  });
}

test('a retained intermediate revision can cover earlier duplicate verdicts',()=>{
  const {work,paperId}=fixture(),first=revision(work),middle=revision(work),last=revision(work);
  last.entries[0].judgments[paperId].reason='A later distinct scientific explanation.';
  work.history=[first,middle,last];const result=compactNativeDefinitionHistory(work);
  assert.deepEqual(result.history,[middle,last]);
});

for(const field of ['humanAnswer','automaticAnswer','meaningAdmission'] as const){
  test('native history retains a unique '+field+' and removes it only when its full payload is retained',()=>{
    const {work,paperId}=fixture(),first=revision(work),last=revision(work),entry=first.entries[0];
    const human={origin:'choice' as const,questionFingerprint:'question-1',meaningFingerprint:fingerprint(entry.definition),choiceId:'choice-1',sourceFingerprints:{[paperId]:entry.judgments[paperId].sourceFingerprint},policyVersion:2 as const};
    if(field==='humanAnswer')entry.humanAnswer=human;
    else if(field==='automaticAnswer')entry.automaticAnswer={origin:'single-clear-choice',policyVersion:1,questionFingerprint:human.questionFingerprint,choiceId:human.choiceId,meaningFingerprint:human.meaningFingerprint,sourceFingerprints:human.sourceFingerprints};
    else entry.meaningAdmission={tagId:entry.tagId,definitionFingerprint:human.meaningFingerprint,candidateFingerprint:human.meaningFingerprint,changeId:'admission-1',bindingVerified:false};
    work.history=[first,last];assert.equal(compactNativeDefinitionHistory(work),work);
    Object.assign(work.entries[0],{[field]:clone(entry[field])});
    assert.deepEqual(compactNativeDefinitionHistory(work).history,[last]);
  });
}

test('an answer on another entry cannot cover an older user decision',()=>{
  const {work,paperId}=fixture(),first=revision(work),last=revision(work),entry=first.entries[0];
  entry.humanAnswer={origin:'leave',questionFingerprint:'personal-label',sourceFingerprints:{[paperId]:entry.judgments[paperId].sourceFingerprint},policyVersion:2};
  work.entries.push({...clone(work.entries[0]),id:'another-entry',humanAnswer:clone(entry.humanAnswer)});work.history=[first,last];
  assert.equal(compactNativeDefinitionHistory(work),work);
});

test('unique paid replies survive cleanup even when all judgments are duplicated',()=>{
  const {work}=fixture(),first=revision(work),last=revision(work);
  first.tasks[0].attempts=[{raw:{paid:'earlier-reply'},provider:'synthetic',model:'original-model'}];work.history=[first,last];
  assert.equal(compactNativeDefinitionHistory(work),work);
  work.tasks[0].attempts=clone(first.tasks[0].attempts);
  assert.deepEqual(compactNativeDefinitionHistory(work).history,[last]);
});

for(const changed of ['task','index','provider','model','raw','error'] as const){
  test('paid reply coverage retains its '+changed+' provenance',()=>{
    const {work}=fixture(),first=revision(work),last=revision(work);
    first.tasks[0].attempts=[{raw:'paid result',provider:'synthetic',model:'selected-model'}];
    work.tasks[0].attempts=clone(first.tasks[0].attempts);last.tasks[0].attempts=[];
    if(changed==='task')work.tasks[0].id+='-other';
    else if(changed==='index')first.tasks[0].attempts.push(clone(first.tasks[0].attempts[0]));
    else work.tasks[0].attempts[0][changed]='different';
    work.history=[first,last];assert.equal(compactNativeDefinitionHistory(work),work);
  });
}

test('a paid reply on a different request pair cannot replace its original scope',()=>{
  const {work}=fixture(),first=revision(work),last=revision(work);
  first.tasks[0].pairs=[...first.tasks[0].pairs,{entryId:first.entries[0].id,paperId:'1:ANOTHER'}];
  work.history=[first,last];assert.equal(compactNativeDefinitionHistory(work),work);
});

for(const field of ['generation','dispatches','fingerprint'] as const){
  test('native cleanup retains paid request '+field+' provenance',()=>{
    const {work}=fixture(),first=revision(work),last=revision(work);
    if(field==='fingerprint')first.fingerprint='an-earlier-input-snapshot';else first.tasks[0][field]++;
    work.history=[first,last];assert.equal(compactNativeDefinitionHistory(work),work);
  });
}

test('a dispatched request without a paid reply retains its unique original scope',()=>{
  const {work}=fixture(),first=revision(work),last=revision(work);
  first.tasks[0].attempts=[];first.tasks[0].dispatches++;work.history=[first,last];
  assert.equal(compactNativeDefinitionHistory(work),work);
});

test('an old revision without reusable judgments can be removed while the newest is always kept',()=>{
  const {work}=fixture(),first=revision(work),last=revision(work);
  for(const entry of first.entries)for(const judgment of Object.values(entry.judgments))judgment.relation='uncertain';
  for(const entry of last.entries)entry.judgments={};work.history=[first,last];
  assert.deepEqual(compactNativeDefinitionHistory(work).history,[last]);
});

for(const location of ['work','revision','snapshot','entry','task','judgment','attempt'] as const){
  test('unknown '+location+' fields retain future history data',()=>{
    const {work,paperId}=fixture(),first=revision(work),last=revision(work);
    const target={work,revision:first,snapshot:first.snapshot,entry:first.entries[0],task:first.tasks[0],judgment:first.entries[0].judgments[paperId],attempt:first.tasks[0].attempts[0]}[location];
    Object.assign(target,{futureRecoveryRecord:{id:'retain-this-data'}});work.history=[first,last];
    assert.equal(compactNativeDefinitionHistory(work),work);
  });
}

for(const conflict of [false,true]){
  test('returning to an earlier meaning restores the same '+(conflict?'contradiction':'support')+' after compaction',()=>{
    const {work,input,paperId}=fixture(),original=clone(work.entries[0].definition!),first=revision(work),middle=revision(work),last=revision(work);
    if(conflict){last.entries[0].judgments[paperId].relation='different';last.entries[0].judgments[paperId].reason='This later check rejects the proposed interpretation.';last.entries[0].status='question';last.entries[0].question='This source contradicts the proposed meaning.';}
    work.entries[0].definition={...original,description:'A different scientific meaning.'};work.entries[0].status='question';work.entries[0].question='Choose the intended meaning.';work.entries[0].judgments={};work.history=[first,middle,last];
    assert.equal(validNativeTagDefinitionWork(work),true);
    const compacted=compactNativeDefinitionHistory(work);assert.equal(validNativeTagDefinitionWork(compacted),true);
    const answer={entryId:work.entries[0].id,definition:original},before=resolveNativeTagDefinition(work,input,answer),after=resolveNativeTagDefinition(compacted,input,answer);
    const beforeEntries=clone(before.entries),afterEntries=clone(after.entries);
    for(const entry of [...beforeEntries,...afterEntries])if(entry.questionDetails)entry.questionDetails.id='new-question';
    assert.deepEqual(afterEntries,beforeEntries);assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(after.snapshot,before.snapshot);
    assert.equal(after.entries[0].judgments[paperId].relation,conflict?'different':'same-meaning');assert.equal(validNativeTagDefinitionWork(after),true);
    assert.equal(nextNativeTagDefinitionRequests(after).length,0);
  });
}

test('repeated archive growth stays bounded without losing a distinct scientific verdict',()=>{
  const {work,paperId}=fixture();let current=work;const all=new Set<string>();
  for(let index=0;index<250;index++){
    const next=revision(current),judgment=next.entries[0].judgments[paperId];judgment.reason='Retained scientific verdict '+Math.floor(index/25);
    all.add(JSON.stringify(judgment));current={...current,history:[...(current.history??[]),next]};current=compactNativeDefinitionHistory(current);
    const retained=new Set(current.history!.map(row=>JSON.stringify(row.entries[0].judgments[paperId])));
    assert.deepEqual(retained,all);assert.equal(current.history!.length,all.size);
  }
  assert.equal(current.history!.length,10);
});
