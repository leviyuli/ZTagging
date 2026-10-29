/** TEST ONLY. Compact attention controls in the guarded isolated profile. */
import { initialState } from '../src/controller.ts';
import { normalizeFacts } from '../src/taxonomy.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
async function until(predicate,label){const started=Date.now();while(Date.now()-started<20_000){const result=predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error('Native v0.5.2 timeout: '+label);}

export async function runNativeV052(app,check,config){
  check('v052IsolatedDataGuard',normalized(Zotero.DataDirectory.dir)===normalized(config.data));
  check('v052IsolatedProfileGuard',normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile));
  const before=clone(app.state),host=app.env.host,ai=app.env.ai,complete=ai.completeJson,main=Zotero.getMainWindow(),mode=Zotero.SmartTags.getNavigator(main)?.mode,items=[];
  let manager,requests=0;
  try{
    await Zotero.SmartTags.getNavigator(main)?.setMode('collections');
    ai.completeJson=async()=>{requests++;throw new Error('Attention layout checks must not call a provider.');};
    app.state=initialState();app.state.tags=[];app.state.settings.model='';
    for(let i=0;i<2;i++){
      const item=new Zotero.Item('journalArticle');item.libraryID=Zotero.Libraries.userLibraryID;item.setField('title',`V052QA paper needing information ${i+1} ${'filename_'.repeat(15)}`);await item.saveTx();items.push(item);
      const paper=await host.read(item.id);app.state.papers[paper.id]=paper;app.state.nativeTags[paper.id]=[];app.state.facts[paper.id]=normalizeFacts({summary:'Missing metadata.',concepts:[],needsPDF:true},paper,'native-synthetic','native-v052');
    }
    await app.save();manager=await Zotero.SmartTags.openManager({page:'activity'});
    await until(()=>manager.document.getElementById('app')?.getAttribute('data-smart-tags-state')==='ready','manager ready');const doc=manager.document;
    await until(()=>doc.querySelectorAll('.paper-attention-row').length===2,'two paper rows');
    const section=()=>doc.querySelector('.paper-attention-list').closest('section');
    check('v052RowsKeepOneRecoveryAndMore', [...doc.querySelectorAll('.paper-attention-row')].every(row=>row.querySelectorAll('.attention-row-actions > button').length===2)&&!doc.querySelector('.attention-bulk-bar'));
    check('v052LongTitlesStayInsideTheirColumn',[...doc.querySelectorAll('.paper-attention-row')].every(row=>row.querySelector('.paper-title-button').getBoundingClientRect().right<=row.querySelector('.attention-row-content').getBoundingClientRect().right+1));
    check('v052NoZeroQueueOrFooterClutter',!section().querySelector('.card-footer')&&!section().textContent.includes('0 papers queued')&&!section().textContent.includes('Each paper appears once'));
    doc.getElementById('attention-select-page').click();
    check('v052BulkActionsOnlyAfterSelection',!!doc.querySelector('.attention-bulk-bar')&&doc.querySelector('.attention-bulk-bar').textContent.includes('2 selected'));
    const trigger=doc.getElementById('attention-bulk-actions');trigger.click();await until(()=>doc.querySelector('[role="menu"]'),'action menu opened');
    check('v052ActionsUseAccessibleMenu',trigger.getAttribute('aria-haspopup')==='menu'&&!!doc.querySelector('[role="menu"]')&&doc.activeElement?.getAttribute('role')==='menuitem');
    const menuBounds=doc.querySelector('[role="menu"]').getBoundingClientRect();
    check('v052MenuStaysInsideWindow',menuBounds.left>=0&&menuBounds.top>=0&&menuBounds.right<=manager.innerWidth&&menuBounds.bottom<=manager.innerHeight);
    doc.activeElement.dispatchEvent(new manager.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    check('v052EscapeClosesAndRestoresFocus',!doc.querySelector('[role="menu"]')&&doc.activeElement===trigger);
    const search=doc.getElementById('attention-search');search.value='V052QA no matching paper';search.dispatchEvent(new manager.Event('input',{bubbles:true}));
    check('v052EmptyViewHasNoSelectionOrPager',!doc.querySelector('.paper-attention-row')&&!doc.querySelector('.attention-bulk-bar')&&!doc.getElementById('attention-select-page')&&!section().querySelector('.pagination')&&section().textContent.includes('No matching papers'));
    const cleared=doc.getElementById('attention-search');cleared.value='';cleared.dispatchEvent(new manager.Event('input',{bubbles:true}));
    check('v052FilteringClearsHiddenSelections',!doc.querySelector('.attention-bulk-bar')&&[...doc.querySelectorAll('.paper-attention-row input')].every(control=>!control.checked));
    check('v052LayoutChecksNeedNoProvider',requests===0);
    return {rows:2,emptyControlsHidden:true,selectionOnlyActions:true,keyboardMenu:true,realAIRequests:0};
  }finally{
    if(manager&&!manager.closed)manager.close();ai.completeJson=complete;
    for(const item of items){host.mutating?.add(item.id);try{await item.eraseTx();}finally{host.mutating?.delete(item.id);}}
    app.state=before;await app.save();const navigator=Zotero.SmartTags.getNavigator(main);await navigator?.refresh();if(mode)await navigator?.setMode(mode);
  }
}
