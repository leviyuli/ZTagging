import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
import {ensureFactConceptIds} from '../src/evidence.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import type {CompletionResult,ProviderSettings} from '../src/providers.ts';
import {ProviderError} from '../src/providers.ts';
import {CONSOLIDATION_REQUEST_BYTE_LIMIT} from '../src/library-consolidation.ts';

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
interface InputCandidate {registryId?:string;candidateId?:string;name?:string;sources?:{label:string}[]}
interface StageInput {requestId:string;consolidationStage:'map'|'reduce'|'final';conceptRegistry?:InputCandidate[];candidates?:InputCandidate[];preparationPolicyVersion?:number}
function retainedLibrary():AppState {
  const state=initialState();state.settings.model='synthetic-model';
  for(let index=0;index<64;index++){
    const quotations=Array.from({length:4},(_,concept)=>`Synthetic phenomenon ${index*4+concept} is established by this experiment. ${'The supporting scientific measurement is reported in the supplied abstract. '.repeat(20)}`),paper:PaperRecord={id:`1:P${index}`,itemID:index+1,libraryID:1,key:`P${index}`,title:`Synthetic experiment ${index}`,abstract:quotations.join(' '),keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
    const facts:PaperFacts={paperId:paper.id,metadataFingerprint:paper.fingerprint,inputFingerprint:paper.fingerprint,provider:'retained-provider',model:'retained-model',extractionVersion:1,summary:'A retained validated scientific synopsis. '.repeat(30),needsPDF:false,concepts:quotations.map((quote,concept)=>({name:`synthetic phenomenon ${index*4+concept}`,facet:'phenomenon',evidence:[{source:'abstract',text:quote}]}))};state.papers[paper.id]=paper;state.facts[paper.id]=facts;state.nativeTags[paper.id]=[{tag:'Manual project',type:0}];
  }
  ensureFactConceptIds(Object.values(state.facts));
  state.run={id:'completed-library-extraction',kind:'rebuild',scope:'library',automatic:false,status:'paused',jobs:Object.keys(state.papers).map(paperId=>({id:`job-${paperId}`,paperId,status:'completed'})),vocabCursor:0,vocabFinished:false,message:'Resume retained consolidation.',spentUSD:0.15,settings:clone(state.settings),vocabularyVersion:state.vocabularyVersion};return state;
}
function stageResponse(data:StageInput) {
  const registry=!!data.conceptRegistry,entries=data.conceptRegistry??data.candidates??[];
  return {tags:entries.map((entry,index)=>{const name=registry?entry.sources![0].label:entry.name!;return {key:`output-${index}`,name,fullName:name,description:`The experimentally established scientific scope of ${name}.`,facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],...(registry?{supportRegistryIds:[entry.registryId]}:{supportCandidateIds:[entry.candidateId]})};}),merges:[],excluded:[]};
}
function harness(state:AppState,options:{failRequest?:number;interruptReturned?:boolean;malformedRequest?:number;verbose?:boolean}={}) {
  const calls:{id:string;phase:string;bytes:number}[]=[],saved:AppState[]=[];let writes=0,pdfReads=0,interrupted=false,verbose=options.verbose??false,persistedReturned=false;
  const ai:ControllerEnvironment['ai']={async completeJson(_system:string,prompt:string,settings:ProviderSettings):Promise<CompletionResult>{
    assert.equal(settings.model,'synthetic-model');const data:StageInput=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]);assert.ok(data.consolidationStage,'Completed factual extraction must not call the extractor or unrelated provider workflows');assert.equal(data.preparationPolicyVersion,undefined,'These exact factual names need no semantic repair');const count=new TextEncoder().encode(prompt).length;assert.ok(count<=CONSOLIDATION_REQUEST_BYTE_LIMIT);calls.push({id:data.requestId,phase:data.consolidationStage,bytes:count});if(calls.length===options.failRequest)throw new Error('Synthetic interrupted provider connection');if(calls.length===options.malformedRequest)throw new ProviderError('The completed assistant reply was not JSON.','invalid-response',{rawText:'RETAINED_MALFORMED_STAGE_REPLY }',completion:{text:'RETAINED_MALFORMED_STAGE_REPLY }',usage:{inputTokens:10,outputTokens:10},usageKnown:true,estimatedCostUSD:0}});const value=stageResponse(data);if(verbose)for(const tag of value.tags)tag.description='A scientifically separate scope remains deliberately verbose. '.repeat(28);return {value,text:JSON.stringify(value),usage:{inputTokens:10,outputTokens:10},usageKnown:true,estimatedCostUSD:0};
  },async hasApiKey(){return true;},async getSession(){return {connected:true,sharing:true,email:null,accountId:null,accounts:[]};},async testConnection(){throw new Error('No connection test is required');},async listModels(){return [];},async setApiKey(){},async removeApiKey(){},async signIn(){throw new Error('No sign-in is required');},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}};
  const env:ControllerEnvironment={ai,host:{async list(){return clone(Object.values(state.papers));},async read(itemID){return clone(Object.values(state.papers).find(paper=>paper.itemID===itemID)??null);},async readTags(){return [{tag:'Manual project',type:0}];},async pdfText(){pdfReads++;return '';},async apply(){writes++;throw new Error('Consolidation cannot write native tags');},async show(){},async saveSearch(){}},persist:async next=>{
    if(options.interruptReturned&&!interrupted&&next.run?.consolidation?.pendingResponse){interrupted=true;throw new Error('Synthetic interruption after receiving a completed response');}persistedReturned ||= !!next.run?.consolidation?.pendingResponse;saved.splice(0,saved.length,clone(next));
  }};
  return {state,calls,saved,controller:new AppController(state,env),writes:()=>writes,pdfReads:()=>pdfReads,persistedReturned:()=>persistedReturned,setVerbose:(value:boolean)=>{verbose=value;}};
}
async function resume(h:ReturnType<typeof harness>){await h.controller.invoke('resume');await h.controller.waitForIdle();}

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

test('malformed completed stage output stays diagnostic and Resume retries only its unfinished part',async()=>{
  const state=retainedLibrary(),facts=fingerprint(state.facts),h=harness(state,{malformedRequest:2});await resume(h);assert.equal(state.run!.status,'paused');const checkpoint=state.run!.consolidation!,work=checkpoint.work!,first=work.tasks.find(task=>task.completed)!,failed=work.tasks.find(task=>!task.completed)!;
  assert.equal(failed.raw,'RETAINED_MALFORMED_STAGE_REPLY }');assert.equal(checkpoint.failed,true);assert.equal(state.taxonomyProposal,null);assert.ok(checkpoint.diagnostics!.some(value=>/not JSON/.test(value)));assert.equal(h.writes(),0);
  await resume(h);assert.equal(state.run!.status,'idle');assert.equal(h.calls.filter(call=>call.id===first.id).length,1);assert.equal(h.calls.filter(call=>call.id===failed.id).length,2);assert.equal(state.tagPreparation!.status,'ready');assert.equal(fingerprint(state.facts),facts);assert.equal(h.writes(),0);
});
test('Resume can restart failed unproductive organization while preserving spent budget and completed paper facts',async()=>{
  const state=retainedLibrary(),facts=fingerprint(state.facts),h=harness(state,{verbose:true});await resume(h);assert.equal(state.run!.status,'paused');assert.equal(state.run!.consolidation!.work!.status,'failed');assert.equal(state.run!.consolidation!.failed,true);const workId=state.run!.consolidation!.work!.id,generation=state.run!.consolidation!.generationId,spent=state.run!.spentUSD,requestCount=h.calls.length;assert.equal(state.taxonomyProposal,null);assert.match(state.run!.message,/Resume/);
  h.setVerbose(false);await resume(h);assert.equal(state.run!.status,'idle');assert.notEqual(state.run!.consolidation!.work!.id,workId);assert.notEqual(state.run!.consolidation!.generationId,generation);assert.ok(h.calls.length>requestCount);assert.equal(state.tagPreparation!.status,'ready');assert.equal(fingerprint(state.facts),facts);assert.ok(state.run!.spentUSD>=spent);assert.equal(h.writes(),0);
});
