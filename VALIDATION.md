# v0.11.0 validation

Target: Zotero 10.0.6 on Windows. Exact installer/source hashes and aggregate results are in [dist/validation.json](dist/validation.json).

## Navigation and library

Navigator selection, expansion and background refresh preserve scroll position, focused controls and the search caret. Tree and search positions are separate; clearing search and switching through Collections restore the appropriate view. Tests cover independent library windows and unchanged item columns.

Existing tags is folded into My tags without renaming or deleting native assignments. All tags counts the unique union of saved definitions and exact undefined native names; My tags combines explicit membership with the native inventory. Approved aliases share a canonical row and unique-paper count. Generated shelves retain their membership and names; shelves can overlap and their totals are not additive. Assignment uses only definitions with meanings. Legacy shelf selections resolve to My tags while paid run scopes and tag IDs remain unchanged.

The controller materializes native labels once per snapshot and reuses them for counts and shelf rows, including when no approved definitions exist. Existing large-library performance regressions pass without increasing raw-native reads with the number of definitions or shelves.

## Extension recovery and topics

Update and apply compares prepared additions against the current saved definitions. Deleted saved tags are not restored; edited meanings, researcher-created tags, IDs and matching settings remain authoritative. Original preparation and paid work are archived before revision. Compatible exact-source checks are reused, while invalid derived matches cannot supply coverage. Pending checks remain on Build tags; successful Apply opens the independent assignment setup. Native assignment still requires a separate reviewed Apply.

New requests prefer precise imported keyword labels. The chooser receives bounded labels only from validated keyword quotations in its current snapshot. Manual project tags and invented keyword provenance are excluded. Cached extraction, original quotations, source IDs, normalization versions and historical proof fingerprints remain unchanged.

Completed topic reports group explicit DRT full-name variants without rewriting individual topic records. Bare ambiguous acronyms, chemical symbols and compound cathode/water-starvation topics remain distinct. Applying definitions alone does not resolve an uncovered topic; successful reassignment is still required. Normal report rows show names, paper counts and links rather than repeated explanations.

## Automated and isolated checks

`npm run verify` passed TypeScript, **938 automated tests**, including **85 manager-interface tests**, and the production build. Tests cross module interfaces, public controller actions and accessible controls. Obsolete assertions were replaced with the new behavior while preserving stale-source, manual-choice, migration, budget, cancellation and undo checks.

All **228 packaged native checks passed**, exercising navigator scroll and focus in a separate Zotero window, unified library rows, keyword provenance, DRT grouping, and Update and apply after saved-tag rename/deletion. Retained checks cover search, restoration, shelves, assignment, metadata and undo. Zotero's AddonManager upgraded the exact tested package from disabled **0.10.3 to 0.11.0** without uninstalling, with matching installer hash, stable ID, native data and columns. All synthetic native work is confined to a separate profile and data directory; no live provider is contacted.

## Private replay and delivery

A private read-only replay of the reported 48-paper completed build preserved all **95 cached analyses**, saved definitions, native data, source identities, original chooser history and spending. One deleted saved tag remained deleted; **129 saved definitions plus 26 additions produced 155**. The refreshed view had **174 All tags rows and 164 My tags rows**. Public Apply completed with zero new provider or extraction requests, five local PDF checks and zero native writes. The original selection was archived exactly and the copied source file remained byte-identical.

The older 19-paper, 20-paper, reading-progress and 744-paper compatibility replays also pass without live requests or working-library writes. The 744-paper representative schedule remains three requests, with its original facts, raw replies, budget and 5,832 unsampled sources preserved.

The installer, production JavaScript/CSS and embedded TypeScript must match the native-tested bundle. Source archives exclude profiles, databases, private replay fixtures, state and credentials and are scanned against private library titles and item IDs. Public reports contain aggregate results only. Update metadata, package hashes and published downloadable bytes are verified separately after publication.

Focused deslop/codebase-design review keeps navigation state in Navigator, shelf union rules in TagShelves, conservative refresh in VocabularyExtension, report grouping in AssignmentReview and provider/persistence work in the controller. State remains schema 9; updating makes no provider request and enables no automation. Native validation uses rendered controls and simulated replies, with no screenshot review or live-account authorization claim.
