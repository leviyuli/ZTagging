# v1.1.1 validation

Target: Zotero 10.0.7 / Gecko 140.17.0 on Windows 11 Pro build 26300, Intel i5-13400F, approximately 40 GiB RAM. Native checks use marker-verified isolated profiles and data directories. The working Zotero library and credentials were untouched.

Artifact hashes and aggregate results are recorded in [dist/validation.json](dist/validation.json). This patch retains storage schema **14** and native-definition protocol **2**.

## Automated checks

- The full regression suite passed **1,528 tests**, with no failures, skips or cancellations.
- Both TypeScript checks passed, including unused locals and parameters.
- All three production entry points bundled in memory with `write: false`.
- Installer/source checks verify exact production bytes, fourteen installer files, matching versions, the update hash, a source allowlist and reproducible source archives.

Focused regressions reproduce thirty-six saved meanings, two skipped meanings and six pending choices. The first meaning page contains those six choices; Later remains deferred and reachable. Tests cover exact archived-task routing, off-page details, bounded index backfill, cancellation and restart, manual/mixed versus imported-only native tags, aliases and personal labels.

Build-result tests cover saved names and counts, exact per-run membership, partial results, unchanged reuse, missing information, unavailable historical details, explicit replacement review, search within the run, and correction after Undo/deletion. Result projection is atomic; view reads and repeated projection do not reset seven-day expiry. Upgrade seeding reads bounded fields without decoding saved paid-response or proof archives.

The regression suite retains scientific checks, cache compatibility, write recovery, serial provider dispatch, grouped Undo, manual protections, seven-day retention and migration coverage from v1.1.0.

## Native UI checks

Both light and dark runs passed on an isolated copy of the large archive. The added checks verify that Activity opens visible pending meanings, the manual undefined shelf is reachable, a two-tag fixture has a persistent Build result, and View built tags returns exactly those two tags. Screenshots of the actual native window were inspected. The Build result uses an isolated display fixture; this check does not make a live AI request or claim scientific accuracy.

| Theme | Input p95 / p99 | Warm page query p95 | Idle disable p95 | Maximum measured plugin page callback |
| --- | --- | --- | --- | --- |
| Light | 28.22 / 33.01 ms | 130 ms | 38 ms | 31.96 ms |
| Dark | 24.19 / 31.54 ms | 145 ms | 47 ms | 33.43 ms |

Both runs met the measured input, query, shutdown and callback limits. Pages remain bounded to fifty primary rows and 256 KiB; the combined decoded-payload cache remains limited to 32 MiB. Controlled native UI tests use software graphics. These patch measurements are separate from v1.1.0's original fresh migration and 10,000-paper rollout benchmarks.

## Exact package checks

The exact **v1.1.1 XPI** passed Zotero AddonManager checks in the isolated profile: installation, archive-loaded workers and manager resources, full disable, re-enable and rapid disable/re-enable. Full lifecycle shutdown took **21 ms** in the final package run.

Source packaging excludes profiles, databases, saved state, credentials, generated build data and private reports. Native test injection is excluded from the installer. The source archive is checked byte-for-byte against its allowlisted source files.

## Limits

Measurements describe the documented machine and fixtures. Native Zotero calls, graphics and operating-system delays are separate from plugin computation. No live provider request or working-library operation was used for implementation validation. Remote Zotero update discovery is separate from verifying the published installer link and its SHA-256 update hash.
