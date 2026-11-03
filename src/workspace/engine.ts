import {AppController,automaticAssignmentHistoryId} from '../controller.ts';
import type {AppState,ControllerEnvironment} from '../controller.ts';
import {ProviderError} from '../providers.ts';
import type {CompletionResult,ProviderClient,ProviderSettings} from '../providers.ts';
import type {LibraryHost,NativeTag,TagPatch} from '../platform.ts';
import {sameTags} from '../platform.ts';
import {paperFingerprint,fingerprint,validateEvidence} from '../core.ts';
import type {PaperRecord,TagDefinition} from '../core.ts';
import {isPersonalNativeTagName} from '../native-meaning-policy.ts';
import {normalizeNativePaper} from './native-host.ts';
import type {NativePaperTransport,NativeInputSources} from './native-host.ts';
import {sameMetadata} from '../paper-recovery.ts';
import type {WorkspaceCommand,CommandReceipt} from '../workspace-contract.ts';
import {WorkspaceStore} from './storage.ts';
import type {StoreOperation,RecordMetadata,RetentionResult,StoredRecord} from './storage-contract.ts';
import {WorkingContext,metadataFor} from './context.ts';
import {SimilarityIndex} from './similarity.ts';
import {projectBuildResult,seedBuildResult} from './build-results.ts';
import {initializeWorkflowPolicy,isRetiredDefinition,isRetiredWorkflowCommand} from './workflow-policy.ts';
import {newRunOperations,projectRun,startsRun,updateRun,runUpdateOperations} from './runs.ts';
import type {RunRecord} from './runs.ts';

type AI=ControllerEnvironment['ai'];
type CommandRecord={command:WorkspaceCommand;status:'queued'|'running'|'completed'|'failed'|'unknown';taskId?:string;runId?:string;result?:unknown;error?:string;createdAt:number};
type FrozenPaperIdentity={itemID:number;paperId:string};
type QueuedInput={command:WorkspaceCommand;createdAt:number};
const queuedCommands=new Set('prepare-tags tag rebuild extend-assignment-topics retry-tag-preparation retry-selection resume scan retry-papers regenerate-taxonomy use-faster-build clean-expired-data reset-paper-analysis'.split(' '));
const paperScopedCommands=new Set('prepare-tags tag rebuild scan'.split(' '));
const queueKeys:Record<string,readonly string[]>={
  'prepare-tags':['scope','mode','processingPolicy','targetCount','additionalTargetCount'],tag:['scope','tagIds','processingPolicy'],rebuild:['scope','mode','processingPolicy'],scan:['scope'],
  'retry-tag-preparation':['id'],'retry-papers':['ids'],'regenerate-taxonomy':['id'],'retry-unknown-request':['id'],'stop-unknown-request':['id'],
  'extend-assignment-topics':['runId','paperIds','additionalTargetCount','processingPolicy'],
};
const coreFields='settings vocabularyVersion pilotReviewed pilotVersion pilotExpected taxonomyReady workflow approvedTaxonomyInput pendingChange'.split(' ');
const coreRecords='tags definitionOrigins verifiedConnections models nativeBindingExclusions automaticSuppressions taxonomyRedirects userEditedTagIds deferredItemIDs'.split(' ');
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
const yieldTask=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
/** Request identity is independent of SQLite, compression and payload manifests. */
export async function requestIdentity(system:string,prompt:string,settings:Pick<ProviderSettings,'mode'|'model'>,cryptoImpl:Crypto=crypto):Promise<string>{
  const bytes=new TextEncoder().encode(JSON.stringify(['workspace-paid-reply-v1',settings.mode,settings.model,system,prompt]));
  return [...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function notDispatched(message:string){return Object.assign(new ProviderError(message,'configuration'),{dispatched:false as const});}
function frozenIdentities(value:unknown):FrozenPaperIdentity[]{
  if(!Array.isArray(value)||value.length>10000)throw new Error('The saved paper selection exceeds its supported size.');
  const seen=new Set<number>();return value.map(value=>{const row=object(value);if(!Number.isSafeInteger(row.itemID)||Number(row.itemID)<=0||typeof row.paperId!=='string'||!row.paperId||row.paperId.length>1000||seen.has(Number(row.itemID)))throw new Error('The saved paper selection contains an invalid identity.');seen.add(Number(row.itemID));return {itemID:Number(row.itemID),paperId:row.paperId};});
}
/** Only scientific task inputs are durable; connection secrets never enter this path. */
function queuedInput(command:WorkspaceCommand):WorkspaceCommand{
  const source=object(command.payload),payload:Record<string,unknown>={};
  for(const key of queueKeys[command.type]??[]){const value=source[key];if(value===undefined)continue;
    if(key==='scope'&&!['pilot','selected','collections','library'].includes(String(value))||key==='mode'&&!['extend','replace'].includes(String(value))||key==='processingPolicy'&&value!=='auto-clear'||['targetCount','additionalTargetCount'].includes(key)&&(!Number.isInteger(value)||Number(value)<1||Number(value)>500))throw new Error('A queued task contains an unsupported processing option.');
    if(key==='choices'){
      if(!Array.isArray(value)||value.length>1000)throw new Error('Too many scientific draft choices were queued.');
      payload.choices=value.map(value=>{const choice=object(value),result:Record<string,string>={};for(const field of ['groupId','name','description'])if(choice[field]!==undefined){if(typeof choice[field]!=='string'||choice[field].length>(field==='description'?16000:1000))throw new Error('A queued scientific choice is invalid.');result[field]=choice[field];}return result;});
    }else if(Array.isArray(value)){
      if(value.length>10000||value.some(item=>typeof item!=='string'||item.length>1000))throw new Error('A queued task contains invalid names or identities.');payload[key]=[...value];
    }else if(typeof value==='string'&&value.length<=1000||typeof value==='number'&&Number.isFinite(value))payload[key]=value;
    else throw new Error('A queued task contains an invalid option.');
  }
  if(source.frozenPaperIDs!==undefined&&paperScopedCommands.has(command.type))payload.frozenPaperIDs=frozenIdentities(source.frozenPaperIDs);
  return {type:command.type,payload};
}

export interface EngineDependencies {
  store:WorkspaceStore;
  host:LibraryHost;
  ai:AI;
  clock?:()=>number;
  yieldControl?:()=>Promise<void>;
  changed?:(revision:number)=>void|Promise<void>;
  importFile?:ControllerEnvironment['importFile'];
  exportFile?:ControllerEnvironment['exportFile'];
  credentialStatus?:()=>string;
  cleanupBackups?:(signal?:AbortSignal)=>Promise<unknown>;
  signal?:AbortSignal;
}

/** Private scientific kernel: only command working records are hydrated. */
export class WorkspaceEngine {
  context:WorkingContext;
  private logicalBinding?:{id:string;previousSourceId?:string;resume?:boolean};
  private retiredIds=new Set<string>();
  private kernel!:AppController;
  private now:()=>number;
  private yieldControl:()=>Promise<void>;
  private tail:Promise<unknown>=Promise.resolve();
  private checkpointTail:Promise<void>=Promise.resolve();
  private running=new Map<string,Promise<CommandReceipt>>();
  private submitting=new Map<string,Promise<CommandReceipt>>();
  private cancelled=new Set<string>();
  private maintenanceSignals=new Map<string,AbortController>();
  private closed=false;
  private nativeGroup='';
  private displaySignatures=new Map<string,string>();
  private recoveredQueue=new Map<string,CommandRecord>();
  private restoringQueue?:Promise<void>;
  private frozenPaperScope?:{scope:string;identities:readonly FrozenPaperIdentity[]};
  private readonly store:WorkspaceStore;
  private similarity:SimilarityIndex;
  private deps:EngineDependencies;
  constructor(deps:EngineDependencies){this.deps=deps;this.store=deps.store;this.similarity=new SimilarityIndex(deps.store);this.context=new WorkingContext(deps.store,{clock:deps.clock,signal:deps.signal});this.now=deps.clock??Date.now;this.yieldControl=deps.yieldControl??yieldTask;}
  async open({fresh=false}:{fresh?:boolean}={}):Promise<void>{
    if(fresh)await this.context.seed();
    const transition=await initializeWorkflowPolicy(this.store,{clock:this.now,yieldControl:this.yieldControl,signal:this.deps.signal});
    let retiredAfter:string|undefined;do{const page=await this.store.scan('retiredDefinitions',{after:retiredAfter,limit:50});for(const row of page.rows)this.retiredIds.add(row.id);retiredAfter=page.next;}while(retiredAfter);
    for(const field of coreFields)await this.context.field(field);
    for(const collection of coreRecords)await this.context.records(collection);
    const host=this.scopedHost(this.deps.host),ai=this.guardedAI(this.deps.ai);
    this.kernel=new AppController(this.context.state,{host,ai,partialReviewContext:true,persist:state=>this.checkpoint(state),importFile:this.deps.importFile,exportFile:this.deps.exportFile,credentialStatus:this.deps.credentialStatus,beforePaper:id=>this.context.paper(id),afterPaper:async id=>{const paper=this.context.state.papers[id];if(paper)await this.similarity.update([paper]);this.context.releasePaper(id,{keepMetadata:true,keepFacts:this.context.state.run?.kind==='rebuild'});await this.yieldControl();},workflowPolicyVersion:1,retiredDefinitionIds:this.retiredIds,guardDefinitionChanges:async ids=>{for(const id of ids)if(await isRetiredDefinition(this.store,id))throw new Error('This change would restore a retired definition. Build tags from papers instead.');},beforeAutomaticAssignment:runId=>this.context.records('history',{ids:[automaticAssignmentHistoryId(runId)]}),updateNeighbors:papers=>this.similarity.update(papers),cacheReused:(collection,id)=>this.store.touch(collection,id)});
    Object.defineProperty(this.kernel,'state',{configurable:true,enumerable:true,get:()=>this.context.state,set:(state:AppState)=>{this.context.setState(state);}});
    const interrupted=await this.store.get('state','run',{path:['status'],maxBytes:256});
    if(interrupted==='running')await this.context.field('run');
    const runningTasks=await this.store.scan('maintenanceTasks',{status:'running',limit:50});if(runningTasks.rows.length)await this.context.records('maintenanceTasks',{ids:runningTasks.rows.map(row=>row.id)});
    if(this.context.state.pendingChange){
      const change=this.context.state.pendingChange;
      for(const patch of change.patches)await this.context.paper(patch.paperId);
      await this.context.records('decisions',{ids:Object.keys({...change.beforeDecisions,...change.afterDecisions})});
      await this.context.records('history',{ids:[change.undoOfId,change.automaticGroupId].filter((id):id is string=>!!id)});
      const original=change.undoOfId?this.context.state.history.find(history=>history.id===change.undoOfId):undefined;await this.context.records('suggestions',{ids:[...new Set([...change.suggestionIds,...original?.suggestionIds??[]])]});
    }
    await this.kernel.recoverWorkspace();
    if(transition.blocked){
      const recovered=await initializeWorkflowPolicy(this.store,{clock:this.now,yieldControl:this.yieldControl,signal:this.deps.signal});
      if(!recovered.blocked){this.context=new WorkingContext(this.store,{clock:this.now,signal:this.deps.signal});this.retiredIds.clear();await this.open();return;}
    }
    if(await this.store.reference('workspace','analysisReset')){await this.hydrate('reset-paper-analysis',{});await this.kernel.invoke('reset-paper-analysis');await this.resetIndexedAnalysis();}
    if(!fresh)await this.warmDisplayHeaders();
    if(!fresh)await seedBuildResult(this.store,this.now);
    if(fresh||transition.changed)await this.project(new Set(['tags']));
    // A command that crossed its durable start marker is never blindly replayed.
    for(const status of ['running','queued']){
      let after:string|undefined;
      do{const page=await this.store.scan('commandLedger',{status,after,limit:50});for(const row of page.rows){const value=await this.store.codec.read(row.token) as CommandRecord;if(status==='queued'&&queuedCommands.has(value.command.type)&&await this.store.reference('queuedInputs',row.id)){this.recoveredQueue.set(row.id,value);continue;}const message=status==='running'?'This command was interrupted. Review its saved result before trying again.':'This queued command did not start. Start it again when ready.';await this.store.put('commandLedger',row.id,{...value,status:status==='running'?'unknown':'failed',error:message},{category:'ledger',status:status==='running'?'unknown':'failed',taskId:value.taskId,updatedAt:this.now()});await this.failedQueueMarker(value,message);}after=page.next;await this.yieldControl();}while(after);
    }
  }
  execute(command:WorkspaceCommand,options:{commandId:string}):Promise<CommandReceipt>{
    const active=this.submitting.get(options.commandId);if(active)return active;
    const receipt=command.type==='retry-run'?this.retryRun(String(object(command.payload).id??''),options):this.enqueue(command,options);this.submitting.set(options.commandId,receipt);void receipt.finally(()=>this.submitting.delete(options.commandId)).catch(()=>{});return receipt;
  }
  private async retryRun(id:string,options:{commandId:string}):Promise<CommandReceipt>{
    const prior=await this.store.get('commandLedger',options.commandId,{maxBytes:32*1024}) as CommandRecord|undefined;
    if(prior)return this.enqueue(prior.command,options,id);
    const run=await this.store.get('runs',id,{maxBytes:32*1024}) as RunRecord|undefined;
    if(!run||!run.canRetry||!['paused','failed'].includes(run.status))throw new Error('This run is not waiting for a retry.');
    const original=await this.store.get('runInputs',id,{maxBytes:2*1024*1024}) as WorkspaceCommand|undefined;
    if(!original)throw new Error('The original selection has expired. Start a new run.');
    const currentId=await this.store.get('state','run',{path:['id'],maxBytes:4096}),currentStatus=await this.store.get('state','run',{path:['status'],maxBytes:64});
    const command=run.sourceRunId===currentId&&currentStatus==='paused'?{type:'resume'}:original;
    return this.enqueue(command,options,id);
  }
  private async stopRun(id:string){
    const run=await this.store.get('runs',id,{maxBytes:32*1024}) as RunRecord|undefined;
    if(!run||!run.canStop&&run.status!=='failed')throw new Error('This run has already stopped.');
    for(const status of ['queued','running']){let after:string|undefined;do{const page=await this.store.scan('commandLedger',{status,after,limit:50});for(const row of page.rows){const command=await this.store.codec.read(row.token,{maxBytes:32*1024}) as CommandRecord;if(command.runId===id)this.cancelled.add(row.id);}after=page.next;}while(after);}
    if(run.sourceRunId&&run.sourceRunId===this.context.state.run?.id)await this.kernel.invoke('cancel');
    const pending=await this.store.scan('pendingRunIntents',{taskId:id,limit:50});
    if(pending.total){await this.context.field('paperExclusionPreview');await this.context.field('pendingTopicExtension');await this.kernel.invoke('cancel-paper-exclusion');for(const row of pending.rows)await this.store.delete('pendingRunIntents',row.id);}
    await updateRun(this.store,id,{status:'stopped',phase:'stopped',message:'Stopped. Saved results are kept.',canRetry:false,canStop:false},this.now());
    return {runId:id};
  }
  private async pauseRun(id:string){
    const run=await this.store.get('runs',id,{maxBytes:32*1024}) as RunRecord|undefined;
    if(!run||!['running','queued'].includes(run.status))throw new Error('This run is no longer running.');
    if(run.sourceRunId&&run.sourceRunId===this.context.state.run?.id)await this.kernel.invoke('pause');
    else{for(const status of ['queued','running']){let after:string|undefined;do{const page=await this.store.scan('commandLedger',{status,after,limit:50});for(const row of page.rows){const value=await this.store.codec.read(row.token,{maxBytes:32*1024}) as CommandRecord;if(value.runId===id)this.cancelled.add(row.id);}after=page.next;}while(after);}}
    await updateRun(this.store,id,{status:'paused',message:'Paused. Resume when you are ready.',canRetry:true,canStop:true},this.now());return {runId:id};
  }
  private async saveVerifiedSearch(payload:Record<string,unknown>){
    const filter=object(payload.filter),selections=Array.isArray(filter.selections)?filter.selections.map(object):[],name=String(payload.name??'').trim().slice(0,160);
    if(!name||!selections.length||selections.length>50||!['all','any'].includes(String(filter.mode)))throw new Error('Name the filter and choose scientific tags.');
    const checked:{conceptId:string;contextId?:string}[]=[];
    for(const selection of selections){
      if(typeof selection.conceptId!=='string'||selection.contextId!==undefined&&typeof selection.contextId!=='string')throw new Error('Choose a current saved tag.');
      for(const id of [selection.conceptId,selection.contextId].filter((id):id is string=>!!id))if(!await this.store.reference('tags',id))throw new Error('One selected tag is no longer active. Refresh the search.');
      checked.push({conceptId:selection.conceptId,...(selection.contextId?{contextId:selection.contextId}:{})});
    }
    const id=fingerprint(name.toLocaleLowerCase());
    if(!await this.store.reference('savedFilters',id)&&(await this.store.scan('savedFilters',{limit:1})).total>=50)throw new Error('Delete an unused saved filter before adding another.');
    await this.store.put('savedFilters',id,{id,name,filter:{mode:filter.mode,selections:checked}},{category:'active',title:name});return {id};
  }
  private async enqueue(command:WorkspaceCommand,{commandId}:{commandId:string},retryRunId?:string):Promise<CommandReceipt>{
    if(this.closed)throw new Error('Smart Tags is closed.');
    if(isRetiredWorkflowCommand(command.type))throw new Error('DIY and native-tag meaning tools have been retired. Build tags from papers instead.');
    if(!commandId||commandId.length>180||!command.type)throw new Error('A workspace command needs a bounded identity and action.');
    await this.resumeQueued();
    const active=this.running.get(commandId);if(active)return active;
    const prior=await this.store.get('commandLedger',commandId,{maxBytes:32*1024}) as CommandRecord|undefined;
    if(prior){
      if(prior.status==='completed'||prior.status==='queued')return {commandId,revision:(await this.store.reference('commandLedger',commandId))!.version,...(prior.taskId?{taskId:prior.taskId}:{}),...(prior.runId?{runId:prior.runId}:{}),...(prior.result!==undefined?{result:prior.result}:{})};
      throw new Error(prior.error||'This command already started. Check Runs before trying again.');
    }
    const taskId=queuedCommands.has(command.type)?`task-${crypto.randomUUID()}`:undefined;
    if(taskId)command=queuedInput(command);
    const previewId=['apply-paper-exclusion','cancel-paper-exclusion'].includes(command.type)?String(object(command.payload).previewId??await this.store.get('state','paperExclusionPreview',{path:['id'],maxBytes:4096})??''):'';
    const pending=previewId?await this.store.get('pendingRunIntents',previewId,{maxBytes:4096}) as {id:string}|undefined:undefined;
    const runId=retryRunId??pending?.id??(startsRun(command.type)?`run-${crypto.randomUUID()}`:undefined);
    const record:CommandRecord={command:{type:command.type},status:'queued',createdAt:this.now(),...(taskId?{taskId}:{}),...(runId?{runId}:{})};
    const operations:StoreOperation[]=[{kind:'put',collection:'commandLedger',id:commandId,value:record,metadata:{category:'ledger',status:'queued',taskId,updatedAt:this.now(),...(taskId?{refs:[{collection:'queuedInputs',id:commandId}]}:{})}}];
    if(taskId)operations.push({kind:'put',collection:'queuedInputs',id:commandId,value:{command,createdAt:this.now()} satisfies QueuedInput,metadata:{category:'active',status:'queued',taskId,pinned:true}});
    if(runId&&!retryRunId&&!pending)operations.push(...newRunOperations(runId,command,this.now()));
    if(retryRunId){const previous=await this.store.get('runs',retryRunId,{maxBytes:32*1024}) as RunRecord;operations.push(...await runUpdateOperations(this.store,retryRunId,{status:'queued',phase:'queued',attemptCount:(previous.attemptCount??1)+1,canRetry:false,canStop:true,error:undefined,message:'Waiting to continue.'},this.now()));}
    if(runId){const kind=retryRunId||pending?await this.store.get('runs',runId,{path:['kind'],maxBytes:64}):command.type==='tag'?'assignment':'build';operations.push({kind:'put',collection:'state',id:kind==='assignment'?'latestAssignmentLogicalRunId':'latestBuildLogicalRunId',value:runId,metadata:{category:'active'}});}
    await this.store.commit({commandId:commandId+':queue',operations});await this.deps.changed?.((await this.store.stats()).revision);
    const perform=()=>this.perform(commandId,record,command);
    const urgent=command.type==='pause'||command.type==='pause-run'||command.type==='cancel'||command.type==='stop-run'||command.type==='cancel-sign-in';
    const operation=urgent?perform():this.tail.catch(()=>{}).then(perform);
    if(!urgent)this.tail=operation;
    this.running.set(commandId,operation);void operation.finally(()=>this.running.delete(commandId)).catch(()=>{});
    if(taskId){void operation.catch(()=>{});return {commandId,revision:(await this.store.stats()).revision,taskId,...(runId?{runId}:{})};}
    return operation;
  }
  /** Pre-start intents resume only after the runtime has made the workspace ready. */
  resumeQueued():Promise<void>{
    if(this.restoringQueue)return this.restoringQueue;
    this.restoringQueue=(async()=>{for(const [commandId,record] of this.recoveredQueue){
      if(this.closed)return;
      try{const input=await this.store.get('queuedInputs',commandId,{maxBytes:32*1024*1024}) as QueuedInput|undefined;
        if(!input||input.command.type!==record.command.type)throw new Error('The saved queued task input is unavailable.');
        const command=queuedInput(input.command),operation=this.tail.catch(()=>{}).then(()=>this.perform(commandId,record,command));this.tail=operation;this.running.set(commandId,operation);void operation.finally(()=>this.running.delete(commandId)).catch(()=>{});
      }catch(error){const message='The queued input could not be restored. Its saved input was kept. '+errorText(error);await this.store.put('commandLedger',commandId,{...record,status:'failed',error:message},{category:'ledger',status:'failed',taskId:record.taskId,refs:[{collection:'queuedInputs',id:commandId}]});await this.failedQueueMarker(record,message);await this.deps.changed?.((await this.store.stats()).revision);}
      this.recoveredQueue.delete(commandId);await this.yieldControl();
    }})().finally(()=>{this.restoringQueue=undefined;});return this.restoringQueue;
  }
  private async failedQueueMarker(record:CommandRecord,message:string){if(record.runId){if(/cancelled/.test(message)&&await this.store.get('runs',record.runId,{path:['status'],maxBytes:64})==='paused')return;await updateRun(this.store,record.runId,{status:'failed',message:'This run could not finish. Retry to continue with its saved work.',error:message,canRetry:true,canStop:false},this.now());}}
  private async completedInput(commandId:string,status:string):Promise<StoreOperation[]>{const row=await this.store.reference('queuedInputs',commandId);return row?[{kind:'reference',collection:'queuedInputs',id:commandId,token:row.token,metadata:{category:'history',status,completedAt:this.now(),taskId:row.metadata.taskId}}]:[];}
  private async stopQueuedTask(id:string){
    const task=await this.store.get('activityTasks',id,{maxBytes:32*1024}) as {state?:string;workId?:string;[key:string]:unknown}|undefined;
    if(!task||task.state!=='paused'||task.workId)throw new Error('This task is no longer an interrupted queued attempt.');
    const rows=await this.store.scan('commandLedger',{taskId:id,statuses:['failed','unknown'],limit:1}),row=rows.rows[0];if(!row)throw new Error('This task belongs to active scientific work. Use its own task controls.');
    const command=await this.store.codec.read(row.token,{maxBytes:32*1024}) as CommandRecord;
    await this.store.commitRecords([{kind:'put',collection:'commandLedger',id:row.id,value:{...command,status:'failed',error:'This attempt was stopped.'},metadata:{category:'ledger',status:'failed',taskId:id}},{kind:'put',collection:'activityTasks',id,value:{...task,state:'completed',message:'This attempt was stopped. Completed results are kept.'},metadata:{category:'history',status:'completed',completedAt:this.now()}},...await this.completedInput(row.id,'stopped')]);return {stopped:true};
  }
  private async perform(commandId:string,record:CommandRecord,command:WorkspaceCommand):Promise<CommandReceipt>{
    if(this.closed)throw new Error('This command was cancelled before it started.');
    if(this.cancelled.has(commandId)){
      const runOperations=record.runId&&await this.store.get('runs',record.runId,{path:['status'],maxBytes:64})!=='paused'?await runUpdateOperations(this.store,record.runId,{status:'stopped',message:'Cancelled before processing. Saved results are kept.',canRetry:false,canStop:false},this.now()):[];
      await this.store.commitRecords([{kind:'put',collection:'commandLedger',id:commandId,value:{...record,status:'failed',error:'This command was cancelled before it started.'},metadata:{category:'ledger',status:'failed'}},...await this.completedInput(commandId,'cancelled'),...runOperations]);
      await this.deps.changed?.((await this.store.stats()).revision);throw new Error('This command was cancelled before it started.');
    }
    await this.store.put('commandLedger',commandId,{...record,status:'running'},{category:'ledger',status:'running',taskId:record.taskId,updatedAt:this.now()});
    const frozen=object(command.payload).frozenPaperIDs;
    const previousScope=this.frozenPaperScope;
    if(frozen!==undefined)this.frozenPaperScope={scope:String(object(command.payload).scope??(command.type==='tag'||command.type==='rebuild'?'pilot':'library')),identities:frozenIdentities(frozen)};
    try{
      if(record.runId)await updateRun(this.store,record.runId,{status:'running',phase:'preparing',message:'Preparing the selected papers.',canRetry:false,canStop:true,error:undefined},this.now());
      if(command.type==='pause'||command.type==='cancel')for(const controller of this.maintenanceSignals.values())controller.abort(new Error('Cleanup cancelled.'));
      if(command.type==='reset-paper-analysis')await this.store.put('workspace','analysisReset',{commandId,startedAt:this.now()},{category:'ledger',status:'running',pinned:true});
      await this.hydrate(command.type,object(command.payload));
      if(this.cancelled.has(commandId))throw new Error('This command was cancelled before it started.');
      await this.authorizeInvalidRetry(command,commandId);
      let payload=command.payload??{};
      if(command.type==='set-kept-existing-tags'&&Array.isArray(object(payload).changes)){
        const plan=this.context.state.keepTagPlan;if(!plan||plan.id!==object(payload).planId)throw new Error('The saved Keep choices changed. Read the library tags again.');
        const names=new Set(plan.keptNames);for(const change of object(payload).changes as unknown[]){const row=object(change);if(typeof row.name!=='string'||typeof row.kept!=='boolean')throw new Error('A Keep change needs its name and choice.');if(row.kept)names.add(row.name);else names.delete(row.name);}payload={planId:plan.id,names:[...names]};
      }
      this.logicalBinding=record.runId?{id:record.runId,previousSourceId:this.context.state.run?.id,resume:command.type==='resume'}:undefined;
      const result=command.type==='delete-saved-filter'?await this.store.delete('savedFilters',String(object(payload).id??'')):command.type==='save-search'?await this.saveVerifiedSearch(object(payload)):command.type==='pause-run'?await this.pauseRun(String(object(command.payload).id??'')):command.type==='stop-run'?await this.stopRun(String(object(command.payload).id??'')):command.type==='clean-expired-data'?await this.cleanExpired(commandId):command.type==='stop-queued-task'?await this.stopQueuedTask(String(object(command.payload).id??'')):command.type==='retry-unknown-request'||command.type==='stop-unknown-request'?await this.resolveUnknown(command.type,String(object(command.payload).id??'')):await this.kernel.invoke(command.type,payload);
      if(command.type==='reset-paper-analysis')await this.resetIndexedAnalysis();
      await this.checkpoint(this.kernel.state);
      if(record.runId){
        const run=await this.store.get('runs',record.runId,{maxBytes:32*1024}) as RunRecord|undefined,preview=this.context.state.paperExclusionPreview;
        if(!run?.sourceRunId&&preview){await this.store.put('pendingRunIntents',preview.id,{id:record.runId},{category:'active',taskId:record.runId});await updateRun(this.store,record.runId,{status:'paused',message:'Choose whether to include these excluded papers before building tags.',canRetry:false,canStop:true},this.now());}
        else if(command.type==='cancel-paper-exclusion')await updateRun(this.store,record.runId,{status:'stopped',message:'Cancelled. Excluded papers were kept out of tagging.',canRetry:false,canStop:false},this.now());
        if(run?.sourceRunId||command.type==='cancel-paper-exclusion'){const page=await this.store.scan('pendingRunIntents',{taskId:record.runId,limit:50});for(const row of page.rows)await this.store.delete('pendingRunIntents',row.id);}
      }
      const receipt=await this.store.commit({commandId:commandId+':complete',operations:[{kind:'put',collection:'commandLedger',id:commandId,value:{...record,status:'completed',result},metadata:{category:'ledger',status:'completed',taskId:record.taskId,updatedAt:this.now()}},...(record.taskId?[{kind:'delete' as const,collection:'activityTasks',id:record.taskId}]:[]),...await this.completedInput(commandId,'completed')],receipt:result});
      await this.deps.changed?.(receipt.revision);
      return {commandId,revision:receipt.revision,...(record.taskId?{taskId:record.taskId}:{}),...(record.runId?{runId:record.runId}:{}),...(result!==undefined?{result}:{})};
    }catch(error){
      await this.store.put('commandLedger',commandId,{...record,status:'failed',error:errorText(error)},{category:'ledger',status:'failed',taskId:record.taskId,updatedAt:this.now()});
      await this.failedQueueMarker(record,errorText(error));
      await this.store.commitRecords(await this.completedInput(commandId,'failed'));
      await this.deps.changed?.((await this.store.stats()).revision);throw error;
    }finally{this.frozenPaperScope=previousScope;this.logicalBinding=undefined;}
  }
  private async hydrate(action:string,payload:Record<string,unknown>){
    if(action==='clean-expired-data'||action==='stop-queued-task'||action==='stop-run'||action==='pause-run')return;
    if(action==='open-meaning-work'){
      const id=String(payload.id??'');await this.context.field('nativeDefinitionPreparation');
      if(this.context.state.nativeDefinitionPreparation?.work.id!==id){await this.archiveRecord('nativeDefinitionHistory',['work','id'],id);const archived=this.context.state.nativeDefinitionHistory?.findLast(review=>review.work.id===id);if(archived)await this.context.records('maintenanceTasks',{ids:[archived.taskId]});}
      await this.context.records('reviewItems',{statuses:['open','deferred']});this.kernel.state=this.context.state;return;
    }
    if(['save-settings','save-api-key','remove-api-key','discover-models','test-connection','sign-in','cancel-sign-in','sign-out','select-account','show-paper','save-search','delete-saved-filter','export-vocabulary'].includes(action))return;
    for(const field of ['run','taxonomyProposal','tagPreparation','activeTagPreparation','taxonomyEvidence','taxonomyEvidenceScopes','taxonomyReview','metadataPreview','paperExclusionPreview','pendingTopicExtension'])await this.context.field(field);
    await this.context.records('reviewItems',{statuses:['open','deferred']});await this.context.records('maintenanceTasks',{statuses:['queued','running','paused']});await this.context.records('assignmentRuns',{statuses:['analysis','review']});
    const assignmentId=typeof payload.runId==='string'?payload.runId:this.context.state.run?.kind==='tag'?this.context.state.run.id:undefined;if(assignmentId)await this.context.records('assignmentRuns',{ids:[assignmentId]});
    for(const field of ['uncoveredTopics','warnings','decisions','ownership','taxonomySupport'])await this.context.records(field);
    if(/meaning|native|review-item/.test(action)||['reset-paper-analysis','resume','retry-unknown-request','stop-unknown-request'].includes(action))await this.context.field('nativeDefinitionPreparation');
    if(/prepare|taxonomy|selection|rebuild|resume/.test(action)||action==='extend-assignment-topics'){
      await this.context.catalog();
      const ids=new Set([...(this.context.state.taxonomyProposal?.paperIds??[]),...(this.context.state.run?.kind==='rebuild'?this.context.state.run.jobs.map(job=>job.paperId):[])]);
      for(const id of ids)await this.context.paper(id);
    }
    const ids=[...(Array.isArray(payload.ids)?payload.ids.filter((id):id is string=>typeof id==='string'):[]),...(Array.isArray(payload.paperIds)?payload.paperIds.filter((id):id is string=>typeof id==='string'):[]),...(typeof payload.id==='string'?[payload.id]:[])];
    if(/suggestion|assignment|finish|review-item|undo/.test(action)){
      await this.context.records('suggestions',typeof payload.runId==='string'?{taskId:payload.runId}:{});
      for(const suggestion of this.context.state.suggestions)if(!ids.length||ids.includes(suggestion.id))await this.context.paper(suggestion.paperId);
    }
    if(action==='undo'&&typeof payload.id==='string'){
      await this.context.records('history',{ids:[payload.id]});const history=this.context.state.history.find(change=>change.id===payload.id);for(const patch of history?.patches??[])await this.context.paper(patch.paperId);
    }
    if(['open-review-item','resolve-review-item'].includes(action)&&typeof payload.id==='string'){
      const item=this.context.state.reviewItems?.find(item=>item.id===payload.id),workId=item?.workId;
      if(item?.kind==='assignment'){
        if(item.paperId)await this.context.paper(item.paperId);if(item.suggestionId)await this.context.records('suggestions',{ids:[item.suggestionId]});await this.context.records('assignmentRuns',{ids:[item.taskId]});
      }else if(item?.ownerPage==='vocabulary'&&workId&&this.context.state.nativeDefinitionPreparation?.work.id!==workId){
        await this.archiveRecord('nativeDefinitionHistory',['work','id'],workId);
        const archived=this.context.state.nativeDefinitionHistory?.findLast(review=>review.work.id===workId);if(archived)await this.context.records('maintenanceTasks',{ids:[archived.taskId]});
      }else if(item?.ownerPage==='cleanup'&&workId&&this.context.state.tagPreparation?.id!==workId){
        await this.archiveRecord('preparationHistory',['preparation','id'],workId);
        const archived=this.context.state.preparationHistory?.findLast(review=>review.preparation?.id===workId);if(archived)await this.archiveRecord('tagSelectionHistory',['work','id'],archived.proposal.id);
      }
    }
    if(action==='restore-taxonomy'&&typeof payload.id==='string')await this.context.records('taxonomyArchives',{ids:[payload.id]});
    for(const id of ids)if(await this.store.reference('papers',id))await this.context.paper(id);
    this.kernel.state=this.context.state;
  }
  private async archiveRecord(collection:string,path:readonly string[],identity:string){
    let after:string|undefined,found:StoredRecord|undefined;
    const lookup=async(indexed:boolean)=>{do{const page=await this.store.scan(collection,{taskId:indexed?identity:undefined,after,limit:50});for(const row of page.rows){const token=await this.store.codec.lookup(row.token,path);if(token&&await this.store.codec.read(token,{maxBytes:2048})===identity&&(!found||Number(row.metadata.order??row.metadata.updatedAt??0)>=Number(found.metadata.order??found.metadata.updatedAt??0)))found=row;}after=page.next;await this.yieldControl();}while(after);};
    await lookup(true);if(!found)await lookup(false);if(found)await this.context.records(collection,{ids:[found.id]});
  }
  private async warmDisplayHeaders(){
    const preparation=await this.store.reference('state','tagPreparation');
    if(!preparation||await this.store.reference('viewHeaders','tagPreparation'))return;
    await this.context.field('tagPreparation');await this.context.field('taxonomyProposal');
    this.kernel.state=this.context.state;await this.project(new Set(['tagPreparation']));
  }
  private async resolveUnknown(action:string,id:string){
    if(!id||id.length>1000)throw new Error('Choose the interrupted request in Recovery.');
    const record=await this.store.get('providerDispatches',id,{maxBytes:32*1024}) as {status?:string;taskId?:string;[key:string]:unknown}|undefined;
    if(!record||!['unknown','dispatched','stopped'].includes(record.status??''))throw new Error('This request no longer needs recovery.');
    await this.store.put('providerDispatches',id,{...record,status:action==='retry-unknown-request'?'retry-authorized':'stopped',resolvedAt:this.now()},{category:'ledger',status:action==='retry-unknown-request'?'retry-authorized':'stopped',taskId:record.taskId,refs:await this.recordLinks('providerDispatches',id)});
    if(action==='retry-unknown-request'){
      if(record.status!=='stopped'&&record.taskId&&record.taskId===this.context.state.run?.id&&this.context.state.run.status==='paused'){await this.kernel.invoke('resume');return {authorized:true,startNewRun:false};}
      return {authorized:true,startNewRun:true};
    }
    if(record.taskId){const link=await this.store.get('runLinks',record.taskId,{maxBytes:4096}) as {id:string}|undefined;if(link)await updateRun(this.store,link.id,{status:'stopped',message:'Stopped after an interrupted AI request. Saved results and its budget reservation are kept.',canStop:false,canRetry:false},this.now());}
    if(!record.taskId||record.taskId===this.context.state.run?.id||this.context.state.maintenanceTasks?.some(task=>task.run.id===record.taskId&&task.status!=='completed'))await this.kernel.invoke('cancel');
    return {stopped:true};
  }
  private async authorizeInvalidRetry(command:WorkspaceCommand,commandId:string){
    if(!['resume','retry-papers','retry-tag-meanings','retry-tag-preparation','retry-selection','continue-tag-meanings','test-connection'].includes(command.type))return;
    const state=this.context.state,payload=object(command.payload),paperIds=new Set(Array.isArray(payload.ids)?payload.ids:[]),owners=new Set<string>();
    if(command.type==='retry-tag-meanings'||command.type==='continue-tag-meanings'){
      const review=state.nativeDefinitionPreparation,task=review&&review.work.id===payload.id?state.maintenanceTasks?.find(task=>task.id===review.taskId):undefined;if(task&&task.status!=='completed')owners.add(task.run.id);
    }else if(command.type==='resume'){
      if(state.run?.status==='paused')owners.add(state.run.id);for(const task of state.maintenanceTasks??[])if(task.status==='paused')owners.add(task.run.id);
    }else if(command.type==='retry-papers'){
      if(state.run?.jobs.some(job=>paperIds.has(job.paperId)))owners.add(state.run.id);for(const task of state.maintenanceTasks??[])if(task.run.jobs.some(job=>paperIds.has(job.paperId)))owners.add(task.run.id);
    }else if(state.run?.kind==='rebuild'&&(command.type==='retry-selection'||command.type==='retry-tag-preparation'&&state.tagPreparation?.id===payload.id))owners.add(state.run.id);
    for(const taskId of owners){let after:string|undefined;do{
      const page=await this.store.scan('providerDispatches',{taskId,status:'completed',after,limit:50});
      for(const row of page.rows){const value=await this.store.codec.read(row.token,{maxBytes:16*1024}) as {status:string};if(value.status==='invalid')await this.store.put('providerDispatches',row.id,{...value,status:'invalid-retry-authorized',retryCommandId:commandId},{...row.metadata,taskId,status:'completed'});}
      after=page.next;await this.yieldControl();
    }while(after);}
  }
  private async cleanExpired(commandId:string){
    const controller=new AbortController();this.maintenanceSignals.set(commandId,controller);
    let recordsRemoved=0,bytesRemoved=0,more=true;
    try{while(more&&!this.closed&&!this.cancelled.has(commandId)&&!controller.signal.aborted){const result=await this.store.retain(this.now(),50,controller.signal);recordsRemoved+=result.recordsRemoved;bytesRemoved+=result.bytesRemoved;more=result.more;await this.afterRetention(result);await this.yieldControl();}
      if(!this.closed&&!this.cancelled.has(commandId)&&!controller.signal.aborted)await this.deps.cleanupBackups?.(controller.signal);return {records:recordsRemoved,bytes:bytesRemoved,...(controller.signal.aborted?{cancelled:true}:{})};
    }catch(error){if(!controller.signal.aborted)throw error;return {records:recordsRemoved,bytes:bytesRemoved,cancelled:true};
    }finally{this.maintenanceSignals.delete(commandId);}
  }
  /** Reset is resumable and addresses indexes without decoding archived replies. */
  private async resetIndexedAnalysis(){
    for(const collection of ['facts','analyses','neighbors','paperInputs','cleanup','factHistory','preparedTags','definitionQuestions','nativeMeaningDisplays','paperAttentionRows']){
      let after:string|undefined;do{const page=await this.store.scan(collection,{after,limit:50});if(page.rows.length)await this.store.commit({commandId:'reset:'+collection+':'+crypto.randomUUID(),operations:page.rows.map(row=>({kind:'delete',collection,id:row.id}))});after=page.next;await this.yieldControl();}while(after);
    }
    for(const collection of ['suggestions','assignmentRuns']){
      let after:string|undefined;do{const page=await this.store.scan(collection,{after,limit:50});const operations:StoreOperation[]=[];for(const row of page.rows){const keep=collection==='suggestions'?await this.store.get(collection,row.id,{path:['applied'],maxBytes:16}):row.metadata.status==='finished';if(!keep)operations.push({kind:'delete',collection,id:row.id});}if(operations.length)await this.store.commit({commandId:'reset:'+collection+':'+crypto.randomUUID(),operations});after=page.next;await this.yieldControl();}while(after);
    }
    let after:string|undefined;
    do{const page=await this.store.scan('papers',{after,limit:50});for(const row of page.rows){
      const title=await this.store.get('papers',row.id,{path:['title']}) as string??'',abstract=await this.store.get('papers',row.id,{path:['abstract']}) as string??'',keywords=await this.store.get('papers',row.id,{path:['keywords']}) as string[]??[];
      const builder=this.store.codec.objectBuilder();let offset:number|undefined;
      do{const entries=await this.store.codec.entries(row.token,{after:offset,limit:50});for(const entry of entries.entries)if(!['summary','concepts','pdfText','fingerprint'].includes(String(entry.key)))await builder.append(String(entry.key),entry.token);offset=entries.next;}while(offset!==undefined);
      await builder.append('fingerprint',{value:paperFingerprint({title,abstract,keywords})});await this.store.putReference('papers',row.id,await builder.finish(),{...row.metadata,refs:await this.recordLinks('papers',row.id)});await this.yieldControl();
    }after=page.next;}while(after);
    for(const id of ['tagPreparation','nativeDefinitionPreparation','metadataPreview','paperExclusionPreview','existingTags','diyComparison'])await this.store.delete('viewHeaders',id);
    for(const collection of ['nativeMeaningEntries','nativeMeaningTasks']){let after:string|undefined;do{const page=await this.store.scan(collection,{after,limit:50});for(const row of page.rows)await this.store.putReference(collection,row.id,row.token,{...row.metadata,category:'history',status:'completed',pinned:false,completedAt:this.now(),refs:await this.recordLinks(collection,row.id)});after=page.next;await this.yieldControl();}while(after);}
    await this.context.rebase('papers');await this.store.delete('workspace','analysisReset');
  }
  private async recordLinks(collection:string,id:string){const refs:NonNullable<RecordMetadata['refs']>=[];let offset:number|undefined;do{const page=await this.store.links(collection,id,{offset,limit:50});refs.push(...page.rows);offset=page.next;}while(offset!==undefined);return refs;}
  private scopedHost(host:LibraryHost):LibraryHost {
    const read=async(itemID:number)=>{const paper=await host.read(itemID);if(paper)await this.context.paper(paper.id);return paper;};
    return {...host,list:async(scope)=>{let papers:PaperRecord[];const frozen=this.frozenPaperScope;
      if(frozen&&scope===frozen.scope){papers=[];for(const identity of frozen.identities){const current=await host.read(identity.itemID);if(!current||current.id!==identity.paperId)throw new Error('A paper selected for this queued task was removed or changed identity. Select the papers again; no new analysis was requested.');papers.push(current);await this.yieldControl();}papers.sort((a,b)=>a.id.localeCompare(b.id));}
      else papers=await host.list(scope);
      if(scope==='library'&&!frozen)await this.reconcileLibrary(new Set(papers.map(paper=>paper.id)));for(const paper of papers){await this.context.records('papers',{ids:[paper.id]});await this.yieldControl();}return papers;},read,readTags:host.readTags.bind(host),pdfText:host.pdfText.bind(host),show:host.show.bind(host),saveSearch:host.saveSearch.bind(host),...(host.saveConceptSearch?{saveConceptSearch:host.saveConceptSearch.bind(host)}:{}),...(host.inspectInputs?{inspectInputs:host.inspectInputs.bind(host)}:{}),...(host.lookupMetadata?{lookupMetadata:host.lookupMetadata.bind(host)}:{}),...(host.readMetadata?{readMetadata:host.readMetadata.bind(host)}:{}),...(host.applyMetadata?{applyMetadata:async(patches,label)=>{const group=this.kernel.state.pendingChange?.id??crypto.randomUUID();for(let offset=0;offset<patches.length;offset+=20){const chunk=patches.slice(offset,offset+20);if(host.readMetadata)for(const patch of chunk)if(!sameMetadata(await host.readMetadata(patch.itemID),patch.before))throw new Error('Paper metadata changed before this write. Refresh the preview.');await host.applyMetadata!(chunk,label);await this.nativeChunkAck(group,offset+chunk.length);await this.yieldControl();}}}:{}),apply:async(patches,label)=>{
      this.nativeGroup=this.kernel.state.pendingChange?.id??crypto.randomUUID();
      for(let offset=0;offset<patches.length;offset+=20){const chunk=patches.slice(offset,offset+20);for(const patch of chunk)if(!sameTags(await host.readTags(patch.itemID),patch.before))throw new Error('Paper tags changed before this write. Your other results are saved.');await host.apply(chunk,label);await this.nativeChunkAck(this.nativeGroup,offset+chunk.length);await this.yieldControl();}
    }};
  }
  private guardedAI(ai:AI):AI {
    return {hasApiKey:ai.hasApiKey.bind(ai),getSession:ai.getSession.bind(ai),testConnection:ai.testConnection.bind(ai),listModels:ai.listModels.bind(ai),setApiKey:ai.setApiKey.bind(ai),removeApiKey:ai.removeApiKey.bind(ai),signIn:ai.signIn.bind(ai),cancelSignIn:ai.cancelSignIn.bind(ai),signOut:ai.signOut.bind(ai),selectAccount:ai.selectAccount.bind(ai),completeJson:(system,prompt,settings,signal)=>this.complete(ai,system,prompt,settings,signal)};
  }
  private async complete(ai:AI,system:string,prompt:string,settings:ProviderSettings,signal?:AbortSignal):Promise<CompletionResult>{
    const id=await requestIdentity(system,prompt,settings),scope=await this.store.codec.encode({system,prompt,provider:settings.mode,model:settings.model,policy:'workspace-paid-reply-v1'});
    const prior=await this.store.get('providerDispatches',id,{maxBytes:16*1024}) as {status:string;error?:string;maxOutputTokens?:number;dispatchedAt?:number}|undefined;
    if(prior?.status==='replied'){
      const result=await this.store.get('providerReplies',id) as CompletionResult|undefined;
      if(result){const reference=await this.store.reference('providerReplies',id);await this.store.putReference('providerReplies',id,reference!.token,{...reference!.metadata,lastUsedAt:this.now(),refs:await this.recordLinks('providerReplies',id)});return {...result,usageKnown:true,estimatedCostUSD:0};}
    }
    if(prior?.status==='dispatched'||prior?.status==='unknown'||prior?.status==='stopped')throw notDispatched('A previous AI request has an unknown outcome. Its budget reservation is kept. Review recovery before sending it again.');
    if(prior?.status==='invalid'&&!(settings.maxOutputTokens&&prior.maxOutputTokens&&settings.maxOutputTokens>prior.maxOutputTokens)){
      const failure=await this.store.get('providerReplies',id) as {message:string;rawText:string;completion?:Omit<CompletionResult,'value'>}|undefined;if(failure)throw Object.assign(new ProviderError(failure.message,'invalid-response',{rawText:failure.rawText,completion:failure.completion?{...failure.completion,usageKnown:true,estimatedCostUSD:0}:undefined}),{dispatched:false as const});
    }
    if(signal?.aborted)throw notDispatched('This request was cancelled before dispatch.');
    const dispatchedAt=this.now(),taskId=this.context.state.maintenanceTasks?.find(task=>task.status==='running')?.run.id??this.context.state.run?.id;
    if(taskId){let after:string|undefined;do{const page=await this.store.scan('providerDispatches',{status:'unknown',taskId,after,limit:50});for(const row of page.rows){const legacy=await this.store.codec.read(row.token,{maxBytes:32*1024}) as {legacy?:boolean};if(legacy.legacy)throw notDispatched('An interrupted request from the previous version has an unknown outcome. Review Recovery before sending another request for this run.');}after=page.next;}while(after);}
    const dispatchOperations:StoreOperation[]=[{kind:'reference',collection:'providerScopes',id,token:scope,metadata:{category:'cache',lastUsedAt:this.now()}},{kind:'put',collection:'providerDispatches',id,value:{status:'dispatched',provider:settings.mode,model:settings.model,maxOutputTokens:settings.maxOutputTokens,dispatchedAt,taskId},metadata:{category:'ledger',status:'unknown',pinned:true,taskId,updatedAt:this.now(),refs:[{collection:'providerScopes',id}]}}];
    if(prior?.status==='invalid'||prior?.status==='invalid-retry-authorized'){const old=await this.store.reference('providerReplies',id);if(old)dispatchOperations.push({kind:'reference',collection:'providerReplyHistory',id:id+':'+crypto.randomUUID(),token:old.token,metadata:{category:'history',completedAt:prior.dispatchedAt??dispatchedAt,taskId,refs:[{collection:'providerScopes',id}]}});}
    await this.store.commitRecords(dispatchOperations);
    try{
      const reply=await ai.completeJson(system,prompt,settings,signal);
      const operations:StoreOperation[]=[{kind:'put',collection:'providerReplies',id,value:reply,metadata:{category:'cache',lastUsedAt:this.now(),refs:[{collection:'providerScopes',id}]}},{kind:'put',collection:'providerDispatches',id,value:{status:'replied',provider:settings.mode,model:settings.model,maxOutputTokens:settings.maxOutputTokens,dispatchedAt,taskId,usage:reply.usage,usageKnown:reply.usageKnown,estimatedCostUSD:reply.estimatedCostUSD},metadata:{category:'ledger',status:'completed',taskId}}];
      const job=this.context.state.run?.jobs.find(job=>job.status==='running'),nativeTask=this.context.state.nativeDefinitionPreparation?.work.tasks.find(task=>task.status==='running'),owner=nativeTask?{collection:'nativeMeaningTasks',id:nativeTask.id}:job?{collection:'runJobs',id:job.id}:undefined;
      if(owner){const row=await this.store.reference(owner.collection,owner.id);if(row)operations.push({kind:'reference',...owner,token:row.token,metadata:{...row.metadata,refs:[...await this.recordLinks(owner.collection,owner.id),{collection:'providerReplies',id}]}});}
      await this.store.commitRecords(operations);return reply;
    }catch(error){
      const failure=error as ProviderError,invalid=failure.category==='invalid-response'&&typeof failure.rawText==='string',known=['authentication','permission','quota','configuration'].includes(failure.category);
      const operations:StoreOperation[]=[{kind:'put',collection:'providerDispatches',id,value:{status:invalid?'invalid':known?'failed':'unknown',provider:settings.mode,model:settings.model,maxOutputTokens:settings.maxOutputTokens,dispatchedAt,taskId,error:errorText(error)},metadata:{category:'ledger',status:invalid?'completed':known?'failed':'unknown',taskId,pinned:!known&&!invalid,...(!known&&!invalid?{refs:[{collection:'providerScopes',id}]}:{})}}];
      if(invalid)operations.push({kind:'put',collection:'providerReplies',id,value:{message:failure.message,rawText:failure.rawText,completion:failure.completion},metadata:{category:'cache',lastUsedAt:this.now(),refs:[{collection:'providerScopes',id}]}});
      await this.store.commit({commandId:'request-failure:'+id+':'+crypto.randomUUID(),operations});throw error;
    }
  }
  private checkpoint(state:AppState):Promise<void>{
    const operation=this.checkpointTail.catch(()=>{}).then(async()=>{
      this.context.setState(state);if(!this.context.changedFields().size)return;
      for(const id of this.context.state.nativeDefinitionPreparation?.work.reusedJudgmentIds??[])await this.store.touch('nativeJudgments',id);
      const records=await this.context.checkpoint(state);
      if(records.size){
        const source=state.run,binding=this.logicalBinding,logicalId=binding&&(binding.resume||source?.id!==binding.previousSourceId)?binding.id:undefined;
        if(source&&logicalId&&!await this.store.reference('runLinks',source.id))await this.store.put('runLinks',source.id,{id:logicalId},{category:'ledger'});
        await this.project(new Set(records.keys()),records);
        await projectRun(this.store,state,logicalId,this.now());
        await this.deps.changed?.((await this.store.stats()).revision);
      }
    });this.checkpointTail=operation;return operation;
  }
  private async project(changed:Set<string>,records=new Map<string,Set<string>|null>()){
    const scientific=['tags','run','suggestions','reviewItems','nativeDefinitionPreparation','tagPreparation','maintenanceTasks','assignmentRuns','history','reconciliation','diyComparison','paperInputs','paperAttentionDismissals','metadataPreview','paperExclusionPreview'];
    if(scientific.some(field=>changed.has(field))){
      const views=this.kernel.workerViews();const operations:StoreOperation[]=[];
      const header=(id:string,value:unknown)=>{if(value===undefined)operations.push({kind:'delete',collection:'viewHeaders',id});else operations.push({kind:'put',collection:'viewHeaders',id,value,metadata:{category:'active'}});};
      const native=views.nativeDefinitionPreparation;if(native){
        const {rows,...small}=native,admitted=new Set(this.context.state.nativeDefinitionPreparation?.work.entries.filter(entry=>entry.meaningAdmission).map(entry=>entry.id)),deferred=new Set(this.context.state.reviewItems?.filter(item=>item.workId===native.id&&item.state==='deferred').map(item=>item.questionId));
        operations.push({kind:'put',collection:'viewHeaders',id:'nativeDefinitionPreparation',value:small,metadata:{category:'active',type:'native-decisions-v2'}});
        for(const [order,row] of rows.entries()){
          operations.push({kind:'put',collection:'nativeMeaningDisplays',id:row.id,value:row,metadata:{category:'active',taskId:native.id,status:row.status}});
          if(!row.applied&&row.status!=='left-undefined'&&!admitted.has(row.id))operations.push({kind:'put',collection:'nativeMeaningQueue',id:row.id,value:{entryId:row.id,...(row.reviewId?{reviewId:row.reviewId}:{})},metadata:{category:'active',taskId:native.id,status:deferred.has(row.id)?'deferred':'open',order}});
        }
      }else header('nativeDefinitionPreparation',undefined);
      const preparation=views.tagPreparation;if(preparation){const {tags,questions,...small}=preparation;header('tagPreparation',small);for(const tag of tags)operations.push({kind:'put',collection:'preparedTags',id:tag.id,value:tag,metadata:metadataFor('preparedTags',tag)});for(const question of questions)operations.push({kind:'put',collection:'definitionQuestions',id:question.id,value:question,metadata:{category:'active',taskId:preparation.id}});}else header('tagPreparation',undefined);
      for(const review of views.assignmentReviews)operations.push({kind:'put',collection:'assignmentDisplays',id:review.id,value:review,metadata:{category:review.status==='finished'?'history':'active',status:review.status,completedAt:this.now()}});
      for(const task of views.activityTasks)operations.push({kind:'put',collection:'activityTasks',id:task.id,value:task,metadata:{category:task.state==='completed'?'history':'active',status:task.state,completedAt:this.now()}});
      const {papers:attentionRows,...attentionHeader}=views.paperAttention;header('paperAttention',attentionHeader);for(const row of attentionRows)operations.push({kind:'put',collection:'paperAttentionRows',id:row.id,value:row,metadata:{category:'active',title:row.title,status:row.status}});
      if(views.existingTags){const {rows,...small}=views.existingTags;header('existingTags',small);for(const row of rows)operations.push({kind:'put',collection:'existingTagRows',id:row.id,value:row,metadata:{category:'active',taskId:small.id,title:row.name,searchText:[row.name,row.meaning,...row.targetNames].join('\n'),status:row.status,type:row.facet}});}else header('existingTags',undefined);
      if(views.diyComparison){const {pairs,...small}=views.diyComparison;header('diyComparison',small);for(const row of pairs)operations.push({kind:'put',collection:'diyComparisonRows',id:row.id,value:row,metadata:{category:'active',taskId:small.id,title:row.diyName+' '+row.targetName,status:row.relation}});}else header('diyComparison',undefined);
      header('metadataPreview',views.metadataPreview);
      const exclusion=this.context.state.paperExclusionPreview;header('paperExclusionPreview',exclusion?{id:exclusion.id,exclude:exclusion.exclude,changes:exclusion.patches.map(patch=>({paperId:patch.paperId,title:this.context.state.papers[patch.paperId]?.title??'Paper',before:patch.before.map(tag=>tag.tag),after:patch.after.map(tag=>tag.tag)}))}:undefined);
      for(const collection of ['nativeMeaningDisplays','nativeMeaningQueue','preparedTags','definitionQuestions','existingTagRows','diyComparisonRows']){const current=new Set(operations.filter(operation=>operation.collection===collection&&operation.kind!=='delete').map(operation=>operation.id));let after:string|undefined;do{const page=await this.store.scan(collection,{after,limit:50});for(const row of page.rows)if(!current.has(row.id))operations.push({kind:'delete',collection,id:row.id});after=page.next;}while(after);}
      const attentionIds=new Set(attentionRows.map(row=>row.id));for(const id of records.get('paperAttentionDismissals')??[])if(!attentionIds.has(id))operations.push({kind:'delete',collection:'paperAttentionRows',id});
      await this.persistProjections(operations);
      await projectBuildResult(this.store,views.buildResult,views.buildResultTagIds,this.now);
      if(views.buildResult){const link=await this.store.get('runLinks',views.buildResult.runId,{maxBytes:4096}) as {id:string}|undefined;if(link)await updateRun(this.store,link.id,{requiresChangeReview:views.buildResult.requiresChangeReview,newCount:views.buildResult.savedCount,reusedCount:views.buildResult.reusedCount,skippedCount:views.buildResult.skippedCount,unavailableCount:views.buildResult.unavailableCount,tagNames:views.buildResult.tagNames,choiceCount:0},this.now());}
    }
    if(changed.has('tags')||changed.has('nativeTags')||changed.has('papers')||changed.has('suggestions'))await this.index(changed,records);
    const tags=this.context.state.tags;
    await this.persistProjections([{kind:'put',collection:'state',id:'libraryCounts',value:{papers:(await this.store.scan('papers',{limit:1})).total,tags:tags.filter(tag=>!tag.builtin).length,definedTags:tags.filter(tag=>tag.status==='approved'&&!tag.builtin).length,assignableTags:tags.filter(tag=>tag.status==='approved'&&tag.matchingMode!=='manual'&&!tag.builtin&&!isPersonalNativeTagName(tag.name)).length,openChoices:(await this.store.scan('reviewItems',{limit:1,status:'open'})).total,history:(await this.store.scan('history',{limit:1})).total},metadata:{category:'active'}}]);
  }
  private async persistProjections(operations:StoreOperation[]){
    const selected:StoreOperation[]=[],signatures=new Map<string,string>();
    for(const operation of operations){const key=operation.collection+'\u0000'+operation.id,signature=operation.kind==='delete'?'deleted':fingerprint([operation.kind==='put'?operation.value:operation.token,operation.metadata?.category,operation.metadata?.status,operation.metadata?.taskId]);if(this.displaySignatures.get(key)===signature)continue;signatures.set(key,signature);if(operation.kind!=='delete'&&operation.metadata?.category==='history'){const old=await this.store.reference(operation.collection,operation.id);operation.metadata.completedAt=old?.metadata.completedAt??operation.metadata.completedAt??this.now();}selected.push(operation);}
    if(selected.length){await this.store.commitRecords(selected);for(const [key,signature] of signatures)this.displaySignatures.set(key,signature);}
  }
  private async index(changed:Set<string>,records:Map<string,Set<string>|null>){
    const tags=new Map(this.context.state.tags.map(tag=>[tag.id,tag])),paperIds=new Set<string>();
    const definitionFingerprint=(tag:TagDefinition)=>fingerprint({id:tag.id,name:tag.name,fullName:tag.fullName,description:tag.description,facet:tag.facet,aliases:tag.aliases,inclusions:tag.inclusions,exclusions:tag.exclusions,examples:tag.examples,broaderIds:tag.broaderIds,relatedIds:tag.relatedIds,matchingMode:tag.matchingMode,status:tag.status});
    for(const field of ['papers','nativeTags'])if(changed.has(field))for(const id of records.get(field)??Object.keys(this.context.state.papers))paperIds.add(id);
    if(changed.has('suggestions'))for(const suggestion of this.context.state.suggestions){
      if(records.get('suggestions')&&!records.get('suggestions')!.has(suggestion.id))continue;
      const tag=tags.get(suggestion.tagId),paper=this.context.state.papers[suggestion.paperId],id=JSON.stringify([suggestion.paperId,suggestion.tagId]);paperIds.add(suggestion.paperId);
      if(tag&&paper&&suggestion.operation!=='remove'&&(suggestion.applied||suggestion.status==='accepted')&&suggestion.inputFingerprint===paper.fingerprint&&suggestion.definitionFingerprint===definitionFingerprint(tag)&&suggestion.evidence.length&&validateEvidence(paper,suggestion.evidence).length===suggestion.evidence.length){
        await this.store.put('scientificMatches',id,{paperId:paper.id,tagId:tag.id,inputFingerprint:paper.fingerprint,definitionFingerprint:suggestion.definitionFingerprint},{category:'active',taskId:paper.id,refs:[{collection:'tags',id:tag.id}]});
      }else if(suggestion.status==='rejected'||suggestion.operation==='remove'&&suggestion.applied)await this.store.delete('scientificMatches',id);
    }
    if(changed.has('tags')){let after:string|undefined;do{const page=await this.store.scan('scientificMatches',{after,limit:50});for(const row of page.rows)if(row.metadata.taskId)paperIds.add(row.metadata.taskId);after=page.next;await this.yieldControl();}while(after);}
    for(const id of paperIds){
      const record=await this.store.reference('papers',id);if(!record){await this.similarity.remove([id]);continue;}
      const inputFingerprint=await this.store.get('papers',id,{path:['fingerprint'],maxBytes:4096}),refs:NonNullable<RecordMetadata['refs']>=[];
      let after:string|undefined;do{const page=await this.store.scan('scientificMatches',{taskId:id,after,limit:50});for(const row of page.rows){const match=await this.store.codec.read(row.token,{maxBytes:16*1024}) as {tagId:string;inputFingerprint:string;definitionFingerprint:string},tag=tags.get(match.tagId);if(tag&&match.inputFingerprint===inputFingerprint&&match.definitionFingerprint===definitionFingerprint(tag))refs.push({collection:'tags',id:tag.id,relation:'matches'});else await this.store.delete('scientificMatches',row.id);}after=page.next;}while(after);
      if(fingerprint(await this.recordLinks('papers',id))!==fingerprint(refs))await this.store.putReference('papers',id,record.token,{...record.metadata,refs});await this.yieldControl();
    }
    await this.context.rebase('papers',paperIds);
  }
  async nativeChunkAck(groupId:string,offset:number){if(!groupId||!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid native write acknowledgement.');await this.store.commit({commandId:`native-ack:${groupId}:${offset}`,operations:[{kind:'put',collection:'nativeChunks',id:groupId,value:{offset,acknowledgedAt:this.now()},metadata:{category:'ledger',status:'prepared'}}]});}
  private async reconcileLibrary(present:Set<string>){
    let after:string|undefined;
    do{const page=await this.store.scan('papers',{after,limit:50});const missing=await this.confirmMissing(page.rows.filter(row=>!present.has(row.id)));if(missing.length)await this.removePapers(missing);after=page.next;await this.yieldControl();}while(after&&!this.closed);
  }
  async ingestIndexed(identities:readonly {itemID:number;paperId:string;version:string}[]){
    if(identities.length>10)throw new Error('Background indexing requires bounded batches.');
    const operation=this.tail.catch(()=>{}).then(async()=>{
      if(this.closed)return;
      const versions=new Map<string,string>();
      for(const identity of identities){
        if(this.closed)break;const current=await this.deps.host.read(identity.itemID);
        if(!current){const old=await this.store.reference('papers',identity.paperId);if(old)await this.removePapers([old]);continue;}
        if(current.id!==identity.paperId)throw new Error('A native item identity changed while indexing.');
        const stored=await this.store.reference('papers',current.id),previous=this.context.state.papers[current.id];
        const title=previous?.title??await this.store.get('papers',current.id,{path:['title'],maxBytes:8*1024*1024}),abstract=previous?.abstract??await this.store.get('papers',current.id,{path:['abstract'],maxBytes:8*1024*1024}),keywords=previous?.keywords??await this.store.get('papers',current.id,{path:['keywords'],maxBytes:8*1024*1024});
        const sameSource=!!stored&&typeof title==='string'&&typeof abstract==='string'&&Array.isArray(keywords)&&paperFingerprint({title,abstract,keywords})===paperFingerprint({...current,pdfText:undefined});
        if(!sameSource){current.summary='';current.concepts=[];current.fingerprint=paperFingerprint(current);this.context.state.papers[current.id]=current;}
        this.context.state.nativeTags[current.id]=await this.deps.host.readTags(identity.itemID);versions.set(current.id,identity.version);
        if(await this.store.get('paperAttentionRows',current.id,{path:['phase'],maxBytes:256})==='source')await this.store.delete('paperAttentionRows',current.id);await this.yieldControl();
      }
      await this.checkpoint(this.context.state);
      for(const [id,version] of versions){const record=await this.store.reference('papers',id);if(record)await this.store.putReference('papers',id,record.token,{...record.metadata,nativeItemId:identities.find(identity=>identity.paperId===id)?.itemID??record.metadata.nativeItemId,nativeVersion:version,refs:await this.recordLinks('papers',id)});}
      await this.context.rebase('papers',versions.keys());for(const id of versions.keys())this.context.releasePaper(id);await this.deps.changed?.((await this.store.stats()).revision);
    });this.tail=operation;return operation;
  }
  async removeMissingIds(ids:readonly string[]){
    if(ids.length>50)throw new Error('Background deletion requires bounded batches.');
    const operation=this.tail.catch(()=>{}).then(async()=>{if(this.closed)return 0;const rows:StoredRecord[]=[];for(const id of ids){const record=await this.store.reference('papers',id);if(record)rows.push(record);}const missing=await this.confirmMissing(rows);await this.removePapers(missing);return missing.length;});this.tail=operation;return operation;
  }
  private async confirmMissing(records:readonly StoredRecord[]){
    const missing:StoredRecord[]=[];
    for(const record of records){
      if(this.closed)break;const itemID=record.metadata.nativeItemId??await this.store.get('papers',record.id,{path:['itemID'],maxBytes:256});if(typeof itemID!=='number')continue;
      try{const current=await this.deps.host.read(itemID);if(!current||current.id!==record.id)missing.push(record);}
      catch(error){await this.store.put('paperAttentionRows',record.id,{id:record.id,title:record.metadata.title??'Source paper',status:'failed',message:'The source could not be checked. Its saved data has been kept. '+errorText(error),phase:'source',canDismiss:false,canLookupMetadata:false,canRecheck:true,canRetry:false,canSkip:false},{category:'active',title:record.metadata.title,status:'failed'});await this.deps.changed?.((await this.store.stats()).revision);}
      await this.yieldControl();
    }
    return missing;
  }
  private async removePapers(records:readonly StoredRecord[]){
    if(!records.length)return;
    const ids=new Set(records.map(row=>row.id)),state=this.context.state,message='This source paper was deleted or moved outside the personal library. Restore it in Zotero or stop this attempt; completed results are saved.';
    const live=state.run?.jobs.some(job=>ids.has(job.paperId)&&job.status!=='completed')||state.maintenanceTasks?.some(task=>task.status!=='completed'&&task.run.jobs.some(job=>ids.has(job.paperId)))||state.nativeDefinitionPreparation?.work.entries.some(entry=>!entry.meaningAdmission&&entry.status!=='left-undefined'&&entry.paperIds.some(id=>ids.has(id)))||state.reviewItems?.some(item=>item.state!=='resolved'&&item.paperId&&ids.has(item.paperId));
    if(live&&(state.run?.status==='running'||state.maintenanceTasks?.some(task=>task.status==='running')))await this.kernel.invoke('pause');
    for(const run of [state.run,...state.maintenanceTasks?.map(task=>task.run)??[]])for(const job of run?.jobs??[])if(ids.has(job.paperId)&&job.status!=='completed'){job.status='pending';job.error=message;}
    const work=state.nativeDefinitionPreparation?.work;
    if(live&&work)for(const task of work.tasks)if(task.status!=='completed'&&task.pairs.some(pair=>ids.has(pair.paperId))){task.status='failed';task.error=message;work.status='failed';if(!work.diagnostics.includes(message))work.diagnostics.push(message);}
    const operations:StoreOperation[]=[];
    for(const row of records){
      let matchAfter:string|undefined;do{const page=await this.store.scan('scientificMatches',{taskId:row.id,after:matchAfter,limit:50});for(const match of page.rows)await this.store.delete('scientificMatches',match.id);matchAfter=page.next;}while(matchAfter);
      for(const collection of ['papers','nativeTags','neighbors','paperInputs'])operations.push({kind:'delete',collection,id:row.id});
      if(live)operations.push({kind:'put',collection:'paperAttentionRows',id:row.id,value:{id:row.id,title:row.metadata.title??'Unavailable source paper',status:'failed',message,phase:'source',canDismiss:false,canLookupMetadata:false,canRecheck:false,canRetry:false,canSkip:false},metadata:{category:'active',title:row.metadata.title,status:'failed'}});
    }
    await this.store.commitRecords(operations);this.context.pruneExpired(operations.filter(operation=>operation.kind==='delete'));await this.similarity.remove([...ids]);
    await this.checkpoint(state);await this.project(new Set(['papers']),new Map([['papers',ids]]));await this.deps.changed?.((await this.store.stats()).revision);
  }
  async itemsChanged(changes:readonly {itemID:number;attachment?:boolean}[]){if(!this.closed){
    await this.hydrate('items-changed',{});const present:typeof changes[number][]=[];
    for(const change of changes){const paper=await this.deps.host.read(change.itemID);if(paper){await this.context.paper(paper.id);present.push(change);}else{let after:string|undefined;do{const page=await this.store.scan('papers',{nativeItemId:change.itemID,after,limit:50});await this.removePapers(page.rows);after=page.next;}while(after&&!this.closed);}await this.yieldControl();}
    if(present.length)await this.kernel.onItemsChanged(present);
  }}
  cancel(commandId:string){
    this.cancelled.add(commandId);const maintenance=this.maintenanceSignals.get(commandId);if(maintenance){maintenance.abort(new Error('Cleanup cancelled.'));return;}
    void(async()=>{const command=await this.store.get('commandLedger',commandId,{maxBytes:32*1024}) as CommandRecord|undefined;if(!command?.runId)return;const run=await this.store.get('runs',command.runId,{maxBytes:32*1024}) as RunRecord|undefined;if(!run)return;if(run.sourceRunId&&run.sourceRunId===this.context.state.run?.id){await this.kernel.invoke('pause');await updateRun(this.store,run.id,{status:'paused',canRetry:true,canStop:true,message:'Paused. Saved work is kept.'},this.now());}else await updateRun(this.store,run.id,{status:'stopped',canRetry:false,canStop:false,message:'Cancelled before processing.'},this.now());})().catch(()=>{});
  }
  async idle(){await this.tail.catch(()=>{});await this.kernel.waitForIdle();await this.checkpointTail.catch(()=>{});}
  async close(_reason:'disable'|'shutdown'){
    if(this.closed)return;this.closed=true;for(const controller of this.maintenanceSignals.values())controller.abort(new Error('Smart Tags closed.'));if(this.kernel){await this.kernel.shutdown();await this.idle();}await this.checkpointTail.catch(()=>{});
  }
  async afterRetention(result:RetentionResult){if(result.removed?.length)this.context.pruneExpired(result.removed);if(result.recordsRemoved||result.bytesRemoved)await this.deps.changed?.((await this.store.stats()).revision);}
  currentNativeGroup(){return this.context.state.pendingChange?.id??'';}
  get busy(){return this.running.size>0||this.context.state.run?.status==='running'||!!this.context.state.maintenanceTasks?.some(task=>task.status==='running');}
}

/** Worker-side host adapter: bounded identity pages and chunked PDF cache reads. */
export function createWorkerHost(call:(method:string,args:unknown[])=>Promise<unknown>,readFile:(path:string,offset:number,length:number)=>Promise<Uint8Array>,groupId:()=>string):LibraryHost{
  const read=async(itemID:number):Promise<PaperRecord|null>=>{
    const response=await call('host.read',[itemID]) as NativePaperTransport|PaperRecord|null;if(!response)return null;
    const transport='paper' in response?response:{paper:response},paper=transport.paper;
    try{
      if(transport.lease){
        const text=async(field:string,length?:number)=>{const parts:string[]=[];for(let offset=0;length===undefined||offset<length;offset+=8192){const chunk=await call('host.paperField',[transport.lease,field,offset,8192]);if(typeof chunk!=='string')throw new Error('A paper field transfer is incomplete.');parts.push(chunk);if(chunk.length<8192)break;await yieldTask();}return parts.join('');};
        for(const field of ['title','abstract'] as const)if(transport.fields?.[field]!==undefined)paper[field]=await text(field,transport.fields[field]);
        if(transport.fields?.keywords!==undefined){paper.keywords=[];for(let index=0;index<transport.fields.keywords;index++)paper.keywords.push(await text(`keyword:${index}`));}
      }
      return normalizeNativePaper(paper);
    }finally{if(transport.lease)await call('host.releasePaper',[transport.lease]);}
  };
  return {
    async list(scope){const papers:PaperRecord[]=[];let cursor:string|undefined;do{const page=await call('host.ids',[scope,cursor]) as {ids:number[];cursor?:string};for(const id of page.ids){const paper=await read(id);if(paper)papers.push(paper);}cursor=page.cursor;await yieldTask();}while(cursor);papers.sort((a,b)=>a.id.localeCompare(b.id));if(scope!=='pilot'||papers.length<=50)return papers;papers.sort((a,b)=>a.title.localeCompare(b.title));return Array.from({length:50},(_,index)=>papers[Math.floor(index*papers.length/50)]);},
    read,
    readTags:async itemID=>await call('host.readTags',[itemID]) as NativeTag[],
    async pdfText(itemID){const source=await call('host.pdfSource',[itemID]);if(typeof source!=='string')return '';const decoder=new TextDecoder(),parts:string[]=[];for(let offset=0;;offset+=64*1024){const bytes=await readFile(source,offset,64*1024);if(!bytes.length)break;parts.push(decoder.decode(bytes,{stream:true}));await yieldTask();}parts.push(decoder.decode());return parts.join('');},
    async apply(patches:TagPatch[],label:string){await call('host.apply',[patches,label,groupId()]);},
    async show(itemID){await call('host.show',[itemID]);},async saveSearch(name,tags){await call('host.saveSearch',[name,tags]);},
    async saveConceptSearch(name,filter,definitions){await call('host.saveConceptSearch',[name,filter,definitions]);},
    async inspectInputs(itemID,recheck){
      const assessment=await call('host.inspectInputs',[itemID,recheck]) as NativeInputSources;let characters=0,failed=false;
      for(const path of assessment.cachePaths??[]){const decoder=new TextDecoder();let total=0,first=-1,last=-1;try{for(let offset=0;;offset+=64*1024){const bytes=await readFile(path,offset,64*1024),text=decoder.decode(bytes,{stream:!!bytes.length});const start=text.search(/\S/);if(start>=0){if(first<0)first=total+start;last=total+text.trimEnd().length-1;}total+=text.length;if(!bytes.length)break;await yieldTask();}if(first>=0)characters=Math.max(characters,last-first+1);}catch{failed=true;}}
      const {cachePaths,...result}=assessment;void cachePaths;result.pdf.characters=characters;if(characters)result.pdf.status='readable';else if(failed)result.pdf.status='readError';return result;
    },
    async lookupMetadata(itemID,identifier){return await call('host.lookupMetadata',[itemID,identifier]) as Awaited<ReturnType<NonNullable<LibraryHost['lookupMetadata']>>>;},
    async readMetadata(itemID){return await call('host.readMetadata',[itemID]) as Awaited<ReturnType<NonNullable<LibraryHost['readMetadata']>>>;},
    async applyMetadata(patches,label){await call('host.applyMetadata',[patches,label]);},
  };
}

export function isProviderClient(value:AI):value is ProviderClient{return typeof (value as ProviderClient).dispose==='function';}
