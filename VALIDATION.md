# v1.0.7 validation

Target: Zotero 10.0.6 on Windows. Release artifacts, hashes and aggregate results are recorded in [dist/validation.json](dist/validation.json).

## Automated verification

- **1,195 automated tests passed**, including **151 manager UI tests**, with zero failures, cancellations or skips.
- Standard TypeScript checking and the stricter unused-local/unused-parameter check passed.
- In-memory production bundling passed. Package identity, versioned resources, update metadata, source archive and installer rebuild checks are recorded in [dist/validation.json](dist/validation.json).

Notification tests cover unchanged items without persistence or history traversal, duplicate changes with one batch save, manual removals, attachment invalidation, order-independent native tags, failures affecting one paper, preserved caches after failed reads, shutdown, and retrying failed saves. Lifecycle tests cover events arriving during a flush and cancellation on shutdown. Store tests retain exact-backup and recovery guarantees while checking validation reuse only for identical bytes, changed disk data, and eviction of large cached text. Definition-index tests preserve name ownership, aliases, stale identity detection and current-definition lookup.

The regression suite also retains saved-state validation, migrations, fact recovery, assignment policy and cache compatibility, meaning admission, personal-label treatment, saved-name conflicts, dropdown dismissal, keyboard focus, editor drafts and Undo.

## Focused native library checks

The **1.0.7 production build** passed **43 checks in light mode and 43 in dark mode**, **86 total**, in a separate Zotero profile and data directory. It used synthetic papers and mocked provider/native-write adapters, making **zero AI requests and zero native writes**. Both themes loaded the production resources. The earlier final preview passed 44 checks per theme with its preview-specific metadata checks.

The scenario exercises:

- No Smart Tags panel beside Collections, no sidebar API, and unchanged Collections DOM.
- Duplicate no-op item notifications without saves, and batch processing that yields to the UI.
- Tag library search, shelves, filters, meaning choices, saved-name conflicts, editor drafts and Undo.
- Dropdown dismissal, **/** search focus, Escape clearing, linked-paper disclosures and keyboard correction.
- Find papers queries, tag filters, clearing search and Enter-key focus.
- Settings updates and installed-version controls, with no Show/Restore navigation actions.

Each theme uses **19 pointer actions and thirteen Gecko keyboard actions**, retaining **nine screenshots**, **18 total**. Wide, medium and narrow layouts are checked; controls remain usable without horizontal overflow. Production-resource consistency is recorded in [dist/validation.json](dist/validation.json).

## Performance evidence

Read-only profiling used an existing copied state of approximately **153 MB**, not the working Zotero profile. Unchanged item updates and a batch of 100 duplicate notifications caused **zero persistence calls**. Operation-scoped definition indexes reduced repeated name-conflict work, and repeated full snapshots measured approximately **127 ms and 94 ms**, compared with approximately **502 ms and 469 ms** before the changes.

These are local diagnostic measurements, not a guarantee of latency on every library. Genuine changes still require serialization and recovery-safe persistence. Paid replies and history are retained rather than trimmed for performance.

## State and historical evidence

This release retains **state schema 13** and **native-definition protocol 2**. Updating from 1.0.5 or 1.0.6 requires no schema migration. Tests continue to cover exact-byte, collision-safe **state.json.pre-v13.json** backups for older states, preservation of paid progress and task policies, invalid-field rejection, backup/write failure and downgrade protection. Migration makes no AI request, meaning admission or assignment.

The v1.0.6 production meaning scenario passed **32 checks per theme**, covering Use/Skip, automatic clear meanings, remembered personal labels, explicit AI retry, restart, saved-name conflicts and generated-alias pruning. That result is historical evidence, not a new native meaning run for v1.0.7. Earlier copied-state recovery, editor and broader automatic-workflow runs also remain historical; current automated tests retain their regression coverage.

## Verification limits

Native tests use synthetic papers and mocked adapters; they do not establish live scientific classification accuracy or provider availability. The working Zotero library, cache and credentials were not modified. Native in-place installation and Zotero’s own remote update discovery are separate from checking the published installer and update-feed bytes.

Legacy navigator-specific native scenarios are retired after removal of the panel. The current library, Find papers and Settings scenario was rerun. Hidden-window test waits are bounded, and test-only timing preferences do not ship in the extension. Scientific filters whose per-paper exclusions cannot survive Zotero saved-search reload remain available in Find papers.
