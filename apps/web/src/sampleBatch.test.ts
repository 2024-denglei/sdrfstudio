import { describe, expect, it } from "vitest";
import {
  buildSampleRowsFromAssignments,
  buildCoreExperimentMapFromSdrfTable,
  canonicalRowsToSdrfRows,
  classifyFactorCandidate,
  coreMappingRowsToSdrfRows,
  createSampleRoster,
  createSampleRosterFromPattern,
  detectGroupingCandidates,
  expandSampleGroupsToCanonicalRows,
  formatSampleRosterName,
  sampleDesignDraftToCanonicalDesign,
} from "./sampleBatch";

describe("sampleBatch", () => {
  it("creates a stable roster from the requested sample count", () => {
    const roster = createSampleRoster(4);

    expect(roster).toEqual([
      { id: "sample-1", sourceName: "sample_01" },
      { id: "sample-2", sourceName: "sample_02" },
      { id: "sample-3", sourceName: "sample_03" },
      { id: "sample-4", sourceName: "sample_04" },
    ]);
  });

  it("creates rosters from naming patterns", () => {
    expect(createSampleRosterFromPattern(3, "S{nn}")).toEqual([
      { id: "sample-1", sourceName: "s01" },
      { id: "sample-2", sourceName: "s02" },
      { id: "sample-3", sourceName: "s03" },
    ]);
    expect(formatSampleRosterName("donor", 1)).toBe("donor_02");
    expect(formatSampleRosterName("subject-{n}", 9)).toBe("subject-10");
  });

  it("detects grouping candidates when a field has multiple assigned values", () => {
    const roster = createSampleRoster(4);

    const candidates = detectGroupingCandidates({
      roster,
      fields: [
        { key: "organism", column: "characteristics[organism]" },
        { key: "disease", column: "characteristics[disease]", factorColumn: "factor value[disease]" },
      ],
      assignmentsByField: {
        organism: [{ value: "Homo sapiens", sampleIds: roster.map((sample) => sample.id) }],
        disease: [
          { value: "normal", sampleIds: [roster[0].id, roster[1].id] },
          { value: "breast cancer", sampleIds: [roster[2].id, roster[3].id] },
        ],
      },
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        fieldKey: "disease",
        label: "disease",
        factorColumn: "factor value[disease]",
        values: [
          { value: "normal", sampleIds: ["sample-1", "sample-2"] },
          { value: "breast cancer", sampleIds: ["sample-3", "sample-4"] },
        ],
      }),
    ]);
  });

  it("materializes SDRF rows from roster, assignments, and selected factor fields", () => {
    const roster = createSampleRoster(4);
    const rows = buildSampleRowsFromAssignments({
      roster,
      fields: [
        { key: "organism", column: "characteristics[organism]" },
        { key: "disease", column: "characteristics[disease]", factorColumn: "factor value[disease]" },
      ],
      assignmentsByField: {
        organism: [{ value: "Homo sapiens", sampleIds: roster.map((sample) => sample.id) }],
        disease: [
          { value: "normal", sampleIds: [roster[0].id, roster[1].id] },
          { value: "breast cancer", sampleIds: [roster[2].id, roster[3].id] },
        ],
      },
      factorSelections: [{ fieldKey: "disease", label: "disease", enabled: true }],
    });

    expect(rows[0]).toEqual(expect.objectContaining({
      "source name": "sample_01",
      "characteristics[organism]": "Homo sapiens",
      "characteristics[disease]": "normal",
      "factor value[disease]": "normal",
    }));
    expect(rows[2]).toEqual(expect.objectContaining({
      "source name": "sample_03",
      "characteristics[disease]": "breast cancer",
      "factor value[disease]": "breast cancer",
    }));
  });

  it("uses a custom factor label when one is provided", () => {
    const roster = createSampleRoster(2);
    const rows = buildSampleRowsFromAssignments({
      roster,
      fields: [{ key: "disease", column: "characteristics[disease]", factorColumn: "factor value[disease]" }],
      assignmentsByField: {
        disease: [
          { value: "normal", sampleIds: [roster[0].id] },
          { value: "treated", sampleIds: [roster[1].id] },
        ],
      },
      factorSelections: [{ fieldKey: "disease", label: "condition", enabled: true }],
    });

    expect(rows[0]["factor value[condition]"]).toBe("normal");
    expect(rows[1]["factor value[condition]"]).toBe("treated");
  });

  it("converts AI groups into a canonical biological sample design", () => {
    const design = sampleDesignDraftToCanonicalDesign({
      summary: "EGF time course in HeLa cells.",
      groupingStrategy: {
        selectedGroupingFields: ["treatment", "time point"],
        candidateGroupingFields: [
          { field: "treatment", values: ["EGF"], reason: "Treatment differs across sample groups." },
          { field: "time point", values: ["5 min", "15 min"], reason: "Time point is an experimental axis." },
          { field: "fraction", values: ["pH11", "pH12"], reason: "Fractions are file-level context." },
        ],
        rejectedGroupingFields: [],
      },
      groups: [{
        id: "g1",
        groupName: "EGF 15 min",
        sampleCount: 3,
        namingPrefix: "EGF15",
        metadata: {
          organism: "Homo sapiens",
          cellLine: "HeLa S3",
          treatment: "EGF",
          timepoint: "15 min",
        },
        factorKeys: ["treatment", "timepoint"],
      }],
    }, [
      { key: "organism", label: "Organism", column: "characteristics[organism]" },
      { key: "cellLine", label: "Cell line", column: "characteristics[cell line]" },
      { key: "treatment", label: "Treatment", column: "characteristics[treatment]", factorColumn: "factor value[treatment]" },
      { key: "timepoint", label: "Time point", column: "characteristics[time point]", factorColumn: "factor value[time point]" },
      { key: "fraction", label: "Fraction", column: "comment[fraction identifier]", factorColumn: "factor value[fraction]" },
    ]);

    expect(design.biologicalSystem.organism.value).toBe("Homo sapiens");
    expect(design.sampleGroups[0]).toEqual(expect.objectContaining({
      groupName: "EGF 15 min",
      sampleCount: 3,
      namingPrefix: "egf15",
    }));
    expect(design.expandedSamples.map((sample) => sample.sampleId)).toEqual(["egf15_rep1", "egf15_rep2", "egf15_rep3"]);
    expect(design.expandedSamples[0].factorValues).toEqual({ treatment: "EGF", timepoint: "15 min" });
  });

  it("normalizes time point aliases before expanding AI sample groups", () => {
    const design = sampleDesignDraftToCanonicalDesign({
      summary: "EGF stimulation in HeLa cells.",
      groupingStrategy: {
        selectedGroupingFields: ["treatment", "timepoint"],
        candidateGroupingFields: [
          { field: "timepoint", values: ["5 min"], reason: "RAW filenames encode EGF5." },
          { field: "treatment", values: ["EGF"], reason: "RAW filenames encode treatment." },
        ],
        rejectedGroupingFields: [],
      },
      groups: [{
        id: "g1",
        groupName: "EGF 5 min",
        sampleCount: 2,
        namingPrefix: "EGF5",
        metadata: {
          organism: "Homo sapiens",
          treatment: "EGF",
          timepoint: "5 min",
        },
        factor_values: ["factor value[treatment]", "factor value[time point]"],
      }],
    }, [
      { key: "organism", label: "Organism", column: "characteristics[organism]" },
      { key: "treatment", label: "Treatment", column: "characteristics[treatment]", factorColumn: "factor value[treatment]" },
      { key: "timePoint", label: "Time point", column: "characteristics[time point]", factorColumn: "factor value[time point]" },
    ]);

    expect(design.factorCandidates.find((candidate) => candidate.fieldKey === "timePoint")).toEqual(expect.objectContaining({
      classification: "biological_factor",
      enabled: true,
      values: ["5 min"],
    }));
    expect(design.expandedSamples[0].factorValues).toEqual({ treatment: "EGF", timePoint: "5 min" });
    expect(canonicalRowsToSdrfRows(design.expandedSamples, [
      { key: "organism", label: "Organism", column: "characteristics[organism]" },
      { key: "treatment", label: "Treatment", column: "characteristics[treatment]", factorColumn: "factor value[treatment]" },
      { key: "timePoint", label: "Time point", column: "characteristics[time point]", factorColumn: "factor value[time point]" },
    ])[0]).toEqual(expect.objectContaining({
      "factor value[time point]": "5 min",
    }));
  });

  it("classifies fraction-like candidates as assay/file variables instead of sample factors", () => {
    expect(classifyFactorCandidate({
      fieldKey: "fraction",
      label: "Fraction",
      factorColumn: "factor value[fraction]",
      values: ["pH11", "pH12"],
    })).toBe("assay_file_variable");
    expect(classifyFactorCandidate({
      fieldKey: "technicalReplicate",
      label: "Technical replicate",
      factorColumn: "factor value[technical replicate]",
      values: ["1", "2"],
    })).toBe("assay_file_variable");
    expect(classifyFactorCandidate({
      fieldKey: "acquisitionMethod",
      label: "Proteomics data acquisition method",
      factorColumn: "factor value[acquisition method]",
      values: ["DDNL", "decision-tree"],
    })).toBe("assay_file_variable");
  });

  it("infers PXD000547-style core mapping with two pools from shared data files", () => {
    const sourceMetadata = [
      ["PXD000547-Sample 1", "1", "cardiopulmonary insufficiency", "41", "F"],
      ["PXD000547-Sample 2", "2", "cardiopulmonary insufficiency", "91", "F"],
      ["PXD000547-Sample 3", "3", "lung embolism", "69", "F"],
      ["PXD000547-Sample 4", "4", "heart infarction", "57", "M"],
      ["PXD000547-Sample 5", "5", "heart infarction", "53", "M"],
      ["PXD000547-Sample 6", "6", "heart infarction", "63", "M"],
      ["PXD000547-Sample 7", "7", "heart infarction", "66", "M"],
      ["PXD000547-Sample 8", "8", "heart infarction", "79", "M"],
    ];
    const rows = Array.from({ length: 20 }, (_, sliceIndex) => {
      const fraction = String(sliceIndex + 1).padStart(2, "0");
      return [
        ...sourceMetadata.slice(0, 4).map(([sourceName, individual, disease, age, sex], sampleIndex) => ({
          "Source Name": sourceName,
          "Characteristics[individual]": individual,
          "Characteristics[disease]": disease,
          "Characteristics[age]": age,
          "Characteristics[sex]": sex,
          "Characteristics[organism]": "Homo sapiens",
          "Characteristics[organism part]": "corpus callosum",
          "factor value[disease]": disease,
          "comment[data file]": `dms_04Jul13_CC_Proteome_Slice${fraction}_01.RAW`,
          "comment[fraction identifier]": String(sliceIndex + 1),
          "assay name": `run ${sliceIndex * 8 + sampleIndex + 1}`,
        })),
        ...sourceMetadata.slice(4).map(([sourceName, individual, disease, age, sex], sampleIndex) => ({
          "Source Name": sourceName,
          "Characteristics[individual]": individual,
          "Characteristics[disease]": disease,
          "Characteristics[age]": age,
          "Characteristics[sex]": sex,
          "Characteristics[organism]": "Homo sapiens",
          "Characteristics[organism part]": "corpus callosum",
          "factor value[disease]": disease,
          "comment[data file]": `dms_04Jul13_CC_Proteome_Slice${fraction}_02.RAW`,
          "comment[fraction identifier]": String(sliceIndex + 1),
          "assay name": `run ${sliceIndex * 8 + sampleIndex + 5}`,
        })),
      ];
    }).flat();

    const map = buildCoreExperimentMapFromSdrfTable({
      headers: [
        "Source Name",
        "Characteristics[organism]",
        "Characteristics[organism part]",
        "Characteristics[age]",
        "Characteristics[sex]",
        "Characteristics[disease]",
        "Characteristics[individual]",
        "factor value[disease]",
        "comment[data file]",
        "comment[fraction identifier]",
        "assay name",
        "source name",
        "characteristics[age]",
        "characteristics[sex]",
      ],
      rows,
    });

    expect(map.summary).toEqual(expect.objectContaining({
      biologicalSampleCount: 8,
      poolCount: 2,
      fractionCount: 20,
      fileCount: 40,
      mappingRowCount: 160,
    }));
    expect(map.pools[0]).toEqual(expect.objectContaining({
      poolId: "pool_01",
      memberSourceNames: ["PXD000547-Sample 1", "PXD000547-Sample 2", "PXD000547-Sample 3", "PXD000547-Sample 4"],
    }));
    expect(map.pools[1]).toEqual(expect.objectContaining({
      poolId: "pool_02",
      memberSourceNames: ["PXD000547-Sample 5", "PXD000547-Sample 6", "PXD000547-Sample 7", "PXD000547-Sample 8"],
    }));
    expect(map.biologicalSamples.find((sample) => sample.sourceName === "PXD000547-Sample 1")?.metadata).toEqual(expect.objectContaining({
      age: "41",
      sex: "F",
      individual: "1",
      disease: "cardiopulmonary insufficiency",
    }));
    expect(map.variables.find((variable) => variable.field === "disease")).toEqual(expect.objectContaining({
      role: "biological_factor",
      values: ["cardiopulmonary insufficiency", "heart infarction", "lung embolism"],
    }));
    expect(map.conflicts.some((conflict) => conflict.type === "duplicate_semantic_column")).toBe(true);
  });

  it("does not infer pools when shared data files have label mappings", () => {
    const map = buildCoreExperimentMapFromSdrfTable({
      headers: ["source name", "comment[data file]", "comment[label]", "factor value[treatment]"],
      rows: [
        { "source name": "sample_1", "comment[data file]": "run_1.raw", "comment[label]": "TMT126", "factor value[treatment]": "control" },
        { "source name": "sample_2", "comment[data file]": "run_1.raw", "comment[label]": "TMT127", "factor value[treatment]": "treated" },
      ],
    });

    expect(map.summary.poolCount).toBe(0);
    expect(map.summary.labelCount).toBe(2);
    expect(map.labels.map((label) => label.label)).toEqual(["TMT126", "TMT127"]);
  });

  it("writes core mapping rows to canonical SDRF columns without duplicate case variants", () => {
    const rows = coreMappingRowsToSdrfRows([{
      rowId: "row-1",
      sourceName: "PXD000547-Sample 1",
      biologicalSampleId: "PXD000547-Sample 1",
      sampleGroup: "cardiopulmonary insufficiency",
      biologicalReplicate: "1",
      metadata: { organism: "Homo sapiens", organismPart: "corpus callosum", age: "41", sex: "F", individual: "1", disease: "cardiopulmonary insufficiency" },
      factorValues: { disease: "cardiopulmonary insufficiency" },
      poolId: "pool_01",
      poolMembers: ["PXD000547-Sample 1", "PXD000547-Sample 2"],
      fractionId: "1",
      assayName: "run 1",
      dataFile: "dms_04Jul13_CC_Proteome_Slice01_01.RAW",
      evidenceRefs: [],
      confidence: 0.95,
      warnings: [],
    }]);

    expect(rows[0]).toEqual(expect.objectContaining({
      "source name": "PXD000547-Sample 1",
      "characteristics[age]": "41",
      "characteristics[sex]": "F",
      "characteristics[individual]": "1",
      "characteristics[pooled sample]": "pool_01",
      "factor value[disease]": "cardiopulmonary insufficiency",
      "comment[data file]": "dms_04Jul13_CC_Proteome_Slice01_01.RAW",
    }));
    expect(Object.keys(rows[0])).not.toContain("Characteristics[age]");
    expect(Object.keys(rows[0])).not.toContain("Characteristics[sex]");
  });

  it("expands accepted group factors into canonical sample rows and SDRF rows", () => {
    const rows = expandSampleGroupsToCanonicalRows([{
      id: "g1",
      groupName: "EGF 15 min",
      sampleCount: 3,
      namingPrefix: "EGF15",
      metadata: { organism: "Homo sapiens", cellLine: "HeLa S3", treatment: "EGF", fraction: "pH11" },
      factorValues: { treatment: "EGF", fraction: "pH11" },
      evidenceRefs: [],
      warnings: [],
    }], [
      {
        fieldKey: "treatment",
        label: "Treatment",
        factorColumn: "factor value[treatment]",
        values: ["EGF"],
        classification: "biological_factor",
        enabled: true,
        reason: "Treatment is the experimental axis.",
      },
      {
        fieldKey: "fraction",
        label: "Fraction",
        factorColumn: "factor value[fraction]",
        values: ["pH11"],
        classification: "assay_file_variable",
        enabled: false,
        reason: "Fraction belongs to file-level mapping.",
      },
    ]);
    const sdrfRows = canonicalRowsToSdrfRows(rows, [
      { key: "organism", label: "Organism", column: "characteristics[organism]" },
      { key: "cellLine", label: "Cell line", column: "characteristics[cell line]" },
      { key: "treatment", label: "Treatment", column: "characteristics[treatment]", factorColumn: "factor value[treatment]" },
      { key: "fraction", label: "Fraction", column: "comment[fraction identifier]", factorColumn: "factor value[fraction]" },
    ]);

    expect(rows.map((row) => row.biologicalReplicate)).toEqual(["1", "2", "3"]);
    expect(sdrfRows[0]).toEqual(expect.objectContaining({
      "source name": "egf15_rep1",
      "characteristics[biological replicate]": "1",
      "characteristics[organism]": "Homo sapiens",
      "characteristics[cell line]": "HeLa S3",
      "factor value[treatment]": "EGF",
    }));
    expect(sdrfRows[0]["factor value[fraction]"]).toBeUndefined();
  });
});
