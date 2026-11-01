/** Prepare an isolated native Zotero test. This never changes dist/ or the normal profile. */
import { cp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(process.cwd());
const automaticWorkflow = process.argv.includes('--automatic-workflow');
const builtAddon = process.argv.includes('--built-addon');
const theme = process.argv.includes('--dark-theme') ? 'dark' : process.argv.includes('--light-theme') ? 'light' : 'system';
const source = path.join(root, automaticWorkflow && !builtAddon ? 'addon' : 'build/addon');
const nativeAddon = path.join(root, 'build', automaticWorkflow ? 'native-automatic-addon' : 'native-addon');
const profile = path.join(root, automaticWorkflow ? '.test-profile-native-automatic' : process.argv.includes('--fresh-profile') ? '.test-profile-native-fresh' : '.test-profile-native');
const data = path.join(root, 'build', automaticWorkflow ? 'native-automatic-data' : 'native-data');
const reportPath = path.join(root, 'build', automaticWorkflow ? `native-automatic-${theme}-report.json` : 'native-smoke-report.json');
const marker = path.join(profile, '.smart-tags-smoke-profile.json');
const exists = async target => { try { await access(target); return true; } catch { return false; } };
for (const target of [nativeAddon, profile, data, reportPath]) {
  if (!target.startsWith(root + path.sep)) throw new Error('Native test path escaped the workspace.');
}
await access(path.join(source, 'manifest.json'));
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
if (manifest.applications?.zotero?.id !== 'smart-tags@zotero-local.org') throw new Error('Unexpected plugin ID.');
if (builtAddon && manifest.version !== JSON.parse(await readFile(path.join(root,'addon','manifest.json'),'utf8')).version) throw new Error('The production addon build is stale. Build the current version before testing it.');
if (await exists(profile)) {
  if (!process.argv.includes('--reuse-profile')) throw new Error('Native smoke profile already exists. Stop its Zotero process, then explicitly pass --reuse-profile.');
  const saved = JSON.parse(await readFile(marker, 'utf8'));
  if (saved.root !== root || saved.data !== data) throw new Error('Refusing to reuse an unrecognized test profile.');
} else {
  await mkdir(profile, { recursive: true });
  await writeFile(marker, JSON.stringify({ root, data }, null, 2));
}
await mkdir(data, { recursive: true });
await mkdir(path.join(profile, 'extensions'), { recursive: true });
if (builtAddon) await rm(nativeAddon, { recursive: true, force: true });
await cp(source, nativeAddon, { recursive: true });
if (automaticWorkflow && !builtAddon) await build({ entryPoints: [path.join(root, 'src', 'main.ts')], outfile: path.join(nativeAddon, 'content', 'smart-tags.js'), bundle: true, format: 'iife', globalName: 'SmartTags', platform: 'browser', target: 'firefox140', legalComments: 'none' });
await build({ entryPoints: [path.join(root, 'scripts', 'native-smoke.js')], outfile: path.join(nativeAddon, 'content', 'native-smoke.js'), bundle: true, format: 'iife', platform: 'browser', target: 'firefox140', legalComments: 'none' });
const configuration = { root, data, profile, reportPath, port: automaticWorkflow ? 23159 : 23149, openManager: process.argv.includes('--open-manager'), theme, ...(automaticWorkflow ? { scenario: 'automatic-workflow' } : {}), ...(builtAddon ? { addonSource: 'production-build', addonVersion: manifest.version } : {}), ...(process.argv.includes('--secondary-baseline') ? { secondaryBaseline: true } : {}), ...(process.argv.includes('--secondary-workflow') ? { secondaryWorkflow: true } : {}) };
if (process.argv.includes('--meaning-recovery')) configuration.meaningRecovery = true;
if (process.argv.includes('--preview-xpi')) Object.assign(configuration,{ previewXpi: path.join(root,'build','smart-tags-1.0.1-preview.xpi'), previewVersion: '1.0.1pre' });
const bootstrapPath = path.join(nativeAddon, 'bootstrap.js');
const bootstrap = await readFile(bootstrapPath, 'utf8');
const needle = 'await smartTagsScope.SmartTags.startup({ id, version, rootURI });';
if (!bootstrap.includes(needle)) throw new Error('Cannot locate the extension startup hook.');
const injected = `${needle}\n  smartTagsScope.__SMART_TAGS_SMOKE_CONFIG = ${JSON.stringify(configuration)};\n  Services.scriptloader.loadSubScript(rootURI + 'content/native-smoke.js', smartTagsScope);`;
await writeFile(bootstrapPath, bootstrap.replace(needle, injected));
// The final upgrade check leaves a packaged installation in this isolated profile.
await rm(path.join(profile, 'extensions', manifest.applications.zotero.id + '.xpi'), { force: true });
await writeFile(path.join(profile, 'extensions', manifest.applications.zotero.id), nativeAddon, 'utf8');
const preferences = {
  'extensions.zotero.useDataDir': true,
  'extensions.zotero.dataDir': data,
  'extensions.zotero.warnOnUnsafeDataDir': false,
  'extensions.zotero.httpServer.enabled': true,
  'extensions.zotero.httpServer.port': configuration.port,
  'extensions.zotero.httpServer.localAPI.enabled': false,
  'extensions.zotero.sync.autoSync': false,
  'extensions.zotero.firstRun2': false,
  'extensions.autoDisableScopes': 0,
  'extensions.enabledScopes': 15,
  'extensions.startupScanScopes': 15,
  'extensions.lastAppBuildId': '',
  'extensions.lastAppVersion': '',
  'extensions.zotero.automaticScraperUpdates': false,
  'layers.acceleration.disabled': true,
  'gfx.webrender.software': true,
  'gfx.webrender.all': false,
  'gfx.webrender.force-disabled': true,
  'browser.shell.checkDefaultBrowser': false,
  'extensions.zoteroWinWordIntegration.skipInstallation': true,
  'extensions.zoteroOpenOfficeIntegration.skipInstallation': true,
};
if (configuration.theme === 'light') {
  preferences['browser.theme.toolbar-theme'] = 1;
  preferences['ui.systemUsesDarkTheme'] = 0;
}
if (configuration.theme === 'dark') {
  preferences['browser.theme.toolbar-theme'] = 0;
  preferences['ui.systemUsesDarkTheme'] = 1;
}
await writeFile(path.join(profile, 'user.js'), Object.entries(preferences).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n') + '\n');
await writeFile(reportPath, JSON.stringify({ status: 'prepared', configuration, note: 'Launch the isolated Zotero instance. No library or account has been accessed by this preparation script.' }, null, 2));
console.log(JSON.stringify({ prepared: true, configuration, executable: 'C:\\Program Files\\Zotero\\zotero.exe', arguments: ['-no-remote', '-profile', profile, '-datadir', data, '-purgecaches', '-ZoteroDebugText'], next: 'Launch with an isolated process outside the process sandbox. Inspect the manager manually; the hook leaves Zotero running.' }, null, 2));
