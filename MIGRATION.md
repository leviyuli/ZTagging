# Upgrading to Smart Tags 0.4.x

Version **0.4.1** adds a way to connect another ChatGPT account or workspace. It uses the existing schema 4 and requires no additional state migration. Install it over 0.4.0, cancel any pending sign-in, then use **Settings → Use another account or workspace** if OpenAI reports a workspace-access error. Saved accounts and paper analysis remain available; no credentials or registrations are removed by opening the new sign-in flow.

Install the new XPI over the existing extension and open **Tools → Smart Tags…**. Startup upgrades local application state to **schema 4**. Consolidation continues to use ID-based protocol 2; terminology normalization is versioned separately. Migration performs no model requests and changes no native Zotero tags, collections, columns, or credentials.

## Continuing an existing review

For a review created in 0.3.x, open **Tags**. The extension retains the current proposal, selected evidence, saved edits, human confirmations, and completed paper analysis. It runs local preparation checks first. If more scientific checking is needed, choose **Resume checks**; if a preparation run cannot finish, **Try again** starts another bounded attempt. You do not need to discard the review or repeat unchanged factual extraction.

The new preparation stage can make **up to three additional requests** after the initial tag-list draft, using your explicitly selected provider and model. These requests use the existing budget controls. The old one-correction checkpoint remains in history and does not consume the new preparation allowance. A dispatched request counts even if it fails or is interrupted; a budget rejection before dispatch does not. Pause, restart, and ordinary Resume preserve the counter and saved responses. An explicit retry retains prior preparation replies and spent-budget history.

**Questions** contains choices that the available scientific context cannot settle. Existing edits, DIY names, and human choices remain protected. The preferred number of core tags is **60**, with distinct concepts allowed to remain separate above that number.

When ready, **Apply tag list** saves the vocabulary and starts assignment suggestions for the same papers. Inspect those in **Paper suggestions**, then confirm a separate batch Apply to write native tags. That batch has an undo record in **Activity**. Preparing a list, answering questions, and applying the list do not enable unattended assignment. Review the tagging pilot before enabling automation in Settings.

## Backups and retained evidence

Before writing schema 4, the extension creates an immutable, exact-byte **state.json.pre-v4.json** backup in the profile's `smart-tags` directory. A different existing backup is kept and a numbered filename is used. Earlier pre-v2/pre-v3 backups remain intact. Backup, migration, or migration-write failures stop without substituting an older valid `.bak` generation. A state file from a newer schema is refused, including attempted downgrade writes.

Factual source wording, quotations, fingerprints, extractor version, provider/model provenance, and existing IDs are retained. Completed jobs remain reusable when their evidence is unchanged. Settings, credentials, previously spent budget, decisions, locks, assignment ownership, native snapshots, and undo journals are preserved. Changed metadata or newly readable PDFs refresh affected papers. Private profile backups contain library metadata and should stay out of public artifacts.

Schema-3 pending reviews keep their evidence snapshots, candidate allocations, raw replies, and historical human proofs. Obsolete coverage entries for already removed candidates are pruned from active derived coverage; the original source evidence and review history remain retained. New source-level scientific judgements and researcher answers are stored separately from historical confirmation records.

## Safe legacy-draft cleanup

Unused generated drafts from the old vocabulary are removed from active extension definitions only when an original baseline proves their fields are unchanged. Custom, approved, edited, manually referenced, historically referenced, and current-proposal definitions are kept, together with definitions needed by their relationships. Unknown origins or a missing baseline cause definitions to be retained.

This is permanent cleanup of eligible extension draft records, backed by the standard exact-byte migration backup. It creates no additional legacy archive and removes no native paper tags. The current review and its stable IDs remain available. Regular vocabulary history and tag-change undo continue to work.

## Notices and older installations

**Activity** keeps actionable notices with affected-paper links and persistent dismissal. Successful reevaluation resolves only the corresponding paper and processing phase. Unfamiliar-topic notices clear when fresh assignment analysis no longer finds that condition; completed merge reviews belong in history. A later successful request does not establish the missing usage of an earlier request or confirm an earlier remote revocation. Brief success confirmations disappear after the action.

From schema 1 or 2, the earlier local evidence-identity upgrade runs before schema 4. It adds local IDs without repeating unchanged factual extraction, and invalidates incompatible name-based consolidation checkpoints and proposals. Resume the saved work or prepare tags again for the intended scope. Legacy support links are converted only through uniquely validated matches; ambiguous or scientifically uncertain links remain unresolved. Old warning strings remain historical, unverified notices without invented paper associations or dates.

Older definition exports remain importable. Private proposal/evidence exports retain their source and vocabulary checks. Normal definition export stays separate from exports containing paper wording and quotations.
