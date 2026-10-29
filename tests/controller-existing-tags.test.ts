import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController, initialState } from '../src/controller.ts';
import type { AppState, ControllerEnvironment } from '../src/controller.ts';
import { paperFingerprint } from '../src/core.ts';
import type { PaperRecord, TagDefinition } from '../src/core.ts';
import { sameTags } from '../src/platform.ts';
import type { LibraryHost, NativeTag, TagPatch } from '../src/platform.ts';
import type { CompletionResult, ProviderSettings } from '../src/providers.ts';

const clone=<T>(value:T):T=>structuredClone(value);
const definition=(id:string,name:string,extra:Partial<TagDefinition>={}):TagDefinition=>({id,name,fullName:name,description:`Scientific scope of ${name}.`,facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[],relatedIds:[],matchingMode:'auto',...extra});
const we=()=>definition('we','WE',{fullName:'water electrolysis',aliases:['water electrolyzer']});
function paper(itemID=1,abstract='The water electrolyzer measures membrane resistance.'):PaperRecord {
  const value:PaperRecord={id:`1:P${itemID}`,key:`P${itemID}`,itemID,libraryID:1,title:`Scientific experiment ${itemID}`,abstract,keywords:[],summary:'',concepts:[],fingerprint:''};value.fingerprint=paperFingerprint(value);return value;
}

class MemoryHost implements LibraryHost {
  papers=new Map<number,PaperRecord>();tags=new Map<number,NativeTag[]>();writes:TagPatch[][]=[];
  constructor(papers:PaperRecord[],tags:Record<number,NativeTag[]>){for(const value of papers){this.papers.set(value.itemID,clone(value));this.tags.set(value.itemID,clone(tags[value.itemID]??[]));}}
  async read(itemID:number){const value=this.papers.get(itemID);if(!value)return null;const result=clone(value);result.keywords=(this.tags.get(itemID)??[]).filter(tag=>tag.type===1).map(tag=>tag.tag);result.fingerprint=paperFingerprint(result);return result;}
  async list(){return (await Promise.all([...this.papers.keys()].map(id=>this.read(id)))).filter((value):value is PaperRecord=>!!value);}
  async readTags(itemID:number){return clone(this.tags.get(itemID)??[]);}
  async pdfText(){return '';}
  async show(){}
  async saveSearch(){}
  async apply(patches:TagPatch[]){for(const patch of patches)assert.equal(sameTags(await this.readTags(patch.itemID),patch.before),true,'native writes require the reviewed before state');this.writes.push(clone(patches));for(const patch of patches)this.tags.set(patch.itemID,clone(patch.after));}
}
interface AnalysisInput {
  planId:string;fingerprint:string;
  groups:{groupId:string;source:string;assignments:{paperId:string;sourceFingerprint:string;paper:{title:string;abstract:string;keywords:string[]}}[];permittedTargetIds:string[]}[];
}
class MemoryAI {
  calls:{input:AnalysisInput;settings:ProviderSettings;prompt:string}[]=[];
  handler:(input:AnalysisInput)=>unknown=()=>{throw new Error('No AI request was expected.');};
  async completeJson(_system:string,prompt:string,settings:ProviderSettings):Promise<CompletionResult>{const marker='INPUT_DATA_JSON:\n',start=prompt.lastIndexOf(marker);assert.ok(start>=0);const input=JSON.parse(prompt.slice(start+marker.length)) as AnalysisInput;this.calls.push({input:clone(input),settings:clone(settings),prompt});const value=this.handler(input);return {value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:100,outputTokens:100},estimatedCostUSD:0.0002};}
  async hasApiKey(){return true;}
  async getSession(){return {connected:true,sharing:true,email:null,accountId:'test-account',accounts:[]};}
  async testConnection():Promise<CompletionResult>{return {value:{ok:true},usageKnown:true,estimatedCostUSD:0};}
  async listModels(){return [{id:'test-model',name:'Test model'}];}
  async setApiKey(){}
  async removeApiKey(){}
  async signIn(){return this.getSession();}
  cancelSignIn(){}
  async signOut(){}
  async selectAccount(){}
}
function fixture(options:{papers?:PaperRecord[];tags?:Record<number,NativeTag[]>;definitions?:TagDefinition[];applied?:boolean}={}) {
  const state=initialState(),host=new MemoryHost(options.papers??[paper()],options.tags??{1:[]}),ai=new MemoryAI(),saves:AppState[]=[];
  state.tags=options.definitions??[we()];state.taxonomyReady=options.applied!==false;state.vocabularyVersion=3;state.settings={...state.settings,provider:'chatgpt',model:'test-model',autoAssign:false};
  const env:ControllerEnvironment={host,ai,persist:async value=>{saves.push(clone(value));}};
  return {state,host,ai,saves,env,app:new AppController(state,env)};
}
async function inventory(app:AppController){await app.invoke('refresh-existing-tags');return (await app.snapshot()).existingTags!;}
async function applyPreview(app:AppController){const preview=(await app.snapshot()).existingTags?.preview;assert.ok(preview);await app.invoke('apply-existing-tag-changes',{previewId:preview.id});}
function mappings(input:AnalysisInput,targetFor:(paperId:string)=>string[]){return {planId:input.planId,fingerprint:input.fingerprint,mappings:input.groups.flatMap(group=>group.assignments.map(value=>({groupId:group.groupId,paperId:value.paperId,sourceFingerprint:value.sourceFingerprint,targetIds:targetFor(value.paperId),relation:'equivalent',reason:'The actual paper passage establishes this meaning.',evidence:[{source:'abstract',text:value.paper.abstract}]})))};}
function diy(input:AnalysisInput,description='Catalyst-layer resistance in water electrolysis.',extra:Record<string,unknown>={}){return {planId:input.planId,fingerprint:input.fingerprint,definitions:input.groups.map(group=>({groupId:group.groupId,description,facet:'phenomenon',support:group.assignments.map(value=>({paperId:value.paperId,sourceFingerprint:value.sourceFingerprint,evidence:[{source:'abstract',text:value.paper.abstract}]})),...extra}))};}

test('inventory preserves exact native names and unapplied definitions provide no replacement authority',async()=>{
  const native=[{tag:'  Water   Electrolysis  ',type:1},{tag:'Project / draft',type:0},{tag:'x'.repeat(210),type:0}],h=fixture({applied:false,tags:{1:native}}),view=await inventory(h.app);
  assert.deepEqual(view.rows.map(row=>row.name).sort(),native.map(tag=>tag.tag).sort());assert.ok(view.rows.every(row=>row.status==='unmatched'&&!row.targetNames.length));
  await assert.rejects(h.app.invoke('preview-existing-tag-changes',{selections:[{groupId:view.rows[0].id,action:'replace'}]}),/Apply a vocabulary/);
  await assert.rejects(h.app.invoke('analyze-existing-tags',{groupIds:[view.rows[0].id]}),/Apply your tag list/);assert.equal(h.ai.calls.length,0);assert.equal(h.host.writes.length,0);assert.deepEqual(await h.host.readTags(1),native);
});

test('reviewed water-electrolyzer variants consolidate to existing WE once and typed undo restores exact tags',async()=>{
  const native=[{tag:'water Electrolyzer',type:1},{tag:'Water Electrolysis',type:0},{tag:'WE',type:1},{tag:'Project manuscript',type:0}],h=fixture({tags:{1:native}}),view=await inventory(h.app);
  const selected=view.rows.filter(row=>['water Electrolyzer','Water Electrolysis','WE'].includes(row.name));assert.ok(selected.every(row=>row.status==='match'&&row.targetNames[0]==='WE'));
  await h.app.invoke('preview-existing-tag-changes',{selections:selected.map(row=>({groupId:row.id,action:'replace'}))});assert.deepEqual(await h.host.readTags(1),native);assert.equal(h.host.writes.length,0);
  const preview=(await h.app.snapshot()).existingTags!.preview!;assert.equal(preview.changes.length,1);await applyPreview(h.app);
  assert.deepEqual(await h.host.readTags(1),[{tag:'WE',type:1},{tag:'Project manuscript',type:0}]);assert.equal(h.host.writes.length,1);assert.equal(h.ai.calls.length,0);
  const journal=h.state.history[0];assert.deepEqual(journal.patches[0].before,native);await h.app.invoke('undo',{id:journal.id});assert.deepEqual(await h.host.readTags(1),native);assert.equal(h.state.history.find(value=>value.id===journal.id)?.status,'undone');
});

test('unmatched tags remain untouched and Keep persists across controller restart with decision-only undo',async()=>{
  const native=[{tag:'Project manuscript',type:0}],h=fixture({tags:{1:native}}),view=await inventory(h.app),row=view.rows[0];assert.equal(row.status,'unmatched');assert.equal(h.host.writes.length,0);
  await h.app.invoke('preview-existing-tag-changes',{selections:[{groupId:row.id,action:'keep'}]});assert.deepEqual((await h.app.snapshot()).existingTags!.preview!.changes,[]);await applyPreview(h.app);
  const journal=h.state.history[0];assert.equal(journal.patches.length,0);const keys=Object.keys(journal.afterDecisions!);assert.equal(keys.length,1);assert.equal(h.state.decisions[keys[0]].locked,true);assert.equal(h.host.writes.length,0);
  const resumedState=clone(h.state),resumed=new AppController(resumedState,h.env),resumedView=await inventory(resumed);assert.equal(resumedView.rows[0].assignments?.[0].conflict,true);
  await assert.rejects(resumed.invoke('preview-existing-tag-changes',{selections:[{groupId:row.id,action:'remove'}]}),/kept|locked|override/);await resumed.invoke('undo',{id:journal.id});assert.equal(resumedState.decisions[keys[0]],undefined);assert.deepEqual(await h.host.readTags(1),native);assert.equal(h.host.writes.length,0);
});

test('paper-specific conflict overrides protect other papers and undo restores remembered rejections',async()=>{
  const native={1:[{tag:'Water Electrolysis',type:1}],2:[{tag:'Water Electrolysis',type:0}]},h=fixture({papers:[paper(1),paper(2)],tags:native});h.state.decisions['1:P1|we']={rejected:true};
  let view=await inventory(h.app),row=view.rows[0];assert.equal(row.assignments?.find(value=>value.paperId==='1:P1')?.conflict,true);assert.notEqual(row.assignments?.find(value=>value.paperId==='1:P2')?.conflict,true);
  await assert.rejects(h.app.invoke('preview-existing-tag-changes',{selections:[{groupId:row.id,action:'replace'}]}),/locked|rejected|override/);
  await h.app.invoke('preview-existing-tag-changes',{selections:[{groupId:row.id,action:'replace',paperIds:['1:P2']}]});await applyPreview(h.app);assert.deepEqual(await h.host.readTags(1),native[1]);assert.deepEqual(await h.host.readTags(2),[{tag:'WE',type:0}]);assert.equal(h.state.decisions['1:P1|we'].rejected,true);
  await h.app.invoke('undo',{id:h.state.history[0].id});view=await inventory(h.app);row=view.rows[0];
  await h.app.invoke('preview-existing-tag-changes',{selections:[{groupId:row.id,action:'replace',paperIds:['1:P1'],paperTargets:[{paperId:'1:P1',targetIds:['we'],overrideConflicts:true}]}]});await applyPreview(h.app);assert.equal(h.state.decisions['1:P1|we'].rejected,false);assert.deepEqual(await h.host.readTags(1),[{tag:'WE',type:0}]);assert.deepEqual(await h.host.readTags(2),native[2]);
  await h.app.invoke('undo',{id:h.state.history[0].id});assert.deepEqual(await h.host.readTags(1),native[1]);assert.equal(h.state.decisions['1:P1|we'].rejected,true);
});

test('changed native tags or source content makes an existing-tag preview stale before any write',async t=>{
  for(const change of ['native','abstract'])await t.test(change,async()=>{
    const h=fixture({tags:{1:[{tag:'Water Electrolysis',type:0}]}}),view=await inventory(h.app);await h.app.invoke('preview-existing-tag-changes',{selections:[{groupId:view.rows[0].id,action:'replace'}]});
    if(change==='native')h.host.tags.set(1,[{tag:'Water Electrolysis',type:0},{tag:'Later manual tag',type:0}]);else h.host.papers.get(1)!.abstract='A changed scientific scope.';
    await assert.rejects(applyPreview(h.app),/changed|Refresh|out of date/);assert.equal(h.host.writes.length,0);assert.equal(h.state.history.length,0);
  });
});

test('contextual AI comparison uses snapshot and per-paper bindings and retains different meanings of one native tag',async()=>{
  const definitions=[definition('membrane','membrane',{facet:'component',fullName:'proton exchange membrane'}),definition('pemwe','PEMWE',{fullName:'proton exchange membrane water electrolysis'})];
  const h=fixture({papers:[paper(1,'We measure proton exchange membrane conductivity.'),paper(2,'We operate proton exchange membrane water electrolysis.')],tags:{1:[{tag:'PEM',type:0}],2:[{tag:'PEM',type:0}]},definitions});
  const view=await inventory(h.app),row=view.rows[0];h.ai.handler=input=>mappings(input,id=>id==='1:P1'?['membrane']:['pemwe']);await h.app.invoke('analyze-existing-tags',{groupIds:[row.id]});await h.app.waitForIdle();
  assert.equal(h.ai.calls.length,1);const input=h.ai.calls[0].input;assert.equal(input.planId,view.id);assert.ok(input.fingerprint);assert.ok(input.groups[0].assignments.every(value=>value.sourceFingerprint&&value.paper.abstract));assert.equal(h.host.writes.length,0);
  const analyzed=(await h.app.snapshot()).existingTags!;assert.equal(analyzed.status,'ready');assert.equal(analyzed.rows[0].status,'match');assert.deepEqual(analyzed.rows[0].assignments!.map(value=>value.targetIds),[['membrane'],['pemwe']]);
  await h.app.invoke('preview-existing-tag-changes',{selections:[{groupId:row.id,action:'replace'}]});await applyPreview(h.app);assert.deepEqual(await h.host.readTags(1),[{tag:'membrane',type:0}]);assert.deepEqual(await h.host.readTags(2),[{tag:'PEMWE',type:0}]);
});

test('stale contextual AI envelope or source identities pause comparison without accepting mappings',async t=>{
  for(const field of ['planId','fingerprint','sourceFingerprint'])await t.test(field,async()=>{
    const h=fixture({tags:{1:[{tag:'legacy electrolysis',type:0}]}}),view=await inventory(h.app);h.ai.handler=input=>{const raw=mappings(input,()=>['we']);if(field==='sourceFingerprint')raw.mappings[0].sourceFingerprint='foreign';else raw[field]='foreign';return raw;};
    await h.app.invoke('analyze-existing-tags',{groupIds:[view.rows[0].id]});await h.app.waitForIdle();const result=(await h.app.snapshot()).existingTags!;assert.equal(result.status,'paused');assert.deepEqual(result.rows[0].targetNames,[]);assert.equal(h.host.writes.length,0);assert.equal(h.ai.calls.length,1);
  });
});

test('explicit DIY creation uses the selected API, approves a suggestion-only custom tag and preserves the core pilot',async()=>{
  const h=fixture({papers:[paper(1,'We measure catalyst-layer resistance in water electrolysis.')],tags:{1:[{tag:'RCL',type:0}]}});h.state.settings.provider='api';h.state.settings.inputPricePerMillion=1;h.state.settings.outputPricePerMillion=1;h.state.settings.budgetUSD=10;h.state.pilotReviewed=true;h.state.pilotVersion=3;h.state.pilotIds=['1:P1'];h.state.pilotExpected=1;
  const before=clone(h.state.tags),view=await inventory(h.app);assert.equal(h.ai.calls.length,0);h.ai.handler=input=>diy(input);await h.app.invoke('create-diy-from-existing',{groupIds:[view.rows[0].id]});await h.app.waitForIdle();
  assert.equal(h.ai.calls.length,1);assert.equal(h.ai.calls[0].settings.mode,'api');const custom=h.state.tags.find(tag=>tag.name==='RCL')!;assert.ok(custom);assert.equal(custom.status,'approved');assert.equal(custom.custom,true);assert.equal(custom.matchingMode,'suggest');assert.deepEqual(h.state.tags.filter(tag=>!tag.custom),before);assert.equal(h.host.writes.length,0);assert.equal(h.state.vocabularyVersion,3);assert.equal(h.state.pilotReviewed,true);assert.equal(h.state.pilotVersion,3);assert.deepEqual(h.state.pilotIds,['1:P1']);assert.equal(h.state.settings.autoAssign,false);
  await h.app.invoke('undo',{id:h.state.history[0].id});assert.equal(h.state.tags.some(tag=>tag.id===custom.id),false);assert.deepEqual(await h.host.readTags(1),[{tag:'RCL',type:0}]);
});

test('uncertain DIY meanings and long names remain questions until the researcher supplies a meaning or shorter name',async t=>{
  await t.test('uncertain',async()=>{
    const h=fixture({tags:{1:[{tag:'ML',type:0}]}}),view=await inventory(h.app);h.ai.handler=input=>diy(input,'',{question:'Does ML mean machine learning or material layers?'});await h.app.invoke('create-diy-from-existing',{groupIds:[view.rows[0].id]});await h.app.waitForIdle();assert.equal(h.state.tags.length,1);assert.match((await h.app.snapshot()).existingTags!.rows[0].diyQuestion!,/machine learning/);assert.equal(h.host.writes.length,0);
  });
  await t.test('long name',async()=>{
    const name='Catalyst layer resistance in water electrolysis with detailed proton transport measurements',h=fixture({papers:[paper(1,'We measure catalyst-layer resistance in water electrolysis.')],tags:{1:[{tag:name,type:0}]}}),view=await inventory(h.app);h.ai.handler=input=>diy(input);await h.app.invoke('create-diy-from-existing',{groupIds:[view.rows[0].id]});await h.app.waitForIdle();assert.equal(h.state.tags.length,1);assert.match((await h.app.snapshot()).existingTags!.rows[0].diyQuestion!,/shorter|80/);
    await h.app.invoke('create-diy-from-existing',{groupIds:[view.rows[0].id],choices:[{groupId:view.rows[0].id,name:'RCL',description:'Catalyst-layer resistance in water electrolysis.',facet:'phenomenon'}]});await h.app.waitForIdle();assert.equal(h.ai.calls.length,1,'an explicit meaning and shorter name do not request another definition');const created=h.state.tags.find(tag=>tag.name==='RCL')!;assert.ok(created);assert.deepEqual(created.aliases,[name]);assert.equal(h.host.writes.length,0);assert.deepEqual(await h.host.readTags(1),[{tag:name,type:0}]);
  });
});
