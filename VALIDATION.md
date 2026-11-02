# v1.1.0 validation

Target: Zotero 10.0.7 / Gecko 140.17.0 on Windows 11 Pro build 26300, Intel i5-13400F, approximately 40 GiB RAM. All native runs used marker-verified, isolated profiles and data directories. The working Zotero library and credentials were untouched.

Artifact hashes and aggregate results are recorded in [dist/validation.json](dist/validation.json). Architecture and retention rules are described in [docs/workspace.md](docs/workspace.md).

## Source and recovery checks

- Both TypeScript checks passed, including unused locals and parameters.
- The full regression suite passed **1,499 tests**, with no failures, skips or cancellations.
- All three production entry points bundled in memory with `write: false`.
- Scientific vectors, automatic assignment policies, saved meanings, manual protections, migrations, fact recovery, native binding exclusions, keyboard focus, editor drafts and dropdown dismissal remain covered.

Workspace tests cover idempotent commands, durable queued inputs, frozen paper selection, provider reservations and unknown outcomes, retained paid bytes, native-write journals and chunk acknowledgements, failed writes, external native edits, cancellation, corruption and migration activation. Injected-clock tests cover seven-day expiry, referenced/shared payloads, unknown-date grace, open/deferred choices, completed projections and backup cleanup after two distinct process restarts.

A 100-paper assignment test completes 99 clear additions with one uncertain choice, serial requests and bounded native frames. A separate 25-paper run survives restart, uses one Undo group across 20+5 inverse writes, preserves manual tags and prevents immediate reapplication without new AI requests. Partial Undo recovery suppresses already reversed additions.

## Native workflow and package

The isolated workflow used synthetic papers and worker-local provider responses through the real provider parser. Eleven clear additions applied automatically; one uncertain paper did not block completion. Repeating the assignment reused replies without duplicate choices. One Undo reversed all eleven additions after restart and preserved manual tags. Gecko keyboard input stopped an unknown request in Activity without resending it or affecting completed work. No real provider network request was made.

The exact **v1.1.0 XPI** was installed through AddonManager. Its workers and manager loaded from archive resources. Disable, re-enable and immediate disable/re-enable passed after lifecycle serialization. Full plugin shutdown, measured through Zotero's lifecycle observer, took **32 ms** in the final package run. Source tests also cover failed shutdown and delayed host cleanup.

The installer contains exactly fourteen extension/license/bundle files. Source packaging verifies an explicit allowlist, exact source bytes, deterministic ZIP output, matching versions, production bundles and the update manifest's SHA-256 hash. Profiles, library data, databases, reports, credentials, build directories and native test injection are excluded from the installer.

## Responsiveness and storage

| Isolated case | Input p95 / p99 | Warm page query p95 | Idle disable p95 | Maximum measured plugin page callback |
| --- | --- | --- | --- | --- |
| Copied archive, dark / software graphics | 12.16 / 13.60 ms | 61 ms | 23 ms | 20.39 ms |
| Copied archive, light / native graphics | 12.25 / 33.81 ms | 61 ms | 28 ms | 16.43 ms |
| 10,000 papers / 2,000 definitions, dark | 14.42 / 15.22 ms | 75 ms | 27 ms | 15.73 ms |

All measured runs met the input, page-query, shutdown and page-callback limits. Each of the six main pages passed bounded-row/payload checks and layout checks. Search kept the same mounted input, and Escape cleared it. Light/dark screenshots were inspected. Controlled runs use software graphics; the archive also passed with native graphics enabled. The synthetic fixture includes an 8 MiB unique text body and both repeated and unique histories.

The **152,976,903-byte** legacy fixture migrated to a **49,614,848-byte database (47.3 MiB)** after incremental idle reclamation, below the 50 MiB target. Its exact temporary migration backup is separate. Fresh migration took about 206.6 seconds, followed by 37.4 seconds of bounded reclamation. Worker progress was reported throughout. During reclamation, sampled input-to-paint latency was p95 0.39 ms / p99 0.57 ms; the subsequent search test was p95 15.91 ms / p99 19.13 ms. Idle disable never waited for archive maintenance.

Settings size queries use counters and SQLite page metadata. Routine views remain limited to fifty primary rows and 256 KiB; the combined decoded-payload cache stays within 32 MiB. SQL bulk transfers are limited to two, and native-write frames to twenty papers. Current definitions, supporting evidence, unfinished choices and recovery are protected by references after old diagnostics expire.

## Scope of evidence

These measurements describe this machine and the tested fixtures. Native Zotero calls, graphics and operating-system stalls are separate from plugin computation. Synthetic provider replies verify workflow and recovery, not live scientific accuracy or account availability. Remote Zotero update-feed discovery was not exercised; the public installer link and its exact update hash are checked separately.
