import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import type {TagDefinition} from '../src/core.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot} from '../src/evidence.ts';
import {captureVocabularyBaseline} from '../src/vocabulary-extension.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import {acceptSelectionResult,createTagSelection,nextSelectionRequests,noteSelectionDispatch,resumeTagSelection,retryTagSelection,validTagSelectionWork} from '../src/tag-selection.ts';
import type {TagSelectionWork} from '../src/tag-selection.ts';

function definition(id:string,name:string,fullName=name,facet:TagDefinition['facet']='component',extra:Partial<TagDefinition>={}):TagDefinition{return {id,name,fullName,facet,description:`The saved scientific scope of ${fullName}.`,aliases:[],broaderIds:[],relatedIds:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',matchingMode:'auto',...extra};}
function candidate(key:string,name:string,fullName=name,facet:TagDefinition['facet']='component'){return {key,name,fullName,facet,description:`A distinct scientific study of ${fullName}.`,aliases:[] as string[],parentKeys:[] as string[],relatedKeys:[] as string[],routingRefs:['R1']};}
function fixture(definitions:TagDefinition[]=[]) {
  const names=['membrane ionic resistance','catalyst layer porosity','ionic conductivity','transport response'],facts:PaperFacts[]=Array.from({length:2},(_,index)=>({paperId:`paper-${index}`,metadataFingerprint:`metadata-${index}`,inputFingerprint:`input-${index}`,provider:'retained',model:'cached',extractionVersion:1,summary:'Transport and electrode measurements are reported.',needsPDF:false,concepts:names.map(name=>({name,facet:'component',evidence:[{source:'abstract',text:`The experiment measures ${name} in the studied electrode.`}]}))})),snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog());
  return createTagSelection(facts,definitions,snapshot,{tagPolicyVersion:2,targetCount:12,additionalTargetCount:12,maxOutputTokens:4096,...(definitions.length?{baseline:captureVocabularyBaseline(definitions,3)}:{})});
}
function reply(work:TagSelectionWork,raw:unknown){const request=nextSelectionRequests(work)[0];return acceptSelectionResult(noteSelectionDispatch(work,request.id),request.id,raw,{provider:'synthetic',model:'selected-model'});}

test('unapproved aliases cannot redirect a distinct generated resistance concept onto a saved definition',()=>{
  const saved=[definition('saved-ionomer','ionomer'),definition('saved-conductivity','ionic conductivity','ionic conductivity','phenomenon'),definition('saved-ccl','CCL','cathode catalyst layer'),definition('saved-researcher','My membrane marker','My membrane marker','component',{custom:true,matchingMode:'manual',aliases:['researcher marker']})],before=fingerprint(saved),work=fixture(saved),selected=reply(work,{tags:[{...candidate('resistance','membrane ionic resistance','membrane ionic resistance','phenomenon'),aliases:['ionomer','ionic conductivity','cathode catalyst layer','researcher marker','shared transport marker','resistance measurement']},{...candidate('porosity','catalyst layer porosity'),aliases:['membrane ionic resistance','shared transport marker','pore fraction']}]});
  assert.equal(selected.status,'mapping');const resistance=selected.plan!.find(tag=>tag.id===selected.candidateIds.resistance)!,porosity=selected.plan!.find(tag=>tag.id===selected.candidateIds.porosity)!;
  assert.ok(resistance&&porosity);assert.equal(selected.plan!.length,saved.length+2);assert.equal(resistance.name,'membrane ionic resistance');assert.equal(porosity.name,'catalyst layer porosity');assert.ok(!saved.some(tag=>tag.id===resistance.id||tag.id===porosity.id));assert.deepEqual(resistance.aliases,['resistance measurement']);assert.deepEqual(porosity.aliases,['pore fraction']);
  for(const tag of saved)assert.deepEqual(selected.plan!.find(value=>value.id===tag.id),tag);assert.equal(fingerprint(saved),before);assert.ok(Object.values(selected.proposal!.support).every(support=>!support.sourceIds?.length&&!support.paperIds.length));assert.equal(validTagSelectionWork(selected),true);
});

test('a colliding generated preferred name uses its own unique supplied full name without changing its meaning or ID',()=>{
  const saved=definition('saved-ccl','CCL','cathode catalyst layer','component',{aliases:['cathode CL']}),raw=candidate('specific-ccl','cathode catalyst layer','cathode catalyst layer in alkaline membranes'),selected=reply(fixture([saved]),{tags:[{...raw,aliases:['Cathode catalyst layer']}]});
  assert.equal(selected.status,'mapping');const tag=selected.plan!.find(value=>value.id===selected.candidateIds['specific-ccl'])!;assert.equal(tag.name,raw.fullName);assert.equal(tag.fullName,raw.fullName);assert.equal(tag.description,raw.description);assert.notEqual(tag.id,saved.id);assert.deepEqual(tag.aliases,[]);assert.deepEqual(selected.plan!.find(value=>value.id===saved.id),saved);assert.ok(selected.diagnostics.some(message=>message.includes('Used the supplied full name')));assert.deepEqual(selected.proposal!.support[tag.id].paperIds,[]);
});

test('different generated meanings sharing one preferred name retain distinct supplied full names rather than merge',()=>{
  const selected=reply(fixture(),{tags:[candidate('ionic','MTR','membrane transport resistance'),candidate('thermal','MTR','material thermal response')]});assert.equal(selected.status,'mapping');assert.equal(selected.plan!.length,2);assert.deepEqual(new Set(selected.plan!.map(tag=>tag.name)),new Set(['membrane transport resistance','material thermal response']));assert.notEqual(selected.candidateIds.ionic,selected.candidateIds.thermal);assert.ok(selected.plan!.every(tag=>!tag.aliases.includes('MTR')));
});

test('duplicate or overlong conflicting full names are deferred with their allocated identities and incident edges removed',()=>{
  const saved=definition('saved-transport','transport response'),long='a scientifically distinct transport response whose supplied full name exceeds the eighty character display limit',selected=reply(fixture([saved]),{tags:[candidate('ambiguous-a','first transport','shared transport meaning'),candidate('ambiguous-b','second transport','shared transport meaning'),candidate('too-long','transport response',long),{...candidate('kept','membrane ionic resistance'),parentKeys:['ambiguous-a'],relatedKeys:['ambiguous-b','too-long']}]});
  assert.equal(selected.status,'mapping');assert.equal(selected.plan!.length,2);assert.deepEqual(selected.plan!.find(tag=>tag.name==='membrane ionic resistance')!.broaderIds,[]);assert.deepEqual(selected.plan!.find(tag=>tag.name==='membrane ionic resistance')!.relatedIds,[]);for(const key of ['ambiguous-a','ambiguous-b','too-long']){assert.ok(selected.candidateIds[key]);assert.ok(selected.deferred!.some(value=>value.tag.id===selected.candidateIds[key]));assert.ok(!selected.plan!.some(tag=>tag.id===selected.candidateIds[key]));}assert.deepEqual(selected.plan!.find(tag=>tag.id===saved.id),saved);
});

test('independent exact full-name matches still reuse the immutable approved definition and its authoritative aliases',()=>{
  const saved=definition('saved-ionomer','ionomer','ionomer','component',{aliases:['polymer binder']}),selected=reply(fixture([saved]),{tags:[{...candidate('same-meaning','ionomer'),aliases:['unapproved generated wording']},candidate('new','membrane ionic resistance')]});assert.equal(selected.status,'mapping');assert.equal(selected.candidateIds['same-meaning'],saved.id);assert.deepEqual(selected.plan!.find(tag=>tag.id===saved.id),saved);assert.equal(selected.plan!.filter(tag=>tag.fullName==='ionomer').length,1);
});

test('chemical and known subtype aliases remain contradictions even when the colliding label has a protected saved owner',()=>{
  for(const [saved,raw] of [[definition('saved-co','CO','carbon monoxide'),{...candidate('cobalt','Co','cobalt'),aliases:['CO']}],[definition('saved-aemfc','AEMFC','anion exchange membrane fuel cell','system'),{...candidate('fc','FC','fuel cell','system'),aliases:['AEMFC']}]] as const){const selected=reply(fixture([saved]),{tags:[raw]});assert.equal(selected.status,'choosing');assert.equal(selected.plan,undefined);assert.match(selected.tasks[0].error!,/scientifically distinct/);}
});

test('twelve saved paid replies recover locally without rewriting raw history, allocations, counters or saved meanings',()=>{
  const saved=definition('saved-ionomer','ionomer'),work=fixture([saved]),raw={tags:[{...candidate('resistance','membrane ionic resistance'),aliases:['ionomer']}]};work.candidateIds.resistance='allocated-resistance';work.candidateKeys['allocated-resistance']='resistance';work.tasks=Array.from({length:3},(_,generation)=>({...structuredClone(work.tasks[0]),id:`old-choice-${generation}`,status:'failed' as const,superseded:generation<2,generation,dispatches:4,invalidResponses:4,attempts:Array.from({length:4},()=>({raw:JSON.stringify(raw),error:'An older version rejected an ambiguous alias.'}))}));work.status='failed';work.automaticRequests=12;
  const before=fingerprint(work),history=structuredClone(work.tasks),ids=structuredClone(work.candidateIds);for(const recovered of [resumeTagSelection(work),retryTagSelection(work)]){assert.equal(recovered.status,'mapping');assert.equal(recovered.automaticRequests,12);assert.deepEqual(recovered.candidateIds,ids);for(const task of history)assert.deepEqual(recovered.tasks.find(value=>value.id===task.id)!.attempts,task.attempts);assert.deepEqual(recovered.plan!.find(tag=>tag.id===saved.id),saved);assert.equal(recovered.plan!.find(tag=>tag.id==='allocated-resistance')!.name,'membrane ionic resistance');assert.equal(nextSelectionRequests(recovered)[0].kind,'map');assert.equal(validTagSelectionWork(recovered),true);}assert.equal(fingerprint(work),before);
});
