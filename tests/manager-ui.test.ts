import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import type { DisplayTag, ManagerSnapshot } from '../src/ui-contract.ts';
import type { ManagerUIOptions } from '../src/ui.ts';
import type { WarningRecord } from '../src/warnings.ts';

const bundle = build({entryPoints:['src/ui.ts'],bundle:true,write:false,format:'iife',globalName:'ManagerUI',platform:'browser',target:'firefox140'}).then(result=>result.outputFiles[0].text);
const settle = () => new Promise<void>(resolve=>setImmediate(resolve));

/** XML chrome DOM with real control handlers, sufficient for complete manager flows. */
function managerDOM() {
  class Target {
    listeners = new Map<string,Set<(event:any)=>void>>();
    addEventListener(name:string,callback:(event:any)=>void) {const list=this.listeners.get(name)||new Set();list.add(callback);this.listeners.set(name,list);}
    removeEventListener(name:string,callback:(event:any)=>void) {this.listeners.get(name)?.delete(callback);}
    emit(name:string,extra:any={}) {const event={target:this,key:'',preventDefault(){},stopPropagation(){},...extra};for(const callback of [...this.listeners.get(name)||[]])callback(event);}
  }
  class Element extends Target {
    id='';className='';children:Element[]=[];parentNode:any=null;attributes=new Map<string,string>();style:any={};
    disabled=false;checked=false;value='';type='';open=false;scrollTop=0;ownText='';nodeType=1;ownerDocument:any;localName:string;
    constructor(name:string){super();this.localName=name;this.ownerDocument=doc;}
    get textContent():string{return this.ownText+this.children.map(child=>child.textContent).join('');}
    set textContent(value:string){this.ownText=value;this.replaceChildren();}
    get isConnected():boolean{return this===doc.body||!!this.parentNode?.isConnected;}
    get lastElementChild(){return this.children.at(-1)||null;}
    get classList(){return {contains:(name:string)=>this.className.split(/\s+/).includes(name),add:(name:string)=>{this.className+=` ${name}`;},remove:(name:string)=>{this.className=this.className.split(/\s+/).filter(value=>value!==name).join(' ');}};}
    append(...nodes:Element[]){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
    replaceChildren(...nodes:Element[]){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter((node:Element)=>node!==this);this.parentNode=null;}
    setAttribute(name:string,value:string){this.attributes.set(name,String(value));}
    getAttribute(name:string){return this.attributes.get(name)??null;}
    removeAttribute(name:string){this.attributes.delete(name);}
    contains(node:any):boolean{return node===this||this.children.some(child=>child.contains(node));}
    focus(){doc.activeElement=this;}
    querySelectorAll(selector:string){return descendants(this).filter(node=>matches(node,selector));}
    querySelector(selector:string){return this.querySelectorAll(selector)[0]||null;}
    getBoundingClientRect(){return {left:10,top:10,width:260,height:34,right:270,bottom:44};}
    get offsetTop(){return 0;}get offsetHeight(){return 34;}get clientHeight(){return 250;}get scrollHeight(){return this.children.length*34;}
  }
  const doc:any=new Target();
  doc.createElement=()=>{throw new Error('A chrome XML document requires explicit namespaces');};
  doc.createElementNS=(namespace:string,name:string)=>{assert.ok(['http://www.w3.org/1999/xhtml','http://www.w3.org/2000/svg'].includes(namespace));return new Element(name);};
  doc.createTextNode=(text:string)=>{const node=new Element('#text');node.textContent=text;return node;};
  doc.body=new Element('body');doc.documentElement=doc.body;doc.activeElement=doc.body;
  const app=new Element('div');app.id='app';doc.body.append(app);
  doc.getElementById=(id:string)=>[doc.body,...descendants(doc.body)].find(node=>node.id===id)||null;
  doc.querySelectorAll=(selector:string)=>[doc.body,...descendants(doc.body)].filter(node=>matches(node,selector));
  doc.querySelector=(selector:string)=>doc.querySelectorAll(selector)[0]||null;
  const timers=new Map<number,()=>void>();let nextTimer=0;
  const timerDelays=new Map<number,number>();
  const win:any=new Target();Object.assign(win,{document:doc,innerWidth:1100,innerHeight:800,scrollY:0,scrollTo(){},confirm:()=>true,setTimeout(callback:()=>void,delay:number){const id=++nextTimer;timers.set(id,callback);timerDelays.set(id,delay);return id;},clearTimeout(id:number){timers.delete(id);timerDelays.delete(id);}});
  function descendants(root:Element):Element[]{return root.children.flatMap(child=>[child,...descendants(child)]);}
  function matches(node:Element,selector:string){return selector.split(',').some(part=>{const simple=part.trim();if(simple.startsWith('.'))return node.classList.contains(simple.slice(1));if(simple.startsWith('#'))return node.id===simple.slice(1);return node.localName===simple;});}
  return {win,doc,app,timers,timerDelays,all:()=>descendants(app),button:(label:string)=>descendants(doc.body).find(node=>node.localName==='button'&&(node.textContent===label||node.getAttribute('aria-label')===label))!};
}
function tag(id:string,name:string,extra:Partial<DisplayTag>={}):DisplayTag{return {id,name,description:`Definition of ${name}`,facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[],relatedIds:[],matchingMode:'auto',...extra};}
function snapshot():ManagerSnapshot {
  return {vocabularyVersion:2,pilotReviewed:true,taxonomyReady:true,tags:[tag('fc','FC',{fullName:'Fuel cell'}),tag('pemfc','PEMFC',{fullName:'Proton exchange membrane fuel cell',broaderIds:['fc']}),tag('eis','EIS',{facet:'method',fullName:'Electrochemical impedance spectroscopy'}),tag('rcl','RCL',{facet:'phenomenon',fullName:'Catalyst-layer resistance',custom:true,relatedIds:['fc'],matchingMode:'suggest'})],
    papers:[{id:'a',title:'Context match',tags:['RCL','PEMFC']},{id:'b',title:'Detail elsewhere',tags:['RCL','Water electrolysis']},{id:'c',title:'Method only',tags:['EIS']},{id:'d',title:'Fuel cell only',tags:['PEMFC']}],suggestions:[],cleanup:[],history:[],neighbors:{},queue:{status:'idle',total:0,completed:0,failed:0},settings:{provider:'api',model:'openai-model',autoAssign:false,budgetUSD:5,inputPricePerMillion:0,outputPricePerMillion:0,maxOutputTokens:512,coreConceptLimit:60},models:['openai-model'],connection:{apiKeyStored:true,deepseekKeyStored:false,chatgptSignedIn:false}};
}
function warning(id:string,extra:Partial<WarningRecord>={}):WarningRecord {
  return {id,code:'missing-pdf-evidence',message:`Evidence gap ${id}`,paperIds:['a'],runIds:['run'],context:'fact-extraction',conditionFingerprint:`condition-${id}`,firstSeenAt:'2026-10-28T00:00:00Z',lastSeenAt:'2026-10-28T00:00:00Z',occurrenceCount:1,status:'active',...extra};
}
function preparation(tags:DisplayTag[]=snapshot().tags):NonNullable<ManagerSnapshot['tagPreparation']> {return {id:'prepared',status:'ready',tags:structuredClone(tags),questions:[],canApply:true,scopeCount:51,targetCount:60};}
function assignmentReview(id:string,extra:Partial<NonNullable<ManagerSnapshot['assignmentReview']>>={}):NonNullable<ManagerSnapshot['assignmentReview']> {return {id,label:`Result ${id}`,status:'ready',scopeCount:2,analysisComplete:true,canFinish:false,highAccepted:0,needsReview:0,lowRejected:0,acceptedIds:[],...extra};}
interface HarnessOptions extends ManagerUIOptions {
  failAction?: string;
  emitOnInvoke?: number;
  onSnapshot?: (call: number, emit: () => void, current: ManagerSnapshot) => void | ManagerSnapshot | Promise<void | ManagerSnapshot>;
  onInvoke?: (action: string, payload: any, current: ManagerSnapshot) => unknown | Promise<unknown>;
}
async function harness(data=snapshot(),options:HarnessOptions={}) {
  const {failAction,emitOnInvoke=0,onSnapshot,onInvoke,...uiOptions}=options;
  const dom=managerDOM();const actions:{action:string;payload:any}[]=[];
  const subscribers=new Set<()=>void>();let snapshotCalls=0;
  const context=vm.createContext({Zotero:{debug(){}},console});vm.runInContext(await bundle,context);
  const emit=()=>{for(const listener of subscribers)listener();};
  const api={snapshot:async()=>{snapshotCalls++;return await onSnapshot?.(snapshotCalls,emit,data)??structuredClone(data);},subscribe:(listener:()=>void)=>{subscribers.add(listener);return()=>subscribers.delete(listener);},invoke:async(action:string,payload:any)=>{
    actions.push({action,payload:structuredClone(payload)});
    if(failAction===action)throw new Error('The tag could not be saved.');
    const result=await onInvoke?.(action,payload,data);
    const returnedPage=result&&typeof result==='object'&&'page' in result?result.page:undefined;
    if(action==='prepare-tags')data.tagPreparation={...preparation(data.tags),status:'checking',canApply:false};
    if(action==='edit-prepared-tag'&&data.tagPreparation)data.tagPreparation.tags=data.tagPreparation.tags.map(tag=>tag.id===payload.tag.id?payload.tag:tag);
    if(action==='remove-prepared-tag'&&data.tagPreparation)data.tagPreparation.tags=data.tagPreparation.tags.filter(tag=>tag.id!==payload.tagId).map(tag=>({...tag,broaderIds:tag.broaderIds.filter(id=>id!==payload.tagId),relatedIds:tag.relatedIds?.filter(id=>id!==payload.tagId)}));
    if(action==='answer-tag-question'&&data.tagPreparation){data.tagPreparation.questions=data.tagPreparation.questions.filter(question=>question.id!==payload.questionId);data.tagPreparation.canApply=!data.tagPreparation.questions.length;data.tagPreparation.status=data.tagPreparation.questions.length?'questions':'ready';}
    if(action==='retry-tag-preparation'&&data.tagPreparation){data.tagPreparation.status='checking';data.tagPreparation.canApply=false;}
    if(action==='apply-tag-list'&&data.tagPreparation&&returnedPage!=='cleanup'){data.tags=data.tagPreparation.tags;delete data.tagPreparation;data.taxonomyReady=true;}
    if(action==='tag')data.queue={kind:'tag',status:'running',total:4,completed:0,failed:0,message:'Preparing paper suggestions.'};
    if(action==='dismiss-warning')for(const record of data.warnings||[])if(record.id===payload.id&&record.status==='active')record.status='dismissed';
    if(action==='dismiss-warnings')for(const record of data.warnings||[])if(record.status==='active')record.status='dismissed';
    if(action==='dismiss-paper-attention'&&data.paperAttention)data.paperAttention.papers=data.paperAttention.papers.filter(paper=>!payload.ids.includes(paper.id));
    if(action==='save-settings')data.settings=payload.settings;
    if(action==='save-api-key'&&payload.provider==='deepseek')data.connection.deepseekKeyStored=true;
    if(action==='create-detail'){const created={...payload.tag,id:'new-detail',status:'approved'};data.tags.push(created);data.tagPreparation?.tags.push(structuredClone(created));return created.id;}
    for(let i=0;i<emitOnInvoke;i++)emit();
    return result;
  }};
  const ui=context.ManagerUI.mountManager(dom.win,api,uiOptions);await settle();
  assert.equal(dom.app.getAttribute('data-smart-tags-state'),'ready',dom.app.textContent);
  async function click(label:string){const button=dom.button(label)||dom.all().find(node=>node.localName==='button'&&node.getAttribute('aria-label')===label);assert.ok(button,`Missing button ${label}`);assert.equal(button.disabled,false,`Disabled button ${label}`);button.emit('click');await settle();}
  function expand(label:string){const details=dom.all().find(node=>node.localName==='details'&&node.children[0]?.textContent===label);assert.ok(details,`Missing details ${label}`);details.open=true;details.emit('toggle');return details;}
  function change(id:string,value:string|boolean){const control=dom.doc.getElementById(id);assert.ok(control,`Missing control ${id}`);if(typeof value==='boolean'){control.checked=value;control.emit('change');}else{control.value=value;control.emit('input');}}
  function choose(id:string,index:number){const control=dom.doc.getElementById(id);assert.ok(control);control.emit('click');const option=dom.doc.getElementById(`${id}-option-${index}`);assert.ok(option);option.emit('click');}
  return {...dom,data,actions,ui,click,change,choose,expand,emitUpdate:async()=>{emit();await settle();},get snapshotCalls(){return snapshotCalls;}};
}

test('Tags shows one prepared list instead of the 107 previous definitions, without technical review controls',async t=>{
  const data=snapshot();data.tags=Array.from({length:107},(_,i)=>tag(`old-${i}`,`Old draft ${i}`,{status:'draft'}));data.tagPreparation=preparation([tag('fc','FC',{fullName:'fuel cell',aliases:['fuel cells']})]);
  const nativeChoices=structuredClone(data.papers);const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());
  assert.equal(h.all().filter(node=>node.localName==='article'&&node.classList.contains('tag-row')).length,1);
  assert.match(h.app.textContent,/Your tag list is ready/);assert.equal(h.app.textContent.includes('Old draft'),false);
  assert.doesNotMatch(h.app.textContent,/\b(?:registry|snapshot|fingerprint|staged|core|taxonomy)\b/i);
  assert.equal(h.button('Confirm scientific mapping'),undefined);assert.equal(h.button('Apply tag list').disabled,false);
  assert.deepEqual(data.papers,nativeChoices);assert.equal(h.actions.length,0);
});

test('Prepare tags uses its own selected group and opens the list for review',async t=>{
  const h=await harness(snapshot(),{page:'build'});t.after(()=>h.ui.destroy());h.choose('build-scope',1);await h.click('Prepare tags');
  assert.deepEqual(h.actions,[{action:'prepare-tags',payload:{scope:'selected',mode:'extend',additionalTargetCount:30}}]);assert.match(h.app.textContent,/Checking your tags/);assert.ok(h.button('Resume checks'));assert.equal(h.doc.getElementById('nav-cleanup').getAttribute('aria-current'),'page');
});

test('changing a pending build group keeps its list and editor until a new preparation is requested',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const original=structuredClone(data.tagPreparation),native=structuredClone(data.papers);const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('build-scope'),null);await h.click('Edit tag FC');h.change('tag-description','An unfinished fuel cell meaning.');await h.click('Change build group');h.choose('build-scope',2);assert.equal(h.doc.getElementById('tag-description').value,'An unfinished fuel cell meaning.');assert.ok(h.button('Apply tag list'));assert.match(h.app.textContent,/Starting another build replaces the unsaved list/);assert.deepEqual(data.tagPreparation,original);assert.equal(h.actions.length,0);await h.click('Hide build setup');await h.click('Change build group');assert.equal(h.doc.getElementById('build-scope').textContent,'Selected collections');await h.click('Prepare tags');assert.deepEqual(h.actions,[{action:'prepare-tags',payload:{scope:'collections',mode:'extend',additionalTargetCount:30}}]);assert.equal(h.doc.getElementById('build-scope'),null);assert.match(h.app.textContent,/Checking your tags/);assert.deepEqual(data.papers,native);
});

test('the sidebar combines building and review in three open workflow steps and keeps library tools separate',async t=>{
  const data=snapshot();data.connection.apiKeyStored=false;const h=await harness(data);t.after(()=>h.ui.destroy());
  const sidebar=h.all().find(node=>node.localName==='aside')!;const workflow=sidebar.children.find(node=>node.textContent.startsWith('Workflow'))!;
  assert.deepEqual(workflow.querySelectorAll('button').map(node=>node.getAttribute('aria-label')),['Connect AI','Build tags','Assign & automate']);assert.equal(sidebar.querySelectorAll('button').length,8);
  for(const page of ['connection','build','cleanup','assignment','vocabulary','library','activity','settings'] as const){h.ui.navigate({page});assert.equal(h.app.getAttribute('data-smart-tags-state'),'ready');assert.ok(h.doc.getElementById(`nav-${page==='build'?'cleanup':page}`).getAttribute('aria-current'));}
  h.ui.navigate({page:'cleanup'});assert.equal(h.button('Clean up existing tags'),undefined);assert.equal(h.button('Existing tags'),undefined);assert.ok(h.doc.getElementById('build-scope'));
});

test('the first build defaults to a pilot while assignment independently defaults to the library',async t=>{
  const data=snapshot();data.taxonomyReady=false;data.workflow={buildMode:'extend',buildScope:'pilot',buildPaperCount:0,assignmentScope:'library',assignmentPaperCount:0,assignedPaperCount:0};const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('build-scope').textContent,'Pilot · 50 papers');assert.equal(h.doc.getElementById('build-mode'),null);assert.match(h.app.textContent,/Create your first tag list/);assert.doesNotMatch(h.app.textContent,/Extend my saved tag list|Replace the full tag list/);
  h.choose('build-scope',2);h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-scope').textContent,'Whole personal library');h.choose('assignment-scope',1);await h.emitUpdate();h.ui.navigate({page:'build'});assert.equal(h.doc.getElementById('build-scope').textContent,'Selected collections');await h.click('Prepare tags');assert.deepEqual(h.actions[0],{action:'prepare-tags',payload:{scope:'collections',mode:'replace'}});
  h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-scope').textContent,'Selected papers in Zotero');await h.click('Suggest paper tags');assert.deepEqual(h.actions[1],{action:'tag',payload:{scope:'selected',tagShelfId:'all'}});assert.match(h.app.textContent,/Preparing paper suggestions/);
});

test('saved workflow groups restore independently while Extend is the next build default',async t=>{
  const data=snapshot();data.workflow={buildMode:'replace',buildScope:'collections',buildPaperCount:51,assignmentScope:'selected',assignmentPaperCount:12,assignedPaperCount:4};const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('build-mode').textContent,'Extend my saved tag list');assert.equal(h.doc.getElementById('build-scope').textContent,'Selected collections');
  h.choose('build-scope',1);data.workflow.buildScope='library';await h.emitUpdate();assert.equal(h.doc.getElementById('build-scope').textContent,'Selected papers in Zotero');h.choose('build-mode',1);assert.match(h.app.textContent,/Build a replacement for the full saved tag list/);assert.equal(h.actions.length,0);
  h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-scope').textContent,'Selected papers in Zotero');assert.match(h.app.textContent,/12 papers in the last chosen group · 4 with Smart Tags assignments/);assert.doesNotMatch(h.app.textContent,/library tagged|library complete/);
});

test('assignment runs the chosen group only on request and a pilot does not replace that choice',async t=>{
  const h=await harness(snapshot(),{page:'assignment'});t.after(()=>h.ui.destroy());assert.equal(h.actions.length,0);await h.click('Suggest paper tags');assert.deepEqual(h.actions,[{action:'tag',payload:{scope:'library',tagShelfId:'all'}}]);h.data.queue.status='idle';await h.emitUpdate();await h.click('Assignment setup');h.choose('assignment-scope',2);h.expand('Routine assignment settings');await h.click('Run assignment pilot');assert.deepEqual(h.actions.at(-1),{action:'tag',payload:{scope:'pilot',tagShelfId:'all'}});h.data.queue.status='idle';await h.emitUpdate();await h.click('Assignment setup');assert.equal(h.doc.getElementById('assignment-scope').textContent,'Selected collections');
});

test('routine assignment keeps its pilot gate and changes only through its explicit save',async t=>{
  const data=snapshot();data.pilotReviewed=false;data.workflow={buildMode:'extend',buildScope:'selected',buildPaperCount:51,assignmentScope:'library',assignmentPaperCount:0,assignedPaperCount:0,assignmentPilotReady:false};const h=await harness(data,{page:'assignment'});t.after(()=>h.ui.destroy());h.expand('Routine assignment settings');assert.equal(h.doc.getElementById('assignment-auto-assign').disabled,true);assert.equal(h.button('Mark pilot reviewed').disabled,true);assert.match(h.app.textContent,/50-paper assignment pilot/);assert.equal(h.actions.length,0);data.workflow.assignmentPilotReady=true;await h.emitUpdate();assert.equal(h.button('Mark pilot reviewed').disabled,false);
  data.pilotReviewed=true;await h.emitUpdate();h.change('assignment-auto-assign',true);assert.equal(data.settings.autoAssign,false);assert.equal(h.actions.length,0);h.ui.navigate({page:'library'});h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-auto-assign').checked,true);await h.click('Save routine assignment');assert.deepEqual(h.actions,[{action:'save-settings',payload:{settings:{...data.settings,autoAssign:true}}}]);assert.equal(data.settings.autoAssign,true);
});

test('routine saves and unfinished connection edits cannot silently overwrite each other',async t=>{
  const data=snapshot();const h=await harness(data,{page:'connection'});t.after(()=>h.ui.destroy());h.choose('settings-provider',2);h.change('settings-model','deepseek-test-model');h.ui.navigate({page:'assignment'});h.expand('Routine assignment settings');h.change('assignment-auto-assign',true);await h.click('Save routine assignment');assert.equal(h.actions[0].payload.settings.provider,'api');assert.equal(h.actions[0].payload.settings.model,'openai-model');assert.equal(data.settings.autoAssign,true);
  h.ui.navigate({page:'connection'});assert.equal(h.doc.getElementById('settings-model').value,'deepseek-test-model');await h.click('Save settings');assert.equal(h.actions[1].payload.settings.provider,'deepseek');assert.equal(h.actions[1].payload.settings.autoAssign,true);assert.equal(data.settings.autoAssign,true);
});

test('the saved tag library stays distinct from pending additions and preserves both editor drafts',async t=>{
  const data=snapshot();data.tagPreparation=preparation([tag('incoming','CO2RR',{description:'Incoming carbon-dioxide reduction topic.'})]);data.workflow={buildMode:'extend',buildScope:'selected',buildPaperCount:51,assignmentScope:'library',assignmentPaperCount:0,assignedPaperCount:0};const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Your saved tags are kept/);assert.equal(h.button('Edit tag FC'),undefined);await h.click('Edit tag CO2RR');h.change('tag-description','Unfinished incoming topic.');h.ui.navigate({page:'vocabulary'});assert.ok(h.button('Edit tag FC'));assert.equal(h.button('Edit tag CO2RR'),undefined);assert.equal(h.button('Apply tag list'),undefined);assert.equal(h.doc.getElementById('tag-name'),null);
  h.ui.navigate({tagId:'fc'});assert.equal(h.doc.getElementById('tag-description').value,'Definition of FC');h.change('tag-description','Unfinished saved FC wording.');h.ui.navigate({page:'cleanup'});assert.equal(h.doc.getElementById('tag-name'),null);await h.click('Edit tag CO2RR');assert.equal(h.doc.getElementById('tag-description').value,'Unfinished incoming topic.');h.ui.navigate({page:'vocabulary'});await h.click('Edit tag FC');assert.equal(h.doc.getElementById('tag-description').value,'Unfinished saved FC wording.');assert.equal(h.actions.length,0);
});

test('retained tags in extension review link to saved edits without prepared Remove or mutation',async t=>{
  const data=snapshot();data.tagPreparation=preparation([{...data.tags[0],retained:true},tag('incoming','New topic')]);const before=structuredClone(data.papers),h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Saved tag · kept unchanged/);assert.equal(h.button('Edit tag FC'),undefined);assert.equal(h.button('Remove tag FC'),undefined);assert.ok(h.button('Edit tag New topic'));assert.ok(h.button('Remove tag New topic'));
  await h.click('Edit saved tag FC in tag library');assert.equal(h.doc.getElementById('nav-vocabulary').getAttribute('aria-current'),'page');assert.equal(h.doc.getElementById('tag-description').value,'Definition of FC');assert.equal(h.actions.length,0);assert.ok(h.button('Edit tag FC'));assert.ok(h.button('Remove tag FC'));h.change('tag-description','My saved fuel-cell meaning.');await h.click('Save');assert.equal(h.actions[0].action,'save-tag');assert.equal(h.actions[0].payload.tag.id,'fc');assert.equal(h.actions[0].payload.tag.retained,undefined);assert.deepEqual(data.papers,before);assert.equal(h.actions.some(entry=>entry.action==='edit-prepared-tag'||entry.action==='remove-prepared-tag'),false);
});

test('only meaningful questions need a choice, with paper links and exact choice identities',async t=>{
  const data=snapshot();data.tagPreparation={...preparation(),status:'questions',canApply:false,questions:[{id:'meaning-rcl',title:'Does this measurement belong under RCL?',description:'The paper discusses catalyst-layer resistance. Choose the meaning you want to keep.',paperIds:['a'],choices:[{id:'same',label:'Use RCL',description:'Keep this meaning together.'},{id:'separate',label:'Keep it separate',description:'Use a different tag for this topic.'}]}]};
  const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());assert.equal(h.button('Apply tag list').disabled,true);
  await h.click('Questions (1)');assert.match(h.app.textContent,/Does this measurement belong under RCL/);await h.click('Context match');
  assert.deepEqual(h.actions[0],{action:'show-paper',payload:{id:'a'}});await h.click('Use RCL');
  assert.deepEqual(h.actions[1],{action:'answer-tag-question',payload:{id:'prepared',questionId:'meaning-rcl',choiceId:'same'}});
  assert.equal(h.button('Apply tag list').disabled,false);assert.equal(h.button('Questions (0)'),undefined);assert.ok(h.button('Edit tag FC'));
});

test('Apply tag list saves only the list and opens independent assignment setup',async t=>{
  const data=snapshot();data.settings.autoAssign=false;data.tagPreparation=preparation();const original=structuredClone(data.papers);
  const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());await h.click('Apply tag list');
  assert.deepEqual(h.actions,[{action:'apply-tag-list',payload:{id:'prepared'}}]);assert.match(h.app.textContent,/Saving tags does not start paper assignment/);assert.ok(h.doc.getElementById('assignment-scope'));assert.equal(h.doc.getElementById('assignment-scope').textContent,'Whole personal library');assert.equal(data.queue.status,'idle');assert.equal(data.suggestions.length,0);
  assert.deepEqual(data.papers,original);assert.equal(data.settings.autoAssign,false);assert.equal(h.actions.some(entry=>entry.action==='apply-suggestions'),false);
  h.ui.navigate({page:'build'});assert.equal(h.doc.getElementById('build-scope').textContent,'Selected papers in Zotero');assert.equal(h.doc.getElementById('build-mode').textContent,'Extend my saved tag list');h.ui.navigate({page:'vocabulary'});assert.equal(h.button('Questions (0)'),undefined);assert.equal(h.button('Apply tag list'),undefined);assert.ok(h.button('Edit tag FC'));
});

test('Update and apply refreshes a stale extension in Build and opens assignment only after its checks finish',async t=>{
  const data=snapshot(),native=structuredClone(data.papers),saved=structuredClone(data.tags);data.tagPreparation={...preparation(),needsRefresh:true};data.workflow={buildMode:'extend',buildScope:'selected',buildPaperCount:51,assignmentScope:'library',assignmentPaperCount:4,assignedPaperCount:0};let applies=0;
  const h=await harness(data,{page:'cleanup',onInvoke(action,_payload,current){if(action!=='apply-tag-list')return;applies++;if(applies===1){current.tagPreparation={...current.tagPreparation!,needsRefresh:false,status:'checking',canApply:false};current.queue={status:'running',total:51,completed:51,failed:0,phase:'checking'};return {page:'cleanup'};}return {page:'assignment'};}});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/Your saved tags changed/);assert.equal(h.button('Update and apply').disabled,false);assert.equal(h.button('Resume'),undefined);await h.click('Update and apply');assert.deepEqual(h.actions,[{action:'apply-tag-list',payload:{id:'prepared'}}]);assert.ok(h.button('Apply tag list'));assert.equal(h.button('Apply tag list').disabled,true);assert.equal(h.doc.getElementById('assignment-scope'),null);assert.match(h.app.textContent,/Checking your tags/);assert.doesNotMatch(h.app.textContent,/Tag list saved\. Choose which papers/);assert.deepEqual(data.tags,saved);assert.deepEqual(data.papers,native);
  data.tagPreparation={...data.tagPreparation!,status:'ready',canApply:true};data.queue={status:'idle',total:0,completed:0,failed:0};await h.emitUpdate();await h.click('Apply tag list');assert.equal(applies,2);assert.ok(h.doc.getElementById('assignment-scope'));assert.match(h.app.textContent,/Saving tags does not start paper assignment/);assert.deepEqual(h.actions.map(entry=>entry.action),['apply-tag-list','apply-tag-list']);assert.deepEqual(data.papers,native);assert.equal(data.settings.autoAssign,false);
});

test('the preferred count is soft and a larger ready tag list can be applied',async t=>{
  const data=snapshot();data.tagPreparation=preparation(Array.from({length:67},(_,i)=>tag(`t${i}`,`Topic ${i}`)));data.tagPreparation.targetCount=60;
  const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/67 tags/);assert.equal(h.button('Apply tag list').disabled,false);
  assert.equal(h.all().filter(node=>node.localName==='article'&&node.classList.contains('tag-row')).length,20);await h.click('Next tags');assert.match(h.app.textContent,/Topic 20/);
});

test('checking and failed preparations retain completed work and offer explicit continuation',async t=>{
  const data=snapshot();data.tagPreparation={...preparation(),status:'failed',canApply:false,error:'Unknown registry registry-0123456789 in snapshot'};
  const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());assert.equal(h.button('Apply tag list').disabled,true);
  assert.doesNotMatch(h.app.textContent,/registry-0123456789|snapshot/);assert.match(h.app.textContent,/completed paper analysis is saved/);
  await h.click('Try again');assert.deepEqual(h.actions[0],{action:'retry-tag-preparation',payload:{id:'prepared'}});assert.ok(h.button('Resume checks'));
});

test('Edit saves a prepared tag through its preparation and keeps editor scrolling separate from Save',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());
  await h.click('Edit tag FC');h.change('tag-description','A clearer meaning of fuel-cell systems.');
  const editor=h.all().find(node=>node.classList.contains('tag-editor'))!,body=h.all().find(node=>node.classList.contains('editor-scroll'))!,footer=h.all().find(node=>node.classList.contains('editor-footer'))!;
  assert.equal(body.contains(h.button('Save')),false);assert.equal(footer.contains(h.button('Save')),true);assert.equal(editor.contains(body),true);
  assert.equal(h.all().find(node=>node.classList.contains('editor-advanced'))!.open,false);body.scrollTop=900;await h.click('Save');
  assert.equal(h.actions[0].action,'edit-prepared-tag');assert.equal(h.actions[0].payload.id,'prepared');assert.equal(h.actions[0].payload.tag.id,'fc');assert.equal(h.actions[0].payload.tag.description,'A clearer meaning of fuel-cell systems.');
  assert.equal(data.tags.find(tag=>tag.id==='fc')!.description,'Definition of FC');assert.equal(h.doc.getElementById('tag-name'),null);
});

test('editor drafts survive other edits and background refresh; Cancel discards only the current draft',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());
  await h.click('Edit tag FC');h.change('tag-description','My unfinished FC wording.');await h.click('Edit tag PEMFC');h.change('tag-name','My PEMFC');
  await h.click('Edit tag FC');assert.equal(h.doc.getElementById('tag-description').value,'My unfinished FC wording.');await h.emitUpdate();assert.equal(h.doc.getElementById('tag-description').value,'My unfinished FC wording.');
  await h.click('Cancel');await h.click('Edit tag FC');assert.equal(h.doc.getElementById('tag-description').value,'Definition of FC');await h.click('Edit tag PEMFC');assert.equal(h.doc.getElementById('tag-name').value,'My PEMFC');
});

test('Apply waits for every unsaved edit, including drafts for another prepared tag',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());
  await h.click('Edit tag FC');assert.equal(h.button('Apply tag list').disabled,false);
  h.change('tag-description','Changed FC meaning.');assert.equal(h.button('Apply tag list').disabled,true);assert.match(h.app.textContent,/Save or cancel your edits/);
  await h.click('Edit tag PEMFC');assert.equal(h.button('Apply tag list').disabled,true,'The FC draft is still waiting');await h.click('Cancel');assert.equal(h.button('Apply tag list').disabled,true);
  await h.click('Edit tag FC');await h.click('Save');assert.equal(h.button('Apply tag list').disabled,false);
});

test('prepared Remove uses the domain action, preserves other drafts, and makes no native change',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const native=structuredClone(data.papers);
  const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());await h.click('Edit tag PEMFC');h.change('tag-description','Unfinished PEMFC wording.');await h.click('Remove tag FC');
  assert.deepEqual(h.actions[0],{action:'remove-prepared-tag',payload:{id:'prepared',tagId:'fc'}});assert.equal(data.tagPreparation.tags.some(tag=>tag.id==='fc'),false);
  assert.equal(h.doc.getElementById('tag-description').value,'Unfinished PEMFC wording.');assert.deepEqual(data.papers,native);assert.equal(data.tags.some(tag=>tag.id==='fc'),true);
});

test('failed prepared changes keep unsaved editor text and a successful removal closes the matching editor',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const failed=await harness(data,{page:'cleanup',failAction:'edit-prepared-tag'});t.after(()=>failed.ui.destroy());
  await failed.click('Edit tag FC');failed.change('tag-description','Keep my unsaved words.');await failed.click('Save');assert.equal(failed.doc.getElementById('tag-description').value,'Keep my unsaved words.');assert.match(failed.app.textContent,/could not be saved/);
  const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());await h.click('Edit tag FC');await h.click('Remove tag FC');assert.equal(h.doc.getElementById('tag-name'),null);
});

test('hidden drafts for removed suggestions remain reachable and Apply waits for the other edits too',async t=>{
  const data=snapshot();data.tagPreparation=preparation([tag('a','Topic A'),tag('b','Topic B'),tag('c','Topic C')]);const native=structuredClone(data.papers);
  const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());
  for(const name of ['A','B','C']){await h.click(`Edit tag Topic ${name}`);h.change('tag-description',`My unfinished ${name} wording.`);}
  data.tagPreparation.tags=data.tagPreparation.tags.filter(tag=>tag.id==='c');await h.emitUpdate();h.change('vocabulary-search','No matching rows');
  assert.match(h.app.textContent,/2 drafts need a choice/);assert.equal(h.button('Apply tag list').disabled,true);
  await h.click('Review unsaved draft Topic A');assert.equal(h.doc.getElementById('tag-description').value,'My unfinished A wording.');assert.equal(h.button('Save').disabled,true);assert.match(h.app.textContent,/This tag left the suggested list/);
  await h.click('Cancel');assert.ok(h.button('Review unsaved draft Topic B'));await h.click('Discard unsaved draft Topic B');assert.equal(h.button('Apply tag list').disabled,true,'The unrelated C draft still needs a decision');
  h.change('vocabulary-search','');await h.click('Edit tag Topic C');assert.equal(h.doc.getElementById('tag-description').value,'My unfinished C wording.');await h.click('Cancel');assert.equal(h.button('Apply tag list').disabled,false);
  await h.click('Apply tag list');assert.deepEqual(h.actions,[{action:'apply-tag-list',payload:{id:'prepared'}}]);assert.deepEqual(data.papers,native);
});

test('an absent prepared tag can explicitly preserve its wording as a suggestion-only DIY tag',async t=>{
  const data=snapshot(),draft=tag('detail','Grooved layer',{fullName:'Grooved catalyst layer',aliases:['grooved CL'],inclusions:['Substantive grooved layers.'],exclusions:['Unrelated grooves.'],examples:['A grooved layer experiment.'],broaderIds:['fc'],relatedIds:['pemfc'],matchingMode:'auto'});data.tagPreparation=preparation([draft,tag('fc','FC')]);
  const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());await h.click('Edit tag Grooved layer');h.change('tag-description','My unsaved catalyst-layer wording.');
  data.tagPreparation.tags=data.tagPreparation.tags.filter(tag=>tag.id!=='detail');await h.emitUpdate();assert.equal(h.button('Save').disabled,true);assert.match(h.app.textContent,/suggested-list relationships are not copied/);
  await h.click('Save to tag library');assert.equal(h.actions.length,1);assert.equal(h.actions[0].action,'create-detail');
  assert.deepEqual(h.actions[0].payload.tag,{...draft,id:'',description:'My unsaved catalyst-layer wording.',custom:true,status:'draft',matchingMode:'suggest',broaderIds:[],relatedIds:[]});
  assert.equal(h.doc.getElementById('tag-name'),null);assert.equal(h.button('Review unsaved draft Grooved layer'),undefined);assert.equal(h.button('Apply tag list').disabled,false);assert.equal(data.tagPreparation.tags.find(tag=>tag.id==='new-detail')?.name,'Grooved layer');
});

test('failed DIY recovery retains an active removed draft until the user discards it',async t=>{
  const data=snapshot();data.tagPreparation=preparation([tag('a','Topic A'),tag('b','Topic B')]);const saved=structuredClone(data.tags);
  const h=await harness(data,{page:'cleanup',failAction:'create-detail'});t.after(()=>h.ui.destroy());await h.click('Edit tag Topic A');h.change('tag-description','Keep this text after a failed save.');data.tagPreparation.tags=data.tagPreparation.tags.filter(tag=>tag.id!=='a');await h.emitUpdate();
  await h.click('Save to tag library');assert.equal(h.doc.getElementById('tag-description').value,'Keep this text after a failed save.');assert.ok(h.button('Review unsaved draft Topic A'));assert.equal(h.button('Apply tag list').disabled,true);assert.deepEqual(data.tags,saved);
  await h.click('Discard unsaved draft Topic A');assert.equal(h.doc.getElementById('tag-name'),null);assert.equal(h.button('Apply tag list').disabled,false);assert.equal(h.actions.filter(call=>call.action==='edit-prepared-tag').length,0);
});

test('Add tag preserves a DIY name and defaults to suggested matching',async t=>{
  const h=await harness(snapshot(),{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Add tag');h.change('tag-name','My RCL niche');h.change('tag-description','Catalyst-layer resistance in electrolysis.');await h.click('Save');
  assert.equal(h.actions[0].action,'create-detail');assert.equal(h.actions[0].payload.tag.name,'My RCL niche');assert.equal(h.actions[0].payload.tag.custom,true);assert.equal(h.actions[0].payload.tag.matchingMode,'suggest');
});

test('native entry can add a DIY tag in context and optional matching remains available',async t=>{
  const h=await harness(snapshot(),{createDetail:true,detailContextId:'fc'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('tag-name').value,'');
  h.expand('More options');assert.equal(h.doc.getElementById('tag-relatedIds-fc').checked,true);assert.match(h.doc.getElementById('tag-matching-mode').textContent,/Suggest/);
  h.ui.navigate({tagId:'rcl'});assert.ok(h.button('Preview matches'));assert.ok(h.button('Assign to selected papers'));
});

test('compact attention notices retain all records, affected-paper links and dismissal history',async t=>{
  const data=snapshot();data.warnings=Array.from({length:27},(_,i)=>warning(`w${i}`));const h=await harness(data);t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/27 notices to check/);assert.equal(h.all().filter(node=>node.classList.contains('warning-record')).length,0);assert.equal(h.app.textContent.includes('fact-extraction'),false);
  await h.click('View details');assert.equal(h.all().filter(node=>node.classList.contains('warning-record')).length,27);await h.click('Context match');assert.deepEqual(h.actions[0],{action:'show-paper',payload:{id:'a'}});
  await h.click('Dismiss');assert.equal(data.warnings[0].status,'dismissed');await h.click('Dismiss all');assert.equal(data.warnings.length,27);assert.equal(data.warnings.every(w=>w.status==='dismissed'),true);
});

test('authentication and budget notices use helpful language without raw response codes',async t=>{
  const data=snapshot();data.warnings=[warning('auth',{message:'OpenAI HTTP 401 authentication failed'})];const h=await harness(data);t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/check your connection in Connect AI/);assert.doesNotMatch(h.app.textContent,/401|fact-extraction/);
  data.warnings=[warning('budget',{message:'The next request exceeds the budget'})];await h.emitUpdate();assert.match(h.app.textContent,/usage or spending limit/);assert.match(h.app.textContent,/Check Connect AI before continuing/);
});

test('Activity gives the next useful step without repeating tag questions or technical diagnostics',async t=>{
  const data=snapshot();data.tagPreparation=preparation();data.queue.consolidation={phase:'needs-review',correctionAttempts:1,issues:['Unknown registry private-id'],canRegenerate:true,rawResponses:[{label:'Raw response',response:'private source text'}]};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.ok(h.button('Open tags'));assert.doesNotMatch(h.app.textContent,/registry|private-id|private source text|correctionAttempts/);await h.click('Open tags');assert.ok(h.button('Apply tag list'));
});

test('private analysis export stays in Settings without promoting old cleanup tools',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());assert.equal(h.button('Export analysis with paper text…'),undefined);
  h.ui.navigate({page:'settings'});await h.click('Export analysis with paper text…');assert.deepEqual(h.actions,[{action:'export-tag-analysis',payload:{id:'prepared'}}]);assert.equal(h.button('Manage existing tags'),undefined);assert.equal(h.doc.getElementById('nav-existing-tags'),null);
});

test('successful messages expire after four seconds through the same notification lifecycle',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());await h.click('Remove tag FC');assert.match(h.app.textContent,/Tag removed from this list/);
  const timer=[...h.timerDelays].find(([,delay])=>delay===4000)!;assert.ok(timer);const callback=h.timers.get(timer[0])!;h.timers.delete(timer[0]);h.timerDelays.delete(timer[0]);callback();assert.equal(h.app.textContent.includes('Tag removed from this list.'),false);
});

test('large tag and question lists stay bounded and maintain independent list/editor state',async t=>{
  const data=snapshot();data.tagPreparation={...preparation(Array.from({length:80},(_,i)=>tag(`tag${i}`,`Topic ${i}`))),status:'questions',canApply:false,questions:Array.from({length:25},(_,i)=>({id:`q${i}`,title:`Question ${i}`,description:'Choose the useful meaning.',paperIds:['a'],choices:[{id:'keep',label:'Keep this meaning',description:''}]}))};
  const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());assert.equal(h.all().filter(node=>node.localName==='article'&&node.classList.contains('tag-row')).length,20);assert.equal(h.all().some(node=>node.localName==='blockquote'),false);assert.ok(h.all().length<3000);
  await h.click('Edit tag Topic 0');h.change('tag-description','Unfinished topic wording.');h.doc.getElementById('tag-list-scroll').scrollTop=250;await h.click('Next tags');await h.click('Previous tags');assert.equal(h.doc.getElementById('tag-list-scroll').scrollTop,250);assert.equal(h.doc.getElementById('tag-description').value,'Unfinished topic wording.');
  await h.click('Questions (25)');assert.equal(h.all().filter(node=>node.classList.contains('tag-question')).length,10);await h.click('Next questions');assert.match(h.app.textContent,/Question 10/);
});

test('editor CSS keeps a scroll body and visible footer, with a narrow-window drawer',async()=>{
  const css=await readFile('addon/content/manager.css','utf8');assert.match(css,/\.tag-editor\s*\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);assert.match(css,/\.editor-scroll\s*\{[^}]*overflow:auto/);assert.match(css,/@media \(max-width:900px\), \(max-height:600px\)/);assert.match(css,/\.tag-workspace\.has-editor \.tag-editor\s*\{[^}]*position:fixed/);
});

test('Explore Any keeps detail contexts together in a saved search',async t=>{
  const h=await harness(snapshot(),{page:'library'});t.after(()=>h.ui.destroy());h.change('explore-detail-rcl-fc-fc',true);h.change('explore-core-eis',true);h.choose('concept-filter-mode',1);
  assert.deepEqual(h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent),['Context match','Method only']);await h.click('Save tag search…');await h.click('Create saved search');assert.deepEqual(h.actions[0].payload.filter,{mode:'any',selections:[{conceptId:'rcl',contextId:'fc'},{conceptId:'eis'}]});
});

test('Explore search respects full names and Co/CO distinctions',async t=>{
  const data=snapshot();data.tags.push(tag('co','Co',{facet:'component'}),tag('CO','CO',{facet:'component'}));data.papers.push({id:'cobalt',title:'Cobalt paper',tags:['Co']},{id:'monoxide',title:'Carbon monoxide paper',tags:['CO']});const h=await harness(data,{page:'library'});t.after(()=>h.ui.destroy());h.change('concept-search','catalyst-layer resistance');assert.ok(h.doc.getElementById('explore-detail-rcl-fc-fc'));h.change('concept-search','');h.change('explore-core-co',true);assert.deepEqual(h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent),['Cobalt paper']);
});

test('settings accepts a preferred count without a size blocker and protects provider keys',async t=>{
  const h=await harness(snapshot(),{page:'settings'});t.after(()=>h.ui.destroy());h.change('settings-coreConceptLimit','501');await h.click('Save settings');assert.equal(h.actions.length,0);h.change('settings-coreConceptLimit','500');await h.click('Save settings');assert.equal(h.actions[0].payload.settings.coreConceptLimit,500);
  await h.click('AI connection and budget');h.choose('settings-provider',2);assert.equal(h.doc.getElementById('settings-model').value,'');assert.equal(h.doc.getElementById('settings-inputPricePerMillion').value,'0');assert.equal(h.doc.getElementById('settings-deepseek-key').type,'password');h.change('settings-deepseek-key','test-private-key');await h.click('Save DeepSeek key');assert.deepEqual(h.actions[1],{action:'save-api-key',payload:{key:'test-private-key',provider:'deepseek'}});assert.equal(h.doc.getElementById('settings-deepseek-key').value,'');assert.equal(JSON.stringify(h.data).includes('test-private-key'),false);
});

test('ChatGPT offers a fresh account or workspace sign-in without saved accounts',async t=>{
  const data=snapshot();data.settings.provider='chatgpt';data.connection={apiKeyStored:false,chatgptSignedIn:false,accounts:[]};
  const before=structuredClone(data);const h=await harness(data,{page:'connection'});t.after(()=>h.ui.destroy());
  assert.equal(h.button('Use another account or workspace').disabled,false);
  assert.match(h.app.textContent,/workspace error, cancel the current attempt/);assert.match(h.app.textContent,/personal Pro workspace/);
  await h.click('Use another account or workspace');
  assert.deepEqual(h.actions,[{action:'save-settings',payload:{settings:before.settings}},{action:'sign-in',payload:{newAccount:true}}]);assert.deepEqual(structuredClone(data),before);
});

test('Continue with ChatGPT keeps its existing sign-in behavior and saved account selector',async t=>{
  const data=snapshot();data.settings.provider='chatgpt';data.connection={apiKeyStored:false,chatgptSignedIn:true,accounts:[{id:'personal',label:'Personal account'},{id:'other',label:'Other account'}],selectedAccountId:'personal'};
  const h=await harness(data,{page:'connection'});t.after(()=>h.ui.destroy());
  await h.click('Continue with ChatGPT');assert.deepEqual(h.actions,[{action:'save-settings',payload:{settings:structuredClone(data.settings)}},{action:'sign-in',payload:undefined}]);
  const selector=h.doc.getElementById('settings-chatgpt-account');assert.ok(selector);h.choose('settings-chatgpt-account',1);await settle();
  assert.deepEqual(h.actions.at(-1),{action:'select-account',payload:{id:'other'}});
  await h.click('Use another account or workspace');assert.deepEqual(h.actions.at(-1),{action:'sign-in',payload:{newAccount:true}});
  assert.deepEqual(data.connection.accounts,[{id:'personal',label:'Personal account'},{id:'other',label:'Other account'}]);
});

test('a pending ChatGPT sign-in keeps Cancel available while other actions are busy',async t=>{
  const data=snapshot();data.settings.provider='chatgpt';let finishSnapshot:(value?:void)=>void=()=>{};
  const h=await harness(data,{page:'connection',onSnapshot:call=>call===3?new Promise<void>(resolve=>{finishSnapshot=resolve;}):undefined});t.after(()=>h.ui.destroy());
  await h.click('Use another account or workspace');assert.equal(h.button('Continue with ChatGPT').disabled,true);assert.equal(h.button('Cancel sign-in').disabled,false);
  await h.click('Cancel sign-in');assert.deepEqual(h.actions,[{action:'save-settings',payload:{settings:structuredClone(data.settings)}},{action:'sign-in',payload:{newAccount:true}},{action:'cancel-sign-in',payload:undefined}]);
  finishSnapshot();await settle();assert.equal(h.button('Cancel sign-in'),undefined);
});

test('action notifications share one final refresh and later external changes remain visible',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'cleanup',emitOnInvoke:5});t.after(()=>h.ui.destroy());await h.click('Remove tag FC');assert.equal(h.snapshotCalls,2);data.warnings=[warning('external')];await h.emitUpdate();assert.equal(h.snapshotCalls,3);assert.match(h.app.textContent,/Evidence gap external/);
});

test('Settings shows the installed version and explicit native navigation/update controls',async t=>{
  const data=snapshot();data.pluginVersion='0.5.0';data.navigation={status:'hidden',mode:'collections',message:'The library sidebar is hidden.'};
  const h=await harness(data,{page:'settings'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Installed version 0\.5\.0/);assert.match(h.app.textContent,/Library navigation: Sidebar hidden/);
  await h.click('Show tag navigation');await h.click('Restore navigation');await h.click('Check for updates');
  assert.deepEqual(h.actions,[{action:'show-tag-navigation',payload:undefined},{action:'show-tag-navigation',payload:{restore:true}},{action:'check-plugin-updates',payload:undefined}]);
});

test('Compare names starts unselected, filters and paginates without writing paper tags',async t=>{
  const data=snapshot();data.existingTags={id:'scan',applied:false,status:'ready',rows:Array.from({length:65},(_,i)=>({id:`group-${i}`,name:`Legacy ${i}`,status:i===0?'match':'unmatched',meaning:'A paper topic',targetNames:i===0?['FC']:[],paperIds:['a'],manualCount:1,affectedCount:1,reason:'Review this name.'}))};
  const before=structuredClone(data.papers);const h=await harness(data,{page:'existing-tags'});t.after(()=>h.ui.destroy());h.expand('Details');await h.click('Compare names');
  assert.equal(h.all().filter(node=>node.className==='existing-tag-row').length,30);assert.equal(h.button('Review paper changes').disabled,true);assert.equal(h.doc.getElementById('existing-group-0').checked,false);
  await h.click('Next existing tags');assert.equal(h.doc.getElementById('existing-group-0'),null);h.choose('existing-tag-status',1);assert.equal(h.all().filter(node=>node.className==='existing-tag-row').length,1);
  h.change('existing-group-0',true);await h.click('Review paper changes');assert.deepEqual(h.actions,[{action:'preview-existing-tag-changes',payload:{selections:[{groupId:'group-0',action:'replace'}]}}]);assert.deepEqual(data.papers,before);
  data.existingTags.preview={id:'reviewed-native',changes:[{paperId:'a',title:'Context match',before:['Legacy 0','Manual project'],after:['FC','Manual project']}]};await h.emitUpdate();assert.match(h.app.textContent,/Before: Legacy 0, Manual project/);assert.match(h.app.textContent,/After: FC, Manual project/);
  await h.click('Apply reviewed tag changes');assert.deepEqual(h.actions.at(-1),{action:'apply-existing-tag-changes',payload:{previewId:'reviewed-native'}});
});

test('Compare names never selects protected markers, including stale selections in bulk actions',async t=>{
  const data=snapshot();data.existingTags={id:'protected-scan',applied:true,status:'ready',rows:[{id:'ordinary',name:'Ordinary legacy tag',status:'match',targetNames:['FC'],paperIds:['a'],manualCount:1,affectedCount:1,reason:''},{id:'marker',name:'no_tag',status:'unmatched',targetNames:[],paperIds:['b'],manualCount:1,affectedCount:1,reason:''},{id:'protected',name:'Protected name',protected:true,status:'unmatched',targetNames:[],paperIds:['c'],manualCount:1,affectedCount:1,reason:''}]};
  const h=await harness(data,{page:'existing-tags'});t.after(()=>h.ui.destroy());h.expand('Details');await h.click('Compare names');assert.equal(h.doc.getElementById('existing-marker').disabled,true);assert.equal(h.doc.getElementById('existing-protected').disabled,true);assert.match(h.app.textContent,/Always kept/);assert.match(h.app.textContent,/Use Include again/);
  await h.click('Select this page');assert.equal(h.doc.getElementById('existing-marker').checked,false);assert.equal(h.doc.getElementById('existing-protected').checked,false);h.choose('existing-tag-action',1);await h.click('Review paper changes');assert.deepEqual(h.actions,[{action:'preview-existing-tag-changes',payload:{selections:[{groupId:'ordinary',action:'remove'}]}}]);
  data.existingTags.rows[0].protected=true;await h.emitUpdate();assert.equal(h.doc.getElementById('existing-ordinary').checked,false);assert.equal(h.button('Review paper changes').disabled,true);assert.equal(h.button('Analyze selected names').disabled,true);assert.equal(h.button('Create tags from selected names…').disabled,true);
});

test('DIY from existing names confirms AI usage and editable names before dispatch',async t=>{
  const data=snapshot();data.existingTags={id:'scan',applied:false,status:'ready',rows:[{id:'rcl-old',name:'RCL',status:'unmatched',targetNames:[],paperIds:['a'],manualCount:1,affectedCount:1,reason:'Keep a useful research topic.'}]};
  const h=await harness(data,{page:'existing-tags'});t.after(()=>h.ui.destroy());h.expand('Details');await h.click('Compare names');h.change('existing-rcl-old',true);await h.click('Create tags from selected names…');assert.equal(h.actions.length,0);assert.match(h.app.textContent,/uses your ChatGPT allowance or API budget/);
  h.change('diy-name-rcl-old','RCL');h.change('diy-meaning-rcl-old','Catalyst-layer resistance');await h.click('Analyze and create tags');
  assert.deepEqual(h.actions,[{action:'create-diy-from-existing',payload:{groupIds:['rcl-old'],choices:[{groupId:'rcl-old',name:'RCL',description:'Catalyst-layer resistance'}]}}]);assert.equal(data.settings.autoAssign,false);
});

test('mixed existing tag meanings leave uncertain papers unchanged unless a paper-specific target is chosen',async t=>{
  const data=snapshot();data.existingTags={id:'mixed',applied:false,status:'ready',rows:[{id:'ambiguous',name:'Legacy mixed topic',status:'choice',targetNames:['FC','EIS'],paperIds:['a','b'],manualCount:2,affectedCount:2,reason:'The same name has different meanings.',assignments:[{paperId:'a',status:'match',targetNames:['FC'],targetIds:['fc'],reason:'Fuel cell study.'},{paperId:'b',status:'choice',targetNames:['FC','EIS'],targetIds:['fc','eis'],reason:'Choose the meaning used in this paper.'}]}]};
  const h=await harness(data,{page:'existing-tags'});t.after(()=>h.ui.destroy());h.expand('Details');await h.click('Compare names');h.change('existing-ambiguous',true);await h.click('Review paper changes');
  assert.deepEqual(h.actions[0],{action:'preview-existing-tag-changes',payload:{selections:[{groupId:'ambiguous',action:'replace',paperIds:['a'],paperTargets:[]}]}});
  await h.click('Review paper matches');assert.equal(h.doc.getElementById('existing-paper-ambiguous-b').checked,false);h.change('existing-paper-ambiguous-b',true);h.choose('existing-paper-target-ambiguous-b',3);await h.click('Review paper changes');
  assert.deepEqual(h.actions[1],{action:'preview-existing-tag-changes',payload:{selections:[{groupId:'ambiguous',action:'replace',paperIds:['a','b'],paperTargets:[{paperId:'b',targetIds:['eis']}]}]}});
});

test('paper attention deduplicates papers and keeps usable evidence gaps out of global notices',async t=>{
  const data=snapshot();const paper={id:'a',title:'Needs abstract',status:'needsInformation' as const,message:'Add information before trying again.',phase:'facts',canLookupMetadata:true,canRecheck:true,canRetry:true,canSkip:true};
  data.papers[0].title=paper.title;data.papers[1].title='Ready paper';
  data.paperAttention={queued:1,papers:[paper,{...paper}, {...paper,id:'b',title:'Ready paper',status:'usable'}]};data.warnings=[warning('gap',{code:'evidence-gap',message:'Raw evidence gap message'})];
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.equal(h.all().filter(node=>node.className==='paper-attention-row').length,1);assert.doesNotMatch(h.app.textContent,/Raw evidence gap message|fact-extraction/);
  await h.click('Needs abstract');await h.click('Find metadata');await h.click('More actions for Needs abstract');await h.click('Recheck PDF');await h.click('More actions for Needs abstract');await h.click('Skip for this build');h.change('attention-a',true);await h.click('Retry selected');
  assert.deepEqual(h.actions,[{action:'show-paper',payload:{id:'a'}},{action:'preview-metadata',payload:{id:'a'}},{action:'recheck-paper-inputs',payload:{id:'a'}},{action:'skip-paper-analysis',payload:{ids:['a']}},{action:'retry-papers',payload:{ids:['a']}}]);
  h.choose('attention-status',2);assert.equal(h.all().filter(node=>node.className==='paper-attention-row').length,1);assert.match(h.app.textContent,/Ready paper/);
});

test('existing tag conflicts stay protected until their paper-specific override is selected',async t=>{
  const data=snapshot();data.existingTags={id:'protected',applied:true,status:'ready',rows:[{id:'locked-group',name:'Locked alias',status:'match',targetNames:['FC'],paperIds:['a'],manualCount:1,affectedCount:1,reason:'Matches FC.',assignments:[{paperId:'a',status:'match',targetNames:['FC'],targetIds:['fc'],reason:'Matches FC.',conflict:true}]}]};
  const h=await harness(data,{page:'existing-tags'});t.after(()=>h.ui.destroy());h.expand('Details');await h.click('Compare names');h.change('existing-locked-group',true);assert.equal(h.button('Review paper changes').disabled,true);await h.click('Review paper matches');assert.match(h.app.textContent,/earlier manual choice protects this paper/);
  h.change('existing-override-locked-group-a',true);await h.click('Review paper changes');
  assert.deepEqual(h.actions[0],{action:'preview-existing-tag-changes',payload:{selections:[{groupId:'locked-group',action:'replace',paperIds:['a'],paperTargets:[{paperId:'a',targetIds:['fc'],overrideConflicts:true}]}]}});
});

test('Keep supports a reviewed choice with zero native tag patches',async t=>{
  const data=snapshot();data.existingTags={id:'keep',applied:true,status:'ready',rows:[{id:'keep-group',name:'Project topic',status:'unmatched',targetNames:[],paperIds:['a'],manualCount:1,affectedCount:1,reason:'A useful manual tag.'}],preview:{id:'keep-preview',changes:[]}};
  const h=await harness(data,{page:'existing-tags'});t.after(()=>h.ui.destroy());h.expand('Details');await h.click('Compare names');assert.match(h.app.textContent,/leave paper tags unchanged/);await h.click('Confirm reviewed choices');assert.deepEqual(h.actions,[{action:'apply-existing-tag-changes',payload:{previewId:'keep-preview'}}]);
});

test('Remove carries only explicit paper-specific overrides and leaves other protected papers unchanged',async t=>{
  const data=snapshot();data.existingTags={id:'remove-protected',applied:true,status:'ready',rows:[{id:'kept',name:'Kept native tag',status:'choice',targetNames:['FC'],paperIds:['a','b'],manualCount:2,affectedCount:2,reason:'Earlier choices protect these papers.',assignments:[{paperId:'a',status:'choice',targetNames:['FC'],targetIds:['fc'],reason:'Kept by the researcher.',conflict:true},{paperId:'b',status:'choice',targetNames:['FC'],targetIds:['fc'],reason:'Locked by the researcher.',conflict:true}]}]};
  const h=await harness(data,{page:'existing-tags'});t.after(()=>h.ui.destroy());h.expand('Details');await h.click('Compare names');h.change('existing-kept',true);h.choose('existing-tag-action',1);assert.equal(h.button('Review paper changes').disabled,true);await h.click('Review paper matches');h.change('existing-override-kept-a',true);await h.click('Review paper changes');
  assert.deepEqual(h.actions,[{action:'preview-existing-tag-changes',payload:{selections:[{groupId:'kept',action:'remove',paperIds:['a'],paperTargets:[{paperId:'a',targetIds:[],overrideConflicts:true}]}]}}]);assert.equal(h.doc.getElementById('existing-override-kept-b').checked,false);
});

test('metadata recovery shows before/after values and applies only the reviewed preview',async t=>{
  const data=snapshot();data.metadataPreview={id:'metadata-review',paperId:'a',itemID:1,status:'ready',message:'One missing field was found.',changes:[{field:'abstractNote',before:'',after:'Recovered abstract.'}]};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Before: Empty/);assert.match(h.app.textContent,/After: Recovered abstract/);assert.match(h.app.textContent,/Only empty fields are filled/);assert.equal(h.actions.length,0);
  h.change('metadata-identifier','10.1000/example');await h.click('Find with identifier');assert.deepEqual(h.actions[0],{action:'preview-metadata',payload:{id:'a',identifier:'10.1000/example'}});
  await h.click('Apply metadata');assert.deepEqual(h.actions[1],{action:'apply-metadata',payload:{previewId:'metadata-review'}});
});

test('finished paper reading does not present tag organization as complete',async t=>{
  const data=snapshot();data.queue={status:'running',phase:'organizing',phaseProgress:{completed:2,total:8,label:'Parts organized'},completed:744,total:744,failed:0,needsInformation:3,skipped:2};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Organizing tags/);assert.match(h.app.textContent,/Parts organized: 2 of 8/);assert.match(h.app.textContent,/744 papers read · 0 failed · 3 need information · 2 skipped/);assert.doesNotMatch(h.app.textContent,/Analysis complete/);
  const bar=h.all().find(node=>node.className==='progress-bar');assert.equal(bar.children[0].style.width,'25%');
});

test('automatic repairs stay in progress and uncertain remaining API work is not shown as a completed total',async t=>{
  const data=snapshot();data.queue={status:'running',phase:'organizing',phaseProgress:{completed:1,total:29,label:'Parts organized'},completed:744,total:744,failed:0,message:'Repairing part 2 of 29…',provider:'deepseek',spentUSD:0.628,estimatedUSD:0.628,estimatePending:true};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Repairing part 2 of 29/);assert.match(h.app.textContent,/Estimated cost so far: \$0\.6280\. Remaining work is still being estimated\./);assert.doesNotMatch(h.app.textContent,/estimated total|estimated remaining: \$0\.0000|Resume to request/);assert.equal(h.button('Resume').disabled,true);assert.equal(h.button('Retry'),undefined);
  data.queue.message='Reducing batch size and continuing automatically…';data.queue.estimatePending=false;data.queue.estimatedUSD=1.128;await h.emitUpdate();assert.match(h.app.textContent,/Reducing batch size and continuing automatically/);assert.match(h.app.textContent,/estimated remaining: \$0\.5000/);assert.equal(h.button('Resume').disabled,true);
  data.queue.status='paused';data.queue.message='The next request exceeds the remaining estimated API budget.';await h.emitUpdate();assert.equal(h.button('Resume').disabled,false);assert.match(h.app.textContent,/usage or spending limit/);
});

test('tag selection shows fixed unique findings progress and queued requests separately from corrections',async t=>{
  const data=snapshot();data.queue={kind:'rebuild',status:'running',phase:'choosing',phaseProgress:{completed:4,total:5,label:'Old task count'},completed:744,total:744,failed:0,selection:{sourceCompleted:0,sourceTotal:928,completedRequests:0,queuedRequests:1,correctionsUsed:0,correctionAllowance:8,semanticRepairsUsed:0,semanticRepairAllowance:3,mappingCorrectionsUsed:0,mappingCorrectionAllowance:5}};const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Choosing tags/);assert.doesNotMatch(h.app.textContent,/Supporting findings checked|0 requests completed|Tag selection repairs/);assert.match(h.app.textContent,/1 requests queued/);h.expand('Details');assert.match(h.app.textContent,/Tag selection repairs: 0 of 3 used/);assert.match(h.app.textContent,/Source check corrections: 0 of 5 used/);assert.doesNotMatch(h.app.textContent,/Additional correction requests|Old task count|\bETA\b|estimated time|minutes remaining/i);
  data.queue.phase='mapping';data.queue.phaseProgress={completed:97,total:160,label:'Changing task count'};data.queue.selection={...data.queue.selection!,sourceCompleted:128,completedRequests:3,queuedRequests:5,correctionsUsed:2,semanticRepairsUsed:1,mappingCorrectionsUsed:1};await h.emitUpdate();assert.match(h.app.textContent,/Checking supporting findings/);assert.match(h.app.textContent,/Supporting findings checked: 128 of 928/);assert.match(h.app.textContent,/3 requests completed · 5 requests queued/);assert.match(h.app.textContent,/Tag selection repairs: 1 of 3 used/);assert.match(h.app.textContent,/Source check corrections: 1 of 5 used/);assert.doesNotMatch(h.app.textContent,/Additional correction requests|Changing task count/);const bar=h.all().find(node=>node.className==='progress-bar')!;assert.equal(bar.children[0].style.width,`${128/928*100}%`);
  data.queue.status='idle';data.queue.phase='ready';data.queue.selection.sourceCompleted=928;data.queue.selection.queuedRequests=0;data.tagPreparation=preparation();await h.emitUpdate();assert.match(h.app.textContent,/Ready for review/);assert.match(h.app.textContent,/928 of 928/);assert.equal(h.actions.length,0);
});

test('a running legacy build offers faster preparation and prevents duplicate switching',async t=>{
  const data=snapshot();data.queue={kind:'rebuild',status:'running',completed:744,total:744,failed:0,canUseFasterBuild:true};
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  const h=await harness(data,{page:'activity',onSnapshot(call){if(call===2)return pending;}});t.after(()=>{release();h.ui.destroy();});
  assert.equal(h.button('Use faster build').disabled,false);h.button('Use faster build').emit('click');await settle();
  assert.deepEqual(h.actions,[{action:'use-faster-build',payload:{targetCount:60}}]);
  assert.ok(h.all().filter(node=>node.localName==='button'&&node.textContent==='Use faster build').every(node=>node.disabled));
  data.queue.switchingToFasterBuild=true;release();await settle();await h.emitUpdate();
  assert.equal(h.button('Use faster build'),undefined);assert.equal(h.button('Switching to faster build…').disabled,true);
  data.queue.canUseFasterBuild=false;data.queue.switchingToFasterBuild=false;await h.emitUpdate();assert.equal(h.button('Use faster build'),undefined);assert.equal(h.button('Switching to faster build…'),undefined);
});

test('a paused faster-build transition resumes the saved switch instead of retrying the legacy chooser',async t=>{
  const data=snapshot();data.queue={kind:'rebuild',status:'paused',completed:744,total:744,failed:0,canUseFasterBuild:false,switchingToFasterBuild:true,selection:{failed:true,sourceCompleted:0,sourceTotal:5981,completedRequests:4,queuedRequests:0,correctionsUsed:3,correctionAllowance:3}};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Faster build paused/);assert.equal(h.button('Switching to faster build…'),undefined);assert.equal(h.button('Retry this step'),undefined);assert.equal(h.button('Retry faster build').disabled,false);
  await h.click('Retry faster build');assert.deepEqual(h.actions,[{action:'resume',payload:undefined}]);
  data.queue.status='running';await h.emitUpdate();assert.equal(h.button('Retry faster build'),undefined);assert.equal(h.button('Switching to faster build…').disabled,true);
  data.queue.status='paused';await h.emitUpdate();assert.equal(h.button('Retry faster build').disabled,false);assert.equal(h.button('Switching to faster build…'),undefined);
});

test('representative preparation reports tags and examples without implying full-library verification',async t=>{
  const data=snapshot();data.queue={kind:'rebuild',status:'running',phase:'mapping',completed:744,total:744,failed:0,selection:{verificationScope:'representative',tagsPrepared:50,tagsTotal:60,examplesChecked:96,examplesTotal:120,sourceCompleted:96,sourceTotal:5981,completedRequests:8,queuedRequests:2,correctionsUsed:0,correctionAllowance:10}};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Checking examples/);assert.match(h.app.textContent,/Tags prepared: 50 of 60/);assert.match(h.app.textContent,/Examples checked: 96 of 120/);assert.match(h.app.textContent,/8 requests completed · 2 requests queued/);assert.doesNotMatch(h.app.textContent,/5981|Supporting findings checked|full coverage|\bETA\b/);assert.equal(h.all().find(node=>node.className==='progress-bar')!.children[0].style.width,`${50/60*100}%`);
  data.queue.status='idle';data.queue.phase='ready';data.queue.selection!.tagsPrepared=60;data.queue.selection!.examplesChecked=120;data.queue.selection!.queuedRequests=0;data.tagPreparation={...preparation([tag('fc','FC',{coverage:2,currentlyTaggedCount:500})]),verificationScope:'representative'};await h.emitUpdate();assert.match(h.app.textContent,/Ready for review/);
  h.ui.navigate({page:'cleanup'});assert.match(h.app.textContent,/2 verified example papers/);assert.doesNotMatch(h.app.textContent,/500 papers in this build|2 papers in this build|5981/);assert.equal(h.button('Apply tag list').disabled,false);
  await h.click('Apply tag list');assert.deepEqual(h.actions,[{action:'apply-tag-list',payload:{id:'prepared'}}]);assert.ok(h.doc.getElementById('assignment-scope'));assert.equal(h.actions.some(call=>call.action==='tag'),false);
});

test('a new paper-reading phase ignores stale tag-selection totals after a refresh',async t=>{
  const data=snapshot();data.queue={kind:'rebuild',status:'running',phase:'mapping',completed:19,total:19,failed:0,selection:{verificationScope:'representative',tagsPrepared:32,tagsTotal:60,examplesChecked:90,examplesTotal:120,sourceCompleted:90,sourceTotal:999,completedRequests:5,queuedRequests:2,correctionsUsed:1,correctionAllowance:3}};const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Tags prepared: 32 of 60/);assert.match(h.app.textContent,/Examples checked: 90 of 120/);h.expand('Details');assert.match(h.app.textContent,/Additional correction requests/);
  Object.assign(data.queue,{phase:'reading',completed:12,total:25,phaseProgress:{completed:32,total:60,label:'Old tag total'}});await h.emitUpdate();assert.match(h.app.textContent,/Reading papers/);assert.match(h.app.textContent,/Papers read: 12 of 25/);assert.doesNotMatch(h.app.textContent,/Tags prepared|Examples checked|32 of 60|90 of 120|999|requests completed|requests queued|correction requests|Old tag total/);const bar=h.all().find(node=>node.className==='progress-bar')!;assert.equal(bar.children[0].style.width,`${12/25*100}%`);assert.equal(h.actions.length,0);
});

test('an exhausted selection has an explicit retry while connection and budget pauses keep Resume',async t=>{
  const data=snapshot();data.queue={kind:'rebuild',status:'paused',phase:'mapping',completed:51,total:51,failed:0,selection:{sourceCompleted:80,sourceTotal:100,completedRequests:4,queuedRequests:0,correctionsUsed:2,correctionAllowance:2,failed:true}};const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.ok(h.button('Retry this step'));assert.equal(h.button('Resume'),undefined);assert.equal(h.actions.length,0);await h.click('Retry this step');assert.deepEqual(h.actions,[{action:'retry-selection',payload:undefined}]);
  data.queue.selection!.failed=false;data.queue.message='Authentication failed.';await h.emitUpdate();assert.equal(h.button('Retry this step'),undefined);assert.equal(h.button('Resume').disabled,false);assert.match(h.app.textContent,/Connect AI/);await h.click('Resume');assert.deepEqual(h.actions[1],{action:'resume',payload:undefined});data.queue.message='The next request exceeds the budget.';await h.emitUpdate();assert.equal(h.button('Resume').disabled,false);assert.match(h.app.textContent,/usage or spending limit/);
});

test('a failed tag choice shows saved papers and the reason without fictitious zero work totals',async t=>{
  const data=snapshot();data.queue={kind:'rebuild',status:'paused',phase:'choosing',completed:19,total:19,failed:0,message:'The AI reply could not link some tag names. Your papers are saved.',selection:{verificationScope:'representative',failed:true,tagsPrepared:0,tagsTotal:0,examplesChecked:0,examplesTotal:0,sourceCompleted:0,sourceTotal:123,completedRequests:0,queuedRequests:0,correctionsUsed:3,correctionAllowance:3,semanticRepairsUsed:3,semanticRepairAllowance:3,mappingCorrectionsUsed:0,mappingCorrectionAllowance:0}};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Choosing tags · paused/);assert.match(h.app.textContent,/19 papers read/);assert.match(h.app.textContent,/The AI reply could not link some tag names\. Your papers are saved/);assert.doesNotMatch(h.app.textContent,/Tags prepared|Examples checked|Supporting findings checked|0 of 0|requests queued|requests completed|repairs|corrections|AI connection could not/);assert.equal(h.all().some(node=>node.className==='progress-bar'),false);assert.ok(h.button('Retry this step'));assert.equal(h.actions.length,0);h.expand('Details');assert.match(h.app.textContent,/Tag selection repairs: 3 of 3 used/);assert.equal(h.actions.length,0);
});

test('attention offers per-paper and batch Dismiss without excluding or changing native tags',async t=>{
  const data=snapshot(),entry={id:'a',title:'Notice one',status:'needsInformation' as const,message:'Some information is missing.',phase:'facts',canDismiss:true,canLookupMetadata:true,canRecheck:true,canRetry:true,canSkip:false};
  data.paperAttention={queued:0,papers:[entry,{...entry,id:'b',title:'Notice two',status:'failed'},{...entry,id:'c',title:'Ready paper',status:'usable',canDismiss:false}]};const before=structuredClone(data.papers);const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  await h.click('More actions for Notice one');await h.click('Dismiss');assert.deepEqual(h.actions,[{action:'dismiss-paper-attention',payload:{ids:['a']}}]);assert.equal(h.doc.getElementById('attention-a'),null);h.change('attention-b',true);await h.click('Actions for selected papers');await h.click('Dismiss selected');assert.deepEqual(h.actions[1],{action:'dismiss-paper-attention',payload:{ids:['b']}});assert.deepEqual(data.papers,before);assert.equal(data.settings.autoAssign,false);
  data.paperAttention.papers.push({...entry,message:'New information exposed another condition.'});await h.emitUpdate();assert.ok(h.doc.getElementById('attention-a'));
});

test('Exclude and Include again require a reviewed exact native tag preview',async t=>{
  const data=snapshot(),entry={id:'a',title:'Outside my tagging scope',status:'needsInformation' as const,message:'Information is missing.',phase:'facts',canLookupMetadata:true,canRecheck:true,canRetry:true,canSkip:false};data.paperAttention={queued:0,papers:[entry]};const before=structuredClone(data.papers);const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  await h.click('More actions for Outside my tagging scope');await h.click('Exclude from tagging');assert.deepEqual(h.actions,[{action:'preview-paper-exclusion',payload:{ids:['a'],exclude:true}}]);assert.deepEqual(data.papers,before);assert.equal(h.button('Apply no_tag and exclude'),undefined);
  data.paperExclusionPreview={id:'exclude-review',exclude:true,changes:[{paperId:'a',title:entry.title,before:['Manual project','FC'],after:['Manual project','FC','no_tag']}]};await h.emitUpdate();assert.match(h.app.textContent,/Before: Manual project, FC/);assert.match(h.app.textContent,/After: Manual project, FC, no_tag/);await h.click('Apply no_tag and exclude');assert.deepEqual(h.actions.at(-1),{action:'apply-paper-exclusion',payload:{previewId:'exclude-review'}});
  data.paperAttention.papers=[{...entry,status:'excluded',canDismiss:false,canLookupMetadata:false,canRecheck:false,canRetry:false}];delete data.paperExclusionPreview;await h.emitUpdate();assert.equal(h.doc.getElementById('attention-a'),null);h.choose('attention-status',6);assert.ok(h.doc.getElementById('attention-a'));assert.equal(h.button('Retry analysis'),undefined);await h.click('Include again');assert.deepEqual(h.actions.at(-1),{action:'preview-paper-exclusion',payload:{ids:['a'],exclude:false}});
  data.paperExclusionPreview={id:'include-review',exclude:false,changes:[{paperId:'a',title:entry.title,before:['Manual project','FC','no_tag'],after:['Manual project','FC']}]};await h.emitUpdate();await h.click('Apply inclusion');assert.deepEqual(h.actions.at(-1),{action:'apply-paper-exclusion',payload:{previewId:'include-review'}});assert.deepEqual(data.papers,before);
});

test('batch exclusion and manually selected Zotero papers work without an AI connection',async t=>{
  const data=snapshot();data.settings.model='';data.connection.apiKeyStored=false;const entry={id:'a',title:'Unneeded paper',status:'failed' as const,message:'Could not analyze.',phase:'facts',canDismiss:true,canLookupMetadata:false,canRecheck:false,canRetry:false,canSkip:false};data.paperAttention={queued:0,papers:[entry,{...entry,id:'b'}]};const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());h.change('attention-select-page',true);await h.click('Actions for selected papers');await h.click('Exclude selected from tagging');assert.deepEqual(h.actions[0],{action:'preview-paper-exclusion',payload:{ids:['a','b'],exclude:true}});await h.click('More paper actions');await h.click('Exclude selected Zotero items…');assert.deepEqual(h.actions[1],{action:'preview-paper-exclusion',payload:{exclude:true}});assert.equal(data.settings.autoAssign,false);
});

test('an empty attention panel keeps only its search and header menu without selection controls or pagination',async t=>{
  const data=snapshot();data.paperAttention={queued:0,papers:[]};const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/No papers need attention/);assert.ok(h.doc.getElementById('attention-search'));assert.ok(h.doc.getElementById('attention-status'));assert.ok(h.button('More paper actions'));
  assert.equal(h.doc.getElementById('attention-select-page'),null);
  for(const label of ['Clear','Retry selected','Actions for selected papers','Previous papers','Next papers','Exclude selected Zotero items…'])assert.equal(h.button(label),undefined,label);
  assert.doesNotMatch(h.app.textContent,/0 selected|0 papers queued|Each paper appears once|Dismiss hides|Exclude adds no_tag/);assert.equal(h.actions.length,0);
  await h.click('More paper actions');assert.ok(h.button('Exclude selected Zotero items…'));assert.equal(h.actions.length,0);
});

test('attention selection controls and menus expose only applicable actions and clear when filters change',async t=>{
  const data=snapshot(),entry={id:'a',title:'Missing abstract',status:'needsInformation' as const,message:'An abstract is missing.',phase:'facts',canDismiss:true,canLookupMetadata:true,canRecheck:true,canRetry:true,canSkip:false};
  data.paperAttention={queued:0,papers:[entry,{...entry,id:'b',title:'Already excluded',status:'excluded',canDismiss:false,canLookupMetadata:false,canRecheck:false,canRetry:false},{...entry,id:'c',title:'Leave for later',canLookupMetadata:false,canRecheck:false,canRetry:false,canSkip:true}]};
  const original=structuredClone(data.papers),h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  const menuItems=()=>h.doc.querySelectorAll('button').filter((node:any)=>node.getAttribute('role')==='menuitem').map((node:any)=>node.textContent).sort();
  assert.equal(h.button('Retry selected'),undefined);assert.equal(h.button('Actions for selected papers'),undefined);assert.equal(h.button('Clear'),undefined);
  h.change('attention-a',true);assert.match(h.app.textContent,/1 selected/);assert.ok(h.button('Clear'));assert.ok(h.button('Retry selected'));
  await h.click('Actions for selected papers');assert.deepEqual(menuItems(),['Dismiss selected','Exclude selected from tagging'].sort());
  h.choose('attention-status',6);assert.equal(h.button('Clear'),undefined);assert.equal(h.button('Retry selected'),undefined);assert.equal(h.button('Actions for selected papers'),undefined);assert.deepEqual(menuItems(),[]);assert.ok(h.doc.getElementById('attention-b'));
  h.change('attention-b',true);assert.equal(h.button('Retry selected'),undefined);await h.click('Actions for selected papers');assert.deepEqual(menuItems(),['Include selected again']);await h.click('Include selected again');
  assert.deepEqual(h.actions[0],{action:'preview-paper-exclusion',payload:{ids:['b'],exclude:false}});
  h.choose('attention-status',3);assert.equal(h.button('Actions for selected papers'),undefined);h.change('attention-c',true);assert.equal(h.button('Retry selected'),undefined);await h.click('Actions for selected papers');assert.ok(menuItems().includes('Skip selected for this build'));assert.equal(menuItems().includes('Include selected again'),false);await h.click('Skip selected for this build');
  assert.deepEqual(h.actions[1],{action:'skip-paper-analysis',payload:{ids:['c']}});
  h.change('attention-search','No paper matches');assert.match(h.app.textContent,/No matching papers/);assert.equal(h.doc.getElementById('attention-select-page'),null);assert.equal(h.button('Clear'),undefined);assert.equal(h.button('Actions for selected papers'),undefined);assert.equal(h.button('Next papers'),undefined);assert.deepEqual(menuItems(),[]);assert.deepEqual(data.papers,original);
});

test('attention action menus support keyboard focus, scroll within a short popup, and release portals and listeners',async t=>{
  const data=snapshot();data.paperAttention={queued:0,papers:[{id:'a',title:'Keyboard paper',status:'needsInformation',message:'More information is needed.',phase:'facts',canDismiss:true,canLookupMetadata:true,canRecheck:true,canRetry:true,canSkip:true}]};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  const watched=[[h.doc,'pointerdown'],[h.doc,'focusin'],[h.doc,'scroll'],[h.win,'resize'],[h.win,'unload']] as const;
  const baseline=watched.map(([target,event])=>new Set(target.listeners.get(event)||[]));
  const assertMenuListenersRemoved=()=>watched.forEach(([target,event],index)=>{for(const listener of target.listeners.get(event)||[])assert.equal(baseline[index].has(listener),true,`Leaked ${event} menu listener`);});
  function open(key:string){const trigger=h.doc.getElementById('attention-more-a');assert.equal(trigger.getAttribute('aria-haspopup'),'menu');trigger.focus();trigger.emit('keydown',{key});const menu=h.doc.getElementById('attention-more-a-menu');assert.ok(menu);assert.equal(menu.parentNode,h.doc.body);assert.equal(menu.getAttribute('role'),'menu');assert.equal(trigger.getAttribute('aria-expanded'),'true');const items=menu.querySelectorAll('button');assert.ok(items.length>1);assert.equal(items.every((item:any)=>item.getAttribute('role')==='menuitem'),true);return {trigger,menu,items};}
  const first=open('Enter');assert.equal(h.doc.activeElement,first.items[0]);
  Object.defineProperty(first.menu,'clientHeight',{value:40});Object.defineProperty(first.items.at(-1),'offsetTop',{value:180});
  first.items[0].emit('keydown',{key:'ArrowDown'});assert.equal(h.doc.activeElement,first.items[1]);first.items[1].emit('keydown',{key:'ArrowUp'});assert.equal(h.doc.activeElement,first.items[0]);
  first.items[0].emit('keydown',{key:'End'});assert.equal(h.doc.activeElement,first.items.at(-1));assert.equal(first.menu.scrollTop,174);
  first.items.at(-1).emit('keydown',{key:'Home'});assert.equal(h.doc.activeElement,first.items[0]);assert.equal(first.menu.scrollTop,0);
  first.items[0].emit('keydown',{key:'Escape'});assert.equal(h.doc.getElementById('attention-more-a-menu'),null);assert.equal(first.trigger.getAttribute('aria-expanded'),'false');assert.equal(h.doc.activeElement,first.trigger);assertMenuListenersRemoved();
  const spaced=open(' ');spaced.items[0].emit('keydown',{key:'Tab'});assert.equal(h.doc.getElementById('attention-more-a-menu'),null);assertMenuListenersRemoved();
  open('ArrowDown');const outside=h.doc.getElementById('attention-search');outside.focus();h.doc.emit('focusin',{target:outside});assert.equal(h.doc.getElementById('attention-more-a-menu'),null);assert.equal(h.doc.activeElement,outside);assertMenuListenersRemoved();assert.equal(h.actions.length,0);
  const activated=open('ArrowDown');assert.equal(activated.items[0].textContent,'Recheck PDF');activated.items[0].emit('keydown',{key:'Enter'});await settle();assert.deepEqual(h.actions,[{action:'recheck-paper-inputs',payload:{id:'a'}}]);assert.equal(h.doc.getElementById('attention-more-a-menu'),null);assertMenuListenersRemoved();
  const refreshed=open('ArrowDown');await h.emitUpdate();assert.equal(refreshed.trigger.isConnected,false);assert.equal(h.doc.getElementById('attention-more-a-menu'),null);assertMenuListenersRemoved();
  open('ArrowDown');h.ui.destroy();assert.equal(h.doc.getElementById('attention-more-a-menu'),null);assertMenuListenersRemoved();
});

test('the builtin no_tag stays outside editable tags and DIY counts while Find papers can filter it',async t=>{
  const data=snapshot();data.tags.push(tag('smart-tags:no-tag','no_tag',{builtin:'no_tag',custom:true,matchingMode:'manual'}));data.papers[0].tags!.push('no_tag');const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());assert.equal(h.button('Edit tag no_tag'),undefined);assert.equal(h.button('Remove tag no_tag'),undefined);assert.equal(h.all().filter(node=>node.localName==='article'&&node.classList.contains('tag-row')).length,4);
  h.ui.navigate({page:'overview'});assert.doesNotMatch(h.app.textContent,/your topics|DIY|core vocabulary/);h.ui.navigate({page:'library'});assert.ok(h.doc.getElementById('explore-builtin-no-tag'));h.change('explore-builtin-no-tag',true);assert.deepEqual(h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent),['Context match']);
});

test('suggested no_tag remains a reviewed paper change with a clear future-exclusion label',async t=>{
  const data=snapshot();data.tags.push(tag('smart-tags:no-tag','no_tag',{builtin:'no_tag',custom:true,matchingMode:'manual'}));data.suggestions=[{id:'unmatched',paperId:'a',tagId:'smart-tags:no-tag',reason:'The completed analysis found no supported match.',confidence:'high',status:'accepted',evidence:[]}];
  const h=await harness(data,{page:'review'});t.after(()=>h.ui.destroy());assert.equal(h.actions.length,0);h.expand('Details');h.choose('review-filter',1);assert.match(h.app.textContent,/Exclude from tagging/);assert.doesNotMatch(h.app.textContent,/No supporting passage is available/);h.expand('Details');await h.click('Apply accepted…');assert.match(h.app.textContent,/Applying no_tag excludes the affected papers from future tagging/);assert.equal(h.actions.length,0);await h.click('Apply 1 tag changes');assert.deepEqual(h.actions,[{action:'apply-suggestions',payload:{ids:['unmatched']}}]);
});

test('tag counts distinguish papers in the build from papers already tagged in the library',async t=>{
  const data=snapshot();data.tags[0].coverage=51;data.tags[0].currentlyTaggedCount=120;
  data.tagPreparation=preparation([{...data.tags[0],retained:true,coverage:0},tag('new-topic','new topic',{coverage:3})]);
  const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/120 papers tagged/);assert.match(h.app.textContent,/3 papers in this build/);
  h.ui.navigate({page:'vocabulary'});assert.match(h.app.textContent,/120 papers tagged/);assert.doesNotMatch(h.app.textContent,/51 papers tagged|papers in this build/);assert.equal(h.actions.length,0);
});

test('Keep cleanup retains choices outside searches and pages, reserves no_tag, and previews before applying',async t=>{
  const data=snapshot();data.settings.model='';data.connection.apiKeyStored=false;data.taxonomyReady=false;
  const names=['no_tag','Project','Old keyword','Locked name',...Array.from({length:35},(_,index)=>`Extra ${index}`)];
  data.existingTags={id:'keep-plan',applied:false,status:'ready',rows:names.map((name,index)=>({id:`n${index}`,name,status:'unmatched',targetNames:[],paperIds:['a'],manualCount:1,affectedCount:1,reason:'Existing native name.',kept:index===0||index===1||index===3,protected:index===0,locked:index===3}))};
  const native=structuredClone(data.papers),h=await harness(data,{page:'existing-tags',onInvoke(action,payload,current){
    if(action==='set-kept-existing-tags')for(const row of current.existingTags!.rows)row.kept=payload.names.includes(row.name);
    if(action==='preview-keep-removals')current.existingTags!.keepPreview={id:'keep-preview',removedNames:['Old keyword','Locked name'],paperCount:1,overrideCount:1,changes:[{paperId:'a',title:'Context match',before:['Project','Old keyword','Locked name','no_tag'],after:['Project','no_tag']}]};
  }});t.after(()=>h.ui.destroy());
  h.expand('Details');assert.equal(h.doc.getElementById('keep-name-n0').checked,true);assert.equal(h.doc.getElementById('keep-name-n0').disabled,true);assert.equal(h.all().filter(node=>node.classList.contains('existing-tag-row')).length,30);assert.equal(h.actions.length,0);
  h.change('keep-name-n3',false);await h.click('Next names');h.change('keep-name-n38',true);h.change('keep-tag-search','Old keyword');
  await h.click('Preview removal of other tags');assert.equal(h.actions[0].action,'set-kept-existing-tags');assert.deepEqual(new Set(h.actions[0].payload.names),new Set(['no_tag','Project','Extra 34']));assert.deepEqual(h.actions[1],{action:'preview-keep-removals',payload:{planId:'keep-plan'}});assert.match(h.app.textContent,/1 earlier protections explicitly replaced/);assert.equal(h.button('Apply reviewed removals').disabled,false);
  h.change('keep-name-n2',true);assert.equal(h.button('Apply reviewed removals').disabled,true);h.change('keep-name-n2',false);await h.click('Preview removal of other tags');await h.click('Apply reviewed removals');assert.deepEqual(h.actions.at(-1),{action:'apply-keep-removals',payload:{previewId:'keep-preview'}});assert.deepEqual(data.papers,native);
});

test('a refreshed inventory blocks stale Keep removal until saved choices are explicitly reloaded',async t=>{
  const data=snapshot();data.existingTags={id:'before',applied:false,status:'ready',rows:[{id:'one',name:'Keep me',status:'unmatched',targetNames:[],paperIds:['a'],manualCount:1,affectedCount:1,reason:'',kept:false}]};
  const h=await harness(data,{page:'existing-tags',onInvoke(action,_payload,current){if(action==='refresh-existing-tags'){current.existingTags!.id='after';current.existingTags!.rows.push({id:'new',name:'Newly added name',status:'unmatched',targetNames:[],paperIds:['b'],manualCount:1,affectedCount:1,reason:''});}}});t.after(()=>h.ui.destroy());
  h.expand('Details');h.change('keep-name-one',true);await h.click('Read library tags');assert.match(h.app.textContent,/inventory or protected choices changed/);assert.equal(h.button('Preview removal of other tags').disabled,true);assert.equal(h.doc.getElementById('keep-name-one').checked,true);
  await h.click('Reload saved Keep choices');assert.equal(h.button('Preview removal of other tags').disabled,false);assert.equal(h.doc.getElementById('keep-name-one').checked,false);assert.equal(h.actions.length,1);
});

test('Define kept topics opens only retained names and clears old comparison selections without starting AI',async t=>{
  const data=snapshot();data.existingTags={id:'kept-topics',applied:true,status:'ready',rows:[{id:'topic',name:'My retained topic',kept:true,status:'unmatched',targetNames:[],paperIds:['a'],manualCount:1,affectedCount:1,reason:''},{id:'old',name:'Unkept name',kept:false,status:'unmatched',targetNames:[],paperIds:['b'],manualCount:1,affectedCount:1,reason:''},{id:'marker',name:'no_tag',kept:true,protected:true,status:'unmatched',targetNames:[],paperIds:['c'],manualCount:1,affectedCount:1,reason:''}]};
  const h=await harness(data,{page:'existing-tags'});t.after(()=>h.ui.destroy());h.expand('Details');await h.click('Compare names');h.change('existing-old',true);await h.click('Keep tags');h.change('keep-tag-search','A previous search');await h.click('Define kept topics…');
  assert.equal(h.doc.getElementById('existing-tag-status').textContent,'Kept names');assert.equal(h.doc.getElementById('existing-old'),null);assert.equal(h.doc.getElementById('existing-marker'),null);assert.equal(h.doc.getElementById('existing-topic').checked,false);assert.equal(h.button('Create tags from selected names…').disabled,true);assert.match(h.app.textContent,/Select the scientific topics you want to define/);assert.equal(h.actions.length,0);
  h.change('existing-topic',true);await h.click('Create tags from selected names…');assert.match(h.app.textContent,/uses your ChatGPT allowance or API budget/);assert.equal(h.actions.length,0);
});

test('assignment acceptance and batch Apply stay within the selected result, including earlier suggestions',async t=>{
  const data=snapshot(),current=assignmentReview('current',{highAccepted:1,needsReview:1,lowRejected:1,acceptedIds:['high']}),previous=assignmentReview('previous',{acceptedIds:['old']});data.assignmentReview=current;data.assignmentReviews=[current,previous];
  data.suggestions=[{id:'high',runId:'current',decisionOrigin:'automatic',paperId:'a',tagId:'fc',reason:'A supported high match.',confidence:'high',status:'accepted',evidence:[]},{id:'medium',runId:'current',paperId:'b',tagId:'pemfc',reason:'Medium match.',confidence:'medium',status:'pending',evidence:[]},{id:'low',runId:'current',decisionOrigin:'automatic',paperId:'b',tagId:'rcl',reason:'Low match.',confidence:'low',status:'rejected',evidence:[]},{id:'old',runId:'previous',paperId:'c',tagId:'eis',reason:'An earlier accepted match.',confidence:'high',status:'accepted',evidence:[]},{id:'legacy',paperId:'d',tagId:'fc',reason:'An older unscoped match.',confidence:'high',status:'accepted',evidence:[]}];
  const h=await harness(data,{page:'review'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/1 high matches accepted · 1 choices waiting · 1 declined automatically/);h.expand('Details');await h.click('Apply accepted…');await h.click('Apply 1 tag changes');assert.deepEqual(h.actions[0],{action:'apply-suggestions',payload:{ids:['high']}});
  h.choose('assignment-result',1);h.expand('Details');await h.click('Apply accepted…');await h.click('Apply 1 tag changes');assert.deepEqual(h.actions[1],{action:'apply-suggestions',payload:{ids:['old']}});
  h.choose('assignment-result',2);h.expand('Details');await h.click('Apply accepted…');await h.click('Apply 1 tag changes');assert.deepEqual(h.actions[2],{action:'apply-suggestions',payload:{ids:['legacy']}});
});

test('automatic low matches can be manually accepted without a Clear rejection action',async t=>{
  const data=snapshot(),review=assignmentReview('run',{lowRejected:1});data.assignmentReview=review;data.suggestions=[{id:'low',runId:'run',decisionOrigin:'automatic',paperId:'a',tagId:'fc',reason:'A low-confidence grounded match.',confidence:'low',status:'rejected',evidence:[]}];const h=await harness(data,{page:'review'});t.after(()=>h.ui.destroy());h.expand('Details');h.choose('review-filter',2);assert.equal(h.button('Clear rejection'),undefined);await h.click('Accept');assert.deepEqual(h.actions,[{action:'accept-suggestion',payload:{id:'low'}}]);
});

test('Finish clearly states that accepted paper tags will be written before the report opens',async t=>{
  const data=snapshot();data.assignmentReview=assignmentReview('run',{canFinish:true,acceptedIds:['high'],highAccepted:1});data.suggestions=[{id:'high',runId:'run',decisionOrigin:'automatic',paperId:'a',tagId:'fc',reason:'Supported high match.',confidence:'high',status:'accepted',evidence:[]}];
  const h=await harness(data,{page:'review'});t.after(()=>h.ui.destroy());assert.equal(h.button('Finish assignment'),undefined);assert.match(h.app.textContent,/Review the paper tag changes once/);await h.click('Apply accepted and finish');assert.equal(h.actions.length,0);await h.click('Apply and finish');assert.deepEqual(h.actions,[{action:'finish-assignment',payload:{runId:'run'}}]);
});

test('uncovered topics appear only after Finish and excluded papers need inclusion before an explicit extension',async t=>{
  const data=snapshot(),review=assignmentReview('run',{needsReview:1,report:{topics:[{id:'t1',name:'A new electrode structure',paperIds:['a','b']},{id:'t2',name:'A new flow mechanism',paperIds:['b']}],paperIds:['a','b']}});data.assignmentReview=review;data.assignmentReviews=[review];data.suggestions=[{id:'medium',runId:'run',paperId:'a',tagId:'fc',reason:'Needs review.',confidence:'medium',status:'pending',evidence:[]}];data.warnings=[warning('old-topic',{code:'unapproved-topics',message:'Old per-paper topic banner.'})];
  const h=await harness(data,{page:'review',onInvoke(action,payload,current){
    if(action==='accept-suggestion'){current.suggestions[0].status='accepted';review.needsReview=0;review.acceptedIds=['medium'];}
    if(action==='apply-suggestions'){current.suggestions[0].applied=true;review.acceptedIds=[];review.canFinish=true;}
    if(action==='finish-assignment')review.status='finished';
    if(action==='extend-assignment-topics')current.paperExclusionPreview={id:'include-topic-papers',exclude:false,changes:[{paperId:'b',title:'Detail elsewhere',before:['no_tag'],after:[]}]};
    if(action==='apply-paper-exclusion'){delete current.paperExclusionPreview;return {page:'cleanup'};}
  }});t.after(()=>h.ui.destroy());assert.doesNotMatch(h.app.textContent,/A new electrode structure|Old per-paper topic banner/);assert.equal(h.button('Finish assignment').disabled,true);await h.click('Accept');h.expand('Details');await h.click('Apply accepted…');await h.click('Apply 1 tag changes');await h.click('Finish assignment');assert.match(h.app.textContent,/A new electrode structure/);
  h.change('assignment-topic-t1',true);h.change('assignment-topic-t2',true);h.change('topic-additional-tag-target','40');await h.click('Extend from selected topics');assert.deepEqual(h.actions.at(-1),{action:'extend-assignment-topics',payload:{runId:'run',paperIds:['a','b'],additionalTargetCount:40}});assert.ok(h.button('Apply inclusion'));assert.equal(h.actions.some(action=>action.action==='apply-paper-exclusion'),false);
  await h.click('Apply inclusion');assert.deepEqual(h.actions.at(-1),{action:'apply-paper-exclusion',payload:{previewId:'include-topic-papers'}});assert.equal(h.doc.getElementById('nav-cleanup').getAttribute('aria-current'),'page');
});

test('extension targets count additions separately and review shows the cumulative list beyond sixty',async t=>{
  const data=snapshot();data.tags=Array.from({length:60},(_,index)=>tag(`saved-${index}`,`Saved ${index}`));data.settings.extensionTagTarget=30;data.workflow={buildMode:'extend',buildScope:'selected',buildPaperCount:3,assignmentScope:'library',assignmentPaperCount:0,assignedPaperCount:0};const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('additional-tag-target').value,'30');h.change('additional-tag-target','42');await h.emitUpdate();assert.equal(h.doc.getElementById('additional-tag-target').value,'42');await h.click('Prepare tags');assert.deepEqual(h.actions[0],{action:'prepare-tags',payload:{scope:'selected',mode:'extend',additionalTargetCount:42}});
  data.tagPreparation=preparation([...data.tags.slice(0,5).map(tag=>({...tag,retained:true})),...Array.from({length:12},(_,index)=>tag(`new-${index}`,`New ${index}`))]);await h.emitUpdate();assert.match(h.app.textContent,/60 saved \+ 12 new = 72 total/);assert.equal(data.settings.extensionTagTarget,30);
});

test('old topic notices remain in history without active warning banners',async t=>{
  const data=snapshot();data.warnings=[warning('topic',{code:'unapproved-topics',message:'Earlier unmatched topic names.'})];const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.equal(h.all().some(node=>node.classList.contains('active-warning-summary')),false);assert.match(h.app.textContent,/Earlier notice/);assert.match(h.app.textContent,/Earlier unmatched topic names/);assert.equal(h.actions.length,0);
});

test('saved tag shelves filter equal tags and keep stable membership when renamed',async t=>{
  const data=snapshot();data.tagShelves=[{id:'generated',name:'Generated tags 1',kind:'generated',tagIds:['fc','pemfc','eis'],count:3},{id:'mine',name:'My tags',kind:'user',tagIds:['rcl'],count:1}];
  const h=await harness(data,{page:'vocabulary',onInvoke(action,payload,current){if(action==='rename-tag-shelf')current.tagShelves!.find(shelf=>shelf.id===payload.id)!.name=payload.name;}});t.after(()=>h.ui.destroy());h.choose('tag-library-shelf',2);assert.ok(h.button('Edit tag RCL'));assert.equal(h.button('Edit tag FC'),undefined);assert.doesNotMatch(h.app.textContent,/DIY|core|custom/i);
  await h.click('Shelf actions');await h.click('Rename shelf…');h.change('tag-shelf-name','Resistance research');await h.click('Save shelf name');assert.deepEqual(h.actions,[{action:'rename-tag-shelf',payload:{id:'mine',name:'Resistance research'}}]);assert.match(h.doc.getElementById('tag-library-shelf').textContent,/Resistance research/);assert.ok(h.button('Edit tag RCL'));
  await h.click('Edit tag RCL');h.expand('More options');assert.ok(h.doc.getElementById('tag-matching-mode'));await h.click('Cancel');h.choose('tag-library-shelf',1);await h.click('Edit tag FC');h.expand('More options');assert.ok(h.doc.getElementById('tag-matching-mode'));await h.click('Cancel');await h.click('Add tag');h.change('tag-name','New topic');h.change('tag-description','A topic defined by the researcher.');await h.click('Save');assert.equal(h.actions.at(-1)!.action,'create-detail');assert.equal(h.actions.at(-1)!.payload.tagShelfId,'generated');assert.deepEqual(data.tagShelves[0].tagIds,['fc','pemfc','eis']);
});

test('All tags includes native names once and My tags combines those names with saved meanings without a separate Existing shelf',async t=>{
  const data=snapshot(),native=structuredClone(data.papers),names=[{name:'EIS',tagId:'eis',paperCount:1},{name:'RCL',tagId:'rcl',paperCount:2},{name:'Legacy Topic',paperCount:2},{name:'no_tag',paperCount:1,protected:true}];data.tagLibraryEntries=[...names,{name:'FC',tagId:'fc',paperCount:0},{name:'PEMFC',tagId:'pemfc',paperCount:2}];data.tagShelves=[{id:'generated',name:'Generated tags 1',kind:'generated',tagIds:['fc','pemfc','eis'],count:3},{id:'tag-shelf-my-tags',name:'My tags',kind:'user',tagIds:['rcl','eis'],count:4,nativeNames:names}];
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());assert.match(h.doc.getElementById('tag-library-shelf').textContent,/All tags · 6/);assert.equal(h.all().filter(node=>node.classList.contains('tag-row')).length,6);assert.equal(h.button('Existing tags'),undefined);h.choose('tag-library-shelf',2);assert.match(h.doc.getElementById('tag-library-shelf').textContent,/My tags · 4/);assert.equal(h.all().filter(node=>node.classList.contains('tag-row')).length,4);assert.ok(h.button('Edit tag EIS'));assert.ok(h.button('Remove tag RCL'));assert.equal(h.button('Edit tag FC'),undefined);assert.match(h.app.textContent,/No meaning added/);assert.match(h.app.textContent,/Shelves can share tags/);assert.equal(h.button('Add meaning for no_tag'),undefined);assert.equal(h.actions.length,0);await h.click('Add meaning for Legacy Topic');assert.equal(h.doc.getElementById('tag-name').value,'Legacy Topic');h.change('tag-description','A deliberately supplied topic meaning.');await h.click('Save');assert.equal(h.actions[0].action,'create-detail');assert.equal(h.actions[0].payload.tag.name,'Legacy Topic');assert.deepEqual(h.actions[0].payload.tag.aliases,['Legacy Topic']);assert.equal(h.actions[0].payload.tagShelfId,'tag-shelf-my-tags');assert.deepEqual(data.papers,native);assert.equal(h.actions.some(action=>action.action==='tag'||action.action==='prepare-tags'),false);
});

test('library and assignment show the same total and ready counts when native names overlap generated shelves',async t=>{
  const data=snapshot();data.tags=Array.from({length:155},(_,index)=>tag(`count-${index}`,`Saved topic ${index+1}`));
  const defined=data.tags.map(value=>({name:value.name,tagId:value.id,paperCount:1})),undefinedNames=Array.from({length:44},(_,index)=>({name:`Imported topic ${index+1}`,paperCount:1}));
  const mine=[...defined.slice(0,119),defined[154]],sizes=[40,30,29,29,26];let offset=0;
  data.tagLibraryEntries=[...defined,...undefinedNames];data.tagShelves=sizes.map((count,index)=>{const tagIds=data.tags.slice(offset,offset+=count).map(value=>value.id);return {id:`generated-${index+1}`,name:`Generated tags ${index+1}`,kind:'generated',tagIds,count};});
  data.tagShelves.splice(1,0,{id:'tag-shelf-my-tags',name:'My tags',kind:'user',tagIds:mine.map(value=>value.tagId),count:164,nativeNames:[...mine,...undefinedNames]});
  const native=structuredClone(data.papers),saved=structuredClone(data.tags),shelves=structuredClone(data.tagShelves),h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  const labels=(id:string)=>{h.doc.getElementById(id).emit('click');return Array.from({length:7},(_,index)=>h.doc.getElementById(`${id}-option-${index}`).textContent);};
  const expected=['All tags · 199 total · 155 ready','Generated tags 1 · 40 tags','My tags · 164 total · 120 ready','Generated tags 2 · 30 tags','Generated tags 3 · 29 tags','Generated tags 4 · 29 tags','Generated tags 5 · 26 tags'];
  const libraryLabels=labels('tag-library-shelf');assert.deepEqual(libraryLabels,expected);assert.match(h.doc.getElementById('nav-vocabulary').textContent,/199$/);assert.match(h.app.textContent,/Ready tags have a saved meaning/);assert.match(h.app.textContent,/Shelves can share tags/);
  h.ui.navigate({page:'assignment'});const assignmentLabels=labels('assignment-tag-shelf');assert.deepEqual(assignmentLabels,libraryLabels);assert.match(h.app.textContent,/Ready tags have a saved meaning/);assert.match(h.app.textContent,/Shelves can share tags/);
  h.doc.getElementById('assignment-tag-shelf-option-2').emit('click');await settle();await h.click('Suggest paper tags');assert.deepEqual(h.actions,[{action:'tag',payload:{scope:'library',tagShelfId:'tag-shelf-my-tags'}}]);assert.deepEqual(data.papers,native);assert.deepEqual(data.tags,saved);assert.deepEqual(data.tagShelves,shelves);assert.equal(data.settings.autoAssign,false);
});

test('assignment shelf choice is independent, survives refresh, and rejects shelves without meanings',async t=>{
  const data=snapshot();data.tagShelves=[{id:'generated',name:'Generated tags 1',kind:'generated',tagIds:['fc'],count:1},{id:'existing',name:'Earlier names',kind:'existing',tagIds:[],count:1,nativeNames:[{name:'Project X',paperCount:2}]}];data.workflow={buildMode:'extend',buildScope:'selected',buildPaperCount:51,assignmentScope:'collections',assignmentPaperCount:4,assignedPaperCount:0,assignmentTagShelfId:'generated'};
  const h=await harness(data,{page:'assignment'});t.after(()=>h.ui.destroy());assert.match(h.doc.getElementById('assignment-tag-shelf').textContent,/Generated tags 1/);h.choose('assignment-tag-shelf',2);assert.equal(h.button('Suggest paper tags').disabled,true);assert.match(h.app.textContent,/This shelf has no tags with meanings yet/);h.choose('assignment-tag-shelf',1);await h.emitUpdate();await h.click('Suggest paper tags');assert.deepEqual(h.actions,[{action:'tag',payload:{scope:'collections',tagShelfId:'generated'}}]);assert.equal(data.settings.autoAssign,false);
});

test('routine matches finish through one exact preview without other runs, rejected matches, or exclusions',async t=>{
  const data=snapshot();data.assignmentReview=assignmentReview('run',{acceptedIds:['high'],highAccepted:1,bulkAcceptCount:1,bulkAcceptIds:['medium'],needsChoiceCount:0});data.suggestions=[{id:'high',runId:'run',paperId:'a',tagId:'fc',reason:'Supported.',confidence:'high',status:'accepted',evidence:[]},{id:'medium',runId:'run',paperId:'b',tagId:'eis',reason:'Supported routine match.',confidence:'medium',status:'pending',evidence:[]},{id:'low',runId:'run',paperId:'c',tagId:'fc',reason:'Weak.',confidence:'low',status:'rejected',evidence:[]},{id:'other',runId:'other',paperId:'d',tagId:'fc',reason:'Earlier.',confidence:'high',status:'accepted',evidence:[]}];const native=structuredClone(data.papers);
  const h=await harness(data,{page:'review'});t.after(()=>h.ui.destroy());assert.equal(h.button('Accept'),undefined);assert.equal(h.button('Apply accepted…'),undefined);await h.click('Accept remaining and finish');assert.equal(h.actions.length,0);assert.match(h.app.textContent,/Detail elsewhere/);assert.doesNotMatch(h.app.textContent,/Fuel cell only/);assert.equal(h.all().filter(node=>node.localName==='tbody')[0].children.length,2);await h.click('Apply and finish');assert.deepEqual(h.actions,[{action:'finish-assignment',payload:{runId:'run',acceptRemaining:true}}]);assert.deepEqual(data.papers,native);
});

test('only consequential assignment choices remain visible while routine matches can be accepted together',async t=>{
  const data=snapshot();data.assignmentReview=assignmentReview('run',{needsReview:2,bulkAcceptCount:1,bulkAcceptIds:['routine'],needsChoiceCount:1});data.suggestions=[{id:'routine',runId:'run',paperId:'a',tagId:'fc',reason:'Routine supported match.',confidence:'medium',status:'pending',evidence:[]},{id:'choice',runId:'run',paperId:'b',tagId:'rcl',reason:'Choose whether this meaning belongs here.',confidence:'medium',status:'pending',evidence:[]}];const h=await harness(data,{page:'review'});t.after(()=>h.ui.destroy());assert.equal(h.all().filter(node=>node.localName==='button'&&node.textContent==='Accept').length,1);assert.doesNotMatch(h.app.textContent,/Routine supported match/);await h.click('Accept 1 suggested matches');assert.deepEqual(h.actions,[{action:'accept-run-suggestions',payload:{runId:'run'}}]);assert.equal(h.button('Accept remaining and finish'),undefined);
});

test('maintenance jobs use their task name without a fictitious paper count',async t=>{
  const data=snapshot();data.queue={status:'paused',taskLabel:'Checking tag names',total:0,completed:0,failed:0,message:'Waiting for the selected connection.'};const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Checking tag names/);assert.doesNotMatch(h.app.textContent,/Paper analysis|0 of 0|0 papers read/);assert.equal(h.actions.length,0);
});

test('resetting reusable paper analysis requires one explicit confirmation in Settings data controls',async t=>{
  const data=snapshot(),native=structuredClone(data.papers),tags=structuredClone(data.tags),settings=structuredClone(data.settings);const h=await harness(data,{page:'settings'});t.after(()=>h.ui.destroy());assert.equal(h.button('Reset paper analysis…'),undefined);h.expand('Data');await h.click('Reset paper analysis…');assert.equal(h.actions.length,0);assert.match(h.app.textContent,/paper-tag suggestions/);assert.match(h.app.textContent,/PDFs, paper tags, saved tag definitions, credentials, spending records, and audit history stay in place/);await h.click('Cancel');assert.equal(h.actions.length,0);await h.click('Reset paper analysis…');await h.click('Reset paper analysis');assert.deepEqual(h.actions,[{action:'reset-paper-analysis',payload:undefined}]);assert.match(h.app.textContent,/Paper analysis reset\. The next build will start fresh/);assert.deepEqual(data.papers,native);assert.deepEqual(data.tags,tags);assert.deepEqual(data.settings,settings);
});

test('a single Details click persists before the native toggle event or a background refresh',async t=>{
  const h=await harness(snapshot(),{page:'settings'});t.after(()=>h.ui.destroy());const summary=h.doc.getElementById('details-data');summary.focus();summary.emit('click');assert.ok(h.button('Reset paper analysis…'));await h.emitUpdate();assert.equal(h.doc.getElementById('details-data').parentNode.open,true);assert.ok(h.button('Reset paper analysis…'));assert.equal(h.doc.activeElement.id,'details-data');summary.parentNode.emit('toggle');assert.ok(h.button('Reset paper analysis…'));h.doc.getElementById('details-data').emit('click');await h.emitUpdate();assert.equal(h.doc.getElementById('details-data').parentNode.open,false);assert.equal(h.button('Reset paper analysis…'),undefined);assert.equal(h.actions.length,0);
});

test('shelf actions combine selected lists once while preserving tag meanings and paper assignments',async t=>{
  const data=snapshot(),native=structuredClone(data.papers),saved=structuredClone(data.tags);
  data.tagLibraryEntries=[...data.tags.map(tag=>({name:tag.name,tagId:tag.id,paperCount:1})),{name:'Lab marker',paperCount:2}];
  data.tagShelves=[{id:'first',name:'Generated tags 1',kind:'generated',tagIds:['fc','pemfc','eis'],count:3},{id:'second',name:'Generated tags 2',kind:'generated',tagIds:['rcl','eis'],count:2},{id:'tag-shelf-my-tags',name:'My tags',kind:'user',tagIds:['rcl','eis'],count:3,nativeNames:[{name:'RCL',tagId:'rcl',paperCount:1},{name:'EIS',tagId:'eis',paperCount:1},{name:'Lab marker',paperCount:2}]}];
  const h=await harness(data,{page:'vocabulary',onInvoke(action,payload,current){if(action!=='merge-tag-shelves')return;current.tagShelves=[{id:'tag-shelf-my-tags',name:payload.name,kind:'user',tagIds:['fc','pemfc','eis','rcl'],count:5,nativeNames:current.tagLibraryEntries}];return {shelfId:'tag-shelf-my-tags'};}});t.after(()=>h.ui.destroy());
  assert.equal(h.button('Rename shelf…'),undefined);await h.click('Shelf actions');await h.click('Merge shelves…');assert.equal(h.button('Merge shelves').disabled,true);
  h.change('merge-shelf-first',true);h.change('merge-shelf-second',true);assert.match(h.app.textContent,/2 shelves · 4 unique tags/);h.change('merge-shelf-tag-shelf-my-tags',true);assert.match(h.app.textContent,/3 shelves · 5 unique tags/);assert.match(h.app.textContent,/Native Zotero names stay available in the combined shelf/);h.change('replace-merged-shelves',false);assert.match(h.app.textContent,/Tags and paper assignments are preserved/);h.change('replace-merged-shelves',true);h.change('merged-shelf-name','All research');await h.click('Merge shelves');
  assert.deepEqual(h.actions,[{action:'merge-tag-shelves',payload:{sourceIds:['first','second','tag-shelf-my-tags'],name:'All research',replaceSources:true}}]);assert.equal(h.doc.getElementById('tag-library-shelf').textContent,'All research · 5 total · 4 ready');assert.equal(data.tagShelves.length,1);assert.equal(data.tagShelves[0].id,'tag-shelf-my-tags');assert.deepEqual(data.tags,saved);assert.deepEqual(data.papers,native);assert.equal(data.settings.autoAssign,false);
});

test('Needs meaning selects exact native names across pages without including ready tags or protected markers',async t=>{
  const data=snapshot(),names=Array.from({length:22},(_,index)=>({name:index===0?'  Imported marker  ':`Imported marker ${index}`,paperCount:1,paperIds:['a']})),native=structuredClone(data.papers),saved=structuredClone(data.tags);
  data.queue={kind:'rebuild',ownerPage:'cleanup',status:'running',total:51,completed:12,failed:0};const queue=structuredClone(data.queue);
  data.tagLibraryEntries=[{name:'FC',tagId:'fc',paperCount:1},...names,{name:'no_tag',paperCount:1,protected:true}];data.tagShelves=[{id:'mine',name:'My tags',kind:'user',tagIds:['fc'],count:24,nativeNames:data.tagLibraryEntries}];
  const h=await harness(data,{page:'vocabulary',onInvoke(action,payload,current){if(action==='prepare-tag-meanings')current.nativeDefinitionPreparation={id:'native-meanings',status:'queued',completed:0,total:payload.names.length,canApply:false,rows:payload.names.map((name:string,index:number)=>({id:`name-${index}`,sourceName:name,paperIds:['a'],status:'pending'}))};}});t.after(()=>h.ui.destroy());
  h.choose('tag-library-status',2);assert.equal(h.button('Edit tag FC'),undefined);assert.equal(h.button('Add meaning for no_tag'),undefined);assert.equal(h.all().filter(node=>node.classList.contains('tag-row')).length,20);h.change(`select-native-tag-${encodeURIComponent(names[0].name)}`,true);await h.click('Next tags');h.change(`select-native-tag-${encodeURIComponent(names[21].name)}`,true);assert.match(h.app.textContent,/2 selected/);h.change('vocabulary-search','marker 2');assert.match(h.app.textContent,/2 selected/);h.change('vocabulary-search','');await h.click('Select all names');assert.match(h.app.textContent,/22 selected/);await h.click('Prepare meanings');
  assert.deepEqual(h.actions,[{action:'prepare-tag-meanings',payload:{names:[names[0].name,names[21].name,...names.slice(1,21).map(entry=>entry.name)],shelfId:'all'}}]);assert.match(h.app.textContent,/Meanings queued/);assert.match(h.app.textContent,/Starts after the current analysis finishes/);assert.match(h.app.textContent,/0 of 22 names prepared/);assert.deepEqual(data.queue,queue);assert.deepEqual(data.tags,saved);assert.deepEqual(data.papers,native);assert.equal(data.settings.autoAssign,false);
});

test('prepared meanings save every clear result together and leave uncertain names for optional manual meaning',async t=>{
  const data=snapshot(),native=structuredClone(data.papers);data.nativeDefinitionPreparation={id:'prepared-native',status:'ready',completed:3,total:3,canApply:true,rows:[{id:'saved-match',sourceName:'resistance marker',name:'RCL',description:'Catalyst-layer resistance.',facet:'phenomenon',paperIds:['a'],status:'ready',targetTagId:'rcl'},{id:'new-meaning',sourceName:'grooved CL',name:'grooved catalyst layer',description:'Catalyst layers patterned with grooves.',facet:'component',paperIds:['a'],status:'ready'},{id:'uncertain',sourceName:'AC',paperIds:['b'],status:'question',question:'Which meaning of AC do you want to follow?'}]};
  const h=await harness(data,{page:'vocabulary',onInvoke(action,payload,current){if(action==='apply-tag-meanings'){for(const row of current.nativeDefinitionPreparation!.rows)if(payload.rowIds.includes(row.id))row.applied=true;current.nativeDefinitionPreparation!.canApply=false;}}});t.after(()=>h.ui.destroy());assert.equal(h.button('Save 2 meanings').disabled,false);assert.match(h.app.textContent,/From: resistance marker/);assert.match(h.app.textContent,/Use saved tag/);assert.match(h.app.textContent,/Which meaning of AC/);assert.doesNotMatch(h.app.textContent,/registry|snapshot|fingerprint|supportRegistryIds/i);await h.click('Save 2 meanings');assert.deepEqual(h.actions,[{action:'apply-tag-meanings',payload:{id:'prepared-native',rowIds:['saved-match','new-meaning']}}]);assert.equal(h.button('Save 0 meanings'),undefined);
  await h.click('Add meaning');assert.equal(h.doc.getElementById('tag-name').value,'AC');h.change('tag-description','A personally defined alternating-current measurement topic.');await h.click('Save');assert.equal(h.actions[1].action,'create-detail');assert.deepEqual(h.actions[1].payload.tag.aliases,['AC']);assert.match(h.app.textContent,/Meaning saved/);await h.click('Back to tags');assert.ok(h.button('Review prepared meanings'));assert.deepEqual(data.papers,native);assert.equal(data.settings.autoAssign,false);assert.equal(h.actions.some(entry=>entry.action==='tag'||entry.action==='apply-suggestions'),false);
});

test('run progress belongs only to Activity and the page carrying the unfinished task',async t=>{
  const data=snapshot();data.queue={kind:'rebuild',ownerPage:'cleanup',status:'running',phase:'mapping',total:36,completed:36,failed:0,phaseProgress:{completed:20,total:36,label:'Tags prepared'},message:'Checking the current tag list.'};const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());const strips=()=>h.all().filter(node=>node.className==='run-strip');assert.equal(strips().length,1);
  for(const target of ['overview','connection','assignment','vocabulary','library','settings'] as const){h.ui.navigate({page:target});assert.equal(strips().length,0,target);}h.ui.navigate({page:'activity'});assert.equal(strips().length,1);
  data.queue.status='idle';data.queue.phase='ready';data.queue.message='Your tag list is saved. Choose papers to preview assignments.';await h.emitUpdate();h.ui.navigate({page:'cleanup'});assert.equal(strips().length,0);h.ui.navigate({page:'activity'});assert.equal(strips().length,1);assert.match(strips()[0].textContent,/Tag list saved/);assert.doesNotMatch(strips()[0].textContent,/Ready for review/);
  data.queue={kind:'tag',ownerPage:'assignment',status:'paused',total:4,completed:2,failed:0,message:'Assignment paused.'};await h.emitUpdate();h.ui.navigate({page:'assignment'});assert.equal(strips().length,1);h.ui.navigate({page:'cleanup'});assert.equal(strips().length,0);
  data.queue={ownerPage:'vocabulary',taskLabel:'Preparing tag meanings',status:'running',total:2,completed:1,failed:0};data.nativeDefinitionPreparation={id:'task',status:'running',completed:1,total:2,canApply:false,rows:[]};await h.emitUpdate();h.ui.navigate({page:'vocabulary'});assert.equal(strips().length,1);h.ui.navigate({page:'connection'});assert.equal(strips().length,0);assert.equal(h.actions.length,0);
});

test('undoing a merged shelf restores valid library and assignment selections without changing captured work',async t=>{
  const data=snapshot();data.tagShelves=[{id:'combined',name:'Combined research',kind:'user',tagIds:['fc','eis'],count:2}];data.workflow={buildMode:'extend',buildScope:'selected',buildPaperCount:2,assignmentScope:'library',assignmentPaperCount:2,assignedPaperCount:0,assignmentTagShelfId:'combined'};const original=structuredClone(data.papers),h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());h.choose('tag-library-shelf',1);assert.match(h.doc.getElementById('tag-library-shelf').textContent,/Combined research/);h.ui.navigate({page:'assignment'});assert.match(h.doc.getElementById('assignment-tag-shelf').textContent,/Combined research/);
  data.tagShelves=[{id:'first',name:'Earlier research',kind:'generated',tagIds:['fc'],count:1}];data.workflow.assignmentTagShelfId='first';await h.emitUpdate();h.ui.navigate({page:'vocabulary'});assert.match(h.doc.getElementById('tag-library-shelf').textContent,/All tags/);h.ui.navigate({page:'assignment'});assert.match(h.doc.getElementById('assignment-tag-shelf').textContent,/Earlier research/);await h.click('Suggest paper tags');assert.deepEqual(h.actions,[{action:'tag',payload:{scope:'library',tagShelfId:'first'}}]);assert.deepEqual(data.papers,original);
});
