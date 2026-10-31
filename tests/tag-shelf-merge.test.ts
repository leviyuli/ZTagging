import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import type {TagDefinition} from '../src/core.ts';
import type {NativeTag} from '../src/platform.ts';
import {ALL_TAG_SHELVES_ID,EXISTING_TAG_SHELF_ID,MY_TAGS_SHELF_ID,previewTagShelfMerge,applyTagShelfMerge,validTagShelfMergePreview,validTagShelves,resolveTagShelfId,selectTagShelfDefinitions,libraryTagShelfEntries} from '../src/tag-shelves.ts';
import type {TagShelf,TagShelfMergeRequest} from '../src/tag-shelves.ts';

const tag=(id:string,name=id,extra:Partial<TagDefinition>={}):TagDefinition=>({id,name,fullName:name,description:`The scientific meaning of ${name}.`,facet:'component',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],custom:false,status:'approved',matchingMode:'suggest',...extra});
function fixture(){
  const definitions=[tag('co','Co',{fullName:'cobalt'}),tag('CO','CO',{fullName:'carbon monoxide'}),tag('aem','AEM'),tag('eis','EIS',{fullName:'electrochemical impedance spectroscopy',aliases:['impedance method'],facet:'method'}),tag('marker','My marker',{matchingMode:'manual'})];
  const shelves:TagShelf[]=[{id:'generated-one',name:'Generated tags 1',kind:'generated',tagIds:['co','aem','historical-missing']},{id:'generated-two',name:'Generated tags 2',kind:'generated',tagIds:['aem','CO','eis']},{id:MY_TAGS_SHELF_ID,name:'My chosen topics',kind:'user',tagIds:['marker']}];
  const native:Record<string,NativeTag[]>={'paper-1':[{tag:'Co',type:0},{tag:' Native topic ',type:0},{tag:'no_tag',type:0}],'paper-2':[{tag:'impedance method',type:1},{tag:' Native topic ',type:1},{tag:'A precise native label '.repeat(15),type:0}]};
  return {definitions,shelves,native};
}
const request=(extra:Partial<TagShelfMergeRequest>={}):TagShelfMergeRequest=>({shelfIds:['generated-one','generated-two'],name:'Combined studies',replaceSources:false,...extra});

test('previewing and applying a combined shelf deduplicates IDs and paper counts while keeping original shelves and scientific meanings',()=>{
  const f=fixture(),before=fingerprint(f),preview=previewTagShelfMerge(f.shelves,f.definitions,f.native,request(),'2026-10-31T00:00:00.000Z');
  assert.equal(validTagShelfMergePreview(preview),true);assert.equal(preview.total,4);assert.equal(preview.ready,4);assert.equal(preview.shared,1);assert.deepEqual(preview.sourceNames,['Generated tags 1','Generated tags 2']);assert.deepEqual(preview.removedShelfIds,[]);
  const output=applyTagShelfMerge(JSON.parse(JSON.stringify(preview)),f.shelves,f.definitions,f.native),combined=output.at(-1)!;
  assert.equal(output.length,4);assert.equal(combined.id,preview.targetId);assert.deepEqual(combined.tagIds,['co','aem','historical-missing','CO','eis']);assert.equal(combined.createdAt,'2026-10-31T00:00:00.000Z');assert.deepEqual(output.slice(0,3),f.shelves);assert.equal(validTagShelves(output),true);
  const selected=selectTagShelfDefinitions(f.definitions,output,combined.id,f.native);assert.deepEqual(selected.assignableIds,['co','CO','aem','eis']);assert.ok(!selected.allSaved);assert.equal(fingerprint(f),before);combined.tagIds.push('output-only');assert.ok(!preview.target.tagIds.includes('output-only'));
});

test('replacing generated shelves preserves My tags and redirects removed identities without changing captured tag scopes',()=>{
  const f=fixture(),captured={shelfId:'generated-one',tagIds:['co','aem']},before=fingerprint(captured),preview=previewTagShelfMerge(f.shelves,f.definitions,f.native,request({replaceSources:true})),output=applyTagShelfMerge(preview,f.shelves,f.definitions,f.native);
  assert.deepEqual(preview.removedShelfIds,['generated-one','generated-two']);assert.equal(output.length,2);assert.deepEqual(output.find(shelf=>shelf.id===MY_TAGS_SHELF_ID),f.shelves[2]);assert.equal(resolveTagShelfId(output,'generated-one'),preview.targetId);assert.equal(resolveTagShelfId(output,'generated-two'),preview.targetId);assert.equal(resolveTagShelfId(output,EXISTING_TAG_SHELF_ID),MY_TAGS_SHELF_ID);assert.equal(fingerprint(captured),before);
  const next=previewTagShelfMerge(output,f.definitions,f.native,{shelfIds:[preview.targetId,MY_TAGS_SHELF_ID],targetId:MY_TAGS_SHELF_ID,name:'Everything I use',replaceSources:true}),last=applyTagShelfMerge(next,output,f.definitions,f.native);
  assert.equal(last.length,1);assert.equal(last[0].id,MY_TAGS_SHELF_ID);assert.equal(resolveTagShelfId(last,'generated-one'),MY_TAGS_SHELF_ID);assert.equal(resolveTagShelfId(last,'generated-two'),MY_TAGS_SHELF_ID);assert.equal(resolveTagShelfId(last,preview.targetId),MY_TAGS_SHELF_ID);assert.equal(validTagShelves(JSON.parse(JSON.stringify(last))),true);
});

test('copying My tags captures undefined exact names and linked papers without deleting the protected native shelf or inventing definitions',()=>{
  const f=fixture(),before=fingerprint(f),preview=previewTagShelfMerge(f.shelves,f.definitions,f.native,request({shelfIds:[MY_TAGS_SHELF_ID,'generated-one'],replaceSources:false})),output=applyTagShelfMerge(preview,f.shelves,f.definitions,f.native),combined=output.find(shelf=>shelf.id===preview.targetId)!;
  assert.ok(output.some(shelf=>shelf.id===MY_TAGS_SHELF_ID));assert.deepEqual(new Set(preview.retainedSourceIds),new Set(['generated-one',MY_TAGS_SHELF_ID]));assert.ok(!preview.removedShelfIds.includes(MY_TAGS_SHELF_ID));assert.notEqual(combined.id,MY_TAGS_SHELF_ID);assert.ok(combined.nativeTagNames!.includes(' Native topic '));assert.ok(combined.nativeTagNames!.includes('A precise native label '.repeat(15)));assert.ok(combined.nativeTagNames!.includes('no_tag'));
  const rows=libraryTagShelfEntries(f.native,f.definitions,combined.tagIds,false,combined.nativeTagNames);assert.deepEqual(rows.find(row=>row.name===' Native topic ')!.paperIds,['paper-1','paper-2']);assert.equal(rows.find(row=>row.name===' Native topic ')!.paperCount,2);assert.equal(rows.find(row=>row.name==='no_tag')!.protected,true);assert.ok(!selectTagShelfDefinitions(f.definitions,output,combined.id,f.native).assignableIds.includes('no_tag'));assert.equal(fingerprint(f),before);
});

test('replacing selected shelves including My tags yields one renamed destination with the native inventory identity intact',()=>{
  const f=fixture(),before=fingerprint(f),preview=previewTagShelfMerge(f.shelves,f.definitions,f.native,request({shelfIds:[MY_TAGS_SHELF_ID,'generated-one','generated-two'],replaceSources:true})),output=applyTagShelfMerge(JSON.parse(JSON.stringify(preview)),f.shelves,f.definitions,f.native);
  assert.equal(preview.targetId,MY_TAGS_SHELF_ID);assert.equal(output.length,1);assert.equal(output[0].id,MY_TAGS_SHELF_ID);assert.equal(output[0].name,'Combined studies');assert.deepEqual(new Set(output[0].tagIds),new Set(['co','aem','historical-missing','CO','eis','marker']));assert.deepEqual(new Set(output[0].mergedFromIds),new Set(['generated-one','generated-two']));assert.deepEqual(preview.removedShelfIds,['generated-one','generated-two']);assert.equal(resolveTagShelfId(output,'generated-one'),MY_TAGS_SHELF_ID);assert.equal(resolveTagShelfId(output,EXISTING_TAG_SHELF_ID),MY_TAGS_SHELF_ID);assert.equal(validTagShelves(output),true);assert.equal(fingerprint(f),before);
  const later={...f.native,'paper-3':[{tag:'A later native-only topic',type:0}]};assert.ok(libraryTagShelfEntries(later,f.definitions,output[0].tagIds,true,output[0].nativeTagNames).some(row=>row.name==='A later native-only topic'&&!row.tagId));
  const explicit=previewTagShelfMerge(f.shelves,f.definitions,f.native,request({shelfIds:[MY_TAGS_SHELF_ID,'generated-one'],targetId:'generated-two',replaceSources:true})),other=applyTagShelfMerge(explicit,f.shelves,f.definitions,f.native);assert.equal(explicit.targetId,'generated-two');assert.equal(other.length,2);assert.equal(other.find(shelf=>shelf.id===MY_TAGS_SHELF_ID)!.name,'My chosen topics');
});

test('an explicit raw shelf member becomes ready only through one approved exact name or alias and survives a missing current assignment',()=>{
  const f=fixture(),preview=previewTagShelfMerge(f.shelves,f.definitions,f.native,request({shelfIds:[MY_TAGS_SHELF_ID,'generated-one']})),output=applyTagShelfMerge(preview,f.shelves,f.definitions,f.native),combined=output.find(shelf=>shelf.id===preview.targetId)!,defined=[...f.definitions,tag('new-topic','standard topic',{aliases:[' Native topic ']})];
  const rows=libraryTagShelfEntries({},defined,combined.tagIds,false,combined.nativeTagNames);assert.deepEqual(rows.find(row=>row.tagId==='new-topic'),{name:'standard topic',tagId:'new-topic',paperCount:0,paperIds:[]});assert.ok(!rows.some(row=>row.name===' Native topic '));assert.ok(selectTagShelfDefinitions(defined,output,combined.id,{}).assignableIds.includes('new-topic'));
  const ambiguous=[...defined,tag('other-topic','a distinct topic',{aliases:[' Native topic ']})];assert.ok(!selectTagShelfDefinitions(ambiguous,output,combined.id,{}).assignableIds.includes('new-topic'));assert.ok(libraryTagShelfEntries({},ambiguous,combined.tagIds,false,combined.nativeTagNames).some(row=>row.name===' Native topic '&&!row.tagId));assert.ok(!selectTagShelfDefinitions([...f.definitions,tag('draft',' Native topic ',{status:'draft'})],output,combined.id,{}).assignableIds.includes('draft'));
});

test('native, definition and shelf changes invalidate the complete merge preview before any new membership is returned',()=>{
  const f=fixture(),preview=previewTagShelfMerge(f.shelves,f.definitions,f.native,request());
  const renamed=structuredClone(f.shelves);renamed[0].name='A newer shelf name';assert.throws(()=>applyTagShelfMerge(preview,renamed,f.definitions,f.native),/contents changed/);
  const newPaper=structuredClone(f.native);newPaper['paper-3']=[{tag:'An unrelated newly encountered name',type:0}];assert.throws(()=>applyTagShelfMerge(preview,f.shelves,f.definitions,newPaper),/contents changed/);
  const newMeaning=structuredClone(f.definitions);newMeaning[0].description='A revised meaning.';assert.throws(()=>applyTagShelfMerge(preview,f.shelves,newMeaning,f.native),/contents changed/);
  const tampered=structuredClone(preview);tampered.target.tagIds.push('not-reviewed');assert.throws(()=>applyTagShelfMerge(tampered,f.shelves,f.definitions,f.native),/preview changed/);tampered.target.tagIds.pop();tampered.total++;assert.throws(()=>applyTagShelfMerge(tampered,f.shelves,f.definitions,f.native),/preview changed/);
});

test('merge choices validate distinct real shelves, destination names and historical redirect ownership',()=>{
  const f=fixture();for(const shelfIds of [[],['generated-one'],['generated-one','generated-one'],['generated-one','unknown'],[ALL_TAG_SHELVES_ID,'generated-one']])assert.throws(()=>previewTagShelfMerge(f.shelves,f.definitions,f.native,request({shelfIds})),/Choose|view|available/);
  assert.throws(()=>previewTagShelfMerge(f.shelves,f.definitions,f.native,request({name:'My chosen topics',replaceSources:true})),/already uses/);assert.throws(()=>previewTagShelfMerge(f.shelves,f.definitions,f.native,request({name:' '})),/1–80/);assert.throws(()=>previewTagShelfMerge(f.shelves,f.definitions,f.native,request({targetId:ALL_TAG_SHELVES_ID})),/view/);
  const reused=previewTagShelfMerge(f.shelves,f.definitions,f.native,request({name:'Generated tags 1',replaceSources:true}));assert.equal(reused.name,'Generated tags 1');assert.notEqual(reused.targetId,'generated-one');
  for(const changed of [{...f.shelves[0],nativeTagNames:['same','same']},{...f.shelves[0],mergedFromIds:['generated-two']},{...f.shelves[0],mergedFromIds:[MY_TAGS_SHELF_ID]}])assert.equal(validTagShelves([changed,...f.shelves.slice(1)]),false);
  for(const bad of [{...reused,ready:reused.total+1},{...reused,shared:-1},{...reused,shelfIds:[]},{...reused,shelfIds:['generated-one','generated-one']},{...reused,sourceNames:[]},{...reused,removedShelfIds:[MY_TAGS_SHELF_ID]},{...reused,retainedSourceIds:['unreviewed']},{...reused,name:'A tampered name'}])assert.equal(validTagShelfMergePreview(bad),false);
});
