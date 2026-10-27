import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicStore } from '../src/store.ts';
import { initialState, validState } from '../src/controller.ts';

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

test('invalid schema uses the backup instead of silently resetting user decisions', async () => {
  const mem = memoryIO();
  mem.files.set('state.json', JSON.stringify({ schemaVersion: 99, count: 100 }));
  mem.files.set('state.json.bak', JSON.stringify({ schemaVersion: 1, count: 5 }));
  const store = new AtomicStore(mem.io, 'state.json', () => ({ schemaVersion: 1, count: 0 }), valid);
  assert.equal((await store.load()).count, 5); assert.equal(store.recovered, true);
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
