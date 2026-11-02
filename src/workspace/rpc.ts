import type {SqlPort,SqlValue} from './storage-contract.ts';

export type HostCall=(method:string,args:unknown[])=>Promise<unknown>;
export class RemoteSqlPort implements SqlPort {
  private call:HostCall;
  private active=0;
  private waiting:(()=>void)[]=[];
  constructor(call:HostCall){this.call=call;}
  private async request<T>(operation:()=>Promise<T>):Promise<T>{
    // One credit in each of the two workers bounds the complete RPC lifetime,
    // including buffers awaiting native dispatch, to two bulk transfers total.
    if(this.active>=1)await new Promise<void>(resolve=>this.waiting.push(resolve));else this.active++;
    try{return await operation();}finally{const next=this.waiting.shift();if(next)next();else this.active--;}
  }
  async query(sql:string,params:SqlValue[]=[]):Promise<Record<string,unknown>[]>{return this.request(async()=>await this.call('sql.query',[sql,params.map(value=>value instanceof Uint8Array?value.slice():value)]) as Record<string,unknown>[]);}
  async batch(sql:string,bindings:SqlValue[][]):Promise<void>{
    let frame:SqlValue[][]=[],size=0;
    const flush=async()=>{if(frame.length)await this.request(()=>this.call('sql.batch',[sql,frame.map(row=>row.map(value=>value instanceof Uint8Array?value.slice():value))]));frame=[];size=0;};
    for(const row of bindings){
      const length=row.reduce<number>((total,value)=>total+(value instanceof Uint8Array?value.byteLength:typeof value==='string'?value.length*3:8),0);
      if(length>64*1024+1024)throw new Error('A workspace SQL binding exceeds one chunk. Store large data as payload chunks.');
      if(frame.length&&(size+length>64*1024||row.some(value=>value instanceof Uint8Array)))await flush();
      // Copy only admitted frames; immutable codec/cache buffers stay in the worker.
      frame.push(row);size+=length;
      if(row.some(value=>value instanceof Uint8Array))await flush();
    }
    await flush();
  }
  async transaction<T>(operation:()=>Promise<T>):Promise<T>{
    await this.call('sql.begin',[]);
    try{const result=await operation();await this.call('sql.commit',[]);return result;}
    catch(error){await this.call('sql.rollback',[]).catch(()=>{});throw error;}
  }
  async close():Promise<void>{await this.call('sql.close',[]);}
}

export function transferBuffers(value:unknown,result:ArrayBuffer[]=[],seen=new WeakSet<object>()):ArrayBuffer[] {
  if(!value||typeof value!=='object'||seen.has(value))return result;seen.add(value);
  if(value instanceof Uint8Array){if(value.buffer instanceof ArrayBuffer&&!result.includes(value.buffer))result.push(value.buffer);}
  else if(value instanceof ArrayBuffer){if(!result.includes(value))result.push(value);}
  else for(const entry of Object.values(value))transferBuffers(entry,result,seen);
  return result;
}
