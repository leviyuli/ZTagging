import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import type { DisplayTag, ManagerSnapshot } from '../src/ui-contract.ts';
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
async function harness(data=snapshot(),options:any={}) {
  const dom=managerDOM();const actions:{action:string;payload:any}[]=[];
  const context=vm.createContext({Zotero:{debug(){}},console});vm.runInContext(await bundle,context);
  const api={snapshot:async()=>structuredClone(data),subscribe:()=>()=>{},invoke:async(action:string,payload:any)=>{
    actions.push({action,payload:structuredClone(payload)});
    if(action==='save-taxonomy-proposal'&&data.taxonomyProposal){data.taxonomyProposal.tags=payload.tags;if(payload.excluded)data.taxonomyProposal.excluded=payload.excluded;}
    if(action==='discard-invalid-merges'&&data.taxonomyProposal)data.taxonomyProposal.unresolvedMerges=[];
    if(action==='dismiss-warning')for(const record of data.warnings||[])if(record.id===payload.id&&record.status==='active')record.status='dismissed';
    if(action==='dismiss-warnings')for(const record of data.warnings||[])if(record.status==='active')record.status='dismissed';
    if(action==='confirm-taxonomy-mapping'&&data.taxonomyProposal){data.taxonomyProposal.validationIssues=data.taxonomyProposal.validationIssues?.filter(issue=>issue.tagId!==payload.tagId||issue.severity!=='confirmation');data.taxonomyProposal.issues=[];}
    if(action==='remove-taxonomy-support'&&data.taxonomyProposal){data.taxonomyProposal.validationIssues=data.taxonomyProposal.validationIssues?.filter(issue=>issue.registryId!==payload.registryId);data.taxonomyProposal.issues=[];}
    if(action==='save-settings')data.settings=payload.settings;
    if(action==='save-api-key'&&payload.provider==='deepseek')data.connection.deepseekKeyStored=true;
    if(action==='create-detail'){const created={...payload.tag,id:'new-detail',status:'approved'};data.tags.push(created);return created.id;}
  }};
  const ui=context.ManagerUI.mountManager(dom.win,api,options);await settle();
  assert.equal(dom.app.getAttribute('data-smart-tags-state'),'ready',dom.app.textContent);
  async function click(label:string){const button=dom.button(label);assert.ok(button,`Missing button ${label}`);assert.equal(button.disabled,false,`Disabled button ${label}`);button.emit('click');await settle();}
  function change(id:string,value:string|boolean){const control=dom.doc.getElementById(id);assert.ok(control,`Missing control ${id}`);if(typeof value==='boolean'){control.checked=value;control.emit('change');}else{control.value=value;control.emit('input');}}
  function choose(id:string,index:number){const control=dom.doc.getElementById(id);assert.ok(control);control.emit('click');const option=dom.doc.getElementById(`${id}-option-${index}`);assert.ok(option);option.emit('click');}
  return {...dom,data,actions,ui,click,change,choose};
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
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Edit staged definition');
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
  await h.click('Edit staged definition');h.change('tag-description','A revised definition of fuel-cell systems.');await h.click('Save definition');
  assert.deepEqual(data.taxonomyProposal.unresolvedMerges,unresolved);
  assert.equal(h.button('Approve global vocabulary').disabled,true);
  assert.ok(h.button('Discard invalid merge suggestions'));
  assert.equal(h.actions.length,1);assert.equal(h.actions[0].action,'save-taxonomy-proposal');
});

test('excluding a staged core removes dangling core edges while preserving user definitions',async t=>{
  const data=snapshot();data.taxonomyProposal={id:'proposal',createdAt:'now',inputFingerprint:'x',baseVersion:2,coreLimit:60,tags:data.tags.map(tag=>({...tag,status:'draft'})),support:{},merges:[],excluded:[],issues:[],paperIds:[]};
  const h=await harness(data,{page:'vocabulary'});t.after(()=>h.ui.destroy());await h.click('Exclude from core');
  const payload=h.actions[0].payload;assert.equal(payload.tags.some((tag:DisplayTag)=>tag.id==='fc'),false);
  assert.deepEqual(payload.tags.find((tag:DisplayTag)=>tag.id==='pemfc').broaderIds,[]);
  assert.deepEqual(payload.tags.find((tag:DisplayTag)=>tag.id==='rcl').relatedIds,['fc']);
  assert.match(payload.excluded[0].reason,/review/);
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
  assert.equal(h.app.getAttribute('data-smart-tags-state'),'ready');assert.equal(h.button('Approve global vocabulary').disabled,true);
  assert.match(h.app.textContent,/Registry ID constructor is not permitted/);assert.match(h.app.textContent,/__proto__/);
  assert.equal(h.all().filter(node=>node.classList.contains('registry-evidence-entry')).length,4);
  assert.equal(h.all().filter(node=>node.classList.contains('factual-source')).length,0);
  await h.click('Remove unsupported link');assert.deepEqual(h.actions[0],{action:'remove-taxonomy-support',payload:{id:'proposal',tagId:'staged',registryId:'constructor'}});
});

test('malformed consolidation diagnostics remain inspectable and regenerate only after an explicit action',async t=>{
  const data=snapshot();data.queue={status:'paused',total:51,completed:51,failed:0,consolidation:{phase:'invalid-response',correctionAttempts:1,issues:['The provider response did not contain a tags array.'],canRegenerate:true,rawResponses:[{label:'Initial provider response',response:'{"error":"incomplete consolidation"}'}]}};
  const h=await harness(data,{page:'activity'});t.after(()=>h.ui.destroy());
  assert.match(h.app.textContent,/Consolidation diagnostics/);assert.match(h.app.textContent,/1 \/ 1 automatic correction dispatched/);
  assert.match(h.app.textContent,/did not contain a tags array/);assert.equal(h.actions.length,0);
  assert.match(h.app.textContent,/Initial provider response/);assert.match(h.app.textContent,/incomplete consolidation/);
  await h.click('Regenerate proposal');assert.deepEqual(h.actions,[{action:'regenerate-taxonomy',payload:undefined}]);
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
