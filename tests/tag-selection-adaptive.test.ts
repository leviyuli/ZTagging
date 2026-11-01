import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import type {TagDefinition} from '../src/core.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot} from '../src/evidence.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import {captureVocabularyBaseline} from '../src/vocabulary-extension.ts';
import {createTagSelection,nextSelectionRequests,noteSelectionDispatch,acceptSelectionResult,resumeTagSelection,validTagSelectionWork} from '../src/tag-selection.ts';
import type {TagSelectionWork} from '../src/tag-selection.ts';

function fixture(names=Array.from({length:6},(_,index)=>`transport pathway ${index}`)) {
  const facts:PaperFacts[]=[{paperId:'one-paper',metadataFingerprint:'metadata',inputFingerprint:'input',extractionVersion:1,provider:'retained',model:'retained',summary:'Several distinct transport mechanisms were measured.',needsPDF:false,concepts:names.map(name=>({name,facet:'phenomenon',evidence:[{source:'abstract',text:`The experimental study establishes ${name} in this material.`}]}))}];
  return {facts,snapshot:createRegistrySnapshot(facts,createEmptyEvidenceCatalog())};
}
const input=(work:TagSelectionWork)=>JSON.parse(nextSelectionRequests(work)[0].prompt.split('INPUT_DATA_JSON:\n')[1]);
function choose(work:TagSelectionWork,tags:unknown[]) {const request=nextSelectionRequests(work)[0];return acceptSelectionResult(noteSelectionDispatch(work,request.id),request.id,{tags});}
function drafts(work:TagSelectionWork) {return input(work).conceptRegistry.map((entry:any,index:number)=>({key:`concept-${index}`,name:entry.sources[0].label,fullName:entry.sources[0].label,description:`Scientific study of ${entry.sources[0].label}.`,facet:'phenomenon',parentKeys:[],relatedKeys:[],routingRefs:[entry.ref]}));}

test('adaptive planning has an upper bound without a requested count and retains significant singleton concepts',()=>{
  const f=fixture(),adaptive=createTagSelection(f.facts,[],f.snapshot,{adaptivePolicyVersion:1,targetCount:10,maxOutputTokens:4096});
  const request=nextSelectionRequests(adaptive)[0],data=input(adaptive);
  assert.equal(data.maximumNewTags,10);assert.equal('targetCount' in data,false);assert.equal('coreLimit' in data,false);
  assert.match(request.prompt,/smallest useful set/);assert.match(request.prompt,/single paper/);assert.doesNotMatch(request.prompt,/Aim for about 10/);
  assert.equal(adaptive.shortlist.length,6,'A fourth concept from the same paper and facet must remain available.');
  const selected=choose(adaptive,drafts(adaptive));assert.equal(selected.plan!.length,6);assert.ok(selected.plan!.length<adaptive.targetCount,'The maximum never pads a proposal.');
  assert.equal(validTagSelectionWork(JSON.parse(JSON.stringify(selected))),true);
  const historical=createTagSelection(f.facts,[],f.snapshot,{targetCount:10,maxOutputTokens:4096});assert.equal(historical.shortlist.length,3);assert.equal(historical.adaptivePolicyVersion,undefined);
  assert.notEqual(adaptive.fingerprint,historical.fingerprint);
});

test('the adaptive maximum counts required new ancestors without changing the legacy soft target',()=>{
  const f=fixture(['proton transport','electron transport']);
  const work=createTagSelection(f.facts,[],f.snapshot,{adaptivePolicyVersion:1,targetCount:1,maxOutputTokens:4096}),data=input(work),ref=(name:string)=>data.conceptRegistry.find((entry:any)=>entry.sources[0].label===name).ref;
  const selected=choose(work,[{key:'parent',name:'broad response',fullName:'broad response',description:'A broad scientific response.',facet:'phenomenon',parentKeys:[],relatedKeys:[]},{key:'child',name:'proton transport',fullName:'proton transport',description:'Scientific study of proton transport.',facet:'phenomenon',parentKeys:['parent'],relatedKeys:[],routingRefs:[ref('proton transport')]},{key:'independent',name:'electron transport',fullName:'electron transport',description:'Scientific study of electron transport.',facet:'phenomenon',parentKeys:[],relatedKeys:[],routingRefs:[ref('electron transport')]}]);
  assert.equal(selected.status,'mapping');assert.deepEqual(selected.plan!.map(tag=>tag.name),['electron transport']);assert.equal(selected.deferred!.length,2);
});

test('saved definitions are exempt from the adaptive additions maximum and keep their exact meanings',()=>{
  const f=fixture(['proton transport']),saved:TagDefinition={id:'saved-parent',name:'transport response',fullName:'transport response',description:'The researcher-defined broad transport response.',facet:'phenomenon',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],status:'approved',custom:false,matchingMode:'manual'},baseline=captureVocabularyBaseline([saved],4);
  const work=createTagSelection(f.facts,[saved],f.snapshot,{adaptivePolicyVersion:1,targetCount:60,additionalTargetCount:1,maxOutputTokens:4096,baseline}),data=input(work);
  assert.equal(data.maximumNewTags,1);assert.equal('additionalTargetCount' in data,false);
  const selected=choose(work,[{key:'child',name:'proton transport',fullName:'proton transport',description:'Scientific study of proton transport.',facet:'phenomenon',aliases:[],parentKeys:[saved.id],relatedKeys:[],routingRefs:[data.conceptRegistry[0].ref]}]);
  assert.equal(selected.status,'mapping');assert.equal(selected.plan!.length,2);assert.deepEqual(selected.plan!.find(tag=>tag.id===saved.id),saved);assert.equal(selected.plan!.filter(tag=>tag.id!==saved.id).length,1);
});

test('restart preserves adaptive decisions and unsupported adaptive policy versions are rejected',()=>{
  const f=fixture(),work=createTagSelection(f.facts,[],f.snapshot,{adaptivePolicyVersion:1,targetCount:6,maxOutputTokens:4096}),selected=choose(work,drafts(work)),before=fingerprint(selected);
  const restored=resumeTagSelection(JSON.parse(JSON.stringify(selected)));assert.equal(restored.adaptivePolicyVersion,1);assert.deepEqual(restored.candidateIds,selected.candidateIds);assert.equal(fingerprint(selected),before);
  assert.equal(validTagSelectionWork({...restored,adaptivePolicyVersion:2}),false);
  assert.throws(()=>createTagSelection(f.facts,[],f.snapshot,{adaptivePolicyVersion:2 as 1,targetCount:6,maxOutputTokens:4096}),/Unsupported adaptive/);
  const legacy=createTagSelection(f.facts,[],f.snapshot,{targetCount:6,maxOutputTokens:4096});
  const converted=createTagSelection(f.facts,[],f.snapshot,{adaptivePolicyVersion:1,targetCount:6,maxOutputTokens:4096,previousWork:choose(legacy,drafts(legacy))});assert.equal(converted.adaptivePolicyVersion,undefined,'Converting retained work must preserve its original selection policy.');
});
