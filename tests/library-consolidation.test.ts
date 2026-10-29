import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot} from '../src/evidence.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import {createConsolidationWork,nextConsolidationRequest,acceptConsolidationResult,finishedConsolidation,CONSOLIDATION_REQUEST_BYTE_LIMIT} from '../src/library-consolidation.ts';
import type {ConsolidationWork,ConsolidationRequest} from '../src/library-consolidation.ts';
function evidence(papers=1,concepts=1){const facts:PaperFacts[]=Array.from({length:papers},(_,paper)=>({paperId:`paper-${paper}`,metadataFingerprint:`meta-${paper}`,inputFingerprint:`input-${paper}`,provider:'cached-provider',model:'cached-model',extractionVersion:1,summary:'Validated scientific summary. '.repeat(16),needsPDF:false,concepts:Array.from({length:concepts},(_,concept)=>{const index=paper*concepts+concept;return {name:`transport family ${index%7} wording variant ${index}`,facet:'phenomenon' as const,evidence:[{source:'abstract' as const,text:`Validated transport experiment ${index}. `.repeat(20)}]};})}));return {facts,snapshot:createRegistrySnapshot(facts,createEmptyEvidenceCatalog())};}
function data(request:ConsolidationRequest):any{return JSON.parse(request.prompt.split('INPUT_DATA_JSON:\n')[1]);}
function reducedResponse(request:ConsolidationRequest){const input=data(request),groups=new Map<string,string[]>(),registry=Array.isArray(input.conceptRegistry);for(const entry of registry?input.conceptRegistry:input.candidates){const label=registry?entry.sources[0].label:entry.name,name=/transport family \d/.exec(label)?.[0]??label,ids=groups.get(name)??[];ids.push(registry?entry.registryId:entry.candidateId);groups.set(name,ids);}return {tags:[...groups].map(([name,ids],index)=>({key:`concept-${index}`,name,fullName:name,description:`The exact scientific meaning of ${name}.`,facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],...(registry?{supportRegistryIds:ids}:{supportCandidateIds:ids})})),merges:[],excluded:[]};}
function finish(initial:ConsolidationWork){let work=initial;const requests:ConsolidationRequest[]=[];for(let step=0;step<500;step++){const next=nextConsolidationRequest(work);if(!next)return {work,requests};requests.push(next);work=acceptConsolidationResult(work,next.id,reducedResponse(next));}throw new Error('Unexpected nontermination');}

test('small input uses one complete global request and returns original evidence IDs',()=>{
  const value=evidence(2,2),before=fingerprint(value),work=createConsolidationWork(value.facts,[],value.snapshot),request=nextConsolidationRequest(work)!;assert.equal(request.phase,'final');assert.ok(data(request).conceptRegistry);const completed=acceptConsolidationResult(work,request.id,reducedResponse(request)),result=finishedConsolidation(completed)!;
  assert.equal(completed.status,'complete');assert.equal(nextConsolidationRequest(completed),undefined);assert.deepEqual(new Set(result.tags.flatMap(tag=>tag.supportRegistryIds)),new Set(Object.keys(value.snapshot.entries)));assert.equal(fingerprint(value),before);assert.equal(work.tasks[0].completed,false);
});
test('744 cached papers and thousands of registry entries stay below the byte cap and receive a final global reconciliation',()=>{
  const value=evidence(744,8),before=fingerprint(value),created=createConsolidationWork(value.facts,[],value.snapshot,60),completed=finish(created);assert.ok(created.tasks.length>1);assert.equal(created.tasks[0].phase,'map');
  assert.ok(completed.requests.every(request=>new TextEncoder().encode(request.prompt).length<=CONSOLIDATION_REQUEST_BYTE_LIMIT));assert.equal(completed.requests.at(-1)!.phase,'final');assert.ok(data(completed.requests.at(-1)!).candidates);const result=finishedConsolidation(completed.work)!;
  assert.equal(result.tags.length,7,'The final global pass merges equivalent candidates across batches rather than concatenating them');assert.deepEqual(new Set(result.tags.flatMap(tag=>tag.supportRegistryIds)),new Set(Object.keys(value.snapshot.entries)));assert.equal(fingerprint(value),before);assert.equal(value.facts.length,744);
});
test('completed batch IDs, candidate IDs and next requests survive restart without repeating completed work',()=>{
  const value=evidence(70,8),work=createConsolidationWork(value.facts,[],value.snapshot),first=nextConsolidationRequest(work)!,raw=reducedResponse(first),completed=acceptConsolidationResult(work,first.id,raw),restored:ConsolidationWork=JSON.parse(JSON.stringify(completed));
  assert.notEqual(nextConsolidationRequest(restored)!.id,first.id);assert.deepEqual(nextConsolidationRequest(restored),nextConsolidationRequest(completed));assert.equal(fingerprint(acceptConsolidationResult(restored,first.id,raw)),fingerprint(restored));assert.throws(()=>acceptConsolidationResult(restored,first.id,{tags:[]}),/immutable/);
  const reparsed=acceptConsolidationResult(JSON.parse(JSON.stringify(work)),first.id,raw);assert.deepEqual(reparsed.tasks[0].outputIds,completed.tasks[0].outputIds);assert.deepEqual(reparsed.candidates,completed.candidates);
});
test('malformed, omitted, out-of-batch and duplicate identities cannot silently complete a proposal',()=>{
  const value=evidence(2,2),work=createConsolidationWork(value.facts,[],value.snapshot),request=nextConsolidationRequest(work)!,raw=reducedResponse(request),before=fingerprint(work);
  assert.throws(()=>acceptConsolidationResult(work,request.id,'Malformed JSON }'),/JSON/);assert.throws(()=>acceptConsolidationResult(work,'stale',raw),/stale/);
  const outside=structuredClone(raw);outside.tags[0].supportRegistryIds=['foreign-registry'];assert.throws(()=>acceptConsolidationResult(work,request.id,outside),/identity/);
  const omitted=structuredClone(raw);omitted.tags.shift();assert.throws(()=>acceptConsolidationResult(work,request.id,omitted),/omitted/);
  const duplicate=structuredClone(raw);duplicate.tags.push(duplicate.tags[0]);assert.throws(()=>acceptConsolidationResult(work,request.id,duplicate),/unique key/);assert.equal(fingerprint(work),before);assert.equal(finishedConsolidation(work),undefined);
});
test('explicit exclusions preserve accounting through the final global result',()=>{
  const value=evidence(2,1),work=createConsolidationWork(value.facts,[],value.snapshot),request=nextConsolidationRequest(work)!,raw=reducedResponse(request),omitted=raw.tags.pop()!;
  const result=finishedConsolidation(acceptConsolidationResult(work,request.id,{...raw,excluded:[{registryId:omitted.supportRegistryIds[0],reason:'An incidental concept is omitted.'}]}))!;assert.equal(result.tags.length,1);assert.equal(result.excluded.length,1);assert.match(result.excluded[0].reason,/incidental/);
});
test('known chemical distinctions and subtype relationships cannot become equivalent support or aliases',()=>{
  const value=evidence();value.facts[0].concepts[0].name='Co';const snapshot=createRegistrySnapshot(value.facts,createEmptyEvidenceCatalog()),work=createConsolidationWork(value.facts,[],snapshot),request=nextConsolidationRequest(work)!,raw=reducedResponse(request);raw.tags[0].name='CO';raw.tags[0].fullName='carbon monoxide';assert.throws(()=>acceptConsolidationResult(work,request.id,raw),/scientifically distinct/);
  const compatible=reducedResponse(request);compatible.tags[0].aliases=['CO'];assert.throws(()=>acceptConsolidationResult(work,request.id,compatible),/alias/);
  const conflictingFull=reducedResponse(request);conflictingFull.tags[0].fullName='carbon monoxide';assert.throws(()=>acceptConsolidationResult(work,request.id,conflictingFull),/preferred name and full name/);
});
test('UTF8 bounds include multibyte context and unproductive reductions fail explicitly without false completion',()=>{
  const value=evidence(35,10);for(const source of Object.values(value.snapshot.sources))source.summary='科学文献摘要🚀'.repeat(80);for(const fact of value.facts)fact.summary='科学文献摘要🚀'.repeat(80);const initial=createConsolidationWork(value.facts,[],value.snapshot);let work=initial;
  for(let step=0;step<100&&work.status==='working';step++){const request=nextConsolidationRequest(work)!;assert.ok(new TextEncoder().encode(request.prompt).length<=CONSOLIDATION_REQUEST_BYTE_LIMIT);const input=data(request),registry=!!input.conceptRegistry,entries=registry?input.conceptRegistry:input.candidates,raw={tags:entries.map((entry:any,index:number)=>({key:`unchanged-${index}`,name:`separate concept ${entry.registryId??entry.candidateId}`,fullName:`separate concept ${entry.registryId??entry.candidateId}`,description:'A scientifically separate concept with a deliberately verbose unchanged scientific scope. '.repeat(10),facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],...(registry?{supportRegistryIds:[entry.registryId]}:{supportCandidateIds:[entry.candidateId]})})),merges:[],excluded:[]};work=acceptConsolidationResult(work,request.id,raw);}
  assert.equal(work.status,'failed');assert.match(work.error!,/did not reduce/);assert.equal(finishedConsolidation(work),undefined);assert.ok(work.tasks.some(task=>task.completed));assert.equal(initial.status,'working');
});
