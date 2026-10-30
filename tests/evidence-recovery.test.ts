import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord} from '../src/core.ts';
import {createEmptyEvidenceCatalog,createRegistrySnapshot,recoverPaperFactsFromSnapshot,validateSnapshotAgainstFacts} from '../src/evidence.ts';
import {normalizeFacts} from '../src/taxonomy.ts';
function fixture(){
 const paper:PaperRecord={id:'1:current',itemID:1,libraryID:1,key:'current',title:'Membrane resistance study',abstract:'Impedance measurements establish membrane resistance.',keywords:['impedance'],pdfText:'The measured proton transport increases with membrane hydration.',fingerprint:'stale cached fingerprint'};
 const fact=normalizeFacts({summary:'Transport and resistance were measured in a membrane.',needsPDF:false,concepts:[{name:'membrane resistance',facet:'phenomenon',evidence:[{source:'abstract',text:paper.abstract}]},{name:'proton transport',facet:'phenomenon',evidence:[{source:'pdf',text:paper.pdfText}]}]},paper,'original-provider','original-model');
 const outside:PaperRecord={...paper,id:'1:outside',key:'outside',title:'Another paper'},outsideFact=normalizeFacts({summary:'Another scope.',concepts:[{name:'impedance',facet:'method',evidence:[{source:'abstract',text:paper.abstract}]}]},outside,'other-provider','other-model'),snapshot=createRegistrySnapshot([fact,outsideFact],createEmptyEvidenceCatalog());
 return {paper,fact,outsideFact,snapshot};
}

test('snapshot cache recovery preserves exact factual identities, quotations and provenance within the verified paper scope',()=>{
 const value=fixture(),before=fingerprint(value),restored=recoverPaperFactsFromSnapshot(value.snapshot,value.paper);assert.ok(restored);assert.deepEqual(restored,value.fact);assert.equal(restored.metadataFingerprint,paperFingerprint({...value.paper,pdfText:undefined}));assert.equal(restored.inputFingerprint,paperFingerprint(value.paper));assert.equal(restored.needsPDF,false);assert.deepEqual(validateSnapshotAgainstFacts(value.snapshot,[restored,value.outsideFact]),[]);assert.equal(fingerprint(value),before);restored.concepts[0].evidence[0].text='Changed local result';assert.notEqual(restored.concepts[0].evidence[0].text,value.fact.concepts[0].evidence[0].text);
});

test('recovery refuses stale metadata, missing or changed PDF inputs even when a supporting quotation still appears',()=>{
 const value=fixture();for(const paper of [{...value.paper,title:'Changed title'},{...value.paper,pdfText:undefined},{...value.paper,pdfText:value.paper.pdfText+' Additional new content.'},{...value.paper,keywords:['another keyword']}])assert.equal(recoverPaperFactsFromSnapshot(value.snapshot,paper),null);assert.ok(recoverPaperFactsFromSnapshot(value.snapshot,{...value.paper,fingerprint:'an untrusted stale cached value'}));
});

test('recovery refuses inconsistent immutable source fields and invalid present-day evidence',()=>{
 const value=fixture(),own=Object.values(value.snapshot.sources).filter(source=>source.paperId===value.paper.id);for(const field of ['provider','model','summary','inputFingerprint','metadataFingerprint'] as const){const snapshot=structuredClone(value.snapshot);snapshot.sources[own[1].factConceptId][field]='inconsistent';assert.equal(recoverPaperFactsFromSnapshot(snapshot,value.paper),null);}
 const changedQuote=structuredClone(value.snapshot);changedQuote.sources[own[0].factConceptId].evidence=[{source:'abstract',text:'This unsupported quotation does not occur.'}];assert.equal(recoverPaperFactsFromSnapshot(changedQuote,value.paper),null);const corrupt=structuredClone(value.snapshot);Object.values(corrupt.entries)[0].sourceIds.push('unknown-source');assert.equal(recoverPaperFactsFromSnapshot(corrupt,value.paper),null);
});

test('zero-concept and out-of-scope papers cannot be reconstructed from another paper’s snapshot evidence',()=>{
 const value=fixture(),empty={...value.fact,paperId:'1:empty',concepts:[]},snapshot=createRegistrySnapshot([empty,value.outsideFact],createEmptyEvidenceCatalog());assert.equal(recoverPaperFactsFromSnapshot(snapshot,{...value.paper,id:empty.paperId}),null);assert.equal(recoverPaperFactsFromSnapshot(snapshot,value.paper),null);assert.equal(recoverPaperFactsFromSnapshot(value.snapshot,{...value.paper,id:'1:foreign'}),null);
});
