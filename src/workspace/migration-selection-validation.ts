import {FACETS} from '../core.ts';
import {validTagSelectionWork} from '../tag-selection.ts';
import type {PayloadCodec} from './codec.ts';
import type {PayloadToken} from './storage-contract.ts';
import {LegacyValidationError} from './migration-contract.ts';
import {validateRegistryGraph} from './migration-native-validation.ts';

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(value=>typeof value==='string');
const count=(value:unknown,max=Number.MAX_SAFE_INTEGER)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
const ledger=(value:unknown)=>record(value)&&['pending','mapped','outside-core','insufficient-evidence','needs-context','unexamined'].includes(String(value.status))&&strings(value.tagIds)&&(value.reason===undefined||typeof value.reason==='string');

/** The original selection validator's rules, applied to bounded graph records. */
export async function validateSelectionGraph(codec:PayloadCodec,work:PayloadToken,options:{signal?:AbortSignal}={}):Promise<void>{
  const fail=():never=>{throw new LegacyValidationError('A saved tag-selection task has invalid records or source references.');};
  const read=async<T>(token:PayloadToken|undefined,maxBytes=256*1024):Promise<T>=>token?await codec.read(token,{maxBytes,signal:options.signal}) as T:undefined as T;
  const at=async<T>(token:PayloadToken,path:readonly(string|number)[])=>read<T>(await codec.lookup(token,path));
  const entries=async function*(token:PayloadToken|undefined){if(!token)return;let after:number|undefined;for(;;){if(options.signal?.aborted)throw options.signal.reason;const page=await codec.entries(token,{after,limit:50});yield* page.entries;if(page.next===undefined)break;after=page.next;}};
  const kind=async(token:PayloadToken|undefined,value:'array'|'object')=>!!token&&await codec.kind(token)===value;
  const snapshot=await codec.lookup(work,['snapshot']);if(!snapshot)fail();await validateRegistryGraph(codec,snapshot!,options);
  const sources=new Set<string>(),expected=new Map<string,string>(),registryIds=new Set<string>();
  for await(const item of entries(await codec.lookup(snapshot!,['sources']))){
    const source=await read<Record<string,unknown>>(item.token);
    if(!record(source)||!['factConceptId','paperId','name','summary','metadataFingerprint','inputFingerprint','provider','model'].every(key=>typeof source[key]==='string')||!Array.isArray(source.evidence)||source.evidence.some(quote=>!record(quote)||typeof quote.text!=='string'||!['title','abstract','keyword','pdf'].includes(String(quote.source))))fail();sources.add(String(item.key));
  }
  for await(const item of entries(await codec.lookup(snapshot!,['entries']))){registryIds.add(String(item.key));const ids=await at<string[]>(item.token,['sourceIds']);if(!strings(ids))fail();for(const id of ids)expected.set(id,String(item.key));}
  const snapshotPaperIds=await codec.lookup(snapshot!,['paperIds']),paperCount=snapshotPaperIds?(await codec.entries(snapshotPaperIds,{limit:1})).total:0;
  const sourceIndex=await codec.lookup(work,['sourceRegistryIds']),sourceLedger=await codec.lookup(work,['sourceLedger']);if(!await kind(sourceIndex,'object')||!await kind(sourceLedger,'object'))fail();
  let indexed=0,ledgerCount=0,pending=false;
  for await(const item of entries(sourceIndex)){if(!sources.has(String(item.key))||await read(item.token)!==expected.get(String(item.key)))fail();indexed++;}
  for await(const item of entries(sourceLedger)){const value=await read<Record<string,unknown>>(item.token);if(!sources.has(String(item.key))||!ledger(value))fail();if(value.status==='pending')pending=true;ledgerCount++;}
  if(indexed!==sources.size||ledgerCount!==sources.size)fail();
  const census=await at<Record<string,unknown>>(work,['census']);if(!record(census)||census.sourceCount!==sources.size||census.registryCount!==registryIds.size||census.paperCount!==paperCount||!count(census.comparisons)||typeof census.objective!=='string')fail();
  const shortlist=await codec.lookup(work,['shortlist']);if(!await kind(shortlist,'array'))fail();
  for await(const item of entries(shortlist)){const value=await read<Record<string,unknown>>(item.token);if(!record(value)||typeof value.registryId!=='string'||!registryIds.has(value.registryId)||typeof value.name!=='string'||!count(value.paperCount)||!count(value.routingPaperCount)||typeof value.score!=='number'||!Number.isFinite(value.score)||value.score<0||value.facet!==undefined&&!(FACETS as readonly unknown[]).includes(value.facet))fail();}
  const outside=await codec.lookup(work,['outsideResults']),broader=await codec.lookup(work,['generatedBroaderIds']);if(!await kind(outside,'object')||!await kind(broader,'object'))fail();
  for await(const outer of entries(outside)){if(!await kind(outer.token,'object'))fail();for await(const inner of entries(outer.token))if(!ledger(await read(inner.token)))fail();}
  for await(const item of entries(broader))if(!strings(await read(item.token)))fail();
  const followed=await at<string[]>(work,['followedUpSourceIds']);if(!strings(followed)||followed.some(id=>!sources.has(id)))fail();
  const pairPlan=await codec.lookup(work,['pairPlan']),pairHistory=await codec.lookup(work,['pairHistory']),pairIds=new Set<string>();
  if(await at(work,['policyVersion'])===4){if(!await kind(pairPlan,'object')||pairHistory&&!await kind(pairHistory,'object'))fail();
    for await(const item of entries(pairPlan)){const value=await read<Record<string,unknown>>(item.token);if(!record(value)||value.id!==item.key||typeof value.tagId!=='string'||typeof value.sourceId!=='string'||!sources.has(value.sourceId)||value.registryId!==expected.get(value.sourceId)||typeof value.tagFingerprint!=='string'||typeof value.sourceFingerprint!=='string'||!['pending','positive','negative','ambiguous','unresolved'].includes(String(value.status))||!count(value.attempts)||value.reason!==undefined&&typeof value.reason!=='string'||value.cached!==undefined&&typeof value.cached!=='boolean')fail();pairIds.add(String(item.key));}
    for await(const item of entries(pairHistory))pairIds.add(String(item.key));
  }
  const tasks=await codec.lookup(work,['tasks']);if(!await kind(tasks,'array'))fail();const taskIds=new Set<string>();let dispatches=0;
  for await(const item of entries(tasks)){
    const builder=codec.objectBuilder();for await(const field of entries(item.token))if(field.key!=='attempts')await builder.append(String(field.key),field.token);const task=await read<Record<string,unknown>>(await builder.finish());
    if(!record(task)||typeof task.id!=='string'||taskIds.has(task.id)||!['plan','map','followup'].includes(String(task.kind))||!['pending','running','completed','failed'].includes(String(task.status))||!strings(task.sourceIds)||task.sourceIds.some(id=>!sources.has(id))||task.kind==='plan'&&task.sourceIds.length!==0||task.kind!=='plan'&&task.sourceIds.length===0||!count(task.dispatches,512)||!count(task.invalidResponses,task.kind==='plan'?4:2)||task.targetTagIds!==undefined&&!strings(task.targetTagIds)||task.generation!==undefined&&!count(task.generation)||['transportPaused','superseded'].some(key=>task[key]!==undefined&&typeof task[key]!=='boolean'))fail();
    if(await at(work,['policyVersion'])===4&&task.pairIds!==undefined&&(!strings(task.pairIds)||task.pairIds.some(id=>!pairIds.has(id))||![0,1].includes(Number(task.sampleRound))))fail();
    taskIds.add(task.id as string);dispatches+=Number(task.dispatches);
    const attempts=await codec.lookup(item.token,['attempts']);if(!await kind(attempts,'array'))fail();
    for await(const attempt of entries(attempts)){if(!await kind(attempt.token,'object')||!await codec.lookup(attempt.token,['raw']))fail();for(const key of ['provider','model','error']){const value=await at(attempt.token,[key]);if(value!==undefined&&typeof value!=='string')fail();}for(const key of ['transport','diagnosticOnly']){const value=await at(attempt.token,[key]);if(value!==undefined&&typeof value!=='boolean')fail();}}
  }
  if(dispatches>Number(await at(work,['automaticRequests']))||await at(work,['status'])==='ready'&&pending)fail();
  // All large maps, source records and reply attempts were checked above. Use
  // the original validator for the remaining policy and definition fields.
  const replacements:Record<string,unknown>={snapshot:{id:await at(snapshot!,['id']),protocolVersion:2,paperIds:[],sources:{},entries:{}},sourceRegistryIds:{},sourceLedger:{},outsideResults:{},generatedBroaderIds:{},followedUpSourceIds:[],tasks:[],pairPlan:{},pairHistory:{},shortlist:[],census:{...census,sourceCount:0,registryCount:0,paperCount:0}};
  const proposal=await codec.lookup(work,['proposal']);if(proposal)replacements.proposal={id:await at(proposal,['id']),mappingPolicyVersion:await at(proposal,['mappingPolicyVersion']),evidenceSnapshot:{id:await at(proposal,['evidenceSnapshot','id'])}};
  const builder=codec.objectBuilder();for await(const field of entries(work))await builder.append(String(field.key),Object.hasOwn(replacements,field.key)?await codec.encode(replacements[String(field.key)]):field.token);
  if(!validTagSelectionWork(await codec.read(await builder.finish(),{maxBytes:4*1024*1024,signal:options.signal})))fail();
}
