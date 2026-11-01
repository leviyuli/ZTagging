/** TEST ONLY. Automatic additions and nonblocking review in an isolated native manager. */
import {initialState} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import {failNativeTagDefinitionTask} from '../src/native-tag-definition.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
const button=(doc,label)=>[...doc.querySelectorAll('button')].find(control=>control.textContent===label||control.getAttribute('aria-label')===label);
async function until(predicate,label){const start=Date.now();while(Date.now()-start<25_000){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Automatic native smoke timeout: '+label);}

export async function runNativeAutomaticWorkflow(app,check,config){
  check('automaticIsolatedProfileAndData',normalized(Zotero.DataDirectory.dir)===normalized(config.data)&&normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile));
  if(config.previewXpi){
    const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs'),file=Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);file.initWithPath(config.previewXpi);
    const installed=await AddonManager.getAddonByID('smart-tags@zotero-local.org'),install=await AddonManager.getInstallForFile(file);
    check('secondaryPreviewPackageMetadata',install.addon?.id==='smart-tags@zotero-local.org'&&install.addon.version===config.previewVersion,{version:install.addon?.version,error:install.error});
    check('secondaryPreviewVersionOrdersCorrectly',Services.vc.compare(config.previewVersion,'1.0.0')>0&&Services.vc.compare(config.previewVersion,'1.0.1')<0);
    check('secondaryPreviewInspectionDoesNotInstall',(await AddonManager.getAddonByID('smart-tags@zotero-local.org'))?.version===installed?.version);
  }
  const before=clone(app.state),host=app.env.host,library=app.env.librarySnapshot,ai=app.env.ai,complete=ai.completeJson,hasKey=ai.hasApiKey,session=ai.getSession,testConnection=ai.testConnection;
  const main=Zotero.getMainWindow(),navigator=Zotero.SmartTags.getNavigator(main),mode=navigator?.mode;
  const columns=()=>JSON.stringify(main.ZoteroPane.itemsView.getColumns().map(column=>[column.dataKey,column.hidden,column.width,column.ordinal])),columnsBefore=columns();
  let manager,inputProcessor,requests=0,assignmentRequests=0,definitionRequests=0,connectionRequests=0,localRechecks=0,nativeWrites=0,pointerActions=0,keyboardActions=0,batteryChecks=0,batteryCheckpoint,batteryReply,batteryProgressScreenshot;
  const ready=async()=>{
    let rendered,stableSince=Date.now();
    return until(()=>{
      const app=manager.document.getElementById('app'),current=app?.firstElementChild;
      if(current!==rendered){rendered=current;stableSince=Date.now();}
      return app?.getAttribute('data-smart-tags-state')==='ready'&&!manager.document.querySelector('.busy-indicator')&&Date.now()-stableSince>=100;
    },'manager idle after queued snapshots');
  };
  const open=async page=>{if(manager&&!manager.closed)await ready();manager=await Zotero.SmartTags.openManager({page});await ready();return manager.document;};
  const clickControl=async control=>{
    if(!control||control.disabled)throw new Error('Missing or disabled native control.');
    control.scrollIntoView({block:'nearest'});const rect=control.getBoundingClientRect(),x=(rect.left+rect.right)/2,y=(rect.top+rect.bottom)/2,hit=manager.document.elementFromPoint(x,y);
    if(x<0||y<0||x>manager.innerWidth||y>manager.innerHeight||!hit||!control.contains(hit))throw new Error('Native control is covered or out of view: '+(control.getAttribute('aria-label')||control.textContent));
    const events=manager.EventUtils??main.EventUtils;
    if(typeof events?.synthesizeMouseAtCenter==='function')events.synthesizeMouseAtCenter(control,{},manager);else control.click();
    pointerActions++;await new Promise(resolve=>setTimeout(resolve,0));
  };
  const click=async label=>{await ready();await clickControl(await until(()=>{const value=button(manager.document,label);return value&&!value.disabled?value:false;},'enabled '+label));};
  const choose=async(id,label)=>{await ready();await clickControl(manager.document.getElementById(id));await clickControl(await until(()=>[...manager.document.querySelectorAll('[role="option"]')].find(control=>control.textContent===label||control.textContent.startsWith(label)),'option '+label));};
  const key=(control,value,modifiers={})=>{
    manager.focus();control.focus();inputProcessor??=Cc['@mozilla.org/text-input-processor;1'].createInstance(Ci.nsITextInputProcessor);
    if(!inputProcessor.beginInputTransactionForTests(manager))throw new Error('Cannot begin native keyboard input for the isolated manager.');
    const codes={Enter:13,Escape:27,ArrowDown:40,ArrowUp:38,Home:36,End:35,Control:17,Meta:91};
    const event=name=>new manager.KeyboardEvent('',{key:name,code:name.length===1?'Key'+name.toUpperCase():name==='Control'?'ControlLeft':name==='Meta'?'MetaLeft':name,keyCode:codes[name]??name.toUpperCase().charCodeAt(0)});
    const held=Object.entries(modifiers).filter(([,active])=>active).map(([name])=>name==='ctrlKey'?'Control':'Meta');
    for(const name of held)inputProcessor.keydown(event(name),inputProcessor.KEY_NON_PRINTABLE_KEY);
    const flags=value.length===1?0:inputProcessor.KEY_NON_PRINTABLE_KEY;
    try{inputProcessor.keydown(event(value),flags);inputProcessor.keyup(event(value),flags);}
    finally{for(const name of held.reverse())inputProcessor.keyup(event(name),inputProcessor.KEY_NON_PRINTABLE_KEY);}
    keyboardActions++;
  };
  const resize=async(width,height)=>{manager.resizeTo(width,height);await until(()=>Math.abs(manager.outerWidth-width)<25&&Math.abs(manager.outerHeight-height)<25,'manager '+width+'×'+height);await new Promise(resolve=>manager.requestAnimationFrame(resolve));};
  const inViewport=control=>{if(!control)return false;const rect=control.getBoundingClientRect();return rect.width>0&&rect.height>0&&rect.left>=0&&rect.top>=0&&rect.right<=manager.innerWidth+2&&rect.bottom<=manager.innerHeight+2;};
  const setInput=(id,value)=>{const control=manager.document.getElementById(id);control.value=value;control.dispatchEvent(new manager.Event('input',{bubbles:true}));return control;};
  const assignmentSetup=async()=>{const doc=await open('assignment');if(!doc.getElementById('start-assignment'))await clickControl(doc.getElementById('assignment-setup-toggle'));await until(()=>doc.getElementById('start-assignment'),'assignment setup controls');return doc;};
  const capture=async(name,target)=>{
    if(target)target.scrollIntoView({block:'start'});else manager.scrollTo(0,0);await new Promise(resolve=>manager.requestAnimationFrame(()=>manager.requestAnimationFrame(resolve)));
    const canvas=manager.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=manager.innerWidth;canvas.height=manager.innerHeight;
    const context=canvas.getContext('2d');
    if(typeof context?.drawWindow!=='function')return {captured:false,reason:'Native drawWindow is unavailable; inspect the isolated window with the desktop screenshot tool.'};
    context.drawWindow(manager,manager.scrollX,manager.scrollY,canvas.width,canvas.height,manager.getComputedStyle(manager.document.body).backgroundColor);
    const encoded=canvas.toDataURL('image/png').split(',')[1],bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0)),path=PathUtils.join(config.root,'build',name+'.png');
    await IOUtils.write(path,bytes);return {captured:true,path,width:canvas.width,height:canvas.height};
  };
  try{
    await navigator?.setMode('collections');app.state=initialState();
    Object.assign(app.state.settings,{provider:'deepseek',model:'native-automatic-synthetic',budgetUSD:10,inputPricePerMillion:1,outputPricePerMillion:1,maxOutputTokens:8192,autoAssign:false});
    app.state.models=['native-automatic-synthetic','native-automatic-alternative'];
    const tag={id:'native-auto-transport',name:'proton transport',fullName:'proton transport',description:'Proton transport studied in membrane experiments.',facet:'phenomenon',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],custom:false,status:'approved',matchingMode:'auto'};
    app.state.tags=[tag];app.state.taxonomyReady=true;app.state.vocabularyVersion=1;app.state.tagShelves=[{id:'native-auto-shelf',name:'Membrane topics',kind:'generated',tagIds:[tag.id]}];
    const abstracts=['Experiments directly measure proton transport through a membrane using impedance spectroscopy.','The experiment discusses a possible role for proton transport without establishing its contribution.','Magnetic spin textures were measured in a solid-state material outside membrane electrochemistry.'];
    const papers=abstracts.map((abstract,index)=>{const paper={id:`1:AUTO-SHADOW-${index}`,itemID:914_000+index,libraryID:Zotero.Libraries.userLibraryID,key:`AUTOS${index}`,title:`Automatic workflow synthetic paper ${index+1}`,abstract,keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);return paper;});
    const native=Object.fromEntries(papers.map((paper,index)=>[paper.id,[{tag:'Manual project',type:0},...(index===0?[{tag:'Membrane tests',type:0}]:[])]]));
    for(const paper of papers){app.state.papers[paper.id]=clone(paper);app.state.nativeTags[paper.id]=clone(native[paper.id]);}
    app.env.host={...host,async list(){return clone(papers);},async read(itemID){return clone(papers.find(paper=>paper.itemID===itemID)??null);},async readTags(itemID){return clone(native[papers.find(paper=>paper.itemID===itemID).id]);},async pdfText(){throw new Error('These synthetic abstracts need no PDF request.');},async apply(patches){nativeWrites++;for(const patch of patches){if(fingerprint(native[patch.paperId])!==fingerprint(patch.before))throw new Error('Synthetic native tags changed outside their journal.');native[patch.paperId]=clone(patch.after);}}};
    app.env.librarySnapshot=async()=>({papers:clone(papers),nativeTags:clone(native)});ai.hasApiKey=async()=>true;ai.getSession=async()=>({connected:false,sharing:false,email:null,accountId:null,accounts:[]});
    ai.testConnection=async()=>{requests++;connectionRequests++;return {value:{ok:true},text:'{"ok":true}',usageKnown:true,usage:{inputTokens:5,outputTokens:5},estimatedCostUSD:0.00001};};
    ai.completeJson=async(_system,prompt)=>{
      const input=JSON.parse(prompt.slice(prompt.lastIndexOf('INPUT_DATA_JSON:')+'INPUT_DATA_JSON:'.length));requests++;let value;
      if(input.approvedVocabulary){
        assignmentRequests++;const index=papers.findIndex(paper=>paper.title===input.paper.title);
        value=index===2?{summary:'A magnetic-material experiment.',concepts:[],needsPDF:false,suggestions:[],noMatch:true,noMatchReason:'The supplied list does not describe magnetic spin textures.',noMatchEvidence:[{source:'abstract',text:input.paper.abstract}],newTagCandidates:[]}:{summary:'A membrane transport experiment.',concepts:[],needsPDF:false,newTagCandidates:[],suggestions:[{tagId:tag.id,confidence:index===0?'high':'medium',match:'substantive',reason:index===0?'The experiment directly measures membrane proton transport.':'This source leaves the role of the proposed phenomenon uncertain.',evidence:[{source:'abstract',text:input.paper.abstract}]}]};
      }else if(input.workId&&config.meaningRecovery&&input.entries.some(entry=>entry.sourceName==='Batteries')){
        definitionRequests++;const broad={name:'battery',fullName:'battery',description:'Electrochemical battery systems across different battery chemistries.',facet:'system',aliases:[]};
        if(input.phase==='draft')value={workId:input.workId,fingerprint:input.fingerprint,taskId:input.taskId,definitions:input.entries.map(entry=>({entryId:entry.entryId,...broad,question:'Which scientific scope should Batteries use?',questionKind:'meaning',choices:[{label:'Battery systems across chemistries',...broad},{label:'Lithium-ion battery systems',name:'li-ion battery',fullName:'lithium-ion battery',description:'Rechargeable lithium-ion battery systems.',facet:'system',aliases:[]}]})),judgments:input.papers.map(source=>({entryId:source.entryId,paperId:source.paperId,sourceFingerprint:source.sourceFingerprint,relation:'uncertain',reason:'The researcher must first choose the intended scope.',evidence:[{source:'abstract',text:source.paper.abstract}],supportFactConceptIds:[]}))};
        else{
          batteryChecks++;const last=input.papers.some(source=>source.paper.title.includes('carbon dioxide')),frozen=input.entries[0].definition,echo={name:frozen.name,fullName:frozen.fullName??frozen.name,description:frozen.description,facet:frozen.facet,aliases:clone(frozen.aliases)};
          value={workId:input.workId,fingerprint:input.fingerprint,taskId:input.taskId,definitions:last?[{entryId:input.entries[0].entryId,...echo}]:[],judgments:input.papers.map(source=>({entryId:source.entryId,paperId:source.paperId,sourceFingerprint:source.sourceFingerprint,relation:source.paper.title.includes('carbon dioxide')?'different':'same-meaning',reason:source.paper.title.includes('carbon dioxide')?'This paper studies carbon-dioxide storage, a scientifically different topic.':'This paper studies electrochemical battery systems.',evidence:[{source:'abstract',text:source.paper.abstract}],supportFactConceptIds:[]})),...(last?{questions:[{entryId:input.entries[0].entryId,question:'One paper studies carbon-dioxide storage rather than electrochemical batteries. Clarify this mixed native name or leave it undefined.',questionKind:'meaning',choices:[{label:'Use battery systems across chemistries',targetTagId:frozen.id,...echo}]}]}:{})};
          if(last){const progress=(await app.snapshot()).queue.phaseProgress;check('nativeMeaningRecoveryShows16of17CheckedSources',progress?.completed===16&&progress.total===17&&progress.label==='Sources checked',progress);await open('vocabulary');await ready();batteryProgressScreenshot=await capture('secondary-after-'+config.theme+'-batteries-progress');batteryCheckpoint=clone(app.state);batteryReply=clone(value);}
        }
      }else if(input.workId){
        definitionRequests++;value={workId:input.workId,fingerprint:input.fingerprint,taskId:input.taskId,definitions:input.phase==='draft'?input.entries.map(entry=>({entryId:entry.entryId,name:'membrane measurement',fullName:'membrane measurement',description:'Measurements characterizing transport through membranes.',facet:'method',aliases:[]})):[],judgments:input.papers.map(source=>({entryId:source.entryId,paperId:source.paperId,sourceFingerprint:source.sourceFingerprint,relation:'same-meaning',reason:'The experiment directly measures the transport properties of a membrane.',evidence:[{source:'abstract',text:source.paper.abstract}],supportFactConceptIds:[]}))};
      }else throw new Error('Unexpected synthetic provider request. No external transport is available.');
      return {value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:20,outputTokens:20},estimatedCostUSD:0.00004};
    };
    await app.save();let doc=await open('assignment');manager.resizeTo(1280,900);await until(()=>manager.innerWidth>1050&&manager.innerHeight>650,'manager dimensions');
    if(config.addonSource==='production-build'){
      check('automaticProductionVersion',Zotero.SmartTags.version===config.addonVersion,{expected:config.addonVersion,actual:Zotero.SmartTags.version});
      check('automaticProductionManagerResourceVersions',manager.location.search.includes('v='+config.addonVersion)&&[...doc.querySelectorAll('link[rel="stylesheet"],script[src]')].every(resource=>new URL(resource.href||resource.src).searchParams.get('v')===config.addonVersion));
    }
    check('automaticSeparatePrimaryPages',['cleanup','vocabulary','assignment'].every(id=>!!doc.getElementById('nav-'+id))&&doc.querySelector('h1')?.textContent==='Assign tags');
    const scope=doc.getElementById('assignment-scope');key(scope,'ArrowDown');await until(()=>scope.getAttribute('aria-expanded')==='true','keyboard dropdown');check('automaticKeyboardOpensScope',!!doc.querySelector('[role="listbox"]'));key(scope,'Escape');check('automaticEscapeClosesAndRestoresFocus',scope.getAttribute('aria-expanded')==='false'&&!doc.querySelector('[role="listbox"]')&&doc.activeElement===scope);
    key(scope,'Home');key(scope,'ArrowDown');key(scope,'Enter');await ready();
    check('automaticKeyboardEnterCommitsScope',doc.getElementById('assignment-scope').textContent.includes('Selected papers')&&!doc.querySelector('[role="listbox"]'));
    const selectedScope=doc.getElementById('assignment-scope');key(selectedScope,'End');key(selectedScope,'Enter');await ready();
    await clickControl(doc.getElementById('start-assignment'));await app.waitForIdle();await ready();await until(()=>app.state.assignmentRuns?.at(-1)?.status==='finished','automatic assignment completion');
    check('automaticClearWrittenWithoutBatchApproval',nativeWrites===1&&native[papers[0].id].some(value=>value.tag===tag.name)&&native[papers[1].id].every(value=>value.tag!==tag.name)&&native[papers[2].id].every(value=>value.tag!=='no_tag')&&Object.values(native).every(values=>values.some(value=>value.tag==='Manual project')));
    check('automaticUncertainDoesNotBlockCompletion',app.state.reviewItems.filter(item=>item.kind==='assignment'&&item.state==='open').length===2&&app.state.assignmentRuns.at(-1).status==='finished'&&!button(doc,'Apply accepted and finish'));
    const dark=manager.matchMedia('(prefers-color-scheme: dark)').matches,background=manager.getComputedStyle(doc.body).backgroundColor,ink=manager.getComputedStyle(doc.body).color;
    check('automaticRequestedTheme',config.theme==='system'||dark===(config.theme==='dark'),{theme:config.theme,dark,background,ink});
    check('automaticLayoutFitsViewport',doc.documentElement.scrollWidth<=manager.innerWidth+2&&!!doc.getElementById('nav-activity'));
    const screenshot=await capture('native-automatic-'+config.theme+'-assignment');
    if(config.secondaryBaseline){
      const secondaryScreenshots={};
      for(const [width,height,suffix] of [[1280,900,''],[820,620,'-narrow']]){
        await resize(width,height);
        for(const [page,name] of [['library','find'],['activity','activity'],['settings','settings']]){await open(page);secondaryScreenshots[name+suffix]=await capture('secondary-before-'+config.theme+'-'+name+suffix);}
      }
      check('secondaryBaselineCaptured',Object.values(secondaryScreenshots).every(value=>value.captured));
      return {theme:config.theme,secondaryBaseline:true,secondaryScreenshots,requests,realProviderRequests:0};
    }
    doc=await open('activity');await click('Later');check('automaticLaterDoesNotReject',app.state.reviewItems.some(item=>item.state==='deferred')&&Object.keys(app.state.decisions).length===0);
    const later=await until(()=>[...doc.querySelectorAll('summary')].find(summary=>summary.textContent.startsWith('Later (')),'deferred review section');await clickControl(later);await click('Reopen');check('automaticDeferredItemCanReopen',app.state.reviewItems.filter(item=>item.kind==='assignment'&&item.state==='open').length===2);
    doc=await open('assignment');await until(()=>doc.getElementById('undo-assignment-change'),'exact assignment undo');
    check('automaticAssignReopensActiveResult',!!doc.getElementById('undo-assignment-change')&&doc.body.textContent.includes('applied'));
    const firstRunId=app.state.assignmentRuns.at(-1).id,firstChange=(await app.snapshot()).assignmentReviews.find(review=>review.id===firstRunId).lastChangeId;
    await clickControl(doc.getElementById('undo-assignment-change'));await until(()=>app.state.history.find(change=>change.id===firstChange)?.status==='undone','assignment undo completed');await ready();
    check('automaticUIUndoPreservesManualTags',native[papers[0].id].every(value=>value.tag!==tag.name)&&Object.values(native).every(values=>values.some(value=>value.tag==='Manual project'))&&native[papers[0].id].some(value=>value.tag==='Membrane tests'));
    const requestsBeforeRerun=assignmentRequests;doc=await assignmentSetup();await clickControl(doc.getElementById('start-assignment'));
    await until(()=>app.state.assignmentRuns.at(-1).id!==firstRunId&&app.state.assignmentRuns.at(-1).status==='finished','exact assignment rerun');await app.waitForIdle();await ready();
    check('automaticUndoSurvivesExactCachedRerun',assignmentRequests===requestsBeforeRerun&&native[papers[0].id].every(value=>value.tag!==tag.name)&&Object.values(native).every(values=>values.some(value=>value.tag==='Manual project')));
    await click('Add '+tag.name);await until(()=>native[papers[1].id].some(value=>value.tag===tag.name),'explicit uncertain match applied');await ready();await new Promise(resolve=>setTimeout(resolve,250));
    check('automaticUserChoiceChangesOnlyChosenPaper',native[papers[0].id].every(value=>value.tag!==tag.name)&&native[papers[1].id].some(value=>value.tag===tag.name)&&native[papers[2].id].every(value=>value.tag!=='no_tag')&&app.state.reviewItems.filter(item=>item.kind==='assignment'&&item.state==='open').length===1,{open:app.state.reviewItems.filter(item=>item.kind==='assignment'&&item.state==='open').map(item=>({paperId:item.paperId,tagId:item.tagId,taskId:item.taskId})),mediumSuggestions:app.state.suggestions.filter(item=>item.paperId===papers[1].id).map(item=>({runId:item.runId,status:item.status,applied:item.applied}))});
    doc=await open('cleanup');check('automaticBuildAdvancedOptionsCollapsed',[...doc.querySelectorAll('details')].some(details=>details.querySelector('summary')?.textContent==='More options'&&!details.open));const buildScreenshot=await capture('native-automatic-'+config.theme+'-build');
    doc=await open('vocabulary');await choose('tag-library-status','Needs meaning');await clickControl(doc.getElementById('select-native-tag-'+encodeURIComponent('Membrane tests')));const writesBefore=nativeWrites;await click('Suggest meanings');
    await until(()=>{const review=app.state.nativeDefinitionPreparation,task=review&&app.state.maintenanceTasks?.find(task=>task.id===review.taskId);return task&&['completed','paused'].includes(task.status);},'native meaning task settled');await app.waitForIdle();await ready();
    check('automaticNativeMeaningSavedWithoutExtraApproval',app.state.tags.some(value=>value.name==='membrane measurement'&&value.aliases.includes('Membrane tests'))&&nativeWrites===writesBefore&&!button(doc,'Save 1 meaning'),{tags:app.state.tags.map(value=>({name:value.name,aliases:value.aliases})),writesBefore,nativeWrites,definitionRequests,status:app.state.nativeDefinitionPreparation?.work.status,entries:app.state.nativeDefinitionPreparation?.work.entries.map(entry=>({sourceName:entry.sourceName,status:entry.status,question:entry.question})),saved:app.state.nativeDefinitionPreparation?.appliedEntryIds.length});
    await choose('tag-library-status','All tags');const libraryScreenshot=await capture('native-automatic-'+config.theme+'-library');
    doc=await open('connection');check('automaticConnectionShowsOneModelControl',!!doc.getElementById('settings-discovered-model')&&!doc.getElementById('settings-model'));
    await choose('settings-discovered-model','native-automatic-alternative');await until(()=>button(doc,'Save and test'),'combined save and test action');const connectionScreenshot=await capture('native-automatic-'+config.theme+'-connection');
    await click('Save and test');await until(()=>app.state.settings.model==='native-automatic-alternative'&&connectionRequests===1,'synthetic connection saved and tested');await ready();
    check('automaticConnectionSaveAndTestUsesChosenModel',connectionRequests===1&&(await app.snapshot()).connection.verified===true);
    const editId='edit-tag-'+encodeURIComponent(tag.id),openEditor=async()=>{doc=await open('vocabulary');await clickControl(await until(()=>doc.getElementById(editId),'saved tag editor action'));await until(()=>doc.getElementById('tag-editor-form'),'saved tag editor');};
    const committedMeaning=app.state.tags.find(value=>value.id===tag.id).description,enteredMeaning=committedMeaning+' Confirmed through direct membrane measurements.';
    await openEditor();const editorScreenshot=await capture('native-automatic-'+config.theme+'-editor');setInput('tag-description',enteredMeaning);key(doc.getElementById('tag-name'),'Enter');
    await until(()=>app.state.tags.find(value=>value.id===tag.id).description===enteredMeaning&&!doc.getElementById('tag-editor-form'),'Enter saves editor');await ready();
    check('automaticEditorEnterSavesAndRestoresFocus',doc.activeElement===doc.getElementById(editId));
    const controlMeaning=enteredMeaning+' The scope remains transport through membranes.';await openEditor();key(setInput('tag-description',controlMeaning),'Enter',{ctrlKey:true});
    await until(()=>app.state.tags.find(value=>value.id===tag.id).description===controlMeaning&&!doc.getElementById('tag-editor-form'),'Ctrl Enter saves editor');await ready();
    check('automaticEditorControlEnterSaves',doc.activeElement===doc.getElementById(editId));
    const draftMeaning='An unsaved researcher correction retained while inspecting another page.';await openEditor();key(setInput('tag-description',draftMeaning),'Escape');await until(()=>!doc.getElementById('tag-editor-form'),'Escape closes editor');
    check('automaticEditorEscapeKeepsSavedMeaning',app.state.tags.find(value=>value.id===tag.id).description===controlMeaning&&doc.activeElement===doc.getElementById(editId));
    await openEditor();check('automaticEditorReopensUnsavedDraft',doc.getElementById('tag-description').value===draftMeaning);await clickControl(doc.getElementById('close-tag-editor'));await openEditor();
    check('automaticEditorCloseKeepsDraft',doc.getElementById('tag-description').value===draftMeaning);await clickControl(doc.getElementById('discard-tag-draft'));await openEditor();
    check('automaticEditorDiscardRestoresSavedMeaning',doc.getElementById('tag-description').value===controlMeaning);await clickControl(doc.getElementById('close-tag-editor'));
    await resize(820,620);const narrowScreenshots={};
    for(const [page,name,controlId,controlLabel] of [['cleanup','build','start-build'],['vocabulary','library','add-tag'],['assignment','assignment','assignment-setup-toggle'],['connection','connection',null,'Test connection']]){
      doc=await open(page);const navPage=page==='connection'?'settings':page;check('automaticNarrow'+name+'FitsViewport',doc.documentElement.scrollWidth<=manager.innerWidth+2&&!!doc.getElementById('nav-'+navPage),{scrollWidth:doc.documentElement.scrollWidth,viewportWidth:manager.innerWidth,navPage});
      const primary=controlId?doc.getElementById(controlId):button(doc,controlLabel);if(primary)primary.scrollIntoView({block:'nearest'});
      const bounds=primary?.getBoundingClientRect();check('automaticNarrow'+name+'PrimaryReachable',inViewport(primary),{viewport:{width:manager.innerWidth,height:manager.innerHeight},...(bounds?{bounds:{left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom}}:{missing:controlId})});
      narrowScreenshots[name]=await capture('native-automatic-'+config.theme+'-'+name+'-narrow');
    }
    await openEditor();const form=doc.getElementById('tag-editor-form');form.scrollTop=form.scrollHeight;await new Promise(resolve=>manager.requestAnimationFrame(resolve));
    const footer=doc.querySelector('.tag-editor .editor-footer'),save=doc.getElementById('save-tag'),close=doc.getElementById('close-tag-editor');
    check('automaticNarrowEditorSaveAndCloseReachable',inViewport(footer)&&inViewport(save)&&inViewport(close)&&save.getAttribute('form')==='tag-editor-form',{viewport:{width:manager.innerWidth,height:manager.innerHeight},footer:footer&&{top:footer.getBoundingClientRect().top,bottom:footer.getBoundingClientRect().bottom},save:save&&{top:save.getBoundingClientRect().top,bottom:save.getBoundingClientRect().bottom},close:close&&{top:close.getBoundingClientRect().top,bottom:close.getBoundingClientRect().bottom}});
    narrowScreenshots.editor=await capture('native-automatic-'+config.theme+'-editor-narrow');
    await clickControl(doc.getElementById('nav-assignment'));await until(()=>!doc.getElementById('tag-editor-form')&&doc.querySelector('h1')?.textContent==='Assign tags','sidebar remains reachable beside editor');
    check('automaticNarrowSidebarClosesEditorSafely',app.state.tags.find(value=>value.id===tag.id).description===controlMeaning);
    const secondaryScreenshots={};
    if(config.secondaryWorkflow){
      await resize(1280,900);const requestsBeforeSecondary=requests,writesBeforeSecondary=nativeWrites;
      doc=await open('library');const foundCount=()=>Number(doc.getElementById('find-result-count')?.textContent.match(/\d+/)?.[0]);
      check('secondaryFindStartsWithQuietTagFilters',!doc.getElementById('find-tag-filters').open&&foundCount()===3&&!doc.querySelector('.related-paper-results'));
      setInput('paper-search','synthetic paper 1');await ready();key(doc.getElementById('paper-search'),'Enter');await ready();
      check('secondaryFindEnterFocusesLiveResults',foundCount()===1&&doc.activeElement===doc.getElementById('find-result-count'));
      key(doc.getElementById('find-tag-filters').querySelector('summary'),'Enter');await ready();setInput('concept-search','proton');await ready();await clickControl(doc.getElementById('explore-core-'+tag.id));await ready();
      check('secondaryFindCombinesQueryAndTag',foundCount()===0&&doc.body.textContent.includes('No papers match'));
      secondaryScreenshots.filters=await capture('secondary-after-'+config.theme+'-find-filters');
      await clickControl(doc.getElementById('reset-find-filters'));await ready();
      check('secondaryFindClearResetsQueriesAndSelections',foundCount()===3&&doc.getElementById('paper-search').value===''&&doc.getElementById('concept-search').value===''&&!doc.getElementById('explore-core-'+tag.id).checked&&doc.activeElement===doc.getElementById('paper-search'));
      if(doc.getElementById('find-tag-filters').open){key(doc.getElementById('find-tag-filters').querySelector('summary'),'Enter');await ready();}
      secondaryScreenshots.find=await capture('secondary-after-'+config.theme+'-find');
      const relatedId='related-papers-'+encodeURIComponent(papers[0].id),relatedPanelId='related-paper-results-'+encodeURIComponent(papers[0].id);
      await clickControl(doc.getElementById(relatedId));await ready();check('secondaryRelatedPapersAppearOnlyOnRequest',!!doc.getElementById(relatedPanelId)&&doc.getElementById(relatedId).getAttribute('aria-expanded')==='true');
      secondaryScreenshots.related=await capture('secondary-after-'+config.theme+'-find-related');key(button(doc,'Close related papers'),'Escape');await ready();
      check('secondaryRelatedEscapeRestoresFocus',!doc.getElementById(relatedPanelId)&&doc.activeElement===doc.getElementById(relatedId));
      check('secondaryFindUsesNoProviderOrNativeChanges',requests===requestsBeforeSecondary&&nativeWrites===writesBeforeSecondary);
      doc=await open('activity');check('secondaryActivityHistoryStartsCollapsed',!doc.getElementById('activity-history').open);
      key(doc.getElementById('activity-history').querySelector('summary'),'Enter');await ready();
      check('secondaryActivityHistoryAndUndoReachable',doc.getElementById('activity-history').open&&doc.getElementById('activity-history').textContent.includes('Applied changes')&&!!button(doc.getElementById('activity-history'),'Undo'));
      secondaryScreenshots.history=await capture('secondary-after-'+config.theme+'-activity-history',doc.getElementById('activity-history'));
      key(doc.getElementById('activity-history').querySelector('summary'),'Enter');await ready();
      const recoveryPaper={id:'1:AUTO-RECOVERY',itemID:914_100,libraryID:Zotero.Libraries.userLibraryID,key:'AUTOREC',title:'Synthetic paper needing missing metadata',abstract:'',keywords:[],fingerprint:''};recoveryPaper.fingerprint=paperFingerprint(recoveryPaper);
      const assessment={paperId:recoveryPaper.id,itemID:recoveryPaper.itemID,checkedAt:new Date().toISOString(),metadata:{title:true,abstract:false,keywords:false},pdf:{status:'missing',attachmentCount:0,localCount:0,characters:0,rechecked:false}};
      papers.push(recoveryPaper);native[recoveryPaper.id]=[{tag:'Manual project',type:0}];app.state.papers[recoveryPaper.id]=clone(recoveryPaper);app.state.nativeTags[recoveryPaper.id]=clone(native[recoveryPaper.id]);(app.state.paperInputs??={})[recoveryPaper.id]=clone(assessment);
      app.env.host.inspectInputs=async(itemID,recheck=false)=>{if(itemID!==recoveryPaper.itemID)throw new Error('Only the isolated recovery fixture can be rechecked.');localRechecks++;return {...clone(assessment),checkedAt:new Date().toISOString(),pdf:{...assessment.pdf,rechecked:recheck}};};
      await app.save();await ready();check('secondaryActivitySurfacesActualRecovery',!!doc.getElementById('activity-recovery')&&doc.getElementById('activity-recovery').textContent.includes(recoveryPaper.title));
      const recoveryMoreId='attention-more-'+recoveryPaper.id;key(doc.getElementById(recoveryMoreId),'ArrowDown');await until(()=>doc.getElementById(recoveryMoreId+'-item-pdf'),'local recovery menu');key(doc.getElementById(recoveryMoreId+'-item-pdf'),'Enter');
      await until(()=>localRechecks===1&&app.state.paperInputs[recoveryPaper.id].pdf.rechecked,'explicit local PDF recheck');await ready();
      check('secondaryRecoveryRecheckIsLocalAndPreservesTags',requests===requestsBeforeSecondary&&nativeWrites===writesBeforeSecondary&&native[recoveryPaper.id].some(value=>value.tag==='Manual project'));
      secondaryScreenshots.activity=await capture('secondary-after-'+config.theme+'-activity');
      secondaryScreenshots.recovery=await capture('secondary-after-'+config.theme+'-activity-recovery',doc.getElementById('activity-recovery'));
      papers.pop();delete native[recoveryPaper.id];delete app.state.papers[recoveryPaper.id];delete app.state.nativeTags[recoveryPaper.id];delete app.state.paperInputs[recoveryPaper.id];await app.save();await ready();
      check('secondaryActivityKeepsNoIssueInformationQuiet',!!doc.getElementById('activity-paper-information')&&!doc.getElementById('activity-paper-information').open);
      doc=await open('settings');check('secondarySettingsGroupsStartClosed',['settings-tags','settings-navigation','settings-data'].every(id=>!doc.getElementById(id).open)&&!doc.getElementById('save-settings'));
      const initialLimit=app.state.settings.coreConceptLimit,initialExtension=app.state.settings.extensionTagTarget;
      key(doc.getElementById('settings-tags').querySelector('summary'),'Enter');await ready();setInput('settings-coreConceptLimit','0');key(doc.getElementById('settings-coreConceptLimit'),'s',{ctrlKey:true});await ready();
      check('secondarySettingsInvalidLimitStaysUnsavedAndFocused',app.state.settings.coreConceptLimit===initialLimit&&doc.getElementById('settings-coreConceptLimit').getAttribute('aria-invalid')==='true'&&doc.activeElement===doc.getElementById('settings-coreConceptLimit'));
      const changedLimit=initialLimit+1;setInput('settings-coreConceptLimit',String(changedLimit));
      check('secondarySettingsDraftIsNotAppliedBeforeSave',app.state.settings.coreConceptLimit===initialLimit&&!!doc.getElementById('save-settings'));
      key(doc.getElementById('settings-coreConceptLimit'),'s',{ctrlKey:true});await until(()=>app.state.settings.coreConceptLimit===changedLimit,'explicit settings keyboard save');await ready();
      check('secondarySettingsControlSSavesOnlySettings',!doc.getElementById('save-settings')&&requests===requestsBeforeSecondary&&nativeWrites===writesBeforeSecondary);
      setInput('settings-extensionTagTarget',String(initialExtension+1));await ready();secondaryScreenshots.settingsDirty=await capture('secondary-after-'+config.theme+'-settings-dirty');await clickControl(doc.getElementById('discard-settings-changes'));await ready();
      check('secondarySettingsDiscardRestoresSavedValues',app.state.settings.extensionTagTarget===initialExtension&&doc.getElementById('settings-extensionTagTarget').value===String(initialExtension)&&!doc.getElementById('save-settings'));
      key(doc.getElementById('settings-tags').querySelector('summary'),'Enter');await ready();
      for(const id of ['settings-navigation','settings-data']){key(doc.getElementById(id).querySelector('summary'),'Enter');await ready();check('secondarySettings'+id+'KeyboardReachable',doc.getElementById(id).open);key(doc.getElementById(id).querySelector('summary'),'Enter');await ready();}
      secondaryScreenshots.settings=await capture('secondary-after-'+config.theme+'-settings');await click('AI connection and budget');await until(()=>doc.querySelector('h1')?.textContent==='Connect AI','settings connection link');
      check('secondarySettingsConnectionRouteKeepsSavedModel',app.state.settings.model==='native-automatic-alternative');
      await resize(820,620);
      for(const [page,name,controlId] of [['library','find','paper-search'],['activity','activity','activity-history'],['settings','settings','settings-tags']]){
        doc=await open(page);const primary=doc.getElementById(controlId);primary.scrollIntoView({block:'nearest'});const bounds=primary.getBoundingClientRect();
        check('secondaryNarrow'+name+'FitsAndKeepsPrimaryReachable',doc.documentElement.scrollWidth<=manager.innerWidth+2&&inViewport(primary),{scrollWidth:doc.documentElement.scrollWidth,viewport:{width:manager.innerWidth,height:manager.innerHeight},bounds:{left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom}});
        secondaryScreenshots[name+'-narrow']=await capture('secondary-after-'+config.theme+'-'+name+'-narrow');
        if(name==='settings'){
          key(doc.getElementById('settings-tags').querySelector('summary'),'Enter');await ready();setInput('settings-extensionTagTarget',String(initialExtension+1));await ready();
          const narrowSave=doc.getElementById('save-settings'),narrowDiscard=doc.getElementById('discard-settings-changes');
          check('secondaryNarrowDirtySettingsActionsRemainVisible',inViewport(narrowSave)&&inViewport(narrowDiscard),{viewportHeight:manager.innerHeight,saveBottom:narrowSave.getBoundingClientRect().bottom,discardBottom:narrowDiscard.getBoundingClientRect().bottom});
          secondaryScreenshots['settings-dirty-narrow']=await capture('secondary-after-'+config.theme+'-settings-dirty-narrow');
          setInput('settings-extensionTagTarget','0');key(doc.getElementById('settings-extensionTagTarget'),'s',{ctrlKey:true});await ready();
          check('secondaryNarrowInvalidSettingsFocusDoesNotSave',app.state.settings.extensionTagTarget===initialExtension&&doc.activeElement===doc.getElementById('settings-extensionTagTarget')&&doc.getElementById('settings-extensionTagTarget').getAttribute('aria-invalid')==='true');
          secondaryScreenshots['settings-invalid-narrow']=await capture('secondary-after-'+config.theme+'-settings-invalid-narrow');
          await clickControl(doc.getElementById('discard-settings-changes'));await ready();
        }
      }
    }
    let meaningRecovery;
    if(config.meaningRecovery){
      await resize(1280,900);
      const batteryPapers=Array.from({length:17},(_,index)=>{const paper={id:'1:BATTERY-'+String(index).padStart(2,'0'),itemID:914_200+index,libraryID:Zotero.Libraries.userLibraryID,key:'BATTERY'+index,title:index===16?'Synthetic carbon dioxide storage source':'Synthetic battery experiment '+index,abstract:index===16?'Carbon dioxide is captured and stored in porous amine sorbents without an electrochemical battery.':'Electrochemical battery experiments compare lithium-ion and lithium-metal cells during charging and discharge.',keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);return paper;});
      papers.push(...batteryPapers);for(const paper of batteryPapers){native[paper.id]=[{tag:'Batteries',type:0},{tag:'Manual project',type:0}];app.state.papers[paper.id]=clone(paper);app.state.nativeTags[paper.id]=clone(native[paper.id]);}
      await app.save();const writesBeforeBattery=nativeWrites;
      await app.invoke('prepare-tag-meanings',{names:['Batteries'],shelfId:'all',processingPolicy:'auto-clear'});
      await until(()=>app.state.nativeDefinitionPreparation?.work.entries[0].sourceName==='Batteries'&&app.state.nativeDefinitionPreparation.work.entries[0].status==='question','ambiguous Batteries choice');await app.waitForIdle();doc=await open('activity');await click('Battery systems across chemistries');
      await until(()=>{const review=app.state.nativeDefinitionPreparation,task=app.state.maintenanceTasks.find(task=>task.id===review.taskId);return ['completed','paused'].includes(task.status);},'chosen Batteries source checks');await app.waitForIdle();await ready();
      const completedReview=app.state.nativeDefinitionPreparation,completedEntry=completedReview.work.entries[0],completedTask=app.state.maintenanceTasks.find(task=>task.id===completedReview.taskId),paidSpend=completedTask.run.spentUSD;
      check('nativeMeaningRecoveryRetains17ScientificJudgments',completedTask.status==='completed'&&completedEntry.status==='question'&&Object.keys(completedEntry.judgments).length===17&&Object.values(completedEntry.judgments).filter(judgment=>judgment.relation==='different').length===1&&completedEntry.targetTagId===undefined);
      check('nativeMeaningRecoveryDoesNotRepeatContradictedChoice',completedEntry.questionDetails.choices.every(choice=>choice.definition.name!=='battery')&&nativeWrites===writesBeforeBattery&&!app.state.tags.some(tag=>tag.aliases.includes('Batteries')));
      const frozenMeaning=fingerprint(completedEntry.definition),humanChoice=fingerprint(completedEntry.humanAnswer),checkpoint=clone(batteryCheckpoint),pausedReview=checkpoint.nativeDefinitionPreparation,pausedTask=checkpoint.maintenanceTasks.find(task=>task.id===pausedReview.taskId),foreignReply=clone(batteryReply);
      foreignReply.questions[0].choices[0].targetTagId='foreign-saved-target';
      pausedReview.work=failNativeTagDefinitionTask(pausedReview.work,batteryReply.taskId,batteryReply,'Supporting checks cannot change the frozen tag meanings.');
      pausedReview.work=failNativeTagDefinitionTask(pausedReview.work,batteryReply.taskId,foreignReply,'The proposed saved tag is outside this request snapshot.');
      pausedTask.response={cursor:pausedTask.cursor,raw:foreignReply,applied:true,provider:pausedTask.run.settings.provider,model:pausedTask.run.settings.model};pausedTask.cursor++;pausedTask.status='paused';pausedTask.run.status='paused';pausedTask.run.spentUSD=paidSpend;pausedTask.error='Supporting checks cannot change the frozen tag meanings.';
      app.state=checkpoint;await app.save();const pausedProgress=(await app.snapshot()).queue.phaseProgress;
      check('nativeMeaningRecoveryPausedProgressKeeps16Sources',pausedProgress.completed===16&&pausedProgress.total===17&&Object.keys(pausedReview.work.entries[0].judgments).length===16);
      const beforeReplayRequests=requests;doc=await open('vocabulary');await click('Retry meanings');await until(()=>app.state.maintenanceTasks.find(task=>task.id===pausedTask.id).status==='completed','retained paid reply replay');await app.waitForIdle();await ready();
      const recoveredReview=app.state.nativeDefinitionPreparation,recoveredEntry=recoveredReview.work.entries[0],recoveredTask=app.state.maintenanceTasks.find(task=>task.id===recoveredReview.taskId);
      check('nativeMeaningRecoveryReplaysPaidReplyWithoutRequests',requests===beforeReplayRequests&&Object.keys(recoveredEntry.judgments).length===17&&recoveredTask.run.spentUSD===paidSpend&&recoveredTask.cursor===pausedTask.cursor&&recoveredTask.response.applied===true);
      check('nativeMeaningRecoveryRejectsForeignRebinding',fingerprint(recoveredEntry.definition)===frozenMeaning&&fingerprint(recoveredEntry.humanAnswer)===humanChoice&&recoveredEntry.targetTagId===undefined&&recoveredEntry.questionDetails.choices.every(choice=>choice.definition.name!=='battery'));
      doc=await open('activity');check('nativeMeaningRecoveryQuestionIsNotDuplicated',doc.body.textContent.includes('Batteries')&&!button(doc,'Open meanings'));const questionScreenshot=await capture('secondary-after-'+config.theme+'-batteries-question');await click('Leave undefined');await until(()=>app.state.nativeDefinitionPreparation.work.entries[0].status==='left-undefined','no-cost Batteries exit');await app.waitForIdle();
      check('nativeMeaningRecoveryLeaveUndefinedCostsNothing',requests===beforeReplayRequests&&nativeWrites===writesBeforeBattery&&batteryPapers.every(paper=>native[paper.id].some(tag=>tag.tag==='Batteries')));
      meaningRecovery={sources:17,checks:batteryChecks,retainedReplayRequests:requests-beforeReplayRequests,spentUSD:paidSpend,screenshots:{progress:batteryProgressScreenshot,question:questionScreenshot}};
    }
    check('automaticNativeColumnsPreserved',columns()===columnsBefore);
    return {theme:config.theme,syntheticPapers:papers.length,requests,assignmentRequests,definitionRequests,connectionRequests,nativeWrites,pointerActions,keyboardActions,keyboardTransport:'Gecko TextInputProcessor',realProviderRequests:0,screenshot,screenshots:{assignment:screenshot,build:buildScreenshot,library:libraryScreenshot,connection:connectionScreenshot,editor:editorScreenshot,narrow:narrowScreenshots},...(config.secondaryWorkflow?{localRechecks,secondaryScreenshots}:{}),...(meaningRecovery?{meaningRecovery}:{})};
  }finally{
    if(app.state.run?.status==='running')await app.invoke('pause');await app.waitForIdle();if(manager&&!manager.closed)manager.close();
    app.env.host=host;app.env.librarySnapshot=library;ai.completeJson=complete;ai.hasApiKey=hasKey;ai.getSession=session;ai.testConnection=testConnection;app.state=before;await app.save();await navigator?.refresh();if(mode)await navigator?.setMode(mode);
  }
}
