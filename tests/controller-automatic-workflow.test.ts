import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import type {NativeTag,TagPatch} from '../src/platform.ts';
import {NO_TAG_ID} from '../src/tag-policy.ts';

const copy=<T>(value:T):T=>structuredClone(value);
const definition=(id:string):TagDefinition=>({id,name:id==='clear'?'proton transport':`${id} effect`,description:`The scientific meaning of ${id}.`,facet:'phenomenon',custom:false,status:'approved',matchingMode:id==='manual'?'manual':'auto',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[]});
type Input={approvedVocabulary:{id:string}[];paper:{title:string;abstract:string}};
type Reply=(input:Input)=>unknown;

function fixture(count=1,saved?:AppState){
  const state=saved??initialState();
  if(!saved){state.tags=['clear','medium','remove','locked','rejected','manual'].map(definition);state.taxonomyReady=true;state.vocabularyVersion=3;Object.assign(state.settings,{provider:'chatgpt',model:'automatic-model',autoAssign:false});}
  const papers:PaperRecord[]=Array.from({length:count},(_,index)=>{const itemID=index+1,paper:PaperRecord={id:`1:P${itemID}`,itemID,libraryID:1,key:`P${itemID}`,title:`Transport experiment ${itemID}`,abstract:`Experiment ${itemID} measured proton transport through a membrane under controlled conditions.`,keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);return paper;});
  const native:Record<string,NativeTag[]>=copy(state.nativeTags);for(const paper of papers)native[paper.id]??=[{tag:'Manual project',type:0}];
  const suggested=(input:Input,id='clear',confidence='high')=>({tagId:id,reason:'The paper directly measures this defined scientific phenomenon.',confidence,match:'substantive',evidence:[{source:'abstract',text:input.paper.abstract}]});
  let reply:Reply=input=>({summary:'A transport experiment.',concepts:[],needsPDF:false,suggestions:[suggested(input)],newTagCandidates:[]});
  const calls:Input[]=[],writes:TagPatch[][]=[];
  const ai:ControllerEnvironment['ai']={async completeJson(_system,prompt){const input=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]) as Input;calls.push(copy(input));const value=reply(input);return {value,text:JSON.stringify(value),usage:{inputTokens:20,outputTokens:20},usageKnown:true,estimatedCostUSD:0.001};},async hasApiKey(){return true;},async getSession(){return {connected:true,sharing:true,email:null,accountId:null,accounts:[]};},async listModels(){return [];},async testConnection(){throw new Error('Not used');},async setApiKey(){},async removeApiKey(){},async signIn(){throw new Error('Not used');},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}};
  const host:ControllerEnvironment['host']={async list(){return copy(papers);},async read(itemID){return copy(papers.find(paper=>paper.itemID===itemID)??null);},async readTags(itemID){return copy(native[`1:P${itemID}`]??[]);},async pdfText(){return '';},async apply(patches){writes.push(copy(patches));for(const patch of patches){assert.deepEqual(native[patch.paperId],patch.before);native[patch.paperId]=copy(patch.after);}},async show(){},async saveSearch(){}};
  const controller=new AppController(state,{ai,host,persist:async()=>{}});
  return {controller,get state(){return controller.state;},papers,native,calls,writes,suggested,respond:(handler:Reply)=>{reply=handler;}};
}
async function assign(h:ReturnType<typeof fixture>){await h.controller.invoke('tag',{scope:'library',processingPolicy:'auto-clear'});await h.controller.waitForIdle();assert.equal(h.state.run!.status,'idle',h.state.run!.message);return h.state.run!.id;}

test('one requested run applies 100 clear additions and finishes while uncertain cases remain reviewable',async()=>{
  const h=fixture(102);h.native['1:P101'].push({tag:'remove effect',type:0});h.state.ownership['1:P101']={remove:{name:'remove effect',changeId:'older-change'}};
  h.respond(input=>input.paper.title.endsWith(' 102')?{summary:'An outside-vocabulary experiment.',concepts:[],needsPDF:false,suggestions:[],noMatch:true,noMatchReason:'These source concepts are outside the selected scientific meanings.',noMatchEvidence:[{source:'abstract',text:input.paper.abstract}],newTagCandidates:[]}:input.paper.title.endsWith(' 101')?{summary:'An uncertain measurement.',concepts:[],needsPDF:false,suggestions:[h.suggested(input,'medium','medium')],newTagCandidates:[]}:{summary:'A supported measurement.',concepts:[],needsPDF:false,suggestions:[h.suggested(input)],newTagCandidates:[]});
  const runId=await assign(h);
  assert.equal(Object.values(h.native).filter(tags=>tags.some(tag=>tag.tag==='proton transport')).length,100);
  assert.ok(Object.values(h.native).every(tags=>tags.some(tag=>tag.tag==='Manual project')));
  assert.equal(h.state.assignmentRuns!.find(run=>run.id===runId)!.status,'finished');
  const pending=h.state.suggestions.filter(row=>row.runId===runId&&row.status==='pending');assert.ok(pending.some(row=>row.tagId==='medium'));assert.ok(pending.some(row=>row.operation==='remove'));assert.ok(pending.some(row=>row.tagId===NO_TAG_ID));assert.ok(pending.every(row=>!row.applied));
  assert.ok(h.native['1:P101'].some(tag=>tag.tag==='remove effect'));assert.ok(!h.native['1:P102'].some(tag=>tag.tag==='no_tag'));
  const view=await h.controller.snapshot();assert.equal(view.reviewItems!.filter(item=>item.kind==='assignment'&&item.state==='open').length,3);assert.ok(view.assignmentReview!.report);assert.equal(validState(h.state),true);
});

test('automatic clear assignment keeps manual-only tags, locks, rejections, and existing native names protected',async()=>{
  const h=fixture();h.state.decisions['1:P1|locked']={locked:true};h.state.decisions['1:P1|rejected']={rejected:true};
  h.respond(input=>({summary:'A transport measurement.',concepts:[],needsPDF:false,suggestions:['clear','locked','rejected','manual'].map(id=>h.suggested(input,id)),newTagCandidates:[]}));
  await assign(h);assert.ok(h.native['1:P1'].some(tag=>tag.tag==='proton transport'));assert.ok(h.native['1:P1'].some(tag=>tag.tag==='Manual project'));assert.ok(!h.native['1:P1'].some(tag=>['locked effect','rejected effect','manual effect'].includes(tag.tag)));assert.deepEqual(h.state.decisions,{'1:P1|locked':{locked:true},'1:P1|rejected':{rejected:true}});
});

test('keyword-only and incidental matches stay unapplied even when the model reports high confidence',async()=>{
  const h=fixture(2);h.papers[0].keywords=['proton transport'];
  h.respond(input=>({summary:'A limited transport mention.',concepts:[],needsPDF:false,suggestions:[input.paper.title.endsWith(' 1')?{tagId:'clear',reason:'The imported keyword mentions the topic.',confidence:'high',match:'substantive',evidence:[{source:'keyword',text:'proton transport'}]}:{...h.suggested(input),match:'incidental'}],newTagCandidates:[]}));
  await assign(h);assert.equal(h.writes.length,0);assert.ok(Object.values(h.native).every(tags=>!tags.some(tag=>tag.tag==='proton transport')));assert.equal(h.state.suggestions.filter(row=>row.status==='pending'&&!row.applied).length,2);
});

test('incoming assignment requires explicit opt-in and no pilot review',async()=>{
  const h=fixture();await h.controller.onItemChanged(1);await h.controller.waitForIdle();assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
  await h.controller.invoke('save-settings',{settings:{...h.state.settings,autoAssign:true}});assert.equal(h.state.settings.autoAssign,true);assert.equal(h.state.pilotReviewed,false);
  h.papers.push({...copy(h.papers[0]),id:'1:P2',itemID:2,key:'P2',title:'Transport experiment 2'});h.native['1:P2']=[{tag:'Manual project',type:0}];
  await h.controller.onItemChanged(2);await h.controller.waitForIdle();assert.ok(h.native['1:P2'].some(tag=>tag.tag==='proton transport'));assert.equal(h.state.run!.automatic,true);assert.equal(h.state.run!.processingPolicy,'auto-clear');
  await h.controller.invoke('save-settings',{settings:{...h.state.settings,autoAssign:false}});const calls=h.calls.length;h.papers[0].abstract+=' Updated operating conditions.';await h.controller.onItemChanged(1);await h.controller.waitForIdle();assert.equal(h.calls.length,calls);
});

test('deferring an exception survives cached reruns and restart without creating a permanent rejection',async()=>{
  const h=fixture();h.respond(input=>({summary:'An uncertain measurement.',concepts:[],needsPDF:false,suggestions:[h.suggested(input,'medium','medium')],newTagCandidates:[]}));
  await assign(h);const item=h.state.reviewItems!.find(item=>item.kind==='assignment')!;await h.controller.invoke('defer-review-item',{id:item.id});assert.equal(h.state.reviewItems!.find(row=>row.id===item.id)!.state,'deferred');
  const calls=h.calls.length;await assign(h);assert.equal(h.calls.length,calls);assert.equal(h.state.reviewItems!.filter(row=>row.kind==='assignment').length,1);assert.equal(h.state.reviewItems!.find(row=>row.id===item.id)!.state,'deferred');assert.deepEqual(h.state.decisions,{});
  const restored=fixture(1,copy(h.state));await restored.controller.initialize();assert.equal(restored.state.reviewItems!.find(row=>row.id===item.id)!.state,'deferred');await restored.controller.invoke('reopen-review-item',{id:item.id});assert.equal(restored.state.reviewItems!.find(row=>row.id===item.id)!.state,'open');assert.deepEqual(restored.state.decisions,{});
});

test('undoing an automatic addition prevents identical cached work from immediately adding it again',async()=>{
  const h=fixture();await assign(h);const change=h.state.history.find(change=>change.label==='Automatic tag assignments')!;assert.ok(change);assert.ok(h.native['1:P1'].some(tag=>tag.tag==='proton transport'));
  await h.controller.invoke('undo',{id:change.id});assert.ok(!h.native['1:P1'].some(tag=>tag.tag==='proton transport'));const calls=h.calls.length;
  await assign(h);assert.equal(h.calls.length,calls);assert.ok(!h.native['1:P1'].some(tag=>tag.tag==='proton transport'));assert.equal(h.state.decisions['1:P1|clear'],undefined);assert.ok(h.state.automaticSuppressions?.length);
});

test('accepting the latest repeated exception resolves its shared queue item without reviving historical pending suggestions',async()=>{
  const h=fixture();h.respond(input=>({summary:'An uncertain measurement.',concepts:[],needsPDF:false,suggestions:[h.suggested(input,'medium','medium')],newTagCandidates:[]}));
  const firstRun=await assign(h),first=h.state.reviewItems!.find(item=>item.kind==='assignment')!,firstSuggestion=first.suggestionId;
  const latestRun=await assign(h),latest=h.state.reviewItems!.find(item=>item.id===first.id)!;
  assert.notEqual(latestRun,firstRun);assert.equal(latest.taskId,latestRun);assert.notEqual(latest.suggestionId,firstSuggestion);
  await h.controller.invoke('resolve-review-item',{id:latest.id,action:'accept'});
  assert.ok(h.native['1:P1'].some(tag=>tag.tag==='medium effect'));assert.equal(h.writes.length,1);assert.equal(h.state.reviewItems!.find(item=>item.id===latest.id)!.state,'resolved');
  assert.ok(h.state.suggestions.some(suggestion=>suggestion.id===firstSuggestion&&suggestion.status==='pending'&&!suggestion.applied),'Historical results remain unchanged.');
  const restored=fixture(1,copy(h.state));await restored.controller.initialize();await assign(restored);
  assert.ok(restored.state.reviewItems!.every(item=>item.kind!=='assignment'||item.state==='resolved'));assert.equal(restored.writes.length,0);
});

test('rejecting the latest repeated exception keeps all historical pending copies out of the queue',async()=>{
  const h=fixture();h.respond(input=>({summary:'An uncertain measurement.',concepts:[],needsPDF:false,suggestions:[h.suggested(input,'medium','medium')],newTagCandidates:[]}));
  await assign(h);const original=h.state.reviewItems!.find(item=>item.kind==='assignment')!.suggestionId;await assign(h);
  const latest=h.state.reviewItems!.find(item=>item.kind==='assignment'&&item.state==='open')!;await h.controller.invoke('resolve-review-item',{id:latest.id,action:'reject'});
  assert.equal(h.state.decisions['1:P1|medium'].rejected,true);assert.ok(h.state.suggestions.some(suggestion=>suggestion.id===original&&suggestion.status==='pending'));
  await assign(h);const restored=fixture(1,copy(h.state));await restored.controller.initialize();
  assert.ok(restored.state.reviewItems!.every(item=>item.kind!=='assignment'||item.state==='resolved'));assert.equal(restored.writes.length,0);assert.ok(!restored.native['1:P1'].some(tag=>tag.tag==='medium effect'));
});

test('deferral stays with the same condition while changed paper content or scientific meaning creates a new current choice',async()=>{
  const h=fixture();h.respond(input=>({summary:'An uncertain measurement.',concepts:[],needsPDF:false,suggestions:[h.suggested(input,'medium','medium')],newTagCandidates:[]}));
  await assign(h);const first=h.state.reviewItems!.find(item=>item.kind==='assignment')!;await h.controller.invoke('defer-review-item',{id:first.id});await assign(h);
  assert.equal(h.state.reviewItems!.find(item=>item.id===first.id)!.state,'deferred');assert.equal(h.state.reviewItems!.filter(item=>item.kind==='assignment').length,1);
  h.papers[0].abstract+=' The paper now reports new measured operating conditions.';await assign(h);
  const sourceChoice=h.state.reviewItems!.find(item=>item.kind==='assignment'&&item.state==='open')!;assert.ok(sourceChoice);assert.notEqual(sourceChoice.id,first.id);assert.equal(h.state.reviewItems!.find(item=>item.id===first.id)!.state,'resolved');
  await h.controller.invoke('defer-review-item',{id:sourceChoice.id});const tag=h.state.tags.find(tag=>tag.id==='medium')!;await h.controller.invoke('save-tag',{tag:{...copy(tag),description:'A revised scientific meaning restricted to the new operating conditions.'}});await assign(h);
  const meaningChoice=h.state.reviewItems!.find(item=>item.kind==='assignment'&&item.state==='open')!;assert.ok(meaningChoice);assert.notEqual(meaningChoice.id,sourceChoice.id);assert.equal(h.state.reviewItems!.find(item=>item.id===sourceChoice.id)!.state,'resolved');assert.deepEqual(h.state.decisions,{});
});

test('omitting an earlier exception from a later explicit reply does not invent a negative judgment',async()=>{
  const h=fixture();h.respond(input=>({summary:'An uncertain measurement.',concepts:[],needsPDF:false,suggestions:[h.suggested(input,'medium','medium')],newTagCandidates:[]}));
  const firstRun=await assign(h),item=copy(h.state.reviewItems!.find(item=>item.kind==='assignment')!);
  h.state.settings.model='another-selected-model';h.respond(()=>({summary:'No additional explicit suggestions.',concepts:[],needsPDF:false,suggestions:[],newTagCandidates:[]}));await assign(h);
  const retained=h.state.reviewItems!.find(row=>row.id===item.id)!;assert.equal(retained.state,'open');assert.equal(retained.taskId,firstRun);assert.equal(retained.suggestionId,item.suggestionId);assert.deepEqual(h.state.decisions,{});assert.equal(h.writes.length,0);
});
