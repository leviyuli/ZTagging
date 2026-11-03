import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceStore} from '../src/workspace/storage.ts';
import {buildView} from '../src/workspace/views.ts';
import {ensureNativeReviewIndex} from '../src/workspace/native-review.ts';
import {memorySql} from './workspace-storage-adapter.ts';
import type {TagDefinition} from '../src/core.ts';

const tag=(id:string):TagDefinition=>({id,name:id,description:'A defined scientific topic.',facet:'system',aliases:[],broaderIds:[],relatedIds:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',matchingMode:'auto'});

test('Open meanings pages six pending choices before thirty-six saved and two skipped meanings',async()=>{
  const store=await WorkspaceStore.open(memorySql().port);
  try{
    await store.put('state','nativeDefinitionPreparation',{taskId:'task',work:{id:'work'}});
    await store.put('viewHeaders','nativeDefinitionPreparation',{id:'work',status:'ready',processingPolicy:'auto-clear',completed:44,total:44,canApply:false,questionCount:6,savedCount:36,leftUndefinedCount:2});
    for(let index=0;index<44;index++){
      const id='entry-'+String(index).padStart(2,'0'),saved=index<36,left=index>=36&&index<38,status=left?'left-undefined':'question';
      await store.put('nativeMeaningEntries',id,{id,sourceName:id,status,paperIds:[],definition:tag(id),...(saved?{meaningAdmission:{tagId:id}}:{})},{taskId:'work',order:index});
      await store.put('nativeMeaningDisplays',id,{id,sourceName:id,status,paperIds:[],applied:saved,description:'A suggested meaning.',canUseProposedMeaning:!saved&&!left},{taskId:'work',status,order:index});
      if(!saved&&!left)await store.put('reviewItems','choice-'+id,{id:'choice-'+id,kind:'definition',state:'open',taskId:'task',workId:'work',questionId:id,ownerPage:'vocabulary',label:id},{taskId:'task',status:'open'});
    }
    const query={page:'vocabulary' as const,limit:20,params:{nativeMeaningReviewHidden:false,nativeMeaningWorkId:'work'}};
    const first=await buildView(store,query);assert.equal(first.total,6);assert.equal(first.nextCursor,undefined);assert.equal(first.model!.nativeDefinitionPreparation!.rows[0].id,'entry-38');assert.equal(first.model!.reviewItems!.length,6);assert.equal(first.model!.nativeDefinitionPreparation!.savedCount,36);
    const record=await store.get('reviewItems','choice-entry-38') as Record<string,unknown>;await store.put('reviewItems','choice-entry-38',{...record,state:'deferred'},{taskId:'task',status:'deferred'});
    const active=await buildView(store,query);assert.equal(active.total,5);assert.equal(active.model!.nativeDefinitionPreparation!.deferredCount,1);assert.ok(active.model!.nativeDefinitionPreparation!.rows.every(row=>row.id!=='entry-38'));
    const later=await buildView(store,{...query,params:{...query.params,deferredReviewOpen:true}});assert.equal(later.total,1);assert.equal(later.model!.reviewItems![0].state,'deferred');assert.equal(later.model!.nativeDefinitionPreparation!.rows[0].id,'entry-38');
    await ensureNativeReviewIndex(store,{yieldControl:async()=>{}});
    const scan=store.scan.bind(store);store.scan=async(collection,options)=>{assert.notEqual(collection,'nativeMeaningEntries','indexed paging must not rescan saved meaning bodies');return scan(collection,options);};
    const indexed=await buildView(store,query);assert.equal(indexed.total,5);assert.equal(indexed.model!.nativeDefinitionPreparation!.deferredCount,1);assert.equal(indexed.model!.reviewItems!.length,5);
    await assert.rejects(buildView(store,{...query,params:{...query.params,nativeMeaningWorkId:'another-work'}}),/Open this meaning preparation/);
  }finally{await store.close();}
});

test('the manual undefined shelf excludes imported-only names and defined tags and keeps exact pagination',async()=>{
  const store=await WorkspaceStore.open(memorySql().port);
  try{
    for(let index=0;index<25;index++){const name='Manual '+String(index).padStart(2,'0');await store.put('libraryTags',name,{name,paperCount:1},{title:name,status:'undefined',type:'manual-native'});}
    await store.put('libraryTags','automatic',{name:'Imported keyword'},{status:'undefined',type:'imported-native'});await store.put('libraryTags','defined',{name:'Defined topic',tagId:'defined'},{status:'ready',type:'manual-native'});
    const query={page:'vocabulary' as const,limit:20,params:{libraryTagShelfId:'my-undefined-tags',libraryTagStatus:'all'}};
    const first=await buildView(store,query);assert.equal(first.total,25);assert.equal(first.model!.tagLibraryEntries!.length,20);assert.equal(first.nextCursor,'20');
    const next=await buildView(store,{...query,cursor:first.nextCursor});assert.equal(next.model!.tagLibraryEntries!.length,5);assert.equal(next.nextCursor,undefined);
    const search=await buildView(store,{...query,params:{...query.params,vocabQuery:'Manual 21'}});assert.equal(search.total,1);assert.equal(search.model!.tagLibraryEntries![0].name,'Manual 21');
  }finally{await store.close();}
});

test('a built-tag view selects only that run and counts current definitions after deletion',async()=>{
  const store=await WorkspaceStore.open(memorySql().port);
  try{
    for(let index=0;index<53;index++){
      const id='built-'+String(index).padStart(2,'0');await store.put('tags',id,tag(id),{title:id,searchText:id});await store.put('buildResultTags',id,{tagId:id},{taskId:'build-1',refs:[{collection:'tags',id}]});
    }
    await store.put('libraryTags','built-01',{name:'built-01',tagId:'built-01',paperCount:3},{count:3});await store.put('tags','unrelated',tag('unrelated'),{title:'unrelated'});await store.put('buildResults','build-1',{runId:'build-1',status:'completed',paperCount:4,completedPaperCount:4,savedCount:53,questionCount:0});await store.put('state','latestBuildRunId','build-1');await store.delete('tags','built-00');
    const query={page:'vocabulary' as const,limit:50,params:{buildRunId:'build-1'}};const first=await buildView(store,query);assert.equal(first.total,52);assert.equal(first.model!.buildResult!.savedCount,52);assert.equal(first.model!.tagLibraryEntries!.length,50);assert.equal(first.nextCursor,'50');assert.ok(first.model!.tags.every(tag=>tag.id!=='unrelated'));
    assert.equal(first.model!.tagLibraryEntries!.find(entry=>entry.tagId==='built-01')!.paperCount,3);const last=await buildView(store,{...query,cursor:'50'});assert.equal(last.model!.tags.length,2);assert.equal(last.nextCursor,undefined);
    const search=await buildView(store,{...query,params:{...query.params,vocabQuery:'built-51'}});assert.equal(search.total,1);assert.equal(search.model!.tags[0].id,'built-51');
    const missing=await buildView(store,{...query,params:{buildRunId:'missing'}});assert.equal(missing.total,0);assert.equal(missing.model!.tags.length,0);
  }finally{await store.close();}
});
