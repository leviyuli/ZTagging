import {streamJson,JsonStreamError} from './json-stream.ts';
import type {JsonEvent} from './json-stream.ts';
import {LegacyValidationError,NewerWorkspaceStateError} from './migration-contract.ts';
import type {MigrationCodec,MigrationContext,MigrationIO,MigrationOptions,MigrationResult,MigrationTarget,WorkspaceLocator} from './migration-contract.ts';
import type {JsonScalar,PayloadToken,RecordMetadata} from './storage-contract.ts';

const CHUNK=65_536,LOCATOR_LIMIT=16_384,SEVEN_DAYS=7*24*60*60*1000;
const maps=new Set('papers nativeTags decisions ownership analyses neighbors metadata facts taxonomyRedirects taxonomySupport paperInputs paperAttentionDismissals nativeTagTreatments nativeBindingExclusions definitionOrigins'.split(' '));
const arrays=new Set('tags suggestions history cleanup pilotIds verifiedConnections models warnings deferredItemIDs taxonomyArchives preparationHistory nativeDefinitionHistory analysisResetHistory factHistory diyComparisonHistory maintenanceTasks reviewItems tagSelectionHistory legacyConsolidationHistory assignmentRuns uncoveredTopics tagShelves automaticSuppressions userEditedTagIds'.split(' '));
const histories=new Set('history taxonomyArchives preparationHistory nativeDefinitionHistory analysisResetHistory factHistory diyComparisonHistory tagSelectionHistory legacyConsolidationHistory'.split(' '));
const smallFields=new Set('id paperId itemID title name label status taskId runId createdAt date completedAt lastUsedAt'.split(' '));
const encoder=new TextEncoder();

function checkAbort(signal?:AbortSignal):void {if(signal?.aborted)throw signal.reason??new Error('Smart Tags migration cancelled.');}
function locator(value:unknown):WorkspaceLocator|null {
  if(!value||typeof value!=='object')return null;
  const v=value as {schemaVersion?:unknown;storage?:{format?:unknown;generation?:unknown;database?:unknown}};
  if(typeof v.schemaVersion==='number'&&v.schemaVersion>14)throw new NewerWorkspaceStateError(v.schemaVersion);
  if(v.schemaVersion!==14)return null;
  if(v.storage?.format!=='workspace-sqlite-v1'||v.storage.database!=='workspace.sqlite'||typeof v.storage.generation!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(v.storage.generation))throw new Error('The Smart Tags workspace locator is invalid. Preserve it and use recovery.');
  return v as WorkspaceLocator;
}

/** This bounded read is suitable for startup; legacy JSON is read only in the worker. */
export async function readLocator(io:MigrationIO,path:string):Promise<WorkspaceLocator|null> {
  if(!await io.exists(path))return null;
  const stat=await io.stat(path);if(stat.size>LOCATOR_LIMIT)return null;
  const bytes=new Uint8Array(stat.size);let offset=0;
  while(offset<bytes.length){const part=await io.read(path,{offset,maxBytes:bytes.length-offset});if(!part.length)throw new Error('The Smart Tags locator changed while being read.');bytes.set(part,offset);offset+=part.length;}
  let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return null;}
  return locator(value);
}

/** Producer/consumer handoff keeps one decoded string chunk buffered at most. */
class TextQueue implements AsyncIterable<string> {
  private queued?:{value:string;consumed:()=>void;reject:(error:unknown)=>void};
  private waiting?:{resolve:(value:IteratorResult<string>)=>void;reject:(error:unknown)=>void};
  private ended=false;private error:unknown;private failed=false;
  push(value:string):Promise<void> {
    if(this.failed)return Promise.reject(this.error);
    if(this.ended)return Promise.reject(new Error('A JSON string was already completed.'));
    if(this.waiting){const waiting=this.waiting;this.waiting=undefined;waiting.resolve({value,done:false});return Promise.resolve();}
    if(this.queued)return Promise.reject(new Error('JSON string backpressure was not respected.'));
    return new Promise<void>((consumed,reject)=>{this.queued={value,consumed,reject};});
  }
  close():void {this.ended=true;if(this.waiting){this.waiting.resolve({value:undefined,done:true});this.waiting=undefined;}}
  fail(error:unknown):void {this.failed=true;this.error=error;this.queued?.reject(error);this.queued=undefined;this.waiting?.reject(error);this.waiting=undefined;}
  [Symbol.asyncIterator]():AsyncIterator<string> {return {next:()=>{
    if(this.failed)return Promise.reject(this.error);
    if(this.queued){const queued=this.queued;this.queued=undefined;queued.consumed();return Promise.resolve({value:queued.value,done:false});}
    if(this.ended)return Promise.resolve({value:undefined,done:true});
    return new Promise<IteratorResult<string>>((resolve,reject)=>{this.waiting={resolve,reject};});
  }};}
}

type Path=(string|number)[];
type ObjectBuilder=ReturnType<MigrationCodec['objectBuilder']>;
type ArrayBuilder=ReturnType<MigrationCodec['arrayBuilder']>;
type Frame={path:Path;scalars:Record<string,JsonScalar>}&({kind:'object';builder:ObjectBuilder;key?:string}|{kind:'array';builder:ArrayBuilder;index:number});

function recordMetadata(collection:string,scalars:Record<string,JsonScalar>,now:number):RecordMetadata {
  const timestamp=(name:string)=>{const value=scalars[name];const parsed=typeof value==='string'?Date.parse(value):typeof value==='number'?value:NaN;return Number.isFinite(parsed)?parsed:undefined;};
  const title=typeof scalars.title==='string'?scalars.title:typeof scalars.name==='string'?scalars.name:typeof scalars.label==='string'?scalars.label:undefined;
  const status=typeof scalars.status==='string'?scalars.status:undefined;
  const category=collection==='definitionOrigins'?'ledger':histories.has(collection)||collection==='assignmentRuns'&&status==='finished'?'history':collection==='analyses'?'cache':'active';
  return {category,updatedAt:now,...(title?{title,searchText:title.toLocaleLowerCase()}:{}),...(status?{status}:{}),...(typeof scalars.taskId==='string'?{taskId:scalars.taskId}:{}),...(timestamp('completedAt')!==undefined?{completedAt:timestamp('completedAt')}:category==='history'?{completedAt:timestamp('date')??now}:{}),...(category==='cache'?{lastUsedAt:timestamp('lastUsedAt')??now}:{}),...(['running','paused','pending','question'].includes(status??'')?{pinned:true}:{})};
}

async function importGraph(source:AsyncIterable<Uint8Array>,target:MigrationTarget,startedAt:number,options:MigrationOptions):Promise<{root:PayloadToken;fields:Map<string,PayloadToken>;sourceVersion:number}> {
  const frames:Frame[]=[],fields=new Map<string,PayloadToken>(),identities=new Map<string,Set<string>>();let root:PayloadToken|undefined;
  let string:{queue:TextQueue;writing:Promise<PayloadToken>;path:Path;sample:string;capture:boolean}|undefined;
  const nextPath=():Path=>{const frame=frames.at(-1);return frame?[...frame.path,frame.kind==='array'?frame.index:frame.key!]:[];};
  const complete=async(token:PayloadToken,path:Path,scalars:Record<string,JsonScalar>={},scalar?:JsonScalar)=>{
    const parent=frames.at(-1);
    if(parent?.kind==='object'){
      if(parent.key===undefined)throw new LegacyValidationError('A JSON object value has no field name.');
      await parent.builder.append(parent.key,token);
      if(smallFields.has(parent.key)&&scalar!==undefined)parent.scalars[parent.key]=scalar;
      parent.key=undefined;
    }else if(parent){await parent.builder.append(token);parent.index++;}
    else root=token;
    if(path.length===1){const field=String(path[0]);fields.set(field,token);await target.putReference('state',field,token,recordMetadata(field,scalars,startedAt));}
    else if(path.length===2){
      const collection=String(path[0]);
      if(maps.has(collection)||arrays.has(collection)){
        const id=maps.has(collection)?String(path[1]):typeof scalars.id==='string'?scalars.id:`index:${String(path[1]).padStart(12,'0')}`;
        const seen=identities.get(collection)??new Set<string>();if(seen.has(id))throw new LegacyValidationError(`Legacy ${collection} contains a duplicate identity.`);seen.add(id);identities.set(collection,seen);
        await target.putReference(collection,id,token,{...recordMetadata(collection,scalars,startedAt),...(arrays.has(collection)?{order:Number(path[1])}:{})});
      }
    }
  };
  const receive=async(event:JsonEvent)=>{
    switch(event.type){
      case 'object-start':frames.push({kind:'object',path:nextPath(),scalars:Object.create(null),builder:target.codec.objectBuilder()});break;
      case 'array-start':frames.push({kind:'array',path:nextPath(),scalars:Object.create(null),builder:target.codec.arrayBuilder(),index:0});break;
      case 'key':{const frame=frames.at(-1);if(frame?.kind!=='object')throw new LegacyValidationError('A JSON field is outside an object.');frame.key=event.value;break;}
      case 'object-end':case 'array-end':{const frame=frames.pop()!;await complete(await frame.builder.finish(),frame.path,frame.scalars);break;}
      case 'scalar':{const path=nextPath();await complete(await target.codec.value(event.value),path,{},event.value);break;}
      case 'string-start':{
        const queue=new TextQueue(),writing=target.codec.text(queue),parent=frames.at(-1);
        writing.catch(error=>queue.fail(error));
        string={queue,writing,path:nextPath(),sample:'',capture:parent?.kind==='object'&&smallFields.has(parent.key??'')};break;
      }
      case 'string-chunk':if(string){if(string.capture&&string.sample.length<=512)string.sample=(string.sample+event.value).slice(0,513);await string.queue.push(event.value);}break;
      case 'string-end':{const current=string!;string=undefined;current.queue.close();const token=await current.writing;await complete(token,current.path,{},current.capture&&current.sample.length<=512?current.sample:undefined);break;}
    }
  };
  try{await streamJson(source,receive,{signal:options.signal,yieldControl:options.yieldControl});}
  catch(error){string?.queue.fail(error);throw error;}
  const schema=fields.get('schemaVersion');
  const version=schema&&'value' in schema?schema.value:undefined;
  if(typeof version==='number'&&version>13)throw new NewerWorkspaceStateError(version);
  if(!root||typeof version!=='number'||!Number.isInteger(version)||version<1)throw new LegacyValidationError('The legacy Smart Tags schema is invalid.');
  return {root,fields,sourceVersion:version};
}

class FileDigest {
  private pending=new Uint8Array(CHUNK);private used=0;private levels:Uint8Array[][]=[];private bytes=0;private chunks=0;
  private crypto:Crypto;
  constructor(crypto:Crypto){this.crypto=crypto;}
  private async digest(bytes:Uint8Array):Promise<Uint8Array>{return new Uint8Array(await this.crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>));}
  private async add(value:Uint8Array,level=0):Promise<void>{const values=this.levels[level]??=[];values.push(value);if(values.length===512){const bytes=new Uint8Array(1+values.length*32);bytes[0]=1;values.forEach((entry,index)=>bytes.set(entry,1+index*32));values.length=0;await this.add(await this.digest(bytes),level+1);}}
  async append(bytes:Uint8Array):Promise<void>{this.bytes+=bytes.length;for(let offset=0;offset<bytes.length;){const size=Math.min(CHUNK-this.used,bytes.length-offset);this.pending.set(bytes.subarray(offset,offset+size),this.used);this.used+=size;offset+=size;if(this.used===CHUNK){await this.add(await this.digest(this.pending));this.used=0;this.chunks++;}}}
  async finish():Promise<string>{
    if(this.used){await this.add(await this.digest(this.pending.slice(0,this.used)));this.chunks++;this.used=0;}
    for(let level=0;level<this.levels.length-1;level++){const values=this.levels[level];if(!values.length)continue;const bytes=new Uint8Array(1+values.length*32);bytes[0]=1;values.forEach((entry,index)=>bytes.set(entry,1+index*32));values.length=0;await this.add(await this.digest(bytes),level+1);}
    const highest=this.levels.findLast(values=>values.length)??[],header=encoder.encode(`smart-tags-file-v1:${this.bytes}:${this.chunks}:`),bytes=new Uint8Array(header.length+highest.length*32);bytes.set(header);highest.forEach((entry,index)=>bytes.set(entry,header.length+index*32));
    return [...await this.digest(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
}

async function* readChunks(io:MigrationIO,path:string,total:number,options:MigrationOptions,digest?:FileDigest):AsyncGenerator<Uint8Array> {
  let offset=0;
  while(offset<total){checkAbort(options.signal);const bytes=await io.read(path,{offset,maxBytes:Math.min(CHUNK,total-offset)});if(!bytes.length||bytes.length>Math.min(CHUNK,total-offset))throw new Error('The legacy state changed while it was being read.');offset+=bytes.length;await digest?.append(bytes);options.progress?.({phase:'reading',bytes:offset,total});yield bytes;}
  if((await io.stat(path)).size!==total)throw new Error('The legacy state changed while it was being read.');
}

async function sameBytes(io:MigrationIO,left:string,right:string,options:MigrationOptions):Promise<boolean> {
  const size=(await io.stat(left)).size;if((await io.stat(right)).size!==size)return false;
  for(let offset=0;offset<size;){checkAbort(options.signal);const [a,b]=await Promise.all([io.read(left,{offset,maxBytes:Math.min(CHUNK,size-offset)}),io.read(right,{offset,maxBytes:Math.min(CHUNK,size-offset)})]);if(!a.length||a.length!==b.length||a.some((byte,index)=>byte!==b[index]))return false;offset+=a.length;await options.yieldControl?.();}
  return true;
}

async function preserveBackup(io:MigrationIO,statePath:string,source:string,context:MigrationContext,options:MigrationOptions):Promise<string> {
  for(let suffix=0;;suffix++){
    checkAbort(options.signal);const path=`${statePath}.pre-v14${suffix?'.'+suffix:''}.json`;
    if(await io.exists(path)){if(await sameBytes(io,source,path,options)){const digest=new FileDigest(options.crypto??crypto);for await(const _ of readChunks(io,path,context.sourceBytes,{...options,progress:undefined},digest)){}if(await digest.finish()!==context.sourceFingerprint)throw new Error('The legacy state changed before its migration backup was verified.');return path;}continue;}
    try{await io.copyExact(source,path);}
    catch(error){if(await io.exists(path))continue;throw error;}
    const digest=new FileDigest(options.crypto??crypto);for await(const _ of readChunks(io,path,context.sourceBytes,{...options,progress:undefined},digest)){/* Hash exact copied bytes before publication. */}
    if(await digest.finish()!==context.sourceFingerprint)throw new Error('The legacy state changed before its migration backup was verified.');
    return path;
  }
}

/** Import and validate a staging generation before replacing the legacy entry point. */
export async function importIntoStore(io:MigrationIO,statePath:string,target:MigrationTarget,options:MigrationOptions={}):Promise<MigrationResult> {
  if(await readLocator(io,statePath))throw new Error('The Smart Tags workspace is already migrated. Open its registered generation.');
  const clock=options.clock??Date.now,startedAt=clock(),failures:string[]=[];let context:MigrationContext|undefined,recovered=false;
  for(const sourcePath of [statePath,statePath+'.bak']){
    if(!await io.exists(sourcePath))continue;
    checkAbort(options.signal);const generation=options.generation?.()??`workspace-${(options.crypto??crypto).randomUUID()}`;
    const sourceBytes=(await io.stat(sourcePath)).size;
    await target.begin({generation,sourcePath,sourceBytes,startedAt});
    try{
      const digest=new FileDigest(options.crypto??crypto),parsed=await importGraph(readChunks(io,sourcePath,sourceBytes,options,digest),target,startedAt,options);
      context={generation,sourcePath,sourceBytes,sourceFingerprint:await digest.finish(),startedAt,...parsed};
      options.progress?.({phase:'validating',bytes:sourceBytes,total:sourceBytes});
      const validation=await target.validateLegacy(context);if(!validation.valid)throw new LegacyValidationError(validation.reason??'The legacy Smart Tags state is invalid.');
      recovered=sourcePath!==statePath;break;
    }catch(error){await target.abort(generation);context=undefined;if(!(error instanceof JsonStreamError||error instanceof LegacyValidationError))throw error;failures.push(error.message);}
  }
  if(!context)throw new LegacyValidationError('Smart Tags state and backup could not be validated. Preserve the files and restore a valid backup.'+(failures.length?' '+failures.at(-1):''));
  let published=false;
  try{
    checkAbort(options.signal);options.progress?.({phase:'backup',bytes:context.sourceBytes,total:context.sourceBytes});
    const backupPath=await preserveBackup(io,statePath,context.sourcePath,context,options);
    context.backup={path:backupPath,createdAt:clock(),expiresAt:clock()+SEVEN_DAYS,verifiedRestarts:0,fingerprint:context.sourceFingerprint,bytes:context.sourceBytes};
    options.progress?.({phase:'normalizing',bytes:context.sourceBytes,total:context.sourceBytes});
    await target.normalizeLegacy(context);checkAbort(options.signal);await target.validateCurrent(context);
    const sourceDigest=new FileDigest(options.crypto??crypto);for await(const _ of readChunks(io,context.sourcePath,context.sourceBytes,{...options,progress:undefined},sourceDigest)){}
    if(await sourceDigest.finish()!==context.sourceFingerprint)throw new Error('The legacy state changed before migration activation.');
    const result:WorkspaceLocator={schemaVersion:14,storage:{format:'workspace-sqlite-v1',generation:context.generation,database:'workspace.sqlite'}};
    await target.prepare(context,result);checkAbort(options.signal);
    options.progress?.({phase:'activating',bytes:context.sourceBytes,total:context.sourceBytes});
    await io.writeAtomic(statePath,encoder.encode(JSON.stringify(result)+'\n'));published=true;
    // Publication attaches the locator to a prepared generation. An interrupted
    // acknowledgement resumes that generation; it never restores stale JSON.
    await target.activate(context,result);
    return {locator:result,context,recovered};
  }catch(error){if(!published)await target.abort(context.generation);throw error;}
}

/** Bounded file verification shared by migration and expiry of its registered backup. */
export async function fingerprintMigrationFile(io:MigrationIO,path:string,options:MigrationOptions={}):Promise<string>{
  const digest=new FileDigest(options.crypto??crypto),size=(await io.stat(path)).size;
  for await(const _ of readChunks(io,path,size,{...options,progress:undefined},digest)){}
  return digest.finish();
}
