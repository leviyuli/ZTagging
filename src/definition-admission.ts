import {canonicalTagKey} from './core.ts';
import type {TagDefinition} from './core.ts';
import {validateRegistrySnapshot} from './evidence.ts';
import {isNoTagDefinition} from './tag-policy.ts';
import {conceptMappingFingerprint,createProposalIssueEvaluator,refreshProposalEvidence,validateTaxonomy} from './taxonomy.ts';
import type {TaxonomyProposal} from './taxonomy.ts';
import type {TagPreparationState} from './tag-preparation.ts';

export type AdmissionReview=Pick<TaxonomyProposal,'mappingConfirmations'|'validatedEvidenceLinks'|'evidenceMeaningFingerprints'|'evidenceScientificIdentities'|'paperFingerprints'|'paperInputFingerprints'|'machineDecisions'|'preparationPolicyVersion'|'mappingPolicyVersion'|'mappedSourceIds'|'inheritanceReviewSourceIds'|'retainedDefinitionIds'|'verificationScope'|'tagPolicyVersion'>;
export interface CompiledDefinitionAdmission {
  definitions:TagDefinition[];
  tagIds:string[];
  deferredIds:string[];
  support:TaxonomyProposal['support'];
  review:AdmissionReview;
}
export interface DefinitionAdmissionOptions {pendingTagIds?:readonly string[]}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const labels=(tag:TagDefinition)=>[tag.name,tag.fullName??'',...tag.aliases].filter(Boolean);

/** Compile additions without consuming the frozen proposal or its unanswered questions. */
export function compileReadyPreparedDefinitions(input:TaxonomyProposal,preparation:TagPreparationState,currentDefinitions:readonly TagDefinition[],options:DefinitionAdmissionOptions={}):CompiledDefinitionAdmission {
  const current=new Map(currentDefinitions.map(tag=>[tag.id,tag]));
  const candidates=input.tags.filter(tag=>!current.has(tag.id)&&!Object.hasOwn(preparation.admissions??{},tag.id)&&!isNoTagDefinition(tag));
  const empty=():CompiledDefinitionAdmission=>({definitions:[],tagIds:[],deferredIds:candidates.map(tag=>tag.id),support:{},review:{}});
  if(preparation.processingPolicy!=='auto-clear'||input.protocolVersion!==2||!input.evidenceSnapshot||preparation.proposalId!==input.id||preparation.snapshotId!==input.evidenceSnapshot.id||preparation.policyVersion!==(input.mappingPolicyVersion===3?3:2)||validateRegistrySnapshot(input.evidenceSnapshot).length)return empty();
  const proposal=refreshProposalEvidence(clone(input)),isBlocking=createProposalIssueEvaluator(proposal);
  if(proposal.externalIssues?.length||proposal.validationIssues?.some(issue=>!issue.tagId&&isBlocking(issue)))return empty();
  const blocked=new Set([...(options.pendingTagIds??[]),...(preparation.skippedTagIds??[])]);
  for(const question of preparation.questions)if(question.tagId&&!preparation.answers[question.id])blocked.add(question.tagId);
  for(const excluded of preparation.excluded)if(excluded.origin==='researcher')blocked.add(excluded.tagId);
  for(const issue of proposal.validationIssues??[])if(issue.tagId&&isBlocking(issue))blocked.add(issue.tagId);
  for(const relationship of proposal.unresolvedRelationships??[])if(relationship.kind==='parent')blocked.add(relationship.tagId);
  for(const merge of proposal.unresolvedMerges??[]){blocked.add(merge.fromId);for(const tag of candidates)if(tag.id===merge.toReference||labels(tag).includes(merge.toReference))blocked.add(tag.id);}

  const claims=new Map<string,Set<string>>();
  for(const tag of [...currentDefinitions,...candidates])for(const label of labels(tag)){const key=canonicalTagKey(label),owners=claims.get(key)??new Set<string>();owners.add(tag.id);claims.set(key,owners);}
  for(const tag of candidates)if(labels(tag).some(label=>(claims.get(canonicalTagKey(label))?.size??0)>1))blocked.add(tag.id);
  const available=new Map(candidates.filter(tag=>!blocked.has(tag.id)).map(tag=>[tag.id,tag]));
  const proposed=new Map(proposal.tags.map(tag=>[tag.id,tag]));
  const context=currentDefinitions.filter(tag=>!isNoTagDefinition(tag)&&(!proposed.has(tag.id)||conceptMappingFingerprint(tag)===conceptMappingFingerprint(proposed.get(tag.id)!)));
  let scoped:TaxonomyProposal=proposal;
  for(let pass=0;pass<=candidates.length;pass++){
    let changed=false;
    for(const [id,tag] of available)if(tag.broaderIds.some(parent=>!current.has(parent)&&!available.has(parent)||current.has(parent)&&proposed.has(parent)&&conceptMappingFingerprint(current.get(parent)!)!==conceptMappingFingerprint(proposed.get(parent)!))){available.delete(id);changed=true;}
    const known=new Set([...current.keys(),...available.keys()]);
    scoped=clone(proposal);
    scoped.tags=[...context.map(clone),...available.values()].map(tag=>({...clone(tag),relatedIds:(tag.relatedIds??[]).filter(id=>known.has(id))}));
    scoped.unresolvedRelationships=scoped.unresolvedRelationships?.filter(value=>known.has(value.tagId)&&value.kind==='parent');
    refreshProposalEvidence(scoped);
    const scopedBlocking=createProposalIssueEvaluator(scoped);
    for(const [id] of available)if(!(scoped.support[id]?.sourceIds?.length)||scoped.validationIssues?.some(issue=>issue.tagId===id&&scopedBlocking(issue))){available.delete(id);changed=true;}
    if(!changed)break;
  }
  const selected=new Set(available.keys()),known=new Set([...current.keys(),...selected]);
  const definitions=candidates.filter(tag=>selected.has(tag.id)).map(tag=>({...clone(tag),status:'approved' as const,relatedIds:(tag.relatedIds??[]).filter(id=>known.has(id))}));
  const inheritedProblems=new Set(validateTaxonomy(currentDefinitions));
  if(validateTaxonomy([...currentDefinitions,...definitions]).some(problem=>!inheritedProblems.has(problem)))return empty();
  const support=Object.fromEntries(definitions.map(tag=>[tag.id,clone(scoped.support[tag.id])]));
  const paperIds=new Set(Object.values(support).flatMap(value=>value.paperIds));
  const tagRecords=<T>(records:Record<string,T>|undefined)=>records?Object.fromEntries(Object.entries(records).filter(([id])=>selected.has(id)).map(([id,value])=>[id,clone(value)])):undefined;
  const paperRecords=(records:Record<string,string>|undefined)=>records?Object.fromEntries(Object.entries(records).filter(([id])=>paperIds.has(id))):undefined;
  const review:AdmissionReview={
    mappingConfirmations:tagRecords(scoped.mappingConfirmations),validatedEvidenceLinks:tagRecords(scoped.validatedEvidenceLinks),evidenceMeaningFingerprints:tagRecords(scoped.evidenceMeaningFingerprints),evidenceScientificIdentities:tagRecords(scoped.evidenceScientificIdentities),
    mappedSourceIds:tagRecords(scoped.mappedSourceIds),inheritanceReviewSourceIds:tagRecords(scoped.inheritanceReviewSourceIds),
    machineDecisions:scoped.machineDecisions?Object.fromEntries(Object.entries(scoped.machineDecisions).filter(([,decision])=>selected.has(decision.tagId)).map(([key,value])=>[key,clone(value)])):undefined,
    paperFingerprints:paperRecords(scoped.paperFingerprints),paperInputFingerprints:paperRecords(scoped.paperInputFingerprints),
    retainedDefinitionIds:scoped.retainedDefinitionIds?.filter(id=>selected.has(id)),
    preparationPolicyVersion:scoped.preparationPolicyVersion,mappingPolicyVersion:scoped.mappingPolicyVersion,verificationScope:scoped.verificationScope,tagPolicyVersion:scoped.tagPolicyVersion,
  };
  return {definitions,tagIds:definitions.map(tag=>tag.id),deferredIds:candidates.filter(tag=>!selected.has(tag.id)).map(tag=>tag.id),support,review};
}
