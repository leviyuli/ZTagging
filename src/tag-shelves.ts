import {allocateOpaqueId,fingerprint} from './core.ts';
import type {TagDefinition} from './core.ts';
import type {NativeTag} from './platform.ts';
import {isNoTagDefinition,NO_TAG_NAME} from './tag-policy.ts';

export interface TagShelf {id:string;name:string;tagIds:string[];kind:'generated'|'user'|'existing';createdAt?:string;nativeTagNames?:string[];mergedFromIds?:string[]}
export interface NativeTagShelfEntry {name:string;paperIds:string[];manualCount:number;definitionIds:string[];protected:boolean}
export interface TagLibraryEntry {name:string;paperCount:number;tagId?:string;protected?:boolean;paperIds?:string[]}
export interface TagShelfSelection {definitions:TagDefinition[];assignableIds:string[];contextOnlyIds:string[];allSaved:boolean}
export interface TagShelfMergeRequest {shelfIds:string[];name:string;targetId?:string;replaceSources:boolean}
export interface TagShelfMergePreview {id:string;fingerprint:string;shelfIds:string[];name:string;targetId:string;replaceSources:boolean;total:number;ready:number;shared:number;sourceNames:string[];removedShelfIds:string[];retainedSourceIds:string[];target:TagShelf}
export const ALL_TAG_SHELVES_ID='all';
export const EXISTING_TAG_SHELF_ID='tag-shelf-existing';
export const MY_TAGS_SHELF_ID='tag-shelf-my-tags';

const unique=(values:readonly string[])=>[...new Set(values)];
const copyShelf=(shelf:TagShelf):TagShelf=>({...shelf,tagIds:[...shelf.tagIds],...(shelf.nativeTagNames?{nativeTagNames:[...shelf.nativeTagNames]}:{}),...(shelf.mergedFromIds?{mergedFromIds:[...shelf.mergedFromIds]}:{})});
const labels=(tag:TagDefinition)=>[tag.name,tag.fullName??'',...tag.aliases].filter(Boolean);
function shelfName(value:string):string {const name=value.trim();if(!name||name.length>80)throw new Error('Choose a shelf name of 1–80 characters.');return name;}
function assertName(shelves:readonly TagShelf[],name:string,exceptId?:string):string {const value=shelfName(name);if(shelves.some(shelf=>shelf.id!==exceptId&&shelf.name===value))throw new Error('A tag shelf already uses that name.');return value;}
function approvedDefinitions(definitions:readonly TagDefinition[]):Map<string,TagDefinition> {
  const seen=new Set<string>(),approved=new Map<string,TagDefinition>();for(const tag of definitions){if(seen.has(tag.id))throw new Error('Tag definitions contain a duplicate identity.');seen.add(tag.id);if(tag.status==='approved'&&!isNoTagDefinition(tag))approved.set(tag.id,tag);}return approved;
}
function assertShelves(shelves:readonly TagShelf[]):void {if(!validTagShelves(shelves))throw new Error('The saved tag shelves are invalid.');}
export function resolveTagShelfId(shelves:readonly TagShelf[],id:string):string {if((id===EXISTING_TAG_SHELF_ID||shelves.some(shelf=>shelf.id===id&&shelf.kind==='existing'))&&shelves.some(shelf=>shelf.id===MY_TAGS_SHELF_ID))return MY_TAGS_SHELF_ID;return shelves.some(shelf=>shelf.id===id)?id:shelves.find(shelf=>shelf.mergedFromIds?.includes(id))?.id??id;}
function selectedShelf(shelves:readonly TagShelf[],id:string):TagShelf {if(id===ALL_TAG_SHELVES_ID)throw new Error('All tags is a view, not a renameable shelf.');const target=resolveTagShelfId(shelves,id),shelf=shelves.find(shelf=>shelf.id===target);if(!shelf)throw new Error('This tag shelf is no longer available. Choose a current shelf.');return shelf;}

export function validTagShelves(value:unknown):value is TagShelf[] {
  if(!Array.isArray(value))return false;const ids=new Set<string>(),names=new Set<string>(),redirects=new Set<string>();let existing=0;
  for(const valueShelf of value){if(!valueShelf||typeof valueShelf!=='object')return false;const shelf=valueShelf as Partial<TagShelf>;
    if(typeof shelf.id!=='string'||!shelf.id||shelf.id===ALL_TAG_SHELVES_ID||ids.has(shelf.id)||typeof shelf.name!=='string'||!shelf.name.trim()||shelf.name!==shelf.name.trim()||shelf.name.length>80||names.has(shelf.name)||!['generated','user','existing'].includes(String(shelf.kind))||!Array.isArray(shelf.tagIds)||shelf.tagIds.some(id=>typeof id!=='string'||!id)||new Set(shelf.tagIds).size!==shelf.tagIds.length||shelf.createdAt!==undefined&&typeof shelf.createdAt!=='string')return false;
    for(const field of ['nativeTagNames','mergedFromIds'] as const)if(shelf[field]!==undefined&&(!Array.isArray(shelf[field])||shelf[field]!.some(item=>typeof item!=='string'||!item)||new Set(shelf[field]).size!==shelf[field]!.length))return false;
    for(const id of shelf.mergedFromIds??[]){if([ALL_TAG_SHELVES_ID,EXISTING_TAG_SHELF_ID,MY_TAGS_SHELF_ID].includes(id)||redirects.has(id))return false;redirects.add(id);}
    if(shelf.kind==='existing'&&++existing>1||shelf.id===EXISTING_TAG_SHELF_ID&&shelf.kind!=='existing')return false;ids.add(shelf.id);names.add(shelf.name);
  }
  return ![...redirects].some(id=>ids.has(id));
}
export function migrateTagShelves(definitions:readonly TagDefinition[],previous?:readonly TagShelf[]):TagShelf[] {
  if(previous!==undefined){assertShelves(previous);const shelves=previous.filter(shelf=>shelf.kind!=='existing').map(copyShelf),legacy=previous.filter(shelf=>shelf.kind==='existing'),members=unique(legacy.flatMap(shelf=>shelf.tagIds)),mine=shelves.find(shelf=>shelf.id===MY_TAGS_SHELF_ID);
    if(mine){mine.tagIds=unique([...mine.tagIds,...members]);const native=unique([...mine.nativeTagNames??[],...legacy.flatMap(shelf=>shelf.nativeTagNames??[])]);if(native.length)mine.nativeTagNames=native;}else{let name='My tags',suffix=2;while(shelves.some(shelf=>shelf.name===name))name=`My tags ${suffix++}`;const native=unique(legacy.flatMap(shelf=>shelf.nativeTagNames??[]));shelves.push({id:MY_TAGS_SHELF_ID,name,tagIds:members,kind:'user',...(native.length?{nativeTagNames:native}:{})});}return shelves;}
  const tags=[...approvedDefinitions(definitions).values()],generated=tags.filter(tag=>!tag.custom).map(tag=>tag.id),manual=tags.filter(tag=>tag.custom).map(tag=>tag.id);
  return [...(generated.length?[{id:'tag-shelf-generated-1',name:'Generated tags 1',tagIds:generated,kind:'generated' as const}]:[]),{id:MY_TAGS_SHELF_ID,name:'My tags',tagIds:manual,kind:'user'}];
}
export function createTagShelf(shelves:readonly TagShelf[],name:string,kind:TagShelf['kind']='user',tagIds:readonly string[]=[],createdAt=new Date().toISOString()):TagShelf[] {
  assertShelves(shelves);const value=assertName(shelves,name);if(!['generated','user','existing'].includes(kind))throw new Error('Choose a supported shelf kind.');if(kind==='existing'&&shelves.some(shelf=>shelf.kind==='existing'))throw new Error('The native library already has an Existing tags shelf.');if(tagIds.some(id=>typeof id!=='string'||!id))throw new Error('Shelf membership requires saved tag identities.');
  return [...shelves.map(copyShelf),{id:kind==='existing'?EXISTING_TAG_SHELF_ID:allocateOpaqueId('tag-shelf'),name:value,tagIds:unique(tagIds),kind,createdAt}];
}
export function renameTagShelf(shelves:readonly TagShelf[],id:string,name:string):TagShelf[] {
  assertShelves(shelves);const target=selectedShelf(shelves,id),value=assertName(shelves,name,target.id);return shelves.map(shelf=>shelf.id===target.id?{...copyShelf(shelf),name:value}:copyShelf(shelf));
}
export function updateTagShelfMembers(shelves:readonly TagShelf[],id:string,tagIds:readonly string[],definitions?:readonly TagDefinition[]):TagShelf[] {
  assertShelves(shelves);const target=selectedShelf(shelves,id);if(tagIds.some(id=>typeof id!=='string'||!id))throw new Error('Shelf membership requires saved tag identities.');
  if(definitions){const known=new Map(definitions.map(tag=>[tag.id,tag]));for(const tagId of tagIds){const tag=known.get(tagId);if(tag&&isNoTagDefinition(tag)||!tag&&!target.tagIds.includes(tagId))throw new Error('Choose current saved tag definitions; no_tag remains a native marker.');}}
  const members=unique(tagIds);return shelves.map(shelf=>shelf.id===target.id?{...copyShelf(shelf),tagIds:[...members]}:copyShelf(shelf));
}
export function createBuildTagShelf(shelves:readonly TagShelf[],beforeDefinitions:readonly TagDefinition[],afterDefinitions:readonly TagDefinition[],createdAt=new Date().toISOString()):TagShelf[] {
  assertShelves(shelves);const before=approvedDefinitions(beforeDefinitions),after=approvedDefinitions(afterDefinitions),newIds=[...after.keys()].filter(id=>!before.has(id));if(!newIds.length)return shelves.map(copyShelf);
  let index=shelves.filter(shelf=>shelf.kind==='generated').length+1;while(shelves.some(shelf=>shelf.name===`Generated tags ${index}`))index++;return createTagShelf(shelves,`Generated tags ${index}`,'generated',newIds,createdAt);
}
export function nativeTagShelfEntries(nativeTags:Readonly<Record<string,readonly NativeTag[]>>,definitions:readonly TagDefinition[]):NativeTagShelfEntry[] {
  const approved=[...approvedDefinitions(definitions).values()],inventory=new Map<string,{paperIds:string[];manualCount:number}>();
  for(const [paperId,tags] of Object.entries(nativeTags))for(const name of unique(tags.map(tag=>tag.tag))){const row=inventory.get(name)??{paperIds:[],manualCount:0};row.paperIds.push(paperId);if(tags.some(tag=>tag.tag===name&&tag.type===0))row.manualCount++;inventory.set(name,row);}
  return [...inventory].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,row])=>({name,paperIds:[...row.paperIds].sort(),manualCount:row.manualCount,definitionIds:approved.filter(tag=>labels(tag).includes(name)).map(tag=>tag.id),protected:name===NO_TAG_NAME}));
}
export function selectTagShelfDefinitions(definitions:readonly TagDefinition[],shelves:readonly TagShelf[],shelfId=ALL_TAG_SHELVES_ID,nativeTags?:Readonly<Record<string,readonly NativeTag[]>>):TagShelfSelection {
  assertShelves(shelves);const approved=approvedDefinitions(definitions),shelf=shelfId===ALL_TAG_SHELVES_ID?undefined:selectedShelf(shelves,shelfId),requested=new Set(shelf?shelf.tagIds:approved.keys());
  if((shelf?.id===MY_TAGS_SHELF_ID||shelf?.kind==='existing')&&nativeTags)for(const entry of nativeTagShelfEntries(nativeTags,definitions))if(entry.definitionIds.length===1)requested.add(entry.definitionIds[0]);
  for(const name of shelf?.nativeTagNames??[]){const matches=[...approved.values()].filter(tag=>labels(tag).includes(name));if(matches.length===1)requested.add(matches[0].id);}
  const assignableIds=[...approved.keys()].filter(id=>requested.has(id)),included=new Set(assignableIds),pending=[...assignableIds];
  while(pending.length){const tag=approved.get(pending.pop()!)!;for(const parentId of tag.broaderIds)if(approved.has(parentId)&&!included.has(parentId)){included.add(parentId);pending.push(parentId);}}
  return {definitions:[...approved].filter(([id])=>included.has(id)).map(([,tag])=>({...tag,aliases:[...tag.aliases],inclusions:[...tag.inclusions],exclusions:[...tag.exclusions],examples:[...tag.examples],broaderIds:[...tag.broaderIds],...(tag.relatedIds?{relatedIds:[...tag.relatedIds]}:{})})),assignableIds,contextOnlyIds:[...approved.keys()].filter(id=>included.has(id)&&!requested.has(id)),allSaved:shelfId===ALL_TAG_SHELVES_ID};
}
export function libraryTagShelfEntries(nativeTags:Readonly<Record<string,readonly NativeTag[]>>,definitions:readonly TagDefinition[],tagIds?:readonly string[],includeNative=true,nativeTagNames:readonly string[]=[]):TagLibraryEntry[] {
  const approved=approvedDefinitions(definitions),requested=new Set(tagIds??approved.keys()),explicit=new Set(nativeTagNames),papers=new Map<string,Set<string>>(),rows=new Map<string,TagLibraryEntry>();
  const addDefinition=(id:string)=>{const tag=approved.get(id),key=`definition:${id}`;if(tag&&!rows.has(key)){rows.set(key,{name:tag.name,tagId:id,paperCount:0,paperIds:[]});papers.set(id,new Set());}};
  for(const name of explicit){const matches=[...approved.values()].filter(tag=>labels(tag).includes(name));if(matches.length===1)requested.add(matches[0].id);else rows.set(`native:${name}`,{name,paperCount:0,paperIds:[],...(name===NO_TAG_NAME?{protected:true}:{})});}
  for(const id of requested)addDefinition(id);
  for(const entry of nativeTagShelfEntries(nativeTags,definitions)){
    const id=entry.definitionIds.length===1?entry.definitionIds[0]:undefined;
    if(id){if(includeNative||explicit.has(entry.name))addDefinition(id);if(rows.has(`definition:${id}`))for(const paperId of entry.paperIds)papers.get(id)!.add(paperId);}
    else if(includeNative||explicit.has(entry.name)){const key=`native:${entry.name}`;rows.set(key,{name:entry.name,paperCount:entry.paperIds.length,paperIds:[...entry.paperIds],...(entry.protected?{protected:true}:{})});}
  }
  for(const [id,ids] of papers){const row=rows.get(`definition:${id}`)!;row.paperCount=ids.size;row.paperIds=[...ids].sort();}
  return [...rows.values()].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
}

function shelfMerge(shelves:readonly TagShelf[],definitions:readonly TagDefinition[],nativeTags:Readonly<Record<string,readonly NativeTag[]>>,request:TagShelfMergeRequest,id:string,targetId:string|undefined,createdAt:string):TagShelfMergePreview {
  assertShelves(shelves);if(!Array.isArray(request.shelfIds)||new Set(request.shelfIds).size!==request.shelfIds.length||!request.shelfIds.length||typeof request.replaceSources!=='boolean')throw new Error('Choose different shelves to combine.');
  const sourceIds=unique(request.shelfIds.map(id=>selectedShelf(shelves,id).id)),sources=shelves.filter(shelf=>sourceIds.includes(shelf.id)),destination=request.targetId?selectedShelf(shelves,request.targetId):request.replaceSources?sources.find(shelf=>shelf.id===MY_TAGS_SHELF_ID):undefined,targetIdentity=destination?.id??targetId??allocateOpaqueId('tag-shelf');
  const participants=[...(destination?[destination]:[]),...sources.filter(shelf=>shelf.id!==destination?.id)];if(participants.length<2)throw new Error('Choose at least two different shelves to combine.');
  if(!destination&&(shelves.some(shelf=>shelf.id===targetIdentity||shelf.mergedFromIds?.includes(targetIdentity))||[ALL_TAG_SHELVES_ID,MY_TAGS_SHELF_ID,EXISTING_TAG_SHELF_ID].includes(targetIdentity)))throw new Error('Choose a new shelf identity.');
  const removedShelfIds=request.replaceSources?sources.filter(shelf=>shelf.id!==destination?.id&&shelf.id!==MY_TAGS_SHELF_ID).map(shelf=>shelf.id):[],name=assertName(shelves.filter(shelf=>!removedShelfIds.includes(shelf.id)),request.name,destination?.id);
  const entries=participants.map(shelf=>libraryTagShelfEntries(nativeTags,definitions,shelf.tagIds,shelf.id===MY_TAGS_SHELF_ID||shelf.kind==='existing',shelf.nativeTagNames));
  const tagIds=unique([...participants.flatMap(shelf=>shelf.tagIds),...entries.flatMap(rows=>rows.flatMap(row=>row.tagId?[row.tagId]:[]))]),nativeTagNames=unique([...participants.flatMap(shelf=>shelf.nativeTagNames??[]),...entries.flatMap(rows=>rows.filter(row=>!row.tagId).map(row=>row.name))]);
  const redirects=unique([...(destination?.mergedFromIds??[]),...shelves.filter(shelf=>removedShelfIds.includes(shelf.id)).flatMap(shelf=>[shelf.id,...shelf.mergedFromIds??[]])]);
  const target:TagShelf={...(destination?copyShelf(destination):{id:targetIdentity,kind:'user' as const,createdAt}),name,tagIds,...(nativeTagNames.length?{nativeTagNames}:{}),...(redirects.length?{mergedFromIds:redirects}:{})};
  const rows=libraryTagShelfEntries(nativeTags,definitions,target.tagIds,target.id===MY_TAGS_SHELF_ID,target.nativeTagNames),remaining=shelves.filter(shelf=>!removedShelfIds.includes(shelf.id));if(!validTagShelves([...remaining.filter(shelf=>shelf.id!==target.id),target]))throw new Error('These shelves cannot be combined with conflicting historical links.');
  return {id,fingerprint:fingerprint({shelves,definitions,nativeTags}),shelfIds:sourceIds,name,targetId:target.id,replaceSources:request.replaceSources,total:rows.length,ready:rows.filter(row=>row.tagId).length,shared:entries.reduce((sum,rows)=>sum+rows.length,0)-rows.length,sourceNames:sources.map(shelf=>shelf.name),removedShelfIds,retainedSourceIds:sources.filter(shelf=>!removedShelfIds.includes(shelf.id)).map(shelf=>shelf.id),target};
}
export function previewTagShelfMerge(shelves:readonly TagShelf[],definitions:readonly TagDefinition[],nativeTags:Readonly<Record<string,readonly NativeTag[]>>,request:TagShelfMergeRequest,createdAt=new Date().toISOString()):TagShelfMergePreview {
  return shelfMerge(shelves,definitions,nativeTags,request,allocateOpaqueId('shelf-merge'),undefined,createdAt);
}
export function validTagShelfMergePreview(value:unknown):value is TagShelfMergePreview {
  if(!value||typeof value!=='object')return false;const preview=value as Partial<TagShelfMergePreview>;
  const strings=(items:unknown):items is string[]=>Array.isArray(items)&&items.every(item=>typeof item==='string'&&!!item);
  if(!['id','fingerprint','name','targetId'].every(field=>typeof preview[field as keyof TagShelfMergePreview]==='string'&&!!preview[field as keyof TagShelfMergePreview])||typeof preview.replaceSources!=='boolean'||![preview.shelfIds,preview.sourceNames,preview.removedShelfIds,preview.retainedSourceIds].every(strings)||!['total','ready','shared'].every(field=>Number.isSafeInteger(preview[field as keyof TagShelfMergePreview])&&Number(preview[field as keyof TagShelfMergePreview])>=0)||!validTagShelves([preview.target]))return false;
  const sources=preview.shelfIds!,remaining=preview.retainedSourceIds!,removed=preview.removedShelfIds!;
  return !!sources.length&&new Set(sources).size===sources.length&&preview.sourceNames!.length===sources.length&&remaining.length+removed.length===sources.length&&new Set([...remaining,...removed]).size===sources.length&&[...remaining,...removed].every(id=>sources.includes(id))&&!removed.includes(MY_TAGS_SHELF_ID)&&Number(preview.ready)<=Number(preview.total)&&preview.target?.id===preview.targetId&&preview.target?.name===preview.name;
}
export function applyTagShelfMerge(preview:TagShelfMergePreview,shelves:readonly TagShelf[],definitions:readonly TagDefinition[],nativeTags:Readonly<Record<string,readonly NativeTag[]>>):TagShelf[] {
  if(!validTagShelfMergePreview(preview)||preview.fingerprint!==fingerprint({shelves,definitions,nativeTags}))throw new Error('The shelf contents changed. Refresh the merge before applying it.');
  const destination=shelves.find(shelf=>shelf.id===preview.targetId),next=shelfMerge(shelves,definitions,nativeTags,{shelfIds:preview.shelfIds,name:preview.name,...(destination?{targetId:destination.id}:{}),replaceSources:preview.replaceSources},preview.id,preview.targetId,preview.target.createdAt??'');
  if(fingerprint(next)!==fingerprint(preview))throw new Error('The shelf merge preview changed. Refresh it before applying.');
  const result=shelves.filter(shelf=>!preview.removedShelfIds.includes(shelf.id)).map(shelf=>shelf.id===preview.targetId?copyShelf(preview.target):copyShelf(shelf));if(!destination)result.push(copyShelf(preview.target));return result;
}
