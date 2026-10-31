import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = path.join(root, 'build', 'addon');
if (!out.startsWith(root + path.sep) || path.relative(root,out) !== path.join('build','addon')) throw new Error('Refusing to clean an unexpected build path.');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, 'addon'), out, { recursive: true });
const manifest=JSON.parse(await readFile(path.join(out,'manifest.json'),'utf8'));
const managerPath=path.join(out,'content/manager.xhtml');
const managerMarkup=(await readFile(managerPath,'utf8')).replace(/(content\/manager(?:\.css|-loader\.js))"/g,`$1?v=${encodeURIComponent(manifest.version)}"`);
await writeFile(managerPath,managerMarkup);
await build({ entryPoints: ['src/main.ts'], bundle: true, outfile: path.join(out, 'content/smart-tags.js'), format: 'iife', globalName: 'SmartTags', target: 'firefox140', platform: 'browser', sourcemap: 'external', legalComments: 'none' });
await cp('LICENSE', path.join(out, 'LICENSE'));
const entries = [];
async function walk(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else entries.push({ name: path.relative(out, full).replaceAll('\\', '/'), data: await readFile(full) });
  }
}
await walk(out);
const crcTable = Array.from({ length:256 }, (_, n) => { for(let k=0;k<8;k++) n = n&1 ? 0xedb88320^(n>>>1) : n>>>1; return n>>>0; });
function crc32(bytes) { let c=0xffffffff; for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0; }
const local=[], central=[]; let offset=0;
for(const entry of entries) {
  const name=Buffer.from(entry.name), compressed=deflateRawSync(entry.data), crc=crc32(entry.data);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(entry.data.length,22);h.writeUInt16LE(name.length,26);
  local.push(h,name,compressed);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(entry.data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);offset+=h.length+name.length+compressed.length;
}
const directory=Buffer.concat(central), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
await mkdir('dist',{recursive:true});
const artifact=`dist/smart-tags-${manifest.version}.xpi`;
const archive=Buffer.concat([...local,directory,end]);
await writeFile(artifact,archive);
await writeFile(path.join(root,'updates.json'),JSON.stringify({addons:{[manifest.applications.zotero.id]:{updates:[{
  version:manifest.version,
  update_link:`https://raw.githubusercontent.com/leviyuli/ZTagging/main/${artifact}`,
  update_hash:`sha256:${createHash('sha256').update(archive).digest('hex')}`,
  applications:{zotero:{strict_min_version:manifest.applications.zotero.strict_min_version,strict_max_version:manifest.applications.zotero.strict_max_version}}
}]}}},null,2)+'\n');
console.log(`Built ${artifact} (${entries.length} files)`);
