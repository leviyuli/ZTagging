# Changelog

## 0.7.1

- Fixed tag selection stopping when a generated alias conflicts with a protected DIY topic. Existing user names, meanings, IDs, matching settings, and native assignments remain unchanged.
- Resume and Retry this step first recheck a saved complete reply locally. A reply made usable by the fix continues into source checking without another tag-selection request; previous replies, spending, and repair counts are retained.
- Resolved harmless case differences in method references and kept unestablished component relationships as contextual links. Distinct meanings and original paper evidence remain unchanged.
- Reduced repeated mapping payloads to tag meanings, applicable matching guidance, and subtype context. Full saved definitions and source quotations remain intact; the retained large-build schedule falls from 215 to 101 source-checking requests.

## 0.7.0

- Replaced recursive batch merging with a local topic census, bounded global shortlist, compact vocabulary choice, and one finite source-mapping pass. Ranking favors unique-paper coverage in the largest research area, with diminishing returns for repeated paper/category coverage.
- Kept 60 as a soft target and retained necessary parents, scientifically distinct meanings, existing definitions, and DIY topics. Unselected details remain factual data rather than automatic tags.
- Added explicit source-validation policy 3: coverage requires current source-specific decisions; one representative cannot approve other papers sharing its registry label. Historical policies and fingerprints remain intact.
- Separated three semantic repair requests from ordinary mapping batches. Added bounded contextual follow-ups, one malformed-output correction per task, and at most two concurrent mapping requests with serialized budget reservations and persistence.
- Replaced growing parts counters with unique supporting-findings progress, actual queued requests, and a separate correction allowance. Failed technical work offers Retry this step; account and budget pauses retain Resume.
- Upgraded state to schema 6 with exact-byte backups, retained legacy checkpoints, reusable cached extraction, durable raw replies, and restart recovery. Native tag writes, manual choices, undo, and incoming automation retain their existing protections.

## 0.6.0

- Aligned the sidebar and Overview with four setup steps: Connect AI, Build tags, Review & clean up, and Assign & automate. Kept Tag library and Find papers available for everyday use.
- Separated the papers used to build tags from the papers receiving tags. Apply tag list now saves the library only; assignment starts explicitly for a chosen pilot, selected papers, collections, or the whole library.
- Added extension of an applied tag list for a new field. Existing definitions and identities are retained, equivalent incoming topics are compared against them, and new subtypes and related topics stay distinct. Full replacement remains an explicit build mode.
- Labelled current build matches separately from papers already tagged, so saved definitions do not imply completed library assignment.
- Kept DIY creation/editing, existing-tag cleanup, separate native Apply, undo, incoming automation controls, and the assignment-pilot safeguard.
- Retained cached analysis, historical evidence snapshots, manual choices, collections, columns, and resumable work. State remains schema 5 with optional workflow records.

## 0.5.3

- Recover routine tag-building reply errors automatically: reuse saved replies locally, request a bounded correction and fresh reply, then split failing portions without another Resume click. Completed paper analysis and completed parts are retained.
- Divide new map/reduction work into at most 64 inputs and keep organization prompts within 100,000 UTF-8 bytes. Short, input-scoped response references reduce copying errors while expanding to the original persistent evidence IDs.
- Repair duplicate retained/excluded entries and withhold ambiguous generated aliases locally. Very small failed source portions remain provisional factual candidates for global checking; invalid evidence and scientific contradictions cannot authorize approval.
- Persist dispatched-request counts, correction history, fresh-reply allowance, and split depth across restart. Ordinary Resume does not reset limits. Authentication, connection, quota, permission, budget, and exhausted recovery still pause with a clear explanation; providers never switch automatically.
- Show automatic repair activity and remaining-cost estimates, including an explicit unavailable-estimate state. Part counts reflect active portions after splitting.
- Keep state schema 5, factual extraction, evidence identities, native tags, manual choices, collections, columns, and incoming-paper automation unchanged during upgrading.

## 0.5.2

- Simplified the paper-attention panel: empty views no longer show selection controls, disabled batch buttons, repeated help text, a pager, or a large footer action.
- Each paper shows one recovery action and a **More** menu; clicking its title opens it in Zotero. Batch actions appear only after selection, with secondary choices under **Actions**.
- Moved **Exclude selected Zotero items…** into the panel's **More** menu. Dismiss, exclusion, inclusion, retry, and one-build skip keep their existing behavior and reviewed Apply steps.
- Added keyboard navigation, Escape/focus restoration, outside-click dismissal, and viewport-aware placement for the action menus. Search and status changes clear selections so hidden papers cannot be included accidentally.
- Kept state schema, analysis, provider settings, tag assignments, and library data unchanged.

## 0.5.1

- Fixed a large-library consolidation pause caused by cross-category subtype edges and relationship names outside the current batch. Routine structural mistakes are repaired locally; unresolved batch links are carried into the global pass instead of rejecting the whole response.
- Reuse retained failed replies before requesting another response. Genuinely invalid parts receive one bounded correction through the selected provider and budget. Completed parts, original outputs, evidence IDs, and spent budget survive pauses and restarts.
- Added per-item and batch **Dismiss**, **Exclude from tagging**, and **Include again** actions. Exclusion previews the exact native changes, preserves other tags and item data, and supports undo. Dismissal hides an unchanged condition without claiming it was repaired.
- Added the protected **no_tag** marker and a standalone navigator filter. Manually excluded items are skipped by future tag building and assignment. Adequately evidenced outside-vocabulary results may suggest no_tag for separate batch Apply; missing information and failed requests never become no_tag automatically.
- Preserved historical reserved-name IDs and their manual decisions. The built-in marker is excluded from scientific vocabulary targets, taxonomy generation, and the pilot's accepted-scientific-tag requirement.

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
