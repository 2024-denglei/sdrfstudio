export interface SampleRosterItem {
  id: string;
  sourceName: string;
}

export interface SampleRosterNamingPattern {
  id: string;
  label: string;
  pattern: string;
}

export interface SampleFieldDescriptor {
  key: string;
  column: string;
  factorColumn?: string;
  label?: string;
}

export interface SampleAssignment {
  value: string;
  termAccession?: string;
  sampleIds: string[];
}

export interface SampleFactorSelection {
  fieldKey: string;
  label: string;
  enabled: boolean;
}

export interface GroupingCandidate {
  fieldKey: string;
  label: string;
  factorColumn: string;
  values: SampleAssignment[];
}

export type FactorCandidateClassification =
  | "sample_constant"
  | "biological_factor"
  | "biological_replicate"
  | "assay_file_variable"
  | "rejected";

export interface EvidenceBackedValue {
  value: string;
  reason?: string;
  sources?: Array<{ label?: string; value?: string; location?: string; source?: string; field?: string }>;
  confidence?: number;
}

export interface FactorCandidateReview {
  fieldKey: string;
  label: string;
  factorColumn: string;
  values: string[];
  classification: FactorCandidateClassification;
  enabled: boolean;
  reason: string;
}

export interface CanonicalSampleGroup {
  id: string;
  groupName: string;
  sampleCount: number;
  namingPrefix: string;
  metadata: Record<string, string>;
  factorValues: Record<string, string>;
  evidenceRefs: string[];
  warnings: string[];
}

export interface CanonicalSampleRow {
  sampleId: string;
  groupName: string;
  biologicalReplicate: string;
  metadata: Record<string, string>;
  factorValues: Record<string, string>;
  evidenceRefs: string[];
  warnings: string[];
}

export interface MissingField {
  fieldKey: string;
  label: string;
  reason: string;
}

export interface DesignConflict {
  type: string;
  message: string;
  fieldKey?: string;
}

export interface CanonicalSampleDesign {
  biologicalSystem: Record<string, EvidenceBackedValue>;
  factorCandidates: FactorCandidateReview[];
  sampleGroups: CanonicalSampleGroup[];
  expandedSamples: CanonicalSampleRow[];
  missingFields: MissingField[];
  conflicts: DesignConflict[];
  summary: string;
}

export interface BiologicalSample {
  sourceName: string;
  biologicalSampleId: string;
  sampleGroup: string;
  biologicalReplicate: string;
  metadata: Record<string, string>;
  factorValues: Record<string, string>;
  evidenceRefs: string[];
  warnings: string[];
}

export interface ExperimentalVariable {
  field: string;
  values: string[];
  sourceColumn: string;
  role: "biological_factor" | "covariate" | "assay_file_variable";
}

export interface SamplePool {
  poolId: string;
  memberSourceNames: string[];
  dataFiles: string[];
  fractionIds: string[];
  evidenceRefs: string[];
  warnings: string[];
}

export interface LabelMapping {
  label: string;
  channel: string;
  sourceName: string;
  poolId?: string;
  dataFiles: string[];
}

export interface AssayRun {
  assayName: string;
  sourceName: string;
  dataFile: string;
  fractionId?: string;
  technicalReplicate?: string;
  poolId?: string;
}

export interface DataFile {
  dataFile: string;
  fileUri?: string;
  fractionIds: string[];
  sourceNames: string[];
  poolId?: string;
}

export interface CoreMappingRow {
  rowId: string;
  sourceName: string;
  biologicalSampleId: string;
  sampleGroup: string;
  biologicalReplicate: string;
  metadata: {
    organism?: string;
    organismPart?: string;
    disease?: string;
    age?: string;
    sex?: string;
    individual?: string;
    [key: string]: string | undefined;
  };
  factorValues: Record<string, string>;
  poolId?: string;
  poolMembers?: string[];
  label?: string;
  channel?: string;
  preparation?: string;
  fractionId?: string;
  technicalReplicate?: string;
  assayName?: string;
  acquisitionMethod?: string;
  dataFile?: string;
  fileUri?: string;
  evidenceRefs: string[];
  confidence: number;
  warnings: string[];
}

export interface MappingConflict {
  type: string;
  message: string;
  rowId?: string;
  field?: string;
}

export interface MappingSummary {
  biologicalSampleCount: number;
  variableCount: number;
  poolCount: number;
  labelCount: number;
  assayCount: number;
  fractionCount: number;
  fileCount: number;
  mappingRowCount: number;
}

export interface CoreExperimentMap {
  biologicalSamples: BiologicalSample[];
  variables: ExperimentalVariable[];
  pools: SamplePool[];
  labels: LabelMapping[];
  assays: AssayRun[];
  files: DataFile[];
  rows: CoreMappingRow[];
  conflicts: MappingConflict[];
  summary: MappingSummary;
}

export interface SdrfLikeTable {
  headers: string[];
  rows: Array<Record<string, unknown>>;
}

export interface SampleDesignDraftLike {
  groups?: Array<{
    id?: string;
    groupName?: string;
    group_name?: string;
    sampleCount?: number;
    sample_count?: number;
    namingPrefix?: string;
    naming_prefix?: string;
    metadata?: Record<string, unknown>;
    metadataEvidence?: Record<string, unknown>;
    metadata_evidence?: Record<string, unknown>;
    factorKeys?: string[];
    factor_keys?: string[];
    factor_values?: unknown;
    factorValues?: unknown;
    warnings?: unknown;
  }>;
  groupingStrategy?: {
    selectedGroupingFields?: string[];
    candidateGroupingFields?: Array<{ field?: string; values?: unknown; reason?: string; classification?: string }>;
    rejectedGroupingFields?: Array<{ field?: string; values?: unknown; reason?: string; classification?: string }>;
  };
  grouping_strategy?: {
    selected_grouping_fields?: string[];
    candidate_grouping_fields?: Array<{ field?: string; values?: unknown; reason?: string; classification?: string }>;
    rejected_grouping_fields?: Array<{ field?: string; values?: unknown; reason?: string; classification?: string }>;
  };
  summary?: string;
  warnings?: unknown;
};

export interface BuildSampleRowsInput {
  roster: SampleRosterItem[];
  fields: SampleFieldDescriptor[];
  assignmentsByField: Record<string, SampleAssignment[]>;
  factorSelections?: SampleFactorSelection[];
}

export const DEFAULT_SAMPLE_ROSTER_PATTERN = "sample_{nn}";

export const SAMPLE_ROSTER_NAMING_PATTERNS = [
  { id: "sample-underscore", label: "sample_01, sample_02", pattern: DEFAULT_SAMPLE_ROSTER_PATTERN },
  { id: "s-series", label: "s01, s02", pattern: "s{nn}" },
  { id: "sample-dash", label: "sample-01, sample-02", pattern: "sample-{nn}" },
  { id: "subject-series", label: "subject-1, subject-2", pattern: "subject-{n}" },
] as const satisfies readonly SampleRosterNamingPattern[];

function cleanLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function factorValueColumn(label: string): string {
  return `factor value[${cleanLabel(label)}]`;
}

function rosterOrder(roster: SampleRosterItem[]): Map<string, number> {
  return new Map(roster.map((sample, index) => [sample.id, index]));
}

function orderedSampleIds(sampleIds: string[], order: Map<string, number>): string[] {
  return [...sampleIds].sort((left, right) => (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER));
}

export function createSampleRoster(count: number, prefix = "sample"): SampleRosterItem[] {
  const size = Math.max(0, Math.floor(Number(count) || 0));
  const normalizedPrefix = cleanLabel(prefix).toLowerCase() || "sample";
  return Array.from({ length: size }, (_, index) => ({
    id: `sample-${index + 1}`,
    sourceName: `${normalizedPrefix}_${String(index + 1).padStart(2, "0")}`,
  }));
}

export function formatSampleRosterName(pattern: string, index: number): string {
  const sampleNumber = String(index + 1);
  const paddedSampleNumber = sampleNumber.padStart(2, "0");
  const normalizedPattern = cleanLabel(pattern);
  if (!normalizedPattern) return `sample_${paddedSampleNumber}`;

  let usedToken = false;
  const formatted = normalizedPattern
    .replace(/\{nn\}/gi, () => {
      usedToken = true;
      return paddedSampleNumber;
    })
    .replace(/\{n\}/gi, () => {
      usedToken = true;
      return sampleNumber;
    });

  return (usedToken ? formatted : `${formatted}_${paddedSampleNumber}`).toLowerCase();
}

export function createSampleRosterFromPattern(count: number, pattern: string): SampleRosterItem[] {
  const size = Math.max(0, Math.floor(Number(count) || 0));
  return Array.from({ length: size }, (_, index) => ({
    id: `sample-${index + 1}`,
    sourceName: formatSampleRosterName(pattern, index),
  }));
}

function toStringArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map((item) => cleanLabel(String(item))).filter(Boolean);
}

function metadataValue(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return cleanLabel(String(record.value ?? record.label ?? record.text ?? ""));
  }
  return cleanLabel(String(value ?? ""));
}

function parseFactorColumnLabel(column: string): string {
  return column.match(/^factor value\[(.+)\]$/i)?.[1] ?? column;
}

function compactAlias(value: string): string {
  return cleanLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function snakeCaseAlias(value: string): string {
  return cleanLabel(value).replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`).toLowerCase();
}

function normalizeFactorFieldKey(value: string, fields: SampleFieldDescriptor[]): string {
  const normalized = cleanLabel(value).toLowerCase();
  const compact = compactAlias(value);
  const byAlias = new Map<string, string>();
  const addAlias = (alias: string | undefined, fieldKey: string) => {
    const clean = cleanLabel(alias ?? "").toLowerCase();
    if (clean) byAlias.set(clean, fieldKey);
    const compactKey = compactAlias(alias ?? "");
    if (compactKey) byAlias.set(compactKey, fieldKey);
  };
  for (const field of fields) {
    for (const alias of [field.key, snakeCaseAlias(field.key), field.column, field.factorColumn, field.label, parseFactorColumnLabel(field.factorColumn ?? "")]) addAlias(alias, field.key);
    if (compactAlias(field.key) === "timepoint") addAlias("sampling time", field.key);
  }
  return byAlias.get(normalized) ?? byAlias.get(compact) ?? cleanLabel(value);
}

function safeSamplePrefix(value: string, fallback: string): string {
  const normalized = cleanLabel(value || fallback)
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return normalized || cleanLabel(fallback).toLowerCase();
}

export function canonicalSdrfColumnName(value: string): string {
  const normalized = cleanLabel(value).toLowerCase();
  const bracket = normalized.match(/^(source name|assay name|technology type|material type)$/);
  if (bracket) return bracket[1];
  return normalized
    .replace(/^characteristics\[/, "characteristics[")
    .replace(/^factor value\[/, "factor value[")
    .replace(/^comment\[/, "comment[");
}

function canonicalRowValues(headers: string[], row: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const header of headers) {
    const canonical = canonicalSdrfColumnName(header);
    const value = metadataValue(row[header]);
    if (value && !values[canonical]) values[canonical] = value;
  }
  for (const [header, rawValue] of Object.entries(row)) {
    const canonical = canonicalSdrfColumnName(header);
    const value = metadataValue(rawValue);
    if (value && !values[canonical]) values[canonical] = value;
  }
  return values;
}

function valueFromCanonicalRow(row: Record<string, string>, column: string): string {
  return row[canonicalSdrfColumnName(column)] ?? "";
}

function coreMetadataFromRow(row: Record<string, string>): CoreMappingRow["metadata"] {
  return {
    organism: valueFromCanonicalRow(row, "characteristics[organism]"),
    organismPart: valueFromCanonicalRow(row, "characteristics[organism part]"),
    disease: valueFromCanonicalRow(row, "characteristics[disease]"),
    age: valueFromCanonicalRow(row, "characteristics[age]"),
    sex: valueFromCanonicalRow(row, "characteristics[sex]"),
    individual: valueFromCanonicalRow(row, "characteristics[individual]"),
  };
}

function factorValuesFromCanonicalRow(row: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [column, value] of Object.entries(row)) {
    const factor = column.match(/^factor value\[(.+)\]$/)?.[1];
    if (factor && value) values[factor] = value;
  }
  const disease = valueFromCanonicalRow(row, "characteristics[disease]");
  if (disease && !values.disease) values.disease = disease;
  return values;
}

function meaningfulLabel(value: string): string {
  const clean = cleanLabel(value);
  if (!clean) return "";
  if (/label free|not available|not applicable|unlabeled|none/i.test(clean)) return "";
  return clean;
}

function rawFilePoolSuffix(value: string): string {
  const clean = cleanLabel(value);
  const match = clean.match(/_([A-Za-z0-9]+)\.[^.]+$/);
  return match?.[1] ?? "";
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map(cleanLabel).filter(Boolean))].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function addSetValue(map: Map<string, Set<string>>, key: string, value: string | undefined): void {
  const clean = cleanLabel(value ?? "");
  if (!key || !clean) return;
  const set = map.get(key) ?? new Set<string>();
  set.add(clean);
  map.set(key, set);
}

function biologicalFactorField(field: string): boolean {
  return /disease|treatment|time|dose|stimulus|inhibitor|genotype|phenotype|cell cycle|organism part/i.test(field)
    && !/age|sex|individual|donor|subject|replicate/i.test(field);
}

export function buildCoreExperimentMapFromSdrfTable(table: SdrfLikeTable | null | undefined): CoreExperimentMap {
  const headers = table?.headers ?? [];
  const canonicalRows = (table?.rows ?? []).map((row) => canonicalRowValues(headers, row));
  const rowsWithSource = canonicalRows.filter((row) => valueFromCanonicalRow(row, "source name"));
  const rowsWithFiles = rowsWithSource.filter((row) => valueFromCanonicalRow(row, "comment[data file]"));
  const mappingSourceRows = rowsWithFiles.length ? rowsWithFiles : rowsWithSource;
  const conflicts: MappingConflict[] = [];

  const duplicateColumnGroups = new Map<string, Set<string>>();
  for (const header of headers) addSetValue(duplicateColumnGroups, canonicalSdrfColumnName(header), header);
  for (const [canonical, originals] of duplicateColumnGroups) {
    if (originals.size > 1) {
      conflicts.push({
        type: "duplicate_semantic_column",
        field: canonical,
        message: `${[...originals].join(", ")} map to the same SDRF concept and will be merged in Core Mapping.`,
      });
    }
  }

  const sampleRows = new Map<string, Record<string, string>>();
  for (const row of mappingSourceRows) {
    const sourceName = valueFromCanonicalRow(row, "source name");
    if (sourceName && !sampleRows.has(sourceName)) sampleRows.set(sourceName, row);
  }

  const factorValueSets = new Map<string, Set<string>>();
  for (const row of mappingSourceRows) {
    for (const [field, value] of Object.entries(factorValuesFromCanonicalRow(row))) addSetValue(factorValueSets, field, value);
  }

  const biologicalSamples: BiologicalSample[] = [...sampleRows.entries()].map(([sourceName, row], index) => {
    const metadata = coreMetadataFromRow(row);
    const factorValues = factorValuesFromCanonicalRow(row);
    const sampleGroup = factorValues.disease || metadata.disease || "not available";
    return {
      sourceName,
      biologicalSampleId: sourceName,
      sampleGroup,
      biologicalReplicate: metadata.individual || valueFromCanonicalRow(row, "characteristics[biological replicate]") || String(index + 1),
      metadata: Object.fromEntries(Object.entries(metadata).filter(([, value]) => cleanLabel(value ?? ""))) as Record<string, string>,
      factorValues,
      evidenceRefs: ["current_sdrf_table"],
      warnings: [],
    };
  });

  const dataFileGroups = new Map<string, Record<string, string>[]>();
  for (const row of mappingSourceRows) {
    const dataFile = valueFromCanonicalRow(row, "comment[data file]");
    if (!dataFile) continue;
    const group = dataFileGroups.get(dataFile) ?? [];
    group.push(row);
    dataFileGroups.set(dataFile, group);
  }

  const poolBySignature = new Map<string, SamplePool>();
  const poolIdByDataFile = new Map<string, string>();
  const meaningfulLabelByDataFile = new Map<string, boolean>();
  for (const [dataFile, fileRows] of dataFileGroups) {
    const labels = fileRows.map((row) => meaningfulLabel(valueFromCanonicalRow(row, "comment[label]") || valueFromCanonicalRow(row, "comment[channel]"))).filter(Boolean);
    meaningfulLabelByDataFile.set(dataFile, labels.length > 0);
    const members = uniqueSorted(fileRows.map((row) => valueFromCanonicalRow(row, "source name")));
    if (members.length <= 1 || labels.length) continue;
    const signature = members.join("|");
    let pool = poolBySignature.get(signature);
    if (!pool) {
      pool = {
        poolId: `pool_${String(poolBySignature.size + 1).padStart(2, "0")}`,
        memberSourceNames: members,
        dataFiles: [],
        fractionIds: [],
        evidenceRefs: ["current_sdrf_table:shared_data_file"],
        warnings: [],
      };
      poolBySignature.set(signature, pool);
    }
    pool.dataFiles.push(dataFile);
    for (const row of fileRows) {
      const fraction = valueFromCanonicalRow(row, "comment[fraction identifier]");
      if (fraction) pool.fractionIds.push(fraction);
    }
    poolIdByDataFile.set(dataFile, pool.poolId);
  }

  const pools = [...poolBySignature.values()].map((pool) => ({
    ...pool,
    dataFiles: uniqueSorted(pool.dataFiles),
    fractionIds: uniqueSorted(pool.fractionIds),
  }));
  const poolById = new Map(pools.map((pool) => [pool.poolId, pool]));

  const coreRows: CoreMappingRow[] = mappingSourceRows.map((row, index) => {
    const sourceName = valueFromCanonicalRow(row, "source name");
    const dataFile = valueFromCanonicalRow(row, "comment[data file]");
    const metadata = coreMetadataFromRow(row);
    const factorValues = factorValuesFromCanonicalRow(row);
    const poolId = dataFile ? poolIdByDataFile.get(dataFile) : undefined;
    const label = meaningfulLabel(valueFromCanonicalRow(row, "comment[label]"));
    const channel = meaningfulLabel(valueFromCanonicalRow(row, "comment[channel]"));
    const biologicalReplicate = valueFromCanonicalRow(row, "characteristics[biological replicate]") || metadata.individual || String(index + 1);
    return {
      rowId: `core-row-${index + 1}`,
      sourceName,
      biologicalSampleId: sourceName,
      sampleGroup: factorValues.disease || metadata.disease || "not available",
      biologicalReplicate,
      metadata,
      factorValues,
      poolId,
      poolMembers: poolId ? poolById.get(poolId)?.memberSourceNames ?? [] : undefined,
      label: label || undefined,
      channel: channel || undefined,
      preparation: valueFromCanonicalRow(row, "characteristics[enrichment process]") || valueFromCanonicalRow(row, "comment[fractionation method]") || undefined,
      fractionId: valueFromCanonicalRow(row, "comment[fraction identifier]") || undefined,
      technicalReplicate: valueFromCanonicalRow(row, "comment[technical replicate]") || undefined,
      assayName: valueFromCanonicalRow(row, "assay name") || undefined,
      acquisitionMethod: valueFromCanonicalRow(row, "comment[proteomics data acquisition method]") || undefined,
      dataFile: dataFile || undefined,
      fileUri: valueFromCanonicalRow(row, "comment[file uri]") || undefined,
      evidenceRefs: ["current_sdrf_table"],
      confidence: rowsWithFiles.length ? 0.95 : 0.7,
      warnings: [],
    };
  });

  const labelsByKey = new Map<string, LabelMapping>();
  for (const row of coreRows) {
    const label = row.label || row.channel;
    if (!label) continue;
    const key = `${label}|${row.sourceName}|${row.poolId ?? ""}`;
    const current = labelsByKey.get(key) ?? {
      label,
      channel: row.channel ?? label,
      sourceName: row.sourceName,
      poolId: row.poolId,
      dataFiles: [],
    };
    if (row.dataFile) current.dataFiles.push(row.dataFile);
    labelsByKey.set(key, current);
  }
  const labels = [...labelsByKey.values()].map((item) => ({ ...item, dataFiles: uniqueSorted(item.dataFiles) }));

  const files = [...dataFileGroups.entries()].map(([dataFile, fileRows]) => {
    const sourceNames = uniqueSorted(fileRows.map((row) => valueFromCanonicalRow(row, "source name")));
    const fractionIds = uniqueSorted(fileRows.map((row) => valueFromCanonicalRow(row, "comment[fraction identifier]")));
    return {
      dataFile,
      fileUri: fileRows.map((row) => valueFromCanonicalRow(row, "comment[file uri]")).find(Boolean),
      fractionIds,
      sourceNames,
      poolId: meaningfulLabelByDataFile.get(dataFile) ? undefined : poolIdByDataFile.get(dataFile),
    };
  });

  const assays = coreRows
    .filter((row) => row.assayName || row.dataFile)
    .map((row, index) => ({
      assayName: row.assayName || `assay_${index + 1}`,
      sourceName: row.sourceName,
      dataFile: row.dataFile ?? "",
      fractionId: row.fractionId,
      technicalReplicate: row.technicalReplicate,
      poolId: row.poolId,
    }));

  const variables: ExperimentalVariable[] = [...factorValueSets.entries()]
    .map(([field, values]) => ({
      field,
      values: uniqueSorted(values),
      sourceColumn: `factor value[${field}]`,
      role: biologicalFactorField(field) ? "biological_factor" as const : "covariate" as const,
    }))
    .filter((variable) => variable.values.length > 1);

  const fractionCount = new Set(coreRows.map((row) => row.fractionId).filter(Boolean)).size;
  return {
    biologicalSamples,
    variables,
    pools,
    labels,
    assays,
    files,
    rows: coreRows,
    conflicts,
    summary: {
      biologicalSampleCount: biologicalSamples.length,
      variableCount: variables.filter((variable) => variable.role === "biological_factor").length,
      poolCount: pools.length,
      labelCount: labels.length,
      assayCount: assays.length,
      fractionCount,
      fileCount: files.length,
      mappingRowCount: coreRows.length,
    },
  };
}

export function coreMappingRowsToSdrfRows(rows: CoreMappingRow[]): Record<string, string>[] {
  return rows.map((row) => {
    const output: Record<string, string> = {
      "source name": row.sourceName,
      "characteristics[biological replicate]": row.biologicalReplicate,
    };
    const metadataColumns: Array<[string, string | undefined]> = [
      ["characteristics[organism]", row.metadata.organism],
      ["characteristics[organism part]", row.metadata.organismPart],
      ["characteristics[disease]", row.metadata.disease],
      ["characteristics[age]", row.metadata.age],
      ["characteristics[sex]", row.metadata.sex],
      ["characteristics[individual]", row.metadata.individual],
      ["characteristics[pooled sample]", row.poolId ?? ""],
    ];
    for (const [column, value] of metadataColumns) {
      const clean = cleanLabel(value ?? "");
      if (clean) output[column] = clean;
    }
    for (const [field, value] of Object.entries(row.factorValues)) {
      const clean = cleanLabel(value);
      if (clean) output[`factor value[${field}]`] = clean;
    }
    if (row.label) output["comment[label]"] = row.label;
    if (row.channel) output["comment[channel]"] = row.channel;
    if (row.preparation) output["comment[fractionation method]"] = row.preparation;
    if (row.fractionId) output["comment[fraction identifier]"] = row.fractionId;
    if (row.technicalReplicate) output["comment[technical replicate]"] = row.technicalReplicate;
    if (row.assayName) output["assay name"] = row.assayName;
    if (row.acquisitionMethod) output["comment[proteomics data acquisition method]"] = row.acquisitionMethod;
    if (row.dataFile) output["comment[data file]"] = row.dataFile;
    if (row.fileUri) output["comment[file uri]"] = row.fileUri;
    return output;
  });
}

function parseFactorCandidateClassification(value: unknown): FactorCandidateClassification | null {
  const normalized = cleanLabel(String(value ?? "")).toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "sample_constant"
    || normalized === "biological_factor"
    || normalized === "biological_replicate"
    || normalized === "assay_file_variable"
    || normalized === "rejected"
  ) {
    return normalized;
  }
  return null;
}

function parseFactorValueEntries(value: unknown, fields: SampleFieldDescriptor[]): Array<{ fieldKey: string; value: string }> {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseFactorValueEntries(item, fields));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const explicitField = cleanLabel(String(record.field ?? record.key ?? record.name ?? record.factor_column ?? record.factorColumn ?? record.column ?? ""));
    if (explicitField) {
      return [{
        fieldKey: normalizeFactorFieldKey(explicitField, fields),
        value: metadataValue(record.value ?? record.label ?? record.text ?? record.normalized_value ?? record.normalizedValue),
      }];
    }
    return Object.entries(record).map(([key, rawValue]) => ({
      fieldKey: normalizeFactorFieldKey(key, fields),
      value: metadataValue(rawValue),
    })).filter((entry) => entry.fieldKey);
  }
  return [{ fieldKey: normalizeFactorFieldKey(String(value), fields), value: "" }];
}

export function classifyFactorCandidate(candidate: Pick<FactorCandidateReview, "fieldKey" | "label" | "factorColumn" | "values">): FactorCandidateClassification {
  const text = `${candidate.fieldKey} ${candidate.label} ${candidate.factorColumn}`.toLowerCase();
  if (/(fraction|data file|file uri|assay|run|technical replicate|channel|label|instrument|acquisition|fragmentation|collision)/.test(text)) return "assay_file_variable";
  if (/(biological replicate|replicate|bio rep|rep$)/.test(text)) return "biological_replicate";
  if ((candidate.values ?? []).filter(Boolean).length < 2) return "sample_constant";
  if (/(constant|organism|cell line|cell type|disease|tissue|organism part)/.test(text) && (candidate.values ?? []).filter(Boolean).length <= 1) return "sample_constant";
  return "biological_factor";
}

export function expandSampleGroupsToCanonicalRows(groups: CanonicalSampleGroup[], factorReviews: FactorCandidateReview[]): CanonicalSampleRow[] {
  const acceptedFactorKeys = new Set(
    factorReviews
      .filter((review) => review.enabled && review.classification === "biological_factor")
      .map((review) => review.fieldKey),
  );
  const rows: CanonicalSampleRow[] = [];
  for (const group of groups) {
    const count = Math.max(1, Math.min(200, Math.floor(Number(group.sampleCount) || 1)));
    const prefix = safeSamplePrefix(group.namingPrefix, group.groupName || "sample");
    for (let index = 1; index <= count; index += 1) {
      const biologicalReplicate = String(index);
      const factorValues = Object.fromEntries(
        Object.entries(group.factorValues)
          .filter(([fieldKey, value]) => acceptedFactorKeys.has(fieldKey) && cleanLabel(value))
          .map(([fieldKey, value]) => [fieldKey, cleanLabel(value)]),
      );
      rows.push({
        sampleId: `${prefix}_rep${index}`,
        groupName: group.groupName,
        biologicalReplicate,
        metadata: { ...group.metadata },
        factorValues,
        evidenceRefs: [...group.evidenceRefs],
        warnings: [...group.warnings],
      });
    }
  }
  return rows;
}

export function canonicalRowsToSdrfRows(rows: CanonicalSampleRow[], fields: SampleFieldDescriptor[]): Record<string, string>[] {
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  return rows.map((sample) => {
    const row: Record<string, string> = {
      "source name": sample.sampleId,
      "characteristics[biological replicate]": sample.biologicalReplicate,
    };
    for (const [fieldKey, value] of Object.entries(sample.metadata)) {
      const field = fieldByKey.get(fieldKey);
      if (field?.column && cleanLabel(value)) row[field.column] = cleanLabel(value);
    }
    for (const [fieldKey, value] of Object.entries(sample.factorValues)) {
      const field = fieldByKey.get(fieldKey);
      const factorColumn = field?.factorColumn ?? factorValueColumn(field?.label ?? fieldKey);
      if (cleanLabel(value)) row[factorColumn] = cleanLabel(value);
    }
    return row;
  });
}

export function sampleDesignDraftToCanonicalDesign(
  draft: SampleDesignDraftLike | null | undefined,
  metadataFields: SampleFieldDescriptor[],
): CanonicalSampleDesign {
  const groups = draft?.groups ?? [];
  const fieldByKey = new Map(metadataFields.map((field) => [field.key, field]));
  const candidateValues = new Map<string, Set<string>>();
  const selectedFields = new Set<string>();
  const selectedGroupingFields = new Set<string>();
  const explicitCandidateReasons = new Map<string, string>();
  const explicitCandidateClassifications = new Map<string, FactorCandidateClassification>();
  const groupingStrategy = draft?.groupingStrategy ?? (draft?.grouping_strategy ? {
    selectedGroupingFields: draft.grouping_strategy.selected_grouping_fields,
    candidateGroupingFields: draft.grouping_strategy.candidate_grouping_fields,
    rejectedGroupingFields: draft.grouping_strategy.rejected_grouping_fields,
  } : undefined);

  for (const field of groupingStrategy?.selectedGroupingFields ?? []) {
    const fieldKey = normalizeFactorFieldKey(field, metadataFields);
    selectedFields.add(fieldKey);
    selectedGroupingFields.add(fieldKey);
  }
  for (const candidate of groupingStrategy?.candidateGroupingFields ?? []) {
    const fieldKey = normalizeFactorFieldKey(candidate.field ?? "", metadataFields);
    if (!fieldKey) continue;
    explicitCandidateReasons.set(fieldKey, cleanLabel(candidate.reason ?? ""));
    const classification = parseFactorCandidateClassification(candidate.classification);
    if (classification) explicitCandidateClassifications.set(fieldKey, classification);
    const values = toStringArray(candidate.values);
    if (values.length) {
      const current = candidateValues.get(fieldKey) ?? new Set<string>();
      values.forEach((value) => current.add(value));
      candidateValues.set(fieldKey, current);
    }
  }
  for (const candidate of groupingStrategy?.rejectedGroupingFields ?? []) {
    const fieldKey = normalizeFactorFieldKey(candidate.field ?? "", metadataFields);
    if (!fieldKey) continue;
    explicitCandidateReasons.set(fieldKey, cleanLabel(candidate.reason ?? ""));
    explicitCandidateClassifications.set(fieldKey, parseFactorCandidateClassification(candidate.classification) ?? "rejected");
    const values = toStringArray(candidate.values);
    const current = candidateValues.get(fieldKey) ?? new Set<string>();
    values.forEach((value) => current.add(value));
    candidateValues.set(fieldKey, current);
  }

  const canonicalGroups: CanonicalSampleGroup[] = groups.map((group, index) => {
    const rawMetadata = group.metadata ?? {};
    const metadata: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(rawMetadata)) {
      const value = metadataValue(rawValue);
      if (!value) continue;
      const fieldKey = normalizeFactorFieldKey(key, metadataFields);
      metadata[fieldKey] = value;
      const current = candidateValues.get(fieldKey) ?? new Set<string>();
      current.add(value);
      candidateValues.set(fieldKey, current);
    }

    const factorValues: Record<string, string> = {};
    const rawFactorKeys = [
      ...toStringArray(group.factorKeys ?? group.factor_keys),
      ...parseFactorValueEntries(group.factor_values ?? group.factorValues, metadataFields).map((entry) => {
        if (entry.value) {
          factorValues[entry.fieldKey] = entry.value;
          const current = candidateValues.get(entry.fieldKey) ?? new Set<string>();
          current.add(entry.value);
          candidateValues.set(entry.fieldKey, current);
        }
        return entry.fieldKey;
      }),
    ];
    for (const rawKey of rawFactorKeys) {
      const fieldKey = normalizeFactorFieldKey(rawKey, metadataFields);
      if (fieldKey && metadata[fieldKey] && !factorValues[fieldKey]) factorValues[fieldKey] = metadata[fieldKey];
      if (fieldKey) selectedFields.add(fieldKey);
    }
    for (const fieldKey of selectedFields) {
      if (metadata[fieldKey]) factorValues[fieldKey] = metadata[fieldKey];
    }

    const groupName = cleanLabel(group.groupName ?? group.group_name ?? `Group ${index + 1}`);
    const namingPrefix = safeSamplePrefix(cleanLabel(group.namingPrefix ?? group.naming_prefix ?? groupName), `group_${index + 1}`);
    return {
      id: cleanLabel(group.id ?? `group-${index + 1}`),
      groupName,
      sampleCount: Math.max(1, Math.min(200, Math.floor(Number(group.sampleCount ?? group.sample_count ?? 1) || 1))),
      namingPrefix,
      metadata,
      factorValues,
      evidenceRefs: [],
      warnings: toStringArray(group.warnings),
    };
  });

  const factorCandidates: FactorCandidateReview[] = [...candidateValues.entries()]
    .map(([fieldKey, values]) => {
      const field = fieldByKey.get(fieldKey);
      const reviewBase = {
        fieldKey,
        label: field?.label ?? fieldKey,
        factorColumn: field?.factorColumn ?? factorValueColumn(field?.label ?? fieldKey),
        values: [...values].filter(Boolean),
      };
      const heuristicClassification = classifyFactorCandidate(reviewBase);
      const explicitClassification = explicitCandidateClassifications.get(fieldKey);
      const classification = explicitClassification === "rejected" && heuristicClassification === "assay_file_variable"
        ? heuristicClassification
        : explicitClassification ?? heuristicClassification;
      const resolvedClassification = selectedGroupingFields.has(fieldKey) && classification !== "assay_file_variable" && classification !== "biological_replicate" && classification !== "rejected"
        ? "biological_factor"
        : classification;
      return {
        ...reviewBase,
        classification: resolvedClassification,
        enabled: selectedFields.has(fieldKey) && resolvedClassification === "biological_factor",
        reason: explicitCandidateReasons.get(fieldKey) || (resolvedClassification === "biological_factor" ? "Multi-valued sample metadata can define biological sample groups." : "Classified from field name and observed values."),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));

  const biologicalSystemEntries: Array<[string, EvidenceBackedValue]> = (
    ["organism", "organismPart", "cellLine", "cellType", "disease"]
      .map((fieldKey): [string, EvidenceBackedValue] | null => {
        const field = fieldByKey.get(fieldKey);
        const values = [...(candidateValues.get(fieldKey) ?? [])];
        return field && values.length === 1 ? [fieldKey, { value: values[0], reason: "Constant across AI sample groups." }] : null;
      })
      .filter((entry): entry is [string, EvidenceBackedValue] => Boolean(entry))
  );
  const biologicalSystem = Object.fromEntries(biologicalSystemEntries);
  const missingFields = metadataFields
    .filter((field) => !candidateValues.has(field.key))
    .slice(0, 8)
    .map((field) => ({ fieldKey: field.key, label: field.label ?? field.key, reason: "No value was present in the current AI sample draft." }));
  const conflicts = toStringArray(draft?.warnings).map((message) => ({ type: "ai_warning", message }));
  const expandedSamples = expandSampleGroupsToCanonicalRows(canonicalGroups, factorCandidates);
  return {
    biologicalSystem,
    factorCandidates,
    sampleGroups: canonicalGroups,
    expandedSamples,
    missingFields,
    conflicts,
    summary: cleanLabel(draft?.summary ?? ""),
  };
}

export function detectGroupingCandidates(input: {
  roster: SampleRosterItem[];
  fields: SampleFieldDescriptor[];
  assignmentsByField: Record<string, SampleAssignment[]>;
}): GroupingCandidate[] {
  const order = rosterOrder(input.roster);
  return input.fields.flatMap((field) => {
    const assignments = input.assignmentsByField[field.key] ?? [];
    const values: SampleAssignment[] = [];
    const seen = new Set<string>();
    for (const assignment of assignments) {
      const value = cleanLabel(assignment.value);
      const termAccession = cleanLabel(assignment.termAccession ?? "");
      const sampleIds = orderedSampleIds(assignment.sampleIds ?? [], order);
      if (!value || !sampleIds.length || seen.has(value)) continue;
      seen.add(value);
      values.push(termAccession ? { value, termAccession, sampleIds } : { value, sampleIds });
    }
    if (values.length < 2) return [];
    return [{
      fieldKey: field.key,
      label: field.label ?? field.key,
      factorColumn: field.factorColumn ?? factorValueColumn(field.label ?? field.key),
      values,
    }];
  });
}

export function buildSampleRowsFromAssignments(input: BuildSampleRowsInput): Record<string, string>[] {
  const factorSelections = (input.factorSelections ?? []).filter((selection) => selection.enabled);
  return input.roster.map((sample, index) => {
    const row: Record<string, string> = {
      "source name": sample.sourceName,
      "characteristics[biological replicate]": String(index + 1),
    };

    for (const field of input.fields) {
      const assignment = (input.assignmentsByField[field.key] ?? []).find((item) => (item.sampleIds ?? []).includes(sample.id));
      if (!assignment) continue;
      const value = cleanLabel(assignment.value);
      if (!value) continue;
      row[field.column] = value;
    }

    for (const selection of factorSelections) {
      const field = input.fields.find((item) => item.key === selection.fieldKey);
      if (!field) continue;
      const assignment = (input.assignmentsByField[field.key] ?? []).find((item) => (item.sampleIds ?? []).includes(sample.id));
      const value = assignment ? cleanLabel(assignment.value) : "";
      if (!value) continue;
      row[factorValueColumn(selection.label || field.label || field.key)] = value;
    }

    return row;
  });
}
