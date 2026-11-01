# v1.0.1 validation

Target: Zotero 10.0.6 on Windows. Release artifacts, hashes and aggregate results are recorded in [dist/validation.json](dist/validation.json).

## Automated verification

- **1,100 automated tests passed**, including **128 manager UI tests**, with zero failures, cancellations or skips.
- Standard TypeScript checking and the stricter unused-local/unused-parameter check passed.
- In-memory production bundling passed. `npm run verify` also passed, including the production XPI build.

The suite covers domain rules, public controller actions, persistence and rendered manager controls. New regressions exercise preserved Find papers searches and tag selections, keyboard and focus behavior, complete Activity history, exact task destinations, settings drafts and validation, and recovery of cached native-meaning replies.

The production XPI contains 11 files matching the built add-on, with the 1.0.1 manifest, stable extension identity, supported Zotero range and versioned manager resources verified. Its update metadata and SHA-256 match the package. The installable package excludes the native-test bootstrap and private paths. A credential-pattern scan passed for 143 allowed source files. The source archive is built and checked separately from the XPI.

## Native interface checks

The isolated automatic-workflow scenario passed **79 checks in light mode and 79 in dark mode**, with zero errors. Both runs loaded the actual **1.0.1 production build**, including its versioned stylesheet and loader. The scenario uses synthetic papers and mocked provider/native-write adapters in a separate Zotero profile and data directory, with zero real provider requests.

Checks exercise actual pointer and keyboard controls for:

- Separate Build tags, Tag library and Assign tags pages; automatic clear assignments and meanings; deferred choices; exact task Undo and cached reruns.
- Find papers text and tag filters, live result focus, Clear search, and related papers that close with Escape and restore trigger focus.
- Activity recovery, collapsed history and reachable Undo, accurate source progress, direct Resume, and one inbox choice without a duplicate task card.
- Settings disclosures, unsaved drafts, Control+S, discard, inline validation and reachable Save/Discard controls in a narrow window; connection settings retain the selected model.
- Editor Enter, Control+Enter and Escape, retained drafts, reachable save/close controls, preserved Zotero collections and item columns.

**50 screenshots** (25 per theme) and native bounds/hit tests cover wide **1266 × 862** and narrow **806 × 582** content sizes, including Find papers, Activity, Settings and the meaning-recovery exception.

## Cached meaning recovery

The 17-source Batteries regression starts with 16 accepted source judgments and a saved failed reply. Resume revalidates that reply locally, recovers the seventeenth judgment and preserves the earlier judgments, paid attempts and spending. A remaining scientific distinction stays an explicit question; the contradicted meaning is not offered again. Changed meanings, foreign targets, duplicate echoes, stale source fingerprints and unsupported evidence remain rejected.

A read-only replay of the reported working state retained the 16 prior judgments, completed all 17 source judgments and left one scientific exception. It made **zero new provider requests and zero native writes**; the original working-state bytes remained unchanged.

## Workflow and migration protections

Existing regressions continue to cover atomic automatic definition admission, protected saved meanings and dependencies, scoped assignment caching, preserved deferred choices and exact task Undo. Later manual edits and identical automatic replay after Undo remain protected. Incoming tagging requires explicit opt-in and respects matching modes, locks, rejections and exclusions. An omitted model result is not treated as a negative scientific judgment.

The state schema remains **12**. Migration tests preserve exact source bytes in collision-safe pre-v12 backups, retain historical backups and paid work, reject corrupt new fields, stop on backup/write failure and refuse downgrade writes. Older unfinished work does not acquire automatic-processing policies or retroactive approvals. Proof identities and source-validation requirements remain enforced.

## Verification limits

These results validate the tested Windows/Zotero target, synthetic native workflows and local recovery of the reported cached state. They do not establish live provider availability or scientific classification accuracy. The historical 259-check native suite is not reported as a fresh 1.0.1 run. Remote update-feed discovery and an in-place installer upgrade require separate verification.
