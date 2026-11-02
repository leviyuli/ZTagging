export interface NativeItemIdentity {itemID:number;paperId:string;version:string}
export interface NativeLibraryPage {items:NativeItemIdentity[];cursor?:string;total:number}
export interface IndexedNativeRecord {id:string;nativeItemId?:number;nativeVersion?:string}
export interface NativeIndexPort {
  page(cursor?:string):Promise<NativeLibraryPage>;
  lookup(itemID:number):Promise<IndexedNativeRecord|undefined>;
  ingestBatch(items:readonly NativeItemIdentity[]):Promise<void>;
  indexedPage(after?:string):Promise<{rows:IndexedNativeRecord[];next?:string}>;
  removeMissingIds(ids:readonly string[]):Promise<number|void>;
}
export interface NativeIndexProgress {phase:'indexing'|'reconciling'|'completed';checked:number;changed:number;removed:number;total:number}
export interface NativeIndexOptions {
  signal?:AbortSignal;
  clock?:()=>number;
  yieldControl?:()=>Promise<void>;
  onProgress?:(progress:NativeIndexProgress)=>void;
}

/** Runs in the worker. Only identities cross the native bridge until a source changed. */
export async function indexNativeLibrary(port:NativeIndexPort,options:NativeIndexOptions={}):Promise<NativeIndexProgress>{
  const now=options.clock??(()=>performance.now()),yieldControl=options.yieldControl??(()=>new Promise(resolve=>setTimeout(resolve,0)));
  const present=new Map<number,string>(),seenCursors=new Set<string>();let lastYield=now();
  const progress:NativeIndexProgress={phase:'indexing',checked:0,changed:0,removed:0,total:0};
  const check=()=>options.signal?.throwIfAborted();
  const yieldIfNeeded=async(force=false)=>{check();if(force||now()-lastYield>=4){await yieldControl();lastYield=now();check();}};
  const publish=()=>{check();options.onProgress?.({...progress});};
  let cursor:string|undefined;
  do{
    check();const page=await port.page(cursor);check();
    if(page.items.length>50||!Number.isSafeInteger(page.total)||page.total<0)throw new Error('Native indexing requires bounded identity pages.');
    progress.total=page.total;const changed:NativeItemIdentity[]=[];
    for(const item of page.items){
      if(!Number.isSafeInteger(item.itemID)||item.itemID<1||!item.paperId||typeof item.version!=='string'||item.version.length>1024||present.has(item.itemID))throw new Error('Native indexing received an invalid or repeated identity.');
      present.set(item.itemID,item.paperId);const indexed=await port.lookup(item.itemID);check();
      if(!indexed||indexed.id!==item.paperId||indexed.nativeVersion!==item.version)changed.push(item);
      progress.checked++;await yieldIfNeeded();
    }
    for(let offset=0;offset<changed.length;offset+=10){check();const batch=changed.slice(offset,offset+10);await port.ingestBatch(batch);check();progress.changed+=batch.length;await yieldIfNeeded();}
    publish();cursor=page.cursor;
    if(cursor){if(seenCursors.has(cursor))throw new Error('Native indexing received a repeated page cursor.');seenCursors.add(cursor);}
    await yieldIfNeeded(true);
  }while(cursor);

  // Reconcile only after every native identity page succeeded. A cancelled or failed
  // scan cannot mistake an unread page for papers deleted from Zotero.
  progress.phase='reconciling';publish();let after:string|undefined;const seenIndexedCursors=new Set<string>();
  do{
    check();const page=await port.indexedPage(after);check();if(page.rows.length>50)throw new Error('Native reconciliation requires bounded record pages.');
    const missing:string[]=[];
    for(const row of page.rows){
      if(row.nativeItemId!==undefined&&present.get(row.nativeItemId)!==row.id)missing.push(row.id);
      await yieldIfNeeded();
    }
    if(missing.length){check();const removed=await port.removeMissingIds(missing);check();if(removed!==undefined&&(!Number.isSafeInteger(removed)||removed<0||removed>missing.length))throw new Error('Native reconciliation returned an invalid removal count.');progress.removed+=removed??missing.length;}
    after=page.next;if(after){if(seenIndexedCursors.has(after))throw new Error('Native reconciliation received a repeated page cursor.');seenIndexedCursors.add(after);}
    publish();await yieldIfNeeded(true);
  }while(after);
  progress.phase='completed';publish();return {...progress};
}
