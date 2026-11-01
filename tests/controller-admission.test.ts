import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
import {createRegistrySnapshot} from '../src/evidence.ts';
import {normalizeFacts,refreshProposalEvidence} from '../src/taxonomy.ts';
import {prepare} from '../src/tag-preparation.ts';
import {createTagSelection,nextSelectionRequests,noteSelectionDispatch,acceptSelectionResult} from '../src/tag-selection.ts';
import {migrateTagShelves} from '../src/tag-shelves.ts';

function completedBuild() {
  const state=initialState();Object.assign(state.settings,{provider:'deepseek',model:'retained-model',inputPricePerMillion:1,outputPricePerMillion:1});
  for(const [index,name] of ['proton transport','electron transport'].entries()){
    const paper:PaperRecord={id:`1:ADMISSION-${index}`,itemID:index+1,libraryID:1,key:`ADMISSION-${index}`,title:`Scientific study of ${name}`,abstract:`The experiment measured ${name} through the studied material.`,keywords:[],fingerprint:''};
    paper.fingerprint=paperFingerprint(paper);state.papers[paper.id]=paper;state.nativeTags[paper.id]=[{tag:'Manual project',type:0}];
    state.facts[paper.id]=normalizeFacts({summary:`The experiment measured ${name}.`,needsPDF:false,concepts:[{name,facet:'phenomenon',evidence:[{source:'abstract',text:paper.abstract}]}]},paper,'retained-provider','retained-model');
  }
  const facts=Object.values(state.facts),snapshot=createRegistrySnapshot(facts,state.evidenceCatalog);
  let work=createTagSelection(facts,[],snapshot,{adaptivePolicyVersion:1,tagPolicyVersion:2,targetCount:60,maxOutputTokens:8192});
  const plan=nextSelectionRequests(work)[0];work=acceptSelectionResult(noteSelectionDispatch(work,plan.id),plan.id,{tags:facts.map((fact,index)=>({key:`tag-${index}`,name:fact.concepts[0].name,fullName:fact.concepts[0].name,description:`Scientific study of ${fact.concepts[0].name}.`,facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:index===0?['tag-1']:[],supportRegistryIds:Object.values(snapshot.entries).filter(entry=>entry.sourceIds.some(id=>snapshot.sources[id].paperId===fact.paperId)).map(entry=>entry.registryId)}))});
  for(let round=0;round<4&&work.status!=='ready';round++)for(const request of nextSelectionRequests(work)){
    const data=JSON.parse(request.prompt.split('INPUT_DATA_JSON:\n')[1]);
    work=acceptSelectionResult(noteSelectionDispatch(work,request.id),request.id,{judgements:data.requestedPairs.map((pair:{pairRef:string;tagId:string;sourceId:string})=>({pairRef:pair.pairRef,relation:data.tags.find((tag:{id:string})=>tag.id===pair.tagId).name==='electron transport'?'needs-context':snapshot.sources[pair.sourceId].name==='proton transport'?'equivalent':'unrelated',reason:'The exact scientific source establishes this verdict; the other scope remains a real unresolved choice.'}))});
  }
  assert.equal(work.status,'ready');const prepared=prepare(work.proposal!,undefined,{processingPolicy:'auto-clear'});assert.equal(prepared.state.status,'questions');
  state.taxonomyProposal=prepared.proposal;state.tagPreparation=prepared.state;state.tagShelves=migrateTagShelves(state.tags);
  state.run={id:'completed-auto-build',kind:'rebuild',scope:'selected',automatic:false,processingPolicy:'auto-clear',status:'idle',jobs:facts.map(fact=>({id:`job-${fact.paperId}`,paperId:fact.paperId,status:'completed'})),vocabCursor:facts.length,vocabFinished:true,message:'Completed scientific checks.',spentUSD:0.4,settings:structuredClone(state.settings),vocabularyVersion:0,selection:work};
  assert.equal(validState(state),true);return state;
}
function harness(state:AppState,rejectAdmission=false) {
  const snapshots:AppState[]=[];let modelCalls=0,nativeWrites=0;
  const env:ControllerEnvironment={persist:async next=>{if(rejectAdmission&&Object.keys(next.tagPreparation?.admissions??{}).length)throw new Error('Admission state write failed');snapshots.push(structuredClone(next));},host:{list:async()=>structuredClone(Object.values(state.papers)),read:async id=>structuredClone(Object.values(state.papers).find(paper=>paper.itemID===id)??null),readTags:async id=>structuredClone(state.nativeTags[Object.values(state.papers).find(paper=>paper.itemID===id)!.id]),pdfText:async()=>'',apply:async()=>{nativeWrites++;},show:async()=>{},saveSearch:async()=>{}},ai:{hasApiKey:async()=>true,getSession:async()=>({connected:false,sharing:false,accountId:null,email:null,accounts:[]}),completeJson:async()=>{modelCalls++;throw new Error('Completed admission must not dispatch');},testConnection:async()=>{throw new Error('No connection request');},listModels:async()=>[],setApiKey:async()=>{},removeApiKey:async()=>{},signIn:async()=>{throw new Error('No sign in');},cancelSignIn:()=>{},signOut:async()=>({revoked:true}),selectAccount:async()=>{}}};
  return {app:new AppController(state,env),snapshots,modelCalls:()=>modelCalls,nativeWrites:()=>nativeWrites};
}

test('restart locally admits clear completed definitions while preserving unanswered questions, source identities and task identity',async()=>{
  const state=completedBuild(),run=state.run,selection=state.run!.selection,snapshot=fingerprint(state.taxonomyProposal!.evidenceSnapshot),questions=fingerprint(state.tagPreparation!.questions),h=harness(state);
  await h.app.initialize();
  assert.equal(h.modelCalls(),0);assert.equal(h.nativeWrites(),0);assert.equal(state.run,run);assert.equal(state.run!.selection,selection);
  const admitted=state.tags.find(tag=>tag.name==='proton transport')!;assert.ok(admitted);assert.ok(!state.tags.some(tag=>tag.name==='electron transport'));
  assert.equal(fingerprint(state.taxonomyProposal!.evidenceSnapshot),snapshot);assert.equal(fingerprint(state.tagPreparation!.questions),questions);assert.equal(state.run!.spentUSD,0.4);assert.equal(validState(state),true);
  assert.ok(state.tagPreparation!.admissions![admitted.id]);assert.equal(state.taxonomyEvidenceScopes!.at(-1)!.support[admitted.id].paperIds.length,1);
  const restored=harness(JSON.parse(JSON.stringify(state)));await restored.app.initialize();assert.equal(restored.app.state.tags.filter(tag=>tag.id===admitted.id).length,1);assert.equal(restored.app.state.history.length,state.history.length);assert.equal(restored.modelCalls(),0);
});

test('failed admission persistence leaves no half-saved definitions or proofs and restart retries the same paid work locally',async()=>{
  const state=completedBuild(),before={tags:fingerprint(state.tags),scopes:fingerprint(state.taxonomyEvidenceScopes??[]),history:fingerprint(state.history)},h=harness(state,true);
  await assert.rejects(h.app.initialize(),/Admission state write failed/);
  assert.equal(fingerprint(state.tags),before.tags);assert.equal(fingerprint(state.taxonomyEvidenceScopes??[]),before.scopes);assert.equal(fingerprint(state.history),before.history);assert.equal(state.tagPreparation!.admissions,undefined);assert.equal(h.nativeWrites(),0);assert.equal(h.modelCalls(),0);
  const restored=harness(structuredClone(h.snapshots.at(-1)!));await restored.app.initialize();
  assert.ok(restored.app.state.tags.some(tag=>tag.name==='proton transport'));assert.equal(restored.modelCalls(),0);assert.equal(restored.app.state.run!.spentUSD,0.4);
  for(const saved of restored.snapshots)for(const tag of saved.tags.filter(tag=>tag.name==='proton transport')){assert.ok(saved.tagPreparation!.admissions![tag.id]);assert.ok(saved.taxonomyEvidenceScopes!.some(scope=>scope.support[tag.id]));assert.ok(saved.history.some(change=>change.afterDefinitions?.[tag.id]));}
});

test('undoing an automatically admitted definition prevents restart from recreating it',async()=>{
  const state=completedBuild(),h=harness(state);await h.app.initialize();
  const tag=state.tags.find(tag=>tag.name==='proton transport')!,changeId=state.tagPreparation!.admissions![tag.id].changeId;
  await h.app.invoke('undo',{id:changeId});assert.ok(!state.tags.some(value=>value.id===tag.id));
  const restored=harness(JSON.parse(JSON.stringify(state)));await restored.app.initialize();assert.ok(!restored.app.state.tags.some(value=>value.id===tag.id));assert.equal(restored.modelCalls(),0);assert.equal(restored.nativeWrites(),0);
});

test('optional related links publish when their meanings become ready and never overwrite a later researcher edit',async()=>{
  for(const researcherEdit of [false,true]){
    const state=completedBuild(),h=harness(state);await h.app.initialize();
    const saved=state.tags.find(tag=>tag.name==='proton transport')!,target=state.taxonomyProposal!.tags.find(tag=>tag.name==='electron transport')!;
    assert.deepEqual(saved.relatedIds,[]);if(researcherEdit)saved.description='A new scientific scope written by the researcher.';
    for(const decision of Object.values(state.taxonomyProposal!.machineDecisions??{}))if(decision.tagId===target.id){decision.relation=state.taxonomyProposal!.evidenceSnapshot!.sources[decision.sourceId].name===target.name?'equivalent':'unrelated';decision.origin='researcher';decision.reason='The researcher resolved the intended scope against this exact source.';}
    refreshProposalEvidence(state.taxonomyProposal!);
    const restored=harness(JSON.parse(JSON.stringify(state)));await restored.app.initialize();
    const next=restored.app.state.tags.find(tag=>tag.id===saved.id)!;assert.ok(restored.app.state.tags.some(tag=>tag.id===target.id));
    assert.equal(next.relatedIds?.includes(target.id),!researcherEdit);if(researcherEdit)assert.equal(next.description,saved.description);
    assert.equal(restored.modelCalls(),0);assert.equal(restored.nativeWrites(),0);assert.equal(validState(restored.app.state),true);
  }
});

test('opening an archived meaning choice restores its exact preparation and paid selection without a new request',async()=>{
  const state=completedBuild(),h=harness(state);await h.app.initialize();
  const proposal=structuredClone(state.taxonomyProposal!),preparation=structuredClone(state.tagPreparation!),selection=structuredClone(state.run!.selection!),item=state.reviewItems!.find(item=>item.kind==='definition'&&item.ownerPage==='cleanup')!;
  assert.ok(item);state.preparationHistory=[{id:'archived-review',date:'2026-11-01T00:00:00.000Z',proposal,preparation,spentUSD:0.4}];state.tagSelectionHistory=[{runId:state.run!.id,work:selection}];
  state.taxonomyProposal=null;delete state.tagPreparation;state.run=null;
  const result=await h.app.invoke('open-review-item',{id:item.id});assert.deepEqual(result,{page:'cleanup'});
  assert.equal(state.taxonomyProposal!.id,proposal.id);assert.equal(state.tagPreparation!.id,preparation.id);assert.deepEqual(state.tagPreparation!.admissions,preparation.admissions);assert.equal(fingerprint(state.taxonomyProposal!.evidenceSnapshot),fingerprint(proposal.evidenceSnapshot));assert.equal(state.run!.spentUSD,0.4);assert.equal(state.run!.selection!.automaticRequests,selection.automaticRequests);assert.equal(h.modelCalls(),0);assert.equal(h.nativeWrites(),0);assert.equal(validState(state),true);
});
