import {canonicalTagKey} from './core.ts';
import type {Facet} from './core.ts';

export type NormalizationVersion=1|2;
export const NORMALIZATION_VERSION:NormalizationVersion=2;
export interface TerminologyEntry {name:string;fullName:string;aliases:string[]}
/** Deliberately finite: scientific equivalence is never inferred by deleting punctuation or suffixes. */
export const TERMINOLOGY:readonly TerminologyEntry[]=[
  {name:'Co',fullName:'cobalt',aliases:[]},
  {name:'CO',fullName:'carbon monoxide',aliases:[]},
  {name:'FC',fullName:'fuel cell',aliases:['fuel cells']},
  {name:'PEMFC',fullName:'proton exchange membrane fuel cell',aliases:['proton-exchange membrane fuel cell','proton exchange membrane fuel cells','proton-exchange membrane fuel cells','polymer electrolyte membrane fuel cell','polymer electrolyte membrane fuel cells']},
  {name:'AEMFC',fullName:'anion exchange membrane fuel cell',aliases:['anion-exchange membrane fuel cell','anion exchange membrane fuel cells','anion-exchange membrane fuel cells']},
  {name:'WE',fullName:'water electrolysis',aliases:['water electrolyzer','water electrolyzers','water electrolyser','water electrolysers']},
  {name:'PEMWE',fullName:'proton exchange membrane water electrolysis',aliases:['proton-exchange membrane water electrolysis','proton exchange membrane water electrolyzer','proton exchange membrane water electrolyzers','proton-exchange membrane water electrolyzers','polymer electrolyte membrane water electrolysis']},
  {name:'AEMWE',fullName:'anion-exchange membrane water electrolyzer',aliases:['AEMWEs','AEM-WE','anion exchange membrane water electrolysis','anion-exchange membrane water electrolysis','anion exchange membrane water electrolyzer','anion exchange membrane water electrolyzers','anion-exchange membrane water electrolyzers','anion exchange membrane water electrolyser','anion exchange membrane water electrolysers','anion-exchange membrane water electrolyser','anion-exchange membrane water electrolysers','anion exchange membrane water electrolyzers (AEMWEs)','anion-exchange membrane water electrolyzers (AEMWEs)']},
  {name:'CL',fullName:'catalyst layer',aliases:['catalyst layers','catalyst-layer','catalyst-layers']},
  {name:'GDL',fullName:'gas diffusion layer',aliases:['gas diffusion layers','gas-diffusion layer','gas-diffusion layers']},
  {name:'PTL',fullName:'porous transport layer',aliases:['porous transport layers','porous-transport layer','porous-transport layers']},
  {name:'MEA',fullName:'membrane electrode assembly',aliases:['membrane electrode assemblies','membrane-electrode assembly','membrane-electrode assemblies']},
  {name:'EIS',fullName:'electrochemical impedance spectroscopy',aliases:[]},
];

const exactNames=new Map(TERMINOLOGY.flatMap(entry=>[entry.name,entry.fullName,...entry.aliases].map(label=>[canonicalTagKey(label),entry] as const)));
const technology=TERMINOLOGY.filter(entry=>!['Co','CO'].includes(entry.name));
const abbreviationNames=new Map(technology.flatMap(entry=>[entry.name,`${entry.name}s`,...entry.aliases.filter(alias=>/^[A-Z-]+s?$/.test(alias))].map(label=>[label,entry] as const)));
for(const [alias,name] of Object.entries({'AEM-FC':'AEMFC','PEM-FC':'PEMFC','AEM-WE':'AEMWE','PEM-WE':'PEMWE'}))abbreviationNames.set(alias,technology.find(entry=>entry.name===name)!);
const ordinary=(value:string)=>canonicalTagKey(value.replace(/[-‐‑–]/g,' ').replace(/\s+/g,' ').trim());
const expandedNames=new Map<string,TerminologyEntry|null>();
for(const entry of technology)for(const label of [entry.fullName,...entry.aliases]){const key=ordinary(label),previous=expandedNames.get(key);expandedNames.set(key,previous&&previous!==entry?null:previous===null?null:entry);}

export function terminologyFor(label:string,version:NormalizationVersion=2):TerminologyEntry|undefined {
  const key=canonicalTagKey(label);
  const exact=exactNames.get(key);
  if(exact||version===1)return exact;
  const short=abbreviationNames.get(label.trim());if(short)return short;
  const expanded=/^(.*?)\s*\(([^()]+)\)\s*$/.exec(label),full=expanded?expanded[1]:label;
  const match=expandedNames.get(ordinary(full));if(!match)return undefined;
  return !expanded||abbreviationNames.get(expanded[2].trim())?.name===match.name?match:undefined;
}
/** Only dictionary-established equivalence may coalesce persistent registry entries. */
export function terminologyKey(label:string,version:NormalizationVersion=2):string {return canonicalTagKey(terminologyFor(label,version)?.name??label);}
export function equivalentTerminology(a:string,b:string,version:NormalizationVersion=2):boolean{return terminologyKey(a,version)===terminologyKey(b,version);}
export function preferredTechnologyFacet(label:string):Facet|undefined {
  const name=terminologyFor(label)?.name;
  if(!name)return undefined;
  return ['FC','PEMFC','AEMFC','WE','PEMWE','AEMWE'].includes(name)?'system':name==='EIS'?'method':'component';
}

const SINGULAR:Readonly<Record<string,string>>=Object.freeze({'schottky barriers':'schottky barrier','fuel cells':'fuel cell','catalyst layers':'catalyst layer','grooved catalyst layers':'grooved catalyst layer','batteries':'battery','electrodes':'electrode','membranes':'membrane','nanoparticles':'nanoparticle'});
function ordinaryWord(word:string):string {
  if(word==='pH'||word==='Co'||word==='CO'||/^[A-Z]{2,8}$/.test(word)||/\d|[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉+−=]/.test(word))return word;
  // The canonical comparator already recognizes elemental symbols and chemical formulae.
  return canonicalTagKey(word)===word&&/[A-Z]/.test(word)?word:word.toLowerCase();
}
export function preferredCoreNaming(name:string,fullName=name,aliases:readonly string[]=[],version:NormalizationVersion=2):{name:string;fullName:string;aliases:string[]} {
  const known=terminologyFor(name,version)??terminologyFor(fullName,version);
  if(known)return {name:known.name,fullName:known.fullName,aliases:[...new Set([...aliases,name,fullName,...known.aliases])].filter(value=>value!==known.name&&value!==known.fullName)};
  const normalize=(value:string)=>{const ordinary=value.trim().replace(/\s+/g,' ').split(' ').map(ordinaryWord).join(' ');return SINGULAR[ordinary]??ordinary;};
  const preferred=normalize(name),full=normalize(fullName);
  return {name:preferred,fullName:full,aliases:[...new Set([...aliases,...(preferred!==name?[name]:[]),...(full!==fullName?[fullName]:[])])].filter(value=>value!==preferred&&value!==full)};
}
