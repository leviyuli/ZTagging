import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import type { DisplayTag, ManagerSnapshot } from '../src/ui-contract.ts';
import type { ManagerUIOptions } from '../src/ui.ts';
import type { WarningRecord } from '../src/warnings.ts';
import { confirmProposalMapping } from '../src/taxonomy.ts';
import { terminologyKey } from '../src/naming.ts';

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
  const timers=new Map<number,()=>void>();let nextTimer=0;
  const win:any=new Target();Object.assign(win,{document:doc,innerWidth:1100,innerHeight:800,scrollY:0,scrollTo(){},confirm:()=>true,setTimeout(callback:()=>void){const id=++nextTimer;timers.set(id,callback);return id;},clearTimeout(id:number){timers.delete(id);}});
  function descendants(root:Element):Element[]{return root.children.flatMap(child=>[child,...descendants(child)]);}
  function matches(node:Element,selector:string){return selector.split(',').some(part=>{const simple=part.trim();if(simple.startsWith('.'))return node.classList.contains(simple.slice(1));if(simple.startsWith('#'))return node.id===simple.slice(1);return node.localName===simple;});}
  return {win,doc,app,all:()=>descendants(app),button:(label:string)=>descendants(app).find(node=>node.localName==='button'&&node.textContent===label)!};
}
function tag(id:string,name:string,extra:Partial<DisplayTag>={}):DisplayTag{return {id,name,description:`Definition of ${name}`,facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[],relatedIds:[],matchingMode:'auto',...extra};}
function snapshot():ManagerSnapshot {
  return {vocabularyVersion:2,pilotReviewed:true,taxonomyReady:true,tags:[tag('fc','FC',{fullName:'Fuel cell'}),tag('pemfc','PEMFC',{fullName:'Proton exchange membrane fuel cell',broaderIds:['fc']}),tag('eis','EIS',{facet:'method',fullName:'Electrochemical impedance spectroscopy'}),tag('rcl','RCL',{facet:'phenomenon',fullName:'Catalyst-layer resistance',custom:true,relatedIds:['fc'],matchingMode:'suggest'})],
    papers:[{id:'a',title:'Context match',tags:['RCL','PEMFC']},{id:'b',title:'Detail elsewhere',tags:['RCL','Water electrolysis']},{id:'c',title:'Method only',tags:['EIS']},{id:'d',title:'Fuel cell only',tags:['PEMFC']}],suggestions:[],cleanup:[],history:[],neighbors:{},queue:{status:'idle',total:0,completed:0,failed:0},settings:{provider:'api',model:'openai-model',autoAssign:false,budgetUSD:5,inputPricePerMillion:0,outputPricePerMillion:0,maxOutputTokens:512,coreConceptLimit:60},models:['openai-model'],connection:{apiKeyStored:true,deepseekKeyStored:false,chatgptSignedIn:false}};
}
function warning(id:string,extra:Partial<WarningRecord>={}):WarningRecord {
  return {id,code:'missing-pdf-evidence',message:`Evidence gap ${id}`,paperIds:['a'],runIds:['run'],context:'fact-extraction',conditionFingerprint:`condition-${id}`,firstSeenAt:'2026-10-28T00:00:00Z',lastSeenAt:'2026-10-28T00:00:00Z',occurrenceCount:1,status:'active',...extra};
}
function evidenceProposal():NonNullable<ManagerSnapshot['taxonomyProposal']> {
  return {id:'proposal',createdAt:'2026-10-28',inputFingerprint:'input',baseVersion:2,coreLimit:60,tags:[tag('staged','AEMWE',{status:'draft',fullName:'Anion exchange membrane water electrolysis'})],support:{staged:{registryIds:['registry-one'],sourceIds:['fact-one'],paperIds:['a'],evidence:[{paperId:'a',source:'abstract',text:'Anion-exchange membrane water electrolyzers operate under these conditions.'}]}},merges:[],excluded:[],issues:['Confirm the scientific mapping.'],paperIds:['a'],validationIssues:[{id:'issue-one',code:'uncertain-meaning',tagId:'staged',registryId:'registry-one',message:'Confirm the scientific mapping.',severity:'confirmation',paperIds:['a'],sourceNames:['Anion-exchange membrane water electrolyzers']}],mappingConfirmations:{},evidenceSnapshot:{id:'snapshot-one',protocolVersion:2,paperIds:['a'],entries:{'registry-one':{registryId:'registry-one',key:'source-key',sourceIds:['fact-one']}},sources:{'fact-one':{factConceptId:'fact-one',paperId:'a',name:'Anion-exchange membrane water electrolyzers',facet:'system',evidence:[{source:'abstract',text:'Anion-exchange membrane water electrolyzers operate under these conditions.'}],summary:'A factual paper summary.',metadataFingerprint:'metadata',inputFingerprint:'input',provider:'deepseek',model:'deepseek-chat',extractionVersion:1}}}};
}
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
    if(failAction===action)throw new Error('Synthetic staged save failed');
    if(action==='save-taxonomy-proposal'&&data.taxonomyProposal){data.taxonomyProposal.tags=payload.tags;if(payload.excluded)data.taxonomyProposal.excluded=payload.excluded;}
    if(action==='discard-invalid-merges'&&data.taxonomyProposal)data.taxonomyProposal.unresolvedMerges=[];
    if(action==='dismiss-warning')for(const record of data.warnings||[])if(record.id===payload.id&&record.status==='active')record.status='dismissed';
    if(action==='dismiss-warnings')for(const record of data.warnings||[])if(record.status==='active')record.status='dismissed';
    if(action==='confirm-taxonomy-mapping'&&data.taxonomyProposal){data.taxonomyProposal.validationIssues=data.taxonomyProposal.validationIssues?.filter(issue=>issue.tagId!==payload.tagId||issue.severity!=='confirmation');data.taxonomyProposal.issues=[];}
    if(action==='confirm-all-taxonomy-mappings'&&data.taxonomyProposal){data.taxonomyProposal.validationIssues=data.taxonomyProposal.validationIssues?.filter(issue=>!payload.tagIds.includes(issue.tagId)||issue.severity!=='confirmation');data.taxonomyProposal.issues=data.taxonomyProposal.validationIssues?.filter(issue=>issue.severity==='error').map(issue=>issue.message)||[];}
    if(action==='remove-taxonomy-support'&&data.taxonomyProposal){data.taxonomyProposal.validationIssues=data.taxonomyProposal.validationIssues?.filter(issue=>issue.registryId!==payload.registryId);data.taxonomyProposal.issues=[];}
    if(action==='save-settings')data.settings=payload.settings;
    if(action==='save-api-key'&&payload.provider==='deepseek')data.connection.deepseekKeyStored=true;
    if(action==='create-detail'){const created={...payload.tag,id:'new-detail',status:'approved'};data.tags.push(created);return created.id;}
    for(let i=0;i<emitOnInvoke;i++)emit();
  }};
  const ui=context.ManagerUI.mountManager(dom.win,api,uiOptions);await settle();
  assert.equal(dom.app.getAttribute('data-smart-tags-state'),'ready',dom.app.textContent);
  async function click(label:string){const button=dom.button(label);assert.ok(button,`Missing button ${label}`);assert.equal(button.disabled,false,`Disabled button ${label}`);button.emit('click');await settle();}
  function expand(label:string){const details=dom.all().find(node=>node.localName==='details'&&node.children[0]?.textContent===label);assert.ok(details,`Missing details ${label}`);details.open=true;details.emit('toggle');return details;}
  function change(id:string,value:string|boolean){const control=dom.doc.getElementById(id);assert.ok(control,`Missing control ${id}`);if(typeof value==='boolean'){control.checked=value;control.emit('change');}else{control.value=value;control.emit('input');}}
  function choose(id:string,index:number){const control=dom.doc.getElementById(id);assert.ok(control);control.emit('click');const option=dom.doc.getElementById(`${id}-option-${index}`);assert.ok(option);option.emit('click');}
  return {...dom,data,actions,ui,click,change,choose,expand,emitUpdate:async()=>{emit();await settle();},get snapshotCalls(){return snapshotCalls;}};
}

test('native entry navigation creates a user detail in context, without auto creating the RCL example',async t=>{
  const h=await harness(snapshot(),{createDetail:true,detailContextId:'fc'});t.after(()=>h.ui.destroy());
  assert.equal(h.doc.getElementById('tag-name').value,'');
  assert.match(h.doc.getElementById('tag-matching-mode').textContent,/Suggest/);
  assert.equal(h.doc.getElementById('tag-relatedIds-fc').checked,true);
  assert.equal(h.actions.length,0);
  h.change('tag-name','Resistance niche');h.change('tag-description','Catalyst-layer resistance in fuel cells.');await h.click('Save definition');
  assert.equal(h.actions[0].action,'create-detail');
  assert.equal(h.actions[0].payload.tag.custom,true);
  assert.deepEqual(h.actions[0].payload.tag.relatedIds,['fc']);
  assert.equal(h.actions[0].payload.tag.matchingMode,'suggest');
  assert.ok(h.button('Preview matches'),'Saving a new detail keeps immediate preview available');
  h.ui.navigate({tagId:'rcl'});assert.equal(h.doc.getElementById('tag-name').value,'RCL');
});

test('staged taxonomy approval requires acknowledgement for preserved rejected and locked decisions',async t=>{
  const data=snapshot();data.taxonomyProposal={id:'proposal',createdAt:'2026-10-28',inputFingerprint:'input',baseVersion:2,coreLimit:60,tags:[tag('staged','FC',{status:'draft'})],support:{staged:{paperIds:['a'],evidence:[{paperId:'a',source:'title',text:'Context match'}]}},merges:[],excluded:[],issues:[],decisionConflicts:['A rejected decision and a locked decision overlap.'],paperIds:['a']};
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  assert.equal(h.button('Approve global vocabulary').disabled,true);
  assert.match(h.app.textContent,/Evidence coverage: 1 papers/);
  h.change('taxonomy-preserve-decisions',true);await h.click('Approve global vocabulary');
  assert.deepEqual(h.actions[0],{action:'approve-taxonomy',payload:{id:'proposal',preserveDecisions:true}});
});

test('editing a staged definition does not write the active vocabulary or paper tags',async t=>{
  const data=snapshot();data.taxonomyProposal={id:'proposal',createdAt:'now',inputFingerprint:'x',baseVersion:2,coreLimit:60,tags:[tag('staged','FC',{status:'draft'})],support:{},merges:[],excluded:[],issues:[],paperIds:[]};
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Edit');
  h.change('tag-full-name','Fuel-cell systems');await h.click('Save definition');
  assert.equal(h.actions[0].action,'save-taxonomy-proposal');assert.equal(h.actions[0].payload.tags[0].fullName,'Fuel-cell systems');
  assert.equal(data.tags[0].fullName,'Fuel cell');assert.equal(h.actions.some(entry=>entry.action==='apply-suggestions'),false);
});

test('invalid merge references remain visible and block approval until explicitly discarded',async t=>{
  const data=snapshot();data.taxonomyProposal={id:'proposal',createdAt:'now',inputFingerprint:'x',baseVersion:2,coreLimit:60,tags:[tag('staged','FC',{status:'draft'})],support:{},merges:[],excluded:[],issues:[],paperIds:[],unresolvedMerges:[{fromId:'tag-714a5d4e61ef0e6a',toReference:'fuel-cell',reason:'Unknown source concept.'},{fromId:'fc',toReference:'missing-target',reason:'Unknown target concept.'}]};
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  assert.equal(h.button('Approve global vocabulary').disabled,true);
  assert.match(h.app.textContent,/2 invalid merge suggestions need review/);
  assert.match(h.app.textContent,/tag-714a5d4e61ef0e6a → fuel-cell: Unknown source concept\./);
  assert.match(h.app.textContent,/FC \(fc\) → missing-target: Unknown target concept\./);
  assert.match(h.app.textContent,/No invalid merge will be applied/);
  assert.equal(h.actions.length,0,'Displaying malformed AI output must not retry a provider request');
  await h.click('Discard invalid merge suggestions');
  assert.deepEqual(h.actions,[{action:'discard-invalid-merges',payload:{id:'proposal'}}]);
  assert.equal(h.button('Approve global vocabulary').disabled,false);
  assert.equal(h.button('Discard invalid merge suggestions'),undefined);
});

test('editing another staged field cannot implicitly dismiss invalid merge review',async t=>{
  const data=snapshot();const unresolved=[{fromId:'missing-source',toReference:'fuel-cell',reason:'Unknown source concept.'}];
  data.taxonomyProposal={id:'proposal',createdAt:'now',inputFingerprint:'x',baseVersion:2,coreLimit:60,tags:[tag('staged','FC',{status:'draft'})],support:{},merges:[],excluded:[],issues:[],paperIds:[],unresolvedMerges:unresolved};
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  await h.click('Edit');h.change('tag-description','A revised definition of fuel-cell systems.');await h.click('Save definition');
  assert.deepEqual(data.taxonomyProposal.unresolvedMerges,unresolved);
  assert.equal(h.button('Approve global vocabulary').disabled,true);
  assert.ok(h.button('Discard invalid merge suggestions'));
  assert.equal(h.actions.length,1);assert.equal(h.actions[0].action,'save-taxonomy-proposal');
});

test('Remove cleans staged core and DIY context links while retaining detail meanings and native choices',async t=>{
  const data=snapshot();data.taxonomyProposal={id:'proposal',createdAt:'now',inputFingerprint:'x',baseVersion:2,coreLimit:60,tags:data.tags.map(tag=>({...tag,status:'draft'})),support:{},merges:[],excluded:[],issues:[],paperIds:[]};
  data.taxonomyProposal.tags.find(tag=>tag.id==='rcl')!.broaderIds=['fc'];
  const activeDetail=structuredClone(data.tags.find(tag=>tag.id==='rcl')!);const nativeChoices=structuredClone(data.papers);
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Remove');
  const payload=h.actions[0].payload;assert.equal(payload.tags.some((tag:DisplayTag)=>tag.id==='fc'),false);
  assert.deepEqual(payload.tags.find((tag:DisplayTag)=>tag.id==='pemfc').broaderIds,[]);
  const retained=payload.tags.find((tag:DisplayTag)=>tag.id==='rcl');
  assert.deepEqual(retained.relatedIds,[]);assert.deepEqual(retained.broaderIds,[]);
  assert.equal(retained.custom,true);assert.equal(retained.name,activeDetail.name);assert.equal(retained.description,activeDetail.description);assert.equal(retained.matchingMode,activeDetail.matchingMode);assert.deepEqual(retained.aliases,activeDetail.aliases);
  assert.deepEqual(data.tags.find(tag=>tag.id==='rcl'),activeDetail,'Active DIY definition is unchanged before approval');
  assert.deepEqual(data.papers,nativeChoices,'Removing a staged concept changes no native tag choices');
  assert.match(payload.excluded[0].reason,/review/);
});

test('successful Remove closes the editor for that staged concept',async t=>{
  const data=snapshot();data.taxonomyProposal=evidenceProposal();
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  await h.click('Edit');h.change('tag-description','Unfinished draft for the removed concept.');await h.click('Remove');
  assert.equal(data.taxonomyProposal.tags.some(value=>value.id==='staged'),false);
  assert.equal(h.doc.getElementById('tag-name'),null,'A removed concept cannot remain editable');
  assert.equal(h.button('Save definition'),undefined);assert.equal(h.actions.length,1);
});

test('Remove preserves an unfinished editor for another staged concept',async t=>{
  const data=snapshot();data.taxonomyProposal=evidenceProposal();data.taxonomyProposal.tags.push(tag('other','Other topic',{status:'draft'}));
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  const edit=h.all().find(node=>node.getAttribute('aria-label')==='Edit proposed concept Other topic')!;
  edit.emit('click');await settle();h.change('tag-description','Unfinished draft for another concept.');await h.click('Remove');
  assert.equal(data.taxonomyProposal.tags.some(value=>value.id==='staged'),false);
  assert.equal(h.doc.getElementById('tag-name').value,'Other topic');
  assert.equal(h.doc.getElementById('tag-description').value,'Unfinished draft for another concept.');
});

test('failed Remove keeps the same staged editor and its unsaved changes',async t=>{
  const data=snapshot();data.taxonomyProposal=evidenceProposal();
  const h=await harness(data,{page:'vocabulary',failAction:'save-taxonomy-proposal'});t.after(()=>h.ui.destroy());
  await h.click('Edit');h.change('tag-description','Unsaved text must survive a rejected removal.');await h.click('Remove');
  assert.equal(data.taxonomyProposal.tags.some(value=>value.id==='staged'),true);
  assert.equal(h.doc.getElementById('tag-description').value,'Unsaved text must survive a rejected removal.');
  assert.ok(h.button('Save definition'));assert.match(h.app.textContent,/Synthetic staged save failed/);
});

test('Explore Any combines whole detail-context clauses and preserves them in native saved searches',async t=>{
  const h=await harness(snapshot(),{page:'library'});t.after(()=>h.ui.destroy());
  h.change('explore-detail-rcl-fc-fc',true);h.change('explore-core-eis',true);h.choose('concept-filter-mode',1);
  const paperTitles=h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent);
  assert.deepEqual(paperTitles,['Context match','Method only']);
  await h.click('Save tag search…');await h.click('Create saved search');
  assert.deepEqual(h.actions[0].payload.filter,{mode:'any',selections:[{conceptId:'rcl',contextId:'fc'},{conceptId:'eis'}]});
  assert.equal(h.actions[0].action,'save-search');
});

test('Explore concept search finds full names and scientific case distinguishes Co from CO',async t=>{
  const data=snapshot();data.tags.push(tag('co','Co',{facet:'component'}),tag('CO','CO',{facet:'component'}));data.papers.push({id:'cobalt',title:'Cobalt paper',tags:['Co']},{id:'monoxide',title:'Carbon monoxide paper',tags:['CO']});
  const h=await harness(data,{page:'library'});t.after(()=>h.ui.destroy());
  h.change('concept-search','catalyst-layer resistance');assert.ok(h.doc.getElementById('explore-detail-rcl-fc-fc'));
  h.change('concept-search','');h.change('explore-core-co',true);
  assert.deepEqual(h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent),['Cobalt paper']);
});

test('reverse related links expose shared details while legacy DIY parents do not inflate core counts',async t=>{
  const data=snapshot();data.tags.find(tag=>tag.id==='rcl')!.relatedIds=[];data.tags.find(tag=>tag.id==='fc')!.relatedIds=['rcl'];
  const h=await harness(data,{page:'library'});t.after(()=>h.ui.destroy());
  assert.ok(h.doc.getElementById('explore-detail-rcl-fc-fc'),'A core-to-detail related link must expose the contextual detail');
  data.tags.find(tag=>tag.id==='rcl')!.broaderIds=['fc'];await h.ui.refresh();
  h.change('explore-core-fc',true);
  assert.deepEqual(h.all().filter(node=>node.className==='paper-title-button').map(node=>node.textContent),['Context match','Fuel cell only']);
  h.ui.navigate({page:'vocabulary'});
  const row=h.all().find(node=>node.classList.contains('tag-row')&&node.children[0]?.textContent.startsWith('FCapproved'));
  assert.ok(row);assert.match(row.textContent,/Currently tagged: 2/);
});

test('core limit validation accepts an explicit 500 while refusing fractional or excessive budgets',async t=>{
  const h=await harness(snapshot(),{page:'settings'});t.after(()=>h.ui.destroy());
  h.change('settings-coreConceptLimit','501');await h.click('Save settings');assert.equal(h.actions.length,0);assert.match(h.app.textContent,/whole number from 1 to 500/);
  h.change('settings-coreConceptLimit','60.5');await h.click('Save settings');assert.equal(h.actions.length,0);
  h.change('settings-coreConceptLimit','500');await h.click('Save settings');assert.equal(h.actions[0].payload.settings.coreConceptLimit,500);
});

test('DeepSeek uses its own masked key action and clears previous-provider model and rates',async t=>{
  const h=await harness(snapshot(),{page:'settings'});t.after(()=>h.ui.destroy());h.choose('settings-provider',2);
  assert.equal(h.doc.getElementById('settings-model').value,'');assert.equal(h.doc.getElementById('settings-inputPricePerMillion').value,'0');
  const key=h.doc.getElementById('settings-deepseek-key');assert.ok(key);assert.equal(key.type,'password');assert.equal(h.doc.getElementById('settings-api-key'),null);
  assert.equal(h.button('Continue with ChatGPT'),undefined);h.change('settings-deepseek-key','test-private-key');await h.click('Save DeepSeek key');
  assert.deepEqual(h.actions[0],{action:'save-api-key',payload:{key:'test-private-key',provider:'deepseek'}});
  assert.equal(h.doc.getElementById('settings-deepseek-key').value,'');assert.equal(JSON.stringify(h.data).includes('test-private-key'),false);
});

test('active warnings retain all conditions, link affected papers, and dismiss without deleting history',async t=>{
  const data=snapshot();data.warnings=Array.from({length:27},(_,index)=>warning(`w${index}`,{paperIds:[index%2?'b':'a']}));
  const h=await harness(data);t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/27 active warnings/);assert.match(h.app.textContent,/2 affected papers/);
  assert.equal(h.all().filter(node=>node.classList.contains('warning-record')).length,27,'Active conditions must not be truncated at 20');
  await h.click('Context match');assert.deepEqual(h.actions[0],{action:'show-paper',payload:{id:'a'}});
  await h.click('Dismiss');assert.deepEqual(h.actions[1],{action:'dismiss-warning',payload:{id:'w0'}});
  assert.equal(data.warnings.length,27);assert.equal(data.warnings[0].status,'dismissed');assert.match(h.app.textContent,/26 active warnings/);
  await h.click('Dismiss all');assert.equal(h.actions[2].action,'dismiss-warnings');assert.equal(data.warnings.length,27);
  assert.equal(h.all().some(node=>node.classList.contains('active-warning-summary')),false);
  assert.equal(h.app.textContent.includes('Evidence gap w0'),false,'Dismissed records belong in history');
  h.ui.navigate({page:'activity'});assert.match(h.app.textContent,/Warning history/);assert.match(h.app.textContent,/Evidence gap w0/);
  h.ui.destroy();const restarted=await harness(data);t.after(()=>restarted.ui.destroy());
  assert.equal(restarted.all().some(node=>node.classList.contains('active-warning-summary')),false);
});

test('warning history paginates resolved, dismissed and unverified legacy notices without fabricated metadata',async t=>{
  const data=snapshot();data.warnings=Array.from({length:61},(_,index)=>warning(`h${index}`,{status:index%2?'dismissed':'resolved'}));
  data.warnings[0]=warning('legacy',{legacy:true,status:'dismissed',message:'Historical warning from an earlier version.',paperIds:[],runIds:[],firstSeenAt:null,lastSeenAt:null,occurrenceCount:null});
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  assert.equal(h.all().filter(node=>node.classList.contains('warning-record')).length,50);
  assert.match(h.app.textContent,/historical · unverified/);assert.match(h.app.textContent,/Original paper associations, occurrence count, and dates are unavailable/);
  const legacy=h.all().find(node=>node.classList.contains('warning-record')&&node.textContent.includes('Historical warning from'))!;
  assert.equal(legacy.textContent.includes('First seen:'),false);assert.equal(legacy.textContent.includes('occurrences ·'),false);
  assert.equal(h.button('Dismiss'),undefined);await h.click('Next');
  assert.equal(h.all().filter(node=>node.classList.contains('warning-record')).length,11);assert.match(h.app.textContent,/Evidence gap h60/);
});

test('uncertain scientific mapping exposes source wording and immutable quotations before explicit tag-level confirmation',async t=>{
  const data=snapshot();data.taxonomyProposal=evidenceProposal();
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  assert.equal(h.button('Approve global vocabulary').disabled,true);assert.match(h.app.textContent,/confirmation required/);
  assert.match(h.app.textContent,/Source wording: Anion-exchange membrane water electrolyzers/);
  h.expand('Original source wording & registry links');
  assert.match(h.app.textContent,/Anion-exchange membrane water electrolyzers operate under these conditions\./);
  assert.match(h.app.textContent,/deepseek · deepseek-chat/);assert.equal(h.actions.length,0);
  await h.click('Confirm scientific mapping');assert.deepEqual(h.actions,[{action:'confirm-taxonomy-mapping',payload:{id:'proposal',tagId:'staged'}}]);
  assert.equal(h.button('Approve global vocabulary').disabled,false);
});

test('known contradictions stay blocked and offer link removal without scientific confirmation',async t=>{
  const data=snapshot();data.taxonomyProposal=evidenceProposal();
  data.taxonomyProposal.validationIssues!.push({id:'contradiction',code:'scientific-contradiction',severity:'error',tagId:'staged',registryId:'registry-one',message:'The source establishes a different scientific system.'});
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  assert.equal(h.button('Approve global vocabulary').disabled,true);assert.equal(h.button('Confirm scientific mapping'),undefined);
  assert.match(h.app.textContent,/Correct or remove the contradictory evidence/);await h.click('Remove unsupported link');
  assert.deepEqual(h.actions[0],{action:'remove-taxonomy-support',payload:{id:'proposal',tagId:'staged',registryId:'registry-one'}});
});

test('structured validation blocks approval even when the compatibility issue list is empty',async t=>{
  const data=snapshot();data.taxonomyProposal=evidenceProposal();data.taxonomyProposal.issues=[];
  data.taxonomyProposal.validationIssues=[{id:'unknown',code:'unknown-registry-id',severity:'error',tagId:'staged',registryId:'unknown-registry',message:'Registry ID is not permitted by this snapshot.'}];
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  assert.equal(h.button('Approve global vocabulary').disabled,true);assert.match(h.app.textContent,/Registry ID is not permitted by this snapshot/);
  await h.click('Remove unsupported link');assert.equal(h.actions[0].payload.registryId,'unknown-registry');
});

test('hostile unknown registry IDs render diagnostics and removal without inheriting object properties',async t=>{
  const data=snapshot();data.taxonomyProposal=evidenceProposal();data.taxonomyProposal.issues=[];
  data.taxonomyProposal.support.staged.registryIds=['constructor','__proto__','malformed-entry','hostile-source'];
  data.taxonomyProposal.evidenceSnapshot!.entries['malformed-entry']={registryId:'malformed-entry',key:'bad',sourceIds:null} as any;
  data.taxonomyProposal.evidenceSnapshot!.entries['hostile-source']={registryId:'hostile-source',key:'bad-source',sourceIds:['constructor','__proto__']};
  data.taxonomyProposal.validationIssues=[{id:'unknown-hostile',code:'unknown-registry-id',severity:'error',tagId:'staged',registryId:'constructor',message:'Registry ID constructor is not permitted by this snapshot.'}];
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  h.expand('Original source wording & registry links');
  assert.equal(h.app.getAttribute('data-smart-tags-state'),'ready');assert.equal(h.button('Approve global vocabulary').disabled,true);
  assert.match(h.app.textContent,/Registry ID constructor is not permitted/);assert.match(h.app.textContent,/__proto__/);
  assert.equal(h.all().filter(node=>node.classList.contains('registry-evidence-entry')).length,5);
  assert.equal(h.all().filter(node=>node.classList.contains('factual-source')).length,0);
  await h.click('Remove unsupported link');assert.deepEqual(h.actions[0],{action:'remove-taxonomy-support',payload:{id:'proposal',tagId:'staged',registryId:'constructor'}});
});

test('malformed consolidation diagnostics remain inspectable and regenerate only after an explicit action',async t=>{
  const data=snapshot();data.queue={status:'paused',total:51,completed:51,failed:0,consolidation:{phase:'invalid-response',correctionAttempts:1,issues:['The provider response did not contain a tags array.'],canRegenerate:true,rawResponses:[{label:'Initial provider response',response:'{"error":"incomplete consolidation"}'}]}};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/Vocabulary analysis needs attention/);
  assert.equal(h.app.textContent.includes('automatic correction dispatched'),false,'Technical diagnostics start collapsed and unbuilt');
  h.expand('Technical diagnostics');assert.match(h.app.textContent,/1 \/ 1 automatic correction dispatched/);
  assert.match(h.app.textContent,/did not contain a tags array/);assert.equal(h.actions.length,0);
  assert.match(h.app.textContent,/Initial provider response/);assert.match(h.app.textContent,/incomplete consolidation/);
  await h.click('Regenerate proposal');assert.deepEqual(h.actions,[{action:'regenerate-taxonomy',payload:undefined}]);
});

test('activity sends a retained proposal to Vocabulary without repeating its validation diagnostics',async t=>{
  const data=snapshot();data.taxonomyProposal=evidenceProposal();data.queue.consolidation={phase:'needs-review',correctionAttempts:1,issues:['Repeated scientific mapping detail'],canRegenerate:true,rawResponses:[{label:'Provider response',response:'private provider output'}]};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/Vocabulary ready for review/);assert.equal(h.app.textContent.includes('Repeated scientific mapping detail'),false);
  assert.equal(h.app.textContent.includes('automatic correction'),false);assert.equal(h.app.textContent.includes('private provider output'),false);
  assert.equal(h.button('Regenerate proposal'),undefined);await h.click('Review vocabulary');
  assert.ok(h.button('Confirm scientific mapping'));assert.equal(h.actions.length,0);
});

test('Vocabulary lists each per-concept diagnostic once while retaining global and legacy approval blockers',async t=>{
  const data=snapshot();data.taxonomyProposal=evidenceProposal();data.taxonomyProposal.issues.push('Legacy proposal diagnostic.');
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  assert.equal(h.app.textContent.split('Confirm the scientific mapping.').length-1,1);
  assert.match(h.app.textContent,/Legacy proposal diagnostic/);assert.equal(h.button('Approve global vocabulary').disabled,true);
  data.taxonomyProposal.externalIssues=['Confirm the scientific mapping.'];await h.ui.refresh();
  assert.equal(h.app.textContent.split('Confirm the scientific mapping.').length-1,2,'An explicit global diagnostic is retained even if a concept has the same text');
  assert.equal(h.button('Approve global vocabulary').disabled,true);
});

test('proposal evidence export is explicit and stays separate from definition-only export',async t=>{
  const data=snapshot();data.taxonomyProposal=evidenceProposal();
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/proposal export includes private paper source wording and quotations/);
  assert.match(h.app.textContent,/Export definitions below contains definitions only/);assert.equal(h.actions.length,0);
  await h.click('Export proposal with evidence…');assert.deepEqual(h.actions[0],{action:'export-taxonomy-proposal',payload:{id:'proposal'}});
  await h.click('Export definitions…');assert.deepEqual(h.actions[1],{action:'export-vocabulary',payload:undefined});
});

test('superseded warning episodes are distinguished from user dismissal without changing legacy notices',async t=>{
  const data=snapshot();data.warnings=[warning('old',{status:'dismissed',supersededBy:'new'}),warning('legacy',{status:'dismissed',legacy:true,paperIds:[],runIds:[],firstSeenAt:null,lastSeenAt:null,occurrenceCount:null})];
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  const old=h.all().find(node=>node.classList.contains('warning-record')&&node.textContent.includes('Evidence gap old'))!;
  assert.match(old.textContent,/Superseded/);assert.match(old.textContent,/Replaced by a changed condition/);assert.equal(old.textContent.includes('dismissed'),false);
  const legacy=h.all().find(node=>node.classList.contains('warning-record')&&node.textContent.includes('Evidence gap legacy'))!;
  assert.match(legacy.textContent,/historical · unverified/);assert.match(legacy.textContent,/dates are unavailable/);assert.equal(h.actions.length,0);
});

test('large proposal review bounds DOM work and preserves evidence pages and unfinished edits across confirmation',async t=>{
  const data=snapshot();const proposal=evidenceProposal();data.taxonomyProposal=proposal;
  const original=proposal.evidenceSnapshot!.sources['fact-one'];
  const paperIds=Array.from({length:250},(_,i)=>`bulk-paper-${i}`);
  const sources=Object.fromEntries(paperIds.map((paperId,i)=>[`bulk-fact-${i}`,{...original,factConceptId:`bulk-fact-${i}`,paperId,name:'transport resistance',evidence:[{source:'abstract',text:`Verbatim transport-resistance evidence ${i}.`},{source:'title',text:`Source title ${i}.`}]}]));
  proposal.evidenceSnapshot={id:'bulk-snapshot',protocolVersion:2,paperIds,sources,entries:{'bulk-registry':{registryId:'bulk-registry',key:'transport resistance',sourceIds:Object.keys(sources)}}};
  proposal.tags=Array.from({length:60},(_,i)=>tag(`bulk-${i}`,`bulk concept ${i}`,{status:'draft'}));
  proposal.support=Object.fromEntries(proposal.tags.map(value=>[value.id,{registryIds:['bulk-registry'],sourceIds:Object.keys(sources),paperIds}]));
  proposal.validationIssues=proposal.tags.map(value=>({id:`issue-${value.id}`,tagId:value.id,registryId:'bulk-registry',severity:'confirmation',code:'uncertain-meaning',message:`Confirm mapping for ${value.name}.`,paperIds,sourceNames:['transport resistance']}));
  proposal.issues=proposal.validationIssues.map(value=>value.message);proposal.paperIds=paperIds;
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  const rows=()=>h.all().filter(node=>node.localName==='article'&&node.classList.contains('tag-row'));
  const quotes=()=>h.all().filter(node=>node.localName==='blockquote');
  assert.equal(rows().length,20);assert.equal(quotes().length,0,'Collapsed evidence must not create hidden quote nodes');
  assert.ok(h.all().length<5000,'Initial render must be bounded independently of 15000 evidence links');
  await h.click('Edit');h.change('tag-name','Unfinished local edit');
  await h.click('Next concepts');assert.match(rows()[0].textContent,/bulk concept 20/);
  assert.equal(h.doc.getElementById('tag-name').value,'Unfinished local edit');
  h.expand('Original source wording & registry links');assert.equal(quotes().length,40);
  await h.click('Next evidence');assert.equal(quotes().length,40);assert.match(h.app.textContent,/Verbatim transport-resistance evidence 20/);
  h.doc.getElementById('proposal-concept-list').scrollTop=345;
  await h.click('Confirm scientific mapping');
  assert.deepEqual(h.actions.at(-1),{action:'confirm-taxonomy-mapping',payload:{id:'proposal',tagId:'bulk-20'}});
  assert.match(rows()[0].textContent,/bulk concept 20/);assert.match(h.app.textContent,/Verbatim transport-resistance evidence 20/);
  assert.equal(quotes().length,40);assert.equal(h.doc.getElementById('tag-name').value,'Unfinished local edit');
  assert.equal(h.doc.getElementById('proposal-concept-list').scrollTop,345);
  assert.equal(h.button('Approve global vocabulary').disabled,true,'Other uncertain mappings still block approval');
  await h.click('Next concepts');await h.click('Previous concepts');
  assert.match(h.app.textContent,/Verbatim transport-resistance evidence 20/);assert.equal(quotes().length,40);
  assert.equal(h.doc.getElementById('proposal-concept-list').scrollTop,345);
});

test('action save notifications share one final snapshot while later external updates remain visible',async t=>{
  const data=snapshot();data.taxonomyProposal=evidenceProposal();
  const h=await harness(data,{page:'vocabulary',emitOnInvoke:5});t.after(()=>h.ui.destroy());
  assert.equal(h.snapshotCalls,1);await h.click('Confirm scientific mapping');
  assert.equal(h.snapshotCalls,2,'An action and its save notifications need only one final snapshot');
  data.warnings=[warning('external')];await h.emitUpdate();
  assert.equal(h.snapshotCalls,3);assert.match(h.app.textContent,/Evidence gap external/);
});

test('external notification during an action snapshot is refreshed after the action settles',async t=>{
  const data=snapshot();data.taxonomyProposal=evidenceProposal();
  const h=await harness(data,{page:'vocabulary',onSnapshot:async(call:number,emit:()=>void,current:ManagerSnapshot)=>{
    if(call===2){emit();await settle();current.warnings=[warning('concurrent')];}
  }});t.after(()=>h.ui.destroy());
  await h.click('Confirm scientific mapping');await settle();await settle();
  assert.equal(h.snapshotCalls,3);assert.match(h.app.textContent,/Evidence gap concurrent/);
});

test('Confirm all mappings covers every concept page and skips blocked, confirmed, equivalent, and DIY concepts',async t=>{
  const data=snapshot(),proposal=evidenceProposal();data.taxonomyProposal=proposal;
  proposal.tags=Array.from({length:60},(_,index)=>tag(`all-${index}`,index===4?'AEMWE':`topic ${index}`,{status:'draft',description:'Anion exchange membrane water electrolyzer topic study.',aliases:index===0?['First full alias','Second full alias']:[]}));
  proposal.tags.push(tag('all-diy','My DIY',{custom:true,status:'draft',relatedIds:[]}));
  proposal.support=Object.fromEntries(proposal.tags.map(value=>[value.id,{registryIds:value.custom?[]:['registry-one'],paperIds:value.custom?[]:['a'],sourceIds:value.custom?[]:['fact-one']}]));
  proposal.validationIssues=proposal.tags.filter(value=>!value.custom&&value.id!=='all-4').map(value=>({id:`issue-${value.id}`,code:'uncertain-meaning',severity:'confirmation',tagId:value.id,registryId:'registry-one',message:`Confirm ${value.name}.`}));
  confirmProposalMapping(proposal,'all-2');
  proposal.validationIssues!.push({id:'blocked',code:'scientific-contradiction',severity:'error',tagId:'all-1',message:'A contradictory mapping remains blocked.'},{id:'diy-pending',code:'uncertain-meaning',severity:'confirmation',tagId:'all-diy',message:'User detail is separate.'});
  proposal.issues!.push('A contradictory mapping remains blocked.');
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());
  assert.ok(h.button('Confirm all mappings (57)'));assert.match(h.app.textContent,/Blocked concepts still need correction; approval is separate/);
  const concepts=h.all().find(node=>node.localName==='details'&&node.children[0]?.textContent==='Review 60 proposed concepts')!;
  assert.equal(concepts.open,true);assert.equal(concepts.contains(h.button('Confirm all mappings (57)')),false);
  const edit=h.all().find(node=>node.getAttribute('aria-label')==='Edit proposed concept topic 0')!;
  const remove=h.all().find(node=>node.getAttribute('aria-label')==='Remove proposed concept topic 0')!;
  assert.equal(edit.textContent,'Edit');assert.equal(remove.textContent,'Remove');assert.match(edit.getAttribute('aria-label'),/topic 0/);assert.match(remove.getAttribute('aria-label'),/topic 0/);
  concepts.open=false;concepts.emit('toggle');await h.ui.refresh();
  assert.equal(h.all().find(node=>node.localName==='details'&&node.children[0]?.textContent==='Review 60 proposed concepts')!.open,false,'User collapse survives refresh');
  h.expand('Review 60 proposed concepts');await h.click('Next concepts');await h.click('Confirm all mappings (57)');
  const expected=Array.from({length:60},(_,index)=>`all-${index}`).filter(id=>!['all-1','all-2','all-4'].includes(id));
  assert.deepEqual(h.actions,[{action:'confirm-all-taxonomy-mappings',payload:{id:'proposal',tagIds:expected}}]);
  assert.equal(h.button('Confirm all mappings (0)').disabled,true);assert.equal(h.button('Approve global vocabulary').disabled,true);
  assert.match(h.app.textContent,/topic 20/,'Current concept page is preserved');
});

const changedConfirmedSnapshot: [string, (proposal: NonNullable<ManagerSnapshot['taxonomyProposal']>) => void][] = [
  ['quotation', proposal => { proposal.evidenceSnapshot!.sources['fact-one'].evidence[0].text += ' Changed quotation.'; }],
  ['meaning', proposal => { proposal.tags[0].description += ' A changed scientific scope.'; }],
  ['support links', proposal => { proposal.support.staged.registryIds = []; }],
];
for (const [changed, mutate] of changedConfirmedSnapshot) test(`a new same-identity snapshot invalidates cached confirmation after changed ${changed}`,async t=>{
  const data=snapshot(),proposal=evidenceProposal();data.taxonomyProposal=proposal;
  proposal.tags[0].name='electrolyzer interface resistance';proposal.tags[0].fullName=proposal.tags[0].name;
  proposal.tags[0].description='Resistance at the interface of an anion exchange membrane water electrolyzer.';
  proposal.evidenceSnapshot!.entries['registry-one'].key=terminologyKey(proposal.evidenceSnapshot!.sources['fact-one'].name);
  confirmProposalMapping(proposal,'staged');
  assert.deepEqual(proposal.issues,[]);
  const h=await harness(data,{page:'vocabulary',onSnapshot:()=>data});t.after(()=>h.ui.destroy());
  assert.equal(h.button('Approve global vocabulary').disabled,false);
  h.ui.navigate({page:'vocabulary'});assert.equal(h.button('Approve global vocabulary').disabled,false);
  mutate(proposal);await h.emitUpdate();
  assert.equal(h.snapshotCalls,2);assert.equal(h.button('Approve global vocabulary').disabled,true);
  assert.ok(h.button('Confirm scientific mapping'),'Changed evidence must require confirmation again');
});
