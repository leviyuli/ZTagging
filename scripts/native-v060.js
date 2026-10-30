/** TEST ONLY. Setup and later tag-library extension in the guarded isolated profile. */
import { initialState } from '../src/controller.ts';

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized=value=>String(value).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
const button=(doc,label)=>[...doc.querySelectorAll('button')].find(value=>value.textContent===label||value.getAttribute('aria-label')===label);
async function until(predicate,label){const started=Date.now();while(Date.now()-started<25_000){const result=predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error('Native v0.6.0 timeout: '+label);}
function inputData(prompt){const marker='INPUT_DATA_JSON:',start=prompt.lastIndexOf(marker);if(start<0)throw new Error('The synthetic workflow request has no input data.');return JSON.parse(prompt.slice(start+marker.length));}

export async function runNativeV060(app,check,config){
  check('v060IsolatedDataGuard',normalized(Zotero.DataDirectory.dir)===normalized(config.data));
  check('v060IsolatedProfileGuard',normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile));
  const before=clone(app.state),host=app.env.host,ai=app.env.ai,oldList=host.list,oldComplete=ai.completeJson,oldSession=ai.getSession,oldApply=host.apply,oldSnapshot=app.env.librarySnapshot;
  const main=Zotero.getMainWindow(),navigator=Zotero.SmartTags.getNavigator(main),mode=navigator?.mode;
  const columns=()=>JSON.stringify(main.ZoteroPane.itemsView.getColumns().map(column=>[column.dataKey,column.hidden,column.width,column.ordinal]));
  const beforeColumns=columns(),items=[],scopes=[],requests=[];
  const firstQuote='We study fuel cell systems.',secondQuote='We study fuel cell systems using electrochemical impedance spectroscopy.';
  let manager,nativeWrites=0;
  const open=async page=>{manager=await Zotero.SmartTags.openManager({page});await until(()=>manager.document.getElementById('app')?.getAttribute('data-smart-tags-state')==='ready','manager');const doc=manager.document;if(page==='assignment'){const setup=await until(()=>{const tab=button(doc,'Assignment setup');return tab&&!tab.disabled?tab:false;},'assignment setup tab');setup.click();await until(()=>doc.getElementById('assignment-scope'),'assignment setup group');}return doc;};
  const click=async(doc,label)=>{const control=button(doc,label);if(!control||control.disabled)throw new Error('Native v0.6.0 missing enabled control: '+label);control.click();await new Promise(resolve=>setTimeout(resolve,0));};
  const completeRun=async(doc,label)=>{const previous=app.state.run?.id;await click(doc,label);await until(()=>app.state.run&&app.state.run.id!==previous&&app.state.run.status!=='running','completed '+label);await app.waitForIdle();};
  const choose=async(doc,id,index)=>{const trigger=doc.getElementById(id);if(!trigger)throw new Error('Missing workflow selector: '+id);trigger.click();await until(()=>doc.querySelector('[role="listbox"]'),'selector '+id);const options=[...doc.querySelectorAll('[role="option"]')];if(!options[index])throw new Error('Missing workflow option: '+index);options[index].click();await new Promise(resolve=>setTimeout(resolve,0));};
  try{
    await navigator?.setMode('collections');
    app.state=initialState();app.state.settings={...before.settings,provider:'chatgpt',model:'native-v060-synthetic',autoAssign:false};
    for(const [title,abstract] of [['V060QA build sample',firstQuote],['V060QA separate assignment group',secondQuote]]){
      const item=new Zotero.Item('journalArticle');item.libraryID=Zotero.Libraries.userLibraryID;item.setField('title',title);item.setField('abstractNote',abstract);await item.saveTx();items.push(item);
    }
    const papers=await Promise.all(items.map(item=>host.read(item.id))),nativeBefore=JSON.stringify(items.map(item=>item.getTags()));
    host.list=async scope=>{scopes.push(scope);return scope==='selected'?[papers[0]]:scope==='collections'?[papers[1]]:papers;};
    host.apply=async()=>{nativeWrites++;throw new Error('V060QA setup and previews must not write native tags.');};
    app.env.librarySnapshot=async()=>({papers,nativeTags:Object.fromEntries(papers.map((paper,index)=>[paper.id,items[index].getTags()]))});
    ai.getSession=async()=>({connected:true,sharing:true,email:'native-synthetic',accountId:'native-synthetic',accounts:[]});
    ai.completeJson=async(_system,prompt)=>{
      const complete=value=>({value,text:JSON.stringify(value),usageKnown:true,usage:{inputTokens:50,outputTokens:50},estimatedCostUSD:0});
      requests.push(prompt.split('\n')[0].slice(0,100));
      if(prompt.startsWith('Extract factual scientific concepts')){
        const second=prompt.includes(papers[1].title),quote=second?secondQuote:firstQuote;
        return complete({summary:'Fuel cell systems are studied.',concepts:[{name:'fuel cell',facet:'system',evidence:[{source:'abstract',text:quote}]},...(second?[{name:'electrochemical impedance spectroscopy',facet:'method',evidence:[{source:'abstract',text:quote}]}]:[])],needsPDF:false});
      }
      if(prompt.startsWith('Consolidation protocol v2')){
        const data=inputData(prompt);
        return complete({tags:data.conceptRegistry.map((entry,index)=>{
          const method=entry.sources.some(source=>source.label==='electrochemical impedance spectroscopy');
          return {key:'topic-'+index,name:method?'EIS':'FC',fullName:method?'electrochemical impedance spectroscopy':'fuel cell',description:method?'Electrochemical impedance spectroscopy.':'Fuel cell systems.',facet:method?'method':'system',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[entry.registryId]};
        }),merges:[],excluded:[]});
      }
      if(prompt.startsWith('Prepare a scientific tag vocabulary')){
        const data=inputData(prompt),judgements=[];
        for(const tag of data.tags)for(const source of data.sources){
          if(!((tag.name==='FC'&&source.name==='fuel cell')||(tag.name==='EIS'&&source.name==='electrochemical impedance spectroscopy')))continue;
          const sourceId=source.sourceId??source.factConceptId,entry=data.permittedRegistry.find(value=>value.sourceIds.includes(sourceId));
          judgements.push({tagId:tag.id,registryId:entry.registryId,sourceIds:[sourceId],relation:'equivalent',reason:'The supplied quotation names the same scientific topic.'});
        }
        return complete({judgements,questions:[]});
      }
      if(prompt.startsWith('You classify scientific papers')){
        const second=prompt.includes(papers[1].title),quote=second?secondQuote:firstQuote;
        return complete({summary:'A fuel cell study.',concepts:['FC'],suggestions:app.state.tags.filter(tag=>tag.name==='FC'||second&&tag.name==='EIS').map(tag=>({tagId:tag.id,confidence:'high',match:'substantive',reason:'The supplied paper studies this scientific topic.',evidence:[{source:'abstract',text:quote}]})),needsPDF:false});
      }
      throw new Error('Unexpected synthetic workflow request: '+prompt.slice(0,90));
    };
    await app.save();const doc=await open('overview');
    const stepNames=['Connect AI','Build tags','Assign & automate'],stepPositions=stepNames.map(label=>[...doc.querySelectorAll('.sidebar button')].findIndex(control=>control.textContent.includes(label)));
    check('v060SidebarFollowsWorkflow',stepPositions.every((position,index)=>position>=0&&(index===0||position>stepPositions[index-1]))&&!!doc.getElementById('nav-vocabulary'));
    await open('build');await choose(doc,'build-scope',1);await completeRun(doc,'Prepare tags');
    check('v060BuildGroupIsIndependent',app.state.run?.scope==='selected'&&app.state.run.jobs.length===1&&app.state.run.jobs[0].paperId===papers[0].id&&app.state.tagPreparation?.status==='ready',{scope:app.state.run?.scope,status:app.state.run?.status,message:app.state.run?.message,preparation:app.state.tagPreparation?.status,requests:requests.length});
    await until(()=>button(doc,'Apply tag list')&&!button(doc,'Apply tag list').disabled,'review ready');
    const beforeApply=requests.length;await click(doc,'Apply tag list');await until(()=>app.state.taxonomyReady&&!app.state.tagPreparation,'tag list applied');await app.waitForIdle();
    check('v060ApplyOnlySavesTagLibrary',requests.length===beforeApply&&!app.state.suggestions.length&&app.state.run?.kind!=='tag'&&nativeWrites===0&&!app.state.settings.autoAssign);
    const fuelCell=clone(app.state.tags.find(tag=>tag.name==='FC'));
    await until(()=>doc.getElementById('assignment-scope'),'assignment setup');
    check('v060AssignmentStartsWithWholeLibrary',doc.getElementById('assignment-scope').textContent.includes('Whole personal library'));
    await choose(doc,'assignment-scope',2);await completeRun(doc,'Suggest paper tags');
    check('v060ChosenCollectionReceivesPreview',app.state.run?.kind==='tag'&&app.state.run.scope==='collections'&&app.state.run.jobs.length===1&&app.state.run.jobs[0].paperId===papers[1].id&&app.state.suggestions.some(suggestion=>suggestion.paperId===papers[1].id&&!suggestion.applied));
    await open('assignment');await choose(doc,'assignment-scope',3);await completeRun(doc,'Suggest paper tags');
    check('v060WholeLibraryAssignmentIncludesOtherPapers',app.state.run.scope==='library'&&app.state.run.jobs.length===2&&app.state.suggestions.some(suggestion=>suggestion.paperId===papers[0].id&&!suggestion.applied)&&app.state.suggestions.some(suggestion=>suggestion.paperId===papers[1].id&&!suggestion.applied));
    await open('build');check('v060LaterBuildDefaultsToExtend',doc.getElementById('build-mode').textContent.includes('Extend'));
    await choose(doc,'build-scope',2);await completeRun(doc,'Prepare tags');
    check('v060ExtensionOnlyReadsNewGroup',app.state.run?.scope==='collections'&&app.state.run.jobs.length===1&&app.state.run.jobs[0].paperId===papers[1].id&&app.state.taxonomyProposal?.paperIds.length===1&&app.state.taxonomyProposal.paperIds[0]===papers[1].id);
    await until(()=>button(doc,'Apply tag list')&&!button(doc,'Apply tag list').disabled,'extension ready');await click(doc,'Apply tag list');await until(()=>!app.state.tagPreparation&&app.state.tags.some(tag=>tag.name==='EIS'),'extended list applied');
    check('v060ExtensionRetainsOldIdentityWithoutDuplicates',JSON.stringify(app.state.tags.find(tag=>tag.id===fuelCell.id))===JSON.stringify(fuelCell)&&app.state.tags.filter(tag=>tag.name==='FC').length===1&&app.state.tags.some(tag=>tag.name==='EIS'));
    await open('vocabulary');check('v060TagLibraryRetainsDIYEditor',!!button(doc,'Add tag')&&!!button(doc,'Edit tag FC')&&doc.body.textContent.includes('0 papers tagged'));
    await open('assignment');const routineSummary=[...doc.querySelectorAll('summary')].find(control=>control.textContent==='Routine assignment settings');if(!routineSummary)throw new Error('Missing routine assignment settings section');if(!routineSummary.parentElement.open)routineSummary.click();await until(()=>button(doc,'Run assignment pilot'),'expanded assignment pilot');check('v060AssignmentRetainsIndependentScopeAndPilotGate',doc.getElementById('assignment-scope').textContent.includes('Whole personal library')&&!!button(doc,'Run assignment pilot')&&!app.state.settings.autoAssign);
    check('v060PreviewPreservesNativeDataAndColumns',nativeWrites===0&&JSON.stringify(items.map(item=>item.getTags()))===nativeBefore&&columns()===beforeColumns&&scopes.includes('selected')&&scopes.includes('collections')&&scopes.includes('library'));
    return {syntheticProviderRequests:requests.length,realAIRequests:0,nativeTagWrites:nativeWrites,separateGroups:true,applySavesOnly:true,extensionPreservesOldIdentity:true};
  }finally{
    if(app.state.run?.status==='running'){app.state.run.status='paused';app.abort?.abort();}await app.waitForIdle();if(manager&&!manager.closed)manager.close();
    host.list=oldList;host.apply=oldApply;ai.completeJson=oldComplete;ai.getSession=oldSession;app.env.librarySnapshot=oldSnapshot;
    for(const item of items){host.mutating?.add(item.id);try{await item.eraseTx();}finally{host.mutating?.delete(item.id);}}
    app.state=before;await app.save();await navigator?.refresh();if(mode)await navigator?.setMode(mode);
  }
}
