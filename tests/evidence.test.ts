import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyEvidenceCatalog,createRegistrySnapshot,ensureFactConceptIds,validateRegistrySnapshot,validateSnapshotAgainstFacts} from '../src/evidence.ts';
import {applyReferenceCorrection,buildConsolidationPrompt,buildCorrectionPrompt,confirmProposalMapping,createTaxonomyProposal,isProposalIssueBlocking,needsProposalCorrection,refreshProposalEvidence,removeProposalEvidenceLinks} from '../src/taxonomy.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
const fact=(id:string,name='fuel cell'):PaperFacts=>({paperId:id,metadataFingerprint:`metadata-${id}`,inputFingerprint:`input-${id}`,provider:'test-provider',model:'test-model',extractionVersion:1,summary:`A study of ${name}.`,needsPDF:false,concepts:[{name,facet:'system',evidence:[{source:'abstract',text:`Original quoted passage about ${name} in ${id}.`}]}]});
const rawTag=(key:string,name:string,registryIds:string[],extra:Record<string,unknown>={})=>({key,name,fullName:name,description:`Scope of ${name}`,facet:'system',supportRegistryIds:registryIds,...extra});
function setup(facts=[fact('one')]){const catalog=createEmptyEvidenceCatalog(),snapshot=createRegistrySnapshot(facts,catalog),ids=Object.keys(snapshot.entries);return {facts,catalog,snapshot,ids};}
test('local factual IDs preserve cached wording, quotes, provenance, and extractor version',()=>{
  const facts=[fact('one')],before=JSON.parse(JSON.stringify(facts));ensureFactConceptIds(facts);const id=facts[0].concepts[0].factConceptId;
  assert.match(id!,/^fact-/);ensureFactConceptIds(facts);assert.equal(facts[0].concepts[0].factConceptId,id);
  const clean=JSON.parse(JSON.stringify(facts));delete clean[0].concepts[0].factConceptId;assert.deepEqual(clean,before);
});
test('catalog grows while old snapshots retain exact paper/source scope and stable registry identity',()=>{
  const first=setup(),before=JSON.stringify(first.snapshot),secondFact=fact('two','Fuel cells'),next=createRegistrySnapshot([...first.facts,secondFact],first.catalog);
  assert.equal(Object.keys(next.entries).length,1);assert.deepEqual(Object.keys(next.entries),first.ids);
  assert.equal(next.entries[first.ids[0]].sourceIds.length,2);assert.equal(JSON.stringify(first.snapshot),before);
  assert.deepEqual(first.snapshot.paperIds,['one']);assert.deepEqual(next.paperIds,['one','two']);
});
test('catalog refuses mutation of an immutable factual source',()=>{
  const value=setup();value.facts[0].concepts[0].evidence[0].text='Changed quote';
  assert.throws(()=>createRegistrySnapshot(value.facts,value.catalog),/Immutable factual source changed/);
});
test('protocol v2 uses persistent registry IDs and representative source context at every size',()=>{
  for(const size of [1,151]){
    const value=setup(Array.from({length:size},(_,i)=>fact(String(i))));
    const prompt=buildConsolidationPrompt(value.facts,[],60,value.snapshot),data=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]);
    assert.equal(data.protocolVersion,2);assert.equal(data.facts,undefined);assert.equal(data.conceptRegistry[0].registryId,value.ids[0]);assert.ok(data.conceptRegistry[0].representativeContext[0].quotations.length);
    assert.ok(prompt.includes('supportRegistryIds'));
  }
});
test('candidate IDs survive reparsing and presentation renaming without evidence rematching',()=>{
  const value=setup(),candidateIds:Record<string,string>={},options={snapshot:value.snapshot,candidateIds,generationId:'generation-one',createdAt:'fixed'};
  const raw={tags:[rawTag('fc','Fuel cells',value.ids)]},proposal=createTaxonomyProposal(raw,value.facts,[],options),id=proposal.tags[0].id;
  assert.match(id,/^tag-[0-9a-f-]+$/);assert.equal(proposal.tags[0].name,'FC');assert.equal(proposal.support[id].paperIds.length,1);
  assert.equal(createTaxonomyProposal(raw,value.facts,[],options).tags[0].id,id);
  const before=JSON.stringify(proposal.support[id]);proposal.tags[0].name='FC display label';proposal.tags[0].fullName='An editable display phrase';refreshProposalEvidence(proposal);
  assert.equal(proposal.tags[0].id,id);assert.equal(JSON.stringify(proposal.support[id]),before);
});
test('new catalog sources cannot inflate coverage of an earlier proposal',()=>{
  const value=setup(),proposal=createTaxonomyProposal({tags:[rawTag('fc','FC',value.ids)]},value.facts,[],{snapshot:value.snapshot});
  createRegistrySnapshot([...value.facts,fact('outside')],value.catalog);refreshProposalEvidence(proposal);
  assert.deepEqual(proposal.support[proposal.tags[0].id].paperIds,['one']);
});
test('unknown and valid-but-outside-snapshot IDs remain reviewable and do not support tags',()=>{
  const value=setup(),outside=createRegistrySnapshot([fact('outside','battery')],value.catalog),outsideId=Object.keys(outside.entries)[0];
  const proposal=createTaxonomyProposal({tags:[rawTag('fc','FC',[...value.ids,'invented',outsideId])]},value.facts,[],{snapshot:value.snapshot});
  assert.equal(proposal.tags.length,1);assert.deepEqual(proposal.support[proposal.tags[0].id].paperIds,['one']);
  assert.equal(proposal.validationIssues!.filter(issue=>issue.code==='unknown-registry-id').length,2);assert.equal(needsProposalCorrection(proposal),true);
});
test('model-supplied object-prototype names are opaque candidate keys and never registry entries',()=>{
  const value=setup(),candidateIds:Record<string,string>={},proposal=createTaxonomyProposal({tags:[rawTag('__proto__','FC',[...value.ids,'constructor','__proto__'])]},value.facts,[],{snapshot:value.snapshot,candidateIds});
  assert.equal(typeof proposal.tags[0].id,'string');assert.ok(Object.hasOwn(candidateIds,'__proto__'));assert.equal(proposal.validationIssues!.filter(issue=>issue.code==='unknown-registry-id').length,2);
});
test('valid provenance cannot turn unrelated scientific evidence or subtypes into aliases',()=>{
  const value=setup([fact('pem','proton exchange membrane fuel cell'),fact('aem','anion exchange membrane fuel cell')]);
  const proposal=createTaxonomyProposal({tags:[rawTag('pem','PEMFC',value.ids,{aliases:['AEMFC']})]},value.facts,[],{snapshot:value.snapshot});
  assert.ok(proposal.validationIssues!.some(issue=>issue.code==='scientific-contradiction'));assert.equal(proposal.support[proposal.tags[0].id].paperIds.length,1);
  assert.throws(()=>confirmProposalMapping(proposal,proposal.tags[0].id),/contradictions/);
});
test('presentation verification cannot be reused to rename Co into CO or a broad technology into its subtype',()=>{
  for(const [original,replacement] of [['Co','CO'],['FC','AEMFC']]){
    const value=setup([fact('one',original)]),proposal=createTaxonomyProposal({tags:[rawTag('one',original,value.ids)]},value.facts,[],{snapshot:value.snapshot});
    assert.deepEqual(proposal.issues,[]);const tag=proposal.tags[0];tag.name=replacement;refreshProposalEvidence(proposal);
    assert.ok(proposal.validationIssues!.some(issue=>issue.code==='scientific-contradiction'));assert.deepEqual(proposal.support[tag.id].paperIds,[]);
  }
});
test('uncertain mappings require explicit confirmation bound to snapshot and meaning',()=>{
  const value=setup([fact('one','catalyst-layer proton resistance')]);
  const proposal=createTaxonomyProposal({tags:[rawTag('r','protonic resistance',value.ids,{aliases:['catalyst-layer proton resistance']})]},value.facts,[],{snapshot:value.snapshot}),id=proposal.tags[0].id;
  assert.equal(needsProposalCorrection(proposal),false);assert.equal(proposal.support[id].paperIds.length,0);assert.ok(proposal.issues.length);
  confirmProposalMapping(proposal,id,'fixed');assert.equal(proposal.issues.length,0);assert.equal(proposal.support[id].paperIds.length,1);
  assert.ok(proposal.validationIssues!.every(issue=>!isProposalIssueBlocking(proposal,issue)));
  const roundTrip=JSON.parse(JSON.stringify(proposal));refreshProposalEvidence(roundTrip);assert.equal(roundTrip.issues.length,0);
  proposal.tags[0].description='A different meaning or narrower scientific scope';refreshProposalEvidence(proposal);
  assert.ok(proposal.issues.length);assert.equal(proposal.mappingConfirmations![id],undefined);assert.equal(proposal.support[id].paperIds.length,0);
});
test('removing an unsupported registry link repairs its diagnostics without losing supported links',()=>{
  const value=setup(),proposal=createTaxonomyProposal({tags:[rawTag('fc','FC',[...value.ids,'invented'])]},value.facts,[],{snapshot:value.snapshot}),id=proposal.tags[0].id;
  removeProposalEvidenceLinks(proposal,id,['invented']);assert.deepEqual(proposal.issues,[]);assert.deepEqual(proposal.support[id].paperIds,['one']);
});
test('one reference correction preserves identities, valid evidence and unaffected candidate meanings',()=>{
  const value=setup([fact('one'),fact('two','water electrolysis')]);
  const proposal=createTaxonomyProposal({tags:[rawTag('fc','FC',[value.ids[0],'invented']),rawTag('we','WE',[value.ids[1]])]},value.facts,[],{snapshot:value.snapshot});
  const fc=proposal.tags[0],weBefore=JSON.stringify(proposal.tags[1]),corrected=applyReferenceCorrection({repairs:[{tagId:fc.id,name:'Battery',supportRegistryIds:[]},{tagId:proposal.tags[1].id,supportRegistryIds:[]}]},proposal);
  assert.equal(corrected.tags[0].id,fc.id);assert.equal(corrected.tags[0].name,'FC');assert.equal(JSON.stringify(corrected.tags[1]),weBefore);
  assert.deepEqual(corrected.support[fc.id].registryIds,[value.ids[0]]);assert.deepEqual(corrected.issues,[]);
  assert.ok(buildCorrectionPrompt(proposal).includes('only automatic correction attempt'));
});
test('a support-reference correction cannot erase valid subtype or contextual relationships with empty default arrays',()=>{
  const value=setup([fact('pem','proton exchange membrane fuel cell'),fact('aem','anion exchange membrane fuel cell')]);
  const proposal=createTaxonomyProposal({tags:[rawTag('fc','FC',[]),rawTag('pem','PEMFC',[value.ids[0],'invented'],{parentKeys:['fc'],relatedKeys:['aem']}),rawTag('aem','AEMFC',[value.ids[1]],{parentKeys:['fc']})]},value.facts,[],{snapshot:value.snapshot});
  const pem=proposal.tags.find(tag=>tag.name==='PEMFC')!,fc=proposal.tags.find(tag=>tag.name==='FC')!,parents=[...pem.broaderIds],related=[...(pem.relatedIds??[])];
  const corrected=applyReferenceCorrection({repairs:[{tagId:pem.id,supportRegistryIds:[value.ids[0]],parentIds:[],relatedIds:[]}]},proposal);
  assert.deepEqual(corrected.issues,[]);assert.deepEqual(corrected.tags.find(tag=>tag.id===pem.id)!.broaderIds,parents);assert.deepEqual(corrected.tags.find(tag=>tag.id===pem.id)!.relatedIds,related);assert.deepEqual(corrected.support[fc.id].paperIds,['aem','pem']);
});
test('relationship correction removes invalid references while retaining valid existing relationships',()=>{
  const value=setup([fact('one'),fact('two','other system')]),proposal=createTaxonomyProposal({tags:[rawTag('fc','FC',[value.ids[0]]),rawTag('other','other system',[value.ids[1]],{parentKeys:['missing-parent'],relatedKeys:['fc','missing-related']})]},value.facts,[],{snapshot:value.snapshot});
  const other=proposal.tags.find(tag=>tag.name==='other system')!,fc=proposal.tags.find(tag=>tag.name==='FC')!,corrected=applyReferenceCorrection({repairs:[{tagId:other.id,parentIds:[],relatedIds:[]}]},proposal);
  assert.deepEqual(corrected.tags.find(tag=>tag.id===other.id)!.relatedIds,[fc.id]);assert.ok(!corrected.validationIssues!.some(issue=>issue.tagId===other.id&&issue.code==='invalid-relationship'));
});
test('malformed initial/correction responses remain diagnostics rather than silently dropping a proposal',()=>{
  const value=setup(),proposal=createTaxonomyProposal('malformed JSON',value.facts,[],{snapshot:value.snapshot});
  assert.deepEqual(proposal.tags,[]);assert.ok(proposal.issues.some(message=>message.includes('Malformed consolidation JSON')));
  const corrected=applyReferenceCorrection('malformed',proposal);assert.ok(corrected.correctionDiagnostics!.some(message=>message.includes('Correction response')));
});
test('duplicate keys and malformed candidates preserve other usable candidates for review',()=>{
  const value=setup(),proposal=createTaxonomyProposal({tags:[rawTag('fc','FC',value.ids),rawTag('fc','FC',value.ids),{key:'invalid',name:'Invalid'}]},value.facts,[],{snapshot:value.snapshot});
  assert.equal(proposal.tags.length,1);assert.equal(proposal.support[proposal.tags[0].id].paperIds.length,1);assert.ok(proposal.issues.some(message=>message.includes('Duplicate consolidation key')));
});
test('excluding an affected candidate clears its malformed support diagnostic while global diagnostics remain blocking',()=>{
  const value=setup([fact('one'),fact('two','water electrolysis')]),proposal=createTaxonomyProposal({tags:[rawTag('fc','FC',[value.ids[0]]),rawTag('we','WE',[value.ids[1]],{supportRegistryIds:'not-an-array'})]},value.facts,[],{snapshot:value.snapshot}),bad=proposal.tags.find(tag=>tag.name==='WE')!;
  assert.ok(proposal.validationIssues!.some(issue=>issue.tagId===bad.id&&issue.field==='supportRegistryIds'));proposal.tags=proposal.tags.filter(tag=>tag.id!==bad.id);refreshProposalEvidence(proposal);assert.deepEqual(proposal.issues,[]);
  const malformed=createTaxonomyProposal({noTags:[]},value.facts,[],{snapshot:value.snapshot});malformed.tags=[];refreshProposalEvidence(malformed);assert.ok(malformed.issues.length);
});
test('one array reference correction heals reference-shape errors without clearing unrelated malformed diagnostics',()=>{
  for(const malformed of [{supportRegistryIds:'wrong-type'},{support:[{paperId:'one',conceptNames:['fuel cell']}]}]){
    const value=setup(),proposal=createTaxonomyProposal({tags:[rawTag('fc','FC',value.ids,malformed)]},value.facts,[],{snapshot:value.snapshot}),id=proposal.tags[0].id;
    assert.ok(proposal.validationIssues!.some(issue=>issue.field==='supportRegistryIds'));const healed=applyReferenceCorrection({repairs:[{tagId:id,supportRegistryIds:value.ids}]},proposal);assert.deepEqual(healed.issues,[]);assert.deepEqual(healed.support[id].paperIds,['one']);
  }
  const value=setup(),duplicate=createTaxonomyProposal({tags:[rawTag('fc','FC',value.ids),rawTag('fc','FC',value.ids)]},value.facts,[],{snapshot:value.snapshot}),id=duplicate.tags[0].id,repaired=applyReferenceCorrection({repairs:[{tagId:id,supportRegistryIds:value.ids}]},duplicate);assert.ok(repaired.issues.some(message=>message.includes('Duplicate consolidation key')));
});
test('unknown relationship diagnostics persist and can be repaired without changing candidate IDs',()=>{
  const value=setup(),proposal=createTaxonomyProposal({tags:[rawTag('fc','FC',value.ids,{parentKeys:['invented']})]},value.facts,[],{snapshot:value.snapshot});
  const id=proposal.tags[0].id;refreshProposalEvidence(proposal);assert.ok(proposal.validationIssues!.some(issue=>issue.code==='invalid-relationship'&&issue.tagId===id));
  const repaired=applyReferenceCorrection({repairs:[{tagId:id,parentIds:[]}]},proposal);assert.equal(repaired.tags[0].id,id);assert.deepEqual(repaired.issues,[]);
});
test('scientifically contradictory subtype edges are blocked and cannot inflate ancestor coverage',()=>{
  const value=setup([fact('one','proton exchange membrane fuel cell'),fact('two','anion exchange membrane fuel cell')]);
  const proposal=createTaxonomyProposal({tags:[rawTag('pem','PEMFC',[value.ids[0]],{parentKeys:['aem']}),rawTag('aem','AEMFC',[value.ids[1]])]},value.facts,[],{snapshot:value.snapshot});
  assert.ok(proposal.validationIssues!.some(issue=>issue.code==='scientific-contradiction'));
  assert.deepEqual(proposal.support[proposal.tags[1].id].paperIds,['two']);
});
test('snapshot import/export retains exact evidence IDs and rejects altered provenance or quotations',()=>{
  const value=setup(),roundTrip=JSON.parse(JSON.stringify(value.snapshot));assert.deepEqual(validateSnapshotAgainstFacts(roundTrip,value.facts),[]);
  roundTrip.sources[Object.keys(roundTrip.sources)[0]].evidence[0].text='Fabricated quote';assert.ok(validateSnapshotAgainstFacts(roundTrip,value.facts).some(message=>message.includes('differs')));
});
test('a registry identity key must match every exact factual source it groups',()=>{
  const value=setup(),snapshot=JSON.parse(JSON.stringify(value.snapshot));snapshot.entries[value.ids[0]].key='AEMWE';
  assert.ok(validateRegistrySnapshot(snapshot).some(message=>message.includes('identity key')));
});
test('imported own-property prototype names cannot become factual or registry identities',()=>{
  for(const reserved of ['__proto__','constructor','prototype']){
    const value=setup(),snapshot=JSON.parse(JSON.stringify(value.snapshot)),sourceId=Object.keys(snapshot.sources)[0],entry=snapshot.entries[value.ids[0]],source=snapshot.sources[sourceId];
    delete snapshot.sources[sourceId];Object.defineProperty(snapshot.sources,reserved,{value:{...source,factConceptId:reserved},enumerable:true,writable:true});entry.sourceIds=[reserved];
    delete snapshot.entries[value.ids[0]];Object.defineProperty(snapshot.entries,reserved,{value:{...entry,registryId:reserved},enumerable:true,writable:true});
    const issues=validateRegistrySnapshot(snapshot);assert.ok(issues.some(message=>message.includes('factual source identity')));assert.ok(issues.some(message=>message.includes('registry entry')));
  }
});
test('the same unfamiliar acronym cannot automatically ground different scientific meanings across papers',()=>{
  const first=fact('one','ML'),second=fact('two','ML');first.concepts[0].evidence[0].text='ML uses machine learning to predict catalyst properties.';second.concepts[0].evidence[0].text='ML denotes mass loss measured after catalyst cycling.';
  const value=setup([first,second]),proposal=createTaxonomyProposal({tags:[rawTag('ml','ML',value.ids,{fullName:'machine learning',description:'Machine learning methods for scientific prediction.'})]},value.facts,[],{snapshot:value.snapshot});
  assert.ok(proposal.validationIssues!.some(issue=>issue.code==='uncertain-meaning'&&issue.paperIds?.includes('two')));assert.deepEqual(proposal.support[proposal.tags[0].id].paperIds,[]);assert.equal(needsProposalCorrection(proposal),false);
  const expanded=setup([first]),grounded=createTaxonomyProposal({tags:[rawTag('ml','ML',expanded.ids,{fullName:'machine learning',description:'Machine learning methods for scientific prediction.'})]},expanded.facts,[],{snapshot:expanded.snapshot});
  assert.deepEqual(grounded.issues,[]);assert.deepEqual(grounded.support[grounded.tags[0].id].paperIds,['one']);
});
test('a selected 51-paper snapshot excludes other cached facts while assigning local IDs without extraction',()=>{
  const all=Array.from({length:97},(_,i)=>fact(`paper-${i}`)),original=JSON.parse(JSON.stringify(all));ensureFactConceptIds(all);
  const catalog=createEmptyEvidenceCatalog();createRegistrySnapshot(all,catalog);const selected=createRegistrySnapshot(all.slice(0,51),catalog);
  assert.equal(selected.paperIds.length,51);assert.equal(Object.keys(selected.sources).length,51);assert.equal(Object.keys(catalog.sources).length,97);
  assert.deepEqual(Object.values(selected.sources).map(source=>source.evidence),original.slice(0,51).map(fact=>fact.concepts[0].evidence));
  assert.ok(Object.values(selected.sources).every(source=>source.provider==='test-provider'&&source.model==='test-model'&&source.extractionVersion===1));
});
