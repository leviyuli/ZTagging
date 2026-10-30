import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {paperFingerprint} from '../src/core.ts';
import {upsertWarning} from '../src/warnings.ts';
import type {PaperRecord} from '../src/core.ts';
import type {NativeTag,TagPatch} from '../src/platform.ts';
import type {CompletionResult} from '../src/providers.ts';
import {createRegistrySnapshot,validateRegistrySnapshot} from '../src/evidence.ts';
import {createTaxonomyProposal,normalizeFacts} from '../src/taxonomy.ts';

const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const quote='Electrochemical impedance spectroscopy resolves electrode resistance.';
function harness(saved?:AppState) {
  const state=saved??initialState();state.settings.model='test-model';
  const paper:PaperRecord={id:'1:PREPARATION',itemID:1,libraryID:1,key:'PREPARATION',title:'Electrode impedance measurements',abstract:quote,keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
  let native:NativeTag[]=[{tag:'Project paper',type:0}],pdf='';const writes:TagPatch[][]=[],calls:any[]=[],exports:any[]=[];
  const ai={handler:(data:any):unknown=>{
    if(data.selectionPhase==='mapping')return {judgements:data.sources.map((source:any)=>({tagId:data.tags.find((tag:any)=>tag.name==='EIS').id,registryId:source.registryId,sourceIds:[source.sourceId],relation:'equivalent',reason:'The supplied quotation establishes impedance spectroscopy.'})),outside:[]};
    if(data.preparationPolicyVersion)return {tags:[],judgements:[]};
    if(data.conceptRegistry)return {tags:[{key:'eis',name:'EIS',fullName:'Electrochemical impedance spectroscopy',description:'Electrochemical impedance spectroscopy measures electrical response.',facet:'method',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:data.conceptRegistry.map((entry:any)=>entry.registryId)}],merges:[],excluded:[]};
    if(data.approvedVocabulary)return {summary:'Impedance measurements.',concepts:[],needsPDF:false,newTagCandidates:[],suggestions:data.approvedVocabulary.filter((tag:any)=>tag.name==='EIS').map((tag:any)=>({tagId:tag.id,reason:'The abstract describes impedance spectroscopy.',confidence:'high',match:'substantive',evidence:[{source:'abstract',text:quote}]}))};
    return {summary:quote,concepts:[{name:'Electrochemical impedance spectroscopy',facet:'method',evidence:[{source:'abstract',text:quote}]}],needsPDF:false};
  },async completeJson(_system:string,prompt:string):Promise<CompletionResult>{const data=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]);calls.push(data);const value=await ai.handler(data);return {value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:10,outputTokens:10},estimatedCostUSD:0.001};},async hasApiKey(){return true;},async getSession(){return {connected:true,sharing:true,email:null,accountId:null,accounts:[]};},async testConnection():Promise<CompletionResult>{return {value:{ok:true},text:'{"ok":true}',usageKnown:true,usage:{inputTokens:1,outputTokens:1},estimatedCostUSD:0};},async listModels(){return [];},async setApiKey(){},async removeApiKey(){},async signIn(){return ai.getSession();},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}};
  const env:ControllerEnvironment={ai,host:{async list(){return [copy(paper)];},async read(){return copy(paper);},async readTags(){return copy(native);},async pdfText(){return pdf;},async apply(patches:TagPatch[]){writes.push(copy(patches));for(const patch of patches)native=copy(patch.after);},async show(){},async saveSearch(){}},persist:async()=>{},exportFile:async value=>{exports.push(copy(value));}};
  return {state,paper,ai,calls,writes,exports,env,controller:new AppController(state,env),native:()=>native,setPDF:(text:string)=>{pdf=text;}};
}
async function build(h:ReturnType<typeof harness>){await h.controller.invoke('prepare-tags',{scope:'selected'});await h.controller.waitForIdle();}
async function legacyReview(h:ReturnType<typeof harness>,empty=false){
  await h.controller.invoke('scan',{scope:'selected'});
  const facts=normalizeFacts({summary:quote,concepts:[{name:'Electrochemical impedance spectroscopy',facet:'method',evidence:[{source:'abstract',text:quote}]}],needsPDF:false},h.paper,'historical-provider','historical-model'),snapshot=createRegistrySnapshot([facts],h.state.evidenceCatalog);
  h.state.facts[h.paper.id]=facts;h.state.taxonomyProposal=createTaxonomyProposal({tags:empty?[]:[{key:'eis',name:'EIS',fullName:'Electrochemical impedance spectroscopy',description:'Electrochemical impedance spectroscopy measures electrical response.',facet:'method',supportRegistryIds:Object.keys(snapshot.entries)}],merges:[],excluded:[]},[facts],h.state.tags,{snapshot,baseVersion:h.state.vocabularyVersion});
  h.state.run={id:'historical-review',kind:'rebuild',scope:'selected',automatic:false,status:'idle',jobs:[{id:'historical-job',paperId:h.paper.id,status:'completed'}],vocabCursor:1,vocabFinished:true,message:'A historical proposal awaits review.',spentUSD:0.15,settings:copy(h.state.settings),vocabularyVersion:h.state.vocabularyVersion,preparationOnly:true};
  await h.controller.initialize();
}
function invalidate(h:ReturnType<typeof harness>){const proposal=h.state.taxonomyProposal!;proposal.unresolvedRelationships=[{tagId:proposal.tags.find(tag=>tag.name==='EIS')!.id,kind:'parent',reference:'unavailable-parent'}];h.state.run!.vocabFinished=false;}

test('Build tags, Apply tag list and paper Apply remain separate, undoable steps',async()=>{
  const h=harness();await build(h);let view=await h.controller.snapshot();
  assert.equal(view.tagPreparation?.status,'ready');assert.equal(h.writes.length,0);
  assert.equal(view.taxonomyProposal,undefined);assert.equal(view.queue.consolidation,undefined);
  const calls=h.calls.length;
  await h.controller.invoke('apply-tag-list',{id:view.tagPreparation!.id});await h.controller.waitForIdle();
  assert.equal(h.state.taxonomyReady,true);assert.equal(h.state.run?.kind,'rebuild');assert.equal(h.state.run?.scope,'selected');
  assert.equal(h.state.settings.autoAssign,false);assert.equal(h.writes.length,0);assert.equal(h.state.suggestions.length,0);assert.equal(h.calls.length,calls);
  await h.controller.invoke('tag',{scope:'selected'});await h.controller.waitForIdle();assert.equal(h.state.suggestions.length,1);
  assert.deepEqual(h.state.run!.jobs.map(job=>job.paperId),['1:PREPARATION']);
  const suggestion=h.state.suggestions[0];await h.controller.invoke('accept-suggestion',{id:suggestion.id});await h.controller.invoke('apply-suggestions',{ids:[suggestion.id]});
  assert.ok(h.native().some(tag=>tag.tag==='EIS'));assert.ok(h.native().some(tag=>tag.tag==='Project paper'));
  await h.controller.invoke('undo',{id:h.state.history[0].id});assert.deepEqual(h.native(),[{tag:'Project paper',type:0}]);
  view=await h.controller.snapshot();assert.equal(view.tagPreparation,undefined);
});

test('automatic preparation stops after three dispatched requests; Resume cannot reset them',async()=>{
  const h=harness();await legacyReview(h,true);await h.controller.invoke('resume');await h.controller.waitForIdle();assert.equal(h.calls.filter(data=>data.preparationPolicyVersion).length,3);assert.equal(h.state.run?.preparation?.attempts,3);assert.equal(h.state.tagPreparation?.status,'failed');
  const restored=harness(copy(h.state));await restored.controller.initialize();await restored.controller.invoke('resume');await restored.controller.waitForIdle();
  assert.equal(restored.calls.length,0);assert.equal(restored.state.run?.preparation?.attempts,3);assert.equal(restored.state.tagPreparation?.status,'failed');
  const spent=restored.state.run!.spentUSD;await restored.controller.invoke('retry-tag-preparation',{id:restored.state.tagPreparation!.id});await restored.controller.waitForIdle();
  assert.equal(restored.calls.filter(data=>data.preparationPolicyVersion).length,3);assert.ok(restored.state.run!.spentUSD>=spent);assert.equal(restored.state.preparationHistory?.length,1);
});

test('budget rejection before dispatch preserves all three attempts and cached facts',async()=>{
  const h=harness();await legacyReview(h);invalidate(h);h.state.settings.provider='api';h.state.settings.budgetUSD=0;h.state.settings.inputPricePerMillion=1;h.state.settings.outputPricePerMillion=1;
  await h.controller.invoke('retry-tag-preparation',{id:h.state.tagPreparation!.id});await h.controller.waitForIdle();
  assert.equal(h.state.run?.status,'paused');assert.equal(h.state.run?.preparation?.attempts,0);assert.equal(h.calls.filter(data=>data.preparationPolicyVersion).length,0);
  const facts=copy(h.state.facts);h.state.settings.budgetUSD=100;await h.controller.invoke('resume');await h.controller.waitForIdle();
  assert.equal(h.state.run?.preparation?.attempts,3);assert.deepEqual(h.state.facts,facts);assert.equal(h.calls.filter(data=>data.paper&&!data.approvedVocabulary).length,0);
});

test('authentication failures consume dispatched attempts and survive restart',async()=>{
  const h=harness();await legacyReview(h);invalidate(h);h.ai.handler=()=>{throw Object.assign(new Error('Authentication expired'),{category:'authentication'});};
  await h.controller.invoke('retry-tag-preparation',{id:h.state.tagPreparation!.id});await h.controller.waitForIdle();
  assert.equal(h.state.run?.status,'paused');assert.equal(h.state.run?.preparation?.attempts,1);
  const restored=harness(copy(h.state));restored.ai.handler=h.ai.handler;await restored.controller.initialize();
  for(let i=0;i<3;i++){await restored.controller.invoke('resume');await restored.controller.waitForIdle();}
  assert.equal(restored.calls.length,2);assert.equal(restored.state.run?.preparation?.attempts,3);assert.equal(restored.state.tagPreparation?.status,'failed');
});

test('incomplete preparation replies remain diagnostic even when their partial JSON parses',async()=>{
  const h=harness();await legacyReview(h);invalidate(h);const id=h.state.taxonomyProposal!.tags.find(tag=>tag.name==='EIS')!.id;
  h.ai.handler=()=>{throw Object.assign(new Error('The response was truncated'),{category:'invalid-response',rawText:JSON.stringify({tags:[{tagId:id,broaderIds:[]}],judgements:[]})});};
  await h.controller.invoke('retry-tag-preparation',{id:h.state.tagPreparation!.id});await h.controller.waitForIdle();
  assert.equal(h.state.run?.preparation?.attempts,3);assert.equal(h.state.tagPreparation?.status,'failed');assert.ok(h.state.run?.preparation?.responses.every(response=>response.failed));assert.ok(h.state.taxonomyProposal!.unresolvedRelationships?.length);assert.equal(h.writes.length,0);
});

test('an interrupted returned repair is replayed without another dispatch',async()=>{
  const h=harness();await legacyReview(h);invalidate(h);
  let enter!:()=>void,release!:(value:unknown)=>void;const entered=new Promise<void>(resolve=>enter=resolve),pending=new Promise<unknown>(resolve=>release=resolve);
  h.ai.handler=()=>{enter();return pending;};await h.controller.invoke('retry-tag-preparation',{id:h.state.tagPreparation!.id});await entered;
  await h.controller.invoke('pause');release({tags:[],judgements:[]});await h.controller.waitForIdle();
  assert.equal(h.state.run?.preparation?.attempts,1);assert.equal(h.state.run?.preparation?.responses[0].applied,false);
  const restored=harness(copy(h.state));await restored.controller.initialize();await restored.controller.invoke('resume');await restored.controller.waitForIdle();
  assert.equal(restored.state.run?.preparation?.attempts,3);assert.equal(restored.calls.length,2);assert.ok(restored.state.run?.preparation?.responses.every(response=>response.applied));
});

test('an edit saved during a model request survives the returned repair',async()=>{
  const h=harness();await legacyReview(h);invalidate(h);const tag=copy(h.state.taxonomyProposal!.tags.find(tag=>tag.name==='EIS')!);
  let enter!:()=>void,release!:(value:unknown)=>void;const entered=new Promise<void>(resolve=>enter=resolve),pending=new Promise<unknown>(resolve=>release=resolve);
  h.ai.handler=()=>{enter();return pending;};await h.controller.invoke('retry-tag-preparation',{id:h.state.tagPreparation!.id});await entered;
  await h.controller.invoke('edit-prepared-tag',{id:h.state.tagPreparation!.id,tag:{...tag,name:'Impedance measurements'}});
  release({tags:[{tagId:tag.id,name:'EIS',broaderIds:[]}],judgements:[]});await h.controller.waitForIdle();
  assert.equal(h.state.taxonomyProposal!.tags.find(value=>value.id===tag.id)?.name,'Impedance measurements');assert.equal(h.state.tagPreparation!.status,'ready');assert.equal(h.writes.length,0);
});

test('changed papers without earlier extracted concepts trigger fresh selection and source mapping',async()=>{
  const h=harness(),normal=h.ai.handler;let empty=true;
  h.ai.handler=data=>data.paper&&!data.approvedVocabulary&&empty?{summary:'No usable topic was extracted.',concepts:[],needsPDF:false}:normal(data);
  await build(h);assert.equal(h.state.run?.preparation?.attempts??0,0);assert.equal(h.state.tagPreparation,undefined);assert.equal(h.state.taxonomyProposal,null);assert.equal(h.calls.filter(data=>data.conceptRegistry).length,0);const oldSelection=h.state.run!.selection?.id;
  await h.controller.initialize();empty=false;h.paper.abstract+=' A corrected abstract describes these measurements.';
  await h.controller.invoke('resume');await h.controller.waitForIdle();
  assert.ok(h.state.run!.selection);assert.notEqual(h.state.run!.selection!.id,oldSelection);assert.equal(h.state.tagPreparation?.status,'ready');assert.equal(h.state.run?.preparation?.attempts??0,0);
  assert.equal(h.calls.filter(data=>data.conceptRegistry).length,1);assert.equal(h.calls.filter(data=>data.paper&&!data.approvedVocabulary).length,2);assert.equal(h.state.taxonomyProposal!.support[h.state.taxonomyProposal!.tags.find(tag=>tag.name==='EIS')!.id].paperIds.length,1);
});

test('cached empty facts check newly available PDF text and resolve the paper attention notice',async()=>{
  const h=harness(),normal=h.ai.handler;h.ai.handler=data=>data.paper&&!data.approvedVocabulary?{summary:'Impedance study.',concepts:data.paper.pdf?[{name:'Electrochemical impedance spectroscopy',facet:'method',evidence:[{source:'pdf',text:quote}]}]:[],needsPDF:false}:normal(data);
  await build(h);const gap=h.state.warnings.find(warning=>warning.code==='evidence-gap')!;assert.equal(gap.status,'active');assert.equal(h.state.facts[h.paper.id].concepts.length,0);
  await h.controller.initialize();h.setPDF(quote);await h.controller.invoke('resume');await h.controller.waitForIdle();
  assert.equal(h.state.facts[h.paper.id].concepts[0].evidence[0].source,'pdf');assert.equal(h.state.warnings.find(warning=>warning.id===gap.id)?.status,'resolved');assert.equal(h.state.tagPreparation!.status,'ready');assert.equal(h.calls.filter(data=>data.paper&&!data.approvedVocabulary).length,2);
});

test('presentation edits and export/import retain exact evidence identities',async()=>{
  const h=harness();await build(h);const proposal=h.state.taxonomyProposal!,snapshot=copy(proposal.evidenceSnapshot),tag=proposal.tags.find(tag=>tag.name==='EIS')!;
  await h.controller.invoke('edit-prepared-tag',{id:h.state.tagPreparation!.id,tag:{...tag,name:'Impedance spectroscopy'}});
  assert.equal(h.state.taxonomyProposal!.tags.find(value=>value.id===tag.id)?.name,'Impedance spectroscopy');assert.deepEqual(h.state.taxonomyProposal!.evidenceSnapshot,snapshot);
  await h.controller.invoke('export-tag-analysis',{id:h.state.tagPreparation!.id});const exported=h.exports[0];
  const restored=harness();await restored.controller.invoke('scan',{scope:'selected'});await restored.controller.invoke('import-vocabulary',{value:exported});
  assert.deepEqual(restored.state.taxonomyProposal!.evidenceSnapshot,snapshot);assert.equal(restored.state.taxonomyProposal!.tags.find(value=>value.id===tag.id)?.name,'Impedance spectroscopy');assert.equal(restored.calls.length,0);assert.equal(restored.writes.length,0);
});

test('private analysis import retains distinct historical registry interpretations of equivalent names',async()=>{
  const h=harness();await build(h);for(const entry of Object.values(h.state.evidenceCatalog.entries))delete entry.normalizationVersion;
  const fact=h.state.facts[h.paper.id];fact.concepts.push({name:'Electrochemical-impedance spectroscopy (EIS)',facet:'method',evidence:[{source:'abstract',text:quote}]});
  const snapshot=createRegistrySnapshot([fact],h.state.evidenceCatalog);assert.deepEqual(validateRegistrySnapshot(snapshot),[]);assert.equal(Object.keys(snapshot.entries).length,2);
  h.state.taxonomyProposal=createTaxonomyProposal({tags:[{key:'eis',name:'EIS',fullName:'Electrochemical impedance spectroscopy',description:'Electrochemical impedance spectroscopy measures electrical response.',facet:'method',supportRegistryIds:Object.keys(snapshot.entries)}],merges:[],excluded:[]},[fact],h.state.tags,{snapshot});
  await h.controller.initialize();await h.controller.invoke('export-tag-analysis',{id:h.state.tagPreparation!.id});
  const restored=harness();await restored.controller.invoke('scan',{scope:'selected'});await restored.controller.invoke('import-vocabulary',{value:h.exports[0]});
  assert.equal(Object.keys(restored.state.evidenceCatalog.entries).length,2);assert.deepEqual(restored.state.taxonomyProposal!.evidenceSnapshot,snapshot);
  const next=createRegistrySnapshot(Object.values(restored.state.facts),restored.state.evidenceCatalog);assert.deepEqual(Object.keys(next.entries).sort(),Object.keys(snapshot.entries).sort());assert.deepEqual(validateRegistrySnapshot(next),[]);assert.equal(restored.calls.length,0);
});

test('removing the last generated tag never starts recovery or recreates the tag',async()=>{
  const h=harness();await build(h);const tag=h.state.taxonomyProposal!.tags.find(tag=>tag.name==='EIS')!,calls=h.calls.length;
  await h.controller.invoke('remove-prepared-tag',{id:h.state.tagPreparation!.id,tagId:tag.id});
  assert.equal(h.state.tagPreparation!.status,'ready');assert.equal((await h.controller.snapshot()).tagPreparation!.tags.some(value=>value.id===tag.id),false);
  await h.controller.invoke('retry-tag-preparation',{id:h.state.tagPreparation!.id});await h.controller.waitForIdle();assert.equal(h.calls.length,calls);assert.equal(h.state.taxonomyProposal!.tags.some(value=>value.id===tag.id),false);
  await h.controller.invoke('apply-tag-list',{id:h.state.tagPreparation!.id});await h.controller.waitForIdle();assert.equal(h.state.tags.some(value=>value.id===tag.id),false);assert.equal(h.writes.length,0);
});

test('removing a user topic affects the working list and applies only after Apply tag list',async()=>{
  const h=harness();await build(h);const custom=h.state.tags.find(tag=>tag.custom)!;
  await h.controller.invoke('remove-prepared-tag',{id:h.state.tagPreparation!.id,tagId:custom.id});
  assert.equal((await h.controller.snapshot()).tagPreparation!.tags.some(tag=>tag.id===custom.id),false);assert.ok(h.state.tags.some(tag=>tag.id===custom.id));
  await h.controller.invoke('apply-tag-list',{id:h.state.tagPreparation!.id});await h.controller.waitForIdle();assert.equal(h.state.tags.some(tag=>tag.id===custom.id),false);assert.equal(h.writes.length,0);assert.ok(h.state.taxonomyArchives[0].tags.some(tag=>tag.id===custom.id));
});

test('saving a tag list is independent of the connection and a paper preview starts explicitly',async()=>{
  const h=harness();await build(h);h.state.settings.model='';
  const calls=h.calls.length;
  await h.controller.invoke('apply-tag-list',{id:h.state.tagPreparation!.id});
  assert.equal(h.state.taxonomyReady,true);assert.equal(h.state.run?.kind,'rebuild');assert.equal(h.state.run?.status,'idle');assert.equal(h.calls.length,calls);assert.equal(h.writes.length,0);
  await assert.rejects(h.controller.invoke('tag',{scope:'selected'}),/model/i);assert.equal(h.state.suggestions.length,0);
  h.state.settings.model='test-model';await h.controller.invoke('tag',{scope:'selected'});await h.controller.waitForIdle();assert.equal(h.state.suggestions.length,1);
});

test('historical topic notices remain dismissed while new assignments keep evidence-bound topics in run history',async()=>{
  const h=harness(),normal=h.ai.handler;h.ai.handler=data=>data.approvedVocabulary?{...(normal(data) as object),newTagCandidates:[{name:'Electrode porosity',reason:'A relevant topic outside this approved list.',evidence:[{source:'abstract',text:data.paper.abstract}]}]}:normal(data);
  h.state.warnings=upsertWarning(h.state.warnings,{code:'unapproved-topics',message:'A historical topic notice.',context:'assignment',paperIds:['1:PREPARATION'],conditionFingerprint:'old-generation'});const historical=h.state.warnings[0];await h.controller.invoke('dismiss-warning',{id:historical.id});
  await build(h);await h.controller.invoke('apply-tag-list',{id:h.state.tagPreparation!.id});await h.controller.invoke('tag',{scope:'selected'});await h.controller.waitForIdle();const first=h.state.run!.id;
  assert.equal(h.state.warnings.find(value=>value.id===historical.id)!.status,'dismissed');assert.equal(h.state.warnings.some(value=>value.code==='unapproved-topics'&&value.status==='active'),false);assert.equal((await h.controller.snapshot()).assignmentReview!.report,undefined);assert.ok(h.state.uncoveredTopics!.some(topic=>topic.runId===first&&topic.name==='Electrode porosity'&&topic.evidence[0].text===h.paper.abstract));
  await h.controller.invoke('tag',{scope:'selected'});await h.controller.waitForIdle();assert.equal(h.state.warnings.find(value=>value.id===historical.id)!.status,'dismissed');assert.ok(h.state.uncoveredTopics!.some(topic=>topic.runId===h.state.run!.id&&topic.name==='Electrode porosity'));assert.ok(h.state.uncoveredTopics!.some(topic=>topic.runId===first));
});
