import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/controller.ts';
import {cleanupLegacyDraftDefinitions,inferEditedProposalTagIds,pruneProposalSupport} from '../src/legacy-cleanup.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot} from '../src/evidence.ts';
import {createTaxonomyProposal} from '../src/taxonomy.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import type {TagDefinition} from '../src/core.ts';
const copy=<T>(value:T):T=>structuredClone(value);
function tag(id:string,extra:Partial<TagDefinition>={}):TagDefinition{return {id,name:id,fullName:id,description:'A legacy scientific definition.',facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'draft',broaderIds:[],relatedIds:[],matchingMode:'auto',...extra};}
function state(){const value=initialState();value.tags=Array.from({length:106},(_,index)=>tag(`tag-${index}`));value.tags.push(tag('custom-detail',{custom:true}));return value;}

test('cleanup deletes only baseline-identical unused generated drafts and does not archive or change native data',()=>{
  const value=state(),baseline=copy(value.tags);value.nativeTags.paper=[{tag:'tag-105',type:0},{tag:'Imported keyword',type:1}];
  value.taxonomyProposal={id:'proposal',createdAt:'now',inputFingerprint:'input',baseVersion:0,coreLimit:60,tags:copy(value.tags.slice(0,28)),support:{},merges:[],excluded:[],issues:[],paperIds:[]};
  value.tags[90].broaderIds=['tag-91'];baseline[90].broaderIds=['tag-91'];
  const before=JSON.stringify(value),result=cleanupLegacyDraftDefinitions(value,baseline);
  assert.equal(result.removedIds.length,78);assert.equal(result.tags.length,29);assert.equal(result.tags.at(-1)!.custom,true);
  assert.equal(JSON.stringify(value),before,'the cleanup module is pure');assert.deepEqual(value.taxonomyArchives,[]);
  assert.deepEqual(cleanupLegacyDraftDefinitions(value).removedIds,[],'an absent baseline cannot establish stale origin');
});

test('manual, approved, custom, changed and explicitly edited definitions remain protected',()=>{
  const value=state(),baseline=copy(value.tags);value.tags[0].status='approved';value.tags[1].description='Changed by the researcher.';
  value.tags.push(tag('custom-manual-core'));baseline.push(copy(value.tags.at(-1)!));value.userEditedTagIds=['tag-2'];
  const result=cleanupLegacyDraftDefinitions(value,baseline),remaining=new Set(result.tags.map(tag=>tag.id));
  for(const id of ['tag-0','tag-1','tag-2','custom-detail','custom-manual-core'])assert.ok(remaining.has(id),id);
});

test('reference roots preserve historical identities and transitively needed relations but garbage-only relations do not keep drafts live',()=>{
  const value=state(),baseline=copy(value.tags);
  value.decisions['paper|tag-0']={rejected:true};value.ownership.paper={'tag-1':{name:'Old name',changeId:'change'}};
  value.suggestions=[{tagId:'tag-2'}] as typeof value.suggestions;value.run={detailId:'tag-3',jobs:[{tagId:'tag-4'}]} as unknown as NonNullable<typeof value.run>;
  value.history=[{beforeOwnership:{paper:{'tag-5':{name:'Old name',changeId:'change'}}},afterDecisions:{'paper|tag-6':{locked:true}}}] as unknown as typeof value.history;
  value.pendingChange={beforeDecisions:{'paper|tag-7':{rejected:true}}} as unknown as NonNullable<typeof value.pendingChange>;
  value.taxonomyArchives=[{tags:[tag('tag-8')]}] as typeof value.taxonomyArchives;
  value.tags[0].broaderIds=['tag-9'];baseline[0].broaderIds=['tag-9'];value.tags[9].relatedIds=['tag-10'];baseline[9].relatedIds=['tag-10'];
  value.tags[90].broaderIds=['tag-91'];baseline[90].broaderIds=['tag-91'];
  const remaining=new Set(cleanupLegacyDraftDefinitions(value,baseline).tags.map(tag=>tag.id));
  for(let index=0;index<=10;index++)assert.ok(remaining.has(`tag-${index}`));
  assert.ok(!remaining.has('tag-90'));assert.ok(!remaining.has('tag-91'));
});

function proposalFixture(){
  const value=initialState();value.tags=[];
  const facts:PaperFacts[]=[{paperId:'paper',metadataFingerprint:'metadata',inputFingerprint:'input',provider:'synthetic',model:'test',extractionVersion:1,summary:'A factual synopsis.',needsPDF:false,concepts:[{name:'charge-transfer resistance',facet:'phenomenon',evidence:[{source:'abstract',text:'Charge-transfer resistance is measured.'}]}]}];
  const snapshot=createRegistrySnapshot(facts,createEmptyEvidenceCatalog());snapshot.normalizationVersion=1;
  const registry=Object.keys(snapshot.entries)[0],raw={tags:[{key:'resistance',name:'Electrode resistance',fullName:'Electrode resistance',description:'Electrode transport resistance.',facet:'phenomenon',aliases:['charge-transfer resistance'],inclusions:[],exclusions:[],examples:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[registry]}]};
  value.taxonomyProposal=createTaxonomyProposal(raw,facts,[],{snapshot});return value;
}
test('original generated and ordinary save-normalized definitions do not become human-edit protection',()=>{
  const value=proposalFixture();assert.deepEqual(inferEditedProposalTagIds(value),[]);
  const topic=value.taxonomyProposal!.tags[0];topic.aliases=topic.aliases.filter(alias=>alias.toLowerCase()!==topic.name.toLowerCase());
  assert.deepEqual(inferEditedProposalTagIds(value),[]);
  value.taxonomyProposal!.support[topic.id]={paperIds:[],registryIds:[],sourceIds:[]};assert.deepEqual(inferEditedProposalTagIds(value),[],'a generated zero-source concept remains repairable');
});

test('manual meaning, category, alias and relationship changes are inferred while missing or malformed originals stay conservative',()=>{
  for(const change of [(topic:TagDefinition)=>{topic.description='A manually narrowed meaning.';},(topic:TagDefinition)=>{topic.facet='component';},(topic:TagDefinition)=>{topic.aliases.push('Researcher alias');}]){
    const value=proposalFixture(),topic=value.taxonomyProposal!.tags[0];change(topic);assert.ok(inferEditedProposalTagIds(value).includes(topic.id));
  }
  const value=proposalFixture(),topic=value.taxonomyProposal!.tags[0];value.taxonomyProposal!.rawResponse='Malformed JSON }';assert.ok(inferEditedProposalTagIds(value).includes(topic.id));
});

test('pruning deleted-candidate coverage preserves source snapshots, raw responses, IDs and human proofs',()=>{
  const value=proposalFixture(),proposal=value.taxonomyProposal!,raw=JSON.stringify(proposal.rawResponse),snapshot=JSON.stringify(proposal.evidenceSnapshot);
  proposal.support.removed={paperIds:['paper'],registryIds:['obsolete']};proposal.mappingConfirmations={removed:{fingerprint:'historical-proof',confirmedAt:'2026-10-28T00:00:00Z'}};
  pruneProposalSupport(proposal);assert.equal(proposal.support.removed,undefined);assert.equal(JSON.stringify(proposal.rawResponse),raw);assert.equal(JSON.stringify(proposal.evidenceSnapshot),snapshot);
  assert.equal(proposal.mappingConfirmations.removed.fingerprint,'historical-proof');
});
