import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController, initialState } from '../src/controller.ts';
import type { AppState, ControllerEnvironment } from '../src/controller.ts';
import { paperFingerprint } from '../src/core.ts';
import type { PaperRecord, TagDefinition } from '../src/core.ts';
import { normalizeFacts } from '../src/taxonomy.ts';
import { buildMetadataPreview, sameMetadata } from '../src/paper-recovery.ts';
import type { MetadataPatch, MetadataSnapshot, PaperInputAssessment } from '../src/paper-recovery.ts';
import type { LibraryHost, NativeTag, TagPatch } from '../src/platform.ts';
import type { CompletionResult, ProviderSettings } from '../src/providers.ts';

const clone=<T>(value:T):T=>structuredClone(value);
const passage='We measure catalyst-layer resistance in a fuel cell.';
function paper(itemID=1,abstract=passage):PaperRecord {const value:PaperRecord={id:`1:R${itemID}`,itemID,key:`R${itemID}`,libraryID:1,title:`Recovery experiment ${itemID}`,abstract,keywords:[],summary:'',concepts:[],fingerprint:''};value.fingerprint=paperFingerprint(value);return value;}
const vocabulary=():TagDefinition[]=>[{id:'fc',name:'FC',fullName:'fuel cell',description:'Fuel cell systems.',facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[],relatedIds:[],matchingMode:'auto'}];

class MemoryHost implements LibraryHost {
  papers=new Map<number,PaperRecord>();native=new Map<number,NativeTag[]>();metadata=new Map<number,MetadataSnapshot>();pdfs=new Map<number,string>();tagWrites=0;metadataWrites=0;inputChecks=0;
  constructor(papers:PaperRecord[]){for(const value of papers){this.papers.set(value.itemID,clone(value));this.native.set(value.itemID,[{tag:'RCL',type:0}]);this.metadata.set(value.itemID,{paperId:value.id,itemID:value.itemID,itemType:'journalArticle',fields:{title:value.title,abstractNote:value.abstract,DOI:`10.1000/recovery-${value.itemID}`},creators:[],identifiers:[{kind:'DOI',value:`10.1000/recovery-${value.itemID}`}]});}}
  async read(itemID:number){const value=this.papers.get(itemID);if(!value)return null;const result=clone(value),fields=this.metadata.get(itemID)!.fields;result.title=fields.title;result.abstract=fields.abstractNote;result.fingerprint=paperFingerprint(result);return result;}
  async list(){return (await Promise.all([...this.papers.keys()].map(id=>this.read(id)))).filter((value):value is PaperRecord=>!!value);}
  async readTags(itemID:number){return clone(this.native.get(itemID)??[]);}
  async pdfText(itemID:number){return this.pdfs.get(itemID)??'';}
  async show(){}
  async saveSearch(){}
  async apply(patches:TagPatch[]){this.tagWrites++;for(const patch of patches)this.native.set(patch.itemID,clone(patch.after));}
  async inspectInputs(itemID:number,recheck=false):Promise<PaperInputAssessment>{this.inputChecks++;const value=(await this.read(itemID))!,pdf=this.pdfs.get(itemID)||'';return {paperId:value.id,itemID,checkedAt:'2026-10-29T00:00:00Z',metadata:{title:!!value.title,abstract:!!value.abstract,keywords:value.keywords.length>0},pdf:{status:pdf?'readable':'missing',attachmentCount:pdf?1:0,localCount:pdf?1:0,characters:pdf.length,rechecked:recheck}};}
  async readMetadata(itemID:number){return clone(this.metadata.get(itemID)!);}
  async lookupMetadata(itemID:number){const before=await this.readMetadata(itemID);return buildMetadataPreview(before,[{itemType:'journalArticle',title:before.fields.title,DOI:before.fields.DOI,abstractNote:passage}]);}
  async applyMetadata(patches:MetadataPatch[]){for(const patch of patches)assert.equal(sameMetadata(await this.readMetadata(patch.itemID),patch.before),true);this.metadataWrites++;for(const patch of patches)this.metadata.set(patch.itemID,clone(patch.after));}
}
interface PromptInput {
  planId?:string;fingerprint?:string;
  groups?:{groupId:string;source:string;assignments:{paperId:string;sourceFingerprint:string;paper:{abstract:string}}[]}[];
  paper?:{title:string;abstract:string};
}
interface AICall {input:PromptInput;settings:ProviderSettings;signal?:AbortSignal;prompt:string}
class MemoryAI {
  calls:AICall[]=[];events:string[]=[];
  handler:(call:AICall)=>unknown|Promise<unknown>=()=>{throw new Error('Unexpected AI request.');};
  async completeJson(_system:string,prompt:string,settings:ProviderSettings,signal?:AbortSignal):Promise<CompletionResult>{const marker='INPUT_DATA_JSON:\n',start=prompt.lastIndexOf(marker);assert.ok(start>=0);const call={input:JSON.parse(prompt.slice(start+marker.length)) as PromptInput,settings:clone(settings),signal,prompt};this.calls.push(call);const value=await this.handler(call);return {value,usageKnown:true,usage:{inputTokens:100,outputTokens:100},estimatedCostUSD:0.0002};}
  async hasApiKey(){return true;}
  async getSession(){return {connected:true,sharing:true,email:null,accountId:'test-account',accounts:[]};}
  async testConnection():Promise<CompletionResult>{return {value:{ok:true},usageKnown:true,estimatedCostUSD:0};}
  async listModels(){return [];}
  async setApiKey(){this.events.push('key changed');}
  async removeApiKey(){this.events.push('key removed');}
  async signIn(){this.events.push('sign-in');return this.getSession();}
  cancelSignIn(){}
  async signOut(){this.events.push('sign-out');return {revoked:true};}
  async selectAccount(){this.events.push('account changed');}
}
function fixture(papers=[paper()]){const state=initialState(),host=new MemoryHost(papers),ai=new MemoryAI(),saves:AppState[]=[];state.tags=vocabulary();state.taxonomyReady=true;state.vocabularyVersion=3;state.settings={...state.settings,provider:'chatgpt',model:'test-model',autoAssign:false};const env:ControllerEnvironment={host,ai,persist:async value=>{saves.push(clone(value));}};return {state,host,ai,saves,app:new AppController(state,env)};}
type Fixture=ReturnType<typeof fixture>;
function diyReply(input:PromptInput){assert.ok(input.groups);return {planId:input.planId,fingerprint:input.fingerprint,definitions:input.groups.map(group=>({groupId:group.groupId,description:'Catalyst-layer resistance in fuel cells.',facet:'phenomenon',support:group.assignments.map(value=>({paperId:value.paperId,sourceFingerprint:value.sourceFingerprint,evidence:[{source:'abstract',text:value.paper.abstract}]}))}))};}
function holdAI(h:Fixture){let entered!:(value:AICall)=>void,release!:()=>void;const started=new Promise<AICall>(resolve=>{entered=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});h.ai.handler=async call=>{call.signal?.addEventListener('abort',()=>{h.ai.events.push('request aborted');},{once:true});entered(call);await waiting;return diyReply(call.input);};return {started,release};}
async function beginDIY(h:Fixture){await h.app.invoke('refresh-existing-tags');const row=(await h.app.snapshot()).existingTags!.rows.find(row=>row.name==='RCL')!;await h.app.invoke('create-diy-from-existing',{groupIds:[row.id]});}
const noCustom=(h:Fixture)=>assert.equal(h.state.tags.some(tag=>tag.custom),false);
const nextTurn=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('Cancel durably stops maintenance without a main run and cannot approve a late successful reply',async t=>{
  const h=fixture(),gate=holdAI(h);t.after(gate.release);await beginDIY(h);const call=await gate.started;assert.equal(h.state.run,null);assert.equal((await h.app.snapshot()).queue.status,'running');
  await h.app.invoke('cancel');assert.equal(call.signal?.aborted,true);assert.equal(h.state.maintenanceTasks![0].status,'completed');assert.equal(h.saves.at(-1)!.maintenanceTasks![0].status,'completed');noCustom(h);
  gate.release();await h.app.waitForIdle();noCustom(h);assert.equal(h.state.history.length,0);assert.equal(h.host.tagWrites,0);assert.equal(h.state.maintenanceTasks![0].status,'completed');
});

test('Pause persists maintenance state independently and a late provider result stays unapplied',async t=>{
  const h=fixture(),gate=holdAI(h);t.after(gate.release);await beginDIY(h);await gate.started;await h.app.invoke('pause');
  assert.equal(h.saves.at(-1)!.maintenanceTasks![0].status,'paused');assert.equal((await h.app.snapshot()).queue.status,'paused');gate.release();await h.app.waitForIdle();noCustom(h);assert.equal(h.state.history.length,0);assert.equal(h.state.maintenanceTasks![0].status,'paused');
});

test('changing a ChatGPT account pauses and settles its maintenance request before switching',async t=>{
  const h=fixture(),gate=holdAI(h);t.after(gate.release);await beginDIY(h);const call=await gate.started;const switching=h.app.invoke('select-account',{id:'another-account'});await nextTurn();
  assert.equal(call.signal?.aborted,true);assert.deepEqual(h.ai.events,['request aborted']);assert.equal(h.saves.at(-1)!.maintenanceTasks![0].status,'paused');gate.release();await switching;await h.app.waitForIdle();
  assert.deepEqual(h.ai.events,['request aborted','account changed']);noCustom(h);assert.equal(h.state.maintenanceTasks![0].status,'paused');
});

test('unrelated provider credential changes leave active ChatGPT maintenance intact',async t=>{
  const h=fixture(),gate=holdAI(h);t.after(gate.release);await beginDIY(h);const call=await gate.started;await h.app.invoke('remove-api-key',{provider:'deepseek'});assert.equal(call.signal?.aborted,false);assert.deepEqual(h.ai.events,['key removed']);assert.equal(h.state.maintenanceTasks![0].status,'running');gate.release();await h.app.waitForIdle();assert.equal(h.state.tags.some(tag=>tag.custom&&tag.name==='RCL'),true);
});

test('new main analysis cannot dispatch concurrently with active maintenance',async t=>{
  const h=fixture(),gate=holdAI(h);t.after(gate.release);await beginDIY(h);await gate.started;
  await assert.rejects(h.app.invoke('tag',{scope:'library'}),/pause|finish|running|current|work/i);assert.equal(h.ai.calls.length,1);assert.equal(h.state.run,null);gate.release();await h.app.waitForIdle();assert.equal(h.state.tags.some(tag=>tag.custom&&tag.name==='RCL'),true);
});

test('metadata Apply succeeds without an AI model and retains a paused follow-up retry',async()=>{
  const h=fixture([paper(1,'')]);h.state.settings.model='';await h.app.invoke('scan',{scope:'library'});await h.app.invoke('preview-metadata',{id:'1:R1'});const preview=(await h.app.snapshot()).metadataPreview!;assert.equal(h.host.metadataWrites,0);assert.equal(h.ai.calls.length,0);
  await h.app.invoke('apply-metadata',{previewId:preview.id});await h.app.waitForIdle();assert.equal((await h.host.readMetadata(1)).fields.abstractNote,passage);assert.equal(h.host.metadataWrites,1);assert.equal(h.state.metadataPreview,undefined);assert.equal(h.ai.calls.length,0);assert.equal(h.state.maintenanceTasks?.some(task=>task.kind==='retry'&&task.status==='paused'),true);assert.equal(h.state.history[0].status,'applied');
  await h.app.invoke('undo',{id:h.state.history[0].id});assert.equal((await h.host.readMetadata(1)).fields.abstractNote,'');assert.equal(h.ai.calls.length,0);
});

test('metadata Apply also succeeds when selected API prices are missing',async()=>{
  const h=fixture([paper(1,'')]);h.state.settings.provider='api';h.state.settings.inputPricePerMillion=0;h.state.settings.outputPricePerMillion=0;await h.app.invoke('scan',{scope:'library'});await h.app.invoke('preview-metadata',{id:'1:R1'});await h.app.invoke('apply-metadata',{previewId:(await h.app.snapshot()).metadataPreview!.id});await h.app.waitForIdle();assert.equal((await h.host.readMetadata(1)).fields.abstractNote,passage);assert.equal(h.ai.calls.length,0);assert.equal(h.state.maintenanceTasks?.some(task=>task.status==='paused'),true);
});

test('stale metadata previews preserve later manual information and write nothing',async()=>{
  const h=fixture([paper(1,'')]);await h.app.invoke('scan',{scope:'library'});await h.app.invoke('preview-metadata',{id:'1:R1'});const preview=(await h.app.snapshot()).metadataPreview!;h.host.metadata.get(1)!.fields.abstractNote='Manually supplied abstract.';
  await assert.rejects(h.app.invoke('apply-metadata',{previewId:preview.id}),/changed|preview|Refresh/i);assert.equal(h.host.metadataWrites,0);assert.equal(h.state.history.length,0);assert.equal((await h.host.readMetadata(1)).fields.abstractNote,'Manually supplied abstract.');assert.equal(h.ai.calls.length,0);
});

test('validated facts remain usable when more PDF context was requested, and local recheck makes no AI request',async()=>{
  const value=paper(),h=fixture([value]);h.state.papers[value.id]=clone(value);h.state.facts[value.id]=normalizeFacts({summary:'A fuel cell resistance study.',concepts:[{name:'fuel cell',facet:'system',evidence:[{source:'abstract',text:passage}]}],needsPDF:true},value,'chatgpt','test-model');
  let view=await h.app.snapshot();assert.equal(view.paperAttention!.papers[0].status,'usable');assert.equal(view.queue.needsInformation,0);h.host.pdfs.set(1,'Additional locally readable PDF evidence.');await h.app.invoke('recheck-paper-inputs',{id:value.id});view=await h.app.snapshot();assert.equal(view.paperAttention!.papers[0].status,'usable');assert.equal(h.state.paperInputs![value.id].pdf.status,'readable');assert.equal(h.host.inputChecks,1);assert.equal(h.ai.calls.length,0);
});

test('explicit paper retry replaces only the selected completed extraction and preserves its original facts in history',async()=>{
  const first=paper(1),second=paper(2),h=fixture([first,second]);for(const value of [first,second]){h.state.papers[value.id]=clone(value);h.state.facts[value.id]=normalizeFacts({summary:'Cached extraction.',concepts:[{name:'fuel cell',facet:'system',evidence:[{source:'abstract',text:passage}]}],needsPDF:false},value,'chatgpt','test-model');}
  const before=clone(h.state.facts[first.id]),untouched=clone(h.state.facts[second.id]);h.ai.handler=call=>{assert.ok(call.prompt.startsWith('Extract factual scientific concepts'));return {summary:'Explicitly retried extraction.',concepts:[{name:'fuel cell',facet:'system',evidence:[{source:'abstract',text:passage}]}],needsPDF:false};};
  await h.app.invoke('retry-papers',{ids:[first.id]});await h.app.waitForIdle();assert.equal(h.ai.calls.length,1);assert.equal(h.state.facts[first.id].summary,'Explicitly retried extraction.');assert.deepEqual(h.state.facts[second.id],untouched);assert.deepEqual(h.state.factHistory!.find(record=>record.facts.paperId===first.id)!.facts,before);assert.equal(h.host.tagWrites,0);assert.equal(h.host.metadataWrites,0);
});
