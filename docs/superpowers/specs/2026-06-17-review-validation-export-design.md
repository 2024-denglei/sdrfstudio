# Review, Validation, and Export Design

## Goal

Polish the final SDRF workflow pages so users can review the generated SDRF, validate it with the local sdrf-pipelines validator when available, and inspect the full table before exporting.

## AI Review Page

The AI Review page becomes a review dashboard similar to the provided reference image. It shows:

- title `Review Your SDRF`;
- four summary tiles for template, samples, columns, and rows;
- a `Configuration Summary` panel with organism, disease, organism part, label type, fractions, technical replicate count, instrument, and enzyme;
- a `Table Preview` panel with the current SDRF table;
- the existing AI review action and AI recommendations below the preview.

The page derives values from current SDRF rows. Empty values display `not available` or `None` where appropriate.

## Validation Page

The Validation page presents `SDRF Pipeline Validation` as the primary action. It continues to call the existing backend `/validate` endpoint. The backend prefers the local `sdrf` CLI from sdrf-pipelines and falls back to the structural validator when the CLI is missing.

The UI must display the actual validator used from `summary.validator`, so users can tell whether validation came from `sdrf-pipelines` or `structural-fallback`.

## Export Page

The Export page shows the complete current SDRF table as the main content. The export package generation remains available, but it is secondary to the full table preview.

## Testing

Add focused tests that verify:

- AI Review renders the screenshot-style summary and table preview from SDRF values;
- Validation calls the backend validator and displays `sdrf-pipelines` when returned;
- Export renders the full SDRF table and still triggers export generation;
- backend validation invokes the local `sdrf validate -s` command when the executable is available.
