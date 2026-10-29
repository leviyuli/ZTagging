# v0.6.0 validation

Target: Zotero 10.0.6 on Windows. Machine-readable results and installer/source hashes are in [dist/validation.json](dist/validation.json).

## Automated checks

`npm run verify` passed TypeScript checks, all 700 tests, and the production build. New workflow tests verify independent build and assignment scopes, saving without an assignment request, reviewed native Apply and Undo counts, extension restart, stale baselines, incompatible checkpoints, import/export and merge recovery, unchanged reruns without another provider request, and editable contextual links.

The 13 extension-module tests cover immutable applied definitions and IDs, old topics absent from the new sample, supported parents, equivalent labels, unrelated acronym meanings, Co/CO separation, source-level scientific checks, empty additions, invalid graphs, and protected existing definitions. The 55 manager tests exercise the ordered sidebar, initial setup, independent scope selectors, saved versus suggested lists, retained-tag editing routes, distinct build-match and native-tag counts, editor drafts and footer, pilot gating, explicit automation saving, and existing menus.

Tests cross module and public controller interfaces; manager assertions use accessible controls. The release received the requested codebase-design and deslop review. Vocabulary extension is a separate module, while the controller owns persistence, dispatch, budgets, and native writes. Existing consolidation recovery, manual-choice protection, metadata preservation, migration, warning lifecycle, and undo checks remain in the full suite.

## Isolated Zotero checks

153 native checks passed in a separate profile and data directory. A new workflow scenario builds from one synthetic paper, saves without assignment, requests suggestions for a different collection group and then the whole synthetic library, and extends the list with a new method. Six simulated provider replies verify the selected scopes, old tag identity and definition, duplicate prevention, unchanged native tags and columns, DIY editing access, and explicit pilot controls. It makes no real AI request or native tag write.

The full native run retains the large-library automatic-recovery scenario, title/PDF/note/annotation searches, independent windows, Collections restoration and columns, editor scrolling and visible Save, metadata preview/apply/undo, Dismiss, exclusion, Include again, standalone no_tag retrieval, compact attention controls, menus, and keyboard focus. PDF checks use an actual locally extracted and indexed PDF. The older preparation scenario now explicitly starts assignment after saving the list; results are recorded in dist/validation.json.

Zotero's AddonManager installed the production 0.6.0 package over a disabled 0.5.3 installation without uninstalling, preserving the extension ID, local state, library tags, and item columns. The HTTPS update manifest and installer SHA-256 hash were checked. Remote feed discovery was not exercised before publication. The old package remained disabled so its code could not write newer local state. No plugin section was added to the item or information panes.

## Private retained-work replay

A read-only copy of the retained 744-paper build contains 752 cached factual records and two completed organization parts. A v0.6 compatibility replay preserves the absent legacy build-mode field, exact checkpoint fingerprint and generation, completed parts, and source facts. Its third saved response still recovers locally. One simulated transport guard stops at the next organization request; there is no repeated extraction, live provider request, or native write. The original copied file remains byte-for-byte unchanged, and the working profile/run is untouched.

Prior evidence for an extended vocabulary stays in separate immutable build scopes. Only the selected new papers contribute to the incoming proposal snapshot and coverage. Public workflow tests check preservation of those earlier scopes and their archive records. Restoring an archived list spanning several builds requests a rebuild from retained facts instead of mixing source IDs into one snapshot; native assignment Undo remains supported.

These replays test compatibility, persistence, input scope, and identity accounting. They do not establish the scientific quality of simulated recommendations. Large-library request bounds and automatic repair remain covered by the retained tests and native scenario.

## Scope of verification

Native interface checks used Zotero's rendered controls, focus state, and layout measurements. Desktop screenshot review was unavailable because the computer-use Node runtime could not start (path not found). No real ChatGPT authorization or paid AI request was performed. Private library fixtures, profiles, credentials, and replay artifacts are excluded from public archives.
