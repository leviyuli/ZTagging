# Smart Tags for Zotero

A local, open-source extension for **Zotero 10.0.6–10.0.x on Windows**. It prepares a consistent tag list, asks about scientific meanings that need your choice, and proposes paper tags for review. Your existing item-list columns and collections stay in place.

## Install and start

1. In Zotero, open **Tools → Plugins**, choose the gear menu, then **Install Plugin From File…** (some versions label this “Install Add-on From File…”).
2. Select [`smart-tags-0.4.0.xpi`](https://github.com/leviyuli/ZTagging/raw/refs/heads/main/dist/smart-tags-0.4.0.xpi).
3. Open **Tools → Smart Tags…**. Navigation lives in the left pane; the right-hand item and information panes remain unchanged.
4. In **Settings**, configure ChatGPT, an OpenAI API key, or a DeepSeek API key; discover/select a text-capable model, then click **Test connection**.
5. Choose **Pilot · 50 papers** on Overview and click **Prepare tags**. Smart Tags reads the papers, brings related concepts together, and checks names, categories, and scientific meanings using your selected model.
6. Open **Tags**. Browse the suggested tags, edit or remove entries, and answer any items in **Questions**. When the list is ready, click **Apply tag list**. This saves the vocabulary and starts paper-tag suggestions for the same papers.
7. Open **Paper suggestions**, inspect the supporting passages, and accept or reject matches. Use **Apply accepted…** or **Review selected changes**, then confirm the displayed batch. This separate action writes native Zotero tags and records an undoable change.
8. Mark the completed tagging pilot reviewed. You can then enable automatic assignment for incoming papers. Applying or editing the active core vocabulary resets this gate; editing a DIY detail refreshes only that detail’s suggestions.

The classifier usually proposes up to five core tags plus matching custom tags; it does not pad papers to a minimum. Routine assignment uses approved definitions. New topics are presented for vocabulary review rather than silently added as native tags.

The extension checks this repository's [update manifest](updates.json) for new versions. Each published installer has a SHA-256 hash in that manifest. You can also update manually by installing a newer XPI.

Release downloads contain the installer and TypeScript source archive. Read the [changelog](CHANGELOG.md) and [migration notes](MIGRATION.md) when upgrading an existing review.

Version **0.4.0** replaces routine mapping confirmations with automatic scientific checks and a short Questions view. Each preparation run can make up to **three additional AI requests** to improve the initial tag list. The preferred count of **60 tags is a starting point**, allowing distinct topics to remain separate. Preparing or applying the tag list creates no native paper-tag changes; those wait for your reviewed batch Apply.

The expandable **Tags/Collections** navigator stays in Zotero’s left pane. The manager retains its workspace layout inspired by [Notion’s sidebar and editor](https://www.notion.com/help/intro-to-workspaces), light/dark colors, and accessible dropdowns.

## Compact vocabulary and navigation

The default preference is **60 tags**, counting broad concepts and subtypes together. Category headings and user-created details do not count toward that preference. **Settings → Preferred number of tags** accepts 1–500. A useful list may exceed the preferred count; distinct scientific concepts are kept separate rather than merged to reach a number.

Paper analysis is cached independently of the tag list. Factual summaries, concepts, validated quotations, and provider/model provenance remain reusable as the library grows. Preparation consolidates the selected papers together and checks the source context behind each concept. Unsupported generated topics can be left out, familiar abbreviations normalized, and categories corrected. Your DIY names, remembered decisions, and saved edits remain protected. When the source context leaves a real choice, **Questions** presents the alternatives with affected papers.

An unchanged rebuild reuses completed facts and saved consolidation output. You can prepare a new list over a paused, unapproved rebuild; it replaces the pending review while retaining cached paper analysis. Pause or close Zotero during a run, then resume from saved progress. Changed metadata or newly available PDF evidence refreshes affected papers.

Prefer familiar abbreviations such as **FC**, **PEMFC**, and **AEMFC**. Full names, aliases, and definitions remain searchable. A subtype relation means “is a”; contextual links mean “related to.” A catalyst layer can be related to FC without becoming a type of FC. Scientific checks keep these relationships separate, reject contradictory meanings, and preserve chemical distinctions such as `Co` and `CO`.

After the first tag list is applied, **Tags** becomes the default navigator. Broad tags are visible under four categories; narrower branches expand as you browse. Expansion and selection have separate controls. Selecting FC finds its direct assignments and approved descendants, including AEMFC and PEMFC, without adding redundant FC tags to those papers. Assignment normally proposes up to five most-specific tags. A comparison paper can receive both subtypes.

Search matches names, full names, aliases, and definitions across the vocabulary, with deduplicated results and their locations. Clearing search restores the tree and retains selections. Multiple selections use **All** by default; **Any** is available. Shared details selected within a branch remain compound clauses: `(FC AND Schottky barrier) OR EIS`. Selecting a detail from global search finds it across fields.

Browsing and counts use the entire native personal library, including papers outside the pilot. Approved legacy names are recognized. Native title, metadata, PDF, note, and annotation quick search remains available. **Collections** restores the prior native collection selection, tag filters, search text, and item view. Item-list columns remain under Zotero’s control. Unsupported native interfaces leave Collections available.

**Save search** creates a native search with the current descendant/alias expansion. It captures a snapshot of the hierarchy: explicitly save an updated search after taxonomy changes. The navigator does not rewrite existing saved searches. A network visualization is deferred.

## AI connections and cost

**ChatGPT plan:** choose “ChatGPT plan”, then **Continue with ChatGPT**. The official OAuth flow requests permission for eligible Responses requests. Availability, allowed models, and plan limits depend on your account. A successful sign-in alone does not prove inference access: use **Discover models** and **Test connection**. Supported requests consume your plan allowance. The implementation uses the public OpenAI API, not private ChatGPT endpoints.

**OpenAI API key:** use your own Platform key; this is billed separately from a ChatGPT subscription. Save the key, enter the current input/output prices for your model, choose a per-run USD cap, and discover/select a model. Prices are explicit rather than hard-coded. Before each request the queue reserves a conservative estimate, including its configured output-token limit. Failed or usage-less requests retain their reservation because they may have incurred charges. This is a local run budget, not a platform-wide billing limit. Run estimates include factual extraction and the initial consolidation. PDF follow-ups, preparation checks, and paper-assignment analysis can add requests; every request is checked against the cap before dispatch.

**DeepSeek API key:** choose **DeepSeek API key** in Settings and save a key from the [DeepSeek platform](https://platform.deepseek.com/). This uses DeepSeek’s separately billed API. Click **Discover models**, choose an available text model, enter its current USD input/output rates and a per-run budget, then click **Test connection**. Use the published peak rates, with cache-miss input pricing, for a conservative estimate; off-peak requests and cache hits may cost less. Consult [DeepSeek’s current model prices](https://api-docs.deepseek.com/quick_start/pricing/) for rates. Keys are encrypted and stored separately from OpenAI credentials. Switching providers clears the model selection and rate fields so you can choose values for the new provider.

DeepSeek uses its official Chat Completions endpoint with JSON output. Empty, truncated, or malformed responses cannot authorize tag changes. All scientific checks, remembered decisions, and undo protections apply to this connection too. The extension never switches between providers automatically.

**Test connection** sends a small real AI request through the selected connection. A plan quota failure pauses the run. Switching to paid API usage is always an explicit choice.

## Evidence identities and validation

Validated factual concepts, registry entries, and new vocabulary concepts receive locally allocated opaque identities. Each consolidation uses a persisted protocol-v2 snapshot with the exact selected papers and source revisions. Every library size uses `supportRegistryIds`; labels never serve as evidence identifiers. Presentation renames preserve links and coverage. Meaning or scope edits require revalidation. Original wording, quotations, and provider/model provenance remain intact.

AEMWE is preferred over repeated long/plural forms, with **anion-exchange membrane water electrolyzer** in details and AEMWEs/AEM-WE as searchable aliases. Ordinary core wording is lowercase with conservative singular forms. Scientific casing such as Co, CO, pH, and EIS remains protected. DIY names are unchanged.

After the initial consolidation, preparation can send **up to three additional checks** through the selected provider and model, within the same budget controls. These requests can repair evidence references, assess scientific relevance, and improve generated definitions. Valid provenance alone does not establish that a passage supports a concept. Contradictory evidence remains blocked; genuine ambiguity becomes a researcher question.

The attempt count and completed responses survive pause/restart. A budget rejection before dispatch does not consume an attempt; a dispatched request does. Resume continues saved work. After unsuccessful checks, **Try again** explicitly starts another bounded preparation run while retaining prior replies, choices, and spent budget. Your connection stays unchanged unless you select another one in Settings. Preparing tags does not enable unattended assignment.

## Active warnings and history

**Activity** shows actionable notices with affected-paper links, **Dismiss**, and **Dismiss all** controls. Dismissal is remembered; successful reevaluation resolves only the corresponding paper and processing phase. Cached gaps recheck local PDF availability, including papers whose extraction jobs were already completed. Changed conditions supersede older episodes; recurring conditions can become active again. Unfamiliar-topic notices clear when a fresh analysis of that paper and phase no longer finds the condition. Completed merge reviews go straight to history.

Resolved, dismissed, superseded, and legacy notices remain in Activity’s history. Old string banners remain historical, unverified notices because their original paper associations and dates are unknown. Successful actions use brief confirmations instead of persistent warning banners.

## Custom topics and review

The initial **RCL** draft means “catalyst-layer resistance in water electrolysis or fuel cells.” Edit and save its definition, aliases, inclusion/exclusion rules, and example paper titles before matching it. Matching does not require the acronym to appear. Scanned/unreadable PDFs remain an evidence gap; OCR and automatic PDF downloading are outside this version.

**Add tag** makes a shared user-defined topic, optionally linked to a concept for contextual browsing. It defaults to **Suggest matches**: preview evidence across existing papers, then review assignments. **Manual only** disables matching. **Automatic** requires explicit per-detail selection and the global automation/pilot gate. **Assign to selected papers** records a manual, locked assignment with undo. AI preparation does not create DIY details.

Selected papers, selected collections (including descendants), the 50-paper pilot, and the whole personal library are supported. Group libraries, notes, and child attachments are excluded from tagging targets. Imported automatic tags are retained as source-keyword evidence; they are not universally identifiable as original author keywords.

**Settings → Find older tag duplicates** previews case/spelling duplicates and approved aliases. Native renaming/merging is a separate reviewed operation. Merges display affected manual assignments and require explicit application. Recognized legacy assignments prevent duplicate canonical assignments. Historical IDs, rejection/lock decisions, and undo journals remain available after tag preparation.

Existing manual tags are never acquired as extension-owned assignments. Manual removal, rejections, and locks are remembered. Obsolete extension-owned tags receive review-only removal proposals. History undo checks for later edits and refuses to overwrite conflicting changes. Native Zotero undo is also available for applied batches.

Under **Find papers**, combine hierarchical tags, inspect related papers, and save All/Any searches. Related papers are local text/concept similarity suggestions, not citation links. Project membership, reading status, and “fundamental” selections remain user decisions. Collections can overlap without duplicating papers.

## Local storage

Definitions, source metadata, selected PDF passages, proposals, decisions, queue checkpoints, and change journals live in `smart-tags/state.json` inside the current Zotero profile. Atomic writes keep a previous `.bak` generation. An interrupted native write is reconciled against its recorded before/after tag snapshots on startup.

Version 0.4.0 migrates to **state schema 4** after creating an exact-byte **state.json.pre-v4.json** backup. Different existing backups receive numbered suffixes and remain untouched. Schema-3 pending reviews, saved edits, human choices, factual evidence, settings, and spent budget are retained. The earlier correction counter remains in its history; the new preparation stage has its own bounded attempts. Completed factual extraction keeps its original extractor version. See [migration notes](MIGRATION.md).

Unused legacy generated drafts are removed from extension definitions only when an original backup proves their definitions are unchanged and no active or historical references need them. DIY, edited, approved, and referenced definitions remain. If that baseline is unavailable, definitions are kept. This cleanup creates no separate legacy archive and removes no native paper tags. Regular approved vocabulary history and undo journals remain available. The store refuses newer state schemas rather than overwriting them through an older backup.

API keys and OAuth credentials use the operating-system keystore plus a plugin-specific LoginManager realm. If encryption is unavailable, credentials remain in memory for that session. Credentials are excluded from vocabulary exports, manager snapshots, and source packages. Do not share the profile state file as a vocabulary export: it contains library metadata.

Tag JSON import/export is under **Settings → Import, export, and previous tag lists**. Imported new definitions are drafts. Settings/definitions do not automatically sync across devices in this version. Model requests send the selected metadata or locally extracted PDF passages to the explicitly selected OpenAI or DeepSeek connection.

Older vocabulary exports remain importable. A private `zotero-smart-tags-proposal` JSON can also be imported as a staged proposal, provided its source vocabulary fingerprint and version still match. **Export analysis with paper text…** includes the current ID-based proposal, its immutable evidence snapshot, and factual sources. It contains private paper wording and quotations; **Export tags…** contains definitions only. Imported source identities and quotations are validated. Scientific checks and any remaining researcher questions run before the list is applied. Unique equivalent registry identities from different catalogs are recorded as canonical import mappings.

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
