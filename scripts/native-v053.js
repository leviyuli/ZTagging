/** TEST ONLY. Retained legacy work stays immutable while the finite selector uses cached facts. */
import { initialState } from '../src/controller.ts';
import { fingerprint, paperFingerprint } from '../src/core.ts';
import { createRegistrySnapshot, ensureFactConceptIds } from '../src/evidence.ts';
import { createConsolidationWork, acceptConsolidationResult, nextConsolidationRequest } from '../src/library-consolidation.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
async function until(predicate,label){const started=Date.now();while(Date.now()-started<25_000){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Native v0.5.3 timeout: '+label);}
function inputData(prompt){const marker='INPUT_DATA_JSON:';const start=prompt.lastIndexOf(marker);if(start<0)throw new Error('The synthetic consolidation request has no input data.');return JSON.parse(prompt.slice(start+marker.length));}
function stageReply(data){
  const registry=!!data.conceptRegistry,entries=data.conceptRegistry??data.candidates??[];
  return {tags:entries.map((entry,index)=>{const name=registry?entry.sources[0].label:entry.name;return {key:`topic-${index}`,name,fullName:name,description:'An experimentally established scientific topic.',facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],...(registry?{supportRegistryIds:[entry.registryId]}:{supportCandidateIds:[entry.candidateId]})};}),merges:[],excluded:[]};
}
function compactPlan(data){
  const entries=data.conceptRegistry,chosen=[entries[0],entries.at(-1)];
  return {tags:chosen.map((entry,index)=>({key:`selected-${index}`,name:entry.sources[0].label,fullName:entry.sources[0].label,description:'An experimentally established scientific topic.',facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[entry.registryId]})),merges:[],excluded:[]};
}
function mapFindings(data){
  const judgements=[],outside=[];
  for(const source of data.sources){
    const sourceId=source.sourceId??source.factConceptId,entry=data.permittedRegistry.find(value=>value.sourceIds.includes(sourceId)),tag=data.tags.find(value=>value.name===source.name||value.fullName===source.name);
    if(tag)judgements.push({tagId:tag.id,registryId:entry.registryId,sourceIds:[sourceId],relation:'equivalent',reason:'The validated quotation establishes this exact scientific topic.'});
    else outside.push({sourceIds:[sourceId],reason:'This separate finding remains outside the selected compact tag list.',disposition:'outside-core'});
  }
  return {judgements,outside,questions:[]};
}

function retainedLibrary(){
  const state=initialState();state.tags=[];Object.assign(state.settings,{provider:'deepseek',model:'native-v053-synthetic',autoAssign:false,inputPricePerMillion:0.01,outputPricePerMillion:0.01,budgetUSD:10});
  for(let index=0;index<64;index++){
    const quotations=Array.from({length:4},(_,concept)=>`Synthetic phenomenon ${index*4+concept} is established by this experiment. ${'The supporting scientific measurement is reported in the supplied abstract. '.repeat(20)}`);
    const paper={id:`v053-shadow-${index}`,itemID:500_000+index,libraryID:Zotero.Libraries.userLibraryID,key:`V053${index}`,title:`V053QA scientific experiment ${index}`,abstract:quotations.join(' '),keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);
    state.papers[paper.id]=paper;state.nativeTags[paper.id]=[{tag:'Manual synthetic project',type:0}];
    state.facts[paper.id]={paperId:paper.id,metadataFingerprint:paper.fingerprint,inputFingerprint:paper.fingerprint,provider:'retained-synthetic',model:'retained-model',extractionVersion:1,summary:'A retained validated scientific synopsis. '.repeat(30),needsPDF:false,concepts:quotations.map((text,concept)=>({name:`synthetic phenomenon ${index*4+concept}`,facet:'phenomenon',evidence:[{source:'abstract',text}]}))};
  }
  const facts=Object.values(state.facts).sort((a,b)=>a.paperId.localeCompare(b.paperId));ensureFactConceptIds(facts);
  const snapshot=createRegistrySnapshot(facts,state.evidenceCatalog);let work=createConsolidationWork(facts,[],snapshot,60);
  const completedRequest=nextConsolidationRequest(work);work=acceptConsolidationResult(work,completedRequest.id,stageReply(inputData(completedRequest.prompt)));
  const pending=work.tasks.filter(task=>!task.completed),ids=pending.flatMap(task=>task.inputIds);
  if(ids.length<172)throw new Error('The synthetic fixture needs a retained large legacy part.');
  const legacy={...clone(pending[0]),id:'v053-legacy-large-part',inputIds:ids.slice(0,172)},tail={...clone(pending[0]),id:'v053-retained-tail',inputIds:ids.slice(172)};
  work.tasks=[...work.tasks.filter(task=>task.completed),legacy,...(tail.inputIds.length?[tail]:[])];
  state.run={id:'v053-retained-library',kind:'rebuild',scope:'library',automatic:false,status:'paused',jobs:Object.keys(state.papers).map(paperId=>({id:`v053-job-${paperId}`,paperId,status:'completed'})),vocabCursor:0,vocabFinished:false,message:'Ready to continue the saved tag list.',spentUSD:0.628,settings:clone(state.settings),vocabularyVersion:state.vocabularyVersion,consolidation:{protocolVersion:2,generationId:'v053-retained-proposal',inputFingerprint:fingerprint({protocolVersion:2,facts,existing:[],limit:60,baseVersion:state.vocabularyVersion}),snapshot,candidateIds:{},correctionAttempts:0,phase:'generating',work}};
  return {state,completedId:completedRequest.id};
}

export async function runNativeV053(app,check,config){
  check('v053IsolatedDataGuard',normalized(Zotero.DataDirectory.dir)===normalized(config.data));
  check('v053IsolatedProfileGuard',normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile));
  const before=clone(app.state),host=app.env.host,librarySnapshot=app.env.librarySnapshot,ai=app.env.ai,complete=ai.completeJson,hasApiKey=ai.hasApiKey;
  const main=Zotero.getMainWindow(),navigator=Zotero.SmartTags.getNavigator(main),mode=navigator?.mode;
  const fixture=retainedLibrary(),factsBefore=fingerprint(fixture.state.facts),nativeBefore=fingerprint(fixture.state.nativeTags),legacyBefore=fingerprint(fixture.state.run.consolidation),calls=[];
  let manager,nativeWrites=0,pdfReads=0;
  try{
    await navigator?.setMode('collections');app.state=fixture.state;
    app.env.host={...host,async list(){return clone(Object.values(app.state.papers));},async read(itemID){return clone(Object.values(app.state.papers).find(paper=>paper.itemID===itemID)??null);},async readTags(itemID){const paper=Object.values(app.state.papers).find(paper=>paper.itemID===itemID);return clone(paper?app.state.nativeTags[paper.id]:[]);},async pdfText(){pdfReads++;throw new Error('Retained facts must not request PDF extraction.');},async apply(){nativeWrites++;throw new Error('Consolidation cannot write native paper tags.');}};
    app.env.librarySnapshot=async()=>({papers:clone(Object.values(app.state.papers)),nativeTags:clone(app.state.nativeTags)});ai.hasApiKey=async()=>true;
    ai.completeJson=async(_system,prompt)=>{
      const data=inputData(prompt),kind=prompt.startsWith('Consolidation protocol v2')?'plan':prompt.startsWith('Prepare a scientific tag vocabulary')?'map':undefined;
      if(!kind)throw new Error('Retained facts must not be extracted or routed through legacy batches.');calls.push({kind,id:data.requestId});
      const value=kind==='plan'?compactPlan(data):mapFindings(data);
      return {value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:10,outputTokens:10},estimatedCostUSD:0.001};
    };
    await app.save();manager=await Zotero.SmartTags.openManager({page:'activity'});await until(()=>manager.document.getElementById('app')?.getAttribute('data-smart-tags-state')==='ready','Activity ready');
    await app.invoke('resume');await app.waitForIdle();
    const run=app.state.run;
    check('v053FiniteSelectionUsesRetainedFacts',run.status==='idle'&&app.state.tagPreparation?.status==='ready'&&run.selection?.status==='ready',{status:run.status,message:run.message,preparation:app.state.tagPreparation?.status,calls:calls.length});
    check('v053LegacyCheckpointAndCompletedPartsStayImmutable',fingerprint(run.consolidation)===legacyBefore&&run.consolidation.work.tasks.find(task=>task.id===fixture.completedId)?.completed);
    check('v053OneGlobalPlanReplacesLegacyBatchReduction',calls.filter(call=>call.kind==='plan').length===1&&calls.some(call=>call.kind==='map')&&calls.every(call=>!run.consolidation.work.tasks.some(task=>task.id===call.id))&&app.state.taxonomyProposal.tags.filter(tag=>!tag.custom).length===2,{calls});
    check('v053RetainedFactsAndNativeTagsUnchanged',fingerprint(app.state.facts)===factsBefore&&fingerprint(app.state.nativeTags)===nativeBefore&&nativeWrites===0&&pdfReads===0&&run.jobs.every(job=>job.status==='completed')&&run.spentUSD>=0.628);
    await until(()=>manager.document.body.textContent.includes('Your tag list is ready'),'ready tag list');
    check('v053ActivityShowsRemainingRatherThanFalseTotal',!manager.document.body.textContent.includes('estimated total')&&manager.document.body.textContent.includes('Estimated cost so far'));
    return {papers:64,concepts:256,legacyPartInputs:172,syntheticProviderRequests:calls.length,realAIRequests:0,nativeTagWrites:nativeWrites,pdfExtractions:pdfReads,legacyCheckpointUnchanged:true,finiteGlobalSelection:true};
  }finally{
    if(app.state.run?.status==='running'){app.state.run.status='paused';app.abort?.abort();}await app.waitForIdle();if(manager&&!manager.closed)manager.close();ai.completeJson=complete;ai.hasApiKey=hasApiKey;app.env.host=host;app.env.librarySnapshot=librarySnapshot;app.state=before;await app.save();await navigator?.refresh();if(mode)await navigator?.setMode(mode);
  }
}
