import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {ControllerEnvironment,MaintenanceTask} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import type {ReconciliationInput} from '../src/tag-reconciliation.ts';
import {MY_TAGS_SHELF_ID} from '../src/tag-shelves.ts';
import {acceptNativeTagDefinitionResult,compileNativeTagDefinitions,createNativeTagDefinitionWork,failNativeTagDefinitionTask,nextNativeTagDefinitionRequests,noteNativeTagDefinitionDispatch,resolveNativeTagDefinition,resumeNativeTagDefinitionWork,retryNativeTagDefinitionWork,validNativeTagDefinitionWork} from '../src/native-tag-definition.ts';
import type {NativeTagDefinitionRequest,NativeTagDefinitionWork} from '../src/native-tag-definition.ts';

const clone=<T>(value:T):T=>structuredClone(value);
const meaning={name:'Batteries',fullName:'electrochemical batteries',description:'Electrochemical devices that store and release electrical energy through battery reactions.',facet:'system',aliases:[]};
const other:TagDefinition={id:'saved-capture-cell',name:'CO2 capture cell',fullName:'electrochemical carbon dioxide capture cell',description:'An electrochemical cell for carbon dioxide capture.',facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],custom:false,status:'approved',matchingMode:'suggest'};
type Input={workId:string;fingerprint:string;taskId:string;phase:string;entries:{entryId:string;definition?:TagDefinition}[];papers:{entryId:string;paperId:string;sourceFingerprint:string;paper:{abstract:string}}[]};
const input=(request:NativeTagDefinitionRequest):Input=>JSON.parse(request.prompt.split('INPUT_DATA_JSON:\n')[1]);
function echo(entry:NativeTagDefinitionWork['entries'][number]){const {name,fullName,description,facet,aliases}=entry.definition!;return {entryId:entry.id,name,fullName,description,facet,aliases:clone(aliases)};}
function reply(request:NativeTagDefinitionRequest,relation='same-meaning') {
  const data=input(request);return {workId:data.workId,fingerprint:data.fingerprint,taskId:data.taskId,definitions:[] as Record<string,unknown>[],judgments:data.papers.map(paper=>({entryId:paper.entryId,paperId:paper.paperId,sourceFingerprint:paper.sourceFingerprint,relation,reason:'The supplied source establishes this scientific distinction.',evidence:[{source:'abstract',text:paper.paper.abstract}],supportFactConceptIds:[]})),questions:[] as Record<string,unknown>[]};
}
function fixture(){
  const papers:PaperRecord[]=Array.from({length:17},(_,index)=>{const key=`RECOVERY${String(index).padStart(2,'0')}`,paper:PaperRecord={id:`1:${key}`,itemID:index+1,libraryID:1,key,title:`Synthetic energy study ${index}`,abstract:index===16?'An electrochemical CO2 capture cell couples carbon dioxide capture with electricity storage.':'A battery stores electrical energy through reversible electrochemical battery reactions.',keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);return paper;});
  const data:ReconciliationInput={papers,nativeTags:Object.fromEntries(papers.map(paper=>[paper.id,[{tag:'Batteries',type:0}]])),definitions:[clone(other)],facts:{},decisions:{},vocabularyVersion:1,applied:true};
  let work=createNativeTagDefinitionWork(data,['Batteries'],{maxOutputTokens:25000});const draft=nextNativeTagDefinitionRequests(work)[0],draftReply=reply(draft);draftReply.definitions=[{entryId:work.entries[0].id,...meaning,question:'Which energy storage topic should Batteries mean?',choices:[{label:'Use the broad battery meaning',...meaning},{label:'Use capture cells',targetTagId:other.id}]}];draftReply.judgments=[];
  work=acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(work,draft.id),draft.id,draftReply);
  work=resolveNativeTagDefinition(work,data,{entryId:work.entries[0].id,choiceId:work.entries[0].questionDetails!.choices[0].id});const first=nextNativeTagDefinitionRequests(work)[0];assert.equal(input(first).papers.length,16);work=acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(work,first.id),first.id,reply(first));
  const last=nextNativeTagDefinitionRequests(work)[0];assert.equal(input(last).papers.length,1);return {data,work,last};
}
function legacyFailure(){
  const h=fixture(),entry=h.work.entries[0],first=reply(h.last,'different');first.questions=[{entryId:entry.id,question:'The last source is a capture cell rather than a conventional battery. Keep it separate or choose a different meaning?',questionKind:'meaning',choices:[{label:'Keep the battery meaning; this source is outside its scope',...echo(entry),targetTagId:entry.tagId},{label:'Use capture cells',targetTagId:other.id}]}];
  let work=failNativeTagDefinitionTask(noteNativeTagDefinitionDispatch(h.work,h.last.id),h.last.id,JSON.stringify(first),'The proposed saved tag is outside this request snapshot.',{provider:'deepseek',model:'paid-model'});work.tasks.find(task=>task.id===h.last.id)!.status='pending';work.status='pending';
  const correction=reply(h.last,'uncertain');correction.definitions=[{...echo(entry),targetTagId:other.id}];correction.questions=[{entryId:entry.id,question:'The source needs clarification.',questionKind:'information'}];
  work=failNativeTagDefinitionTask(noteNativeTagDefinitionDispatch(work,h.last.id),h.last.id,JSON.stringify(correction),'Supporting checks cannot change the frozen tag meanings.',{provider:'deepseek',model:'paid-model'});return {...h,work};
}

test('an exact frozen echo may accompany a source check without changing its meaning or target',()=>{
  const {data,work,last}=fixture(),response=reply(last),entry=work.entries[0];response.definitions=[{...echo(entry),targetTagId:entry.tagId}];
  const result=acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(work,last.id),last.id,response);
  assert.equal(result.status,'ready');assert.equal(result.entries[0].status,'ready');assert.equal(fingerprint(result.entries[0].definition),fingerprint(entry.definition));assert.equal(result.entries[0].targetTagId,undefined);assert.equal(Object.keys(result.entries[0].judgments).length,17);assert.equal(compileNativeTagDefinitions(result,data).entries.length,1);assert.equal(validNativeTagDefinitionWork(result),true);assert.match(last.prompt,/Return an empty definitions array/);
});

test('changed meanings, foreign targets, duplicate echoes, stale sources and unsupported evidence remain rejected',()=>{
  for(const change of [
    (response:ReturnType<typeof reply>,entry:NativeTagDefinitionWork['entries'][number])=>{response.definitions=[{...echo(entry),description:'A different scientific meaning.'}];},
    (response:ReturnType<typeof reply>,entry:NativeTagDefinitionWork['entries'][number])=>{response.definitions=[{...echo(entry),targetTagId:other.id}];},
    (response:ReturnType<typeof reply>,entry:NativeTagDefinitionWork['entries'][number])=>{response.definitions=[{...echo(entry)},{...echo(entry)}];},
    (response:ReturnType<typeof reply>,entry:NativeTagDefinitionWork['entries'][number])=>{response.definitions=[echo(entry)];response.judgments[0].sourceFingerprint='stale';},
    (response:ReturnType<typeof reply>,entry:NativeTagDefinitionWork['entries'][number])=>{response.definitions=[echo(entry)];response.judgments[0].evidence=[];}
  ]){
    const {work,last}=fixture(),response=reply(last);change(response,work.entries[0]);let result=acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(work,last.id),last.id,response);result=acceptNativeTagDefinitionResult(noteNativeTagDefinitionDispatch(result,last.id),last.id,response);
    assert.equal(result.status,'failed');assert.equal(Object.keys(result.entries[0].judgments).length,16);assert.equal(fingerprint(result.entries[0].definition),fingerprint(work.entries[0].definition));assert.equal(resumeNativeTagDefinitionWork(result).status,'failed');
  }
});

test('a cached self-candidate choice recovers the last source locally and does not repeat a contradicted meaning',()=>{
  const {data,work}=legacyFailure(),before=fingerprint(work),recovered=resumeNativeTagDefinitionWork(work),entry=recovered.entries[0];
  assert.equal(work.status,'failed');assert.equal(recovered.status,'ready');assert.equal(entry.status,'question');assert.equal(Object.keys(entry.judgments).length,17);assert.equal(entry.judgments[data.papers[16].id].relation,'different');assert.equal(nextNativeTagDefinitionRequests(recovered).length,0);
  assert.deepEqual(entry.humanAnswer,work.entries[0].humanAnswer);assert.deepEqual(entry.definition,work.entries[0].definition);for(const [paperId,judgment] of Object.entries(work.entries[0].judgments))assert.deepEqual(entry.judgments[paperId],judgment);
  assert.deepEqual(recovered.tasks.map(task=>task.attempts),work.tasks.map(task=>task.attempts));assert.deepEqual(recovered.tasks.map(task=>task.dispatches),work.tasks.map(task=>task.dispatches));assert.equal(fingerprint(work),before);assert.equal(validNativeTagDefinitionWork(recovered),true);
  assert.equal(entry.questionDetails!.choices.length,1);assert.ok(entry.questionDetails!.choices.every(choice=>fingerprint(choice.definition)!==fingerprint(entry.definition)));assert.deepEqual(resumeNativeTagDefinitionWork(recovered),recovered);assert.deepEqual(retryNativeTagDefinitionWork(recovered),recovered);assert.equal(compileNativeTagDefinitions(recovered,data).entries.length,0);
  const left=resolveNativeTagDefinition(recovered,data,{entryId:entry.id,leaveUndefined:true});assert.equal(left.status,'ready');assert.equal(left.entries[0].status,'left-undefined');assert.equal(nextNativeTagDefinitionRequests(left).length,0);assert.deepEqual(left.entries[0].judgments,entry.judgments);assert.equal(validNativeTagDefinitionWork(left),true);
});

function controllerFixture(){
  const h=legacyFailure(),state=initialState();state.papers=Object.fromEntries(h.data.papers.map(paper=>[paper.id,clone(paper)]));state.nativeTags=clone(h.data.nativeTags);state.tags=clone(h.data.definitions);state.vocabularyVersion=1;Object.assign(state.settings,{provider:'deepseek',model:'paid-model',budgetUSD:0.01,inputPricePerMillion:10000,outputPricePerMillion:10000,maxOutputTokens:25000});
  const task:MaintenanceTask={id:'cached-meaning-task',kind:'define-native',status:'paused',definitionWorkId:h.work.id,createdAt:'2026-11-01T00:00:00Z',cursor:4,groupIds:[],paperIds:h.data.papers.map(paper=>paper.id),error:'Some meanings could not be checked. Retry the remaining work; completed results are saved.',run:{id:'cached-meaning-run',kind:'rebuild',scope:'selected',automatic:false,status:'paused',jobs:h.data.papers.map(paper=>({id:`job-${paper.id}`,paperId:paper.id,status:'pending'})),vocabCursor:0,vocabFinished:false,spentUSD:0.37,settings:clone(state.settings),vocabularyVersion:1}};
  state.nativeDefinitionPreparation={work:h.work,taskId:task.id,shelfId:MY_TAGS_SHELF_ID,appliedEntryIds:[],processingPolicy:'auto-clear'};state.maintenanceTasks=[task];let requests=0,writes=0;
  const env:ControllerEnvironment={host:{async list(){return clone(h.data.papers);},async read(itemID){return clone(h.data.papers.find(paper=>paper.itemID===itemID)??null);},async readTags(itemID){return clone(h.data.nativeTags[h.data.papers.find(paper=>paper.itemID===itemID)!.id]);},async pdfText(){throw new Error('No repeated source extraction');},async apply(){writes++;throw new Error('No native tag writes');},async show(){},async saveSearch(){}},librarySnapshot:async()=>({papers:clone(h.data.papers),nativeTags:clone(h.data.nativeTags)}),persist:async()=>{},ai:{async hasApiKey(){return true;},async getSession(){return {connected:false,sharing:false,email:null,accountId:null,accounts:[]};},async completeJson(){requests++;throw new Error('No paid requests');},async testConnection(){throw new Error('No connection test');},async listModels(){return [];},async setApiKey(){},async removeApiKey(){},async signIn(){throw new Error('No sign-in');},cancelSignIn(){},async signOut(){return {revoked:true};},async selectAccount(){}}};
  return {state,task,app:new AppController(state,env),counts:()=>({requests,writes})};
}

for(const action of ['resume','retry-tag-meanings'])test(`${action} reuses cached paid meaning replies and preserves spending with an unaffordable request budget`,async()=>{
  const h=controllerFixture(),before=clone(h.state.nativeDefinitionPreparation!.work);assert.equal(validState(h.state),true);await h.app.initialize();const paused=await h.app.snapshot();assert.equal(paused.queue.phase,'checking');assert.deepEqual(paused.queue.phaseProgress,{completed:16,total:17,label:'Sources checked'});assert.doesNotMatch(paused.nativeDefinitionPreparation!.error!,/connection/i);
  await h.app.invoke(action,{id:before.id});await h.app.waitForIdle();const snapshot=await h.app.snapshot(),after=h.state.nativeDefinitionPreparation!.work;
  assert.equal(snapshot.nativeDefinitionPreparation!.status,'ready');assert.equal(snapshot.nativeDefinitionPreparation!.questionCount,1);assert.equal(snapshot.nativeDefinitionPreparation!.savedCount,0);assert.equal(h.task.status,'completed');assert.equal(h.task.run.status,'idle');assert.equal(h.task.run.spentUSD,0.37);assert.equal(Object.keys(after.entries[0].judgments).length,17);assert.deepEqual(after.tasks.map(task=>task.attempts),before.tasks.map(task=>task.attempts));assert.deepEqual(h.counts(),{requests:0,writes:0});assert.equal(validState(h.state),true);
  await h.app.invoke('leave-tag-undefined',{id:before.id,entryId:after.entries[0].id});await h.app.waitForIdle();assert.equal((await h.app.snapshot()).nativeDefinitionPreparation!.status,'finished');assert.deepEqual(h.counts(),{requests:0,writes:0});assert.equal(h.task.run.spentUSD,0.37);
});
