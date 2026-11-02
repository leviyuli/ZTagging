var smartTagsScope;
var chromeHandle;
var lifecycleTail = Promise.resolve();
var hostCleanupPending;

function sequenceLifecycle(action) {
  const result = lifecycleTail.catch(() => {}).then(action);
  lifecycleTail = result;
  return result;
}

function hostShutdownFence(id) {
  return new Promise(resolve => {
    if (id && Zotero.Plugins?.addObserver && Zotero.Plugins?.removeObserver) {
      const observer = { shutdown(params) {
        if (params.id !== id) return;
        try { Zotero.Plugins.removeObserver(observer); }
        finally { resolve(); }
      } };
      try { Zotero.Plugins.addObserver(observer); return; }
      catch { /* Direct test adapters can fall back to the next event turn. */ }
    }
    const timers = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
    timers.setTimeout(resolve, 0);
  });
}

function startup({ id, version, rootURI }) {
  return sequenceLifecycle(async () => {
    const timers = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
    // Zotero removes plugin controls after shutdown returns, then clears locales.
    if (hostCleanupPending) {
      await hostCleanupPending;
      hostCleanupPending = null;
      await new Promise(resolve => timers.setTimeout(resolve, 0));
    }
    Components.utils.importGlobalProperties(['fetch', 'crypto', 'TextEncoder', 'TextDecoder', 'AbortController', 'URL', 'URLSearchParams', 'btoa', 'atob']);
    const aom = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
    chromeHandle = aom.registerChrome(Services.io.newURI(rootURI + "manifest.json"), [
      ["content", "smart-tags", "content/"]
    ]);
    smartTagsScope = { Zotero, Services, Cc, Ci, ChromeUtils, IOUtils, PathUtils, fetch, crypto, TextEncoder, TextDecoder, AbortController, URL, URLSearchParams, btoa, atob, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout };
    Services.scriptloader.loadSubScript(rootURI + "content/smart-tags.js", smartTagsScope);
    await smartTagsScope.SmartTags.startup({ id, version, rootURI });
  });
}

function shutdown(data, reason) {
  return sequenceLifecycle(async () => {
    const previousScope = smartTagsScope, previousChrome = chromeHandle;
    smartTagsScope = null;
    chromeHandle = null;
    try { if (previousScope) await previousScope.SmartTags.shutdown(); }
    finally {
      try { if (previousChrome) previousChrome.destruct(); }
      finally { if (previousScope || previousChrome) hostCleanupPending = hostShutdownFence(data?.id); }
    }
  });
}

function onMainWindowLoad({ window }) {
  smartTagsScope?.SmartTags.onMainWindowLoad(window);
}
function onMainWindowUnload({ window }) {
  smartTagsScope?.SmartTags.onMainWindowUnload(window);
}
function install() {}
function uninstall() {}
