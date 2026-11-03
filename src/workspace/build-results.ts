import type {DisplayBuildResult} from '../ui-contract.ts';
import type {RecordMetadata,StoreOperation} from './storage.ts';
import {WorkspaceStore} from './storage.ts';

/** Upgrade a recent build's display record without decoding its saved request archive. */
export async function seedBuildResult(store:WorkspaceStore,clock:()=>number=Date.now):Promise<void>{
  if(await store.get('state','latestBuildRunId',{maxBytes:4096})!==undefined)return;
  const run=await store.reference('state','run');if(!run)return;
  const field=async<T>(record:typeof run,path:readonly(string|number)[],fallback:T):Promise<T>=>{
    const token=await store.codec.lookup(record.token,path);if(!token)return fallback;
    return await store.codec.read(token,{maxBytes:4096}) as T;
  };
  const text=async(record:typeof run,path:readonly(string|number)[],maximum=2000):Promise<string>=>{
    const token=await store.codec.lookup(record.token,path);if(!token||await store.codec.kind(token)!=='string')return '';
    let value='';for await(const fragment of store.codec.stringChunks(token)){value+=fragment.slice(0,maximum-value.length);if(value.length>=maximum)break;}return value;
  };
  if(await field(run,['kind'],'')!=='rebuild')return;
  const runId=await field(run,['id'],'');if(!runId)return;
  const runStatus=await field(run,['status'],'idle'),finished=await field(run,['vocabFinished'],false),selectionId=await field(run,['selection','id'],'');
  const preparation=await store.reference('state','tagPreparation'),proposal=await store.reference('state','taxonomyProposal');
  const proposalId=proposal?await field(proposal,['id'],''):'',matches=!!preparation&&!!proposalId&&await field(preparation,['proposalId'],'')===proposalId&&(!selectionId||selectionId===proposalId);
  const ids:string[]=[],admissions=matches?await store.codec.lookup(preparation!.token,['admissions']):undefined;
  if(admissions){let after:number|undefined;do{const page=await store.codec.entries(admissions,{after,limit:50});for(const entry of page.entries)ids.push(String(entry.key));after=page.next;}while(after!==undefined);}
  else{const saved=await store.codec.lookup(run.token,['buildOutcome','savedTagIds']);if(saved){let after:number|undefined;do{const page=await store.codec.entries(saved,{after,limit:50});for(const entry of page.entries){const id=await store.codec.read(entry.token,{maxBytes:4096});if(typeof id==='string')ids.push(id);}after=page.next;}while(after!==undefined);}}
  const questions=matches?await store.codec.lookup(preparation!.token,['questions']):undefined,questionCount=questions?(await store.codec.entries(questions,{limit:1})).total:0;
  const savedIds:string[]=[];for(const id of ids)if(await store.reference('tags',id))savedIds.push(id);
  const captured=await field<DisplayBuildResult['reason']>(run,['buildOutcome','reason'],undefined),policy=matches?await field(preparation!,['processingPolicy'],''):'';
  const reason=ids.length?'saved':captured??(matches&&policy==='auto-clear'&&finished?'no-new-tags':undefined);
  const prepStatus=matches?await field(preparation!,['status'],''):'';
  const status:DisplayBuildResult['status']=runStatus==='running'?'running':runStatus==='paused'?'paused':!matches&&!captured?'unknown':reason==='needs-information'||reason==='no-eligible-papers'?'needs-information':prepStatus==='failed'||!finished?'failed':'completed';
  const paperCount=(await store.scan('runJobs',{taskId:runId,limit:1})).total,completedPaperCount=(await store.scan('runJobs',{taskId:runId,status:'completed',limit:1})).total,shelfId=matches?await field(preparation!,['shelfId'],''):await field(run,['buildOutcome','shelfId'],'');
  const message=!matches&&!captured&&runStatus==='idle'?'This older build has no detailed completion record. Saved tags are available in the tag library.':await text(run,['message']);
  await projectBuildResult(store,{runId,status,paperCount,completedPaperCount,savedCount:savedIds.length,questionCount,...(shelfId?{shelfId}:{}),...(reason?{reason}:{}),message},savedIds,()=>run.metadata.completedAt??clock());
}

/** Publish one run's outcome and exact saved membership without retaining source bodies. */
export async function projectBuildResult(store:WorkspaceStore,result:DisplayBuildResult|undefined,savedTagIds:readonly string[],clock:()=>number=Date.now):Promise<void>{
  if(!result)return;
  const previous=await store.reference('buildResults',result.runId),live=result.status==='running'||result.status==='paused',now=clock();
  const completedAt=live?undefined:previous?.metadata.completedAt??now;
  const metadata:RecordMetadata={category:live?'active':'history',status:result.status,taskId:result.runId,...(completedAt!==undefined?{completedAt}:{}),pinned:live||result.questionCount>0};
  const ids=[...new Set(savedTagIds)],current=new Set<string>(),operations:StoreOperation[]=[],names:string[]=[];
  for(const tagId of ids){
    const tag=await store.reference('tags',tagId);if(!tag)continue;
    const id=JSON.stringify([result.runId,tagId]);current.add(id);if(names.length<10)names.push(tag.metadata.title??tagId);
    operations.push({kind:'put',collection:'buildResultTags',id,value:{tagId},metadata:{...metadata,title:tag.metadata.title??tagId,refs:[{collection:'tags',id:tagId}]}});
  }
  let after:string|undefined;
  do{const page=await store.scan('buildResultTags',{taskId:result.runId,after,limit:50});for(const row of page.rows)if(!current.has(row.id))operations.push({kind:'delete',collection:'buildResultTags',id:row.id});after=page.next;}while(after);
  operations.push({kind:'put',collection:'buildResults',id:result.runId,value:{...result,savedCount:current.size,tagNames:names},metadata:{...metadata,refs:[...current].map(id=>({collection:'buildResultTags',id}))}},{kind:'put',collection:'state',id:'latestBuildRunId',value:result.runId,metadata:{category:'active'}});
  await store.commitRecords(operations);
}
