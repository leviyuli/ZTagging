# v1.0.6 validation

Target: Zotero 10.0.6 on Windows. Release artifacts, hashes and aggregate results are recorded in [dist/validation.json](dist/validation.json).

## Automated verification

- **1,195 automated tests passed**, including **151 manager UI tests**, with zero failures, cancellations or skips.
- Standard TypeScript checking and the stricter unused-local/unused-parameter check passed.
- In-memory production bundling passed and its JavaScript and source map matched the stable build exactly. Production package, versioned resources, update metadata, source archive and byte-identical installer rebuild results are recorded in [dist/validation.json](dist/validation.json).

The suite covers current-name conflicts, generated-alias pruning, exact saved-definition reuse, multiple name owners, changed identities, stale-action rejection and batch exclusion. Closing a duplicate retains the saved definitions, native labels, binding exclusions, archived paid request scopes, spending and deferred choices across restart. UI tests cover compact review actions, single-choice definition deduplication, shelf totals during search, useful empty results, optional paper/source-note disclosures, keyboard focus, editor drafts and Undo.

## Focused native library checks

The **1.0.6 production build** passed **34 checks in light mode and 34 in dark mode**, **68 total**, in a separate Zotero profile and data directory. It used synthetic papers and mocked provider/native-write adapters, making **zero AI requests and zero native writes**. Both themes loaded the actual versioned production resources. The earlier final preview passed 35 checks per theme, including its preview-only metadata check.

The scenario exercises:

- One compact page header and a searchable toolbar with Shelf, Show and Shelf options.
- All tags / Defined / Needs meaning filters, cross-search selection and local shelf changes.
- Dropdown portals, Escape dismissal, **/** search focus, Escape clearing and empty-search recovery.
- Optional linked-paper disclosures that open through keyboard controls.
- Meaning review without repeated section headings or repeated single-choice definitions, including visible saved-name conflicts and direct Keep saved meaning.
- Search returning to tag browsing, editor draft preservation, focused reopening, reachable Save/Close controls and correction through Undo.

Each theme uses **17 pointer actions and ten Gecko keyboard actions**. The scenario retains **14 screenshots**, seven per theme, across wide **1266 × 862**, medium **1046 × 722** and narrow **806 × 582** manager content sizes. Narrow and medium layouts have no horizontal overflow; shelf, filter and search controls remain usable.

## Meaning admission and correction

The **1.0.6 production meaning scenario** passed **32 checks in light mode and 32 in dark mode**, **64 total**, with zero errors. Together, the two production scenarios passed **132 native checks**. The meaning scenario retains **28 screenshots**, fourteen per theme. Each theme made exactly three mocked requests: a clear representative draft, a scientific assignment for a paper carrying Important, and an explicit AI retry. It made **zero real provider requests and zero native writes**.

The focused meaning scenario covers Use/Skip, automatic clear meanings, remembered personal labels, missing-proposal retry, restart and generated-alias conflicts. Primary-name conflicts show the current saved definition. Keep saved meaning closes only the duplicate proposal without changing scientific membership, saved aliases or native tags, and without another AI request. A generated alternate name already claimed by a saved tag is omitted from the new definition; the original proposed candidate and scientific evidence remain retained.

Regression tests preserve the full native-alias approval gate, grounded scientific proofs, manual locks and rejections. A meaning is saved independently of unverified old paper labels; later validated paper matches can establish individual membership without taking ownership of a manual tag. Admission and binding journals protect recovery and Undo.

## State and historical recovery evidence

This release retains **state schema 13** and **native-definition protocol 2**. Updating from 1.0.5 requires no schema migration. Tests continue to cover exact-byte, collision-safe **state.json.pre-v13.json** backups for older states, preservation of paid progress and original task policies, invalid-field rejection, backup/write failure and downgrade protection. Migration makes no AI request, meaning admission or assignment.

Historical v1.0.5 copied-state recovery preserved sixteen source judgments—two supporting, one different and thirteen unchecked—along with paid attempts, spending and native labels. Explicit Use, restart and Undo made no provider request or native write. This replay used copied bytes and in-memory persistence; it was not rerun against the working profile for 1.0.6.

The earlier v1.0.5 production meaning scenario passed **28 checks per theme**. The v1.0.4 editor scenario passed **26 per theme**, and the v1.0.3 broader automatic-workflow scenario passed **84 per theme**. These are historical results, not new full-workflow runs for this release.

## Verification limits

Native tests use synthetic papers and mocked adapters; they do not establish live scientific classification accuracy or provider availability. The working Zotero library, cache and credentials were not modified. Native in-place installation and Zotero's own remote update discovery are separate from checking the published installer and update-feed bytes. Filters whose per-paper exclusions cannot survive Zotero saved-search reload remain available in Find papers and the live navigator.
