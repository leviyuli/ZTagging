import {validTagPreparationState} from '../tag-preparation.ts';
import type {PayloadCodec} from './codec.ts';
import type {PayloadToken} from './storage-contract.ts';
import {LegacyValidationError} from './migration-contract.ts';
import {validateRegistryGraph} from './migration-native-validation.ts';
import {validateSelectionGraph} from './migration-selection-validation.ts';

/** Archives retain opaque bodies; their existing structural guards stay intact. */
export async function validateArchiveGraph(codec:PayloadCodec,collection:string,token:PayloadToken,version:number,options:{signal?:AbortSignal}={}):Promise<boolean>{
  const read=async<T>(value:PayloadToken|undefined,maxBytes=256*1024):Promise<T>=>value?await codec.read(value,{maxBytes,signal:options.signal}) as T:undefined as T;
  const at=async<T>(token:PayloadToken,path:readonly(string|number)[])=>read<T>(await codec.lookup(token,path));
  const kind=async(value:PayloadToken|undefined,wanted:'object'|'array')=>!!value&&await codec.kind(value)===wanted;
  const fail=():never=>{throw new LegacyValidationError(`Legacy ${collection} contains an invalid archived record.`);};
  const entries=async function*(value:PayloadToken|undefined){if(!value)return;let after:number|undefined;for(;;){if(options.signal?.aborted)throw options.signal.reason;const page=await codec.entries(value,{after,limit:50});yield* page.entries;if(page.next===undefined)break;after=page.next;}};
  const fieldKind=async(value:PayloadToken,key:string,wanted:'object'|'array')=>kind(await codec.lookup(value,[key]),wanted);
  const textFields=async(value:PayloadToken,fields:string[])=>{for(const key of fields)if(typeof await at(value,[key])!=='string')fail();};
  const scopes=async(value:PayloadToken)=>{if(!await kind(value,'array'))fail();for await(const item of entries(value)){if(!await fieldKind(item.token,'support','object'))fail();const snapshot=await codec.lookup(item.token,['evidenceSnapshot']);if(!snapshot)fail();await validateRegistryGraph(codec,snapshot!,options);}};
  const preparation=async(value:PayloadToken)=>{
    for(const [key,wanted] of [['judgements','object'],['answers','object'],['questions','array'],['diagnostics','array'],['excluded','array']] as const)if(!await fieldKind(value,key,wanted))fail();
    const builder=codec.objectBuilder();for await(const field of entries(value))if(!['judgements','answers','questions','diagnostics','excluded'].includes(String(field.key)))await builder.append(String(field.key),field.token);
    const header=await read<Record<string,unknown>>(await builder.finish());if(!validTagPreparationState({...header,judgements:{},answers:{},questions:[],diagnostics:[],excluded:[]}))fail();
  };
  if(!await kind(token,'object'))fail();
  if(collection==='taxonomyArchives'){
    await textFields(token,['id']);if(!await fieldKind(token,'tags','array')||!await fieldKind(token,'redirects','object')||!Number.isInteger(await at(token,['version'])))fail();
    const prep=await codec.lookup(token,['preparation']);if(version>=4&&prep)await preparation(prep);
    const evidence=await codec.lookup(token,['evidenceScopes']);if(version>=5&&evidence)await scopes(evidence);return true;
  }
  if(collection==='preparationHistory'&&version>=4){
    await textFields(token,['id','date']);const proposal=await codec.lookup(token,['proposal']);if(!proposal||!await kind(proposal,'object')||!await fieldKind(proposal!,'tags','array')||!await fieldKind(proposal!,'merges','array')||!Number.isFinite(await at(token,['spentUSD'])))fail();const prep=await codec.lookup(token,['preparation']);if(prep)await preparation(prep);return true;
  }
  if(collection==='legacyConsolidationHistory'&&version>=6){await textFields(token,['runId']);if(!await fieldKind(token,'checkpoint','object'))fail();return true;}
  if(collection==='tagSelectionHistory'&&version>=6){await textFields(token,['runId']);const work=await codec.lookup(token,['work']);if(!work)fail();await validateSelectionGraph(codec,work!,options);return true;}
  if(collection==='analysisResetHistory'&&version>=9){
    await textFields(token,['id','date']);for(const key of ['factsCount','analysesCount']){const value=await at(token,[key]);if(!Number.isInteger(value)||Number(value)<0)fail();}
    if(!await fieldKind(token,'analyses','object')||!await fieldKind(token,'discardedSuggestions','array')||!await fieldKind(token,'unfinishedReviews','array'))fail();return true;
  }
  return false;
}
