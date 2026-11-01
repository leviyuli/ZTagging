import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import {createNativeTagDefinitionWork,nextNativeTagDefinitionRequests,noteNativeTagDefinitionDispatch,acceptNativeTagDefinitionResult,validNativeTagDefinitionWork} from '../src/native-tag-definition.ts';
import {MY_TAGS_SHELF_ID,migrateTagShelves} from '../src/tag-shelves.ts';

function fixture() {
  const state=initialState();Object.assign(state.settings,{provider:'deepseek',model:'synthetic-context-model',budgetUSD:10,inputPricePerMillion:1,outputPricePerMillion:1});
  const paper:PaperRecord={id:'1:REVIEW-CONTEXT',itemID:1,libraryID:1,key:'REVIEW-CONTEXT',title:'Battery systems and electrode transport',abstract:'Battery measurements compared electrode transport and whole-cell storage performance.',keywords:[],fingerprint:''};
  paper.fingerprint=paperFingerprint(paper);state.papers[paper.id]=paper;state.nativeTags[paper.id]=[{tag:'Battery marker',type:0},{tag:'Electrode marker',type:0}];state.tagShelves=migrateTagShelves(state.tags);
  let requests=0,writes=0;const saves:AppState[]=[];
  const env:ControllerEnvironment={host:{list:async()=>structuredClone(Object.values(state.papers)),read:async()=>structuredClone(paper),readTags:async()=>structuredClone(state.nativeTags[paper.id]),pdfText:async()=>'',apply:async()=>{writes++;},show:async()=>{},saveSearch:async()=>{}},librarySnapshot:async()=>({papers:structuredClone(Object.values(state.papers)),nativeTags:structuredClone(state.nativeTags)}),persist:async next=>{saves.push(structuredClone(next));},ai:{hasApiKey:async()=>true,getSession:async()=>({connected:false,sharing:false,email:null,accountId:null,accounts:[]}),completeJson:async()=>{requests++;throw new Error('Synthetic model unavailable');},testConnection:async()=>{throw new Error('No connection request expected');},listModels:async()=>[],setApiKey:async()=>{},removeApiKey:async()=>{},signIn:async()=>{throw new Error('No sign-in expected');},cancelSignIn:()=>{},signOut:async()=>({revoked:true}),selectAccount:async()=>{}}};
  return {state,paper,app:new AppController(state,env),saves,requests:()=>requests,writes:()=>writes};
}

function nativeReview(state:AppState,sourceName:string,taskId:string,batteryDescription='Whole-cell electrical storage performance.'):NonNullable<AppState['nativeDefinitionPreparation']> {
  let work=createNativeTagDefinitionWork({papers:structuredClone(Object.values(state.papers)),nativeTags:structuredClone(state.nativeTags),definitions:structuredClone(state.tags),facts:structuredClone(state.facts),decisions:{},vocabularyVersion:state.vocabularyVersion,applied:false},[sourceName]);
  const request=nextNativeTagDefinitionRequests(work)[0],entry=work.entries[0];
  work=acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(work,request.id),request.id,{workId:work.id,fingerprint:work.fingerprint,taskId:request.id,definitions:[{entryId:entry.id,question:'Which scientific scope should this name mean?',questionKind:'meaning',choices:[{label:'Battery system performance',name:'battery system performance',fullName:'battery system performance',description:batteryDescription,facet:'system',aliases:[]},{label:'Electrode transport',name:'electrode transport',fullName:'electrode transport',description:'Transport within battery electrodes.',facet:'phenomenon',aliases:[]}]}],judgments:[]},{provider:'retained-provider',model:'original-paid-model'});
  assert.equal(validNativeTagDefinitionWork(work),true);assert.equal(work.status,'ready');assert.equal(work.entries[0].status,'question');
  (state.maintenanceTasks??=[]).push({id:taskId,kind:'define-native',status:'completed',cursor:1,createdAt:'2026-11-01T00:00:00.000Z',groupIds:[],paperIds:Object.keys(state.papers),definitionWorkId:work.id,run:{id:`run-${taskId}`,kind:'rebuild',scope:'selected',automatic:false,processingPolicy:'auto-clear',status:'idle',jobs:Object.keys(state.papers).map(paperId=>({id:`job-${taskId}`,paperId,status:'completed'})),vocabCursor:1,vocabFinished:true,message:'Saved scientific scope choices.',spentUSD:0.37,settings:structuredClone(state.settings),vocabularyVersion:state.vocabularyVersion}});
  return {work,taskId,shelfId:MY_TAGS_SHELF_ID,appliedEntryIds:[],processingPolicy:'auto-clear'};
}

test('opening archived native meanings preserves the current unanswered work, paid replies and source identity',async()=>{
  const h=fixture(),old=nativeReview(h.state,'Battery marker','old-meanings');h.state.nativeDefinitionPreparation=old;await h.app.initialize();
  const item=h.state.reviewItems!.find(item=>item.workId===old.work.id)!,oldFingerprint=fingerprint(old),native=fingerprint(h.state.nativeTags);assert.ok(item);
  h.state.nativeDefinitionHistory=[structuredClone(old)];const current=nativeReview(h.state,'Electrode marker','current-meanings');h.state.nativeDefinitionPreparation=current;await h.app.save();const currentFingerprint=fingerprint(current);
  const destination=await h.app.invoke('open-review-item',{id:item.id});assert.deepEqual(destination,{page:'vocabulary'});assert.equal(h.state.nativeDefinitionPreparation!.work.id,old.work.id);assert.equal(fingerprint(h.state.nativeDefinitionPreparation),oldFingerprint);
  assert.ok(h.state.nativeDefinitionHistory!.some(review=>review.work.id===current.work.id&&fingerprint(review)===currentFingerprint));assert.equal(h.state.maintenanceTasks!.find(task=>task.id===old.taskId)!.run.spentUSD,0.37);
  const display=(await h.app.snapshot()).nativeDefinitionPreparation!;assert.equal(display.id,old.work.id);assert.equal(display.rows[0].choices!.length,2);assert.equal(display.rows[0].reviewId,item.id);assert.equal(h.requests(),0);assert.equal(h.writes(),0);assert.equal(fingerprint(h.state.nativeTags),native);assert.equal(validState(h.state),true);
  await h.app.invoke('resolve-review-item',{id:item.id,action:'leave'});assert.equal(h.state.nativeDefinitionPreparation!.work.entries[0].status,'left-undefined');assert.equal(h.state.reviewItems!.find(value=>value.id===item.id)!.state,'resolved');assert.equal(h.requests(),0);assert.equal(h.writes(),0);
});

test('opening an archived native choice refuses an active run without replacing either context',async()=>{
  const h=fixture(),old=nativeReview(h.state,'Battery marker','old-meanings');h.state.nativeDefinitionPreparation=old;await h.app.initialize();const item=h.state.reviewItems!.find(item=>item.workId===old.work.id)!;
  h.state.nativeDefinitionHistory=[structuredClone(old)];h.state.nativeDefinitionPreparation=nativeReview(h.state,'Electrode marker','current-meanings');h.state.run={...structuredClone(h.state.maintenanceTasks![0].run),id:'active-build',status:'running'};
  const current=fingerprint(h.state.nativeDefinitionPreparation),history=fingerprint(h.state.nativeDefinitionHistory);await assert.rejects(h.app.invoke('open-review-item',{id:item.id}),/Pause or finish/);
  assert.equal(fingerprint(h.state.nativeDefinitionPreparation),current);assert.equal(fingerprint(h.state.nativeDefinitionHistory),history);assert.equal(h.state.run!.id,'active-build');assert.equal(h.requests(),0);assert.equal(h.writes(),0);
});

test('repeating the same native meaning question retains its deferred identity across new draft IDs',async()=>{
  const h=fixture(),first=nativeReview(h.state,'Battery marker','first-meanings');h.state.nativeDefinitionPreparation=first;await h.app.initialize();
  const item=h.state.reviewItems!.find(item=>item.workId===first.work.id)!;await h.app.invoke('defer-review-item',{id:item.id});
  h.state.nativeDefinitionHistory=[structuredClone(first)];const repeated=nativeReview(h.state,'Battery marker','repeated-meanings');assert.notEqual(repeated.work.id,first.work.id);assert.notEqual(repeated.work.entries[0].id,first.work.entries[0].id);assert.notEqual(repeated.work.entries[0].tagId,first.work.entries[0].tagId);
  h.state.nativeDefinitionPreparation=repeated;await h.app.save();
  const pending=h.state.reviewItems!.filter(value=>value.kind==='definition'&&value.sourceName==='Battery marker'&&value.state!=='resolved');assert.equal(pending.length,1);assert.equal(pending[0].id,item.id);assert.equal(pending[0].state,'deferred');assert.equal(pending[0].workId,repeated.work.id);assert.equal(pending[0].questionId,repeated.work.entries[0].id);
  h.state.nativeDefinitionHistory.push(structuredClone(repeated));h.paper.abstract+=' New measurements establish an additional transport regime.';h.paper.fingerprint=paperFingerprint(h.paper);const changed=nativeReview(h.state,'Battery marker','changed-source-meanings');h.state.nativeDefinitionPreparation=changed;await h.app.save();
  const fresh=h.state.reviewItems!.find(value=>value.workId===changed.work.id&&value.state==='open')!;assert.ok(fresh);assert.notEqual(fresh.id,item.id);assert.equal(h.state.reviewItems!.find(value=>value.id===item.id)!.state,'deferred');
  h.state.nativeDefinitionHistory.push(structuredClone(changed));const changedMeaning=nativeReview(h.state,'Battery marker','changed-scope-meanings','Whole-cell storage performance during accelerated ageing.');h.state.nativeDefinitionPreparation=changedMeaning;await h.app.save();const changedChoice=h.state.reviewItems!.find(value=>value.workId===changedMeaning.work.id&&value.state==='open')!;assert.ok(changedChoice);assert.notEqual(changedChoice.id,fresh.id);assert.notEqual(changedChoice.id,item.id);assert.equal(h.requests(),0);assert.equal(h.writes(),0);assert.equal(validState(h.state),true);
});

test('manual Add tag tracks researcher edits and preserves suggestion matching through later edits',async()=>{
  const h=fixture();h.state.settings.autoAssign=true;
  const draft:TagDefinition={id:'',name:'Researcher topic',description:'The scientific meaning written by the researcher.',facet:'phenomenon',aliases:[],inclusions:[],exclusions:[],examples:[],custom:true,status:'draft',broaderIds:[],relatedIds:[],matchingMode:'suggest'};
  const id=await h.app.invoke('create-detail',{tag:draft});const saved=h.state.tags.find(tag=>tag.id===id)!;assert.equal(saved.status,'approved');assert.equal(saved.matchingMode,'suggest');assert.ok(h.state.userEditedTagIds!.includes(id));assert.equal(h.state.settings.autoAssign,true);
  await h.app.invoke('save-tag',{tag:{...structuredClone(saved),description:'A revised scientific meaning written by the researcher.'}});assert.equal(h.state.tags.find(tag=>tag.id===id)!.custom,saved.custom);assert.equal(h.state.tags.find(tag=>tag.id===id)!.matchingMode,'suggest');assert.ok(h.state.userEditedTagIds!.includes(id));assert.equal(h.state.settings.autoAssign,true);assert.equal(h.requests(),0);assert.equal(h.writes(),0);assert.equal(validState(h.state),true);
});

test('an explicit initial vocabulary cap belongs to the requested run and leaves saved defaults unchanged',async()=>{
  const h=fixture(),defaults=structuredClone(h.state.settings);await h.app.invoke('prepare-tags',{scope:'selected',mode:'replace',processingPolicy:'auto-clear',targetCount:17});await h.app.waitForIdle();
  assert.equal(h.state.run!.settings.coreConceptLimit,17);assert.equal(h.state.run!.processingPolicy,'auto-clear');assert.deepEqual(h.state.settings,defaults);assert.equal(h.state.settings.coreConceptLimit,60);assert.equal(h.writes(),0);
  const previousRun=h.state.run;await assert.rejects(h.app.invoke('prepare-tags',{scope:'selected',targetCount:1.5,processingPolicy:'auto-clear'}),/whole-number maximum/);assert.equal(h.state.run,previousRun);assert.deepEqual(h.state.settings,defaults);assert.equal(validState(h.state),true);
});
