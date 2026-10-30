/** TEST ONLY. Finite global selection and resumable source mapping in the isolated profile. */
import { initialState } from '../src/controller.ts';
import { fingerprint, paperFingerprint } from '../src/core.ts';
import { normalizeFacts } from '../src/taxonomy.ts';
import { createRegistrySnapshot } from '../src/evidence.ts';
import { createTagSelection } from '../src/tag-selection.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
async function until(predicate,label){const started=Date.now();while(Date.now()-started<25_000){const result=predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Native v0.7.0 timeout: '+label);}
function inputData(prompt){const marker='INPUT_DATA_JSON:',start=prompt.lastIndexOf(marker);if(start<0)throw new Error('Synthetic finite selection has no input data.');return JSON.parse(prompt.slice(start+marker.length));}
function planReply(data){const ohmic=data.conceptRegistry.find(entry=>entry.sources.some(source=>source.label==='ohmic resistance')),selected=[ohmic,data.conceptRegistry.findLast(entry=>entry!==ohmic)];return {tags:selected.map((entry,index)=>({key:`selected-${index}`,name:entry.sources[0].label,fullName:entry.sources[0].label,description:'An experimentally established scientific topic.',facet:entry.sources[0].facet,aliases:index===0?['RCL']:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[entry.registryId]})),merges:[],excluded:[]};}
function mappingReply(data){
  const judgements=[],outside=[];
  for(const source of data.sources){const sourceId=source.sourceId??source.factConceptId,entry=data.permittedRegistry.find(value=>value.sourceIds.includes(sourceId)),tag=data.tags.find(value=>value.name===source.name||value.fullName===source.name);if(tag)judgements.push({tagId:tag.id,registryId:entry.registryId,sourceIds:[sourceId],relation:'equivalent',reason:'The source quotation establishes this exact scientific topic.'});else outside.push({sourceIds:[sourceId],reason:'This separate finding is outside the two selected core topics.',disposition:'outside-core'});}
  return {judgements,outside,questions:[]};
}

export async function runNativeV070(app,check,config){
  check('v070IsolatedDataGuard',normalized(Zotero.DataDirectory.dir)===normalized(config.data));
  check('v070IsolatedProfileGuard',normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile));
  const before=clone(app.state),host=app.env.host,librarySnapshot=app.env.librarySnapshot,ai=app.env.ai,complete=ai.completeJson,session=ai.getSession,snapshot=app.snapshot;
  const main=Zotero.getMainWindow(),navigator=Zotero.SmartTags.getNavigator(main),mode=navigator?.mode,calls=[],progress=[];
  let manager,nativeWrites=0,pdfReads=0,inFlight=0,maxInFlight=0,mappingCalls=0,holdSecond=true,firstSources=[],chooseVisible=false,mappingVisible=false;
  try{
    await navigator?.setMode('collections');app.state=initialState();app.state.tags[0].status='approved';const diyBefore=clone(app.state.tags[0]);Object.assign(app.state.settings,{provider:'chatgpt',model:'native-v070-synthetic',autoAssign:false,maxOutputTokens:512,coreConceptLimit:2});
    for(let paperIndex=0;paperIndex<2;paperIndex++){
      const concepts=Array.from({length:33},(_,index)=>{const facet=paperIndex===0&&index>0?'component':'phenomenon',name=paperIndex===0&&index===0?'ohmic resistance':`synthetic ${facet} ${paperIndex*33+index}`;return {name,facet,evidence:[{source:'abstract',text:`The experiment establishes ${name} using the reported measurement.`}]};});
      const paper={id:`v070-shadow-${paperIndex}`,itemID:700_000+paperIndex,libraryID:Zotero.Libraries.userLibraryID,key:`V070${paperIndex}`,title:`V070QA retained paper ${paperIndex}`,abstract:concepts.map(concept=>concept.evidence[0].text).join(' '),keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);app.state.papers[paper.id]=paper;app.state.nativeTags[paper.id]=[{tag:'Manual synthetic project',type:0}];app.state.facts[paper.id]=normalizeFacts({summary:'Retained scientific findings.',concepts,needsPDF:false},paper,'retained-synthetic','retained-model');
    }
    app.state.run={id:'v070-finite-selection',kind:'rebuild',scope:'selected',automatic:false,status:'paused',jobs:Object.keys(app.state.papers).map(paperId=>({id:`job-${paperId}`,paperId,status:'completed'})),vocabCursor:0,vocabFinished:false,message:'Resume retained source checking.',spentUSD:0,settings:clone(app.state.settings),vocabularyVersion:app.state.vocabularyVersion};
    const facts=Object.values(app.state.facts).sort((a,b)=>a.paperId.localeCompare(b.paperId)),existing=app.consolidationDefinitions(),registry=createRegistrySnapshot(facts,app.state.evidenceCatalog);
    app.state.run.selection=createTagSelection(facts,existing,registry,{plannerVersion:3,targetCount:2,maxOutputTokens:512,baseVersion:app.state.vocabularyVersion});
    app.state.run.selectionInputFingerprint=fingerprint({protocolVersion:2,facts,existing,limit:2,baseVersion:app.state.vocabularyVersion});
    const factsBefore=fingerprint(app.state.facts),nativeBefore=fingerprint(app.state.nativeTags);
    app.env.host={...host,async list(){return clone(Object.values(app.state.papers));},async read(itemID){return clone(Object.values(app.state.papers).find(paper=>paper.itemID===itemID)??null);},async readTags(itemID){const paper=Object.values(app.state.papers).find(paper=>paper.itemID===itemID);return clone(paper?app.state.nativeTags[paper.id]:[]);},async pdfText(){pdfReads++;throw new Error('The retained complete facts need no PDF extraction.');},async apply(){nativeWrites++;throw new Error('Selection and mapping cannot write native paper tags.');}};
    app.env.librarySnapshot=async()=>({papers:clone(Object.values(app.state.papers)),nativeTags:clone(app.state.nativeTags)});ai.getSession=async()=>({connected:true,sharing:true,email:null,accountId:'native-synthetic',accounts:[]});
    app.snapshot=async function(){const value=await snapshot.call(this);if(this.state.run?.id==='v070-finite-selection'&&value.queue.selection)progress.push(clone(value.queue.selection));return value;};
    ai.completeJson=async(_system,prompt,_settings,signal)=>{
      const data=inputData(prompt),kind=prompt.startsWith('Consolidation protocol v2')?'plan':prompt.startsWith('Prepare a scientific tag vocabulary')?'map':undefined;if(!kind)throw new Error('Finite selection must reuse completed extraction.');
      const sourceIds=(data.sources??[]).map(source=>source.sourceId??source.factConceptId);calls.push({kind,id:data.requestId,sourceIds});inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
      try{
        if(kind==='plan'){await until(()=>manager.document.body.textContent.includes('Choosing tags'),'Choosing tags status');chooseVisible=true;}
        else{
          const mappingNumber=++mappingCalls;await until(()=>manager.document.body.textContent.includes('Checking supporting findings'),'support checking status');mappingVisible=true;
          if(mappingNumber===1){firstSources=sourceIds;await until(()=>mappingCalls>=2,'second bounded mapping request');}
          if(mappingNumber===2&&holdSecond)await new Promise((resolve,reject)=>{if(signal?.aborted){reject(new Error('Synthetic mapping paused.'));return;}signal?.addEventListener('abort',()=>reject(new Error('Synthetic mapping paused.')),{once:true});});
        }
        const value=kind==='plan'?planReply(data):mappingReply(data);return {value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:50,outputTokens:50},estimatedCostUSD:0};
      }finally{inFlight--;}
    };
    await app.save();manager=await Zotero.SmartTags.openManager({page:'activity'});await until(()=>manager.document.getElementById('app')?.getAttribute('data-smart-tags-state')==='ready','Activity ready');await app.invoke('resume');
    await until(()=>mappingCalls>=2&&app.state.run.selection?.tasks.some(task=>task.kind==='map'&&task.status==='completed'),'first source batch persisted');
    await app.invoke('pause');await app.waitForIdle();
    check('v070MappingUsesAtMostTwoRequestsAtOnce',maxInFlight===2,{maximum:maxInFlight});
    const completedIds=new Set(app.state.run.selection.tasks.filter(task=>task.kind==='map'&&task.status==='completed').map(task=>task.id)),resumeAt=calls.length,sourceCountBefore=Object.values(app.state.run.selection.sourceLedger).filter(source=>source.status!=='pending').length;
    check('v070CompletedSourceMappingIsSavedBeforePause',completedIds.size>0&&sourceCountBefore>0&&firstSources.length>0);
    app.state=clone(app.state);holdSecond=false;await app.invoke('resume');await app.waitForIdle();await app.snapshot();
    check('v070FiniteGlobalChoiceReachesReview',app.state.run.status==='idle'&&app.state.run.selection?.status==='ready'&&app.state.tagPreparation?.status==='ready'&&app.state.taxonomyProposal.tags.filter(tag=>!tag.custom).length===2,{status:app.state.run.status,message:app.state.run.message,selection:app.state.run.selection?.status,preparation:app.state.tagPreparation?.status});
    const ohmic=app.state.taxonomyProposal.tags.find(tag=>!tag.custom&&tag.name==='ohmic resistance');
    check('v071GeneratedRCLAliasIsWithheldWithoutChangingDIY',!!ohmic&&!ohmic.aliases.includes('RCL')&&fingerprint(app.state.taxonomyProposal.tags.find(tag=>tag.id===diyBefore.id))===fingerprint(diyBefore)&&fingerprint(app.state.tags.find(tag=>tag.id===diyBefore.id))===fingerprint(diyBefore));
    check('v070SerializedResumeDoesNotRepeatCompletedRequests',calls.filter(call=>call.kind==='plan').length===1&&calls.slice(resumeAt).every(call=>!completedIds.has(call.id))&&calls.slice(resumeAt).filter(call=>call.kind==='map').every(call=>call.sourceIds.every(id=>!firstSources.includes(id))));
    const ledger=Object.values(app.state.run.selection.sourceLedger);
    check('v070EveryFindingHasOnePersistentOutcome',ledger.length===66&&ledger.every(source=>source.status!=='pending')&&progress.length>0&&progress.every(value=>value.sourceTotal===66)&&progress.at(-1).sourceCompleted===66,{outcomes:ledger.reduce((counts,source)=>({...counts,[source.status]:(counts[source.status]??0)+1}),{}),snapshots:progress.length});
    await until(()=>manager.document.body.textContent.includes('Supporting findings checked: 66 of 66'),'completed findings progress');
    const progressDetails=[...manager.document.querySelectorAll('details')].find(panel=>panel.querySelector('summary')?.textContent==='Details');if(!progressDetails)throw new Error('Missing activity request details.');if(!progressDetails.open)progressDetails.querySelector('summary').click();
    check('v070PlainProgressHasNoInventedETA',chooseVisible&&mappingVisible&&manager.document.body.textContent.includes('requests completed')&&manager.document.body.textContent.includes('Tag selection repairs')&&manager.document.body.textContent.includes('Source check corrections')&&!/\bETA\b|minutes remaining|estimated time/i.test(manager.document.body.textContent));
    check('v070FactsNativeTagsAndAutomationRemainUnchanged',fingerprint(app.state.facts)===factsBefore&&fingerprint(app.state.nativeTags)===nativeBefore&&nativeWrites===0&&pdfReads===0&&!app.state.settings.autoAssign);
    return {papers:2,findings:66,plannedCoreTags:2,syntheticProviderRequests:calls.length,maximumConcurrentRequests:maxInFlight,serializedResume:true,realAIRequests:0,pdfExtractions:pdfReads,nativeTagWrites:nativeWrites};
  }finally{
    if(app.state.run?.status==='running'){app.state.run.status='paused';app.abort?.abort();}await app.waitForIdle();if(manager&&!manager.closed)manager.close();ai.completeJson=complete;ai.getSession=session;app.snapshot=snapshot;app.env.host=host;app.env.librarySnapshot=librarySnapshot;app.state=before;await app.save();await navigator?.refresh();if(mode)await navigator?.setMode(mode);
  }
}
