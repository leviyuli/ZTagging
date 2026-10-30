# v0.10.3 validation

Target: Zotero 10.0.6 on Windows. Exact installer/source hashes and aggregate results are in [dist/validation.json](dist/validation.json).

## Correction

The reported 20-paper build finished extraction, then exhausted chooser repairs because generated aliases overlapped saved names and other candidates. Rejecting every tag for a repairable presentation conflict prevented the build from reaching example checking.

TagSelection now checks known scientific contradictions first, removes conflicting generated alias claims before comparing candidates with saved definitions, and preserves saved names, meanings, aliases and IDs. Alias overlap alone cannot establish equivalence. A conflicting generated label can use its own unique supplied full name; otherwise that candidate is deferred with its original identity, reply and factual sources retained. Its incident relationships cannot become approved links. Scientifically incompatible names, aliases, relationships or evidence remain blocked.

Resume and Retry reparse complete replies from the current active generation before another chooser dispatch. They preserve previous attempts, errors, counters and spending. New tags still require current source-specific example judgments. Remaining naming failures have a plain paused-state explanation without exposing IDs or blaming the paper count or connection.

## Automated checks

`npm run verify` passed TypeScript, **917 automated tests** (including **84 manager-interface tests**), and the production build. Tests cross the selection and public-controller interfaces; obsolete presentation-conflict assertions are replaced with checks of safe recovery and preserved scientific distinctions.

## Isolated Zotero checks

All **215 packaged native checks passed** in a separate Zotero profile and data directory. The new scenario recovers twelve saved chooser replies, keeps distinct resistance and conductivity meanings, preserves six saved definitions, and follows public Retry through example checking and Apply tag list. It checks exact-source support, Co/CO protection, unchanged native tags and columns, and no extra chooser or extraction request. Retained scenarios cover phase-specific progress, shelves, navigator/search restoration, assignment, metadata and undo.

The exact 0.10.3 package passed Zotero's AddonManager upgrade over disabled 0.10.2 without uninstalling. Stable ID, native data, columns and installer hash match.

## Private replay and artifact checks

A private read-only replay uses the reported 20-paper build and its twelve paid chooser replies. Local recovery preserves all 50 cached factual analyses, the immutable snapshot, candidate identities or independently established canonical identities, saved definitions, raw replies and spending. It reuses the generated draft without another chooser or extraction request, then schedules two remaining representative checks with a largest payload of 73,713 bytes. Simulated pair responses exercise completion; they do not establish scientific accuracy or predict live latency. Unsampled findings remain unexamined.

The older 19-paper, reading-progress and 744-paper compatibility replays are retained. No working-profile writes or live provider calls are made. Schema 9, extractor, terminology and proof-policy versions, budget controls and incoming automation are unchanged.

Production JavaScript/CSS and embedded sources must match the native-tested installer and delivered TypeScript. Public archives exclude profiles, databases, private fixtures, state and credentials and are scanned against private item IDs and titles. Published results are aggregates only.

Focused deslop/codebase-design review keeps conflict handling inside TagSelection without expanding its public interface. Native checks use simulated replies and rendered controls; no screenshot review or live account authorization is claimed. Public HTTPS update metadata and downloadable bytes are checked separately after publication.
