import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/controller.ts';
import type {ControllerEnvironment} from '../src/controller.ts';
import {canonicalTagKey,paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
import type {LibraryHost,NativeTag} from '../src/platform.ts';
import {WorkingContext} from '../src/workspace/context.ts';
import {WorkspaceEngine} from '../src/workspace/engine.ts';
import {WorkspaceStore} from '../src/workspace/storage.ts';
import {memorySql} from './workspace-storage-adapter.ts';
import {buildOriginOperation} from '../src/workspace/workflow-policy.ts';

const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
function fixture(){
  const value:PaperRecord={id:'1:PAPER',itemID:1,libraryID:1,key:'PAPER',title:'A local paper',abstract:'A source abstract.',keywords:[],summary:'',concepts:[],fingerprint:''};value.fingerprint=paperFingerprint(value);
  const native=new Map<number,NativeTag[]>([[1,[]]]),host:LibraryHost={async list(){return [copy(value)];},async read(id){return id===1?copy(value):null;},async readTags(id){return copy(native.get(id)??[]);},async pdfText(){throw new Error('Indexing must not read PDF text.');},async apply(){throw new Error('Indexing must not write native tags.');},async show(){},async saveSearch(){}};
  const ai=new Proxy({},{get(_target,key){return key==='cancelSignIn'?()=>{}:async()=>{throw new Error('Indexing must not request AI.');};}}) as ControllerEnvironment['ai'];
  return {paper:value,native,host,ai};
}

test('native labels stay protected without becoming managed tags or scientific matches',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),source=fixture(),context=new WorkingContext(store),state=initialState();
  state.tags.push({...state.tags[0],id:'known',name:'Known meaning',aliases:['Known alias'],status:'approved'},{...state.tags[0],id:'draft',name:'Draft only',status:'draft'});context.setState(state);await context.seed();
  await store.commitRecords([buildOriginOperation({tagId:'known',definition:state.tags.find(tag=>tag.id==='known')!,workId:'validated-build'})]);
  const engine=new WorkspaceEngine({store,host:source.host,ai:source.ai,yieldControl:async()=>{}});await engine.open();
  try{
    source.native.set(1,[{tag:'Manual label',type:0},{tag:'Imported label',type:1},{tag:'Mixed label',type:0},{tag:'MIXED LABEL',type:1},{tag:'Known alias',type:0}]);await engine.ingestIndexed([{itemID:1,paperId:source.paper.id,version:'v1'}]);
    assert.deepEqual((await store.scan('tags',{limit:50})).rows.map(row=>row.id),['known']);assert.deepEqual(await store.get('nativeTags',source.paper.id),source.native.get(1));
    assert.deepEqual(await store.get('papers',source.paper.id,{path:['keywords']}),[]);assert.equal((await store.scan('scientificMatches')).total,0);assert.equal((await store.links('papers',source.paper.id)).rows.filter(link=>link.relation==='matches').length,0);
    for(const collection of ['libraryTags','nativeNames','nativeNamePapers','tagShelves'])assert.equal((await store.scan(collection)).total,0);
    source.native.set(1,[{tag:'MIXED LABEL',type:1},{tag:'Mixed label',type:0},{tag:'Imported label',type:1}]);await engine.ingestIndexed([{itemID:1,paperId:source.paper.id,version:'v2'}]);assert.deepEqual(await store.get('nativeTags',source.paper.id),source.native.get(1));assert.equal((await store.scan('tags')).total,1);assert.equal((await store.scan('scientificMatches')).total,0);
  }finally{await engine.close('disable');await store.close();}
});

test('obsolete native inventory is removed once without decoding paper or paid-history archives',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),source=fixture(),context=new WorkingContext(store);await context.seed();
  await store.put('papers',source.paper.id,{...source.paper,pdfText:'Private PDF body. '.repeat(2000)},{title:source.paper.title});await store.put('history','old',{body:'Private archived reply. '.repeat(2000)},{category:'history'});
  await store.put('nativeTags',source.paper.id,[{tag:'Mixed label',type:0},{tag:'MIXED LABEL',type:1}]);const key=canonicalTagKey('Mixed label'),memberId=JSON.stringify([key,source.paper.id]);
  await store.put('nativeNamePapers',memberId,source.paper.id,{taskId:key,status:'automatic',refs:[{collection:'papers',id:source.paper.id}]});await store.put('nativeNames',key,{name:'Mixed label',paperCount:1,tagIds:[]},{title:'Mixed label',status:'undefined'});
  await store.put('libraryTags','native:'+key,{name:'Mixed label',paperCount:1,protected:true,extra:'Preserved field'},{title:'Mixed label',status:'undefined',searchText:'Mixed label searchable legacy wording',refs:[{collection:'tagShelves',id:'real-shelf',relation:'member'}]});
  const forbidden=[(await store.reference('papers',source.paper.id))!.token,(await store.reference('history','old'))!.token],read=store.codec.read.bind(store.codec);store.codec.read=async(token,options)=>{for(const other of forbidden)assert.notDeepEqual(token,other);return read(token,options);};
  let engine=new WorkspaceEngine({store,host:source.host,ai:source.ai,yieldControl:async()=>{}});await engine.open();
  try{
    for(const collection of ['libraryTags','nativeNames','nativeNamePapers','tagShelves'])assert.equal((await store.scan(collection)).total,0);assert.ok(await store.reference('history','old'));assert.deepEqual(await store.get('nativeTags',source.paper.id),[{tag:'Mixed label',type:0},{tag:'MIXED LABEL',type:1}]);
    await engine.close('disable');const scan=store.scan.bind(store);store.scan=async(collection,options)=>{assert.ok(!['nativeNames','nativeNamePapers','libraryTags'].includes(collection),'Warm startup must skip retired inventory');return scan(collection,options);};engine=new WorkspaceEngine({store,host:source.host,ai:source.ai,yieldControl:async()=>{}});await engine.open();assert.equal(await store.get('workspace','workflowPolicy',{path:['phase']}),'complete');
  }finally{await engine.close('disable');await store.close();}
});

test('cancelled retirement leaves its policy incomplete and resumes derived-index cleanup safely',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),source=fixture(),context=new WorkingContext(store);await context.seed();
  for(let index=0;index<65;index++){const name='Manual '+String(index).padStart(3,'0');await store.put('nativeNames',canonicalTagKey(name),{name,paperCount:1,manualCount:1},{title:name,status:'undefined'});await store.put('nativeNamePapers',JSON.stringify([canonicalTagKey(name),source.paper.id]),source.paper.id,{taskId:canonicalTagKey(name),status:'manual',refs:[{collection:'papers',id:source.paper.id}]});}
  const abort=new AbortController();let yields=0,engine=new WorkspaceEngine({store,host:source.host,ai:source.ai,signal:abort.signal,yieldControl:async()=>{if(++yields===8)abort.abort(new Error('cancel indexing'));}});await assert.rejects(engine.open(),/cancel indexing/);assert.notEqual(await store.get('workspace','workflowPolicy',{path:['phase']}),'complete');await engine.close('disable');
  engine=new WorkspaceEngine({store,host:source.host,ai:source.ai,yieldControl:async()=>{}});try{await engine.open();for(const collection of ['libraryTags','nativeNames','nativeNamePapers','tagShelves'])assert.equal((await store.scan(collection)).total,0);assert.equal(await store.get('workspace','workflowPolicy',{path:['phase']}),'complete');}finally{await engine.close('disable');await store.close();}
});
