/** TEST ONLY. Representative preparation and safe live switching in the isolated profile. */
import { initialState } from '../src/controller.ts';
import { fingerprint, paperFingerprint } from '../src/core.ts';
import { createRegistrySnapshot } from '../src/evidence.ts';
import { normalizeFacts } from '../src/taxonomy.ts';
import { createTagSelection } from '../src/tag-selection.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
const button=(doc,label)=>[...doc.querySelectorAll('button')].find(value=>value.textContent===label||value.getAttribute('aria-label')===label);
async function until(predicate,label){const started=Date.now();while(Date.now()-started<30_000){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Native v0.8.0 timeout: '+label);}
function inputData(prompt){const marker='INPUT_DATA_JSON:',start=prompt.lastIndexOf(marker);if(start<0)throw new Error('Synthetic representative request has no input data.');return JSON.parse(prompt.slice(start+marker.length));}
function planReply(data){return {tags:data.conceptRegistry.filter(entry=>entry.sources[0].label.startsWith('factor ')).map((entry,index)=>({key:`factor-${index}`,name:entry.sources[0].label,fullName:entry.sources[0].label,description:`The measured scientific phenomenon ${entry.sources[0].label}.`,facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[entry.registryId]})),merges:[],excluded:[]};}
function mappingReply(data){
  if(data.requestedPairs)return {judgements:data.requestedPairs.map(pair=>{const tag=data.tags.find(tag=>tag.id===pair.tagId),source=data.sources.find(source=>source.sourceId===pair.sourceId),matches=tag.name===source.name||tag.fullName===source.name;return {pairRef:pair.pairRef,relation:matches?'equivalent':'unrelated',reason:matches?'The quotation establishes the requested phenomenon exactly.':'The quotation concerns a separate component or method.'};})};
  const judgements=[],outside=[];
  for(const source of data.sources){const tag=data.tags.find(tag=>tag.name===source.name),entry=data.permittedRegistry.find(entry=>entry.sourceIds.includes(source.sourceId));if(tag)judgements.push({tagId:tag.id,registryId:entry.registryId,sourceIds:[source.sourceId],relation:'equivalent',reason:'The quotation establishes this exact phenomenon.'});else outside.push({sourceIds:[source.sourceId],disposition:'outside-core',reason:'This separate component or method is outside the chosen phenomenon list.'});}
  return {judgements,outside};
}

export async function runNativeV080(app,check,config){
  check('v080IsolatedDataGuard',normalized(Zotero.DataDirectory.dir)===normalized(config.data));
  check('v080IsolatedProfileGuard',normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile));
  const before=clone(app.state),host=app.env.host,librarySnapshot=app.env.librarySnapshot,ai=app.env.ai,complete=ai.completeJson,session=ai.getSession;
  const main=Zotero.getMainWindow(),navigator=Zotero.SmartTags.getNavigator(main),mode=navigator?.mode,columns=()=>JSON.stringify(main.ZoteroPane.itemsView.getColumns().map(column=>[column.dataKey,column.hidden,column.width,column.ordinal])),columnsBefore=columns();
  let manager,nativeWrites=0,pdfReads=0,inFlight=0,maximum=0,legacyMaps=0,representativeMaps=0,holdRepresentative=true,releaseLegacy;
  const legacyGate=new Promise(resolve=>{releaseLegacy=resolve;}),calls=[],legacySignals=[];
  try{
    await navigator?.setMode('collections');app.state=initialState();app.state.tags=[];Object.assign(app.state.settings,{provider:'chatgpt',model:'native-v080-synthetic',autoAssign:false,maxOutputTokens:4096,coreConceptLimit:60});
    for(let topic=0;topic<60;topic++)for(let example=0;example<3;example++){
      const concepts=[['phenomenon',`factor ${fingerprint('v080-topic-'+topic)}`],['component',`component ${fingerprint(`v080-component-${topic}-${example}`)}`],['method',`method ${fingerprint(`v080-method-${topic}-${example}`)}`]].map(([facet,name])=>({name,facet,evidence:[{source:'abstract',text:`Measurements establish ${name} in this experimental device.`}]}));
      const paper={id:`v080-shadow-${topic}-${example}`,itemID:800_000+topic*3+example,libraryID:Zotero.Libraries.userLibraryID,key:`V080${topic}X${example}`,title:`V080QA topic ${topic} example ${example}`,abstract:concepts.map(concept=>concept.evidence[0].text).join(' '),keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);app.state.papers[paper.id]=paper;app.state.nativeTags[paper.id]=[{tag:'Manual synthetic project',type:0}];app.state.facts[paper.id]=normalizeFacts({summary:'A retained experimental measurement.',concepts,needsPDF:false},paper,'retained-synthetic','retained-model');
    }
    const facts=Object.values(app.state.facts).sort((a,b)=>a.paperId.localeCompare(b.paperId)),existing=app.consolidationDefinitions(),registry=createRegistrySnapshot(facts,app.state.evidenceCatalog);
    const legacy=createTagSelection(facts,existing,registry,{plannerVersion:3,targetCount:60,maxOutputTokens:4096,baseVersion:app.state.vocabularyVersion});
    app.state.run={id:'v080-switch-and-resume',kind:'rebuild',scope:'library',automatic:false,status:'paused',jobs:facts.map(fact=>({id:`job-${fact.paperId}`,paperId:fact.paperId,status:'completed'})),vocabCursor:0,vocabFinished:false,message:'Retained analysis ready.',spentUSD:0.3,settings:clone(app.state.settings),vocabularyVersion:app.state.vocabularyVersion,selection:legacy,selectionInputFingerprint:fingerprint({protocolVersion:2,facts,existing,limit:60,baseVersion:app.state.vocabularyVersion})};
    const factsBefore=fingerprint(app.state.facts),nativeBefore=fingerprint(app.state.nativeTags);
    app.env.host={...host,async list(){return clone(Object.values(app.state.papers));},async read(itemID){return clone(Object.values(app.state.papers).find(paper=>paper.itemID===itemID)??null);},async readTags(itemID){const paper=Object.values(app.state.papers).find(paper=>paper.itemID===itemID);return clone(paper?app.state.nativeTags[paper.id]:[]);},async pdfText(){pdfReads++;throw new Error('Retained complete facts need no extraction.');},async apply(){nativeWrites++;throw new Error('Preparing a list cannot write native tags.');}};
    app.env.librarySnapshot=async()=>({papers:clone(Object.values(app.state.papers)),nativeTags:clone(app.state.nativeTags)});ai.getSession=async()=>({connected:true,sharing:true,email:null,accountId:'native-synthetic',accounts:[]});
    ai.completeJson=async(_system,prompt,_settings,signal)=>{
      const data=inputData(prompt),kind=prompt.startsWith('Consolidation protocol v2')?'plan':prompt.startsWith('Prepare a scientific tag vocabulary')?'map':undefined;if(!kind)throw new Error('Representative preparation must reuse cached extraction.');
      const policy=data.selectionPolicyVersion;calls.push({id:data.requestId,kind,policy});inFlight++;maximum=Math.max(maximum,inFlight);
      try{
        if(kind==='map'&&policy===3){legacyMaps++;legacySignals.push(signal);await legacyGate;}
        if(kind==='map'&&policy===4&&++representativeMaps>=2&&holdRepresentative)await new Promise((resolve,reject)=>{if(signal?.aborted){reject(new Error('Synthetic representative pause.'));return;}signal?.addEventListener('abort',()=>reject(new Error('Synthetic representative pause.')),{once:true});});
        const value=kind==='plan'?planReply(data):mappingReply(data);return {value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:20,outputTokens:20},estimatedCostUSD:0};
      }finally{inFlight--;}
    };
    await app.save();manager=await Zotero.SmartTags.openManager({page:'activity'});await until(()=>manager.document.getElementById('app')?.getAttribute('data-smart-tags-state')==='ready','Activity ready');await app.invoke('resume');
    await until(()=>legacyMaps===2&&button(manager.document,'Use faster build')&&!button(manager.document,'Use faster build').disabled,'running older build switch');
    const missingId=facts[0].paperId,missingBefore=fingerprint(app.state.facts[missingId]);delete app.state.facts[missingId];
    button(manager.document,'Use faster build').click();
    await until(()=>app.state.run.fasterBuild&&button(manager.document,'Switching to faster build…'),'pending switch');
    check('v080LiveSwitchLetsCurrentCallsFinish',legacySignals.every(signal=>!signal.aborted)&&inFlight===2&&button(manager.document,'Switching to faster build…').disabled);
    releaseLegacy();await until(()=>app.state.run.selection.policyVersion===4&&representativeMaps>=2&&app.state.run.selection.tasks.some(task=>!task.superseded&&task.pairIds?.length&&task.status==='completed'),'representative mapping persisted');
    const archived=app.state.tagSelectionHistory.find(entry=>entry.work.id===legacy.id);
    check('v080LegacyRawWorkIsRetainedDuringSwitch',!!archived&&archived.work.tasks.filter(task=>task.kind==='map'&&task.status==='completed').length===2&&archived.work.tasks.every(task=>task.attempts.every(attempt=>typeof attempt.raw==='string')));
    check('v081MissingCacheRecoversFromUnchangedEvidence',fingerprint(app.state.facts[missingId])===missingBefore&&pdfReads===0);
    await app.invoke('pause');await app.waitForIdle();
    const completed=new Set(app.state.run.selection.tasks.filter(task=>!task.superseded&&task.pairIds?.length&&task.status==='completed').map(task=>task.id)),resumeAt=calls.length;
    check('v080RepresentativeChecksPersistBeforeRestart',completed.size>0&&(await app.snapshot()).queue.selection.verificationScope==='representative');
    app.state=clone(app.state);holdRepresentative=false;await app.invoke('resume');await app.waitForIdle();
    check('v080RepresentativeBuildFinishesWithSixtyTags',app.state.run.status==='idle'&&app.state.run.selection.policyVersion===4&&app.state.tagPreparation?.status==='ready'&&app.state.taxonomyProposal.tags.filter(tag=>!tag.custom).length===60,{status:app.state.run.status,message:app.state.run.message,preparation:app.state.tagPreparation?.status,tags:app.state.taxonomyProposal?.tags.filter(tag=>!tag.custom).length});
    check('v080RestartReusesCompletedChecksAndFrozenChoice',calls.slice(resumeAt).every(call=>call.kind==='map'&&!completed.has(call.id))&&calls.filter(call=>call.kind==='plan').length===1&&maximum===2,{maximum,requests:calls.length});
    await until(()=>button(manager.document,'Open tags'),'ready representative list action');
    const readyProgress=(await app.snapshot()).queue.selection;if(readyProgress.tagsPrepared!==60||readyProgress.examplesChecked!==readyProgress.examplesTotal)throw new Error('Completed representative checks were not preserved.');
    check('v080ProgressDoesNotClaimExhaustiveVerification',!manager.document.body.textContent.includes('Supporting findings checked:')&&!manager.document.body.textContent.includes('540 of 540'));
    await Zotero.SmartTags.openManager({page:'cleanup'});await until(()=>manager.document.body.textContent.includes('verified example papers')&&button(manager.document,'Apply tag list')&&!button(manager.document,'Apply tag list').disabled,'verified examples review');
    const beforeApply=calls.length;button(manager.document,'Apply tag list').click();await until(()=>app.state.taxonomyReady&&!app.state.tagPreparation&&manager.document.getElementById('assignment-scope'),'independent assignment setup');await app.waitForIdle();
    check('v080ApplySavesOnlyDefinitions',calls.length===beforeApply&&app.state.run.kind==='rebuild'&&!app.state.suggestions.length&&nativeWrites===0&&pdfReads===0&&!app.state.settings.autoAssign);
    check('v080CachedEvidenceNativeTagsAndColumnsStayIntact',fingerprint(app.state.facts)===factsBefore&&fingerprint(app.state.nativeTags)===nativeBefore&&columns()===columnsBefore&&app.state.run.spentUSD===0.3);
    const freshStart=calls.length;app.env.host.list=async()=>clone(Object.values(app.state.papers).filter(paper=>paper.id.startsWith('v080-shadow-0-')));
    await app.invoke('prepare-tags',{scope:'selected',mode:'replace'});await app.waitForIdle();
    const freshCalls=calls.slice(freshStart),freshGlobalChooserCount=freshCalls.filter(call=>call.kind==='plan').length;
    check('v080FreshBuildDefaultsToRepresentativeChecks',app.state.run.selection.policyVersion===4&&app.state.run.status==='idle'&&app.state.tagPreparation?.status==='ready'&&app.state.run.jobs.length===3&&freshGlobalChooserCount===1&&freshCalls.every(call=>call.policy===4),{status:app.state.run.status,message:app.state.run.message,freshGlobalChooserCount});
    check('v080FreshBuildReusesCachedFactsWithoutAssignment',fingerprint(app.state.facts)===factsBefore&&fingerprint(app.state.nativeTags)===nativeBefore&&nativeWrites===0&&pdfReads===0&&!app.state.suggestions.length&&!app.state.settings.autoAssign);
    return {topics:60,papers:180,retainedFindings:540,syntheticProviderRequests:calls.length,maximumConcurrentRequests:maximum,serializedResume:true,freshGlobalChooserCount,realAIRequests:0,nativeTagWrites:nativeWrites,pdfExtractions:pdfReads};
  }finally{
    releaseLegacy();if(app.state.run?.status==='running'){app.state.run.status='paused';app.abort?.abort();}await app.waitForIdle();if(manager&&!manager.closed)manager.close();ai.completeJson=complete;ai.getSession=session;app.env.host=host;app.env.librarySnapshot=librarySnapshot;app.state=before;await app.save();await navigator?.refresh();if(mode)await navigator?.setMode(mode);
  }
}
