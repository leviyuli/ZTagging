import type {PayloadCodec} from './codec.ts';
import type {PayloadToken} from './storage-contract.ts';

/** The scientific FNV fingerprint is retained independently of storage SHA-256 hashes. */
export async function fingerprintGraph(codec:PayloadCodec,root:PayloadToken,options:{signal?:AbortSignal;yieldControl?:()=>Promise<void>}={}):Promise<string>{
  let a=0x811c9dc5,b=0x9e3779b9,deadline=performance.now()+4;
  const append=(text:string)=>{for(let index=0;index<text.length;index++){const code=text.charCodeAt(index);a=Math.imul(a^code,0x01000193);b=Math.imul(b^code,0x85ebca6b);}};
  const check=async()=>{if(options.signal?.aborted)throw options.signal.reason??new Error('Workspace validation cancelled.');if(performance.now()>=deadline){await options.yieldControl?.();deadline=performance.now()+4;}};
  const visit=async(token:PayloadToken,depth:number):Promise<void>=>{
    if(depth>512)throw new Error('Workspace data is nested too deeply.');await check();
    const kind=await codec.kind(token);
    if(kind==='string'){append('"');for await(const chunk of codec.stringChunks(token)){append(JSON.stringify(chunk).slice(1,-1));await check();}append('"');return;}
    if(kind==='scalar'){append(JSON.stringify(await codec.read(token,{maxBytes:128}))??'null');return;}
    let after:number|undefined,first=true;
    append(kind==='array'?'[':'{');
    if(kind==='array')for(;;){const page=await codec.entries(token,{after,limit:50});for(const entry of page.entries){if(!first)append(',');first=false;await visit(entry.token,depth+1);}if(page.next===undefined)break;after=page.next;}
    else{
      // Only keys and references are sorted; values stay in their bounded payload graph.
      const entries:{key:string;token:PayloadToken}[]=[];
      for(;;){const page=await codec.entries(token,{after,limit:50});for(const entry of page.entries)entries.push({key:String(entry.key),token:entry.token});if(page.next===undefined)break;after=page.next;}
      entries.sort((left,right)=>left.key<right.key?-1:left.key>right.key?1:0);
      for(const entry of entries){if(!first)append(',');first=false;append(JSON.stringify(entry.key)+':');await visit(entry.token,depth+1);}
    }
    append(kind==='array'?']':'}');
  };
  await visit(root,0);return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
