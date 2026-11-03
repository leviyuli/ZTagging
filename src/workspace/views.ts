import type {ManagerSnapshot,DisplayTag,DisplayPaper,DisplaySuggestion,DisplayAssignmentReview,DisplayTagPreparation,DisplayBuildResult,DisplayRun} from '../ui-contract.ts';
import type {ViewEvent,ViewQuery} from '../workspace-contract.ts';
import {WORKSPACE_LIMITS} from '../workspace-contract.ts';
import type {TagDefinition} from '../core.ts';
import {WorkspaceStore} from './storage.ts';
import {SimilarityIndex} from './similarity.ts';
import type {DocumentRef,PayloadToken,RecordPage,ScanOptions,StoredRecord} from './storage.ts';

const defaults:ManagerSnapshot['settings']={provider:'chatgpt',model:'',autoAssign:false,budgetUSD:5,inputPricePerMillion:0,outputPricePerMillion:0,maxOutputTokens:8192,coreConceptLimit:60,extensionTagTarget:30};
const emptyConnection:ManagerSnapshot['connection']={apiKeyStored:false,chatgptSignedIn:false,accountLabel:undefined,accounts:[]};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
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
    const matchedTagIds:string[]=[];let linkOffset:number|undefined;do{const page=await store.links('papers',record.id,{offset:linkOffset,limit:50});for(const ref of page.rows)if(ref.collection==='tags'&&ref.relation==='matches')matchedTagIds.push(ref.id);linkOffset=page.next;}while(linkOffset!==undefined);
    return {id:record.id,matchedTagIds,title:await preview(record,['title'],1000)||record.metadata.title||'Untitled paper',abstract,keywords,summary:await preview(record,['summary'],selected(record.id)?4000:200),tags,evidenceStatus:hasPDF?'Metadata and selected PDF passages':abstract?'Title and abstract':'Abstract missing; limited metadata'};
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
  const selectedLogical=safeString(params.runId)||await state(query.page==='assignment'||query.page==='review'?'latestAssignmentLogicalRunId':'latestBuildLogicalRunId','');
  if(selectedLogical)model.run=await read<DisplayRun|undefined>('runs',selectedLogical,undefined);
  const expectedKind=query.page==='assignment'||query.page==='review'?'assignment':query.page==='build'||query.page==='cleanup'?'build':undefined;
  if(expectedKind&&model.run?.kind!==expectedKind){const latest=await state(expectedKind==='assignment'?'latestAssignmentLogicalRunId':'latestBuildLogicalRunId',''),candidate=latest?await read<DisplayRun|undefined>('runs',latest,undefined):undefined;model.run=candidate?.kind===expectedKind?candidate:undefined;}
  if(query.page==='settings'||query.page==='activity')model.transitionSummary=await state<ManagerSnapshot['transitionSummary']>('workflowTransitionSummary',undefined);
  if(query.page==='activity'){
    const runs=await store.scan('runs',{offset,limit,orderBy:'completed'});primary(runs);model.runs=await values<DisplayRun>(runs);
  }
  const selectedBuild=safeString(params.buildRunId)||(model.run?model.run.resultRunId??'':await state('latestBuildRunId',''));
  if(selectedBuild&&['build','cleanup','vocabulary','activity'].includes(query.page)){
    const result=await read<DisplayBuildResult|undefined>('buildResults',selectedBuild,undefined);
    if(result){const options={referencedBy:{collection:'buildResultTags',taskId:selectedBuild}},saved=await count('tags',options),tags=await store.scan('tags',{...options,limit:10,orderBy:'title'});model.buildResult={...result,savedCount:saved,tagNames:tags.rows.map(tag=>tag.metadata.title??tag.id)};}
  }

  if(query.page==='settings'||query.page==='connection'){
    if(query.page==='connection')model.models=(await values<string>(await store.scan('models',{limit:50,search:safeString(params.modelQuery)}))).filter(value=>typeof value==='string');
    model.storage={activeBytes:stats.categories.active.bytes+stats.categories.ledger.bytes,historyBytes:stats.categories.history.bytes,cacheBytes:stats.categories.cache.bytes,backupBytes:await state('backupBytes',0),physicalBytes:stats.payloadBytes,retentionDays:7,decodedCacheBytes:stats.decodedCacheBytes,...(stats.databaseBytes!==undefined?{databaseBytes:stats.databaseBytes}:{})};
    if(params.settingsTransfersOpen)model.taxonomyArchives=(await store.scan('taxonomyArchives',{limit:50})).rows.map(record=>({id:record.id,date:new Date(record.metadata.completedAt??record.metadata.updatedAt??0).toISOString(),version:0,reason:record.metadata.title??'Previous tag list',count:record.metadata.count??0}));
  }else if(query.page==='library'){
    model.savedFilters=await values(await store.scan('savedFilters',{limit:50,orderBy:'title'}));
    const raw=object(params.conceptFilter),selections=Array.isArray(raw.selections)?raw.selections.map(object):[];
    const clauses:DocumentRef[][][]=selections.map(selection=>[selection.conceptId,selection.contextId].filter((id):id is string=>typeof id==='string').map(id=>[{collection:'tags',id,relation:'matches',includeDescendants:true}]));
    const page=await store.scan('papers',{offset,limit,search:safeString(params.paperQuery),referenceClauses:clauses,referenceMode:raw.mode==='any'?'any':'all',orderBy:'title'});primary(page);
    for(const record of page.rows)model.papers.push(await paper(record));
    if(typeof params.selectedPaper==='string'&&params.selectedPaper){await detailPaper(params.selectedPaper);model.neighbors[params.selectedPaper]=await new SimilarityIndex(store).neighbors(params.selectedPaper,{signal:deps.signal});for(const neighbor of model.neighbors[params.selectedPaper])await detailPaper(neighbor.paperId);}
    if(params.libraryFiltersOpen){const tags=await store.scan('tags',{limit:50,search:safeString(params.conceptQuery),orderBy:'title'});model.tags=(await values<TagDefinition>(tags)).map(projectTag);}
    model.conceptCounts={};
    for(let index=0;index<selections.length;index++){const selection=selections[index],conceptId=safeString(selection.conceptId),contextId=safeString(selection.contextId);await detailTag(conceptId);if(contextId)await detailTag(contextId);model.conceptCounts[conceptId+'\u0000'+contextId]=await count('papers',{referenceClauses:[clauses[index]]});}
  }else if(query.page==='vocabulary'||query.page==='overview'){
    const buildRunId=safeString(params.buildRunId);
    const library=await store.scan('tags',{offset,limit,search:safeString(params.vocabQuery),...(buildRunId?{referencedBy:{collection:'buildResultTags',taskId:buildRunId}}:{}),orderBy:'title'});primary(library);
    model.tags=(await values<TagDefinition>(library)).filter(tag=>!tag.builtin).map(projectTag);
    model.tagLibraryEntries=[];for(const tag of model.tags)model.tagLibraryEntries.push({name:tag.name,tagId:tag.id,paperCount:await count('papers',{references:[[{collection:'tags',id:tag.id,relation:'matches'}]]}),paperIds:[]});
  }else if(query.page==='activity'){
    const choices=await store.scan('reviewItems',{limit:50,status:params.deferredReviewOpen?'deferred':'open'});model.reviewItems=await values(choices);
    if(params.activityHistoryOpen||params.completedActivityOpen){const history=await store.scan('history',{offset:Math.max(0,safeNumber(params.activityHistoryPage))*25,limit:25,search:safeString(params.activityHistoryQuery),orderBy:'completed'});model.history=history.rows.map(record=>({id:record.id,date:new Date(record.metadata.completedAt??record.metadata.updatedAt??0).toISOString(),label:record.metadata.title??'Saved change',count:record.metadata.count??0,canUndo:record.metadata.status==='applied'&&(record.metadata.completedAt??0)>=now-7*86400000,status:record.metadata.status}));}
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
  }else if(query.page==='assignment'||query.page==='review'){
    const run=safeString(params.assignmentRunId,model.run?.resultRunId??runId),page=await store.scan('suggestions',{offset,limit,taskId:run||undefined,status:params.reviewFilter==='accepted'?'accepted':params.reviewFilter==='rejected'?'rejected':undefined});
    if(params.assignmentView==='setup'){
      const tags=await store.scan('tags',{offset,limit,search:safeString(params.assignmentTagQuery),status:'approved',type:'enabled',orderBy:'title'});primary(tags);model.tags=(await values<TagDefinition>(tags)).map(projectTag);
    }else primary(page);
    model.suggestions=await values<DisplaySuggestion>(page);const paperIds=new Set(model.suggestions.map(suggestion=>suggestion.paperId));for(const id of paperIds){const record=await store.reference('papers',id);if(record)model.papers.push(await paper(record));}
    const review=run?await read<DisplayAssignmentReview|undefined>('assignmentDisplays',run,undefined):undefined;if(review){model.assignmentReview=review;model.assignmentReviews=[review];}
    for(const suggestion of model.suggestions)await detailTag(suggestion.tagId);
  }else if(query.page==='build'||query.page==='cleanup'){
    const exclusion=await store.reference('viewHeaders','paperExclusionPreview');if(exclusion)model.paperExclusionPreview=await changesPreview(exclusion,[],safeNumber(params.paperExclusionPage));
    const preparation=await read<DisplayTagPreparation|undefined>('viewHeaders','tagPreparation',undefined);if(preparation)model.tagPreparation={...preparation,tags:[],questions:[]};
    const collection=params.tagView==='questions'?'definitionQuestions':'preparedTags',page=await store.scan(collection,{offset,limit,search:safeString(params.vocabQuery),orderBy:'order'});primary(page);
    if(model.tagPreparation){if(collection==='definitionQuestions')model.tagPreparation.questions=await values(page);else model.tagPreparation.tags=(await values<TagDefinition>(page)).map(projectTag);}
    if(model.tagPreparation&&typeof params.editorTagId==='string'&&params.editorPreparationId===model.tagPreparation.id){const tag=await read<TagDefinition|undefined>('preparedTags',params.editorTagId,undefined);if(tag)model.tagPreparation.detailTags=[projectTag(tag)];}
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

}

function constrain(event:ViewEvent,query:ViewQuery,offset:number):void {
  const model=event.model!;const size=()=>new TextEncoder().encode(JSON.stringify(event)).length;
  const primary=query.page==='library'?model.papers:query.page==='vocabulary'||query.page==='overview'?model.tagLibraryEntries??[]:query.page==='activity'?model.runs??[]:query.page==='assignment'&&query.params?.assignmentView==='setup'?model.tags:query.page==='assignment'||query.page==='review'?model.suggestions:query.params?.tagView==='questions'?model.tagPreparation?.questions??[]:model.tagPreparation?.tags??[];
  for(const suggestion of model.suggestions){suggestion.reason=suggestion.reason.slice(0,2000);suggestion.evidence=suggestion.evidence.slice(0,6).map(quote=>({...quote,text:quote.text.slice(0,1200)}));}
  for(const row of [...(model.nativeDefinitionPreparation?.rows??[]),...(model.detailNativeMeaningRows??[])]){row.paperIds=row.paperIds.slice(0,50);row.sourceIssues=row.sourceIssues?.slice(0,50).map(issue=>({...issue,reason:issue.reason.slice(0,160)}));}
  const arrays=()=>[model.history,model.suggestions,model.papers,model.tags,model.runs??[],model.reviewItems??[],model.detailPapers??[],model.detailTags??[],model.paperAttention?.papers??[],model.recoveryRequests??[],model.warnings??[]];
  for(const rows of arrays())if(rows.length>50)rows.splice(50);
  const synchronize=()=>{
    if(query.page==='vocabulary'){const ids=new Set(model.tagLibraryEntries?.map(entry=>entry.tagId));model.tags=model.tags.filter(tag=>ids.has(tag.id));}
    if(query.page==='assignment'||query.page==='review'){const ids=new Set(model.suggestions.map(suggestion=>suggestion.paperId));model.papers=model.papers.filter(paper=>ids.has(paper.id));}
  };
  while(size()>WORKSPACE_LIMITS.viewBytes){
    if(primary.length>1){primary.pop();synchronize();continue;}
    const rows=arrays().find(values=>values!==primary&&values.length>1);if(!rows)throw new Error('A workspace view exceeds its bounded display size. Open a smaller detail projection.');rows.pop();
  }
  if(event.total!==undefined){if(offset+primary.length<event.total&&primary.length)event.nextCursor=String(offset+primary.length);else delete event.nextCursor;}
}
