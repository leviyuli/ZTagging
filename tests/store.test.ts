import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicStore } from '../src/store.ts';
import { initialState, migrateState, validState, validLegacyState } from '../src/controller.ts';

interface State { schemaVersion: number; count: number }
const valid = (v: unknown): v is State => !!v && typeof v === 'object' && (v as State).schemaVersion === 1 && Number.isInteger((v as State).count);

function memoryIO() {
  const files = new Map<string, string>();
  let failure: string | undefined;
  const writes: string[] = [];
  return {
    files, writes,
    fail: (path: string | undefined) => { failure = path; },
    io: {
      exists: async (path: string) => files.has(path),
      read: async (path: string) => { const value = files.get(path); if (value === undefined) throw new Error('Missing file'); return value; },
      writeAtomic: async (path: string, data: string) => {
        writes.push(path);
        if (failure === path) throw new Error('Disk write failure');
        await Promise.resolve();
        files.set(path, data);
      },
    },
  };
}

test('transient Windows replacement locks retry the same serialized generation without losing its backup',async()=>{
  const mem=memoryIO();mem.files.set('state.json',JSON.stringify({schemaVersion:1,count:1}));
  const nativeWrite=mem.io.writeAtomic;let failures=2;
  mem.io.writeAtomic=async(path,data)=>{if(path==='state.json'&&failures-->0)throw new Error('NS_ERROR_FILE_ACCESS_DENIED');await nativeWrite(path,data);};
  const store=new AtomicStore(mem.io,'state.json',()=>({schemaVersion:1,count:0}),valid);
  await Promise.all([store.save({schemaVersion:1,count:2}),store.save({schemaVersion:1,count:3})]);
  assert.equal(failures,-2);assert.equal(JSON.parse(mem.files.get('state.json')!).count,3);assert.equal(JSON.parse(mem.files.get('state.json.bak')!).count,2);
});

test('store initializes only when no state generation exists', async () => {
  const mem = memoryIO();
  const store = new AtomicStore(mem.io, 'state.json', () => ({ schemaVersion: 1, count: 0 }), valid);
  assert.deepEqual(await store.load(), { schemaVersion: 1, count: 0 });
  assert.equal(mem.writes.length, 0);
});

test('store recovers a valid backup when current JSON is corrupt and retains that valid backup', async () => {
  const mem = memoryIO();
  mem.files.set('state.json', '{truncated');
  mem.files.set('state.json.bak', JSON.stringify({ schemaVersion: 1, count: 4 }));
  const store = new AtomicStore(mem.io, 'state.json', () => ({ schemaVersion: 1, count: 0 }), valid);
  const state = await store.load();
  assert.equal(store.recovered, true); assert.equal(state.count, 4);
  await store.save({ schemaVersion: 1, count: 5 });
  assert.equal(JSON.parse(mem.files.get('state.json')!).count, 5);
  assert.equal(JSON.parse(mem.files.get('state.json.bak')!).count, 4);
});

test('an invalid current shape uses the backup instead of silently resetting user decisions', async () => {
  const mem = memoryIO();
  mem.files.set('state.json', JSON.stringify({ schemaVersion: 1, count: 'invalid' }));
  mem.files.set('state.json.bak', JSON.stringify({ schemaVersion: 1, count: 5 }));
  const store = new AtomicStore(mem.io, 'state.json', () => ({ schemaVersion: 1, count: 0 }), valid);
  assert.equal((await store.load()).count, 5); assert.equal(store.recovered, true);
});

test('a newer schema never falls back to an older backup or permits downgrade writes',async()=>{
  const mem=memoryIO(),original=JSON.stringify({schemaVersion:4,count:51});mem.files.set('state.json',original);mem.files.set('state.json.bak',JSON.stringify({schemaVersion:3,count:4}));
  const store=new AtomicStore(mem.io,'state.json',initialV3,validV3,migrateV3,validLegacy);
  await assert.rejects(store.load(),/newer schema 4/);assert.equal(store.recovered,false);assert.equal(mem.writes.length,0);
  await assert.rejects(store.save({schemaVersion:3,count:5}),/Refusing to replace newer/);assert.equal(mem.files.get('state.json'),original);assert.equal(mem.writes.length,0);
  await assert.rejects(store.save({schemaVersion:2,count:5}),/different Smart Tags schema/);assert.equal(mem.files.get('state.json'),original);
});

test('schema-validator exceptions in corrupt current state still permit restoring the valid backup',async()=>{
  const mem=memoryIO();mem.files.set('state.json',JSON.stringify({schemaVersion:1,count:51,broken:true}));mem.files.set('state.json.bak',JSON.stringify({schemaVersion:1,count:4}));
  const validator=(value:unknown):value is State=>{if((value as {broken?:boolean})?.broken)throw new Error('Corrupt nested state');return valid(value);};
  const store=new AtomicStore(mem.io,'state.json',()=>({schemaVersion:1,count:0}),validator);assert.equal((await store.load()).count,4);
  await store.save({schemaVersion:1,count:5});assert.equal(JSON.parse(mem.files.get('state.json')!).count,5);assert.equal(JSON.parse(mem.files.get('state.json.bak')!).count,4);
});

test('unrecoverable state fails closed without rewriting either generation', async () => {
  const mem = memoryIO();
  mem.files.set('state.json', 'broken-current'); mem.files.set('state.json.bak', 'broken-backup');
  const store = new AtomicStore(mem.io, 'state.json', () => ({ schemaVersion: 1, count: 0 }), valid);
  await assert.rejects(() => store.load(), /backup could not be read/);
  assert.equal(mem.writes.length, 0);
});

test('queued saves capture their own snapshots and serialize current/previous generations', async () => {
  const mem = memoryIO();
  const store = new AtomicStore(mem.io, 'state.json', () => ({ schemaVersion: 1, count: 0 }), valid);
  const value = { schemaVersion: 1, count: 1 };
  const first = store.save(value);
  value.count = 2;
  const second = store.save(value);
  value.count = 3;
  await Promise.all([first, second]); await store.flush();
  assert.equal(JSON.parse(mem.files.get('state.json')!).count, 2);
  assert.equal(JSON.parse(mem.files.get('state.json.bak')!).count, 1);
  assert.deepEqual(mem.writes, ['state.json', 'state.json.bak', 'state.json']);
});

test('a failed current write preserves the old state and subsequent saves can recover', async () => {
  const mem = memoryIO();
  mem.files.set('state.json', JSON.stringify({ schemaVersion: 1, count: 7 }));
  const store = new AtomicStore(mem.io, 'state.json', () => ({ schemaVersion: 1, count: 0 }), valid);
  mem.fail('state.json');
  await assert.rejects(() => store.save({ schemaVersion: 1, count: 8 }), /Disk write failure/);
  assert.equal(JSON.parse(mem.files.get('state.json')!).count, 7);
  assert.equal(JSON.parse(mem.files.get('state.json.bak')!).count, 7);
  mem.fail(undefined);
  await store.save({ schemaVersion: 1, count: 9 });
  assert.equal(JSON.parse(mem.files.get('state.json')!).count, 9);
});

test('application state rejects missing manager fields and malformed recovery journals', () => {
  const good = initialState(); assert.equal(validState(good), true);
  for (const key of ['nativeTags', 'neighbors', 'cleanup', 'pilotIds', 'models', 'verifiedConnections']) {
    const broken = structuredClone(good) as any; delete broken[key];
    assert.equal(validState(broken), false, `${key} must exist`);
  }
  assert.equal(validState({ ...good, pendingChange: {} }), false, 'malformed journal must not reach recovery');
  assert.equal(validState({ ...good, history: [{}] }), false, 'malformed history must not reach snapshot or undo');
});

function legacyState() {
  const old=structuredClone(initialState()) as any;old.schemaVersion=1;old.vocabularyVersion=9;
  for(const key of ['facts','taxonomyProposal','taxonomyArchives','taxonomyRedirects','taxonomyReady','taxonomySupport'])delete old[key];
  delete old.settings.coreConceptLimit;
  old.tags.push(...Array.from({length:107},(_,i)=>({id:`draft-${i}`,name:`Legacy concept ${i}`,description:'Legacy scientific concept.',facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'draft',broaderIds:[]})));
  for(const tag of old.tags){delete tag.fullName;delete tag.relatedIds;delete tag.matchingMode;}
  old.decisions['1:PAPER|custom-rcl']={rejected:true,locked:true};
  old.ownership['1:PAPER']={'custom-rcl':{name:'RCL',changeId:'historic-change'}};
  old.nativeTags['1:PAPER']=[{tag:'RCL',type:0},{tag:'Manual important',type:0}];
  return old;
}

test('schema-one migration preserves 107 drafts, manual decisions, ownership, and native snapshots',()=>{
  const old=legacyState(),before=JSON.stringify(old),migrated=migrateState(old);
  assert.equal(migrated.schemaVersion,8);assert.equal(validState(migrated),true);assert.equal(migrated.tags.filter(t=>!t.custom).length,107);
  assert.equal(migrated.taxonomyReady,false);assert.equal(migrated.taxonomyProposal,null);assert.deepEqual(migrated.facts,{});
  assert.equal(migrated.settings.coreConceptLimit,60);assert.equal(migrated.tags[0].matchingMode,'suggest');
  assert.deepEqual(migrated.decisions,old.decisions);assert.deepEqual(migrated.ownership,old.ownership);assert.deepEqual(migrated.nativeTags,old.nativeTags);
  assert.equal(JSON.stringify(old),before,'Migration must not mutate the original parsed state');
});

test('the store writes an exact version-aware backup before migrating or persisting upgraded state',async()=>{
  const mem=memoryIO(),original=JSON.stringify({schemaVersion:2,count:51},null,2)+'\n';mem.files.set('state.json',original);
  const migrate=(value:unknown)=>{assert.equal(mem.files.get('state.json.pre-v3.json'),original,'backup precedes migration itself');return migrateV3(value);};
  const store=new AtomicStore(mem.io,'state.json',initialV3,validV3,migrate,validLegacy);
  const upgraded=await store.load();assert.equal(upgraded.schemaVersion,3);assert.equal(upgraded.count,51);assert.equal(store.migrated,true);
  assert.equal(mem.files.get('state.json.pre-v3.json'),original);
  assert.deepEqual(mem.writes.slice(0,2),['state.json.pre-v3.json','state.json']);
  assert.equal(JSON.parse(mem.files.get('state.json')!).schemaVersion,3);
});

test('application migration uses the current-schema backup and structural legacy validator',async()=>{
  const mem=memoryIO(),original=JSON.stringify(legacyState(),null,2)+'\n';mem.files.set('state.json',original);
  const store=new AtomicStore(mem.io,'state.json',initialState,validState,migrateState,validLegacyState);
  assert.equal((await store.load()).schemaVersion,8);assert.equal(mem.files.get('state.json.pre-v8.json'),original);
});

test('a later migration retains an earlier source backup and preserves different source bytes separately',async()=>{
  const mem=memoryIO(),original=JSON.stringify({schemaVersion:2,count:51});mem.files.set('state.json',original);mem.files.set('state.json.pre-v3.json','previous original bytes');
  const store=new AtomicStore(mem.io,'state.json',initialV3,validV3,migrateV3,validLegacy);await store.load();
  assert.equal(mem.files.get('state.json.pre-v3.json'),'previous original bytes');assert.equal(mem.files.get('state.json.pre-v3.1.json'),original);
  assert.deepEqual(mem.writes,['state.json.pre-v3.1.json','state.json']);
});

test('a failed migration backup prevents replacing current state even when a valid older .bak exists',async()=>{
  const mem=memoryIO(),original=JSON.stringify({schemaVersion:2,count:51});mem.files.set('state.json',original);mem.fail('state.json.pre-v3.json');
  mem.files.set('state.json.bak',JSON.stringify({schemaVersion:3,count:4}));
  const store=new AtomicStore(mem.io,'state.json',initialV3,validV3,migrateV3,validLegacy);
  await assert.rejects(store.load(),/Disk write failure/);assert.equal(mem.files.get('state.json'),original);
  assert.equal(store.recovered,false);assert.equal(JSON.parse(mem.files.get('state.json.bak')!).count,4);
});

const initialV3=():State=>({schemaVersion:3,count:0});
const validV3=(value:unknown):value is State=>!!value&&typeof value==='object'&&(value as State).schemaVersion===3&&Number.isInteger((value as State).count);
const validLegacy=(value:unknown)=>!!value&&typeof value==='object'&&[1,2].includes((value as State).schemaVersion)&&Number.isInteger((value as State).count);
const migrateV3=(value:unknown):State=>({...value as State,schemaVersion:3});

test('pre-v2 backup naming remains supported for a schema-two target',async()=>{
  const mem=memoryIO(),original=JSON.stringify({schemaVersion:1,count:9});mem.files.set('state.json',original);
  const validV2=(value:unknown):value is State=>!!value&&typeof value==='object'&&(value as State).schemaVersion===2&&Number.isInteger((value as State).count);
  await new AtomicStore(mem.io,'state.json',()=>({schemaVersion:2,count:0}),validV2,value=>({...value as State,schemaVersion:2})).load();
  assert.equal(mem.files.get('state.json.pre-v2.json'),original);
});

test('migration implementation failures never fall back to an older valid generation',async()=>{
  const mem=memoryIO(),original=JSON.stringify({schemaVersion:2,count:51});mem.files.set('state.json',original);
  mem.files.set('state.json.bak',JSON.stringify({schemaVersion:3,count:4}));
  const store=new AtomicStore(mem.io,'state.json',initialV3,validV3,()=>{throw new Error('Migration interrupted');},validLegacy);
  await assert.rejects(store.load(),/Migration interrupted/);
  assert.equal(mem.files.get('state.json'),original);assert.equal(mem.files.get('state.json.pre-v3.json'),original);assert.equal(store.recovered,false);
});

test('an invalid migration result fails closed rather than recovering an older valid .bak',async()=>{
  const mem=memoryIO(),original=JSON.stringify({schemaVersion:2,count:51});mem.files.set('state.json',original);
  mem.files.set('state.json.bak',JSON.stringify({schemaVersion:3,count:4}));
  const store=new AtomicStore(mem.io,'state.json',initialV3,validV3,()=>({schemaVersion:3,count:NaN}),validLegacy);
  await assert.rejects(store.load(),/Migration produced unsupported or invalid/);assert.equal(mem.files.get('state.json'),original);assert.equal(store.recovered,false);
});

test('an upgraded-state write failure retains the current generation and never substitutes .bak',async()=>{
  const mem=memoryIO(),original=JSON.stringify({schemaVersion:2,count:51});mem.files.set('state.json',original);mem.fail('state.json');
  mem.files.set('state.json.bak',JSON.stringify({schemaVersion:3,count:4}));
  const store=new AtomicStore(mem.io,'state.json',initialV3,validV3,migrateV3,validLegacy);
  await assert.rejects(store.load(),/Disk write failure/);assert.equal(mem.files.get('state.json'),original);assert.equal(store.recovered,false);
});

test('restarting an interrupted migration reuses the exact original backup without new copies',async()=>{
  const mem=memoryIO(),original=JSON.stringify({schemaVersion:2,count:51});mem.files.set('state.json',original);mem.fail('state.json');
  await assert.rejects(new AtomicStore(mem.io,'state.json',initialV3,validV3,migrateV3,validLegacy).load(),/Disk write failure/);
  mem.fail(undefined);
  const restarted=new AtomicStore(mem.io,'state.json',initialV3,validV3,migrateV3,validLegacy);assert.equal((await restarted.load()).count,51);
  assert.equal(mem.writes.filter(path=>path==='state.json.pre-v3.json').length,1);
  assert.equal(mem.files.has('state.json.pre-v3.1.json'),false);
  const stable=new AtomicStore(mem.io,'state.json',initialV3,validV3,migrateV3,validLegacy);await stable.load();assert.equal(stable.migrated,false);
});

test('only structurally valid legacy input reaches migration while invalid source can recover .bak',async()=>{
  const mem=memoryIO();mem.files.set('state.json',JSON.stringify({schemaVersion:2,count:'corrupt'}));mem.files.set('state.json.bak',JSON.stringify({schemaVersion:3,count:8}));
  let legacyMigrations=0;
  const store=new AtomicStore(mem.io,'state.json',initialV3,validV3,value=>{if((value as State).schemaVersion!==3)legacyMigrations++;return migrateV3(value);},validLegacy);
  assert.equal((await store.load()).count,8);assert.equal(store.recovered,true);assert.equal(legacyMigrations,0);assert.equal(mem.writes.length,0);
});

test('native exact copies preserve source bytes and compare backup encoding rather than decoded text',async()=>{
  const mem=memoryIO(),original=JSON.stringify({schemaVersion:2,count:51});mem.files.set('state.json',original);mem.files.set('state.json.pre-v3.json',original);
  const bytes=new Map<string,Uint8Array>([['state.json',new Uint8Array([255,254,123,0,125,0])],['state.json.pre-v3.json',new Uint8Array([123,125])]]);
  const copies:string[]=[];
  const io={...mem.io,readBytes:async(path:string)=>bytes.get(path)!,copyExact:async(source:string,destination:string)=>{
    assert.equal(mem.files.has(destination),false,'immutable backup copy must not overwrite an existing destination');
    copies.push(destination);mem.files.set(destination,mem.files.get(source)!);bytes.set(destination,bytes.get(source)!.slice());
  }};
  await new AtomicStore(io,'state.json',initialV3,validV3,migrateV3,validLegacy).load();
  assert.deepEqual(copies,['state.json.pre-v3.1.json']);assert.deepEqual(bytes.get('state.json.pre-v3.1.json'),new Uint8Array([255,254,123,0,125,0]));
  assert.deepEqual(bytes.get('state.json.pre-v3.json'),new Uint8Array([123,125]));
});

test('a failed normal previous-generation backup also stops a save without replacing current state',async()=>{
  const mem=memoryIO(),original=JSON.stringify({schemaVersion:1,count:51});mem.files.set('state.json',original);mem.fail('state.json.bak');
  const store=new AtomicStore(mem.io,'state.json',()=>({schemaVersion:1,count:0}),valid);
  await assert.rejects(store.save({schemaVersion:1,count:52}),/Disk write failure/);assert.equal(mem.files.get('state.json'),original);
});

test('migration of an interrupted legacy rebuild pauses it for the new global proposal pipeline',()=>{
  for(const status of ['running','paused']){
    const old=legacyState();old.run={id:'run',kind:'rebuild',scope:'pilot',automatic:false,status,jobs:[{id:'job',paperId:'p',status:'completed'}],vocabCursor:25,vocabFinished:false,message:'Building old batches',spentUSD:0.5,settings:structuredClone(old.settings),vocabularyVersion:9};
    const next=migrateState(old);assert.equal(next.run?.status,'paused');assert.equal(next.run?.vocabCursor,0);assert.equal(next.run?.jobs[0].status,'pending');
    assert.equal(next.run?.settings.coreConceptLimit,60);assert.equal(next.run?.spentUSD,0.5);
  }
});
