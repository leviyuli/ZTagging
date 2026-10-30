import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,migrateState,validLegacyState,validState} from '../src/controller.ts';
import {paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import {createRegistrySnapshot} from '../src/evidence.ts';
import {createTaxonomyProposal,normalizeFacts,confirmProposalMapping} from '../src/taxonomy.ts';
import {AtomicStore} from '../src/store.ts';
import {upsertWarning} from '../src/warnings.ts';
const copy=<T>(value:T):T=>structuredClone(value);
function tag(index:number):TagDefinition{return {id:`tag-${index}`,name:`old topic ${index}`,fullName:`old topic ${index}`,description:`Scientific scope of old topic ${index}.`,facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'draft',broaderIds:[],relatedIds:[],matchingMode:'auto'};}
function legacy(){
  const state=initialState() as unknown as ReturnType<typeof initialState>&{schemaVersion:number};(state as any).schemaVersion=3;
  const diy=state.tags[0];state.tags=[...Array.from({length:106},(_,index)=>tag(index)),diy];
  for(let index=0;index<97;index++){
    const name=`old topic ${index%28}`,paper:PaperRecord={id:`paper-${index}`,itemID:index+1,libraryID:1,key:`KEY${index}`,title:`Synthetic paper ${index}`,abstract:`This experiment studies ${name}.`,keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);state.papers[paper.id]=paper;
    state.nativeTags[paper.id]=[{tag:'Manual project',type:0}];state.facts[paper.id]=normalizeFacts({summary:'A retained scientific synopsis.',needsPDF:false,concepts:[{name,facet:'system',evidence:[{source:'abstract',text:paper.abstract}]}]},paper,'deepseek','retained-model');
  }
  const selected=Object.values(state.facts).slice(0,51),snapshot=createRegistrySnapshot(selected,state.evidenceCatalog),raw={tags:state.tags.slice(0,28).map((tag,index)=>({key:`candidate-${index}`,name:tag.name,fullName:tag.fullName,description:tag.description,facet:tag.facet,aliases:[],inclusions:[],exclusions:[],examples:[],parentKeys:[],relatedKeys:[],supportRegistryIds:Object.values(snapshot.entries).filter(entry=>entry.sourceIds.some(id=>snapshot.sources[id].name===tag.name)).map(entry=>entry.registryId)})),merges:[],excluded:[]};
  state.taxonomyProposal=createTaxonomyProposal(raw,selected,state.tags,{snapshot});confirmProposalMapping(state.taxonomyProposal,state.taxonomyProposal.tags.find(tag=>!tag.custom)!.id,'2026-10-28T00:00:00.000Z');
  state.taxonomyProposal.support.orphan={paperIds:['paper-96'],registryIds:['old-registry']};
  state.run={id:'selected-51',kind:'rebuild',scope:'selected',automatic:false,status:'idle',jobs:selected.map((fact,index)=>({id:`job-${index}`,paperId:fact.paperId,status:'completed'})),vocabCursor:51,vocabFinished:true,message:'Review the retained proposal.',spentUSD:1.75,settings:copy(state.settings),vocabularyVersion:0,consolidation:{protocolVersion:2,generationId:state.taxonomyProposal.id,inputFingerprint:state.taxonomyProposal.inputFingerprint,snapshot:copy(snapshot),candidateIds:copy(state.taxonomyProposal.candidateIds??{}),value:copy(raw),correctionValue:{repairs:[]},correctionAttempts:1,phase:'needs-review',diagnostics:['One historical correction was already dispatched.']}};
  return state;
}

test('schema-four migration preserves 51 completed jobs, 97 exact facts, pending review proofs and the historical correction audit',()=>{
  const old=legacy(),before=JSON.stringify(old),proposal=copy(old.taxonomyProposal!),expectedSupport=copy(proposal.support);delete expectedSupport.orphan;
  const next=migrateState(old,{legacyBaseline:copy(old.tags)});
  assert.equal(validLegacyState(old),true);assert.equal(validState(next),true);assert.equal(next.schemaVersion,8);assert.equal(JSON.stringify(old),before);
  assert.deepEqual(next.facts,old.facts);assert.equal(Object.keys(next.facts).length,97);assert.deepEqual(next.papers,old.papers);assert.deepEqual(next.nativeTags,old.nativeTags);
  assert.deepEqual(next.run,old.run);assert.equal(next.run!.jobs.filter(job=>job.status==='completed').length,51);assert.equal(next.run!.spentUSD,1.75);assert.equal(next.run!.preparation,undefined);assert.equal(next.tagPreparation,undefined);
  assert.deepEqual(next.taxonomyProposal,{...proposal,support:expectedSupport});assert.equal(next.tags.length,29);assert.equal(next.taxonomyArchives.length,0);
  assert.deepEqual(next.settings,old.settings);assert.deepEqual(next.metadata,old.metadata);assert.deepEqual(next.decisions,old.decisions);assert.deepEqual(next.ownership,old.ownership);assert.deepEqual(next.history,old.history);
  assert.equal(migrateState(next),next);assert.equal(next.run!.consolidation!.correctionAttempts,1);
});

test('without a trustworthy legacy baseline migration retains definitions, and existing source/proposal edits remain exact',()=>{
  const old=legacy();old.taxonomyProposal!.tags[0].description='Researcher narrowed this scientific definition.';const next=migrateState(old);
  assert.equal(next.tags.length,107);assert.equal(next.taxonomyProposal!.tags[0].description,old.taxonomyProposal!.tags[0].description);
  assert.ok(next.userEditedTagIds!.includes(old.taxonomyProposal!.tags[0].id));
});

test('migrated completed notices resolve without inventing new observation dates or dismissing unrelated active conditions',()=>{
  const old=legacy();old.warnings=upsertWarning([],{code:'merge-review-notice',message:'Completed merge review.',context:'application',conditionFingerprint:'completed',now:'2026-10-28T00:00:00.000Z'});
  old.warnings=upsertWarning(old.warnings,{code:'usage-unavailable',message:'A completed request did not report usage.',context:'request',conditionFingerprint:'request',now:'2026-10-28T00:00:00.000Z'});
  const next=migrateState(old);assert.equal(next.warnings[0].status,'resolved');assert.equal(next.warnings[1].status,'active');
  assert.equal(next.warnings[0].firstSeenAt,old.warnings[0].firstSeenAt);assert.equal(next.warnings[0].occurrenceCount,old.warnings[0].occurrenceCount);
});

test('schema-four validation retains bounded preparation counters and rejects malformed persisted checkpoints',()=>{
  const state=initialState();state.run={...legacy().run!,preparation:{generationId:'preparation-one',attempts:2,responses:[{attempt:1,raw:{judgements:[]},provider:'deepseek',model:'model',applied:true},{attempt:2,raw:'Malformed output',provider:'deepseek',model:'model',failed:true}],diagnostics:['Review is needed.'],pending:false,lastError:'Malformed output'}};
  assert.equal(validState(state),true);
  for(const damage of [(s:typeof state)=>{s.run!.preparation!.attempts=4;},(s:typeof state)=>{s.run!.preparation!.responses.push(copy(s.run!.preparation!.responses[0]));},(s:typeof state)=>{s.run!.preparation!.responses[0].attempt=3;}]){const broken=copy(state);damage(broken);assert.equal(validState(broken),false);}
});

test('migration writes an exact current-version backup and never falls back to an older valid generation after write failure',async()=>{
  const old=legacy(),bytes=JSON.stringify(old,null,3)+'\r\n',files=new Map([['state.json',bytes],['state.json.bak',JSON.stringify(initialState())]]);let fail=true;
  const io={exists:async(path:string)=>files.has(path),read:async(path:string)=>files.get(path)!,writeAtomic:async(path:string,data:string)=>{if(path==='state.json'&&fail)throw new Error('Disk write failed');files.set(path,data);}};
  const store=new AtomicStore(io,'state.json',initialState,validState,value=>migrateState(value,{legacyBaseline:old.tags}),validLegacyState);
  await assert.rejects(store.load(),/Disk write failed/);assert.equal(files.get('state.json'),bytes);assert.equal(files.get('state.json.pre-v8.json'),bytes);assert.equal(store.recovered,false);
  fail=false;const next=await store.load();assert.equal(next.schemaVersion,8);assert.equal(next.tags.length,29);assert.equal(files.has('state.json.pre-v8.1.json'),false);
});
