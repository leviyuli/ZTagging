/** TEST ONLY. Automatic additions and nonblocking review in an isolated native manager. */
import {initialState} from '../src/controller.ts';
import {fingerprint,paperFingerprint} from '../src/core.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
const button=(doc,label)=>[...doc.querySelectorAll('button')].find(control=>control.textContent===label||control.getAttribute('aria-label')===label);
async function until(predicate,label){const start=Date.now();while(Date.now()-start<25_000){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Automatic native smoke timeout: '+label);}

export async function runNativeAutomaticWorkflow(app,check,config){
  check('automaticIsolatedProfileAndData',normalized(Zotero.DataDirectory.dir)===normalized(config.data)&&normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile));
  const before=clone(app.state),host=app.env.host,library=app.env.librarySnapshot,ai=app.env.ai,complete=ai.completeJson,hasKey=ai.hasApiKey,session=ai.getSession,testConnection=ai.testConnection;
  const main=Zotero.getMainWindow(),navigator=Zotero.SmartTags.getNavigator(main),mode=navigator?.mode;
  const columns=()=>JSON.stringify(main.ZoteroPane.itemsView.getColumns().map(column=>[column.dataKey,column.hidden,column.width,column.ordinal])),columnsBefore=columns();
  let manager,inputProcessor,requests=0,assignmentRequests=0,definitionRequests=0,connectionRequests=0,nativeWrites=0,pointerActions=0,keyboardActions=0;
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
    const event=name=>new manager.KeyboardEvent('',{key:name,code:name==='Control'?'ControlLeft':name==='Meta'?'MetaLeft':name,keyCode:codes[name]});
    const held=Object.entries(modifiers).filter(([,active])=>active).map(([name])=>name==='ctrlKey'?'Control':'Meta');
    for(const name of held)inputProcessor.keydown(event(name),inputProcessor.KEY_NON_PRINTABLE_KEY);
    try{inputProcessor.keydown(event(value),inputProcessor.KEY_NON_PRINTABLE_KEY);inputProcessor.keyup(event(value),inputProcessor.KEY_NON_PRINTABLE_KEY);}
    finally{for(const name of held.reverse())inputProcessor.keyup(event(name),inputProcessor.KEY_NON_PRINTABLE_KEY);}
    keyboardActions++;
  };
  const resize=async(width,height)=>{manager.resizeTo(width,height);await until(()=>Math.abs(manager.outerWidth-width)<25&&Math.abs(manager.outerHeight-height)<25,'manager '+width+'×'+height);await new Promise(resolve=>manager.requestAnimationFrame(resolve));};
  const inViewport=control=>{if(!control)return false;const rect=control.getBoundingClientRect();return rect.width>0&&rect.height>0&&rect.left>=0&&rect.top>=0&&rect.right<=manager.innerWidth+2&&rect.bottom<=manager.innerHeight+2;};
  const setInput=(id,value)=>{const control=manager.document.getElementById(id);control.value=value;control.dispatchEvent(new manager.Event('input',{bubbles:true}));return control;};
  const assignmentSetup=async()=>{const doc=await open('assignment');if(!doc.getElementById('start-assignment'))await clickControl(doc.getElementById('assignment-setup-toggle'));await until(()=>doc.getElementById('start-assignment'),'assignment setup controls');return doc;};
  const capture=async name=>{
    manager.scrollTo(0,0);await new Promise(resolve=>manager.requestAnimationFrame(()=>manager.requestAnimationFrame(resolve)));
    const canvas=manager.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=manager.innerWidth;canvas.height=manager.innerHeight;
    const context=canvas.getContext('2d');
    if(typeof context?.drawWindow!=='function')return {captured:false,reason:'Native drawWindow is unavailable; inspect the isolated window with the desktop screenshot tool.'};
    context.drawWindow(manager,0,0,canvas.width,canvas.height,manager.getComputedStyle(manager.document.body).backgroundColor);
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
    check('automaticNativeColumnsPreserved',columns()===columnsBefore);
    return {theme:config.theme,syntheticPapers:papers.length,requests,assignmentRequests,definitionRequests,connectionRequests,nativeWrites,pointerActions,keyboardActions,keyboardTransport:'Gecko TextInputProcessor',realProviderRequests:0,screenshot,screenshots:{assignment:screenshot,build:buildScreenshot,library:libraryScreenshot,connection:connectionScreenshot,editor:editorScreenshot,narrow:narrowScreenshots}};
  }finally{
    if(app.state.run?.status==='running')await app.invoke('pause');await app.waitForIdle();if(manager&&!manager.closed)manager.close();
    app.env.host=host;app.env.librarySnapshot=library;ai.completeJson=complete;ai.hasApiKey=hasKey;ai.getSession=session;ai.testConnection=testConnection;app.state=before;await app.save();await navigator?.refresh();if(mode)await navigator?.setMode(mode);
  }
}
