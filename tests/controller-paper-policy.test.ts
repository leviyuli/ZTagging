import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController, initialState } from '../src/controller.ts';
import type { AppState, ControllerEnvironment } from '../src/controller.ts';
import { paperFingerprint } from '../src/core.ts';
import type { PaperRecord, TagDefinition } from '../src/core.ts';
import { normalizeFacts } from '../src/taxonomy.ts';
import { sameTags } from '../src/platform.ts';
import type { LibraryHost, NativeTag, TagPatch } from '../src/platform.ts';
import type { PaperInputAssessment } from '../src/paper-recovery.ts';
import type { CompletionResult, ProviderSettings } from '../src/providers.ts';
import { getNoTagDefinition, isNoTagDefinition, NO_TAG_ID } from '../src/tag-policy.ts';

const copy=<T>(value:T):T=>structuredClone(value);
const outsidePassage='We study galaxy formation in distant clusters using optical observations and stellar population models.';
function paper(itemID=1,abstract=outsidePassage):PaperRecord{const value:PaperRecord={id:`1:POLICY${itemID}`,itemID,libraryID:1,key:`POLICY${itemID}`,title:`Observations of distant stellar clusters ${itemID}`,abstract,keywords:[],fingerprint:''};value.fingerprint=paperFingerprint(value);return value;}
function scientific():TagDefinition{return {id:'eis',name:'EIS',fullName:'electrochemical impedance spectroscopy',description:'Electrochemical impedance spectroscopy of electrodes.',facet:'method',custom:false,status:'approved',matchingMode:'auto',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[]};}
class MemoryHost implements LibraryHost{
  papers=new Map<number,PaperRecord>();native=new Map<number,NativeTag[]>();collections=new Map<number,number[]>();pdfs=new Map<number,string>();writes:TagPatch[][]=[];inputChecks=0;selected=[1];
  constructor(papers:PaperRecord[]){for(const value of papers){this.papers.set(value.itemID,copy(value));this.native.set(value.itemID,[{tag:'Manual project',type:0},{tag:'Imported keyword',type:1},{tag:'Co',type:0},{tag:'CO',type:1}]);this.collections.set(value.itemID,[11,29]);}}
  async read(itemID:number){const original=this.papers.get(itemID);if(!original)return null;const value=copy(original);value.keywords=(this.native.get(itemID)??[]).filter(tag=>tag.type===1).map(tag=>tag.tag);value.fingerprint=paperFingerprint(value);return value;}
  async list(scope:string){const ids=scope==='selected'||scope==='collections'?this.selected:[...this.papers.keys()];return (await Promise.all(ids.map(id=>this.read(id)))).filter((value):value is PaperRecord=>!!value).slice(0,scope==='pilot'?50:undefined);}
  async readTags(itemID:number){if(!this.papers.has(itemID))throw new Error('Paper is unavailable');return copy(this.native.get(itemID)??[]);}
  async pdfText(itemID:number){return this.pdfs.get(itemID)??'';}
  async apply(patches:TagPatch[]){for(const patch of patches)assert.equal(sameTags(await this.readTags(patch.itemID),patch.before),true);this.writes.push(copy(patches));for(const patch of patches)this.native.set(patch.itemID,copy(patch.after));}
  async inspectInputs(itemID:number,recheck=false):Promise<PaperInputAssessment>{this.inputChecks++;const value=(await this.read(itemID))!,pdf=this.pdfs.get(itemID)??'';return {paperId:value.id,itemID,checkedAt:new Date().toISOString(),metadata:{title:!!value.title,abstract:!!value.abstract,keywords:!!value.keywords.length},pdf:{status:pdf?'readable':'missing',attachmentCount:pdf?1:0,localCount:pdf?1:0,characters:pdf.length,rechecked:recheck}};}
  async show(){}async saveSearch(){}
}
class MemoryAI{
  calls:{prompt:string;settings:ProviderSettings}[]=[];
  async completeJson(_system:string,prompt:string,settings:ProviderSettings):Promise<CompletionResult>{this.calls.push({prompt,settings:copy(settings)});const data=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]);assert.ok(Array.isArray(data.approvedVocabulary),'This fixture only permits assignment requests');return {value:{summary:'The paper studies astronomical objects.',concepts:['galaxy formation'],needsPDF:false,suggestions:[],newTagCandidates:[],noMatch:true,noMatchReason:'The supported astronomical topic is outside the supplied electrochemistry vocabulary.',noMatchEvidence:[{source:'abstract',text:data.paper.abstract}]},usageKnown:true,usage:{inputTokens:100,outputTokens:100},estimatedCostUSD:0};}
  async hasApiKey(){return true;}async getSession(){return {connected:true,sharing:true,email:null,accountId:'synthetic-account',accounts:[]};}
  async testConnection():Promise<CompletionResult>{return {value:{ok:true},usageKnown:true,estimatedCostUSD:0};}async listModels(){return [];}async setApiKey(){}async removeApiKey(){}async signIn(){return this.getSession();}cancelSignIn(){}async signOut(){return {revoked:true};}async selectAccount(){}
}
function fixture(options:{papers?:PaperRecord[];state?:AppState;host?:MemoryHost}={}){
  const state=options.state??initialState(),host=options.host??new MemoryHost(options.papers??[paper()]),ai=new MemoryAI(),saves:AppState[]=[];
  if(!options.state){state.tags=[scientific()];state.taxonomyReady=true;state.vocabularyVersion=3;state.settings.model='synthetic-model';}
  const environment:ControllerEnvironment={host,ai,persist:async value=>{saves.push(copy(value));}};
  return {state,host,ai,saves,app:new AppController(state,environment)};
}
type Fixture=ReturnType<typeof fixture>;
async function scan(h:Fixture){await h.app.invoke('scan',{scope:'library'});}
async function analyze(h:Fixture,scope='library'){await h.app.invoke('tag',{scope});await h.app.waitForIdle();assert.equal(h.state.run?.status,'idle',h.state.run?.message);}
async function exclusion(h:Fixture,id:string,exclude=true){await h.app.invoke('preview-paper-exclusion',{ids:[id],exclude});const preview=(await h.app.snapshot()).paperExclusionPreview!;await h.app.invoke('apply-paper-exclusion',{previewId:preview.id});return h.state.history[0];}
async function seedGap(h:Fixture){await scan(h);const value=h.state.papers['1:POLICY1'];h.state.facts[value.id]=normalizeFacts({summary:'No validated concepts.',concepts:[],needsPDF:true},value,'chatgpt','synthetic-model');h.state.paperInputs={[value.id]:await h.host.inspectInputs(value.itemID)};return value.id;}

test('paper attention dismissal survives restart and an unchanged local PDF recheck without AI',async()=>{
  const h=fixture({papers:[paper(1,'')]}),id=await seedGap(h);assert.equal((await h.app.snapshot()).paperAttention!.papers.find(value=>value.id===id)!.canDismiss,true);
  await h.app.invoke('dismiss-paper-attention',{ids:[id]});assert.equal((await h.app.snapshot()).paperAttention!.papers.some(value=>value.id===id),false);
  const restarted=fixture({state:copy(h.state),host:h.host});await restarted.app.initialize();assert.equal((await restarted.app.snapshot()).paperAttention!.papers.some(value=>value.id===id),false);
  await restarted.app.invoke('recheck-paper-inputs',{id});assert.equal((await restarted.app.snapshot()).paperAttention!.papers.some(value=>value.id===id),false,'The recheck operation flag is not a changed evidence condition');
  assert.equal(h.ai.calls.length+restarted.ai.calls.length,0);assert.ok(restarted.state.paperAttentionDismissals?.[id]);assert.equal(h.host.writes.length,0);
});

test('a changed local evidence condition resurfaces a dismissed paper without requesting AI',async()=>{
  const h=fixture({papers:[paper(1,'')]}),id=await seedGap(h);await h.app.invoke('dismiss-paper-attention',{ids:[id]});h.host.pdfs.set(1,'Newly readable PDF text, still awaiting a requested scientific analysis.');
  await h.app.invoke('recheck-paper-inputs',{id});assert.equal((await h.app.snapshot()).paperAttention!.papers.some(value=>value.id===id),true);assert.equal(h.state.paperInputs![id].pdf.status,'readable');assert.equal(h.ai.calls.length,0);assert.equal(h.host.writes.length,0);
});

test('manual exclusion outside the saved run adds only no_tag, retains tag types and collections, and has native Undo',async()=>{
  const h=fixture({papers:[paper(1),paper(2)]});await scan(h);const id='1:POLICY2',native=await h.host.readTags(2),collections=copy(h.host.collections);
  h.state.run={id:'unrelated-run',kind:'rebuild',scope:'selected',automatic:false,status:'paused',jobs:[{id:'first',paperId:'1:POLICY1',status:'completed'}],vocabCursor:1,vocabFinished:true,message:'Unrelated saved review.',spentUSD:1.25,settings:copy(h.state.settings),vocabularyVersion:h.state.vocabularyVersion};const run=copy(h.state.run);
  await h.app.invoke('preview-paper-exclusion',{ids:[id],exclude:true});const preview=(await h.app.snapshot()).paperExclusionPreview!;assert.equal(h.host.writes.length,0);assert.deepEqual(preview.changes[0].before,native.map(tag=>tag.tag));
  await h.app.invoke('apply-paper-exclusion',{previewId:preview.id});const change=h.state.history[0];
  assert.deepEqual(await h.host.readTags(2),[...native,{tag:'no_tag',type:0}]);assert.deepEqual(h.host.collections,collections);assert.deepEqual(h.state.run,run);assert.equal(h.state.ownership[id]?.[NO_TAG_ID],undefined);assert.equal(h.state.decisions[`${id}|${NO_TAG_ID}`].locked,true);assert.equal(h.ai.calls.length,0);
  assert.equal((await h.app.snapshot()).paperAttention!.papers.find(value=>value.id===id)!.status,'excluded');
  await h.app.invoke('undo',{id:change.id});assert.deepEqual(await h.host.readTags(2),native);assert.deepEqual(h.host.collections,collections);assert.equal(h.state.history.find(value=>value.id===change.id)!.status,'undone');assert.equal(h.ai.calls.length,0);
});

test('Include again is separately reviewed and preserves a preexisting manual no_tag assignment through Undo without acquiring ownership',async()=>{
  const h=fixture();h.host.native.get(1)!.push({tag:'no_tag',type:1});await scan(h);const before=await h.host.readTags(1),id='1:POLICY1';
  await h.app.invoke('preview-paper-exclusion',{ids:[id],exclude:true});await h.app.invoke('apply-paper-exclusion',{previewId:h.state.paperExclusionPreview!.id});assert.equal(h.host.writes.length,0);assert.equal(h.state.history.length,0);assert.equal(h.state.ownership[id]?.[NO_TAG_ID],undefined);
  const change=await exclusion(h,id,false);assert.deepEqual(await h.host.readTags(1),before.filter(tag=>tag.tag!=='no_tag'));assert.equal(h.state.ownership[id]?.[NO_TAG_ID],undefined);
  await h.app.invoke('undo',{id:change.id});assert.deepEqual(await h.host.readTags(1),before);assert.equal(h.state.ownership[id]?.[NO_TAG_ID],undefined);assert.equal(h.ai.calls.length,0);
});

test('fresh native no_tag skips rebuild, assignment and deferred incoming work while preserving cached factual evidence',async()=>{
  const h=fixture();await scan(h);const id='1:POLICY1',value=h.state.papers[id];h.state.facts[id]=normalizeFacts({summary:'Cached source evidence.',needsPDF:false,concepts:[{name:'galaxy formation',evidence:[{source:'abstract',text:value.abstract}]}]},value,'cached-provider','cached-model');const facts=copy(h.state.facts[id]);
  h.host.native.get(1)!.push({tag:'no_tag',type:0});assert.equal(h.state.nativeTags[id].some(tag=>tag.tag==='no_tag'),false);
  await h.app.invoke('rebuild',{scope:'library'});await h.app.waitForIdle();assert.equal(h.state.run?.status,'idle');assert.equal(h.state.taxonomyProposal,null);assert.deepEqual(h.state.facts[id],facts);assert.equal((await h.app.snapshot()).queue.skipped,1);
  await analyze(h);assert.deepEqual(h.state.facts[id],facts);assert.equal(h.ai.calls.length,0);
  const restored=copy(h.state);restored.settings.autoAssign=true;restored.pilotReviewed=true;restored.pilotVersion=restored.vocabularyVersion;restored.deferredItemIDs=[1];restored.nativeTags[id]=[];
  const incoming=fixture({state:restored,host:h.host});await incoming.app.initialize();await incoming.app.waitForIdle();assert.equal(incoming.ai.calls.length,0);assert.deepEqual(incoming.state.facts[id],facts);assert.equal(incoming.state.run!.scope,'incoming');assert.equal(incoming.state.run!.jobs[0].status,'completed');assert.equal(h.host.writes.length,0);
});

test('an evidenced unmatched suggestion waits for batch Apply and Undo restores every prior native assignment',async()=>{
  const h=fixture(),before=await h.host.readTags(1),collections=copy(h.host.collections);await analyze(h);
  const suggestion=h.state.suggestions.find(value=>value.tagId===NO_TAG_ID)!;assert.ok(suggestion);assert.equal(suggestion.autoEligible,false);assert.equal(suggestion.applied??false,false);assert.equal(h.host.writes.length,0);assert.deepEqual(await h.host.readTags(1),before);
  await h.app.invoke('accept-suggestion',{id:suggestion.id});assert.equal(h.host.writes.length,0);await h.app.invoke('apply-suggestions',{ids:[suggestion.id]});const change=h.state.history[0];
  assert.deepEqual(await h.host.readTags(1),[...before,{tag:'no_tag',type:0}]);assert.deepEqual(h.host.collections,collections);assert.equal(h.state.ownership['1:POLICY1'][NO_TAG_ID].name,'no_tag');
  await h.app.invoke('undo',{id:change.id});assert.deepEqual(await h.host.readTags(1),before);assert.equal(h.state.ownership['1:POLICY1']?.[NO_TAG_ID],undefined);assert.equal(suggestion.applied,false);assert.equal(h.ai.calls.length,1);
});

test('rejecting a no_tag suggestion prevents cached reruns and manual removals from reapplying the marker',async()=>{
  const h=fixture();await analyze(h);const suggestion=h.state.suggestions.find(value=>value.tagId===NO_TAG_ID)!;
  await h.app.invoke('reject-suggestion',{id:suggestion.id});await analyze(h);assert.equal(h.state.suggestions.some(value=>value.runId===h.state.run!.id&&value.tagId===NO_TAG_ID&&!value.applied),false);assert.equal(h.state.decisions[`1:POLICY1|${NO_TAG_ID}`].rejected,true);assert.equal(h.ai.calls.length,1);assert.equal(h.host.writes.length,0);assert.equal(h.state.suggestions.find(value=>value.id===suggestion.id)!.status,'rejected');assert.equal(suggestion.decisionOrigin,'researcher');
  const second=fixture();await analyze(second);const proposed=second.state.suggestions.find(value=>value.tagId===NO_TAG_ID)!;await second.app.invoke('apply-suggestions',{ids:[proposed.id]});second.host.native.set(1,(await second.host.readTags(1)).filter(tag=>tag.tag!=='no_tag'));await second.app.onItemChanged(1);await analyze(second);
  assert.equal(second.state.decisions[`1:POLICY1|${NO_TAG_ID}`].rejected,true);assert.equal(second.state.suggestions.some(value=>value.runId===second.state.run!.id&&value.tagId===NO_TAG_ID&&!value.applied),false);assert.equal((await second.host.readTags(1)).some(tag=>tag.tag==='no_tag'),false);assert.equal(second.ai.calls.length,1);
});

test('no_tag alone cannot satisfy the approved-vocabulary gate or the scientific pilot requirement',async()=>{
  const empty=fixture();empty.state.tags=[getNoTagDefinition()];await assert.rejects(empty.app.invoke('tag',{scope:'library'}),/Approve a vocabulary|custom tag/i);assert.equal(empty.ai.calls.length,0);
  const h=fixture();await analyze(h,'pilot');const suggestion=h.state.suggestions.find(value=>value.tagId===NO_TAG_ID)!;await h.app.invoke('accept-suggestion',{id:suggestion.id});
  await assert.rejects(h.app.invoke('mark-pilot-reviewed'),/scientific tag suggestion/i);assert.equal(h.state.pilotReviewed,false);
  await assert.rejects(h.app.invoke('save-settings',{settings:{...h.state.settings,autoAssign:true}}),/pilot/i);assert.equal(h.state.settings.autoAssign,false);assert.equal(h.host.writes.length,0);
});

test('stale exclusion previews reject later native changes and stale preview identities without modifying library data',async()=>{
  const h=fixture();await scan(h);const id='1:POLICY1';await h.app.invoke('preview-paper-exclusion',{ids:[id],exclude:true});const first=h.state.paperExclusionPreview!.id;
  await h.app.invoke('preview-paper-exclusion',{ids:[id],exclude:true});await assert.rejects(h.app.invoke('apply-paper-exclusion',{previewId:first}),/Review the items again/);
  const preview=h.state.paperExclusionPreview!.id;h.host.native.get(1)!.push({tag:'Later manual choice',type:0});const before=await h.host.readTags(1);
  await assert.rejects(h.app.invoke('apply-paper-exclusion',{previewId:preview}),/Tags changed after the preview/);assert.deepEqual(await h.host.readTags(1),before);assert.equal(h.host.writes.length,0);assert.equal(h.state.history.length,0);assert.equal(h.state.tags.some(isNoTagDefinition),false);assert.equal(h.ai.calls.length,0);
});

test('reserved definitions remain immutable through public save and delete actions',async()=>{
  const h=fixture();await assert.rejects(h.app.invoke('save-tag',{tag:{...getNoTagDefinition(),name:'Renamed marker'}}),/built-in marker/i);await assert.rejects(h.app.invoke('delete-tag',{id:NO_TAG_ID}),/built-in marker/i);assert.deepEqual(h.state.tags,[scientific()]);assert.equal(h.host.writes.length,0);assert.equal(h.ai.calls.length,0);
});

test('excluding an item while its retry is queued prevents that future paid request',async()=>{
  const h=fixture({papers:[paper(1),paper(2)]});await scan(h);
  const second=h.state.papers['1:POLICY2'];h.state.facts[second.id]=normalizeFacts({summary:'Retained facts.',concepts:[],needsPDF:true},second,'chatgpt','synthetic-model');const facts=copy(h.state.facts[second.id]);
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve),pending=new Promise<void>(resolve=>release=resolve),complete=h.ai.completeJson.bind(h.ai);
  h.ai.completeJson=async(...args)=>{enter();await pending;return complete(...args);};
  await h.app.invoke('tag',{scope:'library'});await entered;
  await h.app.invoke('retry-papers',{ids:[second.id]});await exclusion(h,second.id);release();await h.app.waitForIdle();
  assert.equal(h.ai.calls.length,1);assert.deepEqual(h.state.facts[second.id],facts);assert.equal(h.state.maintenanceTasks?.[0].status,'completed');
  assert.ok((await h.host.readTags(2)).some(tag=>tag.tag==='no_tag'));assert.equal(h.state.suggestions.some(suggestion=>suggestion.paperId===second.id),false);
});

test('an older reserved-name definition cannot prevent canonical review suggestions from being applied or erase referenced IDs',async()=>{
  const h=fixture({papers:[paper(1),paper(2)]}),legacy={...getNoTagDefinition(),id:'old-custom-no-tag',builtin:undefined,matchingMode:'suggest' as const};h.state.tags.push(legacy);h.state.decisions['1:POLICY2|old-custom-no-tag']={rejected:true};
  await analyze(h);const suggestion=h.state.suggestions.find(value=>value.tagId===NO_TAG_ID)!;assert.ok(suggestion);
  assert.ok(h.state.tags.some(tag=>tag.id===NO_TAG_ID),'The canonical suggestion ID needs its own stored definition');
  await h.app.invoke('apply-suggestions',{ids:[suggestion.id]});assert.equal((await h.host.readTags(1)).some(tag=>tag.tag==='no_tag'),true);
  assert.ok(h.state.tags.some(tag=>tag.id===legacy.id));assert.deepEqual(h.state.decisions['1:POLICY2|old-custom-no-tag'],{rejected:true});
});

test('a same-paper legacy no_tag rejection protects the canonical marker without rewriting the historical choice',async()=>{
  const h=fixture(),legacy={...getNoTagDefinition(),id:'old-custom-no-tag',builtin:undefined,matchingMode:'suggest' as const};h.state.tags.push(legacy);h.state.decisions['1:POLICY1|old-custom-no-tag']={rejected:true};
  await analyze(h);assert.equal(h.state.suggestions.some(value=>value.tagId===NO_TAG_ID),false);assert.deepEqual(h.state.decisions['1:POLICY1|old-custom-no-tag'],{rejected:true});assert.equal(h.host.writes.length,0);
});

test('a legacy no_tag rejection or lock added after preview blocks canonical Apply without losing the pending evidence',async()=>{
  for(const decision of [{rejected:true},{locked:true}]){
    const h=fixture(),legacy={...getNoTagDefinition(),id:'old-custom-no-tag',builtin:undefined,matchingMode:'suggest' as const};h.state.tags.push(legacy);await analyze(h);const suggestion=h.state.suggestions.find(value=>value.tagId===NO_TAG_ID)!;assert.ok(suggestion);
    h.state.decisions['1:POLICY1|old-custom-no-tag']=decision;
    await assert.rejects(h.app.invoke('apply-suggestions',{ids:[suggestion.id]}),/earlier.*choice|rejected|locked/i);assert.equal(h.host.writes.length,0);assert.equal(suggestion.applied??false,false);assert.ok(suggestion.evidence.length);
  }
});
