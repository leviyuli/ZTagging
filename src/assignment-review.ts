import {allocateOpaqueId,canonicalTagKey,fingerprint,paperFingerprint,validateEvidence} from './core.ts';
import type {Evidence,PaperRecord,Suggestion,TagDefinition,ValidationResult} from './core.ts';
import {hasAdequateNoTagEvidence,isNoTagDefinition,NO_TAG_ID} from './tag-policy.ts';
import {terminologyFor} from './naming.ts';

export interface ReviewSuggestion extends Suggestion {
  operation?:'add'|'remove';applied?:boolean;decisionOrigin?:'automatic'|'researcher';runId?:string;
}
export interface AssignmentRunRecord {
  id:string;paperIds:string[];vocabularyVersion:number;status:'analysis'|'review'|'finished';suggestionIds:string[];createdAt:string;finishedAt?:string;
}
export interface AssignmentReviewJob {paperId:string;status:'pending'|'running'|'completed'|'skipped';error?:string}
export interface AssignmentReviewProgress {analysisCompleted:number;analysisTotal:number;pending:number;accepted:number;applied:number;rejected:number;canFinish:boolean}
export interface UncoveredTopicRecord {
  id:string;runId:string;paperId:string;kind:'topic'|'outside-vocabulary';name?:string;reason:string;evidence:Evidence[];inputFingerprint:string;vocabularyVersion:number;vocabularyFingerprint?:string;provider:string;model:string;status:'active'|'resolved'|'dismissed';createdAt:string;updatedAt:string;resolvedAt?:string;
}
export interface UncoveredTopicGroup {id:string;kind:UncoveredTopicRecord['kind'];name:string;paperIds:string[];recordIds:string[];count:number}
const unique=(values:readonly string[])=>[...new Set(values)].sort();
const sameEvidence=(paper:PaperRecord,evidence:readonly Evidence[])=>fingerprint(validateEvidence(paper,evidence))===fingerprint(evidence);
const currentFingerprint=(paper:PaperRecord)=>paper.fingerprint||paperFingerprint(paper);
const approvedVocabularyFingerprint=(definitions:readonly TagDefinition[])=>fingerprint(definitions.filter(tag=>tag.status==='approved'&&!isNoTagDefinition(tag)).sort((a,b)=>a.id.localeCompare(b.id)));
const reportTopicNames=new Map(['DRT analysis','distribution of relaxation time','distribution of relaxation times','distribution of relaxation time analysis','distribution of relaxation times analysis'].map(name=>[canonicalTagKey(name),'DRT analysis']));
const reportTopicName=(name:string)=>reportTopicNames.get(canonicalTagKey(name))??terminologyFor(name)?.name??name;

export function createAssignmentRun(input:{id?:string;paperIds:readonly string[];vocabularyVersion:number;createdAt?:string}):AssignmentRunRecord {
  return {id:input.id??allocateOpaqueId('assignment'),paperIds:unique(input.paperIds),vocabularyVersion:input.vocabularyVersion,status:'analysis',suggestionIds:[],createdAt:input.createdAt??new Date().toISOString()};
}

/** Review triage never changes native tags or the persistent manual-decision map. */
export function triageAssignmentSuggestions<T extends ReviewSuggestion>(suggestions:readonly T[],definitions:readonly TagDefinition[],papers:Record<string,PaperRecord>,decisions:Record<string,{locked?:boolean;rejected?:boolean}>,runId?:string):T[] {
  const tags=new Map(definitions.map(tag=>[tag.id,tag]));
  return suggestions.map(suggestion=>{
    if(suggestion.applied||suggestion.decisionOrigin==='researcher'||suggestion.status!=='pending'&&suggestion.decisionOrigin!=='automatic')return {...suggestion};
    const protectedChoice=decisions[`${suggestion.paperId}|${suggestion.tagId}`];
    if(protectedChoice?.locked||protectedChoice?.rejected)return {...suggestion};
    const paper=papers[suggestion.paperId],tag=tags.get(suggestion.tagId),fresh=!!paper&&suggestion.inputFingerprint===currentFingerprint(paper),grounded=fresh&&sameEvidence(paper,suggestion.evidence)&&hasAdequateNoTagEvidence(suggestion.evidence);
    const status:Suggestion['status']=suggestion.operation==='remove'||suggestion.tagId===NO_TAG_ID?'pending':suggestion.confidence==='low'?'rejected':suggestion.confidence==='high'&&suggestion.match==='substantive'&&grounded&&tag?.status==='approved'&&!isNoTagDefinition(tag)&&tag.matchingMode!=='manual'?'accepted':'pending';
    return {...suggestion,status,decisionOrigin:'automatic',...(runId?{runId}:{})};
  });
}
function runSuggestions(run:AssignmentRunRecord,suggestions:readonly ReviewSuggestion[]):ReviewSuggestion[] {
  const ids=new Set(run.suggestionIds),papers=new Set(run.paperIds);return suggestions.filter(suggestion=>papers.has(suggestion.paperId)&&(suggestion.runId===run.id||ids.has(suggestion.id))&&suggestion.vocabularyVersion===run.vocabularyVersion);
}
export function assignmentRunProgress(run:AssignmentRunRecord,jobs:readonly AssignmentReviewJob[],suggestions:readonly ReviewSuggestion[]):AssignmentReviewProgress {
  const scoped=runSuggestions(run,suggestions),byPaper=new Map(jobs.map(job=>[job.paperId,job])),analysisCompleted=run.paperIds.filter(id=>{const job=byPaper.get(id);return job?.status==='skipped'||job?.status==='completed'&&!job.error;}).length,pending=scoped.filter(suggestion=>suggestion.status==='pending'&&!suggestion.applied).length;
  return {analysisCompleted,analysisTotal:run.paperIds.length,pending,accepted:scoped.filter(suggestion=>suggestion.status==='accepted'&&!suggestion.applied).length,applied:scoped.filter(suggestion=>suggestion.applied).length,rejected:scoped.filter(suggestion=>suggestion.status==='rejected'&&!suggestion.applied).length,canFinish:analysisCompleted===run.paperIds.length&&pending===0};
}
export function updateAssignmentRun(run:AssignmentRunRecord,jobs:readonly AssignmentReviewJob[],suggestions:readonly ReviewSuggestion[]):AssignmentRunRecord {
  if(run.status==='finished')return {...run,paperIds:[...run.paperIds],suggestionIds:[...run.suggestionIds]};const scoped=suggestions.filter(suggestion=>suggestion.runId===run.id&&run.paperIds.includes(suggestion.paperId));const next={...run,suggestionIds:unique([...run.suggestionIds,...scoped.map(suggestion=>suggestion.id)])},progress=assignmentRunProgress(next,jobs,suggestions);return {...next,status:progress.analysisCompleted===progress.analysisTotal?'review':'analysis'};
}
export function finishAssignmentRun(run:AssignmentRunRecord,jobs:readonly AssignmentReviewJob[],suggestions:readonly ReviewSuggestion[],finishedAt=new Date().toISOString()):AssignmentRunRecord {
  const next=updateAssignmentRun(run,jobs,suggestions),progress=assignmentRunProgress(next,jobs,suggestions);if(!progress.canFinish||progress.accepted>0)throw new Error('Finish analysis, resolve pending choices and apply accepted suggestions before completing this review.');return {...next,status:'finished',finishedAt};
}

/** Observation and resolution are separate: saving a vocabulary cannot resolve a paper outcome. */
export function updateUncoveredTopics(records:readonly UncoveredTopicRecord[],input:{runId:string;paper:PaperRecord;analysis:ValidationResult;provider:string;model:string;vocabularyVersion:number;definitions?:readonly TagDefinition[];now?:string}):UncoveredTopicRecord[] {
  const now=input.now??new Date().toISOString(),inputFingerprint=currentFingerprint(input.paper),vocabularyFingerprint=input.definitions?approvedVocabularyFingerprint(input.definitions):undefined,topics=(input.analysis.uncoveredTopics??[]).filter(topic=>topic.name.trim()&&topic.reason.trim()&&topic.evidence.length&&sameEvidence(input.paper,topic.evidence)).map(topic=>({kind:'topic' as const,name:topic.name,reason:topic.reason,evidence:topic.evidence}));
  const noMatchEvidence=validateEvidence(input.paper,input.analysis.noMatchEvidence);const outcomes:{kind:UncoveredTopicRecord['kind'];name?:string;reason:string;evidence:Evidence[]}[]=[...topics];
  if(input.analysis.noMatchEligible&&input.analysis.noMatchReason?.trim()&&hasAdequateNoTagEvidence(noMatchEvidence))outcomes.push({kind:'outside-vocabulary',reason:input.analysis.noMatchReason,evidence:noMatchEvidence});
  const next=records.map(record=>({...record,evidence:record.evidence.map(quote=>({...quote}))}));
  for(const topic of outcomes){const id=`uncovered-${fingerprint([input.runId,input.paper.id,inputFingerprint,input.vocabularyVersion,topic.kind,topic.name??'',topic.reason,topic.evidence])}`,existing=next.find(record=>record.id===id);if(existing){existing.updatedAt=now;continue;}next.push({id,runId:input.runId,paperId:input.paper.id,...topic,evidence:topic.evidence.map(quote=>({...quote})),inputFingerprint,vocabularyVersion:input.vocabularyVersion,...(vocabularyFingerprint!==undefined?{vocabularyFingerprint}:{}),provider:input.provider,model:input.model,status:'active',createdAt:now,updatedAt:now});}
  return next;
}
function topicMatchesTag(name:string,tag:TagDefinition):boolean {
  const named=terminologyFor(name)?.name,identity=terminologyFor(tag.name)?.name??terminologyFor(tag.fullName??'')?.name;if(named&&identity)return named===identity;return [tag.name,tag.fullName??'',...tag.aliases].some(label=>canonicalTagKey(reportTopicName(label))===canonicalTagKey(reportTopicName(name)));
}
export function resolveUncoveredTopics(records:readonly UncoveredTopicRecord[],input:{paper:PaperRecord;vocabularyVersion:number;appliedSuggestions:readonly ReviewSuggestion[];definitions:readonly TagDefinition[];now?:string}):UncoveredTopicRecord[] {
  const inputFingerprint=currentFingerprint(input.paper),tags=new Map(input.definitions.map(tag=>[tag.id,tag])),matched=input.appliedSuggestions.filter(suggestion=>suggestion.applied&&suggestion.operation!=='remove'&&suggestion.paperId===input.paper.id&&suggestion.vocabularyVersion===input.vocabularyVersion&&suggestion.inputFingerprint===inputFingerprint&&suggestion.tagId!==NO_TAG_ID&&suggestion.evidence.length&&sameEvidence(input.paper,suggestion.evidence)).flatMap(suggestion=>{const tag=tags.get(suggestion.tagId);return tag&&tag.status==='approved'&&!isNoTagDefinition(tag)?[tag]:[];}),now=input.now??new Date().toISOString(),vocabularyFingerprint=approvedVocabularyFingerprint(input.definitions);
  const covers=(name:string)=>{const visited=new Set<string>(),pending=[...matched];while(pending.length){const tag=pending.pop()!;if(visited.has(tag.id))continue;visited.add(tag.id);if(topicMatchesTag(name,tag))return true;for(const id of tag.broaderIds){const parent=tags.get(id);if(parent)pending.push(parent);}}return false;};
  return records.map(record=>record.status==='active'&&record.paperId===input.paper.id&&record.inputFingerprint===inputFingerprint&&(record.vocabularyVersion<input.vocabularyVersion||record.vocabularyFingerprint!==undefined&&record.vocabularyFingerprint!==vocabularyFingerprint)&&(record.kind==='outside-vocabulary'?matched.length>0:!!record.name&&covers(record.name))?{...record,status:'resolved',resolvedAt:now,updatedAt:now}:record);
}
export function groupUncoveredTopics(records:readonly UncoveredTopicRecord[]):UncoveredTopicGroup[] {
  const groups=new Map<string,UncoveredTopicGroup>();for(const record of records.filter(record=>record.status==='active')){const name=record.kind==='outside-vocabulary'?'Outside the current tag list':reportTopicName(record.name??''),key=record.kind==='outside-vocabulary'?'outside-vocabulary':`topic:${canonicalTagKey(name)}`,group=groups.get(key)??{id:`topic-group-${fingerprint(key)}`,kind:record.kind,name,paperIds:[],recordIds:[],count:0};group.paperIds=unique([...group.paperIds,record.paperId]);group.recordIds.push(record.id);group.count=group.paperIds.length;groups.set(key,group);}return [...groups.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
}
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(item=>typeof item==='string');
export function validAssignmentRunRecord(value:unknown):value is AssignmentRunRecord {
  if(!value||typeof value!=='object')return false;const run=value as AssignmentRunRecord;return typeof run.id==='string'&&!!run.id&&strings(run.paperIds)&&new Set(run.paperIds).size===run.paperIds.length&&strings(run.suggestionIds)&&new Set(run.suggestionIds).size===run.suggestionIds.length&&Number.isInteger(run.vocabularyVersion)&&run.vocabularyVersion>=0&&['analysis','review','finished'].includes(run.status)&&typeof run.createdAt==='string'&&(run.finishedAt===undefined||typeof run.finishedAt==='string');
}
export function validUncoveredTopicRecord(value:unknown):value is UncoveredTopicRecord {
  if(!value||typeof value!=='object')return false;const record=value as UncoveredTopicRecord;return ['id','runId','paperId','reason','inputFingerprint','provider','model','createdAt','updatedAt'].every(key=>typeof record[key as keyof UncoveredTopicRecord]==='string')&&['topic','outside-vocabulary'].includes(record.kind)&&(record.kind!=='topic'||typeof record.name==='string'&&!!record.name.trim())&&Number.isInteger(record.vocabularyVersion)&&record.vocabularyVersion>=0&&['active','resolved','dismissed'].includes(record.status)&&!!record.id&&!!record.runId&&!!record.paperId&&!!record.reason.trim()&&Array.isArray(record.evidence)&&record.evidence.length>0&&record.evidence.every(quote=>quote&&typeof quote.text==='string'&&!!quote.text&&['title','abstract','keyword','pdf'].includes(quote.source))&&(record.resolvedAt===undefined||typeof record.resolvedAt==='string')&&(record.vocabularyFingerprint===undefined||typeof record.vocabularyFingerprint==='string');
}
