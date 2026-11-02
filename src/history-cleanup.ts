import type {AppState} from './controller.ts';
import {compactNativeDefinitionHistory} from './native-history-cleanup.ts';

const OLD_PROCESSING_HISTORY=['analysisResetHistory','legacyConsolidationHistory','factHistory','diyComparisonHistory'] as const;
export const PROCESSING_HISTORY_POLICY_KEY='storage.processingHistoryPolicy';

function selectionHistoryPlan(state:AppState) {
  const history=state.tagSelectionHistory??[];
  const protectedIds=new Set<string>();
  for(const run of [state.run,...(state.maintenanceTasks??[]).map(task=>task.run)]){
    if(run?.selection)protectedIds.add(run.selection.id);
    if(run?.cachedSelection)protectedIds.add(run.cachedSelection.work.id);
  }
  const last=new Map(history.map((record,index)=>[record.work.id,index]));
  const kept:typeof history=[],removed:typeof history=[];
  history.forEach((record,index)=>(protectedIds.has(record.work.id)||last.get(record.work.id)===index?kept:removed).push(record));
  return {kept:removed.length?kept:history,removed};
}

function nativeHistoryPlan(state:AppState) {
  const removed:NonNullable<NonNullable<AppState['nativeDefinitionPreparation']>['work']['history']>=[];
  const compact=(review:NonNullable<AppState['nativeDefinitionPreparation']>)=>{
    const work=compactNativeDefinitionHistory(review.work);
    if(work===review.work)return review;
    const kept=new Set(work.history);
    removed.push(...(review.work.history??[]).filter(revision=>!kept.has(revision)));
    return {...review,work};
  };
  const preparation=state.nativeDefinitionPreparation?compact(state.nativeDefinitionPreparation):undefined;
  const history=state.nativeDefinitionHistory?.map(compact);
  return {preparation,history,removed};
}

export function inspectOldProcessingHistory(state:AppState):{records:number;bytes:number} {
  let records=0,bytes=0;
  const encoder=new TextEncoder();
  for(const key of OLD_PROCESSING_HISTORY){
    const history=state[key];if(!history?.length)continue;
    records+=history.length;
    bytes+=encoder.encode(JSON.stringify(history)).byteLength-2;
  }
  for(const record of selectionHistoryPlan(state).removed){
    records++;
    bytes+=encoder.encode(JSON.stringify(record)).byteLength+1;
  }
  for(const revision of nativeHistoryPlan(state).removed){
    records++;bytes+=encoder.encode(JSON.stringify(revision)).byteLength+1;
  }
  return {records,bytes};
}

export function cleanOldProcessingHistory(state:AppState,compactMeanings=true):AppState {
  let next=state;
  for(const key of OLD_PROCESSING_HISTORY)if(state[key]?.length){
    if(next===state)next={...state};
    next[key]=[];
  }
  const selection=selectionHistoryPlan(state);
  if(selection.removed.length){
    if(next===state)next={...state};
    next.tagSelectionHistory=selection.kept;
  }
  if(compactMeanings){
    const native=nativeHistoryPlan(state);
    if(native.removed.length){
      if(next===state)next={...state};
      if(native.preparation!==state.nativeDefinitionPreparation)next.nativeDefinitionPreparation=native.preparation;
      if(native.history)next.nativeDefinitionHistory=native.history;
    }
  }
  return next;
}

export function hasCompactProcessingHistory(state:Pick<AppState,'metadata'>):boolean {
  return state.metadata[PROCESSING_HISTORY_POLICY_KEY]==='compact-v1';
}

export function applyProcessingHistoryPolicy(state:AppState):void {
  if(!hasCompactProcessingHistory(state))return;
  const next=cleanOldProcessingHistory(state,false);
  if(next===state)return;
  for(const key of [...OLD_PROCESSING_HISTORY,'tagSelectionHistory'] as const)if(next[key]!==state[key])Object.assign(state,{[key]:next[key]});
}
