# v0.5.2 validation

Target: Zotero 10.0.6 on Windows. Machine-readable results and installer/source hashes are in [dist/validation.json](dist/validation.json).

## Automated checks

`npm run verify` passed TypeScript checks, all 652 tests, and the production build. New manager regressions verify compact empty views, selection-only batch controls, action eligibility, selections cleared by search/status changes, keyboard navigation, popup-only scrolling, Escape/Tab, outside focus, and cleanup on refresh or destruction. Existing per-paper and batch actions still reach the same controller operations through their accessible menus.

The full suite retains coverage for consolidation recovery, budgets, authentication pauses, evidence identities, Dismiss and no_tag, manual choices, stale previews, metadata preservation, migration, and undo. Analysis, persistence, provider, and native-data modules were unchanged in this patch.

Tests exercise the TagReconciliation, TagPreparation, paper recovery, and consolidation module interfaces. Persistence tests use public controller actions; manager tests use accessible controls. The release diff received the requested codebase-design and deslop review.

## Isolated Zotero checks

129 native checks passed in a separate profile and data directory. New checks verify empty-state controls, selection-only actions, one recovery action per row, long-title containment, menu placement, keyboard focus, Escape restoration, and no provider calls. The full run also checks native title/PDF/note/annotation searches, independent windows, Collections restoration and columns, editor scrolling, metadata preview/apply/undo, Dismiss, exclusion, Include again, and standalone no_tag retrieval. The PDF checks use an actual locally extracted and indexed PDF; exact results are recorded in dist/validation.json.

Zotero's AddonManager installed the production 0.5.2 package over a disabled 0.5.1 installation without an uninstall, preserving the extension ID, local state, library tags, and item columns. The HTTPS update manifest and installer SHA-256 hash were checked. Remote feed discovery was not exercised before publication.

The old package remained disabled throughout this test so its older code could not write schema-5 state. No plugin section was added to the item or information panes.

## Retained backend validation

The prior 0.5.1 release replayed a read-only copy of the paused 744-paper state, including its failed model response. All 752 cached factual records, original quotations, provenance, evidence IDs, catalog, and selected snapshot stayed unchanged. That backend is unchanged in this interface-only patch; this release did not reopen the working profile or send a live AI request.

In that prior replay, the actual first response advanced locally to 1 of 29 completed parts without another provider request. Controller Resume reproduced all 744 cached inputs and requested the next part rather than resending that response.

Synthetic continuation exercised the remaining parts, two reduction steps, and the final global step within the 100,000-byte request limit. Original outputs and deferred-link history were retained, and unresolved final links required recorded decisions.

Those private replays tested persistence and identity accounting, not scientific recommendation quality, and made no live provider requests or native library writes.

## Scope of verification

Native interface checks used Zotero's rendered controls, focus state, and layout measurements. Desktop screenshot review was unavailable because the computer-use helper could not connect. No real ChatGPT authorization or paid AI request was performed. Private library fixtures, profiles, credentials, and replay artifacts are excluded from public archives.
