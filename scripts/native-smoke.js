/** TEST ONLY. Bundled exclusively into build/native-addon by prepare-native-smoke.mjs. */
import { registerOAuthCallback } from '../src/platform.ts';
import { ProviderClient } from '../src/providers.ts';
import { runNativeV020 } from './native-v020.js';
import { runNativeV030 } from './native-v030.js';
import { runNativeV031 } from './native-v031.js';

void (async () => {
  const config = typeof __SMART_TAGS_SMOKE_CONFIG === 'object' ? __SMART_TAGS_SMOKE_CONFIG : null;
  if (!config) throw new Error('Native smoke configuration is missing.');
  const report = { status: 'running', startedAt: new Date().toISOString(), configuration: config, checks: {}, errors: [] };
  const scrub = value => String(value).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]').replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 6000);
  const write = () => IOUtils.writeUTF8(config.reportPath, JSON.stringify(report, null, 2), { tmpPath: config.reportPath + '.tmp' });
  const check = (name, condition, detail) => { report.checks[name] = { passed: !!condition, ...(detail === undefined ? {} : { detail }) }; if (!condition) throw new Error('Native smoke failed: ' + name); };
  const normalized = value => String(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const until = async (predicate, label) => {
    const start = Date.now();
    while (Date.now() - start < 25_000) { const value = predicate();if (value) return value;await new Promise(resolve => setTimeout(resolve, 35)); }
    throw new Error('Native startup timeout: ' + label);
  };
  try {
    await write();
    if (Zotero.initializationPromise) await Zotero.initializationPromise;
    if (Zotero.uiReadyPromise) await Zotero.uiReadyPromise;
    await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
    // All native item/search writes below are gated on this exact isolated data directory.
    check('isolatedDataDirectory', normalized(Zotero.DataDirectory.dir) === normalized(config.data), Zotero.DataDirectory.dir);
    check('isolatedProfile', normalized(Services.dirsvc.get('ProfD', Ci.nsIFile).path) === normalized(config.profile));
    check('extensionStartup', !!Zotero.SmartTags?.controller, Zotero.SmartTags?.version);
    check('menuAPI', typeof Zotero.MenuManager?.registerMenu === 'function');
    check('sourceGlobals', typeof fetch === 'function' && !!crypto?.subtle && typeof TextEncoder === 'function' && typeof TextDecoder === 'function' && typeof AbortController === 'function' && typeof setTimeout === 'function');
    const app = Zotero.SmartTags.controller;
    check('automaticAssignmentInitiallyOff', app.state.settings.autoAssign === false);
    const snapshot = await app.snapshot();
    check('managerSnapshot', Array.isArray(snapshot.tags) && Array.isArray(snapshot.papers) && !!snapshot.connection);
    const startupWindow = Zotero.getMainWindow();
    await until(() => startupWindow?.ZoteroPane?.itemsView && startupWindow.ZoteroPane.collectionsView, 'main window trees');
    await startupWindow.ZoteroPane.collectionsView.waitForLoad();
    await startupWindow.ZoteroPane.itemsView.waitForLoad();
    const startupNavigator = await until(() => Zotero.SmartTags.getNavigator(startupWindow), 'main navigator');
    await startupNavigator.refresh();
    await startupWindow.ZoteroPane.itemsView.waitForLoad();
    // Check the natural approved-taxonomy startup before any fixture writes can
    // race a native search across a newly constructed, partially saved item.
    if (snapshot.taxonomyReady) check('v020ApprovedStartupDefaultsToTags', startupNavigator.mode === 'tags'
      && startupWindow.ZoteroPane.itemsView.collectionTreeRows.some(row => row.id.startsWith('smart-tags-view-')));
    await startupNavigator.setMode('collections');
    check('fixtureSetupUsesCollections', startupNavigator.mode === 'collections');
    // Exercise the DeepSeek adapter in Gecko with synthetic credentials and HTTP replies.
    // This transport never makes an external request or persists a credential.
    const testCredentials = new Map();
    const testMetadata = new Map();
    const deepseekRequests = [];
    const NativeResponse = Zotero.getMainWindow().Response;
    let deepseekQuota = false;
    let deepseekAuthCorrect = true;
    let deepseekBodyCorrect = false;
    const deepseek = new ProviderClient({
      crypto,
      credentials: { load: async key => testCredentials.get(key) ?? null, save: async (key, value) => { testCredentials.set(key, value); }, remove: async key => { testCredentials.delete(key); } },
      metadata: { get: async key => testMetadata.get(key) ?? null, set: async (key, value) => { testMetadata.set(key, value); } },
      openExternal: () => { throw new Error('Synthetic DeepSeek test must not open a browser.'); },
      registerCallback: async () => { throw new Error('Synthetic DeepSeek test must not open OAuth.'); },
      fetch: async (url, init = {}) => {
        const target = String(url);
        deepseekRequests.push(target);
        deepseekAuthCorrect = deepseekAuthCorrect && init.headers.Authorization === 'Bearer native-deepseek-synthetic';
        if (target === 'https://api.deepseek.com/models') return new NativeResponse(JSON.stringify({ object: 'list', data: [{ id: 'native-deepseek-test', object: 'model', owned_by: 'deepseek' }] }), { headers: { 'Content-Type': 'application/json' } });
        if (target !== 'https://api.deepseek.com/chat/completions') throw new Error('Synthetic DeepSeek test received an unexpected endpoint.');
        const body = JSON.parse(init.body);
        deepseekBodyCorrect = body.response_format?.type === 'json_object' && body.thinking?.type === 'disabled' && body.stream === false && body.model === 'native-deepseek-test';
        if (deepseekQuota) return new NativeResponse(JSON.stringify({ error: { message: 'Synthetic insufficient balance', code: 'insufficient_balance' } }), { status: 402, headers: { 'Content-Type': 'application/json' } });
        return new NativeResponse(JSON.stringify({ object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { headers: { 'Content-Type': 'application/json' } });
      },
    });
    try {
      await deepseek.setApiKey('native-openai-synthetic');
      await deepseek.setApiKey('native-deepseek-synthetic', 'deepseek');
      await deepseek.removeApiKey('api');
      check('deepseekCredentialIsolation', await deepseek.hasApiKey('deepseek') && !await deepseek.hasApiKey('api'));
      const discovered = await deepseek.listModels('deepseek');
      check('deepseekModelDiscovery', discovered.length === 1 && discovered[0].id === 'native-deepseek-test');
      const deepseekSettings = { mode: 'deepseek', model: 'native-deepseek-test', maxOutputTokens: 512, inputCostPerMillion: 1, outputCostPerMillion: 4 };
      const completed = await deepseek.completeJson('Return JSON {"ok":true}.', 'Synthetic connection test.', deepseekSettings);
      check('deepseekJSONResult', completed.value?.ok === true && deepseekBodyCorrect);
      check('deepseekUsageCost', completed.usageKnown && completed.usage.inputTokens === 10 && completed.usage.outputTokens === 5 && Math.abs(completed.estimatedCostUSD - 0.00003) < 1e-12);
      deepseekQuota = true;
      let quotaPaused = false;
      try { await deepseek.completeJson('Return JSON {"ok":true}.', 'Synthetic quota test.', deepseekSettings); } catch (error) { quotaPaused = error.category === 'quota' && error.status === 402; }
      check('deepseekQuotaClassification', quotaPaused);
      check('deepseekNoProviderFallback', deepseekAuthCorrect && deepseekRequests.length === 3 && deepseekRequests.every(url => url.startsWith('https://api.deepseek.com/')));
    } finally { await deepseek.dispose(); }
    const abstracts = [
      'We measure catalyst-layer resistance in PEM water electrolysis and separate protonic transport losses within the catalyst layer.',
      'This unrelated mechanical study measures the resistance of a battery casing to external pressure.'
    ];
    const items = [];
    for (let i = 0; i < 2; i++) {
      const item = new Zotero.Item('journalArticle');
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField('title', i === 0 ? 'Smart Tags smoke: catalyst-layer resistance in PEM electrolysis' : 'Smart Tags smoke: mechanical resistance of battery casings');
      item.setField('abstractNote', abstracts[i]);
      item.setField('publicationTitle', 'Synthetic Smart Tags Test Journal');
      item.addTag('Existing manual choice', 0);
      if (i === 0) item.addTag('electrolyzer transport', 1);
      await item.saveTx();
      items.push(item);
    }
    await app.invoke('scan', { scope: 'library' });
    const paperId = `${items[0].libraryID}:${items[0].key}`;
    const unrelatedId = `${items[1].libraryID}:${items[1].key}`;
    check('hostScan', !!app.state.papers[paperId] && !!app.state.papers[unrelatedId], { syntheticPaperCount: items.length, scannedCount: Object.keys(app.state.papers).length });
    const definition = app.state.tags.find(tag => tag.name === 'RCL');
    check('rclDefinitionPresent', !!definition);
    if (definition.status !== 'approved') await app.invoke('approve-vocabulary', { ids: [definition.id] });
    const suggestion = {
      id: 'native-smoke-rcl-' + Date.now(), paperId, tagId: definition.id,
      reason: 'Synthetic smoke fixture has direct abstract evidence about catalyst-layer resistance.',
      confidence: 'high', status: 'pending', evidence: [{ text: 'We measure catalyst-layer resistance in PEM water electrolysis', source: 'abstract' }],
      inputFingerprint: app.state.papers[paperId].fingerprint, vocabularyVersion: app.state.vocabularyVersion,
      match: 'substantive', autoEligible: false,
    };
    app.state.suggestions.push(suggestion);
    await app.save();
    await app.invoke('accept-suggestion', { id: suggestion.id });
    await app.invoke('apply-suggestions', { ids: [suggestion.id] });
    check('nativeTagApplied', items[0].getTags().some(tag => tag.tag === 'RCL'));
    check('manualTagPreserved', items[0].getTags().some(tag => tag.tag === 'Existing manual choice'));
    check('unrelatedPaperUntouched', !items[1].getTags().some(tag => tag.tag === 'RCL'));
    check('ownedAssignmentRecorded', app.state.ownership[paperId]?.[definition.id]?.name === 'RCL');
    const history = app.state.history.find(record => record.suggestionIds.includes(suggestion.id));
    check('historyRecorded', !!history);
    await app.invoke('undo', { id: history.id });
    check('nativeUndo', !items[0].getTags().some(tag => tag.tag === 'RCL') && items[0].getTags().some(tag => tag.tag === 'Existing manual choice'));
    await app.invoke('save-search', { name: 'Smart Tags native smoke — RCL', tagIds: [definition.id] });
    const searches = await Zotero.Searches.getAll(Zotero.Libraries.userLibraryID);
    check('savedSearch', searches.some(search => search.name === 'Smart Tags native smoke — RCL'));
    let callback;
    let callbackSeen = false;
    try {
      callback = await registerOAuthCallback('/smart-tags/native-smoke/callback', async query => {
        callbackSeen = query.state === 'synthetic-smoke-state';
        return { status: 200, body: 'Smart Tags native callback works.' };
      });
      check('isolatedServerPort', callback.port === config.port, callback.port);
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 10_000);
      try {
        const response = await fetch(`http://127.0.0.1:${callback.port}/smart-tags/native-smoke/callback?state=synthetic-smoke-state`, { headers: { 'Zotero-Allowed-Request': '1' }, signal: abort.signal, credentials: 'omit', redirect: 'error' });
        check('nativeOAuthCallback', response.status === 200 && (await response.text()) === 'Smart Tags native callback works.' && callbackSeen);
        check('callbackNoStoreHeader', response.headers.get('Cache-Control') === 'no-store');
      } finally { clearTimeout(timeout); }
    } finally { callback?.dispose(); }
    check('callbackDisposed', !Zotero.Server.Endpoints['/smart-tags/native-smoke/callback']);
    report.v020=await runNativeV020(app,check,config);
    report.v030=await runNativeV030(app,check,config);
    report.v031=await runNativeV031(app,check,config);
    report.syntheticItemIDs = items.map(item => item.id);
    if (config.openManager) await Zotero.SmartTags.openManager();
    report.status = 'passed';
    report.completedAt = new Date().toISOString();
    report.note = 'No real AI request or authentication was performed. Leave this isolated app running for manual manager inspection.';
  } catch (error) {
    report.status = 'failed'; report.completedAt = new Date().toISOString();
    report.errors.push({ message: scrub(error?.message ?? error), stack: scrub(error?.stack ?? '') });
    try { Zotero.logError(error); } catch { /* Preserve report even if logging is unavailable. */ }
  } finally { await write(); }
})();
