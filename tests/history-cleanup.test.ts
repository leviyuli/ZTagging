import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,validState} from '../src/controller.ts';
import {applyProcessingHistoryPolicy,cleanOldProcessingHistory,hasCompactProcessingHistory,inspectOldProcessingHistory,PROCESSING_HISTORY_POLICY_KEY} from '../src/history-cleanup.ts';
import {paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import {createRegistrySnapshot,ensureFactConceptIds} from '../src/evidence.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import {createNativeTagDefinitionWork} from '../src/native-tag-definition.ts';
import {createDIYComparisonWork} from '../src/tag-reconciliation.ts';
import {createTagSelection} from '../src/tag-selection.ts';

const DATE='2026-11-02T10:00:00.000Z';
const TARGETS=['analysisResetHistory','legacyConsolidationHistory','factHistory','diyComparisonHistory'];

function fixture() {
  const state=initialState();
  const tag:TagDefinition={id:'eis',name:'EIS',description:'Electrochemical impedance spectroscopy.',facet:'method',aliases:[],broaderIds:[],relatedIds:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',matchingMode:'auto'};
  const paper:PaperRecord={id:'1:KEPT',itemID:31,libraryID:1,key:'KEPT',title:'Impedance spectroscopy study',abstract:'Electrochemical impedance spectroscopy measures electrode response.',keywords:[],pdfText:'Retained selected PDF passage.',fingerprint:''};paper.fingerprint=paperFingerprint(paper);
  const facts:PaperFacts={paperId:paper.id,metadataFingerprint:paper.fingerprint,inputFingerprint:paper.fingerprint,provider:'deepseek',model:'paid-model',extractionVersion:1,summary:'Retained scientific findings.',concepts:[{name:'EIS',facet:'method',evidence:[{source:'abstract',text:paper.abstract}]}],needsPDF:false};ensureFactConceptIds([facts]);
  state.tags=[tag];state.papers[paper.id]=paper;state.nativeTags[paper.id]=[{tag:'My project',type:0}];state.facts[paper.id]=facts;
  state.analyses[paper.id]={metadataFingerprint:paper.fingerprint,vocabularyVersion:3,provider:'deepseek',model:'paid-model',raw:{summary:'Current paid reply'},assignmentPolicyVersion:2,assignmentInputFingerprint:'compatible-current-input'};
  const snapshot=createRegistrySnapshot([facts],state.evidenceCatalog);
  state.taxonomyEvidence=snapshot;state.taxonomyEvidenceScopes=[{evidenceSnapshot:snapshot,support:{eis:{paperIds:[paper.id]}}}];
  state.taxonomyArchives=[{id:'restore-kept',date:DATE,version:2,tags:[tag],redirects:{},reason:'Saved tag list',evidenceSnapshot:snapshot}];
  state.run={id:'live-run',kind:'rebuild',scope:'selected',automatic:false,status:'paused',jobs:[{id:'live-job',paperId:paper.id,status:'completed'}],vocabCursor:1,vocabFinished:false,message:'Resume this paid work.',spentUSD:1.75,settings:{...state.settings},vocabularyVersion:3,consolidation:{protocolVersion:2,generationId:'live-generation',inputFingerprint:'live-input',snapshot,candidateIds:{},value:{paidReply:'Current paid plan'},correctionAttempts:0,phase:'needs-review'}};
  state.maintenanceTasks=[{id:'live-maintenance',kind:'retry',status:'paused',run:{...state.run,id:'maintenance-run',spentUSD:0.25},cursor:0,createdAt:DATE,groupIds:[],paperIds:[paper.id],response:{cursor:0,raw:{paidReply:'Current maintenance reply'},applied:false}}];
  state.decisions[paper.id+'|eis']={locked:true,rejected:true};state.ownership[paper.id]={eis:{name:'EIS',changeId:'undo-kept'}};
  state.history=[{id:'undo-kept',date:DATE,label:'Applied assignments',patches:[],beforeOwnership:{},afterOwnership:state.ownership,suggestionIds:[],status:'applied'}];
  state.pendingChange={...state.history[0],id:'pending-journal',status:'prepared'};
  state.nativeTagTreatments={important:'personal'};state.automaticSuppressions=['prevent-immediate-reapply'];state.nativeBindingExclusions={eis:{[paper.id]:['Unverified old label']}};
  const work=createNativeTagDefinitionWork({papers:[paper],nativeTags:state.nativeTags,definitions:state.tags,facts:state.facts,decisions:state.decisions,vocabularyVersion:3,applied:false},['My project']);
  state.nativeDefinitionPreparation={work,taskId:'live-meaning-task',shelfId:'all',appliedEntryIds:[]};
  state.nativeDefinitionHistory=[{...state.nativeDefinitionPreparation,finishedAt:DATE}];
  const diy=createDIYComparisonWork({...work.snapshot,definitions:[...state.tags,{...tag,id:'custom-eis',name:'Custom impedance method',custom:true}],applied:true},['custom-eis']);
  state.diyComparison=diy;state.diyComparisonHistory=[structuredClone(diy)];
  state.reviewItems=[{id:'deferred-choice',kind:'definition',state:'deferred',taskId:'live-meaning-task',workId:work.id,questionId:work.entries[0].id,ownerPage:'vocabulary',label:'My project',message:'A retained choice',conditionFingerprint:'meaning-and-source'}];
  state.metadata={credentialReference:'opaque-reference'};state.deferredItemIDs=[42];
  state.analysisResetHistory=[{id:'old-reset',date:DATE,factsCount:1,analysesCount:1,analyses:structuredClone(state.analyses),discardedSuggestions:[],unfinishedReviews:[],run:structuredClone(state.run)}];
  state.legacyConsolidationHistory=[{runId:'old-run',checkpoint:{...structuredClone(state.run.consolidation!),generationId:'obsolete-generation',value:'Old audit-only reply'}}];
  state.factHistory=[{date:DATE,reason:'Replaced factual record',facts:structuredClone(facts)}];
  return state;
}

test('explicit cleanup removes inactive audit histories while preserving protected live data',()=>{
  const state=fixture(),before=structuredClone(state);assert.equal(validState(state),true);
  const next=cleanOldProcessingHistory(state);assert.notEqual(next,state);assert.equal(next.schemaVersion,13);assert.equal(validState(next),true);
  for(const [key,value] of Object.entries(state)){
    if(TARGETS.includes(key))assert.deepEqual(next[key as keyof typeof next],[]);
    else assert.equal(next[key as keyof typeof next],value,key+' must keep its original record');
  }
  assert.deepEqual(state,before,'cleanup must not mutate its input');
  assert.equal(next.run!.spentUSD,1.75);assert.equal(next.maintenanceTasks![0].run.spentUSD,0.25);
  assert.equal(next.history[0].id,'undo-kept');assert.equal(next.pendingChange!.id,'pending-journal');
  assert.deepEqual(next.analyses['1:KEPT'].raw,{summary:'Current paid reply'});
  assert.equal(next.nativeDefinitionPreparation!.work,state.nativeDefinitionPreparation!.work);
  assert.equal(next.nativeDefinitionHistory,state.nativeDefinitionHistory);assert.equal(next.taxonomyArchives,state.taxonomyArchives);
  assert.equal(next.taxonomyEvidenceScopes,state.taxonomyEvidenceScopes);assert.equal(next.facts,state.facts);
  assert.equal(next.reviewItems![0].state,'deferred');assert.equal(next.nativeTagTreatments!.important,'personal');
  assert.equal(next.automaticSuppressions,state.automaticSuppressions);assert.equal(next.nativeBindingExclusions,state.nativeBindingExclusions);
});

test('cleanup leaves omitted and empty histories alone and is idempotent',()=>{
  const state=initialState();assert.equal(cleanOldProcessingHistory(state),state);assert.deepEqual(inspectOldProcessingHistory(state),{records:0,bytes:0});
  assert.equal(Object.hasOwn(state,'analysisResetHistory'),false);
  state.factHistory=[];assert.equal(cleanOldProcessingHistory(state),state);assert.deepEqual(inspectOldProcessingHistory(state),{records:0,bytes:0});
  const cleaned=cleanOldProcessingHistory(fixture());assert.equal(cleanOldProcessingHistory(cleaned),cleaned);assert.deepEqual(inspectOldProcessingHistory(cleaned),{records:0,bytes:0});
});

test('inspection counts UTF-8 bytes actually removed, including non-ASCII audit text',()=>{
  const state=fixture();state.analysisResetHistory![0].run!.message='旧记录 🔬';state.factHistory![0].reason='旧检查';
  const before=JSON.stringify(state),next=cleanOldProcessingHistory(state),after=JSON.stringify(next),summary=inspectOldProcessingHistory(state);
  assert.equal(summary.records,4);
  assert.equal(summary.bytes,Buffer.byteLength(before,'utf8')-Buffer.byteLength(after,'utf8'));
  assert.ok(summary.bytes>before.length-after.length,'UTF-16 character counts must not be reported as UTF-8 storage');
  assert.equal(JSON.stringify(state),before,'inspection must leave all audit data intact');
});

test('cleanup counts every removable record and preserves unknown future history collections',()=>{
  const state=Object.assign(fixture(),{futureProcessingHistory:[{id:'future-record',paidReply:'A future feature owns this data.'}]});
  state.factHistory!.push(structuredClone(state.factHistory![0]));
  assert.equal(inspectOldProcessingHistory(state).records,5);
  const next=cleanOldProcessingHistory(state);
  assert.equal(Object.getOwnPropertyDescriptor(next,'futureProcessingHistory')!.value,state.futureProcessingHistory);
});

function selectionRecord(state:ReturnType<typeof fixture>,id:string,revision:string) {
  const work=createTagSelection(Object.values(state.facts),state.tags,state.taxonomyEvidence!,{generationId:id,targetCount:3,maxOutputTokens:4096});
  work.diagnostics=[revision];
  return {runId:'run-'+id,work};
}

test('cleanup retains the latest archived selection for every work identity and preserves findLast lookup',()=>{
  const state=fixture(),old=selectionRecord(state,'old-build','first paid revision'),newer=selectionRecord(state,'old-build','latest paid revision'),other=selectionRecord(state,'other-build','independent paid build');
  state.tagSelectionHistory=[old,other,newer];
  const before=JSON.stringify(state),next=cleanOldProcessingHistory(state),summary=inspectOldProcessingHistory(state);
  assert.deepEqual(next.tagSelectionHistory,[other,newer]);
  for(const id of ['old-build','other-build'])assert.equal(next.tagSelectionHistory!.findLast(record=>record.work.id===id),state.tagSelectionHistory.findLast(record=>record.work.id===id));
  assert.equal(summary.records,5);
  assert.equal(summary.bytes,Buffer.byteLength(before)-Buffer.byteLength(JSON.stringify(next)));
  assert.deepEqual(state.tagSelectionHistory,[old,other,newer]);
});

test('every selection variant referenced by a current or maintenance run remains protected',()=>{
  for(const slot of ['current-selection','current-cache','maintenance-selection','maintenance-cache']){
    const state=fixture(),old=selectionRecord(state,'protected-build','earlier paid revision'),newer=selectionRecord(state,'protected-build','latest paid revision');
    state.tagSelectionHistory=[old,newer];
    if(slot==='current-selection')state.run!.selection=old.work;
    if(slot==='current-cache')state.run!.cachedSelection={work:old.work,inputFingerprint:'cached-input'};
    if(slot==='maintenance-selection')state.maintenanceTasks![0].run.selection=old.work;
    if(slot==='maintenance-cache')state.maintenanceTasks![0].run.cachedSelection={work:old.work,inputFingerprint:'cached-input'};
    const next=cleanOldProcessingHistory(state);
    assert.equal(next.tagSelectionHistory,state.tagSelectionHistory,slot);
    assert.equal(next.tagSelectionHistory!.findLast(record=>record.work.id==='protected-build'),newer);
  }
});

test('inspection never serializes protected or retained selection payloads',()=>{
  const state=initialState(),source=fixture(),old=selectionRecord(source,'unused-revision','old'),latest=selectionRecord(source,'unused-revision','latest'),active=selectionRecord(source,'active-revision','current');
  Object.defineProperty(latest.work,'toJSON',{value(){throw new Error('Retained paid work must not be serialized for a cleanup estimate.');}});
  Object.defineProperty(active.work,'toJSON',{value(){throw new Error('Current work must not be serialized for a cleanup estimate.');}});
  state.run={...source.run!,selection:active.work};state.tagSelectionHistory=[old,latest,active];
  const expected=Buffer.byteLength(JSON.stringify(old))+1;
  assert.deepEqual(inspectOldProcessingHistory(state),{records:1,bytes:expected});
});

test('compact policy bounds repeated inactive history production and never silently enables itself',()=>{
  const state=fixture(),old=selectionRecord(state,'revisited-build','old'),latest=selectionRecord(state,'revisited-build','latest');state.tagSelectionHistory=[old,latest];
  const before=structuredClone(state);assert.equal(hasCompactProcessingHistory(state),false);applyProcessingHistoryPolicy(state);assert.deepEqual(state,before);
  cleanOldProcessingHistory(state);assert.equal(hasCompactProcessingHistory(state),false,'previewing or constructing cleanup must not opt in');
  state.metadata[PROCESSING_HISTORY_POLICY_KEY]='compact-v1';assert.equal(hasCompactProcessingHistory(state),true);
  for(let index=0;index<8;index++){
    state.factHistory!.push(...structuredClone(before.factHistory!));
    state.analysisResetHistory!.push(...structuredClone(before.analysisResetHistory!));
    state.diyComparisonHistory!.push(...structuredClone(before.diyComparisonHistory!));
    const nextRevision=selectionRecord(state,'revisited-build','revision-'+index);state.tagSelectionHistory!.push(nextRevision);
    const run=state.run,papers=state.papers,history=state.history;applyProcessingHistoryPolicy(state);
    assert.equal(state.run,run);assert.equal(state.papers,papers);assert.equal(state.history,history);
    for(const key of TARGETS)assert.deepEqual(state[key as keyof typeof state],[]);
    assert.deepEqual(state.tagSelectionHistory,[nextRevision]);
    assert.deepEqual(inspectOldProcessingHistory(state),{records:0,bytes:0});
  }
});
