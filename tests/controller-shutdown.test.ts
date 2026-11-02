import test from 'node:test';
import assert from 'node:assert/strict';
import {AppController,initialState} from '../src/controller.ts';
import type {AppState,ControllerEnvironment} from '../src/controller.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';

function barrier() {
  let release!:()=>void;
  const promise=new Promise<void>(resolve=>{release=resolve;});
  return {promise,release};
}

function fixture(saved?:AppState) {
  const state=saved??initialState(),snapshots:AppState[]=[];
  const env={
    host:{async list(){return [];},async read(){return null;},async readTags(){return [];},async pdfText(){return '';}},
    ai:{cancelSignIn(){}},
    async persist(value:AppState){snapshots.push(structuredClone(value));}
  } as unknown as ControllerEnvironment;
  return {state,env,snapshots,app:new AppController(state,env)};
}

type ControllerInternals={
  worker:Promise<void>|null;
  maintenanceWorker:Promise<void>|null;
  syncReviewItems:()=>void;
  warn:(message:string)=>void;
  shelves:()=>unknown;
  persistDefinitionAdmission:(next:AppState)=>Promise<void>;
  commit:(change:unknown)=>Promise<void>;
  performCommit:(change:unknown)=>Promise<void>;
  processDeferred:()=>Promise<void>;
  invokeAction:(action:string,payload:unknown)=>Promise<unknown>;
};
const internal=(app:AppController)=>app as unknown as ControllerInternals;
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
const tag:TagDefinition={id:'saved-science',name:'proton transport',description:'Transport of protons through a material.',facet:'phenomenon',aliases:[],broaderIds:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',matchingMode:'suggest'};

test('idle shutdown reuses a successful checkpoint without syncing or persisting again',async()=>{
  const h=fixture();await h.app.save();
  internal(h.app).syncReviewItems=()=>{throw new Error('An idle shutdown must not rebuild reviews.');};
  Object.defineProperty(h.state,'history',{get(){throw new Error('An idle shutdown must not traverse saved history.');},configurable:true});
  await h.app.shutdown();assert.equal(h.snapshots.length,1);
});

test('shutdown still persists a controller that has never saved',async()=>{
  const h=fixture();h.state.metadata['unsaved-setting']='retained';
  await h.app.shutdown();assert.equal(h.snapshots.length,1);assert.equal(h.snapshots[0].metadata['unsaved-setting'],'retained');
});

test('shutdown retries a failed checkpoint instead of treating the attempt as saved',async()=>{
  const h=fixture();let attempts=0;
  h.env.persist=async value=>{if(++attempts===1)throw new Error('Checkpoint failed');h.snapshots.push(structuredClone(value));};
  h.state.metadata['important-progress']='retained';
  await assert.rejects(h.app.save(),/Checkpoint failed/);await h.app.shutdown();
  assert.equal(attempts,2);assert.equal(h.snapshots[0].metadata['important-progress'],'retained');
});

test('shutdown awaits an in-flight checkpoint and avoids a duplicate save after success',async()=>{
  const h=fixture(),gate=barrier();let attempts=0,finished=false;
  h.env.persist=async value=>{attempts++;await gate.promise;h.snapshots.push(structuredClone(value));};
  const saving=h.app.save(),stopping=h.app.shutdown().then(()=>{finished=true;});
  await tick();assert.equal(finished,false);assert.equal(attempts,1);
  gate.release();await saving;await stopping;assert.equal(attempts,1);assert.equal(h.snapshots.length,1);
});

test('a late older save success cannot clear a newer failed checkpoint',async()=>{
  const h=fixture(),first=barrier();let attempts=0;
  h.env.persist=async value=>{const attempt=++attempts;if(attempt===1)await first.promise;if(attempt===2)throw new Error('Newer checkpoint failed');h.snapshots.push(structuredClone(value));};
  const older=h.app.save();h.state.metadata['newer-progress']='must survive';
  await assert.rejects(h.app.save(),/Newer checkpoint failed/);first.release();await older;await h.app.shutdown();
  assert.equal(attempts,3);assert.equal(h.snapshots.at(-1)!.metadata['newer-progress'],'must survive');
});

for(const field of ['worker','maintenanceWorker'] as const) {
  test('shutdown retains a final checkpoint for active '+field+' work',async()=>{
    const h=fixture(),gate=barrier();await h.app.save();
    internal(h.app)[field]=(async()=>{await gate.promise;h.state.metadata['completed-work']=field;await h.app.save();})();
    let finished=false;const stopping=h.app.shutdown().then(()=>{finished=true;});await tick();assert.equal(finished,false);
    gate.release();await stopping;assert.equal(h.snapshots.length,3);assert.equal(h.snapshots.at(-1)!.metadata['completed-work'],field);
  });
}

test('shutdown drains an active mutation and keeps a final checkpoint after its own save',async()=>{
  const h=fixture(),entered=barrier(),gate=barrier();await h.app.save();
  h.env.host.list=async()=>{entered.release();await gate.promise;return [];};
  const mutation=h.app.invoke('scan');await entered.promise;
  let finished=false;const stopping=h.app.shutdown().then(()=>{finished=true;});await tick();assert.equal(finished,false);
  gate.release();await mutation;await stopping;assert.equal(h.snapshots.length,3);
});

test('shutdown drains an active commit and keeps a final checkpoint after its own save',async()=>{
  const h=fixture(),entered=barrier(),gate=barrier();await h.app.save();
  internal(h.app).performCommit=async()=>{entered.release();await gate.promise;h.state.metadata['committed-result']='retained';await h.app.save();};
  const commit=internal(h.app).commit({});await entered.promise;
  let finished=false;const stopping=h.app.shutdown().then(()=>{finished=true;});await tick();assert.equal(finished,false);
  gate.release();await commit;await stopping;
  assert.equal(h.snapshots.length,3);assert.equal(h.snapshots.at(-1)!.metadata['committed-result'],'retained');
});

test('a rejected mutation after a saved checkpoint retains its partial local state on shutdown',async()=>{
  const h=fixture();await h.app.save();
  const paper:PaperRecord={id:'1:PARTIAL',itemID:31,libraryID:1,key:'PARTIAL',title:'A locally read paper',abstract:'Retained metadata.',keywords:[],fingerprint:''};
  h.env.host.list=async()=>[structuredClone(paper)];h.env.host.readTags=async()=>{throw new Error('Native tags could not be read');};
  await assert.rejects(h.app.invoke('scan'),/Native tags could not be read/);await h.app.shutdown();
  assert.equal(h.snapshots.length,2);assert.equal(h.snapshots.at(-1)!.papers[paper.id].title,paper.title);
});

test('a warning added after a checkpoint is persisted at shutdown',async()=>{
  const h=fixture();await h.app.save();internal(h.app).warn('A background failure must remain visible.');await h.app.shutdown();
  assert.equal(h.snapshots.length,2);assert.ok(h.snapshots.at(-1)!.warnings.some(value=>value.message==='A background failure must remain visible.'));
});

test('changed shelf normalization after a checkpoint remains dirty until shutdown saves it',async()=>{
  const h=fixture();h.state.tags=[structuredClone(tag)];await h.app.save();
  const before=structuredClone(h.state.tagShelves);internal(h.app).shelves();assert.notDeepEqual(h.state.tagShelves,before);
  await h.app.shutdown();assert.equal(h.snapshots.length,2);assert.deepEqual(h.snapshots.at(-1)!.tagShelves,h.state.tagShelves);
});

test('repeating unchanged shelf normalization does not force another idle save',async()=>{
  const h=fixture();internal(h.app).shelves();await h.app.save();internal(h.app).shelves();await h.app.shutdown();assert.equal(h.snapshots.length,1);
});

test('a successful additive admission establishes the shutdown checkpoint directly',async()=>{
  const h=fixture(),next=structuredClone(h.state);next.tags=[structuredClone(tag)];next.taxonomyReady=true;next.vocabularyVersion=1;
  await internal(h.app).persistDefinitionAdmission(next);assert.deepEqual(h.state.tags,next.tags);await h.app.shutdown();
  assert.equal(h.snapshots.length,1);assert.deepEqual(h.snapshots[0].tags,next.tags);
});

test('shutdown stops listener notifications before active work saves its result',async()=>{
  const h=fixture(),gate=barrier();let updates=0;h.app.subscribe(()=>{updates++;});await h.app.save();assert.equal(updates,1);
  internal(h.app).worker=(async()=>{await gate.promise;h.state.metadata['result']='retained';await h.app.save();})();
  const stopping=h.app.shutdown();gate.release();await stopping;
  assert.equal(h.snapshots.length,3);assert.equal(updates,1);
});

test('idle shutdown retains deferred incoming papers in the existing checkpoint',async()=>{
  const state=initialState();state.deferredItemIDs=[19,27];const h=fixture(state);await h.app.save();await h.app.shutdown();
  assert.equal(h.snapshots.length,1);assert.deepEqual(h.snapshots[0].deferredItemIDs,[19,27]);assert.deepEqual(h.state.deferredItemIDs,[19,27]);
});

test('a deferred paper read failure during shutdown retains every queued incoming paper',async()=>{
  const state=initialState();state.deferredItemIDs=[19,27];state.settings.autoAssign=true;
  const h=fixture(state),entered=barrier(),gate=barrier();await h.app.save();
  h.env.host.read=async()=>{entered.release();await gate.promise;throw new Error('Incoming paper read interrupted');};
  const incoming=internal(h.app).processDeferred(),failed=assert.rejects(incoming,/Incoming paper read interrupted/);await entered.promise;
  let finished=false;const stopping=h.app.shutdown().then(()=>{finished=true;});await tick();assert.equal(finished,false);
  gate.release();await failed;await stopping;
  assert.deepEqual(h.state.deferredItemIDs,[19,27]);assert.deepEqual(h.snapshots.at(-1)!.deferredItemIDs,[19,27]);assert.equal(h.state.run,null);
});

test('shutdown awaits an authentication action outside the mutation queue before its final checkpoint',async()=>{
  const h=fixture(),entered=barrier(),gate=barrier();await h.app.save();
  internal(h.app).invokeAction=async action=>{assert.equal(action,'sign-in');entered.release();await gate.promise;h.state.metadata['auth-callback']='retained';};
  const signingIn=h.app.invoke('sign-in');await entered.promise;
  let finished=false;const stopping=h.app.shutdown().then(()=>{finished=true;});await tick();assert.equal(finished,false);assert.equal(h.snapshots.length,1);
  gate.release();await signingIn;await stopping;
  assert.equal(h.snapshots.length,2);assert.equal(h.snapshots.at(-1)!.metadata['auth-callback'],'retained');
});
