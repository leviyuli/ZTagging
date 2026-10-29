/** TEST ONLY. Attention dismissal and reversible no_tag marks in the exact isolated profile. */
import { initialState } from '../src/controller.ts';
import { normalizeFacts } from '../src/taxonomy.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
const button=(doc,label)=>[...doc.querySelectorAll('button')].find(value=>value.textContent===label||value.getAttribute('aria-label')===label);
async function until(predicate,label){const started=Date.now();while(Date.now()-started<20_000){const result=predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error('Native v0.5.1 timeout: '+label);}

export async function runNativeV051(app,check,config){
  check('v051IsolatedDataGuard',normalized(Zotero.DataDirectory.dir)===normalized(config.data));
  check('v051IsolatedProfileGuard',normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile));
  const before=clone(app.state),host=app.env.host,ai=app.env.ai,oldComplete=ai.completeJson,main=Zotero.getMainWindow(),originalMode=Zotero.SmartTags.getNavigator(main)?.mode;
  let item,manager,secondary,requests=0;
  const click=async(doc,label)=>{const control=button(doc,label);if(!control||control.disabled)throw new Error('Native v0.5.1 missing enabled control: '+label);control.click();await new Promise(resolve=>setTimeout(resolve,0));await until(()=>!button(doc,label)?.disabled,'action '+label);};
  try{
    await Zotero.SmartTags.getNavigator(main)?.setMode('collections');
    ai.completeJson=async()=>{requests++;throw new Error('V051QA manual exclusion must not call an AI provider.');};
    app.state=initialState();app.state.tags=[];app.state.settings={...before.settings,model:'',autoAssign:false};
    item=new Zotero.Item('journalArticle');item.libraryID=Zotero.Libraries.userLibraryID;item.setField('title','V051QA paper outside tagging scope');item.setTags([{tag:'V051 manual project',type:0},{tag:'V051 original keyword',type:1}]);await item.saveTx();
    const paper=await host.read(item.id),nativeBefore=JSON.stringify(item.getTags());app.state.papers[paper.id]=paper;app.state.nativeTags[paper.id]=item.getTags();app.state.facts[paper.id]=normalizeFacts({summary:'No scientific concepts were established.',concepts:[],needsPDF:true},paper,'native-synthetic','native-v051');await app.save();
    await app.invoke('recheck-paper-inputs',{id:paper.id});manager=await Zotero.SmartTags.openManager({page:'activity'});
    await until(()=>manager.document.getElementById('app')?.getAttribute('data-smart-tags-state')==='ready','manager final document ready');const doc=manager.document;
    try{await until(()=>doc.querySelector('.paper-attention-row')&&button(doc,'Dismiss'),'attention controls');}
    catch(error){const attention=(await app.snapshot()).paperAttention?.papers.find(value=>value.id===paper.id);throw new Error(error.message+' '+JSON.stringify({documentURI:doc.documentURI,appState:doc.getElementById('app')?.getAttribute('data-smart-tags-state'),visibleRows:doc.querySelectorAll('.paper-attention-row').length,fixtureStatus:attention?.status,fixtureDismissible:attention?.canDismiss}));}
    await click(doc,'Dismiss');
    await until(()=>!doc.getElementById('attention-'+paper.id),'dismissed condition hidden');
    check('v051DismissPreservesLibraryAndEligibility',JSON.stringify(item.getTags())===nativeBefore&&!item.deleted&&!app.state.tags.some(tag=>tag.name==='no_tag')&&requests===0);
    host.mutating?.add(item.id);try{item.setField('abstractNote','New metadata is available for another evidence check.');await item.saveTx();}finally{host.mutating?.delete(item.id);}
    await app.invoke('recheck-paper-inputs',{id:paper.id});await until(()=>doc.getElementById('attention-'+paper.id),'changed condition visible');
    check('v051ChangedConditionReturnsAfterDismissal',!!button(doc,'Dismiss')&&requests===0);
    await click(doc,'Exclude from tagging');await until(()=>button(doc,'Apply no_tag and exclude'),'exclusion preview');
    check('v051ExclusionPreviewIsReadOnly',JSON.stringify(item.getTags())===nativeBefore&&doc.body.textContent.includes('V051 manual project')&&doc.body.textContent.includes('no_tag')&&requests===0);
    await click(doc,'Cancel exclusion change');await until(()=>!button(doc,'Apply no_tag and exclude'),'preview cancelled');
    check('v051CancelledExclusionChangesNothing',JSON.stringify(item.getTags())===nativeBefore&&requests===0);
    await click(doc,'Exclude from tagging');await until(()=>button(doc,'Apply no_tag and exclude'),'new exclusion preview');await click(doc,'Apply no_tag and exclude');
    await until(()=>item.getTags().some(tag=>tag.tag==='no_tag'),'native no_tag applied');
    const exclusion=app.state.history[0];
    check('v051ManualExclusionPreservesExistingTagTypes',item.getTags().filter(tag=>tag.tag!=='no_tag').length===2&&JSON.stringify(item.getTags().filter(tag=>tag.tag!=='no_tag'))===nativeBefore&&!item.deleted&&requests===0);
    doc.getElementById('attention-status').click();doc.getElementById('attention-status-option-6').click();await until(()=>button(doc,'Include again'),'excluded view');
    check('v051ExcludedViewHasIncludeInsteadOfRetry',!!doc.getElementById('attention-'+paper.id)&&!button(doc,'Retry analysis')&&!!button(doc,'Include again'));

    const previousWindows=new Set(Zotero.getMainWindows());Zotero.openMainWindow();secondary=await until(()=>Zotero.getMainWindows().find(win=>!previousWindows.has(win)&&win.ZoteroPane?.itemsView&&win.ZoteroPane?.collectionsView),'standalone filter window');
    await secondary.ZoteroPane.collectionsView.waitForLoad();await secondary.ZoteroPane.itemsView.waitForLoad();const navigator=await until(()=>Zotero.SmartTags.getNavigator(secondary),'secondary navigator');await navigator.setMode('collections');
    await secondary.ZoteroPane.collectionsView.selectLibrary(Zotero.Libraries.userLibraryID);await secondary.ZoteroPane.onCollectionSelected();await secondary.ZoteroPane.itemsView.waitForLoad();
    secondary.document.getElementById('zotero-tb-search').searchTextbox.value='';await secondary.ZoteroPane.itemsView.setFilter('search','');secondary.ZoteroPane.tagSelector.selectedTags=new Set();secondary.ZoteroPane.tagSelector.forceUpdate();await secondary.ZoteroPane.itemsView.setFilter('tags',new Set());
    const columns=JSON.stringify(secondary.ZoteroPane.itemsView.getColumns().map(column=>[column.dataKey,column.hidden,column.width,column.ordinal]));await navigator.refresh();await navigator.setMode('tags');
    const noTag=secondary.document.querySelector('#smart-tags-navigator [aria-label="no_tag"]');check('v051BuiltinFilterAvailableWithoutVocabulary',!!noTag&&!secondary.document.getElementById('smart-tags-navigator').textContent.includes('Shared details'));
    noTag.click();await until(()=>secondary.ZoteroPane.itemsView.getSortedItems(true).includes(item.id),'native no_tag retrieval');
    check('v051NativeNoTagFilterKeepsColumns',JSON.stringify(secondary.ZoteroPane.itemsView.getColumns().map(column=>[column.dataKey,column.hidden,column.width,column.ordinal]))===columns&&requests===0);
    await navigator.setMode('collections');secondary.close();secondary=null;main.focus();

    await app.invoke('undo',{id:exclusion.id});check('v051ExclusionUndoRestoresExactNativeTags',JSON.stringify(item.getTags())===nativeBefore&&requests===0);
    await app.invoke('preview-paper-exclusion',{ids:[paper.id],exclude:true});await app.invoke('apply-paper-exclusion',{previewId:(await app.snapshot()).paperExclusionPreview.id});await until(()=>button(doc,'Include again'),'excluded paper after second mark');await click(doc,'Include again');await until(()=>button(doc,'Apply inclusion'),'include review');
    check('v051IncludePreviewLeavesMarkUntilApply',item.getTags().some(tag=>tag.tag==='no_tag')&&requests===0);await click(doc,'Apply inclusion');await until(()=>!item.getTags().some(tag=>tag.tag==='no_tag'),'included paper');
    check('v051IncludeAgainPreservesAllOtherTags',JSON.stringify(item.getTags())===nativeBefore&&!item.deleted&&requests===0);
    return {realAIRequests:0,manualExclusionAndUndo:true,dismissalRecurrence:true,standaloneNativeFilter:true,existingNativeTagsPreserved:true};
  }finally{
    if(secondary&&!secondary.closed){await Zotero.SmartTags.getNavigator(secondary)?.setMode('collections');secondary.close();}
    if(manager&&!manager.closed)manager.close();ai.completeJson=oldComplete;
    if(item){host.mutating?.add(item.id);try{await item.eraseTx();}finally{host.mutating?.delete(item.id);}}
    app.state=before;await app.save();const navigator=Zotero.SmartTags.getNavigator(main);await navigator?.refresh();if(originalMode)await navigator?.setMode(originalMode);
  }
}
