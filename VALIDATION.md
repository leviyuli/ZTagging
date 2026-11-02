# v1.0.5 validation

Target: Zotero 10.0.6 on Windows. Release artifacts, hashes and aggregate results are recorded in [dist/validation.json](dist/validation.json).

## Automated verification

- **1,184 automated tests passed**, including **146 manager UI tests**, **14 controller native-meaning admission tests** and **71 store/migration cases**, with zero failures, cancellations or skips.
- Standard TypeScript checking and the stricter unused-local/unused-parameter check passed.
- In-memory production bundling passed and its JavaScript and source map matched the production build exactly. The production build passed; update metadata, source archive and byte-identical source rebuild results are recorded in [dist/validation.json](dist/validation.json).

The suite covers automatic and explicit meaning admission, truthful human/automatic provenance, personal-label preferences, source and definition revalidation, pending paid work, restart, Undo and sparse binding journals. UI regressions cover visible definitions, direct Use/Skip controls, optional editing, per-card actions alongside batch confirmation, keyboard editing, long-review sizing and retained drafts. Scientific filtering, navigator refresh, saved-search restrictions and manual-label ownership have dedicated regression coverage.

## Focused native meaning checks

The **1.0.5 production build** passed **28 checks in light mode and 28 in dark mode**, **56 checks total**, with zero errors. Both runs loaded the actual versioned production resources in a separate Zotero profile and data directory, using synthetic papers, mocked provider transport and mocked native writes. These runs made **zero real provider requests and zero native writes**. The earlier final preview also passed 29 checks per theme, including preview-only package metadata checks.

Each theme exercised four actual pointer actions and three Gecko keyboard actions. Checks cover:

- A Fuel cells proposal accepted through Use, saving FC while retaining two supporting, one negative and thirteen unchecked old source judgments. Fourteen unverified old bindings remain excluded from scientific matches; paid attempts and spending are unchanged, and no paper-review task remains.
- An optional unchanged editor Save with empty aliases, preserving the draft exactly without adding the raw native name or launching another source request.
- Restart retaining the saved concept and binding exclusions without duplicate admission or further requests.
- A new clear 16-source preparation saving after its first three-source reply rather than dispatching the other thirteen source checks.
- Important offering Keep as personal label, remembering the choice without a request, and still allowing its papers to receive other scientific tags.
- A missing usable proposal offering an explicit AI retry and keyboard Skip, with no extra request from skipping.

Each theme made exactly three mocked requests: the clear initial draft, a scientific assignment for a paper carrying Important, and the explicitly requested retry. The runs retained **20 screenshots**, ten per theme, at wide **1266 × 862** and narrow **806 × 582** manager content sizes.

## Copied-state recovery and Undo

An offline replay of a copied Fuel cells preparation preserved all **16 source judgments: two supporting, one different and thirteen unchecked**, together with paid attempts, spending and original native labels. Schema 12→13 migration changed only the schema number. Initialization performed no implicit policy adoption or meaning admission.

An explicit Use saved FC in suggestion-only mode with no fabricated aliases or supporting judgments. The full all-paper native-alias approval path remained blocked. Restart retained the concept without duplicate admission, and repeated Use was safely rejected. Undo restored the affected definitions and binding records; another restart did not recreate the result. The replay made **zero provider requests, zero connection tests and zero native writes**. It operated on copied bytes and in-memory persistence; the working Zotero profile was not accessed by the replay.

## Migration and scientific membership

Schema **13** retains native-definition protocol **2**. Exact-byte, collision-safe **state.json.pre-v13.json** backups precede migration. Tests retain historical backups, saved choices, paid work and original processing policies; reject invalid new fields; stop on backup/write failure; and refuse downgrade writes. Migration makes no AI request, definition admission or assignment.

Scientific concept admission and old native-paper membership are separate. Automatic admission requires a current, clear, grounded scientific meaning. Explicit Use may accept a complete AI glossary definition without treating old labels as evidence. Unverified old associations remain excluded from scientific filtering and counts. Full native alias approval still requires every affected paper to support the interpretation. A later validated paper match can clear only its own exclusion, without taking ownership of a pre-existing manual label. Exact journals protect recovery, conflicting later edits and Undo.

Personal-label choices remain distinct from no_tag or paper exclusion. Deferred choices remain deferred. Ordinary assignment protections, scoped cache reuse, incoming-tagging opt-in, locks and remembered rejections remain covered by the regression suite. Zotero saved searches that would lose per-paper exclusions on reload are refused; Find papers and the live navigator retain those exclusions.

## Historical native evidence

The v1.0.4 focused editor scenario passed **26 checks per theme**, retaining eight screenshots. It covered long native-meaning lists, visible Save/Close controls, retained drafts and focus, and drawer/window resizing. The v1.0.3 broader automatic-workflow scenario passed **84 checks per theme**, retaining 54 screenshots. It covered the three task pages, Find papers, Activity, Settings, source recovery, keyboard navigation, cached reruns and task Undo. These are historical runs, not fresh v1.0.5 full-workflow results.

## Verification limits

Native tests use synthetic papers and mocked provider/native-write adapters. They do not establish live scientific classification accuracy or provider availability. The working library and credentials were not modified. The release checks do not exercise an in-place installer upgrade or Zotero's remote update-feed discovery.
