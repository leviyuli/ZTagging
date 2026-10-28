import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import {paperFingerprint,fingerprint} from '../src/core.ts';
import type {LibraryHost,NativeTag,TagPatch} from '../src/platform.ts';
import {sameTags} from '../src/platform.ts';
import type {CompletionResult,ProviderSettings} from '../src/providers.ts';

const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const PEM='Proton exchange membrane fuel cell',AEM='Anion exchange membrane fuel cell',EIS='Electrochemical impedance spectroscopy';
function paper(itemID:number):PaperRecord {
  const family=itemID%2?PEM:AEM;
  const result:PaperRecord={id:`1:P${itemID}`,itemID,libraryID:1,key:`P${itemID}`,title:`Fuel-cell experiment ${itemID}`,abstract:`${family} transport is measured. ${EIS} resolves the losses.`,keywords:[],fingerprint:''};
  result.fingerprint=paperFingerprint(result);return result;
}
function tag(id:string,name:string,extra:Partial<TagDefinition>={}):TagDefinition{return {id,name,fullName:name,description:`Definition of ${name}`,facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'draft',broaderIds:[],relatedIds:[],matchingMode:'auto',...extra};}
class Host implements LibraryHost {
  papers=new Map<number,PaperRecord>();native=new Map<number,NativeTag[]>();writes:TagPatch[][]=[];selected=[1];pdfs=new Map<number,string>();
  constructor(size:number){for(let i=1;i<=size;i++){this.papers.set(i,paper(i));this.native.set(i,[]);}}
  async list(scope:string){return [...this.papers.values()].filter(p=>scope!=='selected'||this.selected.includes(p.itemID)).slice(0,scope==='pilot'?50:undefined).map(copy);}
  async read(id:number){return copy(this.papers.get(id)??null);}
  async readTags(id:number){return copy(this.native.get(id)??[]);}
  async pdfText(id:number){return this.pdfs.get(id)??'';}
  async apply(patches:TagPatch[]){for(const patch of patches)if(!sameTags(await this.readTags(patch.itemID),patch.before))throw new Error('Stale tags');this.writes.push(copy(patches));for(const patch of patches)this.native.set(patch.itemID,copy(patch.after));}
  async show(){}
  async saveSearch(){}
}
type Call={data:any;settings:ProviderSettings;kind:'facts'|'taxonomy'|'assignment'};
function factsResponse(data:any){const p=data.paper,family=p.abstract.includes(PEM)?PEM:AEM;return {summary:`${family} studied with EIS`,concepts:[{name:family,facet:'system',evidence:[{source:'abstract',text:p.abstract}]},{name:EIS,facet:'method',evidence:[{source:'abstract',text:p.abstract}]}],needsPDF:false};}
function taxonomyResponse(data:any){
  const support=(name:string)=>(data.facts as any[]).filter(f=>f.concepts.some((c:any)=>c.name===name)).map(f=>({paperId:f.paperId,conceptNames:[name]}));
  const entry=(key:string,name:string,fullName:string,extra:any={})=>({key,name,fullName,description:`Definition of ${fullName}`,facet:'system',aliases:[],parentKeys:[],relatedKeys:[],support:[],...extra});
  return {tags:[entry('fc','FC','Fuel cell'),...(support(PEM).length?[entry('pem','PEMFC',PEM,{parentKeys:['fc'],support:support(PEM)})]:[]),...(support(AEM).length?[entry('aem','AEMFC',AEM,{parentKeys:['fc'],support:support(AEM)})]:[]),entry('eis','EIS',EIS,{facet:'method',support:support(EIS)})],merges:[],excluded:[]};
}
function assignmentResponse(data:any){return {summary:'Classification of supported systems and methods.',concepts:[],needsPDF:false,newTagCandidates:[],suggestions:data.approvedVocabulary.filter((t:any)=>t.name==='FC'||t.facet!=='system'||data.paper.abstract.includes(t.fullName)).map((t:any)=>({tagId:t.id,reason:'The source directly supports this scientific concept.',confidence:'high',match:'substantive',evidence:[{source:'abstract',text:data.paper.abstract}]}))};}
class AI {
  calls:Call[]=[];
  handler:(call:Call)=>unknown|Promise<unknown>=call=>call.kind==='facts'?factsResponse(call.data):call.kind==='taxonomy'?taxonomyResponse(call.data):assignmentResponse(call.data);
  async completeJson(_s:string,prompt:string,settings:ProviderSettings):Promise<CompletionResult>{const marker='INPUT_DATA_JSON:\n',data=JSON.parse(prompt.slice(prompt.indexOf(marker)+marker.length)),kind=data.facts?'taxonomy':data.approvedVocabulary?'assignment':'facts';const call:Call={data,settings:copy(settings),kind};this.calls.push(call);const value=await this.handler(call);return {value,text:JSON.stringify(value),usage:{inputTokens:100,outputTokens:50},usageKnown:true,estimatedCostUSD:null};}
  async hasApiKey(){return false;}async getSession(){return {connected:true,sharing:true,email:null,accountId:null,accounts:[]};}
  async setApiKey(){}async removeApiKey(){}async testConnection(){return this.completeJson('','INPUT_DATA_JSON:\n{"facts":[]}',{mode:'chatgpt',model:'test'});}async listModels(){return [];}async signIn(){return this.getSession();}cancelSignIn(){}async signOut(){return {revoked:true};}async selectAccount(){}
}
function harness(size=1){const state=initialState();state.settings.model='test-model';const host=new Host(size),ai=new AI(),saved:AppState[]=[];const env:ControllerEnvironment={host,ai,persist:async v=>{saved.push(copy(v));}};return {state,host,ai,saved,controller:new AppController(state,env)};}
type Harness=ReturnType<typeof harness>;
async function run(h:Harness,kind:'rebuild'|'tag'='rebuild',scope='library'){await h.controller.invoke(kind,{scope});await h.controller.waitForIdle();}
async function publish(h:Harness){await run(h);assert.deepEqual(h.state.taxonomyProposal!.issues,[]);await h.controller.invoke('approve-taxonomy',{id:h.state.taxonomyProposal!.id});}

test('50-paper rebuild stages one supported global taxonomy without changing 107 old drafts or manual native tags',async()=>{
  const h=harness(50);h.state.tags.push(...Array.from({length:107},(_,i)=>tag(`old-${i}`,`Fine concept ${i}`)));
  h.host.native.set(1,[{tag:'Manual project',type:0}]);const before=copy(h.state.tags);
  await run(h,'rebuild','pilot');
  assert.deepEqual(h.state.tags,before);assert.equal(h.state.taxonomyProposal!.tags.filter(t=>!t.custom).length,4);
  assert.deepEqual(h.state.taxonomyProposal!.issues,[]);assert.equal(h.state.taxonomyProposal!.paperIds.length,50);
  assert.equal(h.ai.calls.filter(c=>c.kind==='facts').length,50);assert.equal(h.ai.calls.filter(c=>c.kind==='taxonomy').length,1);
  const fc=h.state.taxonomyProposal!.tags.find(t=>t.name==='FC')!;assert.equal(h.state.taxonomyProposal!.support[fc.id].paperIds.length,50);
  assert.equal(h.host.writes.length,0);assert.deepEqual(await h.host.readTags(1),[{tag:'Manual project',type:0}]);
});

test('unchanged rebuilds reuse extraction and the staged proposal instead of appending labels',async()=>{
  const h=harness(50);await run(h);const id=h.state.taxonomyProposal!.id,calls=h.ai.calls.length;
  await run(h);assert.equal(h.ai.calls.length,calls);assert.equal(h.state.taxonomyProposal!.id,id);assert.equal(h.state.tags.length,1);
  await h.controller.invoke('approve-taxonomy',{id});await run(h);
  assert.equal(h.ai.calls.filter(c=>c.kind==='facts').length,50,'Taxonomy approval must not invalidate factual extraction');
  assert.equal(h.ai.calls.filter(c=>c.kind==='taxonomy').length,2);assert.equal(h.state.tags.filter(t=>!t.custom).length,4);
});

test('publishing archives the previous vocabulary and keeps existing native assignments untouched',async()=>{
  const h=harness(2);h.host.native.set(1,[{tag:PEM,type:0},{tag:'Project manuscript',type:0}]);const old=copy(h.state.tags);
  await publish(h);assert.equal(h.state.taxonomyReady,true);assert.equal(h.state.vocabularyVersion,1);assert.equal(h.state.taxonomyProposal,null);
  assert.deepEqual(h.state.taxonomyArchives[0].tags,old);assert.equal(h.host.writes.length,0);
  await run(h,'tag');for(const suggestion of h.state.suggestions)await h.controller.invoke('accept-suggestion',{id:suggestion.id});
  await h.controller.invoke('apply-suggestions',{ids:h.state.suggestions.map(s=>s.id)});
  const names=(await h.host.readTags(1)).map(t=>t.tag);assert.ok(names.includes(PEM));assert.ok(names.includes('EIS'));assert.ok(names.includes('Project manuscript'));
  assert.ok(!names.includes('FC'));assert.ok(!names.includes('PEMFC'),'Existing full-name alias must not acquire a duplicate abbreviated tag');
  const pem=h.state.tags.find(t=>t.name==='PEMFC')!;assert.equal(h.state.ownership['1:P1']?.[pem.id],undefined);
});

test('a staged proposal cannot publish after source metadata changes',async()=>{
  const h=harness();await run(h);const proposal=h.state.taxonomyProposal!;
  h.host.papers.get(1)!.abstract='The paper was corrected to concern battery cycling.';
  await assert.rejects(h.controller.invoke('approve-taxonomy',{id:proposal.id}),/paper|evidence|source|metadata|changed/i);
  assert.equal(h.state.taxonomyReady,false);assert.equal(h.host.writes.length,0);
});

test('over-budget proposals remain staged and cannot change the active vocabulary',async()=>{
  const h=harness();h.state.settings.coreConceptLimit=2;const before=copy(h.state.tags);await run(h);
  assert.ok(h.state.taxonomyProposal!.issues.some(issue=>issue.includes('limit is 2')));
  await assert.rejects(h.controller.invoke('approve-taxonomy',{id:h.state.taxonomyProposal!.id}),/limit/);
  assert.deepEqual(h.state.tags,before);assert.equal(h.host.writes.length,0);
});

test('only a changed paper is re-extracted and unrelated taxonomy changes reuse other facts',async()=>{
  const h=harness(3);await run(h);assert.equal(h.ai.calls.filter(c=>c.kind==='facts').length,3);
  h.host.papers.get(2)!.abstract+=` A corrected ${EIS} measurement is supplied.`;await h.controller.onItemChanged(2);
  await run(h);assert.equal(h.ai.calls.filter(c=>c.kind==='facts').length,4);assert.equal(h.ai.calls.filter(c=>c.kind==='taxonomy').length,2);
  await h.controller.invoke('save-tag',{tag:tag('new-core','New draft core')});await run(h);
  assert.equal(h.ai.calls.filter(c=>c.kind==='facts').length,4);
});

test('a failed global consolidation leaves complete facts cached and no partial active taxonomy',async()=>{
  const h=harness(5);let failed=false;h.ai.handler=call=>{if(call.kind==='taxonomy'&&!failed){failed=true;throw new Error('Consolidation quota reached');}return call.kind==='facts'?factsResponse(call.data):taxonomyResponse(call.data);};
  await run(h);assert.equal(h.state.run?.status,'paused');assert.equal(Object.keys(h.state.facts).length,5);assert.equal(h.state.taxonomyProposal,null);assert.equal(h.state.tags.length,1);
  await h.controller.invoke('resume');await h.controller.waitForIdle();assert.equal(h.state.run?.status,'idle');
  assert.equal(h.ai.calls.filter(c=>c.kind==='facts').length,5);assert.equal(h.ai.calls.filter(c=>c.kind==='taxonomy').length,2);
});

test('DIY creation and edits preserve the core pilot; manual marking is reversible and never extension-owned',async()=>{
  const h=harness();await publish(h);h.state.pilotReviewed=true;h.state.pilotVersion=h.state.vocabularyVersion;h.state.settings.autoAssign=true;
  const version=h.state.vocabularyVersion,calls=h.ai.calls.length;
  const id=await h.controller.invoke('create-detail',{tag:{name:'Schottky barrier',description:'A Schottky barrier in a catalyst or electrode.',facet:'phenomenon',matchingMode:'manual'}});
  assert.equal(h.state.vocabularyVersion,version);assert.equal(h.state.pilotReviewed,true);assert.equal(h.state.settings.autoAssign,true);
  assert.equal(h.ai.calls.length,calls);await h.controller.invoke('assign-detail',{tagId:id,itemIDs:[1]});
  assert.ok((await h.host.readTags(1)).some(t=>t.tag==='Schottky barrier'));assert.equal(h.state.ownership['1:P1']?.[id],undefined);assert.equal(h.state.decisions[`1:P1|${id}`].locked,true);
  await h.controller.invoke('undo',{id:h.state.history[0].id});assert.deepEqual(await h.host.readTags(1),[]);assert.equal(h.state.decisions[`1:P1|${id}`],undefined);
});

test('DIY suggestion previews stay review-only and editing a detail invalidates its pending suggestions',async()=>{
  const h=harness();await publish(h);
  const id=await h.controller.invoke('create-detail',{tag:{name:'RCL niche',description:'Catalyst-layer resistance in fuel cells.',facet:'phenomenon',matchingMode:'suggest'}});
  await h.controller.invoke('preview-detail',{tagId:id,scope:'selected'});await h.controller.waitForIdle();
  assert.ok(h.state.suggestions.some(s=>s.tagId===id&&s.autoEligible===false));assert.equal(h.host.writes.length,0);
  const detail=h.state.tags.find(t=>t.id===id)!;await h.controller.invoke('save-tag',{tag:{...detail,description:'A revised niche topic scope.'}});
  assert.equal(h.state.suggestions.some(s=>s.tagId===id&&!s.applied),false);assert.equal(h.state.taxonomyReady,true);
});

test('merging synonym IDs exposes conflicts and preserves stricter remembered choices after explicit confirmation',async()=>{
  const h=harness();h.state.tags.push(tag('old-a','Fuel cell',{status:'approved'}),tag('old-b','FC',{fullName:'Fuel cell'}));
  h.state.decisions['1:P1|old-a']={locked:true};h.state.decisions['1:P1|old-b']={rejected:true};
  h.ai.handler=call=>{if(call.kind==='facts')return factsResponse(call.data);const raw=taxonomyResponse(call.data);raw.merges=[{fromId:'old-a',toKey:'fc'},{fromId:'old-b',toKey:'fc'}] as any;return raw;};
  await run(h);const proposal=h.state.taxonomyProposal!,fc=proposal.tags.find(t=>t.name==='FC')!;assert.deepEqual(proposal.issues,[]);
  await assert.rejects(h.controller.invoke('approve-taxonomy',{id:proposal.id}),/conflicting remembered/);
  await h.controller.invoke('approve-taxonomy',{id:proposal.id,preserveDecisions:true});
  assert.equal(h.state.decisions[`1:P1|${fc.id}`].rejected,true);assert.equal(h.state.decisions[`1:P1|${fc.id}`].locked,true);
  assert.equal(h.state.taxonomyRedirects['old-b'],fc.id);assert.equal(h.host.writes.length,0);
});

function proposalDocument(h:Harness){return {format:'zotero-smart-tags-proposal',schemaVersion:2,sourceVocabularyFingerprint:fingerprint(h.state.tags),proposal:copy(h.state.taxonomyProposal!),facts:copy(Object.values(h.state.facts))};}

test('a proposal import verifies its original local facts and stages without native changes',async()=>{
  const source=harness(2);await run(source);const document=proposalDocument(source),target=harness(2);await target.controller.invoke('scan',{scope:'library'});
  await target.controller.invoke('import-vocabulary',{value:document});assert.ok(target.state.taxonomyProposal);assert.deepEqual(target.state.taxonomyProposal!.issues,[]);
  assert.equal(Object.keys(target.state.facts).length,2);assert.equal(target.ai.calls.length,0);assert.equal(target.host.writes.length,0);
  await target.controller.invoke('approve-taxonomy',{id:target.state.taxonomyProposal!.id});assert.equal(target.state.taxonomyReady,true);assert.equal(target.host.writes.length,0);
});

test('proposal import refuses forged coverage, missing fingerprints, or unsupported quoted facts',async()=>{
  const source=harness();await run(source);const original=proposalDocument(source);
  for(const corrupt of [
    (value:any)=>{value.proposal.support[value.proposal.tags.find((t:any)=>t.name==='FC').id].paperIds=['unknown'];},
    (value:any)=>{delete value.proposal.paperFingerprints;},
    (value:any)=>{value.facts[0].concepts[0].evidence[0].text='An invented source passage.';},
  ]){
    const target=harness();await target.controller.invoke('scan',{scope:'library'});const document=copy(original);corrupt(document);
    await assert.rejects(target.controller.invoke('import-vocabulary',{value:document}),/coverage|fingerprint|passage|source|facts/i);
    assert.equal(target.state.taxonomyProposal,null);assert.equal(target.host.writes.length,0);
  }
});

test('proposal imports preserve blocking scientific review issues instead of replacing them with graph-only checks',async()=>{
  const source=harness();await run(source);const document=proposalDocument(source);document.proposal.issues=['A direct support concept needs scientific review.'];
  const target=harness();await target.controller.invoke('scan',{scope:'library'});await target.controller.invoke('import-vocabulary',{value:document});
  assert.ok(target.state.taxonomyProposal!.issues.includes(document.proposal.issues[0]));
  await assert.rejects(target.controller.invoke('approve-taxonomy',{id:target.state.taxonomyProposal!.id}),/scientific review/);
});

test('PDF replacement invalidates proposal approval even when metadata is unchanged and no notifier ran',async()=>{
  const h=harness(),p=h.host.papers.get(1)!;p.abstract='';p.fingerprint=paperFingerprint(p);
  const quote=`${EIS} resolves electrode losses in this PDF.`;h.host.pdfs.set(1,quote);
  h.ai.handler=call=>call.kind==='facts'?{summary:'EIS measurements.',concepts:[{name:EIS,facet:'method',evidence:[{source:'pdf',text:quote}]}],needsPDF:false}:{tags:[{key:'eis',name:'EIS',fullName:EIS,description:'Impedance spectroscopy measurements.',facet:'method',aliases:[],parentKeys:[],relatedKeys:[],support:[{paperId:'1:P1',conceptNames:[EIS]}]}],merges:[],excluded:[]};
  await run(h);assert.deepEqual(h.state.taxonomyProposal!.issues,[]);
  assert.notEqual(h.state.taxonomyProposal!.paperFingerprints!['1:P1'],h.state.taxonomyProposal!.paperInputFingerprints!['1:P1']);
  h.host.pdfs.set(1,'Replacement PDF contains unrelated battery measurements.');
  await assert.rejects(h.controller.invoke('approve-taxonomy',{id:h.state.taxonomyProposal!.id}),/PDF evidence changed/);
  assert.equal(h.state.taxonomyReady,false);assert.equal(h.host.writes.length,0);
});
