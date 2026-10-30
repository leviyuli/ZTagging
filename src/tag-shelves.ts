import {allocateOpaqueId} from './core.ts';
import type {TagDefinition} from './core.ts';
import type {NativeTag} from './platform.ts';
import {isNoTagDefinition,NO_TAG_NAME} from './tag-policy.ts';

export interface TagShelf {id:string;name:string;tagIds:string[];kind:'generated'|'user'|'existing';createdAt?:string}
export interface NativeTagShelfEntry {name:string;paperIds:string[];manualCount:number;definitionIds:string[];protected:boolean}
export interface TagShelfSelection {definitions:TagDefinition[];assignableIds:string[];contextOnlyIds:string[];allSaved:boolean}
export const ALL_TAG_SHELVES_ID='all';
export const EXISTING_TAG_SHELF_ID='tag-shelf-existing';
export const MY_TAGS_SHELF_ID='tag-shelf-my-tags';

const unique=(values:readonly string[])=>[...new Set(values)];
const copyShelf=(shelf:TagShelf):TagShelf=>({...shelf,tagIds:[...shelf.tagIds]});
const labels=(tag:TagDefinition)=>[tag.name,tag.fullName??'',...tag.aliases].filter(Boolean);
function shelfName(value:string):string {const name=value.trim();if(!name||name.length>80)throw new Error('Choose a shelf name of 1–80 characters.');return name;}
function assertName(shelves:readonly TagShelf[],name:string,exceptId?:string):string {const value=shelfName(name);if(shelves.some(shelf=>shelf.id!==exceptId&&shelf.name===value))throw new Error('A tag shelf already uses that name.');return value;}
function existingShelf():TagShelf{return {id:EXISTING_TAG_SHELF_ID,name:'Existing tags',tagIds:[],kind:'existing'};}
function approvedDefinitions(definitions:readonly TagDefinition[]):Map<string,TagDefinition> {
  const seen=new Set<string>(),approved=new Map<string,TagDefinition>();for(const tag of definitions){if(seen.has(tag.id))throw new Error('Tag definitions contain a duplicate identity.');seen.add(tag.id);if(tag.status==='approved'&&!isNoTagDefinition(tag))approved.set(tag.id,tag);}return approved;
}
function assertShelves(shelves:readonly TagShelf[]):void {if(!validTagShelves(shelves))throw new Error('The saved tag shelves are invalid.');}
function selectedShelf(shelves:readonly TagShelf[],id:string):TagShelf {if(id===ALL_TAG_SHELVES_ID)throw new Error('All saved tags is a view, not a renameable shelf.');const shelf=shelves.find(shelf=>shelf.id===id);if(!shelf)throw new Error('This tag shelf is no longer available. Choose a current shelf.');return shelf;}

export function validTagShelves(value:unknown):value is TagShelf[] {
  if(!Array.isArray(value))return false;const ids=new Set<string>(),names=new Set<string>();let existing=0;
  for(const valueShelf of value){if(!valueShelf||typeof valueShelf!=='object')return false;const shelf=valueShelf as Partial<TagShelf>;
    if(typeof shelf.id!=='string'||!shelf.id||shelf.id===ALL_TAG_SHELVES_ID||ids.has(shelf.id)||typeof shelf.name!=='string'||!shelf.name.trim()||shelf.name!==shelf.name.trim()||shelf.name.length>80||names.has(shelf.name)||!['generated','user','existing'].includes(String(shelf.kind))||!Array.isArray(shelf.tagIds)||shelf.tagIds.some(id=>typeof id!=='string'||!id)||new Set(shelf.tagIds).size!==shelf.tagIds.length||shelf.createdAt!==undefined&&typeof shelf.createdAt!=='string')return false;
    if(shelf.kind==='existing'&&++existing>1||shelf.id===EXISTING_TAG_SHELF_ID&&shelf.kind!=='existing')return false;ids.add(shelf.id);names.add(shelf.name);
  }
  return true;
}
export function migrateTagShelves(definitions:readonly TagDefinition[],previous?:readonly TagShelf[]):TagShelf[] {
  if(previous!==undefined){assertShelves(previous);const shelves=previous.map(copyShelf);if(!shelves.some(shelf=>shelf.kind==='existing')){const shelf=existingShelf();let suffix=2;while(shelves.some(existing=>existing.name===shelf.name))shelf.name=`Existing tags ${suffix++}`;shelves.push(shelf);}return shelves;}
  const tags=[...approvedDefinitions(definitions).values()],generated=tags.filter(tag=>!tag.custom).map(tag=>tag.id),manual=tags.filter(tag=>tag.custom).map(tag=>tag.id);
  return [...(generated.length?[{id:'tag-shelf-generated-1',name:'Generated tags 1',tagIds:generated,kind:'generated' as const}]:[]),{id:MY_TAGS_SHELF_ID,name:'My tags',tagIds:manual,kind:'user'},existingShelf()];
}
export function createTagShelf(shelves:readonly TagShelf[],name:string,kind:TagShelf['kind']='user',tagIds:readonly string[]=[],createdAt=new Date().toISOString()):TagShelf[] {
  assertShelves(shelves);const value=assertName(shelves,name);if(!['generated','user','existing'].includes(kind))throw new Error('Choose a supported shelf kind.');if(kind==='existing'&&shelves.some(shelf=>shelf.kind==='existing'))throw new Error('The native library already has an Existing tags shelf.');if(tagIds.some(id=>typeof id!=='string'||!id))throw new Error('Shelf membership requires saved tag identities.');
  return [...shelves.map(copyShelf),{id:kind==='existing'?EXISTING_TAG_SHELF_ID:allocateOpaqueId('tag-shelf'),name:value,tagIds:unique(tagIds),kind,createdAt}];
}
export function renameTagShelf(shelves:readonly TagShelf[],id:string,name:string):TagShelf[] {
  assertShelves(shelves);selectedShelf(shelves,id);const value=assertName(shelves,name,id);return shelves.map(shelf=>shelf.id===id?{...copyShelf(shelf),name:value}:copyShelf(shelf));
}
export function updateTagShelfMembers(shelves:readonly TagShelf[],id:string,tagIds:readonly string[],definitions?:readonly TagDefinition[]):TagShelf[] {
  assertShelves(shelves);const target=selectedShelf(shelves,id);if(tagIds.some(id=>typeof id!=='string'||!id))throw new Error('Shelf membership requires saved tag identities.');
  if(definitions){const known=new Map(definitions.map(tag=>[tag.id,tag]));for(const tagId of tagIds){const tag=known.get(tagId);if(tag&&isNoTagDefinition(tag)||!tag&&!target.tagIds.includes(tagId))throw new Error('Choose current saved tag definitions; no_tag remains a native marker.');}}
  const members=unique(tagIds);return shelves.map(shelf=>shelf.id===id?{...copyShelf(shelf),tagIds:[...members]}:copyShelf(shelf));
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
  if(shelf?.kind==='existing'&&nativeTags)for(const entry of nativeTagShelfEntries(nativeTags,definitions))if(entry.definitionIds.length===1)requested.add(entry.definitionIds[0]);
  const assignableIds=[...approved.keys()].filter(id=>requested.has(id)),included=new Set(assignableIds),pending=[...assignableIds];
  while(pending.length){const tag=approved.get(pending.pop()!)!;for(const parentId of tag.broaderIds)if(approved.has(parentId)&&!included.has(parentId)){included.add(parentId);pending.push(parentId);}}
  return {definitions:[...approved].filter(([id])=>included.has(id)).map(([,tag])=>({...tag,aliases:[...tag.aliases],inclusions:[...tag.inclusions],exclusions:[...tag.exclusions],examples:[...tag.examples],broaderIds:[...tag.broaderIds],...(tag.relatedIds?{relatedIds:[...tag.relatedIds]}:{})})),assignableIds,contextOnlyIds:[...approved.keys()].filter(id=>included.has(id)&&!requested.has(id)),allSaved:shelfId===ALL_TAG_SHELVES_ID};
}
