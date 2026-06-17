# Sample Batch Assignment Redesign

## Goal

Replace the current group-first sample builder with an attribute-first workflow.

The new flow should let the user:

1. Enter the total number of samples.
2. Define which samples belong to each attribute value.
3. Let the app detect candidate grouping variables automatically.
4. Confirm, remove, or customize those grouping variables before SDRF export.

## Problem

The current Samples step centers on a manual group card that assumes one metadata set per group. That works for simple repeated samples, but it breaks down when the user wants to assign one attribute value to a subset of samples and another value to a different subset.

The new design must keep batch entry fast while still producing one SDRF row per sample.

## Proposed Interaction

### 1. Sample roster

The first control asks for the total number of samples and a naming mode. In auto mode it generates a roster such as `sample_01, sample_02, sample_03`; in custom mode the user can provide a comma-separated roster.

The roster stays compact. It should show the generated names, not a large click-target grid, and it remains the canonical list for later assignments.

### 2. Attribute assignment panels

Each SDRF sample attribute gets its own panel.

Within a panel, the user enters one value and assigns it to one or more samples through a dedicated sample picker.

Examples:

- `characteristics[organism]` -> `Homo sapiens` -> all samples
- `characteristics[disease]` -> `normal` -> sample 1, 2
- `characteristics[disease]` -> `breast cancer` -> sample 3, 4

The UI should support bulk assignment through a dedicated multi-select picker, range selection, and an "apply to all" shortcut.

### 3. Automatic grouping-variable detection

The app should inspect the assignments and detect candidate grouping variables automatically.

Detection is only a recommendation. The user still decides what becomes a factor column.

For each candidate, the UI shows:

- the detected property
- the distinct values found
- which samples currently map to each value

The user can:

- accept the candidate as a `factor value[...]` column
- reject it
- add a custom factor name
- rename the suggested factor column

Accepted candidates are mirrored into SDRF `factor value[...]` columns. Rejected candidates stay as `characteristics[...]` only.

## Data Flow

1. The sample roster defines the row set.
2. Attribute assignments define per-sample metadata values.
3. The detector derives candidate grouping variables from multi-valued attributes.
4. The user confirms which candidates become factor columns.
5. The app materializes SDRF rows from the roster and confirmed assignments.

## UI Structure

The Samples step should be reorganized into three visible parts:

1. Sample roster and count.
2. Attribute assignment editor.
3. Detected grouping variables and SDRF preview.

Each assignment row should be compact: the selected value is shown inline, the selected samples are summarized beneath it, and the sample picker opens only when the user explicitly asks for it.

The current group-first preview card can be removed or demoted to a secondary helper, since grouping is now inferred from attribute assignments rather than manually authored as the primary model.

## Error Handling

- If the user has not entered any samples, the assignment editor remains disabled.
- If an attribute has conflicting assignments for the same sample, the UI should surface the conflict before export.
- If no grouping variables are detected, the factor suggestion panel should say so and allow manual custom factors.
- If the user leaves required SDRF attributes incomplete, validation should block export as it does today.

## Testing

Add coverage for:

- generating a sample roster from a sample count
- assigning one attribute value to multiple samples
- detecting candidate grouping variables from multi-valued attributes
- accepting and rejecting factor suggestions
- producing SDRF rows from confirmed assignments

Browser verification should confirm the updated Samples step supports batch assignment by attribute and that the factor suggestion panel reflects the detected values.
