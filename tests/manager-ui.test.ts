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
    papers:[{id:'a',title:'Context match',tags:['RCL','PEMFC'],matchedTagIds:['rcl','pemfc']},{id:'b',title:'Detail elsewhere',tags:['RCL','Water electrolysis'],matchedTagIds:['rcl']},{id:'c',title:'Method only',tags:['EIS'],matchedTagIds:['eis']},{id:'d',title:'Fuel cell only',tags:['PEMFC'],matchedTagIds:['pemfc']}],suggestions:[],cleanup:[],history:[],neighbors:{},queue:{status:'idle',total:0,completed:0,failed:0},settings:{provider:'api',model:'openai-model',autoAssign:false,budgetUSD:5,inputPricePerMillion:0,outputPricePerMillion:0,maxOutputTokens:512,coreConceptLimit:60},models:['openai-model'],connection:{apiKeyStored:true,deepseekKeyStored:false,chatgptSignedIn:false}};
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
  receiptRunId?: string;
  view?: (query:ViewQuery,model:ManagerSnapshot)=>Pick<ViewEvent,'model'|'total'|'nextCursor'>;
}
async function harness(data=snapshot(),options:HarnessOptions={}) {
  const {failAction,emitOnInvoke=0,onSnapshot,onInvoke,reviewMeanings=false,manualSearchTimers=false,nativeSVG=false,receiptRunId,view,...uiOptions}=options;
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
    async execute(command:any,{commandId}:{commandId:string}){commandIds.push(commandId);const before=emits,result=await legacy.invoke(command.type,command.payload);revision++;if(emits===before)emit();return {commandId,revision,result,...(receiptRunId?{runId:receiptRunId}:{})};},
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

test('a stopped unknown request allows a fresh attempt without claiming the stopped work resumed',async t=>{
  const data=snapshot();data.recoveryRequests=[{id:'stopped-scope',status:'stopped',message:'This attempt was stopped. Its original result is unknown.'}];const h=await harness(data,{page:'activity',onInvoke(action){if(action==='retry-unknown-request')return {authorized:true,startNewRun:true};}});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/may already have charged/);assert.equal(h.button('Stop this attempt'),undefined);assert.equal(h.button('Retry request'),undefined);assert.equal(h.actions.length,0);await h.click('Allow a new attempt');assert.deepEqual(h.actions,[{action:'retry-unknown-request',payload:{id:'stopped-scope'}}]);assert.match(h.app.textContent,/Retry allowed\. Start a new build or assignment\./);assert.doesNotMatch(h.app.textContent,/Resuming saved work/);
});

test('request recovery distinguishes a current resume from authorization for a separate new run',async t=>{
  for(const startNewRun of [true,false]){
    const data=snapshot();data.recoveryRequests=[{id:'scope',status:'unknown',message:'The original result is unknown.'}];const h=await harness(data,{page:'activity',onInvoke(action){if(action==='retry-unknown-request')return {authorized:true,startNewRun};}});t.after(()=>h.ui.destroy());await h.click('Retry request');assert.match(h.app.textContent,startNewRun?/Retry allowed\. Start a new build or assignment\./:/Retry authorized\. Resuming saved work\./);assert.deepEqual(h.actions,[{action:'retry-unknown-request',payload:{id:'scope'}}]);
  }
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
  assert.equal(h.doc.getElementById('start-assignment').disabled,false);assert.match(h.doc.getElementById('assignment-tag-mode').textContent,/All enabled tags \(1700\)/);
  h.expand('For new papers · Off');assert.equal(h.doc.getElementById('assignment-auto-assign').disabled,false);
});

test('Workspace patching supports Zotero SVG elements with getter-only animated class names',async t=>{
  const h=await harness(snapshot(),{page:'vocabulary',nativeSVG:true});t.after(()=>h.ui.destroy());const svg=h.doc.querySelector('svg'),shell=h.doc.getElementById('smart-tags-shell');
  assert.equal(typeof svg.className,'object');await h.emitUpdate();assert.equal(h.app.getAttribute('data-smart-tags-state'),'ready');assert.equal(h.doc.getElementById('smart-tags-shell'),shell);assert.equal(h.doc.querySelector('svg'),svg);assert.ok(h.button('Edit tag FC'));
});

test('interrupted AI requests have explicit retry and stop actions without paper review',async t=>{
  const data=snapshot();data.recoveryRequests=[{id:'paid-unknown',provider:'api',model:'test-model',status:'unknown',message:'The request may have reached the provider.'}];
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.ok(h.doc.getElementById('activity-recovery'));assert.match(h.doc.getElementById('activity-recovery').textContent,/Retry request/);assert.match(h.app.textContent,/may already have charged/);assert.equal(h.button('Resume'),undefined);
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

test('the sidebar combines building and review in three open workflow steps and keeps library tools separate',async t=>{
  const data=snapshot();data.connection.apiKeyStored=false;const h=await harness(data);t.after(()=>h.ui.destroy());
  const sidebar=h.all().find(node=>node.localName==='aside')!;const workflow=sidebar.children.find(node=>node.textContent.startsWith('Workflow'))!;
  assert.deepEqual(workflow.querySelectorAll('button').map(node=>node.getAttribute('aria-label')),['Build tags','Tag library','Assign tags']);assert.equal(sidebar.querySelectorAll('button').length,6);
  for(const page of ['connection','build','cleanup','assignment','vocabulary','library','activity','settings'] as const){h.ui.navigate({page});assert.equal(h.app.getAttribute('data-smart-tags-state'),'ready');assert.ok(h.doc.getElementById(`nav-${page==='build'?'cleanup':page==='connection'?'settings':page}`).getAttribute('aria-current'));}
  h.ui.navigate({page:'cleanup'});assert.equal(h.button('Clean up existing tags'),undefined);assert.equal(h.button('Existing tags'),undefined);assert.ok(h.doc.getElementById('build-scope'));
});

test('the first build defaults to a pilot while assignment independently defaults to the library',async t=>{
  const data=snapshot();data.taxonomyReady=false;data.workflow={buildMode:'extend',buildScope:'pilot',buildPaperCount:0,assignmentScope:'library',assignmentPaperCount:0,assignedPaperCount:0};const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('build-scope').textContent,'Pilot · 50 papers');assert.equal(h.doc.getElementById('build-mode'),null);assert.match(h.app.textContent,/Create your first tag list/);assert.doesNotMatch(h.app.textContent,/Extend my saved tag list|Replace the full tag list/);
  h.choose('build-scope',2);h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-scope').textContent,'Whole personal library');h.choose('assignment-scope',1);await h.emitUpdate();h.ui.navigate({page:'build'});assert.equal(h.doc.getElementById('build-scope').textContent,'Selected collections');await h.click('Build tags from these papers');assert.deepEqual(h.actions[0],{action:'prepare-tags',payload:{scope:'collections',mode:'extend',processingPolicy:'auto-clear'}});
  h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-scope').textContent,'Selected papers in Zotero');await h.click('Assign tags to these papers');assert.deepEqual(h.actions[1],{action:'tag',payload:{scope:'selected',processingPolicy:'auto-clear'}});assert.match(h.app.textContent,/No assignment results yet|Paper matches|Preparing paper suggestions/);
});

test('saved workflow groups restore independently while Extend is the next build default',async t=>{
  const data=snapshot();data.workflow={buildMode:'replace',buildScope:'collections',buildPaperCount:51,assignmentScope:'selected',assignmentPaperCount:12,assignedPaperCount:4};const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('build-mode'),null);h.expand('More options');assert.equal(h.doc.getElementById('build-mode').textContent,'Extend my saved tag list');assert.equal(h.doc.getElementById('build-scope').textContent,'Selected collections');
  h.choose('build-scope',1);data.workflow.buildScope='library';await h.emitUpdate();assert.equal(h.doc.getElementById('build-scope').textContent,'Selected papers in Zotero');h.choose('build-mode',1);assert.match(h.app.textContent,/Build a replacement for the full saved tag list/);assert.equal(h.actions.length,0);
  h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-scope').textContent,'Selected papers in Zotero');assert.match(h.app.textContent,/12 papers in the last chosen group · 4 with Smart Tags assignments/);assert.doesNotMatch(h.app.textContent,/library tagged|library complete/);
});

test('assignment runs only on request and a pilot remains an optional paper group',async t=>{
  const h=await harness(snapshot(),{page:'assignment'});t.after(()=>h.ui.destroy());assert.equal(h.actions.length,0);await h.click('Assign tags to these papers');assert.deepEqual(h.actions,[{action:'tag',payload:{scope:'library',processingPolicy:'auto-clear'}}]);h.data.queue.status='idle';await h.emitUpdate();await h.click('Assignment setup');h.choose('assignment-scope',0);await h.click('Assign tags to these papers');assert.deepEqual(h.actions.at(-1),{action:'tag',payload:{scope:'pilot',processingPolicy:'auto-clear'}});h.data.queue.status='idle';await h.emitUpdate();await h.click('Assignment setup');assert.equal(h.doc.getElementById('assignment-scope').textContent,'Pilot · 50 papers');
});

test('incoming assignment is an explicit immediate switch without a mandatory pilot',async t=>{
  const data=snapshot();data.pilotReviewed=false;data.workflow={buildMode:'extend',buildScope:'selected',buildPaperCount:51,assignmentScope:'library',assignmentPaperCount:0,assignedPaperCount:0,assignmentPilotReady:false};const h=await harness(data,{page:'assignment'});t.after(()=>h.ui.destroy());h.expand('For new papers · Off');assert.equal(h.doc.getElementById('assignment-auto-assign').disabled,false);assert.equal(h.button('Mark pilot reviewed'),undefined);assert.equal(h.actions.length,0);
  h.expand(`For new papers · ${data.settings.autoAssign?'On':'Off'}`);h.change('assignment-auto-assign',true);await settle();assert.equal(data.settings.autoAssign,true);assert.deepEqual(h.actions,[{action:'save-settings',payload:{settings:{...data.settings,autoAssign:true}}}]);h.ui.navigate({page:'library'});h.ui.navigate({page:'assignment'});assert.equal(h.doc.getElementById('assignment-auto-assign').checked,true);assert.equal(h.button('Save routine assignment'),undefined);
});

test('routine saves and unfinished connection edits cannot silently overwrite each other',async t=>{
  const data=snapshot();const h=await harness(data,{page:'connection'});t.after(()=>h.ui.destroy());h.choose('settings-provider',2);h.change('settings-model','deepseek-test-model');h.ui.navigate({page:'assignment'});h.expand(`For new papers · ${data.settings.autoAssign?'On':'Off'}`);h.change('assignment-auto-assign',true);await settle();assert.equal(h.actions[0].payload.settings.provider,'api');assert.equal(h.actions[0].payload.settings.model,'openai-model');assert.equal(data.settings.autoAssign,true);
  h.ui.navigate({page:'connection'});assert.equal(h.doc.getElementById('settings-model').value,'deepseek-test-model');await h.click('Save settings');assert.equal(h.actions[1].payload.settings.provider,'deepseek');assert.equal(h.actions[1].payload.settings.autoAssign,true);assert.equal(data.settings.autoAssign,true);
});

test('compact attention notices retain all records, affected-paper links and dismissal history',async t=>{
  const data=snapshot();data.warnings=Array.from({length:27},(_,i)=>warning(`w${i}`));const h=await harness(data);t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/27 notices to check/);assert.equal(h.all().filter(node=>node.classList.contains('warning-record')).length,0);assert.equal(h.app.textContent.includes('fact-extraction'),false);
  await h.click('View details');h.expand('Notices (27)');assert.equal(h.all().filter(node=>node.classList.contains('warning-record')).length,27);await h.click('Context match');assert.deepEqual(h.actions[0],{action:'show-paper',payload:{id:'a'}});
  await h.click('Dismiss');assert.equal(data.warnings[0].status,'dismissed');await h.click('Dismiss all');assert.equal(data.warnings.length,27);assert.equal(data.warnings.every(w=>w.status==='dismissed'),true);
});

test('authentication and budget notices use helpful language without raw response codes',async t=>{
  const data=snapshot();data.warnings=[warning('auth',{message:'OpenAI HTTP 401 authentication failed'})];const h=await harness(data);t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/check your connection in Connect AI/);assert.doesNotMatch(h.app.textContent,/401|fact-extraction/);
  data.warnings=[warning('budget',{message:'The next request exceeds the budget'})];await h.emitUpdate();assert.match(h.app.textContent,/usage or spending limit/);assert.match(h.app.textContent,/Check Connect AI before continuing/);
});

test('private analysis export stays in Settings without promoting old cleanup tools',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());assert.equal(h.button('Export analysis with paper text…'),undefined);
  h.ui.navigate({page:'settings'});h.expand('Export and previous builds');await h.click('Export analysis with paper text…');assert.deepEqual(h.actions,[{action:'export-tag-analysis',payload:{id:'prepared'}}]);assert.equal(h.button('Manage existing tags'),undefined);assert.equal(h.doc.getElementById('nav-existing-tags'),null);
});

test('successful messages expire after four seconds through the same notification lifecycle',async t=>{
  const data=snapshot();data.tagPreparation=preparation();const h=await harness(data,{page:'cleanup'});t.after(()=>h.ui.destroy());await h.click('Remove tag FC');assert.match(h.app.textContent,/Tag removed from the active list/);
  const timer=[...h.timerDelays].find(([,delay])=>delay===4000)!;assert.ok(timer);const callback=h.timers.get(timer[0])!;h.timers.delete(timer[0]);h.timerDelays.delete(timer[0]);callback();assert.equal(h.app.textContent.includes('Tag removed from the active list.'),false);
});

test('editor CSS keeps a scroll body and visible footer, with a viewport drawer',async()=>{
  const css=await readFile('addon/content/manager.css','utf8');assert.match(css,/\.tag-editor\s*\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);assert.match(css,/\.editor-scroll\s*\{[^}]*overflow:auto/);assert.match(css,/@media \(max-width:900px\), \(max-height:600px\)/);assert.match(css,/\.tag-editor\.editor-drawer\s*\{[^}]*position:fixed/);
});

test('Explore Any keeps detail contexts together in a saved search',async t=>{
  const h=await harness(snapshot(),{page:'library'});t.after(()=>h.ui.destroy());h.expand('Filter by tags');h.change('explore-detail-rcl-fc-fc',true);h.change('explore-core-eis',true);h.choose('concept-filter-mode',1);
  assert.deepEqual(h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent),['Context match','Method only']);await h.click('Save filter…');await h.click('Save filter');assert.deepEqual(h.actions[0].payload.filter,{mode:'any',selections:[{conceptId:'rcl',contextId:'fc'},{conceptId:'eis'}]});
});

test('Explore search respects full names and Co/CO distinctions',async t=>{
  const data=snapshot();data.tags.push(tag('co','Co',{facet:'component'}),tag('CO','CO',{facet:'component'}));data.papers.push({id:'cobalt',title:'Cobalt paper',tags:['Co'],matchedTagIds:['co']},{id:'monoxide',title:'Carbon monoxide paper',tags:['CO'],matchedTagIds:['CO']});const h=await harness(data,{page:'library'});t.after(()=>h.ui.destroy());h.expand('Filter by tags');h.change('concept-search','catalyst-layer resistance');assert.ok(h.doc.getElementById('explore-detail-rcl-fc-fc'));h.change('concept-search','');h.change('explore-core-co',true);assert.deepEqual(h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent),['Cobalt paper']);
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
  assert.equal(h.button('Save filter…'),undefined);assert.equal(h.actions.length,0);
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

test('paper attention deduplicates papers and keeps usable evidence gaps out of global notices',async t=>{
  const data=snapshot();const paper={id:'a',title:'Needs abstract',status:'needsInformation' as const,message:'Add information before trying again.',phase:'facts',canLookupMetadata:true,canRecheck:true,canRetry:true,canSkip:true};
  data.papers[0].title=paper.title;data.papers[1].title='Ready paper';
  data.paperAttention={queued:1,papers:[paper,{...paper}, {...paper,id:'b',title:'Ready paper',status:'usable'}]};data.warnings=[warning('gap',{code:'evidence-gap',message:'Raw evidence gap message'})];
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.equal(h.all().filter(node=>node.className==='paper-attention-row').length,1);assert.doesNotMatch(h.app.textContent,/Raw evidence gap message|fact-extraction/);
  await h.click('Needs abstract');await h.click('Find metadata');await h.click('More actions for Needs abstract');await h.click('Recheck PDF');await h.click('More actions for Needs abstract');await h.click('Skip for this build');h.change('attention-a',true);await h.click('Retry selected');
  assert.deepEqual(h.actions,[{action:'show-paper',payload:{id:'a'}},{action:'preview-metadata',payload:{id:'a'}},{action:'recheck-paper-inputs',payload:{id:'a'}},{action:'skip-paper-analysis',payload:{ids:['a']}},{action:'retry-papers',payload:{ids:['a']}}]);
  h.choose('attention-status',2);assert.equal(h.all().filter(node=>node.className==='paper-attention-row').length,1);assert.match(h.app.textContent,/Ready paper/);
});

test('metadata recovery shows before/after values and applies only the reviewed preview',async t=>{
  const data=snapshot();data.metadataPreview={id:'metadata-review',paperId:'a',itemID:1,status:'ready',message:'One missing field was found.',changes:[{field:'abstractNote',before:'',after:'Recovered abstract.'}]};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/Before: Empty/);assert.match(h.app.textContent,/After: Recovered abstract/);assert.match(h.app.textContent,/Only empty fields are filled/);assert.equal(h.actions.length,0);
  h.change('metadata-identifier','10.1000/example');await h.click('Find with identifier');assert.deepEqual(h.actions[0],{action:'preview-metadata',payload:{id:'a',identifier:'10.1000/example'}});
  await h.click('Apply metadata');assert.deepEqual(h.actions[1],{action:'apply-metadata',payload:{previewId:'metadata-review'}});
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
  const data=snapshot();data.tags.push(tag('smart-tags:no-tag','no_tag',{builtin:'no_tag',custom:true,matchingMode:'manual'}));data.papers[0].tags!.push('no_tag');data.papers[0].matchedTagIds!.push('smart-tags:no-tag');const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());assert.equal(h.button('Edit tag no_tag'),undefined);assert.equal(h.button('Remove tag no_tag'),undefined);assert.equal(h.all().filter(node=>node.localName==='article'&&node.classList.contains('tag-row')).length,4);
  h.ui.navigate({page:'overview'});assert.doesNotMatch(h.app.textContent,/your topics|DIY|core vocabulary/);h.ui.navigate({page:'library'});h.expand('Filter by tags');assert.ok(h.doc.getElementById('explore-builtin-no-tag'));h.change('explore-builtin-no-tag',true);assert.deepEqual(h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent),['Context match']);
});

test('suggested no_tag remains a reviewed paper change with a clear future-exclusion label',async t=>{
  const data=snapshot();data.tags.push(tag('smart-tags:no-tag','no_tag',{builtin:'no_tag',custom:true,matchingMode:'manual'}));data.suggestions=[{id:'unmatched',paperId:'a',tagId:'smart-tags:no-tag',reason:'The completed analysis found no supported match.',confidence:'high',status:'accepted',evidence:[]}];
  const h=await harness(data,{page:'review'});t.after(()=>h.ui.destroy());assert.equal(h.actions.length,0);h.expand('Details');h.choose('review-filter',1);assert.match(h.app.textContent,/Exclude from tagging/);assert.doesNotMatch(h.app.textContent,/No supporting passage is available/);h.expand('Details');await h.click('Apply accepted…');assert.match(h.app.textContent,/Applying no_tag excludes the affected papers from future tagging/);assert.equal(h.actions.length,0);await h.click('Apply 1 tag changes');assert.deepEqual(h.actions,[{action:'apply-suggestions',payload:{ids:['unmatched']}}]);
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

test('old topic notices remain in history without active warning banners',async t=>{
  const data=snapshot();data.warnings=[warning('topic',{code:'unapproved-topics',message:'Earlier unmatched topic names.'})];const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.equal(h.all().some(node=>node.classList.contains('active-warning-summary')),false);h.expand('Recent changes and Undo');assert.match(h.app.textContent,/Earlier notice/);assert.match(h.app.textContent,/Earlier unmatched topic names/);assert.equal(h.actions.length,0);
});

test('routine matches finish through one exact preview without other runs, rejected matches, or exclusions',async t=>{
  const data=snapshot();data.assignmentReview=assignmentReview('run',{acceptedIds:['high'],highAccepted:1,bulkAcceptCount:1,bulkAcceptIds:['medium'],needsChoiceCount:0});data.suggestions=[{id:'high',runId:'run',paperId:'a',tagId:'fc',reason:'Supported.',confidence:'high',status:'accepted',evidence:[]},{id:'medium',runId:'run',paperId:'b',tagId:'eis',reason:'Supported routine match.',confidence:'medium',status:'pending',evidence:[]},{id:'low',runId:'run',paperId:'c',tagId:'fc',reason:'Weak.',confidence:'low',status:'rejected',evidence:[]},{id:'other',runId:'other',paperId:'d',tagId:'fc',reason:'Earlier.',confidence:'high',status:'accepted',evidence:[]}];const native=structuredClone(data.papers);
  const h=await harness(data,{page:'review'});t.after(()=>h.ui.destroy());assert.equal(h.button('Accept'),undefined);assert.equal(h.button('Apply accepted…'),undefined);await h.click('Accept remaining and finish');assert.equal(h.actions.length,0);assert.match(h.app.textContent,/Detail elsewhere/);assert.doesNotMatch(h.app.textContent,/Fuel cell only/);assert.equal(h.all().filter(node=>node.localName==='tbody')[0].children.length,2);await h.click('Apply and finish');assert.deepEqual(h.actions,[{action:'finish-assignment',payload:{runId:'run',acceptRemaining:true}}]);assert.deepEqual(data.papers,native);
});

test('only consequential assignment choices remain visible while routine matches can be accepted together',async t=>{
  const data=snapshot();data.assignmentReview=assignmentReview('run',{needsReview:2,bulkAcceptCount:1,bulkAcceptIds:['routine'],needsChoiceCount:1});data.suggestions=[{id:'routine',runId:'run',paperId:'a',tagId:'fc',reason:'Routine supported match.',confidence:'medium',status:'pending',evidence:[]},{id:'choice',runId:'run',paperId:'b',tagId:'rcl',reason:'Choose whether this meaning belongs here.',confidence:'medium',status:'pending',evidence:[]}];const h=await harness(data,{page:'review'});t.after(()=>h.ui.destroy());assert.equal(h.all().filter(node=>node.localName==='button'&&node.textContent==='Accept').length,1);assert.doesNotMatch(h.app.textContent,/Routine supported match/);await h.click('Accept 1 suggested matches');assert.deepEqual(h.actions,[{action:'accept-run-suggestions',payload:{runId:'run'}}]);assert.equal(h.button('Accept remaining and finish'),undefined);
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

test('Activity opens the chosen assignment task instead of the latest unrelated result',async t=>{
  const data=snapshot();data.assignmentReviews=[assignmentReview('latest',{processingPolicy:'auto-clear',appliedCount:8}),assignmentReview('requested',{processingPolicy:'auto-clear',appliedCount:2})];data.assignmentReview=data.assignmentReviews[0];
  data.runs=[{id:'requested-task',resultRunId:'requested',kind:'assignment',status:'completed',paperCount:2,completedPaperCount:2,appliedCount:2,choiceCount:1}];
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());await h.click('View result');
  assert.equal(h.doc.getElementById('nav-assignment').getAttribute('aria-current'),'page');assert.equal(h.doc.getElementById('assignment-result').textContent,'Result requested');
  assert.match(h.app.textContent,/2 tag changes applied/);assert.doesNotMatch(h.app.textContent,/8 tag changes applied/);assert.equal(h.actions.length,0);
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

test('background automatic completions update counts without moving the current page',async t=>{
  const data=snapshot();data.reviewItems=[];const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());data.tagPreparation={...preparation(),processingPolicy:'auto-clear',savedCount:4};data.assignmentReview=assignmentReview('background',{processingPolicy:'auto-clear',appliedCount:3});await h.emitUpdate();assert.equal(h.doc.getElementById('nav-vocabulary').getAttribute('aria-current'),'page');assert.equal(h.doc.getElementById('start-assignment'),null);assert.doesNotMatch(h.app.textContent,/Review before applying/);assert.match(h.app.textContent,/New papers: automatic tagging off/);assert.equal(h.actions.length,0);
});

test('Find paper filters respect per-paper native binding masks without hiding independently supported matches',async t=>{
  const data=snapshot();data.tags=[tag('fc','FC',{aliases:['fuel cells'],nativeBindingExclusions:{a:['fuel cells'],b:['FC']}}),tag('pemfc','PEMFC',{broaderIds:['fc']})];data.papers=[{id:'a',title:'Old unsupported raw label',tags:['fuel cells']},{id:'b',title:'Independent approved synonym',tags:['FC','fuel cells'],matchedTagIds:['fc']},{id:'c',title:'Approved descendant',tags:['PEMFC'],matchedTagIds:['pemfc']},{id:'d',title:'Other paper',tags:[]}];
  const h=await harness(data,{page:'library'});t.after(()=>h.ui.destroy());h.expand('Filter by tags');h.change('explore-core-fc',true);const titles=()=>h.all().filter(node=>node.classList.contains('paper-card')).map(node=>node.textContent);
  assert.equal(titles().some(title=>title.includes('Old unsupported raw label')),false);assert.equal(titles().some(title=>title.includes('Independent approved synonym')),true);assert.equal(titles().some(title=>title.includes('Approved descendant')),true);assert.match(h.app.textContent,/2 papers/);assert.equal(h.actions.length,0);
});

test('editor Save is a form-associated submit and submits only once',async t=>{
  const h=await harness(snapshot(),{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Edit tag FC');assert.equal(h.doc.activeElement.id,'tag-name');
  const save=h.doc.getElementById('save-tag');assert.equal(save.type,'submit');assert.equal(save.getAttribute('form'),'tag-editor-form');assert.equal(save.listeners.get('click')?.size||0,0);
  h.change('tag-name','Keyboard topic');h.change('tag-description','A topic created through the form.');h.doc.getElementById('tag-editor-form').emit('submit');await settle();
  assert.equal(h.actions.length,1);assert.equal(h.actions[0].action,'save-tag');assert.equal(h.doc.getElementById('tag-editor-form'),null);assert.equal(h.doc.activeElement.id,'edit-tag-fc');
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
  for(const kind of ['build','assignment'] as const){
    const data=snapshot();data.history=[{id:'newer-unrelated',date:'2026-11-01',label:'Another task',count:1,canUndo:true},{id:'own-change',date:'2026-11-01',label:'This task',count:1,canUndo:true}];
    if(kind==='build'){data.buildResult={runId:'build',status:'completed',paperCount:2,completedPaperCount:2,savedCount:2,questionCount:0};data.tagPreparation={...preparation(),processingPolicy:'auto-clear',savedCount:2,lastChangeId:'own-change'};}
    if(kind==='assignment')data.assignmentReview=assignmentReview('own-run',{processingPolicy:'auto-clear',appliedCount:1,lastChangeId:'own-change'});
    const h=await harness(data,{page:kind==='build'?'cleanup':'assignment',onInvoke(action,payload,current){if(action==='undo')current.history.find(change=>change.id===payload.id)!.canUndo=false;}});t.after(()=>h.ui.destroy());const id=kind==='build'?'undo-build-change':'undo-assignment-change';assert.ok(h.doc.getElementById(id));await h.click('Undo last change');assert.deepEqual(h.actions,[{action:'undo',payload:{id:'own-change'}}]);assert.equal(h.doc.getElementById(id),null);assert.equal(data.history[0].canUndo,true);
  }
});

test('Tag library is one AI definition list without native, shelf, or manual creation entry points',async t=>{
  const data=snapshot();data.tagLibraryEntries=[{name:'Important',paperCount:20},{name:'Imported keyword',paperCount:30}];data.tagShelves=[{id:'mine',name:'My tags',kind:'user',tagIds:[],count:0}];data.nativeDefinitionPreparation={id:'legacy',status:'paused',total:2,completed:0,canApply:false,rows:[]};data.activityTasks=[{id:'legacy-task',kind:'meanings',state:'needs-choice',label:'Native meaning work',ownerPage:'vocabulary',questionCount:2}];
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/4 active AI-built tags/);assert.equal(h.button('Add tag'),undefined);assert.equal(h.doc.getElementById('tag-library-shelf'),null);assert.doesNotMatch(h.app.textContent,/Important|Imported keyword|My tags|Suggest meanings|Choose meanings/);assert.equal(h.all().filter(node=>node.classList.contains('tag-row')).length,4);
  h.ui.navigate({page:'existing-tags'});assert.equal(h.watches.at(-1)!.query.page,'vocabulary');assert.ok(h.button('Edit tag FC'));assert.equal(h.actions.length,0);
});

test('saved AI tags can be corrected or disabled without creating a manual definition',async t=>{
  const data=snapshot(),h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Edit tag FC');h.change('tag-description','Revised fuel-cell scientific meaning.');h.change('tag-enabled',false);await h.click('Save');
  assert.equal(h.actions.length,1);assert.equal(h.actions[0].action,'save-tag');assert.equal(h.actions[0].payload.tag.id,'fc');assert.equal(h.actions[0].payload.tag.matchingMode,'manual');assert.equal(h.actions[0].payload.tag.description,'Revised fuel-cell scientific meaning.');assert.equal(h.actions.some(action=>action.action==='create-detail'),false);
});

test('Build shows its durable queued identity before paper analysis and keeps the page and focused setup mounted',async t=>{
  const data=snapshot();const h=await harness(data,{page:'build',receiptRunId:'logical-build',onInvoke(action,_payload,current){if(action==='prepare-tags'){current.run={id:'logical-build',kind:'build',status:'queued',phase:'queued',paperCount:3,completedPaperCount:0,canStop:true};return {runId:'scientific-build'};}}});t.after(()=>h.ui.destroy());
  h.choose('build-scope',1);const scope=h.doc.getElementById('build-scope'),shell=h.doc.getElementById('smart-tags-shell');scope.focus();await h.click('Build tags from these papers');assert.match(h.doc.getElementById('current-run-progress').textContent,/Queued.*0 of 3 papers/);assert.equal(h.watches.at(-1)!.query.params?.runId,'logical-build');
  data.run={...data.run!,status:'running',phase:'reading',completedPaperCount:1};scope.focus();await h.emitUpdate();assert.equal(h.doc.getElementById('build-scope')===scope,true);assert.equal(h.doc.getElementById('smart-tags-shell')===shell,true);assert.equal(h.doc.activeElement,scope);assert.match(h.doc.getElementById('current-run-progress').textContent,/Reading papers.*1 of 3 papers/);assert.equal(h.doc.getElementById('nav-cleanup').getAttribute('aria-current'),'page');
});

test('Build completion reports new reused skipped and unavailable results without definition questions',async t=>{
  const data=snapshot();data.buildResult={runId:'scientific-build',status:'completed',paperCount:8,completedPaperCount:7,savedCount:2,reusedCount:3,skippedCount:4,unavailableCount:1,questionCount:4,tagNames:['Fuel cells','Electrochemistry']};data.reviewItems=[{id:'old-question',kind:'definition',taskId:'old',state:'open',ownerPage:'vocabulary',label:'Ambiguous old concept'}];
  const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.match(h.doc.getElementById('build-result').textContent,/2 new · 3 reused · 4 ambiguous concepts skipped · 1 paper unavailable/);assert.match(h.app.textContent,/Saved: Fuel cells, Electrochemistry/);assert.equal(h.button('Choose meanings'),undefined);assert.doesNotMatch(h.app.textContent,/Ambiguous old concept/);
  await h.click('Assign tags');assert.equal(h.doc.getElementById('nav-assignment').getAttribute('aria-current'),'page');assert.ok(h.doc.getElementById('assignment-scope'));assert.equal(h.actions.length,0);
});

test('exact build results keep their scope through search and Escape until Back to library',async t=>{
  const data=snapshot();data.buildResult={runId:'exact-scientific-run',status:'completed',paperCount:3,completedPaperCount:3,savedCount:2,questionCount:0};
  const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());await h.click('View built tags');assert.equal(h.watches.at(-1)!.query.params?.buildRunId,'exact-scientific-run');h.change('vocabulary-search','fuel');await settle();assert.equal(h.watches.at(-1)!.query.params?.buildRunId,'exact-scientific-run');assert.equal(h.watches.at(-1)!.query.params?.vocabQuery,'fuel');
  h.doc.getElementById('vocabulary-search').emit('keydown',{key:'Escape',preventDefault(){},stopPropagation(){}});h.flushSearch();await settle();assert.equal(h.watches.at(-1)!.query.params?.buildRunId,'exact-scientific-run');assert.equal(h.doc.getElementById('vocabulary-search').value,'');await h.click('Back to library');assert.equal(h.watches.at(-1)!.query.params?.buildRunId,undefined);assert.equal(h.actions.length,0);
});

test('assignment defaults to all enabled tags and an explicit subset survives independent search queries',async t=>{
  const data=snapshot();data.tags[1].matchingMode='manual';const h=await harness(data,{page:'assignment'});t.after(()=>h.ui.destroy());assert.match(h.doc.getElementById('assignment-tag-mode').textContent,/All enabled tags \(3\)/);h.choose('assignment-tag-mode',1);assert.equal(h.doc.getElementById('start-assignment').disabled,true);assert.equal(h.doc.getElementById('assignment-tag-pemfc'),null);
  h.change('assignment-tag-fc',true);h.change('assignment-tag-search','impedance');await settle();assert.equal(h.doc.getElementById('assignment-tag-fc'),null);h.change('assignment-tag-eis',true);h.change('assignment-tag-search','');await settle();assert.equal(h.doc.getElementById('assignment-tag-fc').checked,true);assert.equal(h.doc.getElementById('assignment-tag-eis').checked,true);await h.click('Assign tags to these papers');assert.deepEqual(h.actions,[{action:'tag',payload:{scope:'library',tagIds:['fc','eis'],processingPolicy:'auto-clear'}}]);
});

test('Runs retains one record across Retry attempts and keeps raw errors in collapsed details',async t=>{
  const data=snapshot();data.runs=[{id:'same-run',kind:'build',status:'failed',paperCount:3,completedPaperCount:0,error:'Cannot convert undefined or null to object',attemptCount:1,canRetry:true,canStop:true}];data.activityTasks=Array.from({length:5},(_,index)=>({id:`old-failure-${index}`,kind:'maintenance' as const,state:'paused' as const,label:'Work needs attention',message:'Old duplicate failure',ownerPage:'activity' as const}));
  const h=await harness(data,{page:'activity',onInvoke(action,_payload,current){if(action==='retry-run')current.runs=[{...current.runs![0],status:'running',phase:'reading',attemptCount:2,error:undefined,canRetry:false}];}});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('nav-activity').getAttribute('aria-label'),'Runs');assert.equal(h.all().filter(node=>node.classList.contains('run-row')).length,1);assert.doesNotMatch(h.app.textContent,/Cannot convert|Old duplicate|Work needs attention/);
  h.expand('Details');assert.match(h.app.textContent,/Cannot convert undefined or null to object/);const row=h.all().find(node=>node.classList.contains('run-row'));await h.click('Retry');assert.deepEqual(h.actions,[{action:'retry-run',payload:{id:'same-run'}}]);assert.equal(h.all().find(node=>node.classList.contains('run-row')),row);assert.match(h.app.textContent,/2 attempts/);assert.equal(h.all().filter(node=>node.classList.contains('run-row')).length,1);
  await h.click('Stop');assert.deepEqual(h.actions.at(-1),{action:'stop-run',payload:{id:'same-run'}});
});

test('Runs pagination follows bounded server cursors and history remains a separate collapsed query',async t=>{
  const data=snapshot();data.runs=Array.from({length:7},(_,index)=>({id:`run-${index}`,kind:'build' as const,status:'completed' as const,paperCount:3,completedPaperCount:3}));data.history=[{id:'undo',label:'An applied change',date:'2026-11-03',count:1,canUndo:true}];
  const h=await harness(data,{page:'activity',view:(query,model)=>{const cursor=Number(query.cursor);return {model:{...model,runs:model.runs!.slice(cursor,cursor+3)},total:7,...(cursor+3<7?{nextCursor:String(cursor+3)}:{})};}});t.after(()=>h.ui.destroy());assert.equal(h.all().filter(node=>node.classList.contains('run-row')).length,3);assert.doesNotMatch(h.app.textContent,/An applied change/);await h.click('Next runs');assert.equal(h.watches.at(-1)!.query.cursor,'3');h.expand('Recent changes and Undo');assert.match(h.app.textContent,/An applied change/);assert.equal(h.watches.at(-1)!.query.cursor,'3');assert.equal(h.watches.at(-1)!.query.params?.activityHistoryOpen,true);
});

test('full replacement stays under More options and needs an explicit change review',async t=>{
  const data=snapshot();data.tagPreparation=preparation([tag('new','New AI topic')]);data.buildResult={runId:'replace-result',status:'completed',paperCount:3,completedPaperCount:3,savedCount:0,questionCount:0,requiresChangeReview:true};data.run={id:'replace-run',kind:'build',status:'completed',paperCount:3,completedPaperCount:3,requiresChangeReview:true,resultRunId:'replace-result'};
  const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.match(h.doc.getElementById('build-result').textContent,/Replacement ready for review/);assert.doesNotMatch(h.doc.getElementById('build-result').textContent,/0 new|tags saved|Build complete/);assert.ok(h.button('Apply replacement'));assert.equal(h.actions.length,0);h.expand('More options');h.choose('build-mode',1);assert.match(h.app.textContent,/Review it before saving/);await h.click('Apply replacement');assert.deepEqual(h.actions,[{action:'apply-tag-list',payload:{id:'prepared'}}]);assert.equal(h.actions.some(action=>action.action==='tag'),false);
});

test('background completion never changes the current page or replaces a focused tag search',async t=>{
  const data=snapshot(),h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());const search=h.doc.getElementById('vocabulary-search');search.focus();search.selectionStart=1;search.selectionEnd=1;h.win.scrollY=180;data.runs=[{id:'background',kind:'build',status:'completed',paperCount:3,completedPaperCount:3,newCount:2}];data.buildResult={runId:'result',status:'completed',paperCount:3,completedPaperCount:3,savedCount:2,questionCount:0};await h.emitUpdate();assert.equal(h.doc.getElementById('vocabulary-search'),search);assert.equal(h.doc.activeElement,search);assert.equal(h.win.scrollY,180);assert.equal(h.doc.getElementById('nav-vocabulary').getAttribute('aria-current'),'page');assert.equal(h.actions.length,0);
});

test('a durable receipt shows Queued immediately while its projected run is still loading',async t=>{
  const data=snapshot();const h=await harness(data,{page:'build',receiptRunId:'durable-queued'});t.after(()=>h.ui.destroy());await h.click('Build tags from these papers');assert.match(h.doc.getElementById('current-run-progress').textContent,/Queued/);assert.equal(h.doc.getElementById('start-build').disabled,true);assert.equal(h.watches.at(-1)!.query.params?.runId,'durable-queued');assert.equal(h.actions.length,1);
  await h.click('Stop');assert.deepEqual(h.actions.at(-1),{action:'stop-run',payload:{id:'durable-queued'}});
});

test('a new queued assignment does not present the previous assignment as its result',async t=>{
  const data=snapshot();data.assignmentReviews=[assignmentReview('old-result',{status:'finished',processingPolicy:'auto-clear',appliedCount:12})];data.assignmentReview=data.assignmentReviews[0];const h=await harness(data,{page:'assignment',receiptRunId:'new-logical'});t.after(()=>h.ui.destroy());await h.click('New assignment');await h.click('Assign tags to these papers');assert.match(h.app.textContent,/Queued/);assert.match(h.app.textContent,/Results will appear here/);assert.doesNotMatch(h.app.textContent,/12 tag changes applied/);
});

test('Find saves and reopens a plugin filter without native Zotero search or label inference',async t=>{
  const data=snapshot();data.savedFilters=[{id:'saved-fc',name:'Fuel-cell papers',filter:{mode:'all',selections:[{conceptId:'fc'}]}}];data.papers.push({id:'unverified',title:'Only a matching Zotero label',tags:['FC']});const h=await harness(data,{page:'library'});t.after(()=>h.ui.destroy());h.choose('saved-filter',1);assert.deepEqual(h.all().filter(node=>node.classList.contains('paper-card')).map(node=>node.textContent.includes('Only a matching Zotero label')), [false,false]);assert.equal(h.watches.at(-1)!.query.params?.conceptFilter.selections[0].conceptId,'fc');
  await h.click('Save filter…');h.change('saved-search-name','My verified AI matches');assert.match(h.app.textContent,/stays in Smart Tags/);assert.doesNotMatch(h.app.textContent,/Create a Zotero saved search/);await h.click('Save filter');assert.deepEqual(h.actions[0],{action:'save-search',payload:{name:'My verified AI matches',filter:{mode:'all',selections:[{conceptId:'fc'}]}}});await h.click('Delete filter');assert.deepEqual(h.actions.at(-1),{action:'delete-saved-filter',payload:{id:'saved-fc'}});
});

test('unknown historical builds remain neutral and failed current builds retain a Runs destination',async t=>{
  const data=snapshot();data.buildResult={runId:'old',status:'unknown',paperCount:0,completedPaperCount:0,savedCount:0,questionCount:0,message:'Saved tags are in the library.'};const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.match(h.doc.getElementById('build-result').textContent,/Earlier build/);assert.doesNotMatch(h.doc.getElementById('build-result').textContent,/failed|stopped|Build complete/i);
  data.buildResult={...data.buildResult,status:'failed'};await h.emitUpdate();assert.match(h.doc.getElementById('build-result').textContent,/Build stopped/);await h.click('Open Runs');assert.equal(h.doc.getElementById('nav-activity').getAttribute('aria-current'),'page');
});

test('the AI-only transition appears once inside collapsed history without an active task card',async t=>{
  const data=snapshot();data.transitionSummary={message:'Earlier workflows were archived.',completedAt:Date.parse('2026-11-03T00:00:00Z'),keptDefinitions:8,retiredDefinitions:12};const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());assert.equal(h.doc.getElementById('workflow-transition-history'),null);assert.doesNotMatch(h.app.textContent,/8 kept|12 archived/);assert.equal(h.all().filter(node=>node.classList.contains('run-row')).length,0);
  h.expand('Recent changes and Undo');assert.equal(h.doc.getElementById('workflow-transition-history').textContent,'AI-only tagging · 8 kept · 12 archived. Zotero labels were kept.');assert.equal(h.all().filter(node=>node.id==='workflow-transition-history').length,1);assert.equal(h.actions.length,0);
});

test('extending assignment topics captures its new logical build without changing the source assignment identity',async t=>{
  const data=snapshot();data.assignmentReview=assignmentReview('source-assignment',{processingPolicy:'auto-clear',analysisComplete:true,report:{topics:[{id:'topic',name:'Another supported topic',paperIds:['a']}],paperIds:['a']}});
  const h=await harness(data,{page:'assignment',receiptRunId:'topic-build-logical'});t.after(()=>h.ui.destroy());h.change('assignment-topic-topic',true);await h.click('Extend from selected topics');assert.deepEqual(h.actions,[{action:'extend-assignment-topics',payload:{runId:'source-assignment',paperIds:['a'],additionalTargetCount:30,processingPolicy:'auto-clear'}}]);assert.equal(h.doc.getElementById('nav-cleanup').getAttribute('aria-current'),'page');assert.equal(h.watches.at(-1)!.query.params?.runId,'topic-build-logical');assert.match(h.doc.getElementById('current-run-progress').textContent,/Queued/);
});

test('a delayed topic exclusion preview remains actionable on Build and cannot be resumed before the choice',async t=>{
  const data=snapshot();data.run={id:'topic-build',kind:'build',status:'paused',paperCount:2,completedPaperCount:0,canRetry:false,canStop:true};data.paperExclusionPreview={id:'include-topic-papers',exclude:false,changes:[{paperId:'b',title:'Detail elsewhere',before:['no_tag'],after:[]}]};
  const h=await harness(data,{page:'build'});t.after(()=>h.ui.destroy());assert.match(h.doc.getElementById('current-run-progress').textContent,/Paused/);assert.equal(h.button('Resume'),undefined);assert.equal(h.button('Retry'),undefined);assert.ok(h.button('Apply inclusion'));assert.equal(h.actions.length,0);await h.click('Apply inclusion');assert.deepEqual(h.actions,[{action:'apply-paper-exclusion',payload:{previewId:'include-topic-papers'}}]);
});

test('a single active AI tag and a one-paper run use singular counts',async t=>{
  const data=snapshot();data.tags=data.tags.slice(0,1);data.runs=[{id:'one-paper',kind:'build',status:'completed',paperCount:1,completedPaperCount:1,newCount:1}];const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,/1 active AI-built tag(?!s)/);h.ui.navigate({page:'activity'});assert.match(h.app.textContent,/1 of 1 paper(?!s)/);
});

test('stopped and failed assignments describe saved partial results while choices remain actionable',async t=>{
  for(const status of ['stopped','failed'] as const){
    const data=snapshot();data.run={id:'logical-assignment',kind:'assignment',resultRunId:'partial',status,paperCount:12,completedPaperCount:2};data.assignmentReview=assignmentReview('partial',{processingPolicy:'auto-clear',analysisComplete:false,appliedCount:2});data.suggestions=[{id:'choice',runId:'partial',paperId:'a',tagId:'fc',reason:'A remaining match needs a choice.',confidence:'medium',status:'pending',evidence:[]}];data.reviewItems=[{id:'review-choice',taskId:'partial',kind:'assignment',state:'open',paperId:'a',tagId:'fc',suggestionId:'choice',label:'Fuel-cell match',ownerPage:'assignment'}];
    const h=await harness(data,{page:'assignment'});t.after(()=>h.ui.destroy());assert.match(h.app.textContent,status==='stopped'?/This run was stopped/:/This run stopped after an error/);assert.match(h.app.textContent,/2 tag changes applied/);assert.doesNotMatch(h.app.textContent,/are being written|matching finishes/);assert.ok(h.button('Add FC'));assert.ok(h.button('Later'));assert.equal(h.actions.length,0);
  }
});
