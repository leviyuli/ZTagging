/** TEST ONLY. Native v0.5 workflows on synthetic papers in the exact isolated profile. */
import { initialState } from '../src/controller.ts';
import { buildMetadataPreview } from '../src/paper-recovery.ts';
import { normalizeFacts } from '../src/taxonomy.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
const button=(doc,label)=>[...doc.querySelectorAll('button')].find(value=>value.textContent===label||value.getAttribute('aria-label')===label);
async function until(predicate,label){const started=Date.now();while(Date.now()-started<20_000){const result=predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error('Native v0.5.0 timeout: '+label);}

function localFile(path){const file=Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);file.initWithPath(path);return file;}
function packageManifest(path){
  const zip=Cc['@mozilla.org/libjar/zip-reader;1'].createInstance(Ci.nsIZipReader);zip.open(localFile(path));
  try{const stream=zip.getInputStream('manifest.json'),reader=Cc['@mozilla.org/binaryinputstream;1'].createInstance(Ci.nsIBinaryInputStream);reader.setInputStream(stream);try{return JSON.parse(new TextDecoder().decode(new Uint8Array(reader.readByteArray(reader.available()))));}finally{reader.close();}}
  finally{zip.close();}
}
async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');}

async function verifyNativePackageUpgrade(check,config){
  const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const id='smart-tags@zotero-local.org',expected=Zotero.SmartTags.version,oldVersion='0.6.0',oldPath=PathUtils.join(config.root,'dist',`smart-tags-${oldVersion}.xpi`),newPath=PathUtils.join(config.root,'dist',`smart-tags-${expected}.xpi`);
  const oldManifest=packageManifest(oldPath),newManifest=packageManifest(newPath),oldSettings=oldManifest.applications.zotero,newSettings=newManifest.applications.zotero;
  check('v050UpdatePackagesKeepStableIdentity',oldManifest.version===oldVersion&&newManifest.version===expected&&oldSettings.id===id&&newSettings.id===id);
  check('v050UpdateURLRemainsSecureAndStable',newSettings.update_url.startsWith('https://')&&newSettings.update_url===oldSettings.update_url&&newSettings.strict_min_version==='10.0.6'&&newSettings.strict_max_version==='10.0.*');
  const feed=JSON.parse(await IOUtils.readUTF8(PathUtils.join(config.root,'updates.json'))),entry=feed.addons[id].updates.find(update=>update.version===expected),hash=await sha256(await IOUtils.read(newPath));
  check('v050LocalUpdateManifestMatchesPackage',entry?.update_link===`https://raw.githubusercontent.com/leviyuli/ZTagging/main/dist/smart-tags-${expected}.xpi`&&entry.update_hash==='sha256:'+hash);
  const main=Zotero.getMainWindow(),columns=()=>JSON.stringify(main.ZoteroPane.itemsView.getColumns().map(column=>[column.dataKey,column.hidden,column.width,column.ordinal]));
  const beforeColumns=columns(),beforeTags=JSON.stringify((await Zotero.Items.getAll(Zotero.Libraries.userLibraryID,true,false)).filter(item=>item.isRegularItem()&&!item.deleted).map(item=>[item.id,item.getTags()]));
  let addon=await AddonManager.getAddonByID(id),uninstalls=0;
  check('v050NativeUpgradeStartsFromTestAddon',addon?.id===id&&addon.version===expected);
  const observer={onUninstalling(value){if(value.id===id)uninstalls++;}};AddonManager.addAddonListener(observer);
  async function install(path,version){
    const pending=await AddonManager.getInstallForFile(localFile(path));if(!pending)throw new Error('Native updater could not inspect the local XPI.');
    const installed=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>finish(new Error('Native XPI install timed out.')),20_000);
      const listener={onInstallEnded(_install,value){finish(null,value);},onInstallFailed(value){finish(new Error('Native XPI install failed: '+value.error));},onInstallCancelled(){finish(new Error('Native XPI install was cancelled.'));}};
      function finish(error,value){clearTimeout(timeout);pending.removeListener(listener);error?reject(error):resolve(value);}
      pending.addListener(listener);try{Promise.resolve(pending.install()).catch(finish);}catch(error){finish(error);}
    });
    if(installed.id!==id||installed.version!==version)throw new Error('Native updater installed an unexpected identity or version.');return installed;
  }
  try{
    await addon.disable();await until(()=>!Zotero.SmartTags,'test addon disabled');
    const statePath=PathUtils.join(config.profile,'smart-tags','state.json'),beforeState=await IOUtils.readUTF8(statePath);
    // Keep the old package disabled so it cannot rewrite state introduced by the new version.
    addon=await install(oldPath,oldVersion);
    check('v050OldPackageStaysDisabled',addon.userDisabled&&!addon.isActive&&!Zotero.SmartTags);
    check('v050OldPackageCannotRewriteNewerState',await IOUtils.readUTF8(statePath)===beforeState);
    addon=await install(newPath,expected);check('v050NativePackageUpgradeWithoutUninstall',addon.userDisabled&&uninstalls===0);
    await addon.enable();await until(()=>Zotero.SmartTags?.version===expected&&Zotero.SmartTags.controller,'production upgraded addon startup');
    const current=Zotero.SmartTags.controller;
    check('v050NativeUpgradePreservesPluginState',JSON.stringify(current.state)===JSON.stringify(JSON.parse(beforeState)));
    const afterTags=JSON.stringify((await Zotero.Items.getAll(Zotero.Libraries.userLibraryID,true,false)).filter(item=>item.isRegularItem()&&!item.deleted).map(item=>[item.id,item.getTags()]));
    check('v050NativeUpgradePreservesLibraryAndColumns',afterTags===beforeTags&&columns()===beforeColumns);
    return {from:oldVersion,to:expected,method:'Native AddonManager.getInstallForFile',oldPackageDisabled:true,uninstallEvents:uninstalls,packageHash:hash,feedDiscovery:'Not tested before publication; local HTTPS feed metadata and package hash verified.'};
  }catch(error){
    try{addon=await AddonManager.getAddonByID(id);if(addon?.version!==expected)addon=await install(newPath,expected);if(addon.userDisabled)await addon.enable();await until(()=>Zotero.SmartTags?.version===expected,'restored production addon');}
    catch(recovery){throw new Error(String(error?.message??error)+' Production package restoration also failed: '+String(recovery?.message??recovery));}
    throw error;
  }finally{AddonManager.removeAddonListener(observer);}
}

export async function runNativeV050(app,check,config){
  check('v050IsolatedDataGuard',normalized(Zotero.DataDirectory.dir)===normalized(config.data));
  check('v050IsolatedProfileGuard',normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile));
  check('v050StateSchema',app.state.schemaVersion===6);
  const before=clone(app.state),host=app.env.host,ai=app.env.ai,oldComplete=ai.completeJson,oldLookup=host.lookupMetadata;
  const main=Zotero.getMainWindow(),oldMode=Zotero.SmartTags.getNavigator(main)?.mode;
  const columnState=()=>JSON.stringify(main.ZoteroPane.itemsView.getColumns().map(column=>[column.dataKey,column.hidden,column.width,column.ordinal]));
  const columns=columnState();let item,manager,requests=0,metadataLookups=0,result;
  const open=async page=>{manager=await Zotero.SmartTags.openManager({page});await until(()=>manager.document.getElementById('app')?.getAttribute('data-smart-tags-state')==='ready','manager ready');return manager.document;};
  const click=async(doc,label)=>{const control=button(doc,label);if(!control||control.disabled)throw new Error('Native v0.5.0 missing enabled control: '+label);control.click();await new Promise(resolve=>setTimeout(resolve,0));await until(()=>!button(doc,label)?.disabled,'action '+label);};
  try{
    const recoveredAbstract='This fuel cell study measures membrane resistance.';
    ai.completeJson=async(_system,prompt)=>{requests++;if(!prompt.startsWith('Extract factual scientific concepts'))throw new Error('Unexpected V050QA synthetic analysis request.');return {value:{summary:'A fuel cell resistance study.',concepts:[{name:'fuel cell',facet:'system',evidence:[{source:'abstract',text:recoveredAbstract}]}],needsPDF:false},usageKnown:true,usage:{inputTokens:100,outputTokens:100},estimatedCostUSD:0};};
    app.state=initialState();app.state.settings={...before.settings,provider:'chatgpt',model:'native-v050-test',autoAssign:false};
    app.state.tags=[{id:'v050-fc',name:'FC',fullName:'fuel cell',description:'Fuel cell systems.',facet:'system',aliases:['V050 obsolete FC'],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[],relatedIds:[],matchingMode:'auto'}];
    app.state.taxonomyReady=true;app.state.vocabularyVersion=1;
    item=new Zotero.Item('journalArticle');item.libraryID=Zotero.Libraries.userLibraryID;item.setField('title','V050QA missing abstract');item.setField('DOI','10.1000/v050-native');item.setTags([{tag:'V050 obsolete FC',type:0},{tag:'V050 research topic',type:0}]);await item.saveTx();
    const paper=await host.read(item.id);app.state.papers[paper.id]=paper;app.state.facts[paper.id]=normalizeFacts({summary:'The abstract is missing.',concepts:[],needsPDF:true},paper,'native-synthetic','native-v050-test');await app.save();
    const doc=await open('settings');
    check('v050NativeVersionAndRecoveryControls',doc.body.textContent.includes('Installed version '+Zotero.SmartTags.version)&&!!button(doc,'Show tag navigation')&&!!button(doc,'Restore navigation')&&!!button(doc,'Check for updates'));
    const oldNavigatorRoot=main.document.getElementById('smart-tags-navigator');await click(doc,'Restore navigation');
    await until(()=>Zotero.SmartTags.getNavigator(main)?.mode==='tags'&&main.document.getElementById('smart-tags-navigator')!==oldNavigatorRoot&&main.document.querySelectorAll('#smart-tags-navigator').length===1,'restored Smart Tags navigation');
    check('v050NativeNavigationRestoresOnce',main.document.getElementById('smart-tags-navigator').textContent.includes('Smart Tags')&&columnState()===columns);

    await app.invoke('refresh-existing-tags',{});await open('existing-tags');
    await until(()=>doc.querySelector('.existing-tag-row'),'existing tag rows');
    const search=doc.getElementById('existing-tag-search');search.value='V050 obsolete FC';search.dispatchEvent(new manager.Event('input',{bubbles:true}));
    const display=await app.snapshot(),shownGroup=display.existingTags?.rows.find(row=>row.name==='V050 obsolete FC');
    if(!shownGroup)throw new Error('Native v0.5.0 existing tag scan omitted its synthetic name.');
    const checkbox=doc.getElementById('existing-'+shownGroup.id);
    check('v050ExistingNamesStartUnselected',checkbox&&!checkbox.checked&&button(doc,'Review paper changes').disabled);
    checkbox.click();await until(()=>!button(doc,'Review paper changes').disabled,'matched name selected');
    const nativeTags=JSON.stringify(item.getTags());await click(doc,'Review paper changes');
    await until(()=>button(doc,'Apply reviewed tag changes'),'reviewed native changes');
    check('v050ExistingNativePreviewIsReadOnly',JSON.stringify(item.getTags())===nativeTags&&doc.body.textContent.includes('Before:')&&doc.body.textContent.includes('After:')&&doc.body.textContent.includes('V050 research topic'));
    await click(doc,'Create DIY tags…');
    check('v050DIYShowsConsentBeforeAI',doc.body.textContent.includes('uses your ChatGPT allowance or API budget')&&!!button(doc,'Analyze and create DIY tags')&&requests===0);
    await click(doc,'Cancel');

    await app.invoke('recheck-paper-inputs',{id:paper.id});await open('activity');
    await until(()=>doc.querySelector('.paper-attention-row'),'paper attention');
    check('v050PaperAttentionIsUnique', [...doc.querySelectorAll('.paper-attention-row')].filter(row=>row.textContent.includes('V050QA missing abstract')).length===1&&!doc.querySelector('.active-warning-summary')&&requests===0);
    host.lookupMetadata=async itemID=>{metadataLookups++;const current=await host.readMetadata(itemID);return buildMetadataPreview(current,[{itemType:'journalArticle',title:'V050QA missing abstract',DOI:'10.1000/v050-native',abstractNote:recoveredAbstract}]);};
    await click(doc,'Find metadata');await until(()=>button(doc,'Apply metadata'),'metadata preview');
    check('v050MetadataPreviewIsReadOnly',!item.getField('abstractNote')&&doc.body.textContent.includes('Before: Empty')&&doc.body.textContent.includes(recoveredAbstract)&&metadataLookups===1&&requests===0);
    await click(doc,'Apply metadata');await until(()=>item.getField('abstractNote')===recoveredAbstract,'metadata applied');await app.waitForIdle();
    check('v050MetadataFillsOnlyMissingFields',item.getField('title')==='V050QA missing abstract'&&item.getField('DOI')==='10.1000/v050-native'&&JSON.stringify(item.getTags())===nativeTags&&requests===1&&app.state.facts[paper.id]?.concepts.length===1);
    const journal=app.state.history.find(record=>record.metadataPatches?.length);
    if(!journal)throw new Error('Native v0.5.0 metadata apply created no undo journal.');
    await app.invoke('undo',{id:journal.id});
    check('v050MetadataUndoRestoresEmptyField',!item.getField('abstractNote')&&item.getField('title')==='V050QA missing abstract'&&requests===1);
    result={realAIRequests:0,syntheticAIRequests:requests,metadataLookupAIRequests:0,metadataLookups,metadataApplyAndUndo:true,nativeTagWrites:0};
  }finally{
    if(manager&&!manager.closed)manager.close();ai.completeJson=oldComplete;host.lookupMetadata=oldLookup;
    if(item){host.mutating?.add(item.id);try{await item.eraseTx();}finally{host.mutating?.delete(item.id);}}
    app.state=before;await app.save();const navigator=Zotero.SmartTags.getNavigator(main);await navigator?.refresh();if(oldMode)await navigator?.setMode(oldMode);
  }
  return {...result,nativePackageUpgrade:await verifyNativePackageUpgrade(check,config)};
}
