# Workspace storage and responsiveness

This document describes the 1.1.x schema-14 implementation and its release gates. Version 1.0.7 uses schema 13. The validation status below records the original workspace rollout; [VALIDATION.md](../VALIDATION.md) describes the current patch release.

## Application interface

Pages use one application interface, defined in [`src/workspace-contract.ts`](../src/workspace-contract.ts):

```ts
interface Workspace {
  execute(command, {commandId, signal?}): Promise<CommandReceipt>;
  watch(query, receive, {signal}): () => void;
  close(reason: 'disable' | 'shutdown'): Promise<void>;
}
```

A command describes a user action. Its receipt identifies a durable result or queued task. Stable command identities prevent duplicate execution after retries. Record-version checks belong to the affected command; unrelated record changes do not invalidate an edit. Internal record updates do not create permanent random command receipts.

Unchanged payloads, relationships and search indexes retain their record versions during background refreshes. A generated modification timestamp alone does not invalidate an edit. Actual changes to source data, reference sets, matching metadata or native version hints remain observable.

A query names a page, its filters and a cursor. The initial loading event precedes bounded ready/error events. A page receives at most 50 primary rows and a 256 KiB model; requested details are separate from its primary pagination. Search input is echoed immediately, queried after 100 ms and cancelled when superseded. Progress is coalesced to at most four updates per second. The page shell, editors, focus and scroll containers remain mounted during updates.

`close` stops scheduling and view subscriptions. Idle close does not load history, serialize the workspace or run maintenance. Active close drains necessary durable checkpoints and the current native-write chunk. The private scientific kernel currently reuses domain logic from `AppController` inside the worker with command-specific working records. The public UI does not call the old whole-workspace snapshot or persistence interface.

## Workers and native adapters

A processing worker owns scientific work, parsing, hashes, compression, storage records, journals and retention. A separate reader worker serves page projections so background scientific computation does not monopolize page queries. Both use Mozilla's `BasePromiseWorker` protocol. Provider and Zotero access are injected; credentials remain in the existing protected credential store.

[`NativeSqlPort`](../src/workspace/native-sql.ts) uses Mozilla's [asynchronous SQLite module](https://searchfox.org/firefox-main/source/toolkit/modules/Sqlite.sys.mjs). Its native reader connection is opened read-only after migration activates. Main-thread JavaScript handles bounded rows and yields after four milliseconds of plugin computation. Native Zotero calls and operating-system waits are measured separately. SQL bindings, quoted identifiers, comments and top-level CTE projections have deterministic contract tests.

The host enumerates item identities in pages of 50 and hydrates individual records. Large titles, abstracts and keyword lists use short-lived, bounded field leases; normalization and scientific fingerprints run in the worker. PDF access transfers cache-file paths and reads text in worker chunks. Native input inspection never retrieves `attachmentText` as one main-thread string. At most two paper leases and two bulk SQL transfers may be active. Each worker admits one SQL transfer before copying a payload; the shared native adapter also has two credits. This bounds buffers waiting for dispatch as well as active operations. Transaction commit/rollback control messages bypass those credits. The decoded payload cache budget is 32 MiB across the processing and reader workers: 24 MiB for processing and 8 MiB for queries.

Background library catch-up uses native item identities and version hints. A partial SQLite index locates a deleted native item without hydrating paper bodies. Removing it from current search/index rows preserves immutable evidence and history. The workspace reports indexing progress while a fresh library is still being read.

## Records and immutable payloads

The plugin owns `smart-tags/workspace.sqlite` inside the Zotero profile, separate from Zotero's library database. `smart-tags/state.json` contains only the schema-14 locator and generation identity.

Records use collection/item identities and small indexed metadata: names, status, task, order, dates and relationships. Full search text is separate from scan metadata, in chunks of at most 16,384 UTF-16 units with 511 units of overlap. Searches accept up to 512 characters and can match across chunk boundaries. Metadata-only reference updates preserve this index; migration copies it inside SQLite without transferring full text. Views obtain counts and bounded index rows without decoding historical bodies. Paper previews traverse field tokens and read text prefixes; opening Find papers does not hydrate complete PDF text.

Immutable JSON graphs hold large data. Arrays and objects reference child values, and long strings have manifests of bounded fragments. Literal strings and containers up to 2 KiB remain inside their parent; a container can be inline only when all its children are literals. Every standalone record owns a hashed chunk, and a single leaf does not gain a redundant manifest. Reading inline data returns an independent value. String fragments are canonical across different incoming stream boundaries, preserving reuse after migration. Uncompressed chunks and ordered manifests use SHA-256; gzip is retained only when it saves bytes. Every encoded chunk is at most 64 KiB. SQLite edges and record roots use compact integer payload identities; immutable manifests retain their content hashes. Shared source versions, exact paid replies, evidence and definition versions are stored once and referenced by tasks or history. JSON string encoding preserves original UTF-16, including lone surrogates. Storage hashes do not replace scientific source/meaning fingerprints or paid request identities.

Encoding and immutable-node staging happen before the final record transaction. Each bounded staging batch has a short transaction, avoiding one durable disk sync per node. The final transaction atomically publishes record roots, relationships, version guards and any explicit command receipt. Failure rolls back visible changes. Unreferenced staged payloads are eligible for later collection. New databases choose 4 KiB pages before WAL and incremental-vacuum initialization; existing page sizes are preserved. SQLite uses full durability and bounded incremental page reclamation; routine use and shutdown do not run full-database compaction.

## Provider and native-write recovery

Budget reservations are persisted before dispatch. Replies are stored before their results can authorize changes. A dispatched request with an unknown outcome pauses for explicit recovery rather than being sent again automatically. Compatible paid replies and completed checks survive pause/restart.

Native tag and metadata changes have a durable journal before writing. Each native frame contains at most 20 papers, revalidated immediately before application. Completed chunks receive durable acknowledgements and retain one logical Undo group. Recovery compares the recorded before/after values and preserves external edits. Undo keeps automatic-reapplication suppression after the old reversal details expire.

Automatic definitions and assignments retain their captured policies, source/meaning identities, manual protections and scientific checks. Narrow-shelf results do not establish whole-library exclusion. Deferred choices remain distinct from remembered rejection and do not expire simply because their task finished processing.

## Seven-day retention

| Data | Rule |
| --- | --- |
| Current definitions and supporting evidence | Protected while referenced by current definitions. |
| Open/deferred choices, interrupted tasks and recovery | Protected until their required context is resolved. |
| Completed task bodies and Undo details | Eligible seven days after completion. |
| Unused AI cache results | Eligible seven days after their last actual reuse. Viewing a page does not refresh this date. |
| Unknown legacy timestamps | Receive a seven-day grace period from migration. |
| Ownership, remembered decisions, admission markers and automatic suppression | Keep compact records after old diagnostic/Undo bodies expire. |
| Registered migration backup | Eligible only after seven days, two verified restarts and no outstanding recovery. |

Collection follows references from protected records. A shared payload is retained while any live record requires it. Migration staging has an explicit lease so collection cannot remove incomplete imported graphs. Expiry and garbage collection run in bounded, cancellable idle batches and recheck references inside transactions. Cleanup does not run during idle shutdown.

New persisted data needs an owner, a live reader, a retention rule and a growth test. Repeating identical work should reuse payload bytes. Internal progress/index updates should not grow an unbounded command ledger. Genuinely new source content consumes storage; that growth must remain distinguishable from duplicated diagnostics.

## Migration and backup

The worker streams legacy schemas 1–13 using bounded file buffers and JSON tokens. It creates staged normalized records and validates their structures, references and scientific identities. It preserves paper/tag IDs, source/meaning fingerprints, paid scopes and responses, captured task policies, answers, admissions and suppression records. Migration makes no provider request, definition admission or native library write.

An exact-byte backup uses `state.json.pre-v14.json`; differing existing bytes receive a collision-safe numbered name. The original authoritative generation remains available until staged validation and backup verification succeed. Atomic locator activation selects schema 14. If interrupted, startup resumes or discards the staged generation without accepting a partially imported workspace. Older extensions must refuse to overwrite the newer locator.

Backup deletion applies only to the registered migration backup after its age, verified-restart and recovery checks pass. An arbitrary similarly named file is not a cleanup target. Current definitions and unresolved work remain protected after migration retention is applied.

## Size counters

Settings → Data reads stored counters, without serializing all saved work. Active data includes compact ledgers; history and cache sizes describe their logical records. Shared content can be attributed to multiple categories, so adding those categories does not give the physical database size.

The stored-payload counter reports unique compressed payload bytes. Settings requests SQLite's page count and page size to show the database size, including indexes and free pages, without decoding records. Temporary WAL/journal bytes are separate; the native harness also measures actual files. Migration backup bytes remain separate. The decoded-cache counter measures resident decoded payload bytes, not a JavaScript heap estimate. The supplied archive's release gate is an active database of at most 50 MiB after deduplication/compression, excluding its temporary migration backup.

## Validation and release gates

Run the source checks and full regressions without generating release artifacts:

```powershell
npm run check
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
npm test
node scripts/build.mjs --check
```

`--check` bundles the application, processing worker and reader worker with esbuild `write: false`. The SQLite tests use actual SQL semantics through a deterministic Node adapter. Coverage includes transactional failure, shared payloads, corruption, cancellation, command identity, source/version changes, seven-day expiry, migration activation and native/provider recovery boundaries.

The isolated native harness is prepared from an existing preview build. It uses marker-verified profile and data directories within this repository, with automatic syncing disabled. It must never point at the working Zotero profile.

```powershell
node scripts/build.mjs --preview
node --experimental-strip-types scripts/prepare-workspace-native.mjs --small
powershell -File scripts/run-workspace-native.ps1 -Case small -Theme light
```

Use `--dark` when preparing a dark profile. The synthetic case contains 10,000 papers and thousands of tags; the archive case reads only the copied fixture under `build/private-native-save/state.json`. Reports belong under `build/`. Include long PDFs, repeated and genuinely unique content, keyboard interaction, both themes, cancellation and recovery. Preparing a preview does not update release artifacts or publish a release.

Release requires measured evidence on the documented Windows/Zotero test machine:

- No plugin-attributable main-thread task of 50 ms or longer; routine slices target 4 ms.
- Input response p95 below 50 ms and p99 below 100 ms.
- Warm first-page queries and idle disable p95 below 250 ms.
- Page payloads remain at most 50 primary rows/256 KiB, decoded payloads at most 32 MiB, bulk transfers at most two and native frames at most 20 papers as archives grow.
- The copied fixture's active database is at most 50 MiB, excluding its migration backup.

Report native Zotero and operating-system stalls separately. Passing Node tests or an in-memory bundle alone does not establish these native latency gates. The harness does not publish releases or modify the working library.

## Validation status

The isolated test machine runs Windows 11 Pro build 26300, an Intel i5-13400F and 40 GiB RAM, with Zotero 10.0.7 / Gecko 140.17.0. Controlled native tests use software graphics and separate profile and data directories. Final dark-mode measurements on 2 November 2026 were:

| Case | Input p95 / p99 | Warm page query p95 | Idle disable | Maximum measured plugin page slice |
| --- | --- | --- | --- | --- |
| Copied archive | 12.16 / 13.60 ms | 61 ms | 23 ms | 20.39 ms |
| 10,000 papers / 2,000 definitions | 14.42 / 15.22 ms | 75 ms | 27 ms | 15.73 ms |

A fresh migration of the 152,976,903-byte legacy fixture produced a 49,614,848-byte database (**47.3 MiB**) after bounded idle reclamation, excluding its exact temporary backup. Migration took 206.6 seconds and reclamation another 37.4 seconds. Reclamation input-to-paint samples were p95 0.39 ms / p99 0.57 ms; the subsequent search test was p95 15.9 ms / p99 19.1 ms. The worker emitted progress throughout migration.

Both TypeScript checks, the full regression suite and the three-entry in-memory bundle passed. The isolated workflow reversed eleven automatic paper changes in one Undo after restart and stopped an unknown request with actual keyboard input, without real provider network requests. The exact XPI passed archive-resource, installation, disable/re-enable and rapid-toggle checks; its final full shutdown took 32 ms. An additional archive run with native graphics passed input p95 12.25 ms / p99 33.81 ms. Reports under `build/` contain the native measurements; [VALIDATION.md](../VALIDATION.md) contains the public aggregate report.
