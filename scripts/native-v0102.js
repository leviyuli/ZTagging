/** TEST ONLY. Cached tag progress stays dormant while a new paper group is read. */
import {initialState} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import {createRegistrySnapshot} from '../src/evidence.ts';
import {normalizeFacts} from '../src/taxonomy.ts';
import {createTagSelection,nextSelectionRequests,noteSelectionDispatch,acceptSelectionResult} from '../src/tag-selection.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
const data=prompt=>JSON.parse(prompt.slice(prompt.lastIndexOf('INPUT_DATA_JSON:')+'INPUT_DATA_JSON:'.length));
async function until(predicate,label){const start=Date.now();while(Date.now()-start<25_000){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Native v0.10.2 timeout: '+label);}

export async function runNativeV0102(app,check,config){
  const isolated=normalized(Zotero.DataDirectory.dir)===normalized(config.data)&&normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile);
  if(!isolated)throw new Error('Native v0.10.2 requires its isolated profile and data directory.');check('v0102IsolatedProfileGuard',isolated);
  const before=clone(app.state),host=app.env.host,library=app.env.librarySnapshot,ai=app.env.ai,complete=ai.completeJson,session=ai.getSession,hasKey=ai.hasApiKey;
  const main=Zotero.getMainWindow(),navigator=Zotero.SmartTags.getNavigator(main),mode=navigator?.mode,columns=()=>JSON.stringify(main.ZoteroPane.itemsView.getColumns().map(column=>[column.dataKey,column.hidden,column.width,column.ordinal])),columnsBefore=columns();
  let manager,release,entered,writes=0,providerRequests=0;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  try{
    await navigator?.setMode('collections');app.state=initialState();Object.assign(app.state.settings,{provider:'chatgpt',model:'native-v0102-synthetic',autoAssign:false,maxOutputTokens:4096,coreConceptLimit:2});
    const papers=Array.from({length:4},(_,index)=>{const paper={id:`1:V0102-SHADOW-${index}`,itemID:910_200+index,libraryID:Zotero.Libraries.userLibraryID,key:`V0102S${index}`,title:`V0102QA material study ${index}`,abstract:'Measurements establish interfacial resistance in this experimental device.',keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);return paper;});
    const old=papers[0],selected=papers.slice(1);app.state.papers[old.id]=clone(old);app.state.nativeTags[old.id]=[{tag:'V0102 manual project',type:0}];app.state.facts[old.id]=normalizeFacts({summary:'A retained interfacial resistance measurement.',needsPDF:false,concepts:[{name:'interfacial resistance',facet:'phenomenon',evidence:[{source:'abstract',text:old.abstract}]}]},old,'retained-synthetic','retained-model');
    const facts=Object.values(app.state.facts),existing=app.consolidationDefinitions(),snapshot=createRegistrySnapshot(facts,app.state.evidenceCatalog);let work=createTagSelection(facts,existing,snapshot,{plannerVersion:4,targetCount:2,maxOutputTokens:4096,baseVersion:0});
    while(work.status!=='ready'){
      const request=nextSelectionRequests(work,1)[0];if(!request)throw new Error('Synthetic cached selection did not finish.');const input=data(request.prompt),reply=input.selectionPhase==='choosing'?{tags:[{key:'resistance',name:'interfacial resistance',fullName:'interfacial resistance',description:'Interfacial electrical resistance in an experimental device.',facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],routingRefs:['R1']}]}:{judgements:input.requestedPairs.map(pair=>({pairRef:pair.pairRef,relation:'equivalent',reason:'The exact supplied quotation establishes this phenomenon.'}))};
      work=acceptSelectionResult(noteSelectionDispatch(work,request.id),request.id,reply,{provider:'retained-synthetic',model:'retained-model'});
    }
    const cachedFingerprint=fingerprint(work),factsBefore=fingerprint(app.state.facts);app.state.run={id:'native-v0102-cached',kind:'rebuild',scope:'library',automatic:false,status:'idle',jobs:[{id:'old-job',paperId:old.id,status:'completed'}],vocabCursor:1,vocabFinished:true,message:'Your suggested tags are ready.',spentUSD:0.25,settings:clone(app.state.settings),vocabularyVersion:0,buildMode:'replace',selection:work,selectionInputFingerprint:fingerprint({protocolVersion:2,facts,existing,limit:2,baseVersion:0,buildMode:'replace'})};
    app.env.host={...host,async list(){return clone(selected);},async read(itemID){if(itemID===selected[0].itemID){entered();await gate;}return clone(papers.find(paper=>paper.itemID===itemID)??null);},async readTags(){return [{tag:'V0102 manual project',type:0}];},async pdfText(){throw new Error('The paused reading check cannot extract a PDF.');},async apply(){writes++;throw new Error('The reading check cannot change native tags.');}};
    app.env.librarySnapshot=async()=>({papers:clone(papers),nativeTags:Object.fromEntries(papers.map(paper=>[paper.id,[{tag:'V0102 manual project',type:0}]]))});ai.hasApiKey=async()=>true;ai.getSession=async()=>({connected:true,sharing:true,email:null,accountId:'native-synthetic',accounts:[]});ai.completeJson=async()=>{providerRequests++;throw new Error('The first read must pause before any provider request.');};
    await app.save();await app.invoke('prepare-tags',{scope:'selected',mode:'replace'});await started;const reading=await app.snapshot();
    check('v0102NewGroupHasOnlyCurrentReadingProgress',reading.queue.phase==='reading'&&reading.queue.total===3&&reading.queue.completed===0&&!reading.queue.selection&&!app.state.run.selection&&fingerprint(app.state.run.cachedSelection?.work)===cachedFingerprint&&providerRequests===0);
    manager=await Zotero.SmartTags.openManager({page:'activity'});await until(()=>manager.document.getElementById('app')?.getAttribute('data-smart-tags-state')==='ready'&&manager.document.body.textContent.includes('Papers read: 0 of 3'),'current reading DOM');
    const noOldProgress=()=>!['Tags prepared:','Examples checked:','Tag selection repairs:','Source check corrections:','Additional correction requests:'].some(label=>manager.document.body.textContent.includes(label));
    check('v0102ActivityHidesDormantSelectionProgress',noOldProgress()&&manager.document.body.textContent.includes('Reading papers'));
    await app.invoke('pause');release();await app.waitForIdle();await until(()=>manager.document.body.textContent.includes('Reading papers · paused'),'paused reading DOM');
    check('v0102PauseKeepsReadingPhaseAndDormantCache',noOldProgress()&&manager.document.body.textContent.includes('Papers read: 0 of 3')&&app.state.run.status==='paused'&&!app.state.run.selection&&fingerprint(app.state.run.cachedSelection?.work)===cachedFingerprint);
    await app.invoke('cancel');await app.waitForIdle();check('v0102CancelKeepsCachedFactsNativeDataAndColumns',app.state.run.status==='idle'&&fingerprint(app.state.facts)===factsBefore&&providerRequests===0&&writes===0&&columns()===columnsBefore);
    return {cachedPapers:1,currentPaperGroup:3,providerRequests,nativeTagWrites:writes,dormantSelectionHidden:true};
  }finally{
    release();if(app.state.run?.status==='running')await app.invoke('pause');await app.waitForIdle();if(manager&&!manager.closed)manager.close();app.env.host=host;app.env.librarySnapshot=library;ai.completeJson=complete;ai.getSession=session;ai.hasApiKey=hasKey;app.state=before;await app.save();await navigator?.refresh();if(mode)await navigator?.setMode(mode);
  }
}
