import {buildSimilarityNetwork,fingerprint,similarityTermCounts,SIMILARITY_LIMITS} from '../core.ts';
import type {Neighbor,PaperRecord} from '../core.ts';
import {WorkspaceStore} from './storage.ts';

type BagRecord={signature:string;sourceFingerprint:string;terms:string};
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;

/** Related reading is indexed per changed paper and retrieved only when expanded. */
export class SimilarityIndex {
  private store:WorkspaceStore;
  constructor(store:WorkspaceStore){this.store=store;}
  async update(papers:readonly PaperRecord[]):Promise<Record<string,Neighbor[]>>{
    for(const paper of papers){
      const terms=JSON.stringify([...similarityTermCounts(paper)]),signature=fingerprint(terms);
      const old=await this.store.get('similarityVectors',paper.id,{path:['signature'],maxBytes:128});
      if(old!==signature)await this.store.put('similarityVectors',paper.id,{signature,sourceFingerprint:paper.fingerprint,terms},{category:'active',refs:[{collection:'papers',id:paper.id}]});
      await pause();
    }
    return {};
  }
  async remove(ids:readonly string[]){for(const id of ids){await this.store.delete('similarityVectors',id);await pause();}}
  private async paper(id:string,signal?:AbortSignal):Promise<PaperRecord>{
    const get=async<T>(path:string,fallback:T)=>await this.store.get('papers',id,{path:[path],signal,maxBytes:32*1024*1024}) as T??fallback;
    return {id,itemID:0,libraryID:0,key:id,title:await get('title',''),abstract:await get('abstract',''),keywords:await get<string[]>('keywords',[]),summary:await get('summary',''),concepts:await get<string[]>('concepts',[]),fingerprint:''};
  }
  async neighbors(paperId:string,{limit=10,signal}:{limit?:number;signal?:AbortSignal}={}):Promise<Neighbor[]>{
    const check=()=>{if(signal?.aborted)throw signal.reason??new Error('Related-paper query cancelled.');};
    check();if(!await this.store.reference('papers',paperId))return [];
    const count=(await this.store.scan('papers',{limit:1})).total;
    const selected=await this.paper(paperId,signal);
    if(count<=SIMILARITY_LIMITS.exactPaperThreshold){
      const papers:PaperRecord[]=[];let after:string|undefined;
      do{const page=await this.store.scan('papers',{after,limit:50});for(const row of page.rows){check();papers.push(row.id===paperId?selected:await this.paper(row.id,signal));await pause();}after=page.next;}while(after);
      return (buildSimilarityNetwork(papers,limit)[paperId]??[]);
    }
    const bag=similarityTermCounts(selected),frequencies=new Map<string,number>(),ranked:{term:string;count:number;frequency:number}[]=[];
    // Native substring search retrieves candidates; exact scientific token case is
    // retained in cosine scoring. Long fields and PDFs never enter view updates.
    for(const [term,value] of [...bag].filter(([term])=>term.length<=512).sort((a,b)=>b[1]-a[1]||compare(a[0],b[0])).slice(0,48)){
      check();const frequency=(await this.store.scan('papers',{search:term,limit:1})).total;frequencies.set(term,frequency);
      if(frequency>1&&frequency/count<=.85)ranked.push({term,count:value,frequency});await pause();
    }
    ranked.sort((a,b)=>(1+Math.log(b.count))*(1+Math.log((count+1)/(b.frequency+1)))-(1+Math.log(a.count))*(1+Math.log((count+1)/(a.frequency+1)))||compare(a.term,b.term));
    const candidates=new Map<string,number>();let visits=0;
    for(const {term,count:weight} of ranked.slice(0,SIMILARITY_LIMITS.queryTerms)){
      let after:string|undefined;
      do{const page=await this.store.scan('papers',{search:term,after,limit:50});for(const row of page.rows){if(visits++>=SIMILARITY_LIMITS.postingVisitsPerPaper)break;if(row.id!==paperId)candidates.set(row.id,(candidates.get(row.id)??0)+weight);}after=page.next;check();await pause();}while(after&&visits<SIMILARITY_LIMITS.postingVisitsPerPaper);
      if(visits>=SIMILARITY_LIMITS.postingVisitsPerPaper)break;
    }
    if(!candidates.size){
      const legacy=await this.store.get('neighbors',paperId,{maxBytes:64*1024,signal}) as Neighbor[]|undefined;
      const retained:Neighbor[]=[];for(const value of legacy??[])if(value.paperId!==paperId&&await this.store.reference('papers',value.paperId))retained.push(value);
      return retained.slice(0,Math.min(10,limit));
    }
    const bags=new Map<string,Map<string,number>>([[paperId,bag]]);
    for(const [id] of [...candidates].sort((a,b)=>b[1]-a[1]||compare(a[0],b[0])).slice(0,SIMILARITY_LIMITS.candidatesPerPaper)){
      check();const cached=await this.store.get('similarityVectors',id,{maxBytes:512*1024,signal}) as BagRecord|undefined;
      const source=await this.store.get('papers',id,{path:['fingerprint'],maxBytes:128,signal});
      bags.set(id,cached&&source===cached.sourceFingerprint?new Map(JSON.parse(cached.terms) as [string,number][]):similarityTermCounts(await this.paper(id,signal)));await pause();
    }
    // Terms outside retrieval are normalized from the bounded candidate scope.
    const localFrequency=new Map<string,number>();for(const values of bags.values())for(const term of values.keys())localFrequency.set(term,(localFrequency.get(term)??0)+1);
    const vectors=new Map<string,Map<string,number>>();
    for(const [id,values] of bags){let sum=0;const vector=new Map<string,number>();for(const [term,value] of values){const frequency=frequencies.get(term)??Math.max(1,Math.round((localFrequency.get(term)??1)*count/bags.size));if(frequency/count>.85)continue;const weight=(1+Math.log(value))*(1+Math.log((count+1)/(frequency+1)));vector.set(term,weight);sum+=weight*weight;}const norm=Math.sqrt(sum)||1;for(const [term,weight] of vector)vector.set(term,weight/norm);vectors.set(id,vector);}
    const query=vectors.get(paperId)!;return [...vectors].filter(([id])=>id!==paperId).map(([id,vector])=>{let score=0;for(const [term,weight] of query)score+=weight*(vector.get(term)??0);return {paperId:id,score:Math.min(1,score)};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||compare(a.paperId,b.paperId)).slice(0,Math.max(0,Math.min(10,limit)));
  }
}
