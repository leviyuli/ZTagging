import {WorkspaceStore} from './storage.ts';
import {RemoteSqlPort,transferBuffers} from './rpc.ts';
import type {HostCall} from './rpc.ts';
import {buildView} from './views.ts';
import type {ViewQuery} from '../workspace-contract.ts';

/** Reader worker stays independent of paid inference and scientific processing. */
export function createQueryRuntime(call:HostCall){
  let store:WorkspaceStore|undefined,closed=false;
  const controllers=new Map<string,AbortController>();
  return {
    async open(){if(closed)throw new Error('The workspace view worker is closed.');store=await WorkspaceStore.open(new RemoteSqlPort(call),{readOnly:true,cacheBytes:8*1024*1024});},
    async view(query:ViewQuery,{queryId='default'}:{queryId?:string}={}){
      if(!store||closed)throw new Error('The workspace view is not ready.');controllers.get(queryId)?.abort();const controller=new AbortController();controllers.set(queryId,controller);
      try{return await buildView(store,query,{signal:controller.signal});}
      finally{if(controllers.get(queryId)===controller)controllers.delete(queryId);}
    },
    cancel(queryId:string){controllers.get(queryId)?.abort();controllers.delete(queryId);},
    async close(){closed=true;for(const controller of controllers.values())controller.abort();controllers.clear();await store?.close();},
  };
}
type WorkerScope={importScripts?:(...paths:string[])=>void;require?:(path:string)=>{AbstractWorker:new()=>{dispatch:(method:string,args:unknown[])=>Promise<unknown>;postMessage:(...args:unknown[])=>void;close:()=>void;handleMessage:(event:unknown)=>void;callMainThread:(method:string,args:unknown[])=>Promise<unknown>};Meta:new(value:unknown,options:{transfers:ArrayBuffer[]})=>unknown};postMessage:(...args:unknown[])=>void;close:()=>void;onmessage?:(event:unknown)=>void};
const scope=globalThis as unknown as WorkerScope;
if(scope.importScripts){
  scope.importScripts('resource://gre/modules/workers/require.js');const promiseWorker=scope.require!('resource://gre/modules/workers/PromiseWorker.js'),worker=new promiseWorker.AbstractWorker(),runtime=createQueryRuntime(async(method,args)=>{let reply:{ok?:unknown;fail?:{message?:string}};try{reply=await worker.callMainThread('hostCall',[method,args]) as typeof reply;}catch(error){const failure=error&&typeof error==='object'?(Reflect.get(error,'fail')??error):error;throw new TypeError(failure&&typeof failure==='object'?String(Reflect.get(failure,'message')??failure):String(failure));}if(reply&&Object.hasOwn(reply,'ok'))return reply.ok;throw new TypeError(reply?.fail?.message??'The workspace host returned an invalid reply.');});
  worker.dispatch=async(method,args)=>{try{const action=Reflect.get(runtime,method);if(typeof action!=='function')throw new TypeError('Unknown workspace query operation.');const result=await Reflect.apply(action,runtime,args),buffers=transferBuffers(result);return buffers.length?new promiseWorker.Meta(result,{transfers:buffers}):result;}catch(error){throw new TypeError(error instanceof Error?error.message:String(error));}};
  worker.postMessage=(...args)=>scope.postMessage(...args);worker.close=()=>scope.close();scope.onmessage=event=>worker.handleMessage(event);
}
