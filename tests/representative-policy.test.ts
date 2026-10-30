import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import type {TagDefinition} from '../src/core.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot} from '../src/evidence.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import {semanticDecisionKey} from '../src/taxonomy.ts';
import {prepare} from '../src/tag-preparation.ts';
import {createTagSelection,nextSelectionRequests,noteSelectionDispatch,acceptSelectionResult,finishedSelectionProposal,resumeTagSelection,selectionProgress,validTagSelectionWork,SELECTION_REQUEST_BYTE_LIMIT} from '../src/tag-selection.ts';
import type {TagSelectionRequest,TagSelectionWork} from '../src/tag-selection.ts';

const TOPIC='interfacial transport resistance';
const copy=<T>(value:T):T=>structuredClone(value);
type Pair={id:string;tagId:string;sourceId:string;registryId:string;pairRef:string};
type PairInput={requestedPairs:Pair[];tags:{id:string;name:string;fullName:string}[];sources:{sourceId:string;name:string}[]};
type Relation='equivalent'|'subtype'|'unrelated'|'needs-context';
function fixture(papers=12,perPaper=2){
  const facts:PaperFacts[]=Array.from({length:papers},(_,paper)=>({paperId:`paper-${paper}`,metadataFingerprint:`metadata-${paper}`,inputFingerprint:`input-${paper}`,provider:'retained-provider',model:'retained-model',extractionVersion:1,summary:`Synthetic interface experiment ${paper}.`,needsPDF:false,concepts:Array.from({length:perPaper},(_,concept)=>({name:TOPIC,facet:'phenomenon',evidence:[{source:'abstract',text:`Experiment ${paper}, measurement ${concept}, quantifies ${TOPIC}.`}]}))}));
  return {facts,snapshot:createRegistrySnapshot(facts,createEmptyEvidenceCatalog())};
}
function detail():TagDefinition{return {id:'researcher-detail',name:'RCL detail',fullName:'A user-defined niche resistance mechanism',description:'This user topic is retained even without a matching selected example.',facet:'phenomenon',custom:true,status:'approved',matchingMode:'suggest',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[]};}
function data(request:TagSelectionRequest):PairInput{return JSON.parse(request.prompt.split('INPUT_DATA_JSON:\n')[1]);}
function row(pair:Pair,relation:Relation='equivalent'){return {tagId:pair.tagId,registryId:pair.registryId,sourceIds:[pair.sourceId],relation,reason:relation==='unrelated'?'The quoted context establishes another scientific meaning despite its shared label.':relation==='needs-context'?'The supplied scientific wording does not resolve the intended mechanism.':'The exact source quotation establishes the defined interfacial resistance mechanism.'};}
function dispatch(work:TagSelectionWork,request:TagSelectionRequest,raw:unknown){return acceptSelectionResult(noteSelectionDispatch(work,request.id),request.id,raw,{provider:'synthetic-provider',model:'explicit-selected-model'});}
function chosen(value=fixture(),definitions:TagDefinition[]=[],options:Partial<Parameters<typeof createTagSelection>[3]>={}){
  const initial=createTagSelection(value.facts,definitions,value.snapshot,{targetCount:60,maxOutputTokens:8192,...options}),request=nextSelectionRequests(initial,1)[0];assert.ok(request);assert.equal(request.kind,'plan');
  const work=dispatch(initial,request,{tags:[{key:'resistance',name:TOPIC,fullName:TOPIC,description:'Interfacial transport resistance measurements.',facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[]}],merges:[],excluded:[]});assert.equal(work.status,'mapping',work.error);return work;
}
function finish(initial:TagSelectionWork,relation:(pair:Pair,input:PairInput)=>Relation=()=> 'equivalent'){
  let work=initial;const requests:TagSelectionRequest[]=[];
  for(let step=0;step<12&&work.status!=='ready'&&work.status!=='failed';step++){
    const request=nextSelectionRequests(work,1)[0];assert.ok(request,'Unfinished example checking must offer a bounded next request.');assert.equal(request.phase,'mapping');const input=data(request);assert.ok(input.requestedPairs.length);requests.push(request);work=dispatch(work,request,{judgements:input.requestedPairs.map(pair=>row(pair,relation(pair,input)))});
  }
  assert.equal(work.status,'ready',work.error);assert.equal(validTagSelectionWork(work),true);return {work,requests};
}

test('representative verification checks at most three distinct papers for a concept and leaves source siblings unexamined',()=>{
  const value=fixture(),before=fingerprint(value),initial=chosen(value),result=finish(initial),proposal=finishedSelectionProposal(result.work)!,tag=proposal.tags.find(tag=>!tag.custom)!,pairs=Object.values(result.work.pairPlan!),papers=pairs.map(pair=>value.snapshot.sources[pair.sourceId].paperId);
  assert.equal(result.work.policyVersion,4);assert.equal(proposal.verificationScope,'representative');assert.ok(pairs.length>0&&pairs.length<=3);assert.equal(new Set(papers).size,pairs.length);assert.deepEqual(new Set(proposal.support[tag.id].sourceIds),new Set(pairs.map(pair=>pair.sourceId)));assert.deepEqual(new Set(proposal.support[tag.id].paperIds),new Set(papers));
  const checked=new Set(pairs.map(pair=>pair.sourceId));for(const [sourceId,entry] of Object.entries(result.work.sourceLedger))if(!checked.has(sourceId)){assert.equal(entry.status,'unexamined');assert.deepEqual(entry.tagIds,[]);}
  assert.ok(Object.values(result.work.sourceLedger).every(entry=>entry.status!=='outside-core'));assert.ok(!proposal.tags.some(tag=>tag.name==='no_tag'));assert.equal(prepare(proposal).state.status,'ready');assert.equal(fingerprint(value),before);assert.ok(result.requests.every(request=>new TextEncoder().encode(request.prompt).length<=SELECTION_REQUEST_BYTE_LIMIT));
  const progress=selectionProgress(result.work);assert.equal(progress.examplesChecked,pairs.length);assert.equal(progress.sourceTotal,Object.keys(value.snapshot.sources).length);
});

test('negative representative examples defer an unsupported generated concept while preserving a zero-coverage DIY definition',()=>{
  const value=fixture(),custom=detail(),result=finish(chosen(value,[custom]),()=> 'unrelated'),proposal=finishedSelectionProposal(result.work)!;
  assert.ok(!proposal.tags.some(tag=>tag.name===TOPIC));assert.deepEqual(proposal.tags.find(tag=>tag.id===custom.id),custom);assert.equal(proposal.support[custom.id].paperIds.length,0);assert.ok(result.work.deferred?.some(entry=>entry.tag.name===TOPIC)||proposal.excluded.some(entry=>entry.name===TOPIC));assert.deepEqual(prepare(proposal).state.questions,[]);
  const checked=new Set(Object.values(result.work.pairPlan!).map(pair=>pair.sourceId));assert.ok(Object.entries(result.work.sourceLedger).filter(([id])=>!checked.has(id)).every(([,entry])=>entry.status==='unexamined'));assert.ok(!proposal.tags.some(tag=>tag.name==='no_tag'));
});

test('an ambiguous sampled link is omitted once another exact example grounds the same concept',()=>{
  const initial=chosen(),first=data(nextSelectionRequests(initial,1)[0]).requestedPairs[0].sourceId,result=finish(initial,pair=>pair.sourceId===first?'needs-context':'equivalent'),proposal=finishedSelectionProposal(result.work)!,tag=proposal.tags.find(tag=>!tag.custom)!;
  assert.ok(Object.values(result.work.pairPlan!).some(pair=>pair.sourceId===first&&pair.status==='ambiguous'));assert.ok(!proposal.mappedSourceIds![tag.id].includes(first));assert.ok(!proposal.support[tag.id].sourceIds!.includes(first));assert.ok(proposal.support[tag.id].paperIds.length>0);const prepared=prepare(proposal);assert.equal(prepared.state.status,'ready');assert.deepEqual(prepared.state.questions,[]);
});

test('genuine unresolved concept meanings remain questions when no sampled example establishes the concept',()=>{
  const result=finish(chosen(),()=> 'needs-context'),proposal=finishedSelectionProposal(result.work)!,prepared=prepare(proposal);assert.equal(prepared.state.status,'questions');assert.ok(prepared.state.questions.length>0);assert.equal(prepared.repairRequest,false);assert.ok(Object.values(result.work.pairPlan!).length<=3);assert.ok(result.requests.length<=2);
});

test('valid pair results survive a malformed neighboring result and restart, with correction limited to unfinished pairs',()=>{
  const initial=chosen(),request=nextSelectionRequests(initial,1)[0],input=data(request);assert.ok(input.requestedPairs.length>=2);const accepted=input.requestedPairs[0],invalid=input.requestedPairs[1],raw={judgements:[row(accepted),{...row(invalid),sourceIds:['unknown-unrequested-source']}]};
  let work=dispatch(initial,request,raw);assert.equal(work.pairPlan![accepted.id].status,'positive');const proof=copy(work.proposal!.machineDecisions![semanticDecisionKey(accepted.tagId,accepted.sourceId)]),attempts=copy(work.tasks.find(task=>task.id===request.id)!.attempts);work=resumeTagSelection(JSON.parse(JSON.stringify(work)));
  const correction=nextSelectionRequests(work,1)[0];assert.ok(correction);assert.equal(correction.kind,'correction');assert.ok(data(correction).requestedPairs.every(pair=>pair.id!==accepted.id));assert.deepEqual(work.tasks.find(task=>task.id===request.id)!.attempts,attempts);
  const result=finish(work);assert.deepEqual(result.work.proposal!.machineDecisions![semanticDecisionKey(accepted.tagId,accepted.sourceId)],proof);assert.ok(result.requests.every(next=>data(next).requestedPairs.every(pair=>pair.id!==accepted.id)));assert.equal(selectionProgress(result.work).mappingCorrectionsUsed,1);
});

test('fresh positive and negative pair proofs are reused without treating a negative pair as a source-wide disposition',()=>{
  const value=fixture(),initial=chosen(value),negative=data(nextSelectionRequests(initial,1)[0]).requestedPairs[0].sourceId,result=finish(initial,pair=>pair.sourceId===negative?'unrelated':'equivalent'),proposal=finishedSelectionProposal(result.work)!,proofs=copy(proposal.machineDecisions!),negativeProof=Object.values(proofs).find(proof=>proof.sourceId===negative)!;assert.equal(negativeProof.relation,'unrelated');
  const cached=createTagSelection(value.facts,[],value.snapshot,{targetCount:60,maxOutputTokens:8192,review:proposal,priorDecisions:proofs});assert.equal(cached.status,'ready');assert.equal(nextSelectionRequests(cached).length,0);assert.ok(Object.values(cached.pairPlan!).some(pair=>pair.sourceId===negative&&pair.status==='negative'&&pair.cached));assert.deepEqual(cached.proposal!.machineDecisions,proofs);assert.equal(cached.sourceLedger[negative].status,'unexamined');
  const invalid=copy(proposal);invalid.machineDecisions![semanticDecisionKey(negativeProof.tagId,negative)].sourceFingerprint='changed-source-fingerprint';const recheck=createTagSelection(value.facts,[],value.snapshot,{targetCount:60,maxOutputTokens:8192,review:invalid,priorDecisions:invalid.machineDecisions}),request=nextSelectionRequests(recheck,1)[0];assert.ok(request);assert.deepEqual(new Set(data(request).requestedPairs.map(pair=>pair.sourceId)),new Set([negative]));assert.ok(Object.values(recheck.pairPlan!).filter(pair=>pair.sourceId!==negative).every(pair=>pair.cached));
});
