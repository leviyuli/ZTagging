/** TEST ONLY. Shelf browsing, legacy meaning recovery and reachable manager navigation. */
import {initialState} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import {normalizeFacts} from '../src/taxonomy.ts';
import {MY_TAGS_SHELF_ID} from '../src/tag-shelves.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
const button=(doc,label)=>[...doc.querySelectorAll('button')].find(control=>control.textContent===label||control.getAttribute('aria-label')===label);
async function until(predicate,label){const start=Date.now();while(Date.now()-start<25_000){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Native v0.13.1 timeout: '+label);}

export async function runNativeV0131(app,check,config){
  const isolated=normalized(Zotero.DataDirectory.dir)===normalized(config.data)&&normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile);
  if(!isolated)throw new Error('Manager browsing checks require their isolated profile and data directory.');
  check('v0131IsolatedProfileGuard',isolated);
  const before=clone(app.state),host=app.env.host,library=app.env.librarySnapshot,ai=app.env.ai,complete=ai.completeJson,hasKey=ai.hasApiKey,session=ai.getSession;
  const main=Zotero.getMainWindow(),navigator=Zotero.SmartTags.getNavigator(main),mode=navigator?.mode;
  const columns=()=>JSON.stringify(main.ZoteroPane.itemsView.getColumns().map(column=>[column.dataKey,column.hidden,column.width,column.ordinal])),columnsBefore=columns();
  let manager,dimensions,requests=0,nativeWrites=0,extractions=0,pdfReads=0,pointerClicks=0;
  const requestInputs=[];
  const ready=()=>until(()=>manager.document.getElementById('app')?.getAttribute('data-smart-tags-state')==='ready'&&!manager.document.querySelector('.busy-indicator'),'idle manager');
  const open=async page=>{if(manager&&!manager.closed)await ready();manager=await Zotero.SmartTags.openManager({page});await ready();return manager.document;};
  const clickControl=async control=>{
    const doc=manager.document,sidebar=control.closest('.sidebar');
    if(sidebar){const rect=control.getBoundingClientRect();if(rect.top<8)sidebar.scrollTop+=rect.top-8;else if(rect.bottom>manager.innerHeight-8)sidebar.scrollTop+=rect.bottom-manager.innerHeight+8;}
    else control.scrollIntoView({block:'nearest'});
    const rect=control.getBoundingClientRect(),x=(rect.left+rect.right)/2,y=(rect.top+rect.bottom)/2,hit=doc.elementFromPoint(x,y);
    if(control.disabled||x<0||x>manager.innerWidth||y<0||y>manager.innerHeight||!hit||!control.contains(hit))throw new Error('Manager control is covered or outside the window: '+(control.getAttribute('aria-label')||control.textContent));
    const events=manager.EventUtils??main.EventUtils;
    if(typeof events?.synthesizeMouseAtCenter==='function'){events.synthesizeMouseAtCenter(control,{},manager);pointerClicks++;}
    else{
      if(manager.PointerEvent)for(const type of ['pointerdown','pointerup'])control.dispatchEvent(new manager.PointerEvent(type,{bubbles:true,clientX:x,clientY:y,pointerId:1,pointerType:'mouse',isPrimary:true}));
      control.click();
    }
    await new Promise(resolve=>setTimeout(resolve,0));
  };
  const click=async label=>{await ready();const control=await until(()=>{const value=button(manager.document,label);return value&&!value.disabled?value:false;},'enabled '+label);await clickControl(control);};
  const choose=async(id,label)=>{await ready();await clickControl(manager.document.getElementById(id));const option=await until(()=>[...manager.document.querySelectorAll('[role="option"]')].find(control=>control.textContent===label||control.textContent.startsWith(label)),'option '+label);await clickControl(option);};
  const navigate=async(id,title)=>{await ready();await clickControl(manager.document.getElementById('nav-'+id));await until(()=>manager.document.querySelector('h1')?.textContent===title,'page '+title);};
  const headingVisible=()=>{const rect=manager.document.querySelector('h1').getBoundingClientRect();return manager.scrollY<2&&rect.top>=0&&rect.bottom<=manager.innerHeight;};
  const layout=()=>{
    const doc=manager.document,shell=doc.querySelector('.shell'),sidebar=doc.querySelector('.sidebar'),frame=doc.querySelector('.workspace-frame'),controls=doc.querySelector('.shelf-controls'),list=doc.querySelector('.tag-workspace-columns');
    const side=sidebar.getBoundingClientRect(),body=frame.getBoundingClientRect(),shelf=controls.getBoundingClientRect(),grid=list.getBoundingClientRect(),placeholder=doc.querySelector('.editor-placeholder');
    return manager.getComputedStyle(shell).display==='grid'&&manager.getComputedStyle(shell).gridTemplateColumns.split(' ').length===2&&side.width>=140&&side.left>=0&&side.right<=body.left+1&&body.right<=manager.innerWidth+2&&shelf.left>=side.right&&shelf.right<=manager.innerWidth+2&&grid.width>=shelf.width-2&&(!placeholder||manager.getComputedStyle(placeholder).display==='none')&&doc.documentElement.scrollWidth<=manager.innerWidth+2;
  };
  try{
    await navigator?.setMode('collections');app.state=initialState();
    Object.assign(app.state.settings,{provider:'deepseek',model:'native-v0131-synthetic',budgetUSD:10,inputPricePerMillion:1,outputPricePerMillion:1,maxOutputTokens:8192,autoAssign:false});
    const tags=Array.from({length:17},(_,index)=>({id:`v0131-saved-${index}`,name:`saved method ${String(index).padStart(2,'0')}`,fullName:`saved method ${String(index).padStart(2,'0')}`,description:`A preserved synthetic electrochemical measurement method numbered ${index}.`,facet:'method',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],custom:false,status:'approved',matchingMode:'auto'}));
    app.state.tags=clone(tags);app.state.taxonomyReady=true;app.state.vocabularyVersion=1;
    app.state.tagShelves=[{id:'v0131-first',name:'Generated tags 1',kind:'generated',tagIds:tags.slice(0,9).map(tag=>tag.id)},{id:'v0131-second',name:'Generated tags 2',kind:'generated',tagIds:tags.slice(9).map(tag=>tag.id)},{id:MY_TAGS_SHELF_ID,name:'My tags',kind:'user',tagIds:[]}];
    const papers=Array.from({length:17},(_,index)=>{const paper={id:`1:V0131-SHADOW-${index}`,itemID:913_100+index,libraryID:Zotero.Libraries.userLibraryID,key:`V0131S${index}`,title:`V0131QA retained battery experiment ${index}`,abstract:`Lithium-ion and lithium-metal battery systems store electrochemical energy in experiment ${index}.`,keywords:['battery'],fingerprint:''};paper.fingerprint=paperFingerprint(paper);return paper;});
    for(const [index,paper] of papers.entries()){
      app.state.papers[paper.id]=clone(paper);app.state.nativeTags[paper.id]=[{tag:tags[index].name,type:0},...(index<2?[{tag:'Batteries',type:0}]:[])];
      app.state.facts[paper.id]=normalizeFacts({summary:paper.abstract,needsPDF:false,concepts:[{name:'battery',facet:'system',evidence:[{source:'abstract',text:paper.abstract}]}]},paper,'retained','cached-extractor');
    }
    app.state.run={id:'v0131-earlier-build',kind:'rebuild',scope:'selected',automatic:false,status:'idle',jobs:papers.map(paper=>({id:'job-'+paper.id,paperId:paper.id,status:'completed'})),vocabCursor:17,vocabFinished:true,message:'Your earlier tag list is saved.',spentUSD:0.13,settings:clone(app.state.settings),vocabularyVersion:1};
    app.env.host={...host,async list(){return clone(papers);},async read(itemID){return clone(papers.find(paper=>paper.itemID===itemID)??null);},async readTags(itemID){return clone(app.state.nativeTags[papers.find(paper=>paper.itemID===itemID).id]);},async pdfText(){pdfReads++;throw new Error('Cached abstract evidence must not be read again.');},async apply(){nativeWrites++;throw new Error('Manager browsing and meanings cannot write native tags.');}};
    app.env.librarySnapshot=async()=>({papers:clone(papers),nativeTags:clone(app.state.nativeTags)});ai.hasApiKey=async()=>true;ai.getSession=async()=>({connected:false,sharing:false,email:null,accountId:null,accounts:[]});
    ai.completeJson=async(_system,prompt)=>{
      const input=JSON.parse(prompt.slice(prompt.lastIndexOf('INPUT_DATA_JSON:')+'INPUT_DATA_JSON:'.length));if(!input.workId){extractions++;throw new Error('No paper extraction is permitted.');}
      requests++;requestInputs.push(clone(input));
      const value={workId:input.workId,fingerprint:input.fingerprint,taskId:input.taskId,definitions:input.phase==='draft'?input.entries.map(entry=>requests===1?{entryId:entry.entryId,question:'Choose which chemistry Batteries means.'}:{entryId:entry.entryId,name:'battery',fullName:'battery',description:'Electrochemical battery systems across different battery chemistries.',facet:'system',aliases:[]}):[],judgments:requests===1?[]:input.papers.map(source=>({entryId:source.entryId,paperId:source.paperId,sourceFingerprint:source.sourceFingerprint,relation:'same-meaning',reason:'This paper directly describes battery systems across chemistries.',evidence:[{source:'abstract',text:source.paper.abstract}],supportFactConceptIds:[]}))};
      return {value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:20,outputTokens:20},estimatedCostUSD:0.00004};
    };
    const nativeBefore=fingerprint(app.state.nativeTags),factsBefore=fingerprint(app.state.facts),tagsBefore=fingerprint(app.state.tags);
    await app.invoke('prepare-tag-meanings',{names:['Batteries'],shelfId:MY_TAGS_SHELF_ID});await app.waitForIdle();
    const work=app.state.nativeDefinitionPreparation.work;work.protocolVersion=1;delete work.history;
    for(const entry of work.entries){entry.status='question';entry.question='Choose which chemistry Batteries means.';delete entry.questionDetails;delete entry.humanAnswer;delete entry.definition;delete entry.targetTagId;entry.judgments={};}
    work.status='ready';await app.save();
    let doc=await open('vocabulary');dimensions={width:manager.outerWidth,height:manager.outerHeight};
    manager.resizeTo(1440,1000);await until(()=>manager.innerWidth>1100&&manager.innerHeight>700,'wide manager');
    check('v0131ManagerResourcesUseInstalledVersion',manager.location.search.includes('v='+Zotero.SmartTags.version)&&[...doc.querySelectorAll('link[rel=stylesheet],script[src]')].every(resource=>new URL(resource.href||resource.src).searchParams.get('v')===Zotero.SmartTags.version));
    check('v0131DefaultLibraryBrowsesDespiteLegacyQuestion',!!doc.getElementById('vocabulary-search')&&!!button(doc,'Edit tag '+tags[0].name)&&!!button(doc,'Review meanings')&&!doc.querySelector('.native-meaning-panel'));
    check('v0131WideLibraryHasFullWidthListAndSeparateSidebar',layout(),{width:manager.innerWidth,height:manager.innerHeight,shell:manager.getComputedStyle(doc.querySelector('.shell')).gridTemplateColumns,shelf:manager.getComputedStyle(doc.querySelector('.shelf-controls')).gridTemplateColumns});

    const routes=[['overview','Your library, clearly tagged'],['connection','Connect AI'],['cleanup','Build tags'],['assignment','Assign & automate'],['vocabulary','Tag library'],['library','Explore your library'],['activity','Queue & history'],['settings','Settings']];
    for(const [size,width,height] of [['Wide',1440,1000],['Narrow',820,620]]){
      manager.resizeTo(width,height);await until(()=>Math.abs(manager.outerWidth-width)<30&&Math.abs(manager.outerHeight-height)<30,size+' dimensions');
      let scrolled=0;
      for(const [id,title] of routes){
        await navigate('settings','Settings');manager.scrollTo(0,Math.min(400,doc.scrollingElement.scrollHeight-manager.innerHeight));if(manager.scrollY>10)scrolled++;
        await navigate(id,title);if(!headingVisible())throw new Error('Navigation did not expose its page heading: '+id+' at '+size);
      }
      check(`v0131${size}SidebarRoutesAreHitTestedAndResetPageScroll`,scrolled===routes.length,{routes:routes.length,scrolled,pointerClicks});
      await navigate('vocabulary','Tag library');check(`v0131${size}LibraryReturnsToBrowsing`,layout()&&!!doc.getElementById('vocabulary-search')&&!doc.querySelector('.native-meaning-panel'));
    }

    await click('Review meanings');await until(()=>button(doc,'Suggest a meaning for Batteries'),'legacy row recovery action');
    check('v0131LegacyQuestionOffersAnActionInsteadOfAnUnanswerableChoice',!!doc.querySelector('.native-meaning-panel')&&!!button(doc,'Suggest a meaning for Batteries')&&!doc.querySelector('.native-meaning-panel').textContent.includes('Choose which chemistry')&&!button(doc,'Continue preparation'));
    await choose('tag-library-shelf','Generated tags 2');check('v0131ChangingShelfReturnsToSavedTags',!doc.querySelector('.native-meaning-panel')&&!!button(doc,'Edit tag '+tags[9].name)&&!!button(doc,'Review meanings'));
    await click('Review meanings');await choose('tag-library-status','Needs meaning');check('v0131ChangingReadinessReturnsToBrowsing',!doc.querySelector('.native-meaning-panel')&&!!doc.getElementById('vocabulary-search'));
    await choose('tag-library-shelf','All tags');await choose('tag-library-status','All tags');
    const list=doc.getElementById('tag-list-scroll');list.scrollTop=110;const listTop=list.scrollTop;await app.save();await until(()=>doc.getElementById('tag-list-scroll')!==list,'background list refresh');
    check('v0131BackgroundRefreshPreservesInnerListScroll',listTop>0&&Math.abs(doc.getElementById('tag-list-scroll').scrollTop-listTop)<2);
    await click('Edit tag '+tags[0].name);await until(()=>doc.getElementById('tag-editor-form'),'native editor drawer');
    const form=doc.getElementById('tag-editor-form'),advanced=form.querySelector('.editor-advanced');if(advanced)advanced.open=true;
    const draft='A preserved researcher draft for this synthetic electrochemical method.',description=doc.getElementById('tag-description');description.value=draft;description.dispatchEvent(new manager.Event('input',{bubbles:true}));form.scrollTop=form.scrollHeight;const editorTop=form.scrollTop;
    await app.save();await until(()=>doc.getElementById('tag-editor-form')!==form,'background editor refresh');
    const editor=doc.querySelector('.tag-editor'),footer=editor.querySelector('.editor-footer'),sidebar=doc.querySelector('.sidebar'),nav=doc.getElementById('nav-overview'),navRect=nav.getBoundingClientRect(),hit=doc.elementFromPoint((navRect.left+navRect.right)/2,(navRect.top+navRect.bottom)/2);
    check('v0131ShortDrawerKeepsDraftScrollFooterAndSidebarUsable',doc.getElementById('tag-description').value===draft&&editorTop>0&&Math.abs(doc.getElementById('tag-editor-form').scrollTop-editorTop)<2&&footer.getBoundingClientRect().bottom<=manager.innerHeight+2&&editor.getBoundingClientRect().left>=sidebar.getBoundingClientRect().right&&!!hit&&nav.contains(hit));
    await navigate('overview','Your library, clearly tagged');check('v0131SidebarClickClosesDrawerAndShowsNewPage',headingVisible()&&!doc.querySelector('.tag-editor'));
    await navigate('vocabulary','Tag library');await click('Review meanings');const beforeSuggest=requests;await click('Suggest a meaning for Batteries');await app.waitForIdle();await until(()=>button(doc,'Save 1 meaning')&&!button(doc,'Save 1 meaning').disabled,'recovered broad battery meaning');
    check('v0131SuggestMeaningRecoversLegacyWorkWithoutRepeatedExtraction',requests===beforeSuggest+1&&requestInputs.at(-1).protocolVersion===2&&requestInputs.at(-1).entries.every(entry=>entry.sourceName==='Batteries')&&app.state.nativeDefinitionPreparation.work.history.some(revision=>revision.protocolVersion===1)&&extractions===0&&pdfReads===0);
    await click('Save 1 meaning');await app.waitForIdle();await until(()=>button(doc,'Done'),'recovered meaning saved');await click('Done');await until(()=>!!doc.getElementById('vocabulary-search')&&!doc.querySelector('.native-meaning-panel')&&!doc.querySelector('.busy-indicator'),'finished review returns to browsing');
    check('v0131RecoveredMeaningSavesWithoutChangingLibraryPapers',app.state.tags.some(tag=>tag.name==='battery'&&tag.aliases.includes('Batteries'))&&fingerprint(app.state.tags.filter(tag=>tags.some(saved=>saved.id===tag.id)))===tagsBefore&&fingerprint(app.state.nativeTags)===nativeBefore&&fingerprint(app.state.facts)===factsBefore&&nativeWrites===0&&columns()===columnsBefore&&!app.state.settings.autoAssign&&!!doc.getElementById('vocabulary-search')&&!doc.querySelector('.native-meaning-panel'));
    return {retainedPapers:papers.length,savedTags:tags.length,syntheticRequests:requests,pdfReads,extractionRequests:extractions,nativeTagWrites:nativeWrites,sidebarRoutes:routes.length,viewports:2,realPointerClicks:pointerClicks,realProviderRequests:0};
  }finally{
    if(app.state.run?.status==='running')await app.invoke('pause');await app.waitForIdle();if(manager&&!manager.closed){if(dimensions)manager.resizeTo(dimensions.width,dimensions.height);manager.close();}
    app.env.host=host;app.env.librarySnapshot=library;ai.completeJson=complete;ai.hasApiKey=hasKey;ai.getSession=session;app.state=before;await app.save();await navigator?.refresh();if(mode)await navigator?.setMode(mode);
  }
}
