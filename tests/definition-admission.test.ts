import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import type {TagDefinition} from '../src/core.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot} from '../src/evidence.ts';
import {createTaxonomyProposal} from '../src/taxonomy.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import {prepare,validTagPreparationState} from '../src/tag-preparation.ts';
import {compileReadyPreparedDefinitions} from '../src/definition-admission.ts';

function fixture(names=['proton transport','electron transport']) {
  const facts:PaperFacts[]=names.map((name,index)=>({paperId:`paper-${index}`,metadataFingerprint:`metadata-${index}`,inputFingerprint:`input-${index}`,provider:'original',model:'original',extractionVersion:1,summary:`This paper measures ${name}.`,needsPDF:false,concepts:[{name,facet:'phenomenon',evidence:[{source:'abstract',text:`The experiments measure ${name} in the studied material.`}]}]}));
  const snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog());
  const proposal=createTaxonomyProposal({tags:names.map((name,index)=>({key:`tag-${index}`,name,fullName:name,description:`Scientific study of ${name}.`,facet:'phenomenon',supportRegistryIds:Object.values(snapshot.entries).filter(entry=>entry.sourceIds.some(id=>snapshot.sources[id].name===name)).map(entry=>entry.registryId)}))},facts,[],{snapshot});
  return prepare(proposal,undefined,{processingPolicy:'auto-clear'});
}
function question(result:ReturnType<typeof fixture>,tagId:string) {
  result.state.status='questions';result.state.questions.push({id:`question-${tagId}`,tagId,title:'Which scientific meaning applies?',description:'The intended scope needs a choice.',paperIds:[],sourceIds:[],choices:[],kind:'meaning',contextFingerprint:'unchanged'});
}

test('clear definitions are additive while unrelated questions and their exact source identities remain intact',()=>{
  const result=fixture(),[clear,uncertain]=result.proposal.tags;question(result,uncertain.id);
  clear.relatedIds=[uncertain.id];
  const before=fingerprint(result),compiled=compileReadyPreparedDefinitions(result.proposal,result.state,[]);
  assert.deepEqual(compiled.tagIds,[clear.id]);assert.deepEqual(compiled.deferredIds,[uncertain.id]);
  assert.equal(compiled.definitions[0].status,'approved');assert.deepEqual(compiled.definitions[0].relatedIds,[]);
  assert.deepEqual(compiled.support[clear.id].sourceIds,result.proposal.support[clear.id].sourceIds);
  assert.deepEqual(Object.keys(compiled.review.paperFingerprints!),compiled.support[clear.id].paperIds);
  assert.equal(fingerprint(result),before);
  const saved:TagDefinition={...compiled.definitions[0],id:'researcher-tag',name:'Researcher scope',fullName:'Researcher scope',description:'An independent saved meaning.',custom:true,matchingMode:'manual'};
  const withSaved=compileReadyPreparedDefinitions(result.proposal,result.state,[saved]);assert.deepEqual(withSaved.definitions,compiled.definitions);assert.equal(saved.matchingMode,'manual');
});

test('an unresolved required parent holds its child without holding independent ready definitions',()=>{
  const result=fixture(['transport response','proton transport','electron transport']),[parent,child,independent]=result.proposal.tags;
  child.broaderIds=[parent.id];question(result,parent.id);
  const compiled=compileReadyPreparedDefinitions(result.proposal,result.state,[]);
  assert.deepEqual(compiled.tagIds,[independent.id]);assert.deepEqual(new Set(compiled.deferredIds),new Set([parent.id,child.id]));
});

test('inherited evidence cannot save an otherwise unsupported parent while its supporting child remains unresolved',()=>{
  const result=fixture(['proton transport']),child=result.proposal.tags[0],parent={...structuredClone(child),id:'generated-parent',name:'transport response',fullName:'transport response',description:'The transport response of the material.',aliases:[]};
  result.proposal.tags.unshift(parent);result.proposal.support[parent.id]={registryIds:[],paperIds:[],sourceIds:[]};child.broaderIds=[parent.id];question(result,child.id);
  assert.deepEqual(compileReadyPreparedDefinitions(result.proposal,result.state,[]).definitions,[]);
});

test('a ready hierarchy is admitted with the exact child evidence inherited by its required parent',()=>{
  const result=fixture(['proton transport']),child=result.proposal.tags[0],parent={...structuredClone(child),id:'generated-parent',name:'transport response',fullName:'transport response',description:'The transport response of the material.',aliases:[]};
  result.proposal.tags.unshift(parent);result.proposal.support[parent.id]={registryIds:[],paperIds:[],sourceIds:[]};child.broaderIds=[parent.id];
  const compiled=compileReadyPreparedDefinitions(result.proposal,result.state,[]);
  assert.deepEqual(new Set(compiled.tagIds),new Set([parent.id,child.id]));
  assert.deepEqual(compiled.support[parent.id].sourceIds,compiled.support[child.id].sourceIds);
  assert.deepEqual(compiled.definitions.find(tag=>tag.id===child.id)!.broaderIds,[parent.id]);
});

test('saved names and meanings win label conflicts without preventing an unrelated candidate admission',()=>{
  const result=fixture(),[conflict,independent]=result.proposal.tags;
  const saved:TagDefinition={...structuredClone(conflict),id:'saved',status:'approved',description:'A protected different meaning.',matchingMode:'manual'};
  const before=fingerprint(saved),compiled=compileReadyPreparedDefinitions(result.proposal,result.state,[saved]);
  assert.deepEqual(compiled.tagIds,[independent.id]);assert.deepEqual(compiled.deferredIds,[conflict.id]);assert.equal(fingerprint(saved),before);
});

test('admission history suppresses automatic recreation after undo, deletion, or later researcher edits',()=>{
  const result=fixture(),first=compileReadyPreparedDefinitions(result.proposal,result.state,[]);
  result.state.admissions=Object.fromEntries(first.definitions.map(tag=>[tag.id,{definitionFingerprint:fingerprint(tag),changeId:'admission-change'}]));
  result.state.shelfId='generated-shelf';assert.equal(validTagPreparationState(result.state),true);
  assert.deepEqual(compileReadyPreparedDefinitions(result.proposal,JSON.parse(JSON.stringify(result.state)),[]).definitions,[]);
  const edited=first.definitions.map(tag=>({...tag,description:'The researcher changed the scientific scope.'}));
  assert.deepEqual(compileReadyPreparedDefinitions(result.proposal,result.state,edited).definitions,[]);
});

test('a pending exact-source check holds only its owning candidate',()=>{
  const result=fixture(),[pending,ready]=result.proposal.tags;
  const compiled=compileReadyPreparedDefinitions(result.proposal,result.state,[],{pendingTagIds:[pending.id]});
  assert.deepEqual(compiled.tagIds,[ready.id]);assert.deepEqual(compiled.deferredIds,[pending.id]);
});

test('automatically skipped meanings still hold required children after their review questions are removed',()=>{
  const result=fixture(['transport response','proton transport','electron transport']),[parent,child,independent]=result.proposal.tags;
  child.broaderIds=[parent.id];result.state.buildPolicyVersion=1;result.state.skippedTagIds=[parent.id];result.state.questions=[];
  const compiled=compileReadyPreparedDefinitions(result.proposal,result.state,[]);
  assert.deepEqual(compiled.tagIds,[independent.id]);assert.deepEqual(new Set(compiled.deferredIds),new Set([parent.id,child.id]));
  assert.equal(validTagPreparationState(result.state),true);
  for(const mutate of [(state:any)=>state.buildPolicyVersion=2,(state:any)=>state.skippedTagIds=[0]]){const changed=structuredClone(result.state);mutate(changed);assert.equal(validTagPreparationState(changed),false);}
});

test('optional auto-clear checkpoint fields validate without changing legacy preparation defaults',()=>{
  const result=fixture();assert.equal(result.state.processingPolicy,'auto-clear');
  const historical=structuredClone(result.state);delete historical.processingPolicy;assert.equal(validTagPreparationState(historical),true);assert.deepEqual(compileReadyPreparedDefinitions(result.proposal,historical,[]).definitions,[]);
  for(const change of [(state:any)=>state.processingPolicy='always',(state:any)=>state.shelfId=0,(state:any)=>state.admissions={tag:{definitionFingerprint:'',changeId:'change'}},(state:any)=>state.admissions={tag:{definitionFingerprint:'meaning'}}]){
    const broken=structuredClone(result.state);change(broken);assert.equal(validTagPreparationState(broken),false);
  }
});
