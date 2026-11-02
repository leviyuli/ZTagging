import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {streamJson,JsonStreamError} from '../src/workspace/json-stream.ts';
import type {JsonEvent} from '../src/workspace/json-stream.ts';
import {importIntoStore,readLocator} from '../src/workspace/migration.ts';
import {LegacyValidationError} from '../src/workspace/migration-contract.ts';
import type {MigrationCodec,MigrationContext,MigrationIO,MigrationTarget} from '../src/workspace/migration-contract.ts';
import type {JsonScalar,PayloadToken,RecordMetadata} from '../src/workspace/storage-contract.ts';

const encoder=new TextEncoder(),DATE=1_794_033_600_000;
const fixture=()=>({schemaVersion:13,tags:[{id:'kept-tag',name:'Co',description:'Exact scientific casing.'}],papers:{'1:KEPT':{id:'1:KEPT',itemID:1,title:'论文 🔬',abstract:'An exact retained quotation.',keywords:[]}},metadata:{opaqueCredentialReference:'keep-this-reference'},run:{id:'paid-run',status:'paused',spentUSD:1.25,response:{raw:'Exact paid reply'}},nativeDefinitionPreparation:{work:{id:'meaning-work',history:[{entries:[{id:'entry',humanAnswer:{origin:'choice',choiceId:'kept-choice'},meaningAdmission:{changeId:'kept-admission'}}]}]}}});

class MemoryCodec implements MigrationCodec {
  nodes=new Map<string,unknown>();serial=0;maxStringChunk=0;maxStringBuffered=0;
  private ref(value:unknown):PayloadToken {const id=String(++this.serial);this.nodes.set(id,value);return {ref:id};}
  async value(value:JsonScalar):Promise<PayloadToken>{return {value};}
  async text(chunks:AsyncIterable<string>):Promise<PayloadToken>{let value='';for await(const chunk of chunks){this.maxStringChunk=Math.max(this.maxStringChunk,chunk.length);this.maxStringBuffered=Math.max(this.maxStringBuffered,chunk.length);value+=chunk;}return this.ref(value);}
  arrayBuilder(){const items:PayloadToken[]=[];return {append:async(token:PayloadToken)=>{items.push(token);},finish:async()=>this.ref({array:items})};}
  objectBuilder(){const entries:[string,PayloadToken][]=[];return {append:async(key:string,token:PayloadToken)=>{entries.push([key,token]);},finish:async()=>this.ref({object:entries})};}
  decode(token:PayloadToken):unknown {
    if('value' in token)return token.value;
    const value=this.nodes.get(token.ref) as string|{array?:PayloadToken[];object?:[string,PayloadToken][]};
    if(typeof value==='string')return value;
    if(value.array)return value.array.map(item=>this.decode(item));
    return Object.fromEntries(value.object!.map(([key,item])=>[key,this.decode(item)]));
  }
}

function memoryIO(value:unknown=fixture(),chunkSize=65_536){
  const original=encoder.encode(JSON.stringify(value)),files=new Map<string,Uint8Array>([['state.json',original]]),reads:{path:string;maxBytes:number}[]=[],writes:string[]=[],copies:string[]=[];
  let failWrite=false,failCopy=false;
  const io:MigrationIO={
    async read(path,{offset,maxBytes}){reads.push({path,maxBytes});const bytes=files.get(path);if(!bytes)throw new Error('Missing test file');return bytes.slice(offset,offset+Math.min(maxBytes,chunkSize));},
    async exists(path){return files.has(path);},async stat(path){const bytes=files.get(path);if(!bytes)throw new Error('Missing test file');return {size:bytes.length};},
    async copyExact(source,destination){if(failCopy)throw new Error('Copy failed');assert.equal(files.has(destination),false);copies.push(destination);files.set(destination,files.get(source)!.slice());},
    async writeAtomic(path,bytes){if(failWrite)throw new Error('Atomic locator failed');writes.push(path);files.set(path,bytes.slice());},async remove(path){files.delete(path);},
  };
  return {io,files,reads,writes,copies,original,failWrite:()=>{failWrite=true;},failCopy:()=>{failCopy=true;}};
}
function target(mem:ReturnType<typeof memoryIO>){
  const codec=new MemoryCodec(),records=new Map<string,{token:PayloadToken;metadata:RecordMetadata}>(),events:string[]=[];
  const controls:{normalize?:(context:MigrationContext)=>Promise<void>;validateCurrent?:(context:MigrationContext)=>Promise<void>;activate?:(context:MigrationContext)=>Promise<void>}={};
  const store:MigrationTarget={
    codec,async begin(){events.push('begin');records.clear();},async putReference(collection,id,token,metadata){records.set(collection+'/'+id,{token,metadata});},
    async validateLegacy(context){events.push('validate-legacy');const source=codec.decode(context.root) as Record<string,unknown>;return {valid:typeof source==='object'&&source!==null&&Array.isArray(source.tags)&&typeof source.papers==='object'};},
    async normalizeLegacy(context){events.push('normalize');assert.ok(context.backup);assert.deepEqual(mem.files.get(context.backup!.path),mem.original);await controls.normalize?.(context);},
    async validateCurrent(context){events.push('validate-current');await controls.validateCurrent?.(context);},
    async prepare(){events.push('prepare');assert.equal(mem.writes.length,0);},
    async activate(context){events.push('activate');assert.equal(JSON.parse(new TextDecoder().decode(mem.files.get('state.json'))).schemaVersion,14);await controls.activate?.(context);},
    async abort(){events.push('abort');records.clear();},
  };
  return {store,codec,records,events,controls};
}
const options=()=>({crypto:webcrypto as Crypto,clock:()=>DATE,generation:()=> 'test-generation'});

async function* chunks(text:string,size:number){const bytes=encoder.encode(text);for(let offset=0;offset<bytes.length;offset+=size)yield bytes.subarray(offset,offset+size);}
async function decodeEvents(text:string,size=1){
  const codec=new MemoryCodec(),stack:{kind:'object'|'array';items:unknown[];key?:string}[]=[];let value:unknown,string='';
  const complete=(next:unknown)=>{const frame=stack.at(-1);if(!frame)value=next;else if(frame.kind==='array')frame.items.push(next);else{frame.items.push([frame.key,next]);frame.key=undefined;}};
  const receive=async(event:JsonEvent)=>{
    if(event.type==='object-start'||event.type==='array-start')stack.push({kind:event.type==='object-start'?'object':'array',items:[]});
    else if(event.type==='key')stack.at(-1)!.key=event.value;
    else if(event.type==='object-end'||event.type==='array-end'){const frame=stack.pop()!;complete(frame.kind==='array'?frame.items:Object.fromEntries(frame.items as [string,unknown][]));}
    else if(event.type==='string-start')string='';
    else if(event.type==='string-chunk'){codec.maxStringChunk=Math.max(codec.maxStringChunk,event.value.length);string+=event.value;}
    else if(event.type==='string-end')complete(string);
    else if(event.type==='scalar')complete(event.value);
  };
  await streamJson(chunks(text,size),receive);return {value,maxStringChunk:codec.maxStringChunk};
}

test('streaming JSON matches native values across every byte boundary, escapes and Unicode',async()=>{
  const value={text:'论文 🔬\n\t"\\/\b\f\r',lone:'\ud800',pair:'\ud83d\udd2c',numbers:[0,-1,1.25,2e-8],other:[null,true,false,{},[]],__proto__:null};
  const source=JSON.stringify(value);
  for(const size of [1,2,3,7,16,65_536])assert.deepEqual((await decodeEvents(source,size)).value,JSON.parse(source));
  assert.deepEqual((await decodeEvents('{"unicode":"\\uD83D\\uDD2C","escaped":"\\ud800"}',1)).value,{unicode:'🔬',escaped:'\ud800'});
});

for(const source of ['','{','[1,]','{"a":1,}','{"a" 1}','{"a":}','{"a":1,"a":2}','true false','01','1.','1e','+1','nul','"unescaped\n"','"\\x"','"\\u0X00"','[}','{"a":NaN}'])test('streaming JSON rejects malformed input '+JSON.stringify(source),async()=>{await assert.rejects(decodeEvents(source,1),JsonStreamError);});

test('large strings are delivered as bounded chunks without waiting for their closing quote',async()=>{
  const text='source quotation 🔬'.repeat(25_000),events:JsonEvent[]=[];let consumed=0;
  await streamJson(chunks(JSON.stringify({text}),1024),async event=>{if(event.type==='string-chunk'){consumed+=event.value.length;assert.ok(event.value.length<=8193);assert.equal(/[\uD800-\uDBFF]/.test(event.value.at(-1)!),false);}if(event.type==='string-end')assert.equal(consumed,text.length);if(events.length<5)events.push(event);});
  assert.ok(events.some(event=>event.type==='string-chunk'));
});

test('streaming JSON accepts a UTF-8 BOM and rejects truncated UTF-8',async()=>{
  const source=new Uint8Array([0xef,0xbb,0xbf,...encoder.encode('{"a":1}')]);
  const events:JsonEvent[]=[];await streamJson((async function*(){for(const byte of source)yield Uint8Array.of(byte);})(),async event=>{events.push(event);});assert.ok(events.some(event=>event.type==='scalar'&&event.value===1));
  await assert.rejects(streamJson((async function*(){yield Uint8Array.of(34,0xe2,0x82);})(),async()=>{}),/Invalid UTF-8/);
});

test('migration preserves semantic payloads and indexed identities before publishing its locator',async()=>{
  const mem=memoryIO(fixture(),3),h=target(mem),result=await importIntoStore(mem.io,'state.json',h.store,options());
  assert.equal(result.locator.schemaVersion,14);assert.equal(result.context.sourceVersion,13);assert.equal(result.recovered,false);
  assert.deepEqual(h.codec.decode(result.context.root),fixture());assert.deepEqual(h.codec.decode(h.records.get('papers/1:KEPT')!.token),fixture().papers['1:KEPT']);
  assert.equal(h.records.get('tags/kept-tag')!.metadata.title,'Co');assert.deepEqual(mem.files.get('state.json.pre-v14.json'),mem.original);
  assert.deepEqual(h.events,['begin','validate-legacy','normalize','validate-current','prepare','activate']);
  assert.ok(mem.reads.every(read=>read.maxBytes<=65_536));assert.equal((await readLocator(mem.io,'state.json'))?.storage.generation,'test-generation');
  assert.equal(result.context.backup!.expiresAt,DATE+7*24*60*60*1000);assert.equal(result.context.backup!.verifiedRestarts,0);
});

test('migration reuses identical immutable backups and preserves different earlier generations',async()=>{
  const mem=memoryIO();mem.files.set('state.json.pre-v14.json',encoder.encode('Earlier distinct generation'));mem.files.set('state.json.pre-v14.1.json',mem.original.slice());const h=target(mem);
  const result=await importIntoStore(mem.io,'state.json',h.store,options());assert.equal(result.context.backup!.path,'state.json.pre-v14.1.json');assert.equal(mem.copies.length,0);
  assert.equal(new TextDecoder().decode(mem.files.get('state.json.pre-v14.json')),'Earlier distinct generation');
});

test('an invalid current generation can recover its valid backup before migration',async()=>{
  const mem=memoryIO();mem.files.set('state.json.bak',mem.original.slice());mem.files.set('state.json',encoder.encode('{broken'));const h=target(mem);
  const result=await importIntoStore(mem.io,'state.json',h.store,options());assert.equal(result.recovered,true);assert.equal(result.context.sourcePath,'state.json.bak');assert.equal(h.events.filter(event=>event==='abort').length,1);
});

test('a newer schema refuses migration without replacing it or falling back',async()=>{
  const mem=memoryIO({...fixture(),schemaVersion:15});mem.files.set('state.json.bak',encoder.encode(JSON.stringify(fixture())));const h=target(mem);
  await assert.rejects(importIntoStore(mem.io,'state.json',h.store,options()),/newer schema 15/);assert.equal(mem.writes.length,0);assert.equal(mem.copies.length,0);assert.equal(h.events.filter(event=>event==='begin').length,0);
});

for(const failure of ['backup','normalize','validate-current','locator'] as const)test('failure at '+failure+' preserves the authoritative JSON and never falls back',async()=>{
  const mem=memoryIO();mem.files.set('state.json.bak',mem.original.slice());const h=target(mem);
  if(failure==='backup')mem.failCopy();else if(failure==='normalize')h.controls.normalize=async()=>{throw new Error('Normalization failed');};else if(failure==='validate-current')h.controls.validateCurrent=async()=>{throw new Error('Current validation failed');};else mem.failWrite();
  await assert.rejects(importIntoStore(mem.io,'state.json',h.store,options()));assert.deepEqual(mem.files.get('state.json'),mem.original);assert.equal(h.events.filter(event=>event==='begin').length,1);assert.equal(h.events.includes('activate'),false);
});

test('a source changed after validation cannot be overwritten by migration activation',async()=>{
  const mem=memoryIO(),h=target(mem);h.controls.normalize=async()=>{const changed=mem.original.slice();const offset=new TextDecoder().decode(changed).indexOf('Exact paid reply');changed[offset]=88;mem.files.set('state.json',changed);};
  await assert.rejects(importIntoStore(mem.io,'state.json',h.store,options()),/changed before migration activation/);assert.equal(mem.writes.length,0);assert.notDeepEqual(mem.files.get('state.json'),mem.original);
});

test('a published locator remains attached to its prepared generation after acknowledgement failure',async()=>{
  const mem=memoryIO(),h=target(mem);h.controls.activate=async()=>{throw new Error('Final acknowledgement interrupted');};
  await assert.rejects(importIntoStore(mem.io,'state.json',h.store,options()),/Final acknowledgement/);assert.equal((await readLocator(mem.io,'state.json'))!.schemaVersion,14);assert.ok(mem.files.has('state.json.pre-v14.json'));
});

test('large nested work and raw replies reach the codec in bounded string fragments',async()=>{
  const source=fixture();source.nativeDefinitionPreparation.work.history[0].entries[0].humanAnswer.choiceId='retained-answer';source.run.response.raw='paid raw 🔬 '.repeat(30_000);
  const mem=memoryIO(source,997),h=target(mem),result=await importIntoStore(mem.io,'state.json',h.store,options());
  assert.deepEqual(h.codec.decode(result.context.root),source);assert.ok(h.codec.maxStringChunk<=8193);assert.ok(mem.reads.every(read=>read.maxBytes<=65_536));
});

test('cancellation leaves the old state intact and does not publish a locator',async()=>{
  const mem=memoryIO(),h=target(mem),abort=new AbortController();let reads=0;const read=mem.io.read;mem.io.read=async(...args)=>{const value=await read(...args);if(++reads===2)abort.abort(new Error('Migration cancelled'));return value;};
  await assert.rejects(importIntoStore(mem.io,'state.json',h.store,{...options(),signal:abort.signal}),/Migration cancelled/);assert.equal(mem.writes.length,0);assert.deepEqual(mem.files.get('state.json'),mem.original);
});

test('the startup locator read never loads a large legacy JSON body',async()=>{
  const mem=memoryIO();mem.files.set('state.json',new Uint8Array(100_000));assert.equal(await readLocator(mem.io,'state.json'),null);assert.equal(mem.reads.length,0);
  mem.files.set('state.json',encoder.encode(JSON.stringify({schemaVersion:14,storage:{format:'workspace-sqlite-v1',generation:'../escape',database:'workspace.sqlite'}})));await assert.rejects(readLocator(mem.io,'state.json'),/locator is invalid/);
});

test('two invalid legacy generations remain untouched',async()=>{
  const mem=memoryIO({schemaVersion:13,invalid:true});mem.files.set('state.json.bak',encoder.encode('[]'));const h=target(mem);
  await assert.rejects(importIntoStore(mem.io,'state.json',h.store,options()),LegacyValidationError);assert.equal(mem.writes.length,0);assert.equal(mem.copies.length,0);
});
