# v0.12.0 validation

Target: Zotero 10.0.6 on Windows. Exact artifact hashes and aggregate results are in [dist/validation.json](dist/validation.json).

## Shelves and meaning preparation

Shelf actions provides Rename and Merge. Merge replaces selected sources by default, deduplicates stable tag identities and preserves exact native-only names. If My tags is selected, its native inventory remains inside the combined shelf under the new name. Removed shelf IDs redirect to the combined shelf for future selections; existing assignment runs retain captured scopes. Shelf-only changes have atomic journals and conflict-aware Undo, including failed-save rollback without losing concurrent paper results.

Tag library supports All, Ready and Needs meaning views, selection across filtering and pages, linked-paper controls and one Prepare meanings action. AI results show original and proposed standard names, concise meanings and existing-definition matches. Clear rows save together; mixed, non-scientific or unsupported meanings remain unready. The review body scrolls independently and Save remains visible. Native paper tags, collections, attachments and metadata are unchanged by saving meanings.

NativeTagDefinition protocol 1 uses bounded requests of at most 16 tag/paper pairs and 90 KB, reduced for the response limit. Names and meanings freeze before checking additional papers. A global legacy alias requires a current, source-specific same-meaning judgment for every carrying paper with a non-keyword supporting passage. Validated cached factual IDs may supply evidence only on their own current paper. Co/CO, FC/subtype distinctions, scoped target IDs, standard names and authoritative saved meanings remain protected.

Paid requests, raw replies, provider/model provenance, stable allocations, dispatch counts and one format-correction allowance persist across pause and restart. Budget rejection before dispatch consumes no attempt; transport Resume retains its history; explicit retries send only unresolved contexts. Queued work refreshes its undispatched input after active analysis, preserving allocations and original run scope. Replaced paused tasks are retired without discarding their audit. Standalone names without papers require manual meanings and incur no AI request. Existing locks and rejections cannot be overridden by alias generation.

## Progress and migration

Progress strips appear only in Activity or the task's owning page. They are absent from unrelated pages and applied idle builds; Activity labels a saved build Tag list saved. Definition work uses Tag library as its owner and has its own usage/budget summary.

Schema 10 migration preserves cached extraction, source identities, quotations, proof policies, pending work, settings, credential references, decisions, spending and history. AtomicStore creates a collision-safe exact-byte pre-v10 backup before migration. BOM/CRLF bytes, occupied backups, backup/write failures, idempotent restart and older-schema downgrade refusal are covered. A paper-analysis reset archives pending meaning work and paid records before removing its reusable preparation.

## Verification

`npm run verify` passed TypeScript, **987 automated tests**, including **91 manager-interface tests**, and the production build. Tests cross module interfaces, public controller actions and rendered accessible controls. New cases cover shelf merge/restart/Undo/concurrent-save failure, bounded all-paper grounding, source-specific cached facts, standard naming, scientific distinctions, manual conflicts, budget/authentication pauses, settled-reply provenance after connection changes, stale-source recovery, reset audit and paused-task replacement.

All **236 packaged native checks passed** in an isolated profile and data directory. The new seven checks exercise the rendered Merge dialog, readiness selection, fake-provider Prepare meanings, independently scrolling review with visible Save, batch saving two grounded meanings while leaving a project label undefined, unchanged native data and Activity-only completed progress. Retained checks cover navigator/search restoration, assignment, metadata and Undo. Native AddonManager upgrades the exact package from disabled **0.11.1 to 0.12.0** without uninstalling, preserving stable identity and data.

## Private replay and artifacts

A read-only migration/replay of the retained library preserves all **95 cached facts**, paid run history, quotations, evidence IDs, settings, definitions, decisions and native data. Its **44 undefined names** produce **nine initial bounded requests**, with a largest payload of **64,863 bytes**; none is dispatched. Five generated shelves combine into **154 unique definitions**, with My tags and the unique library count preserved. The copied source file remains byte-identical, and the working profile is neither written nor interrupted.

Earlier 19/20/48/744-paper compatibility replays remain applicable; the 744-paper replay under schema 10 keeps its three representative checks, original paid replies and 5,832 unexamined findings without repeated extraction or live provider calls.

Production JavaScript/CSS, embedded TypeScript and delivered archives must match the native-tested bundle. Public artifacts exclude profiles, databases, private fixtures, state and credentials and are scanned against private titles and item IDs. Public reports contain aggregate results only; HTTPS update metadata and installer bytes are checked after publication.

Focused deslop/codebase-design review keeps shelf operations in TagShelves, provider-free definition planning and proof checks in NativeTagDefinition, and persistence, budgets, journals and native operations in the controller. Validation uses simulated AI responses and rendered controls, not live scientific-quality, account-authorization, latency or screenshot claims.
