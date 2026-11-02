import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {makeZip,readZip,sourceEntries,validateInstaller,packageSource,checkPackage} from '../scripts/package-source.mjs';

async function fixture(t:any){
  const base=path.resolve(fileURLToPath(new URL('../build',import.meta.url)));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'package-source-test-'));
  t.after(async()=>{const resolved=path.resolve(root);assert.ok(resolved.startsWith(base+path.sep)&&path.basename(resolved).startsWith('package-source-test-'));await rm(resolved,{recursive:true,force:true});});
  const write=async(name:string,value:string)=>{await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),value);};
  for(const name of ['LICENSE','README.md','CHANGELOG.md','MIGRATION.md','VALIDATION.md','.gitignore','tsconfig.json','DESIGN.md'])await write(name,'Source '+name+'\n');
  await write('tsconfig.json','{"compilerOptions":{}}');
  await write('package.json',JSON.stringify({version:'1.1.0'}));await write('package-lock.json',JSON.stringify({version:'1.1.0',packages:{'':{version:'1.1.0'}}}));
  const manifest={version:'1.1.0',applications:{zotero:{id:'smart-tags@zotero-local.org',strict_min_version:'10.0.6',strict_max_version:'10.0.*'}}};
  const assets=new Map<string,Buffer>();for(const [name,value] of Object.entries({'bootstrap.js':'function startup() {}','manifest.json':JSON.stringify(manifest),'content/icon.svg':'<svg/>','content/manager-loader.js':'globalThis.loaded=true;','content/manager.css':'body {color:black}','content/manager.xhtml':'<link href="content/manager.css"/><script src="content/manager-loader.js"/>','locale/en-US/smart-tags.ftl':'smart-tags = Tags'})){await write('addon/'+name,value);assets.set(name,Buffer.from(name==='content/manager.xhtml'?value.replace(/(content\/manager(?:\.css|-loader\.js))"/g,'$1?v=1.1.0"'):value));}
  assets.set('LICENSE',await readFile(path.join(root,'LICENSE')));
  for(const [entry,name,globalName] of [['src/main.ts','smart-tags.js','SmartTags'],['src/workspace/worker-entry.ts','workspace-worker.js'],['src/workspace/query-entry.ts','workspace-query-worker.js']]){
    await write(entry,'export const source = '+JSON.stringify(entry)+';');
    const result=await build({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,outfile:path.join(root,'build/addon/content',name),format:'iife',...(globalName?{globalName}:{}),target:'firefox140',platform:'browser',sourcemap:'external',legalComments:'none'});
    for(const file of result.outputFiles)assets.set('content/'+path.basename(file.path),Buffer.from(file.contents));
  }
  await write('scripts/source-tool.mjs','export const source=true;');await write('tests/example.test.ts','// source test');await write('docs/example.md','Source documentation.');
  const save=async(entries=assets)=>{const xpi=makeZip([...entries].map(([name,data])=>({name,data})));await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'dist/smart-tags-1.1.0.xpi'),xpi);await write('updates.json',JSON.stringify({addons:{[manifest.applications.zotero.id]:{updates:[{version:'1.1.0',update_link:'https://raw.githubusercontent.com/leviyuli/ZTagging/main/dist/smart-tags-1.1.0.xpi',update_hash:'sha256:'+createHash('sha256').update(xpi).digest('hex'),applications:{zotero:manifest.applications.zotero}}]}}}));};await save();return {root,write,assets,save};
}

test('source ZIP writing is reproducible and validates names, bytes and corruption',()=>{
  const files=[{name:'src/λ.ts',data:Buffer.from('Unicode source\n')},{name:'LICENSE',data:Buffer.from('License\r\n')},{name:'empty',data:Buffer.alloc(0)}],first=makeZip(files),second=makeZip([...files].reverse());assert.deepEqual(first,second);assert.equal(readZip(first).get('src/λ.ts')!.toString(),'Unicode source\n');assert.throws(()=>makeZip([{name:'../private',data:Buffer.from('no')}]),/unsafe/);assert.throws(()=>makeZip([files[0],files[0]]),/duplicate/);const corrupt=Buffer.from(first);corrupt[30+Buffer.byteLength('LICENSE')]^=0xff;assert.throws(()=>readZip(corrupt));
});

test('source allowlist excludes private, installed and generated files at every depth',async t=>{
  const f=await fixture(t);for(const name of ['.env','.env.example','build/private/state.json','node_modules/secret','dist/old-source.zip','.git/config','.test-profile-workspace-private/prefs.js','src/.env.local','tests/build/private.json','scripts/node_modules/private.js'])await f.write(name,'PRIVATE CONTENT');
  const entries=await sourceEntries(f.root),names=entries.map(entry=>entry.name);assert.ok(names.includes('DESIGN.md'));assert.ok(names.includes('tests/example.test.ts'));assert.ok(names.includes('scripts/source-tool.mjs'));assert.ok(names.includes('package-lock.json'));assert.equal(names.some(name=>name.includes('private')||name.includes('.env')||name.includes('node_modules')||name.startsWith('dist/')),false);
  assert.equal((await checkPackage(f.root)).sourceArchive,null);const result=await packageSource(f.root),zip=readZip(await readFile(path.join(f.root,'dist',result.sourceArchive)));assert.equal(zip.size,entries.length);for(const entry of entries)assert.deepEqual(zip.get(entry.name),entry.data);const again=await packageSource(f.root);assert.equal(again.sourceSHA256,result.sourceSHA256);assert.equal((await checkPackage(f.root)).sourceSHA256,result.sourceSHA256);await f.write('README.md','Updated source after packaging');await assert.rejects(checkPackage(f.root),/differs from its source: README.md/);
});

test('installer checks require exact production assets, fourteen entries and a matching update hash',async t=>{
  const f=await fixture(t),valid=await validateInstaller(f.root);assert.equal(valid.installerFiles,14);
  const extra=new Map(f.assets);extra.set('content/native-workspace.js',Buffer.from('// isolated harness'));await f.save(extra);await assert.rejects(validateInstaller(f.root),/exactly 14/);
  const stale=new Map(f.assets);stale.set('bootstrap.js',Buffer.from('function staleInstaller() {}'));await f.save(stale);await assert.rejects(validateInstaller(f.root),/differs from its source: bootstrap.js/);
  await f.save();const updates=JSON.parse(await readFile(path.join(f.root,'updates.json'),'utf8'));updates.addons['smart-tags@zotero-local.org'].updates[0].update_hash='sha256:wrong';await f.write('updates.json',JSON.stringify(updates));await assert.rejects(validateInstaller(f.root),/update hash/);
});
