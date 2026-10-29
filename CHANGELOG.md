# Changelog

## 0.5.0

- Added **Existing tags** to inventory native tags, compare them with the applied vocabulary, review meanings per paper, and preview exact replacements, removals, or unchanged assignments before applying them.
- Added explicit creation of suggestion-only DIY definitions from selected existing names, with editable meanings and researcher review for ambiguous topics. This does not rename native assignments or enable automation.
- Added paper recovery in **Activity** with usable/needs-information/failed/skipped statuses, local PDF checks, identifier-based metadata lookup, reviewed empty-field additions, selected-paper retries, and run-scoped skips.
- Kept papers with validated concepts usable when the model requests more context. Missing local files, unavailable PDF text, read errors, and unknown availability are reported separately.
- Used Zotero’s identifier translators in unsaved mode for DOI, PMID, ISBN, and arXiv lookup. Results must confirm the identifier; existing bibliographic values and creators are preserved, and no duplicate items or attachments are created.
- Added metadata and definition journals with exact before/after checks, atomic native metadata batches, interrupted-write recovery, and undo that protects later researcher edits. Superseded factual analysis remains in local history.
- Added persistent maintenance work that waits behind ongoing library analysis, using the selected provider and existing authentication/budget controls.
- Split large-library consolidation into bounded parts followed by global reconciliation. Completed parts, raw replies, evidence identities, and selected-paper coverage survive restart; reading, organization, scientific checking, and review have separate progress states.
- Upgraded local state to schema 5 with an immutable exact-byte backup. Retained factual extraction, proposals, researcher choices, completed jobs, source identities, queue replies, settings, credentials, and spent budgets; cleared obsolete derived cleanup previews.

## 0.4.1

- Added **Use another account or workspace** to ChatGPT settings, including when a previous sign-in never completed. It starts a fresh connection without reusing the earlier workspace or removing saved accounts.
- Added guidance for OpenAI's workspace-access error. Ordinary **Continue with ChatGPT** still reconnects the selected saved account.
- Verified fresh authorization omits earlier account hints, preserves the installation's host identity, and leaves existing credentials and registrations intact when canceled.

## 0.4.0

- Replaced the technical vocabulary-review screen with a researcher-facing Tags workspace: prepare the list, edit names and definitions, answer scientific questions, then apply the list.
- Added up to three additional preparation requests through the selected provider/model, with persistent attempt counts, saved replies, budget controls, and explicit retry after unsuccessful checks.
- Separated provenance from scientific relevance with source-level judgements. Generated naming, categories, unsupported topics, and relationships can be repaired automatically; protected edits, DIY names, and remembered choices remain under user control.
- Made 60 a preferred core-tag count. Scientifically distinct topics can remain separate when the list exceeds that preference.
- Added versioned terminology normalization while retaining historical evidence identities and human confirmations.
- Made Apply tag list save the vocabulary and start paper suggestions. Native tag writes still require a separate reviewed batch Apply, with undo.
- Upgraded local state to schema 4 with an immutable exact-byte backup. Existing factual extraction, pending reviews, user edits, choices, history, credentials, and spent-budget history are preserved.
- Removed eligible unused legacy generated drafts only when an original baseline proves they are unchanged and the reference graph shows they are unneeded. Native paper tags and retained definitions are untouched; no separate legacy archive is created.
- Resolved unfamiliar-topic notices after successful reevaluation of the same paper/phase, kept completed merge reviews in history, and replaced persistent success banners with brief confirmations.
- Refused newer state schemas and downgrade writes rather than replacing them with an older backup generation.

## 0.3.2

- Added Confirm all mappings across every proposal page, skipping blocked or already confirmed concepts and keeping vocabulary approval separate.
- Made proposed concepts open initially, with clear Edit and Remove actions on each card.
- Removed deleted hierarchy/context links from staged DIY details without deleting those details or changing native tags.
- Closed the matching editor after successful removal while preserving other unfinished edits and failed-removal drafts.
- Cleaned up provider-error typing, correction-error handling, warning validation, and test setup without changing their safeguards.
- Reused canonical snapshot text and review evaluations without changing historical confirmation hashes; separated fingerprint compatibility tests from proposal workflow tests.

## 0.3.1

- Fixed slow Vocabulary review by evaluating each confirmed mapping once per validation or render pass, preserving existing confirmation hashes.
- Paginated proposed concepts and loaded source quotations only when expanded, with bounded evidence pages.
- Preserved open evidence, pagination, scroll position, and unfinished edits across review actions.
- Coalesced save notifications into one manager refresh and indexed native tags once per snapshot.
- Replaced duplicate consolidation diagnostics in Queue & history with a short link to Vocabulary. Unparsed failures retain collapsed technical details.
- Kept existing proposals, confirmations, extracted evidence, and native library data unchanged during upgrade.

## 0.3.0

- Added opaque factual, registry, and vocabulary identities plus immutable consolidation snapshots.
- Replaced generated name references with supportRegistryIds at every input size.
- Added per-concept diagnostics, explicit uncertain-meaning confirmation, evidence removal, and one budgeted correction attempt preserved across restart.
- Preserved completed extraction during schema-v3 migration, with exact-byte backups and fail-closed migration writes.
- Added actionable paper-specific warnings, persistent dismissal, phase-specific resolution, recurrence, and separate notice history.
- Added explicit private proposal/evidence exports; presentation renames preserve evidence references.
- Added scientific naming rules including AEMWE/AEMWEs/AEM-WE, Co/CO, pH, and EIS.
- Retained the left-pane navigator and separate manager; no item/information-pane section.
- Waited for native collection restoration before applying tag filters in newly opened windows.

## 0.2.1

- Replaced unaccepted rebuild reviews without requiring obsolete draft merge IDs.
- Quarantined invalid approved-identity merges and retained completed consolidation replies.

## 0.2.0

- Added compact global vocabulary consolidation and expandable Tags/Collections navigation.
