import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint} from '../src/core.ts';
import type {TagDefinition} from '../src/core.ts';
import type {ReconciliationInput} from '../src/tag-reconciliation.ts';
import {createKeepTagPlan,updateKeptNames,compileKeepRemovals,validKeepTagPlan,nativeTagDecisionKey} from '../src/tag-reconciliation.ts';

const definition=(id:string,name:string,fullName=name):TagDefinition=>({id,name,fullName,description:`Definition of ${fullName}.`,facet:'component',aliases:[],inclusions:[],exclusions:[],examples:[],custom:false,status:'approved',broaderIds:[],relatedIds:[]});
function fixture():ReconciliationInput{return {papers:[1,2].map(itemID=>({id:`paper-${itemID}`,itemID,libraryID:1,key:`P${itemID}`,title:`Synthetic paper ${itemID}`,abstract:'A synthetic scientific experiment.',keywords:[],fingerprint:`metadata-${itemID}`})),nativeTags:{'paper-1':[{tag:'Project',type:0},{tag:'Imported detail',type:1},{tag:'Smart core',type:1},{tag:'Native lock',type:0},{tag:'Definition lock',type:0},{tag:'Co',type:0},{tag:'CO',type:1},{tag:'no_tag',type:0}],'paper-2':[{tag:'Project',type:0},{tag:'Imported detail',type:0},{tag:'Definition lock',type:1}]},definitions:[definition('core','Smart core'),definition('locked','Definition lock'),definition('co','Co','cobalt'),definition('CO','CO','carbon monoxide')],facts:{},decisions:{[nativeTagDecisionKey('paper-1','Native lock')]:{locked:true},'paper-2|locked':{locked:true,rejected:true},'paper-1|co':{locked:true}},vocabularyVersion:3,applied:true};}

test('Keep inventories every exact native name and defaults only protected or previously locked names to checked',()=>{
  const input=fixture(),before=fingerprint(input),plan=createKeepTagPlan(input);assert.equal(validKeepTagPlan(plan),true);assert.equal(plan.inventory.length,8);assert.deepEqual(new Set(plan.keptNames),new Set(['no_tag','Native lock','Definition lock','Co']));
  const imported=plan.inventory.find(row=>row.name==='Imported detail')!;assert.equal(imported.assignmentCount,2);assert.equal(imported.manualCount,1);assert.equal(plan.inventory.find(row=>row.name==='Definition lock')!.lockedCount,1);assert.equal(plan.inventory.find(row=>row.name==='Native lock')!.protected,false);assert.equal(plan.inventory.find(row=>row.name==='no_tag')!.protected,true);assert.ok(!plan.keptNames.includes('CO'));assert.equal(fingerprint(input),before);assert.deepEqual(createKeepTagPlan(input,plan),plan);
});

test('unchecked names remove imported, manual and Smart Tags assignments while exact kept types remain unchanged',()=>{
  const input=fixture(),before=fingerprint(input),plan=updateKeptNames(createKeepTagPlan(input),['Project','no_tag']),changes=compileKeepRemovals(plan,input);
  assert.deepEqual(changes.patches.map(patch=>patch.after),[[{tag:'Project',type:0},{tag:'no_tag',type:0}],[{tag:'Project',type:0}]]);assert.ok(changes.removedNames.includes('Smart core'));assert.equal(changes.overrideCount,3);assert.deepEqual(changes.afterDecisions['paper-2|locked'],{locked:false,rejected:true});assert.deepEqual(changes.afterDecisions[nativeTagDecisionKey('paper-1','Native lock')],{locked:false});assert.deepEqual(changes.afterDecisions['paper-1|co'],{locked:false});for(const [key,after] of Object.entries(changes.afterDecisions))assert.equal(after?.rejected,input.decisions[key]?.rejected);assert.deepEqual(changes.aliases,[]);assert.equal(fingerprint(input),before);
});

test('keeping a name adds neither assignment locks nor permanent rejections',()=>{
  const input=fixture(),plan=createKeepTagPlan(input),changes=compileKeepRemovals(updateKeptNames(plan,plan.inventory.map(row=>row.name)),input);assert.deepEqual(changes.patches,[]);assert.deepEqual(changes.beforeDecisions,{});assert.deepEqual(changes.afterDecisions,{});assert.equal(changes.overrideCount,0);assert.deepEqual(changes.removedNames,[]);
});

test('checkbox updates share the immutable library snapshot instead of copying cached facts on every selection',()=>{
  const input=fixture(),plan=createKeepTagPlan(input),updated=updateKeptNames(plan,[...plan.keptNames,'Project']),unchanged=createKeepTagPlan(input,plan);assert.equal(updated.snapshot,plan.snapshot);assert.equal(updated.inventory,plan.inventory);assert.equal(unchanged.snapshot,plan.snapshot);assert.notEqual(unchanged.keptNames,plan.keptNames);assert.ok(!plan.keptNames.includes('Project'));
});

test('persisted Keep selections are exact unique sets regardless of the order preserved by a refreshed inventory',()=>{
  const plan=createKeepTagPlan(fixture());plan.keptNames.reverse();assert.equal(validKeepTagPlan(plan),true);plan.keptNames.push(plan.keptNames[0]);assert.equal(validKeepTagPlan(plan),false);
});

test('no_tag is protected even in forged unchecked state and aliases or chemical casing never erase exact inventory identities',()=>{
  const input=fixture(),plan=createKeepTagPlan(input);assert.throws(()=>updateKeptNames(plan,plan.keptNames.filter(name=>name!=='no_tag')),/protected|Include again/);const forged=structuredClone(plan);forged.keptNames=[];assert.equal(validKeepTagPlan(forged),false);assert.throws(()=>compileKeepRemovals(forged,input),/protected|Include again/);
  assert.throws(()=>updateKeptNames(plan,['No_Tag']),/exact names/);const changes=compileKeepRemovals(updateKeptNames(plan,['Co','no_tag']),input),first=changes.patches.find(patch=>patch.paperId==='paper-1')!;assert.ok(first.after.some(tag=>tag.tag==='Co'));assert.ok(!first.after.some(tag=>tag.tag==='CO'));assert.equal(changes.afterDecisions['paper-1|co'],undefined);
  const altered=structuredClone(plan);altered.inventory.find(row=>row.name==='no_tag')!.protected=false;altered.keptNames=[];assert.equal(validKeepTagPlan(altered),false);assert.throws(()=>compileKeepRemovals(altered,input),/inventory changed/);
});

test('new tags, changed lock choices and incomplete library inventories invalidate a destructive Keep preview',()=>{
  const input=fixture(),plan=createKeepTagPlan(input),newTag=structuredClone(input);newTag.nativeTags['paper-2'].push({tag:'Added after preview',type:0});assert.throws(()=>compileKeepRemovals(plan,newTag),/changed|Refresh/);const decision=structuredClone(input);decision.decisions['paper-2|locked'].locked=false;assert.throws(()=>compileKeepRemovals(plan,decision),/changed|Refresh/);const unknown=structuredClone(input);unknown.nativeTags['outside-library']=[{tag:'Unknown item',type:0}];assert.throws(()=>createKeepTagPlan(unknown),/outside this library/);assert.throws(()=>updateKeptNames(plan,['not in inventory']),/exact names/);
});

test('an empty library and a library without approved definitions need no AI or tag-list approval for Keep review',()=>{
  const input=fixture();input.applied=false;input.definitions=[];const plan=createKeepTagPlan(input);assert.equal(validKeepTagPlan(plan),true);assert.ok(compileKeepRemovals(plan,input).patches.length>0);input.papers=[];input.nativeTags={};const empty=createKeepTagPlan(input);assert.equal(validKeepTagPlan(empty),true);assert.deepEqual(compileKeepRemovals(empty,input).patches,[]);
});
