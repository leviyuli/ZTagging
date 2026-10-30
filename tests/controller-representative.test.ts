import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import {createRegistrySnapshot,ensureFactConceptIds} from '../src/evidence.ts';
import {acceptSelectionResult,createTagSelection,nextSelectionRequests,noteSelectionDispatch} from '../src/tag-selection.ts';
import type {PaperFacts} from '../src/taxonomy.ts';

const clone=<T>(value:T):T=>structuredClone(value);
interface Input {selectionPhase:'choosing'|'mapping';requestId:string;conceptRegistry?:{registryId:string;sources:{label:string;facet:string}[]}[];tags?:TagDefinition[];sources?:{sourceId:string;registryId:string;paperId:string;name:string}[];requestedPairs?:{tagId:string;sourceId:string;registryId:string}[]}
function library() {
  const state=initialState();state.settings.model='representative-synthetic';state.settings.coreConceptLimit=60;
  for(let index=0;index<90;index++){
    const concepts=Array.from({length:4},(_,position)=>{const name=`synthetic phenomenon ${(index*4+position)%60}`;return {name,facet:'phenomenon' as const,evidence:[{source:'abstract' as const,text:`The experiment establishes ${name} through repeated measurements of the reported response.`}]};});
    const paper:PaperRecord={id:`1:EXAMPLE${index}`,itemID:index+1,libraryID:1,key:`EXAMPLE${index}`,title:`Synthetic representative study ${index}`,abstract:concepts.map(concept=>concept.evidence[0].text).join(' '),keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
    const facts:PaperFacts={paperId:paper.id,metadataFingerprint:paper.fingerprint,inputFingerprint:paper.fingerprint,provider:'chatgpt',model:state.settings.model,extractionVersion:1,summary:'Repeated measurements establish the supplied synthetic phenomena.',concepts,needsPDF:false};
    state.papers[paper.id]=paper;state.facts[paper.id]=facts;state.nativeTags[paper.id]=[{tag:'My project',type:0}];
  }
  ensureFactConceptIds(Object.values(state.facts));return state;
}
function response(input:Input) {
  if(input.selectionPhase==='choosing')return {tags:input.conceptRegistry!.map((entry,index)=>({key:`topic-${index}`,name:entry.sources[0].label,fullName:entry.sources[0].label,description:`Experimental study of ${entry.sources[0].label}.`,facet:entry.sources[0].facet,aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[entry.registryId]})),merges:[],excluded:[]};
  if(input.requestedPairs)return {judgements:input.requestedPairs.map(pair=>({tagId:pair.tagId,registryId:pair.registryId,sourceIds:[pair.sourceId],relation:input.tags!.find(tag=>tag.id===pair.tagId)!.name===input.sources!.find(source=>source.sourceId===pair.sourceId)!.name?'equivalent':'unrelated',reason:'The supplied full quotation is checked for this exact source and tag meaning.'}))};
  const judgements=[],outside=[];
  for(const source of input.sources!){const tag=input.tags!.find(tag=>tag.name===source.name);if(tag)judgements.push({tagId:tag.id,registryId:source.registryId,sourceIds:[source.sourceId],relation:'equivalent',reason:'The complete original finding establishes this selected topic.'});else outside.push({sourceIds:[source.sourceId],disposition:'outside-core',reason:'The finding is outside the legacy chosen list.'});}
  return {judgements,outside};
}
function seedLegacy(state:AppState) {
  state.settings.coreConceptLimit=120;
  const facts=Object.values(state.facts).sort((a,b)=>a.paperId.localeCompare(b.paperId)),snapshot=createRegistrySnapshot(facts,state.evidenceCatalog),existing=state.tags;
  let work=createTagSelection(facts,existing,snapshot,{plannerVersion:3,targetCount:120,maxOutputTokens:state.settings.maxOutputTokens,baseVersion:0});
  const request=nextSelectionRequests(work)[0],input:Input=JSON.parse(request.prompt.split('INPUT_DATA_JSON:\n')[1]);work=acceptSelectionResult(noteSelectionDispatch(work,request.id),request.id,response(input));
  state.run={id:'legacy-representative-switch',kind:'rebuild',scope:'library',automatic:false,status:'paused',jobs:facts.map(fact=>({id:`job-${fact.paperId}`,paperId:fact.paperId,status:'completed'})),vocabCursor:0,vocabFinished:false,message:'Legacy source checks are paused.',spentUSD:0.25,settings:clone(state.settings),vocabularyVersion:0,selection:work,selectionInputFingerprint:fingerprint({protocolVersion:2,facts,existing,limit:120,baseVersion:0})};
}
function harness(state=library(),respond?:(input:Input,signal?:AbortSignal)=>Promise<unknown>) {
  const calls:Input[]=[];let running=0,peak=0,writes=0,extractions=0;
  const env:ControllerEnvironment={host:{async list(){return clone(Object.values(state.papers));},async read(id){return clone(Object.values(state.papers).find(paper=>paper.itemID===id)??null);},async readTags(){return [{tag:'My project',type:0}];},async pdfText(){return '';},async apply(){writes++;throw new Error('Building tags cannot write native data.');},async show(){},async saveSearch(){}},ai:{async completeJson(_system,prompt,_settings,signal){const input:Input=JSON.parse(prompt.slice(prompt.lastIndexOf('INPUT_DATA_JSON:')+'INPUT_DATA_JSON:'.length));if(!input.selectionPhase){extractions++;throw new Error('Completed facts must be reused.');}calls.push(clone(input));running++;peak=Math.max(peak,running);try{await new Promise<void>(resolve=>setImmediate(resolve));const value=respond?await respond(input,signal):response(input);return {value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:10,outputTokens:10},estimatedCostUSD:0.002};}finally{running--;}
  },async hasApiKey(){return true;},async getSession(){return {connected:true,sharing:true,email:null,accountId:null,accounts:[]};},async testConnection(){throw new Error('No account test');},async listModels(){return [];},async setApiKey(){},async removeApiKey(){},async signIn(){throw new Error('No sign-in');},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}},persist:async()=>{}};
  return {state,calls,controller:new AppController(state,env),peak:()=>peak,writes:()=>writes,extractions:()=>extractions};
}

test('new builds verify examples instead of every finding and Apply saves definitions without assignment',async()=>{
  const h=harness(),facts=fingerprint(h.state.facts),native=fingerprint(h.state.nativeTags);await h.controller.invoke('prepare-tags',{scope:'library'});await h.controller.waitForIdle();
  assert.equal(h.state.run!.status,'idle',h.state.run!.message);assert.equal(h.state.run!.selection!.policyVersion,4);assert.equal(h.state.tagPreparation!.status,'ready');
  const view=await h.controller.snapshot();assert.equal(view.tagPreparation!.verificationScope,'representative');assert.ok(view.queue.selection!.examplesTotal!<=180);assert.equal(view.queue.selection!.examplesChecked,view.queue.selection!.examplesTotal);assert.ok(h.calls.length<=6);assert.equal(h.calls.filter(call=>call.selectionPhase==='choosing').length,1);assert.equal(h.peak(),2);
  assert.ok(Object.values(h.state.run!.selection!.sourceLedger).some(source=>source.status==='unexamined'));assert.equal(fingerprint(h.state.facts),facts);assert.equal(fingerprint(h.state.nativeTags),native);assert.equal(h.extractions(),0);assert.equal(h.writes(),0);
  const calls=h.calls.length;await h.controller.invoke('apply-tag-list',{id:view.tagPreparation!.id});assert.equal(h.calls.length,calls);assert.equal(h.writes(),0);assert.equal(h.state.taxonomyReview!.verificationScope,'representative');assert.equal(h.state.settings.autoAssign,false);assert.equal(validState(h.state),true);
});

test('a paused legacy build reranks its paid draft without another chooser or extraction',async()=>{
  const state=library();seedLegacy(state);const old=clone(state.run!.selection!),facts=fingerprint(state.facts),h=harness(state);await h.controller.invoke('use-faster-build',{targetCount:60});await h.controller.waitForIdle();
  assert.equal(state.run!.status,'idle',state.run!.message);assert.equal(state.run!.selection!.policyVersion,4);assert.ok(h.calls.length>0&&h.calls.every(call=>call.selectionPhase==='mapping'));assert.equal(state.settings.coreConceptLimit,60);assert.equal(state.run!.settings.coreConceptLimit,60);assert.equal(fingerprint(state.facts),facts);assert.equal(h.extractions(),0);assert.equal(h.writes(),0);assert.ok(state.run!.spentUSD>=0.25);assert.ok(state.tagSelectionHistory!.some(entry=>fingerprint(entry.work)===fingerprint(old)));
  for(const tag of state.run!.selection!.plan!)assert.ok(old.plan!.some(previous=>previous.id===tag.id));
});

test('switching waits for active legacy replies, stops dispatching and keeps their charges and proofs',async()=>{
  const state=library();seedLegacy(state);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});let oldCalls=0,aborted=false;
  const h=harness(state,async(input,signal)=>{if(!input.requestedPairs){oldCalls++;if(oldCalls===2)entered();signal?.addEventListener('abort',()=>{aborted=true;});await gate;}return response(input);});
  await h.controller.invoke('resume');await started;await h.controller.invoke('use-faster-build',{targetCount:60});assert.equal((await h.controller.snapshot()).queue.switchingToFasterBuild,true);assert.equal(oldCalls,2);assert.equal(aborted,false);
  release();await h.controller.waitForIdle();assert.equal(state.run!.status,'idle',state.run!.message);assert.equal(oldCalls,2);assert.equal(aborted,false);assert.equal(state.run!.selection!.policyVersion,4);assert.ok(state.tagSelectionHistory!.some(entry=>entry.work.tasks.filter(task=>task.kind==='map'&&task.status==='completed').length===2));assert.ok(Math.abs(state.run!.spentUSD-(0.25+h.calls.length*0.002))<1e-10);assert.equal(h.writes(),0);
});

test('a persisted faster-build request resumes after restart without a new global request',async()=>{
  const state=library();seedLegacy(state);state.run!.fasterBuild={targetCount:60,requestedAt:'2026-10-30T04:00:00.000Z'};state.run!.status='running';const restored=harness(JSON.parse(JSON.stringify(state)));await restored.controller.initialize();assert.equal(restored.calls.length,0);await restored.controller.invoke('resume');await restored.controller.waitForIdle();assert.equal(restored.state.run!.status,'idle',restored.state.run!.message);assert.equal(restored.state.run!.selection!.policyVersion,4);assert.ok(restored.calls.every(call=>call.selectionPhase==='mapping'));assert.equal(restored.extractions(),0);assert.equal(restored.writes(),0);
});

test('budget rejection after switching retains paid work and consumes no new dispatch',async()=>{
  const state=library();seedLegacy(state);Object.assign(state.settings,{provider:'deepseek',inputPricePerMillion:1,outputPricePerMillion:1,budgetUSD:0.250001});state.run!.settings=clone(state.settings);const oldRequests=state.run!.selection!.automaticRequests,h=harness(state);await h.controller.invoke('use-faster-build',{targetCount:60});await h.controller.waitForIdle();assert.equal(state.run!.status,'paused');assert.match(state.run!.message,/budget/i);assert.equal(h.calls.length,0);assert.equal(state.run!.spentUSD,0.25);assert.equal(state.run!.selection!.automaticRequests,oldRequests);assert.equal(state.run!.selection!.policyVersion,4);assert.equal(h.writes(),0);
});
