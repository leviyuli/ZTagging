import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import type {NativeTag} from '../src/platform.ts';
import {createAssignmentRun} from '../src/assignment-review.ts';
import {createRegistrySnapshot} from '../src/evidence.ts';
import {createTaxonomyProposal,normalizeFacts} from '../src/taxonomy.ts';
import {prepare} from '../src/tag-preparation.ts';
import {createNativeTagDefinitionWork,nextNativeTagDefinitionRequests,noteNativeTagDefinitionDispatch,acceptNativeTagDefinitionResult} from '../src/native-tag-definition.ts';
import {migrateTagShelves,MY_TAGS_SHELF_ID} from '../src/tag-shelves.ts';

const copy=<T>(value:T):T=>structuredClone(value);
const definition=(id:string,name=id):TagDefinition=>({id,name,fullName:name,description:`Scientific study of ${name}.`,facet:'phenomenon',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],status:'approved',custom:false,matchingMode:'auto'});
function fixture() {
  const state=initialState();state.tags=[definition('transport','proton transport'),definition('manual','Manual choice')];state.taxonomyReady=true;state.vocabularyVersion=2;
  const native:Record<string,NativeTag[]>={};
  for(let itemID=1;itemID<=2;itemID++){
    const paper:PaperRecord={id:`1:TASK-${itemID}`,itemID,libraryID:1,key:`TASK-${itemID}`,title:`Transport experiment ${itemID}`,abstract:`The experiment measured proton transport through membrane sample ${itemID}.`,keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);state.papers[paper.id]=paper;native[paper.id]=[{tag:'Manual project',type:0}];state.nativeTags[paper.id]=copy(native[paper.id]);
  }
  let modelCalls=0;const writes:string[][]=[];
  const env:ControllerEnvironment={persist:async()=>{},host:{list:async()=>copy(Object.values(state.papers)),read:async id=>copy(Object.values(state.papers).find(paper=>paper.itemID===id)??null),readTags:async id=>copy(native[`1:TASK-${id}`]??[]),pdfText:async()=>'',apply:async patches=>{writes.push(patches.map(patch=>patch.paperId));for(const patch of patches){assert.deepEqual(native[patch.paperId],patch.before);native[patch.paperId]=copy(patch.after);}},show:async()=>{},saveSearch:async()=>{}},ai:{hasApiKey:async()=>true,getSession:async()=>({connected:false,sharing:false,accountId:null,email:null,accounts:[]}),completeJson:async()=>{modelCalls++;throw new Error('Undo metadata must not dispatch');},testConnection:async()=>{throw new Error('No connection request');},listModels:async()=>[],setApiKey:async()=>{},removeApiKey:async()=>{},signIn:async()=>{throw new Error('No sign in');},cancelSignIn:()=>{},signOut:async()=>({revoked:true}),selectAccount:async()=>{}}};
  return {state,native,writes,app:new AppController(state,env),modelCalls:()=>modelCalls};
}
function assignment(h:ReturnType<typeof fixture>,id:string,itemID:number) {
  const paper=h.state.papers[`1:TASK-${itemID}`],suggestionId=`suggestion-${id}`;
  (h.state.assignmentRuns??=[]).push({...createAssignmentRun({id,paperIds:[paper.id],vocabularyVersion:2,processingPolicy:'auto-clear'}),jobs:[{paperId:paper.id,status:'completed'}],scope:'selected',automatic:false});
  h.state.suggestions.push({id:suggestionId,runId:id,paperId:paper.id,tagId:'transport',reason:'This exact source establishes membrane proton transport.',confidence:'high',status:'accepted',match:'substantive',autoEligible:true,inputFingerprint:paper.fingerprint,vocabularyVersion:2,evidence:[{source:'abstract',text:paper.abstract}]});
  return suggestionId;
}
const unrelated=(id:string,overrides:Partial<AppState['history'][number]>={}):AppState['history'][number]=>({id,date:'2026-11-01T00:00:00.000Z',label:'An unrelated change',patches:[],beforeOwnership:{},afterOwnership:{},suggestionIds:[],status:'applied',...overrides});

test('assignment snapshots expose only their own applied batch and Undo leaves newer unrelated work intact',async()=>{
  const h=fixture(),one=assignment(h,'run-one',1),two=assignment(h,'run-two',2);
  await h.app.invoke('apply-suggestions',{ids:[one]});const first=h.state.history[0];assert.equal(first.taskId,'run-one');
  await h.app.invoke('apply-suggestions',{ids:[two]});const second=h.state.history[0];assert.equal(second.taskId,'run-two');
  await h.app.invoke('assign-detail',{tagId:'manual',itemIDs:[2]});assert.equal(h.state.history[0].taskId,undefined);
  const view=await h.app.snapshot();assert.equal(view.assignmentReviews!.find(review=>review.id==='run-one')!.lastChangeId,first.id);assert.equal(view.assignmentReviews!.find(review=>review.id==='run-two')!.lastChangeId,second.id);
  await h.app.invoke('undo',{id:view.assignmentReviews!.find(review=>review.id==='run-one')!.lastChangeId});
  assert.deepEqual(h.native['1:TASK-1'],[{tag:'Manual project',type:0}]);assert.ok(h.native['1:TASK-2'].some(tag=>tag.tag==='proton transport'));assert.ok(h.native['1:TASK-2'].some(tag=>tag.tag==='Manual choice'));
  const after=await h.app.snapshot();assert.equal(after.assignmentReviews!.find(review=>review.id==='run-one')!.lastChangeId,undefined);assert.equal(after.assignmentReviews!.find(review=>review.id==='run-two')!.lastChangeId,second.id);assert.ok(h.state.history[0].undoOfId);assert.equal(h.modelCalls(),0);
});

test('the exact task Undo refuses conflicting later manual paper edits',async()=>{
  const h=fixture(),id=assignment(h,'run-one',1);await h.app.invoke('apply-suggestions',{ids:[id]});
  const changeId=(await h.app.snapshot()).assignmentReview!.lastChangeId!;assert.ok(changeId);h.native['1:TASK-1'].push({tag:'A later researcher edit',type:0});
  await assert.rejects(h.app.invoke('undo',{id:changeId}),/Later tag edits conflict/);assert.ok(h.native['1:TASK-1'].some(tag=>tag.tag==='proton transport'));assert.ok(h.native['1:TASK-1'].some(tag=>tag.tag==='A later researcher edit'));assert.equal(h.state.history.find(change=>change.id===changeId)!.status,'applied');
});

test('legacy assignment fallback requires every journal suggestion to prove the same run and ignores undo journals',async()=>{
  const h=fixture(),one=assignment(h,'run-one',1),two=assignment(h,'run-two',2);
  h.state.history=[unrelated('global'),unrelated('undo-replay',{taskId:'run-one',undoOfId:'old'}),unrelated('different-owner',{taskId:'run-two',suggestionIds:[one]}),unrelated('mixed-runs',{suggestionIds:[one,two]}),unrelated('missing-proof',{suggestionIds:[one,'unknown']}),unrelated('legacy-one',{suggestionIds:[one]}),unrelated('legacy-two',{suggestionIds:[two]})];
  const view=await h.app.snapshot();assert.equal(view.assignmentReviews!.find(review=>review.id==='run-one')!.lastChangeId,'legacy-one');assert.equal(view.assignmentReviews!.find(review=>review.id==='run-two')!.lastChangeId,'different-owner');
  h.state.suggestions=h.state.suggestions.filter(suggestion=>suggestion.id!==one);assert.equal((await h.app.snapshot()).assignmentReviews!.find(review=>review.id==='run-one')!.lastChangeId,undefined);
});

test('generated definition admission records the proposal identity instead of choosing a global history change',async()=>{
  const h=fixture(),paper=h.state.papers['1:TASK-1'],facts=normalizeFacts({summary:'The experiment measured membrane proton transport.',needsPDF:false,concepts:[{name:'proton transport',facet:'phenomenon',evidence:[{source:'abstract',text:paper.abstract}]}]},paper,'retained','retained');
  h.state.tags=[];h.state.taxonomyReady=false;h.state.facts[paper.id]=facts;const snapshot=createRegistrySnapshot([facts],h.state.evidenceCatalog),proposal=createTaxonomyProposal({tags:[{key:'transport',name:'proton transport',fullName:'proton transport',description:'Scientific study of proton transport.',facet:'phenomenon',supportRegistryIds:Object.keys(snapshot.entries)}]},[facts],[],{snapshot,baseVersion:2}),prepared=prepare(proposal,undefined,{processingPolicy:'auto-clear'});
  h.state.taxonomyProposal=prepared.proposal;h.state.tagPreparation=prepared.state;h.state.tagShelves=migrateTagShelves([]);h.state.run={id:'build-worker',kind:'rebuild',scope:'selected',automatic:false,processingPolicy:'auto-clear',status:'idle',jobs:[{id:'job',paperId:paper.id,status:'completed'}],vocabCursor:1,vocabFinished:true,message:'Ready.',spentUSD:0.4,settings:copy(h.state.settings),vocabularyVersion:2};
  await h.app.initialize();const change=h.state.history[0];assert.equal(change.taskId,proposal.id);assert.notEqual(change.taskId,prepared.state.id);
  h.state.history.unshift(unrelated('newer-global'));assert.equal((await h.app.snapshot()).tagPreparation!.lastChangeId,change.id);assert.equal(validState(h.state),true);assert.equal(h.modelCalls(),0);
});

test('native meaning journals expose the work identity for automatic and earlier explicit saves',async()=>{
  for(const automatic of [false,true]){
    const h=fixture(),paper=h.state.papers['1:TASK-1'];h.native[paper.id].push({tag:'native transport',type:0});h.state.nativeTags[paper.id]=copy(h.native[paper.id]);h.state.tagShelves=migrateTagShelves(h.state.tags);
    let work=createNativeTagDefinitionWork({papers:[paper],nativeTags:h.state.nativeTags,definitions:h.state.tags,facts:{},decisions:{},vocabularyVersion:2,applied:true},['native transport']);
    const request=nextNativeTagDefinitionRequests(work)[0],data=JSON.parse(request.prompt.split('INPUT_DATA_JSON:\n')[1]);work=acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(work,request.id),request.id,{workId:data.workId,fingerprint:data.fingerprint,taskId:data.taskId,definitions:[{entryId:data.entries[0].entryId,targetTagId:'transport'}],judgments:data.papers.map((source:any)=>({entryId:source.entryId,paperId:source.paperId,sourceFingerprint:source.sourceFingerprint,relation:'same-meaning',reason:'The paper studies the exact saved transport meaning.',evidence:[{source:'abstract',text:paper.abstract}]}))});assert.equal(work.status,'ready');
    h.state.nativeDefinitionPreparation={work,taskId:'meaning-worker',shelfId:MY_TAGS_SHELF_ID,appliedEntryIds:[],...(automatic?{processingPolicy:'auto-clear' as const}:{})};
    if(automatic)await h.app.initialize();else await h.app.invoke('apply-tag-meanings',{id:work.id});
    const change=h.state.history[0];assert.equal(change.taskId,work.id);h.state.history.unshift(unrelated('newer-global'));
    assert.equal((await h.app.snapshot()).nativeDefinitionPreparation!.lastChangeId,change.id);assert.equal(h.modelCalls(),0);assert.equal(h.writes.length,0);assert.equal(validState(h.state),true);
  }
});

test('task ownership is optional for old journals and rejects malformed supplied identities',()=>{
  const h=fixture();h.state.history=[unrelated('old')];assert.equal(validState(h.state),true);
  for(const taskId of ['',42,null]){const state=copy(h.state);(state.history[0] as any).taskId=taskId;assert.equal(validState(state),false);}
  h.state.history[0].taskId='exact-task';assert.equal(validState(h.state),true);
});
