import type {ManagerSnapshot,DisplayTag,DisplayPaper,DisplaySuggestion,DisplayAssignmentReview,DisplayTagPreparation} from '../ui-contract.ts';
import type {ViewEvent,ViewQuery} from '../workspace-contract.ts';
import {WORKSPACE_LIMITS} from '../workspace-contract.ts';
import {canonicalTagKey} from '../core.ts';
import type {TagDefinition} from '../core.ts';
import {WorkspaceStore} from './storage.ts';
import {SimilarityIndex} from './similarity.ts';
import type {DocumentRef,PayloadToken,RecordPage,ScanOptions,StoredRecord} from './storage.ts';

type NativePreparation=NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>;
type NativeRow=NativePreparation['rows'][number];
const defaults:ManagerSnapshot['settings']={provider:'chatgpt',model:'',autoAssign:false,budgetUSD:5,inputPricePerMillion:0,outputPricePerMillion:0,maxOutputTokens:8192,coreConceptLimit:60,extensionTagTarget:30};
const emptyConnection:ManagerSnapshot['connection']={apiKeyStored:false,chatgptSignedIn:false,accountLabel:undefined,accounts:[]};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const strings=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];
const safeNumber=(value:unknown,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const safeString=(value:unknown,fallback='')=>typeof value==='string'?value:fallback;

export interface ViewDependencies {
  connection?():Promise<ManagerSnapshot['connection']>;
  pluginVersion?:string;
  signal?:AbortSignal;
  clock?:()=>number;
}

/** A query owns only its visible rows and explicitly requested detail records. */
export async function buildView(store:WorkspaceStore,query:ViewQuery,deps:ViewDependencies={}):Promise<ViewEvent>{
  const params=query.params??{},offset=Math.max(0,Number.parseInt(query.cursor??'0',10)||0),limit=Math.max(1,Math.min(50,query.limit??50)),now=(deps.clock??Date.now)();
  const check=()=>{if(deps.signal?.aborted)throw deps.signal.reason??new Error('Workspace view cancelled.');};
  const state=async<T>(key:string,fallback:T,path?:readonly(string|number)[]):Promise<T>=>{check();const value=await store.get('state',key,{path,maxBytes:256*1024,signal:deps.signal});return value===undefined?fallback:value as T;};
  const load=async<T>(record:StoredRecord):Promise<T>=>{check();return await store.codec.read(record.token,{maxBytes:256*1024,signal:deps.signal}) as T;};
  const values=async<T>(page:RecordPage):Promise<T[]>=>{const result:T[]=[];for(const record of page.rows)result.push(await load<T>(record));return result;};
  const read=async<T>(collection:string,id:string,fallback:T,path?:readonly(string|number)[]):Promise<T>=>{check();const value=await store.get(collection,id,{path,maxBytes:256*1024,signal:deps.signal});return value===undefined?fallback:value as T;};
  const stats=await store.stats({includeDatabase:query.page==='settings'});
  const settings=await state('settings',{...defaults});
  const connection=deps.connection?await deps.connection():await state('connectionSummary',{...emptyConnection});
  const model:ManagerSnapshot={settings:{...defaults,...settings},connection,pluginVersion:deps.pluginVersion,vocabularyVersion:await state('vocabularyVersion',0),pilotReviewed:await state('pilotReviewed',false),taxonomyReady:await state('taxonomyReady',false),tags:[],papers:[],suggestions:[],cleanup:[],history:[],neighbors:{},warnings:[],models:[],queue:{status:'idle',total:0,completed:0,failed:0,skipped:0,needsInformation:0,spentUSD:0,estimatedUSD:0,jobs:[]}};
  const storedCounts=await state<Record<string,number>|undefined>('libraryCounts',undefined);
  const count=async(collection:string,options:ScanOptions={})=>(await store.scan(collection,{...options,limit:1})).total;
  const totals={papers:storedCounts?.papers??await count('papers'),tags:storedCounts?.tags??await count('tags'),definedTags:storedCounts?.definedTags??await count('tags',{status:'approved'}),assignableTags:storedCounts?.assignableTags??0,openChoices:storedCounts?.openChoices??await count('reviewItems',{status:'open'})+await count('reviewItems',{status:'deferred'}),history:storedCounts?.history??await count('history')};
  model.totals=totals;model.analyzedPaperCount=totals.papers;
  model.libraryIndexProgress=await state<ManagerSnapshot['libraryIndexProgress']>('libraryIndexProgress',undefined);
  let total=0,nextCursor:string|undefined;
  const primary=(page:RecordPage)=>{total=page.total;if(offset+page.rows.length<total)nextCursor=String(offset+page.rows.length);};
  const projectTag=(tag:TagDefinition):DisplayTag=>({...tag,aliases:tag.aliases??[],inclusions:tag.inclusions??[],exclusions:tag.exclusions??[],examples:tag.examples??[],broaderIds:tag.broaderIds??[],relatedIds:tag.relatedIds??[]});
  const preview=async(record:StoredRecord,path:readonly(string|number)[],maximum:number):Promise<string>=>{
    check();const token=await store.codec.lookup(record.token,path);if(!token||await store.codec.kind(token)!=='string')return '';
    let value='';for await(const part of store.codec.stringChunks(token)){check();value+=part.slice(0,maximum-value.length);if(value.length>=maximum)break;}return value;
  };
  const paper=async(record:StoredRecord):Promise<DisplayPaper>=>{
    const abstract=await preview(record,['abstract'],selected(record.id)?12000:160),keywords:string[]=[],tags:string[]=[];
    const keywordToken=await store.codec.lookup(record.token,['keywords']);if(keywordToken)for(const entry of (await store.codec.entries(keywordToken,{limit:20})).entries){const value=await preview({...record,token:entry.token},[],256);if(value)keywords.push(value);}
    const native=await store.reference('nativeTags',record.id);if(native)for(const entry of (await store.codec.entries(native.token,{limit:50})).entries){const value=await preview({...native,token:entry.token},['tag'],256);if(value)tags.push(value);}
    const pdf=await store.codec.lookup(record.token,['pdfText']),hasPDF=pdf&&await store.codec.kind(pdf)==='string'&&await store.codec.logicalSize(pdf)>2;
    return {id:record.id,title:await preview(record,['title'],1000)||record.metadata.title||'Untitled paper',abstract,keywords,summary:await preview(record,['summary'],selected(record.id)?4000:200),tags,evidenceStatus:hasPDF?'Metadata and selected PDF passages':abstract?'Title, abstract, and imported keywords':'Abstract missing; limited metadata'};
  };
  const selected=(id:string)=>params.selectedPaper===id;
  const bounded=async(token:PayloadToken,maximum=24*1024):Promise<unknown>=>{
    let remaining=maximum;
    const copy=async(token:PayloadToken,depth=0):Promise<unknown>=>{
      check();const kind=await store.codec.kind(token);
      if(kind==='string'){let text='';for await(const fragment of store.codec.stringChunks(token)){const take=Math.max(0,Math.min(2000-text.length,Math.floor(remaining/3)));text+=fragment.slice(0,take);remaining-=Math.min(take,fragment.length)*3;if(text.length>=2000||remaining<3)break;}return text;}
      if(kind==='scalar'){remaining-=8;return store.codec.read(token,{maxBytes:128,signal:deps.signal});}
      if(depth>4||remaining<=0)return kind==='array'?[]:{};
      const entries=(await store.codec.entries(token,{limit:50})).entries;
      if(kind==='array'){const result:unknown[]=[];for(const entry of entries){if(remaining<=0)break;result.push(await copy(entry.token,depth+1));}return result;}
      const result:Record<string,unknown>={};for(const entry of entries){const key=String(entry.key);remaining-=key.length*3;result[key]=await copy(entry.token,depth+1);}return result;
    };
    return copy(token);
  };
  const projected=async<T>(record:StoredRecord|undefined,path:readonly(string|number)[],fallback:T,maximum=24*1024):Promise<T>=>{
    if(!record)return fallback;const token=await store.codec.lookup(record.token,path);return token?await bounded(token,maximum) as T:fallback;
  };
  const changesPreview=async<T extends {changes:unknown[];total?:number}>(record:StoredRecord,path:readonly string[],page:number):Promise<T|undefined>=>{
    const token=await store.codec.lookup(record.token,path);if(!token||await store.codec.kind(token)!=='object')return;
    const result:Record<string,unknown>={};for(const entry of (await store.codec.entries(token,{limit:50})).entries)if(entry.key!=='changes')result[String(entry.key)]=await bounded(entry.token,8*1024);
    const changes=await store.codec.lookup(token,['changes']),rows:unknown[]=[];let total=0;
    if(changes){const entries=await store.codec.entries(changes,{after:Math.max(0,page)*10,limit:10});total=entries.total;for(const entry of entries.entries)rows.push(await bounded(entry.token,4*1024));}
    return {...result,changes:rows,total,pageSize:10} as unknown as T;
  };
  const sectionRows=async<T>(header:StoredRecord|undefined,key:string,collection:string,options:ScanOptions,filter?:(row:T)=>boolean,filterIndex=false):Promise<{rows:T[];total:number}>=>{
    const any=await store.scan(collection,{limit:1,taskId:options.taskId});
    if(any.total){
      if(!filterIndex||!filter){const page=await store.scan(collection,options);return {rows:await Promise.all(page.rows.map(async row=>await bounded(row.token) as T)),total:page.total};}
      const rows:T[]=[],start=options.offset??0,maximum=options.limit??50;let after:string|undefined,total=0;
      do{const page=await store.scan(collection,{...options,offset:0,after,limit:50});for(const record of page.rows){const row=await bounded(record.token) as T;if(filter(row)){if(total>=start&&rows.length<maximum)rows.push(row);total++;}}after=page.next;}while(after);return {rows,total};
    }
    const token=header&&await store.codec.lookup(header.token,[key]);if(!token)return {rows:[],total:0};
    if(!filter){const page=await store.codec.entries(token,{after:options.offset??0,limit:options.limit??50}),rows:T[]=[];for(const entry of page.entries)rows.push(await bounded(entry.token) as T);return {rows,total:page.total};}
    const rows:T[]=[],start=options.offset??0,maximum=options.limit??50;let after:number|undefined,total=0;
    do{const page=await store.codec.entries(token,{after,limit:50});for(const entry of page.entries){const row=await bounded(entry.token) as T;if(filter(row)){if(total>=start&&rows.length<maximum)rows.push(row);total++;}}after=page.next;}while(after!==undefined);
    return {rows,total};
  };
  const detailsTags=new Map<string,DisplayTag>();
  const detailTag=async(id:string)=>{if(!id||detailsTags.has(id))return;const tag=await read<TagDefinition|undefined>('tags',id,undefined);if(tag)detailsTags.set(id,projectTag(tag));};
  const detailPaper=async(id:string)=>{if(model.papers.some(p=>p.id===id)||model.detailPapers?.some(p=>p.id===id))return;const record=await store.reference('papers',id);if(record)(model.detailPapers??=[]).push(await paper(record));};
  const field=async<T>(key:string,path:readonly(string|number)[],fallback:T):Promise<T>=>state(key,fallback,path);
  const runId=await field('run',['id'],'');
  const runStatus=await field<'running'|'paused'|'idle'>('run',['status'],'idle');
  const runKind=await field<'rebuild'|'tag'|undefined>('run',['kind'],undefined);
  const runTotal=runId?await count('runJobs',{taskId:runId}):0;
  const runCompleted=runId?await count('runJobs',{taskId:runId,status:'completed'}):0;
  if(runId){model.queue={...model.queue,kind:runKind,ownerPage:runKind==='tag'?'assignment':'cleanup',status:runStatus,total:runTotal,completed:runCompleted,message:await field('run',['message'],''),spentUSD:await field('run',['spentUSD'],0),estimatePending:true,phase:runKind==='rebuild'?'reading':undefined};}
  const workflow:NonNullable<ManagerSnapshot['workflow']>={buildMode:await field('workflow',['buildMode'],'extend'),buildScope:await field('workflow',['buildScope'],'selected'),buildPaperCount:0,assignmentScope:await field('workflow',['assignmentScope'],'library'),assignmentPaperCount:0,assignedPaperCount:storedCounts?.assignedPapers??0,assignmentTagShelfId:await field('workflow',['assignmentTagShelfId'],'all')};
  const workflowRef=await store.reference('state','workflow');
  if(workflowRef)for(const [key,target] of [['buildPaperIds','buildPaperCount'],['assignmentPaperIds','assignmentPaperCount']] as const){const token=await store.codec.lookup(workflowRef.token,[key]);if(token)workflow[target]=(await store.codec.entries(token,{limit:1})).total;}
  model.workflow=workflow;

  if(query.page!=='settings'&&query.page!=='connection'){
    const shelves=await store.scan('tagShelves',{limit:50,orderBy:'order'});model.tagShelves=[];
    for(const record of shelves.rows){const value=object(await load(record));model.tagShelves.push({id:record.id,name:safeString(value.name,record.metadata.title??record.id),kind:value.kind==='existing'?'existing':value.kind==='generated'?'generated':'user',tagIds:[],count:record.metadata.count??safeNumber(value.count),readyCount:safeNumber(value.readyCount),assignableCount:safeNumber(value.assignableCount)});}
  }
  if(query.page==='settings'||query.page==='connection'){
    if(query.page==='connection')model.models=(await values<string>(await store.scan('models',{limit:50,search:safeString(params.modelQuery)}))).filter(value=>typeof value==='string');
    model.storage={activeBytes:stats.categories.active.bytes+stats.categories.ledger.bytes,historyBytes:stats.categories.history.bytes,cacheBytes:stats.categories.cache.bytes,backupBytes:await state('backupBytes',0),physicalBytes:stats.payloadBytes,retentionDays:7,decodedCacheBytes:stats.decodedCacheBytes,...(stats.databaseBytes!==undefined?{databaseBytes:stats.databaseBytes}:{})};
    if(params.settingsTransfersOpen)model.taxonomyArchives=(await store.scan('taxonomyArchives',{limit:50})).rows.map(record=>({id:record.id,date:new Date(record.metadata.completedAt??record.metadata.updatedAt??0).toISOString(),version:0,reason:record.metadata.title??'Previous tag list',count:record.metadata.count??0}));
  }else if(query.page==='library'){
    const raw=object(params.conceptFilter),selections=Array.isArray(raw.selections)?raw.selections.map(object):[];
    const clauses:DocumentRef[][][]=selections.map(selection=>[selection.conceptId,selection.contextId].filter((id):id is string=>typeof id==='string').map(id=>[{collection:'tags',id,relation:'matches',includeDescendants:true}]));
    const page=await store.scan('papers',{offset,limit,search:safeString(params.paperQuery),referenceClauses:clauses,referenceMode:raw.mode==='any'?'any':'all',orderBy:'title'});primary(page);
    for(const record of page.rows)model.papers.push(await paper(record));
    if(typeof params.selectedPaper==='string'&&params.selectedPaper){await detailPaper(params.selectedPaper);model.neighbors[params.selectedPaper]=await new SimilarityIndex(store).neighbors(params.selectedPaper,{signal:deps.signal});for(const neighbor of model.neighbors[params.selectedPaper])await detailPaper(neighbor.paperId);}
    if(params.libraryFiltersOpen){const tags=await store.scan('tags',{limit:50,search:safeString(params.conceptQuery),orderBy:'title'});model.tags=(await values<TagDefinition>(tags)).map(projectTag);}
    model.conceptCounts={};
    for(let index=0;index<selections.length;index++){const selection=selections[index],conceptId=safeString(selection.conceptId),contextId=safeString(selection.contextId);await detailTag(conceptId);if(contextId)await detailTag(contextId);model.conceptCounts[conceptId+'\u0000'+contextId]=await count('papers',{referenceClauses:[clauses[index]]});}
  }else if(query.page==='vocabulary'||query.page==='overview'){
    const requestedStatus=params.libraryTagStatus==='ready'?'ready':params.libraryTagStatus==='undefined'?'undefined':undefined;
    const shelf=safeString(params.libraryTagShelfId,'all');
    const references=shelf!=='all'?[[{collection:'tagShelves',id:shelf,relation:'member'}]]:undefined;
    const library=await store.scan('libraryTags',{offset,limit,search:safeString(params.vocabQuery),status:requestedStatus,references,orderBy:'title'});primary(library);model.tagLibraryEntries=[];
    for(const record of library.rows){
      const row=object(await load(record)),name=safeString(row.name,record.metadata.title??record.id),tagId=typeof row.tagId==='string'?row.tagId:undefined;
      model.tagLibraryEntries.push({name,paperCount:record.metadata.count??safeNumber(row.paperCount),tagId,protected:row.protected===true,paperIds:[]});
      if(tagId){const tag=await read<TagDefinition|undefined>('tags',tagId,undefined);if(tag)model.tags.push(projectTag(tag));}
    }
    if(!library.total&&requestedStatus!=='undefined'&&shelf==='all'){
      const tags=await store.scan('tags',{offset,limit,search:safeString(params.vocabQuery),orderBy:'title'});primary(tags);model.tags=(await values<TagDefinition>(tags)).map(projectTag);model.tagLibraryEntries=model.tags.map(tag=>({name:tag.name,tagId:tag.id,paperCount:0,paperIds:[]}));
    }
    for(const item of model.tagShelves??[]){item.tagIds=model.tags.filter(()=>shelf==='all'||item.id===shelf).map(tag=>tag.id);if(item.id===shelf)item.nativeNames=model.tagLibraryEntries;}
    const expanded=new Set([...strings(params.libraryLinkedPaperNames),...strings(params.libraryNoteNames)]);
    for(const entry of model.tagLibraryEntries)if(expanded.has(entry.name)){
      const examples=await store.scan('nativeNamePapers',{taskId:canonicalTagKey(entry.name),limit:3});
      for(const record of examples.rows){const id=await load<unknown>(record);if(typeof id==='string'){entry.paperIds!.push(id);await detailPaper(id);}}
    }
    if(params.nativeMeaningReviewHidden===false||params.editorNativeEntry||params.nativeReviewTarget)await nativeMeanings(true);
  }else if(query.page==='activity'){
    const choices=await store.scan('reviewItems',{limit:50,status:params.deferredReviewOpen?'deferred':'open'});model.reviewItems=await values(choices);
    if(params.activityHistoryOpen||params.completedActivityOpen){const history=await store.scan('history',{offset,limit,search:safeString(params.activityHistoryQuery),orderBy:'completed'});primary(history);model.history=history.rows.map(record=>({id:record.id,date:new Date(record.metadata.completedAt??record.metadata.updatedAt??0).toISOString(),label:record.metadata.title??'Saved change',count:record.metadata.count??0,canUndo:record.metadata.status==='applied'&&(record.metadata.completedAt??0)>=now-7*86400000,status:record.metadata.status}));}
    await nativeMeanings(false);
    const header=await store.reference('viewHeaders','paperAttention'),search=safeString(params.attentionQuery).toLocaleLowerCase(),status=safeString(params.attentionFilter,'attention');
    type Attention=NonNullable<ManagerSnapshot['paperAttention']>['papers'][number];
    const page=await sectionRows<Attention>(header,'papers','paperAttentionRows',{offset:Math.max(0,safeNumber(params.attentionPage))*25,limit:25,search,...(status==='attention'?{statuses:['needsInformation','failed']}:status!=='all'?{status}:{})},row=>(!search||row.title.toLocaleLowerCase().includes(search))&&(status==='all'||status==='attention'&&(row.status==='needsInformation'||row.status==='failed')||row.status===status));
    model.paperAttention={papers:page.rows,queued:await projected(header,['queued'],0),total:page.total};
    const metadata=await store.reference('viewHeaders','metadataPreview');if(metadata)model.metadataPreview=await bounded(metadata.token,48*1024) as ManagerSnapshot['metadataPreview'];
    const exclusion=await store.reference('viewHeaders','paperExclusionPreview');if(exclusion)model.paperExclusionPreview=await changesPreview(exclusion,[],safeNumber(params.paperExclusionPage));
    const warnings=await store.scan('warnings',{limit:50,status:'active'});model.warnings=await values(warnings);
    model.recoveryRequests=[];
    for(const record of (await store.scan('providerDispatches',{limit:50,statuses:['unknown','stopped'],orderBy:'completed'})).rows){
      const value=object(await bounded(record.token,8*1024));model.recoveryRequests.push({id:record.id,provider:typeof value.provider==='string'?value.provider:undefined,model:typeof value.model==='string'?value.model:undefined,status:record.metadata.status==='stopped'?'stopped':'unknown',startedAt:typeof value.dispatchedAt==='number'?value.dispatchedAt:undefined,message:safeString(value.error,record.metadata.status==='stopped'?'This request is stopped. Its previous outcome is still unknown.':'This request may have reached the provider. Choose whether to retry it or stop this attempt.')});
    }
  }else if(query.page==='existing-tags'){
    const header=await store.reference('viewHeaders','existingTags');
    if(header){
      type Existing=NonNullable<ManagerSnapshot['existingTags']>['rows'][number];
      const search=safeString(params.existingTagQuery).toLocaleLowerCase(),keep=params.existingTagView==='keep',status=safeString(keep?params.keepFilter:params.existingTagFilter,'all'),facet=keep?'all':safeString(params.existingTagFacet,'all'),id=await projected(header,['id'],'');
      const accept=(row:Existing)=>keep?(status==='all'||status==='kept'&&!!row.kept||status==='remove'&&!row.kept||status==='protected'&&!!row.protected)&&(!search||row.name.toLocaleLowerCase().includes(search)):(status==='all'||status==='kept'&&!!row.kept&&!row.protected||row.status===status)&&(!search||[row.name,row.meaning,...row.targetNames].join(' ').toLocaleLowerCase().includes(search))&&(facet==='all'||row.facet===facet);
      const rows=await sectionRows<Existing>(header,'rows','existingTagRows',{taskId:id,offset:Math.max(0,safeNumber(params.existingTagPage))*30,limit:30,search,...(!keep&&status!=='all'&&status!=='kept'?{status}:{}),...(facet!=='all'?{type:facet}:{})},accept,keep||status==='kept');
      model.existingTags={id:await projected(header,['id'],''),applied:await projected(header,['applied'],false),status:await projected(header,['status'],'ready'),message:await projected(header,['message'],undefined),rows:rows.rows,total:rows.total,preview:await changesPreview(header,['preview'],safeNumber(params.existingPreviewPage)),keepPreview:await changesPreview(header,['keepPreview'],safeNumber(params.keepPreviewPage))};total=rows.total;
    }
    const comparison=await store.reference('viewHeaders','diyComparison');if(comparison){const id=await projected(comparison,['id'],''),rows=await sectionRows<NonNullable<ManagerSnapshot['diyComparison']>['pairs'][number]>(comparison,'pairs','diyComparisonRows',{taskId:id,offset:Math.max(0,safeNumber(params.diyComparisonPage))*20,limit:20});model.diyComparison={id,status:await projected(comparison,['status'],'ready'),message:await projected(comparison,['message'],undefined),pairs:rows.rows,total:rows.total,preview:await changesPreview(comparison,['preview'],safeNumber(params.diyPreviewPage))};}
  }else if(query.page==='assignment'||query.page==='review'){
    const run=safeString(params.assignmentRunId,runId),page=await store.scan('suggestions',{offset,limit,taskId:run||undefined,status:params.reviewFilter==='accepted'?'accepted':params.reviewFilter==='rejected'?'rejected':undefined});primary(page);
    model.suggestions=await values<DisplaySuggestion>(page);const paperIds=new Set(model.suggestions.map(suggestion=>suggestion.paperId));for(const id of paperIds){const record=await store.reference('papers',id);if(record)model.papers.push(await paper(record));}
    const review=run?await read<DisplayAssignmentReview|undefined>('assignmentDisplays',run,undefined):undefined;if(review){model.assignmentReview=review;model.assignmentReviews=[review];}
    for(const suggestion of model.suggestions)await detailTag(suggestion.tagId);
  }else if(query.page==='build'||query.page==='cleanup'){
    const preparation=await read<DisplayTagPreparation|undefined>('viewHeaders','tagPreparation',undefined);if(preparation)model.tagPreparation={...preparation,tags:[],questions:[]};
    const collection=params.tagView==='questions'?'definitionQuestions':'preparedTags',page=await store.scan(collection,{offset,limit,search:safeString(params.vocabQuery),orderBy:'order'});primary(page);
    if(model.tagPreparation){if(collection==='definitionQuestions')model.tagPreparation.questions=await values(page);else model.tagPreparation.tags=(await values<TagDefinition>(page)).map(projectTag);}
    if(model.tagPreparation&&typeof params.editorTagId==='string'&&params.editorPreparationId===model.tagPreparation.id){const tag=await read<TagDefinition|undefined>('preparedTags',params.editorTagId,undefined);if(tag)model.tagPreparation.detailTags=[projectTag(tag)];}
  }
  if(['build','cleanup','assignment','review','activity','vocabulary'].includes(query.page)){
    model.activityTasks=(await values<NonNullable<ManagerSnapshot['activityTasks']>[number]>(await store.scan('activityTasks',{limit:50,orderBy:'order'}))).slice(0,50);
    model.canPrepareNativeMeanings=runStatus!=='running'&&!model.activityTasks.some(task=>task.state==='running'||task.state==='queued');
  }
  if(typeof params.editorTagId==='string')await detailTag(params.editorTagId);
  for(const value of Object.values(object(params.relationshipQueries)))if(typeof value==='string'&&value.trim())for(const record of (await store.scan('tags',{limit:10,search:value,orderBy:'title'})).rows)detailsTags.set(record.id,projectTag(await load<TagDefinition>(record)));
  if(detailsTags.size)model.detailTags=[...detailsTags.values()].slice(0,50);
  const undoIds=new Set([model.nativeDefinitionPreparation?.lastChangeId,model.tagPreparation?.lastChangeId,model.assignmentReview?.lastChangeId,...(model.assignmentReviews??[]).map(review=>review.lastChangeId)].filter((id):id is string=>!!id));
  for(const id of undoIds)if(!(query.page==='activity'&&(params.activityHistoryOpen||params.completedActivityOpen))&&!model.history.some(record=>record.id===id)){
    const record=await store.reference('history',id);model.history.push({id,date:new Date(record?.metadata.completedAt??record?.metadata.updatedAt??0).toISOString(),label:record?.metadata.title??'Previous change',count:record?.metadata.count??0,canUndo:!!record&&record.metadata.status==='applied'&&(record.metadata.completedAt??0)>=now-7*86400000,status:record?.metadata.status});
  }
  check();
  const event:ViewEvent={phase:'ready',revision:stats.revision,model,total,...(nextCursor?{nextCursor}:{})};
  constrain(event,query,offset);return event;

  async function nativeMeanings(primaryRows:boolean){
    const header=await read<NativePreparation|undefined>('viewHeaders','nativeDefinitionPreparation',undefined);
    const workId=header?.id??await field('nativeDefinitionPreparation',['work','id'],'');if(!workId)return;
    const requested=[object(params.editorNativeEntry),object(params.nativeReviewTarget)],page=await store.scan('nativeMeaningEntries',{offset:primaryRows?offset:0,limit:primaryRows?limit:10,taskId:workId,orderBy:'order'});
    if(primaryRows)primary(page);
    const rows:NativeRow[]=[];
    for(const record of page.rows)rows.push(await nativeRow(record));
    model.nativeDefinitionPreparation={id:workId,status:header?.status??'ready',completed:header?.completed??rows.filter(row=>row.status!=='pending').length,total:header?.total??page.total,canApply:header?.canApply??false,...header,rows};
    for(const target of requested)if(target.workId===workId&&typeof target.entryId==='string'&&!rows.some(row=>row.id===target.entryId)&&!model.detailNativeMeaningRows?.some(row=>row.id===target.entryId)){
      const record=await store.reference('nativeMeaningEntries',target.entryId);if(record?.metadata.taskId===workId)(model.detailNativeMeaningRows??=[]).push(await nativeRow(record));
    }
  }
  async function nativeRow(record:StoredRecord):Promise<NativeRow>{
    const display=await store.reference('nativeMeaningDisplays',record.id),source=display??record,row:NativeRow={id:record.id,sourceName:'',paperIds:[],status:'pending'};
    const fields=['id','reviewId','tagId','sourceName','name','fullName','description','facet','matchingMode','status','question','questionKind','resolution','selectionOrigin','targetTagId','personalTreatment','needsContinuation','canSetTreatment','canConfirmClear','canUseProposedMeaning','canSuggestMeaning','canRetryMeaning','canRecheckSources','bindingVerified','applied'];
    for(const key of fields){const token=await store.codec.lookup(source.token,[key]);if(token)Object.assign(row,{[key]:await bounded(token,8*1024)});}
    const paperIds=await store.codec.lookup(source.token,['paperIds']);if(paperIds){const page=await store.codec.entries(paperIds,{limit:50});row.paperIds=[];for(const item of page.entries){const id=await store.codec.read(item.token,{maxBytes:4*1024,signal:deps.signal});if(typeof id==='string')row.paperIds.push(id);}Object.assign(row,{paperCount:page.total});}
    if(display){
      for(const key of ['aliases','inclusions','exclusions','examples','broaderIds','relatedIds','chosenMeaning','savedMeaningConflicts'] as const){const token=await store.codec.lookup(display.token,[key]);if(token)Object.assign(row,{[key]:await bounded(token,24*1024)});}
      const choices=await store.codec.lookup(display.token,['choices']);if(choices){row.choices=[];for(const item of (await store.codec.entries(choices,{limit:4})).entries)row.choices.push(await bounded(item.token,16*1024) as NonNullable<NativeRow['choices']>[number]);}
      const issues=await store.codec.lookup(display.token,['sourceIssues']);if(issues){const page=await store.codec.entries(issues,{limit:50});row.sourceIssues=[];for(const item of page.entries)row.sourceIssues.push(await bounded(item.token,2*1024) as NonNullable<NativeRow['sourceIssues']>[number]);Object.assign(row,{sourceIssueCount:page.total});}
      return row;
    }
    const definitionToken=await store.codec.lookup(record.token,['definition']),definition=definitionToken?await store.codec.read(definitionToken,{maxBytes:128*1024,signal:deps.signal}) as TagDefinition:undefined;
    if(definition)Object.assign(row,projectTag(definition),{id:record.id,status:row.status});
    const admission=await store.codec.lookup(record.token,['meaningAdmission']),human=await store.codec.lookup(record.token,['humanAnswer']),automatic=await store.codec.lookup(record.token,['automaticAnswer']),question=await store.codec.lookup(record.token,['questionDetails']);
    const applied=!!admission,left=row.status==='left-undefined';Object.assign(row,{bindingVerified:!admission,applied,canUseProposedMeaning:!applied&&!left&&!!definition,canSuggestMeaning:!applied&&!left&&!definition,needsContinuation:row.status==='question'&&!question,canConfirmClear:false,canSetTreatment:!applied});
    if(human||automatic){row.selectionOrigin=human?'human':'automatic';if(definition)row.chosenMeaning={name:definition.name,description:definition.description};}
    if(admission)row.tagId=await projected(record,['meaningAdmission','tagId'],row.tagId);
    if(question){row.questionKind=await projected(record,['questionDetails','kind'],undefined);if(row.questionKind==='personal'||row.questionKind==='protection')row.canUseProposedMeaning=false;row.choices=[];const choices=await store.codec.lookup(question,['choices']);if(choices)for(const item of (await store.codec.entries(choices,{limit:4})).entries){const choice={...record,token:item.token};row.choices.push({id:await preview(choice,['id'],1000),label:await preview(choice,['label'],2000),description:await preview(choice,['definition','description'],2000)});}}
    row.sourceIssues=[];for(const id of row.paperIds){check();const judgment=await store.codec.lookup(record.token,['judgments',id]),relation=judgment?await projected({...record,token:judgment},['relation'],''):'';if(relation!=='same-meaning')row.sourceIssues.push({paperId:id,status:relation==='different'?'different':judgment?'uncertain':'unchecked',reason:judgment?await preview({...record,token:judgment},['reason'],160):'This source has not been checked.'});}
    if(definition&&row.targetTagId)await detailTag(row.targetTagId);
    return row;
  }
}

function constrain(event:ViewEvent,query:ViewQuery,offset:number):void {
  const model=event.model!;const size=()=>new TextEncoder().encode(JSON.stringify(event)).length;
  const nativePrimary=query.page==='vocabulary'&&query.params?.nativeMeaningReviewHidden===false;
  const primary=query.page==='library'?model.papers:query.page==='vocabulary'||query.page==='overview'?nativePrimary?model.nativeDefinitionPreparation?.rows??[]:model.tagLibraryEntries??[]:query.page==='activity'?model.history:query.page==='existing-tags'?model.existingTags?.rows??[]:query.page==='assignment'||query.page==='review'?model.suggestions:query.params?.tagView==='questions'?model.tagPreparation?.questions??[]:model.tagPreparation?.tags??[];
  for(const suggestion of model.suggestions){suggestion.reason=suggestion.reason.slice(0,2000);suggestion.evidence=suggestion.evidence.slice(0,6).map(quote=>({...quote,text:quote.text.slice(0,1200)}));}
  for(const row of [...(model.nativeDefinitionPreparation?.rows??[]),...(model.detailNativeMeaningRows??[])]){row.paperIds=row.paperIds.slice(0,50);row.sourceIssues=row.sourceIssues?.slice(0,50).map(issue=>({...issue,reason:issue.reason.slice(0,160)}));}
  const arrays=()=>[model.history,model.suggestions,model.papers,model.tags,model.reviewItems??[],model.nativeDefinitionPreparation?.rows??[],model.activityTasks??[],model.detailPapers??[],model.detailTags??[],model.paperAttention?.papers??[],model.existingTags?.rows??[],model.diyComparison?.pairs??[],model.recoveryRequests??[],model.warnings??[]];
  for(const rows of arrays())if(rows.length>50)rows.splice(50);
  const synchronize=()=>{
    if(query.page==='vocabulary'&&!nativePrimary){const ids=new Set(model.tagLibraryEntries?.map(entry=>entry.tagId));model.tags=model.tags.filter(tag=>ids.has(tag.id));}
    if(query.page==='assignment'||query.page==='review'){const ids=new Set(model.suggestions.map(suggestion=>suggestion.paperId));model.papers=model.papers.filter(paper=>ids.has(paper.id));}
  };
  while(size()>WORKSPACE_LIMITS.viewBytes){
    if(primary.length>1){primary.pop();synchronize();continue;}
    const rows=arrays().find(values=>values!==primary&&values.length>1);if(!rows)throw new Error('A workspace view exceeds its bounded display size. Open a smaller detail projection.');rows.pop();
  }
  if(event.total!==undefined){if(offset+primary.length<event.total&&primary.length)event.nextCursor=String(offset+primary.length);else delete event.nextCursor;}
}
