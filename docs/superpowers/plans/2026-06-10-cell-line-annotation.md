# Cell-Line Annotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic cell-line annotation matching to the Samples page, overwriting matched SDRF sample attributes and showing users what changed and which TSV source supplied the value.

**Architecture:** Generate a compact frontend data module from `E:/bigbio/sdrf-skills/data/cl-annotations-db.tsv`, keep matching and overwrite reporting in a focused `cellLineMatcher.ts` module, and call that module from the existing Samples page manual and AI flows. Existing table merge paths stay unchanged because they will receive already-enriched sample metadata.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, existing Samples page state in `apps/web/src/App.tsx`.

---

## File Structure

- Create `apps/web/scripts/generate-cell-line-annotations.mjs`: reads the external TSV and writes a typed generated module.
- Create `apps/web/src/cellLineAnnotations.generated.ts`: checked-in generated annotation rows used by the browser.
- Create `apps/web/src/cellLineMatcher.ts`: pure matching, metadata overwrite, evidence, and report formatting logic.
- Create `apps/web/src/cellLineMatcher.test.ts`: unit tests for canonical matching, synonym matching, overwrite reporting, AI draft enrichment, ambiguity handling, and template gating.
- Modify `apps/web/src/App.tsx`: import matcher helpers and integrate them into manual `cellLine` assignment and AI draft lifecycle.

---

### Task 1: Generate The Cell-Line Data Module

**Files:**
- Create: `apps/web/scripts/generate-cell-line-annotations.mjs`
- Create: `apps/web/src/cellLineAnnotations.generated.ts`

- [ ] **Step 1: Add the generator script**

Create `apps/web/scripts/generate-cell-line-annotations.mjs` with:

```javascript
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = process.argv[2] ?? "E:/bigbio/sdrf-skills/data/cl-annotations-db.tsv";
const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../src/cellLineAnnotations.generated.ts");

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseTsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const headers = lines.shift().split("\t").map(clean);
  return lines.map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, clean(cells[index])]));
  });
}

const rows = parseTsv(readFileSync(sourcePath, "utf8")).map((row) => ({
  cellLine: row["cell line"],
  cellosaurusName: row["cellosaurus name"],
  cellosaurusAccession: row["cellosaurus accession"],
  btoCellLine: row["bto cell line"],
  organism: row.organism,
  organismPart: row["organism part"],
  samplingSite: row["sampling site"],
  age: row.age,
  developmentalStage: row["developmental stage"],
  sex: row.sex,
  ancestryCategory: row["ancestry category"],
  disease: row.disease,
  cellType: row["cell type"],
  materialType: row["Material type"],
  synonyms: row.synonyms,
  curated: row.curated,
}));

const output = `export type CellLineAnnotationRecord = {
  cellLine: string;
  cellosaurusName: string;
  cellosaurusAccession: string;
  btoCellLine: string;
  organism: string;
  organismPart: string;
  samplingSite: string;
  age: string;
  developmentalStage: string;
  sex: string;
  ancestryCategory: string;
  disease: string;
  cellType: string;
  materialType: string;
  synonyms: string;
  curated: string;
};

export const CELL_LINE_ANNOTATION_SOURCE = "cl-annotations-db.tsv";

export const CELL_LINE_ANNOTATIONS: CellLineAnnotationRecord[] = ${JSON.stringify(rows, null, 2)};
`;

writeFileSync(outputPath, output);
console.log(`Wrote ${rows.length} cell-line annotations to ${outputPath}`);
```

- [ ] **Step 2: Run the generator**

Run from `E:/bigbio/sdrf-studio`:

```powershell
node apps/web/scripts/generate-cell-line-annotations.mjs E:/bigbio/sdrf-skills/data/cl-annotations-db.tsv
```

Expected: prints `Wrote 2014 cell-line annotations ...`.

- [ ] **Step 3: Inspect generated data**

Run:

```powershell
Select-String -Path apps/web/src/cellLineAnnotations.generated.ts -Pattern '"cellLine": "HeLa"' | Select-Object -First 1
```

Expected: one generated row for `HeLa`.

---

### Task 2: Implement And Test The Pure Matcher

**Files:**
- Create: `apps/web/src/cellLineMatcher.ts`
- Create: `apps/web/src/cellLineMatcher.test.ts`

- [ ] **Step 1: Write failing matcher tests**

Create `apps/web/src/cellLineMatcher.test.ts` with tests that import `CELL_LINE_ANNOTATIONS` and assert:

```typescript
import { describe, expect, it } from "vitest";
import { CELL_LINE_ANNOTATIONS } from "./cellLineAnnotations.generated";
import {
  applyCellLineAnnotationsToAssignments,
  applyCellLineAnnotationsToSampleDraft,
  formatCellLineAnnotationReport,
  matchCellLineAnnotation,
} from "./cellLineMatcher";

describe("cellLineMatcher", () => {
  it("matches a canonical cell line and maps SDRF metadata", () => {
    const result = matchCellLineAnnotation("HeLa", CELL_LINE_ANNOTATIONS);
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.record.cellLine).toBe("HeLa");
    expect(result.metadata.organism).toBe("Homo Sapiens");
    expect(result.metadata.organismPart).toBe("Cervix");
    expect(result.metadata.disease).toContain("cervical");
  });

  it("matches a synonym", () => {
    const result = matchCellLineAnnotation("HELA/S3", CELL_LINE_ANNOTATIONS);
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.record.cellLine).toBe("HeLa S3");
    expect(result.matchField).toBe("synonyms");
  });

  it("does not apply assignments when the cell-lines template is not selected", () => {
    const output = applyCellLineAnnotationsToAssignments({
      enabled: false,
      cellLineValue: "HeLa",
      sampleIds: ["sample-1"],
      fields: [{ key: "organism", column: "characteristics[organism]" }],
      assignmentsByField: {},
    });
    expect(output.assignmentsByField).toEqual({});
    expect(output.report.status).toBe("disabled");
  });

  it("overwrites manual assignments and records old and new values", () => {
    const output = applyCellLineAnnotationsToAssignments({
      enabled: true,
      cellLineValue: "HeLa",
      sampleIds: ["sample-1", "sample-2"],
      fields: [
        { key: "organism", column: "characteristics[organism]" },
        { key: "disease", column: "characteristics[disease]" },
      ],
      assignmentsByField: {
        organism: [{ value: "Mus musculus", sampleIds: ["sample-1", "sample-2"] }],
        disease: [{ value: "normal", sampleIds: ["sample-1", "sample-2"] }],
      },
    });
    expect(output.assignmentsByField.organism[0].value).toBe("Homo Sapiens");
    expect(output.assignmentsByField.disease[0].value).toContain("cervical");
    expect(output.report.overwrites).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "organism", previousValue: "Mus musculus", newValue: "Homo Sapiens" }),
      expect.objectContaining({ fieldKey: "disease", previousValue: "normal" }),
    ]));
    expect(formatCellLineAnnotationReport(output.report)).toContain("Overwrote organism");
  });

  it("enriches AI sample drafts with metadata evidence", () => {
    const output = applyCellLineAnnotationsToSampleDraft({
      enabled: true,
      draft: {
        groups: [{
          id: "group-1",
          groupName: "HeLa treated",
          sampleCount: 2,
          namingPrefix: "hela",
          metadata: { cellLine: "HeLa", organism: "Mus musculus" },
          metadataEvidence: {},
          ontologyTerms: [],
          factorKeys: [],
        }],
        summary: "HeLa samples",
        sources: [],
      },
      fields: [
        { key: "organism", column: "characteristics[organism]" },
        { key: "disease", column: "characteristics[disease]" },
        { key: "cellType", column: "characteristics[cell type]" },
      ],
    });
    expect(output.draft.groups[0].metadata.organism).toBe("Homo Sapiens");
    expect(output.draft.groups[0].metadataEvidence?.organism?.sources[0]).toEqual(expect.objectContaining({
      label: "Cell-line annotation database",
      source: "cl-annotations-db.tsv",
    }));
  });

  it("does not overwrite ambiguous substring matches", () => {
    const result = matchCellLineAnnotation("HeLa", [
      { ...CELL_LINE_ANNOTATIONS.find((row) => row.cellLine === "HeLa")!, cellLine: "HeLa A" },
      { ...CELL_LINE_ANNOTATIONS.find((row) => row.cellLine === "HeLa S3")!, cellLine: "HeLa B" },
    ]);
    expect(result.status).toBe("ambiguous");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm --prefix apps/web run test -- cellLineMatcher.test.ts
```

Expected: FAIL because `cellLineMatcher.ts` does not exist yet.

- [ ] **Step 3: Implement `cellLineMatcher.ts`**

Implement exported functions:

- `matchCellLineAnnotation(query, records = CELL_LINE_ANNOTATIONS)`
- `applyCellLineAnnotationsToAssignments(input)`
- `applyCellLineAnnotationsToSampleDraft(input)`
- `formatCellLineAnnotationReport(report)`

Key behavior:

- Normalize strings using lowercase and removal of non-alphanumeric characters.
- Split synonyms on `;`, `|`, `,`.
- Treat `not available`, `not applicable`, `unknown`, `n/a`, `na`, `nan`, and empty strings as missing.
- Map annotation keys to sample metadata keys: `organism`, `organismPart`, `samplingSite`, `age`, `developmentalStage`, `sex`, `ancestryCategory`, `disease`, `cellType`, `materialType`.
- Overwrite target assignments or group metadata when source values are meaningful.
- Preserve per-field evidence in the same shape `App.tsx` already uses: `{ field, value, reason, sources, confidence }`.

- [ ] **Step 4: Run matcher tests to verify they pass**

Run:

```powershell
npm --prefix apps/web run test -- cellLineMatcher.test.ts
```

Expected: PASS for `cellLineMatcher.test.ts`.

---

### Task 3: Integrate Manual Samples-Page Matching

**Files:**
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/cellLineMatcher.test.ts`

- [ ] **Step 1: Import matcher helpers**

Add imports near the existing local imports:

```typescript
import {
  applyCellLineAnnotationsToAssignments,
  applyCellLineAnnotationsToSampleDraft,
  formatCellLineAnnotationReport,
} from "./cellLineMatcher";
```

- [ ] **Step 2: Detect when cell-line matching is enabled**

In `SamplesStep`, after `selectedTemplateIds`/`selectedTemplateKey` are computed, add:

```typescript
const cellLineAnnotationEnabled = selectedTemplateIds.includes("cell-lines");
```

- [ ] **Step 3: Apply matcher after committing a cell-line assignment**

Inside `commitFieldAssignment`, after `setAssignmentsByField(...)`, add logic for `field.key === "cellLine"`:

```typescript
if (field.key === "cellLine") {
  const result = applyCellLineAnnotationsToAssignments({
    enabled: cellLineAnnotationEnabled,
    cellLineValue: value,
    sampleIds,
    fields: visibleMetadataFields.map((item) => ({ key: item.key, column: item.column })),
    assignmentsByField: next,
  });
  next = result.assignmentsByField;
  const summary = formatCellLineAnnotationReport(result.report);
  if (summary) nextStatus = summary;
}
```

The actual edit should compute `next` and `nextStatus` inside the `setAssignmentsByField` updater so state updates stay atomic.

- [ ] **Step 4: Verify manual behavior through matcher tests**

Run:

```powershell
npm --prefix apps/web run test -- cellLineMatcher.test.ts
```

Expected: PASS. App rendering tests will be run in the final verification task.

---

### Task 4: Integrate AI Draft Enrichment

**Files:**
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/cellLineMatcher.test.ts`

- [ ] **Step 1: Enrich AI draft on successful AI response**

In `runSampleAi.onSuccess`, wrap the returned draft:

```typescript
const enriched = applyCellLineAnnotationsToSampleDraft({
  enabled: cellLineAnnotationEnabled,
  draft,
  fields: visibleMetadataFields.map((item) => ({ key: item.key, column: item.column })),
});
const finalDraft = enriched.draft;
setAiDraft(finalDraft);
setSampleStatus(formatCellLineAnnotationReport(enriched.report) || "AI sample JSON and core mapping parsed. Review it, then apply when ready.");
updateSampleAiSessionState(projectId, {
  aiDraft: sampleDraftToSessionJson(finalDraft),
  aiStatus: "success",
  aiError: "",
});
```

- [ ] **Step 2: Enrich restored latest AI mutation data**

In the `latestSampleAiMutation.status === "success"` effect, run the same enrichment before `setAiDraft(...)` and before persisting the session state.

- [ ] **Step 3: Enrich drafts accepted into the left-side editor**

At the start of `fillSampleDraftIntoAttributes`, run the same enrichment against the accepted draft before `buildSampleAssistantFillState(normalized)`.

- [ ] **Step 4: Run targeted matcher tests**

Run:

```powershell
npm --prefix apps/web run test -- cellLineMatcher.test.ts
```

Expected: PASS.

---

### Task 5: Full Verification

**Files:**
- No source changes unless failures reveal a defect.

- [ ] **Step 1: Run frontend tests**

Run:

```powershell
npm --prefix apps/web run test
```

Expected: all frontend tests pass.

- [ ] **Step 2: Run frontend build**

Run:

```powershell
npm run web:build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 3: Verify dev server/browser**

If the existing dev server is still running, open `http://localhost:5173/` in the in-app browser and verify the Samples page still renders. If the app needs a restart, run the runbook startup commands already used in this thread with API on `8001` and Vite on `5173`.

- [ ] **Step 4: Commit implementation**

Run:

```powershell
git add -- sdrf-studio/apps/web/scripts/generate-cell-line-annotations.mjs sdrf-studio/apps/web/src/cellLineAnnotations.generated.ts sdrf-studio/apps/web/src/cellLineMatcher.ts sdrf-studio/apps/web/src/cellLineMatcher.test.ts sdrf-studio/apps/web/src/App.tsx sdrf-studio/docs/superpowers/plans/2026-06-10-cell-line-annotation.md
git commit -m "Add cell-line annotation matching"
```

Expected: one implementation commit on `codex/cell-line-annotation`.
