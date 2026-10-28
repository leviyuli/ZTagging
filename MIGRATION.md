# Upgrading to Smart Tags 0.3.0

Install the new XPI over the existing extension. Startup migrates local application state to schema 3; consolidation uses protocol 2. Migration makes no provider requests and changes no native Zotero tags, collections, item columns, or credentials.

Before replacing state.json, the extension creates an exact-byte state.json.pre-v3.json backup in the profile's smart-tags directory. A different existing backup is preserved and a numbered backup is created. Backup or migration-write failures stop safely rather than loading an older valid .bak generation. Keep these private profile files out of public repositories.

Existing validated paper facts receive local IDs without changing their source wording, quotations, fingerprints, extractor version, or provider/model provenance. Completed jobs, including the reported 51-paper selected rebuild, remain completed when their evidence is unchanged. Settings, previously spent budget, decisions, locks, ownership, assignment journals, and historical tag IDs remain intact.

Name-based consolidation replies and incompatible pending proposals are invalidated. For a paused rebuild, open Queue & history and choose Resume to generate an ID-based consolidated proposal. If the previous rebuild had already finished, start Rebuild vocabulary again with the intended scope. One initial consolidation request and at most one reference correction may be needed; completed unchanged paper extraction is reused. Newly available PDF evidence or changed metadata refreshes only affected papers.

The vocabulary's existing presentation is not frozen. Review new preferred abbreviations, full names, aliases, hierarchy, and source mappings before approval. DIY names remain under your control. Native tag renames/merges remain a separate reviewed cleanup operation.

Old warning strings are imported into notice history as unverified legacy records. Their original dates, counts, and affected papers were not recorded and are not fabricated. New warnings identify papers and phases; Dismiss hides a current episode, while successful reevaluation marks it resolved. Reinstalling does not delete this history.

Schema-v1/v2 definition exports remain importable. Legacy evidence links are converted only through validated unique matches; ambiguous or scientifically uncertain mappings remain blocked for review. Protocol-v2 proposal imports preserve factual identities and reject modified quotations, stale source fingerprints, and forged verification caches. Equivalent registry entries from another catalog use recorded canonical identity mappings when required.

After publishing a revised core taxonomy, complete and review a tagging pilot before enabling unattended assignment. The core concept limit remains 60 by default.
