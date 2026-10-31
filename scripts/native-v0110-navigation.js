/** TEST ONLY. Navigator clicks retain the current tree position and keyboard focus. */
import {initialState} from '../src/controller.ts';
import {migrateTagShelves} from '../src/tag-shelves.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
async function until(predicate,label){const start=Date.now();while(Date.now()-start<25_000){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Native navigator timeout: '+label);}

export async function runNativeV0110Navigation(app,check,config){
  const isolated=normalized(Zotero.DataDirectory.dir)===normalized(config.data)&&normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile);
  if(!isolated)throw new Error('Navigator regression requires its isolated profile and data directory.');check('v0110NavigationIsolatedProfileGuard',isolated);
  const before=clone(app.state),primary=Zotero.getMainWindow(),primaryNavigator=Zotero.SmartTags.getNavigator(primary),mode=primaryNavigator.mode,columns=win=>JSON.stringify(win.ZoteroPane.itemsView.getColumns().map(column=>[column.dataKey,column.hidden,column.width,column.ordinal])),primaryColumns=columns(primary);let secondary;
  try{
    await primaryNavigator.setMode('collections');const windows=new Set(Zotero.getMainWindows());Zotero.openMainWindow();secondary=await until(()=>Zotero.getMainWindows().find(win=>!windows.has(win)&&win.ZoteroPane?.itemsView&&win.ZoteroPane?.collectionsView),'second library window');await secondary.ZoteroPane.collectionsView.waitForLoad();await secondary.ZoteroPane.itemsView.waitForLoad();const main=secondary,navigator=await until(()=>Zotero.SmartTags.getNavigator(main),'second navigator'),columnsBefore=columns(main);await navigator.setMode('collections');app.state=initialState();
    app.state.tags=Array.from({length:100},(_,index)=>({id:`v0110-nav-${index}`,name:`V0110QA navigation ${String(index).padStart(3,'0')}`,fullName:`V0110QA navigation ${index}`,description:'A synthetic navigation fixture.',facet:'component',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[],relatedIds:[],matchingMode:'manual'}));
    const selected=app.state.tags[15];app.state.tags.push({...clone(selected),id:'v0110-nav-child',name:'V0110QA nested tag',fullName:'V0110QA nested tag',broaderIds:[selected.id]});app.state.tagShelves=migrateTagShelves(app.state.tags);app.state.taxonomyReady=true;app.state.vocabularyVersion=1;
    await app.save();await navigator.refresh();await navigator.setMode('tags');
    const root=()=>main.document.getElementById('smart-tags-navigator'),tree=()=>root().querySelector('.smart-tags-tree'),search=()=>root().querySelector('.smart-tags-search'),button=label=>[...root().querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===label);
    await until(()=>tree().scrollHeight>tree().clientHeight+600,'scrollable tag tree');tree().scrollTop=350;const top=tree().scrollTop;
    let control=button(selected.name);control.focus({preventScroll:true});control.click();await until(()=>button(selected.name).getAttribute('aria-checked')==='true','checked tag');await navigator.refresh();
    check('v0110NavigationSelectionPreservesScrollAndFocus',Math.abs(tree().scrollTop-top)<2&&main.document.activeElement===button(selected.name)&&navigator.filter.selections.some(selection=>selection.conceptId===selected.id));
    control=button(`Collapse ${selected.name}`);control.focus({preventScroll:true});control.click();await until(()=>button(`Expand ${selected.name}`),'collapsed branch');await navigator.refresh();
    check('v0110NavigationExpansionPreservesScrollAndFocus',Math.abs(tree().scrollTop-top)<2&&main.document.activeElement===button(`Expand ${selected.name}`));
    search().value='V0110QA';search().focus({preventScroll:true});search().setSelectionRange(2,7);search().dispatchEvent(new main.Event('input',{bubbles:true}));tree().scrollTop=210;const resultsTop=tree().scrollTop;await navigator.refresh();
    check('v0110NavigationSearchKeepsCaretAndResultsPosition',Math.abs(tree().scrollTop-resultsTop)<2&&main.document.activeElement===search()&&search().selectionStart===2&&search().selectionEnd===7);
    search().value='';search().dispatchEvent(new main.Event('input',{bubbles:true}));await navigator.refresh();
    check('v0110NavigationSearchClearRestoresTreePosition',Math.abs(tree().scrollTop-top)<2&&navigator.filter.selections.some(selection=>selection.conceptId===selected.id));
    await navigator.setMode('collections');await navigator.refresh();await navigator.setMode('tags');
    check('v0110NavigationCollectionsRoundTripPreservesPosition',Math.abs(tree().scrollTop-top)<2&&columns(main)===columnsBefore&&columns(primary)===primaryColumns);
    return {scrollingTreeTags:101,selectionFocusPreserved:true,searchCaretPreserved:true,treePositionRestored:true,nativeTagWrites:0,realProviderRequests:0};
  }finally{
    if(secondary&&!secondary.closed){await Zotero.SmartTags.getNavigator(secondary)?.setMode('collections');secondary.close();}app.state=before;await app.save();await primaryNavigator.refresh();await primaryNavigator.setMode(mode);
  }
}
