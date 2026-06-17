import {
  CELL_LINE_ANNOTATION_SOURCE,
  CELL_LINE_ANNOTATIONS,
  type CellLineAnnotationRecord,
} from "./cellLineAnnotations.generated";

export type CellLineMetadataField = {
  key: string;
  column: string;
  label?: string;
};

export type CellLineAssignment = {
  value: string;
  termAccession?: string;
  sampleIds: string[];
};

export type CellLineMetadataSource = {
  label: string;
  value: string;
  source?: string;
  field?: string;
  location?: string;
};

export type CellLineMetadataEvidence = {
  field: string;
  value: string;
  reason: string;
  sources: CellLineMetadataSource[];
  confidence?: number;
};

export type CellLineDraftGroup = {
  id: string;
  groupName: string;
  sampleCount: number;
  namingPrefix: string;
  metadata: Partial<Record<string, string>>;
  metadataEvidence?: Partial<Record<string, CellLineMetadataEvidence>>;
  ontologyTerms: unknown[];
  factorKeys: string[];
  assayContext?: Record<string, string | number | boolean | string[]>;
  warnings?: string[];
};

export type CellLineBiologicalSample = {
  sourceName?: string;
  biologicalSampleId?: string;
  sampleGroup?: string;
  biologicalReplicate?: string;
  poolId?: string;
  metadata: Partial<Record<string, string>>;
  metadataEvidence?: Partial<Record<string, CellLineMetadataEvidence>>;
  ontologyTerms?: unknown[];
  factorKeys?: string[];
  factorValues?: Record<string, string>;
  warnings?: string[];
};

export type CellLineSampleDraft = {
  groups: CellLineDraftGroup[];
  biologicalSamples?: CellLineBiologicalSample[];
  mappingRows?: Record<string, unknown>[];
  relationshipLayers?: unknown[];
  summary: string;
  sources: CellLineMetadataSource[];
  groupingStrategy?: unknown;
  warnings?: string[];
  rawJson?: Record<string, unknown>;
};

export type CellLineOverwrite = {
  fieldKey: string;
  column: string;
  previousValue: string;
  newValue: string;
  sourceColumn: string;
  matchedCellLine: string;
  matchField: string;
};

export type CellLineAnnotationReport = {
  status: "disabled" | "no-cell-line" | "no-match" | "ambiguous" | "matched";
  query?: string;
  matchedCellLine?: string;
  matchField?: string;
  matchValue?: string;
  candidates?: string[];
  overwrites: CellLineOverwrite[];
};

export type CellLineMatchResult =
  | { status: "no-query"; query: string }
  | { status: "no-match"; query: string }
  | { status: "ambiguous"; query: string; candidates: CellLineAnnotationRecord[] }
  | {
    status: "matched";
    query: string;
    record: CellLineAnnotationRecord;
    matchField: string;
    matchValue: string;
    metadata: Record<string, string>;
    sourceColumns: Record<string, string>;
  };

const MISSING_VALUES = new Set(["", "notavailable", "notapplicable", "unknown", "na", "nan", "none", "null"]);

const ANNOTATION_FIELD_MAP: Array<{ recordKey: keyof CellLineAnnotationRecord; fieldKey: string; sourceColumn: string }> = [
  { recordKey: "organism", fieldKey: "organism", sourceColumn: "organism" },
  { recordKey: "organismPart", fieldKey: "organismPart", sourceColumn: "organism part" },
  { recordKey: "samplingSite", fieldKey: "samplingSite", sourceColumn: "sampling site" },
  { recordKey: "age", fieldKey: "age", sourceColumn: "age" },
  { recordKey: "developmentalStage", fieldKey: "developmentalStage", sourceColumn: "developmental stage" },
  { recordKey: "sex", fieldKey: "sex", sourceColumn: "sex" },
  { recordKey: "ancestryCategory", fieldKey: "ancestryCategory", sourceColumn: "ancestry category" },
  { recordKey: "disease", fieldKey: "disease", sourceColumn: "disease" },
  { recordKey: "cellType", fieldKey: "cellType", sourceColumn: "cell type" },
  { recordKey: "materialType", fieldKey: "materialType", sourceColumn: "Material type" },
];

function cleanOneLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedLookup(value: unknown): string {
  return cleanOneLine(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isMeaningfulValue(value: unknown): boolean {
  return !MISSING_VALUES.has(normalizedLookup(value));
}

function uniqueByRecord(records: CellLineAnnotationRecord[]): CellLineAnnotationRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.cellLine}|${record.cellosaurusAccession}|${record.cellosaurusName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitSynonyms(value: string): string[] {
  return cleanOneLine(value)
    .split(/[;|,]+/)
    .map(cleanOneLine)
    .filter(Boolean);
}

function lookupValues(record: CellLineAnnotationRecord): Array<{ field: string; value: string; normalized: string }> {
  const values = [
    { field: "cell line", value: record.cellLine },
    { field: "cellosaurus name", value: record.cellosaurusName },
    ...splitSynonyms(record.synonyms).map((value) => ({ field: "synonyms", value })),
  ];
  return values
    .map((item) => ({ ...item, normalized: normalizedLookup(item.value) }))
    .filter((item) => item.normalized && isMeaningfulValue(item.value));
}

function matchedBy(
  records: CellLineAnnotationRecord[],
  predicate: (value: { field: string; value: string; normalized: string }, record: CellLineAnnotationRecord) => boolean,
): Array<{ record: CellLineAnnotationRecord; field: string; value: string }> {
  return records.flatMap((record) => {
    const match = lookupValues(record).find((value) => predicate(value, record));
    return match ? [{ record, field: match.field, value: match.value }] : [];
  });
}

function buildMetadata(record: CellLineAnnotationRecord): { metadata: Record<string, string>; sourceColumns: Record<string, string> } {
  const metadata: Record<string, string> = {};
  const sourceColumns: Record<string, string> = {};
  for (const mapping of ANNOTATION_FIELD_MAP) {
    const value = cleanOneLine(record[mapping.recordKey]);
    if (!isMeaningfulValue(value)) continue;
    metadata[mapping.fieldKey] = value;
    sourceColumns[mapping.fieldKey] = mapping.sourceColumn;
  }
  return { metadata, sourceColumns };
}

export function matchCellLineAnnotation(
  query: string,
  records: CellLineAnnotationRecord[] = CELL_LINE_ANNOTATIONS,
): CellLineMatchResult {
  const cleanQuery = cleanOneLine(query);
  const normalizedQuery = normalizedLookup(cleanQuery);
  if (!normalizedQuery) return { status: "no-query", query: cleanQuery };

  const matchStages = [
    (record: CellLineAnnotationRecord) => [{ field: "cell line", value: record.cellLine, normalized: normalizedLookup(record.cellLine) }],
    (record: CellLineAnnotationRecord) => [{ field: "cellosaurus name", value: record.cellosaurusName, normalized: normalizedLookup(record.cellosaurusName) }],
    (record: CellLineAnnotationRecord) => splitSynonyms(record.synonyms).map((value) => ({ field: "synonyms", value, normalized: normalizedLookup(value) })),
  ];

  for (const valuesForRecord of matchStages) {
    const matches = matchedBy(records, (value, record) => (
      valuesForRecord(record).some((candidate) => candidate.field === value.field && candidate.normalized === normalizedQuery)
    ));
    const uniqueMatches = uniqueByRecord(matches.map((item) => item.record));
    if (uniqueMatches.length > 1) return { status: "ambiguous", query: cleanQuery, candidates: uniqueMatches };
    if (uniqueMatches.length === 1) {
      const match = matches.find((item) => item.record === uniqueMatches[0]) ?? matches[0];
      const { metadata, sourceColumns } = buildMetadata(uniqueMatches[0]);
      return {
        status: "matched",
        query: cleanQuery,
        record: uniqueMatches[0],
        matchField: match.field,
        matchValue: match.value,
        metadata,
        sourceColumns,
      };
    }
  }

  if (normalizedQuery.length >= 4) {
    const matches = matchedBy(records, (value) => (
      value.normalized.includes(normalizedQuery) || normalizedQuery.includes(value.normalized)
    ));
    const uniqueMatches = uniqueByRecord(matches.map((item) => item.record));
    if (uniqueMatches.length > 1) return { status: "ambiguous", query: cleanQuery, candidates: uniqueMatches };
    if (uniqueMatches.length === 1) {
      const match = matches.find((item) => item.record === uniqueMatches[0]) ?? matches[0];
      const { metadata, sourceColumns } = buildMetadata(uniqueMatches[0]);
      return {
        status: "matched",
        query: cleanQuery,
        record: uniqueMatches[0],
        matchField: match.field,
        matchValue: match.value,
        metadata,
        sourceColumns,
      };
    }
  }

  return { status: "no-match", query: cleanQuery };
}

function createReport(status: CellLineAnnotationReport["status"], patch: Partial<CellLineAnnotationReport> = {}): CellLineAnnotationReport {
  return {
    status,
    overwrites: [],
    ...patch,
  };
}

function fieldColumn(fields: CellLineMetadataField[], fieldKey: string): string {
  return fields.find((field) => field.key === fieldKey)?.column ?? `characteristics[${fieldKey}]`;
}

function removeSampleIds(assignments: CellLineAssignment[], sampleIds: string[]): CellLineAssignment[] {
  const target = new Set(sampleIds);
  return assignments
    .map((assignment) => ({
      ...assignment,
      sampleIds: assignment.sampleIds.filter((sampleId) => !target.has(sampleId)),
    }))
    .filter((assignment) => assignment.value && assignment.sampleIds.length);
}

function previousAssignmentValue(assignments: CellLineAssignment[] | undefined, sampleIds: string[]): string {
  const target = new Set(sampleIds);
  return cleanOneLine((assignments ?? []).find((assignment) => assignment.sampleIds.some((sampleId) => target.has(sampleId)))?.value);
}

export function applyCellLineAnnotationsToAssignments(input: {
  enabled: boolean;
  cellLineValue: string;
  sampleIds: string[];
  fields: CellLineMetadataField[];
  assignmentsByField: Record<string, CellLineAssignment[]>;
}): { assignmentsByField: Record<string, CellLineAssignment[]>; report: CellLineAnnotationReport } {
  if (!input.enabled) return { assignmentsByField: input.assignmentsByField, report: createReport("disabled") };
  if (!cleanOneLine(input.cellLineValue)) return { assignmentsByField: input.assignmentsByField, report: createReport("no-cell-line") };

  const match = matchCellLineAnnotation(input.cellLineValue);
  if (match.status === "ambiguous") {
    return {
      assignmentsByField: input.assignmentsByField,
      report: createReport("ambiguous", {
        query: match.query,
        candidates: match.candidates.map((record) => record.cellLine),
      }),
    };
  }
  if (match.status !== "matched") {
    return { assignmentsByField: input.assignmentsByField, report: createReport("no-match", { query: cleanOneLine(input.cellLineValue) }) };
  }

  const next: Record<string, CellLineAssignment[]> = { ...input.assignmentsByField };
  const overwrites: CellLineOverwrite[] = [];
  for (const [fieldKey, value] of Object.entries(match.metadata)) {
    if (!input.fields.some((field) => field.key === fieldKey)) continue;
    const previousValue = previousAssignmentValue(next[fieldKey], input.sampleIds);
    next[fieldKey] = [
      ...removeSampleIds(next[fieldKey] ?? [], input.sampleIds),
      { value, sampleIds: [...input.sampleIds] },
    ];
    if (previousValue !== value) {
      overwrites.push({
        fieldKey,
        column: fieldColumn(input.fields, fieldKey),
        previousValue,
        newValue: value,
        sourceColumn: match.sourceColumns[fieldKey] ?? fieldKey,
        matchedCellLine: match.record.cellLine,
        matchField: match.matchField,
      });
    }
  }

  return {
    assignmentsByField: next,
    report: createReport("matched", {
      query: match.query,
      matchedCellLine: match.record.cellLine,
      matchField: match.matchField,
      matchValue: match.matchValue,
      overwrites,
    }),
  };
}

function evidenceForMatch(match: Extract<CellLineMatchResult, { status: "matched" }>, fieldKey: string, value: string): CellLineMetadataEvidence {
  const sourceColumn = match.sourceColumns[fieldKey] ?? fieldKey;
  return {
    field: fieldKey,
    value,
    reason: `${match.record.cellLine} matched ${match.matchField} in ${CELL_LINE_ANNOTATION_SOURCE}; ${sourceColumn} supplied this SDRF value.`,
    confidence: match.record.curated.toLowerCase() === "curated" ? 0.95 : 0.85,
    sources: [{
      label: "Cell-line annotation database",
      value: `${sourceColumn}: ${value}`,
      source: CELL_LINE_ANNOTATION_SOURCE,
      field: sourceColumn,
      location: `matched ${match.matchField}: ${match.matchValue}`,
    }],
  };
}

function addOverwrite(overwrites: CellLineOverwrite[], overwrite: CellLineOverwrite) {
  const exists = overwrites.some((item) => (
    item.fieldKey === overwrite.fieldKey
    && item.previousValue === overwrite.previousValue
    && item.newValue === overwrite.newValue
    && item.sourceColumn === overwrite.sourceColumn
    && item.matchedCellLine === overwrite.matchedCellLine
  ));
  if (!exists) overwrites.push(overwrite);
}

function applyMatchedMetadata(input: {
  metadata: Partial<Record<string, string>>;
  metadataEvidence?: Partial<Record<string, CellLineMetadataEvidence>>;
  match: Extract<CellLineMatchResult, { status: "matched" }>;
  fieldKeys: Set<string>;
  fields: CellLineMetadataField[];
  overwrites: CellLineOverwrite[];
}): {
  metadata: Partial<Record<string, string>>;
  metadataEvidence: Partial<Record<string, CellLineMetadataEvidence>>;
} {
  const metadata = { ...input.metadata };
  const metadataEvidence = { ...(input.metadataEvidence ?? {}) };
  for (const [fieldKey, value] of Object.entries(input.match.metadata)) {
    if (!input.fieldKeys.has(fieldKey)) continue;
    const previousValue = cleanOneLine(metadata[fieldKey]);
    metadata[fieldKey] = value;
    metadataEvidence[fieldKey] = evidenceForMatch(input.match, fieldKey, value);
    if (previousValue !== value) {
      addOverwrite(input.overwrites, {
        fieldKey,
        column: fieldColumn(input.fields, fieldKey),
        previousValue,
        newValue: value,
        sourceColumn: input.match.sourceColumns[fieldKey] ?? fieldKey,
        matchedCellLine: input.match.record.cellLine,
        matchField: input.match.matchField,
      });
    }
  }
  return { metadata, metadataEvidence };
}

export function applyCellLineAnnotationsToSampleDraft<TDraft extends CellLineSampleDraft>(input: {
  enabled: boolean;
  draft: TDraft;
  fields: CellLineMetadataField[];
}): { draft: TDraft; report: CellLineAnnotationReport } {
  if (!input.enabled) return { draft: input.draft, report: createReport("disabled") };

  const fieldKeys = new Set(input.fields.map((field) => field.key));
  const overwrites: CellLineOverwrite[] = [];
  const candidates = new Set<string>();
  let sawCellLine = false;
  let sawNoMatch = false;
  let matchedCellLine = "";
  let matchField = "";
  let matchValue = "";

  const groups = input.draft.groups.map((group) => {
    const cellLineValue = cleanOneLine(group.metadata.cellLine);
    if (!cellLineValue) return group;
    sawCellLine = true;
    const match = matchCellLineAnnotation(cellLineValue);
    if (match.status === "ambiguous") {
      match.candidates.forEach((record) => candidates.add(record.cellLine));
      return group;
    }
    if (match.status !== "matched") {
      sawNoMatch = true;
      return group;
    }
    matchedCellLine = match.record.cellLine;
    matchField = match.matchField;
    matchValue = match.matchValue;
    const { metadata, metadataEvidence } = applyMatchedMetadata({
      metadata: group.metadata,
      metadataEvidence: group.metadataEvidence,
      match,
      fieldKeys,
      fields: input.fields,
      overwrites,
    });
    return { ...group, metadata, metadataEvidence };
  });

  const biologicalSamples = input.draft.biologicalSamples?.map((sample) => {
    const cellLineValue = cleanOneLine(sample.metadata.cellLine);
    if (!cellLineValue) return sample;
    sawCellLine = true;
    const match = matchCellLineAnnotation(cellLineValue);
    if (match.status === "ambiguous") {
      match.candidates.forEach((record) => candidates.add(record.cellLine));
      return sample;
    }
    if (match.status !== "matched") {
      sawNoMatch = true;
      return sample;
    }
    matchedCellLine = match.record.cellLine;
    matchField = match.matchField;
    matchValue = match.matchValue;
    const { metadata, metadataEvidence } = applyMatchedMetadata({
      metadata: sample.metadata,
      metadataEvidence: sample.metadataEvidence,
      match,
      fieldKeys,
      fields: input.fields,
      overwrites,
    });
    return { ...sample, metadata, metadataEvidence };
  });

  const draft = { ...input.draft, groups, biologicalSamples } as TDraft;
  if (candidates.size) {
    return { draft, report: createReport("ambiguous", { candidates: [...candidates], overwrites }) };
  }
  if (overwrites.length || matchedCellLine) {
    return {
      draft,
      report: createReport("matched", { matchedCellLine, matchField, matchValue, overwrites }),
    };
  }
  if (sawNoMatch) return { draft, report: createReport("no-match", { overwrites }) };
  if (!sawCellLine) return { draft, report: createReport("no-cell-line", { overwrites }) };
  return { draft, report: createReport("matched", { overwrites }) };
}

export function formatCellLineAnnotationReport(report: CellLineAnnotationReport): string {
  if (report.status === "disabled" || report.status === "no-cell-line") return "";
  if (report.status === "no-match") return report.query ? `No cell-line annotation matched ${report.query}.` : "No cell-line annotation matched.";
  if (report.status === "ambiguous") {
    const candidates = report.candidates?.slice(0, 6).join(", ") || "multiple candidates";
    return `Cell-line annotation is ambiguous. Refine the cell line value; candidates: ${candidates}.`;
  }
  const matched = report.matchedCellLine ?? "Cell line";
  if (!report.overwrites.length) return `${matched} matched in ${CELL_LINE_ANNOTATION_SOURCE}; no populated SDRF fields changed.`;
  const details = report.overwrites
    .slice(0, 8)
    .map((item) => `${item.fieldKey}: ${item.previousValue || "empty"} -> ${item.newValue}`)
    .join("; ");
  const suffix = report.overwrites.length > 8 ? `; +${report.overwrites.length - 8} more` : "";
  return `${matched} matched in ${CELL_LINE_ANNOTATION_SOURCE}. Overwrote ${details}${suffix}.`;
}
