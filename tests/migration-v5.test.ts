import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, migrateState, validLegacyState, validState } from '../src/controller.ts';
import { paperFingerprint } from '../src/core.ts';
import type { PaperRecord } from '../src/core.ts';
import { createRegistrySnapshot } from '../src/evidence.ts';
import { createTaxonomyProposal, normalizeFacts } from '../src/taxonomy.ts';
import { AtomicStore } from '../src/store.ts';
import { buildMetadataPreview } from '../src/paper-recovery.ts';
import type { MetadataSnapshot } from '../src/paper-recovery.ts';
import { createConsolidationWork } from '../src/library-consolidation.ts';

const copy = <T>(value:T):T => structuredClone(value);
function schemaFour(total=97,selected=51) {
  const old={...initialState(),schemaVersion:4};
  for(let index=0;index<total;index++){
    const paper:PaperRecord={id:`1:SYNTH${index}`,itemID:index+1,libraryID:1,key:`SYNTH${index}`,title:`Synthetic measurement ${index}`,abstract:'Electrochemical impedance spectroscopy measures the electrode response.',keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
    old.papers[paper.id]=paper;old.nativeTags[paper.id]=[{tag:'Manual project',type:0}];
    old.facts[paper.id]=normalizeFacts({summary:'Retained factual synopsis.',needsPDF:false,concepts:[{name:'EIS',facet:'method',evidence:[{source:'abstract',text:paper.abstract}]}]},paper,'deepseek','retained-model');
  }
  const facts=Object.values(old.facts).slice(0,selected),snapshot=createRegistrySnapshot(facts,old.evidenceCatalog);
  old.taxonomyProposal=createTaxonomyProposal({tags:[{key:'eis',name:'EIS',fullName:'electrochemical impedance spectroscopy',description:'Electrochemical impedance spectroscopy of electrodes.',facet:'method',aliases:[],inclusions:[],exclusions:[],examples:[],parentKeys:[],relatedKeys:[],supportRegistryIds:Object.keys(snapshot.entries)}],merges:[],excluded:[]},facts,old.tags,{snapshot});
  old.taxonomyProposal.mappingConfirmations={retained:{fingerprint:'retained-proof',confirmedAt:'2026-10-28T00:00:00.000Z'}};
  old.run={id:`selected-${selected}`,kind:'rebuild',scope:'selected',automatic:false,status:'paused',jobs:facts.map((fact,index)=>({id:`job-${index}`,paperId:fact.paperId,status:'completed'})),vocabCursor:selected,vocabFinished:true,message:'Saved researcher review.',spentUSD:1.75,settings:copy(old.settings),vocabularyVersion:old.vocabularyVersion,preparation:{generationId:'retained-preparation',attempts:3,responses:[{attempt:1,raw:{judgements:[]},provider:'deepseek',model:'retained-model',applied:true}],diagnostics:['Three dispatched attempts remain counted.']}};
  old.settings.autoAssign=true;old.pilotReviewed=true;old.pilotVersion=old.vocabularyVersion;
  old.metadata['encrypted-credential-reference']='synthetic-reference';
  old.cleanup=[{id:'old-preview',from:'legacy',to:'EIS',reason:'Superseded preview',affectedCount:1,manualCount:1,patches:[]}];
  old.history=[{id:'retained-history',date:'2026-10-28T00:00:00.000Z',label:'Earlier native change',patches:[],beforeOwnership:{},afterOwnership:{},suggestionIds:[],status:'applied'}];
  return old;
}

test('schema-five migration preserves the completed 51-paper rebuild, source identities, review proofs, budgets and native state',()=>{
  const old=schemaFour(),bytes=JSON.stringify(old),next=migrateState(old);
  assert.equal(validLegacyState(old),true);assert.equal(validState(next),true);assert.equal(next.schemaVersion,8);assert.equal(JSON.stringify(old),bytes);
  const expected={...copy(old),schemaVersion:8,cleanup:[]};assert.deepEqual(next,expected);
  assert.equal(Object.keys(next.facts).length,97);assert.equal(next.run!.jobs.filter(job=>job.status==='completed').length,51);
  assert.equal(next.run!.preparation!.attempts,3);assert.equal(next.run!.spentUSD,1.75);assert.equal(next.settings.autoAssign,true);assert.equal(next.pilotReviewed,true);
  assert.equal(migrateState(next),next);assert.equal(next.paperInputs,undefined);assert.equal(next.maintenanceTasks,undefined);
});

test('schema-five validates persisted metadata and definition journals without accepting mixed native workflows or mismatched identities',()=>{
  const state=initialState(),before:MetadataSnapshot={paperId:'1:ONE',itemID:1,itemType:'journalArticle',fields:{title:'Existing title',abstractNote:'',DOI:'10.1234/example'},creators:[],identifiers:[{kind:'DOI',value:'10.1234/example'}]};
  const preview=buildMetadataPreview(before,[{DOI:'10.1234/example',abstractNote:'Fetched abstract'}]);
  state.metadataPreview={...preview,id:'preview'};
  state.pendingChange={id:'change',date:'2026-10-29T00:00:00.000Z',label:'Metadata fill',patches:[],metadataPatches:[preview.patch!],beforeOwnership:{},afterOwnership:{},suggestionIds:[],status:'prepared'};
  assert.equal(validState(state),true);
  const mismatched=copy(state);mismatched.pendingChange!.metadataPatches![0].after.paperId='1:OTHER';assert.equal(validState(mismatched),false);
  const mixed=copy(state);mixed.pendingChange!.patches=[{paperId:'1:ONE',itemID:1,before:[],after:[{tag:'EIS',type:0}]}];assert.equal(validState(mixed),false);
  const definitions=copy(state);delete definitions.pendingChange!.metadataPatches;definitions.pendingChange!.beforeDefinitions={new:null};definitions.pendingChange!.afterDefinitions={new:{...copy(state.tags[0]),id:'new'}};assert.equal(validState(definitions),true);
  delete definitions.pendingChange!.afterDefinitions!.new;assert.equal(validState(definitions),false);
  const invalid=copy(state);invalid.metadataPreview!.changes[0].after=42 as unknown as string;assert.equal(validState(invalid),false);
});

test('input assessments and queued retry progress are validated while unknown PDF availability remains legitimate',()=>{
  const state=initialState();state.paperInputs={'1:ONE':{paperId:'1:ONE',itemID:1,checkedAt:'2026-10-29T00:00:00.000Z',metadata:{title:true,abstract:false,keywords:false},pdf:{status:'unknown',attachmentCount:0,localCount:0,characters:0,rechecked:false}}};
  state.skippedAnalysis={build:['1:ONE']};assert.equal(validState(state),true);
  const invalid=copy(state);invalid.paperInputs!['1:ONE'].pdf.localCount=-1;assert.equal(validState(invalid),false);
  const wrongId=copy(state);wrongId.paperInputs!['1:ONE'].paperId='1:OTHER';assert.equal(validState(wrongId),false);
});

test('migration retains a 744-paper consolidation checkpoint and uninterpreted pending responses exactly',()=>{
  const old=schemaFour(744,744),facts=Object.values(old.facts),snapshot=createRegistrySnapshot(facts,old.evidenceCatalog),work=createConsolidationWork(facts,old.tags,snapshot,60);
  const raw='{"tags":[incomplete provider output retained for diagnostics';
  old.run!.status='running';old.run!.consolidation={protocolVersion:2,generationId:'retained-consolidation',inputFingerprint:'retained-input',snapshot,candidateIds:{candidate:'retained-id'},correctionAttempts:0,phase:'generating',work,pendingResponse:{requestId:work.tasks[0].id,raw}};
  old.maintenanceTasks=[{id:'retained-task',kind:'retry',status:'paused',run:copy(old.run!),cursor:0,createdAt:'2026-10-29T00:00:00.000Z',groupIds:[],paperIds:['1:SYNTH0'],response:{cursor:0,raw:{unparsed:['source data',42,null]},applied:false}}];
  const before=copy(old),next=migrateState(old);
  assert.equal(validState(next),true);assert.equal(Object.keys(next.facts).length,744);assert.equal(next.run!.jobs.filter(job=>job.status==='completed').length,744);
  assert.deepEqual(next.run,before.run);assert.deepEqual(next.maintenanceTasks,before.maintenanceTasks);assert.deepEqual(next.facts,before.facts);
  assert.equal(next.run!.consolidation!.pendingResponse!.raw,raw);
  const invalid=copy(next);invalid.run!.consolidation!.work!.tasks[0].completed='invalid' as unknown as boolean;assert.equal(validState(invalid),false);
  const malformed=copy(next);delete (malformed.run!.consolidation!.pendingResponse as unknown as Record<string,unknown>).raw;assert.equal(validState(malformed),false);
  const badBudget=copy(next);badBudget.maintenanceTasks![0].run.settings.maxOutputTokens=NaN;assert.equal(validState(badBudget),false);
});

test('migration creates an exact version-eight backup and never replaces a valid generation with its older bak on write failure',async()=>{
  const old=schemaFour(),bytes=JSON.stringify(old,null,2)+'\r\n',files=new Map([['state.json',bytes],['state.json.bak',JSON.stringify(initialState())]]);let rejectWrite=true;
  const io={exists:async(path:string)=>files.has(path),read:async(path:string)=>files.get(path)!,writeAtomic:async(path:string,value:string)=>{if(path==='state.json'&&rejectWrite)throw new Error('Atomic migration write failed');files.set(path,value);}};
  const store=new AtomicStore(io,'state.json',initialState,validState,migrateState,validLegacyState);
  await assert.rejects(store.load(),/Atomic migration write failed/);assert.equal(files.get('state.json'),bytes);assert.equal(files.get('state.json.pre-v8.json'),bytes);assert.equal(store.recovered,false);
  rejectWrite=false;const next=await store.load();assert.equal(next.schemaVersion,8);assert.deepEqual(next.facts,old.facts);assert.equal(files.has('state.json.pre-v8.1.json'),false);
});
