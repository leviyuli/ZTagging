import {WorkspaceStore} from './storage.ts';
import type {DocumentRef,StoreOperation,StoredRecord} from './storage-contract.ts';

export const NATIVE_REVIEW_INDEX_TYPE='native-decisions-v2';
export interface NativeReviewIndexOptions {signal?:AbortSignal;yieldControl?:()=>Promise<void>}

/** Index the current task's actionable identities without decoding source proofs. */
export async function ensureNativeReviewIndex(store:WorkspaceStore,{signal,yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}:NativeReviewIndexOptions={}):Promise<void>{
  const check=()=>signal?.throwIfAborted();check();
  const header=await store.reference('viewHeaders','nativeDefinitionPreparation');
  if(!header||header.metadata.type===NATIVE_REVIEW_INDEX_TYPE)return;
  const scalar=async(record:StoredRecord,path:readonly string[])=>{check();const token=await store.codec.lookup(record.token,path);return token?store.codec.read(token,{maxBytes:4096,signal}):undefined;};
  const workId=await scalar(header,['id']);if(typeof workId!=='string'||!workId)return;
  const source=await store.reference('state','nativeDefinitionPreparation'),sourceWork=source&&await scalar(source,['work','id']),taskId=sourceWork===workId&&source?await scalar(source,['taskId']):undefined;
  const choices=new Map<string,{id:string;state:'open'|'deferred'}>();
  const scopes=typeof taskId==='string'?[...new Set([workId,taskId])]:[undefined];
  for(const scope of scopes){
    let after:string|undefined;
    do{
      check();const page=await store.scan('reviewItems',{...(scope?{taskId:scope}:{}),statuses:['open','deferred'],after,limit:50});
      for(const item of page.rows){
        const itemWork=await scalar(item,['workId']),itemTask=await scalar(item,['taskId']),questionId=await scalar(item,['questionId']),kind=await scalar(item,['kind']);
        if(typeof questionId!=='string'||kind!==undefined&&kind!=='definition')continue;
        if(itemWork!==undefined?itemWork!==workId:typeof itemTask!=='string'||itemTask!==taskId&&itemTask!==workId)continue;
        const state=await scalar(item,['state']);if(state==='open'||state==='deferred')choices.set(questionId,{id:item.id,state});
      }
      after=page.next;await yieldControl();
    }while(after);
  }
  const pending=new Set<string>();let after:string|undefined;
  do{
    check();const page=await store.scan('nativeMeaningEntries',{taskId:workId,after,limit:50}),operations:StoreOperation[]=[];
    for(const entry of page.rows){
      check();const display=await store.reference('nativeMeaningDisplays',entry.id),currentDisplay=display?.metadata.taskId===workId?display:undefined,status=await scalar(entry,['status']);
      if(status==='left-undefined'||await store.codec.lookup(entry.token,['meaningAdmission'])||currentDisplay&&(await scalar(currentDisplay,['applied'])===true||await scalar(currentDisplay,['status'])==='left-undefined'))continue;
      const choice=choices.get(entry.id);pending.add(entry.id);operations.push({kind:'put',collection:'nativeMeaningQueue',id:entry.id,value:{entryId:entry.id,...(choice?{reviewId:choice.id}:{})},metadata:{category:'active',taskId:workId,status:choice?.state??'open',order:entry.metadata.order}});
    }
    check();if(operations.length)await store.commitRecords(operations);after=page.next;await yieldControl();
  }while(after);
  after=undefined;
  do{
    check();const page=await store.scan('nativeMeaningQueue',{after,limit:50}),obsolete=page.rows.filter(row=>row.metadata.taskId!==workId||!pending.has(row.id));
    if(obsolete.length){check();await store.commitRecords(obsolete.map(row=>({kind:'delete',collection:'nativeMeaningQueue',id:row.id})));}after=page.next;await yieldControl();
  }while(after);
  const refs:DocumentRef[]=[];let offset:number|undefined;
  do{check();const page=await store.links(header.collection,header.id,{offset,limit:50});refs.push(...page.rows);offset=page.next;}while(offset!==undefined);
  check();await store.commitRecords([{kind:'reference',collection:header.collection,id:header.id,token:header.token,metadata:{...header.metadata,type:NATIVE_REVIEW_INDEX_TYPE,refs},expectedVersion:header.version}]);
}
