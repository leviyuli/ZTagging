import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import type { DisplayTag, ManagerSnapshot } from '../src/ui-contract.ts';
import type { ManagerUIOptions } from '../src/ui.ts';
import type { WarningRecord } from '../src/warnings.ts';
import type { ViewEvent, ViewQuery } from '../src/workspace-contract.ts';

const bundle = build({entryPoints:['src/ui.ts'],bundle:true,write:false,format:'iife',globalName:'ManagerUI',platform:'browser',target:'firefox140'}).then(result=>result.outputFiles[0].text);
const settle = () => new Promise<void>(resolve=>setImmediate(resolve));

/** XML chrome DOM with real control handlers, sufficient for complete manager flows. */
function managerDOM(nativeSVG=false) {
  const rectangles=new Map<string,Partial<{left:number;top:number;width:number;height:number}>>(),focusScroll=new Map<string,number>();
  class Target {
    listeners = new Map<string,Set<(event:any)=>void>>();
    addEventListener(name:string,callback:(event:any)=>void) {const list=this.listeners.get(name)||new Set();list.add(callback);this.listeners.set(name,list);}
    removeEventListener(name:string,callback:(event:any)=>void) {this.listeners.get(name)?.delete(callback);}
    emit(name:string,extra:any={}) {const event={target:this,currentTarget:this,key:'',preventDefault(){},stopPropagation(){},...extra};for(const callback of [...this.listeners.get(name)||[]])callback(event);}
  }
  class Element extends Target {
    id='';className='';children:Element[]=[];parentNode:any=null;attributes=new Map<string,string>();style:any={};
    disabled=false;checked=false;value='';type='';open=false;scrollTop=0;ownText='';nodeType=1;ownerDocument:any;localName:string;
    constructor(name:string){super();this.localName=name;this.ownerDocument=doc;const style=this.style;Object.defineProperty(style,'cssText',{get(){return Object.entries(style).map(([key,value])=>`${key}:${value}`).join(';');},set(text:string){for(const key of Object.keys(style))delete style[key];for(const entry of text.split(';')){const split=entry.indexOf(':');if(split>=0)style[entry.slice(0,split)]=entry.slice(split+1);}}});}
    get textContent():string{return this.ownText+this.children.map(child=>child.textContent).join('');}
    set textContent(value:string){this.ownText=value;this.replaceChildren();}
    get isConnected():boolean{return this===doc.body||!!this.parentNode?.isConnected;}
    get lastElementChild(){return this.children.at(-1)||null;}
    get childNodes(){return this.children;}
    get firstChild(){return this.children[0]||null;}
    get classList(){const value=()=>typeof this.className==='string'?this.className:this.getAttribute('class')||'',set=(next:string)=>{if(typeof this.className==='string')this.className=next;else this.setAttribute('class',next);};return {contains:(name:string)=>value().split(/\s+/).includes(name),add:(name:string)=>set(`${value()} ${name}`),remove:(name:string)=>set(value().split(/\s+/).filter(value=>value!==name).join(' '))};}
    append(...nodes:Element[]){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
    replaceChildren(...nodes:Element[]){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}
    insertBefore(node:Element,before:Element|null){if(node===before)return node;if(node.contains(this))throw new Error(`Hierarchy cycle inserting ${node.id||node.localName} into ${this.id||this.localName}`);node.remove();node.parentNode=this;const index=before?this.children.indexOf(before):-1;if(index<0)this.children.push(node);else this.children.splice(index,0,node);return node;}
    removeChild(node:Element){node.remove();return node;}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter((node:Element)=>node!==this);this.parentNode=null;}
    setAttribute(name:string,value:string){this.attributes.set(name,String(value));}
    getAttribute(name:string){return this.attributes.get(name)??null;}
    removeAttribute(name:string){this.attributes.delete(name);}
    contains(node:any):boolean{return node===this||this.children.some(child=>child.contains(node));}
    focus(options?:{preventScroll?:boolean}){doc.activeElement=this;const next=focusScroll.get(this.id);if(next!==undefined&&!options?.preventScroll)win.scrollTo(0,next);}
    scrollIntoView(){}
    querySelectorAll(selector:string){return descendants(this).filter(node=>matches(node,selector));}
    querySelector(selector:string){return this.querySelectorAll(selector)[0]||null;}
    getBoundingClientRect(){const override=[...rectangles].find(([selector])=>matches(this,selector))?.[1]??{}, {left=10,top=10,width=260,height=34}=override;return {left,top,width,height,right:left+width,bottom:top+height};}
    get offsetTop(){return 0;}get offsetHeight(){return 34;}get clientHeight(){return 250;}get scrollHeight(){return this.children.length*34;}
  }
  const doc:any=new Target();
  doc.createElement=()=>{throw new Error('A chrome XML document requires explicit namespaces');};
  doc.createElementNS=(namespace:string,name:string)=>{assert.ok(['http://www.w3.org/1999/xhtml','http://www.w3.org/2000/svg'].includes(namespace));const element=new Element(name);if(nativeSVG&&namespace==='http://www.w3.org/2000/svg')Object.defineProperty(element,'className',{get:()=>({baseVal:element.getAttribute('class')||''})});return element;};
  doc.createTextNode=(text:string)=>{const node=new Element('#text');node.nodeType=3;node.textContent=text;return node;};
  doc.body=new Element('body');doc.documentElement=doc.body;doc.activeElement=doc.body;
  const app=new Element('div');app.id='app';doc.body.append(app);
  doc.getElementById=(id:string)=>[doc.body,...descendants(doc.body)].find(node=>node.id===id)||null;
  doc.querySelectorAll=(selector:string)=>[doc.body,...descendants(doc.body)].filter(node=>matches(node,selector));
  doc.querySelector=(selector:string)=>doc.querySelectorAll(selector)[0]||null;
  const timers=new Map<number,()=>void>();let nextTimer=0;
  const timerDelays=new Map<number,number>();
  const win:any=new Target();Object.assign(win,{document:doc,innerWidth:1100,innerHeight:800,scrollY:0,scrollTo(_x:number,y:number){win.scrollY=y;},confirm:()=>true,setTimeout(callback:()=>void,delay:number){const id=++nextTimer;timers.set(id,callback);timerDelays.set(id,delay);return id;},clearTimeout(id:number){timers.delete(id);timerDelays.delete(id);}});
  function descendants(root:Element):Element[]{return root.children.flatMap(child=>[child,...descendants(child)]);}
  function matches(node:Element,selector:string){return selector.split(',').some(part=>{const simple=part.trim();if(simple.startsWith('.'))return node.classList.contains(simple.slice(1));if(simple.startsWith('#'))return node.id===simple.slice(1);return node.localName===simple;});}
  return {win,doc,app,timers,timerDelays,rectangles,focusScroll,all:()=>descendants(app),button:(label:string)=>descendants(doc.body).find(node=>node.localName==='button'&&(node.textContent===label||node.getAttribute('aria-label')===label))!};
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
  reviewMeanings?: boolean;
  failAction?: string;
  emitOnInvoke?: number;
  onSnapshot?: (call: number, emit: () => void, current: ManagerSnapshot) => void | ManagerSnapshot | Promise<void | ManagerSnapshot>;
  onInvoke?: (action: string, payload: any, current: ManagerSnapshot) => unknown | Promise<unknown>;
  manualSearchTimers?: boolean;
  nativeSVG?: boolean;
  view?: (query:ViewQuery,model:ManagerSnapshot)=>Pick<ViewEvent,'model'|'total'|'nextCursor'>;
}
async function harness(data=snapshot(),options:HarnessOptions={}) {
  const {failAction,emitOnInvoke=0,onSnapshot,onInvoke,reviewMeanings=false,manualSearchTimers=false,nativeSVG=false,view,...uiOptions}=options;
  const dom=managerDOM(nativeSVG);const actions:{action:string;payload:any}[]=[];
  const subscribers=new Set<()=>void>();let snapshotCalls=0;
  const context=vm.createContext({Zotero:{debug(){}},console,AbortController});vm.runInContext(await bundle,context);
  let emits=0;const emit=()=>{emits++;for(const listener of subscribers)listener();};
  const legacy={snapshot:async()=>{snapshotCalls++;return await onSnapshot?.(snapshotCalls,emit,data)??structuredClone(data);},subscribe:(listener:()=>void)=>{subscribers.add(listener);return()=>subscribers.delete(listener);},invoke:async(action:string,payload:any)=>{
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
  let revision=0;
  const watches:{query:ViewQuery;signal:AbortSignal;receive:(event:ViewEvent)=>void}[]=[],commandIds:string[]=[];
  const api={
    watch(query:ViewQuery,receive:(event:ViewEvent)=>void,{signal}:{signal:AbortSignal}){
      watches.push({query:structuredClone(query),signal,receive});
      let active=true,pending=false,reading=false,again=false;
      const publish=()=>{if(!active||signal.aborted)return;if(pending){if(reading)again=true;return;}pending=true;void Promise.resolve().then(async()=>{reading=true;try{const model=await legacy.snapshot();if(active&&!signal.aborted)receive({phase:'ready',revision,...view?.(query,model)??{model}});}catch(error){if(active&&!signal.aborted)receive({phase:'error',revision,error:error instanceof Error?error.message:String(error)});}finally{reading=false;pending=false;if(again){again=false;publish();}}});};
      const stop=()=>{active=false;subscribers.delete(publish);};subscribers.add(publish);signal.addEventListener('abort',stop,{once:true});publish();return stop;
    },
    async execute(command:any,{commandId}:{commandId:string}){commandIds.push(commandId);const before=emits,result=await legacy.invoke(command.type,command.payload);revision++;if(emits===before)emit();return {commandId,revision,result};},
    async close(){subscribers.clear();},
  };
  const ui=context.ManagerUI.mountManager(dom.win,api,uiOptions);await settle();
  if(reviewMeanings){assert.ok(dom.button('Review meanings'));dom.button('Review meanings').emit('click');await settle();}
  assert.equal(dom.app.getAttribute('data-smart-tags-state'),'ready',dom.app.textContent);
  function flushSearch(){for(const [id,delay] of [...dom.timerDelays])if(delay===100){const run=dom.timers.get(id);dom.win.clearTimeout(id);run?.();}}
  function maybeFlushSearch(){if(!manualSearchTimers)flushSearch();}
  async function click(label:string){const button=dom.button(label)||dom.all().find(node=>node.localName==='button'&&node.getAttribute('aria-label')===label);assert.ok(button,`Missing button ${label}`);assert.equal(button.disabled,false,`Disabled button ${label}`);button.emit('click');maybeFlushSearch();if(button.type==='submit'){const formId=button.getAttribute('form');let form=formId?dom.doc.getElementById(formId):button.parentNode;while(form&&form.localName!=='form')form=form.parentNode;assert.ok(form,'Submit button has an associated form');form.emit('submit');}await settle();}
  function expand(label:string){const details=dom.all().find(node=>node.localName==='details'&&node.children[0]?.textContent===label);assert.ok(details,`Missing details ${label}`);details.open=true;details.emit('toggle');return details;}
  function change(id:string,value:string|boolean){const control=dom.doc.getElementById(id);assert.ok(control,`Missing control ${id}`);if(typeof value==='boolean'){control.checked=value;control.emit('change');}else{control.value=value;control.emit('input');}maybeFlushSearch();}
  function choose(id:string,index:number){const control=dom.doc.getElementById(id);assert.ok(control);control.emit('click');const option=dom.doc.getElementById(`${id}-option-${index}`);assert.ok(option);option.emit('click');maybeFlushSearch();}
  return {...dom,data,actions,ui,click,change,choose,expand,watches,commandIds,flushSearch,subscriberCount:()=>subscribers.size,emitUpdate:async()=>{maybeFlushSearch();emit();await settle();},get snapshotCalls(){return snapshotCalls;}};
}

test('Workspace queries page rows and preserves search focus while debouncing superseded work',async t=>{
  const data=snapshot();
  const h=await harness(data,{page:'library',manualSearchTimers:true,view:(_query,model)=>({model,total:4})});t.after(()=>h.ui.destroy());
  const shell=h.doc.getElementById('smart-tags-shell'),search=h.doc.getElementById('paper-search');
  search.focus();search.selectionStart=2;search.selectionEnd=2;
  const first=h.watches.at(-1)!;
  assert.equal(first.query.page,'library');assert.equal(first.query.limit,50);assert.equal(first.query.cursor,'0');
  h.change('paper-search','ca');h.change('paper-search','catalysis');
  assert.equal(h.doc.getElementById('paper-search'),search);assert.equal(search.value,'catalysis');assert.equal(h.doc.activeElement,search);
  assert.equal(h.doc.getElementById('smart-tags-shell'),shell);assert.equal(search.selectionStart,2);
  assert.equal(first.signal.aborted,true);assert.equal(h.watches.length,1);
  assert.equal([...h.timerDelays.values()].filter(delay=>delay===100).length,1);
  h.flushSearch();await settle();
  const latest=h.watches.at(-1)!;
  assert.equal(h.watches.length,2);assert.equal(latest.query.params?.paperQuery,'catalysis');
  await h.emitUpdate();assert.equal(h.doc.getElementById('paper-search'),search);assert.equal(h.doc.activeElement,search);
  const stale=structuredClone(data);stale.papers=[{id:'stale',title:'This cancelled response must never appear'}];
  first.receive({phase:'ready',revision:999,model:stale,total:1});
  assert.doesNotMatch(h.app.textContent,/cancelled response/);
});

test('Workspace result pages use server totals and cursor without filtering or slicing them again',async t=>{
  const data=snapshot();data.tags=[];data.papers=Array.from({length:123},(_,index)=>({id:`p${index}`,title:`Indexed paper ${index}`,tags:['A topic not included in this page']}));
  const h=await harness(data,{page:'library',view:(query,model)=>({model:{...model,papers:model.papers.slice(Number(query.cursor),Number(query.cursor)+query.limit!)},total:123})});t.after(()=>h.ui.destroy());
  assert.equal(h.all().filter(node=>node.classList.contains('paper-card')).length,50);assert.equal(h.doc.getElementById('find-result-count').textContent,'123 papers');
  await h.click('Next');
  assert.equal(h.watches.at(-1)!.query.cursor,'50');assert.equal(h.all().filter(node=>node.classList.contains('paper-card')).length,50);
  assert.ok(h.button('Indexed paper 50'));assert.equal(h.button('Indexed paper 0'),undefined);
  await h.click('Next');
  assert.equal(h.watches.at(-1)!.query.cursor,'100');assert.equal(h.all().filter(node=>node.classList.contains('paper-card')).length,23);assert.equal(h.button('Next').disabled,true);
});

test('Workspace pagination follows the returned cursor when the payload limit trims rows',async t=>{
  const data=snapshot();data.tags=[];data.papers=Array.from({length:8},(_,index)=>({id:`p${index}`,title:`Bounded paper ${index}`,tags:[]}));
  const h=await harness(data,{page:'library',view:(query,model)=>{const offset=Number(query.cursor);return {model:{...model,papers:model.papers.slice(offset,offset+3)},total:8,...(offset+3<8?{nextCursor:String(offset+3)}:{})};}});t.after(()=>h.ui.destroy());
  await h.click('Next');assert.equal(h.watches.at(-1)!.query.cursor,'3');assert.ok(h.button('Bounded paper 3'));
  await h.click('Next');assert.equal(h.watches.at(-1)!.query.cursor,'6');assert.ok(h.button('Bounded paper 6'));assert.equal(h.button('Next').disabled,true);
  await h.click('Previous');assert.equal(h.watches.at(-1)!.query.cursor,'3');assert.ok(h.button('Bounded paper 3'));
});

test('Find shows background paper discovery progress without blocking search or replacing it',async t=>{
  const data=snapshot();data.libraryIndexProgress={phase:'indexing',checked:25,changed:25,removed:0,total:100};const h=await harness(data,{page:'library'});t.after(()=>h.ui.destroy());
  const search=h.doc.getElementById('paper-search');search.focus();assert.match(h.doc.getElementById('library-index-progress').textContent,/25 of 100/);assert.equal(search.disabled,false);
  data.libraryIndexProgress={...data.libraryIndexProgress,phase:'completed',checked:100};await h.emitUpdate();assert.equal(h.doc.getElementById('library-index-progress'),null);assert.equal(h.doc.getElementById('paper-search'),search);assert.equal(h.doc.activeElement,search);
});

test('a failed queued Activity marker can be stopped while another paper task continues',async t=>{
  const data=snapshot();data.queue={...data.queue,status:'running',ownerPage:'assignment',total:100,completed:20};data.activityTasks=[{id:'task-failed-at-start',queuedAttempt:true,kind:'maintenance',state:'paused',label:'Work needs attention',ownerPage:'activity',message:'A selected paper was removed.'}];
  const h=await harness(data,{page:'activity',onInvoke(action,payload,state){if(action==='stop-queued-task')state.activityTasks=state.activityTasks!.map(task=>task.id===payload.id?{...task,state:'completed'}:task);}});t.after(()=>h.ui.destroy());
  await h.click('Stop this attempt');assert.deepEqual(h.actions.at(-1),{action:'stop-queued-task',payload:{id:'task-failed-at-start'}});assert.equal(h.button('Stop this attempt'),undefined);assert.equal(data.queue.status,'running');assert.equal(h.actions.some(action=>action.action==='cancel'),false);
});

test('a stopped unknown request can be explicitly retried later without another Stop action',async t=>{
  const data=snapshot();data.recoveryRequests=[{id:'stopped-scope',status:'stopped',message:'This attempt was stopped. Its original result is unknown.'}];const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/may already have charged/);assert.equal(h.button('Stop this attempt'),undefined);assert.equal(h.actions.length,0);await h.click('Retry request');assert.deepEqual(h.actions.at(-1),{action:'retry-unknown-request',payload:{id:'stopped-scope'}});
});

test('Workspace subscriptions follow navigation and are cancelled when the manager closes',async()=>{
  const h=await harness(snapshot(),{page:'library'});
  const previous=h.watches.at(-1)!;
  h.ui.navigate({page:'settings'});await settle();
  assert.equal(previous.signal.aborted,true);assert.equal(h.watches.at(-1)!.query.page,'settings');assert.equal(h.subscriberCount(),1);
  const before=h.app.textContent,stale=structuredClone(h.data);stale.settings.model='stale-response';
  previous.receive({phase:'ready',revision:100,model:stale});assert.equal(h.app.textContent,before);
  const active=h.watches.at(-1)!;h.ui.destroy();assert.equal(active.signal.aborted,true);assert.equal(h.subscriberCount(),0);
  active.receive({phase:'ready',revision:101,model:stale});assert.equal(h.app.textContent,before);
});

test('Workspace updates retain editor controls, row identity and live corrected handlers',async t=>{
  const data=snapshot();const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  await h.click('Edit tag FC');
  const description=h.doc.getElementById('tag-description'),form=h.doc.getElementById('tag-editor-form'),shell=h.doc.getElementById('smart-tags-shell');
  description.focus();description.scrollTop=44;h.change('tag-description','My corrected scientific meaning.');
  data.tags.reverse();await h.emitUpdate();
  assert.equal(h.doc.getElementById('tag-description'),description);assert.equal(h.doc.getElementById('tag-editor-form'),form);assert.equal(h.doc.getElementById('smart-tags-shell'),shell);
  assert.equal(h.doc.activeElement,description);assert.equal(description.value,'My corrected scientific meaning.');assert.equal(description.scrollTop,44);
  await h.click('Save');assert.equal(h.actions.at(-1)!.action,'save-tag');assert.equal(h.actions.at(-1)!.payload.tag.description,'My corrected scientific meaning.');
  await h.click('Edit tag EIS');h.change('tag-description','A different corrected meaning.');await h.click('Save');
  assert.equal(h.actions.at(-1)!.payload.tag.id,'eis');assert.equal(h.actions.at(-1)!.payload.tag.description,'A different corrected meaning.');
  assert.equal(new Set(h.commandIds).size,h.commandIds.length);assert.equal(h.commandIds.length,2);
});

test('Workspace header counts and assignment defaults do not depend on loaded definition rows',async t=>{
  const data=snapshot();data.tags=[];data.tagLibraryEntries=[];data.totals={papers:10000,tags:2000,definedTags:1900,assignableTags:1700,openChoices:9,history:40};
  const h=await harness(data,{page:'assignment',view:(_query,model)=>({model,total:0})});t.after(()=>h.ui.destroy());
  assert.equal(h.doc.getElementById('start-assignment').disabled,false);assert.match(h.doc.getElementById('assignment-tag-shelf').textContent,/All tags · 2000 total · 1700 ready/);
  assert.equal(h.doc.getElementById('assignment-auto-assign').disabled,false);
});

test('Workspace patching supports Zotero SVG elements with getter-only animated class names',async t=>{
  const h=await harness(snapshot(),{page:'vocabulary',nativeSVG:true});t.after(()=>h.ui.destroy());const svg=h.doc.querySelector('svg'),shell=h.doc.getElementById('smart-tags-shell');
  assert.equal(typeof svg.className,'object');await h.emitUpdate();assert.equal(h.app.getAttribute('data-smart-tags-state'),'ready');assert.equal(h.doc.getElementById('smart-tags-shell'),shell);assert.equal(h.doc.querySelector('svg'),svg);assert.ok(h.button('Edit tag FC'));
});

test('interrupted AI requests have explicit retry and stop actions without paper review',async t=>{
  const data=snapshot();data.recoveryRequests=[{id:'paid-unknown',provider:'api',model:'test-model',status:'unknown',message:'The request may have reached the provider.'}];
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/may already have charged/);assert.equal(h.button('Resume'),undefined);
  await h.click('Retry request');await h.click('Stop this attempt');assert.deepEqual(h.actions,[{action:'retry-unknown-request',payload:{id:'paid-unknown'}},{action:'stop-unknown-request',payload:{id:'paid-unknown'}}]);
});

test('loading heartbeats keep long migrations alive and display bounded progress',async t=>{
  const dom=managerDOM(),context=vm.createContext({Zotero:{debug(){}},console,AbortController});vm.runInContext(await bundle,context);let receive!:(event:ViewEvent)=>void;
  const api={watch(_query:ViewQuery,next:(event:ViewEvent)=>void){receive=next;return()=>{};},async execute(){return {commandId:'unused',revision:0};},async close(){}};
  const ui=context.ManagerUI.mountManager(dom.win,api,{page:'settings'});t.after(()=>ui.destroy());
  let previous=[...dom.timerDelays].find(([,delay])=>delay===15000)![0];
  for(let index=0;index<40;index++){
    receive({phase:'loading',revision:0,message:'Checking saved data…',progress:{label:'Source checks',completed:index,total:40}});
    const next=[...dom.timerDelays].find(([,delay])=>delay===15000)![0];assert.notEqual(next,previous);assert.equal(dom.timers.has(previous),false);previous=next;
    assert.equal(dom.app.getAttribute('data-smart-tags-state'),'loading');assert.match(dom.app.textContent,/Checking saved data/);assert.equal(dom.all().find(node=>node.localName==='progress')!.value,index);
  }
  receive({phase:'ready',revision:1,model:snapshot()});await settle();assert.equal(dom.app.getAttribute('data-smart-tags-state'),'ready');assert.equal([...dom.timerDelays.values()].includes(15000),false);
});

test('Settings uses stored Data counters and queues bounded expired-data cleanup',async t=>{
  const data=snapshot();data.storage={activeBytes:1024*1024,historyBytes:2048,cacheBytes:0,backupBytes:4096,physicalBytes:200000,retentionDays:7};
  const h=await harness(data,{page:'settings'});t.after(()=>h.ui.destroy());h.expand('Data');assert.match(h.app.textContent,/Active data1\.0 MiB/);assert.match(h.app.textContent,/expire after 7 days/);
  await h.click('Clean up expired data');assert.deepEqual(h.actions,[{action:'clean-expired-data',payload:undefined}]);
});

test('Tags shows one prepared list instead of the 107 previous definitions, without technical review controls',async t=>{
  const data=snapshot();data.tags=Array.from({length:107},(_,i)=>tag(`old-${i}`,`Old draft ${i}`,{status:'draft'}));data.tagPreparation=preparation([tag('fc','FC',{fullName:'fuel cell',aliases:['fuel cells']})]);
  const nativeChoices=structuredClone(data.papers);const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());
  assert.equal(h.all().filter(node=>node.localName==='article'&&node.classList.contains('tag-row')).length,1);
  assert.match(h.app.textContent,/Your tag list is ready/);assert.equal(h.app.textContent.includes('Old draft'),false);
  assert.doesNotMatch(h.app.textContent,/\b(?:registry|snapshot|fingerprint|staged|core|taxonomy)\b/i);
  assert.equal(h.button('Confirm scientific mapping'),undefined);assert.equal(h.button('Apply tag list').disabled,false);
  assert.deepEqual(data.papers,nativeChoices);assert.equal(h.actions.length,0);
});

test('Build tags uses its own selected group and opens the list for review',async t=>{
  const h=await harness(snapshot(),{page:'build'});t.after(()=>h.ui.destroy());h.choose('build-scope',1);await h.click('Build tags from these papers');
  assert.deepEqual(h.actions,[{action:'prepare-tags',payload:{scope:'selected',mode:'extend',processingPolicy:'auto-clear'}}]);assert.match(h.app.textContent,/Checking your tags/);assert.ok(h.button('Resume checks'));assert.equal(h.doc.getElementById('nav-cleanup').getAttribute('aria-current'),'page');
});

test('changing a pending build group keeps its list and editor until a new preparation is requested',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const original=structuredClone(data.tagPreparation),native=structuredClone(data.papers);const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('build-scope'),null);await h.click('Edit tag FC');h.change('tag-description','An unfinished fuel cell meaning.');await h.click('Change build group');h.choose('build-scope',2);assert.equal(h.doc.getElementById('tag-description').value,'An unfinished fuel cell meaning.');assert.ok(h.button('Apply tag list'));assert.match(h.app.textContent,/Starting another build replaces the unsaved list/);assert.deepEqual(data.tagPreparation,original);assert.equal(h.actions.length,0);await h.click('Hide build setup');await h.click('Change build group');assert.equal(h.doc.getElementById('build-scope').textContent,'Selected collections');await h.click('Build tags from these papers');assert.deepEqual(h.actions,[{action:'prepare-tags',payload:{scope:'collections',mode:'extend',processingPolicy:'auto-clear'}}]);assert.equal(h.doc.getElementById('build-scope'),null);assert.match(h.app.textContent,/Checking your tags/);assert.deepEqual(data.papers,native);
});

test('the sidebar combines building and review in three open workflow steps and keeps library tools separate',async t=>{
  const data=snapshot();data.connection.apiKeyStored=false;const h=await harness(data);t.after(()=>h.ui.destroy());
  const sidebar=h.all().find(node=>node.localName==='aside')!;const workflow=sidebar.children.find(node=>node.textContent.startsWith('Workflow'))!;
  assert.deepEqual(workflow.querySelectorAll('button').map(node=>node.getAttribute('aria-label')),['Build tags','Tag library','Assign tags']);assert.equal(sidebar.querySelectorAll('button').length,6);
  for(const page of ['connection','build','cleanup','assignment','vocabulary','library','activity','settings'] as const){h.ui.navigate({page});assert.equal(h.app.getAttribute('data-smart-tags-state'),'ready');assert.ok(h.doc.getElementById(`nav-${page==='build'?'cleanup':page==='connection'?'settings':page}`).getAttribute('aria-current'));}
  h.ui.navigate({page:'cleanup'});assert.equal(h.button('Clean up existing tags'),undefined);assert.equal(h.button('Existing tags'),undefined);assert.ok(h.doc.getElementById('build-scope'));
});

test('the first build defaults to a pilot while assignment independently defaults to the library',async t=>{
  const data=snapshot();data.taxonomyReady=false;data.workflow={buildMode:'extend',buildScope:'pilot',buildPaperCount:0,assignmentScope:'library',assignmentPaperCount:0,assignedPaperCount:0};const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('build-scope').textContent,'Pilot · 50 papers');assert.equal(h.doc.getElementById('build-mode'),null);assert.match(h.app.textContent,/Create your first tag list/);assert.doesNotMatch(h.app.textContent,/Extend my saved tag list|Replace the full tag list/);
  h.choose('build-scope',2);h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-scope').textContent,'Whole personal library');h.choose('assignment-scope',1);await h.emitUpdate();h.ui.navigate({page:'build'});assert.equal(h.doc.getElementById('build-scope').textContent,'Selected collections');await h.click('Build tags from these papers');assert.deepEqual(h.actions[0],{action:'prepare-tags',payload:{scope:'collections',mode:'replace',processingPolicy:'auto-clear'}});
  h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-scope').textContent,'Selected papers in Zotero');await h.click('Assign tags to these papers');assert.deepEqual(h.actions[1],{action:'tag',payload:{scope:'selected',tagShelfId:'all',processingPolicy:'auto-clear'}});assert.match(h.app.textContent,/Preparing paper suggestions/);
});

test('saved workflow groups restore independently while Extend is the next build default',async t=>{
  const data=snapshot();data.workflow={buildMode:'replace',buildScope:'collections',buildPaperCount:51,assignmentScope:'selected',assignmentPaperCount:12,assignedPaperCount:4};const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('build-mode'),null);h.expand('More options');assert.equal(h.doc.getElementById('build-mode').textContent,'Extend my saved tag list');assert.equal(h.doc.getElementById('build-scope').textContent,'Selected collections');
  h.choose('build-scope',1);data.workflow.buildScope='library';await h.emitUpdate();assert.equal(h.doc.getElementById('build-scope').textContent,'Selected papers in Zotero');h.choose('build-mode',1);assert.match(h.app.textContent,/Build a replacement for the full saved tag list/);assert.equal(h.actions.length,0);
  h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-scope').textContent,'Selected papers in Zotero');assert.match(h.app.textContent,/12 papers in the last chosen group · 4 with Smart Tags assignments/);assert.doesNotMatch(h.app.textContent,/library tagged|library complete/);
});

test('assignment runs only on request and a pilot remains an optional paper group',async t=>{
  const h=await harness(snapshot(),{page:'assignment'});t.after(()=>h.ui.destroy());assert.equal(h.actions.length,0);await h.click('Assign tags to these papers');assert.deepEqual(h.actions,[{action:'tag',payload:{scope:'library',tagShelfId:'all',processingPolicy:'auto-clear'}}]);h.data.queue.status='idle';await h.emitUpdate();await h.click('Assignment setup');h.choose('assignment-scope',0);await h.click('Assign tags to these papers');assert.deepEqual(h.actions.at(-1),{action:'tag',payload:{scope:'pilot',tagShelfId:'all',processingPolicy:'auto-clear'}});h.data.queue.status='idle';await h.emitUpdate();await h.click('Assignment setup');assert.equal(h.doc.getElementById('assignment-scope').textContent,'Pilot · 50 papers');
});

test('incoming assignment is an explicit immediate switch without a mandatory pilot',async t=>{
  const data=snapshot();data.pilotReviewed=false;data.workflow={buildMode:'extend',buildScope:'selected',buildPaperCount:51,assignmentScope:'library',assignmentPaperCount:0,assignedPaperCount:0,assignmentPilotReady:false};const h=await harness(data,{page:'assignment'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('assignment-auto-assign').disabled,false);assert.equal(h.button('Mark pilot reviewed'),undefined);assert.equal(h.actions.length,0);
  h.change('assignment-auto-assign',true);await settle();assert.equal(data.settings.autoAssign,true);assert.deepEqual(h.actions,[{action:'save-settings',payload:{settings:{...data.settings,autoAssign:true}}}]);h.ui.navigate({page:'library'});h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-auto-assign').checked,true);assert.equal(h.button('Save routine assignment'),undefined);
});

test('routine saves and unfinished connection edits cannot silently overwrite each other',async t=>{
  const data=snapshot();const h=await harness(data,{page:'connection'});t.after(()=>h.ui.destroy());h.choose('settings-provider',2);h.change('settings-model','deepseek-test-model');h.ui.navigate({page:'assignment'});h.change('assignment-auto-assign',true);await settle();assert.equal(h.actions[0].payload.settings.provider,'api');assert.equal(h.actions[0].payload.settings.model,'openai-model');assert.equal(data.settings.autoAssign,true);
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
  assert.deepEqual(h.actions,[{action:'apply-tag-list',payload:{id:'prepared'}}]);assert.match(h.app.textContent,/High-confidence additions apply automatically/);assert.ok(h.doc.getElementById('assignment-scope'));assert.equal(h.doc.getElementById('assignment-scope').textContent,'Whole personal library');assert.equal(data.queue.status,'idle');assert.equal(data.suggestions.length,0);
  assert.deepEqual(data.papers,original);assert.equal(data.settings.autoAssign,false);assert.equal(h.actions.some(entry=>entry.action==='apply-suggestions'),false);
  h.ui.navigate({page:'build'});h.expand('More options');assert.equal(h.doc.getElementById('build-scope').textContent,'Selected papers in Zotero');assert.equal(h.doc.getElementById('build-mode').textContent,'Extend my saved tag list');h.ui.navigate({page:'vocabulary'});assert.equal(h.button('Questions (0)'),undefined);assert.equal(h.button('Apply tag list'),undefined);assert.ok(h.button('Edit tag FC'));
});

test('Update and apply refreshes a stale extension in Build and opens assignment only after its checks finish',async t=>{
  const data=snapshot(),native=structuredClone(data.papers),saved=structuredClone(data.tags);data.tagPreparation={...preparation(),needsRefresh:true};data.workflow={buildMode:'extend',buildScope:'selected',buildPaperCount:51,assignmentScope:'library',assignmentPaperCount:4,assignedPaperCount:0};let applies=0;
  const h=await harness(data,{page:'cleanup',onInvoke(action,_payload,current){if(action!=='apply-tag-list')return;applies++;if(applies===1){current.tagPreparation={...current.tagPreparation!,needsRefresh:false,status:'checking',canApply:false};current.queue={status:'running',total:51,completed:51,failed:0,phase:'checking'};return {page:'cleanup'};}return {page:'assignment'};}});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/Your saved tags changed/);assert.equal(h.button('Update and apply').disabled,false);assert.equal(h.button('Resume'),undefined);await h.click('Update and apply');assert.deepEqual(h.actions,[{action:'apply-tag-list',payload:{id:'prepared'}}]);assert.ok(h.button('Apply tag list'));assert.equal(h.button('Apply tag list').disabled,true);assert.equal(h.doc.getElementById('assignment-scope'),null);assert.match(h.app.textContent,/Checking your tags/);assert.doesNotMatch(h.app.textContent,/Tag list saved\. Choose which papers/);assert.deepEqual(data.tags,saved);assert.deepEqual(data.papers,native);
  data.tagPreparation={...data.tagPreparation!,status:'ready',canApply:true};data.queue={status:'idle',total:0,completed:0,failed:0};await h.emitUpdate();await h.click('Apply tag list');assert.equal(applies,2);assert.ok(h.doc.getElementById('assignment-scope'));assert.match(h.app.textContent,/High-confidence additions apply automatically/);assert.deepEqual(h.actions.map(entry=>entry.action),['apply-tag-list','apply-tag-list']);assert.deepEqual(data.papers,native);assert.equal(data.settings.autoAssign,false);
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
  await h.click('Discard changes');await h.click('Edit tag FC');assert.equal(h.doc.getElementById('tag-description').value,'Definition of FC');await h.click('Edit tag PEMFC');assert.equal(h.doc.getElementById('tag-name').value,'My PEMFC');
});

test('Apply waits for every unsaved edit, including drafts for another prepared tag',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());
  await h.click('Edit tag FC');assert.equal(h.button('Apply tag list').disabled,false);
  h.change('tag-description','Changed FC meaning.');assert.equal(h.button('Apply tag list').disabled,true);assert.match(h.app.textContent,/Save or cancel your edits/);
  await h.click('Edit tag PEMFC');assert.equal(h.button('Apply tag list').disabled,true,'The FC draft is still waiting');await h.click('Discard changes');assert.equal(h.button('Apply tag list').disabled,true);
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
  await h.click('Discard changes');assert.ok(h.button('Review unsaved draft Topic B'));await h.click('Discard unsaved draft Topic B');assert.equal(h.button('Apply tag list').disabled,true,'The unrelated C draft still needs a decision');
  h.change('vocabulary-search','');await h.click('Edit tag Topic C');assert.equal(h.doc.getElementById('tag-description').value,'My unfinished C wording.');await h.click('Discard changes');assert.equal(h.button('Apply tag list').disabled,false);
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
  h.ui.navigate({page:'settings'});h.expand('Import, export, and previous tag lists');await h.click('Export analysis with paper text…');assert.deepEqual(h.actions,[{action:'export-tag-analysis',payload:{id:'prepared'}}]);assert.equal(h.button('Manage existing tags'),undefined);assert.equal(h.doc.getElementById('nav-existing-tags'),null);
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

test('editor CSS keeps a scroll body and visible footer, with a viewport drawer',async()=>{
  const css=await readFile('addon/content/manager.css','utf8');assert.match(css,/\.tag-editor\s*\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);assert.match(css,/\.editor-scroll\s*\{[^}]*overflow:auto/);assert.match(css,/@media \(max-width:900px\), \(max-height:600px\)/);assert.match(css,/\.tag-editor\.editor-drawer\s*\{[^}]*position:fixed/);
});

test('Explore Any keeps detail contexts together in a saved search',async t=>{
  const h=await harness(snapshot(),{page:'library'});t.after(()=>h.ui.destroy());h.expand('Filter by tags');h.change('explore-detail-rcl-fc-fc',true);h.change('explore-core-eis',true);h.choose('concept-filter-mode',1);
  assert.deepEqual(h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent),['Context match','Method only']);await h.click('Save tag search…');await h.click('Create saved search');assert.deepEqual(h.actions[0].payload.filter,{mode:'any',selections:[{conceptId:'rcl',contextId:'fc'},{conceptId:'eis'}]});
});

test('Explore search respects full names and Co/CO distinctions',async t=>{
  const data=snapshot();data.tags.push(tag('co','Co',{facet:'component'}),tag('CO','CO',{facet:'component'}));data.papers.push({id:'cobalt',title:'Cobalt paper',tags:['Co']},{id:'monoxide',title:'Carbon monoxide paper',tags:['CO']});const h=await harness(data,{page:'library'});t.after(()=>h.ui.destroy());h.expand('Filter by tags');h.change('concept-search','catalyst-layer resistance');assert.ok(h.doc.getElementById('explore-detail-rcl-fc-fc'));h.change('concept-search','');h.change('explore-core-co',true);assert.deepEqual(h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent),['Cobalt paper']);
});

test('Find papers retains collapsed tag selections and search drafts, and Clear search resets both queries',async t=>{
  const h=await harness(snapshot(),{page:'library'});t.after(()=>h.ui.destroy());
  const titles=()=>h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent);
  assert.equal(h.doc.getElementById('details-filter-by-tags').parentNode.open,false);
  assert.equal(h.doc.getElementById('concept-search'),null);
  assert.equal(titles().length,4);
  h.expand('Filter by tags');h.change('explore-detail-rcl-fc-fc',true);h.change('explore-core-eis',true);
  const mode=h.doc.getElementById('concept-filter-mode');mode.focus();mode.emit('keydown',{key:'End'});mode.emit('keydown',{key:'Enter'});await settle();
  assert.equal(h.doc.activeElement.id,'concept-filter-mode');
  const selectedMode=h.doc.getElementById('concept-filter-mode');selectedMode.emit('keydown',{key:'Home'});selectedMode.emit('keydown',{key:'Escape'});
  assert.match(selectedMode.textContent,/Any/);assert.equal(selectedMode.getAttribute('aria-expanded'),'false');
  h.change('paper-search','Context');h.change('concept-search','impedance');
  assert.deepEqual(titles(),['Context match']);assert.equal(h.doc.getElementById('find-result-count').getAttribute('aria-live'),'polite');
  h.doc.getElementById('details-filter-by-tags').emit('click');
  const filter=h.doc.getElementById('details-filter-by-tags').parentNode;
  const selections=h.all().filter(node=>node.className==='selected-concept');
  assert.equal(filter.open,false);assert.equal(selections.length,2);
  assert.equal(selections.every(node=>!filter.contains(node)),true);
  assert.match(selections.map(node=>node.textContent).join(' '),/RCL in FC/);
  await h.emitUpdate();h.ui.navigate({page:'settings'});h.ui.navigate({page:'library'});
  assert.equal(h.doc.getElementById('paper-search').value,'Context');
  assert.equal(h.doc.getElementById('details-filter-by-tags').parentNode.open,false);
  assert.deepEqual(titles(),['Context match']);
  h.expand('Filter by tags');assert.equal(h.doc.getElementById('concept-search').value,'impedance');
  assert.match(h.doc.getElementById('concept-filter-mode').textContent,/Any/);
  await h.click('Clear search');
  assert.equal(h.doc.getElementById('paper-search').value,'');assert.equal(h.doc.getElementById('concept-search').value,'');
  assert.match(h.doc.getElementById('concept-filter-mode').textContent,/Any/);
  assert.equal(h.all().filter(node=>node.className==='selected-concept').length,0);
  assert.deepEqual(titles(),['Context match','Detail elsewhere','Method only','Fuel cell only']);
  assert.equal(h.button('Save tag search…'),undefined);assert.equal(h.actions.length,0);
});

test('related papers opens only for the selected paper and Escape restores its exact trigger',async t=>{
  const data=snapshot(),paperId='paper / 1';data.papers[0].id=paperId;data.neighbors[paperId]=[{paperId:'c',score:0.91}];
  const h=await harness(data,{page:'library'});t.after(()=>h.ui.destroy());
  const triggerId=`related-papers-${encodeURIComponent(paperId)}`,panelId=`related-paper-results-${encodeURIComponent(paperId)}`;
  assert.equal(h.button('Close related papers'),undefined);assert.equal(!!h.doc.getElementById(panelId),false);
  h.doc.getElementById(triggerId).focus();h.doc.getElementById(triggerId).emit('click');await settle();
  assert.equal(h.doc.getElementById(triggerId).getAttribute('aria-expanded'),'true');
  assert.equal(h.doc.getElementById(triggerId).getAttribute('aria-controls'),panelId);
  const related=h.doc.getElementById(panelId);assert.ok(related);assert.match(related.textContent,/Method only/);
  related.parentNode.emit('keydown',{key:'Escape',target:h.button('Close related papers')});await settle();
  assert.equal(!!h.doc.getElementById(panelId),false);assert.equal(h.doc.activeElement.id,triggerId);
  assert.equal(h.doc.getElementById(triggerId).getAttribute('aria-expanded'),'false');
  await h.click('Related papers for Context match');h.doc.getElementById(panelId).parentNode.emit('keydown',{key:'Escape',target:h.doc.getElementById(triggerId)});await settle();
  assert.equal(!!h.doc.getElementById(panelId),false);assert.equal(h.doc.activeElement.id,triggerId);
  await h.click('Related papers for Context match');await h.click('Close related papers');
  assert.equal(!!h.doc.getElementById(panelId),false);assert.equal(h.doc.activeElement.id,triggerId);assert.equal(h.actions.length,0);
});

test('settings accepts a preferred count without a size blocker and protects provider keys',async t=>{
  const h=await harness(snapshot(),{page:'settings'});t.after(()=>h.ui.destroy());h.expand('Tag limits');h.change('settings-coreConceptLimit','501');await h.click('Save settings');assert.equal(h.actions.length,0);h.change('settings-coreConceptLimit','500');await h.click('Save settings');assert.equal(h.actions[0].payload.settings.coreConceptLimit,500);
  await h.click('AI connection and budget');h.choose('settings-provider',2);assert.equal(h.doc.getElementById('settings-model').value,'');assert.equal(h.doc.getElementById('settings-inputPricePerMillion').value,'0');assert.equal(h.doc.getElementById('settings-deepseek-key').type,'password');h.change('settings-deepseek-key','test-private-key');await h.click('Save DeepSeek key');assert.deepEqual(h.actions[1],{action:'save-api-key',payload:{key:'test-private-key',provider:'deepseek'}});assert.equal(h.doc.getElementById('settings-deepseek-key').value,'');assert.equal(JSON.stringify(h.data).includes('test-private-key'),false);
});

test('Settings keyboard save preserves both limits and the latest incoming choice without testing AI',async t=>{
  for(const modifier of ['ctrlKey','metaKey']){
    const data=snapshot(),expected={...data.settings,coreConceptLimit:75,extensionTagTarget:17,autoAssign:true};
    const h=await harness(data,{page:'settings'});t.after(()=>h.ui.destroy());
    assert.equal(h.button('Save settings'),undefined);assert.equal(h.doc.getElementById('discard-settings-changes'),null);
    assert.equal(h.doc.getElementById('settings-coreConceptLimit'),null);assert.ok(h.button('AI connection and budget'));assert.ok(h.button('Routine assignment'));
    h.expand('Tag limits');h.change('settings-coreConceptLimit','75');h.change('settings-extensionTagTarget','17');
    data.settings.autoAssign=true;await h.emitUpdate();assert.equal(h.doc.getElementById('settings-coreConceptLimit').value,'75');
    let prevented=false;
    h.doc.getElementById('settings-form').emit('keydown',{key:'s',[modifier]:true,target:h.doc.getElementById('settings-extensionTagTarget'),preventDefault(){prevented=true;}});await settle();
    assert.equal(prevented,true);assert.deepEqual(h.actions,[{action:'save-settings',payload:{settings:expected}}]);
    assert.equal(h.button('Save settings'),undefined);assert.equal(h.doc.getElementById('discard-settings-changes'),null);
    h.doc.getElementById('settings-form').emit('keydown',{key:'S',[modifier]:true});await settle();assert.equal(h.actions.length,1);
  }
});

test('discarding Settings drafts restores the latest persisted values and incoming preference',async t=>{
  const data=snapshot();const h=await harness(data,{page:'settings'});t.after(()=>h.ui.destroy());
  h.expand('Tag limits');h.change('settings-coreConceptLimit','75');h.change('settings-extensionTagTarget','17');
  data.settings={...data.settings,provider:'deepseek',model:'latest-model',coreConceptLimit:88,extensionTagTarget:21,autoAssign:true};await h.emitUpdate();
  assert.equal(h.doc.getElementById('settings-coreConceptLimit').value,'75');
  await h.click('Discard changes');
  assert.equal(h.doc.getElementById('settings-coreConceptLimit').value,'88');assert.equal(h.doc.getElementById('settings-extensionTagTarget').value,'21');
  assert.equal(h.doc.activeElement.id,'details-tag-limits');assert.equal(h.button('Save settings'),undefined);
  assert.match(h.app.textContent,/Automatic tagging is on/);await h.click('AI connection and budget');
  assert.match(h.doc.getElementById('settings-provider').textContent,/DeepSeek/);assert.equal(h.doc.getElementById('settings-model').value,'latest-model');
  assert.equal(h.actions.length,0);assert.equal(data.settings.autoAssign,true);
});

test('invalid Settings limits identify and focus the field while retaining the other draft',async t=>{
  const h=await harness(snapshot(),{page:'settings'});t.after(()=>h.ui.destroy());h.expand('Tag limits');
  h.change('settings-coreConceptLimit','501');h.change('settings-extensionTagTarget','17');await h.click('Save settings');
  const initial=h.doc.getElementById('settings-coreConceptLimit');assert.equal(initial.getAttribute('aria-invalid'),'true');assert.equal(h.doc.activeElement,initial);
  assert.ok(h.doc.getElementById(initial.getAttribute('aria-describedby')));assert.equal(h.actions.length,0);
  const form=h.doc.getElementById('settings-form'),feedback=h.doc.getElementById('settings-feedback');
  assert.ok(form.contains(feedback)&&feedback.children.some((node:any)=>node.getAttribute('role')==='alert'),'Validation feedback stays inside the settings form');
  for(const id of ['save-settings','discard-settings-changes']){const control=h.doc.getElementById(id);assert.ok(control&&form.contains(control)&&!control.disabled,`${id} remains available with validation feedback`);}
  h.change('settings-coreConceptLimit','75');assert.equal(h.doc.getElementById('settings-coreConceptLimit').getAttribute('aria-invalid'),null);
  h.change('settings-extensionTagTarget','0');await h.click('Save settings');
  assert.equal(h.doc.getElementById('settings-extensionTagTarget').getAttribute('aria-invalid'),'true');assert.equal(h.doc.activeElement.id,'settings-extensionTagTarget');
  assert.equal(h.doc.getElementById('settings-coreConceptLimit').value,'75');assert.equal(h.actions.length,0);
  h.change('settings-extensionTagTarget','17');await h.click('Save settings');
  assert.equal(h.actions.length,1);assert.equal(h.actions[0].payload.settings.coreConceptLimit,75);assert.equal(h.actions[0].payload.settings.extensionTagTarget,17);
});

test('failed settings saves retain the draft and prevent the paid connection test',async t=>{
  const data=snapshot();const h=await harness(data,{page:'connection',failAction:'save-settings'});t.after(()=>h.ui.destroy());
  h.choose('settings-discovered-model',1);h.change('settings-model','my-draft-model');await h.click('Save and test');
  assert.deepEqual(h.actions.map(item=>item.action),['save-settings']);assert.equal(data.settings.model,'openai-model');
  assert.equal(h.doc.getElementById('settings-model').value,'my-draft-model');assert.ok(h.button('Save and test'));assert.ok(h.doc.getElementById('discard-settings-changes'));
  await h.click('Discard changes');assert.equal(h.button('Save and test'),undefined);assert.ok(h.button('Test connection'));assert.equal(h.actions.length,1);
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
  const data=snapshot();data.settings.provider='chatgpt';let finishSignIn:()=>void=()=>{};
  const h=await harness(data,{page:'connection',onInvoke(action){if(action==='sign-in')return new Promise<void>(resolve=>{finishSignIn=resolve;});if(action==='cancel-sign-in')finishSignIn();}});t.after(()=>{finishSignIn();h.ui.destroy();});
  await h.click('Use another account or workspace');assert.equal(h.button('Continue with ChatGPT').disabled,true);assert.equal(h.button('Cancel sign-in').disabled,false);
  await h.click('Cancel sign-in');assert.deepEqual(h.actions,[{action:'save-settings',payload:{settings:structuredClone(data.settings)}},{action:'sign-in',payload:{newAccount:true}},{action:'cancel-sign-in',payload:undefined}]);
  finishSignIn();await settle();assert.equal(h.button('Cancel sign-in'),undefined);
});

test('action notifications coalesce into one view update and later external changes remain visible',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'cleanup',emitOnInvoke:5});t.after(()=>h.ui.destroy());const reads=h.snapshotCalls;await h.click('Remove tag FC');assert.equal(h.snapshotCalls,reads+1);data.warnings=[warning('external')];await h.emitUpdate();assert.equal(h.snapshotCalls,reads+2);assert.match(h.app.textContent,/Evidence gap external/);
});

test('Settings keeps plugin updates without native navigation controls or hiding Find papers',async t=>{
  const data=snapshot();data.pluginVersion='1.0.6';
  const h=await harness(data,{page:'settings'});t.after(()=>h.ui.destroy());h.expand('Zotero integration');assert.match(h.app.textContent,/Installed version 1\.0\.6/);assert.doesNotMatch(h.app.textContent,/Library navigation:/);
  assert.equal(h.button('Show tag navigation'),undefined);assert.equal(h.button('Restore navigation'),undefined);assert.ok(h.button('Find papers'));
  await h.click('Check for updates');
  assert.deepEqual(h.actions,[{action:'check-plugin-updates',payload:undefined}]);
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
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Repairing part 2 of 29/);assert.match(h.app.textContent,/Estimated cost so far: \$0\.6280\. Remaining work is still being estimated\./);assert.doesNotMatch(h.app.textContent,/estimated total|estimated remaining: \$0\.0000|Resume to request/);assert.equal(h.button('Resume'),undefined);assert.equal(h.button('Retry'),undefined);
  data.queue.message='Reducing batch size and continuing automatically…';data.queue.estimatePending=false;data.queue.estimatedUSD=1.128;await h.emitUpdate();assert.match(h.app.textContent,/Reducing batch size and continuing automatically/);assert.match(h.app.textContent,/estimated remaining: \$0\.5000/);assert.equal(h.button('Resume'),undefined);
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
  data.paperAttention.papers=[{...entry,status:'excluded',canDismiss:false,canLookupMetadata:false,canRecheck:false,canRetry:false}];delete data.paperExclusionPreview;await h.emitUpdate();assert.equal(h.doc.getElementById('attention-a'),null);h.expand('Paper information');h.choose('attention-status',6);assert.ok(h.doc.getElementById('attention-a'));assert.equal(h.button('Retry analysis'),undefined);await h.click('Include again');assert.deepEqual(h.actions.at(-1),{action:'preview-paper-exclusion',payload:{ids:['a'],exclude:false}});
  data.paperExclusionPreview={id:'include-review',exclude:false,changes:[{paperId:'a',title:entry.title,before:['Manual project','FC','no_tag'],after:['Manual project','FC']}]};await h.emitUpdate();await h.click('Apply inclusion');assert.deepEqual(h.actions.at(-1),{action:'apply-paper-exclusion',payload:{previewId:'include-review'}});assert.deepEqual(data.papers,before);
});

test('batch exclusion and manually selected Zotero papers work without an AI connection',async t=>{
  const data=snapshot();data.settings.model='';data.connection.apiKeyStored=false;const entry={id:'a',title:'Unneeded paper',status:'failed' as const,message:'Could not analyze.',phase:'facts',canDismiss:true,canLookupMetadata:false,canRecheck:false,canRetry:false,canSkip:false};data.paperAttention={queued:0,papers:[entry,{...entry,id:'b'}]};const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());h.change('attention-select-page',true);await h.click('Actions for selected papers');await h.click('Exclude selected from tagging');assert.deepEqual(h.actions[0],{action:'preview-paper-exclusion',payload:{ids:['a','b'],exclude:true}});await h.click('More paper actions');await h.click('Exclude selected Zotero items…');assert.deepEqual(h.actions[1],{action:'preview-paper-exclusion',payload:{exclude:true}});assert.equal(data.settings.autoAssign,false);
});

test('an empty attention panel keeps only its search and header menu without selection controls or pagination',async t=>{
  const data=snapshot();data.paperAttention={queued:0,papers:[]};const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  assert.equal(h.doc.getElementById('details-paper-information').parentNode.open,false);assert.equal(h.doc.getElementById('attention-search'),null);h.expand('Paper information');
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
  const refreshed=open('ArrowDown');await h.emitUpdate();assert.equal(refreshed.trigger.isConnected,true);assert.ok(h.doc.getElementById('attention-more-a-menu'));refreshed.items[0].emit('keydown',{key:'Escape'});assert.equal(h.doc.getElementById('attention-more-a-menu'),null);assertMenuListenersRemoved();
  open('ArrowDown');h.ui.destroy();assert.equal(h.doc.getElementById('attention-more-a-menu'),null);assertMenuListenersRemoved();
});

test('the builtin no_tag stays outside editable tags and DIY counts while Find papers can filter it',async t=>{
  const data=snapshot();data.tags.push(tag('smart-tags:no-tag','no_tag',{builtin:'no_tag',custom:true,matchingMode:'manual'}));data.papers[0].tags!.push('no_tag');const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());assert.equal(h.button('Edit tag no_tag'),undefined);assert.equal(h.button('Remove tag no_tag'),undefined);assert.equal(h.all().filter(node=>node.localName==='article'&&node.classList.contains('tag-row')).length,4);
  h.ui.navigate({page:'overview'});assert.doesNotMatch(h.app.textContent,/your topics|DIY|core vocabulary/);h.ui.navigate({page:'library'});h.expand('Filter by tags');assert.ok(h.doc.getElementById('explore-builtin-no-tag'));h.change('explore-builtin-no-tag',true);assert.deepEqual(h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent),['Context match']);
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
  h.change('assignment-topic-t1',true);h.change('assignment-topic-t2',true);h.change('topic-additional-tag-target','40');await h.click('Extend from selected topics');assert.deepEqual(h.actions.at(-1),{action:'extend-assignment-topics',payload:{runId:'run',paperIds:['a','b'],additionalTargetCount:40,processingPolicy:'auto-clear'}});assert.ok(h.button('Apply inclusion'));assert.equal(h.actions.some(action=>action.action==='apply-paper-exclusion'),false);
  await h.click('Apply inclusion');assert.deepEqual(h.actions.at(-1),{action:'apply-paper-exclusion',payload:{previewId:'include-topic-papers'}});assert.equal(h.doc.getElementById('nav-cleanup').getAttribute('aria-current'),'page');
});

test('extension targets count additions separately and review shows the cumulative list beyond sixty',async t=>{
  const data=snapshot();data.tags=Array.from({length:60},(_,index)=>tag(`saved-${index}`,`Saved ${index}`));data.settings.extensionTagTarget=30;data.workflow={buildMode:'extend',buildScope:'selected',buildPaperCount:3,assignmentScope:'library',assignmentPaperCount:0,assignedPaperCount:0};const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('additional-tag-target'),null);h.expand('More options');assert.equal(h.doc.getElementById('additional-tag-target').value,'30');h.change('additional-tag-target','42');await h.emitUpdate();assert.equal(h.doc.getElementById('additional-tag-target').value,'42');await h.click('Build tags from these papers');assert.deepEqual(h.actions[0],{action:'prepare-tags',payload:{scope:'selected',mode:'extend',additionalTargetCount:42,processingPolicy:'auto-clear'}});
  data.tagPreparation=preparation([...data.tags.slice(0,5).map(tag=>({...tag,retained:true})),...Array.from({length:12},(_,index)=>tag(`new-${index}`,`New ${index}`))]);await h.emitUpdate();assert.match(h.app.textContent,/60 saved \+ 12 new = 72 total/);assert.equal(data.settings.extensionTagTarget,30);
});

test('old topic notices remain in history without active warning banners',async t=>{
  const data=snapshot();data.warnings=[warning('topic',{code:'unapproved-topics',message:'Earlier unmatched topic names.'})];const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.equal(h.all().some(node=>node.classList.contains('active-warning-summary')),false);h.expand('History');assert.match(h.app.textContent,/Earlier notice/);assert.match(h.app.textContent,/Earlier unmatched topic names/);assert.equal(h.actions.length,0);
});

test('saved tag shelves filter equal tags and keep stable membership when renamed',async t=>{
  const data=snapshot();data.tagShelves=[{id:'generated',name:'Generated tags 1',kind:'generated',tagIds:['fc','pemfc','eis'],count:3},{id:'mine',name:'My tags',kind:'user',tagIds:['rcl'],count:1}];
  const h=await harness(data,{page:'vocabulary',onInvoke(action,payload,current){if(action==='rename-tag-shelf')current.tagShelves!.find(shelf=>shelf.id===payload.id)!.name=payload.name;}});t.after(()=>h.ui.destroy());h.choose('tag-library-shelf',2);assert.ok(h.button('Edit tag RCL'));assert.equal(h.button('Edit tag FC'),undefined);assert.doesNotMatch(h.app.textContent,/DIY|core|custom/i);
  h.expand('Shelf options');await settle();await h.click('Rename shelf…');h.change('tag-shelf-name','Resistance research');await h.click('Save shelf name');assert.deepEqual(h.actions,[{action:'rename-tag-shelf',payload:{id:'mine',name:'Resistance research'}}]);assert.match(h.doc.getElementById('tag-library-shelf').textContent,/Resistance research/);assert.ok(h.button('Edit tag RCL'));
  await h.click('Edit tag RCL');h.expand('More options');assert.ok(h.doc.getElementById('tag-matching-mode'));await h.click('Discard changes');h.choose('tag-library-shelf',1);await h.click('Edit tag FC');h.expand('More options');assert.ok(h.doc.getElementById('tag-matching-mode'));await h.click('Discard changes');await h.click('Add tag');h.change('tag-name','New topic');h.change('tag-description','A topic defined by the researcher.');await h.click('Save');assert.equal(h.actions.at(-1)!.action,'create-detail');assert.equal(h.actions.at(-1)!.payload.tagShelfId,'generated');assert.deepEqual(data.tagShelves[0].tagIds,['fc','pemfc','eis']);
});

test('All tags includes native names once and My tags combines those names with saved meanings without a separate Existing shelf',async t=>{
  const data=snapshot(),native=structuredClone(data.papers),names=[{name:'EIS',tagId:'eis',paperCount:1},{name:'RCL',tagId:'rcl',paperCount:2},{name:'Legacy Topic',paperCount:2},{name:'no_tag',paperCount:1,protected:true}];data.tagLibraryEntries=[...names,{name:'FC',tagId:'fc',paperCount:0},{name:'PEMFC',tagId:'pemfc',paperCount:2}];data.tagShelves=[{id:'generated',name:'Generated tags 1',kind:'generated',tagIds:['fc','pemfc','eis'],count:3},{id:'tag-shelf-my-tags',name:'My tags',kind:'user',tagIds:['rcl','eis'],count:4,nativeNames:names}];
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());assert.match(h.doc.getElementById('tag-library-shelf').textContent,/All tags · 6/);assert.equal(h.all().filter(node=>node.classList.contains('tag-row')).length,6);assert.equal(h.button('Existing tags'),undefined);h.choose('tag-library-shelf',2);assert.match(h.doc.getElementById('tag-library-shelf').textContent,/My tags · 4/);assert.equal(h.all().filter(node=>node.classList.contains('tag-row')).length,4);assert.ok(h.button('Edit tag EIS'));assert.ok(h.button('Remove tag RCL'));assert.equal(h.button('Edit tag FC'),undefined);assert.match(h.app.textContent,/No meaning added/);assert.doesNotMatch(h.app.textContent,/Shelves can share tags/);assert.equal(h.button('Add meaning for no_tag'),undefined);assert.equal(h.actions.length,0);await h.click('Add meaning for Legacy Topic');assert.equal(h.doc.getElementById('tag-name').value,'Legacy Topic');h.change('tag-description','A deliberately supplied topic meaning.');await h.click('Save');assert.equal(h.actions[0].action,'create-detail');assert.equal(h.actions[0].payload.tag.name,'Legacy Topic');assert.deepEqual(h.actions[0].payload.tag.aliases,['Legacy Topic']);assert.equal(h.actions[0].payload.tagShelfId,'tag-shelf-my-tags');assert.deepEqual(data.papers,native);assert.equal(h.actions.some(action=>action.action==='tag'||action.action==='prepare-tags'),false);
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
  const libraryLabels=labels('tag-library-shelf');assert.deepEqual(libraryLabels,expected);assert.match(h.doc.getElementById('nav-vocabulary').textContent,/199$/);assert.doesNotMatch(h.app.textContent,/Ready tags have a saved meaning/);assert.doesNotMatch(h.app.textContent,/Shelves can share tags/);
  h.ui.navigate({page:'assignment'});const assignmentLabels=labels('assignment-tag-shelf');assert.deepEqual(assignmentLabels,libraryLabels);assert.doesNotMatch(h.app.textContent,/Ready tags have a saved meaning/);assert.doesNotMatch(h.app.textContent,/Shelves can share tags/);
  h.doc.getElementById('assignment-tag-shelf-option-2').emit('click');await settle();await h.click('Assign tags to these papers');assert.deepEqual(h.actions,[{action:'tag',payload:{scope:'library',tagShelfId:'tag-shelf-my-tags',processingPolicy:'auto-clear'}}]);assert.deepEqual(data.papers,native);assert.deepEqual(data.tags,saved);assert.deepEqual(data.tagShelves,shelves);assert.equal(data.settings.autoAssign,false);
});

test('assignment shelf choice is independent, survives refresh, and rejects shelves without meanings',async t=>{
  const data=snapshot();data.tagShelves=[{id:'generated',name:'Generated tags 1',kind:'generated',tagIds:['fc'],count:1},{id:'existing',name:'Earlier names',kind:'existing',tagIds:[],count:1,nativeNames:[{name:'Project X',paperCount:2}]}];data.workflow={buildMode:'extend',buildScope:'selected',buildPaperCount:51,assignmentScope:'collections',assignmentPaperCount:4,assignedPaperCount:0,assignmentTagShelfId:'generated'};
  const h=await harness(data,{page:'assignment'});t.after(()=>h.ui.destroy());assert.match(h.doc.getElementById('assignment-tag-shelf').textContent,/Generated tags 1/);h.choose('assignment-tag-shelf',2);assert.equal(h.button('Assign tags to these papers').disabled,true);assert.match(h.app.textContent,/This shelf has no scientific tags available for assignment/);h.choose('assignment-tag-shelf',1);await h.emitUpdate();await h.click('Assign tags to these papers');assert.deepEqual(h.actions,[{action:'tag',payload:{scope:'collections',tagShelfId:'generated',processingPolicy:'auto-clear'}}]);assert.equal(data.settings.autoAssign,false);
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

test('old processing history cleanup inspects once and removes data only after confirmation',async t=>{
  const data=snapshot(),before=structuredClone(data);
  const h=await harness(data,{page:'settings',onInvoke(action){if(action==='inspect-old-processing-history')return {records:3,bytes:25_237_129};}});t.after(()=>h.ui.destroy());
  assert.equal(h.button('Clean up old processing history…'),undefined);assert.equal(h.actions.length,0);
  h.expand('Data');assert.equal(h.actions.length,0);await h.emitUpdate();assert.equal(h.actions.length,0);
  await h.click('Clean up old processing history…');assert.deepEqual(h.actions,[{action:'inspect-old-processing-history',payload:undefined}]);
  assert.match(h.app.textContent,/3 records · about 25\.2 MB/);assert.match(h.app.textContent,/Permanently remove obsolete analysis, vocabulary and tag-comparison audit copies, superseded paper facts, and duplicate meaning checkpoints/);assert.match(h.app.textContent,/Current paper analysis, saved tags, unfinished reviews, reusable vocabulary progress, and Undo records stay in place/);assert.match(h.app.textContent,/Future saves will also stop accumulating these obsolete copies/);
  assert.equal(h.doc.querySelector('.modal').getAttribute('role'),'dialog');assert.equal(h.doc.querySelector('.modal').getAttribute('aria-modal'),'true');
  await h.click('Cancel');assert.equal(h.button('Clean up history'),undefined);assert.equal(h.actions.length,1);
  await h.click('Clean up old processing history…');await h.click('Clean up history');
  assert.deepEqual(h.actions.map(entry=>entry.action),['inspect-old-processing-history','inspect-old-processing-history','clean-old-processing-history']);assert.match(h.app.textContent,/Old processing history removed\. Future history stays compact/);assert.equal(h.button('Clean up history'),undefined);assert.deepEqual(data,before);
});

test('empty processing history enables compact future saves without a deletion confirmation',async t=>{
  const h=await harness(snapshot(),{page:'settings',onInvoke(action){if(action==='inspect-old-processing-history')return {records:0,bytes:0};}});t.after(()=>h.ui.destroy());h.expand('Data');await h.click('Clean up old processing history…');
  assert.deepEqual(h.actions,[{action:'inspect-old-processing-history',payload:undefined},{action:'clean-old-processing-history',payload:{expectEmpty:true}}]);assert.match(h.app.textContent,/History is already clean\. Future history stays compact/);assert.equal(h.button('Clean up history'),undefined);assert.equal(h.doc.querySelector('.modal'),null);
});

test('history cleanup can be dismissed with Escape and failed cleanup remains retryable',async t=>{
  let fail=true;
  const h=await harness(snapshot(),{page:'settings',onInvoke(action){if(action==='inspect-old-processing-history')return {records:1,bytes:1200};if(action==='clean-old-processing-history'&&fail)throw new Error('The saved data could not be written.');}});t.after(()=>h.ui.destroy());h.expand('Data');await h.click('Clean up old processing history…');assert.match(h.app.textContent,/1 record · about 1 KB/);
  h.doc.querySelector('.modal').emit('keydown',{key:'Escape'});assert.equal(h.button('Clean up history'),undefined);assert.equal(h.actions.length,1);
  await h.click('Clean up old processing history…');await h.click('Clean up history');assert.ok(h.button('Clean up history'));assert.match(h.app.textContent,/The saved data could not be written/);
  fail=false;await h.click('Clean up history');assert.equal(h.button('Clean up history'),undefined);assert.match(h.app.textContent,/Old processing history removed\. Future history stays compact/);assert.equal(h.actions.filter(entry=>entry.action==='clean-old-processing-history').length,2);
});

test('resetting reusable paper analysis requires one explicit confirmation in Settings data controls',async t=>{
  const data=snapshot(),native=structuredClone(data.papers),tags=structuredClone(data.tags),settings=structuredClone(data.settings);const h=await harness(data,{page:'settings'});t.after(()=>h.ui.destroy());assert.equal(h.button('Reset paper analysis…'),undefined);h.expand('Data');await h.click('Reset paper analysis…');assert.equal(h.actions.length,0);assert.match(h.app.textContent,/paper-tag suggestions/);assert.match(h.app.textContent,/PDFs, paper tags, saved tag definitions, credentials, spending records, and Undo history stay in place/);await h.click('Cancel');assert.equal(h.actions.length,0);await h.click('Reset paper analysis…');await h.click('Reset paper analysis');assert.deepEqual(h.actions,[{action:'reset-paper-analysis',payload:undefined}]);assert.match(h.app.textContent,/Paper analysis reset\. The next build will start fresh/);assert.deepEqual(data.papers,native);assert.deepEqual(data.tags,tags);assert.deepEqual(data.settings,settings);
});

test('a single Details click persists before the native toggle event or a background refresh',async t=>{
  const h=await harness(snapshot(),{page:'settings'});t.after(()=>h.ui.destroy());const summary=h.doc.getElementById('details-data');summary.focus();summary.emit('click');assert.ok(h.button('Reset paper analysis…'));await h.emitUpdate();assert.equal(h.doc.getElementById('details-data').parentNode.open,true);assert.ok(h.button('Reset paper analysis…'));assert.equal(h.doc.activeElement.id,'details-data');summary.parentNode.emit('toggle');assert.ok(h.button('Reset paper analysis…'));h.doc.getElementById('details-data').emit('click');await h.emitUpdate();assert.equal(h.doc.getElementById('details-data').parentNode.open,false);assert.equal(h.button('Reset paper analysis…'),undefined);assert.equal(h.actions.length,0);
});

test('shelf actions combine selected lists once while preserving tag meanings and paper assignments',async t=>{
  const data=snapshot(),native=structuredClone(data.papers),saved=structuredClone(data.tags);
  data.tagLibraryEntries=[...data.tags.map(tag=>({name:tag.name,tagId:tag.id,paperCount:1})),{name:'Lab marker',paperCount:2}];
  data.tagShelves=[{id:'first',name:'Generated tags 1',kind:'generated',tagIds:['fc','pemfc','eis'],count:3},{id:'second',name:'Generated tags 2',kind:'generated',tagIds:['rcl','eis'],count:2},{id:'tag-shelf-my-tags',name:'My tags',kind:'user',tagIds:['rcl','eis'],count:3,nativeNames:[{name:'RCL',tagId:'rcl',paperCount:1},{name:'EIS',tagId:'eis',paperCount:1},{name:'Lab marker',paperCount:2}]}];
  const h=await harness(data,{page:'vocabulary',onInvoke(action,payload,current){if(action!=='merge-tag-shelves')return;current.tagShelves=[{id:'tag-shelf-my-tags',name:payload.name,kind:'user',tagIds:['fc','pemfc','eis','rcl'],count:5,nativeNames:current.tagLibraryEntries}];return {shelfId:'tag-shelf-my-tags'};}});t.after(()=>h.ui.destroy());
  assert.equal(h.button('Rename shelf…'),undefined);h.expand('Shelf options');await settle();assert.ok(h.button('Merge shelves…'));assert.equal(h.button('Shelf actions'),undefined);await h.click('Merge shelves…');assert.equal(h.button('Merge shelves').disabled,true);
  h.change('merge-shelf-first',true);h.change('merge-shelf-second',true);assert.match(h.app.textContent,/2 shelves · 4 unique tags/);h.change('merge-shelf-tag-shelf-my-tags',true);assert.match(h.app.textContent,/3 shelves · 5 unique tags/);assert.match(h.app.textContent,/Native Zotero names stay available in the combined shelf/);h.change('replace-merged-shelves',false);assert.match(h.app.textContent,/Tags and paper assignments are preserved/);h.change('replace-merged-shelves',true);h.change('merged-shelf-name','All research');await h.click('Merge shelves');
  assert.deepEqual(h.actions,[{action:'merge-tag-shelves',payload:{sourceIds:['first','second','tag-shelf-my-tags'],name:'All research',replaceSources:true}}]);assert.equal(h.doc.getElementById('tag-library-shelf').textContent,'All research · 5 total · 4 ready');assert.equal(data.tagShelves.length,1);assert.equal(data.tagShelves[0].id,'tag-shelf-my-tags');assert.deepEqual(data.tags,saved);assert.deepEqual(data.papers,native);assert.equal(data.settings.autoAssign,false);
});

test('Needs meaning selects exact native names across pages without including ready tags or protected markers',async t=>{
  const data=snapshot(),names=Array.from({length:22},(_,index)=>({name:index===0?'  Imported marker  ':`Imported marker ${index}`,paperCount:1,paperIds:['a']})),native=structuredClone(data.papers),saved=structuredClone(data.tags);
  data.queue={kind:'rebuild',ownerPage:'cleanup',status:'running',total:51,completed:12,failed:0};const queue=structuredClone(data.queue);
  data.tagLibraryEntries=[{name:'FC',tagId:'fc',paperCount:1},...names,{name:'no_tag',paperCount:1,protected:true}];data.tagShelves=[{id:'mine',name:'My tags',kind:'user',tagIds:['fc'],count:24,nativeNames:data.tagLibraryEntries}];
  const h=await harness(data,{page:'vocabulary',onInvoke(action,payload,current){if(action==='prepare-tag-meanings')current.nativeDefinitionPreparation={id:'native-meanings',processingPolicy:'auto-clear',status:'queued',completed:0,total:payload.names.length,canApply:false,rows:payload.names.map((name:string,index:number)=>({id:`name-${index}`,sourceName:name,paperIds:['a'],status:'pending'}))};}});t.after(()=>h.ui.destroy());
  h.choose('tag-library-status',2);assert.equal(h.button('Edit tag FC'),undefined);assert.equal(h.button('Add meaning for no_tag'),undefined);assert.equal(h.all().filter(node=>node.classList.contains('tag-row')).length,20);h.change(`select-native-tag-${encodeURIComponent(names[0].name)}`,true);await h.click('Next tags');h.change(`select-native-tag-${encodeURIComponent(names[21].name)}`,true);assert.match(h.app.textContent,/2 selected/);h.change('vocabulary-search','marker 2');assert.match(h.app.textContent,/2 selected/);h.change('vocabulary-search','');await h.click('Select all names');assert.match(h.app.textContent,/22 selected/);await h.click('Suggest meanings');
  assert.deepEqual(h.actions,[{action:'prepare-tag-meanings',payload:{names:[names[0].name,names[21].name,...names.slice(1,21).map(entry=>entry.name)],shelfId:'all',processingPolicy:'auto-clear'}}]);assert.match(h.app.textContent,/Defining tag meanings/);assert.match(h.app.textContent,/You can keep browsing/);assert.match(h.app.textContent,/0 of 22 names checked/);assert.deepEqual(data.queue,queue);assert.deepEqual(data.tags,saved);assert.deepEqual(data.papers,native);assert.equal(data.settings.autoAssign,false);
});

test('prepared meanings save clear results together and bind a seeded meaning edit to its remaining question',async t=>{
  const data=snapshot(),native=structuredClone(data.papers);data.nativeDefinitionPreparation={id:'prepared-native',status:'ready',completed:3,total:3,canApply:true,rows:[{id:'saved-match',sourceName:'resistance marker',name:'RCL',description:'Catalyst-layer resistance.',facet:'phenomenon',paperIds:['a'],status:'ready',targetTagId:'rcl'},{id:'new-meaning',sourceName:'grooved CL',name:'grooved catalyst layer',description:'Catalyst layers patterned with grooves.',facet:'component',paperIds:['a'],status:'ready'},{id:'uncertain',tagId:'ac-tag',sourceName:'AC',name:'AC measurement',fullName:'alternating-current measurement',description:'A measurement using alternating current.',facet:'method',aliases:['alternating current'],inclusions:['frequency-dependent measurements'],exclusions:[],examples:['Impedance measurement'],broaderIds:[],relatedIds:['eis'],matchingMode:'suggest',paperIds:['b'],status:'question',question:'Which meaning of AC do you want to follow?'}]};
  const h=await harness(data,{page:'vocabulary',reviewMeanings:true,onInvoke(action,payload,current){if(action==='apply-tag-meanings'){for(const row of current.nativeDefinitionPreparation!.rows)if(payload.rowIds.includes(row.id))row.applied=true;current.nativeDefinitionPreparation!.canApply=false;}if(action==='edit-tag-meaning'){const row=current.nativeDefinitionPreparation!.rows.find(row=>row.id===payload.entryId)!;Object.assign(row,payload.tag,{status:'ready'});current.nativeDefinitionPreparation!.canApply=true;}}});t.after(()=>h.ui.destroy());assert.equal(h.button('Save 2 meanings').disabled,false);assert.match(h.app.textContent,/From: resistance marker/);assert.match(h.app.textContent,/Use saved tag/);assert.match(h.app.textContent,/AI proposal: AC measurement/);assert.doesNotMatch(h.app.textContent,/registry|snapshot|fingerprint|supportRegistryIds/i);await h.click('Save 2 meanings');assert.deepEqual(h.actions,[{action:'apply-tag-meanings',payload:{id:'prepared-native',rowIds:['saved-match','new-meaning']}}]);assert.equal(h.button('Save 0 meanings'),undefined);
  await h.click('Edit meaning for AC');assert.equal(h.doc.getElementById('tag-name').value,'AC measurement');assert.equal(h.doc.getElementById('tag-full-name').value,'alternating-current measurement');assert.equal(h.doc.getElementById('tag-description').value,'A measurement using alternating current.');assert.match(h.doc.getElementById('tag-facet').textContent,/Methods/);h.change('tag-description','A personally defined alternating-current measurement topic.');await h.emitUpdate();assert.equal(h.doc.getElementById('tag-description').value,'A personally defined alternating-current measurement topic.');await h.click('Save');assert.equal(h.actions[1].action,'edit-tag-meaning');assert.equal(h.actions[1].payload.id,'prepared-native');assert.equal(h.actions[1].payload.entryId,'uncertain');assert.equal(h.actions[1].payload.tag.id,'ac-tag');assert.deepEqual(h.actions[1].payload.tag.aliases,['alternating current']);assert.deepEqual(h.actions[1].payload.tag.relatedIds,['eis']);assert.ok(h.button('Save 1 meaning'));await h.click('Back to tags');assert.ok(h.button('Review meanings'));assert.deepEqual(data.papers,native);assert.equal(data.settings.autoAssign,false);assert.equal(h.actions.some(entry=>['tag','apply-suggestions','create-detail'].includes(entry.action)),false);
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
  data.tagShelves=[{id:'first',name:'Earlier research',kind:'generated',tagIds:['fc'],count:1}];data.workflow.assignmentTagShelfId='first';await h.emitUpdate();h.ui.navigate({page:'vocabulary'});assert.match(h.doc.getElementById('tag-library-shelf').textContent,/All tags/);h.ui.navigate({page:'assignment'});assert.match(h.doc.getElementById('assignment-tag-shelf').textContent,/Earlier research/);await h.click('Assign tags to these papers');assert.deepEqual(h.actions,[{action:'tag',payload:{scope:'library',tagShelfId:'first',processingPolicy:'auto-clear'}}]);assert.deepEqual(data.papers,original);
});

test('question-only meanings offer scope choices and per-name leave undefined before Done',async t=>{
  const data=snapshot(),native=structuredClone(data.papers),saved=structuredClone(data.tags);data.nativeDefinitionPreparation={id:'battery-work',status:'ready',completed:2,total:2,canApply:false,questionCount:2,rows:[{id:'batteries',tagId:'battery-tag',sourceName:'Batteries',paperIds:['a','b'],status:'question',question:'Use this name for batteries generally, or only lithium-ion batteries?',choices:[{id:'broad',label:'Use a broad battery tag',description:'Include battery systems regardless of chemistry.'},{id:'li-ion',label:'Use li-ion battery',description:'Use the saved lithium-ion battery meaning.'}]},{id:'personal',sourceName:'Reading list',paperIds:['a'],status:'question',question:'This appears to be a reading label.'}]};
  const h=await harness(data,{page:'vocabulary',reviewMeanings:true,onInvoke(action,payload,current){const work=current.nativeDefinitionPreparation!,row=work.rows.find(row=>row.id===payload.entryId);if(action==='answer-tag-meaning'){assert.equal(payload.choiceId,'broad');Object.assign(row!,{status:'ready',name:'battery',fullName:'battery',description:'Battery systems, including multiple chemistries.',facet:'system'});work.canApply=true;}if(action==='leave-tag-undefined')row!.status='left-undefined';if(action==='apply-tag-meanings')for(const entry of work.rows)if(payload.rowIds.includes(entry.id))entry.applied=true;if(action==='finish-tag-meanings')work.status='finished';}});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/2 tags need attention/);assert.equal(h.button('Save 0 meanings'),undefined);assert.equal(h.button('Done'),undefined);const broad=h.button('Use a broad battery tag');assert.equal(broad.localName,'button');broad.focus();assert.equal(h.doc.activeElement,broad);await h.click('Use a broad battery tag');assert.deepEqual(h.actions[0],{action:'answer-tag-meaning',payload:{id:'battery-work',entryId:'batteries',choiceId:'broad'}});assert.ok(h.button('Save 1 meaning'));await h.click('Skip defining Reading list');assert.deepEqual(h.actions[1],{action:'leave-tag-undefined',payload:{id:'battery-work',entryId:'personal'}});await h.click('Save 1 meaning');assert.ok(h.button('Done'));assert.match(h.app.textContent,/1 saved · 1 left undefined/);await h.click('Done');assert.equal(h.actions.at(-1).action,'finish-tag-meanings');assert.equal(h.all().some(node=>node.className.includes('native-meaning-panel')),false);assert.deepEqual(data.tags,saved);assert.deepEqual(data.papers,native);assert.equal(data.settings.autoAssign,false);
});

test('legacy meaning questions can continue and the shelf toolbar remains outside the scrolling review',async t=>{
  const data=snapshot();data.tagShelves=[{id:'one',name:'Generated tags 1',kind:'generated',tagIds:['fc'],count:1},{id:'two',name:'My tags',kind:'user',tagIds:['eis'],count:1}];data.nativeDefinitionPreparation={id:'legacy-meaning',status:'ready',completed:1,total:1,canApply:false,canContinue:true,rows:[{id:'old-question',sourceName:'Batteries',paperIds:['a'],status:'question',question:'Clarify the scope of Batteries.',needsContinuation:true}]};const h=await harness(data,{page:'vocabulary',reviewMeanings:true});t.after(()=>h.ui.destroy());
  const scroll=h.doc.getElementById('tag-list-scroll');assert.ok(scroll);assert.ok(h.doc.getElementById('tag-library-shelf'));assert.equal(scroll.contains(h.doc.getElementById('tag-library-shelf')),false);assert.equal(scroll.contains(h.button('Merge shelves…')),false);assert.equal(h.button('Continue preparation'),undefined);assert.ok(h.button('Ask AI again for Batteries'));await h.click('Ask AI again for Batteries');assert.deepEqual(h.actions,[{action:'retry-proposed-tag-meaning',payload:{id:'legacy-meaning',entryId:'old-question'}}]);h.doc.getElementById('tag-list-scroll').scrollTop=180;await h.emitUpdate();assert.equal(h.doc.getElementById('tag-list-scroll').scrollTop,180);h.expand('Shelf options');await settle();await h.click('Merge shelves…');assert.ok(h.doc.getElementById('merge-shelf-one'));assert.ok(h.doc.getElementById('merge-shelf-two'));
});

test('native meaning editor preserves separate entry drafts and scroll and Cancel does not save a partial answer',async t=>{
  const data=snapshot();data.nativeDefinitionPreparation={id:'draft-work',status:'ready',completed:2,total:2,canApply:false,rows:[{id:'one',sourceName:'Batteries',name:'battery',description:'Battery systems.',facet:'system',paperIds:['a'],status:'question',question:'Choose the scope.'},{id:'two',sourceName:'AC',name:'AC',description:'Alternating-current measurements.',facet:'method',paperIds:['b'],status:'question',question:'Choose the meaning.'}]};const h=await harness(data,{page:'vocabulary',reviewMeanings:true});t.after(()=>h.ui.destroy());await h.click('Edit meaning for Batteries');h.change('tag-description','An unfinished broad battery meaning.');h.doc.getElementById('tag-editor-form').scrollTop=145;await h.click('Edit meaning for AC');h.change('tag-description','An unfinished AC meaning.');h.doc.getElementById('tag-editor-form').scrollTop=90;await h.emitUpdate();assert.equal(h.doc.getElementById('tag-editor-form').scrollTop,90);await h.click('Edit meaning for Batteries');assert.equal(h.doc.getElementById('tag-description').value,'An unfinished broad battery meaning.');assert.equal(h.doc.getElementById('tag-editor-form').scrollTop,145);await h.click('Discard changes');assert.equal(h.doc.getElementById('tag-editor-form'),null);await h.click('Edit meaning for AC');assert.equal(h.doc.getElementById('tag-description').value,'An unfinished AC meaning.');assert.equal(h.doc.getElementById('tag-editor-form').scrollTop,90);await h.click('Discard changes');await h.click('Edit meaning for Batteries');assert.equal(h.doc.getElementById('tag-description').value,'Battery systems.');assert.equal(h.actions.length,0);
});

test('native editors use a viewport drawer below tall reviews and retain drafts while resizing',async t=>{
  for(const automatic of [false,true]){
    const data=snapshot(),rows:NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>['rows']=Array.from({length:25},(_,index)=>({id:`native-${index}`,sourceName:index===0?'Heterogeneous catalysis':`Native topic ${index}`,name:index===0?'heterogeneous catalysis':`scientific topic ${index}`,description:index===0?'Catalysis at an interface between distinct phases.':`The scientific meaning of topic ${index}.`,facet:'phenomenon',paperIds:['a'],status:'question',questionKind:'meaning',question:'Choose the scientific scope represented by this native name.'}));
    data.nativeDefinitionPreparation={id:'tall-native-review',...(automatic?{processingPolicy:'auto-clear' as const}:{}),status:'ready',completed:25,total:25,canApply:false,rows};
    if(automatic)data.reviewItems=rows.map(row=>({id:`review-${row.id}`,kind:'definition',state:'open',taskId:'native-maintenance',workId:'tall-native-review',ownerPage:'vocabulary',questionId:row.id,sourceName:row.sourceName,label:row.sourceName}));
    const h=await harness(data,{page:'vocabulary',reviewMeanings:!automatic});t.after(()=>h.ui.destroy());if(automatic)await h.click('Choose meanings');
    h.rectangles.set('.tag-workspace-columns',{top:720});h.rectangles.set('.tag-editor',{top:720});h.focusScroll.set('tag-description',720);h.win.scrollY=120;
    const open=async()=>{const trigger=h.doc.getElementById('edit-native-meaning-native-0');assert.ok(trigger);trigger.focus();trigger.emit('click');await settle();};
    const editor=()=>h.all().find(node=>node.classList.contains('tag-editor'))!;
    await open();assert.equal(h.doc.activeElement.id,'tag-description');assert.equal(h.win.scrollY,120,'Opening the editor must not move the outer page');
    assert.equal(editor().classList.contains('editor-drawer'),true);assert.ok(!editor().style.height&&!editor().style.maxHeight,'The drawer must not retain a tiny inline height');
    h.rectangles.set('.tag-editor',{top:12});h.win.emit('resize');assert.equal(editor().classList.contains('editor-drawer'),true,'A floating editor must still use its natural workspace position when fitting');
    assert.ok(editor().contains(h.button('Save')));assert.ok(editor().contains(h.button('Close editor')));
    h.change('tag-description','My unfinished definition of heterogeneous catalysis.');h.expand('More options');h.change('tag-aliases','heterogeneous catalyst\nsurface catalysis');h.doc.getElementById('tag-editor-form').scrollTop=155;await h.emitUpdate();
    const assertDraft=(scroll=155)=>{assert.equal(h.doc.getElementById('tag-description').value,'My unfinished definition of heterogeneous catalysis.');assert.equal(h.doc.getElementById('tag-aliases').value,'heterogeneous catalyst\nsurface catalysis');assert.equal(editor().querySelector('.editor-advanced').open,true);assert.equal(h.doc.getElementById('tag-editor-form').scrollTop,scroll);assert.equal(h.win.scrollY,120);};
    assertDraft();h.win.innerHeight=1400;h.win.emit('resize');
    assert.equal(editor().classList.contains('editor-drawer'),false);assert.ok(Number.parseFloat(editor().style.height)>400,'Available desktop space should give the editor a usable height');assert.ok(Number.parseFloat(editor().style.height)<=h.win.innerHeight-720,'Desktop allocation must fit below the natural workspace position');assertDraft();
    h.win.innerWidth=806;h.win.innerHeight=582;h.win.emit('resize');assert.equal(editor().classList.contains('editor-drawer'),true);assert.ok(!editor().style.height&&!editor().style.maxHeight);assertDraft();
    h.win.innerWidth=1100;h.win.innerHeight=1400;h.win.emit('resize');assert.equal(editor().classList.contains('editor-drawer'),false);assertDraft();
    await h.click('Close editor');assert.equal(!!h.doc.getElementById('tag-editor-form'),false);assert.equal(h.doc.activeElement.id,'edit-native-meaning-native-0');await open();assertDraft();assert.equal(h.doc.activeElement.id,'tag-description');assert.equal(h.actions.length,0);
    await h.click('Close editor');h.rectangles.set('#tag-editor-form',{top:100,height:400});h.rectangles.set('#tag-description',{get top(){return 170-(h.doc.getElementById('tag-editor-form')?.scrollTop??0);},height:80});await open();
    const innerScroll=h.doc.getElementById('tag-editor-form').scrollTop,field=h.doc.getElementById('tag-description').getBoundingClientRect(),viewport=h.doc.getElementById('tag-editor-form').getBoundingClientRect();
    assert.notEqual(innerScroll,155,'Reopening must reveal an offscreen Meaning field inside the form');assertDraft(innerScroll);assert.equal(h.doc.activeElement.id,'tag-description');assert.ok(field.top>=viewport.top&&field.bottom<=viewport.bottom);
    h.change('tag-description','A newly typed definition after revealing the field.');assert.equal(h.doc.getElementById('tag-description').value,'A newly typed definition after revealing the field.');assert.equal(h.win.scrollY,120);assert.equal(h.actions.length,0);
  }
});

test('bounded native meaning choices remain reachable beyond fifty in both processing policies',async t=>{
  for(const automatic of [false,true]){
    const data=snapshot(),rows:NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>['rows']=Array.from({length:61},(_,index)=>({id:`paged-${index}`,sourceName:`Paged topic ${index}`,name:`Paged topic ${index}`,description:`Scientific meaning ${index}.`,paperIds:[],status:'question',questionKind:'meaning',choices:[{id:`choice-${index}`,label:`Use topic ${index}`,description:`Scientific meaning ${index}.`}]}));
    data.nativeDefinitionPreparation={id:'paged-work',...(automatic?{processingPolicy:'auto-clear' as const}:{}),status:'ready',completed:61,total:61,canApply:false,rows};
    const h=await harness(data,{page:'vocabulary',reviewMeanings:!automatic,view:(query,model)=>{if(query.params?.nativeMeaningReviewHidden!==false)return {model,total:model.tags.length};const offset=Number(query.cursor),native=model.nativeDefinitionPreparation!;return {model:{...model,nativeDefinitionPreparation:{...native,rows:native.rows.slice(offset,offset+20)}},total:61,...(offset+20<61?{nextCursor:String(offset+20)}:{})};}});t.after(()=>h.ui.destroy());if(automatic)await h.click('Choose meanings');
    assert.ok(h.button('Use topic 0'));await h.click('Next meanings');assert.equal(h.watches.at(-1)!.query.cursor,'20');assert.ok(h.button('Use topic 20'));await h.click('Next meanings');assert.equal(h.watches.at(-1)!.query.cursor,'40');assert.ok(h.button('Use topic 40'));await h.click('Next meanings');assert.equal(h.watches.at(-1)!.query.cursor,'60');assert.ok(h.button('Use topic 60'));assert.equal(h.button('Next meanings').disabled,true);await h.click('Previous meanings');assert.equal(h.watches.at(-1)!.query.cursor,'40');assert.ok(h.button('Use topic 40'));
  }
});

test('Open meaning requests and renders its exact native entry outside the first page',async t=>{
  const data=snapshot(),target={id:'last-entry',sourceName:'Last scientific topic',name:'Last scientific topic',description:'The exact saved proposal.',paperIds:[],status:'question' as const,questionKind:'meaning' as const,choices:[{id:'last-choice',label:'Use exact last meaning',description:'The exact saved proposal.'}]};data.nativeDefinitionPreparation={id:'exact-work',processingPolicy:'auto-clear',status:'ready',completed:61,total:61,canApply:false,rows:[]};data.reviewItems=[{id:'last-review',kind:'definition',state:'open',taskId:'old-maintenance',workId:'exact-work',questionId:'last-entry',ownerPage:'vocabulary',label:'Last scientific topic'}];
  const h=await harness(data,{page:'activity',view:(query,model)=>query.page==='vocabulary'?{model:{...model,reviewItems:undefined,detailNativeMeaningRows:query.params?.nativeReviewTarget?[target]:[]},total:61,nextCursor:'20'}:{model},onInvoke:action=>action==='open-review-item'?{page:'vocabulary'}:undefined});t.after(()=>h.ui.destroy());assert.ok(h.button('Open meaning'));await h.click('Open meaning');assert.deepEqual(h.watches.at(-1)!.query.params?.nativeReviewTarget,{workId:'exact-work',entryId:'last-entry'});assert.ok(h.button('Use exact last meaning'));
});

test('reopening a saved tag reveals an offscreen Name without moving the outer page or losing its draft',async t=>{
  const h=await harness(snapshot(),{page:'vocabulary'});t.after(()=>h.ui.destroy());h.win.scrollY=120;h.focusScroll.set('tag-name',900);
  h.rectangles.set('#tag-editor-form',{top:100,height:400});h.rectangles.set('#tag-name',{get top(){return 124-(h.doc.getElementById('tag-editor-form')?.scrollTop??0);},height:34});
  await h.click('Edit tag FC');h.change('tag-name','Fuel cell draft');h.change('tag-description','My unfinished fuel cell meaning.');h.expand('More options');h.doc.getElementById('tag-editor-form').scrollTop=300;
  await h.click('Close editor');await h.click('Edit tag FC');
  const form=h.doc.getElementById('tag-editor-form'),field=h.doc.getElementById('tag-name'),rect=field.getBoundingClientRect(),viewport=form.getBoundingClientRect();
  assert.equal(h.doc.activeElement.id,'tag-name');assert.notEqual(form.scrollTop,300);assert.ok(rect.top>=viewport.top&&rect.bottom<=viewport.bottom);assert.equal(h.win.scrollY,120);
  assert.equal(field.value,'Fuel cell draft');assert.equal(h.doc.getElementById('tag-description').value,'My unfinished fuel cell meaning.');assert.equal(h.all().find(node=>node.classList.contains('editor-advanced'))!.open,true);
  h.change('tag-name','Fuel cell draft typed');assert.equal(h.doc.getElementById('tag-name').value,'Fuel cell draft typed');assert.equal(h.actions.length,0);
});

test('Activity shows the current meaning choice and collapses the previous completed build without work controls',async t=>{
  const data=snapshot();data.queue={kind:'rebuild',ownerPage:'cleanup',phase:'ready',status:'idle',total:48,completed:48,failed:0,message:'The previous tag list is saved.'};data.nativeDefinitionPreparation={id:'current-meaning',status:'ready',completed:1,total:1,canApply:false,rows:[{id:'battery',sourceName:'Batteries',paperIds:['a'],status:'question',question:'Use a broad battery scope?',choices:[{id:'broad',label:'Use a broad battery tag',description:'All battery chemistries.'}]}]};data.activityTasks=[{id:'meaning-task',workId:'current-meaning',kind:'meanings',state:'needs-choice',label:'Suggest meanings',ownerPage:'vocabulary',questionCount:1,completed:1,total:1},{id:'old-build',kind:'rebuild',state:'completed',label:'Earlier tag build',ownerPage:'cleanup',completed:48,total:48,message:'The previous tag list is saved.'}];const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/1 tag meaning needs your choice/);assert.doesNotMatch(h.app.textContent,/48 papers|48 of 48|Paper analysis|Previous tag list/);assert.equal(h.all().some(node=>['run-strip','progress-bar'].includes(node.className)),false);for(const name of ['Resume','Pause','Cancel remaining'])assert.equal(h.button(name),undefined);await h.click('Open meanings');assert.ok(h.button('Use a broad battery tag'));h.ui.navigate({page:'activity'});h.expand('History');h.expand('Completed work');assert.match(h.app.textContent,/Earlier tag build/);assert.match(h.app.textContent,/48 of 48 papers/);assert.equal(h.actions.length,0);
});

test('Activity Open meanings starts at the first choice page after an earlier review page was visited',async t=>{
  const data=snapshot(),rows:NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>['rows']=Array.from({length:46},(_,index)=>({id:`activity-paged-${index}`,sourceName:`Activity topic ${index}`,name:`Activity topic ${index}`,description:`Meaning of activity topic ${index}.`,paperIds:[],status:'question',choices:[{id:`activity-choice-${index}`,label:`Use activity topic ${index}`,description:`Meaning of activity topic ${index}.`}]}));data.nativeDefinitionPreparation={id:'activity-paged-work',processingPolicy:'auto-clear',status:'ready',completed:46,total:46,questionCount:46,canApply:false,rows};data.activityTasks=[{id:'activity-paged-task',workId:'activity-paged-work',kind:'meanings',state:'needs-choice',label:'Tag meanings',ownerPage:'vocabulary',questionCount:46}];
  const h=await harness(data,{page:'vocabulary',view:(query,model)=>query.page==='vocabulary'&&query.params?.nativeMeaningReviewHidden===false?{model:{...model,nativeDefinitionPreparation:{...model.nativeDefinitionPreparation!,rows:rows.slice(Number(query.cursor),Number(query.cursor)+20)}},total:46,nextCursor:Number(query.cursor)+20<46?String(Number(query.cursor)+20):undefined}:{model}});t.after(()=>h.ui.destroy());await h.click('Choose meanings');await h.click('Next meanings');await h.click('Next meanings');assert.equal(h.watches.at(-1)!.query.cursor,'40');assert.ok(h.button('Use activity topic 40'));
  h.ui.navigate({page:'activity'});await settle();await h.click('Open meanings');assert.equal(h.watches.at(-1)!.query.page,'vocabulary');assert.equal(h.watches.at(-1)!.query.params?.nativeMeaningReviewHidden,false);assert.equal(h.watches.at(-1)!.query.cursor,'0');assert.ok(h.button('Use activity topic 0'));
});

test('a new native work replaces a previous later page with its first decisions',async t=>{
  const data=snapshot(),rows:NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>['rows']=Array.from({length:26},(_,index)=>({id:`old-page-${index}`,sourceName:`Old topic ${index}`,paperIds:[],status:'question',choices:[{id:`old-choice-${index}`,label:`Use old topic ${index}`,description:'Old meaning.'}]}));data.nativeDefinitionPreparation={id:'old-work-pages',processingPolicy:'auto-clear',status:'ready',completed:26,total:26,canApply:false,rows};
  const h=await harness(data,{page:'vocabulary',view:(query,model)=>query.params?.nativeMeaningReviewHidden===false?{model:{...model,nativeDefinitionPreparation:{...model.nativeDefinitionPreparation!,rows:model.nativeDefinitionPreparation!.rows.slice(Number(query.cursor),Number(query.cursor)+20)}},total:model.nativeDefinitionPreparation!.total,nextCursor:Number(query.cursor)+20<model.nativeDefinitionPreparation!.total?String(Number(query.cursor)+20):undefined}:{model}});t.after(()=>h.ui.destroy());await h.click('Choose meanings');await h.click('Next meanings');assert.equal(h.watches.at(-1)!.query.cursor,'20');
  data.nativeDefinitionPreparation={id:'new-six-choices',processingPolicy:'auto-clear',status:'ready',completed:6,total:6,canApply:false,rows:Array.from({length:6},(_,index)=>({id:`new-choice-${index}`,sourceName:`New topic ${index}`,paperIds:[],status:'question',choices:[{id:`new-option-${index}`,label:`Use new topic ${index}`,description:'New meaning.'}]}))};await h.emitUpdate();await settle();assert.equal(h.watches.at(-1)!.query.cursor,'0');assert.ok(h.button('Use new topic 0'));
});

test('Activity opens all six actionable meanings even when its bounded source rows and inbox are empty',async t=>{
  const data=snapshot(),rows:NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>['rows']=Array.from({length:6},(_,index)=>({id:`waiting-${index}`,sourceName:`Waiting topic ${index}`,paperIds:[],status:'question',choices:[{id:`waiting-option-${index}`,label:`Use waiting topic ${index}`,description:'A proposed scientific meaning.'}]}));data.reviewItems=[];data.nativeDefinitionPreparation={id:'six-waiting-meanings',processingPolicy:'auto-clear',status:'ready',completed:38,total:38,savedCount:30,questionCount:6,canApply:false,rows};data.activityTasks=[{id:'six-waiting-task',workId:'six-waiting-meanings',kind:'meanings',state:'needs-choice',label:'Suggest meanings',ownerPage:'vocabulary',questionCount:6}];
  const h=await harness(data,{page:'activity',view:(query,model)=>({model:{...model,nativeDefinitionPreparation:{...model.nativeDefinitionPreparation!,rows:query.page==='vocabulary'&&query.params?.nativeMeaningReviewHidden===false?rows:[]}},...(query.page==='vocabulary'?{total:6}:{})})});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/6 tag meanings need your choice/);await h.click('Open meanings');assert.equal(h.watches.at(-1)!.query.params?.nativeMeaningWorkId,'six-waiting-meanings');for(let index=0;index<6;index++)assert.ok(h.button(`Use waiting topic ${index}`));assert.equal(h.actions.length,0);
  await h.click('Back to tags');assert.equal(h.watches.at(-1)!.query.params?.nativeMeaningReviewHidden,true);assert.equal(h.watches.at(-1)!.query.params?.nativeMeaningWorkId,undefined);assert.equal(h.watches.at(-1)!.query.params?.nativeReviewTarget,null);
});

test('Activity restores the named meaning work when its review item is outside the current page',async t=>{
  const data=snapshot();data.reviewItems=[];data.nativeDefinitionPreparation={id:'recent-work',processingPolicy:'auto-clear',status:'ready',completed:0,total:0,canApply:false,rows:[]};data.activityTasks=[{id:'earlier-task',workId:'earlier-work',kind:'meanings',state:'needs-choice',label:'Earlier meanings',ownerPage:'vocabulary',questionCount:1}];
  const h=await harness(data,{page:'activity',onInvoke(action,payload,current){if(action==='open-meaning-work'){assert.deepEqual(structuredClone(payload),{id:'earlier-work',taskId:'earlier-task'});current.nativeDefinitionPreparation={id:'earlier-work',processingPolicy:'auto-clear',status:'ready',completed:1,total:1,questionCount:1,canApply:false,rows:[{id:'earlier-entry',sourceName:'Earlier topic',paperIds:[],status:'question',choices:[{id:'earlier-choice',label:'Use restored earlier meaning',description:'The saved earlier meaning.'}]}]};return {entryId:'earlier-entry'};}}});t.after(()=>h.ui.destroy());await h.click('Open meanings');assert.ok(h.button('Use restored earlier meaning'),h.app.textContent);assert.equal(h.watches.at(-1)!.query.params?.nativeMeaningWorkId,'earlier-work');assert.deepEqual(h.watches.at(-1)!.query.params?.nativeReviewTarget,{workId:'earlier-work',entryId:'earlier-entry'});assert.equal(h.actions.length,1);
});

test('deferred native counts keep Later reachable without sentinel rows and Reopen returns to open choices',async t=>{
  const data=snapshot(),rows:NonNullable<ManagerSnapshot['nativeDefinitionPreparation']>['rows']=Array.from({length:6},(_,index)=>({id:`deferred-entry-${index}`,sourceName:`Deferred topic ${index}`,paperIds:[],status:'question',choices:[{id:`deferred-choice-${index}`,label:`Use deferred topic ${index}`,description:'A saved scientific meaning.'}]}));data.nativeDefinitionPreparation={id:'deferred-work',processingPolicy:'auto-clear',status:'ready',completed:8,total:8,savedCount:2,questionCount:6,deferredCount:2,canApply:false,rows};data.reviewItems=rows.map((row,index)=>({id:`deferred-review-${index}`,kind:'definition',state:index<4?'open':'deferred',taskId:'deferred-task',workId:'deferred-work',ownerPage:'vocabulary',questionId:row.id,label:row.sourceName}));
  const h=await harness(data,{page:'vocabulary',view:(query,model)=>{if(query.params?.nativeMeaningReviewHidden!==false)return {model};const state=query.params?.deferredReviewOpen?'deferred':'open',items=model.reviewItems!.filter(item=>item.state===state),ids=new Set(items.map(item=>item.questionId));return {model:{...model,reviewItems:items,nativeDefinitionPreparation:{...model.nativeDefinitionPreparation!,rows:rows.filter(row=>ids.has(row.id))}},total:items.length};},onInvoke(action,payload,current){if(action==='reopen-review-item'){current.reviewItems!.find(item=>item.id===payload.id)!.state='open';current.nativeDefinitionPreparation!.deferredCount=1;}}});t.after(()=>h.ui.destroy());await h.click('Choose meanings');assert.ok(h.button('Use deferred topic 0'));assert.equal(h.button('Reopen'),undefined);h.expand('Later (2)');await settle();assert.equal(h.watches.at(-1)!.query.params?.deferredReviewOpen,true);assert.ok(h.button('Reopen'));await h.click('Reopen');assert.equal(h.watches.at(-1)!.query.params?.deferredReviewOpen,false);assert.ok(h.button('Use deferred topic 4'));assert.equal(data.reviewItems![4].state,'open');
});

test('manual undefined names have a virtual library shelf with fixed readiness and no assignment membership',async t=>{
  const data=snapshot();data.totals={papers:4,tags:4,definedTags:3,assignableTags:3,openChoices:0,history:0};data.tagShelves=[{id:'generated',name:'Generated topics',kind:'generated',tagIds:['fc','eis'],count:2},{id:'mine',name:'My tags',kind:'user',tagIds:['rcl'],count:2}];
  const h=await harness(data,{page:'vocabulary',view:(query,model)=>query.page==='vocabulary'&&query.params?.libraryTagShelfId==='my-undefined-tags'?{model:{...model,tags:[],tagLibraryEntries:[{name:'My pending laboratory tag',paperCount:2}]},total:1}:{model}});t.after(()=>h.ui.destroy());h.choose('tag-library-shelf',3);await settle();assert.equal(h.watches.at(-1)!.query.params?.libraryTagShelfId,'my-undefined-tags');assert.equal(h.watches.at(-1)!.query.params?.libraryTagStatus,'undefined');assert.equal(h.doc.getElementById('tag-library-shelf').textContent,'My tags without meanings');assert.equal(h.doc.getElementById('tag-library-status').textContent,'Needs meaning');assert.equal(h.doc.getElementById('tag-library-status').disabled,true);assert.match(h.app.textContent,/My pending laboratory tag/);assert.equal(h.all().some(node=>node.localName==='summary'&&node.textContent==='Shelf options'),false);await h.emitUpdate();assert.equal(h.watches.at(-1)!.query.params?.libraryTagShelfId,'my-undefined-tags');h.ui.navigate({page:'assignment'});await settle();h.doc.getElementById('assignment-tag-shelf').emit('click');const choices=h.doc.getElementById('assignment-tag-shelf-listbox').children;assert.equal(choices.length,3);assert.equal(choices.some((node:any)=>node.textContent==='My tags without meanings'),false);
});

test('a small completed build names its saved tags and opens only that run without another processing action',async t=>{
  const data=snapshot();data.buildResult={runId:'small-build-run',status:'completed',paperCount:2,completedPaperCount:2,savedCount:2,questionCount:0,shelfId:'build-shelf',reason:'saved',tagNames:['FC','EIS']};
  const h=await harness(data,{page:'build',view:(query,model)=>query.page==='vocabulary'&&query.params?.buildRunId==='small-build-run'?{model:{...model,tags:model.tags.filter(tag=>tag.id==='fc'||tag.id==='eis'),tagLibraryEntries:model.tags.filter(tag=>tag.id==='fc'||tag.id==='eis').map(tag=>({name:tag.name,tagId:tag.id,paperCount:1}))},total:2}:{model}});t.after(()=>h.ui.destroy());const result=h.doc.getElementById('build-result');assert.ok(result);assert.match(result.textContent,/Build complete/);assert.match(result.textContent,/2 tags saved/);assert.match(result.textContent,/2 of 2 papers read/);assert.match(result.textContent,/Saved: FC, EIS/);assert.equal(h.actions.length,0);
  await h.click('View built tags');assert.equal(h.watches.at(-1)!.query.page,'vocabulary');assert.equal(h.watches.at(-1)!.query.params?.buildRunId,'small-build-run');assert.ok(h.button('Edit tag FC'));assert.ok(h.button('Edit tag EIS'));assert.equal(h.button('Edit tag PEMFC'),undefined);assert.match(h.doc.getElementById('build-tag-filter').textContent,/2 tags saved by this build/);await h.click('Back to library');assert.equal(h.watches.at(-1)!.query.params?.buildRunId,undefined);assert.equal(h.doc.getElementById('build-tag-filter'),null);assert.ok(h.button('Edit tag PEMFC'));assert.equal(h.actions.length,0);
  h.ui.navigate({page:'build'});await settle();await h.click('View built tags');h.change('vocabulary-search','EIS');await settle();assert.equal(h.watches.at(-1)!.query.params?.buildRunId,'small-build-run');assert.equal(h.watches.at(-1)!.query.params?.vocabQuery,'EIS');assert.ok(h.doc.getElementById('build-tag-filter'));
  h.doc.getElementById('vocabulary-search').emit('keydown',{key:'Escape'});h.flushSearch();await settle();assert.equal(h.watches.at(-1)!.query.params?.buildRunId,'small-build-run');assert.equal(h.watches.at(-1)!.query.params?.vocabQuery,'');assert.ok(h.doc.getElementById('build-tag-filter'));assert.equal(h.doc.activeElement.id,'vocabulary-search');
});

test('build completion stays on Build and distinguishes reuse from missing information',async t=>{
  const data=snapshot();data.buildResult={runId:'visible-build',status:'running',paperCount:3,completedPaperCount:1,savedCount:0,questionCount:0};const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.match(h.doc.getElementById('build-result').textContent,/Building tags/);
  data.buildResult={...data.buildResult,status:'completed',completedPaperCount:3,reason:'reused'};await h.emitUpdate();assert.equal(h.doc.getElementById('nav-cleanup').getAttribute('aria-current'),'page');assert.match(h.doc.getElementById('build-result').textContent,/Build complete/);assert.match(h.doc.getElementById('build-result').textContent,/existing tags already cover this group/);assert.equal(h.button('View built tags'),undefined);assert.equal(h.actions.length,0);
  data.buildResult={...data.buildResult,status:'needs-information',reason:'needs-information',message:'The selected papers have no usable abstracts or readable text.'};await h.emitUpdate();assert.match(h.doc.getElementById('build-result').textContent,/More paper information is needed/);assert.match(h.doc.getElementById('build-result').textContent,/No tags were saved/);assert.ok(h.button('Open Activity'));assert.doesNotMatch(h.doc.getElementById('build-result').textContent,/Build complete/);assert.equal(h.actions.length,0);
});

test('an unknown earlier build stays neutral while a confirmed failure retains recovery feedback',async t=>{
  const data=snapshot();data.buildResult={runId:'older-undocumented-build',status:'unknown',paperCount:0,completedPaperCount:0,savedCount:0,questionCount:0,message:'Older builds did not store enough detail to reconstruct this result.'};const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());const summary=()=>h.doc.getElementById('build-result');assert.match(summary().textContent,/Earlier build/);assert.match(summary().textContent,/no saved outcome details/);assert.doesNotMatch(summary().textContent,/Build complete|needs another try|No new tags were needed|0 of 0 papers/);assert.equal(summary().children.some((node:any)=>node.classList.contains('warning')),false);assert.equal(h.button('Open Activity'),undefined);
  data.buildResult={...data.buildResult,status:'failed',message:'The AI connection could not complete this build.'};await h.emitUpdate();assert.match(summary().textContent,/Build needs another try/);assert.ok(h.button('Open Activity'));assert.equal(summary().children.some((node:any)=>node.classList.contains('warning')),true);assert.equal(h.actions.length,0);
});

test('a prepared full replacement still points to its explicit review before claiming tags were saved',async t=>{
  const data=snapshot();data.tagPreparation=preparation();data.buildResult={runId:'manual-replacement',status:'completed',paperCount:3,completedPaperCount:3,savedCount:0,questionCount:0};const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.match(h.doc.getElementById('build-result').textContent,/Tag list ready for review/);assert.match(h.doc.getElementById('build-result').textContent,/Review and save/);assert.doesNotMatch(h.doc.getElementById('build-result').textContent,/No new tags were needed|tags saved/);assert.ok(h.button('Apply tag list'));await h.click('Review tag list');assert.equal(h.doc.activeElement.id,'apply-tag-list');assert.equal(h.actions.length,0);
});

test('the Build page alias keeps every prepared replacement tag reachable through bounded pages',async t=>{
  const data=snapshot(),tags=Array.from({length:61},(_,index)=>tag(`replacement-${index}`,`Replacement topic ${index}`));data.tagPreparation=preparation(tags);data.buildResult={runId:'large-manual-replacement',status:'completed',paperCount:3,completedPaperCount:3,savedCount:0,questionCount:0};
  const h=await harness(data,{page:'build',view:(query,model)=>({model:{...model,tagPreparation:{...model.tagPreparation!,tags:tags.slice(Number(query.cursor),Number(query.cursor)+query.limit!)}},total:61,nextCursor:Number(query.cursor)+query.limit!<61?String(Number(query.cursor)+query.limit!):undefined})});t.after(()=>h.ui.destroy());assert.equal(h.watches.at(-1)!.query.limit,20);await h.click('Next tags');assert.equal(h.watches.at(-1)!.query.cursor,'20');assert.match(h.app.textContent,/Replacement topic 20/);await h.click('Next tags');await h.click('Next tags');assert.equal(h.watches.at(-1)!.query.cursor,'60');assert.match(h.app.textContent,/Replacement topic 60/);assert.equal(h.button('Next tags').disabled,true);assert.ok(h.button('Apply tag list'));assert.equal(h.actions.length,0);
});

test('Activity shows a native meaning choice once without hiding unrelated work with missing optional identities',async t=>{
  const data=snapshot();data.nativeDefinitionPreparation={id:'meaning-work',processingPolicy:'auto-clear',status:'ready',completed:1,total:1,canApply:false,rows:[{id:'battery',sourceName:'Batteries',paperIds:['a'],status:'question',question:'Choose the battery scope.',choices:[{id:'broad',label:'All battery chemistries',description:'A broad battery meaning.'}]}]};
  data.reviewItems=[{id:'battery-choice',kind:'definition',state:'open',taskId:'maintenance-task',workId:'meaning-work',ownerPage:'vocabulary',questionId:'battery',sourceName:'Batteries',label:'Battery scope'}];
  data.activityTasks=[{id:'meaning-activity',workId:'meaning-work',kind:'meanings',state:'needs-choice',label:'Suggest meanings',ownerPage:'vocabulary',questionCount:1}];
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  assert.ok(h.button('All battery chemistries'));assert.equal(h.button('Open meanings'),undefined);
  assert.equal(h.all().filter(node=>node.classList.contains('activity-task')).length,0);
  data.activityTasks.push({id:'unrelated-activity',kind:'meanings',state:'needs-choice',label:'Other meaning work',ownerPage:'vocabulary',questionCount:2,message:'An unrelated task still needs attention.'});
  data.reviewItems.push({id:'other-deferred-choice',kind:'definition',state:'deferred',taskId:'other-maintenance-task',ownerPage:'cleanup',label:'A different choice left for later'});await h.emitUpdate();
  const tasks=h.all().filter(node=>node.classList.contains('activity-task'));
  assert.equal(tasks.length,1);assert.match(tasks[0].textContent,/An unrelated task still needs attention/);
  assert.equal(h.all().filter(node=>node.localName==='button'&&node.textContent==='Open meanings').length,1);
  assert.ok(h.button('All battery chemistries'));assert.equal(h.actions.length,0);
});

test('Activity keeps an active paper run distinct from queued meaning work without duplicate progress',async t=>{
  const data=snapshot();data.queue={kind:'tag',ownerPage:'assignment',phase:'reading',status:'running',total:4,completed:2,failed:0,message:'Reading the current assignment group.'};data.activityTasks=[{id:'assignment',kind:'assignment',state:'running',label:'Assign tags',ownerPage:'assignment',completed:2,total:4},{id:'meanings',kind:'meanings',state:'queued',label:'Suggest meanings',ownerPage:'vocabulary',completed:0,total:3}];const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Reading the current assignment group/);assert.match(h.app.textContent,/Meanings queued/);assert.match(h.app.textContent,/0 of 3 names prepared/);assert.equal(h.all().filter(node=>node.className==='run-strip').length,0);assert.equal(h.all().filter(node=>node.textContent==='Paper analysis'&&node.localName==='h2').length,1);assert.equal(h.all().filter(node=>node.localName==='button'&&node.textContent==='Pause').length,1);assert.ok(h.button('Open meanings'));assert.equal(h.actions.length,0);
});

test('a paused current meaning task shows checked sources and resumes directly, including legacy task records',async t=>{
  for(const workId of ['current-meaning',undefined]){
    const data=snapshot();data.queue={ownerPage:'vocabulary',taskLabel:'Checking tag meanings',status:'paused',total:17,completed:0,failed:0,phaseProgress:{completed:16,total:17,label:'Sources checked'}};
    data.nativeDefinitionPreparation={id:'current-meaning',status:'paused',completed:0,total:1,canApply:false,rows:[]};
    data.activityTasks=[{id:'meaning-task',...(workId?{workId}:{}),kind:'meanings',state:'paused',label:'Suggest meanings',ownerPage:'vocabulary',completed:0,total:1}];
    const h=await harness(data,{page:'activity',onInvoke(action,_payload,current){
      if(action==='resume'||action==='pause'){
        current.queue.status=action==='resume'?'running':'paused';current.activityTasks![0].state=current.queue.status;current.nativeDefinitionPreparation!.status=current.queue.status;
      }
    }});t.after(()=>h.ui.destroy());
    assert.match(h.app.textContent,/Sources checked: 16 of 17/);assert.doesNotMatch(h.app.textContent,/Papers read: 0|0 papers read|0 of 17|0 of 1 names prepared|Paper analysis/);
    assert.equal(h.all().filter(node=>node.localName==='button'&&node.textContent==='Resume').length,1);assert.equal(h.button('Cancel remaining'),undefined);
    await h.click('Resume');assert.deepEqual(h.actions,[{action:'resume',payload:undefined}]);
    assert.equal(h.button('Resume'),undefined);assert.ok(h.button('Pause'));assert.ok(h.button('More meaning task actions'));assert.match(h.app.textContent,/Sources checked: 16 of 17/);
    await h.click('Pause');assert.deepEqual(h.actions.at(-1),{action:'pause',payload:undefined});assert.ok(h.button('Resume'));
  }
});

test('an archived paused meaning task cannot display or control another meaning task queue',async t=>{
  const data=snapshot();data.queue={ownerPage:'vocabulary',taskLabel:'Checking current meanings',status:'paused',total:17,completed:0,failed:0,phaseProgress:{completed:16,total:17,label:'Sources checked'}};
  data.nativeDefinitionPreparation={id:'current-meaning',status:'paused',completed:0,total:1,canApply:false,rows:[]};
  data.activityTasks=[{id:'archived-task',workId:'archived-meaning',kind:'meanings',state:'paused',label:'Earlier tag meanings',ownerPage:'vocabulary',completed:0,total:1}];
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/Meaning preparation paused/);assert.doesNotMatch(h.app.textContent,/Sources checked|16 of 17|Papers read|0 papers read/);
  for(const label of ['Resume','Pause','More meaning task actions','Cancel remaining'])assert.equal(h.button(label),undefined,label);
  assert.ok(h.button('Open meanings'));assert.equal(h.actions.length,0);
});

test('Activity opens the chosen assignment task instead of the latest unrelated result',async t=>{
  const data=snapshot();data.assignmentReviews=[assignmentReview('latest',{processingPolicy:'auto-clear',appliedCount:8}),assignmentReview('requested',{processingPolicy:'auto-clear',appliedCount:2})];data.assignmentReview=data.assignmentReviews[0];
  data.activityTasks=[{id:'requested-task',workId:'requested',kind:'assignment',state:'needs-choice',label:'Earlier assignment choices',ownerPage:'assignment',questionCount:1}];
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());await h.click('Open assignment');
  assert.equal(h.doc.getElementById('nav-assignment').getAttribute('aria-current'),'page');assert.equal(h.doc.getElementById('assignment-result').textContent,'Result requested');
  assert.match(h.app.textContent,/2 tag changes applied/);assert.doesNotMatch(h.app.textContent,/8 tag changes applied/);assert.equal(h.actions.length,0);
});

test('unsaved native meaning edits block only their own answers and selected batch save',async t=>{
  const data=snapshot();data.nativeDefinitionPreparation={id:'editing-ready',status:'ready',completed:2,total:2,canApply:true,rows:[{id:'edited',sourceName:'grooved CL',name:'grooved catalyst layer',description:'A catalyst layer patterned with grooves.',facet:'component',paperIds:['a'],status:'ready'},{id:'other',sourceName:'impedance',name:'EIS',description:'Electrochemical impedance spectroscopy.',facet:'method',paperIds:['b'],status:'ready'}]};const h=await harness(data,{page:'vocabulary',reviewMeanings:true});t.after(()=>h.ui.destroy());await h.click('Edit meaning for grooved CL');h.change('tag-description','An unfinished change to the groove geometry.');assert.equal(h.button('Save 2 meanings').disabled,true);assert.equal(h.button('Skip defining grooved CL').disabled,true);assert.equal(h.button('Skip defining impedance').disabled,false);assert.match(h.app.textContent,/Save or cancel your edits/);h.change('prepared-native-tag-edited',false);assert.equal(h.button('Save 1 meaning').disabled,false);await h.click('Discard changes');h.change('prepared-native-tag-edited',true);assert.equal(h.button('Save 2 meanings').disabled,false);assert.equal(h.actions.length,0);
});

test('completed meaning history never invents missing saved or undefined counts',async t=>{
  const data=snapshot();data.activityTasks=[{id:'old',kind:'meanings',state:'completed',label:'Earlier tag meanings',ownerPage:'vocabulary',message:'Earlier preparation'},{id:'known',kind:'meanings',state:'completed',label:'Saved tag meanings',ownerPage:'vocabulary',savedCount:2,leftUndefinedCount:1}];const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());h.expand('History');h.expand('Completed work');assert.match(h.app.textContent,/2 meanings saved · 1 left undefined/);assert.doesNotMatch(h.app.textContent,/0 meanings saved|0 left undefined/);assert.equal(h.button('Open meanings'),undefined);assert.equal(h.actions.length,0);
});

test('Activity keeps notices singular and all applied changes searchable beyond the first hundred',async t=>{
  const data=snapshot();data.activityTasks=[];data.warnings=[warning('one-notice')];
  data.history=Array.from({length:125},(_,index)=>({id:`change-${index}`,date:'2026-11-01',label:`Audit record ${String(index).padStart(3,'0')}`,count:1,canUndo:true}));
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  assert.equal(h.all().filter(node=>node.classList.contains('active-warning-summary')).length,0);
  assert.equal(h.all().filter(node=>node.classList.contains('warning-record')).length,1);
  assert.equal(h.doc.getElementById('activity-history').open,false);assert.equal(h.doc.getElementById('history-search'),null);
  h.expand('History');const rows=()=>h.doc.querySelector('tbody').children;
  assert.equal(rows().length,50);assert.match(rows()[0].textContent,/Audit record 000/);
  await h.click('Next changes');assert.equal(rows().length,50);assert.match(rows()[0].textContent,/Audit record 050/);
  await h.click('Next changes');assert.equal(rows().length,25);assert.match(rows().at(-1).textContent,/Audit record 124/);
  h.change('history-search','Audit record 124');assert.equal(rows().length,1);
  await h.click('Undo');assert.deepEqual(h.actions,[{action:'undo',payload:{id:'change-124'}}]);
  h.change('history-search','missing record');assert.match(h.app.textContent,/No matching changes/);assert.equal(h.button('Undo'),undefined);
  h.change('history-search','');assert.equal(rows().length,50);assert.match(rows()[0].textContent,/Audit record 000/);
});

test('Tag library opens browsing and shelf or status changes leave pending meaning review without losing it',async t=>{
  const data=snapshot();data.tagLibraryEntries=data.tags.map(tag=>({name:tag.name,tagId:tag.id,paperCount:1}));data.tagShelves=[{id:'cells',name:'Cells',kind:'generated',tagIds:['fc','pemfc'],count:2,nativeNames:data.tagLibraryEntries.slice(0,2)},{id:'methods',name:'Methods',kind:'generated',tagIds:['eis'],count:1,nativeNames:[data.tagLibraryEntries[2]]}];data.nativeDefinitionPreparation={id:'kept-work',status:'ready',completed:1,total:1,canApply:false,canContinue:true,rows:[{id:'battery',sourceName:'Batteries',paperIds:['a'],status:'question',needsContinuation:true,question:'Old question without a candidate.'}]};const before=structuredClone(data.nativeDefinitionPreparation),h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  assert.ok(h.button('Edit tag FC'));assert.ok(h.button('Review meanings'));assert.equal(h.all().some(node=>node.className.includes('native-meaning-panel')),false);await h.click('Review meanings');assert.ok(h.button('Ask AI again for Batteries'));h.choose('tag-library-shelf',2);assert.equal(h.doc.getElementById('tag-library-shelf').textContent,'Methods · 1 tags');assert.ok(h.button('Edit tag EIS'));assert.equal(h.button('Edit tag FC'),undefined);assert.equal(h.button('Ask AI again for Batteries'),undefined);await h.emitUpdate();assert.ok(h.button('Edit tag EIS'));await h.click('Review meanings');h.choose('tag-library-status',1);assert.equal(h.button('Ask AI again for Batteries'),undefined);assert.ok(h.button('Edit tag EIS'));assert.ok(h.button('Review meanings'));assert.deepEqual(data.nativeDefinitionPreparation,before);assert.equal(h.actions.length,0);
});

test('actual sidebar navigation stays available during a meaning request and cannot restore a blocking review',async t=>{
  const data=snapshot();data.nativeDefinitionPreparation={id:'pending-action',status:'ready',completed:1,total:1,canApply:false,canContinue:true,rows:[{id:'battery',sourceName:'Batteries',paperIds:['a'],status:'question',canSuggestMeaning:true,needsContinuation:true}]};let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});const h=await harness(data,{page:'vocabulary',reviewMeanings:true,onInvoke(action){if(action==='retry-proposed-tag-meaning')return pending;}});t.after(()=>{release();h.ui.destroy();});h.button('Ask AI again for Batteries').emit('click');await settle();assert.match(h.app.textContent,/Working…/);
  for(const [label,id] of [['Settings','settings'],['Build tags','cleanup'],['Activity','activity'],['Assign tags','assignment'],['Tag library','vocabulary']] as const){await h.click(label);assert.equal(h.doc.getElementById(`nav-${id}`).getAttribute('aria-current'),'page');assert.equal(h.doc.getElementById(`nav-${id}`).disabled,false);}assert.equal(h.button('Ask AI again for Batteries'),undefined);release();await settle();await settle();assert.ok(h.button('Review meanings'));assert.equal(h.actions.length,1);assert.equal(h.actions[0].action,'retry-proposed-tag-meaning');assert.equal(data.nativeDefinitionPreparation.id,'pending-action');
});

test('page navigation returns to the top while review refresh and returning to an editor preserve inner scroll and drafts',async t=>{
  const data=snapshot();data.nativeDefinitionPreparation={id:'scroll-work',status:'ready',completed:1,total:1,canApply:false,rows:[{id:'battery',tagId:'battery-tag',sourceName:'Batteries',name:'battery',description:'Battery systems.',facet:'system',paperIds:['a'],status:'question',questionKind:'meaning'}]};const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());h.win.innerWidth=850;await h.click('Review meanings');await h.click('Edit meaning for Batteries');h.change('tag-description','My unfinished broad battery meaning.');h.doc.getElementById('tag-editor-form').scrollTop=95;h.doc.getElementById('tag-list-scroll').scrollTop=125;h.win.scrollY=420;await h.emitUpdate();assert.equal(h.win.scrollY,420);assert.equal(h.doc.getElementById('tag-editor-form').scrollTop,95);assert.equal(h.doc.getElementById('tag-list-scroll').scrollTop,125);await h.click('Close editor');assert.equal(h.doc.getElementById('tag-editor-form'),null);await h.click('Settings');assert.equal(h.win.scrollY,0);await h.click('Tag library');assert.equal(h.doc.getElementById('tag-editor-form'),null);assert.ok(h.button('Edit tag FC'));await h.click('Review meanings');await h.click('Edit meaning for Batteries');assert.equal(h.doc.getElementById('tag-description').value,'My unfinished broad battery meaning.');assert.equal(h.doc.getElementById('tag-editor-form').scrollTop,95);await h.click('Back to tags');assert.equal(h.doc.getElementById('tag-editor-form'),null);await h.emitUpdate();assert.ok(h.button('Edit tag FC'));assert.ok(h.button('Review meanings'));assert.equal(h.actions.length,0);
});

test('information and protected meaning rows offer editing or leaving undefined without pretending a scope choice exists',async t=>{
  const data=snapshot();data.nativeDefinitionPreparation={id:'information-work',status:'ready',completed:2,total:2,canApply:false,canContinue:true,rows:[{id:'info',sourceName:'Reading list',paperIds:['a'],status:'question',questionKind:'information',canSuggestMeaning:false,needsContinuation:true,question:'This is an organizational label.'},{id:'protected',sourceName:'Locked topic',paperIds:['b'],status:'question',questionKind:'protection',canSuggestMeaning:false,needsContinuation:true,question:'An earlier rejection protects this choice.'}]};const h=await harness(data,{page:'vocabulary',reviewMeanings:true});t.after(()=>h.ui.destroy());assert.equal(h.button('Suggest a meaning'),undefined);assert.equal(h.button('Continue preparation'),undefined);assert.ok(h.button('Edit meaning for Reading list'));assert.ok(h.button('Skip defining Reading list'));assert.ok(h.button('Edit meaning for Locked topic'));assert.ok(h.button('Skip defining Locked topic'));assert.ok(h.button('Ask AI again for Reading list'));assert.equal(h.button('Ask AI again for Locked topic'),undefined);assert.match(h.app.textContent,/An earlier tag choice is protected/);assert.doesNotMatch(h.app.textContent,/Write the meaning|write your own|Revise that choice before matching/);assert.doesNotMatch(h.app.textContent,/Choose a scope|Choose a meaning/);assert.equal(h.actions.length,0);
});

test('automatic builds save clear definitions and leave one nonblocking meaning choice on Build',async t=>{
  const data=snapshot();data.tagPreparation={...preparation(),processingPolicy:'auto-clear',savedCount:3,shelfId:'generated',status:'questions',canApply:false,questions:[{id:'scope',title:'Battery scope',description:'Choose a useful battery scope.',paperIds:['a'],choices:[{id:'broad',label:'All battery chemistries',description:'A broad scientific meaning.'}]}]};
  data.reviewItems=[{id:'meaning-choice',kind:'definition',state:'open',taskId:'proposal',workId:'prepared',ownerPage:'cleanup',questionId:'scope',sourceName:'Battery',label:'Battery scope',message:'Choose a useful battery scope.'}];
  const h=await harness(data,{page:'cleanup',onInvoke(action,payload,current){if(action==='defer-review-item')current.reviewItems![0].state='deferred';if(action==='reopen-review-item')current.reviewItems![0].state='open';if(action==='resolve-review-item'){assert.equal(payload.id,'meaning-choice');current.reviewItems![0].state='resolved';current.tagPreparation!.questions=[];current.tagPreparation!.savedCount=4;}}});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/3 tags saved/);assert.equal(h.button('Apply tag list'),undefined);assert.equal(h.button('Finish assignment'),undefined);assert.ok(h.button('Open tag library'));assert.ok(h.button('All battery chemistries'));
  await h.click('Later');assert.equal(h.button('All battery chemistries'),undefined);assert.match(h.app.textContent,/1 left for later/);h.expand('Later (1)');await h.click('Reopen');await h.click('All battery chemistries');assert.deepEqual(h.actions,[{action:'defer-review-item',payload:{id:'meaning-choice'}},{action:'reopen-review-item',payload:{id:'meaning-choice'}},{action:'resolve-review-item',payload:{id:'meaning-choice',choiceId:'broad'}}]);assert.match(h.app.textContent,/4 tags saved/);assert.equal(h.doc.getElementById('nav-cleanup').getAttribute('aria-current'),'page');assert.equal(h.button('All battery chemistries'),undefined);assert.equal(data.settings.autoAssign,false);
});

test('automatic assignment applies supported additions without routine Apply or Finish and exposes completed topic results',async t=>{
  const data=snapshot();data.assignmentReview=assignmentReview('automatic',{processingPolicy:'auto-clear',appliedCount:1,report:{topics:[{id:'outside',name:'Outside topic',paperIds:['b']}],paperIds:['b']}});
  data.suggestions=[{id:'applied',runId:'automatic',paperId:'a',tagId:'fc',reason:'Grounded high match.',confidence:'high',status:'accepted',applied:true,evidence:[]},{id:'uncertain',runId:'automatic',paperId:'b',tagId:'eis',reason:'Needs a scientific choice.',confidence:'medium',status:'pending',evidence:[{source:'title',text:'A source passage.'}]},{id:'other',runId:'earlier',paperId:'c',tagId:'rcl',reason:'Another assignment choice.',confidence:'medium',status:'pending',evidence:[]}];
  data.reviewItems=[{id:'paper-choice',kind:'assignment',state:'open',taskId:'automatic',ownerPage:'assignment',paperId:'b',tagId:'eis',suggestionId:'uncertain',label:'Use EIS?'},{id:'other-choice',kind:'assignment',state:'open',taskId:'earlier',ownerPage:'assignment',paperId:'c',tagId:'rcl',suggestionId:'other',label:'Another assignment choice'}];
  const h=await harness(data,{page:'assignment',assignmentRunId:'automatic'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/1 tag change applied/);assert.match(h.app.textContent,/Outside topic/);assert.doesNotMatch(h.app.textContent,/Another assignment choice/);assert.equal(h.button('Apply accepted and finish'),undefined);assert.equal(h.button('Accept remaining and finish'),undefined);assert.equal(h.button('Finish assignment'),undefined);assert.equal(h.button('Apply accepted…'),undefined);
  await h.click('Add EIS');assert.deepEqual(h.actions,[{action:'resolve-review-item',payload:{id:'paper-choice',action:'accept'}}]);assert.equal(h.all().some(node=>node.getAttribute('role')==='dialog'),false);
});

test('Activity groups choices by paper and Later persists without resolving or rejecting them',async t=>{
  const data=snapshot();data.reviewItems=[{id:'first',kind:'assignment',state:'open',taskId:'run',ownerPage:'assignment',paperId:'a',suggestionId:'fc-choice',label:'FC choice'},{id:'second',kind:'assignment',state:'open',taskId:'run',ownerPage:'assignment',paperId:'a',suggestionId:'eis-choice',label:'EIS choice'}];
  data.suggestions=[{id:'fc-choice',runId:'run',paperId:'a',tagId:'fc',reason:'First scientific choice.',confidence:'medium',status:'pending',evidence:[]},{id:'eis-choice',runId:'run',paperId:'a',tagId:'eis',reason:'Second scientific choice.',confidence:'medium',status:'pending',evidence:[]}];const original=structuredClone(data.suggestions);
  const h=await harness(data,{page:'activity',onInvoke(action,payload,current){const item=current.reviewItems!.find(item=>item.id===payload.id);if(item&&action==='defer-review-item')item.state='deferred';if(item&&action==='reopen-review-item')item.state='open';}});t.after(()=>h.ui.destroy());
  assert.equal(h.all().filter(node=>node.localName==='button'&&node.textContent==='Context match').length,1);assert.match(h.app.textContent,/1 paper/);await h.click('Later');assert.equal(data.reviewItems[0].state,'deferred');assert.deepEqual(data.suggestions,original);h.expand('Later (1)');await h.click('Reopen');assert.equal(data.reviewItems[0].state,'open');assert.deepEqual(h.actions.map(item=>item.action),['defer-review-item','reopen-review-item']);assert.equal(h.all().filter(node=>node.localName==='button'&&node.textContent==='Context match').length,1);
});

test('automatic native meanings keep the library browsable and save supported entries without Save or Done',async t=>{
  const data=snapshot();data.nativeDefinitionPreparation={id:'automatic-meanings',processingPolicy:'auto-clear',status:'ready',completed:2,total:2,canApply:false,savedCount:1,rows:[{id:'saved',sourceName:'FC',paperIds:['a'],status:'ready',applied:true},{id:'battery',sourceName:'Battery',paperIds:['b'],status:'question',question:'Choose battery scope.',choices:[{id:'broad',label:'Broad battery meaning',description:'All battery chemistries.'}]}]};
  data.reviewItems=[{id:'native-choice',kind:'definition',state:'open',taskId:'maintenance-task',workId:'automatic-meanings',ownerPage:'vocabulary',questionId:'battery',sourceName:'Battery',label:'Battery meaning'}];
  const h=await harness(data,{page:'vocabulary',onInvoke(action,_payload,current){if(action==='defer-review-item')current.reviewItems![0].state='deferred';if(action==='reopen-review-item')current.reviewItems![0].state='open';}});t.after(()=>h.ui.destroy());assert.ok(h.button('Edit tag FC'));assert.match(h.app.textContent,/1 meaning saved/);assert.equal(h.button('Save 1 meaning'),undefined);assert.equal(h.button('Done'),undefined);await h.click('Choose meanings');assert.ok(h.button('Edit tag FC'));assert.ok(h.doc.getElementById('vocabulary-search'));await h.click('Later');assert.equal(h.button('Broad battery meaning'),undefined);assert.match(h.app.textContent,/1 left for later/);h.expand('Later (1)');await h.click('Reopen');await h.click('Broad battery meaning');assert.deepEqual(h.actions,[{action:'defer-review-item',payload:{id:'native-choice'}},{action:'reopen-review-item',payload:{id:'native-choice'}},{action:'resolve-review-item',payload:{id:'native-choice',choiceId:'broad'}}]);assert.equal(h.doc.getElementById('nav-vocabulary').getAttribute('aria-current'),'page');
});

test('manual Add tag needs only name and meaning outside More options',async t=>{
  const h=await harness(snapshot(),{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Add tag');const form=h.doc.getElementById('tag-editor-form');assert.deepEqual(form.children.filter((node:any)=>node.className==='field').map((node:any)=>node.children[0].textContent),['Tag name','Meaning']);h.change('tag-name','My topic');h.change('tag-description','The scientific meaning I intend.');await h.click('Save');assert.equal(h.actions[0].action,'create-detail');assert.equal(h.actions[0].payload.tag.facet,'phenomenon');assert.equal(h.actions[0].payload.tag.matchingMode,'suggest');
});

test('a native result destination opens the exact assignment instead of the latest unrelated result',async t=>{
  const data=snapshot();data.assignmentReviews=[assignmentReview('latest',{processingPolicy:'auto-clear',appliedCount:8}),assignmentReview('requested',{processingPolicy:'auto-clear',appliedCount:2})];data.assignmentReview=data.assignmentReviews[0];const h=await harness(data,{page:'assignment',assignmentRunId:'requested'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('assignment-result').textContent,'Result requested');assert.match(h.app.textContent,/2 tag changes applied/);assert.doesNotMatch(h.app.textContent,/8 tag changes applied/);assert.equal(h.actions.length,0);
});

test('opening an archived meaning restores its exact context before showing choices',async t=>{
  const data=snapshot();data.reviewItems=[{id:'archived-choice',kind:'definition',state:'open',taskId:'old-proposal',workId:'old-preparation',questionId:'old-question',ownerPage:'cleanup',label:'Archived battery meaning'}];
  const h=await harness(data,{page:'activity',onInvoke(action,payload,current){if(action==='open-review-item'){assert.equal(payload.id,'archived-choice');current.tagPreparation={...preparation(),id:'old-preparation',processingPolicy:'auto-clear',savedCount:1,questions:[{id:'old-question',title:'Battery scope',description:'Choose the archived meaning.',paperIds:['a'],choices:[{id:'broad',label:'Archived broad meaning',description:'Saved scope choice.'}]}]};return {page:'cleanup'};}}});t.after(()=>h.ui.destroy());
  await h.click('Open meaning');assert.deepEqual(h.actions,[{action:'open-review-item',payload:{id:'archived-choice'}}]);assert.equal(h.doc.getElementById('nav-cleanup').getAttribute('aria-current'),'page');assert.ok(h.button('Archived broad meaning'));
});

test('background automatic completions update counts without moving the current page',async t=>{
  const data=snapshot();data.reviewItems=[];const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());data.tagPreparation={...preparation(),processingPolicy:'auto-clear',savedCount:4};data.assignmentReview=assignmentReview('background',{processingPolicy:'auto-clear',appliedCount:3});await h.emitUpdate();assert.equal(h.doc.getElementById('nav-vocabulary').getAttribute('aria-current'),'page');assert.equal(h.doc.getElementById('start-assignment'),null);assert.doesNotMatch(h.app.textContent,/Review before applying/);assert.match(h.app.textContent,/New papers: automatic tagging off/);assert.equal(h.actions.length,0);
});

function selectedNativeMeaningSnapshot():ManagerSnapshot {
  const data=snapshot();
  data.queue={ownerPage:'vocabulary',status:'idle',total:0,completed:0,failed:0};
  data.nativeDefinitionPreparation={id:'chosen-ccs-work',processingPolicy:'auto-clear',status:'ready',completed:1,total:1,canApply:false,savedCount:0,questionCount:1,rows:[{id:'chosen-ccs-entry',reviewId:'chosen-ccs-review',sourceName:'Carbon capture and storage',name:'Carbon capture and storage',description:'Capture and geological storage of carbon dioxide.',facet:'system',paperIds:['a','b'],status:'question',questionKind:'information',question:'Your meaning is retained. One source check is uncertain.',choices:[],chosenMeaning:{name:'Carbon capture and storage',description:'Capture and geological storage of carbon dioxide.'},sourceIssues:[{paperId:'b',status:'uncertain',reason:'The supplied abstract does not establish the storage context.'}],canRecheckSources:true}]};
  data.reviewItems=[{id:'chosen-ccs-review',kind:'definition',taskId:'chosen-ccs-task',workId:'chosen-ccs-work',questionId:'chosen-ccs-entry',label:'Carbon capture and storage',sourceName:'Carbon capture and storage',ownerPage:'vocabulary',state:'open',message:'Your meaning is retained. One source check is uncertain.'}];
  data.activityTasks=[{id:'chosen-ccs-task',workId:'chosen-ccs-work',kind:'meanings',state:'needs-choice',label:'Tag meanings',ownerPage:'vocabulary',questionCount:1}];
  return data;
}

function conflictingNativeMeaningSnapshot(aliases:string[]=[]):ManagerSnapshot {
  const data=snapshot(),paperIds=Array.from({length:16},(_,index)=>`fuel-${index}`),description='Electrochemical systems that convert fuel and oxidant into electrical energy.';
  data.papers=paperIds.map((id,index)=>({id,title:`Fuel cell source ${index}`,tags:['Fuel cells']}));data.queue={ownerPage:'vocabulary',status:'idle',total:0,completed:0,failed:0};
  data.tagLibraryEntries=[{name:'Fuel cells',paperCount:16,paperIds},{name:'Unchosen topic',paperCount:1,paperIds:[paperIds[0]]}];
  data.nativeDefinitionPreparation={id:'fuel-work',processingPolicy:'auto-clear',status:'ready',completed:1,total:1,canApply:false,savedCount:0,questionCount:1,rows:[{id:'fuel-entry',reviewId:'fuel-review',tagId:'native-fuel',sourceName:'Fuel cells',name:'FC',fullName:'fuel cell',description,facet:'system',aliases:[...aliases],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],matchingMode:'suggest',paperIds,status:'question',questionKind:'meaning',question:'The papers do not all establish the same meaning for this tag. Clarify its meaning or leave it undefined.',choices:[],chosenMeaning:{name:'FC',description},sourceIssues:[{paperId:paperIds[2],status:'different',reason:'Only a keyword mentions a fuel cell; the paper studies thermochemical catalysis.'},...paperIds.slice(3).map(paperId=>({paperId,status:'unchecked' as const,reason:'This source has not been checked.'}))],canUseProposedMeaning:true,canRecheckSources:false}]};
  data.reviewItems=[{id:'fuel-review',kind:'definition',taskId:'fuel-task',workId:'fuel-work',questionId:'fuel-entry',sourceName:'Fuel cells',label:'Fuel cells',ownerPage:'vocabulary',state:'open',message:data.nativeDefinitionPreparation.rows[0].question}];
  data.activityTasks=[{id:'fuel-task',workId:'fuel-work',kind:'meanings',state:'needs-choice',label:'Tag meanings',ownerPage:'vocabulary',questionCount:1}];return data;
}

function personalNativeMeaningSnapshot():ManagerSnapshot {
  const data=snapshot();
  data.tagLibraryEntries=[{name:'Important',paperCount:2,paperIds:['a','b']},{name:'Unselected science',paperCount:1,paperIds:['c']}];
  data.nativeDefinitionPreparation={id:'personal-work',processingPolicy:'auto-clear',status:'ready',completed:1,total:1,canApply:false,rows:[{id:'important-entry',reviewId:'important-review',sourceName:'Important',name:'Important',description:'An organizational priority label.',paperIds:['a','b'],status:'question',questionKind:'personal',resolution:'personal',canSetTreatment:true,choices:[]}]};
  data.reviewItems=[{id:'important-review',kind:'definition',taskId:'personal-task',workId:'personal-work',questionId:'important-entry',sourceName:'Important',label:'Important',ownerPage:'vocabulary',state:'open'}];
  return data;
}

test('personal labels offer a recommended treatment and Keep leaves other paper tagging available',async t=>{
  const data=personalNativeMeaningSnapshot(),papers=structuredClone(data.papers),tags=structuredClone(data.tags);
  const h=await harness(data,{page:'activity',onInvoke(action,payload,current){if(action==='set-native-tag-treatment'){current.nativeTagTreatments={important:'personal'};current.nativeDefinitionPreparation!.rows[0].status='left-undefined';current.nativeDefinitionPreparation!.rows[0].personalTreatment='personal';current.reviewItems![0].state='resolved';}}});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/How should Smart Tags use this personal label/);assert.match(h.app.textContent,/Recommended: keep this label/);assert.match(h.app.textContent,/other scientific tags can still be assigned/);
  assert.ok(h.button('Keep as personal label').classList.contains('primary'));assert.ok(h.button('Ask AI for a scientific meaning'));assert.equal(h.button('Leave undefined'),undefined);assert.equal(h.button('Review draft'),undefined);assert.equal(h.button('Write meaning'),undefined);
  await h.click('Keep as personal label');assert.deepEqual(h.actions,[{action:'set-native-tag-treatment',payload:{name:'Important',treatment:'personal',id:'personal-work',entryId:'important-entry'}}]);assert.deepEqual(data.papers,papers);assert.deepEqual(data.tags,tags);assert.equal(data.settings.autoAssign,false);
  h.ui.navigate({page:'vocabulary'});assert.match(h.app.textContent,/Personal label · Automatic assignment off/);assert.equal(h.button('Add meaning for Important'),undefined);assert.equal(h.doc.getElementById('select-native-tag-Important'),null);await h.click('Select all names');await h.click('Suggest meanings');assert.deepEqual(h.actions[1].payload.names,['Unselected science']);
  h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('start-assignment').disabled,false);
});

test('personal treatment controls wait for the explicit settled-work capability',async t=>{
  for(const automatic of [true,false]){
    const data=personalNativeMeaningSnapshot();data.nativeDefinitionPreparation!.rows[0].canSetTreatment=false;if(!automatic){delete data.nativeDefinitionPreparation!.processingPolicy;delete data.reviewItems;}
    const h=await harness(data,{page:automatic?'activity':'vocabulary',reviewMeanings:!automatic});t.after(()=>h.ui.destroy());
    assert.equal(h.button('Keep as personal label').disabled,true);assert.equal(h.button('Ask AI for a scientific meaning').disabled,true);assert.match(h.app.textContent,/after the current processing finishes/);assert.equal(h.actions.length,0);
  }
});

test('a personal label can ask AI for a scientific proposal without requiring a manual definition',async t=>{
  const data=personalNativeMeaningSnapshot(),h=await harness(data,{page:'activity',onInvoke(action,_payload,current){if(action==='set-native-tag-treatment'){const work=current.nativeDefinitionPreparation!,row=work.rows[0];work.status='queued';row.status='pending';row.questionKind='information';row.resolution='needs-information';row.personalTreatment='scientific';row.description='';current.reviewItems=[];return {workId:work.id,entryId:row.id};}}});t.after(()=>h.ui.destroy());
  await h.click('Ask AI for a scientific meaning');assert.equal(h.doc.getElementById('tag-editor-form'),null);assert.deepEqual(h.actions,[{action:'set-native-tag-treatment',payload:{name:'Important',treatment:'scientific',id:'personal-work',entryId:'important-entry'}}]);assert.match(h.app.textContent,/AI is preparing a scientific meaning/);assert.equal(data.nativeDefinitionPreparation!.status,'queued');
});

test('remembered personal names use canonical preferences and can be defined without replacing another task',async t=>{
  const data=personalNativeMeaningSnapshot();data.tagLibraryEntries![0].name=' important ';data.nativeTagTreatments={important:'personal'};data.tagShelves=[{id:'my-labels',name:'My labels',kind:'user',tagIds:[],count:2,nativeNames:data.tagLibraryEntries}];data.nativeDefinitionPreparation!.rows=[];data.nativeDefinitionPreparation!.status='running';data.reviewItems=[];const original=structuredClone(data.nativeDefinitionPreparation);
  data.canPrepareNativeMeanings=false;
  const h=await harness(data,{page:'vocabulary',onInvoke(action){if(action==='set-native-tag-treatment')return {workId:'new-ai-work'};}});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Personal label · Automatic assignment off/);assert.equal(h.button('Ask AI for a scientific meaning for  important ').disabled,true);h.choose('tag-library-status',2);assert.equal(h.button('Ask AI for a scientific meaning for  important '),undefined);h.choose('tag-library-status',0);data.canPrepareNativeMeanings=true;await h.emitUpdate();await h.click('Ask AI for a scientific meaning for  important ');
  assert.deepEqual(h.actions,[{action:'set-native-tag-treatment',payload:{name:' important ',treatment:'scientific'}}]);assert.equal(h.doc.getElementById('tag-editor-form'),null);assert.deepEqual(data.nativeDefinitionPreparation,original);assert.equal(h.actions.length,1);
});

test('Assign eligibility excludes personal definitions by name, full name, or alias while keeping them browsable',async t=>{
  const data=snapshot();data.tags=[tag('one','Important'),tag('two','Priority',{fullName:'important'}),tag('three','Reading marker',{aliases:['Important']})];data.nativeTagTreatments={important:'personal'};data.tagShelves=[{id:'personal',name:'My labels',kind:'user',tagIds:data.tags.map(tag=>tag.id),count:3,nativeNames:[]}];
  const h=await harness(data,{page:'assignment'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('start-assignment').disabled,true);h.expand('For new papers · Off');assert.equal(h.doc.getElementById('assignment-auto-assign').disabled,true);assert.match(h.doc.getElementById('assignment-tag-shelf').textContent,/0 ready/);
  h.ui.navigate({page:'vocabulary'});assert.ok(h.button('Edit tag Important'));assert.ok(h.button('Edit tag Priority'));assert.ok(h.button('Edit tag Reading marker'));assert.equal(h.actions.length,0);
});

test('legacy clear meanings use a supplied batch capability and do not infer clarity from a sole option',async t=>{
  const data=personalNativeMeaningSnapshot(),work=data.nativeDefinitionPreparation!;work.rows=[{id:'clear',reviewId:'clear-review',sourceName:'Fuel cells',name:'FC',description:'Fuel cell systems.',paperIds:['a'],status:'question',questionKind:'meaning',canConfirmClear:true,choices:[{id:'clear-choice',label:'Use FC',description:'Fuel cell systems.'}]},{id:'ambiguous',reviewId:'ambiguous-review',sourceName:'AC',name:'AC measurement',description:'An unresolved expansion.',paperIds:['b'],status:'question',questionKind:'meaning',resolution:'ambiguous',canConfirmClear:false,canUseProposedMeaning:true,choices:[{id:'one-option',label:'Use AC measurement',description:'A possible interpretation.'}]}];work.clearChoiceCount=1;work.canUseClearMeanings=true;data.reviewItems=work.rows.map(row=>({id:row.reviewId!,kind:'definition',taskId:'personal-task',workId:work.id,questionId:row.id,sourceName:row.sourceName,label:row.sourceName,ownerPage:'vocabulary',state:'open'}));
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.ok(h.button('Use clear meanings'));assert.ok(h.button('Use FC'));assert.equal(h.button('Use FC').disabled,false);assert.ok(h.button('Use AC measurement'));assert.ok(h.button('Edit meaning for Fuel cells'));assert.match(h.app.textContent,/AI proposal: FC/);assert.doesNotMatch(h.app.textContent,/Meaning selected: FC/);h.ui.navigate({page:'vocabulary'});await h.click('Choose meanings');const compact=h.doc.getElementById('answer-native-meaning-clear-clear-choice');assert.equal(compact.textContent,'Use this meaning');assert.equal(compact.getAttribute('aria-label'),'Use FC');assert.equal(h.doc.getElementById('native-review-clear').textContent.split('Fuel cell systems.').length-1,1);h.ui.navigate({page:'activity'});assert.match(h.doc.getElementById('answer-native-meaning-clear-clear-choice').textContent,/Fuel cell systems/);await h.click('Use clear meanings');assert.deepEqual(h.actions,[{action:'use-clear-tag-meanings',payload:{id:'personal-work'}}]);
  work.canUseClearMeanings=false;await h.emitUpdate();assert.equal(h.button('Use clear meanings').disabled,true);work.clearChoiceCount=0;work.rows[0].canConfirmClear=false;await h.emitUpdate();assert.equal(h.button('Use clear meanings'),undefined);assert.ok(h.button('Use FC'));
});

test('an automatically selected meaning shows its origin and retains unresolved evidence without a repeated choice',async t=>{
  const data=selectedNativeMeaningSnapshot(),row=data.nativeDefinitionPreparation!.rows[0];row.selectionOrigin='automatic';row.resolution='clear';const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Meaning selected automatically: Carbon capture and storage/);assert.match(h.app.textContent,/Use this meaning or skip defining this tag/);assert.equal(h.button('Use clear meanings'),undefined);assert.equal(h.button('Use carbon capture and storage'),undefined);assert.ok(h.button('Edit meaning for Carbon capture and storage'));assert.equal(h.actions.length,0);
});

test('a supported proposal can be used without asking the researcher to review uncertain source papers',async t=>{
  const data=selectedNativeMeaningSnapshot();
  data.nativeDefinitionPreparation!.rows[0].canUseProposedMeaning=true;
  const h=await harness(data,{page:'activity',onInvoke(action,_payload,current){if(action==='use-proposed-tag-meaning'){current.nativeDefinitionPreparation!.rows[0].applied=true;current.reviewItems![0].state='resolved';current.activityTasks=[];}}});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/Meaning selected: Carbon capture and storage/);
  assert.ok(h.button('Use this meaning'));assert.ok(h.button('Skip defining Carbon capture and storage'));assert.equal(h.button('Recheck sources'),undefined);assert.equal(h.doc.getElementById('activity-recovery'),null);
  const notes=h.all().find(node=>node.localName==='details'&&node.children[0]?.textContent==='AI source notes · 1 uncertain')!;assert.ok(notes);assert.equal(notes.open,false);assert.match(notes.textContent,/You do not need to review or change the papers/);
  const description=h.all().find(node=>node.classList.contains('meaning-description'))!;assert.equal(description.textContent,data.nativeDefinitionPreparation!.rows[0].chosenMeaning!.description);assert.equal(description.parentNode.classList.contains('native-meaning-status'),true);assert.equal(notes.contains(description),false);
  assert.ok(h.button('Edit meaning').parentNode.classList.contains('native-meaning-options'));h.ui.navigate({page:'vocabulary'});await h.click('Choose meanings');assert.doesNotMatch(h.doc.getElementById('native-review-chosen-ccs-entry').textContent,/Use this meaning or skip defining this tag/);assert.ok(h.button('Use this meaning'));h.ui.navigate({page:'activity'});assert.match(h.doc.getElementById('native-review-chosen-ccs-entry').textContent,/Use this meaning or skip defining this tag/);await h.emitUpdate();assert.equal(h.actions.length,0);
  await h.click('Use this meaning');assert.deepEqual(h.actions,[{action:'use-proposed-tag-meaning',payload:{id:'chosen-ccs-work',entryId:'chosen-ccs-entry'}}]);assert.equal(h.doc.getElementById('activity-recovery'),null);assert.equal(h.button('Skip defining Carbon capture and storage'),undefined);
  assert.deepEqual(data.nativeDefinitionPreparation!.rows[0].chosenMeaning,{name:'Carbon capture and storage',description:'Capture and geological storage of carbon dioxide.'});
});

test('an unsupported AI draft offers Skip or explicit retry and never requires writing a definition',async t=>{
  for(const retry of [false,true]){
    const data=selectedNativeMeaningSnapshot(),row=data.nativeDefinitionPreparation!.rows[0];delete row.chosenMeaning;row.canUseProposedMeaning=false;row.sourceIssues=[];row.choices=[];row.resolution='needs-information';data.canPrepareNativeMeanings=true;
    const before=structuredClone(data.papers),h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.equal(h.button('Use this meaning'),undefined);assert.ok(h.button('Skip defining Carbon capture and storage'));assert.ok(h.button('Ask AI again for Carbon capture and storage'));assert.equal(h.doc.getElementById('tag-editor-form'),null);assert.doesNotMatch(h.app.textContent,/Write meaning|Review papers|write your own/);assert.equal(h.actions.length,0);
    if(retry){data.canPrepareNativeMeanings=false;await h.emitUpdate();assert.equal(h.button('Ask AI again for Carbon capture and storage').disabled,true);data.canPrepareNativeMeanings=true;await h.emitUpdate();await h.click('Ask AI again for Carbon capture and storage');assert.deepEqual(h.actions,[{action:'retry-proposed-tag-meaning',payload:{id:'chosen-ccs-work',entryId:'chosen-ccs-entry'}}]);}
    else {await h.click('Skip defining Carbon capture and storage');assert.deepEqual(h.actions,[{action:'resolve-review-item',payload:{id:'chosen-ccs-review',action:'leave'}}]);}
    assert.deepEqual(data.papers,before);assert.equal(h.doc.getElementById('tag-editor-form'),null);
  }
});

function savedMeaningConflictSnapshot():ManagerSnapshot {
  const data=selectedNativeMeaningSnapshot(),row=data.nativeDefinitionPreparation!.rows[0];
  row.sourceName='digital twin';row.name='digital twin';row.description='A detailed computational reconstruction of an electrode.';delete row.chosenMeaning;row.sourceIssues=[];row.questionKind='meaning';row.canUseProposedMeaning=false;row.canConfirmClear=false;
  row.choices=[{id:'duplicate-choice',label:'Use digital twin',description:row.description}];
  row.savedMeaningConflicts=[{id:'saved-twin',name:'digital twin',description:'A computational representation linked to the behavior of a physical system.'}];
  data.tags.push(tag('saved-twin','digital twin',{description:row.savedMeaningConflicts[0].description,nativeBindingExclusions:{a:['digital twin']}}));
  data.tagLibraryEntries=[{name:row.sourceName,paperCount:2,paperIds:row.paperIds,tagId:'saved-twin'}];
  return data;
}

test('a colliding AI proposal shows its saved meaning and closes locally from Activity or Tag library',async t=>{
  for(const page of ['activity','vocabulary'] as const){
    const data=savedMeaningConflictSnapshot(),before=structuredClone({tags:data.tags,papers:data.papers}),h=await harness(data,{page,onInvoke(action,payload,current){if(action==='resolve-review-item'&&payload.action==='leave'){current.reviewItems![0].state='resolved';current.nativeDefinitionPreparation!.rows[0].status='left-undefined';current.activityTasks=[];}}});t.after(()=>h.ui.destroy());
    if(page==='vocabulary')await h.click('Choose meanings');const row=h.doc.getElementById('native-review-chosen-ccs-entry');assert.ok(row);assert.match(row.textContent,/AI proposal: digital twin/);assert.match(row.textContent,/Saved meaning: digital twin/);assert.match(row.textContent,/A computational representation linked to the behavior of a physical system\./);
    assert.equal(h.button('Use this meaning'),undefined);assert.equal(h.button('Use digital twin'),undefined);assert.equal(h.button('Ask AI again for digital twin'),undefined);assert.ok(h.button('Keep saved meaning').classList.contains('primary'));assert.ok(h.button('Skip defining digital twin'));assert.ok(h.button('Edit meaning for digital twin'));
    const savedDescription=h.all().find(node=>node.classList.contains('meaning-description')&&node.textContent===data.nativeDefinitionPreparation!.rows[0].savedMeaningConflicts![0].description)!;assert.ok(savedDescription);assert.equal(savedDescription.parentNode.localName,'div');
    await h.click('Keep saved meaning');assert.deepEqual(h.actions,[{action:'resolve-review-item',payload:{id:'chosen-ccs-review',action:'leave'}}]);assert.match(h.app.textContent,/Saved meaning kept\. Duplicate proposal closed\./);assert.equal(h.button('Keep saved meaning'),undefined);assert.deepEqual({tags:data.tags,papers:data.papers},before);
  }
});

test('fallback meaning review preserves every saved collision and closes the duplicate without using its choices',async t=>{
  for(const automatic of [true,false]){
    const data=savedMeaningConflictSnapshot(),work=data.nativeDefinitionPreparation!,row=work.rows[0];delete data.reviewItems;if(!automatic)delete work.processingPolicy;
    row.savedMeaningConflicts!.push({id:'saved-model',name:'digital model',description:'A separate saved meaning that owns a proposed alternate name.'});
    const h=await harness(data,{page:'vocabulary',reviewMeanings:!automatic});t.after(()=>h.ui.destroy());if(automatic)await h.click('Choose meanings');assert.match(h.app.textContent,/Saved meaning: digital twin/);assert.match(h.app.textContent,/Saved meaning: digital model/);assert.equal(h.button('Use digital twin'),undefined);assert.equal(h.button('Ask AI again for digital twin'),undefined);assert.ok(h.button('Keep saved meanings'));
    await h.click('Keep saved meanings');assert.deepEqual(h.actions,[{action:'leave-tag-undefined',payload:{id:work.id,entryId:row.id}}]);assert.match(h.app.textContent,/Saved meaning kept\. Duplicate proposal closed\./);
  }
});

test('an unchosen AI proposal gives the Use or Skip instruction once',async t=>{
  const data=selectedNativeMeaningSnapshot(),row=data.nativeDefinitionPreparation!.rows[0];delete row.chosenMeaning;row.sourceIssues=[];row.canUseProposedMeaning=true;const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  const review=h.doc.getElementById('native-review-chosen-ccs-entry');assert.equal((review.textContent.match(/Use this meaning or skip defining this tag\./g)||[]).length,1);assert.doesNotMatch(review.textContent,/Use an AI proposal or skip defining this tag/);assert.ok(h.button('Use this meaning'));
});

test('Find paper filters respect per-paper native binding masks without hiding independently supported matches',async t=>{
  const data=snapshot();data.tags=[tag('fc','FC',{aliases:['fuel cells'],nativeBindingExclusions:{a:['fuel cells'],b:['FC']}}),tag('pemfc','PEMFC',{broaderIds:['fc']})];data.papers=[{id:'a',title:'Old unsupported raw label',tags:['fuel cells']},{id:'b',title:'Independent approved synonym',tags:['FC','fuel cells']},{id:'c',title:'Approved descendant',tags:['PEMFC']},{id:'d',title:'Other paper',tags:[]}];
  const h=await harness(data,{page:'library'});t.after(()=>h.ui.destroy());h.expand('Filter by tags');h.change('explore-core-fc',true);const titles=()=>h.all().filter(node=>node.classList.contains('paper-card')).map(node=>node.textContent);
  assert.equal(titles().some(title=>title.includes('Old unsupported raw label')),false);assert.equal(titles().some(title=>title.includes('Independent approved synonym')),true);assert.equal(titles().some(title=>title.includes('Approved descendant')),true);assert.match(h.app.textContent,/2 papers/);assert.equal(h.actions.length,0);
});

test('a saved scientific meaning keeps AI source notes informational in the library',async t=>{
  const data=selectedNativeMeaningSnapshot(),row=data.nativeDefinitionPreparation!.rows[0];row.applied=true;row.tagId='saved-ccs';data.tags.push(tag('saved-ccs','Carbon capture and storage',{currentlyTaggedCount:1}));data.nativeDefinitionPreparation!.savedCount=1;data.reviewItems![0].state='resolved';data.activityTasks=[];data.tagLibraryEntries=[{name:row.sourceName,paperCount:2,paperIds:row.paperIds}];
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());assert.ok(h.button('Edit tag Carbon capture and storage'));assert.match(h.app.textContent,/1 paper tagged/);assert.doesNotMatch(h.app.textContent,/2 papers tagged/);assert.equal(h.button('Skip defining Carbon capture and storage'),undefined);assert.equal(h.button('Choose meanings'),undefined);assert.doesNotMatch(h.app.textContent,/need source review|need evidence/);
  const notes=h.all().find(node=>node.localName==='details'&&node.children[0]?.textContent==='AI source notes · 1 uncertain')!;assert.ok(notes);assert.equal(notes.open,false);const summary=notes.children[0];summary.focus();notes.open=true;notes.emit('toggle');await h.emitUpdate();assert.equal(h.doc.activeElement.id,summary.id);assert.equal(h.all().find(node=>node.classList.contains('library-saved-notes'))!.open,true);h.ui.navigate({page:'activity'});assert.equal(h.doc.getElementById('activity-recovery'),null);assert.equal(h.actions.length,0);
});

test('unchanged Fuel cells Save keeps exact aliases and returns to Use or Skip without a paper-review requirement',async t=>{
  for(const [aliases,fullName] of [[[],'fuel cell'],[['Fuel cells','fuel cells'],'fuel cell'],[[],'']] as const){
    const data=conflictingNativeMeaningSnapshot([...aliases]),row=data.nativeDefinitionPreparation!.rows[0];row.fullName=fullName;row.canConfirmClear=true;data.nativeDefinitionPreparation!.clearChoiceCount=1;data.nativeDefinitionPreparation!.canUseClearMeanings=true;const before=JSON.stringify(data.nativeDefinitionPreparation);
    const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
    assert.equal(h.all().filter(node=>node.classList.contains('review-inbox')).length,1);assert.equal(h.doc.getElementById('activity-recovery'),null);assert.ok(h.button('Use this meaning'));assert.ok(h.button('Use clear meanings'));assert.equal(h.button('Use this meaning').disabled,false);assert.equal(h.doc.getElementById('native-review-fuel-entry').contains(h.button('Use this meaning')),true);
    assert.match(h.app.textContent,/1 conflicting · 13 not checked/);assert.match(h.app.textContent,/Use this meaning or skip defining this tag\. Existing paper tags stay unchanged\./);assert.doesNotMatch(h.app.textContent,/Clarify its meaning|14 source checks|need source review/);assert.equal(h.button('Recheck sources'),undefined);
    h.expand('Edit options');await h.click('Edit meaning');h.win.scrollY=240;assert.equal(h.doc.getElementById('tag-aliases').value,aliases.join('\n'));assert.equal(h.doc.getElementById('tag-full-name').value,fullName);await h.click('Save');
    assert.equal(h.doc.getElementById('nav-vocabulary').getAttribute('aria-current'),'page');assert.equal(h.win.scrollY,240);assert.equal(!!h.doc.getElementById('tag-editor-form'),false);assert.equal(h.doc.activeElement.id,'edit-native-meaning-fuel-entry');assert.equal(h.doc.getElementById('native-edit-options-fuel-entry').open,true);
    assert.equal(h.all().filter(node=>node.classList.contains('review-inbox')).length,1);assert.match(h.app.textContent,/Meaning kept\. You can use the AI proposal or skip defining this tag\./);assert.doesNotMatch(h.app.textContent,/Meaning updated\. Checking|Clarify its meaning/);assert.equal(h.doc.getElementById('leave-native-meaning-fuel-entry').disabled,false);assert.ok(h.button('Use this meaning'));
    const expected:DisplayTag={id:'native-fuel',name:'FC',fullName,description:row.description!,facet:'system',aliases:[...aliases],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],matchingMode:'suggest',custom:false,status:'approved'};
    assert.deepEqual(h.actions,[{action:'edit-tag-meaning',payload:{id:'fuel-work',entryId:'fuel-entry',tag:expected}}]);assert.equal(JSON.stringify(data.nativeDefinitionPreparation),before);
    h.ui.navigate({page:'activity'});assert.equal(h.doc.getElementById('activity-recovery'),null);assert.ok(h.button('Use this meaning'));assert.equal(h.actions.length,1);
  }
});

test('library source-review actions reuse chosen and deferred work without including it in Suggest meanings',async t=>{
  const data=conflictingNativeMeaningSnapshot(),h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  assert.ok(h.button('Choose meaning for Fuel cells'));assert.equal(h.button('Add meaning for Fuel cells'),undefined);assert.equal(h.doc.getElementById('select-native-tag-Fuel%20cells'),null);assert.match(h.app.textContent,/16 papers · Meaning selected: FC/);
  await h.click('Select all names');assert.equal(h.doc.getElementById('select-native-tag-Unchosen%20topic').checked,true);assert.match(h.app.textContent,/1 selected/);await h.click('Choose meaning for Fuel cells');
  assert.ok(h.all().find(node=>node.classList.contains('review-inbox')));assert.equal(h.doc.activeElement.id,'native-review-fuel-entry');assert.equal(h.actions.length,0);
  await h.click('Back to tags');data.reviewItems![0].state='deferred';await h.emitUpdate();await h.click('Choose meaning for Fuel cells');
  const later=h.all().find(node=>node.localName==='details'&&node.children[0]?.textContent==='Later (1)')!;
  assert.ok(later.open);assert.equal(h.doc.activeElement.id,'deferred-review-fuel-review');assert.equal(data.reviewItems![0].state,'deferred');assert.equal(h.actions.length,0);
  data.nativeDefinitionPreparation!.status='running';data.nativeDefinitionPreparation!.rows[0].status='pending';data.reviewItems=[];await h.emitUpdate();assert.equal(h.button('Choose meaning for Fuel cells'),undefined);assert.ok(h.button('View checks for Fuel cells'));assert.equal(h.button('Add meaning for Fuel cells'),undefined);await h.click('View checks for Fuel cells');assert.equal(h.doc.activeElement.id,'native-meaning-summary');assert.match(h.doc.getElementById('native-meaning-summary').textContent,/Defining tag meanings/);
  data.nativeDefinitionPreparation!.status='paused';data.nativeDefinitionPreparation!.rows[0].status='failed';await h.emitUpdate();await h.click('View paused checks for Fuel cells');assert.equal(h.doc.activeElement.id,'native-meaning-summary');assert.ok(h.doc.getElementById('native-meaning-summary').contains(h.button('Retry meanings')));assert.equal(h.actions.length,0);
});

test('library source review locates legacy pages and automatic fallback rows without another preparation',async t=>{
  for(const automatic of [false,true]){
    const data=conflictingNativeMeaningSnapshot(),work=data.nativeDefinitionPreparation!,original=work.rows[0];if(!automatic)delete work.processingPolicy;delete data.reviewItems;
    work.rows=Array.from({length:25},(_,index)=>({...structuredClone(original),id:`fallback-${index}`,reviewId:undefined,tagId:`candidate-${index}`,sourceName:`Native chosen topic ${index}`}));work.total=25;work.completed=25;
    data.tagLibraryEntries=work.rows.map(row=>({name:row.sourceName,paperCount:16,paperIds:row.paperIds}));
    const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Next tags');await h.click('Choose meaning for Native chosen topic 24');
    assert.equal(h.doc.activeElement.id,'native-review-fallback-24');assert.ok(h.doc.getElementById('native-review-fallback-24'));assert.match(h.doc.getElementById('native-review-fallback-24').textContent,/Native chosen topic 24/);assert.equal(h.actions.length,0);
    if(!automatic){assert.ok(h.doc.getElementById('edit-native-meaning-fallback-24'));assert.equal(h.doc.getElementById('edit-native-meaning-fallback-0'),null);}
  }
});

test('source-review routing leaves unchosen meanings and protected choices in the choice inbox',async t=>{
  for(const protection of [false,true]){
    const data=conflictingNativeMeaningSnapshot(),row=data.nativeDefinitionPreparation!.rows[0];if(protection){row.questionKind='protection';row.question='An earlier tag choice protects this source.';}else delete row.chosenMeaning;
    const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.equal(h.all().filter(node=>node.classList.contains('source-review-inbox')).length,0);assert.ok(h.all().find(node=>node.classList.contains('review-inbox')));assert.ok(h.button('Edit meaning'));assert.equal(h.actions.length,0);if(protection)assert.match(h.app.textContent,/An earlier tag choice protects this source/);
  }
});

test('native editor Save feedback describes the refreshed work outcome',async t=>{
  for(const [status,message] of [['queued','Linked papers are queued for checking.'],['running','Checking the linked papers.'],['ready','Meaning ready to save.'],['applied','Meaning saved to your tag library.']] as const){
    const data=conflictingNativeMeaningSnapshot(),h=await harness(data,{page:'vocabulary',onInvoke(action,_payload,current){if(action==='edit-tag-meaning'){const work=current.nativeDefinitionPreparation!,row=work.rows[0];work.status=status;row.status=status==='queued'||status==='running'?'pending':'ready';row.sourceIssues=[];row.applied=status==='applied';current.reviewItems=[];}}});t.after(()=>h.ui.destroy());
    await h.click('Choose meanings');await h.click('Edit meaning');await h.click('Save');assert.match(h.app.textContent,new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));if(status!=='running')assert.doesNotMatch(h.app.textContent,/Checking the linked papers\./);assert.equal(h.actions.length,1);assert.equal(h.actions[0].action,'edit-tag-meaning');
  }
});

test('editor Save is a form-associated submit and submits only once',async t=>{
  const h=await harness(snapshot(),{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Add tag');assert.equal(h.doc.activeElement.id,'tag-name');
  const save=h.doc.getElementById('save-tag');assert.equal(save.type,'submit');assert.equal(save.getAttribute('form'),'tag-editor-form');assert.equal(save.listeners.get('click')?.size||0,0);
  h.change('tag-name','Keyboard topic');h.change('tag-description','A topic created through the form.');h.doc.getElementById('tag-editor-form').emit('submit');await settle();
  assert.equal(h.actions.length,1);assert.equal(h.actions[0].action,'create-detail');assert.equal(h.doc.getElementById('tag-editor-form'),null);assert.equal(h.doc.activeElement.id,'add-tag');
});

test('Escape preserves an editor draft, Discard changes removes it, and keyboard save restores row focus',async t=>{
  const h=await harness(snapshot(),{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Edit tag FC');h.change('tag-description','A draft that must survive safe close.');assert.equal(h.doc.getElementById('tag-editor-status').hidden,false);
  const editor=()=>h.all().find(node=>node.classList.contains('tag-editor'))!;editor().emit('keydown',{key:'Escape',target:h.doc.getElementById('tag-description')});await settle();assert.equal(h.doc.getElementById('tag-editor-form'),null);assert.equal(h.doc.activeElement.id,'edit-tag-fc');assert.equal(h.actions.length,0);
  await h.click('Edit tag FC');assert.equal(h.doc.getElementById('tag-description').value,'A draft that must survive safe close.');await h.click('Discard changes');await h.click('Edit tag FC');assert.equal(h.doc.getElementById('tag-description').value,'Definition of FC');assert.equal(h.doc.getElementById('tag-editor-status').hidden,true);
  h.change('tag-description','A meaning saved with a keyboard shortcut.');editor().emit('keydown',{key:'Enter',ctrlKey:true,target:h.doc.getElementById('tag-description')});await settle();assert.equal(h.actions.length,1);assert.equal(h.actions[0].action,'save-tag');assert.equal(h.doc.getElementById('tag-editor-form'),null);assert.equal(h.doc.activeElement.id,'edit-tag-fc');
  await h.click('Edit tag FC');h.change('tag-description','A second keyboard revision.');editor().emit('keydown',{key:'Enter',metaKey:true,target:h.doc.getElementById('tag-description')});await settle();assert.equal(h.actions.length,2);assert.equal(h.actions[1].action,'save-tag');
});

test('Assign opens an unfinished result once and keeps an explicit new-assignment choice across updates',async t=>{
  const data=snapshot();data.assignmentReviews=[assignmentReview('finished',{status:'finished',processingPolicy:'auto-clear'}),assignmentReview('active',{status:'paused',processingPolicy:'auto-clear',appliedCount:2})];data.assignmentReview=data.assignmentReviews[0];data.workflow={buildMode:'extend',buildScope:'selected',buildPaperCount:4,assignmentScope:'collections',assignmentPaperCount:2,assignedPaperCount:1};
  const h=await harness(data,{page:'assignment'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('assignment-result').textContent,'Result active');assert.equal(h.doc.getElementById('start-assignment'),null);assert.ok(h.doc.getElementById('assignment-setup-toggle'));
  await h.click('Assignment setup');assert.equal(h.doc.getElementById('assignment-scope').textContent,'Selected collections');data.assignmentReviews.unshift(assignmentReview('newer',{processingPolicy:'auto-clear'}));await h.emitUpdate();assert.ok(h.doc.getElementById('start-assignment'));assert.equal(h.doc.getElementById('assignment-scope').textContent,'Selected collections');assert.equal(h.actions.length,0);
});

test('an assignment arriving after manager startup becomes the default on first Assign entry',async t=>{
  const data=snapshot();const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());data.assignmentReview=assignmentReview('incoming',{processingPolicy:'auto-clear',appliedCount:2});await h.emitUpdate();assert.equal(h.doc.getElementById('nav-vocabulary').getAttribute('aria-current'),'page');h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-result').textContent,'Result incoming');assert.equal(h.doc.getElementById('start-assignment'),null);assert.equal(h.actions.length,0);
});

test('connection uses one model control and Save and test saves before one test request',async t=>{
  const data=snapshot();const h=await harness(data,{page:'connection'});t.after(()=>h.ui.destroy());assert.ok(h.doc.getElementById('settings-discovered-model'));assert.equal(h.doc.getElementById('settings-model'),null);assert.equal(h.button('Save settings'),undefined);
  h.choose('settings-discovered-model',1);assert.equal(h.doc.getElementById('settings-discovered-model'),null);assert.ok(h.doc.getElementById('settings-model'));h.change('settings-model','custom-model-id');assert.ok(h.button('Save and test'));assert.ok(h.button('Save settings').classList.contains('quiet'));
  await h.click('Save and test');assert.deepEqual(h.actions.map(action=>action.action),['save-settings','test-connection']);assert.equal(h.actions[0].payload.settings.model,'custom-model-id');assert.ok(h.button('Test connection'));assert.equal(h.button('Save and test'),undefined);await h.click('Test connection');assert.deepEqual(h.actions.map(action=>action.action),['save-settings','test-connection','test-connection']);
  await h.click('Choose discovered model');assert.ok(h.doc.getElementById('settings-discovered-model'));assert.equal(h.doc.getElementById('settings-model'),null);
});

test('ChatGPT connection hides API pricing controls while API connections retain their budget and rates',async t=>{
  const data=snapshot();data.settings.provider='chatgpt';data.connection.chatgptSignedIn=true;const h=await harness(data,{page:'connection'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('settings-budgetUSD'),null);assert.equal(h.doc.getElementById('settings-inputPricePerMillion'),null);assert.ok(h.button('Continue with ChatGPT'));
  h.choose('settings-provider',1);assert.ok(h.doc.getElementById('settings-budgetUSD'));assert.ok(h.doc.getElementById('settings-inputPricePerMillion'));assert.ok(h.doc.getElementById('settings-outputPricePerMillion'));assert.equal(h.actions.length,0);
});

test('task Undo targets its supplied journal even when an unrelated change is newer',async t=>{
  for(const kind of ['build','assignment','native'] as const){
    const data=snapshot();data.history=[{id:'newer-unrelated',date:'2026-11-01',label:'Another task',count:1,canUndo:true},{id:'own-change',date:'2026-11-01',label:'This task',count:1,canUndo:true}];
    if(kind==='build')data.tagPreparation={...preparation(),processingPolicy:'auto-clear',savedCount:2,lastChangeId:'own-change'};
    if(kind==='assignment')data.assignmentReview=assignmentReview('own-run',{processingPolicy:'auto-clear',appliedCount:1,lastChangeId:'own-change'});
    if(kind==='native')data.nativeDefinitionPreparation={id:'own-native',processingPolicy:'auto-clear',status:'finished',completed:1,total:1,canApply:false,savedCount:1,lastChangeId:'own-change',rows:[]};
    const h=await harness(data,{page:kind==='build'?'cleanup':kind==='native'?'vocabulary':'assignment',onInvoke(action,payload,current){if(action==='undo')current.history.find(change=>change.id===payload.id)!.canUndo=false;}});t.after(()=>h.ui.destroy());const id=kind==='build'?'undo-build-change':kind==='native'?'undo-native-meaning-change':'undo-assignment-change';assert.ok(h.doc.getElementById(id));await h.click('Undo last change');assert.deepEqual(h.actions,[{action:'undo',payload:{id:'own-change'}}]);assert.equal(h.doc.getElementById(id),null);assert.equal(data.history[0].canUndo,true);
  }
});


test('library search keeps shelf totals stable, gives useful empty results and supports guarded keyboard shortcuts',async t=>{
  const data=snapshot();data.tagLibraryEntries=data.tags.map(tag=>({name:tag.name,tagId:tag.id,paperCount:1}));
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());const overview=()=>h.all().find(node=>node.classList.contains('library-overview'))!;
  assert.equal(overview().textContent,'4 tagsAdd tag');assert.equal(overview().parentNode.classList.contains('library-page-header'),true);assert.ok(overview().parentNode.children.some(node=>node.localName==='h1'&&node.textContent==='Tag library'));assert.equal(h.all().some(node=>node.localName==='h2'&&node.textContent==='Your tags'),false);assert.equal(h.doc.getElementById('vocabulary-search').getAttribute('aria-label'),'Search tags');
  h.win.emit('keydown',{key:'/'});assert.equal(h.doc.activeElement.id,'vocabulary-search');h.change('vocabulary-search','missing scientific name');assert.match(h.app.textContent,/No matching tags/);assert.equal(overview().textContent,'4 tagsAdd tag');assert.equal(h.all().filter(node=>node.className==='library-result-count')[0].textContent,'0 matching tags');
  h.doc.getElementById('vocabulary-search').emit('keydown',{key:'Escape'});assert.equal(h.doc.getElementById('vocabulary-search').value,'');assert.equal(h.doc.activeElement.id,'vocabulary-search');assert.equal(h.button('Clear tag search'),undefined);
  await h.click('Edit tag FC');const active=h.doc.activeElement;h.win.emit('keydown',{key:'/'});assert.equal(h.doc.activeElement,active);assert.equal(h.actions.length,0);h.ui.destroy();assert.equal(h.win.listeners.get('keydown')?.size,0);
});

test('linked paper disclosures preserve the selected row and stay optional across library refreshes',async t=>{
  const data=snapshot();data.tagLibraryEntries=[{name:'First native name',paperCount:1,paperIds:['a']},{name:'Second native name',paperCount:1,paperIds:['b']}];
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());const panels=()=>h.all().filter(node=>node.classList.contains('library-source-papers'));
  assert.equal(panels().length,2);assert.ok(panels().every(panel=>panel.open===false));assert.notEqual(panels()[0].children[0].id,panels()[1].children[0].id);
  const second=panels()[1].children[0];second.focus();second.emit('click');await settle();assert.equal(panels()[1].open,true);assert.equal(h.doc.activeElement.id,second.id);assert.match(panels()[1].textContent,/Detail elsewhere/);assert.equal(panels()[0].open,false);
  await h.emitUpdate();assert.equal(panels()[1].open,true);assert.equal(h.doc.activeElement.id,second.id);assert.equal(h.actions.length,0);
});
