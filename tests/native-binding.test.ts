import test from 'node:test';
import assert from 'node:assert/strict';
import {applyNativeBindingRecords,nativeBindingAllows,nativeBindingProjection,nativeBindingRecordsMatch,nativePaperBindingAllows,validBindingExclusions,validNativeBindingRecords} from '../src/native-binding.ts';

test('native membership masks only the exact tag, paper and raw label without normalizing scientific case',()=>{
  const masks={fc:{'1:BAD':['FC','Fuel cells']},cobalt:{'1:BAD':['Co']}};
  assert.equal(nativeBindingAllows('fc','1:BAD','FC',masks),false);
  assert.equal(nativeBindingAllows('fc','1:BAD','Fuel cells',masks),false);
  assert.equal(nativeBindingAllows('fc','1:BAD','fuel cells',masks),true);
  assert.equal(nativeBindingAllows('fc','1:OTHER','FC',masks),true);
  assert.equal(nativeBindingAllows('other','1:BAD','FC',masks),true);
  assert.equal(nativeBindingAllows('cobalt','1:BAD','CO',masks),true);
  assert.equal(nativeBindingAllows('fc','1:BAD','FC'),true);
  assert.equal(nativePaperBindingAllows(undefined,'FC',masks.fc),false);
  assert.equal(nativePaperBindingAllows(undefined,'fuel cell',masks.fc),true);
});

test('binding validators accept sparse maps and reject malformed global or journal records',()=>{
  for(const value of [{},{fc:{}},{fc:{'1:BAD':[]}},{fc:{'1:BAD':['FC']}}])assert.equal(validBindingExclusions(value),true);
  for(const value of [null,[],new Date(),{fc:null},{'':{}},{fc:{'':[]}},{fc:{paper:null}},{fc:{paper:['']}},{fc:{paper:[1]}}])assert.equal(validBindingExclusions(value),false);
  assert.equal(validNativeBindingRecords({fc:{'1:BAD':null,'1:OTHER':['FC']}}),true);
  assert.equal(validNativeBindingRecords({fc:{'1:BAD':undefined}}),false);
  assert.equal(validNativeBindingRecords({fc:{'1:BAD':[false]}}),false);
});

test('display projections are detached snapshots and absent masks preserve legacy behavior',()=>{
  const masks={fc:{'1:BAD':['FC']},empty:{'1:BAD':[]}},projection=nativeBindingProjection('fc',masks)!;
  projection['1:BAD'].push('fuel cell');projection['1:OTHER']=['FC'];
  assert.deepEqual(masks.fc,{'1:BAD':['FC']});assert.equal(nativeBindingProjection('missing',masks),undefined);assert.equal(nativeBindingProjection('empty',masks),undefined);
});

test('sparse binding journals compare and update only their own pairs and undo preserves unrelated masks',()=>{
  const current={fc:{'1:A':['FC'],'1:B':['Fuel cells']},other:{'1:A':['Other']}};
  const before={fc:{'1:A':['FC']}},after={fc:{'1:A':null}};
  assert.equal(nativeBindingRecordsMatch(current,before),true);
  assert.equal(nativeBindingRecordsMatch({...current,other:{'1:A':['A later unrelated edit']}},before),true);
  assert.equal(nativeBindingRecordsMatch({...current,fc:{...current.fc,'1:A':['A changed own mask']}},before),false);
  const applied=applyNativeBindingRecords(current,after);assert.deepEqual(applied,{fc:{'1:B':['Fuel cells']},other:{'1:A':['Other']}});assert.equal(nativeBindingRecordsMatch(applied,after),true);
  assert.deepEqual(applyNativeBindingRecords(applied,before),current);assert.deepEqual(current.fc['1:A'],['FC']);
  assert.deepEqual(applyNativeBindingRecords(applied,{fc:{'1:B':null}}),{other:{'1:A':['Other']}});
  assert.equal(nativeBindingRecordsMatch({fc:{'1:A':[]}},{fc:{'1:A':null}}),false,'null means absent rather than an empty stored list');
  const copy=applyNativeBindingRecords(current,undefined);copy.fc['1:A'].push('new');assert.deepEqual(current.fc['1:A'],['FC']);assert.equal(nativeBindingRecordsMatch(undefined,undefined),true);
});

test('JSON object keys are treated as literal identities without inheriting prototype entries',()=>{
  const masks=JSON.parse('{"__proto__":{"constructor":["FC"]}}');
  assert.equal(validBindingExclusions(masks),true);assert.equal(nativeBindingAllows('__proto__','constructor','FC',masks),false);assert.equal(nativeBindingAllows('toString','constructor','FC',masks),true);
  const next=applyNativeBindingRecords(masks,JSON.parse('{"other":{"toString":["Fuel cells"]}}'));
  assert.equal(Object.getPrototypeOf(next),Object.prototype);assert.equal(nativeBindingAllows('other','toString','Fuel cells',next),false);assert.equal(({} as {polluted?:boolean}).polluted,undefined);
});
