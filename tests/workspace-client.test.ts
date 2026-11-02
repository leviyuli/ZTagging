import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';

const bundle=build({entryPoints:['src/workspace.ts'],bundle:true,write:false,format:'iife',globalName:'Client',platform:'browser',plugins:[{name:'native-client-adapters',setup(plugin){
  plugin.onLoad({filter:/[/\\]native-sql\.ts$/},()=>({loader:'ts',contents:'export const NativeSqlPort={open:async(...args)=>(globalThis as any).adapters.sql(...args)};'}));
  plugin.onLoad({filter:/[/\\]native-host\.ts$/},()=>({loader:'ts',contents:'export class WorkspaceHost{host={mutating:new Set()};stop(){(globalThis as any).adapters.stops++;}}'}));
  plugin.onLoad({filter:/[/\\]platform\.ts$/},()=>({loader:'ts',contents:'export class SecureCredentials{clearMemory(){(globalThis as any).adapters.cleared++;}};export const registerOAuthCallback=()=>{throw new Error("Unexpected OAuth");};export const chooseJSONFile=()=>{throw new Error("Unexpected chooser");};'}));
}}]}).then(result=>result.outputFiles[0].text);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

async function harness(services?:unknown){
  const workers:any[]=[],ports:any[]=[],adapters={stops:0,cleared:0,async sql(path:string,options:unknown){const port={path,options,closed:false,async close(){this.closed=true;}};ports.push(port);return port;}};
  class Worker{
    static Meta=class{value:unknown;constructor(value:unknown){this.value=value;}};
    calls:{method:string;args:unknown[]}[]=[];terminated=false;
    open=deferred<unknown>();pending:(()=>void)[]=[];views:unknown[]=[];
    path:string;constructor(path:string){this.path=path;workers.push(this);}
    async post(method:string,args:unknown[]){this.calls.push({method,args});if(method==='open')return this.open.promise;if(method==='close'){this.open.reject(new Error('Opening was cancelled.'));return;}if(method==='view'){if(this.views.length)return this.views.shift();return {phase:'ready',revision:1,model:{page:args[0]}};}if(method==='execute')return {commandId:(args[1] as any).commandId,revision:1};}
    terminate(){this.terminated=true;}
  }
  const context=vm.createContext({adapters,Services:services,ChromeUtils:{importESModule:()=>({BasePromiseWorker:Worker})},PathUtils:{join:(...parts:string[])=>parts.join('/')},crypto:webcrypto,setTimeout,clearTimeout,AbortController,console});vm.runInContext(await bundle,context);
  const workspace=context.Client.createNativeWorkspace({directory:'/isolated/workspace',rootURI:'file:///isolated/addon/',openManager:async()=>null});workspace.ready.catch(()=>{});
  await settle();return {workspace,workers,ports,adapters};
}

test('disable cancels an opening worker before waiting for readiness and closes only opened connections',async()=>{
  const {workspace,workers,ports,adapters}=await harness();
  assert.equal(workers[0].calls[0].method,'open');await workspace.close('disable');
  assert.equal(workers[0].calls.at(-1).method,'close');assert.equal(workers[1].calls.length,0);
  assert.equal(ports.length,1);assert.ok(ports.every(port=>port.closed));assert.ok(workers.every(worker=>worker.terminated));assert.equal(adapters.stops,1);assert.equal(adapters.cleared,1);
  await assert.rejects(()=>workspace.execute({type:'tag'},{commandId:'closed'}),/closed/);
});

test('query connections open after writer initialization and aborted subscriptions stop receiving updates',async()=>{
  const {workspace,workers,ports}=await harness();workers[0].open.resolve(undefined);await settle();assert.equal(ports.length,2);assert.equal(ports[1].options.readOnly,true);workers[1].open.resolve(undefined);await workspace.ready;
  const abort=new AbortController(),events:any[]=[];const stop=workspace.watch({page:'settings'},(event:unknown)=>events.push(event),{signal:abort.signal});await settle();assert.equal(events.at(-1).phase,'ready');
  const view=workers[1].calls.find((call:any)=>call.method==='view');assert.ok(view.args[1].queryId);abort.abort();stop();await settle();
  assert.ok(workers[1].calls.some((call:any)=>call.method==='cancel'&&call.args[0]===view.args[1].queryId));const count=events.length;
  await workspace.close('disable');assert.equal(events.length,count);assert.ok(ports.every(port=>port.closed));
});

test('an execute cancelled while waiting for opening never reaches the command worker',async()=>{
  const {workspace,workers}=await harness(),abort=new AbortController();const executing=workspace.execute({type:'tag'},{commandId:'cancelled',signal:abort.signal});executing.catch(()=>{});abort.abort(new Error('Cancelled before dispatch'));
  workers[0].open.resolve(undefined);await settle();workers[1].open.resolve(undefined);await assert.rejects(executing,/Cancelled before dispatch/);assert.ok(!workers[0].calls.some((call:any)=>call.method==='execute'));await workspace.close('disable');
});

test('native worker restart identity stays stable within one Zotero process and is omitted when unavailable',async()=>{
  const services={startup:{getStartupInfo:()=>({process:new Date(1_000)})},appinfo:{processID:42}};
  const first=await harness(services),second=await harness(services),unavailable=await harness();
  assert.equal(first.workers[0].calls[0].args[0].processSessionId,'zotero-process:42:1000');assert.equal(second.workers[0].calls[0].args[0].processSessionId,first.workers[0].calls[0].args[0].processSessionId);assert.equal(unavailable.workers[0].calls[0].args[0].processSessionId,undefined);
  await Promise.all([first.workspace.close('disable'),second.workspace.close('disable'),unavailable.workspace.close('disable')]);
});
