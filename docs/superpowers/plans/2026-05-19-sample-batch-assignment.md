# Sample Batch Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Samples step’s chip-heavy sample selection with a compact roster plus modal-driven multi-select workflow, while keeping the existing batch assignment summary, automatic factor detection, and SDRF row materialization.

**Architecture:** Keep `apps/web/src/sampleBatch.ts` as the pure data layer for roster generation, assignment reconciliation, factor detection, and SDRF row building. Move the user-facing selection interaction into a dedicated sample picker dialog component so `SamplesStep` only orchestrates compact roster state, per-field assignment drafts, detected factor suggestions, and the SDRF preview/save actions. The right-rail AI panel stays unchanged; it should continue to consume the same sample draft/row data, but the new main workflow should no longer expose a full sample button grid inside each attribute panel.

**Tech Stack:** React 18, TypeScript, Vitest, React Testing Library, TanStack Query, existing SDRF table helpers, current CSS stack in `apps/web/src/styles.css`.

---

### Task 1: Add a reusable sample-picker dialog and unit test it

**Files:**
- Create: `apps/web/src/components/SampleSelectionDialog.tsx`
- Create: `apps/web/src/components/SampleSelectionDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SampleSelectionDialog } from "./SampleSelectionDialog";

it("filters samples, supports select all, and returns confirmed sample ids", async () => {
  const onConfirm = vi.fn();

  render(
    <SampleSelectionDialog
      open
      title="Select samples (Disease)"
      samples={[
        { id: "sample-1", sourceName: "sample_01" },
        { id: "sample-2", sourceName: "sample_02" },
        { id: "sample-3", sourceName: "sample_03" },
      ]}
      selectedIds={["sample-1"]}
      onConfirm={onConfirm}
      onCancel={() => undefined}
    />,
  );

  await userEvent.type(screen.getByLabelText("Search samples"), "02");
  expect(screen.getByRole("checkbox", { name: "sample_02" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Select all" }));
  await userEvent.click(screen.getByRole("button", { name: "Clear all" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "sample_02" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm samples" }));

  expect(onConfirm).toHaveBeenCalledWith(["sample-1", "sample-2"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /d /c npm --prefix apps/web run test -- src/components/SampleSelectionDialog.test.tsx`

Expected: FAIL because the dialog component does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { useEffect, useMemo, useState } from "react";
import type { SampleRosterItem } from "../sampleBatch";

type SampleSelectionDialogProps = {
  open: boolean;
  title: string;
  samples: SampleRosterItem[];
  selectedIds: string[];
  onConfirm: (ids: string[]) => void;
  onCancel: () => void;
};

export function SampleSelectionDialog({
  open,
  title,
  samples,
  selectedIds,
  onConfirm,
  onCancel,
}: SampleSelectionDialogProps) {
  const [query, setQuery] = useState("");
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);

  useEffect(() => {
    if (open) setDraftIds(selectedIds);
  }, [open, selectedIds]);

  const filteredSamples = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? samples.filter((sample) => sample.sourceName.toLowerCase().includes(normalized))
      : samples;
  }, [query, samples]);

  if (!open) return null;

  const toggleSample = (sampleId: string) => {
    setDraftIds((current) => (
      current.includes(sampleId)
        ? current.filter((id) => id !== sampleId)
        : [...current, sampleId]
    ));
  };

  return (
    <div className="sample-selection-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <section className="sample-selection-sheet">
        <header>
          <strong>{title}</strong>
          <button type="button" aria-label="Close sample picker" onClick={onCancel}>x</button>
        </header>
        <input aria-label="Search samples" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="sample-selection-actions">
          <button type="button" onClick={() => setDraftIds(samples.map((sample) => sample.id))}>Select all</button>
          <button type="button" onClick={() => setDraftIds([])}>Clear all</button>
        </div>
        <div className="sample-selection-list">
          {filteredSamples.map((sample) => (
            <label key={sample.id}>
              <input
                type="checkbox"
                checked={draftIds.includes(sample.id)}
                onChange={() => toggleSample(sample.id)}
              />
              {sample.sourceName}
            </label>
          ))}
        </div>
        <footer>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={() => onConfirm(draftIds)}>Confirm samples</button>
        </footer>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cmd /d /c npm --prefix apps/web run test -- src/components/SampleSelectionDialog.test.tsx`

Expected: PASS with search, select-all, clear-all, and confirm behavior green.

---

### Task 2: Refactor `SamplesStep` to open the picker from each assignment row

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it("opens a sample picker per assignment row and keeps the selection summary below the row", async () => {
  const putSdrfTable = vi.spyOn(api, "putSdrfTable").mockImplementation(async (_projectId, table) => table);
  renderSamplesStep();

  await userEvent.clear(screen.getByLabelText("Sample count"));
  await userEvent.type(screen.getByLabelText("Sample count"), "4");
  await userEvent.click(screen.getByRole("button", { name: "Generate roster" }));

  const diseaseField = screen.getByTestId("sample-property-disease");
  await userEvent.type(within(diseaseField).getByLabelText("Assignment value for Disease"), "normal");
  await userEvent.click(within(diseaseField).getByRole("button", { name: "Select samples for Disease" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "SAMPLE_01" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "SAMPLE_02" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm samples" }));
  await userEvent.click(within(diseaseField).getByRole("button", { name: "Add Disease assignment" }));

  expect(within(diseaseField).getByText("SAMPLE_01, SAMPLE_02")).toBeTruthy();
  expect(within(diseaseField).queryByRole("button", { name: "SAMPLE_01" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: /Use factor value\[disease\]/i })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Apply sample design" }));

  expect(putSdrfTable).toHaveBeenCalledWith("project-1", expect.objectContaining({
    rows: expect.arrayContaining([
      expect.objectContaining({ "source name": "SAMPLE_01", "characteristics[disease]": "normal" }),
      expect.objectContaining({ "source name": "SAMPLE_03" }),
    ]),
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /d /c npm --prefix apps/web run test -- src/App.test.tsx -t "opens a sample picker per assignment row"`

Expected: FAIL because the current UI still exposes the sample chips inline under each attribute panel.

- [ ] **Step 3: Write minimal implementation**

```tsx
const [activeSamplePickerField, setActiveSamplePickerField] = useState<SampleMetadataKey | null>(null);
const [samplePickerDraft, setSamplePickerDraft] = useState<string[]>([]);

<button type="button" onClick={() => openSamplePicker(field.key)}>
  Select samples
</button>

<SampleSelectionDialog
  open={activeSamplePickerField === field.key}
  title={`Select samples (${sampleFieldDisplayLabel(field)})`}
  samples={sampleRoster}
  selectedIds={samplePickerDraft}
  onConfirm={(ids) => commitAssignmentSamples(field.key, ids)}
  onCancel={closeSamplePicker}
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cmd /d /c npm --prefix apps/web run test -- src/App.test.tsx -t "opens a sample picker per assignment row"`

Expected: PASS with the selection summary still rendered below the assignment row and the SDRF payload still using the confirmed sample-value mapping.

---

### Task 3: Compress the roster area and restyle the dialog, compact rows, and summaries

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write the failing test**

No new logic test is needed here; the component and page tests from Task 1 and Task 2 cover the behavior. Use the browser screenshot check after the UI tests pass.

- [ ] **Step 2: Run verification after implementation**

Run: `cmd /d /c npm --prefix apps/web run build`

Expected: PASS with no TypeScript or CSS regressions.

- [ ] **Step 3: Write minimal implementation**

```css
.sample-roster-summary {
  display: grid;
  gap: 8px;
}

.sample-assignment-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
}

.sample-selection-dialog {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, .32);
}
```

- [ ] **Step 4: Run verification again**

Run: `cmd /d /c npm --prefix apps/web run build`

Expected: PASS.

---

### Task 4: Browser verification of the updated Samples step

**Files:**
- No code changes unless the browser reveals a layout defect.

- [ ] **Step 1: Verify in the in-app browser**

Open `http://127.0.0.1:5173/`, navigate to Samples, and confirm:

- the top roster stays compact and does not expose a full sample button grid
- each assignment row opens a `Select samples` dialog instead of listing all samples inline
- the selection summary under each row shows the chosen sample/value mapping
- detected grouping variables still appear as suggestions
- accepted factors still appear in the SDRF preview

- [ ] **Step 2: Capture screenshots**

Save one screenshot of the compact assignment panel and one of the sample picker dialog for visual review.

- [ ] **Step 3: Final test run**

Run: `cmd /d /c npm --prefix apps/web run test`

Expected: PASS.
