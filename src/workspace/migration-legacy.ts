import {allocateOpaqueId,canonicalTagKey,fingerprint,paperFingerprint,validateEvidence} from '../core.ts';
import type {PaperRecord,TagDefinition} from '../core.ts';
import type {PaperFacts,TaxonomyProposal} from '../taxonomy.ts';
import type {FactSource,RegistryEntry} from '../evidence.ts';
import {equivalentTagNames} from '../concept-filter.ts';
import {terminologyFor,terminologyKey,NORMALIZATION_VERSION} from '../naming.ts';
import {migrateLegacyWarnings} from '../warnings.ts';
import type {WorkspaceStore} from './storage.ts';
import type {MigrationContext} from './migration-contract.ts';
import type {PayloadToken,RecordMetadata,StoredRecord} from './storage-contract.ts';

export interface EarlyLegacyPort {
  store:WorkspaceStore;
  collection(name:string):string;
  putReference(collection:string,id:string,token:PayloadToken,metadata:RecordMetadata):Promise<void>;
  change(collection:string,id:string,path:string[],value:unknown,remove?:boolean):Promise<void>;
  changeToken(collection:string,id:string,path:string[],token:PayloadToken):Promise<void>;
  records(collection:string):AsyncIterable<StoredRecord>;
  entries(token?:PayloadToken):AsyncIterable<{key:string|number;token:PayloadToken}>;
  all<T>(collection:string,maxBytes?:number):Promise<T[]>;
}

/** Schemas 1–2 predate global evidence identities. Convert one paper at a time. */
export async function normalizeEarlyLegacy(port:EarlyLegacyPort,context:MigrationContext):Promise<void> {
  const {store}=port,codec=store.codec;
  const get=<T>(collection:string,id:string)=>store.get(port.collection(collection),id,{maxBytes:2*1024*1024}) as Promise<T|undefined>;
  const put=async(collection:string,id:string,value:unknown,metadata:RecordMetadata={category:'active'})=>port.putReference(collection,id,await codec.encode(value),metadata);
  const remove=async(collection:string)=>{for await(const row of port.records(collection))await store.delete(row.collection,row.id);};
  const setState=(key:string,value:unknown)=>put('state',key,value);
  let tags=await port.all<TagDefinition>('tags');
  if(context.sourceVersion===1){
    await port.change('state','settings',['coreConceptLimit'],60);
    tags=tags.map(tag=>({...tag,fullName:tag.fullName||tag.name,broaderIds:tag.custom?[]:tag.broaderIds,relatedIds:[...new Set([...(Array.isArray(tag.relatedIds)?tag.relatedIds:[]),...(tag.custom&&Array.isArray(tag.broaderIds)?tag.broaderIds:[])])],matchingMode:tag.custom?'suggest':'auto'}));
    for(const tag of tags){const row=await store.reference(port.collection('tags'),tag.id);await put('tags',tag.id,tag,row?.metadata);}
    for(const name of ['facts','taxonomyArchives','taxonomyRedirects','taxonomySupport'])await remove(name);
    await setState('taxonomyReady',false);
    await port.change('state','run',['settings','coreConceptLimit'],60);
  }
  await setState('taxonomyProposal',null);await store.delete(port.collection('state'),'approvedTaxonomyInput');
  const warnings=migrateLegacyWarnings(await port.all<string>('warnings'));
  await remove('warnings');for(let index=0;index<warnings.length;index++)await put('warnings',warnings[index].id,warnings[index],{category:'active',order:index});

  // The set holds identities only; paper bodies and quotations stay in the store.
  const used=new Set<string>();
  for await(const row of port.records('facts')){
    const fact=await codec.read(row.token,{maxBytes:2*1024*1024}) as PaperFacts;
    for(const concept of fact.concepts)if(concept.factConceptId){if(used.has(concept.factConceptId))throw new Error('Duplicate factual concept identity.');used.add(concept.factConceptId);}
  }
  const registry=new Map<string,RegistryEntry>(),sourcePapers=new Map<string,string>();
  for await(const row of port.records('facts')){
    const fact=await codec.read(row.token,{maxBytes:2*1024*1024}) as PaperFacts;
    for(const concept of fact.concepts){
      if(!concept.factConceptId){let id:string;do{id=allocateOpaqueId('fact');}while(used.has(id));concept.factConceptId=id;used.add(id);}
      const id=concept.factConceptId,key=terminologyKey(concept.name);
      const source:FactSource={factConceptId:id,paperId:fact.paperId,name:concept.name,...(concept.facet?{facet:concept.facet}:{}),evidence:concept.evidence,summary:fact.summary,metadataFingerprint:fact.metadataFingerprint,inputFingerprint:fact.inputFingerprint,provider:fact.provider,model:fact.model,extractionVersion:1};
      await put('evidenceSources',id,source,{category:'cache',lastUsedAt:context.startedAt});sourcePapers.set(id,fact.paperId);
      let entry=registry.get(key);if(!entry){entry={registryId:allocateOpaqueId('registry'),key,sourceIds:[],normalizationVersion:NORMALIZATION_VERSION};registry.set(key,entry);}entry.sourceIds.push(id);
    }
    await put('facts',row.id,fact,row.metadata);
  }
  for(const entry of registry.values()){entry.sourceIds=[...new Set(entry.sourceIds)].sort();await put('evidenceEntries',entry.registryId,entry,{category:'cache',lastUsedAt:context.startedAt});}
  await setState('evidenceCatalog',{sources:{},entries:{}});await setState('taxonomyEvidence',null);

  const supportRows:{id:string;token:PayloadToken}[]=[];for await(const row of port.records('taxonomySupport'))supportRows.push(row);
  if(!supportRows.length){const retained=await store.reference(port.collection('state'),'legacyTaxonomySupport');for await(const entry of port.entries(retained?.token))supportRows.push({id:String(entry.key),token:entry.token});}
  if(supportRows.length){
    const legacy=codec.objectBuilder();for(const row of supportRows)await legacy.append(row.id,row.token);
    await port.putReference('state','legacyTaxonomySupport',await legacy.finish(),{category:'active'});
    await remove('taxonomySupport');
    const approved=new Map(tags.filter(tag=>!tag.custom&&tag.status==='approved').map(tag=>[tag.id,tag]));
    const owners=new Map<string,Set<string>>(),direct=new Map<string,Set<string>>(),covered=new Map<string,Set<string>>();
    const unresolved:{tagId:string;paperId?:string;reason:string}[]=[];
    for(const tag of approved.values())for(const name of equivalentTagNames(tag)){const key=terminologyKey(name),ids=owners.get(key)??new Set<string>();ids.add(tag.id);owners.set(key,ids);}
    for(const row of supportRows){
      const tagId=row.id,tag=approved.get(tagId),support=await codec.read(row.token,{maxBytes:2*1024*1024}) as TaxonomyProposal['support'][string];
      if(!tag||!support||!Array.isArray(support.paperIds)){unresolved.push({tagId,reason:'Legacy support is not attached to an approved core definition with a valid paper list.'});continue;}
      const paperIds=new Set(support.paperIds.filter((id:unknown):id is string=>typeof id==='string'));covered.set(tagId,paperIds);direct.set(tagId,new Set());
      const nameIdentity=terminologyFor(tag.name)?.name,fullIdentity=terminologyFor(tag.fullName??'')?.name;
      const labels=[tag.name,tag.fullName??''].filter(Boolean).filter(label=>!nameIdentity||terminologyKey(label)===nameIdentity),keys=new Set(labels.map(label=>terminologyKey(label,1)));
      for(const paperId of paperIds){
        const fact=await get<PaperFacts>('facts',paperId),paper=await get<PaperRecord>('papers',paperId);let reason='';
        if(nameIdentity&&fullIdentity&&nameIdentity!==fullIdentity)reason='The preferred label and full name identify different scientific concepts.';
        else if([...keys].some(key=>(owners.get(key)?.size??0)>1))reason='The legacy scientific name or alias is claimed by multiple approved definitions.';
        else if(!fact||!paper||fact.metadataFingerprint!==paperFingerprint({...paper,pdfText:undefined})||fact.inputFingerprint!==paperFingerprint(paper))reason='The retained source metadata or PDF fingerprint does not validate this legacy link.';
        else{
          const matches=fact.concepts.filter(concept=>keys.has(terminologyKey(concept.name))&&(!concept.facet||concept.facet===tag.facet));
          if(matches.length!==1)reason=matches.length?'Multiple validated factual concepts match this legacy link.':'No scientifically equivalent factual concept uniquely establishes this legacy link.';
          else{
            const concept=matches[0],validated=validateEvidence(paper,concept.evidence),oldQuotes=(support.evidence??[]).filter(quote=>quote.paperId===paperId);
            if(!concept.evidence.length||fingerprint(validated)!==fingerprint(concept.evidence))reason='The factual quotations do not exactly validate against the retained source.';
            else if(!terminologyFor(concept.name)&&/^[A-Z]{2,8}$/.test(concept.name)&&!labels.filter(label=>label.trim().split(/\s+/).length>1).some(label=>validated.some(quote=>{
              const source=quote.text.replace(/\s+/g,' '),phrase=label.trim().replace(/\s+/g,' '),folded=source.toLowerCase(),query=phrase.toLowerCase();
              for(let index=folded.indexOf(query);index>=0;index=folded.indexOf(query,index+1))if(!/[\p{L}\p{N}]/u.test(source[index-1]??'')&&!/[\p{L}\p{N}]/u.test(source[index+query.length]??'')&&canonicalTagKey(source.slice(index,index+query.length))===canonicalTagKey(phrase))return true;
              return false;
            })))reason='An uncertain acronym needs its exact expanded scientific meaning in a validated quotation before this legacy link can be converted.';
            else if(oldQuotes.some(quote=>!concept.evidence.some(evidence=>fingerprint(evidence)===fingerprint({source:quote.source,text:quote.text}))))reason='The legacy support quotation does not uniquely match the validated factual concept.';
            else direct.get(tagId)!.add(concept.factConceptId!);
          }
        }
        if(reason)unresolved.push({tagId,paperId,reason});
      }
    }
    const expanded=new Map([...direct].map(([id,sources])=>[id,new Set(sources)]));
    const path=(from:string,to:string,seen=new Set<string>()):boolean=>from===to||(!seen.has(from)&&(seen.add(from),(approved.get(from)?.broaderIds??[]).some(parent=>path(parent,to,seen))));
    const established:Record<string,string>={PEMFC:'FC',AEMFC:'FC',PEMWE:'WE',AEMWE:'WE'};
    for(let pass=0;pass<approved.size;pass++)for(const tag of approved.values())for(const parentId of tag.broaderIds){
      const parent=approved.get(parentId),childIdentity=terminologyFor(tag.name)?.name??terminologyFor(tag.fullName??'')?.name,parentIdentity=parent&&(terminologyFor(parent.name)?.name??terminologyFor(parent.fullName??'')?.name);
      if(!parent||parent.facet!==tag.facet||path(parentId,tag.id)||childIdentity&&parentIdentity&&established[childIdentity]!==parentIdentity)continue;
      const target=expanded.get(parentId);if(!target)continue;
      for(const sourceId of expanded.get(tag.id)??[])if(covered.get(parentId)?.has(sourcePapers.get(sourceId)!))target.add(sourceId);
    }
    const selectedSources=new Set([...expanded.values()].flatMap(ids=>[...ids]));
    let snapshotId:string|undefined;
    const supportPapers=new Map<string,Set<string>>();
    if(selectedSources.size){
      snapshotId=allocateOpaqueId('snapshot');const scope=new Set([...covered.values()].flatMap(ids=>[...ids]));
      const sources=codec.objectBuilder(),entries=codec.objectBuilder(),paperFingerprints=codec.objectBuilder(),paperInputFingerprints=codec.objectBuilder(),paperIds:string[]=[];
      for(const sourceId of selectedSources){const source=await store.reference(port.collection('evidenceSources'),sourceId);if(!source)throw new Error('Missing immutable legacy factual source.');await sources.append(sourceId,source.token);}
      for(const entry of registry.values()){const sourceIds=entry.sourceIds.filter(id=>selectedSources.has(id));if(sourceIds.length)await entries.append(entry.registryId,await codec.encode({...entry,sourceIds}));}
      for(const paperId of scope){const fact=await get<PaperFacts>('facts',paperId);if(!fact)continue;paperIds.push(paperId);await paperFingerprints.append(paperId,{value:fact.metadataFingerprint});await paperInputFingerprints.append(paperId,{value:fact.inputFingerprint});}
      const snapshot=codec.objectBuilder();
      for(const [key,value] of Object.entries({id:snapshotId,protocolVersion:2,paperIds:paperIds.sort(),normalizationVersion:NORMALIZATION_VERSION}))await snapshot.append(key,await codec.encode(value));
      await snapshot.append('sources',await sources.finish());await snapshot.append('entries',await entries.finish());
      await port.putReference('state','taxonomyEvidence',await snapshot.finish(),{category:'active'});
      const review=codec.objectBuilder();await review.append('paperFingerprints',await paperFingerprints.finish());await review.append('paperInputFingerprints',await paperInputFingerprints.finish());await port.putReference('state','taxonomyReview',await review.finish(),{category:'active'});
      for(const [tagId,sourceSet] of expanded){
        const sourceIds=[...sourceSet].sort();if(!sourceIds.length)continue;
        const own=direct.get(tagId)!,papers=new Set<string>(),quotes=new Map<string,unknown>();
        for(const id of sourceIds){const source=await get<FactSource>('evidenceSources',id);if(!source)throw new Error('Missing immutable legacy factual source.');papers.add(source.paperId);for(const quote of source.evidence){const value={paperId:source.paperId,...quote};quotes.set(JSON.stringify(value),value);}}
        supportPapers.set(tagId,papers);
        await put('taxonomySupport',tagId,{sourceIds,registryIds:[...registry.values()].filter(entry=>entry.sourceIds.filter(id=>selectedSources.has(id)).length&&entry.sourceIds.filter(id=>selectedSources.has(id)).every(id=>own.has(id))).map(entry=>entry.registryId).sort(),paperIds:[...papers].sort(),evidence:[...quotes.values()]});
      }
    }
    await setState('legacySupportMigration',{...(snapshotId?{snapshotId}:{}),convertedTagIds:[...supportPapers.keys()].sort(),unresolved:unresolved.filter(issue=>!issue.paperId||!supportPapers.get(issue.tagId)?.has(issue.paperId))});
  }
  const runRow=await store.reference(port.collection('state'),'run');
  if(runRow){
    const kind=await codec.lookup(runRow.token,['kind']),status=await codec.lookup(runRow.token,['status']);
    if(kind&&await codec.read(kind)==='rebuild'){
      await port.change('state','run',['consolidation'],null,true);await port.change('state','run',['vocabCursor'],0);await port.change('state','run',['vocabFinished'],false);
      if(status&&await codec.read(status)!=='idle'){
        await port.change('state','run',['status'],'paused');await port.change('state','run',['message'],'Validated evidence was migrated to stable identities. Resume to regenerate only the vocabulary consolidation.');
        const jobsToken=await codec.lookup(runRow.token,['jobs']),jobs=codec.arrayBuilder();
        for await(const entry of port.entries(jobsToken)){
          const job=await codec.read(entry.token,{maxBytes:64*1024}) as {paperId:string;status:string};
          if(context.sourceVersion===1||job.status==='running'||!await store.reference(port.collection('facts'),job.paperId))job.status='pending';
          await jobs.append(await codec.encode(job));
        }
        await port.changeToken('state','run',['jobs'],await jobs.finish());
      }
    }
  }
}
