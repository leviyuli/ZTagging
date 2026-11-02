import type {SqlPort,SqlValue} from './storage-contract.ts';

interface NativeRow {getResultByName(name:string):unknown}
export interface NativeSqlConnection {
  executeCached(sql:string,params?:unknown):Promise<NativeRow[]>;
  executeTransaction<T>(operation:()=>Promise<T>):Promise<T>;
  close():Promise<void>;
}
export interface NativeSqlOptions {readOnly?:boolean;clock?:()=>number;yield?:()=>Promise<void>}
const FRAME_BYTES=64*1024,RESULT_BYTES=256*1024;
function deferred<T>() {
  let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((ok,fail)=>{resolve=ok;reject=fail;});
  return {promise,resolve,reject};
}

/** Positions are retained so literals, quoted identifiers and comments cannot become bindings. */
function syntax(sql:string):{code:string;uncommented:string}{
  const code=sql.split(''),uncommented=sql.split('');let quote='',comment='';
  for(let index=0;index<sql.length;index++){
    const char=sql[index],next=sql[index+1];
    if(comment){
      if(comment==='line'&&(char==='\n'||char==='\r')){comment='';continue;}
      code[index]=uncommented[index]=' ';
      if(comment==='block'&&char==='*'&&next==='/'){code[++index]=uncommented[index]=' ';comment='';}
      continue;
    }
    if(quote){code[index]=' ';if(char===quote){if(next===quote){code[++index]=' ';}else quote='';}continue;}
    if(char==='-'&&next==='-'||char==='/'&&next==='*'){comment=char==='-'?'line':'block';code[index]=uncommented[index]=' ';code[++index]=uncommented[index]=' ';continue;}
    if(char==="'"||char==='"'||char==='`'||char==='['){quote=char==='['?']':char;code[index]=' ';}
  }
  return {code:code.join(''),uncommented:uncommented.join('')};
}
function bindings(sql:string,values:SqlValue[]):{sql:string;params:Record<string,SqlValue>|undefined}{
  const code=syntax(sql).code;let index=0,prepared='';
  for(let offset=0;offset<sql.length;offset++){
    if(code[offset]!=='?'){prepared+=sql[offset];continue;}
    if(/\d/.test(code[offset+1]??''))throw new Error('Workspace SQL requires anonymous positional bindings.');
    prepared+=`:v${index++}`;
  }
  if(index!==values.length)throw new Error('Workspace SQL binding count does not match its values.');
  return {sql:prepared,params:values.length?Object.fromEntries(values.map((value,index)=>[`v${index}`,value])):undefined};
}
function sqlValueBytes(value:SqlValue){return value instanceof Uint8Array?value.byteLength:typeof value==='string'?value.length*3:8;}
const identifier='(?:"(?:[^"]|"")*"|`(?:[^`]|``)*`|\\[(?:[^\\]]|\\]\\])*\\]|[A-Za-z_]\\w*)';
function unquote(value:string){const first=value[0],last=value.at(-1);return first==='['&&last===']'?value.slice(1,-1).replace(/]]/g,']'):first===last&&(first==='"'||first==='`')?value.slice(1,-1).replaceAll(first+first,first):value;}
export function sqlProjection(sql:string):{fields:string;table?:string}|undefined {
  const {code,uncommented}=syntax(sql);let depth=0,select=-1;
  for(let index=0;index<code.length;index++){
    const char=code[index];if(char==='('){depth++;continue;}if(char===')'){depth--;continue;}
    if(depth||!/[A-Za-z_]/.test(char)||index&&/[A-Za-z_0-9]/.test(code[index-1]))continue;
    const word=/^[A-Za-z_]+/.exec(code.slice(index))![0].toUpperCase();
    if(word==='SELECT'&&select<0)select=index+word.length;
    else if(word==='FROM'&&select>=0){const table=new RegExp('^\\s*('+identifier+')').exec(uncommented.slice(index+4))?.[1];return {fields:uncommented.slice(select,index).trim().replace(/^DISTINCT\s+/i,''),...(table?{table:unquote(table)}:{})};}
    index+=word.length-1;
  }
  return select>=0?{fields:uncommented.slice(select).trim().replace(/;\s*$/,'')}:undefined;
}
function readStatement(sql:string){
  const code=syntax(sql).code.trim();if(/;\s*\S/.test(code))return false;
  if(/^(?:SELECT|WITH)\b/i.test(code))return !!sqlProjection(sql);
  const pragma=/^PRAGMA\s+(\w+)\s*(.*?);?$/i.exec(code);if(!pragma)return false;
  const name=pragma[1].toLowerCase(),tail=pragma[2].trim().replace(/;$/,'').trim();
  return ['table_info','index_list','index_info','foreign_key_list','foreign_key_check'].includes(name)?!tail.includes('='):!tail&&['user_version','page_count','freelist_count','page_size','journal_mode','data_version','query_only'].includes(name);
}

/** SQLite owns its asynchronous thread; this adapter only handles bounded transfer frames. */
export class NativeSqlPort implements SqlPort {
  private connection:NativeSqlConnection;
  private transactionGate:ReturnType<typeof deferred<void>>|null=null;
  private transactionDone:Promise<unknown>|null=null;
  private columnCache=new Map<string,string[]>();
  private now:()=>number;
  private yield:()=>Promise<void>;
  private lastYield:number;
  private readOnly:boolean;
  private closed=false;
  private constructor(connection:NativeSqlConnection,options:NativeSqlOptions){this.connection=connection;this.readOnly=options.readOnly??false;this.now=options.clock??(()=>globalThis.performance?.now?.()??Date.now());this.yield=options.yield??(()=>new Promise(resolve=>setTimeout(resolve,0)));this.lastYield=this.now();}
  /** Also accepts deterministic native-thread adapters for contract tests. */
  static attach(connection:NativeSqlConnection,options:NativeSqlOptions={}):NativeSqlPort{return new NativeSqlPort(connection,options);}
  static async open(path:string,options:NativeSqlOptions={}):Promise<NativeSqlPort> {
    const {Sqlite}=ChromeUtils.importESModule('resource://gre/modules/Sqlite.sys.mjs');
    // Store initialization enables incremental vacuum after choosing the page size.
    // Enabling it in openConnection would allocate Gecko's default 32 KiB page first.
    const connection:NativeSqlConnection=await Sqlite.openConnection({path,readOnly:options.readOnly??false,sharedMemoryCache:false,...(!options.readOnly?{vacuumOnIdle:false}:{}),shrinkMemoryOnConnectionIdleMS:1000});
    const port=new NativeSqlPort(connection,options);
    if(!options.readOnly)try{
      const tables=await port.query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'");
      if(Number(tables[0]?.count??0)===0){await port.query('PRAGMA page_size=4096');await port.query('PRAGMA auto_vacuum=INCREMENTAL');}
      await port.query('PRAGMA journal_mode=WAL');await port.query('PRAGMA synchronous=FULL');await port.query('PRAGMA foreign_keys=ON');await port.query('PRAGMA cache_size=-8192');
    }catch(error){await connection.close();throw error;}
    return port;
  }
  private check(write=false){if(this.closed)throw new Error('The workspace database is closed.');if(write&&this.readOnly)throw new Error('This workspace connection is read-only.');}
  private async yieldToUI(){if(this.now()-this.lastYield>=4){await this.yield();this.lastYield=this.now();}}
  async query(sql:string,params:SqlValue[]=[]):Promise<Record<string,unknown>[]> {
    this.check(this.readOnly&&!readStatement(sql));
    const prepared=bindings(sql,params),rows=await this.connection.executeCached(prepared.sql,prepared.params),result:Record<string,unknown>[]=[];
    if(rows.length>128)throw new Error('Workspace database queries require bounded result pages.');
    if(!rows.length)return result;
    const columns=await this.columns(sql);let bytes=0,blobBytes=0;
    for(const row of rows){
      const value:Record<string,unknown>={};
      for(const key of columns){
        const cell=row.getResultByName(key);
        if(Array.isArray(cell)||cell instanceof Uint8Array){const length=cell.length;blobBytes+=length;bytes+=length;if(blobBytes>FRAME_BYTES)throw new Error('Workspace payload reads exceed one 64 KiB chunk.');value[key]=cell instanceof Uint8Array?cell:new Uint8Array(cell);}
        else {bytes+=typeof cell==='string'?cell.length*3:8;value[key]=cell;}
        if(bytes>RESULT_BYTES)throw new Error('Workspace database result exceeds its bounded transfer size.');
      }
      result.push(value);await this.yieldToUI();
    }
    return result;
  }
  private async columns(sql:string):Promise<string[]> {
    const cached=this.columnCache.get(sql);if(cached){this.columnCache.delete(sql);this.columnCache.set(sql,cached);return cached;}
    const pragma=/^\s*PRAGMA\s+(\w+)/i.exec(sql);
    if(pragma){
      if(pragma[1].toLowerCase()==='incremental_vacuum')return [];
      if(pragma[1].toLowerCase()==='table_info')return ['cid','name','type','notnull','dflt_value','pk'];
      if(pragma[1].toLowerCase()==='foreign_key_check')return ['table','rowid','parent','fkid'];
      return [pragma[1]];
    }
    const selected=sqlProjection(sql);if(!selected)throw new Error('Workspace queries must name their result columns.');
    const fields:string[]=[],projection=selected.fields,code=syntax(projection).code;let depth=0,start=0;
    for(let index=0;index<=code.length;index++){const char=code[index];if(char==='(')depth++;else if(char===')')depth--;if(index===code.length||char===','&&!depth){fields.push(projection.slice(start,index).trim());start=index+1;}}
    const names:string[]=[];
    for(const field of fields){
      if(field==='*'||/^\w+\.\*$/.test(field)){
        if(!selected.table)throw new Error('Workspace wildcard queries require a table.');
        const info=await this.connection.executeCached('PRAGMA table_info("'+selected.table.replaceAll('"','""')+'")');
        for(const row of info)names.push(String(row.getResultByName('name')));
      }else{
        const alias=new RegExp('\\s+AS\\s+('+identifier+')$','i').exec(field),column=alias?.[1]??new RegExp('^(?:'+identifier+'\\.)?('+identifier+')$').exec(field)?.[1];
        if(!column)throw new Error('Workspace query expressions require AS aliases.');names.push(unquote(column));
      }
    }
    if(this.columnCache.size>=128)this.columnCache.delete(this.columnCache.keys().next().value!);this.columnCache.set(sql,names);return names;
  }
  async batch(sql:string,rows:SqlValue[][]):Promise<void> {
    this.check(true);let frame:Record<string,SqlValue>[]=[],bytes=0,preparedSQL='';
    const flush=async()=>{if(!frame.length)return;await this.connection.executeCached(preparedSQL,frame);frame=[];bytes=0;await this.yieldToUI();};
    for(const row of rows){
      const size=row.reduce<number>((total,value)=>total+sqlValueBytes(value),0),blob=row.some(value=>value instanceof Uint8Array);
      if(size>FRAME_BYTES+1024)throw new Error('A workspace SQL binding exceeds one chunk. Store large data as payload chunks.');
      if(frame.length&&(bytes+size>FRAME_BYTES||frame.length>=100||blob))await flush();
      const prepared=bindings(sql,row);preparedSQL=prepared.sql;frame.push(prepared.params??{});bytes+=size;if(blob)await flush();
    }
    await flush();
  }
  async transaction<T>(operation:()=>Promise<T>):Promise<T>{this.check(true);if(this.transactionGate)throw new Error('A workspace transaction is already in progress.');return this.connection.executeTransaction(operation);}
  async begin():Promise<void> {
    this.check(true);if(this.transactionGate)throw new Error('A workspace transaction is already in progress.');
    const started=deferred<void>(),gate=deferred<void>();this.transactionGate=gate;
    const done=this.connection.executeTransaction(async()=>{started.resolve();await gate.promise;});this.transactionDone=done;
    void done.catch(error=>{if(this.transactionDone===done){this.transactionGate=null;this.transactionDone=null;}started.reject(error);});await started.promise;
  }
  async finish(commit:boolean):Promise<void> {
    const gate=this.transactionGate,done=this.transactionDone;if(!gate||!done)throw new Error('No workspace transaction is in progress.');
    try{if(commit){gate.resolve();await done;}else{gate.reject(new Error('Workspace transaction cancelled.'));await done.catch(()=>{});}}finally{if(this.transactionDone===done){this.transactionGate=null;this.transactionDone=null;}}
  }
  async close():Promise<void>{if(this.closed)return;if(this.transactionGate)await this.finish(false);this.closed=true;await this.connection.close();}
}
