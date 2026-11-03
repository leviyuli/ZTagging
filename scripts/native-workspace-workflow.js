/** TEST ONLY. The calling bootstrap verifies the isolated Zotero profile marker. */
const NAME='workspace proton transport',MANUAL='Workspace manual project';
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function until(predicate,label,timeout=120_000){const started=Date.now();while(Date.now()-started<timeout){const value=await predicate();if(value)return value;await sleep(40);}throw new Error('Workspace native workflow timed out: '+label);}
function query(workspace,page,params={}){
  return new Promise((resolve,reject)=>{const abort=new AbortController(),timer=setTimeout(()=>{abort.abort();reject(new Error('Workspace native query timed out: '+page));},30_000);workspace.watch({page,params,limit:50},event=>{if(event.phase==='ready'){clearTimeout(timer);abort.abort();resolve(event.model);}else if(event.phase==='error'){clearTimeout(timer);abort.abort();reject(new Error(event.error));}},{signal:abort.signal});});
}
const execute=(workspace,type,payload={})=>workspace.execute({type,payload},{commandId:'native-workflow-'+type+'-'+crypto.randomUUID()});
const report=async config=>JSON.parse(await IOUtils.readUTF8(config.providerReportPath));
async function items(context){const values=[];for(const id of context.itemIDs){const item=await Zotero.Items.getAsync(id);if(!item)throw new Error('A native workflow source disappeared.');values.push(item);}return values;}
async function withSelection(values,action){
  const pane=Zotero.getActiveZoteroPane();if(!pane)throw new Error('The isolated Zotero library window is unavailable.');
  const previous=Object.getOwnPropertyDescriptor(pane,'getSelectedItems');
  Object.defineProperty(pane,'getSelectedItems',{value:()=>values,writable:true,configurable:true});
  try{return await action();}finally{if(previous)Object.defineProperty(pane,'getSelectedItems',previous);else delete pane.getSelectedItems;}
}
async function assignment(workspace,values){
  const previous=(await query(workspace,'assignment')).assignmentReview?.id;
  return withSelection(values,async()=>{
    await execute(workspace,'tag',{scope:'selected',processingPolicy:'auto-clear'});
    return until(async()=>{const model=await query(workspace,'assignment'),review=model.assignmentReview;return review&&review.id!==previous&&review.analysisComplete&&model.queue.status==='idle'&&model.queue.completed===values.length?model:false;},'all selected sources complete');
  });
}
function nativeState(values){return values.map(item=>({id:item.id,tags:item.getTags().map(tag=>({tag:tag.tag,type:tag.type??0}))}));}
function assertManual(check,values,name){check(name,nativeState(values).every(item=>item.tags.some(tag=>tag.tag===MANUAL&&tag.type===0)));}

export async function run(workspace,check,config){
  if(!config.providerReportPath)throw new Error('The native workflow needs its synthetic provider report path.');
  await config.progress?.('native-workflow-creating-sources');
  const values=[],instance=crypto.randomUUID().slice(0,8);
  for(let index=0;index<12;index++){
    const item=new Zotero.Item('journalArticle');item.libraryID=Zotero.Libraries.userLibraryID;
    item.setField('title','Workspace native '+(index===11?'uncertain':'clear')+' proton transport '+String(index+1).padStart(2,'0')+' '+instance);
    item.setField('abstractNote',index===11?'The membrane experiment discusses a possible proton transport contribution without establishing its magnitude.':'Experiments directly measure proton transport through a membrane using impedance spectroscopy and controlled hydration.');
    item.addTag(MANUAL,0);await item.saveTx();values.push(item);
  }
  const context={itemIDs:values.map(item=>item.id),paperIds:values.map(item=>`${item.libraryID}:${item.key}`),tagName:NAME,manualName:MANUAL};
  check('nativeWorkflowCreatesTwelveSources',values.length===12&&values.every(item=>item.isRegularItem()&&!item.deleted));
  const settings=(await query(workspace,'settings')).settings;
  await execute(workspace,'save-settings',{settings:{...settings,provider:'api',model:'workspace-native-fixture',autoAssign:false,budgetUSD:10,inputPricePerMillion:1,outputPricePerMillion:1,maxOutputTokens:8192}});
  await execute(workspace,'save-api-key',{provider:'api',key:'workspace-native-isolated-fixture-key'});
  await execute(workspace,'discover-models');await execute(workspace,'test-connection');
  const connected=await query(workspace,'connection');check('nativeFixtureConnectionVerified',connected.connection.apiKeyStored&&connected.connection.verified&&connected.models.includes('workspace-native-fixture'));
  const build=await withSelection(values.slice(0,3),()=>execute(workspace,'prepare-tags',{scope:'selected',mode:'extend',processingPolicy:'auto-clear'}));
  check('nativeBuildHasImmediateIdentity',!!build.runId);
  const built=await until(async()=>{const model=await query(workspace,'build',{runId:build.runId});if(model.run?.status==='failed'||model.run?.status==='paused')throw new Error('Native build failed: '+JSON.stringify(model.run));return model.run?.status==='completed'?model:false;},'AI build completion');
  check('nativeBuildCompletesWithoutMeaningReview',(built.buildResult?.savedCount+(built.buildResult?.reusedCount??0))>0&&built.buildResult?.questionCount===0,{run:built.run,result:built.buildResult});
  const definition=(await query(workspace,'vocabulary',{vocabQuery:NAME})).tags.find(tag=>tag.name===NAME);check('nativeFixtureDefinitionSaved',definition?.status==='approved'&&definition.matchingMode==='auto'&&!definition.custom);context.tagId=definition.id;
  await config.progress?.('native-workflow-assignment');
  const before=await report(config),first=await assignment(workspace,values),after=await report(config);
  const native=nativeState(values),clear=native.slice(0,11),uncertain=native[11];
  check('nativeClearAssignmentsAppliedWithoutReview',clear.every(item=>item.tags.some(tag=>tag.tag===NAME))&&!uncertain.tags.some(tag=>tag.tag===NAME));
  check('nativeUncertainPaperDoesNotBlockCompletion',first.queue.completed===12&&first.queue.status==='idle'&&first.assignmentReview.analysisComplete&&first.assignmentReview.needsReview===1,{completed:first.queue.completed,needsReview:first.assignmentReview.needsReview});
  check('nativeRequestsAreExactlyOnePerPaper',after.assignments-before.assignments===12,{before:before.assignments,after:after.assignments});
  assertManual(check,values,'nativeManualTagsPreserved');
  const choices=(await query(workspace,'activity')).reviewItems.filter(item=>item.kind==='assignment'&&item.state==='open'&&context.paperIds.includes(item.paperId));
  check('nativeSingleUncertainChoiceVisible',choices.length===1&&choices[0].paperId===context.paperIds[11]);
  const history=(await query(workspace,'activity',{activityHistoryOpen:true})).history.filter(item=>item.label==='Automatic tag assignments'&&item.canUndo);
  context.undoId=first.assignmentReview.lastChangeId??history[0]?.id;check('nativeRecentUndoVisible',history.some(item=>item.id===context.undoId));context.firstRunId=first.assignmentReview.id;
  const cachedBefore=await report(config),second=await assignment(workspace,values),cachedAfter=await report(config);
  check('nativeRepeatReusesPaidReplies',cachedAfter.assignments===cachedBefore.assignments,{before:cachedBefore.assignments,after:cachedAfter.assignments});
  check('nativeRepeatFinishesWithUncertainChoice',second.assignmentReview.analysisComplete&&second.queue.completed===12&&second.queue.status==='idle');assertManual(check,values,'nativeRepeatPreservesManualTags');
  const repeatedChoices=(await query(workspace,'activity')).reviewItems.filter(item=>item.kind==='assignment'&&item.state==='open'&&context.paperIds.includes(item.paperId));check('nativeRepeatDoesNotDuplicateChoices',repeatedChoices.length===1);
  context.assignmentRequests=cachedAfter.assignments;context.providerTotal=cachedAfter.total;
  await config.progress?.('native-workflow-ready-for-restart');return context;
}

export async function verifyAfterRestart(workspace,check,config,context){
  await config.progress?.('native-workflow-after-restart');
  const values=await items(context),history=(await query(workspace,'activity',{activityHistoryOpen:true})).history;
  check('nativeUndoSurvivesRestart',history.some(item=>item.id===context.undoId&&item.canUndo));
  const before=nativeState(values),counts=await report(config);await execute(workspace,'undo',{id:context.undoId});
  const undone=nativeState(await items(context)),removed=context.itemIDs.filter(id=>before.find(item=>item.id===id).tags.some(tag=>tag.tag===NAME)&&!undone.find(item=>item.id===id).tags.some(tag=>tag.tag===NAME));
  check('nativeUndoChangesActualZoteroTags',removed.length===11,{removed:removed.length,expected:11});assertManual(check,await items(context),'nativeUndoPreservesManualTags');
  const repeated=await assignment(workspace,await items(context)),final=nativeState(await items(context)),after=await report(config);
  check('nativeUndoPreventsImmediateReapplication',removed.every(id=>!final.find(item=>item.id===id).tags.some(tag=>tag.tag===NAME))&&repeated.queue.status==='idle');
  check('nativeRestartAndUndoReusePaidReplies',after.assignments===counts.assignments,{before:counts.assignments,after:after.assignments});check('nativeFixtureNeverUsesRealNetwork',after.blocked===0);
  const unknown=new Zotero.Item('journalArticle');unknown.libraryID=Zotero.Libraries.userLibraryID;unknown.setField('title','Workspace native unknown outcome');unknown.setField('abstractNote','Experiments directly measure proton transport through a membrane.');unknown.addTag(MANUAL,0);await unknown.saveTx();
  await withSelection([unknown],()=>execute(workspace,'tag',{scope:'selected',processingPolicy:'auto-clear'}));
  await until(async()=>{const model=await query(workspace,'activity');return model.recoveryRequests?.some(request=>request.status==='unknown');},'unknown request recovery');
  const failed=await report(config);await execute(workspace,'resume');await sleep(300);check('nativeUnknownOutcomeIsNotAutomaticallyResent',(await report(config)).assignments===failed.assignments);
  const activity=await query(workspace,'activity'),recovery=activity.recoveryRequests.find(request=>request.status==='unknown'),manager=await Zotero.SmartTags.openManager({page:'activity'});
  await config.progress?.('native-workflow-recovery-keyboard');
  const stop=await until(()=>[...manager.document.querySelectorAll('#activity-recovery button')].find(button=>button.textContent==='Stop this attempt'),'native recovery Stop control');stop.scrollIntoView({block:'nearest'});manager.focus();stop.focus();
  const keyboard=Cc['@mozilla.org/text-input-processor;1'].createInstance(Ci.nsITextInputProcessor);if(!keyboard.beginInputTransactionForTests(manager))throw new Error('Cannot start isolated recovery keyboard input.');
  const enter=()=>new manager.KeyboardEvent('',{key:'Enter',code:'Enter',keyCode:13});keyboard.keydown(enter(),keyboard.KEY_NON_PRINTABLE_KEY);keyboard.keyup(enter(),keyboard.KEY_NON_PRINTABLE_KEY);
  await until(async()=>{const model=await query(workspace,'activity');return model.recoveryRequests?.some(request=>request.id===recovery.id&&request.status==='stopped');},'stopped request recovery');
  check('nativeRecoveryCanBeStoppedWithKeyboard',!(await Zotero.Items.getAsync(unknown.id)).getTags().some(tag=>tag.tag===NAME));check('nativeRecoveryKeepsCompletedResults',removed.every(id=>!nativeState(values).find(item=>item.id===id).tags.some(tag=>tag.tag===NAME)));
  const recovered=await report(config);check('nativeRecoveryAddsNoRetryCharge',recovered.assignments===failed.assignments);check('nativeRecoveryNeverUsesRealNetwork',recovered.blocked===0);
  return {undonePapers:removed.length,assignmentRequests:recovered.assignments,providerRequests:recovered.total};
}
