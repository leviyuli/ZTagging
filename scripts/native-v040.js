/** TEST ONLY. Human tag-preparation workflow in the exact isolated profile and data directory. */
import { initialState } from '../src/controller.ts';
import { normalizeFacts, createTaxonomyProposal } from '../src/taxonomy.ts';
import { createEmptyEvidenceCatalog, createRegistrySnapshot } from '../src/evidence.ts';
import { prepare, applyRepair } from '../src/tag-preparation.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label,limit=20_000){const start=Date.now();while(Date.now()-start<limit){const value=predicate();if(value)return value;await delay(30);}throw new Error('Native v0.4.0 timeout: '+label);}
const button=(doc,label)=>[...doc.querySelectorAll('button')].find(value=>value.textContent===label||value.getAttribute('aria-label')===label);
function inputData(prompt){const marker='INPUT_DATA_JSON:';const start=prompt.lastIndexOf(marker);if(start<0)throw new Error('Synthetic transport received no input data');return JSON.parse(prompt.slice(start+marker.length).replace(/^(?:\\n|\s)+/,''));}
const completed=value=>({value,usageKnown:true,usage:{inputTokens:100,outputTokens:100},estimatedCostUSD:0});

export async function runNativeV040(app,check,config){
  check('v040IsolatedDataGuard',normalized(Zotero.DataDirectory.dir)===normalized(config.data));
  check('v040IsolatedProfileGuard',normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile));
  check('v040StateSchema',app.state.schemaVersion===8);
  const before=clone(app.state),host=app.env.host,ai=app.env.ai,oldList=host.list,oldComplete=ai.completeJson,oldApply=host.apply,oldInvoke=app.invoke;
  const main=Zotero.getMainWindow(),navigator=Zotero.SmartTags.getNavigator(main),oldMode=navigator?.mode;
  const nativePaper=Object.values(before.papers).find(paper=>paper.title==='Smart Tags smoke: catalyst-layer resistance in PEM electrolysis');
  if(!nativePaper)throw new Error('V040QA requires the preceding synthetic electrolysis paper.');
  const item=await Zotero.Items.getAsync(nativePaper.itemID),nativeTags=JSON.stringify(item.getTags());
  let manager,phase='ready',requests=0,nativeWrites=0;
  const quote='We measure catalyst-layer resistance in PEM water electrolysis';
  const options={existingDefinitions:initialState().tags,provider:'chatgpt',model:'native-v040-test',targetCount:60};
  const open=async page=>{manager=await Zotero.SmartTags.openManager({page});await until(()=>manager.document.getElementById('app')?.getAttribute('data-smart-tags-state')==='ready','manager');return manager.document;};
  const close=()=>{if(manager&&!manager.closed)manager.close();manager=null;};
  const reset=()=>{app.state=initialState();app.state.settings={...before.settings,provider:'chatgpt',model:'native-v040-test',autoAssign:false};};
  try{
    await navigator?.setMode('collections');
    host.apply=async()=>{nativeWrites++;throw new Error('V040QA must not write native paper tags.');};
    host.list=async function(scope){return scope==='selected'?[await this.read(nativePaper.itemID)]:oldList.call(this,scope);};
    ai.completeJson=async function(_system,prompt){
      requests++;
      if(prompt.startsWith('Extract factual scientific concepts'))return completed({summary:'PEM water electrolysis and catalyst-layer resistance are studied.',concepts:[{name:'proton exchange membrane water electrolysis',facet:'system',evidence:[{source:'abstract',text:quote}]},{name:'catalyst-layer resistance',facet:'phenomenon',evidence:[{source:'abstract',text:quote}]}],needsPDF:false});
      if(prompt.startsWith('Consolidation protocol v2')){
        const data=inputData(prompt),entry=name=>data.conceptRegistry.find(value=>value.sources.some(source=>source.label===name)).registryId;
        const tags=[{key:'pemwe',name:'PEMWE',fullName:'proton exchange membrane water electrolysis',description:'Proton exchange membrane water electrolysis.',facet:'system',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[entry('proton exchange membrane water electrolysis')]}];
        if(phase==='question')tags.push({key:'resistance',name:'local resistance',fullName:'local resistance',description:'Transport losses within a catalyst layer.',facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[entry('catalyst-layer resistance')]});
        return completed({tags,merges:[],excluded:[]});
      }
      if(prompt.startsWith('Prepare a scientific tag vocabulary')){
        const data=inputData(prompt),judgements=[],outside=[],questions=[];
        for(const source of data.sources){
          const sourceId=source.sourceId??source.factConceptId,entry=data.permittedRegistry.find(value=>value.sourceIds.includes(sourceId)),technology=data.tags.find(value=>value.name==='PEMWE'),tag=data.tags.find(value=>value.name==='local resistance');
          if(source.name==='proton exchange membrane water electrolysis'&&technology)judgements.push({tagId:technology.id,registryId:entry.registryId,sourceIds:[sourceId],relation:'equivalent',reason:'The actual quotation explicitly studies PEM water electrolysis, grounding this established technology.'});
          else if(source.name==='catalyst-layer resistance'&&tag){
            judgements.push({tagId:tag.id,registryId:entry.registryId,sourceIds:[sourceId],relation:'needs-context',reason:'The source cannot choose the researcher’s preferred scope.'});
            questions.push({tagId:tag.id,sourceIds:[sourceId],kind:'scope',title:'Which resistance measurements should this tag include?',description:'Choose whether this topic follows catalyst-layer resistance or a broader set of transport losses.',choices:[{id:'layer',label:'Catalyst-layer resistance',description:'Use this tag for resistance inside the catalyst layer.',meaning:{description:'Resistance within the catalyst layer.'}},{id:'leave-out',label:'Leave these matches out',description:'Decide on a broader topic later.',exclude:true}]});
          }else outside.push({sourceIds:[sourceId],disposition:'outside-core',reason:'This separate finding is outside the selected technology tag.'});
        }
        return completed({judgements,outside,questions});
      }
      if(prompt.startsWith('You classify scientific papers')){
        const tag=app.state.tags.find(value=>value.name==='PEMWE');
        return completed({summary:'A PEM electrolysis paper.',concepts:['PEMWE'],suggestions:[{tagId:tag.id,confidence:'high',match:'substantive',reason:'The paper studies PEM water electrolysis.',evidence:[{source:'abstract',text:quote}]}],needsPDF:false});
      }
      throw new Error('Unexpected synthetic AI request: '+prompt.slice(0,90));
    };

    // A large local result has one real question, instead of hundreds of routine confirmations.
    reset();const sourcesByPaper=Array.from({length:51},()=>[]);let sourceNumber=0;
    for(let concept=0;concept<60;concept++)for(let repeat=0;repeat<(concept<8?8:7);repeat++){
      const name=concept===0?'ML':`research topic ${concept}`,text=`Synthetic source ${sourceNumber}: ${name}. `+'The paper studies transport responses and records the observed scientific context. '.repeat(14);
      sourcesByPaper[sourceNumber%51].push({name,facet:'phenomenon',evidence:[{source:'abstract',text}]});sourceNumber++;
    }
    const facts=sourcesByPaper.map((concepts,index)=>{const paper={...clone(nativePaper),id:`v040-shadow-${index}`,title:`V040QA paper ${index}`,abstract:concepts.map(value=>value.evidence[0].text).join('\n'),keywords:[],pdfText:undefined};app.state.papers[paper.id]=paper;return normalizeFacts({summary:'Synthetic scientific context.',concepts,needsPDF:false},paper,'native-synthetic','native-v040');});
    const catalog=createEmptyEvidenceCatalog(),snapshot=createRegistrySnapshot(facts,catalog),entries=Object.values(snapshot.entries);
    const raw={tags:entries.map((entry,index)=>({key:`large-${index}`,name:snapshot.sources[entry.sourceIds[0]].name,fullName:snapshot.sources[entry.sourceIds[0]].name,description:'Scientific transport context.',facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[entry.registryId]})),merges:[],excluded:[]};
    let large=prepare(createTaxonomyProposal(raw,facts,app.state.tags,{snapshot,candidateIds:{},generationId:'v040-large',limit:60}),undefined,options);
    const ml=large.proposal.tags.find(tag=>tag.name==='ML'),mlEntry=entries.find(entry=>snapshot.sources[entry.sourceIds[0]].name==='ML');
    large=applyRepair({judgements:[{tagId:ml.id,registryId:mlEntry.registryId,sourceIds:mlEntry.sourceIds,relation:'needs-context',reason:'The abbreviation has more than one possible meaning.'}],questions:[{tagId:ml.id,sourceIds:mlEntry.sourceIds,title:'What does ML mean in your tag list?',description:'Choose the topic you want to follow.',choices:[{id:'learning',label:'Machine learning',description:'Methods using learned models.'},{id:'layers',label:'Material layers',description:'Thin material layers in electrochemical devices.'}]}]},large,options);
    app.state.facts=Object.fromEntries(facts.map(fact=>[fact.paperId,fact]));app.state.evidenceCatalog=catalog;app.state.taxonomyProposal=large.proposal;app.state.tagPreparation=large.state;await app.save();
    const started=Date.now(),largeDoc=await open('cleanup');await until(()=>button(largeDoc,'Questions (1)'),'one meaningful question');const largeRenderMS=Date.now()-started;
    check('v040LargeCleanPreparation',facts.length===51&&Object.keys(snapshot.sources).length===428&&large.state.questions.length===1,{papers:51,sources:428,questions:large.state.questions.length,snapshotBytes:new TextEncoder().encode(JSON.stringify(snapshot)).length});
    check('v040LargeHumanUIFast',largeRenderMS<5000&&largeDoc.querySelectorAll('article.tag-row').length===20&&!largeDoc.querySelector('blockquote'),{milliseconds:largeRenderMS});
    check('v040NoRoutineProofControls',!button(largeDoc,'Confirm scientific mapping')&&!/\b(?:registry|fingerprint|staged|taxonomy)\b/i.test(largeDoc.body.textContent));
    close();

    // Exercise public preparation and apply actions against real local native metadata.
    reset();await app.save();await app.invoke('prepare-tags',{scope:'selected',mode:'replace'});await app.waitForIdle();
    check('v040CuratedTechnologyReadyWithoutQuestions',app.state.tagPreparation?.status==='ready'&&app.state.tagPreparation.questions.length===0&&app.state.taxonomyProposal.tags.some(tag=>tag.name==='PEMWE'&&tag.facet==='system'),{status:app.state.tagPreparation?.status,questions:app.state.tagPreparation?.questions.length,runMessage:app.state.run?.message,diagnostics:app.state.tagPreparation?.diagnostics});
    const doc=await open('cleanup');button(doc,'Edit tag PEMWE').click();await until(()=>doc.querySelector('.tag-editor'),'editor open');
    const advanced=doc.querySelector('.editor-advanced');advanced.open=true;await until(()=>advanced.open,'more options');
    const form=doc.querySelector('.editor-scroll');form.scrollTop=form.scrollHeight;
    const save=button(doc,'Save'),saveRect=save.getBoundingClientRect();
    check('v040EditorScrollKeepsSaveVisible',form.scrollTop>0&&!form.contains(save)&&saveRect.top>=0&&saveRect.bottom<=manager.innerHeight+1);
    const originalWidth=manager.outerWidth,originalHeight=manager.outerHeight;manager.resizeTo(820,640);await until(()=>manager.innerWidth<=900,'narrow editor');
    const narrow=button(doc,'Save').getBoundingClientRect();check('v040NarrowEditorKeepsSaveVisible',narrow.top>=0&&narrow.bottom<=manager.innerHeight+1);manager.resizeTo(originalWidth,originalHeight);
    const fullName=doc.getElementById('tag-full-name');fullName.value='PEM water electrolysis';fullName.dispatchEvent(new manager.Event('input',{bubbles:true}));
    check('v040UnsavedEditorBlocksApply',button(doc,'Apply tag list').disabled&&doc.body.textContent.includes('Save or cancel your edits'));
    button(doc,'Save').click();await until(()=>!doc.querySelector('.tag-editor')&&!button(doc,'Apply tag list').disabled,'editor saved');
    const toastStart=Date.now();await until(()=>!doc.querySelector('.toast'),'success notice clears',7000);const toastMS=Date.now()-toastStart;
    check('v040SuccessNoticeExpires',toastMS<6000,{milliseconds:toastMS});
    const beforeApplyRequests=requests;button(doc,'Apply tag list').click();await until(()=>app.state.taxonomyReady&&!app.state.tagPreparation,'tag list saved');await app.waitForIdle();
    check('v040ApplySavesWithoutAssignment',requests===beforeApplyRequests&&app.state.run?.kind!=='tag'&&!app.state.suggestions.length&&nativeWrites===0&&!app.state.settings.autoAssign);
    await app.invoke('tag',{scope:'selected'});await app.waitForIdle();await open('review');
    check('v040ExplicitGroupCreatesSeparatePaperPreview',app.state.suggestions.some(suggestion=>suggestion.paperId===nativePaper.id&&suggestion.status==='accepted'&&suggestion.decisionOrigin==='automatic'&&!suggestion.applied)&&nativeWrites===0&&JSON.stringify(item.getTags())===nativeTags&&!app.state.settings.autoAssign);

    phase='question';app.state.settings.coreConceptLimit=61;await app.invoke('prepare-tags',{scope:'selected',mode:'replace'});await app.waitForIdle();
    check('v040OnlyUnresolvedScopeBecomesQuestion',app.state.tagPreparation?.status==='questions'&&app.state.tagPreparation.questions.length===1,{status:app.state.tagPreparation?.status,questions:app.state.tagPreparation?.questions.length,runMessage:app.state.run?.message,diagnostics:app.state.tagPreparation?.diagnostics});
    await open('cleanup');button(doc,'Questions (1)').click();const answerLabel=app.state.tagPreparation.questions[0].choices.find(choice=>!choice.exclude).label;await until(()=>button(doc,answerLabel),'scientific choices');button(doc,answerLabel).click();await until(()=>app.state.tagPreparation?.status==='ready'&&!button(doc,'Apply tag list').disabled,'question answered');
    check('v040QuestionChoiceFinishesPreparation',app.state.tagPreparation.questions.length===0&&nativeWrites===0&&JSON.stringify(item.getTags())===nativeTags);
    const signIns=[];
    app.invoke=function(action,payload){if(action==='sign-in'){signIns.push(payload);return Promise.resolve();}return oldInvoke.call(this,action,payload);};
    const settingsDoc=await open('connection');
    button(settingsDoc,'Use another account or workspace').click();await until(()=>signIns.length===1&&!button(settingsDoc,'Continue with ChatGPT').disabled,'new ChatGPT connection action');
    check('v041NewChatGPTConnectionUsesFreshRegistration',signIns[0]?.newAccount===true);
    button(settingsDoc,'Continue with ChatGPT').click();await until(()=>signIns.length===2&&!button(settingsDoc,'Continue with ChatGPT').disabled,'saved ChatGPT connection action');
    check('v041ContinueRetainsSavedConnection',!signIns[1]?.newAccount);
    return {largeRenderMS,largePapers:51,largeSources:428,meaningfulQuestions:1,syntheticAIRequests:requests,realAIRequests:0,nativeTagWrites:nativeWrites,independentEditor:true,narrowSaveVisible:true};
  }finally{
    if(app.state.run?.status==='running'){app.state.run.status='paused';app.abort?.abort();}await app.waitForIdle();close();app.invoke=oldInvoke;ai.completeJson=oldComplete;host.list=oldList;host.apply=oldApply;app.state=before;await app.save();await navigator?.refresh();if(oldMode)await navigator?.setMode(oldMode);
  }
}
