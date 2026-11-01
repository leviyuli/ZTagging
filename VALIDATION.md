# v1.0.0 validation

Target: Zotero 10.0.6 on Windows. Release artifacts, hashes and aggregate results are recorded in [dist/validation.json](dist/validation.json).

## Automated verification

- **1,084 automated tests passed**, with zero failures, cancellations or skips.
- Standard TypeScript checking and the stricter unused-local/unused-parameter check passed.
- In-memory production bundling passed. `npm run verify` also passed, including the production XPI build.

The tests cover domain rules, public controller actions, persistence and rendered manager controls. New regressions exercise automatic definition admission, adaptive vocabulary limits, scoped assignment caching, nonblocking exceptions, exact task Undo, migration and restart recovery.

The production XPI contains 11 files matching the built add-on, with the 1.0.0 manifest, stable extension identity, supported Zotero range and versioned manager resources verified. The installable package excludes the native-test bootstrap. A credential-pattern scan passed for 142 allowed source files; the source archive is built and checked separately from the XPI.

## Workflow and data protections

Clear generated definitions save while unrelated questions remain open. Required unresolved parents hold their children; protected saved names and meanings remain unchanged. Definitions, exact evidence scopes, shelves and admission history persist together. Failed persistence leaves no partial admission, and restart reuses completed work without another model request. Optional related links publish only when both meanings are available and the earlier saved definition remains unchanged.

New assignments apply validated high-confidence additions while uncertain matches, removals and no_tag remain explicit choices. Later preserves a deferred choice without permanent rejection. Repeated identical assignments retain the same exception identity; accepting or rejecting the latest explicit result resolves it without reopening historical pending copies. Changed inputs or meanings create a new current choice. An omitted tag is not treated as a negative judgment.

Assignment response reuse requires matching supplied content, definition scope, provider and model. Compatible cached facts and available local PDF evidence seed the first request. Changed definitions, source excerpts or scope invalidate reuse; unrelated vocabulary changes can retain an unchanged selected-shelf response. A reply completed after pause remains recoverable without another paid dispatch.

Undo uses the latest applied change owned by that task, excluding undo journals and unrelated global changes. Tests cover later manual-edit conflicts, preserved manual native tags and suppression of identical automatic replay after Undo. Incoming tagging remains an explicit opt-in and respects per-tag matching modes, locks, rejections and exclusions.

## Native interface checks

The isolated automatic-workflow scenario passed **46 checks in light mode and 46 in dark mode**, with zero errors. Both runs loaded the actual **1.0.0 production build**, including its versioned stylesheet and loader. The scenario uses synthetic papers and mocked provider replies in a separate Zotero profile and data directory. Checks exercise actual pointer and keyboard controls for:

- Separate Build tags, Tag library and Assign tags pages; collapsed optional controls; preserved Zotero collections and item columns.
- Automatic clear assignments, deferred/reopened choices, task Undo, cached reruns and correction of one paper without changing another.
- Automatic native-name meaning saves, a single model control, and Save and test using the selected connection/model.
- Enter, Control+Enter and Escape in the editor; retained drafts; reachable save/close controls and sidebar navigation.

**20 screenshots** cover Build tags, Tag library, assignment, connection and the editor in both themes at wide **1266 × 862** and narrow **806 × 582** content sizes. Native bounds checks confirm viewport fit and reachable primary actions.

## Migration and verification limits

Schema 12 migration tests preserve exact source bytes in collision-safe pre-v12 backups, retain historical backups and paid work, reject corrupt new fields, stop on backup/write failure and refuse downgrade writes. Older unfinished work does not acquire automatic-processing policies or retroactive approvals. Existing proof identities and source-validation requirements remain enforced.

These results validate synthetic workflows and the tested Windows/Zotero target. They do not establish live provider availability or scientific classification accuracy. Current native runs make zero real provider requests and do not access a working library. Earlier private replays and the historical 259-check native suite are not reported as fresh v1.0.0 runs; remote update-feed discovery and an in-place installer upgrade require separate verification.
