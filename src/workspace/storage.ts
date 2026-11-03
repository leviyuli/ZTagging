import {PayloadCodec} from './codec.ts';
import type {CodecOptions} from './codec.ts';
import {RETENTION_MS,STORAGE_SCHEMA_VERSION} from './storage-contract.ts';
import type {DocumentRef,PayloadIO,PayloadRow,PayloadToken,RecordMetadata,RecordPage,RetentionResult,ScanOptions,SqlPort,SqlValue,StorageStats,StoreCommit,StoreOperation,StoreReceipt,StoredRecord} from './storage-contract.ts';
export * from './storage-contract.ts';

const encoder=new TextEncoder();
const number=(value:unknown)=>Number(value??0);
const text=(value:unknown)=>String(value??'');
const bytes=(value:unknown)=>encoder.encode(JSON.stringify(value)).length;
const categories=['active','history','cache','ledger'] as const;
function* searchChunks(value:string):Generator<[number,string]>{for(let offset=0;;offset+=16*1024-511){yield [offset,value.slice(offset,offset+16*1024)];if(offset+16*1024>=value.length)return;}}
const schema=[
  'PRAGMA foreign_keys=ON',
  'PRAGMA auto_vacuum=INCREMENTAL',
  'PRAGMA journal_mode=WAL',
  'PRAGMA synchronous=FULL',
  'CREATE TABLE IF NOT EXISTS workspace_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS workspace_counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS workspace_payloads (id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, codec TEXT NOT NULL, data BLOB NOT NULL, raw_bytes INTEGER NOT NULL, stored_bytes INTEGER NOT NULL, logical_bytes INTEGER NOT NULL, refs INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS workspace_edges (parent INTEGER NOT NULL REFERENCES workspace_payloads(id) ON DELETE CASCADE, child INTEGER NOT NULL REFERENCES workspace_payloads(id) ON DELETE CASCADE, PRIMARY KEY(parent,child)) WITHOUT ROWID',
  'CREATE INDEX IF NOT EXISTS workspace_edges_child ON workspace_edges(child)',
  'CREATE INDEX IF NOT EXISTS workspace_payloads_unreferenced ON workspace_payloads(refs,id)',
  `CREATE TRIGGER IF NOT EXISTS workspace_edge_insert AFTER INSERT ON workspace_edges BEGIN UPDATE workspace_payloads SET refs=refs+1 WHERE id=NEW.child; END`,
  `CREATE TRIGGER IF NOT EXISTS workspace_edge_delete AFTER DELETE ON workspace_edges BEGIN UPDATE workspace_payloads SET refs=refs-1 WHERE id=OLD.child; END`,
  `CREATE TABLE IF NOT EXISTS workspace_records (collection TEXT NOT NULL,id TEXT NOT NULL,token TEXT NOT NULL,root_ref INTEGER REFERENCES workspace_payloads(id),version INTEGER NOT NULL,metadata TEXT NOT NULL,title TEXT NOT NULL,search_text TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL,task_id TEXT NOT NULL,native_item_id INTEGER,updated_at INTEGER NOT NULL,created_at INTEGER NOT NULL,completed_at INTEGER,last_used_at INTEGER,category TEXT NOT NULL,pinned INTEGER NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(collection,id))`,
  'CREATE INDEX IF NOT EXISTS workspace_records_status ON workspace_records(collection,status,id)',
  'CREATE INDEX IF NOT EXISTS workspace_records_task ON workspace_records(collection,task_id,id)',
  'CREATE INDEX IF NOT EXISTS workspace_records_expiry ON workspace_records(category,completed_at,last_used_at)',
  "CREATE INDEX IF NOT EXISTS workspace_records_native_item ON workspace_records(native_item_id) WHERE collection='papers' AND native_item_id IS NOT NULL",
  'CREATE TABLE IF NOT EXISTS workspace_search (collection TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(collection,id,position),FOREIGN KEY(collection,id) REFERENCES workspace_records(collection,id) ON DELETE CASCADE) WITHOUT ROWID',
  "CREATE TABLE IF NOT EXISTS workspace_links (owner_collection TEXT NOT NULL,owner_id TEXT NOT NULL,target_collection TEXT NOT NULL,target_id TEXT NOT NULL,relation TEXT NOT NULL DEFAULT 'source',PRIMARY KEY(owner_collection,owner_id,target_collection,target_id,relation),FOREIGN KEY(owner_collection,owner_id) REFERENCES workspace_records(collection,id) ON DELETE CASCADE) WITHOUT ROWID",
  'CREATE INDEX IF NOT EXISTS workspace_links_target ON workspace_links(target_collection,target_id,relation,owner_collection,owner_id)',
  'CREATE TABLE IF NOT EXISTS workspace_commands (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,receipt TEXT NOT NULL,created_at INTEGER NOT NULL)',
  `CREATE TRIGGER IF NOT EXISTS workspace_payload_insert AFTER INSERT ON workspace_payloads BEGIN UPDATE workspace_counters SET value=value+1 WHERE name='payloads'; UPDATE workspace_counters SET value=value+NEW.stored_bytes WHERE name='payloadBytes'; UPDATE workspace_counters SET value=value+NEW.raw_bytes WHERE name='rawPayloadBytes'; END`,
  `CREATE TRIGGER IF NOT EXISTS workspace_payload_delete AFTER DELETE ON workspace_payloads BEGIN UPDATE workspace_counters SET value=value-1 WHERE name='payloads'; UPDATE workspace_counters SET value=value-OLD.stored_bytes WHERE name='payloadBytes'; UPDATE workspace_counters SET value=value-OLD.raw_bytes WHERE name='rawPayloadBytes'; END`,
  `CREATE TRIGGER IF NOT EXISTS workspace_record_insert AFTER INSERT ON workspace_records BEGIN UPDATE workspace_counters SET value=value+1 WHERE name='records'; UPDATE workspace_counters SET value=value+1 WHERE name='count:'||NEW.category; UPDATE workspace_counters SET value=value+NEW.bytes WHERE name='bytes:'||NEW.category; UPDATE workspace_payloads SET refs=refs+1 WHERE id=NEW.root_ref; END`,
  `CREATE TRIGGER IF NOT EXISTS workspace_record_delete AFTER DELETE ON workspace_records BEGIN UPDATE workspace_counters SET value=value-1 WHERE name='records'; UPDATE workspace_counters SET value=value-1 WHERE name='count:'||OLD.category; UPDATE workspace_counters SET value=value-OLD.bytes WHERE name='bytes:'||OLD.category; UPDATE workspace_payloads SET refs=refs-1 WHERE id=OLD.root_ref; END`,
  `CREATE TRIGGER IF NOT EXISTS workspace_record_update AFTER UPDATE ON workspace_records BEGIN UPDATE workspace_counters SET value=value-1 WHERE name='count:'||OLD.category; UPDATE workspace_counters SET value=value-OLD.bytes WHERE name='bytes:'||OLD.category; UPDATE workspace_counters SET value=value+1 WHERE name='count:'||NEW.category; UPDATE workspace_counters SET value=value+NEW.bytes WHERE name='bytes:'||NEW.category; UPDATE workspace_payloads SET refs=refs-1 WHERE id=OLD.root_ref; UPDATE workspace_payloads SET refs=refs+1 WHERE id=NEW.root_ref; END`,
];

class SqlPayloadIO implements PayloadIO {
  private pending=new Map<string,{row:PayloadRow;children:readonly string[]}>();
  private pendingBytes=0;
  private sql:SqlPort;
  private readOnly:boolean;
  constructor(sql:SqlPort,readOnly=false){this.sql=sql;this.readOnly=readOnly;}
  async get(hash:string):Promise<PayloadRow|undefined>{
    const pending=this.pending.get(hash);if(pending)return pending.row;
    const row=(await this.sql.query('SELECT hash,codec,data,raw_bytes,logical_bytes FROM workspace_payloads WHERE hash=?',[hash]))[0];
    if(!row)return;
    return {hash:text(row.hash),codec:row.codec==='gzip'?'gzip':'raw',data:row.data instanceof Uint8Array?row.data:new Uint8Array(row.data as number[]),rawBytes:number(row.raw_bytes),logicalBytes:number(row.logical_bytes)};
  }
  async put(row:PayloadRow,children:readonly string[]){
    if(this.readOnly)throw new Error('This workspace connection is read-only.');
    if(this.pending.has(row.hash))return;
    if(this.pendingBytes+row.data.length+children.length*128>48*1024)await this.flush();
    this.pending.set(row.hash,{row,children});this.pendingBytes+=row.data.length+children.length*128;
    if(this.pendingBytes>=48*1024)await this.flush();
  }
  async flush(){
    if(!this.pending.size)return;
    const entries=[...this.pending.values()];
    // Staging precedes the small document commit. One bounded transaction avoids
    // a durable disk sync for every immutable node and edge during migration.
    await this.sql.transaction(async()=>{
      await this.sql.batch('INSERT OR IGNORE INTO workspace_payloads(hash,codec,data,raw_bytes,stored_bytes,logical_bytes) VALUES(?,?,?,?,?,?)',entries.map(({row})=>[row.hash,row.codec,row.data,row.rawBytes,row.data.length,row.logicalBytes]));
      const edges=entries.flatMap(({row,children})=>children.map(child=>[row.hash,child]));
      for(let index=0;index<edges.length;index+=128)await this.sql.batch('INSERT INTO workspace_edges(parent,child) VALUES((SELECT id FROM workspace_payloads WHERE hash=?),(SELECT id FROM workspace_payloads WHERE hash=?)) ON CONFLICT(parent,child) DO NOTHING',edges.slice(index,index+128));
    });
    for(const {row} of entries)this.pending.delete(row.hash);
    this.pendingBytes=[...this.pending.values()].reduce((sum,item)=>sum+item.row.data.length+item.children.length*128,0);
  }
}

export interface StoreOptions extends CodecOptions {clock?:()=>number;readOnly?:boolean}
export class WorkspaceStore {
  readonly codec:PayloadCodec;
  private sql:SqlPort;
  private now:()=>number;
  private tail:Promise<unknown>=Promise.resolve();
  private leases=0;
  private closed=false;
  private readOnly=false;
  private incrementalVacuum:boolean|undefined;
  private constructor(sql:SqlPort,options:StoreOptions){this.sql=sql;this.readOnly=options.readOnly??false;this.now=options.clock??Date.now;this.codec=new PayloadCodec(new SqlPayloadIO(sql,this.readOnly),{...options,clock:()=>globalThis.performance?.now?.()??Date.now()});}
  static async open(sql:SqlPort,options:StoreOptions={}):Promise<WorkspaceStore>{
    const version=number((await sql.query('PRAGMA user_version'))[0]?.user_version);
    if(version>STORAGE_SCHEMA_VERSION)throw new Error(`Workspace uses newer storage schema ${version}. Install the matching extension.`);
    if(options.readOnly){if(version!==STORAGE_SCHEMA_VERSION)throw new Error('The workspace migration is not ready.');return new WorkspaceStore(sql,options);}
    const recordColumns=await sql.query('PRAGMA table_info(workspace_records)');
    if(recordColumns.length&&!recordColumns.some(column=>column.name==='native_item_id'))await sql.query('ALTER TABLE workspace_records ADD COLUMN native_item_id INTEGER');
    for(const statement of schema)await sql.query(statement);
    for(const name of ['revision','records','payloads','payloadBytes','rawPayloadBytes',...categories.flatMap(category=>['count:'+category,'bytes:'+category])])await sql.query('INSERT OR IGNORE INTO workspace_counters(name,value) VALUES(?,0)',[name]);
    await sql.query('PRAGMA user_version='+STORAGE_SCHEMA_VERSION);
    return new WorkspaceStore(sql,options);
  }
  private check(){if(this.closed)throw new Error('The workspace store is closed.');}
  private serial<T>(operation:()=>Promise<T>):Promise<T>{this.check();if(this.readOnly)throw new Error('This workspace connection is read-only.');const next=this.tail.catch(()=>{}).then(operation);this.tail=next;return next;}
  lease():()=>void{this.check();this.leases++;let released=false;return()=>{if(!released){released=true;this.leases--;}};}
  private record(row:Record<string,unknown>):StoredRecord{const metadata=JSON.parse(text(row.metadata)) as RecordMetadata;if(row.native_item_id!==undefined&&row.native_item_id!==null)metadata.nativeItemId=number(row.native_item_id);return {collection:text(row.collection),id:text(row.id),token:JSON.parse(text(row.token)) as PayloadToken,version:number(row.version),metadata,bytes:number(row.bytes)};}
  async reference(collection:string,id:string):Promise<StoredRecord|undefined>{this.check();const row=(await this.sql.query('SELECT collection,id,token,version,metadata,native_item_id,bytes FROM workspace_records WHERE collection=? AND id=?',[collection,id]))[0];return row?this.record(row):undefined;}
  async get(collection:string,id:string,options:{path?:readonly(string|number)[];maxBytes?:number;signal?:AbortSignal}={}):Promise<unknown>{
    const record=await this.reference(collection,id);if(!record)return;
    const token=options.path?await this.codec.lookup(record.token,options.path):record.token;
    return token?this.codec.read(token,options):undefined;
  }
  async put(collection:string,id:string,value:unknown,metadata:RecordMetadata={}):Promise<StoreReceipt>{return this.mutate({commandId:crypto.randomUUID(),operations:[{kind:'put',collection,id,value,metadata}]},false);}
  async putReference(collection:string,id:string,token:PayloadToken,metadata:RecordMetadata={}):Promise<StoreReceipt>{return this.mutate({commandId:crypto.randomUUID(),operations:[{kind:'reference',collection,id,token,metadata}]},false);}
  async delete(collection:string,id:string):Promise<StoreReceipt>{return this.mutate({commandId:crypto.randomUUID(),operations:[{kind:'delete',collection,id}]},false);}
  commit(command:StoreCommit):Promise<StoreReceipt>{return this.mutate(command,true);}
  commitRecords(operations:StoreOperation[]):Promise<StoreReceipt>{return this.mutate({commandId:crypto.randomUUID(),operations},false);}
  private async mutate(command:StoreCommit,trackIdentity:boolean):Promise<StoreReceipt>{
    if(!command.commandId||command.commandId.length>200)throw new Error('A workspace command requires a bounded identity.');
    if(bytes(command.receipt??null)>16*1024)throw new Error('A workspace receipt must contain identities, not complete results.');
    return this.serial(async()=>{
      const existing=trackIdentity?(await this.sql.query('SELECT receipt FROM workspace_commands WHERE id=?',[command.commandId]))[0]:undefined;if(existing)return JSON.parse(text(existing.receipt)) as StoreReceipt;
      const release=this.lease();
      try{
        const prepared:{operation:StoreOperation;token?:PayloadToken}[]=[];
        for(const operation of command.operations){this.validateIdentity(operation);const token=operation.kind==='put'?await this.codec.encode(operation.value):operation.kind==='reference'?operation.token:undefined;prepared.push({operation,...(token?{token:await this.codec.reference(token)}:{})});}
        await this.codec.flush();
        return await this.sql.transaction(async()=>{
          const duplicate=trackIdentity?(await this.sql.query('SELECT receipt FROM workspace_commands WHERE id=?',[command.commandId]))[0]:undefined;if(duplicate)return JSON.parse(text(duplicate.receipt)) as StoreReceipt;
          const revision=number((await this.sql.query("SELECT value FROM workspace_counters WHERE name='revision'"))[0]?.value)+1;
          for(const {operation,token} of prepared){
            const previous=await this.reference(operation.collection,operation.id);
            if(operation.expectedVersion!==undefined&&(previous?.version??0)!==operation.expectedVersion)throw new Error('This workspace record changed. Refresh before applying the change.');
            if(operation.kind==='delete')await this.sql.query('DELETE FROM workspace_records WHERE collection=? AND id=?',[operation.collection,operation.id]);
            else await this.write(operation.collection,operation.id,token!,operation.metadata??previous?.metadata??{},revision,operation.kind==='reference'?operation.copyIndexFrom??operation:undefined,previous);
          }
          const receipt:StoreReceipt={commandId:command.commandId,revision,...(command.receipt!==undefined?{result:command.receipt}:{})};
          await this.sql.query("UPDATE workspace_counters SET value=? WHERE name='revision'",[revision]);
          if(trackIdentity)await this.sql.query('INSERT INTO workspace_commands(id,revision,receipt,created_at) VALUES(?,?,?,?)',[command.commandId,revision,JSON.stringify(receipt),this.now()]);
          return receipt;
        });
      }finally{release();}
    });
  }
  private validateIdentity(ref:DocumentRef){if(!ref.collection||ref.collection.length>100||!ref.id||ref.id.length>1000)throw new Error('A workspace record requires bounded collection and item identities.');}
  private async write(collection:string,id:string,token:PayloadToken,metadata:RecordMetadata,revision:number,indexSource?:DocumentRef,previous?:StoredRecord){
    if(metadata.nativeItemId!==undefined&&(!Number.isSafeInteger(metadata.nativeItemId)||metadata.nativeItemId<=0))throw new Error('A native item identity must be a positive integer.');
    if(metadata.nativeVersion!==undefined&&(typeof metadata.nativeVersion!=='string'||metadata.nativeVersion.length>2048))throw new Error('A native item version must be a bounded string.');
    const indexing:RecordMetadata={title:metadata.title?.slice(0,1000),type:metadata.type?.slice(0,100),status:metadata.status?.slice(0,100),taskId:metadata.taskId?.slice(0,1000),nativeItemId:metadata.nativeItemId,nativeVersion:metadata.nativeVersion,updatedAt:metadata.updatedAt,completedAt:metadata.completedAt,lastUsedAt:metadata.lastUsedAt,category:metadata.category,pinned:metadata.pinned,order:metadata.order,count:metadata.count};
    const now=this.now(),category=metadata.category??'active';if(!categories.includes(category))throw new Error('Unknown workspace record category.');
    const hash='ref' in token?token.ref:null,root=hash?(await this.sql.query('SELECT id FROM workspace_payloads WHERE hash=?',[hash]))[0]?.id as number|undefined:null;
    if(hash&&root===undefined)throw new Error(`A document references an incomplete workspace payload (${collection}/${id}).`);
    const json=JSON.stringify(indexing),tokenJSON=JSON.stringify(token),size=await this.codec.logicalSize(token)+bytes(indexing);
    const preserveIndex=indexSource&&metadata.searchText===undefined;if(preserveIndex)this.validateIdentity(indexSource);
    if(previous&&JSON.stringify(previous.token)===tokenJSON&&this.sameMetadata(previous.metadata,indexing)&&await this.sameLinks(collection,id,metadata.refs??[])&&await this.sameIndex(collection,id,metadata,indexSource))return;
    await this.sql.query(`INSERT INTO workspace_records(collection,id,token,root_ref,version,metadata,title,search_text,type,status,task_id,native_item_id,updated_at,created_at,completed_at,last_used_at,category,pinned,bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET token=excluded.token,root_ref=excluded.root_ref,version=excluded.version,metadata=excluded.metadata,title=excluded.title,search_text=excluded.search_text,type=excluded.type,status=excluded.status,task_id=excluded.task_id,native_item_id=excluded.native_item_id,updated_at=excluded.updated_at,completed_at=excluded.completed_at,last_used_at=excluded.last_used_at,category=excluded.category,pinned=excluded.pinned,bytes=excluded.bytes`,[collection,id,tokenJSON,root??null,revision,json,indexing.title??'',(indexing.title??'').toLocaleLowerCase(),indexing.type??'',indexing.status??'',indexing.taskId??'',metadata.nativeItemId??null,metadata.updatedAt??now,now,metadata.completedAt??null,metadata.lastUsedAt??null,category,metadata.pinned?1:0,size]);
    if(preserveIndex&&(indexSource.collection!==collection||indexSource.id!==id)){
      await this.sql.query('DELETE FROM workspace_search WHERE collection=? AND id=?',[collection,id]);
      await this.sql.query('INSERT INTO workspace_search(collection,id,position,body) SELECT ?,?,position,body FROM workspace_search WHERE collection=? AND id=?',[collection,id,indexSource.collection,indexSource.id]);
    }else if(!preserveIndex||!(await this.sql.query('SELECT position FROM workspace_search WHERE collection=? AND id=? LIMIT 1',[collection,id])).length){
      await this.sql.query('DELETE FROM workspace_search WHERE collection=? AND id=?',[collection,id]);
      const source=(metadata.searchText??metadata.title??'').toLocaleLowerCase();
      for(const [offset,body] of searchChunks(source))await this.sql.batch('INSERT INTO workspace_search(collection,id,position,body) VALUES(?,?,?,?)',[[collection,id,offset,body]]);
    }
    await this.sql.query('DELETE FROM workspace_links WHERE owner_collection=? AND owner_id=?',[collection,id]);
    const refs=metadata.refs??[];for(const ref of refs)this.validateIdentity(ref);
    for(let index=0;index<refs.length;index+=100)await this.sql.batch('INSERT OR IGNORE INTO workspace_links(owner_collection,owner_id,target_collection,target_id,relation) VALUES(?,?,?,?,?)',refs.slice(index,index+100).map(ref=>[collection,id,ref.collection,ref.id,ref.relation??'source']));
  }
  private sameMetadata(before:RecordMetadata,after:RecordMetadata):boolean{
    const comparable=(value:RecordMetadata)=>({title:value.title??'',type:value.type??'',status:value.status??'',taskId:value.taskId??'',nativeItemId:value.nativeItemId??null,nativeVersion:value.nativeVersion??null,completedAt:value.completedAt??null,lastUsedAt:value.lastUsedAt??null,category:value.category??'active',pinned:!!value.pinned,order:value.order??null,count:value.count??null});
    return JSON.stringify(comparable(before))===JSON.stringify(comparable(after));
  }
  private async sameLinks(collection:string,id:string,refs:readonly DocumentRef[]):Promise<boolean>{
    const key=(ref:DocumentRef)=>JSON.stringify([ref.collection,ref.id,ref.relation??'source']),wanted=new Set(refs.map(key));
    const count=number((await this.sql.query('SELECT COUNT(*) AS count FROM workspace_links WHERE owner_collection=? AND owner_id=?',[collection,id]))[0]?.count);if(count!==wanted.size)return false;
    for(let offset=0;offset<count;offset+=50){const rows=await this.sql.query('SELECT target_collection,target_id,relation FROM workspace_links WHERE owner_collection=? AND owner_id=? ORDER BY target_collection,target_id,relation LIMIT 50 OFFSET ?',[collection,id,offset]);for(const row of rows)if(!wanted.has(key({collection:text(row.target_collection),id:text(row.target_id),relation:text(row.relation)})))return false;}return true;
  }
  private async sameIndex(collection:string,id:string,metadata:RecordMetadata,source?:DocumentRef):Promise<boolean>{
    if(source&&metadata.searchText===undefined)return source.collection===collection&&source.id===id;
    const text=(metadata.searchText??metadata.title??'').toLocaleLowerCase(),step=16*1024-511,expected=Math.max(1,Math.ceil(Math.max(0,text.length-16*1024)/step)+1),count=number((await this.sql.query('SELECT COUNT(*) AS count FROM workspace_search WHERE collection=? AND id=?',[collection,id]))[0]?.count);
    if(count!==expected)return false;
    for(const [offset,body] of searchChunks(text))if(!(await this.sql.query('SELECT position FROM workspace_search WHERE collection=? AND id=? AND position=? AND body=?',[collection,id,offset,body])).length)return false;return true;
  }
  async scan(collection:string,options:ScanOptions={}):Promise<RecordPage>{
    this.check();const where=['collection=?'],parameters:SqlValue[]=[collection];
    if(options.search){const search=options.search.toLocaleLowerCase();if(search.length>512)throw new Error('Use a search of at most 512 characters.');where.push('EXISTS(SELECT 1 FROM workspace_search search WHERE search.collection=workspace_records.collection AND search.id=workspace_records.id AND instr(search.body,?)>0)');parameters.push(search);}
    if(options.status){where.push('status=?');parameters.push(options.status);}
    if(options.statuses?.length){where.push('status IN ('+options.statuses.map(()=>'?').join(',')+')');parameters.push(...options.statuses);}
    if(options.taskId){where.push('task_id=?');parameters.push(options.taskId);}
    if(options.type){where.push('type=?');parameters.push(options.type);}
    if(options.referencedBy){
      const owner=options.referencedBy;this.validateIdentity({collection:owner.collection,id:owner.taskId});
      where.push('EXISTS(SELECT 1 FROM workspace_links incoming JOIN workspace_records owner ON owner.collection=incoming.owner_collection AND owner.id=incoming.owner_id WHERE incoming.target_collection=workspace_records.collection AND incoming.target_id=workspace_records.id AND incoming.owner_collection=? AND owner.task_id=? AND incoming.relation=?)');parameters.push(owner.collection,owner.taskId,owner.relation??'source');
    }
    if(options.nativeItemId!==undefined){if(!Number.isSafeInteger(options.nativeItemId)||options.nativeItemId<=0)throw new Error('A native item identity must be a positive integer.');where.push("collection='papers' AND native_item_id=?");parameters.push(options.nativeItemId);}
    const clauses=options.referenceClauses??(options.references?[options.references]:[]);
    const reference=(ref:DocumentRef):string=>{
      const relation=ref.relation??'source';
      if(ref.includeDescendants){
        parameters.push(ref.id,ref.collection,ref.collection,ref.collection,relation);
        return "EXISTS(WITH RECURSIVE descendants(id) AS (SELECT ? UNION SELECT hierarchy.owner_id FROM workspace_links hierarchy JOIN descendants ON hierarchy.target_id=descendants.id WHERE hierarchy.owner_collection=? AND hierarchy.target_collection=? AND hierarchy.relation='broader') SELECT 1 FROM workspace_links matching WHERE matching.owner_collection=workspace_records.collection AND matching.owner_id=workspace_records.id AND matching.target_collection=? AND matching.relation=? AND matching.target_id IN (SELECT id FROM descendants))";
      }
      parameters.push(ref.collection,ref.id,relation);
      return 'EXISTS(SELECT 1 FROM workspace_links matching WHERE matching.owner_collection=workspace_records.collection AND matching.owner_id=workspace_records.id AND matching.target_collection=? AND matching.target_id=? AND matching.relation=?)';
    };
    if(clauses.length)where.push('('+clauses.map(clause=>'('+clause.map(group=>group.length?'('+group.map(reference).join(' OR ')+')':'0').join(' AND ')+')').join(options.referenceMode==='any'?' OR ':' AND ')+')');
    const total=number((await this.sql.query('SELECT COUNT(*) AS count FROM workspace_records WHERE '+where.join(' AND '),parameters))[0]?.count);
    if(options.after){where.push('id>?');parameters.push(options.after);}
    const limit=Math.min(50,Math.max(1,Math.floor(options.limit??50)));
    const ordering=options.orderBy==='title'?'title COLLATE NOCASE,id':options.orderBy==='order'?"CAST(json_extract(metadata,'$.order') AS INTEGER),id":options.orderBy==='completed'?'COALESCE(completed_at,updated_at) DESC,id DESC':'id';
    const rows=await this.sql.query('SELECT collection,id,token,version,metadata,native_item_id,bytes FROM workspace_records WHERE '+where.join(' AND ')+' ORDER BY '+ordering+' LIMIT ? OFFSET ?',[...parameters,limit,Math.max(0,Math.floor(options.offset??0))]);
    const records=rows.map(row=>this.record(row));return {rows:records,total,...(records.length===limit?{next:records.at(-1)!.id}:{})};
  }
  async links(collection:string,id:string,options:{offset?:number;limit?:number}={}):Promise<{rows:DocumentRef[];next?:number;total:number}>{
    this.check();const limit=Math.min(50,Math.max(1,options.limit??50)),offset=Math.max(0,options.offset??0);
    const total=number((await this.sql.query('SELECT COUNT(*) AS count FROM workspace_links WHERE owner_collection=? AND owner_id=?',[collection,id]))[0]?.count);
    const rows=await this.sql.query('SELECT target_collection,target_id,relation FROM workspace_links WHERE owner_collection=? AND owner_id=? ORDER BY target_collection,target_id,relation LIMIT ? OFFSET ?',[collection,id,limit,offset]);
    return {rows:rows.map(row=>({collection:text(row.target_collection),id:text(row.target_id),relation:text(row.relation)})),total,...(offset+rows.length<total?{next:offset+rows.length}:{})};
  }
  async touch(collection:string,id:string):Promise<void>{
    await this.serial(async()=>{const record=await this.reference(collection,id);if(!record)return;const metadata={...record.metadata,lastUsedAt:this.now()};await this.sql.query('UPDATE workspace_records SET last_used_at=?,metadata=? WHERE collection=? AND id=?',[metadata.lastUsedAt,JSON.stringify(metadata),collection,id]);});
  }
  async stats({includeDatabase=false}:{includeDatabase?:boolean}={}):Promise<StorageStats>{
    this.check();const counters=Object.fromEntries((await this.sql.query('SELECT name,value FROM workspace_counters')).map(row=>[text(row.name),number(row.value)]));
    let databaseBytes:number|undefined;
    if(includeDatabase){const [count,size]=await Promise.all([this.sql.query('PRAGMA page_count'),this.sql.query('PRAGMA page_size')]);databaseBytes=number(count[0]?.page_count)*number(size[0]?.page_size);}
    return {revision:counters.revision??0,records:counters.records??0,payloads:counters.payloads??0,payloadBytes:counters.payloadBytes??0,rawPayloadBytes:counters.rawPayloadBytes??0,categories:Object.fromEntries(categories.map(category=>[category,{records:counters['count:'+category]??0,bytes:counters['bytes:'+category]??0}])) as StorageStats['categories'],decodedCacheBytes:this.codec.decodedCacheBytes,...(databaseBytes!==undefined?{databaseBytes}:{})};
  }
  async retain(now=this.now(),limit=50,signal?:AbortSignal):Promise<RetentionResult>{
    return this.serial(async()=>{
      const check=()=>{if(signal?.aborted)throw signal.reason??new Error('Workspace retention cancelled.');};check();
      if(this.leases)return {recordsRemoved:0,payloadsRemoved:0,bytesRemoved:0,more:true};
      await this.codec.flush();
      const maximum=Math.min(50,Math.max(1,Math.floor(limit))),result=await this.sql.transaction(async()=>{
        const live=`WITH RECURSIVE live(collection,id) AS (SELECT collection,id FROM workspace_records WHERE pinned=1 OR category IN ('active','ledger') OR status IN ('pending','queued','running','paused','open','deferred','prepared','unknown') OR (category='history' AND COALESCE(completed_at,created_at)>=?) OR (category='cache' AND COALESCE(last_used_at,updated_at)>=?) UNION SELECT links.target_collection,links.target_id FROM workspace_links links JOIN live ON links.owner_collection=live.collection AND links.owner_id=live.id)`;
        const cutoff=now-RETENTION_MS,expired=await this.sql.query(live+' SELECT collection,id FROM workspace_records records WHERE NOT EXISTS(SELECT 1 FROM live WHERE live.collection=records.collection AND live.id=records.id) LIMIT ?',[cutoff,cutoff,maximum]);
        for(const row of expired){check();await this.sql.query('DELETE FROM workspace_records WHERE collection=? AND id=?',[text(row.collection),text(row.id)]);}
        const unreachable='SELECT id,stored_bytes FROM workspace_payloads WHERE refs=0 LIMIT ?';
        const payloads=await this.sql.query(unreachable,[maximum]);
        for(const row of payloads){check();await this.sql.query('DELETE FROM workspace_payloads WHERE id=?',[number(row.id)]);}
        if(payloads.length)this.codec.clear();
        return {recordsRemoved:expired.length,payloadsRemoved:payloads.length,bytesRemoved:payloads.reduce((sum,row)=>sum+number(row.stored_bytes),0),more:expired.length>=maximum||payloads.length>0,removed:expired.map(row=>({collection:text(row.collection),id:text(row.id)}))};
      });
      check();
      if(this.incrementalVacuum===undefined)this.incrementalVacuum=number((await this.sql.query('PRAGMA auto_vacuum'))[0]?.auto_vacuum)===2;
      if(this.incrementalVacuum){
        const free=number((await this.sql.query('PRAGMA freelist_count'))[0]?.freelist_count);
        if(free){check();await this.sql.query('PRAGMA incremental_vacuum(32)');result.more||=free>32;}
      }
      return result;
    });
  }
  async close(){if(this.closed)return;await this.tail.catch(()=>{});this.closed=true;this.codec.clear();await this.sql.close();}
}
