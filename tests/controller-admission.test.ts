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
function harness(state:AppState,rejectAdmission=false,policy=false) {
  const snapshots:AppState[]=[];let modelCalls=0,nativeWrites=0;
  const env:ControllerEnvironment={persist:async next=>{if(rejectAdmission&&Object.keys(next.tagPreparation?.admissions??{}).length)throw new Error('Admission state write failed');snapshots.push(structuredClone(next));},host:{list:async()=>structuredClone(Object.values(state.papers)),read:async id=>structuredClone(Object.values(state.papers).find(paper=>paper.itemID===id)??null),readTags:async id=>structuredClone(state.nativeTags[Object.values(state.papers).find(paper=>paper.itemID===id)!.id]),pdfText:async()=>'',apply:async()=>{nativeWrites++;},show:async()=>{},saveSearch:async()=>{}},ai:{hasApiKey:async()=>true,getSession:async()=>({connected:false,sharing:false,accountId:null,email:null,accounts:[]}),completeJson:async()=>{modelCalls++;throw new Error('Completed admission must not dispatch');},testConnection:async()=>{throw new Error('No connection request');},listModels:async()=>[],setApiKey:async()=>{},removeApiKey:async()=>{},signIn:async()=>{throw new Error('No sign in');},cancelSignIn:()=>{},signOut:async()=>({revoked:true}),selectAccount:async()=>{}}};
  if(policy){env.workflowPolicyVersion=1;env.retiredDefinitionIds=new Set(['retired-definition']);}
  return {app:new AppController(state,env),env,snapshots,modelCalls:()=>modelCalls,nativeWrites:()=>nativeWrites};
}

test('new build policy skips ambiguous meanings without blocking validated additions or requesting review',async()=>{
  const state=completedBuild();state.run!.buildPolicyVersion=1;state.run!.sourcePolicyVersion=2;
  const ambiguous=state.taxonomyProposal!.tags.find(tag=>tag.name==='electron transport')!,h=harness(state,false,true);
  await h.app.initialize();
  const saved=state.tags.find(tag=>tag.name==='proton transport')!;assert.ok(saved);
  assert.ok(!state.tags.some(tag=>tag.id===ambiguous.id));assert.equal(state.tagPreparation!.status,'ready');assert.deepEqual(state.tagPreparation!.questions,[]);
  assert.ok(state.tagPreparation!.skippedTagIds!.includes(ambiguous.id));assert.equal((state.reviewItems??[]).filter(item=>item.state!=='resolved'&&item.kind==='definition').length,0);
  assert.equal(h.modelCalls(),0);assert.equal(h.nativeWrites(),0);assert.equal(state.run!.spentUSD,0.4);
  const origin=state.definitionOrigins![saved.id];assert.equal(origin.kind,'ai-build');assert.equal(origin.workId,state.taxonomyProposal!.id);assert.equal(origin.creationFingerprint,fingerprint(saved));
  assert.ok(h.snapshots.some(snapshot=>snapshot.tags.some(tag=>tag.id===saved.id)&&snapshot.definitionOrigins?.[saved.id]&&snapshot.tagPreparation?.admissions?.[saved.id]));
  const paid=state.run!.spentUSD,history=state.history.length;await h.app.invoke('resume');await h.app.waitForIdle();assert.equal(h.modelCalls(),0);assert.equal(state.run!.spentUSD,paid);assert.equal(state.history.length,history);
  const original=structuredClone(origin);await h.app.invoke('save-tag',{tag:{...saved,name:'proton conduction',description:'A corrected scope for proton conduction.'}});
  assert.deepEqual(state.definitionOrigins![saved.id],original);assert.equal(validState(state),true);
});

test('build completion is checkpointed only after supported definitions and the final result are durable',async()=>{
  for(const failure of ['none','admission','completion'] as const){
    const state=completedBuild();state.tags=[];state.run!.status='paused';state.run!.buildPolicyVersion=1;state.run!.sourcePolicyVersion=2;
    state.run!.selectionInputFingerprint=fingerprint({protocolVersion:2,facts:Object.values(state.facts).sort((a,b)=>a.paperId.localeCompare(b.paperId)),existing:[],limit:state.settings.coreConceptLimit??60,baseVersion:state.vocabularyVersion});
    const h=harness(state,failure==='admission',true),persist=h.env.persist;let failed=false;
    h.env.persist=async next=>{if(failure==='completion'&&!failed&&next.run?.status==='idle'){failed=true;throw new Error('Final completion checkpoint failed');}await persist(next);h.app.state=next;};
    await h.app.invoke('resume');await h.app.waitForIdle();
    const idle=h.snapshots.filter(snapshot=>snapshot.run?.status==='idle');
    if(failure==='none'){assert.equal(state.run!.status,'idle',state.run!.message);assert.equal(idle.length,1);assert.equal(idle[0].tags.length,1);assert.equal(Object.keys(idle[0].tagPreparation!.admissions!).length,1);assert.match(idle[0].run!.message,/1 tag saved/);}
    else{assert.equal(state.run!.status,'paused',state.run!.message);assert.equal(idle.length,0);assert.match(state.run!.message,/state write failed|completion checkpoint failed/i);}
    assert.equal(h.modelCalls(),0);assert.equal(h.nativeWrites(),0);
  }
});

test('retired workflow commands and manual creation cannot restart through the kernel',async()=>{
  const state=completedBuild(),h=harness(state,false,true);
  for(const action of ['prepare-tag-meanings','use-proposed-tag-meaning','create-detail','import-vocabulary','compare-diy-tags','refresh-existing-tags','merge-tag-shelves'])await assert.rejects(h.app.invoke(action,{}),/Use Build tags/);
  await assert.rejects(h.app.invoke('save-tag',{tag:{id:'not-a-saved-tag',name:'manual',description:'Manual tag'}}),/Use Build tags/);
  assert.equal(h.modelCalls(),0);assert.equal(h.nativeWrites(),0);
});

test('full replacement skips ambiguous candidates but waits for explicit change review before saving',async()=>{
  const state=completedBuild(),old={...state.tags[0],id:'old-ai-definition',status:'approved' as const,custom:false};
  state.tags=[old];state.taxonomyReady=true;state.run!.buildMode='replace';state.run!.buildPolicyVersion=1;state.run!.sourcePolicyVersion=2;delete state.run!.processingPolicy;
  const h=harness(state,false,true);await h.app.initialize();assert.deepEqual(state.tags,[old]);
  const before=h.app.workerViews();assert.equal(before.buildResult!.requiresChangeReview,true);assert.equal(before.buildResult!.savedCount,0);assert.equal(before.buildResult!.skippedCount,1);assert.equal(before.tagPreparation!.tags.length,1);
  await h.app.invoke('apply-tag-list',{id:state.tagPreparation!.id});
  assert.deepEqual(state.tags.map(tag=>tag.name),['proton transport']);assert.equal(h.modelCalls(),0);assert.equal(h.nativeWrites(),0);
  const after=h.app.workerViews();assert.equal(after.buildResult!.savedCount,1);assert.equal(after.buildResult!.skippedCount,1);assert.equal(after.buildResult!.requiresChangeReview,undefined);
});

test('Undo preflight blocks restoration of retired definitions before any native write',async()=>{
  const state=completedBuild(),paper=Object.values(state.papers)[0],retired={...state.tags[0],id:'retired-definition',name:'Earlier personal meaning'};
  state.history.unshift({id:'mixed-retired-change',date:new Date().toISOString(),label:'Earlier work',status:'applied',patches:[{paperId:paper.id,itemID:paper.itemID,before:[],after:state.nativeTags[paper.id]}],beforeDefinitions:{[retired.id]:retired},afterDefinitions:{[retired.id]:null},beforeOwnership:{},afterOwnership:{},suggestionIds:[]});
  const h=harness(state,false,true);await assert.rejects(h.app.invoke('undo',{id:'mixed-retired-change'}),/retired tag definition/);assert.equal(h.nativeWrites(),0);assert.equal(state.history[0].status,'applied');
});

test('stale retired suggestions cannot become remembered rejections or native writes',async()=>{
  const state=completedBuild(),paper=Object.values(state.papers)[0],h=harness(state,false,true);
  state.suggestions.push({id:'withdrawn-earlier-match',paperId:paper.id,tagId:state.tags[0].id,reason:'Earlier source policy.',confidence:'high',match:'substantive',status:'rejected',autoEligible:true,evidence:[{source:'abstract',text:paper.abstract}],inputFingerprint:paper.fingerprint,vocabularyVersion:state.vocabularyVersion,retiredByPolicy:1});
  for(const action of ['accept-suggestion','reject-suggestion'])await assert.rejects(h.app.invoke(action,{id:'withdrawn-earlier-match'}),/retired tag workflow/);
  assert.deepEqual(state.decisions,{});assert.equal(h.nativeWrites(),0);assert.equal(h.modelCalls(),0);
});

test('scanning does not resurrect cached label-derived keywords or their summaries',async()=>{
  const state=completedBuild(),paper=Object.values(state.papers)[0],h=harness(state,false,true),native=structuredClone(paper);
  paper.keywords=['important'];paper.summary='A summary from the old label context.';paper.concepts=['important'];paper.fingerprint=paperFingerprint(paper);
  // The host adapter now supplies scientific metadata without native tag keywords.
  h.env.host.list=async()=>[structuredClone(native)];await h.app.invoke('scan',{scope:'selected'});
  assert.deepEqual(state.papers[paper.id].keywords,[]);assert.equal(state.papers[paper.id].summary,'');assert.deepEqual(state.papers[paper.id].concepts,[]);assert.equal(h.modelCalls(),0);
});

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
