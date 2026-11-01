# v1.0.4 validation

Target: Zotero 10.0.6 on Windows. Release artifacts, hashes and aggregate results are recorded in [dist/validation.json](dist/validation.json).

## Automated verification

- **1,116 automated tests passed**, including **132 manager UI tests**, **12 native-meaning recovery tests** and **10 controller-context tests**, with zero failures, cancellations or skips.
- Standard TypeScript checking and the stricter unused-local/unused-parameter check passed.
- In-memory production bundling passed. `npm run check`, `npm test` and `npm run build` passed as separate commands.

The suite covers domain rules, public controller actions, persistence and rendered manager controls. New editor regressions model long native-meaning reviews, drawer/desktop sizing transitions, window resizing and focus without outer-page jumps. Draft text, More options and inner scroll survive refresh and reopening; an offscreen Name or Meaning is revealed by scrolling only the form. Existing admission, source-check, secondary-page, keyboard, validation, Undo and cached-reply regressions also pass.

The production XPI contains 11 files matching the built add-on, with the 1.0.4 manifest, stable extension identity, supported Zotero range and versioned manager resources verified. The installable package excludes the native-test bootstrap and private paths. The source archive is built and checked separately from the XPI; update-metadata, credential-scan and source-rebuild results are recorded in [dist/validation.json](dist/validation.json).

## Focused native editor checks (1.0.4)

The isolated focused editor scenario passed **26 checks in light mode and 26 in dark mode**, with zero errors. Both runs loaded the actual **1.0.4 production build**, including its versioned stylesheet and loader, in a separate Zotero profile and data directory. They made zero real provider requests and zero native writes.

The scenario opens Heterogeneous catalysis below a **24-question native-meaning review**, prepared with two mocked provider calls. Actual pointer and keyboard checks cover a usable editor body with reachable Save/Close controls, More options, retained draft/caret/scroll after refresh, textarea and window resizing, and reopening a deep draft with Meaning visible. Editor interaction preserves the prepared work and makes no additional provider requests or native writes after fixture setup.

The focused run retained **8 editor screenshots** (4 per theme) at wide **1266 × 862** and narrow **806 × 582** manager content sizes. Initial form body heights measured **724 CSS pixels in the wide window and 444 in the narrow window**. Native bounds checks require a body of at least **240 CSS pixels**, visible Save/Close controls and no horizontal overflow.

## Earlier full workflow native checks (1.0.3)

The earlier isolated automatic-workflow scenario passed **84 checks in light mode and 84 in dark mode**, with zero errors, on the actual **1.0.3 production build**. This full native scenario was not rerun for 1.0.4. It used synthetic papers and mocked provider/native-write adapters in a separate Zotero profile and data directory, with zero real provider requests.

Checks exercise actual pointer and keyboard controls for:

- Separate Build tags, Tag library and Assign tags pages; automatic clear assignments and meanings; deferred choices; exact task Undo and cached reruns.
- Find papers text and tag filters, live result focus, Clear search, and related papers that close with Escape and restore trigger focus.
- Activity recovery, collapsed history and reachable Undo, accurate source progress, direct Resume, and one inbox choice without a duplicate task card.
- A carbon-capture scope selected through the keyboard, retained despite one uncertain source; Recovery shows source evidence, reopening and a stale repeated answer make no new request, and explicit Recheck sources requests only the uncertain paper.
- Settings disclosures, unsaved drafts, Control+S, discard, inline validation and reachable Save/Discard controls in a narrow window; connection settings retain the selected model.
- Editor Enter, Control+Enter and Escape, retained drafts, reachable save/close controls, preserved Zotero collections and item columns.

That 1.0.3 run retained **54 screenshots** (27 per theme) and native bounds/hit tests at wide **1266 × 862** and narrow **806 × 582** content sizes, including Find papers, Activity, Settings and carbon-capture source checks.

## Chosen meanings and source checks

A scope choice remains selected when linked-paper checks are uncertain. The remaining uncertainty appears as source information in Recovery, with affected-paper links and reasons. Repeating the same choice or unchanged meaning edit preserves the answer, proofs and queue state without another model request. Explicit Recheck sources schedules only uncertain or unchecked papers, preserving established support. A genuine different-meaning judgment remains a scientific conflict.

Completed, ready legacy work normalizes on startup and archive restoration without dispatching AI or changing source proofs, human answers, paid history or counters. Later stays deferred through this mechanical reclassification. Archived resolution restores the newest saved work. Failed or unfinished work is not resumed by startup normalization.

The 1.0.3 immutable copied-state replay of the reported carbon-capture case retained **17 judgments: 13 same-meaning and 4 uncertain**. The selected meaning remained without an identical choice or pending request. Repeated answers made **zero new provider requests and zero native writes**. An explicit recheck plan contained only the four unresolved sources, retaining the 13 established supports and archiving the earlier uncertain results. Human answers, paid attempts and counters were preserved; the original working-state bytes remained unchanged. The earlier full native scenario used a separate synthetic two-source case and mocked requests.

## Existing admission and cached recovery

The synthetic controller regression contains **44 native names, 283 papers, 386 name/paper pairs and 205 accepted judgments**, with **15 ready definitions and 29 questions**. The saved state loads unchanged from its current file without falling back to `.bak`. Resume admits the 15 ready definitions while retaining all 29 questions, the complete frozen work, question identities, paid attempts and spending. It makes **zero new provider requests and zero native writes**.

The 17-source Batteries regression starts with 16 accepted source judgments and a saved failed reply. Resume revalidates that reply locally, recovers the seventeenth judgment and preserves the earlier judgments, paid attempts and spending. A remaining scientific distinction stays an explicit question; the contradicted meaning is not offered again. Changed meanings, foreign targets, duplicate echoes, stale source fingerprints and unsupported evidence remain rejected.

## Workflow and migration protections

Existing regressions continue to cover atomic automatic definition admission, protected saved meanings and dependencies, scoped assignment caching, preserved deferred choices and exact task Undo. Later manual edits and identical automatic replay after Undo remain protected. Incoming tagging requires explicit opt-in and respects matching modes, locks, rejections and exclusions. An omitted model result is not treated as a negative scientific judgment.

The state schema remains **12** and native-meaning protocol remains **2**. Every paper carrying a native name must still support its proposed global meaning/alias before admission. A chosen scope never supplies missing paper evidence. Migration tests preserve exact source bytes in collision-safe pre-v12 backups, retain historical backups and paid work, reject corrupt new fields, stop on backup/write failure and refuse downgrade writes. Older unfinished work does not acquire automatic-processing policies or retroactive approvals. Proof identities and source-validation requirements remain enforced.

## Verification limits

These results validate the tested Windows/Zotero target, the current editor scenario and the dated workflow/replay evidence above. They do not establish live provider availability or scientific classification accuracy. The original library was unchanged by the replay. The historical 259-check native suite is not reported as a fresh 1.0.4 run. Remote update-feed discovery and an in-place installer upgrade require separate verification.
