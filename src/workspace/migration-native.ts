import type {MigrationIO} from './migration-contract.ts';

/** IOUtils performs disk work on Mozilla's I/O thread and is exposed in ChromeWorker. */
export const nativeMigrationIO:MigrationIO={
  read(path,{offset,maxBytes}){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024)throw new Error('Migration reads require a bounded byte range.');
    return IOUtils.read(path,{offset,maxBytes});
  },
  exists:path=>IOUtils.exists(path),
  async stat(path){const info=await IOUtils.stat(path);if(info.type!=='regular'||!Number.isSafeInteger(info.size)||info.size<0)throw new Error('The workspace entry point must be a regular file.');return {size:info.size,lastModified:info.lastModified};},
  copyExact:(source,destination)=>IOUtils.copy(source,destination,{noOverwrite:true,recursive:false}),
  async writeAtomic(path,bytes){
    if(bytes.length>16*1024)throw new Error('The workspace entry point must remain a small locator.');
    const tmpPath=path+'.workspace-'+crypto.randomUUID()+'.tmp';
    try{await IOUtils.write(path,bytes,{tmpPath,flush:true});}
    finally{await IOUtils.remove(tmpPath,{ignoreAbsent:true,recursive:false}).catch(()=>{});}
  },
  remove:path=>IOUtils.remove(path,{ignoreAbsent:true,recursive:false}),
};
