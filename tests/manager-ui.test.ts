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
  return {win,doc,app,timers,timerDelays,all:()=>descendants(app),button:(label:string)=>descendants(app).find(node=>node.localName==='button'&&node.textContent===label)!};
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
interface HarnessOptions extends ManagerUIOptions {
  failAction?: string;
  emitOnInvoke?: number;
  onSnapshot?: (call: number, emit: () => void, current: ManagerSnapshot) => void | ManagerSnapshot | Promise<void | ManagerSnapshot>;
}
async function harness(data=snapshot(),options:HarnessOptions={}) {
  const {failAction,emitOnInvoke=0,onSnapshot,...uiOptions}=options;
  const dom=managerDOM();const actions:{action:string;payload:any}[]=[];
  const subscribers=new Set<()=>void>();let snapshotCalls=0;
  const context=vm.createContext({Zotero:{debug(){}},console});vm.runInContext(await bundle,context);
  const emit=()=>{for(const listener of subscribers)listener();};
  const api={snapshot:async()=>{snapshotCalls++;return await onSnapshot?.(snapshotCalls,emit,data)??structuredClone(data);},subscribe:(listener:()=>void)=>{subscribers.add(listener);return()=>subscribers.delete(listener);},invoke:async(action:string,payload:any)=>{
    actions.push({action,payload:structuredClone(payload)});
    if(failAction===action)throw new Error('The tag could not be saved.');
    if(action==='prepare-tags')data.tagPreparation={...preparation(data.tags),status:'checking',canApply:false};
    if(action==='edit-prepared-tag'&&data.tagPreparation)data.tagPreparation.tags=data.tagPreparation.tags.map(tag=>tag.id===payload.tag.id?payload.tag:tag);
    if(action==='remove-prepared-tag'&&data.tagPreparation)data.tagPreparation.tags=data.tagPreparation.tags.filter(tag=>tag.id!==payload.tagId).map(tag=>({...tag,broaderIds:tag.broaderIds.filter(id=>id!==payload.tagId),relatedIds:tag.relatedIds?.filter(id=>id!==payload.tagId)}));
    if(action==='answer-tag-question'&&data.tagPreparation){data.tagPreparation.questions=data.tagPreparation.questions.filter(question=>question.id!==payload.questionId);data.tagPreparation.canApply=!data.tagPreparation.questions.length;data.tagPreparation.status=data.tagPreparation.questions.length?'questions':'ready';}
    if(action==='retry-tag-preparation'&&data.tagPreparation){data.tagPreparation.status='checking';data.tagPreparation.canApply=false;}
    if(action==='apply-tag-list'&&data.tagPreparation){data.tags=data.tagPreparation.tags;data.queue={status:'running',total:data.tagPreparation.scopeCount,completed:0,failed:0,message:'Preparing paper suggestions.'};}
    if(action==='dismiss-warning')for(const record of data.warnings||[])if(record.id===payload.id&&record.status==='active')record.status='dismissed';
    if(action==='dismiss-warnings')for(const record of data.warnings||[])if(record.status==='active')record.status='dismissed';
    if(action==='save-settings')data.settings=payload.settings;
    if(action==='save-api-key'&&payload.provider==='deepseek')data.connection.deepseekKeyStored=true;
    if(action==='create-detail'){const created={...payload.tag,id:'new-detail',status:'approved'};data.tags.push(created);return created.id;}
    for(let i=0;i<emitOnInvoke;i++)emit();
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
  const nativeChoices=structuredClone(data.papers);const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  assert.equal(h.all().filter(node=>node.localName==='article'&&node.classList.contains('tag-row')).length,1);
  assert.match(h.app.textContent,/Your tag list is ready/);assert.equal(h.app.textContent.includes('Old draft'),false);
  assert.doesNotMatch(h.app.textContent,/\b(?:registry|snapshot|fingerprint|staged|core|taxonomy)\b/i);
  assert.equal(h.button('Confirm scientific mapping'),undefined);assert.equal(h.button('Apply tag list').disabled,false);
  assert.deepEqual(data.papers,nativeChoices);assert.equal(h.actions.length,0);
});

test('Prepare tags starts the selected scope and opens the Tags workspace',async t=>{
  const h=await harness(snapshot());t.after(()=>h.ui.destroy());h.choose('analysis-scope',1);await h.click('Prepare tags');
  assert.deepEqual(h.actions,[{action:'prepare-tags',payload:{scope:'selected'}}]);assert.match(h.app.textContent,/Checking your tags/);assert.ok(h.button('Resume checks'));
});

test('only meaningful questions need a choice, with paper links and exact choice identities',async t=>{
  const data=snapshot();data.tagPreparation={...preparation(),status:'questions',canApply:false,questions:[{id:'meaning-rcl',title:'Does this measurement belong under RCL?',description:'The paper discusses catalyst-layer resistance. Choose the meaning you want to keep.',paperIds:['a'],choices:[{id:'same',label:'Use RCL',description:'Keep this meaning together.'},{id:'separate',label:'Keep it separate',description:'Use a different tag for this topic.'}]}]};
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());assert.equal(h.button('Apply tag list').disabled,true);
  await h.click('Questions (1)');assert.match(h.app.textContent,/Does this measurement belong under RCL/);await h.click('Context match');
  assert.deepEqual(h.actions[0],{action:'show-paper',payload:{id:'a'}});await h.click('Use RCL');
  assert.deepEqual(h.actions[1],{action:'answer-tag-question',payload:{id:'prepared',questionId:'meaning-rcl',choiceId:'same'}});
  assert.equal(h.button('Apply tag list').disabled,false);assert.match(h.app.textContent,/No questions waiting/);
});

test('Apply tag list prepares paper suggestions without writing paper tags or enabling automatic assignment',async t=>{
  const data=snapshot();data.settings.autoAssign=false;data.tagPreparation=preparation();const original=structuredClone(data.papers);
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Apply tag list');
  assert.deepEqual(h.actions,[{action:'apply-tag-list',payload:{id:'prepared'}}]);assert.match(h.app.textContent,/Preparing paper suggestions/);
  assert.deepEqual(data.papers,original);assert.equal(data.settings.autoAssign,false);assert.equal(h.actions.some(entry=>entry.action==='apply-suggestions'),false);
});

test('the preferred count is soft and a larger ready tag list can be applied',async t=>{
  const data=snapshot();data.tagPreparation=preparation(Array.from({length:67},(_,i)=>tag(`t${i}`,`Topic ${i}`)));data.tagPreparation.targetCount=60;
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/67 tags/);assert.equal(h.button('Apply tag list').disabled,false);
  assert.equal(h.all().filter(node=>node.localName==='article'&&node.classList.contains('tag-row')).length,20);await h.click('Next tags');assert.match(h.app.textContent,/Topic 20/);
});

test('checking and failed preparations retain completed work and offer explicit continuation',async t=>{
  const data=snapshot();data.tagPreparation={...preparation(),status:'failed',canApply:false,error:'Unknown registry registry-0123456789 in snapshot'};
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());assert.equal(h.button('Apply tag list').disabled,true);
  assert.doesNotMatch(h.app.textContent,/registry-0123456789|snapshot/);assert.match(h.app.textContent,/completed paper analysis is saved/);
  await h.click('Try again');assert.deepEqual(h.actions[0],{action:'retry-tag-preparation',payload:{id:'prepared'}});assert.ok(h.button('Resume checks'));
});

test('Edit saves a prepared tag through its preparation and keeps editor scrolling separate from Save',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  await h.click('Edit tag FC');h.change('tag-description','A clearer meaning of fuel-cell systems.');
  const editor=h.all().find(node=>node.classList.contains('tag-editor'))!,body=h.all().find(node=>node.classList.contains('editor-scroll'))!,footer=h.all().find(node=>node.classList.contains('editor-footer'))!;
  assert.equal(body.contains(h.button('Save')),false);assert.equal(footer.contains(h.button('Save')),true);assert.equal(editor.contains(body),true);
  assert.equal(h.all().find(node=>node.classList.contains('editor-advanced'))!.open,false);body.scrollTop=900;await h.click('Save');
  assert.equal(h.actions[0].action,'edit-prepared-tag');assert.equal(h.actions[0].payload.id,'prepared');assert.equal(h.actions[0].payload.tag.id,'fc');assert.equal(h.actions[0].payload.tag.description,'A clearer meaning of fuel-cell systems.');
  assert.equal(data.tags.find(tag=>tag.id==='fc')!.description,'Definition of FC');assert.equal(h.doc.getElementById('tag-name'),null);
});

test('editor drafts survive other edits and background refresh; Cancel discards only the current draft',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  await h.click('Edit tag FC');h.change('tag-description','My unfinished FC wording.');await h.click('Edit tag PEMFC');h.change('tag-name','My PEMFC');
  await h.click('Edit tag FC');assert.equal(h.doc.getElementById('tag-description').value,'My unfinished FC wording.');await h.emitUpdate();assert.equal(h.doc.getElementById('tag-description').value,'My unfinished FC wording.');
  await h.click('Cancel');await h.click('Edit tag FC');assert.equal(h.doc.getElementById('tag-description').value,'Definition of FC');await h.click('Edit tag PEMFC');assert.equal(h.doc.getElementById('tag-name').value,'My PEMFC');
});

test('Apply waits for every unsaved edit, including drafts for another prepared tag',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  await h.click('Edit tag FC');assert.equal(h.button('Apply tag list').disabled,false);
  h.change('tag-description','Changed FC meaning.');assert.equal(h.button('Apply tag list').disabled,true);assert.match(h.app.textContent,/Save or cancel your edits/);
  await h.click('Edit tag PEMFC');assert.equal(h.button('Apply tag list').disabled,true,'The FC draft is still waiting');await h.click('Cancel');assert.equal(h.button('Apply tag list').disabled,true);
  await h.click('Edit tag FC');await h.click('Save');assert.equal(h.button('Apply tag list').disabled,false);
});

test('prepared Remove uses the domain action, preserves other drafts, and makes no native change',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const native=structuredClone(data.papers);
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Edit tag PEMFC');h.change('tag-description','Unfinished PEMFC wording.');await h.click('Remove tag FC');
  assert.deepEqual(h.actions[0],{action:'remove-prepared-tag',payload:{id:'prepared',tagId:'fc'}});assert.equal(data.tagPreparation.tags.some(tag=>tag.id==='fc'),false);
  assert.equal(h.doc.getElementById('tag-description').value,'Unfinished PEMFC wording.');assert.deepEqual(data.papers,native);assert.equal(data.tags.some(tag=>tag.id==='fc'),true);
});

test('failed prepared changes keep unsaved editor text and a successful removal closes the matching editor',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const failed=await harness(data,{page:'vocabulary',failAction:'edit-prepared-tag'});t.after(()=>failed.ui.destroy());
  await failed.click('Edit tag FC');failed.change('tag-description','Keep my unsaved words.');await failed.click('Save');assert.equal(failed.doc.getElementById('tag-description').value,'Keep my unsaved words.');assert.match(failed.app.textContent,/could not be saved/);
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Edit tag FC');await h.click('Remove tag FC');assert.equal(h.doc.getElementById('tag-name'),null);
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
  assert.match(h.app.textContent,/check your connection in Settings/);assert.doesNotMatch(h.app.textContent,/401|fact-extraction/);
  data.warnings=[warning('budget',{message:'The next request exceeds the budget'})];await h.emitUpdate();assert.match(h.app.textContent,/usage or spending limit/);
});

test('Activity gives the next useful step without repeating tag questions or technical diagnostics',async t=>{
  const data=snapshot();data.tagPreparation=preparation();data.queue.consolidation={phase:'needs-review',correctionAttempts:1,issues:['Unknown registry private-id'],canRegenerate:true,rawResponses:[{label:'Raw response',response:'private source text'}]};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.ok(h.button('Open tags'));assert.doesNotMatch(h.app.textContent,/registry|private-id|private source text|correctionAttempts/);await h.click('Open tags');assert.ok(h.button('Apply tag list'));
});

test('private analysis export and optional older-tag cleanup are confined to Settings',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());assert.equal(h.button('Export analysis with paper text…'),undefined);
  h.ui.navigate({page:'settings'});h.expand('Import, export, and previous tag lists');assert.match(h.app.textContent,/private export includes paper text and quotations/);await h.click('Export analysis with paper text…');assert.deepEqual(h.actions[0],{action:'export-tag-analysis',payload:{id:'prepared'}});
  await h.click('Find older tag duplicates');assert.equal(h.actions[1].action,'preview-cleanup');assert.match(h.app.textContent,/Existing-tag cleanup/);
});

test('successful messages expire after four seconds through the same notification lifecycle',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Remove tag FC');assert.match(h.app.textContent,/Tag removed from this list/);
  const timer=[...h.timerDelays].find(([,delay])=>delay===4000)!;assert.ok(timer);const callback=h.timers.get(timer[0])!;h.timers.delete(timer[0]);h.timerDelays.delete(timer[0]);callback();assert.equal(h.app.textContent.includes('Tag removed from this list.'),false);
});

test('large tag and question lists stay bounded and maintain independent list/editor state',async t=>{
  const data=snapshot();data.tagPreparation={...preparation(Array.from({length:80},(_,i)=>tag(`tag${i}`,`Topic ${i}`))),status:'questions',canApply:false,questions:Array.from({length:25},(_,i)=>({id:`q${i}`,title:`Question ${i}`,description:'Choose the useful meaning.',paperIds:['a'],choices:[{id:'keep',label:'Keep this meaning',description:''}]}))};
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());assert.equal(h.all().filter(node=>node.localName==='article'&&node.classList.contains('tag-row')).length,20);assert.equal(h.all().some(node=>node.localName==='blockquote'),false);assert.ok(h.all().length<3000);
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
  h.choose('settings-provider',2);assert.equal(h.doc.getElementById('settings-model').value,'');assert.equal(h.doc.getElementById('settings-inputPricePerMillion').value,'0');assert.equal(h.doc.getElementById('settings-deepseek-key').type,'password');h.change('settings-deepseek-key','test-private-key');await h.click('Save DeepSeek key');assert.deepEqual(h.actions[1],{action:'save-api-key',payload:{key:'test-private-key',provider:'deepseek'}});assert.equal(h.doc.getElementById('settings-deepseek-key').value,'');assert.equal(JSON.stringify(h.data).includes('test-private-key'),false);
});

test('action notifications share one final refresh and later external changes remain visible',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'vocabulary',emitOnInvoke:5});t.after(()=>h.ui.destroy());await h.click('Remove tag FC');assert.equal(h.snapshotCalls,2);data.warnings=[warning('external')];await h.emitUpdate();assert.equal(h.snapshotCalls,3);assert.match(h.app.textContent,/Evidence gap external/);
});
