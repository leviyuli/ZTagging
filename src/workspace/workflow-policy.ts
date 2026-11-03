import {fingerprint,paperFingerprint} from '../core.ts';
import type {TagDefinition} from '../core.ts';
import {isNoTagDefinition} from '../tag-policy.ts';
import {WorkspaceStore} from './storage.ts';
import type {DocumentRef,PayloadToken,RecordMetadata,StoreOperation,StoredRecord} from './storage-contract.ts';

export const WORKFLOW_POLICY_VERSION=1;
export interface DefinitionOrigin {version:1;kind:'ai-build';tagId:string;creationFingerprint:string;workId:string;changeId?:string;recordedAt:number}
export interface WorkflowPolicyOptions {clock?:()=>number;signal?:AbortSignal;yieldControl?:()=>Promise<void>}
export interface WorkflowPolicyReceipt {blocked:boolean;changed:boolean;retired:number;kept:number;reason?:string}
const obsoleteTasks=new Set(['reconcile','diy','compare-diy','define-native']);
const obsoleteCommands=new Set('refresh-existing-tags analyze-existing-tags create-diy-from-existing compare-diy-tags prepare-tag-meanings retry-tag-meanings continue-tag-meanings apply-tag-meanings cancel-tag-meanings open-meaning-work set-native-tag-treatment'.split(' '));
export const isRetiredWorkflowCommand=(type:string)=>obsoleteCommands.has(type);

export function buildOriginOperation(input:{tagId:string;definition:TagDefinition;workId:string;changeId?:string;recordedAt?:number}):StoreOperation {
  const value:DefinitionOrigin={version:1,kind:'ai-build',tagId:input.tagId,creationFingerprint:fingerprint(input.definition),workId:input.workId,...(input.changeId?{changeId:input.changeId}:{}),recordedAt:input.recordedAt??Date.now()};
  return {kind:'put',collection:'definitionOrigins',id:input.tagId,value,metadata:{category:'ledger',taskId:input.workId}};
}
export async function definitionOrigin(store:WorkspaceStore,id:string):Promise<DefinitionOrigin|undefined>{
  const value=await store.get('definitionOrigins',id,{maxBytes:8192}) as DefinitionOrigin|undefined;
  return value?.version===1&&value.kind==='ai-build'&&value.tagId===id&&typeof value.creationFingerprint==='string'&&typeof value.workId==='string'?value:undefined;
}
export async function retiredDefinitionIds(store:WorkspaceStore):Promise<Set<string>>{const ids=new Set<string>();let after:string|undefined;do{const page=await store.scan('retiredDefinitions',{after,limit:50});for(const row of page.rows)ids.add(row.id);after=page.next;}while(after);return ids;}
export async function isRetiredDefinition(store:WorkspaceStore,id:string):Promise<boolean>{return !!await store.reference('retiredDefinitions',id);}

/** One storage-only compatibility transition; no provider or native-library calls. */
export async function initializeWorkflowPolicy(store:WorkspaceStore,{clock=Date.now,signal,yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}:WorkflowPolicyOptions={}):Promise<WorkflowPolicyReceipt>{
  const check=()=>signal?.throwIfAborted();check();
  const previous=await store.get('workspace','workflowPolicy',{maxBytes:8192}) as {version?:number;phase?:string;startedAt?:number;retired?:number;kept?:number}|undefined;
  if(previous?.version===1&&previous.phase==='complete')return {blocked:false,changed:false,retired:previous.retired??0,kept:previous.kept??0};
  const pending=await store.reference('state','pendingChange');
  if(pending&&(await store.codec.kind(pending.token)!=='scalar'||await store.codec.read(pending.token,{maxBytes:128,signal})!==null))return {blocked:true,changed:false,retired:0,kept:0,reason:'A prepared write must be reconciled before retiring definitions.'};
  const startedAt=previous?.startedAt??clock(),history:RecordMetadata={category:'history',completedAt:startedAt,pinned:false,status:'completed'};
  const scalar=async(token:PayloadToken,path:readonly(string|number)[])=>{check();const child=await store.codec.lookup(token,path);return child?store.codec.read(child,{maxBytes:8192,signal}):undefined;};
  async function* rows(collection:string){let after:string|undefined;do{check();const page=await store.scan(collection,{after,limit:50});yield* page.rows;after=page.next;await yieldControl();}while(after);}
  async function* entries(token:PayloadToken|undefined){if(!token)return;let after:number|undefined;do{check();const page=await store.codec.entries(token,{after,limit:50});yield* page.entries;after=page.next;await yieldControl();}while(after!==undefined);}
  const links=async(row:StoredRecord)=>{const refs:DocumentRef[]=[];let offset:number|undefined;do{check();const page=await store.links(row.collection,row.id,{offset,limit:50});refs.push(...page.rows);offset=page.next;}while(offset!==undefined);return refs;};
  const patch=async(token:PayloadToken,updates:Record<string,PayloadToken|undefined>)=>{const builder=store.codec.objectBuilder(),seen=new Set<string>();for await(const entry of entries(token)){const key=String(entry.key);seen.add(key);const next=Object.hasOwn(updates,key)?updates[key]:entry.token;if(next)await builder.append(key,next);}for(const [key,value] of Object.entries(updates))if(value&&!seen.has(key))await builder.append(key,value);return builder.finish();};
  const archive=async(row:StoredRecord,collection='workflowArchives'):Promise<StoreOperation>=>({kind:'reference',collection,id:row.collection+':'+('ref' in row.token?row.token.ref:fingerprint(row.token)),token:row.token,metadata:{...history,type:row.collection,taskId:row.id,refs:await links(row)}});
  const commit=async(operations:StoreOperation[])=>{check();if(operations.length)await store.commitRecords(operations);};
  await store.put('workspace','workflowPolicy',{version:1,phase:'running',startedAt},{category:'ledger'});

  const unprovenBuildOrigins=new Set<string>();
  const tracedRevision=async(id:string,creationChangeId:string,created:TagDefinition,current:PayloadToken)=>{
    const initial=fingerprint(created),target=fingerprint(await store.codec.read(current,{maxBytes:256*1024,signal}));if(initial===target)return true;
    const revisions=new Map<string,string>(),incoming=new Map<string,string>();
    for await(const change of rows('history')){
      if(change.id===creationChangeId||await scalar(change.token,['status'])!=='applied')continue;
      const before=await store.codec.lookup(change.token,['beforeDefinitions',id]),after=await store.codec.lookup(change.token,['afterDefinitions',id]);if(!before&&!after)continue;
      if(!before||!after)return false;
      const prior=await store.codec.read(before,{maxBytes:256*1024,signal}) as TagDefinition|null,next=await store.codec.read(after,{maxBytes:256*1024,signal}) as TagDefinition|null;
      if(!prior||!next||prior.id!==id||next.id!==id)return false;
      const from=fingerprint(prior),to=fingerprint(next);if(from===to)continue;
      if(revisions.has(from)&&revisions.get(from)!==to||incoming.has(to)&&incoming.get(to)!==from)return false;
      revisions.set(from,to);incoming.set(to,from);
    }
    // A missing revision, fork, recreation or unmatched tail cannot establish
    // that a current same-ID body still belongs to this creation admission.
    const seen=new Set<string>();let currentFingerprint=initial;
    while(revisions.has(currentFingerprint)){if(seen.has(currentFingerprint))return false;seen.add(currentFingerprint);currentFingerprint=revisions.get(currentFingerprint)!;}
    return currentFingerprint===target&&seen.size===revisions.size;
  };

  // A creation admission is authoritative only when its applied change created
  // a new, non-baseline Build tags candidate. Display lists alone prove nothing.
  const infer=async(preparation:PayloadToken|undefined,proposal:PayloadToken|undefined)=>{
    if(!preparation||!proposal)return;const workId=await scalar(proposal,['id']);if(typeof workId!=='string'||await scalar(preparation,['proposalId'])!==workId||await scalar(proposal,['protocolVersion'])!==2)return;
    const baseline=new Set<string>();for await(const entry of entries(await store.codec.lookup(proposal,['extension','baseline','definitions']))){const id=await scalar(entry.token,['id']);if(typeof id==='string')baseline.add(id);}
    for await(const entry of entries(await store.codec.lookup(proposal,['retainedDefinitionIds']))){const id=await store.codec.read(entry.token,{maxBytes:4096,signal});if(typeof id==='string')baseline.add(id);}
    const candidates=new Set<string>();for await(const entry of entries(await store.codec.lookup(proposal,['tags']))){const id=await scalar(entry.token,['id']);if(typeof id==='string'&&!baseline.has(id))candidates.add(id);}
    for await(const admission of entries(await store.codec.lookup(preparation,['admissions']))){
      const id=String(admission.key),current=await store.reference('tags',id);if(!candidates.has(id)||await definitionOrigin(store,id)||!current||await isRetiredDefinition(store,id))continue;
      const changeId=await scalar(admission.token,['changeId']);if(typeof changeId!=='string')continue;const change=await store.reference('history',changeId);if(!change||await scalar(change.token,['status'])!=='applied'||await scalar(change.token,['taskId'])!==workId)continue;
      const before=await store.codec.lookup(change.token,['beforeDefinitions',id]),after=await store.codec.lookup(change.token,['afterDefinitions',id]);if(!before||await store.codec.read(before,{maxBytes:16,signal})!==null||!after)continue;
      const created=await store.codec.read(after,{maxBytes:256*1024,signal}) as TagDefinition|null;if(!created||created.id!==id)continue;
      if(!await tracedRevision(id,changeId,created,current.token)){unprovenBuildOrigins.add(id);continue;}
      await commit([buildOriginOperation({tagId:id,definition:created,workId,changeId,recordedAt:change.metadata.completedAt??startedAt})]);
    }
  };
  const currentPreparation=await store.reference('state','tagPreparation'),currentProposal=await store.reference('state','taxonomyProposal');await infer(currentPreparation?.token,currentProposal?.token);
  for await(const row of rows('preparationHistory'))await infer(await store.codec.lookup(row.token,['preparation']),await store.codec.lookup(row.token,['proposal']));

  let kept=0;
  for await(const row of rows('tags')){
    const definition=await store.codec.read(row.token,{maxBytes:256*1024,signal}) as TagDefinition;
    if(isNoTagDefinition(definition))continue;
    if(!await isRetiredDefinition(store,row.id)&&await definitionOrigin(store,row.id)){kept++;continue;}
    const archiveId=row.id,origin=unprovenBuildOrigins.has(row.id)?'unknown':definition.custom?'manual':(await store.scan('nativeMeaningAdmissions',{taskId:row.id,limit:1})).total?'native':'unknown';
    await commit([{kind:'reference',collection:'retiredDefinitionBodies',id:archiveId,token:row.token,metadata:{...history,title:row.metadata.title,refs:await links(row)}},{kind:'put',collection:'retiredDefinitions',id:row.id,value:{version:1,tagId:row.id,origin,definitionFingerprint:fingerprint(definition),retiredAt:startedAt,archiveId},metadata:{category:'ledger',status:'retired'}},{kind:'delete',collection:'tags',id:row.id,expectedVersion:row.version},{kind:'delete',collection:'libraryTags',id:row.id}]);
  }
  const retired=await retiredDefinitionIds(store);
  const archivedRefs=new Map<string,DocumentRef>(),compatiblePapers=new Map<string,string>();
  for(const [collection,destination] of [['papers','legacyPaperInputs'],['facts','legacyFacts'],['analyses','legacyAnalyses'],['paperInputs','legacyInputChecks']] as const)for await(const row of rows(destination))archivedRefs.set(collection+'\u0000'+row.id,{collection:destination,id:row.id});
  const archivedRun=await store.get('workspace','workflowPolicyRunArchive',{maxBytes:4096}) as {startedAt?:number;collection?:string;id?:string}|undefined;if(archivedRun?.startedAt===startedAt&&typeof archivedRun.collection==='string'&&typeof archivedRun.id==='string')archivedRefs.set('state\u0000run',{collection:archivedRun.collection,id:archivedRun.id});
  for(const [collection,destination] of [['papers','legacyPaperInputs'],['facts','legacyFacts'],['analyses','legacyAnalyses'],['paperInputs','legacyInputChecks']] as const)for await(const row of rows(collection)){
    if(collection==='facts'&&compatiblePapers.has(row.id)&&compatiblePapers.get(row.id)===await scalar(row.token,['metadataFingerprint'])){archivedRefs.delete('facts\u0000'+row.id);continue;}
    const ref={collection:destination,id:row.id};archivedRefs.set(collection+'\u0000'+row.id,ref);
    const original=await store.reference(destination,row.id),operations:StoreOperation[]=original?[]:[{kind:'reference',...ref,token:row.token,metadata:{...history,refs:await links(row)}}];
    if(collection==='papers'){
      const title=await store.get('papers',row.id,{path:['title'],maxBytes:64*1024*1024,signal}) as string??'',abstract=await store.get('papers',row.id,{path:['abstract'],maxBytes:64*1024*1024,signal}) as string??'';
      const keywords=await store.codec.lookup((original??row).token,['keywords']);if(!keywords||(await store.codec.entries(keywords,{limit:1})).total===0)compatiblePapers.set(row.id,paperFingerprint({title,abstract,keywords:[]}));
      operations.push({kind:'reference',collection,id:row.id,token:await patch(row.token,{keywords:await store.codec.encode([]),summary:undefined,concepts:undefined,pdfText:undefined,fingerprint:{value:paperFingerprint({title,abstract,keywords:[]})}}),metadata:{...row.metadata,searchText:title+'\n'+abstract,refs:(await links(row)).filter(ref=>ref.relation!=='matches'&&(ref.collection!=='tags'||!retired.has(ref.id)))}});
    }else operations.push({kind:'delete',collection,id:row.id});
    await commit(operations);
  }
  let stoppedRuns=0,retiredTasks=0,withdrawnChoices=0,withdrawnSuggestions=0,archivedActivityTasks=0;
  const run=await store.reference('state','run');
  if(run&&await store.codec.kind(run.token)==='object'&&await scalar(run.token,['sourcePolicyVersion'])!==2){
    const saved=await archive(run);archivedRefs.set('state\u0000run',{collection:saved.collection,id:saved.id});await commit([saved,{kind:'put',collection:'state',id:'run',value:null,metadata:{category:'active'}},{kind:'put',collection:'workspace',id:'workflowPolicyRunArchive',value:{startedAt,collection:saved.collection,id:saved.id},metadata:{category:'ledger'}}]);stoppedRuns++;
  }
  for await(const row of rows('assignmentRuns'))if(await scalar(row.token,['status'])!=='finished'){
    await commit([await archive(row),{kind:'reference',collection:row.collection,id:row.id,token:await patch(row.token,{status:{value:'finished'},retired:{value:true}}),metadata:{...history,refs:await links(row)}}]);stoppedRuns++;
  }
  for await(const row of rows('tags')){
    const definition=await store.codec.read(row.token,{maxBytes:256*1024,signal}) as TagDefinition,next={...definition,broaderIds:definition.broaderIds.filter(id=>!retired.has(id)),relatedIds:(definition.relatedIds??[]).filter(id=>!retired.has(id))},refs=(await links(row)).filter(ref=>ref.collection!=='tags'||!retired.has(ref.id));
    const type=next.status==='approved'&&next.matchingMode!=='manual'&&!isNoTagDefinition(next)?'enabled':'disabled';
    if(fingerprint(next)!==fingerprint(definition)||row.metadata.type!==type)await commit([{kind:'put',collection:'tags',id:row.id,value:next,metadata:{...row.metadata,type,refs},expectedVersion:row.version}]);
  }
  for await(const row of rows('tagShelves')){
    await commit([await archive(row),{kind:'delete',collection:row.collection,id:row.id}]);
  }
  for await(const row of rows('papers')){
    const refs=(await links(row)).filter(ref=>ref.relation!=='matches'&&(ref.collection!=='tags'||!retired.has(ref.id))),input=await scalar(row.token,['fingerprint']);let after:string|undefined;
    do{const page=await store.scan('scientificMatches',{taskId:row.id,after,limit:50});for(const match of page.rows){
      const tagId=await scalar(match.token,['tagId']),tag=typeof tagId==='string'?await store.get('tags',tagId,{maxBytes:256*1024,signal}) as TagDefinition|undefined:undefined;
      const current=tag&&fingerprint({id:tag.id,name:tag.name,fullName:tag.fullName,description:tag.description,facet:tag.facet,aliases:tag.aliases,inclusions:tag.inclusions,exclusions:tag.exclusions,examples:tag.examples,broaderIds:tag.broaderIds,relatedIds:tag.relatedIds,matchingMode:tag.matchingMode,status:tag.status});
      if(tag&&await scalar(match.token,['inputFingerprint'])===input&&await scalar(match.token,['definitionFingerprint'])===current)refs.push({collection:'tags',id:tag.id,relation:'matches'});else await commit([{kind:'delete',collection:'scientificMatches',id:match.id}]);
    }after=page.next;}while(after);
    await commit([{kind:'reference',collection:'papers',id:row.id,token:row.token,metadata:{...row.metadata,refs},expectedVersion:row.version}]);
  }
  for await(const row of rows('taxonomySupport'))if(retired.has(row.id))await commit([{kind:'reference',collection:row.collection,id:row.id,token:row.token,metadata:{...row.metadata,...history,refs:await links(row)}}]);
  for(const collection of ['suggestions','reviewItems'])for await(const row of rows(collection)){
    const tagId=await scalar(row.token,['tagId']),obsolete=collection==='suggestions'||collection==='reviewItems'&&['definition','assignment'].includes(String(await scalar(row.token,['kind'])));if(!obsolete&&!(typeof tagId==='string'&&retired.has(tagId)))continue;
    if(collection==='suggestions'&&await scalar(row.token,['applied'])===true)continue;
    const updates=collection==='reviewItems'?{state:{value:'resolved'} as PayloadToken,message:{value:'This earlier workflow was retired. Native labels and completed results were kept.'} as PayloadToken,retiredByPolicy:{value:1} as PayloadToken}:{status:{value:'rejected'} as PayloadToken,retiredByPolicy:{value:1} as PayloadToken,retirementReason:{value:'Earlier matching results require the current source policy.'} as PayloadToken};
    await commit([await archive(row),{kind:'reference',collection:row.collection,id:row.id,token:await patch(row.token,updates),metadata:{...history,status:collection==='reviewItems'?'resolved':'rejected',refs:await links(row)}}]);
    if(collection==='reviewItems')withdrawnChoices++;else withdrawnSuggestions++;
  }
  for await(const row of rows('maintenanceTasks')){
    if(!obsoleteTasks.has(String(await scalar(row.token,['kind'])))&&await scalar(row.token,['run','sourcePolicyVersion'])===2)continue;
    const run=await store.codec.lookup(row.token,['run']),updates:Record<string,PayloadToken>={retired:{value:true},status:{value:'completed'}};if(run)updates.run=await patch(run,{status:{value:'idle'},message:{value:'This definition workflow was retired. Completed results and native labels were kept.'}});
    await commit([await archive(row),{kind:'reference',collection:row.collection,id:row.id,token:await patch(row.token,updates),metadata:{...row.metadata,...history,refs:await links(row)}}]);
    retiredTasks++;
  }
  for await(const row of rows('commandLedger')){
    const type=String(await scalar(row.token,['command','type']));if(!obsoleteCommands.has(type)&&!new Set(['prepare-tags','rebuild','tag','resume','retry-papers','scan']).has(type)||!['queued','running','unknown'].includes(row.metadata.status??''))continue;
    const input=await store.reference('queuedInputs',row.id),operations:StoreOperation[]=[{kind:'reference',collection:row.collection,id:row.id,token:await patch(row.token,{status:{value:'failed'},error:{value:'This definition workflow was retired.'}}),metadata:{category:'ledger',status:'failed',taskId:row.metadata.taskId}}];if(input)operations.push({kind:'reference',collection:input.collection,id:input.id,token:input.token,metadata:{...input.metadata,...history,refs:await links(input)}});await commit(operations);
  }
  for await(const row of rows('runJobs'))if(await scalar(row.token,['status'])!=='completed')await commit([await archive(row),{kind:'reference',collection:row.collection,id:row.id,token:await patch(row.token,{status:{value:'completed'},retiredByPolicy:{value:1}}),metadata:{...history,taskId:row.metadata.taskId,refs:await links(row)}}]);
  for(const id of ['nativeDefinitionPreparation','reconciliation','reconciliationPreview','keepTagPlan','keepRemovalPreview','diyComparison','diyMergePreview']){const row=await store.reference('state',id);if(row)await commit([await archive(row),{kind:'delete',collection:'state',id}]);}
  for(const collection of ['nativeMeaningEntries','nativeMeaningTasks','nativeDefinitionHistory','nativeMeaningRevisions'])for await(const row of rows(collection))await commit([{kind:'reference',collection:row.collection,id:row.id,token:row.token,metadata:{...row.metadata,...history,refs:await links(row)}}]);
  for(const collection of ['nativeMeaningDisplays','nativeMeaningQueue','existingTagRows','diyComparisonRows','nativeNames','nativeNamePapers','definitionNames','libraryTags'])for await(const row of rows(collection))await commit([{kind:'delete',collection,id:row.id}]);
  for await(const row of rows('activityTasks')){await commit([await archive(row),{kind:'delete',collection:row.collection,id:row.id}]);archivedActivityTasks++;}
  for(const id of ['nativeDefinitionPreparation','existingTags','diyComparison']){check();await store.delete('viewHeaders',id);}
  // Historical proof and unknown-request records must follow the immutable
  // source versions, rather than the cleaned current paper/cache identities.
  for(const collection of ['tags','taxonomySupport','reviewItems','runJobs','runScopes','maintenanceTasks','nativeMeaningEntries','nativeMeaningTasks','nativeMeaningAdmissions','nativeMeaningScopes','state','providerDispatches','providerScopes','workflowArchives','retiredDefinitionBodies','legacyPaperInputs','legacyFacts','legacyAnalyses','legacyInputChecks'])for await(const row of rows(collection)){
    const before=await links(row);let changed=false;const refs=before.map(ref=>{const archived=archivedRefs.get(ref.collection+'\u0000'+ref.id);if(archived){changed=true;return {...archived,...(ref.relation?{relation:ref.relation}:{})};}return ref;});if(changed)await commit([{kind:'reference',collection,id:row.id,token:row.token,metadata:{...row.metadata,refs}}]);
  }
  const summary={version:1,completedAt:clock(),retiredDefinitions:retired.size,keptDefinitions:kept,retiredTasks,withdrawnChoices,withdrawnSuggestions,stoppedRuns,archivedActivityTasks,nativeLabelsPreserved:true,paidRecoveryPreserved:true,message:'Earlier definition workflows and cached matching inputs were retired. Native labels, archived evidence, paid replies and recent Undo were kept.'};
  const version=await store.get('state','vocabularyVersion',{maxBytes:64});
  await commit([{kind:'put',collection:'state',id:'vocabularyVersion',value:Number(version??0)+1,metadata:{category:'active'}},{kind:'put',collection:'state',id:'workflowTransitionSummary',value:summary,metadata:{category:'active'}},{kind:'put',collection:'workspace',id:'workflowPolicy',value:{version:1,phase:'complete',startedAt,completedAt:clock(),retired:retired.size,kept},metadata:{category:'ledger'}}]);
  return {blocked:false,changed:true,retired:retired.size,kept};
}
