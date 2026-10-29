# v0.5.3 validation

Target: Zotero 10.0.6 on Windows. Machine-readable results and installer/source hashes are in [dist/validation.json](dist/validation.json).

## Automated checks

`npm run verify` passed TypeScript checks, all 669 tests, and the production build. Consolidation tests cover local recovery, correction, a bounded fresh reply, automatic splitting, provisional source fallback, short input-scoped references, historical large replies, and accepting the final permitted dispatched response. Controller tests exercise the full recovery loop, durable request limits, restart with a saved fresh reply, pre-dispatch persistence rollback, budget rejection, authentication and other provider failures, and cancellation. Completed parts, factual evidence, selected connections, and native tags are checked for preservation.

Manager tests verify automatic-repair progress, active-part counts, remaining-cost estimates, and unavailable estimates without adding retry controls. Existing attention menus, navigator, evidence identities, manual decisions, stale previews, metadata preservation, migration, native-data protection, and undo remain covered.

Tests exercise consolidation and public controller interfaces, with manager assertions through accessible controls. The release diff received the requested codebase-design and deslop review; recovery policy stays within the consolidation module while the controller owns dispatch, persistence, and budgets.

## Isolated Zotero checks

138 native checks passed in a separate profile and data directory. A new retained-work scenario uses 64 synthetic papers and 256 factual concepts, including a legacy 172-input portion and malformed replies. One Resume completes automatic repair and splitting through ten synthetic provider requests, without another pause for reply format. Rendered repair progress is checked. Completed work, cached facts, selected connection, budget accounting, and native assignments remain protected, with no AI, PDF-extraction, or native-tag-write calls in that scenario.

The full native run also checks title/PDF/note/annotation searches, independent windows, Collections restoration and columns, editor scrolling, metadata preview/apply/undo, Dismiss, exclusion, Include again, standalone no_tag retrieval, compact attention controls, menu placement, and keyboard focus. PDF checks use an actual locally extracted and indexed PDF; results are recorded in dist/validation.json.

Zotero's AddonManager installed the production 0.5.3 package over a disabled 0.5.2 installation without uninstalling, preserving the extension ID, local state, library tags, and item columns. The HTTPS update manifest and installer SHA-256 hash were checked. Remote feed discovery was not exercised before publication. The old package remained disabled so its code could not write newer local state. No plugin section was added to the item or information panes.

## Private retained-work replay

A read-only copy of the current 744-paper build retained 752 cached factual records and two completed organization parts. Its saved failed 172-input response recovered locally into 167 candidates, without a provider request. Both completed parts, retained raw history, factual wording, quotations, provenance, catalog, and selected evidence snapshot remained unchanged.

A synthetic continuation completed organization in 97 replies: 78 map, 18 reduction, and one global reply. Prompts stayed at or below 71,840 UTF-8 bytes; map/reduction portions contained at most 64 inputs. All 5,174 registry identities were retained or explicitly excluded, with no foreign evidence imported.

A public-controller replay used 99 synthetic organization responses, including failed correction, automatic fresh generation, interruption, and saved-response restart. It preserved the selected model, spent budget, completed jobs, facts, snapshot, and native-tag snapshots. It then intentionally stopped at the scientific-preparation boundary rather than invent scientific judgments. That request contained six tags and 29 factual sources in 33,665 UTF-8 bytes, without context truncation. The original copied state remained byte-for-byte unchanged.

These replays test queue recovery, persistence, input bounds, and identity accounting. They do not establish the scientific quality of synthetic recommendations. No live provider request, repeated extraction, or native library write occurred, and the working run was not interrupted.

## Scope of verification

Native interface checks used Zotero's rendered controls, focus state, and layout measurements. Desktop screenshot review was unavailable because the computer-use helper could not connect. No real ChatGPT authorization or paid AI request was performed. Private library fixtures, profiles, credentials, and replay artifacts are excluded from public archives.
