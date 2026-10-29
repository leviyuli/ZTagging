import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint,paperFingerprint} from '../src/core.ts';
import type {PaperRecord,TagDefinition} from '../src/core.ts';
import {createReconciliationPlan,buildReconciliationPrompt,applyReconciliationAnalysis,compileReconciliationChanges,buildDIYDefinitionPrompt,applyDIYDefinitions,prepareDIYDefinitions,nativeTagDecisionKey} from '../src/tag-reconciliation.ts';
import type {ReconciliationInput,ReconciliationPlan,ReconciliationGroup} from '../src/tag-reconciliation.ts';
const definition=(id:string,name:string,extra:Partial<TagDefinition>={}):TagDefinition=>({id,name,fullName:name,description:`Scientific scope of ${name}.`,facet:'system',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[],...extra});
const we=()=>definition('we','WE',{fullName:'water electrolysis',aliases:['water electrolyzer']});
function input(labels=['water electrolysis','water electrolyzers'],definitions=[we()]):ReconciliationInput {
  const papers=labels.map((label,index)=>{const paper:PaperRecord={id:`paper-${index}`,itemID:index+1,libraryID:1,key:`P${index}`,title:`Experiment ${index}`,abstract:`We investigate ${label} in this experiment.`,keywords:[],fingerprint:''};paper.fingerprint=paperFingerprint(paper);return paper;});
  return {papers,nativeTags:Object.fromEntries(papers.map((paper,index)=>[paper.id,[{tag:labels[index],type:index%2}]])),definitions,facts:{},decisions:{},vocabularyVersion:3,applied:true};
}
const group=(plan:ReconciliationPlan,source:string)=>plan.groups.find(group=>group.source===source)!;
const response=(plan:ReconciliationPlan,mappings:unknown[])=>({planId:plan.id,fingerprint:plan.fingerprint,mappings});
function mapping(plan:ReconciliationPlan,group:ReconciliationGroup,paperId:string,targetIds:string[],relation='equivalent') {const assignment=group.assignments.find(value=>value.paperId===paperId)!;return {groupId:group.id,paperId,sourceFingerprint:assignment.sourceFingerprint,targetIds,relation,reason:'The passage establishes this scientific interpretation.',evidence:[{source:'abstract',text:plan.snapshot.papers.find(paper=>paper.id===paperId)!.abstract}]};}
function diyResponse(plan:ReconciliationPlan,group:ReconciliationGroup,extra:Record<string,unknown>={}) {return {planId:plan.id,fingerprint:plan.fingerprint,definitions:[{groupId:group.id,description:`Studies of ${group.source}.`,facet:'phenomenon',support:group.assignments.map(value=>({paperId:value.paperId,sourceFingerprint:value.sourceFingerprint,evidence:[{source:'abstract',text:plan.snapshot.papers.find(paper=>paper.id===value.paperId)!.abstract}]})),...extra}]};}

test('applied vocabulary determines canonical targets instead of native order or arbitrary capitalization',()=>{
  const value=input(['Water electrolysis','water electrolysis','water electrolyzers']),before=fingerprint(value),plan=createReconciliationPlan(value),changes=compileReconciliationChanges(plan,plan.groups.map(group=>({groupId:group.id,action:'replace'})),value);
  assert.ok(plan.groups.every(group=>group.status==='match'&&group.targetId==='we'));assert.ok(changes.patches.every(patch=>patch.after[0].tag==='WE'));assert.equal(changes.patches.length,3);assert.equal(fingerprint(value),before);assert.deepEqual(value.definitions,[we()]);
  const noVocabulary=input(['Water electrolysis','water electrolysis'],[]),unmatched=createReconciliationPlan(noVocabulary);assert.ok(unmatched.groups.every(group=>group.status==='unmatched'));assert.deepEqual(compileReconciliationChanges(unmatched,[],noVocabulary).patches,[]);
});
test('unapplied proposals cannot become cleanup authority and exact native labels survive whitespace and long labels',()=>{
  const value=input(['  Water   electrolysis  ','x'.repeat(210)]),plan=createReconciliationPlan(value);assert.ok(plan.groups.some(group=>group.source==='  Water   electrolysis  '));assert.equal(group(plan,'x'.repeat(210)).source.length,210);
  const changes=compileReconciliationChanges(plan,[{groupId:group(plan,'  Water   electrolysis  ').id,action:'replace'}],value);assert.equal(changes.patches[0].before[0].tag,'  Water   electrolysis  ');assert.equal(changes.patches[0].after[0].tag,'WE');
  value.applied=false;const pending=createReconciliationPlan(value);assert.ok(pending.groups.every(group=>group.status==='unmatched'));assert.throws(()=>compileReconciliationChanges(pending,[],value),/Apply a vocabulary/);
});
test('chemical symbols, pH, and distinct technologies never become spelling aliases',()=>{
  const definitions=[definition('cobalt','Co',{facet:'component',fullName:'cobalt'}),definition('carbon','CO',{facet:'component',fullName:'carbon monoxide'}),definition('fc','FC',{fullName:'fuel cell'}),definition('aem','AEMFC',{fullName:'anion exchange membrane fuel cell',broaderIds:['fc']})],value=input(['Co','CO','AEMFC','FC','pH'],definitions),plan=createReconciliationPlan(value);
  assert.equal(group(plan,'Co').targetId,'cobalt');assert.equal(group(plan,'CO').targetId,'carbon');assert.equal(group(plan,'AEMFC').targetId,'aem');assert.equal(group(plan,'FC').targetId,'fc');assert.equal(group(plan,'pH').status,'unmatched');assert.ok(!group(plan,'Co').candidates.some(value=>value.tagId==='carbon'));
  const changes=compileReconciliationChanges(plan,[{groupId:group(plan,'Co').id,action:'replace'}],value);assert.deepEqual(changes.patches,[],'already canonical assignments retain original tag types');
});
test('ambiguous acronyms require paper-specific interpretation with literal snapshot bindings',()=>{
  const definitions=[definition('membrane','membrane',{fullName:'proton exchange membrane',facet:'component',aliases:['PEM']}),definition('electrolysis','PEMWE',{fullName:'proton exchange membrane water electrolysis',aliases:['PEM']})],value=input(['PEM','PEM'],definitions),plan=createReconciliationPlan(value),source=group(plan,'PEM');assert.equal(source.status,'choice');assert.equal(source.targetId,undefined);
  const resolved=applyReconciliationAnalysis(plan,response(plan,[mapping(plan,source,'paper-0',['membrane']),mapping(plan,source,'paper-1',['electrolysis'])]));assert.equal(group(resolved,'PEM').status,'match');assert.equal(group(resolved,'PEM').targetId,undefined);const changes=compileReconciliationChanges(resolved,[{groupId:source.id,action:'replace'}],value);assert.deepEqual(changes.patches.map(patch=>patch.after[0].tag),['membrane','PEMWE']);assert.deepEqual(changes.aliases,[]);
  const bad=mapping(plan,source,'paper-0',['membrane']);bad.sourceFingerprint='stale';assert.throws(()=>applyReconciliationAnalysis(plan,response(plan,[bad])),/binding/);assert.throws(()=>applyReconciliationAnalysis(plan,{...response(plan,[]),planId:'other'}),/snapshot/);assert.equal(source.status,'choice');
});
test('comparison papers can replace a broad technology with multiple approved supported subtypes without false aliases',()=>{
  const definitions=[definition('fc','FC',{fullName:'fuel cell'}),definition('aem','AEMFC',{fullName:'anion exchange membrane fuel cell',broaderIds:['fc']}),definition('pem','PEMFC',{fullName:'proton exchange membrane fuel cell',broaderIds:['fc']})],value=input(['FC'],definitions),plan=createReconciliationPlan(value),source=group(plan,'FC'),resolved=applyReconciliationAnalysis(plan,response(plan,[mapping(plan,source,'paper-0',['aem','pem'],'narrower')])),changes=compileReconciliationChanges(resolved,[{groupId:source.id,action:'replace'}],value);
  assert.deepEqual(changes.patches[0].after.map(value=>value.tag),['AEMFC','PEMFC']);assert.deepEqual(changes.aliases,[]);assert.throws(()=>applyReconciliationAnalysis(plan,response(plan,[mapping(plan,source,'paper-0',['aem'],'equivalent')])),/scientific/);
});
test('AI cannot import evidence from another paper, invent quotes, or authorize Co versus CO contradictions',()=>{
  const value=input(['unknown'],[definition('carbon','CO',{fullName:'carbon monoxide'})]);value.papers[0].abstract='Co nanoparticles are a cobalt catalyst.';const plan=createReconciliationPlan(value),source=plan.groups[0],valid=mapping(plan,source,'paper-0',['carbon']);assert.throws(()=>applyReconciliationAnalysis(plan,response(plan,[valid])),/scientific/);
  const invented={...valid,evidence:[{source:'abstract',text:'An invented quotation.'}]};assert.throws(()=>applyReconciliationAnalysis(plan,response(plan,[invented])),/passage/);const foreign={...valid,supportFactConceptIds:['outside-paper']};assert.throws(()=>applyReconciliationAnalysis(plan,response(plan,[foreign])),/outside/);
});
test('bounded context requests exclude full PDFs and reject out-of-batch or omitted paper mappings',()=>{
  const value=input(['niche','niche']);value.papers[0].pdfText='PRIVATE_PDF_BODY'.repeat(100000);const plan=createReconciliationPlan(value),source=plan.groups[0],prompt=buildReconciliationPrompt(plan,[source.id],['paper-0']),data=JSON.parse(prompt.split('INPUT_DATA_JSON:\n')[1]);assert.equal(data.groups[0].assignments.length,1);assert.ok(!prompt.includes('PRIVATE_PDF_BODY'));
  assert.throws(()=>applyReconciliationAnalysis(plan,response(plan,[mapping(plan,source,'paper-1',['we'])]),{groupIds:[source.id],paperIds:['paper-0']}),/batch/);assert.throws(()=>applyReconciliationAnalysis(plan,response(plan,[]),{groupIds:[source.id],paperIds:['paper-0']}),/omitted/);
  const result=applyReconciliationAnalysis(plan,response(plan,[mapping(plan,source,'paper-0',['we'])]),{groupIds:[source.id],paperIds:['paper-0']});assert.equal(result.groups[0].assignments[1].status,'unmatched');
});
test('current paper, native assignment, definition and decision changes invalidate a reviewed preview',()=>{
  const value=input(),plan=createReconciliationPlan(value),selections=[{groupId:plan.groups[0].id,action:'replace' as const}];for(const change of [(data:ReconciliationInput)=>data.papers[0].abstract+='Changed.',(data:ReconciliationInput)=>data.nativeTags['paper-0'].push({tag:'Later manual',type:0}),(data:ReconciliationInput)=>data.definitions[0].name='New canonical name',(data:ReconciliationInput)=>data.decisions['paper-0|we']={locked:true}]){const modified=structuredClone(value);change(modified);assert.throws(()=>compileReconciliationChanges(plan,selections,modified),/changed/);}assert.equal(createReconciliationPlan(value,plan).id,plan.id);
});
test('locked and rejected choices require explicit overrides and produce reversible decision deltas',()=>{
  const value=input(['water electrolysis']);value.decisions['paper-0|we']={locked:true,rejected:true};const plan=createReconciliationPlan(value),selection={groupId:plan.groups[0].id,action:'replace' as const};assert.throws(()=>compileReconciliationChanges(plan,[selection],value),/override/);
  const result=compileReconciliationChanges(plan,[{...selection,overrideConflicts:true}],value);assert.deepEqual(result.beforeDecisions['paper-0|we'],{locked:true,rejected:true});assert.deepEqual(result.afterDecisions['paper-0|we'],{locked:false,rejected:false});assert.deepEqual(value.decisions['paper-0|we'],{locked:true,rejected:true});
});
test('multi-source replacements deduplicate an existing native target without taking ownership or touching unrelated assignments',()=>{
  const value=input(['water electrolysis']);value.nativeTags['paper-0'].push({tag:'water electrolyzers',type:1},{tag:'WE',type:1},{tag:'Project Alpha',type:0});const plan=createReconciliationPlan(value),result=compileReconciliationChanges(plan,plan.groups.filter(group=>group.source.startsWith('water')).map(group=>({groupId:group.id,action:'replace'})),value);
  assert.deepEqual(result.patches[0].after,[{tag:'WE',type:1},{tag:'Project Alpha',type:0}]);assert.deepEqual(result.beforeDecisions,{});assert.deepEqual(result.afterDecisions,{});
});
test('confirmed DIY definitions preserve native names, stable IDs and all existing assignments while remaining suggestion-only',()=>{
  const value=input(['grooved catalyst layer','grooved catalyst layer']),plan=createReconciliationPlan(value),source=plan.groups[0],before=fingerprint(value),analyzed=applyDIYDefinitions(plan,diyResponse(plan,source)),result=prepareDIYDefinitions(analyzed,[{groupId:source.id}],value);assert.equal(result.questions.length,0);assert.equal(result.definitions.length,1);const tag=result.definitions[0];assert.equal(tag.id,source.diy.tagId);assert.equal(tag.name,source.source);assert.equal(tag.custom,true);assert.equal(tag.status,'approved');assert.equal(tag.matchingMode,'suggest');assert.deepEqual(tag.broaderIds,[]);assert.equal(fingerprint(value),before);assert.equal(createReconciliationPlan(value,analyzed).groups[0].diy.status,'ready');
});
test('long DIY names require explicit shortening and retain exact legacy aliases',()=>{
  const label='A niche scientific surface phenomenon with a very long existing native tag name that exceeds eighty characters',value=input([label]),plan=createReconciliationPlan(value),source=plan.groups[0],analyzed=applyDIYDefinitions(plan,diyResponse(plan,source));assert.equal(prepareDIYDefinitions(analyzed,[{groupId:source.id}],value).definitions.length,0);const shortened=prepareDIYDefinitions(analyzed,[{groupId:source.id,name:'niche surface phenomenon'}],value);assert.equal(shortened.questions.length,0);assert.equal(shortened.definitions[0].name,'niche surface phenomenon');assert.deepEqual(shortened.definitions[0].aliases,[label]);assert.ok(buildDIYDefinitionPrompt(plan,[source.id]).includes(label));
});
test('ambiguous and incompletely supported DIY meanings remain questions instead of guessed shared definitions',()=>{
  const value=input(['ML','ML']),plan=createReconciliationPlan(value),source=plan.groups[0],partial=diyResponse(plan,source);partial.definitions[0].support=partial.definitions[0].support.slice(0,1);assert.throws(()=>applyDIYDefinitions(plan,partial),/every paper/);
  const questioned=applyDIYDefinitions(plan,{planId:plan.id,fingerprint:plan.fingerprint,definitions:[{groupId:source.id,question:'Does ML mean machine learning or mass loss in these papers?'}]});assert.equal(prepareDIYDefinitions(questioned,[{groupId:source.id}],value).definitions.length,0);assert.match(prepareDIYDefinitions(questioned,[{groupId:source.id}],value).questions[0].message,/mass loss/);
  const cobalt=input(['Co'],[]),cobaltPlan=createReconciliationPlan(cobalt);assert.throws(()=>applyDIYDefinitions(cobaltPlan,diyResponse(cobaltPlan,cobaltPlan.groups[0],{description:'Carbon monoxide molecules.'})),/chemical/);
});

test('a mixed group previews known papers while paper-level choices resolve only selected uncertain rows',()=>{
  const value=input(['niche','niche','niche']),plan=createReconciliationPlan(value),source=plan.groups[0],analyzed=applyReconciliationAnalysis(plan,response(plan,[mapping(plan,source,'paper-0',['we']),mapping(plan,source,'paper-1',['we']),{...mapping(plan,source,'paper-2',[]),relation:'ambiguous'}]));
  const defaults=compileReconciliationChanges(analyzed,[{groupId:source.id,action:'replace'}],value);assert.deepEqual(defaults.patches.map(patch=>patch.paperId),['paper-0','paper-1']);
  const chosen=compileReconciliationChanges(analyzed,[{groupId:source.id,action:'replace',paperIds:['paper-2'],paperTargets:[{paperId:'paper-2',targetIds:['we']}]}],value);assert.deepEqual(chosen.patches.map(patch=>patch.paperId),['paper-2']);assert.equal(chosen.patches[0].after[0].tag,'WE');assert.throws(()=>compileReconciliationChanges(analyzed,[{groupId:source.id,action:'replace',paperTargets:[{paperId:'paper-2',targetIds:['foreign']}]}],value),/offered/);
});

test('Keep persists an exact native-label lock without paper writes and explicit overrides provide undoable deltas',()=>{
  const value=input(['water electrolysis']),plan=createReconciliationPlan(value),source=plan.groups[0],kept=compileReconciliationChanges(plan,[{groupId:source.id,action:'keep'}],value),key=nativeTagDecisionKey('paper-0',source.source);
  assert.deepEqual(kept.patches,[]);assert.equal(kept.beforeDecisions[key],null);assert.deepEqual(kept.afterDecisions[key],{locked:true});assert.notEqual(key,nativeTagDecisionKey('paper-0','Water electrolysis'));
  const persisted=structuredClone(value);Object.assign(persisted.decisions,kept.afterDecisions);const rescanned=createReconciliationPlan(persisted),again=group(rescanned,source.source);assert.equal(again.status,'choice');assert.equal(again.reason,'Kept unchanged by the researcher.');assert.equal(again.assignments[0].conflict,true);
  for(const action of ['replace','remove'] as const)assert.throws(()=>compileReconciliationChanges(rescanned,[{groupId:again.id,action}],persisted),/override/);
  const override=compileReconciliationChanges(rescanned,[{groupId:again.id,action:'replace',overrideConflicts:true}],persisted);assert.deepEqual(override.beforeDecisions[key],{locked:true});assert.deepEqual(override.afterDecisions[key],{locked:false});assert.equal(override.patches[0].after[0].tag,'WE');
  const undone=structuredClone(persisted);Object.assign(undone.decisions,override.beforeDecisions);assert.equal(group(createReconciliationPlan(undone),source.source).reason,'Kept unchanged by the researcher.');
});

test('per-paper inferred meanings remain grounded and a group meaning appears only when every paper agrees',()=>{
  const value=input(['ML','ML']),plan=createReconciliationPlan(value),source=plan.groups[0],first={...mapping(plan,source,'paper-0',[],'unmatched'),inferredMeaning:'Machine learning for materials prediction.'},second={...mapping(plan,source,'paper-1',[],'unmatched'),inferredMeaning:'Electrode mass loss during corrosion.'},different=applyReconciliationAnalysis(plan,response(plan,[first,second]));assert.equal(different.groups[0].inferredMeaning,undefined);assert.equal(different.groups[0].assignments[0].meaning,first.inferredMeaning);assert.equal(different.groups[0].assignments[1].meaning,second.inferredMeaning);
  const same=applyReconciliationAnalysis(plan,response(plan,[first,{...second,inferredMeaning:first.inferredMeaning}]));assert.equal(same.groups[0].inferredMeaning,first.inferredMeaning);assert.ok(buildReconciliationPrompt(plan).includes('inferredMeaning'));
  assert.throws(()=>applyReconciliationAnalysis(plan,response(plan,[{...first,evidence:[]}])) ,/passage/);
});

test('reviewed source replacements compose simultaneously regardless of selection order',()=>{
  const definitions=[definition('fc','FC',{fullName:'fuel cell',aliases:['legacy fuel cell']}),definition('aem','AEMFC',{fullName:'anion exchange membrane fuel cell',broaderIds:['fc']})],value=input(['legacy fuel cell'],definitions);value.nativeTags['paper-0'].push({tag:'FC',type:1},{tag:'Manual project',type:0});
  const plan=createReconciliationPlan(value),legacy={groupId:group(plan,'legacy fuel cell').id,action:'replace' as const},refinement={groupId:group(plan,'FC').id,action:'replace' as const,targetId:'aem'},forward=compileReconciliationChanges(plan,[legacy,refinement],value),reverse=compileReconciliationChanges(plan,[refinement,legacy],value);
  assert.deepEqual(forward.patches,reverse.patches);assert.deepEqual(forward.patches[0].after,[{tag:'Manual project',type:0},{tag:'AEMFC',type:0},{tag:'FC',type:0}]);assert.deepEqual(forward.patches[0].before,value.nativeTags['paper-0']);assert.deepEqual(forward.beforeDecisions,{});assert.deepEqual(forward.afterDecisions,{});
});

test('long native labels sharing a truncated prefix remain distinct while exact legacy aliases still match',()=>{
  const prefix='scientific description '.repeat(9),exact=`${prefix}alpha`,different=`${prefix}beta`,value=input([exact,different],[definition('topic','detail',{custom:true,facet:'phenomenon',aliases:[exact]})]),plan=createReconciliationPlan(value);
  assert.equal(group(plan,exact).status,'match');assert.equal(group(plan,different).status,'unmatched');const result=compileReconciliationChanges(plan,[{groupId:group(plan,exact).id,action:'replace'}],value);assert.equal(result.patches.length,1);assert.equal(result.patches[0].before[0].tag,exact);assert.deepEqual(value.nativeTags['paper-1'],[{tag:different,type:1}]);
});
