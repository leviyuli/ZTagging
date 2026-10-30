# Smart Tags for Zotero

A local, open-source extension for **Zotero 10.0.6–10.0.x on Windows**. It prepares a consistent tag list, asks about scientific meanings that need your choice, and proposes paper tags for review. Your existing item-list columns and collections stay in place.

## Install and start

1. In Zotero, open **Tools → Plugins**, choose the gear menu, then **Install Plugin From File…** (some versions label this “Install Add-on From File…”).
2. Select [`smart-tags-0.7.1.xpi`](https://github.com/leviyuli/ZTagging/raw/refs/heads/main/dist/smart-tags-0.7.1.xpi).
3. Open **Tools → Smart Tags…**. Navigation lives in the left pane; the right-hand item and information panes remain unchanged.
4. Open **Connect AI**. Configure ChatGPT, an OpenAI API key, or a DeepSeek API key; discover/select a text-capable model, then click **Test connection**.
5. Open **Build tags**. Start with **Pilot · 50 papers**, or choose selected papers, selected collections, or the whole library, then click **Prepare tags**. This group supplies the information used to build your tag list.
6. Open **Review & clean up**. Browse the suggested tags, edit or remove entries, answer any scientific questions, and compare existing native tags when needed. Click **Apply tag list** to save the tag library. This does not start assignment or write paper tags.
7. Open **Assign & automate** and choose the papers that should receive tags. This is a separate group, initially **Whole personal library**. Click **Suggest paper tags**, review the matches in **Paper suggestions**, then confirm a separate batch Apply to write native Zotero tags with undo. You can assign beyond the papers used to build the list.
8. Use **Run assignment pilot**, review its suggestions, and mark the pilot reviewed before explicitly enabling automatic assignment for incoming papers. Changing the active core vocabulary resets this gate; creating DIY details or confirming an equivalent legacy alias preserves it.

The classifier usually proposes up to five core tags plus matching custom tags; it does not pad papers to a minimum. Routine assignment uses approved definitions. New topics are presented for vocabulary review rather than silently added as native tags.

The extension checks this repository's [update manifest](updates.json) for new versions. Each published installer has a SHA-256 hash in that manifest. You can also update manually by installing a newer XPI.

Release downloads contain the installer and TypeScript source archive. Read the [changelog](CHANGELOG.md), [migration notes](MIGRATION.md), and [validation report](VALIDATION.md) when upgrading an existing review.

Version **0.7.1** fixes selection pauses caused by generated aliases colliding with DIY names. After updating, **Resume** or **Retry this step** rechecks the saved complete reply locally before requesting another one. Prior replies, repair counters, spending, and completed paper analysis stay intact. Source-checking requests now send the frozen tag meanings without repeatedly sending search aliases or administrative fields; the full definitions and original paper evidence remain stored unchanged.

Version **0.7.0** chooses a compact global tag list, then checks the saved findings against it. It replaces repeated batch merging with a finite queue and favors topics useful across the largest body of papers in your chosen group. The workflow remains **Connect AI → Build tags → Review & clean up → Assign & automate**, with independent build and assignment groups. Preparing or applying the tag list creates no native paper-tag changes; those wait for your reviewed batch Apply.

## Keep using and extending your tag library

Use **Tag library → Add tag** for a DIY topic, or edit an existing definition. A topic can be useful even when no current paper matches it. Matching and assignment keep their existing suggestion, review, and manual-choice protections.

For papers from another field, open **Build tags**, select those papers or their collections, and use **Extend my saved tag list**. This is the default after a tag list has been applied. New suggestions are compared with the applied definitions; equivalent topics reuse existing identities, while subtypes and related topics remain separate. Tags outside this new sample stay in your library. Review the additions and apply the list, then choose the whole library or a different assignment group on **Assign & automate**.

**Replace full tag list** remains an explicit option when you intend to reorganize the complete vocabulary. Review that proposal before applying it. Both modes leave native paper tags unchanged until a separate reviewed paper-tag operation. Neither mode enables incoming-paper automation.

The expandable **Smart Tags/Collections** navigator stays in Zotero’s left pane. In Settings, **Show tag navigation** opens it and **Restore navigation** retries attachment to the library window. The manager retains its workspace layout inspired by [Notion’s sidebar and editor](https://www.notion.com/help/intro-to-workspaces), light/dark colors, and accessible dropdowns.

## Compact vocabulary and navigation

The default preference is **60 tags**, counting broad concepts and subtypes together. Category headings and user-created details do not count toward that preference. **Settings → Preferred number of tags** accepts 1–500. A useful list may exceed the preferred count; distinct scientific concepts are kept separate rather than merged to reach a number.

Paper analysis is cached independently of the tag list. Factual summaries, concepts, validated quotations, and provider/model provenance remain reusable as the library grows. Preparation consolidates the selected papers together and checks the source context behind each concept. Unsupported generated topics can be left out, familiar abbreviations normalized, and categories corrected. Your DIY names, remembered decisions, and saved edits remain protected. When the source context leaves a real choice, **Questions** presents the alternatives with affected papers.

An unchanged rebuild reuses completed facts and saved consolidation output. You can prepare a new list over a paused, unapproved rebuild; it replaces the pending review while retaining cached paper analysis. Pause or close Zotero during a run, then resume from saved progress. Changed metadata or newly available PDF evidence refreshes affected papers.

Tag selection starts with a local census of unique-paper support and sparse text similarity. It ranks useful topics with diminishing returns for repeatedly covering the same paper and category, without quotas for smaller fields. Similarity helps route candidates; it does not establish synonymy or scientific evidence. A bounded global shortlist supplies the model with names, coverage counts, and representative context. The model proposes reusable meanings, and a local selection pass keeps the useful core plus necessary parents. Unselected details remain in the factual catalog for later use rather than becoming automatic DIY tags.

Once names and meanings are fixed, Smart Tags checks factual sources in batches of up to **128 findings and 90 KB**, with smaller batches when the response limit requires them. Up to two independent requests can run concurrently. Each finding receives a supported mapping, an outside-core disposition, or an explicit information gap. A source sharing another paper's keyword or registry label does not inherit its approval. Parent coverage uses validated child findings. An outside-core finding never automatically becomes no_tag.

Progress shows **Choosing tags → Checking supporting findings → Ready for review**, with a fixed total of unique findings. It also shows known queued requests and a separate correction allowance. There is no elapsed-time prediction. Your selected provider and budget apply to every dispatch; parallel requests reserve funds before sending. Completed replies and counters survive restart. Authentication, quota, permission, connection, budget, and exhausted technical repairs can still pause the run. **Retry this step** explicitly retries failed technical work without discarding completed checks or resetting spending.

## Dismiss or exclude an item

In **Activity**, open **More** beside a paper for **Dismiss**, **Exclude from tagging**, and other applicable choices. Selecting papers reveals batch controls; **Actions** holds secondary batch choices. Clicking a paper's title opens it in Zotero. Empty views keep only search, the status filter, and the panel's **More** menu.

**Dismiss** hides the current information notice. It does not repair the item or remove it from tagging. An unchanged local recheck or restart keeps the notice dismissed; changed information can make it appear again.

**Exclude from tagging** previews adding the native **no_tag** marker. Applying the preview preserves the item's other tags, collections, attachments, and metadata, and skips that item in future builds and assignments. Use **Excluded from tagging → Include again** to preview removing only no_tag, or undo the change in History. The panel's **More → Exclude selected Zotero items…** also works for items outside the current build. These manual choices need no AI connection. A one-build **Skip** remains a separate option.

For whole-list assignment, the model may suggest **no_tag** when readable evidence establishes that none of the approved scientific tags applies. This suggestion requires separate batch Apply and does not enable automation. Missing abstracts, unreadable PDFs, empty replies, and connection failures are not evidence of an outside-vocabulary item. A DIY-only preview cannot make this whole-list judgment. The built-in marker is searchable in the navigator, does not count toward the preferred tag target, and cannot be renamed or turned into a DIY topic.

Prefer familiar abbreviations such as **FC**, **PEMFC**, and **AEMFC**. Full names, aliases, and definitions remain searchable. A subtype relation means “is a”; contextual links mean “related to.” A catalyst layer can be related to FC without becoming a type of FC. Scientific checks keep these relationships separate, reject contradictory meanings, and preserve chemical distinctions such as `Co` and `CO`.

After the first tag list is applied, **Smart Tags** becomes the default navigator. Broad tags are visible under four categories; narrower branches expand as you browse. Expansion and selection have separate controls. Selecting FC finds its direct assignments and approved descendants, including AEMFC and PEMFC, without adding redundant FC tags to those papers. Assignment normally proposes up to five most-specific tags. A comparison paper can receive both subtypes.

Search matches names, full names, aliases, and definitions across the vocabulary, with deduplicated results and their locations. Clearing search restores the tree and retains selections. Multiple selections use **All** by default; **Any** is available. Shared details selected within a branch remain compound clauses: `(FC AND Schottky barrier) OR EIS`. Selecting a detail from global search finds it across fields.

Browsing and counts use the entire native personal library, including papers outside the pilot. Approved legacy names are recognized. Native title, metadata, PDF, note, and annotation quick search remains available. **Collections** restores the prior native collection selection, tag filters, search text, and item view. Item-list columns remain under Zotero’s control. Unsupported native interfaces leave Collections available.

**Save search** creates a native search with the current descendant/alias expansion. It captures a snapshot of the hierarchy: explicitly save an updated search after taxonomy changes. The navigator does not rewrite existing saved searches. A network visualization is deferred.

## AI connections and cost

**ChatGPT plan:** choose “ChatGPT plan”, then **Continue with ChatGPT**. The official OAuth flow requests permission for eligible Responses requests. Availability, allowed models, and plan limits depend on your account. A successful sign-in alone does not prove inference access: use **Discover models** and **Test connection**. Supported requests consume your plan allowance. The implementation uses the public OpenAI API, not private ChatGPT endpoints.

If OpenAI says **“This account can't access this app”** because the app belongs to another workspace, cancel the pending sign-in in Smart Tags, then choose **Use another account or workspace**. Sign in with the intended account and select the workspace with your eligible plan. This starts a new connection and keeps saved accounts available. Ordinary Continue reconnects an existing connection, which remains bound to its original workspace; signing out alone does not change that binding. See the [OpenAI account-switching documentation](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

**OpenAI API key:** use your own Platform key; this is billed separately from a ChatGPT subscription. Save the key, enter the current input/output prices for your model, choose a per-run USD cap, and discover/select a model. Prices are explicit rather than hard-coded. Before each request the queue reserves a conservative estimate, including its configured output-token limit. Failed or usage-less requests retain their reservation because they may have incurred charges. This is a local run budget, not a platform-wide billing limit. Estimates cover known queued work; the mapping queue becomes known after the tag list is chosen. Follow-ups, repairs, and paper-assignment analysis can add requests; every request is checked against the cap before dispatch.

**DeepSeek API key:** choose **DeepSeek API key** in Connect AI and save a key from the [DeepSeek platform](https://platform.deepseek.com/). This uses DeepSeek’s separately billed API. Click **Discover models**, choose an available text model, enter its current USD input/output rates and a per-run budget, then click **Test connection**. Use the published peak rates, with cache-miss input pricing, for a conservative estimate; off-peak requests and cache hits may cost less. Consult [DeepSeek’s current model prices](https://api-docs.deepseek.com/quick_start/pricing/) for rates. Keys are encrypted and stored separately from OpenAI credentials. Switching providers clears the model selection and rate fields so you can choose values for the new provider.

DeepSeek uses its official Chat Completions endpoint with JSON output. Empty, truncated, or malformed responses cannot authorize tag changes. All scientific checks, remembered decisions, and undo protections apply to this connection too. The extension never switches between providers automatically.

**Test connection** sends a small real AI request through the selected connection. A plan quota failure pauses the run. Switching to paid API usage is always an explicit choice.

## Evidence identities and validation

Validated factual concepts, registry entries, and new vocabulary concepts receive locally allocated opaque identities. Each consolidation uses a persisted protocol-v2 snapshot with the exact selected papers and source revisions. Requests provide short references scoped to their current inputs; replies expand locally to those exact persistent identities. Historical `supportRegistryIds` and candidate-ID replies remain readable. Labels never serve as evidence identifiers. Presentation renames preserve links and coverage. Meaning or scope edits require revalidation. Original wording, quotations, and provider/model provenance remain intact.

AEMWE is preferred over repeated long/plural forms, with **anion-exchange membrane water electrolyzer** in details and AEMWEs/AEM-WE as searchable aliases. Ordinary core wording is lowercase with conservative singular forms. Scientific casing such as Co, CO, pH, and EIS remains protected. DIY names are unchanged.

After the global draft, selection allows **up to three additional semantic repair requests** before freezing meanings. Ordinary source-mapping batches have their own finite queue and do not consume that three-request allowance. Each mapping task permits one malformed-output correction and an insufficient-context source permits one contextual follow-up. Valid provenance alone does not establish that a passage supports a concept. Contradictory evidence remains blocked; genuine ambiguity becomes a researcher question.

The attempt count and completed responses survive pause/restart. A budget rejection before dispatch does not consume an attempt; a dispatched request does. Resume continues saved work. **Retry this step** explicitly retries failed selection or mapping work while retaining prior replies, choices, and spent budget. Historical reviews retain their **Try again** preparation action. Your connection stays unchanged unless you select another one in Connect AI. Preparing tags does not enable unattended assignment.

## Recovering paper information

Open **Activity → Papers that need attention**. Each paper appears once, with a status such as **Ready to use**, **Needs information**, or **Analysis failed**. A paper with validated concepts remains usable when the model asks for additional context. That request does not mean its validated passages were lost or its analysis failed.

Use **Open in Zotero** to inspect the record. **Find metadata** searches through Zotero’s identifier translators using a DOI, PMID, ISBN, or arXiv identifier. You can supply an identifier with **Find with identifier**. Review the proposed additions, then choose **Apply metadata**. Only empty supported bibliographic fields and an empty creator list can be filled; existing values, item type, native tags, and collections are preserved. A result must confirm the identifier, and conflicting or ambiguous results are left for review. Lookup does not create another library item or download attachments.

**Recheck PDF** checks locally attached files and explicitly retries local text indexing. It distinguishes a missing attachment, a file unavailable locally, readable text, unavailable text, a read error, and an unverified state. It does not download the PDF or run OCR. When text is unavailable, inspect the attachment in Zotero and provide a local readable copy or improve its metadata.

After improving the inputs, choose **Retry analysis** or **Retry selected**. These are explicit model requests through your chosen connection, subject to its budget and authentication controls. Requested recovery work waits behind an ongoing library build. Applying metadata also queues a retry for the affected paper. Old factual evidence is retained in local history; only affected analysis is refreshed. **Skip for this build** excludes a paper from the current build without removing its item or native tags. Manual native tags and DIY assignments remain available and do not become factual evidence merely because you assigned them.

## Notices and history

**Activity** keeps evidence-related paper recovery separate from other notices, which retain affected-paper links, **Dismiss**, and **Dismiss all** controls. Dismissal is remembered; successful reevaluation resolves only the corresponding paper and processing phase. Dismissal acknowledges a condition rather than repairing its inputs. Cached gaps recheck local PDF availability, including papers whose extraction jobs were already completed. Changed conditions supersede older episodes; recurring conditions can become active again. Unfamiliar-topic notices clear when a fresh analysis of that paper and phase no longer finds the condition. Completed merge reviews go straight to history.

Resolved, dismissed, superseded, and legacy notices remain in Activity’s history. Old string banners remain historical, unverified notices because their original paper associations and dates are unknown. Successful actions use brief confirmations instead of persistent warning banners.

## Custom topics and review

The initial **RCL** draft means “catalyst-layer resistance in water electrolysis or fuel cells.” Edit and save its definition, aliases, inclusion/exclusion rules, and example paper titles before matching it. Matching does not require the acronym to appear. If metadata provides insufficient support and PDF text is unavailable, use the paper-recovery actions in Activity. OCR and automatic PDF downloading are outside this version.

**Add tag** makes a shared user-defined topic, optionally linked to a concept for contextual browsing. It defaults to **Suggest matches**: preview evidence across existing papers, then review assignments. **Manual only** disables matching. **Automatic** requires explicit per-detail selection and the global automation/pilot gate. **Assign to selected papers** records a manual, locked assignment with undo. AI preparation does not create DIY details.

Selected papers, selected collections (including descendants), the 50-paper pilot, and the whole personal library are supported. Group libraries, notes, and child attachments are excluded from tagging targets. Imported automatic tags are retained as source-keyword evidence; they are not universally identifiable as original author keywords.

## Reviewing existing Zotero tags

Open **Existing tags → Read library tags** to list native names, affected-paper counts, and manual assignments across the personal library. Before applying a Smart Tags list, this is an inventory. After applying one, matching uses the approved vocabulary rather than treating an unapproved draft as authoritative.

Select names and choose **Analyze selected names** when their meaning needs paper context. Review results per paper: a broad label such as FC may stay broad, or a paper may support AEMFC, PEMFC, or both. Related concepts are not automatically merged. Scientific symbols such as Co and CO remain distinct. Unmatched names stay available until you choose an action.

Choose **Use matched Smart Tags name**, **Remove from papers**, or **Keep as it is**, then **Review paper changes**. Inspect the exact before/after labels before **Apply reviewed tag changes**. This workflow can change the displayed existing manual tags because you explicitly review that cleanup; ordinary automatic assignment continues to preserve manual choices. Locks and remembered rejections remain protected unless you explicitly replace the earlier choice for the affected paper. Approved equivalent legacy names can also be retained as aliases, avoiding duplicate assignments during later tagging.

Select niche names and choose **Create DIY tags…** to define shared details outside the core vocabulary. Keep or edit the name and optionally supply its meaning. When needed, **Analyze and create DIY tags** uses the chosen model to interpret the selected names and paper context; ambiguous meanings require your input. Created definitions default to suggestion-only matching. Creating these definitions does not rename the existing native assignments or enable automatic matching. Definitions and reviewed native cleanup batches have separate undo records in **Activity**.

Existing manual tags are never acquired as extension-owned assignments. Manual removal, rejections, and locks are remembered. Obsolete extension-owned tags receive review-only removal proposals. History undo checks for later edits and refuses to overwrite conflicting changes. Native Zotero undo is also available for applied batches.

Under **Find papers**, combine hierarchical tags, inspect related papers, and save All/Any searches. Related papers are local text/concept similarity suggestions, not citation links. Project membership, reading status, and “fundamental” selections remain user decisions. Collections can overlap without duplicating papers.

## Local storage

Definitions, source metadata, selected PDF passages, proposals, decisions, queue checkpoints, and change journals live in `smart-tags/state.json` inside the current Zotero profile. Atomic writes keep a previous `.bak` generation. Interrupted native changes are reconciled against their recorded tag or metadata snapshots on startup. Definition changes are journaled with affected IDs; recovery and undo preserve unrelated definitions and refuse conflicting later edits.

Version 0.7.0 migrates to **state schema 6** after creating an exact-byte **state.json.pre-v6.json** backup. Different existing backups receive numbered suffixes and remain untouched. Existing reviews, saved edits, human choices, factual evidence, completed jobs, queue responses, settings, and spending are retained. Migration sends no model request. **Resume** switches an unfinished legacy build to the new selector using its saved facts and snapshot; the old consolidation record remains available as audit data. Factual extraction, terminology, and historical proof versions remain unchanged. New proposals use source-validation policy 3 with explicit source-specific decisions. See [migration notes](MIGRATION.md).

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

The development native smoke harness uses a separate profile **and** data directory under this workspace. It is excluded from the installable XPI. Its `--open-manager` flag opens the interface for visual checks; `--light-theme` sets light-theme preferences in that isolated test profile. Real ChatGPT eligibility and API-key inference are user-account checks performed from Connect AI.

MIT licensed. See [LICENSE](LICENSE).

References: [Zotero 10 plugin APIs](https://www.zotero.org/support/dev/zotero_10_for_developers), [official ChatGPT plan integration](https://developers.openai.com/siwc/token-sharing-open-source), [integration limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [OpenAI API prices](https://developers.openai.com/api/docs/pricing), [DeepSeek API documentation](https://api-docs.deepseek.com/), [DeepSeek JSON output](https://api-docs.deepseek.com/guides/json_mode/).
