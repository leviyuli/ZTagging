import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState} from '../src/controller.ts';
import type {ControllerEnvironment} from '../src/controller.ts';
import {paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import type {NativeTag} from '../src/platform.ts';

function fixture(count=1) {
  const state=initialState(),papers=new Map<number,PaperRecord>(),native=new Map<number,NativeTag[]>();
  const tag:TagDefinition={id:'fc',name:'FC',description:'Electrochemical fuel cells.',facet:'system',aliases:[],broaderIds:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',matchingMode:'suggest'};
  state.tags=[tag];let saves=0,reads=0,pdfReads=0;
  for(let index=1;index<=count;index++){
    const paper:PaperRecord={id:`1:PAPER${index}`,itemID:index,libraryID:1,key:`PAPER${index}`,title:`Fuel-cell study ${index}`,abstract:'Experimental fuel-cell performance.',keywords:['fuel cells'],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
    papers.set(index,structuredClone(paper));native.set(index,[{tag:'FC',type:0}]);state.papers[paper.id]=paper;state.nativeTags[paper.id]=[{tag:'FC',type:0}];
  }
  const env={host:{async read(id:number){reads++;return structuredClone(papers.get(id)??null);},async readTags(id:number){return structuredClone(native.get(id)??[]);},async pdfText(){pdfReads++;return '';}},ai:{cancelSignIn(){}},async persist(){saves++;}} as unknown as ControllerEnvironment;
  return {state,papers,native,env,app:new AppController(state,env),counts:()=>({saves,reads,pdfReads})};
}

test('unchanged Zotero notifications never traverse review history or persist state',async()=>{
  const h=fixture();let reviews=0;
  Object.defineProperty(h.state,'nativeDefinitionPreparation',{get(){reviews++;throw new Error('Unchanged metadata must not traverse saved meaning work.');},configurable:true});
  for(let index=0;index<30;index++)await h.app.onItemChanged(1);
  assert.deepEqual(h.counts(),{saves:0,reads:30,pdfReads:0});assert.equal(reviews,0);assert.deepEqual(h.state.decisions,{});
});

test('a burst deduplicates notifications and persists changed papers once',async()=>{
  const h=fixture(40);for(const paper of h.papers.values())paper.title+=' Updated';
  await h.app.onItemsChanged([...h.papers.keys()].flatMap(itemID=>[{itemID},{itemID}]));
  assert.deepEqual(h.counts(),{saves:1,reads:40,pdfReads:0});assert.ok(Object.values(h.state.papers).every(paper=>paper.title.endsWith(' Updated')));
  await h.app.onItemsChanged([...h.papers.keys()].map(itemID=>({itemID})));
  assert.deepEqual(h.counts(),{saves:1,reads:80,pdfReads:0});
});

test('batched native removals still record manual rejections and retire owned assignments',async()=>{
  const h=fixture(),id='1:PAPER1';h.state.ownership[id]={fc:{name:'FC',type:1}};h.native.set(1,[]);
  await h.app.onItemsChanged([{itemID:1},{itemID:1}]);
  assert.equal(h.state.decisions[`${id}|fc`].rejected,true);assert.deepEqual(h.state.ownership[id],{});assert.deepEqual(h.state.nativeTags[id],[]);assert.equal(h.counts().saves,1);
});

test('an attachment notification wins over a duplicate item update and persists source invalidation',async()=>{
  const h=fixture(),id='1:PAPER1';h.state.papers[id].pdfText='An old local PDF excerpt.';h.state.approvedTaxonomyInput='old-scientific-input';
  await h.app.onItemsChanged([{itemID:1},{itemID:1,attachment:true},{itemID:1}]);
  assert.equal(h.state.papers[id].pdfText,undefined);assert.equal(h.state.approvedTaxonomyInput,undefined);assert.equal(h.counts().saves,1);assert.equal(h.counts().reads,2);assert.equal(h.counts().pdfReads,0);
});

test('tag order changes and unrelated item fields do not create background saves',async()=>{
  const h=fixture();h.state.nativeTags['1:PAPER1']=[{tag:'FC',type:0},{tag:'Important',type:0}];h.native.set(1,[{tag:'Important',type:0},{tag:'FC',type:0}]);
  await h.app.onItemChanged(1);assert.equal(h.counts().saves,0);assert.deepEqual(h.state.decisions,{});
  h.native.set(1,[{tag:'Important',type:0},{tag:'FC',type:1}]);await h.app.onItemChanged(1);assert.equal(h.counts().saves,1);assert.equal(h.state.nativeTags['1:PAPER1'].find(tag=>tag.tag==='FC')!.type,1);
});

test('one unreadable paper does not discard other persisted changes in a notification batch',async()=>{
  const h=fixture(3),readTags=h.env.host.readTags;h.papers.get(1)!.title+=' Updated';h.papers.get(3)!.title+=' Updated';
  h.env.host.readTags=async id=>{if(id===2)throw new Error('Synthetic unreadable item');return readTags(id);};
  let persisted=false;h.env.persist=async state=>{persisted=state.papers['1:PAPER1'].title.endsWith(' Updated')&&state.papers['1:PAPER3'].title.endsWith(' Updated');};
  await assert.rejects(h.app.onItemsChanged([{itemID:1},{itemID:2},{itemID:3}]),/Synthetic unreadable item/);
  assert.equal(persisted,true);assert.equal(h.counts().reads,3);assert.deepEqual(h.state.decisions,{});
});

test('failed attachment metadata reads leave the prior scientific source intact',async()=>{
  const h=fixture(),id='1:PAPER1',read=h.env.host.read;h.state.papers[id].pdfText='Saved PDF excerpt.';h.state.approvedTaxonomyInput='approved-source';let reads=0;
  h.env.host.read=async itemID=>{if(++reads===2)throw new Error('Synthetic attachment read failure');return read(itemID);};
  await assert.rejects(h.app.onAttachmentChanged(1),/Synthetic attachment read failure/);
  assert.equal(h.state.papers[id].pdfText,'Saved PDF excerpt.');assert.equal(h.state.approvedTaxonomyInput,'approved-source');assert.equal(h.counts().saves,0);
});

test('shutdown waits for an item batch but does not start a new automatic assignment',async()=>{
  const h=fixture(),read=h.env.host.read;h.state.settings.autoAssign=true;h.papers.get(1)!.title+=' Updated';let finishRead:(()=>void)|undefined;
  h.env.host.read=async itemID=>{await new Promise<void>(resolve=>{finishRead=resolve;});return read(itemID);};
  const pending=h.app.onItemChanged(1);await Promise.resolve();await Promise.resolve();assert.ok(finishRead);
  const shutdown=h.app.shutdown();finishRead!();await pending;await shutdown;
  assert.equal(h.state.run,null);assert.deepEqual(h.state.deferredItemIDs,[1]);assert.equal(h.state.papers['1:PAPER1'].title.endsWith(' Updated'),true);
});

test('an unchanged notification retries a failed save of manual rejection changes',async()=>{
  const h=fixture(),id='1:PAPER1';h.native.set(1,[]);let saves=0,persisted=false;
  h.env.persist=async state=>{if(++saves===1)throw new Error('Synthetic state write failure');persisted=state.decisions[`${id}|fc`]?.rejected===true;};
  await assert.rejects(h.app.onItemChanged(1),/Synthetic state write failure/);assert.equal(h.state.decisions[`${id}|fc`].rejected,true);
  await h.app.onItemChanged(1);assert.equal(saves,2);assert.equal(persisted,true);
  await h.app.onItemChanged(1);assert.equal(saves,2);
});

test('a preceding worker save cannot clear a failed notification save retry',async()=>{
  const h=fixture();let writes=0,release:(()=>void)|undefined;
  const first=new Promise<void>(resolve=>{release=resolve;});
  h.env.persist=async()=>{const write=++writes;if(write===1)await first;else if(write===2){await first;throw new Error('Synthetic queued write failure');}};
  const workerSave=h.app.save();h.native.set(1,[]);const notification=h.app.onItemChanged(1);
  await Promise.resolve();await Promise.resolve();release!();await workerSave;
  await assert.rejects(notification,/Synthetic queued write failure/);
  await h.app.onItemChanged(1);assert.equal(writes,3);assert.equal(h.state.decisions['1:PAPER1|fc'].rejected,true);
});
