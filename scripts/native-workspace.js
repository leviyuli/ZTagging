/** Native acceptance checks. The bootstrap injects this only into an isolated test build. */
import {run as runWorkflow,verifyAfterRestart} from './native-workspace-workflow.js';
import {verifyPackage} from './native-workspace-package.js';
void(async()=>{
  const config=__WORKSPACE_NATIVE_CONFIG,startup=__WORKSPACE_NATIVE_STARTUP;
  const report={status:'running',startedAt:new Date().toISOString(),configuration:config,environment:{zotero:Services.appinfo.version,gecko:Services.appinfo.platformVersion,os:Services.appinfo.OS},checks:{},metrics:{},errors:[]};
  const write=()=>IOUtils.writeUTF8(config.reportPath,JSON.stringify(report,null,2),{tmpPath:config.reportPath+'.tmp'});
  const normalize=value=>String(value).replace(/\\/g,'/').toLowerCase();
  const check=(name,passed,detail)=>{report.checks[name]={passed:!!passed,...(detail===undefined?{}:{detail})};if(!passed)throw new Error(name);};
  const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
  const until=async(predicate,label,timeout=30_000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=await predicate();if(value)return value;await sleep(20);}throw new Error('Timed out: '+label);};
  const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
  function query(workspace,page,params={}){return new Promise((resolve,reject)=>{const abort=new AbortController();workspace.watch({page,params,limit:50},event=>{if(event.phase==='ready'){abort.abort();resolve(event);}else if(event.phase==='error'){abort.abort();reject(new Error(event.error));}},{signal:abort.signal});});}
  try{
    await write();await Zotero.initializationPromise;await Zotero.uiReadyPromise;
    check('isolatedProfile',normalize(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalize(config.profile));
    check('isolatedLibrary',normalize(Zotero.DataDirectory.dir)===normalize(config.data));
    check('smallWorkspaceInterface',!!Zotero.SmartTags?.workspace&&!Zotero.SmartTags.controller);
    report.phase='opening';await write();const opening=Date.now();
    const main=Zotero.getMainWindow(),background=[];let sampling=true;
    let lastReport=Date.now();const sample=(async()=>{while(sampling){const start=main.performance.now();await new Promise(resolve=>main.requestAnimationFrame(resolve));background.push(main.performance.now()-start);if(background.length>1000)background.shift();if(Date.now()-lastReport>5000){lastReport=Date.now();report.diagnostics={...Zotero.SmartTags.workspace.diagnostics};await write();}await sleep(20);}})();
    try{await Zotero.SmartTags.workspace.ready;}finally{sampling=false;await sample;}report.metrics.startupMs=Date.now()-opening;
    if(background.length>20){report.metrics.backgroundInput={samples:background.length,p95:percentile(background,.95),p99:percentile(background,.99),max:Math.max(...background)};check('backgroundInputLatency',report.metrics.backgroundInput.p95<50&&report.metrics.backgroundInput.p99<100,report.metrics.backgroundInput);}
    report.phase='queries';await write();
    let workspace=Zotero.SmartTags.workspace;
    if(config.packagePath){config.progress=async phase=>{report.phase=phase;await write();};report.package=await verifyPackage(check,config);report.status='passed';report.completedAt=new Date().toISOString();await write();return;}
    if(config.kind==='workflow'){
      config.progress=async phase=>{report.phase=phase;await write();};
      const context=await runWorkflow(workspace,check,config);await SmartTags.shutdown();await SmartTags.startup(startup);await Zotero.SmartTags.workspace.ready;
      report.workflow={...context,afterRestart:await verifyAfterRestart(Zotero.SmartTags.workspace,check,config,context)};await SmartTags.shutdown();report.status='passed';report.completedAt=new Date().toISOString();await write();return;
    }
    const slices=[],originalWatch=workspace.watch.bind(workspace);workspace.watch=(query,receive,options)=>originalWatch(query,event=>{const start=main.performance.now();try{receive(event);}finally{slices.push(main.performance.now()-start);if(slices.length>1000)slices.shift();}},options);
    const settings=await query(workspace,'settings');check('automaticNewPaperTaggingOff',!settings.model.settings.autoAssign);
    check('schema14Locator',JSON.parse(await IOUtils.readUTF8(PathUtils.join(Zotero.SmartTags.stateDirectory,'state.json'))).schemaVersion===14);
    if(config.kind.startsWith('archive')){
      report.phase='idle-storage-reclamation';await write();const maintenanceInput=[],started=Date.now();let bytes=settings.model.storage.databaseBytes;
      while(bytes>50*1024*1024&&Date.now()-started<180_000){
        const start=main.performance.now();await new Promise(resolve=>main.requestAnimationFrame(resolve));maintenanceInput.push(main.performance.now()-start);
        bytes=(await query(workspace,'settings')).model.storage.databaseBytes;await sleep(100);
      }
      report.metrics.archiveDatabaseBytes=bytes;report.metrics.idleReclamationMs=Date.now()-started;
      check('archiveDatabaseAtMost50MiB',bytes<=50*1024*1024,{bytes});
      if(maintenanceInput.length>20){report.metrics.maintenanceInput={samples:maintenanceInput.length,p95:percentile(maintenanceInput,.95),p99:percentile(maintenanceInput,.99),max:Math.max(...maintenanceInput)};check('maintenanceInputLatency',report.metrics.maintenanceInput.p95<50&&report.metrics.maintenanceInput.p99<100,report.metrics.maintenanceInput);}
    }
    const pages={};for(const page of ['build','vocabulary','assignment','library','activity','settings']){pages[page]=await query(workspace,page);check('bounded-'+page,new TextEncoder().encode(JSON.stringify(pages[page])).length<=256*1024&&pages[page].model.papers.length<=50&&pages[page].model.tags.length<=50);}
    if(config.kind==='synthetic'){check('tenThousandPaperCount',pages.library.model.totals.papers===10_000);check('twoThousandDefinitions',pages.vocabulary.model.totals.definedTags===2_000);}
    check('decodedCacheBound',pages.settings.model.storage?.decodedCacheBytes<=32*1024*1024,pages.settings.model.storage);
    const latency=[];for(let index=0;index<25;index++){const start=Date.now();await query(workspace,'library',{paperQuery:index%2?'synthetic':'Workspace'});latency.push(Date.now()-start);}
    report.metrics.warmQueries={p95:percentile(latency,.95),p99:percentile(latency,.99),max:Math.max(...latency)};check('warmPageP95',report.metrics.warmQueries.p95<250,report.metrics.warmQueries);
    report.phase='ui';await write();let win=await Zotero.SmartTags.openManager({page:'vocabulary'});
    await until(async()=>{win=await Zotero.SmartTags.openManager({page:'vocabulary'});return win.document.getElementById('vocabulary-search');},'tag library search');const doc=win.document;
    const input=doc.getElementById('vocabulary-search'),response=[],handlers=[];
    for(let index=0;index<40;index++){const start=win.performance.now();input.value='Topic '+String(index%10);input.dispatchEvent(new win.Event('input',{bubbles:true}));handlers.push(win.performance.now()-start);await new Promise(resolve=>win.requestAnimationFrame(resolve));response.push(win.performance.now()-start);}
    report.metrics.input={p95:percentile(response,.95),p99:percentile(response,.99),max:Math.max(...response)};
    report.metrics.pluginPageSlices={samples:slices.length,p95:percentile(slices,.95),max:Math.max(...slices)};report.metrics.inputHandlers={p95:percentile(handlers,.95),max:Math.max(...handlers)};
    check('inputLatency',report.metrics.input.p95<50&&report.metrics.input.p99<100,report.metrics.input);
    check('searchControlStaysMounted',doc.getElementById('vocabulary-search')===input);
    input.focus();input.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check('keyboardEscapeClearsSearch',input.value==='');
    for(const page of ['build','vocabulary','assignment','library','activity','settings']){
      await Zotero.SmartTags.openManager({page});await until(()=>doc.querySelector(`[data-ui-key="page:${page}"]`),'page '+page);await sleep(160);
      check('page-'+page,doc.getElementById('app').getAttribute('data-smart-tags-state')==='ready');check('layout-'+page,doc.documentElement.scrollWidth<=win.innerWidth+2);
      const canvas=doc.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=win.innerWidth;canvas.height=win.innerHeight;canvas.getContext('2d').drawWindow(win,0,0,canvas.width,canvas.height,win.getComputedStyle(doc.body).backgroundColor);const encoded=canvas.toDataURL('image/png').split(',')[1];await IOUtils.write(PathUtils.join(config.root,'build','native-workspace-'+config.kind+'-'+config.theme+'-'+page+'.png'),Uint8Array.from(atob(encoded),char=>char.charCodeAt(0)));
    }
    report.metrics.pluginPageSlices={samples:slices.length,p95:percentile(slices,.95),max:Math.max(...slices)};check('noPluginPageSlice50ms',report.metrics.pluginPageSlices.max<50,report.metrics.pluginPageSlices);
    const canvas=doc.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=win.innerWidth;canvas.height=win.innerHeight;const context=canvas.getContext('2d');context.drawWindow(win,0,0,canvas.width,canvas.height,win.getComputedStyle(doc.body).backgroundColor);const encoded=canvas.toDataURL('image/png').split(',')[1];await IOUtils.write(PathUtils.join(config.root,'build','native-workspace-'+config.kind+'-'+config.theme+'.png'),Uint8Array.from(atob(encoded),char=>char.charCodeAt(0)));
    const close=[];for(let index=0;index<5;index++){const start=Date.now();await SmartTags.shutdown();close.push(Date.now()-start);if(index<4){await SmartTags.startup(startup);await Zotero.SmartTags.workspace.ready;}}
    report.metrics.idleDisable={p95:percentile(close,.95),max:Math.max(...close)};check('idleDisableP95',report.metrics.idleDisable.p95<250,report.metrics.idleDisable);
    report.status='passed';report.completedAt=new Date().toISOString();await write();
  }catch(error){report.status='failed';report.errors.push({message:String(error),stack:error.stack});report.completedAt=new Date().toISOString();await write();}
})();
