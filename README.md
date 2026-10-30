# Smart Tags for Zotero

A local, open-source extension for **Zotero 10.0.6–10.0.x on Windows**. It prepares a consistent tag list, asks about scientific meanings that need your choice, and proposes paper tags for review. Your existing item-list columns and collections stay in place.

## Install and start

1. In Zotero, open **Tools → Plugins**, choose the gear menu, then **Install Plugin From File…** (some versions label this “Install Add-on From File…”).
2. Select [`smart-tags-0.10.3.xpi`](https://github.com/leviyuli/ZTagging/raw/refs/heads/main/dist/smart-tags-0.10.3.xpi).
3. Open **Tools → Smart Tags…**. Navigation lives in the left pane; the right-hand item and information panes remain unchanged.
4. Open **Connect AI**. Configure ChatGPT, an OpenAI API key, or a DeepSeek API key; discover/select a text-capable model, then click **Test connection**.
5. Open **Build tags**. Start with **Pilot · 50 papers**, or choose selected papers, selected collections, or the whole library, then click **Prepare tags**. This group supplies the information used to build your tag list.
6. On the same **Build tags** page, browse the suggested tags, edit or remove entries, and answer any scientific questions. Click **Apply tag list** to save the tag library. This does not start assignment or write paper tags.
7. Open **Assign & automate** and choose both a tag shelf and the papers that should receive its tags. This is a separate group, initially **Whole personal library**. Click **Suggest paper tags**, review the matches, then choose **Apply accepted and finish** to write the accepted native tags with undo and open that assignment's topic report. You can assign beyond the papers used to build the list.
8. Use **Run assignment pilot**, review its suggestions, and mark the pilot reviewed before explicitly enabling automatic assignment for incoming papers. Changing the generated tag list resets this gate; adding a researcher-defined tag or confirming an equivalent saved alias preserves it.

The classifier usually proposes up to five direct tags from the chosen shelf; it does not pad papers to a minimum. Routine assignment uses approved definitions. New topics are presented for vocabulary review rather than silently added as native tags.

The extension checks this repository's [update manifest](updates.json) for new versions. Each published installer has a SHA-256 hash in that manifest. You can also update manually by installing a newer XPI.

Release downloads contain the installer and TypeScript source archive. Read the [changelog](CHANGELOG.md), [migration notes](MIGRATION.md), and [validation report](VALIDATION.md) when upgrading an existing review.

Version **0.10.0** combines building and reviewing a tag list. Generated and researcher-authored tags use the same library, scientific categories, matching rules, and evidence checks. Renameable shelves organize tag membership independently of scientific meaning. Existing Zotero tags stay on papers without an import or cleanup step.

Version **0.10.1** fixes saved-tag relationship references during extension builds. If an earlier run paused while choosing tags, update and use **Retry this step**; ZTagging first rechecks its saved reply locally and keeps completed paper analysis and spending. Do not reset the paper cache to recover this failure.

Version **0.10.2** keeps previous tag-plan caches out of new reading progress. Reading shows the current paper count; a completed plan is reused only after the new inputs match, including after pause/restart.

Version **0.10.3** repairs conflicting generated names and aliases locally, keeping saved tag meanings unchanged. Update and use **Retry this step** on a paused build: completed paper analysis and saved replies are reused before another tag-selection request. Conflicting candidates can be left out without blocking the usable tags; scientific contradictions still require correction.

## Keep using and extending your tag library

Use **Tag library → Add tag** or edit an existing definition. Choose a shelf to browse its tags, or rename it to suit your work. New builds create their own shelves; tags you add join the chosen shelf or My tags. A shelf does not make its tags synonyms or subtypes. A topic can be useful even when no current paper matches it. Matching and assignment keep their existing suggestion, review, and manual-choice protections.

For papers from another field, open **Build tags**, select those papers or their collections, and use **Extend my saved tag list**. This is the default after a tag list has been applied. **New tags to suggest** starts at 30 and can be edited for each extension; **Settings → Default new tags per extension** changes that default. The initial 60-tag preference is separate: a library can grow from about 60 to 90 to 120 through successive extensions, without a combined 60-tag ceiling. These are targets, not quotas for unsupported concepts.

New suggestions are compared with the applied definitions; equivalent topics reuse existing identities, while subtypes and related topics remain separate. Tags outside the new sample stay in your library. Review the additions and apply the list, then choose the whole library or a different assignment group on **Assign & automate**.

**Replace full tag list** remains an explicit option when you intend to reorganize the complete vocabulary. Review that proposal before applying it. Both modes leave native paper tags unchanged until a separate reviewed paper-tag operation. Neither mode enables incoming-paper automation.

The expandable **Smart Tags/Collections** navigator stays in Zotero’s left pane. In Settings, **Show tag navigation** opens it and **Restore navigation** retries attachment to the library window. The manager retains its workspace layout inspired by [Notion’s sidebar and editor](https://www.notion.com/help/intro-to-workspaces), light/dark colors, and accessible dropdowns.

## Compact vocabulary and navigation

The starting preference is **60 tags**, counting broad concepts and subtypes together. Category headings and shelves do not count toward it. Protected saved definitions remain available even when a target is exceeded. **Settings → Preferred number of tags** and **Default new tags per extension** each accept 1–500. Later extensions add to the saved library; distinct scientific concepts are kept separate rather than merged to reach a number.

Paper analysis is cached independently of the tag list. Factual summaries, concepts, validated quotations, and provider/model provenance remain reusable as the library grows. Preparation consolidates the selected papers together and checks the source context behind each concept. Unsupported generated topics can be left out, familiar abbreviations normalized, and categories corrected. Your saved names, remembered decisions, and saved edits remain protected. When the source context leaves a real choice, **Questions** presents the alternatives with affected papers.

**Settings → Data → Reset paper analysis…** clears reusable paper analyses and pending results so the next build starts fresh. Papers, PDFs, native tags, saved tag definitions, credentials, spending, and audit history remain.

An unchanged rebuild reuses completed facts and saved consolidation output. You can prepare a new list over a paused, unapproved rebuild; it replaces the pending review while retaining cached paper analysis. Pause or close Zotero during a run, then resume from saved progress. Changed metadata or newly available PDF evidence refreshes affected papers.

Tag selection starts with a local census of unique-paper support and sparse text similarity. It ranks useful topics with diminishing returns for repeatedly covering the same paper and category, without quotas for smaller fields. Similarity helps route candidates; it does not establish synonymy or scientific evidence. A bounded global shortlist supplies the model with names, coverage counts, and representative context. The model proposes reusable meanings, and a local selection pass keeps the useful core plus necessary parents. Unselected details remain in the factual catalog for later use without creating one tag for every finding.

Once names and meanings are fixed, Smart Tags checks examples from up to **three different papers per tag**. Requests contain at most **64 tag–source pairs and 90 KB**, with smaller batches when the output limit requires them. Up to two independent requests can run concurrently. A decision applies only to its exact tag, source, snapshot, and meaning; a shared keyword never approves other papers. Parent support can use validated subtype examples.

Counts in this review mean **verified example papers**, not all matching papers in your library. Findings outside the sample remain **unexamined**; they are not classified as outside the vocabulary and cannot generate no_tag. Unsupported generated topics can be deferred while protected saved definitions remain available. An ambiguous example can be omitted when another checked example establishes the same concept; genuinely unresolved meanings still appear in Questions.

Progress shows tags prepared and examples checked, alongside the saved finding inventory and known requests. There is no elapsed-time prediction. Your selected provider and budget apply to every dispatch; parallel requests reserve funds before sending. Valid decisions are saved immediately, and one bounded repair round checks only unresolved pairs. Replies, counters, and spending survive restart. Authentication, quota, permission, connection, budget, and exhausted technical repairs can still pause the run. **Retry this step** retries unresolved technical checks without discarding completed results.

## Dismiss or exclude an item

In **Activity**, open **More** beside a paper for **Dismiss**, **Exclude from tagging**, and other applicable choices. Selecting papers reveals batch controls; **Actions** holds secondary batch choices. Clicking a paper's title opens it in Zotero. Empty views keep only search, the status filter, and the panel's **More** menu.

**Dismiss** hides the current information notice. It does not repair the item or remove it from tagging. An unchanged local recheck or restart keeps the notice dismissed; changed information can make it appear again.

**Exclude from tagging** previews adding the native **no_tag** marker. Applying the preview preserves the item's other tags, collections, attachments, and metadata, and skips that item in future builds and assignments. Use **Excluded from tagging → Include again** to preview removing only no_tag, or undo the change in History. The panel's **More → Exclude selected Zotero items…** also works for items outside the current build. These manual choices need no AI connection. A one-build **Skip** remains a separate option.

For whole-list assignment, the model may suggest **no_tag** when readable evidence establishes that none of the approved scientific tags applies. This suggestion requires separate batch Apply and does not enable automation. Missing abstracts, unreadable PDFs, empty replies, and connection failures are not evidence of an outside-vocabulary item. A single-tag preview cannot make this whole-list judgment. The built-in marker is searchable in the navigator, does not count toward the preferred tag target, and cannot be renamed or turned into a scientific tag.

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

AEMWE is preferred over repeated long/plural forms, with **anion-exchange membrane water electrolyzer** in details and AEMWEs/AEM-WE as searchable aliases. Ordinary core wording is lowercase with conservative singular forms. Scientific casing such as Co, CO, pH, and EIS remains protected. Researcher-defined names remain protected.

After the global draft, selection allows **up to three additional semantic repair requests** before freezing meanings. Representative example checks use a separate bounded queue and one repair round for unresolved pairs. Valid provenance alone does not establish scientific relevance. Contradictory evidence remains blocked; source-validation policy 3 still requires a fresh, exact-source decision for every counted example. Older exhaustive reviews retain their historical checking behavior.

The attempt count and completed responses survive pause/restart. A budget rejection before dispatch does not consume an attempt; a dispatched request does. Resume continues saved work. **Retry this step** explicitly retries failed selection or mapping work while retaining prior replies, choices, and spent budget. Historical reviews retain their **Try again** preparation action. Your connection stays unchanged unless you select another one in Connect AI. Preparing tags does not enable unattended assignment.

## Recovering paper information

Open **Activity → Papers that need attention**. Each paper appears once, with a status such as **Ready to use**, **Needs information**, or **Analysis failed**. A paper with validated concepts remains usable when the model asks for additional context. That request does not mean its validated passages were lost or its analysis failed.

Use **Open in Zotero** to inspect the record. **Find metadata** searches through Zotero’s identifier translators using a DOI, PMID, ISBN, or arXiv identifier. You can supply an identifier with **Find with identifier**. Review the proposed additions, then choose **Apply metadata**. Only empty supported bibliographic fields and an empty creator list can be filled; existing values, item type, native tags, and collections are preserved. A result must confirm the identifier, and conflicting or ambiguous results are left for review. Lookup does not create another library item or download attachments.

**Recheck PDF** checks locally attached files and explicitly retries local text indexing. It distinguishes a missing attachment, a file unavailable locally, readable text, unavailable text, a read error, and an unverified state. It does not download the PDF or run OCR. When text is unavailable, inspect the attachment in Zotero and provide a local readable copy or improve its metadata.

After improving the inputs, choose **Retry analysis** or **Retry selected**. These are explicit model requests through your chosen connection, subject to its budget and authentication controls. Requested recovery work waits behind an ongoing library build. Applying metadata also queues a retry for the affected paper. Old factual evidence is retained in local history; only affected analysis is refreshed. **Skip for this build** excludes a paper from the current build without removing its item or native tags. Manual native tags and researcher assignments remain available and do not become factual evidence merely because you assigned them.

## Notices and history

**Activity** keeps evidence-related paper recovery separate from other notices, which retain affected-paper links, **Dismiss**, and **Dismiss all** controls. Dismissal is remembered; successful reevaluation resolves only the corresponding paper and processing phase. Dismissal acknowledges a condition rather than repairing its inputs. Cached gaps recheck local PDF availability, including papers whose extraction jobs were already completed. Changed conditions supersede older episodes; recurring conditions can become active again. Unfamiliar-topic notices clear when a fresh analysis of that paper and phase no longer finds the condition. Completed merge reviews go straight to history.

Resolved, dismissed, superseded, and legacy notices remain in Activity’s history. Old string banners remain historical, unverified notices because their original paper associations and dates are unknown. Successful actions use brief confirmations instead of persistent warning banners.

## Tag definitions and shelves

The initial **RCL** draft means “catalyst-layer resistance in water electrolysis or fuel cells.” Edit and save its definition, aliases, inclusion/exclusion rules, and example paper titles before matching it. Matching does not require the acronym to appear. If metadata provides insufficient support and PDF text is unavailable, use the paper-recovery actions in Activity. OCR and automatic PDF downloading are outside this version.

**Add tag** makes a shared user-defined topic, optionally linked to a concept for contextual browsing. It defaults to **Suggest matches**: preview evidence across existing papers, then review assignments. **Manual only** disables matching. **Automatic** requires explicit per-tag selection and the global automation/pilot gate. **Assign to selected papers** records a manual, locked assignment with undo. Generated and researcher-authored definitions use the same tag editor and assignment checks.

Selected papers, selected collections (including descendants), the 50-paper pilot, and the whole personal library are supported. Group libraries, notes, and child attachments are excluded from tagging targets. Imported automatic tags are retained as source-keyword evidence; they are not universally identifiable as original author keywords.

## Existing Zotero tags

Existing native tags remain unchanged. They can overlap with Smart Tags names and do not need to be imported, defined, renamed, compared, or cleaned before using the extension. The tag library contains the definitions you choose to manage; a native name alone never creates a definition. Earlier cleanup journals and undo records remain in Activity, and obsolete cleanup work does not resume automatically.

Manual removals, rejections, and locks remain protected. Assignment applies only the saved definitions chosen for that run; a shelf supplies assignment targets while parent definitions may be sent as background context, never as extra assignment targets.

Under **Find papers**, combine hierarchical tags, inspect related papers, and save All/Any searches. Related papers are local text/concept similarity suggestions, not citation links. Project membership, reading status, and “fundamental” selections remain user decisions. Collections can overlap without duplicating papers.

## Finishing a paper assignment

Each requested assignment keeps its own papers, progress, choices, and history. In **Paper suggestions**, supported high-confidence additions from saved definitions start **Accepted, not applied**. Low-confidence suggestions are declined for that assignment without creating permanent rejections. Medium-confidence or uncertain matches, no_tag, and removals wait for review. Existing manual choices remain protected; choosing Reject yourself is still remembered.

Review remaining choices before **Apply accepted and finish**. It writes that assignment's accepted tags and finishes its review; if nothing remains to apply, use **Finish assignment**. You can also apply a reviewed subset earlier. Changing the selected assignment never includes accepted suggestions from another run, and saved reviews survive restart. Incoming-paper automation remains a separate, explicit setting behind the pilot gate.

Only a finished assignment shows **Topics outside your saved list**. A paper can have useful matching tags and an uncovered topic, or be wholly outside the vocabulary. Missing information and failed analysis are not outside-topic evidence. Select the relevant topic papers and choose **Extend from selected topics**, with an editable additional-tag target. If selected papers carry no_tag, review **Include again** first; unrelated exclusions remain in place. Apply the new tag list, then assign its tags to the affected papers. Creating a definition alone does not resolve an earlier paper outcome.

## Local storage

Definitions, source metadata, selected PDF passages, proposals, decisions, queue checkpoints, and change journals live in `smart-tags/state.json` inside the current Zotero profile. Atomic writes keep a previous `.bak` generation. Interrupted native changes are reconciled against their recorded tag or metadata snapshots on startup. Definition changes are journaled with affected IDs; recovery and undo preserve unrelated definitions and refuse conflicting later edits.

Version 0.10.0 upgrades to **state schema 9** after an exact-byte **state.json.pre-v9.json** backup. Different existing backups receive numbered suffixes and remain untouched. Facts, completed jobs, pending reviews and faster-build recovery, raw replies, manual choices, settings, credentials, and spending survive. Migration sends no request, writes no native tags, and does not change old suggestions to the new confidence-based review states. Existing extension checkpoints without an additional-tag target keep their older selection policy. Factual extraction, terminology, and source-validation policy 3 remain unchanged. See [migration notes](MIGRATION.md).

Unused legacy generated drafts are removed from extension definitions only when an original backup proves their definitions are unchanged and no active or historical references need them. Researcher-authored, edited, approved, and referenced definitions remain. If that baseline is unavailable, definitions are kept. This cleanup creates no separate legacy archive and removes no native paper tags. Regular approved vocabulary history and undo journals remain available. The store refuses newer state schemas rather than overwriting them through an older backup.

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
