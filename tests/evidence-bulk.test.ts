import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {fingerprint} from '../src/core.ts';
import type {TagDefinition} from '../src/core.ts';
import {createRegistrySnapshot,createEmptyEvidenceCatalog} from '../src/evidence.ts';
import {confirmProposalMapping,confirmProposalMappings,createTaxonomyProposal,isProposalIssueBlocking} from '../src/taxonomy.ts';
import type {PaperFacts} from '../src/taxonomy.ts';

const fact=(paperId:string,name:string):PaperFacts=>({paperId,metadataFingerprint:`metadata-${paperId}`,inputFingerprint:`input-${paperId}`,provider:'synthetic',model:'synthetic',extractionVersion:1,summary:name,needsPDF:false,concepts:[{name,facet:'phenomenon',evidence:[{source:'abstract',text:`This exact scientific passage studies ${name}.`}]}]});
const rawTag=(key:string,name:string,sourceName:string,supportRegistryIds:string[])=>({key,name,fullName:name,description:`Scientific scope of ${name}.`,facet:'phenomenon',aliases:[sourceName],supportRegistryIds});
function fixture(){
  const facts=[fact('one','charge-transfer resistance'),fact('two','surface redox process'),fact('three','fuel cell'),fact('four','spectroscopic imaging')],snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog());
  const support=(name:string)=>Object.values(snapshot.entries).filter(entry=>entry.sourceIds.some(id=>snapshot.sources[id].name===name)).map(entry=>entry.registryId);
  const custom:TagDefinition={id:'custom-detail',name:'My DIY Name',description:'A user-created detail.',facet:'phenomenon',custom:true,status:'approved',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],matchingMode:'suggest'};
  const proposal=createTaxonomyProposal({tags:[rawTag('resistance','electrode resistance','charge-transfer resistance',support('charge-transfer resistance')),rawTag('redox','surface process','surface redox process',support('surface redox process')),rawTag('contradiction','AEMFC','anion exchange membrane fuel cell',support('fuel cell')),rawTag('imaging','imaging method','spectroscopic imaging',support('spectroscopic imaging'))]},facts,[custom],{snapshot,limit:2});
  const id=(name:string)=>proposal.tags.find(tag=>tag.name===name)!.id;
  return {proposal,id};
}

test('bulk confirmation includes pending eligible core mappings and preserves global limits, errors, existing decisions and DIY names',()=>{
  const {proposal,id}=fixture(),already=id('imaging method'),wrong=id('AEMFC');
  confirmProposalMapping(proposal,already,'2026-10-28T00:00:00.000Z');const originalConfirmation={...proposal.mappingConfirmations![already]};
  proposal.externalIssues=['The global API budget still requires review.'];
  const result=confirmProposalMappings(proposal,undefined,'2026-10-28T01:00:00.000Z');assert.equal(result,proposal);
  for(const name of ['electrode resistance','surface process']){const tagId=id(name);assert.equal(proposal.mappingConfirmations![tagId].confirmedAt,'2026-10-28T01:00:00.000Z');assert.ok(proposal.support[tagId].paperIds.length);}
  assert.deepEqual(proposal.mappingConfirmations![already],originalConfirmation);assert.equal(proposal.mappingConfirmations![wrong],undefined);assert.deepEqual(proposal.support[wrong].paperIds,[]);assert.equal(proposal.mappingConfirmations!['custom-detail'],undefined);assert.equal(proposal.tags.find(tag=>tag.custom)!.name,'My DIY Name');
  assert.ok(!proposal.issues.some(message=>message.includes('limit is 2')));assert.ok(proposal.issues.some(message=>message.includes('global API budget')));assert.ok(proposal.validationIssues!.some(issue=>issue.code==='scientific-contradiction'&&isProposalIssueBlocking(proposal,issue)));assert.ok(proposal.tags.filter(tag=>!tag.custom).every(tag=>tag.status==='draft'));
});

test('bulk selection is atomic for stale IDs and leaves unselected or error-bearing mappings pending',()=>{
  const {proposal,id}=fixture(),selected=id('electrode resistance'),unselected=id('surface process'),before=fingerprint(proposal);
  assert.throws(()=>confirmProposalMappings(proposal,[selected,'removed-tag']),/changed|Refresh/);assert.equal(fingerprint(proposal),before);
  confirmProposalMappings(proposal,[selected,selected,id('AEMFC'),'custom-detail'],'2026-10-28T02:00:00.000Z');assert.equal(proposal.mappingConfirmations![selected].confirmedAt,'2026-10-28T02:00:00.000Z');assert.equal(proposal.mappingConfirmations![unselected],undefined);assert.equal(proposal.mappingConfirmations![id('AEMFC')],undefined);
  const unchanged=fingerprint(proposal);confirmProposalMappings(proposal,[]);assert.equal(fingerprint(proposal),unchanged);
});

test('a validation exception during bulk preparation cannot partially confirm the original proposal',()=>{
  const {proposal,id}=fixture(),entry=Object.values(proposal.evidenceSnapshot!.entries)[0];
  (entry as any).sourceIds=null;const before=fingerprint(proposal);
  assert.throws(()=>confirmProposalMappings(proposal,[id('electrode resistance'),id('surface process')]));
  assert.equal(fingerprint(proposal),before);assert.deepEqual(proposal.mappingConfirmations,{});
});

test('a batch of fifty mappings completes within an interaction budget with stable evidence and one shared timestamp',()=>{
  const facts:PaperFacts[]=Array.from({length:10},(_,paper)=>({paperId:`paper-${paper}`,metadataFingerprint:`metadata-${paper}`,inputFingerprint:`input-${paper}`,provider:'synthetic',model:'synthetic',extractionVersion:1,summary:'A synthetic scientific synopsis.',needsPDF:false,concepts:Array.from({length:50},(_,concept)=>({name:`factual process ${concept}`,facet:'phenomenon',evidence:[{source:'abstract',text:`Exact evidence about factual process ${concept} in paper ${paper}. `+'A verified scientific observation. '.repeat(10)}]}))}));
  const snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog()),tags=Object.values(snapshot.entries).map((entry,index)=>rawTag(`candidate-${index}`,`reviewed process ${index}`,snapshot.sources[entry.sourceIds[0]].name,[entry.registryId])),proposal=createTaxonomyProposal({tags},facts,[],{snapshot}),originalSnapshot=fingerprint(proposal.evidenceSnapshot),identities=proposal.tags.map(tag=>tag.id),timestamp='2026-10-28T03:00:00.000Z';
  const start=performance.now();confirmProposalMappings(proposal,undefined,timestamp);const elapsed=performance.now()-start;
  assert.equal(Object.keys(proposal.mappingConfirmations!).length,50);assert.ok(Object.values(proposal.mappingConfirmations!).every(confirmation=>confirmation.confirmedAt===timestamp));assert.deepEqual(proposal.tags.map(tag=>tag.id),identities);assert.equal(fingerprint(proposal.evidenceSnapshot),originalSnapshot);assert.deepEqual(proposal.issues,[]);assert.ok(proposal.tags.every(tag=>proposal.support[tag.id].paperIds.length===10));
  assert.ok(elapsed<10_000,`Fifty mappings took ${Math.round(elapsed)} ms; batching must avoid validating the whole proposal after each tag.`);
});
