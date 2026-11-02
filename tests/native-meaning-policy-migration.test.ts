import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,migrateState,validLegacyState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
import {createAssignmentRun} from '../src/assignment-review.ts';
import {createRegistrySnapshot} from '../src/evidence.ts';
import {acceptNativeTagDefinitionResult,compileNativeTagDefinitions,createNativeTagDefinitionWork,nextNativeTagDefinitionRequests,noteNativeTagDefinitionDispatch,resolveNativeTagDefinition} from '../src/native-tag-definition.ts';
import {prepare} from '../src/tag-preparation.ts';
import {MY_TAGS_SHELF_ID,migrateTagShelves} from '../src/tag-shelves.ts';
import {createTaxonomyProposal} from '../src/taxonomy.ts';
import {AtomicStore} from '../src/store.ts';
import type {StateIO} from '../src/store.ts';

function schemaTwelve() {
  const old={...initialState(),schemaVersion:12};delete old.nativeTagTreatments;
  Object.assign(old.settings,{provider:'deepseek',model:'retained-model',budgetUSD:10,inputPricePerMillion:1,outputPricePerMillion:1});
  const papers:PaperRecord[]=Array.from({length:16},(_,index)=>{
    const key='POLICY'+String(index).padStart(2,'0'),paper:PaperRecord={id:'1:'+key,itemID:index+1,libraryID:1,key,title:'Retained scientific source '+index,abstract:index===2?'A porous sorbent captures carbon dioxide without a fuel-cell reaction.':'Hydrogen and oxygen react in an electrochemical fuel cell to deliver electrical power.',keywords:[],fingerprint:''};
    paper.fingerprint=paperFingerprint(paper);return paper;
  });
  old.papers=Object.fromEntries(papers.map(paper=>[paper.id,paper]));
  old.nativeTags=Object.fromEntries(papers.map(paper=>[paper.id,[{tag:'FC',type:0 as const},{tag:'Important',type:0 as const}]]));
  old.tagShelves=migrateTagShelves(old.tags);old.decisions[`${papers[0].id}|custom-rcl`]={locked:true,rejected:true};
  const input={papers,nativeTags:old.nativeTags,definitions:old.tags,facts:old.facts,decisions:old.decisions,vocabularyVersion:old.vocabularyVersion,applied:true};
  let work=createNativeTagDefinitionWork(input,['FC']);const draft=nextNativeTagDefinitionRequests(work)[0];
  work=acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(work,draft.id),draft.id,{workId:work.id,fingerprint:work.fingerprint,taskId:draft.id,definitions:[{entryId:work.entries[0].id,name:'FC',fullName:'fuel cell',description:'Electrochemical conversion of a supplied fuel and oxidant into electrical energy.',facet:'system',aliases:[],question:'Choose the scientific scope for this native name.'}],judgments:[]});
  work=resolveNativeTagDefinition(work,input,{entryId:work.entries[0].id,definition:{...structuredClone(work.entries[0].definition!),aliases:[]}});
  const check=nextNativeTagDefinitionRequests(work)[0],request=JSON.parse(check.prompt.split('INPUT_DATA_JSON:\n')[1]) as {papers:{entryId:string;paperId:string;sourceFingerprint:string;paper:{abstract:string}}[]};
  work=acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(work,check.id),check.id,{workId:work.id,fingerprint:work.fingerprint,taskId:check.id,definitions:[],questions:[{entryId:work.entries[0].id,question:'One checked source conflicts with this selected scientific meaning.',questionKind:'meaning',choices:[]}],judgments:request.papers.slice(0,3).map((paper,index)=>({entryId:paper.entryId,paperId:paper.paperId,sourceFingerprint:paper.sourceFingerprint,relation:index===2?'different':'same-meaning',reason:index===2?'This source establishes carbon-dioxide capture rather than a fuel cell.':'This source establishes an electrochemical fuel-cell reaction.',evidence:[{source:'abstract',text:paper.paper.abstract}],supportFactConceptIds:[]}))});
  assert.equal(work.selectionPolicyVersion,undefined);
  const run:NonNullable<AppState['run']>={id:'retained-build',kind:'rebuild',scope:'selected',automatic:false,status:'paused',processingPolicy:'auto-clear',jobs:papers.map(paper=>({id:'job-'+paper.id,paperId:paper.id,status:'completed'})),vocabCursor:16,vocabFinished:true,message:'Retained paid work.',spentUSD:1.25,settings:structuredClone(old.settings),vocabularyVersion:old.vocabularyVersion,preparation:{generationId:'retained-generation',attempts:1,responses:[{attempt:1,raw:{originalPaidReply:'retained exactly'},provider:'deepseek',model:'retained-model',applied:true}],diagnostics:[]}};
  old.run=run;old.assignmentRuns=[{...createAssignmentRun({id:'retained-assignment',paperIds:papers.map(paper=>paper.id),vocabularyVersion:old.vocabularyVersion,processingPolicy:'auto-clear'}),scope:'selected',automatic:false,jobs:papers.map(paper=>({paperId:paper.id,status:'completed'}))}];
  const proposal=createTaxonomyProposal({tags:[]},[],[],{snapshot:createRegistrySnapshot([],old.evidenceCatalog)}),prepared=prepare(proposal,undefined,{processingPolicy:'auto-clear'});
  old.taxonomyProposal=prepared.proposal;old.tagPreparation=prepared.state;old.tagPreparation.processingPolicy='auto-clear';old.activeTagPreparation=structuredClone(old.tagPreparation);
  old.preparationHistory=[{id:'retained-preparation-history',date:'2026-11-01T00:00:00Z',proposal:structuredClone(prepared.proposal),preparation:structuredClone(old.tagPreparation),spentUSD:0.85}];
  old.nativeDefinitionPreparation={work,taskId:'retained-native-task',shelfId:MY_TAGS_SHELF_ID,appliedEntryIds:[],processingPolicy:'auto-clear'};
  old.nativeDefinitionHistory=[structuredClone(old.nativeDefinitionPreparation)];
  old.maintenanceTasks=[{id:'retained-native-task',kind:'define-native',status:'completed',definitionWorkId:work.id,cursor:2,createdAt:'2026-11-01T00:00:00Z',paperIds:papers.map(paper=>paper.id),groupIds:[],run:{...structuredClone(run),id:'retained-native-run',status:'idle',spentUSD:0.37}}];
  old.reviewItems=[{id:'retained-later-question',kind:'definition',state:'deferred',taskId:work.id,workId:work.id,questionId:work.entries[0].id,label:'FC',ownerPage:'vocabulary',conditionFingerprint:'retained-condition',sourceName:'FC'}];
  old.automaticSuppressions=['retained-manual-opt-out'];
  return JSON.parse(JSON.stringify(old)) as typeof old;
}

function bytes(value:unknown) {return new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode(JSON.stringify(value,null,3)+'\r\n')]);}
function memory(original:Uint8Array) {
  const files=new Map<string,Uint8Array>([['state.json',original.slice()]]),copies:string[]=[],writes:string[]=[];let copyFails=false,writeFails=false;
  const io:StateIO={exists:async path=>files.has(path),read:async path=>new TextDecoder().decode(files.get(path)!),readBytes:async path=>files.get(path)!.slice(),copyExact:async(source,destination)=>{if(copyFails)throw new Error('Exact schema13 backup failed');assert.equal(files.has(destination),false);copies.push(destination);files.set(destination,files.get(source)!.slice());},writeAtomic:async(path,text)=>{if(writeFails&&path==='state.json')throw new Error('Schema13 state write failed');writes.push(path);files.set(path,new TextEncoder().encode(text));}};
  return {files,copies,writes,io,failCopy:(value:boolean)=>{copyFails=value;},failWrite:(value:boolean)=>{writeFails=value;}};
}

test('schema12 to13 changes only the schema and retains every automatic processing policy and scientific checkpoint',()=>{
  const old=schemaTwelve(),before=structuredClone(old);assert.equal(validLegacyState(old),true);assert.equal(validState(old),false);
  const next=migrateState(old);assert.equal(next.schemaVersion,13);assert.equal(validState(next),true);assert.deepEqual(next,{...before,schemaVersion:13});assert.deepEqual(old,before);assert.equal(migrateState(next),next);
  assert.equal(next.nativeTagTreatments,undefined);assert.equal(next.nativeDefinitionPreparation!.work.selectionPolicyVersion,undefined);
  const entry=next.nativeDefinitionPreparation!.work.entries[0];assert.equal(entry.humanAnswer!.origin,'edit');assert.equal(entry.automaticAnswer,undefined);assert.equal(entry.resolution,undefined);assert.equal(entry.questionDetails!.kind,'meaning');assert.equal(entry.paperIds.length,16);assert.equal(Object.keys(entry.judgments).length,3);assert.equal(Object.values(entry.judgments).filter(proof=>proof.relation==='different').length,1);
  for(const run of [next.run,...next.assignmentRuns!,...next.maintenanceTasks!.map(task=>task.run)])assert.equal(run!.processingPolicy,'auto-clear');
  for(const preparation of [next.tagPreparation,next.activeTagPreparation,next.preparationHistory![0].preparation])assert.equal(preparation!.processingPolicy,'auto-clear');
  for(const review of [next.nativeDefinitionPreparation,...next.nativeDefinitionHistory!])assert.equal(review!.processingPolicy,'auto-clear');
});

test('older schemas still lose unsupported processing policies instead of acquiring schema12 automation',()=>{
  const old={...schemaTwelve(),schemaVersion:11};assert.equal(validLegacyState(old),true);const next=migrateState(old);
  for(const run of [next.run,...next.assignmentRuns!,...next.maintenanceTasks!.map(task=>task.run)])assert.equal(run!.processingPolicy,undefined);
  for(const preparation of [next.tagPreparation,next.activeTagPreparation,next.preparationHistory![0].preparation])assert.equal(preparation!.processingPolicy,undefined);
  for(const review of [next.nativeDefinitionPreparation,...next.nativeDefinitionHistory!])assert.equal(review!.processingPolicy,undefined);
});

test('schema13 accepts explicit tag treatments while legacy states reject new policy metadata',()=>{
  const current=migrateState(schemaTwelve());current.nativeTagTreatments={Important:'personal',FC:'scientific'};assert.equal(validState(current),true);assert.deepEqual(migrateState(current),current);
  for(const treatments of [{Important:'automatic'},[],null,{'':'personal'},{no_tag:'personal'}])assert.equal(validState({...current,nativeTagTreatments:treatments}),false);
  const old=schemaTwelve();assert.equal(validLegacyState({...old,nativeTagTreatments:{Important:'personal'}}),false);
  for(const field of ['selectionPolicyVersion','treatments'] as const){const broken=structuredClone(old);Object.assign(broken.nativeDefinitionPreparation!.work,{[field]:field==='selectionPolicyVersion'?1:{Important:'personal'}});assert.equal(validLegacyState(broken),false,field+' is schema13 metadata');}
});

test('schema13 migration copies exact BOM and CRLF source bytes before migration and preserves collision generations',async()=>{
  const old=schemaTwelve(),original=bytes(old),mem=memory(original),occupied=bytes({historical:'Another original source'}),earlier=bytes({historical:'Prior schema12 migration source'}),bak=bytes({...initialState(),vocabularyVersion:99});
  mem.files.set('state.json.pre-v13.json',occupied);mem.files.set('state.json.pre-v12.json',earlier);mem.files.set('state.json.bak',bak);
  const store=new AtomicStore(mem.io,'state.json',initialState,validState,value=>{assert.deepEqual(mem.files.get('state.json.pre-v13.1.json'),original);return migrateState(value);},validLegacyState),next=await store.load();
  assert.deepEqual(next,{...old,schemaVersion:13});assert.equal(store.migrated,true);assert.equal(store.recovered,false);assert.deepEqual(mem.copies,['state.json.pre-v13.1.json']);assert.deepEqual(mem.writes,['state.json']);assert.deepEqual(mem.files.get('state.json.pre-v13.json'),occupied);assert.deepEqual(mem.files.get('state.json.pre-v12.json'),earlier);assert.deepEqual(mem.files.get('state.json.bak'),bak);
  const reopened=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);assert.deepEqual(await reopened.load(),next);assert.equal(reopened.migrated,false);assert.equal(mem.copies.length,1);assert.equal(mem.writes.length,1);
});

test('failed schema13 exact backup or state writes preserve both generations and retry reuses the original bytes',async()=>{
  const original=bytes(schemaTwelve()),mem=memory(original),bak=bytes({...initialState(),vocabularyVersion:99});mem.files.set('state.json.bak',bak);mem.failCopy(true);
  await assert.rejects(new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState).load(),/Exact schema13 backup failed/);assert.deepEqual(mem.files.get('state.json'),original);assert.deepEqual(mem.files.get('state.json.bak'),bak);assert.equal(mem.writes.length,0);
  mem.failCopy(false);mem.failWrite(true);const interrupted=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);await assert.rejects(interrupted.load(),/Schema13 state write failed/);assert.equal(interrupted.recovered,false);assert.deepEqual(mem.files.get('state.json.pre-v13.json'),original);assert.deepEqual(mem.files.get('state.json'),original);assert.deepEqual(mem.files.get('state.json.bak'),bak);
  mem.failWrite(false);const restarted=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);assert.equal((await restarted.load()).schemaVersion,13);assert.deepEqual(mem.copies,['state.json.pre-v13.json']);assert.equal(mem.files.has('state.json.pre-v13.1.json'),false);
});

test('schema14 data cannot fall back to a valid older backup or be overwritten by schema13',async()=>{
  const current=migrateState(schemaTwelve()),original=bytes({...current,schemaVersion:14}),mem=memory(original);mem.files.set('state.json.bak',bytes(current));const store=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);
  await assert.rejects(store.load(),/newer schema 14/);await assert.rejects(store.save(current),/Refusing to replace newer/);assert.deepEqual(mem.files.get('state.json'),original);assert.equal(mem.copies.length,0);assert.equal(mem.writes.length,0);assert.equal(store.recovered,false);
});

test('initializing migrated schema12 work adds no automatic answers or concept admissions',async()=>{
  const state=migrateState(schemaTwelve()),review=state.nativeDefinitionPreparation!,before=fingerprint(review.work),nativeBefore=fingerprint(state.nativeTags),tagsBefore=fingerprint(state.tags);let requests=0,writes=0;
  const env:ControllerEnvironment={persist:async()=>{},librarySnapshot:async()=>({papers:structuredClone(Object.values(state.papers)),nativeTags:structuredClone(state.nativeTags)}),host:{list:async()=>structuredClone(Object.values(state.papers)),read:async id=>structuredClone(Object.values(state.papers).find(paper=>paper.itemID===id)??null),readTags:async id=>structuredClone(state.nativeTags[Object.values(state.papers).find(paper=>paper.itemID===id)!.id]),pdfText:async()=>{throw new Error('No repeated source extraction');},apply:async()=>{writes++;throw new Error('No native writes');},show:async()=>{},saveSearch:async()=>{}},ai:{hasApiKey:async()=>true,getSession:async()=>({connected:false,sharing:false,email:null,accountId:null,accounts:[]}),completeJson:async()=>{requests++;throw new Error('No new paid requests');},testConnection:async()=>{throw new Error('No connection test');},listModels:async()=>[],setApiKey:async()=>{},removeApiKey:async()=>{},signIn:async()=>{throw new Error('No sign in');},cancelSignIn:()=>{},signOut:async()=>({revoked:true}),selectAccount:async()=>{}}};
  const app=new AppController(state,env);await app.initialize();await app.waitForIdle();
  assert.equal(requests,0);assert.equal(writes,0);assert.equal(fingerprint(state.nativeDefinitionPreparation!.work),before);assert.equal(fingerprint(state.nativeTags),nativeBefore);assert.equal(fingerprint(state.tags),tagsBefore);assert.equal(state.nativeDefinitionPreparation!.processingPolicy,'auto-clear');assert.equal(state.nativeDefinitionPreparation!.appliedEntryIds.length,0);assert.equal(state.maintenanceTasks![0].run.spentUSD,0.37);assert.equal(validState(state),true);
  assert.equal(compileNativeTagDefinitions(state.nativeDefinitionPreparation!.work,{papers:Object.values(state.papers),nativeTags:state.nativeTags,definitions:state.tags,facts:state.facts,decisions:state.decisions,vocabularyVersion:state.vocabularyVersion,applied:true},[review.work.entries[0].id]).entries.length,0);
});
