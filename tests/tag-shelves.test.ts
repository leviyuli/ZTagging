import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import type {TagDefinition} from '../src/core.ts';
import {getNoTagDefinition} from '../src/tag-policy.ts';
import {ALL_TAG_SHELVES_ID,EXISTING_TAG_SHELF_ID,MY_TAGS_SHELF_ID,migrateTagShelves,createTagShelf,renameTagShelf,updateTagShelfMembers,createBuildTagShelf,nativeTagShelfEntries,selectTagShelfDefinitions,validTagShelves} from '../src/tag-shelves.ts';

const definition=(id:string,name=id,extra:Partial<TagDefinition>={}):TagDefinition=>({id,name,fullName:name,description:`The scientific meaning of ${name}.`,facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[],relatedIds:[],matchingMode:'auto',...extra});

test('migration adds ID-based shelves without changing existing definitions, names, matching flags, or historical identities',()=>{
  const definitions=[definition('fc','FC'),definition('eis','EIS',{facet:'method'}),definition('researcher','RCL',{custom:true,matchingMode:'suggest'}),definition('unapproved','Not ready',{status:'draft',custom:true}),getNoTagDefinition()],before=fingerprint(definitions),shelves=migrateTagShelves(definitions);
  assert.deepEqual(shelves.map(shelf=>[shelf.name,shelf.tagIds,shelf.kind]),[['Generated tags 1',['fc','eis'],'generated'],['My tags',['researcher'],'user'],['Existing tags',[],'existing']]);assert.equal(validTagShelves(shelves),true);assert.ok(shelves.every(shelf=>shelf.createdAt===undefined));assert.equal(fingerprint(definitions),before);assert.deepEqual(migrateTagShelves(definitions),shelves);assert.deepEqual(migrateTagShelves(definitions,shelves),shelves);
  const retained=structuredClone(shelves);retained[0].name='Transport papers';retained[0].tagIds.push('removed-but-historical-id');assert.deepEqual(migrateTagShelves(definitions,retained),retained);assert.notEqual(migrateTagShelves(definitions,retained)[0].tagIds,retained[0].tagIds);
});

test('empty initialization leaves the first generated shelf available for the first real build and preserves an existing native shelf name',()=>{
  const initial=migrateTagShelves([]);assert.deepEqual(initial.map(shelf=>shelf.name),['My tags','Existing tags']);const first=createBuildTagShelf(initial,[],[definition('new')],'2026-10-30T00:00:00.000Z');assert.equal(first.at(-1)!.name,'Generated tags 1');const renamed=renameTagShelf(first,EXISTING_TAG_SHELF_ID,' Native tags · 原有 ');assert.equal(renamed.find(shelf=>shelf.kind==='existing')!.name,'Native tags · 原有');assert.deepEqual(migrateTagShelves([],renamed),renamed);
});

test('successive approved builds add only new active identities without a combined sixty-tag ceiling',()=>{
  const first=Array.from({length:60},(_,index)=>definition(`first-${index}`)),shelves=migrateTagShelves(first),second=[...first,...Array.from({length:30},(_,index)=>definition(`second-${index}`))],next=createBuildTagShelf(shelves,first,second),third=[...second,...Array.from({length:30},(_,index)=>definition(`third-${index}`))],last=createBuildTagShelf(next,second,third);
  assert.deepEqual(last.filter(shelf=>shelf.kind==='generated').map(shelf=>[shelf.name,shelf.tagIds.length]),[['Generated tags 1',60],['Generated tags 2',30],['Generated tags 3',30]]);assert.ok(last.at(-1)!.tagIds.every(id=>id.startsWith('third-')));assert.equal(selectTagShelfDefinitions(third,last).assignableIds.length,120);assert.deepEqual(createBuildTagShelf(last,third,third),last);
  const draft=definition('promoted','Promoted',{status:'draft'}),promoted=createBuildTagShelf(last,[...third,draft],[...third,{...draft,status:'approved'},getNoTagDefinition()]);assert.deepEqual(promoted.at(-1)!.tagIds,['promoted']);assert.equal(shelves[0].tagIds.length,60);
});

test('any shelf can be renamed with scientific symbols and interior spacing preserved while the virtual all view cannot',()=>{
  let shelves=migrateTagShelves([definition('one')]);for(const [id,name] of [[shelves[0].id,' Co / CO · pH '],[MY_TAGS_SHELF_ID,'My  methods'],[EXISTING_TAG_SHELF_ID,'本地タグ']]){const before=structuredClone(shelves),next=renameTagShelf(shelves,id,name);assert.equal(next.find(shelf=>shelf.id===id)!.name,name.trim());assert.deepEqual(next.find(shelf=>shelf.id===id)!.tagIds,before.find(shelf=>shelf.id===id)!.tagIds);assert.deepEqual(shelves,before);shelves=next;}
  assert.throws(()=>renameTagShelf(shelves,ALL_TAG_SHELVES_ID,'Other'),/view/);assert.throws(()=>renameTagShelf(shelves,shelves[0].id,' '),/1–80/);assert.throws(()=>renameTagShelf(shelves,shelves[0].id,'x'.repeat(81)),/1–80/);assert.throws(()=>renameTagShelf(shelves,shelves[0].id,'My  methods'),/already uses/);
});

test('a tag can belong to several shelves without duplicated definitions or loss of historical missing membership',()=>{
  const tags=[definition('one'),definition('two'),definition('draft','Pending',{status:'draft'}),getNoTagDefinition()];let shelves=createTagShelf(migrateTagShelves(tags),'AEM studies');const newId=shelves.at(-1)!.id,before=fingerprint(tags);shelves=updateTagShelfMembers(shelves,newId,['one','one','draft'],tags);assert.deepEqual(shelves.at(-1)!.tagIds,['one','draft']);assert.ok(shelves[0].tagIds.includes('one'));assert.deepEqual(selectTagShelfDefinitions(tags,shelves,newId).assignableIds,['one']);assert.equal(fingerprint(tags),before);assert.throws(()=>updateTagShelfMembers(shelves,newId,['unknown'],tags),/current saved/);assert.throws(()=>updateTagShelfMembers(shelves,newId,['smart-tags:no-tag'],tags),/native marker/);
  const historical=structuredClone(shelves);historical.at(-1)!.tagIds.push('old-id');const changed=updateTagShelfMembers(historical,newId,['one','old-id'],tags);assert.deepEqual(changed.at(-1)!.tagIds,['one','old-id']);assert.deepEqual(selectTagShelfDefinitions(tags,changed,newId).assignableIds,['one']);
});

test('a shelf includes approved parents as context without authorizing parents, siblings, related tags, or drafts for assignment',()=>{
  const tags=[definition('fc','FC'),definition('aem','AEMFC',{broaderIds:['fc'],relatedIds:['eis']}),definition('pem','PEMFC',{broaderIds:['fc']}),definition('eis','EIS',{facet:'method'}),definition('draft','Pending',{status:'draft'})],shelves=updateTagShelfMembers(migrateTagShelves(tags),MY_TAGS_SHELF_ID,['aem','draft'],tags),selection=selectTagShelfDefinitions(tags,shelves,MY_TAGS_SHELF_ID);assert.deepEqual(selection.assignableIds,['aem']);assert.deepEqual(selection.contextOnlyIds,['fc']);assert.deepEqual(selection.definitions.map(tag=>tag.id),['fc','aem']);assert.equal(selection.allSaved,false);selection.definitions[1].aliases.push('Output-only alias');assert.deepEqual(tags[1].aliases,[]);assert.throws(()=>selectTagShelfDefinitions(tags,shelves,'deleted-shelf'),/no longer available/);
  const all=selectTagShelfDefinitions(tags,shelves);assert.equal(all.allSaved,true);assert.deepEqual(all.assignableIds,['fc','aem','pem','eis']);assert.deepEqual(all.contextOnlyIds,[]);
});

test('native shelves display all exact names and deduplicate paper counts without inventing missing meanings',()=>{
  const tags=[definition('co','Co',{fullName:'cobalt',facet:'component'}),definition('CO','CO',{fullName:'carbon monoxide',facet:'component'}),definition('eis','EIS',{fullName:'electrochemical impedance spectroscopy',aliases:['impedance method'],facet:'method'}),definition('draft','Unapproved',{status:'draft'}),getNoTagDefinition()],native={'paper-1':[{tag:'Co',type:0},{tag:'CO',type:1},{tag:'Unknown topic',type:0},{tag:'no_tag',type:0}],'paper-2':[{tag:'Unknown topic',type:0},{tag:'Unknown topic',type:1},{tag:'impedance method',type:1},{tag:'Unapproved',type:0},{tag:'co',type:0}]},before=fingerprint({tags,native}),rows=nativeTagShelfEntries(native,tags);
  assert.deepEqual(rows.find(row=>row.name==='Co')!.definitionIds,['co']);assert.deepEqual(rows.find(row=>row.name==='CO')!.definitionIds,['CO']);assert.deepEqual(rows.find(row=>row.name==='co')!.definitionIds,[]);assert.deepEqual(rows.find(row=>row.name==='impedance method')!.definitionIds,['eis']);assert.deepEqual(rows.find(row=>row.name==='Unknown topic')!.paperIds,['paper-1','paper-2']);assert.equal(rows.find(row=>row.name==='Unknown topic')!.manualCount,2);assert.equal(rows.find(row=>row.name==='no_tag')!.protected,true);assert.deepEqual(rows.find(row=>row.name==='no_tag')!.definitionIds,[]);assert.equal(fingerprint({tags,native}),before);
  const shelves=migrateTagShelves(tags),selected=selectTagShelfDefinitions(tags,shelves,EXISTING_TAG_SHELF_ID,native);assert.deepEqual(selected.assignableIds,['co','CO','eis']);assert.ok(!selected.definitions.some(tag=>tag.name==='Unknown topic'));assert.deepEqual(selectTagShelfDefinitions(tags,shelves,EXISTING_TAG_SHELF_ID).assignableIds,[]);
});

test('ambiguous native aliases stay display-only until a saved definition is explicitly selected or supplied',()=>{
  const tags=[definition('first','First meaning',{aliases:['Shared native label']}),definition('second','Second meaning',{aliases:['Shared native label']})],native={'paper-1':[{tag:'Shared native label',type:0},{tag:'New native topic',type:0}]},shelves=migrateTagShelves(tags);assert.deepEqual(nativeTagShelfEntries(native,tags)[1].definitionIds,['first','second']);assert.deepEqual(selectTagShelfDefinitions(tags,shelves,EXISTING_TAG_SHELF_ID,native).assignableIds,[]);
  const explicit=updateTagShelfMembers(shelves,EXISTING_TAG_SHELF_ID,['first'],tags);assert.deepEqual(selectTagShelfDefinitions(tags,explicit,EXISTING_TAG_SHELF_ID,native).assignableIds,['first']);const defined=[...tags,definition('new','New native topic')],withMeaning=updateTagShelfMembers(explicit,EXISTING_TAG_SHELF_ID,['first','new'],defined);assert.deepEqual(selectTagShelfDefinitions(defined,withMeaning,EXISTING_TAG_SHELF_ID,native).assignableIds,['first','new']);assert.equal(tags.length,2);
});

test('cycle-safe parent expansion never broadens assignment membership and malformed persisted shelves are rejected',()=>{
  const tags=[definition('one','One',{broaderIds:['two']}),definition('two','Two',{broaderIds:['one']}),definition('not-ready','Missing context',{status:'draft'})],shelves=updateTagShelfMembers(migrateTagShelves(tags),MY_TAGS_SHELF_ID,['one','stale']);assert.deepEqual(selectTagShelfDefinitions(tags,shelves,MY_TAGS_SHELF_ID).assignableIds,['one']);assert.deepEqual(selectTagShelfDefinitions(tags,shelves,MY_TAGS_SHELF_ID).contextOnlyIds,['two']);assert.throws(()=>selectTagShelfDefinitions([...tags,tags[0]],shelves),/duplicate identity/);
  for(const bad of [null,[{id:'all',name:'All',tagIds:[],kind:'user'}],[{id:'x',name:' ',tagIds:[],kind:'user'}],[{id:'x',name:'X',tagIds:['one','one'],kind:'user'}],[{id:'x',name:'X',tagIds:[],kind:'unknown'}],[{id:'x',name:'X',tagIds:[],kind:'existing'},{id:'y',name:'Y',tagIds:[],kind:'existing'}]])assert.equal(validTagShelves(bad),false);
});
