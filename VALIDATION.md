# v0.10.2 validation

Target: Zotero 10.0.6 on Windows. Exact installer/source hashes and aggregate results are in [dist/validation.json](dist/validation.json).

## Correction

A new rebuild previously copied the last completed selector into active run.selection before reading its new paper group. The snapshot preferred selector progress, so it displayed old tags, examples and repair totals alongside current paper reading.

Completed selector reuse now lives in a separate dormant cache. It is promoted only after current facts, scope, baseline and settings produce the expected input fingerprint. Changed inputs create fresh selection work. Pause/restart and older saved ready-selector checkpoints preserve paid work while keeping it out of active reading progress. Paper-analysis reset clears the dormant cache and retains its audit record.

The snapshot and manager both enforce phase-specific progress. Reading displays current paper counts; old tag/example/request/repair totals are hidden, including during pause or background refresh.

## Automated checks

`npm run verify` passed TypeScript, **908 tests**, and the production build, including **84 manager-interface tests**.

Four new public-controller regressions cover unchanged 19-paper reuse with zero AI calls, a new 12-paper group paused after its first extraction and resumed without repeating it, literal older checkpoints carrying completed selection with pending jobs, and dormant-cache reset/audit preservation. They verify exact cached history, current-source scope, persistence, paper progress and unchanged native data.

The manager regression changes an existing 32-tag/90-example display into a new reading 12-of25 phase while deliberately retaining stale fields in its test snapshot. It verifies the paper count and 48% bar and the absence of old selection metrics or requests. This defensive check complements the controller's correct display data.

## Isolated Zotero checks

All **208 packaged native checks passed** in a separate profile and data directory. The new native scenario seeds a completed planner, blocks reading a different synthetic group, and checks the rendered Activity page, dormant cache, pause/cancel, cached facts, columns and absence of provider/native writes. Retained native checks cover saved-reply recovery, shelves, build/review, assignment, reset, metadata, search, independent windows and undo.

The exact 0.10.2 package was checked through Zotero's AddonManager over disabled 0.10.1 without uninstalling. The stable ID, state, native data, columns and installer hash must match.

## Private replay and artifact checks

A read-only private replay reproduces the reported old 32-tag/90-example state alongside 12 completed jobs in a 20-paper group. It verifies Papers read 12 of 20, hidden selection totals before and after initialization, dormant work preserved across JSON restart, unchanged facts/native data and unchanged source-copy bytes. It makes no provider or native request and does not change the working profile.

The older 19-paper saved-reply and 744-paper compatibility replays remain valid. No factual extraction, terminology, source-proof, schema, provider, budget or incoming-automation policy is changed by this patch.

Production JavaScript/CSS and embedded sources must match the native-tested installer and delivered TypeScript. Public archives exclude profiles, databases, private fixtures, state and credentials and are scanned against private item IDs and titles. Published results are aggregates only.

Focused deslop/codebase-design review keeps reusable selection work separate from active execution and tests through controller/module interfaces and accessible controls. Native tests use simulated replies rather than live AI; no live-provider latency/scientific-quality claim or screenshot review is made. Public HTTPS update metadata and downloadable bytes are checked separately after publication.
