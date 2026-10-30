import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import type {TagDefinition} from '../src/core.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot} from '../src/evidence.ts';
import {captureVocabularyBaseline} from '../src/vocabulary-extension.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import {acceptSelectionResult,createTagSelection,nextSelectionRequests,noteSelectionDispatch,resumeTagSelection,retryTagSelection,validTagSelectionWork} from '../src/tag-selection.ts';
import type {TagSelectionWork} from '../src/tag-selection.ts';

function definition(id:string,name:string,fullName:string,facet:TagDefinition['facet']='component',aliases:string[]=[]):TagDefinition {
  return {id,name,fullName,facet,description:`Scientific scope of ${fullName}.`,aliases,broaderIds:[],relatedIds:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',matchingMode:'auto'};
}
function candidate(key:string,name:string,facet:TagDefinition['facet']='component',fullName=name){return {key,name,fullName,facet,description:`Scientific scope of ${fullName}.`,aliases:[] as string[],parentKeys:[] as string[],relatedKeys:[] as string[],routingRefs:['R1']};}
function fixture(definitions:TagDefinition[]=[]) {
  const facts:PaperFacts[]=[{paperId:'synthetic-paper',metadataFingerprint:'metadata',inputFingerprint:'input',provider:'cache',model:'cached',extractionVersion:1,summary:'An experiment characterizes membrane texture and ion transport.',needsPDF:false,concepts:[{name:'membrane texture',facet:'component',evidence:[{source:'abstract',text:'The membrane texture controls the measured ion transport.'}]}]}];
  const snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog());
  return createTagSelection(facts,definitions,snapshot,{targetCount:8,additionalTargetCount:8,maxOutputTokens:4096,...(definitions.length?{baseline:captureVocabularyBaseline(definitions,2)}:{})});
}
function reply(work:TagSelectionWork,raw:unknown){const request=nextSelectionRequests(work)[0];return acceptSelectionResult(noteSelectionDispatch(work,request.id),request.id,raw,{provider:'synthetic',model:'selected-model'});}

test('Extend resolves current keys and saved names, full names, approved aliases and acronym references without merging subtypes',()=>{
  const fc=definition('saved-fc','FC','fuel cell','system'),aemfc={...definition('saved-aemfc','AEMFC','anion exchange membrane fuel cell','system'),broaderIds:[fc.id]},definitions=[definition('saved-aem','AEM','anion exchange membrane'),definition('saved-pem','PEM','proton exchange membrane'),definition('saved-oer','OER','oxygen evolution reaction','phenomenon'),definition('saved-ptl','PTL','porous transport layer','component',['porous transport substrate']),fc,aemfc],before=fingerprint(definitions);
  const membrane={...candidate('membrane','membrane texture'),parentKeys:['aem'],relatedKeys:['oer','proton exchange membrane','porous transport substrate','PTL']},ptl=candidate('current-ptl','PTL','component','porous transport layer'),selected=reply(fixture(definitions),{tags:[membrane,ptl]}),tag=selected.plan!.find(tag=>tag.name==='membrane texture')!;
  assert.equal(selected.status,'mapping');assert.deepEqual(tag.broaderIds,['saved-aem']);assert.deepEqual(new Set(tag.relatedIds),new Set(['saved-oer','saved-pem','saved-ptl']));
  for(const saved of definitions)assert.deepEqual(selected.plan!.find(tag=>tag.id===saved.id),saved);
  assert.notEqual(fc.id,aemfc.id);assert.equal(selected.plan!.filter(tag=>tag.name==='PTL').length,1);assert.equal(fingerprint(definitions),before);
  assert.ok(Object.values(selected.proposal!.support).every(support=>!support.sourceIds?.length&&!support.paperIds.length),'Graph reference resolution grants no factual coverage.');
  assert.equal(validTagSelectionWork(JSON.parse(JSON.stringify(selected))),true);
  const prompt=nextSelectionRequests(fixture(definitions))[0].prompt;assert.match(prompt,/only keys present in this response or literal IDs from existingVocabulary/);
});

test('literal saved IDs outrank colliding temporary keys, while exact current keys outrank labels',()=>{
  const saved=definition('saved-id','OER','oxygen evolution reaction','phenomenon'),raw={tags:[candidate('saved-id','membrane texture'),{...candidate('observer','transport structure'),relatedKeys:['saved-id','current-target']},candidate('current-target','support morphology')]},selected=reply(fixture([saved]),raw),observer=selected.plan!.find(tag=>tag.name==='transport structure')!;
  assert.equal(selected.status,'mapping');assert.ok(observer.relatedIds!.includes(saved.id));assert.ok(!observer.relatedIds!.includes(selected.candidateIds['saved-id']));assert.ok(observer.relatedIds!.includes(selected.candidateIds['current-target']));
});

test('missing parent and optional contextual references are quarantined without case-folding Co into CO',()=>{
  const raw={tags:[candidate('cobalt','Co','component','cobalt'),candidate('carbon-monoxide','CO','component','carbon monoxide'),{...candidate('membrane','membrane texture'),parentKeys:['omitted-parent'],relatedKeys:['co','Co','CO','old-optional-slug']}]},selected=reply(fixture(),raw),tag=selected.plan!.find(tag=>tag.name==='membrane texture')!;
  assert.equal(selected.status,'mapping');assert.deepEqual(tag.broaderIds,[]);assert.deepEqual(new Set(tag.relatedIds),new Set([selected.candidateIds.cobalt,selected.candidateIds['carbon-monoxide']]));assert.ok(selected.diagnostics.some(message=>message.includes('Quarantined')&&message.includes('omitted-parent')));assert.ok(selected.diagnostics.some(message=>message.includes('unresolved')&&message.includes(' to co;')));assert.ok(selected.diagnostics.some(message=>message.includes('old-optional-slug')));assert.equal(nextSelectionRequests(selected)[0].kind,'map');
});

test('resolved cycles and scientifically incompatible aliases still reject the complete choice',()=>{
  const cycle=reply(fixture(),{tags:[{...candidate('a','membrane texture'),parentKeys:['b']},{...candidate('b','membrane structure'),parentKeys:['a']}]});assert.equal(cycle.status,'choosing');assert.match(cycle.tasks[0].error!,/cycle/);assert.equal(cycle.plan,undefined);
  const aliases=reply(fixture(),{tags:[{...candidate('cobalt','Co','component','cobalt'),aliases:['CO']}]});assert.equal(aliases.status,'choosing');assert.match(aliases.tasks[0].error!,/scientifically distinct/);assert.equal(aliases.plan,undefined);
});

test('Resume and Retry recover the newest valid saved reply when a later complete reply has a real alias conflict',()=>{
  const saved=definition('saved-aem','AEM','anion exchange membrane');let work=fixture([saved]);
  for(let index=0;index<4;index++)work=reply(work,{tags:[{...candidate('membrane','membrane texture'),parentKeys:['membrane']}]});
  assert.equal(work.status,'failed');
  work.tasks[0].attempts[2].raw={tags:[{...candidate('membrane','membrane texture'),parentKeys:['aem'],relatedKeys:['omitted-context']}]};
  work.tasks[0].attempts[2].error='Historical parser rejected a lowercase reference to a saved label.';
  work.tasks[0].attempts[3].raw={tags:[candidate('membrane','membrane texture'),{...candidate('other','different membrane structure'),aliases:['membrane texture']}]};
  work.tasks[0].attempts[3].error='An ambiguous alias conflicts with another proposed meaning.';
  const before=fingerprint(work),attempts=structuredClone(work.tasks[0].attempts),ids=structuredClone(work.candidateIds);
  for(const recovered of [resumeTagSelection(JSON.parse(JSON.stringify(work))),retryTagSelection(JSON.parse(JSON.stringify(work)))]){
    assert.equal(recovered.status,'mapping');assert.deepEqual(recovered.tasks[0].attempts,attempts);assert.deepEqual(recovered.candidateIds,ids);assert.equal(recovered.automaticRequests,4);assert.equal(recovered.tasks[0].dispatches,4);assert.equal(recovered.tasks[0].invalidResponses,4);assert.deepEqual(recovered.plan!.find(tag=>tag.name==='membrane texture')!.broaderIds,[saved.id]);assert.ok(recovered.diagnostics.some(message=>message.includes('reply 3 of 4')));assert.equal(nextSelectionRequests(recovered)[0].kind,'map');assert.equal(validTagSelectionWork(recovered),true);
  }
  assert.equal(fingerprint(work),before);
});
