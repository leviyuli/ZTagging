# v0.13.1 update notes

This patch keeps state schema 11 and native-definition protocol 2. It does not clear analysis, modify native paper tags, or reinterpret an existing question when loading it. Earlier schema migrations retain their collision-safe exact-byte backup behavior.

Tag library now opens your tags. Use Review meanings to reopen unfinished preparation, or change a shelf/readiness filter to return to browsing. For an older question without stored answers, Suggest a meaning explicitly requests a draft using the selected provider and budget; opening the page sends no request. A valid complete candidate can offer a Use button without generating a new definition, but its supporting papers still require the existing checks. Missing information, protected decisions and contradictions remain editable or deferrable, never silently approved.

Page navigation returns to the heading while background refresh preserves inner scrolling and unsaved drafts. Short/narrow editors leave the sidebar reachable. No new account setup or cache reset is required.

## v0.13.0 migration notes

State schema 11 preserves cached extraction, original sources and fingerprints, quotations, meanings, stable IDs, paper tags, shelves, decisions, settings, credential references, paid replies, spending and history. Native-definition protocol 2 adds structured choices, human answers and a per-preparation Leave undefined outcome; existing protocol 1 records remain readable without rewriting their meaning or proof fingerprints.

AtomicStore writes an immutable exact-byte, collision-safe pre-v11 backup before migrating. Backup, migration or write failures stop the upgrade; an older valid generation is not substituted. Updating and opening the manager perform no AI requests or native tag writes.

For an earlier plain-text question such as Batteries, open Tag library and choose Continue preparation. This explicit request uses the selected provider and budget to draft a broad meaning from the retained paper context. It does not repeat factual extraction, invent choices from the old question, or discard paid replies. Ready results can still be saved without regenerating them.

Choosing or editing a meaning records human intent separately from source judgments. Changed sources and meanings require new checks; exact compatible positive or negative judgments remain reusable. Leave undefined keeps the native name visible and excludes it from AI assignment without deleting or renaming paper tags. Done closes only a fully saved or explicitly deferred review.

Rename and Merge shelves now remain visible above the workspace, including during meaning review. Merge still replaces selected shelves by default, retains native names in a combined My tags shelf when selected, and supports Activity Undo. Completed work moves into collapsed Activity history; unresolved choices and unsaved meanings remain actionable.

## Earlier migration notes

### Upgrading to Smart Tags 0.12.0

## Version 0.12.0

State upgrades to **schema 10**. Before writing, the extension preserves the exact original bytes in **state.json.pre-v10.json**, using numbered filenames for different earlier generations. Backup or migration-write failure stops without substituting an older valid .bak. Older schema-9 installations refuse to overwrite newer data.

Migration makes no provider request or native-library write and preserves cached facts, quotations, IDs, old proof policies, completed jobs, pending reviews, settings, encrypted credential references, spending and history. It adds support for native-only shelf memberships, removed-shelf redirects, shelf-organization journals and resumable meaning preparation. Existing tag names and shelf membership are retained.

Shelf Merge replaces selected sources by default. When My tags is selected, the combined shelf retains its native inventory under the new name. Historical assignment runs retain their captured tag IDs; removed shelf selections resolve to the combined shelf. Undo restores organization unless later shelf edits conflict. No semantic tag merge or native renaming is implied.

New meaning preparations use native-definition protocol 1. All-paper support is required before a native name becomes an approved alias; uncertain or non-scientific meanings remain unready. New definitions start in suggestion-only mode, and neither preparation nor Apply enables incoming automation. Reset paper analysis archives pending meaning work and paid records before clearing its reusable results.

## Version 0.11.1

This is a display correction. Both menus show total library entries and the subset ready for AI assignment, using the same shelf names and counts. State remains schema 9; no shelf memberships, meanings, native assignments, cached facts, provider settings or spending change. Existing shelves may overlap.

## Version 0.11.0

State remains schema 9. Opening the updated extension folds the old Existing tags shelf into My tags, preserving the My tags name, memberships and generated shelves. Old Existing-shelf selections resolve to My tags; paid assignment scopes and captured tag IDs stay unchanged. Native tag names and assignments are not renamed or removed.

If a completed extension was prepared before you edited the saved list, choose **Update and apply**. The current definitions are authoritative, deleted saved tags are not restored, and original work is archived before comparison. Compatible example checks are reused; changed meanings cannot inherit outdated match claims. Any remaining checks use the selected connection and budget, and applying definitions remains separate from paper assignment.

Keyword preferences affect future requests and can use keyword passages already present in cached findings. They do not invalidate cached extraction or rewrite original wording, identifiers, proof fingerprints, or normalization policies. DRT grouping changes report presentation only and retains individual topic records. Updating makes no provider request and enables no automation.

## Version 0.10.3

State remains schema 9. This patch makes no migration-time provider request or native-library change. Saved tag definitions, original paper findings, historical proof fingerprints, replies, repair counters and spending are retained.

For a build paused while choosing tags, update and use **Retry this step**. ZTagging first reparses the current generation's saved complete replies. It removes conflicting generated aliases and uses a candidate's own unambiguous full name where possible; candidates that still conflict are left out rather than changing a saved meaning. New tags continue through source checking. Do not reset the paper cache or start a new build to recover this failure.


## Version 0.10.2

State remains schema 9. Completed prior plans are retained as a dormant cache while new paper jobs run; current facts, scope and settings must match before reuse. Older saved runs carrying a ready plan alongside pending papers are normalized locally on reopening. This sends no provider request and changes no native data, facts, completed replies or spending. Optional paper-analysis reset clears the dormant cache too, preserving its audit record.

## Version 0.10.1

State stays at schema 9. Install the patch over the existing extension and use **Retry this step** for a saved failed choice. The extension rechecks the saved reply before scheduling another chooser request; the paper facts, stable candidate IDs, raw replies, repair-attempt history and spending remain. Unknown optional tag relationships can be withheld without inventing aliases, subtype claims or paper support. Scientific contradictions, cycles and invalid source evidence remain blocked.

## Version 0.10.0

Install the update over the existing extension. Before writing **schema 9**, Smart Tags saves an immutable exact-byte **state.json.pre-v9.json** backup. Occupied filenames with different bytes receive numbered suffixes. Backup or migration-write failure stops without substituting an older valid `.bak`; older applications refuse downgrade writes.

Building and reviewing a tag list now share one page. Existing native Zotero tags are left unchanged: no definition import, name comparison, or cleanup is required. Earlier cleanup replies, snapshots, spending, and journals remain available as history; obsolete non-retry cleanup tasks are retired without provider requests or native writes. Paper-analysis retry tasks retain their recovery behavior.

The tag library treats generated and researcher-authored definitions alike. Renameable shelves group tag membership without changing scientific meanings or subtype relationships. Existing internal provenance flags remain intact for IDs, protected edits, default matching modes, and historical compatibility; they are not separate user-facing tag classes. Existing contextual relationships keep their prior retrieval behavior.

Facts, source quotations and provenance, completed jobs, paid replies, exact-source decisions, pending reviews, manual choices, settings, credentials, budgets, and undo history are preserved. Older planner checkpoints retain their saved tag policy and request history; only a new preparation opts into unified tag handling. Matching modes remain explicit, and upgrading does not enable automation or satisfy the pilot gate.

**Reset paper analysis…** is a separate, optional Settings action. It clears reusable facts, classification caches, derived PDF excerpts and pending results. Original paid replies and spending remain in an inactive audit record; approved evidence and native Zotero data stay intact. The next build performs fresh extraction. Resetting also clears the pilot review gate and does not enable incoming assignment.

## Version 0.9.0

Install the update over the existing extension. Before writing **schema 8**, Smart Tags saves an immutable exact-byte **state.json.pre-v8.json** backup. Different existing bytes receive a numbered filename; older backups remain intact. Backup or migration-write failure stops without replacing valid data from an older `.bak`, and older applications refuse schema-8 downgrade writes.

Migration preserves cached facts and their quotations, identities and provenance, completed jobs, pending proposals and faster-build recovery, saved raw replies and allowances, native snapshots, manual choices, ownership, history, settings, credentials, and spending. It performs no provider request, native change, or automatic confidence-based reclassification of old suggestions. Older suggestions remain available as earlier results. Existing extension checkpoints without an additional-tag target keep their old policy; new extensions default to **30 additional tags**, separately from the initial 60-tag preference.

**Existing tags → Keep tags** is now the main cleanup view. Read the complete native inventory, check names to retain, preview removal of every other name, then Apply with undo. That includes unchecked Smart Tags assignments; saved definitions remain available. no_tag is protected, earlier locks default to Keep, and unchecking them explicitly replaces those protections. Keep itself creates no lock or permanent rejection. Cleanup does not rerun AI or reset the tag list. Optional DIY creation and equivalent-definition merging remain separate reviewed actions.

New assignments keep their own paper scope, suggestions, and history. Supported high-confidence core and DIY additions start accepted but unwritten; low-confidence declines do not become permanent rejections. Review medium or uncertain matches, no_tag, and removals before **Apply accepted and finish**, or **Finish assignment** when no accepted changes remain. The final topic report appears only after finishing, and applying one review never includes another run's accepted suggestions.

The report can retain topics from partly covered papers as well as papers wholly outside the saved list. Choose topic papers to extend the vocabulary; selected no_tag papers require a reviewed Include again step. Apply the additions and assign again to verify their coverage. Creating or approving a definition alone does not resolve earlier outcomes. None of these changes enables incoming-paper automation or bypasses its pilot review.

The v0.8.1 faster-build recovery remains available: **Retry faster build** or **Resume** locally checks unchanged inputs before restoring a missing cached fact from the saved snapshot. Changed or unavailable required PDF evidence remains actionable instead of triggering an unreviewed replacement.

## Version 0.8.1

State remains **schema 7**. Install the update over the existing extension. If a run is stuck on **Switching to faster build…**, click **Retry faster build** or **Resume**. The pending switch continues; it does not restart the older chooser or reset saved replies, correction counters, or spending.

An attachment notification could previously remove cached analysis even when the paper's metadata and PDF content were unchanged. The switch now verifies current inputs and quotations locally before restoring a missing factual record from its immutable snapshot. This recovery makes no extraction request and does not change native library data. Unchanged attachment notifications also retain usable facts.

If the inputs changed or a required PDF cannot be checked locally, the run stays paused with a paper-recovery message. Open **Papers that need attention**, inspect or recheck the PDF, or explicitly retry that paper's analysis, then retry the faster build. Existing analysis for other papers remains available.

## Version 0.8.0

Install the update over the existing extension. Before writing **schema 7**, Smart Tags saves an immutable exact-byte **state.json.pre-v7.json** backup. An occupied filename with different bytes is preserved and a numbered suffix is used. Backup or migration-write failure stops without substituting an older valid `.bak`; older applications refuse to overwrite schema-7 state.

Schema-6 migration changes only the schema field. It preserves cached factual extraction, quotations and provenance, source identities, selected snapshots, completed jobs, pending proposals, edits and answers, raw responses, old planner-3 checkpoints, journals, settings, credentials, and spent budget. Migration performs no provider request or native-library change. Factual extraction, terminology, and source-validation policy 3 remain unchanged.

New builds use **representative planner 4**. For an unfinished older build whose paper reading is complete, choose **Use faster build** in Activity or the run's progress bar. This explicit action sets a preferred target of **60** and waits for active requests to settle before changing the saved schedule. It retains old work and responses in history, reuses valid facts and compatible exact-source decisions, and preserves researcher edits and exclusions. Installation or ordinary Resume does not silently convert an existing planner-3 build.

Representative verification checks up to **three different example papers per tag**, using requests of at most **64 tag–source pairs and 90 KB**, with up to two independent requests in flight. Smaller output limits can reduce batch size. Valid results persist immediately; one bounded repair round checks unresolved pairs without repeating accepted ones. Authentication, quota, connection, permission, and budget failures still pause with the selected provider unchanged.

Review counts describe **verified example papers**, not total matching library papers. Unsampled findings remain unexamined and cannot authorize outside-vocabulary or no_tag decisions. Policy-3 proofs still bind each accepted tag/source pair to its snapshot and fingerprints. Unsupported generated topics may be deferred; DIY and protected definitions are retained. Ambiguous examples may be omitted when another checked example grounds the same concept, while unresolved concept meanings remain researcher questions.

A local simulation using a copied 744-paper build retained its 60 frozen tags and scheduled 180 example pairs in three requests, the largest 78,839 bytes; 5,832 findings remained unexamined. It used synthetic replies with no new chooser, extraction, native writes, or live provider calls. These figures demonstrate the saved schedule, not scientific accuracy or a completion-time guarantee.

**Apply tag list** saves definitions only. Choose the assignment group separately in **Assign & automate**, review the paper suggestions, and confirm their native Apply with undo. Upgrading or switching build planners does not enable incoming assignment or satisfy its pilot gate.

## Version 0.7.1

State remains schema 6. Install the update without uninstalling, then click **Resume** or **Retry this step** on a paused tag-selection run. Before requesting another reply, Smart Tags rechecks the last complete saved reply locally. Successful local recovery retains the previous raw replies, repair counters, spending, selected source snapshot, and completed paper analysis. Loading the extension does not make a provider request or write native library data.

Existing DIY definitions stay unchanged. Generated aliases that claim an existing DIY name are withheld; this does not merge a broad generated topic into the narrower DIY topic. A failed local recheck does not reset automatic allowances or consume a paid request.

Source checks use a smaller transport view of each frozen definition: identity, name, full meaning, category, nonempty matching guidance, and subtype context. Search aliases and administrative settings stay local. The original definitions, meaning fingerprints, source IDs, and full validated source text remain unchanged. Completed batches retain their identities; the update does not restart them merely to repack requests.

## Version 0.7.0

This release upgrades local state to **schema 6**, after saving an immutable exact-byte **state.json.pre-v6.json** backup. An occupied filename with different content receives a numbered suffix. Backup or migration-write failure stops without replacing a valid generation from an older `.bak`. Migration performs no model request or native library change.

Cached paper facts, completed jobs, quotations, source and registry IDs, selected snapshots, historical confirmations, definitions, decisions, journals, settings, credential references, and spent budget are preserved. The factual extractor and terminology versions remain unchanged. Older reviewable proposals retain their historical validation behavior.

For an unfinished build, update normally and click **Resume**. Smart Tags reuses its selected facts and valid snapshot, retains the old consolidation checkpoint as audit data, and starts global selection and source checking. It does not continue recursive reduction or reread unchanged papers through the model. Changed paper information still refreshes only affected facts.

New work persists its shortlist, candidate IDs, frozen definitions, source decisions, task states, raw replies, and dispatched counters. Source-validation policy 3 requires an explicit current decision for each covered source. Old confirmations cannot approve new unchecked sources. Ordinary presentation changes preserve compatible proofs; meaning changes require checks of the affected links.

Two independent mapping requests may run at once. Budget reservations and result application are serialized; interrupted or usage-less requests retain their reservations. A complete reply saved before interruption can be replayed without another request. Resume never resets correction allowances. Retry this step starts an explicit retry of failed technical work while retaining prior attempts, completed checks, and spending.

Tag selection favors the largest area in the chosen build group. The initial target is 60 core tags, plus necessary parent closure when needed. Extend keeps all applied definitions; its automatic addition allowance is the greater of the remaining preferred slots or one quarter of the preferred count (15 additions for an existing 60-tag list), plus required parents. This guides automatic selection and is not an approval limit. Deferred topics and their original evidence remain retained, and manually added DIY topics stay available.

## Version 0.6.0

The sidebar now follows **Connect AI → Build tags → Review & clean up → Assign & automate**, with the applied list under **Tag library**. Apply tag list saves definitions without immediately analyzing the build papers for assignment. Choose a separate assignment group and start its suggestions explicitly. Native paper tags still require a reviewed batch Apply.

State remains schema 5, with optional workflow choices and an immutable baseline for new-field builds. Cached factual extraction, source identities, historical snapshots and confirmations, credentials, settings, completed work, and native data remain intact. Loading the update performs no provider request. Existing paused builds keep their original mode; updating does not reinterpret an old proposal as an extension.

New builds default to adding tags when an applied list exists. The current applied definitions are retained while incoming suggestions are checked against the newly selected papers. Old papers are not silently added to the new evidence snapshot. Full replacement remains an explicit option. Build and assignment group choices are kept independently; the first assignment group defaults to the whole personal library.

The assignment-pilot gate is unchanged: use Run assignment pilot, review its suggestions, and mark the pilot reviewed before enabling incoming-paper automation. Applying a different core tag list resets that gate and turns automatic assignment off. DIY creation alone does not reset it.

Earlier evidence remains in separate build records when you extend the list. Restoring a previous list that spans several builds requires rebuilding a proposal from the retained paper facts; the extension explains this rather than mixing source identities from different snapshots. Native assignment undo remains available through History.

## Version 0.5.3

Install the update through Zotero without uninstalling the existing extension. If a build is already paused, click **Resume** once after updating. Routine reply repair then continues automatically. Saved completed parts, original replies, cached extraction, selected evidence, settings, credentials, manual choices, and spent budget are retained. Loading the update makes no provider request or native library change.

State remains schema 5 and consolidation remains protocol 2. Optional queue fields record dispatched organization requests, fresh-reply allowance, split depth, and superseded portions. Completed old portions are not repartitioned or resent. Unstarted oversized portions can be divided before dispatch; replaced parent portions retain their replies and are marked complete with no output, while active child portions carry the remaining work. Short transport references resolve against each portion's exact persistent input IDs; original evidence identities, wording, and historical proofs are unchanged. No factual-extractor or terminology-policy version changes are required.

An existing complete failed reply is rechecked locally before another request. Each portion can receive one correction per generation and at most one automatic fresh generation along its split lineage. Splits stop at a bounded size/depth, and each build allows at most 512 dispatched organization requests. Budget rejection before dispatch does not consume an attempt. Counters survive restart and ordinary Resume. The three-request scientific-preparation allowance remains separate. Changing provider or starting another build still requires an explicit user choice; spent budget is not reset by automatic recovery.

## Version 0.5.2

This is an interface-only patch. State schema remains 5, with no migration, reanalysis, provider call, native tag write, or reset of saved work during upgrading. Attention actions have moved into compact menus; their controller behavior, review steps, and undo records are unchanged.

## Version 0.5.1

This patch keeps state schema 5. Existing schema-5 profiles retain their current generation, cached extraction, evidence wording and IDs, settings, credentials, manual choices, and history. New dismissal and exclusion-preview fields are optional; no extraction or provider request runs during loading. Profiles upgrading from an earlier schema still use the exact-byte pre-v5 backup process below.

Saved failed consolidation replies are rechecked locally when you Resume. Routine relationship recovery changes the proposed organization, not the original paper evidence or native tags. Correction attempts and replies are retained with the current part; explicit retry generations preserve earlier attempt history and spent budget. Incomplete provider replies remain diagnostic only.

The built-in no_tag definition is supplied locally. Native no_tag assignments mean an item is excluded until you choose Include again or remove the marker. Existing reserved-name definitions and their historical IDs are preserved, and their remembered choices remain protected. Exclude/Include changes use the normal native-tag journal with stale checks and undo. Dismissals acknowledge a condition without marking its underlying information gap resolved.

## Upgrading an older state to schema 5

Install the new XPI over the existing extension and open **Tools → Smart Tags…**. Startup upgrades local application state to **schema 5**. Consolidation continues to use ID-based protocol 2; terminology normalization and factual extraction versions are unchanged by this migration. Migration performs no model requests and changes no native Zotero tags, metadata, collections, columns, or credentials.

Schema-4 source evidence, pending proposals, human choices, IDs, completed jobs, raw queue responses, settings, budgets, and history are copied intact. The old derived cleanup preview is cleared. Reopen **Existing tags → Read library tags** to create a current comparison against the applied vocabulary.

## Continuing an existing review

Open **Review & clean up** for a saved proposal, or **Activity → Resume** for an interrupted build. The extension retains selected evidence, saved edits, human confirmations, and completed paper analysis. It runs local preparation checks first when a proposal is available. If more scientific checking is needed, choose **Resume checks**; if a preparation run cannot finish, **Try again** starts another bounded attempt. You do not need to discard the review or repeat unchanged factual extraction.

Large builds now organize validated concepts in bounded portions before producing one global proposal. Saved completed portions and raw responses are retained. **Reading papers** reaching the selected count means extraction is complete; **Organizing tags** and **Checking tag meanings** still precede **Ready for review**. Resume continues available work, with changed metadata or PDF evidence refreshing only affected papers.

The new preparation stage can make **up to three additional requests** after the initial tag-list draft, using your explicitly selected provider and model. These requests use the existing budget controls. The old one-correction checkpoint remains in history and does not consume the new preparation allowance. A dispatched request counts even if it fails or is interrupted; a budget rejection before dispatch does not. Pause, restart, and ordinary Resume preserve the counter and saved responses. An explicit retry retains prior preparation replies and spent-budget history.

**Questions** contains choices that the available scientific context cannot settle. Existing edits, DIY names, and human choices remain protected. The preferred number of core tags is **60**, with distinct concepts allowed to remain separate above that number.

When ready, **Apply tag list** saves the vocabulary. In 0.6.0, continue to **Assign & automate**, choose the assignment group, and start suggestions explicitly. Inspect those in **Paper suggestions**, then confirm a separate batch Apply to write native tags. That batch has an undo record in **Activity**. Preparing a list, answering questions, and applying the list do not enable unattended assignment. Review the tagging pilot before enabling automation.

## Backups and retained evidence

Before writing schema 5, the extension creates an immutable, exact-byte **state.json.pre-v5.json** backup in the profile's `smart-tags` directory. A different existing backup is kept and a numbered filename is used. Earlier pre-v2/pre-v3/pre-v4 backups remain intact. Backup, migration, or migration-write failures stop without substituting an older valid `.bak` generation. A state file from a newer schema is refused, including attempted downgrade writes.

Factual source wording, quotations, fingerprints, extractor version, provider/model provenance, and existing IDs are retained. Completed jobs remain reusable when their evidence is unchanged. Settings, credentials, previously spent budget, decisions, locks, assignment ownership, native snapshots, and undo journals are preserved. Changed metadata or newly readable PDFs refresh affected papers. Private profile backups contain library metadata and should stay out of public artifacts.

Schema-3 pending reviews keep their evidence snapshots, candidate allocations, raw replies, and historical human proofs. Obsolete coverage entries for already removed candidates are pruned from active derived coverage; the original source evidence and review history remain retained. New source-level scientific judgements and researcher answers are stored separately from historical confirmation records.

## Paper recovery and reviewed native changes

Evidence notices now lead to **Activity → Papers that need attention**. Validated concepts remain usable when additional context was requested. The paper view distinguishes missing information from failed analysis; dismissal does not claim that evidence has been repaired.

Use **Find metadata**, review the identifier-confirmed additions, and choose **Apply metadata** to fill empty bibliographic fields or an empty creator list. **Recheck PDF** explicitly checks local files and retries local indexing; it does not download files or run OCR. **Retry analysis** and **Retry selected** queue requested work behind an ongoing library build. **Skip for this build** keeps the native item and its existing tags intact.

Metadata repairs have exact before/after journals and preserve superseded factual extraction in local history. Apply, recovery, and undo invalidate affected derived analysis. **Existing tags** changes and DIY-definition creation also have reviewed history records. Undo restores only the recorded changes and refuses conflicting later edits; partial or externally changed native batches remain marked for review rather than overwriting current data.

Creating DIY definitions or confirming equivalent approved aliases preserves the current core pilot. Applying a different core vocabulary still requires reviewing its tagging pilot before unattended assignment. Provider selection, encrypted credentials, and automatic-assignment preferences are retained; recovery does not switch providers or enable automation.

## Safe legacy-draft cleanup

For upgrades from schema 3 or earlier, the existing legacy cleanup removes unused generated drafts from active extension definitions only when an original baseline proves their fields are unchanged. Custom, approved, edited, manually referenced, historically referenced, and current-proposal definitions are kept, together with definitions needed by their relationships. Unknown origins or a missing baseline cause definitions to be retained. Upgrading an existing schema-4 state does not rerun that cleanup or alter its current proposal.

This is permanent cleanup of eligible extension draft records, backed by the standard exact-byte migration backup. It creates no additional legacy archive and removes no native paper tags. The current review and its stable IDs remain available. Regular vocabulary history and tag-change undo continue to work.

## Notices and older installations

**Activity** keeps actionable notices with affected-paper links and persistent dismissal. Successful reevaluation resolves only the corresponding paper and processing phase. Unfamiliar-topic notices clear when fresh assignment analysis no longer finds that condition; completed merge reviews belong in history. A later successful request does not establish the missing usage of an earlier request or confirm an earlier remote revocation. Brief success confirmations disappear after the action.

From schema 1 or 2, the earlier local evidence-identity and preparation upgrades run before schema 5. They add local IDs without repeating unchanged factual extraction, and invalidate incompatible name-based consolidation checkpoints and proposals. Resume the saved work or prepare tags again for the intended scope. Legacy support links are converted only through uniquely validated matches; ambiguous or scientifically uncertain links remain unresolved. Old warning strings remain historical, unverified notices without invented paper associations or dates.

Older definition exports remain importable. Private proposal/evidence exports retain their source and vocabulary checks. Normal definition export stays separate from exports containing paper wording and quotations.

The account/workspace switch introduced in 0.4.1 is available under **Connect AI → Use another account or workspace**. It preserves saved accounts and paper analysis while starting a fresh ChatGPT connection when needed.
