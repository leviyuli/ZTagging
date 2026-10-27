/** TEST ONLY. Bundled exclusively into build/native-addon by prepare-native-smoke.mjs. */
import { registerOAuthCallback } from '../src/platform.ts';

void (async () => {
  const config = typeof __SMART_TAGS_SMOKE_CONFIG === 'object' ? __SMART_TAGS_SMOKE_CONFIG : null;
  if (!config) throw new Error('Native smoke configuration is missing.');
  const report = { status: 'running', startedAt: new Date().toISOString(), configuration: config, checks: {}, errors: [] };
  const scrub = value => String(value).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]').replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 6000);
  const write = () => IOUtils.writeUTF8(config.reportPath, JSON.stringify(report, null, 2), { tmpPath: config.reportPath + '.tmp' });
  const check = (name, condition, detail) => { report.checks[name] = { passed: !!condition, ...(detail === undefined ? {} : { detail }) }; if (!condition) throw new Error('Native smoke failed: ' + name); };
  const normalized = value => String(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  try {
    await write();
    if (Zotero.initializationPromise) await Zotero.initializationPromise;
    if (Zotero.uiReadyPromise) await Zotero.uiReadyPromise;
    // All native item/search writes below are gated on this exact isolated data directory.
    check('isolatedDataDirectory', normalized(Zotero.DataDirectory.dir) === normalized(config.data), Zotero.DataDirectory.dir);
    check('isolatedProfile', normalized(Services.dirsvc.get('ProfD', Ci.nsIFile).path) === normalized(config.profile));
    check('extensionStartup', !!Zotero.SmartTags?.controller, Zotero.SmartTags?.version);
    check('menuAPI', typeof Zotero.MenuManager?.registerMenu === 'function');
    check('sectionAPI', typeof Zotero.ItemPaneManager?.registerSection === 'function');
    check('sourceGlobals', typeof fetch === 'function' && !!crypto?.subtle && typeof TextEncoder === 'function' && typeof TextDecoder === 'function' && typeof AbortController === 'function' && typeof setTimeout === 'function');
    const app = Zotero.SmartTags.controller;
    check('automaticAssignmentInitiallyOff', app.state.settings.autoAssign === false);
    const snapshot = await app.snapshot();
    check('managerSnapshot', Array.isArray(snapshot.tags) && Array.isArray(snapshot.papers) && !!snapshot.connection);
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
      if (i === 0) item.addTag('catalyst layer resistance', 1);
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
    report.syntheticItemIDs = items.map(item => item.id);
    report.status = 'passed';
    report.completedAt = new Date().toISOString();
    report.note = 'No real AI request or authentication was performed. Leave this isolated app running for manual manager inspection.';
  } catch (error) {
    report.status = 'failed'; report.completedAt = new Date().toISOString();
    report.errors.push({ message: scrub(error?.message ?? error), stack: scrub(error?.stack ?? '') });
    try { Zotero.logError(error); } catch { /* Preserve report even if logging is unavailable. */ }
  } finally { await write(); }
})();
