import {initialState} from '../controller.ts';
import type {AppState} from '../controller.ts';
import {WorkspaceStore} from './storage.ts';
import type {DocumentRef,PayloadToken,RecordMetadata,StoreOperation,StoredRecord} from './storage-contract.ts';
import {retainNativeTagDefinitionSnapshot} from '../native-tag-definition.ts';
import type {NativeTagDefinitionWork} from '../native-tag-definition.ts';

export const STATE_MAPS=new Set('papers nativeTags decisions ownership analyses neighbors metadata facts taxonomyRedirects taxonomySupport paperInputs paperAttentionDismissals nativeTagTreatments nativeBindingExclusions definitionOrigins'.split(' '));
export const STATE_ARRAYS=new Set('tags suggestions history cleanup pilotIds verifiedConnections models warnings deferredItemIDs taxonomyArchives preparationHistory nativeDefinitionHistory analysisResetHistory factHistory diyComparisonHistory maintenanceTasks reviewItems tagSelectionHistory legacyConsolidationHistory assignmentRuns uncoveredTopics tagShelves automaticSuppressions userEditedTagIds'.split(' '));
const histories=new Set('history taxonomyArchives preparationHistory nativeDefinitionHistory analysisResetHistory factHistory diyComparisonHistory tagSelectionHistory legacyConsolidationHistory'.split(' '));
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
const unkeyedIds=new WeakMap<object,string>();
async function equalCopy(left:unknown,right:unknown):Promise<boolean>{
  const pending:[unknown,unknown][]=[[left,right]];let slice=Date.now();
  while(pending.length){
    const [a,b]=pending.pop()!;if(a===b)continue;
    if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    const aKeys=Object.keys(a).filter(key=>object(a)[key]!==undefined),bKeys=Object.keys(b).filter(key=>object(b)[key]!==undefined);
    if(aKeys.length!==bKeys.length||Array.isArray(a)&&a.length!==(b as unknown[]).length)return false;
    for(const key of aKeys){if(!Object.hasOwn(b,key))return false;pending.push([object(a)[key],object(b)[key]]);}
    if(Date.now()-slice>=4){await new Promise<void>(resolve=>setTimeout(resolve,0));slice=Date.now();}
  }
  return true;
}
const idOf=(value:unknown,index:number)=>{
  if(typeof object(value).id==='string')return String(object(value).id);
  if(value&&typeof value==='object'){let id=unkeyedIds.get(value);if(!id){id='entry-'+crypto.randomUUID();unkeyedIds.set(value,id);}return id;}
  return `index:${String(index).padStart(12,'0')}`;
};

export function metadataFor(collection:string,value:unknown,now=Date.now(),order?:number):RecordMetadata {
  const entry=object(value),status=collection==='reviewItems'&&typeof entry.state==='string'?entry.state:typeof entry.status==='string'?entry.status:undefined;
  const completed=collection==='assignmentRuns'&&status==='finished'||collection==='maintenanceTasks'&&status==='completed'||collection==='reviewItems'&&status==='resolved'||collection==='warnings'&&status!==undefined&&status!=='active'||collection==='run'&&status==='idle'||collection==='suggestions'&&(entry.applied===true||status==='rejected')||collection==='nativeDefinitionPreparation'&&typeof entry.finishedAt==='string'||collection==='nativeMeaningEntries'&&(!!entry.meaningAdmission||status==='left-undefined');
  const category=histories.has(collection)||completed?'history':collection==='facts'||collection==='analyses'?'cache':'active';
  const date=typeof entry.finishedAt==='string'?Date.parse(entry.finishedAt):typeof entry.date==='string'?Date.parse(entry.date):NaN;
  const title=String(entry.title??entry.name??entry.label??'').slice(0,1000);
  const metadata:RecordMetadata={category,updatedAt:now,...(title?{title,searchText:[title,entry.fullName,entry.abstract,entry.description,...(Array.isArray(entry.aliases)?entry.aliases:[])].filter(value=>typeof value==='string').join(' ').toLocaleLowerCase()}:{}),...(status?{status}:{}),...(typeof entry.taskId==='string'?{taskId:entry.taskId}:typeof entry.runId==='string'?{taskId:entry.runId}:{}),...(category==='cache'?{lastUsedAt:now}:{}),...(category==='history'?{completedAt:Number.isFinite(date)?date:now}:{})};
  if(order!==undefined)Object.assign(metadata,{order});
  if(collection==='history')metadata.count=(Array.isArray(entry.patches)?entry.patches.length:0)+(Array.isArray(entry.metadataPatches)?entry.metadataPatches.length:0)+Object.keys(object(entry.afterDefinitions)).length+(entry.afterShelves?1:0);
  if(collection==='papers'&&typeof entry.itemID==='number')metadata.nativeItemId=entry.itemID;
  if(collection==='tags')metadata.type=entry.status==='approved'&&entry.matchingMode!=='manual'&&entry.builtin!=='no_tag'?'enabled':'disabled';
  if(collection==='definitionOrigins')metadata.category='ledger';
  if(collection==='suggestions')metadata.refs=[...(typeof entry.paperId==='string'?[{collection:'papers',id:entry.paperId}]:[]),...(typeof entry.tagId==='string'?[{collection:'tags',id:entry.tagId}]:[])];
  if(collection==='facts'&&Array.isArray(entry.concepts))metadata.refs=entry.concepts.flatMap(concept=>typeof object(concept).factConceptId==='string'?[{collection:'evidenceSources',id:String(object(concept).factConceptId),relation:'source'}]:[]);
  if(collection==='taxonomySupport')metadata.refs=[...(Array.isArray(entry.paperIds)?entry.paperIds.flatMap(id=>typeof id==='string'?[{collection:'papers',id},{collection:'facts',id}]:[]):[]),...(Array.isArray(entry.sourceIds)?entry.sourceIds.flatMap(id=>typeof id==='string'?[{collection:'evidenceSources',id,relation:'source'}]:[]):[]),...(Array.isArray(entry.registryIds)?entry.registryIds.flatMap(id=>typeof id==='string'?[{collection:'evidenceEntries',id,relation:'source'}]:[]):[])];
  if(collection==='reviewItems')metadata.refs=[...(typeof entry.paperId==='string'?[{collection:'papers',id:entry.paperId},{collection:'facts',id:entry.paperId},{collection:'analyses',id:entry.paperId}]:[]),...(typeof entry.tagId==='string'?[{collection:'tags',id:entry.tagId}]:[]),...(entry.kind==='assignment'&&typeof entry.taskId==='string'?[{collection:'assignmentRuns',id:entry.taskId}]:[]),...(typeof entry.suggestionId==='string'?[{collection:'suggestions',id:entry.suggestionId}]:[]),...(entry.ownerPage==='vocabulary'&&typeof entry.questionId==='string'?[{collection:'nativeMeaningEntries',id:entry.questionId}]:[])];
  if(collection==='nativeDefinitionHistory'){metadata.taskId=String(object(entry.work).id??entry.taskId??'');metadata.pinned=!entry.finishedAt;if(!entry.finishedAt&&typeof entry.taskId==='string')metadata.refs=[{collection:'maintenanceTasks',id:entry.taskId}];}
  if(collection==='preparationHistory'){const preparation=object(entry.preparation);metadata.taskId=String(preparation.id??entry.taskId??'');if(Array.isArray(preparation.questions)&&preparation.questions.some(question=>!Object.hasOwn(object(preparation.answers),String(object(question).id))))metadata.pinned=true;}
  if(collection==='tagSelectionHistory')metadata.taskId=String(object(entry.work).id??entry.taskId??'');
  if(collection==='tags'||collection==='decisions'||collection==='ownership'||collection==='reviewItems'&&entry.state!=='resolved'||!completed&&['running','paused','pending','question','queued'].includes(status??''))metadata.pinned=true;
  return metadata;
}

/** A command hydrates only its working records; unloaded history remains in storage. */
export class WorkingContext {
  state:AppState=initialState();
  private loaded=new Map<string,Map<string,StoredRecord>>();
  private dirty=new Set<string>();
  private dirtyRecords=new Map<string,Set<string>>();
  private savedValues=new Map<string,Map<string,unknown>>();
  private proxies=new WeakMap<object,object>();
  private targets=new WeakMap<object,object>();
  private paths=new Map<string,Map<string,readonly(string|number)[]>>();
  private embeddedSaved=new Map<string,unknown>();
  private preparedEmbedded=new Map<string,unknown>();
  private marks=new Map<string,number>();
  private generation=0;
  private now:()=>number;
  private signal?:AbortSignal;
  private loading=false;
  readonly store:WorkspaceStore;
  constructor(store:WorkspaceStore,{clock=Date.now,signal}:{clock?:()=>number;signal?:AbortSignal}={}){this.store=store;this.now=clock;this.signal=signal;this.state=this.observe(this.state,'') as AppState;}
  private check(){if(this.signal?.aborted)throw this.signal.reason??new Error('Workspace loading cancelled.');}
  private observe(value:unknown,field:string,recordId?:string,path:readonly(string|number)[]=[]):unknown {
    if(!value||typeof value!=='object')return value;
    if(Object.isFrozen(value))return value;
    const existing=this.proxies.get(value);if(existing)return existing;
    const proxy=new Proxy(value as Record<string,unknown>,{
      get:(target,key)=>{
        const next=Reflect.get(target,key);
        const id=recordId??(STATE_MAPS.has(field)?String(key):STATE_ARRAYS.has(field)&&/^\d+$/.test(String(key))?idOf(next,Number(key)):undefined);
        return this.observe(next,field||String(key),id,field?(recordId===undefined&&id!==undefined?[]:[...path,String(key)]):[]);
      },
      set:(target,key,next)=>{const previous=Reflect.get(target,key),append=Array.isArray(target)&&/^\d+$/.test(String(key))&&Number(key)===target.length;if(previous!==next&&!this.loading&&!(STATE_ARRAYS.has(field)&&recordId===undefined&&key==='length'))this.mark(field||String(key),recordId??(STATE_MAPS.has(field)?String(key):STATE_ARRAYS.has(field)&&/^\d+$/.test(String(key))?idOf(next,Number(key)):undefined),field&&(recordId!==undefined||!STATE_ARRAYS.has(field)&&!STATE_MAPS.has(field))?(Array.isArray(target)&&!append?path:[...path,String(key)]):[]);return Reflect.set(target,key,next);},
      deleteProperty:(target,key)=>{if(Reflect.has(target,key)&&!this.loading)this.mark(field||String(key),recordId??(STATE_MAPS.has(field)?String(key):undefined),recordId!==undefined||!STATE_ARRAYS.has(field)&&!STATE_MAPS.has(field)?(Array.isArray(target)?path:[...path,String(key)]):[]);return Reflect.deleteProperty(target,key);},
    });
    const id=unkeyedIds.get(value);if(id)unkeyedIds.set(proxy,id);
    this.targets.set(proxy,value);
    this.proxies.set(value,proxy);this.proxies.set(proxy,proxy);return proxy;
  }
  private mark(field:string,id?:string,path:readonly(string|number)[]=[]){this.dirty.add(field);this.marks.set(field,++this.generation);if(id!==undefined){const ids=this.dirtyRecords.get(field)??new Set<string>();ids.add(id);this.dirtyRecords.set(field,ids);}const key=field+'\u0000'+(id??''),paths=this.paths.get(key)??new Map();paths.set(JSON.stringify(path),path);this.paths.set(key,paths);}
  private assign(field:string,value:unknown){const wasLoading=this.loading;this.loading=true;try{Object.assign(this.state,{[field]:value});}finally{this.loading=wasLoading;}}
  async field(field:string):Promise<unknown> {
    this.check();
    if(this.loaded.has(field))return object(this.state)[field];
    const record=await this.store.reference('state',field);this.loaded.set(field,new Map(record?[[field,record]]:[]));
    if(record){const value=await this.store.codec.read(record.token,{signal:this.signal,maxBytes:Math.max(32*1024*1024,record.bytes*16)});await this.hydrateEmbedded(field,value);this.assign(field,value);}
    return object(this.state)[field];
  }
  async records(field:string,options:{limit?:number;taskId?:string;ids?:string[];statuses?:string[]}={}):Promise<void> {
    this.check();
    const wasLoaded=this.loaded.has(field),loaded=this.loaded.get(field)??new Map<string,StoredRecord>();this.loaded.set(field,loaded);
    const records:StoredRecord[]=[];
    if(options.ids){for(const id of options.ids){const row=await this.store.reference(field,id);if(row&&!loaded.has(id))records.push(row);}}
    else {let after:string|undefined;do{this.check();const page=await this.store.scan(field,{after,limit:50,...(options.taskId?{taskId:options.taskId}:{}),...(options.statuses?{statuses:options.statuses}:{})});records.push(...page.rows.filter(row=>!loaded.has(row.id)));after=page.next;if(options.limit&&records.length>=options.limit)break;}while(after);}
    records.sort((a,b)=>Number((a.metadata as Record<string,unknown>).order??0)-Number((b.metadata as Record<string,unknown>).order??0));
    const current=object(this.state)[field];
    const result:Record<string,unknown>|unknown[]=STATE_ARRAYS.has(field)?[...(wasLoaded&&Array.isArray(current)?current:[])]:{...object(current)};
    for(const record of options.limit?records.slice(0,options.limit):records){
      this.check();const decoded=await this.store.codec.read(record.token,{signal:this.signal,maxBytes:Math.max(32*1024*1024,record.bytes*16)});if(decoded&&typeof decoded==='object'&&typeof object(decoded).id!=='string')unkeyedIds.set(decoded,record.id);await this.hydrateEmbedded(field,decoded);const value=this.observe(decoded,field,record.id);loaded.set(record.id,record);
      const values=this.savedValues.get(field)??new Map<string,unknown>();values.set(record.id,value);this.savedValues.set(field,values);
      if(Array.isArray(result))result.push(value);else result[record.id]=value;
    }
    this.assign(field,result);
  }
  async paper(id:string):Promise<void>{for(const field of ['papers','nativeTags','facts','analyses','ownership','paperInputs'])await this.records(field,{ids:[id]});}
  async seed():Promise<void>{for(const key of Object.keys(this.state))this.mark(key);await this.checkpoint(this.state);}
  assignField(field:string,value:unknown){Object.assign(this.state,{[field]:value});}
  async catalog():Promise<void>{
    await this.field('evidenceCatalog');
    const catalog=this.state.evidenceCatalog;
    this.loading=true;
    try{for(const [collection,target] of [['evidenceSources',catalog.sources],['evidenceEntries',catalog.entries],['evidenceAliases',catalog.registryAliases??={}]] as const){
      let after:string|undefined;
      do{const page=await this.store.scan(collection,{after,limit:50});for(const row of page.rows)if(!Object.hasOwn(target,row.id))Object.assign(target,{[row.id]:await this.store.codec.read(row.token)});after=page.next;}while(after);
    }}finally{this.loading=false;}
  }
  private async embedded(collection:string,taskId:string):Promise<unknown[]>{
    const result:{value:unknown;order:number}[]=[];let after:string|undefined;
    do{const page=await this.store.scan(collection,{taskId,after,limit:50});for(const row of page.rows){const value=await this.store.codec.read(row.token);this.embeddedSaved.set(collection+'\u0000'+row.id,value);result.push({value,order:row.metadata.order??0});}after=page.next;}while(after);
    return result.sort((a,b)=>a.order-b.order).map(item=>item.value);
  }
  private async hydrateEmbedded(field:string,value:unknown){
    const objectValue=object(value),work=object(objectValue.work);
    if(field==='evidenceCatalog'&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error('The saved evidence catalog is invalid. Its original records were preserved.');
    if(field==='evidenceCatalog')for(const key of ['sources','entries','registryAliases']){
      if(objectValue[key]===undefined)objectValue[key]={};
      else if(!objectValue[key]||typeof objectValue[key]!=='object'||Array.isArray(objectValue[key]))throw new Error('The saved evidence catalog is invalid. Its original records were preserved.');
    }
    if((field==='nativeDefinitionPreparation'||field==='nativeDefinitionHistory')&&typeof work.id==='string'){
      if(!Array.isArray(work.entries))work.entries=await this.embedded('nativeMeaningEntries',work.id);
      if(!Array.isArray(work.tasks))work.tasks=await this.embedded('nativeMeaningTasks',work.id);
      retainNativeTagDefinitionSnapshot(work as unknown as NativeTagDefinitionWork);
    }
    const run=field==='run'?objectValue:field==='maintenanceTasks'?object(objectValue.run):undefined;
    if(run&&typeof run.id==='string'&&!Array.isArray(run.jobs))run.jobs=await this.embedded('runJobs',run.id);
  }
  private async embeddedOperations(collection:string,values:unknown[],taskId:string,sourceField:string,sourceId?:string,scopeId?:string):Promise<StoreOperation[]>{
    const result:StoreOperation[]=[];
    const paths=[...this.paths.get(sourceField+'\u0000'+(sourceId??''))?.values()??[]],prefix=collection==='runJobs'?(sourceField==='run'?['jobs']:['run','jobs']):['work',collection==='nativeMeaningEntries'?'entries':'tasks'];
    for(let index=0;index<values.length;index++){
      const value=values[index],id=idOf(value,index),key=collection+'\u0000'+id,saved=this.embeddedSaved.get(key),same=saved===value||saved&&typeof saved==='object'&&this.proxies.get(saved)===value;
      const changed=paths.some(path=>path.length<=prefix.length&&path.every((part,index)=>String(part)===prefix[index])||prefix.every((part,index)=>String(path[index])===part)&&String(path[prefix.length])===String(index));
      if(same&&!changed)continue;
      const previous=await this.store.reference(collection,id),paperId=object(value).paperId,paperIds=typeof paperId==='string'?[paperId]:Array.isArray(object(value).paperIds)?object(value).paperIds as unknown[]:[],refs=paperIds.flatMap(id=>typeof id==='string'?[{collection:'papers',id},{collection:'facts',id},{collection:'analyses',id}]:[]);
      if(scopeId)refs.push({collection:'nativeMeaningScopes',id:scopeId});
      if(collection==='runJobs'&&typeof paperId==='string')for(const suggestion of this.state.suggestions)if(suggestion.paperId===paperId&&suggestion.runId===taskId)refs.push({collection:'suggestions',id:suggestion.id});
      if(previous){let offset:number|undefined;do{const links=await this.store.links(collection,id,{offset,limit:50});refs.push(...links.rows.filter(ref=>ref.collection==='providerReplies'));offset=links.next;}while(offset!==undefined);}
      const metadata=metadataFor(collection,value,this.now(),index),completed=metadata.category==='history'||(collection==='runJobs'||collection==='nativeMeaningTasks')&&object(value).status==='completed';
      result.push({kind:'put',collection,id,value,metadata:{...metadata,category:completed?'history':'active',completedAt:completed?previous?.metadata.completedAt??this.now():undefined,taskId,refs},expectedVersion:previous?.version??0});this.preparedEmbedded.set(key,value);
    }
    return result;
  }
  private async normalizeEmbedded(field:string,value:unknown,operations:StoreOperation[],sourceId?:string):Promise<unknown>{
    const objectValue=object(value);
    if(field==='evidenceCatalog'){
      for(const [key,collection] of [['sources','evidenceSources'],['entries','evidenceEntries'],['registryAliases','evidenceAliases']] as const){
        const paths=[...this.paths.get('evidenceCatalog\u0000')?.values()??[]],whole=!paths.length||paths.some(path=>!path.length||path[0]===key&&path.length===1);
        const ids=whole?Object.keys(object(objectValue[key])):[...new Set(paths.filter(path=>path[0]===key&&path.length>1).map(path=>String(path[1])))];
        for(const id of ids){const entry=object(objectValue[key])[id],previous=await this.store.reference(collection,id);operations.push(entry===undefined?{kind:'delete',collection,id,expectedVersion:previous?.version??0}:{kind:'put',collection,id,value:entry,metadata:{category:'cache',updatedAt:this.now(),lastUsedAt:previous?.metadata.lastUsedAt??this.now(),...(collection==='evidenceEntries'&&Array.isArray(object(entry).sourceIds)?{refs:(object(entry).sourceIds as unknown[]).flatMap(id=>typeof id==='string'?[{collection:'evidenceSources',id,relation:'source'}]:[])}:{})},expectedVersion:previous?.version??0});}
      }
      return {...objectValue,sources:{},entries:{},registryAliases:{}};
    }
    if(field==='nativeDefinitionPreparation'||field==='nativeDefinitionHistory'){
      const work=object(objectValue.work);
      if(typeof work.id==='string'){
        retainNativeTagDefinitionSnapshot((this.targets.get(work)??work) as unknown as NativeTagDefinitionWork);
        const scopeId=work.id+':'+String(work.fingerprint);if(!await this.store.reference('nativeMeaningScopes',scopeId))operations.push({kind:'put',collection:'nativeMeaningScopes',id:scopeId,value:work.snapshot,metadata:{category:'cache',taskId:work.id,lastUsedAt:this.now()}});
        if(field==='nativeDefinitionPreparation'){
          operations.push(...await this.embeddedOperations('nativeMeaningEntries',Array.isArray(work.entries)?work.entries:[],work.id,field,sourceId,scopeId));
          operations.push(...await this.embeddedOperations('nativeMeaningTasks',Array.isArray(work.tasks)?work.tasks:[],work.id,field,sourceId,scopeId));
        }
        for(const entry of Array.isArray(work.entries)?work.entries:[]){const admission=object(object(entry).meaningAdmission);if(typeof admission.changeId==='string'){const id=JSON.stringify([work.id,object(entry).id,admission.changeId]);if(!await this.store.reference('nativeMeaningAdmissions',id))operations.push({kind:'put',collection:'nativeMeaningAdmissions',id,value:{workId:work.id,entry,scopeId},metadata:{category:'history',completedAt:this.now(),refs:[{collection:'nativeMeaningScopes',id:scopeId}]}});}}
        const revisions=Array.isArray(work.history)?work.history:[];
        for(let index=0;index<revisions.length;index++){const revision=revisions[index],token=await this.store.codec.reference(await this.store.codec.encode(revision));if(!('ref' in token))throw new Error('A persisted native revision requires a content identity.');const id=work.id+':'+token.ref;if(!await this.store.reference('nativeMeaningRevisions',id))operations.push({kind:'reference',collection:'nativeMeaningRevisions',id,token,metadata:{category:'history',taskId:work.id,completedAt:this.now(),order:index}});}
        for(const entry of [...Array.isArray(work.entries)?work.entries:[],...revisions.flatMap(revision=>Array.isArray(object(revision).entries)?object(revision).entries as unknown[]:[])]){
          const item=object(entry);for(const [paperId,judgment] of Object.entries(object(item.judgments))){const source=object(judgment),id=JSON.stringify([work.id,item.id,paperId,source.definitionFingerprint,source.sourceFingerprint]);if(!await this.store.reference('nativeJudgments',id))operations.push({kind:'put',collection:'nativeJudgments',id,value:{workId:work.id,entryId:item.id,paperId,judgment},metadata:{category:'cache',taskId:String(item.id),status:typeof source.relation==='string'?source.relation:undefined,lastUsedAt:this.now()}});}
        }
        const {entries:unusedEntries,tasks:unusedTasks,history:unusedHistory,cachedJudgments:unusedCached,reusedJudgmentIds:unusedReused,...header}=work;void unusedEntries;void unusedTasks;void unusedHistory;void unusedCached;void unusedReused;
        return {...objectValue,work:field==='nativeDefinitionPreparation'?header:{...header,entries:work.entries,tasks:work.tasks}};
      }
    }
    const run=field==='run'?objectValue:field==='maintenanceTasks'?object(objectValue.run):undefined;
    if(run&&typeof run.id==='string'&&Array.isArray(run.jobs)){
      if(!await this.store.reference('runScopes',run.id))operations.push({kind:'put',collection:'runScopes',id:run.id,value:{runId:run.id,settings:run.settings,processingPolicy:run.processingPolicy,kind:run.kind,scope:run.scope,vocabularyVersion:run.vocabularyVersion},metadata:{category:'cache',lastUsedAt:this.now(),refs:run.jobs.flatMap(job=>typeof object(job).id==='string'?[{collection:'runJobs',id:String(object(job).id)}]:[])}});
      operations.push(...await this.embeddedOperations('runJobs',run.jobs,run.id,field,sourceId));
      const {jobs,...header}=run;void jobs;return field==='run'?header:{...objectValue,run:header};
    }
    return value;
  }
  /** Release a completed paper without treating its unloaded records as deletions. */
  releasePaper(id:string,{keepFacts=false,keepMetadata=false}:{keepFacts?:boolean;keepMetadata?:boolean}={}){
    this.loading=true;
    try{for(const field of ['papers','nativeTags','facts','analyses','ownership','paperInputs']){
      if(field==='facts'&&keepFacts)continue;
      if(field==='papers'&&keepMetadata){delete this.state.papers[id]?.pdfText;continue;}
      if(this.dirtyRecords.get(field)?.has(id))continue;
      delete object(object(this.state)[field])[id];this.loaded.get(field)?.delete(id);this.savedValues.get(field)?.delete(id);
    }}finally{this.loading=false;}
  }
  setState(state:AppState){const observed=this.observe(state,'') as AppState;if(observed!==this.state){for(const key of new Set([...Object.keys(this.state),...Object.keys(observed)]))if(object(this.state)[key]!==object(observed)[key])this.mark(key);this.state=observed;}}
  changedFields(){return new Set(this.dirty);}
  changedRecords(){return new Map([...this.dirty].map(field=>[field,this.paths.has(field+'\u0000')?null:new Set(this.dirtyRecords.get(field)??[])] as const));}
  /** Retention evicts working copies as well as their durable records. */
  pruneExpired(removed:readonly DocumentRef[]){
    this.loading=true;
    try{for(const ref of removed){
      this.embeddedSaved.delete(ref.collection+'\u0000'+ref.id);
      if(ref.collection==='nativeMeaningTasks'&&this.state.nativeDefinitionPreparation)this.state.nativeDefinitionPreparation.work.tasks=this.state.nativeDefinitionPreparation.work.tasks.filter(task=>task.id!==ref.id);
      const field=ref.collection==='state'?ref.id:ref.collection,loaded=this.loaded.get(field);
      if(!loaded?.has(ref.id))continue;
      loaded.delete(ref.id);this.savedValues.get(field)?.delete(ref.id);this.dirtyRecords.get(field)?.delete(ref.id);
      if(ref.collection==='state'){
        if(field==='run')this.state.run=null;else if(field==='taxonomyProposal')this.state.taxonomyProposal=null;else Reflect.deleteProperty(this.state,field);
        this.loaded.delete(field);this.dirty.delete(field);this.dirtyRecords.delete(field);
      }else if(STATE_ARRAYS.has(field)){const current=object(this.state)[field];if(Array.isArray(current))this.assign(field,current.filter((value,index)=>idOf(value,index)!==ref.id));}
      else if(STATE_MAPS.has(field))delete object(object(this.state)[field])[ref.id];
    }}finally{this.loading=false;}
  }
  async rebase(field:string,ids?:Iterable<string>){const loaded=this.loaded.get(field);if(!loaded)return;for(const id of ids??loaded.keys()){if(!loaded.has(id))continue;const record=await this.store.reference(STATE_ARRAYS.has(field)||STATE_MAPS.has(field)?field:'state',id);if(record)loaded.set(id,record);else loaded.delete(id);}}
  async definitionLinks(id:string):Promise<NonNullable<RecordMetadata['refs']>>{
    const refs:NonNullable<RecordMetadata['refs']>=[];let offset:number|undefined;
    do{const page=await this.store.links('tags',id,{offset,limit:50});refs.push(...page.rows.filter(ref=>ref.relation!=='broader'));offset=page.next;}while(offset!==undefined);
    const tag=this.state.tags.find(tag=>tag.id===id);for(const parent of tag?.broaderIds??[])refs.push({collection:'tags',id:parent,relation:'broader'});
    const support=this.state.taxonomySupport[id];if(support){refs.push({collection:'taxonomySupport',id,relation:'source'});for(const sourceId of support.sourceIds??[])refs.push({collection:'evidenceSources',id:sourceId,relation:'source'});for(const registryId of support.registryIds??[])refs.push({collection:'evidenceEntries',id:registryId,relation:'source'});}
    const current=this.state.nativeDefinitionPreparation;for(const entry of current?.work.entries??[])if(entry.meaningAdmission?.tagId===id)refs.push({collection:'nativeMeaningAdmissions',id:JSON.stringify([current!.work.id,entry.id,entry.meaningAdmission.changeId]),relation:'source'});
    return [...new Map(refs.map(ref=>[JSON.stringify(ref),ref])).values()];
  }
  private async patch(token:PayloadToken,value:unknown,paths:readonly(readonly(string|number)[])[]):Promise<PayloadToken>{
    if(paths.some(path=>!path.length))return this.store.codec.encode(value);
    const selected=new Map<string,(readonly(string|number)[])[]>();
    for(const path of paths){const key=String(path[0]),children=selected.get(key)??[];children.push(path.slice(1));selected.set(key,children);}
    const array=Array.isArray(value),builder=array?this.store.codec.arrayBuilder():this.store.codec.objectBuilder(),seen=new Set<string>();
    let after:number|undefined;
    do{const page=await this.store.codec.entries(token,{after,limit:50});for(const entry of page.entries){
      const key=String(entry.key),children=selected.get(key),next=object(value)[key];seen.add(key);
      if(children&&next===undefined)continue;
      const child=children?await this.patch(entry.token,next,children):entry.token;
      if(array)await (builder as ReturnType<WorkspaceStore['codec']['arrayBuilder']>).append(child);else await (builder as ReturnType<WorkspaceStore['codec']['objectBuilder']>).append(key,child);
    }after=page.next;}while(after!==undefined);
    for(const key of selected.keys())if(!seen.has(key)&&object(value)[key]!==undefined){const child=await this.store.codec.encode(object(value)[key]);if(array)await (builder as ReturnType<WorkspaceStore['codec']['arrayBuilder']>).append(child);else await (builder as ReturnType<WorkspaceStore['codec']['objectBuilder']>).append(key,child);}
    return builder.finish();
  }
  private async put(field:string,id:string,value:unknown,previous:StoredRecord|undefined,metadata:RecordMetadata):Promise<StoreOperation>{
    previous??=await this.store.reference(STATE_ARRAYS.has(field)||STATE_MAPS.has(field)?field:'state',id);
    if(field==='papers')metadata.nativeVersion??=previous?.metadata.nativeVersion;
    if(field==='tags')metadata.refs=await this.definitionLinks(id);
    if(field==='history'&&object(value).automaticGroupId===id){metadata.completedAt=Date.parse(String(object(value).date));metadata.pinned=!!this.state.run&&this.state.run.id===object(value).taskId&&this.state.run.status!=='idle';}
    if(field==='preparationHistory'&&metadata.pinned){const workId=object(object(value).proposal).id;for(const [index,selection] of (this.state.tagSelectionHistory??[]).entries())if(selection.work.id===workId)(metadata.refs??=[]).push({collection:'tagSelectionHistory',id:idOf(selection,index)});}
    if(field==='run'&&this.state.run)metadata.refs=[{collection:'runScopes',id:this.state.run.id}];
    if(field==='assignmentRuns'&&typeof object(value).id==='string')metadata.refs=object(value).status==='finished'?[]:[{collection:'runScopes',id:String(object(value).id)}];
    if(field==='maintenanceTasks'&&typeof object(object(value).run).id==='string')metadata.refs=[{collection:'runScopes',id:String(object(object(value).run).id)}];
    if(field==='nativeDefinitionPreparation'){metadata.refs=(this.state.nativeDefinitionPreparation?.work.tasks??[]).filter(task=>task.status!=='completed').map(task=>({collection:'nativeMeaningTasks',id:task.id}));if(this.state.nativeDefinitionPreparation&&!this.state.nativeDefinitionPreparation.finishedAt)metadata.refs.push({collection:'maintenanceTasks',id:this.state.nativeDefinitionPreparation.taskId});}
    const paths=[...this.paths.get(field+'\u0000'+(STATE_ARRAYS.has(field)||STATE_MAPS.has(field)?id:''))?.values()??[]];
    return previous&&paths.length&&!paths.some(path=>!path.length)?{kind:'reference',collection:previous.collection,id,token:await this.patch(previous.token,value,paths),metadata,expectedVersion:previous.version}:{kind:'put',collection:STATE_ARRAYS.has(field)||STATE_MAPS.has(field)?field:'state',id,value,metadata,expectedVersion:previous?.version??0};
  }
  async checkpoint(state:AppState):Promise<Map<string,Set<string>|null>> {
    this.setState(state);
    const fields=[...this.dirty],changes=new Map<string,Set<string>|null>();if(!fields.length)return changes;
    const marks=new Map(fields.map(field=>[field,this.marks.get(field)]));
    this.preparedEmbedded.clear();
    const operations:StoreOperation[]=[];const nextLoaded=new Map<string,Map<string,StoredRecord>>();
    for(const field of fields){
      if(field==='schemaVersion')continue;
      const start=operations.length,changedIds=new Set<string>();
      const value=object(this.state)[field],previous=this.loaded.get(field)??new Map<string,StoredRecord>();
      if(STATE_ARRAYS.has(field)||STATE_MAPS.has(field)){
        const entries:[string,unknown][]=[];
        if(Array.isArray(value)){
          const previousOrder=new Map([...previous].map(([id,record])=>[record.metadata.order,id]));
          for(let index=0;index<value.length;index++){
            const entry=value[index],priorId=previousOrder.get(index),saved=priorId?this.savedValues.get(field)?.get(priorId):undefined;
            if(entry&&typeof entry==='object'&&typeof object(entry).id!=='string'&&!previous.has(idOf(entry,index))&&priorId&&saved!==undefined&&await equalCopy(saved,entry))unkeyedIds.set(entry,priorId);
            entries.push([idOf(entry,index),entry]);
          }
        }else entries.push(...Object.entries(object(value)));
        const present=new Set(entries.map(([id])=>id));
        const dirtyIds=this.dirtyRecords.get(field);
        for(let index=0;index<entries.length;index++){
          const [id,entry]=entries[index],saved=this.savedValues.get(field)?.get(id);if(!dirtyIds?.has(id)&&saved===entry)continue;
          if(!dirtyIds?.has(id)&&saved!==undefined&&saved!==entry&&await equalCopy(saved,entry)){this.savedValues.get(field)!.set(id,entry);continue;}
          const normalized=await this.normalizeEmbedded(field,entry,operations,id);
          const metadata=metadataFor(field,entry,this.now(),Array.isArray(value)?index:undefined);if(metadata.category==='history')metadata.completedAt=previous.get(id)?.metadata.completedAt??this.now();
          operations.push(await this.put(field,id,normalized,previous.get(id),metadata));
          changedIds.add(id);
        }
        for(const id of previous.keys())if(!present.has(id)){operations.push({kind:'delete',collection:field,id});changedIds.add(id);}
      }else if(value===undefined)operations.push({kind:'delete',collection:'state',id:field});
      else {const saved=this.savedValues.get(field)?.get(field);if(saved===undefined||saved===value||!await equalCopy(saved,value)){const normalized=await this.normalizeEmbedded(field,value,operations);operations.push(await this.put(field,field,normalized,previous.get(field),metadataFor(field,value,this.now())));}else this.savedValues.get(field)!.set(field,value);}
      if(operations.length>start)changes.set(field,STATE_ARRAYS.has(field)||STATE_MAPS.has(field)?changedIds:null);
      nextLoaded.set(field,previous);
    }
    if(fields.includes('run')){
      const runId=this.state.run?.id,groupId=runId?'automatic-assignment:'+runId:undefined;
      if(groupId&&!operations.some(operation=>operation.collection==='history'&&operation.id===groupId)){
        const previous=await this.store.reference('history',groupId),pinned=this.state.run?.status!=='idle';
        if(previous&&!!previous.metadata.pinned!==pinned){const refs:DocumentRef[]=[];let offset:number|undefined;do{const page=await this.store.links('history',groupId,{offset,limit:50});refs.push(...page.rows);offset=page.next;}while(offset!==undefined);operations.push({kind:'reference',collection:'history',id:groupId,token:previous.token,metadata:{...previous.metadata,pinned,refs},expectedVersion:previous.version});}
      }
    }
    if(operations.length)await this.store.commitRecords(operations);
    for(const [key,value] of this.preparedEmbedded)this.embeddedSaved.set(key,value);
    if(fields.includes('nativeDefinitionPreparation')){this.loading=true;try{if(this.state.nativeDefinitionPreparation){delete this.state.nativeDefinitionPreparation.work.history;delete this.state.nativeDefinitionPreparation.work.reusedJudgmentIds;}}finally{this.loading=false;}}
    for(const field of fields){if(this.marks.get(field)===marks.get(field)){this.dirty.delete(field);this.dirtyRecords.delete(field);for(const key of this.paths.keys())if(key.startsWith(field+'\u0000'))this.paths.delete(key);}this.loaded.set(field,nextLoaded.get(field)??new Map<string,StoredRecord>());}
    for(const operation of operations){
      const field=operation.collection==='state'?operation.id:operation.collection,loaded=this.loaded.get(field);if(!loaded)continue;
      if(operation.kind==='delete'){loaded.delete(operation.id);this.savedValues.get(field)?.delete(operation.id);continue;}
      const record=await this.store.reference(operation.collection,operation.id);if(record)loaded.set(operation.id,record);
      if(operation.kind==='put'||operation.kind==='reference'){const values=this.savedValues.get(field)??new Map<string,unknown>(),current=object(this.state)[field];values.set(operation.id,Array.isArray(current)?current.find((item,index)=>idOf(item,index)===operation.id):STATE_MAPS.has(field)?object(current)[operation.id]:current);this.savedValues.set(field,values);}
    }
    return changes;
  }
}
