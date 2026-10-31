# v0.13.1 validation

Target: Zotero 10.0.6 on Windows. Artifact hashes and aggregate results are recorded in [dist/validation.json](dist/validation.json).

## Browsing and navigation hotfix

Tag library opens the tag browser even with unfinished meaning work. Review meanings opens the saved review explicitly; changing a shelf or readiness filter restores browsing, without cancelling preparation. Older questions without a candidate use a primary Suggest a meaning action and explain the missing draft instead of asking for a nonexistent choice. A complete valid protocol 2 candidate can offer Use [name]; missing information, protected decisions and contradictions cannot.

Page/sidebar navigation returns to the new heading and hides the editor while retaining its draft. Background updates retain list/editor scroll. Without an editor the tag list uses the full workspace width. Short/narrow editor drawers keep the sidebar hit-testable and provide Close editor. Manager document, stylesheet and loader URLs include the installed version so updates load the matching layout resources.

This patch retains schema 11 and protocol 2. Existing state, cached analysis, original evidence and paid history are not migrated or reset.

## Actionable meanings and shelves

Native-definition protocol 2 prefers an ordinary broad meaning for a broad name. Battery chemistry differences alone do not require splitting a battery tag. Genuine questions carry stable, complete choices; proposed information seeds the editor. Edit, choice and Leave undefined actions bind to a particular entry. Saving clear results does not depend on answering other questions, and Done requires every entry to be saved or explicitly left undefined.

Human intent is stored separately from source judgments. Exact compatible positive judgments can be reused; uncertain judgments are archived and rechecked after a choice. Different meanings, changed inputs and scientific contradictions cannot become valid evidence through a human click. Existing saved definitions and scientific symbols remain protected. Question parsing is transactional: malformed options receive bounded format repair and cannot silently become ready tags. Checks retain request bounds, provider/model provenance, paid replies, dispatch counters and budget controls.

The editor preserves per-entry drafts and scroll position through background updates. Save/Cancel remains visible; unsaved changes block saving the old version of the selected entry while allowing unrelated ready meanings to save. Stale editors cannot alter already-applied meanings or initiate paid checks for them.

Rename and Merge shelves remain above the scrolling workspace during browsing, meaning review and editing. Merge still replaces selected shelves by default, deduplicates membership, preserves definitions and native assignments, and supports conflict-aware Undo.

## Activity and compatibility

Activity distinguishes request execution from review completion. Current questions and unsaved meanings remain actionable after requests finish; Open meanings opens their review. Completed builds and preparations appear in collapsed history, without duplicate progress strips or disabled work controls. Unfinished assignment reviews remain actionable after analysis completes. Archived meaning tasks retain known saved/undefined counts; missing historical counts are not invented.

Schema 11 uses the existing collision-safe exact-byte pre-v11 backup process. Migration preserves protocol 1 questions, ready proofs and fingerprints without reinterpreting them. Existing plain-text questions offer explicit Suggest a meaning; it archives the earlier snapshot and replies, retains stable allocations and spending, and schedules only affected work under protocol 2. Migration, initialization and page navigation perform no provider requests or native writes. Backup/write failures and older-version downgrade refusal remain covered.

## Verification

`npm run verify` passed TypeScript, **1,019 automated tests**, including **102 manager-interface tests**, and the production build. Tests cross the native-definition module interface, public controller actions, AtomicStore and accessible rendered controls. Regression workflows cover broad names, structured choices, partial saving, editor checks, leaving undefined, Done, stale inputs, protected decisions, budget/authentication pauses, restart recovery, protocol 1 continuation and completed-history routing.

All **259 isolated native checks passed**, covering production controls and layout, including the reported earlier 48-paper build followed by an unanswered meaning preparation. New checks cover actual sidebar route clicks at wide and narrow/short sizes, heading visibility after page scrolling, computed grid/column bounds, stylesheet version, explicit browsing/review switching, legacy Suggest recovery, and drawer/nav/footer reachability. Retained checks cover the persistent shelf toolbar, focusable choices, seeded editor with visible Save, choice/edit/leave/Done, native-tag protection and collapsed completion history. The retained suite covers the navigator, native search/restoration, collections, item columns, assignment, metadata and Undo. Native AddonManager tests the exact installer upgrade from disabled **0.13.0 to 0.13.1**, with stable identity and no uninstall.

## Private replay and delivery

A read-only replay of the saved work preserves **95 cached facts**, the **48 completed paper jobs**, and the legacy question associated with **17 papers**. It confirms that Activity retains the meaning task, Continue creates protocol 2 work with original IDs, the prior snapshot/replies remain exact, and an unaffordable request pauses before dispatch. It performs **zero provider requests, repeated extraction requests, native writes or working-profile writes**.

The retained 744-paper replay also passes under schema 11: saved extraction and chooser replies are reused, three simulated representative-check requests remain bounded, 5,832 unsampled findings stay unexamined, and native data and spending remain unchanged. A separate read-only shelf replay preserves 95 facts, plans nine initial bounded requests for 44 undefined names without dispatch, and merges five generated shelves into 154 unique definitions.

Focused deslop/codebase-design review keeps interpretation, question validation and proof reuse in NativeTagDefinition; persistence, requests, budgets and journals remain in the controller. Existing UI and controller harnesses are reused. Production JavaScript/CSS and embedded TypeScript must match the native-tested bundle and delivered installer. Public artifacts exclude profiles, databases, private fixtures, state and credentials; artifacts are scanned against private titles and IDs. HTTPS update metadata and downloadable installer hashes are checked after publication.

Validation uses simulated model replies and rendered native controls. It does not claim live scientific accuracy, account availability, provider latency or screenshot review. Native in-place package updating is tested; remote update-feed discovery in Zotero is not asserted before publication.
