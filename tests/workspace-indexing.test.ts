import test from 'node:test';
import assert from 'node:assert/strict';
import {indexNativeLibrary} from '../src/workspace/indexing.ts';
import type {NativeItemIdentity,NativeIndexPort,IndexedNativeRecord} from '../src/workspace/indexing.ts';

function fixture(count=105){
  const identities=Array.from({length:count},(_,index)=>({itemID:index+1,paperId:'1:P'+(index+1),version:'v1'}));
  const records=new Map<string,IndexedNativeRecord>(identities.map(item=>[item.paperId,{id:item.paperId,nativeItemId:item.itemID,nativeVersion:item.version}]));
  const ingested:NativeItemIdentity[][]=[],removed:string[][]=[];let nativeReads=0,lookups=0,yields=0;
  const port:NativeIndexPort={
    async page(cursor){const offset=Number(cursor??0);nativeReads++;return {items:identities.slice(offset,offset+50),total:identities.length,...(offset+50<identities.length?{cursor:String(offset+50)}:{})};},
    async lookup(itemID){lookups++;return [...records.values()].find(row=>row.nativeItemId===itemID);},
    async ingestBatch(items){assert.ok(items.length<=10);ingested.push([...items]);for(const item of items)records.set(item.paperId,{id:item.paperId,nativeItemId:item.itemID,nativeVersion:item.version});},
    async indexedPage(after){const rows=[...records.values()].filter(row=>!after||row.id>after).sort((a,b)=>a.id.localeCompare(b.id));return {rows:rows.slice(0,50),...(rows.length>50?{next:rows[49].id}:{})};},
    async removeMissingIds(ids){assert.ok(ids.length<=50);removed.push([...ids]);for(const id of ids)records.delete(id);},
  };
  return {port,identities,records,ingested,removed,options:{clock:()=>++yields,yieldControl:async()=>{yields++;}},get nativeReads(){return nativeReads;},get lookups(){return lookups;},get yields(){return yields;}};
}

test('startup indexes fresh papers and changed versions once in bounded batches, without decoding known sources',async()=>{
  const f=fixture();f.records.delete('1:P1');f.records.get('1:P2')!.nativeVersion='old';f.records.set('obsolete',{id:'obsolete',nativeItemId:999,nativeVersion:'old'});
  const progress=await indexNativeLibrary(f.port,f.options);
  assert.deepEqual(progress,{phase:'completed',checked:105,changed:2,removed:1,total:105});
  assert.deepEqual(f.ingested.flat().map(item=>item.itemID),[1,2]);assert.deepEqual(f.removed,[['obsolete']]);assert.equal(f.nativeReads,3);assert.equal(f.lookups,105);assert.ok(f.yields>26);
  f.ingested.length=0;f.removed.length=0;const repeated=await indexNativeLibrary(f.port,f.options);assert.equal(repeated.changed,0);assert.equal(repeated.removed,0);assert.deepEqual(f.ingested,[]);
});

test('a cancelled or failed identity scan never removes unread papers',async()=>{
  for(const failure of ['cancel','read'] as const){
    const f=fixture(),controller=new AbortController(),original=f.port.page;
    f.port.page=async cursor=>{if(cursor){if(failure==='cancel')controller.abort(new Error('Stopped'));else throw new Error('Native page failed');}return original(cursor);};
    await assert.rejects(indexNativeLibrary(f.port,{...f.options,signal:controller.signal}),failure==='cancel'?/Stopped/:/Native page failed/);
    assert.deepEqual(f.removed,[]);assert.equal(f.records.size,105);
  }
});

test('reconciliation only removes absent native identities and retains records lacking a native mapping',async()=>{
  const f=fixture(2);f.records.set('proof-only',{id:'proof-only'});f.records.set('deleted',{id:'deleted',nativeItemId:500});
  const events:string[]=[];const page=f.port.page,remove=f.port.removeMissingIds;
  f.port.page=async cursor=>{events.push('native');return page(cursor);};f.port.removeMissingIds=async ids=>{events.push('remove');await remove(ids);};
  await indexNativeLibrary(f.port,f.options);assert.deepEqual(events,['native','remove']);assert.ok(f.records.has('proof-only'));assert.ok(f.records.has('1:P1'));assert.equal(f.records.has('deleted'),false);
});

test('a reused native numeric identity cannot retain the previous source key',async()=>{
  const f=fixture(1);f.records.clear();f.records.set('1:PREVIOUS',{id:'1:PREVIOUS',nativeItemId:1,nativeVersion:'v1'});
  await indexNativeLibrary(f.port,f.options);assert.deepEqual(f.ingested.flat().map(row=>row.paperId),['1:P1']);assert.deepEqual(f.removed,[['1:PREVIOUS']]);assert.ok(f.records.has('1:P1'));
});

test('native reconciliation reports actual removals when revalidation preserves a concurrently added source',async()=>{
  const f=fixture(1);f.records.set('1:NEW',{id:'1:NEW',nativeItemId:2,nativeVersion:'new'});f.port.removeMissingIds=async()=>0;
  const progress=await indexNativeLibrary(f.port,f.options);assert.equal(progress.removed,0);assert.ok(f.records.has('1:NEW'));
});

test('ten thousand papers keep native frames at fifty and hydration at ten',async()=>{
  const f=fixture(10_000);f.records.clear();const progress=await indexNativeLibrary(f.port,f.options);
  assert.equal(progress.checked,10_000);assert.equal(progress.changed,10_000);assert.equal(f.nativeReads,200);assert.equal(f.ingested.length,1000);assert.ok(f.ingested.every(batch=>batch.length===10));assert.equal(f.records.size,10_000);
});

test('duplicate identities and cyclic cursors fail before reconciliation',async()=>{
  const f=fixture(51);f.port.page=async()=>({items:[f.identities[0]],total:51,cursor:'same'});
  await assert.rejects(indexNativeLibrary(f.port,f.options),/repeated identity|repeated page cursor/);assert.deepEqual(f.removed,[]);
});
