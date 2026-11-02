import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import {PROCESSING_HISTORY_POLICY_KEY,hasCompactProcessingHistory} from '../src/history-cleanup.ts';

function resetRecord(id='retired') {
  return {id,date:'2026-11-02T10:00:00.000Z',factsCount:0,analysesCount:1,analyses:{old:{metadataFingerprint:'old-input',vocabularyVersion:0,raw:{text:'obsolete reply '.repeat(3000)}}},discardedSuggestions:[],unfinishedReviews:[]};
}
function fixture() {
  const state=initialState(),saved:AppState[]=[];
  const env={ai:{cancelSignIn(){}},async persist(value:AppState){saved.push(structuredClone(value));}} as unknown as ControllerEnvironment;
  return {app:new AppController(state,env),state,env,saved};
}

test('new libraries use compact history while old unmarked libraries retain their audit policy',async()=>{
  const current=fixture();assert.equal(hasCompactProcessingHistory(current.state),true);
  current.state.analysisResetHistory=[resetRecord()];await current.app.save();assert.deepEqual(current.state.analysisResetHistory,[]);
  const old=fixture();delete old.state.metadata[PROCESSING_HISTORY_POLICY_KEY];old.state.analysisResetHistory=[resetRecord()];await old.app.save();
  assert.equal(old.state.analysisResetHistory.length,1);assert.equal(old.saved[0].analysisResetHistory!.length,1);
  old.state.metadata[PROCESSING_HISTORY_POLICY_KEY]='future-unknown-policy';await old.app.save();assert.equal(old.state.analysisResetHistory.length,1);
});

test('explicit cleanup enables compact saves for an existing library without old history',async()=>{
  const h=fixture();delete h.state.metadata[PROCESSING_HISTORY_POLICY_KEY];
  assert.deepEqual(await h.app.invoke('clean-old-processing-history',{expectEmpty:true}),{records:0,bytes:0});
  assert.equal(h.saved.length,1);assert.equal(hasCompactProcessingHistory(h.app.state),true);
  h.app.state.analysisResetHistory=[resetRecord()];await h.app.save();assert.deepEqual(h.app.state.analysisResetHistory,[]);
});

test('an empty-history shortcut never removes records that arrived after inspection',async()=>{
  const h=fixture();delete h.state.metadata[PROCESSING_HISTORY_POLICY_KEY];
  assert.deepEqual(await h.app.invoke('inspect-old-processing-history'),{records:0,bytes:0});h.state.analysisResetHistory=[resetRecord()];
  await assert.rejects(h.app.invoke('clean-old-processing-history',{expectEmpty:true}),/Processing history changed/);
  assert.equal(h.state.analysisResetHistory.length,1);assert.equal(hasCompactProcessingHistory(h.state),false);assert.equal(h.saved.length,0);
});

test('repeated obsolete audit generations cannot make compact saved state grow',async()=>{
  const h=fixture();await h.app.save();const initialBytes=Buffer.byteLength(JSON.stringify(h.saved.at(-1)));
  for(let index=0;index<40;index++){
    h.app.state.analysisResetHistory=[resetRecord('retired-'+index)];await h.app.save();
    assert.deepEqual(h.saved.at(-1)!.analysisResetHistory,[]);assert.equal(validState(h.saved.at(-1)),true);
    assert.ok(Buffer.byteLength(JSON.stringify(h.saved.at(-1)))<=initialBytes+100,'retired raw replies must not accumulate in the active file');
  }
});

test('a failed cleanup does not enable compact retention or lose the original history',async()=>{
  const h=fixture();delete h.state.metadata[PROCESSING_HISTORY_POLICY_KEY];h.state.analysisResetHistory=[resetRecord()];const before=structuredClone(h.state);
  h.env.persist=async()=>{throw new Error('Checkpoint interrupted');};await assert.rejects(h.app.invoke('clean-old-processing-history'),/Checkpoint interrupted/);
  assert.deepEqual(h.app.state,before);assert.equal(hasCompactProcessingHistory(h.app.state),false);
});
