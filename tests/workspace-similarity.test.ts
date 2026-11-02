import test from 'node:test';
import assert from 'node:assert/strict';
import {SimilarityIndex} from '../src/workspace/similarity.ts';
import {WorkspaceStore} from '../src/workspace/storage.ts';
import {memorySql} from './workspace-storage-adapter.ts';
import {buildSimilarityNetwork,paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
function paper(id:string,title:string,abstract:string):PaperRecord{const item={id,title,abstract,keywords:[],summary:'',concepts:[],itemID:1,libraryID:1,key:id,fingerprint:''};item.fingerprint=paperFingerprint(item);return item;}
test('related-paper retrieval retains exact small-library scientific token weighting',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),index=new SimilarityIndex(store);
  const papers=[paper('a','CO oxidation catalysts','CO oxidation on platinum.'),paper('b','CO oxidation studies','Platinum catalyses CO oxidation.'),paper('c','Co metal spectroscopy','Co metal spectroscopy differs from CO oxidation.'),paper('d','Membrane transport','Membrane water diffusion and ionic conductivity.')];
  for(const value of papers)await store.put('papers',value.id,value,{title:value.title,searchText:value.title+' '+value.abstract});
  await index.update(papers);const expected=buildSimilarityNetwork(papers);for(const value of papers)assert.deepEqual(await index.neighbors(value.id),expected[value.id]);
  const before=await store.stats();await index.update(papers);assert.deepEqual(await store.stats(),before,'Unchanged inputs must not allocate another vector or revision');await store.close();
});
test('large-library related reading bounds candidates and cancellation without reading PDF bodies',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),index=new SimilarityIndex(store);
  for(let n=0;n<135;n++){const value=paper('p'+n,n<10?'Catalyst layers and proton transport':'Unrelated semiconductor spectra '+n,n<10?'Proton transport through catalyst layers.':'Semiconductor photoluminescence spectra.');await store.put('papers',value.id,{...value,pdfText:'Large unrelated PDF body. '.repeat(1000)},{title:value.title,searchText:value.title+' '+value.abstract});}
  const refs=new Set((await store.scan('papers',{limit:50})).rows.map(row=>'ref' in row.token?row.token.ref:''));const read=store.codec.read.bind(store.codec);store.codec.read=async(token,options)=>{assert.ok(!('ref' in token)||!refs.has(token.ref),'Related reading must read scientific fields, not complete PDF-bearing papers');return read(token,options);};
  const neighbors=await index.neighbors('p0');assert.ok(neighbors.length>0&&neighbors.length<=10);assert.ok(neighbors.every(value=>Number(value.paperId.slice(1))<10));
  const abort=new AbortController();abort.abort(new Error('Cancelled related reading'));await assert.rejects(()=>index.neighbors('p0',{signal:abort.signal}),/Cancelled/);await store.close();
});
