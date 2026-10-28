import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFactExtractionPrompt,normalizeFacts,buildConsolidationPrompt,createTaxonomyProposal,validateTaxonomy} from '../src/taxonomy.ts';
import type {PaperFacts} from '../src/taxonomy.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import {paperFingerprint} from '../src/core.ts';

function paper(id='p1',abstract='We study proton exchange membrane fuel cells under varied operating conditions.'):PaperRecord {
  const value:PaperRecord={id,itemID:1,libraryID:1,key:id,title:'Scientific paper',abstract,keywords:[],fingerprint:''};value.fingerprint=paperFingerprint(value);return value;
}
function fact(id='p1',name='Proton exchange membrane fuel cell',quote='We study proton exchange membrane fuel cells under varied operating conditions.'):PaperFacts {
  return normalizeFacts({summary:name,concepts:[{name,facet:'system',evidence:[{source:'abstract',text:quote}]}],needsPDF:false},paper(id,quote),'deepseek','test-model');
}
function definition(id:string,name:string,overrides:Partial<TagDefinition>={}):TagDefinition{return {id,name,fullName:name,description:`Scientific scope of ${name}`,facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'draft',broaderIds:[],relatedIds:[],matchingMode:'auto',...overrides};}
function rawTag(key:string,name:string,fullName=name,extra:Record<string,unknown>={}){return {key,name,fullName,description:`Scientific scope of ${fullName}`,facet:'system',aliases:[],parentKeys:[],relatedKeys:[],support:[],...extra};}
const link=(paperId:string,...conceptNames:string[])=>({paperId,conceptNames});

test('fact extraction accepts only source-grounded concepts and keeps scientific casing',()=>{
  const p=paper('p','Co nanoparticles catalyze the conversion of CO into products.');
  const result=normalizeFacts({summary:'Cobalt and carbon monoxide are distinguished.',concepts:[
    {name:'Co',facet:'component',evidence:[{source:'abstract',text:'Co nanoparticles'}]},
    {name:'CO',facet:'component',evidence:[{source:'abstract',text:'CO into products.'}]},
    {name:'Invented lithium result',evidence:[{source:'abstract',text:'Lithium improves performance by 15%.'}]},
  ]},p,'deepseek','m');
  assert.deepEqual(result.concepts.map(c=>c.name),['Co','CO']);assert.equal(result.needsPDF,true);
  assert.equal(result.provider,'deepseek');assert.equal(result.extractionVersion,1);
  assert.equal(result.metadataFingerprint,paperFingerprint({...p,pdfText:undefined}));
  assert.equal(result.inputFingerprint,paperFingerprint(p));
});

test('facts do not accept bibliography-only PDF quotes or ungrounded model strings',()=>{
  const p={...paper(),pdfText:'A battery study.\nReferences\nSmith: Proton exchange membrane fuel cell resistance.'};
  const result=normalizeFacts({summary:'',concepts:[{name:'Fuel cell',evidence:[{source:'pdf',text:'Proton exchange membrane fuel cell resistance.'}]},'An ungrounded concept']},p,'api','m');
  assert.deepEqual(result.concepts,[]);
  assert.throws(()=>normalizeFacts({concepts:'bad'},paper(),'api','m'),/concepts array/);
});

test('fact extraction inputs are independent of vocabulary and include PDF text only when requested',()=>{
  const p={...paper(),pdfText:'PDF source data'};
  assert.ok(!buildFactExtractionPrompt(p).includes('PDF source data'));
  assert.ok(buildFactExtractionPrompt(p,true).includes('PDF source data'));
  assert.ok(!buildFactExtractionPrompt(p).includes('approvedVocabulary'));
  assert.ok(buildFactExtractionPrompt(p).includes('independently of any tag vocabulary'));
});

test('a global 50-paper proposal consolidates old 107 drafts into canonical parent/children and preserves DIY',()=>{
  const existing=Array.from({length:107},(_,i)=>definition(`old-${i}`,`Fine concept ${i}`));
  const diy=definition('rcl','RCL',{custom:true,facet:'phenomenon',matchingMode:'manual',status:'approved',description:'Catalyst-layer resistance.'});existing.push(diy);
  const before=JSON.stringify(existing);
  const facts=Array.from({length:50},(_,i)=>fact(`p${i}`,i%2?'Anion exchange membrane fuel cell':'Proton exchange membrane fuel cell',i%2?'We study anion exchange membrane fuel cells.':'We study proton exchange membrane fuel cells.'));
  const proposal=createTaxonomyProposal({tags:[rawTag('fc','FC','Fuel cell'),
    rawTag('pem','PEMFC','Proton exchange membrane fuel cell',{parentKeys:['fc'],support:facts.filter((_,i)=>i%2===0).map(f=>link(f.paperId,f.concepts[0].name))}),
    rawTag('aem','AEMFC','Anion exchange membrane fuel cell',{parentKeys:['fc'],support:facts.filter((_,i)=>i%2===1).map(f=>link(f.paperId,f.concepts[0].name))})],merges:[],excluded:[]},facts,existing,{baseVersion:7,createdAt:'2026-10-28T00:00:00.000Z'});
  assert.equal(proposal.tags.filter(t=>!t.custom).length,3);assert.equal(proposal.tags.length,4);
  assert.deepEqual(proposal.issues,[]);assert.equal(proposal.baseVersion,7);assert.equal(proposal.coreLimit,60);
  const parent=proposal.tags.find(t=>t.name==='FC')!,child=proposal.tags.find(t=>t.name==='PEMFC')!;
  assert.deepEqual(child.broaderIds,[parent.id]);assert.equal(proposal.support[parent.id].paperIds.length,50);
  assert.equal(proposal.support[child.id].paperIds.length,25);assert.ok(proposal.support[child.id].evidence!.length>0);
  assert.equal(proposal.tags.find(t=>t.id==='rcl')!.matchingMode,'manual');assert.equal(proposal.excluded.length,107);
  assert.equal(JSON.stringify(existing),before,'Creating a draft cannot mutate the active or old draft vocabulary');
});

test('synonym consolidation preserves a stable existing ID and makes other IDs explicit redirects',()=>{
  const old=[definition('approved-long','Fuel cell',{status:'approved'}),definition('draft-short','FC',{aliases:['Fuel cell']})];
  const facts=[fact('p','Fuel cell','We study a fuel cell in this experiment.')];
  const raw={tags:[rawTag('fc','FC','Fuel cell',{support:[link('p','Fuel cell')]})],merges:[{fromId:'approved-long',toKey:'fc'},{fromId:'draft-short',toKey:'fc'}]};
  const proposal=createTaxonomyProposal(raw,facts,old,{createdAt:'same'});
  assert.equal(proposal.tags[0].id,'approved-long');assert.equal(proposal.tags[0].name,'FC');assert.equal(proposal.tags[0].fullName,'Fuel cell');
  assert.deepEqual(proposal.merges,[{fromId:'draft-short',toId:'approved-long'}]);assert.deepEqual(proposal.issues,[]);
  assert.deepEqual(proposal,createTaxonomyProposal(raw,facts,old,{createdAt:'same'}),'Unchanged input must not append a new set of labels');
});

test('known aliases resolve to existing IDs rather than creating a canonical duplicate',()=>{
  const old=[definition('fc','FC',{fullName:'Fuel cell',aliases:['Fuel cells'],status:'approved'})];
  const facts=[fact('p','Fuel cells','Fuel cells are studied experimentally.')];
  const proposal=createTaxonomyProposal({tags:[rawTag('fc','Fuel cells','Fuel cell',{support:[link('p','Fuel cells')]})]},facts,old);
  assert.equal(proposal.tags.length,1);assert.equal(proposal.tags[0].id,'fc');assert.deepEqual(proposal.issues,[]);
});

test('unapproved false aliases do not survive consolidation or prevent stable ID reuse',()=>{
  const old=[definition('old-ptl','PTL',{fullName:'Porous transport layer',aliases:['GDL'],status:'draft'})];
  const facts=[fact('ptl','Porous transport layer','A porous transport layer is characterized.'),fact('gdl','Gas diffusion layer','A gas diffusion layer is characterized.')];
  const raw={tags:[rawTag('ptl','PTL','Porous transport layer',{support:[link('ptl','Porous transport layer')]}),rawTag('gdl','GDL','Gas diffusion layer',{support:[link('gdl','Gas diffusion layer')]})]};
  const proposal=createTaxonomyProposal(raw,facts,old);
  const ptl=proposal.tags.find(t=>t.name==='PTL')!,gdl=proposal.tags.find(t=>t.name==='GDL')!;
  assert.equal(ptl.id,'old-ptl');assert.notEqual(ptl.id,gdl.id);assert.ok(!ptl.aliases.includes('GDL'));assert.deepEqual(proposal.issues,[]);
  const approved=createTaxonomyProposal({...raw,merges:[{fromId:'old-ptl',toKey:'ptl'}]},facts,[{...old[0],status:'approved'}]);
  assert.ok(approved.issues.some(issue=>issue.includes('Ambiguous')),'Already approved equivalences require review before being changed');
});

test('the core cap counts both parents and leaves, never silently truncates, and can be configured above default60',()=>{
  const facts=Array.from({length:61},(_,i)=>fact(`p${i}`,`Concept ${i}`,`Evidence supporting scientific concept ${i}.`));
  const raw={tags:facts.map((f,i)=>rawTag(`c${i}`,`Concept ${i}`,`Concept ${i}`,{support:[link(f.paperId,f.concepts[0].name)]}))};
  const over=createTaxonomyProposal(raw,facts,[]);assert.equal(over.tags.length,61);assert.ok(over.issues.some(issue=>issue.includes('61 core concepts')));
  assert.deepEqual(createTaxonomyProposal(raw,facts,[],{limit:70}).issues,[]);
  assert.throws(()=>createTaxonomyProposal(raw,facts,[],{limit:0}),/between 1 and 500/);
});

test('AI cannot bypass the core cap by creating a custom tag and DIY merge attempts stay quarantined',()=>{
  const facts=[fact()],diy=definition('diy','Detail',{custom:true});
  assert.throws(()=>createTaxonomyProposal({tags:[rawTag('x','X','X',{custom:true})]},facts,[]),/cannot create DIY/);
  const proposal=createTaxonomyProposal({tags:[rawTag('x','X','X')],merges:[{fromId:'diy',toKey:'x'}]},facts,[diy]);
  assert.ok(proposal.unresolvedMerges?.[0].reason.includes('cannot be merged'));
  assert.deepEqual(proposal.merges,[]);assert.equal(proposal.tags.find(tag=>tag.id==='diy')!.custom,true);assert.equal(diy.name,'Detail');
});

test('unsupported evidence IDs and fact concepts are rejected while conflicting merge mappings are withheld',()=>{
  const facts=[fact()],old=[definition('old','Old',{status:'approved'})];
  assert.throws(()=>createTaxonomyProposal({tags:[rawTag('x','X','X',{supportPaperIds:['invented']})]},facts,[]),/Unknown supporting paper/);
  assert.throws(()=>createTaxonomyProposal({tags:[rawTag('x','X','X',{support:[link('p1','Invented concept')]})]},facts,[]),/Unknown or ungrounded supporting concept/);
  const proposal=createTaxonomyProposal({tags:[rawTag('a','A'),rawTag('b','B')],merges:[{fromId:'old',toKey:'a'},{fromId:'old',toKey:'b'}]},facts,old);
  assert.equal(proposal.unresolvedMerges?.length,2);assert.ok(proposal.unresolvedMerges!.every(merge=>merge.reason.includes('Conflicting targets')));assert.deepEqual(proposal.merges,[]);
});

test('an invented old merge ID is quarantined without discarding supported tags or valid exact-ID mappings',()=>{
  const facts=[fact('p','Fuel cell','A fuel cell is characterized.')],old=[definition('old-fc','Legacy fuel cell',{status:'approved',aliases:['Fuel cell']})];
  const before=JSON.stringify(old);
  const proposal=createTaxonomyProposal({tags:[rawTag('fc','FC','Fuel cell',{support:[link('p','Fuel cell')]})],merges:[{fromId:'tag-714a5d4e61ef0e6a',toKey:'fc'},{fromId:'old-fc',toKey:'fc'}]},facts,old);
  assert.equal(proposal.tags[0].id,'old-fc');assert.deepEqual(proposal.support['old-fc'].paperIds,['p']);assert.deepEqual(proposal.issues,[]);
  assert.deepEqual(proposal.unresolvedMerges,[{fromId:'tag-714a5d4e61ef0e6a',toReference:'fc',reason:'Unknown old concept ID: tag-714a5d4e61ef0e6a.'}]);
  assert.ok(proposal.tags[0].aliases.includes('Legacy fuel cell'));assert.equal(JSON.stringify(old),before);
});

test('one invalid target quarantines every mapping for that known source and prevents identity fallback',()=>{
  const facts=[fact('p','Fuel cell','A fuel cell is characterized.')],old=[definition('old-fc','Fuel cell',{status:'approved',aliases:['Legacy FC']})];
  const proposal=createTaxonomyProposal({tags:[rawTag('fc','FC','Fuel cell',{support:[link('p','Fuel cell')]})],merges:[{fromId:'old-fc',toKey:'fc'},{fromId:'old-fc',toKey:'missing'}]},facts,old);
  assert.equal(proposal.unresolvedMerges?.length,2);assert.deepEqual(proposal.merges,[]);assert.notEqual(proposal.tags[0].id,'old-fc');
  assert.ok(!proposal.tags[0].aliases.includes('Legacy FC'));assert.ok(proposal.unresolvedMerges!.some(merge=>merge.reason.includes('Unknown proposed merge target')));
  assert.equal(proposal.excluded.find(item=>item.name==='Fuel cell')?.name,'Fuel cell');
});

test('quarantined known identities cannot be reclaimed through generated IDs or first-target wins',()=>{
  const facts=[fact('p','Fuel cell','A fuel cell is characterized.')],raw={tags:[rawTag('fc','FC','Fuel cell',{support:[link('p','Fuel cell')]})]};
  const generated=createTaxonomyProposal(raw,facts,[]).tags[0].id,old=[definition(generated,'FC',{fullName:'Fuel cell',status:'approved'})];
  const proposal=createTaxonomyProposal({...raw,merges:[{fromId:generated,toKey:'missing'},{fromId:generated,toKey:'fc'}]},facts,old);
  assert.notEqual(proposal.tags[0].id,generated);assert.deepEqual(proposal.merges,[]);assert.equal(proposal.unresolvedMerges?.length,2);
  const resolved=createTaxonomyProposal(raw,facts,old);assert.equal(resolved.tags[0].id,generated,'Discarding malformed instructions before reparsing restores safe exact identity matching');
});

test('malformed merge containers remain schema failures and duplicate valid mappings are idempotent',()=>{
  const facts=[fact('p','Fuel cell','A fuel cell is characterized.')],old=[definition('old-fc','Fuel cell',{status:'approved'})],tags=[rawTag('fc','FC','Fuel cell',{support:[link('p','Fuel cell')]})];
  assert.throws(()=>createTaxonomyProposal({tags,merges:{}},facts,old),/merges must be an array/);
  const proposal=createTaxonomyProposal({tags,merges:[{fromId:'old-fc',toKey:'fc'},{fromId:'old-fc',toKey:'fc'}]},facts,old);
  assert.equal(proposal.tags[0].id,'old-fc');assert.equal(proposal.unresolvedMerges,undefined);
});

test('a paper with unrelated valid facts cannot inflate a tag support count',()=>{
  const facts=[fact('battery','Battery','We study lithium battery cycling.')];
  const legacy=createTaxonomyProposal({tags:[rawTag('fc','FC','Fuel cell',{supportPaperIds:['battery']})]},facts,[]);
  assert.deepEqual(legacy.support[legacy.tags[0].id].paperIds,[]);assert.ok(legacy.issues.length>0);
  const explicit=createTaxonomyProposal({tags:[rawTag('fc','FC','Fuel cell',{support:[link('battery','Battery')]})]},facts,[]);
  assert.deepEqual(explicit.support[explicit.tags[0].id].paperIds,[]);assert.ok(explicit.issues.some(issue=>issue.includes('not a canonical name')));
});

test('support evidence contains only selected concepts and is-a ancestors inherit valid child evidence',()=>{
  const fcQuote='We study proton exchange membrane fuel cells.',clQuote='A catalyst layer is characterized independently.';
  const p=paper('p',`${fcQuote} ${clQuote}`);
  const facts=[normalizeFacts({summary:'Two components are studied.',concepts:[{name:'Proton exchange membrane fuel cell',facet:'system',evidence:[{source:'abstract',text:fcQuote}]},{name:'Catalyst layer',facet:'component',evidence:[{source:'abstract',text:clQuote}]}]},p,'deepseek','m')];
  const proposal=createTaxonomyProposal({tags:[rawTag('fc','FC','Fuel cell'),rawTag('pem','PEMFC','Proton exchange membrane fuel cell',{parentKeys:['fc'],support:[link('p','Proton exchange membrane fuel cell')]}),rawTag('cl','CL','Catalyst layer',{facet:'component',relatedKeys:['fc'],support:[link('p','Catalyst layer')]})]},facts,[]);
  assert.deepEqual(proposal.issues,[]);
  const parent=proposal.tags.find(t=>t.name==='FC')!,cl=proposal.tags.find(t=>t.name==='CL')!;
  assert.ok(proposal.support[parent.id].evidence!.every(quote=>quote.text===fcQuote));
  assert.ok(proposal.support[cl.id].evidence!.every(quote=>quote.text===clQuote));
  assert.deepEqual(cl.broaderIds,[]);assert.deepEqual(cl.relatedIds,[parent.id]);
});

test('full-name aliases cannot belong to multiple concepts, while Co and CO remain distinct',()=>{
  assert.deepEqual(validateTaxonomy([definition('co','Co',{fullName:'Cobalt'}),definition('CO','CO',{fullName:'Carbon monoxide'})]),[]);
  const ambiguous=[definition('a','PEM',{fullName:'Polymer electrolyte membrane'}),definition('b','PEMFC',{fullName:'PEM',broaderIds:[]})];
  assert.ok(validateTaxonomy(ambiguous).some(issue=>issue.includes('Ambiguous name or alias')));
});

test('manual/imported graph validation rejects cycles, dangling references and part-of masquerading as cross-facet is-a',()=>{
  const graph=[definition('a','FC',{broaderIds:['b']}),definition('b','PEMFC',{broaderIds:['a']}),definition('c','MEA',{facet:'component',broaderIds:['a'],relatedIds:['missing']})];
  const issues=validateTaxonomy(graph);
  assert.ok(issues.some(issue=>issue.includes('cycle')));assert.ok(issues.some(issue=>issue.includes('share a facet')));assert.ok(issues.some(issue=>issue.includes('Unknown related')));
});

test('consolidation prompts contain the complete alias/hierarchy input and explicit global/support constraints',()=>{
  const defs=[definition('fc','FC',{fullName:'Fuel cell',aliases:['Fuel cells'],broaderIds:['parent'],relatedIds:['related'],status:'approved'})];
  const prompt=buildConsolidationPrompt([fact()],defs,35);
  assert.ok(prompt.includes('35 CORE concepts TOTAL'));assert.ok(prompt.includes('conceptNames'));assert.ok(prompt.includes('same concept'));
  assert.ok(prompt.includes('Fuel cells'));assert.ok(prompt.includes('"broaderIds":["parent"]'));assert.ok(prompt.includes('"relatedIds":["related"]'));
  const input=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]);assert.deepEqual(input.mergeSourceIds,['fc']);assert.ok(prompt.includes('copied literally from mergeSourceIds'));
  const withDIY=JSON.parse(buildConsolidationPrompt([fact()],[...defs,definition('detail','RCL',{custom:true})]).split('INPUT_DATA_JSON:\n')[1]);assert.deepEqual(withDIY.mergeSourceIds,['fc']);
});

test('unaccepted drafts are replaceable prompt candidates without authoritative IDs',()=>{
  const draft=definition('unaccepted-draft-id','Draft FC',{fullName:'Fuel cell',aliases:['Wrong old alias']}),detail=definition('detail','RCL',{custom:true});
  const prompt=buildConsolidationPrompt([fact()],[draft,detail]),input=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]);
  assert.deepEqual(input.mergeSourceIds,[]);assert.deepEqual(input.existingVocabulary.map((tag:TagDefinition)=>tag.id),['detail']);
  assert.deepEqual(input.draftCandidates,[{name:'Draft FC',fullName:'Fuel cell',description:draft.description,facet:'system',aliases:['Wrong old alias']}]);
  assert.ok(!prompt.includes('unaccepted-draft-id'));assert.ok(prompt.includes('return merges:[]'));assert.ok(prompt.includes('overwrite, rename, or omit them freely'));
});

test('rebuilding only unaccepted core drafts ignores non-applicable merge bookkeeping',()=>{
  const facts=[fact('p','Fuel cell','A fuel cell is characterized.')],old=[definition('old-draft','Fuel cell')],tags=[rawTag('fc','FC','Fuel cell',{support:[link('p','Fuel cell')]})];
  const proposal=createTaxonomyProposal({tags,merges:[{fromId:'tag-714a5d4e61ef0e6a',toKey:'fc'},{fromId:'old-draft',toKey:'missing'}]},facts,old);
  assert.equal(proposal.unresolvedMerges,undefined);assert.deepEqual(proposal.issues,[]);assert.equal(proposal.tags[0].id,'old-draft');
  assert.deepEqual(proposal.support['old-draft'].paperIds,['p']);
  assert.equal(createTaxonomyProposal({tags,merges:{}},facts,old).unresolvedMerges,undefined);
});

test('mixed vocabularies ignore draft-source model merges without inheriting their names',()=>{
  const facts=[fact('p','Fuel cell','A fuel cell is characterized.')],old=[definition('approved-fc','Fuel cell',{status:'approved'}),definition('unaccepted-layer','Gas diffusion layer',{aliases:['GDL']})];
  const tags=[rawTag('fc','FC','Fuel cell',{support:[link('p','Fuel cell')]})];
  const proposal=createTaxonomyProposal({tags,merges:[{fromId:'unaccepted-layer',toKey:'fc'}]},facts,old);
  assert.equal(proposal.tags[0].id,'approved-fc');assert.equal(proposal.unresolvedMerges,undefined);assert.deepEqual(proposal.issues,[]);
  assert.ok(!proposal.tags[0].aliases.includes('Gas diffusion layer'));assert.ok(!proposal.tags[0].aliases.includes('GDL'));
  const unknown=createTaxonomyProposal({tags,merges:[{fromId:'unknown-approved-or-draft',toKey:'fc'}]},facts,old);
  assert.equal(unknown.unresolvedMerges?.length,1,'Unknown identity references still require review when approved concepts exist');
});

test('small consolidation input retains every concept while omitting repeated quotes and provenance',()=>{
  const facts=Array.from({length:50},(_,i)=>({...fact(`p${i}`),summary:'Long summary '.repeat(100)}));
  const prompt=buildConsolidationPrompt(facts,[]),data=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]);
  assert.equal(data.facts.length,50);assert.ok(data.facts.every((f:any)=>f.summary.length<=240));
  assert.deepEqual(data.facts[0].concepts,[{name:PEM_LABEL,facet:'system'}]);
  assert.ok(data.facts.every((f:any)=>f.metadataFingerprint===undefined&&f.provider===undefined&&f.concepts.every((c:any)=>c.evidence===undefined)));
});

const PEM_LABEL='Proton exchange membrane fuel cell';
test('large consolidation registries retain every grounded name and paper identity without carrying raw quotes',()=>{
  const facts=Array.from({length:150},(_,i)=>fact(`p${i}`,i%2?'Fuel cell':'Water electrolysis',`Exact source passage ${i} is validated locally.`));
  facts.push({...fact('empty'),concepts:[]});
  const data=JSON.parse(buildConsolidationPrompt(facts,[]).split('INPUT_DATA_JSON:\n')[1]);
  assert.equal(data.facts,undefined);assert.equal(data.paperCount,151);assert.equal(data.conceptRegistry.length,2);
  assert.deepEqual(new Set(data.conceptRegistry.flatMap((entry:any)=>entry.paperIds).concat(data.unmappedPaperIds)),new Set(facts.map(f=>f.paperId)));
  assert.ok(data.conceptRegistry.every((entry:any)=>entry.summary.length<=160));
  assert.ok(!JSON.stringify(data).includes('Exact source passage'));
});

test('registry support references expand back to all exact local sources and verified evidence',()=>{
  const facts=Array.from({length:150},(_,i)=>fact(`p${i}`,'Fuel cell',`A fuel cell is measured in experiment ${i}.`));
  const proposal=createTaxonomyProposal({tags:[rawTag('fc','FC','Fuel cell',{supportConcepts:['Fuel cell']})]},facts,[]);
  assert.deepEqual(proposal.issues,[]);assert.equal(proposal.support[proposal.tags[0].id].paperIds.length,150);
  assert.ok(proposal.support[proposal.tags[0].id].evidence!.every(evidence=>facts.some(f=>f.paperId===evidence.paperId&&f.concepts.some(c=>c.evidence.some(q=>q.text===evidence.text)))));
  assert.equal(Object.keys(proposal.paperInputFingerprints!).length,150);
  assert.throws(()=>createTaxonomyProposal({tags:[rawTag('fc','FC','Fuel cell',{supportConcepts:['invented']})]},facts,[]),/Unknown supporting registry concept/);
});
