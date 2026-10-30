# v0.10.1 validation

Target: Zotero 10.0.6 on Windows. Exact installer/source hashes and aggregate checks are in [dist/validation.json](dist/validation.json).

## Failure and correction

The reported 19-paper extension had completed all extraction jobs. Tag selection rejected replies that used saved labels such as AEM/OER/PTL instead of stable IDs; omitted candidate names in optional relationships caused further failures. The repair allowance was exhausted before example checking began. This was a reference-handling defect rather than an input-size limit.

Relationship resolution now checks explicit IDs and current keys, then unambiguous preferred names, full names, approved aliases and conservative established abbreviations. Unknown or ambiguous optional links are withheld; unresolved parent links make no subtype claim. No alias, paper support or source judgment is inferred from a repaired graph reference. Cycles, chemical contradictions and conflicting meanings remain invalid.

For a failed chooser without a frozen plan, Resume/Retry rechecks complete saved replies newest-first within that active task. A later invalid reply does not discard an earlier valid one. Raw replies, counters, candidate allocations and spending stay recorded; other snapshots and superseded tasks are not searched. Source verification still runs separately.

## Automated and native checks

`npm run verify` passed TypeScript, **903 tests**, and the production build, including **83 manager-interface tests**. Five new selection regressions cover saved labels/full names/aliases, conservative acronym handling, exact identity precedence, unknown-edge quarantine, Co/CO and cycle/alias guards, and earlier-valid-reply recovery without counter reset. Controller and manager checks cover the plain failure explanation, correct Choosing phase, hidden undefined totals and repair details.

All **203 isolated Zotero checks passed**. The new synthetic case retains two cached papers, eight paid chooser replies and allocated IDs; public Retry finishes with one simulated example request, no chooser/extraction/PDF request, and unchanged prior spending. Applying the recovered list changes definitions only. Native tags, baseline meanings, columns, Collections restoration and right-hand panes remain intact.

The retained native suite covers shelves, build/review, batch assignment, undo, cache reset, metadata recovery, search, windows, notifications and compatibility commands. The exact production **0.10.1** package was installed over disabled **0.10.0** through Zotero's AddonManager without uninstalling. Stable identity, state, native data, columns and package hash passed.

## Private saved-work replays

The actual **19-paper** work was replayed only from a private local copy. Recovery selected an earlier valid saved reply, preserved all **19 cached facts**, **eight original chooser replies**, counters, evidence snapshot, existing definitions and spending, and scheduled **90 example pairs in two checking requests**. The largest ready request is **67,491 UTF-8 bytes**. One unassigned candidate is reconciled to an equivalent existing canonical identity; other allocated IDs remain stable. Local recovery makes no provider call, new extraction or native write, and does not edit the source copy or working profile.

A compatibility replay of the older **744-paper** work also passes: **180 pairs in three simulated checks**, at most two concurrent, **78,839-byte** maximum payload, and **5,832 findings left unexamined**. Cached facts, original quotations/provenance, IDs, history, raw replies and spending remain unchanged, with no repeated extraction, chooser request, live call or native write.

## Delivery and limits

Production JavaScript/CSS match the native-tested installer; embedded bundle sources match the delivered TypeScript. Installer and source archives exclude profiles, databases, state, credentials and private fixtures, and are scanned against private titles and item IDs. Published reports contain aggregate results only.

Focused deslop/codebase-design review keeps reference resolution and bounded recovery inside TagSelection and uses module interfaces, public controller actions and accessible manager controls. No new schema migration, extraction version, terminology policy, source-proof policy, provider switch or budget allowance was introduced.

The native checks use simulated responses rather than live AI. They validate execution, recovery and protection, not live-provider latency or scientific recommendation quality. No screenshot review or live account authorization was performed. The public HTTPS feed and exact downloadable bytes are checked separately after publication.
