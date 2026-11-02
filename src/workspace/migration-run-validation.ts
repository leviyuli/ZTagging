import {initialState,validLegacyState,validState} from '../controller.ts';
import {validConsolidationWork} from '../library-consolidation.ts';
import type {PayloadCodec} from './codec.ts';
import type {PayloadToken} from './storage-contract.ts';
import {LegacyValidationError} from './migration-contract.ts';
import {validateSelectionGraph} from './migration-selection-validation.ts';

/** Scientific work and paid replies are validated without decoding their archive bodies. */
export async function validateRunGraph(codec:PayloadCodec,run:PayloadToken,version:number,options:{signal?:AbortSignal}={}):Promise<void>{
  const fail=():never=>{throw new LegacyValidationError('An interrupted legacy run has invalid checkpoints or request references.');};
  const read=async<T>(token:PayloadToken|undefined,maxBytes=256*1024):Promise<T>=>token?await codec.read(token,{maxBytes,signal:options.signal}) as T:undefined as T;
  const at=async<T>(token:PayloadToken,path:readonly(string|number)[])=>read<T>(await codec.lookup(token,path));
  const entries=async function*(token:PayloadToken|undefined){if(!token)return;let after:number|undefined;for(;;){if(options.signal?.aborted)throw options.signal.reason;const page=await codec.entries(token,{after,limit:50});yield* page.entries;if(page.next===undefined)break;after=page.next;}};
  const pick=async(token:PayloadToken,keys:readonly string[])=>{const builder=codec.objectBuilder();for(const key of keys){const value=await codec.lookup(token,[key]);if(value)await builder.append(key,value);}return builder.finish();};
  const replies=async(token:PayloadToken,keys:readonly string[])=>{const builder=codec.arrayBuilder();for await(const item of entries(token)){const row=codec.objectBuilder();for(const key of keys){const value=await codec.lookup(item.token,[key]);if(value)await row.append(key,value);}if(await codec.lookup(item.token,['raw']))await row.append('raw',{value:null});await builder.append(await row.finish());}return builder.finish();};
  const selected=await codec.lookup(run,['selection']);if(version>=6&&selected){await validateSelectionGraph(codec,selected,options);if(version===6&&await at(selected,['policyVersion'])!==3)fail();}
  const cached=await codec.lookup(run,['cachedSelection']);if(version>=6&&cached){const work=await codec.lookup(cached,['work']);if(!work)fail();await validateSelectionGraph(codec,work!,options);const input=await at(cached,['inputFingerprint']);if(await at(work!,['status'])!=='ready'||input!==undefined&&typeof input!=='string')fail();}
  const replacement=new Map<string,PayloadToken>();
  const jobs=await codec.lookup(run,['jobs']);if(!jobs||await codec.kind(jobs)!=='array')fail();const jobList=codec.arrayBuilder();for await(const job of entries(jobs))await jobList.append(await pick(job.token,['id','paperId','status']));replacement.set('jobs',await jobList.finish());
  const selectionReplies=await codec.lookup(run,['selectionReplies']);if(version>=6&&selectionReplies){if(await codec.kind(selectionReplies)!=='array')fail();replacement.set('selectionReplies',await replies(selectionReplies,['taskId','provider','model','error','diagnosticOnly']));}
  const prep=await codec.lookup(run,['preparation']);if(version>=4&&prep){const builder=codec.objectBuilder();for await(const item of entries(prep)){if(item.key==='responses'){if(await codec.kind(item.token)!=='array')fail();await builder.append('responses',await replies(item.token,['attempt','provider','model','applied','failed']));}else await builder.append(String(item.key),item.token);}replacement.set('preparation',await builder.finish());}
  const consolidation=await codec.lookup(run,['consolidation']);if(version>=5&&consolidation){
    const work=await codec.lookup(consolidation,['work']);if(work){
      for(const key of ['registry','definitions','excluded','tasks']){const value=await codec.lookup(work,[key]);if(!value||await codec.kind(value)!=='array')fail();}const candidates=await codec.lookup(work,['candidates']);if(!candidates||await codec.kind(candidates)!=='object')fail();
      const tasks=[];for await(const task of entries(await codec.lookup(work,['tasks'])))tasks.push(await read(await pick(task.token,['id','phase','kind','round','completed','inputIds','outputIds','correctionAttempts','automaticFreshAttempts','splitDepth','requestGeneration','correctionPending','correctionUnavailable','rawDiagnosticOnly','superseded','localFallback','parentTaskId'])));
      const header=await read<Record<string,unknown>>(await pick(work,['id','fingerprint','snapshotId','limit','round','automaticRequests','status']));if(!validConsolidationWork({...header,registry:[],definitions:[],excluded:[],candidates:{},tasks}))fail();
    }
    const checkpoint=codec.objectBuilder();for await(const item of entries(consolidation)){if(item.key==='work')continue;if(item.key==='pendingResponse'){const response=codec.objectBuilder();for(const key of ['requestId','kind']){const value=await codec.lookup(item.token,[key]);if(value)await response.append(key,value);}if(await codec.lookup(item.token,['raw']))await response.append('raw',{value:null});await checkpoint.append('pendingResponse',await response.finish());}else await checkpoint.append(String(item.key),item.token);}replacement.set('consolidation',await checkpoint.finish());
  }
  const builder=codec.objectBuilder();for await(const item of entries(run)){if(item.key==='selection'||item.key==='cachedSelection')continue;await builder.append(String(item.key),replacement.get(String(item.key))??item.token);}
  const sample=initialState() as unknown as Record<string,unknown>;sample.schemaVersion=version;sample.run=await codec.read(await builder.finish(),{maxBytes:2*1024*1024,signal:options.signal});if(version===13?!validState(sample):!validLegacyState(sample))fail();
}
