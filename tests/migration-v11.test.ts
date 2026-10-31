import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,migrateState,validLegacyState,validState} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import {normalizeFacts} from '../src/taxonomy.ts';
import {createRegistrySnapshot} from '../src/evidence.ts';
import {createTagSelection,nextSelectionRequests,noteSelectionDispatch,acceptSelectionResult} from '../src/tag-selection.ts';
import {migrateTagShelves} from '../src/tag-shelves.ts';
import {createNativeTagDefinitionWork,nextNativeTagDefinitionRequests,noteNativeTagDefinitionDispatch,acceptNativeTagDefinitionResult,validNativeTagDefinitionWork} from '../src/native-tag-definition.ts';
import {AtomicStore} from '../src/store.ts';
import type {StateIO} from '../src/store.ts';

function schemaTen(){
  const old={...initialState(),schemaVersion:10};
  old.vocabularyVersion=6;
  Object.assign(old.settings,{provider:'deepseek',model:'retained-selected-model',budgetUSD:12,maxOutputTokens:8192,autoAssign:true});
  const tag=(id:string,name:string,description:string):TagDefinition=>({id,name,fullName:name,description,facet:'method',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],custom:false,status:'approved',matchingMode:'suggest'});
  old.tags=[tag('saved-eis','EIS','Measurement of electrochemical impedance spectra.'),{...tag('researcher-marker','My marker','A preserved researcher-defined research topic.'),facet:'phenomenon',custom:true,matchingMode:'manual'}];
  old.taxonomyReady=true;
  old.tagShelves=migrateTagShelves(old.tags);
  old.tagShelves[0].name='My spectroscopy papers';
  for(let index=0;index<95;index++){
    const paper:PaperRecord={id:`1:MIGRATION11-${index}`,itemID:index+1,libraryID:1,key:`MIGRATION11-${index}`,title:`Retained spectroscopy experiment ${index}`,abstract:`Electrochemical impedance spectroscopy measures transport in synthetic sample ${index}.`,keywords:['EIS'],fingerprint:''};
    paper.fingerprint=paperFingerprint(paper);
    old.papers[paper.id]=paper;
    old.nativeTags[paper.id]=[{tag:'Manual project',type:0},{tag:'EIS',type:1},...(index<2?[{tag:'impedence marker',type:0},{tag:'reading status',type:0}]:[])];
    old.facts[paper.id]=normalizeFacts({summary:'The retained experiment measured an impedance response.',needsPDF:false,concepts:[{name:'EIS',facet:'method',evidence:[{source:'abstract',text:paper.abstract},{source:'keyword',text:'EIS'}]}]},paper,'original-provider','original-extractor');
  }
  const allFacts=Object.values(old.facts),facts=allFacts.slice(0,48);
  createRegistrySnapshot(allFacts,old.evidenceCatalog);
  const snapshot=createRegistrySnapshot(facts,old.evidenceCatalog);
  let work=createTagSelection(facts,[],snapshot,{plannerVersion:4,tagPolicyVersion:2,targetCount:60,maxOutputTokens:8192,generationId:'retained-48-paper-build',baseVersion:6});
  const generation=nextSelectionRequests(work)[0];
  work=acceptSelectionResult(noteSelectionDispatch(work,generation.id),generation.id,{tags:[{key:'eis',name:'EIS',fullName:'electrochemical impedance spectroscopy',description:'Measurement of transport responses using impedance spectra.',facet:'method',aliases:[],parentKeys:[],relatedKeys:[]}]},{provider:'selected-provider',model:'paid-selected-model'});
  for(let round=0;round<4&&work.status!=='ready';round++)for(const request of nextSelectionRequests(work)){
    const data=JSON.parse(request.prompt.split('INPUT_DATA_JSON:').at(-1)!);
    work=acceptSelectionResult(noteSelectionDispatch(work,request.id),request.id,{judgements:data.requestedPairs.map((pair:{pairRef:string})=>({pairRef:pair.pairRef,relation:'equivalent',reason:'The retained quotation establishes this spectroscopy method.'}))},{provider:'selected-provider',model:'paid-selected-model'});
  }
  assert.equal(work.status,'ready');
  old.taxonomyProposal=work.proposal!;
  old.taxonomyEvidence=snapshot;
  old.run={id:'retained-48-paper-run',kind:'rebuild',scope:'selected',automatic:false,status:'idle',jobs:facts.map((fact,index)=>({id:`completed-job-${index}`,paperId:fact.paperId,status:'completed'})),vocabCursor:48,vocabFinished:true,message:'Your suggested tags are ready.',spentUSD:2.75,settings:structuredClone(old.settings),vocabularyVersion:6,selection:work,selectionInputFingerprint:'retained-input-fingerprint'};
  old.decisions['1:MIGRATION11-0|researcher-marker']={locked:true,rejected:true};
  old.ownership['1:MIGRATION11-0']={'saved-eis':{name:'EIS',changeId:'retained-native-change'}};
  old.history=[{id:'retained-native-change',date:'2026-10-31T00:00:00.000Z',label:'Retained reviewed assignment',patches:[{paperId:'1:MIGRATION11-0',itemID:1,before:[{tag:'Manual project',type:0}],after:structuredClone(old.nativeTags['1:MIGRATION11-0'])}],beforeOwnership:{},afterOwnership:structuredClone(old.ownership),suggestionIds:[],status:'applied'}];
  old.analyses['1:MIGRATION11-0']={metadataFingerprint:old.papers['1:MIGRATION11-0'].fingerprint,vocabularyVersion:6,provider:'retained-provider',model:'retained-model',raw:{summary:'Retained original response',suggestions:[]}};
  old.metadata.vaultReference='opaque-encrypted-credential-reference';
  old.pilotReviewed=true;old.pilotVersion=6;
  old.workflow={buildMode:'replace',buildScope:'selected',buildPaperIds:facts.map(fact=>fact.paperId),assignmentScope:'library',assignmentPaperIds:[],assignmentTagShelfId:'all'};

  const nativePapers=Object.values(old.papers).slice(0,2);
  let nativeWork=createNativeTagDefinitionWork({papers:nativePapers,nativeTags:old.nativeTags,definitions:old.tags,facts:old.facts,decisions:old.decisions,vocabularyVersion:6,applied:true},['impedence marker','reading status'],{createdAt:'2026-10-31T00:00:00.000Z'});
  nativeWork.protocolVersion=1;
  const request=nextNativeTagDefinitionRequests(nativeWork)[0],data=JSON.parse(request.prompt.split('INPUT_DATA_JSON:').at(-1)!);
  const response={workId:data.workId,fingerprint:data.fingerprint,taskId:data.taskId,definitions:data.entries.map((entry:{entryId:string;sourceName:string})=>entry.sourceName==='impedence marker'?{entryId:entry.entryId,targetTagId:'saved-eis'}:{entryId:entry.entryId,question:'Is this a reading status or a scientific topic?'}),judgments:data.papers.filter((paper:{entryId:string})=>paper.entryId===nativeWork.entries[0].id).map((paper:{entryId:string;paperId:string;sourceFingerprint:string;paper:{abstract:string}})=>({entryId:paper.entryId,paperId:paper.paperId,sourceFingerprint:paper.sourceFingerprint,relation:'same-meaning',reason:'The exact experimental passage establishes impedance spectroscopy.',evidence:[{source:'abstract',text:paper.paper.abstract}],supportFactConceptIds:[old.facts[paper.paperId].concepts[0].factConceptId]}))};
  nativeWork=acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(nativeWork,request.id),request.id,response,{provider:'deepseek',model:'retained-selected-model'});
  assert.equal(nativeWork.status,'ready');assert.equal(nativeWork.entries[0].status,'ready');assert.equal(nativeWork.entries[1].status,'question');assert.equal(nativeWork.entries[1].questionDetails,undefined);assert.equal(validNativeTagDefinitionWork(nativeWork),true);
  old.nativeDefinitionPreparation={work:nativeWork,taskId:'retained-native-definitions',shelfId:old.tagShelves[0].id,appliedEntryIds:[]};
  old.nativeDefinitionHistory=[{...structuredClone(old.nativeDefinitionPreparation),finishedAt:'2026-10-31T00:30:00.000Z'}];
  old.maintenanceTasks=[{id:'retained-native-definitions',kind:'define-native',status:'completed',run:{...structuredClone(old.run),id:'retained-native-meaning-run',jobs:old.run.jobs.slice(0,2),spentUSD:0.09},cursor:1,createdAt:'2026-10-31T00:00:00.000Z',groupIds:[],paperIds:nativePapers.map(paper=>paper.id),definitionWorkId:nativeWork.id,response:{cursor:0,raw:response,applied:true,provider:'deepseek',model:'retained-selected-model'}}];
  return JSON.parse(JSON.stringify(old)) as typeof old;
}

function bytes(value:unknown){return new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode(JSON.stringify(value,null,3)+'\r\n')]);}
function memory(original:Uint8Array){
  const files=new Map<string,Uint8Array>([['state.json',original.slice()]]),copies:string[]=[],writes:string[]=[];
  let failCopy=false,failWrite=false;
  const io:StateIO={exists:async path=>files.has(path),read:async path=>new TextDecoder().decode(files.get(path)!),readBytes:async path=>files.get(path)!.slice(),copyExact:async(source,destination)=>{if(failCopy)throw new Error('Exact backup failed');assert.equal(files.has(destination),false);copies.push(destination);files.set(destination,files.get(source)!.slice());},writeAtomic:async(path,text)=>{if(failWrite&&path==='state.json')throw new Error('Migration write failed');writes.push(path);files.set(path,new TextEncoder().encode(text));}};
  return {io,files,copies,writes,failCopy:(value:boolean)=>{failCopy=value;},failWrite:(value:boolean)=>{failWrite=value;}};
}

test('schema-ten migration preserves protocol-one questions and ready paper proofs alongside completed 48-paper work and all 95 cached facts',()=>{
  const old=schemaTen(),before=structuredClone(old),nativeBytes=bytes(old.nativeDefinitionPreparation),next=migrateState(old);
  assert.equal(validLegacyState(old),true);assert.equal(validState(old),false);assert.equal(next.schemaVersion,initialState().schemaVersion);assert.equal(validState(next),true);
  assert.deepEqual(next,{...before,schemaVersion:initialState().schemaVersion});assert.deepEqual(old,before);assert.equal(migrateState(next),next);
  assert.deepEqual(bytes(next.nativeDefinitionPreparation),nativeBytes);assert.equal(next.nativeDefinitionPreparation!.work.protocolVersion,1);assert.equal(next.nativeDefinitionPreparation!.work.entries[1].questionDetails,undefined);
  assert.equal(Object.keys(next.facts).length,95);assert.equal(next.run!.jobs.filter(job=>job.status==='completed').length,48);assert.equal(next.run!.selection!.status,'ready');assert.equal(next.run!.spentUSD,2.75);assert.equal(next.maintenanceTasks![0].run.spentUSD,0.09);
  assert.equal(fingerprint(next.facts),fingerprint(before.facts));assert.equal(fingerprint(next.evidenceCatalog),fingerprint(before.evidenceCatalog));assert.equal(fingerprint(next.run!.selection),fingerprint(before.run!.selection));
  const permitted=new Set(next.run!.jobs.map(job=>job.paperId));
  assert.deepEqual(new Set(Object.values(next.taxonomyEvidence!.sources).map(source=>source.paperId)),permitted);
});

test('schema-eleven load backs up exact original bytes without replacing occupied or historical backup generations, then restarts without migration',async()=>{
  const old=schemaTen(),original=bytes(old),mem=memory(original),occupied=bytes({historical:'Another pre-eleven source'}),earlier=bytes({historical:'A preserved pre-ten source'});
  mem.files.set('state.json.pre-v11.json',occupied);mem.files.set('state.json.pre-v10.json',earlier);
  let migrations=0;
  const store=new AtomicStore(mem.io,'state.json',initialState,validState,value=>{migrations++;assert.deepEqual(mem.files.get('state.json.pre-v11.1.json'),original);return migrateState(value);},validLegacyState),next=await store.load();
  assert.equal(migrations,1);assert.equal(store.migrated,true);assert.equal(store.recovered,false);assert.deepEqual(next,{...old,schemaVersion:initialState().schemaVersion});assert.deepEqual(mem.files.get('state.json.pre-v11.json'),occupied);assert.deepEqual(mem.files.get('state.json.pre-v10.json'),earlier);assert.deepEqual(mem.copies,['state.json.pre-v11.1.json']);assert.deepEqual(mem.writes,['state.json']);
  const restarted=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);
  assert.deepEqual(await restarted.load(),next);assert.equal(restarted.migrated,false);assert.equal(restarted.recovered,false);assert.equal(mem.copies.length,1);assert.equal(mem.writes.length,1);assert.deepEqual(mem.files.get('state.json.pre-v11.1.json'),original);
});

test('schema-eleven backup and write failures stop without using older valid bak work, and restart reuses the immutable source',async()=>{
  const old=schemaTen(),original=bytes(old),mem=memory(original),bak=bytes({...initialState(),vocabularyVersion:99}),occupied=bytes({historical:'A distinct exact source'});
  mem.files.set('state.json.bak',bak);mem.files.set('state.json.pre-v11.json',occupied);mem.failCopy(true);
  let store=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);
  await assert.rejects(store.load(),/Exact backup failed/);assert.equal(store.recovered,false);assert.deepEqual(mem.files.get('state.json'),original);assert.deepEqual(mem.files.get('state.json.bak'),bak);assert.deepEqual(mem.files.get('state.json.pre-v11.json'),occupied);assert.equal(mem.writes.length,0);
  mem.failCopy(false);mem.failWrite(true);store=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);
  await assert.rejects(store.load(),/Migration write failed/);assert.equal(store.recovered,false);assert.deepEqual(mem.files.get('state.json'),original);assert.deepEqual(mem.files.get('state.json.bak'),bak);assert.deepEqual(mem.files.get('state.json.pre-v11.1.json'),original);
  mem.failWrite(false);
  const restarted=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState),next=await restarted.load();
  assert.deepEqual(next,{...old,schemaVersion:initialState().schemaVersion});assert.deepEqual(mem.copies,['state.json.pre-v11.1.json']);assert.equal(mem.files.has('state.json.pre-v11.2.json'),false);assert.deepEqual(mem.files.get('state.json.bak'),bak);assert.equal(restarted.recovered,false);
});

test('a literal schema-ten application cannot open or overwrite schema-eleven data through an older backup',async()=>{
  const old=schemaTen(),original=bytes({...old,schemaVersion:11}),mem=memory(original);
  mem.files.set('state.json.bak',bytes(old));
  const validTen=(value:unknown):value is typeof old=>!!value&&typeof value==='object'&&(value as {schemaVersion?:unknown}).schemaVersion===10;
  const store=new AtomicStore(mem.io,'state.json',()=>structuredClone(old),validTen);
  await assert.rejects(store.load(),/newer schema 11/);await assert.rejects(store.save(old),/Refusing to replace newer/);assert.equal(store.recovered,false);assert.deepEqual(mem.files.get('state.json'),original);assert.equal(mem.copies.length,0);assert.equal(mem.writes.length,0);
});
