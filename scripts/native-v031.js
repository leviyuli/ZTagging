/** TEST ONLY. Large synthetic proposal performance in the verified isolated Zotero profile. */
import { initialState } from '../src/controller.ts';
import { normalizeFacts, createTaxonomyProposal } from '../src/taxonomy.ts';
import { createEmptyEvidenceCatalog, createRegistrySnapshot } from '../src/evidence.ts';

const clone = value => JSON.parse(JSON.stringify(value));
const normalized = value => String(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const start = Date.now();
  while (Date.now()-start<15_000) {const value=predicate();if(value)return value;await delay(25);}
  throw new Error('Native v0.3.1 timeout: '+label);
}
const button = (doc, label) => [...doc.querySelectorAll('button')].find(value=>value.textContent===label);

export async function runNativeV031(app,check,config) {
  check('v031IsolatedDataGuard',normalized(Zotero.DataDirectory.dir)===normalized(config.data));
  check('v031IsolatedProfileGuard',normalized(Services.dirsvc.get('ProfD',Ci.nsIFile).path)===normalized(config.profile));
  const before=clone(app.state),originalInvoke=app.invoke,actions=[];
  let manager;
  const originals=Object.values(before.papers);
  if(!originals.length)throw new Error('V031QA requires existing synthetic native papers.');
  const nativeTags=new Map();
  for(const paper of originals)if(!nativeTags.has(paper.itemID))nativeTags.set(paper.itemID,JSON.stringify((await Zotero.Items.getAsync(paper.itemID)).getTags()));
  app.invoke=function(action,payload){
    if(!['confirm-taxonomy-mapping','confirm-all-taxonomy-mappings','save-taxonomy-proposal'].includes(action))throw new Error('V031QA unexpected action: '+action);
    const record={action,payload,started:Date.now()};actions.push(record);
    return Promise.resolve(originalInvoke.call(this,action,payload)).finally(()=>{record.milliseconds=Date.now()-record.started;});
  };
  try {
    app.state=initialState();app.state.vocabularyVersion=before.vocabularyVersion;app.state.settings={...before.settings,autoAssign:false};
    const concepts=Array.from({length:51},()=>[]),quotations=Array.from({length:51},()=>[]);
    let sourceIndex=0;
    for(let concept=0;concept<60;concept++){
      const count=concept===0?28:concept<15?5:concept<30?8:7;
      for(let source=0;source<count;source++){
        const paperIndex=sourceIndex%51;
        const quote=`Synthetic witness ${sourceIndex} for transport phenomenon ${concept}. `+'Measured transport response preserves a grounded passage for scientific review. '.repeat(15);
        quotations[paperIndex].push(quote);concepts[paperIndex].push({name:`transport phenomenon ${concept}`,facet:'phenomenon',evidence:[{source:'abstract',text:quote}]});sourceIndex++;
      }
    }
    const facts=concepts.map((values,index)=>{
      const source=originals[index%originals.length];
      const paper={...clone(source),id:`native-v031-paper-${index}`,title:`V031QA synthetic paper ${index}`,abstract:quotations[index].join('\n'),keywords:[],pdfText:undefined,summary:'',concepts:[]};
      app.state.papers[paper.id]=paper;
      return normalizeFacts({summary:`Synthetic factual summary for paper ${index}.`,concepts:values,needsPDF:false},paper,'native-synthetic','native-v031-test');
    });
    const catalog=createEmptyEvidenceCatalog(),snapshot=createRegistrySnapshot(facts,catalog);
    const registryByName=new Map(Object.values(snapshot.entries).map(entry=>[snapshot.sources[entry.sourceIds[0]].name,entry.registryId]));
    const candidates=Array.from({length:60},(_,index)=>({key:`v031-concept-${index}`,name:`transport ${index<15?'process':'phenomenon'} ${index}`,fullName:`transport ${index<15?'process':'phenomenon'} ${index}`,description:`Transport phenomenon ${index} observations.`,facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:Array.from({length:index>0&&index<15?7:1},(_,offset)=>registryByName.get(`transport phenomenon ${index+offset}`))}));
    const raw={tags:candidates,merges:[],excluded:[]};
    const proposal=createTaxonomyProposal(raw,facts,app.state.tags,{snapshot,candidateIds:{},generationId:'native-v031-large-proposal',baseVersion:app.state.vocabularyVersion,limit:60});
    const snapshotBytes=new TextEncoder().encode(JSON.stringify(snapshot)).length,initialIssueCount=proposal.validationIssues.length;
    check('v031LargeSyntheticEvidenceShape',facts.length===51&&Object.keys(snapshot.sources).length===428&&proposal.tags.filter(tag=>!tag.custom).length===60&&proposal.validationIssues.length>=90&&snapshotBytes>=400000,{papers:facts.length,sources:Object.keys(snapshot.sources).length,coreConcepts:60,issues:proposal.validationIssues.length,snapshotBytes});
    app.state.facts=Object.fromEntries(facts.map(fact=>[fact.paperId,fact]));app.state.evidenceCatalog=catalog;app.state.taxonomyProposal=proposal;
    app.state.run={id:'native-v031-run',kind:'rebuild',scope:'selected',automatic:false,status:'idle',jobs:facts.map((fact,index)=>({id:`native-v031-job-${index}`,paperId:fact.paperId,status:'completed'})),vocabCursor:51,vocabFinished:true,message:'Vocabulary ready for review.',spentUSD:0,settings:clone(app.state.settings),vocabularyVersion:app.state.vocabularyVersion,consolidation:{protocolVersion:2,generationId:proposal.id,inputFingerprint:proposal.inputFingerprint,snapshot,candidateIds:proposal.candidateIds,correctionAttempts:0,phase:'needs-review',value:raw}};
    await app.save();
    const renderStart=Date.now();manager=await Zotero.SmartTags.openManager({page:'vocabulary'});
    await until(()=>manager.document.getElementById('app')?.getAttribute('data-smart-tags-state')==='ready'&&button(manager.document,'Confirm scientific mapping'),'large proposal manager');
    const initialRenderMS=Date.now()-renderStart,doc=manager.document;
    check('v031LargeProposalRenderBudget',initialRenderMS<5000,{milliseconds:initialRenderMS,limitMS:5000});
    check('v031LargeProposalBoundedInitialDOM',doc.querySelectorAll('.proposal-details article.tag-row').length===20&&doc.querySelectorAll('blockquote').length===0,{conceptRows:doc.querySelectorAll('.proposal-details article.tag-row').length,initialQuotes:doc.querySelectorAll('blockquote').length});
    doc.querySelector('.registry-evidence').open=true;
    await until(()=>doc.querySelectorAll('blockquote').length>0,'lazy evidence expansion');
    check('v031LargeEvidencePageBounded',doc.querySelectorAll('blockquote').length===20);
    button(doc,'Next evidence').click();await until(()=>doc.querySelectorAll('blockquote').length===8,'second evidence page');
    const visibleQuote=doc.querySelector('blockquote').textContent;
    button(doc,'Next concepts').click();await until(()=>doc.querySelectorAll('blockquote').length===0,'second concepts page');
    button(doc,'Previous concepts').click();await until(()=>doc.querySelectorAll('blockquote').length===8,'restored evidence page');
    const list=doc.getElementById('proposal-concept-list');list.scrollTop=180;const scrollBefore=list.scrollTop;
    const tag=proposal.tags.find(value=>value.name==='transport process 0');
    const confirmStart=Date.now();button(doc,'Confirm scientific mapping').click();
    await until(()=>!!app.state.taxonomyProposal.mappingConfirmations?.[tag.id]&&!button(doc,'Next concepts')?.disabled,'large proposal confirmation');
    const confirmationMS=Date.now()-confirmStart;
    check('v031LargeConfirmationBudget',confirmationMS<5000,{milliseconds:confirmationMS,limitMS:5000});
    check('v031LargeReviewStatePreserved',doc.querySelectorAll('blockquote').length===8&&doc.querySelector('blockquote').textContent===visibleQuote&&doc.getElementById('proposal-concept-list').scrollTop===scrollBefore&&actions.length===1&&actions[0].payload.tagId===tag.id);
    const firstRow=doc.querySelector('.proposal-details article.tag-row'),reviewedProof=JSON.stringify(app.state.taxonomyProposal.mappingConfirmations[tag.id]);
    check('v032ProposedConceptActionsVisible',!!button(firstRow,'Edit')&&!!button(firstRow,'Remove')&&doc.querySelector('.proposal-details').open);
    button(firstRow,'Edit').click();await until(()=>doc.getElementById('tag-name'),'staged concept editor');
    const nameInput=doc.getElementById('tag-name');nameInput.value='renamed transport process 0';nameInput.dispatchEvent(new manager.Event('input',{bubbles:true}));
    button(doc,'Save definition').click();await until(()=>app.state.taxonomyProposal.tags.some(value=>value.id===tag.id&&value.name===nameInput.value)&&!button(doc,'Next concepts')?.disabled,'staged concept rename');
    check('v032StagedEditKeepsIdentityAndConfirmation',JSON.stringify(app.state.taxonomyProposal.mappingConfirmations[tag.id])===reviewedProof);
    const bulk=button(doc,'Confirm all mappings (14)'),bulkStart=Date.now();
    check('v032BulkConfirmationIncludesAllPages',!!bulk&&!bulk.disabled);
    bulk.click();await until(()=>Object.keys(app.state.taxonomyProposal.mappingConfirmations??{}).length===15&&!button(doc,'Next concepts')?.disabled,'bulk mapping confirmation');
    const bulkConfirmationMS=Date.now()-bulkStart;
    check('v032BulkConfirmationBudget',bulkConfirmationMS<10000,{milliseconds:bulkConfirmationMS,actionMS:actions.at(-1).milliseconds,limitMS:10000});
    check('v032BulkConfirmationDoesNotApprove',app.state.taxonomyReady===false&&button(doc,'Approve global vocabulary')?.disabled===false&&JSON.stringify(app.state.taxonomyProposal.mappingConfirmations[tag.id])===reviewedProof&&actions.at(-1).action==='confirm-all-taxonomy-mappings'&&actions.at(-1).payload.tagIds.length===14);
    const removed=app.state.taxonomyProposal.tags.find(value=>value.name==='transport phenomenon 19');
    const removeRow=[...doc.querySelectorAll('.proposal-details article.tag-row')].find(row=>row.querySelector('strong')?.textContent===removed.name);
    button(removeRow,'Remove').click();await until(()=>!app.state.taxonomyProposal.tags.some(value=>value.id===removed.id)&&!button(doc,'Next concepts')?.disabled,'remove staged concept');
    check('v032RemoveOnlyChangesProposal',app.state.taxonomyProposal.tags.filter(value=>!value.custom).length===59&&app.state.tags.length===1&&app.state.taxonomyReady===false);
    await Zotero.SmartTags.openManager({page:'activity'});
    check('v031ActivityReviewIsCompact',doc.body.textContent.includes('Vocabulary ready for review')&&!!button(doc,'Review vocabulary')&&!doc.body.textContent.includes('automatic correction dispatched')&&!doc.body.textContent.includes('Consolidation diagnostics'));
    let tagsUnchanged=true;
    for(const [id,tags] of nativeTags)if(JSON.stringify((await Zotero.Items.getAsync(id)).getTags())!==tags)tagsUnchanged=false;
    check('v031LargeReviewNoNativeTagWrites',tagsUnchanged);
    return {papers:51,sources:428,coreConcepts:60,issues:initialIssueCount,snapshotBytes,initialRenderMS,confirmationMS,bulkConfirmationMS,bulkMappings:14,realAIRequests:0,nativeTagChanges:0};
  } finally {
    if(manager&&!manager.closed)manager.close();app.invoke=originalInvoke;app.state=before;await app.save();
  }
}
