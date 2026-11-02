import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import type {TagPatch} from '../src/platform.ts';
import {acceptNativeTagDefinitionResult,createNativeTagDefinitionWork,nextNativeTagDefinitionRequests,noteNativeTagDefinitionDispatch,resolveNativeTagDefinition,validNativeTagDefinitionWork} from '../src/native-tag-definition.ts';
import {matchConceptFilter} from '../src/concept-filter.ts';
import {MY_TAGS_SHELF_ID,migrateTagShelves} from '../src/tag-shelves.ts';

const clone=<T>(value:T):T=>structuredClone(value);
const SOURCE='Fuel cells',ABSTRACT='Fuel cells convert chemical energy into electricity through electrochemical reactions.';
const personalDefinition:TagDefinition={id:'personal-priority',name:'Important',description:'A personal priority label.',facet:'phenomenon',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],custom:false,status:'approved',matchingMode:'auto'};
type AIInput={paper:PaperRecord;approvedVocabulary:{id:string}[]};

function fixture(saved?:AppState,policy:1|null=1){
  const state=saved??initialState();
  if(!saved){
    state.tags=[clone(personalDefinition)];state.nativeTagTreatments={important:'personal'};state.taxonomyReady=true;state.tagShelves=migrateTagShelves(state.tags);
    Object.assign(state.settings,{provider:'deepseek',model:'synthetic-admission-model',budgetUSD:10,inputPricePerMillion:1,outputPricePerMillion:1,maxOutputTokens:4096,autoAssign:false});
    for(let index=0;index<16;index++){
      const key=`MEANING-${String(index).padStart(2,'0')}`,paper:PaperRecord={id:`1:${key}`,key,itemID:100+index,libraryID:1,title:`Synthetic source ${index}`,abstract:index===2?'Thermochemical catalysis was studied; fuel cells occur only in the keywords.':ABSTRACT,keywords:[],fingerprint:''};
      paper.fingerprint=paperFingerprint(paper);state.papers[paper.id]=paper;state.nativeTags[paper.id]=[{tag:SOURCE,type:0},{tag:'Important',type:0}];
      if(index<5)state.nativeTags[paper.id].push({tag:'FC',type:0});
      if(index===2||index===3)state.nativeTags[paper.id].push({tag:'fuel cell',type:0},{tag:'electrochemical fuel cell',type:0});
    }
    const input={papers:clone(Object.values(state.papers)),nativeTags:clone(state.nativeTags),definitions:clone(state.tags),facts:{},decisions:{},vocabularyVersion:state.vocabularyVersion,applied:false};
    let work=createNativeTagDefinitionWork(input,[SOURCE],{maxOutputTokens:25000,...(policy?{selectionPolicyVersion:policy}:{})});
    const request=nextNativeTagDefinitionRequests(work)[0],incoming=JSON.parse(request.prompt.split('INPUT_DATA_JSON:\n')[1]),entryId=work.entries[0].id;
    assert.equal(incoming.papers.length,3);assert.equal(work.entries[0].paperIds.length,16);
    work=acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(work,request.id),request.id,{workId:work.id,fingerprint:work.fingerprint,taskId:request.id,definitions:[{entryId,name:'FC',fullName:'fuel cell',description:ABSTRACT,facet:'system',aliases:[SOURCE,'electrochemical fuel cell'],resolution:'ambiguous',question:'Use this proposed scientific meaning or skip defining the native tag.',questionKind:'meaning'}],judgments:incoming.papers.slice(0,3).map((paper:any,index:number)=>({entryId,paperId:paper.paperId,sourceFingerprint:paper.sourceFingerprint,relation:index===2?'different':'same-meaning',reason:index===2?'The native label is incidental to a thermochemical catalysis study.':'The abstract establishes the fuel-cell scientific meaning.',evidence:[{source:'abstract',text:paper.paper.abstract}],supportFactConceptIds:[]}))},{provider:'deepseek',model:'retained-paid-model'});
    assert.equal(validNativeTagDefinitionWork(work),true);assert.equal(work.status,'ready');assert.equal(work.entries[0].status,'question');assert.equal(Object.keys(work.entries[0].judgments).length,3);
    state.nativeDefinitionPreparation={work,taskId:'meaning-task',shelfId:MY_TAGS_SHELF_ID,appliedEntryIds:[],processingPolicy:'auto-clear'};
    state.maintenanceTasks=[{id:'meaning-task',kind:'define-native',status:'completed',cursor:1,createdAt:'2026-11-01T00:00:00Z',groupIds:[],paperIds:Object.keys(state.papers),definitionWorkId:work.id,run:{id:'meaning-run',kind:'rebuild',scope:'selected',automatic:false,processingPolicy:'auto-clear',status:'idle',jobs:Object.keys(state.papers).map(paperId=>({id:`job-${paperId}`,paperId,status:'completed'})),vocabCursor:1,vocabFinished:true,message:'A proposal is ready.',spentUSD:0.37,settings:clone(state.settings),vocabularyVersion:state.vocabularyVersion}}];
  }
  const native=clone(state.nativeTags),calls:AIInput[]=[],writes:TagPatch[][]=[],saves:AppState[]=[];
  let selected=Object.keys(state.papers),handler:(input:AIInput)=>unknown=()=>{throw new Error('No provider request is expected.');},failAdmission=false;
  const env:ControllerEnvironment={host:{async list(scope){return clone(Object.values(state.papers).filter(paper=>scope!=='selected'||selected.includes(paper.id)));},async read(itemID){return clone(Object.values(state.papers).find(paper=>paper.itemID===itemID)??null);},async readTags(itemID){const paper=Object.values(state.papers).find(paper=>paper.itemID===itemID)!;return clone(native[paper.id]??[]);},async pdfText(){return '';},async apply(patches){writes.push(clone(patches));for(const patch of patches){assert.deepEqual(native[patch.paperId],patch.before);native[patch.paperId]=clone(patch.after);}},async show(){},async saveSearch(){}},librarySnapshot:async()=>({papers:clone(Object.values(state.papers)),nativeTags:clone(native)}),persist:async next=>{if(failAdmission&&next.history.some(change=>change.label==='Save AI tag meanings'))throw new Error('Synthetic admission persistence failure');saves.push(clone(next));},ai:{async hasApiKey(){return true;},async getSession(){return {connected:false,sharing:false,email:null,accountId:null,accounts:[]};},async completeJson(_system,prompt){const input=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]) as AIInput;calls.push(clone(input));const value=handler(input);return {value,text:JSON.stringify(value),usage:{inputTokens:20,outputTokens:20},usageKnown:true,estimatedCostUSD:0.001};},async testConnection(){throw new Error('No connection test expected');},async listModels(){return [];},async setApiKey(){},async removeApiKey(){},async signIn(){throw new Error('No sign-in expected');},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}}};
  const app=new AppController(state,env);
  return {state,app,env,native,calls,writes,saves,select:(ids:string[])=>{selected=ids;},respond:(next:typeof handler)=>{handler=next;},failAdmission:()=>{failAdmission=true;}};
}

async function useMeaning(h:ReturnType<typeof fixture>){
  await h.app.initialize();const review=h.state.nativeDefinitionPreparation!,entry=review.work.entries[0];
  await h.app.invoke('use-proposed-tag-meaning',{id:review.work.id,entryId:entry.id});await h.app.waitForIdle();
  return h.state.nativeDefinitionPreparation!.work.entries[0].meaningAdmission!;
}

test('using a supported AI meaning saves its concept without requiring all sixteen native-paper bindings',async()=>{
  const h=fixture(),before=clone(h.state.nativeDefinitionPreparation!.work),native=clone(h.native),marker=await useMeaning(h),review=h.state.nativeDefinitionPreparation!,entry=review.work.entries[0],saved=h.state.tags.find(tag=>tag.id===marker.tagId)!;
  assert.ok(marker);assert.equal(marker.bindingVerified,false);assert.equal(marker.candidateFingerprint,fingerprint(before.entries[0].definition));assert.equal(marker.definitionFingerprint,fingerprint(saved));assert.equal(saved.name,'FC');assert.equal(saved.aliases.includes(SOURCE),false);
  assert.deepEqual(entry.judgments,before.entries[0].judgments);assert.deepEqual(review.work.snapshot,before.snapshot);assert.deepEqual(review.work.tasks.map(task=>task.attempts),before.tasks.map(task=>task.attempts));assert.equal(nextNativeTagDefinitionRequests(review.work).length,0);assert.equal(h.state.maintenanceTasks![0].run.spentUSD,0.37);
  assert.equal(Object.values(entry.judgments).filter(proof=>proof.relation==='same-meaning').length,2);assert.equal(Object.values(entry.judgments).filter(proof=>proof.relation==='different').length,1);assert.equal(entry.paperIds.length-Object.keys(entry.judgments).length,13);
  assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);assert.deepEqual(h.native,native);assert.ok(h.state.reviewItems!.every(item=>item.workId!==review.work.id||item.state==='resolved'));assert.equal(validState(h.state),true);
});

test('a new clear scientific proposal is selected and saved after its initial sample without thirteen further AI checks',async()=>{
  const h=fixture(undefined,null);await h.app.initialize();
  h.respond(raw=>{const input=raw as unknown as {workId:string;fingerprint:string;taskId:string;phase:string;entries:{entryId:string}[];papers:{entryId:string;paperId:string;sourceFingerprint:string;paper:{abstract:string}}[]};assert.equal(input.phase,'draft','Concept admission must stop the unneeded full-name binding checks.');return {workId:input.workId,fingerprint:input.fingerprint,taskId:input.taskId,definitions:input.entries.map(entry=>({entryId:entry.entryId,name:'FC',fullName:'fuel cell',description:ABSTRACT,facet:'system',aliases:[],resolution:'clear'})),judgments:input.papers.map((paper,index)=>({entryId:paper.entryId,paperId:paper.paperId,sourceFingerprint:paper.sourceFingerprint,relation:index===2?'uncertain':'same-meaning',reason:index===2?'This source does not establish the scientific system.':'This abstract directly establishes the fuel-cell system.',evidence:[{source:'abstract',text:paper.paper.abstract}],supportFactConceptIds:[]}))};});
  await h.app.invoke('prepare-tag-meanings',{names:[SOURCE],shelfId:MY_TAGS_SHELF_ID,processingPolicy:'auto-clear'});await h.app.waitForIdle();
  const review=h.state.nativeDefinitionPreparation!,entry=review.work.entries[0],view=await h.app.snapshot();assert.equal(review.work.selectionPolicyVersion,1);assert.ok(entry.automaticAnswer);assert.equal(entry.humanAnswer,undefined);assert.ok(entry.meaningAdmission);assert.equal(view.nativeDefinitionPreparation!.savedCount,1);assert.equal(h.calls.length,1);assert.equal(h.writes.length,0);assert.equal(nextNativeTagDefinitionRequests(review.work).length,0);assert.equal(Object.keys(entry.judgments).length,3);assert.equal(validState(h.state),true);
});

test('concept admission masks unsupported exact labels while the native-name inventory opens the saved definition',async()=>{
  const h=fixture(),marker=await useMeaning(h),view=await h.app.snapshot(),definition=view.tags.find(tag=>tag.id===marker.tagId)!,ids=Object.keys(h.state.papers),masks=h.state.nativeBindingExclusions![marker.tagId];
  assert.equal(definition.currentlyTaggedCount,2);assert.deepEqual(masks[ids[2]].sort(),['FC','electrochemical fuel cell','fuel cell']);assert.deepEqual(masks[ids[3]].sort(),['FC','electrochemical fuel cell','fuel cell']);assert.deepEqual(masks[ids[4]],['FC']);assert.equal(masks[ids[0]],undefined);assert.equal(masks[ids[1]],undefined);
  const filter={mode:'all' as const,selections:[{conceptId:marker.tagId}]};
  assert.deepEqual(ids.filter(id=>matchConceptFilter(h.native[id].map(tag=>tag.tag),view.tags,filter,id)),ids.slice(0,2));
  assert.equal(view.tagLibraryEntries!.find(entry=>entry.name===SOURCE)!.tagId,marker.tagId);assert.ok(view.tagShelves!.some(shelf=>shelf.nativeNames?.some(entry=>entry.name===SOURCE&&entry.tagId===marker.tagId)));
  assert.equal(view.nativeDefinitionPreparation!.rows[0].applied,true);assert.equal(view.nativeDefinitionPreparation!.rows[0].bindingVerified,false);assert.equal(view.nativeDefinitionPreparation!.savedCount,1);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
});

test('saved concepts survive restart without duplicate admission and Undo restores definitions and binding masks',async()=>{
  const h=fixture(),beforeTags=clone(h.state.tags),marker=await useMeaning(h),saved=clone(h.state),restored=fixture(saved);await restored.app.initialize();await restored.app.waitForIdle();
  assert.equal(restored.state.history.filter(change=>change.label==='Save AI tag meanings').length,1);assert.equal(restored.state.tags.filter(tag=>tag.id===marker.tagId).length,1);assert.equal(restored.calls.length,0);assert.equal(restored.writes.length,0);
  await restored.app.invoke('undo',{id:marker.changeId});assert.deepEqual(restored.state.tags,beforeTags);assert.equal(Object.values(restored.state.nativeBindingExclusions??{}).some(papers=>Object.values(papers).some(names=>names.length)),false);
  const undone=await restored.app.snapshot();assert.equal(undone.nativeDefinitionPreparation!.savedCount,0);assert.equal(undone.nativeDefinitionPreparation!.rows[0].applied,false);
  const again=fixture(clone(restored.state));await again.app.initialize();await again.app.waitForIdle();assert.deepEqual(again.state.tags,beforeTags);assert.equal(again.calls.length,0);assert.equal(again.writes.length,0);assert.equal(validState(again.state),true);
});

test('admission persistence failure leaves both scientific definitions and native binding masks unchanged',async()=>{
  const h=fixture();await h.app.initialize();const tags=clone(h.state.tags),masks=clone(h.state.nativeBindingExclusions),review=h.state.nativeDefinitionPreparation!,entryId=review.work.entries[0].id;h.failAdmission();
  await assert.rejects(h.app.invoke('use-proposed-tag-meaning',{id:review.work.id,entryId}),/Synthetic admission persistence failure/);assert.deepEqual(h.state.tags,tags);assert.deepEqual(h.state.nativeBindingExclusions,masks);assert.equal(h.state.nativeDefinitionPreparation!.work.entries[0].meaningAdmission,undefined);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);assert.equal(validState(h.state),true);
});

test('legacy automatic preparations do not silently opt old human answers into partial meaning admission',async()=>{
  const h=fixture(undefined,null),review=h.state.nativeDefinitionPreparation!,entry=review.work.entries[0];
  review.work=resolveNativeTagDefinition(review.work,review.work.snapshot,{entryId:entry.id,definition:clone(entry.definition!),preserveUncertainty:true});
  assert.equal(review.work.selectionPolicyVersion,undefined);assert.equal(review.work.entries[0].humanAnswer!.meaningAdmissionPolicy,undefined);
  const tags=clone(h.state.tags);await h.app.initialize();await h.app.waitForIdle();assert.deepEqual(h.state.tags,tags);assert.equal(review.work.entries[0].meaningAdmission,undefined);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);assert.equal(validState(h.state),true);
});

test('positive AI assignment clears only its masked pair and preserves manual native ownership',async()=>{
  const h=fixture(),marker=await useMeaning(h),paperId=Object.keys(h.state.papers)[4],before=clone(h.native[paperId]),masks=clone(h.state.nativeBindingExclusions![marker.tagId]);h.select([paperId]);
  h.respond(input=>({summary:'A substantive fuel-cell experiment.',concepts:[],needsPDF:false,suggestions:[{tagId:marker.tagId,reason:'This paper studies the electrochemical fuel-cell system directly.',confidence:'high',match:'substantive',evidence:[{source:'abstract',text:input.paper.abstract}]}],newTagCandidates:[]}));
  await h.app.invoke('tag',{scope:'selected',processingPolicy:'auto-clear'});await h.app.waitForIdle();
  assert.equal(h.calls.length,1);assert.deepEqual(h.native[paperId],before);assert.equal(h.writes.length,0);assert.equal(h.state.ownership[paperId]?.[marker.tagId],undefined);assert.equal(h.state.nativeBindingExclusions![marker.tagId][paperId]?.includes('FC')??false,false);
  delete masks[paperId];const remaining=clone(h.state.nativeBindingExclusions![marker.tagId]);delete remaining[paperId];assert.deepEqual(remaining,masks);assert.equal(h.calls[0].approvedVocabulary.some(tag=>tag.id===personalDefinition.id),false);assert.equal(validState(h.state),true);
  const verified=h.state.history.find(change=>change.id!==marker.changeId&&change.afterNativeBindings?.[marker.tagId]&&Object.hasOwn(change.afterNativeBindings[marker.tagId],paperId));assert.ok(verified);await h.app.invoke('undo',{id:verified.id});assert.deepEqual(h.native[paperId],before);assert.equal(h.state.ownership[paperId]?.[marker.tagId],undefined);assert.deepEqual(h.state.nativeBindingExclusions![marker.tagId][paperId],['FC']);assert.equal(h.writes.length,0);assert.equal(validState(h.state),true);
});

test('a personal Important label does not prevent another scientific tag from being assigned to that paper',async()=>{
  const h=fixture(),marker=await useMeaning(h),paperId=Object.keys(h.state.papers)[15];h.select([paperId]);h.respond(input=>({summary:'A substantive fuel-cell experiment.',concepts:[],needsPDF:false,suggestions:[{tagId:marker.tagId,reason:'The abstract establishes this scientific system.',confidence:'high',match:'substantive',evidence:[{source:'abstract',text:input.paper.abstract}]}],newTagCandidates:[]}));
  await h.app.invoke('tag',{scope:'selected',processingPolicy:'auto-clear'});await h.app.waitForIdle();assert.equal(h.calls.length,1);assert.ok(h.native[paperId].some(tag=>tag.tag==='Important'));assert.ok(h.native[paperId].some(tag=>tag.tag==='FC'));assert.ok(!h.native[paperId].some(tag=>tag.tag==='no_tag'));assert.equal(h.calls[0].approvedVocabulary.some(tag=>tag.id===personalDefinition.id),false);assert.equal(h.writes.length,1);assert.equal(validState(h.state),true);
});

async function pendingBindingBatch(){
  const h=fixture(),marker=await useMeaning(h),paperIds=Object.keys(h.state.papers).slice(2,5),changeId='interrupted-validated-bindings';
  const patches=paperIds.map(paperId=>{const paper=h.state.papers[paperId],before=h.native[paperId].filter(tag=>tag.tag!=='FC');h.native[paperId]=clone(before);h.state.nativeTags[paperId]=clone(before);return {paperId,itemID:paper.itemID,before:clone(before),after:[...clone(before),{tag:'FC',type:1 as const}]};});
  const masks=clone(h.state.nativeBindingExclusions!),beforeNativeBindings={[marker.tagId]:Object.fromEntries(paperIds.map(id=>[id,clone(masks[marker.tagId][id])]))},afterNativeBindings={[marker.tagId]:Object.fromEntries(paperIds.map(id=>[id,null]))};
  h.state.pendingChange={id:changeId,date:'2026-11-01T01:00:00Z',label:'Automatic tag assignments',patches,beforeNativeBindings,afterNativeBindings,beforeOwnership:Object.fromEntries(paperIds.map(id=>[id,{}])),afterOwnership:Object.fromEntries(paperIds.map(id=>[id,{[marker.tagId]:{name:'FC',changeId}}])),suggestionIds:[],status:'prepared'};
  assert.equal(validState(h.state),true);return {h,marker,paperIds,patches,masks,changeId};
}

test('restart recovers fully applied native writes and commits only their validated binding records',async()=>{
  const {h,marker,paperIds,patches,changeId}=await pendingBindingBatch(),foreignPaper=Object.keys(h.state.papers)[15];
  h.state.nativeBindingExclusions![marker.tagId][foreignPaper]=['Unrelated later raw label'];
  for(const patch of patches)h.native[patch.paperId]=clone(patch.after);
  await h.app.initialize();assert.equal(h.state.pendingChange,undefined);assert.equal(h.state.history.find(change=>change.id===changeId)!.status,'applied');
  for(const id of paperIds){assert.equal(h.state.nativeBindingExclusions?.[marker.tagId]?.[id],undefined);assert.deepEqual(h.state.ownership[id][marker.tagId],{name:'FC',changeId});assert.deepEqual(h.state.nativeTags[id],h.native[id]);}
  assert.deepEqual(h.state.nativeBindingExclusions![marker.tagId][foreignPaper],['Unrelated later raw label']);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);assert.equal(validState(h.state),true);
});

test('restart discards an untouched native transaction while retaining all prior binding masks',async()=>{
  const {h,paperIds,patches,masks,changeId}=await pendingBindingBatch();await h.app.initialize();
  assert.equal(h.state.pendingChange,undefined);assert.equal(h.state.history.some(change=>change.id===changeId),false);assert.deepEqual(h.state.nativeBindingExclusions,masks);
  for(const [index,id] of paperIds.entries()){assert.deepEqual(h.native[id],patches[index].before);assert.deepEqual(h.state.ownership[id],{});}
  assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);assert.equal(validState(h.state),true);
});

test('partial native recovery clears only applied unchanged bindings and preserves uncommitted or later choices',async()=>{
  const {h,marker,paperIds,patches,masks,changeId}=await pendingBindingBatch(),[applied,untouched,changed]=paperIds,foreignPaper=Object.keys(h.state.papers)[15];
  h.native[applied]=clone(patches[0].after);h.native[changed]=clone(patches[2].after);
  h.state.nativeBindingExclusions![marker.tagId][changed]=[...masks[marker.tagId][changed],'Later researcher choice'];h.state.nativeBindingExclusions![marker.tagId][foreignPaper]=['Unrelated later raw label'];
  await h.app.initialize();assert.equal(h.state.pendingChange,undefined);assert.equal(h.state.history.find(change=>change.id===changeId)!.status,'conflict');assert.equal(h.state.nativeBindingExclusions![marker.tagId][applied],undefined);
  assert.deepEqual(h.state.nativeBindingExclusions![marker.tagId][untouched],masks[marker.tagId][untouched]);assert.deepEqual(h.state.nativeBindingExclusions![marker.tagId][changed],[...masks[marker.tagId][changed],'Later researcher choice']);assert.deepEqual(h.state.nativeBindingExclusions![marker.tagId][foreignPaper],['Unrelated later raw label']);
  assert.deepEqual(h.native[untouched],patches[1].before);assert.deepEqual(h.state.ownership[untouched],{});assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);assert.equal(validState(h.state),true);
});

test('manual assignment confirms only its existing native pair without acquiring ownership and Undo restores its mask',async()=>{
  const h=fixture(),marker=await useMeaning(h),paperId=Object.keys(h.state.papers)[4],paper=h.state.papers[paperId],native=clone(h.native[paperId]),masks=clone(h.state.nativeBindingExclusions),key=`${paperId}|${marker.tagId}`;
  await h.app.invoke('assign-detail',{tagId:marker.tagId,itemIDs:[paper.itemID]});assert.deepEqual(h.native[paperId],native);assert.equal(h.state.nativeBindingExclusions?.[marker.tagId]?.[paperId],undefined);assert.deepEqual(h.state.decisions[key],{locked:true});assert.equal(h.state.ownership[paperId]?.[marker.tagId],undefined);
  const remaining=clone(h.state.nativeBindingExclusions),expected=clone(masks);delete expected![marker.tagId][paperId];assert.deepEqual(remaining,expected);assert.equal(h.writes.length,0);assert.equal(h.calls.length,0);
  const change=h.state.history.find(change=>change.label==='Manually assign FC')!;assert.ok(change);assert.deepEqual(change.patches,[]);await h.app.invoke('undo',{id:change.id});assert.deepEqual(h.state.nativeBindingExclusions,masks);assert.equal(h.state.decisions[key],undefined);assert.deepEqual(h.native[paperId],native);assert.equal(h.state.ownership[paperId]?.[marker.tagId],undefined);assert.equal(h.writes.length,0);assert.equal(validState(h.state),true);
});

test('the legacy batch confirms an already chosen meaning with source exceptions while respecting Later',async()=>{
  const h=fixture(undefined,null),review=h.state.nativeDefinitionPreparation!,entry=review.work.entries[0],proofs=clone(entry.judgments);
  review.work=resolveNativeTagDefinition(review.work,review.work.snapshot,{entryId:entry.id,definition:clone(entry.definition!),preserveUncertainty:true});await h.app.initialize();
  let view=await h.app.snapshot();assert.equal(view.nativeDefinitionPreparation!.savedCount,0);assert.equal(view.nativeDefinitionPreparation!.clearChoiceCount,1);assert.equal(view.nativeDefinitionPreparation!.canUseClearMeanings,true);assert.equal(view.nativeDefinitionPreparation!.rows[0].canConfirmClear,true);
  const item=h.state.reviewItems!.find(item=>item.workId===review.work.id&&item.state==='open')!;await h.app.invoke('defer-review-item',{id:item.id});view=await h.app.snapshot();assert.equal(view.nativeDefinitionPreparation!.clearChoiceCount,0);assert.equal(view.nativeDefinitionPreparation!.canUseClearMeanings,false);await assert.rejects(h.app.invoke('use-clear-tag-meanings',{id:review.work.id}),/No clear single meanings/);assert.equal(h.state.tags.some(tag=>tag.name==='FC'),false);
  await h.app.invoke('reopen-review-item',{id:item.id});await h.app.invoke('use-clear-tag-meanings',{id:review.work.id});await h.app.waitForIdle();view=await h.app.snapshot();assert.equal(view.nativeDefinitionPreparation!.savedCount,1);assert.ok(h.state.nativeDefinitionPreparation!.work.entries[0].meaningAdmission);assert.deepEqual(h.state.nativeDefinitionPreparation!.work.entries[0].judgments,proofs);assert.equal(h.state.maintenanceTasks![0].run.spentUSD,0.37);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);assert.equal(validState(h.state),true);
});

test('explicit Use can save an AI glossary meaning with zero supporting papers without creating scientific proof',async()=>{
  const h=fixture(),entry=h.state.nativeDefinitionPreparation!.work.entries[0];for(const proof of Object.values(entry.judgments)){proof.relation='uncertain';proof.reason='The available source does not establish this scientific meaning.';}
  const proofs=clone(entry.judgments),marker=await useMeaning(h),saved=h.state.tags.find(tag=>tag.id===marker.tagId)!,view=await h.app.snapshot();
  assert.equal(saved.custom,true);assert.equal(saved.matchingMode,'suggest');assert.deepEqual(h.state.nativeDefinitionPreparation!.work.entries[0].judgments,proofs);assert.equal(Object.values(proofs).filter(proof=>proof.relation==='same-meaning').length,0);assert.equal(h.state.nativeDefinitionPreparation!.work.entries[0].automaticAnswer,undefined);assert.equal(h.state.nativeDefinitionPreparation!.work.entries[0].humanAnswer!.meaningAdmissionPolicy,1);
  assert.equal(view.tags.find(tag=>tag.id===marker.tagId)!.currentlyTaggedCount,0);const filter={mode:'all' as const,selections:[{conceptId:marker.tagId}]};assert.ok(Object.keys(h.state.papers).every(id=>!matchConceptFilter(h.native[id].map(tag=>tag.tag),view.tags,filter,id)));assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);assert.equal(validState(h.state),true);
});
