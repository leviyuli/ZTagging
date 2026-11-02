import {initialState,validLegacyState,validState} from '../controller.ts';
import type {AppState} from '../controller.ts';
import {canonicalTagKey,fingerprint} from '../core.ts';
import type {TagDefinition} from '../core.ts';
import {equivalentTagNames} from '../concept-filter.ts';
import {nativeBindingAllows} from '../native-binding.ts';
import {isPersonalNativeTagName} from '../native-meaning-policy.ts';
import {isNoTagDefinition} from '../tag-policy.ts';
import {migrateTagShelves} from '../tag-shelves.ts';
import {migrateWarningEpisodes} from '../warnings.ts';
import {cleanupLegacyDraftDefinitions,inferEditedProposalTagIds,pruneProposalSupport} from '../legacy-cleanup.ts';
import type {MigrationContext,MigrationIO,MigrationOptions,MigrationTarget,WorkspaceLocator} from './migration-contract.ts';
import {LegacyValidationError} from './migration-contract.ts';
import {fingerprintMigrationFile} from './migration.ts';
import {WorkspaceStore} from './storage.ts';
import type {PayloadToken,RecordMetadata,StoredRecord,StoreOperation} from './storage-contract.ts';
import {validateNativeReviewGraph,validateRegistryGraph} from './migration-native-validation.ts';
import {normalizeEarlyLegacy} from './migration-legacy.ts';
import {validateArchiveGraph} from './migration-archive-validation.ts';
import {validateRunGraph} from './migration-run-validation.ts';
import {conceptMeaningFingerprint} from '../taxonomy.ts';

const encoder=new TextEncoder();
const mapCollections=new Set('papers nativeTags decisions ownership analyses neighbors metadata facts taxonomyRedirects taxonomySupport paperInputs paperAttentionDismissals nativeTagTreatments nativeBindingExclusions'.split(' '));
const arrayCollections=new Set('tags suggestions history cleanup pilotIds verifiedConnections models warnings deferredItemIDs taxonomyArchives preparationHistory nativeDefinitionHistory analysisResetHistory factHistory diyComparisonHistory maintenanceTasks reviewItems tagSelectionHistory legacyConsolidationHistory assignmentRuns uncoveredTopics tagShelves automaticSuppressions userEditedTagIds'.split(' '));
const requiredMaps='papers nativeTags decisions ownership metadata analyses neighbors'.split(' ');
const requiredArrays='tags suggestions history cleanup pilotIds verifiedConnections models warnings'.split(' ');
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const order=(metadata:RecordMetadata)=>Number((metadata as RecordMetadata&{order?:number}).order??0);

export interface MigrationTargetOptions {clock?:()=>number;legacyBaseline?:readonly TagDefinition[];yieldControl?:()=>Promise<void>;validationProgress?:(collection:string)=>void;signal?:AbortSignal}

/** Staging and normalization live behind the migration interface, never in UI callers. */
export class StorageMigrationTarget implements MigrationTarget {
  readonly codec:WorkspaceStore['codec'];
  private store:WorkspaceStore;private now:()=>number;private options:MigrationTargetOptions;
  private prefix='';private generation='';private collections=new Set<string>();private release?:()=>void;
  private pendingReferences:StoreOperation[]=[];
  constructor(store:WorkspaceStore,options:MigrationTargetOptions={}){this.store=store;this.codec=store.codec;this.options=options;this.now=options.clock??Date.now;}
  private check(){if(this.options.signal?.aborted)throw this.options.signal.reason??new Error('Smart Tags migration cancelled.');}
  private collection(name:string){return this.prefix+name;}
  async begin(context:{generation:string;sourcePath:string;sourceBytes:number;startedAt:number}){
    if(await this.store.reference('workspace','active'))throw new Error('An active workspace already exists. Preserve its database and restore its matching locator.');
    this.release?.();this.release=this.store.lease();
    const abandoned=await this.store.get('workspace','importing',{maxBytes:16*1024}) as {prefix?:string;collections?:string[]}|undefined;
    if(abandoned?.prefix?.startsWith('stage:'))for(const collection of abandoned.collections??[])await this.clearCollection(abandoned.prefix+collection);
    this.generation=context.generation;this.prefix='stage:'+context.generation.slice(-40)+':';this.collections.clear();this.pendingReferences=[];
    await this.store.put('workspace','importing',{...context,prefix:this.prefix,collections:[]},{category:'ledger',pinned:true});
  }
  async putReference(collection:string,id:string,token:PayloadToken,metadata:RecordMetadata){
    this.check();
    if(!this.collections.has(collection)){this.collections.add(collection);await this.store.put('workspace','importing',{generation:this.generation,prefix:this.prefix,collections:[...this.collections]},{category:'ledger',pinned:true});}const normalized={...metadata,refs:metadata.refs?.map(ref=>({...ref,collection:this.collection(ref.collection)}))};this.pendingReferences.push({kind:'reference',collection:this.collection(collection),id,token,metadata:normalized});if(this.pendingReferences.length===20)await this.flushReferences();
  }
  private async flushReferences(){this.check();if(!this.pendingReferences.length)return;const operations=this.pendingReferences;await this.store.commit({commandId:crypto.randomUUID(),operations});this.pendingReferences=[];}
  private async* rawRecords(collection:string):AsyncGenerator<StoredRecord>{let after:string|undefined;for(;;){this.check();const page=await this.store.scan(collection,{after,limit:50});yield* page.rows;if(!page.next)break;after=page.next;await this.options.yieldControl?.();}}
  private async clearCollection(collection:string){for await(const row of this.rawRecords(collection)){this.pendingDeletes.push({kind:'delete',collection,id:row.id});if(this.pendingDeletes.length===20)await this.flushDeletes();}await this.flushDeletes();}
  private pendingDeletes:StoreOperation[]=[];
  private async flushDeletes(){if(!this.pendingDeletes.length)return;await this.store.commit({commandId:crypto.randomUUID(),operations:this.pendingDeletes});this.pendingDeletes=[];}
  private async* records(collection:string):AsyncGenerator<StoredRecord>{await this.flushReferences();let after:string|undefined;for(;;){this.check();const page=await this.store.scan(this.collection(collection),{after,limit:50});for(const row of page.rows){this.check();yield row;}if(!page.next)break;after=page.next;await this.options.yieldControl?.();}}
  private async* entries(token:PayloadToken|undefined):AsyncGenerator<{key:string|number;token:PayloadToken}>{if(!token)return;let after:number|undefined;for(;;){this.check();const page=await this.codec.entries(token,{after,limit:50});yield* page.entries;if(page.next===undefined)break;after=page.next;}}
  private async get(collection:string,id:string,maxBytes=2*1024*1024):Promise<unknown>{await this.flushReferences();return this.store.get(this.collection(collection),id,{maxBytes});}
  private async scalar(token:PayloadToken|undefined,path:readonly(string|number)[]):Promise<unknown>{if(!token)return;const child=await this.codec.lookup(token,path);return child?this.codec.read(child,{maxBytes:32*1024,signal:this.options.signal}):undefined;}
  private async patch(token:PayloadToken,path:readonly string[],value:PayloadToken|undefined):Promise<PayloadToken>{
    if(await this.codec.kind(token)!=='object')return token;
    const key=path[0],builder=this.codec.objectBuilder();let found=false;
    for await(const entry of this.entries(token)){
      if(entry.key===key){found=true;const next=path.length===1?value:await this.patch(entry.token,path.slice(1),value);if(next)await builder.append(String(entry.key),next);}
      else await builder.append(String(entry.key),entry.token);
    }
    if(!found&&path.length===1&&value)await builder.append(key,value);
    return builder.finish();
  }
  private async change(collection:string,id:string,path:readonly string[],value:unknown,remove=false){await this.flushReferences();const row=await this.store.reference(this.collection(collection),id);if(!row)return;await this.putReference(collection,id,await this.patch(row.token,path,remove?undefined:await this.codec.encode(value)),row.metadata);}
  private async shape(token:PayloadToken|undefined,kind:'object'|'array'):Promise<boolean>{
    if(!token)return false;if('value' in token)return false;
    const page=await this.codec.entries(token,{limit:1});if(page.entries.length)return typeof page.entries[0].key===(kind==='object'?'string':'number');
    try{const value=await this.codec.read(token,{maxBytes:512});return kind==='array'?Array.isArray(value):object(value);}catch{return false;}
  }
  async validateLegacy(context:MigrationContext):Promise<{valid:boolean;reason?:string}>{
    await this.flushReferences();
    for(const key of requiredMaps)if(!await this.shape(context.fields.get(key),'object'))return {valid:false,reason:`Legacy ${key} is not a map.`};
    for(const key of requiredArrays)if(!await this.shape(context.fields.get(key),'array'))return {valid:false,reason:`Legacy ${key} is not a list.`};
    const settings=await this.get('state','settings');if(!object(settings)||!['api','chatgpt','deepseek'].includes(String(settings.provider))||typeof settings.model!=='string'||typeof settings.autoAssign!=='boolean'||!['budgetUSD','inputPricePerMillion','outputPricePerMillion','maxOutputTokens'].every(key=>typeof settings[key]==='number'&&Number.isFinite(settings[key])))return {valid:false,reason:'Legacy provider settings are invalid.'};
    const sourceVersion=context.sourceVersion;
    for(const [key,check] of Object.entries({vocabularyVersion:(value:unknown)=>Number.isInteger(value)&&Number(value)>=0,pilotReviewed:(value:unknown)=>typeof value==='boolean',pilotVersion:Number.isInteger,pilotExpected:Number.isInteger,...(sourceVersion>1?{taxonomyReady:(value:unknown)=>typeof value==='boolean'}:{})}))if(!check(await this.get('state',key)))return {valid:false,reason:`Legacy ${key} is invalid.`};
    for(const collection of [...mapCollections,...arrayCollections]){this.options.validationProgress?.(collection);for await(const row of this.records(collection)){
      if(['analyses','neighbors','metadata','taxonomyRedirects','taxonomySupport','cleanup','pilotIds','verifiedConnections','models'].includes(collection))continue;
      if(collection==='papers'){
        for(const key of ['id','title','abstract']){const token=await this.codec.lookup(row.token,[key]);if(!token||await this.codec.kind(token)!=='string')return {valid:false,reason:'Legacy paper metadata is invalid.'};}
        if(!await this.shape(await this.codec.lookup(row.token,['keywords']),'array')||!Number.isInteger(await this.scalar(row.token,['itemID'])))return {valid:false,reason:'Legacy paper metadata is invalid.'};continue;
      }
      let value:unknown;
      try{value=await this.codec.read(row.token,{maxBytes:2*1024*1024,signal:this.options.signal});}
      catch(error){if(!String(error).includes('bounded workspace projection'))throw error;if(collection==='nativeDefinitionHistory'){await validateNativeReviewGraph(this.codec,row.token,{version:sourceVersion,yieldControl:this.options.yieldControl,signal:this.options.signal});continue;}if(collection==='papers'){const trimmed=await this.patch(row.token,['pdfText'],undefined);value=await this.codec.read(trimmed,{maxBytes:2*1024*1024});}else if(['analyses','neighbors','metadata'].includes(collection))continue;else if(await validateArchiveGraph(this.codec,collection,row.token,sourceVersion,this.options))continue;else throw new LegacyValidationError(`Legacy ${collection} requires a bounded record validator.`);}
      const sample=initialState() as unknown as Record<string,unknown>;sample.schemaVersion=sourceVersion;sample.settings=settings;
      if(mapCollections.has(collection))sample[collection]={[row.id]:value};else sample[collection]=[value];
      if(sourceVersion===13?!validState(sample):!validLegacyState(sample))return {valid:false,reason:`Legacy ${collection} record is invalid.`};
    }}
    this.options.validationProgress?.('state');
    for await(const row of this.records('state')){
      if(mapCollections.has(row.id)||arrayCollections.has(row.id)||row.id==='schemaVersion')continue;
      let value:unknown;try{value=await this.codec.read(row.token,{maxBytes:2*1024*1024,signal:this.options.signal});}catch(error){
        if(!String(error).includes('bounded workspace projection'))throw error;
        if(row.id==='nativeDefinitionPreparation'){await validateNativeReviewGraph(this.codec,row.token,{version:sourceVersion,yieldControl:this.options.yieldControl,signal:this.options.signal});continue;}
        if(row.id==='evidenceCatalog'){if(!await this.shape(await this.codec.lookup(row.token,['sources']),'object')||!await this.shape(await this.codec.lookup(row.token,['entries']),'object'))return {valid:false,reason:'Legacy evidence catalog is invalid.'};continue;}
        if(row.id==='taxonomyEvidence'){await validateRegistryGraph(this.codec,row.token,this.options);continue;}
        if(row.id==='taxonomyEvidenceScopes'){if(!await this.shape(row.token,'array'))throw new LegacyValidationError('Legacy evidence scopes must be a list.');for await(const scope of this.entries(row.token)){const support=await this.codec.lookup(scope.token,['support']),snapshot=await this.codec.lookup(scope.token,['evidenceSnapshot']);if(!await this.shape(support,'object')||!snapshot)throw new LegacyValidationError('Legacy evidence scopes are invalid.');await validateRegistryGraph(this.codec,snapshot,this.options);}continue;}
        if(row.id==='run'){await validateRunGraph(this.codec,row.token,sourceVersion,this.options);continue;}
        if(!['run','taxonomyProposal','taxonomyEvidence','tagPreparation','activeTagPreparation','pendingChange','reconciliation','reconciliationPreview','diyComparison','diyMergePreview'].includes(row.id))continue;
        throw new LegacyValidationError(`Legacy ${row.id} requires a bounded record validator.`);
      }
      const sample=initialState() as unknown as Record<string,unknown>;sample.schemaVersion=sourceVersion;sample.settings=settings;sample[row.id]=value;
      if(row.id==='keepTagPlan')sample.reconciliation=await this.get('state','reconciliation');
      if(sourceVersion===13?!validState(sample):!validLegacyState(sample))return {valid:false,reason:`Legacy ${row.id} is invalid.`};
    }
    return {valid:true};
  }
  private async all<T>(collection:string,maxBytes=2*1024*1024):Promise<T[]>{const rows:StoredRecord[]=[];for await(const row of this.records(collection))rows.push(row);rows.sort((a,b)=>order(a.metadata)-order(b.metadata));const values:T[]=[];let size=0;for(const row of rows){const value=await this.codec.read(row.token,{maxBytes});size+=encoder.encode(JSON.stringify(value)).length;if(size>16*1024*1024)throw new Error('Legacy normalization requires bounded indexed records.');values.push(value as T);}return values;}
  private async replaceArray(collection:string,values:readonly unknown[]){for await(const row of this.records(collection))await this.store.delete(row.collection,row.id);for(let index=0;index<values.length;index++){const value=values[index],id=object(value)&&typeof value.id==='string'?value.id:`index:${String(index).padStart(12,'0')}`;await this.putReference(collection,id,await this.codec.encode(value),{category:['history','taxonomyArchives','preparationHistory','nativeDefinitionHistory','analysisResetHistory','factHistory','diyComparisonHistory','tagSelectionHistory','legacyConsolidationHistory'].includes(collection)?'history':'active',updatedAt:this.now(),...(object(value)&&typeof value.status==='string'?{status:value.status}:{}),...(object(value)&&typeof value.name==='string'?{title:value.name,searchText:value.name}:{}),...({order:index} as RecordMetadata)});}}
  private async collectReferences(token:PayloadToken|undefined,known:Set<string>,found:Set<string>,seen:Set<string>):Promise<void>{
    if(!token)return;
    if('value' in token){if(typeof token.value==='string'&&known.has(token.value))found.add(token.value);return;}
    if('ref' in token){if(seen.has(token.ref))return;seen.add(token.ref);}
    let children=false;
    for await(const entry of this.entries(token)){children=true;const key=String(entry.key);if(known.has(key))found.add(key);if(key.includes('|')&&known.has(key.slice(key.lastIndexOf('|')+1)))found.add(key.slice(key.lastIndexOf('|')+1));await this.collectReferences(entry.token,known,found,seen);}
    if(!children)try{const value=await this.codec.read(token,{maxBytes:1024});if(typeof value==='string'&&known.has(value))found.add(value);}catch(error){if(!String(error).includes('bounded workspace projection'))throw error;}
  }
  async normalizeLegacy(context:MigrationContext):Promise<void>{
    if(context.sourceVersion<3)await normalizeEarlyLegacy({store:this.store,collection:name=>this.collection(name),putReference:(...args)=>this.putReference(...args),change:(...args)=>this.change(...args),changeToken:async(collection,id,path,token)=>{await this.flushReferences();const row=await this.store.reference(this.collection(collection),id);if(row)await this.putReference(collection,id,await this.patch(row.token,path,token),row.metadata);},records:name=>this.records(name),entries:token=>this.entries(token),all:<T>(name:string,maxBytes?:number)=>this.all<T>(name,maxBytes)},context);
    {
      if(context.sourceVersion<12){
        for(const path of [['run','processingPolicy'],['tagPreparation','processingPolicy'],['activeTagPreparation','processingPolicy'],['nativeDefinitionPreparation','processingPolicy']] as const)await this.change('state',path[0],[path[1]],null,true);
        for(const collection of ['assignmentRuns','nativeDefinitionHistory'])for await(const row of this.records(collection))await this.change(collection,row.id,['processingPolicy'],null,true);
        for await(const row of this.records('maintenanceTasks'))await this.change('maintenanceTasks',row.id,['run','processingPolicy'],null,true);
        for await(const row of this.records('preparationHistory'))await this.change('preparationHistory',row.id,['preparation','processingPolicy'],null,true);
      }
      if(context.sourceVersion<4){
        await this.replaceArray('warnings',migrateWarningEpisodes(await this.all('warnings')));
        const proposal=await this.get('state','taxonomyProposal') as AppState['taxonomyProposal'];
        const tags=await this.all<TagDefinition>('tags');
        const edited=inferEditedProposalTagIds({tags,taxonomyProposal:proposal,userEditedTagIds:await this.all<string>('userEditedTagIds')});
        await this.replaceArray('userEditedTagIds',edited);if(proposal){pruneProposalSupport(proposal);await this.putReference('state','taxonomyProposal',await this.codec.encode(proposal),{category:'active'});}
        // Without an immutable original baseline the established migration keeps drafts.
        if(this.options.legacyBaseline?.length){
          const found=new Set<string>(),known=new Set(tags.map(tag=>tag.id)),seen=new Set<string>();
          for(const key of ['decisions','ownership','history','pendingChange','suggestions','taxonomyArchives','taxonomyRedirects','taxonomySupport'])await this.collectReferences(context.fields.get(key),known,found,seen);
          for(const key of ['tags','merges','mappingConfirmations'])if(proposal){const token=await this.codec.lookup(context.fields.get('taxonomyProposal')!,[key]);await this.collectReferences(token,known,found,seen);}
          for await(const row of this.records('preparationHistory'))for(const key of ['tags','merges','mappingConfirmations'])await this.collectReferences(await this.codec.lookup(row.token,['proposal',key]),known,found,seen);
          const run=context.fields.get('run');if(run){await this.collectReferences(await this.codec.lookup(run,['detailId']),known,found,seen);await this.collectReferences(await this.codec.lookup(run,['jobs']),known,found,seen);}
          const references=Object.fromEntries([...found].map(id=>[id,null]));
          const result=cleanupLegacyDraftDefinitions({tags,decisions:{},ownership:{},history:[{id:'migration-references',date:'',label:'Retained references',patches:[],beforeOwnership:{},afterOwnership:{},beforeDefinitions:references,afterDefinitions:references,suggestionIds:[],status:'applied'}],suggestions:[],taxonomyProposal:proposal,taxonomyArchives:[],taxonomyRedirects:{},taxonomySupport:{},run:null,userEditedTagIds:edited,preparationHistory:[]},this.options.legacyBaseline);
          await this.replaceArray('tags',result.tags);
        }
      }
      if(context.sourceVersion<5)await this.replaceArray('cleanup',[]);
      if(context.sourceVersion<9)for await(const row of this.records('maintenanceTasks')){
        if(await this.scalar(row.token,['kind'])!=='retry'&&await this.scalar(row.token,['status'])!=='completed'){
          await this.change('maintenanceTasks',row.id,['retired'],true);await this.change('maintenanceTasks',row.id,['status'],'completed');await this.change('maintenanceTasks',row.id,['run','status'],'idle');await this.change('maintenanceTasks',row.id,['run','message'],'Existing-tag cleanup is no longer needed. Native Zotero tags were left unchanged.');
        }
      }
      const definitions=await this.all<TagDefinition>('tags'),shelves=await this.all<NonNullable<AppState['tagShelves']>[number]>('tagShelves');
      await this.replaceArray('tagShelves',migrateTagShelves(definitions,shelves.length?shelves:undefined));
    }
    await this.flushReferences();await this.indexUnknownDispatches(context);await this.flushReferences();await this.splitCatalog();await this.flushReferences();await this.splitNativeWork();await this.flushReferences();await this.splitRunJobs();await this.flushReferences();await this.indexHistory();await this.flushReferences();await this.indexRelationships();await this.flushReferences();
    for(const collection of [...mapCollections,...arrayCollections])await this.store.delete(this.collection('state'),collection);
    await this.putReference('state','schemaVersion',{value:13},{category:'active'});
  }
  private async splitCatalog(){
    const source=await this.store.reference(this.collection('state'),'evidenceCatalog');if(!source)return;
    for(const [field,collection] of [['sources','evidenceSources'],['entries','evidenceEntries'],['registryAliases','evidenceAliases']] as const){
      const token=await this.codec.lookup(source.token,[field]);for await(const entry of this.entries(token))await this.putReference(collection,String(entry.key),entry.token,{category:'cache',lastUsedAt:this.now()});
    }
    let header=source.token;for(const key of ['sources','entries','registryAliases'])header=await this.patch(header,[key],undefined);
    await this.putReference('state','evidenceCatalog',header,{category:'active'});
  }
  private async indexUnknownDispatches(context:MigrationContext){
    const native=await this.store.reference(this.collection('state'),'nativeDefinitionPreparation'),nativeOwner=native?await this.scalar(native.token,['taskId']):undefined;
    const owner=async(run:PayloadToken,original:PayloadToken|undefined,task?:StoredRecord)=>{
      const id=await this.scalar(run,['id']);if(typeof id!=='string')return;const requests=new Set<string>(),source=original??run,response=task?await this.codec.lookup(task.token,['response']):undefined,paid=response&&await this.scalar(response,['cursor'])===await this.scalar(task!.token,['cursor'])&&await this.scalar(response,['applied'])===false&&await this.codec.lookup(response,['raw']);
      if(!paid&&(!task||task.id!==nativeOwner))for await(const job of this.entries(await this.codec.lookup(source,['jobs'])))if(await this.scalar(job.token,['status'])==='running')requests.add(String(await this.scalar(job.token,['id'])));
      const replies=new Set<string>();for await(const reply of this.entries(await this.codec.lookup(run,['selectionReplies'])))if(await this.codec.lookup(reply.token,['raw']))replies.add(String(await this.scalar(reply.token,['taskId'])));
      for await(const request of this.entries(await this.codec.lookup(run,['selection','tasks']))){const requestId=String(await this.scalar(request.token,['id']));let transport=false;for await(const attempt of this.entries(await this.codec.lookup(request.token,['attempts'])))transport=await this.scalar(attempt.token,['transport'])===true;if(!replies.has(requestId)&&(await this.scalar(request.token,['status'])==='running'||transport&&Number(await this.scalar(request.token,['dispatches']))>0))requests.add(requestId);}
      const preparation=await this.codec.lookup(run,['preparation']);if(preparation&&await this.scalar(preparation,['pending'])===true){const attempt=await this.scalar(preparation,['attempts']);let saved=false;for await(const reply of this.entries(await this.codec.lookup(preparation,['responses'])))if(await this.scalar(reply.token,['attempt'])===attempt&&await this.codec.lookup(reply.token,['raw']))saved=true;if(!saved)requests.add('preparation:'+String(await this.scalar(preparation,['generationId']))+':'+String(attempt));}
      if(task&&task.id===nativeOwner&&native){if(!paid)for await(const request of this.entries(await this.codec.lookup(native.token,['work','tasks']))){let transport=false;for await(const attempt of this.entries(await this.codec.lookup(request.token,['attempts'])))transport=await this.scalar(attempt.token,['transport'])===true;if(await this.scalar(request.token,['status'])==='running'||transport&&Number(await this.scalar(request.token,['dispatches']))>0)requests.add(String(await this.scalar(request.token,['id'])));}}
      if(!requests.size)return;const provider=await this.scalar(run,['settings','provider']),model=await this.scalar(run,['settings','model']);
      await this.putReference('providerDispatches','legacy-dispatch-'+fingerprint([id,task?.id??null,context.sourceFingerprint]),await this.codec.encode({status:'unknown',legacy:true,taskId:id,ownerRunId:id,...(task?{ownerTaskId:task.id}:{}),...(typeof provider==='string'?{provider}:{}),...(typeof model==='string'?{model}:{}),importedAt:this.now(),requestCount:requests.size,requestIds:[...requests].slice(0,20),error:'A previous request was interrupted before its outcome was recorded. Choose Retry to allow another request, or Stop to keep the saved results.'}),{category:'ledger',status:'unknown',taskId:id,pinned:true,refs:[task?{collection:'maintenanceTasks',id:task.id}:{collection:'state',id:'run'}]});
    };
    const run=await this.store.reference(this.collection('state'),'run');if(run&&await this.codec.kind(run.token)==='object')await owner(run.token,context.fields.get('run'));
    for await(const task of this.records('maintenanceTasks'))if(await this.scalar(task.token,['status'])!=='completed'){const run=await this.codec.lookup(task.token,['run']);if(run)await owner(run,undefined,task);}
  }
  private async saveJudgments(workId:string,entries:PayloadToken|undefined,pinned:boolean){
    for await(const entry of this.entries(entries)){
      const entryId=await this.scalar(entry.token,['id']);if(typeof entryId!=='string')throw new LegacyValidationError('A native meaning entry has no identity.');
      const judgments=await this.codec.lookup(entry.token,['judgments']);
      for await(const judgment of this.entries(judgments)){
        const definition=await this.scalar(judgment.token,['definitionFingerprint']),source=await this.scalar(judgment.token,['sourceFingerprint']),relation=await this.scalar(judgment.token,['relation']);
        const builder=this.codec.objectBuilder();await builder.append('workId',{value:workId});await builder.append('entryId',{value:entryId});await builder.append('paperId',{value:String(judgment.key)});await builder.append('judgment',judgment.token);
        await this.putReference('nativeJudgments',JSON.stringify([workId,entryId,judgment.key,definition,source]),await builder.finish(),{category:'cache',taskId:entryId,status:String(relation),lastUsedAt:this.now(),pinned});
      }
    }
  }
  private async splitReview(collection:string,id:string,row:StoredRecord){
    const work=await this.codec.lookup(row.token,['work']);if(!work)return;const workId=await this.scalar(work,['id']);if(typeof workId!=='string')throw new LegacyValidationError('A native meaning work has no identity.');
    const applied=new Set<string>();for await(const item of this.entries(await this.codec.lookup(row.token,['appliedEntryIds']))){const value=await this.codec.read(item.token,{maxBytes:1024});if(typeof value==='string')applied.add(value);}
    const finishedAt=await this.scalar(row.token,['finishedAt']);let unfinished=finishedAt===undefined;
    for await(const entry of this.entries(await this.codec.lookup(work,['entries']))){const status=await this.scalar(entry.token,['status']);if(status==='pending'||status==='question'&&!await this.codec.lookup(entry.token,['meaningAdmission'])&&!applied.has(String(await this.scalar(entry.token,['id']))))unfinished=true;}
    const completedAt=typeof finishedAt==='string'&&Number.isFinite(Date.parse(finishedAt))?Date.parse(finishedAt):this.now();
    const scopeId=workId+':'+await this.scalar(work,['fingerprint']),snapshot=await this.codec.lookup(work,['snapshot']),scopeRefs:NonNullable<RecordMetadata['refs']>=[];
    if(!snapshot)throw new LegacyValidationError('A native meaning review has no immutable source scope.');
    for await(const paper of this.entries(await this.codec.lookup(snapshot,['papers']))){const paperId=await this.scalar(paper.token,['id']);if(typeof paperId==='string')for(const name of ['papers','facts','analyses'])scopeRefs.push({collection:name,id:paperId});}
    await this.putReference('nativeMeaningScopes',scopeId,snapshot,{category:'cache',taskId:workId,pinned:unfinished,lastUsedAt:this.now(),refs:scopeRefs});
    const revisions=await this.codec.lookup(work,['history']);let index=0;
    for await(const revision of this.entries(revisions)){
      await this.putReference('nativeMeaningRevisions',`${collection}:${id}:${index}`,revision.token,{category:'history',taskId:workId,completedAt,pinned:unfinished,...({order:index++} as RecordMetadata)});
      await this.saveJudgments(workId,await this.codec.lookup(revision.token,['entries']),unfinished);
    }
    const entries=await this.codec.lookup(work,['entries']),tasks=await this.codec.lookup(work,['tasks']);await this.saveJudgments(workId,entries,unfinished);
    for await(const item of this.entries(entries)){
      const entryId=await this.scalar(item.token,['id']),marker=await this.codec.lookup(item.token,['meaningAdmission']);if(typeof entryId!=='string'||!marker&&!applied.has(entryId))continue;
      const definitionToken=await this.codec.lookup(item.token,['definition']);if(!definitionToken)continue;const definition=await this.codec.read(definitionToken,{maxBytes:128*1024}) as TagDefinition;
      const tagId=marker?await this.scalar(marker,['tagId']):await this.scalar(item.token,['targetTagId'])??definition.id;if(typeof tagId!=='string')continue;
      let definitionFingerprint=marker?await this.scalar(marker,['definitionFingerprint']):fingerprint(definition);
      if(!marker){const current=await this.get('tags',tagId,128*1024) as TagDefinition|undefined;if(current&&conceptMeaningFingerprint(current)===conceptMeaningFingerprint(definition)&&canonicalTagKey(current.fullName??current.name)===canonicalTagKey(definition.fullName??definition.name))definitionFingerprint=fingerprint(current);}
      const changeId=marker?await this.scalar(marker,['changeId']):'legacy:'+scopeId,proof=this.codec.objectBuilder();await proof.append('workId',{value:workId});await proof.append('scopeId',{value:scopeId});await proof.append('entry',item.token);
      const refs:NonNullable<RecordMetadata['refs']>=[{collection:'nativeMeaningScopes',id:scopeId}];for await(const paper of this.entries(await this.codec.lookup(item.token,['paperIds']))){const paperId=await this.codec.read(paper.token,{maxBytes:1024});if(typeof paperId==='string')for(const name of ['papers','facts','analyses'])refs.push({collection:name,id:paperId});}
      await this.putReference('nativeMeaningAdmissions',JSON.stringify([workId,entryId,changeId]),await proof.finish(),{category:'history',taskId:tagId,status:String(definitionFingerprint),completedAt,refs});
    }
    if(collection==='state'){
      for(const [name,token] of [['nativeMeaningEntries',entries],['nativeMeaningTasks',tasks]] as const)for await(const item of this.entries(token)){const identity=await this.scalar(item.token,['id']);if(typeof identity!=='string')throw new LegacyValidationError('A native meaning record has no identity.');const refs:NonNullable<RecordMetadata['refs']>=[{collection:'nativeMeaningScopes',id:scopeId}];for await(const paper of this.entries(await this.codec.lookup(item.token,[name==='nativeMeaningEntries'?'paperIds':'pairs']))){const paperId=name==='nativeMeaningEntries'?await this.codec.read(paper.token,{maxBytes:1024}):await this.scalar(paper.token,['paperId']);if(typeof paperId==='string')for(const collection of ['papers','facts','analyses'])refs.push({collection,id:paperId});}await this.putReference(name,identity,item.token,{category:unfinished?'active':'history',completedAt,taskId:workId,status:String(await this.scalar(item.token,['status'])),pinned:unfinished,refs,...({order:Number(item.key)} as RecordMetadata)});}
    }
    let normalized=await this.patch(row.token,['work','history'],undefined);if(collection==='state')for(const key of ['entries','tasks'])normalized=await this.patch(normalized,['work',key],undefined);await this.putReference(collection,id,normalized,{...row.metadata,category:unfinished?'active':'history',completedAt,taskId:workId,pinned:unfinished});
  }
  private async splitNativeWork(){for await(const row of this.records('nativeDefinitionHistory'))await this.splitReview('nativeDefinitionHistory',row.id,row);const current=await this.store.reference(this.collection('state'),'nativeDefinitionPreparation');if(current)await this.splitReview('state','nativeDefinitionPreparation',current);}
  private async splitRunJobs(){
    for(const collection of ['state','maintenanceTasks'])for await(const row of this.records(collection)){
      if(collection==='state'&&row.id!=='run')continue;
      const run=collection==='state'?row.token:await this.codec.lookup(row.token,['run']);if(!run||await this.codec.kind(run)!=='object')continue;
      const runId=await this.scalar(run,['id']);if(typeof runId!=='string')throw new LegacyValidationError('An interrupted run has no identity.');
      const status=await this.scalar(run,['status']),completed=status==='idle'||collection==='maintenanceTasks'&&await this.scalar(row.token,['status'])==='completed';
      for await(const item of this.entries(await this.codec.lookup(run,['jobs']))){const id=await this.scalar(item.token,['id']),paperId=await this.scalar(item.token,['paperId']);if(typeof id!=='string'||typeof paperId!=='string')throw new LegacyValidationError('An interrupted paper job has no identity.');await this.putReference('runJobs',id,item.token,{category:completed?'history':'active',completedAt:this.now(),taskId:runId,title:paperId,status:String(await this.scalar(item.token,['status'])),order:Number(item.key),pinned:!completed,refs:[{collection:'papers',id:paperId},{collection:'facts',id:paperId},{collection:'analyses',id:paperId}]});}
      const normalized=await this.patch(row.token,collection==='state'?['jobs']:['run','jobs'],undefined);await this.putReference(collection,row.id,normalized,{...row.metadata,category:completed?'history':'active',completedAt:this.now(),pinned:!completed});
    }
  }
  private async indexHistory(){for await(const row of this.records('history')){
    let count=0;for(const key of ['patches','metadataPatches','afterDefinitions']){const value=await this.codec.lookup(row.token,[key]);if(value)count+=(await this.codec.entries(value,{limit:1})).total;}if(await this.codec.lookup(row.token,['afterShelves']))count++;
    const label=await this.codec.lookup(row.token,['label']);let title='';if(label&&await this.codec.kind(label)==='string')for await(const part of this.codec.stringChunks(label)){title+=part.slice(0,1000-title.length);if(title.length>=1000)break;}
    const status=await this.scalar(row.token,['status']);await this.putReference('history',row.id,row.token,{...row.metadata,category:'history',title,searchText:title,count,pinned:status==='prepared'||status==='conflict'});
  }}
  private async indexRelationships(){
    const tags=await this.all<TagDefinition>('tags'),names=new Map<string,TagDefinition[]>(),shelves=await this.all<NonNullable<AppState['tagShelves']>[number]>('tagShelves');
    for(const tag of tags)if(tag.status==='approved')for(const name of equivalentTagNames(tag)){const key=canonicalTagKey(name),matches=names.get(key)??[];matches.push(tag);names.set(key,matches);}
    for(const tag of tags){const row=await this.store.reference(this.collection('tags'),tag.id);if(!row)continue;const refs=[...(tag.status==='approved'&&!tag.custom?tag.broaderIds.map(id=>({collection:'tags',id,relation:'broader'})):[])];const support=await this.store.reference(this.collection('taxonomySupport'),tag.id);if(support){refs.push({collection:'taxonomySupport',id:tag.id,relation:'source'});for(const [field,collection] of [['sourceIds','evidenceSources'],['registryIds','evidenceEntries']] as const)for await(const entry of this.entries(await this.codec.lookup(support.token,[field]))){const id=await this.codec.read(entry.token,{maxBytes:1024});if(typeof id==='string')refs.push({collection,id,relation:'source'});}}let after:string|undefined;for(;;){const page=await this.store.scan(this.collection('nativeMeaningAdmissions'),{taskId:tag.id,status:fingerprint(tag),after,limit:50});for(const admission of page.rows)refs.push({collection:'nativeMeaningAdmissions',id:admission.id,relation:'source'});if(!page.next)break;after=page.next;}await this.putReference('tags',tag.id,row.token,{...row.metadata,category:'active',title:tag.name,searchText:[tag.name,tag.fullName,...tag.aliases,tag.description].filter(Boolean).join('\n'),refs});}
    const nativeNames=new Map<string,{name:string;tagIds:string[];paperCount:number;manualCount:number}>();
    for await(const row of this.records('papers')){
      const native=await this.get('nativeTags',row.id) as {tag:string;type:number}[]|undefined,refs:{collection:string;id:string;relation:string}[]=[];
      const inventoryGroups=new Map<string,{name:string;tagIds:Set<string>;manual:boolean}>();
      for(const label of native??[]){
        const key=canonicalTagKey(label.tag),matching=names.get(key)??[],tagIds:string[]=[];
        for(const tag of matching){const mask=await this.store.get(this.collection('nativeBindingExclusions'),tag.id,{path:[row.id],maxBytes:128*1024}) as string[]|undefined;if(nativeBindingAllows(tag.id,row.id,label.tag,{[tag.id]:{[row.id]:mask??[]}})){refs.push({collection:'tags',id:tag.id,relation:'matches'});tagIds.push(tag.id);}}
        const group=inventoryGroups.get(key)??{name:label.tag,tagIds:new Set<string>(),manual:false};for(const id of tagIds)group.tagIds.add(id);group.manual||=label.type===0;inventoryGroups.set(key,group);
      }
      for(const [key,group] of inventoryGroups){const inventory=nativeNames.get(key)??{name:group.name,tagIds:[],paperCount:0,manualCount:0};inventory.tagIds=[...new Set([...inventory.tagIds,...group.tagIds])];inventory.paperCount++;if(group.manual)inventory.manualCount++;nativeNames.set(key,inventory);await this.putReference('nativeNamePapers',JSON.stringify([key,row.id]),{value:row.id},{category:'active',taskId:key,status:group.manual?'manual':'automatic',refs:[{collection:'papers',id:row.id}]});}
      const projection=await this.patch(row.token,['pdfText'],undefined),paper=await this.codec.read(projection,{maxBytes:2*1024*1024}) as {itemID:number;title:string;abstract:string;keywords:string[]};
      await this.putReference('papers',row.id,row.token,{...row.metadata,category:'active',nativeItemId:paper.itemID,title:paper.title,searchText:[paper.title,paper.abstract,...paper.keywords].join('\n'),refs});
    }
    for(const [key,value] of nativeNames){await this.putReference('nativeNames',key,await this.codec.encode(value),{category:'active',title:value.name,searchText:value.name,status:value.tagIds.length?'ready':'undefined',count:value.paperCount});if(!names.has(key)&&key!==canonicalTagKey('no_tag'))await this.putReference('libraryTags','native:'+key,await this.codec.encode({name:value.name,paperCount:value.paperCount,protected:isPersonalNativeTagName(value.name)&&await this.get('nativeTagTreatments',key)!=='scientific'}),{category:'active',title:value.name,searchText:value.name,status:'undefined',count:value.paperCount,refs:shelves.filter(shelf=>shelf.id==='tag-shelf-my-tags'||shelf.nativeTagNames?.some(name=>canonicalTagKey(name)===key)).map(shelf=>({collection:'tagShelves',id:shelf.id,relation:'member'}))});}
    for(const [key,definitions] of names)await this.putReference('definitionNames',key,await this.codec.encode({tagIds:[...new Set(definitions.map(tag=>tag.id))]}),{category:'active',title:key});
    await this.flushReferences();
    for(const tag of tags){if(isNoTagDefinition(tag))continue;const paperCount=(await this.store.scan(this.collection('papers'),{limit:1,references:[[{collection:this.collection('tags'),id:tag.id,relation:'matches'}]]})).total;await this.putReference('libraryTags',tag.id,await this.codec.encode({name:tag.name,tagId:tag.id,paperCount}),{category:'active',title:tag.name,searchText:[tag.name,tag.fullName,...tag.aliases,tag.description].filter(Boolean).join('\n'),status:tag.status==='approved'?'ready':'undefined',count:paperCount,refs:shelves.filter(shelf=>shelf.tagIds.includes(tag.id)).map(shelf=>({collection:'tagShelves',id:shelf.id,relation:'member'}))});}
    for await(const row of this.records('facts')){
      const refs:{collection:string;id:string;relation:string}[]=[];for await(const concept of this.entries(await this.codec.lookup(row.token,['concepts']))){const id=await this.scalar(concept.token,['factConceptId']);if(typeof id==='string')refs.push({collection:'evidenceSources',id,relation:'source'});}await this.putReference('facts',row.id,row.token,{...row.metadata,category:'cache',lastUsedAt:row.metadata.lastUsedAt??this.now(),refs});
    }
    for(const name of ['taxonomyEvidence','taxonomyEvidenceScopes']){
      const row=await this.store.reference(this.collection('state'),name);if(!row)continue;const refs:{collection:string;id:string;relation:string}[]=[];
      const snapshots:PayloadToken[]=[];if(name==='taxonomyEvidence')snapshots.push(row.token);else for await(const scope of this.entries(row.token)){const snapshot=await this.codec.lookup(scope.token,['evidenceSnapshot']);if(snapshot)snapshots.push(snapshot);}
      for(const snapshot of snapshots)for(const [field,collection] of [['sources','evidenceSources'],['entries','evidenceEntries']] as const)for await(const entry of this.entries(await this.codec.lookup(snapshot,[field])))refs.push({collection,id:String(entry.key),relation:'source'});
      await this.putReference('state',name,row.token,{...row.metadata,category:'active',refs});
    }
    for(const collection of ['state','maintenanceTasks','reviewItems'])for await(const row of this.records(collection)){
      if(collection==='state'&&!['run','nativeDefinitionPreparation','tagPreparation','activeTagPreparation','taxonomyProposal','pendingChange','reconciliation','diyComparison'].includes(row.id))continue;
      if(collection==='reviewItems'&&await this.scalar(row.token,['state'])==='resolved')continue;
      if(collection==='maintenanceTasks'&&await this.scalar(row.token,['status'])==='completed')continue;
      if(collection==='state'&&row.id==='run'&&await this.scalar(row.token,['status'])==='idle')continue;
      const refs:NonNullable<RecordMetadata['refs']>=[],ids=new Set<string>();
      for(const path of [['paperIds'],['paperId'],['work','snapshot','papers']] as const){const token=await this.codec.lookup(row.token,path);if(path[0]==='paperId'){const id=await this.scalar(row.token,path);if(typeof id==='string')ids.add(id);}else for await(const item of this.entries(token)){const id=path[0]==='work'?await this.scalar(item.token,['id']):await this.codec.read(item.token,{maxBytes:1024});if(typeof id==='string')ids.add(id);}}
      for(const path of [['jobs'],['run','jobs']] as const)for await(const job of this.entries(await this.codec.lookup(row.token,path))){const id=await this.scalar(job.token,['paperId']);if(typeof id==='string')ids.add(id);}
      for(const id of ids)for(const target of ['papers','facts','analyses'])if(await this.store.reference(this.collection(target),id))refs.push({collection:target,id,relation:'source'});
      const workId=await this.scalar(row.token,['workId']);if(typeof workId==='string'){const current=await this.store.reference(this.collection('state'),'nativeDefinitionPreparation');if(current&&await this.scalar(current.token,['work','id'])===workId)refs.push({collection:'state',id:'nativeDefinitionPreparation',relation:'source'});}
      let offset:number|undefined;for(;;){const existing=await this.store.links(row.collection,row.id,{limit:50,offset});for(const ref of existing.rows)refs.push({...ref,collection:ref.collection.startsWith(this.prefix)?ref.collection.slice(this.prefix.length):ref.collection});if(existing.next===undefined)break;offset=existing.next;}
      await this.putReference(collection,row.id,row.token,{...row.metadata,refs});
    }
  }
  async validateCurrent(context:MigrationContext){
    const settings=await this.get('state','settings');if(!object(settings))throw new LegacyValidationError('Normalized settings are missing.');
    for await(const row of this.records('tags')){const tag=await this.codec.read(row.token,{maxBytes:128*1024}) as TagDefinition;if(!tag.id||!Array.isArray(tag.broaderIds)||!['draft','approved'].includes(tag.status))throw new LegacyValidationError('A normalized tag is invalid.');}
    if(context.sourceVersion<1||context.sourceVersion>13)throw new LegacyValidationError('Unsupported legacy schema.');
  }
  async prepare(context:MigrationContext,locator:WorkspaceLocator){
    const previous=await this.store.get('workspace','migration',{maxBytes:16*1024}) as {collections?:string[]}|undefined;
    for(const collection of previous?.collections??[])if(!collection.startsWith('stage:'))await this.clearCollection(collection);
    await this.store.put('workspace','migration',{status:'preparing',generation:context.generation,collections:[...this.collections]},{category:'ledger',pinned:true});
    let pending:StoreOperation[]=[];for(const collection of this.collections)for await(const row of this.records(collection)){const refs:NonNullable<RecordMetadata['refs']>=[];let offset:number|undefined;for(;;){const page=await this.store.links(row.collection,row.id,{offset,limit:50});for(const link of page.rows)refs.push({...link,collection:link.collection.startsWith(this.prefix)?link.collection.slice(this.prefix.length):link.collection});if(page.next===undefined)break;offset=page.next;}pending.push({kind:'reference',collection,id:row.id,token:row.token,metadata:{...row.metadata,refs},copyIndexFrom:{collection:row.collection,id:row.id}});if(pending.length===20){await this.store.commit({commandId:crypto.randomUUID(),operations:pending});pending=[];}}if(pending.length)await this.store.commit({commandId:crypto.randomUUID(),operations:pending});
    await this.store.put('workspace','migration',{status:'prepared',generation:context.generation,locator,collections:[...this.collections],sourceVersion:context.sourceVersion,sourcePath:context.sourcePath,sourceBytes:context.sourceBytes,startedAt:context.startedAt,sourceFingerprint:context.sourceFingerprint,backup:context.backup},{category:'ledger',pinned:true});
  }
  async activate(context:MigrationContext,locator:WorkspaceLocator){
    await this.store.put('workspace','active',{schemaVersion:14,generation:context.generation,locator,sourceVersion:context.sourceVersion,activatedAt:this.now()},{category:'ledger',pinned:true});
    if(context.backup)await this.store.put('migrationBackups',context.generation,{...context.backup,statePath:context.sourcePath.replace(/\.bak$/,''),generation:context.generation},{category:'ledger',pinned:true});
    await this.store.put('state','backupBytes',await registeredBackupBytes(this.store),{category:'active'});
    for(const collection of this.collections)await this.clearCollection(this.collection(collection));
    await this.store.delete('workspace','importing');
    await this.store.put('workspace','migration',{status:'active',generation:context.generation},{category:'ledger',pinned:true});this.release?.();this.release=undefined;
  }
  async resumePrepared(locator:WorkspaceLocator):Promise<boolean>{
    const active=await this.store.get('workspace','active',{maxBytes:16*1024}) as {generation?:string}|undefined;
    const staged=await this.store.get('workspace','migration',{maxBytes:16*1024}) as {status?:string;generation?:string;collections?:string[];sourceVersion?:number;sourcePath?:string;sourceBytes?:number;startedAt?:number;sourceFingerprint?:string;backup?:MigrationContext['backup']}|undefined;
    if(active?.generation===locator.storage.generation&&staged?.status!=='prepared')return false;
    if(staged?.status!=='prepared'||staged.generation!==locator.storage.generation)throw new Error('The workspace locator has no matching prepared generation. Preserve the database and use recovery.');
    this.generation=staged.generation;this.prefix='stage:'+staged.generation.slice(-40)+':';this.collections=new Set(staged.collections??[]);this.release=this.store.lease();
    await this.activate({generation:staged.generation,sourceVersion:staged.sourceVersion??13,sourcePath:staged.sourcePath??'',sourceBytes:staged.sourceBytes??0,startedAt:staged.startedAt??this.now(),sourceFingerprint:staged.sourceFingerprint??'',backup:staged.backup,root:{value:null},fields:new Map()},locator);
    return true;
  }
  async abort(generation:string){if(generation!==this.generation)return;this.pendingReferences=[];this.release?.();this.release=undefined;/* The durable stage manifest permits cleanup on the next open. Cancellation and disable never drain an archive deletion queue. */}
}

export async function markVerifiedWorkspaceRestart(store:WorkspaceStore,generation:string,startupId:string,options:{initial?:boolean;requireBaseline?:boolean}={}):Promise<void>{
  if(!startupId||startupId.length>200)return;
  const backup=await store.get('migrationBackups',generation,{maxBytes:16*1024}) as (NonNullable<MigrationContext['backup']>&{lastStartupId?:string;migrationStartupId?:string})|undefined;
  if(!backup)return;
  if(options.initial||options.requireBaseline&&!backup.migrationStartupId){await store.put('migrationBackups',generation,{...backup,migrationStartupId:startupId,lastStartupId:startupId,...(options.requireBaseline&&!backup.migrationStartupId?{verifiedRestarts:0}:{})},{category:'ledger',pinned:true});return;}
  if(backup.lastStartupId===startupId||backup.migrationStartupId===startupId)return;
  await store.put('migrationBackups',generation,{...backup,lastStartupId:startupId,verifiedRestarts:Math.min(2,Number(backup.verifiedRestarts)+1)},{category:'ledger',pinned:true});
}

async function registeredBackupBytes(store:WorkspaceStore,exclude?:string):Promise<number>{
  let bytes=0,after:string|undefined;
  for(;;){const page=await store.scan('migrationBackups',{after,limit:50});for(const row of page.rows){if(row.id===exclude)continue;const value=await store.get('migrationBackups',row.id,{path:['bytes'],maxBytes:128});if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)bytes+=value;}if(!page.next)break;after=page.next;}
  return bytes;
}

export async function cleanupMigrationBackups(store:WorkspaceStore,io:MigrationIO,options:MigrationOptions&{recoveryOutstanding:()=>Promise<boolean>}):Promise<{removed:number;preserved:number}>{
  let removed=0,preserved=0;const now=(options.clock??Date.now)();
  if(await options.recoveryOutstanding())return {removed,preserved};
  const page=await store.scan('migrationBackups',{limit:1});
  for(const row of page.rows){
    const record=await store.codec.read(row.token,{maxBytes:16*1024}) as NonNullable<MigrationContext['backup']>&{statePath:string;generation:string};
    if(!record||record.verifiedRestarts<2||!Number.isFinite(record.expiresAt)||now<record.expiresAt||typeof record.path!=='string'||typeof record.statePath!=='string'||!record.path.startsWith(record.statePath)||!/^\.pre-v14(?:\.[1-9][0-9]*)?\.json$/.test(record.path.slice(record.statePath.length))){preserved++;continue;}
    if(await io.exists(record.path)){
      if(await fingerprintMigrationFile(io,record.path,options)!==record.fingerprint){preserved++;continue;}
      if(await options.recoveryOutstanding()){preserved++;continue;}
      if(options.signal?.aborted)throw options.signal.reason??new Error('Backup cleanup cancelled.');
      await io.remove(record.path);
    }
    await store.commit({commandId:crypto.randomUUID(),operations:[{kind:'delete',collection:'migrationBackups',id:row.id},{kind:'put',collection:'state',id:'backupBytes',value:await registeredBackupBytes(store,row.id),metadata:{category:'active'}}]});removed++;
  }
  return {removed,preserved};
}
