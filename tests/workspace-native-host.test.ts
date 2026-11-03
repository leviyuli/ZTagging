import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceHost,normalizeNativePaper} from '../src/workspace/native-host.ts';
import type {NativePaperTransport} from '../src/workspace/native-host.ts';
import {paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
import type {ZoteroHost,TagPatch} from '../src/platform.ts';

function fixture(options:{count?:number;abstract?:string;keywords?:string[]}={}){
  let now=0,yields=0,sequence=0,attachmentTextReads=0;const writes:string[]=[],acks:string[]=[];
  const item={id:1,libraryID:1,key:'PAPER001',deleted:false,isRegularItem:()=>true,getField:(name:string)=>name==='title'?'<i>Title &amp; result</i>':name==='abstractNote'?options.abstract??'<p>A source.</p>':'',getTags:()=>[...(options.keywords??['battery']).map(tag=>({tag,type:1})),{tag:'manual',type:0}],getAttachments:()=>[90]};
  const attachment={id:90,deleted:false,attachmentContentType:'application/pdf',isFileAttachment:()=>true,fileExists:async()=>true,get attachmentText(){attachmentTextReads++;throw new Error('Full PDF text must stay off the native UI thread.');}};
  const zotero={Libraries:{userLibraryID:1},getActiveZoteroPane:()=>({getSelectedItems:()=>Array.from({length:options.count??105},(_,index)=>({id:index+1,libraryID:1})),getSelectedCollections:()=>[]}),Items:{getAsync:async(id:number)=>id===90?attachment:item},Fulltext:{getItemCacheFile:()=>({path:'isolated-cache.txt'}),indexItems:async()=>{}},DB:{valueQueryAsync:async()=>100,columnQueryAsync:async()=>[]}};
  const native={async apply(patches:TagPatch[]){writes.push('tags:'+patches.length);},async applyMetadata(patches:unknown[]){writes.push('metadata:'+patches.length);}} as unknown as ZoteroHost;
  const host=new WorkspaceHost({host:native,zotero,exists:async()=>true,clock:()=>now++,yield:async()=>{yields++;},randomId:()=>String(++sequence)});
  return {host,item,zotero,writes,acks,get yields(){return yields;},get attachmentTextReads(){return attachmentTextReads;}};
}
async function consume(host:WorkspaceHost,wire:NativePaperTransport):Promise<PaperRecord>{
  const {paper,lease,fields}=wire;if(!lease)return normalizeNativePaper(paper);
  try{
    for(const field of ['title','abstract'] as const)if(fields?.[field]){const chunks:string[]=[];for(let offset=0;offset<fields[field]!;offset+=8192)chunks.push(await host.paperField(lease,field,offset));paper[field]=chunks.join('');}
    if(fields?.keywords){for(let index=0;index<fields.keywords;index++){const chunks:string[]=[];for(let offset=0;;offset+=8192){const part=await host.paperField(lease,'keyword:'+index,offset);chunks.push(part);if(part.length<8192)break;}paper.keywords.push(chunks.join(''));}}
    return normalizeNativePaper(paper);
  }finally{host.releasePaper(lease);}
}
const patch=(id:number):TagPatch=>({paperId:'1:p'+id,itemID:id,before:[],after:[{tag:'FC',type:1}]});

test('native selections page fifty identities, yield and reject stale or cancelled cursors',async()=>{
  const f=fixture(),first=await f.host.ids('selected');assert.equal(first.ids.length,50);assert.ok(first.cursor);assert.ok(f.yields>0);
  const second=await f.host.ids('selected',first.cursor);assert.equal(second.ids[0],51);await assert.rejects(f.host.ids('selected',first.cursor),/expired/);
  const third=await f.host.ids('selected',second.cursor);assert.deepEqual(third.ids,[101,102,103,104,105]);assert.equal(third.cursor,undefined);
  f.host.stop();await assert.rejects(f.host.ids('selected'),/stopping/);
});

test('large paper fields transfer bounded slices and retain the exact normalized fingerprint',async()=>{
  const raw='<p>'+('Scientific &amp; exact \ud800 text. '.repeat(5000))+'</p>',keywords=['a'.repeat(18000),'b'.repeat(17000)],f=fixture({abstract:raw,keywords}),wire=await f.host.read(1);
  assert.ok(wire?.lease);assert.equal(wire.paper.abstract,'');assert.deepEqual(wire.paper.keywords,[]);assert.equal(wire.fields!.abstract,raw.length);assert.equal(wire.fields!.keywords,undefined);assert.ok(JSON.stringify(wire).length<17000);assert.equal(wire.paper.fingerprint,'');
  await assert.rejects(f.host.paperField(wire.lease!,'abstract',0,8193),/bounded/);const restored=await consume(f.host,wire);
  assert.equal(restored.title,'Title & result');assert.equal(restored.abstract,raw.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim());assert.deepEqual(restored.keywords,[]);assert.equal(restored.fingerprint,paperFingerprint(restored));
  await assert.rejects(f.host.paperField(wire.lease!,'abstract',0),/expired/);assert.equal(f.attachmentTextReads,0);
});

test('at most two unfinished paper transfers are retained and stop releases them',async()=>{
  const f=fixture({abstract:'x'.repeat(30000)}),first=(await f.host.read(1))!,second=(await f.host.read(1))!;await assert.rejects(f.host.read(1),/Two paper transfers/);
  f.host.releasePaper(first.lease!);assert.ok((await f.host.read(1))!.lease);f.host.stop();await assert.rejects(f.host.paperField(second.lease!,'abstract',0),/stopping/);
});

test('PDF inspection returns cache paths and never accesses full attachment text',async()=>{
  const f=fixture(),sources=await f.host.inputSources(1,true);assert.deepEqual(sources.cachePaths,['isolated-cache.txt']);assert.equal(sources.pdf.characters,0);assert.equal(sources.pdf.rechecked,true);assert.equal(await f.host.pdfSource(1),'isolated-cache.txt');assert.equal(f.attachmentTextReads,0);
  f.item.deleted=true;assert.equal(await f.host.read(1),null);assert.equal(await f.host.pdfSource(1),null);await assert.rejects(f.host.inputSources(1),/unavailable/);
});

test('native writes enforce twenty-paper frames and acknowledge only successful changes',async()=>{
  const f=fixture();await assert.rejects(f.host.apply(Array.from({length:21},(_,index)=>patch(index)),'tags'),/twenty/);assert.deepEqual(f.writes,[]);
  await f.host.apply([patch(1),patch(2)],'tags',async offset=>{f.acks.push('tags:'+offset);assert.deepEqual(f.writes,['tags:2']);});assert.deepEqual(f.acks,['tags:2']);
  await assert.rejects(f.host.apply([patch(1),patch(1)],'tags'),/same paper/);
  const failed=fixture();failed.host.host.apply=async()=>{throw new Error('Native transaction rolled back.');};await assert.rejects(failed.host.apply([patch(1)],'tags',async()=>{failed.acks.push('bad');}),/rolled back/);assert.deepEqual(failed.acks,[]);
  const blocked=fixture();blocked.host.stop();await assert.rejects(blocked.host.apply([patch(1)],'tags'),/stopping/);assert.deepEqual(blocked.writes,[]);
});


test('library indexing pages native identities and modification versions without reading paper bodies',async()=>{
  const f=fixture(),queries:{sql:string;params:unknown[]}[]=[],types={note:1,attachment:2,annotation:3};let bodyReads=0;
  const rows=Array.from({length:105},(_,index)=>({itemID:index+1,key:'PAPER'+(index+1),dateModified:'2026-11-01 10:00:00',clientDateModified:'2026-11-02 10:00:00',version:1,clientVersion:2}));
  Object.assign(f.zotero,{ItemTypes:{getID:(name:keyof typeof types)=>types[name]}});
  f.zotero.Items.getAsync=async()=>{bodyReads++;throw new Error('Identity indexing must not hydrate items');};
  Object.assign(f.zotero.DB,{queryAsync:async(sql:string,params:unknown[])=>{queries.push({sql,params});if(sql.startsWith('SELECT MAX'))return [{maximum:105,total:105}];const offset=Number(params[4]);return rows.filter(row=>row.itemID>offset).slice(0,50);}});
  const first=await f.host.libraryPage();assert.equal(first.items.length,50);assert.equal(first.total,105);assert.ok(first.cursor);assert.deepEqual(first.items[0],{itemID:1,paperId:'1:PAPER1',version:JSON.stringify(['PAPER1','2026-11-01 10:00:00','2026-11-02 10:00:00',1,2])});
  const second=await f.host.libraryPage(first.cursor);await assert.rejects(f.host.libraryPage(first.cursor),/expired/);
  const third=await f.host.libraryPage(second.cursor);assert.equal(third.items.length,5);assert.equal(third.cursor,undefined);assert.equal(bodyReads,0);assert.ok(f.yields>0);
  assert.equal(queries.length,4);for(const query of queries){assert.match(query.sql,/i\.itemTypeID NOT IN/);assert.match(query.sql,/NOT EXISTS \(SELECT 1 FROM deletedItems/);assert.deepEqual(query.params.slice(0,4),[1,1,2,3]);assert.match(query.sql,/^(SELECT MAX|SELECT i\.itemID)/);}
  f.host.stop();await assert.rejects(f.host.libraryPage(),/stopping/);
});
