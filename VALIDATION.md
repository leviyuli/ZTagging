# v0.7.1 validation

Target: Zotero 10.0.6 on Windows. Installer/source hashes and machine-readable results are in [dist/validation.json](dist/validation.json).

## Automated checks

`npm run verify` passed TypeScript, all **757 tests**, and the production build. The 22 TagSelection tests and 19 large-library controller tests cover the v0.7 finite schedule, source-specific validation, DIY protection, bounded repairs, pause/restart, and the new saved-reply recovery paths.

New regressions verify that a broad generated tag cannot claim a protected DIY name as an alias, generated copies of DIY names stay deferred without merging meanings, method-reference case repair preserves Co/CO, and unestablished component subtype edges remain contextual. Resume and Retry recheck only complete saved replies locally; incomplete diagnostics remain ineligible. Recovery retains the original four chooser attempts, raw replies and errors, allocated IDs, repair counters, and spending. A failed local recheck changes no counters or state and does not send a request.

The smaller mapping transport contains full meanings and applicable matching guidance, while retaining original definitions and meaning fingerprints locally. Paper quotations and source identities are not shortened. Existing evidence, legacy fingerprints, manual choices, metadata, assignment/undo, navigator/search, and automation-gate tests remain in the full suite. A focused codebase-design/deslop review keeps preparation inside TagSelection's existing interface.

## Isolated Zotero checks

All **161 native checks passed** in a separate profile and data directory. The new synthetic case supplies a generated ohmic-resistance tag falsely claiming RCL as an alias, then confirms that the alias is withheld and the existing DIY definition remains byte-equivalent. The finite-mapping scenario still verifies two concurrent requests, serialized-state Resume, fixed unique-source totals, and completed-batch reuse.

The retained suite checks navigator/Collections restoration, independent windows, title/PDF/note/annotation search, unchanged columns and right-hand panes, editor controls, independent build and assignment groups, metadata preview/apply/undo, warning actions, no_tag, and manual protections. An actual local PDF is extracted and indexed only in the isolated directory.

The final 0.7.1 installer was installed over a disabled 0.7.0 package through Zotero's AddonManager without uninstalling. Stable identity, saved state, library tags, columns, HTTPS manifest metadata, and installer hash passed. Remote Zotero update-feed discovery was not exercised before publication.

## Private saved-reply recovery

A private read-only copy of the actual paused run contains 744 completed jobs, 752 cached factual records, 5,981 selected sources, and four completed but rejected chooser replies. The unedited saved reply recovers locally in the updated module, preserving its raw bytes, errors, dispatches, and counters. It creates a fixed 101-request mapping queue without another chooser request or factual extraction.

A full controller replay then finishes all 5,981 source outcomes using simulated mapping replies, at most two requests in flight, and requests below 90 KB. Original quotations, IDs, provenance, source catalog, legacy checkpoint, settings, definitions, decisions, history, native state, and spent budget remain unchanged. The original copied file remains byte-for-byte intact. The working profile/run is never written or interrupted.

For the retained frozen list, sending semantic tag fields reduces repeated tag data from 59,746 to 28,162 bytes and the initial mapping schedule from 215 to 101 requests. This is a deterministic payload/scheduling comparison, not a live-provider completion-time measurement. The replay makes no live AI requests or native writes; its synthetic classifications do not establish scientific recommendation quality.

## Artifact and verification scope

The bundle's embedded source files match the delivered TypeScript. Installer and source archives are scanned for private titles/IDs and excluded profiles, state files, credentials, and build fixtures. Only aggregate private-replay results are public.

Native controls were checked programmatically; no screenshot review or live account authorization was performed for this patch. Existing incoming automation settings stay under explicit user control. No factual-extractor, terminology, consolidation-protocol, source-validation-policy, or state-schema version changes are required by this patch.
