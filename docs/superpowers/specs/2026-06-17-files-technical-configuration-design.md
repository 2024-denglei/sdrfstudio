# Files Technical Configuration Design

## Goal

Align SDRF Studio's late workflow with the quantMS SDRF model by moving MS-proteomics technical and file attributes into the Files page, removing the separate Assays and Ontology workflow pages, and turning AI Review into a summary-and-advice step.

## Scope

This implementation targets `ms-proteomics` first. The Files page will edit the SDRF columns needed to complete MS-proteomics file rows: `assay name`, `technology type`, `comment[proteomics data acquisition method]`, `comment[label]`, `comment[instrument]`, `comment[cleavage agent details]`, `comment[fraction identifier]`, `comment[technical replicate]`, and `comment[data file]`.

Affinity proteomics and metabolomics will keep their existing basic table behavior until a later pass.

## Workflow

The visible workflow becomes:

`Import -> Templates -> Samples -> Blueprint -> Files -> AI Review -> Validation -> Export`

`Assays` and `Ontology` are removed as top-level pages. Ontology term lookup remains available where it already exists in Samples metadata fields.

## Files Page

Files becomes an editable MS technical configuration page inspired by the quantMS SDRF editor:

- Label Type cards for LFQ, TMT, iTRAQ, and SILAC strategies.
- A labels preview derived from the selected strategy.
- Fractionation controls for none or fractionated data with editable fraction IDs.
- Inputs for acquisition method, instrument, cleavage agent, and default technical replicate.
- A file mapping table that writes the selected technical attributes into SDRF rows.

Saving updates the current SDRF table with the technical columns and preserves existing sample metadata and factor columns.

## AI Review Page

AI Review summarizes the accumulated import evidence, selected templates, sample table, blueprint/file rows, missing SDRF fields, and uploaded files. It saves the AI review prompt through the existing debug prompt endpoint and then sends it to the configured chat completions provider for JSON advice.

The AI response is displayed as concise recommendations and warnings without replacing user-entered table data automatically.

## Testing

Tests cover:

- Assays and Ontology are no longer part of the workflow.
- The Files page renders technical configuration controls and saves MS-proteomics columns to the SDRF table.
- The AI Review page builds a summary from the current table and sends it through the configured AI provider after saving the prompt.
