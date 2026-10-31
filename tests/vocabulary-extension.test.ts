import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import type {TagDefinition} from '../src/core.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot} from '../src/evidence.ts';
import {conceptMappingFingerprint,conceptMeaningFingerprint,createTaxonomyProposal,refreshProposalEvidence,semanticDecisionKey,validMappedSourceDecision} from '../src/taxonomy.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import {prepare,applyRepair} from '../src/tag-preparation.ts';
import {getNoTagDefinition} from '../src/tag-policy.ts';
import {captureVocabularyBaseline,validVocabularyBaseline,reconcileExtensionProposal,refreshExtensionProposal,composeExtendedVocabulary} from '../src/vocabulary-extension.ts';

function definition(id:string,name:string,fullName=name,extra:Partial<TagDefinition>={}):TagDefinition{return {id,name,fullName,description:`Approved scientific scope of ${fullName}.`,facet:'system',aliases:[],broaderIds:[],relatedIds:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',matchingMode:'auto',...extra};}
function fact(name:string,quote=`This experiment studies ${name}.`):PaperFacts{return {paperId:'new-sample-paper',metadataFingerprint:'new-metadata',inputFingerprint:'new-input',provider:'retained-provider',model:'retained-model',extractionVersion:1,summary:name,needsPDF:false,concepts:[{name,facet:'system',evidence:[{source:'abstract',text:quote}]}]};}
function incoming(facts:PaperFacts[],tags:Record<string,unknown>[],baseline= captureVocabularyBaseline([],0)){
  const snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),raw={tags:tags.map(tag=>({aliases:[],parentKeys:[],relatedKeys:[],facet:'system',description:`Scope of ${tag.name}.`,fullName:tag.name,supportRegistryIds:Object.keys(snapshot.entries),...tag})),merges:[],excluded:[]},proposal=createTaxonomyProposal(raw,facts,baseline.definitions,{snapshot,baseVersion:baseline.version});
  return {proposal,snapshot,facts};
}

test('baseline captures approved core and all DIY definitions exactly without mutable references',()=>{
  const original=[definition('fc','FC','fuel cell'),definition('draft','unaccepted',undefined,{status:'draft'}),definition('diy','My odd topic','My odd topic',{custom:true,status:'draft',matchingMode:'manual',aliases:['A personally chosen name']}),getNoTagDefinition()],baseline=captureVocabularyBaseline(original,7),before=fingerprint(original);
  assert.deepEqual(baseline.definitions,[original[0],original[2]]);assert.equal(validVocabularyBaseline(baseline),true);const malformed={...baseline,definitions:[{...original[0],fullName:42}]};malformed.fingerprint=fingerprint({version:malformed.version,definitions:malformed.definitions});assert.equal(validVocabularyBaseline(malformed),false);baseline.definitions[0].description='Mutated copy.';assert.equal(fingerprint(original),before);assert.equal(validVocabularyBaseline(baseline),false);
});

test('extension retains unsupported old fields outside the selected snapshot and grounds old parents through new children',()=>{
  const old=[definition('fc','FC','fuel cell',{aliases:['fuel cells']}),definition('we','WE','water electrolysis'),definition('eis','EIS','electrochemical impedance spectroscopy',{facet:'method'}),definition('detail','My detail','My detail',{custom:true,matchingMode:'suggest',relatedIds:['fc']})],baseline=captureVocabularyBaseline(old,4),before=fingerprint(baseline),data=incoming([fact('anion exchange membrane fuel cell')],[{key:'aemfc',name:'AEMFC',fullName:'anion exchange membrane fuel cell',parentKeys:['fc'],relatedKeys:['eis']}],baseline),snapshotBefore=fingerprint(data.snapshot);
  const reconciled=reconcileExtensionProposal(data.proposal,baseline),result=prepare(reconciled),aem=result.proposal.tags.find(tag=>tag.name==='AEMFC')!;
  assert.equal(result.state.status,'ready');assert.deepEqual(new Set(result.proposal.tags.map(tag=>tag.id)),new Set(['fc',aem.id]));assert.deepEqual(aem.broaderIds,['fc']);assert.deepEqual(aem.relatedIds,[]);assert.deepEqual(result.proposal.extension!.relatedIds[aem.id],['eis']);assert.deepEqual(result.proposal.support.fc.paperIds,['new-sample-paper']);
  const composed=composeExtendedVocabulary(result.proposal);for(const tag of old)assert.deepEqual(composed.find(value=>value.id===tag.id),tag);assert.deepEqual(composed.find(tag=>tag.id===aem.id)!.relatedIds,['eis']);assert.equal(composed.find(tag=>tag.id===aem.id)!.status,'approved');assert.equal(composed.length,5);assert.equal(fingerprint(baseline),before);assert.equal(fingerprint(result.proposal.evidenceSnapshot),snapshotBefore);assert.deepEqual(result.proposal.paperIds,['new-sample-paper']);assert.ok(Object.values(result.proposal.support).flatMap(value=>value.sourceIds??[]).every(id=>Object.hasOwn(data.snapshot.sources,id)));
});

test('equivalent technology labels keep the entire applied definition and current links are revalidated',()=>{
  const old=definition('we','WE','water electrolysis',{aliases:['electrolysis of water'],description:'The established electrochemical water-electrolysis system.',inclusions:['Electrochemical systems.'],exclusions:['Photochemical reactions.']}),baseline=captureVocabularyBaseline([old],2),data=incoming([fact('water electrolysis')],[{key:'we',name:'water electrolysis',description:'A broader generated replacement description.'}],baseline),before=fingerprint(data.proposal);
  const result=prepare(reconcileExtensionProposal(data.proposal,baseline));assert.equal(fingerprint(data.proposal),before);assert.equal(result.state.status,'ready');assert.deepEqual(result.proposal.tags[0],old);assert.deepEqual(result.proposal.support.we.paperIds,['new-sample-paper']);assert.deepEqual(result.proposal.support.we.registryIds,Object.keys(data.snapshot.entries));assert.deepEqual(result.proposal.mappingConfirmations,{});assert.deepEqual(composeExtendedVocabulary(result.proposal),[old]);
});

test('unknown acronyms with different full meanings do not reuse approved IDs and can be repaired to a distinct name',()=>{
  const old=definition('ml','ML','machine learning',{facet:'method'}),baseline=captureVocabularyBaseline([old],3),data=incoming([fact('mass loss')],[{key:'ml-new',name:'ML',fullName:'mass loss',facet:'method',description:'Mass lost from corroding material.'}],baseline);assert.equal(data.proposal.tags[0].id,'ml','The legacy label allocator initially reuses this old identity.');
  const scoped=reconcileExtensionProposal(data.proposal,baseline),newId=scoped.tags[0].id;assert.notEqual(newId,'ml');assert.equal(scoped.tags[0].fullName,'mass loss');assert.deepEqual(scoped.tags[0].aliases,[]);assert.ok(scoped.externalIssues!.some(message=>message.includes('Ambiguous')));const restarted=reconcileExtensionProposal(JSON.parse(JSON.stringify(scoped)),baseline);assert.equal(restarted.tags[0].id,newId);assert.equal(restarted.candidateIds!['ml-new'],newId);
  const ready=applyRepair({tags:[{tagId:newId,name:'mass loss',aliases:[]}]},prepare(restarted),{repairAttempts:1});assert.equal(ready.state.status,'ready');assert.deepEqual(composeExtendedVocabulary(ready.proposal).find(tag=>tag.id==='ml'),old);assert.equal(composeExtendedVocabulary(ready.proposal).find(tag=>tag.id===newId)!.name,'mass loss');
});

test('a preferred label and contradictory known full name cannot be normalized into an old identity',()=>{
  const old=definition('fc','FC','fuel cell'),baseline=captureVocabularyBaseline([old],2),data=incoming([fact('proton exchange membrane fuel cell')],[{key:'conflict',name:'FC',fullName:'proton exchange membrane fuel cell'}],baseline),scoped=reconcileExtensionProposal(data.proposal,baseline),result=prepare(scoped);
  assert.notEqual(scoped.tags[0].id,'fc');assert.ok(result.proposal.validationIssues!.some(issue=>issue.code==='scientific-contradiction'));assert.notEqual(result.state.status,'ready');assert.deepEqual(baseline.definitions[0],old);
});

test('an unrecognized expanded scope does not become equivalent solely through a known abbreviation',()=>{
  const old=definition('co-metal','Co','cobalt',{facet:'component'}),baseline=captureVocabularyBaseline([old],2),data=incoming([fact('cobalt oxide')],[{key:'oxide',name:'cobalt oxide',facet:'component'}],baseline);data.proposal.tags[0].name='Co';data.proposal.tags[0].fullName='cobalt oxide';data.proposal.tags[0].description='Cobalt oxide electrocatalysts.';const scoped=reconcileExtensionProposal(data.proposal,baseline);assert.notEqual(scoped.tags[0].id,'co-metal');assert.equal(scoped.tags[0].fullName,'cobalt oxide');assert.deepEqual(baseline.definitions[0],old);
});

test('Co and CO remain distinct and prior definitions never authorize a contradictory current source',()=>{
  const old=definition('co-metal','Co','cobalt',{facet:'component'}),baseline=captureVocabularyBaseline([old],1),data=incoming([fact('CO')],[{key:'gas',name:'CO',fullName:'carbon monoxide',facet:'component'}],baseline),ready=prepare(reconcileExtensionProposal(data.proposal,baseline));assert.equal(ready.state.status,'ready');const combined=composeExtendedVocabulary(ready.proposal);assert.equal(combined.length,2);assert.deepEqual(combined.find(tag=>tag.id==='co-metal'),old);assert.notEqual(combined.find(tag=>tag.name==='CO')!.id,'co-metal');
  const contradictory=incoming([fact('CO')],[{key:'wrong',name:'Co',fullName:'cobalt',facet:'component'}],baseline),blocked=prepare(reconcileExtensionProposal(contradictory.proposal,baseline));assert.notEqual(blocked.state.status,'ready');assert.deepEqual(blocked.proposal.support['co-metal'].paperIds,[]);assert.ok(blocked.proposal.validationIssues!.some(issue=>issue.code==='scientific-contradiction'));
});

test('restored old meanings require genuine current-source checks instead of inheriting candidate validation',()=>{
  const old=definition('rcl','RCL','catalyst-layer resistance',{facet:'phenomenon',aliases:['proton transport resistance']}),baseline=captureVocabularyBaseline([old],2),data=incoming([fact('proton transport resistance')],[{key:'rcl',name:'RCL',fullName:'catalyst-layer resistance',facet:'phenomenon',description:'A different generated scope.'}],baseline),scoped=reconcileExtensionProposal(data.proposal,baseline),pending=prepare(scoped);
  assert.equal(pending.state.status,'checking');assert.equal(pending.repairRequest,true);assert.deepEqual(pending.proposal.support.rcl.paperIds,[]);assert.deepEqual(pending.proposal.mappingConfirmations,{});assert.deepEqual(pending.proposal.tags[0],old);
});

test('a unique approved expanded alias deduplicates while retaining its scientific review requirement',()=>{
  const old=definition('rcl','RCL','catalyst-layer resistance',{facet:'phenomenon',aliases:['proton transport resistance']}),baseline=captureVocabularyBaseline([old],2),data=incoming([fact('proton transport resistance')],[{key:'transport',name:'proton transport resistance',fullName:'proton transport resistance',facet:'phenomenon'}],baseline),scoped=reconcileExtensionProposal(data.proposal,baseline);assert.equal(scoped.tags[0].id,'rcl');assert.deepEqual(scoped.tags[0],old);assert.equal(prepare(scoped).state.status,'checking');assert.equal(scoped.candidateIds!.transport,'rcl');assert.equal(scoped.candidateKeys!.rcl,'transport');
});

test('new child links to a prior concept still undergo scientific subtype validation',()=>{
  const old=definition('we','WE','water electrolysis'),baseline=captureVocabularyBaseline([old],2),data=incoming([fact('anion exchange membrane fuel cell')],[{key:'aemfc',name:'AEMFC',fullName:'anion exchange membrane fuel cell',parentKeys:['we']}],baseline),scoped=reconcileExtensionProposal(data.proposal,baseline),result=prepare(scoped);assert.notEqual(result.state.status,'ready');assert.ok(result.proposal.validationIssues!.some(issue=>issue.code==='scientific-contradiction'));assert.equal(fingerprint(result.proposal.evidenceSnapshot),fingerprint(data.snapshot));
});

test('an error-free empty addition set can keep the applied library unchanged',()=>{
  const old=definition('fc','FC','fuel cell'),baseline=captureVocabularyBaseline([old],6),data=incoming([fact('incidental background')],[],baseline),scoped=reconcileExtensionProposal(data.proposal,baseline),ready=prepare(scoped);assert.equal(ready.state.status,'ready');assert.equal(ready.repairRequest,false);assert.deepEqual(ready.proposal.tags,[]);assert.deepEqual(composeExtendedVocabulary(ready.proposal),[old]);assert.equal(fingerprint(ready.proposal.evidenceSnapshot),fingerprint(data.snapshot));
  const malformed=structuredClone(scoped);malformed.externalIssues=['The provider returned partial diagnostic output.'];assert.notEqual(prepare(malformed).state.status,'ready');
});

test('baseline merge suggestions and attempted model edits cannot retire or alter applied definitions',()=>{
  const old=definition('fc','FC','fuel cell'),baseline=captureVocabularyBaseline([old],2),data=incoming([fact('fuel cell')],[{key:'fc',name:'FC',fullName:'fuel cell'}],baseline);data.proposal.merges=[{fromId:'fc',toId:'fc'}];const ready=prepare(reconcileExtensionProposal(data.proposal,baseline)),repaired=applyRepair({tags:[{tagId:'fc',name:'Changed',description:'A different meaning.',remove:true}]},ready,{repairAttempts:1});assert.deepEqual(repaired.proposal.merges,[]);assert.deepEqual(composeExtendedVocabulary(repaired.proposal),[old]);assert.deepEqual(repaired.proposal.tags[0],old);
});

test('combined graph validation rejects ambiguous new aliases and unknown contextual destinations at composition',()=>{
  const old=definition('fc','FC','fuel cell'),baseline=captureVocabularyBaseline([old],3),data=incoming([fact('new experiment')],[{key:'new',name:'new experiment'}],baseline),scoped=reconcileExtensionProposal(data.proposal,baseline);scoped.tags[0].name='FC';assert.throws(()=>composeExtendedVocabulary(scoped),/Ambiguous/);scoped.tags[0].name='new experiment';scoped.extension!.relatedIds[scoped.tags[0].id]=['foreign-approved-id'];assert.throws(()=>composeExtendedVocabulary(scoped),/Unknown related/);
  const changed=structuredClone(baseline);changed.definitions[0].description='A forged alternate authority.';assert.throws(()=>reconcileExtensionProposal(scoped,changed),/baseline/);
});

function checkedAddition(baseline:ReturnType<typeof captureVocabularyBaseline>,name='interfacial resistance',extra:Record<string,unknown>={}){
  const data=incoming([fact(name)],[{key:'new-tag',name,facet:'phenomenon',...extra}],baseline),proposal=data.proposal;proposal.mappingPolicyVersion=3;proposal.preparationPolicyVersion=3;proposal.tagPolicyVersion=2;proposal.verificationScope='representative';proposal.machineDecisions={};proposal.mappedSourceIds={};
  for(const tag of proposal.tags)for(const source of Object.values(data.snapshot.sources)){const registry=Object.values(data.snapshot.entries).find(entry=>entry.sourceIds.includes(source.factConceptId))!;proposal.mappedSourceIds[tag.id]=[source.factConceptId];proposal.machineDecisions[semanticDecisionKey(tag.id,source.factConceptId)]={tagId:tag.id,sourceId:source.factConceptId,registryId:registry.registryId,snapshotId:data.snapshot.id,meaningFingerprint:conceptMeaningFingerprint(tag),tagFingerprint:conceptMappingFingerprint(tag),sourceFingerprint:fingerprint(source),policyVersion:3,relation:'equivalent',reason:'The exact retained source establishes this proposed meaning.',origin:'ai'};}
  return refreshProposalEvidence(reconcileExtensionProposal(proposal,baseline));
}

test('refreshing an extension after a saved deletion keeps additions and exact source proof without resurrecting the deleted tag',()=>{
  const kept=definition('saved-fc','FC','fuel cell'),removed=definition('saved-we','WE','water electrolysis'),baseline=captureVocabularyBaseline([kept,removed],5),proposal=checkedAddition(baseline),addition=proposal.tags.find(tag=>tag.name==='interfacial resistance')!,sourceIds=proposal.support[addition.id].sourceIds;
  proposal.rawResponse={synthetic:'The original paid response is retained.'};const before=fingerprint(proposal),rawBefore=fingerprint(proposal.rawResponse),refreshed=refreshExtensionProposal(proposal,[kept],6);
  assert.equal(refreshed.baseVersion,6);assert.equal(refreshed.extension!.baseline.version,6);assert.deepEqual(refreshed.tags.find(tag=>tag.id===kept.id),kept);assert.ok(!refreshed.tags.some(tag=>tag.id===removed.id));assert.deepEqual(refreshed.tags.find(tag=>tag.id===addition.id),addition);assert.deepEqual(refreshed.support[addition.id].sourceIds,sourceIds);assert.ok(sourceIds!.every(id=>validMappedSourceDecision(refreshed,addition,id)));assert.equal(refreshed.issues.length,0);assert.equal(fingerprint(refreshed.evidenceSnapshot),fingerprint(proposal.evidenceSnapshot));assert.deepEqual(refreshed.candidateIds,proposal.candidateIds);assert.deepEqual(refreshed.candidateKeys,proposal.candidateKeys);assert.equal(fingerprint(refreshed.rawResponse),rawBefore);assert.equal(fingerprint(proposal),before);assert.deepEqual(refreshExtensionProposal(JSON.parse(JSON.stringify(refreshed)),[kept],6),refreshed);
});

test('refresh removes links to deleted or changed saved meanings while preserving unchanged new-tag judgments',()=>{
  const parent=definition('parent','transport','transport',{facet:'phenomenon'}),removed=definition('removed','membrane response','membrane response',{facet:'phenomenon'}),baseline=captureVocabularyBaseline([parent,removed],3),proposal=checkedAddition(baseline,'interfacial resistance',{parentKeys:['parent'],relatedKeys:['removed']}),addition=proposal.tags.find(tag=>tag.name==='interfacial resistance')!,sourceIds=proposal.support[addition.id].sourceIds!,updated={...parent,description:'A newly narrowed saved meaning.'};proposal.unresolvedRelationships=[{tagId:addition.id,kind:'parent',reference:'transport'},{tagId:addition.id,kind:'related',reference:removed.id}];
  const refreshed=refreshExtensionProposal(proposal,[updated],4),tag=refreshed.tags.find(tag=>tag.id===addition.id)!;assert.deepEqual(refreshed.tags.find(tag=>tag.id===parent.id),updated);assert.deepEqual(tag.broaderIds,[]);assert.deepEqual(tag.relatedIds,[]);assert.deepEqual(refreshed.extension!.relatedIds[addition.id]??[],[]);assert.deepEqual(refreshed.unresolvedRelationships,[]);assert.deepEqual(refreshed.support[parent.id].paperIds,[]);assert.deepEqual(refreshed.support[addition.id].sourceIds,sourceIds);assert.ok(sourceIds.every(id=>validMappedSourceDecision(refreshed,tag,id)));assert.equal(refreshed.issues.length,0);
});

test('refresh strips speculative aliases before canonical comparison and preserves newly saved definitions exactly',()=>{
  const baseline=captureVocabularyBaseline([],1),proposal=checkedAddition(baseline),addition=proposal.tags[0],saved=definition('conductivity','ionic conductivity','ionic conductivity',{facet:'phenomenon'});addition.aliases=['ionic conductivity'];
  const refreshed=refreshExtensionProposal(proposal,[saved],2),retained=refreshed.tags.find(tag=>tag.id===addition.id)!;assert.ok(retained);assert.notEqual(retained.id,saved.id);assert.deepEqual(retained.aliases,[]);assert.deepEqual(refreshed.tags.find(tag=>tag.id===saved.id),saved);assert.equal(refreshed.tags.length,2);assert.equal(refreshed.candidateIds!['new-tag'],addition.id);assert.equal(refreshed.issues.length,0);
});

test('refresh keeps an independently equivalent new saved identity without claiming old proof for its changed scope',()=>{
  const proposal=checkedAddition(captureVocabularyBaseline([],1)),addition=proposal.tags[0],saved=definition('newly-saved','interfacial resistance','interfacial resistance',{facet:'phenomenon',description:'The current saved scope with an explicit material restriction.',inclusions:['Only the newly selected material.']}),refreshed=refreshExtensionProposal(proposal,[saved],2);
  assert.equal(refreshed.tags.length,1);assert.deepEqual(refreshed.tags[0],saved);assert.equal(refreshed.candidateIds!['new-tag'],saved.id);assert.deepEqual(refreshed.support[saved.id].sourceIds,[]);assert.deepEqual(refreshed.support[saved.id].paperIds,[]);assert.ok(Object.values(refreshed.machineDecisions??{}).every(decision=>!validMappedSourceDecision(refreshed,saved,decision.sourceId)));assert.equal(refreshed.issues.length,0);assert.notEqual(addition.id,saved.id);
});

test('refresh expands a conflicting display label or defers it without changing saved scientific meanings',()=>{
  const proposal=checkedAddition(captureVocabularyBaseline([],1),'interfacial resistance',{name:'interface',fullName:'interfacial resistance'}),addition=proposal.tags[0],saved=definition('interface-method','interface','interface analysis',{facet:'method'}),expanded=refreshExtensionProposal(proposal,[saved],2);assert.equal(expanded.tags.find(tag=>tag.id===addition.id)!.name,'interfacial resistance');assert.deepEqual(expanded.tags.find(tag=>tag.id===saved.id),saved);
  const sameLabel=definition('method','interfacial resistance','interfacial resistance method',{facet:'method'}),deferred=refreshExtensionProposal(proposal,[sameLabel],2);assert.ok(!deferred.tags.some(tag=>tag.id===addition.id));assert.deepEqual(deferred.tags[0],sameLabel);assert.ok(deferred.excluded.some(value=>value.name==='interface'));assert.equal(deferred.candidateIds!['new-tag'],addition.id);assert.equal(deferred.support[addition.id],undefined);
});

test('refresh cannot hide a known scientific contradiction or a stale source fingerprint',()=>{
  const proposal=checkedAddition(captureVocabularyBaseline([],1)),broken=structuredClone(proposal);broken.tags[0].name='Co';broken.tags[0].fullName='cobalt';broken.tags[0].aliases=['CO'];assert.throws(()=>refreshExtensionProposal(broken,[definition('gas','CO','carbon monoxide',{facet:'component'})],2),/scientifically distinct/);
  const stale=structuredClone(proposal),decision=Object.values(stale.machineDecisions!)[0];decision.sourceFingerprint='not-the-retained-source';const refreshed=refreshExtensionProposal(stale,[],2),tag=refreshed.tags[0];assert.deepEqual(refreshed.support[tag.id].paperIds,[]);assert.ok(refreshed.validationIssues!.some(issue=>issue.code==='unvalidated-source'));assert.equal(validMappedSourceDecision(refreshed,tag,decision.sourceId),undefined);
});
