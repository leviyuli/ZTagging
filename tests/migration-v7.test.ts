import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,migrateState,validLegacyState,validState} from '../src/controller.ts';
import {paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
import {createRegistrySnapshot} from '../src/evidence.ts';
import {normalizeFacts} from '../src/taxonomy.ts';
import {createTagSelection,nextSelectionRequests,noteSelectionDispatch,acceptSelectionResult} from '../src/tag-selection.ts';
import {migrateTagShelves} from '../src/tag-shelves.ts';
import {AtomicStore} from '../src/store.ts';
import type {StateIO} from '../src/store.ts';
import {upsertWarning} from '../src/warnings.ts';

const copy=<T>(value:T):T=>structuredClone(value);
function schemaSix(){
  const old={...initialState(),schemaVersion:6};delete old.tagShelves;old.tags[0].status='approved';old.settings={...old.settings,provider:'deepseek',model:'retained-model',budgetUSD:5,inputPricePerMillion:1,outputPricePerMillion:2};
  for(let index=0;index<752;index++){
    const paper:PaperRecord={id:`1:SYNTHETIC${index}`,itemID:index+1,libraryID:1,key:`SYNTHETIC${index}`,title:`Synthetic retained experiment ${index}`,abstract:`Electrochemical impedance spectroscopy measures sample ${index}.`,keywords:['EIS'],fingerprint:''};paper.fingerprint=paperFingerprint(paper);old.papers[paper.id]=paper;old.nativeTags[paper.id]=[{tag:'Manual project',type:0}];old.facts[paper.id]=normalizeFacts({summary:`Retained scientific synopsis ${index}.`,needsPDF:false,concepts:[{name:'EIS',facet:'method',evidence:[{source:'abstract',text:paper.abstract}]}]},paper,'retained-provider','retained-extractor');
  }
  const selected=Object.values(old.facts).slice(0,744),snapshot=createRegistrySnapshot(selected,old.evidenceCatalog);let work=createTagSelection(selected,old.tags,snapshot,{targetCount:60,maxOutputTokens:8192,baseVersion:old.vocabularyVersion,generationId:'saved-selector-three',plannerVersion:3});
  const plan=nextSelectionRequests(work,1)[0];work=noteSelectionDispatch(work,plan.id);work=acceptSelectionResult(work,plan.id,{tags:[{key:'eis',name:'EIS',fullName:'electrochemical impedance spectroscopy',description:'Impedance spectroscopy measurements.',facet:'method',aliases:[],inclusions:['Only sources measuring interfacial capacitance.'],parentKeys:[],relatedKeys:[]}],merges:[],excluded:[]},{provider:'deepseek',model:'retained-model'});
  const pending=nextSelectionRequests(work,1)[0];assert.ok(pending);work=noteSelectionDispatch(work,pending.id);
  old.run={id:'saved-selected-744',kind:'rebuild',scope:'selected',automatic:false,status:'paused',jobs:selected.map((fact,index)=>({id:`saved-job-${index}`,paperId:fact.paperId,status:'completed'})),vocabCursor:744,vocabFinished:false,message:'A saved mapping response awaits interpretation.',spentUSD:1.75,settings:copy(old.settings),vocabularyVersion:old.vocabularyVersion,selection:work,selectionInputFingerprint:'unchanged-historical-input',selectionReplies:[{taskId:pending.id,raw:'Completed historical model text awaiting parsing: }',provider:'deepseek',model:'retained-model',error:'Historical malformed reply.',diagnosticOnly:false}]};
  old.metadata['encrypted-credential-reference']='synthetic-opaque-vault-reference';old.verifiedConnections=['deepseek:retained-model'];old.models=['retained-model'];old.decisions['1:SYNTHETIC0|custom-rcl']={rejected:true,locked:true};old.ownership['1:SYNTHETIC0']={'custom-rcl':{name:'RCL',changeId:'saved-change'}};old.nativeTags['1:SYNTHETIC0'].push({tag:'RCL',type:1});
  old.history=[{id:'saved-change',date:'2026-10-29T00:00:00.000Z',label:'A reviewed synthetic assignment',patches:[{paperId:'1:SYNTHETIC0',itemID:1,before:[{tag:'Manual project',type:0}],after:copy(old.nativeTags['1:SYNTHETIC0'])}],beforeOwnership:{},afterOwnership:copy(old.ownership),suggestionIds:[],status:'applied'}];old.cleanup=[{id:'saved-preview',from:'old name',to:'RCL',reason:'A saved review',affectedCount:1,manualCount:0,patches:[]}];old.warnings=upsertWarning([],{code:'historical-gap',message:'A dismissed historical condition.',context:'facts',paperIds:['1:SYNTHETIC0'],conditionFingerprint:'retained-condition',now:'2026-10-29T00:00:00.000Z'});old.warnings[0].status='dismissed';
  return old;
}
function memoryStore(original:Uint8Array){
  const files=new Map<string,Uint8Array>([['state.json',original.slice()]]),copies:string[]=[],writes:string[]=[],encoder=new TextEncoder(),decoder=new TextDecoder();let fail=false;
  const io:StateIO={exists:async path=>files.has(path),read:async path=>decoder.decode(files.get(path)!),readBytes:async path=>files.get(path)!.slice(),copyExact:async(source,destination)=>{assert.equal(files.has(destination),false);copies.push(destination);files.set(destination,files.get(source)!.slice());},writeAtomic:async(path,text)=>{writes.push(path);if(fail&&path==='state.json')throw new Error('Synthetic atomic migration failure');files.set(path,encoder.encode(text));}};
  return {io,files,copies,writes,fail:(value:boolean)=>{fail=value;}};
}
function bytes(value:unknown){return new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode(JSON.stringify(value,null,1)+'\r\n')]);}

test('migration from schema six to the current schema preserves a selected 744-job, 752-fact selector-three generation without upgrading its planner',()=>{
  const old=schemaSix(),original=copy(old),next=migrateState(old);assert.equal(validLegacyState(old),true);assert.equal(validState(next),true);assert.equal(next.schemaVersion,initialState().schemaVersion);assert.deepEqual(next,{...original,schemaVersion:initialState().schemaVersion,tagShelves:migrateTagShelves(original.tags,original.tagShelves)});assert.deepEqual(old,original);assert.equal(Object.keys(next.facts).length,752);assert.equal(next.run!.jobs.filter(job=>job.status==='completed').length,744);assert.equal(next.run!.selection!.policyVersion,3);assert.deepEqual(next.run!.selection,original.run!.selection);assert.deepEqual(next.run!.selectionReplies,original.run!.selectionReplies);assert.equal(next.run!.spentUSD,1.75);assert.equal(migrateState(next),next);
});

test('loading schema six creates an immutable exact-byte pre-v10 backup before the schema and shelf metadata are written',async()=>{
  const old=schemaSix(),original=bytes(old),memory=memoryStore(original),store=new AtomicStore(memory.io,'state.json',initialState,validState,migrateState,validLegacyState),next=await store.load();assert.equal(store.migrated,true);assert.equal(store.recovered,false);assert.deepEqual(next,{...old,schemaVersion:initialState().schemaVersion,tagShelves:migrateTagShelves(old.tags,old.tagShelves)});assert.deepEqual(memory.files.get('state.json.pre-v10.json'),original);assert.deepEqual(memory.copies,['state.json.pre-v10.json']);assert.deepEqual(memory.writes,['state.json']);
  const reopened=new AtomicStore(memory.io,'state.json',initialState,validState,migrateState,validLegacyState);assert.deepEqual(await reopened.load(),next);assert.equal(reopened.migrated,false);assert.equal(memory.copies.length,1);
});

test('a failed current-schema write preserves current work and older backups, and reuses its exact migration backup on retry',async()=>{
  const old=schemaSix(),original=bytes(old),memory=memoryStore(original),bak=bytes({...initialState(),vocabularyVersion:99}),occupied=new TextEncoder().encode('An earlier distinct migration generation');memory.files.set('state.json.bak',bak);memory.files.set('state.json.pre-v10.json',occupied);memory.fail(true);const store=new AtomicStore(memory.io,'state.json',initialState,validState,migrateState,validLegacyState);await assert.rejects(store.load(),/Synthetic atomic migration failure/);assert.equal(store.recovered,false);assert.deepEqual(memory.files.get('state.json'),original);assert.deepEqual(memory.files.get('state.json.bak'),bak);assert.deepEqual(memory.files.get('state.json.pre-v10.json'),occupied);assert.deepEqual(memory.files.get('state.json.pre-v10.1.json'),original);
  memory.fail(false);const restarted=new AtomicStore(memory.io,'state.json',initialState,validState,migrateState,validLegacyState),next=await restarted.load();assert.deepEqual(next,{...old,schemaVersion:initialState().schemaVersion,tagShelves:migrateTagShelves(old.tags,old.tagShelves)});assert.deepEqual(memory.copies,['state.json.pre-v10.1.json']);assert.equal(memory.files.has('state.json.pre-v10.2.json'),false);
});

test('a schema-six application refuses schema-seven state and cannot overwrite it using an older backup',async()=>{
  const old=schemaSix(),current={...copy(old),schemaVersion:7},original=bytes(current),memory=memoryStore(original);memory.files.set('state.json.bak',bytes(old));const validSix=(value:unknown):value is typeof old=>!!value&&typeof value==='object'&&(value as {schemaVersion?:unknown}).schemaVersion===6,store=new AtomicStore(memory.io,'state.json',()=>copy(old),validSix);
  await assert.rejects(store.load(),/newer schema 7/);assert.equal(store.recovered,false);assert.equal(memory.writes.length,0);assert.equal(memory.copies.length,0);await assert.rejects(store.save(old),/Refusing to replace newer/);assert.deepEqual(memory.files.get('state.json'),original);assert.equal(memory.writes.length,0);
});
