import { canonicalTagKey } from './core.ts';
import type { TagDefinition } from './core.ts';
import {nativePaperBindingAllows} from './native-binding.ts';
import type {NativeBindingProjection,NativePaperBindingExclusions} from './native-binding.ts';

export type ConceptDefinition=TagDefinition&NativeBindingProjection;
export interface ConceptSelection { conceptId:string; contextId?:string }
export interface ConceptFilter { mode:'all'|'any'; selections:ConceptSelection[] }
export interface ConceptFilterBinding {tagId:string;names:string[];nativeBindingExclusions?:NativePaperBindingExclusions}
export interface ConceptFilterClause { groups:string[][];bindings?:ConceptFilterBinding[][] }
export interface CompiledConceptFilter { mode:'all'|'any'; clauses:ConceptFilterClause[]; empty:boolean }

/** Literal names are retained for Zotero's case-sensitive native tag-is operator. */
export function equivalentTagNames(definition:TagDefinition):string[] {
  return [...new Set([definition.name,definition.fullName??'',...definition.aliases].map(name=>name.trim()).filter(Boolean))];
}

/** Includes self; only approved is-a descendants are traversed, never related concepts. */
export function descendantIds(conceptId:string,definitions:readonly TagDefinition[]):string[] {
  const approved=new Map(definitions.filter(tag=>tag.status==='approved').map(tag=>[tag.id,tag]));
  if(!approved.has(conceptId))return [];
  const children=new Map<string,string[]>();
  // Legacy DIY broaderIds describe contextual placement, not an inheritable is-a claim.
  for(const tag of approved.values())if(!tag.custom)for(const parent of tag.broaderIds){if(approved.get(parent)?.custom)continue;const list=children.get(parent)??[];list.push(tag.id);children.set(parent,list);}
  const visited=new Set<string>(),visit=(id:string)=>{if(visited.has(id))return;visited.add(id);for(const child of (children.get(id)??[]).sort())visit(child);};
  visit(conceptId);return [...visited];
}

const normalized=new WeakMap<CompiledConceptFilter,string[][][]>();
function normalizedClauses(filter:CompiledConceptFilter):string[][][] {
  let clauses=normalized.get(filter);
  if(!clauses){clauses=filter.clauses.map(clause=>clause.groups.map(group=>[...new Set(group.map(canonicalTagKey))]));normalized.set(filter,clauses);}
  return clauses;
}

/** Each selection is a compound clause: concept AND optional context; outer All/Any combines clauses. */
export function compileConceptFilter(definitions:readonly ConceptDefinition[],filter:ConceptFilter):CompiledConceptFilter {
  const mode=filter.mode==='any'?'any':'all';
  if(!Array.isArray(filter.selections)||!filter.selections.length)return {mode,clauses:[],empty:false};
  const byId=new Map(definitions.filter(tag=>tag.status==='approved').map(tag=>[tag.id,tag]));
  const expand=(id:string):ConceptFilterBinding[]=>descendantIds(id,definitions).map(tagId=>{const tag=byId.get(tagId)!;return {tagId,names:equivalentTagNames(tag),...(tag.nativeBindingExclusions?{nativeBindingExclusions:Object.fromEntries(Object.entries(tag.nativeBindingExclusions).map(([paperId,values])=>[paperId,[...values]]))}:{})};});
  const clauses:ConceptFilterClause[]=[];
  for(const selection of filter.selections){
    const bindings=[expand(selection.conceptId)];
    if(selection.contextId!==undefined)bindings.push(expand(selection.contextId));
    const groups=bindings.map(group=>[...new Set(group.flatMap(binding=>binding.names))]);
    if(groups.some(group=>!group.length)){
      if(mode==='all')return {mode,clauses:[],empty:true};
      continue;
    }
    clauses.push({groups,...(bindings.some(group=>group.some(binding=>Object.values(binding.nativeBindingExclusions??{}).some(values=>values.length)))?{bindings}:{})});
  }
  const compiled:CompiledConceptFilter={mode,clauses,empty:!clauses.length};normalizedClauses(compiled);return compiled;
}

const bindingKeys=new WeakMap<ConceptFilterBinding,Set<string>>();
function matchesBinding(binding:ConceptFilterBinding,nativeNames:readonly string[],paperId?:string):boolean {
  let keys=bindingKeys.get(binding);if(!keys){keys=new Set(binding.names.map(canonicalTagKey));bindingKeys.set(binding,keys);}
  return nativeNames.some(name=>keys!.has(canonicalTagKey(name))&&nativePaperBindingAllows(paperId,name,binding.nativeBindingExclusions));
}

export function matchCompiledConceptFilter(nativeNames:readonly string[],compiled:CompiledConceptFilter,paperId?:string):boolean {
  if(compiled.empty)return false;
  if(!compiled.clauses.length)return true;
  const names=new Set(nativeNames.map(canonicalTagKey));
  const clauses=normalizedClauses(compiled);
  const matches=(groups:string[][])=>groups.every(group=>group.some(name=>names.has(name)));
  const clauseMatches=(clause:ConceptFilterClause,index:number)=>clause.bindings?clause.bindings.every(group=>group.some(binding=>matchesBinding(binding,nativeNames,paperId))):matches(clauses[index]);
  return compiled.mode==='all'?compiled.clauses.every(clauseMatches):compiled.clauses.some(clauseMatches);
}

export function matchConceptFilter(nativeNames:readonly string[],definitions:readonly ConceptDefinition[],filter:ConceptFilter,paperId?:string):boolean {
  return matchCompiledConceptFilter(nativeNames,compileConceptFilter(definitions,filter),paperId);
}
