import {allocateOpaqueId,paperFingerprint} from './core.ts';
import type {AppState} from './controller.ts';

export interface AnalysisResetRecord {
  id:string;date:string;factsCount:number;analysesCount:number;
  run?:NonNullable<AppState['run']>;
  maintenanceTasks?:AppState['maintenanceTasks'];
  analyses:AppState['analyses'];
  discardedSuggestions:AppState['suggestions'];
  unfinishedReviews:NonNullable<AppState['assignmentRuns']>;
  proposal?:NonNullable<AppState['taxonomyProposal']>;
  preparation?:AppState['tagPreparation'];
  diyComparison?:AppState['diyComparison'];
  reconciliation?:AppState['reconciliation'];
}
type ResettableState=Omit<AppState,'schemaVersion'|'analysisResetHistory'>&{schemaVersion:number;analysisResetHistory?:AnalysisResetRecord[]};
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
function retireRun(run:NonNullable<AppState['run']>):NonNullable<AppState['run']>{
  const next={...run,status:'idle' as const,jobs:[],vocabCursor:0,vocabFinished:true,message:'Paper analysis reset. Start a new build to analyze papers afresh.'};
  delete next.selection;delete next.selectionInputFingerprint;delete next.selectionReplies;delete next.consolidation;delete next.preparation;delete next.fasterBuild;delete next.preparationOnly;delete next.proposalFingerprint;delete next.extensionBaseline;delete next.skippedIds;return next;
}
export function resetPaperAnalysis<T extends ResettableState>(state:T,date=new Date().toISOString()):T {
  const next=copy(state),unfinished=(next.assignmentRuns??[]).filter(review=>review.status!=='finished'),discarded=next.suggestions.filter(suggestion=>!suggestion.applied);
  const record:AnalysisResetRecord={id:allocateOpaqueId('analysis-reset'),date,factsCount:Object.keys(next.facts).length,analysesCount:Object.keys(next.analyses).length,analyses:next.analyses,discardedSuggestions:discarded,unfinishedReviews:unfinished,...(next.run?{run:next.run}:{}),...(next.maintenanceTasks?.length?{maintenanceTasks:next.maintenanceTasks}:{}),...(next.taxonomyProposal?{proposal:next.taxonomyProposal}:{}),...(next.tagPreparation?{preparation:next.tagPreparation}:{}),...(next.diyComparison?{diyComparison:next.diyComparison}:{}),...(next.reconciliation?{reconciliation:next.reconciliation}:{})};
  next.analysisResetHistory=[...(next.analysisResetHistory??[]),record];
  next.facts={};next.analyses={};next.factHistory=[];next.neighbors={};next.paperInputs={};next.cleanup=[];next.deferredItemIDs=[];
  for(const paper of Object.values(next.papers)){delete paper.summary;delete paper.concepts;delete paper.pdfText;paper.fingerprint=paperFingerprint(paper);}
  next.suggestions=next.suggestions.filter(suggestion=>suggestion.applied);next.assignmentRuns=(next.assignmentRuns??[]).filter(review=>review.status==='finished');
  next.taxonomyProposal=null;delete next.tagPreparation;delete next.approvedTaxonomyInput;
  delete next.metadataPreview;delete next.paperExclusionPreview;delete next.pendingTopicExtension;delete next.reconciliation;delete next.reconciliationPreview;delete next.keepTagPlan;delete next.keepRemovalPreview;delete next.diyComparison;delete next.diyMergePreview;
  if(next.run)next.run=retireRun(next.run);
  if(next.maintenanceTasks)next.maintenanceTasks=next.maintenanceTasks.map(task=>({...task,status:'completed',retired:true,run:retireRun(task.run)}));
  next.pilotReviewed=false;next.pilotIds=[];next.pilotExpected=0;
  next.warnings=next.warnings.map(warning=>warning.status==='active'&&(warning.context==='facts'||warning.context.startsWith('assignment'))?{...warning,status:'dismissed' as const,dismissedAt:date}:warning);
  return next;
}
