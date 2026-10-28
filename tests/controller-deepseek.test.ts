import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController, initialState, validState } from '../src/controller.ts';
import type { AppState, ControllerEnvironment } from '../src/controller.ts';
import { paperFingerprint } from '../src/core.ts';
import type { PaperRecord } from '../src/core.ts';
import type { LibraryHost, NativeTag, TagPatch } from '../src/platform.ts';
import { sameTags } from '../src/platform.ts';
import type { ApiKeyProvider, CompletionResult, ProviderMode, ProviderSettings } from '../src/providers.ts';

const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const ABSTRACT='We measure catalyst-layer proton transport resistance in a PEM water electrolyzer.';
function paper(itemID=1):PaperRecord {
  const value:PaperRecord={id:`1:P${itemID}`,itemID,libraryID:1,key:`P${itemID}`,title:`Catalyst-layer resistance ${itemID}`,abstract:ABSTRACT,keywords:[],fingerprint:''};
  value.fingerprint=paperFingerprint(value);return value;
}
class MemoryHost implements LibraryHost {
  papers:PaperRecord[]=[];tags=new Map<number,NativeTag[]>();
  constructor(papers:PaperRecord[]){this.papers=copy(papers);for(const p of papers)this.tags.set(p.itemID,[]);}
  async list(){return copy(this.papers);}
  async read(itemID:number){return copy(this.papers.find(p=>p.itemID===itemID)??null);}
  async readTags(itemID:number){return copy(this.tags.get(itemID)??[]);}
  async pdfText(){return '';}
  async apply(patches:TagPatch[]){for(const patch of patches)if(!sameTags(await this.readTags(patch.itemID),patch.before))throw new Error('Stale native tags');for(const patch of patches)this.tags.set(patch.itemID,copy(patch.after));}
  async show(){}
  async saveSearch(){}
}
type Call={input:any;settings:ProviderSettings;signal?:AbortSignal;keyUsed:string|null};
function rawAnalysis(call:Call) {
  return {summary:`Analysis from ${call.settings.mode}`,concepts:['catalyst-layer resistance'],needsPDF:false,newTagCandidates:[],suggestions:[{
    tagId:'custom-rcl',reason:'The measured resistance is within an electrolyzer catalyst layer.',confidence:'high',match:'substantive',
    evidence:[{source:'abstract',text:call.input.paper.abstract}],
  }]};
}
class MockAI {
  keys=new Map<ApiKeyProvider,string>();keyReads:ApiKeyProvider[]=[];keyWrites:{provider:ApiKeyProvider;key:string|null}[]=[];
  calls:Call[]=[];modelCalls:ProviderMode[]=[];testCalls:ProviderSettings[]=[];selectedAccounts:string[]=[];usageKnown=true;
  handler:(call:Call,index:number)=>unknown|Promise<unknown>=rawAnalysis;
  async hasApiKey(provider:ApiKeyProvider='api'){this.keyReads.push(provider);return this.keys.has(provider);}
  async setApiKey(key:string,provider:ApiKeyProvider='api'){this.keys.set(provider,key);this.keyWrites.push({provider,key});}
  async removeApiKey(provider:ApiKeyProvider='api'){this.keys.delete(provider);this.keyWrites.push({provider,key:null});}
  async getSession(){return {connected:true,sharing:true,email:'researcher@example.org',accountId:'account',accounts:[]};}
  async signIn(){return this.getSession();}
  cancelSignIn(){}
  async signOut(){return {revoked:true};}
  async selectAccount(id:string){this.selectedAccounts.push(id);}
  async listModels(mode:ProviderMode){this.modelCalls.push(mode);return [{id:`${mode}-model`,name:`${mode} model`}];}
  async testConnection(settings:ProviderSettings):Promise<CompletionResult>{this.testCalls.push(copy(settings));return {value:{ok:true},text:'{"ok":true}',usage:{inputTokens:1,outputTokens:1},usageKnown:true,estimatedCostUSD:settings.mode==='chatgpt'?null:0.00001};}
  async completeJson(_instructions:string,prompt:string,settings:ProviderSettings,signal?:AbortSignal):Promise<CompletionResult>{
    if(signal?.aborted)throw new Error('Request cancelled before dispatch');
    const marker='INPUT_DATA_JSON:\n';
    const call:Call={input:JSON.parse(prompt.slice(prompt.indexOf(marker)+marker.length)),settings:copy(settings),signal,keyUsed:settings.mode==='chatgpt'?null:this.keys.get(settings.mode as ApiKeyProvider)??null};
    this.calls.push(call);
    let onAbort:(()=>void)|undefined;
    const aborted=new Promise<never>((_resolve,reject)=>{onAbort=()=>reject(new Error('Request cancelled after connection changed'));signal?.addEventListener('abort',onAbort,{once:true});});
    let value:unknown;
    try{value=await Promise.race([Promise.resolve().then(()=>this.handler(call,this.calls.length-1)),aborted]);}
    finally{if(onAbort)signal?.removeEventListener('abort',onAbort);}
    return {value,text:JSON.stringify(value),usage:{inputTokens:100,outputTokens:10},usageKnown:this.usageKnown,
      estimatedCostUSD:settings.mode==='chatgpt'||!this.usageKnown?null:(100*(settings.inputCostPerMillion??0)+10*(settings.outputCostPerMillion??0))/1_000_000};
  }
}
function harness(provider:ProviderMode='deepseek',papers=[paper()]) {
  const state=initialState();state.tags[0].status='approved';state.vocabularyVersion=1;
  Object.assign(state.settings,{provider,model:'shared-model',inputPricePerMillion:1,outputPricePerMillion:2,budgetUSD:5,maxOutputTokens:512});
  const host=new MemoryHost(papers),ai=new MockAI(),saved:AppState[]=[];
  const env:ControllerEnvironment={host,ai,persist:async value=>{saved.push(copy(value));}};
  const controller=new AppController(state,env);return {state,host,ai,saved,controller};
}
type Harness=ReturnType<typeof harness>;
async function run(h:Harness){await h.controller.invoke('tag',{scope:'library'});await h.controller.waitForIdle();}
async function select(h:Harness,provider:ProviderMode,model='shared-model'){
  await h.controller.invoke('save-settings',{settings:{...h.state.settings,provider,model}});
  if(!h.state.settings.model)await h.controller.invoke('save-settings',{settings:{...h.state.settings,model}});
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}

test('schema-one OpenAI/ChatGPT state remains valid and DeepSeek current/run settings are accepted',async()=>{
  const old=initialState();delete old.deferredItemIDs;
  assert.equal(validState(old),true);old.settings.provider='api';assert.equal(validState(old),true);
  const deep=harness();await run(deep);assert.equal(validState(deep.state),true);
  const wrongCurrent=copy(deep.state) as any;wrongCurrent.settings.provider='unknown';assert.equal(validState(wrongCurrent),false);
  const wrongRun=copy(deep.state) as any;wrongRun.run.settings.provider='unknown';assert.equal(validState(wrongRun),false);
});

test('snapshot distinguishes stored DeepSeek and OpenAI keys without exposing either credential',async()=>{
  const h=harness();h.ai.keys.set('deepseek','fixture-deepseek-secret');
  let snapshot=await h.controller.snapshot();
  assert.equal(snapshot.connection.deepseekKeyStored,true);assert.equal(snapshot.connection.apiKeyStored,false);
  assert.deepEqual(h.ai.keyReads,['api','deepseek']);
  h.ai.keys.set('api','fixture-openai-secret');snapshot=await h.controller.snapshot();
  assert.equal(snapshot.connection.apiKeyStored,true);assert.equal(snapshot.connection.deepseekKeyStored,true);
  assert.ok(!JSON.stringify(snapshot).includes('fixture-'));
});

test('explicit DeepSeek key actions isolate credentials, verification, and another provider catalog',async()=>{
  const h=harness('api');h.ai.keys.set('api','fixture-openai');h.state.models=['openai-catalog'];
  h.state.verifiedConnections=['api:shared-model','deepseek:shared-model','chatgpt:shared-model'];
  await h.controller.invoke('save-api-key',{provider:'deepseek',key:'fixture-deepseek'});
  assert.equal(h.ai.keys.get('deepseek'),'fixture-deepseek');assert.equal(h.ai.keys.get('api'),'fixture-openai');
  assert.deepEqual(h.state.models,['openai-catalog']);
  assert.deepEqual(h.state.verifiedConnections,['api:shared-model','chatgpt:shared-model']);
  await h.controller.invoke('remove-api-key',{provider:'deepseek'});
  assert.equal(h.ai.keys.has('deepseek'),false);assert.equal(h.ai.keys.get('api'),'fixture-openai');
  assert.deepEqual(h.ai.keyWrites.map(change=>change.provider),['deepseek','deepseek']);
});

test('legacy key actions default to OpenAI while preserving DeepSeek credentials and verification',async()=>{
  const h=harness();h.ai.keys.set('deepseek','fixture-deepseek');h.state.models=['deepseek-catalog'];
  h.state.verifiedConnections=['api:shared-model','deepseek:shared-model'];
  await h.controller.invoke('save-api-key',{key:'fixture-openai'});
  assert.equal(h.ai.keys.get('api'),'fixture-openai');assert.equal(h.ai.keys.get('deepseek'),'fixture-deepseek');
  assert.deepEqual(h.state.models,['deepseek-catalog']);assert.deepEqual(h.state.verifiedConnections,['deepseek:shared-model']);
  await h.controller.invoke('remove-api-key');assert.equal(h.ai.keys.has('api'),false);assert.equal(h.ai.keys.has('deepseek'),true);
});

test('invalid explicit key providers are rejected before touching any credential',async()=>{
  const h=harness();
  for(const provider of [null,'chatgpt','unknown','']) {
    await assert.rejects(h.controller.invoke('save-api-key',{provider,key:'fixture'}),/provider/i);
    await assert.rejects(h.controller.invoke('remove-api-key',{provider}),/provider/i);
  }
  assert.deepEqual(h.ai.keyWrites,[]);
});

test('DeepSeek settings are retained explicitly and invalid providers cannot silently select ChatGPT',async()=>{
  const h=harness('api');h.state.models=['old-model'];
  await h.controller.invoke('save-settings',{settings:{...h.state.settings,provider:'deepseek',model:'deepseek-chat'}});
  assert.equal(h.state.settings.provider,'deepseek');assert.equal(h.state.settings.model,'deepseek-chat');assert.deepEqual(h.state.models,[]);
  await assert.rejects(h.controller.invoke('save-settings',{settings:{...h.state.settings,provider:'typo'}}),/Choose/);
  assert.equal(h.state.settings.provider,'deepseek');
});

test('the first saved DeepSeek selection preserves an explicitly entered model and prices for testing',async()=>{
  const h=harness('api');h.state.models=['old-openai-model'];
  await h.controller.invoke('save-settings',{settings:{...h.state.settings,provider:'deepseek',model:'deepseek-chat',inputPricePerMillion:0.28,outputPricePerMillion:0.42}});
  await h.controller.invoke('test-connection');
  assert.equal(h.ai.testCalls[0].mode,'deepseek');assert.equal(h.ai.testCalls[0].model,'deepseek-chat');
  assert.equal(h.ai.testCalls[0].inputCostPerMillion,0.28);assert.equal(h.ai.testCalls[0].outputCostPerMillion,0.42);
  assert.deepEqual(h.state.models,[]);assert.equal((await h.controller.snapshot()).connection.verified,true);
});

test('model discovery and connection verification use DeepSeek and remain provider-specific',async()=>{
  const h=harness();h.state.verifiedConnections=['api:shared-model'];
  await h.controller.invoke('discover-models');assert.deepEqual(h.ai.modelCalls,['deepseek']);assert.deepEqual(h.state.models,['deepseek-model']);
  assert.equal((await h.controller.snapshot()).connection.verified,false);
  await h.controller.invoke('test-connection');
  assert.equal(h.ai.testCalls[0].mode,'deepseek');assert.equal(h.ai.testCalls[0].model,'shared-model');
  assert.deepEqual(h.state.verifiedConnections,['api:shared-model','deepseek:shared-model']);
  assert.equal((await h.controller.snapshot()).connection.verified,true);
});

test('DeepSeek requires explicit token prices and applies the same pre-dispatch paid budget guard as OpenAI',async()=>{
  for(const provider of ['api','deepseek'] as const) {
    const noPrices=harness(provider);noPrices.state.settings.inputPricePerMillion=0;noPrices.state.settings.outputPricePerMillion=0;
    await assert.rejects(noPrices.controller.invoke('tag',{scope:'library'}),/token prices/);assert.equal(noPrices.ai.calls.length,0);
    const capped=harness(provider);Object.assign(capped.state.settings,{budgetUSD:0.01,inputPricePerMillion:100,outputPricePerMillion:100,maxOutputTokens:32768});
    await run(capped);assert.equal(capped.state.run?.status,'paused');assert.equal(capped.ai.calls.length,0);
    assert.match(capped.state.run!.message,/remaining estimated API budget/);assert.equal(capped.state.run?.spentUSD,0);
    assert.ok((await capped.controller.snapshot()).queue.estimatedUSD!>0.01);
  }
});

test('known DeepSeek usage replaces its reservation while missing usage preserves the full reservation',async()=>{
  const known=harness();await run(known);
  assert.equal(known.ai.calls[0].settings.mode,'deepseek');assert.ok(Math.abs(known.state.run!.spentUSD-0.00012)<1e-12);
  const unknown=harness();unknown.ai.usageKnown=false;await run(unknown);
  assert.ok(unknown.state.run!.spentUSD>known.state.run!.spentUSD);
  assert.ok(unknown.state.warnings.some(warning=>warning.status==='active'&&warning.message.includes('omitted usage')));
  assert.ok(unknown.saved.some(state=>(state.run?.spentUSD??0)>0&&state.run?.jobs[0].status==='running'));
});

test('a DeepSeek quota failure pauses and retains cost reservation without falling back to OpenAI or ChatGPT',async()=>{
  const h=harness();h.ai.keys.set('api','fixture-openai');h.ai.keys.set('deepseek','fixture-deepseek');
  h.ai.handler=()=>{throw new Error('DeepSeek insufficient balance (402)');};await run(h);
  assert.equal(h.state.run?.status,'paused');assert.ok(h.state.run!.spentUSD>0);
  assert.deepEqual(h.ai.calls.map(call=>call.settings.mode),['deepseek']);assert.equal(h.ai.keys.get('api'),'fixture-openai');
  h.ai.handler=rawAnalysis;await h.controller.invoke('resume');await h.controller.waitForIdle();
  assert.equal(h.state.run?.status,'idle');assert.deepEqual(h.ai.calls.map(call=>call.settings.mode),['deepseek','deepseek']);
});

test('DeepSeek does not reuse cached OpenAI output even when both providers expose the same model ID',async()=>{
  const h=harness('api');await run(h);assert.equal(h.ai.calls.length,1);assert.equal(h.state.analyses['1:P1'].provider,'api');
  await select(h,'deepseek');await run(h);
  assert.deepEqual(h.ai.calls.map(call=>call.settings.mode),['api','deepseek']);
  assert.equal(h.state.analyses['1:P1'].provider,'deepseek');assert.equal(h.state.papers['1:P1'].summary,'Analysis from deepseek');
  await run(h);assert.equal(h.ai.calls.length,2,'Repeated DeepSeek input may reuse only the matching DeepSeek cache');
});

test('explicitly resuming an OpenAI run with DeepSeek reanalyzes completed OpenAI papers',async()=>{
  const h=harness('api',[paper(1),paper(2)]);
  h.ai.handler=call=>{if(call.settings.mode==='api'&&call.input.paper.title.endsWith('2'))throw new Error('OpenAI quota reached');return rawAnalysis(call);};
  await run(h);assert.equal(h.state.run?.status,'paused');assert.deepEqual(h.state.run?.jobs.map(job=>job.status),['completed','pending']);
  await select(h,'deepseek');await h.controller.invoke('resume');await h.controller.waitForIdle();
  assert.deepEqual(h.ai.calls.map(call=>call.settings.mode),['api','api','deepseek','deepseek']);
  assert.ok(Object.values(h.state.analyses).every(cache=>cache.provider==='deepseek'));
  assert.equal(h.state.run?.status,'idle');assert.equal(h.state.run?.settings.provider,'deepseek');
});

test('rotating an active DeepSeek key aborts and settles the old request before accepting the new key',async()=>{
  const h=harness();h.ai.keys.set('deepseek','fixture-old-deepseek');h.ai.keys.set('api','fixture-openai');
  h.state.models=['deepseek-model'];h.state.verifiedConnections=['api:shared-model','deepseek:shared-model'];
  const entered=deferred(),gate=deferred();h.ai.handler=async()=>{entered.resolve();await gate.promise;return {};};
  await h.controller.invoke('tag',{scope:'library'});await entered.promise;
  await h.controller.invoke('save-api-key',{provider:'deepseek',key:'fixture-new-deepseek'});
  assert.equal(h.ai.calls[0].signal?.aborted,true);assert.equal(h.ai.calls[0].keyUsed,'fixture-old-deepseek');
  assert.equal(h.state.run?.status,'paused');assert.equal(h.state.run?.jobs[0].status,'pending');
  assert.equal(h.ai.keys.get('deepseek'),'fixture-new-deepseek');assert.equal(h.ai.keys.get('api'),'fixture-openai');
  assert.deepEqual(h.state.models,[]);assert.deepEqual(h.state.verifiedConnections,['api:shared-model']);
  h.ai.handler=rawAnalysis;await h.controller.invoke('resume');await h.controller.waitForIdle();
  assert.equal(h.ai.calls[1].keyUsed,'fixture-new-deepseek');assert.equal(h.state.run?.status,'idle');
  assert.ok(!JSON.stringify(h.saved).includes('fixture-'));
  gate.resolve();
});

test('changing an OpenAI draft key cannot abort an active DeepSeek request or clear its catalog',async()=>{
  const h=harness();h.ai.keys.set('deepseek','fixture-deepseek');h.state.models=['deepseek-catalog'];h.state.verifiedConnections=['deepseek:shared-model','api:shared-model'];
  const entered=deferred(),gate=deferred();h.ai.handler=async call=>{entered.resolve();await gate.promise;return rawAnalysis(call);};
  await h.controller.invoke('tag',{scope:'library'});await entered.promise;
  await h.controller.invoke('save-api-key',{provider:'api',key:'fixture-new-openai'});
  assert.equal(h.ai.calls[0].signal?.aborted,false);assert.equal(h.state.run?.status,'running');
  assert.deepEqual(h.state.models,['deepseek-catalog']);assert.deepEqual(h.state.verifiedConnections,['deepseek:shared-model']);
  gate.resolve();await h.controller.waitForIdle();assert.equal(h.state.run?.status,'idle');
  assert.deepEqual(h.ai.calls.map(call=>call.settings.mode),['deepseek']);
});

test('ChatGPT account actions leave a DeepSeek run and its provider catalog intact',async()=>{
  const h=harness();h.state.models=['deepseek-catalog'];h.state.verifiedConnections=['deepseek:shared-model','chatgpt:shared-model'];
  const entered=deferred(),gate=deferred();h.ai.handler=async call=>{entered.resolve();await gate.promise;return rawAnalysis(call);};
  await h.controller.invoke('tag',{scope:'library'});await entered.promise;
  await h.controller.invoke('select-account',{id:'another-account'});await h.controller.invoke('sign-out');await h.controller.invoke('sign-in');
  assert.equal(h.state.run?.status,'running');assert.equal(h.ai.calls[0].signal?.aborted,false);
  assert.deepEqual(h.state.models,['deepseek-catalog']);assert.deepEqual(h.state.verifiedConnections,['deepseek:shared-model']);
  gate.resolve();await h.controller.waitForIdle();assert.equal(h.state.run?.status,'idle');
});

test('switching the selected provider during a request pauses until explicit resume with DeepSeek',async()=>{
  const h=harness('api');h.ai.keys.set('api','fixture-openai');h.ai.keys.set('deepseek','fixture-deepseek');
  const entered=deferred(),gate=deferred();h.ai.handler=async()=>{entered.resolve();await gate.promise;return {};};
  await h.controller.invoke('tag',{scope:'library'});await entered.promise;
  await select(h,'deepseek');await h.controller.waitForIdle();
  assert.equal(h.state.run?.status,'paused');assert.deepEqual(h.ai.calls.map(call=>call.settings.mode),['api']);
  assert.equal(h.state.analyses['1:P1'],undefined);
  h.ai.handler=rawAnalysis;await h.controller.invoke('resume');await h.controller.waitForIdle();
  assert.deepEqual(h.ai.calls.map(call=>call.settings.mode),['api','deepseek']);assert.equal(h.state.run?.status,'idle');
  gate.resolve();
});
