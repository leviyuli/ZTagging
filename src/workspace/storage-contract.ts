export type SqlValue = null | string | number | Uint8Array;
export interface SqlPort {
  query(sql:string,params?:SqlValue[]):Promise<Record<string,unknown>[]>;
  batch(sql:string,bindings:SqlValue[][]):Promise<void>;
  transaction<T>(operation:()=>Promise<T>):Promise<T>;
  close():Promise<void>;
}

export type JsonScalar = null | boolean | number | string;
export type JsonValue = JsonScalar | JsonValue[] | {[key:string]:JsonValue};
export type PayloadToken = {value:JsonScalar} | {ref:string} | {inline:JsonValue[]|{[key:string]:JsonValue}};
export interface PayloadRow {
  hash:string;codec:'raw'|'gzip';data:Uint8Array;rawBytes:number;logicalBytes:number;
}
export interface PayloadIO {
  get(hash:string):Promise<PayloadRow|undefined>;
  put(row:PayloadRow,children:readonly string[]):Promise<void>;
  flush():Promise<void>;
}
export interface DocumentRef {collection:string;id:string;relation?:string;includeDescendants?:boolean}
export type RecordCategory = 'active'|'history'|'cache'|'ledger';
export interface RecordMetadata {
  title?:string;searchText?:string;type?:string;status?:string;taskId?:string;
  updatedAt?:number;completedAt?:number;lastUsedAt?:number;pinned?:boolean;
  category?:RecordCategory;refs?:DocumentRef[];order?:number;count?:number;
  nativeItemId?:number;
  nativeVersion?:string;
}
export interface StoredRecord extends DocumentRef {
  token:PayloadToken;version:number;metadata:RecordMetadata;bytes:number;
}
export interface ScanOptions {after?:string;offset?:number;limit?:number;search?:string;status?:string;statuses?:readonly string[];taskId?:string;type?:string;nativeItemId?:number;orderBy?:'id'|'title'|'order'|'completed';references?:DocumentRef[][];referenceClauses?:DocumentRef[][][];referenceMode?:'all'|'any'}
export interface RecordPage {rows:StoredRecord[];next?:string;total:number}
export type StoreOperation =
  | {kind:'put';collection:string;id:string;value:unknown;metadata?:RecordMetadata;expectedVersion?:number}
  | {kind:'reference';collection:string;id:string;token:PayloadToken;metadata?:RecordMetadata;expectedVersion?:number;copyIndexFrom?:DocumentRef}
  | {kind:'delete';collection:string;id:string;expectedVersion?:number};
export interface StoreCommit {commandId:string;operations:StoreOperation[];receipt?:unknown}
export interface StoreReceipt {commandId:string;revision:number;result?:unknown}
export interface StorageStats {
  revision:number;records:number;payloads:number;payloadBytes:number;rawPayloadBytes:number;
  categories:Record<RecordCategory,{records:number;bytes:number}>;decodedCacheBytes:number;databaseBytes?:number;
}
export interface RetentionResult {recordsRemoved:number;payloadsRemoved:number;bytesRemoved:number;more:boolean;removed?:DocumentRef[]}
export const STORAGE_SCHEMA_VERSION=14;
export const PAYLOAD_CHUNK_BYTES=64*1024;
export const DECODED_CACHE_BYTES=32*1024*1024;
export const RETENTION_MS=7*24*60*60*1000;
