import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {WorkspaceStore} from '../src/workspace/storage.ts';
import {memorySql} from './workspace-storage-adapter.ts';

async function worker(entry:string,call:(method:string,args:unknown[])=>Promise<unknown>){
  let installed:{dispatch:(method:string,args:unknown[])=>Promise<unknown>}|undefined;
  class AbstractWorker {
    dispatch!:typeof installed.dispatch;
    constructor(){installed=this;}
    async callMainThread(method:string,args:unknown[]){assert.equal(method,'hostCall');return {ok:await call(String(args[0]),args[1] as unknown[]),id:1};}
    handleMessage(){}
  }
  const source=(await build({entryPoints:[entry],bundle:true,write:false,format:'iife',platform:'browser',target:'firefox140'})).outputFiles[0].text;
  const files=new Map<string,Uint8Array>(),scope={importScripts(path:string){assert.equal(path,'resource://gre/modules/workers/require.js');},require(path:string){assert.equal(path,'resource://gre/modules/workers/PromiseWorker.js');return {AbstractWorker,Meta:class {value:unknown;constructor(value:unknown){this.value=value;}}};},postMessage(){},close(){},crypto,TextEncoder,TextDecoder,AbortController,Uint8Array,ArrayBuffer,URL,fetch,ReadableStream,CompressionStream,DecompressionStream,setTimeout,clearTimeout,performance,IOUtils:{async exists(path:string){return files.has(path);},async write(path:string,bytes:Uint8Array){files.set(path,bytes);},async remove(path:string){files.delete(path);}}};
  vm.runInContext(source,vm.createContext(scope));assert.ok(installed);return {worker:installed!,files};
}

test('reader worker unwraps the verified Gecko callMainThread wire envelope',async()=>{
  const sql=memorySql(),store=await WorkspaceStore.open(sql.port),calls:string[]=[];
  const h=await worker('src/workspace/query-entry.ts',async(method,args)=>{calls.push(method);if(method==='sql.query')return sql.port.query(String(args[0]),args[1] as any);if(method==='sql.close')return;throw new Error('Unexpected host operation');});
  await h.worker.dispatch('open',[]);assert.ok(calls.includes('sql.query'));
  await assert.rejects(h.worker.dispatch('missing',[]),error=>(error as Error).name==='TypeError'&&/Unknown workspace query/.test((error as Error).message));
  await h.worker.dispatch('close',[]);await store.close();
});

test('command worker uses bounded Windows locator paths and transports ordinary failures as TypeError',async()=>{
  const sql=memorySql(),calls:string[]=[];
  const h=await worker('src/workspace/worker-entry.ts',async(method,args)=>{
    calls.push(method);
    if(method==='sql.query')return sql.port.query(String(args[0]),args[1] as any);
    if(method==='sql.batch')return sql.port.batch(String(args[0]),args[1] as any);
    if(method==='sql.begin'){sql.database.exec('BEGIN IMMEDIATE');return;}
    if(method==='sql.commit'){sql.database.exec('COMMIT');return;}
    if(method==='sql.rollback'){sql.database.exec('ROLLBACK');return;}
    if(method==='credentials.load')return null;if(method==='credentials.status')return 'Encrypted';
    if(['changed','phase','sql.close'].includes(method))return;
    throw new Error('Unexpected host operation '+method);
  });
  await h.worker.dispatch('open',[{directory:'D:\\Zotero Test\\smart-tags'}]);
  assert.equal(h.files.has('D:\\Zotero Test\\smart-tags\\state.json'),true);assert.ok(calls.includes('credentials.load'));
  await assert.rejects(h.worker.dispatch('missing',[]),error=>(error as Error).name==='TypeError'&&/Unknown workspace worker/.test((error as Error).message));
  await h.worker.dispatch('close',['disable']);await sql.port.close();
});
