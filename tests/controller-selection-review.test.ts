import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController, initialState } from '../src/controller.ts';
import type { ControllerEnvironment } from '../src/controller.ts';
import { canonicalTagKey, fingerprint, paperFingerprint } from '../src/core.ts';
import type { PaperRecord, TagDefinition } from '../src/core.ts';
import type { PaperFacts, TaxonomyProposal } from '../src/taxonomy.ts';

const copy = <T>(value:T):T => structuredClone(value);
interface Input {
  selectionPhase?: 'choosing' | 'mapping';
  paper?: Pick<PaperRecord,'title'|'abstract'>;
  conceptRegistry?: {registryId:string;sources:{label:string}[]}[];
  tags?: TagDefinition[];
  sources?: {sourceId:string;registryId:string;paperId:string;name:string}[];
}
interface MappingReply {judgements:{tagId:string;registryId:string;sourceIds:string[];relation:string;reason:string}[];outside:[]}
interface ProposalDocument {format:string;schemaVersion:number;sourceVocabularyFingerprint:string;proposal:TaxonomyProposal;facts:PaperFacts[]}
function mappingReply(input:Input):MappingReply {
  return {judgements:input.sources!.map(source=>{
    const exact=input.tags!.find(tag=>[tag.name,tag.fullName].filter(Boolean).some(name=>canonicalTagKey(name!)===canonicalTagKey(source.name))),tag=exact??input.tags!.find(tag=>tag.name==='FC')!;
    return {tagId:tag.id,registryId:source.registryId,sourceIds:[source.sourceId],relation:exact?'equivalent':'subtype',reason:'The complete quotation establishes this scientific meaning within the edited scope.'};
  }),outside:[]};
}
function fixture(hierarchy=false) {
  const state=initialState();state.tags=[];state.settings.model='review-synthetic';let selected=1,writes=0;
  const papers:PaperRecord[]=[1,2].map(index=>{
    const abstract=hierarchy?`A proton exchange membrane fuel cell transports protons through its polymer electrolyte in experiment ${index}.`:`The experiment studies synthetic transport response ${index}.`;
    const paper:PaperRecord={id:`1:REVIEW${index}`,itemID:index,libraryID:1,key:`REVIEW${index}`,title:`Synthetic review paper ${index}`,abstract,keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);return paper;
  });
  const calls:Input[]=[],documents:ProposalDocument[]=[];let map:(input:Input)=>MappingReply|Promise<MappingReply>=mappingReply;
  const env:ControllerEnvironment={
    host:{async list(){return [copy(papers[selected-1])];},async read(id){return copy(papers.find(paper=>paper.itemID===id)??null);},async readTags(){return [{tag:'Manual project',type:0}];},async pdfText(){return '';},async apply(){writes++;throw new Error('Review cannot write native tags.');},async show(){},async saveSearch(){}},
    ai:{async completeJson(_system,prompt){const input:Input=JSON.parse(prompt.slice(prompt.lastIndexOf('INPUT_DATA_JSON:')+'INPUT_DATA_JSON:'.length));calls.push(copy(input));let value:unknown;
      if(input.paper)value={summary:input.paper.abstract,concepts:[{name:hierarchy?'proton exchange membrane fuel cell':`synthetic transport response ${input.paper.title.split(' ').at(-1)}`,facet:hierarchy?'system':'phenomenon',evidence:[{source:'abstract',text:input.paper.abstract}]}],needsPDF:false};
      else if(input.selectionPhase==='choosing')value={tags:hierarchy?[{key:'fc',name:'FC',fullName:'fuel cell',description:'Fuel cell systems.',facet:'system',aliases:[],parentKeys:[],relatedKeys:[]},{key:'pemfc',name:'PEMFC',fullName:'proton exchange membrane fuel cell',description:'Proton exchange membrane fuel cell systems.',facet:'system',aliases:[],parentKeys:['fc'],relatedKeys:[]}]:input.conceptRegistry!.map((entry,index)=>({key:`topic-${index}`,name:entry.sources[0].label,fullName:entry.sources[0].label,description:'Synthetic experimental transport response.',facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[]})),merges:[],excluded:[]};
      else value=await map(input);
      return {value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:10,outputTokens:10},estimatedCostUSD:0};
    },async hasApiKey(){return false;},async getSession(){return {connected:true,sharing:true,email:null,accountId:null,accounts:[]};},async testConnection(){throw new Error('No connection test is required.');},async listModels(){return [];},async setApiKey(){},async removeApiKey(){},async signIn(){throw new Error('No sign-in is required.');},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}},
    persist:async()=>{},exportFile:async value=>{documents.push(copy(value as ProposalDocument));},
  };
  return {state,calls,documents,controller:new AppController(state,env),select:(id:number)=>{selected=id;},mapWith:(handler:typeof map)=>{map=handler;},writes:()=>writes};
}
async function build(h:ReturnType<typeof fixture>,id:number) {h.select(id);await h.controller.invoke('prepare-tags',{scope:'selected',mode:'replace'});await h.controller.waitForIdle();assert.equal(h.state.tagPreparation?.status,'ready',h.state.run?.message);}
async function importedFirstBuild(h:ReturnType<typeof fixture>) {
  await build(h,1);await h.controller.invoke('export-taxonomy-proposal',{id:h.state.taxonomyProposal!.id});await build(h,2);
  const oldWork=copy(h.state.run!.selection!);await h.controller.invoke('import-vocabulary',{value:h.documents[0]});return oldWork;
}

test('a presentation-only review edit retains source proofs without another mapping request',async()=>{
  const h=fixture();await build(h,1);const preparation=(await h.controller.snapshot()).tagPreparation!,tag=preparation.tags[0],support=copy(h.state.taxonomyProposal!.support[tag.id]),calls=h.calls.length;
  await h.controller.invoke('edit-prepared-tag',{id:preparation.id,tag:{...tag,name:'My transport topic'}});await h.controller.waitForIdle();
  assert.equal(h.calls.length,calls);assert.equal(h.state.taxonomyProposal!.tags.find(value=>value.id===tag.id)!.name,'My transport topic');assert.deepEqual(h.state.taxonomyProposal!.support[tag.id],support);assert.equal(h.state.tagPreparation!.status,'ready');assert.equal(h.writes(),0);
});

test('editing an imported meaning rechecks its papers and archives the unrelated previous work',async()=>{
  const h=fixture(),oldWork=await importedFirstBuild(h),facts=fingerprint(h.state.facts),calls=h.calls.length,preparation=(await h.controller.snapshot()).tagPreparation!,tag=preparation.tags[0],meaning='Synthetic transport response measured within a narrower experimental range.';
  await h.controller.invoke('edit-prepared-tag',{id:preparation.id,tag:{...tag,description:meaning}});await h.controller.waitForIdle();
  const next=h.calls.slice(calls);assert.ok(next.length>0);assert.ok(next.every(input=>input.selectionPhase==='mapping'));assert.ok(next.every(input=>input.sources!.every(source=>source.paperId==='1:REVIEW1')));assert.deepEqual(h.state.run!.jobs.map(job=>job.paperId),['1:REVIEW1']);assert.equal(h.state.run!.selection!.snapshotId,h.state.taxonomyProposal!.evidenceSnapshot!.id);
  assert.ok(h.state.tagSelectionHistory!.some(entry=>entry.work.id===oldWork.id&&fingerprint(entry.work)===fingerprint(oldWork)));assert.equal(h.state.taxonomyProposal!.tags.find(value=>value.id===tag.id)!.description,meaning);assert.equal(h.state.tagPreparation!.status,'ready');assert.equal(fingerprint(h.state.facts),facts);assert.equal(h.writes(),0);
});

test('an imported parent meaning cannot inherit child coverage until its own source check finishes',async()=>{
  const h=fixture(true),oldWork=await importedFirstBuild(h),preparation=(await h.controller.snapshot()).tagPreparation!,parent=preparation.tags.find(tag=>tag.name==='FC')!,child=preparation.tags.find(tag=>tag.name==='PEMFC')!,childProof=copy(h.state.taxonomyProposal!.support[child.id]);
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});const calls=h.calls.length;
  h.mapWith(async input=>{enter();await gate;return mappingReply(input);});
  await h.controller.invoke('edit-prepared-tag',{id:preparation.id,tag:{...parent,description:'Fuel-cell systems with polymer-electrolyte transport measurements.'}});
  try{await Promise.race([entered,h.controller.waitForIdle().then(()=>{throw new Error('The changed parent did not queue its source check.');})]);assert.equal((await h.controller.snapshot()).tagPreparation!.canApply,false);assert.equal(h.state.taxonomyProposal!.verificationScope,'representative');assert.ok(!h.state.taxonomyProposal!.tags.find(tag=>tag.id===child.id)!.broaderIds.includes(parent.id),'A changed parent meaning must not retain an unverified universal child relationship');assert.deepEqual(h.state.taxonomyProposal!.support[parent.id].paperIds,[]);assert.deepEqual(h.state.taxonomyProposal!.support[child.id],childProof);assert.ok(h.calls.slice(calls).every(input=>input.selectionPhase==='mapping'&&input.sources!.every(source=>source.paperId==='1:REVIEW1')));}
  finally{release();await h.controller.waitForIdle();}
  assert.ok(h.state.taxonomyProposal!.mappedSourceIds![parent.id].length>0);assert.deepEqual(h.state.taxonomyProposal!.support[parent.id].paperIds,['1:REVIEW1']);assert.equal(h.state.tagPreparation!.status,'ready');assert.ok(h.state.tagSelectionHistory!.some(entry=>entry.work.id===oldWork.id));assert.equal(h.writes(),0);
});

test('a second prepared edit is rejected before changing an in-flight review or poisoning its response queue',async()=>{
  const h=fixture();await build(h,1);let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});h.mapWith(async input=>{enter();await gate;return mappingReply(input);});
  let preparation=(await h.controller.snapshot()).tagPreparation!,tag=preparation.tags[0];await h.controller.invoke('edit-prepared-tag',{id:preparation.id,tag:{...tag,description:'First revised transport scope.'}});
  try{
    await Promise.race([entered,h.controller.waitForIdle().then(()=>{throw new Error('The first edited meaning did not queue its source check.');})]);preparation=(await h.controller.snapshot()).tagPreparation!;tag=preparation.tags[0];const before=fingerprint(h.state.run!.selection),choices=fingerprint(h.state.userEditedTagIds);
    await assert.rejects(h.controller.invoke('edit-prepared-tag',{id:preparation.id,tag:{...tag,description:'Second revised transport scope.'}}),/pause|finish|running/i);
    assert.equal(h.state.taxonomyProposal!.tags.find(value=>value.id===tag.id)!.description,'First revised transport scope.');assert.equal(fingerprint(h.state.run!.selection),before);assert.equal(fingerprint(h.state.userEditedTagIds),choices);
  }finally{release();await h.controller.waitForIdle();}
  assert.equal(h.state.run!.status,'idle');assert.equal(h.state.tagPreparation!.status,'ready');assert.deepEqual(h.state.run!.selectionReplies,[]);const calls=h.calls.length;await h.controller.invoke('resume');await h.controller.waitForIdle();assert.equal(h.calls.length,calls);assert.equal(h.state.run!.status,'idle');assert.deepEqual(h.state.run!.selectionReplies,[]);assert.equal(h.writes(),0);
});
