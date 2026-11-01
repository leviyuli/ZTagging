# v1.0.2 validation

Target: Zotero 10.0.6 on Windows. Release artifacts, hashes and aggregate results are recorded in [dist/validation.json](dist/validation.json).

## Automated verification

- **1,102 automated tests passed**, including **128 manager UI tests** and **7 focused native-meaning recovery tests**, with zero failures, cancellations or skips.
- Standard TypeScript checking and the stricter unused-local/unused-parameter check passed.
- In-memory production bundling passed. `npm run verify` also passed, including the production XPI build.

The suite covers domain rules, public controller actions, persistence and rendered manager controls. The 1.0.2 regressions cover an explicit information question whose complete option repeats the frozen candidate, and independent admission of ready definitions from a saved preparation containing unrelated questions. Existing secondary-page, keyboard, validation, Undo and cached-reply regressions also pass.

The production XPI contains 11 files matching the built add-on, with the 1.0.2 manifest, stable extension identity, supported Zotero range and versioned manager resources verified. Its update metadata and SHA-256 match the package. The installable package excludes the native-test bootstrap and private paths. A credential-pattern scan passed for 143 allowed source files. The source archive is built and checked separately from the XPI.

## Native interface checks

The isolated automatic-workflow scenario passed **79 checks in light mode and 79 in dark mode**, with zero errors. Both runs loaded the actual **1.0.2 production build**, including its versioned stylesheet and loader. The scenario uses synthetic papers and mocked provider/native-write adapters in a separate Zotero profile and data directory, with zero real provider requests.

Checks exercise actual pointer and keyboard controls for:

- Separate Build tags, Tag library and Assign tags pages; automatic clear assignments and meanings; deferred choices; exact task Undo and cached reruns.
- Find papers text and tag filters, live result focus, Clear search, and related papers that close with Escape and restore trigger focus.
- Activity recovery, collapsed history and reachable Undo, accurate source progress, direct Resume, and one inbox choice without a duplicate task card.
- Settings disclosures, unsaved drafts, Control+S, discard, inline validation and reachable Save/Discard controls in a narrow window; connection settings retain the selected model.
- Editor Enter, Control+Enter and Escape, retained drafts, reachable save/close controls, preserved Zotero collections and item columns.

**50 screenshots** (25 per theme) and native bounds/hit tests cover wide **1266 × 862** and narrow **806 × 582** content sizes, including Find papers, Activity, Settings and the meaning-recovery exception.

## Admission hotfix and cached recovery

An explicit information question may retain provenance identifying an option as the exact frozen candidate. It remains a question. Choosing that option still requires missing source checks; it does not approve unsupported judgments. Exact definition/source fingerprints, scientific contradiction checks and protected-target guards remain enforced. No fallback option is generated for an information question that supplied none.

The synthetic controller regression contains **44 native names, 283 papers, 386 name/paper pairs and 205 accepted judgments**, with **15 ready definitions and 29 questions**. The saved state loads unchanged from its current file without falling back to `.bak`. Resume admits the 15 ready definitions while retaining all 29 questions, the complete frozen work, question identities, paid attempts and spending. It makes **zero new provider requests and zero native writes**.

An in-memory Resume of an immutable copy of the reported actual state also admits 15 definitions with zero new provider requests or native writes. The frozen work is unchanged, and the current state loads without backup fallback. The original working-state bytes remain unchanged. The 44-meaning case is covered by controller tests and this copied-state replay; the native scenario exercises the separate 17-source recovery path below.

The 17-source Batteries regression starts with 16 accepted source judgments and a saved failed reply. Resume revalidates that reply locally, recovers the seventeenth judgment and preserves the earlier judgments, paid attempts and spending. A remaining scientific distinction stays an explicit question; the contradicted meaning is not offered again. Changed meanings, foreign targets, duplicate echoes, stale source fingerprints and unsupported evidence remain rejected.

## Workflow and migration protections

Existing regressions continue to cover atomic automatic definition admission, protected saved meanings and dependencies, scoped assignment caching, preserved deferred choices and exact task Undo. Later manual edits and identical automatic replay after Undo remain protected. Incoming tagging requires explicit opt-in and respects matching modes, locks, rejections and exclusions. An omitted model result is not treated as a negative scientific judgment.

The state schema remains **12** and native-meaning protocol remains **2**. This hotfix preserves the existing requirement that every paper carrying a native name support its proposed global meaning/alias before admission. Migration tests preserve exact source bytes in collision-safe pre-v12 backups, retain historical backups and paid work, reject corrupt new fields, stop on backup/write failure and refuse downgrade writes. Older unfinished work does not acquire automatic-processing policies or retroactive approvals. Proof identities and source-validation requirements remain enforced.

## Verification limits

These results validate the tested Windows/Zotero target, synthetic native workflows and local recovery of copied cached state. They do not establish live provider availability or scientific classification accuracy. The original library is unchanged by the replay. The historical 259-check native suite is not reported as a fresh 1.0.2 run. Remote update-feed discovery and an in-place installer upgrade require separate verification.
