import {allocateOpaqueId,canonicalTagKey,FACETS,fingerprint} from './core.ts';
import type {TagDefinition} from './core.ts';
import {terminologyFor,terminologyKey} from './naming.ts';
import {isNoTagDefinition} from './tag-policy.ts';
import {conceptMappingFingerprint,conceptMeaningFingerprint,refreshProposalEvidence,semanticDecisionKey,validateTaxonomy,validMappedSourceDecision} from './taxonomy.ts';
import type {TaxonomyProposal,TaxonomySupport} from './taxonomy.ts';

export interface VocabularyBaseline {version:number;fingerprint:string;definitions:TagDefinition[]}
export interface VocabularyExtensionContext {baseline:VocabularyBaseline;relatedIds:Record<string,string[]>}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const labels=(tag:TagDefinition)=>[tag.name,tag.fullName??'',...tag.aliases].filter(Boolean);
const labelKey=(value:string)=>{const normalized=value.normalize('NFC').trim().replace(/\s+/g,' ');return normalized.length>160?normalized:canonicalTagKey(normalized);};
const baselineFingerprint=(version:number,definitions:readonly TagDefinition[])=>fingerprint({version,definitions});
const issuePrefix='Extension conflict: ';

export function captureVocabularyBaseline(definitions:readonly TagDefinition[],version:number):VocabularyBaseline {
  const retained=clone(definitions.filter(tag=>!isNoTagDefinition(tag)&&(tag.custom||tag.status==='approved')));
  return {version,fingerprint:baselineFingerprint(version,retained),definitions:retained};
}
export function validVocabularyBaseline(value:unknown):value is VocabularyBaseline {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const baseline=value as VocabularyBaseline;
  return Number.isInteger(baseline.version)&&baseline.version>=0&&typeof baseline.fingerprint==='string'&&Array.isArray(baseline.definitions)&&baseline.definitions.every(tag=>tag&&typeof tag.id==='string'&&typeof tag.name==='string'&&typeof tag.description==='string'&&(tag.fullName===undefined||typeof tag.fullName==='string')&&typeof tag.custom==='boolean'&&FACETS.includes(tag.facet)&&['draft','approved'].includes(tag.status)&&(tag.custom||tag.status==='approved')&&(tag.matchingMode===undefined||['manual','suggest','auto'].includes(tag.matchingMode))&&['aliases','broaderIds','inclusions','exclusions','examples'].every(key=>Array.isArray(tag[key as keyof TagDefinition])&&(tag[key as keyof TagDefinition] as unknown[]).every(value=>typeof value==='string'))&&(tag.relatedIds===undefined||Array.isArray(tag.relatedIds)&&tag.relatedIds.every(id=>typeof id==='string'))&&!isNoTagDefinition(tag))&&baseline.fingerprint===baselineFingerprint(baseline.version,baseline.definitions);
}
function identity(tag:TagDefinition):string|undefined {
  const preferred=terminologyFor(tag.name)?.name,expanded=terminologyFor(tag.fullName??'')?.name;
  return preferred&&expanded&&preferred!==expanded?undefined:preferred??expanded;
}
function equivalent(candidate:TagDefinition,existing:TagDefinition):boolean {
  const named=terminologyFor(candidate.name)?.name,expanded=terminologyFor(candidate.fullName??'')?.name;
  if(named&&expanded&&named!==expanded)return false;
  if(named&&!expanded&&candidate.fullName&&labelKey(candidate.fullName)!==labelKey(candidate.name)&&!labels(existing).some(label=>labelKey(label)===labelKey(candidate.fullName!)))return false;
  const candidateIdentity=identity(candidate),existingIdentity=identity(existing);
  if(candidateIdentity&&existingIdentity)return candidateIdentity===existingIdentity;
  if(candidate.facet!==existing.facet)return false;
  const candidateFull=candidate.fullName?.trim(),existingFull=existing.fullName?.trim();
  if(candidateFull&&existingFull&&labelKey(candidateFull)===labelKey(existingFull))return true;
  if(candidateFull&&candidateFull.split(/\s+/).length>1&&labels(existing).some(label=>labelKey(candidateFull)===labelKey(label)))return true;
  const matches=labels(candidate).some(label=>labels(existing).some(other=>labelKey(label)===labelKey(other)));
  return matches&&(!candidateFull||labelKey(candidateFull)===labelKey(candidate.name))&&(!existingFull||labelKey(existingFull)===labelKey(existing.name));
}
function combinedDefinitions(proposal:TaxonomyProposal,baseline:VocabularyBaseline):TagDefinition[] {
  const existingIds=new Set(baseline.definitions.map(tag=>tag.id)),context=proposal.extension?.relatedIds??{};
  return [...clone(baseline.definitions),...proposal.tags.filter(tag=>!existingIds.has(tag.id)).map(tag=>({...clone(tag),status:'approved' as const,relatedIds:[...new Set([...(tag.relatedIds??[]),...(context[tag.id]??[])])]}))];
}
function unionSupport(left:TaxonomySupport|undefined,right:TaxonomySupport|undefined):TaxonomySupport {
  return {registryIds:[...new Set([...(left?.registryIds??[]),...(right?.registryIds??[])])],sourceIds:[],paperIds:[],evidence:[]};
}

/** Reconcile only the current sample; prior evidence never enters its support snapshot. */
export function reconcileExtensionProposal(input:TaxonomyProposal,baseline:VocabularyBaseline):TaxonomyProposal {
  if(!validVocabularyBaseline(baseline))throw new Error('The applied tag-list baseline is invalid. Start Extend again from the current tag library.');
  if(input.extension&&input.extension.baseline.fingerprint!==baseline.fingerprint)throw new Error('The extension baseline changed. Start Extend again from the current tag library.');
  const proposal=clone(input),byId=new Map(baseline.definitions.map(tag=>[tag.id,tag])),redirects=new Map<string,string>(),selected=new Map<string,TagDefinition>(),support:Record<string,TaxonomySupport>={},context=clone(proposal.extension?.relatedIds??{}),original=proposal.tags;
  proposal.candidateIds??={};proposal.candidateKeys??={};
  for(const tag of original){
    const matches=baseline.definitions.filter(existing=>equivalent(tag,existing)),target=matches.length===1?matches[0]:undefined;
    let id=target?.id??tag.id;
    if(!target&&byId.has(id)){
      const key=proposal.candidateKeys[id]??id,allocated=proposal.candidateIds[key];id=allocated&&!byId.has(allocated)?allocated:allocateOpaqueId('tag');proposal.candidateIds[key]=id;proposal.candidateKeys[id]=key;delete proposal.candidateKeys[tag.id];
    }
    if(target&&conceptMeaningFingerprint(target)!==conceptMeaningFingerprint(tag)){
      (proposal.evidenceMeaningFingerprints??={})[id]=conceptMeaningFingerprint(target);delete proposal.validatedEvidenceLinks?.[id];delete proposal.mappingConfirmations?.[id];
    }
    const key=proposal.candidateKeys[tag.id];if(key&&id!==tag.id){proposal.candidateKeys[id]=key;proposal.candidateIds[key]=id;delete proposal.candidateKeys[tag.id];}
    redirects.set(tag.id,id);selected.set(id,target?clone(target):{...clone(tag),id});support[id]=unionSupport(support[id],proposal.support[tag.id]);
    if(id!==tag.id&&context[tag.id]){context[id]=[...new Set([...(context[id]??[]),...context[tag.id]])];delete context[tag.id];}
  }
  const resolveBaseline=(reference:string)=>{
    if(byId.has(reference))return reference;
    const matches=baseline.definitions.filter(tag=>labels(tag).some(label=>labelKey(label)===labelKey(reference)||terminologyFor(label)&&terminologyKey(label)===terminologyKey(reference)));
    return matches.length===1?matches[0].id:undefined;
  };
  for(const tag of selected.values())if(!byId.has(tag.id)){
    tag.broaderIds=[...new Set(tag.broaderIds.map(id=>redirects.get(id)??id))];tag.relatedIds=[...new Set((tag.relatedIds??[]).map(id=>redirects.get(id)??id))];
    tag.aliases=tag.aliases.filter(alias=>!baseline.definitions.some(existing=>labels(existing).some(label=>labelKey(alias)===labelKey(label))));
  }
  proposal.unresolvedRelationships=(proposal.unresolvedRelationships??[]).flatMap(relationship=>{
    const tagId=redirects.get(relationship.tagId)??relationship.tagId,tag=selected.get(tagId),target=resolveBaseline(relationship.reference);
    if(!tag||byId.has(tagId))return [];
    if(!target)return [{...relationship,tagId}];
    if(relationship.kind==='parent')tag.broaderIds=[...new Set([...tag.broaderIds,target])];else tag.relatedIds=[...new Set([...(tag.relatedIds??[]),target])];return [];
  });
  const required=new Set<string>();
  const includeParent=(id:string)=>{if(required.has(id)||!byId.has(id))return;required.add(id);for(const parent of byId.get(id)!.broaderIds)includeParent(parent);};
  for(const tag of selected.values()){
    if(byId.has(tag.id)&&(support[tag.id]?.registryIds?.length??0)>0)includeParent(tag.id);
    if(!byId.has(tag.id))for(const parent of tag.broaderIds)includeParent(parent);
  }
  for(const id of required){selected.set(id,clone(byId.get(id)!));support[id]??={registryIds:[],sourceIds:[],paperIds:[],evidence:[]};}
  for(const id of [...selected.keys()])if(byId.has(id)&&!required.has(id)){selected.delete(id);delete support[id];}
  for(const tag of selected.values()){
    if(byId.has(tag.id)){tag.broaderIds=tag.broaderIds.filter(id=>selected.has(id));tag.relatedIds=(tag.relatedIds??[]).filter(id=>selected.has(id));continue;}
    const contextual=[...(context[tag.id]??[]),...(tag.relatedIds??[]).filter(id=>byId.has(id))];context[tag.id]=[...new Set(contextual)];tag.relatedIds=(tag.relatedIds??[]).filter(id=>!byId.has(id));
  }
  proposal.tags=[...selected.values()];proposal.support=support;proposal.extension={baseline:clone(baseline),relatedIds:Object.fromEntries(Object.entries(context).filter(([id])=>selected.has(id)))};
  if(proposal.retainedDefinitionIds)proposal.retainedDefinitionIds=[...new Set(proposal.retainedDefinitionIds.map(id=>redirects.get(id)??id))].filter(id=>selected.has(id));
  if(proposal.mappingPolicyVersion===3){
    const mapped:Record<string,string[]>={};
    for(const [oldId,sources] of Object.entries(proposal.mappedSourceIds??{})){const id=redirects.get(oldId)??oldId;if(selected.has(id))mapped[id]=[...new Set([...(mapped[id]??[]),...sources])];}
    proposal.mappedSourceIds=mapped;
    if(proposal.inheritanceReviewSourceIds){const reviewed:Record<string,string[]>={};for(const [oldId,sources] of Object.entries(proposal.inheritanceReviewSourceIds)){const id=redirects.get(oldId)??oldId;if(selected.has(id))reviewed[id]=[...new Set([...(reviewed[id]??[]),...sources])];}proposal.inheritanceReviewSourceIds=reviewed;}
    proposal.machineDecisions=Object.fromEntries(Object.values(proposal.machineDecisions??{}).map(decision=>{const tagId=redirects.get(decision.tagId)??decision.tagId,updated={...decision,tagId};return [semanticDecisionKey(tagId,updated.sourceId),updated];}));
  }
  proposal.merges=proposal.merges.filter(merge=>!byId.has(merge.fromId)).map(merge=>({...merge,toId:redirects.get(merge.toId)??merge.toId}));
  proposal.unresolvedMerges=proposal.unresolvedMerges?.filter(merge=>!byId.has(merge.fromId));
  proposal.validationIssues=proposal.validationIssues?.filter(issue=>!issue.tagId||!redirects.has(issue.tagId)||selected.has(redirects.get(issue.tagId)!)).map(issue=>({...issue,...(issue.tagId?{tagId:redirects.get(issue.tagId)??issue.tagId}:{})}));
  const conflicts=validateTaxonomy(combinedDefinitions(proposal,baseline),proposal.coreLimit);
  proposal.externalIssues=[...(proposal.externalIssues??[]).filter(message=>!message.startsWith(issuePrefix)),...conflicts.map(message=>issuePrefix+message)];
  proposal.excluded=proposal.excluded.filter(excluded=>!baseline.definitions.some(tag=>labels(tag).some(label=>labelKey(label)===labelKey(excluded.name))));
  return proposal;
}

/** Refresh pending additions against the saved library without importing its old support. */
export function refreshExtensionProposal(input:TaxonomyProposal,currentDefinitions:readonly TagDefinition[],currentVersion:number):TaxonomyProposal {
  const previous=input.extension?.baseline;
  if(!validVocabularyBaseline(previous))throw new Error('This tag extension has no valid saved list to refresh.');
  const baseline=captureVocabularyBaseline(currentDefinitions,currentVersion),current=new Map(baseline.definitions.map(tag=>[tag.id,tag])),old=new Map(previous.definitions.map(tag=>[tag.id,tag])),proposal=clone(input);
  const changed=new Set(previous.definitions.filter(tag=>!current.has(tag.id)||conceptMappingFingerprint(tag)!==conceptMappingFingerprint(current.get(tag.id)!)).map(tag=>tag.id));
  const newTags=proposal.tags.filter(tag=>!old.has(tag.id)&&!current.has(tag.id)),deferred=new Set<string>(),claims=new Map<string,Set<string>>();
  for(const tag of [...baseline.definitions,...newTags])for(const label of labels(tag)){const key=labelKey(label),owners=claims.get(key)??new Set<string>();owners.add(tag.id);claims.set(key,owners);}
  const conflicts=(label:string,id:string)=>[...(claims.get(labelKey(label))??[])].some(owner=>owner!==id);
  const scientificConflict=(tag:TagDefinition)=>{const named=terminologyFor(tag.name)?.name,expanded=terminologyFor(tag.fullName??'')?.name,meaning=named??expanded;return !!(named&&expanded&&named!==expanded||meaning&&tag.aliases.some(alias=>{const other=terminologyFor(alias)?.name;return other&&other!==meaning;}));};
  if(newTags.some(scientificConflict))throw new Error('A proposed tag combines scientifically distinct meanings. Correct its name or other names before refreshing.');
  for(const tag of newTags)tag.aliases=tag.aliases.filter(alias=>!conflicts(alias,tag.id));
  claims.clear();
  for(const tag of [...baseline.definitions,...newTags])for(const label of current.has(tag.id)?labels(tag):[tag.name,tag.fullName??tag.name]){const key=labelKey(label),owners=claims.get(key)??new Set<string>();owners.add(tag.id);claims.set(key,owners);}
  for(const tag of newTags){
    if(baseline.definitions.filter(saved=>equivalent(tag,saved)).length===1)continue;
    const fullName=tag.fullName??tag.name;
    if(![tag.name,fullName].some(label=>conflicts(label,tag.id)))continue;
    if(fullName.length<=80&&!conflicts(fullName,tag.id))tag.name=fullName;
    else {deferred.add(tag.id);proposal.excluded.push({name:tag.name,reason:'Left out because this name now refers to a different saved or proposed tag. Its original findings are retained.'});}
  }
  const remaining=newTags.filter(tag=>!deferred.has(tag.id)),allowed=new Set([...current.keys(),...remaining.map(tag=>tag.id)]),unavailable=new Set([...changed,...deferred]);
  const validTarget=(id:string)=>allowed.has(id)&&!unavailable.has(id);
  for(const tag of remaining){tag.broaderIds=tag.broaderIds.filter(validTarget);tag.relatedIds=(tag.relatedIds??[]).filter(validTarget);}
  const oldReferenceKeys=new Set([...previous.definitions.filter(tag=>changed.has(tag.id)),...newTags.filter(tag=>deferred.has(tag.id))].flatMap(tag=>[tag.id,...labels(tag)].map(labelKey)));
  proposal.unresolvedRelationships=proposal.unresolvedRelationships?.filter(relationship=>allowed.has(relationship.tagId)&&!oldReferenceKeys.has(labelKey(relationship.reference)));
  proposal.extension={baseline,relatedIds:Object.fromEntries(Object.entries(proposal.extension?.relatedIds??{}).filter(([id])=>remaining.some(tag=>tag.id===id)).map(([id,ids])=>[id,ids.filter(validTarget)]))};
  proposal.baseVersion=currentVersion;proposal.tags=[...clone(baseline.definitions),...remaining];
  for(const id of [...old.keys(),...deferred])if(!current.has(id)||changed.has(id)){
    delete proposal.support[id];delete proposal.mappedSourceIds?.[id];delete proposal.inheritanceReviewSourceIds?.[id];delete proposal.mappingConfirmations?.[id];delete proposal.validatedEvidenceLinks?.[id];delete proposal.evidenceMeaningFingerprints?.[id];delete proposal.evidenceScientificIdentities?.[id];
  }
  proposal.machineDecisions=Object.fromEntries(Object.entries(proposal.machineDecisions??{}).filter(([,decision])=>allowed.has(decision.tagId)&&!unavailable.has(decision.tagId)));
  proposal.merges=proposal.merges.filter(merge=>!old.has(merge.fromId)&&allowed.has(merge.toId));
  proposal.unresolvedMerges=proposal.unresolvedMerges?.filter(merge=>!old.has(merge.fromId));
  const refreshed=reconcileExtensionProposal(proposal,baseline),statuses=new Map(refreshed.tags.map(tag=>[tag.id,tag.status]));
  refreshed.tags=combinedDefinitions(refreshed,baseline).map(tag=>current.has(tag.id)?clone(current.get(tag.id)!):{...tag,status:statuses.get(tag.id)??tag.status});
  refreshed.retainedDefinitionIds=[...new Set([...baseline.definitions.map(tag=>tag.id),...(input.retainedDefinitionIds??[]).filter(id=>refreshed.tags.some(tag=>tag.id===id))])];
  if(refreshed.mappingPolicyVersion===3)for(const tag of baseline.definitions){
    const sources=(refreshed.mappedSourceIds?.[tag.id]??[]).filter(id=>validMappedSourceDecision(refreshed,tag,id));
    (refreshed.mappedSourceIds??={})[tag.id]=sources;
    refreshed.support[tag.id]={paperIds:[],sourceIds:[],evidence:[],registryIds:[...new Set(sources.map(id=>validMappedSourceDecision(refreshed,tag,id)!.registryId))]};
    if(refreshed.inheritanceReviewSourceIds?.[tag.id])refreshed.inheritanceReviewSourceIds[tag.id]=refreshed.inheritanceReviewSourceIds[tag.id].filter(id=>sources.includes(id));
  }
  return refreshProposalEvidence(refreshed);
}
/** Apply a ready addition set without replacing any previously applied definition. */
export function composeExtendedVocabulary(proposal:TaxonomyProposal,baseline:VocabularyBaseline|undefined=proposal.extension?.baseline):TagDefinition[] {
  if(!validVocabularyBaseline(baseline)||proposal.extension?.baseline.fingerprint!==baseline.fingerprint)throw new Error('The extension baseline changed. Prepare this tag list again.');
  const definitions=combinedDefinitions(proposal,baseline),issues=validateTaxonomy(definitions,proposal.coreLimit);if(issues.length)throw new Error(issues.join(' '));return definitions;
}
