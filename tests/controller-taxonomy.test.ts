import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,migrateState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import {paperFingerprint,fingerprint} from '../src/core.ts';
import type {LibraryHost,NativeTag,TagPatch} from '../src/platform.ts';
import {sameTags} from '../src/platform.ts';
import type {CompletionResult,ProviderSettings} from '../src/providers.ts';
import {normalizeFacts} from '../src/taxonomy.ts';

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
type Call={data:any;settings:ProviderSettings;kind:'facts'|'taxonomy'|'correction'|'assignment'};
function factsResponse(data:any){const p=data.paper,family=p.abstract.includes(PEM)?PEM:AEM;return {summary:`${family} studied with EIS`,concepts:[{name:family,facet:'system',evidence:[{source:'abstract',text:p.abstract}]},{name:EIS,facet:'method',evidence:[{source:'abstract',text:p.abstract}]}],needsPDF:false};}
function taxonomyResponse(data:any){
  const supports=(name:string)=>data.protocolVersion===2?{supportRegistryIds:(data.conceptRegistry as any[]).filter(entry=>entry.sources.some((source:any)=>source.label===name)).map(entry=>entry.registryId)}:{support:(data.facts as any[]).filter(f=>f.concepts.some((c:any)=>c.name===name)).map(f=>({paperId:f.paperId,conceptNames:[name]}))};
  const hasSupport=(name:string)=>Object.values(supports(name)).some((values:any)=>values.length>0);
  const entry=(key:string,name:string,fullName:string,extra:any={})=>({key,name,fullName,description:`Definition of ${fullName}`,facet:'system',aliases:[],parentKeys:[],relatedKeys:[],...(data.protocolVersion===2?{supportRegistryIds:[]}:{support:[]}),...extra});
  return {tags:[entry('fc','FC','Fuel cell'),...(hasSupport(PEM)?[entry('pem','PEMFC',PEM,{parentKeys:['fc'],...supports(PEM)})]:[]),...(hasSupport(AEM)?[entry('aem','AEMFC',AEM,{parentKeys:['fc'],...supports(AEM)})]:[]),entry('eis','EIS',EIS,{facet:'method',...supports(EIS)})],merges:[],excluded:[]};
}
function assignmentResponse(data:any){return {summary:'Classification of supported systems and methods.',concepts:[],needsPDF:false,newTagCandidates:[],suggestions:data.approvedVocabulary.filter((t:any)=>t.name==='FC'||t.facet!=='system'||data.paper.abstract.toLowerCase().includes(t.fullName.toLowerCase())).map((t:any)=>({tagId:t.id,reason:'The source directly supports this scientific concept.',confidence:'high',match:'substantive',evidence:[{source:'abstract',text:data.paper.abstract}]}))};}
class AI {
  calls:Call[]=[];
  handler:(call:Call)=>unknown|Promise<unknown>=call=>call.kind==='facts'?factsResponse(call.data):call.kind==='taxonomy'?taxonomyResponse(call.data):call.kind==='correction'?{repairs:[]}:assignmentResponse(call.data);
  async completeJson(_s:string,prompt:string,settings:ProviderSettings):Promise<CompletionResult>{const marker='INPUT_DATA_JSON:\n',data=JSON.parse(prompt.slice(prompt.indexOf(marker)+marker.length)),kind=data.protocolVersion===2||data.facts?'taxonomy':data.permittedRegistry?'correction':data.approvedVocabulary?'assignment':'facts';const call:Call={data,settings:copy(settings),kind};this.calls.push(call);const value=await this.handler(call);return {value,text:JSON.stringify(value),usage:{inputTokens:100,outputTokens:50},usageKnown:true,estimatedCostUSD:null};}
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
  assert.equal(h.ai.calls.filter(c=>c.kind==='taxonomy').length,1,'An unchanged approved taxonomy must not send a new consolidation request');assert.equal(h.state.tags.filter(t=>!t.custom).length,4);
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
  await assert.rejects(h.controller.invoke('approve-taxonomy',{id:h.state.taxonomyProposal!.id}),/limit|proposal evidence issues/);
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

function proposalDocument(h:Harness){return {format:'zotero-smart-tags-proposal',schemaVersion:3,sourceVocabularyFingerprint:fingerprint(h.state.tags),proposal:copy(h.state.taxonomyProposal!),facts:copy(Object.values(h.state.facts))};}

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
  const source=harness();await run(source);const document=proposalDocument(source);document.proposal.issues=['A direct support concept needs scientific review.'];document.proposal.externalIssues=[...document.proposal.issues];
  const target=harness();await target.controller.invoke('scan',{scope:'library'});await target.controller.invoke('import-vocabulary',{value:document});
  assert.ok(target.state.taxonomyProposal!.issues.includes(document.proposal.issues[0]));
  await assert.rejects(target.controller.invoke('approve-taxonomy',{id:target.state.taxonomyProposal!.id}),/scientific review/);
});

test('PDF replacement invalidates proposal approval even when metadata is unchanged and no notifier ran',async()=>{
  const h=harness(),p=h.host.papers.get(1)!;p.abstract='';p.fingerprint=paperFingerprint(p);
  const quote=`${EIS} resolves electrode losses in this PDF.`;h.host.pdfs.set(1,quote);
  h.ai.handler=call=>call.kind==='facts'?{summary:'EIS measurements.',concepts:[{name:EIS,facet:'method',evidence:[{source:'pdf',text:quote}]}],needsPDF:false}:{tags:[{key:'eis',name:'EIS',fullName:EIS,description:'Impedance spectroscopy measurements.',facet:'method',aliases:[],parentKeys:[],relatedKeys:[],...(call.data.protocolVersion===2?{supportRegistryIds:call.data.conceptRegistry.map((entry:any)=>entry.registryId)}:{support:[{paperId:'1:P1',conceptNames:[EIS]}]})}],merges:[],excluded:[]};
  await run(h);assert.deepEqual(h.state.taxonomyProposal!.issues,[]);
  assert.notEqual(h.state.taxonomyProposal!.paperFingerprints!['1:P1'],h.state.taxonomyProposal!.paperInputFingerprints!['1:P1']);
  h.host.pdfs.set(1,'Replacement PDF contains unrelated battery measurements.');
  await assert.rejects(h.controller.invoke('approve-taxonomy',{id:h.state.taxonomyProposal!.id}),/PDF evidence changed/);
  assert.equal(h.state.taxonomyReady,false);assert.equal(h.host.writes.length,0);
});

test('unaccepted drafts and a prior unapproved review are replaced without carrying model merge IDs forward',async()=>{
  const h=harness(50);h.state.tags.push(...Array.from({length:106},(_,i)=>tag(`draft-${i}`,`Unaccepted topic ${i}`)));
  h.ai.handler=call=>{if(call.kind==='facts')return factsResponse(call.data);const raw=taxonomyResponse(call.data);raw.merges=[{fromId:'tag-714a5d4e61ef0e6a',toKey:'fc'}] as any;return raw;};
  await run(h,'rebuild','pilot');assert.equal(h.state.run?.status,'idle');assert.deepEqual(h.state.taxonomyProposal?.unresolvedMerges??[],[]);
  const extractionCount=h.ai.calls.filter(call=>call.kind==='facts').length,requestCount=h.ai.calls.length;
  const review=h.state.taxonomyProposal!;review.tags[0].description='Unaccepted previous review edit';
  await run(h,'rebuild','pilot');assert.equal(h.state.run?.status,'idle');assert.notEqual(h.state.taxonomyProposal!.tags[0].description,'Unaccepted previous review edit');
  assert.equal(h.ai.calls.filter(call=>call.kind==='facts').length,extractionCount);assert.equal(h.ai.calls.length,requestCount);
  const input=h.ai.calls.find(call=>call.kind==='taxonomy')!.data;assert.deepEqual(input.mergeSourceIds,[]);assert.ok(input.draftCandidates.every((candidate:any)=>!('id' in candidate)));
  assert.equal(h.state.tags.length,107);assert.equal(h.host.writes.length,0);
});

test('a completed consolidation checkpoint resumes after interruption without a second provider request',async()=>{
  const h=harness(3);await run(h);assert.ok(h.state.run?.consolidation);
  const restored=copy(h.state);restored.taxonomyProposal=null;restored.run!.status='paused';restored.run!.vocabFinished=false;
  const ai=new AI();ai.handler=()=>{throw new Error('Cached consolidation must not call a provider');};
  const controller=new AppController(restored,{host:h.host,ai,persist:async()=>{}});
  await controller.invoke('resume');await controller.waitForIdle();
  assert.equal(restored.run?.status,'idle');assert.ok(restored.taxonomyProposal);assert.equal(ai.calls.length,0);assert.equal(h.host.writes.length,0);
});

test('invalid approved-identity merges stay blocked through edits until explicitly discarded without AI calls',async()=>{
  const h=harness(2);h.state.tags.push(tag('approved-fc','FC',{status:'approved',fullName:'Fuel cell'}));
  h.state.decisions['1:P1|approved-fc']={rejected:true};
  h.ai.handler=call=>{if(call.kind==='facts')return factsResponse(call.data);const raw=taxonomyResponse(call.data);raw.merges=[{fromId:'approved-fc',toKey:'missing-target'}] as any;return raw;};
  await run(h);const proposal=h.state.taxonomyProposal!,calls=h.ai.calls.length;
  assert.equal(h.state.run?.status,'idle');assert.equal(proposal.unresolvedMerges?.length,1);
  await assert.rejects(h.controller.invoke('approve-taxonomy',{id:proposal.id}),/invalid merge/);
  proposal.tags.find(t=>t.name==='EIS')!.description='A manually reviewed EIS definition.';
  await h.controller.invoke('save-taxonomy-proposal',{id:proposal.id,tags:proposal.tags});
  await assert.rejects(h.controller.invoke('approve-taxonomy',{id:proposal.id}),/invalid merge|uncertain|evidence/);
  const eis=proposal.tags.find(t=>t.name==='EIS')!;
  await h.controller.invoke('confirm-taxonomy-mapping',{id:proposal.id,tagId:eis.id});
  await assert.rejects(h.controller.invoke('approve-taxonomy',{id:proposal.id}),/invalid merge/);
  await h.controller.invoke('discard-invalid-merges',{id:proposal.id});
  const resolved=h.state.taxonomyProposal!;assert.deepEqual(resolved.unresolvedMerges??[],[]);assert.deepEqual(resolved.issues,[]);
  assert.equal(resolved.tags.find(t=>t.name==='FC')!.id,'approved-fc');assert.equal(resolved.tags.find(t=>t.name==='EIS')!.description,'A manually reviewed EIS definition.');
  assert.equal(h.state.decisions['1:P1|approved-fc'].rejected,true);assert.equal(h.ai.calls.length,calls);assert.equal(h.host.writes.length,0);
  await h.controller.invoke('approve-taxonomy',{id:resolved.id});assert.equal(h.state.decisions['1:P1|approved-fc'].rejected,true);assert.equal(h.host.writes.length,0);
});

test('remembered choices protect edited draft identities from replacement-only merge handling',async()=>{
  const h=harness();h.state.tags.push(tag('remembered-fc','FC',{fullName:'Fuel cell',aliases:['An unapproved hypothesis']}));
  h.state.decisions['1:P1|remembered-fc']={locked:true};
  await run(h);const input=h.ai.calls.find(call=>call.kind==='taxonomy')!.data;
  assert.ok(input.mergeSourceIds.includes('remembered-fc'));assert.ok(!input.existingVocabulary.find((t:any)=>t.id==='remembered-fc').aliases.includes('An unapproved hypothesis'));
  assert.equal(h.state.decisions['1:P1|remembered-fc'].locked,true);assert.equal(h.host.writes.length,0);
});

test('a new rebuild can replace a paused unaccepted rebuild while reusing its completed analysis',async()=>{
  const h=harness(3);await run(h);const calls=h.ai.calls.length;
  h.state.taxonomyProposal!.tags[0].description='Previous unaccepted draft';
  await h.controller.invoke('pause');assert.equal(h.state.run?.status,'paused');
  await run(h);assert.equal(h.state.run?.status,'idle');assert.equal(h.ai.calls.length,calls);
  assert.notEqual(h.state.taxonomyProposal!.tags[0].description,'Previous unaccepted draft');assert.equal(h.host.writes.length,0);
});

function invalidReferenceResponse(data:any){const raw=taxonomyResponse(data);raw.tags.find((candidate:any)=>candidate.key==='eis')!.supportRegistryIds.push('unpermitted-registry');return raw;}
function repairedReferences(data:any){return {repairs:data.candidates.filter((candidate:any)=>candidate.name==='EIS').map((candidate:any)=>({tagId:candidate.id,supportRegistryIds:data.permittedRegistry.filter((entry:any)=>entry.sources.some((source:any)=>source.name===EIS)).map((entry:any)=>entry.registryId)}))};}

test('v3 consolidation makes exactly one reference correction with the selected provider and persistent identities',async()=>{
  const h=harness(3);h.ai.handler=call=>call.kind==='facts'?factsResponse(call.data):call.kind==='taxonomy'?invalidReferenceResponse(call.data):call.kind==='correction'?repairedReferences(call.data):assignmentResponse(call.data);
  await run(h);const proposal=h.state.taxonomyProposal!,checkpoint=h.state.run!.consolidation!;
  assert.equal(checkpoint.protocolVersion,2);assert.equal(checkpoint.correctionAttempts,1);assert.equal(checkpoint.phase,'ready');assert.deepEqual(proposal.issues,[]);
  assert.equal(h.ai.calls.filter(call=>call.kind==='facts').length,3);assert.equal(h.ai.calls.filter(call=>call.kind==='taxonomy').length,1);assert.equal(h.ai.calls.filter(call=>call.kind==='correction').length,1);
  const correction=h.ai.calls.find(call=>call.kind==='correction')!;assert.equal(correction.settings.mode,'chatgpt');assert.equal(correction.settings.model,'test-model');
  for(const candidate of correction.data.candidates)assert.ok(proposal.tags.some(tag=>tag.id===candidate.id));
  assert.ok(checkpoint.value);assert.ok(checkpoint.correctionValue);assert.equal(h.host.writes.length,0);
});

test('exhausted reference correction retains diagnostics and restart cannot reset its attempt',async()=>{
  const h=harness(2);h.ai.handler=call=>call.kind==='facts'?factsResponse(call.data):call.kind==='taxonomy'?invalidReferenceResponse(call.data):{repairs:[]};
  await run(h);const proposal=h.state.taxonomyProposal!;assert.ok(proposal.issues.length);assert.equal(h.state.run!.consolidation!.correctionAttempts,1);
  await assert.rejects(h.controller.invoke('approve-taxonomy',{id:proposal.id}),/registry|correction|support|diagnostic|evidence/i);
  const restored=copy(h.state);restored.run!.status='paused';restored.run!.vocabFinished=false;restored.taxonomyProposal=null;
  const ai=new AI();ai.handler=()=>{throw new Error('An exhausted correction must not call the provider after restart');};
  const controller=new AppController(restored,{host:h.host,ai,persist:async()=>{}});await controller.initialize();await controller.invoke('resume');await controller.waitForIdle();
  assert.equal(ai.calls.length,0);assert.equal(restored.run!.consolidation!.correctionAttempts,1);assert.ok(restored.taxonomyProposal!.issues.length);assert.equal(h.host.writes.length,0);
});

test('manual removal of an unsupported link makes an exhausted correction actionable while retaining its diagnostics',async()=>{
  const h=harness();h.ai.handler=call=>call.kind==='facts'?factsResponse(call.data):call.kind==='taxonomy'?invalidReferenceResponse(call.data):{repairs:[]};
  await run(h);const proposal=h.state.taxonomyProposal!,id=proposal.tags.find(tag=>tag.name==='EIS')!.id,calls=h.ai.calls.length;
  assert.ok(proposal.correctionDiagnostics!.length);await h.controller.invoke('remove-taxonomy-support',{id:proposal.id,tagId:id,registryId:'unpermitted-registry'});
  assert.deepEqual(proposal.issues,[]);assert.ok(proposal.correctionDiagnostics!.length);assert.equal(h.ai.calls.length,calls);
  await h.controller.invoke('approve-taxonomy',{id:proposal.id});assert.equal(h.state.taxonomyReady,true);assert.equal(h.host.writes.length,0);
});

test('explicit regeneration starts a fresh bounded correction generation while reusing all factual records',async()=>{
  const h=harness();let regenerating=false;h.ai.handler=call=>call.kind==='facts'?factsResponse(call.data):call.kind==='taxonomy'?(regenerating?taxonomyResponse(call.data):invalidReferenceResponse(call.data)):{repairs:[]};
  await run(h);const originalGeneration=h.state.run!.consolidation!.generationId,facts=JSON.stringify(h.state.facts),proposalId=h.state.taxonomyProposal!.id;
  regenerating=true;await h.controller.invoke('regenerate-taxonomy',{id:proposalId});await h.controller.waitForIdle();
  assert.notEqual(h.state.run!.consolidation!.generationId,originalGeneration);assert.equal(h.state.run!.consolidation!.correctionAttempts,0);assert.deepEqual(h.state.taxonomyProposal!.issues,[]);assert.equal(JSON.stringify(h.state.facts),facts);
  assert.equal(h.ai.calls.filter(call=>call.kind==='facts').length,1);assert.equal(h.ai.calls.filter(call=>call.kind==='taxonomy').length,2);assert.equal(h.ai.calls.filter(call=>call.kind==='correction').length,1);assert.equal(h.host.writes.length,0);
});

test('budget rejection before correction dispatch leaves the single attempt available for Resume',async()=>{
  const h=harness();h.state.settings={...h.state.settings,provider:'api',inputPricePerMillion:1,outputPricePerMillion:1,budgetUSD:5};
  h.ai.handler=call=>{
    if(call.kind==='facts')return factsResponse(call.data);
    if(call.kind==='taxonomy'){h.state.run!.settings.budgetUSD=h.state.run!.spentUSD;return invalidReferenceResponse(call.data);}
    return repairedReferences(call.data);
  };
  await run(h);assert.equal(h.state.run!.status,'paused');assert.equal(h.state.run!.consolidation!.correctionAttempts,0);assert.equal(h.ai.calls.filter(call=>call.kind==='correction').length,0);assert.ok(h.state.taxonomyProposal);
  await h.controller.invoke('save-settings',{settings:{...h.state.settings,budgetUSD:5}});await h.controller.invoke('resume');await h.controller.waitForIdle();
  assert.equal(h.ai.calls.filter(call=>call.kind==='facts').length,1);assert.equal(h.ai.calls.filter(call=>call.kind==='taxonomy').length,1);assert.equal(h.ai.calls.filter(call=>call.kind==='correction').length,1);
  assert.equal(h.state.run!.consolidation!.correctionAttempts,1);assert.deepEqual(h.state.taxonomyProposal!.issues,[]);
});

test('persistence failure before correction dispatch rolls back the attempt and reservation so Resume can dispatch once',async()=>{
  const h=harness();h.state.settings={...h.state.settings,provider:'api',inputPricePerMillion:1,outputPricePerMillion:1,budgetUSD:5};
  h.ai.handler=call=>call.kind==='facts'?factsResponse(call.data):call.kind==='taxonomy'?invalidReferenceResponse(call.data):repairedReferences(call.data);
  let failCorrectionWrite=true,lastSavedSpent=0,spentBeforeFailure=0,rejectedReservation=0,failedWrites=0;
  const saved:AppState[]=[],controller=new AppController(h.state,{host:h.host,ai:h.ai,persist:async state=>{
    const run=state.run;
    if(failCorrectionWrite&&run?.consolidation?.phase==='correcting'&&run.consolidation.correctionAttempts===1){
      failCorrectionWrite=false;failedWrites++;spentBeforeFailure=lastSavedSpent;rejectedReservation=run.spentUSD-lastSavedSpent;assert.ok(rejectedReservation>0);throw new Error('Synthetic atomic state write failure before provider dispatch');
    }
    lastSavedSpent=run?.spentUSD??0;saved.push(copy(state));
  }});
  await controller.invoke('rebuild',{scope:'library'});await controller.waitForIdle();
  assert.equal(failedWrites,1);assert.equal(h.state.run!.status,'paused');assert.equal(h.state.run!.consolidation!.correctionAttempts,0);assert.equal(h.state.run!.consolidation!.phase,'validating');assert.equal(h.ai.calls.filter(call=>call.kind==='correction').length,0);
  assert.equal(h.state.run!.spentUSD,spentBeforeFailure);assert.equal(saved.at(-1)!.run!.spentUSD,spentBeforeFailure);assert.equal(saved.at(-1)!.run!.consolidation!.correctionAttempts,0);assert.ok(h.state.taxonomyProposal);
  await controller.invoke('resume');await controller.waitForIdle();assert.equal(h.state.run!.consolidation!.correctionAttempts,1);assert.equal(h.ai.calls.filter(call=>call.kind==='correction').length,1);assert.equal(h.ai.calls.filter(call=>call.kind==='facts').length,1);assert.equal(h.ai.calls.filter(call=>call.kind==='taxonomy').length,1);assert.deepEqual(h.state.taxonomyProposal!.issues,[]);
  assert.ok(Math.abs(h.state.run!.spentUSD-spentBeforeFailure-rejectedReservation)<1e-12);assert.equal(h.host.writes.length,0);
});

test('authentication failure after correction dispatch consumes the attempt and survives Resume',async()=>{
  const h=harness();h.ai.handler=call=>{if(call.kind==='facts')return factsResponse(call.data);if(call.kind==='taxonomy')return invalidReferenceResponse(call.data);throw new Error('OpenAI authentication HTTP 401');};
  await run(h);assert.equal(h.state.run!.consolidation!.correctionAttempts,1);assert.equal(h.ai.calls.filter(call=>call.kind==='correction').length,1);assert.ok(h.state.taxonomyProposal);
  const factsBefore=JSON.stringify(h.state.facts);await h.controller.invoke('resume');await h.controller.waitForIdle();
  assert.equal(h.ai.calls.filter(call=>call.kind==='correction').length,1);assert.equal(JSON.stringify(h.state.facts),factsBefore);assert.ok(h.state.taxonomyProposal!.issues.length);assert.equal(h.host.writes.length,0);
});

test('cancelling a dispatched correction retains its attempt across restart',async()=>{
  const h=harness();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  h.ai.handler=async call=>{if(call.kind==='facts')return factsResponse(call.data);if(call.kind==='taxonomy')return invalidReferenceResponse(call.data);entered();await gate;throw new DOMException('Cancelled correction','AbortError');};
  await h.controller.invoke('rebuild',{scope:'library'});await started;assert.equal(h.state.run!.consolidation!.correctionAttempts,1);
  await h.controller.invoke('cancel');release();await h.controller.waitForIdle();const restored=copy(h.state);restored.run!.status='paused';restored.run!.vocabFinished=false;
  const ai=new AI();ai.handler=()=>{throw new Error('Cancelled dispatched corrections cannot be retried automatically');};const controller=new AppController(restored,{host:h.host,ai,persist:async()=>{}});
  await controller.invoke('resume');await controller.waitForIdle();assert.equal(ai.calls.length,0);assert.equal(restored.run!.consolidation!.correctionAttempts,1);assert.equal(h.host.writes.length,0);
});

test('uncertain mappings wait for explicit per-tag confirmation instead of spending the correction attempt',async()=>{
  const h=harness();h.ai.handler=call=>{
    if(call.kind==='facts')return {summary:'Proton transport resistance is studied.',concepts:[{name:'catalyst-layer proton resistance',facet:'phenomenon',evidence:[{source:'abstract',text:call.data.paper.abstract}]}],needsPDF:false};
    if(call.kind==='taxonomy')return {tags:[{key:'r','name':'protonic resistance',fullName:'protonic resistance',description:'Protonic resistance in a catalyst layer.',facet:'phenomenon',aliases:['catalyst-layer proton resistance'],supportRegistryIds:call.data.conceptRegistry.map((entry:any)=>entry.registryId)}],merges:[],excluded:[]};
    throw new Error('Uncertainty must be resolved by the user');
  };
  await run(h);const proposal=h.state.taxonomyProposal!,id=proposal.tags.find(tag=>!tag.custom)!.id;
  assert.equal(h.state.run!.consolidation!.correctionAttempts,0);assert.equal(h.ai.calls.filter(call=>call.kind==='correction').length,0);assert.ok(proposal.issues.length);
  await assert.rejects(h.controller.invoke('approve-taxonomy',{id:proposal.id}),/Confirm|meaning|review/i);
  await h.controller.invoke('confirm-taxonomy-mapping',{id:proposal.id,tagId:id});assert.deepEqual(proposal.issues,[]);assert.deepEqual(proposal.support[id].paperIds,['1:P1']);
  const before=copy(proposal.support[id]),identity=proposal.tags.find(tag=>tag.id===id)!.id;proposal.tags.find(tag=>tag.id===id)!.name='Reviewed resistance';
  await h.controller.invoke('save-taxonomy-proposal',{id:proposal.id,tags:proposal.tags});assert.deepEqual(proposal.support[id],before);assert.equal(proposal.tags.find(tag=>tag.id===id)!.id,identity);
  await h.controller.invoke('approve-taxonomy',{id:proposal.id});assert.equal(h.state.taxonomyReady,true);assert.equal(h.host.writes.length,0);
});

test('schema3 migration resumes 51 completed selected jobs without extracting any of 97 retained facts again',async()=>{
  const h=harness(97),legacy:any=copy(h.state);legacy.schemaVersion=2;delete legacy.evidenceCatalog;delete legacy.taxonomyEvidence;legacy.warnings=['Historical PDF warning'];
  for(const source of h.host.papers.values()){
    legacy.papers[source.id]=copy(source);const facts=normalizeFacts(factsResponse({paper:source}),source,'chatgpt','test-model');for(const concept of facts.concepts)delete concept.factConceptId;legacy.facts[source.id]=facts;
  }
  const selected=[...h.host.papers.values()].slice(0,51);legacy.run={id:'legacy-selected-51',kind:'rebuild',scope:'selected',automatic:false,status:'paused',jobs:selected.map((paper,i)=>({id:`legacy-job-${i}`,paperId:paper.id,status:'completed'})),vocabCursor:0,vocabFinished:false,message:'Unknown supporting registry concept: Anion exchange membrane water electrolyzers (AEMWEs).',spentUSD:1.75,settings:copy(legacy.settings),vocabularyVersion:0,consolidation:{inputFingerprint:'old-name-protocol',value:{tags:[]},failed:true}};
  const originalFacts=copy(legacy.facts),migrated=migrateState(legacy);assert.equal(validState(migrated),true);assert.equal(migrated.schemaVersion,3);assert.equal(migrated.run!.jobs.filter(job=>job.status==='completed').length,51);assert.equal(migrated.run!.consolidation,undefined);
  assert.equal(Object.keys(migrated.facts).length,97);assert.equal(migrated.run!.spentUSD,1.75);assert.deepEqual(migrated.settings,legacy.settings);assert.equal(migrateState(migrated),migrated);
  const ai=new AI();ai.handler=call=>{if(call.kind==='facts')throw new Error('Migration Resume must reuse the completed factual extraction');return taxonomyResponse(call.data);};
  const controller=new AppController(migrated,{host:h.host,ai,persist:async()=>{}});await controller.invoke('resume');await controller.waitForIdle();
  assert.equal(ai.calls.filter(call=>call.kind==='facts').length,0);assert.equal(ai.calls.filter(call=>call.kind==='taxonomy').length,1);assert.equal(migrated.run!.spentUSD,1.75);
  const snapshot=migrated.taxonomyProposal!.evidenceSnapshot!;assert.equal(snapshot.paperIds.length,51);assert.deepEqual(new Set(snapshot.paperIds),new Set(selected.map(paper=>paper.id)));assert.ok(Object.values(snapshot.sources).every(source=>snapshot.paperIds.includes(source.paperId)));
  for(const [id,facts] of Object.entries(migrated.facts)){const restored=copy(facts);for(const concept of restored.concepts)delete concept.factConceptId;assert.deepEqual(restored,originalFacts[id]);}
  assert.equal(h.host.writes.length,0);
});

function uncertainHarness(){
  const h=harness();h.ai.handler=call=>{
    if(call.kind==='facts')return {summary:'Proton transport resistance is studied.',concepts:[{name:'catalyst-layer proton resistance',facet:'phenomenon',evidence:[{source:'abstract',text:call.data.paper.abstract}]}],needsPDF:false};
    if(call.kind==='taxonomy')return {tags:[{key:'resistance',name:'protonic resistance',fullName:'protonic resistance',description:'Protonic resistance in a catalyst layer.',facet:'phenomenon',aliases:['catalyst-layer proton resistance'],supportRegistryIds:call.data.conceptRegistry.map((entry:any)=>entry.registryId)}],merges:[],excluded:[]};
    throw new Error('A user must confirm this scientific equivalence.');
  };return h;
}

test('bulk mapping confirmation saves once without approving vocabulary, requesting AI, or changing native and manual choices',async()=>{
  const h=uncertainHarness();h.host.native.set(1,[{tag:'Manual project',type:0}]);await run(h);
  const proposal=h.state.taxonomyProposal!,tagId=proposal.tags.find(tag=>!tag.custom)!.id;
  h.state.decisions['1:P1|custom-rcl']={locked:true,rejected:true};
  const choices=copy(h.state.decisions),active=copy(h.state.tags),calls=h.ai.calls.length,saves=h.saved.length;
  await h.controller.invoke('confirm-all-taxonomy-mappings',{id:proposal.id,tagIds:[tagId]});
  assert.ok(proposal.mappingConfirmations?.[tagId]);assert.deepEqual(proposal.issues,[]);
  assert.equal(h.saved.length,saves+1);assert.equal(h.ai.calls.length,calls);assert.equal(h.host.writes.length,0);
  assert.equal(h.state.taxonomyReady,false);assert.deepEqual(h.state.tags,active);assert.deepEqual(h.state.decisions,choices);
  assert.deepEqual(await h.host.readTags(1),[{tag:'Manual project',type:0}]);
  assert.deepEqual(h.saved.at(-1)!.taxonomyProposal!.mappingConfirmations,proposal.mappingConfirmations);
});

test('bulk confirmation rejects stale proposals and selections before saving any partial review',async()=>{
  const h=uncertainHarness();await run(h);const proposal=h.state.taxonomyProposal!,before=copy(proposal),saves=h.saved.length;
  await assert.rejects(h.controller.invoke('confirm-all-taxonomy-mappings',{id:'old-proposal',tagIds:[]}),/proposal changed/);
  await assert.rejects(h.controller.invoke('confirm-all-taxonomy-mappings',{id:proposal.id,tagIds:[proposal.tags.find(tag=>!tag.custom)!.id,'missing-concept']}),/Unknown|stale|changed/i);
  await assert.rejects(h.controller.invoke('confirm-all-taxonomy-mappings',{id:proposal.id,tagIds:'all'}),/Choose the proposed concepts/);
  assert.equal(h.saved.length,saves);assert.deepEqual(h.state.taxonomyProposal,before);assert.equal(h.host.writes.length,0);
});

test('removing a staged concept clears its hierarchy and detail contexts without changing active or native tags',async()=>{
  const h=harness(2);h.host.native.set(1,[{tag:'Manual FC collection',type:0}]);await run(h);
  const proposal=h.state.taxonomyProposal!,fc=proposal.tags.find(tag=>tag.name==='FC')!,detail=proposal.tags.find(tag=>tag.custom)!;
  detail.relatedIds=[fc.id];const active=copy(h.state.tags),calls=h.ai.calls.length;
  const tags=proposal.tags.filter(tag=>tag.id!==fc.id).map(tag=>({...tag,broaderIds:tag.broaderIds.filter(id=>id!==fc.id),relatedIds:(tag.relatedIds??[]).filter(id=>id!==fc.id)}));
  await h.controller.invoke('save-taxonomy-proposal',{id:proposal.id,tags,excluded:[{name:fc.name,reason:'Removed during review.'}]});
  assert.ok(!proposal.tags.some(tag=>tag.id===fc.id));assert.ok(proposal.tags.some(tag=>tag.id===detail.id&&tag.custom));
  assert.deepEqual(proposal.issues,[]);assert.deepEqual(h.state.tags,active);assert.equal(h.ai.calls.length,calls);assert.equal(h.host.writes.length,0);
  assert.deepEqual(await h.host.readTags(1),[{tag:'Manual FC collection',type:0}]);
});

test('explicit proposal export carries exact evidence identities while vocabulary export contains definitions only',async()=>{
  const h=harness(2);await run(h,'rebuild','selected');const documents:any[]=[],controller=new AppController(h.state,{host:h.host,ai:h.ai,persist:async()=>{},exportFile:async value=>{documents.push(copy(value));}}),proposal=h.state.taxonomyProposal!;
  await controller.invoke('export-vocabulary');const definitions=documents[0];assert.equal(definitions.format,'zotero-smart-tags-vocabulary');assert.equal(definitions.schemaVersion,3);assert.ok(definitions.tags);assert.equal(definitions.facts,undefined);assert.equal(definitions.proposal,undefined);assert.equal(definitions.evidenceSnapshot,undefined);
  await controller.invoke('export-taxonomy-proposal',{id:proposal.id});const document=documents[1];assert.equal(document.format,'zotero-smart-tags-proposal');assert.equal(document.schemaVersion,3);assert.equal(document.sourceVocabularyFingerprint,fingerprint(h.state.tags));
  assert.equal(document.facts.length,1);assert.equal(document.facts[0].paperId,'1:P1');assert.deepEqual(document.proposal.evidenceSnapshot,proposal.evidenceSnapshot);assert.deepEqual(document.proposal.support,proposal.support);
  assert.deepEqual(document.facts[0].concepts.map((concept:any)=>concept.factConceptId),h.state.facts['1:P1'].concepts.map(concept=>concept.factConceptId));assert.equal(h.host.writes.length,0);
});

test('approved mapping reviews and ID links survive state persistence, archival, and reviewed restoration',async()=>{
  const h=uncertainHarness();await run(h);let proposal=h.state.taxonomyProposal!,tagId=proposal.tags.find(tag=>!tag.custom)!.id;
  await h.controller.invoke('confirm-taxonomy-mapping',{id:proposal.id,tagId});const firstSnapshot=copy(proposal.evidenceSnapshot!),firstSupport=copy(proposal.support),firstConfirmations=copy(proposal.mappingConfirmations!);
  await h.controller.invoke('approve-taxonomy',{id:proposal.id});assert.deepEqual(h.state.taxonomyReview!.mappingConfirmations,firstConfirmations);assert.deepEqual(h.saved.at(-1)!.taxonomyReview,h.state.taxonomyReview);assert.deepEqual(h.state.taxonomySupport,firstSupport);
  await h.controller.invoke('regenerate-taxonomy');await h.controller.waitForIdle();proposal=h.state.taxonomyProposal!;tagId=proposal.tags.find(tag=>!tag.custom)!.id;
  await h.controller.invoke('confirm-taxonomy-mapping',{id:proposal.id,tagId});await h.controller.invoke('approve-taxonomy',{id:proposal.id});
  const archive=h.state.taxonomyArchives[0];assert.deepEqual(archive.evidenceSnapshot,firstSnapshot);assert.deepEqual(archive.support,firstSupport);assert.deepEqual(archive.review!.mappingConfirmations,firstConfirmations);
  await h.controller.invoke('restore-taxonomy',{id:archive.id});const restored=h.state.taxonomyProposal!;assert.equal(restored.protocolVersion,2);assert.deepEqual(restored.evidenceSnapshot,firstSnapshot);assert.deepEqual(restored.support,firstSupport);assert.deepEqual(restored.mappingConfirmations,firstConfirmations);assert.deepEqual(restored.issues,[]);
  await h.controller.invoke('approve-taxonomy',{id:restored.id});assert.deepEqual(h.state.taxonomyEvidence,firstSnapshot);assert.deepEqual(h.state.taxonomySupport,firstSupport);assert.deepEqual(h.state.taxonomyReview!.mappingConfirmations,firstConfirmations);assert.equal(h.host.writes.length,0);
});

test('restoration checks original fingerprints even for selected papers with zero validated factual concepts',async()=>{
  const h=harness(2);h.ai.handler=call=>call.kind==='facts'&&call.data.paper.title.endsWith('2')?{summary:'No source-grounded concepts available.',concepts:[],needsPDF:false}:call.kind==='facts'?factsResponse(call.data):taxonomyResponse(call.data);
  await publish(h);const snapshot=copy(h.state.taxonomyEvidence!);assert.ok(snapshot.paperIds.includes('1:P2'));assert.ok(Object.values(snapshot.sources).every(source=>source.paperId!=='1:P2'));
  h.state.taxonomyArchives.unshift({id:'reviewed-archive',date:'2026-10-28T00:00:00.000Z',version:h.state.vocabularyVersion,tags:copy(h.state.tags),redirects:copy(h.state.taxonomyRedirects),reason:'Synthetic archive fixture',evidenceSnapshot:snapshot,support:copy(h.state.taxonomySupport),review:copy(h.state.taxonomyReview!)});
  await h.controller.invoke('restore-taxonomy',{id:'reviewed-archive'});assert.equal(h.state.taxonomyProposal!.paperFingerprints!['1:P2'],h.state.facts['1:P2'].metadataFingerprint);
  h.host.papers.get(2)!.abstract='New metadata now describes an unrelated battery study.';
  await assert.rejects(h.controller.invoke('approve-taxonomy',{id:h.state.taxonomyProposal!.id}),/metadata changed|source paper/i);assert.equal(h.host.writes.length,0);
});

test('imported forged verification caches cannot authorize a Co to CO scientific contradiction',async()=>{
  const source=harness(),paper=source.host.papers.get(1)!;paper.abstract='Co nanoparticles form a cobalt catalyst in this experiment.';paper.fingerprint=paperFingerprint(paper);
  source.ai.handler=call=>call.kind==='facts'?{summary:'A cobalt catalyst is studied.',concepts:[{name:'Co',facet:'component',evidence:[{source:'abstract',text:call.data.paper.abstract}]}],needsPDF:false}:{tags:[{key:'co',name:'Co',fullName:'cobalt',description:'Cobalt catalyst components.',facet:'component',aliases:[],supportRegistryIds:call.data.conceptRegistry.map((entry:any)=>entry.registryId)}],merges:[],excluded:[]};
  await run(source);const document=proposalDocument(source),proposal=document.proposal,tag=proposal.tags.find(tag=>!tag.custom)!,registryId=proposal.support[tag.id].registryIds![0],snapshot=proposal.evidenceSnapshot!,entry=snapshot.entries[registryId];
  tag.name='CO';tag.fullName='carbon monoxide';tag.description='Carbon monoxide molecules.';const meaning={description:tag.description,facet:tag.facet,inclusions:tag.inclusions,exclusions:tag.exclusions,examples:tag.examples},meaningId=fingerprint(meaning);
  proposal.validatedEvidenceLinks={[tag.id]:{[registryId]:fingerprint({snapshot:snapshot.id,entry,sources:entry.sourceIds.map(id=>snapshot.sources[id]),meaning:meaningId})}};proposal.evidenceScientificIdentities={[tag.id]:'CO'};proposal.evidenceMeaningFingerprints={[tag.id]:meaningId};proposal.mappingConfirmations={[tag.id]:{fingerprint:fingerprint({snapshot,tagId:tag.id,meaning,registryIds:[registryId]}),confirmedAt:'2026-10-28T00:00:00.000Z'}};proposal.validationIssues=[];proposal.issues=[];
  const target=harness();target.host.papers.set(1,copy(paper));await target.controller.invoke('scan',{scope:'library'});await target.controller.invoke('import-vocabulary',{value:document});
  const imported=target.state.taxonomyProposal!;assert.ok(imported.validationIssues!.some(issue=>issue.code==='scientific-contradiction'));assert.deepEqual(imported.mappingConfirmations,{});assert.deepEqual(imported.support[tag.id].paperIds,[]);
  await assert.rejects(target.controller.invoke('approve-taxonomy',{id:imported.id}),/evidence|scientific/i);assert.equal(target.ai.calls.length,0);assert.equal(target.host.writes.length,0);
});

test('presentation-renamed proposals import stable registry/source links but require fresh confirmation of uncertain meaning',async()=>{
  const source=uncertainHarness();await run(source);const proposal=source.state.taxonomyProposal!,tagId=proposal.tags.find(tag=>!tag.custom)!.id;await source.controller.invoke('confirm-taxonomy-mapping',{id:proposal.id,tagId});
  proposal.tags.find(tag=>tag.id===tagId)!.name='Reviewed resistance';proposal.tags.find(tag=>tag.id===tagId)!.fullName='Reviewed protonic resistance label';await source.controller.invoke('save-taxonomy-proposal',{id:proposal.id,tags:proposal.tags});const document=proposalDocument(source),support=copy(proposal.support[tagId]);
  const target=harness();await target.controller.invoke('scan',{scope:'library'});await target.controller.invoke('import-vocabulary',{value:document});const imported=target.state.taxonomyProposal!;
  assert.ok(imported.tags.some(tag=>tag.id===tagId));assert.deepEqual(imported.support[tagId].registryIds,support.registryIds);assert.deepEqual(Object.keys(imported.evidenceSnapshot!.sources).sort(),Object.keys(proposal.evidenceSnapshot!.sources).sort());assert.deepEqual(imported.mappingConfirmations,{});assert.ok(imported.validationIssues!.some(issue=>issue.code==='uncertain-meaning'));
  await assert.rejects(target.controller.invoke('approve-taxonomy',{id:imported.id}),/evidence|scientific/i);await target.controller.invoke('confirm-taxonomy-mapping',{id:imported.id,tagId});assert.deepEqual(imported.support[tagId].sourceIds,support.sourceIds);assert.deepEqual(imported.support[tagId].paperIds,support.paperIds);assert.equal(target.ai.calls.length,0);assert.equal(target.host.writes.length,0);
});
