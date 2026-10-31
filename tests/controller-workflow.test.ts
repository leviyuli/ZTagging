import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import type {NativeTag,TagPatch} from '../src/platform.ts';
import type {CompletionResult} from '../src/providers.ts';
import {ProviderError} from '../src/providers.ts';
import {createRegistrySnapshot} from '../src/evidence.ts';
import type {PaperFacts} from '../src/taxonomy.ts';

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const quote='Anion exchange membrane fuel cells were studied using electrochemical impedance spectroscopy.';
const definition=(id:string,name:string,fullName:string,facet:TagDefinition['facet'],custom=false):TagDefinition=>({id,name,fullName,description:`The established scientific meaning of ${fullName}.`,facet,custom,status:'approved',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],matchingMode:custom?'suggest':'auto'});
function harness(saved?:AppState){
  const state=saved??initialState();state.settings.model='workflow-model';
  const papers:PaperRecord[]=[{id:'1:OLD',itemID:1,libraryID:1,key:'OLD',title:'A previous fuel-cell experiment',abstract:'Fuel cells convert chemical energy to electricity.',keywords:[],fingerprint:''},{id:'1:NEW',itemID:2,libraryID:1,key:'NEW',title:'Anion exchange membrane fuel cell impedance',abstract:quote,keywords:[],fingerprint:''}];for(const paper of papers)paper.fingerprint=paperFingerprint(paper);
  const native:Record<string,NativeTag[]>=clone(state.nativeTags);for(const paper of papers)native[paper.id]??=[{tag:'Project paper',type:0}];
  const calls:Record<string,unknown>[]=[],writes:TagPatch[][]=[],saves:AppState[]=[],exports:unknown[]=[];let failConsolidation=false;
  const ai:ControllerEnvironment['ai']={async completeJson(_system,prompt):Promise<CompletionResult>{
    const data=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]);calls.push(data);let value:unknown;
    if(data.conceptRegistry){
      if(failConsolidation)throw new ProviderError('Synthetic connection expired.','authentication',{status:401});
      const ids=(label:string)=>data.conceptRegistry.filter((entry:{sources:{label:string}[]})=>entry.sources.some(source=>source.label===label)).map((entry:{registryId:string})=>entry.registryId);
      value={tags:[{key:'fc',name:'FC',fullName:'fuel cell',description:'A generated rewrite that must not change the approved meaning.',facet:'system',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[]},{key:'aemfc',name:'AEMFC',fullName:'anion exchange membrane fuel cell',description:'Anion exchange membrane fuel cell systems.',facet:'system',aliases:[],parentKeys:['fc'],relatedKeys:[],supportRegistryIds:ids('AEMFC')},{key:'eis',name:'EIS',fullName:'electrochemical impedance spectroscopy',description:'A generated description of impedance measurements.',facet:'method',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:ids('Electrochemical impedance spectroscopy')}],merges:[],excluded:[]};
    }else if(data.selectionPhase==='mapping'){
      if(data.requestedPairs)value={judgements:data.requestedPairs.map((pair:any)=>{
        const source=data.sources.find((source:any)=>source.sourceId===pair.sourceId),tag=data.tags.find((tag:any)=>tag.id===pair.tagId);assert.ok(source);assert.ok(tag);
        const exact=source.name==='AEMFC'&&tag.name==='AEMFC'||source.name==='Electrochemical impedance spectroscopy'&&tag.name==='EIS',relation=exact?'equivalent':source.name==='AEMFC'&&tag.name==='FC'?'subtype':'unrelated';
        return {tagId:pair.tagId,registryId:pair.registryId,sourceIds:[pair.sourceId],relation,reason:relation==='unrelated'?'The actual source describes another scientific concept.':'The quotation explicitly establishes this technology or method.'};
      })};else{
      const judgements=[],outside=[];
      for(const source of data.sources){const sourceId=source.sourceId,entry=data.permittedRegistry.find((value:any)=>value.sourceIds.includes(sourceId)),name=source.name.toLowerCase(),tag=data.tags.find((value:any)=>name==='aemfc'?value.name==='AEMFC':name==='electrochemical impedance spectroscopy'&&value.name==='EIS');if(tag)judgements.push({tagId:tag.id,registryId:entry.registryId,sourceIds:[sourceId],relation:'equivalent',reason:'The actual quotation explicitly establishes the chosen scientific topic.'});else outside.push({sourceIds:[sourceId],reason:'No selected core describes this separate finding.',disposition:'outside-core'});}
      value={judgements,outside};
      }
    }else if(data.approvedVocabulary){
      value={summary:'A fuel-cell impedance experiment.',concepts:[],needsPDF:false,newTagCandidates:[],suggestions:data.approvedVocabulary.filter((tag:{name:string})=>tag.name==='AEMFC'||tag.name==='EIS').map((tag:{id:string})=>({tagId:tag.id,reason:'The abstract directly establishes this studied concept.',confidence:'high',match:'substantive',evidence:[{source:'abstract',text:data.paper.abstract}]}))};
    }else if(data.preparationPolicyVersion)throw new Error('No legacy preparation request is required.');
    else value={summary:quote,concepts:[{name:'AEMFC',facet:'system',evidence:[{source:'abstract',text:quote}]},{name:'Electrochemical impedance spectroscopy',facet:'method',evidence:[{source:'abstract',text:quote}]}],needsPDF:false};
    return {value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:10,outputTokens:10},estimatedCostUSD:0.001};
  },async hasApiKey(){return true;},async getSession(){return {connected:true,sharing:true,email:null,accountId:null,accounts:[]};},async testConnection(){throw new Error('No connection test is required.');},async listModels(){return [];},async setApiKey(){},async removeApiKey(){},async signIn(){throw new Error('No sign-in is required.');},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}};
  const host:ControllerEnvironment['host']={async list(scope){return clone(scope==='library'?papers:[papers[1]]);},async read(itemID){return clone(papers.find(paper=>paper.itemID===itemID)??null);},async readTags(itemID){return clone(native[papers.find(paper=>paper.itemID===itemID)!.id]);},async pdfText(){return '';},async apply(patches){writes.push(clone(patches));for(const patch of patches)native[patch.paperId]=clone(patch.after);},async show(){},async saveSearch(){}};
  const controller=new AppController(state,{ai,host,persist:async value=>{saves.splice(0,saves.length,clone(value));},exportFile:async value=>{exports.push(clone(value));}});
  return {state,papers,native,calls,writes,saves,exports,controller,setFailure(value:boolean){failConsolidation=value;}};
}
function approved(h:ReturnType<typeof harness>){
  h.state.tags=[definition('old-fc','FC','fuel cell','system'),definition('old-eis','EIS','electrochemical impedance spectroscopy','method'),definition('old-co','Co','cobalt','component'),definition('old-CO','CO','carbon monoxide','component'),definition('old-detail','RCL','catalyst-layer resistance','phenomenon',true)];h.state.taxonomyReady=true;h.state.vocabularyVersion=3;
  h.state.nativeTags['1:OLD']=[{tag:'FC',type:0},{tag:'Project paper',type:0}];h.native['1:OLD']=clone(h.state.nativeTags['1:OLD']);h.state.decisions['1:OLD|old-fc']={locked:true};
  const paper=h.papers[0],fact:PaperFacts={paperId:paper.id,metadataFingerprint:paper.fingerprint,inputFingerprint:paper.fingerprint,provider:'retained-provider',model:'retained-model',extractionVersion:1,summary:paper.abstract,needsPDF:false,concepts:[{name:'FC',facet:'system',evidence:[{source:'abstract',text:paper.abstract}]}]};
  h.state.papers[paper.id]=clone(paper);h.state.facts[paper.id]=fact;h.state.taxonomyEvidence=createRegistrySnapshot([fact],h.state.evidenceCatalog);h.state.taxonomySupport={'old-fc':{paperIds:[paper.id],registryIds:Object.keys(h.state.taxonomyEvidence.entries),sourceIds:Object.keys(h.state.taxonomyEvidence.sources)}};
}
async function build(h:ReturnType<typeof harness>,mode?:'extend'|'replace'){await h.controller.invoke('prepare-tags',{scope:'selected',...(mode?{mode}:{})});await h.controller.waitForIdle();}

test('saving the vocabulary and applying paper tags have independent scopes, requests and undo counts',async()=>{
  const h=harness();await build(h);const before=h.calls.length;await h.controller.invoke('apply-tag-list',{id:h.state.tagPreparation!.id});await h.controller.waitForIdle();
  assert.equal(h.calls.length,before);assert.equal(h.state.run?.kind,'rebuild');assert.equal(h.state.suggestions.length,0);assert.equal(h.writes.length,0);
  await h.controller.invoke('tag',{scope:'library'});await h.controller.waitForIdle();let view=await h.controller.snapshot();assert.equal(view.workflow!.buildScope,'selected');assert.equal(view.workflow!.buildPaperCount,1);assert.equal(view.workflow!.assignmentScope,'library');assert.equal(view.workflow!.assignmentPaperCount,2);assert.equal(view.workflow!.assignedPaperCount,0);assert.equal(view.workflow!.assignmentPilotReady,false);
  const suggestions=h.state.suggestions.filter(suggestion=>suggestion.paperId==='1:NEW');for(const suggestion of suggestions)await h.controller.invoke('accept-suggestion',{id:suggestion.id});await h.controller.invoke('apply-suggestions',{ids:suggestions.map(suggestion=>suggestion.id)});
  view=await h.controller.snapshot();assert.equal(view.workflow!.assignedPaperCount,1);assert.equal(view.workflow!.buildPaperCount,1);await h.controller.invoke('undo',{id:h.state.history.at(-1)!.id});assert.equal((await h.controller.snapshot()).workflow!.assignedPaperCount,0);
  const restored=harness(clone(h.state));await restored.controller.initialize();assert.deepEqual((await restored.controller.snapshot()).workflow, (await h.controller.snapshot()).workflow);
});

test('a default extension retains every old definition and ID while adding a supported subtype from new papers',async()=>{
  const h=harness();approved(h);const old=clone(h.state.tags),oldEvidence=clone(h.state.taxonomyEvidence),native=fingerprint(h.native),decisions=fingerprint(h.state.decisions);await build(h);
  assert.equal(h.state.run!.buildMode,'extend');assert.equal(h.state.tagPreparation!.status,'ready',JSON.stringify(h.state.taxonomyProposal!.validationIssues));const proposal=h.state.taxonomyProposal!;
  assert.deepEqual(proposal.paperIds,['1:NEW']);assert.deepEqual(proposal.evidenceSnapshot!.paperIds,['1:NEW']);assert.ok(Object.values(proposal.support).every(support=>support.paperIds.every(id=>id==='1:NEW')));assert.equal(proposal.extension!.baseline.definitions.find(tag=>tag.name==='EIS')!.id,'old-eis');assert.equal(proposal.support['old-eis']?.paperIds.length??0,0,'Preserving an approved definition does not claim a newly checked example.');assert.equal((await h.controller.snapshot()).tagPreparation!.tags.find(tag=>tag.id==='old-eis')!.coverage,0);
  const retained=(await h.controller.snapshot()).tagPreparation!.tags.find(tag=>tag.id==='old-co')!;assert.equal(retained.name,'Co');assert.equal(retained.fullName,'cobalt');assert.equal(retained.coverage,0);assert.equal(retained.retained,true);
  await assert.rejects(h.controller.invoke('edit-prepared-tag',{id:h.state.tagPreparation!.id,tag:{...old[0],name:'Changed FC'}}),/unchanged|Replace/);await assert.rejects(h.controller.invoke('remove-prepared-tag',{id:h.state.tagPreparation!.id,tagId:'old-fc'}),/extended|Replace/);
  const calls=h.calls.length;await h.controller.invoke('apply-tag-list',{id:h.state.tagPreparation!.id});assert.equal(h.calls.length,calls);for(const tag of old)assert.deepEqual(h.state.tags.find(value=>value.id===tag.id),tag);
  assert.ok(h.state.tags.find(tag=>tag.name==='AEMFC')!.broaderIds.includes('old-fc'));assert.equal(fingerprint(h.native),native);assert.equal(fingerprint(h.state.decisions),decisions);assert.equal(h.writes.length,0);assert.equal(validState(h.state),true);
  assert.deepEqual(h.state.taxonomyEvidence!.paperIds,['1:NEW']);assert.deepEqual(h.state.taxonomyEvidenceScopes![0].evidenceSnapshot,oldEvidence);assert.equal((await h.controller.snapshot()).tags.find(tag=>tag.id==='old-fc')!.coverage,2);
});

test('extension mode and baseline survive a paused run and restart without repeating factual extraction',async()=>{
  const h=harness();approved(h);h.setFailure(true);await build(h);assert.equal(h.state.run!.status,'paused');const baseline=clone(h.state.run!.extensionBaseline),facts=fingerprint(h.state.facts);
  const restored=harness(clone(h.saves.at(-1)!));await restored.controller.initialize();await restored.controller.invoke('resume');await restored.controller.waitForIdle();assert.equal(restored.state.run!.status,'idle');assert.equal(restored.state.run!.buildMode,'extend');assert.deepEqual(restored.state.run!.extensionBaseline,baseline);assert.equal(fingerprint(restored.state.facts),facts);assert.equal(restored.calls.filter(data=>data.paper&&!data.approvedVocabulary).length,0);assert.equal(restored.state.tagPreparation!.status,'ready');
});

test('an explicit replacement cannot reuse an extension checkpoint and may omit old core tags after review',async()=>{
  const h=harness();approved(h);h.setFailure(true);await build(h);const oldFingerprint=h.state.run!.selection!.fingerprint,facts=fingerprint(h.state.facts);h.setFailure(false);await build(h,'replace');
  assert.equal(h.state.run!.buildMode,'replace');assert.equal(h.state.run!.extensionBaseline,undefined);assert.notEqual(h.state.run!.selection!.fingerprint,oldFingerprint);assert.equal(fingerprint(h.state.facts),facts);assert.equal(h.state.taxonomyProposal!.extension,undefined);
  await h.controller.invoke('apply-tag-list',{id:h.state.tagPreparation!.id});assert.equal(h.state.tags.some(tag=>tag.id==='old-co'),false);assert.ok(h.state.tags.some(tag=>tag.id==='old-detail'));assert.ok(h.native['1:OLD'].some(tag=>tag.tag==='FC'));assert.equal(h.writes.length,0);
});

test('refreshing an extension keeps a changed saved definition and reuses its checked additions',async()=>{
  const h=harness();approved(h);await build(h);const tag=h.state.tags.find(tag=>tag.id==='old-detail')!;await h.controller.invoke('save-tag',{tag:{...tag,description:'A researcher revised this niche definition.'}});
  const saved=clone(h.state.tags.find(value=>value.id===tag.id)!),additionId=h.state.taxonomyProposal!.tags.find(value=>value.name==='AEMFC')!.id,calls=h.calls.length,facts=fingerprint(h.state.facts),native=fingerprint(h.native),spent=h.state.run!.spentUSD,snapshot=fingerprint(h.state.taxonomyProposal!.evidenceSnapshot);
  assert.equal((await h.controller.snapshot()).tagPreparation!.needsRefresh,true);assert.deepEqual(await h.controller.invoke('apply-tag-list',{id:h.state.tagPreparation!.id}),{page:'assignment'});assert.deepEqual(h.state.tags.find(value=>value.id===tag.id),saved);assert.ok(h.state.tags.some(value=>value.id===additionId&&value.name==='AEMFC'));assert.equal(h.calls.length,calls);assert.equal(fingerprint(h.state.facts),facts);assert.equal(fingerprint(h.state.taxonomyEvidence),snapshot);assert.equal(h.state.run!.spentUSD,spent);assert.equal(fingerprint(h.native),native);assert.equal(h.writes.length,0);assert.equal(validState(h.state),true);
});

test('analysis export, import and invalid-merge recovery preserve extension semantics and its baseline',async()=>{
  const h=harness();approved(h);await build(h);const baseline=clone(h.state.taxonomyProposal!.extension!.baseline);await h.controller.invoke('export-tag-analysis',{id:h.state.tagPreparation!.id});
  const restored=harness(clone(h.state));await restored.controller.initialize();await restored.controller.invoke('discard-taxonomy',{id:restored.state.taxonomyProposal!.id});await restored.controller.invoke('import-vocabulary',{value:h.exports[0]});
  assert.deepEqual(restored.state.taxonomyProposal!.extension!.baseline,baseline);assert.equal(restored.calls.length,0);assert.equal(restored.state.tagPreparation!.status,'ready');
  restored.state.taxonomyProposal!.unresolvedMerges=[{fromId:'unavailable-old-concept',toReference:'invalid-output',reason:'The model supplied an unknown old identity.'}];await restored.controller.invoke('discard-invalid-merges',{id:restored.state.taxonomyProposal!.id});assert.deepEqual(restored.state.taxonomyProposal!.extension!.baseline,baseline);
  await restored.controller.invoke('apply-tag-list',{id:restored.state.tagPreparation!.id});for(const tag of baseline.definitions)assert.deepEqual(restored.state.tags.find(value=>value.id===tag.id),tag);assert.equal(restored.writes.length,0);
});

test('an unchanged approved extension reuses facts and vocabulary without another provider call',async()=>{
  const h=harness();approved(h);await build(h);await h.controller.invoke('apply-tag-list',{id:h.state.tagPreparation!.id});const calls=h.calls.length,tags=clone(h.state.tags),facts=fingerprint(h.state.facts);await build(h);
  assert.equal(h.calls.length,calls);assert.equal(h.state.taxonomyProposal,null);assert.equal(h.state.tagPreparation,undefined);assert.equal(h.state.run!.buildMode,'extend');assert.equal(h.state.run!.status,'idle');assert.deepEqual(h.state.tags,tags);assert.equal(fingerprint(h.state.facts),facts);assert.equal(h.writes.length,0);
});

test('researcher edits can add and remove new-to-retained contextual links without changing old definitions',async()=>{
  const h=harness();approved(h);await build(h);const tag=clone(h.state.taxonomyProposal!.tags.find(tag=>tag.name==='AEMFC')!),eis=clone(h.state.tags.find(tag=>tag.id==='old-eis'));
  await h.controller.invoke('edit-prepared-tag',{id:h.state.tagPreparation!.id,tag:{...tag,relatedIds:['old-eis']}});assert.ok((await h.controller.snapshot()).tagPreparation!.tags.find(value=>value.id===tag.id)!.relatedIds!.includes('old-eis'));
  await h.controller.invoke('edit-prepared-tag',{id:h.state.tagPreparation!.id,tag:{...tag,relatedIds:[]}});await h.controller.invoke('apply-tag-list',{id:h.state.tagPreparation!.id});assert.deepEqual(h.state.tags.find(value=>value.id===tag.id)!.relatedIds,[]);assert.deepEqual(h.state.tags.find(value=>value.id==='old-eis'),eis);assert.equal(h.writes.length,0);
});

test('restoring multi-build evidence asks for a rebuild instead of mixing old sources into one snapshot',async()=>{
  const h=harness();approved(h);await build(h);await h.controller.invoke('apply-tag-list',{id:h.state.tagPreparation!.id});h.papers[1].abstract+=' A second measurement series was recorded.';await build(h);await h.controller.invoke('apply-tag-list',{id:h.state.tagPreparation!.id});
  const archive=h.state.taxonomyArchives[0],tags=fingerprint(h.state.tags),history=fingerprint(h.state.taxonomyArchives);assert.ok(archive.evidenceScopes!.length>0);await assert.rejects(h.controller.invoke('restore-taxonomy',{id:archive.id}),/several builds.*[Rr]ebuild/);assert.equal(fingerprint(h.state.tags),tags);assert.equal(fingerprint(h.state.taxonomyArchives),history);assert.equal(h.writes.length,0);
});
