import { describe, expect, it } from "vitest";
import { CELL_LINE_ANNOTATIONS, type CellLineAnnotationRecord } from "./cellLineAnnotations.generated";
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
    const result = matchCellLineAnnotation("S3 CLONE", CELL_LINE_ANNOTATIONS);

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
    const metadataEvidence = output.draft.groups[0].metadataEvidence as Record<string, { sources: unknown[] }> | undefined;
    expect(metadataEvidence?.organism?.sources[0]).toEqual(expect.objectContaining({
      label: "Cell-line annotation database",
      source: "cl-annotations-db.tsv",
    }));
  });

  it("enriches AI source-level biological samples used by the preview", () => {
    const output = applyCellLineAnnotationsToSampleDraft({
      enabled: true,
      draft: {
        groups: [{
          id: "group-1",
          groupName: "HeLa",
          sampleCount: 1,
          namingPrefix: "hela",
          metadata: { cellLine: "HeLa", age: "not available" },
          metadataEvidence: {},
          ontologyTerms: [],
          factorKeys: [],
        }],
        biologicalSamples: [{
          sourceName: "hela_01",
          metadata: {
            cellLine: "HeLa",
            age: "not available",
            disease: "cervical adenocarcinoma",
          },
          metadataEvidence: {},
        }],
        summary: "HeLa samples",
        sources: [],
      },
      fields: [
        { key: "age", column: "characteristics[age]" },
        { key: "disease", column: "characteristics[disease]" },
        { key: "sex", column: "characteristics[sex]" },
      ],
    });

    const sample = output.draft.biologicalSamples?.[0] as {
      metadata: Record<string, string>;
      metadataEvidence?: Record<string, { sources: unknown[] }>;
    };
    expect(sample.metadata.age).toBe("30Y6M");
    expect(sample.metadata.disease).toBe("Human papillomavirus-related cervical adenocarcinoma");
    expect(sample.metadataEvidence?.age?.sources[0]).toEqual(expect.objectContaining({
      label: "Cell-line annotation database",
      source: "cl-annotations-db.tsv",
    }));
    expect(output.report.overwrites).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "age", previousValue: "not available", newValue: "30Y6M" }),
    ]));
  });

  it("does not overwrite ambiguous substring matches", () => {
    const base = CELL_LINE_ANNOTATIONS.find((row) => row.cellLine === "HeLa") as CellLineAnnotationRecord;
    const result = matchCellLineAnnotation("HeLa", [
      { ...base, cellLine: "Alpha HeLa", cellosaurusName: "", synonyms: "" },
      { ...base, cellLine: "Beta HeLa", cellosaurusName: "", synonyms: "" },
    ]);

    expect(result.status).toBe("ambiguous");
  });
});
