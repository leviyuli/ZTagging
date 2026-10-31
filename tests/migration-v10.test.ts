import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,migrateState,validLegacyState,validState} from '../src/controller.ts';
import {paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import {normalizeFacts} from '../src/taxonomy.ts';
import {createRegistrySnapshot} from '../src/evidence.ts';
import {createTagSelection,nextSelectionRequests,noteSelectionDispatch,acceptSelectionResult} from '../src/tag-selection.ts';
import {migrateTagShelves} from '../src/tag-shelves.ts';
import {AtomicStore} from '../src/store.ts';
import type {StateIO} from '../src/store.ts';

function schemaNine(){
  const old={...initialState(),schemaVersion:9};old.vocabularyVersion=4;Object.assign(old.settings,{provider:'deepseek',model:'retained-selected-model',budgetUSD:12,maxOutputTokens:8192,autoAssign:true});
  const tag=(id:string,name:string,description:string):TagDefinition=>({id,name,fullName:name,description,facet:'method',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],custom:false,status:'approved',matchingMode:'suggest'});
  old.tags=[tag('saved-eis','EIS','Impedance spectroscopy of electrochemical systems.'),{...tag('researcher-marker','My marker','A preserved researcher-defined research topic.'),facet:'phenomenon',custom:true,matchingMode:'manual'}];old.taxonomyReady=true;old.tagShelves=migrateTagShelves(old.tags);old.tagShelves[0].name='My spectroscopy papers';
  for(let index=0;index<2;index++){
    const paper:PaperRecord={id:`1:MIGRATION10-${index}`,itemID:index+1,libraryID:1,key:`MIGRATION10-${index}`,title:`Retained spectroscopy experiment ${index}`,abstract:`Electrochemical impedance spectroscopy measures transport in synthetic sample ${index}.`,keywords:['EIS'],fingerprint:''};paper.fingerprint=paperFingerprint(paper);old.papers[paper.id]=paper;old.nativeTags[paper.id]=[{tag:'Manual project',type:0},{tag:'EIS',type:1},{tag:'Unready native topic',type:0}];
    old.facts[paper.id]=normalizeFacts({summary:'The retained experiment measured an impedance response.',needsPDF:false,concepts:[{name:'EIS',facet:'method',evidence:[{source:'abstract',text:paper.abstract},{source:'keyword',text:'EIS'}]}]},paper,'original-provider','original-extractor');
  }
  const facts=Object.values(old.facts),snapshot=createRegistrySnapshot(facts,old.evidenceCatalog);let work=createTagSelection(facts,[],snapshot,{plannerVersion:4,tagPolicyVersion:2,targetCount:60,maxOutputTokens:8192,generationId:'retained-ready-build',baseVersion:4}),request=nextSelectionRequests(work)[0];
  work=acceptSelectionResult(noteSelectionDispatch(work,request.id),request.id,{tags:[{key:'eis',name:'EIS',fullName:'electrochemical impedance spectroscopy',description:'Measurement of transport responses using impedance spectra.',facet:'method',aliases:[],parentKeys:[],relatedKeys:[]}]},{provider:'selected-provider','model':'paid-selected-model'});
  for(let round=0;round<4&&work.status!=='ready';round++)for(const check of nextSelectionRequests(work)){
    const data=JSON.parse(check.prompt.split('INPUT_DATA_JSON:').at(-1)!);work=acceptSelectionResult(noteSelectionDispatch(work,check.id),check.id,{judgements:data.requestedPairs.map((pair:{pairRef:string})=>({pairRef:pair.pairRef,relation:'equivalent',reason:'The exact retained quotation establishes this spectroscopy method.'}))},{provider:'selected-provider',model:'paid-selected-model'});
  }
  assert.equal(work.status,'ready');old.taxonomyProposal=work.proposal!;old.taxonomyEvidence=snapshot;
  old.run={id:'saved-ready-run',kind:'rebuild',scope:'selected',automatic:false,status:'idle',jobs:facts.map((fact,index)=>({id:`completed-job-${index}`,paperId:fact.paperId,status:'completed'})),vocabCursor:2,vocabFinished:true,message:'Your suggested tags are ready.',spentUSD:2.75,settings:structuredClone(old.settings),vocabularyVersion:4,selection:work,selectionInputFingerprint:'retained-input-fingerprint'};
  old.decisions['1:MIGRATION10-0|researcher-marker']={locked:true,rejected:true};old.ownership['1:MIGRATION10-0']={'saved-eis':{name:'EIS',changeId:'retained-native-change'}};old.history=[{id:'retained-native-change',date:'2026-10-31T00:00:00.000Z',label:'Retained reviewed assignment',patches:[{paperId:'1:MIGRATION10-0',itemID:1,before:[{tag:'Manual project',type:0}],after:structuredClone(old.nativeTags['1:MIGRATION10-0'])}],beforeOwnership:{},afterOwnership:structuredClone(old.ownership),suggestionIds:[],status:'applied'}];
  old.analyses['1:MIGRATION10-0']={metadataFingerprint:old.papers['1:MIGRATION10-0'].fingerprint,vocabularyVersion:4,provider:'retained-provider',model:'retained-model',raw:{summary:'Retained original response',suggestions:[]}};old.metadata.vaultReference='opaque-encrypted-credential-reference';old.pilotReviewed=true;old.pilotVersion=4;
  old.workflow={buildMode:'replace',buildScope:'selected',buildPaperIds:facts.map(fact=>fact.paperId),assignmentScope:'library',assignmentPaperIds:[],assignmentTagShelfId:'all'};
  old.maintenanceTasks=[{id:'retained-queued-work',kind:'diy',status:'paused',run:{...structuredClone(old.run),id:'retained-maintenance-run',status:'paused',spentUSD:1.25},cursor:0,createdAt:'2026-10-31T00:00:00.000Z',groupIds:['saved-group'],paperIds:facts.map(fact=>fact.paperId),response:{cursor:0,raw:'Retained original model reply',applied:false},error:'The account needs reconnecting.'}];
  return JSON.parse(JSON.stringify(old)) as typeof old;
}
function bytes(value:unknown){return new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode(JSON.stringify(value,null,3)+'\r\n')]);}
function memory(original:Uint8Array){
  const files=new Map<string,Uint8Array>([['state.json',original.slice()]]),copies:string[]=[],writes:string[]=[];let failCopy=false,failWrite=false;
  const io:StateIO={exists:async path=>files.has(path),read:async path=>new TextDecoder().decode(files.get(path)!),readBytes:async path=>files.get(path)!.slice(),copyExact:async(source,destination)=>{if(failCopy)throw new Error('Exact backup failed');assert.equal(files.has(destination),false);copies.push(destination);files.set(destination,files.get(source)!.slice());},writeAtomic:async(path,text)=>{if(failWrite&&path==='state.json')throw new Error('Migration write failed');writes.push(path);files.set(path,new TextEncoder().encode(text));}};
  return {io,files,copies,writes,failCopy:(value:boolean)=>{failCopy=value;},failWrite:(value:boolean)=>{failWrite=value;}};
}

test('schema-nine migration preserves completed facts, evidence proofs, ready paid work, native data, shelves and manual choices',()=>{
  const old=schemaNine(),before=structuredClone(old);assert.equal(validLegacyState(old),true);assert.equal(validState(old),false);const next=migrateState(old);
  assert.equal(next.schemaVersion,10);assert.equal(validState(next),true);assert.deepEqual(next,{...before,schemaVersion:10});assert.deepEqual(old,before);assert.equal(next.run!.selection!.status,'ready');assert.equal(next.run!.jobs.filter(job=>job.status==='completed').length,2);assert.equal(next.run!.spentUSD,2.75);assert.equal(next.run!.selection!.automaticRequests,old.run!.selection!.automaticRequests);assert.equal(next.nativeDefinitionPreparation,undefined);assert.equal(next.nativeDefinitionHistory,undefined);assert.equal(next.shelfMergePreview,undefined);assert.equal(next.maintenanceTasks![0].status,'paused');assert.equal(next.maintenanceTasks![0].run.spentUSD,1.25);assert.equal(migrateState(next),next);
});

test('schema-ten load preserves an immutable exact-byte pre-v10 source and older backup generations before migration',async()=>{
  const old=schemaNine(),original=bytes(old),mem=memory(original),occupied=bytes({historical:'A distinct pre-ten source'}),earlier=bytes({historical:'A pre-nine source'});mem.files.set('state.json.pre-v10.json',occupied);mem.files.set('state.json.pre-v9.json',earlier);let migrations=0;
  const store=new AtomicStore(mem.io,'state.json',initialState,validState,value=>{migrations++;assert.deepEqual(mem.files.get('state.json.pre-v10.1.json'),original);return migrateState(value);},validLegacyState),next=await store.load();
  assert.equal(migrations,1);assert.equal(store.migrated,true);assert.equal(store.recovered,false);assert.deepEqual(next,{...old,schemaVersion:10});assert.deepEqual(mem.files.get('state.json.pre-v10.json'),occupied);assert.deepEqual(mem.files.get('state.json.pre-v9.json'),earlier);assert.deepEqual(mem.copies,['state.json.pre-v10.1.json']);assert.deepEqual(mem.writes,['state.json']);
  const reopened=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);assert.deepEqual(await reopened.load(),next);assert.equal(reopened.migrated,false);assert.equal(reopened.recovered,false);assert.equal(mem.copies.length,1);assert.deepEqual(mem.files.get('state.json.pre-v10.1.json'),original);
});

test('backup or migration write failure never substitutes an older valid bak and restart reuses the exact schema-nine source',async()=>{
  const old=schemaNine(),original=bytes(old),mem=memory(original),bak=bytes({...initialState(),vocabularyVersion:99}),occupied=bytes({historical:'Another exact source'});mem.files.set('state.json.bak',bak);mem.files.set('state.json.pre-v10.json',occupied);mem.failCopy(true);
  let store=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);await assert.rejects(store.load(),/Exact backup failed/);assert.equal(store.recovered,false);assert.deepEqual(mem.files.get('state.json'),original);assert.deepEqual(mem.files.get('state.json.bak'),bak);assert.deepEqual(mem.files.get('state.json.pre-v10.json'),occupied);assert.equal(mem.writes.length,0);
  mem.failCopy(false);mem.failWrite(true);store=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);await assert.rejects(store.load(),/Migration write failed/);assert.equal(store.recovered,false);assert.deepEqual(mem.files.get('state.json'),original);assert.deepEqual(mem.files.get('state.json.bak'),bak);assert.deepEqual(mem.files.get('state.json.pre-v10.1.json'),original);
  mem.failWrite(false);const reopened=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState),next=await reopened.load();assert.deepEqual(next.facts,old.facts);assert.deepEqual(next.run,old.run);assert.deepEqual(mem.copies,['state.json.pre-v10.1.json']);assert.equal(mem.files.has('state.json.pre-v10.2.json'),false);assert.deepEqual(mem.files.get('state.json.bak'),bak);
});

test('a literal schema-nine application cannot open or overwrite schema-ten data through its older backup',async()=>{
  const old=schemaNine(),upgraded=migrateState(old),original=bytes(upgraded),mem=memory(original);mem.files.set('state.json.bak',bytes(old));const validNine=(value:unknown):value is typeof old=>!!value&&typeof value==='object'&&(value as {schemaVersion?:unknown}).schemaVersion===9;
  const store=new AtomicStore(mem.io,'state.json',()=>structuredClone(old),validNine);await assert.rejects(store.load(),/newer schema 10/);await assert.rejects(store.save(old),/Refusing to replace newer/);assert.equal(store.recovered,false);assert.deepEqual(mem.files.get('state.json'),original);assert.equal(mem.copies.length,0);assert.equal(mem.writes.length,0);
});
