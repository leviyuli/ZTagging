import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import {ensureFactConceptIds,createRegistrySnapshot} from '../src/evidence.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import type {CompletionResult,ProviderSettings} from '../src/providers.ts';
import {ProviderError} from '../src/providers.ts';
import {createConsolidationWork,nextConsolidationRequest,acceptConsolidationResult} from '../src/library-consolidation.ts';
import {nextSelectionRequests,resumeTagSelection,SELECTION_MAX_REQUESTS} from '../src/tag-selection.ts';

const clone=<T>(value:T):T=>structuredClone(value);
interface Source {sourceId:string;registryId:string;name:string}
interface Input {requestId:string;selectionPhase:'choosing'|'mapping';conceptRegistry?:{registryId:string;sources:{label:string;facet:string}[]}[];tags?:TagDefinition[];sources?:Source[]}
function library(total=64,concepts=4):AppState {
  const state=initialState();state.settings.model='synthetic-model';
  for(let index=0;index<total;index++){
    const quotations=Array.from({length:concepts},(_,concept)=>`Synthetic phenomenon ${index*concepts+concept} is established by the measurements in this experiment.`),paper:PaperRecord={id:`1:P${index}`,itemID:index+1,libraryID:1,key:`P${index}`,title:`Synthetic experiment ${index}`,abstract:quotations.join(' '),keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
    const fact:PaperFacts={paperId:paper.id,metadataFingerprint:paper.fingerprint,inputFingerprint:paper.fingerprint,provider:'retained-provider',model:'retained-model',extractionVersion:1,summary:'Retained scientific measurements.',needsPDF:false,concepts:quotations.map((text,concept)=>({name:`synthetic phenomenon ${index*concepts+concept}`,facet:'phenomenon',evidence:[{source:'abstract',text}]}))};state.papers[paper.id]=paper;state.facts[paper.id]=fact;state.nativeTags[paper.id]=[{tag:'Manual project',type:0}];
  }
  ensureFactConceptIds(Object.values(state.facts));
  state.run={id:'retained-run',kind:'rebuild',scope:'library',automatic:false,status:'paused',jobs:Object.keys(state.papers).map(paperId=>({id:`job-${paperId}`,paperId,status:'completed'})),vocabCursor:0,vocabFinished:false,message:'Retained analysis.',spentUSD:0.15,settings:clone(state.settings),vocabularyVersion:state.vocabularyVersion};return state;
}
function reply(data:Input){
  if(data.selectionPhase==='choosing')return {tags:data.conceptRegistry!.slice(0,2).map((entry,index)=>({key:`chosen-${index}`,name:entry.sources[0].label,fullName:entry.sources[0].label,description:`Scientific scope of ${entry.sources[0].label}.`,facet:entry.sources[0].facet,aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[entry.registryId]})),merges:[],excluded:[]};
  const judgements:{tagId:string;registryId:string;sourceIds:string[];relation:string;reason:string}[]=[],outside:{sourceIds:string[];disposition:string;reason:string}[]=[];
  for(const source of data.sources!){const tag=data.tags!.find(tag=>tag.name===source.name);if(tag)judgements.push({tagId:tag.id,registryId:source.registryId,sourceIds:[source.sourceId],relation:'equivalent',reason:'The original quotation directly establishes this selected phenomenon.'});else outside.push({sourceIds:[source.sourceId],disposition:'outside-core',reason:'This retained detail is outside the compact chosen core.'});}
  return {judgements,outside};
}
interface Options {respond?:(input:Input,number:number,signal?:AbortSignal)=>unknown|Promise<unknown>;save?:(state:AppState)=>void|Promise<void>;cost?:number}
function harness(state=library(),options:Options={}){
  const calls:{id:string;phase:string;bytes:number}[]=[],saved:AppState[]=[];let running=0,peak=0,writes=0,pdf=0;
  const ai:ControllerEnvironment['ai']={async completeJson(_system:string,prompt:string,_settings:ProviderSettings,signal?:AbortSignal):Promise<CompletionResult>{
    const input:Input=JSON.parse(prompt.slice(prompt.lastIndexOf('INPUT_DATA_JSON:')+'INPUT_DATA_JSON:'.length));assert.ok(input.selectionPhase,'Cached paper facts must not trigger extraction');const bytes=new TextEncoder().encode(prompt).length;assert.ok(bytes<=90_000);calls.push({id:input.requestId,phase:input.selectionPhase,bytes});running++;peak=Math.max(peak,running);
    try{await new Promise<void>(resolve=>setImmediate(resolve));const value=await options.respond?.(input,calls.length,signal)??reply(input);return {value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:10,outputTokens:10},estimatedCostUSD:options.cost??0};}finally{running--;}
  },async hasApiKey(){return true;},async getSession(){return {connected:true,sharing:true,email:null,accountId:null,accounts:[]};},async testConnection(){throw new Error('No connection check needed');},async listModels(){return [];},async setApiKey(){},async removeApiKey(){},async signIn(){throw new Error('No sign-in needed');},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}};
  const env:ControllerEnvironment={ai,host:{async list(){return clone(Object.values(state.papers));},async read(itemID){return clone(Object.values(state.papers).find(paper=>paper.itemID===itemID)??null);},async readTags(){return [{tag:'Manual project',type:0}];},async pdfText(){pdf++;return '';},async apply(){writes++;throw new Error('Building tags cannot write native tags');},async show(){},async saveSearch(){}},persist:async value=>{await options.save?.(value);saved.splice(0,saved.length,clone(value));}};
  return {state,calls,saved,controller:new AppController(state,env),peak:()=>peak,writes:()=>writes,pdf:()=>pdf};
}
async function resume(h:ReturnType<typeof harness>){await h.controller.invoke('resume');await h.controller.waitForIdle();}
function legacyCheckpoint(state:AppState){
  const facts=Object.values(state.facts),snapshot=createRegistrySnapshot(facts,state.evidenceCatalog);let work=createConsolidationWork(facts,state.tags,snapshot),request=nextConsolidationRequest(work)!;const data=JSON.parse(request.prompt.split('INPUT_DATA_JSON:\n')[1]);work=acceptConsolidationResult(work,request.id,{tags:data.conceptRegistry.map((entry:{registryId:string;sources:{label:string}[]},index:number)=>({key:`old-${index}`,name:entry.sources[0].label,fullName:entry.sources[0].label,description:'A retained scientific scope.',facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[entry.registryId]})),merges:[],excluded:[]});
  state.run!.consolidation={protocolVersion:2,generationId:'legacy-generation',inputFingerprint:'legacy-input',snapshot,candidateIds:{},correctionAttempts:0,phase:'generating',work};
}

test('cached large-library work becomes one global choice and a finite mapping pass with at most two requests',async()=>{
  const h=harness(),facts=fingerprint(h.state.facts),tags=fingerprint(h.state.tags),native=fingerprint(h.state.nativeTags);await resume(h);
  assert.equal(h.state.run!.status,'idle',h.state.run!.message);assert.equal(h.state.run!.selection!.status,'ready');assert.equal(h.calls.filter(call=>call.phase==='choosing').length,1);assert.ok(h.calls.filter(call=>call.phase==='mapping').length>1);assert.equal(h.peak(),2);assert.equal(h.state.tagPreparation!.status,'ready');assert.equal(Object.keys(h.state.run!.selection!.sourceLedger).length,256);assert.ok(Object.values(h.state.run!.selection!.sourceLedger).every(value=>value.status!=='pending'));assert.equal(h.state.taxonomyProposal!.tags.filter(tag=>!tag.custom).length,2);assert.equal(fingerprint(h.state.facts),facts);assert.equal(fingerprint(h.state.tags),tags);assert.equal(fingerprint(h.state.nativeTags),native);assert.equal(h.writes(),0);assert.equal(h.pdf(),0);assert.equal(validState(h.state),true);
  const display=await h.controller.snapshot();assert.equal(display.queue.selection!.sourceTotal,256);assert.equal(display.queue.selection!.sourceCompleted,256);assert.ok(h.state.run!.selection!.tasks.every(task=>task.attempts.every(attempt=>typeof attempt.raw==='string')),'Original provider reply text is retained for replay');
});

test('legacy completed portions and raw outputs remain immutable while new selection reuses the exact snapshot',async()=>{
  const state=library();legacyCheckpoint(state);const checkpoint=fingerprint(state.run!.consolidation),snapshot=state.run!.consolidation!.snapshot.id,h=harness(state);await resume(h);
  assert.equal(state.run!.status,'idle',state.run!.message);assert.equal(fingerprint(state.run!.consolidation),checkpoint);assert.equal(state.run!.selection!.snapshotId,snapshot);assert.equal(h.calls.filter(call=>call.phase==='choosing').length,1);assert.equal(h.pdf(),0);assert.equal(h.writes(),0);
});

test('a returned response is persisted and replayed after an interrupted save without another request',async()=>{
  let interrupted=false;const first=harness(library(),{save(state){if(!interrupted&&state.run?.selectionReplies?.length){interrupted=true;throw new Error('Interrupted after receiving the complete reply');}}});await resume(first);assert.equal(first.state.run!.status,'paused');assert.ok(first.state.run!.selectionReplies!.length);
  const received=first.state.run!.selectionReplies![0].taskId,restored=harness(clone(first.saved.at(-1)!));await restored.controller.initialize();await resume(restored);assert.equal(restored.state.run!.status,'idle',restored.state.run!.message);assert.ok(restored.calls.every(call=>call.id!==received));assert.equal([...first.calls,...restored.calls].filter(call=>call.id===received).length,1);assert.equal(restored.writes(),0);
});

test('one malformed mapping reply receives one automatic correction without repeating the global choice',async()=>{
  let bad=false;const h=harness(library(),{respond(input){if(input.selectionPhase==='mapping'&&!bad){bad=true;return {judgements:[],outside:[]};}return reply(input);}});await resume(h);assert.equal(h.state.run!.status,'idle',h.state.run!.message);assert.equal(h.calls.filter(call=>call.phase==='choosing').length,1);assert.ok(h.state.run!.selection!.tasks.some(task=>task.invalidResponses===1));assert.equal(h.writes(),0);
});

test('an unsupported empty selection can explicitly choose again without repeating facts or resetting spending',async()=>{
  let unsupported=true;const h=harness(library(),{respond(input){return input.selectionPhase==='mapping'&&unsupported?{judgements:[],outside:input.sources!.map(source=>({sourceIds:[source.sourceId],disposition:'outside-core',reason:'No chosen meaning is established by this original finding.'}))}:reply(input);}}),facts=fingerprint(h.state.facts);
  await resume(h);assert.equal(h.state.run!.status,'idle');assert.equal(h.state.tagPreparation!.status,'failed');assert.equal(h.state.taxonomyProposal!.tags.filter(tag=>!tag.custom).length,0);
  unsupported=false;await h.controller.invoke('retry-tag-preparation',{id:h.state.tagPreparation!.id});await h.controller.waitForIdle();
  assert.equal(h.state.tagPreparation!.status,'ready');assert.equal(h.calls.filter(call=>call.phase==='choosing').length,2);assert.equal(fingerprint(h.state.facts),facts);assert.equal(h.state.run!.spentUSD,0.15);assert.equal(h.writes(),0);assert.ok(h.state.tagSelectionHistory!.length);
});

test('exhausted mapping correction pauses clearly and ordinary Resume cannot reset its allowance',async()=>{
  let invalid=true;const h=harness(library(),{respond(input){return input.selectionPhase==='mapping'&&invalid?{judgements:[],outside:[]}:reply(input);}});await resume(h);assert.equal(h.state.run!.status,'paused');assert.equal(h.state.run!.selection!.status,'failed');const calls=h.calls.length,requests=h.state.run!.selection!.automaticRequests;await resume(h);assert.equal(h.calls.length,calls);assert.equal(h.state.run!.selection!.automaticRequests,requests);assert.equal((await h.controller.snapshot()).queue.selection!.failed,true);
  invalid=false;await h.controller.invoke('retry-selection');await h.controller.waitForIdle();assert.equal(h.state.run!.status,'idle',h.state.run!.message);assert.equal(h.calls.filter(call=>call.phase==='choosing').length,1);assert.ok(h.state.run!.selection!.automaticRequests>requests);assert.equal(h.writes(),0);
});

for(const action of ['resume','retry-selection'] as const)test(`${action} locally recovers a saved chooser reply whose generated RCL alias conflicted with DIY`,async()=>{
  const state=library(2,1),paper=state.papers['1:P0'],fact=state.facts[paper.id];
  fact.concepts[0].name='ohmic resistance';fact.concepts[0].evidence[0].text='Ohmic resistance is established by the measurements in this experiment.';
  paper.abstract=fact.concepts[0].evidence[0].text;paper.fingerprint=paperFingerprint(paper);fact.metadataFingerprint=paper.fingerprint;fact.inputFingerprint=paper.fingerprint;
  state.settings.coreConceptLimit=2;state.run!.settings=clone(state.settings);state.tags[0].status='approved';
  state.decisions[`${paper.id}|custom-rcl`]={locked:true};state.decisions['1:P1|custom-rcl']={rejected:true};
  let savedReply:ReturnType<typeof reply>|undefined;
  const first=harness(state,{cost:0.001,respond(input){
    assert.equal(input.selectionPhase,'choosing');const response=reply(input);savedReply=clone(response);
    return {...response,tags:('tags' in response?response.tags:[]).map((tag,index)=>({...tag,parentKeys:index===0?['unknown-parent']:[]}))};
  }});
  await resume(first);assert.equal(state.run!.status,'paused');assert.equal(first.calls.length,4);
  const task=state.run!.selection!.tasks.find(task=>task.kind==='plan')!;
  assert.equal(task.dispatches,4);assert.equal(task.invalidResponses,4);assert.equal(task.status,'failed');
  assert.ok(savedReply&&'tags' in savedReply);
  const retainedReply={...savedReply,tags:savedReply.tags.map(tag=>({...tag,aliases:tag.name==='ohmic resistance'?['RCL']:tag.aliases}))};
  // This complete reply represents a cached failure produced before conflicting DIY aliases were withheld locally.
  task.attempts.at(-1)!.raw=JSON.stringify(retainedReply);task.attempts.at(-1)!.error='Alias RCL is ambiguous between ohmic resistance and the saved DIY topic.';
  task.error=task.attempts.at(-1)!.error;
  const attempts=clone(task.attempts),diagnostics=clone(state.run!.selection!.diagnostics),candidateIds=clone(state.run!.selection!.candidateIds),spent=state.run!.spentUSD,requests=state.run!.selection!.automaticRequests;
  const facts=fingerprint(state.facts),definitions=fingerprint(state.tags),decisions=fingerprint(state.decisions),native=fingerprint(state.nativeTags);
  const restored=harness(JSON.parse(JSON.stringify(state)),{cost:0.001});await restored.controller.initialize();assert.equal(restored.calls.length,0);
  await restored.controller.invoke(action);await restored.controller.waitForIdle();
  const work=restored.state.run!.selection!,recovered=work.tasks.find(value=>value.id===task.id)!;
  assert.equal(restored.state.run!.status,'idle',restored.state.run!.message);assert.equal(work.status,'ready');assert.equal(restored.state.tagPreparation!.status,'ready');
  assert.ok(restored.calls.length>0);assert.ok(restored.calls.every(call=>call.phase==='mapping'),'The saved chooser reply must not cause a fifth paid chooser request');
  assert.equal(recovered.status,'completed');assert.equal(recovered.dispatches,4);assert.equal(recovered.invalidResponses,4);assert.deepEqual(recovered.attempts,attempts);assert.deepEqual(work.candidateIds,candidateIds);
  assert.equal(work.tasks.filter(task=>task.kind==='plan').length,1);assert.equal(work.automaticRequests,requests+restored.calls.length);
  assert.ok(diagnostics.every(message=>work.diagnostics.includes(message)));assert.ok(restored.state.run!.spentUSD>=spent);assert.ok(Math.abs(restored.state.run!.spentUSD-spent-restored.calls.length*0.001)<1e-10);
  const core=restored.state.taxonomyProposal!.tags.find(tag=>!tag.custom&&tag.name==='ohmic resistance')!;
  assert.ok(core);assert.ok(!core.aliases.includes('RCL'));assert.deepEqual(restored.state.taxonomyProposal!.tags.find(tag=>tag.id==='custom-rcl'),state.tags[0]);
  assert.equal(fingerprint(restored.state.facts),facts);assert.equal(fingerprint(restored.state.tags),definitions);assert.equal(fingerprint(restored.state.decisions),decisions);assert.equal(fingerprint(restored.state.nativeTags),native);
  assert.equal(restored.pdf(),0);assert.equal(restored.writes(),0);assert.equal(validState(restored.state),true);
});

for(const category of ['authentication','quota','permission','network','configuration'] as const)test(`${category} failures pause without provider fallback or format-correction consumption`,async()=>{
  const state=library(),before=fingerprint(state.facts),h=harness(state,{respond(){throw new ProviderError('Synthetic provider failure',category);}});await resume(h);assert.equal(state.run!.status,'paused');assert.equal(h.calls.length,1);assert.equal(state.run!.selection!.automaticRequests,1);assert.equal(state.run!.selection!.tasks[0].invalidResponses,0);assert.equal(state.run!.settings.provider,'chatgpt');assert.equal(fingerprint(state.facts),before);assert.equal(h.writes(),0);
});

test('budget rejection before dispatch consumes neither request nor correction allowance',async()=>{
  const state=library();Object.assign(state.settings,{provider:'deepseek',inputPricePerMillion:1,outputPricePerMillion:1,budgetUSD:0.150001});state.run!.settings=clone(state.settings);const h=harness(state);await resume(h);assert.equal(state.run!.status,'paused');assert.equal(h.calls.length,0);assert.equal(state.run!.selection!.automaticRequests,0);assert.equal(state.run!.selection!.tasks[0].dispatches,0);assert.equal(state.run!.spentUSD,0.15);
});

test('a retained safety-limit pause gives a concrete recovery action instead of a nonworking retry loop',async()=>{
  const h=harness(library(),{respond(){throw new ProviderError('Synthetic interrupted transport','network');}});await resume(h);
  const work=h.state.run!.selection!;work.automaticRequests=SELECTION_MAX_REQUESTS;work.tasks[0].dispatches=SELECTION_MAX_REQUESTS;work.status='failed';const calls=h.calls.length;
  await resume(h);assert.equal(h.calls.length,calls);assert.match((await h.controller.snapshot()).queue.message,/Increase the response limit.*fewer papers/);
  await assert.rejects(h.controller.invoke('retry-selection'),/Saved paper analysis can be reused/);assert.equal(h.calls.length,calls);assert.equal(h.writes(),0);
});

test('pre-dispatch persistence failure rolls back the reservation and task dispatch atomically',async()=>{
  const state=library();Object.assign(state.settings,{provider:'deepseek',inputPricePerMillion:0.01,outputPricePerMillion:0.01,budgetUSD:50});state.run!.settings=clone(state.settings);let reject=true;const h=harness(state,{save(value){if(reject&&value.run?.selection?.tasks.some(task=>task.status==='running')){reject=false;throw new Error('Synthetic dispatch persistence failed');}}});await resume(h);assert.equal(h.calls.length,0);assert.equal(state.run!.selection!.automaticRequests,0);assert.equal(state.run!.selection!.tasks[0].dispatches,0);assert.equal(state.run!.spentUSD,0.15);assert.equal(state.run!.status,'paused');
});

test('cancellation retains a late paid reply without applying it and Resume replays it',async()=>{
  let release!:(value:unknown)=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});const first=harness(library(),{respond:async(input)=>{if(input.selectionPhase==='choosing'){entered();return await gate;}return reply(input);}});
  await first.controller.invoke('resume');await started;await first.controller.invoke('pause');const inputId=first.calls[0].id;const work=first.state.run!.selection!,input=JSON.parse(nextSelectionRequests(resumeTagSelection(work),1)[0].prompt.split('INPUT_DATA_JSON:\n')[1]);release(reply(input));await first.controller.waitForIdle();assert.equal(first.state.run!.status,'paused');assert.ok(first.state.run!.selectionReplies!.some(value=>value.taskId===inputId));assert.equal(first.state.taxonomyProposal,null);
  const restored=harness(clone(first.saved.at(-1)!));await restored.controller.initialize();await resume(restored);assert.equal(restored.state.run!.status,'idle',restored.state.run!.message);assert.ok(restored.calls.every(call=>call.id!==inputId));assert.equal(restored.writes(),0);
});

test('parallel mapping reservations cannot spend the same remaining budget twice',async()=>{
  const state=library();Object.assign(state.settings,{provider:'deepseek',inputPricePerMillion:0.01,outputPricePerMillion:0.01,budgetUSD:50});state.run!.settings=clone(state.settings);
  let h!:ReturnType<typeof harness>,limited=false,cap=50,peak=0;
  h=harness(state,{async save(value){const run=value.run!;if(!limited&&run.selection?.status==='mapping'&&run.selection.tasks.every(task=>task.status!=='running')){limited=true;const view=await h.controller.snapshot(),average=(view.queue.estimatedUSD!-run.spentUSD)/view.queue.selection!.queuedRequests;cap=run.spentUSD+average*1.5;run.settings.budgetUSD=cap;}if(limited){peak=Math.max(peak,run.spentUSD);assert.ok(run.spentUSD<=cap+1e-10);}}});
  await resume(h);assert.equal(limited,true);assert.equal(state.run!.status,'paused');assert.match(state.run!.message,/budget/i);assert.equal(h.calls.filter(call=>call.phase==='mapping').length,1);assert.ok(peak>0.15&&peak<=cap+1e-10);assert.equal(h.writes(),0);
});

test('restart after a parallel transport failure never repeats a completed source batch',async()=>{
  let mapping=0,committed!:()=>void;const firstCommitted=new Promise<void>(resolve=>{committed=resolve;});
  const first=harness(library(),{async respond(input){if(input.selectionPhase==='mapping'&&++mapping===2){await firstCommitted;throw new ProviderError('Synthetic mapping connection failure','network');}return reply(input);},save(state){if(state.run?.selection?.tasks.some(task=>task.kind==='map'&&task.status==='completed'))committed();}});
  await resume(first);assert.equal(first.state.run!.status,'paused');const done=first.state.run!.selection!.tasks.filter(task=>task.kind==='map'&&task.status==='completed');assert.equal(done.length,1);const fingerprintBefore=fingerprint(done[0]);
  const restored=harness(clone(first.saved.at(-1)!));await restored.controller.initialize();await resume(restored);assert.equal(restored.state.run!.status,'idle',restored.state.run!.message);assert.ok(restored.calls.every(call=>call.id!==done[0].id));assert.equal(fingerprint(restored.state.run!.selection!.tasks.find(task=>task.id===done[0].id)),fingerprintBefore);assert.equal(restored.pdf(),0);assert.equal(restored.writes(),0);
});
