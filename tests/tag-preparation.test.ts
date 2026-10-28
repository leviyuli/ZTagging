import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import type {TagDefinition} from '../src/core.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot,validateRegistrySnapshot} from '../src/evidence.ts';
import {terminologyKey,terminologyFor} from '../src/naming.ts';
import {confirmProposalMapping,createTaxonomyProposal,refreshProposalEvidence} from '../src/taxonomy.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import {prepare,applyRepair,answer,buildRepairPrompt,validTagPreparationState} from '../src/tag-preparation.ts';
const fact=(id:string,name:string,quote=`The source studies ${name}.`):PaperFacts=>({paperId:id,metadataFingerprint:`metadata-${id}`,inputFingerprint:`input-${id}`,provider:'original-provider',model:'original-model',extractionVersion:1,summary:name,needsPDF:false,concepts:[{name,evidence:[{source:'abstract',text:quote}]}]});
const rawTag=(key:string,name:string,supportRegistryIds:string[],extra:Record<string,unknown>={})=>({key,name,fullName:name,description:`Scope of ${name}.`,facet:'phenomenon',supportRegistryIds,...extra});
function fixture(facts=[fact('one','proton transport resistance')]){const snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),registryIds=Object.keys(snapshot.entries),proposal=createTaxonomyProposal({tags:[rawTag('resistance','catalyst-layer resistance',registryIds,{aliases:['proton transport resistance']})]},facts,[],{snapshot});return {facts,snapshot,registryIds,proposal};}
test('new terminology resolves complete technology expansions without weakening chemical or old snapshot identities',()=>{
  for(const label of ['Anion-exchange membrane fuel cells (AEMFCs)','Anion-exchange-membrane water electrolysis (AEM-WE)','Anion exchange membrane water electrolyzer (AEMWE)']){assert.equal(terminologyFor(label,1),undefined);assert.ok(terminologyFor(label,2));}
  assert.equal(terminologyFor('anion exchange membrane fuel cell (PEMFC)',2),undefined);assert.notEqual(terminologyKey('Co'),terminologyKey('CO'));
  const {snapshot,facts}=fixture([fact('one','Anion-exchange membrane fuel cells (AEMFCs)')]),entry=Object.values(snapshot.entries)[0];delete snapshot.normalizationVersion;delete entry.normalizationVersion;entry.key=terminologyKey(facts[0].concepts[0].name,1);const original=fingerprint(snapshot);assert.deepEqual(validateRegistrySnapshot(snapshot),[]);
  const catalog={sources:structuredClone(snapshot.sources),entries:structuredClone(snapshot.entries)},next=createRegistrySnapshot(facts,catalog);assert.equal(Object.keys(next.entries)[0],entry.registryId);assert.equal(next.normalizationVersion,2);assert.equal(next.entries[entry.registryId].normalizationVersion,1);assert.equal(fingerprint(snapshot),original);assert.deepEqual(validateRegistrySnapshot(next),[]);
});
test('technology category mistakes and unsupported generated scaffolding are repaired locally without human questions',()=>{
  const facts=[fact('one','Anion-exchange-membrane water electrolysis (AEM-WE)')],snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),ids=Object.keys(snapshot.entries),proposal=createTaxonomyProposal({tags:[rawTag('we','WE',[],{facet:'phenomenon'}),rawTag('aem','AEMWE',ids,{facet:'system',parentKeys:['we']}),rawTag('empty','local reaction environment',[])]},facts,[],{snapshot});
  const original=fingerprint(snapshot),result=prepare(proposal);assert.equal(result.state.status,'ready');assert.equal(result.repairRequest,false);assert.deepEqual(result.state.questions,[]);assert.equal(result.proposal.tags.find(tag=>tag.name==='WE')!.facet,'system');assert.ok(!result.proposal.tags.some(tag=>tag.name==='local reaction environment'));assert.equal(result.proposal.support[result.proposal.tags.find(tag=>tag.name==='WE')!.id].paperIds.length,1);assert.equal(fingerprint(result.proposal.evidenceSnapshot),original);assert.equal(validTagPreparationState(result.state),true);
});
test('semantic uncertainty requests selected-model repair before any researcher question',()=>{
  const {proposal,snapshot}=fixture(),before=fingerprint(proposal),result=prepare(proposal,undefined,{provider:'deepseek',model:'selected-model'});assert.equal(result.state.status,'checking');assert.equal(result.repairRequest,true);assert.deepEqual(result.state.questions,[]);assert.equal(fingerprint(proposal),before);
  const prompt=buildRepairPrompt(result);for(const source of Object.values(snapshot.sources)){assert.ok(prompt.includes(source.factConceptId));assert.ok(prompt.includes(source.evidence[0].text));}assert.ok(prompt.includes('soft'));
});
test('machine judgements validate exact per-source links and retain separate provider provenance',()=>{
  const data=fixture(),initial=prepare(data.proposal),tag=initial.proposal.tags[0],sourceId=Object.keys(data.snapshot.sources)[0],result=applyRepair({tags:[{tagId:tag.id,description:'Proton transport resistance within a catalyst layer.'}],judgements:[{tagId:tag.id,registryId:data.registryIds[0],sourceIds:[sourceId],relation:'equivalent',reason:'The source measures proton transport losses in the catalyst layer.'}]},initial,{provider:'deepseek',model:'chosen-model',repairAttempts:1});
  assert.equal(result.state.status,'ready');assert.equal(result.proposal.tags[0].id,tag.id);assert.deepEqual(result.proposal.mappingConfirmations,{});assert.deepEqual(result.proposal.support[tag.id].paperIds,['one']);const judgement=Object.values(result.state.judgements)[0];assert.equal(judgement.origin,'ai');assert.equal(judgement.provider,'deepseek');assert.equal(judgement.model,'chosen-model');assert.equal(result.proposal.evidenceSnapshot!.sources[sourceId].provider,'original-provider');
  const changed=structuredClone(result.proposal);changed.tags[0].description='An unrelated scientific scope.';refreshProposalEvidence(changed);assert.ok(changed.issues.length,'Meaning changes invalidate machine judgements');
});
test('scientific review can distinguish different meanings within one registry without importing outside papers',()=>{
  const first=fact('learning','ML','ML predicts material properties with machine learning.'),second=fact('loss','ML','ML denotes mass loss during electrode corrosion.'),data=fixture([first,second]),tag=data.proposal.tags[0];tag.name='ML';tag.fullName='machine learning';tag.description='Machine learning methods.';const initial=prepare(data.proposal),sources=Object.values(data.snapshot.sources),result=applyRepair({judgements:sources.map(source=>({tagId:tag.id,registryId:data.registryIds[0],sourceIds:[source.factConceptId],relation:source.paperId==='learning'?'equivalent':'unrelated',reason:source.paperId==='learning'?'The passage explicitly expands ML as machine learning.':'This passage explicitly uses ML for mass loss.'}))},initial,{repairAttempts:1});
  assert.equal(result.state.status,'ready');assert.deepEqual(result.proposal.support[tag.id].paperIds,['learning']);assert.ok(!result.proposal.support[tag.id].sourceIds!.includes(sources.find(source=>source.paperId==='loss')!.factConceptId));
});
test('AI cannot authorize chemical contradictions, unknown references or stale evidence',()=>{
  const data=fixture([fact('one','Co','Co nanoparticles form a cobalt catalyst.')]);data.proposal.tags[0].name='CO';data.proposal.tags[0].fullName='carbon monoxide';data.proposal.tags[0].aliases=[];const initial=prepare(data.proposal),tag=initial.proposal.tags[0],sourceId=Object.keys(data.snapshot.sources)[0];
  const result=applyRepair({judgements:[{tagId:tag.id,registryId:data.registryIds[0],sourceIds:[sourceId,'outside-snapshot'],relation:'equivalent',reason:'A model tries to collapse distinct symbols.'}]},initial,{repairAttempts:3});assert.notEqual(result.state.status,'ready');assert.deepEqual(result.proposal.support[tag.id].paperIds,[]);assert.deepEqual(result.proposal.mappingConfirmations,{});assert.ok(result.diagnostics.length);
});
test('real meaning questions retain explicit options and answers revalidate only the unchanged context',()=>{
  const data=fixture([fact('one','ML','The paper reports ML without expanding the acronym.')]);data.proposal.tags[0].name='ML';data.proposal.tags[0].fullName='machine learning';data.proposal.tags[0].description='Machine learning methods.';const initial=prepare(data.proposal),tag=initial.proposal.tags[0],sourceId=Object.keys(data.snapshot.sources)[0],result=applyRepair({questions:[{tagId:tag.id,sourceIds:[sourceId],title:'What does ML mean in this paper?',description:'The supplied text never expands ML.',choices:[{id:'learning',label:'Machine learning',description:'Computational learning methods.'},{id:'loss',label:'Mass loss',description:'Material lost by corrosion.',meaning:{fullName:'mass loss',description:'Mass lost from an electrode.'}},{id:'omit',label:'Leave it out',description:'Do not infer an unexpanded acronym.',exclude:true}]}]},initial,{repairAttempts:1});
  assert.equal(result.state.status,'questions');assert.equal(result.state.questions.length,1);const question=result.state.questions[0],answered=answer(result,question.id,'loss',{repairAttempts:1});assert.equal(answered.state.status,'ready');assert.equal(answered.proposal.tags[0].fullName,'mass loss');assert.equal(Object.values(answered.state.judgements)[0].origin,'researcher');assert.equal(answered.state.answers[question.id],'loss');
  const later=applyRepair({tags:[{tagId:tag.id,fullName:'AI replacement meaning',description:'AI replacement scope',supportRegistryIds:[],remove:true}],judgements:[{tagId:tag.id,registryId:data.registryIds[0],sourceIds:[sourceId],relation:'equivalent',reason:'A later machine attempt tries to replace the answered meaning.'}]},answered,{repairAttempts:2});assert.equal(later.proposal.tags[0].fullName,'mass loss');assert.equal(later.proposal.tags[0].description,'Mass lost from an electrode.');assert.equal(later.state.judgements[`${tag.id}|${sourceId}`].origin,'researcher');assert.deepEqual(later.proposal.support[tag.id].paperIds,['one']);
  const stale=structuredClone(result);stale.proposal.tags[0].description='A changed meaning.';assert.throws(()=>answer(stale,question.id,'learning'),/changed/);
});
test('protected edits and DIY names survive machine changes and repeat preparation is idempotent',()=>{
  const data=fixture(),tag=data.proposal.tags[0],options={protectedTagIds:[tag.id],repairAttempts:1},initial=prepare(data.proposal,undefined,options),result=applyRepair({tags:[{tagId:tag.id,name:'Different topic',description:'A replacement meaning.',remove:true}]},initial,options);assert.ok(result.proposal.tags.some(value=>value.id===tag.id&&value.name===tag.name));const next=prepare(result.proposal,result.state,options);assert.equal(next.state.id,result.state.id);assert.equal(next.proposal.tags[0].id,tag.id);assert.deepEqual(next.state.excluded,result.state.excluded);
});

test('malformed initial candidates recover from retained facts without changing source identities',()=>{
  const facts=[fact('one','water electrolysis')],snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),proposal=createTaxonomyProposal('not JSON',facts,[],{snapshot}),initial=prepare(proposal,undefined,{facts}),sourceBefore=fingerprint(snapshot);
  assert.equal(initial.repairRequest,true);assert.ok(buildRepairPrompt(initial).includes('complete protocol-v2 tags array'));
  const result=applyRepair({tags:[rawTag('water','WE',Object.keys(snapshot.entries))],merges:[],excluded:[]},initial,{facts,repairAttempts:1});assert.equal(result.state.status,'ready');assert.equal(result.proposal.id,proposal.id);assert.equal(result.proposal.tags[0].name,'WE');assert.equal(fingerprint(result.proposal.evidenceSnapshot),sourceBefore);assert.equal(result.proposal.evidenceSnapshot!.sources[Object.keys(snapshot.sources)[0]].provider,'original-provider');
  const replay=prepare(JSON.parse(JSON.stringify(result.proposal)),JSON.parse(JSON.stringify(result.state)),{facts,repairAttempts:1});assert.equal(replay.proposal.tags[0].id,result.proposal.tags[0].id);assert.equal(replay.state.id,result.state.id);
});

test('repair exhaustion is bounded and unsupported reviewed concepts are omitted without researcher questions',()=>{
  const data=fixture(),initial=prepare(data.proposal),tag=initial.proposal.tags[0],sourceId=Object.keys(data.snapshot.sources)[0];
  const exhausted=applyRepair('malformed model output',initial,{repairAttempts:3});assert.equal(exhausted.repairRequest,false);assert.equal(exhausted.state.status,'failed');assert.deepEqual(exhausted.state.questions,[]);
  const rejected=applyRepair({judgements:[{tagId:tag.id,registryId:data.registryIds[0],sourceIds:[sourceId],relation:'unrelated',reason:'The quoted passage establishes another physical concept.'}]},initial,{repairAttempts:1});assert.ok(!rejected.proposal.tags.some(value=>value.id===tag.id));assert.ok(rejected.state.excluded.some(value=>value.tagId===tag.id));assert.deepEqual(rejected.state.questions,[]);
});

test('the core target is soft for a fully supported vocabulary and never triggers a count-only repair',()=>{
  const facts=Array.from({length:61},(_,index)=>fact(`paper-${index}`,`scientific concept ${index}`)),snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),tags=Object.values(snapshot.entries).map((entry,index)=>rawTag(`candidate-${index}`,snapshot.sources[entry.sourceIds[0]].name,[entry.registryId])),proposal=createTaxonomyProposal({tags},facts,[],{snapshot,limit:60}),result=prepare(proposal,undefined,{targetCount:60});
  assert.equal(result.proposal.tags.length,61);assert.equal(result.state.status,'ready');assert.equal(result.repairRequest,false);assert.deepEqual(result.state.questions,[]);
});

test('a known extracted label does not substitute for relevance in its actual quotation',()=>{
  const real=fact('electrolysis','WE','Water electrolysis was measured in an electrolyzer.'),ambiguous=fact('reaction','WE','We examine water splitting under illumination.');ambiguous.summary='Light drives water splitting.';
  const data=fixture([real,ambiguous]);data.proposal.tags[0].name='WE';data.proposal.tags[0].fullName='water electrolysis';data.proposal.tags[0].aliases=[];
  const initial=prepare(data.proposal),tag=initial.proposal.tags[0],source=Object.values(data.snapshot.sources).find(value=>value.paperId==='reaction')!;
  assert.equal(initial.repairRequest,true);assert.deepEqual(initial.state.questions,[]);assert.equal(Object.values(initial.state.judgements).filter(value=>value.sourceId===source.factConceptId).length,0);
  const questioned=applyRepair({judgements:[{tagId:tag.id,registryId:data.registryIds[0],sourceIds:[source.factConceptId],relation:'needs-context',reason:'The supplied quotation does not establish electrochemical versus photochemical water splitting.'}]},initial,{repairAttempts:1});
  assert.equal(questioned.state.status,'questions');const question=questioned.state.questions[0];assert.ok(question.choices.some(choice=>choice.label==='Use WE for electrolysis systems'));assert.ok(question.choices.some(choice=>choice.label==='Keep separate technology and reaction tags'));
  const result=answer(questioned,question.id,'separate-reaction',{repairAttempts:1});assert.equal(result.state.status,'ready');const we=result.proposal.tags.find(value=>value.name==='WE')!,reaction=result.proposal.tags.find(value=>value.name==='water splitting')!;
  assert.equal(we.facet,'system');assert.equal(reaction.facet,'phenomenon');assert.notEqual(we.id,reaction.id);assert.deepEqual(result.proposal.support[we.id].paperIds,['electrolysis']);assert.deepEqual(result.proposal.support[reaction.id].paperIds,['reaction']);assert.ok(we.relatedIds!.includes(reaction.id));assert.deepEqual(reaction.broaderIds,[]);
  assert.equal(prepare(result.proposal,result.state,{repairAttempts:1}).proposal.tags.find(value=>value.name==='water splitting')!.id,reaction.id);
});

test('contextual unrelated verdicts are not overwritten by curated naming on the next pass',()=>{
  const data=fixture([fact('one','WE','Water electrolysis is discussed only as a comparison.')]);data.proposal.tags[0].name='WE';data.proposal.tags[0].fullName='water electrolysis';data.proposal.tags[0].aliases=[];const initial=prepare(data.proposal),tag=initial.proposal.tags[0],sourceId=Object.keys(data.snapshot.sources)[0];
  const result=applyRepair({judgements:[{tagId:tag.id,registryId:data.registryIds[0],sourceIds:[sourceId],relation:'unrelated',reason:'Electrolysis is incidental rather than the studied subject.'}]},initial,{repairAttempts:1});assert.ok(!result.proposal.tags.some(value=>value.id===tag.id));assert.equal(result.state.judgements[`${tag.id}|${sourceId}`].origin,'ai');
});

test('generated relationships and malformed support are repairable while protected meanings remain unchanged',()=>{
  const facts=[fact('one','EIS')],snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),proposal=createTaxonomyProposal({tags:[rawTag('eis','EIS',[],{facet:'method',parentKeys:['missing'],supportRegistryIds:'wrong shape'})]},facts,[],{snapshot}),tag=proposal.tags[0];
  // Keep a meaningful declared link so local pruning does not omit the malformed candidate.
  proposal.support[tag.id].registryIds=Object.keys(snapshot.entries);const protectedInitial=prepare(proposal,undefined,{protectedTagIds:[tag.id]});
  const fixed=applyRepair({tags:[{tagId:tag.id,name:'An overwritten meaning',supportRegistryIds:Object.keys(snapshot.entries)}]},protectedInitial,{protectedTagIds:[tag.id],repairAttempts:1});assert.equal(fixed.proposal.tags[0].name,'EIS');assert.ok(!fixed.proposal.validationIssues!.some(value=>value.code==='malformed-support'));
  const generated=applyRepair({tags:[{tagId:tag.id,broaderIds:[],supportRegistryIds:Object.keys(snapshot.entries)}]},prepare(proposal),{repairAttempts:1});assert.equal(generated.state.status,'ready');assert.deepEqual(generated.proposal.unresolvedRelationships,[]);
});

test('external processing diagnostics request bounded repair instead of immediate failure',()=>{
  const data=fixture([fact('one','EIS')]);data.proposal.tags[0].name='EIS';data.proposal.tags[0].fullName='electrochemical impedance spectroscopy';data.proposal.tags[0].facet='method';data.proposal.tags[0].aliases=[];data.proposal.externalIssues=['A completed provider reply needs structural revalidation.'];
  assert.equal(prepare(data.proposal).repairRequest,true);assert.equal(prepare(data.proposal,undefined,{repairAttempts:3}).state.status,'failed');
  data.proposal.externalIssues=['The provider did not return a completed response. Partial output is diagnostic only; explicitly regenerate this proposal.'];const initial=prepare(data.proposal),tag=initial.proposal.tags[0];
  assert.equal(applyRepair({tags:[{tagId:tag.id}]},initial,{repairAttempts:1}).repairRequest,true,'A partial repair cannot authorize partial initial output');
  const fixed=applyRepair({tags:[{...tag,tagId:tag.id,supportRegistryIds:data.registryIds}]},initial,{repairAttempts:1});assert.equal(fixed.state.status,'ready');assert.deepEqual(fixed.proposal.externalIssues,[]);
});

test('invalid generated merge recovery restores protected identities without changing selected evidence or edited meanings',()=>{
  const facts=[fact('one','fuel cell')],snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),existing:TagDefinition={id:'approved-fc',name:'FC',fullName:'fuel cell',description:'A preserved approved definition.',facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[]};
  const proposal=createTaxonomyProposal({tags:[rawTag('fc','FC',Object.keys(snapshot.entries),{facet:'system'})],merges:[{fromId:'approved-fc',toKey:'missing-target'}]},facts,[existing],{snapshot});assert.ok(proposal.unresolvedMerges!.length);const provisional=proposal.tags[0].id;proposal.tags[0].description='A researcher-edited fuel-cell scope.';
  const result=prepare(proposal,undefined,{facts,existingDefinitions:[existing],protectedTagIds:[provisional]});assert.deepEqual(result.proposal.unresolvedMerges??[],[]);assert.equal(result.proposal.tags[0].id,'approved-fc');assert.equal(result.proposal.tags[0].description,'A researcher-edited fuel-cell scope.');assert.deepEqual(result.proposal.support['approved-fc'].registryIds,Object.keys(snapshot.entries));assert.deepEqual(result.proposal.evidenceSnapshot,snapshot);assert.deepEqual(result.proposal.rawResponse,proposal.rawResponse);assert.ok(result.diagnostics.some(value=>value.includes('invalid generated merge')));
});

test('researcher removal of every core concept prevents same-generation recovery from resurrecting it',()=>{
  const facts=[fact('one','EIS')],snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),registryIds=Object.keys(snapshot.entries),proposal=createTaxonomyProposal({tags:[rawTag('eis','EIS',registryIds,{facet:'method'})]},facts,[],{snapshot}),initial=prepare(proposal),removed=initial.proposal.tags[0];
  initial.proposal.tags=[];initial.proposal.excluded.push({name:removed.name,reason:'Removed by the researcher.'});initial.state.excluded.push({tagId:removed.id,name:removed.name,reason:'Removed by the researcher.',origin:'researcher'});
  const empty=prepare(initial.proposal,initial.state,{facts});assert.equal(empty.state.status,'ready');assert.equal(empty.repairRequest,false);
  for(const key of ['eis','a-different-generated-key']){
    const replay=applyRepair({tags:[rawTag(key,'electrochemical impedance spectroscopy',registryIds,{facet:'method'})],merges:[],excluded:[]},empty,{facts,repairAttempts:1});assert.deepEqual(replay.proposal.tags,[]);assert.equal(replay.state.status,'ready');assert.equal(replay.repairRequest,false);assert.ok(replay.proposal.excluded.some(value=>value.reason==='Removed by the researcher.'));
  }
  const newProposal=createTaxonomyProposal({tags:[rawTag('new-eis','EIS',registryIds,{facet:'method'})]},facts,[],{snapshot});assert.equal(prepare(newProposal,empty.state,{facts}).proposal.tags.length,1,'A deliberate new build may reconsider an old exclusion');
});

test('standalone historical validation retains version-one semantics and proof bytes until preparation explicitly opts into policy two',()=>{
  const label='Anion-exchange membrane fuel cells (AEMFCs)',facts=[fact('one',label)],snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog());delete snapshot.normalizationVersion;
  for(const entry of Object.values(snapshot.entries)){delete entry.normalizationVersion;entry.key=terminologyKey(label,1);}
  const proposal=createTaxonomyProposal({tags:[rawTag('fc','FC',Object.keys(snapshot.entries),{facet:'system',aliases:[label]})]},facts,[],{snapshot}),tagId=proposal.tags[0].id;
  assert.ok(!proposal.validationIssues!.some(value=>value.code==='scientific-contradiction'));confirmProposalMapping(proposal,tagId,'original-review');const originalProof=fingerprint(proposal.mappingConfirmations),originalSnapshot=fingerprint(snapshot);
  refreshProposalEvidence(proposal);assert.deepEqual(proposal.issues,[]);assert.equal(fingerprint(proposal.mappingConfirmations),originalProof);assert.deepEqual(proposal.support[tagId].paperIds,['one']);assert.equal(proposal.preparationPolicyVersion,undefined);
  const updated=prepare(proposal);assert.equal(updated.proposal.preparationPolicyVersion,2);assert.ok(updated.proposal.validationIssues!.some(value=>value.code==='scientific-contradiction'));assert.equal(updated.repairRequest,true);assert.equal(fingerprint(updated.proposal.mappingConfirmations),originalProof);assert.equal(fingerprint(updated.proposal.evidenceSnapshot),originalSnapshot);assert.equal(proposal.preparationPolicyVersion,undefined);
});

test('library growth never inserts new version-two-only wording into an immutable version-one registry',()=>{
  const first=fact('old','fuel cell'),catalog=createEmptyEvidenceCatalog(),snapshot=createRegistrySnapshot([first],catalog),originalId=Object.keys(snapshot.entries)[0];delete catalog.entries[originalId].normalizationVersion;delete snapshot.entries[originalId].normalizationVersion;delete snapshot.normalizationVersion;
  const originalEntry=fingerprint(catalog.entries[originalId]),originalSnapshot=fingerprint(snapshot),newFact=fact('new','Fuel cells (FCs)'),expanded=createRegistrySnapshot([first,newFact],catalog);
  assert.deepEqual(validateRegistrySnapshot(expanded),[]);assert.equal(fingerprint(catalog.entries[originalId]),originalEntry);assert.equal(fingerprint(snapshot),originalSnapshot);assert.deepEqual(expanded.entries[originalId].sourceIds,[first.concepts[0].factConceptId]);
  const newEntry=Object.values(expanded.entries).find(value=>value.sourceIds.includes(newFact.concepts[0].factConceptId!))!;assert.notEqual(newEntry.registryId,originalId);assert.equal(newEntry.key,catalog.entries[originalId].key);assert.equal(newEntry.normalizationVersion,2);assert.deepEqual(validateRegistrySnapshot({...expanded,entries:catalog.entries,sources:catalog.sources}),[]);
  const repeated=createRegistrySnapshot([first,newFact],catalog);assert.deepEqual(Object.keys(repeated.entries).sort(),Object.keys(expanded.entries).sort());assert.deepEqual(validateRegistrySnapshot(repeated),[]);
});
