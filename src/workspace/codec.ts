import {DECODED_CACHE_BYTES,PAYLOAD_CHUNK_BYTES} from './storage-contract.ts';
import type {JsonScalar,JsonValue,PayloadIO,PayloadToken} from './storage-contract.ts';

type Part={ref:string;n:number;b:number};
type Node={k:'s';v:string}|{k:'v';v:JsonScalar}|{k:'a';v:PayloadToken[]}|{k:'o';v:[PayloadToken,PayloadToken][]}|{k:'A'|'O'|'t';p:Part[];n:number};
export interface CodecOptions {crypto?:Crypto;cacheBytes?:number;clock?:()=>number;yield?:()=>Promise<void>}
export interface TokenBuilder {append(token:PayloadToken):Promise<void>;finish():Promise<PayloadToken>}
export interface ObjectTokenBuilder {append(key:string,token:PayloadToken):Promise<void>;finish():Promise<PayloadToken>}
export interface TokenPage {entries:{key:string|number;token:PayloadToken}[];next?:number;total:number}

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const INLINE_BYTES=2048;
const tokenRef=(token:PayloadToken)=>'ref' in token?token.ref:undefined;
const scalar=(value:unknown):value is JsonScalar=>value===null||['string','number','boolean'].includes(typeof value);
const literal=(token:PayloadToken):JsonValue|undefined=>'value' in token?token.value:'inline' in token?token.inline:undefined;
const literalToken=(value:JsonValue):PayloadToken=>scalar(value)?{value}:{inline:value};

export class PayloadCodec {
  private io:PayloadIO;
  private crypto:Crypto;
  private cache=new Map<string,{bytes:Uint8Array;logicalBytes:number;identity:number}>();
  private identities=new Map<number,Set<string>>();
  private cacheLimit:number;
  private cacheSize=0;
  private now:()=>number;
  private yield:()=>Promise<void>;
  private deadline=0;
  constructor(io:PayloadIO,options:CodecOptions={}) {
    this.io=io;this.crypto=options.crypto??globalThis.crypto;this.cacheLimit=options.cacheBytes??DECODED_CACHE_BYTES;
    this.now=options.clock??(()=>globalThis.performance?.now?.()??Date.now());this.yield=options.yield??(()=>new Promise(resolve=>setTimeout(resolve,0)));
  }
  get decodedCacheBytes(){return this.cacheSize;}
  clear(){this.cache.clear();this.identities.clear();this.cacheSize=0;}
  private async checkpoint(){if(this.now()>=this.deadline){await this.yield();this.deadline=this.now()+4;}}
  private async hash(bytes:Uint8Array):Promise<string>{
    const digest=new Uint8Array(await this.crypto.subtle.digest('SHA-256',bytes.slice().buffer));
    return [...digest].map(value=>value.toString(16).padStart(2,'0')).join('');
  }
  private identity(bytes:Uint8Array):number{let hash=0x811c9dc5;for(const byte of bytes)hash=Math.imul(hash^byte,0x01000193);return hash>>>0;}
  private forget(hash:string){const old=this.cache.get(hash);if(!old)return;this.cacheSize-=old.bytes.length;this.cache.delete(hash);const hashes=this.identities.get(old.identity);hashes?.delete(hash);if(!hashes?.size)this.identities.delete(old.identity);}
  private remember(hash:string,bytes:Uint8Array,logicalBytes:number){
    this.forget(hash);
    if(bytes.length>this.cacheLimit)return;
    while(this.cacheSize+bytes.length>this.cacheLimit){const key=this.cache.keys().next().value;if(key===undefined)break;this.forget(key);}
    const identity=this.identity(bytes);this.cache.set(hash,{bytes,logicalBytes,identity});const hashes=this.identities.get(identity)??new Set<string>();hashes.add(hash);this.identities.set(identity,hashes);this.cacheSize+=bytes.length;
  }
  private async transform(bytes:Uint8Array,compress:boolean):Promise<Uint8Array<ArrayBuffer>>{
    const input=new ReadableStream<BufferSource>({start(controller){controller.enqueue(bytes.slice().buffer);controller.close();}});
    const stream=compress?input.pipeThrough(new CompressionStream('gzip')):input.pipeThrough(new DecompressionStream('gzip'));
    const reader=stream.getReader(),parts:Uint8Array[]=[];let length=0;
    try{for(;;){const result=await reader.read();if(result.done)break;length+=result.value.length;if(length>PAYLOAD_CHUNK_BYTES+1024)throw new Error('A workspace payload exceeded its bounded chunk size.');parts.push(result.value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const output=new Uint8Array(length);let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}return output;
  }
  private async node(value:Node,logicalBytes:number):Promise<PayloadToken>{
    await this.checkpoint();
    const bytes=encoder.encode(JSON.stringify(value));if(bytes.length>PAYLOAD_CHUNK_BYTES)throw new Error('A workspace node exceeded its bounded chunk size.');
    for(const hash of this.identities.get(this.identity(bytes))??[]){const cached=this.cache.get(hash)!.bytes;if(cached.length===bytes.length&&bytes.every((byte,index)=>byte===cached[index]))return {ref:hash};}
    const hash=await this.hash(bytes);
    let data:Uint8Array=bytes,codec:'raw'|'gzip'='raw';
    if(bytes.length>=128){const compressed=await this.transform(bytes,true);if(compressed.length<bytes.length){data=compressed;codec='gzip';}}
    const children:string[]=[];
    if(value.k==='a')for(const token of value.v){const ref=tokenRef(token);if(ref)children.push(ref);}
    else if(value.k==='o')for(const pair of value.v)for(const token of pair){const ref=tokenRef(token);if(ref)children.push(ref);}
    else if('p' in value)children.push(...value.p.map(part=>part.ref));
    await this.io.put({hash,codec,data,rawBytes:bytes.length,logicalBytes},[...new Set(children)]);
    this.remember(hash,bytes,logicalBytes);return {ref:hash};
  }
  private async load(hash:string):Promise<Node>{
    await this.checkpoint();
    const cached=this.cache.get(hash);if(cached){this.cache.delete(hash);this.cache.set(hash,cached);return JSON.parse(decoder.decode(cached.bytes)) as Node;}
    const row=await this.io.get(hash);if(!row)throw new Error('A referenced workspace payload is missing. Preserve the database and use recovery.');
    if(row.rawBytes>PAYLOAD_CHUNK_BYTES||row.data.length>PAYLOAD_CHUNK_BYTES)throw new Error('A workspace payload has an invalid chunk size.');
    const bytes=row.codec==='gzip'?await this.transform(row.data,false):row.data;
    if(bytes.length!==row.rawBytes||await this.hash(bytes)!==hash)throw new Error('A workspace payload failed its integrity check.');
    this.remember(hash,bytes,row.logicalBytes);return JSON.parse(decoder.decode(bytes)) as Node;
  }
  async logicalSize(token:PayloadToken):Promise<number>{
    if('value' in token)return encoder.encode(JSON.stringify(token.value)).length;
    if('inline' in token)return encoder.encode(JSON.stringify(token.inline)).length;
    const cached=this.cache.get(token.ref);if(cached)return cached.logicalBytes;
    const row=await this.io.get(token.ref);if(!row)throw new Error('A referenced workspace payload is missing.');return row.logicalBytes;
  }
  async value(value:JsonScalar):Promise<PayloadToken>{
    if(typeof value==='number'&&!Number.isFinite(value))return {value:null};
    if(typeof value!=='string'||value.length<=INLINE_BYTES&&encoder.encode(JSON.stringify(value)).length<=INLINE_BYTES)return {value};
    return this.text((async function*(){yield value;})());
  }
  private async branch(kind:'A'|'O'|'t',parts:Part[],logicalBytes:number):Promise<PayloadToken>{
    if(!parts.length)return this.node(kind==='A'?{k:'a',v:[]}:kind==='O'?{k:'o',v:[]}:{k:'s',v:''},logicalBytes);
    if(parts.length===1)return {ref:parts[0].ref};
    while(parts.length>128){const next:Part[]=[];for(let index=0;index<parts.length;index+=128){const group=parts.slice(index,index+128),n=group.reduce((sum,part)=>sum+part.n,0);const b=2+group.reduce((sum,part)=>sum+part.b-2,0)+(kind==='t'?0:Math.max(0,group.length-1)),ref=await this.node({k:kind,p:group,n},b);next.push({ref:(ref as {ref:string}).ref,n,b});}parts=next;}
    return this.node({k:kind,p:parts,n:parts.reduce((sum,part)=>sum+part.n,0)},logicalBytes);
  }
  private parts(kind:'A'|'O'|'t') {
    const levels:Part[][]=[];
    const add=async(part:Part,level=0):Promise<void>=>{
      const group=levels[level]??=[];group.push(part);if(group.length<128)return;
      levels[level]=[];const n=group.reduce((sum,item)=>sum+item.n,0),b=2+group.reduce((sum,item)=>sum+item.b-2,0)+(kind==='t'?0:group.length-1),token=await this.node({k:kind,p:group,n},b);
      await add({ref:(token as {ref:string}).ref,n,b},level+1);
    };
    return {add,finish:(logicalBytes:number)=>this.branch(kind,[...levels].reverse().flat(),logicalBytes)};
  }
  async text(chunks:AsyncIterable<string>):Promise<PayloadToken>{
    const parts=this.parts('t');let length=0,logicalBytes=2,pending='';
    const append=async(value:string)=>{const size=encoder.encode(JSON.stringify(value)).length,ref=await this.node({k:'s',v:value},size);await parts.add({ref:(ref as {ref:string}).ref,n:value.length,b:size});length+=value.length;logicalBytes+=size-2;};
    for await(const chunk of chunks){
      pending+=chunk;
      while(pending.length>8192){
        const high=pending.charCodeAt(8191),low=pending.charCodeAt(8192),take=high>=0xd800&&high<=0xdbff&&low>=0xdc00&&low<=0xdfff?8191:8192;
        await append(pending.slice(0,take));pending=pending.slice(take);
      }
    }
    if(!length&&pending.length<=INLINE_BYTES&&encoder.encode(JSON.stringify(pending)).length<=INLINE_BYTES)return {value:pending};
    if(pending)await append(pending);
    return parts.finish(logicalBytes);
  }
  arrayBuilder():TokenBuilder {
    const parts=this.parts('A');let values:PayloadToken[]=[],bytes=0,count=0,logical=2,leafLogical=2,finished=false,flushed=false;
    const flush=async()=>{if(!values.length)return;flushed=true;const token=await this.node({k:'a',v:values},leafLogical);await parts.add({ref:(token as {ref:string}).ref,n:values.length,b:leafLogical});values=[];bytes=0;leafLogical=2;};
    return {append:async token=>{if(finished)throw new Error('This array builder is closed.');const size=encoder.encode(JSON.stringify(token)).length;if(bytes+size>24*1024)await flush();const valueBytes=await this.logicalSize(token);logical+=valueBytes+(count?1:0);leafLogical+=valueBytes+(values.length?1:0);values.push(token);bytes+=size+1;count++;},finish:async()=>{if(finished)throw new Error('This array builder is closed.');finished=true;if(!flushed&&logical<=INLINE_BYTES&&values.every(token=>!('ref' in token)))return {inline:values.map(token=>literal(token)!)};await flush();return parts.finish(logical);}};
  }
  objectBuilder():ObjectTokenBuilder {
    const parts=this.parts('O');let values:[PayloadToken,PayloadToken][]=[],bytes=0,count=0,logical=2,leafLogical=2,finished=false,flushed=false;
    const flush=async()=>{if(!values.length)return;flushed=true;const token=await this.node({k:'o',v:values},leafLogical);await parts.add({ref:(token as {ref:string}).ref,n:values.length,b:leafLogical});values=[];bytes=0;leafLogical=2;};
    return {append:async(key,token)=>{if(finished)throw new Error('This object builder is closed.');const pair:[PayloadToken,PayloadToken]=[await this.value(key),token],size=encoder.encode(JSON.stringify(pair)).length;if(bytes+size>24*1024)await flush();const valueBytes=encoder.encode(JSON.stringify(key)).length+1+await this.logicalSize(token);logical+=valueBytes+(count?1:0);leafLogical+=valueBytes+(values.length?1:0);values.push(pair);bytes+=size+1;count++;},finish:async()=>{if(finished)throw new Error('This object builder is closed.');finished=true;if(!flushed&&logical<=INLINE_BYTES&&values.every(([key,value])=>'value' in key&&typeof key.value==='string'&&!('ref' in value))){const result:{[key:string]:JsonValue}={};for(const [key,value] of values)Object.defineProperty(result,String((key as {value:string}).value),{value:literal(value)!,enumerable:true,writable:true,configurable:true});return {inline:result};}await flush();return parts.finish(logical);}};
  }
  /** Standalone records always own a hashed chunk, even when their contents fit inline. */
  async reference(token:PayloadToken):Promise<PayloadToken>{
    if('ref' in token)return token;
    const logicalBytes=await this.logicalSize(token);
    if('value' in token)return this.node(typeof token.value==='string'?{k:'s',v:token.value}:{k:'v',v:token.value},logicalBytes);
    if(Array.isArray(token.inline))return this.node({k:'a',v:token.inline.map(literalToken)},logicalBytes);
    return this.node({k:'o',v:Object.entries(token.inline).map(([key,value])=>[{value:key},literalToken(value)])},logicalBytes);
  }
  async encode(value:unknown):Promise<PayloadToken>{
    const seen=new Set<object>(),shared=new WeakMap<object,PayloadToken>();
    const encode=async(value:unknown,depth:number):Promise<PayloadToken>=>{
      if(depth>512)throw new Error('Workspace data is nested too deeply.');
      if(scalar(value))return this.value(value);
      if(value===undefined)return {value:null};
      if(!value||typeof value!=='object')throw new Error('Workspace data must be JSON serializable.');
      if(seen.has(value))throw new Error('Workspace data cannot contain cycles.');
      const cached=shared.get(value);if(cached)return cached;
      seen.add(value);let token:PayloadToken;
      if(Array.isArray(value)){const builder=this.arrayBuilder();for(const child of value)await builder.append(await encode(child,depth+1));token=await builder.finish();}
      else{const builder=this.objectBuilder();for(const key of Object.keys(value))if((value as Record<string,unknown>)[key]!==undefined)await builder.append(key,await encode((value as Record<string,unknown>)[key],depth+1));token=await builder.finish();}
      seen.delete(value);shared.set(value,token);return token;
    };
    return encode(value,0);
  }
  async kind(token:PayloadToken):Promise<'scalar'|'string'|'array'|'object'>{
    if('value' in token)return typeof token.value==='string'?'string':'scalar';
    if('inline' in token)return Array.isArray(token.inline)?'array':'object';
    const node=await this.load(token.ref);return node.k==='s'||node.k==='t'?'string':node.k==='v'?'scalar':node.k==='a'||node.k==='A'?'array':'object';
  }
  async* stringChunks(token:PayloadToken):AsyncGenerator<string>{
    const fragments=async function*(codec:PayloadCodec,token:PayloadToken):AsyncGenerator<string>{
      if('value' in token){if(typeof token.value!=='string')throw new Error('This workspace value is not a string.');yield token.value;return;}
      if('inline' in token)throw new Error('This workspace value is not a string.');
      const node=await codec.load(token.ref);if(node.k==='s'){yield node.v;return;}if(node.k!=='t')throw new Error('This workspace value is not a string.');
      for(const part of node.p)yield* fragments(codec,{ref:part.ref});
    };
    let carry='';
    for await(const fragment of fragments(this,token)){
      let value=carry+fragment;carry='';
      const last=value.charCodeAt(value.length-1);if(last>=0xd800&&last<=0xdbff){carry=value.slice(-1);value=value.slice(0,-1);}
      if(value)yield value;
    }
    if(carry)yield carry;
  }
  private async count(token:PayloadToken):Promise<number>{if('value' in token)return 0;if('inline' in token)return Array.isArray(token.inline)?token.inline.length:Object.keys(token.inline).length;const node=await this.load(token.ref);return node.k==='a'||node.k==='o'?node.v.length:node.k==='A'||node.k==='O'?node.n:0;}
  private async* children(token:PayloadToken,start=0):AsyncGenerator<{key:string|number;token:PayloadToken}> {
    if('value' in token)return;
    if('inline' in token){if(Array.isArray(token.inline)){for(let index=start;index<token.inline.length;index++)yield {key:index,token:literalToken(token.inline[index])};}else for(const key of Object.keys(token.inline).slice(start))yield {key,token:literalToken(token.inline[key])};return;}
    const node=await this.load(token.ref);
    if(node.k==='a'){for(let index=start;index<node.v.length;index++)yield {key:index,token:node.v[index]};}
    else if(node.k==='o'){for(let index=start;index<node.v.length;index++){const [key,value]=node.v[index];yield {key:String(await this.read(key,{maxBytes:1024*1024})),token:value};}}
    else if(node.k==='A'||node.k==='O'){
      let offset=0;for(const part of node.p){if(offset+part.n>start)for await(const item of this.children({ref:part.ref},Math.max(0,start-offset)))yield {key:node.k==='A'?offset+Number(item.key):item.key,token:item.token};offset+=part.n;}
    }
  }
  async entries(token:PayloadToken,options:{after?:number;limit?:number}={}):Promise<TokenPage>{
    const after=Math.max(0,options.after??0),limit=Math.min(50,Math.max(1,options.limit??50)),entries:TokenPage['entries']=[];
    for await(const entry of this.children(token,after)){entries.push(entry);if(entries.length>=limit)break;}
    const total=await this.count(token);return {entries,total,...(after+entries.length<total?{next:after+entries.length}:{})};
  }
  async lookup(token:PayloadToken,path:readonly(string|number)[]):Promise<PayloadToken|undefined>{
    let current:PayloadToken|undefined=token;
    for(const key of path){let found:PayloadToken|undefined;for await(const entry of this.children(current)){if(entry.key===key){found=entry.token;break;}}if(!found)return;current=found;}
    return current;
  }
  async read(token:PayloadToken,options:{maxBytes?:number;signal?:AbortSignal}={}):Promise<unknown>{
    let bytes=0;const max=options.maxBytes??DECODED_CACHE_BYTES;
    const read=async(token:PayloadToken,depth:number):Promise<unknown>=>{
      if(options.signal?.aborted)throw options.signal.reason??new Error('Workspace read cancelled.');
      if(depth>512)throw new Error('Workspace data is nested too deeply.');
      if('value' in token){bytes+=encoder.encode(JSON.stringify(token.value)).length;if(bytes>max)throw new Error('Read a bounded workspace projection instead of this complete payload.');return token.value;}
      if('inline' in token){const json=JSON.stringify(token.inline);bytes+=encoder.encode(json).length;if(bytes>max)throw new Error('Read a bounded workspace projection instead of this complete payload.');return JSON.parse(json);}
      const node=await this.load(token.ref);bytes+=encoder.encode(JSON.stringify(node)).length;if(bytes>max)throw new Error('Read a bounded workspace projection instead of this complete payload.');
      if(node.k==='s')return node.v;
      if(node.k==='v')return node.v;
      if(node.k==='t'){const values:string[]=[];for(const part of node.p)values.push(String(await read({ref:part.ref},depth+1)));return values.join('');}
      if(node.k==='a'||node.k==='A'){const result:unknown[]=[];for await(const entry of this.children(token))result.push(await read(entry.token,depth+1));return result;}
      const result:Record<string,unknown>={};for await(const entry of this.children(token))Object.defineProperty(result,String(entry.key),{value:await read(entry.token,depth+1),enumerable:true,writable:true,configurable:true});return result;
    };
    return read(token,0);
  }
  flush(){return this.io.flush();}
}
