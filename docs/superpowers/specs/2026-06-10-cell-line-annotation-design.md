# Cell-Line Annotation Matching Design

## Goal

Add deterministic cell-line annotation support to the Samples page. When the `cell-lines` SDRF template is selected and a user-entered or AI-generated sample design contains a cell-line value, the app will match that value against the local annotation table at `E:/bigbio/sdrf-skills/data/cl-annotations-db.tsv`, write matched SDRF sample attributes, and show the user which fields were overwritten and where the replacement values came from.

## Source Data

The source table is a tab-delimited file with one row per curated cell-line annotation. The first implementation will generate a frontend TypeScript data module from this TSV so matching can run locally in the browser without a new API endpoint.

The matcher will use these lookup fields:

- `cell line`
- `cellosaurus name`
- `synonyms`

The matcher will map these TSV fields into SDRF sample metadata fields when present:

- `organism` -> `characteristics[organism]`
- `organism part` -> `characteristics[organism part]`
- `sampling site` -> `characteristics[sampling site]`
- `age` -> `characteristics[age]`
- `developmental stage` -> `characteristics[developmental stage]`
- `sex` -> `characteristics[sex]`
- `ancestry category` -> `characteristics[ancestry category]`
- `disease` -> `characteristics[disease]`
- `cell type` -> `characteristics[cell type]`
- `Material type` -> `characteristics[material type]`

The matcher will also preserve source-only metadata for user explanation:

- `cellosaurus accession`
- `cellosaurus name`
- `bto cell line`
- `curated`
- source filename and TSV column names

## Matching Rules

Cell-line matching is active only when the selected template stack includes `cell-lines`.

The input cell-line value comes from `characteristics[cell line]` through the internal `cellLine` sample metadata key. Matching is case-insensitive and punctuation-tolerant. The app will normalize whitespace, hyphens, underscores, and common separator characters before comparison.

Matching priority:

1. Exact normalized match on `cell line`.
2. Exact normalized match on `cellosaurus name`.
3. Exact normalized match on any `synonyms` entry.
4. Fallback substring match only when the normalized query has at least four characters and exactly one row has a lookup value that contains the query or is contained by the query.

If multiple rows match the same normalized query, the app will not overwrite automatically. It will show a conflict notice listing the candidate cell lines and ask the user to refine the `cellLine` value.

Values that are empty or equivalent to `not available`, `not applicable`, `unknown`, `n/a`, or `NAN` are treated as missing. Missing source values do not overwrite existing meaningful sample values.

## Overwrite Behavior

When a unique row matches, source annotation values directly overwrite existing sample metadata values for mapped fields. This applies to both manual Samples-page assignments and AI sample draft metadata.

Every overwrite will record:

- SDRF field key and column.
- Previous value.
- Replacement value.
- Matched cell-line row label.
- Match field, such as `cell line` or `synonyms`.
- Source TSV column.
- Source file label `cl-annotations-db.tsv`.

The UI will show a concise overwrite summary near the Samples-page status area, for example:

`HeLa matched in cl-annotations-db.tsv. Overwrote organism: Mus musculus -> Homo sapiens; disease: not available -> cervical cancer.`

For AI drafts, overwritten fields will also populate the existing per-field `metadataEvidence` structure so the right-side `Source` button displays `Cell-line annotation database`, the TSV source column, the matched row, and confidence.

## Samples Page Integration

Manual path:

- When the user assigns a `cellLine` value to one or more samples and confirms the assignment, the matcher runs immediately.
- If a unique match exists, the app creates or replaces assignments for all mapped fields over the same sample set.
- The preview table updates with the overwritten values before the user clicks `Apply sample design`.
- The status text lists overwritten fields and source.

AI path:

- After AI returns a sample JSON draft, each group with `metadata.cellLine` is enriched before rendering.
- Existing group metadata values are overwritten by matched annotations.
- The editable AI draft displays the database-backed values and source citations.
- When the user accepts the AI draft, the enriched values fill the left-side assignment editor.

Table write path:

- Existing `mergeSampleAssignmentsIntoTable` and `mergeSampleDraftIntoTable` paths will receive already-enriched metadata, so the final SDRF rows use the overwritten values without a separate backend change.

## UI States

The Samples page will expose three user-visible outcomes:

- Match applied: show overwritten field count and field-level old/new values.
- No match: show a non-blocking notice that no cell-line annotation matched the provided value.
- Ambiguous match: show candidate labels and skip overwrites until the cell-line value is refined.

The app will avoid a new modal. Existing status text, per-field source panels, and preview table are enough for this feature.

## Testing

Frontend tests will cover:

- Matching by canonical `cell line`.
- Matching by `synonyms`.
- No matching when `cell-lines` template is not selected.
- Direct overwrite of existing manual assignments and inclusion of old/new values in the overwrite report.
- AI draft enrichment that overwrites metadata and populates `metadataEvidence`.
- Ambiguous matches do not overwrite.

No backend API tests are required for the first implementation because the matching is local frontend logic and table writes reuse existing API contracts.

## Constraints

The source TSV lives outside this repo, so implementation will include a checked-in generated data module inside `apps/web/src` plus a repeatable generation command documented in the implementation. The generated module will contain only the fields needed by the matcher.

No user secrets, uploaded files, local SQLite data, or runtime storage files will be modified.
