import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
import {ensureFactConceptIds} from '../src/evidence.ts';
import type {PaperFacts} from '../src/taxonomy.ts';

const clone=<T>(value:T):T=>structuredClone(value);
function paper(index:number):PaperRecord {
  const value:PaperRecord={id:`1:CACHE${index}`,itemID:index+1,libraryID:1,key:`CACHE${index}`,title:`Synthetic cache study ${index}`,abstract:`The experiment measures transport phenomenon ${index} in the reported material.`,keywords:[],fingerprint:''};value.fingerprint=paperFingerprint(value);return value;
}
function library() {
  const state=initialState();state.settings.model='synthetic-cache-model';state.settings.coreConceptLimit=2;
  for(let index=0;index<19;index++){const value=paper(index),fact:PaperFacts={paperId:value.id,metadataFingerprint:value.fingerprint,inputFingerprint:value.fingerprint,extractionVersion:1,provider:'retained-provider',model:'retained-model',summary:'An exact retained material transport measurement.',needsPDF:false,concepts:[{name:`transport phenomenon ${index}`,facet:'phenomenon',evidence:[{source:'abstract',text:value.abstract}]}]};state.papers[value.id]=value;state.facts[value.id]=fact;state.nativeTags[value.id]=[{tag:'My project',type:0}];}
  ensureFactConceptIds(Object.values(state.facts));return state;
}
interface Input {selectionPhase?:'choosing'|'mapping';paper?:{title:string;abstract:string};conceptRegistry?:{registryId:string;ref:string;sources:{label:string;facet:string}[]}[];tags?:{id:string;name:string}[];sources?:{sourceId:string;name:string}[];requestedPairs?:{tagId:string;sourceId:string;registryId:string}[]}
function harness(state=library()) {
  const calls:Input[]=[],saved:AppState[]=[];let selected=Object.values(state.papers),reads=0,writes=0;
  const env:ControllerEnvironment={host:{async list(){return clone(selected);},async read(id){reads++;return clone(selected.find(value=>value.itemID===id)??state.papers[`1:CACHE${id-1}`]??null);},async readTags(){return [{tag:'My project',type:0}];},async pdfText(){return '';},async apply(){writes++;throw new Error('Building tags cannot change native assignments.');},async show(){},async saveSearch(){}},ai:{async completeJson(_system,prompt){
    const input:Input=JSON.parse(prompt.slice(prompt.lastIndexOf('INPUT_DATA_JSON:')+'INPUT_DATA_JSON:'.length));calls.push(clone(input));let value:unknown;
    if(input.paper)value={summary:'The supplied experiment measures one transport phenomenon.',needsPDF:false,concepts:[{name:input.paper.abstract.match(/transport phenomenon \d+/)![0],facet:'phenomenon',evidence:[{source:'abstract',text:input.paper.abstract}]}]};
    else if(input.selectionPhase==='choosing')value={tags:input.conceptRegistry!.slice(0,2).map((entry,index)=>({key:`chosen-${index}`,name:entry.sources[0].label,fullName:entry.sources[0].label,description:`Experimental study of ${entry.sources[0].label}.`,facet:entry.sources[0].facet,aliases:[],parentKeys:[],relatedKeys:[],routingRefs:[entry.ref]}))};
    else value={judgements:input.requestedPairs!.map(pair=>({tagId:pair.tagId,registryId:pair.registryId,sourceIds:[pair.sourceId],relation:input.tags!.find(tag=>tag.id===pair.tagId)!.name===input.sources!.find(source=>source.sourceId===pair.sourceId)!.name?'equivalent':'unrelated',reason:'The exact supplied quotation establishes or excludes this requested scientific meaning.'}))};
    return {value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:10,outputTokens:10},estimatedCostUSD:0.001};
  },async hasApiKey(){return true;},async getSession(){return {connected:true,sharing:true,email:null,accountId:null,accounts:[]};},async testConnection(){throw new Error('No connection test.');},async listModels(){return [];},async setApiKey(){},async removeApiKey(){},async signIn(){throw new Error('No sign-in.');},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}},persist:async value=>{saved.splice(0,saved.length,clone(value));}};
  return {state,env,calls,saved,controller:new AppController(state,env),select:(papers:PaperRecord[])=>{selected=papers;},reads:()=>reads,writes:()=>writes};
}
async function build(h:ReturnType<typeof harness>,scope='library'){await h.controller.invoke('prepare-tags',{scope,mode:'replace'});await h.controller.waitForIdle();assert.equal(h.state.run!.status,'idle',h.state.run!.message);assert.equal(h.state.run!.selection!.status,'ready');}
function blockRead(h:ReturnType<typeof harness>,id:number){let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;}),read=h.env.host.read;h.env.host.read=async itemID=>{if(itemID===id){entered();await gate;}return read(itemID);};return {started,release:()=>release()};}

test('an unchanged ready build stays dormant while papers are checked and reuses paid work after pause and restart',async()=>{
  const h=harness();await build(h);const previous=clone(h.state.run!.selection!),calls=h.calls.length,facts=fingerprint(h.state.facts),block=blockRead(h,1);
  await h.controller.invoke('prepare-tags',{scope:'library',mode:'replace'});await block.started;
  const reading=await h.controller.snapshot();assert.equal(reading.queue.phase,'reading');assert.equal(reading.queue.selection,undefined);assert.equal(h.state.run!.selection,undefined);assert.deepEqual(reading.queue.phaseProgress,{completed:0,total:19,label:'Papers read'});assert.equal(reading.queue.completed,0);assert.equal(h.calls.length,calls);
  await h.controller.invoke('pause');block.release();await h.controller.waitForIdle();assert.equal(h.state.run!.status,'paused');assert.equal(h.calls.length,calls);assert.equal(validState(h.state),true);
  const restored=harness(JSON.parse(JSON.stringify(h.saved[0])));await restored.controller.initialize();assert.equal((await restored.controller.snapshot()).queue.selection,undefined);await restored.controller.invoke('resume');await restored.controller.waitForIdle();assert.equal(restored.state.run!.status,'idle',restored.state.run!.message);assert.equal(restored.calls.length,0);assert.equal(restored.state.run!.selection!.id,previous.id);assert.deepEqual(restored.state.run!.selection!.tasks,previous.tasks);assert.equal(fingerprint(restored.state.facts),facts);assert.equal(restored.writes(),0);assert.equal(validState(restored.state),true);
});

test('nineteen old papers do not contribute completed tag progress to twelve new papers across pause and restart',async()=>{
  const first=harness();await build(first);const previous=clone(first.state.run!.selection!),oldFacts=fingerprint(first.state.facts),oldCalls=first.calls.length,next=Array.from({length:12},(_,index)=>paper(index+19));first.select(next);const block=blockRead(first,next[1].itemID);
  await first.controller.invoke('prepare-tags',{scope:'selected',mode:'replace'});await block.started;
  const reading=await first.controller.snapshot();assert.equal(reading.queue.phase,'reading');assert.equal(reading.queue.selection,undefined);assert.equal(first.state.run!.selection,undefined);assert.deepEqual(reading.queue.phaseProgress,{completed:1,total:12,label:'Papers read'});assert.equal(reading.queue.total,12);assert.equal(reading.queue.completed,1);assert.equal(first.calls.slice(oldCalls).filter(input=>input.paper).length,1);assert.equal(first.calls.slice(oldCalls).filter(input=>input.selectionPhase).length,0);
  await first.controller.invoke('pause');block.release();await first.controller.waitForIdle();assert.equal(first.state.run!.status,'paused');assert.equal((await first.controller.snapshot()).queue.selection,undefined);assert.equal(validState(first.state),true);
  const completedPaper=next[0],completedFacts=clone(first.state.facts[completedPaper.id]),restored=harness(JSON.parse(JSON.stringify(first.saved[0])));restored.select(next);await restored.controller.initialize();
  const paused=await restored.controller.snapshot();assert.equal(paused.queue.phase,'reading');assert.equal(paused.queue.selection,undefined);assert.equal(restored.calls.length,0);
  await restored.controller.invoke('resume');await restored.controller.waitForIdle();assert.equal(restored.state.run!.status,'idle',restored.state.run!.message);assert.equal(restored.state.run!.selection!.status,'ready');assert.notEqual(restored.state.run!.selection!.snapshotId,previous.snapshotId);assert.deepEqual(new Set(restored.state.run!.selection!.snapshot.paperIds),new Set(next.map(value=>value.id)));assert.equal(restored.calls.filter(input=>input.paper).length,11);assert.ok(restored.calls.filter(input=>input.paper).every(input=>input.paper!.title!==completedPaper.title));assert.equal(restored.calls.filter(input=>input.selectionPhase==='choosing').length,1);assert.deepEqual(restored.state.facts[completedPaper.id],completedFacts);
  assert.equal(fingerprint(Object.fromEntries(Object.entries(restored.state.facts).filter(([id])=>!next.some(value=>value.id===id)))),oldFacts);assert.equal(restored.writes(),0);assert.equal(validState(restored.state),true);
});

test('a literal older checkpoint with a ready selector and pending new papers is hidden before initialization and detached on restart',async()=>{
  const prior=harness();await build(prior);const previous=clone(prior.state.run!.selection!),next=Array.from({length:12},(_,index)=>paper(index+19));
  for(const value of next){prior.state.papers[value.id]=value;prior.state.nativeTags[value.id]=[{tag:'My project',type:0}];}
  Object.assign(prior.state.run!,{status:'paused',scope:'selected',jobs:next.map(value=>({id:`new-${value.id}`,paperId:value.id,status:'pending'})),vocabFinished:false,message:'Reading the selected papers.'});
  const restored=harness(JSON.parse(JSON.stringify(prior.state)));restored.select(next);const before=await restored.controller.snapshot();assert.equal(before.queue.phase,'reading');assert.equal(before.queue.selection,undefined);assert.deepEqual(before.queue.phaseProgress,{completed:0,total:12,label:'Papers read'});
  await restored.controller.initialize();assert.equal(restored.state.run!.selection,undefined);assert.deepEqual(restored.state.run!.cachedSelection!.work,previous);assert.equal(restored.calls.length,0);assert.equal(validState(restored.state),true);
  await restored.controller.invoke('resume');await restored.controller.waitForIdle();assert.equal(restored.state.run!.status,'idle',restored.state.run!.message);assert.equal(restored.state.run!.cachedSelection,undefined);assert.equal(restored.calls.filter(input=>input.paper).length,12);assert.equal(restored.calls.filter(input=>input.selectionPhase==='choosing').length,1);assert.deepEqual(new Set(restored.state.run!.selection!.snapshot.paperIds),new Set(next.map(value=>value.id)));assert.ok(restored.state.tagSelectionHistory!.some(entry=>fingerprint(entry.work)===fingerprint(previous)));assert.equal(restored.writes(),0);
});

test('reset clears dormant selection work from the active run while keeping its complete audit record',async()=>{
  const h=harness();await build(h);const previous=clone(h.state.run!.selection!),native=fingerprint(h.state.nativeTags),calls=h.calls.length,block=blockRead(h,1);
  await h.controller.invoke('prepare-tags',{scope:'library',mode:'replace'});await block.started;await h.controller.invoke('pause');block.release();await h.controller.waitForIdle();assert.deepEqual(h.state.run!.cachedSelection!.work,previous);
  await h.controller.invoke('reset-paper-analysis');const state=h.controller.state,audit=state.analysisResetHistory!.at(-1)!;assert.equal(state.run!.cachedSelection,undefined);assert.equal(state.run!.selection,undefined);assert.deepEqual(state.facts,{});assert.deepEqual(audit.run!.cachedSelection!.work,previous);assert.equal(fingerprint(state.nativeTags),native);assert.equal(h.calls.length,calls);assert.equal(h.writes(),0);assert.equal(validState(state),true);
});
