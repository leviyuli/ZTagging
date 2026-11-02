/** These masks separate saved scientific meanings from old, unverified native labels. */
export type NativePaperBindingExclusions = Record<string,string[]>;
export type NativeBindingExclusions = Record<string,NativePaperBindingExclusions>;
export type NativeBindingRecords = Record<string,Record<string,string[]|null>>;
export interface NativeBindingProjection {nativeBindingExclusions?:NativePaperBindingExclusions}

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const names=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(name=>typeof name==='string'&&name.length>0);
const own=<T>(value:Record<string,T>|undefined,key:string):T|undefined=>value&&Object.hasOwn(value,key)?value[key]:undefined;

export function validBindingExclusions(value:unknown):value is NativeBindingExclusions {
  return record(value)&&Object.entries(value).every(([tagId,papers])=>!!tagId&&record(papers)&&Object.entries(papers).every(([paperId,values])=>!!paperId&&names(values)));
}

export function validNativeBindingRecords(value:unknown):value is NativeBindingRecords {
  return record(value)&&Object.entries(value).every(([tagId,papers])=>!!tagId&&record(papers)&&Object.entries(papers).every(([paperId,values])=>!!paperId&&(values===null||names(values))));
}

export function nativeBindingAllows(tagId:string,paperId:string,name:string,exclusions?:NativeBindingExclusions):boolean {
  return !own(own(exclusions,tagId),paperId)?.includes(name);
}

/** A missing paper identity must not bypass a projected mask on that exact raw label. */
export function nativePaperBindingAllows(paperId:string|undefined,name:string,exclusions?:NativePaperBindingExclusions):boolean {
  return paperId===undefined?!Object.values(exclusions??{}).some(values=>values.includes(name)):!own(exclusions,paperId)?.includes(name);
}

export function nativeBindingProjection(tagId:string,exclusions?:NativeBindingExclusions):NativePaperBindingExclusions|undefined {
  const papers=own(exclusions,tagId);
  return papers&&Object.values(papers).some(values=>values.length)?Object.fromEntries(Object.entries(papers).map(([paperId,values])=>[paperId,[...values]])):undefined;
}

export function nativeBindingRecordsMatch(current:NativeBindingExclusions|undefined,records:NativeBindingRecords|undefined):boolean {
  return Object.entries(records??{}).every(([tagId,papers])=>Object.entries(papers).every(([paperId,expected])=>{
    const actual=own(own(current,tagId),paperId);
    return expected===null?actual===undefined:actual!==undefined&&actual.length===expected.length&&actual.every((name,index)=>name===expected[index]);
  }));
}

/** Sparse journals update only their own pairs and never overwrite unrelated masks. */
export function applyNativeBindingRecords(current:NativeBindingExclusions|undefined,records:NativeBindingRecords|undefined):NativeBindingExclusions {
  const next=new Map(Object.entries(current??{}).map(([tagId,papers])=>[tagId,new Map(Object.entries(papers).map(([paperId,values])=>[paperId,[...values]]))]));
  for(const [tagId,papers] of Object.entries(records??{})){
    const target=next.get(tagId)??new Map<string,string[]>();
    for(const [paperId,values] of Object.entries(papers))if(values===null)target.delete(paperId);else target.set(paperId,[...values]);
    if(target.size)next.set(tagId,target);else next.delete(tagId);
  }
  return Object.fromEntries([...next].filter(([,papers])=>papers.size).map(([tagId,papers])=>[tagId,Object.fromEntries(papers)]));
}
