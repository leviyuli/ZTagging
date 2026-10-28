/** TEST ONLY. Synthetic state/manager checks inside the exact isolated profile and data directory. */
import { AtomicStore } from '../src/store.ts';
import { initialState, validState, validLegacyState, migrateState } from '../src/controller.ts';
import { normalizeFacts, createTaxonomyProposal } from '../src/taxonomy.ts';
import { createEmptyEvidenceCatalog, createRegistrySnapshot } from '../src/evidence.ts';
import { upsertWarning } from '../src/warnings.ts';

const normalized = value => String(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const clone = value => JSON.parse(JSON.stringify(value));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, limit = 15_000) {
  const start = Date.now();
  while (Date.now() - start < limit) { const result = predicate(); if (result) return result; await delay(35); }
  throw new Error('Native v0.3.0 timeout: ' + label);
}
function button(root, text) { return [...root.querySelectorAll('button')].find(element => element.textContent === text); }
function record(root, message) { return [...root.querySelectorAll('.warning-record')].find(element => element.textContent.includes(message)); }
function sameBytes(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }

export async function runNativeV030(app, check, config) {
  check('v030IsolatedDataGuard', normalized(Zotero.DataDirectory.dir) === normalized(config.data));
  check('v030IsolatedProfileGuard', normalized(Services.dirsvc.get('ProfD', Ci.nsIFile).path) === normalized(config.profile));
  check('v030ApplicationSchema', app.state.schemaVersion === 3);
  check('v030InstalledZoteroTarget', Zotero.version === '10.0.6', Zotero.version);
  const stamp = Date.now().toString(36);
  const directory = PathUtils.join(config.profile, 'smart-tags');
  const statePath = PathUtils.join(directory, 'native-v030-' + stamp + '.json');
  const legacy = clone(initialState());legacy.schemaVersion = 2;
  legacy.warnings = ['V030QA historical unverified notice'];legacy.settings.budgetUSD = 17;
  delete legacy.evidenceCatalog;delete legacy.taxonomyEvidence;
  const original = JSON.stringify(legacy, null, 3) + '\r\n';
  await IOUtils.writeUTF8(statePath, original);
  await IOUtils.writeUTF8(statePath + '.bak', JSON.stringify(initialState()));
  await IOUtils.writeUTF8(statePath + '.pre-v3.json', 'V030QA existing immutable backup');
  const sourceBytes = await IOUtils.read(statePath);
  const makeStore = () => new AtomicStore({
    read: path => IOUtils.readUTF8(path),readBytes: path => IOUtils.read(path),exists: path => IOUtils.exists(path),
    copyExact: (source, destination) => IOUtils.copy(source, destination, { noOverwrite: true }),
    writeAtomic: (path, value) => IOUtils.writeUTF8(path, value, { tmpPath: path + '.tmp' }),
  }, statePath, initialState, validState, migrateState, validLegacyState);
  const migrated = await makeStore().load();
  check('v030NativeMigrationExactByteBackup', migrated.schemaVersion === 3 && migrated.settings.budgetUSD === 17
    && sameBytes(sourceBytes, await IOUtils.read(statePath + '.pre-v3.1.json'))
    && await IOUtils.readUTF8(statePath + '.pre-v3.json') === 'V030QA existing immutable backup');
  check('v030NativeLegacyWarningUnknownMetadata', migrated.warnings.length === 1 && migrated.warnings[0].legacy
    && migrated.warnings[0].firstSeenAt === null && migrated.warnings[0].occurrenceCount === null && migrated.warnings[0].paperIds.length === 0);
  const reloaded = await makeStore().load();
  check('v030NativeMigrationReloadIdempotent', validState(reloaded) && !await IOUtils.exists(statePath + '.pre-v3.2.json'));

  let startupWindow;
  let startupNavigator;
  try {
    const existingWindows = new Set(Zotero.getMainWindows());Zotero.openMainWindow();
    startupWindow = await until(() => Zotero.getMainWindows().find(win => !existingWindows.has(win) && win.ZoteroPane?.itemsView && win.ZoteroPane?.collectionsView), 'default Tags startup window');
    await startupWindow.ZoteroPane.collectionsView.waitForLoad();
    await startupWindow.ZoteroPane.itemsView.waitForLoad();
    startupNavigator = await until(() => Zotero.SmartTags.getNavigator(startupWindow), 'default Tags startup navigator');
    // Do not call setMode('tags'), refresh(), or apply(): the plugin must install
    // this view itself after native lastViewedFolder restoration has completed.
    const startupRow = await until(() => startupNavigator.mode === 'tags'
      && startupWindow.ZoteroPane.itemsView.collectionTreeRows.find(row => row.id.startsWith('smart-tags-view-')), 'automatic Tags row after native startup restoration');
    await startupWindow.ZoteroPane.itemsView.waitForLoad();
    check('v030NativeDefaultTagsSurvivesStartupRestore', app.state.taxonomyReady && startupNavigator.mode === 'tags'
      && startupWindow.ZoteroPane.itemsView.collectionTreeRows.some(row => row.id === startupRow.id), {
      viewIdentity:startupRow.id,nativeSelection:startupWindow.ZoteroPane.getCollectionTreeRows().map(row=>row.id),forcedTagReapplications:0,
    });
    await startupNavigator.setMode('collections');
    check('v030NativeStartupWindowRestoresCollections', !startupWindow.ZoteroPane.itemsView.collectionTreeRows.some(row => row.id.startsWith('smart-tags-view-')));
  } catch (error) {
    throw new Error(error.message + ' · ' + JSON.stringify({mode:startupNavigator?.mode,viewIdentities:startupWindow?.ZoteroPane?.itemsView?.collectionTreeRows?.map(row=>row.id),documentReadyState:startupWindow?.document?.readyState}));
  } finally {
    if (startupNavigator?.mode === 'tags') await startupNavigator.setMode('collections');
    if (startupWindow && !startupWindow.closed) startupWindow.close();
  }

  const before = clone(app.state);
  let manager;
  let sourceNativeTags;
  let paper;
  const invocations = [];
  const originalInvoke = app.invoke;
  app.invoke = function(action, payload) {
    invocations.push(action);
    if (['rebuild', 'tag', 'resume', 'regenerate-taxonomy', 'test-connection', 'apply-suggestions', 'apply-cleanup'].includes(action)) throw new Error('V030QA must not send AI or native tag writes.');
    return originalInvoke.call(this, action, payload);
  };
  const open = async page => {
    manager = await Zotero.SmartTags.openManager({ page });
    await until(() => !manager.closed && manager.document.getElementById('app')?.getAttribute('data-smart-tags-state') === 'ready', 'production manager ready');
    return manager.document;
  };
  const close = async () => { if (manager && !manager.closed) manager.close();manager = null;await delay(50); };
  try {
    paper = Object.values(app.state.papers).find(value => value.title === 'Smart Tags smoke: catalyst-layer resistance in PEM electrolysis');
    if (!paper) throw new Error('V030QA requires the preceding synthetic catalyst-layer paper.');
    sourceNativeTags = JSON.stringify((await Zotero.Items.getAsync(paper.itemID)).getTags());
    // The preceding navigator fixture has a shared detail linked to its FC core.
    // This one-concept proposal must not inherit that deliberately separate graph.
    app.state.tags = clone(initialState().tags);app.state.decisions = {};app.state.ownership = {};
    const quote = 'We measure catalyst-layer resistance in PEM water electrolysis';
    const facts = normalizeFacts({summary:'Synthetic protonic resistance evidence for manager review.',concepts:[{name:'catalyst-layer resistance',facet:'phenomenon',evidence:[{source:'abstract',text:quote}]}],needsPDF:false}, paper, 'native-synthetic', 'native-test');
    const catalog = createEmptyEvidenceCatalog();
    const snapshot = createRegistrySnapshot([facts], catalog);
    const registryId = Object.keys(snapshot.entries)[0];
    const proposal = createTaxonomyProposal({tags:[{key:'native-v030-resistance',name:'protonic resistance',fullName:'protonic resistance',description:'Protonic resistance within a catalyst layer.',facet:'phenomenon',aliases:[],parentKeys:[],relatedKeys:[],supportRegistryIds:[registryId]}],merges:[],excluded:[]}, [facts], app.state.tags, {snapshot,candidateIds:{},generationId:'native-v030-proposal-'+stamp,baseVersion:app.state.vocabularyVersion,limit:60});
    const tag = proposal.tags.find(value => !value.custom);
    check('v030SyntheticUncertainMapping', !!tag && proposal.validationIssues.some(issue => issue.tagId === tag.id && issue.code === 'uncertain-meaning')
      && proposal.validationIssues.every(issue => issue.severity === 'confirmation'), proposal.validationIssues.map(issue => ({ code: issue.code, message: issue.message })));
    app.state.facts[paper.id] = facts;app.state.evidenceCatalog = catalog;app.state.taxonomyProposal = proposal;
    await app.save();
    const vocabulary = await open('vocabulary');
    check('v030NativeUncertainProposalRendering', !!button(vocabulary,'Confirm scientific mapping') && button(vocabulary,'Approve global vocabulary')?.disabled
      && vocabulary.body.textContent.includes('Source wording: catalyst-layer resistance') && vocabulary.body.textContent.includes(quote)
      && vocabulary.body.textContent.includes('native-synthetic · native-test'));
    check('v030NativePrivateEvidenceExportControl', !!button(vocabulary,'Export proposal with evidence…') && vocabulary.body.textContent.includes('private paper source wording and quotations'));
    button(vocabulary,'Confirm scientific mapping').click();
    try {
      await until(() => !!app.state.taxonomyProposal.mappingConfirmations?.[tag.id], 'explicit scientific confirmation');
      await until(() => !button(vocabulary,'Approve global vocabulary')?.disabled, 'approval enabled after confirmation');
    } catch (error) {
      throw new Error(error.message + ' · ' + JSON.stringify({confirmed:!!app.state.taxonomyProposal.mappingConfirmations?.[tag.id],issues:app.state.taxonomyProposal.issues,unresolvedMerges:app.state.taxonomyProposal.unresolvedMerges,invocations}));
    }
    check('v030NativeScientificConfirmationAction', invocations.includes('confirm-taxonomy-mapping') && app.state.taxonomyProposal.support[tag.id].paperIds.includes(paper.id));

    const message = 'V030QA missing PDF evidence ' + stamp;
    app.state.warnings = upsertWarning(app.state.warnings,{code:'native-v030-gap',message,context:'facts',conditionFingerprint:'native-v030-condition-'+stamp,paperIds:[paper.id],runIds:[]});
    const warningId = app.state.warnings.find(value => value.message === message).id;
    await app.save();
    const activity = await open('activity');
    await until(() => record(activity,message) && button(record(activity,message),'Dismiss'), 'active warning controls');
    check('v030NativeWarningPaperLinks', [...record(activity,message).querySelectorAll('.paper-title-button')].some(value => value.textContent === paper.title));
    button(record(activity,message),'Dismiss').click();
    await until(() => app.state.warnings.find(value => value.id === warningId)?.status === 'dismissed', 'warning dismissal');
    await app.save();
    await close();
    const persisted = JSON.parse(await IOUtils.readUTF8(PathUtils.join(directory,'state.json')));
    check('v030NativeWarningDismissalPersisted', persisted.warnings.find(value => value.id === warningId)?.status === 'dismissed');
    app.state.warnings = clone(persisted.warnings);
    const reopened = await open('activity');
    await until(() => record(reopened,message), 'dismissed warning history after reopening');
    check('v030NativeWarningReloadHistory', record(reopened,message).textContent.includes('dismissed') && !button(record(reopened,message),'Dismiss'));

    for (let index=0;index<2;index++) app.state.warnings = upsertWarning(app.state.warnings,{code:'native-v030-all',message:'V030QA dismiss all '+stamp+' '+index,context:'facts',conditionFingerprint:'all-'+stamp+'-'+index,paperIds:[paper.id],runIds:[]});
    await app.save();
    await until(() => button(reopened,'Dismiss all'), 'dismiss-all control');
    button(reopened,'Dismiss all').click();
    await until(() => !app.state.warnings.some(value => value.status === 'active'), 'dismiss all action');
    await app.save();
    check('v030NativeDismissAllPreservesRecords', app.state.warnings.filter(value => value.code === 'native-v030-all' && value.status === 'dismissed').length === 2 && app.state.warnings.some(value => value.id === warningId));
    check('v030NativeNoAISideEffects', invocations.every(action => ['confirm-taxonomy-mapping','dismiss-warning','dismiss-warnings'].includes(action)));
    check('v030NativeTagsUnchangedDuringReview', JSON.stringify((await Zotero.Items.getAsync(paper.itemID)).getTags()) === sourceNativeTags);
    return {manager:'Production manager window and actions',warningPersistence:'Native atomic state write, reload, and manager reopen',exactByteMigration:true,realAIRequests:0,nativeTagChanges:0};
  } finally {
    await close();app.invoke = originalInvoke;app.state = before;await app.save();
  }
}
