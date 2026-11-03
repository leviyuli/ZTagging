# Smart Tags for Zotero

A local, open-source extension for **Zotero 10.0.6–10.0.x on Windows**. It learns useful tag meanings from your papers, saves clear definitions, and applies supported paper tags. Scientific choices that need your judgment remain available without blocking completed work. Your existing item-list columns and collections stay in place.

**Version 1.1.1** opens pending meaning choices directly, adds **My tags without meanings**, and shows Build tags outcomes with an exact **View built tags** link. Shared SQLite storage, background workers, seven-day retention and recent Undo remain available. See the [release](https://github.com/leviyuli/ZTagging/releases/tag/v1.1.1) and [validation report](VALIDATION.md). **Restart Zotero after updating**.

## Install and start

1. Download [smart-tags-1.1.1.xpi](https://github.com/leviyuli/ZTagging/releases/download/v1.1.1/smart-tags-1.1.1.xpi).
2. In Zotero, open **Tools → Plugins**, choose the gear menu, then **Install Plugin From File…** and select the downloaded XPI. Existing users can install it over their current version. Restart Zotero after updating.
3. Open **Tools → Smart Tags…**, then **Settings → AI connection and budget**, or use **Connect AI** on a task page. Configure ChatGPT, an OpenAI API key, or a DeepSeek API key; choose a text-capable model and click **Save and test** (or **Test connection** for saved settings).
4. Open **Build tags**, choose papers or collections, and click **Build tags** or **Extend tags**. A 50-paper sample is available for a small first run. Clear, checked meanings save automatically; questions stay on the page and in Activity. Building definitions does not write paper tags.
5. Open **Assign tags**, choose a shelf and the papers to tag, then click **Assign tags**. Validated high-confidence additions are written as papers finish. Other choices can wait; review applied changes and use **Activity → Undo** when needed. The assignment group can differ from the build group.
6. In **Tag library**, browse saved tags, edit meanings, or select native names under **Needs meaning** and choose **Suggest meanings**. Clear supported meanings save during processing. For other proposals, choose **Use this meaning** or **Skip this tag**; **Later** defers a choice. **Keep as personal label** leaves labels such as Important undefined for scientific matching. Existing unfinished reviews offer **Use clear meanings** for batch confirmation.
7. Optionally enable **Tag new papers automatically** on **Assign tags**. This is an explicit one-time opt-in using saved tags eligible for automatic matching; no pilot review is required.

In the tag editor, **Enter** in Tag name or **Ctrl+Enter** in Meaning saves the tag. **Escape** closes the editor and keeps its draft in the open manager window; **Discard changes** removes it. Use **Undo last change** beside a task to reverse its latest recorded change, or open Activity for the full history. Assign tags reopens unfinished results, with **New assignment** available when you want another group.

The classifier usually proposes up to five direct tags from the chosen shelf; it does not pad papers to a minimum. Routine assignment uses approved definitions. New topics are presented for vocabulary review rather than silently added as native tags.

The extension checks this repository's [update manifest](updates.json) for new versions. Each published installer has a SHA-256 hash in that manifest. You can also update manually by installing a newer XPI.

The release includes the [installer](https://github.com/leviyuli/ZTagging/releases/download/v1.1.1/smart-tags-1.1.1.xpi) and [TypeScript source archive](https://github.com/leviyuli/ZTagging/releases/download/v1.1.1/smart-tags-1.1.1-source.zip). Read the [changelog](CHANGELOG.md), [migration notes](MIGRATION.md), and [validation report](VALIDATION.md) when upgrading an existing review.

In **Tag library**, press **/** to focus search and **Escape** to clear it. **All tags / Defined / Needs meaning** filters stay beside the shelf selector; **Shelf options** contains Rename and Merge. Linked papers and AI source notes are optional disclosures. Meaning choices, editor drafts and Undo remain available while you browse.

**Find papers** leads with results; tag filters and related papers are available when needed. **Activity** puts unfinished choices and recovery first, with completed work, notices and older Undo actions in searchable History. **Settings** shows connection and incoming-tagging status first; optional preferences stay collapsed, and **Ctrl/Cmd+S** saves changes.

## Responsive workspace and seven-day retention

Saved work uses a plugin-owned SQLite database and background workers. Pages request their own rows and details; routine navigation and progress updates do not load the complete saved archive. Search is debounced, page results are bounded, and native paper changes use chunks of at most 20 papers. In isolated Windows/Zotero tests, the copied 153 MB archive became a **47.3 MiB active database**, excluding its temporary backup. Warm page queries were at most 75 ms at p95 for the archive and a synthetic 10,000-paper library; see the [measured validation status](docs/workspace.md#validation-status).

Completed work and Undo details expire after **seven days**. Unused AI results expire after **seven days without actual reuse**; viewing a page does not extend their life. Current meanings, their supporting evidence, unfinished choices, interrupted work and recovery context remain protected. Compact ownership records, remembered decisions, admissions and automatic-reapplication suppression survive expiry of the older Undo bodies.

**Settings → Data** shows active data, history, cache and backup counters without serializing the workspace. Cleanup also removes redundant audit copies from previous analysis resets, obsolete consolidation and DIY comparisons, superseded facts, older copies of the same vocabulary selection, and meaning revisions whose useful contents survive in later records. Paid replies and request scopes needed by live work remain protected; unrelated expired diagnostics and unreferenced cached replies can be removed. Unknown timestamps receive a seven-day migration grace period.

The schema-14 migration keeps an exact, collision-safe legacy backup. That registered backup is eligible for removal only after seven days, two verified restarts and resolution of recovery work. Migration itself makes no AI request, definition admission or native paper change. See [Workspace architecture and validation](docs/workspace.md) for storage, recovery and retention rules.

Retention tests repeat processing and correction cycles, check saved-byte growth, and compare recovery before and after cleanup. Future persisted history needs a live reader, a retention rule, and a growth test. Useful new papers and evidence still consume storage; repeated copies and unused diagnostics should not.

## Earlier releases

Version **1.0.7** removed the extra panel beside Zotero's Collections and kept paper search inside **Smart Tags → Find papers**. It batched item notifications and skipped unchanged saves. Its [release page](https://github.com/leviyuli/ZTagging/releases/tag/v1.0.7) remains available.

Version **1.0.6** refined Tag library with a compact toolbar and clearer meaning choices. **Keep saved meaning** closes duplicate proposals without changing saved tags or repeating AI work. Its [release page](https://github.com/leviyuli/ZTagging/releases/tag/v1.0.6) remains available.

Version **1.0.5** introduced automatic clear meanings, direct Use/Skip decisions and remembered personal labels. It also separated scientific definitions from unverified old paper labels and introduced schema 13. Its [release page](https://github.com/leviyuli/ZTagging/releases/tag/v1.0.5) remains available.

Version **1.0.4** keeps the meaning editor usable below long review lists, with Save and Close visible and drafts preserved while resizing. Its [release page](https://github.com/leviyuli/ZTagging/releases/tag/v1.0.4) remains available.

Version **1.0.3** keeps chosen tag meanings selected and shows uncertain source checks in Recovery, without repeating the same choice. Its [release page](https://github.com/leviyuli/ZTagging/releases/tag/v1.0.3) remains available.

Version **1.0.2** fixed a validation error that could block saving ready meanings when another name had an information question. Its [release page](https://github.com/leviyuli/ZTagging/releases/tag/v1.0.2) remains available.

Version **1.0.1** simplified Find papers, Activity and Settings and added local recovery of saved tag-meaning checks. Its [release page](https://github.com/leviyuli/ZTagging/releases/tag/v1.0.1) remains available.

Version **1.0.0** introduced automatic clear results, nonblocking scientific choices, keyboard editing, and task-specific Undo. Its [release page](https://github.com/leviyuli/ZTagging/releases/tag/v1.0.0) remains available.

Version **0.10.0** combines building and reviewing a tag list. Generated and researcher-authored tags use the same library, scientific categories, matching rules, and evidence checks. Renameable shelves organize tag membership independently of scientific meaning. Existing Zotero tags stay on papers without an import or cleanup step.

Version **0.10.1** fixes saved-tag relationship references during extension builds. If an earlier run paused while choosing tags, update and use **Retry this step**; ZTagging first rechecks its saved reply locally and keeps completed paper analysis and spending. Do not reset the paper cache to recover this failure.

Version **0.10.2** keeps previous tag-plan caches out of new reading progress. Reading shows the current paper count; a completed plan is reused only after the new inputs match, including after pause/restart.

Version **0.10.3** repairs conflicting generated names and aliases locally, keeping saved tag meanings unchanged. Update and use **Retry this step** on a paused build: completed paper analysis and saved replies are reused before another tag-selection request. Conflicting candidates can be left out without blocking the usable tags; scientific contradictions still require correction.

Version **0.11.0** keeps the navigator's scroll position and focus, combines native names with **My tags**, and gives library shelves comparable counts. A completed extension prepared before a saved-tag edit offers **Update and apply**, reusing its papers and compatible checks while respecting deleted or edited definitions.

Version **0.13.1** opens Tag library in browsing mode, keeps unfinished meaning reviews behind **Review meanings**, and returns to browsing when you change shelves or filters. For an older question without answer options, choose **Review meanings → Suggest a meaning**. Page navigation resets the document to its heading; background updates retain list and editor positions.

Version **0.13.0** makes meaning reviews actionable, keeps **Rename** and **Merge shelves** visible above the workspace, and retains unsaved meanings or questions in Activity. Use **Review meanings → Suggest a meaning** for an older unanswered preparation; cached extraction and paid replies are retained. Completed work appears in collapsed history.

Version **0.12.0** adds shelf merging, a **Needs meaning** filter and batch AI preparation for selected native names. Progress appears in Activity and the page for its task; saved builds no longer add a progress bar to unrelated pages.

## Keep using and extending your tag library

Use **Tag library → Add tag** or edit an existing definition. Choose a shelf to browse its tags, or rename it to suit your work. New builds create their own shelves; tags you add join the chosen shelf or My tags. A shelf does not make its tags synonyms or subtypes. A topic can be useful even when no current paper matches it. Matching and assignment keep their existing suggestion, review, and manual-choice protections.

**All tags** is the unique union of saved definitions and native names without definitions. **My tags** includes your native Zotero tags; the former Existing tags shelf is folded into it. Approved alternate names share their canonical tag's row and unique-paper count. Undefined names keep their exact spelling and can be left alone or given a meaning. Shelves may share tags, so their counts are not additive; only tags with saved meanings are used for AI assignment.

Both shelf menus show the same counts, for example **199 total · 155 ready**. Ready tags have saved meanings and can be used for AI assignment; the remaining names stay visible in the library. Generated tags already assigned to papers can also appear in My tags. In that example, 154 generated tags plus 164 My tags share 119 entries, giving **154 + 164 − 119 = 199** unique tags. A shelf with every tag ready shows just its tag count.

Use the visible **Merge shelves** button beside the shelf selector, select the lists, and give the combined shelf a name. The default replaces the selected shelves; **Keep originals** is available by clearing the replacement option. Shared tags appear once, definitions and paper assignments stay unchanged, and **Activity → Undo** restores the previous shelves. When My tags is selected, its native inventory is retained inside the combined shelf under the new name. Raw names copied into a shelf remain visible even if they later have no linked paper.

To define manually added Zotero tags, choose **Tag library → Needs meaning**, select names across pages, and click **Suggest meanings**. The selected AI connection uses their linked papers and compatible cached findings to propose concise meanings and standard names or match an existing saved definition. New automatic runs save a single clear, supported scientific meaning. Broad names keep their ordinary broad meanings: different battery chemistries can support one battery tag. Other proposals show the definition with **Use this meaning** and **Skip this tag**; **Later** defers the choice. If no usable proposal is available, choose **Ask AI again** or Skip. Writing a definition and reviewing linked papers remain optional.

Saving meanings changes the Smart Tags library only. A saved scientific meaning does not approve all its old paper labels. Unverified associations stay out of scientific filtering and counts until a validated paper-specific match establishes them; original Zotero labels remain in place. Original native names become approved aliases only when every affected paper supports that interpretation. New definitions start in suggestion-only mode, and locks and rejections remain protected. Preparation queues behind active analysis, retains paid replies and spending across restart, and uses the selected provider and budget. **Activity → Undo** can restore a saved definition batch; reopening completed work does not recreate an undone definition.

If an older meaning check paused after you chose a meaning, update and open its review. **Use this meaning** saves the available AI definition directly; **Use clear meanings** can confirm available meanings together. **Skip this tag** leaves it undefined without another AI request or a native tag change. Existing source checks, paid replies and spending are retained. **Resume** and **Retry meanings** remain available for actual processing failures.

For **“The saved tag admission is invalid”**, install the current version and choose **Resume**. An information-choice provenance mismatch no longer blocks the whole prepared batch. Already supported meanings can save locally while unresolved questions, their identities, checked evidence, replies and spending remain intact.

An accepted meaning stays saved without asking you to resolve every old source check. AI source notes remain available on expansion. Repeating the same choice, reopening a review or saving an unchanged edit preserves completed checks without another request. Labels such as **Important** ask how they should be treated: **Keep as personal label** remembers your preference, leaves the label undefined for scientific matching and disables automatic use of that label. Its papers can still receive other scientific tags. **Ask AI for a scientific meaning** can change the treatment later.

For papers from another field, open **Build tags** and select those papers or their collections. Extending the saved list is the default once meanings have been saved. **More options** contains **Maximum new tags**, initially 30; the initial list has a separate maximum of 60. These are ceilings, not requested counts. The evidence determines a compact useful list, including a significant topic supported by one paper. Saved definitions are exempt from the additions ceiling, so successive builds can grow the library beyond 60.

New suggestions are compared with saved definitions; equivalent topics reuse existing identities, while subtypes and related topics remain separate. Tags outside the new sample stay in your library. Supported additions save even when unrelated meanings still need a choice. A child waits when its required new parent is unresolved. Then choose papers on **Assign tags** to use the saved meanings.

**Replace the full tag list** remains an explicit option under **Build tags → More options** when you intend to reorganize the complete vocabulary. That replacement retains its review-and-apply step. Routine builds and extensions save clear additions without replacing protected definitions. Neither operation enables incoming-paper automation.

Open **Tools → Smart Tags… → Find papers** to search and filter your library. Zotero’s Collections sidebar, native quick search and item-list columns stay under Zotero’s control. The plugin window retains its light/dark layouts and accessible dropdowns.

## Compact vocabulary and search

New builds choose the smallest useful set of distinct retrieval concepts supported by the papers. **More options** holds the initial **60-tag maximum** and the separate **30-new-tag maximum** for extensions; both accept 1–500. Required new parent concepts count toward the maximum, while saved definitions, category headings and shelves do not. The classifier does not pad a list to reach either number or merge different scientific meanings to fit it. Earlier unfinished builds retain their original target policy.

Paper facts are cached independently of the tag list. Summaries, concepts, validated quotations, and provider/model provenance remain reusable as the library grows. A repeated assignment reuses its full cached response when its paper content, tag scope, definitions, provider and model still match. A fresh assignment request includes compatible facts and available local PDF evidence from the first request. Changing the tag scope can require new matching without repeating factual extraction. Saved names, edits and remembered decisions remain protected; genuine scientific choices appear in **Questions** and Activity.

**Settings → Data → Reset paper analysis…** clears reusable paper analyses and pending results so the next build starts fresh. Papers, PDFs, native tags, saved tag definitions, credentials, spending, and audit history remain.

An unchanged rebuild reuses completed facts and saved consolidation output. You can prepare a new list over a paused, unapproved rebuild; it replaces the pending review while retaining cached paper analysis. Pause or close Zotero during a run, then resume from saved progress. Changed metadata or newly available PDF evidence refreshes affected papers.

Tag selection starts with a local census of unique-paper support and sparse text similarity. It ranks useful topics with diminishing returns for repeatedly covering the same paper and category, without quotas for smaller fields. Similarity helps route candidates; it does not establish synonymy or scientific evidence. A bounded global shortlist supplies the model with names, coverage counts, and representative context. The model proposes reusable meanings, and a local selection pass keeps the useful core plus necessary parents. Unselected details remain in the factual catalog for later use without creating one tag for every finding.

Imported paper keywords are preferred as topic names when they express the supported meaning clearly. Familiar abbreviations and saved names still take precedence over creating alternate spellings. Keywords guide extraction and naming; they do not bypass scientific context checks or automatically become native assignments. In Zotero, the keyword input comes from imported automatic tags, not manual project tags. Existing cached findings are retained; their verified keyword passages can guide subsequent builds without repeated extraction.

The completed assignment's outside-topic report groups established wording variants such as the singular/plural full name of DRT analysis. It retains the underlying paper records and keeps compound topics, such as dry cathode operation together with water starvation, separate from narrower topics. Extending from selected papers compares new definitions with saved meanings; neither overlapping wording nor a repeated build guarantees that all topics are equivalent.

Once names and meanings are fixed, Smart Tags checks examples from up to **three different papers per tag**. Requests contain at most **64 tag–source pairs and 90 KB**, with smaller batches when the output limit requires them. Up to two independent requests can run concurrently. A decision applies only to its exact tag, source, snapshot, and meaning; a shared keyword never approves other papers. Parent support can use validated subtype examples.

Counts in this review mean **verified example papers**, not all matching papers in your library. Findings outside the sample remain **unexamined**; they are not classified as outside the vocabulary and cannot generate no_tag. Unsupported generated topics can be deferred while protected saved definitions remain available. An ambiguous example can be omitted when another checked example establishes the same concept; genuinely unresolved meanings still appear in Questions.

Progress shows tags prepared and examples checked, alongside the saved finding inventory and known requests. There is no elapsed-time prediction. Your selected provider and budget apply to every dispatch; parallel requests reserve funds before sending. Valid decisions are saved immediately, and one bounded repair round checks only unresolved pairs. Replies, counters, and spending survive restart. Authentication, quota, permission, connection, budget, and exhausted technical repairs can still pause the run. **Retry this step** retries unresolved technical checks without discarding completed results.

## Dismiss or exclude an item

In **Activity**, open **More** beside a paper for **Dismiss**, **Exclude from tagging**, and other applicable choices. Selecting papers reveals batch controls; **Actions** holds secondary batch choices. Clicking a paper's title opens it in Zotero. Empty views keep only search, the status filter, and the panel's **More** menu.

**Dismiss** hides the current information notice. It does not repair the item or remove it from tagging. An unchanged local recheck or restart keeps the notice dismissed; changed information can make it appear again.

**Exclude from tagging** previews adding the native **no_tag** marker. Applying the preview preserves the item's other tags, collections, attachments, and metadata, and skips that item in future builds and assignments. Use **Excluded from tagging → Include again** to preview removing only no_tag, or undo the change in History. The panel's **More → Exclude selected Zotero items…** also works for items outside the current build. These manual choices need no AI connection. A one-build **Skip** remains a separate option.

For whole-list assignment, the model may suggest **no_tag** when readable evidence establishes that none of the approved scientific tags applies. New assignments require your explicit **Exclude from future tagging** action; older reviews retain their manual Apply step. Missing abstracts, unreadable PDFs, empty replies, and connection failures are not evidence of an outside-vocabulary item. A single-tag preview cannot make this whole-list judgment. The built-in marker is searchable under **Find papers → Tag filters → Excluded from tagging**, does not count toward the vocabulary maximum, and cannot be renamed or turned into a scientific tag.

Prefer familiar abbreviations such as **FC**, **PEMFC**, and **AEMFC**. Full names, aliases, and definitions remain searchable. A subtype relation means “is a”; contextual links mean “related to.” A catalyst layer can be related to FC without becoming a type of FC. Scientific checks keep these relationships separate, reject contradictory meanings, and preserve chemical distinctions such as `Co` and `CO`.

Under **Find papers → Tag filters**, broad tags are grouped into four scientific categories and narrower branches expand as you browse. Selecting FC finds its direct assignments and approved descendants, including AEMFC and PEMFC, without adding redundant FC tags to those papers. Multiple selections use **All** by default; **Any** is available. A related tag remains distinct from an is-a subtype. Assignment normally proposes up to five most-specific tags, and a comparison paper can receive both subtypes.

Tag-filter search matches names, full names, aliases and definitions. Search results are deduplicated, and clearing the tag search retains the selected filters. Browsing and counts use the personal library, including papers outside the build sample; approved legacy names are recognized. Zotero’s own title, metadata, PDF, note and annotation quick search remains available in its main window.

**Save search** creates a native search with the current descendant/alias expansion. It captures a snapshot of the hierarchy: explicitly save an updated search after taxonomy changes. Existing saved searches are preserved. Filters with per-paper exclusions remain available in **Find papers**; saving them is blocked because Zotero saved searches cannot retain those exclusions on reload.

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

**Add tag** creates a shared user-defined topic. Enter its name and meaning; **More options** holds aliases, scientific categories, relationships and matching controls. **Suggest paper matches** uses the same assignment workflow, applying clear high-confidence additions while keeping uncertain choices available. **Only when I choose** disables matching. **Match automatically** makes the tag eligible for incoming assignment after you enable **Tag new papers automatically**. **Assign to selected papers** records a manual, locked assignment with undo.

Selected papers, selected collections (including descendants), the 50-paper pilot, and the whole personal library are supported. Group libraries, notes, and child attachments are excluded from tagging targets. Imported automatic tags are retained as source-keyword evidence; they are not universally identifiable as original author keywords.

## Existing Zotero tags

Existing native tags remain unchanged. They can overlap with Smart Tags names and do not need to be imported, defined, renamed, compared, or cleaned before using the extension. The tag library contains the definitions you choose to manage; a native name alone never creates a definition. Earlier cleanup journals and undo records remain in Activity, and obsolete cleanup work does not resume automatically.

Manual removals, rejections, and locks remain protected. Assignment applies only the saved definitions chosen for that run; a shelf supplies assignment targets while parent definitions may be sent as background context, never as extra assignment targets.

Under **Find papers**, combine hierarchical tags, inspect related papers, and save All/Any searches. Filters with per-paper exclusions remain available in Find papers; saving them is blocked because Zotero saved searches cannot retain those exclusions on reload. Related papers are local text/concept similarity suggestions, not citation links. Project membership, reading status, and “fundamental” selections remain user decisions. Collections can overlap without duplicating papers.

## Paper assignments and remaining choices

Each assignment keeps its own papers, captured tag scope, progress and history. New assignments write validated, high-confidence substantive additions as papers finish. Low-confidence declines apply only to that run. Medium-confidence or uncertain matches, removals, no_tag, and protected choices remain in **Needs your choice** on Assign tags and Activity. They do not block clear additions or completion of the analyzed group.

Choose an explicit action for an exception or select **Later** to defer it without creating a permanent rejection or excluding its paper. Deferred choices remain available across restart. **Reject and remember** records a persistent rejection. **Activity → Undo** reverses an applied batch while preserving unrelated later edits, and unchanged automatic work does not immediately reapply an undone addition. Earlier saved assignment reviews retain their **Apply accepted and finish** or **Finish assignment** controls.

After a new assignment finishes analysis, **Topics outside your saved list** is available even if other choices are deferred. A paper can have useful matching tags and an uncovered topic, or be wholly outside the vocabulary. Missing information and failed analysis are not outside-topic evidence. Select the relevant topic papers and choose **Extend from selected topics**; its maximum is an upper bound, not a quota. Papers carrying no_tag require a reviewed **Include again** step first. Build the additions, then assign their tags to the affected papers. Saving a definition alone does not resolve an earlier paper outcome.

## Local storage

Version **1.1.0** stores normalized records and shared payloads in `smart-tags/workspace.sqlite` inside the current Zotero profile; `smart-tags/state.json` is a small schema-14 locator. Versions through 1.0.7 stored the workspace in `state.json`; the update streams that data into SQLite and preserves an exact backup. This database is separate from Zotero's library database. Interrupted native changes are reconciled against their recorded tag or metadata snapshots on startup. Definition changes are journaled with affected IDs; recovery and Undo preserve unrelated definitions and refuse conflicting later edits.

Version **1.0.5** introduces **state schema 13** with an exact-byte **state.json.pre-v13.json** backup; native-definition protocol 2 remains unchanged. Different existing backup bytes receive numbered suffixes, and older backups remain untouched. Migration retains facts, sources, paid replies, spending, manual choices, settings and history, and makes no provider request, meaning admission or native write. Older unfinished work keeps its existing review and selection policies; explicit **Use** or **Use clear meanings** can save its available meanings. New automatic runs can save clear supported meanings without checking every old paper label. Unverified old associations remain separate from scientific filtering and counts until an individual match establishes them. Admission and Undo journals prevent restart from recreating an undone result. Older applications refuse to overwrite schema-13 data; see [migration notes](MIGRATION.md).

Unused legacy generated drafts are removed from extension definitions only when an original backup proves their definitions are unchanged and no active or historical references need them. Researcher-authored, edited, approved, and referenced definitions remain. If that baseline is unavailable, definitions are kept. This cleanup creates no separate legacy archive and removes no native paper tags. Regular approved vocabulary history and undo journals remain available. The store refuses newer state schemas rather than overwriting them through an older backup.

API keys and OAuth credentials use the operating-system keystore plus a plugin-specific LoginManager realm. If encryption is unavailable, credentials remain in memory for that session. Credentials are excluded from vocabulary exports, manager snapshots, and source packages. Do not share the profile state file as a vocabulary export: it contains library metadata.

Tag JSON import/export is under **Settings → Import, export, and previous tag lists**. Imported new definitions are drafts. Settings/definitions do not automatically sync across devices in this version. Model requests send the selected metadata or locally extracted PDF passages to the explicitly selected OpenAI or DeepSeek connection.

Older vocabulary exports remain importable. A private `zotero-smart-tags-proposal` JSON can also be imported as a staged proposal, provided its source vocabulary fingerprint and version still match. **Export analysis with paper text…** includes the current ID-based proposal, its immutable evidence snapshot, and factual sources. It contains private paper wording and quotations; **Export tags…** contains definitions only. Imported source identities and quotations are validated. Scientific checks and any remaining researcher questions run before the list is applied. Unique equivalent registry identities from different catalogs are recorded as canonical import mappings.

## Build and validation

Node.js 24 and npm are required for development; end users install only the XPI.

```powershell
npm ci
npm run check
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
npm test
node scripts/build.mjs --check
```

`npm run check` runs strict TypeScript checking; `npm test` runs the domain, provider, controller, persistence, worker, SQLite and native-adapter regression suites using Node's test runner. `node scripts/build.mjs --check` bundles all three entry points in memory without changing release files. `npm run build` creates the release XPI and updates its manifest; use that separately when preparing an authorized release. Tests use synthetic papers and mocked network responses; they do not read your credentials or modify your working library.

The development native smoke harness uses a separate profile **and** data directory under this workspace. It is excluded from the installable XPI. Its `--open-manager` flag opens the interface for visual checks; `--light-theme` sets light-theme preferences in that isolated test profile. Real ChatGPT eligibility and API-key inference are user-account checks performed from Connect AI.

MIT licensed. See [LICENSE](LICENSE).

References: [Zotero 10 plugin APIs](https://www.zotero.org/support/dev/zotero_10_for_developers), [official ChatGPT plan integration](https://developers.openai.com/siwc/token-sharing-open-source), [integration limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [OpenAI API prices](https://developers.openai.com/api/docs/pricing), [DeepSeek API documentation](https://api-docs.deepseek.com/), [DeepSeek JSON output](https://api-docs.deepseek.com/guides/json_mode/).
