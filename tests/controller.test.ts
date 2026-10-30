import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController, initialState } from '../src/controller.ts';
import type { AppState, ControllerEnvironment } from '../src/controller.ts';
import { paperFingerprint } from '../src/core.ts';
import type { PaperRecord, TagDefinition } from '../src/core.ts';
import { sameTags } from '../src/platform.ts';
import type { LibraryHost, NativeTag, TagPatch } from '../src/platform.ts';
import type { CompletionResult, ProviderSettings } from '../src/providers.ts';

const clone = <T>(value:T):T => JSON.parse(JSON.stringify(value));
const DIRECT = 'We measure catalyst-layer proton transport resistance in a PEM water electrolyzer.';

function fixturePaper(itemID=1, overrides:Partial<PaperRecord>={}):PaperRecord {
  const p:PaperRecord={id:`1:KEY${itemID}`,itemID,libraryID:1,key:`KEY${itemID}`,
    title:`Catalyst-layer resistance in water electrolysis ${itemID}`,abstract:DIRECT,keywords:[],summary:'',concepts:[],fingerprint:'',...overrides};
  p.fingerprint=paperFingerprint(p);return p;
}

class MemoryHost implements LibraryHost {
  papers=new Map<number,PaperRecord>();
  tags=new Map<number,NativeTag[]>();
  pdfs=new Map<number,string>();
  pdfReads:number[]=[];
  applied:{patches:TagPatch[];label:string}[]=[];
  shown:number[]=[];
  searches:{name:string;tags:string[]}[]=[];
  selected:number[]=[];
  failApply=false;
  constructor(papers:PaperRecord[], nativeTags:Record<number,NativeTag[]>={}) {
    for(const p of papers)this.add(p,nativeTags[p.itemID]??p.keywords.map(tag=>({tag,type:1})));
  }
  add(paper:PaperRecord,tags:NativeTag[]=[]) {this.papers.set(paper.itemID,clone(paper));this.tags.set(paper.itemID,clone(tags));}
  setTags(itemID:number,tags:NativeTag[]) {this.tags.set(itemID,clone(tags));}
  edit(itemID:number,fields:Partial<PaperRecord>) {const p=this.papers.get(itemID)!;Object.assign(p,clone(fields));p.fingerprint=paperFingerprint(p);}
  async read(itemID:number) {
    const original=this.papers.get(itemID);if(!original)return null;
    const p=clone(original);p.keywords=(this.tags.get(itemID)??[]).filter(t=>t.type===1).map(t=>t.tag);delete p.pdfText;p.fingerprint=paperFingerprint(p);return p;
  }
  async list(scope:string) {
    const ids=scope==='selected'||scope==='collections'?this.selected:[...this.papers.keys()];
    const papers:(PaperRecord|null)[]=await Promise.all(ids.map(id=>this.read(id)));
    return papers.filter((p):p is PaperRecord=>p!==null).slice(0,scope==='pilot'?50:undefined);
  }
  async readTags(itemID:number) {if(!this.papers.has(itemID))throw new Error('Paper missing');return clone(this.tags.get(itemID)??[]);}
  async pdfText(itemID:number) {this.pdfReads.push(itemID);return this.pdfs.get(itemID)??'';}
  async apply(patches:TagPatch[],label:string) {
    if(this.failApply)throw new Error('Host transaction rejected');
    for(const patch of patches)if(!sameTags(await this.readTags(patch.itemID),patch.before))throw new Error('Tags changed after the preview. Refresh before applying.');
    this.applied.push({patches:clone(patches),label});
    for(const patch of patches)this.tags.set(patch.itemID,clone(patch.after));
  }
  async show(itemID:number) {this.shown.push(itemID);}
  async saveSearch(name:string,tags:string[]) {this.searches.push({name,tags:clone(tags)});}
}

type AIInput={protocolVersion?:number;selectionPhase?:'choosing'|'mapping';paperCount?:number;census?:{paperCount:number};conceptRegistry?:{registryId:string;sources:{label:string;paperId:string}[]}[];permittedRegistry?:{registryId:string;sourceIds:string[]}[];requestedPairs?:{id:string;tagId:string;sourceId:string;registryId:string;pairRef:string}[];tags?:{id:string;name:string}[];sources?:{sourceId:string;name:string}[];approvedVocabulary?:{id:string;name:string}[];paper?:{title:string;abstract:string;keywords:string[];pdf?:string};papers?:unknown[];facts?:{paperId:string;concepts:{name:string}[]}[]};
type AICall={input:AIInput;settings:ProviderSettings;prompt:string};
type AIHandler=(call:AICall,index:number)=>unknown|Promise<unknown>;

function normalAnalysis(call:AICall) {
  const p=call.input.paper!;
  const quote=p.abstract||p.pdf||p.title;
  return {summary:'Catalyst-layer resistance is investigated in water electrolysis.',concepts:['catalyst-layer resistance','water electrolysis'],needsPDF:false,newTagCandidates:[],
    suggestions:(call.input.approvedVocabulary??[]).map(tag=>({tagId:tag.id,reason:'The paper measures catalyst-layer transport resistance in a water electrolyzer.',confidence:'high',match:'substantive',evidence:[{source:p.abstract?'abstract':p.pdf?'pdf':'title',text:quote}]}))};
}

function normalFacts(call:AICall) {const p=call.input.paper!;return {summary:'Water electrolysis is studied.',concepts:[{name:'Water electrolysis',facet:'system',evidence:[{source:p.abstract?'abstract':p.pdf?'pdf':'title',text:p.abstract||p.pdf||p.title}]}],needsPDF:false};}
function normalTaxonomy(call:AICall) {return {tags:[{key:'water',name:'Water electrolysis',fullName:'Water electrolysis',description:'Electrochemical splitting of water to produce hydrogen.',facet:'system',aliases:['water splitting'],inclusions:[],exclusions:[],examples:[],parentKeys:[],relatedKeys:[],...(call.input.protocolVersion===2?{supportRegistryIds:(call.input.conceptRegistry??[]).filter(entry=>entry.sources.some(source=>source.label==='Water electrolysis')).map(entry=>entry.registryId)}:{support:(call.input.facts??[]).map(f=>({paperId:f.paperId,conceptNames:['Water electrolysis']}))})}],merges:[],excluded:[]};}
function normalMapping(call:AICall) {
  if(call.input.requestedPairs)return {judgements:call.input.requestedPairs.map(pair=>{
    const source=call.input.sources!.find(value=>value.sourceId===pair.sourceId),tag=call.input.tags!.find(value=>value.id===pair.tagId);assert.ok(source);assert.ok(tag);const matches=tag.name==='WE'&&source.name==='Water electrolysis';
    return {tagId:pair.tagId,registryId:pair.registryId,sourceIds:[pair.sourceId],relation:matches?'equivalent':'unrelated',reason:matches?'The quotation explicitly studies water electrolysis.':'This particular source does not establish the requested scientific meaning.'};
  })};
  const chosen=call.input.tags!.find(tag=>tag.name==='WE')!;
  return {judgements:call.input.sources!.map(source=>({tagId:chosen.id,registryId:call.input.permittedRegistry!.find(entry=>entry.sourceIds.includes(source.sourceId))!.registryId,sourceIds:[source.sourceId],relation:'equivalent',reason:'The complete source quotation explicitly studies water electrolysis.'})),outside:[]};
}

class MockAI {
  calls:AICall[]=[];
  handler:AIHandler=(call)=>call.input.selectionPhase==='mapping'?normalMapping(call):call.input.protocolVersion===2||call.input.facts?normalTaxonomy(call):call.input.permittedRegistry?{repairs:[]}:call.input.approvedVocabulary?normalAnalysis(call):normalFacts(call);
  async completeJson(_instructions:string,prompt:string,settings:ProviderSettings,_signal?:AbortSignal):Promise<CompletionResult> {
    const marker='INPUT_DATA_JSON:\n',index=prompt.indexOf(marker);
    if(index<0)throw new Error('Test requires the real core prompt JSON');
    const call={input:JSON.parse(prompt.slice(index+marker.length)) as AIInput,settings:clone(settings),prompt};
    this.calls.push(call);const value=await this.handler(call,this.calls.length-1);
    return {value,text:JSON.stringify(value),usage:{inputTokens:100,outputTokens:100},usageKnown:true,estimatedCostUSD:settings.mode==='api'?0.0002:null};
  }
  async hasApiKey(){return true;}
  async getSession(){return {connected:true,sharing:true,email:'test@example.org',accountId:'test-account',accounts:[]};}
  async testConnection(_settings:ProviderSettings):Promise<CompletionResult>{return {value:{ok:true},text:'{"ok":true}',usage:{inputTokens:1,outputTokens:1},usageKnown:true,estimatedCostUSD:null};}
  async listModels(){return [{id:'test-model',name:'Test model'}];}
  async setApiKey(_key:string){}
  async removeApiKey(){}
  async signIn(){return this.getSession();}
  cancelSignIn(){}
  async signOut(){}
  async selectAccount(_id:string){}
}

function harness(options:{papers?:PaperRecord[];nativeTags?:Record<number,NativeTag[]>;approved?:boolean;state?:AppState;host?:MemoryHost;ai?:MockAI}={}) {
  const state=options.state??initialState(),host=options.host??new MemoryHost(options.papers??[fixturePaper()],options.nativeTags),ai=options.ai??new MockAI();
  if(!options.state){state.settings.model='test-model';state.settings.inputPricePerMillion=1;state.settings.outputPricePerMillion=1;state.tags[0].matchingMode='auto';if(options.approved!==false){state.tags[0].status='approved';state.vocabularyVersion=1;}}
  const saves:AppState[]=[];
  const env:ControllerEnvironment={host,ai,persist:async value=>{saves.push(clone(value));}};
  const controller=new AppController(state,env);
  return {state,host,ai,saves,env,controller};
}

type Harness=ReturnType<typeof harness>;
async function run(h:Harness,action:'tag'|'rebuild'='tag',scope='library') {await h.controller.invoke(action,{scope});await h.controller.waitForIdle();}
async function acceptAll(h:Harness) {for(const s of h.state.suggestions.filter(s=>s.status==='pending'))await h.controller.invoke('accept-suggestion',{id:s.id});}
async function applyAccepted(h:Harness) {await h.controller.invoke('apply-suggestions',{ids:h.state.suggestions.filter(s=>s.status==='accepted'&&!s.applied).map(s=>s.id)});}
async function pilot(h:Harness) {await run(h,'tag','pilot');await acceptAll(h);await applyAccepted(h);await h.controller.invoke('mark-pilot-reviewed');}
function emptyAnalysis(){return {summary:'No approved topic is supported by the supplied content.',concepts:[],needsPDF:false,suggestions:[],newTagCandidates:[]};}

test('complete workflow scans, drafts and approves vocabulary, reviews a pilot, and applies one reversible batch',async()=>{
  const h=harness({approved:false,papers:[fixturePaper(1),fixturePaper(2)],nativeTags:{1:[{tag:'Fundamental',type:0}],2:[]}});
  await h.controller.invoke('scan',{scope:'library'});
  assert.equal(Object.keys(h.state.papers).length,2);
  assert.equal(h.ai.calls.length,0);
  await run(h,'rebuild');
  assert.equal(h.state.run?.status,'idle',h.state.run?.message);
  assert.equal(h.state.tags.length,1,'Discovery must not append staged core labels to the active vocabulary');
  assert.ok(h.state.taxonomyProposal!.tags.some(t=>t.name==='WE'&&t.fullName==='water electrolysis'&&t.status==='draft'));
  assert.deepEqual(h.state.taxonomyProposal!.issues,[]);
  assert.equal(h.host.applied.length,0);
  await h.controller.invoke('approve-taxonomy',{id:h.state.taxonomyProposal!.id});
  await h.controller.invoke('approve-vocabulary',{ids:['custom-rcl']});
  assert.ok(h.state.tags.every(t=>t.status==='approved'));
  await run(h,'tag','pilot');
  assert.equal(h.state.suggestions.length,4);
  await assert.rejects(h.controller.invoke('mark-pilot-reviewed'),/pending pilot suggestions/);
  await acceptAll(h);await applyAccepted(h);
  await h.controller.invoke('mark-pilot-reviewed');
  assert.equal(h.state.pilotReviewed,true);
  assert.equal(h.host.applied.length,1);
  assert.equal(h.state.history[0].patches.length,2);
  assert.deepEqual((await h.host.readTags(1)).map(t=>t.tag).sort(),['Fundamental','RCL','WE'].sort());
  assert.deepEqual(Object.keys(h.state.ownership['1:KEY1']).sort(),h.state.tags.map(t=>t.id).sort());
  await h.controller.invoke('undo',{id:h.state.history[0].id});
  assert.deepEqual(await h.host.readTags(1),[{tag:'Fundamental',type:0}]);
  assert.deepEqual(await h.host.readTags(2),[]);
});

test('an existing manual canonical tag is preserved and never claimed as extension ownership',async()=>{
  const h=harness({nativeTags:{1:[{tag:'RCL',type:0},{tag:'Project manuscript',type:0}]}});
  await run(h);await acceptAll(h);await applyAccepted(h);
  assert.deepEqual(await h.host.readTags(1),[{tag:'RCL',type:0},{tag:'Project manuscript',type:0}]);
  assert.equal(h.state.ownership['1:KEY1']?.['custom-rcl'],undefined);
  h.ai.handler=()=>emptyAnalysis();h.state.analyses={};
  await run(h);
  assert.equal(h.state.suggestions.filter(s=>s.operation==='remove').length,0);
  assert.ok((await h.host.readTags(1)).some(t=>t.tag==='RCL'));
});

test('only extension-owned assignments get removal previews, and removal waits for explicit application',async()=>{
  const h=harness({nativeTags:{1:[{tag:'Fundamental',type:0}]}});
  await run(h);await acceptAll(h);await applyAccepted(h);
  assert.ok(h.state.ownership['1:KEY1']['custom-rcl']);
  h.ai.handler=()=>emptyAnalysis();h.state.analyses={};await run(h);
  const removal=h.state.suggestions.find(s=>s.operation==='remove')!;
  assert.ok(removal);assert.equal(removal.autoEligible,false);
  assert.ok((await h.host.readTags(1)).some(t=>t.tag==='RCL'));
  await h.controller.invoke('accept-suggestion',{id:removal.id});
  await h.controller.invoke('apply-suggestions',{ids:[removal.id]});
  assert.deepEqual(await h.host.readTags(1),[{tag:'Fundamental',type:0}]);
  assert.equal(h.state.ownership['1:KEY1']['custom-rcl'],undefined);
});

test('rejecting an owned removal locks the assignment against later model recommendations',async()=>{
  const h=harness();await run(h);await acceptAll(h);await applyAccepted(h);
  h.ai.handler=()=>emptyAnalysis();h.state.analyses={};await run(h);
  const removal=h.state.suggestions.find(s=>s.operation==='remove')!;
  await h.controller.invoke('reject-suggestion',{id:removal.id});
  assert.equal(h.state.decisions['1:KEY1|custom-rcl'].locked,true);
  h.state.analyses={};await run(h);
  assert.equal(h.state.suggestions.filter(s=>s.operation==='remove').length,0);
  assert.ok((await h.host.readTags(1)).some(t=>t.tag==='RCL'));
});

test('manually deleting an extension assignment is a sticky rejection, including on cached reruns',async()=>{
  const h=harness();await run(h);await acceptAll(h);await applyAccepted(h);
  h.host.setTags(1,[]);await h.controller.onItemChanged(1);
  assert.equal(h.state.decisions['1:KEY1|custom-rcl'].rejected,true);
  assert.equal(h.state.ownership['1:KEY1']['custom-rcl'],undefined);
  await run(h);
  assert.equal(h.state.suggestions.filter(s=>s.tagId==='custom-rcl'&&s.status!=='rejected').length,0);
  assert.deepEqual(await h.host.readTags(1),[]);
  await h.controller.invoke('clear-rejection',{paperId:'1:KEY1',tagId:'custom-rcl'});await run(h);
  assert.ok(h.state.suggestions.some(s=>s.tagId==='custom-rcl'&&s.status==='pending'));
});

test('manually deleting a pre-existing approved canonical tag is also remembered',async()=>{
  const h=harness({nativeTags:{1:[{tag:'RCL',type:0}]}});
  await h.controller.invoke('scan',{scope:'library'});
  h.host.setTags(1,[]);await h.controller.onItemChanged(1);
  assert.equal(h.state.decisions['1:KEY1|custom-rcl']?.rejected,true);
  await run(h);
  assert.equal(h.state.suggestions.filter(s=>s.tagId==='custom-rcl'&&s.status!=='rejected').length,0);
});

test('manual additions between analysis and application remain untouched',async()=>{
  const h=harness();await run(h);await acceptAll(h);
  h.host.setTags(1,[{tag:'Citation candidate',type:0}]);
  await applyAccepted(h);
  assert.deepEqual((await h.host.readTags(1)).map(t=>t.tag).sort(),['Citation candidate','RCL']);
  assert.equal(h.state.ownership['1:KEY1']['custom-rcl'].name,'RCL');
});

test('content edits invalidate an accepted preview before any native tag writes',async()=>{
  const h=harness();await run(h);await acceptAll(h);
  h.host.edit(1,{abstract:'This changed paper now concerns lithium battery cycling.'});
  await assert.rejects(applyAccepted(h),/content or vocabulary changed/);
  assert.equal(h.host.applied.length,0);
  assert.deepEqual(await h.host.readTags(1),[]);
});

test('vocabulary changes invalidate old previews and reset the automatic pilot gate',async()=>{
  const h=harness();await run(h);await acceptAll(h);
  const version=h.state.vocabularyVersion;
  h.state.pilotReviewed=true;h.state.pilotVersion=version;h.state.settings.autoAssign=true;
  await h.controller.invoke('save-tag',{tag:{name:'Water transport',description:'Movement of water through electrochemical components.',facet:'phenomenon',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,broaderIds:[]}});
  assert.equal(h.state.vocabularyVersion,version+1);
  assert.equal(h.state.pilotReviewed,false);assert.equal(h.state.settings.autoAssign,false);
  await assert.rejects(applyAccepted(h),/content or vocabulary changed/);
  assert.equal(h.host.applied.length,0);
});

test('locking a pending addition after preview prevents applying that stale decision',async()=>{
  const h=harness();await run(h);await acceptAll(h);
  await h.controller.invoke('lock-assignment',{paperId:'1:KEY1',tagId:'custom-rcl'});
  await assert.rejects(applyAccepted(h),/lock/i);
  assert.deepEqual(await h.host.readTags(1),[]);
});

test('cleanup previews count manual assignments, retain scientific distinctions, and undo restores original tag types',async()=>{
  const h=harness({papers:[fixturePaper(1),fixturePaper(2)],nativeTags:{
    1:[{tag:'catalyst layer resistance',type:0},{tag:'Co',type:0},{tag:'CO',type:0},{tag:'Project A',type:0}],
    2:[{tag:'catalyst layer resistance',type:1}],
  }});
  h.state.taxonomyReady=true;
  await h.controller.invoke('preview-cleanup');
  assert.equal(h.state.cleanup.length,1);
  const change=h.state.cleanup[0];
  assert.equal(change.from,'catalyst layer resistance');assert.equal(change.to,'RCL');
  assert.equal(change.affectedCount,2);assert.equal(change.manualCount,1);
  await h.controller.invoke('apply-cleanup',{ids:[change.id]});
  assert.deepEqual((await h.host.readTags(1)).map(t=>t.tag).sort(),['RCL','Co','CO','Project A'].sort());
  assert.equal(h.state.ownership['1:KEY1']?.['custom-rcl'],undefined);
  await h.controller.invoke('undo',{id:h.state.history[0].id});
  assert.deepEqual(await h.host.readTags(2),[{tag:'catalyst layer resistance',type:1}]);
  assert.ok((await h.host.readTags(1)).some(t=>t.tag==='catalyst layer resistance'&&t.type===0));
});

test('cleanup does not acquire ownership of a pre-existing target and refuses a changed preview',async()=>{
  const h=harness({nativeTags:{1:[{tag:'catalyst layer resistance',type:0},{tag:'RCL',type:0}]}});
  h.state.taxonomyReady=true;
  await h.controller.invoke('scan',{scope:'library'});
  h.state.ownership['1:KEY1']={'custom-rcl':{name:'catalyst layer resistance',changeId:'old'}};
  await h.controller.invoke('preview-cleanup');
  await h.controller.invoke('apply-cleanup',{ids:h.state.cleanup.map(c=>c.id)});
  assert.equal(h.state.ownership['1:KEY1']['custom-rcl'],undefined);
  const stale=harness({nativeTags:{1:[{tag:'catalyst layer resistance',type:0}]}});
  stale.state.taxonomyReady=true;
  await stale.controller.invoke('preview-cleanup');
  stale.host.setTags(1,[{tag:'catalyst layer resistance',type:0},{tag:'Later manual tag',type:0}]);
  await assert.rejects(stale.controller.invoke('apply-cleanup',{ids:stale.state.cleanup.map(c=>c.id)}),/changed|stale|refresh/i);
  assert.ok((await stale.host.readTags(1)).some(t=>t.tag==='Later manual tag'));
});

test('undo refuses to overwrite native tags added after the approved change',async()=>{
  const h=harness();await run(h);await acceptAll(h);await applyAccepted(h);
  const history=h.state.history[0];
  h.host.setTags(1,[...(await h.host.readTags(1)),{tag:'Later manual tag',type:0}]);
  await assert.rejects(h.controller.invoke('undo',{id:history.id}),/Later tag edits conflict/);
  assert.equal(history.status,'applied');
  assert.ok((await h.host.readTags(1)).some(t=>t.tag==='Later manual tag'));
});

async function preparedBatch(papers=[fixturePaper(1)]) {
  const h=harness({papers});await run(h);await acceptAll(h);await applyAccepted(h);
  const prepared=h.saves.find(state=>state.pendingChange);
  assert.ok(prepared,'The write-ahead journal must be persisted before native writes');
  return {h,prepared:clone(prepared)};
}

test('startup recovery finalizes a native batch committed before its journal was finalized',async()=>{
  const {h,prepared}=await preparedBatch();
  const restarted=harness({state:prepared,host:h.host});await restarted.controller.initialize();
  assert.equal(restarted.state.pendingChange,undefined);
  assert.equal(restarted.state.history[0].status,'applied');
  assert.equal(restarted.state.ownership['1:KEY1']['custom-rcl'].name,'RCL');
  assert.equal(restarted.state.suggestions[0].applied,true);
  assert.equal(h.host.applied.length,1,'Recovery must not repeat native writes');
});

test('startup recovery discards an uncommitted journal without claiming assignments',async()=>{
  const {prepared}=await preparedBatch();
  const host=new MemoryHost([fixturePaper(1)]),restarted=harness({state:prepared,host});
  await restarted.controller.initialize();
  assert.equal(restarted.state.pendingChange,undefined);
  assert.equal(restarted.state.history.length,0);
  assert.equal(restarted.state.ownership['1:KEY1']?.['custom-rcl'],undefined);
  assert.equal(restarted.state.suggestions[0].applied??false,false);
  assert.equal(host.applied.length,0);
});

test('mixed crash recovery marks only after-state papers applied and reports the conflict',async()=>{
  const {prepared}=await preparedBatch([fixturePaper(1),fixturePaper(2)]);
  const change=prepared.pendingChange!,host=new MemoryHost([fixturePaper(1),fixturePaper(2)]);
  host.setTags(1,change.patches.find(p=>p.itemID===1)!.after);
  const restarted=harness({state:prepared,host});await restarted.controller.initialize();
  assert.equal(restarted.state.history[0].status,'conflict');
  assert.equal(restarted.state.suggestions.find(s=>s.paperId==='1:KEY1')!.applied,true);
  assert.equal(restarted.state.suggestions.find(s=>s.paperId==='1:KEY2')!.applied??false,false);
  assert.equal(restarted.state.ownership['1:KEY2']?.['custom-rcl'],undefined);
});

test('resume preserves completed jobs and uses the explicitly selected provider without fallback',async()=>{
  const h=harness({papers:[fixturePaper(1),fixturePaper(2),fixturePaper(3)]});
  h.ai.handler=(call,index)=>{if(index===1)throw new Error('ChatGPT quota exhausted');return normalAnalysis(call);};
  await run(h);
  assert.equal(h.state.run?.status,'paused');
  assert.deepEqual(h.state.run?.jobs.map(j=>j.status),['completed','pending','pending']);
  assert.ok(h.state.run?.message.includes('quota exhausted'));
  h.ai.handler=normalAnalysis;
  await h.controller.invoke('resume');await h.controller.waitForIdle();
  assert.equal(h.state.run?.status,'idle');
  assert.equal(h.ai.calls.length,4);
  assert.equal(h.ai.calls.filter(call=>call.input.paper?.title.endsWith('1')).length,1);
  assert.ok(h.ai.calls.every(call=>call.settings.mode==='chatgpt'));
  assert.equal(h.state.suggestions.length,3);
});

test('a repeated run reuses completed analysis, while metadata edits require a new request',async()=>{
  const h=harness();await run(h);
  assert.equal(h.ai.calls.length,1);const id=h.state.suggestions[0].id;
  await run(h);assert.equal(h.ai.calls.length,1);assert.equal(h.state.suggestions[0].id,id);
  h.host.edit(1,{abstract:`${DIRECT} We compare ionomer loadings.`});await h.controller.onItemChanged(1);
  await run(h);assert.equal(h.ai.calls.length,2);assert.notEqual(h.state.suggestions[0].id,id);
});

test('metadata is analyzed before targeted PDF text, and scanning does not discard valid PDF evidence',async()=>{
  const h=harness();const quote='Measurements quantify catalyst-layer resistance in the water electrolyzer.';
  h.host.pdfs.set(1,`Introduction\n${quote}\nThe electronic and ionic contributions are separated.`);
  h.ai.handler=call=>{
    if(!call.input.paper?.pdf)return {...emptyAnalysis(),needsPDF:true};
    return {summary:'PDF measurements establish catalyst-layer resistance.',concepts:['catalyst-layer resistance'],needsPDF:false,newTagCandidates:[],suggestions:[{tagId:'custom-rcl',reason:'Direct measurements of the defined catalyst-layer resistance.',confidence:'high',match:'substantive',evidence:[{source:'pdf',text:quote}]}]};
  };
  await run(h);
  assert.equal(h.ai.calls.length,2);
  assert.equal(h.ai.calls[0].input.paper?.pdf,undefined);
  assert.ok(h.ai.calls[1].input.paper?.pdf?.includes(quote));
  assert.equal(h.host.pdfReads.length,2,'Read the PDF again before persisting to reject a changed source');
  assert.equal(h.state.suggestions[0].evidence[0].source,'pdf');
  await h.controller.invoke('scan',{scope:'library'});
  assert.ok(h.state.papers['1:KEY1'].pdfText?.includes(quote));
  await acceptAll(h);await applyAccepted(h);
  assert.ok((await h.host.readTags(1)).some(t=>t.tag==='RCL'));
  await run(h);assert.equal(h.ai.calls.length,2,'Unchanged source text should reuse the completed PDF-backed analysis');
});

test('unreadable PDFs produce an evidence-gap warning and do not fabricate an assignment',async()=>{
  const h=harness({papers:[fixturePaper(1,{abstract:''})]});
  h.ai.handler=()=>({...emptyAnalysis(),needsPDF:true});await run(h);
  assert.equal(h.ai.calls.length,1);
  assert.deepEqual(h.host.pdfReads,[1]);
  assert.equal(h.state.suggestions.length,0);
  assert.ok(h.state.warnings.some(warning=>warning.status==='active'&&warning.message.includes('no readable PDF')));
  assert.equal(h.host.applied.length,0);
});

test('API budget blocks dispatch before spending and retains a failed request reservation',async()=>{
  const blocked=harness();Object.assign(blocked.state.settings,{provider:'api',model:'test-model',budgetUSD:0.01,inputPricePerMillion:100,outputPricePerMillion:100});
  await run(blocked);
  assert.equal(blocked.ai.calls.length,0);
  assert.equal(blocked.state.run?.status,'paused');
  assert.match(blocked.state.run!.message,/remaining estimated API budget/);
  assert.equal(blocked.state.run?.spentUSD,0);
  const failed=harness();Object.assign(failed.state.settings,{provider:'api',model:'test-model',budgetUSD:5,inputPricePerMillion:1,outputPricePerMillion:1});
  failed.ai.handler=()=>{throw new Error('Network interrupted after dispatch');};await run(failed);
  assert.equal(failed.ai.calls.length,1);
  assert.ok(failed.state.run!.spentUSD>0);
  assert.ok(failed.saves.some(state=>state.run?.spentUSD!>0&&state.run?.jobs[0].status==='running'));
  assert.equal(failed.state.run?.status,'paused');
  assert.ok(failed.ai.calls.every(call=>call.settings.mode==='api'));
});

test('automatic assignment requires a reviewed pilot and is disabled when vocabulary changes',async()=>{
  const h=harness();
  await assert.rejects(h.controller.invoke('save-settings',{settings:{...h.state.settings,autoAssign:true}}),/review the pilot/);
  await assert.rejects(h.controller.invoke('mark-pilot-reviewed'),/Finish the pilot/);
  await pilot(h);
  await h.controller.invoke('save-settings',{settings:{...h.state.settings,autoAssign:true}});
  const incoming=fixturePaper(2);h.host.add(incoming);
  await h.controller.onItemChanged(2);await h.controller.waitForIdle();
  assert.ok((await h.host.readTags(2)).some(t=>t.tag==='RCL'));
  assert.equal(h.state.history[0].label,'Automatic tag assignments');
  await h.controller.invoke('save-tag',{tag:{...clone(h.state.tags[0]),custom:false,description:'An updated core resistance definition.'}});
  assert.equal(h.state.settings.autoAssign,false);
  const calls=h.ai.calls.length;h.host.add(fixturePaper(3));await h.controller.onItemChanged(3);await h.controller.waitForIdle();
  assert.equal(h.ai.calls.length,calls);assert.deepEqual(await h.host.readTags(3),[]);
});

test('native tag-only notifications neither call AI again nor change the paper input fingerprint',async()=>{
  const h=harness();await pilot(h);
  await h.controller.invoke('save-settings',{settings:{...h.state.settings,autoAssign:true}});
  const calls=h.ai.calls.length,fp=h.state.papers['1:KEY1'].fingerprint;
  await h.controller.onItemChanged(1);await h.controller.waitForIdle();
  assert.equal(h.ai.calls.length,calls);
  assert.equal(h.state.papers['1:KEY1'].fingerprint,fp);
});

test('a paused run cannot be replaced until the user cancels it',async()=>{
  const h=harness({papers:[fixturePaper(1),fixturePaper(2)]});
  h.ai.handler=(call,index)=>{if(index===1)throw new Error('Quota reached');return normalAnalysis(call);};
  await run(h);const runId=h.state.run!.id,jobIds=h.state.run!.jobs.map(job=>job.id);
  assert.equal(h.state.run?.status,'paused');
  await assert.rejects(h.controller.invoke('tag',{scope:'library'}),/paused|resume|cancel/i);
  assert.equal(h.state.run?.id,runId);assert.deepEqual(h.state.run?.jobs.map(job=>job.id),jobIds);
  await h.controller.invoke('cancel');h.ai.handler=normalAnalysis;await run(h);
  assert.notEqual(h.state.run?.id,runId);assert.equal(h.state.run?.status,'idle');
});

test('startup pauses an interrupted run and resume skips its completed jobs',async()=>{
  const h=harness({papers:[fixturePaper(1),fixturePaper(2),fixturePaper(3)]});
  h.ai.handler=(call,index)=>{if(index===1)throw new Error('Temporary interruption');return normalAnalysis(call);};
  await run(h);const interrupted=clone(h.state);
  interrupted.run!.status='running';interrupted.run!.jobs[1].status='running';
  h.ai.handler=normalAnalysis;
  const restarted=harness({state:interrupted,host:h.host,ai:h.ai});
  await restarted.controller.initialize();
  assert.equal(restarted.state.run?.status,'paused');
  assert.deepEqual(restarted.state.run?.jobs.map(job=>job.status),['completed','pending','pending']);
  assert.equal(restarted.ai.calls.length,2);
  await restarted.controller.invoke('resume');await restarted.controller.waitForIdle();
  assert.equal(restarted.ai.calls.length,4);
  assert.equal(restarted.ai.calls.filter(call=>call.input.paper?.title.endsWith('1')).length,1);
});

test('global consolidation retries without replaying cached facts or publishing partial vocabulary batches',async()=>{
  const h=harness({papers:Array.from({length:26},(_,i)=>fixturePaper(i+1))});
  const batchSizes:number[]=[];let failed=false;
  h.ai.handler=call=>{
    if(call.input.selectionPhase==='mapping')return normalMapping(call);
    if(call.input.protocolVersion!==2&&!call.input.facts)return normalFacts(call);
    batchSizes.push(call.input.protocolVersion===2?call.input.census!.paperCount:call.input.facts!.length);
    if(!failed){failed=true;throw new Error('Vocabulary quota interruption');}
    return normalTaxonomy(call);
  };
  await run(h,'rebuild');
  assert.equal(h.state.run?.status,'paused');assert.equal(h.state.run?.vocabCursor,0);
  assert.equal(h.ai.calls.filter(call=>call.input.paper).length,26);
  assert.ok(!h.state.tags.some(tag=>tag.name==='WE'));assert.equal(h.state.taxonomyProposal,null);
  await h.controller.invoke('resume');await h.controller.waitForIdle();
  assert.equal(h.state.run?.status,'idle');
  assert.deepEqual(batchSizes,[26,26]);
  assert.equal(h.ai.calls.filter(call=>call.input.paper).length,26);
  assert.equal(h.state.tags.filter(tag=>tag.name==='WE').length,0);
  assert.equal(h.state.taxonomyProposal!.tags.filter(tag=>tag.name==='WE').length,1);
});

test('a high-confidence incidental match remains in review during automatic assignment',async()=>{
  const h=harness();await pilot(h);await h.controller.invoke('save-settings',{settings:{...h.state.settings,autoAssign:true}});
  h.ai.handler=call=>{
    const result=normalAnalysis(call);result.suggestions=result.suggestions.map(suggestion=>({...suggestion,match:'incidental'}));return result;
  };
  h.host.add(fixturePaper(2));await h.controller.onItemChanged(2);await h.controller.waitForIdle();
  assert.deepEqual(await h.host.readTags(2),[]);
  const suggestion=h.state.suggestions.find(s=>s.paperId==='1:KEY2')!;
  assert.ok(suggestion);assert.equal(suggestion.status,'pending');assert.equal(suggestion.autoEligible,false);
});

test('persisted deferred imports are processed after restart when automatic tagging is eligible',async()=>{
  const base=harness();base.state.pilotReviewed=true;base.state.pilotVersion=base.state.vocabularyVersion;base.state.settings.autoAssign=true;
  (base.state as AppState & {deferredItemIDs:number[]}).deferredItemIDs=[2];
  const restarted=harness({state:clone(base.state),host:new MemoryHost([fixturePaper(2)])});
  await restarted.controller.initialize();await restarted.controller.waitForIdle();
  assert.ok((await restarted.host.readTags(2)).some(tag=>tag.tag==='RCL'));
  assert.deepEqual((restarted.state as AppState & {deferredItemIDs:number[]}).deferredItemIDs,[]);
  assert.equal(restarted.ai.calls.length,1);
});

test('concurrent automatic and manual commits preserve ownership for both papers',async()=>{
  const h=harness({papers:[fixturePaper(1),fixturePaper(2)]});await run(h);
  const manual=h.state.suggestions.find(s=>s.paperId==='1:KEY1')!;
  await h.controller.invoke('accept-suggestion',{id:manual.id});
  h.state.pilotReviewed=true;h.state.pilotVersion=h.state.vocabularyVersion;h.state.settings.autoAssign=true;
  let entered!:()=>void,release!:()=>void,starts=0;
  const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const original=h.host.apply.bind(h.host);
  h.host.apply=async(patches,label)=>{starts++;if(starts===1){entered();await gate;}await original(patches,label);};
  h.host.edit(2,{abstract:`${DIRECT} Updated transport measurements are available.`});
  await h.controller.onItemChanged(2);await started;
  const pending=h.controller.invoke('apply-suggestions',{ids:[manual.id]}).then(()=>({ok:true,error:null}),error=>({ok:false,error}));
  await new Promise<void>(resolve=>setTimeout(resolve,0));
  assert.equal(starts,1,'The manual commit must wait while the automatic native transaction is active');
  release();const outcome=await pending;assert.equal(outcome.ok,true,String(outcome.error));await h.controller.waitForIdle();
  assert.equal(starts,2);
  for(const itemID of [1,2]) {
    assert.ok((await h.host.readTags(itemID)).some(tag=>tag.tag==='RCL'));
    assert.equal(h.state.ownership[`1:KEY${itemID}`]['custom-rcl'].name,'RCL');
  }
});

test('renaming an owned tag recognizes its existing alias without duplicating it before reviewed cleanup',async()=>{
  const h=harness();h.state.taxonomyReady=true;await run(h);await acceptAll(h);await applyAccepted(h);
  const stableId=h.state.tags[0].id,newName='Catalyst-layer resistance';
  await h.controller.invoke('save-tag',{tag:{...clone(h.state.tags[0]),name:newName}});
  const renamed=h.state.tags.find(tag=>tag.id===stableId)!;
  assert.ok(renamed.aliases.includes('RCL'));
  assert.equal(renamed.status,'approved');
  await h.controller.invoke('approve-vocabulary',{ids:[stableId]});
  await run(h);await acceptAll(h);
  await applyAccepted(h);
  assert.deepEqual(await h.host.readTags(1),[{tag:'RCL',type:0}]);
  assert.equal(h.state.ownership['1:KEY1'][stableId].name,'RCL');
  await h.controller.invoke('preview-cleanup');
  const cleanup=h.state.cleanup.find(change=>change.from==='RCL'&&change.to===newName)!;
  assert.ok(cleanup);await h.controller.invoke('apply-cleanup',{ids:[cleanup.id]});
  assert.deepEqual(await h.host.readTags(1),[{tag:newName,type:0}]);
  assert.equal(h.state.ownership['1:KEY1'][stableId].name,newName);
  await applyAccepted(h);
  assert.deepEqual(await h.host.readTags(1),[{tag:newName,type:0}]);
});

test('resuming a pilot after vocabulary changes cannot unlock automatic tagging before every pilot job finishes',async()=>{
  const h=harness({papers:[fixturePaper(1),fixturePaper(2)]});
  h.ai.handler=(call,index)=>{if(index===1)throw new Error('Pilot interrupted');return normalAnalysis(call);};
  await run(h,'tag','pilot');
  assert.equal(h.state.pilotIds.length,1);assert.equal(h.state.pilotExpected,2);
  await h.controller.invoke('save-tag',{tag:{name:'Water transport',description:'Water movement within electrochemical devices.',facet:'phenomenon',custom:false,aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[]}});
  let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  h.ai.handler=async call=>{if(call.input.paper?.title.endsWith('2')){entered();await gate;}return normalAnalysis(call);};
  await h.controller.invoke('resume');await started;
  await acceptAll(h);
  await assert.rejects(h.controller.invoke('mark-pilot-reviewed'),/Finish|running|complete/i);
  assert.equal(h.state.pilotReviewed,false);
  release();await h.controller.waitForIdle();await acceptAll(h);
  await h.controller.invoke('mark-pilot-reviewed');
  assert.equal(h.state.pilotReviewed,true);
  assert.equal(h.state.pilotVersion,h.state.vocabularyVersion);
  assert.equal(h.state.pilotExpected,2);
});
