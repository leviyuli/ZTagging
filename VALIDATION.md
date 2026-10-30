# v0.10.0 validation

Target: Zotero 10.0.6 on Windows. Installer/source hashes and aggregate results are in [dist/validation.json](dist/validation.json).

## Automated checks

`npm run verify` passed TypeScript, **896 tests**, and the production build, including **82 manager-interface tests**. Tests cross module interfaces, public controller actions, and accessible controls.

TagShelves tests cover stable membership, renaming every shelf kind, shared tag identities, scientific symbols, exact native names and ambiguous aliases, generated shelves beyond 60 tags, parent context, and missing historical members. Controller tests verify independent paper/tag scopes, complete native inventory, display-only names without meanings, captured assignment IDs across rename/restart, cache separation between targets and context, and no global `no_tag` outcome from a partial shelf.

Unified tag tests preserve Co/CO, pH/EIS, source identities and historical fingerprint policies. Generated and researcher-authored tags share matching rules and a direct-tag budget. Unchanged protected definitions do not acquire extra evidence requests or questions; fresh generated meanings still need validated supporting examples. Legacy contextual relationships retain their previous retrieval behavior.

Workflow tests cover a combined build/review page, changing the build group without discarding edits, renamed shelves, optional definition editing, and one final batch preview. Bulk acceptance is run-scoped and limited to validated substantive matches; exclusions, removals, incidental/uncertain matches, locks and remembered rejections retain explicit controls. Applying definitions does not write paper tags or enable automation.

Reset tests cover schemas 8 and 9, immutable input, cleared reusable facts/classifications/PDF excerpts and checkpoints, retained native data/definitions/credentials/audit/spending, inactive unfinished reviews, and a fresh extraction request on the next build. A public reset during dispatched paid work waits for settlement and archives the exact reply and charge without scheduling another request.

Schema-9 tests cover exact-byte collision-safe backups, migration/write failures without rollback to an older valid generation, restart idempotence and downgrade refusal. Migration creates shelves and retires obsolete cleanup work without model requests or native writes. Existing provider, budget, manual-choice, interrupted-write, undo and incoming-assignment safeguards remain covered.

## Isolated Zotero checks

All **196 packaged native checks passed** in a separate Zotero profile and data directory. The production suite exercises shelf rename, existing-name display, selected-shelf assignment with parent context, one batch Apply/Finish, exact undo, combined build/review, per-build shelves and explicit cache reset. Retained checks cover navigator/Collections restoration, independent windows, native quick/PDF/note/annotation search, columns/right panes, metadata recovery, notifications and legacy journals.

Native checks use synthetic papers and simulated replies, with no real provider request. The updater check installs the exact 0.10.0 package over disabled 0.9.0 through Zotero's AddonManager without uninstalling, and checks stable identity, state, native data, columns and package hash.

## Private replay and authorized reset

A private read-only compatibility replay of the retained **744-paper** work preserves its cached facts, quotations, identities, completed jobs, raw paid replies, history and spending. The retained schedule uses **180 representative pairs in three simulated checking requests**, at most two concurrent, with a maximum **78,839-byte** payload. **5,832 findings remain unexamined**. It makes no new extraction or chooser request, live provider call, or native write.

A separate migration replay preserves all **752 cached facts** and retires five stale cleanup tasks while retaining paid replies and budgets. This replay writes only private test output.

After the user explicitly selected a full cache reset and closed Zotero, the working extension state was backed up byte-for-byte and its reusable cache was cleared: **752 paper analyses and 39 classification caches**. Its original schema 8 was retained for compatibility until updating. All **945 paper records**, **43 saved definitions**, native tags, credentials, decisions and spending/audit records were verified unchanged. No working Zotero database or attachment was edited.

## Artifacts and limits

Production JavaScript/CSS and embedded sources must match the native-tested package and delivered TypeScript. Installer and source archives are scanned for private titles/item IDs and exclude profiles, databases, state files, credentials and private replay fixtures. Only aggregate results are published.

Focused deslop/codebase-design review keeps membership and scope selection in TagShelves, cache reset/audit handling in AnalysisReset, confidence/report decisions in AssignmentReview and selection in TagSelection; the controller handles providers, budgets, persistence and native operations.

Native DOM/control checks do not replace a screenshot review. Desktop computer-use could not start in this environment. No live account authorization, provider latency or scientific recommendation quality was measured. Native in-place installation and update-manifest/hash validation are checked locally; the published feed and downloadable bytes are checked separately after release.
