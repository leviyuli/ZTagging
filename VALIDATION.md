# v0.7.0 validation

Target: Zotero 10.0.6 on Windows. Machine-readable results and installer/source hashes are in [dist/validation.json](dist/validation.json).

## Automated checks

`npm run verify` passed TypeScript checks, all **750 tests**, and the production build. The bundle's 23 embedded source files also match the delivered source.

TagSelection tests exercise the local census, unique-paper/category ranking, dominant-field preference, bounded sparse retrieval, repeated keywords, thousands of topics, a model that copies its input inventory, necessary parents, FC/AEMFC/PEMFC distinctions, Co/CO, protected definitions, and extension into a new field. The selected schedule has one global choice followed by bounded source mapping; no reduction round is scheduled.

Mapping tests cover shared registry labels with different source meanings, unknown/stale references, source-specific coverage, inherited parent support, changed parent meanings, negative findings, preserved researcher decisions, output limits, predetermined tag shards, one contextual follow-up, and bounded malformed-output corrections. Technical work stays separate from genuine researcher questions.

Public controller tests verify two simultaneous mapping requests with serialized budget reservations and result application, pre-dispatch persistence rollback, billing and redacted provider diagnostics, late replies after cancellation, saved-reply replay, authentication/budget pauses, restart without repeating completed batches, and explicit retry without losing history or spending. Imported reviews check their own papers; a second edit cannot supersede a live check or corrupt its saved reply.

Schema-6 migration tests cover exact-byte backups, occupied backup names, failure before writing, restart/idempotence, refusal to downgrade newer state, and preservation of old consolidation work. Existing legacy review, extraction, manual-tag protection, warning lifecycle, metadata, native Apply/Undo, and workflow tests remain in the full suite. Tests use module and public controller interfaces; manager assertions use accessible controls. A focused codebase-design/deslop review removed obsolete recursive controller execution and retained the legacy checkpoint reader for compatibility.

## Isolated Zotero checks

All **160 native checks passed** in a separate profile and data directory, with synthetic items and simulated provider replies. The final package was tested after the last production-source change.

The new scenario checks Choosing tags and Checking supporting findings, at most two concurrent requests, pause followed by a serialized-state reload and Resume, completed-batch reuse, fixed unique-source totals, separate tag-selection and source-check correction allowances, and readiness without repeated extraction or native paper-tag writes. A second scenario starts from completed legacy portions and confirms that their exact checkpoint remains unchanged while the new finite planner finishes.

The retained native suite covers independent build/assignment groups, extending an applied list, navigator/Collections restoration, independent windows, native title/PDF/note/annotation searches, item columns, editor scrolling and visible Save, metadata preview/apply/undo, attention menus, dismissal, exclusion, no_tag retrieval, and keyboard focus. An actual local PDF is extracted and indexed in the isolated data directory. Nothing is added to the right-hand item or information panes.

The updater scenario installed the production 0.7.0 package over a disabled 0.6.0 installation through Zotero's AddonManager, without uninstalling. It verified the stable ID, state, library tags, item columns, HTTPS manifest metadata, and installer hash. The old package remained disabled so its code could not write newer local state. Zotero's remote-feed discovery was not exercised before publication.

## Private retained-work replay

A read-only copy of the retained build contains 744 completed paper jobs, 752 cached factual records, and 5,981 selected factual sources. A private replay migrates the copy and finishes global selection and mapping with simulated replies. It checks exact source wording, quotations, IDs, provenance, selected snapshot, completed jobs, old checkpoint, decisions, settings, history, and spent budget. No factual extraction, live provider request, working-library operation, or native write is allowed. The copied original remains byte-for-byte unchanged.

The replay completed **one global choice and 93 mapping requests**, with at most two requests in flight, request sizes below 90 KB, and outcomes for all 5,981 selected sources. The retained preference was 120 tags, so its shortlist contained 480 candidates; simulated selection kept 60 tags. Its aggregate result is included in dist/validation.json; private state files, titles, IDs, credentials, and replay fixtures stay out of public artifacts. This tests scheduling and preservation, not scientific recommendation quality or live-provider response time.

## Scope of verification

Native interface checks use Zotero's rendered controls, focus state, and layout measurements. Desktop screenshot review was unavailable because the computer-use Node runtime could not start (path not found). No real ChatGPT authorization or paid AI request was performed. The working Zotero profile and ongoing run were not modified or interrupted. Installer and source archives are checked for private library markers and excluded profile/build files before publication.
