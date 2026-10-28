import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalTagKey} from '../src/core.ts';
import {preferredCoreNaming,terminologyKey,equivalentTerminology} from '../src/naming.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot} from '../src/evidence.ts';
import type {PaperFacts} from '../src/taxonomy.ts';

test('AEMWE dictionary handles established singular, plural and hyphenated full forms',()=>{
  for(const label of ['Anion exchange membrane water electrolysis','Anion-exchange membrane water electrolyzers','Anion exchange membrane water electrolyzer','Anion-exchange membrane water electrolyzers (AEMWEs)','AEMWEs','AEM-WE']){
    const value=preferredCoreNaming(label);assert.equal(value.name,'AEMWE');assert.equal(value.fullName,'anion-exchange membrane water electrolyzer');assert.equal(terminologyKey(label),'AEMWE');
  }
  assert.ok(preferredCoreNaming('AEMWE').aliases.includes('anion-exchange membrane water electrolyzers'));
});
test('known technologies remain separate despite parent-child or contextual relationships',()=>{
  assert.equal(equivalentTerminology('Fuel cells','FC'),true);
  for(const [a,b] of [['FC','AEMFC'],['AEMFC','PEMFC'],['PTL','GDL'],['CL','FC']])assert.equal(equivalentTerminology(a,b),false);
});
test('core presentation preserves scientific symbols and explicitly singularizes ordinary dictionary nouns',()=>{
  for(const name of ['Co','CO','pH','EIS','NiFe','CO2','10^-3 S cm^-1'])assert.equal(preferredCoreNaming(name).name,name);
  assert.notEqual(canonicalTagKey('Co'),canonicalTagKey('CO'));
  assert.equal(equivalentTerminology('cobalt','Co'),true);assert.equal(equivalentTerminology('carbon monoxide','CO'),true);assert.equal(equivalentTerminology('cobalt','CO'),false);
  assert.notEqual(canonicalTagKey('pH'),canonicalTagKey('ph'));
  assert.equal(preferredCoreNaming('Grooved Catalyst Layers').name,'grooved catalyst layer');
  assert.equal(preferredCoreNaming('Schottky Barriers').name,'schottky barrier');
});
test('naming does not generically remove hyphens or a terminal s',()=>{
  assert.notEqual(terminologyKey('surface-redox'),terminologyKey('surface redox'));
  for(const name of ['gas','stress','analysis','mass transports'])assert.equal(preferredCoreNaming(name).name,name);
});
test('AEMWE spelling variants retain one persistent registry ID as papers arrive, while Co and CO retain separate IDs',()=>{
  const catalog=createEmptyEvidenceCatalog(),makeFact=(name:string,index:number):PaperFacts=>({paperId:`paper-${index}`,metadataFingerprint:`metadata-${index}`,inputFingerprint:`input-${index}`,provider:'test',model:'test',extractionVersion:1,summary:name,needsPDF:false,concepts:[{name,evidence:[{source:'title',text:name}]}]});
  const original=createRegistrySnapshot([makeFact('AEMWE',0)],catalog),id=Object.keys(original.entries)[0];
  for(const [index,name] of ['AEMWEs','AEM-WE','anion-exchange membrane water electrolyzer','anion exchange membrane water electrolyzers'].entries())assert.deepEqual(Object.keys(createRegistrySnapshot([makeFact(name,index+1)],catalog).entries),[id]);
  const chemicals=createRegistrySnapshot([makeFact('Co',20),makeFact('CO',21)],catalog);assert.equal(Object.keys(chemicals.entries).length,2);assert.notEqual(Object.keys(chemicals.entries)[0],Object.keys(chemicals.entries)[1]);
});
