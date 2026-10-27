import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('Zotero bootstrap imports its web globals without depending on a window or console',async()=>{
  const source=await readFile(new URL('../addon/bootstrap.js',import.meta.url),'utf8');
  const events:string[]=[];
  let target:any;
  const context:any={
    Zotero:{},Cc:{'@mozilla.org/addons/addon-manager-startup;1':{getService:()=>({registerChrome:()=>({destruct:()=>events.push('unregister')})})}},Ci:{amIAddonManagerStartup:{}},
    IOUtils:{},PathUtils:{},
    Services:{io:{newURI:(uri:string)=>uri},scriptloader:{loadSubScript:(_uri:string,scope:any)=>{target=scope;scope.SmartTags={startup:async()=>events.push('startup'),shutdown:async()=>events.push('shutdown'),onMainWindowLoad:()=>events.push('window')};}}},
    ChromeUtils:{importESModule:(uri:string)=>{assert.match(uri,/Timer\.sys\.mjs$/);return{setTimeout,clearTimeout};}},
    Components:{utils:{importGlobalProperties:(names:string[])=>{for(const name of names)context[name]=(globalThis as any)[name];}}}
  };
  vm.createContext(context);vm.runInContext(source,context);
  await context.startup({id:'test',version:'0.1.0',rootURI:'file:///test/'},1);
  assert.equal(Object.hasOwn(target,'console'),false);
  assert.equal(target.fetch,fetch);assert.equal(target.crypto,crypto);assert.equal(target.TextEncoder,TextEncoder);
  assert.equal(typeof target.setTimeout,'function');
  context.onMainWindowLoad({window:{}});
  await context.shutdown({},1);
  assert.deepEqual(events,['startup','window','shutdown','unregister']);
});

test('distribution manifest supplies Zotero’s mandatory secure update URL and tested version range',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../addon/manifest.json',import.meta.url),'utf8'));
  const settings=manifest.applications.zotero;
  assert.equal(settings.id,'smart-tags@zotero-local.org');
  assert.ok(settings.update_url.startsWith('https:'));
  assert.equal(settings.update_url,'https://raw.githubusercontent.com/leviyuli/ZTagging/main/updates.json');
  assert.equal(settings.strict_min_version,'10.0.6');assert.equal(settings.strict_max_version,'10.0.*');
});
