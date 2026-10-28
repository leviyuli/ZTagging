import test from 'node:test';
import assert from 'node:assert/strict';
import {createFingerprinter,fingerprint} from '../src/core.ts';

test('shared fingerprinting preserves historical hashes for Unicode, missing values, arrays and canonical object ordering',()=>{
  const values:unknown[]=[null,undefined,true,17,-0,NaN,'Co CO pH EIS μ Ω 中文 🧪',{b:2,a:1},{name:'Co',nested:{b:undefined,a:null},values:[0,-0,NaN,Infinity,'pH']},[undefined,null,'EIS'],Array(2)];
  // These vectors were generated from the repository's previous released fingerprint implementation.
  const historical=['77074ba4e22143d0','77074ba4e22143d0','4db211e5e8396339','1aeb28b1d48a42e5','350ca8afa4d8e643','77074ba4e22143d0','54bc3bc1fe202efd','5314055ba13c2527','291630ba37c9074e','1808d46cd4427cf8','ba3302ed73d92f81'];
  const shared=values.filter((value):value is object=>value!==null&&typeof value==='object'),hash=createFingerprinter(shared);
  for(const [index,value] of values.entries()){assert.equal(fingerprint(value),historical[index]);assert.equal(hash(value),historical[index]);}
  assert.equal(hash({a:1,b:2}),historical[7]);assert.equal(hash({snapshot:shared[0],again:[shared[0],shared[0]]}),fingerprint({snapshot:shared[0],again:[shared[0],shared[0]]}));
});

test('an immutable shared snapshot is serialized once across many different proof inputs',()=>{
  let evidenceReads=0;const evidence={passages:Array.from({length:100},(_,index)=>({id:index,text:`Verified scientific passage ${index}.`.repeat(10)}))},snapshot={id:'snapshot',get evidence(){evidenceReads++;return evidence;}};
  const inputs=Array.from({length:50},(_,index)=>({snapshot,tagId:`tag-${index}`,meaning:{scope:`scientific topic ${index}`},registryIds:[`registry-${index}`]})),expected=inputs.map(fingerprint);evidenceReads=0;
  const hash=createFingerprinter([snapshot]);assert.equal(evidenceReads,1);
  for(const [index,input] of inputs.entries())assert.equal(hash(input),expected[index]);
  assert.equal(evidenceReads,1,'Sharing canonical snapshot text must avoid traversing its evidence once for every concept');
});

test('ordinary inputs stay fresh and a new factory observes mutations to formerly shared evidence',()=>{
  const snapshot={passages:['Original scientific evidence.']},meaning={scope:'initial scope'},input={snapshot,meaning},hash=createFingerprinter([snapshot]),original=hash(input);
  meaning.scope='revised scope';assert.notEqual(hash(input),original);assert.equal(hash(input),fingerprint(input));
  const beforeEvidenceChange=hash(input);snapshot.passages[0]='Changed source evidence.';const next=createFingerprinter([snapshot]);assert.notEqual(next(input),beforeEvidenceChange);assert.equal(next(input),fingerprint(input));
});

test('cyclic data remains invalid while repeated references and nested sharing remain valid',()=>{
  const cyclic:{self?:unknown}={};cyclic.self=cyclic;assert.throws(()=>fingerprint(cyclic),/cyclic/);assert.throws(()=>createFingerprinter([cyclic]),/cyclic/);
  const child={scientificSymbol:'Co'},parent={child},hash=createFingerprinter([child,parent]);assert.equal(hash([parent,child,parent]),fingerprint([parent,child,parent]));
  const ordinary:{shared:unknown;self?:unknown}={shared:parent};ordinary.self=ordinary;assert.throws(()=>hash(ordinary),/cyclic/);
});
