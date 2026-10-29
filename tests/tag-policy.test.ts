import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_TAG_ID, NO_TAG_NAME, getNoTagDefinition, isNoTagDefinition, scientificDefinitions, isExcludedByNativeTag, evaluateNoTag } from '../src/tag-policy.ts';
import { buildAnalysisPrompt, buildVocabularyPrompt, findCleanupCandidates, isAutoAssignable, normalizeAnalysis, normalizeTagDefinitions, paperFingerprint, selectSuggestions, validateSuggestions } from '../src/core.ts';
import type { Evidence, PaperRecord, TagDefinition } from '../src/core.ts';

const quote='We study galaxy formation in distant clusters using optical observations and stellar population models.';
function paper(overrides:Partial<PaperRecord>={}):PaperRecord {
  const value:PaperRecord={id:'1:OUTSIDE',itemID:1,libraryID:1,key:'OUTSIDE',title:'Galaxy formation in distant clusters',abstract:quote,keywords:[],fingerprint:'',...overrides};value.fingerprint=paperFingerprint(value);return value;
}
function scientific(overrides:Partial<TagDefinition>={}):TagDefinition {
  return {id:'eis',name:'EIS',fullName:'electrochemical impedance spectroscopy',description:'Electrochemical impedance spectroscopy of electrodes.',facet:'method',custom:false,status:'approved',matchingMode:'auto',aliases:[],inclusions:[],exclusions:[],examples:[],broaderIds:[],relatedIds:[],...overrides};
}
function outside(overrides:Record<string,unknown>={}) {
  return {summary:'The paper studies astronomical objects.',concepts:['galaxy formation'],suggestions:[],newTagCandidates:['An unnecessary scope expansion'],needsPDF:false,noMatch:true,noMatchReason:'The supported astronomical subject is outside the supplied electrochemistry definitions.',noMatchEvidence:[{source:'abstract',text:quote}],...overrides};
}
const context={vocabularyVersion:3};

test('the reserved definition has a stable identity, is review-only, and cannot be mutated through another factory result',()=>{
  const first=getNoTagDefinition(),second=getNoTagDefinition();
  assert.equal(first.id,NO_TAG_ID);assert.equal(first.name,NO_TAG_NAME);assert.equal(first.builtin,'no_tag');assert.equal(first.custom,true);assert.equal(first.status,'approved');assert.equal(first.matchingMode,'manual');assert.deepEqual(first.broaderIds,[]);assert.deepEqual(first.relatedIds,[]);
  first.name='Changed';first.aliases.push('mutable alias');assert.equal(second.name,'no_tag');assert.deepEqual(second.aliases,[]);
  assert.equal(isNoTagDefinition(first),true);assert.equal(isNoTagDefinition(scientific({name:'no_tag'})),true);assert.equal(isNoTagDefinition(scientific({builtin:'no_tag'})),true);
});

test('scientific vocabulary filtering preserves ordinary aliases and chemical distinctions while native exclusion uses the exact reserved name',()=>{
  const cobalt=scientific({id:'co-metal',name:'Co'}),carbonMonoxide=scientific({id:'co-gas',name:'CO'}),ordinary=scientific({id:'ordinary',name:'No_Tag',aliases:['retained prose alias']});
  assert.deepEqual(scientificDefinitions([getNoTagDefinition(),cobalt,carbonMonoxide,ordinary]),[cobalt,carbonMonoxide,ordinary]);
  assert.equal(isExcludedByNativeTag([{tag:'manual project'},{tag:'no_tag'}]),true);assert.equal(isExcludedByNativeTag(['no_tag']),true);
  assert.equal(isExcludedByNativeTag(['No_Tag','Co','CO']),false);assert.equal(isExcludedByNativeTag([]),false);
});

test('no-tag policy requires explicit negative matching and validated substantive paper text rather than a keyword or missing-evidence fallback',()=>{
  const input={noMatch:true,needsPDF:false,matchedTagCount:0,evidence:[{source:'abstract',text:quote}] as Evidence[],reason:'Outside the reviewed vocabulary.',hasVocabulary:true};
  assert.deepEqual(evaluateNoTag(input),{eligible:true,reason:'outsideVocabulary'});
  for(const override of [{noMatch:false},{noMatch:undefined},{needsPDF:true},{matchedTagCount:1},{hasVocabulary:false},{hasRejectedSuggestions:true},{enabled:false},{reason:''},{evidence:[]},{evidence:[{source:'keyword',text:quote}] as Evidence[]},{evidence:[{source:'title',text:'Unknown'}] as Evidence[]}])assert.equal(evaluateNoTag({...input,...override}).eligible,false);
});

test('assignment prompts keep the built-in outside scientific definitions and make noMatch an explicit separately enabled outcome',()=>{
  const value=buildAnalysisPrompt(paper(),[scientific(),getNoTagDefinition()]),data=JSON.parse(value.split('INPUT_DATA_JSON:\n')[1]);
  assert.deepEqual(data.approvedVocabulary.map((tag:TagDefinition)=>tag.id),['eis']);assert.equal(data.noMatchPolicy.enabled,true);
  assert.match(value,/"noMatch":false/);assert.match(value,/"noMatchReason"/);assert.match(value,/"noMatchEvidence"/);
  const partial=JSON.parse(buildAnalysisPrompt(paper(),[scientific()],{allowNoTag:false}).split('INPUT_DATA_JSON:\n')[1]);assert.equal(partial.noMatchPolicy.enabled,false);
  const empty=JSON.parse(buildAnalysisPrompt(paper(),[getNoTagDefinition()]).split('INPUT_DATA_JSON:\n')[1]);assert.deepEqual(empty.approvedVocabulary,[]);assert.equal(empty.noMatchPolicy.enabled,false);
  const vocabulary=JSON.parse(buildVocabularyPrompt([paper()],[getNoTagDefinition(),scientific()]).split('INPUT_DATA_JSON:\n')[1]);assert.deepEqual(vocabulary.existingVocabulary.map((tag:TagDefinition)=>tag.id),['eis']);
});

test('model vocabulary input cannot generate, rename, redefine, alias, or attach hierarchy to no_tag',()=>{
  const base={name:'A scientific topic',description:'A scientific topic scope.',facet:'phenomenon'};
  for(const reserved of [{name:'no_tag'},{id:NO_TAG_ID},{builtin:'no_tag'},{aliases:['no_tag']}])assert.throws(()=>normalizeTagDefinitions({tags:[{...base,...reserved}]},[getNoTagDefinition()]),/reserved/);
  const result=normalizeTagDefinitions({tags:[{...base,broaderIds:[NO_TAG_ID],relatedIds:[NO_TAG_ID]}]},[getNoTagDefinition()]);assert.deepEqual(result[0].broaderIds,[]);assert.deepEqual(result[0].relatedIds,[]);assert.equal(result[0].builtin,undefined);
  assert.deepEqual(findCleanupCandidates(['no_tag','No_Tag'],[getNoTagDefinition()]),[]);
});

test('explicit evidenced noMatch creates one stable review-only suggestion without requiring a persisted built-in',()=>{
  const value=paper(),first=validateSuggestions(value,[scientific()],outside(),context),second=validateSuggestions(value,[scientific(),getNoTagDefinition()],outside(),context);
  assert.equal(first.suggestions.length,1);const suggestion=first.suggestions[0];
  assert.equal(suggestion.tagId,NO_TAG_ID);assert.equal(suggestion.status,'pending');assert.equal(suggestion.autoEligible,false);assert.equal(suggestion.match,'uncertain');assert.deepEqual(suggestion.evidence,[{source:'abstract',text:quote}]);assert.deepEqual(first.newTagCandidates,[]);
  assert.deepEqual(second.suggestions,first.suggestions);
  assert.notEqual(validateSuggestions(value,[scientific()],outside(),{vocabularyVersion:4}).suggestions[0].id,suggestion.id);
});

test('empty, unfinished, evidence-poor, malformed, and partial-vocabulary analyses cannot propose no_tag',()=>{
  for(const raw of [{},{suggestions:[]},outside({noMatch:false}),outside({noMatch:'true'}),outside({needsPDF:true}),outside({noMatchReason:''}),outside({noMatchEvidence:[]}),outside({noMatchEvidence:[{source:'abstract',text:'Invented supporting wording does not occur in this paper.'}]}),outside({noMatchEvidence:[{source:'keyword',text:'galaxy formation'}]})]){
    const value=paper({keywords:['galaxy formation']});assert.equal(validateSuggestions(value,[scientific()],raw,context).suggestions.length,0);
  }
  assert.equal(validateSuggestions(paper(),[],outside(),context).suggestions.length,0);
  assert.equal(validateSuggestions(paper(),[getNoTagDefinition()],outside(),context).suggestions.length,0);
  assert.equal(validateSuggestions(paper(),[scientific()],outside(),{...context,allowNoTag:false}).suggestions.length,0);
  assert.throws(()=>validateSuggestions(paper(),[scientific()],'Malformed model output',context),/JSON/);
  assert.throws(()=>normalizeAnalysis({noMatch:true,noMatchEvidence:'fabricated text'}),/must be an array/);
  assert.deepEqual(normalizeAnalysis({noMatch:false,noMatchEvidence:null}).noMatchEvidence,[]);
});

test('adequate title or PDF evidence can support a reviewed outside-vocabulary suggestion while reference-list evidence cannot',()=>{
  const title='Optical observations of galaxy formation in distant stellar clusters',titlePaper=paper({title,abstract:''});
  assert.equal(validateSuggestions(titlePaper,[scientific()],outside({noMatchEvidence:[{source:'title',text:title}]}),context).suggestions[0]?.tagId,NO_TAG_ID);
  const pdfPaper=paper({abstract:'',pdfText:`Introduction\n${quote}\nReferences\nAn irrelevant bibliographic entry.`});
  assert.equal(validateSuggestions(pdfPaper,[scientific()],outside({noMatchEvidence:[{source:'pdf',text:quote}]}),context).suggestions[0]?.tagId,NO_TAG_ID);
  const referencePaper=paper({abstract:'',pdfText:`Introduction\nAvailable text is incomplete.\nReferences\n${quote}`});
  assert.equal(validateSuggestions(referencePaper,[scientific()],outside({noMatchEvidence:[{source:'pdf',text:quote}]}),context).suggestions.length,0);
});

test('any validated core or DIY match blocks no_tag, including incidental or low-confidence matches and a zero core quota',()=>{
  for(const tag of [scientific(),scientific({id:'detail',custom:true,matchingMode:'suggest'})])for(const confidence of ['high','low']){
    const raw=outside({suggestions:[{tagId:tag.id,reason:'A supplied definition matches the paper.',confidence,match:'incidental',evidence:[{source:'abstract',text:quote}]}]});
    assert.equal(validateSuggestions(paper(),[tag],raw,context).suggestions.some(suggestion=>suggestion.tagId===NO_TAG_ID),false);
    assert.equal(validateSuggestions(paper(),[tag],raw,{...context,coreLimit:0}).suggestions.some(suggestion=>suggestion.tagId===NO_TAG_ID),false);
  }
});

test('invalid, rejected, locked, or symbol-conflicting scientific suggestions cannot be reinterpreted as no supported matches',()=>{
  const base={tagId:'eis',reason:'Claimed match.',confidence:'high',match:'substantive',evidence:[{source:'abstract',text:quote}]};
  for(const suggestion of [{...base,tagId:'invented'},{...base,evidence:[]},{...base,evidence:[{source:'abstract',text:'Unverifiable quotation'}]}])assert.equal(validateSuggestions(paper(),[scientific()],outside({suggestions:[suggestion]}),context).suggestions.length,0);
  for(const decision of [{rejectedTagIds:['eis']},{lockedTagIds:['eis']}])assert.equal(validateSuggestions(paper(),[scientific()],outside({suggestions:[base]}),{...context,...decision}).suggestions.length,0);
  const chemicalPaper=paper({abstract:'We measure CO adsorption on the electrode in these experiments.'}),raw=outside({suggestions:[{...base,tagId:'cobalt',evidence:[{source:'abstract',text:chemicalPaper.abstract}]}],noMatchEvidence:[{source:'abstract',text:chemicalPaper.abstract}]});
  assert.equal(validateSuggestions(chemicalPaper,[scientific({id:'cobalt',name:'Co'})],raw,context).suggestions.length,0);
});

test('remembered no_tag rejection and locks survive model reruns, and ordinary suggestion payloads cannot assign the reserved tag',()=>{
  for(const decision of [{rejectedTagIds:[NO_TAG_ID]},{lockedTagIds:[NO_TAG_ID]}])assert.equal(validateSuggestions(paper(),[scientific()],outside(),{...context,...decision}).suggestions.length,0);
  const raw=outside({suggestions:[{tagId:NO_TAG_ID,reason:'Bypass explicit outcome validation.',confidence:'high',match:'substantive',evidence:[{source:'abstract',text:quote}]}]});
  assert.equal(validateSuggestions(paper(),[scientific(),getNoTagDefinition()],raw,context).suggestions.length,0);
});

test('the reserved suggestion never becomes an automatic scientific assignment even if its mode and eligibility are forged',()=>{
  const value=paper(),suggestion=validateSuggestions(value,[scientific()],outside(),context).suggestions[0],forged={...suggestion,autoEligible:true,confidence:'high' as const,match:'substantive' as const};
  assert.equal(isAutoAssignable(forged,value,[{...getNoTagDefinition(),matchingMode:'auto'}],{...context,pilotApproved:true}),false);
  assert.deepEqual(selectSuggestions([forged],[{...getNoTagDefinition(),matchingMode:'auto'}]),[]);
  assert.equal(validateSuggestions(value,[scientific()],outside(),{...context,coreLimit:0}).suggestions[0].tagId,NO_TAG_ID);
});
