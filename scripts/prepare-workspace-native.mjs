/** Prepare only marker-verified, isolated Zotero profiles; release files stay untouched. */
import {cp,mkdir,readFile,writeFile,access,rename} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {initialState} from '../src/controller.ts';
import {paperFingerprint,fingerprint} from '../src/core.ts';

const root=path.resolve(process.cwd()),theme=process.argv.includes('--dark')?'dark':'light';
const kind=process.argv.includes('--workflow')?'workflow':process.argv.includes('--archive-fresh')?'archive-fresh':process.argv.includes('--archive')?'archive':process.argv.includes('--small')?'small':'synthetic';
const profile=path.join(root,`.test-profile-workspace-${kind}`),data=path.join(root,`build/workspace-${kind}-data`),addon=path.join(root,'build/workspace-native-addon');
const exists=async file=>{try{await access(file);return true;}catch{return false;}};
const marker=path.join(profile,'.smart-tags-smoke-profile.json');
if(await exists(profile)){
  const saved=JSON.parse(await readFile(marker,'utf8'));
  if(saved.root!==root||saved.data!==data)throw new Error('Refusing an unrecognized native test profile.');
}else{await mkdir(profile,{recursive:true});await writeFile(marker,JSON.stringify({root,data},null,2));}
// A previous package check may have disabled its installed copy. Rebuild only
// this isolated profile's extension cache, preserving it for test diagnostics.
for(const name of ['extensions.json','addonStartup.json.lz4']){const file=path.join(profile,name);if(await exists(file))await rename(file,path.join(profile,name+'.before-test-'+Date.now()));}
await mkdir(data,{recursive:true});await mkdir(path.join(profile,'extensions'),{recursive:true});
const stateDirectory=path.join(profile,'smart-tags');
if(process.argv.includes('--reset-state')&&await exists(stateDirectory)){
  if(!stateDirectory.startsWith(root+path.sep)||path.dirname(stateDirectory)!==profile)throw new Error('Refusing an unexpected isolated state path.');
  await rename(stateDirectory,stateDirectory+'.before-ai-'+Date.now());
}
await mkdir(stateDirectory,{recursive:true});
const statePath=path.join(stateDirectory,'state.json');
if(!await exists(statePath)){
  if(kind.startsWith('archive'))await cp(path.join(root,'build/private-native-save/state.json'),statePath,{errorOnExist:true,force:false});
  else{
    const state=initialState();state.tags=[];state.taxonomyReady=true;
    const tagCount=kind==='workflow'?0:kind==='small'?20:2_000,paperCount=kind==='workflow'?0:kind==='small'?100:10_000;
    for(let index=0;index<tagCount;index++)state.tags.push({id:'topic-'+index,name:'Topic '+String(index).padStart(4,'0'),fullName:'Scientific topic '+index,description:'A distinct retrieval concept for synthetic responsiveness checks.',facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[],relatedIds:[],matchingMode:'auto'});
    state.definitionOrigins=Object.fromEntries(state.tags.map(tag=>[tag.id,{version:1,kind:'ai-build',tagId:tag.id,creationFingerprint:fingerprint(tag),workId:'synthetic-build-fixture',recordedAt:Date.now()}]));
    for(let index=0;index<paperCount;index++){
      const key='WS'+String(index).padStart(6,'0'),id='1:'+key;
      const paper={id,key,itemID:900_000+index,libraryID:1,title:'Workspace synthetic paper '+String(index).padStart(5,'0'),abstract:'Electrochemical measurements establish a reproducible scientific result. '.repeat(12),keywords:['synthetic'],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
      if(kind==='synthetic'&&index===0){let seed=0x12345678;const chunks=[];for(let part=0;part<128;part++){const chars=[];for(let offset=0;offset<65_536;offset++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;chars.push(String.fromCharCode(32+(seed>>>0)%95));}chunks.push(chars.join(''));}paper.pdfText=chunks.join('');paper.fingerprint=paperFingerprint(paper);}
      state.papers[id]=paper;state.nativeTags[id]=[{tag:'Topic '+String(index%tagCount).padStart(4,'0'),type:0}];
    }
    for(let index=0;index<(kind==='workflow'?0:kind==='small'?2:500);index++)state.history.push({id:'archive-'+index,date:new Date().toISOString(),label:'Completed synthetic run '+index,patches:[],beforeOwnership:{},afterOwnership:{},suggestionIds:[],status:'applied',diagnosticBody:(index%2?'Shared retained diagnostic. ':`Unique diagnostic ${index}. `).repeat(2_000)});
    await writeFile(statePath,JSON.stringify(state));
  }
}
await cp(path.join(root,'build/addon'),addon,{recursive:true});
await build({entryPoints:['scripts/native-workspace.js'],outfile:path.join(addon,'content/native-workspace.js'),bundle:true,format:'iife',platform:'browser',target:'firefox140',legalComments:'none'});
const manifest=JSON.parse(await readFile(path.join(addon,'manifest.json'),'utf8'));
const installedPackage=path.join(profile,'extensions',manifest.applications.zotero.id+'.xpi');
if(await exists(installedPackage))await rename(installedPackage,path.join(profile,'package-test-previous-'+Date.now()+'.xpi'));
const reportPath=path.join(root,`build/native-workspace-${kind}-${theme}-report.json`);
const packageArgument=process.argv.find(value=>value.startsWith('--package='));
const nativeGraphics=process.argv.includes('--native-graphics');
const config={root,profile,data,reportPath,theme,kind,graphics:nativeGraphics?'native-default':'software',...(kind==='workflow'?{providerReportPath:path.join(root,'build/native-workspace-provider-report.json')}:{}),...(packageArgument?{packagePath:path.resolve(packageArgument.slice('--package='.length)),packageVersion:manifest.version}:{})};
if(kind==='workflow'){
  const fixture=await build({stdin:{contents:`import {installWorkspaceProviderFixture} from './scripts/workspace-provider-fixture.js';installWorkspaceProviderFixture(${JSON.stringify({reportPath:config.providerReportPath})});`,resolveDir:root,sourcefile:'native-provider-fixture.js'},write:false,bundle:true,format:'iife',platform:'browser',target:'firefox140'});
  const workerPath=path.join(addon,'content/workspace-worker.js');await writeFile(workerPath,fixture.outputFiles[0].text+'\n'+await readFile(workerPath,'utf8'));
}
const bootstrapPath=path.join(addon,'bootstrap.js'),bootstrap=await readFile(bootstrapPath,'utf8');
await writeFile(bootstrapPath,bootstrap.replace('await smartTagsScope.SmartTags.startup({ id, version, rootURI });',`await IOUtils.writeUTF8(${JSON.stringify(reportPath)},JSON.stringify({status:'running',phase:'bootstrap',startedAt:new Date().toISOString()}));\n try{await smartTagsScope.SmartTags.startup({ id, version, rootURI,indexLibrary:${kind==='workflow'} });}catch(error){await IOUtils.writeUTF8(${JSON.stringify(reportPath)},JSON.stringify({status:'failed',phase:'bootstrap',startedAt:new Date().toISOString(),error:String(error),stack:error.stack}));throw error;}\n smartTagsScope.__WORKSPACE_NATIVE_CONFIG=${JSON.stringify(config)};\n smartTagsScope.__WORKSPACE_NATIVE_STARTUP={id,version,rootURI,indexLibrary:${kind==='workflow'}};\n Services.scriptloader.loadSubScript(rootURI+'content/native-workspace.js',smartTagsScope);`));
await writeFile(path.join(profile,'extensions',manifest.applications.zotero.id),addon);
const prefs={'extensions.zotero.useDataDir':true,'extensions.zotero.dataDir':data,'extensions.zotero.warnOnUnsafeDataDir':false,'extensions.zotero.sync.autoSync':false,'extensions.zotero.firstRun2':false,'extensions.autoDisableScopes':0,'extensions.enabledScopes':15,'extensions.startupScanScopes':15,'extensions.lastAppBuildId':'','extensions.lastAppVersion':'','extensions.zotero.automaticScraperUpdates':false,'layout.testing.top-level-always-active':true,'dom.min_background_timeout_value':0,'dom.min_background_timeout_value_without_budget_throttling':0,'dom.timeout.enable_budget_timer_throttling':false,'extensions.zoteroWinWordIntegration.skipInstallation':true,'extensions.zoteroOpenOfficeIntegration.skipInstallation':true,'browser.theme.toolbar-theme':theme==='dark'?0:1,'ui.systemUsesDarkTheme':theme==='dark'?1:0};
Object.assign(prefs,{'layers.acceleration.disabled':!nativeGraphics,'gfx.webrender.software':!nativeGraphics,'gfx.webrender.all':false,'gfx.webrender.force-disabled':!nativeGraphics});
await writeFile(path.join(profile,'user.js'),Object.entries(prefs).map(([key,value])=>`user_pref(${JSON.stringify(key)},${JSON.stringify(value)});`).join('\n')+'\n');
console.log(JSON.stringify(config));
