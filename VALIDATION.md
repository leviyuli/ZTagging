# v0.8.0 validation

Target: Zotero 10.0.6 on Windows. Installer/source hashes and machine-readable results are in [dist/validation.json](dist/validation.json).

## Automated checks

`npm run verify` passed TypeScript, all **786 tests**, and the production build.

Module and public-controller regressions cover representative selection, dominant-field ranking, three distinct papers per tag, explicit pair judgments, supported parents, unsupported generated-tag deferral, genuine ambiguity, protected edits and DIY definitions, and unchanged reruns. Existing Co/CO, scientific notation, FC/AEMFC/PEMFC, source fingerprints, remembered decisions, rejection, manual ownership, native assignment and undo tests remain in the suite.

Representative checks require each requested tag/source pair to receive its own judgment. Valid sibling judgments survive malformed rows, the correction round requests only unresolved pairs, and explicit technical Retry retains completed checks and paid history. Compatible positive and negative pair decisions are reusable; a historical source-wide outside-core result cannot reject a newly selected tag. Unsampled findings stay unexamined.

Controller tests cover paused and active older builds, waiting for active replies without aborting them, durable switch requests across restart, budget rejection before dispatch, preserving raw replies and charges, and Apply saving definitions without starting paper assignment. Schema-7 migration tests use synthetic 744-job/752-fact state and cover exact-byte backups, collisions, failure recovery, idempotence, and refusing schema downgrade. Migration makes no model or native-library requests.

Manager tests exercise accessible controls, representative progress, verified-example labels, background edit preservation, independent scrolling, fixed Save/Cancel controls, notification dismissal, and the separate assignment workflow. A focused deslop/codebase-design review keeps scheduling and judgments inside the existing TagSelection interface, with controller persistence and provider operations outside it.

## Isolated Zotero checks

All **173 native checks passed** in a separate profile and data directory. The suite exercises **Use faster build** through the rendered manager, waits for two active legacy replies, archives old work, persists completed representative checks, resumes without repeating them, and finishes a synthetic 60-tag list. Fresh builds also use representative planner 4 by default, reuse cached facts, and preserve incoming-automation settings. Apply saves definitions only.

Retained checks cover navigator/Collections restoration, independent windows, title/PDF/note/annotation search, unchanged columns and right-hand panes, editor controls, independent build and assignment groups, metadata preview/apply/undo, warning actions, no_tag, and manual protections. A local PDF is extracted and indexed only in the isolated directory.

The production 0.8.0 package is installed over a disabled 0.7.1 package through Zotero's AddonManager without uninstalling. Checks compare stable identity, saved state, native tags, columns, HTTPS update metadata, and installer hash. Remote Zotero update-feed discovery is not exercised before publication.

## Private retained-work replay

A read-only copy of the actual paused build contains **744 completed paper jobs**, **752 cached factual records**, **5,981 selected sources**, and four paid chooser replies. The controller switches the saved draft locally to a soft target of 60 tags without another chooser or factual extraction. Candidate IDs, original quotations, provenance, selected snapshot, historical checkpoints, definitions, decisions, ownership, native data, and prior spending remain intact.

The fixed representative schedule contains **180 tag/source pairs in three checking requests**, with at most two requests in flight and a maximum payload of **78,839 UTF-8 bytes**. It samples 149 unique sources; the other **5,832 remain unexamined**. Completion no longer depends on classifying every finding. The exact copied input file is unchanged, and the working profile/run is neither written nor interrupted.

The replay completes with simulated judgments and no live provider request or native write. These measurements establish request count, payload bounds, state preservation and finite completion; they do not measure live-provider latency or scientific recommendation quality. Different quotation sizes, response limits or unresolved judgments can require more requests.

## Artifacts and limits

The installer bundle's embedded sources match the delivered TypeScript, and its JavaScript/CSS match the package used for native validation. Installer and source archives are scanned for private paper titles/IDs, profiles, state files, credential files, and build fixtures. Only aggregate replay results are published.

Native controls are checked programmatically; no screenshot review or real-account sign-in is claimed. Factual extraction, terminology and source-validation policy 3 remain unchanged. New proposals use planner 4 and representative verification; historical proposals retain their existing policies.
