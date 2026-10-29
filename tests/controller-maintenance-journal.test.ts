import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController, initialState, applyDefinitionRecords, definitionRecordsMatch, validState } from '../src/controller.ts';
import type { AppState, ControllerEnvironment } from '../src/controller.ts';
import { paperFingerprint } from '../src/core.ts';
import type { PaperRecord, TagDefinition } from '../src/core.ts';
import { sameTags } from '../src/platform.ts';
import type { LibraryHost, NativeTag, TagPatch } from '../src/platform.ts';
import { buildMetadataPreview, reverseMetadataPatch, sameMetadata } from '../src/paper-recovery.ts';
import type { MetadataPatch, MetadataSnapshot } from '../src/paper-recovery.ts';
import { normalizeFacts } from '../src/taxonomy.ts';

const copy=<T>(value:T):T=>structuredClone(value);
type Journal=AppState['history'][number];
class Host implements LibraryHost {
  native=new Map<number,NativeTag[]>([[1,[]],[2,[]]]);
  metadata=new Map<number,MetadataSnapshot>([1,2].map(itemID=>[itemID,{paperId:`1:KEY${itemID}`,itemID,itemType:'journalArticle',fields:{title:`Synthetic paper measuring electrode transport ${itemID}`,abstractNote:'',DOI:`10.1234/example${itemID}`},creators:[],identifiers:[{kind:'DOI',value:`10.1234/example${itemID}`}]}]));
  tagWrites=0;metadataWrites=0;failBefore=false;failAfter=false;
  async read(itemID:number):Promise<PaperRecord|null>{const value=this.metadata.get(itemID);if(!value)return null;const paper:PaperRecord={id:value.paperId,itemID,libraryID:1,key:`KEY${itemID}`,title:value.fields.title,abstract:value.fields.abstractNote,keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);return paper;}
  async list(){return (await Promise.all([...this.metadata.keys()].map(id=>this.read(id)))).filter((paper):paper is PaperRecord=>!!paper);}
  async readTags(id:number){return copy(this.native.get(id)??[]);}
  async pdfText(){return '';}
  async apply(patches:TagPatch[]){if(this.failBefore)throw new Error('Native transaction rejected');for(const patch of patches)if(!sameTags(await this.readTags(patch.itemID),patch.before))throw new Error('Stale native tags');this.tagWrites++;for(const patch of patches)this.native.set(patch.itemID,copy(patch.after));if(this.failAfter)throw new Error('Interrupted after native commit');}
  async readMetadata(id:number){const value=this.metadata.get(id);if(!value)throw new Error('Unavailable paper');return copy(value);}
  async applyMetadata(patches:MetadataPatch[]){if(this.failBefore)throw new Error('Native transaction rejected');for(const patch of patches)if(!sameMetadata(await this.readMetadata(patch.itemID),patch.before))throw new Error('Stale native metadata');this.metadataWrites++;for(const patch of patches)this.metadata.set(patch.itemID,copy(patch.after));if(this.failAfter)throw new Error('Interrupted after native commit');}
  async show(){}async saveSearch(){}
}
function detail(id='custom-detail'):TagDefinition{return {...copy(initialState().tags[0]),id,name:'Researcher detail',description:'A researcher-defined transport detail.',status:'approved'};}
function journal(overrides:Partial<Journal>={}):Journal{return {id:'change',date:'2026-10-29T00:00:00.000Z',label:'Reviewed maintenance',patches:[],beforeOwnership:{},afterOwnership:{},suggestionIds:[],status:'prepared',...overrides};}
function metadataPatch(host:Host,itemID=1){const before=copy(host.metadata.get(itemID)!);return buildMetadataPreview(before,[{DOI:before.fields.DOI,abstractNote:'Verified electrode transport measurements are reported.'}]).patch!;}
async function harness(state=initialState(),host=new Host()){
  if(!Object.keys(state.papers).length)for(const paper of await host.list())state.papers[paper.id]=paper;
  const saves:AppState[]=[];let rejectPersist=false;
  const ai:ControllerEnvironment['ai']={hasApiKey:async()=>true,getSession:async()=>({connected:false,sharing:false,accountId:null,email:null,accounts:[]}),completeJson:async()=>{throw new Error('Journal operations must not request AI');},testConnection:async()=>{throw new Error('No connection request expected');},listModels:async()=>[],setApiKey:async()=>{},removeApiKey:async()=>{},signIn:async()=>{throw new Error('No sign in expected');},cancelSignIn:()=>{},signOut:async()=>({revoked:true}),selectAccount:async()=>{}};
  const controller=new AppController(state,{host,ai,persist:async value=>{if(rejectPersist)throw new Error('Atomic state write failed');saves.push(copy(value));}});
  return {state,host,controller,saves,setRejectPersist:(value:boolean)=>{rejectPersist=value;}};
}

test('definition journal helpers compare exact scopes and preserve unrelated definitions and order',()=>{
  const first=detail('first'),unrelated=detail('other'),changed={...copy(first),description:'New reviewed scope.'},tags=[first,unrelated];
  assert.equal(definitionRecordsMatch(tags,{first}),true);assert.equal(definitionRecordsMatch(tags,{first:changed}),false);
  const next=applyDefinitionRecords(tags,{first:changed,new:detail('new')});
  assert.deepEqual(next.map(tag=>tag.id),['first','other','new']);assert.equal(next[1],unrelated);assert.equal(first.description,'A researcher-defined transport detail.');
  assert.deepEqual(applyDefinitionRecords(next,{first:null}).map(tag=>tag.id),['other','new']);
});

test('completed metadata recovery archives exact facts, refreshes inputs, and completes associated definitions without repeating writes',async()=>{
  const host=new Host(),patch=metadataPatch(host),h=await harness(initialState(),host),created=detail();
  const paper=h.state.papers[patch.paperId];paper.pdfText='Retained local PDF passage.';paper.fingerprint=paperFingerprint(paper);
  const facts=normalizeFacts({summary:'Original factual synopsis.',concepts:[{name:'electrode transport',evidence:[{source:'pdf',text:paper.pdfText}]}],needsPDF:false},paper,'deepseek','retained-model');h.state.facts[paper.id]=facts;
  h.state.analyses[paper.id]={metadataFingerprint:'old',vocabularyVersion:0,provider:'deepseek',model:'model',raw:{}};
  h.state.paperInputs={[paper.id]:{paperId:paper.id,itemID:paper.itemID,checkedAt:'2026-10-28T00:00:00.000Z',metadata:{title:true,abstract:false,keywords:false},pdf:{status:'readable',attachmentCount:1,localCount:1,characters:26,rechecked:false}}};
  h.state.pendingChange=journal({metadataPatches:[patch],beforeDefinitions:{[created.id]:null},afterDefinitions:{[created.id]:created}});host.metadata.set(1,copy(patch.after));
  await h.controller.initialize();
  assert.equal(h.state.pendingChange,undefined);assert.equal(h.state.history[0].status,'applied');assert.ok(h.state.tags.some(tag=>tag.id===created.id));
  assert.equal(h.state.facts[paper.id],undefined);assert.deepEqual(h.state.factHistory![0].facts,facts);assert.equal(h.state.analyses[paper.id],undefined);assert.equal(h.state.paperInputs![paper.id],undefined);
  assert.equal(h.state.papers[paper.id].abstract,patch.after.fields.abstractNote);assert.equal(h.state.papers[paper.id].pdfText,'Retained local PDF passage.');assert.equal(host.metadataWrites,0);assert.equal(validState(h.state),true);
});

test('an untouched metadata journal is discarded without deleting cached facts or creating definitions',async()=>{
  const h=await harness(),patch=metadataPatch(h.host),created=detail();
  const paper=h.state.papers[patch.paperId],facts=normalizeFacts({summary:'Retained.',concepts:[{name:'transport',evidence:[{source:'title',text:paper.title}]}],needsPDF:false},paper,'deepseek','model');h.state.facts[paper.id]=facts;
  h.state.pendingChange=journal({metadataPatches:[patch],beforeDefinitions:{[created.id]:null},afterDefinitions:{[created.id]:created}});
  await h.controller.initialize();assert.equal(h.state.pendingChange,undefined);assert.equal(h.state.history.length,0);assert.equal(h.state.tags.some(tag=>tag.id===created.id),false);assert.deepEqual(h.state.facts[paper.id],facts);assert.equal(h.state.factHistory,undefined);
});

test('partial native recovery keeps current definitions and records the exact conflict instead of installing half a taxonomy change',async()=>{
  const h=await harness(),tag=h.state.tags[0],after={...copy(tag),aliases:[...tag.aliases,'Reviewed alias']};
  const patches:TagPatch[]=[1,2].map(itemID=>({paperId:`1:KEY${itemID}`,itemID,before:[],after:[{tag:'RCL',type:0}]}));
  h.state.pendingChange=journal({patches,beforeDefinitions:{[tag.id]:copy(tag)},afterDefinitions:{[tag.id]:after},afterOwnership:{'1:KEY1':{[tag.id]:{name:'RCL',changeId:'change'}},'1:KEY2':{[tag.id]:{name:'RCL',changeId:'change'}}}});
  h.host.native.set(1,copy(patches[0].after));await h.controller.initialize();
  assert.equal(h.state.history[0].status,'conflict');assert.deepEqual(h.state.tags[0],tag);assert.equal(h.state.ownership['1:KEY1'][tag.id].name,'RCL');assert.equal(h.state.ownership['1:KEY2']?.[tag.id],undefined);
  assert.ok(h.state.warnings.some(warning=>warning.code==='interrupted-change'&&warning.status==='active'));assert.equal(h.host.tagWrites,0);
});

test('recovery of a committed native batch preserves later tag-definition edits and manual choices',async()=>{
  const h=await harness(),tag=copy(h.state.tags[0]),after={...copy(tag),aliases:[...tag.aliases,'Reviewed alias']},later={...copy(tag),description:'Later researcher definition.'};
  h.state.tags[0]=later;h.state.decisions['1:KEY1|custom-rcl']={locked:true};
  h.state.pendingChange=journal({patches:[{paperId:'1:KEY1',itemID:1,before:[],after:[{tag:'RCL',type:0}]}],beforeDefinitions:{[tag.id]:tag},afterDefinitions:{[tag.id]:after},beforeDecisions:{'1:KEY1|custom-rcl':null},afterDecisions:{'1:KEY1|custom-rcl':{rejected:false}}});h.host.native.set(1,[{tag:'RCL',type:0}]);
  await h.controller.initialize();assert.equal(h.state.history[0].status,'conflict');assert.deepEqual(h.state.tags[0],later);assert.deepEqual(h.state.decisions['1:KEY1|custom-rcl'],{locked:true});
});

test('metadata Undo uses exact inverse patches and atomically finalizes the original journal',async()=>{
  const h=await harness(),patch=metadataPatch(h.host);h.host.metadata.set(1,copy(patch.after));h.state.history=[journal({metadataPatches:[patch],status:'applied'})];
  await h.controller.invoke('undo',{id:'change'});
  assert.equal(sameMetadata(await h.host.readMetadata(1),patch.before),true);assert.equal(h.host.metadataWrites,1);assert.equal(h.state.history.find(record=>record.id==='change')!.status,'undone');
  assert.equal(h.state.history[0].undoOfId,'change');assert.equal(h.state.history[0].status,'applied');assert.equal(h.state.pendingChange,undefined);
  assert.ok(h.saves.some(state=>state.pendingChange?.metadataPatches?.length));
  assert.equal(h.saves.at(-1)!.history.find(record=>record.id==='change')!.status,'undone');
});

test('metadata Undo refuses later bibliographic edits and never overwrites them',async()=>{
  const h=await harness(),patch=metadataPatch(h.host);h.host.metadata.set(1,{...copy(patch.after),fields:{...patch.after.fields,title:'Later researcher title'}});h.state.history=[journal({metadataPatches:[patch],status:'applied'})];
  await assert.rejects(h.controller.invoke('undo',{id:'change'}),/Later metadata edits conflict/);
  assert.equal(h.host.metadataWrites,0);assert.equal(h.state.history.length,1);assert.equal(h.state.history[0].status,'applied');assert.equal((await h.host.readMetadata(1)).fields.title,'Later researcher title');
});

test('definition-only Undo saves one complete generation, preserves unrelated tags, and retains the pilot gate',async()=>{
  const h=await harness(),created=detail(),unrelated=detail('unrelated');h.state.tags.push(created,unrelated);h.state.settings.autoAssign=true;h.state.pilotReviewed=true;h.state.pilotVersion=h.state.vocabularyVersion;
  h.state.history=[journal({beforeDefinitions:{[created.id]:null},afterDefinitions:{[created.id]:created},status:'applied'})];
  await h.controller.invoke('undo',{id:'change'});
  assert.deepEqual(h.state.tags.map(tag=>tag.id),['custom-rcl','unrelated']);assert.equal(h.host.tagWrites,0);assert.equal(h.host.metadataWrites,0);assert.equal(h.saves.length,1);
  assert.equal(h.saves[0].pendingChange,undefined);assert.equal(h.saves[0].history.find(record=>record.id==='change')!.status,'undone');assert.equal(h.state.settings.autoAssign,true);assert.equal(h.state.pilotReviewed,true);assert.equal(h.state.vocabularyVersion,0);
});

test('failed definition-only persistence restores definitions, history and the original Undo status',async()=>{
  const h=await harness(),created=detail();h.state.tags.push(created);h.state.history=[journal({beforeDefinitions:{[created.id]:null},afterDefinitions:{[created.id]:created},status:'applied'})];
  const before=copy(h.state);h.setRejectPersist(true);
  await assert.rejects(h.controller.invoke('undo',{id:'change'}),/Atomic state write failed/);
  assert.deepEqual(h.state,before);assert.equal(h.host.tagWrites,0);assert.equal(h.host.metadataWrites,0);
});

test('definition Undo refuses a later researcher edit while preserving unrelated definitions',async()=>{
  const h=await harness(),created=detail();h.state.tags.push({...copy(created),description:'Later researcher edit.'});h.state.history=[journal({beforeDefinitions:{[created.id]:null},afterDefinitions:{[created.id]:created},status:'applied'})];
  await assert.rejects(h.controller.invoke('undo',{id:'change'}),/Later tag-definition edits conflict/);assert.equal(h.state.tags.at(-1)!.description,'Later researcher edit.');assert.equal(h.saves.length,0);
});

test('recovery finalizes an interrupted metadata Undo from native after state without repeating the inverse write',async()=>{
  const h=await harness(),patch=metadataPatch(h.host),inverse=reverseMetadataPatch(patch);h.state.history=[journal({metadataPatches:[patch],status:'applied'})];h.state.pendingChange=journal({id:'undo-journal',metadataPatches:[inverse],undoOfId:'change'});
  await h.controller.initialize();assert.equal(h.state.history[0].id,'undo-journal');assert.equal(h.state.history[0].status,'applied');assert.equal(h.state.history.find(record=>record.id==='change')!.status,'undone');assert.equal(h.host.metadataWrites,0);
});

test('a host error after metadata commit recovers the completed change instead of losing its journal',async()=>{
  const h=await harness(),patch=metadataPatch(h.host);h.host.metadata.set(1,copy(patch.after));h.state.history=[journal({metadataPatches:[patch],status:'applied'})];h.host.failAfter=true;
  await assert.rejects(h.controller.invoke('undo',{id:'change'}),/Interrupted after native commit/);
  assert.equal(sameMetadata(await h.host.readMetadata(1),patch.before),true);assert.equal(h.state.pendingChange,undefined);assert.equal(h.state.history.find(record=>record.id==='change')!.status,'undone');assert.equal(h.state.history[0].status,'applied');
});
