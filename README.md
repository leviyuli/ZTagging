# Smart Tags for Zotero

A local, open-source extension for **Zotero 10.0.6–10.0.x on Windows**. Build scientific tags from papers, then assign supported tags automatically. Existing Zotero tags, collections and item-list columns stay under Zotero's control.

**[Version 1.2.0](https://github.com/leviyuli/ZTagging/releases/tag/v1.2.0)** introduces an AI-only tag library, automatic handling of ambiguous build concepts, and one **Runs** record per build or assignment. Restart Zotero after updating.

**Upgrade note:** native-derived, manual and uncertain-origin plugin definitions leave the active list. Existing Zotero tags remain untouched. If the active list is empty after updating, build tags from a small group of papers. See the [migration notes](MIGRATION.md).

## Install and connect

1. Download [smart-tags-1.2.0.xpi](https://github.com/leviyuli/ZTagging/releases/download/v1.2.0/smart-tags-1.2.0.xpi).
2. In **Tools → Plugins**, open the gear menu, choose **Install Plugin From File…**, and select the XPI. Existing users can install it over the current version, then restart Zotero.
3. Open **Tools → Smart Tags… → Settings → AI connection and budget**. Choose ChatGPT, OpenAI API, or DeepSeek API; select a text model and test the connection. Task pages link to connection setup when needed.

The extension checks this repository's [update manifest](updates.json). Published installers include a SHA-256 hash; manual installation remains available. The [v1.2.0 source archive](https://github.com/leviyuli/ZTagging/releases/download/v1.2.0/smart-tags-1.2.0-source.zip) accompanies the installer.

## Build tags

Choose papers or collections and click **Build tags** or **Extend tags**. Selected papers, selected collections including descendants, a 50-paper sample, and the whole personal library are supported. Group libraries, notes and child attachments are excluded. Build and assignment paper groups remain independent.

A run appears as soon as work is queued. Progress stays on Build tags while papers are read, concepts are selected, supporting evidence is checked, and results are saved. Clear, supported additions save automatically. Ambiguous concepts are skipped; they do not create definition questions or require you to write a meaning or review papers yourself. Failures and missing source information remain distinguishable from skipped concepts.

The result reports **new tags, reused tags, skipped ambiguous concepts and unavailable papers**, with saved names and an exact **View built tags** link. **Assign tags** opens assignment setup without starting another request. Background completion never changes your current page.

Additive builds are the default. Existing AI-built definitions stay in the active list, including topics outside the new sample. Evidence determines the smallest useful set of distinct concepts, preserving meaningful singleton topics and required parents. **More options** contains upper limits, initially 60 for a first build and 30 additions for extensions; both accept 1–500. Limits are ceilings, not quotas. Different meanings are never merged merely to fit a limit.

**Replace the full tag list**, also under More options, retains an explicit review and **Apply replacement** step. Building definitions does not write paper tags or enable automatic tagging of incoming papers.

## Tag library

Tag library is one searchable list of active **AI-built definitions**. It has no native-tag inventory, shelves, manual Add tag, or native/DIY meaning-preparation workflow. An optional exact-run filter shows only that build's saved tags; typing or clearing search keeps the filter until **Back to library**.

Use **Edit** to correct a saved AI tag. **Use this tag for assignment** enables or disables it. Alternate names, categories, examples and relationships remain under **More options**. **/** focuses library search; **Escape** clears search. In the editor, **Enter** in Tag name or **Ctrl/Cmd+Enter** saves. **Escape** closes the editor while retaining its draft in the open window; **Discard changes** removes that draft.

## Assign tags

Assignment defaults to **all enabled AI-built tags**. Choose **Choose tags…** when you need an explicit subset; search does not discard selections made on another page. Select the papers, then click **Assign tags**.

Grounded, high-confidence substantive additions apply as papers finish. Medium-confidence or uncertain suggestions, removals, protected choices and outside-vocabulary exclusions remain explicit assignment choices. Accept the suggestion, **Reject and remember**, or choose **Later**. Deferred choices do not become rejections and do not block other results. Evidence opens on demand; routine matching does not require reading or writing a definition.

Existing equivalent Zotero labels prevent duplicate additions without becoming scientific evidence or plugin-owned assignments. Native tags are rechecked immediately before writing. Manual removals, remembered rejections, locks, unrelated labels and later external edits remain protected. Only assignments owned by this extension can be removed by its assignment workflow.

**Tag new papers automatically** is off until explicitly enabled. It uses the active enabled definitions within the configured connection and spending controls. A pilot approval is not required. Partial tag selections never establish whole-library exclusion.

## Runs, retry and correction

**Runs** replaces Activity. Each Build or Assign action has one logical record, including subsequent Retry attempts. It shows its paper group, current phase, status and outcome counts. Use **Pause**, **Resume**, **Stop**, **Retry**, or **View result** as appropriate. Diagnostic messages and attempt details stay collapsed.

Processing completion is separate from assignment choices. **Recent changes and Undo** is collapsed by default; task-specific Undo remains available where its journal is retained. Undo checks for later edits and prevents immediate reapplication of the same automatic result. Undo details remain available for seven days.

A dispatched AI request whose outcome is unknown does not resend automatically. Recovery offers an explicit **Retry request** or **Stop this attempt**, with notice that the original request may already have been charged. **Allow a new attempt** on a stopped request permits a fresh Build or Assign run. Recovery also directs historical requests to a new run when their original work cannot resume. Paid replies and completed checks survive pause and restart.

Missing metadata and unreadable local PDFs appear separately in Recovery. Metadata lookup previews changes before applying them and fills supported empty fields without replacing existing values. PDF rechecking does not download files or run OCR. **Dismiss** hides a notice; **Skip for this build** skips one run. Neither is a permanent exclusion.

An explicit **Exclude from tagging** action previews adding the native **no_tag** marker while preserving other tags. **Include again** previews removing only that marker. Failed requests, missing evidence and partial-vocabulary results cannot automatically establish this exclusion.

## Find papers

Search titles, abstracts and summaries, combine AI-tag filters, or open related papers. Scientific tag filters use **validated AI assignment identities**, including validated matches already satisfied by an existing label. A matching Zotero label alone never establishes a scientific match.

**Save filter…** stores the current All/Any tag combination inside Smart Tags. Reopen it from **Saved filters** or delete it there. This creates no Zotero saved search. Filters preserve their exact AI-tag relationships and per-paper validation rules. Related papers use local content similarity, not citation links.

## Upgrading to the AI-only workflow

The storage-only transition retains definitions with demonstrable AI Build creation provenance, including subsequent corrections. Native-derived, manually created and uncertain-origin plugin definitions leave the active list. An empty active list can therefore be expected after upgrade: use Build tags on a small paper group to create the new list.

Existing Zotero tags are untouched. Earlier native/DIY tasks and their definition questions are retired instead of resuming. Previous source inputs, definition bodies and diagnostic context receive the normal seven-day history retention window; references needed for current evidence, paid-request recovery or recent Undo remain protected. Compact retirement records prevent an old task or Undo from silently restoring retired definitions.

New scientific input uses title, abstract and available PDF text. Zotero automatic/type-1 tags are no longer treated as publisher keywords; their provenance cannot be established from the tag type alone. Old keyword-derived facts, summaries, matching scopes and indexes are invalidated for future analysis. Original paid replies, spending and recovery evidence remain intact. The transition itself sends no AI request and makes no native library write. See [migration notes](MIGRATION.md).

## AI connections and cost

**ChatGPT plan:** choose “ChatGPT plan”, then **Continue with ChatGPT**. The official OAuth flow requests permission for eligible Responses requests. Availability, allowed models, and plan limits depend on your account. A successful sign-in alone does not prove inference access: use **Discover models** and **Test connection**. Supported requests consume your plan allowance. The implementation uses the public OpenAI API, not private ChatGPT endpoints.

If OpenAI says **“This account can't access this app”** because the app belongs to another workspace, cancel the pending sign-in in Smart Tags, then choose **Use another account or workspace**. Sign in with the intended account and select the workspace with your eligible plan. This starts a new connection and keeps saved accounts available. Ordinary Continue reconnects an existing connection, which remains bound to its original workspace; signing out alone does not change that binding. See the [OpenAI account-switching documentation](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

**OpenAI API key:** use your own Platform key; this is billed separately from a ChatGPT subscription. Save the key, enter the current input/output prices for your model, choose a per-run USD cap, and discover/select a model. Prices are explicit rather than hard-coded. Before each request the queue reserves a conservative estimate, including its configured output-token limit. Failed or usage-less requests retain their reservation because they may have incurred charges. This is a local run budget, not a platform-wide billing limit. Estimates cover known queued work; the mapping queue becomes known after the tag list is chosen. Follow-ups, repairs, and paper-assignment analysis can add requests; every request is checked against the cap before dispatch.

**DeepSeek API key:** choose **DeepSeek API key** in Connect AI and save a key from the [DeepSeek platform](https://platform.deepseek.com/). This uses DeepSeek’s separately billed API. Click **Discover models**, choose an available text model, enter its current USD input/output rates and a per-run budget, then click **Test connection**. Use the published peak rates, with cache-miss input pricing, for a conservative estimate; off-peak requests and cache hits may cost less. Consult [DeepSeek’s current model prices](https://api-docs.deepseek.com/quick_start/pricing/) for rates. Keys are encrypted and stored separately from OpenAI credentials. Switching providers clears the model selection and rate fields so you can choose values for the new provider.

DeepSeek uses its official Chat Completions endpoint with JSON output. Empty, truncated, or malformed responses cannot authorize tag changes. All scientific checks, remembered decisions, and undo protections apply to this connection too. The extension never switches between providers automatically.

**Test connection** sends a small real AI request through the selected connection. A plan quota failure pauses the run. Switching to paid API usage is always an explicit choice.

## Storage, evidence and privacy

The plugin stores normalized records and shared payloads in its own `smart-tags/workspace.sqlite`, separate from Zotero's library database. Background workers perform processing, serialization and history work. Pages request bounded rows and details; searches debounce for 100 ms, and native writes use chunks of at most 20 papers. The [workspace design and measurements](docs/workspace.md) document responsiveness gates and their limits.

Current definitions and their supporting evidence are protected. Completed runs and Undo details expire after **seven days**; unused AI results expire seven days after their last actual reuse. Viewing a page does not extend cache retention. Unknown legacy dates receive a seven-day transition grace period. Compact ownership, decisions, admissions, retirement markers and automatic-reapplication suppression outlive old Undo bodies.

**Settings → Data** reads stored size counters and offers **Clean up expired data**. The exact registered migration backup becomes eligible only after seven days, two verified restarts and no outstanding recovery. Cleanup runs in bounded idle batches, never as idle-shutdown work. **Reset paper analysis…** explicitly clears reusable analyses and pending paper results without changing native tags, PDFs, saved definitions, spending or credentials.

Scientific decisions retain exact source and meaning identities. Quotations must match supplied source text; names, aliases, similarity and shared wording alone do not prove a match. Scientific casing such as Co versus CO remains significant. Paid raw replies remain separate from their validated outcomes.

Credentials use the existing protected credential store and are excluded from manager models and exports. Selected paper metadata and, when needed, PDF excerpts are sent through the chosen AI connection. **Export tags…** exports definitions; **Export analysis with paper text…** includes private paper wording and quotations. Do not share a profile database as a public vocabulary export. Arbitrary vocabulary imports and legacy-definition restoration are outside the AI-only workflow.

## Build and validation

```powershell
npm install
npm run check
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
npm test
node scripts/build.mjs --check
```

The final command bundles in memory without changing release files. Native UI, keyboard, light/dark, recovery and responsiveness validation uses isolated Zotero profiles, never the working library. See [VALIDATION.md](VALIDATION.md), [workspace release gates](docs/workspace.md#validation-and-release-gates), [MIGRATION.md](MIGRATION.md) and [CHANGELOG.md](CHANGELOG.md).
