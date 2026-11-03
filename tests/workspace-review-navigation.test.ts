import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceStore} from '../src/workspace/storage.ts';
import {buildView} from '../src/workspace/views.ts';
import {memorySql} from './workspace-storage-adapter.ts';
import type {TagDefinition} from '../src/core.ts';

const tag=(id:string):TagDefinition=>({id,name:id,description:'A defined scientific topic.',facet:'system',aliases:[],broaderIds:[],relatedIds:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',matchingMode:'auto'});

test('old meaning and shelf parameters cannot revive retired native library views',async()=>{
  const store=await WorkspaceStore.open(memorySql().port);
  try{
    await store.put('state','nativeDefinitionPreparation',{taskId:'old',work:{id:'old'}});
    await store.put('libraryTags','native:important',{name:'Important',paperCount:15},{title:'Important',status:'undefined',type:'manual-native'});
    await store.put('tags','ai-built',tag('ai-built'),{title:'AI-built'});
    const view=await buildView(store,{page:'vocabulary',params:{nativeMeaningReviewHidden:false,libraryTagShelfId:'my-undefined-tags',libraryTagStatus:'undefined'}});
    assert.equal(view.total,1);assert.deepEqual(view.model!.tags.map(tag=>tag.id),['ai-built']);assert.equal(view.model!.nativeDefinitionPreparation,undefined);assert.equal(view.model!.tagShelves,undefined);
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
    assert.equal(first.model!.tagLibraryEntries!.find(entry=>entry.tagId==='built-01')!.paperCount,0);const last=await buildView(store,{...query,cursor:'50'});assert.equal(last.model!.tags.length,2);assert.equal(last.nextCursor,undefined);
    const search=await buildView(store,{...query,params:{...query.params,vocabQuery:'built-51'}});assert.equal(search.total,1);assert.equal(search.model!.tags[0].id,'built-51');
    const missing=await buildView(store,{...query,params:{buildRunId:'missing'}});assert.equal(missing.total,0);assert.equal(missing.model!.tags.length,0);
  }finally{await store.close();}
});
