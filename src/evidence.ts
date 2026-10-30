import {allocateOpaqueId,FACETS,fingerprint,paperFingerprint,validateEvidence} from './core.ts';
export {allocateOpaqueId} from './core.ts';
import type {Evidence,Facet,PaperRecord} from './core.ts';
import type {PaperFacts} from './taxonomy.ts';
import {terminologyKey,NORMALIZATION_VERSION} from './naming.ts';
import type {NormalizationVersion} from './naming.ts';

export interface FactSource {
  factConceptId:string;paperId:string;name:string;facet?:Facet;evidence:Evidence[];summary:string;
  metadataFingerprint:string;inputFingerprint:string;provider:string;model:string;extractionVersion:1;
}
export interface RegistryEntry {registryId:string;key:string;sourceIds:string[];normalizationVersion?:NormalizationVersion}
export interface EvidenceCatalog {sources:Record<string,FactSource>;entries:Record<string,RegistryEntry>;registryAliases?:Record<string,string>}
export interface RegistrySnapshot extends EvidenceCatalog {id:string;protocolVersion:2;paperIds:string[];normalizationVersion?:NormalizationVersion}
export type IdentityAllocator=(prefix:string)=>string;
export function createEmptyEvidenceCatalog():EvidenceCatalog{return {sources:{},entries:{}};}
export function ensureFactConceptIds(facts:readonly PaperFacts[],allocate:IdentityAllocator=allocateOpaqueId):void {
  const used=new Set<string>();
  for(const fact of facts)for(const concept of fact.concepts){
    if(concept.factConceptId){if(used.has(concept.factConceptId))throw new Error(`Duplicate factual concept identity: ${concept.factConceptId}.`);used.add(concept.factConceptId);}
  }
  for(const fact of facts)for(const concept of fact.concepts)if(!concept.factConceptId){let id:string;do{id=allocate('fact');}while(used.has(id));concept.factConceptId=id;used.add(id);}
}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
/** Catalog growth never mutates source records or already returned snapshot objects. */
export function createRegistrySnapshot(facts:readonly PaperFacts[],catalog:EvidenceCatalog,allocate:IdentityAllocator=allocateOpaqueId):RegistrySnapshot {
  ensureFactConceptIds(facts,allocate);
  const sources:Record<string,FactSource>={},entries:Record<string,RegistryEntry>={},byKey=new Map(Object.values(catalog.entries).map(entry=>[entry.key,entry])),bySource=new Map(Object.values(catalog.entries).flatMap(entry=>entry.sourceIds.map(id=>[id,entry] as const)));
  for(const fact of facts)for(const concept of fact.concepts){
    const id=concept.factConceptId!,source:FactSource={factConceptId:id,paperId:fact.paperId,name:concept.name,...(concept.facet?{facet:concept.facet}:{}),evidence:clone(concept.evidence),summary:fact.summary,metadataFingerprint:fact.metadataFingerprint,inputFingerprint:fact.inputFingerprint,provider:fact.provider,model:fact.model,extractionVersion:1};
    if(catalog.sources[id]&&fingerprint(catalog.sources[id])!==fingerprint(source))throw new Error(`Immutable factual source changed: ${id}.`);
    if(!catalog.sources[id])catalog.sources[id]=source;
    sources[id]=clone(catalog.sources[id]);
    const key=terminologyKey(concept.name);let entry=bySource.get(id);
    if(!entry){const candidate=byKey.get(key);if(candidate&&terminologyKey(concept.name,candidate.normalizationVersion??1)===candidate.key)entry=candidate;}
    if(!entry){let registryId:string;do{registryId=allocate('registry');}while(catalog.entries[registryId]);entry={registryId,key,sourceIds:[],normalizationVersion:NORMALIZATION_VERSION};catalog.entries[registryId]=entry;byKey.set(key,entry);}
    if(!entry.sourceIds.includes(id))entry.sourceIds.push(id);
    const selected=entries[entry.registryId]??={registryId:entry.registryId,key:entry.key,sourceIds:[],normalizationVersion:entry.normalizationVersion??1};selected.sourceIds.push(id);
  }
  for(const entry of Object.values(entries))entry.sourceIds=[...new Set(entry.sourceIds)].sort();
  return {id:allocate('snapshot'),protocolVersion:2,paperIds:[...new Set(facts.map(fact=>fact.paperId))].sort(),sources,entries,normalizationVersion:NORMALIZATION_VERSION};
}
export function validateRegistrySnapshot(snapshot:RegistrySnapshot):string[] {
  const issues:string[]=[];
  if(snapshot.protocolVersion!==2||!snapshot.id||!Array.isArray(snapshot.paperIds)||!snapshot.sources||!snapshot.entries)return ['Invalid protocol-v2 evidence snapshot.'];
  const reserved=new Set(['__proto__','constructor','prototype']);
  if(reserved.has(snapshot.id))issues.push('Reserved evidence snapshot identity.');
  const papers=new Set(snapshot.paperIds),seen=new Set<string>();
  for(const [id,source] of Object.entries(snapshot.sources)){
    if(id!==source.factConceptId||seen.has(id)||reserved.has(id)||reserved.has(source.factConceptId))issues.push(`Invalid or reserved factual source identity: ${id}.`);seen.add(id);
    if(!papers.has(source.paperId))issues.push(`Factual source ${id} is outside the selected paper snapshot.`);
    if(!source.name||!source.evidence?.length||source.evidence.some(quote=>!quote.text||!['title','abstract','keyword','pdf'].includes(quote.source)))issues.push(`Invalid or ungrounded factual source: ${id}.`);
  }
  for(const [id,entry] of Object.entries(snapshot.entries)){
    if(id!==entry.registryId||!entry.key||!entry.sourceIds?.length||reserved.has(id)||reserved.has(entry.registryId))issues.push(`Invalid or reserved registry entry: ${id}.`);
    for(const sourceId of entry.sourceIds??[]){
      if(!Object.hasOwn(snapshot.sources,sourceId))issues.push(`Registry ${id} references unknown factual source ${sourceId}.`);
      else if(entry.key!==terminologyKey(snapshot.sources[sourceId].name,entry.normalizationVersion??snapshot.normalizationVersion??1))issues.push(`Registry ${id} has a scientific identity key that differs from factual source ${sourceId}.`);
    }
  }
  return [...new Set(issues)];
}
/** Imported snapshots must match retained validated facts, not merely carry plausible IDs. */
export function validateSnapshotAgainstFacts(snapshot:RegistrySnapshot,facts:readonly PaperFacts[]):string[] {
  const issues=validateRegistrySnapshot(snapshot),byId=new Map(facts.flatMap(fact=>fact.concepts.filter(concept=>concept.factConceptId).map(concept=>[concept.factConceptId!,{fact,concept}] as const)));
  for(const [id,source] of Object.entries(snapshot.sources)){
    const known=byId.get(id);
    if(!known){issues.push(`Snapshot factual source ${id} is not a retained validated fact.`);continue;}
    const {fact,concept}=known;
    if(source.paperId!==fact.paperId||source.name!==concept.name||source.facet!==concept.facet||source.summary!==fact.summary||fingerprint(source.evidence)!==fingerprint(concept.evidence)||source.metadataFingerprint!==fact.metadataFingerprint||source.inputFingerprint!==fact.inputFingerprint||source.provider!==fact.provider||source.model!==fact.model||source.extractionVersion!==fact.extractionVersion)issues.push(`Snapshot factual source ${id} differs from its immutable validated evidence.`);
  }
  return [...new Set(issues)];
}

/** Recover an evicted cache entry only after its exact current inputs and quotations match. */
export function recoverPaperFactsFromSnapshot(snapshot:RegistrySnapshot,paper:PaperRecord):PaperFacts|null {
  if(validateRegistrySnapshot(snapshot).length||!snapshot.paperIds.includes(paper.id))return null;
  const sources=Object.values(snapshot.sources).filter(source=>source.paperId===paper.id);
  if(!sources.length)return null;
  const first=sources[0],metadataFingerprint=paperFingerprint({...paper,pdfText:undefined}),inputFingerprint=paperFingerprint(paper);
  if(sources.some(source=>source.metadataFingerprint!==metadataFingerprint||source.inputFingerprint!==inputFingerprint||source.summary!==first.summary||source.provider!==first.provider||source.model!==first.model||source.extractionVersion!==1||typeof source.summary!=='string'||typeof source.provider!=='string'||typeof source.model!=='string'||source.facet!==undefined&&!FACETS.includes(source.facet)||fingerprint(validateEvidence(paper,source.evidence))!==fingerprint(source.evidence)))return null;
  const fact:PaperFacts={paperId:paper.id,metadataFingerprint,inputFingerprint,provider:first.provider,model:first.model,extractionVersion:1,summary:first.summary,concepts:sources.map(source=>({factConceptId:source.factConceptId,name:source.name,...(source.facet?{facet:source.facet}:{}),evidence:clone(source.evidence)})),needsPDF:false};
  const ids=new Set(sources.map(source=>source.factConceptId)),selected:RegistrySnapshot={...snapshot,paperIds:[paper.id],sources:Object.fromEntries(sources.map(source=>[source.factConceptId,source])),entries:Object.fromEntries(Object.values(snapshot.entries).map(entry=>({...entry,sourceIds:entry.sourceIds.filter(id=>ids.has(id))})).filter(entry=>entry.sourceIds.length).map(entry=>[entry.registryId,entry]))};
  return validateSnapshotAgainstFacts(selected,[fact]).length?null:fact;
}
