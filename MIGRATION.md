# Upgrading to Smart Tags 0.5.1

## Version 0.5.1

This patch keeps state schema 5. Existing schema-5 profiles retain their current generation, cached extraction, evidence wording and IDs, settings, credentials, manual choices, and history. New dismissal and exclusion-preview fields are optional; no extraction or provider request runs during loading. Profiles upgrading from an earlier schema still use the exact-byte pre-v5 backup process below.

Saved failed consolidation replies are rechecked locally when you Resume. Routine relationship recovery changes the proposed organization, not the original paper evidence or native tags. Correction attempts and replies are retained with the current part; explicit retry generations preserve earlier attempt history and spent budget. Incomplete provider replies remain diagnostic only.

The built-in no_tag definition is supplied locally. Native no_tag assignments mean an item is excluded until you choose Include again or remove the marker. Existing reserved-name definitions and their historical IDs are preserved, and their remembered choices remain protected. Exclude/Include changes use the normal native-tag journal with stale checks and undo. Dismissals acknowledge a condition without marking its underlying information gap resolved.

## Upgrading an older state to schema 5

Install the new XPI over the existing extension and open **Tools → Smart Tags…**. Startup upgrades local application state to **schema 5**. Consolidation continues to use ID-based protocol 2; terminology normalization and factual extraction versions are unchanged by this migration. Migration performs no model requests and changes no native Zotero tags, metadata, collections, columns, or credentials.

Schema-4 source evidence, pending proposals, human choices, IDs, completed jobs, raw queue responses, settings, budgets, and history are copied intact. The old derived cleanup preview is cleared. Reopen **Existing tags → Read library tags** to create a current comparison against the applied vocabulary.

## Continuing an existing review

Open **Tags** for a saved proposal, or **Activity → Resume** for an interrupted build. The extension retains selected evidence, saved edits, human confirmations, and completed paper analysis. It runs local preparation checks first when a proposal is available. If more scientific checking is needed, choose **Resume checks**; if a preparation run cannot finish, **Try again** starts another bounded attempt. You do not need to discard the review or repeat unchanged factual extraction.

Large builds now organize validated concepts in bounded portions before producing one global proposal. Saved completed portions and raw responses are retained. **Reading papers** reaching the selected count means extraction is complete; **Organizing tags** and **Checking tag meanings** still precede **Ready for review**. Resume continues available work, with changed metadata or PDF evidence refreshing only affected papers.

The new preparation stage can make **up to three additional requests** after the initial tag-list draft, using your explicitly selected provider and model. These requests use the existing budget controls. The old one-correction checkpoint remains in history and does not consume the new preparation allowance. A dispatched request counts even if it fails or is interrupted; a budget rejection before dispatch does not. Pause, restart, and ordinary Resume preserve the counter and saved responses. An explicit retry retains prior preparation replies and spent-budget history.

**Questions** contains choices that the available scientific context cannot settle. Existing edits, DIY names, and human choices remain protected. The preferred number of core tags is **60**, with distinct concepts allowed to remain separate above that number.

When ready, **Apply tag list** saves the vocabulary and starts assignment suggestions for the same papers. Inspect those in **Paper suggestions**, then confirm a separate batch Apply to write native tags. That batch has an undo record in **Activity**. Preparing a list, answering questions, and applying the list do not enable unattended assignment. Review the tagging pilot before enabling automation in Settings.

## Backups and retained evidence

Before writing schema 5, the extension creates an immutable, exact-byte **state.json.pre-v5.json** backup in the profile's `smart-tags` directory. A different existing backup is kept and a numbered filename is used. Earlier pre-v2/pre-v3/pre-v4 backups remain intact. Backup, migration, or migration-write failures stop without substituting an older valid `.bak` generation. A state file from a newer schema is refused, including attempted downgrade writes.

Factual source wording, quotations, fingerprints, extractor version, provider/model provenance, and existing IDs are retained. Completed jobs remain reusable when their evidence is unchanged. Settings, credentials, previously spent budget, decisions, locks, assignment ownership, native snapshots, and undo journals are preserved. Changed metadata or newly readable PDFs refresh affected papers. Private profile backups contain library metadata and should stay out of public artifacts.

Schema-3 pending reviews keep their evidence snapshots, candidate allocations, raw replies, and historical human proofs. Obsolete coverage entries for already removed candidates are pruned from active derived coverage; the original source evidence and review history remain retained. New source-level scientific judgements and researcher answers are stored separately from historical confirmation records.

## Paper recovery and reviewed native changes

Evidence notices now lead to **Activity → Papers that need attention**. Validated concepts remain usable when additional context was requested. The paper view distinguishes missing information from failed analysis; dismissal does not claim that evidence has been repaired.

Use **Find metadata**, review the identifier-confirmed additions, and choose **Apply metadata** to fill empty bibliographic fields or an empty creator list. **Recheck PDF** explicitly checks local files and retries local indexing; it does not download files or run OCR. **Retry analysis** and **Retry selected** queue requested work behind an ongoing library build. **Skip for this build** keeps the native item and its existing tags intact.

Metadata repairs have exact before/after journals and preserve superseded factual extraction in local history. Apply, recovery, and undo invalidate affected derived analysis. **Existing tags** changes and DIY-definition creation also have reviewed history records. Undo restores only the recorded changes and refuses conflicting later edits; partial or externally changed native batches remain marked for review rather than overwriting current data.

Creating DIY definitions or confirming equivalent approved aliases preserves the current core pilot. Applying a different core vocabulary still requires reviewing its tagging pilot before unattended assignment. Provider selection, encrypted credentials, and automatic-assignment preferences are retained; recovery does not switch providers or enable automation.

## Safe legacy-draft cleanup

For upgrades from schema 3 or earlier, the existing legacy cleanup removes unused generated drafts from active extension definitions only when an original baseline proves their fields are unchanged. Custom, approved, edited, manually referenced, historically referenced, and current-proposal definitions are kept, together with definitions needed by their relationships. Unknown origins or a missing baseline cause definitions to be retained. Upgrading an existing schema-4 state does not rerun that cleanup or alter its current proposal.

This is permanent cleanup of eligible extension draft records, backed by the standard exact-byte migration backup. It creates no additional legacy archive and removes no native paper tags. The current review and its stable IDs remain available. Regular vocabulary history and tag-change undo continue to work.

## Notices and older installations

**Activity** keeps actionable notices with affected-paper links and persistent dismissal. Successful reevaluation resolves only the corresponding paper and processing phase. Unfamiliar-topic notices clear when fresh assignment analysis no longer finds that condition; completed merge reviews belong in history. A later successful request does not establish the missing usage of an earlier request or confirm an earlier remote revocation. Brief success confirmations disappear after the action.

From schema 1 or 2, the earlier local evidence-identity and preparation upgrades run before schema 5. They add local IDs without repeating unchanged factual extraction, and invalidate incompatible name-based consolidation checkpoints and proposals. Resume the saved work or prepare tags again for the intended scope. Legacy support links are converted only through uniquely validated matches; ambiguous or scientifically uncertain links remain unresolved. Old warning strings remain historical, unverified notices without invented paper associations or dates.

Older definition exports remain importable. Private proposal/evidence exports retain their source and vocabulary checks. Normal definition export stays separate from exports containing paper wording and quotations.

The account/workspace switch introduced in 0.4.1 remains under **Settings → Use another account or workspace**. It preserves saved accounts and paper analysis while starting a fresh ChatGPT connection when needed.
