import {createHash} from 'node:crypto';
import {lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {build} from 'esbuild';

const repository=fileURLToPath(new URL('..',import.meta.url));
const required=['LICENSE','README.md','CHANGELOG.md','MIGRATION.md','VALIDATION.md','.gitignore','package.json','tsconfig.json'];
const directories=['addon','src','tests','scripts','docs'];
const compare=(a,b)=>Buffer.compare(Buffer.from(a.name),Buffer.from(b.name));
const excluded=name=>['node_modules','build','dist','.git'].includes(name)||name.startsWith('.test-profile')||name.startsWith('.env');
const crcTable=Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const safeName=name=>typeof name==='string'&&name.length>0&&!name.includes('\\')&&!name.startsWith('/')&&!/^[a-z]:/i.test(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');

/** Fixed DOS epoch, UTF-8 names and sorted entries make identical inputs reproducible. */
export function makeZip(input){
  const entries=[...input].sort(compare),local=[],central=[],names=new Set();let offset=0;
  assert(entries.length<=0xffff,'ZIP64 source archives are not supported.');
  for(const entry of entries){
    assert(safeName(entry.name)&&!names.has(entry.name),'An archive entry has an unsafe or duplicate name.');names.add(entry.name);
    const name=Buffer.from(entry.name),data=Buffer.from(entry.data),compressed=deflateRawSync(data,{level:9}),crc=crc32(data);
    assert(name.length<=0xffff&&data.length<=0xffffffff&&offset<=0xffffffff,'ZIP64 source archives are not supported.');
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);local.push(header,name,compressed);
    const item=Buffer.alloc(46);item.writeUInt32LE(0x02014b50);item.writeUInt16LE(20,4);item.writeUInt16LE(20,6);item.writeUInt16LE(0x800,8);item.writeUInt16LE(8,10);item.writeUInt16LE(33,14);item.writeUInt32LE(crc,16);item.writeUInt32LE(compressed.length,20);item.writeUInt32LE(data.length,24);item.writeUInt16LE(name.length,28);item.writeUInt32LE(offset,42);central.push(item,name);offset+=header.length+name.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);assert(offset+directory.length<=0xffffffff,'ZIP64 source archives are not supported.');end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}

/** Read central-directory sizes and verify every decoded entry's CRC and identity. */
export function readZip(archive){
  const bytes=Buffer.from(archive);let end=-1;
  for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)if(bytes.readUInt32LE(offset)===0x06054b50&&offset+22+bytes.readUInt16LE(offset+20)===bytes.length){end=offset;break;}
  assert(end>=0,'The archive has no complete ZIP directory.');
  const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16),entries=new Map();
  assert(!bytes.readUInt16LE(end+4)&&!bytes.readUInt16LE(end+6)&&bytes.readUInt16LE(end+8)===count&&start+size===end,'The archive has an unsupported ZIP layout.');
  let offset=start;
  for(let index=0;index<count;index++){
    assert(offset+46<=end&&bytes.readUInt32LE(offset)===0x02014b50,'A ZIP directory entry is incomplete.');
    const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),crc=bytes.readUInt32LE(offset+16),compressedSize=bytes.readUInt32LE(offset+20),rawSize=bytes.readUInt32LE(offset+24),nameSize=bytes.readUInt16LE(offset+28),extraSize=bytes.readUInt16LE(offset+30),commentSize=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42),name=bytes.toString('utf8',offset+46,offset+46+nameSize);
    assert(offset+46+nameSize+extraSize+commentSize<=end&&!(flags&1)&&[0,8].includes(method)&&safeName(name)&&!entries.has(name),'A ZIP entry is encrypted, unsafe, duplicated or unsupported.');
    assert(local+30<=start&&bytes.readUInt32LE(local)===0x04034b50&&bytes.readUInt16LE(local+8)===method,'A ZIP local entry is incomplete.');
    const localNameSize=bytes.readUInt16LE(local+26),body=local+30+localNameSize+bytes.readUInt16LE(local+28);
    assert(bytes.toString('utf8',local+30,local+30+localNameSize)===name&&body+compressedSize<=start,'A ZIP entry has inconsistent names or bounds.');
    const compressed=bytes.subarray(body,body+compressedSize),data=method===8?inflateRawSync(compressed,{maxOutputLength:rawSize+1}):Buffer.from(compressed);
    assert(data.length===rawSize&&crc32(data)===crc,`The archive entry failed integrity validation: ${name}`);entries.set(name,data);offset+=46+nameSize+extraSize+commentSize;
  }
  assert(offset===end,'The ZIP directory length does not match its entries.');return entries;
}

async function walk(root,directory,entries){
  const stat=await lstat(path.join(root,directory));assert(stat.isDirectory()&&!stat.isSymbolicLink(),`Source archives require a real directory: ${directory}`);
  for(const item of await readdir(path.join(root,directory),{withFileTypes:true})){
    if(excluded(item.name))continue;
    assert(!item.isSymbolicLink(),`Source archives cannot follow symbolic links: ${directory}/${item.name}`);
    const name=path.posix.join(directory,item.name);if(item.isDirectory())await walk(root,name,entries);else if(item.isFile())entries.push({name,data:await readFile(path.join(root,name))});
  }
}
export async function sourceEntries(root=repository){
  const entries=[];for(const name of required){const stat=await lstat(path.join(root,name));assert(stat.isFile()&&!stat.isSymbolicLink(),`Source archives require a real file: ${name}`);entries.push({name,data:await readFile(path.join(root,name))});}
  for(const item of await readdir(root,{withFileTypes:true}))if(item.isFile()&&(item.name==='DESIGN.md'||/^package.*\.json$/.test(item.name)&&item.name!=='package.json'))entries.push({name:item.name,data:await readFile(path.join(root,item.name))});
  for(const name of directories)await walk(root,name,entries);return entries.sort(compare);
}
function equalEntries(actual,expected,label){
  assert(actual.size===expected.length,`${label} contains an unexpected number of files.`);
  for(const entry of expected)assert(actual.get(entry.name)?.equals(Buffer.from(entry.data)),`${label} differs from its source: ${entry.name}`);
}
async function productionEntries(root,manifest){
  const entries=[];await walk(root,'addon',entries);
  for(const entry of entries){entry.name=entry.name.slice('addon/'.length);if(entry.name==='content/manager.xhtml')entry.data=Buffer.from(entry.data.toString('utf8').replace(/(content\/manager(?:\.css|-loader\.js))"/g,`$1?v=${encodeURIComponent(manifest.version)}"`));}
  entries.push({name:'LICENSE',data:await readFile(path.join(root,'LICENSE'))});
  for(const [entry,name,globalName] of [['src/main.ts','smart-tags.js','SmartTags'],['src/workspace/worker-entry.ts','workspace-worker.js'],['src/workspace/query-entry.ts','workspace-query-worker.js']]){
    const result=await build({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,outfile:path.join(root,'build/addon/content',name),format:'iife',...(globalName?{globalName}:{}),target:'firefox140',platform:'browser',sourcemap:'external',legalComments:'none'});
    for(const file of result.outputFiles)entries.push({name:'content/'+path.basename(file.path),data:file.contents});
  }
  return entries;
}
export async function validateInstaller(root=repository){
  const manifest=JSON.parse(await readFile(path.join(root,'addon/manifest.json'),'utf8')),packageJSON=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')),version=manifest.version;
  assert(typeof version==='string'&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version),'The release manifest needs a safe version.');assert(packageJSON.version===version,'Package and installer manifest versions differ.');
  const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));assert(lock.version===version&&lock.packages?.['']?.version===version,'The package lock version differs from the release manifest.');
  const installerName=`smart-tags-${version}.xpi`,installer=await readFile(path.join(root,'dist',installerName)),actual=readZip(installer),expected=await productionEntries(root,manifest);
  assert(expected.length===14&&actual.size===14,'The production installer must contain exactly 14 source assets and bundles.');equalEntries(actual,expected,'Installer');
  const packagedManifest=JSON.parse(actual.get('manifest.json').toString('utf8'));assert(packagedManifest.version===version,'The packaged manifest has a stale release version.');
  const updates=JSON.parse(await readFile(path.join(root,'updates.json'),'utf8')),application=manifest.applications.zotero,matching=updates.addons?.[application.id]?.updates?.filter(update=>update.version===version);
  assert(matching?.length===1,'The update manifest must identify this release exactly once.');const update=matching[0],hash=createHash('sha256').update(installer).digest('hex');
  assert(update.update_link===`https://raw.githubusercontent.com/leviyuli/ZTagging/main/dist/${installerName}`,'The release update link points to another installer.');assert(update.update_hash===`sha256:${hash}`,'The release update hash does not match the installer.');
  assert(update.applications?.zotero?.strict_min_version===application.strict_min_version&&update.applications?.zotero?.strict_max_version===application.strict_max_version,'Installer and update compatibility bounds differ.');
  return {version,installer:installerName,installerFiles:actual.size,installerBytes:installer.length,installerSHA256:hash};
}
export async function packageSource(root=repository){
  const validated=await validateInstaller(root),entries=await sourceEntries(root),archive=makeZip(entries);equalEntries(readZip(archive),entries,'Source archive');
  // Fail before publishing if source files changed while the archive was assembled.
  equalEntries(readZip(archive),await sourceEntries(root),'Source archive');
  const name=`smart-tags-${validated.version}-source.zip`;await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'dist',name),archive);
  equalEntries(readZip(await readFile(path.join(root,'dist',name))),entries,'Written source archive');
  return {...validated,sourceArchive:name,sourceFiles:entries.length,sourceBytes:archive.length,sourceSHA256:createHash('sha256').update(archive).digest('hex')};
}
export async function checkPackage(root=repository){
  const validated=await validateInstaller(root),name=`smart-tags-${validated.version}-source.zip`;let archive;
  try{archive=await readFile(path.join(root,'dist',name));}catch(error){if(error.code==='ENOENT')return {...validated,sourceArchive:null};throw error;}
  const entries=await sourceEntries(root);equalEntries(readZip(archive),entries,'Source archive');return {...validated,sourceArchive:name,sourceFiles:entries.length,sourceBytes:archive.length,sourceSHA256:createHash('sha256').update(archive).digest('hex')};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const check=process.argv.includes('--check');assert(process.argv.slice(2).every(argument=>argument==='--check'),'Usage: node scripts/package-source.mjs [--check]');
  console.log(JSON.stringify(check?await checkPackage():await packageSource(),null,2));
}
