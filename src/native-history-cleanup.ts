import type {NativeTagDefinitionEntry,NativeTagDefinitionRevision,NativeTagDefinitionTask,NativeTagDefinitionWork} from './native-tag-definition.ts';

const workFields=new Set('id protocolVersion createdAt fingerprint snapshot maxOutputTokens entries tasks status diagnostics history selectionPolicyVersion treatments'.split(' '));
const revisionFields=new Set('reason protocolVersion fingerprint snapshot entries tasks status diagnostics selectionPolicyVersion treatments'.split(' '));
const snapshotFields=new Set('papers nativeTags definitions facts decisions vocabularyVersion applied'.split(' '));
const entryFields=new Set('id sourceName tagId paperIds status definition targetTagId question questionDetails humanAnswer automaticAnswer resolution meaningAdmission judgments'.split(' '));
const judgmentFields=new Set('relation reason evidence supportFactConceptIds sourceFingerprint definitionFingerprint'.split(' '));
const taskFields=new Set('id kind entryIds pairs status dispatches invalidResponses generation attempts error'.split(' '));
const attemptFields=new Set('raw provider model error transport'.split(' '));
const decisionFields=['humanAnswer','automaticAnswer','meaningAdmission'] as const;
const knownFields=(value:object,fields:Set<string>)=>Object.keys(value).every(key=>fields.has(key));

interface RevisionPayloads {judgments:string[];artifacts:string[];known:boolean}

function payload(identity:readonly (string|number)[],value:unknown):string|undefined {
  try{return JSON.stringify([...identity,value]);}catch{return;}
}

function collect(entries:readonly NativeTagDefinitionEntry[],tasks:readonly NativeTagDefinitionTask[],fingerprint:string):RevisionPayloads {
  const result:RevisionPayloads={judgments:[],artifacts:[],known:true};
  const add=(target:string[],identity:readonly (string|number)[],value:unknown)=>{
    const serialized=payload(identity,value);
    if(serialized===undefined)result.known=false;else target.push(serialized);
  };
  for(const entry of entries){
    if(!knownFields(entry,entryFields))result.known=false;
    for(const [paperId,judgment] of Object.entries(entry.judgments)){
      if(!knownFields(judgment,judgmentFields))result.known=false;
      if(judgment.relation!=='uncertain')add(result.judgments,['judgment',entry.id,paperId,judgment.definitionFingerprint,judgment.sourceFingerprint],judgment);
    }
    for(const field of decisionFields)if(entry[field]!==undefined)add(result.artifacts,[field,entry.id],entry[field]);
  }
  for(const task of tasks){
    if(!knownFields(task,taskFields))result.known=false;
    const scope=payload(['paid-scope',fingerprint,task.id],{kind:task.kind,entryIds:task.entryIds,pairs:task.pairs,generation:task.generation,dispatches:task.dispatches});
    if(task.dispatches>0||task.attempts.length){if(scope===undefined)result.known=false;else result.artifacts.push(scope);}
    for(const [index,attempt] of task.attempts.entries()){
      if(!knownFields(attempt,attemptFields))result.known=false;
      if(scope===undefined)result.known=false;else add(result.artifacts,['attempt',scope,index],attempt);
    }
  }
  return result;
}

/** Remove superseded snapshots only when later history retains every reusable verdict. */
export function compactNativeDefinitionHistory(work:NativeTagDefinitionWork):NativeTagDefinitionWork {
  const history=work.history;
  if(!history||history.length<2||!knownFields(work,workFields))return work;
  const judgments=new Set<string>(),artifacts=new Set(collect(work.entries,work.tasks,work.fingerprint).artifacts);
  const retained:NativeTagDefinitionRevision[]=[];
  for(let index=history.length-1;index>=0;index--){
    const revision=history[index],values=collect(revision.entries,revision.tasks,revision.fingerprint);
    const known=values.known&&knownFields(revision,revisionFields)&&knownFields(revision.snapshot,snapshotFields);
    if(index!==history.length-1&&known&&values.judgments.every(value=>judgments.has(value))&&values.artifacts.every(value=>artifacts.has(value)))continue;
    retained.push(revision);
    for(const value of values.judgments)judgments.add(value);
    for(const value of values.artifacts)artifacts.add(value);
  }
  return retained.length===history.length?work:{...work,history:retained.reverse()};
}
