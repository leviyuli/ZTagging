/** Install and exercise the exact XPI only inside a marker-verified native profile. */
export async function verifyPackage(check,config){
  const normalize=value=>String(value).replace(/\\/g,'/').toLowerCase();
  if(normalize(Services.dirsvc.get('ProfD',Ci.nsIFile).path)!==normalize(config.profile)||normalize(Zotero.DataDirectory.dir)!==normalize(config.data))throw new Error('Packaged acceptance requires the isolated profile and library.');
  const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const until=async(predicate,label)=>{const start=Date.now();while(Date.now()-start<15_000){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Packaged acceptance timed out: '+label);};
  const lifecycle=(method,action)=>new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);Zotero.Plugins.removeObserver(observer);};
    const observer={[method](params){if(params.id==='smart-tags@zotero-local.org'){cleanup();resolve();}}};
    const timer=setTimeout(()=>{cleanup();reject(new Error('Packaged lifecycle timed out: '+method));},15_000);
    Zotero.Plugins.addObserver(observer);Promise.resolve().then(action).catch(error=>{cleanup();reject(error);});
  });
  await config.progress?.('package-installing');const previousWorkspace=Zotero.SmartTags.workspace;
  const file=Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);file.initWithPath(config.packagePath);
  const install=await AddonManager.getInstallForFile(file);
  check('packagedIdentity',install.addon?.id==='smart-tags@zotero-local.org'&&install.addon.version===config.packageVersion&&install.error===0,{version:install.addon?.version,error:install.error});
  await lifecycle('startup',()=>install.install());
  const addon=await AddonManager.getAddonByID('smart-tags@zotero-local.org');
  check('packagedInstalledActive',addon?.isActive&&addon.version===config.packageVersion);
  check('packagedArchiveResources',addon.getResourceURI('content/workspace-worker.js').spec.startsWith('jar:'));
  await until(()=>Zotero.SmartTags?.workspace&&Zotero.SmartTags.workspace!==previousWorkspace,'replacement startup');
  await config.progress?.('package-opening-workers');
  await Zotero.SmartTags.workspace.ready;
  const query=page=>new Promise((resolve,reject)=>{const abort=new AbortController();Zotero.SmartTags.workspace.watch({page,limit:50},event=>{if(event.phase==='ready'){abort.abort();resolve(event);}else if(event.phase==='error'){abort.abort();reject(new Error(event.error));}},{signal:abort.signal});});
  const first=await query('settings');
  check('packagedWorkersFromArchive',!!first.model.settings&&Zotero.SmartTags.version===config.packageVersion);
  const manager=await Zotero.SmartTags.openManager({page:'vocabulary'});
  await until(()=>manager.document.getElementById('vocabulary-search'),'manager');
  check('packagedManagerResources',manager.location.href.includes('chrome://smart-tags/')&&manager.document.getElementById('app').getAttribute('data-smart-tags-state')==='ready');
  await config.progress?.('package-disabling');const start=Date.now();await lifecycle('shutdown',()=>addon.disable());await until(()=>!Zotero.SmartTags,'disable checkpoint');
  check('packagedIdleDisable',Date.now()-start<250,{milliseconds:Date.now()-start});
  await lifecycle('startup',()=>addon.enable());await until(()=>Zotero.SmartTags?.workspace,'re-enable');await Zotero.SmartTags.workspace.ready;
  const after=await query('settings');
  check('packagedReenablePreservesWorkspace',!!after.model.settings&&Zotero.SmartTags.version===config.packageVersion);
  await config.progress?.('package-rapid-toggle');const beforeRapid=Zotero.SmartTags.workspace;let disableReturned;
  const shutdownDone=lifecycle('shutdown',()=>{disableReturned=addon.disable();return disableReturned;});await Promise.resolve();await disableReturned;
  const startupDone=lifecycle('startup',()=>addon.enable());await Promise.all([shutdownDone,startupDone]);await until(()=>Zotero.SmartTags?.workspace&&Zotero.SmartTags.workspace!==beforeRapid,'rapid re-enable');await Zotero.SmartTags.workspace.ready;
  check('packagedRapidTogglePreservesWorkers',!!(await query('settings')).model.settings);
  await config.progress?.('package-stopping');await lifecycle('shutdown',()=>addon.disable());await until(()=>!Zotero.SmartTags,'final disable');
  return {version:addon.version,sourceURI:install.sourceURI.spec};
}
