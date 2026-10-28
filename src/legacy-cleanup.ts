import {canonicalTagKey, fingerprint, parseModelJSON} from './core.ts';
import type {TagDefinition} from './core.ts';
import {preferredCoreNaming} from './naming.ts';
import type {AppState} from './controller.ts';
import type {TaxonomyProposal} from './taxonomy.ts';

export interface LegacyCleanupResult {tags:TagDefinition[];removedIds:string[]}
type CleanupState=Pick<AppState,'tags'|'decisions'|'ownership'|'history'|'pendingChange'|'suggestions'|'taxonomyProposal'|'taxonomyArchives'|'taxonomyRedirects'|'taxonomySupport'|'run'|'userEditedTagIds'|'preparationHistory'>;
const record=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const text=(value:unknown,max=2000):string=>typeof value==='string'?value.trim().replace(/\s+/g,' ').slice(0,max):'';
const strings=(value:unknown,max=30,length=1000):string[]=>Array.isArray(value)?[...new Set(value.slice(0,max).map(entry=>text(entry,length)).filter(Boolean))]:[];

/** Only original generated candidates provide a baseline for detecting later human edits. */
export function inferEditedProposalTagIds(state:Pick<AppState,'tags'|'taxonomyProposal'|'userEditedTagIds'>):string[] {
  const edited=new Set(state.userEditedTagIds??[]),proposal=state.taxonomyProposal;
  if(!proposal)return [...edited];
  let raw:Record<string,unknown>|undefined;
  try{raw=record(typeof proposal.rawResponse==='string'?parseModelJSON(proposal.rawResponse):proposal.rawResponse);}catch{/* A malformed response cannot prove an unedited baseline. */}
  const originals=new Map<string,Record<string,unknown>>();
  for(const [index,value] of (Array.isArray(raw?.tags)?raw.tags:[]).entries()){
    const candidate=record(value);if(candidate)originals.set(text(candidate.key,160)||text(candidate.id,160)||`candidate-${index}`,candidate);
  }
  const active=new Set(proposal.tags.map(tag=>tag.id)),ids=new Map(Object.entries(proposal.candidateIds??{}));
  for(const [id,key] of Object.entries(proposal.candidateKeys??{}))ids.set(key,id);
  const labels=new Map<string,Set<string>>();
  for(const [key,candidate] of originals){
    const id=ids.get(key);if(!id)continue;
    const naming=preferredCoreNaming(text(candidate.name,80),text(candidate.fullName,160)||text(candidate.name,80),strings(candidate.aliases,100,160),1);
    for(const name of [naming.name,naming.fullName,...naming.aliases]){const key=canonicalTagKey(name),matches=labels.get(key)??new Set<string>();matches.add(id);labels.set(key,matches);}
  }
  const redirects=new Map(proposal.merges.map(merge=>[merge.fromId,merge.toId]));
  const relations=(value:unknown):string[]|undefined=>{
    if(value!==undefined&&!Array.isArray(value))return undefined;
    const result:string[]=[];
    for(const reference of strings(value,100,160)){
      const matches=labels.get(canonicalTagKey(reference)),resolved=ids.get(reference)??redirects.get(reference)??(active.has(reference)?reference:matches?.size===1?[...matches][0]:undefined);
      if(!resolved)return undefined;
      if(active.has(resolved)&&!result.includes(resolved))result.push(resolved);
    }
    return result;
  };
  for(const tag of proposal.tags){
    if(tag.custom)continue;
    const key=proposal.candidateKeys?.[tag.id]??[...ids].find(([,id])=>id===tag.id)?.[0],candidate=key&&originals.get(key);
    if(!candidate||typeof candidate.name!=='string'||typeof candidate.description!=='string'){edited.add(tag.id);continue;}
    const naming=preferredCoreNaming(text(candidate.name,80),text(candidate.fullName,160)||text(candidate.name,80),strings(candidate.aliases,100,160),1);
    const inherited=state.tags.filter(previous=>previous.id===tag.id||redirects.get(previous.id)===tag.id).flatMap(previous=>previous.status==='approved'?[previous.name,previous.fullName??'',...previous.aliases]:[previous.name,previous.fullName??'']);
    const aliases=[...new Set([...naming.aliases,...inherited])].filter(value=>value&&value!==naming.name&&value!==naming.fullName);
    const broaderIds=relations(candidate.parentKeys??candidate.broaderKeys??candidate.broaderIds??candidate.broaderNames),relatedIds=relations(candidate.relatedKeys??candidate.relatedIds??candidate.relatedNames);
    if(!broaderIds||!relatedIds){edited.add(tag.id);continue;}
    const baseline={name:naming.name,fullName:naming.fullName,description:text(candidate.description),facet:candidate.facet,aliases,inclusions:strings(candidate.inclusions),exclusions:strings(candidate.exclusions),examples:strings(candidate.examples,20),broaderIds,relatedIds};
    const savedBaseline={...baseline,aliases:aliases.slice(0,40).filter(alias=>canonicalTagKey(alias)!==canonicalTagKey(naming.name)),inclusions:baseline.inclusions.slice(0,20),exclusions:baseline.exclusions.slice(0,20)};
    const current={name:tag.name,fullName:tag.fullName??tag.name,description:tag.description,facet:tag.facet,aliases:tag.aliases,inclusions:tag.inclusions,exclusions:tag.exclusions,examples:tag.examples,broaderIds:tag.broaderIds.filter(id=>active.has(id)),relatedIds:(tag.relatedIds??[]).filter(id=>active.has(id))};
    if(fingerprint(baseline)!==fingerprint(current)&&fingerprint(savedBaseline)!==fingerprint(current))edited.add(tag.id);
  }
  return [...edited];
}

function definitionFingerprint(tag:TagDefinition):string {
  return fingerprint({id:tag.id,name:tag.name,fullName:tag.fullName??'',description:tag.description,facet:tag.facet,aliases:tag.aliases,inclusions:tag.inclusions,exclusions:tag.exclusions,examples:tag.examples,custom:tag.custom,status:tag.status,broaderIds:tag.broaderIds,relatedIds:tag.relatedIds??[],matchingMode:tag.matchingMode??(tag.custom?'suggest':'auto')});
}

/** A missing baseline proves nothing about the origin or edit history of a draft. */
export function cleanupLegacyDraftDefinitions(state:CleanupState,baseline:readonly TagDefinition[]=[]):LegacyCleanupResult {
  const known=new Set(state.tags.map(tag=>tag.id)),protectedIds=new Set(state.userEditedTagIds??[]);
  const originals=new Map(baseline.map(tag=>[tag.id,tag]));
  const eligible=new Set(state.tags.filter(tag=>!tag.custom&&tag.status==='draft'&&tag.id.startsWith('tag-')&&originals.has(tag.id)&&definitionFingerprint(tag)===definitionFingerprint(originals.get(tag.id)!)).map(tag=>tag.id));
  const add=(id:unknown)=>{if(typeof id==='string'&&known.has(id))protectedIds.add(id);};
  const walk=(value:unknown,seen=new Set<object>())=>{
    if(typeof value==='string'){add(value);return;}
    if(!value||typeof value!=='object'||seen.has(value))return;
    seen.add(value);
    if(Array.isArray(value))for(const entry of value)walk(entry,seen);
    else for(const [key,entry] of Object.entries(value)){add(key);if(key.includes('|'))add(key.slice(key.lastIndexOf('|')+1));walk(entry,seen);}
  };
  for(const tag of state.tags)if(!eligible.has(tag.id))add(tag.id);
  for(const value of [state.decisions,state.ownership,state.history,state.pendingChange,state.suggestions,state.taxonomyArchives,state.taxonomyRedirects,state.taxonomySupport])walk(value);
  const proposal=state.taxonomyProposal;
  if(proposal)for(const value of [proposal.tags,proposal.merges,proposal.mappingConfirmations])walk(value);
  for(const entry of state.preparationHistory??[])for(const value of [entry.proposal.tags,entry.proposal.merges,entry.proposal.mappingConfirmations])walk(value);
  if(state.run){add(state.run.detailId);walk(state.run.jobs);}
  for(let size=-1;size!==protectedIds.size;){size=protectedIds.size;for(const tag of state.tags)if(protectedIds.has(tag.id)){walk(tag.broaderIds);walk(tag.relatedIds);}}
  const removedIds=state.tags.filter(tag=>eligible.has(tag.id)&&!protectedIds.has(tag.id)).map(tag=>tag.id);
  const removed=new Set(removedIds);
  return {tags:state.tags.filter(tag=>!removed.has(tag.id)),removedIds};
}

/** Derived coverage for a removed candidate is not an evidence/history record. */
export function pruneProposalSupport(proposal:TaxonomyProposal|null):void {
  if(!proposal)return;
  const active=new Set(proposal.tags.map(tag=>tag.id));
  proposal.support=Object.fromEntries(Object.entries(proposal.support).filter(([id])=>active.has(id)));
}
