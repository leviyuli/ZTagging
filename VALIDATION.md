# v1.2.0 validation

Validation for the v1.2.0 AI-built workflow. Tested on 2026-11-03 with Zotero 10.0.7 / Gecko 140.17.0, Windows 11 Pro, Intel i5-13400F and approximately 40 GiB RAM.

## Automated checks

- Both TypeScript checks passed, including unused locals and parameters.
- **1,474 regression tests passed**, with no failures, skips or cancellations.
- All three production entry points bundled in memory with write: false.
- The final source diff has no whitespace errors.

New coverage exercises migrated empty evidence headers through Workspace commands, exact saved results, repeated-build reuse, completion only after durable admission, queued progress, atomic retry/retention writes, cancellation, cold paused-run recovery, stopped requests, explicit assignment subsets, saved filters and validated scientific search matches.

Migration tests retain scientific vectors and exact paid scopes. They cover origin-map import, tracked AI edits versus untracked replacements, native reuse of an AI identity, retirement markers, protected journals, compatible facts, source-policy invalidation, shared evidence, seven-day retention and interrupted transitions. Native labels cannot become scientific keywords or inferred matches.

## Isolated Zotero workflows

Both light and dark workflow runs passed. A controlled provider fixture builds and saves a supported tag from three papers without a meaning-review step. Assignment applies eleven clear results while leaving one uncertain paper optional. Repeating and restarting reuse paid replies; Undo survives restart and prevents immediate reapplication. Unknown outcomes are not resent automatically, and keyboard activation can stop recovery safely.

Actual rendered Build, Tag library, Assign and Runs pages were inspected. The larger archive checks also cover Find papers, Settings, Escape-to-clear search, stable focused controls, page bounds and both themes.

## Responsiveness and storage

Measurements use native Windows graphics and marker-verified isolated profiles.

| Fixture | Input p95 / p99 | Warm query p95 | Idle disable p95 | Maximum plugin page callback |
| --- | --- | --- | --- | --- |
| 10,000 papers / 2,000 tags, light | 11.20 / 13.85 ms | 87 ms | 29 ms | 13.44 ms |
| Supplied archive copy, light | 8.41 / 8.58 ms | 67 ms | 25 ms | 4.75 ms |
| Supplied archive copy, dark | 8.53 / 8.71 ms | 65 ms | 28 ms | 4.64 ms |

All measured input, query, idle-disable and page-callback gates passed. Views stayed within fifty primary rows and 256 KiB; the decoded-payload cache stayed within 32 MiB. The active database for the supplied archive copy measured **47,972,352 bytes (45.75 MiB)**, excluding its temporary legacy backup.

The synthetic fixture's one-time cold JSON migration took **280.25 seconds**. The supplied archive's existing schema-14 copy took **27.48 seconds** for startup and the new policy transition. Background UI sampling remained responsive during those operations; these durations are separate from warm query and disable timings.

## Exact release package

The versioned v1.2.0 XPI passed Zotero AddonManager installation, archive-loaded workers and manager resources, disable/re-enable and rapid-toggle checks in the isolated profile. Its measured full disable lifecycle was **93 ms**. Installer/source validation verifies fourteen exact production files, matching package/manifest/lock versions, update-feed SHA-256, a reproducible source archive and exclusion of private/generated data.

## Isolation

Validation used copied workspace data, synthetic papers and a controlled provider that blocks real network requests. The working Zotero library and credentials were untouched. Release package checks are recorded in [dist/validation.json](dist/validation.json).

These measurements describe the documented machine and fixtures. Zotero-native calls and operating-system stalls remain separate from plugin computation.
