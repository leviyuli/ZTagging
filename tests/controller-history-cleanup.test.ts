import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState,validState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';

function fixture() {
  const state=initialState(),saved:AppState[]=[];let nativeCalls=0,providerCalls=0;
  state.analysisResetHistory=[{id:'obsolete-reset',date:'2026-11-02T10:00:00.000Z',factsCount:0,analysesCount:0,analyses:{},discardedSuggestions:[],unfinishedReviews:[]}];
  state.metadata['kept-setting']='retained';
  const env={host:{async apply(){nativeCalls++;throw new Error('Cleanup cannot write native tags.');}},ai:{cancelSignIn(){},async completeJson(){providerCalls++;throw new Error('Cleanup cannot request AI.');}},async persist(value:AppState){saved.push(structuredClone(value));}} as unknown as ControllerEnvironment;
  return {state,env,app:new AppController(state,env),saved,calls:()=>({nativeCalls,providerCalls})};
}

test('history inspection is read-only and does not save or call native/provider adapters',async()=>{
  const h=fixture(),before=structuredClone(h.state),summary=await h.app.invoke('inspect-old-processing-history');
  assert.equal(summary.records,1);assert.ok(summary.bytes>0);assert.equal(h.saved.length,0);assert.deepEqual(h.state,before);assert.deepEqual(h.calls(),{nativeCalls:0,providerCalls:0});
});

test('explicit history cleanup persists the reduced generation without resetting usable data',async()=>{
  const h=fixture();const before=structuredClone(h.state);
  const summary=await h.app.invoke('clean-old-processing-history');
  assert.equal(summary.records,1);assert.equal(h.saved.length,1);assert.deepEqual(h.app.state.analysisResetHistory,[]);assert.equal(validState(h.app.state),true);
  for(const key of ['tags','facts','analyses','nativeTags','history','decisions','ownership','settings','metadata','run','taxonomyArchives'] as const)assert.deepEqual(h.app.state[key],before[key]);
  assert.deepEqual(h.calls(),{nativeCalls:0,providerCalls:0});
});

test('a failed cleanup checkpoint restores all removed audit data for retry',async()=>{
  const h=fixture(),before=structuredClone(h.state);h.env.persist=async()=>{throw new Error('Synthetic disk failure');};
  await assert.rejects(h.app.invoke('clean-old-processing-history'),/Synthetic disk failure/);
  assert.deepEqual(h.app.state,before);assert.equal(validState(h.app.state),true);assert.deepEqual(h.calls(),{nativeCalls:0,providerCalls:0});
});

test('cleanup with no obsolete records performs no checkpoint',async()=>{
  const h=fixture();h.state.analysisResetHistory=[];
  assert.deepEqual(await h.app.invoke('clean-old-processing-history'),{records:0,bytes:0});assert.equal(h.saved.length,0);
});

test('cleanup refuses active analysis without pausing it or discarding its records',async()=>{
  const h=fixture();h.state.run={id:'busy',kind:'tag',scope:'selected',automatic:false,status:'running',jobs:[],vocabCursor:0,vocabFinished:false,spentUSD:0,settings:{...h.state.settings},vocabularyVersion:0};
  const before=structuredClone(h.state);await assert.rejects(h.app.invoke('clean-old-processing-history'),/Pause or finish current work/);
  assert.deepEqual(h.app.state,before);assert.equal(h.saved.length,0);
});

test('cleanup preserves a prepared write journal and leaves recovery in charge',async()=>{
  const h=fixture();h.state.pendingChange={id:'pending',date:'2026-11-02T10:00:00.000Z',label:'Interrupted tag write',patches:[],beforeOwnership:{},afterOwnership:{},suggestionIds:[],status:'prepared'};
  const before=structuredClone(h.state);await assert.rejects(h.app.invoke('clean-old-processing-history'),/Pause or finish current work/);
  assert.deepEqual(h.app.state,before);assert.equal(h.saved.length,0);
});
