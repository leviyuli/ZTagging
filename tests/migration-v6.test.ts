import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, migrateState, validLegacyState, validState } from '../src/controller.ts';
import { paperFingerprint } from '../src/core.ts';
import type { PaperRecord, TagDefinition } from '../src/core.ts';
import { createRegistrySnapshot } from '../src/evidence.ts';
import { normalizeFacts } from '../src/taxonomy.ts';
import { createConsolidationWork } from '../src/library-consolidation.ts';
import { AtomicStore } from '../src/store.ts';
import type { StateIO } from '../src/store.ts';
import { upsertWarning } from '../src/warnings.ts';

const copy = <T>(value:T):T => structuredClone(value);
function schemaFive() {
  const state = {...initialState(),schemaVersion:5};
  const eis:TagDefinition = {id:'saved-eis',name:'EIS',fullName:'electrochemical impedance spectroscopy',description:'Impedance spectroscopy of electrochemical systems.',facet:'method',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[],relatedIds:[],matchingMode:'auto'};
  state.tags.push(eis);state.taxonomyReady=true;
  for(let index=0;index<51;index++){
    const paper:PaperRecord={id:`1:V6${index}`,itemID:index+1,libraryID:1,key:`V6${index}`,title:`Synthetic retained measurement ${index}`,abstract:`Electrochemical impedance spectroscopy measures transport in synthetic sample ${index}.`,keywords:['EIS'],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
    state.papers[paper.id]=paper;state.nativeTags[paper.id]=[{tag:'Manual project',type:0},{tag:'EIS',type:1}];
    state.facts[paper.id]=normalizeFacts({summary:`Retained factual synopsis ${index}.`,concepts:[{name:'electrochemical impedance spectroscopy',facet:'method',evidence:[{source:'abstract',text:paper.abstract}]}],needsPDF:false},paper,'deepseek','retained-model');
  }
  const facts=Object.values(state.facts),snapshot=createRegistrySnapshot(facts,state.evidenceCatalog),work=createConsolidationWork(facts,state.tags,snapshot,60);
  work.tasks[0].raw={unparsed:['retained model output',42,null]};work.tasks[0].validationError='Retained historical organization issue.';work.tasks[0].correctionAttempts=1;work.tasks[0].correctionPending=false;
  state.run={id:'selected-51-retained',kind:'rebuild',scope:'selected',automatic:false,status:'paused',jobs:facts.map((fact,index)=>({id:`job-${index}`,paperId:fact.paperId,status:'completed'})),vocabCursor:51,vocabFinished:false,message:'Retained work awaiting review.',spentUSD:1.75,settings:copy(state.settings),vocabularyVersion:state.vocabularyVersion,consolidation:{protocolVersion:2,generationId:'retained-consolidation',inputFingerprint:'retained-fingerprint',snapshot,candidateIds:{candidate:'retained-tag-id'},correctionAttempts:1,phase:'generating',work,pendingResponse:{requestId:work.tasks[0].id,raw:'Retained unreadable response',kind:'correction'},diagnostics:['Historical output remains available.']}};
  state.settings.autoAssign=true;state.pilotReviewed=true;state.pilotVersion=state.vocabularyVersion;
  state.decisions['1:V60|saved-eis']={rejected:true,locked:true};state.ownership['1:V60']={'saved-eis':{name:'EIS',changeId:'retained-change'}};
  state.history=[{id:'retained-change',date:'2026-10-29T00:00:00.000Z',label:'Reviewed synthetic tag assignment',patches:[{paperId:'1:V60',itemID:1,before:[{tag:'Manual project',type:0}],after:copy(state.nativeTags['1:V60'])}],beforeOwnership:{},afterOwnership:copy(state.ownership),suggestionIds:[],status:'applied'}];
  state.cleanup=[{id:'reviewed-cleanup',from:'impedance',to:'EIS',reason:'Retained review',affectedCount:1,manualCount:0,patches:[]}];
  state.metadata['credential-reference']='synthetic-opaque-reference';
  state.warnings=upsertWarning([],{code:'retained-notice',message:'Retained synthetic notice.',context:'fact-extraction',conditionFingerprint:'same-condition',paperIds:['1:V60'],now:'2026-10-29T00:00:00.000Z'});state.warnings[0].status='dismissed';
  return state;
}

function byteStore(original:Uint8Array) {
  const files=new Map<string,Uint8Array>([['state.json',original.slice()]]),writes:string[]=[],copies:string[]=[];let failWrite=false,failCopy=false;
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  const io:StateIO={exists:async path=>files.has(path),read:async path=>{const value=files.get(path);if(!value)throw new Error('Missing file');return decoder.decode(value);},readBytes:async path=>files.get(path)!.slice(),copyExact:async(source,destination)=>{copies.push(destination);if(failCopy)throw new Error('Exact backup failed');assert.equal(files.has(destination),false);files.set(destination,files.get(source)!.slice());},writeAtomic:async(path,text)=>{writes.push(path);if(failWrite&&path==='state.json')throw new Error('Atomic migration write failed');files.set(path,encoder.encode(text));}};
  return {files,writes,copies,io,failWrite:(value:boolean)=>{failWrite=value;},failCopy:(value:boolean)=>{failCopy=value;}};
}
function sourceBytes(value:unknown) {const body=new TextEncoder().encode(JSON.stringify(value,null,2)+'\r\n');return new Uint8Array([0xef,0xbb,0xbf,...body]);}

test('current-schema migration preserves all completed evidence and old consolidation audit without starting selection',()=>{
  const old=schemaFive(),before=JSON.stringify(old),next=migrateState(old);
  assert.equal(validLegacyState(old),true);assert.equal(validState(next),true);assert.equal(next.schemaVersion,8);assert.deepEqual(next,{...copy(old),schemaVersion:8});assert.equal(JSON.stringify(old),before);
  assert.equal(next.run!.jobs.filter(job=>job.status==='completed').length,51);assert.deepEqual(next.facts,old.facts);assert.deepEqual(next.run!.consolidation,old.run!.consolidation);assert.equal(next.run!.selection,undefined);assert.deepEqual(next.cleanup,old.cleanup);assert.equal(migrateState(next),next);
});

test('schema-five state receives an immutable exact-byte pre-v8 backup before its only changed field is written',async()=>{
  const old=schemaFive(),bytes=sourceBytes(old),memory=byteStore(bytes),store=new AtomicStore(memory.io,'state.json',initialState,validState,migrateState,validLegacyState);
  const next=await store.load();assert.equal(next.schemaVersion,8);assert.equal(store.migrated,true);assert.equal(store.recovered,false);assert.deepEqual(memory.files.get('state.json.pre-v8.json'),bytes);assert.deepEqual(memory.copies,['state.json.pre-v8.json']);assert.deepEqual(memory.writes,['state.json']);assert.deepEqual(next.facts,old.facts);
  const reopened=new AtomicStore(memory.io,'state.json',initialState,validState,migrateState,validLegacyState);assert.deepEqual(await reopened.load(),next);assert.equal(reopened.migrated,false);assert.equal(memory.copies.length,1);
});

test('a current-schema backup failure never substitutes an older valid bak or changes retained data',async()=>{
  const bytes=sourceBytes(schemaFive()),memory=byteStore(bytes),bak=sourceBytes(initialState());memory.files.set('state.json.bak',bak);memory.files.set('state.json.pre-v8.json',new TextEncoder().encode('earlier distinct source'));memory.files.set('state.json.pre-v5.json',new TextEncoder().encode('historical schema-five backup'));memory.failCopy(true);
  const store=new AtomicStore(memory.io,'state.json',initialState,validState,migrateState,validLegacyState);await assert.rejects(store.load(),/Exact backup failed/);assert.equal(store.recovered,false);assert.deepEqual(memory.files.get('state.json'),bytes);assert.deepEqual(memory.files.get('state.json.bak'),bak);assert.equal(memory.writes.length,0);
  memory.failCopy(false);const next=await store.load();assert.equal(next.schemaVersion,8);assert.deepEqual(memory.files.get('state.json.pre-v8.1.json'),bytes);assert.equal(new TextDecoder().decode(memory.files.get('state.json.pre-v5.json')),'historical schema-five backup');assert.equal(new TextDecoder().decode(memory.files.get('state.json.pre-v8.json')),'earlier distinct source');
});

test('migration write failure retains the same exact backup on restart and never resets completed work from bak',async()=>{
  const old=schemaFive(),bytes=sourceBytes(old),memory=byteStore(bytes),bak=sourceBytes(initialState());memory.files.set('state.json.bak',bak);memory.failWrite(true);
  const store=new AtomicStore(memory.io,'state.json',initialState,validState,migrateState,validLegacyState);await assert.rejects(store.load(),/Atomic migration write failed/);assert.equal(store.recovered,false);assert.deepEqual(memory.files.get('state.json'),bytes);assert.deepEqual(memory.files.get('state.json.bak'),bak);assert.deepEqual(memory.files.get('state.json.pre-v8.json'),bytes);
  memory.failWrite(false);const restarted=new AtomicStore(memory.io,'state.json',initialState,validState,migrateState,validLegacyState),next=await restarted.load();assert.equal(next.run!.jobs.length,51);assert.deepEqual(next.facts,old.facts);assert.deepEqual(memory.copies,['state.json.pre-v8.json']);assert.equal(memory.files.has('state.json.pre-v8.1.json'),false);
});

test('newer state refuses downgrade even when a valid schema-five backup is available',async()=>{
  const bytes=sourceBytes({...initialState(),schemaVersion:9}),memory=byteStore(bytes);memory.files.set('state.json.bak',sourceBytes(schemaFive()));const store=new AtomicStore(memory.io,'state.json',initialState,validState,migrateState,validLegacyState);
  await assert.rejects(store.load(),/newer schema 9/);assert.equal(store.recovered,false);assert.deepEqual(memory.files.get('state.json'),bytes);assert.equal(memory.copies.length,0);assert.equal(memory.writes.length,0);
});
