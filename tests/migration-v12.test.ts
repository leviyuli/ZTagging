import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,migrateState,validLegacyState,validState} from '../src/controller.ts';
import type {ControllerEnvironment} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
import {createRegistrySnapshot} from '../src/evidence.ts';
import {normalizeFacts} from '../src/taxonomy.ts';
import {prepare} from '../src/tag-preparation.ts';
import {createTagSelection,nextSelectionRequests,noteSelectionDispatch,acceptSelectionResult} from '../src/tag-selection.ts';
import {createNativeTagDefinitionWork} from '../src/native-tag-definition.ts';
import {migrateTagShelves} from '../src/tag-shelves.ts';
import {AtomicStore} from '../src/store.ts';
import type {StateIO} from '../src/store.ts';

function schemaEleven() {
  const old={...initialState(),schemaVersion:11};
  old.vocabularyVersion=4;Object.assign(old.settings,{provider:'deepseek',model:'retained-model',inputPricePerMillion:1,outputPricePerMillion:1});
  const paper:PaperRecord={id:'1:LEGACY12',itemID:1,libraryID:1,key:'LEGACY12',title:'Electrochemical impedance spectroscopy of electrode transport',abstract:'Electrochemical impedance spectroscopy measured electrode transport in this experiment.',keywords:['EIS'],fingerprint:''};
  paper.fingerprint=paperFingerprint(paper);old.papers[paper.id]=paper;old.nativeTags[paper.id]=[{tag:'Manual project',type:0},{tag:'legacy native name',type:0}];
  const facts=normalizeFacts({summary:'Electrode transport was measured by impedance spectroscopy.',needsPDF:false,concepts:[{name:'EIS',facet:'method',evidence:[{source:'abstract',text:paper.abstract}]}]},paper,'original-provider','original-model');
  old.facts[paper.id]=facts;const snapshot=createRegistrySnapshot([facts],old.evidenceCatalog);
  let work=createTagSelection([facts],[],snapshot,{targetCount:60,maxOutputTokens:8192,baseVersion:4,tagPolicyVersion:2});
  const request=nextSelectionRequests(work)[0];work=acceptSelectionResult(noteSelectionDispatch(work,request.id),request.id,{tags:[{key:'eis',name:'EIS',fullName:'electrochemical impedance spectroscopy',description:'Measurement of electrode transport by impedance spectra.',facet:'method',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:Object.keys(snapshot.entries)}]},{provider:'deepseek',model:'retained-model'});
  for(let round=0;round<4&&work.status!=='ready';round++)for(const request of nextSelectionRequests(work)){
    const data=JSON.parse(request.prompt.split('INPUT_DATA_JSON:\n')[1]);
    work=acceptSelectionResult(noteSelectionDispatch(work,request.id),request.id,{judgements:data.requestedPairs.map((pair:{pairRef:string})=>({pairRef:pair.pairRef,relation:'equivalent',reason:'The exact retained source establishes this spectroscopy method.'}))},{provider:'deepseek',model:'retained-model'});
  }
  assert.equal(work.status,'ready');
  const prepared=prepare(work.proposal!);old.taxonomyProposal=prepared.proposal;old.tagPreparation=prepared.state;
  old.run={id:'legacy-build',kind:'rebuild',scope:'selected',automatic:false,status:'paused',jobs:[{id:'legacy-job',paperId:paper.id,status:'completed'}],vocabCursor:1,vocabFinished:true,message:'Awaiting researcher approval.',spentUSD:0.85,settings:structuredClone(old.settings),vocabularyVersion:4,selection:work};
  old.tagShelves=migrateTagShelves(old.tags);old.decisions[`${paper.id}|custom-rcl`]={locked:true,rejected:true};old.metadata.vaultReference='retained-encrypted-reference';
  const nativeWork=createNativeTagDefinitionWork({papers:[paper],nativeTags:old.nativeTags,definitions:old.tags,facts:old.facts,decisions:old.decisions,vocabularyVersion:4,applied:false},['legacy native name']);
  old.nativeDefinitionPreparation={work:nativeWork,taskId:'legacy-meaning-task',shelfId:old.tagShelves[0].id,appliedEntryIds:[]};
  old.maintenanceTasks=[{id:'legacy-meaning-task',kind:'define-native',status:'paused',run:{...structuredClone(old.run),id:'legacy-meaning-run',spentUSD:0.12},cursor:0,createdAt:'2026-10-31T00:00:00.000Z',groupIds:[],paperIds:[paper.id],definitionWorkId:nativeWork.id}];
  return JSON.parse(JSON.stringify(old)) as typeof old;
}
function bytes(value:unknown){return new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode(JSON.stringify(value,null,3)+'\r\n')]);}
function memory(original:Uint8Array) {
  const files=new Map<string,Uint8Array>([['state.json',original.slice()]]),copies:string[]=[],writes:string[]=[];
  const io:StateIO={exists:async path=>files.has(path),read:async path=>new TextDecoder().decode(files.get(path)!),readBytes:async path=>files.get(path)!.slice(),copyExact:async(source,destination)=>{assert.equal(files.has(destination),false);copies.push(destination);files.set(destination,files.get(source)!.slice());},writeAtomic:async(path,text)=>{writes.push(path);files.set(path,new TextEncoder().encode(text));}};
  return {files,copies,writes,io};
}

test('schema-eleven migration preserves all unfinished paid work without adding automatic policies or admitting definitions',()=>{
  const old=schemaEleven(),before=structuredClone(old),next=migrateState(old);
  assert.equal(validLegacyState(old),true);assert.equal(validState(old),false);assert.equal(next.schemaVersion,12);assert.equal(validState(next),true);
  assert.deepEqual(next,{...before,schemaVersion:12});assert.deepEqual(old,before);assert.equal(migrateState(next),next);
  assert.equal(next.run!.processingPolicy,undefined);assert.equal(next.run!.selection!.adaptivePolicyVersion,undefined);assert.equal(next.tagPreparation!.processingPolicy,undefined);assert.equal(next.tagPreparation!.admissions,undefined);assert.equal(next.nativeDefinitionPreparation!.processingPolicy,undefined);assert.equal(next.maintenanceTasks![0].run.processingPolicy,undefined);
  assert.equal(next.run!.spentUSD,0.85);assert.equal(next.maintenanceTasks![0].run.spentUSD,0.12);assert.equal(fingerprint(next.facts),fingerprint(before.facts));assert.deepEqual(next.tags,before.tags);
});

test('schema-twelve migration retains exact original bytes and older backups before its only state write',async()=>{
  const old=schemaEleven(),original=bytes(old),mem=memory(original),occupied=bytes({historical:'Another pre-twelve source'}),earlier=bytes({historical:'Original pre-eleven source'});
  mem.files.set('state.json.pre-v12.json',occupied);mem.files.set('state.json.pre-v11.json',earlier);
  const store=new AtomicStore(mem.io,'state.json',initialState,validState,value=>{assert.deepEqual(mem.files.get('state.json.pre-v12.1.json'),original);return migrateState(value);},validLegacyState),next=await store.load();
  assert.equal(next.schemaVersion,12);assert.equal(store.migrated,true);assert.deepEqual(mem.copies,['state.json.pre-v12.1.json']);assert.deepEqual(mem.writes,['state.json']);assert.deepEqual(mem.files.get('state.json.pre-v12.json'),occupied);assert.deepEqual(mem.files.get('state.json.pre-v11.json'),earlier);
  const reopened=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);assert.deepEqual(await reopened.load(),next);assert.equal(reopened.migrated,false);assert.equal(mem.copies.length,1);assert.equal(mem.writes.length,1);
});

test('initializing migrated unfinished work neither sends model requests nor writes native tags or admits old proposals',async()=>{
  const state=migrateState(schemaEleven()),nativeBefore=fingerprint(state.nativeTags),tagsBefore=fingerprint(state.tags);let modelCalls=0,nativeWrites=0;
  const env:ControllerEnvironment={persist:async()=>{},host:{list:async()=>structuredClone(Object.values(state.papers)),read:async id=>structuredClone(Object.values(state.papers).find(paper=>paper.itemID===id)??null),readTags:async id=>structuredClone(state.nativeTags[Object.values(state.papers).find(paper=>paper.itemID===id)!.id]),pdfText:async()=>'',apply:async()=>{nativeWrites++;},show:async()=>{},saveSearch:async()=>{}},ai:{hasApiKey:async()=>true,getSession:async()=>({connected:false,sharing:false,accountId:null,email:null,accounts:[]}),completeJson:async()=>{modelCalls++;throw new Error('Legacy initialization must not dispatch');},testConnection:async()=>{throw new Error('No connection request');},listModels:async()=>[],setApiKey:async()=>{},removeApiKey:async()=>{},signIn:async()=>{throw new Error('No sign in');},cancelSignIn:()=>{},signOut:async()=>({revoked:true}),selectAccount:async()=>{}}};
  const app=new AppController(state,env);await app.initialize();await app.waitForIdle();
  assert.equal(modelCalls,0);assert.equal(nativeWrites,0);assert.equal(fingerprint(state.nativeTags),nativeBefore);assert.equal(fingerprint(state.tags),tagsBefore);assert.equal(state.run!.processingPolicy,undefined);assert.equal(state.tagPreparation!.admissions,undefined);assert.equal(validState(state),true);
});

test('schema-twelve structural validation rejects corrupt new policies, admission metadata, and review states',()=>{
  const good=migrateState(schemaEleven());assert.equal(validState(good),true);
  for(const mutate of [(state:any)=>state.run.processingPolicy='always',(state:any)=>state.run.selection.adaptivePolicyVersion=2,(state:any)=>state.nativeDefinitionPreparation.processingPolicy='always',(state:any)=>state.tagPreparation.admissions={tag:{definitionFingerprint:'meaning',changeId:0}},(state:any)=>state.reviewItems=[{id:'review',conditionFingerprint:'condition',taskId:'task',label:'Meaning',kind:'definition',state:'invalid',ownerPage:'cleanup'}],(state:any)=>state.automaticSuppressions=[42]]){
    const broken=structuredClone(good);mutate(broken);assert.equal(validState(broken),false);
  }
});

test('older applications refuse schema-twelve data and current applications refuse newer data despite older valid backups',async()=>{
  const old=schemaEleven(),current=migrateState(old),mem=memory(bytes(current));mem.files.set('state.json.bak',bytes(old));
  const validEleven=(value:unknown):value is typeof old=>!!value&&typeof value==='object'&&(value as {schemaVersion?:unknown}).schemaVersion===11;
  const older=new AtomicStore(mem.io,'state.json',()=>structuredClone(old),validEleven);await assert.rejects(older.load(),/newer schema 12/);await assert.rejects(older.save(old),/Refusing to replace newer/);assert.equal(mem.writes.length,0);
  const future=bytes({...current,schemaVersion:13});mem.files.set('state.json',future);mem.files.set('state.json.bak',bytes(current));
  const store=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);await assert.rejects(store.load(),/newer schema 13/);await assert.rejects(store.save(current),/Refusing to replace newer/);assert.deepEqual(mem.files.get('state.json'),future);assert.equal(mem.copies.length,0);assert.equal(mem.writes.length,0);
});
