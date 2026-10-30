import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot} from '../src/evidence.ts';
import {conceptMappingFingerprint,conceptMeaningFingerprint,createTaxonomyProposal,refreshProposalEvidence,semanticDecisionKey} from '../src/taxonomy.ts';
import type {PaperFacts,TaxonomyProposal} from '../src/taxonomy.ts';
import {prepare} from '../src/tag-preparation.ts';
import {captureVocabularyBaseline,reconcileExtensionProposal} from '../src/vocabulary-extension.ts';

function fixture(scope:NonNullable<TaxonomyProposal['verificationScope']>){
  const facts:PaperFacts[]=['reviewed','unexamined'].map(paperId=>({paperId,metadataFingerprint:`metadata-${paperId}`,inputFingerprint:`metadata-${paperId}`,provider:'retained-provider',model:'retained-model',extractionVersion:1,summary:'A synthetic method study.',needsPDF:false,concepts:[{name:'ML',facet:'method',evidence:[{source:'abstract',text:paperId==='reviewed'?'ML explicitly means machine learning in this synthetic experiment.':'This synthetic paper reports an unexpanded ML acronym.'}]}]})),snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),proposal=createTaxonomyProposal({tags:[{key:'method',name:'ML',fullName:'machine learning',description:'Machine learning methods.',facet:'method',supportRegistryIds:Object.keys(snapshot.entries)}]},facts,[],{snapshot}),tag=proposal.tags[0],source=Object.values(snapshot.sources).find(source=>source.paperId==='reviewed')!,registryId=Object.keys(snapshot.entries)[0];
  proposal.mappingPolicyVersion=3;proposal.verificationScope=scope;proposal.mappedSourceIds={[tag.id]:[source.factConceptId]};proposal.machineDecisions={[semanticDecisionKey(tag.id,source.factConceptId)]:{tagId:tag.id,sourceId:source.factConceptId,registryId,snapshotId:snapshot.id,meaningFingerprint:conceptMeaningFingerprint(tag),tagFingerprint:conceptMappingFingerprint(tag),sourceFingerprint:fingerprint(source),policyVersion:3,relation:'equivalent',reason:'The exact reviewed quotation establishes machine learning.',origin:'ai',provider:'synthetic-provider',model:'synthetic-model'}};
  return {proposal,facts,tag};
}

test('verification scope labels never expand proof from a reviewed example to an unexamined source',()=>{
  for(const scope of ['representative','exhaustive'] as const){const {proposal,tag}=fixture(scope),before=fingerprint(proposal.evidenceSnapshot),result=prepare(proposal);assert.equal(result.proposal.verificationScope,scope);assert.equal(result.state.status,'ready');assert.deepEqual(result.proposal.support[tag.id].paperIds,['reviewed']);assert.deepEqual(result.state.questions,[]);assert.equal(fingerprint(result.proposal.evidenceSnapshot),before);}
});

test('omitting an ambiguous sample keeps its audit without questioning a concept grounded by another exact example',()=>{
  const {proposal,tag}=fixture('representative'),source=Object.values(proposal.evidenceSnapshot!.sources).find(value=>value.paperId==='unexamined')!,key=semanticDecisionKey(tag.id,source.factConceptId),positive=Object.values(proposal.machineDecisions!)[0];
  proposal.mappedSourceIds![tag.id].push(source.factConceptId);proposal.machineDecisions![key]={...positive,sourceId:source.factConceptId,sourceFingerprint:fingerprint(source),relation:'needs-context',reason:'The exact sampled passage does not expand ML.'};
  const initial=prepare(proposal);assert.equal(initial.state.status,'questions');assert.equal(initial.state.questions.length,1);
  initial.proposal.mappedSourceIds![tag.id]=initial.proposal.mappedSourceIds![tag.id].filter(id=>id!==source.factConceptId);const result=prepare(initial.proposal,initial.state);
  assert.equal(result.state.status,'ready');assert.deepEqual(result.state.questions,[]);assert.deepEqual(result.proposal.support[tag.id].paperIds,['reviewed']);assert.deepEqual(result.proposal.machineDecisions![key],proposal.machineDecisions![key]);
});

test('representative scope and exact positive links survive JSON and invalid-merge recovery',()=>{
  const {proposal,facts,tag}=fixture('representative');proposal.unresolvedMerges=[{fromId:'missing-legacy-id',toReference:'unknown-output',reason:'A historical invalid merge.'}];const result=prepare(JSON.parse(JSON.stringify(proposal)),undefined,{facts,existingDefinitions:[]});assert.equal(result.proposal.verificationScope,'representative');assert.equal(result.proposal.mappingPolicyVersion,3);assert.deepEqual(result.proposal.mappedSourceIds,proposal.mappedSourceIds);assert.deepEqual(result.proposal.support[tag.id].paperIds,['reviewed']);assert.equal(result.state.status,'ready');
});

test('extension reconciliation retains the verification scope while preserving source-specific evidence',()=>{
  const {proposal,tag}=fixture('representative'),old={...structuredClone(tag),id:'applied-learning',status:'approved' as const},baseline=captureVocabularyBaseline([old],4),extended=reconcileExtensionProposal(proposal,baseline);refreshProposalEvidence(extended);assert.equal(extended.verificationScope,'representative');assert.deepEqual(extended.support[old.id].paperIds,['reviewed']);assert.deepEqual(extended.mappedSourceIds![old.id],proposal.mappedSourceIds![tag.id]);
});
