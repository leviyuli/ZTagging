import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=readFile(new URL('../addon/bootstrap.js',import.meta.url),'utf8');
const data={id:'bootstrap-lifecycle-test',version:'1.0.7',rootURI:'file:///isolated-addon/'};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(yes=>resolve=yes);return {promise,resolve};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

async function harness(options:{close?:()=>Promise<void>;hostCleanup?:()=>Promise<void>}={}){
  const events:string[]=[],menus=new Set<string>(),observers=new Set<{shutdown:(params:{id:string})=>unknown}>();let generation=0;
  observers.add({shutdown:async()=>{await options.hostCleanup?.();menus.clear();events.push('host-cleanup');}});
  const context:any={
    Zotero:{Plugins:{addObserver:(observer:any)=>observers.add(observer),removeObserver:(observer:any)=>observers.delete(observer)}},
    Cc:{'@mozilla.org/addons/addon-manager-startup;1':{getService:()=>({registerChrome:()=>{const id=++generation;events.push('register-'+id);return {destruct:()=>events.push('destruct-'+id)};}})}},Ci:{amIAddonManagerStartup:{}},IOUtils:{},PathUtils:{},
    Services:{io:{newURI:(uri:string)=>uri},scriptloader:{loadSubScript:(_uri:string,scope:any)=>{const id=generation;scope.SmartTags={async startup(){menus.add('menu-'+id);events.push('startup-'+id);},async shutdown(){events.push('close-'+id);if(id===1)await options.close?.();menus.delete('menu-'+id);events.push('closed-'+id);}};}}},
    ChromeUtils:{importESModule:()=>({setTimeout,clearTimeout})},
    Components:{utils:{importGlobalProperties:(names:string[])=>{for(const name of names)context[name]=(globalThis as any)[name];}}},
  };
  vm.createContext(context);vm.runInContext(await source,context);
  const disable=async()=>{let error:unknown;await(async()=>{try{await context.shutdown(data,8);}catch(failure){error=failure;}for(const observer of observers){const result=observer.shutdown({id:data.id});if(result&&typeof (result as Promise<unknown>).then==='function')await result;}})();events.push('host-finalized');if(error)throw error;};
  return {context,events,menus,observers,disable};
}

test('rapid reenable waits for the old workspace and Zotero control cleanup before registering again',async()=>{
  const close=deferred(),host=deferred(),h=await harness({close:()=>close.promise,hostCleanup:()=>host.promise});await h.context.startup(data,3);
  const stopping=h.disable();await settle();const restarting=h.context.startup(data,3);await settle();assert.deepEqual(h.events,['register-1','startup-1','close-1']);
  close.resolve();await settle();assert.ok(h.events.includes('destruct-1'));assert.equal(h.events.includes('register-2'),false,'An asynchronous host observer must finish before new controls appear.');
  host.resolve();await stopping;await restarting;assert.deepEqual([...h.menus],['menu-2']);assert.ok(h.events.indexOf('host-cleanup')<h.events.indexOf('register-2'));assert.ok(h.events.indexOf('host-finalized')<h.events.indexOf('register-2'));assert.equal(h.events.filter(event=>event==='destruct-1').length,1);assert.equal(h.observers.size,1);
  await h.disable();
});

test('a failed workspace close still releases its captured chrome handle and permits reenable',async()=>{
  const h=await harness({close:async()=>{throw new Error('Durable close failed');}});await h.context.startup(data,3);
  const stopping=h.disable(),failure=assert.rejects(stopping,/Durable close failed/),restarting=h.context.startup(data,3);await failure;await restarting;
  assert.equal(h.events.filter(event=>event==='destruct-1').length,1);assert.deepEqual([...h.menus],['menu-2']);assert.ok(h.events.indexOf('host-cleanup')<h.events.indexOf('register-2'));await h.disable();
});

test('bootstrap adapters without Zotero lifecycle observers yield a turn before replacement startup',async()=>{
  const h=await harness();delete h.context.Zotero.Plugins;await h.context.startup(data,3);await h.context.shutdown(data,8);const restarting=h.context.startup(data,3);await restarting;
  assert.equal(h.events.filter(event=>event==='destruct-1').length,1);assert.ok(h.events.indexOf('destruct-1')<h.events.indexOf('register-2'));await h.context.shutdown(data,8);
});
