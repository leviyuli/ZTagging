# v0.9.0 validation

Target: Zotero 10.0.6 on Windows. Installer/source hashes and machine-readable results are in [dist/validation.json](dist/validation.json).

## Automated checks

`npm run verify` passed TypeScript, all **851 tests**, and the production build. The suite includes **74 manager-interface tests** and public controller workflows for the new cleanup and assignment actions.

Keep-list tests cover the complete personal-library inventory, exact names including whitespace and long labels, Co/CO, filtered and paginated selections, unchecked Smart Tags assignments, protected no_tag in both cleanup views, explicit lock overrides, changed inventories, persistence, reassignment without permanent rejection, native types, interrupted writes and undo. Keeping a name creates no new semantic lock or rejection.

DIY comparison tests cover finite requests within 90 KB and 64 pairs, response-token-aware splitting, explicit relation judgments, scientific distinctions, partial valid replies, one correction, budget rejection before dispatch, authentication pauses, retained settled replies across restart, stale previews, canonical meaning and identity, aliases, native deduplication, ownership, remembered choices, identity redirects, interrupted applies and undo. Broader, narrower, related, distinct and uncertain results cannot be compiled as equivalent merges.

Assignment tests cover automatic acceptance of supported high core and DIY additions, run-local low declines, medium/no_tag/removal review, preserved human choices, isolated run IDs and Apply scopes, cached reruns, zero-change Finish and reports revealed only after Finish. Uncovered topics retain validated quotations even on partly matched or wholly outside-vocabulary papers. Tests verify exact selected-paper extension, reviewed inclusion of chosen no_tag papers, unchanged other exclusions, matching reassignment before topic resolution, and resolution undo, including DIY additions that preserve the core pilot version. Automatically accepted pilot suggestions require explicit Apply before the pilot can be marked reviewed.

Extension tests demonstrate **43 → 73 → 103** tags while retaining prior definitions. New additional-tag targets are independent of the saved count, and old checkpoints without that setting retain their earlier policy. Schema-8 tests cover schema-only migration, unchanged legacy statuses and manual decisions, retained evidence and paid replies, exact-byte collision-safe backups, failures without older-generation substitution, restart idempotence and downgrade refusal. Migration makes no AI request, native change or automatic confidence decision.

A focused deslop/codebase-design review keeps native change compilation in TagReconciliation, confidence and report decisions in AssignmentReview, selection in TagSelection, and provider calls, budgets and persistence in the controller. Tests use these interfaces, public controller actions and accessible manager controls.

## Isolated Zotero checks

All **185 native checks passed** in a separate profile and data directory. The new scenario uses three synthetic items and exercises the rendered manager: Keep defaults, complete-inventory preview without writes or AI, reviewed removal, restoration of exact native tags and locks, high/medium/low assignment review, Apply and Finish, delayed topic reporting, manually requested DIY comparison, initially unselected equivalent merges, native deduplication, identity redirects and complete merge undo. No real AI request is made.

The retained suite covers representative build/restart, missing-cache recovery, native navigator and Collections restoration, independent windows, title/PDF/note/annotation searches, item columns and right-hand panes, editor controls, notifications, metadata preview/apply/undo, manual-choice protection and incoming-assignment gates. A local PDF is extracted only in the isolated directory.

The exact production **0.9.0** package was installed over a disabled **0.8.1** package through Zotero's AddonManager without uninstalling. Stable identity, saved state, native tags, columns, HTTPS update metadata and installer hash passed. Remote Zotero update-feed discovery was not exercised before publication.

## Private retained-work replay

A private compatibility replay upgrades a read-only copy of the retained **744-paper** work to schema 8. Its one evicted factual cache entry is recovered only after locally verifying the saved PDF input; the other 751 cached facts remain unchanged. Original quotations, source identities, provider provenance, selected snapshots, old chooser replies, checkpoints, definitions, manual choices, native data and spending remain intact.

The retained faster-build schedule still uses **180 example pairs in three simulated checking requests**, at most two concurrently, with a largest payload of **78,839 UTF-8 bytes**. The other **5,832 sources remain unexamined**. It makes no new chooser or extraction request, native write or live provider call. The copied input bytes are unchanged, and the working profile/run is neither written nor interrupted.

These simulations validate scheduling, accounting, preservation and recovery. They do not measure live-provider latency or scientific recommendation quality.

## Artifacts and limits

Embedded bundle sources match the delivered TypeScript; production JavaScript/CSS match the package used in native validation. Installer and source archives are scanned for private titles and item IDs and exclude build fixtures, databases, profiles, state files and credentials. Only aggregate replay results are published.

Native controls are checked programmatically; no screenshot review or real-account sign-in is claimed. Factual extraction, terminology and source-validation policy 3 remain unchanged, and representative planner 4 remains in use. Incoming automation stays explicitly controlled by the researcher.
