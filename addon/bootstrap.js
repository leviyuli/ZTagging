var smartTagsScope;
var chromeHandle;

async function startup({ id, version, rootURI }) {
  Components.utils.importGlobalProperties(['fetch', 'crypto', 'TextEncoder', 'TextDecoder', 'AbortController', 'URL', 'URLSearchParams', 'btoa', 'atob']);
  const timers = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
  const aom = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
  chromeHandle = aom.registerChrome(Services.io.newURI(rootURI + "manifest.json"), [
    ["content", "smart-tags", "content/"]
  ]);
  smartTagsScope = { Zotero, Services, Cc, Ci, ChromeUtils, IOUtils, PathUtils, fetch, crypto, TextEncoder, TextDecoder, AbortController, URL, URLSearchParams, btoa, atob, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout };
  Services.scriptloader.loadSubScript(rootURI + "content/smart-tags.js", smartTagsScope);
  await smartTagsScope.SmartTags.startup({ id, version, rootURI });
}

async function shutdown(_data, reason) {
  if (smartTagsScope) await smartTagsScope.SmartTags.shutdown();
  smartTagsScope = null;
  if (chromeHandle) chromeHandle.destruct();
  chromeHandle = null;
}

function onMainWindowLoad({ window }) {
  smartTagsScope?.SmartTags.onMainWindowLoad(window);
}
function onMainWindowUnload({ window }) {
  smartTagsScope?.SmartTags.onMainWindowUnload(window);
}
function install() {}
function uninstall() {}
