# v0.5.0 validation

Target: Zotero 10.0.6 on Windows. Machine-readable results and installer/source hashes are in [dist/validation.json](dist/validation.json).

## Automated checks

`npm run verify` passed TypeScript checks, the complete test suite, and the production build. Coverage includes existing-tag comparison, mixed meanings, exact labels, manual conflicts, DIY creation, stale previews, interrupted journals, metadata preservation and undo, selective retries, cancellation races, migration, and bounded consolidation recovery.

Tests exercise the TagReconciliation, TagPreparation, paper recovery, and consolidation module interfaces. Persistence tests use public controller actions; manager tests use accessible controls. The release diff received the requested codebase-design and deslop review.

## Isolated Zotero checks

104 native checks passed in a separate profile and data directory. They cover the Smart Tags/Collections switch, native title/PDF/note/annotation searches, independent library windows, restoration and columns, editor scrolling, metadata preview/apply/undo, existing-tag previews, and paper recovery. The PDF checks use an actual locally extracted and indexed PDF.

Zotero's AddonManager upgraded a disabled 0.4.1 installation to the production 0.5.0 package without an uninstall. The extension ID, local state, library tags, and item columns were preserved. The HTTPS update manifest and installer SHA-256 hash were checked. Remote feed discovery was not exercised before publication.

The old package remained disabled throughout this test so its older code could not write schema-5 state. No plugin section was added to the item or information panes.

## Private replay

Read-only copies of the retained 744-paper build and historical 51-paper pilot migrated successfully to schema 5. Exact-byte backups, completed jobs, cached facts, original quotations, provenance, evidence IDs, settings, decisions, and history were retained.

The 744-paper consolidation replay organized 5,174 registry entries across 29 bounded parts and a final global step. Every request stayed below 100,000 UTF-8 bytes. Both replay cases recovered completed parts and returned replies across restarts without repeating extraction or accepting evidence from outside their selected papers.

Private replays used synthetic replies to test persistence and identity accounting. They did not assess scientific recommendation quality. They made no live provider requests or native library writes, and the working-profile bytes were unchanged.

## Scope of verification

Native interface checks were programmatic; screenshots were not visually reviewed. Metadata translators used controlled responses, so a live publisher may return fewer fields or omit an abstract. No real ChatGPT authorization or paid AI request was performed. Private library fixtures, profiles, credentials, and replay artifacts are excluded from public archives.
