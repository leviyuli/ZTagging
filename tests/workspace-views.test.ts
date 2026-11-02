import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceStore} from '../src/workspace/storage.ts';
import {buildView} from '../src/workspace/views.ts';
import {memorySql} from './workspace-storage-adapter.ts';
import type {StoreOperation} from '../src/workspace/storage.ts';
import type {TagDefinition} from '../src/core.ts';

const tag=(id:string,name=id):TagDefinition=>({id,name,description:'A saved scientific meaning.',facet:'system',aliases:[],broaderIds:[],relatedIds:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',matchingMode:'auto'});

test('Settings reads small records and stored counters without decoding paper or history bodies',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);
  await store.put('state','settings',{provider:'deepseek',model:'model',autoAssign:false,budgetUSD:3,inputPricePerMillion:1,outputPricePerMillion:1,maxOutputTokens:8192});
  await store.put('papers','p',{id:'p',title:'A paper',abstract:'A long source. '.repeat(10000)});await store.put('history','h',{old:'Historical body. '.repeat(10000)},{category:'history'});
  const protectedRefs=new Set([(await store.reference('papers','p'))!.token,(await store.reference('history','h'))!.token].flatMap(token=>'ref' in token?[token.ref]:[]));
  const read=store.codec.read.bind(store.codec);store.codec.read=async(token,options)=>{assert.ok(!('ref' in token)||!protectedRefs.has(token.ref),'Settings must never decode these bodies');return read(token,options);};
  const event=await buildView(store,{page:'settings'},{pluginVersion:'test',connection:async()=>({apiKeyStored:false,chatgptSignedIn:false,deepseekKeyStored:true})});
  assert.equal(event.model!.settings.model,'model');assert.equal(event.model!.totals!.papers,1);assert.equal(event.model!.papers.length,0);assert.equal(event.model!.history.length,0);assert.equal(event.model!.storage!.retentionDays,7);await store.close();
});

test('Find papers filters and pages in SQLite before decoding at most fifty results',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),operations:StoreOperation[]=[];
  for(let index=0;index<120;index++){const id='p'+String(index).padStart(3,'0'),title=(index<100?'Needle ':'Other ')+id;operations.push({kind:'put',collection:'papers',id,value:{id,title,abstract:'Verifiable paper text. '.repeat(500)},metadata:{title,searchText:title+' additional searchable abstract'}});}
  await store.commit({commandId:'papers',operations});let decoded=0;const read=store.codec.read.bind(store.codec),paperRefs=new Set((await store.scan('papers',{offset:50,limit:50,search:'Needle',orderBy:'title'})).rows.map(record=>'ref' in record.token?record.token.ref:''));
  store.codec.read=async(token,options)=>{if('ref' in token&&paperRefs.has(token.ref))decoded++;return read(token,options);};
  const event=await buildView(store,{page:'library',cursor:'50',limit:500,params:{paperQuery:'Needle'}});
  assert.equal(event.total,100);assert.equal(event.model!.papers.length,50);assert.equal(decoded,0);assert.equal(event.model!.papers[0].id,'p050');assert.equal(event.nextCursor,undefined);assert.ok(Buffer.byteLength(JSON.stringify(event))<=256*1024);await store.close();
});

test('grounded All/Any and context filters include is-a descendants without inheriting related meanings',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);
  await store.put('tags','fc',tag('fc'));await store.put('tags','pemfc',tag('pemfc'),{refs:[{collection:'tags',id:'fc',relation:'broader'}]});await store.put('tags','related',tag('related'),{refs:[{collection:'tags',id:'fc',relation:'related'}]});await store.put('tags','eis',tag('eis'));
  await store.put('papers','verified',{id:'verified',title:'Verified subtype'},{title:'Verified subtype',refs:[{collection:'tags',id:'pemfc',relation:'matches'},{collection:'tags',id:'eis',relation:'matches'}]});
  await store.put('papers','unverified',{id:'unverified',title:'Unverified old native FC'},{title:'Unverified old native FC'});await store.put('nativeTags','unverified',[{tag:'fc',type:0}]);
  await store.put('papers','related',{id:'related',title:'Related meaning only'},{title:'Related meaning only',refs:[{collection:'tags',id:'related',relation:'matches'}]});
  const query=(mode:'all'|'any',selections:{conceptId:string;contextId?:string}[])=>buildView(store,{page:'library',params:{conceptFilter:{mode,selections}}});
  assert.deepEqual((await query('all',[{conceptId:'fc'}])).model!.papers.map(p=>p.id),['verified']);
  assert.equal((await query('all',[{conceptId:'fc',contextId:'eis'}])).total,1);
  assert.equal((await query('all',[{conceptId:'fc'},{conceptId:'related'}])).total,0);
  assert.equal((await query('any',[{conceptId:'fc'},{conceptId:'related'}])).total,2);await store.close();
});

test('Tag library uses unified entries and separate detail records for editing outside the visible page',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);
  await store.put('tags','a',tag('a','Batteries'));await store.put('tags','z',tag('z','Fuel cells'));
  await store.put('libraryTags','a',{name:'Batteries',tagId:'a',paperCount:3},{title:'Batteries',status:'ready',count:3});await store.put('libraryTags','undefined',{name:'Important',paperCount:2},{title:'Important',status:'undefined',count:2});
  const event=await buildView(store,{page:'vocabulary',limit:1,params:{libraryTagStatus:'ready',editorTagId:'z'}});
  assert.equal(event.total,1);assert.equal(event.model!.tagLibraryEntries![0].name,'Batteries');assert.equal(event.model!.tags[0].id,'a');assert.equal(event.model!.detailTags![0].id,'z');await store.close();
});

test('hidden Activity History never decodes archived body and cancellation stops a stale view',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);await store.put('history','large',{body:'Saved raw reply. '.repeat(10000)},{category:'history',title:'Previous run'});
  const controller=new AbortController(),read=store.codec.read.bind(store.codec),token=(await store.reference('history','large'))!.token;
  store.codec.read=async(value,options)=>{assert.ok(!('ref' in token)||!('ref' in value)||value.ref!==token.ref);return read(value,options);};
  const hidden=await buildView(store,{page:'activity',params:{activityHistoryOpen:false}});assert.equal(hidden.model!.history.length,0);
  const shown=await buildView(store,{page:'activity',params:{activityHistoryOpen:true}});assert.equal(shown.model!.history.length,1);
  controller.abort(new Error('Stale page'));await assert.rejects(buildView(store,{page:'library'},{signal:controller.signal}),/Stale page/);await store.close();
});

test('paper previews never hydrate a large PDF, abstract, or complete paper graph',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),abstract='A long scientific abstract. '.repeat(20000),pdf='PDF evidence must be loaded on demand. '.repeat(50000);
  await store.put('papers','large',{id:'large',title:'A long source',abstract,pdfText:pdf,keywords:['battery'],summary:'Summary'},{title:'A long source'});
  const root=(await store.reference('papers','large'))!.token,pdfToken=await store.codec.lookup(root,['pdfText']),read=store.codec.read.bind(store.codec);
  store.codec.read=async(token,options)=>{assert.notDeepEqual(token,root);assert.notDeepEqual(token,pdfToken);return read(token,options);};
  const event=await buildView(store,{page:'library'});assert.equal(event.model!.papers[0].abstract,abstract.slice(0,160));assert.equal(event.model!.papers[0].evidenceStatus,'Metadata and selected PDF passages');assert.ok(Buffer.byteLength(JSON.stringify(event))<10000);await store.close();
});

test('Activity projects recovery rows and unknown outcomes without loading paid scopes or history bodies',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),operations:StoreOperation[]=[];
  for(let index=0;index<80;index++){const id='p'+String(index).padStart(3,'0');operations.push({kind:'put',collection:'paperAttentionRows',id,value:{id,title:'Paper '+id,status:'failed',message:'The last analysis failed.',phase:'facts',canLookupMetadata:true,canRecheck:true,canRetry:true,canSkip:false},metadata:{title:'Paper '+id,status:'failed'}});}
  operations.push({kind:'put',collection:'viewHeaders',id:'paperAttention',value:{queued:3}});await store.commitRecords(operations);
  await store.put('viewHeaders','metadataPreview',{id:'preview',paperId:'p030',itemID:30,status:'ready',message:'Missing title found.',changes:[{field:'title',before:'',after:'A verified source title'}]});
  await store.put('providerDispatches','unknown',{status:'unknown',provider:'api',model:'example',dispatchedAt:42,error:'The outcome is unknown.'},{category:'ledger',status:'unknown'});await store.put('providerDispatches','stopped',{status:'stopped'},{category:'ledger',status:'stopped'});await store.put('providerDispatches','replied',{status:'replied'},{category:'ledger',status:'completed'});
  await store.put('providerScopes','unknown',{prompt:'Private paid request. '.repeat(10000)},{category:'cache'});const forbidden=(await store.reference('providerScopes','unknown'))!.token,read=store.codec.read.bind(store.codec);store.codec.read=async(token,options)=>{assert.notDeepEqual(token,forbidden);return read(token,options);};
  const event=await buildView(store,{page:'activity',params:{attentionPage:1,attentionFilter:'attention'}});assert.equal(event.model!.paperAttention!.total,80);assert.equal(event.model!.paperAttention!.papers.length,25);assert.equal(event.model!.paperAttention!.papers[0].id,'p025');assert.equal(event.model!.metadataPreview!.id,'preview');assert.equal(event.model!.recoveryRequests!.length,2);assert.ok(!JSON.stringify(event).includes('Private paid request'));assert.ok(Buffer.byteLength(JSON.stringify(event))<=256*1024);await store.close();
});

test('legacy tools page indexed groups independently of ten-row change previews',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),changes=Array.from({length:75},(_,index)=>({paperId:'p'+index,title:'Paper '+index,before:['legacy'],after:['FC']})),operations:StoreOperation[]=[];
  for(let index=0;index<85;index++){const id='g'+String(index).padStart(3,'0');operations.push({kind:'put',collection:'existingTagRows',id,value:{id,name:'Name '+id,status:'match',targetNames:['FC'],paperIds:[],manualCount:0,affectedCount:1,reason:'Exact matching source name.'},metadata:{taskId:'work',title:'Name '+id,status:'match'}});}
  operations.push({kind:'put',collection:'viewHeaders',id:'existingTags',value:{id:'work',applied:true,status:'ready',preview:{id:'preview',changes}}});await store.commitRecords(operations);
  const event=await buildView(store,{page:'existing-tags',params:{existingTagPage:1,existingPreviewPage:2,existingTagView:'compare'}});assert.equal(event.model!.existingTags!.rows.length,30);assert.equal(event.model!.existingTags!.rows[0].id,'g030');assert.equal(event.model!.existingTags!.total,85);assert.equal(event.model!.existingTags!.preview!.changes.length,10);assert.equal(event.model!.existingTags!.preview!.changes[0].paperId,'p20');assert.equal(event.model!.existingTags!.preview!.total,75);await store.close();
});

test('related papers are computed on expansion and returned as ten bounded details',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port);
  for(const [id,text] of [['a','Fuel cell proton membrane catalyst'],['b','Fuel cell proton membrane electrode'],['c','Mars orbit planetary science']])await store.put('papers',id,{id,title:text,abstract:text,keywords:[],summary:'',concepts:[],fingerprint:id},{title:text,searchText:text});
  const plain=await buildView(store,{page:'library',limit:1});assert.deepEqual(plain.model!.neighbors,{});
  const expanded=await buildView(store,{page:'library',limit:1,params:{selectedPaper:'a'}});assert.equal(expanded.model!.neighbors.a[0].paperId,'b');assert.ok(expanded.model!.detailPapers!.some(paper=>paper.id==='b'));assert.ok(expanded.model!.neighbors.a.length<=10);await store.close();
});

test('one large meaning projects bounded source rows and exact decision flags without decoding its proof map',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),paperIds=Array.from({length:1500},(_,index)=>'paper-'+String(index).padStart(4,'0')),judgment={relation:'uncertain',reason:'More context would help.',evidence:[{source:'abstract',text:'Private evidence. '.repeat(20000)}],supportFactConceptIds:[],sourceFingerprint:'source',definitionFingerprint:'meaning'},entry={id:'entry',tagId:'tag',sourceName:'FC',status:'question',definition:tag('tag','FC'),paperIds,judgments:Object.fromEntries(paperIds.map(id=>[id,judgment])),humanAnswer:{sourceFingerprints:Object.fromEntries(paperIds.map(id=>[id,'fingerprint']))}};
  await store.put('nativeMeaningEntries','entry',entry,{taskId:'work'});await store.put('viewHeaders','nativeDefinitionPreparation',{id:'work',status:'ready',total:1,completed:1,canApply:false});
  await store.put('nativeMeaningDisplays','entry',{id:'entry',sourceName:'FC',paperIds,status:'question',name:'FC',description:'Fuel cells.',questionKind:'protection',canUseProposedMeaning:false,canSetTreatment:true,canConfirmClear:false,sourceIssues:paperIds.map(paperId=>({paperId,status:'uncertain',reason:'More context would help.'}))},{taskId:'work'});
  const source=(await store.reference('nativeMeaningEntries','entry'))!.token,display=(await store.reference('nativeMeaningDisplays','entry'))!.token,proof=await store.codec.lookup(source,['judgments']),answer=await store.codec.lookup(source,['humanAnswer']),forbidden=[source,display,proof,answer],read=store.codec.read.bind(store.codec);
  store.codec.read=async(token,options)=>{for(const value of forbidden)assert.notDeepEqual(token,value);return read(token,options);};
  const event=await buildView(store,{page:'vocabulary',limit:10,params:{nativeMeaningReviewHidden:false}}),row=event.model!.nativeDefinitionPreparation!.rows[0];assert.equal(row.paperIds.length,50);assert.equal((row as typeof row&{paperCount:number}).paperCount,1500);assert.equal(row.sourceIssues!.length,50);assert.equal(row.canUseProposedMeaning,false);assert.equal(row.canSetTreatment,true);assert.equal(row.questionKind,'protection');assert.ok(Buffer.byteLength(JSON.stringify(event))<=256*1024);
  await store.delete('nativeMeaningDisplays','entry');const fallback=await buildView(store,{page:'vocabulary',limit:10,params:{nativeMeaningReviewHidden:false}});assert.equal(fallback.model!.nativeDefinitionPreparation!.rows[0].status,'question');assert.equal(fallback.model!.nativeDefinitionPreparation!.rows[0].paperIds.length,50);await store.close();
});

test('task Undo checks referenced history metadata and disables expired or collected details',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),now=2_000_000_000_000;
  await store.put('viewHeaders','tagPreparation',{id:'build',lastChangeId:'recent',status:'ready',canApply:false,tags:[],questions:[],scopeCount:1,targetCount:1});await store.put('history','recent',{privateBody:'Never read a task Undo body merely to show its button.'},{category:'history',status:'applied',completedAt:now-100,title:'Saved definitions'});
  const token=(await store.reference('history','recent'))!.token,read=store.codec.read.bind(store.codec);store.codec.read=async(value,options)=>{assert.notDeepEqual(value,token);return read(value,options);};
  const recent=await buildView(store,{page:'cleanup'},{clock:()=>now});assert.equal(recent.model!.history.find(change=>change.id==='recent')!.canUndo,true);
  const old=await buildView(store,{page:'cleanup'},{clock:()=>now+8*86400000});assert.equal(old.model!.history.find(change=>change.id==='recent')!.canUndo,false);
  await store.delete('history','recent');const removed=await buildView(store,{page:'cleanup'},{clock:()=>now});assert.equal(removed.model!.history.find(change=>change.id==='recent')!.canUndo,false);await store.close();
});

test('Open meaning loads the exact current-work choice beyond the first fifty rows',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),operations:StoreOperation[]=[];
  for(let index=0;index<75;index++){const id='entry-'+String(index).padStart(3,'0');operations.push({kind:'put',collection:'nativeMeaningEntries',id,value:{id,sourceName:id,status:'question',definition:tag(id),paperIds:[]},metadata:{taskId:'work',order:index}});}
  await store.commitRecords(operations);await store.put('viewHeaders','nativeDefinitionPreparation',{id:'work',status:'ready',total:75,completed:75,canApply:false});
  const query={page:'vocabulary' as const,limit:20,params:{nativeMeaningReviewHidden:false,nativeReviewTarget:{workId:'work',entryId:'entry-074'}}};
  const event=await buildView(store,query);assert.equal(event.total,75);assert.equal(event.model!.nativeDefinitionPreparation!.rows.length,20);assert.equal(event.model!.detailNativeMeaningRows![0].id,'entry-074');assert.equal(event.nextCursor,'20');
  const stale=await buildView(store,{...query,params:{...query.params,nativeReviewTarget:{workId:'old-work',entryId:'entry-074'}}});assert.equal(stale.model!.detailNativeMeaningRows,undefined);await store.close();
});
