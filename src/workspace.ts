import type {Workspace,WorkspaceCommand,WorkspaceCommandOptions,CommandReceipt,ViewQuery,ViewEvent} from './workspace-contract.ts';
import type {ManagerUIOptions} from './ui.ts';
import {NativeSqlPort} from './workspace/native-sql.ts';
import {WorkspaceHost} from './workspace/native-host.ts';
import {SecureCredentials,registerOAuthCallback,chooseJSONFile} from './platform.ts';
import {transferBuffers} from './workspace/rpc.ts';
import type {SqlValue} from './workspace/storage-contract.ts';

interface PromiseWorker {
  post(method:string,args:unknown[],closure?:unknown,transfers?:ArrayBuffer[]):Promise<unknown>;
  terminate():void;
}
interface Watcher {query:ViewQuery;receive:(event:ViewEvent)=>void;signal:AbortSignal;epoch:number;queryId:string}
export interface NativeWorkspace extends Workspace {
  ready:Promise<void>;
  notify(changes:{itemID:number;attachment?:boolean}[]):Promise<void>;
  readonly host:WorkspaceHost;
  readonly diagnostics:{phase:string;revision:number;error?:string;progress?:ViewEvent['progress'];pendingSQL:number;lastSQL?:string};
}
export function createNativeWorkspace(options:{directory:string;rootURI:string;openManager:(options?:ManagerUIOptions)=>Promise<Window|null>;indexLibrary?:boolean}):NativeWorkspace {
  const {BasePromiseWorker}=ChromeUtils.importESModule('resource://gre/modules/PromiseWorker.sys.mjs');
  const primarySqlPromise=NativeSqlPort.open(PathUtils.join(options.directory,'workspace.sqlite'));
  let viewSqlPromise:Promise<NativeSqlPort>|undefined;
  const host=new WorkspaceHost(),credentials=new SecureCredentials();
  const diagnostics:NativeWorkspace['diagnostics']={phase:'opening',revision:0,pendingSQL:0};
  const watchers=new Set<Watcher>(),callbacks=new Map<string,{dispose:()=>void}>();
  let closed=false,readerReady=false,refreshTimer:ReturnType<typeof setTimeout>|undefined;
  let closing:Promise<void>|undefined;
  let transfers=0;const transferWaiters:(()=>void)[]=[];
  async function boundedTransfer<T>(operation:()=>Promise<T>):Promise<T>{
    if(transfers>=2)await new Promise<void>(resolve=>transferWaiters.push(resolve));else transfers++;
    try{return await operation();}finally{const next=transferWaiters.shift();if(next)next();else transfers--;}
  }
  let primary!:PromiseWorker,reader!:PromiseWorker;
  const sqlCall=async(sql:NativeSqlPort,method:string,args:unknown[])=>{
    if(method==='query')return sql.query(String(args[0]),args[1] as SqlValue[]|undefined);
    if(method==='batch'){await sql.batch(String(args[0]),args[1] as SqlValue[][]);return;}
    if(method==='begin')return sql.begin();if(method==='commit')return sql.finish(true);if(method==='rollback')return sql.finish(false);if(method==='close')return;
    throw new Error('Unknown workspace database operation.');
  };
  const functions=(view:boolean)=>({
    async hostCall(method:string,args:unknown[]){
      try{
      if(method.startsWith('sql.')){
        diagnostics.pendingSQL++;diagnostics.lastSQL=method+' '+String(args[0]??'').slice(0,100);
        try{
        const connection=view?viewSqlPromise:primarySqlPromise;if(!connection)throw new Error('The workspace reader has not opened.');
        const operation=()=>connection.then(sql=>sqlCall(sql,method.slice(4),args));
        const result=method==='sql.query'||method==='sql.batch'?await boundedTransfer(operation):await operation(),buffers=transferBuffers(result);
        return buffers.length?new BasePromiseWorker.Meta(result,{transfers:buffers}):result;
        }finally{diagnostics.pendingSQL--;}
      }
      if(view)throw new Error('A page query cannot change library data.');
      if(method==='changed'){diagnostics.revision=Number(args[0]);scheduleRefresh();return;}
      if(method==='phase'){diagnostics.phase=String(args[0]);diagnostics.progress=args[1] as ViewEvent['progress'];scheduleRefresh();return;}
      if(method==='credentials.load')return credentials.load(String(args[0]));
      if(method==='credentials.save')return credentials.save(String(args[0]),String(args[1]));
      if(method==='credentials.remove')return credentials.remove(String(args[0]));
      if(method==='credentials.status')return credentials.sessionOnly?'Session only · OS credential encryption unavailable':'Encrypted with the operating-system keystore';
      if(method==='openExternal'){Zotero.launchURL(String(args[0]));return;}
      if(method==='oauth.register'){
        const path=String(args[0]),listener=await registerOAuthCallback(path,query=>primary.post('oauthCallback',[path,query]) as Promise<{status:number;body:string}>);callbacks.set(path,listener);return {port:listener.port};
      }
      if(method==='oauth.dispose'){callbacks.get(String(args[0]))?.dispose();callbacks.delete(String(args[0]));return;}
      if(method==='file.choose')return chooseJSONFile(args[0] as 'open'|'save',String(args[1]??'smart-tags-vocabulary.json'));
      if(method==='host.ids')return host.ids(String(args[0]),args[1] as string|undefined);
      if(method==='host.libraryPage')return host.libraryPage(args[0] as string|undefined);
      if(method==='host.read')return host.read(Number(args[0]));
      if(method==='host.paperField')return host.paperField(String(args[0]),args[1] as Parameters<WorkspaceHost['paperField']>[1],Number(args[2]),Number(args[3]));
      if(method==='host.releasePaper')return host.releasePaper(String(args[0]));
      if(method==='host.inspectInputs')return host.inputSources(Number(args[0]),args[1] as boolean|undefined);
      if(method==='host.readTags')return host.host.readTags(Number(args[0]));
      if(method==='host.pdfSource')return host.pdfSource(Number(args[0]));
      if(method==='host.apply')return host.apply(args[0] as Parameters<WorkspaceHost['apply']>[0],String(args[1]),async()=>{});
      if(method==='host.applyMetadata')return host.applyMetadata(args[0] as Parameters<WorkspaceHost['applyMetadata']>[0],String(args[1]),async()=>{});
      const methods:Record<string,unknown>=host.host as unknown as Record<string,unknown>;
      const invoke=methods[method.slice(5)];
      if(method.startsWith('host.')&&typeof invoke==='function')return Reflect.apply(invoke,host.host,args);
      throw new Error('Unknown workspace host operation.');
      }catch(error){
        // PromiseWorker sends host failures through structured clone unchanged.
        // A plain record survives Gecko compartments, including native errors.
        throw {name:error instanceof Error?error.name:'Error',message:error instanceof Error?error.message:String(error)};
      }
    },
  });
  primary=new BasePromiseWorker('chrome://smart-tags/content/workspace-worker.js',{},functions(false));
  reader=new BasePromiseWorker('chrome://smart-tags/content/workspace-query-worker.js',{},functions(true));
  const ready=primarySqlPromise.then(()=>closed?undefined:primary.post('open',[{directory:options.directory,processSessionId:(()=>{try{const started=Number(Services.startup.getStartupInfo().process),pid=Number(Services.appinfo.processID);return Number.isSafeInteger(started)&&started>0&&Number.isSafeInteger(pid)&&pid>0?`zotero-process:${pid}:${started}`:undefined;}catch{return undefined;}})()}])).then(async()=>{
    if(closed)return;
    viewSqlPromise=NativeSqlPort.open(PathUtils.join(options.directory,'workspace.sqlite'),{readOnly:true});
    await viewSqlPromise;if(closed)return;await reader.post('open',[{directory:options.directory}]);if(closed)return;readerReady=true;diagnostics.phase='ready';diagnostics.progress=undefined;scheduleRefresh();
    void primary.post('resumeQueued',[]).catch(error=>{if(!closed){diagnostics.error=error instanceof Error?error.message:String(error);Zotero.logError(error);scheduleRefresh();}});
    if(options.indexLibrary!==false)void primary.post('startIndexing',[]).catch(error=>{if(!closed){diagnostics.error=error instanceof Error?error.message:String(error);Zotero.logError(error);scheduleRefresh();}});
  }).catch(error=>{if(!closed){diagnostics.phase='error';diagnostics.error=error instanceof Error?error.message:String(error);scheduleRefresh();}throw error;});
  async function refresh(watcher:Watcher){
    if(closed||watcher.signal.aborted)return;const epoch=++watcher.epoch;
    loading(watcher);
    try{
      await ready;if(closed||watcher.signal.aborted||epoch!==watcher.epoch)return;
      const event=await reader.post('view',[watcher.query,{queryId:watcher.queryId}]) as ViewEvent;
      if(!closed&&!watcher.signal.aborted&&epoch===watcher.epoch)watcher.receive(event);
    }catch(error){if(!closed&&!watcher.signal.aborted&&epoch===watcher.epoch)watcher.receive({phase:'error',revision:diagnostics.revision,error:error instanceof Error?error.message:String(error)});}
  }
  function loading(watcher:Watcher){watcher.receive({phase:'loading',revision:diagnostics.revision,message:diagnostics.phase.startsWith('migration')?'Updating saved Smart Tags data. Zotero remains available.':'Opening Smart Tags…',...(diagnostics.progress?{progress:diagnostics.progress}:{})});}
  function scheduleRefresh(){if(closed||refreshTimer!==undefined||!watchers.size)return;refreshTimer=setTimeout(()=>{refreshTimer=undefined;for(const watcher of watchers)if(readerReady)void refresh(watcher);else loading(watcher);},250);}
  return {
    ready,host,diagnostics,
    async execute(command:WorkspaceCommand,{commandId,signal}:WorkspaceCommandOptions):Promise<CommandReceipt>{
      if(closed)throw new Error('Smart Tags is closed.');if(signal?.aborted)throw signal.reason;
      const payload=command.payload&&typeof command.payload==='object'?command.payload as Record<string,unknown>:{};
      if(['tag','rebuild','prepare-tags','scan','preview-detail'].includes(command.type)&&(payload.scope==='selected'||payload.scope==='collections')&&!payload.frozenPaperIDs){
        command={...command,payload:{...payload,frozenPaperIDs:await host.capturePaperScope(payload.scope)}};
      }
      await ready;if(closed)throw new Error('Smart Tags is closed.');if(signal?.aborted)throw signal.reason;
      if(command.type==='check-plugin-updates'){await options.openManager({page:'settings'});const win=Zotero.getMainWindow();win?.document.getElementById('menu_addons')?.doCommand();return {commandId,revision:diagnostics.revision};}
      const abort=()=>{void primary.post('cancel',[commandId]).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
      try{return await primary.post('execute',[command,{commandId}]) as CommandReceipt;}
      finally{signal?.removeEventListener('abort',abort);}
    },
    watch(query,receive,{signal}){
      if(closed||signal.aborted)return()=>{};
      const watcher:Watcher={query,receive,signal,epoch:0,queryId:crypto.randomUUID()};watchers.add(watcher);void refresh(watcher);
      const stop=()=>{watcher.epoch++;watchers.delete(watcher);signal.removeEventListener('abort',stop);if(!closed)void reader.post('cancel',[watcher.queryId]).catch(()=>{});};signal.addEventListener('abort',stop,{once:true});return stop;
    },
    async notify(changes){if(!closed){await ready;if(!closed)await primary.post('itemsChanged',[changes]);}},
    close(reason){
      if(closing)return closing;closed=true;host.stop();if(refreshTimer!==undefined)clearTimeout(refreshTimer);watchers.clear();
      for(const listener of callbacks.values())listener.dispose();callbacks.clear();
      closing=(async()=>{
        try{await primary.post('close',[reason]);await ready.catch(()=>{});}
        finally{
          reader.terminate();primary.terminate();
          const connections=await Promise.allSettled([primarySqlPromise,...(viewSqlPromise?[viewSqlPromise]:[])]);
          await Promise.allSettled(connections.filter((value):value is PromiseFulfilledResult<NativeSqlPort>=>value.status==='fulfilled').map(value=>value.value.close()));credentials.clearMemory();
        }
      })();return closing;
    },
  };
}
