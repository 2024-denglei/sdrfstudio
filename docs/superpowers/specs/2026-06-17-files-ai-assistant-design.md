# Files AI Assistant Design

## Goal

Add an AI assistant to the Files page that helps users generate SDRF data-file technical attributes from the current SDRF table and uploaded files.

## User Experience

The Files page keeps the existing Technical Configuration editor, File Mapping table, and SDRF technical preview. A right-side Ai Assistant panel mirrors the Samples page pattern with a run button, status text, compact AI result summary, warnings, and generated file-mapping preview.

AI output fills the Files page form only. It does not save into the SDRF table automatically. The user reviews or edits the generated values and then clicks `Save technical configuration` to persist them.

## AI Input

The request includes:

- current SDRF headers and preview rows;
- uploaded file names, file types, parse status, and sizes;
- current Files page technical state;
- existing generated file mapping drafts;
- a strict JSON output schema.

The saved prompt must not include the API key.

## AI Output

The assistant accepts strict JSON containing:

- `summary`;
- `label_type`;
- `labels`;
- `fraction_ids`;
- `acquisition_method`;
- `instrument`;
- `cleavage_agent`;
- `file_mappings`;
- `warnings`.

The app sanitizes values, matches known label types when possible, preserves existing rows when AI omits fields, and falls back to current editor values for missing top-level fields.

## Error Handling

Missing API key shows a concise error in the assistant panel. Provider/network/schema errors do not change the current Files editor state. Invalid or partial AI JSON is normalized into the safest usable draft.

## Testing

Add a Files-page integration test that:

- configures local AI settings;
- mocks prompt saving and provider fetch;
- runs the Files AI assistant;
- verifies prompt saving happens before provider fetch;
- verifies the API key is not saved;
- verifies generated attributes populate the Files form;
- verifies the user can save the filled values into the SDRF table.
