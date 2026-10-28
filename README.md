# Smart Tags for Zotero

A local, open-source extension for **Zotero 10.0.6–10.0.x on Windows**. It builds an approved vocabulary, proposes evidence-backed tags, supports custom research topics, and records reversible changes. Your existing item-list columns and collections stay in place.

## Install and start

1. In Zotero, open **Tools → Plugins**, choose the gear menu, then **Install Plugin From File…** (some versions label this “Install Add-on From File…”).
2. Select [`smart-tags-0.3.2.xpi`](https://github.com/leviyuli/ZTagging/raw/refs/heads/main/dist/smart-tags-0.3.2.xpi).
3. Open **Tools → Smart Tags…**. Navigation lives in the left pane; the right-hand item and information panes remain unchanged.
4. In **Settings**, configure ChatGPT, an OpenAI API key, or a DeepSeek API key; discover/select a text-capable model, then click **Test connection**.
5. Start with **Pilot · 50 papers** on Overview and click **Rebuild vocabulary**. Vocabulary shows **one consolidated proposal**, with supporting-paper coverage, representative papers, aliases, hierarchy, merges, and excluded candidates. Review/edit it, then approve the taxonomy. Prior unaccepted drafts are replaceable candidates, with no authoritative merge IDs. A new rebuild replaces its previous unapproved proposal while preserving active definitions until approval.
6. Run **Suggest paper tags** for the pilot. Review supporting passages, accept/reject suggestions, and apply the displayed changes. Vocabulary approval and paper-tag application are separate actions.
7. Mark the completed tagging pilot reviewed. You can then enable automatic assignment for incoming papers. Publishing or editing the active core vocabulary resets this gate; editing a DIY detail refreshes only that detail’s proposals.

The classifier usually proposes up to five core tags plus matching custom tags; it does not pad papers to a minimum. Routine assignment uses approved definitions. New topics are presented for vocabulary review rather than silently added as native tags.

The extension checks this repository's [update manifest](updates.json) for new versions. Each published installer has a SHA-256 hash in that manifest. You can also update manually by installing a newer XPI.

The [v0.3.2 release](https://github.com/leviyuli/ZTagging/releases/tag/v0.3.2) includes the installer, TypeScript source archive, and [validation report](dist/validation.json). Read the [changelog](CHANGELOG.md) and [migration notes](MIGRATION.md) before upgrading a paused rebuild.

Version **0.3.2** adds **Confirm all mappings (N)** across the whole proposal, plus visible **Edit** and **Remove** actions on each concept card. One proposed concept corresponds to one canonical tag; aliases are alternate searchable names. Bulk confirmation skips concepts with errors and records your eligible confirmations together. Approval remains separate. Remove excludes a concept from the staged vocabulary and clears its staged links; native paper tags stay unchanged. Protected merge targets require their incoming mappings to be resolved before removal.

Version **0.3.1** fixes slow Vocabulary review. Proposed concepts have pages, and original quotations load when you expand them. Confirmations preserve your place and unfinished edits. Queue & history links directly to Vocabulary instead of repeating its full issue list. Install the patch and reopen Smart Tags to continue your current review; no rebuild or repeated confirmation is required.

Version **0.3.0** adds stable evidence identities, one bounded reference-correction attempt, and actionable warning history. Version **0.2.0** adds global vocabulary consolidation and an expandable **Tags/Collections** navigator inside Zotero’s left pane. It retains the workspace layout inspired by [Notion’s sidebar and editor](https://www.notion.com/help/intro-to-workspaces), light/dark colors, and accessible dropdowns.

## Compact vocabulary and navigation

The default budget is **60 core concepts**, counting broad concepts and subtypes together. Category headings and user-created details do not count. Settings allows a limit of 1–500. Extra candidates stay outside the active vocabulary for review; scientifically different concepts must remain separate. Rebuilding caches factual summaries, concepts, validated quotes, and provider/model provenance independently of the taxonomy, then consolidates all papers together. Every library size uses an ID-based registry; representative source wording, quotations, and context are sent to the selected provider for consolidation. Immutable original evidence and provenance remain stored locally. Repeating an unchanged rebuild replaces its pending review with the cached consolidation result and reuses completed paper facts. You can start a new rebuild over a paused rebuild. Resume after a consolidation failure retries that stage without repeating completed paper analysis. Successful consolidation replies are checkpointed locally for interrupted-run recovery.

Prefer familiar abbreviations such as **FC**, **PEMFC**, and **AEMFC**. Full names, aliases, and definitions remain searchable. A subtype relation means “is a”; contextual links mean “related to.” A catalyst layer can be related to FC without becoming a type of FC. Only approved or historically protected identities require merge mappings. Invalid mappings are withheld for explicit review instead of aborting otherwise valid concepts; use **Discard invalid merge suggestions** before approval. Unaccepted-only rebuilds ignore obsolete merge bookkeeping. Cycles and ambiguous aliases block approval; chemical symbols such as `Co` and `CO` remain distinct.

After the first taxonomy approval, **Tags** becomes the default navigator. Broad concepts are visible under four categories; narrower branches expand as you browse. Expansion and selection have separate controls. Selecting FC finds its direct assignments and approved descendants, including AEMFC and PEMFC, without adding redundant FC tags to those papers. Assignment normally proposes up to five most-specific core concepts. A comparison paper can receive both subtypes.

Search matches names, full names, aliases, and definitions across the vocabulary, with deduplicated results and their locations. Clearing search restores the tree and retains selections. Multiple selections use **All** by default; **Any** is available. Shared details selected within a branch remain compound clauses: `(FC AND Schottky barrier) OR EIS`. Selecting a detail from global search finds it across fields.

Browsing and counts use the entire native personal library, including papers outside the pilot. Approved legacy names are recognized. Native title, metadata, PDF, note, and annotation quick search remains available. **Collections** restores the prior native collection selection, tag filters, search text, and item view. Item-list columns remain under Zotero’s control. Unsupported native interfaces leave Collections available.

**Save search** creates a native search with the current descendant/alias expansion. It captures a snapshot of the hierarchy: explicitly save an updated search after taxonomy changes. The navigator does not rewrite existing saved searches. A network visualization is deferred.

## AI connections and cost

**ChatGPT plan:** choose “ChatGPT plan”, then **Continue with ChatGPT**. The official OAuth flow requests permission for eligible Responses requests. Availability, allowed models, and plan limits depend on your account. A successful sign-in alone does not prove inference access: use **Discover models** and **Test connection**. Supported requests consume your plan allowance. The implementation uses the public OpenAI API, not private ChatGPT endpoints.

**OpenAI API key:** use your own Platform key; this is billed separately from a ChatGPT subscription. Save the key, enter the current input/output prices for your model, choose a per-run USD cap, and discover/select a model. Prices are explicit rather than hard-coded. Before each request the queue reserves a conservative estimate, including its configured output-token limit. Failed or usage-less requests retain their reservation because they may have incurred charges. This is a local run budget, not a platform-wide billing limit. Run estimates include factual extraction and the global consolidation request. PDF follow-ups and newly extracted facts can change the estimate; every request is checked against the cap before dispatch.

**DeepSeek API key:** choose **DeepSeek API key** in Settings and save a key from the [DeepSeek platform](https://platform.deepseek.com/). This uses DeepSeek’s separately billed API. Click **Discover models**, choose an available text model, enter its current USD input/output rates and a per-run budget, then click **Test connection**. Use the published peak rates, with cache-miss input pricing, for a conservative estimate; off-peak requests and cache hits may cost less. Consult [DeepSeek’s current model prices](https://api-docs.deepseek.com/quick_start/pricing/) for rates. Keys are encrypted and stored separately from OpenAI credentials. Switching providers clears the model selection and rate fields so you can choose values for the new provider.

DeepSeek uses its official Chat Completions endpoint with JSON output. Empty, truncated, or malformed responses are rejected before tag changes. All vocabulary review, evidence checks, remembered decisions, and undo protections apply to this connection too. The extension never switches between providers automatically.

**Test connection** sends a small real AI request through the selected connection. A plan quota failure pauses the run. Switching to paid API usage is always an explicit choice.

## Evidence identities and validation

Validated factual concepts, registry entries, and new vocabulary concepts receive locally allocated opaque identities. Each consolidation uses a persisted protocol-v2 snapshot with the exact selected papers and source revisions. Every library size uses `supportRegistryIds`; labels never serve as evidence identifiers. Presentation renames preserve links and coverage. Meaning or scope edits require revalidation. Original wording, quotations, and provider/model provenance remain intact.

AEMWE is preferred over repeated long/plural forms, with **anion-exchange membrane water electrolyzer** in details and AEMWEs/AEM-WE as searchable aliases. Ordinary core wording is lowercase with conservative singular forms. Scientific casing such as Co, CO, pH, and EIS remains protected. DIY names are unchanged.

Invalid or stale references appear against affected proposed tags. The queue can send **one automatic reference correction** through the selected connection within the existing budget. Its attempt survives pause/restart; Resume cannot silently reset it. If unresolved, inspect evidence, confirm uncertain scientific mappings, remove unsupported links/candidates, or explicitly **Regenerate proposal**. Known contradictions require correction or removal. Raw invalid model output stays private in consolidation diagnostics and never becomes native tag assignments.

## Active warnings and history

Warnings now identify their affected papers and processing phase, with **Dismiss** and **Dismiss all** controls. Dismissal is remembered; it does not claim that metadata or PDF evidence has been fixed. Successful reevaluation resolves only the corresponding paper/phase condition. Cached gaps recheck local PDF availability, including papers whose extraction jobs were already completed. Changed conditions supersede older episodes; recurring conditions can become active again.

Resolved, dismissed, superseded, and legacy notices are separate in **Queue & history**. Old string banners become historical, unverified notices because their original paper associations and dates are unknown. Reinstalling the extension retains profile state; it is not a warning-reset or data-repair operation.

## Custom topics and review

The initial **RCL** draft means “catalyst-layer resistance in water electrolysis or fuel cells.” Edit its definition, aliases, inclusion/exclusion rules, and example paper titles before approval. Matching does not require the acronym to appear. Scanned/unreadable PDFs remain an evidence gap; OCR and automatic PDF downloading are outside this version.

**Create detail** makes a shared user-defined tag, optionally linked to a concept for contextual browsing. It defaults to **Suggest matches**: preview evidence across existing papers, then review assignments. **Manual only** disables matching. **Automatic** requires explicit per-detail selection and the global automation/pilot gate. **Assign to selected papers** records a manual, locked assignment with undo. AI consolidation cannot create DIY details or use them to bypass the core budget.

Selected papers, selected collections (including descendants), the 50-paper pilot, and the whole personal library are supported. Group libraries, notes, and child attachments are excluded from tagging targets. Imported automatic tags are retained as source-keyword evidence; they are not universally identifiable as original author keywords.

**Review → Find cleanup proposals** previews case/spelling duplicates and approved aliases. Native renaming/merging is a separate reviewed operation; taxonomy approval changes no native tag names. Merges display affected manual assignments and require explicit application. Recognized legacy assignments prevent duplicate canonical assignments. Historical IDs, stricter rejection/lock decisions, and undo journals remain available after consolidation; conflicting decisions are surfaced before approval.

Existing manual tags are never acquired as extension-owned assignments. Manual removal, rejections, and locks are remembered. Obsolete extension-owned tags receive review-only removal proposals. History undo checks for later edits and refuses to overwrite conflicting changes. Native Zotero undo is also available for applied batches.

Under **Explore library**, combine hierarchical tags, inspect related papers, and save All/Any searches. Related papers are local text/concept similarity suggestions, not citation links. Project membership, reading status, and “fundamental” selections remain user decisions. Collections can overlap without duplicating papers.

## Local storage

Definitions, source metadata, selected PDF passages, proposals, decisions, queue checkpoints, and change journals live in `smart-tags/state.json` inside the current Zotero profile. Atomic writes keep a previous `.bak` generation. An interrupted native write is reconciled against its recorded before/after tag snapshots on startup.

The schema-v3 migration first retains an exact-byte **state.json.pre-v3.json** backup, then writes the migrated state atomically. Existing different backups receive numbered suffixes and are never overwritten; older pre-v2 backups remain intact. Your old drafts become consolidation input. Superseded definitions are archived after approval; restoring an archive stages a proposal for review. Native tags remain untouched throughout taxonomy review. Do not restore an old schema file over newer native changes without checking the associated history.

Completed factual extraction keeps its original extractor version during upgrade. A paused 51-paper run can resume at consolidation, using the retained evidence without repeating unchanged paper extraction. Incompatible name-based checkpoints and pending proposals are invalidated; settings, spent budget, manual choices, native tags, and history remain intact. See [migration notes](MIGRATION.md).

API keys and OAuth credentials use the operating-system keystore plus a plugin-specific LoginManager realm. If encryption is unavailable, credentials remain in memory for that session. Credentials are excluded from vocabulary exports, manager snapshots, and source packages. Do not share the profile state file as a vocabulary export: it contains library metadata.

Vocabulary JSON import/export is available in Vocabulary. Imported new definitions are drafts. Settings/definitions do not automatically sync across devices in this version. Model requests send the selected metadata or locally extracted PDF passages to the explicitly selected OpenAI or DeepSeek connection.

Schema-v1/v2 vocabulary exports remain importable. A private `zotero-smart-tags-proposal` JSON can also be imported as a staged proposal, provided its source vocabulary fingerprint and version still match. Use **Export proposal with evidence…** to export a staged ID-based proposal, its immutable evidence snapshot, and factual sources. This explicitly contains private paper wording and quotations; normal definition export remains separate. Imported source identities and quotations are validated, and uncertain meanings require fresh confirmation. Unique equivalent registry identities from different catalogs are recorded as canonical import mappings.

## Build and validation

Node.js 24 and npm are required for development; end users install only the XPI.

```powershell
npm ci
npm run verify
```

`npm run check` runs strict TypeScript checking; `npm test` runs the domain, provider, controller, persistence, and native-adapter regression suites using Node's test runner. `npm run build` bundles the extension and creates the XPI. Tests use synthetic papers and mocked network responses; they do not read your credentials or modify your working library.

The development native smoke harness uses a separate profile **and** data directory under this workspace. It is excluded from the installable XPI. Its `--open-manager` flag opens the interface for visual checks; `--light-theme` sets light-theme preferences in that isolated test profile. Real ChatGPT eligibility and API-key inference are user-account checks performed from Settings.

MIT licensed. See [LICENSE](LICENSE).

References: [Zotero 10 plugin APIs](https://www.zotero.org/support/dev/zotero_10_for_developers), [official ChatGPT plan integration](https://developers.openai.com/siwc/token-sharing-open-source), [integration limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [OpenAI API prices](https://developers.openai.com/api/docs/pricing), [DeepSeek API documentation](https://api-docs.deepseek.com/), [DeepSeek JSON output](https://api-docs.deepseek.com/guides/json_mode/).
