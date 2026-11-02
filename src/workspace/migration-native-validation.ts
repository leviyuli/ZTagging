import {fingerprint,paperFingerprint} from '../core.ts';
import type {PaperRecord,TagDefinition} from '../core.ts';
import type {PaperFacts} from '../taxonomy.ts';
import type {ReconciliationInput} from '../tag-reconciliation.ts';
import {validNativeTagDefinitionWork} from '../native-tag-definition.ts';
import type {NativeTagDefinitionEntry,NativeTagDefinitionTask,NativeTagDefinitionWork,NativeTagDefinitionJudgment} from '../native-tag-definition.ts';
import type {PayloadCodec} from './codec.ts';
import type {PayloadToken} from './storage-contract.ts';
import {fingerprintGraph} from './migration-graph.ts';
import {LegacyValidationError} from './migration-contract.ts';
import {terminologyKey} from '../naming.ts';

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const checkedRegistryBodies=new WeakMap<PayloadCodec,Set<string>>();

export async function validateRegistryGraph(codec:PayloadCodec,snapshot:PayloadToken,options:{signal?:AbortSignal}={}):Promise<void>{
  const read=async(token:PayloadToken|undefined)=>token?codec.read(token,{maxBytes:32*1024,signal:options.signal}):undefined;
  const at=async(path:readonly(string|number)[])=>read(await codec.lookup(snapshot,path));
  const entries=async function*(token:PayloadToken|undefined){if(!token)return;let after:number|undefined;for(;;){if(options.signal?.aborted)throw options.signal.reason;const page=await codec.entries(token,{after,limit:50});yield* page.entries;if(page.next===undefined)break;after=page.next;}};
  const fail=():never=>{throw new LegacyValidationError('An immutable evidence snapshot has invalid identities or references.');},reserved=new Set(['__proto__','constructor','prototype']);
  const id=await at(['id']),normalization=await at(['normalizationVersion']),papers=await codec.lookup(snapshot,['paperIds']),sources=await codec.lookup(snapshot,['sources']),registries=await codec.lookup(snapshot,['entries']);
  if(await at(['protocolVersion'])!==2||typeof id!=='string'||!id||reserved.has(id)||!papers||await codec.kind(papers)!=='array'||!sources||await codec.kind(sources)!=='object'||!registries||await codec.kind(registries)!=='object')fail();
  const bodyKey=JSON.stringify([papers,sources,registries,normalization??1]),checked=checkedRegistryBodies.get(codec)??new Set<string>();checkedRegistryBodies.set(codec,checked);if(checked.has(bodyKey))return;
  const paperIds=new Set<unknown>();for await(const paper of entries(papers))paperIds.add(await read(paper.token));
  const names=new Map<string,string>();
  for await(const item of entries(sources)){
    const source=await codec.read(item.token,{maxBytes:128*1024,signal:options.signal}) as {factConceptId:string;paperId:string;name:string;evidence:{source:string;text:string}[]};
    if(String(item.key)!==source.factConceptId||reserved.has(String(item.key))||reserved.has(source.factConceptId)||!paperIds.has(source.paperId)||!source.name||!Array.isArray(source.evidence)||!source.evidence.length||source.evidence.some(quote=>!quote.text||!['title','abstract','keyword','pdf'].includes(quote.source)))fail();names.set(String(item.key),source.name);
  }
  for await(const item of entries(registries)){
    const entry=await codec.read(item.token,{maxBytes:2*1024*1024,signal:options.signal}) as {registryId:string;key:string;sourceIds:string[];normalizationVersion?:1|2};
    if(String(item.key)!==entry.registryId||reserved.has(String(item.key))||reserved.has(entry.registryId)||!entry.key||!Array.isArray(entry.sourceIds)||!entry.sourceIds.length)fail();
    for(const sourceId of entry.sourceIds)if(!names.has(sourceId)||entry.key!==terminologyKey(names.get(sourceId)!,entry.normalizationVersion??normalization as 1|2??1))fail();
  }
  if(checked.size>=1024)checked.delete(checked.values().next().value!);checked.add(bodyKey);
}

/** Validate each meaning against only its own scientific source projection. */
export async function validateNativeReviewGraph(codec:PayloadCodec,review:PayloadToken,options:{version:number;yieldControl?:()=>Promise<void>;signal?:AbortSignal}):Promise<void>{
  const fail=(message:string):never=>{throw new LegacyValidationError(message);};
  const read=async<T>(token:PayloadToken|undefined,maxBytes=2*1024*1024):Promise<T>=>token?await codec.read(token,{maxBytes,signal:options.signal}) as T:undefined as T;
  const at=async<T>(token:PayloadToken,path:readonly(string|number)[])=>read<T>(await codec.lookup(token,path));
  const entries=async function*(token:PayloadToken|undefined){if(!token)return;let after:number|undefined;for(;;){if(options.signal?.aborted)throw options.signal.reason;const page=await codec.entries(token,{after,limit:50});yield* page.entries;if(page.next===undefined)break;after=page.next;}};
  const project=async<T>(token:PayloadToken,excluded:readonly string[]):Promise<T>=>{const builder=codec.objectBuilder();for await(const item of entries(token))if(!excluded.includes(String(item.key)))await builder.append(String(item.key),item.token);return read<T>(await builder.finish());};
  const work=await codec.lookup(review,['work']);if(!work||await codec.kind(work)!=='object')fail('A saved native-meaning review has no work.');
  const taskId=await at<unknown>(review,['taskId']),shelfId=await at<unknown>(review,['shelfId']),applied=await at<unknown>(review,['appliedEntryIds']),finishedAt=await at<unknown>(review,['finishedAt']);
  if(typeof taskId!=='string'||typeof shelfId!=='string'||!Array.isArray(applied)||applied.some(id=>typeof id!=='string')||finishedAt!==undefined&&typeof finishedAt!=='string')fail('A saved native-meaning review header is invalid.');
  const inherited=await project<NativeTagDefinitionWork>(work!,['snapshot','entries','tasks','history']);
  const validate=async(token:PayloadToken,revision=false):Promise<Set<string>>=>{
    const snapshot=await codec.lookup(token,['snapshot']);if(!snapshot||await codec.kind(snapshot)!=='object')fail('A native-meaning source snapshot is invalid.');
    const header=await project<NativeTagDefinitionWork>(token,['snapshot','entries','tasks','history']);
    if(revision){header.id=inherited.id;header.createdAt=inherited.createdAt;header.maxOutputTokens=inherited.maxOutputTokens;if(!['answer','continue','automatic'].includes(String((header as unknown as {reason:string}).reason)))fail('A native-meaning revision has an invalid reason.');}
    if(await fingerprintGraph(codec,snapshot!,options)!==header.fingerprint)fail('A native-meaning source fingerprint does not match its immutable snapshot.');
    const base=await project<ReconciliationInput>(snapshot!,['papers','nativeTags','definitions','facts','decisions']);
    const definitions=await at<TagDefinition[]>(snapshot!,['definitions']);
    if(!Array.isArray(definitions))fail('Native-meaning definitions must be a list.');
    const paperTokens=new Map<string,PayloadToken>();
    for await(const paper of entries(await codec.lookup(snapshot!,['papers']))){const id=await at<unknown>(paper.token,['id']);if(typeof id!=='string'||paperTokens.has(id))fail('A native-meaning source paper has an invalid identity.');paperTokens.set(id as string,paper.token);}
    const paperIds=new Map<string,string[]>(),nativeTokens=new Map<string,PayloadToken>(),factTokens=new Map<string,PayloadToken>(),decisionTokens=new Map<string,PayloadToken>();
    for await(const assignment of entries(await codec.lookup(snapshot!,['nativeTags']))){
      nativeTokens.set(String(assignment.key),assignment.token);
      if(!paperTokens.has(String(assignment.key)))continue;
      const native=await read<{tag:string;type:number}[]>(assignment.token);if(!Array.isArray(native))fail('A native-meaning assignment snapshot is invalid.');
      for(const label of native){if(!object(label)||typeof label.tag!=='string'||label.type!==0&&label.type!==1)fail('A native-meaning assignment snapshot is invalid.');const ids=paperIds.get(label.tag)??[];if(!ids.includes(String(assignment.key)))ids.push(String(assignment.key));paperIds.set(label.tag,ids);}
    }
    for await(const item of entries(await codec.lookup(snapshot!,['facts'])))factTokens.set(String(item.key),item.token);
    for await(const item of entries(await codec.lookup(snapshot!,['decisions'])))decisionTokens.set(String(item.key),item.token);
    const identities=new Set<string>(),tagIds=new Set<string>(),sourceEntries=new Map<string,{paperIds:string[]}>();
    const entryList=await codec.lookup(token,['entries']);if(!entryList||await codec.kind(entryList)!=='array'||(await codec.entries(entryList,{limit:1})).total>500)fail('The native-meaning entry list is invalid.');
    for await(const item of entries(entryList)){
      const entry=await project<NativeTagDefinitionEntry>(item.token,['judgments']),judgments=await codec.lookup(item.token,['judgments']);entry.judgments={};
      if(!entry||!Array.isArray(entry.paperIds)||identities.has(entry.id)||tagIds.has(entry.tagId)||fingerprint(entry.paperIds)!==fingerprint((paperIds.get(entry.sourceName)??[]).sort())||!judgments||await codec.kind(judgments)!=='object')fail('A native-meaning entry has inconsistent paper or tag identities.');
      identities.add(entry.id);tagIds.add(entry.tagId);sourceEntries.set(entry.id,{paperIds:entry.paperIds});
      const judgmentTokens=new Map<string,PayloadToken>();for await(const judgment of entries(judgments)){if(!entry.paperIds.includes(String(judgment.key)))fail('A native-meaning judgment refers to a paper outside its immutable scope.');judgmentTokens.set(String(judgment.key),judgment.token);}
      const sources:Record<string,string>={};let supported=false,admissionChecked=false;
      const binding=(sources:Record<string,string>)=>fingerprint({entryId:entry.id,prompt:entry.questionDetails!.prompt,kind:entry.questionDetails!.kind,choices:entry.questionDetails!.choices.map(({id:_,...choice})=>choice),sources,policyVersion:2,...(entry.resolution?{resolution:entry.resolution}:{})});
      const check=(selected:ReconciliationInput,part:NativeTagDefinitionEntry)=>{const projected:NativeTagDefinitionWork={...header,snapshot:selected,fingerprint:fingerprint(selected),entries:[part],tasks:[]};if(!validNativeTagDefinitionWork(projected))fail('A native-meaning decision failed its original scientific validation.');};
      for(const id of entry.paperIds){
        const selected:ReconciliationInput={...base,definitions,papers:[],nativeTags:{},facts:{},decisions:{}};
        const paperToken=paperTokens.get(id);if(!paperToken)fail('A native-meaning source paper is missing.');
        const paper=await read<PaperRecord>(paperToken,8*1024*1024);
        selected.papers.push(paper);selected.nativeTags[id]=await read(nativeTokens.get(id));
        const facts=await read<PaperFacts|undefined>(factTokens.get(id));if(facts)selected.facts[id]=facts;
        if(entry.targetTagId){const key=id+'|'+entry.targetTagId,decision=await read<ReconciliationInput['decisions'][string]>(decisionTokens.get(key));if(decision)selected.decisions[key]=decision;}
        const compatible=facts&&facts.metadataFingerprint===paperFingerprint({...paper,pdfText:undefined})&&(!paper.pdfText||facts.inputFingerprint===paperFingerprint(paper))?facts:undefined;
        const source=fingerprint({sourceName:entry.sourceName,paper:paperFingerprint(paper),facts:compatible,assignment:selected.nativeTags[id].filter(tag=>tag.tag===entry.sourceName)});sources[id]=source;
        const judgment=await read<NativeTagDefinitionJudgment|undefined>(judgmentTokens.get(id),128*1024),hasSupport=judgment?.relation==='same-meaning'&&Array.isArray(judgment.evidence)&&judgment.evidence.some(quote=>quote.source!=='keyword');supported||=hasSupport;
        const part:NativeTagDefinitionEntry={...entry,paperIds:[id],judgments:judgment?{[id]:judgment}:{}};
        if(entry.questionDetails)part.questionDetails={...entry.questionDetails,fingerprint:binding({[id]:source})};
        if(entry.humanAnswer)part.humanAnswer={...entry.humanAnswer,sourceFingerprints:{[id]:source}};
        if(entry.automaticAnswer){if(hasSupport)part.automaticAnswer={...entry.automaticAnswer,sourceFingerprints:{[id]:source}};else delete part.automaticAnswer;}
        if(entry.meaningAdmission){if(hasSupport||entry.humanAnswer?.meaningAdmissionPolicy===1)admissionChecked=true;else delete part.meaningAdmission;}
        check(selected,part);await options.yieldControl?.();
      }
      if(!entry.paperIds.length){check({...base,definitions,papers:[],nativeTags:{},facts:{},decisions:{}},entry);admissionChecked=!!entry.meaningAdmission;}
      if(entry.questionDetails&&entry.questionDetails.fingerprint!==binding(sources)||entry.humanAnswer&&fingerprint(entry.humanAnswer.sourceFingerprints)!==fingerprint(sources)||entry.automaticAnswer&&(!supported||fingerprint(entry.automaticAnswer.sourceFingerprints)!==fingerprint(sources))||entry.meaningAdmission&&!admissionChecked)fail('A native-meaning decision does not match its complete immutable source scope.');
      if(options.version<13&&(header.selectionPolicyVersion!==undefined||header.treatments!==undefined||entry.automaticAnswer!==undefined||entry.meaningAdmission!==undefined||entry.resolution!==undefined||entry.questionDetails?.kind==='personal'||entry.humanAnswer?.sourceCheckPolicy!==undefined||entry.humanAnswer?.meaningAdmissionPolicy!==undefined))fail('A legacy native-meaning review contains a newer processing policy.');
    }
    const tasks=await codec.lookup(token,['tasks']);if(!tasks||await codec.kind(tasks)!=='array')fail('The native-meaning task list is invalid.');
    const taskIds=new Set<string>();
    for await(const item of entries(tasks)){
      const task=await project<NativeTagDefinitionTask>(item.token,['attempts']);
      if(!task||typeof task.id!=='string'||!task.id||taskIds.has(task.id)||!['draft','check'].includes(task.kind)||!['pending','running','completed','failed'].includes(task.status)||!Array.isArray(task.entryIds)||task.entryIds.some(id=>!identities.has(id))||!Array.isArray(task.pairs)||task.pairs.some(pair=>!task.entryIds.includes(pair.entryId)||!sourceEntries.get(pair.entryId)?.paperIds.includes(pair.paperId))||![task.dispatches,task.invalidResponses,task.generation].every(value=>Number.isInteger(value)&&value>=0))fail('A native-meaning task has invalid references or dispatch counters.');taskIds.add(task.id);
      const attempts=await codec.lookup(item.token,['attempts']);if(!attempts||await codec.kind(attempts)!=='array')fail('A native-meaning task has no paid-reply list.');
      for await(const attempt of entries(attempts)){if(await codec.kind(attempt.token)!=='object'||!await codec.lookup(attempt.token,['raw']))fail('A native-meaning paid reply was not preserved.');for(const key of ['provider','model','error']){const value=await at<unknown>(attempt.token,[key]);if(value!==undefined&&typeof value!=='string')fail('A native-meaning paid-reply header is invalid.');}}
    }
    if(!validNativeTagDefinitionWork({...header,snapshot:{...base,definitions,papers:[],nativeTags:{},facts:{},decisions:{}},fingerprint:fingerprint({...base,definitions,papers:[],nativeTags:{},facts:{},decisions:{}}),entries:[],tasks:[]}))fail('A native-meaning work header is invalid.');
    for await(const revision of entries(await codec.lookup(token,['history'])))await validate(revision.token,true);
    await options.yieldControl?.();return identities;
  };
  const identities=await validate(work!);if((applied as string[]).some(id=>!identities.has(id)))fail('A native-meaning admission refers to a missing entry.');
}
