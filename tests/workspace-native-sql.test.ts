import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NativeSqlPort,sqlProjection} from '../src/workspace/native-sql.ts';
import type {NativeSqlConnection} from '../src/workspace/native-sql.ts';
import {RemoteSqlPort,transferBuffers} from '../src/workspace/rpc.ts';
import type {SqlValue} from '../src/workspace/storage-contract.ts';

function nativeConnection(file=':memory:'){
  const db=new DatabaseSync(file),calls:{sql:string;params?:unknown}[]=[],transactions:string[]=[];let closed=false;
  const connection:NativeSqlConnection={
    async executeCached(sql,params){if(/\bLIKE\s*['"]/i.test(sql))throw new Error('Native SQLite requires LIKE patterns as bindings.');calls.push({sql,params});const statement=db.prepare(sql),rows:Record<string,unknown>[]=[];for(const binding of Array.isArray(params)?params:[params])rows.push(...(binding===undefined?statement.all():statement.all(binding as Record<string,never>)));return rows.map(row=>({getResultByName(name){const cell=row[name];return cell instanceof Uint8Array?[...cell]:cell;}}));},
    async executeTransaction(operation){transactions.push('begin');db.exec('BEGIN');try{const value=await operation();db.exec('COMMIT');transactions.push('commit');return value;}catch(error){db.exec('ROLLBACK');transactions.push('rollback');throw error;}},
    async close(){closed=true;db.close();},
  };
  return {connection,calls,transactions,get closed(){return closed;}};
}

test('SQL projections follow the outer SELECT through CTEs, quoted names and comments',()=>{
  assert.deepEqual(sqlProjection("WITH RECURSIVE live(id) AS (SELECT '?' UNION ALL SELECT id+1 FROM live WHERE id<3) SELECT /* FROM wrong */ COUNT(*) AS count, instr('FROM,?', ',') AS [position] FROM live"),{fields:"COUNT(*) AS count, instr('FROM,?', ',') AS [position]",table:'live'});
  assert.deepEqual(sqlProjection('SELECT DISTINCT [name], "odd,column" AS "display" FROM [workspace records]'),{fields:'[name], "odd,column" AS "display"',table:'workspace records'});
  assert.deepEqual(sqlProjection("SELECT '?' AS question -- FROM is a comment\n"),{fields:"'?' AS question"});
  assert.equal(sqlProjection('UPDATE records SET title=?'),undefined);
});

test('native SQLite binds all rows by name without treating literals and comments as parameters',async()=>{
  const fake=nativeConnection(),port=NativeSqlPort.attach(fake.connection);
  await port.query('CREATE TABLE [unusual?] (id INTEGER PRIMARY KEY, title TEXT, data BLOB)');
  await port.batch("INSERT INTO [unusual?](id,title,data) VALUES(?,?,?) /* ? is not a binding */",[[1,"A '?' literal",new Uint8Array([1,2,3])],[2,'B',new Uint8Array([4,5])]]);
  const result=await port.query("SELECT id,title,data,replace('x,? FROM','x','a') AS [answer,?] FROM [unusual?] WHERE id>? -- ignored ?\n ORDER BY id",[0]);
  assert.equal(result.length,2);assert.equal(result[0].title,"A '?' literal");assert.deepEqual(result[1].data,new Uint8Array([4,5]));assert.equal(result[0]['answer,?'],'a,? FROM');
  assert.ok(fake.calls.some(call=>call.sql.includes('VALUES(:v0,:v1,:v2)')&&Array.isArray(call.params)&&call.params[0].v0===1));
  await assert.rejects(port.query("SELECT id FROM [unusual?] WHERE title LIKE 'A%'"),/LIKE patterns as bindings/);assert.equal((await port.query('SELECT id FROM [unusual?] WHERE title LIKE ?',['A%'])).length,1);
  await assert.rejects(port.query('SELECT id FROM [unusual?] WHERE id=?',[]),/binding count/);await assert.rejects(port.query('SELECT ?1 AS id',[1]),/anonymous/);await port.close();
});

test('native transaction gates roll back interrupted chunks and remain usable after failure',async()=>{
  const fake=nativeConnection(),port=NativeSqlPort.attach(fake.connection);await port.query('CREATE TABLE data(id INTEGER PRIMARY KEY)');
  await port.begin();await port.query('INSERT INTO data VALUES(?)',[1]);await assert.rejects(port.begin(),/already in progress/);await port.finish(false);
  assert.deepEqual(await port.query('SELECT id FROM data'),[]);await port.begin();await port.query('INSERT INTO data VALUES(?)',[2]);await port.finish(true);
  assert.deepEqual(await port.query('SELECT id FROM data'),[{id:2}]);await port.begin();await port.query('INSERT INTO data VALUES(?)',[3]);await port.close();assert.deepEqual(fake.transactions,['begin','rollback','begin','commit','begin','rollback']);assert.equal(fake.closed,true);
});

test('native readers reject writes and do not initialize or alter SQLite settings',async()=>{
  const fake=nativeConnection();await fake.connection.executeCached('CREATE TABLE data(id INTEGER)');await fake.connection.executeCached('INSERT INTO data VALUES(1)');
  const globals=globalThis as typeof globalThis&{ChromeUtils?:unknown},before=globals.ChromeUtils;let opened:Record<string,unknown>|undefined;
  globals.ChromeUtils={importESModule:()=>({Sqlite:{openConnection:async(options:Record<string,unknown>)=>{opened=options;return fake.connection;}}})};
  try{
    const start=fake.calls.length,port=await NativeSqlPort.open('isolated.sqlite',{readOnly:true});assert.equal(opened!.readOnly,true);assert.equal(fake.calls.length,start);
    assert.deepEqual(await port.query('WITH chosen AS (SELECT id FROM data) SELECT id FROM chosen'),[{id:1}]);await port.query('PRAGMA user_version');
    for(const sql of ['UPDATE data SET id=2','PRAGMA user_version=14','PRAGMA journal_mode(WAL)','SELECT id FROM data; DELETE FROM data'])await assert.rejects(port.query(sql),/read-only/);
    await assert.rejects(port.batch('INSERT INTO data VALUES(?)',[[2]]),/read-only/);await assert.rejects(port.begin(),/read-only/);await port.close();
  }finally{if(before===undefined)delete globals.ChromeUtils;else globals.ChromeUtils=before;}
});

test('native conversion yields in four-millisecond slices and bounds rows and payload reads',async()=>{
  let now=0,yields=0;const native:NativeSqlConnection={async executeCached(sql){const count=sql.includes('many')?129:sql.includes('large')?1:20;return Array.from({length:count},(_,id)=>({getResultByName(name){now++;return name==='data'?new Array(65537).fill(0):id;}}));},async executeTransaction(operation){return operation();},async close(){}};
  const port=NativeSqlPort.attach(native,{clock:()=>now,yield:async()=>{yields++;}});assert.equal((await port.query('SELECT id FROM normal')).length,20);assert.ok(yields>=5);
  await assert.rejects(port.query('SELECT id FROM many'),/bounded result/);await assert.rejects(port.query('SELECT data FROM large'),/64 KiB/);await port.close();
});

test('RPC frames own transferred copies, limit payload size and roll back failed operations',async()=>{
  const frames:{method:string;args:unknown[]}[]=[],source=new Uint8Array(65536).fill(7),port=new RemoteSqlPort(async(method,args)=>{const received=structuredClone(args,{transfer:transferBuffers(args)});frames.push({method,args:received});return [];});
  await port.batch('INSERT INTO data VALUES(?,?)',[[source,'hash'],...Array.from({length:130},(_,index)=>[index,'x'.repeat(1000)] as SqlValue[])]);
  assert.equal(source.byteLength,65536);assert.equal(source[0],7);assert.equal((frames[0].args[1] as SqlValue[][]).length,1);assert.ok(frames.length>2);
  for(const frame of frames){const rows=frame.args[1] as SqlValue[][];const size=rows.flat().reduce<number>((n,value)=>n+(value instanceof Uint8Array?value.length:typeof value==='string'?value.length*3:8),0);assert.ok(size<=65536+1024);}
  await assert.rejects(port.batch('INSERT INTO data VALUES(?)',[[new Uint8Array(65537+1024)]]),/one chunk/);
  await assert.rejects(port.transaction(async()=>{throw new Error('write failed');}),/write failed/);assert.deepEqual(frames.slice(-2).map(frame=>frame.method),['sql.begin','sql.rollback']);
  const cyclic:{buffer:Uint8Array;again?:unknown}={buffer:source};cyclic.again=cyclic;assert.deepEqual(transferBuffers([cyclic,source.subarray(1)]),[source.buffer]);
});

test('each worker admits one bulk request and releases its credit after failures',async()=>{
  let active=0,maximum=0;const releases:(()=>void)[]=[],port=new RemoteSqlPort(async(_method,args)=>{active++;maximum=Math.max(maximum,active);await new Promise<void>(resolve=>releases.push(resolve));active--;if(args[0]==='fail')throw new Error('dispatch failed');return [];});
  const pending=[port.query('first'),port.query('fail').catch(error=>error.message),port.query('third'),port.query('fourth')];
  await new Promise(resolve=>setImmediate(resolve));assert.equal(active,1);assert.equal(releases.length,1);
  for(let index=0;index<4;index++){releases.shift()!();await new Promise(resolve=>setImmediate(resolve));assert.ok(active<=1);}
  await Promise.all(pending);assert.equal(maximum,1);assert.equal(active,0);
});

test('native writers select four-KiB pages only for an empty database before enabling WAL',async()=>{
  const globals=globalThis as typeof globalThis&{ChromeUtils?:unknown},before=globals.ChromeUtils;
  try{
    for(const occupied of [false,true]){
      const fake=nativeConnection();if(occupied)await fake.connection.executeCached('CREATE TABLE existing(id INTEGER)');
      let options:Record<string,unknown>|undefined;globals.ChromeUtils={importESModule:()=>({Sqlite:{openConnection:async(value:Record<string,unknown>)=>{options=value;return fake.connection;}}})};
      const start=fake.calls.length,port=await NativeSqlPort.open('isolated.sqlite'),statements=fake.calls.slice(start).map(call=>call.sql),page=statements.indexOf('PRAGMA page_size=4096'),wal=statements.indexOf('PRAGMA journal_mode=WAL');
      assert.equal(options!.incrementalVacuum,undefined,'automatic module initialization must not allocate a default 32-KiB page first');assert.equal(page>=0,!occupied);if(!occupied){assert.ok(page<wal);assert.ok(statements.indexOf('PRAGMA auto_vacuum=INCREMENTAL')<wal);}assert.ok(!statements.some(sql=>/^VACUUM\b/.test(sql)));await port.close();
    }
  }finally{if(before===undefined)delete globals.ChromeUtils;else globals.ChromeUtils=before;}
});

test('a fresh native database can reclaim pages incrementally after WAL activation',async()=>{
  const globals=globalThis as typeof globalThis&{ChromeUtils?:unknown},before=globals.ChromeUtils,directory=await mkdtemp(path.join(tmpdir(),'smart-tags-native-sql-'));
  try{
    const fake=nativeConnection(path.join(directory,'workspace.sqlite'));globals.ChromeUtils={importESModule:()=>({Sqlite:{openConnection:async()=>fake.connection}})};
    const port=await NativeSqlPort.open('isolated.sqlite');assert.equal((await port.query('PRAGMA auto_vacuum'))[0].auto_vacuum,2);
    await port.query('CREATE TABLE bodies(id INTEGER PRIMARY KEY,data BLOB)');await port.batch('INSERT INTO bodies(data) VALUES(?)',Array.from({length:40},()=>[new Uint8Array(16*1024)]));await port.query('DELETE FROM bodies');
    const pages=Number((await port.query('PRAGMA page_count'))[0].page_count);await port.query('PRAGMA incremental_vacuum(32)');assert.ok(Number((await port.query('PRAGMA page_count'))[0].page_count)<pages);await port.close();
  }finally{if(before===undefined)delete globals.ChromeUtils;else globals.ChromeUtils=before;await rm(directory,{recursive:true,force:true});}
});
