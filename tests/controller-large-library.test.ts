import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
import {ensureFactConceptIds,createRegistrySnapshot} from '../src/evidence.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import type {CompletionResult,ProviderSettings} from '../src/providers.ts';
import {ProviderError} from '../src/providers.ts';
import {CONSOLIDATION_REQUEST_BYTE_LIMIT,createConsolidationWork,nextConsolidationRequest,acceptConsolidationResult} from '../src/library-consolidation.ts';

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
interface InputCandidate {registryId?:string;candidateId?:string;name?:string;sources?:{label:string}[]}
interface StageInput {requestId:string;consolidationStage:'map'|'reduce'|'final';conceptRegistry?:InputCandidate[];candidates?:InputCandidate[];preparationPolicyVersion?:number;consolidationRepair?:boolean;failedResponse?:{tags?:{key:string;facet:string}[]}|string;permittedInputs?:{id?:string;candidateId?:string;labels?:{label:string}[];name?:string}[]}
function retainedLibrary(papers=64,conceptsPerPaper=4):AppState {
  const state=initialState();state.settings.model='synthetic-model';
  for(let index=0;index<papers;index++){
    const quotations=Array.from({length:conceptsPerPaper},(_,concept)=>`Synthetic phenomenon ${index*conceptsPerPaper+concept} is established by this experiment. ${'The supporting scientific measurement is reported in the supplied abstract. '.repeat(20)}`),paper:PaperRecord={id:`1:P${index}`,itemID:index+1,libraryID:1,key:`P${index}`,title:`Synthetic experiment ${index}`,abstract:quotations.join(' '),keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
    const facts:PaperFacts={paperId:paper.id,metadataFingerprint:paper.fingerprint,inputFingerprint:paper.fingerprint,provider:'retained-provider',model:'retained-model',extractionVersion:1,summary:'A retained validated scientific synopsis. '.repeat(30),needsPDF:false,concepts:quotations.map((quote,concept)=>({name:`synthetic phenomenon ${index*conceptsPerPaper+concept}`,facet:'phenomenon',evidence:[{source:'abstract',text:quote}]}))};state.papers[paper.id]=paper;state.facts[paper.id]=facts;state.nativeTags[paper.id]=[{tag:'Manual project',type:0}];
  }
  ensureFactConceptIds(Object.values(state.facts));
  state.run={id:'completed-library-extraction',kind:'rebuild',scope:'library',automatic:false,status:'paused',jobs:Object.keys(state.papers).map(paperId=>({id:`job-${paperId}`,paperId,status:'completed'})),vocabCursor:0,vocabFinished:false,message:'Resume retained consolidation.',spentUSD:0.15,settings:clone(state.settings),vocabularyVersion:state.vocabularyVersion};return state;
}
function stageResponse(data:StageInput) {
  if(data.consolidationRepair){
    if(typeof data.failedResponse==='object'&&Array.isArray(data.failedResponse?.tags))return {repairs:data.failedResponse.tags.filter(tag=>tag.facet==='invalid-category').map(tag=>({key:tag.key,facet:'phenomenon'}))};
    const registry=data.permittedInputs?.some(entry=>entry.labels);return stageResponse({...data,consolidationRepair:false,...(registry?{conceptRegistry:data.permittedInputs!.map(entry=>({registryId:entry.id,sources:entry.labels}))}:{candidates:data.permittedInputs!.map(entry=>({candidateId:entry.candidateId??entry.id,name:entry.name}))})});
  }
  const registry=!!data.conceptRegistry,entries=data.conceptRegistry??data.candidates??[];
  return {tags:entries.map((entry,index)=>{const name=registry?entry.sources![0].label:entry.name!;return {key:`output-${index}`,name,fullName:name,description:`The experimentally established scientific scope of ${name}.`,facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],...(registry?{supportRegistryIds:[entry.registryId]}:{supportCandidateIds:[entry.candidateId]})};}),merges:[],excluded:[]};
}
interface HarnessOptions {
  failRequest?:number;interruptReturned?:boolean;malformedRequest?:number;verbose?:boolean;invalidFacetRequest?:number;blockCorrectionBudget?:boolean;authCorrection?:boolean;interruptCorrection?:boolean;
  respond?:(data:StageInput,request:number,settings:ProviderSettings,signal?:AbortSignal)=>ReturnType<typeof stageResponse>|undefined|Promise<ReturnType<typeof stageResponse>|undefined>;
  costUSD?:number;interruptWhen?:(state:AppState)=>boolean;onSaved?:(state:AppState)=>void;
}
function harness(state:AppState,options:HarnessOptions={}) {
  const calls:{id:string;phase:string;bytes:number;kind:'initial'|'correction';provider:ProviderSettings['mode'];generation:number}[]=[],saved:AppState[]=[];let writes=0,pdfReads=0,interrupted=false,verbose=options.verbose??false,persistedReturned=false;
  const ai:ControllerEnvironment['ai']={async completeJson(_system:string,prompt:string,settings:ProviderSettings,signal?:AbortSignal):Promise<CompletionResult>{
    assert.equal(settings.model,'synthetic-model');const data:StageInput=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]);assert.ok(data.consolidationStage,'Completed factual extraction must not call the extractor or unrelated provider workflows');assert.equal(data.preparationPolicyVersion,undefined,'These exact factual names need no semantic repair');const count=new TextEncoder().encode(prompt).length;assert.ok(count<=CONSOLIDATION_REQUEST_BYTE_LIMIT);calls.push({id:data.requestId,phase:data.consolidationStage,bytes:count,kind:data.consolidationRepair?'correction':'initial',provider:settings.mode,generation:state.run?.consolidation?.work?.tasks.find(task=>task.id===data.requestId)?.requestGeneration??0});if(calls.length===options.failRequest)throw new Error('Synthetic interrupted provider connection');if(data.consolidationRepair&&options.authCorrection)throw new ProviderError('Synthetic authentication denied.','authentication',{status:401});if(calls.length===options.malformedRequest)throw new ProviderError('The completed assistant reply was not JSON.','invalid-response',{rawText:'RETAINED_MALFORMED_STAGE_REPLY }',completion:{text:'RETAINED_MALFORMED_STAGE_REPLY }',usage:{inputTokens:10,outputTokens:10},usageKnown:true,estimatedCostUSD:0}});const value=await options.respond?.(data,calls.length,settings,signal)??stageResponse(data);if('tags' in value){if(verbose)for(const tag of value.tags)tag.description='A scientifically separate scope remains deliberately verbose. '.repeat(28);if(calls.length===options.invalidFacetRequest){value.tags[0].facet='invalid-category';if(options.blockCorrectionBudget)state.run!.settings.budgetUSD=0;}}return {value,text:JSON.stringify(value),usage:{inputTokens:10,outputTokens:10},usageKnown:true,estimatedCostUSD:options.costUSD??0};
  },async hasApiKey(){return true;},async getSession(){return {connected:true,sharing:true,email:null,accountId:null,accounts:[]};},async testConnection(){throw new Error('No connection test is required');},async listModels(){return [];},async setApiKey(){},async removeApiKey(){},async signIn(){throw new Error('No sign-in is required');},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}};
  const env:ControllerEnvironment={ai,host:{async list(){return clone(Object.values(state.papers));},async read(itemID){return clone(Object.values(state.papers).find(paper=>paper.itemID===itemID)??null);},async readTags(){return [{tag:'Manual project',type:0}];},async pdfText(){pdfReads++;return '';},async apply(){writes++;throw new Error('Consolidation cannot write native tags');},async show(){},async saveSearch(){}},persist:async next=>{
    if(!interrupted&&(options.interruptReturned&&next.run?.consolidation?.pendingResponse||options.interruptCorrection&&next.run?.consolidation?.pendingResponse?.kind==='correction'||options.interruptWhen?.(next))){interrupted=true;throw new Error('Synthetic interruption after receiving a completed response');}persistedReturned ||= !!next.run?.consolidation?.pendingResponse;options.onSaved?.(next);saved.splice(0,saved.length,clone(next));
  }};
  return {state,calls,saved,controller:new AppController(state,env),writes:()=>writes,pdfReads:()=>pdfReads,persistedReturned:()=>persistedReturned,setVerbose:(value:boolean)=>{verbose=value;}};
}
async function resume(h:ReturnType<typeof harness>){await h.controller.invoke('resume');await h.controller.waitForIdle();}
function retainedCheckpoint(state:AppState,completedFirst=false){
  const facts=state.run!.jobs.map(job=>state.facts[job.paperId]).sort((a,b)=>a.paperId.localeCompare(b.paperId)),snapshot=createRegistrySnapshot(facts,state.evidenceCatalog),existing=state.tags;
  let work=createConsolidationWork(facts,existing,snapshot,state.settings.coreConceptLimit??60);
  if(completedFirst){const request=nextConsolidationRequest(work)!;work=acceptConsolidationResult(work,request.id,stageResponse(JSON.parse(request.prompt.split('INPUT_DATA_JSON:\n')[1])));}
  state.run!.consolidation={protocolVersion:2,generationId:'retained-work',inputFingerprint:fingerprint({protocolVersion:2,facts,existing,limit:state.settings.coreConceptLimit??60,baseVersion:state.vocabularyVersion}),snapshot,candidateIds:{},correctionAttempts:0,phase:'generating',work};return work;
}

test('public controller resumes cached library facts through bounded map and global requests into one proposal',async()=>{
  const state=retainedLibrary(),facts=fingerprint(state.facts),active=fingerprint(state.tags),h=harness(state);await resume(h);
  assert.equal(state.run!.status,'idle');assert.equal(state.run!.jobs.filter(job=>job.status==='completed').length,64);assert.equal(state.run!.consolidation!.work!.status,'complete');assert.ok(h.calls.filter(call=>call.phase==='map').length>1);assert.equal(h.calls.at(-1)!.phase,'final');assert.equal(h.calls.filter(call=>call.phase==='final').length,1);assert.ok(h.calls.every(call=>call.bytes<=CONSOLIDATION_REQUEST_BYTE_LIMIT));
  const proposal=state.taxonomyProposal!;assert.equal(proposal.paperIds.length,64);assert.equal(proposal.tags.filter(tag=>!tag.custom).length,256);assert.deepEqual(proposal.issues,[]);assert.equal(state.tagPreparation!.status,'ready');assert.equal(fingerprint(state.facts),facts);assert.equal(fingerprint(state.tags),active);assert.equal(h.writes(),0);assert.equal(h.pdfReads(),0);assert.equal(validState(state),true);
  assert.deepEqual(new Set(proposal.tags.filter(tag=>!tag.custom).flatMap(tag=>proposal.support[tag.id].registryIds!)),new Set(Object.keys(proposal.evidenceSnapshot!.entries)));assert.equal(h.persistedReturned(),true,'completed transport output is persisted before local parsing');
});
test('restart retains completed consolidation batches and never repeats their provider requests or extraction',async()=>{
  const state=retainedLibrary(),facts=fingerprint(state.facts),first=harness(state,{failRequest:2});await resume(first);assert.equal(state.run!.status,'paused');const completed=state.run!.consolidation!.work!.tasks.filter(task=>task.completed);assert.equal(completed.length,1);const originalId=completed[0].id;
  const restored=harness(clone(first.saved.at(-1)!));await restored.controller.initialize();await resume(restored);assert.equal(restored.state.run!.status,'idle');assert.equal(restored.state.tagPreparation!.status,'ready');assert.ok(restored.calls.every(call=>call.id!==originalId));assert.equal([...first.calls,...restored.calls].filter(call=>call.id===originalId).length,1);assert.equal(fingerprint(restored.state.facts),facts);assert.equal(restored.writes(),0);
});
test('a returned but unparsed response is replayed after restart without another dispatch',async()=>{
  const first=harness(retainedLibrary(),{interruptReturned:true});await resume(first);assert.equal(first.state.run!.status,'paused');assert.ok(first.state.run!.consolidation!.pendingResponse);const receivedId=first.calls[0].id,restored=harness(clone(first.saved.at(-1)!));
  await restored.controller.initialize();await resume(restored);assert.equal(restored.state.run!.status,'idle');assert.ok(restored.calls.every(call=>call.id!==receivedId));assert.equal(restored.state.run!.consolidation!.pendingResponse,undefined);assert.equal(restored.state.run!.consolidation!.work!.tasks.find(task=>task.id===receivedId)!.completed,true);assert.equal(restored.writes(),0);
});

test('malformed completed stage output is corrected once while its original diagnostic remains retained',async()=>{
  const state=retainedLibrary(),facts=fingerprint(state.facts),h=harness(state,{malformedRequest:2});await resume(h);assert.equal(state.run!.status,'idle');const checkpoint=state.run!.consolidation!,work=checkpoint.work!,first=work.tasks[0],corrected=work.tasks.find(task=>task.correctionAttempts===1)!;
  assert.ok(corrected.attempts!.some(attempt=>attempt.kind==='initial'&&attempt.raw==='RETAINED_MALFORMED_STAGE_REPLY }'));assert.equal(h.calls.filter(call=>call.id===first.id).length,1);assert.equal(h.calls.filter(call=>call.id===corrected.id).length,2);assert.equal(h.calls.filter(call=>call.kind==='correction').length,1);assert.equal(state.tagPreparation!.status,'ready');assert.equal(fingerprint(state.facts),facts);assert.equal(h.writes(),0);const calls=h.calls.length;await resume(h);assert.equal(h.calls.length,calls);
});
test('ordinary Resume preserves exhausted unproductive organization instead of discarding its durable limits',async()=>{
  const state=retainedLibrary(),facts=fingerprint(state.facts),h=harness(state,{verbose:true});await resume(h);assert.equal(state.run!.status,'paused');assert.equal(state.run!.consolidation!.work!.status,'failed');assert.equal(state.run!.consolidation!.failed,true);const work=fingerprint(state.run!.consolidation!.work),generation=state.run!.consolidation!.generationId,spent=state.run!.spentUSD,requestCount=h.calls.length;assert.equal(state.taxonomyProposal,null);
  h.setVerbose(false);await resume(h);assert.equal(state.run!.status,'paused');assert.equal(fingerprint(state.run!.consolidation!.work),work);assert.equal(state.run!.consolidation!.generationId,generation);assert.equal(h.calls.length,requestCount);assert.equal(fingerprint(state.facts),facts);assert.equal(state.run!.spentUSD,spent);assert.equal(h.writes(),0);
});

test('a stage correction rejected by budget keeps its undispatched attempt available and retains cached facts',async()=>{
  const state=retainedLibrary();Object.assign(state.settings,{provider:'api',inputPricePerMillion:1,outputPricePerMillion:1,budgetUSD:10,maxOutputTokens:1024});state.run!.settings=clone(state.settings);const facts=fingerprint(state.facts),h=harness(state,{invalidFacetRequest:1,blockCorrectionBudget:true});await resume(h);
  assert.equal(state.run!.status,'paused');const task=state.run!.consolidation!.work!.tasks.find(task=>!task.completed)!;assert.equal(task.correctionAttempts??0,0);assert.equal(task.correctionPending,true);assert.equal(h.calls.filter(call=>call.kind==='correction').length,0);assert.equal(state.run!.consolidation!.work!.automaticRequests,1);assert.ok(task.validationError);assert.equal(fingerprint(state.facts),facts);
  await h.controller.invoke('save-settings',{settings:{...state.settings,budgetUSD:10}});await resume(h);assert.equal(state.run!.status,'idle');assert.equal(task.id,state.run!.consolidation!.work!.tasks[0].id);assert.equal(state.run!.consolidation!.work!.tasks[0].correctionAttempts,1);assert.equal(h.calls.filter(call=>call.kind==='correction').length,1);assert.equal(state.run!.consolidation!.work!.automaticRequests,h.calls.length);assert.equal(fingerprint(state.facts),facts);assert.equal(h.writes(),0);
});
test('authentication after correction dispatch remains consumed across restart until explicit Resume retries that part',async()=>{
  const state=retainedLibrary(),facts=fingerprint(state.facts),h=harness(state,{invalidFacetRequest:2,authCorrection:true});await resume(h);assert.equal(state.run!.status,'paused');const work=state.run!.consolidation!.work!,completed=work.tasks.find(task=>task.completed)!,failed=work.tasks.find(task=>!task.completed)!,workId=work.id,spent=state.run!.spentUSD;
  assert.equal(failed.correctionAttempts,1);assert.equal(failed.correctionPending,false);assert.equal(h.calls.filter(call=>call.kind==='correction').length,1);
  const restored=harness(clone(h.saved.at(-1)!));await restored.controller.initialize();assert.equal(restored.calls.length,0);assert.equal(restored.state.run!.consolidation!.work!.tasks.find(task=>task.id===failed.id)!.correctionAttempts,1);
  await resume(restored);assert.equal(restored.state.run!.status,'idle');assert.equal(restored.state.run!.consolidation!.work!.id,workId);assert.ok(restored.calls.every(call=>call.id!==completed.id));const retried=restored.state.run!.consolidation!.work!.tasks.find(task=>task.id===failed.id)!;assert.equal(retried.requestGeneration,1);assert.equal(retried.correctionAttempts,0);assert.ok(restored.state.run!.spentUSD>=spent);assert.equal(fingerprint(restored.state.facts),facts);assert.equal(restored.writes(),0);
});
test('a persisted completed correction response is replayed after restart without a second correction dispatch',async()=>{
  const h=harness(retainedLibrary(),{invalidFacetRequest:1,interruptCorrection:true});await resume(h);assert.equal(h.state.run!.status,'paused');const checkpoint=h.state.run!.consolidation!,pending=checkpoint.pendingResponse!;assert.equal(pending.kind,'correction');assert.equal(checkpoint.work!.tasks[0].correctionAttempts,1);assert.equal(h.calls.filter(call=>call.kind==='correction').length,1);
  const restored=harness(clone(h.saved.at(-1)!));await restored.controller.initialize();await resume(restored);assert.equal(restored.state.run!.status,'idle');assert.ok(restored.calls.every(call=>call.id!==pending.requestId));assert.equal(restored.state.run!.consolidation!.work!.tasks[0].correctionAttempts,1);assert.equal(restored.state.run!.consolidation!.pendingResponse,undefined);assert.equal(restored.state.tagPreparation!.status,'ready');assert.equal(restored.writes(),0);
});

test('a failed correction advances automatically to a fresh bounded generation and completes without another Resume',async()=>{
  const state=retainedLibrary(20);Object.assign(state.settings,{provider:'deepseek',inputPricePerMillion:1,outputPricePerMillion:1,budgetUSD:10});state.run!.settings=clone(state.settings);
  const facts=fingerprint(state.facts),native=fingerprint(state.nativeTags),spent=state.run!.spentUSD;
  const h=harness(state,{costUSD:0.0002,respond(data,index){if(index===1)return {tags:[],merges:[],excluded:[]};if(data.consolidationRepair)return {repairs:[]};return stageResponse(data);}});
  await resume(h);
  assert.equal(state.run!.status,'idle',state.run!.message);assert.equal(state.tagPreparation!.status,'ready');assert.deepEqual(h.calls.slice(0,3).map(call=>call.kind),['initial','correction','initial']);
  assert.equal(h.calls.filter(call=>call.kind==='correction').length,1);assert.ok(h.calls.every(call=>call.provider==='deepseek'&&call.bytes<=CONSOLIDATION_REQUEST_BYTE_LIMIT));assert.ok(state.run!.spentUSD>spent);
  assert.equal(fingerprint(state.facts),facts);assert.equal(fingerprint(state.nativeTags),native);assert.equal(state.run!.jobs.filter(job=>job.status==='completed').length,20);assert.equal(h.writes(),0);assert.equal(h.pdfReads(),0);
  const work=state.run!.consolidation!.work!;assert.equal(work.automaticRequests,h.calls.length);assert.ok(work.tasks.some(task=>(task.requestGeneration??0)>0));assert.ok(work.tasks.some(task=>task.attempts?.some(attempt=>attempt.kind==='correction')));
});

test('provider failures during correction stop automatic recovery and preserve the selected paid provider across restart',async()=>{
  for(const category of ['authentication','quota','permission','configuration','network'] as const){
    const state=retainedLibrary(20);Object.assign(state.settings,{provider:'deepseek',inputPricePerMillion:1,outputPricePerMillion:1,budgetUSD:10});state.run!.settings=clone(state.settings);const facts=fingerprint(state.facts),spent=state.run!.spentUSD;
    const h=harness(state,{costUSD:0.0002,respond(data,index){if(index===1)return {tags:[],merges:[],excluded:[]};if(data.consolidationRepair)throw new ProviderError(`Synthetic ${category} stop.`,category,{status:category==='quota'?429:category==='network'?503:401});return stageResponse(data);}});
    await resume(h);assert.equal(state.run!.status,'paused');assert.equal(h.calls.length,2);assert.equal(state.taxonomyProposal,null);assert.equal(state.run!.consolidation!.work!.automaticRequests,2);assert.ok(h.calls.every(call=>call.provider==='deepseek'));assert.equal(state.settings.provider,'deepseek');assert.ok(state.run!.spentUSD>=spent);
    const restored=harness(clone(h.saved.at(-1)!));await restored.controller.initialize();assert.equal(restored.calls.length,0);assert.equal(restored.state.run!.spentUSD,state.run!.spentUSD);assert.equal(restored.state.run!.consolidation!.work!.automaticRequests,2);assert.equal(fingerprint(restored.state.facts),facts);assert.equal(restored.writes(),0);
  }
});

test('cancelling a pending correction prevents late output from dispatching a fresh generation or changing evidence',async t=>{
  const state=retainedLibrary(20),facts=fingerprint(state.facts);let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});let signal:AbortSignal|undefined;
  const h=harness(state,{async respond(data,index,_settings,requestSignal){if(index===1)return {tags:[],merges:[],excluded:[]};if(data.consolidationRepair){signal=requestSignal;entered();await waiting;return {repairs:[]};}return stageResponse(data);}});t.after(()=>release());
  await h.controller.invoke('resume');await started;await h.controller.invoke('cancel');assert.equal(signal?.aborted,true);release();await h.controller.waitForIdle();
  assert.equal(state.run!.status,'idle');assert.match(state.run!.message,/cancel/i);assert.equal(h.calls.length,2);assert.equal(state.taxonomyProposal,null);assert.equal(fingerprint(state.facts),facts);assert.equal(h.writes(),0);assert.equal(h.pdfReads(),0);
});

test('repeated bad parts split automatically to grounded local fallbacks and still receive a complete global review',async()=>{
  const state=retainedLibrary(20),facts=fingerprint(state.facts),active=fingerprint(state.tags),h=harness(state,{respond(data){if(data.consolidationRepair)return {repairs:[]};if(data.consolidationStage==='map')return {tags:[],merges:[],excluded:[]};return stageResponse(data);}});
  await resume(h);assert.equal(state.run!.status,'idle',state.run!.message);assert.equal(state.tagPreparation!.status,'ready');const work=state.run!.consolidation!.work!;
  assert.ok(work.tasks.some(task=>task.superseded));assert.ok(work.tasks.some(task=>task.parentTaskId));assert.ok(work.tasks.some(task=>task.localFallback));
  assert.ok(work.tasks.every(task=>(task.automaticFreshAttempts??0)<=1&&(task.splitDepth??0)<=4));assert.ok(work.tasks.filter(task=>task.parentTaskId).every(task=>task.automaticFreshAttempts===1));assert.ok(work.tasks.filter(task=>task.localFallback).every(task=>task.inputIds.length<=8));
  assert.ok(h.calls.some(call=>call.phase==='final'));assert.ok(h.calls.length<=512);assert.equal(work.automaticRequests,h.calls.length);assert.equal(state.taxonomyProposal!.tags.filter(tag=>!tag.custom).length,80);
  assert.deepEqual(new Set(state.taxonomyProposal!.tags.filter(tag=>!tag.custom).flatMap(tag=>state.taxonomyProposal!.support[tag.id].registryIds!)),new Set(Object.keys(state.taxonomyProposal!.evidenceSnapshot!.entries)));
  assert.equal(fingerprint(state.facts),facts);assert.equal(fingerprint(state.tags),active);assert.equal(h.writes(),0);assert.equal(h.pdfReads(),0);
});

test('restart replays a returned fresh-generation response without resetting its consumed automatic allowance',async()=>{
  const state=retainedLibrary(20),facts=fingerprint(state.facts),h=harness(state,{respond(data,index){if(index===1)return {tags:[],merges:[],excluded:[]};if(data.consolidationRepair)return {repairs:[]};return stageResponse(data);},interruptWhen(next){return !!next.run?.consolidation?.pendingResponse&&next.run.consolidation.work!.tasks.some(task=>(task.automaticFreshAttempts??0)>0);}});
  await resume(h);assert.equal(state.run!.status,'paused');const pending=state.run!.consolidation!.pendingResponse!,task=state.run!.consolidation!.work!.tasks.find(task=>task.id===pending.requestId)!;
  assert.ok(pending);assert.equal(task.automaticFreshAttempts,1);const generation=task.requestGeneration,requests=state.run!.consolidation!.work!.automaticRequests!;
  const restored=harness(clone(h.saved.at(-1)!));await restored.controller.initialize();assert.equal(restored.calls.length,0);await resume(restored);
  assert.equal(restored.state.run!.status,'idle');const completed=restored.state.run!.consolidation!.work!.tasks.find(value=>value.id===task.id)!;assert.equal(completed.completed,true);assert.equal(completed.requestGeneration,generation);assert.equal(completed.automaticFreshAttempts,1);assert.ok(restored.calls.every(call=>call.id!==pending.requestId));
  assert.equal(restored.state.run!.consolidation!.work!.automaticRequests,requests+restored.calls.length);assert.equal(fingerprint(restored.state.facts),facts);assert.equal(restored.writes(),0);
});

test('a failed pre-dispatch save rolls back the automatic request count and budget reservation before restart',async()=>{
  const state=retainedLibrary(20);Object.assign(state.settings,{provider:'deepseek',inputPricePerMillion:1,outputPricePerMillion:1,budgetUSD:10});state.run!.settings=clone(state.settings);
  const work=retainedCheckpoint(state),facts=fingerprint(state.facts),spent=state.run!.spentUSD;
  const h=harness(state,{interruptWhen(next){return next.run?.status==='running'&&next.run.consolidation?.work?.automaticRequests===1&&!next.run.consolidation.pendingResponse;}});
  await resume(h);assert.equal(state.run!.status,'paused');assert.equal(h.calls.length,0);assert.equal(state.run!.spentUSD,spent);assert.equal(state.run!.consolidation!.work!.automaticRequests??0,0);
  const restored=harness(clone(h.saved.at(-1)!));await restored.controller.initialize();await resume(restored);assert.equal(restored.state.run!.status,'idle');assert.equal(restored.state.run!.consolidation!.work!.id,work.id);assert.equal(restored.state.run!.consolidation!.work!.automaticRequests,restored.calls.length);assert.equal(fingerprint(restored.state.facts),facts);assert.equal(restored.writes(),0);
});

test('ordinary Resume never resets an exhausted durable organization request limit or completed parts',async()=>{
  const state=retainedLibrary(20),work=retainedCheckpoint(state,true);work.automaticRequests=512;const facts=fingerprint(state.facts),first=fingerprint(work.tasks[0]),spent=state.run!.spentUSD,h=harness(state);
  await resume(h);assert.equal(state.run!.status,'paused');assert.equal(h.calls.length,0);assert.equal(state.run!.consolidation!.work!.automaticRequests,512);assert.equal(fingerprint(state.run!.consolidation!.work!.tasks[0]),first);assert.equal(state.run!.spentUSD,spent);
  const restored=harness(clone(h.saved.at(-1)!));await restored.controller.initialize();await resume(restored);assert.equal(restored.calls.length,0);assert.equal(restored.state.run!.status,'paused');assert.equal(restored.state.run!.consolidation!.work!.id,work.id);assert.equal(restored.state.run!.consolidation!.work!.automaticRequests,512);assert.equal(fingerprint(restored.state.facts),facts);assert.equal(restored.writes(),0);
});
