import type {AppState} from '../controller.ts';
import type {DisplayRun} from '../ui-contract.ts';
import type {WorkspaceCommand} from '../workspace-contract.ts';
import type {StoreOperation} from './storage-contract.ts';
import {WorkspaceStore} from './storage.ts';

export interface RunRecord extends DisplayRun {commandType:string;sourceRunId?:string}
export const startsRun=(type:string)=>type==='prepare-tags'||type==='rebuild'||type==='tag'||type==='extend-assignment-topics';
const finished=(status:DisplayRun['status'])=>status==='completed'||status==='failed'||status==='stopped';

export function newRunOperations(id:string,command:WorkspaceCommand,now:number):StoreOperation[]{
  const input=command.payload as {frozenPaperIDs?:unknown[]}|undefined;
  const value:RunRecord={id,kind:command.type==='tag'?'assignment':'build',commandType:command.type,status:'queued',phase:'queued',paperCount:input?.frozenPaperIDs?.length??0,completedPaperCount:0,createdAt:now,updatedAt:now,attemptCount:1,message:'Waiting to start.',canStop:true};
  return [{kind:'put',collection:'runs',id,value,metadata:{category:'active',status:'queued',pinned:true,updatedAt:now,refs:[{collection:'runInputs',id}]}},{kind:'put',collection:'runInputs',id,value:command,metadata:{category:'active',pinned:true}}];
}

export async function runUpdateOperations(store:WorkspaceStore,id:string,patch:Partial<RunRecord>,now:number):Promise<StoreOperation[]>{
  const row=await store.reference('runs',id);if(!row)return [];
  const prior=await store.codec.read(row.token,{maxBytes:32*1024}) as RunRecord;
  if(prior.status==='stopped'&&patch.status!=='stopped')return [];
  const value={...prior,...patch,id,updatedAt:now},terminal=finished(value.status),completedAt=row.metadata.completedAt??now;
  if(JSON.stringify({...prior,updatedAt:0})===JSON.stringify({...value,updatedAt:0}))return [];
  const metadata={category:terminal?'history' as const:'active' as const,pinned:!terminal,...(terminal?{completedAt}:{})};
  const operations:StoreOperation[]=[{kind:'put',collection:'runs',id,value,metadata:{...metadata,status:value.status,updatedAt:now,refs:[{collection:'runInputs',id},...(value.sourceRunId?[{collection:'buildResults',id:value.sourceRunId}]:[])]},expectedVersion:row.version}];
  const input=await store.reference('runInputs',id);if(input)operations.push({kind:'reference',collection:'runInputs',id,token:input.token,metadata});
  if(value.sourceRunId){const link=await store.reference('runLinks',value.sourceRunId);if(link)operations.push({kind:'reference',collection:'runLinks',id:value.sourceRunId,token:link.token,metadata});}
  return operations;
}
export async function updateRun(store:WorkspaceStore,id:string,patch:Partial<RunRecord>,now:number):Promise<void>{
  const operations=await runUpdateOperations(store,id,patch,now);if(operations.length)await store.commitRecords(operations);
}

export async function projectRun(store:WorkspaceStore,state:AppState,logicalId:string|undefined,now:number):Promise<void>{
  const source=state.run;if(!source)return;
  const linked=await store.get('runLinks',source.id,{maxBytes:4096}) as {id:string}|undefined;
  let id=linked?.id??logicalId;
  if(!id&&source.automatic){id='automatic:'+source.id;await store.commitRecords(newRunOperations(id,{type:'tag',payload:{scope:'selected',processingPolicy:'auto-clear',frozenPaperIDs:source.jobs.flatMap(job=>{const paper=state.papers[job.paperId];return paper?[{itemID:paper.itemID,paperId:paper.id}]:[]})}},now));}
  if(!id)return;
  if(!linked)await store.put('runLinks',source.id,{id},{category:'ledger'});
  const pending=source.jobs.filter(job=>job.status!=='completed').length;
  const checking=state.tagPreparation?.status==='checking';
  const phase=source.status==='idle'?'completed':pending?'reading':source.kind==='tag'?'saving':checking?'checking':source.vocabFinished?'saving':source.selection?.status==='ready'?'checking':'building';
  const status:DisplayRun['status']=source.status==='running'?'running':source.status==='paused'?'paused':'completed';
  const admissions=state.tagPreparation?.admissions??{};
  const savedIds=source.kind==='rebuild'?(source.buildOutcome?.savedTagIds??Object.keys(admissions)):[];
  const assignment=state.assignmentRuns?.find(run=>run.id===source.id);
  const suggestions=state.suggestions.filter(suggestion=>suggestion.runId===source.id);
  const choiceCount=state.reviewItems?.filter(item=>item.kind==='assignment'&&item.taskId===source.id&&item.state!=='resolved').length??0;
  const result={sourceRunId:source.id,resultRunId:source.id,status,phase,paperCount:source.jobs.length,completedPaperCount:source.jobs.length-pending,message:source.message,canRetry:status==='paused',canStop:status==='running'||status==='paused',newCount:savedIds.filter(id=>state.tags.some(tag=>tag.id===id)).length,unavailableCount:source.jobs.filter(job=>job.error).length,appliedCount:suggestions.filter(suggestion=>suggestion.applied).length,choiceCount:assignment?choiceCount:0,tagNames:state.tags.filter(tag=>savedIds.includes(tag.id)).slice(0,10).map(tag=>tag.name),spentUSD:source.spentUSD,provider:source.settings.provider,model:source.settings.model};
  await updateRun(store,id,result,now);
}
