import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {assignmentAnalysisFingerprint,buildAnalysisPrompt,fingerprint,paperFingerprint,selectPDFPassages} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import type {NativeTag} from '../src/platform.ts';

const copy=<T>(value:T):T=>structuredClone(value);
const abstract='The experiments measure proton transport through the membrane under controlled humidity.';
const pdfQuote='The measured membrane proton transport is quantified independently by impedance spectroscopy.';
const definition=(id:string):TagDefinition=>({id,name:id,description:`Scientific meaning of ${id}.`,facet:'phenomenon',custom:false,status:'approved',matchingMode:'suggest',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[]});
type Input={approvedVocabulary:{id:string}[];paper:{title:string;abstract:string;pdf?:string};validatedFacts?:{summary:string;concepts:{name:string}[]}};
type Reply=(input:Input)=>unknown|Promise<unknown>;

function fixture(saved?:AppState,policy=false){
  const state=saved??initialState();
  if(!saved){state.tags=[definition('target'),definition('outside')];state.taxonomyReady=true;state.vocabularyVersion=3;state.tagShelves=[{id:'subset',name:'Chosen tags',kind:'user',tagIds:['target']}];Object.assign(state.settings,{provider:'chatgpt',model:'cache-model',budgetUSD:10,inputPricePerMillion:1,outputPricePerMillion:1});}
  const paper:PaperRecord={id:'1:PAPER',itemID:1,libraryID:1,key:'PAPER',title:'A membrane experiment',abstract,keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
  let pdf='',pdfReads=0,native:NativeTag[]=[{tag:'Manual project',type:0}],reply:Reply=input=>({summary:'A membrane transport measurement.',concepts:['proton transport'],needsPDF:false,newTagCandidates:[],suggestions:[{tagId:'target',reason:'The source directly describes this measurement.',confidence:'high',match:'substantive',evidence:[{source:input.paper.pdf?'pdf':'abstract',text:input.paper.pdf?pdfQuote:input.paper.abstract}]}]});
  const calls:Input[]=[],saves:AppState[]=[];
  const ai:ControllerEnvironment['ai']={async completeJson(_system,prompt){const input=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]) as Input;calls.push(copy(input));const value=await reply(input);return {value,text:JSON.stringify(value),usage:{inputTokens:20,outputTokens:20},usageKnown:true,estimatedCostUSD:0.001};},async hasApiKey(){return true;},async getSession(){return {connected:true,sharing:true,email:null,accountId:null,accounts:[]};},async listModels(){return [];},async testConnection(){throw new Error('Not used');},async setApiKey(){},async removeApiKey(){},async signIn(){throw new Error('Not used');},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}};
  const host:ControllerEnvironment['host']={async list(){return [copy(paper)];},async read(){return copy(paper);},async readTags(){return copy(native);},async pdfText(){pdfReads++;return pdf;},async apply(patches){for(const patch of patches){assert.deepEqual(native,patch.before);native=copy(patch.after);}},async show(){},async saveSearch(){}};
  const controller=new AppController(state,{ai,host,...(policy?{workflowPolicyVersion:1 as const}:{}),persist:async value=>{saves.push(copy(value));}});
  return {get state(){return controller.state;},paper,calls,saves,controller,setPDF:(value:string)=>{pdf=value;},pdfReads:()=>pdfReads,respond:(handler:Reply)=>{reply=handler;}};
}
async function assign(h:ReturnType<typeof fixture>){await h.controller.invoke('tag',{scope:'selected',tagShelfId:'subset',processingPolicy:'auto-clear'});await h.controller.waitForIdle();assert.equal(h.state.run!.status,'idle',h.state.run!.message);}
function facts(h:ReturnType<typeof fixture>,pdf?:string):PaperFacts {
  const source={...h.paper,...(pdf?{pdfText:selectPDFPassages(pdf,[],18000)}:{})};
  return {paperId:source.id,metadataFingerprint:paperFingerprint({...source,pdfText:undefined}),inputFingerprint:paperFingerprint(source),provider:'chatgpt',model:'facts-model',extractionVersion:1,summary:'A previously source-checked membrane experiment.',concepts:[{name:'proton transport',facet:'phenomenon',evidence:[{source:pdf?'pdf':'abstract',text:pdf?pdfQuote:abstract}]}],needsPDF:false};
}

test('an unchanged selected shelf reuses analysis after unrelated global vocabulary changes',async()=>{
  const h=fixture();await assign(h);await assign(h);assert.equal(h.calls.length,1);
  h.state.tags.push(definition('new-outside-topic'));h.state.vocabularyVersion++;
  await assign(h);assert.equal(h.calls.length,1);assert.equal(h.state.analyses[h.paper.id].assignmentPolicyVersion,2);assert.equal(h.state.suggestions.find(row=>row.runId===h.state.run!.id)!.vocabularyVersion,h.state.vocabularyVersion);
});

test('AI-only assignment defaults to enabled tags and captures an explicit subset without shelves',async()=>{
  const h=fixture(undefined,true);h.state.tags.push({...definition('disabled'),matchingMode:'manual'});
  await h.controller.invoke('tag',{scope:'selected',processingPolicy:'auto-clear'});await h.controller.waitForIdle();
  assert.equal(h.state.run!.status,'idle',h.state.run!.message);assert.deepEqual(h.state.run!.tagIds,['target','outside']);assert.equal(h.state.run!.tagShelfId,undefined);assert.equal(h.state.run!.sourcePolicyVersion,2);
  assert.deepEqual(h.calls[0].approvedVocabulary.map(tag=>tag.id),['target','outside']);
  await h.controller.invoke('tag',{scope:'selected',tagIds:['target'],processingPolicy:'auto-clear'});await h.controller.waitForIdle();
  assert.deepEqual(h.state.run!.tagIds,['target']);assert.deepEqual(h.calls.at(-1)!.approvedVocabulary.map(tag=>tag.id),['target']);
  const before=h.calls.length;h.state.tags.push(definition('unrelated'));h.state.vocabularyVersion++;
  await h.controller.invoke('tag',{scope:'selected',tagIds:['target'],processingPolicy:'auto-clear'});await h.controller.waitForIdle();assert.equal(h.calls.length,before);
  for(const tagIds of [[],['missing'],['disabled'],['target','target']])await assert.rejects(h.controller.invoke('tag',{scope:'selected',tagIds,processingPolicy:'auto-clear'}),/Choose|unavailable|disabled/);
});

test('assignment cache includes every supplied definition field and provider/model',async()=>{
  const h=fixture();await assign(h);const tag=h.state.tags.find(tag=>tag.id==='target')!;
  const edits=[()=>tag.examples.push('A qualifying membrane experiment'),()=>tag.aliases.push('transport measurement'),()=>{tag.facet='method';},()=>tag.broaderIds.push('outside'),()=>tag.relatedIds!.push('outside'),()=>{tag.description='A narrower measurement meaning.';},()=>{h.state.settings.model='another-model';},()=>{h.state.settings.provider='deepseek';}];
  for(const edit of edits){const before=h.calls.length;edit();await assign(h);assert.equal(h.calls.length,before+1);}
  h.paper.abstract+=' The operating conditions were changed.';await assign(h);assert.equal(h.calls.length,edits.length+2);
});

test('verified PDF facts seed the first assignment request and invalidate with source changes',async()=>{
  const h=fixture(),pdf=`Introduction\n${pdfQuote}\nResults establish a substantive membrane transport measurement.`;h.setPDF(pdf);h.state.facts[h.paper.id]=facts(h,pdf);
  await assign(h);assert.equal(h.calls.length,1);assert.ok(h.calls[0].paper.pdf?.includes(pdfQuote));assert.equal(h.calls[0].validatedFacts?.summary,h.state.facts[h.paper.id].summary);assert.equal(h.state.analyses[h.paper.id].pdfSourceFingerprint,fingerprint(pdf));
  await assign(h);assert.equal(h.calls.length,1);
  h.setPDF(`${pdf}\nA newly added source sentence changes this excerpt.`);await assign(h);assert.equal(h.calls.length,2);assert.equal(h.calls[1].validatedFacts,undefined);
});

test('metadata facts are supplemental context and stale facts are left out without extraction requests',async()=>{
  const h=fixture();h.state.facts[h.paper.id]=facts(h);await assign(h);assert.equal(h.calls.length,1);assert.ok(h.calls[0].validatedFacts);assert.equal(h.pdfReads(),0);
  h.paper.abstract+=' An additional observation changes the inputs.';await assign(h);assert.equal(h.calls.length,2);assert.equal(h.calls[1].validatedFacts,undefined);
});

test('a successful reply that settles after pause is saved and reused after restart',async()=>{
  const h=fixture();let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  h.respond(async input=>{entered();await gate;return {summary:'A completed source analysis.',concepts:[],needsPDF:false,suggestions:[{tagId:'target',reason:'Direct evidence supports this definition.',confidence:'high',match:'substantive',evidence:[{source:'abstract',text:input.paper.abstract}]}],newTagCandidates:[]};});
  await h.controller.invoke('tag',{scope:'selected',tagShelfId:'subset',processingPolicy:'auto-clear'});await started;await h.controller.invoke('pause');release();await h.controller.waitForIdle();
  assert.equal(h.state.run!.status,'paused');assert.ok(h.state.analyses[h.paper.id].assignmentInputFingerprint);assert.equal(h.state.suggestions.length,0);
  const restored=fixture(copy(h.state));await restored.controller.initialize();await restored.controller.invoke('resume');await restored.controller.waitForIdle();assert.equal(restored.state.run!.status,'idle',restored.state.run!.message);assert.equal(restored.calls.length,0);assert.ok(restored.state.suggestions.some(row=>row.tagId==='target'));
});

test('prompt content fingerprints include facts, exact excerpts, provider, and model',()=>{
  const h=fixture(),options={allowNoTag:false,facts:facts(h)},prompt=buildAnalysisPrompt(h.paper,h.state.tags,options),key=assignmentAnalysisFingerprint(prompt,'chatgpt','model');
  assert.notEqual(key,assignmentAnalysisFingerprint(prompt,'deepseek','model'));assert.notEqual(key,assignmentAnalysisFingerprint(prompt,'chatgpt','other'));
  assert.notEqual(key,assignmentAnalysisFingerprint(buildAnalysisPrompt(h.paper,h.state.tags,{allowNoTag:false}),'chatgpt','model'));
  assert.notEqual(key,assignmentAnalysisFingerprint(buildAnalysisPrompt({...h.paper,pdfText:pdfQuote},h.state.tags,{...options,includePDF:true}),'chatgpt','model'));
});
