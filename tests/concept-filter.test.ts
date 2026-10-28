import test from 'node:test';
import assert from 'node:assert/strict';
import {compileConceptFilter,matchConceptFilter,matchCompiledConceptFilter,descendantIds,equivalentTagNames} from '../src/concept-filter.ts';
import type {ConceptFilter} from '../src/concept-filter.ts';
import type {TagDefinition} from '../src/core.ts';

function tag(id:string,name:string,overrides:Partial<TagDefinition>={}):TagDefinition{return {id,name,fullName:name,description:`Meaning of ${name}`,facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[],relatedIds:[],matchingMode:'auto',...overrides};}
const definitions=[
  tag('fc','FC',{fullName:'Fuel cells',aliases:['fuel cell']}),
  tag('pemfc','PEMFC',{fullName:'Proton exchange membrane fuel cell',broaderIds:['fc']}),
  tag('aemfc','AEMFC',{fullName:'Anion exchange membrane fuel cell',broaderIds:['fc']}),
  tag('we','WE',{fullName:'Water electrolysis'}),tag('pemwe','PEMWE',{fullName:'Proton exchange membrane water electrolysis',broaderIds:['we']}),
  tag('eis','EIS',{fullName:'Electrochemical impedance spectroscopy',facet:'method'}),
  tag('sb','Schottky barrier',{facet:'phenomenon',custom:true,matchingMode:'manual',relatedIds:['fc']}),
  tag('cl','CL',{fullName:'Catalyst layer',facet:'component'}),
  tag('grooved','Grooved catalyst layer',{facet:'component',custom:true,matchingMode:'suggest',broaderIds:['cl']}),
  tag('co','Co',{fullName:'Cobalt',facet:'component'}),tag('carbon-monoxide','CO',{fullName:'Carbon monoxide',facet:'component'}),
  tag('draft','Draft fuel cell',{status:'draft',broaderIds:['fc']}),
];
const filter=(mode:'all'|'any',...ids:string[]):ConceptFilter=>({mode,selections:ids.map(conceptId=>({conceptId}))});

test('cleared filters match the library, including papers without any tags',()=>{
  const compiled=compileConceptFilter(definitions,filter('all'));
  assert.deepEqual(compiled,{mode:'all',clauses:[],empty:false});
  assert.equal(matchCompiledConceptFilter([],compiled),true);
  assert.equal(matchConceptFilter(['unmanaged'],definitions,filter('any')),true);
});

test('parent retrieval expands approved is-a descendants without requiring native ancestor tags',()=>{
  assert.deepEqual(descendantIds('fc',definitions),['fc','aemfc','pemfc']);
  assert.equal(matchConceptFilter(['PEMFC'],definitions,filter('all','fc')),true);
  assert.equal(matchConceptFilter(['AEMFC'],definitions,filter('all','fc')),true);
  assert.equal(matchConceptFilter(['FC'],definitions,filter('all','pemfc')),false);
  assert.equal(matchConceptFilter(['PEMWE'],definitions,filter('all','fc')),false);
  assert.equal(matchConceptFilter(['Draft fuel cell'],definitions,filter('all','fc')),false);
});

test('related associations do not imply inherited membership',()=>{
  assert.equal(matchConceptFilter(['Schottky barrier'],definitions,filter('all','fc')),false);
  assert.ok(!compileConceptFilter(definitions,filter('all','fc')).clauses[0].groups[0].includes('Schottky barrier'));
});

test('All and Any combine independent selections without confusing siblings',()=>{
  assert.equal(matchConceptFilter(['PEMFC'],definitions,filter('all','pemfc','aemfc')),false);
  assert.equal(matchConceptFilter(['PEMFC'],definitions,filter('any','pemfc','aemfc')),true);
  assert.equal(matchConceptFilter(['PEMFC','AEMFC'],definitions,filter('all','pemfc','aemfc')),true);
  assert.equal(matchConceptFilter(['PEMFC'],definitions,filter('all','fc','pemfc')),true);
});

test('contextual DIY selections remain compound clauses inside global Any',()=>{
  const selected:ConceptFilter={mode:'any',selections:[{conceptId:'sb',contextId:'fc'},{conceptId:'eis'}]};
  const compiled=compileConceptFilter(definitions,selected);
  assert.equal(compiled.clauses[0].groups.length,2);assert.equal(compiled.clauses[1].groups.length,1);
  assert.equal(matchCompiledConceptFilter(['Schottky barrier','PEMFC'],compiled),true);
  assert.equal(matchCompiledConceptFilter(['EIS'],compiled),true);
  assert.equal(matchCompiledConceptFilter(['Schottky barrier'],compiled),false);
  assert.equal(matchCompiledConceptFilter(['FC'],compiled),false);
  selected.mode='all';
  assert.equal(matchConceptFilter(['Schottky barrier','PEMFC'],definitions,selected),false);
  assert.equal(matchConceptFilter(['Schottky barrier','PEMFC','EIS'],definitions,selected),true);
});

test('manual-only DIY tags are searchable and may be selected without a context',()=>{
  assert.equal(matchConceptFilter(['Schottky barrier'],definitions,filter('all','sb')),true);
  assert.equal(matchConceptFilter(['Grooved catalyst layer'],definitions,filter('all','cl')),false);
  assert.equal(matchConceptFilter(['Grooved catalyst layer'],definitions,{mode:'all',selections:[{conceptId:'grooved',contextId:'fc'}]}),false);
});

test('legacy DIY broaderIds are context placements and never confer inherited core membership',()=>{
  const legacy=[...definitions,tag('legacy','RCL detail',{custom:true,facet:'phenomenon',broaderIds:['fc']})];
  assert.ok(!descendantIds('fc',legacy).includes('legacy'));
  assert.equal(matchConceptFilter(['RCL detail'],legacy,filter('all','fc')),false);
  assert.equal(matchConceptFilter(['RCL detail'],legacy,filter('all','legacy')),true);
  const scoped:ConceptFilter={mode:'all',selections:[{conceptId:'legacy',contextId:'fc'}]};
  assert.equal(matchConceptFilter(['RCL detail'],legacy,scoped),false);
  assert.equal(matchConceptFilter(['RCL detail','PEMFC'],legacy,scoped),true);
});

test('aliases/full names match prose case while scientific symbol case remains distinct',()=>{
  assert.equal(matchConceptFilter(['fuel cells'],definitions,filter('all','fc')),true);
  assert.equal(matchConceptFilter(['fuel cell'],definitions,filter('all','fc')),true);
  assert.equal(matchConceptFilter(['Proton exchange membrane fuel cell'],definitions,filter('all','fc')),true);
  assert.equal(matchConceptFilter(['Co'],definitions,filter('all','co')),true);
  assert.equal(matchConceptFilter(['CO'],definitions,filter('all','co')),false);
  assert.equal(matchConceptFilter(['Co'],definitions,filter('all','carbon-monoxide')),false);
  assert.deepEqual(equivalentTagNames(definitions[0]),['FC','Fuel cells','fuel cell']);
});

test('invalid nodes/context never broaden All filters and act as false clauses inside Any',()=>{
  assert.equal(matchConceptFilter(['PEMFC'],definitions,filter('all','fc','unknown')),false);
  assert.equal(matchConceptFilter(['PEMFC'],definitions,filter('any','fc','unknown')),true);
  assert.equal(matchConceptFilter(['anything'],definitions,filter('any','unknown')),false);
  const scoped:ConceptFilter={mode:'any',selections:[{conceptId:'sb',contextId:'unknown'},{conceptId:'eis'}]};
  assert.equal(matchConceptFilter(['Schottky barrier'],definitions,scoped),false);
  assert.equal(matchConceptFilter(['EIS'],definitions,scoped),true);
  assert.equal(matchConceptFilter(['Draft fuel cell'],definitions,filter('any','draft')),false);
});

test('overlapping branches and legacy cycles terminate and deduplicate descendant IDs',()=>{
  const graph=[tag('a','A',{broaderIds:['b']}),tag('b','B',{broaderIds:['a']}),tag('c','C',{broaderIds:['a','b']})];
  assert.deepEqual(new Set(descendantIds('a',graph)),new Set(['a','b','c']));
  assert.equal(matchConceptFilter(['C'],graph,filter('all','a')),true);
});
