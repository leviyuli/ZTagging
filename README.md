# Smart Tags for Zotero

A local, open-source extension for **Zotero 10.0.6–10.0.x on Windows**. It builds an approved vocabulary, proposes evidence-backed tags, supports custom research topics, and records reversible changes. Your existing item-list columns and collections stay in place.

## Install and start

1. In Zotero, open **Tools → Plugins**, choose the gear menu, then **Install Plugin From File…** (some versions label this “Install Add-on From File…”).
2. Select [`smart-tags-0.1.0.xpi`](https://github.com/leviyuli/ZTagging/raw/refs/heads/main/dist/smart-tags-0.1.0.xpi).
3. Open **Tools → Smart Tags…**. The right-hand item pane also has a Smart Tags section.
4. In **Settings**, configure one connection, discover/select a text-capable model, and click **Test connection**.
5. Start with **Pilot · 50 papers** on Overview and click **Rebuild vocabulary**. Review the draft definitions under Vocabulary, edit them as needed, and approve your choices.
6. Run **Suggest paper tags** for the pilot. Review supporting passages, accept/reject suggestions, and apply the displayed changes. Vocabulary approval and paper-tag application are separate actions.
7. Mark the completed tagging pilot reviewed. You can then enable automatic assignment for incoming papers. Rebuilding or editing the active vocabulary resets this gate.

The classifier usually proposes up to five core tags plus matching custom tags; it does not pad papers to a minimum. Routine assignment uses approved definitions. New topics are presented for vocabulary review rather than silently added as native tags.

The extension checks this repository's [update manifest](updates.json) for new versions. Each published installer has a SHA-256 hash in that manifest. You can also update manually by installing a newer XPI.

## AI connections and cost

**ChatGPT plan:** choose “ChatGPT plan”, then **Continue with ChatGPT**. The official OAuth flow requests permission for eligible Responses requests. Availability, allowed models, and plan limits depend on your account. A successful sign-in alone does not prove inference access: use **Discover models** and **Test connection**. Supported requests consume your plan allowance. The implementation uses the public OpenAI API, not private ChatGPT endpoints.

**OpenAI API key:** use your own Platform key; this is billed separately from a ChatGPT subscription. Save the key, enter the current input/output prices for your model, choose a per-run USD cap, and discover/select a model. Prices are explicit rather than hard-coded. Before each request the queue reserves a conservative estimate, including its configured output-token limit. Failed or usage-less requests retain their reservation because they may have incurred charges. This is a local run budget, not a platform-wide billing limit. Metadata estimates exclude possible PDF follow-up and vocabulary-discovery requests; the per-request budget check includes them when dispatched.

**Test connection** sends a small real AI request through the selected connection. A plan quota failure pauses the run. Switching to paid API usage is always an explicit choice.

## Custom topics and review

The initial **RCL** draft means “catalyst-layer resistance in water electrolysis or fuel cells.” Edit its definition, aliases, inclusion/exclusion rules, and example paper titles before approval. Matching does not require the acronym to appear. Scanned/unreadable PDFs remain an evidence gap; OCR and automatic PDF downloading are outside this version.

Selected papers, selected collections (including descendants), the 50-paper pilot, and the whole personal library are supported. Group libraries, notes, and child attachments are excluded from tagging targets. Imported automatic tags are retained as source-keyword evidence; they are not universally identifiable as original author keywords.

**Review → Find cleanup proposals** previews case/spelling duplicates and approved aliases. Merges display affected manual assignments and require explicit application. Chemical symbols and ambiguous aliases are protected. If you rename an owned tag definition, its prior name becomes an alias: preview and apply its cleanup before reassigning the renamed tag.

Existing manual tags are never acquired as extension-owned assignments. Manual removal, rejections, and locks are remembered. Obsolete extension-owned tags receive review-only removal proposals. History undo checks for later edits and refuses to overwrite conflicting changes. Native Zotero undo is also available for applied batches.

Under **Library**, combine tags, inspect related papers, and save a native AND-tag search. Related papers are local text/concept similarity suggestions, not citation links. Project membership, reading status, and “fundamental” selections remain user decisions. Native Zotero can hide publisher-supplied automatic tags in its tag selector while approved Smart Tags remain visible.

## Local storage

Definitions, source metadata, selected PDF passages, proposals, decisions, queue checkpoints, and change journals live in `smart-tags/state.json` inside the current Zotero profile. Atomic writes keep a previous `.bak` generation. An interrupted native write is reconciled against its recorded before/after tag snapshots on startup.

API keys and OAuth credentials use the operating-system keystore plus a plugin-specific LoginManager realm. If encryption is unavailable, credentials remain in memory for that session. Credentials are excluded from vocabulary exports, manager snapshots, and source packages. Do not share the profile state file as a vocabulary export: it contains library metadata.

Vocabulary JSON import/export is available in Vocabulary. Imported new definitions are drafts. Settings/definitions do not automatically sync across devices in this version. Model requests send the selected metadata or locally extracted PDF passages to the explicitly selected OpenAI connection.

## Build and validation

Node.js 24 and npm are required for development; end users install only the XPI.

```powershell
npm ci
npm run verify
```

`npm run check` runs strict TypeScript checking; `npm test` runs the domain, provider, controller, persistence, and native-adapter regression suites using Node's test runner. `npm run build` bundles the extension and creates the XPI. Tests use synthetic papers and mocked network responses; they do not read your credentials or modify your working library.

The development native smoke harness uses a separate profile **and** data directory under this workspace. It is excluded from the installable XPI. Real ChatGPT eligibility and API-key inference are user-account checks performed from Settings.

MIT licensed. See [LICENSE](LICENSE).

References: [Zotero 10 plugin APIs](https://www.zotero.org/support/dev/zotero_10_for_developers), [official ChatGPT plan integration](https://developers.openai.com/siwc/token-sharing-open-source), [integration limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [API prices](https://developers.openai.com/api/docs/pricing).
