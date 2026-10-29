import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import type {TagDefinition} from '../src/core.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot} from '../src/evidence.ts';
import {conceptMappingFingerprint,conceptMeaningFingerprint,confirmProposalMapping,confirmProposalMappings,createTaxonomyProposal,refreshProposalEvidence,removeProposalEvidenceLinks,semanticDecisionKey,validMappedSourceDecision} from '../src/taxonomy.ts';
import type {MachineEvidenceDecision,PaperFacts,TaxonomyProposal} from '../src/taxonomy.ts';
import {answer,prepare} from '../src/tag-preparation.ts';
import {captureVocabularyBaseline,reconcileExtensionProposal} from '../src/vocabulary-extension.ts';

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const fact=(paperId:string,name:string,quote:string):PaperFacts=>({paperId,metadataFingerprint:`metadata-${paperId}`,inputFingerprint:`metadata-${paperId}`,provider:'original-provider',model:'original-model',extractionVersion:1,summary:quote,needsPDF:false,concepts:[{name,facet:'method',evidence:[{source:'abstract',text:quote}]}]});
function fixture(facts=[fact('learning','ML','ML predicts electrode properties with machine learning.'),fact('loss','ML','ML denotes mass loss during electrode corrosion.')],name='ML',fullName='machine learning'){
  const snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),proposal=createTaxonomyProposal({tags:[{key:'topic',name,fullName,description:`The scientific scope of ${fullName}.`,facet:'method',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:Object.keys(snapshot.entries)}],merges:[],excluded:[]},facts,[],{snapshot}),tag=proposal.tags[0];
  proposal.mappingPolicyVersion=3;proposal.mappedSourceIds={[tag.id]:[]};return {facts,snapshot,proposal,tag};
}
function proof(proposal:TaxonomyProposal,tag:TagDefinition,paperId:string,relation:MachineEvidenceDecision['relation']='equivalent'){
  const source=Object.values(proposal.evidenceSnapshot!.sources).find(source=>source.paperId===paperId)!,registry=Object.values(proposal.evidenceSnapshot!.entries).find(entry=>entry.sourceIds.includes(source.factConceptId))!;
  (proposal.mappedSourceIds??={})[tag.id]=[...new Set([...(proposal.mappedSourceIds?.[tag.id]??[]),source.factConceptId])];
  const support=proposal.support[tag.id]??={paperIds:[]};support.registryIds=[...new Set([...(support.registryIds??[]),registry.registryId])];
  (proposal.machineDecisions??={})[semanticDecisionKey(tag.id,source.factConceptId)]={tagId:tag.id,sourceId:source.factConceptId,registryId:registry.registryId,snapshotId:proposal.evidenceSnapshot!.id,meaningFingerprint:conceptMeaningFingerprint(tag),tagFingerprint:conceptMappingFingerprint(tag),sourceFingerprint:fingerprint(source),policyVersion:3,relation,reason:'The supplied source context establishes this mapping.',origin:'ai',provider:'selected-provider',model:'selected-model'};
  return source.factConceptId;
}

test('policy3 expands only explicitly mapped sources even when a registry name is shared by unrelated papers',()=>{
  const {proposal,tag,snapshot}=fixture(),sourceId=proof(proposal,tag,'learning'),result=prepare(proposal);
  assert.equal(Object.keys(snapshot.entries).length,1);assert.equal(result.state.status,'ready');assert.equal(result.repairRequest,false);assert.deepEqual(result.proposal.support[tag.id].sourceIds,[sourceId]);assert.deepEqual(result.proposal.support[tag.id].paperIds,['learning']);assert.deepEqual(result.state.questions,[]);assert.equal(result.state.policyVersion,3);
});

test('unvalidated sibling links remain blocked technical work instead of questions or legacy repair calls',()=>{
  const {proposal,tag,snapshot}=fixture();proof(proposal,tag,'learning');proposal.mappedSourceIds![tag.id]=Object.keys(snapshot.sources);const result=prepare(proposal,undefined,{repairAttempts:0});
  assert.equal(result.state.status,'failed');assert.equal(result.repairRequest,false);assert.equal(result.state.pendingSourceCount,1);assert.equal(result.state.contextTruncated,false);assert.deepEqual(result.state.questions,[]);assert.deepEqual(result.proposal.support[tag.id].paperIds,['learning']);assert.ok(result.proposal.validationIssues!.some(issue=>issue.code==='unvalidated-source'));
  confirmProposalMappings(result.proposal);assert.deepEqual(result.proposal.support[tag.id].paperIds,['learning']);assert.ok(result.proposal.issues.length>0);
});

test('legacy decisions and cached registry confirmations cannot authorize policy3 coverage',()=>{
  const {proposal,tag}=fixture();const sourceId=proof(proposal,tag,'learning'),decision=proposal.machineDecisions![semanticDecisionKey(tag.id,sourceId)];decision.policyVersion=2;proposal.validatedEvidenceLinks={[tag.id]:{[decision.registryId]:'a legacy registry cache'}};proposal.mappingConfirmations={[tag.id]:{fingerprint:'a legacy confirmation',confirmedAt:'2026-01-01'}};
  refreshProposalEvidence(proposal);assert.deepEqual(proposal.support[tag.id].paperIds,[]);assert.ok(proposal.validationIssues!.some(issue=>issue.code==='unvalidated-source'));assert.equal(validMappedSourceDecision(proposal,tag,sourceId),undefined);
});

test('source, snapshot, scientific identity, full meaning and definition changes invalidate positive mapping proofs',()=>{
  const original=fixture();const sourceId=proof(original.proposal,original.tag,'learning');
  for(const mutate of [(proposal:TaxonomyProposal)=>{proposal.evidenceSnapshot!.sources[sourceId].summary+=' Changed context.';},(proposal:TaxonomyProposal)=>{proposal.evidenceSnapshot!.id='different-snapshot';},(proposal:TaxonomyProposal)=>{proposal.tags[0].name='Co';},(proposal:TaxonomyProposal)=>{proposal.tags[0].fullName='mass loss';},(proposal:TaxonomyProposal)=>{proposal.tags[0].description='A different scientific scope.';}]){
    const proposal=clone(original.proposal);mutate(proposal);refreshProposalEvidence(proposal);assert.deepEqual(proposal.support[original.tag.id].paperIds,[]);assert.ok(proposal.validationIssues!.some(issue=>issue.code==='unvalidated-source'));
  }
});

test('ordinary preferred-label changes and searchable aliases preserve proofs for an unchanged authoritative meaning',()=>{
  const {proposal,tag}=fixture();const sourceId=proof(proposal,tag,'learning'),before=conceptMappingFingerprint(tag);tag.name='ML regression';tag.aliases=['statistical learning'];refreshProposalEvidence(proposal);
  assert.equal(conceptMappingFingerprint(tag),before);assert.ok(validMappedSourceDecision(proposal,tag,sourceId));assert.deepEqual(proposal.support[tag.id].paperIds,['learning']);assert.equal(prepare(proposal).repairRequest,false);
});

test('cached review judgements cannot overwrite a fresh mapping after a meaning change',()=>{
  for(const origin of ['ai','researcher'] as const){
    const {proposal,tag}=fixture();const sourceId=proof(proposal,tag,'learning');proposal.machineDecisions![semanticDecisionKey(tag.id,sourceId)].origin=origin;const previous=prepare(proposal);
    const changed=clone(previous.proposal);changed.tags[0].description='Machine learning for a narrower electrode-property prediction scope.';proof(changed,changed.tags[0],'learning');const fresh=clone(changed.machineDecisions![semanticDecisionKey(tag.id,sourceId)]),result=prepare(changed,previous.state);
    assert.equal(result.state.status,'ready');assert.deepEqual(result.proposal.machineDecisions![semanticDecisionKey(tag.id,sourceId)],fresh);assert.deepEqual(result.proposal.support[tag.id].paperIds,['learning']);
  }
});

test('compatible researcher judgements remain authoritative when replaying the same unchanged context',()=>{
  const {proposal,tag}=fixture();const sourceId=proof(proposal,tag,'learning');proposal.machineDecisions![semanticDecisionKey(tag.id,sourceId)].origin='researcher';const previous=prepare(proposal),changed=clone(previous.proposal);proof(changed,changed.tags[0],'learning');const result=prepare(changed,previous.state);
  assert.equal(result.state.status,'ready');assert.equal(result.proposal.machineDecisions![semanticDecisionKey(tag.id,sourceId)].origin,'researcher');assert.deepEqual(result.proposal.support[tag.id].paperIds,['learning']);
});

test('even fingerprint-valid model claims cannot merge Co and CO',()=>{
  const {proposal,tag}=fixture([fact('cobalt','Co','Co particles form a cobalt catalyst.')],'CO','carbon monoxide');proof(proposal,tag,'cobalt');refreshProposalEvidence(proposal);
  assert.deepEqual(proposal.support[tag.id].paperIds,[]);assert.ok(proposal.validationIssues!.some(issue=>issue.code==='scientific-contradiction'));assert.equal(prepare(proposal).repairRequest,false);assert.deepEqual(prepare(proposal).state.questions,[]);
});

test('genuine needs-context mappings expose answerable questions without requesting more source batches',()=>{
  const {proposal,tag}=fixture([fact('ambiguous','ML','The experiment reports ML without defining the acronym.')]);const sourceId=proof(proposal,tag,'ambiguous','needs-context'),current=prepare(proposal);
  assert.equal(current.state.status,'questions');assert.equal(current.repairRequest,false);assert.equal(current.state.pendingSourceCount,0);assert.deepEqual(current.proposal.support[tag.id].paperIds,[]);assert.equal(current.state.questions.length,1);
  const resolved=answer(current,current.state.questions[0].id,'use-defined-meaning');assert.equal(resolved.state.status,'ready');assert.deepEqual(resolved.proposal.support[tag.id].paperIds,['ambiguous']);const decision=validMappedSourceDecision(resolved.proposal,resolved.proposal.tags[0],sourceId)!;assert.equal(decision.policyVersion,3);assert.equal(decision.origin,'researcher');
});

test('explicit tag-level confirmation validates only fresh uncertain mapped sources',()=>{
  const {proposal,tag}=fixture();proof(proposal,tag,'learning','needs-context');refreshProposalEvidence(proposal);confirmProposalMapping(proposal,tag.id);assert.deepEqual(proposal.support[tag.id].paperIds,['learning']);assert.equal(Object.values(proposal.machineDecisions!)[0].origin,'researcher');
});

test('a copied legacy confirmation cannot suppress a new source-level uncertainty',()=>{
  const {proposal,tag}=fixture();const sourceId=proof(proposal,tag,'learning','needs-context');confirmProposalMappings(proposal,[tag.id]);assert.deepEqual(proposal.support[tag.id].paperIds,['learning']);proposal.machineDecisions![semanticDecisionKey(tag.id,sourceId)].relation='needs-context';refreshProposalEvidence(proposal);assert.deepEqual(proposal.support[tag.id].paperIds,[]);assert.ok(proposal.issues.length>0);assert.equal(prepare(proposal).state.status,'questions');
});

test('FC coverage inherits only validated AEMFC child sources through a scientific subtype edge',()=>{
  const facts=[fact('fuel-cell','AEMFC','Anion exchange membrane fuel cells were evaluated.')],snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),proposal=createTaxonomyProposal({tags:[{key:'fc',name:'FC',fullName:'fuel cell',description:'Fuel cell systems.',facet:'system',supportRegistryIds:[]},{key:'aemfc',name:'AEMFC',fullName:'anion exchange membrane fuel cell',description:'Anion exchange membrane fuel cell systems.',facet:'system',parentKeys:['fc'],supportRegistryIds:Object.keys(snapshot.entries)}]},facts,[],{snapshot});proposal.mappingPolicyVersion=3;proposal.mappedSourceIds={};const child=proposal.tags.find(tag=>tag.name==='AEMFC')!,parent=proposal.tags.find(tag=>tag.name==='FC')!;proof(proposal,child,'fuel-cell');refreshProposalEvidence(proposal);assert.deepEqual(proposal.support[parent.id].paperIds,['fuel-cell']);
  delete proposal.machineDecisions![Object.keys(proposal.machineDecisions!)[0]];refreshProposalEvidence(proposal);assert.deepEqual(proposal.support[parent.id].paperIds,[]);assert.ok(proposal.validationIssues!.some(issue=>issue.code==='unvalidated-source'));
});

test('an edited parent cannot regain inherited coverage before review or override a fresh negative parent verdict',()=>{
  const facts=[fact('fuel-cell','AEMFC','Anion exchange membrane fuel cells were evaluated.')],snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),proposal=createTaxonomyProposal({tags:[{key:'fc',name:'FC',fullName:'fuel cell',description:'Fuel cell systems.',facet:'system',supportRegistryIds:[]},{key:'aemfc',name:'AEMFC',fullName:'anion exchange membrane fuel cell',description:'Anion exchange membrane fuel cell systems.',facet:'system',parentKeys:['fc'],supportRegistryIds:Object.keys(snapshot.entries)}]},facts,[],{snapshot});proposal.mappingPolicyVersion=3;proposal.mappedSourceIds={};const child=proposal.tags.find(tag=>tag.name==='AEMFC')!,parent=proposal.tags.find(tag=>tag.name==='FC')!,sourceId=proof(proposal,child,'fuel-cell');refreshProposalEvidence(proposal);assert.deepEqual(proposal.support[parent.id].paperIds,['fuel-cell']);
  parent.description='Fuel cell systems within a revised scientific scope.';proposal.inheritanceReviewSourceIds={[parent.id]:[sourceId]};const pending=prepare(proposal);assert.deepEqual(pending.proposal.support[parent.id].paperIds,[]);assert.equal(pending.state.pendingSourceCount,1);assert.deepEqual(pending.state.questions,[]);assert.ok(pending.proposal.validationIssues!.some(issue=>issue.code==='unvalidated-source'&&issue.tagId===parent.id));
  proof(proposal,parent,'fuel-cell','unrelated');refreshProposalEvidence(proposal);assert.deepEqual(proposal.support[parent.id].paperIds,[]);assert.deepEqual(proposal.support[child.id].paperIds,['fuel-cell']);assert.ok(!proposal.validationIssues!.some(issue=>issue.code==='unvalidated-source'));assert.deepEqual(prepare(clone(proposal)).proposal.support[parent.id].paperIds,[]);
  proof(proposal,parent,'fuel-cell','subtype');refreshProposalEvidence(proposal);assert.deepEqual(proposal.support[parent.id].paperIds,['fuel-cell']);
});

test('a locally retained manual definition may have zero coverage without bypassing source or scientific validation',()=>{
  const {proposal,tag,snapshot}=fixture();proposal.support[tag.id].registryIds=[];proposal.retainedDefinitionIds=[tag.id];const kept=prepare(proposal);
  assert.equal(kept.state.status,'ready');assert.ok(kept.proposal.tags.some(value=>value.id===tag.id));assert.deepEqual(kept.proposal.support[tag.id].paperIds,[]);assert.deepEqual(kept.proposal.support[tag.id].sourceIds,[]);
  const legacy=clone(proposal);delete legacy.mappingPolicyVersion;refreshProposalEvidence(legacy);assert.ok(legacy.validationIssues!.some(issue=>issue.code==='unsupported-concept'),'retention metadata never changes legacy policy-two validation');
  proposal.support[tag.id].registryIds=Object.keys(snapshot.entries);proposal.mappedSourceIds![tag.id]=Object.keys(snapshot.sources);const unchecked=prepare(proposal);assert.equal(unchecked.state.status,'failed');assert.ok(unchecked.proposal.validationIssues!.some(issue=>issue.code==='unvalidated-source'));
  const contradictory=fixture([fact('cobalt','Co','Co particles form a cobalt catalyst.')],'CO','carbon monoxide');contradictory.proposal.retainedDefinitionIds=[contradictory.tag.id];proof(contradictory.proposal,contradictory.tag,'cobalt');const blocked=prepare(contradictory.proposal);assert.notEqual(blocked.state.status,'ready');assert.ok(blocked.proposal.validationIssues!.some(issue=>issue.code==='scientific-contradiction'));assert.deepEqual(blocked.proposal.support[contradictory.tag.id].paperIds,[]);
});

test('direct AEMFC evidence for FC requires an explicit subtype decision instead of a synonym claim',()=>{
  const {proposal,tag}=fixture([fact('fuel-cell','AEMFC','Anion exchange membrane fuel cells were evaluated.')],'FC','fuel cell');proof(proposal,tag,'fuel-cell');refreshProposalEvidence(proposal);assert.deepEqual(proposal.support[tag.id].paperIds,[]);assert.ok(proposal.validationIssues!.some(issue=>issue.code==='scientific-contradiction'));
  proof(proposal,tag,'fuel-cell','subtype');refreshProposalEvidence(proposal);assert.deepEqual(proposal.support[tag.id].paperIds,['fuel-cell']);
});

test('researcher answers preserve a known subtype relationship instead of creating an alias-equivalence proof',()=>{
  const {proposal,tag}=fixture([fact('fuel-cell','AEMFC','Anion exchange membrane fuel cells were evaluated.')],'FC','fuel cell');const sourceId=proof(proposal,tag,'fuel-cell','needs-context'),current=prepare(proposal),resolved=answer(current,current.state.questions[0].id,'use-defined-meaning');
  assert.equal(resolved.state.status,'ready');assert.equal(validMappedSourceDecision(resolved.proposal,resolved.proposal.tags[0],sourceId)!.relation,'subtype');assert.deepEqual(resolved.proposal.support[tag.id].paperIds,['fuel-cell']);
});

test('extension reconciliation preserves mapped source identities while retargeting an unchanged approved definition',()=>{
  const {proposal,tag}=fixture([fact('impedance','EIS','Electrochemical impedance spectroscopy resolves electrode resistance.')],'EIS','electrochemical impedance spectroscopy');const sourceId=proof(proposal,tag,'impedance');proposal.inheritanceReviewSourceIds={[tag.id]:[sourceId]};const existing={...clone(tag),id:'approved-eis',status:'approved' as const},baseline=captureVocabularyBaseline([existing],3),extended=reconcileExtensionProposal(proposal,baseline);refreshProposalEvidence(extended);
  assert.deepEqual(extended.mappedSourceIds![existing.id],[sourceId]);assert.deepEqual(extended.support[existing.id].paperIds,['impedance']);assert.ok(validMappedSourceDecision(extended,extended.tags[0],sourceId));
  assert.deepEqual(extended.inheritanceReviewSourceIds![existing.id],[sourceId]);
  const changedBaseline=captureVocabularyBaseline([{...existing,description:'An approved scope different from the generated scope.'}],3),changed=reconcileExtensionProposal(proposal,changedBaseline);refreshProposalEvidence(changed);assert.deepEqual(changed.support[existing.id].paperIds,[]);assert.ok(changed.validationIssues!.some(issue=>issue.code==='unvalidated-source'));
});

test('JSON persistence and invalid-merge recovery retain policy3 source permissions and positive proofs',()=>{
  const {proposal,tag,facts}=fixture();const sourceId=proof(proposal,tag,'learning');proposal.unresolvedMerges=[{fromId:'missing-old-concept',toReference:'unknown-key',reason:'An invalid generated merge.'}];const result=prepare(clone(proposal),undefined,{facts,existingDefinitions:[]});
  assert.equal(result.proposal.mappingPolicyVersion,3);assert.deepEqual(result.proposal.mappedSourceIds![tag.id],[sourceId]);assert.deepEqual(result.proposal.support[tag.id].paperIds,['learning']);assert.equal(result.state.status,'ready');assert.equal(result.repairRequest,false);
});

test('removing registry links also removes their explicit source permissions without affecting other evidence',()=>{
  const {proposal,tag}=fixture();proof(proposal,tag,'learning');removeProposalEvidenceLinks(proposal,tag.id);assert.deepEqual(proposal.mappedSourceIds![tag.id],[]);assert.deepEqual(proposal.support[tag.id].sourceIds,[]);
});

test('five thousand completed source mappings remain ready without entering the three-request legacy repair loop',()=>{
  const facts=Array.from({length:5000},(_,index)=>fact(`paper-${index}`,'electrode morphology',`Electrode morphology was studied in experiment ${index}.`)),{proposal,tag,snapshot}=fixture(facts,'electrode geometry','electrode geometry'),registryId=Object.keys(snapshot.entries)[0],tagFingerprint=conceptMappingFingerprint(tag),meaningFingerprint=conceptMeaningFingerprint(tag);
  proposal.mappedSourceIds![tag.id]=Object.keys(snapshot.sources);proposal.machineDecisions=Object.fromEntries(Object.values(snapshot.sources).map(source=>[semanticDecisionKey(tag.id,source.factConceptId),{tagId:tag.id,sourceId:source.factConceptId,registryId,snapshotId:snapshot.id,meaningFingerprint,tagFingerprint,sourceFingerprint:fingerprint(source),policyVersion:3,relation:'equivalent',reason:'The source establishes the selected geometry concept.',origin:'ai'}]));
  const result=prepare(proposal,undefined,{repairAttempts:3,maxRepairs:3});assert.equal(result.state.status,'ready');assert.equal(result.repairRequest,false);assert.equal(result.state.pendingSourceCount,0);assert.equal(result.proposal.support[tag.id].paperIds.length,5000);assert.deepEqual(result.state.questions,[]);
});
