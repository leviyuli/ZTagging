import type {ManagerPage,ManagerSnapshot} from './ui-contract.ts';

export interface WorkspaceCommand {type:string;payload?:unknown}
export interface WorkspaceCommandOptions {commandId:string;signal?:AbortSignal}
export interface CommandReceipt {commandId:string;revision:number;taskId?:string;result?:unknown}
export interface ViewQuery {
  page:ManagerPage;
  params?:Record<string,unknown>;
  cursor?:string;
  limit?:number;
}
export interface ViewEvent {
  phase:'loading'|'ready'|'error';
  revision:number;
  model?:ManagerSnapshot;
  total?:number;
  nextCursor?:string;
  error?:string;
  message?:string;
  progress?:{label:string;completed:number;total:number};
}
export interface Workspace {
  execute(command:WorkspaceCommand,options:WorkspaceCommandOptions):Promise<CommandReceipt>;
  watch(query:ViewQuery,receive:(event:ViewEvent)=>void,options:{signal:AbortSignal}):()=>void;
  close(reason:'disable'|'shutdown'):Promise<void>;
}

export const WORKSPACE_LIMITS=Object.freeze({
  schemaVersion:14,
  chunkBytes:64*1024,
  viewBytes:256*1024,
  pageRows:50,
  decodedCacheBytes:32*1024*1024,
  bulkTransfers:2,
  mainSliceMs:4,
  workerSliceMs:8,
  progressMs:250,
  searchMs:100,
  nativeWriteItems:20,
  retentionDays:7,
});
