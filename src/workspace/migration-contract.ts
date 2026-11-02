import type {JsonScalar,PayloadToken,RecordMetadata} from './storage-contract.ts';

export interface MigrationIO {
  read(path:string,options:{offset:number;maxBytes:number}):Promise<Uint8Array>;
  exists(path:string):Promise<boolean>;
  stat(path:string):Promise<{size:number;lastModified?:number}>;
  copyExact(source:string,destination:string):Promise<void>;
  writeAtomic(path:string,bytes:Uint8Array):Promise<void>;
  remove(path:string):Promise<void>;
}
export interface MigrationCodec {
  value(value:JsonScalar):Promise<PayloadToken>;
  text(chunks:AsyncIterable<string>):Promise<PayloadToken>;
  arrayBuilder():{append(value:PayloadToken):Promise<void>;finish():Promise<PayloadToken>};
  objectBuilder():{append(key:string,value:PayloadToken):Promise<void>;finish():Promise<PayloadToken>};
}
export interface WorkspaceLocator {
  schemaVersion:14;
  storage:{format:'workspace-sqlite-v1';generation:string;database:'workspace.sqlite'};
}
export interface MigrationContext {
  generation:string;sourcePath:string;sourceVersion:number;sourceBytes:number;sourceFingerprint:string;
  startedAt:number;root:PayloadToken;fields:ReadonlyMap<string,PayloadToken>;
  backup?:{path:string;createdAt:number;expiresAt:number;verifiedRestarts:0;fingerprint:string;bytes:number};
}
/** Every operation addresses an isolated staging generation until activate succeeds. */
export interface MigrationTarget {
  codec:MigrationCodec;
  begin(context:{generation:string;sourcePath:string;sourceBytes:number;startedAt:number}):Promise<void>;
  putReference(collection:string,id:string,token:PayloadToken,metadata:RecordMetadata):Promise<void>;
  validateLegacy(context:MigrationContext):Promise<{valid:boolean;reason?:string}>;
  normalizeLegacy(context:MigrationContext):Promise<void>;
  validateCurrent(context:MigrationContext):Promise<void>;
  prepare(context:MigrationContext,locator:WorkspaceLocator):Promise<void>;
  activate(context:MigrationContext,locator:WorkspaceLocator):Promise<void>;
  abort(generation:string):Promise<void>;
}
export interface MigrationOptions {
  signal?:AbortSignal;clock?:()=>number;crypto?:Crypto;generation?:()=>string;
  yieldControl?:()=>Promise<void>;
  progress?:(value:{phase:'reading'|'validating'|'backup'|'normalizing'|'activating';bytes:number;total:number})=>void;
}
export interface MigrationResult {
  locator:WorkspaceLocator;context:MigrationContext;recovered:boolean;
}
export class LegacyValidationError extends Error {constructor(message:string){super(message);this.name='LegacyValidationError';}}
export class NewerWorkspaceStateError extends Error {constructor(version:number){super(`Smart Tags state uses newer schema ${version}. Install the matching extension version.`);this.name='NewerWorkspaceStateError';}}
