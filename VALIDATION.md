# v0.5.1 validation

Target: Zotero 10.0.6 on Windows. Machine-readable results and installer/source hashes are in [dist/validation.json](dist/validation.json).

## Automated checks

`npm run verify` passed TypeScript checks, all 649 tests, and the production build. Coverage includes existing-tag comparison, mixed meanings, exact labels, manual conflicts, DIY creation, stale previews, interrupted journals, metadata preservation and undo, selective retries, cancellation races, migration, and bounded consolidation recovery. New regressions cover saved-response recovery, single-attempt correction, persisted correction replies, budget and authentication pauses, Dismiss across restart and unchanged rechecks, reviewed exclusion/undo, queued retries after exclusion, and protected no_tag decisions.

Tests exercise the TagReconciliation, TagPreparation, paper recovery, and consolidation module interfaces. Persistence tests use public controller actions; manager tests use accessible controls. The release diff received the requested codebase-design and deslop review.

## Isolated Zotero checks

117 native checks passed in a separate profile and data directory. They cover the Smart Tags/Collections switch, native title/PDF/note/annotation searches, independent library windows, restoration and columns, editor scrolling, metadata preview/apply/undo, existing-tag previews, and paper recovery. New checks exercise Dismiss, changed-information recurrence, exclusion preview/Cancel/Apply/Undo, Include again, and standalone native no_tag retrieval. The PDF checks use an actual locally extracted and indexed PDF; exact results are recorded in dist/validation.json.

Zotero's AddonManager installed the production 0.5.1 package over a disabled 0.5.0 installation without an uninstall, preserving the extension ID, local state, library tags, and item columns. The HTTPS update manifest and installer SHA-256 hash were checked. Remote feed discovery was not exercised before publication.

The old package remained disabled throughout this test so its older code could not write schema-5 state. No plugin section was added to the item or information panes.

## Private replay

The existing 0.5.0 validation covered schema-5 migration of the 744-paper build and historical 51-paper pilot. This patch retains schema 5 and was replayed against a read-only copy of the actual paused 744-paper state, including its failed model response. All 752 cached factual records, original quotations, provenance, evidence IDs, catalog, and selected snapshot stayed unchanged.

The actual saved first response advanced locally to 1 of 29 completed parts without another provider request: all 157 input identities were accounted for, 152 candidates were retained, 55 routine relationships became contextual associations, and 4 out-of-batch links were retained for the global pass. Controller Resume reproduced all 744 cached inputs and requested the next part, rather than resending that response.

Synthetic continuation exercised the remaining parts, two reduction steps, and the final global step over 5,174 registry entries. Every request stayed below 100,000 UTF-8 bytes. Original outputs and deferred-link history were retained; unresolved final links required explicit recorded decisions. No evidence outside the selected snapshot was accepted.

Private replays used synthetic replies to test persistence and identity accounting. They did not assess scientific recommendation quality. They made no live provider requests or native library writes, and the working-profile bytes were unchanged.

## Scope of verification

Native interface checks were programmatic; screenshots were not visually reviewed. Metadata translators used controlled responses, so a live publisher may return fewer fields or omit an abstract. No real ChatGPT authorization or paid AI request was performed. Private library fixtures, profiles, credentials, and replay artifacts are excluded from public archives.
