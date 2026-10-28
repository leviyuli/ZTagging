import test from 'node:test';
import assert from 'node:assert/strict';
import {isProposalIssueBlocking,createProposalIssueEvaluator} from '../src/taxonomy.ts';
import type {TaxonomyProposal,ProposalValidationIssue} from '../src/taxonomy.ts';
import {fingerprint} from '../src/core.ts';

test('blocking unconfirmed mappings never traverses the potentially large evidence snapshot',()=>{
  let snapshotReads=0;
  const proposal={mappingConfirmations:{}} as TaxonomyProposal;
  Object.defineProperty(proposal,'evidenceSnapshot',{get(){snapshotReads++;throw new Error('Unconfirmed mappings do not require evidence hashing.');}});
  for(let index=0;index<1000;index++){
    const issue:ProposalValidationIssue={id:`issue-${index}`,code:'uncertain-meaning',tagId:`tag-${index%60}`,severity:'confirmation',message:'A scientific mapping needs explicit confirmation.'};
    assert.equal(isProposalIssueBlocking(proposal,issue),true);
  }
  assert.equal(snapshotReads,0);
});

test('one evaluation pass hashes a confirmed mapping once and a new pass detects changed source evidence',()=>{
  const tag={id:'scientific-topic',name:'topic',fullName:'topic',description:'The reviewed scientific meaning.',facet:'phenomenon' as const,inclusions:[],exclusions:[],examples:[],aliases:[],broaderIds:[],custom:false,status:'draft' as const};
  const snapshot={id:'snapshot',protocolVersion:2 as const,paperIds:['paper'],entries:{registry:{registryId:'registry',key:'topic',sourceIds:['source']}},sources:{source:{factConceptId:'source',paperId:'paper',name:'topic',summary:'Source summary.',metadataFingerprint:'metadata',inputFingerprint:'input',provider:'test',model:'test',extractionVersion:1 as const,evidence:[{source:'abstract' as const,text:'Original exact source passage.'}]}}};
  const meaning={description:tag.description,facet:tag.facet,inclusions:tag.inclusions,exclusions:tag.exclusions,examples:tag.examples};
  const historicalProof=fingerprint({snapshot,tagId:tag.id,meaning,registryIds:['registry']});
  let snapshotReads=0;const proposal={tags:[tag],support:{[tag.id]:{registryIds:['registry'],paperIds:['paper']}},mappingConfirmations:{[tag.id]:{fingerprint:historicalProof,confirmedAt:'2026-10-28T00:00:00.000Z'}}} as unknown as TaxonomyProposal;
  Object.defineProperty(proposal,'evidenceSnapshot',{get(){snapshotReads++;return snapshot;}});
  const issue:ProposalValidationIssue={id:'issue',code:'uncertain-meaning',tagId:tag.id,severity:'confirmation',message:'Review the scientific mapping.'},evaluate=createProposalIssueEvaluator(proposal);
  for(let index=0;index<100;index++)assert.equal(evaluate(issue),false);
  assert.equal(snapshotReads,1);assert.equal(proposal.mappingConfirmations![tag.id].fingerprint,historicalProof,'Existing persisted confirmation hashes keep their exact format');
  snapshot.sources.source.evidence[0].text='Changed source passage.';assert.equal(createProposalIssueEvaluator(proposal)(issue),true);assert.equal(snapshotReads,2);
  assert.equal(isProposalIssueBlocking(proposal,issue),true);assert.equal(snapshotReads,3,'The single-issue API never reuses a prior pass');
});
