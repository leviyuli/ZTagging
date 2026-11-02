import {ProviderClient} from '../providers.ts';
import type {CallbackResponse} from '../providers.ts';
import type {ManagerSnapshot} from '../ui-contract.ts';
import type {WorkspaceCommand} from '../workspace-contract.ts';
import {WorkspaceStore} from './storage.ts';
import {RemoteSqlPort,transferBuffers} from './rpc.ts';
import type {HostCall} from './rpc.ts';
import {WorkspaceEngine,createWorkerHost} from './engine.ts';
import {importIntoStore,readLocator} from './migration.ts';
import {StorageMigrationTarget,markVerifiedWorkspaceRestart,cleanupMigrationBackups} from './migration-target.ts';
import {nativeMigrationIO} from './migration-native.ts';
import type {MigrationIO,WorkspaceLocator} from './migration-contract.ts';
import {indexNativeLibrary} from './indexing.ts';
import type {NativeIndexProgress,NativeLibraryPage} from './indexing.ts';

export interface WorkerRuntimeOptions {call:HostCall;io?:MigrationIO;clock?:()=>number;createProvider?:(environment:ConstructorParameters<typeof ProviderClient>[0])=>ProviderClient}

/** Testable command-worker lifecycle; no host library object enters this module. */
export function createCommandRuntime({call,io=nativeMigrationIO,clock=Date.now,createProvider=environment=>new ProviderClient(environment)}:WorkerRuntimeOptions){
  const abort=new AbortController(),callbacks=new Map<string,(query:Record<string,string>)=>Promise<CallbackResponse>>();
  let store:WorkspaceStore|undefined,engine:WorkspaceEngine|undefined,provider:ProviderClient|undefined,opening:Promise<void>|undefined,closed=false,maintenance:ReturnType<typeof setTimeout>|undefined,signingIn=false;
  let openingPulse:ReturnType<typeof setTimeout>|undefined,lastProgress=0,openingPhase='opening',openingProgress:{label:string;completed:number;total:number}|undefined;
  let indexing:Promise<void>|undefined,indexProgressTail=Promise.resolve(),indexRequestTail=Promise.resolve(),lastIndexProgress=0,indexReady=false,indexAgain=false;
  function pulse(){if(closed)return;void call('phase',[openingPhase,openingProgress]).catch(()=>{});openingPulse=setTimeout(pulse,1000);}
  const changed=async()=>{if(store)await call('changed',[(await store.stats()).revision]);};
  const cleanupBackups=(signal:AbortSignal=abort.signal)=>cleanupMigrationBackups(store!,io,{clock,signal,recoveryOutstanding:async()=>!!await store!.get('state','pendingChange',{path:['id'],maxBytes:2048})||(await store!.scan('providerDispatches',{status:'unknown',limit:1})).total>0||(await store!.scan('history',{status:'conflict',limit:1})).total>0||(await store!.scan('commandLedger',{status:'unknown',limit:1})).total>0||(await store!.scan('paperAttentionRows',{status:'failed',limit:1})).total>0});
  const connection=async()=>{
    if(!provider||!store)return;
    const [apiKeyStored,deepseekKeyStored,session,status]=await Promise.all([provider.hasApiKey('api'),provider.hasApiKey('deepseek'),provider.getSession(),call('credentials.status',[])]);
    const settings=await store.get('state','settings') as {provider?:string;model?:string}|undefined;
    const verified=await store.scan('verifiedConnections',{limit:50});let isVerified=false;
    for(const row of verified.rows)if(await store.codec.read(row.token)===`${settings?.provider}:${settings?.model}`)isVerified=true;
    const summary:ManagerSnapshot['connection']={apiKeyStored,deepseekKeyStored,chatgptSignedIn:session.connected&&session.sharing,signingIn,accountLabel:session.email??undefined,accounts:session.accounts.map(account=>({id:account.id,label:account.label})),selectedAccountId:session.accountId??undefined,credentialStorage:String(status),verified:isVerified};
    await store.put('state','connectionSummary',summary,{category:'active'});await changed();
  };
  function scheduleMaintenance(delay=5000){if(closed||maintenance)return;maintenance=setTimeout(()=>{maintenance=undefined;void(async()=>{
    if(closed||abort.signal.aborted||!store)return;
    if(engine?.busy||indexing){scheduleMaintenance();return;}
    const result=await store.retain(clock(),50,abort.signal);
    await engine?.afterRetention(result);
    await cleanupBackups();
    if(!closed)scheduleMaintenance(result.more?50:60_000);
  })().catch(()=>{if(!closed)scheduleMaintenance(60_000);});},delay);}
  async function open({directory,processSessionId}:{directory:string;processSessionId?:string}){
    if(opening)return opening;
    pulse();
    opening=(async()=>{
      await call('phase',['opening']);store=await WorkspaceStore.open(new RemoteSqlPort(call),{cacheBytes:24*1024*1024});
      const separator=directory.includes('\\')?'\\':'/',path=directory.replace(/[\\/]+$/,'')+separator+'state.json',target=new StorageMigrationTarget(store,{clock,signal:abort.signal,yieldControl:()=>new Promise(resolve=>setTimeout(resolve,0))});
      let locator=await readLocator(io,path),fresh=false,migrated=false;
      if(locator)await target.resumePrepared(locator);
      else if(await io.exists(path)){migrated=true;openingPhase='migrating';await call('phase',[openingPhase]);locator=(await importIntoStore(io,path,target,{clock,signal:abort.signal,progress:progress=>{openingPhase=`migration:${progress.phase}`;openingProgress={label:progress.phase==='reading'?'Moving saved records':progress.phase==='validating'?'Checking saved records':progress.phase==='backup'?'Preserving the original data':progress.phase==='normalizing'?'Indexing saved records':'Finishing the update',completed:progress.phase==='reading'?progress.bytes:0,total:progress.phase==='reading'?progress.total:0};if(clock()-lastProgress>=250){lastProgress=clock();void call('phase',[openingPhase,openingProgress]).catch(()=>{});}}})).locator;}
      else{
        if(await store.reference('workspace','active'))throw new Error('The workspace locator is missing. Restore the locator before opening this database.');
        const generation=crypto.randomUUID();locator={schemaVersion:14,storage:{format:'workspace-sqlite-v1',generation,database:'workspace.sqlite'}};fresh=true;
      }
      if(abort.signal.aborted)throw abort.signal.reason;
      const metadata={get:async(key:string)=>await store!.get('metadata',key,{maxBytes:16*1024}) as string|undefined??null,set:async(key:string,value:string)=>{await store!.put('metadata',key,value,{category:'active'});}};
      provider=createProvider({credentials:{load:async key=>await call('credentials.load',[key]) as string|null,save:async(key,value)=>{await call('credentials.save',[key,value]);},remove:async key=>{await call('credentials.remove',[key]);}},metadata,crypto,fetch:globalThis.fetch.bind(globalThis),openExternal:url=>call('openExternal',[url]).then(()=>{}),registerCallback:async(path,handler)=>{callbacks.set(path,handler);const listener=await call('oauth.register',[path]) as {port:number};return {port:listener.port,dispose(){callbacks.delete(path);void call('oauth.dispose',[path]);}};},now:clock});
      const host=createWorkerHost(call,(path,offset,length)=>io.read(path,{offset,maxBytes:length}),()=>engine?.currentNativeGroup()??'');
      engine=new WorkspaceEngine({store,host,ai:provider,clock,signal:abort.signal,cleanupBackups,changed:revision=>call('changed',[revision]).then(()=>{}),importFile:async()=>{const file=await call('file.choose',['open']);if(typeof file!=='string')return null;const decoder=new TextDecoder(),parts:string[]=[];for(let offset=0;;offset+=64*1024){const bytes=await io.read(file,{offset,maxBytes:64*1024});if(!bytes.length)break;parts.push(decoder.decode(bytes,{stream:true}));}parts.push(decoder.decode());return JSON.parse(parts.join(''));},exportFile:async value=>{const file=await call('file.choose',['save']);if(typeof file==='string')await IOUtils.write(file,new TextEncoder().encode(JSON.stringify(value,null,2)),{tmpPath:file+'.tmp',flush:true});}});
      await engine.open({fresh});
      if(fresh){await store.put('workspace','active',{schemaVersion:14,generation:locator.storage.generation,locator,activatedAt:clock()},{category:'ledger',pinned:true});await io.writeAtomic(path,new TextEncoder().encode(JSON.stringify(locator)));}
      if(processSessionId)await verifyRestart(locator,processSessionId,migrated);await connection();await call('phase',['ready']);scheduleMaintenance();
    })().finally(()=>{if(openingPulse)clearTimeout(openingPulse);openingPulse=undefined;});return opening;
  }
  async function verifyRestart(locator:WorkspaceLocator,processSessionId:string,initial:boolean){await markVerifiedWorkspaceRestart(store!,locator.storage.generation,processSessionId,{initial,requireBaseline:true});}
  async function queueIndexing(){
    await opening;if(closed||!store||!engine||indexing||!indexReady)return;
    const source=store,app=engine;
    const background=async()=>{while(app.busy&&!closed&&!abort.signal.aborted)await new Promise(resolve=>setTimeout(resolve,25));abort.signal.throwIfAborted();};
    const progress=(value:NativeIndexProgress&{error?:string})=>{
      if(closed||abort.signal.aborted)return;
      if(value.phase!=='completed'&&!value.error&&clock()-lastIndexProgress<250)return;
      lastIndexProgress=clock();
      indexProgressTail=indexProgressTail.then(async()=>{if(closed)return;await source.put('state','libraryIndexProgress',value,{category:'active',status:value.error?'failed':value.phase});await changed();}).catch(()=>{});
    };
    let latest:NativeIndexProgress={phase:'indexing',checked:0,changed:0,removed:0,total:0};
    const finishRequests=async(error?:string)=>{let after:string|undefined;do{const page=await source.scan('libraryIndexRequests',{status:'queued',after,limit:50});if(page.rows.length)await source.commitRecords(page.rows.map(row=>({kind:'put',collection:'libraryIndexRequests',id:row.id,value:{commandId:row.id,status:error?'failed':'completed',...(error?{error}:{})},metadata:{category:'history',status:error?'failed':'completed',completedAt:clock()}})));after=page.next;}while(after&&!closed);};
    indexing=(async()=>{
      try{await indexNativeLibrary({
        page:async cursor=>{await background();return await call('host.libraryPage',[cursor]) as NativeLibraryPage;},
        lookup:async itemID=>{await background();const row=(await source.scan('papers',{nativeItemId:itemID,limit:1})).rows[0];return row?{id:row.id,nativeItemId:row.metadata.nativeItemId,nativeVersion:row.metadata.nativeVersion}:undefined;},
        ingestBatch:async items=>{await background();await app.ingestIndexed(items);},
        indexedPage:async after=>{await background();const page=await source.scan('papers',{after,limit:50});return {rows:page.rows.map(row=>({id:row.id,nativeItemId:row.metadata.nativeItemId,nativeVersion:row.metadata.nativeVersion})),next:page.next};},
        removeMissingIds:async ids=>{await background();return app.removeMissingIds(ids);},
      },{signal:abort.signal,onProgress:value=>{latest=value;progress(value);}});if(!closed&&!abort.signal.aborted)await finishRequests();}
      catch(error){if(!closed&&!abort.signal.aborted){const message=(error instanceof Error?error.message:String(error)).slice(0,2048);progress({...latest,error:message});await finishRequests(message);}}
    })().catch(error=>{if(!closed)progress({...latest,error:(error instanceof Error?error.message:String(error)).slice(0,2048)});}).finally(()=>{indexing=undefined;if(indexAgain&&!closed){indexAgain=false;void queueIndexing();}});
  }
  async function startIndexing(){indexReady=true;await engine?.resumeQueued();await queueIndexing();}
  return {
    open,
    startIndexing,
    async resumeQueued(){await opening;if(!closed)await engine?.resumeQueued();},
    async execute(command:WorkspaceCommand,options:{commandId:string}){
      await opening;if(!engine||closed)throw new Error('The workspace is not open.');
      if(command.type==='refresh-library-index'){
        const operation=indexRequestTail.then(async()=>{
          if(closed||!store)throw new Error('The workspace is not open.');
          const previous=await store.reference('libraryIndexRequests',options.commandId);
          const receipt=await store.commit({commandId:options.commandId,operations:previous?[]:[{kind:'put',collection:'libraryIndexRequests',id:options.commandId,value:{commandId:options.commandId,status:'queued',requestedAt:clock()},metadata:{category:'ledger',status:'queued',pinned:true}}],receipt:{queued:true,taskId:'library-index'}});
          if(!previous){if(indexing)indexAgain=true;await queueIndexing();}return receipt;
        });indexRequestTail=operation.then(()=>{},()=>{});return operation;
      }
      if(command.type==='sign-in'){signingIn=true;await connection();}
      try{return await engine.execute(command,options);}
      finally{if(command.type==='sign-in')signingIn=false;if(/settings|key|sign-in|sign-out|account|connection|models/.test(command.type))await connection();}
    },
    async itemsChanged(changes:{itemID:number;attachment?:boolean}[]){await opening;await engine?.itemsChanged(changes);},
    cancel(commandId:string){engine?.cancel(commandId);},
    async nativeChunkAck(groupId:string,offset:number){await engine?.nativeChunkAck(groupId,offset);},
    async oauthCallback(path:string,query:Record<string,string>){const handler=callbacks.get(path);return handler?handler(query):{status:410,body:'This sign-in has ended. Start again in Smart Tags.'};},
    async close(reason:'disable'|'shutdown'){
      if(closed)return;closed=true;abort.abort(new Error('Smart Tags closed.'));if(maintenance)clearTimeout(maintenance);if(openingPulse)clearTimeout(openingPulse);
      await provider?.dispose();await opening?.catch(()=>{});await indexRequestTail;await engine?.close(reason);await indexing?.catch(()=>{});await indexProgressTail;await store?.close();callbacks.clear();
    },
  };
}

type WorkerScope={importScripts?:(...paths:string[])=>void;require?:(path:string)=>{AbstractWorker:new()=>{dispatch:(method:string,args:unknown[])=>Promise<unknown>;postMessage:(...args:unknown[])=>void;close:()=>void;handleMessage:(event:unknown)=>void;callMainThread:(method:string,args:unknown[])=>Promise<unknown>};Meta:new(value:unknown,options:{transfers:ArrayBuffer[]})=>unknown};postMessage:(...args:unknown[])=>void;close:()=>void;onmessage?:(event:unknown)=>void};
const scope=globalThis as unknown as WorkerScope;
if(scope.importScripts){
  scope.importScripts('resource://gre/modules/workers/require.js');const promiseWorker=scope.require!('resource://gre/modules/workers/PromiseWorker.js'),worker=new promiseWorker.AbstractWorker();
  const runtime=createCommandRuntime({call:async(method,args)=>{let reply:{ok?:unknown;fail?:{message?:string}};try{reply=await worker.callMainThread('hostCall',[method,args]) as typeof reply;}catch(error){const failure=error&&typeof error==='object'?(Reflect.get(error,'fail')??error):error;throw new TypeError(failure&&typeof failure==='object'?String(Reflect.get(failure,'message')??failure):String(failure));}if(reply&&Object.hasOwn(reply,'ok'))return reply.ok;throw new TypeError(reply?.fail?.message??'The workspace host returned an invalid reply.');}});
  worker.dispatch=async(method,args)=>{try{const action=Reflect.get(runtime,method);if(typeof action!=='function')throw new TypeError('Unknown workspace worker operation.');const result=await Reflect.apply(action,runtime,args),buffers=transferBuffers(result);return buffers.length?new promiseWorker.Meta(result,{transfers:buffers}):result;}catch(error){throw new TypeError(error instanceof Error?error.message:String(error));}};
  worker.postMessage=(...args)=>scope.postMessage(...args);worker.close=()=>scope.close();scope.onmessage=event=>worker.handleMessage(event);
}
