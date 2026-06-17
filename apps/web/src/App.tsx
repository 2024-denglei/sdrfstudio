import { useIsMutating, useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Beaker,
  Check,
  ChevronDown,
  CircleDot,
  Dna,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  Folder,
  FolderOpen,
  GitBranch,
  HeartPulse,
  HelpCircle,
  History,
  Hospital,
  Leaf,
  Layers,
  Link2,
  Microscope,
  Network,
  Play,
  Plus,
  Ribbon,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
  Sprout,
  Stethoscope,
  TestTube,
  Trash2,
  UploadCloud,
  UserRound,
  UsersRound,
  Waves,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent, ReactNode } from "react";
import { api } from "./api";
import { AssistantPanel } from "./components/AssistantPanel";
import { BlueprintGraph, type BlueprintGraphData } from "./components/BlueprintGraph";
import { FileUpload } from "./components/FileUpload";
import { Layout } from "./components/Layout";
import { Metric, Panel } from "./components/Panel";
import { SampleSelectionDialog } from "./components/SampleSelectionDialog";
import { SdrfGrid, getSdrfGridHeaders } from "./components/SdrfGrid";
import {
  buildCoreExperimentMapFromSdrfTable,
  buildSampleRowsFromAssignments,
  createSampleRoster,
  createSampleRosterFromPattern,
  detectGroupingCandidates,
  SAMPLE_ROSTER_NAMING_PATTERNS,
  type CoreExperimentMap,
  type CoreMappingRow,
  type FactorCandidateClassification,
  type SampleAssignment,
  type SampleFactorSelection,
  type SampleFieldDescriptor,
  type SampleRosterItem,
} from "./sampleBatch";
import { formatOntologyPrefix, getSampleOntologyFieldOntologies, searchOlsTerms, type OntologyLookupTerm } from "./ontologySearch";
import {
  applyCellLineAnnotationsToAssignments,
  applyCellLineAnnotationsToSampleDraft,
  formatCellLineAnnotationReport,
} from "./cellLineMatcher";
import { useStudioStore } from "./store";
import type { Blueprint, BlueprintNode, MappingEdge, Project, SdrfTable, StepKey } from "./types";
import { UPSTREAM_SDRF_TEMPLATES, type UpstreamSdrfColumn, type UpstreamSdrfRequirement } from "./upstreamSdrfTemplates.generated";
import { steps, stepIndex } from "./workflow";

type DetailValue = string | number | boolean | null | undefined;
type DetailRow = Record<string, DetailValue>;
type DetailSection =
  | { kind: "kv"; title?: string; rows: { label: string; value: DetailValue }[] }
  | { kind: "table"; title?: string; columns: { key: string; label: string }[]; rows: DetailRow[] }
  | { kind: "actions"; title?: string; actions: { label: string; href: string }[] }
  | {
      kind: "upload";
      title?: string;
      label: string;
      accept?: string;
      mode: "pdf" | "design" | "supplementary";
      actions?: { label: string; href: string }[];
      note?: string;
    };
type ImportResultItem = {
  title: string;
  status: "ok" | "missing" | "unknown";
  message: string;
  details: DetailSection[];
  icon?: ReactNode;
};
type StoredImportResultItem = Omit<ImportResultItem, "icon">;
type ColumnMapping = Record<string, string>;
type ColumnMappingReasons = Record<string, string>;
type AiMappingResult = { mapping: ColumnMapping; reasons: ColumnMappingReasons; fileReason: string };
type MappedDesignTable = { headers: string[]; rows: Record<string, string>[] };
type SdrfNormalizationIssue = {
  rowIndex: number;
  field: string;
  originalValue: string;
  normalizedValue: string;
  reason: string;
  severity: "info" | "warning" | "error";
};
type SdrfNormalizationResult = { table: MappedDesignTable; issues: SdrfNormalizationIssue[]; summary: string };
type SdrfTemplateId =
  | "ms-proteomics"
  | "affinity-proteomics"
  | "ms-metabolomics"
  | "human"
  | "vertebrates"
  | "invertebrates"
  | "plants"
  | "clinical-metadata"
  | "oncology-metadata"
  | "dia-acquisition"
  | "single-cell"
  | "crosslinking"
  | "immunopeptidomics"
  | "metaproteomics"
  | "cell-lines"
  | "human-gut"
  | "soil"
  | "water"
  | "lc-ms-metabolomics"
  | "gc-ms-metabolomics";
type SdrfTemplateLayer = "technology" | "sample" | "experiment";
type ColumnImpactGroupKey = "required" | "recommended" | "new";
type SdrfTemplate = {
  id: SdrfTemplateId;
  title: string;
  version: string;
  layer: SdrfTemplateLayer;
  exclusiveGroup?: "technology" | "sample-context" | "metabolomics-method";
  icon: LucideIcon;
  category: string;
  description: string;
  examples: string[];
  columns: string[];
  requiredColumns: string[];
};
type TemplateRecommendationSourceRef = {
  label: string;
  value: string;
  source?: string;
  field?: string;
  location?: string;
};
type TemplateRecommendationReason = {
  templateId: SdrfTemplateId;
  reason: string;
  sources: TemplateRecommendationSourceRef[];
};
type TemplateRecommendation = {
  selectedIds: SdrfTemplateId[];
  confidence: number;
  detectedSummary: string;
  evidenceLabels: string[];
  ruleNotes: string[];
  importHighlights: TemplateRecommendationSourceRef[];
  sourceSummary: string;
  source?: "ai" | "rules";
  model?: string;
  generatedAt?: string;
  promptVersion?: number;
  aiRationale?: string[];
  templateReasons?: TemplateRecommendationReason[];
  validationNotes?: string[];
};
type SessionUploadedFileSummary = {
  id: string;
  filename: string;
  fileType: string;
  parseStatus: string;
  createdAt: string;
};
type SessionImportState = {
  accession?: string;
  activeImportAccession?: string;
  prideAccession?: string;
  prideTitle?: string;
  prideDescription?: string;
  prideOrganisms?: string[];
  prideInstruments?: string[];
  prideKeywords?: string[];
  rawFileCount?: number;
  publicationCount?: number;
  prideImportResults?: StoredImportResultItem[];
  prideImportResultsUpdatedAt?: string;
  uploadedFiles?: SessionUploadedFileSummary[];
  importedAt?: string;
  startMode?: "pride" | "local" | "scratch";
  designCsvChoice?: "unknown" | "yes" | "no";
  designFileId?: string;
  designMapping?: ColumnMapping;
  designMappingReasons?: ColumnMappingReasons;
  designMappingFileReason?: string;
  designMappingStatus?: string;
  designMappingConfirmed?: boolean;
  rawDesignTable?: MappedDesignTable | null;
  mappedDesignTable?: MappedDesignTable | null;
  normalizationStatus?: string;
  normalizationIssues?: SdrfNormalizationIssue[];
};
type SessionTemplateState = {
  selectedTemplates?: SdrfTemplateId[];
  reviewOpen?: boolean;
  aiRecommendation?: TemplateRecommendation;
  aiRecommendationStatus?: "idle" | "running" | "success" | "error";
  aiRecommendationError?: string;
  aiRecommendationUpdatedAt?: string;
};
type SessionSampleState = {
  aiDraft?: Record<string, unknown>;
  aiStatus?: "idle" | "running" | "success" | "error";
  aiError?: string;
  aiUpdatedAt?: string;
  acceptedDraft?: Record<string, unknown>;
  acceptedUpdatedAt?: string;
};
type SessionUiState = {
  version?: number;
  projectId?: string;
  displayName?: string;
  currentStep?: StepKey;
  step?: StepKey;
  updatedAt?: string;
  import?: SessionImportState;
  templates?: SessionTemplateState;
  samples?: SessionSampleState;
  pages?: Partial<Record<StepKey, Record<string, unknown>>>;
};
type ResolvedSessionDesignState = {
  designFileId?: string;
  designMapping: ColumnMapping;
  designMappingReasons: ColumnMappingReasons;
  designMappingFileReason: string;
  designMappingStatus: string;
  designMappingConfirmed: boolean;
  rawDesignTable: MappedDesignTable | null;
  mappedDesignTable: MappedDesignTable | null;
  normalizationStatus: string;
  normalizationIssues: SdrfNormalizationIssue[];
};
type SampleMetadataKey = string;
type SampleContextMode = "sample-metadata" | "human" | "vertebrates" | "invertebrates" | "plants" | "metaproteomics";
type SampleMetadataRequirement = "required" | "recommended" | "context" | "optional";
type SampleFactorKey = string;
type SampleMetadataField = {
  key: SampleMetadataKey;
  label: string;
  displayLabel?: string;
  column: string;
  placeholder: string;
  requirement: SampleMetadataRequirement;
  contexts?: SampleContextMode[];
  ontology?: boolean;
  ontologies?: readonly string[];
  inputType?: "text" | "select";
  options?: string[];
  hint?: string;
  description?: string;
  searchPlaceholder?: string;
  commonChoices?: string[];
  templateOnly?: boolean;
  factorKey?: SampleFactorKey;
  factorColumn?: string;
};
type SampleOntologyTerm = {
  field: SampleMetadataKey;
  label: string;
  accession: string;
  ontology: string;
  reason?: string;
};
type SampleMetadataEvidence = {
  field: SampleMetadataKey;
  value: string;
  reason: string;
  sources: TemplateRecommendationSourceRef[];
  confidence?: number;
};
type SampleGroupingFieldDecision = {
  field: string;
  values: string[];
  reason: string;
  sources: TemplateRecommendationSourceRef[];
  classification?: FactorCandidateClassification;
};
type SampleGroupingStrategy = {
  selectedGroupingFields: string[];
  candidateGroupingFields: SampleGroupingFieldDecision[];
  rejectedGroupingFields: SampleGroupingFieldDecision[];
  reason: string;
  sources: TemplateRecommendationSourceRef[];
};
type SampleAssayContext = Record<string, string | number | boolean | string[]>;
type SampleDesignGroup = {
  id: string;
  groupName: string;
  sampleCount: number;
  namingPrefix: string;
  metadata: Partial<Record<SampleMetadataKey, string>>;
  metadataEvidence?: Partial<Record<SampleMetadataKey, SampleMetadataEvidence>>;
  ontologyTerms: SampleOntologyTerm[];
  factorKeys: SampleFactorKey[];
  assayContext?: SampleAssayContext;
  warnings?: string[];
};
type SampleBiologicalSample = {
  sourceName: string;
  biologicalSampleId?: string;
  sampleGroup?: string;
  biologicalReplicate?: string;
  poolId?: string;
  metadata: Partial<Record<SampleMetadataKey, string>>;
  metadataEvidence?: Partial<Record<SampleMetadataKey, SampleMetadataEvidence>>;
  ontologyTerms?: SampleOntologyTerm[];
  factorKeys?: SampleFactorKey[];
  factorValues?: Record<string, string>;
  warnings?: string[];
};
type SampleDesignDraft = {
  groups: SampleDesignGroup[];
  biologicalSamples?: SampleBiologicalSample[];
  mappingRows?: Record<string, unknown>[];
  relationshipLayers?: BlueprintRelationshipLayer[];
  summary: string;
  sources: TemplateRecommendationSourceRef[];
  groupingStrategy?: SampleGroupingStrategy;
  warnings?: string[];
  rawJson?: Record<string, unknown>;
};
type BlueprintRelationshipLayer = {
  field: string;
  label: string;
  role: string;
  source?: string;
  reason?: string;
};
type SampleAiMutationSnapshot = {
  status: string;
  submittedAt: number;
  data?: unknown;
  error?: unknown;
};
type SampleAssignmentDraft = {
  value: string;
  sampleIds: string[];
};
type SampleOntologySearchState = {
  field: SampleMetadataKey;
  query: string;
  results: SampleOntologyTerm[];
  loading: boolean;
  error?: string;
};
type SampleFactorDraft = SampleFactorSelection & {
  source: "detected" | "custom";
};
type SampleRosterNamingMode = "auto" | "custom";
type SampleRosterNamingPatternId = (typeof SAMPLE_ROSTER_NAMING_PATTERNS)[number]["id"];

export const SDRF_TEMPLATE_RECOMMENDATION_SYSTEM_PROMPT = [
  "You recommend SDRF template stacks using the quantms SDRF template architecture.",
  "Always choose exactly one technology template: ms-proteomics, affinity-proteomics, or ms-metabolomics.",
  "For affinity-proteomics evidence such as Olink, SomaScan, proximity extension, aptamer or antibody assay kit, choose affinity-proteomics and do not add MS-proteomics experiment extensions.",
  "For metabolomics or lipidomics evidence, choose ms-metabolomics; add lc-ms-metabolomics only when metabolomics evidence and LC/UHPLC/HPLC evidence co-occur, or gc-ms-metabolomics only when GC-MS evidence appears.",
  "For ordinary mass-spectrometry proteomics, choose ms-proteomics; only then add proteomics experiment templates such as dia-acquisition, single-cell, crosslinking, immunopeptidomics, or cell-lines when evidence is explicit.",
  "Select a sample-context template only when the organism or sample context clearly matches an available template: human for Homo sapiens/human donors; vertebrates for non-human vertebrate animals; invertebrates only for invertebrate animals such as Drosophila, C. elegans, and insects; plants for plant samples; metaproteomics/human-gut/soil/water for microbial or environmental sample contexts.",
  "Clinical-metadata and oncology-metadata are overlays and may be combined with a matching primary sample context.",
  "Do not classify parasites, protists, bacteria, fungi, or unsupported taxa such as Plasmodium as human, vertebrate, invertebrate, or plant just to satisfy a sample template. If no sample template fits, return the technology template only and explain the unsupported sample-context gap.",
  "Prefer human-gut, soil, or water over generic human/plants/vertebrates when the evidence indicates metaproteomics sample context.",
  "Never recommend label/template ids that do not exist in the supported template registry; labeling keywords are evidence only, not a template selection.",
  "Use the user's Import page context first: PRIDE accession, project title, organisms, instruments, uploaded design tables, parsed file evidence, and current SDRF headers.",
  "For every selected template, explain why that template was chosen and cite concrete source locations from the Import page context, current_evidence, uploaded_files, or current_sdrf_table.",
  "Source citations must include a human label, exact observed value, and where it came from, such as Import > PRIDE metadata > title, current_evidence > pride > project accession, uploaded file > filename, or design table > characteristics[organism].",
  "Return strict JSON only with selected_template_ids, confidence, detected_summary, evidence_labels, rule_notes, import_highlights, template_reasons, and rationale.",
].join("\n");

export const SAMPLE_DESIGN_JSON_SYSTEM_PROMPT = [
  "You generate editable SDRF Core Mapping JSON from PRIDE/project metadata, publication PDF evidence, uploaded metadata/design tables, and raw file lists.",
  "Return strict JSON only. Do not include markdown, prose, comments, nulls, or keys outside the requested schema.",
  "Follow the SDRF-Proteomics v1.1.0 / quantMS SDRF specification for proteomics SDRF semantics.",
  "Each mapping_rows item is one SDRF row: one source name / biological sample relationship to one assay name and one data file, with optional pool, label/channel, preparation, fraction, acquisition method, and technical replicate context.",
  "For MS proteomics mapping rows, preserve the SDRF column semantics for source name, assay name, technology type, comment[proteomics data acquisition method], comment[label], comment[fraction identifier], comment[technical replicate], comment[data file], and comment[file uri].",
  "Use source_name for source name, assay_name for assay name, acquisition_method for comment[proteomics data acquisition method], label for comment[label], fraction_id for comment[fraction identifier], technical_replicate for comment[technical replicate], data_file for comment[data file], and file_uri for comment[file uri].",
  "When evidence supports an unlabeled experiment, set label to label free sample. Use not available only when the label state is genuinely unknown.",
  "Do not use existing SDRF files or current SDRF table rows as evidence for AI inference. Existing SDRF file records are excluded before model input is built.",
  "The Core Mapping page builds the central relationship table from biological samples to pools, labels/channels, fractions, assays, and data files.",
  "A mapping row represents one biological sample to data-file relationship, optionally through pool, label/channel, fraction, acquisition method, technical replicate, and assay run.",
  "You must reconstruct the experiment in stages before generating sample groups or mapping rows: evidence inventory, raw filename design summary, entity review, axis classification, relationship hypotheses, core mapping rows, biological grouping strategy, then coverage check.",
  "Use schema_version \"sdrf-core-mapping-v1\" and top-level evidence_inventory, biological_samples, variables, pools, labels, assays, files, mapping_rows, raw_file_design_summary, axis_review, grouping_strategy, relationship_layers, sample_groups, assay_context, coverage_check, warnings, summary, and sources.",
  "Use evidence in this priority order: 1 publication PDF or full-text statements about samples, pooling, labeling, fractionation, and acquisition; 2 parsed design tables or uploaded structured metadata; 3 raw file names and repeated filename patterns that you infer yourself; 4 PRIDE project metadata, project sample metadata, and protocols; 5 PRIDE title, description, and keywords only as weak hints.",
  "Do not hard-code project-specific tokens. Infer axes from repeated filename slots, table headers, PDF phrases, protocols, and cross-source consistency.",
  "Every biological sample, pool, label, fraction, assay, and data-file relationship must cite exact evidence with source label, observed value, and location. If evidence is missing, use not available and add a warning.",
  "First identify the row granularity supported by evidence: individual biological sample, pooled sample, labeled channel, fraction, technical replicate, assay run, and data file.",
  "Do not collapse individual-level covariates such as age, sex, individual, donor, or subject id into group metadata. Keep them on each biological sample and mapping row.",
  "Discover relationship layers dynamically from evidence. For every observed relationship axis, decide whether it is a biological grouping axis, sample metadata, biological replicate, aggregation/preparation layer, label/channel, fraction/preparation, acquisition/assay method, technical replicate, assay run, or data-file layer.",
  "When evidence indicates an aggregation layer such as a pool, preserve source-level biological samples separately from the aggregation entity; sample_count must count source-level biological samples supported by evidence, not aggregation rows.",
  "relationship_layers must describe the ordered Blueprint path inferred from evidence. Include only layers that are supported by evidence or required by the SDRF row relationship; do not add placeholder layers just because they exist in the schema.",
  "If label/channel/TMT/iTRAQ/SILAC or other multiplex labels are present, map each label/channel to the biological sample or pool and do not infer pooling from shared files alone.",
  "Biological replicate means distinct biological samples with the same factor values. Technical replicate means repeated assay/data-file measurements from the same biological sample or pool.",
  "Fractions multiply assay/file rows, not biological sample count.",
  "If raw filename evidence is available, it is mandatory evidence for observed conditions, replicate IDs, preparations, acquisition methods, labels/channels, and fractions. The backend does not semantically parse raw filenames; you must infer filename slots from repeated patterns and cross-source context. Raw filenames can prove file-level structure but cannot alone prove biological meaning when tokens are ambiguous.",
  "mapping_rows must include every raw_file_names item from raw_file_evidence or sample_evidence_bundle.raw_file_summary. Do not return only example files. If any raw file cannot be confidently mapped, include it in mapping_rows with the best supported biological context, set uncertain fields to not available, and list it in coverage_check.missing_raw_files or warnings for user review.",
  "Before sample_groups, output raw_file_design_summary. Each row must include preparation, acquisition_method, biological_condition, treatment, timepoint, replicate_ids, raw_file_count, fractions, labels_or_channels, pool_hint, and example_filenames when available.",
  "Before generating sample_groups, classify every observed field as one of: sample constant, biological/experimental factor, assay/technical variable, or rejected grouping axis.",
  "For each candidate field, explicitly classify it as sample_constant, biological_factor, biological_replicate, technical_replicate, pool, label_channel, assay_file_variable, or rejected.",
  "Never use constant fields such as organism, organism part, cell line, disease, instrument, or label as grouping fields when the evidence shows one value across all rows.",
  "Never use fraction identifier, data file, file URI, assay name, or technical replicate as sample grouping fields; these belong in assay_context.",
  "Never use acquisition method, fragmentation method, instrument method, search method, data processing method, or LC fraction as a biological grouping field unless the paper explicitly states it is the biological comparison.",
  "Do not put acquisition_method into factor_values. Acquisition or fragmentation methods are assay/file technical context unless explicit evidence says they define biological material.",
  "Filename slots for fraction, pH, slice, fraction number, data file, assay name, technical replicate, label/channel, instrument, acquisition, preparation, enrichment, and cleanup default to assay_file_variable unless the evidence explicitly proves they are biological sample attributes.",
  "Filename slots for treatment, timepoint, dose, stimulus, inhibitor, genotype, perturbation, disease state, tissue/organism part, cell type, cell cycle state, subject, donor, or cohort are biological-condition evidence when supported by PDF, metadata, or repeated raw-file structure.",
  "Do not convert a control/untreated/baseline label to a timepoint unless the evidence explicitly says it is a timepoint baseline.",
  "Select one or more experimental conditions as grouping fields only when they describe biological material before acquisition. Candidate fields include treatment, timepoint, dose, stimulus, inhibitor, genotype, disease state, cell type, tissue, cohort, and organism part.",
  "Replicate IDs support biological_replicate or technical_replicate assignment; they are not grouping fields. Fraction is assay_context unless explicit evidence says it is biological.",
  "Acquisition method and fragmentation method compare instrument/assay strategy, not biological material; they belong in assay_context even when they define two raw-file groups.",
  "sample_count is the number of distinct biological samples or biological replicate IDs supporting a biological group, not the number of RAW files.",
  "Fractions, technical replicates, assay methods, and technical preparations increase mapping_rows and raw_file_count but never biological sample count.",
  "preparation/enrichment can be selected only when you explain why it is an experimental biological comparison axis; otherwise keep it in assay_context.",
  "Selected grouping fields must cover all high-cardinality experimental factors supported by sample_evidence_bundle, publication evidence, uploaded design/metadata tables, PRIDE metadata, or raw file names.",
  "If multiple independent experimental axes are present, use their cross-product for sample groups or explicitly explain why one axis is assay-only.",
  "Do not collapse distinct observed biological conditions unless stronger evidence says they are the same group. Conditions with different treatment, dose, genotype, disease state, tissue, cohort, or timepoint are different groups.",
  "Reject disease as a factor when disease is constant across all samples; keep it as sample metadata instead.",
  "If PDF conflicts with PRIDE metadata, prefer PDF and add a warning. If RAW file statistics conflict with textual replicate counts, report the conflict and use the count best supported by raw file grouping.",
  "If PDF/design metadata states individual sample attributes such as age, sex, donor, disease, or subject id, keep them per biological sample even when sample groups are organized by disease or cohort.",
  "mapping_rows must expand to the row granularity required by the evidence and SDRF semantics. Use the observed relationship axes to decide whether rows represent source samples, aggregation entities, labels/channels, fractions, acquisition methods, technical replicates, assay runs, or data files.",
  "grouping_strategy must include selected_grouping_fields, candidate_grouping_fields, rejected_grouping_fields, reason, and sources.",
  "Each sample group must include group_name, sample_count, naming_prefix, metadata, factor_values, ontology_terms, assay_context, and warnings.",
  "The allowed_metadata_fields and selected_template_metadata_requirements are built dynamically from the user's selected SDRF templates.",
  "metadata keys must be camelCase keys from allowed_metadata_fields only; omit unknown or unsupported metadata instead of inventing new keys.",
  "Every required metadata field must be present for every sample group. If direct evidence is absent, use the SDRF reserved value not available and explain that evidence is missing.",
  "Recommended, context, and optional metadata fields must be returned only when explicit evidence supports the value.",
  "Each metadata entry must be an object with value, reason, and sources. The reason must explain why this value was chosen.",
  "Each metadata source must cite a concrete observed value and location, such as Import > PRIDE metadata, publication PDF, design table > column name, raw file summary, or evidence > source_ref.",
  "factor_values must use exact factor_column values from allowed_metadata_fields only.",
  "ontology_terms must be included only when an exact ontology accession is present in the evidence; otherwise leave it empty.",
  "The JSON will be rendered into an editable right-rail form, then copied into the left-side sample roster and attribute assignment editor.",
  "Do not invent sample groups, sample counts, organisms, tissues, diseases, treatments, or ontology accessions when evidence is absent.",
  "Use conservative sample_count values. Prefer RAW replicate statistics or exact design rows when they provide better-supported counts.",
  "Every sample group must include sample_count and explain replicate_source in warnings or assay_context when the evidence came from RAW filenames or design tables.",
  "If different preparation layers have different replicate coverage for the same biological condition, keep one biological sample group when appropriate, but report the preparation-specific coverage in assay_context and warnings.",
  "coverage_check must account for every raw filename preparation-condition group as covered_by_biological_sample_group, assay_context_only, or unresolved_conflict.",
  "coverage_check.missing_biological_conditions must list any biological condition observed in raw filenames but absent from sample_groups. Do not return a final-looking design when missing_biological_conditions is non-empty.",
  "Values must be plain labels suitable for SDRF table cells.",
  "Return design_audit and coverage_check when structured metadata/design/raw-file evidence is available: include row counts, sample counts, data-file counts, biological axes, assay axes, rejected axes, covered axes, missing axes, and warnings.",
].join("\n");
export const PDF_EXPERIMENT_FACTS_SYSTEM_PROMPT = [
  "Extract experiment-design facts from publication PDF text.",
  "Return strict JSON only. Do not include markdown, prose, comments, nulls, or keys outside the requested schema.",
  "Use only publication_documents page text plus project metadata in the user input. Do not use existing SDRF files, current SDRF table rows, or downloaded SDRF rows.",
  "The backend performed only mechanical PDF text extraction. You must read the PDF text yourself and decide which statements matter.",
  "Do not generate SDRF rows or sample groups in this stage.",
  "Extract facts about biological samples, subjects/donors, organism or tissue, pools or aggregation, labels/channels, fractionation or gel slices, enrichment/preparation, acquisition/assay setup, biological replicates, technical replicates, and explicit uncertainties.",
  "When a PDF table lists individual subjects, donors, or samples with columns such as sample ID, age, gender/sex, disease, cause of death, tissue, pool membership, or other covariates, extract every table row into individual_sample_facts. Do not summarize those rows into one fact.",
  "Every fact must cite the PDF page number and include an exact short observed value from the page text.",
  "If the PDF states a mapping such as subjects 1-4 vs 5-8 pools, preserve the individual subjects and the aggregation relationship separately.",
  "Return schema_version pdf-experiment-facts-v1 with sample_facts, individual_sample_facts, pool_facts, fractionation_facts, label_facts, preparation_facts, acquisition_facts, replicate_facts, assay_facts, uncertainties, citations, and summary.",
].join("\n");
export const COMPACT_SAMPLE_CORE_MAPPING_SYSTEM_PROMPT = [
  "Use compact Core Mapping JSON to generate an editable SDRF Samples and Blueprint draft from already-extracted PDF facts, PRIDE/project metadata, uploaded metadata/design summaries, and raw file names.",
  "Return strict JSON only. Do not include markdown, prose, comments, nulls, or keys outside the requested contract.",
  "Do not use existing SDRF files, downloaded SDRF files, uploaded SDRF rows, or current SDRF table rows.",
  "Follow SDRF-Proteomics v1.1.0 / quantMS semantics: source_name maps biological material to assay_name and data_file through optional pool_id, label, fraction_id, acquisition_method, technical_replicate, and preparation.",
  "Use the publication_pdf_fact_extraction facts as the highest-priority evidence. Cite fact page numbers or observed values in sources and reasons.",
  "Infer raw filename slots dynamically from raw_file_names and cross-check them against PDF facts. The backend has not semantically parsed raw filenames.",
  "Do not use fraction, slice, data file, assay name, technical replicate, acquisition method, or instrument method as biological grouping fields unless PDF facts explicitly say they define biological material.",
  "Fractions and technical replicates multiply mapping rows and assays, not biological sample count.",
  "When PDF facts indicate pooling, keep individual biological samples in biological_samples and list pool_members on pools and mapping_rows.",
  "When publication_pdf_fact_extraction.individual_sample_facts is present, biological_samples must contain one source-level row per extracted subject/sample with its individual metadata such as age, sex, disease/cause of death, tissue, and pool_id when known.",
  "Do not replace source-level biological_samples with pool rows. sample_groups describe factor-defined groups only; pools are aggregation entities and must not hide individual subjects.",
  "For pooled assays, return one mapping_rows item per data_file with source_name representing the pool and pool_members listing source-level samples. Do not duplicate the same data_file once per pool member unless evidence says each member has its own file.",
  "Return mapping_groups that reference raw_file_ids from raw_file_evidence.raw_file_catalog. Do not copy full raw filenames into the model output; the app expands raw_file_ids into mapping_rows.",
  "mapping_groups must include every raw_file_catalog id exactly once or list unresolved IDs in coverage_check.missing_raw_files with a warning.",
  "Every sample group must include group_name, sample_count, naming_prefix, metadata, factor_values, assay_context, warnings, and sources when available.",
  "Return top-level keys requested by output_contract: schema_version, evidence_inventory, biological_samples, pools, labels, assays, files, mapping_groups, raw_file_design_summary, axis_review, grouping_strategy, relationship_layers, sample_groups, coverage_check, warnings, summary, and sources. The app will expand mapping_groups into mapping_rows.",
].join("\n");
const TEMPLATE_AI_PROMPT_VERSION = 2;
export const TEMPLATE_AI_REQUEST_TIMEOUT_MS = 600_000;
export const SAMPLE_AI_REQUEST_TIMEOUT_MS = 600_000;
const AI_RESPONSE_BODY_PREVIEW_LIMIT = 800;

export async function formatAiResponseError(prefix: string, response: Response): Promise<string> {
  let detail = "";
  try {
    detail = cleanOneLineString(await response.text());
  } catch {
    detail = "";
  }
  const preview = detail.length > AI_RESPONSE_BODY_PREVIEW_LIMIT
    ? `${detail.slice(0, AI_RESPONSE_BODY_PREVIEW_LIMIT)}...`
    : detail;
  return preview ? `${prefix}: ${response.status}: ${preview}` : `${prefix}: ${response.status}`;
}

function aiChatContent(payload: Record<string, unknown>): unknown {
  const choices = payload.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    if (message && "content" in message) return message.content;
  }
  return payload;
}

export function App() {
  const queryClient = useQueryClient();
  const { projectId, setProjectId, step, setStep } = useStudioStore();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const createProject = useMutation({
    mutationFn: (name?: string) => api.createProject(name ?? "New SDRF Project"),
    onSuccess: (project) => {
      queryClient.setQueryData<Project[]>(["projects"], (current = []) => [
        project,
        ...current.filter((item) => item.id !== project.id),
      ]);
      setProjectId(project.id);
      setStep("import");
      writeSessionUiState(project.id, {
        version: 2,
        projectId: project.id,
        displayName: project.name || "Untitled session",
        currentStep: "import",
        step: "import",
        pages: { import: { visitedAt: new Date().toISOString() } },
      });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const deleteProject = useMutation({
    mutationFn: (sessionProjectId: string) => api.deleteProject(sessionProjectId),
    onSuccess: (_result, deletedProjectId) => {
      removeSessionUiState(deletedProjectId);
      const currentProjects = queryClient.getQueryData<Project[]>(["projects"]) ?? [];
      const remainingProjects = currentProjects.filter((item) => item.id !== deletedProjectId);
      queryClient.setQueryData<Project[]>(["projects"], remainingProjects);
      queryClient.removeQueries({ queryKey: ["files", deletedProjectId] });
      queryClient.removeQueries({ queryKey: ["analysis", deletedProjectId] });
      queryClient.removeQueries({ queryKey: ["sdrf-table", deletedProjectId] });
      if (projectId === deletedProjectId) {
        const nextProject = remainingProjects[0];
        if (nextProject) {
          setProjectId(nextProject.id);
          setStep(getStoredSessionStep(nextProject));
        } else {
          setProjectId(null);
          setStep("import");
        }
      }
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  useEffect(() => {
    if (projects.data?.length) {
      const activeProject = projectId ? projects.data.find((item) => item.id === projectId) : undefined;
      if (!activeProject) {
        const nextProject = projects.data[0];
        setProjectId(nextProject.id);
        setStep(getStoredSessionStep(nextProject));
      }
    }
    if (projects.data && projects.data.length === 0 && !createProject.isPending && !projectId) {
      createProject.mutate("New SDRF Session");
    }
  }, [projects.data, projectId]);

  const project = projects.data?.find((item) => item.id === projectId) ?? projects.data?.[0];
  const analysis = useQuery({ queryKey: ["analysis", project?.id], queryFn: () => api.getAnalysis(project!.id), enabled: Boolean(project?.id) });
  const files = useQuery({ queryKey: ["files", project?.id], queryFn: () => api.listFiles(project!.id), enabled: Boolean(project?.id) });
  const sdrfTable = useQuery({ queryKey: ["sdrf-table", project?.id], queryFn: () => api.getSdrfTable(project!.id), enabled: Boolean(project?.id) });

  useEffect(() => {
    if (!project?.id) return;
    updateSessionUiState(project.id, (current) => syncSessionWithProject(project, {
      ...current,
      currentStep: step,
      step,
      pages: {
        ...current.pages,
        [step]: {
          ...(current.pages?.[step] ?? {}),
          visitedAt: new Date().toISOString(),
        },
      },
    }));
  }, [project?.id, project?.name, project?.pride_accession, step]);

  const selectSession = (session: Project) => {
    setProjectId(session.id);
    setStep(getStoredSessionStep(session));
  };
  const createSession = () => {
    createProject.mutate(newSessionName());
  };
  const deleteSession = (session: Project) => {
    const title = sessionTitle(session);
    const confirmed = window.confirm(`Delete session "${title}"? This permanently removes the session, uploaded files, analysis results, and exports.`);
    if (confirmed) deleteProject.mutate(session.id);
  };
  const goNext = () => setStep(steps[Math.min(steps.length - 1, stepIndex(step) + 1)].key);
  const continueLabel = stepIndex(step) === steps.length - 1 ? "Finish" : "Continue";
  return (
    <Layout
      project={project}
      headerAction={project ? (
        <>
          <SessionSwitcher
            projects={projects.data ?? []}
            activeProject={project}
            activeStep={step}
            creating={createProject.isPending}
            deletingProjectId={deleteProject.isPending ? deleteProject.variables : undefined}
            onSelect={selectSession}
            onCreate={createSession}
            onDelete={deleteSession}
          />
          <button className="btn primary" type="button" onClick={goNext}>{continueLabel}</button>
        </>
      ) : undefined}
    >
      {!project ? (
        <div className="loading-state">Creating SDRF workspace...</div>
      ) : (
        <>
          <StepContent
            key={project.id}
            step={step}
            project={project}
            projectId={project.id}
            files={files.data ?? []}
            analysis={analysis.data}
            table={sdrfTable.data}
            refresh={() => {
              queryClient.invalidateQueries({ queryKey: ["projects"] });
              queryClient.invalidateQueries({ queryKey: ["files", project.id] });
              queryClient.invalidateQueries({ queryKey: ["analysis", project.id] });
              queryClient.invalidateQueries({ queryKey: ["sdrf-table", project.id] });
            }}
          />
        </>
      )}
    </Layout>
  );
}

function SessionSwitcher({
  projects,
  activeProject,
  activeStep,
  creating,
  deletingProjectId,
  onSelect,
  onCreate,
  onDelete,
}: {
  projects: Project[];
  activeProject: Project;
  activeStep: StepKey;
  creating: boolean;
  deletingProjectId?: string;
  onSelect: (project: Project) => void;
  onCreate: () => void;
  onDelete: (project: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="session-switcher">
      <button className="btn ghost session-trigger" type="button" onClick={() => setOpen((current) => !current)}>
        <History size={16} />
        <span>{sessionTitle(activeProject)}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="session-menu">
          <div className="session-menu-head">
            <strong>Sessions</strong>
            <span>Reload previous page choices</span>
          </div>
          <button
            className="session-create"
            type="button"
            disabled={creating}
            onClick={() => {
              onCreate();
              setOpen(false);
            }}
          >
            <Plus size={16} /> {creating ? "Creating..." : "New session"}
          </button>
          <div className="session-list">
            {projects.map((project) => {
              const sessionState = readSessionUiState(project.id);
              const sessionStep = sessionState.currentStep ?? sessionState.step ?? coerceStepKey(project.current_step);
              const active = project.id === activeProject.id;
              const title = sessionTitle(project);
              return (
                <div
                  key={project.id}
                  className={`session-item ${active ? "active" : ""}`}
                >
                  <button
                    className="session-select"
                    type="button"
                    onClick={() => {
                      onSelect(project);
                      setOpen(false);
                    }}
                  >
                    <span className="session-status">{active ? <Check size={14} /> : null}</span>
                    <span>
                      <strong>{title}</strong>
                      <small>{stepLabel(sessionStep)} · {formatSessionDate(sessionState.updatedAt ?? project.updated_at)}</small>
                    </span>
                    {active && <em>{stepLabel(activeStep)}</em>}
                  </button>
                  <button
                    className="session-delete"
                    type="button"
                    aria-label={`Delete session ${title}`}
                    title={`Delete session ${title}`}
                    disabled={deletingProjectId === project.id}
                    onClick={() => onDelete(project)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StepContent({
  step,
  project,
  projectId,
  files,
  analysis,
  table,
  refresh,
}: {
  step: StepKey;
  project: Project;
  projectId: string;
  files: Awaited<ReturnType<typeof api.listFiles>>;
  analysis?: Awaited<ReturnType<typeof api.getAnalysis>>;
  table?: Awaited<ReturnType<typeof api.getSdrfTable>>;
  refresh: () => void;
}) {
  if (step === "import") return <ImportStep projectId={projectId} files={files} refresh={refresh} />;
  if (step === "ai-analysis") return <AnalysisStep project={project} projectId={projectId} files={files} analysis={analysis} table={table} refresh={refresh} />;
  if (step === "blueprint") return <BlueprintStep projectId={projectId} analysis={analysis} table={table} refresh={refresh} />;
  if (step === "samples") return <SamplesStep projectId={projectId} analysis={analysis} table={table} refresh={refresh} />;
  if (step === "files") return <FilesStep projectId={projectId} table={table} files={files} refresh={refresh} />;
  if (step === "ai-review") return <AiReviewStep projectId={projectId} analysis={analysis} table={table} files={files} />;
  if (step === "validation") return <ValidationStep projectId={projectId} table={table} refresh={refresh} />;
  if (step === "export") return <ExportStep projectId={projectId} table={table} />;
  return <WorkspaceStep step={step} analysis={analysis} table={table} files={files} />;
}

export function ImportStep({
  projectId,
  files,
  refresh,
}: {
  projectId: string;
  files: Awaited<ReturnType<typeof api.listFiles>>;
  refresh: () => void;
}) {
  const setStep = useStudioStore((state) => state.setStep);
  const savedImportState = readSessionUiState(projectId).import ?? {};
  const latestDesignFile = getLatestDesignFile(files);
  const designHeaders = getDesignHeaders(latestDesignFile);
  const initialDesignState = resolveSessionDesignState(savedImportState, latestDesignFile, designHeaders);
  const [accession, setAccession] = useState(savedImportState.accession ?? savedImportState.prideAccession ?? "");
  const [activeImportAccession, setActiveImportAccession] = useState(savedImportState.activeImportAccession ?? savedImportState.prideAccession ?? "");
  const [startMode, setStartMode] = useState<"pride" | "local" | "scratch">(savedImportState.startMode ?? "pride");
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [designCsvChoice, setDesignCsvChoice] = useState<"unknown" | "yes" | "no">(savedImportState.designCsvChoice ?? "unknown");
  const [designStateFileId, setDesignStateFileId] = useState(initialDesignState.designFileId);
  const [designMapping, setDesignMapping] = useState<ColumnMapping>(initialDesignState.designMapping);
  const [designMappingReasons, setDesignMappingReasons] = useState<ColumnMappingReasons>(initialDesignState.designMappingReasons);
  const [designMappingFileReason, setDesignMappingFileReason] = useState(initialDesignState.designMappingFileReason);
  const [designMappingConfirmed, setDesignMappingConfirmed] = useState(initialDesignState.designMappingConfirmed);
  const [designMappingStatus, setDesignMappingStatus] = useState(initialDesignState.designMappingStatus);
  const [rawDesignTable, setRawDesignTable] = useState<MappedDesignTable | null>(initialDesignState.rawDesignTable);
  const [mappedDesignTable, setMappedDesignTable] = useState<MappedDesignTable | null>(initialDesignState.mappedDesignTable);
  const [aiMappingPending, setAiMappingPending] = useState(false);
  const [normalizationStatus, setNormalizationStatus] = useState(initialDesignState.normalizationStatus);
  const [normalizationIssues, setNormalizationIssues] = useState<SdrfNormalizationIssue[]>(initialDesignState.normalizationIssues);
  const [normalizationPending, setNormalizationPending] = useState(false);
  const [prideElapsedSeconds, setPrideElapsedSeconds] = useState(0);
  const designCsvInputRef = useRef<HTMLInputElement>(null);
  const uploadAccession = (activeImportAccession || accession).toUpperCase();
  const fileSnapshotKey = files.map((file) => `${file.id}:${file.filename}:${file.file_type}:${file.parse_status}:${file.created_at}`).join("|");
  const restoredPrideImportResults = refreshStoredImportResultUploads(
    restoreStoredImportResults(savedImportState.prideImportResults),
    savedImportState,
    files,
  );
  const sessionPrideImportResults = restoredPrideImportResults.length
    ? restoredPrideImportResults
    : buildSessionPrideImportResults(savedImportState, files);
  const hasStoredPrideImport = Boolean(
    savedImportState.prideAccession ||
    savedImportState.importedAt ||
    savedImportState.prideTitle ||
    sessionPrideImportResults.length,
  );
  useEffect(() => {
    updateSessionUiState(projectId, (current) => ({
      ...current,
      import: { ...current.import, accession, activeImportAccession, startMode, designCsvChoice },
      pages: {
        ...current.pages,
        import: {
          ...(current.pages?.import ?? {}),
          accession,
          activeImportAccession,
          startMode,
          designCsvChoice,
          updatedAt: new Date().toISOString(),
        },
      },
    }));
  }, [projectId, accession, activeImportAccession, startMode, designCsvChoice]);
  useEffect(() => {
    const uploadedFiles = nonSdrfUploadedFiles(files).map(summarizeSessionUploadedFile);
    updateSessionUiState(projectId, (current) => ({
      ...current,
      import: { ...current.import, uploadedFiles },
      pages: {
        ...current.pages,
        import: {
          ...(current.pages?.import ?? {}),
          uploadedFiles,
          fileCount: uploadedFiles.length,
          updatedAt: new Date().toISOString(),
        },
      },
    }));
  }, [projectId, fileSnapshotKey]);
  const pride = useMutation({
    mutationFn: () => api.importPride(projectId, accession),
    onMutate: () => {
      setPrideElapsedSeconds(0);
      setExpandedResult(null);
      setDesignCsvChoice("unknown");
    },
    onSuccess: (payload) => {
      const nextImportSummary = buildPrideSessionImportState(payload, accession);
      const nextAccession = nextImportSummary.prideAccession ?? String(payload.accession ?? accession).toUpperCase();
      const nextImportResults = serializeImportResults(buildPrideImportResults(payload, false, files, nextAccession));
      const resultsUpdatedAt = new Date().toISOString();
      setActiveImportAccession(nextAccession);
      updateSessionUiState(projectId, (current) => {
        const nextImport = {
          ...current.import,
          ...nextImportSummary,
          prideImportResults: nextImportResults,
          prideImportResultsUpdatedAt: resultsUpdatedAt,
          accession: nextAccession,
          activeImportAccession: nextAccession,
          startMode: "pride" as const,
          designCsvChoice: "unknown" as const,
        };
        return {
          ...current,
          displayName: buildSessionDisplayName({ name: current.displayName ?? "", pride_accession: nextAccession }, nextImport),
          import: nextImport,
          pages: {
            ...current.pages,
            import: {
              ...(current.pages?.import ?? {}),
              ...nextImportSummary,
              prideImportResults: nextImportResults,
              prideImportResultsUpdatedAt: resultsUpdatedAt,
              accession: nextAccession,
              activeImportAccession: nextAccession,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      });
      refresh();
    },
  });
  const upload = useMutation({
    mutationFn: ({ file, fileType }: { file: File; fileType?: string }) => api.uploadFile(projectId, file, fileType),
    onSuccess: refresh,
  });
  const deleteFile = useMutation({
    mutationFn: (fileId: string) => api.deleteFile(projectId, fileId),
    onSuccess: refresh,
  });
  const handleDetailUpload = (mode: "pdf" | "design" | "supplementary", file: File) => {
    const prepared = mode === "pdf" ? renamePublicationPdf(file, uploadAccession) : file;
    upload.mutate({ file: prepared, fileType: mode === "design" ? "design-table" : undefined });
  };
  const runAnalysis = useMutation({ mutationFn: () => api.runAnalysis(projectId), onSuccess: refresh });
  const hasFiles = nonSdrfUploadedFiles(files).length > 0;
  const prideResult = pride.data;
  const designRows = rawDesignTable?.rows ?? getDesignRows(latestDesignFile);
  const hasDesignFile = Boolean(latestDesignFile);
  const livePrideImportResults = pride.isSuccess || pride.isError
    ? buildPrideImportResults(prideResult, pride.isError, files, activeImportAccession || accession)
    : [];
  const visiblePrideImportResults = pride.isPending
    ? []
    : livePrideImportResults.length
      ? livePrideImportResults
      : sessionPrideImportResults;
  const shouldAskForDesignCsv = pride.isSuccess || hasStoredPrideImport || hasDesignFile;
  const shouldShowDesignMapping = hasDesignFile && designCsvChoice !== "no";
  const handleDirectDesignUpload = (file: File | undefined) => {
    if (!file) return;
    setDesignCsvChoice("yes");
    upload.mutate({ file, fileType: "design-table" });
  };

  useEffect(() => {
    if (!pride.isPending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setPrideElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pride.isPending]);

  useEffect(() => {
    if (designHeaders.length) {
      const restored = resolveSessionDesignState(readSessionUiState(projectId).import ?? {}, latestDesignFile, designHeaders);
      setDesignStateFileId(restored.designFileId);
      setRawDesignTable(restored.rawDesignTable);
      setDesignMapping(restored.designMapping);
      setDesignMappingReasons(restored.designMappingReasons);
      setDesignMappingFileReason(restored.designMappingFileReason);
      setDesignMappingConfirmed(restored.designMappingConfirmed);
      setMappedDesignTable(restored.mappedDesignTable);
      setAiMappingPending(false);
      setNormalizationIssues(restored.normalizationIssues);
      setNormalizationStatus(restored.normalizationStatus);
      setDesignMappingStatus(restored.designMappingStatus);
    } else {
      setDesignStateFileId(undefined);
      setRawDesignTable(null);
      setDesignMapping({});
      setDesignMappingReasons({});
      setDesignMappingFileReason("");
      setDesignMappingConfirmed(false);
      setMappedDesignTable(null);
      setAiMappingPending(false);
      setNormalizationIssues([]);
      setNormalizationStatus("Map at least one column, then validate SDRF values.");
      setDesignMappingStatus("Upload a design file to review and map its columns.");
    }
  }, [projectId, latestDesignFile?.id, designHeaders.join("|")]);

  useEffect(() => {
    if (!latestDesignFile?.id || designStateFileId !== latestDesignFile.id) return;
    updateSessionUiState(projectId, (current) => ({
      ...current,
      import: {
        ...current.import,
        designFileId: latestDesignFile.id,
        designMapping,
        designMappingReasons,
        designMappingFileReason,
        designMappingStatus,
        designMappingConfirmed,
        rawDesignTable,
        mappedDesignTable,
        normalizationStatus,
        normalizationIssues,
      },
    }));
  }, [
    projectId,
    latestDesignFile?.id,
    designStateFileId,
    designMapping,
    designMappingReasons,
    designMappingFileReason,
    designMappingStatus,
    designMappingConfirmed,
    rawDesignTable,
    mappedDesignTable,
    normalizationStatus,
    normalizationIssues,
  ]);

  return (
    <div className="content-grid">
      <section className="wide-stack">
        <Panel title="1. How would you like to start?">
          <div className="choice-grid">
            <Choice
              icon={<Search />}
              title="I have submitted to PRIDE"
              text="Fetch project metadata and file lists from PRIDE Archive."
              active={startMode === "pride"}
              onClick={() => setStartMode("pride")}
            />
            <Choice
              icon={<UploadCloud />}
              title="I have local data files"
              text="Upload CSV, Excel, PDF or metadata files."
              active={startMode === "local"}
              onClick={() => setStartMode("local")}
            />
            <Choice
              icon={<Plus />}
              title="Start from scratch"
              text="Create a compliant SDRF table from an empty template."
              active={startMode === "scratch"}
              onClick={() => setStartMode("scratch")}
            />
          </div>
        </Panel>
        {startMode === "pride" && (
          <>
          <Panel title="2. Import from PRIDE Archive">
            <div className="pride-section">
              <h3>Enter PRIDE Project ID</h3>
              <form
                className="input-row pride-input-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (/^PXD\d{6,}$/i.test(accession) && !pride.isPending) pride.mutate();
                }}
              >
                <input value={accession} onChange={(event) => setAccession(event.target.value.toUpperCase())} placeholder="PXD012345" />
                {accession && <button className="icon-btn" type="button" onClick={() => setAccession("")}>x</button>}
                <button className="btn primary" type="submit" disabled={!/^PXD\d{6,}$/i.test(accession) || pride.isPending}>
                  {pride.isPending ? "Fetching..." : "Fetch"}
                </button>
              </form>
              <p className="input-description">Enter a PRIDE Project accession (PXD) to automatically retrieve metadata and files.</p>
            </div>
            <div className="pride-section">
              <h3>Data sources we will import</h3>
              <div className="source-select-grid">
                <SourceInfo icon={<MiniIcon label="▣" />} title="Project metadata" text="Title, organism, instruments, submitter" />
                <SourceInfo icon={<FileText size={22} />} title="File list" text="Raw, mzML, results files" />
                <SourceInfo icon={<MiniIcon label="▤" />} title="Publication" text="DOI, title, authors, PMID" />
                <SourceInfo icon={<FolderOpen size={22} />} title="Supplementary" text="Tables, spreadsheets" />
                <SourceInfo icon={<MiniIcon label="⌘" />} title="Ontology" text="Term suggestions" />
              </div>
              {pride.isPending && <PrideImportProgress accession={accession} elapsedSeconds={prideElapsedSeconds} />}
            </div>
            {visiblePrideImportResults.length > 0 && (
              <div className="pride-section">
                <h3>Import results</h3>
                <div className="import-result-list">
                  {visiblePrideImportResults.map((item) => (
                    <article key={item.title} className={`import-result ${item.status}`}>
                      <span className="result-icon">
                        {item.icon || (item.status === "ok" ? "✓" : item.status === "missing" ? "!" : "?")}
                      </span>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.message}</p>
                      </div>
                      <div className="result-actions">
                        <button className="btn ghost" type="button" onClick={() => setExpandedResult(expandedResult === item.title ? null : item.title)}>
                          {expandedResult === item.title ? "Hide details" : "View details"}
                        </button>
                      </div>
                      {expandedResult === item.title && (
                        <div className="import-result-details">
                          <DetailSections sections={item.details} uploadPending={upload.isPending} onUpload={handleDetailUpload} />
                        </div>
                      )}
                    </article>
                  ))}
                </div>
                <div className="missing-help-box">
                  <HelpCircle size={18} />
                  <div>
                    <strong>Upload missing files</strong>
                    <p>Add PDFs, design files or supplementary tables to improve annotation.</p>
                  </div>
                </div>
              </div>
            )}
            {pride.error && <p className="form-error">{String(pride.error.message)}</p>}
          </Panel>
          {shouldAskForDesignCsv && (
            <Panel title="3. Experimental design CSV">
              <div className="design-decision-card">
                <div className="design-decision-copy">
                  <strong>Do you have an experimental design CSV?</strong>
                  <p>Use it when sample groups, replicates, fractions, raw files, or factor values are already organized in a table.</p>
                </div>
                <div className="design-decision-actions">
                  <input
                    ref={designCsvInputRef}
                    className="visually-hidden-file"
                    type="file"
                    accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.xlx"
                    onChange={(event) => {
                      handleDirectDesignUpload(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                  <button
                    className={`btn ${shouldShowDesignMapping || upload.isPending ? "primary" : "ghost"}`}
                    type="button"
                    disabled={upload.isPending}
                    onClick={() => designCsvInputRef.current?.click()}
                  >
                    {upload.isPending ? "Uploading..." : "Yes, upload CSV"}
                  </button>
                  <button className={`btn ${designCsvChoice === "no" ? "primary" : "ghost"}`} type="button" onClick={() => setDesignCsvChoice("no")}>
                    No, continue to Templates
                  </button>
                </div>
              </div>
              {designCsvChoice === "no" && (
                <div className="next-step-callout">
                  <Layers size={20} />
                  <div>
                    <strong>No design CSV selected.</strong>
                    <p>No design CSV selected. Continue to Templates to choose the SDRF template stack from imported PRIDE evidence.</p>
                  </div>
                  <button className="btn primary" type="button" onClick={() => setStep("ai-analysis")}>
                    Continue to Templates
                  </button>
                </div>
              )}
              {shouldShowDesignMapping && (
                <DesignMappingStep
                designFile={latestDesignFile}
                rawTable={rawDesignTable}
                headers={rawDesignTable?.headers ?? designHeaders}
                mapping={designMapping}
                mappingReasons={designMappingReasons}
                fileReason={designMappingFileReason}
                mappingStatus={designMappingStatus}
                confirmed={designMappingConfirmed}
                aiMappingPending={aiMappingPending}
                uploadPending={upload.isPending}
                removePending={deleteFile.isPending}
                onUpload={(file) => upload.mutate({ file, fileType: "design-table" })}
                onRemove={() => {
                  if (latestDesignFile) deleteFile.mutate(latestDesignFile.id);
                }}
                onMappingChange={(source, target) => {
                  setDesignMapping((current) => ({ ...current, [source]: target }));
                  setDesignMappingReasons((current) => ({
                    ...current,
                    [source]: target ? "Manually selected by the user." : "Manually marked as not mapped.",
                  }));
                  setDesignMappingConfirmed(false);
                  setMappedDesignTable(null);
                  setNormalizationIssues([]);
                  setNormalizationStatus("Mapping changed. Validate SDRF values again when ready.");
                }}
                onRawCellChange={(rowIndex, header, value) => {
                  setRawDesignTable((current) => {
                    if (!current) return current;
                    return {
                      ...current,
                      rows: current.rows.map((row, index) => index === rowIndex ? { ...row, [header]: value } : row),
                    };
                  });
                  setDesignMappingConfirmed(false);
                  setMappedDesignTable(null);
                  setNormalizationIssues([]);
                  setNormalizationStatus("Design values changed. Validate SDRF values after mapping.");
                }}
                onAiMap={async () => {
                  const tableForMapping = rawDesignTable ?? buildParsedDesignTable(latestDesignFile);
                  if (!tableForMapping.headers.length) return;
                  const aiConfig = readClientAiConfig();
                  setAiMappingPending(true);
                  setDesignMappingStatus("Requesting AI mapping suggestions...");
                  setDesignMappingFileReason("");
                  setDesignMappingConfirmed(false);
                  setMappedDesignTable(null);
                  setNormalizationIssues([]);
                  try {
                    const result = await requestDesignMapping(tableForMapping.headers, tableForMapping.rows, aiConfig);
                    const aiCount = Object.values(result.mapping).filter(Boolean).length;
                    setDesignMapping(result.mapping);
                    setDesignMappingReasons(result.reasons);
                    setDesignMappingFileReason(result.fileReason);
                    setDesignMappingStatus(
                      aiCount > 0
                        ? `AI mapping suggestions loaded. ${aiCount} uploaded column(s) mapped.`
                        : "AI did not find usable column mappings. You can map columns manually.",
                    );
                    setNormalizationStatus(aiCount > 0 ? "AI mapping loaded. Validate SDRF values when ready." : "No mapped columns yet.");
                  } catch {
                    setDesignMapping(emptyColumnMapping(tableForMapping.headers));
                    setDesignMappingReasons({});
                    setDesignMappingFileReason("The AI request failed, so no column mappings were applied. Check Settings and try again.");
                    setDesignMappingStatus("AI mapping failed. You can still map columns manually.");
                  } finally {
                    setAiMappingPending(false);
                  }
                }}
                mappedTable={mappedDesignTable}
                normalizationStatus={normalizationStatus}
                normalizationIssues={normalizationIssues}
                normalizationPending={normalizationPending}
                onValidate={async () => {
                  const mapped = buildMappedDesignTable(rawDesignTable, designMapping);
                  setMappedDesignTable(mapped);
                  setDesignMappingConfirmed(true);
                  setNormalizationIssues([]);
                  if (mapped.headers.length === 0) {
                    setDesignMappingConfirmed(false);
                    setNormalizationStatus("No uploaded columns are mapped yet. Select at least one SDRF field or use AI mapping first.");
                    return;
                  }
                  if (mapped.rows.length === 0) {
                    setNormalizationStatus("The mapped table has no data rows to validate.");
                    return;
                  }
                  const aiConfig = readClientAiConfig();
                  setNormalizationPending(true);
                  setNormalizationStatus("AI is validating and normalizing mapped SDRF values...");
                  try {
                    const normalized = await requestSdrfValueNormalization(mapped, aiConfig);
                    setMappedDesignTable(normalized.table);
                    setNormalizationIssues(normalized.issues);
                    setNormalizationStatus(normalized.summary || `AI normalized ${normalized.issues.length} SDRF value(s).`);
                  } catch {
                    setNormalizationStatus("AI value validation failed. The preview is shown without SDRF value normalization.");
                    setNormalizationIssues([]);
                  } finally {
                    setNormalizationPending(false);
                  }
                }}
                onCellChange={(rowIndex, header, value) => {
                  setMappedDesignTable((current) => {
                    if (!current) return current;
                    return {
                      ...current,
                      rows: current.rows.map((row, index) => index === rowIndex ? { ...row, [header]: value } : row),
                    };
                  });
                  setNormalizationStatus("The normalized preview was edited. Run validation again if you need AI to re-check the values.");
                }}
                />
              )}
            </Panel>
          )}
          </>
        )}
        {startMode === "local" && (
          <Panel title="2B. Import local experimental design files">
            <div className="module-intro">
              <strong>Upload files from your study</strong>
              <p>Use design sheets, publication PDFs, metadata files and supplementary tables to seed the SDRF draft.</p>
            </div>
            <FileUpload projectId={projectId} onUploaded={refresh} />
            <FileList files={files} />
            <div className="module-footer">
              <button className="btn primary" disabled={!hasFiles || runAnalysis.isPending} onClick={() => runAnalysis.mutate()}>
                Analyze uploaded files
              </button>
              {!hasFiles && <span>Upload at least one file to start analysis.</span>}
              {runAnalysis.isSuccess && <span className="success-text">Analysis complete. Continue to Samples, then Blueprint, Files and Assays.</span>}
            </div>
          </Panel>
        )}
        {startMode === "scratch" && (
          <Panel title="2C. Start from scratch">
            <div className="scratch-module">
              <div>
                <strong>Create an empty SDRF project</strong>
                <p>Start with the built-in SDRF-Proteomics columns, then add samples, blueprint mappings, files, assays and ontology terms step by step.</p>
              </div>
              <div className="scratch-actions">
                <button className="btn primary" onClick={() => runAnalysis.mutate()} disabled={runAnalysis.isPending}>
                  Create empty SDRF draft
                </button>
                <button className="btn ghost" type="button">
                  Download blank template
                </button>
              </div>
            </div>
            <div className="template-grid">
              <TemplateOption title="Human proteomics" text="Organism, tissue, disease, replicate, assay and data file columns." />
              <TemplateOption title="DIA experiment" text="Adds acquisition method and DIA-focused technical metadata." />
              <TemplateOption title="Labeling study" text="Prepares label and modification parameter columns for multiplexed designs." />
            </div>
            {runAnalysis.isSuccess && <p className="success-note">Empty draft initialized. Continue to Samples to start filling metadata.</p>}
          </Panel>
        )}
      </section>
      <aside className="right-rail">
        <ImportRightRail />
      </aside>
    </div>
  );
}

export function AnalysisStep({
  project,
  projectId,
  files,
  analysis,
  table,
  refresh,
}: {
  project: Project;
  projectId: string;
  files: Awaited<ReturnType<typeof api.listFiles>>;
  analysis?: Awaited<ReturnType<typeof api.getAnalysis>>;
  table?: Awaited<ReturnType<typeof api.getSdrfTable>>;
  refresh: () => void;
}) {
  const savedSessionState = useMemo(() => readSessionUiState(projectId), [projectId]);
  const savedTemplateState = savedSessionState.templates ?? {};
  const evidence = analysis?.evidences ?? [];
  const evidenceFingerprint = evidence
    .map((item) => `${item.source_type}:${item.source_ref}:${item.field}:${item.value}:${item.confidence}:${item.status}`)
    .join("|");
  const fileFingerprint = files
    .map((file) => `${file.id}:${file.filename}:${file.file_type}:${file.parse_status}:${file.created_at}`)
    .join("|");
  const importFingerprint = JSON.stringify({
    accession: savedSessionState.import?.prideAccession ?? savedSessionState.import?.accession ?? "",
    activeImportAccession: savedSessionState.import?.activeImportAccession ?? "",
    prideTitle: savedSessionState.import?.prideTitle ?? "",
    startMode: savedSessionState.import?.startMode ?? "",
    designCsvChoice: savedSessionState.import?.designCsvChoice ?? "unknown",
    uploadedFiles: savedSessionState.import?.uploadedFiles?.map((item) => `${item.id}:${item.filename}:${item.fileType}:${item.parseStatus}`).join("|") ?? "",
  });
  const fallbackRecommendation = useMemo(
    () => inferTemplateRecommendation(evidence, files, project, savedSessionState),
    [project.id, evidenceFingerprint, fileFingerprint, importFingerprint],
  );
  const storedTemplateRecommendation = useMemo(
    () => sanitizeTemplateRecommendation(savedTemplateState.aiRecommendation),
    [projectId, savedTemplateState.aiRecommendationUpdatedAt, JSON.stringify(savedTemplateState.aiRecommendation ?? {})],
  );
  const savedAiRecommendation = storedTemplateRecommendation?.source === "ai"
    && storedTemplateRecommendation.promptVersion === TEMPLATE_AI_PROMPT_VERSION
    && storedTemplateRecommendation.templateReasons?.length === storedTemplateRecommendation.selectedIds.length
    ? storedTemplateRecommendation
    : undefined;
  const [recommendation, setRecommendation] = useState<TemplateRecommendation>(() => savedAiRecommendation ?? createPendingTemplateRecommendation(project, savedSessionState));
  const [templateSearch, setTemplateSearch] = useState("");
  const [layerFilter, setLayerFilter] = useState<"all" | SdrfTemplateLayer>("all");
  const [selectedTemplates, setSelectedTemplates] = useState<SdrfTemplateId[]>(
    () => {
      const persisted = sanitizeTemplateIds(savedTemplateState.selectedTemplates);
      if (persisted.length) return persisted;
      return savedAiRecommendation?.selectedIds ?? [];
    },
  );
  const [reviewOpen, setReviewOpen] = useState(true);
  const [assistantStatus, setAssistantStatus] = useState<"idle" | "running" | "success" | "error">(
    savedAiRecommendation ? "success" : "running",
  );
  const autoAiRunKeyRef = useRef("");
  const [assistantError, setAssistantError] = useState(savedTemplateState.aiRecommendationError ?? "");
  const [expandedImpact, setExpandedImpact] = useState<ColumnImpactGroupKey>("required");
  const [detailTemplateId, setDetailTemplateId] = useState<SdrfTemplateId>("ms-proteomics");
  const selectedTemplateSet = useMemo(() => new Set(selectedTemplates), [selectedTemplates]);
  const selectedTemplateDefinitions = selectedTemplates.map((id) => getTemplateById(id)).filter((template): template is SdrfTemplate => Boolean(template));
  const selectedColumns = getTemplateColumns(selectedTemplates);
  const selectedRequiredColumns = getRequiredTemplateColumns(selectedTemplates);
  const existingHeaders = table?.headers ?? [];
  const missingColumns = selectedColumns.filter((column) => !existingHeaders.includes(column));
  const recommendedTemplateColumns = selectedColumns.filter((column) => !selectedRequiredColumns.includes(column));
  const compatibilityIssues = getTemplateCompatibilityIssues(selectedTemplates);
  const recommendedTemplateSet = useMemo(() => new Set(recommendation.selectedIds), [recommendation.selectedIds.join("|")]);
  const visibleTemplateGroups = useMemo(
    () => filterTemplateGroups(templateSearch, layerFilter),
    [templateSearch, layerFilter],
  );
  const hasAiRecommendation = recommendation.source === "ai" && recommendation.selectedIds.length > 0;
  const selectionMatchesRecommendation = hasAiRecommendation && sameTemplateSet(selectedTemplates, recommendation.selectedIds);
  const selectedTechnology = selectedTemplateDefinitions.find((template) => template.layer === "technology");
  const detailTemplate = getTemplateById(detailTemplateId) ?? getTemplateById("ms-proteomics");
  const evidenceReviewItems = useMemo(() => buildRecommendationEvidenceItems(evidence), [evidenceFingerprint]);
  const impactGroups: Array<{
    key: ColumnImpactGroupKey;
    label: string;
    count: number;
    columns: string[];
    empty: string;
  }> = [
    {
      key: "required",
      label: "Required columns",
      count: selectedRequiredColumns.length,
      columns: selectedRequiredColumns,
      empty: "No required columns are selected yet.",
    },
    {
      key: "recommended",
      label: "Recommended columns",
      count: recommendedTemplateColumns.length,
      columns: recommendedTemplateColumns,
      empty: "No recommended optional columns are selected yet.",
    },
    {
      key: "new",
      label: "New columns to add",
      count: missingColumns.length,
      columns: missingColumns,
      empty: "The current SDRF table already contains all selected template columns.",
    },
  ];
  const activeImpactGroup = impactGroups.find((group) => group.key === expandedImpact) ?? impactGroups[0];
  const detailCarouselTemplates = selectedTemplateDefinitions.length
    ? selectedTemplateDefinitions
    : [getTemplateById("ms-proteomics")].filter((template): template is SdrfTemplate => Boolean(template));
  const importedAccession = (
    savedSessionState.import?.prideAccession ||
    savedSessionState.import?.activeImportAccession ||
    getImportedAccession(evidence) ||
    project.pride_accession ||
    ""
  ).toUpperCase();
  const applyTemplates = useMutation({
    mutationFn: () => {
      if (!table) throw new Error("SDRF table is not loaded yet.");
      return api.putSdrfTable(projectId, mergeTemplatesIntoTable(table, selectedTemplates));
    },
    onSuccess: refresh,
  });
  const runAiRecommendation = useMutation({
    mutationFn: async () => {
      const config = readClientAiConfig();
      const fallback = inferTemplateRecommendation(evidence, files, project, savedSessionState);
      const input = buildTemplateAiRecommendationInput({
        project,
        sessionState: savedSessionState,
        evidence,
        files,
        table,
        fallback,
      });
      return requestTemplateAiRecommendation(input, fallback, config);
    },
    onMutate: () => {
      setAssistantStatus("running");
      setAssistantError("");
      updateSessionUiState(projectId, (current) => ({
        ...current,
        templates: {
          ...current.templates,
          aiRecommendationStatus: "running",
          aiRecommendationError: "",
        },
        pages: {
          ...current.pages,
          "ai-analysis": {
            ...(current.pages?.["ai-analysis"] ?? {}),
            aiRecommendationStatus: "running",
            aiRecommendationError: "",
            updatedAt: new Date().toISOString(),
          },
        },
      }));
    },
    onSuccess: (nextRecommendation) => {
      setRecommendation(nextRecommendation);
      setAssistantStatus("success");
      setAssistantError("");
      updateSessionUiState(projectId, (current) => ({
        ...current,
        templates: {
          ...current.templates,
          aiRecommendation: nextRecommendation,
          aiRecommendationStatus: "success",
          aiRecommendationError: "",
          aiRecommendationUpdatedAt: nextRecommendation.generatedAt ?? new Date().toISOString(),
        },
        pages: {
          ...current.pages,
          "ai-analysis": {
            ...(current.pages?.["ai-analysis"] ?? {}),
            aiRecommendation: nextRecommendation,
            updatedAt: new Date().toISOString(),
          },
        },
      }));
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "AI template recommendation failed.";
      setAssistantStatus("error");
      setAssistantError(message);
      updateSessionUiState(projectId, (current) => ({
        ...current,
        templates: {
          ...current.templates,
          aiRecommendationStatus: "error",
          aiRecommendationError: message,
        },
        pages: {
          ...current.pages,
          "ai-analysis": {
            ...(current.pages?.["ai-analysis"] ?? {}),
            aiRecommendationStatus: "error",
            aiRecommendationError: message,
            updatedAt: new Date().toISOString(),
          },
        },
      }));
    },
  });

  useEffect(() => {
    const persisted = sanitizeTemplateIds(readSessionUiState(projectId).templates?.selectedTemplates);
    if (persisted.length) {
      setSelectedTemplates(persisted);
      return;
    }
    if (savedAiRecommendation?.selectedIds.length) {
      setSelectedTemplates(savedAiRecommendation.selectedIds);
      return;
    }
    setSelectedTemplates([]);
  }, [projectId, savedTemplateState.aiRecommendationUpdatedAt ?? ""]);

  useEffect(() => {
    if (savedAiRecommendation) {
      setRecommendation(savedAiRecommendation);
      setAssistantStatus(savedTemplateState.aiRecommendationStatus ?? "success");
      setAssistantError(savedTemplateState.aiRecommendationError ?? "");
      return;
    }
    setRecommendation(createPendingTemplateRecommendation(project, savedSessionState));
    setAssistantStatus("running");
    setAssistantError(savedTemplateState.aiRecommendationError ?? "");
  }, [
    projectId,
    savedTemplateState.aiRecommendationUpdatedAt ?? "",
  ]);

  useEffect(() => {
    if (savedAiRecommendation || runAiRecommendation.isPending) return;
    const autoRunKey = `${projectId}|${evidenceFingerprint}|${fileFingerprint}|${importFingerprint}`;
    if (autoAiRunKeyRef.current === autoRunKey) return;
    autoAiRunKeyRef.current = autoRunKey;
    runAiRecommendation.mutate();
  }, [
    projectId,
    evidenceFingerprint,
    fileFingerprint,
    importFingerprint,
    Boolean(savedAiRecommendation),
    runAiRecommendation.isPending,
  ]);

  useEffect(() => {
    updateSessionUiState(projectId, (current) => ({
      ...current,
      templates: {
        ...current.templates,
        selectedTemplates,
        reviewOpen,
        aiRecommendation: current.templates?.aiRecommendation ?? savedAiRecommendation,
      },
      pages: {
        ...current.pages,
        "ai-analysis": {
          ...(current.pages?.["ai-analysis"] ?? {}),
          selectedTemplates,
          reviewOpen,
          recommendationSource: recommendation.source ?? "ai-pending",
          updatedAt: new Date().toISOString(),
        },
      },
    }));
  }, [projectId, selectedTemplates, reviewOpen, recommendation.selectedIds.join("|")]);

  const chooseTemplate = (id: SdrfTemplateId) => {
    const template = getTemplateById(id);
    if (!template) return;
    setDetailTemplateId(id);
    setSelectedTemplates((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      const group = template.exclusiveGroup;
      const withoutConflicts = group
        ? current.filter((item) => getTemplateById(item)?.exclusiveGroup !== group)
        : current;
      return [...withoutConflicts, id];
    });
  };
  const removeTemplate = (id: SdrfTemplateId) => {
    setSelectedTemplates((current) => current.filter((item) => item !== id));
  };

  return (
    <div className="content-grid templates-content-grid">
      <section className="wide-stack">
        <Panel title="Templates">
          <div className="template-builder">
            <div className="template-study-header">
              <div>
                <strong>{selectedTechnology?.title ?? (assistantStatus === "running" ? "AI is analyzing templates" : "Choose a technology template")}</strong>
                <p>{selectedTemplates.length} templates selected · {selectedColumns.length} total columns · {missingColumns.length} new columns</p>
              </div>
              <div className="template-head-actions">
                <span className={selectionMatchesRecommendation ? "ok" : "neutral"}>{selectionMatchesRecommendation ? "AI stack selected" : hasAiRecommendation ? "Custom stack" : "Waiting for AI"}</span>
                <span>SDRF v1.1.0</span>
              </div>
            </div>
            <div className="template-toolbar">
              <label className="template-search">
                <Search size={16} />
                <input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} placeholder="Search templates" />
              </label>
              <div className="segmented-control">
                {(["all", "technology", "sample", "experiment"] as const).map((value) => (
                  <button
                    key={value}
                    className={layerFilter === value ? "active" : ""}
                    type="button"
                    onClick={() => setLayerFilter(value)}
                  >
                    {value === "all" ? "All" : value[0].toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {detailTemplate && (
              <div className="template-detail-carousel">
                <TemplateDetailPanel template={detailTemplate} />
                {detailCarouselTemplates.length > 1 && (
                  <div className="template-detail-dots" aria-label="Selected template details">
                    {detailCarouselTemplates.map((template) => (
                      <button
                        key={template.id}
                        className={template.id === detailTemplate.id ? "active" : ""}
                        type="button"
                        aria-label={`Show ${template.title} details`}
                        onClick={() => setDetailTemplateId(template.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="template-layer-list">
              {visibleTemplateGroups.map((group) => (
                <TemplateLayerPicker
                  key={group.title}
                  title={group.title}
                  hint={group.hint}
                  templateIds={group.templateIds}
                  selectedTemplateSet={selectedTemplateSet}
                  recommendedTemplateSet={recommendedTemplateSet}
                  onChoose={chooseTemplate}
                />
              ))}
              {!visibleTemplateGroups.length && (
                <div className="template-empty-filter">No templates match the current filter.</div>
              )}
            </div>
            <div className="template-workspace">
              <div className="template-stack">
                <div className="template-section-head">
                  <strong>Template stack</strong>
                  <span>Spec v1.1.0 column set</span>
                </div>
                <div className="stack-list">
                  {selectedTemplateDefinitions.map((template) => (
                    <div key={template.id} className="stack-item">
                      <TemplateIcon template={template} size={17} />
                      <div>
                        <strong>{template.title}</strong>
                        <small>{template.category} · {template.version}</small>
                      </div>
                      <button className="icon-btn" type="button" aria-label={`Remove ${template.title}`} onClick={() => removeTemplate(template.id)}>
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                  {!selectedTemplateDefinitions.length && <div className="empty-stack">No templates selected.</div>}
                </div>
                <div className={`compatibility-box ${compatibilityIssues.length ? "warning" : "ok"}`}>
                  {compatibilityIssues.length ? <AlertTriangle size={17} /> : <Check size={17} />}
                  <div>
                    <strong>{compatibilityIssues.length ? "Review compatibility" : "Templates compatible"}</strong>
                    <p>{compatibilityIssues.length ? compatibilityIssues.join(" ") : "All selected templates can be combined into one SDRF table."}</p>
                  </div>
                </div>
              </div>
              <aside className="template-impact">
                <div className="template-impact-head">
                  <strong>Column impact</strong>
                  <span>Click a group to inspect the exact columns.</span>
                </div>
                <div className="template-metrics">
                  {impactGroups.map((group) => (
                    <button
                      key={group.key}
                      className={`template-metric ${expandedImpact === group.key ? "active" : ""}`}
                      type="button"
                      aria-expanded={expandedImpact === group.key}
                      onClick={() => setExpandedImpact(group.key)}
                    >
                      <strong>{group.count}</strong>
                      <span>{group.label}</span>
                    </button>
                  ))}
                </div>
                <div className="column-preview">
                  <span>{activeImpactGroup.label}</span>
                  <div className="column-chip-list">
                    {activeImpactGroup.columns.map((column) => <em key={column}>{column}</em>)}
                    {!activeImpactGroup.columns.length && <small>{activeImpactGroup.empty}</small>}
                  </div>
                </div>
              </aside>
            </div>
          </div>
          <div className="template-footer">
            <span>Project: {sessionTitle(project)}</span>
            <span>Accession: {importedAccession || "draft"}</span>
            <button className="btn primary" type="button" disabled={!table || !selectedTemplates.length || applyTemplates.isPending} onClick={() => applyTemplates.mutate()}>
              <Layers size={16} /> {applyTemplates.isPending ? "Applying..." : "Apply template stack"}
            </button>
          </div>
          {applyTemplates.isSuccess && <p className="success-note">Template columns applied to the SDRF table.</p>}
          {applyTemplates.isError && <p className="form-error">{String(applyTemplates.error.message)}</p>}
        </Panel>
      </section>
      <AssistantPanel questions={analysis?.questions} evidences={analysis?.evidences} showQuestions={false} showEvidence={false}>
        <TemplateAssistantRecommendation
          recommendation={recommendation}
          selectedTemplates={selectedTemplates}
          detectionPending={runAiRecommendation.isPending}
          evidenceCount={evidence.length}
          fileCount={files.length}
          evidenceItems={evidenceReviewItems}
          reviewOpen={reviewOpen}
          onAccept={() => setSelectedTemplates(recommendation.selectedIds)}
          onReview={() => setReviewOpen((current) => !current)}
          onRunDetection={() => runAiRecommendation.mutate()}
          assistantStatus={assistantStatus}
          assistantError={assistantError}
        />
      </AssistantPanel>
    </div>
  );
}

function TemplateLayerPicker({
  title,
  hint,
  templateIds,
  selectedTemplateSet,
  recommendedTemplateSet,
  onChoose,
}: {
  title: string;
  hint: string;
  templateIds: SdrfTemplateId[];
  selectedTemplateSet: Set<SdrfTemplateId>;
  recommendedTemplateSet: Set<SdrfTemplateId>;
  onChoose: (id: SdrfTemplateId) => void;
}) {
  return (
    <div className="template-layer">
      <div className="template-section-head">
        <strong>{title}</strong>
        <span>{hint}</span>
      </div>
      <div className="experiment-choice-list">
        {templateIds.map((id) => {
          const template = getTemplateById(id);
          if (!template) return null;
          const selected = selectedTemplateSet.has(template.id);
          const recommended = recommendedTemplateSet.has(template.id);
          return (
            <button
              key={template.id}
              type="button"
              className={`experiment-choice ${selected ? "active" : ""} ${recommended ? "recommended" : ""}`}
              title={template.description}
              onClick={() => onChoose(template.id)}
            >
              <TemplateIcon template={template} />
              <span className="template-choice-copy">
                <span className="template-choice-title">{template.title}</span>
                <small>{template.examples.slice(0, 2).join(" / ")}</small>
              </span>
              <span className="template-choice-meta">
                {selected ? <Check size={15} /> : recommended ? <CircleDot size={14} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TemplateIcon({ template, size = 18 }: { template: SdrfTemplate; size?: number }) {
  const Icon = template.icon;
  return (
    <span className="template-icon" aria-hidden="true">
      <Icon size={size} strokeWidth={2.1} />
    </span>
  );
}

function TemplateDetailPanel({ template, onClose }: { template: SdrfTemplate; onClose?: () => void }) {
  const requiredColumns = getRequiredTemplateColumns([template.id]);
  const visibleRequiredColumns = requiredColumns.slice(0, 6);
  const hiddenRequiredColumnCount = Math.max(0, requiredColumns.length - visibleRequiredColumns.length);
  return (
    <div className="template-detail-panel">
      <div className="template-detail-head">
        <TemplateIcon template={template} size={17} />
        <div>
          <strong>{template.title}</strong>
          <span>{template.version} · {template.category}</span>
        </div>
        {onClose && (
          <button className="icon-btn" type="button" aria-label={`Hide ${template.title} details`} onClick={onClose}>
            <X size={15} />
          </button>
        )}
      </div>
      <p>{template.description}</p>
      <div className="template-detail-grid">
        <div>
          <span>Typical examples</span>
          <div className="template-detail-chips">
            {template.examples.map((example) => <em key={example}>{example}</em>)}
          </div>
        </div>
        <div>
          <span>Required columns</span>
          <div className="template-detail-chips">
            {visibleRequiredColumns.map((column) => <em key={column}>{column}</em>)}
            {hiddenRequiredColumnCount > 0 && <small>+{hiddenRequiredColumnCount} more</small>}
            {!visibleRequiredColumns.length && <small>No required columns.</small>}
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateAssistantRecommendation({
  recommendation,
  selectedTemplates,
  detectionPending,
  evidenceCount,
  fileCount,
  evidenceItems,
  reviewOpen,
  onAccept,
  onReview,
  onRunDetection,
  assistantStatus,
  assistantError,
}: {
  recommendation: TemplateRecommendation;
  selectedTemplates: SdrfTemplateId[];
  detectionPending: boolean;
  evidenceCount: number;
  fileCount: number;
  evidenceItems: RecommendationEvidenceCard[];
  reviewOpen: boolean;
  onAccept: () => void;
  onReview: () => void;
  onRunDetection: () => void;
  assistantStatus: "idle" | "running" | "success" | "error";
  assistantError: string;
}) {
  const optionalOverlayTemplates = new Set<SdrfTemplateId>(["clinical-metadata", "oncology-metadata"]);
  const recommendedDefinitions = recommendation.selectedIds
    .map((id) => getTemplateById(id))
    .filter((template): template is SdrfTemplate => Boolean(template));
  const coreRecommendation = recommendation.selectedIds.filter((id) => !optionalOverlayTemplates.has(id));
  const coreSelection = selectedTemplates.filter((id) => !optionalOverlayTemplates.has(id));
  const missingRecommended = coreRecommendation.filter((id) => !coreSelection.includes(id));
  const manualCoreSelection = coreSelection.filter((id) => !coreRecommendation.includes(id));
  const overlaySelection = selectedTemplates.filter((id) => optionalOverlayTemplates.has(id));
  const hasRecommendation = recommendation.source === "ai" && recommendation.selectedIds.length > 0;
  const matchesRecommendation = hasRecommendation && missingRecommended.length === 0 && manualCoreSelection.length === 0;
  const isLoading = assistantStatus === "running" || detectionPending;
  const keyFacts = buildAssistantFacts(recommendation, evidenceCount, fileCount);
  const decisionItems = buildTemplateDecisionItems(recommendation, recommendedDefinitions, evidenceItems);
  return (
    <div className="assistant-recommendation">
      <div className="assistant-recommendation-scroll">
        <div className="assistant-recommendation-head">
          <strong>Template recommendation</strong>
          <span>{isLoading && !hasRecommendation ? "Analyzing" : hasRecommendation ? `${Math.round(recommendation.confidence * 100)}%` : "Pending"}</span>
        </div>
        {isLoading && !hasRecommendation ? (
          <div className="assistant-loading-card">
            <span className="assistant-spinner" />
            <div>
              <strong>AI is reading your import context</strong>
              <p>Checking PRIDE metadata, uploaded files and SDRF template rules.</p>
            </div>
          </div>
        ) : (
          <div className={`assistant-summary-card ${matchesRecommendation ? "ok" : "attention"}`}>
            {matchesRecommendation ? <Check size={16} /> : <AlertTriangle size={16} />}
            <div>
              <strong>{matchesRecommendation ? "Recommended stack is already selected" : hasRecommendation ? "Recommended stack differs from your current selection" : "No AI recommendation yet"}</strong>
              <p>{matchesRecommendation ? "You can continue with this stack or review the template-level reasons below." : hasRecommendation ? "Accept the recommendation if you want the stack inferred from the imported PRIDE and uploaded files." : "Refresh AI to generate a template recommendation from the import page data."}</p>
            </div>
          </div>
        )}
        <div className="assistant-compact-meta">
          {keyFacts.map((item) => (
            <span key={`${item.label}-${item.value}`}>{item.label}: {item.value}</span>
          ))}
        </div>
        <div className="recommendation-stack">
          <span>Recommended stack</span>
          {recommendedDefinitions.length ? (
            recommendedDefinitions.map((template) => (
              <em key={template.id}>
                <span className="recommendation-template-name">
                  <TemplateIcon template={template} size={14} />
                  <b>{template.title}</b>
                </span>
                <small>{template.version}</small>
              </em>
            ))
          ) : (
            <div className="assistant-stack-placeholder">
              {isLoading ? "Generating recommendation..." : "No AI stack generated yet."}
            </div>
          )}
        </div>
        {!matchesRecommendation && (
          <div className="assistant-diff-list">
            {missingRecommended.map((id) => {
              const template = getTemplateById(id);
              return template ? (
                <span key={`add-${id}`}>Add {template.title}</span>
              ) : null;
            })}
            {manualCoreSelection.map((id) => {
              const template = getTemplateById(id);
              return template ? (
                <span key={`keep-${id}`}>Manual: {template.title}</span>
              ) : null;
            })}
          </div>
        )}
        {overlaySelection.length > 0 && (
          <div className="assistant-signal-chips overlays">
            <span>Overlay: {overlaySelection.map((id) => getTemplateById(id)?.title ?? id).join(", ")}</span>
          </div>
        )}
        {hasRecommendation && (
          <>
            <div className="assistant-decision-section">
              <div className="assistant-section-head">
                <strong>Why these templates</strong>
              </div>
              <div className="assistant-decision-list">
                {decisionItems.map((item) => (
                  <article key={item.template.id} className="assistant-decision-item">
                    <div className="assistant-decision-template">
                      <span className="recommendation-template-name">
                        <TemplateIcon template={item.template} size={14} />
                        <b>{item.template.title}</b>
                      </span>
                      <small>{item.template.layer}</small>
                    </div>
                    <p>{item.reason}</p>
                  </article>
                ))}
                {!decisionItems.length && <div className="assistant-stack-placeholder">No template-level decision has been generated yet.</div>}
              </div>
            </div>
            <div className="assistant-source-section">
              <div className="assistant-section-head">
                <strong>Sources</strong>
                <button className="text-button" type="button" onClick={onReview}>
                  {reviewOpen ? "Hide" : "Show"}
                </button>
              </div>
              {reviewOpen && (
                <div className="assistant-source-groups">
                  {decisionItems.map((item) => (
                    <article key={`${item.template.id}-sources`} className="assistant-source-group">
                      <div className="assistant-decision-template">
                        <span className="recommendation-template-name">
                          <TemplateIcon template={item.template} size={14} />
                          <b>{item.template.title}</b>
                        </span>
                        <small>{item.sources.length} source{item.sources.length === 1 ? "" : "s"}</small>
                      </div>
                      <div className="assistant-source-list">
                        {item.sources.map((source, index) => (
                          <div key={`${item.template.id}-${source.label}-${index}`} className="assistant-source-card">
                            <span>{source.label}</span>
                            <strong>{source.value}</strong>
                            <small>{source.location || [source.source, source.field].filter(Boolean).join(" > ") || "Import context"}</small>
                          </div>
                        ))}
                        {!item.sources.length && <div className="assistant-stack-placeholder">No concrete source was returned for this template.</div>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        {assistantStatus === "error" && <span className="form-error compact-error">{assistantError}</span>}
      </div>
      <div className="recommendation-actions compact">
        <button className="btn primary" type="button" onClick={onAccept} disabled={!hasRecommendation}>
          Accept
        </button>
        <button className="btn ghost" type="button" onClick={onRunDetection} disabled={detectionPending}>
          <Play size={16} /> {detectionPending ? "Running" : "Rerun"}
        </button>
      </div>
    </div>
  );
}

export function BlueprintStep({
  projectId,
  analysis,
  table,
  refresh,
}: {
  projectId: string;
  analysis?: Awaited<ReturnType<typeof api.getAnalysis>>;
  table?: Awaited<ReturnType<typeof api.getSdrfTable>>;
  refresh: () => void;
}) {
  const sampleSessionState = useMemo(() => readSessionUiState(projectId).samples, [projectId]);
  const acceptedSampleDraft = useMemo(() => sanitizeStoredSampleDesignDraft(sampleSessionState?.acceptedDraft), [sampleSessionState]);
  const latestSampleAiDraft = useMemo(() => sanitizeStoredSampleDesignDraft(sampleSessionState?.aiDraft), [sampleSessionState]);
  const blueprintSampleDraft = acceptedSampleDraft ?? latestSampleAiDraft;
  const importedRawFileNames = useMemo(() => extractBlueprintRawFileNames(analysis), [analysis]);
  const sampleDraftRelationshipGroups = useMemo(
    () => buildBlueprintRelationshipGroupsFromSampleDraft(blueprintSampleDraft, importedRawFileNames),
    [blueprintSampleDraft, importedRawFileNames.join("|")],
  );
  const sampleRelationshipMap = useMemo(() => buildCoreExperimentMapFromSdrfTable(table), [table]);
  const tableSampleRelationshipGroups = useMemo(() => buildBlueprintRelationshipGroups(sampleRelationshipMap), [sampleRelationshipMap]);
  const sampleRelationshipGroups = sampleDraftRelationshipGroups.length ? sampleDraftRelationshipGroups : tableSampleRelationshipGroups;
  const sampleRelationshipFacets = useMemo(() => buildBlueprintRelationshipFacets(sampleRelationshipGroups), [sampleRelationshipGroups]);
  const [selectedRelationshipFacetId, setSelectedRelationshipFacetId] = useState("");
  const [selectedSampleGroupId, setSelectedSampleGroupId] = useState("");
  const selectedRelationshipFacet = sampleRelationshipFacets.find((facet) => facet.id === selectedRelationshipFacetId)
    ?? defaultBlueprintRelationshipFacet(sampleRelationshipFacets);
  const visibleSampleRelationshipGroups = useMemo(
    () => filterBlueprintRelationshipGroupsByFacet(sampleRelationshipGroups, selectedRelationshipFacet),
    [sampleRelationshipGroups, selectedRelationshipFacet?.id],
  );
  const sampleRelationshipGraph = useMemo(() => buildSampleRelationshipGraph(visibleSampleRelationshipGroups), [visibleSampleRelationshipGroups]);
  const aiBlueprintFingerprint = blueprintFingerprint(analysis?.blueprint);
  const aiBlueprint = useMemo(() => normalizeBlueprint(analysis?.blueprint), [aiBlueprintFingerprint]);
  const lastAiBlueprintFingerprintRef = useRef(aiBlueprintFingerprint);
  const [draftBlueprint, setDraftBlueprint] = useState<Blueprint>(() => aiBlueprint);
  const [manualLayer, setManualLayer] = useState<BlueprintNode["layer"]>("sample");
  const [manualLabel, setManualLabel] = useState("");
  const [manualSourceId, setManualSourceId] = useState("");
  const [edgeSourceId, setEdgeSourceId] = useState("");
  const [edgeTargetId, setEdgeTargetId] = useState("");
  const [blueprintStatus, setBlueprintStatus] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const draftNodes = draftBlueprint.nodes;
  const draftEdges = draftBlueprint.edges;
  const aiSuggestionCount = countNewBlueprintNodes(draftBlueprint, aiBlueprint);
  const confirmedEdges = draftEdges.filter((edge) => edge.status === "confirmed").length;
  const completeness = Math.min(96, 35 + draftNodes.length * 6 + confirmedEdges * 4);
  const previousLayer = previousBlueprintLayer(manualLayer);
  const manualSourceOptions = previousLayer ? draftNodes.filter((node) => node.layer === previousLayer) : [];
  const hasAiDraft = aiBlueprint.nodes.length > 0 || aiBlueprint.edges.length > 0;
  const blueprintQuestions = analysis?.questions?.filter((item) => item.step === "blueprint") ?? [];
  const canAddRelation = Boolean(edgeSourceId && edgeTargetId && edgeSourceId !== edgeTargetId);
  const hasSampleBlueprint = sampleRelationshipGroups.length > 0;
  const sampleBlueprintSource = acceptedSampleDraft
    ? "accepted Samples AI core mapping"
    : latestSampleAiDraft
      ? "latest Samples AI core mapping"
      : "Samples rows in the SDRF table";
  const sampleBlueprintSummary = useMemo(() => summarizeBlueprintRelationshipGroups(sampleRelationshipGroups), [sampleRelationshipGroups]);
  const visibleSampleBlueprintSummary = useMemo(() => summarizeBlueprintRelationshipGroups(visibleSampleRelationshipGroups), [visibleSampleRelationshipGroups]);
  const selectedSampleGroup = visibleSampleRelationshipGroups.find((group) => group.id === selectedSampleGroupId)
    ?? sampleRelationshipGroups.find((group) => group.id === selectedSampleGroupId)
    ?? sampleRelationshipGroups[0];

  useEffect(() => {
    if (lastAiBlueprintFingerprintRef.current === aiBlueprintFingerprint || draftDirty) return;
    lastAiBlueprintFingerprintRef.current = aiBlueprintFingerprint;
    if (!draftDirty) setDraftBlueprint(aiBlueprint);
  }, [aiBlueprintFingerprint, aiBlueprint, draftDirty]);

  useEffect(() => {
    if (!previousLayer) {
      setManualSourceId("");
      return;
    }
    if (!manualSourceOptions.some((node) => node.id === manualSourceId)) {
      setManualSourceId(manualSourceOptions[0]?.id ?? "");
    }
  }, [manualLayer, previousLayer, manualSourceOptions.map((node) => node.id).join("|"), manualSourceId]);

  useEffect(() => {
    if (!draftNodes.some((node) => node.id === edgeSourceId)) setEdgeSourceId(draftNodes[0]?.id ?? "");
    const nextTarget = draftNodes.find((node) => node.id !== (edgeSourceId || draftNodes[0]?.id))?.id ?? "";
    if (!draftNodes.some((node) => node.id === edgeTargetId)) setEdgeTargetId(nextTarget);
  }, [draftNodes.map((node) => node.id).join("|"), edgeSourceId, edgeTargetId]);

  useEffect(() => {
    if (!sampleRelationshipGroups.length) {
      setSelectedSampleGroupId("");
      return;
    }
    if (!sampleRelationshipGroups.some((group) => group.id === selectedSampleGroupId)) {
      setSelectedSampleGroupId(sampleRelationshipGroups[0].id);
    }
  }, [sampleRelationshipGroups.map((group) => group.id).join("|"), selectedSampleGroupId]);

  useEffect(() => {
    if (!sampleRelationshipFacets.length) {
      setSelectedRelationshipFacetId("");
      return;
    }
    if (!sampleRelationshipFacets.some((facet) => facet.id === selectedRelationshipFacetId)) {
      setSelectedRelationshipFacetId(defaultBlueprintRelationshipFacet(sampleRelationshipFacets)?.id ?? "");
    }
  }, [sampleRelationshipFacets.map((facet) => facet.id).join("|"), selectedRelationshipFacetId]);

  const saveBlueprint = useMutation({
    mutationFn: (nextBlueprint: Blueprint) => api.putBlueprint(projectId, nextBlueprint),
    onSuccess: (savedBlueprint) => {
      setDraftBlueprint(normalizeBlueprint(savedBlueprint));
      setDraftDirty(false);
      refresh();
    },
    onError: (error) => {
      setBlueprintStatus(error instanceof Error ? error.message : "Unable to save blueprint.");
    },
  });
  const addAiDraft = useMutation({
    mutationFn: async () => {
      const source = hasAiDraft ? aiBlueprint : normalizeBlueprint((await api.runAnalysis(projectId)).blueprint);
      const nextBlueprint = mergeBlueprints(draftBlueprint, source);
      return api.putBlueprint(projectId, nextBlueprint);
    },
    onMutate: () => {
      setBlueprintStatus(hasAiDraft ? "Adding AI blueprint suggestions..." : "Running AI analysis and adding the blueprint...");
    },
    onSuccess: (savedBlueprint) => {
      const normalized = normalizeBlueprint(savedBlueprint);
      setDraftBlueprint(normalized);
      setDraftDirty(false);
      setBlueprintStatus("AI blueprint added.");
      refresh();
    },
    onError: (error) => {
      setBlueprintStatus(error instanceof Error ? error.message : "AI blueprint add failed.");
    },
  });
  const applySampleCoreMapping = useMutation({
    mutationFn: async () => {
      const source = buildEditableBlueprintFromRelationshipGroups(sampleRelationshipGroups);
      if (!source.nodes.length) throw new Error("No AI core mapping rows are available to apply.");
      const nextBlueprint = mergeBlueprints(draftBlueprint, source);
      return api.putBlueprint(projectId, nextBlueprint);
    },
    onMutate: () => {
      setBlueprintStatus("Applying AI core mapping...");
    },
    onSuccess: (savedBlueprint) => {
      const normalized = normalizeBlueprint(savedBlueprint);
      setDraftBlueprint(normalized);
      setDraftDirty(false);
      setBlueprintStatus("AI core mapping applied.");
      refresh();
    },
    onError: (error) => {
      setBlueprintStatus(error instanceof Error ? error.message : "AI core mapping apply failed.");
    },
  });
  const commitBlueprint = (nextBlueprint: Blueprint, message: string) => {
    setDraftBlueprint(nextBlueprint);
    setDraftDirty(true);
    setBlueprintStatus(message);
    saveBlueprint.mutate(nextBlueprint);
  };
  const handleRelationshipFacetSelect = (facetId: string) => {
    setSelectedRelationshipFacetId(facetId);
    const facet = sampleRelationshipFacets.find((item) => item.id === facetId);
    if (facet?.groupId) setSelectedSampleGroupId(facet.groupId);
  };
  const handleSampleRelationshipGroupSelect = (groupId: string) => {
    setSelectedSampleGroupId(groupId);
    const groupFacet = sampleRelationshipFacets.find((facet) => facet.kind === "group" && facet.groupId === groupId);
    if (groupFacet) setSelectedRelationshipFacetId(groupFacet.id);
  };
  const handleManualAdd = () => {
    const label = cleanOneLineString(manualLabel);
    if (!label) return;
    const node = createBlueprintNode(manualLayer, label);
    const nextEdges = manualSourceId
      ? [...draftEdges, createBlueprintEdge(manualSourceId, node.id, "confirmed", 1)]
      : draftEdges;
    commitBlueprint({ nodes: [...draftNodes, node], edges: nextEdges }, `${label} added.`);
    setManualLabel("");
  };
  const handleAddRelation = () => {
    if (!canAddRelation || edgeExists(draftEdges, edgeSourceId, edgeTargetId)) return;
    const edge = createBlueprintEdge(edgeSourceId, edgeTargetId, "confirmed", 1);
    commitBlueprint({ nodes: draftNodes, edges: [...draftEdges, edge] }, "Mapping added.");
  };
  const handleDeleteNode = (nodeId: string) => {
    const nextBlueprint = {
      nodes: draftNodes.filter((node) => node.id !== nodeId),
      edges: draftEdges.filter((edge) => edge.source_id !== nodeId && edge.target_id !== nodeId),
    };
    commitBlueprint(nextBlueprint, "Item removed.");
  };
  const handleDeleteEdge = (edgeId: string) => {
    commitBlueprint({ nodes: draftNodes, edges: draftEdges.filter((edge) => edge.id !== edgeId) }, "Mapping removed.");
  };
  const saving = saveBlueprint.isPending || addAiDraft.isPending || applySampleCoreMapping.isPending;
  return (
    <div className="content-grid templates-content-grid samples-content-grid">
      <section className="wide-stack">
        {hasSampleBlueprint ? (
          <div className="metrics-row">
            <Metric label="Sample groups" value={sampleRelationshipGroups.length} tone="green" />
            <Metric label="Samples" value={sampleBlueprintSummary.sampleCount} tone="blue" />
            <Metric label="Assays" value={sampleBlueprintSummary.assayCount} tone="purple" />
            <Metric label="Raw files" value={sampleBlueprintSummary.rawFileCount} tone="orange" />
          </div>
        ) : (
          <div className="metrics-row">
            <Metric label="Blueprint completeness" value={`${completeness}%`} tone="green" />
            <Metric label="Items" value={draftNodes.length} tone="blue" />
            <Metric label="Mappings" value={draftEdges.length} tone="purple" />
            <Metric label="To review" value={blueprintQuestions.length} tone="orange" />
          </div>
        )}
        <Panel title={hasSampleBlueprint ? "Sample-driven blueprint" : "Blueprint builder"}>
          <div className="blueprint-builder">
            <div className="blueprint-action-bar">
              <div>
                <strong>{hasSampleBlueprint ? "Samples relationship map" : "Study workflow"}</strong>
                <p>
                  {hasSampleBlueprint
                    ? `Built from ${sampleBlueprintSource}: groups, sample names, replicates, fractionation, assays and raw files.`
                    : "Build the path from biological samples to preparation, assay runs and data files."}
                </p>
              </div>
              {hasSampleBlueprint ? (
                <div className="blueprint-action-buttons">
                  <span className="blueprint-sync-badge"><Check size={15} /> Synced from Samples</span>
                  <button className="btn primary" type="button" onClick={() => applySampleCoreMapping.mutate()} disabled={saving}>
                    <Sparkles size={16} /> {applySampleCoreMapping.isPending ? "Applying..." : "Apply AI core mapping"}
                  </button>
                </div>
              ) : (
                <button className="btn primary" type="button" onClick={() => addAiDraft.mutate()} disabled={saving}>
                  <Sparkles size={16} /> {addAiDraft.isPending ? "Adding..." : "AI one-click add"}
                </button>
              )}
            </div>
            {blueprintStatus && <div className="blueprint-status">{blueprintStatus}</div>}
            {hasSampleBlueprint && sampleRelationshipFacets.length > 1 ? (
              <BlueprintRelationshipViewSelector
                facets={sampleRelationshipFacets}
                selectedFacetId={selectedRelationshipFacet?.id}
                selectedFacetLabel={selectedRelationshipFacet?.label ?? ""}
                currentRawFileCount={visibleSampleBlueprintSummary.rawFileCount}
                totalRawFileCount={sampleBlueprintSummary.rawFileCount}
                onSelect={handleRelationshipFacetSelect}
              />
            ) : null}
            <BlueprintGraph
              blueprint={draftBlueprint}
              graph={hasSampleBlueprint ? sampleRelationshipGraph : undefined}
              selectedNodeId={selectedSampleGroup?.id}
              onNodeClick={(nodeId) => {
                if (sampleRelationshipGroups.some((group) => group.id === nodeId)) handleSampleRelationshipGroupSelect(nodeId);
              }}
            />
            {hasSampleBlueprint && selectedSampleGroup ? (
              <SampleBlueprintRelationshipExplorer
                groups={sampleRelationshipGroups}
                currentGroups={visibleSampleRelationshipGroups}
                selectedGroup={selectedSampleGroup}
                onSelect={handleSampleRelationshipGroupSelect}
                activeFacet={selectedRelationshipFacet}
              />
            ) : null}
            {(!hasSampleBlueprint || draftNodes.length > 0) && (
            <div className="blueprint-editor-grid">
              <section className="blueprint-editor-card">
                <div className="blueprint-editor-head">
                  <strong>Add item</strong>
                  <span>Manual</span>
                </div>
                <div className="blueprint-form-grid">
                  <label>
                    Layer
                    <select value={manualLayer} onChange={(event) => setManualLayer(event.target.value as BlueprintNode["layer"])}>
                      {BLUEPRINT_LAYERS.map((layer) => <option key={layer} value={layer}>{blueprintLayerLabel(layer)}</option>)}
                    </select>
                  </label>
                  <label>
                    Name
                    <input value={manualLabel} onChange={(event) => setManualLabel(event.target.value)} placeholder="e.g. TMT fraction 1" />
                  </label>
                  <label>
                    Connect from
                    <select value={manualSourceId} onChange={(event) => setManualSourceId(event.target.value)} disabled={!manualSourceOptions.length}>
                      <option value="">No connection</option>
                      {manualSourceOptions.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
                    </select>
                  </label>
                  <button className="btn primary" type="button" onClick={handleManualAdd} disabled={!manualLabel.trim() || saving}>
                    <Plus size={16} /> Add
                  </button>
                </div>
              </section>
              <section className="blueprint-editor-card">
                <div className="blueprint-editor-head">
                  <strong>Add mapping</strong>
                  <span>Manual</span>
                </div>
                <div className="blueprint-form-grid">
                  <label>
                    From
                    <select value={edgeSourceId} onChange={(event) => setEdgeSourceId(event.target.value)} disabled={draftNodes.length < 2}>
                      {draftNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
                    </select>
                  </label>
                  <label>
                    To
                    <select value={edgeTargetId} onChange={(event) => setEdgeTargetId(event.target.value)} disabled={draftNodes.length < 2}>
                      {draftNodes.filter((node) => node.id !== edgeSourceId).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
                    </select>
                  </label>
                  <button className="btn ghost" type="button" onClick={handleAddRelation} disabled={!canAddRelation || saving || edgeExists(draftEdges, edgeSourceId, edgeTargetId)}>
                    <Link2 size={16} /> Add mapping
                  </button>
                </div>
              </section>
            </div>
            )}
          </div>
        </Panel>
        {(!hasSampleBlueprint || draftNodes.length > 0) && (
          <>
            <Panel title="Blueprint items">
              <div className="blueprint-lane-grid">
                {BLUEPRINT_LAYERS.map((layer) => {
                  const nodes = draftNodes.filter((node) => node.layer === layer);
                  return (
                    <section key={layer} className={`blueprint-lane lane-${layer}`}>
                      <div className="blueprint-lane-head">
                        <strong>{blueprintLayerLabel(layer)}</strong>
                        <span>{nodes.length}</span>
                      </div>
                      <div className="blueprint-node-list">
                        {nodes.map((node) => (
                          <article key={node.id} className="blueprint-node-card">
                            <div>
                              <strong>{node.label}</strong>
                              <span>{node.status === "confirmed" ? "Manual" : `AI ${Math.round((node.confidence ?? 0.5) * 100)}%`}</span>
                            </div>
                            <button className="icon-btn" type="button" aria-label={`Remove ${node.label}`} onClick={() => handleDeleteNode(node.id)} disabled={saving}>
                              <X size={14} />
                            </button>
                          </article>
                        ))}
                        {!nodes.length && <p className="blueprint-empty">No items yet.</p>}
                      </div>
                    </section>
                  );
                })}
              </div>
            </Panel>
            <Panel title="Mappings">
              <div className="blueprint-edge-list">
                {draftEdges.map((edge) => {
                  const source = draftNodes.find((node) => node.id === edge.source_id);
                  const target = draftNodes.find((node) => node.id === edge.target_id);
                  return (
                    <article key={edge.id} className="blueprint-edge-card">
                      <span>{source?.label ?? edge.source_id}</span>
                      <Link2 size={15} />
                      <span>{target?.label ?? edge.target_id}</span>
                      <em>{edge.status === "confirmed" ? "Manual" : `AI ${Math.round((edge.confidence ?? 0.5) * 100)}%`}</em>
                      <button className="icon-btn" type="button" aria-label="Remove mapping" onClick={() => handleDeleteEdge(edge.id)} disabled={saving}>
                        <X size={14} />
                      </button>
                    </article>
                  );
                })}
                {!draftEdges.length && <p className="blueprint-empty">No mappings yet. Add a manual mapping or use AI one-click add.</p>}
              </div>
            </Panel>
          </>
        )}
      </section>
      <AssistantPanel
        questions={blueprintQuestions}
        evidences={analysis?.evidences}
        showQuestions={false}
        showEvidence={false}
        useFallbacks={false}
      >
        {blueprintSampleDraft ? (
          <BlueprintSampleAiAssistant
            draft={blueprintSampleDraft}
            groups={sampleRelationshipGroups}
            sourceLabel={sampleBlueprintSource}
          />
        ) : (
          <div className="assistant-recommendation blueprint-ai-assistant">
            <div className="assistant-recommendation-scroll">
              <div className="assistant-recommendation-head">
                <strong>Blueprint recommendation</strong>
                <span>{hasAiDraft ? `${aiBlueprint.nodes.length} items` : "Pending"}</span>
              </div>
              <div className={`assistant-summary-card ${hasAiDraft ? "ok" : ""}`}>
                {hasAiDraft ? <Check size={16} /> : <Sparkles size={16} />}
                <div>
                  <strong>AI blueprint draft</strong>
                  <p>
                    {hasAiDraft
                      ? `${aiBlueprint.nodes.length} items and ${aiBlueprint.edges.length} mappings are available from analysis.`
                      : "No AI draft is loaded yet. Run analysis to generate one."}
                  </p>
                </div>
              </div>
              <div className="blueprint-assistant-stats">
                <span><b>{aiSuggestionCount}</b> new items</span>
                <span><b>{aiBlueprint.edges.length}</b> mappings</span>
              </div>
            </div>
            <div className="recommendation-actions compact ai-sample-actions">
              <button className="btn ghost" type="button" onClick={() => addAiDraft.mutate()} disabled={saving}>
                <Sparkles size={16} /> {addAiDraft.isPending ? "Adding..." : "Add AI draft"}
              </button>
            </div>
          </div>
        )}
      </AssistantPanel>
    </div>
  );
}

type BlueprintRelationshipGroup = {
  id: string;
  label: string;
  factors: Record<string, string>;
  samples: string[];
  rows: CoreMappingRow[];
  biologicalReplicates: string[];
  pools: string[];
  poolMembers: string[];
  labels: string[];
  fractionations: string[];
  acquisitionMethods: string[];
  technicalReplicates: string[];
  assays: string[];
  rawFiles: string[];
  relationshipLayers?: BlueprintRelationshipLayer[];
};

type BlueprintRelationshipFacet = {
  id: string;
  kind: "fraction" | "assay" | "raw_file" | "group" | "all";
  label: string;
  value: string;
  rows: CoreMappingRow[];
  groupId?: string;
  groupLabel?: string;
};

function BlueprintRelationshipViewSelector({
  facets,
  selectedFacetId,
  selectedFacetLabel,
  currentRawFileCount,
  totalRawFileCount,
  onSelect,
}: {
  facets: BlueprintRelationshipFacet[];
  selectedFacetId?: string;
  selectedFacetLabel: string;
  currentRawFileCount: number;
  totalRawFileCount: number;
  onSelect: (facetId: string) => void;
}) {
  const activeFacet = facets.find((facet) => facet.id === selectedFacetId) ?? facets[0];
  const allFacet = facets.find((facet) => facet.kind === "all");
  const groupFacets = facets.filter((facet) => facet.kind === "group");
  const activeGroupId = activeFacet?.groupId;
  const activeGroupFacet = groupFacets.find((facet) => facet.groupId === activeGroupId);
  const activeGroupFractionFacets = activeGroupId
    ? facets.filter((facet) => facet.kind === "fraction" && facet.groupId === activeGroupId)
    : [];
  return (
    <section className="blueprint-view-selector" aria-label="Relationship view selector">
      <div className="blueprint-view-header">
        <strong>Relationship view</strong>
        <p>Current view: {selectedFacetLabel}, showing {currentRawFileCount} of {totalRawFileCount} raw files.</p>
      </div>
      <div className="blueprint-view-selector-body">
        {groupFacets.length > 0 || allFacet ? (
          <div className="blueprint-view-section blueprint-view-groups-section">
            <span className="blueprint-view-section-label">Groups</span>
            <div className="blueprint-view-options blueprint-view-group-options" aria-label="Relationship groups">
              {allFacet ? (
                <button
                  type="button"
                  className={allFacet.id === selectedFacetId ? "active" : ""}
                  aria-pressed={allFacet.id === selectedFacetId}
                  onClick={() => onSelect(allFacet.id)}
                >
                  <strong>All</strong>
                </button>
              ) : null}
              {groupFacets.map((facet) => {
                const active = facet.groupId === activeGroupId;
                return (
                  <button
                    key={facet.id}
                    type="button"
                    className={active ? "active" : ""}
                    aria-pressed={active}
                    onClick={() => onSelect(facet.id)}
                  >
                    <strong>{facet.label}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {activeGroupFacet && activeGroupFractionFacets.length > 0 ? (
          <div className="blueprint-view-section blueprint-view-fractions-section">
            <span className="blueprint-view-section-label">Fractions</span>
            <div className="blueprint-view-options blueprint-view-fraction-options" aria-label="Group fraction view">
              {activeGroupFractionFacets.map((facet) => (
                <button
                  key={facet.id}
                  type="button"
                  className={facet.id === selectedFacetId ? "active" : ""}
                  aria-pressed={facet.id === selectedFacetId}
                  onClick={() => onSelect(facet.id)}
                >
                  <strong>{facet.value ? `F${normalizeFractionDisplayValue(facet.value)}` : facet.label}</strong>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SampleBlueprintRelationshipExplorer({
  groups,
  currentGroups,
  selectedGroup,
  onSelect,
  activeFacet,
}: {
  groups: BlueprintRelationshipGroup[];
  currentGroups: BlueprintRelationshipGroup[];
  selectedGroup: BlueprintRelationshipGroup;
  onSelect: (groupId: string) => void;
  activeFacet?: BlueprintRelationshipFacet;
}) {
  const currentRows = currentGroups.find((group) => group.id === selectedGroup.id)?.rows
    ?? (activeFacet?.kind === "all" ? selectedGroup.rows : []);
  const relationshipRows = currentRows.length ? currentRows : selectedGroup.rows;
  return (
    <div className="sample-blueprint-shell">
      <div className="sample-blueprint-groups" aria-label="Sample groups">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className={`sample-blueprint-group ${group.id === selectedGroup.id ? "active" : ""}`}
            aria-pressed={group.id === selectedGroup.id}
            onClick={() => onSelect(group.id)}
          >
            <strong>{group.label}</strong>
            {group.samples.length > 0 && <small>{sampleNameSummary(group.samples)}</small>}
            <span>{group.samples.length} samples · {group.rows.length} mapping rows</span>
          </button>
        ))}
      </div>
      <section className="sample-blueprint-detail" aria-label="Selected sample group details">
        <div className="sample-blueprint-detail-head">
          <div>
            <div className="sample-blueprint-title-row">
              <strong>{selectedGroup.label}</strong>
              {selectedGroup.samples.length > 0 && <em>{sampleNameSummary(selectedGroup.samples, 4)}</em>}
            </div>
            <p>Samples and row-level SDRF relationships for the selected group.</p>
          </div>
          <span>{selectedGroup.samples.length} samples</span>
        </div>
        <div className="sample-blueprint-samples">
          {selectedGroup.samples.map((sample) => <span key={sample}>{sample}</span>)}
        </div>
        <div className="sample-blueprint-table-wrap" aria-label="Current core mapping rows">
          <div className="sample-blueprint-table-caption">
            <strong>Core SDRF relationship rows</strong>
            <span>{activeFacet?.label ?? selectedGroup.label} · {relationshipRows.length} rows</span>
          </div>
          <table className="sample-blueprint-table" aria-label="Core SDRF relationship rows">
            <thead>
              <tr>
                <th>Sample</th>
                <th>Biological replicate</th>
                <th>Pool</th>
                <th>Pool members</th>
                <th>Label</th>
                <th>Fractionation</th>
                <th>Acquisition</th>
                <th>Technical replicate</th>
                <th>Assay name</th>
                <th>Raw file</th>
              </tr>
            </thead>
            <tbody>
              {relationshipRows.map((row) => (
                <tr key={`current-${row.rowId}`}>
                  <td>{row.sourceName || "not available"}</td>
                  <td>{row.biologicalReplicate || "not available"}</td>
                  <td>{row.poolId || "not available"}</td>
                  <td>{row.poolMembers?.length ? row.poolMembers.join(", ") : "not available"}</td>
                  <td>{row.label || row.channel || "not available"}</td>
                  <td>{formatBlueprintFractionation(row) || "not available"}</td>
                  <td>{row.acquisitionMethod || "not available"}</td>
                  <td>{row.technicalReplicate || "not available"}</td>
                  <td>{displayBlueprintAssayName(row) || "not available"}</td>
                  <td>{row.dataFile || "not available"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function sampleNameSummary(samples: string[], limit = 3): string {
  const names = uniqueBlueprintStrings(samples).filter(isMeaningfulBlueprintValue);
  if (!names.length) return "No sample names";
  const visible = names.slice(0, limit).join(", ");
  const remaining = names.length - limit;
  return remaining > 0 ? `${visible} +${remaining} more` : visible;
}

function BlueprintSampleAiAssistant({
  draft,
  groups,
  sourceLabel,
}: {
  draft: SampleDesignDraft;
  groups: BlueprintRelationshipGroup[];
  sourceLabel: string;
}) {
  const mappingRows = blueprintAssistantMappingRows(draft, groups);
  const groupingStrategy = draft.groupingStrategy;
  const rawJson = sampleDraftToJson(draft);
  const coverageCheck = asRecommendationRecord(rawJson.coverage_check);
  const coverageWarnings = uniqueBlueprintStrings([
    ...sanitizeStringList(coverageCheck?.warnings),
    ...sanitizeStringList(coverageCheck?.missing_biological_conditions ?? coverageCheck?.missingBiologicalConditions)
      .map((item) => `Missing biological condition: ${item}`),
    ...sanitizeStringList(coverageCheck?.unresolved_conflicts ?? coverageCheck?.unresolvedConflicts)
      .map((item) => `Unresolved conflict: ${item}`),
    ...(draft.warnings ?? []),
  ]);
  return (
    <div className="assistant-recommendation blueprint-ai-assistant">
      <div className="assistant-recommendation-scroll">
        <div className="assistant-recommendation-head">
          <strong>Blueprint recommendation</strong>
          <span>{mappingRows.length} core rows</span>
        </div>
        <div className="assistant-summary-card ok">
          <Check size={16} />
          <div>
            <strong>Samples AI core mapping draft</strong>
            <p>{draft.summary || `Built from ${sourceLabel}.`}</p>
          </div>
        </div>
        <div className="blueprint-assistant-stats">
          <span><b>{draft.groups.length}</b> AI groups</span>
          <span><b>{mappingRows.length}</b> core rows</span>
        </div>
        <div className="blueprint-ai-rationale">
        <section className="blueprint-ai-rationale-section">
          <div className="assistant-section-head">
            <strong>Why this grouping</strong>
            <span>{groupingStrategy?.selectedGroupingFields.length ? `Selected: ${groupingStrategy.selectedGroupingFields.join(", ")}` : "AI grouping"}</span>
          </div>
          {groupingStrategy?.reason ? <p>{groupingStrategy.reason}</p> : <p>AI grouped samples by the biological sample groups returned in the Samples step.</p>}
          <div className="blueprint-chip-row">
            {groupingStrategy?.candidateGroupingFields.slice(0, 6).map((item) => (
              <span key={`candidate-${item.field}`}>Candidate: {item.field}{item.values.length ? ` (${item.values.slice(0, 4).join(", ")})` : ""}</span>
            ))}
            {groupingStrategy?.rejectedGroupingFields.slice(0, 6).map((item) => (
              <span key={`rejected-${item.field}`}>Rejected: {item.field}{item.classification ? ` (${item.classification})` : ""}</span>
            ))}
          </div>
        </section>
        {Boolean(groupingStrategy?.candidateGroupingFields.length || groupingStrategy?.rejectedGroupingFields.length) && (
          <section className="blueprint-ai-rationale-section">
            <div className="assistant-section-head">
              <strong>Field decisions</strong>
            </div>
            <div className="blueprint-decision-list">
              {[...(groupingStrategy?.candidateGroupingFields ?? []), ...(groupingStrategy?.rejectedGroupingFields ?? [])].slice(0, 8).map((item) => (
                <article key={`${item.field}-${item.classification ?? "decision"}`}>
                  <span>{item.classification ?? "decision"}</span>
                  <strong>{item.field}</strong>
                  {item.reason && <p>{item.reason}</p>}
                </article>
              ))}
            </div>
          </section>
        )}
        <section className="blueprint-ai-rationale-section">
          <div className="assistant-section-head">
            <strong>AI returned core mapping</strong>
            <span>{mappingRows.length} row{mappingRows.length === 1 ? "" : "s"}</span>
          </div>
          <div className="blueprint-mapping-preview">
            {mappingRows.slice(0, 8).map((row, index) => (
              <span key={`${row.sourceName}-${row.assayName}-${row.dataFile}-${index}`}>
                {row.sourceName || "sample"} -&gt; {displayBlueprintAssayName(row) || "assay not available"} -&gt; {row.dataFile || "raw file not available"}
              </span>
            ))}
            {!mappingRows.length && <span>No mapping rows were returned in the Samples AI JSON.</span>}
          </div>
        </section>
        {coverageWarnings.length > 0 && (
          <section className="blueprint-ai-rationale-section">
            <div className="assistant-section-head">
              <strong>Coverage notes</strong>
            </div>
            <div className="sample-json-warning-list">
              {coverageWarnings.slice(0, 6).map((warning, index) => (
                <span key={`blueprint-coverage-${index}`}><AlertTriangle size={13} /> {warning}</span>
              ))}
            </div>
          </section>
        )}
        {draft.sources.length > 0 && (
          <section className="blueprint-ai-rationale-section">
            <div className="assistant-section-head">
              <strong>AI sources</strong>
            </div>
            <div className="assistant-source-list">
              {draft.sources.slice(0, 6).map((source, index) => (
                <div key={`${source.label}-${index}`} className="assistant-source-card">
                  <span>{source.label}</span>
                  <strong>{source.value}</strong>
                  <small>{source.location || source.source || "Import context"}</small>
                </div>
              ))}
            </div>
          </section>
        )}
          <details className="sample-json-preview">
            <summary>AI returned JSON</summary>
            <pre>{JSON.stringify(rawJson, null, 2)}</pre>
          </details>
        </div>
      </div>
      <div className="recommendation-actions compact ai-sample-actions">
        <span className="success-text">Synced from Samples</span>
      </div>
    </div>
  );
}

function blueprintAssistantMappingRows(draft: SampleDesignDraft, groups: BlueprintRelationshipGroup[]): CoreMappingRow[] {
  const rows = buildCoreMappingRowsFromSampleDraftMappingRows(draft);
  if (rows.length) return rows;
  return groups.flatMap((group) => group.rows);
}

function buildBlueprintRelationshipGroupsFromSampleDraft(draft: SampleDesignDraft | null, importedRawFileNames: string[] = []): BlueprintRelationshipGroup[] {
  if (!draft?.groups.length) return [];
  const aiMappingRows = buildCoreMappingRowsFromSampleDraftMappingRows(draft, importedRawFileNames);
  const uncoveredRawFiles = rawFileNamesNotCovered(aiMappingRows, importedRawFileNames);
  const rawFileRows = buildCoreMappingRowsFromSampleGroupsAndRawFiles(draft, uncoveredRawFiles);
  const relationshipRows = [...aiMappingRows, ...rawFileRows];
  if (relationshipRows.length) return buildBlueprintRelationshipGroupsFromDraftGroups(draft, relationshipRows);
  return draft.groups
    .filter((group) => group.sampleCount > 0)
    .map((group, groupIndex) => buildBlueprintRelationshipGroupFromDraftGroup(draft, group, groupIndex, []));
}

function buildBlueprintRelationshipGroupsFromDraftGroups(draft: SampleDesignDraft, rows: CoreMappingRow[]): BlueprintRelationshipGroup[] {
  const relationshipRows = repairPooledFractionRowsAcrossDraftGroups(draft, rows);
  const groupRows = new Map<string, CoreMappingRow[]>();
  draft.groups.forEach((group, groupIndex) => groupRows.set(sampleDesignGroupKey(group, groupIndex), []));
  for (const row of relationshipRows) {
    const match = bestSampleDraftGroupForCoreMappingRow(row, draft.groups);
    if (!match) continue;
    const groupKey = sampleDesignGroupKey(match.group, match.index);
    groupRows.get(groupKey)?.push(normalizeCoreMappingRowForSampleDraftGroup(row, match.group, draft.groups));
  }
  return draft.groups
    .filter((group) => group.sampleCount > 0)
    .map((group, groupIndex) => buildBlueprintRelationshipGroupFromDraftGroup(draft, group, groupIndex, groupRows.get(sampleDesignGroupKey(group, groupIndex)) ?? []));
}

function repairPooledFractionRowsAcrossDraftGroups(draft: SampleDesignDraft, rows: CoreMappingRow[]): CoreMappingRow[] {
  const groups = draft.groups.filter((group) => group.sampleCount > 0);
  if (groups.length < 2 || rows.length < groups.length * 2) return rows;
  const exactCounts = groups.map((group, groupIndex) => rows.filter((row) => exactSampleDraftGroupForCoreMappingRow(row, [group])?.index === 0 || exactSampleDraftGroupForCoreMappingRow(row, draft.groups)?.index === groupIndex).length);
  const populatedGroups = exactCounts.filter((count) => count > 0).length;
  if (populatedGroups !== 1 || !exactCounts.some((count) => count === 0)) return rows;
  const fractionBuckets = new Map<string, Array<{ row: CoreMappingRow; index: number }>>();
  for (const [index, row] of rows.entries()) {
    const fraction = normalizeFractionDisplayValue(cleanOneLineString(row.fractionId) || inferRawFileFractionId(row.dataFile ?? ""));
    if (!fraction || !isMeaningfulBlueprintValue(row.dataFile ?? "")) return rows;
    fractionBuckets.set(fraction, [...(fractionBuckets.get(fraction) ?? []), { row, index }]);
  }
  const buckets = [...fractionBuckets.values()];
  if (buckets.length < 2 || !buckets.every((bucket) => bucket.length === groups.length)) return rows;
  const repaired = [...rows];
  for (const bucket of buckets) {
    const sorted = [...bucket].sort((left, right) => compareRawFileSlot(left.row.dataFile ?? "", right.row.dataFile ?? ""));
    sorted.forEach((item, groupIndex) => {
      repaired[item.index] = realignCoreMappingRowToDraftGroup(item.row, draft, groups[groupIndex], groupIndex);
    });
  }
  return repaired;
}

function compareRawFileSlot(left: string, right: string): number {
  const leftSlot = rawFileTerminalSlot(left);
  const rightSlot = rawFileTerminalSlot(right);
  const leftNumber = Number.parseInt(leftSlot, 10);
  const rightNumber = Number.parseInt(rightSlot, 10);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) return leftNumber - rightNumber;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function rawFileTerminalSlot(rawFile: string): string {
  const clean = cleanOneLineString(rawFile).replace(/\.[^.]+$/, "");
  const match = /(?:^|[_-])0*([0-9]+[a-z]?)$/i.exec(clean);
  return match?.[1]?.toLowerCase() ?? clean;
}

function realignCoreMappingRowToDraftGroup(
  row: CoreMappingRow,
  draft: SampleDesignDraft,
  group: SampleDesignGroup,
  groupIndex: number,
): CoreMappingRow {
  const groupName = cleanOneLineString(group.groupName) || `Sample group ${groupIndex + 1}`;
  const poolMembers = biologicalSampleNamesForDraftGroup(draft, group, groupIndex);
  const poolId = cleanOneLineString(group.id || group.namingPrefix || groupName);
  return {
    ...row,
    sourceName: groupName,
    biologicalSampleId: groupName,
    sampleGroup: groupName,
    biologicalReplicate: String(groupIndex + 1),
    poolId: poolId || row.poolId,
    poolMembers: poolMembers.length ? poolMembers : row.poolMembers,
    assayName: row.assayName && normalizedAxisName(row.assayName) === normalizedAxisName(row.sourceName)
      ? groupName
      : row.assayName,
    warnings: uniqueBlueprintStrings([
      ...row.warnings,
      "Mapping row reassigned across accepted sample groups because repeated fraction raw files matched the number of pooled groups.",
    ]),
  };
}

function buildBlueprintRelationshipGroupFromDraftGroup(
  draft: SampleDesignDraft,
  group: SampleDesignGroup,
  groupIndex: number,
  relationshipRows: CoreMappingRow[],
): BlueprintRelationshipGroup {
  const groupName = cleanOneLineString(group.groupName) || `Sample group ${groupIndex + 1}`;
  const groupId = `accepted-${slugId(group.id || groupName || `group-${groupIndex + 1}`)}`;
  const sourceLevelSampleNames = biologicalSampleNamesForDraftGroup(draft, group, groupIndex);
  const generatedRows = sourceLevelSampleNames.length ? [] : buildFallbackCoreMappingRowsForSampleDesignGroup(group, groupIndex);
  const generatedBySample = new Map(generatedRows.map((row) => [row.sourceName.toLowerCase(), row]));
  const rows = [...relationshipRows];
  const rowSamples = uniqueBlueprintStrings(rows.flatMap(coreMappingRowSampleNames)).filter(isMeaningfulBlueprintValue);
  for (const fallbackRow of generatedRows) {
    if (!rowSamples.some((sample) => normalizedAxisName(sample) === normalizedAxisName(fallbackRow.sourceName))) {
      rows.push(fallbackRow);
    }
  }
  const sampleNames = uniqueBlueprintStrings([
    ...sourceLevelSampleNames,
    ...rows.flatMap(coreMappingRowSampleNames),
    ...generatedRows.map((row) => row.sourceName),
  ]).filter(isMeaningfulBlueprintValue);
  const normalizedRows = rows.map((row, index) => ({
    ...(generatedBySample.get(row.sourceName.toLowerCase()) ?? {}),
    ...row,
    rowId: row.rowId || `${groupId}-row-${index + 1}`,
    sampleGroup: groupName,
  }));
  const factors = sampleDraftFactorValues(group);
  return {
    id: groupId,
    label: groupName,
    factors,
    samples: sampleNames,
    rows: normalizedRows,
    biologicalReplicates: uniqueBlueprintStrings(normalizedRows.map((row) => row.biologicalReplicate)),
    pools: uniqueBlueprintStrings(normalizedRows.map((row) => row.poolId ?? "")),
    poolMembers: uniqueBlueprintStrings(normalizedRows.flatMap((row) => row.poolMembers ?? [])),
    labels: uniqueBlueprintStrings(normalizedRows.map((row) => row.label ?? row.channel ?? "")),
    fractionations: uniqueBlueprintStrings(normalizedRows.map(formatBlueprintFractionation)),
    acquisitionMethods: uniqueBlueprintStrings(normalizedRows.map((row) => row.acquisitionMethod ?? "")),
    technicalReplicates: uniqueBlueprintStrings(normalizedRows.map((row) => row.technicalReplicate ?? "")),
    assays: uniqueBlueprintStrings(normalizedRows.map(displayBlueprintAssayName)),
    rawFiles: uniqueBlueprintStrings(normalizedRows.map((row) => row.dataFile ?? "")),
    relationshipLayers: draft.relationshipLayers,
  };
}

function biologicalSampleNamesForDraftGroup(draft: SampleDesignDraft, group: SampleDesignGroup, groupIndex: number): string[] {
  const names = (draft.biologicalSamples ?? [])
    .filter((sample) => assistantSampleGroupIndex(sample, draft.groups) === groupIndex)
    .map((sample) => cleanOneLineString(sample.sourceName));
  if (names.length) return uniqueBlueprintStrings(names);
  const groupTokens = [group.id, group.groupName, group.namingPrefix].map(assistantMatchToken).filter(Boolean);
  return uniqueBlueprintStrings((draft.biologicalSamples ?? [])
    .filter((sample) => {
      const sampleTokens = [sample.sampleGroup, sample.poolId].map(assistantMatchToken).filter(Boolean);
      return sampleTokens.some((sampleToken) => groupTokens.some((groupToken) => assistantTokensMatch(sampleToken, groupToken)));
    })
    .map((sample) => cleanOneLineString(sample.sourceName)));
}

function buildFallbackCoreMappingRowsForSampleDesignGroup(group: SampleDesignGroup, groupIndex: number): CoreMappingRow[] {
  const groupName = cleanOneLineString(group.groupName) || `Sample group ${groupIndex + 1}`;
  const groupId = `accepted-${slugId(group.id || groupName || `group-${groupIndex + 1}`)}`;
  const samples = Array.from({ length: group.sampleCount }, (_, index) => generatedSampleSourceName(group, index));
  const factorValues = sampleDraftFactorValues(group);
  const context = group.assayContext ?? {};
  const preparations = sampleAssayContextValues(context, (key) => /(fractionation|preparation|enrichment)/.test(key) && !/identifier|\bid\b|ids$/.test(key));
  const fractions = sampleAssayContextValues(context, (key) => /fraction/.test(key) && !/(fractionation|method|preparation)/.test(key));
  const labels = sampleAssayContextValues(context, (key) => /(label|tag)/.test(key) && !/(labelfree|strategy|count)/.test(key));
  const channels = sampleAssayContextValues(context, (key) => /channel/.test(key) && !/count/.test(key));
  const acquisitionMethods = sampleAssayContextValues(context, (key) => /acquisition|fragmentation|method/.test(key) && !/processing|search|count/.test(key));
  const technicalReplicates = sampleAssayContextValues(context, (key) => /(technical.*replicate|tech.*replicate|technicalreplicate)/.test(key));
  const assays = sampleAssayContextValues(context, (key) => /assay/.test(key) && !/count/.test(key));
  const rawFiles = sampleAssayContextValues(context, (key) => /(raw.*file|data.*file|example.*filename|filename)/.test(key) && !/count/.test(key));
  return samples.map((sampleName, index) => {
    const label = blueprintValueAt(labels, index) || inferSampleDraftGroupLabel(group);
    const channel = blueprintValueAt(channels, index);
    const preparation = blueprintValueAt(preparations, index);
    const fractionId = blueprintValueAt(fractions, index);
    const acquisitionMethod = blueprintValueAt(acquisitionMethods, index);
    const technicalReplicate = blueprintValueAt(technicalReplicates, index);
    const assayName = blueprintValueAt(assays, index);
    const dataFile = blueprintValueAt(rawFiles, index);
    return {
      rowId: `${groupId}-row-${index + 1}`,
      sourceName: sampleName,
      biologicalSampleId: sampleName,
      sampleGroup: groupName,
      biologicalReplicate: String(index + 1),
      metadata: Object.fromEntries(Object.entries(group.metadata).map(([key, value]) => [key, cleanOneLineString(value)])),
      factorValues,
      label: label || undefined,
      channel: channel || undefined,
      preparation: preparation || undefined,
      fractionId: fractionId || undefined,
      acquisitionMethod: acquisitionMethod || undefined,
      technicalReplicate: technicalReplicate || undefined,
      assayName: assayName || undefined,
      dataFile: dataFile || undefined,
      evidenceRefs: ["samples_ai_accepted_draft"],
      confidence: 0.95,
      warnings: group.warnings ?? [],
    };
  });
}

function buildCoreMappingRowsFromSampleDraftMappingRows(draft: SampleDesignDraft, importedRawFileNames: string[] = []): CoreMappingRow[] {
  const rawRows = draft.mappingRows?.length
    ? draft.mappingRows
    : rawRecordList(draft.rawJson?.mapping_rows ?? draft.rawJson?.mappingRows);
  if (!rawRows.length) return [];
  const generatedSampleGroupByName = generatedSampleGroupLookup(draft);
  const rows = rawRows
    .map((record, index) => sanitizeAiCoreMappingRow(record, index, generatedSampleGroupByName))
    .filter((row): row is CoreMappingRow => Boolean(row));
  return fillMissingCoreMappingRawFiles(rows, importedRawFileNames);
}

function buildCoreMappingRowsFromSampleGroupsAndRawFiles(draft: SampleDesignDraft, importedRawFileNames: string[]): CoreMappingRow[] {
  const rawFileNames = uniqueBlueprintStrings(importedRawFileNames);
  if (!rawFileNames.length || !draft.groups.length) return [];
  const groupCounters = new Map<string, number>();
  return rawFileNames.flatMap((rawFile, index) => {
    const group = bestSampleDraftGroupForRawFile(rawFile, draft.groups);
    if (!group) return [];
    const groupKey = group.id || group.groupName;
    const nextIndex = groupCounters.get(groupKey) ?? 0;
    groupCounters.set(groupKey, nextIndex + 1);
    const replicate = inferRawFileBiologicalReplicate(rawFile);
    const replicateIndex = rawFileReplicateIndex(replicate, group.sampleCount) ?? nextIndex;
    const sourceName = generatedSampleSourceName(group, replicateIndex);
    const fractionId = inferRawFileFractionId(rawFile);
    const preparation = inferRawFilePreparation(rawFile, group);
    return [{
      rowId: `raw-file-core-row-${index + 1}`,
      sourceName,
      biologicalSampleId: sourceName,
      sampleGroup: cleanOneLineString(group.groupName) || "Sample group",
      biologicalReplicate: replicate || String(replicateIndex + 1),
      metadata: Object.fromEntries(Object.entries(group.metadata).map(([key, value]) => [key, cleanOneLineString(value)])),
      factorValues: sampleDraftFactorValues(group),
      label: inferSampleDraftGroupLabel(group, rawFile) || undefined,
      preparation: preparation || undefined,
      fractionId: fractionId || undefined,
      assayName: assayNameFromRawFile(rawFile),
      dataFile: rawFile,
      evidenceRefs: ["import_raw_file_evidence", "samples_ai_group"],
      confidence: 0.68,
      warnings: ["Core mapping row inferred by matching imported raw filename tokens to the accepted Samples AI group because AI mapping_rows were empty."],
    }];
  });
}

function rawFileNamesNotCovered(rows: CoreMappingRow[], importedRawFileNames: string[]): string[] {
  const coveredRawFiles = new Set(rows
    .map((row) => cleanOneLineString(row.dataFile).toLowerCase())
    .filter(Boolean));
  return uniqueBlueprintStrings(importedRawFileNames)
    .filter((rawFile) => !coveredRawFiles.has(cleanOneLineString(rawFile).toLowerCase()));
}

function sampleDesignGroupKey(group: SampleDesignGroup, index: number): string {
  return `${index}:${slugId(group.id || group.groupName || `group-${index + 1}`)}`;
}

function bestSampleDraftGroupForCoreMappingRow(
  row: CoreMappingRow,
  groups: SampleDesignGroup[],
): { group: SampleDesignGroup; index: number } | null {
  const rawFileGroup = row.dataFile ? bestSampleDraftGroupForRawFile(row.dataFile, groups) : undefined;
  if (rawFileGroup) {
    const index = groups.indexOf(rawFileGroup);
    if (index >= 0) return { group: rawFileGroup, index };
  }
  const exactGroup = exactSampleDraftGroupForCoreMappingRow(row, groups);
  if (exactGroup) return exactGroup;
  const ranked = groups
    .map((group, index) => ({ group, index, score: sampleDraftGroupCoreMappingScore(group, row) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  if (!ranked[0] || ranked[0].score <= 0) return null;
  if (ranked[1] && ranked[1].score === ranked[0].score) return null;
  return { group: ranked[0].group, index: ranked[0].index };
}

function exactSampleDraftGroupForCoreMappingRow(
  row: CoreMappingRow,
  groups: SampleDesignGroup[],
): { group: SampleDesignGroup; index: number } | null {
  const rowGroup = normalizedAxisName(row.sampleGroup);
  const rowSamples = coreMappingRowSampleNames(row).map((sample) => normalizedAxisName(sample)).filter(Boolean);
  const rowSampleSet = new Set(rowSamples);
  for (const [index, group] of groups.entries()) {
    const groupNames = [
      group.id,
      group.groupName,
      ...Array.from({ length: group.sampleCount }, (_, sampleIndex) => generatedSampleSourceName(group, sampleIndex)),
    ].map((value) => normalizedAxisName(cleanOneLineString(value))).filter(Boolean);
    if (rowGroup && groupNames.includes(rowGroup)) return { group, index };
    if (groupNames.some((name) => rowSampleSet.has(name))) return { group, index };
  }
  return null;
}

function sampleDraftGroupCoreMappingScore(group: SampleDesignGroup, row: CoreMappingRow): number {
  const rowText = [
    row.sourceName,
    row.biologicalSampleId,
    row.sampleGroup,
    row.dataFile,
    row.assayName,
    row.preparation,
    row.fractionId,
    ...Object.values(row.metadata),
    ...Object.values(row.factorValues),
  ].filter((value): value is string => Boolean(value));
  return sampleDraftGroupRawFileScore(group, rowText.join(" "));
}

function normalizeCoreMappingRowForSampleDraftGroup(
  row: CoreMappingRow,
  group: SampleDesignGroup,
  allGroups: SampleDesignGroup[],
): CoreMappingRow {
  const groupName = cleanOneLineString(group.groupName) || "Sample group";
  const rowBelongsToGroup = exactSampleDraftGroupForCoreMappingRow(row, [group]);
  const rawFileGroup = row.dataFile ? bestSampleDraftGroupForRawFile(row.dataFile, allGroups) : undefined;
  const shouldRealignSample = Boolean(rawFileGroup && rawFileGroup === group && !rowBelongsToGroup);
  const replicate = row.biologicalReplicate || inferRawFileBiologicalReplicate(row.dataFile ?? "");
  const replicateIndex = rawFileReplicateIndex(replicate, group.sampleCount) ?? 0;
  const sourceName = shouldRealignSample ? generatedSampleSourceName(group, replicateIndex) : row.sourceName;
  return {
    ...row,
    sourceName,
    biologicalSampleId: shouldRealignSample ? sourceName : row.biologicalSampleId,
    sampleGroup: groupName,
    biologicalReplicate: replicate || row.biologicalReplicate,
    metadata: {
      ...Object.fromEntries(Object.entries(group.metadata).map(([key, value]) => [key, cleanOneLineString(value)])),
      ...row.metadata,
    },
    factorValues: {
      ...sampleDraftFactorValues(group),
      ...row.factorValues,
    },
    label: row.label || row.channel || inferSampleDraftGroupLabel(group, row.dataFile),
  };
}

function bestSampleDraftGroupForRawFile(rawFile: string, groups: SampleDesignGroup[]): SampleDesignGroup | undefined {
  if (groups.length === 1) return groups[0];
  const ranked = groups
    .map((group, index) => ({ group, index, score: sampleDraftGroupRawFileScore(group, rawFile) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  if (!ranked[0] || ranked[0].score <= 0) return undefined;
  if (ranked[1] && ranked[1].score === ranked[0].score) return undefined;
  return ranked[0].group;
}

function sampleDraftGroupRawFileScore(group: SampleDesignGroup, rawFile: string): number {
  const groupTokens = blueprintMatchTokens([
    group.groupName,
    group.namingPrefix,
    ...Object.values(group.metadata),
    ...Object.values(sampleDraftFactorValues(group)),
    ...Object.values(group.assayContext ?? {}).flatMap((value) => blueprintContextValueList(value)),
  ].filter((value): value is string => typeof value === "string"));
  if (!groupTokens.length) return 0;
  const fileTokens = new Set(blueprintMatchTokens([rawFile]));
  const compactRawFile = normalizedAxisName(rawFile);
  let score = 0;
  for (const token of groupTokens) {
    if (fileTokens.has(token)) score += token.length >= 4 ? 3 : 1;
    else if (token.length >= 3 && compactRawFile.includes(token)) score += 1;
  }
  return score;
}

function inferRawFileBiologicalReplicate(rawFile: string): string {
  const match = cleanOneLineString(rawFile).match(/(?:^|[^a-z0-9])(?:bio)?rep(?:licate)?[_-]?(\d+[a-z]?)(?=$|[^a-z0-9])/i);
  return match?.[1]?.replace(/^0+(?=\d)/, "") ?? "";
}

function rawFileReplicateIndex(replicate: string, sampleCount: number): number | null {
  const replicateNumber = Number.parseInt(replicate, 10);
  if (!Number.isFinite(replicateNumber) || replicateNumber < 1 || replicateNumber > sampleCount) return null;
  return replicateNumber - 1;
}

function inferRawFileFractionId(rawFile: string): string {
  const clean = cleanOneLineString(rawFile);
  const match = clean.match(/(?:^|[^a-z0-9])(fr|ft|ph|fraction|slice)[_-]?(\d+[a-z]?)(?=$|[^a-z0-9])/i);
  if (!match) return "";
  const normalizedPrefix = match[1].toLowerCase();
  const prefix = normalizedPrefix === "ph"
    ? "pH"
    : normalizedPrefix === "fr"
      ? "Fr"
      : normalizedPrefix === "ft"
        ? "FT"
        : normalizedPrefix === "slice"
          ? "Slice"
          : "Fraction";
  return `${prefix}${match[2]}`;
}

function inferRawFilePreparation(rawFile: string, group: SampleDesignGroup): string {
  const contextValues = Object.entries(group.assayContext ?? {})
    .filter(([key]) => /(workflow|preparation|enrichment|fractionation|assay)/i.test(key) && !/count|boolean|enabled/i.test(key))
    .flatMap(([, value]) => blueprintContextValueList(value));
  const rawTokens = new Set(blueprintMatchTokens([rawFile]));
  const compactRawFile = normalizedAxisName(rawFile);
  return contextValues.find((value) => (
    blueprintMatchTokens([value]).some((token) => rawTokens.has(token) || (token.length >= 2 && compactRawFile.includes(token)))
  )) ?? "";
}

function inferSampleDraftGroupLabel(group: SampleDesignGroup, rawFile = ""): string {
  const context = group.assayContext ?? {};
  const labelValues = sampleAssayContextValues(context, (key) => /(label|tag|channel)/.test(key) && !/(count|number)/.test(key));
  const explicit = labelValues.find((value) => isMeaningfulBlueprintValue(value) && value.toLowerCase() !== "true" && value.toLowerCase() !== "false");
  if (explicit) return explicit;
  const contextText = Object.entries(context)
    .map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(" ") : String(value)}`)
    .join(" ");
  if (/(?:label[_\s-]?free|labelfree|unlabeled|unlabelled)/i.test(`${contextText} ${rawFile}`)) return "label free sample";
  return "";
}

function sanitizeAiCoreMappingRow(
  record: Record<string, unknown>,
  index: number,
  generatedSampleGroupByName: Map<string, SampleDesignGroup>,
): CoreMappingRow | null {
  const sourceName = firstRecordString(record, ["source_name", "sourceName", "source", "sample", "sample_name", "sampleName"]);
  const dataFile = firstRecordString(record, ["data_file", "dataFile", "raw_file", "rawFile", "rawfile", "file_name", "fileName", "filename", "comment[data file]", "comment_data_file"]);
  if (!sourceName && !dataFile) return null;
  const group = sourceName ? generatedSampleGroupByName.get(sourceName.toLowerCase()) : undefined;
  const sampleGroup = firstRecordString(record, ["sample_group", "sampleGroup", "group_name", "groupName", "biological_condition", "biologicalCondition", "condition"])
    || group?.groupName
    || "Sample group";
  const biologicalSampleId = firstRecordString(record, ["biological_sample_id", "biologicalSampleId", "sample_id", "sampleId"])
    || sourceName
    || `sample-${index + 1}`;
  const metadata = {
    ...(group?.metadata ?? {}),
    ...sanitizeCoreMappingMetadata(record.metadata),
  };
  const factorValues = {
    ...(group ? sampleDraftFactorValues(group) : {}),
    ...sanitizeCoreMappingFactorValues(record.factor_values ?? record.factorValues),
  };
  const biologicalReplicate = firstRecordString(record, ["biological_replicate", "biologicalReplicate", "bio_replicate", "bioReplicate", "replicate_id", "replicateId", "replicate"])
    || String(index + 1);
  const preparation = firstRecordString(record, ["preparation", "fractionation", "fractionation_method", "fractionationMethod", "enrichment", "enrichment_process", "enrichmentProcess"]);
  const fractionId = firstRecordString(record, ["fraction_id", "fractionId", "fraction", "fraction_identifier", "fractionIdentifier"]);
  const technicalReplicate = firstRecordString(record, ["technical_replicate", "technicalReplicate", "tech_replicate", "techReplicate", "technical_replicate_id", "technicalReplicateId"]);
  const assayName = firstRecordString(record, ["assay_name", "assayName", "assay", "run", "run_name", "runName"]);
  return {
    rowId: firstRecordString(record, ["row_id", "rowId", "id"]) || `ai-core-row-${index + 1}`,
    sourceName: sourceName || biologicalSampleId,
    biologicalSampleId,
    sampleGroup,
    biologicalReplicate,
    metadata,
    factorValues,
    poolId: firstRecordString(record, ["pool_id", "poolId"]) || undefined,
    poolMembers: sanitizeStringList(record.pool_members ?? record.poolMembers),
    label: firstRecordString(record, ["label", "tag"]) || undefined,
    channel: firstRecordString(record, ["channel", "label_channel", "labelChannel"]) || undefined,
    preparation: preparation || undefined,
    fractionId: fractionId || undefined,
    technicalReplicate: technicalReplicate || undefined,
    assayName: assayName || undefined,
    acquisitionMethod: firstRecordString(record, ["acquisition_method", "acquisitionMethod"]) || undefined,
    dataFile: dataFile || undefined,
    fileUri: firstRecordString(record, ["file_uri", "fileUri"]) || undefined,
    evidenceRefs: sanitizeStringList(record.evidence_refs ?? record.evidenceRefs ?? record.sources),
    confidence: clampConfidence(record.confidence ?? 0.95),
    warnings: sanitizeStringList(record.warnings ?? record.warning),
  };
}

function fillMissingCoreMappingRawFiles(rows: CoreMappingRow[], importedRawFileNames: string[]): CoreMappingRow[] {
  const rawFileNames = uniqueBlueprintStrings(importedRawFileNames);
  if (!rawFileNames.length) return rows;
  const rowsMissingRawFile = rows.filter((row) => !isMeaningfulBlueprintValue(row.dataFile ?? ""));
  const rowsWithFilledRawFiles = rows.flatMap((row) => {
    if (isMeaningfulBlueprintValue(row.dataFile ?? "")) return [row];
    const candidates = rankedRawFileCandidates(row, rawFileNames);
    const fallbackCandidates = candidates.length
      ? candidates
      : rowsMissingRawFile.length === 1
        ? rawFileNames
        : [];
    if (!fallbackCandidates.length) return [row];
    return fallbackCandidates.map((dataFile, index) => ({
      ...row,
      rowId: `${row.rowId}-raw-${index + 1}`,
      dataFile,
      assayName: row.assayName || assayNameFromRawFile(dataFile),
      evidenceRefs: uniqueBlueprintStrings([...row.evidenceRefs, "import_raw_file_evidence"]),
      confidence: Math.min(row.confidence, candidates.length ? 0.85 : 0.7),
      warnings: uniqueBlueprintStrings([
        ...row.warnings,
        candidates.length
          ? "Raw file filled from imported PRIDE raw file evidence using token overlap with the AI mapping row."
          : "Raw file filled from imported PRIDE raw file evidence because this was the only AI mapping row missing a data file.",
      ]),
    }));
  });
  return rowsWithFilledRawFiles;
}

function appendUncoveredImportedRawFiles(rows: CoreMappingRow[], rawFileNames: string[]): CoreMappingRow[] {
  if (!rows.length) return rows;
  const coveredRawFiles = new Set(rows
    .map((row) => cleanOneLineString(row.dataFile).toLowerCase())
    .filter(Boolean));
  const uncoveredRawFiles = rawFileNames.filter((rawFile) => !coveredRawFiles.has(cleanOneLineString(rawFile).toLowerCase()));
  if (!uncoveredRawFiles.length) return rows;
  const templates = rows.filter((row) => isMeaningfulBlueprintValue(row.sourceName) || isMeaningfulBlueprintValue(row.sampleGroup));
  return [
    ...rows,
    ...uncoveredRawFiles.flatMap((rawFile, index) => {
      const template = bestCoreMappingTemplateForRawFile(rawFile, templates);
      if (!template) return [];
      return [{
        ...template,
        rowId: `${template.rowId}-imported-raw-${index + 1}`,
        assayName: assayNameFromRawFile(rawFile),
        dataFile: rawFile,
        fileUri: undefined,
        fractionId: rawFileSupportsBlueprintValue(rawFile, template.fractionId) ? template.fractionId : undefined,
        technicalReplicate: rawFileSupportsBlueprintValue(rawFile, template.technicalReplicate) ? template.technicalReplicate : undefined,
        confidence: Math.min(template.confidence, 0.65),
        evidenceRefs: uniqueBlueprintStrings([...template.evidenceRefs, "import_raw_file_evidence"]),
        warnings: uniqueBlueprintStrings([
          ...template.warnings,
          "Raw file was present in imported PRIDE raw file evidence but absent from AI mapping_rows; added for review without inferring missing file-specific attributes.",
        ]),
      }];
    }),
  ];
}

function bestCoreMappingTemplateForRawFile(rawFile: string, rows: CoreMappingRow[]): CoreMappingRow | undefined {
  if (!rows.length) return undefined;
  const ranked = rows
    .map((row, index) => ({ row, index, score: rawFileMatchScore(row, rawFile) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  if (ranked[0]?.score > 0) return ranked[0].row;
  const groupKeys = new Set(rows.map((row) => blueprintGroupLabel(row, row.factorValues)));
  return groupKeys.size <= 1 ? rows[0] : undefined;
}

function rawFileSupportsBlueprintValue(rawFile: string, value: string | undefined): boolean {
  const valueTokens = blueprintMatchTokens([value ?? ""]);
  if (!valueTokens.length) return false;
  const fileTokens = new Set(blueprintMatchTokens([rawFile]));
  return valueTokens.some((token) => fileTokens.has(token));
}

function rankedRawFileCandidates(row: CoreMappingRow, rawFileNames: string[]): string[] {
  return rawFileNames
    .map((rawFile) => ({ rawFile, score: rawFileMatchScore(row, rawFile) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.rawFile.localeCompare(right.rawFile, undefined, { numeric: true }))
    .map((item) => item.rawFile);
}

function rawFileMatchScore(row: CoreMappingRow, rawFile: string): number {
  const rowTokens = new Set(blueprintMatchTokens([
    row.sourceName,
    row.biologicalSampleId,
    row.sampleGroup,
    row.biologicalReplicate,
    row.preparation,
    row.fractionId,
    row.technicalReplicate,
    row.assayName,
    ...Object.values(row.factorValues),
    ...Object.values(row.metadata),
  ].filter((value): value is string => Boolean(value))));
  if (!rowTokens.size) return 0;
  const fileTokens = new Set(blueprintMatchTokens([rawFile]));
  let score = 0;
  for (const token of rowTokens) {
    if (fileTokens.has(token)) score += token.length >= 4 ? 2 : 1;
  }
  return score;
}

function blueprintMatchTokens(values: string[]): string[] {
  const ignored = new Set([
    "raw",
    "file",
    "sample",
    "group",
    "not",
    "available",
    "unknown",
    "rep",
    "bio",
    "tech",
    "technical",
    "biological",
    "fractionation",
    "enrichment",
    "phosphopeptide",
  ]);
  return uniqueBlueprintStrings(values.flatMap((value) => (
    cleanOneLineString(value)
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 2 && !ignored.has(token))
  )));
}

function assayNameFromRawFile(rawFile: string): string {
  return cleanOneLineString(rawFile).replace(/\.[^.]+$/, "") || rawFile;
}

function generatedSampleGroupLookup(draft: SampleDesignDraft): Map<string, SampleDesignGroup> {
  const lookup = new Map<string, SampleDesignGroup>();
  for (const group of draft.groups) {
    for (let index = 0; index < group.sampleCount; index += 1) {
      lookup.set(`${group.namingPrefix}_${String(index + 1).padStart(2, "0")}`.toLowerCase(), group);
    }
  }
  return lookup;
}

function rawRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecommendationRecord).filter((record): record is Record<string, unknown> => Boolean(record))
    : [];
}

function firstRecordString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const direct = cleanOneLineString(record[key]);
    if (direct) return direct;
  }
  const compactLookup = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    compactLookup.set(normalizedAxisName(key), value);
  }
  for (const key of keys) {
    const value = cleanOneLineString(compactLookup.get(normalizedAxisName(key)));
    if (value) return value;
  }
  return "";
}

function sanitizeCoreMappingMetadata(value: unknown): CoreMappingRow["metadata"] {
  const record = asRecommendationRecord(value);
  if (!record) return {};
  return Object.fromEntries(Object.entries(record)
    .map(([key, item]) => [key, cleanOneLineString(asRecommendationRecord(item)?.value ?? item)])
    .filter(([, item]) => Boolean(item))) as CoreMappingRow["metadata"];
}

function sanitizeCoreMappingFactorValues(value: unknown): Record<string, string> {
  const record = asRecommendationRecord(value);
  if (!record) return {};
  return Object.fromEntries(Object.entries(record)
    .map(([key, item]) => [cleanOneLineString(key), cleanOneLineString(asRecommendationRecord(item)?.value ?? item)])
    .filter(([key, item]) => Boolean(key && item)));
}

function buildBlueprintRelationshipGroups(map: CoreExperimentMap): BlueprintRelationshipGroup[] {
  return buildBlueprintRelationshipGroupsFromRows(map.rows);
}

function buildBlueprintRelationshipGroupsFromRows(rows: CoreMappingRow[], relationshipLayers: BlueprintRelationshipLayer[] = []): BlueprintRelationshipGroup[] {
  const groups = new Map<string, BlueprintRelationshipGroup>();
  for (const row of rows) {
    const factors = Object.fromEntries(Object.entries(row.factorValues).filter(([, value]) => cleanOneLineString(value)));
    const label = blueprintGroupLabel(row, factors);
    const key = Object.keys(factors).length
      ? Object.entries(factors).sort(([left], [right]) => left.localeCompare(right)).map(([field, value]) => `${field}:${value}`).join("|")
      : label;
    const id = `group-${slugId(key || label || "samples")}`;
    const group = groups.get(id) ?? {
      id,
      label,
      factors,
      samples: [],
      rows: [],
      biologicalReplicates: [],
      pools: [],
      poolMembers: [],
      labels: [],
      fractionations: [],
      acquisitionMethods: [],
      technicalReplicates: [],
      assays: [],
      rawFiles: [],
      relationshipLayers,
    };
    group.rows.push(row);
    const rowSamples = coreMappingRowSampleNames(row);
    group.samples = uniqueBlueprintStrings([...group.samples, ...rowSamples]);
    group.biologicalReplicates = uniqueBlueprintStrings([...group.biologicalReplicates, row.biologicalReplicate]);
    group.pools = uniqueBlueprintStrings([...group.pools, row.poolId ?? ""]);
    group.poolMembers = uniqueBlueprintStrings([...group.poolMembers, ...(row.poolMembers ?? [])]);
    group.labels = uniqueBlueprintStrings([...group.labels, row.label ?? row.channel ?? ""]);
    group.fractionations = uniqueBlueprintStrings([...group.fractionations, formatBlueprintFractionation(row)]);
    group.acquisitionMethods = uniqueBlueprintStrings([...group.acquisitionMethods, row.acquisitionMethod ?? ""]);
    group.technicalReplicates = uniqueBlueprintStrings([...group.technicalReplicates, row.technicalReplicate ?? ""]);
    group.assays = uniqueBlueprintStrings([...group.assays, displayBlueprintAssayName(row)]);
    group.rawFiles = uniqueBlueprintStrings([...group.rawFiles, row.dataFile ?? ""]);
    groups.set(id, group);
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
}

function coreMappingRowSampleNames(row: CoreMappingRow): string[] {
  const poolMembers = uniqueBlueprintStrings(row.poolMembers ?? []).filter(isMeaningfulBlueprintValue);
  if (poolMembers.length) return poolMembers;
  return uniqueBlueprintStrings([row.sourceName]).filter(isMeaningfulBlueprintValue);
}

function summarizeBlueprintRelationshipGroups(groups: BlueprintRelationshipGroup[]): { sampleCount: number; assayCount: number; rawFileCount: number } {
  return {
    sampleCount: new Set(groups.flatMap((group) => group.samples)).size,
    assayCount: new Set(groups.flatMap((group) => group.assays)).size,
    rawFileCount: new Set(groups.flatMap((group) => group.rawFiles)).size,
  };
}

function buildBlueprintRelationshipFacets(groups: BlueprintRelationshipGroup[]): BlueprintRelationshipFacet[] {
  const rows = groups.flatMap((group) => group.rows);
  if (!rows.length) return [];
  const allRelationshipsFacet: BlueprintRelationshipFacet = { id: "all-relationships", kind: "all", label: "All relationships", value: "all", rows };
  const groupFacets = groups.flatMap((group) => {
    if (!group.rows.length) return [];
    const groupFacetId = `group-${slugId(group.id)}`;
    const groupFacet: BlueprintRelationshipFacet = {
      id: groupFacetId,
      kind: "group",
      label: group.label,
      value: group.id,
      rows: group.rows,
      groupId: group.id,
      groupLabel: group.label,
    };
    const fractionFacets = buildBlueprintFacetGroup(
      group.rows,
      "fraction",
      (row) => cleanOneLineString(row.fractionId),
      (value) => `Fraction ${normalizeFractionDisplayValue(value)}`,
    ).map((facet) => ({
      ...facet,
      id: `${groupFacetId}-${facet.id}`,
      label: `${group.label} / ${facet.label}`,
      groupId: group.id,
      groupLabel: group.label,
    }));
    return [groupFacet, ...fractionFacets];
  });
  return [allRelationshipsFacet, ...groupFacets];
}

function defaultBlueprintRelationshipFacet(facets: BlueprintRelationshipFacet[]): BlueprintRelationshipFacet | undefined {
  return facets.find((facet) => facet.kind === "all") ?? facets[0];
}

function buildBlueprintFacetGroup(
  rows: CoreMappingRow[],
  kind: BlueprintRelationshipFacet["kind"],
  valueForRow: (row: CoreMappingRow) => string,
  labelForValue: (value: string, index: number) => string,
): BlueprintRelationshipFacet[] {
  const grouped = new Map<string, CoreMappingRow[]>();
  for (const row of rows) {
    const value = valueForRow(row);
    if (!isMeaningfulBlueprintValue(value)) continue;
    const key = value.toLowerCase();
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.entries()]
    .map(([key, groupRows]) => ({ key, value: valueForRow(groupRows[0]), rows: groupRows }))
    .sort((left, right) => compareBlueprintFacetValues(left.value, right.value))
    .map((item, index) => ({
      id: `${kind}-${slugId(item.value || item.key || String(index + 1))}`,
      kind,
      label: labelForValue(item.value, index),
      value: item.value,
      rows: item.rows,
    }));
}

function compareBlueprintFacetValues(left: string, right: string): number {
  const leftNumber = Number(normalizeFractionDisplayValue(left));
  const rightNumber = Number(normalizeFractionDisplayValue(right));
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) return leftNumber - rightNumber;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function normalizeFractionDisplayValue(value: string): string {
  const clean = cleanOneLineString(value);
  const match = /(?:fraction|frac|fr|ft|slice|ph)?\s*0*([0-9]+[a-z]?)/i.exec(clean);
  return match?.[1] ?? clean;
}

function filterBlueprintRelationshipGroupsByFacet(
  groups: BlueprintRelationshipGroup[],
  facet?: BlueprintRelationshipFacet,
): BlueprintRelationshipGroup[] {
  if (!facet || facet.kind === "all") return groups;
  const rowIds = new Set(facet.rows.map((row) => row.rowId));
  return groups
    .map((group) => blueprintRelationshipGroupWithRows(group, group.rows.filter((row) => rowIds.has(row.rowId))))
    .filter((group) => group.rows.length > 0);
}

function blueprintRelationshipGroupWithRows(group: BlueprintRelationshipGroup, rows: CoreMappingRow[]): BlueprintRelationshipGroup {
  return {
    ...group,
    rows,
    biologicalReplicates: uniqueBlueprintStrings(rows.map((row) => row.biologicalReplicate)),
    pools: uniqueBlueprintStrings(rows.map((row) => row.poolId ?? "")),
    poolMembers: uniqueBlueprintStrings(rows.flatMap((row) => row.poolMembers ?? [])),
    labels: uniqueBlueprintStrings(rows.map((row) => row.label ?? row.channel ?? "")),
    fractionations: uniqueBlueprintStrings(rows.map(formatBlueprintFractionation)),
    acquisitionMethods: uniqueBlueprintStrings(rows.map((row) => row.acquisitionMethod ?? "")),
    technicalReplicates: uniqueBlueprintStrings(rows.map((row) => row.technicalReplicate ?? "")),
    assays: uniqueBlueprintStrings(rows.map(displayBlueprintAssayName)),
    rawFiles: uniqueBlueprintStrings(rows.map((row) => row.dataFile ?? "")),
  };
}

function sampleDraftFactorValues(group: SampleDesignGroup): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of resolveSampleFactorKeys(group)) {
    const field = getSampleFieldByKey(key);
    const label = field ? sampleFactorLabelFromField(field) : key;
    const value = field ? sampleFieldCellValue(field, group.metadata) : cleanOneLineString(group.metadata[key]);
    if (value) values[label] = value;
  }
  return values;
}

function sampleAssayContextValues(context: SampleAssayContext, matches: (normalizedKey: string) => boolean): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!matches(normalizedKey)) continue;
    values.push(...blueprintContextValueList(value));
  }
  return uniqueBlueprintStrings(values);
}

function blueprintContextValueList(value: SampleAssayContext[string]): string[] {
  if (Array.isArray(value)) return value.map((item) => cleanOneLineString(item)).filter(Boolean);
  if (typeof value === "boolean") return [];
  const clean = cleanOneLineString(value);
  return clean ? [clean] : [];
}

function blueprintValueAt(values: string[], index: number): string {
  if (!values.length) return "";
  return values[Math.min(index, values.length - 1)] ?? "";
}

function extractBlueprintRawFileNames(analysis?: Awaited<ReturnType<typeof api.getAnalysis>>): string[] {
  const names: string[] = [];
  for (const evidence of analysis?.evidences ?? []) {
    const payload = asRecommendationRecord(evidence.payload);
    if (!payload) continue;
    const rawSummary = asRecommendationRecord(payload.raw_file_summary ?? payload.rawFileSummary);
    if (rawSummary) {
      names.push(...sanitizeStringList(rawSummary.raw_file_names ?? rawSummary.rawFileNames));
      names.push(...sanitizeStringList(rawSummary.raw_file_examples ?? rawSummary.rawFileExamples));
      for (const record of rawSummaryRecords(rawSummary.parsed_files_preview ?? rawSummary.parsedFilesPreview)) {
        names.push(cleanOneLineString(record.filename ?? record.file_name ?? record.fileName ?? record.name));
      }
    }
    const bundle = asRecommendationRecord(payload.sample_evidence_bundle ?? payload.sampleEvidenceBundle);
    const bundleRawSummary = asRecommendationRecord(bundle?.raw_file_summary ?? bundle?.rawFileSummary);
    if (bundleRawSummary) {
      names.push(...sanitizeStringList(bundleRawSummary.raw_file_names ?? bundleRawSummary.rawFileNames));
      names.push(...sanitizeStringList(bundleRawSummary.raw_file_examples ?? bundleRawSummary.rawFileExamples));
    }
  }
  return uniqueBlueprintStrings(names);
}

function buildSampleRelationshipGraph(groups: BlueprintRelationshipGroup[]): BlueprintGraphData {
  const nodes = new Map<string, BlueprintGraphData["nodes"][number]>();
  const edges = new Map<string, BlueprintGraphData["edges"][number]>();
  const addNode = (id: string, label: string, layer: string, kind = layer) => {
    if (!nodes.has(id)) nodes.set(id, { id, label, layer, kind });
  };
  const addEdge = (sourceId: string, targetId: string, color?: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const id = `edge-${sourceId}-${targetId}`;
    if (!edges.has(id)) edges.set(id, { id, source_id: sourceId, target_id: targetId, confidence: 0.95, status: "confirmed", color });
  };

  for (const [groupIndex, group] of groups.entries()) {
    const groupColor = BLUEPRINT_GROUP_EDGE_COLORS[groupIndex % BLUEPRINT_GROUP_EDGE_COLORS.length];
    addNode(group.id, group.label, "group", "group");
    for (const row of group.rows) {
      const rowSamples = coreMappingRowSampleNames(row).filter(isMeaningfulBlueprintValue);
      const sampleNames = rowSamples.length ? rowSamples : [row.sourceName].filter(isMeaningfulBlueprintValue);
      const sampleIds = sampleNames.map((sampleName) => {
        const sampleId = `${group.id}-sample-${slugId(sampleName)}`;
        addNode(sampleId, sampleName, "sample", "sample");
        addEdge(group.id, sampleId, groupColor);
        return sampleId;
      });
      const anchors = sampleIds.length ? sampleIds : [group.id];
      const relationshipNodeIds: string[] = [];
      for (const [layerIndex, layer] of blueprintLayerSpecsForGroup(group).entries()) {
        const value = blueprintRelationshipLayerValue(row, layer);
        if (!isMeaningfulBlueprintValue(value)) continue;
        const kind = blueprintRelationshipLayerKind(layer);
        const nodeId = `${group.id}-${slugId(kind)}-${slugId(layer.field)}-${slugId(value)}`;
        addNode(nodeId, value, `dynamic_${layerIndex + 1}`, kind);
        relationshipNodeIds.push(nodeId);
      }
      if (relationshipNodeIds.length) {
        anchors.forEach((anchorId) => addEdge(anchorId, relationshipNodeIds[0], groupColor));
      }
      for (let index = 0; index < relationshipNodeIds.length - 1; index += 1) {
        addEdge(relationshipNodeIds[index], relationshipNodeIds[index + 1], groupColor);
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

const BLUEPRINT_GROUP_EDGE_COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#be185d", "#4f46e5"];

function blueprintLayerSpecsForGroup(group: BlueprintRelationshipGroup): BlueprintRelationshipLayer[] {
  if (group.relationshipLayers?.length) return group.relationshipLayers;
  const fallbackLayers = [
    { field: "biological_replicate", label: "Bio rep", role: "biological_replicate" },
    { field: "pool_id", label: "Pool", role: "aggregation" },
    { field: "label", label: "Label", role: "label_channel" },
    { field: "fractionation", label: "Fractionation", role: "preparation" },
    { field: "acquisition_method", label: "Acquisition", role: "acquisition_method" },
    { field: "technical_replicate", label: "Tech rep", role: "technical_replicate" },
    { field: "assay_name", label: "Assay", role: "assay" },
    { field: "data_file", label: "Raw file", role: "data_file" },
  ];
  return fallbackLayers.filter((layer) => group.rows.some((row) => isMeaningfulBlueprintValue(blueprintRelationshipLayerValue(row, layer))));
}

function blueprintRelationshipLayerValue(row: CoreMappingRow, layer: BlueprintRelationshipLayer): string {
  const field = normalizedAxisName(layer.field);
  const role = normalizedAxisName(layer.role);
  if (field === "sourcename" || field === "source") return row.sourceName;
  if (field === "biologicalsampleid" || field === "sampleid") return row.biologicalSampleId;
  if (field === "samplegroup" || role === "samplegroup") return row.sampleGroup;
  if (field === "biologicalreplicate" || field === "bioreplicate" || field === "replicateid" || role === "biologicalreplicate") return row.biologicalReplicate;
  if (field === "poolid" || role === "aggregation" || role === "pool") return formatBlueprintPool(row);
  if (field === "poolmembers") return sampleNameSummary(row.poolMembers ?? [], 4);
  if (field === "label" || field === "commentlabel" || role === "labelchannel") return row.label || row.channel || "";
  if (field === "channel" || field === "labelchannel") return row.channel || row.label || "";
  if (field === "preparation") return row.preparation ?? "";
  if (field === "fractionid" || field === "fractionidentifier") return row.fractionId ?? "";
  if (field === "fractionation" || role === "preparation") return formatBlueprintFractionation(row);
  if (field === "acquisitionmethod" || field === "proteomicsdataacquisitionmethod" || role === "acquisitionmethod") return row.acquisitionMethod ?? "";
  if (field === "technicalreplicate" || field === "techreplicate" || role === "technicalreplicate") return row.technicalReplicate ?? "";
  if (field === "assayname" || field === "assay" || role === "assay") return displayBlueprintAssayName(row);
  if (field === "datafile" || field === "rawfile" || role === "datafile") return row.dataFile ?? "";
  if (field === "fileuri") return row.fileUri ?? "";
  return cleanOneLineString(row.metadata[layer.field] ?? row.factorValues[layer.field] ?? row.metadata[field] ?? row.factorValues[field]);
}

function blueprintRelationshipLayerKind(layer: BlueprintRelationshipLayer): string {
  return normalizedAxisName(layer.role || layer.field).replace(/_/g, "-") || "relationship-layer";
}

function buildEditableBlueprintFromRelationshipGroups(groups: BlueprintRelationshipGroup[]): Blueprint {
  const nodes = new Map<string, BlueprintNode>();
  const edges = new Map<string, MappingEdge>();
  const addNode = (layer: BlueprintNode["layer"], label: string, payload: Record<string, unknown> = {}) => {
    const cleanLabel = cleanOneLineString(label);
    if (!isMeaningfulBlueprintValue(cleanLabel)) return "";
    const key = `${layer}:${cleanLabel.toLowerCase()}`;
    const existing = nodes.get(key);
    if (existing) return existing.id;
    const node: BlueprintNode = {
      id: createBlueprintId(`samples-ai-${layer}`, cleanLabel),
      layer,
      label: cleanLabel,
      payload: { source: "samples_ai_core_mapping", ...payload },
      confidence: 0.95,
      status: "confirmed",
    };
    nodes.set(key, node);
    return node.id;
  };
  const addEdge = (sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const key = `${sourceId}->${targetId}`;
    if (edges.has(key)) return;
    edges.set(key, {
      id: createBlueprintId("samples-ai-map", key),
      source_id: sourceId,
      target_id: targetId,
      relation: "maps_to",
      confidence: 0.95,
      status: "confirmed",
    });
  };

  for (const group of groups) {
    for (const row of group.rows) {
      const chain = [
        addNode("sample", row.sourceName, { sample_group: group.label, row_id: row.rowId, relationship_role: "source_name" }),
      ];
      for (const layer of blueprintLayerSpecsForGroup(group)) {
        const value = blueprintRelationshipLayerValue(row, layer);
        if (!isMeaningfulBlueprintValue(value)) continue;
        const role = blueprintRelationshipLayerKind(layer);
        const nodeLayer = editableBlueprintLayerForRelationship(layer);
        chain.push(addNode(nodeLayer, `${layer.label}: ${value}`, {
          sample_group: group.label,
          row_id: row.rowId,
          relationship_field: layer.field,
          relationship_role: role,
          relationship_reason: layer.reason,
        }));
      }
      for (let index = 0; index < chain.length - 1; index += 1) {
        addEdge(chain[index], chain[index + 1]);
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function editableBlueprintLayerForRelationship(layer: BlueprintRelationshipLayer): BlueprintNode["layer"] {
  const role = normalizedAxisName(layer.role || layer.field);
  const field = normalizedAxisName(layer.field);
  if (role === "datafile" || field === "datafile" || field === "rawfile" || field === "fileuri") return "file";
  if (role === "assay" || role === "acquisitionmethod" || role === "technicalreplicate" || field === "assayname") return "assay";
  if (role === "aggregation" || role === "pool" || role === "labelchannel" || role === "preparation" || field === "fractionid" || field === "fractionation") return "preparation";
  return "sample";
}

function formatBlueprintPool(row: CoreMappingRow): string {
  const poolId = cleanOneLineString(row.poolId);
  if (!isMeaningfulBlueprintValue(poolId)) return "";
  const members = uniqueBlueprintStrings(row.poolMembers ?? []).filter(isMeaningfulBlueprintValue);
  return members.length
    ? `Pool: ${poolId}\n${sampleNameSummary(members, 4)}`
    : `Pool: ${poolId}`;
}

function isMeaningfulBlueprintValue(value: string): boolean {
  const clean = cleanOneLineString(value);
  if (!clean) return false;
  const normalized = clean.toLowerCase();
  return normalized !== "not available" && normalized !== "n/a" && normalized !== "na" && normalized !== "none" && normalized !== "unknown";
}

function blueprintGroupLabel(row: CoreMappingRow, factors: Record<string, string>): string {
  const sampleGroup = cleanOneLineString(row.sampleGroup);
  if (sampleGroup && sampleGroup !== "not available" && sampleGroup !== "Sample group") return sampleGroup;
  const entries = Object.entries(factors).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length) return entries.map(([field, value]) => `${field}: ${value}`).join(" / ");
  return "Sample group";
}

function formatBlueprintFractionation(row: CoreMappingRow): string {
  const preparation = cleanOneLineString(row.preparation);
  const fractionId = cleanOneLineString(row.fractionId);
  if (preparation && fractionId) return `${preparation} (${fractionId})`;
  return preparation || fractionId;
}

function displayBlueprintAssayName(row: CoreMappingRow): string {
  const assayName = cleanOneLineString(row.assayName);
  const rawFileAssayName = assayNameFromRawFile(row.dataFile ?? "");
  if (!isMeaningfulBlueprintValue(assayName)) return rawFileAssayName;
  const normalizedAssayName = normalizedAxisName(assayName);
  const groupLevelNames = [
    row.sourceName,
    row.biologicalSampleId,
    row.sampleGroup,
    row.poolId,
  ].map((value) => normalizedAxisName(cleanOneLineString(value))).filter(Boolean);
  if (rawFileAssayName && groupLevelNames.includes(normalizedAssayName)) return rawFileAssayName;
  return assayName;
}

function uniqueBlueprintStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => cleanOneLineString(item)).filter(Boolean)));
}

function slugId(value: string): string {
  return cleanOneLineString(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

const BLUEPRINT_LAYERS: BlueprintNode["layer"][] = ["sample", "preparation", "assay", "file"];

function normalizeBlueprint(blueprint: Blueprint | undefined): Blueprint {
  const nodes = (blueprint?.nodes ?? [])
    .map((node) => ({
      id: cleanOneLineString(node.id) || createBlueprintId("node", node.label),
      layer: isBlueprintLayer(node.layer) ? node.layer : "sample",
      label: cleanOneLineString(node.label),
      payload: node.payload && typeof node.payload === "object" ? node.payload : {},
      confidence: clampConfidence(node.confidence),
      status: cleanOneLineString(node.status) || "suggested",
    }))
    .filter((node) => node.label);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (blueprint?.edges ?? [])
    .map((edge) => ({
      id: cleanOneLineString(edge.id) || createBlueprintId("edge", `${edge.source_id}-${edge.target_id}`),
      source_id: cleanOneLineString(edge.source_id),
      target_id: cleanOneLineString(edge.target_id),
      relation: cleanOneLineString(edge.relation) || "maps_to",
      confidence: clampConfidence(edge.confidence),
      status: cleanOneLineString(edge.status) || "suggested",
    }))
    .filter((edge) => nodeIds.has(edge.source_id) && nodeIds.has(edge.target_id) && edge.source_id !== edge.target_id);
  return { nodes, edges: dedupeBlueprintEdges(edges) };
}

function mergeBlueprints(current: Blueprint, source: Blueprint): Blueprint {
  const base = normalizeBlueprint(current);
  const incoming = normalizeBlueprint(source);
  const nodes = [...base.nodes];
  const idMap = new Map<string, string>();
  incoming.nodes.forEach((node) => {
    const duplicate = nodes.find((item) => item.id === node.id || blueprintNodeKey(item) === blueprintNodeKey(node));
    if (duplicate) {
      idMap.set(node.id, duplicate.id);
      return;
    }
    nodes.push(node);
    idMap.set(node.id, node.id);
  });
  const edges = [...base.edges];
  incoming.edges.forEach((edge) => {
    const sourceId = idMap.get(edge.source_id) ?? edge.source_id;
    const targetId = idMap.get(edge.target_id) ?? edge.target_id;
    if (!nodes.some((node) => node.id === sourceId) || !nodes.some((node) => node.id === targetId)) return;
    if (edgeExists(edges, sourceId, targetId)) return;
    const id = edges.some((item) => item.id === edge.id) ? createBlueprintId("edge", `${sourceId}-${targetId}`) : edge.id;
    edges.push({ ...edge, id, source_id: sourceId, target_id: targetId });
  });
  return normalizeBlueprint({ nodes, edges });
}

function createBlueprintNode(layer: BlueprintNode["layer"], label: string): BlueprintNode {
  return {
    id: createBlueprintId("manual", label),
    layer,
    label: cleanOneLineString(label),
    payload: { source: "manual" },
    confidence: 1,
    status: "confirmed",
  };
}

function createBlueprintEdge(sourceId: string, targetId: string, status = "confirmed", confidence = 1): MappingEdge {
  return {
    id: createBlueprintId("map", `${sourceId}-${targetId}`),
    source_id: sourceId,
    target_id: targetId,
    relation: "maps_to",
    confidence,
    status,
  };
}

function dedupeBlueprintEdges(edges: MappingEdge[]): MappingEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.source_id}->${edge.target_id}:${edge.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countNewBlueprintNodes(current: Blueprint, source: Blueprint): number {
  const currentKeys = new Set(normalizeBlueprint(current).nodes.map(blueprintNodeKey));
  return normalizeBlueprint(source).nodes.filter((node) => !currentKeys.has(blueprintNodeKey(node))).length;
}

function edgeExists(edges: MappingEdge[], sourceId: string, targetId: string) {
  return edges.some((edge) => edge.source_id === sourceId && edge.target_id === targetId);
}

function blueprintNodeKey(node: BlueprintNode) {
  return `${node.layer}:${node.label.trim().toLowerCase()}`;
}

function blueprintFingerprint(blueprint: Blueprint | undefined) {
  return JSON.stringify({
    nodes: (blueprint?.nodes ?? []).map((node) => `${node.id}:${node.layer}:${node.label}:${node.status}:${node.confidence}`),
    edges: (blueprint?.edges ?? []).map((edge) => `${edge.id}:${edge.source_id}:${edge.target_id}:${edge.status}:${edge.confidence}`),
  });
}

function previousBlueprintLayer(layer: BlueprintNode["layer"]): BlueprintNode["layer"] | null {
  const index = BLUEPRINT_LAYERS.indexOf(layer);
  return index > 0 ? BLUEPRINT_LAYERS[index - 1] : null;
}

function blueprintLayerLabel(layer: BlueprintNode["layer"]): string {
  return {
    sample: "Sample",
    preparation: "Preparation",
    assay: "Assay",
    file: "File",
  }[layer];
}

function isBlueprintLayer(value: unknown): value is BlueprintNode["layer"] {
  return value === "sample" || value === "preparation" || value === "assay" || value === "file";
}

function clampConfidence(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.max(0, Math.min(1, numeric));
}

function createBlueprintId(prefix: string, seed: string) {
  const slug = cleanOneLineString(seed).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "item";
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${slug}`;
}

const SAMPLE_CONTEXT_OPTIONS: Array<{ id: SampleContextMode; label: string; note: string }> = [
  { id: "sample-metadata", label: "Standard organism samples", note: "organism, organism part, disease and replicate metadata" },
  { id: "human", label: "Human donors", note: "adds human age, sex, individual and ancestry fields" },
  { id: "vertebrates", label: "Vertebrate model organism", note: "adds strain, sex, genotype and developmental stage" },
  { id: "invertebrates", label: "Invertebrate model organism", note: "adds strain, genotype and growth condition" },
  { id: "plants", label: "Plant samples", note: "adds genotype, growth condition and treatment context" },
  { id: "metaproteomics", label: "Metaproteomics/environmental", note: "uses environmental sample type instead of organism-only metadata" },
];

const ORGANISM_SAMPLE_CONTEXTS: SampleContextMode[] = ["sample-metadata", "human", "vertebrates", "invertebrates", "plants"];
const DEFAULT_SAMPLE_FACTOR_KEYS: SampleFactorKey[] = ["disease"];

const SAMPLE_METADATA_FIELDS: SampleMetadataField[] = [
  {
    key: "organism",
    label: "Organism",
    column: "characteristics[organism]",
    placeholder: "Homo sapiens",
    requirement: "required",
    contexts: ORGANISM_SAMPLE_CONTEXTS,
    ontology: true,
    ontologies: ["ncbitaxon"],
    hint: "NCBI Taxonomy label",
    description: "Species of your samples (e.g., Homo sapiens, Mus musculus)",
    searchPlaceholder: "Search for organism...",
    commonChoices: ["Homo sapiens", "Mus musculus", "Rattus norvegicus"],
    factorKey: "organism",
    factorColumn: "factor value[organism]",
  },
  {
    key: "organismPart",
    label: "Organism part",
    displayLabel: "Organism Part / Tissue",
    column: "characteristics[organism part]",
    placeholder: "plasma",
    requirement: "required",
    contexts: ORGANISM_SAMPLE_CONTEXTS,
    ontology: true,
    ontologies: ["uberon", "bto"],
    hint: "UBERON or BTO tissue/fluid term",
    description: "Tissue or body part (e.g., liver, blood plasma, whole organism)",
    searchPlaceholder: "Search for tissue/organ...",
    commonChoices: ["liver", "blood plasma", "whole organism", "not applicable", "not available"],
    factorKey: "organismPart",
    factorColumn: "factor value[organism part]",
  },
  {
    key: "disease",
    label: "Disease",
    column: "characteristics[disease]",
    placeholder: "normal",
    requirement: "recommended",
    contexts: ORGANISM_SAMPLE_CONTEXTS,
    ontology: true,
    ontologies: ["efo", "mondo", "doid"],
    hint: "Use normal for healthy controls",
    description: "Disease being studied or 'normal' for healthy samples",
    searchPlaceholder: "Search for disease or type 'normal'...",
    commonChoices: ["normal", "breast cancer", "colorectal cancer", "not applicable", "not available"],
    factorKey: "disease",
    factorColumn: "factor value[disease]",
  },
  {
    key: "cellType",
    label: "Cell type",
    column: "characteristics[cell type]",
    placeholder: "HeLa cell",
    requirement: "recommended",
    contexts: ORGANISM_SAMPLE_CONTEXTS,
    ontology: true,
    ontologies: ["cl", "bto"],
    hint: "CL, BTO or CLO term",
    description: "Cell type when the sample is cell-line, single-cell, or culture derived",
    searchPlaceholder: "Search for cell type...",
    commonChoices: ["T cell", "B cell", "macrophage", "HeLa cell"],
    factorKey: "cellType",
    factorColumn: "factor value[cell type]",
  },
  {
    key: "pooledSample",
    label: "Pooled sample",
    column: "characteristics[pooled sample]",
    placeholder: "not pooled",
    requirement: "recommended",
    inputType: "select",
    options: ["not pooled", "pooled"],
    hint: "Use not pooled unless one SDRF row represents multiple source samples",
  },
  { key: "sampleType", label: "Sample type", column: "characteristics[sample type]", placeholder: "tissue sample", requirement: "recommended" },
  { key: "materialType", label: "Material type", column: "characteristics[material type]", placeholder: "plasma", requirement: "recommended" },
  { key: "biosampleAccession", label: "Biosample accession", column: "characteristics[biosample accession]", placeholder: "SAMN...", requirement: "recommended" },
  { key: "age", label: "Age", column: "characteristics[age]", placeholder: "45Y", requirement: "context", contexts: ["human"] },
  {
    key: "sex",
    label: "Sex",
    column: "characteristics[sex]",
    placeholder: "female",
    requirement: "context",
    contexts: ["human", "vertebrates"],
    inputType: "select",
    options: ["", "female", "male", "not available", "not collected", "not applicable"],
  },
  { key: "individual", label: "Individual", column: "characteristics[individual]", placeholder: "donor-01", requirement: "recommended", contexts: ["human"] },
  { key: "ancestryCategory", label: "Ancestry category", column: "characteristics[ancestry category]", placeholder: "not provided", requirement: "recommended", contexts: ["human"] },
  {
    key: "developmentalStage",
    label: "Developmental stage",
    column: "characteristics[developmental stage]",
    placeholder: "adult",
    requirement: "context",
    contexts: ["human", "vertebrates", "invertebrates", "plants"],
  },
  { key: "strain", label: "Strain", column: "characteristics[strain]", placeholder: "C57BL/6J", requirement: "context", contexts: ["vertebrates", "invertebrates"] },
  { key: "genotype", label: "Genotype", column: "characteristics[genotype]", placeholder: "wild type", requirement: "context", contexts: ["vertebrates", "invertebrates", "plants"] },
  { key: "growthCondition", label: "Growth condition", column: "characteristics[growth condition]", placeholder: "standard condition", requirement: "context", contexts: ["invertebrates", "plants"] },
  {
    key: "compound",
    label: "Compound",
    column: "characteristics[compound]",
    placeholder: "EGF",
    requirement: "optional",
    ontology: true,
    ontologies: ["chebi", "ncit", "efo"],
    searchPlaceholder: "Search for compound...",
    commonChoices: ["EGF", "Nocodazole", "pervandate", "not available"],
    factorKey: "compound",
    factorColumn: "factor value[compound]",
  },
  {
    key: "treatment",
    label: "Treatment",
    column: "characteristics[treatment]",
    placeholder: "drug treated",
    requirement: "optional",
    factorKey: "treatment",
    factorColumn: "factor value[treatment]",
  },
  {
    key: "timePoint",
    label: "Time point",
    column: "characteristics[time point]",
    placeholder: "15 min",
    requirement: "optional",
    factorKey: "timePoint",
    factorColumn: "factor value[time point]",
  },
  { key: "bodyMassIndex", label: "Body mass index", column: "characteristics[body mass index]", placeholder: "24 kg/m2", requirement: "recommended", templateOnly: true },
  { key: "tumorStage", label: "Tumor stage", column: "characteristics[tumor stage]", placeholder: "stage II", requirement: "recommended", templateOnly: true },
  { key: "tumorGrade", label: "Tumor grade", column: "characteristics[tumor grade]", placeholder: "grade 2", requirement: "recommended", templateOnly: true },
  { key: "clinicalOutcome", label: "Clinical outcome", column: "characteristics[clinical outcome]", placeholder: "remission", requirement: "recommended", templateOnly: true },
  {
    key: "environmentalSampleType",
    label: "Environmental sample type",
    column: "characteristics[environmental sample type]",
    placeholder: "soil metaproteome",
    requirement: "required",
    contexts: ["metaproteomics"],
    factorKey: "environmentalSampleType",
    factorColumn: "factor value[environmental sample type]",
  },
  {
    key: "environmentalMedium",
    label: "Environmental medium",
    column: "characteristics[environmental medium]",
    placeholder: "soil",
    requirement: "recommended",
    contexts: ["metaproteomics"],
    factorKey: "environmentalMedium",
    factorColumn: "factor value[environmental medium]",
  },
  { key: "environmentalMaterial", label: "Environmental material", column: "characteristics[environmental material]", placeholder: "soil", requirement: "required", contexts: ["metaproteomics"], templateOnly: true },
  { key: "geographicLocation", label: "Geographic location", column: "characteristics[geographic location]", placeholder: "USA: California", requirement: "recommended", contexts: ["metaproteomics"] },
  { key: "samplingSite", label: "Sampling site", column: "characteristics[sampling site]", placeholder: "gut", requirement: "recommended", contexts: ["metaproteomics"], templateOnly: true },
  { key: "samplingDepth", label: "Sampling depth", column: "characteristics[sampling depth]", placeholder: "10 cm", requirement: "recommended", contexts: ["metaproteomics"], templateOnly: true },
  { key: "soilType", label: "Soil type", column: "characteristics[soil type]", placeholder: "rhizosphere soil", requirement: "recommended", contexts: ["metaproteomics"], templateOnly: true },
  { key: "waterBody", label: "Water body", column: "characteristics[water body]", placeholder: "lake", requirement: "recommended", contexts: ["metaproteomics"], templateOnly: true },
  { key: "cellLine", label: "Cell line", column: "characteristics[cell line]", placeholder: "HeLa", requirement: "required", templateOnly: true },
  { key: "cultureCondition", label: "Culture condition", column: "characteristics[culture condition]", placeholder: "standard culture", requirement: "recommended", templateOnly: true },
  { key: "hlaAllele", label: "HLA allele", column: "characteristics[hla allele]", placeholder: "HLA-A*02:01", requirement: "required", templateOnly: true },
  {
    key: "enrichmentProcess",
    label: "Enrichment process",
    column: "characteristics[enrichment process]",
    placeholder: "immunoprecipitation",
    requirement: "recommended",
    templateOnly: true,
    factorKey: "enrichmentProcess",
    factorColumn: "factor value[enrichment process]",
  },
  { key: "collectionDate", label: "Collection date", column: "characteristics[collection date]", placeholder: "2026-05-19", requirement: "recommended", contexts: ["metaproteomics"] },
  { key: "collectionMethod", label: "Collection method", column: "characteristics[collection method]", placeholder: "grab sample", requirement: "optional", contexts: ["metaproteomics"] },
  { key: "depth", label: "Depth", column: "characteristics[depth]", placeholder: "10 cm", requirement: "optional", contexts: ["metaproteomics"] },
  { key: "altitude", label: "Altitude", column: "characteristics[altitude]", placeholder: "20 m", requirement: "optional", contexts: ["metaproteomics"] },
  { key: "temperature", label: "Temperature", column: "characteristics[temperature]", placeholder: "22 degree Celsius", requirement: "optional", contexts: ["metaproteomics"] },
  { key: "ph", label: "pH", column: "characteristics[pH]", placeholder: "7.2", requirement: "optional", contexts: ["metaproteomics"] },
  { key: "storageConditions", label: "Storage conditions", column: "characteristics[storage conditions]", placeholder: "-80 degree Celsius", requirement: "optional", contexts: ["metaproteomics"] },
];

const SAMPLE_BASE_HEADERS = [
  "source name",
  "characteristics[organism]",
  "characteristics[organism part]",
  "characteristics[disease]",
  "characteristics[biological replicate]",
  "factor value[disease]",
];

const SAMPLE_TABLE_IDENTITY_HEADERS = [
  "source name",
  "characteristics[biological replicate]",
];

const SAMPLE_ONTOLOGY_TERMS: SampleOntologyTerm[] = [
  { field: "organism", label: "Homo sapiens", accession: "NCBITaxon:9606", ontology: "NCBITaxon" },
  { field: "organism", label: "Mus musculus", accession: "NCBITaxon:10090", ontology: "NCBITaxon" },
  { field: "organism", label: "Rattus norvegicus", accession: "NCBITaxon:10116", ontology: "NCBITaxon" },
  { field: "organism", label: "Plasmodium falciparum", accession: "NCBITaxon:5833", ontology: "NCBITaxon" },
  { field: "organism", label: "Arabidopsis thaliana", accession: "NCBITaxon:3702", ontology: "NCBITaxon" },
  { field: "organism", label: "Drosophila melanogaster", accession: "NCBITaxon:7227", ontology: "NCBITaxon" },
  { field: "organismPart", label: "plasma", accession: "UBERON:0001969", ontology: "UBERON" },
  { field: "organismPart", label: "blood", accession: "UBERON:0000178", ontology: "UBERON" },
  { field: "organismPart", label: "liver", accession: "UBERON:0002107", ontology: "UBERON" },
  { field: "organismPart", label: "blood plasma", accession: "UBERON:0001969", ontology: "UBERON" },
  { field: "organismPart", label: "whole organism", accession: "UBERON:0000468", ontology: "UBERON" },
  { field: "organismPart", label: "brain", accession: "UBERON:0000955", ontology: "UBERON" },
  { field: "organismPart", label: "heart", accession: "UBERON:0000948", ontology: "UBERON" },
  { field: "organismPart", label: "kidney", accession: "UBERON:0002113", ontology: "UBERON" },
  { field: "disease", label: "normal", accession: "PATO:0000461", ontology: "PATO" },
  { field: "disease", label: "malaria", accession: "MONDO:0005136", ontology: "MONDO" },
  { field: "disease", label: "cancer", accession: "MONDO:0004992", ontology: "MONDO" },
  { field: "disease", label: "breast cancer", accession: "MONDO:0007254", ontology: "MONDO" },
  { field: "disease", label: "colorectal cancer", accession: "MONDO:0005575", ontology: "MONDO" },
  { field: "disease", label: "liver disease", accession: "MONDO:0005154", ontology: "MONDO" },
  { field: "disease", label: "Alzheimer disease", accession: "MONDO:0004975", ontology: "MONDO" },
  { field: "cellType", label: "T cell", accession: "CL:0000084", ontology: "CL" },
  { field: "cellType", label: "B cell", accession: "CL:0000236", ontology: "CL" },
  { field: "cellType", label: "macrophage", accession: "CL:0000235", ontology: "CL" },
  { field: "cellType", label: "HeLa cell", accession: "CLO:0003684", ontology: "CLO" },
];

function createEmptySampleGroup(metadata: Partial<Record<SampleMetadataKey, string>> = {}): SampleDesignGroup {
  return {
    id: createBlueprintId("sample-group", metadata.disease || metadata.organism || "group"),
    groupName: "",
    sampleCount: 3,
    namingPrefix: "",
    metadata: { pooledSample: "not pooled", ...metadata },
    metadataEvidence: {},
    ontologyTerms: [],
    factorKeys: [...DEFAULT_SAMPLE_FACTOR_KEYS],
  };
}

function sanitizeSampleGroup(group: SampleDesignGroup): SampleDesignGroup | null {
  const groupName = cleanOneLineString(group.groupName);
  const sampleCount = Math.max(1, Math.min(200, Math.floor(Number(group.sampleCount) || 1)));
  const namingPrefix = cleanSamplePrefix(group.namingPrefix || groupName);
  if (!groupName || !namingPrefix) return null;
  const metadata = Object.fromEntries(
    Object.entries(group.metadata).map(([key, value]) => [key, cleanOneLineString(value)]).filter(([, value]) => value),
  ) as Partial<Record<SampleMetadataKey, string>>;
  const metadataEvidence = sanitizeSampleMetadataEvidenceMap(group.metadataEvidence, metadata);
  return {
    id: group.id || createBlueprintId("sample-group", groupName),
    groupName,
    sampleCount,
    namingPrefix,
    metadata: {
      ...metadata,
      pooledSample: normalizePooledSampleMode(metadata.pooledSample),
      pooledSampleMembers: cleanOneLineString(metadata.pooledSampleMembers),
    },
    metadataEvidence,
    ontologyTerms: dedupeSampleOntologyTerms(group.ontologyTerms ?? []),
    factorKeys: resolveSampleFactorKeys(group),
    assayContext: sanitizeAssayContext(group.assayContext),
    warnings: sanitizeStringList(group.warnings),
  };
}

function sanitizeSampleMetadataEvidenceMap(
  evidence: Partial<Record<SampleMetadataKey, SampleMetadataEvidence>> | undefined,
  metadata: Partial<Record<SampleMetadataKey, string>>,
): Partial<Record<SampleMetadataKey, SampleMetadataEvidence>> {
  const next: Partial<Record<SampleMetadataKey, SampleMetadataEvidence>> = {};
  Object.entries(evidence ?? {}).forEach(([fieldKey, item]) => {
    if (!item) return;
    const value = cleanOneLineString(metadata[fieldKey] ?? item.value);
    const reason = cleanEvidenceText(item.reason);
    const sources = sanitizeTemplateReasonSources(item.sources);
    if (!value || (!reason && !sources.length)) return;
    next[fieldKey] = {
      field: fieldKey,
      value,
      reason,
      sources,
      confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : undefined,
    };
  });
  return next;
}

function sanitizeAssayContext(value: unknown): SampleAssayContext {
  const record = asRecommendationRecord(value);
  if (!record) return {};
  const context: SampleAssayContext = {};
  Object.entries(record).forEach(([key, raw]) => {
    const cleanKey = cleanOneLineString(key);
    if (!cleanKey) return;
    if (Array.isArray(raw)) {
      const values = raw.map((item) => cleanOneLineString(item)).filter(Boolean);
      if (values.length) context[cleanKey] = values;
      return;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      context[cleanKey] = raw;
      return;
    }
    const valueString = cleanOneLineString(raw);
    if (valueString) context[cleanKey] = valueString;
  });
  return context;
}

function sanitizeStringList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map((item) => cleanOneLineString(item)).filter((item, index, list) => item && list.indexOf(item) === index);
}

function cleanSamplePrefix(value: string): string {
  return cleanOneLineString(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24);
}

function dedupeSampleOntologyTerms(terms: SampleOntologyTerm[]): SampleOntologyTerm[] {
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = `${term.field}:${term.accession}:${term.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function searchSampleOntologyTerms(query: string, field: SampleMetadataKey): SampleOntologyTerm[] {
  const normalized = query.trim().toLowerCase();
  const scoped = SAMPLE_ONTOLOGY_TERMS.filter((term) => term.field === field);
  if (!normalized) return scoped.slice(0, 5);
  return scoped.filter((term) => `${term.label} ${term.accession} ${term.ontology}`.toLowerCase().includes(normalized)).slice(0, 8);
}

function sampleOntologyTermFromLookupTerm(field: SampleMetadataField, term: OntologyLookupTerm): SampleOntologyTerm | null {
  const label = cleanOneLineString(term.label);
  const accession = cleanOneLineString(term.id);
  const ontology = cleanOneLineString(term.ontologyPrefix || accession.split(":", 1)[0]);
  if (!label || !accession) return null;
  return {
    field: field.key,
    label,
    accession,
    ontology: formatOntologyPrefix(ontology),
  };
}

function mergeSampleOntologyResults(
  field: SampleMetadataField,
  query: string,
  searchState?: SampleOntologySearchState | null,
): SampleOntologyTerm[] {
  const localResults = searchSampleOntologyTerms(query, field.key);
  const remoteResults = searchState?.field === field.key && searchState.query === cleanOneLineString(query)
    ? searchState.results
    : [];
  return dedupeSampleOntologyTerms([...remoteResults, ...localResults]).slice(0, 15);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function sampleMetadataSummary(metadata: Partial<Record<SampleMetadataKey, string>>): string {
  const pooled = normalizePooledSampleValue(metadata);
  const items = [
    metadata.organism,
    metadata.organismPart,
    metadata.disease,
    metadata.environmentalSampleType,
    metadata.cellType,
    metadata.strain,
    metadata.treatment,
    pooled === "not pooled" ? "" : pooled,
  ].filter(Boolean);
  return items.length ? items.join(" · ") : "No metadata yet";
}

type SdrfTemplateColumnEntry = UpstreamSdrfColumn & { sourceTemplate: string };

const UPSTREAM_TEMPLATE_REGISTRY = UPSTREAM_SDRF_TEMPLATES as Record<string, {
  version: string;
  extends: string | null;
  excludes: { templates?: readonly string[]; categories?: readonly string[]; columns?: readonly string[] };
  columns: readonly UpstreamSdrfColumn[];
}>;

const SAMPLE_METADATA_FIELDS_BY_COLUMN = new Map(SAMPLE_METADATA_FIELDS.map((field) => [field.column, field]));

function upstreamTemplateReferenceName(reference: string | null | undefined): string | null {
  return reference ? reference.split("@", 1)[0] : null;
}

function resolveTemplateColumnEntries(templateId: string, seen: string[] = []): SdrfTemplateColumnEntry[] {
  const template = UPSTREAM_TEMPLATE_REGISTRY[templateId];
  if (!template || seen.includes(templateId)) return [];
  const parentId = upstreamTemplateReferenceName(template.extends);
  const inherited = parentId ? resolveTemplateColumnEntries(parentId, [...seen, templateId]) : [];
  const merged = new Map<string, SdrfTemplateColumnEntry>();
  for (const column of inherited) merged.set(column.name, column);
  for (const column of template.columns) merged.set(column.name, { ...column, sourceTemplate: templateId });
  return Array.from(merged.values());
}

function templateLineage(templateId: string, seen: string[] = []): string[] {
  const template = UPSTREAM_TEMPLATE_REGISTRY[templateId];
  if (!template || seen.includes(templateId)) return [];
  const parentId = upstreamTemplateReferenceName(template.extends);
  return [...(parentId ? templateLineage(parentId, [...seen, templateId]) : []), templateId];
}

function sdrfColumnCategory(column: string): string | null {
  const match = column.match(/^([^\[]+)\[/);
  return match?.[1] ?? null;
}

function resolveTemplateStackColumnEntries(templateIds: readonly string[]): SdrfTemplateColumnEntry[] {
  const validIds = templateIds.filter((id, index, list) => Boolean(UPSTREAM_TEMPLATE_REGISTRY[id]) && list.indexOf(id) === index);
  const excludedTemplates = new Set<string>();
  const excludedCategories = new Set<string>();
  const excludedColumns = new Set<string>();
  for (const id of validIds) {
    for (const lineageId of templateLineage(id)) {
      const excludes = UPSTREAM_TEMPLATE_REGISTRY[lineageId]?.excludes;
      excludes?.templates?.forEach((template) => excludedTemplates.add(template));
      excludes?.categories?.forEach((category) => excludedCategories.add(category));
      excludes?.columns?.forEach((column) => excludedColumns.add(column));
    }
  }
  const merged = new Map<string, SdrfTemplateColumnEntry>();
  for (const id of validIds) {
    for (const entry of resolveTemplateColumnEntries(id)) {
      const category = sdrfColumnCategory(entry.name);
      if (excludedTemplates.has(entry.sourceTemplate)) continue;
      if (excludedColumns.has(entry.name)) continue;
      if (category && excludedCategories.has(category)) continue;
      merged.set(entry.name, entry);
    }
  }
  return Array.from(merged.values());
}

function sampleMetadataPropertyName(column: string): string {
  return column.match(/^characteristics\[(.+)\]$/)?.[1] ?? column;
}

function sampleMetadataKeyFromColumn(column: string): SampleMetadataKey {
  const words = sampleMetadataPropertyName(column)
    .replace(/pH/g, "ph")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  return words.map((word, index) => index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join("");
}

function sampleMetadataLabelFromColumn(column: string): string {
  return sampleMetadataPropertyName(column)
    .split(/\s+/)
    .map((word) => word.length <= 3 && word === word.toUpperCase() ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function sampleRequirementFromUpstream(requirement: UpstreamSdrfRequirement | undefined): SampleMetadataRequirement {
  return requirement === "required" ? "required" : requirement === "recommended" ? "recommended" : "optional";
}

function createSampleMetadataFieldFromColumnEntry(
  entry: SdrfTemplateColumnEntry,
  factorColumns: ReadonlyMap<string, string> = new Map(),
): SampleMetadataField | null {
  if (!entry.name.startsWith("characteristics[")) return null;
  if (entry.name === "characteristics[biological replicate]") return null;
  const override = SAMPLE_METADATA_FIELDS_BY_COLUMN.get(entry.name);
  const key = override?.key ?? sampleMetadataKeyFromColumn(entry.name);
  const values = entry.values?.filter(Boolean) ?? [];
  const examples = entry.examples?.filter(Boolean) ?? [];
  const factorColumn = factorColumns.get(sampleMetadataPropertyName(entry.name).toLowerCase());
  return {
    key,
    label: override?.label ?? sampleMetadataLabelFromColumn(entry.name),
    displayLabel: override?.displayLabel,
    column: entry.name,
    placeholder: override?.placeholder ?? examples[0] ?? values[0] ?? "not available",
    requirement: sampleRequirementFromUpstream(entry.requirement),
    ontology: override?.ontology ?? Boolean(entry.ontologies?.length),
    ontologies: override?.ontologies ?? entry.ontologies,
    inputType: override?.inputType ?? (values.length ? "select" : "text"),
    options: override?.options ?? (values.length ? ["", ...values] : undefined),
    hint: override?.hint ?? (entry.ontologies?.length ? entry.ontologies.join(", ").toUpperCase() : entry.ontology_accession),
    description: override?.description ?? entry.description,
    searchPlaceholder: override?.searchPlaceholder,
    commonChoices: override?.commonChoices ?? (examples.length ? examples.slice(0, 5) : values.slice(0, 5)),
    factorKey: override?.factorKey ?? (factorColumn ? key : undefined),
    factorColumn: override?.factorColumn ?? factorColumn,
  };
}

function sampleMetadataFieldsFromColumnEntries(entries: SdrfTemplateColumnEntry[]): SampleMetadataField[] {
  const factorColumns = new Map<string, string>();
  for (const entry of entries) {
    const match = entry.name.match(/^factor value\[(.+)\]$/);
    if (match) factorColumns.set(match[1].toLowerCase(), entry.name);
  }
  return entries
    .map((entry) => createSampleMetadataFieldFromColumnEntry(entry, factorColumns))
    .filter((field): field is SampleMetadataField => Boolean(field));
}

function getAllKnownSampleMetadataFields(): SampleMetadataField[] {
  const merged = new Map<string, SdrfTemplateColumnEntry>();
  for (const templateId of Object.keys(UPSTREAM_TEMPLATE_REGISTRY)) {
    for (const entry of resolveTemplateColumnEntries(templateId)) merged.set(entry.name, entry);
  }
  return mergeSampleMetadataFields([...sampleMetadataFieldsFromColumnEntries(Array.from(merged.values())), ...SAMPLE_METADATA_FIELDS]);
}

function inferSampleContextFromTemplates(ids: SdrfTemplateId[] | undefined): SampleContextMode {
  if (!ids?.length) return "sample-metadata";
  if (ids.some((id) => id === "metaproteomics" || id === "human-gut" || id === "soil" || id === "water")) return "metaproteomics";
  if (ids.includes("human")) return "human";
  if (ids.includes("vertebrates")) return "vertebrates";
  if (ids.includes("invertebrates")) return "invertebrates";
  if (ids.includes("plants")) return "plants";
  return "sample-metadata";
}

function getSampleMetadataFieldsForContext(context: SampleContextMode): SampleMetadataField[] {
  const templateId = context === "sample-metadata" ? "sample-metadata" : context;
  const localFields = SAMPLE_METADATA_FIELDS.filter((field) => !field.templateOnly && (!field.contexts || field.contexts.includes(context)));
  return mergeSampleMetadataFields([...sampleMetadataFieldsFromColumnEntries(resolveTemplateStackColumnEntries([templateId])), ...localFields]);
}

function getSampleMetadataFieldsForTemplates(ids: SdrfTemplateId[]): SampleMetadataField[] {
  return sampleMetadataFieldsFromColumnEntries(resolveTemplateStackColumnEntries(sanitizeTemplateIds(ids)));
}

function getSampleFactorFields(context: SampleContextMode): SampleMetadataField[] {
  return getSampleMetadataFieldsForContext(context).filter((field) => field.factorKey && field.factorColumn);
}

function getSampleFieldByKey(key: SampleMetadataKey): SampleMetadataField | undefined {
  return getAllKnownSampleMetadataFields().find((field) => field.key === key);
}

function resolveSampleFactorKeys(group: Pick<SampleDesignGroup, "metadata"> & { factorKeys?: SampleFactorKey[] }): SampleFactorKey[] {
  const configured = group.factorKeys === undefined ? DEFAULT_SAMPLE_FACTOR_KEYS : group.factorKeys;
  const supported = new Set(getAllKnownSampleMetadataFields().filter((field) => field.factorKey).map((field) => field.factorKey as SampleFactorKey));
  const deduped = configured.filter((key, index, list) => supported.has(key) && list.indexOf(key) === index);
  if (cleanOneLineString(group.metadata.treatment) && !deduped.includes("treatment")) deduped.push("treatment");
  return deduped;
}

function normalizePooledSampleMode(value: unknown): string {
  const mode = cleanOneLineString(value).toLowerCase();
  return mode === "pooled" ? "pooled" : "not pooled";
}

function normalizePooledMemberList(value: unknown): string[] {
  return cleanOneLineString(value)
    .split(/[|,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePooledSampleValue(metadata: Partial<Record<SampleMetadataKey, string>>): string {
  if (normalizePooledSampleMode(metadata.pooledSample) !== "pooled") return "not pooled";
  const members = normalizePooledMemberList(metadata.pooledSampleMembers);
  return members.length ? `SN=${members.join("|")}` : "pooled";
}

function sampleFieldCellValue(field: SampleMetadataField, metadata: Partial<Record<SampleMetadataKey, string>>): string {
  if (field.key === "pooledSample") return normalizePooledSampleValue(metadata);
  return cleanOneLineString(metadata[field.key]);
}

function getSampleOntologyTermForValue(field: SampleMetadataField, value: string, terms: SampleOntologyTerm[]): SampleOntologyTerm | undefined {
  const normalized = cleanOneLineString(value).toLowerCase();
  if (!field.ontology || !normalized) return undefined;
  return terms.find((term) => term.field === field.key && term.label.toLowerCase() === normalized);
}

function lookupSampleOntologyTermForValue(field: SampleMetadataField, value: string, terms: SampleOntologyTerm[]): SampleOntologyTerm | undefined {
  const normalized = cleanOneLineString(value).toLowerCase();
  if (!field.ontology || !normalized) return undefined;
  return getSampleOntologyTermForValue(field, value, terms)
    ?? SAMPLE_ONTOLOGY_TERMS.find((term) => term.field === field.key && term.label.toLowerCase() === normalized);
}

function sampleFieldDisplayLabel(field: Pick<SampleMetadataField, "displayLabel" | "label">): string {
  return field.displayLabel ?? field.label;
}

function isMissingLikeSampleValue(value: unknown): boolean {
  const normalized = cleanOneLineString(value).toLowerCase();
  return !normalized
    || normalized === "not available"
    || normalized === "not applicable"
    || normalized === "not collected"
    || normalized === "n/a"
    || normalized === "na"
    || normalized === "none"
    || normalized === "unknown";
}

function sampleFieldDescription(field: SampleMetadataField): string {
  return field.description ?? field.hint ?? `Enter ${sampleFieldDisplayLabel(field).toLowerCase()} metadata.`;
}

function sampleFactorLabelFromField(field: Pick<SampleMetadataField, "factorColumn" | "key" | "label">): string {
  const factorLabel = field.factorColumn?.match(/^factor value\[(.+)\]$/)?.[1];
  if (factorLabel) return factorLabel;
  return cleanOneLineString(field.label || field.key).toLowerCase();
}

function sampleFactorValueColumnFromLabel(label: string): string {
  return `factor value[${cleanOneLineString(label)}]`;
}

function createEmptySdrfTable(projectId: string): Awaited<ReturnType<typeof api.getSdrfTable>> {
  const headers = [...SAMPLE_BASE_HEADERS];
  return {
    id: null,
    project_id: projectId,
    headers,
    rows: [],
    column_metadata: Object.fromEntries(headers.map((header) => [header, classifySdrfColumn(header, [])])),
    dirty: false,
    validation_state: {},
  };
}

function mergeSampleAssignmentsIntoTable(
  table: Awaited<ReturnType<typeof api.getSdrfTable>>,
  roster: SampleRosterItem[],
  fields: SampleFieldDescriptor[],
  assignmentsByField: Record<string, SampleAssignment[]>,
  factorSelections: SampleFactorSelection[],
): Awaited<ReturnType<typeof api.getSdrfTable>> {
  const assignedFieldKeys = new Set(
    Object.entries(assignmentsByField)
      .filter(([, assignments]) => assignments.some((assignment) => cleanOneLineString(assignment.value) && assignment.sampleIds.length))
      .map(([fieldKey]) => fieldKey),
  );
  const assignedFieldColumns = fields
    .filter((field) => assignedFieldKeys.has(field.key))
    .map((field) => field.column);
  const factorHeaders = factorSelections
    .filter((selection) => selection.enabled && cleanOneLineString(selection.label))
    .map((selection) => sampleFactorValueColumnFromLabel(selection.label));
  const headers = Array.from(new Set([...table.headers, ...SAMPLE_BASE_HEADERS, ...assignedFieldColumns, ...factorHeaders]));
  const generatedRows = buildSampleRowsFromAssignments({ roster, fields, assignmentsByField, factorSelections })
    .map((row) => Object.fromEntries(headers.map((header) => [header, row[header] ?? ""])));
  const generatedSources = new Set(generatedRows.map((row) => row["source name"]));
  const preservedRows = table.rows
    .filter((row) => !generatedSources.has(row["source name"]))
    .map((row) => Object.fromEntries(headers.map((header) => [header, row[header] ?? ""])));
  return {
    ...table,
    headers,
    rows: [...preservedRows, ...generatedRows],
    column_metadata: Object.fromEntries(headers.map((header) => [header, classifySdrfColumn(header, [])])),
    dirty: true,
  };
}

function buildAppliedSampleTableHeaders(
  fields: SampleFieldDescriptor[],
  assignmentsByField: Record<string, SampleAssignment[]>,
  factorSelections: SampleFactorSelection[],
): string[] | undefined {
  const assignedFieldKeys = new Set(
    Object.entries(assignmentsByField)
      .filter(([, assignments]) => assignments.some((assignment) => cleanOneLineString(assignment.value) && assignment.sampleIds.length))
      .map(([fieldKey]) => fieldKey),
  );
  const assignedFieldColumns = fields
    .filter((field) => assignedFieldKeys.has(field.key))
    .map((field) => field.column);
  const factorHeaders = factorSelections
    .filter((selection) => selection.enabled && cleanOneLineString(selection.label))
    .map((selection) => sampleFactorValueColumnFromLabel(selection.label));
  if (!assignedFieldColumns.length && !factorHeaders.length) return undefined;
  return Array.from(new Set([...SAMPLE_TABLE_IDENTITY_HEADERS, ...assignedFieldColumns, ...factorHeaders]));
}

function buildSampleAttributePreviewTable(
  projectId: string,
  roster: SampleRosterItem[],
  fields: SampleFieldDescriptor[],
  assignmentsByField: Record<string, SampleAssignment[]>,
  factorSelections: SampleFactorSelection[],
): SdrfTable {
  const normalizedRoster = roster.map((sample, index) => ({
    ...sample,
    sourceName: cleanOneLineString(sample.sourceName) || `sample_${String(index + 1).padStart(2, "0")}`,
  }));
  const headers = buildAppliedSampleTableHeaders(fields, assignmentsByField, factorSelections) ?? [...SAMPLE_TABLE_IDENTITY_HEADERS];
  const rows = buildSampleRowsFromAssignments({
    roster: normalizedRoster,
    fields,
    assignmentsByField,
    factorSelections,
  }).map((row) => Object.fromEntries(headers.map((header) => [header, row[header] ?? ""])));
  return {
    id: null,
    project_id: projectId,
    headers,
    rows,
    column_metadata: Object.fromEntries(headers.map((header) => [header, classifySdrfColumn(header, [])])),
    dirty: true,
    validation_state: {},
  };
}

function mergeSampleDraftIntoTable(
  table: Awaited<ReturnType<typeof api.getSdrfTable>>,
  draft: SampleDesignDraft,
): Awaited<ReturnType<typeof api.getSdrfTable>> {
  const groups = draft.groups.map(sanitizeSampleGroup).filter((group): group is SampleDesignGroup => Boolean(group));
  const metadataHeaders = getAllKnownSampleMetadataFields()
    .filter((field) => groups.some((group) => sampleFieldCellValue(field, group.metadata)))
    .map((field) => field.column);
  const factorHeaders = groups.flatMap((group) => resolveSampleFactorKeys(group).map((key) => getSampleFieldByKey(key)?.factorColumn).filter((column): column is string => Boolean(column)));
  const headers = Array.from(new Set([...table.headers, ...SAMPLE_BASE_HEADERS, ...metadataHeaders, ...factorHeaders]));
  const generatedRows = buildSampleRows(groups, headers);
  const generatedSources = new Set(generatedRows.map((row) => row["source name"]));
  const preservedRows = table.rows
    .filter((row) => !generatedSources.has(row["source name"]))
    .map((row) => Object.fromEntries(headers.map((header) => [header, row[header] ?? ""])));
  return {
    ...table,
    headers,
    rows: [...preservedRows, ...generatedRows],
    column_metadata: Object.fromEntries(headers.map((header) => [header, classifySdrfColumn(header, [])])),
    dirty: true,
  };
}

function buildSampleRows(groups: SampleDesignGroup[], headers: string[]): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  for (const group of groups) {
    const pooledSampleValue = normalizePooledSampleValue(group.metadata);
    for (let index = 1; index <= group.sampleCount; index += 1) {
      const row = Object.fromEntries(headers.map((header) => [header, ""]));
      row["source name"] = `${group.namingPrefix}_${String(index).padStart(2, "0")}`.toLowerCase();
      row["characteristics[biological replicate]"] = pooledSampleValue === "not pooled" ? String(index) : "pooled";
      for (const field of getAllKnownSampleMetadataFields()) {
        const value = sampleFieldCellValue(field, group.metadata);
        if (value && headers.includes(field.column)) row[field.column] = value;
      }
      for (const key of resolveSampleFactorKeys(group)) {
        const field = getSampleFieldByKey(key);
        if (!field?.factorColumn || !headers.includes(field.factorColumn)) continue;
        const value = sampleFieldCellValue(field, group.metadata);
        if (value) row[field.factorColumn] = value;
      }
      rows.push(row);
    }
  }
  return rows;
}

function sampleDraftToJson(draft: SampleDesignDraft): Record<string, unknown> {
  const raw = draft.rawJson ?? {};
  const mappingRows = draft.mappingRows?.length
    ? draft.mappingRows
    : rawRecordList(raw.mapping_rows ?? raw.mappingRows);
  const biologicalSamples = draft.biologicalSamples?.length
    ? draft.biologicalSamples.map((sample) => ({
      source_name: sample.sourceName,
      biological_sample_id: sample.biologicalSampleId,
      sample_group: sample.sampleGroup,
      biological_replicate: sample.biologicalReplicate,
      pool_id: sample.poolId,
      metadata: Object.fromEntries(Object.entries(sample.metadata).map(([key, value]) => {
        const evidence = sample.metadataEvidence?.[key];
        return [key, {
          value,
          reason: evidence?.reason ?? "",
          sources: evidence?.sources ?? [],
          confidence: evidence?.confidence,
        }];
      })),
      factor_values: sample.factorValues ?? {},
      warnings: sample.warnings ?? [],
    }))
    : raw.biological_samples ?? raw.biologicalSamples;
  return {
    schema_version: "sdrf-sample-design-v2",
    evidence_inventory: raw.evidence_inventory ?? raw.evidenceInventory,
    biological_samples: biologicalSamples,
    pools: raw.pools,
    labels: raw.labels,
    assays: raw.assays,
    files: raw.files,
    mapping_rows: mappingRows,
    raw_file_design_summary: raw.raw_file_design_summary ?? raw.rawFileDesignSummary ?? [],
    axis_review: raw.axis_review ?? raw.axisReview,
    design_audit: raw.design_audit ?? raw.designAudit,
    grouping_strategy: draft.groupingStrategy ? {
      selected_grouping_fields: draft.groupingStrategy.selectedGroupingFields,
      candidate_grouping_fields: draft.groupingStrategy.candidateGroupingFields.map((item) => ({
        field: item.field,
        values: item.values,
        classification: item.classification,
        reason: item.reason,
        sources: item.sources,
      })),
      rejected_grouping_fields: draft.groupingStrategy.rejectedGroupingFields.map((item) => ({
        field: item.field,
        values: item.values,
        classification: item.classification,
        reason: item.reason,
        sources: item.sources,
      })),
      reason: draft.groupingStrategy.reason,
      sources: draft.groupingStrategy.sources,
    } : undefined,
    sample_groups: draft.groups.map((group) => ({
      group_name: group.groupName,
      sample_count: group.sampleCount,
      naming_prefix: group.namingPrefix,
      metadata: Object.fromEntries(Object.entries(group.metadata).map(([key, value]) => {
        const evidence = group.metadataEvidence?.[key];
        return [key, {
          value,
          reason: evidence?.reason ?? "",
          sources: evidence?.sources ?? [],
          confidence: evidence?.confidence,
        }];
      })),
      factor_values: resolveSampleFactorKeys(group).map((key) => getSampleFieldByKey(key)?.factorColumn).filter(Boolean),
      ontology_terms: group.ontologyTerms,
      assay_context: group.assayContext ?? {},
      warnings: group.warnings ?? [],
    })),
    summary: draft.summary,
    sources: draft.sources,
    coverage_check: raw.computed_coverage_check ?? raw.coverage_check ?? raw.coverageCheck,
    warnings: draft.warnings ?? [],
  };
}

function sampleDraftToSessionJson(draft: SampleDesignDraft): Record<string, unknown> {
  const json = sampleDraftToJson(draft);
  return {
    schema_version: json.schema_version,
    biological_samples: compactSessionRecords(json.biological_samples, 600),
    mapping_rows: compactSessionRecords(json.mapping_rows, 1200),
    relationship_layers: draft.relationshipLayers?.map((layer) => ({
      field: cleanOneLineString(layer.field),
      label: cleanOneLineString(layer.label),
      role: cleanOneLineString(layer.role),
      source: cleanOneLineString(layer.source),
      reason: compactSessionText(layer.reason, 500),
    })) ?? [],
    grouping_strategy: compactGroupingStrategyForSession(draft.groupingStrategy),
    sample_groups: draft.groups.map((group) => ({
      group_name: group.groupName,
      sample_count: group.sampleCount,
      naming_prefix: group.namingPrefix,
      metadata: Object.fromEntries(Object.entries(group.metadata).map(([key, value]) => {
        const evidence = group.metadataEvidence?.[key];
        return [key, {
          value: cleanOneLineString(value),
          reason: compactSessionText(evidence?.reason, 500),
          sources: compactSessionSources(evidence?.sources),
          confidence: evidence?.confidence,
        }];
      })),
      factor_values: resolveSampleFactorKeys(group).map((key) => getSampleFieldByKey(key)?.factorColumn).filter(Boolean),
      ontology_terms: group.ontologyTerms,
      assay_context: group.assayContext ?? {},
      warnings: group.warnings ?? [],
    })),
    summary: compactSessionText(draft.summary, 1000),
    sources: compactSessionSources(draft.sources, 40),
    coverage_check: compactSessionRecord(json.coverage_check),
    warnings: draft.warnings ?? [],
  };
}

function compactGroupingStrategyForSession(strategy: SampleGroupingStrategy | undefined): Record<string, unknown> | undefined {
  if (!strategy) return undefined;
  const compactDecision = (item: SampleGroupingFieldDecision) => ({
    field: cleanOneLineString(item.field),
    values: item.values.map((value) => cleanOneLineString(value)).filter(Boolean).slice(0, 20),
    classification: item.classification,
    reason: compactSessionText(item.reason, 600),
    sources: compactSessionSources(item.sources, 10),
  });
  return {
    selected_grouping_fields: strategy.selectedGroupingFields.map((field) => cleanOneLineString(field)).filter(Boolean),
    candidate_grouping_fields: strategy.candidateGroupingFields.map(compactDecision),
    rejected_grouping_fields: strategy.rejectedGroupingFields.map(compactDecision),
    reason: compactSessionText(strategy.reason, 1000),
    sources: compactSessionSources(strategy.sources, 20),
  };
}

function compactSessionSources(sources: TemplateRecommendationSourceRef[] | undefined, limit = 12): TemplateRecommendationSourceRef[] {
  return (sources ?? []).slice(0, limit).map((source) => ({
    label: cleanOneLineString(source.label),
    value: compactSessionText(source.value, 700),
    location: cleanOneLineString(source.location),
    source: cleanOneLineString(source.source),
    field: cleanOneLineString(source.field),
  })).filter((source) => source.label || source.value);
}

function compactSessionRecords(value: unknown, limit = 200): Record<string, unknown>[] {
  return rawRecordList(value).slice(0, limit).map((record) => compactSessionRecord(record));
}

function compactSessionRecord(value: unknown): Record<string, unknown> {
  const record = asRecommendationRecord(value);
  if (!record) return {};
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, compactSessionValue(item)]));
}

function compactSessionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 200).map(compactSessionValue);
  if (value && typeof value === "object") return compactSessionRecord(value);
  if (typeof value === "string") return compactSessionText(value, 700);
  return value;
}

function compactSessionText(value: unknown, maxLength: number): string {
  const text = cleanEvidenceText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function sampleMetadataFieldAiDescriptor(field: SampleMetadataField, sourceTemplates: string[] = []): Record<string, unknown> {
  return {
    key: field.key,
    sdrf_column: field.column,
    label: sampleFieldDisplayLabel(field),
    requirement: field.requirement,
    source_templates: sourceTemplates,
    ontology_supported: Boolean(field.ontology),
    factor_column: field.factorColumn ?? "",
    allowed_values: field.options?.filter(Boolean) ?? [],
    examples: field.commonChoices?.slice(0, 5) ?? [],
  };
}

function buildSampleTemplateMetadataRequirements(templateIds: SdrfTemplateId[], allowedFields: SampleMetadataField[]): Record<string, unknown>[] {
  const allowedByColumn = new Map(allowedFields.map((field) => [field.column, field]));
  return templateIds.map((templateId) => {
    const template = getTemplateById(templateId);
    const templateFields = sampleMetadataFieldsFromColumnEntries(resolveTemplateColumnEntries(templateId))
      .filter((field) => allowedByColumn.has(field.column))
      .filter((field, index, list) => list.findIndex((item) => item.key === field.key) === index);
    const describe = (requirement: SampleMetadataRequirement) => templateFields
      .filter((field) => field.requirement === requirement)
      .map((field) => sampleMetadataFieldAiDescriptor(allowedByColumn.get(field.column) ?? field, [templateId]));
    return {
      template_id: templateId,
      template_title: template?.title ?? templateId,
      required: describe("required"),
      recommended: describe("recommended"),
      context: describe("context"),
      optional: describe("optional"),
    };
  });
}

function mergeSampleMetadataFields(fields: SampleMetadataField[]): SampleMetadataField[] {
  const byKey = new Map<string, SampleMetadataField>();
  for (const field of fields) {
    const existing = byKey.get(field.key);
    if (!existing) {
      byKey.set(field.key, field);
      continue;
    }
    byKey.set(field.key, {
      ...field,
      ...existing,
      factorKey: field.factorKey ?? existing.factorKey,
      factorColumn: field.factorColumn ?? existing.factorColumn,
      commonChoices: uniqueStrings([...(existing.commonChoices ?? []), ...(field.commonChoices ?? [])]).slice(0, 8),
    });
  }
  return Array.from(byKey.values());
}

function sampleMetadataFieldForSdrfAxis(column: string, values: string[] = []): SampleMetadataField | null {
  const normalizedColumn = normalizeSdrfColumnName(column);
  const factorName = normalizedColumn.match(/^factor value\[(.+)\]$/)?.[1];
  const characteristicColumn = factorName ? `characteristics[${factorName}]` : column;
  const known = getAllKnownSampleMetadataFields().find((field) => (
    normalizeSdrfColumnName(field.factorColumn ?? "") === normalizedColumn
    || normalizeSdrfColumnName(field.column) === normalizeSdrfColumnName(characteristicColumn)
    || normalizedAxisName(field.key) === normalizedAxisName(factorName ?? column)
  ));
  if (known) {
    return {
      ...known,
      factorKey: known.factorKey ?? (factorName ? known.key : undefined),
      factorColumn: factorName ? column : known.factorColumn,
      commonChoices: uniqueStrings([...(known.commonChoices ?? []), ...values]).slice(0, 8),
    };
  }
  if (!factorName && !normalizeSdrfColumnName(column).startsWith("characteristics[")) return null;
  return {
    key: sampleMetadataKeyFromColumn(characteristicColumn),
    label: sampleMetadataLabelFromColumn(characteristicColumn),
    column: characteristicColumn,
    placeholder: values[0] ?? "not available",
    requirement: "optional",
    commonChoices: values.slice(0, 8),
    factorKey: factorName ? sampleMetadataKeyFromColumn(characteristicColumn) : undefined,
    factorColumn: factorName ? column : undefined,
  };
}

function sampleMetadataFieldsFromSdrfSummary(summary: Record<string, unknown> | null): SampleMetadataField[] {
  const axes = Array.isArray(summary?.experimental_axes) ? summary.experimental_axes : [];
  const fields = axes.map((axis) => {
    const record = asRecommendationRecord(axis);
    const column = cleanOneLineString(record?.column ?? record?.field ?? record?.name);
    if (!column) return null;
    return sampleMetadataFieldForSdrfAxis(column, sanitizeColumnProfileValues(record?.values).map((item) => item.value));
  }).filter((field): field is SampleMetadataField => Boolean(field));
  return mergeSampleMetadataFields(fields);
}

const SAMPLE_AI_TABLE_PROFILE_MAX_COLUMNS = 80;
const SAMPLE_AI_TABLE_PROFILE_MAX_VALUES = 12;
const SAMPLE_AI_EXPERIMENTAL_GROUP_MAX_AXES = 4;
const SAMPLE_AI_EXPERIMENTAL_GROUP_MAX_CANDIDATES = 80;

function normalizeSdrfColumnName(value: string): string {
  return cleanOneLineString(value).toLowerCase();
}

function sdrfColumnSemanticKey(column: string): string {
  const normalized = normalizeSdrfColumnName(column);
  const bracket = normalized.match(/^(?:characteristics|factor value|comment)\[(.+)\]$/)?.[1];
  return bracket ?? normalized;
}

function sdrfColumnProfile(table: Awaited<ReturnType<typeof api.getSdrfTable>>, column: string) {
  const counts = new Map<string, number>();
  let nonEmptyCount = 0;
  for (const row of table.rows) {
    const value = cleanOneLineString(row[column]);
    if (!value) continue;
    nonEmptyCount += 1;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const values = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SAMPLE_AI_TABLE_PROFILE_MAX_VALUES)
    .map(([value, count]) => ({ value, count }));
  return {
    column,
    semantic_key: sdrfColumnSemanticKey(column),
    non_empty_count: nonEmptyCount,
    empty_count: Math.max(0, table.rows.length - nonEmptyCount),
    unique_value_count: counts.size,
    values,
  };
}

function classifySdrfProfile(profile: ReturnType<typeof sdrfColumnProfile>): "sample_constant" | "experimental_factor" | "assay_technical" | "rejected_grouping_axis" | "other" {
  const column = normalizeSdrfColumnName(profile.column);
  const semanticKey = profile.semantic_key;
  if (!profile.non_empty_count) return "other";
  if (
    column === "assay name"
    || column.startsWith("comment[")
    || semanticKey.includes("fraction")
    || semanticKey.includes("technical replicate")
    || semanticKey.includes("data file")
    || semanticKey.includes("file uri")
    || semanticKey.includes("instrument")
    || semanticKey.includes("label")
  ) {
    return "assay_technical";
  }
  if (profile.unique_value_count === 1 && (
    semanticKey.includes("organism")
    || semanticKey.includes("organism part")
    || semanticKey.includes("disease")
    || semanticKey.includes("cell line")
    || semanticKey.includes("cell type")
    || semanticKey.includes("sex")
    || semanticKey.includes("age")
  )) {
    return "sample_constant";
  }
  if (column.startsWith("factor value[") && profile.unique_value_count > 1) return "experimental_factor";
  if (
    profile.unique_value_count > 1
    && (
      semanticKey.includes("treatment")
      || semanticKey.includes("compound")
      || semanticKey.includes("stimulus")
      || semanticKey.includes("inhibitor")
      || semanticKey.includes("time")
      || semanticKey.includes("dose")
      || semanticKey.includes("phenotype")
      || semanticKey.includes("enrichment")
      || semanticKey.includes("cell cycle")
    )
  ) {
    return "experimental_factor";
  }
  if (profile.unique_value_count === 1) return "sample_constant";
  if (semanticKey.includes("biological replicate")) return "rejected_grouping_axis";
  return "other";
}

function buildExperimentalGroupCandidatesForSampleAi(
  table: Awaited<ReturnType<typeof api.getSdrfTable>>,
  experimentalAxes: Array<ReturnType<typeof sdrfColumnProfile> & { role: string }>,
): Record<string, unknown>[] {
  const usableAxes = experimentalAxes
    .filter((axis) => axis.unique_value_count > 1 && axis.unique_value_count <= 12)
    .slice(0, SAMPLE_AI_EXPERIMENTAL_GROUP_MAX_AXES);
  const candidateUpperBound = usableAxes
    .map((axis) => axis.unique_value_count)
    .reduce((product, count) => product * count, 1);
  if (!usableAxes.length || candidateUpperBound < 2 || candidateUpperBound > SAMPLE_AI_EXPERIMENTAL_GROUP_MAX_CANDIDATES) return [];

  const sourceColumn = table.headers.find((column) => normalizeSdrfColumnName(column) === "source name");
  const dataFileColumn = table.headers.find((column) => normalizeSdrfColumnName(column) === "comment[data file]");
  const fractionColumn = table.headers.find((column) => sdrfColumnSemanticKey(column).includes("fraction identifier"));
  const candidates = new Map<string, {
    factorValues: { column: string; semantic_key: string; value: string }[];
    rowCount: number;
    sourceNames: Set<string>;
    dataFiles: Set<string>;
    fractions: Set<string>;
  }>();

  for (const row of table.rows) {
    const factorValues = usableAxes.map((axis) => ({
      column: axis.column,
      semantic_key: axis.semantic_key,
      value: cleanOneLineString(row[axis.column]),
    }));
    if (factorValues.some((item) => !item.value)) continue;
    const key = JSON.stringify(factorValues.map((item) => [item.column, item.value]));
    const candidate = candidates.get(key) ?? {
      factorValues,
      rowCount: 0,
      sourceNames: new Set<string>(),
      dataFiles: new Set<string>(),
      fractions: new Set<string>(),
    };
    candidate.rowCount += 1;
    if (sourceColumn) {
      const sourceName = cleanOneLineString(row[sourceColumn]);
      if (sourceName) candidate.sourceNames.add(sourceName);
    }
    if (dataFileColumn) {
      const dataFile = cleanOneLineString(row[dataFileColumn]);
      if (dataFile) candidate.dataFiles.add(dataFile);
    }
    if (fractionColumn) {
      const fraction = cleanOneLineString(row[fractionColumn]);
      if (fraction) candidate.fractions.add(fraction);
    }
    candidates.set(key, candidate);
  }

  return Array.from(candidates.values()).slice(0, SAMPLE_AI_EXPERIMENTAL_GROUP_MAX_CANDIDATES).map((candidate) => {
    const values = candidate.factorValues.map((item) => item.value);
    const groupName = values.join(" + ");
    return {
      group_name: groupName,
      naming_prefix: cleanSamplePrefix(groupName),
      sample_count: candidate.sourceNames.size || candidate.rowCount,
      row_count: candidate.rowCount,
      unique_source_name_count: candidate.sourceNames.size,
      unique_data_file_count: candidate.dataFiles.size,
      factor_values: candidate.factorValues,
      assay_context: {
        raw_file_count: candidate.dataFiles.size,
        fractions: Array.from(candidate.fractions).slice(0, SAMPLE_AI_TABLE_PROFILE_MAX_VALUES),
      },
    };
  });
}

function buildSdrfTableSummaryForSampleAi(table: Awaited<ReturnType<typeof api.getSdrfTable>> | undefined): Record<string, unknown> | null {
  if (!table?.headers.length) return null;
  const profiles = table.headers
    .slice(0, SAMPLE_AI_TABLE_PROFILE_MAX_COLUMNS)
    .map((column) => {
      const profile = sdrfColumnProfile(table, column);
      return { ...profile, role: classifySdrfProfile(profile) };
    });
  const experimentalAxes = profiles.filter((profile) => profile.role === "experimental_factor");
  const sourceColumn = table.headers.find((column) => normalizeSdrfColumnName(column) === "source name");
  const dataFileColumn = table.headers.find((column) => normalizeSdrfColumnName(column) === "comment[data file]");
  const sourceProfile = sourceColumn ? sdrfColumnProfile(table, sourceColumn) : null;
  const dataFileProfile = dataFileColumn ? sdrfColumnProfile(table, dataFileColumn) : null;
  return {
    row_count: table.rows.length,
    header_count: table.headers.length,
    unique_source_name_count: sourceProfile?.unique_value_count ?? 0,
    unique_data_file_count: dataFileProfile?.unique_value_count ?? 0,
    column_profiles: profiles,
    constant_fields: profiles.filter((profile) => profile.role === "sample_constant"),
    experimental_axes: experimentalAxes,
    experimental_group_candidates: buildExperimentalGroupCandidatesForSampleAi(table, experimentalAxes),
    assay_axes: profiles.filter((profile) => profile.role === "assay_technical"),
    rejected_axes: profiles.filter((profile) => profile.role === "rejected_grouping_axis"),
  };
}

function buildSampleAiInput(
  projectId: string,
  sessionState: SessionUiState,
  analysis: Awaited<ReturnType<typeof api.getAnalysis>> | undefined,
): Record<string, unknown> {
  const importState = sessionState.import ?? {};
  const selectedTemplateIds = sanitizeTemplateIds(sessionState.templates?.selectedTemplates);
  const selectedTemplateFields = getSampleMetadataFieldsForTemplates(selectedTemplateIds);
  const allowedMetadataFields = mergeSampleMetadataFields(selectedTemplateFields.length
    ? selectedTemplateFields
    : getAllKnownSampleMetadataFields());
  const stackColumnEntries = resolveTemplateStackColumnEntries(selectedTemplateIds);
  const sourceTemplatesByColumn = new Map<string, string[]>();
  for (const entry of stackColumnEntries) {
    if (!entry.name.startsWith("characteristics[")) continue;
    sourceTemplatesByColumn.set(entry.name, uniqueStrings([...(sourceTemplatesByColumn.get(entry.name) ?? []), entry.sourceTemplate]));
  }
  const requiredMetadataFields = allowedMetadataFields.filter((field) => field.requirement === "required");
  const evidenceOptionalMetadataFields = allowedMetadataFields.filter((field) => field.requirement !== "required");
  const sampleEvidence = (analysis?.evidences ?? []).find((item) => item.source_type === "sample-evidence" && item.field === "sample evidence bundle");
  const sampleEvidencePayload = sanitizeSampleEvidenceBundleForAi(asRecommendationRecord(sampleEvidence?.payload));
  const evidencePolicy = {
    use_existing_sdrf: false,
    excluded_sources: ["existing SDRF", "current SDRF table rows"],
    existing_sdrf_handling: "Ignore existing SDRF files and current SDRF table rows for AI inference. Use only PRIDE/project metadata, publication/PDF evidence, uploaded metadata or design tables, and raw file list evidence.",
  };
  const usableEvidence = (analysis?.evidences ?? []).filter((item) => {
    if (item.source_type === "sample-evidence") return false;
    const haystack = `${item.source_type} ${item.source_ref} ${item.field}`.toLowerCase();
    return !haystack.includes("existing sdrf") && !haystack.includes("existing-sdrf");
  });
  return {
    task: "Return a standardized, editable Core Mapping JSON draft inferred without using existing SDRF files.",
    project_id: projectId,
    selected_template_ids: selectedTemplateIds,
    selected_template_columns: getTemplateColumns(selectedTemplateIds),
    selected_required_template_columns: getRequiredTemplateColumns(selectedTemplateIds),
    selected_template_metadata_requirements: buildSampleTemplateMetadataRequirements(selectedTemplateIds, allowedMetadataFields),
    required_metadata_fields: requiredMetadataFields.map((field) => sampleMetadataFieldAiDescriptor(field, sourceTemplatesByColumn.get(field.column) ?? [])),
    evidence_optional_metadata_fields: evidenceOptionalMetadataFields.map((field) => sampleMetadataFieldAiDescriptor(field, sourceTemplatesByColumn.get(field.column) ?? [])),
    metadata_generation_rules: [
      "Use only fields from allowed_metadata_fields.",
      "Every group must include every required_metadata_fields key.",
      "For required fields without direct evidence, return value 'not available' and cite the missing-evidence reason.",
      "Return recommended/context/optional fields only when sample_evidence_bundle, import_context, or evidence contains concrete support.",
      "Every returned metadata field must include value, reason, and sources.",
      "Do not use existing SDRF files, existing SDRF rows, or the current SDRF table to create metadata, factors, samples, pools, labels, or mapping rows.",
      "Do not put constant project metadata fields such as organism, organism part, cell line, disease, instrument, or label into factor_values.",
      "Do not put acquisition_method into factor_values; keep it in mapping_rows.acquisition_method and sample_groups.assay_context.acquisition_methods.",
      "Use axis_review to decide grouping fields dynamically. Only axes classified as biological_factor may become factor_values or selected_grouping_fields.",
      "Use relationship_layers to describe the ordered Blueprint path inferred from evidence; do not include unavailable placeholder layers.",
      "If publication, metadata tables, or raw file summaries contain multiple biological axes, selected_grouping_fields and factor_values must cover those axes or coverage_check.missing_axes must explain the omission.",
      "If evidence contains individual sample/subject rows with covariates, biological_samples must include one row per source-level sample and preserve per-sample metadata such as age, sex, individual, disease, and pool_id.",
      "mapping_rows must cover every imported raw_file_names item. Do not summarize repeated files with examples only.",
    ],
    evidence_policy: evidencePolicy,
    evidence_priority: [
      "publication PDF sample evidence",
      "parsed design table or uploaded structured metadata",
      "raw file names for AI-inferred experiment structure",
      "PRIDE project metadata and sampleProcessingProtocol",
      "PRIDE title, description, and keywords",
    ],
    grouping_policy: "ai_select_experimental_conditions",
    editor_flow: [
      "The right rail renders this JSON as editable group cards and a parsed JSON preview.",
      "After editing, the user can copy the JSON into the left-side sample roster and attribute assignment editor with one click.",
    ],
    import_context: {
      accession: importState.prideAccession ?? importState.activeImportAccession ?? importState.accession,
      pride_title: importState.prideTitle,
      pride_description: importState.prideDescription,
      organisms: importState.prideOrganisms ?? [],
      instruments: importState.prideInstruments ?? [],
      keywords: importState.prideKeywords ?? [],
      design_headers: importState.rawDesignTable?.headers ?? [],
      design_preview_rows: importState.rawDesignTable?.rows?.slice(0, 12) ?? [],
      mapped_design_headers: importState.mappedDesignTable?.headers ?? [],
      mapped_design_preview_rows: importState.mappedDesignTable?.rows?.slice(0, 12) ?? [],
      uploaded_files: importState.uploadedFiles ?? [],
    },
    sample_evidence_bundle: sampleEvidencePayload ?? null,
    raw_file_evidence: sampleEvidencePayload?.raw_file_summary ?? null,
    publication_sample_evidence: sampleEvidencePayload?.publication_sample_evidence ?? null,
    project_metadata_evidence: {
      pride_project: sampleEvidencePayload?.pride_project ?? null,
      project_metadata: sampleEvidencePayload?.project_metadata ?? null,
    },
    evidence: usableEvidence.slice(0, 30).map((item) => ({
      source_type: item.source_type,
      source_ref: item.source_ref,
      field: item.field,
      value: item.value,
      confidence: item.confidence,
      payload: stringifyCompact(item.payload).slice(0, 1200),
    })),
    allowed_metadata_fields: allowedMetadataFields.map((field) => sampleMetadataFieldAiDescriptor(field, sourceTemplatesByColumn.get(field.column) ?? [])),
      output_schema: {
        schema_version: "sdrf-core-mapping-v1",
        standard_reference: "SDRF-Proteomics v1.1.0 / quantMS SDRF specification",
        relationship_layers: [{
          field: "mapping_rows field name, metadata key, or factor value key that defines this Blueprint layer",
          label: "human-readable layer label",
          role: "biological_sample | biological_replicate | aggregation | label_channel | preparation | acquisition_method | technical_replicate | assay | data_file | metadata | factor",
          source: "axis_review field or evidence source that supports this layer",
          reason: "why this layer belongs in the row-level Blueprint path",
        }],
        required_sdrf_columns: [
        "source name",
        "assay name",
        "technology type",
        "comment[proteomics data acquisition method]",
        "comment[label]",
        "comment[fraction identifier]",
        "comment[technical replicate]",
        "comment[data file]",
        "comment[file uri]",
      ],
      biological_samples: [{
        source_name: "source-level biological sample name",
        biological_sample_id: "stable biological sample id",
        sample_group: "factor-defined sample group",
        biological_replicate: "biological replicate id",
        pool_id: "pool id when this source-level sample belongs to a pool",
        metadata: { organism: "organism", organismPart: "organism part", disease: "disease", age: "age", sex: "sex", individual: "individual" },
        factor_values: { disease: "factor value" },
      }],
      pools: [{ pool_id: "pool_01", member_source_names: ["sample names in pool"], data_files: ["files"], fraction_ids: ["fractions"] }],
      labels: [{ label: "label or channel", channel: "channel", source_name: "sample", pool_id: "pool when applicable", data_files: ["files"] }],
      assays: [{ assay_name: "assay run", source_name: "sample", data_file: "file", fraction_id: "fraction", technical_replicate: "technical replicate", pool_id: "pool" }],
      files: [{ data_file: "RAW or mzML file", file_uri: "file URI", fraction_ids: ["fractions"], source_names: ["samples"], pool_id: "pool" }],
      mapping_rows: [{
        source_name: "source-level biological sample name",
        biological_sample_id: "stable biological sample id",
        sample_group: "group label",
        biological_replicate: "biological replicate id",
        metadata: { organism: "organism", organismPart: "organism part", disease: "disease", age: "age", sex: "sex", individual: "individual" },
        factor_values: { disease: "factor value" },
        pool_id: "pool when present",
        pool_members: ["source names in pool"],
        label: "comment[label], or label free sample when evidence supports no label",
        channel: "channel when present",
        preparation: "preparation, enrichment, or fractionation method",
        fraction_id: "fraction identifier",
        acquisition_method: "comment[proteomics data acquisition method], exact observed acquisition or fragmentation method label when supported by evidence",
        technical_replicate: "technical replicate",
        assay_name: "assay name",
        data_file: "data file",
        file_uri: "file URI",
        warnings: ["row-level warnings"],
      }],
      evidence_inventory: {
        publication_pdf_available: "boolean",
        pride_metadata_available: "boolean",
        uploaded_metadata_available: "boolean",
        raw_file_evidence_available: "boolean",
        structured_metadata_or_design_table_available: "boolean",
        existing_sdrf_excluded: "boolean",
        notes: ["which sources were actually used"],
      },
      raw_file_design_summary: [{
        preparation: "observed preparation or enrichment layer, or not available",
        acquisition_method: "observed assay or acquisition method, or not available",
        biological_condition: "observed biological condition inferred from evidence",
        treatment: "normalized treatment/stimulus/inhibitor value",
        timepoint: "explicit timepoint value, or not available",
        replicate_ids: ["distinct biological replicate IDs observed"],
        raw_file_count: "number of raw files in this preparation-condition group",
        fractions: ["technical fraction labels when present"],
        example_filenames: ["one or more exact raw filenames supporting this row"],
      }],
      axis_review: [{
        field: "observed axis",
        values: ["observed values"],
        classification: "sample_constant | biological_factor | biological_replicate | technical_replicate | pool | label_channel | assay_file_variable | rejected",
        reason: "why this classification was chosen",
        sources: [{ label: "source", value: "observed value", location: "where it came from" }],
      }],
      design_audit: {
        row_count_evidence: "number of structured evidence rows used",
        source_count_evidence: "number of unique source names when available",
        data_file_count_evidence: "number of unique data files when available",
        constant_fields: [{ field: "field or column", values: ["observed constant value"], reason: "why it is sample metadata only" }],
        experimental_axes: [{ field: "field or column", values: ["observed values"], reason: "why it drives biological comparison" }],
        assay_axes: [{ field: "field or column", values: ["observed values"], reason: "why it belongs in assay_context" }],
        rejected_axes: [{ field: "field or column", values: ["observed values"], reason: "why it is not a sample grouping field" }],
      },
      grouping_strategy: {
        selected_grouping_fields: ["treatment", "timepoint"],
        candidate_grouping_fields: [{ field: "one candidate grouping field", values: ["observed values"], classification: "sample_constant | biological_factor | biological_replicate | assay_file_variable | rejected", reason: "why this field could define groups", sources: [{ label: "source", value: "observed value", location: "where it came from" }] }],
        rejected_grouping_fields: [{ field: "replicate", values: [], classification: "biological_replicate", reason: "why it is not a grouping field", sources: [] }],
        reason: "why the selected grouping fields best explain the experiment",
        sources: [{ label: "source", value: "observed value", location: "where it came from" }],
      },
      sample_groups: [
        {
          group_name: "short experimental group name",
          sample_count: "integer, use exact design count when available; otherwise conservative estimate",
          naming_prefix: "stable uppercase sample prefix",
          metadata: Object.fromEntries(allowedMetadataFields.map((field) => [field.key, {
            value: `${field.label} value for ${field.column}`,
            reason: "why this value is appropriate; for required fields without evidence explain that the template requires it and evidence is missing",
            sources: [{ label: "source field", value: "exact observed value", location: "where it came from" }],
          }])),
          factor_values: allowedMetadataFields
            .filter((field) => field.factorColumn)
            .map((field) => field.factorColumn),
          ontology_terms: [{ field: "one metadata key", label: "ontology label", accession: "ontology accession", ontology: "ontology prefix", reason: "source evidence" }],
          assay_context: {
            preparation: "preparation, enrichment, fractionation, or other assay context when supported",
            acquisition_methods: ["assay acquisition or fragmentation methods when supported"],
            raw_file_count: "number of raw files supporting this group when available",
            fractions: ["technical fractions when available"],
            replicate_source: "RAW filename tokens, design table rows, paper text, or not available",
          },
          warnings: ["ambiguous evidence or conflicts for this group"],
        },
      ],
      sources: [{ label: "source field", value: "exact value", location: "where it came from" }],
      coverage_check: {
        covered_axes: ["experimental axes represented by grouping_strategy and factor_values"],
        missing_axes: ["experimental axes not represented, with reason"],
        covered_raw_groups: ["raw filename preparation-condition groups covered by sample_groups"],
        assay_context_only_groups: ["raw filename groups explained as assay/preparation/fraction context only"],
        missing_biological_conditions: ["raw filename biological conditions not represented by sample_groups"],
        missing_raw_files: ["raw files from raw_file_names not represented by mapping_rows"],
        unresolved_conflicts: ["condition, replicate, or preparation conflicts that need user review"],
        warnings: ["coverage risks, over-compression, or constant fields incorrectly proposed as factors"],
      },
      warnings: ["global ambiguity or evidence conflict"],
      summary: "brief explanation of the draft",
    },
  };
}

const LEGACY_PARSED_RAW_SUMMARY_KEYS = new Set([
  "conditions",
  "preparations",
  "acquisition_methods",
  "acquisitionMethods",
  "timepoints",
  "cell_cycle_states",
  "cellCycleStates",
  "replicates",
  "fractions",
  "groups_by_condition",
  "groupsByCondition",
  "groups_by_preparation_condition",
  "groupsByPreparationCondition",
  "groups_by_acquisition_method",
  "groupsByAcquisitionMethod",
  "candidate_grouping_fields",
  "candidateGroupingFields",
  "parsed_files_preview",
  "parsedFilesPreview",
]);

type RawFileCatalogEntry = {
  id: string;
  name: string;
};

function buildRawFileCatalog(rawFileNames: string[]): RawFileCatalogEntry[] {
  const width = Math.max(3, String(rawFileNames.length).length);
  return rawFileNames.map((name, index) => ({
    id: `RF${String(index + 1).padStart(width, "0")}`,
    name,
  }));
}

function sanitizeSampleEvidenceBundleForAi(bundle: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!bundle) return undefined;
  const rawSummary = asRecommendationRecord(bundle.raw_file_summary ?? bundle.rawFileSummary);
  if (!rawSummary) return bundle;
  return {
    ...bundle,
    raw_file_summary: sanitizeRawFileSummaryForAi(rawSummary),
  };
}

function sanitizeRawFileSummaryForAi(rawSummary: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...rawSummary };
  for (const key of LEGACY_PARSED_RAW_SUMMARY_KEYS) {
    delete normalized[key];
  }
  const parsedPreviewNames = rawSummaryRecords(rawSummary.parsed_files_preview ?? rawSummary.parsedFilesPreview)
    .map((record) => cleanOneLineString(record.filename ?? record.file_name ?? record.name))
    .filter(Boolean);
  const rawFileNames = uniqueStrings([
    ...sanitizeStringList(rawSummary.raw_file_names ?? rawSummary.rawFileNames),
    ...sanitizeStringList(rawSummary.raw_file_examples ?? rawSummary.rawFileExamples),
    ...parsedPreviewNames,
  ]);
  normalized.raw_file_count = Math.max(
    rawFileNames.length,
    Math.max(0, Math.floor(Number(rawSummary.raw_file_count ?? rawSummary.rawFileCount ?? 0))),
  );
  if (rawFileNames.length) normalized.raw_file_names = rawFileNames;
  if (rawFileNames.length) normalized.raw_file_catalog = buildRawFileCatalog(rawFileNames);
  normalized.raw_file_examples = rawFileNames.slice(0, 20);
  normalized.semantic_parsing = "disabled";
  normalized.interpretation_note = "AI must infer conditions, preparations, replicates, fractions, labels, and acquisition methods from raw_file_catalog/raw_file_names, then output raw_file_ids rather than copying full file names.";
  normalized.assay_context_fields = [];
  return normalized;
}

async function requestSampleDesignDraft(
  input: Record<string, unknown>,
  config: ClientAiConfig,
  requestPayload = buildSampleDesignRequestPayload(input, config),
): Promise<SampleDesignDraft> {
  try {
    const payload = await api.chatCompletion(requestPayload, {
      timeoutMs: SAMPLE_AI_REQUEST_TIMEOUT_MS,
      timeoutMessage: `AI sample JSON timed out after ${Math.round(SAMPLE_AI_REQUEST_TIMEOUT_MS / 1000)} seconds.`,
    });
    const content = aiChatContent(payload);
    const parsed = expandRawFileIdMappingGroups(parseAiJsonObject(content), input);
    return addSampleDesignQualityWarnings(sanitizeSampleDesignDraft(parsed), input);
  } catch (error) {
    throw error;
  }
}

function buildSampleDesignRequestPayload(input: Record<string, unknown>, config: Pick<ClientAiConfig, "model">): Record<string, unknown> {
  const useCompactCoreMapping = hasPublicationPdfFactExtraction(input);
  const requestInput = useCompactCoreMapping ? buildCompactSampleCoreMappingInput(input) : input;
  return {
    model: config.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: useCompactCoreMapping ? COMPACT_SAMPLE_CORE_MAPPING_SYSTEM_PROMPT : SAMPLE_DESIGN_JSON_SYSTEM_PROMPT,
      },
      { role: "user", content: JSON.stringify(requestInput) },
    ],
  };
}

function hasPublicationPdfFactExtraction(input: Record<string, unknown>): boolean {
  return Boolean(asRecommendationRecord(input.publication_pdf_fact_extraction));
}

function rawFileCatalogFromInput(input: Record<string, unknown>): RawFileCatalogEntry[] {
  const rawEvidence = asRecommendationRecord(input.raw_file_evidence)
    ?? asRecommendationRecord(asRecommendationRecord(input.sample_evidence_bundle)?.raw_file_summary)
    ?? {};
  const catalogRecords = rawSummaryRecords(rawEvidence.raw_file_catalog ?? rawEvidence.rawFileCatalog);
  const catalog = catalogRecords
    .map((record): RawFileCatalogEntry | null => {
      const id = cleanOneLineString(record.id ?? record.raw_file_id ?? record.rawFileId).toUpperCase();
      const name = cleanOneLineString(record.name ?? record.file_name ?? record.filename ?? record.data_file ?? record.dataFile);
      return id && name ? { id, name } : null;
    })
    .filter((item): item is RawFileCatalogEntry => Boolean(item));
  if (catalog.length) return catalog;
  const names = sanitizeStringList(rawEvidence.raw_file_names ?? rawEvidence.rawFileNames);
  return buildRawFileCatalog(names);
}

function expandRawFileIdMappingGroups(parsed: Record<string, unknown>, input: Record<string, unknown>): Record<string, unknown> {
  const mappingGroups = rawRecordList(parsed.mapping_groups ?? parsed.mappingGroups);
  if (!mappingGroups.length) return parsed;

  const catalog = rawFileCatalogFromInput(input);
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();
  const unknownIds = new Set<string>();
  const mappingRows: Record<string, unknown>[] = [];

  for (const group of mappingGroups) {
    const rawIdValue = group.raw_file_ids ?? group.rawFileIds;
    const rawIds = (Array.isArray(rawIdValue) ? rawIdValue : rawIdValue ? [rawIdValue] : [])
      .map((rawId) => cleanOneLineString(rawId).toUpperCase())
      .filter(Boolean);
    const rowTemplate = { ...group };
    delete rowTemplate.raw_file_ids;
    delete rowTemplate.rawFileIds;
    for (const id of rawIds) {
      const entry = catalogById.get(id);
      if (!entry) {
        if (id) unknownIds.add(id);
        continue;
      }
      if (seenIds.has(id)) {
        duplicateIds.add(id);
        continue;
      }
      seenIds.add(id);
      mappingRows.push({
        ...rowTemplate,
        data_file: entry.name,
      });
    }
  }

  const missingIds = catalog.map((entry) => entry.id).filter((id) => !seenIds.has(id));
  const coverageCheck = asRecommendationRecord(parsed.coverage_check ?? parsed.coverageCheck) ?? {};
  const warnings = uniqueStrings([
    ...sanitizeStringList(coverageCheck.warnings),
    ...(unknownIds.size ? [`AI mapping_groups referenced unknown raw file ID(s): ${[...unknownIds].join(", ")}.`] : []),
    ...(duplicateIds.size ? [`AI mapping_groups referenced duplicate raw file ID(s): ${[...duplicateIds].join(", ")}.`] : []),
    ...(missingIds.length ? [`AI mapping_groups did not cover raw file ID(s): ${missingIds.join(", ")}.`] : []),
  ]);
  const missingRawFiles = uniqueStrings([
    ...sanitizeStringList(coverageCheck.missing_raw_files ?? coverageCheck.missingRawFiles),
    ...missingIds,
  ]);
  const unresolvedConflicts = uniqueStrings([
    ...sanitizeStringList(coverageCheck.unresolved_conflicts ?? coverageCheck.unresolvedConflicts),
    ...[...unknownIds].map((id) => `unknown raw file id ${id}`),
    ...[...duplicateIds].map((id) => `duplicate raw file id ${id}`),
  ]);

  return {
    ...parsed,
    mapping_rows: mappingRows,
    coverage_check: {
      ...coverageCheck,
      warnings,
      missing_raw_files: missingRawFiles,
      unresolved_conflicts: unresolvedConflicts,
    },
  };
}

function buildCompactSampleCoreMappingInput(input: Record<string, unknown>): Record<string, unknown> {
  const rawEvidence = sanitizeRawFileSummaryForAi(asRecommendationRecord(input.raw_file_evidence) ?? {});
  const allowedFields = rawSummaryRecords(input.allowed_metadata_fields).map(compactAllowedMetadataField);
  const requiredFields = rawSummaryRecords(input.required_metadata_fields).map(compactAllowedMetadataField);
  const optionalFields = rawSummaryRecords(input.evidence_optional_metadata_fields).map(compactAllowedMetadataField);
  return {
    task: "Generate compact SDRF Core Mapping JSON from PDF facts and raw file names without using existing SDRF.",
    project_id: input.project_id,
    selected_template_ids: input.selected_template_ids,
    selected_required_template_columns: input.selected_required_template_columns,
    selected_template_metadata_requirements: input.selected_template_metadata_requirements,
    evidence_policy: {
      ...(asRecommendationRecord(input.evidence_policy) ?? {}),
      use_existing_sdrf: false,
      excluded_sources: ["existing SDRF", "current SDRF table rows"],
    },
    evidence_priority: [
      "publication_pdf_fact_extraction",
      "raw_file_evidence.raw_file_catalog",
      "project_metadata_evidence",
      "design_table_evidence and metadata_documents when present",
    ],
    grouping_policy: input.grouping_policy,
    metadata_rules: [
      "Use metadata keys from allowed_metadata_fields only.",
      "Every sample group must include required_metadata_fields; use not available only when evidence is missing.",
      "If publication_pdf_fact_extraction.individual_sample_facts contains a subject/sample table, copy each subject/sample into biological_samples with source_name and metadata. Do not collapse them into pool-level sample_groups.",
      "Use factor_values only for biological grouping fields with an allowed factor_column.",
      "Do not put acquisition_method, fraction_id, assay_name, data_file, or technical_replicate into factor_values.",
      "Preserve individual biological samples separately from pools.",
    ],
    raw_file_id_policy: {
      catalog_field: "raw_file_evidence.raw_file_catalog",
      model_output_field: "mapping_groups[].raw_file_ids",
      instruction: "Reference raw files by raw_file_ids such as RF001. Do not copy full raw file names into mapping_groups.",
    },
    project_metadata_evidence: input.project_metadata_evidence,
    publication_pdf_fact_extraction: compactPublicationPdfFacts(input.publication_pdf_fact_extraction),
    publication_documents: input.publication_documents,
    raw_file_evidence: rawEvidence,
    design_table_evidence: input.design_table_evidence,
    metadata_documents: input.metadata_documents,
    allowed_metadata_fields: allowedFields,
    required_metadata_fields: requiredFields,
    evidence_optional_metadata_fields: optionalFields,
    required_sdrf_columns: [
      "source name",
      "assay name",
      "technology type",
      "comment[proteomics data acquisition method]",
      "comment[label]",
      "comment[fraction identifier]",
      "comment[technical replicate]",
      "comment[data file]",
      "comment[file uri]",
    ],
    output_contract: {
      schema_version: "sdrf-core-mapping-v1",
      required_top_level_keys: [
        "schema_version",
        "evidence_inventory",
        "biological_samples",
        "pools",
        "labels",
        "assays",
        "files",
        "mapping_groups",
        "raw_file_design_summary",
        "axis_review",
        "grouping_strategy",
        "relationship_layers",
        "sample_groups",
        "coverage_check",
        "warnings",
        "summary",
        "sources",
      ],
      mapping_group_fields: [
        "raw_file_ids",
        "source_name",
        "biological_sample_id",
        "sample_group",
        "biological_replicate",
        "pool_id",
        "pool_members",
        "label",
        "preparation",
        "fraction_id",
        "acquisition_method",
        "technical_replicate",
        "assay_name",
        "file_uri",
        "warnings",
      ],
      mapping_row_expansion: "The application expands mapping_groups.raw_file_ids to mapping_rows.data_file using raw_file_evidence.raw_file_catalog after the AI response is parsed.",
      biological_sample_fields: [
        "source_name",
        "biological_sample_id",
        "sample_group",
        "biological_replicate",
        "pool_id",
        "metadata",
        "factor_values",
        "warnings",
      ],
      relationship_layer_fields: ["field", "label", "role", "source", "reason"],
      sample_group_fields: ["group_name", "sample_count", "naming_prefix", "metadata", "factor_values", "ontology_terms", "assay_context", "warnings"],
      coverage_check_fields: ["covered_axes", "missing_axes", "covered_raw_groups", "assay_context_only_groups", "missing_biological_conditions", "missing_raw_files", "unresolved_conflicts", "warnings"],
    },
  };
}

function compactAllowedMetadataField(field: Record<string, unknown>): Record<string, unknown> {
  return {
    key: field.key,
    label: field.label,
    sdrf_column: field.sdrf_column ?? field.column,
    factor_column: field.factor_column ?? field.factorColumn,
    requirement: field.requirement,
    ontology: field.ontology,
  };
}

function compactPublicationPdfFacts(value: unknown): Record<string, unknown> {
  const record = asRecommendationRecord(value);
  if (!record) return {};
  const compact: Record<string, unknown> = {};
  for (const key of [
    "sample_facts",
    "individual_sample_facts",
    "pool_facts",
    "fractionation_facts",
    "label_facts",
    "preparation_facts",
    "acquisition_facts",
    "replicate_facts",
    "assay_facts",
    "uncertainties",
    "citations",
  ]) {
    compact[key] = rawSummaryRecords(record[key]).slice(0, 16).map((item) => {
      const compactItem: Record<string, unknown> = {
        page: item.page,
        value: truncateForPrompt(item.value, 700),
        meaning: truncateForPrompt(item.meaning ?? item.reason, 700),
        quote: truncateForPrompt(item.quote, 300),
        reason: truncateForPrompt(item.reason, 500),
      };
      if (key === "individual_sample_facts") {
        const values = asRecommendationRecord(item.values ?? item.metadata);
        compactItem.source_name = truncateForPrompt(item.source_name ?? item.sourceName ?? item.sample_name ?? item.sampleName, 200);
        compactItem.values = values ? compactSessionRecord(values) : undefined;
      }
      return compactItem;
    });
  }
  compact.schema_version = record.schema_version ?? record.schemaVersion ?? "pdf-experiment-facts-v1";
  compact.summary = truncateForPrompt(record.summary, 1800);
  return compact;
}

function truncateForPrompt(value: unknown, maxLength: number): string | undefined {
  const text = cleanOneLineString(value);
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

async function requestPdfExperimentFacts(
  input: Record<string, unknown>,
  config: ClientAiConfig,
  requestPayload = buildPdfExperimentFactsRequestPayload(input, config),
): Promise<Record<string, unknown>> {
  try {
    const payload = await api.chatCompletion(requestPayload, {
      timeoutMs: SAMPLE_AI_REQUEST_TIMEOUT_MS,
      timeoutMessage: `AI PDF evidence extraction timed out after ${Math.round(SAMPLE_AI_REQUEST_TIMEOUT_MS / 1000)} seconds.`,
    });
    const content = aiChatContent(payload);
    return parseAiJsonObject(content);
  } catch (error) {
    throw error;
  }
}

function buildPdfExperimentFactsRequestPayload(input: Record<string, unknown>, config: Pick<ClientAiConfig, "model">): Record<string, unknown> {
  return {
    model: config.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: PDF_EXPERIMENT_FACTS_SYSTEM_PROMPT,
      },
      { role: "user", content: JSON.stringify(input) },
    ],
  };
}

function buildPdfExperimentFactsInput(input: Record<string, unknown>): Record<string, unknown> {
  return {
    task: "Read publication PDF page text and extract experiment-design facts for later SDRF Core Mapping.",
    project_id: input.project_id,
    evidence_policy: {
      ...(asRecommendationRecord(input.evidence_policy) ?? {}),
      use_existing_sdrf: false,
      excluded_sources: ["existing SDRF", "current SDRF table rows"],
    },
    project_metadata_evidence: input.project_metadata_evidence,
    pdf_processing_policy: input.pdf_processing_policy,
    publication_documents: getPublicationDocumentsWithPages(input),
    output_schema: {
      schema_version: "pdf-experiment-facts-v1",
      sample_facts: [{ page: "page number", value: "exact observed value", meaning: "sample fact meaning" }],
      individual_sample_facts: [{
        page: "page number",
        source_name: "subject/sample id exactly as observed or normalized from the table",
        values: {
          age: "age value when listed",
          sex: "sex/gender value when listed",
          disease: "disease/diagnosis/cause of death value when listed",
          organism_part: "tissue or organism part when listed",
          pool_id: "pool membership when listed or inferable from PDF text",
        },
        quote: "short exact row/table text supporting this subject/sample",
        meaning: "why this row describes an individual biological sample",
      }],
      pool_facts: [{ page: "page number", value: "exact observed value", meaning: "pool or aggregation relationship" }],
      fractionation_facts: [{ page: "page number", value: "exact observed value", meaning: "fractionation or slice relationship" }],
      label_facts: [{ page: "page number", value: "exact observed value", meaning: "label/channel relationship" }],
      preparation_facts: [{ page: "page number", value: "exact observed value", meaning: "preparation or enrichment relationship" }],
      acquisition_facts: [{ page: "page number", value: "exact observed value", meaning: "acquisition or assay method relationship" }],
      replicate_facts: [{ page: "page number", value: "exact observed value", meaning: "biological or technical replicate relationship" }],
      assay_facts: [{ page: "page number", value: "exact observed value", meaning: "assay relationship" }],
      uncertainties: [{ page: "page number", value: "ambiguous observed value", reason: "why it is ambiguous" }],
      citations: [{ page: "page number", quote: "short exact quote", meaning: "why this quote matters" }],
      summary: "concise experimental design summary from PDF only",
    },
  };
}

function mergeBackendSampleAiEvidenceInput(localInput: Record<string, unknown>, backendInput: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!backendInput) return localInput;
  const backendRaw = asRecommendationRecord(backendInput.raw_file_evidence);
  const localBundle = asRecommendationRecord(localInput.sample_evidence_bundle);
  const backendProjectMetadata = asRecommendationRecord(backendInput.project_metadata_evidence);
  const localProjectMetadata = asRecommendationRecord(localInput.project_metadata_evidence);
  const rawFileEvidence = backendRaw ? sanitizeRawFileSummaryForAi(backendRaw) : asRecommendationRecord(localInput.raw_file_evidence);
  const nextBundle = localBundle && rawFileEvidence
    ? { ...localBundle, raw_file_summary: rawFileEvidence }
    : localBundle;
  return {
    ...localInput,
    backend_evidence_input_schema_version: cleanOneLineString(backendInput.schema_version),
    evidence_policy: {
      ...(asRecommendationRecord(localInput.evidence_policy) ?? {}),
      ...(asRecommendationRecord(backendInput.evidence_policy) ?? {}),
      use_existing_sdrf: false,
      excluded_sources: ["existing SDRF", "current SDRF table rows"],
    },
    pdf_processing_policy: backendInput.pdf_processing_policy ?? localInput.pdf_processing_policy,
    publication_documents: backendInput.publication_documents ?? localInput.publication_documents,
    raw_file_evidence: rawFileEvidence ?? localInput.raw_file_evidence,
    sample_evidence_bundle: nextBundle ?? localInput.sample_evidence_bundle,
    project_metadata_evidence: {
      ...(localProjectMetadata ?? {}),
      ...(backendProjectMetadata ?? {}),
    },
    design_table_evidence: backendInput.design_table_evidence ?? localInput.design_table_evidence,
    metadata_documents: backendInput.metadata_documents ?? localInput.metadata_documents,
  };
}

function withPublicationPdfFacts(input: Record<string, unknown>, facts: Record<string, unknown>): Record<string, unknown> {
  return {
    ...input,
    publication_pdf_fact_extraction: facts,
    publication_documents: summarizePublicationDocumentsForCoreMapping(input.publication_documents),
  };
}

function getPublicationDocumentsWithPages(input: Record<string, unknown>): Record<string, unknown>[] {
  return rawSummaryRecords(input.publication_documents).filter((document) => rawSummaryRecords(document.pages).length > 0);
}

function summarizePublicationDocumentsForCoreMapping(value: unknown): Record<string, unknown>[] {
  return rawSummaryRecords(value).map((document) => ({
    source_type: document.source_type,
    source_ref: document.source_ref,
    filename: document.filename,
    semantic_processing: document.semantic_processing,
    page_count: document.page_count,
    char_count: document.char_count,
    truncated: document.truncated,
    note: "Full page text was read in the preceding PDF experiment-facts stage; use publication_pdf_fact_extraction for cited facts.",
  }));
}

function addSampleDesignQualityWarnings(draft: SampleDesignDraft, input: Record<string, unknown>): SampleDesignDraft {
  const warnings: string[] = [];
  const rawCoverage = computeRawFileConditionCoverage(draft, input);
  warnings.push(...rawCoverage.warnings);

  if (!warnings.length && !rawCoverage.observedConditions.length) return draft;

  return {
    ...draft,
    warnings: uniqueStrings([...(draft.warnings ?? []), ...warnings]),
    rawJson: {
      ...(draft.rawJson ?? {}),
      computed_coverage_check: rawCoverage.observedConditions.length
        ? {
          observed_biological_conditions: rawCoverage.observedConditions,
          represented_biological_conditions: rawCoverage.representedConditions,
          missing_biological_conditions: rawCoverage.missingConditions,
        }
        : undefined,
    },
  };
}

function computeRawFileConditionCoverage(draft: SampleDesignDraft, input: Record<string, unknown>): {
  observedConditions: string[];
  representedConditions: string[];
  missingConditions: string[];
  warnings: string[];
} {
  const observed = extractRawEvidenceBiologicalConditions(input);
  const represented = sampleDraftBiologicalConditionSignatures(draft);
  const missing = observed.filter((condition) => !represented.some((signature) => conditionSignaturesCompatible(condition.signature, signature)));
  const warnings: string[] = [];
  if (observed.length && draft.groups.length > 0 && missing.length) {
    warnings.push(`RAW filename evidence contains biological condition(s) not represented by this draft: ${missing.map((item) => item.label).join(", ")}.`);
  }
  if (observed.length >= 3 && draft.groups.length > 0 && draft.groups.length < observed.length) {
    warnings.push(`Draft has ${draft.groups.length} group(s), but RAW filename evidence contains ${observed.length} distinct biological condition(s); this likely over-compresses the sample design.`);
  }
  return {
    observedConditions: observed.map((item) => item.label),
    representedConditions: represented,
    missingConditions: missing.map((item) => item.label),
    warnings,
  };
}

function extractRawEvidenceBiologicalConditions(input: Record<string, unknown>): Array<{ label: string; signature: string }> {
  const bundle = asRecommendationRecord(input.sample_evidence_bundle);
  const rawSummary = asRecommendationRecord(bundle?.raw_file_summary);
  if (!rawSummary) return [];
  const rawGroups = [
    ...rawSummaryRecords(rawSummary.groups_by_condition),
    ...rawSummaryRecords(rawSummary.groups_by_preparation_condition),
    ...rawSummaryRecords(rawSummary.raw_file_design_summary),
  ];
  const observed = new Map<string, string>();
  for (const group of rawGroups) {
    const label = cleanOneLineString(group.biological_condition ?? group.condition ?? group.treatment);
    const treatment = cleanOneLineString(group.treatment);
    const timepoint = firstString(group.timepoint ?? group.timepoints);
    const signature = biologicalConditionSignature({ condition: label, treatment, timepoint });
    if (label && signature) observed.set(signature, label);
  }
  if (!observed.size) {
    for (const condition of sanitizeStringList(rawSummary.conditions)) {
      const signature = biologicalConditionSignature({ condition });
      if (signature) observed.set(signature, condition);
    }
  }
  return Array.from(observed.entries()).map(([signature, label]) => ({ signature, label }));
}

function rawSummaryRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecommendationRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function firstString(value: unknown): string {
  const values = sanitizeStringList(value);
  return values[0] ?? cleanOneLineString(value);
}

function sampleDraftBiologicalConditionSignatures(draft: SampleDesignDraft): string[] {
  const signatures = new Set<string>();
  for (const group of draft.groups) {
    const timepoint = cleanOneLineString(group.metadata.timePoint ?? group.metadata.timepoint ?? group.metadata.samplingTime ?? group.metadata.sampling_time);
    const condition = cleanOneLineString(group.groupName);
    const treatment = cleanOneLineString(group.metadata.treatment ?? group.metadata.compound);
    const cellCycleState = cleanOneLineString(group.metadata.cellCycleState ?? group.metadata.cell_cycle_state);
    for (const signature of [
      biologicalConditionSignature({ condition }),
      biologicalConditionSignature({ condition, treatment, timepoint }),
      biologicalConditionSignature({ condition: cellCycleState }),
      biologicalConditionSignature({ condition: treatment, timepoint }),
    ]) {
      if (signature) signatures.add(signature);
    }
  }
  return Array.from(signatures);
}

function biologicalConditionSignature(input: { condition?: string; treatment?: string; timepoint?: string }): string {
  const genericAssayTokens = new Set([
    "sample",
    "group",
    "rep",
    "replicate",
    "fraction",
    "frac",
    "slice",
    "run",
    "assay",
    "raw",
    "file",
    "proteome",
    "phosphoproteome",
    "phospho",
    "protein",
    "enrichment",
    "available",
    "not",
    "na",
  ]);
  const tokens = [input.condition, input.treatment, input.timepoint]
    .map((value) => cleanOneLineString(value ?? "").toLowerCase())
    .join(" ")
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token && !genericAssayTokens.has(token));
  return tokens.join("");
}

function conditionSignaturesCompatible(observed: string, represented: string): boolean {
  if (!observed || !represented) return false;
  if (observed === represented) return true;
  if (observed.length >= 4 && represented.includes(observed)) return true;
  return represented.length >= 4 && observed.includes(represented);
}

function sanitizeColumnProfileValues(value: unknown): { value: string; count: number }[] {
  const raw = Array.isArray(value) ? value : [];
  return raw.map((item) => {
    const record = asRecommendationRecord(item);
    return {
      value: cleanOneLineString(record?.value ?? item),
      count: Math.max(0, Math.floor(Number(record?.count ?? 0))),
    };
  }).filter((item) => item.value);
}

function normalizedAxisName(value: string): string {
  return sdrfColumnSemanticKey(value).replace(/[^a-z0-9]+/g, "");
}

function sanitizeBiologicalSamples(value: unknown, groups: SampleDesignGroup[] = []): SampleBiologicalSample[] {
  const groupByName = new Map(groups.map((group) => [normalizedAxisName(group.groupName), group]));
  const samples = rawRecordList(value).map((record): SampleBiologicalSample | null => {
    const sourceName = firstRecordString(record, [
      "source_name",
      "sourceName",
      "sample_name",
      "sampleName",
      "sample",
      "subject_id",
      "subjectId",
      "subject",
      "donor_id",
      "donorId",
      "id",
      "name",
    ]).toLowerCase();
    if (!sourceName) return null;
    const sampleGroup = firstRecordString(record, ["sample_group", "sampleGroup", "group_name", "groupName", "condition", "cohort"]);
    const sourceGroup = sampleGroup ? groupByName.get(normalizedAxisName(sampleGroup)) : undefined;
    const metadataRecord = {
      ...(sourceGroup?.metadata ?? {}),
      ...(asRecommendationRecord(record.metadata) ?? {}),
      ...record,
    };
    const metadataEvidenceRecord = asRecommendationRecord(record.metadata_evidence ?? record.metadataEvidence ?? record.evidence_by_field ?? record.sources_by_field) ?? {};
    const metadata: Partial<Record<SampleMetadataKey, string>> = {};
    const metadataEvidence: Partial<Record<SampleMetadataKey, SampleMetadataEvidence>> = {};
    for (const field of getAllKnownSampleMetadataFields()) {
      const raw = normalizeBiologicalSampleMetadataInput(field, readSampleMetadataRecordValue(metadataRecord, field));
      const parsed = sanitizeAiMetadataValue(field, raw, readSampleMetadataRecordValue(metadataEvidenceRecord, field));
      if (parsed.value) metadata[field.key] = parsed.value;
      if (parsed.evidence) metadataEvidence[field.key] = parsed.evidence;
    }
    const factorKeys = sanitizeSampleFactorKeys(record.factor_values ?? record.factorValues ?? record.study_variables ?? record.studyVariables ?? []);
    const ontologyTerms = Array.isArray(record.ontology_terms)
      ? record.ontology_terms.map((item) => sanitizeSampleOntologyTerm(asRecommendationRecord(item) ?? {})).filter((term): term is SampleOntologyTerm => Boolean(term))
      : [];
    return {
      sourceName,
      biologicalSampleId: firstRecordString(record, ["biological_sample_id", "biologicalSampleId", "biological_sample", "biologicalSample"]),
      sampleGroup,
      biologicalReplicate: firstRecordString(record, ["biological_replicate", "biologicalReplicate", "bio_replicate", "bioReplicate", "replicate"]),
      poolId: firstRecordString(record, ["pool_id", "poolId", "pool", "pooled_sample", "pooledSample"]),
      metadata,
      metadataEvidence,
      ontologyTerms,
      factorKeys,
      factorValues: sanitizeBiologicalSampleFactorValues(record.factor_values ?? record.factorValues),
      warnings: sanitizeStringList(record.warnings ?? record.warning),
    };
  }).filter((sample): sample is SampleBiologicalSample => Boolean(sample));
  const seen = new Set<string>();
  return samples.filter((sample) => {
    const key = [
      sample.sourceName,
      sample.biologicalSampleId,
      sample.biologicalReplicate,
      sample.poolId,
    ].map((item) => normalizedAxisName(cleanOneLineString(item))).join("|");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeBiologicalSampleFactorValues(value: unknown): Record<string, string> {
  const record = asRecommendationRecord(value);
  if (!record) return {};
  return Object.fromEntries(Object.entries(record)
    .map(([key, item]) => [cleanOneLineString(key), cleanOneLineString(item)] as const)
    .filter(([key, item]) => key && item));
}

function normalizeBiologicalSampleMetadataInput(field: SampleMetadataField, rawValue: unknown): unknown {
  const normalizedField = normalizedAxisName(field.key);
  const valueRecord = asRecommendationRecord(rawValue);
  const rawText = cleanOneLineString(
    valueRecord
      ? valueRecord.value ?? valueRecord.label ?? valueRecord.text ?? valueRecord.normalized_value ?? valueRecord.normalizedValue
      : rawValue,
  );
  if (normalizedField !== "sex") return rawValue;
  const normalizedSex = normalizeBiologicalSexValue(rawText);
  if (!normalizedSex) return rawValue;
  return valueRecord ? { ...valueRecord, value: normalizedSex } : normalizedSex;
}

function normalizeBiologicalSexValue(value: string): string {
  const normalized = cleanOneLineString(value).toLowerCase();
  if (normalized === "f" || normalized === "female" || normalized === "woman") return "female";
  if (normalized === "m" || normalized === "male" || normalized === "man") return "male";
  return "";
}

function sanitizeSampleDesignDraft(value: Record<string, unknown>): SampleDesignDraft {
  const rawGroups = Array.isArray(value.sample_groups) ? value.sample_groups : Array.isArray(value.groups) ? value.groups : [];
  const groups = rawGroups
    .map((item) => sanitizeAiSampleGroup(asRecommendationRecord(item) ?? {}))
    .filter((group): group is SampleDesignGroup => Boolean(group));
  const biologicalSamples = sanitizeBiologicalSamples(
    value.biological_samples ?? value.biologicalSamples ?? value.sample_rows ?? value.sampleRows,
    groups,
  );
  const coverageCheck = asRecommendationRecord(value.coverage_check ?? value.coverageCheck);
  const coverageWarnings = [
    ...sanitizeStringList(coverageCheck?.warnings),
    ...sanitizeStringList(coverageCheck?.missing_biological_conditions ?? coverageCheck?.missingBiologicalConditions)
      .map((condition) => `AI coverage_check reports missing biological condition: ${condition}.`),
    ...sanitizeStringList(coverageCheck?.unresolved_conflicts ?? coverageCheck?.unresolvedConflicts)
      .map((conflict) => `AI coverage_check reports unresolved conflict: ${conflict}.`),
  ];
  return {
    groups,
    biologicalSamples,
    mappingRows: rawRecordList(value.mapping_rows ?? value.mappingRows),
    relationshipLayers: sanitizeBlueprintRelationshipLayers(value.relationship_layers ?? value.relationshipLayers),
    summary: cleanOneLineString(value.summary ?? value.rationale ?? (groups.length ? "AI generated sample design." : "AI returned no usable sample groups.")),
    sources: sanitizeTemplateReasonSources(value.sources ?? value.evidence_sources ?? value.import_highlights),
    groupingStrategy: sanitizeSampleGroupingStrategy(value.grouping_strategy ?? value.groupingStrategy ?? { candidate_grouping_fields: value.axis_review }),
    warnings: uniqueStrings([...sanitizeStringList(value.warnings ?? value.global_warnings ?? value.globalWarnings), ...coverageWarnings]),
    rawJson: value,
  };
}

function sanitizeStoredSampleDesignDraft(value: unknown): SampleDesignDraft | null {
  const record = asRecommendationRecord(value);
  if (!record) return null;
  const runtimeGroups = Array.isArray(record.groups) ? record.groups : null;
  const firstGroup = rawRecordList(runtimeGroups)[0];
  const looksLikeRuntimeDraft = Boolean(
    runtimeGroups
    && (
      record.rawJson
      || record.mappingRows
      || firstGroup?.groupName
      || firstGroup?.namingPrefix
      || firstGroup?.sampleCount
    ),
  );
  if (looksLikeRuntimeDraft) {
    const draft = sanitizeSampleDesignDraft(sampleDraftToJson(record as unknown as SampleDesignDraft));
    if (draft.groups.length || draft.biologicalSamples?.length || cleanOneLineString(draft.summary) || draft.sources.length) return draft;
  }
  const draft = sanitizeSampleDesignDraft(record);
  if (draft.groups.length || draft.biologicalSamples?.length || cleanOneLineString(draft.summary) || draft.sources.length) return draft;
  return null;
}

function sanitizeBlueprintRelationshipLayers(value: unknown): BlueprintRelationshipLayer[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map((item): BlueprintRelationshipLayer | null => {
    const record = asRecommendationRecord(item);
    if (!record) {
      const field = cleanOneLineString(item);
      return field ? { field, label: field, role: "metadata" } : null;
    }
    const field = cleanOneLineString(record.field ?? record.key ?? record.name);
    if (!field) return null;
    const label = cleanOneLineString(record.label ?? record.title ?? field);
    const role = cleanOneLineString(record.role ?? record.classification ?? record.kind) || "metadata";
    return {
      field,
      label: label || field,
      role,
      source: cleanOneLineString(record.source ?? record.axis ?? record.source_field),
      reason: cleanEvidenceText(record.reason ?? record.rationale ?? record.explanation),
    };
  }).filter((item): item is BlueprintRelationshipLayer => Boolean(item));
}

function sanitizeSampleGroupingStrategy(value: unknown): SampleGroupingStrategy | undefined {
  const record = asRecommendationRecord(value);
  if (!record) return undefined;
  const selectedGroupingFields = sanitizeStringList(record.selected_grouping_fields ?? record.selectedGroupingFields ?? record.fields);
  const candidateGroupingFields = sanitizeGroupingFieldDecisions(record.candidate_grouping_fields ?? record.candidateGroupingFields);
  const rejectedGroupingFields = sanitizeGroupingFieldDecisions(record.rejected_grouping_fields ?? record.rejectedGroupingFields);
  const reason = cleanEvidenceText(record.reason ?? record.rationale ?? record.explanation);
  const sources = sanitizeTemplateReasonSources(record.sources ?? record.evidence_sources ?? record.citations);
  if (!selectedGroupingFields.length && !candidateGroupingFields.length && !rejectedGroupingFields.length && !reason) return undefined;
  return { selectedGroupingFields, candidateGroupingFields, rejectedGroupingFields, reason, sources };
}

function sanitizeGroupingFieldDecisions(value: unknown): SampleGroupingFieldDecision[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map((item): SampleGroupingFieldDecision | null => {
    const record = asRecommendationRecord(item);
    if (!record) {
      const field = cleanOneLineString(item);
      return field ? { field, values: [], reason: "", sources: [] } : null;
    }
    const field = cleanOneLineString(record.field ?? record.name ?? record.key);
    if (!field) return null;
    return {
      field,
      values: sanitizeStringList(record.values ?? record.value ?? record.observed),
      classification: sanitizeFactorCandidateClassification(record.classification ?? record.category ?? record.role),
      reason: cleanEvidenceText(record.reason ?? record.rationale ?? record.explanation),
      sources: sanitizeTemplateReasonSources(record.sources ?? record.evidence_sources ?? record.citations),
    };
  }).filter((item): item is SampleGroupingFieldDecision => Boolean(item));
}

function sanitizeFactorCandidateClassification(value: unknown): FactorCandidateClassification | undefined {
  const normalized = cleanOneLineString(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "sample_constant"
    || normalized === "biological_factor"
    || normalized === "biological_replicate"
    || normalized === "assay_file_variable"
    || normalized === "rejected"
  ) {
    return normalized;
  }
  return undefined;
}

function buildSampleAssistantFillState(
  draft: SampleDesignDraft,
): {
  roster: SampleRosterItem[];
  assignmentsByField: Record<string, SampleAssignment[]>;
  assignmentOntologyTerms: Record<string, SampleOntologyTerm[]>;
  factorDrafts: Record<string, SampleFactorDraft>;
} {
  const sanitizedGroups = draft.groups.map(sanitizeSampleGroup).filter((group): group is SampleDesignGroup => Boolean(group));
  const allFields = getAllKnownSampleMetadataFields();
  const fieldByKey = new Map(allFields.map((field) => [field.key, field]));
  const roster: SampleRosterItem[] = [];
  const assignmentsByField: Record<string, SampleAssignment[]> = {};
  const assignmentOntologyTerms: Record<string, SampleOntologyTerm[]> = {};
  const factorDrafts: Record<string, SampleFactorDraft> = {};
  let nextSampleIndex = 1;

  const pushAssignment = (fieldKey: string, value: string, sampleIds: string[], term?: SampleOntologyTerm) => {
    const cleanValue = cleanOneLineString(value);
    if (!cleanValue || !sampleIds.length) return;
    const nextAssignments = (assignmentsByField[fieldKey] ?? []).map((assignment) => ({
      value: cleanOneLineString(assignment.value),
      termAccession: cleanOneLineString(assignment.termAccession),
      sampleIds: uniqueStrings(assignment.sampleIds),
    }));
    const cleanTermAccession = cleanOneLineString(term?.accession);
    const matchIndex = nextAssignments.findIndex((assignment) => (
      assignment.value.toLowerCase() === cleanValue.toLowerCase()
      && cleanOneLineString(assignment.termAccession).toLowerCase() === cleanTermAccession.toLowerCase()
    ));
    if (matchIndex >= 0) {
      nextAssignments[matchIndex] = {
        ...nextAssignments[matchIndex],
        sampleIds: uniqueStrings([...nextAssignments[matchIndex].sampleIds, ...sampleIds]),
        termAccession: nextAssignments[matchIndex].termAccession || cleanTermAccession,
      };
    } else {
      nextAssignments.push({
        value: cleanValue,
        termAccession: cleanTermAccession,
        sampleIds: uniqueStrings(sampleIds),
      });
    }
    assignmentsByField[fieldKey] = nextAssignments.filter((assignment) => assignment.value && assignment.sampleIds.length);
    if (term) {
      assignmentOntologyTerms[fieldKey] = dedupeSampleOntologyTerms([...(assignmentOntologyTerms[fieldKey] ?? []), term]);
    }
  };

  const biologicalSamples = expandAssistantBiologicalSamplesForDraft(draft)
    .filter((sample) => cleanOneLineString(sample.sourceName));
  if (biologicalSamples.length) {
    const resolveFactorField = (key: string) => allFields.find((field) => (
      Boolean(field.factorColumn)
      && (
        normalizedAxisName(field.key) === normalizedAxisName(key)
        || normalizedAxisName(field.factorColumn ?? "") === normalizedAxisName(key)
        || normalizedAxisName(sampleFactorLabelFromField(field)) === normalizedAxisName(key)
      )
    ));
    for (const sample of biologicalSamples) {
      const sampleId = `sample-${nextSampleIndex}`;
      roster.push({ id: sampleId, sourceName: cleanOneLineString(sample.sourceName).toLowerCase() });
      nextSampleIndex += 1;
      const termByField = new Map((sample.ontologyTerms ?? []).map((term) => [term.field, term]));
      for (const field of allFields) {
        const value = sampleFieldCellValue(field, sample.metadata);
        if (!value) continue;
        pushAssignment(field.key, value, [sampleId], termByField.get(field.key));
      }
      for (const key of sample.factorKeys ?? []) {
        const field = fieldByKey.get(key) ?? resolveFactorField(key);
        if (!field?.factorColumn) continue;
        factorDrafts[field.key] = {
          fieldKey: field.key,
          label: sampleFactorLabelFromField(field),
          enabled: true,
          source: "custom",
        };
      }
      for (const key of Object.keys(sample.factorValues ?? {})) {
        const field = resolveFactorField(key);
        if (!field?.factorColumn) continue;
        factorDrafts[field.key] = {
          fieldKey: field.key,
          label: sampleFactorLabelFromField(field),
          enabled: true,
          source: "custom",
        };
      }
    }
    return { roster, assignmentsByField, assignmentOntologyTerms, factorDrafts };
  }

  for (const group of sanitizedGroups) {
    const groupSampleIds = Array.from({ length: group.sampleCount }, (_, index) => {
      const sampleId = `sample-${nextSampleIndex}`;
      roster.push({ id: sampleId, sourceName: `${group.namingPrefix}_${String(index + 1).padStart(2, "0")}`.toLowerCase() });
      nextSampleIndex += 1;
      return sampleId;
    });
    const termByField = new Map(group.ontologyTerms.map((term) => [term.field, term]));
    for (const field of allFields) {
      const value = sampleFieldCellValue(field, group.metadata);
      if (!value) continue;
      pushAssignment(field.key, value, groupSampleIds, termByField.get(field.key));
    }
    for (const key of resolveSampleFactorKeys(group)) {
      const field = fieldByKey.get(key);
      if (!field?.factorColumn) continue;
      factorDrafts[key] = {
        fieldKey: key,
        label: sampleFactorLabelFromField(field),
        enabled: true,
        source: "custom",
      };
    }
  }

  return { roster, assignmentsByField, assignmentOntologyTerms, factorDrafts };
}

function sanitizeAiSampleGroup(record: Record<string, unknown>): SampleDesignGroup | null {
  const metadataRecord = asRecommendationRecord(record.metadata) ?? record;
  const metadataEvidenceRecord = asRecommendationRecord(record.metadata_evidence ?? record.metadataEvidence ?? record.evidence_by_field ?? record.sources_by_field) ?? {};
  const metadata: Partial<Record<SampleMetadataKey, string>> = {};
  const metadataEvidence: Partial<Record<SampleMetadataKey, SampleMetadataEvidence>> = {};
  for (const field of getAllKnownSampleMetadataFields()) {
    const raw = readSampleMetadataRecordValue(metadataRecord, field);
    const parsed = sanitizeAiMetadataValue(field, raw, readSampleMetadataRecordValue(metadataEvidenceRecord, field));
    if (parsed.value) metadata[field.key] = parsed.value;
    if (parsed.evidence) metadataEvidence[field.key] = parsed.evidence;
  }
  const groupName = cleanOneLineString(record.group_name ?? record.groupName ?? record.name ?? metadata.disease ?? "Sample group");
  const sampleCount = Math.max(1, Math.min(200, Math.floor(Number(record.sample_count ?? record.sampleCount ?? record.count ?? 1))));
  const namingPrefix = cleanSamplePrefix(String(record.naming_prefix ?? record.namingPrefix ?? record.prefix ?? groupName));
  const ontologyTerms = Array.isArray(record.ontology_terms)
    ? record.ontology_terms.map((item) => sanitizeSampleOntologyTerm(asRecommendationRecord(item) ?? {})).filter((term): term is SampleOntologyTerm => Boolean(term))
    : [];
  const factorKeys = sanitizeSampleFactorKeys(record.factor_values ?? record.factorValues ?? record.study_variables ?? record.studyVariables);
  return sanitizeSampleGroup({
    id: createBlueprintId("ai-sample-group", groupName),
    groupName,
    sampleCount,
    namingPrefix,
    metadata,
    metadataEvidence,
    ontologyTerms,
    factorKeys,
    assayContext: sanitizeAssayContext(record.assay_context ?? record.assayContext),
    warnings: sanitizeStringList(record.warnings ?? record.warning),
  });
}

function sampleMetadataFieldAliases(field: SampleMetadataField): string[] {
  const snakeKey = field.key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
  const aliases = [
    field.key,
    snakeKey,
    field.column,
    field.factorColumn,
    field.label,
    field.displayLabel,
    sdrfColumnSemanticKey(field.column),
    field.factorColumn ? sdrfColumnSemanticKey(field.factorColumn) : "",
  ];
  if (normalizedAxisName(field.key) === "timepoint") {
    aliases.push("timepoint", "time point", "sampling time", "samplingTime", "sampling_time", "exposure duration");
  }
  if (normalizedAxisName(field.key) === "age") {
    aliases.push("age", "age years", "age (years)", "age_years", "age_at_sampling");
  }
  if (normalizedAxisName(field.key) === "sex") {
    aliases.push("sex", "gender", "biological sex", "biological_sex");
  }
  if (normalizedAxisName(field.key) === "disease") {
    aliases.push("disease", "diagnosis", "condition", "cause of death", "cause_of_death", "medical condition");
  }
  if (normalizedAxisName(field.key) === "individual") {
    aliases.push("individual", "subject", "subject id", "subject_id", "donor", "donor id", "donor_id", "sample id", "sample_id");
  }
  return uniqueStrings(aliases.map(cleanOneLineString).filter(Boolean));
}

function readSampleMetadataRecordValue(record: Record<string, unknown>, field: SampleMetadataField): unknown {
  for (const alias of sampleMetadataFieldAliases(field)) {
    if (Object.prototype.hasOwnProperty.call(record, alias)) return record[alias];
  }
  const compactLookup = new Map<string, unknown>();
  Object.entries(record).forEach(([key, value]) => compactLookup.set(normalizedAxisName(key), value));
  for (const alias of sampleMetadataFieldAliases(field)) {
    const value = compactLookup.get(normalizedAxisName(alias));
    if (value !== undefined) return value;
  }
  return undefined;
}

function sanitizeAiMetadataValue(
  field: SampleMetadataField,
  rawValue: unknown,
  rawEvidence?: unknown,
): { value: string; evidence?: SampleMetadataEvidence } {
  const valueRecord = asRecommendationRecord(rawValue);
  const evidenceRecord = asRecommendationRecord(rawEvidence);
  const value = cleanOneLineString(
    valueRecord
      ? valueRecord.value ?? valueRecord.label ?? valueRecord.text ?? valueRecord.normalized_value ?? valueRecord.normalizedValue
      : rawValue,
  );
  const evidenceSource = valueRecord ?? evidenceRecord;
  const reason = evidenceSource
    ? cleanEvidenceText(evidenceSource.reason ?? evidenceSource.why ?? evidenceSource.rationale ?? evidenceSource.explanation ?? evidenceSource.evidence)
    : "";
  const sources = evidenceSource
    ? sanitizeTemplateReasonSources(
      evidenceSource.sources
        ?? evidenceSource.source
        ?? evidenceSource.evidence_sources
        ?? evidenceSource.evidenceSources
        ?? evidenceSource.citations
        ?? evidenceSource.citation,
    )
    : [];
  const confidence = Number(evidenceSource?.confidence);
  return {
    value,
    evidence: value && (reason || sources.length)
      ? {
        field: field.key,
        value,
        reason,
        sources,
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : undefined,
      }
      : undefined,
  };
}

function sanitizeSampleFactorKeys(value: unknown): SampleFactorKey[] {
  const raw = sampleFactorKeyInputItems(value);
  const byColumn = new Map<string, SampleFactorKey>();
  const addAlias = (alias: string | undefined, factorKey: SampleFactorKey) => {
    const clean = cleanOneLineString(alias).toLowerCase();
    if (clean) byColumn.set(clean, factorKey);
    const compact = normalizedAxisName(alias ?? "");
    if (compact) byColumn.set(compact, factorKey);
  };
  for (const field of getAllKnownSampleMetadataFields().filter((item) => item.factorKey)) {
    for (const alias of [field.factorKey, field.factorColumn, field.column, field.label, ...sampleMetadataFieldAliases(field)]) {
      if (field.factorKey) addAlias(alias, field.factorKey);
    }
  }
  const keys = raw
    .map((item) => byColumn.get(cleanOneLineString(item).toLowerCase()) ?? byColumn.get(normalizedAxisName(cleanOneLineString(item))))
    .filter((item): item is SampleFactorKey => Boolean(item));
  return keys.length ? keys.filter((key, index, list) => list.indexOf(key) === index) : [...DEFAULT_SAMPLE_FACTOR_KEYS];
}

function sampleFactorKeyInputItems(value: unknown): unknown[] {
  if (!value) return DEFAULT_SAMPLE_FACTOR_KEYS;
  if (Array.isArray(value)) return value.flatMap(sampleFactorKeyInputItems);
  const record = asRecommendationRecord(value);
  if (!record) return [value];
  const explicit = record.field ?? record.key ?? record.name ?? record.factor_column ?? record.factorColumn ?? record.column;
  if (explicit) return [explicit];
  return Object.keys(record);
}

function sanitizeSampleOntologyTerm(record: Record<string, unknown>): SampleOntologyTerm | null {
  const field = record.field;
  if (!getAllKnownSampleMetadataFields().some((item) => item.key === field)) return null;
  const label = cleanOneLineString(record.label ?? record.value);
  const accession = cleanOneLineString(record.accession ?? record.term_accession ?? record.id);
  const ontology = cleanOneLineString(record.ontology ?? record.source ?? record.prefix);
  if (!label || !accession || !ontology) return null;
  return { field: field as SampleMetadataKey, label, accession, ontology, reason: cleanOneLineString(record.reason) };
}

export function shouldReloadBlankAppRoot(root: HTMLElement | null): boolean {
  if (!root) return false;
  const text = root.textContent?.replace(/\s+/g, "").trim() ?? "";
  if (text) return false;
  return !root.querySelector(".content-grid, .app-shell, .loading-state, .main");
}

function schedulePostAcceptBlankPageRecovery() {
  if (typeof window === "undefined") return;
  let recovered = false;
  const recoverIfBlank = () => {
    if (recovered) return;
    if (!shouldReloadBlankAppRoot(document.getElementById("root"))) return;
    recovered = true;
    window.location.reload();
  };
  window.setTimeout(recoverIfBlank, 300);
  window.setTimeout(recoverIfBlank, 1200);
}

export function SamplesStep({
  projectId,
  analysis,
  table,
  refresh,
}: {
  projectId: string;
  analysis?: Awaited<ReturnType<typeof api.getAnalysis>>;
  table?: Awaited<ReturnType<typeof api.getSdrfTable>>;
  refresh: () => void;
}) {
  const savedSessionState = useMemo(() => readSessionUiState(projectId), [projectId]);
  const sampleAiMutationKey = useMemo(() => ["sample-design-ai", projectId] as const, [projectId]);
  const sampleAiMutations = useMutationState({
    filters: { mutationKey: sampleAiMutationKey },
    select: (mutation): SampleAiMutationSnapshot => ({
      status: mutation.state.status,
      submittedAt: mutation.state.submittedAt,
      data: mutation.state.data,
      error: mutation.state.error,
    }),
  });
  const activeSampleAiMutations = useIsMutating({ mutationKey: sampleAiMutationKey });
  const latestSampleAiMutation = useMemo(
    () => sampleAiMutations.reduce<SampleAiMutationSnapshot | null>((latest, item) => (
      !latest || item.submittedAt >= latest.submittedAt ? item : latest
    ), null),
    [sampleAiMutations],
  );
  const sampleQuestions = analysis?.questions?.filter((item) => item.step === "samples") ?? [];
  const selectedTemplateIds = useMemo(() => sanitizeTemplateIds(savedSessionState.templates?.selectedTemplates), [savedSessionState]);
  const selectedTemplateKey = selectedTemplateIds.join("|");
  const cellLineAnnotationEnabled = selectedTemplateIds.includes("cell-lines");
  const templateDrivenSampleMetadata = selectedTemplateIds.length > 0;
  const [sampleContext, setSampleContext] = useState<SampleContextMode>(() => inferSampleContextFromTemplates(savedSessionState.templates?.selectedTemplates));
  const [manualGroup, setManualGroup] = useState<SampleDesignGroup>(() => createEmptySampleGroup());
  const [sampleCountInput, setSampleCountInput] = useState("3");
  const [rosterCountInput, setRosterCountInput] = useState("3");
  const [sampleNamingMode, setSampleNamingMode] = useState<SampleRosterNamingMode>("auto");
  const [sampleNamingPatternId, setSampleNamingPatternId] = useState<SampleRosterNamingPatternId>("sample-underscore");
  const [customSampleNamesInput, setCustomSampleNamesInput] = useState(() => createSampleRoster(3).map((sample) => sample.sourceName).join(", "));
  const [sampleRoster, setSampleRoster] = useState<SampleRosterItem[]>(() => createSampleRoster(3));
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, SampleAssignmentDraft>>({});
  const [assignmentsByField, setAssignmentsByField] = useState<Record<string, SampleAssignment[]>>({});
  const [assignmentOntologyTerms, setAssignmentOntologyTerms] = useState<Record<string, SampleOntologyTerm[]>>({});
  const [assignmentOntologySearches, setAssignmentOntologySearches] = useState<Record<string, SampleOntologySearchState>>({});
  const [activeSamplePickerField, setActiveSamplePickerField] = useState<SampleMetadataKey | null>(null);
  const [factorDrafts, setFactorDrafts] = useState<Record<string, SampleFactorDraft>>({});
  const [customFactorFieldKey, setCustomFactorFieldKey] = useState<SampleMetadataKey | "">("");
  const [customFactorLabel, setCustomFactorLabel] = useState("");
  const [manualGroups, setManualGroups] = useState<SampleDesignGroup[]>([]);
  const [ontologyField, setOntologyField] = useState<SampleMetadataKey>("organism");
  const [ontologyQuery, setOntologyQuery] = useState("");
  const [manualOntologySearch, setManualOntologySearch] = useState<SampleOntologySearchState | null>(null);
  const [sampleStatus, setSampleStatus] = useState("");
  const [aiDraft, setAiDraft] = useState<SampleDesignDraft | null>(() => sanitizeStoredSampleDesignDraft(savedSessionState.samples?.aiDraft));
  const [aiError, setAiError] = useState(() => cleanOneLineString(savedSessionState.samples?.aiError));
  const [sampleSourcesOpen, setSampleSourcesOpen] = useState(true);
  useEffect(() => {
    const sampleState = readSessionUiState(projectId).samples;
    setAiDraft(sanitizeStoredSampleDesignDraft(sampleState?.aiDraft));
    setAiError(cleanOneLineString(sampleState?.aiError));
  }, [projectId]);
  const currentSdrfMetadataFields = useMemo(
    () => sampleMetadataFieldsFromSdrfSummary(buildSdrfTableSummaryForSampleAi(table)),
    [table],
  );
  const visibleMetadataFields = useMemo(() => {
    const baseFields = templateDrivenSampleMetadata
      ? getSampleMetadataFieldsForTemplates(selectedTemplateIds)
      : getSampleMetadataFieldsForContext(sampleContext);
    return mergeSampleMetadataFields([...baseFields, ...currentSdrfMetadataFields]);
  }, [sampleContext, selectedTemplateKey, templateDrivenSampleMetadata, currentSdrfMetadataFields]);
  const metadataSections = useMemo(() => ([
    { id: "required", title: "Required", fields: visibleMetadataFields.filter((field) => field.requirement === "required") },
    { id: "recommended", title: "Recommended", fields: visibleMetadataFields.filter((field) => field.requirement === "recommended") },
    { id: "context", title: "Context fields", fields: visibleMetadataFields.filter((field) => field.requirement === "context") },
    { id: "optional", title: "Optional", fields: visibleMetadataFields.filter((field) => field.requirement === "optional") },
  ].filter((section) => section.fields.length)), [visibleMetadataFields]);
  const sampleFactorFields = useMemo(() => visibleMetadataFields.filter((field) => field.factorKey && field.factorColumn), [visibleMetadataFields]);
  const batchFields = useMemo<SampleFieldDescriptor[]>(() => visibleMetadataFields.map((field) => ({
    key: field.key,
    column: field.column,
    factorColumn: field.factorColumn,
    label: sampleFactorLabelFromField(field),
  })), [visibleMetadataFields]);
  const fieldByKey = useMemo(() => new Map(visibleMetadataFields.map((field) => [field.key, field])), [visibleMetadataFields]);
  const enrichSampleDraftWithCellLineAnnotations = useCallback((draft: SampleDesignDraft) => applyCellLineAnnotationsToSampleDraft({
    enabled: cellLineAnnotationEnabled,
    draft,
    fields: visibleMetadataFields.map((field) => ({ key: field.key, column: field.column })),
  }), [cellLineAnnotationEnabled, visibleMetadataFields]);
  const manualOntologyField = fieldByKey.get(ontologyField);
  const manualOntologyQuery = cleanOneLineString(ontologyQuery || manualGroup.metadata[ontologyField] || "");
  const ontologyResults = useMemo(
    () => manualOntologyField ? mergeSampleOntologyResults(manualOntologyField, manualOntologyQuery, manualOntologySearch) : [],
    [manualOntologyField, manualOntologyQuery, manualOntologySearch],
  );
  const assignmentOntologyRequests = useMemo(() => visibleMetadataFields
    .filter((field) => field.ontology && field.inputType !== "select")
    .map((field) => ({ field, query: cleanOneLineString(assignmentDrafts[field.key]?.value) }))
    .filter((request) => request.query.length >= 2), [assignmentDrafts, visibleMetadataFields]);
  const assignmentOntologyRequestKey = useMemo(() => assignmentOntologyRequests
    .map(({ field, query }) => `${field.key}:${query}:${getSampleOntologyFieldOntologies(field).join(",")}`)
    .join("\n"), [assignmentOntologyRequests]);
  const sampleNameById = useMemo(() => new Map(sampleRoster.map((sample) => [sample.id, cleanOneLineString(sample.sourceName) || sample.id])), [sampleRoster]);
  const detectedFactors = useMemo(
    () => detectGroupingCandidates({ roster: sampleRoster, fields: batchFields, assignmentsByField }),
    [sampleRoster, batchFields, assignmentsByField],
  );
  const detectedFactorByField = useMemo(() => new Map(detectedFactors.map((candidate) => [candidate.fieldKey, candidate])), [detectedFactors]);
  const activeFactorSelections = useMemo<SampleFactorSelection[]>(
    () => Object.values(factorDrafts).filter((selection) => selection.enabled && cleanOneLineString(selection.label)),
    [factorDrafts],
  );
  const selectedContext = SAMPLE_CONTEXT_OPTIONS.find((option) => option.id === sampleContext) ?? SAMPLE_CONTEXT_OPTIONS[0];
  const selectedTemplateSummary = selectedTemplateIds
    .map((id) => getTemplateById(id)?.title)
    .filter((title): title is string => Boolean(title))
    .join(", ");
  const normalizedRosterCount = normalizeRosterCount(rosterCountInput);
  const sampleNamingPatternOptions = useMemo(
    () => SAMPLE_ROSTER_NAMING_PATTERNS.map((option) => {
      const displayLabel = createSampleRosterFromPattern(1, option.pattern)[0]?.sourceName ?? option.label;
      const preview = createSampleRosterFromPattern(Math.min(3, normalizedRosterCount), option.pattern)
        .map((sample) => sample.sourceName)
        .join(", ");
      return { ...option, displayLabel, preview };
    }),
    [normalizedRosterCount],
  );
  useEffect(() => {
    setFactorDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const candidate of detectedFactors) {
        if (!next[candidate.fieldKey]) {
          next[candidate.fieldKey] = {
            fieldKey: candidate.fieldKey,
            label: candidate.label,
            enabled: true,
            source: "detected",
          };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [detectedFactors]);
  useEffect(() => {
    if (!customFactorFieldKey || fieldByKey.has(customFactorFieldKey)) return;
    setCustomFactorFieldKey("");
  }, [customFactorFieldKey, fieldByKey, visibleMetadataFields]);
  useEffect(() => {
    if (!activeSamplePickerField) return;
    if (fieldByKey.has(activeSamplePickerField)) return;
    setActiveSamplePickerField(null);
  }, [activeSamplePickerField, fieldByKey]);
  useEffect(() => {
    if (!assignmentOntologyRequests.length) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      for (const { field, query } of assignmentOntologyRequests) {
        setAssignmentOntologySearches((current) => ({
          ...current,
          [field.key]: {
            field: field.key,
            query,
            results: current[field.key]?.query === query ? current[field.key].results : [],
            loading: true,
          },
        }));

        searchOlsTerms(
          { query, ontology: getSampleOntologyFieldOntologies(field), rows: 15 },
          { signal: controller.signal },
        )
          .then((response) => {
            if (controller.signal.aborted) return;
            const results = response.suggestions
              .map((term) => sampleOntologyTermFromLookupTerm(field, term))
              .filter((term): term is SampleOntologyTerm => Boolean(term));
            setAssignmentOntologySearches((current) => ({
              ...current,
              [field.key]: {
                field: field.key,
                query,
                results: dedupeSampleOntologyTerms(results),
                loading: false,
              },
            }));
          })
          .catch((error) => {
            if (controller.signal.aborted || isAbortError(error)) return;
            setAssignmentOntologySearches((current) => ({
              ...current,
              [field.key]: {
                field: field.key,
                query,
                results: current[field.key]?.query === query ? current[field.key].results : [],
                loading: false,
                error: error instanceof Error ? error.message : "Ontology search failed.",
              },
            }));
          });
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [assignmentOntologyRequestKey]);
  useEffect(() => {
    if (!manualOntologyField || manualOntologyQuery.length < 2) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setManualOntologySearch((current) => ({
        field: manualOntologyField.key,
        query: manualOntologyQuery,
        results: current?.field === manualOntologyField.key && current.query === manualOntologyQuery ? current.results : [],
        loading: true,
      }));

      searchOlsTerms(
        { query: manualOntologyQuery, ontology: getSampleOntologyFieldOntologies(manualOntologyField), rows: 15 },
        { signal: controller.signal },
      )
        .then((response) => {
          if (controller.signal.aborted) return;
          const results = response.suggestions
            .map((term) => sampleOntologyTermFromLookupTerm(manualOntologyField, term))
            .filter((term): term is SampleOntologyTerm => Boolean(term));
          setManualOntologySearch({
            field: manualOntologyField.key,
            query: manualOntologyQuery,
            results: dedupeSampleOntologyTerms(results),
            loading: false,
          });
        })
        .catch((error) => {
          if (controller.signal.aborted || isAbortError(error)) return;
          setManualOntologySearch((current) => ({
            field: manualOntologyField.key,
            query: manualOntologyQuery,
            results: current?.field === manualOntologyField.key && current.query === manualOntologyQuery ? current.results : [],
            loading: false,
            error: error instanceof Error ? error.message : "Ontology search failed.",
          }));
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [manualOntologyField, manualOntologyQuery]);
  const applySampleDraft = useMutation({
    mutationFn: (draft: SampleDesignDraft) => {
      const baseTable = table ?? createEmptySdrfTable(projectId);
      return api.putSdrfTable(projectId, mergeSampleDraftIntoTable(baseTable, draft));
    },
    onSuccess: () => {
      setSampleStatus("Sample design applied to the SDRF table.");
      refresh();
    },
    onError: (error) => {
      setSampleStatus(error instanceof Error ? error.message : "Unable to apply sample design.");
    },
  });
  const applyBatchDesign = useMutation({
    mutationFn: () => {
      const baseTable = table ?? createEmptySdrfTable(projectId);
      const normalizedRoster = sampleRoster.map((sample, index) => ({
        ...sample,
        sourceName: cleanOneLineString(sample.sourceName) || `sample_${String(index + 1).padStart(2, "0")}`,
      }));
      return api.putSdrfTable(
        projectId,
        mergeSampleAssignmentsIntoTable(baseTable, normalizedRoster, batchFields, assignmentsByField, activeFactorSelections),
      );
    },
    onSuccess: () => {
      setSampleStatus("Sample design applied to the SDRF table.");
      refresh();
    },
    onError: (error) => {
      setSampleStatus(error instanceof Error ? error.message : "Unable to apply sample design.");
    },
  });
  const runSampleAi = useMutation({
    mutationKey: sampleAiMutationKey,
    mutationFn: async () => {
      const config = readClientAiConfig();
      const localInput = buildSampleAiInput(projectId, savedSessionState, analysis);
      const backendEvidenceInput = await api.buildSampleDesignAiInput(projectId);
      let input = mergeBackendSampleAiEvidenceInput(localInput, backendEvidenceInput);
      if (getPublicationDocumentsWithPages(input).length) {
        const pdfFactsInput = buildPdfExperimentFactsInput(input);
        const pdfFactsPayload = buildPdfExperimentFactsRequestPayload(pdfFactsInput, config);
        const savedPdfPrompt = await api.saveSampleAiPrompt(projectId, pdfFactsPayload);
        setSampleStatus(`PDF evidence prompt saved to ${savedPdfPrompt.path}. AI is reading the publication before building the sample draft...`);
        const pdfFacts = await requestPdfExperimentFacts(pdfFactsInput, config, pdfFactsPayload);
        input = withPublicationPdfFacts(input, pdfFacts);
      }
      const requestPayload = buildSampleDesignRequestPayload(input, config);
      const savedPrompt = await api.saveSampleAiPrompt(projectId, requestPayload);
      setSampleStatus(`AI prompt saved to ${savedPrompt.path}. AI is building a sample JSON and core mapping draft...`);
      return requestSampleDesignDraft(input, config, requestPayload);
    },
    onMutate: () => {
      setAiError("");
      setSampleStatus("AI is building a sample JSON and core mapping draft...");
      updateSampleAiSessionState(projectId, { aiStatus: "running", aiError: "" });
    },
    onSuccess: (draft) => {
      const enriched = enrichSampleDraftWithCellLineAnnotations(draft);
      const finalDraft = enriched.draft;
      setAiDraft(finalDraft);
      setSampleStatus(formatCellLineAnnotationReport(enriched.report) || "AI sample JSON and core mapping parsed. Review it, then apply when ready.");
      updateSampleAiSessionState(projectId, {
        aiDraft: sampleDraftToSessionJson(finalDraft),
        aiStatus: "success",
        aiError: "",
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "AI sample draft failed.";
      setAiError(message);
      setSampleStatus(message);
      updateSampleAiSessionState(projectId, { aiStatus: "error", aiError: message });
    },
  });
  useEffect(() => {
    if (!latestSampleAiMutation) return;
    if (latestSampleAiMutation.status === "pending") {
      setAiError("");
      return;
    }
    if (latestSampleAiMutation.status === "success") {
      const draft = sanitizeStoredSampleDesignDraft(latestSampleAiMutation.data);
      if (!draft) return;
      const enriched = enrichSampleDraftWithCellLineAnnotations(draft);
      const finalDraft = enriched.draft;
      setAiDraft(finalDraft);
      setAiError("");
      setSampleStatus(formatCellLineAnnotationReport(enriched.report) || "AI sample JSON and core mapping parsed. Review it, then apply when ready.");
      updateSampleAiSessionState(projectId, {
        aiDraft: sampleDraftToSessionJson(finalDraft),
        aiStatus: "success",
        aiError: "",
      });
      return;
    }
    if (latestSampleAiMutation.status === "error") {
      const message = latestSampleAiMutation.error instanceof Error
        ? latestSampleAiMutation.error.message
        : "AI sample draft failed.";
      setAiError(message);
      setSampleStatus(message);
      updateSampleAiSessionState(projectId, { aiStatus: "error", aiError: message });
    }
  }, [projectId, latestSampleAiMutation?.status, latestSampleAiMutation?.submittedAt, enrichSampleDraftWithCellLineAnnotations]);
  const fillSampleDraftIntoAttributes = useCallback((draft: SampleDesignDraft) => {
    try {
      const enriched = enrichSampleDraftWithCellLineAnnotations(draft);
      const annotationSummary = formatCellLineAnnotationReport(enriched.report);
      const normalized = sanitizeSampleDesignDraft(sampleDraftToJson(enriched.draft));
      const fillState = buildSampleAssistantFillState(normalized);
      if (!fillState.roster.length) {
        setSampleStatus("No usable sample groups were returned for the left-side editor.");
        return;
      }
      setRosterCountInput(String(fillState.roster.length));
      setSampleRoster(fillState.roster);
      setSampleNamingMode("custom");
      setCustomSampleNamesInput(fillState.roster.map((sample) => cleanOneLineString(sample.sourceName)).filter(Boolean).join(", "));
      setAssignmentsByField(fillState.assignmentsByField);
      setAssignmentDrafts({});
      setAssignmentOntologyTerms(fillState.assignmentOntologyTerms);
      setFactorDrafts(fillState.factorDrafts);
      setActiveSamplePickerField(null);
      const persisted = updateSampleAiSessionState(projectId, {
        acceptedDraft: sampleDraftToSessionJson(normalized),
        acceptedUpdatedAt: new Date().toISOString(),
      });
      setSampleStatus(
        persisted
          ? `${annotationSummary ? `${annotationSummary} ` : ""}AI JSON filled into the left-side sample attributes. Review the assignments, then apply sample design.`
          : `${annotationSummary ? `${annotationSummary} ` : ""}AI JSON filled into the left-side sample attributes. Review the assignments, then apply sample design. Session storage was not updated.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to accept AI sample draft.";
      setAiError(message);
      setSampleStatus(message);
    } finally {
      schedulePostAcceptBlankPageRecovery();
    }
  }, [projectId, enrichSampleDraftWithCellLineAnnotations]);
  const cleanRosterSampleName = (sample: SampleRosterItem, index: number) => cleanOneLineString(sample.sourceName) || `sample_${String(index + 1).padStart(2, "0")}`;
  function normalizeRosterCount(value: string) {
    return Math.max(1, Math.min(200, Math.floor(Number(value) || 1)));
  }
  function syncRosterToAssignments(nextRoster: SampleRosterItem[]) {
    const validIds = new Set(nextRoster.map((sample) => sample.id));
    setAssignmentsByField((current) => syncAssignmentsToRoster(current, validIds));
    setAssignmentDrafts((current) => syncDraftsToRoster(current, validIds));
  }
  function parseCustomSampleNames(value: string) {
    return value
      .split(",")
      .map((item) => cleanOneLineString(item))
      .filter((item): item is string => Boolean(item))
      .slice(0, 200);
  }
  function applySampleRoster(nextRoster: SampleRosterItem[], status?: string) {
    setSampleRoster(nextRoster);
    syncRosterToAssignments(nextRoster);
    if (status) setSampleStatus(status);
  }
  function applyAutoNamingPattern(patternId: SampleRosterNamingPatternId, countValue = rosterCountInput) {
    const count = normalizeRosterCount(countValue);
    const option = SAMPLE_ROSTER_NAMING_PATTERNS.find((item) => item.id === patternId) ?? SAMPLE_ROSTER_NAMING_PATTERNS[0];
    setSampleNamingMode("auto");
    setSampleNamingPatternId(option.id);
    setRosterCountInput(String(count));
    applySampleRoster(createSampleRosterFromPattern(count, option.pattern), `${count} sample${count === 1 ? "" : "s"} generated from ${option.label}.`);
  }
  function applyCustomSampleNames() {
    const names = parseCustomSampleNames(customSampleNamesInput);
    if (!names.length) {
      setSampleStatus("Enter comma-separated sample names first.");
      return;
    }
    const roster = names.map((name, index) => ({
      id: `sample-${index + 1}`,
      sourceName: name,
    }));
    setSampleNamingMode("custom");
    setRosterCountInput(String(roster.length));
    setCustomSampleNamesInput(names.join(", "));
    applySampleRoster(roster, `${roster.length} custom sample${roster.length === 1 ? "" : "s"} applied to the roster.`);
  }
  const syncAssignmentsToRoster = (current: Record<string, SampleAssignment[]>, validIds: Set<string>) => {
    const next = Object.fromEntries(
      Object.entries(current)
        .map(([fieldKey, assignments]) => {
          const nextAssignments = assignments
            .map((assignment) => ({
              value: cleanOneLineString(assignment.value),
              termAccession: cleanOneLineString(assignment.termAccession),
              sampleIds: uniqueStrings((assignment.sampleIds ?? []).filter((sampleId) => validIds.has(sampleId))),
            }))
            .filter((assignment) => assignment.value && assignment.sampleIds.length);
          return [fieldKey, nextAssignments] as const;
        })
        .filter(([, assignments]) => assignments.length),
    );
    return next as Record<string, SampleAssignment[]>;
  };
  const syncDraftsToRoster = (current: Record<string, SampleAssignmentDraft>, validIds: Set<string>) => {
    const next = Object.fromEntries(
      Object.entries(current)
        .map(([fieldKey, draft]) => {
          const sampleIds = uniqueStrings((draft.sampleIds ?? []).filter((sampleId) => validIds.has(sampleId)));
          return [fieldKey, { value: cleanOneLineString(draft.value), sampleIds }] as const;
        }),
    );
    return next as Record<string, SampleAssignmentDraft>;
  };
  const updateSampleNamingMode = (mode: SampleRosterNamingMode) => {
    if (mode === "auto") {
      applyAutoNamingPattern(sampleNamingPatternId, rosterCountInput);
      return;
    }
    if (sampleNamingMode !== "custom") {
      setCustomSampleNamesInput(sampleRoster.map((sample) => cleanOneLineString(sample.sourceName)).filter(Boolean).join(", "));
    }
    setSampleNamingMode(mode);
  };
  const updateRosterCountInput = (value: string) => {
    const nextValue = value.replace(/[^\d]/g, "").slice(0, 3);
    setRosterCountInput(nextValue);
    if (sampleNamingMode === "auto" && nextValue) {
      applyAutoNamingPattern(sampleNamingPatternId, nextValue);
    }
  };
  const updateAssignmentDraftValue = (fieldKey: string, value: string) => {
    setAssignmentDrafts((current) => ({
      ...current,
      [fieldKey]: { ...(current[fieldKey] ?? { value: "", sampleIds: [] }), value },
    }));
  };
  const normalizeAssignmentSampleIds = (sampleIds: string[]) => {
    const validSampleIds = new Set(sampleRoster.map((sample) => sample.id));
    return uniqueStrings(sampleIds.filter((sampleId) => validSampleIds.has(sampleId)));
  };
  const getAssignmentDraftValue = (field: SampleMetadataField, draft: SampleAssignmentDraft | undefined) => (
    field.inputType === "select" ? draft?.value || field.options?.[0] || "" : draft?.value ?? ""
  );
  const updateAssignmentSampleIds = (fieldKey: string, sampleIds: string[]) => {
    setAssignmentDrafts((current) => ({
      ...current,
      [fieldKey]: {
        ...(current[fieldKey] ?? { value: "", sampleIds: [] }),
        sampleIds: normalizeAssignmentSampleIds(sampleIds),
      },
    }));
  };
  const openSamplePicker = (fieldKey: string) => {
    setActiveSamplePickerField(fieldKey);
  };
  const closeSamplePicker = () => {
    setActiveSamplePickerField(null);
  };
  const toggleAssignmentSample = (fieldKey: string, sampleId: string) => {
    setAssignmentDrafts((current) => {
      const draft = current[fieldKey] ?? { value: "", sampleIds: [] };
      const sampleIds = draft.sampleIds.includes(sampleId)
        ? draft.sampleIds.filter((item) => item !== sampleId)
        : [...draft.sampleIds, sampleId];
      return {
        ...current,
        [fieldKey]: { ...draft, sampleIds: uniqueStrings(sampleIds) },
      };
    });
  };
  const selectAllAssignmentSamples = (fieldKey: string) => {
    setAssignmentDrafts((current) => ({
      ...current,
      [fieldKey]: {
        ...(current[fieldKey] ?? { value: "", sampleIds: [] }),
        sampleIds: sampleRoster.map((sample) => sample.id),
      },
    }));
  };
  const clearAssignmentSamples = (fieldKey: string) => {
    setAssignmentDrafts((current) => ({
      ...current,
      [fieldKey]: {
        ...(current[fieldKey] ?? { value: "", sampleIds: [] }),
        sampleIds: [],
      },
    }));
  };
  const commitFieldAssignment = (field: SampleMetadataField, rawValue: string, rawSampleIds: string[], term?: SampleOntologyTerm) => {
    const value = cleanOneLineString(rawValue);
    const sampleIds = normalizeAssignmentSampleIds(rawSampleIds);
    if (!value || !sampleIds.length) return false;
    const matchedTerm = term ?? lookupSampleOntologyTermForValue(field, value, assignmentOntologyTerms[field.key] ?? []);
    const termAccession = cleanOneLineString(matchedTerm?.accession);
    let nextStatus = `${sampleFieldDisplayLabel(field)} assigned to ${sampleIds.length} sample${sampleIds.length === 1 ? "" : "s"}.`;
    setAssignmentsByField((current) => {
      const nextAssignments = (current[field.key] ?? [])
        .map((assignment) => ({
          value: cleanOneLineString(assignment.value),
          termAccession: cleanOneLineString(assignment.termAccession),
          sampleIds: uniqueStrings(assignment.sampleIds.filter((sampleId) => !sampleIds.includes(sampleId))),
        }))
        .filter((assignment) => assignment.value && assignment.sampleIds.length);
      const matchingIndex = nextAssignments.findIndex((assignment) => assignment.value.toLowerCase() === value.toLowerCase());
      if (matchingIndex >= 0) {
        nextAssignments[matchingIndex] = {
          value,
          termAccession: termAccession || nextAssignments[matchingIndex].termAccession,
          sampleIds: uniqueStrings([...nextAssignments[matchingIndex].sampleIds, ...sampleIds]),
        };
      } else {
        nextAssignments.push({ value, termAccession, sampleIds });
      }
      const next = { ...current, [field.key]: nextAssignments };
      if (field.key !== "cellLine") return next;
      const enriched = applyCellLineAnnotationsToAssignments({
        enabled: cellLineAnnotationEnabled,
        cellLineValue: value,
        sampleIds,
        fields: visibleMetadataFields.map((item) => ({ key: item.key, column: item.column })),
        assignmentsByField: next,
      });
      nextStatus = formatCellLineAnnotationReport(enriched.report) || nextStatus;
      return enriched.assignmentsByField;
    });
    setAssignmentDrafts((current) => ({
      ...current,
      [field.key]: { value: "", sampleIds: [] },
    }));
    setSampleStatus(nextStatus);
    return true;
  };
  const commitAssignmentIfReady = (field: SampleMetadataField) => {
    const draft = assignmentDrafts[field.key];
    return commitFieldAssignment(field, getAssignmentDraftValue(field, draft), draft?.sampleIds ?? []);
  };
  const commitAssignmentOnBlur = (field: SampleMetadataField, event: FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    const nextTarget = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
    const fieldContainer = event.currentTarget.closest(".sample-property-field");
    if (nextTarget && fieldContainer?.contains(nextTarget)) return;
    commitAssignmentIfReady(field);
  };
  const confirmSamplePicker = (fieldKey: string, sampleIds: string[]) => {
    const field = fieldByKey.get(fieldKey);
    const normalizedSampleIds = normalizeAssignmentSampleIds(sampleIds);
    if (field) {
      const draft = assignmentDrafts[fieldKey];
      const value = getAssignmentDraftValue(field, draft);
      if (commitFieldAssignment(field, value, normalizedSampleIds)) {
        closeSamplePicker();
        return;
      }
      if (normalizedSampleIds.length) {
        setSampleStatus(`${normalizedSampleIds.length} sample${normalizedSampleIds.length === 1 ? "" : "s"} selected for ${sampleFieldDisplayLabel(field)}. Enter a value to save this assignment.`);
      }
    }
    updateAssignmentSampleIds(fieldKey, normalizedSampleIds);
    closeSamplePicker();
  };
  const removeFieldAssignment = (fieldKey: string, index: number) => {
    setAssignmentsByField((current) => {
      const nextAssignments = (current[fieldKey] ?? []).filter((_, assignmentIndex) => assignmentIndex !== index);
      const next = { ...current };
      if (nextAssignments.length) next[fieldKey] = nextAssignments;
      else delete next[fieldKey];
      return next;
    });
  };
  const updateAssignmentOntologyTerm = (field: SampleMetadataField, term: SampleOntologyTerm) => {
    setAssignmentOntologyTerms((current) => ({
      ...current,
      [field.key]: dedupeSampleOntologyTerms([...(current[field.key] ?? []), term]),
    }));
    const draft = assignmentDrafts[field.key];
    if (!commitFieldAssignment(field, term.label, draft?.sampleIds ?? [], term)) {
      updateAssignmentDraftValue(field.key, term.label);
    }
  };
  const clearAssignmentOntologyTerm = (field: SampleMetadataField) => {
    setAssignmentOntologyTerms((current) => ({
      ...current,
      [field.key]: (current[field.key] ?? []).filter((term) => term.field !== field.key),
    }));
    updateAssignmentDraftValue(field.key, "");
  };
  const useAssignmentCommonChoice = (field: SampleMetadataField, value: string) => {
    const term = lookupSampleOntologyTermForValue(field, value, assignmentOntologyTerms[field.key] ?? []);
    if (term) {
      updateAssignmentOntologyTerm(field, term);
      return;
    }
    const draft = assignmentDrafts[field.key];
    if (!commitFieldAssignment(field, value, draft?.sampleIds ?? [])) {
      updateAssignmentDraftValue(field.key, value);
    }
  };
  const getFactorDraft = (fieldKey: string): SampleFactorDraft => {
    const existing = factorDrafts[fieldKey];
    if (existing) return existing;
    const field = fieldByKey.get(fieldKey);
    const candidate = detectedFactorByField.get(fieldKey);
    return {
      fieldKey,
      label: candidate?.label ?? (field ? sampleFactorLabelFromField(field) : fieldKey),
      enabled: Boolean(candidate),
      source: candidate ? "detected" : "custom",
    };
  };
  const setFactorDraft = (fieldKey: string, patch: Partial<SampleFactorDraft>) => {
    setFactorDrafts((current) => {
      const existing = current[fieldKey] ?? getFactorDraft(fieldKey);
      return {
        ...current,
        [fieldKey]: { ...existing, ...patch },
      };
    });
  };
  const toggleFactorSelection = (fieldKey: string) => {
    setFactorDraft(fieldKey, { enabled: !getFactorDraft(fieldKey).enabled });
  };
  const updateFactorLabel = (fieldKey: string, label: string) => {
    setFactorDraft(fieldKey, { label });
  };
  const updateManualGroup = (patch: Partial<SampleDesignGroup>) => {
    setManualGroup((current) => ({ ...current, ...patch }));
  };
  const updateManualMetadata = (key: SampleMetadataKey, value: string) => {
    setManualGroup((current) => ({ ...current, metadata: { ...current.metadata, [key]: value } }));
  };
  const toggleManualFactor = (key: SampleFactorKey) => {
    setManualGroup((current) => {
      const currentKeys = resolveSampleFactorKeys(current);
      const nextKeys = currentKeys.includes(key) ? currentKeys.filter((item) => item !== key) : [...currentKeys, key];
      return { ...current, factorKeys: nextKeys };
    });
  };
  const useOntologyTerm = (term: SampleOntologyTerm) => {
    setManualGroup((current) => ({
      ...current,
      metadata: { ...current.metadata, [term.field]: term.label },
      ontologyTerms: dedupeSampleOntologyTerms([...current.ontologyTerms, term]),
    }));
    setOntologyQuery(term.label);
  };
  const useMetadataCommonChoice = (field: SampleMetadataField, value: string) => {
    const term = lookupSampleOntologyTermForValue(field, value, manualGroup.ontologyTerms);
    if (term) {
      useOntologyTerm(term);
      return;
    }
    updateManualMetadata(field.key, value);
  };
  const clearMetadataOntologyTerm = (field: SampleMetadataField) => {
    setManualGroup((current) => ({
      ...current,
      metadata: { ...current.metadata, [field.key]: "" },
      ontologyTerms: current.ontologyTerms.filter((term) => term.field !== field.key),
    }));
  };
  const updateSampleCountInput = (value: string) => {
    const normalized = value.replace(/[^\d]/g, "").slice(0, 3);
    setSampleCountInput(normalized);
    setManualGroup((current) => ({ ...current, sampleCount: Math.max(1, Math.min(200, Number(normalized) || 1)) }));
  };
  const addManualGroup = () => {
    const normalized = sanitizeSampleGroup({ ...manualGroup, sampleCount: Number(sampleCountInput) || 1 });
    if (!normalized) return;
    setManualGroups((current) => [...current, normalized]);
    setManualGroup(createEmptySampleGroup({
      organism: normalized.metadata.organism,
      organismPart: normalized.metadata.organismPart,
      disease: normalized.metadata.disease,
      environmentalSampleType: normalized.metadata.environmentalSampleType,
      environmentalMedium: normalized.metadata.environmentalMedium,
    }));
    setSampleCountInput("3");
    setOntologyQuery("");
    setSampleStatus(`${normalized.groupName} added to the manual draft.`);
  };
  const manualDraft: SampleDesignDraft = {
    groups: manualGroups,
    summary: `${manualGroups.length} manually configured sample group${manualGroups.length === 1 ? "" : "s"}.`,
    sources: [],
  };
  const aiGroupCount = aiDraft?.groups.length ?? 0;
  const assignmentCount = Object.values(assignmentsByField).reduce((sum, assignments) => sum + assignments.length, 0);
  const customOnlyFactorDrafts = Object.values(factorDrafts).filter((draft) => draft.source === "custom" && !detectedFactorByField.has(draft.fieldKey));
  const sampleAiIsPending = runSampleAi.isPending || activeSampleAiMutations > 0;
  const saving = applySampleDraft.isPending || applyBatchDesign.isPending || sampleAiIsPending;
  const sampleAccession = (
    savedSessionState.import?.prideAccession ??
    savedSessionState.import?.activeImportAccession ??
    savedSessionState.import?.accession ??
    ""
  ).toUpperCase();
  const sampleFacts = [
    sampleAccession ? { label: "PRIDE", value: sampleAccession } : null,
    { label: "Rows", value: String(table?.rows.length ?? 0) },
    { label: "Evidence", value: String(analysis?.evidences.length ?? 0) },
    aiDraft ? { label: "AI groups", value: String(aiDraft.groups.length) } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
  const sampleSelectionRoster = useMemo(() => sampleRoster.map((sample, index) => ({
    ...sample,
    sourceName: cleanRosterSampleName(sample, index),
  })), [sampleRoster]);
  const sampleAttributePreviewTable = useMemo(
    () => buildSampleAttributePreviewTable(projectId, sampleSelectionRoster, batchFields, assignmentsByField, activeFactorSelections),
    [activeFactorSelections, assignmentsByField, batchFields, projectId, sampleSelectionRoster],
  );
  const sampleTableDisplayHeaders = useMemo(
    () => getSdrfGridHeaders(sampleAttributePreviewTable, false, true),
    [sampleAttributePreviewTable],
  );
  const sampleRosterText = sampleSelectionRoster.map((sample) => cleanOneLineString(sample.sourceName)).filter(Boolean).join(", ");
  const activeSamplePickerMetadataField = activeSamplePickerField ? fieldByKey.get(activeSamplePickerField) : null;
  const activeSamplePickerDraft = activeSamplePickerField ? assignmentDrafts[activeSamplePickerField] ?? { value: "", sampleIds: [] } : null;
  const activeSamplePickerAssignedIds = new Set(
    activeSamplePickerField
      ? (assignmentsByField[activeSamplePickerField] ?? []).flatMap((assignment) => assignment.sampleIds)
      : [],
  );
  const activeSamplePickerDraftIds = new Set(activeSamplePickerDraft?.sampleIds ?? []);
  const activeSamplePickerSamples = activeSamplePickerField
    ? sampleSelectionRoster.filter((sample) => activeSamplePickerDraftIds.has(sample.id) || !activeSamplePickerAssignedIds.has(sample.id))
    : sampleSelectionRoster;
  const manualOntologySearchMatches = manualOntologySearch?.query === manualOntologyQuery;
  const manualOntologySearchLoading = Boolean(manualOntologySearchMatches && manualOntologySearch?.loading);
  const manualOntologySearchFailed = Boolean(manualOntologySearchMatches && manualOntologySearch?.error);
  return (
    <div className="content-grid templates-content-grid samples-content-grid">
      <section className="wide-stack">
        <Panel title="Sample design">
          <div className="sample-builder sample-batch-builder">
            <div className="sample-workbench-head">
              <div>
                <span className="sample-kicker">quantms SDRF samples</span>
                <h3>Build sample attributes</h3>
                <p>Use AI and structured evidence to prepare biological samples, source names, metadata assignments and study variables.</p>
              </div>
              <div className="sample-overview-strip">
                <span><small>Samples</small><b>{sampleRoster.length}</b></span>
                <span><small>Assignments</small><b>{assignmentCount}</b></span>
                <span><small>Fields</small><b>{visibleMetadataFields.length}</b></span>
                <span><small>AI groups</small><b>{aiGroupCount}</b></span>
              </div>
            </div>

            <div className="sample-workbench-grid sample-batch-grid">
              <section className="sample-design-card sample-roster-card">
                <div className="sample-card-head">
                  <span>01</span>
                  <div>
                    <strong>Sample roster</strong>
                    <p>Set the total sample count and edit the generated source names before assigning metadata.</p>
                  </div>
                </div>
                <div className="sample-roster-stack">
                  <div className="sample-roster-panel sample-count-card">
                    <div className="sample-setup-title">
                      <span>#</span>
                      <strong>1. Number of biological samples</strong>
                    </div>
                    <input
                      aria-label="Sample count"
                      inputMode="numeric"
                      value={rosterCountInput}
                      onChange={(event) => updateRosterCountInput(event.target.value)}
                      placeholder="3"
                    />
                  </div>
                  <div className="sample-roster-panel sample-naming-card">
                    <div className="sample-setup-title">
                      <span>◇</span>
                      <strong>2. Sample naming</strong>
                    </div>
                    <span className="sample-naming-instruction">Choose a naming mode</span>
                    <div className="sample-naming-mode" role="radiogroup" aria-label="Sample naming mode">
                      <button
                        className={`sample-naming-option${sampleNamingMode === "auto" ? " active" : ""}`}
                        type="button"
                        role="radio"
                        aria-checked={sampleNamingMode === "auto"}
                        aria-label="Auto-generate sample names"
                        onClick={() => updateSampleNamingMode("auto")}
                      >
                        <span>Auto</span>
                        <small>sample_01...sample_N</small>
                      </button>
                      <button
                        className={`sample-naming-option${sampleNamingMode === "custom" ? " active" : ""}`}
                        type="button"
                        role="radio"
                        aria-checked={sampleNamingMode === "custom"}
                        aria-label="Custom sample names"
                        onClick={() => updateSampleNamingMode("custom")}
                      >
                        <span>Custom</span>
                        <small>comma-separated</small>
                      </button>
                    </div>
                    {sampleNamingMode === "auto" ? (
                      <div className="sample-pattern-card-grid" aria-label="Auto naming patterns">
                        {sampleNamingPatternOptions.map((option) => (
                          <button
                            key={option.id}
                            className={`sample-pattern-card${sampleNamingPatternId === option.id ? " active" : ""}`}
                            type="button"
                            aria-label={`Apply ${option.label}`}
                            title={option.label}
                            onClick={() => applyAutoNamingPattern(option.id)}
                          >
                            <span>{option.displayLabel}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="sample-custom-name-entry">
                        <input
                          aria-label="Comma-separated sample names"
                          autoComplete="off"
                          value={customSampleNamesInput}
                          onChange={(event) => setCustomSampleNamesInput(event.target.value)}
                          placeholder="sample_A, sample_B, sample_C"
                        />
                        <button className="btn primary" type="button" aria-label="Apply custom sample names" onClick={applyCustomSampleNames}>
                          Apply
                        </button>
                        <small>Separate sample names with commas.</small>
                      </div>
                    )}
                    <div className="sample-inline-roster" aria-live="polite">
                      <span>Sample roster</span>
                      <strong>{sampleRosterText}</strong>
                    </div>
                  </div>
                  <div className="sample-roster-panel sample-context-panel">
                    <label className="sample-context-picker">
                      Sample context
                      <select
                        aria-label="Sample context"
                        value={sampleContext}
                        disabled={templateDrivenSampleMetadata}
                        onChange={(event) => setSampleContext(event.target.value as SampleContextMode)}
                      >
                        {SAMPLE_CONTEXT_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                      <span>
                        {templateDrivenSampleMetadata
                          ? `Loaded from Templates: ${selectedTemplateSummary || "selected template stack"}`
                          : selectedContext.note}
                      </span>
                    </label>
                  </div>
                </div>
              </section>

              <section className="sample-design-card sample-metadata-card sample-assignment-card">
                <div className="sample-card-head">
                  <span>02</span>
                  <div>
                    <strong>Attribute assignments</strong>
                    <p>Enter one value at a time and choose the samples that should receive that value.</p>
                  </div>
                </div>
                <div className="sample-field-sections">
                  {metadataSections.map((section) => (
                    <div className={`sample-field-section sample-field-section-card sample-field-section-${section.id}`} data-testid={`sample-metadata-${section.id}`} key={section.id}>
                      <div className="sample-field-section-head">
                        <strong>{section.title}</strong>
                        <span>{section.fields.length} fields</span>
                      </div>
                      <div className="sample-metadata-grid">
                        {section.fields.map((field) => {
                          const displayLabel = sampleFieldDisplayLabel(field);
                          const draft = assignmentDrafts[field.key] ?? { value: "", sampleIds: [] };
                          const selectedTerms = assignmentOntologyTerms[field.key] ?? [];
                          const selectedTerm = getSampleOntologyTermForValue(field, draft.value, selectedTerms);
                          const ontologySearchState = assignmentOntologySearches[field.key];
                          const ontologySearchQuery = cleanOneLineString(draft.value);
                          const fieldResults = field.ontology && ontologySearchQuery
                            ? mergeSampleOntologyResults(field, ontologySearchQuery, ontologySearchState)
                            : [];
                          const ontologyStatusText = field.ontology && ontologySearchQuery.length >= 2 && ontologySearchState?.query === ontologySearchQuery
                            ? ontologySearchState.loading
                              ? "Searching EBI OLS..."
                              : ontologySearchState.error
                                ? "OLS unavailable; showing local cached terms when available."
                                : ""
                            : "";
                          const assignments = assignmentsByField[field.key] ?? [];
                          const selectedSampleNames = draft.sampleIds.map((sampleId) => sampleNameById.get(sampleId) ?? sampleId);
                          const isRequired = field.requirement === "required";
                          return (
                            <div key={field.key} className="sample-property-field sample-assignment-field" data-testid={`sample-property-${field.key}`}>
                              <div className="sample-property-label-row">
                                <span className="sample-property-label">
                                  {displayLabel}
                                  {isRequired ? <b>*</b> : null}
                                </span>
                                <span className="sample-help-dot" title={field.hint ?? sampleFieldDescription(field)}>?</span>
                              </div>
                              <p>{sampleFieldDescription(field)}</p>
                              <div className="sample-value-selection-row">
                                {field.inputType === "select" ? (
                                  <select
                                    aria-label={`Assignment value for ${displayLabel}`}
                                    value={draft.value || field.options?.[0] || ""}
                                    onChange={(event) => updateAssignmentDraftValue(field.key, event.target.value)}
                                    onBlur={(event) => commitAssignmentOnBlur(field, event)}
                                  >
                                    {(field.options ?? []).map((option) => <option key={option} value={option}>{option || "Select..."}</option>)}
                                  </select>
                                ) : (
                                  <input
                                    aria-label={`Assignment value for ${displayLabel}`}
                                    autoComplete="off"
                                    value={draft.value}
                                    onChange={(event) => updateAssignmentDraftValue(field.key, event.target.value)}
                                    onBlur={(event) => commitAssignmentOnBlur(field, event)}
                                    placeholder={field.searchPlaceholder ?? field.placeholder}
                                  />
                                )}
                                <button
                                  className="btn ghost sample-select-samples-button"
                                  type="button"
                                  aria-label={`Select samples for ${displayLabel}`}
                                  onClick={() => openSamplePicker(field.key)}
                                >
                                  <UsersRound size={15} /> Select samples
                                </button>
                              </div>
                              {fieldResults.length > 0 && !selectedTerm && (
                                <div className="sample-property-results">
                                  {fieldResults.map((term) => (
                                    <button key={`${term.field}-${term.accession}-${term.label}`} type="button" aria-label={`${term.label} ${term.accession}`} onClick={() => updateAssignmentOntologyTerm(field, term)}>
                                      <span>{term.label}</span>
                                      <small>{term.accession}</small>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {ontologyStatusText && (
                                <div className="sample-ontology-search-status" aria-live="polite">
                                  {ontologyStatusText}
                                </div>
                              )}
                              {field.commonChoices?.length ? (
                                <div className="sample-common-choices">
                                  <span>Common:</span>
                                  {field.commonChoices.map((choice) => (
                                    <button
                                      key={choice}
                                      className={choice.startsWith("not ") ? "reserved" : ""}
                                      type="button"
                                      onClick={() => useAssignmentCommonChoice(field, choice)}
                                    >
                                      {choice}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              {selectedSampleNames.length > 0 && (
                                <div className="sample-draft-sample-summary">
                                  <span>sample name:</span>
                                  <strong>{selectedSampleNames.join(", ")}</strong>
                                </div>
                              )}
                              <div className="sample-assignment-list">
                                {assignments.map((assignment, assignmentIndex) => (
                                  <article key={`${field.key}-${assignment.value}-${assignmentIndex}`} className="sample-assignment-row">
                                    <div>
                                      <strong className="sample-assignment-value">
                                        {assignment.value}
                                        {assignment.termAccession ? <small className="sample-assignment-accession"> ({assignment.termAccession})</small> : null}
                                      </strong>
                                      <span className="sample-assignment-samples">{assignment.sampleIds.map((sampleId) => sampleNameById.get(sampleId) ?? sampleId).join(", ")}</span>
                                    </div>
                                    <button
                                      className="sample-assignment-remove"
                                      type="button"
                                      aria-label={`Remove ${displayLabel} assignment ${assignment.value}`}
                                      title="Remove assignment"
                                      onClick={() => removeFieldAssignment(field.key, assignmentIndex)}
                                    >
                                      <span aria-hidden="true">×</span>
                                    </button>
                                  </article>
                                ))}
                                {!assignments.length && <p className="sample-assignment-empty">No assignments yet.</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="sample-design-card sample-factor-card sample-factor-detection-card">
                <div className="sample-card-head compact">
                  <span>03</span>
                  <div>
                    <strong>Detected grouping variables</strong>
                    <p>Multi-valued attributes are suggested as SDRF factor value columns; keep, reject, or rename them.</p>
                  </div>
                </div>
                <div className="sample-factor-list sample-factor-detected-list">
                  {detectedFactors.map((candidate) => {
                    const draft = getFactorDraft(candidate.fieldKey);
                    const field = fieldByKey.get(candidate.fieldKey);
                    const displayLabel = field ? sampleFieldDisplayLabel(field) : candidate.label;
                    const factorColumn = sampleFactorValueColumnFromLabel(draft.label || candidate.label);
                    return (
                      <article key={candidate.fieldKey} className={`sample-factor-row ${draft.enabled ? "active" : ""}`}>
                        <label className="sample-factor-choice">
                          <input
                            aria-label={`Use ${factorColumn}`}
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={() => toggleFactorSelection(candidate.fieldKey)}
                          />
                          <span>{factorColumn}</span>
                          <small>{displayLabel}</small>
                        </label>
                        <label className="sample-factor-label">
                          Factor label
                          <input
                            aria-label={`Factor label for ${displayLabel}`}
                            value={draft.label}
                            onChange={(event) => updateFactorLabel(candidate.fieldKey, event.target.value)}
                          />
                        </label>
                        <div className="sample-factor-values">
                          {candidate.values.map((value) => (
                            <span key={`${candidate.fieldKey}-${value.value}`}>
                              <b>{value.value}</b>
                              <small>{value.sampleIds.map((sampleId) => sampleNameById.get(sampleId) ?? sampleId).join(", ")}</small>
                            </span>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                  {!detectedFactors.length && (
                    <div className="sample-empty-state">
                      <strong>No grouping variables detected yet</strong>
                      <p>Add two or more values to the same attribute, or define a custom factor below.</p>
                    </div>
                  )}
                </div>
                <div className="sample-custom-factor">
                  <div className="sample-custom-factor-fields">
                    <label>
                      Custom factor source
                      <select
                        aria-label="Custom factor source"
                        value={customFactorFieldKey}
                        onChange={(event) => setCustomFactorFieldKey(event.target.value as SampleMetadataKey | "")}
                      >
                        <option value="">Select attribute...</option>
                        {visibleMetadataFields.map((field) => (
                          <option key={field.key} value={field.key}>{sampleFieldDisplayLabel(field)}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Custom factor label
                      <input
                        aria-label="Custom factor label"
                        autoComplete="off"
                        value={customFactorLabel}
                        onChange={(event) => setCustomFactorLabel(event.target.value)}
                        placeholder="condition"
                      />
                    </label>
                  </div>
                </div>
                {customOnlyFactorDrafts.length > 0 && (
                  <div className="sample-factor-custom-list">
                    {customOnlyFactorDrafts.map((draft) => {
                      const field = fieldByKey.get(draft.fieldKey);
                      const factorColumn = sampleFactorValueColumnFromLabel(draft.label);
                      return (
                        <article key={draft.fieldKey} className={`sample-factor-row ${draft.enabled ? "active" : ""}`}>
                          <label className="sample-factor-choice">
                            <input
                              aria-label={`Use ${factorColumn}`}
                              type="checkbox"
                              checked={draft.enabled}
                              onChange={() => toggleFactorSelection(draft.fieldKey)}
                            />
                            <span>{factorColumn}</span>
                            <small>{field ? sampleFieldDisplayLabel(field) : draft.fieldKey}</small>
                          </label>
                          <button className="icon-btn" type="button" aria-label={`Remove ${factorColumn}`} onClick={() => setFactorDrafts((current) => {
                            const next = { ...current };
                            delete next[draft.fieldKey];
                            return next;
                          })}>
                            <X size={14} />
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <div className="sample-builder-actions sample-batch-actions">
              <button className="btn primary" type="button" onClick={() => applyBatchDesign.mutate()} disabled={!sampleRoster.length || saving}>
                Apply sample design
              </button>
              {sampleStatus && <span>{sampleStatus}</span>}
            </div>
          </div>
        </Panel>
        <SampleSelectionDialog
          open={Boolean(activeSamplePickerField && activeSamplePickerMetadataField)}
          title={`Select samples (${activeSamplePickerMetadataField ? sampleFieldDisplayLabel(activeSamplePickerMetadataField) : "samples"})`}
          samples={activeSamplePickerSamples}
          selectedIds={activeSamplePickerDraft?.sampleIds ?? []}
          onConfirm={(sampleIds) => {
            if (!activeSamplePickerField) return;
            confirmSamplePicker(activeSamplePickerField, sampleIds);
          }}
          onCancel={closeSamplePicker}
        />
        {false && (
        <Panel title="Sample metadata builder">
          <div className="sample-builder">
            <div className="sample-workbench-head">
              <div>
                <span className="sample-kicker">quantms SDRF samples</span>
                <h3>Fill sample metadata</h3>
                <p>Define source names, required sample characteristics, pooled sample status and study variables before writing SDRF rows.</p>
              </div>
              <div className="sample-overview-strip">
                <span><small>Rows</small><b>{table?.rows.length ?? 0}</b></span>
                <span><small>Manual groups</small><b>{manualGroups.length}</b></span>
                <span><small>AI groups</small><b>{aiGroupCount}</b></span>
                <span><small>Evidence</small><b>{analysis?.evidences.filter((item) => item.confidence >= 0.8).length ?? 0}</b></span>
              </div>
            </div>

            <div className="sample-workbench-grid">
              <section className="sample-design-card sample-group-editor">
                <div className="sample-card-head">
                  <span>01</span>
                  <div>
                    <strong>Source names and context</strong>
                    <p>Generate source name values and choose the sample metadata template family.</p>
                  </div>
                </div>
                <label className="sample-context-picker">
                  Sample context
                  <select
                    aria-label="Sample context"
                    value={sampleContext}
                    disabled={templateDrivenSampleMetadata}
                    onChange={(event) => setSampleContext(event.target.value as SampleContextMode)}
                  >
                    {SAMPLE_CONTEXT_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                  <span>
                    {templateDrivenSampleMetadata
                      ? `Loaded from Templates: ${selectedTemplateSummary || "selected template stack"}`
                      : selectedContext.note}
                  </span>
                </label>
                <div className="sample-builder-grid">
                  <label>
                    Group name
                    <input
                      aria-label="Group name"
                      autoComplete="off"
                      value={manualGroup.groupName}
                      onChange={(event) => updateManualGroup({ groupName: event.target.value })}
                      placeholder="Control"
                    />
                  </label>
                  <label>
                    Samples
                    <input
                      aria-label="Samples"
                      inputMode="numeric"
                      value={sampleCountInput}
                      onChange={(event) => updateSampleCountInput(event.target.value)}
                      placeholder="3"
                    />
                  </label>
                  <label>
                    Naming prefix
                    <input
                      aria-label="Naming prefix"
                      autoComplete="off"
                      value={manualGroup.namingPrefix}
                      onChange={(event) => updateManualGroup({ namingPrefix: event.target.value.toLowerCase() })}
                      placeholder="ctrl"
                    />
                  </label>
                </div>
                <div className="sample-naming-preview">
                  <span>Preview</span>
                  <strong>{cleanSamplePrefix(manualGroup.namingPrefix || manualGroup.groupName || "group")}_01</strong>
                </div>
                <div className="sample-generated-columns">
                  <span><b>source name</b><small>{cleanSamplePrefix(manualGroup.namingPrefix || manualGroup.groupName || "group")}_01</small></span>
                  <span><b>characteristics[biological replicate]</b><small>{normalizePooledSampleValue(manualGroup.metadata) === "not pooled" ? "1, 2, 3..." : "pooled"}</small></span>
                </div>
              </section>

              <section className="sample-design-card sample-metadata-card">
                <div className="sample-card-head">
                  <span>02</span>
                  <div>
                    <strong>Characteristics</strong>
                    <p>Fill the SDRF sample columns that apply to this context.</p>
                  </div>
                </div>
                <div className="sample-field-sections">
                  {metadataSections.map((section) => (
                    <div className={`sample-field-section sample-field-section-card sample-field-section-${section.id}`} data-testid={`sample-metadata-${section.id}`} key={section.id}>
                      <div className="sample-field-section-head">
                        <strong>{section.title}</strong>
                        <span>{section.fields.length} fields</span>
                      </div>
                      <div className="sample-metadata-grid">
                        {section.fields.map((field) => {
                          const fieldValue = manualGroup.metadata[field.key] ?? "";
                          const selectedTerm = getSampleOntologyTermForValue(field, fieldValue, manualGroup.ontologyTerms);
                          const fieldSearchQuery = cleanOneLineString(fieldValue);
                          const fieldResults = field.ontology && fieldSearchQuery
                            ? mergeSampleOntologyResults(field, fieldSearchQuery, manualOntologySearch)
                            : [];
                          const isRequired = field.requirement === "required";
                          return (
                            <div key={field.key} className="sample-property-field" data-testid={`sample-property-${field.key}`}>
                              <div className="sample-property-label-row">
                                <span className="sample-property-label">
                                  {sampleFieldDisplayLabel(field)}
                                  {isRequired ? <b>*</b> : null}
                                </span>
                                <span className="sample-help-dot" title={field.hint ?? sampleFieldDescription(field)}>?</span>
                              </div>
                              <p>{sampleFieldDescription(field)}</p>
                              {field.inputType === "select" ? (
                                <select
                                  aria-label={field.label}
                                  value={manualGroup.metadata[field.key] ?? field.options?.[0] ?? ""}
                                  onChange={(event) => updateManualMetadata(field.key, event.target.value)}
                                >
                                  {(field.options ?? []).map((option) => <option key={option} value={option}>{option || "Select..."}</option>)}
                                </select>
                              ) : (
                                <input
                                  aria-label={field.label}
                                  autoComplete="off"
                                  value={fieldValue}
                                  onChange={(event) => updateManualMetadata(field.key, event.target.value)}
                                  placeholder={field.searchPlaceholder ?? field.placeholder}
                                />
                              )}
                              {fieldResults.length > 0 && !selectedTerm && (
                                <div className="sample-property-results">
                                  {fieldResults.map((term) => (
                                    <button key={`${term.field}-${term.accession}-${term.label}`} type="button" aria-label={`${term.label} ${term.accession}`} onClick={() => useOntologyTerm(term)}>
                                      <span>{term.label}</span>
                                      <small>{term.accession}</small>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {selectedTerm && (
                                <div className="sample-selected-term">
                                  <span>{selectedTerm.label}</span>
                                  <small>{selectedTerm.accession}</small>
                                  <button type="button" aria-label={`Remove ${field.label}`} onClick={() => clearMetadataOntologyTerm(field)}>
                                    <X size={14} />
                                  </button>
                                </div>
                              )}
                              {field.commonChoices?.length ? (
                                <div className="sample-common-choices">
                                  <span>Common:</span>
                                  {field.commonChoices.map((choice) => (
                                    <button
                                      key={choice}
                                      className={choice.startsWith("not ") ? "reserved" : ""}
                                      type="button"
                                      onClick={() => useMetadataCommonChoice(field, choice)}
                                    >
                                      {choice}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {normalizePooledSampleMode(manualGroup.metadata.pooledSample) === "pooled" && (
                    <div className="sample-property-field sample-pooled-members" data-testid="sample-property-pooledSampleMembers">
                      <div className="sample-property-label-row">
                        <span className="sample-property-label">
                          Pooled source members
                          <b>*</b>
                        </span>
                        <span className="sample-help-dot" title="Saved as SN=sample 1|sample 2|sample 3">?</span>
                      </div>
                      <p>Source sample identifiers included in this pooled sample.</p>
                      <input
                        aria-label="Pooled source members"
                        autoComplete="off"
                        value={manualGroup.metadata.pooledSampleMembers ?? ""}
                        onChange={(event) => updateManualMetadata("pooledSampleMembers", event.target.value)}
                        placeholder="DONOR_01 | DONOR_02"
                      />
                    </div>
                  )}
                </div>
              </section>
            </div>

            <section className="sample-design-card sample-factor-card">
              <div className="sample-card-head compact">
                <span>03</span>
                <div>
                  <strong>Study variables</strong>
                  <p>Mirror comparison-driving sample metadata into factor value columns.</p>
                </div>
              </div>
              <div className="sample-factor-list">
                {sampleFactorFields.map((field) => {
                  const factorKey = field.factorKey as SampleFactorKey;
                  const factorColumn = field.factorColumn ?? "";
                  const checked = resolveSampleFactorKeys(manualGroup).includes(factorKey);
                  return (
                    <label key={factorColumn} className={checked ? "active" : ""}>
                      <input
                        aria-label={factorColumn}
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleManualFactor(factorKey)}
                      />
                      <span>{factorColumn}</span>
                      <small>{field.column}</small>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="sample-design-card ontology-search-card">
              <div className="sample-card-head compact">
                <span>04</span>
                <div>
                  <strong>Ontology support</strong>
                  <p>Search common SDRF-ready labels and accessions for metadata fields.</p>
                </div>
              </div>
              <div className="ontology-search-controls">
                <label>
                  Ontology field
                  <select aria-label="Ontology field" value={ontologyField} onChange={(event) => setOntologyField(event.target.value as SampleMetadataKey)}>
                    {visibleMetadataFields.filter((field) => field.ontology).map((field) => (
                      <option key={field.key} value={field.key}>{field.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Search term
                  <input
                    aria-label="Ontology search term"
                    autoComplete="off"
                    value={ontologyQuery}
                    onChange={(event) => setOntologyQuery(event.target.value)}
                    placeholder="Search ontology terms..."
                  />
                </label>
              </div>
              <div className="ontology-result-list">
                {ontologyResults.map((term) => (
                  <button key={`${term.field}-${term.accession}-${term.label}`} type="button" onClick={() => useOntologyTerm(term)}>
                    <strong>{term.label}</strong>
                    <span>{term.accession}</span>
                  </button>
                ))}
                {!ontologyResults.length && <p className="muted">Type a term to search common SDRF ontology labels.</p>}
              </div>
              {manualOntologySearchLoading && (
                <p className="sample-ontology-search-status" aria-live="polite">Searching EBI OLS...</p>
              )}
              {manualOntologySearchFailed && (
                <p className="sample-ontology-search-status warning">OLS unavailable; showing local cached terms when available.</p>
              )}
            </section>

            <section className="sample-review-panel">
              <div className="sample-review-head">
                <div>
                  <strong>Manual draft ledger</strong>
                  <span>{manualGroups.length ? `${manualGroups.length} group${manualGroups.length === 1 ? "" : "s"} ready` : "No groups added"}</span>
                </div>
                <button className="btn primary" type="button" onClick={addManualGroup}>
                  <Plus size={16} /> Add group
                </button>
              </div>
              <div className="sample-group-list">
                {manualGroups.map((group) => (
                  <article key={group.id} className="sample-group-card">
                    <div>
                      <strong>{group.groupName}</strong>
                      <span>{group.sampleCount} samples · {group.namingPrefix}_01</span>
                    </div>
                    <p>{sampleMetadataSummary(group.metadata)}</p>
                    <button className="icon-btn" type="button" aria-label={`Remove ${group.groupName}`} onClick={() => setManualGroups((current) => current.filter((item) => item.id !== group.id))}>
                      <X size={14} />
                    </button>
                  </article>
                ))}
                {!manualGroups.length && (
                  <div className="sample-empty-state">
                    <strong>No manual groups yet</strong>
                    <p>Add a group after defining its count, naming prefix and metadata.</p>
                  </div>
                )}
              </div>
              <div className="sample-builder-actions">
                <button className="btn primary" type="button" onClick={() => applySampleDraft.mutate(manualDraft)} disabled={!manualGroups.length || saving}>
                  Apply manual design
                </button>
                {sampleStatus && <span>{sampleStatus}</span>}
              </div>
            </section>
          </div>
        </Panel>
        )}
        <Panel title="Sample attribute preview">
          <div className="sample-table-head">
            <div className="sample-table-metrics">
              <span>{sampleAttributePreviewTable.rows.length} rows</span>
              <span>{sampleTableDisplayHeaders.length} columns</span>
            </div>
          </div>
          <div className="sample-grid-shell">
            <SdrfGrid
              table={sampleAttributePreviewTable}
              showFallback={false}
              onlyPopulatedColumns
            />
          </div>
        </Panel>
      </section>
      <AssistantPanel questions={sampleQuestions} evidences={analysis?.evidences} showQuestions={false} showEvidence={false} useFallbacks={false}>
        <SampleAssistantRecommendation
          draft={aiDraft}
          facts={sampleFacts}
          metadataFields={visibleMetadataFields}
          isPending={sampleAiIsPending}
          isSaving={saving}
          error={aiError}
          sourcesOpen={sampleSourcesOpen}
          onAccept={fillSampleDraftIntoAttributes}
          onRunAi={() => runSampleAi.mutate()}
          onToggleSources={() => setSampleSourcesOpen((current) => !current)}
        />
      </AssistantPanel>
    </div>
  );
}

function assistantMatchToken(value: unknown): string {
  return normalizedAxisName(cleanOneLineString(value));
}

function assistantTokensMatch(sampleToken: string, groupToken: string): boolean {
  if (!sampleToken || !groupToken) return false;
  if (sampleToken === groupToken) return true;
  if (sampleToken.length >= 4 && groupToken.includes(sampleToken)) return true;
  return groupToken.length >= 4 && sampleToken.includes(groupToken);
}

function assistantTrailingNumberToken(value: unknown): string {
  const match = assistantMatchToken(value).match(/(\d+)$/);
  return match?.[1]?.replace(/^0+(?=\d)/, "") ?? "";
}

function assistantGroupTokens(group: SampleDesignGroup): string[] {
  return uniqueStrings([group.id, group.groupName, group.namingPrefix].map(assistantMatchToken).filter(Boolean));
}

function assistantSampleGroupIndex(sample: SampleBiologicalSample, groups: SampleDesignGroup[]): number {
  if (!groups.length) return -1;
  if (groups.length === 1) return 0;
  const groupTokenLists = groups.map(assistantGroupTokens);
  const poolToken = assistantMatchToken(sample.poolId);
  if (poolToken) {
    const poolMatchIndex = groupTokenLists.findIndex((tokens) => tokens.some((token) => assistantTokensMatch(poolToken, token)));
    if (poolMatchIndex >= 0) return poolMatchIndex;
    const poolNumber = assistantTrailingNumberToken(sample.poolId);
    if (poolNumber) {
      const numberedPoolMatchIndex = groups.findIndex((group) => (
        [group.id, group.groupName, group.namingPrefix].some((value) => assistantTrailingNumberToken(value) === poolNumber)
      ));
      if (numberedPoolMatchIndex >= 0) return numberedPoolMatchIndex;
    }
  }
  const sampleGroupToken = assistantMatchToken(sample.sampleGroup);
  if (sampleGroupToken) {
    const exactGroupIndex = groupTokenLists.findIndex((tokens) => tokens.some((token) => token === sampleGroupToken));
    if (exactGroupIndex >= 0) return exactGroupIndex;
  }
  const factorValueTokens = Object.values(sample.factorValues ?? {}).map(assistantMatchToken).filter(Boolean);
  for (const factorToken of factorValueTokens) {
    const factorMatchIndex = groupTokenLists.findIndex((tokens) => tokens.some((token) => assistantTokensMatch(factorToken, token)));
    if (factorMatchIndex >= 0) return factorMatchIndex;
  }
  return -1;
}

function generatedSampleSourceName(group: SampleDesignGroup, index: number): string {
  return `${group.namingPrefix}_${String(index + 1).padStart(2, "0")}`.toLowerCase();
}

function groupAssistantBiologicalSamples(draft: SampleDesignDraft | null | undefined): SampleBiologicalSample[][] {
  const groups = draft?.groups ?? [];
  const samples = draft?.biologicalSamples ?? [];
  const buckets = groups.map((): SampleBiologicalSample[] => []);
  for (const sample of samples) {
    const groupIndex = assistantSampleGroupIndex(sample, groups);
    if (groupIndex >= 0) buckets[groupIndex].push(sample);
  }
  return buckets;
}

function biologicalSampleSummarizesGroup(sample: SampleBiologicalSample, group: SampleDesignGroup): boolean {
  const sampleToken = assistantMatchToken(sample.sourceName);
  if (!sampleToken) return false;
  return [group.groupName, group.namingPrefix, sample.sampleGroup]
    .map(assistantMatchToken)
    .filter(Boolean)
    .some((token) => assistantTokensMatch(sampleToken, token));
}

function expandAssistantBiologicalSamplesForGroup(group: SampleDesignGroup, samples: SampleBiologicalSample[]): SampleBiologicalSample[] {
  if (group.sampleCount <= samples.length) return samples;
  const shouldReplaceSummary = samples.length === 1 && biologicalSampleSummarizesGroup(samples[0], group);
  const baseSamples = shouldReplaceSummary ? [] : [...samples];
  const existingNames = new Set(baseSamples.map((sample) => assistantMatchToken(sample.sourceName || sample.biologicalSampleId)));
  const template = samples[0];
  for (let index = 0; index < group.sampleCount; index += 1) {
    const sourceName = generatedSampleSourceName(group, index);
    if (existingNames.has(assistantMatchToken(sourceName))) continue;
    baseSamples.push({
      sourceName,
      biologicalSampleId: sourceName,
      sampleGroup: group.groupName,
      biologicalReplicate: String(index + 1),
      poolId: template?.poolId,
      metadata: {
        ...group.metadata,
        ...(template?.metadata ?? {}),
      },
      metadataEvidence: {
        ...(group.metadataEvidence ?? {}),
        ...(template?.metadataEvidence ?? {}),
      },
      ontologyTerms: template?.ontologyTerms?.length ? template.ontologyTerms : group.ontologyTerms,
      factorKeys: template?.factorKeys?.length ? template.factorKeys : group.factorKeys,
      factorValues: template?.factorValues ?? {},
      warnings: template?.warnings?.length ? template.warnings : group.warnings,
    });
  }
  return baseSamples;
}

function expandAssistantBiologicalSamplesForDraft(draft: SampleDesignDraft): SampleBiologicalSample[] {
  const samples = draft.biologicalSamples ?? [];
  if (!draft.groups.length) return samples;
  const groupedSamples = groupAssistantBiologicalSamples(draft);
  const matchedSamples = new Set(groupedSamples.flat());
  return [
    ...draft.groups.flatMap((group, index) => expandAssistantBiologicalSamplesForGroup(group, groupedSamples[index] ?? [])),
    ...samples.filter((sample) => !matchedSamples.has(sample)),
  ];
}

function assistantBiologicalSampleFieldValue(sample: SampleBiologicalSample, field: SampleMetadataField): string {
  if (
    field.key === "pooledSample"
    && !cleanOneLineString(sample.metadata.pooledSample)
    && !cleanOneLineString(sample.metadata.pooledSampleMembers)
  ) {
    return "";
  }
  return sampleFieldCellValue(field, sample.metadata);
}

function assistantBiologicalSampleFields(samples: SampleBiologicalSample[], metadataFields: SampleMetadataField[]): SampleMetadataField[] {
  const activeKeys = new Set<SampleMetadataKey>();
  for (const sample of samples) {
    for (const field of metadataFields) {
      const value = assistantBiologicalSampleFieldValue(sample, field);
      if (!isMissingLikeSampleValue(value)) activeKeys.add(field.key);
    }
  }
  return metadataFields.filter((field) => activeKeys.has(field.key));
}

function groupHasMeaningfulSampleField(samples: SampleBiologicalSample[], field: SampleMetadataField): boolean {
  return samples.some((sample) => !isMissingLikeSampleValue(assistantBiologicalSampleFieldValue(sample, field)));
}

function AssistantBiologicalSamplesTable({
  groupIndex,
  samples,
  metadataFields,
}: {
  groupIndex: number;
  samples: SampleBiologicalSample[];
  metadataFields: SampleMetadataField[];
}) {
  if (!samples.length) return null;
  const sampleFields = assistantBiologicalSampleFields(samples, metadataFields);
  const hasBiologicalReplicate = samples.some((sample) => cleanOneLineString(sample.biologicalReplicate));
  const hasPool = samples.some((sample) => cleanOneLineString(sample.poolId));
  return (
    <div className="sample-json-biological-samples" aria-label={`AI group ${groupIndex + 1} source-level biological samples`}>
      <div className="sample-json-biological-head">
        <strong>Source-level samples</strong>
        <span>{samples.length} samples</span>
      </div>
      <div className="sample-json-biological-table-wrap">
        <table className="sample-json-biological-table">
          <thead>
            <tr>
              <th>Sample</th>
              {hasBiologicalReplicate && <th>Bio rep</th>}
              {hasPool && <th>Pool</th>}
              {sampleFields.map((field) => (
                <th key={`head-${field.key}`}>{sampleFieldDisplayLabel(field)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {samples.map((sample, sampleIndex) => (
              <tr key={`${sample.sourceName}-${sample.poolId ?? ""}-${sampleIndex}`}>
                <td>{sample.sourceName || sample.biologicalSampleId || `sample_${sampleIndex + 1}`}</td>
                {hasBiologicalReplicate && <td>{cleanOneLineString(sample.biologicalReplicate) || "not available"}</td>}
                {hasPool && <td>{cleanOneLineString(sample.poolId) || "not available"}</td>}
                {sampleFields.map((field) => (
                  <td key={`${sample.sourceName}-${field.key}`}>
                    {assistantBiologicalSampleFieldValue(sample, field) || "not available"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SampleAssistantRecommendation({
  draft,
  facts,
  metadataFields,
  isPending,
  isSaving,
  error,
  sourcesOpen,
  onAccept,
  onRunAi,
  onToggleSources,
}: {
  draft: SampleDesignDraft | null;
  facts: { label: string; value: string }[];
  metadataFields: SampleMetadataField[];
  isPending: boolean;
  isSaving: boolean;
  error: string;
  sourcesOpen: boolean;
  onAccept: (draft: SampleDesignDraft) => void;
  onRunAi: () => void;
  onToggleSources: () => void;
}) {
  const [editableDraft, setEditableDraft] = useState<SampleDesignDraft | null>(draft);
  const [openMetadataSourceKey, setOpenMetadataSourceKey] = useState<string | null>(null);
  useEffect(() => {
    setEditableDraft(draft ? sanitizeSampleDesignDraft(sampleDraftToJson(draft)) : null);
    setOpenMetadataSourceKey(null);
  }, [draft]);
  const workingDraft = editableDraft ?? draft;
  const usableDraft = workingDraft ? sanitizeSampleDesignDraft(sampleDraftToJson(workingDraft)) : null;
  const hasDraft = Boolean(workingDraft);
  const hasUsableDraft = Boolean(usableDraft?.groups.length);
  const sourceCount = workingDraft?.sources.length ?? 0;
  const biologicalSamplesByGroup = useMemo(() => groupAssistantBiologicalSamples(workingDraft), [workingDraft]);
  const editableFieldCount = workingDraft?.groups.reduce((sum, group) => (
    sum + metadataFields.filter((field) => cleanOneLineString(group.metadata[field.key])).length
  ), 0) ?? 0;
  const updateEditableDraft = (updater: (current: SampleDesignDraft) => SampleDesignDraft) => {
    setEditableDraft((current) => {
      const base = current ?? draft;
      return base ? updater(base) : current;
    });
  };
  const updateEditableGroup = (groupIndex: number, patch: Partial<SampleDesignGroup>) => {
    updateEditableDraft((current) => ({
      ...current,
      groups: current.groups.map((group, index) => (index === groupIndex ? { ...group, ...patch } : group)),
    }));
  };
  const updateEditableMetadata = (groupIndex: number, key: SampleMetadataKey, value: string) => {
    updateEditableDraft((current) => ({
      ...current,
      groups: current.groups.map((group, index) => (
        index === groupIndex
          ? (() => {
            const evidence = group.metadataEvidence?.[key];
            const nextGroup = { ...group, metadata: { ...group.metadata, [key]: value } };
            if (!evidence || cleanOneLineString(evidence.value).toLowerCase() === cleanOneLineString(value).toLowerCase()) {
              return nextGroup;
            }
            const metadataEvidence = { ...(group.metadataEvidence ?? {}) };
            delete metadataEvidence[key];
            return { ...nextGroup, metadataEvidence };
          })()
          : group
      )),
    }));
  };
  const metadataFieldsForGroup = (group: SampleDesignGroup, groupSamples: SampleBiologicalSample[]) => {
    const activeKeys = new Set([
      ...metadataFields.filter((field) => field.requirement === "required").map((field) => field.key),
      ...Object.entries(group.metadata)
        .filter(([, value]) => cleanOneLineString(value))
        .map(([key]) => key),
    ]);
    return metadataFields.filter((field) => {
      if (!activeKeys.has(field.key)) return false;
      const groupValue = sampleFieldCellValue(field, group.metadata);
      if (groupHasMeaningfulSampleField(groupSamples, field) && isMissingLikeSampleValue(groupValue)) return false;
      return true;
    });
  };
  const runWithUsableDraft = (action: (nextDraft: SampleDesignDraft) => void) => {
    if (usableDraft?.groups.length) action(usableDraft);
  };
  return (
    <div className="assistant-recommendation">
      <div className="assistant-recommendation-scroll">
        <div className="assistant-recommendation-head">
          <strong>Sample recommendation</strong>
          <span>{isPending && !hasDraft ? "Analyzing" : workingDraft ? `${workingDraft.groups.length} groups` : "Pending"}</span>
        </div>
        {isPending && !hasDraft ? (
          <div className="assistant-loading-card">
            <span className="assistant-spinner" />
            <div>
              <strong>AI is reading import context</strong>
              <p>Generating sample groups, metadata JSON and core sample-to-file mappings.</p>
            </div>
          </div>
        ) : (
          <div className={`assistant-summary-card ${workingDraft ? "ok" : ""}`}>
            {workingDraft ? <Check size={16} /> : <Sparkles size={16} />}
            <div>
              <strong>{workingDraft ? `${workingDraft.groups.length} sample group${workingDraft.groups.length === 1 ? "" : "s"} parsed` : "No AI design has been generated"}</strong>
              <p>{workingDraft ? workingDraft.summary : "Run AI to infer sample groups and core sample-to-file mappings from the import context, then edit the standardized JSON before filling the left-side attributes."}</p>
            </div>
          </div>
        )}
        <div className="assistant-compact-meta">
          {facts.map((item) => (
            <span key={`${item.label}-${item.value}`}>{item.label}: {item.value}</span>
          ))}
        </div>
        {workingDraft?.groupingStrategy && (
          <div className="sample-grouping-strategy" aria-label="AI grouping strategy">
            <div className="assistant-section-head">
              <strong>Grouping strategy</strong>
              <span>{workingDraft.groupingStrategy.selectedGroupingFields.join(", ") || "AI selected"}</span>
            </div>
            {workingDraft.groupingStrategy.reason && <p>{workingDraft.groupingStrategy.reason}</p>}
            <div className="sample-grouping-chip-row">
              {workingDraft.groupingStrategy.candidateGroupingFields.slice(0, 6).map((item) => (
                <span key={`candidate-${item.field}`}>Candidate: {item.field}{item.values.length ? ` (${item.values.slice(0, 4).join(", ")})` : ""}</span>
              ))}
              {workingDraft.groupingStrategy.rejectedGroupingFields.slice(0, 4).map((item) => (
                <span key={`rejected-${item.field}`}>Rejected: {item.field}</span>
              ))}
            </div>
          </div>
        )}
        <div className="recommendation-stack">
          <span>Recommended design</span>
          {workingDraft?.groups.length ? (
            workingDraft.groups.map((group, index) => (
              <em key={group.id}>
                <span className="recommendation-template-name">
                  <UsersRound size={14} />
                  <b>{group.groupName || `Group ${index + 1}`}</b>
                </span>
                <small>{group.sampleCount} samples</small>
              </em>
            ))
          ) : (
            <div className="assistant-stack-placeholder">
              {isPending ? "Generating sample JSON..." : "No AI sample design yet."}
            </div>
          )}
        </div>
        {workingDraft && (
          <>
            <div className="sample-json-editor">
              <div className="assistant-section-head">
                <strong>Editable JSON draft</strong>
                <span>{editableFieldCount} values</span>
              </div>
              <label className="sample-json-summary-field">
                Summary
                <textarea
                  aria-label="AI sample JSON summary"
                  value={workingDraft.summary}
                  onChange={(event) => updateEditableDraft((current) => ({ ...current, summary: event.target.value }))}
                />
              </label>
              {Boolean(workingDraft.warnings?.length) && (
                <div className="sample-json-warning-list">
                  {workingDraft.warnings?.map((warning, index) => (
                    <span key={`draft-warning-${index}`}><AlertTriangle size={13} /> {warning}</span>
                  ))}
                </div>
              )}
              <div className="sample-json-group-list">
                {workingDraft.groups.map((group, groupIndex) => {
                  const groupSamples = expandAssistantBiologicalSamplesForGroup(group, biologicalSamplesByGroup[groupIndex] ?? []);
                  const groupFields = metadataFieldsForGroup(group, groupSamples);
                  return (
                    <article key={group.id || groupIndex} className="sample-json-group-card">
                      <div className="sample-json-group-head">
                        <strong>Group {groupIndex + 1}</strong>
                        <small>{groupSamples.length || group.sampleCount} samples</small>
                      </div>
                      <div className="sample-json-core-grid">
                        <label>
                          Group name
                          <input
                            aria-label={`AI group ${groupIndex + 1} group name`}
                            value={group.groupName}
                            onChange={(event) => updateEditableGroup(groupIndex, { groupName: event.target.value })}
                          />
                        </label>
                        <label>
                          Samples
                          <input
                            aria-label={`AI group ${groupIndex + 1} sample count`}
                            inputMode="numeric"
                            value={String(group.sampleCount)}
                            onChange={(event) => updateEditableGroup(groupIndex, { sampleCount: Math.max(1, Math.min(200, Math.floor(Number(event.target.value) || 1))) })}
                          />
                        </label>
                        <label>
                          Prefix
                          <input
                            aria-label={`AI group ${groupIndex + 1} naming prefix`}
                            value={group.namingPrefix}
                            onChange={(event) => updateEditableGroup(groupIndex, { namingPrefix: cleanSamplePrefix(event.target.value) })}
                          />
                        </label>
                      </div>
                      <div className="sample-json-metadata-grid">
                        {groupFields.map((field) => {
                          const label = sampleFieldDisplayLabel(field);
                          const value = group.metadata[field.key] ?? "";
                          const sourceKey = `${group.id || groupIndex}-${field.key}`;
                          const metadataEvidence = group.metadataEvidence?.[field.key];
                          const hasMetadataEvidence = Boolean(metadataEvidence?.reason || metadataEvidence?.sources.length);
                          return (
                            <div key={`${group.id}-${field.key}`} className="sample-json-field-editor">
                              <div className="sample-json-field-label">
                                <span>{label}</span>
                                <small>{field.requirement}</small>
                              </div>
                              <div className="sample-json-value-row">
                                {field.inputType === "select" ? (
                                  <select
                                    aria-label={`AI group ${groupIndex + 1} ${label}`}
                                    value={value}
                                    onChange={(event) => updateEditableMetadata(groupIndex, field.key, event.target.value)}
                                  >
                                    {(field.options ?? []).map((option) => <option key={option} value={option}>{option || "Select..."}</option>)}
                                  </select>
                                ) : (
                                  <input
                                    aria-label={`AI group ${groupIndex + 1} ${label}`}
                                    value={value}
                                    onChange={(event) => updateEditableMetadata(groupIndex, field.key, event.target.value)}
                                    placeholder={field.searchPlaceholder ?? field.placeholder}
                                  />
                                )}
                                <button
                                  className="sample-json-source-button"
                                  type="button"
                                  disabled={!hasMetadataEvidence}
                                  aria-expanded={openMetadataSourceKey === sourceKey}
                                  onClick={() => setOpenMetadataSourceKey((current) => current === sourceKey ? null : sourceKey)}
                                >
                                  <ScanLine size={13} /> Source
                                </button>
                              </div>
                              {openMetadataSourceKey === sourceKey && metadataEvidence && (
                                <div className="sample-json-source-detail">
                                  <strong>{metadataEvidence.reason || "Evidence source"}</strong>
                                  {typeof metadataEvidence.confidence === "number" && <span>{Math.round(metadataEvidence.confidence * 100)}% confidence</span>}
                                  <div className="assistant-source-list">
                                    {metadataEvidence.sources.map((source, index) => (
                                      <div key={`${source.label}-${index}`} className="assistant-source-card">
                                        <span>{source.label}</span>
                                        <strong>{source.value}</strong>
                                        <small>{source.location || source.source || source.field || "Import context"}</small>
                                      </div>
                                    ))}
                                    {!metadataEvidence.sources.length && <small>No concrete source citation was returned for this value.</small>}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {!groupFields.length && <div className="assistant-stack-placeholder">No editable metadata fields were returned for this group.</div>}
                      </div>
                      <AssistantBiologicalSamplesTable
                        groupIndex={groupIndex}
                        samples={groupSamples}
                        metadataFields={metadataFields}
                      />
                      {Object.keys(group.assayContext ?? {}).length > 0 && (
                        <div className="sample-json-context-list" aria-label={`AI group ${groupIndex + 1} assay context`}>
                          <strong>Assay context</strong>
                          {Object.entries(group.assayContext ?? {}).map(([key, value]) => (
                            <span key={`${group.id}-${key}`}>{key}: {Array.isArray(value) ? value.join(", ") : String(value)}</span>
                          ))}
                        </div>
                      )}
                      {Boolean(group.warnings?.length) && (
                        <div className="sample-json-warning-list" aria-label={`AI group ${groupIndex + 1} warnings`}>
                          {group.warnings?.map((warning, warningIndex) => (
                            <span key={`${group.id}-warning-${warningIndex}`}><AlertTriangle size={13} /> {warning}</span>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
              <details className="sample-json-preview">
                <summary>Standard JSON</summary>
                <pre>{JSON.stringify(sampleDraftToJson(workingDraft), null, 2)}</pre>
              </details>
            </div>
            <div className="assistant-decision-section">
              <div className="assistant-section-head">
                <strong>Why this design</strong>
              </div>
              <div className="assistant-decision-list">
                {workingDraft.groups.map((group) => (
                  <article key={group.id} className="assistant-decision-item">
                    <div className="assistant-decision-template">
                      <span className="recommendation-template-name">
                        <UsersRound size={14} />
                        <b>{group.groupName}</b>
                      </span>
                      <small>{group.namingPrefix}_01</small>
                    </div>
                    <p>{sampleMetadataSummary(group.metadata)}</p>
                  </article>
                ))}
              </div>
            </div>
            <div className="assistant-source-section">
              <div className="assistant-section-head">
                <strong>Sources</strong>
                <button className="text-button" type="button" onClick={onToggleSources}>
                  {sourcesOpen ? "Hide" : "Show"}
                </button>
              </div>
              {sourcesOpen && (
                <div className="assistant-source-groups">
                  <article className="assistant-source-group">
                    <div className="assistant-decision-template">
                      <span className="recommendation-template-name">
                        <ScanLine size={14} />
                        <b>Import evidence</b>
                      </span>
                      <small>{sourceCount} source{sourceCount === 1 ? "" : "s"}</small>
                    </div>
                    <div className="assistant-source-list">
                      {workingDraft.sources.map((source, index) => (
                        <div key={`${source.label}-${index}`} className="assistant-source-card">
                          <span>{source.label}</span>
                          <strong>{source.value}</strong>
                          <small>{source.location || source.source || "Import context"}</small>
                        </div>
                      ))}
                      {!workingDraft.sources.length && <div className="assistant-stack-placeholder">No concrete import source was returned with this JSON draft.</div>}
                    </div>
                  </article>
                </div>
              )}
            </div>
          </>
        )}
        {error && <span className="form-error compact-error">{error}</span>}
      </div>
      <div className="recommendation-actions compact ai-sample-actions">
        <button className="btn primary" type="button" onClick={() => runWithUsableDraft(onAccept)} disabled={!hasUsableDraft || isSaving}>
          Accept
        </button>
        <button className="btn ghost" type="button" onClick={onRunAi} disabled={isPending || isSaving}>
          <Play size={16} /> {isPending ? "Running" : draft ? "Rerun" : "Run AI"}
        </button>
      </div>
    </div>
  );
}

type TechnicalLabelOption = {
  id: string;
  title: string;
  channels: number;
  labels: string[];
};

type TechnicalFileDraft = {
  sourceName: string;
  assayName: string;
  dataFile: string;
  label: string;
  fractionId: string;
  technicalReplicate: string;
};

type TechnicalModificationType = "Fixed" | "Variable";

type TechnicalModification = {
  id: string;
  name: string;
  accession: string;
  target: string;
  position: string;
  type: TechnicalModificationType;
};

const TECHNICAL_FIXED_MODIFICATIONS: TechnicalModification[] = [
  { id: "carbamidomethyl-c", name: "Carbamidomethyl", accession: "UNIMOD:4", target: "C", position: "Anywhere", type: "Fixed" },
  { id: "tmt6plex-k", name: "TMT6plex", accession: "UNIMOD:737", target: "K", position: "Anywhere", type: "Fixed" },
  { id: "tmt6plex-nterm", name: "TMT6plex", accession: "UNIMOD:737", target: "N-term", position: "Protein N-term", type: "Fixed" },
  { id: "tmtpro-k", name: "TMTpro", accession: "UNIMOD:2016", target: "K", position: "Anywhere", type: "Fixed" },
  { id: "tmtpro-nterm", name: "TMTpro", accession: "UNIMOD:2016", target: "N-term", position: "Protein N-term", type: "Fixed" },
];

const TECHNICAL_VARIABLE_MODIFICATIONS: TechnicalModification[] = [
  { id: "oxidation-m", name: "Oxidation", accession: "UNIMOD:35", target: "M", position: "Anywhere", type: "Variable" },
  { id: "acetyl-nterm", name: "Acetyl", accession: "UNIMOD:1", target: "N-term", position: "Protein N-term", type: "Variable" },
  { id: "phospho-sty", name: "Phospho", accession: "UNIMOD:21", target: "S,T,Y", position: "Anywhere", type: "Variable" },
  { id: "deamidated-nq", name: "Deamidated", accession: "UNIMOD:7", target: "N,Q", position: "Anywhere", type: "Variable" },
  { id: "glygly-k", name: "GlyGly", accession: "UNIMOD:121", target: "K", position: "Anywhere", type: "Variable" },
];

const TECHNICAL_COMMON_MODIFICATIONS = [...TECHNICAL_FIXED_MODIFICATIONS, ...TECHNICAL_VARIABLE_MODIFICATIONS];
const DEFAULT_TECHNICAL_MODIFICATIONS: TechnicalModification[] = [TECHNICAL_FIXED_MODIFICATIONS[0]];

type AiReviewResult = {
  summary: string;
  recommendations: { title: string; detail: string }[];
  warnings: string[];
};

type FilesTechnicalAiInput = {
  task: string;
  project_id: string;
  standard_reference: string;
  current_sdrf_table: Record<string, unknown>;
  uploaded_files: Record<string, unknown>[];
  current_technical_state: Record<string, unknown>;
  current_file_mappings: TechnicalFileDraft[];
  output_schema: Record<string, unknown>;
};

type FilesTechnicalAiDraft = {
  summary: string;
  labelType: string;
  labels: string[];
  fractionIds: string[];
  acquisitionMethod: string;
  instrument: string;
  cleavageAgent: string;
  mappings: TechnicalFileDraft[];
  warnings: string[];
};

const MS_TECHNICAL_HEADERS = [
  "assay name",
  "technology type",
  "comment[proteomics data acquisition method]",
  "comment[label]",
  "comment[instrument]",
  "comment[cleavage agent details]",
  "comment[modification parameters]",
  "comment[fraction identifier]",
  "comment[technical replicate]",
  "comment[data file]",
];

const TECHNICAL_LABEL_OPTIONS: TechnicalLabelOption[] = [
  { id: "lfq", title: "Label-free (LFQ)", channels: 1, labels: ["label free sample"] },
  { id: "tmt-6", title: "TMT 6-plex", channels: 6, labels: ["TMT126", "TMT127", "TMT128", "TMT129", "TMT130", "TMT131"] },
  { id: "tmt-10", title: "TMT 10-plex", channels: 10, labels: ["TMT126", "TMT127N", "TMT127C", "TMT128N", "TMT128C", "TMT129N", "TMT129C", "TMT130N", "TMT130C", "TMT131"] },
  { id: "tmt-11", title: "TMT 11-plex", channels: 11, labels: ["TMT126", "TMT127N", "TMT127C", "TMT128N", "TMT128C", "TMT129N", "TMT129C", "TMT130N", "TMT130C", "TMT131N", "TMT131C"] },
  { id: "tmt-16", title: "TMT 16-plex", channels: 16, labels: ["TMT126", "TMT127N", "TMT127C", "TMT128N", "TMT128C", "TMT129N", "TMT129C", "TMT130N", "TMT130C", "TMT131N", "TMT131C", "TMT132N", "TMT132C", "TMT133N", "TMT133C", "TMT134N"] },
  { id: "tmt-18", title: "TMT 18-plex", channels: 18, labels: ["TMT126", "TMT127N", "TMT127C", "TMT128N", "TMT128C", "TMT129N", "TMT129C", "TMT130N", "TMT130C", "TMT131N", "TMT131C", "TMT132N", "TMT132C", "TMT133N", "TMT133C", "TMT134N", "TMT134C", "TMT135N"] },
  { id: "itraq-4", title: "iTRAQ 4-plex", channels: 4, labels: ["iTRAQ114", "iTRAQ115", "iTRAQ116", "iTRAQ117"] },
  { id: "itraq-8", title: "iTRAQ 8-plex", channels: 8, labels: ["iTRAQ113", "iTRAQ114", "iTRAQ115", "iTRAQ116", "iTRAQ117", "iTRAQ118", "iTRAQ119", "iTRAQ121"] },
  { id: "silac", title: "SILAC", channels: 3, labels: ["SILAC light", "SILAC medium", "SILAC heavy"] },
];

const AI_REVIEW_REQUIRED_FIELDS = [
  "source name",
  "characteristics[organism]",
  "assay name",
  "technology type",
  "comment[proteomics data acquisition method]",
  "comment[label]",
  "comment[instrument]",
  "comment[cleavage agent details]",
  "comment[fraction identifier]",
  "comment[technical replicate]",
  "comment[data file]",
];

function splitListInput(value: string): string[] {
  return value.split(/[,;\n]+/).map((item) => cleanOneLineString(item)).filter(Boolean);
}

function technicalCandidateFileNames(files: Awaited<ReturnType<typeof api.listFiles>>): string[] {
  return files
    .filter((file) => !["design-table", "publication-pdf", "sdrf", "metadata", "supplementary"].includes(file.file_type))
    .map((file) => file.filename);
}

function shouldUseTableRowsForTechnicalDrafts(
  table: Awaited<ReturnType<typeof api.getSdrfTable>> | undefined,
  files: Awaited<ReturnType<typeof api.listFiles>>,
): boolean {
  if (!table?.rows?.length) return false;
  if (table.dirty) return true;
  return technicalCandidateFileNames(files).length === 0;
}

function technicalDraftsFromTable(
  table: Awaited<ReturnType<typeof api.getSdrfTable>> | undefined,
  files: Awaited<ReturnType<typeof api.listFiles>>,
  labelOption: TechnicalLabelOption,
): TechnicalFileDraft[] {
  const tableRows = table?.rows ?? [];
  if (shouldUseTableRowsForTechnicalDrafts(table, files) && tableRows.length) {
    return tableRows.map((row, index) => ({
      sourceName: cleanOneLineString(row["source name"]) || `sample_${String(index + 1).padStart(2, "0")}`,
      assayName: cleanOneLineString(row["assay name"]) || `assay_${String(index + 1).padStart(2, "0")}`,
      dataFile: cleanOneLineString(row["comment[data file]"]) || cleanOneLineString(row["data file"]) || `file_${String(index + 1).padStart(2, "0")}.raw`,
      label: cleanOneLineString(row["comment[label]"]) || labelOption.labels[index % labelOption.labels.length],
      fractionId: cleanOneLineString(row["comment[fraction identifier]"]) || "1",
      technicalReplicate: cleanOneLineString(row["comment[technical replicate]"]) || "1",
    }));
  }
  const candidateFiles = technicalCandidateFileNames(files);
  return (candidateFiles.length ? candidateFiles : ["file_01.raw"]).map((filename, index) => ({
    sourceName: `sample_${String(index + 1).padStart(2, "0")}`,
    assayName: `assay_${String(index + 1).padStart(2, "0")}`,
    dataFile: filename,
    label: labelOption.labels[index % labelOption.labels.length],
    fractionId: "1",
    technicalReplicate: "1",
  }));
}

function assignLabelsToDrafts(drafts: TechnicalFileDraft[], option: TechnicalLabelOption): TechnicalFileDraft[] {
  return drafts.map((draft, index) => ({ ...draft, label: option.labels[index % option.labels.length] }));
}

function assignFractionsToDrafts(drafts: TechnicalFileDraft[], fractionIds: string[]): TechnicalFileDraft[] {
  const usableFractions = fractionIds.length ? fractionIds : ["1"];
  return drafts.map((draft, index) => ({ ...draft, fractionId: usableFractions[index % usableFractions.length] }));
}

function technicalModificationLabel(modification: TechnicalModification): string {
  return modification.target ? `${modification.name} (${modification.target})` : modification.name;
}

function formatTechnicalModifications(modifications: TechnicalModification[]): string {
  return modifications.map(technicalModificationLabel).filter(Boolean).join("; ") || "not available";
}

function findTechnicalModification(value: string): TechnicalModification | undefined {
  const normalizedValue = normalizedAxisName(value);
  if (!normalizedValue) return undefined;
  return TECHNICAL_COMMON_MODIFICATIONS.find((modification) => (
    normalizedAxisName(modification.id) === normalizedValue
    || normalizedAxisName(modification.accession) === normalizedValue
    || normalizedAxisName(technicalModificationLabel(modification)) === normalizedValue
    || normalizedAxisName(modification.name) === normalizedValue
    || normalizedAxisName(technicalModificationLabel(modification)).includes(normalizedValue)
  ));
}

function customTechnicalModification(value: string): TechnicalModification | null {
  const label = cleanOneLineString(value);
  if (!label) return null;
  const targetMatch = label.match(/\(([^)]+)\)/);
  const accessionMatch = label.match(/UNIMOD:\d+/i);
  const name = cleanOneLineString(label.replace(/\([^)]*\)/g, "").replace(/UNIMOD:\d+/ig, "")) || label;
  return {
    id: `custom-${normalizedAxisName(label) || Date.now()}`,
    name,
    accession: accessionMatch?.[0]?.toUpperCase() ?? "not available",
    target: cleanOneLineString(targetMatch?.[1]) || "not available",
    position: "Anywhere",
    type: "Variable",
  };
}

function matchTechnicalLabelOption(labelType: string, labels: string[]): TechnicalLabelOption | undefined {
  const normalizedType = normalizedAxisName(labelType);
  if (normalizedType) {
    const direct = TECHNICAL_LABEL_OPTIONS.find((option) => (
      normalizedAxisName(option.id) === normalizedType
      || normalizedAxisName(option.title) === normalizedType
      || normalizedAxisName(option.title).includes(normalizedType)
      || normalizedType.includes(normalizedAxisName(option.title))
    ));
    if (direct) return direct;
  }
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  return TECHNICAL_LABEL_OPTIONS.find((option) => (
    normalizedLabels.length > 0
    && normalizedLabels.every((label) => option.labels.map((item) => item.toLowerCase()).includes(label))
  ));
}

function buildFilesTechnicalAiInput({
  projectId,
  table,
  files,
  labelOption,
  fractionated,
  fractionInput,
  acquisitionMethod,
  instrument,
  cleavageAgent,
  modifications,
  drafts,
}: {
  projectId: string;
  table?: Awaited<ReturnType<typeof api.getSdrfTable>>;
  files: Awaited<ReturnType<typeof api.listFiles>>;
  labelOption: TechnicalLabelOption;
  fractionated: boolean;
  fractionInput: string;
  acquisitionMethod: string;
  instrument: string;
  cleavageAgent: string;
  modifications: TechnicalModification[];
  drafts: TechnicalFileDraft[];
}): FilesTechnicalAiInput {
  return {
    task: "Generate editable SDRF-Proteomics data-file technical attributes for the Files page. Return strict JSON only.",
    project_id: projectId,
    standard_reference: "SDRF-Proteomics v1.1.0 / quantMS SDRF specification",
    current_sdrf_table: {
      headers: table?.headers ?? [],
      row_count: table?.rows?.length ?? 0,
      preview_rows: table?.rows?.slice(0, 30) ?? [],
    },
    uploaded_files: files.slice(0, 80).map((file) => ({
      filename: file.filename,
      file_type: file.file_type,
      parse_status: file.parse_status,
      size_bytes: file.size_bytes,
    })),
    current_technical_state: {
      label_type: labelOption.title,
      labels: labelOption.labels,
      fractionated,
      fraction_ids: splitListInput(fractionInput),
      acquisition_method: acquisitionMethod,
      instrument,
      cleavage_agent: cleavageAgent,
      modification_parameters: formatTechnicalModifications(modifications),
      modifications: modifications.map((modification) => ({
        name: modification.name,
        accession: modification.accession,
        target: modification.target,
        position: modification.position,
        type: modification.type,
      })),
    },
    current_file_mappings: drafts.slice(0, 120),
    output_schema: {
      summary: "short explanation of the inferred file attributes",
      label_type: "one of Label-free (LFQ), TMT 6-plex, TMT 10-plex, TMT 11-plex, TMT 16-plex, TMT 18-plex, iTRAQ 4-plex, iTRAQ 8-plex, SILAC, or a specific observed label type",
      labels: ["labels or channels to use in comment[label]"],
      fraction_ids: ["fraction identifiers for comment[fraction identifier]"],
      acquisition_method: "DDA, DIA, PRM, SRM, or not available",
      instrument: "instrument model or not available",
      cleavage_agent: "cleavage agent details or not available",
      modification_parameters: "semicolon-separated comment[modification parameters] value",
      file_mappings: [{
        source_name: "source name",
        assay_name: "assay name",
        label: "comment[label]",
        fraction_id: "comment[fraction identifier]",
        technical_replicate: "comment[technical replicate]",
        data_file: "comment[data file]",
      }],
      warnings: ["uncertainties or conflicts the user should review"],
    },
  };
}

function buildFilesTechnicalAiRequestPayload(input: FilesTechnicalAiInput, config: Pick<ClientAiConfig, "model">): Record<string, unknown> {
  return {
    model: config.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You generate SDRF-Proteomics data-file technical attributes for an editable Files page.",
          "Use only the provided SDRF rows, uploaded files, and current editor state.",
          "Return strict JSON matching the requested schema.",
          "Do not invent raw file names that are not in current_file_mappings or uploaded_files.",
          "If evidence is missing for instrument, acquisition method, cleavage agent, label, fraction, or replicate, use the current value or 'not available' and add a warning.",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(input) },
    ],
  };
}

function sanitizeTechnicalMappingRecord(record: Record<string, unknown>, index: number): TechnicalFileDraft {
  return {
    sourceName: firstRecordString(record, ["source_name", "sourceName", "source", "sample", "sample_name"]) || `sample_${String(index + 1).padStart(2, "0")}`,
    assayName: firstRecordString(record, ["assay_name", "assayName", "assay"]) || `assay_${String(index + 1).padStart(2, "0")}`,
    dataFile: firstRecordString(record, ["data_file", "dataFile", "file", "filename", "raw_file", "rawFile"]),
    label: firstRecordString(record, ["label", "comment[label]", "channel"]),
    fractionId: firstRecordString(record, ["fraction_id", "fractionId", "fraction", "comment[fraction identifier]"]),
    technicalReplicate: firstRecordString(record, ["technical_replicate", "technicalReplicate", "replicate", "technical_rep", "comment[technical replicate]"]),
  };
}

function parseFilesTechnicalAiDraft(value: unknown): FilesTechnicalAiDraft {
  const record = asRecommendationRecord(value) ?? {};
  const mappings = rawRecordList(record.file_mappings ?? record.mappings ?? record.files)
    .map((item, index) => sanitizeTechnicalMappingRecord(item, index))
    .filter((item) => item.sourceName || item.assayName || item.dataFile || item.label || item.fractionId || item.technicalReplicate)
    .slice(0, 200);
  return {
    summary: cleanOneLineString(record.summary ?? record.description),
    labelType: cleanOneLineString(record.label_type ?? record.labelType ?? record.quantification_strategy),
    labels: sanitizeStringList(record.labels ?? record.channels ?? record.label).slice(0, 32),
    fractionIds: sanitizeStringList(record.fraction_ids ?? record.fractionIds ?? record.fractions ?? record.fraction_id).slice(0, 80),
    acquisitionMethod: cleanOneLineString(record.acquisition_method ?? record.acquisitionMethod ?? record.data_acquisition_method),
    instrument: cleanOneLineString(record.instrument ?? record.instrument_model),
    cleavageAgent: cleanOneLineString(record.cleavage_agent ?? record.cleavageAgent ?? record.cleavage_agent_details ?? record.enzyme),
    mappings,
    warnings: sanitizeStringList(record.warnings ?? record.warning).slice(0, 12),
  };
}

async function requestFilesTechnicalDraft(input: FilesTechnicalAiInput, config: ClientAiConfig, requestPayload = buildFilesTechnicalAiRequestPayload(input, config)): Promise<FilesTechnicalAiDraft> {
  const payload = await api.chatCompletion(requestPayload);
  const content = aiChatContent(payload);
  return parseFilesTechnicalAiDraft(parseAiJsonObject(content));
}

function filesAiDraftStorageKey(projectId: string): string {
  return `sdrf-studio-files-ai-draft:${projectId}`;
}

function readStoredFilesAiDraft(projectId: string): FilesTechnicalAiDraft | null {
  try {
    const saved = window.localStorage.getItem(filesAiDraftStorageKey(projectId));
    return saved ? parseFilesTechnicalAiDraft(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

function storeFilesAiDraft(projectId: string, draft: FilesTechnicalAiDraft) {
  window.localStorage.setItem(filesAiDraftStorageKey(projectId), JSON.stringify({
    summary: draft.summary,
    label_type: draft.labelType,
    labels: draft.labels,
    fraction_ids: draft.fractionIds,
    acquisition_method: draft.acquisitionMethod,
    instrument: draft.instrument,
    cleavage_agent: draft.cleavageAgent,
    file_mappings: draft.mappings.map((mapping) => ({
      source_name: mapping.sourceName,
      assay_name: mapping.assayName,
      label: mapping.label,
      fraction_id: mapping.fractionId,
      technical_replicate: mapping.technicalReplicate,
      data_file: mapping.dataFile,
    })),
    warnings: draft.warnings,
  }));
}

function mergeTechnicalConfigIntoTable({
  projectId,
  table,
  drafts,
  acquisitionMethod,
  instrument,
  cleavageAgent,
  modifications,
}: {
  projectId: string;
  table?: Awaited<ReturnType<typeof api.getSdrfTable>>;
  drafts: TechnicalFileDraft[];
  acquisitionMethod: string;
  instrument: string;
  cleavageAgent: string;
  modifications: TechnicalModification[];
}): SdrfTable {
  const baseHeaders = table?.headers?.length ? table.headers : ["source name"];
  const headers = Array.from(new Set([...baseHeaders, ...MS_TECHNICAL_HEADERS]));
  const modificationParameters = formatTechnicalModifications(modifications);
  const existingBySource = new Map((table?.rows ?? []).map((row) => [cleanOneLineString(row["source name"]), row]));
  const rows = drafts.map((draft, index) => {
    const sourceName = cleanOneLineString(draft.sourceName) || `sample_${String(index + 1).padStart(2, "0")}`;
    const existing = existingBySource.get(sourceName) ?? table?.rows?.[index] ?? {};
    const row = Object.fromEntries(headers.map((header) => [header, existing[header] ?? ""]));
    row["source name"] = sourceName;
    row["assay name"] = cleanOneLineString(draft.assayName) || `assay_${String(index + 1).padStart(2, "0")}`;
    row["technology type"] = "mass spectrometry";
    row["comment[proteomics data acquisition method]"] = cleanOneLineString(acquisitionMethod) || "not available";
    row["comment[label]"] = cleanOneLineString(draft.label) || "label free sample";
    row["comment[instrument]"] = cleanOneLineString(instrument) || "not available";
    row["comment[cleavage agent details]"] = cleanOneLineString(cleavageAgent) || "Trypsin";
    row["comment[modification parameters]"] = modificationParameters;
    row["comment[fraction identifier]"] = cleanOneLineString(draft.fractionId) || "1";
    row["comment[technical replicate]"] = cleanOneLineString(draft.technicalReplicate) || "1";
    row["comment[data file]"] = cleanOneLineString(draft.dataFile) || `file_${String(index + 1).padStart(2, "0")}.raw`;
    return row;
  });
  return {
    id: table?.id ?? null,
    project_id: table?.project_id ?? projectId,
    headers,
    rows,
    column_metadata: Object.fromEntries(headers.map((header) => [header, classifySdrfColumn(header, [])])),
    dirty: true,
    validation_state: table?.validation_state ?? {},
  };
}

function FilesStep({
  projectId,
  table,
  files,
  refresh,
}: {
  projectId: string;
  table?: Awaited<ReturnType<typeof api.getSdrfTable>>;
  files: Awaited<ReturnType<typeof api.listFiles>>;
  refresh: () => void;
}) {
  const initialLabelOption = TECHNICAL_LABEL_OPTIONS[0];
  const [labelOptionId, setLabelOptionId] = useState(initialLabelOption.id);
  const activeLabelOption = TECHNICAL_LABEL_OPTIONS.find((option) => option.id === labelOptionId) ?? initialLabelOption;
  const technicalSourceTable = shouldUseTableRowsForTechnicalDrafts(table, files) ? table : undefined;
  const [fractionated, setFractionated] = useState(false);
  const [fractionInput, setFractionInput] = useState("1");
  const [acquisitionMethod, setAcquisitionMethod] = useState("DDA");
  const [instrument, setInstrument] = useState("not available");
  const [cleavageAgent, setCleavageAgent] = useState("Trypsin");
  const [modificationSearch, setModificationSearch] = useState("");
  const [modifications, setModifications] = useState<TechnicalModification[]>(DEFAULT_TECHNICAL_MODIFICATIONS);
  const [status, setStatus] = useState("");
  const [filesAiDraft, setFilesAiDraft] = useState<FilesTechnicalAiDraft | null>(() => readStoredFilesAiDraft(projectId));
  const [filesAiStatus, setFilesAiStatus] = useState(() => (
    readStoredFilesAiDraft(projectId) ? "AI file attributes are available. Review the draft, then apply it to the editor." : ""
  ));
  const [filesAiError, setFilesAiError] = useState("");
  const [drafts, setDrafts] = useState<TechnicalFileDraft[]>(() => technicalDraftsFromTable(technicalSourceTable, files, initialLabelOption));
  const tableDraftSourceKey = `${technicalSourceTable?.id ?? "no-table"}:${technicalSourceTable?.dirty ? "dirty" : "clean"}:${technicalSourceTable?.rows?.length ?? 0}:${files.map((file) => `${file.id}:${file.filename}:${file.file_type}`).join("|")}`;
  useEffect(() => {
    setDrafts(technicalDraftsFromTable(technicalSourceTable, files, activeLabelOption));
  }, [tableDraftSourceKey]);
  const saveTechnicalConfig = useMutation({
    mutationFn: () => api.putSdrfTable(projectId, mergeTechnicalConfigIntoTable({ projectId, table: technicalSourceTable, drafts, acquisitionMethod, instrument, cleavageAgent, modifications })),
    onSuccess: () => {
      setStatus("Technical file attributes saved to the SDRF table.");
      refresh();
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to save technical configuration."),
  });
  const chooseLabelOption = (option: TechnicalLabelOption) => {
    setLabelOptionId(option.id);
    setDrafts((current) => assignLabelsToDrafts(current, option));
  };
  const updateFractionInput = (value: string) => {
    setFractionInput(value);
    setDrafts((current) => assignFractionsToDrafts(current, splitListInput(value)));
  };
  const updateDraft = (index: number, patch: Partial<TechnicalFileDraft>) => {
    setDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)));
  };
  const toggleModification = (modification: TechnicalModification) => {
    setModifications((current) => (
      current.some((item) => item.id === modification.id)
        ? current.filter((item) => item.id !== modification.id)
        : [...current, modification]
    ));
  };
  const updateModification = (id: string, patch: Partial<TechnicalModification>) => {
    setModifications((current) => current.map((modification) => (modification.id === id ? { ...modification, ...patch } : modification)));
  };
  const addSearchedModification = () => {
    const modification = findTechnicalModification(modificationSearch) ?? customTechnicalModification(modificationSearch);
    if (!modification) return;
    setModifications((current) => (
      current.some((item) => item.id === modification.id)
        ? current
        : [...current, modification]
    ));
    setModificationSearch("");
  };
  const selectedModificationIds = new Set(modifications.map((modification) => modification.id));
  const filesAiInput = useMemo(() => buildFilesTechnicalAiInput({
    projectId,
    table: technicalSourceTable,
    files,
    labelOption: activeLabelOption,
    fractionated,
    fractionInput,
    acquisitionMethod,
    instrument,
    cleavageAgent,
    modifications,
    drafts,
  }), [acquisitionMethod, activeLabelOption, cleavageAgent, drafts, files, fractionInput, fractionated, instrument, modifications, projectId, technicalSourceTable]);
  const applyFilesAiDraft = useCallback((draft: FilesTechnicalAiDraft) => {
    const nextLabelOption = matchTechnicalLabelOption(draft.labelType, draft.labels);
    if (nextLabelOption) setLabelOptionId(nextLabelOption.id);
    const nextFractions = draft.fractionIds.length ? draft.fractionIds : uniqueStrings(draft.mappings.map((mapping) => cleanOneLineString(mapping.fractionId))).slice(0, 80);
    if (nextFractions.length) {
      setFractionInput(nextFractions.join(", "));
      setFractionated(!(nextFractions.length === 1 && nextFractions[0] === "1"));
    }
    if (draft.acquisitionMethod) setAcquisitionMethod(draft.acquisitionMethod);
    if (draft.instrument) setInstrument(draft.instrument);
    if (draft.cleavageAgent) setCleavageAgent(draft.cleavageAgent);
    setDrafts((current) => {
      const currentRows = current.length ? current : technicalDraftsFromTable(technicalSourceTable, files, nextLabelOption ?? activeLabelOption);
      const byDataFile = new Map<string, TechnicalFileDraft>();
      const bySource = new Map<string, TechnicalFileDraft>();
      draft.mappings.forEach((mapping) => {
        const dataFileKey = cleanOneLineString(mapping.dataFile).toLowerCase();
        const sourceKey = cleanOneLineString(mapping.sourceName).toLowerCase();
        if (dataFileKey) byDataFile.set(dataFileKey, mapping);
        if (sourceKey) bySource.set(sourceKey, mapping);
      });
      const rowCount = Math.max(currentRows.length, draft.mappings.length);
      return Array.from({ length: rowCount }, (_, index) => {
        const currentRow: TechnicalFileDraft = currentRows[index] ?? {
          sourceName: `sample_${String(index + 1).padStart(2, "0")}`,
          assayName: `assay_${String(index + 1).padStart(2, "0")}`,
          dataFile: "",
          label: "",
          fractionId: "1",
          technicalReplicate: "1",
        };
        const aiRow: TechnicalFileDraft | undefined = byDataFile.get(cleanOneLineString(currentRow.dataFile).toLowerCase())
          ?? bySource.get(cleanOneLineString(currentRow.sourceName).toLowerCase())
          ?? draft.mappings[index];
        return {
          sourceName: cleanOneLineString(aiRow?.sourceName) || currentRow.sourceName,
          assayName: cleanOneLineString(aiRow?.assayName) || currentRow.assayName,
          dataFile: cleanOneLineString(aiRow?.dataFile) || currentRow.dataFile,
          label: cleanOneLineString(aiRow?.label) || currentRow.label || nextLabelOption?.labels[index % nextLabelOption.labels.length] || activeLabelOption.labels[index % activeLabelOption.labels.length],
          fractionId: cleanOneLineString(aiRow?.fractionId) || currentRow.fractionId || nextFractions[index % Math.max(1, nextFractions.length)] || "1",
          technicalReplicate: cleanOneLineString(aiRow?.technicalReplicate) || currentRow.technicalReplicate || "1",
        };
      });
    });
  }, [activeLabelOption, files, technicalSourceTable]);
  const handleApplyFilesAiDraft = () => {
    if (!filesAiDraft) return;
    applyFilesAiDraft(filesAiDraft);
    setFilesAiStatus("AI file attributes applied to the editor. Review them, then save technical configuration.");
  };
  const runFilesAi = useMutation({
    mutationFn: async () => {
      const config = readClientAiConfig();
      const requestPayload = buildFilesTechnicalAiRequestPayload(filesAiInput, config);
      const savedPrompt = await api.saveSampleAiPrompt(projectId, requestPayload);
      setFilesAiStatus(`AI prompt saved to ${savedPrompt.path}. Waiting for file attributes...`);
      return requestFilesTechnicalDraft(filesAiInput, config, requestPayload);
    },
    onMutate: () => {
      setFilesAiError("");
      setFilesAiStatus("AI is generating data-file attributes...");
    },
    onSuccess: (draft) => {
      setFilesAiDraft(draft);
      storeFilesAiDraft(projectId, draft);
      setFilesAiStatus("AI file attributes are ready. Review the draft, then apply it to the editor.");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Files AI request failed.";
      setFilesAiError(message);
      setFilesAiStatus(message);
    },
  });
  const technicalPreviewTable = useMemo(() => mergeTechnicalConfigIntoTable({ projectId, table: technicalSourceTable, drafts, acquisitionMethod, instrument, cleavageAgent, modifications }), [acquisitionMethod, cleavageAgent, drafts, instrument, modifications, projectId, technicalSourceTable]);

  return (
    <div className="content-grid templates-content-grid samples-content-grid">
      <section className="wide-stack">
        <Panel title="Technical Configuration">
          <div className="technical-editor">
            <div className="technical-section-head">
              <div>
                <strong>Label Type</strong>
                <p>Select the quantification strategy used in your experiment.</p>
              </div>
            </div>
            <div className="technical-choice-grid" role="list" aria-label="Label type options">
              {TECHNICAL_LABEL_OPTIONS.map((option) => (
                <button key={option.id} type="button" className={`technical-choice ${option.id === activeLabelOption.id ? "active" : ""}`} onClick={() => chooseLabelOption(option)}>
                  <span>{option.title}</span>
                  <small>{option.channels} channel(s)</small>
                  {option.id === activeLabelOption.id && <Check size={18} />}
                </button>
              ))}
            </div>
            <div className="technical-label-preview">
              <span>Labels:</span>
              <div>{activeLabelOption.labels.map((label) => <code key={label}>{label}</code>)}</div>
            </div>
            <div className="technical-form-grid">
              <label><span>Acquisition method</span><input aria-label="Acquisition method" value={acquisitionMethod} onChange={(event) => setAcquisitionMethod(event.target.value)} /></label>
              <label><span>Instrument</span><input aria-label="Instrument" value={instrument} onChange={(event) => setInstrument(event.target.value)} /></label>
              <label><span>Cleavage agent</span><input aria-label="Cleavage agent" value={cleavageAgent} onChange={(event) => setCleavageAgent(event.target.value)} /></label>
            </div>
            <div className="technical-section-head">
              <div>
                <strong>Post-Translational Modifications</strong>
                <p>Search UNIMOD or select common modifications.</p>
              </div>
            </div>
            <div className="technical-modification-search">
              <label>
                <span>Search UNIMOD</span>
                <div className="technical-modification-search-row">
                  <input
                    aria-label="Search UNIMOD"
                    value={modificationSearch}
                    onChange={(event) => setModificationSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addSearchedModification();
                      }
                    }}
                    placeholder="Search by name or accession (e.g., Oxidation, UNIMOD:35)..."
                  />
                  <button className="btn ghost" type="button" onClick={addSearchedModification} disabled={!modificationSearch.trim()}>
                    <Plus size={16} /> Add
                  </button>
                </div>
              </label>
            </div>
            <div className="technical-modification-common">
              <div>
                <strong>Common Modifications</strong>
                <p>Click to add with default settings.</p>
              </div>
              <span>FIXED:</span>
              <div className="technical-modification-chip-row">
                {TECHNICAL_FIXED_MODIFICATIONS.map((modification) => (
                  <button
                    key={modification.id}
                    className={`technical-modification-chip ${selectedModificationIds.has(modification.id) ? "active" : ""}`}
                    type="button"
                    onClick={() => toggleModification(modification)}
                  >
                    {technicalModificationLabel(modification)}
                  </button>
                ))}
              </div>
              <span>VARIABLE:</span>
              <div className="technical-modification-chip-row">
                {TECHNICAL_VARIABLE_MODIFICATIONS.map((modification) => (
                  <button
                    key={modification.id}
                    className={`technical-modification-chip ${selectedModificationIds.has(modification.id) ? "active" : ""}`}
                    type="button"
                    onClick={() => toggleModification(modification)}
                  >
                    {technicalModificationLabel(modification)}
                  </button>
                ))}
              </div>
            </div>
            <div className="technical-modification-selected">
              <div className="technical-section-head">
                <div>
                  <strong>Selected Modifications ({modifications.length})</strong>
                </div>
              </div>
              <div className="technical-modification-table-wrap">
                <table className="technical-modification-table">
                  <thead>
                    <tr><th>Name</th><th>Accession</th><th>Target</th><th>Position</th><th>Type</th><th /></tr>
                  </thead>
                  <tbody>
                    {modifications.map((modification) => (
                      <tr key={modification.id}>
                        <td>{modification.name}</td>
                        <td>{modification.accession}</td>
                        <td>
                          <select aria-label={`${modification.name} target`} value={modification.target} onChange={(event) => updateModification(modification.id, { target: event.target.value })}>
                            {["C", "M", "K", "N-term", "S,T,Y", "N,Q", "not available"].map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </td>
                        <td>
                          <select aria-label={`${modification.name} position`} value={modification.position} onChange={(event) => updateModification(modification.id, { position: event.target.value })}>
                            {["Anywhere", "Protein N-term", "Any N-term", "Protein C-term", "not available"].map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </td>
                        <td>
                          <select aria-label={`${modification.name} type`} value={modification.type} onChange={(event) => updateModification(modification.id, { type: event.target.value as TechnicalModificationType })}>
                            <option value="Fixed">Fixed</option>
                            <option value="Variable">Variable</option>
                          </select>
                        </td>
                        <td>
                          <button className="icon-btn" type="button" aria-label={`Remove ${technicalModificationLabel(modification)}`} onClick={() => toggleModification(modification)}>
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!modifications.length && (
                      <tr><td colSpan={6}>No modifications selected.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="technical-section-head">
              <div>
                <strong>Fractionation</strong>
                <p>Set fraction identifiers used before MS analysis.</p>
              </div>
              <div className="segmented-actions">
                <button type="button" className={!fractionated ? "active" : ""} onClick={() => { setFractionated(false); updateFractionInput("1"); }}>Not fractionated</button>
                <button type="button" className={fractionated ? "active" : ""} onClick={() => { setFractionated(true); updateFractionInput("F1"); }}>Fractionated</button>
              </div>
            </div>
            <label className="technical-wide-input">
              <span>Fraction IDs</span>
              <input aria-label="Fraction IDs" value={fractionInput} onChange={(event) => updateFractionInput(event.target.value)} />
            </label>
          </div>
        </Panel>

        <Panel title="File Mapping">
          <div className="technical-table-wrap">
            <table className="technical-table">
              <thead>
                <tr><th>Source</th><th>Assay</th><th>Label</th><th>Fraction</th><th>Technical replicate</th><th>Data file</th></tr>
              </thead>
              <tbody>
                {drafts.map((draft, index) => (
                  <tr key={`${draft.sourceName}-${draft.dataFile}-${index}`}>
                    <td><input aria-label={`Source ${index + 1}`} value={draft.sourceName} onChange={(event) => updateDraft(index, { sourceName: event.target.value })} /></td>
                    <td><input aria-label={`Assay ${index + 1}`} value={draft.assayName} onChange={(event) => updateDraft(index, { assayName: event.target.value })} /></td>
                    <td><input aria-label={`Label ${index + 1}`} value={draft.label} onChange={(event) => updateDraft(index, { label: event.target.value })} /></td>
                    <td><input aria-label={`Fraction ${index + 1}`} value={draft.fractionId} onChange={(event) => updateDraft(index, { fractionId: event.target.value })} /></td>
                    <td><input aria-label={`Technical replicate ${index + 1}`} value={draft.technicalReplicate} onChange={(event) => updateDraft(index, { technicalReplicate: event.target.value })} /></td>
                    <td><input aria-label={`Data file ${index + 1}`} value={draft.dataFile} onChange={(event) => updateDraft(index, { dataFile: event.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="recommendation-actions compact">
            <button className="btn primary" type="button" onClick={() => saveTechnicalConfig.mutate()} disabled={saveTechnicalConfig.isPending}>Save technical configuration</button>
            {status && <span className="success-text">{status}</span>}
          </div>
        </Panel>

        <Panel title="SDRF technical preview">
          <SdrfGrid table={technicalPreviewTable} showFallback={false} onlyPopulatedColumns />
        </Panel>
      </section>
      <AssistantPanel showQuestions={false} showEvidence={false} useFallbacks={false}>
        <FilesTechnicalAssistant
          draft={filesAiDraft}
          error={filesAiError}
          isPending={runFilesAi.isPending}
          onApply={handleApplyFilesAiDraft}
          onRunAi={() => runFilesAi.mutate()}
          status={filesAiStatus}
        />
      </AssistantPanel>
    </div>
  );
}

function FilesTechnicalAssistant({
  draft,
  error,
  isPending,
  onApply,
  onRunAi,
  status,
}: {
  draft: FilesTechnicalAiDraft | null;
  error: string;
  isPending: boolean;
  onApply: () => void;
  onRunAi: () => void;
  status: string;
}) {
  const previewMappings = draft?.mappings.slice(0, 6) ?? [];
  const hasDraft = Boolean(draft);
  const statusLabel = isPending && !hasDraft ? "Analyzing" : draft ? `${draft.mappings.length} rows` : "Pending";
  const labelSummary = draft?.labelType || draft?.labels.slice(0, 3).join(", ") || "Pending";
  const filesAiFacts = [
    { label: "Rows", value: draft ? String(draft.mappings.length) : "0" },
    { label: "Label", value: labelSummary },
    { label: "Acquisition", value: draft?.acquisitionMethod || "Pending" },
    { label: "Instrument", value: draft?.instrument || "Pending" },
    { label: "Enzyme", value: draft?.cleavageAgent || "Pending" },
  ];
  return (
    <div className="assistant-recommendation files-ai-assistant">
      <div className="assistant-recommendation-scroll">
        <div className="assistant-recommendation-head">
          <strong>Data file attributes</strong>
          <span>{statusLabel}</span>
        </div>
        {isPending && !draft ? (
          <div className="assistant-loading-card">
            <span className="assistant-spinner" />
            <div>
              <strong>AI is reading import context</strong>
              <p>Generating data-file attributes, labels, fractions and assay mappings.</p>
            </div>
          </div>
        ) : (
          <div className={`assistant-summary-card ${draft ? "ok" : ""}`}>
            {draft ? <Check size={16} /> : <Sparkles size={16} />}
            <div>
              <strong>{draft ? `${draft.mappings.length} file mapping${draft.mappings.length === 1 ? "" : "s"} parsed` : "No AI file attributes have been generated"}</strong>
              <p>{draft?.summary || status || "Run AI to infer data-file attributes from imported files, current SDRF rows and the technical configuration."}</p>
            </div>
          </div>
        )}
        <div className="assistant-compact-meta">
          {filesAiFacts.map((item) => (
            <span key={`${item.label}-${item.value}`}>{item.label}: {item.value}</span>
          ))}
        </div>
        <div className="recommendation-stack">
          <span>Recommended mappings</span>
          {previewMappings.length > 0 ? (
            previewMappings.map((mapping, index) => (
              <em key={`${mapping.sourceName}-${mapping.dataFile}-${index}`}>
                <span className="recommendation-template-name">
                  <FileText size={14} />
                  <b>{mapping.dataFile || mapping.assayName || mapping.sourceName || `Mapping ${index + 1}`}</b>
                </span>
                <small>{[mapping.sourceName, mapping.label, mapping.fractionId, mapping.technicalReplicate].filter(Boolean).join(" · ") || "file attributes"}</small>
              </em>
            ))
          ) : (
            <div className="assistant-stack-placeholder">
              {isPending ? "Generating file attribute JSON..." : "No AI file mappings yet."}
            </div>
          )}
        </div>
        {draft && (
          <>
            {draft.warnings.length > 0 && (
              <div className="files-ai-warning-list">
                {draft.warnings.map((warning) => <span key={warning}>{warning}</span>)}
              </div>
            )}
            <details className="sample-json-preview">
              <summary>Standard JSON</summary>
              <pre>{JSON.stringify({
                summary: draft.summary,
                label_type: draft.labelType,
                labels: draft.labels,
                fraction_ids: draft.fractionIds,
                acquisition_method: draft.acquisitionMethod,
                instrument: draft.instrument,
                cleavage_agent: draft.cleavageAgent,
                file_mappings: draft.mappings,
                warnings: draft.warnings,
              }, null, 2)}</pre>
            </details>
          </>
        )}
        {error && <span className="form-error compact-error">{error}</span>}
      </div>
      <div className="recommendation-actions compact ai-sample-actions">
        <button className="btn primary" type="button" onClick={onApply} disabled={!draft || isPending}>
          Apply AI draft
        </button>
        <button className="btn ghost" type="button" onClick={onRunAi} disabled={isPending}>
          <Play size={16} /> {isPending ? "Running" : draft ? "Rerun AI" : "Run AI"}
        </button>
      </div>
    </div>
  );
}

function tableHasReviewColumn(table: Awaited<ReturnType<typeof api.getSdrfTable>> | undefined, column: string): boolean {
  const target = column.toLowerCase();
  return Boolean(table?.headers.some((header) => header.toLowerCase() === target) || table?.rows.some((row) => Object.keys(row).some((key) => key.toLowerCase() === target)));
}

function reviewTableValue(row: Record<string, string>, column: string): string {
  const exact = cleanOneLineString(row[column]);
  if (exact) return exact;
  const target = column.toLowerCase();
  for (const [key, value] of Object.entries(row)) {
    if (key.toLowerCase() !== target) continue;
    const candidate = cleanOneLineString(value);
    if (candidate) return candidate;
  }
  return "";
}

function missingAiReviewFields(table: Awaited<ReturnType<typeof api.getSdrfTable>> | undefined): string[] {
  return AI_REVIEW_REQUIRED_FIELDS.filter((field) => {
    if (!tableHasReviewColumn(table, field)) return true;
    if (!table?.rows?.length) return true;
    return table.rows.some((row) => !reviewTableValue(row, field));
  });
}

function uniqueTableValues(table: Awaited<ReturnType<typeof api.getSdrfTable>> | undefined, column: string): string[] {
  return uniqueStrings((table?.rows ?? []).map((row) => reviewTableValue(row, column)).filter(Boolean));
}

function firstTableValue(table: Awaited<ReturnType<typeof api.getSdrfTable>> | undefined, columns: string[], fallback = "not available"): string {
  for (const column of columns) {
    const value = uniqueTableValues(table, column)[0];
    if (value) return value;
  }
  return fallback;
}

function formatReviewLabelType(table: Awaited<ReturnType<typeof api.getSdrfTable>> | undefined): string {
  const labels = uniqueTableValues(table, "comment[label]");
  if (!labels.length) return "not available";
  if (labels.length === 1 && labels[0].toLowerCase() === "label free sample") return "Label-free (LFQ)";
  const matchingOption = TECHNICAL_LABEL_OPTIONS.find((option) => labels.every((label) => option.labels.map((item) => item.toLowerCase()).includes(label.toLowerCase())));
  return matchingOption?.title ?? labels.join(", ");
}

function formatReviewFractions(table: Awaited<ReturnType<typeof api.getSdrfTable>> | undefined): string {
  const fractions = uniqueTableValues(table, "comment[fraction identifier]");
  if (!fractions.length || (fractions.length === 1 && fractions[0] === "1")) return "None";
  return fractions.join(", ");
}

function inferReviewTemplate(table: Awaited<ReturnType<typeof api.getSdrfTable>> | undefined): string {
  const organism = firstTableValue(table, ["characteristics[organism]"], "");
  if (organism.toLowerCase().includes("homo sapiens")) return "Human Samples";
  return organism ? `${organism} Samples` : "SDRF Samples";
}

function buildAiReviewDashboard(table: Awaited<ReturnType<typeof api.getSdrfTable>> | undefined) {
  const sampleCount = uniqueTableValues(table, "source name").length || table?.rows?.length || 0;
  const technicalReplicates = uniqueTableValues(table, "comment[technical replicate]");
  return {
    template: inferReviewTemplate(table),
    sampleCount,
    columnCount: table?.headers?.length ?? 0,
    rowCount: table?.rows?.length ?? 0,
    organism: firstTableValue(table, ["characteristics[organism]"]),
    disease: firstTableValue(table, ["characteristics[disease]"]),
    organismPart: firstTableValue(table, ["characteristics[organism part]"]),
    labelType: formatReviewLabelType(table),
    fractions: formatReviewFractions(table),
    technicalReplicates: technicalReplicates.length ? technicalReplicates.join(", ") : "not available",
    instrument: firstTableValue(table, ["comment[instrument]"]),
    enzyme: firstTableValue(table, ["comment[cleavage agent details]"]),
  };
}

function buildAiReviewInput({ analysis, table, files }: { analysis?: Awaited<ReturnType<typeof api.getAnalysis>>; table?: Awaited<ReturnType<typeof api.getSdrfTable>>; files: Awaited<ReturnType<typeof api.listFiles>> }): Record<string, unknown> {
  const uploadedFiles = nonSdrfUploadedFiles(files);
  const evidence = (analysis?.evidences ?? []).filter((item) => {
    const haystack = `${item.source_type} ${item.source_ref} ${item.field}`.toLowerCase();
    return !haystack.includes("sdrf.tsv") && !haystack.includes(".sdrf") && item.source_type !== "sdrf";
  });
  return {
    task: "Review SDRF Studio project completeness before validation and export. Return concise JSON advice only.",
    standard_reference: "SDRF-Proteomics v1.1.0 / quantMS SDRF specification",
    missing_required_fields: missingAiReviewFields(table),
    current_sdrf_table: { headers: table?.headers ?? [], row_count: table?.rows?.length ?? 0, preview_rows: table?.rows?.slice(0, 20) ?? [] },
    uploaded_files: uploadedFiles.slice(0, 40).map((file) => ({ filename: file.filename, file_type: file.file_type, parse_status: file.parse_status, size_bytes: file.size_bytes })),
    evidence_summary: evidence.slice(0, 30).map((item) => ({ source_type: item.source_type, source_ref: item.source_ref, field: item.field, value: item.value, confidence: item.confidence, status: item.status })),
    open_questions: (analysis?.questions ?? []).filter((item) => item.status === "open").slice(0, 20).map((item) => ({ step: item.step, title: item.title, message: item.message, severity: item.severity })),
    blueprint_summary: {
      node_count: analysis?.blueprint?.nodes?.length ?? 0,
      edge_count: analysis?.blueprint?.edges?.length ?? 0,
      nodes: analysis?.blueprint?.nodes?.slice(0, 30).map((node) => ({ layer: node.layer, label: node.label, status: node.status })) ?? [],
    },
    output_schema: { summary: "one paragraph project completeness summary", recommendations: [{ title: "short action title", detail: "specific SDRF action" }], warnings: ["missing, conflicting, or risky SDRF fields"] },
  };
}

function buildAiReviewRequestPayload(input: Record<string, unknown>, config: Pick<ClientAiConfig, "model">): Record<string, unknown> {
  return {
    model: config.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are reviewing an SDRF-Proteomics v1.1.0 draft before validation.\nUse only the provided project summary, evidence, file mapping, and SDRF table.\nReturn strict JSON with summary, recommendations, and warnings.\nDo not invent missing ontology accessions or raw file names." },
      { role: "user", content: JSON.stringify(input) },
    ],
  };
}

function parseAiReviewResult(value: unknown): AiReviewResult {
  const record = asRecommendationRecord(value) ?? {};
  const recommendations = rawRecordList(record.recommendations ?? record.actions)
    .map((item) => ({ title: cleanOneLineString(item.title ?? item.label ?? "Recommendation"), detail: cleanOneLineString(item.detail ?? item.message ?? item.reason ?? item.value) }))
    .filter((item) => item.title || item.detail);
  return { summary: cleanOneLineString(record.summary) || "AI review returned no summary.", recommendations, warnings: sanitizeStringList(record.warnings ?? record.warning) };
}

async function requestAiReview(input: Record<string, unknown>, config: ClientAiConfig, requestPayload = buildAiReviewRequestPayload(input, config)): Promise<AiReviewResult> {
  const payload = await api.chatCompletion(requestPayload);
  const content = aiChatContent(payload);
  return parseAiReviewResult(parseAiJsonObject(content));
}

function AiReviewStep({ projectId, analysis, table, files }: { projectId: string; analysis?: Awaited<ReturnType<typeof api.getAnalysis>>; table?: Awaited<ReturnType<typeof api.getSdrfTable>>; files: Awaited<ReturnType<typeof api.listFiles>> }) {
  const [reviewResult, setReviewResult] = useState<AiReviewResult | null>(null);
  const [status, setStatus] = useState("");
  const reviewInput = useMemo(() => buildAiReviewInput({ analysis, table, files }), [analysis, files, table]);
  const missingFields = reviewInput.missing_required_fields as string[];
  const dashboard = useMemo(() => buildAiReviewDashboard(table), [table]);
  const runAiReview = useMutation({
    mutationFn: async () => {
      const config = readClientAiConfig();
      const requestPayload = buildAiReviewRequestPayload(reviewInput, config);
      const savedPrompt = await api.saveSampleAiPrompt(projectId, requestPayload);
      setStatus(`AI review prompt saved to ${savedPrompt.path}. Waiting for recommendations...`);
      return requestAiReview(reviewInput, config, requestPayload);
    },
    onSuccess: (result) => {
      setReviewResult(result);
      setStatus("AI review completed.");
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "AI review failed."),
  });

  return (
    <div className="content-grid">
      <section className="wide-stack">
        <div className="review-hero">
          <h2>Review Your SDRF</h2>
          <p>Preview the generated SDRF table before creating it.</p>
        </div>
        <div className="review-stat-grid">
          <article className="review-stat-card">
            <div className="review-stat-icon"><UsersRound size={20} /></div>
            <div>
              <span>Template</span>
              <strong>{dashboard.template}</strong>
            </div>
          </article>
          <article className="review-stat-card">
            <div className="review-stat-icon"><FileText size={20} /></div>
            <div>
              <span>Samples</span>
              <strong>{dashboard.sampleCount}</strong>
            </div>
          </article>
          <article className="review-stat-card">
            <div className="review-stat-icon"><Layers size={20} /></div>
            <div>
              <span>Columns</span>
              <strong>{dashboard.columnCount}</strong>
            </div>
          </article>
          <article className="review-stat-card">
            <div className="review-stat-icon"><ScanLine size={20} /></div>
            <div>
              <span>Rows</span>
              <strong>{dashboard.rowCount}</strong>
            </div>
          </article>
        </div>
        <Panel title="Configuration Summary">
          <div className="review-config-grid">
            <div><span>Organism:</span><strong>{dashboard.organism}</strong></div>
            <div><span>Disease:</span><strong>{dashboard.disease}</strong></div>
            <div><span>Organism Part:</span><strong>{dashboard.organismPart}</strong></div>
            <div><span>Label Type:</span><strong>{dashboard.labelType}</strong></div>
            <div><span>Fractions:</span><strong>{dashboard.fractions}</strong></div>
            <div><span>Tech. Replicates:</span><strong>{dashboard.technicalReplicates}</strong></div>
            <div><span>Instrument:</span><strong>{dashboard.instrument}</strong></div>
            <div><span>Enzyme:</span><strong>{dashboard.enzyme}</strong></div>
          </div>
        </Panel>
        <Panel title="Table Preview">
          <SdrfGrid table={table} showFallback={false} />
        </Panel>
        <Panel title="AI SDRF Review">
          <div className="ai-review-summary-grid compact">
            <div>
              <strong>Missing required SDRF fields</strong>
              {missingFields.length ? <ul>{missingFields.map((field) => <li key={field}>{field}</li>)}</ul> : <p className="muted">No required MS-proteomics fields are missing from populated rows.</p>}
            </div>
            <div>
              <strong>Review scope</strong>
              <p className="muted">AI will review the current SDRF table, uploaded files, evidence summaries, open questions, and blueprint counts.</p>
            </div>
          </div>
          <div className="recommendation-actions compact">
            <button className="btn primary" type="button" onClick={() => runAiReview.mutate()} disabled={runAiReview.isPending}>Ask AI for SDRF review</button>
            {status && <span className={runAiReview.isError ? "form-error compact-error" : "success-text"}>{status}</span>}
          </div>
        </Panel>
        {reviewResult && (
          <Panel title="AI Recommendations">
            <div className="ai-review-result">
              <p>{reviewResult.summary}</p>
              {reviewResult.recommendations.map((item, index) => (
                <article key={`${item.title}-${index}`} className="ai-review-card">
                  <strong>{item.title}</strong>
                  {item.detail && <span>{item.detail}</span>}
                </article>
              ))}
              {reviewResult.warnings.length > 0 && <div className="ai-review-warning-list">{reviewResult.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
            </div>
          </Panel>
        )}
      </section>
      <AssistantPanel questions={analysis?.questions?.filter((item) => item.step === "ai-review")} evidences={analysis?.evidences} />
    </div>
  );
}

function WorkspaceStep({ step, analysis, table, files }: { step: StepKey; analysis?: Awaited<ReturnType<typeof api.getAnalysis>>; table?: Awaited<ReturnType<typeof api.getSdrfTable>>; files: Awaited<ReturnType<typeof api.listFiles>> }) {
  const titles: Partial<Record<StepKey, string>> = {
    files: "Raw, result and sidecar file mapping",
    "ai-review": "AI suggestions and unresolved decisions",
  };
  const title = titles[step] ?? "Workspace";
  return (
    <div className="content-grid">
      <section className="wide-stack">
        <Panel title={title}>
          <div className="metrics-row">
            <Metric label="Evidence items" value={analysis?.evidences.length ?? 0} />
            <Metric label="Open questions" value={analysis?.questions.filter((item) => item.status === "open").length ?? 0} tone="orange" />
            <Metric label="Uploaded files" value={files.length} tone="green" />
          </div>
          <SdrfGrid table={table} />
        </Panel>
      </section>
      <AssistantPanel questions={analysis?.questions?.filter((item) => item.step === step)} evidences={analysis?.evidences} />
    </div>
  );
}

function ValidationStep({ projectId, table, refresh }: { projectId: string; table?: Awaited<ReturnType<typeof api.getSdrfTable>>; refresh: () => void }) {
  const validate = useMutation({ mutationFn: () => api.validate(projectId), onSuccess: refresh });
  const result = validate.data;
  const validator = String(result?.summary.validator ?? "not run");
  return (
    <section className="wide-stack">
      <Panel title="SDRF Pipeline Validation">
        <div className="validation-overview">
          <div>
            <strong>Validate SDRF format</strong>
            <p className="muted">Runs the local sdrf-pipelines CLI when the `sdrf` command is available. If the CLI is unavailable, the backend reports the structural fallback validator here.</p>
          </div>
          <button className="btn primary" type="button" onClick={() => validate.mutate()} disabled={validate.isPending}>
            <ShieldCheck size={16} /> Validate SDRF
          </button>
        </div>
      </Panel>
      <Panel title="Validation Result">
        <div className="metrics-row">
          <Metric label="Rows" value={table?.rows.length ?? 0} />
          <Metric label="Columns" value={table?.headers.length ?? 0} tone="green" />
          <Metric label="Errors" value={Number(result?.summary.errors ?? 0)} tone="red" />
          <Metric label="Warnings" value={Number(result?.summary.warnings ?? 0)} tone="orange" />
        </div>
        <div className={`validator-source ${validator === "sdrf-pipelines" ? "pipeline" : ""}`}>
          <span>Validator</span>
          <strong>{validator}</strong>
        </div>
        <IssueList issues={result?.issues ?? []} />
      </Panel>
    </section>
  );
}

function ExportStep({ projectId, table }: { projectId: string; table?: Awaited<ReturnType<typeof api.getSdrfTable>> }) {
  const exportProject = useMutation({ mutationFn: () => api.exportProject(projectId) });
  return (
    <section className="wide-stack">
      <Panel title="Export SDRF package">
        <div className="export-overview">
          <div>
            <strong>Ready to export</strong>
            <p className="muted">Generate SDRF TSV, Excel when available, validation JSON, and evidence JSON from the complete table below.</p>
          </div>
          <button className="btn primary" type="button" onClick={() => exportProject.mutate()} disabled={exportProject.isPending}><Download size={16} /> Generate exports</button>
        </div>
      </Panel>
      <Panel title="Complete SDRF Table">
        <SdrfGrid table={table} showFallback={false} />
      </Panel>
      <Panel title="Generated files">
        <div className="export-list">
          {(exportProject.data ?? []).map((record) => (
            <a key={record.id} href={`${api.baseUrl}${record.payload.download}`} target="_blank" rel="noreferrer">
              <FileText size={18} />
              <span>{record.export_type}</span>
              <ExternalLink size={15} />
            </a>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function Choice({ icon, title, text, active, onClick }: { icon: ReactNode; title: string; text: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`choice ${active ? "active" : ""}`} onClick={onClick}>
      <div>{icon}</div>
      <strong>{title}</strong>
      <p>{text}</p>
    </button>
  );
}

function TemplateOption({ title, text }: { title: string; text: string }) {
  return (
    <div className="template-option">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

const SDRF_TEMPLATES: SdrfTemplate[] = [
  {
    id: "ms-proteomics",
    title: "ms-proteomics",
    version: "v1.1.0",
    layer: "technology",
    exclusiveGroup: "technology",
    icon: Microscope,
    category: "Technology",
    description: "Minimum valid SDRF template for mass spectrometry-based proteomics.",
    examples: ["DDA", "DIA", "LFQ", "TMT"],
    requiredColumns: [
      "source name",
      "characteristics[organism]",
      "characteristics[organism part]",
      "characteristics[disease]",
      "characteristics[biological replicate]",
      "assay name",
      "technology type",
      "comment[proteomics data acquisition method]",
      "comment[label]",
      "comment[instrument]",
      "comment[cleavage agent details]",
      "comment[fraction identifier]",
      "comment[technical replicate]",
      "comment[data file]",
      "factor value[disease]",
    ],
    columns: [
      "source name",
      "characteristics[organism]",
      "characteristics[organism part]",
      "characteristics[disease]",
      "characteristics[biological replicate]",
      "assay name",
      "technology type",
      "comment[proteomics data acquisition method]",
      "comment[label]",
      "comment[instrument]",
      "comment[cleavage agent details]",
      "comment[fraction identifier]",
      "comment[technical replicate]",
      "comment[data file]",
      "factor value[disease]",
    ],
  },
  {
    id: "affinity-proteomics",
    title: "affinity-proteomics",
    version: "v1.0.0",
    layer: "technology",
    exclusiveGroup: "technology",
    icon: ShieldCheck,
    category: "Technology",
    description: "Technology template for affinity proteomics, including Olink and SomaScan studies.",
    examples: ["Olink", "SomaScan", "PEA"],
    requiredColumns: ["source name", "characteristics[organism]", "assay name", "technology type", "comment[technology platform]", "comment[data file]"],
    columns: [
      "source name",
      "characteristics[organism]",
      "assay name",
      "technology type",
      "comment[technology platform]",
      "comment[assay kit]",
      "comment[antibody]",
      "comment[data file]",
    ],
  },
  {
    id: "ms-metabolomics",
    title: "ms-metabolomics",
    version: "v1.0.0",
    layer: "technology",
    exclusiveGroup: "technology",
    icon: FlaskConical,
    category: "Technology",
    description: "Technology template for mass-spectrometry metabolomics studies.",
    examples: ["LC-MS", "GC-MS", "lipidomics"],
    requiredColumns: ["source name", "characteristics[organism]", "assay name", "technology type", "comment[data file]"],
    columns: [
      "source name",
      "characteristics[organism]",
      "assay name",
      "technology type",
      "comment[chromatography type]",
      "comment[instrument]",
      "comment[data file]",
    ],
  },
  {
    id: "human",
    title: "human",
    version: "v1.1.0",
    layer: "sample",
    exclusiveGroup: "sample-context",
    icon: UserRound,
    category: "Sample",
    description: "Human sample descriptors commonly required for tissue, disease, age, sex and phenotype review.",
    examples: ["plasma", "tissue", "patient cohort"],
    requiredColumns: ["characteristics[organism]", "characteristics[organism part]", "characteristics[disease]"],
    columns: [
      "characteristics[organism]",
      "characteristics[organism part]",
      "characteristics[disease]",
      "characteristics[age]",
      "characteristics[sex]",
      "factor value[disease]",
    ],
  },
  {
    id: "vertebrates",
    title: "vertebrates",
    version: "v1.1.0",
    layer: "sample",
    exclusiveGroup: "sample-context",
    icon: Dna,
    category: "Sample",
    description: "Non-human vertebrate samples such as mouse, rat, zebrafish, birds and amphibians.",
    examples: ["mouse", "rat", "zebrafish"],
    requiredColumns: ["characteristics[organism]", "characteristics[organism part]", "characteristics[disease]", "characteristics[developmental stage]"],
    columns: [
      "characteristics[organism]",
      "characteristics[organism part]",
      "characteristics[disease]",
      "characteristics[developmental stage]",
      "characteristics[strain]",
      "factor value[disease]",
    ],
  },
  {
    id: "invertebrates",
    title: "invertebrates",
    version: "v1.1.0",
    layer: "sample",
    exclusiveGroup: "sample-context",
    icon: Network,
    category: "Sample",
    description: "Invertebrate samples such as Drosophila, C. elegans and insects.",
    examples: ["Drosophila", "C. elegans", "insect"],
    requiredColumns: ["characteristics[organism]", "characteristics[disease]", "characteristics[developmental stage]"],
    columns: [
      "characteristics[organism]",
      "characteristics[organism part]",
      "characteristics[disease]",
      "characteristics[developmental stage]",
      "characteristics[genotype]",
      "factor value[disease]",
    ],
  },
  {
    id: "plants",
    title: "plants",
    version: "v1.1.0",
    layer: "sample",
    exclusiveGroup: "sample-context",
    icon: Leaf,
    category: "Sample",
    description: "Plant study descriptors for tissue, developmental stage, strain and growth condition.",
    examples: ["Arabidopsis", "leaf", "root"],
    requiredColumns: ["characteristics[organism]", "characteristics[organism part]", "characteristics[disease]"],
    columns: [
      "characteristics[organism]",
      "characteristics[organism part]",
      "characteristics[disease]",
      "characteristics[developmental stage]",
      "characteristics[strain]",
      "characteristics[growth condition]",
      "factor value[disease]",
    ],
  },
  {
    id: "clinical-metadata",
    title: "clinical-metadata",
    version: "v1.0.0",
    layer: "sample",
    icon: Stethoscope,
    category: "Sample",
    description: "Clinical study metadata for treatment, demographics and lifestyle fields.",
    examples: ["age", "sex", "treatment"],
    requiredColumns: ["characteristics[disease]"],
    columns: [
      "characteristics[disease]",
      "characteristics[age]",
      "characteristics[sex]",
      "characteristics[treatment]",
      "characteristics[body mass index]",
    ],
  },
  {
    id: "oncology-metadata",
    title: "oncology-metadata",
    version: "v1.0.0",
    layer: "sample",
    icon: Ribbon,
    category: "Sample",
    description: "Cancer and oncology study metadata for tumor staging, grading and outcomes.",
    examples: ["tumor stage", "grade", "outcome"],
    requiredColumns: ["characteristics[disease]"],
    columns: [
      "characteristics[disease]",
      "characteristics[tumor stage]",
      "characteristics[tumor grade]",
      "characteristics[clinical outcome]",
      "factor value[disease]",
    ],
  },
  {
    id: "dia-acquisition",
    title: "dia-acquisition",
    version: "v1.1.0",
    layer: "experiment",
    icon: ScanLine,
    category: "Experiment",
    description: "DIA acquisition metadata, scan windows and isolation-window fields.",
    examples: ["DIA", "SWATH", "dia-PASEF"],
    requiredColumns: ["comment[proteomics data acquisition method]"],
    columns: [
      "comment[proteomics data acquisition method]",
      "comment[isolation window]",
      "comment[scan window lower limit]",
      "comment[scan window upper limit]",
      "comment[collision energy]",
    ],
  },
  {
    id: "single-cell",
    title: "single-cell",
    version: "v1.0.0",
    layer: "experiment",
    icon: CircleDot,
    category: "Experiment",
    description: "Single-cell proteomics fields for cell type, carrier proteome and batch metadata.",
    examples: ["single cell", "carrier", "cell type"],
    requiredColumns: ["characteristics[cell type]"],
    columns: [
      "characteristics[cell type]",
      "characteristics[sample type]",
      "comment[carrier proteome]",
      "comment[single cell isolation]",
      "factor value[cell type]",
    ],
  },
  {
    id: "crosslinking",
    title: "crosslinking",
    version: "v1.0.0",
    layer: "experiment",
    icon: Link2,
    category: "Experiment",
    description: "Crosslinking MS metadata for crosslinkers, enrichment and search parameters.",
    examples: ["DSSO", "BS3", "crosslinker"],
    requiredColumns: ["comment[cross-linking reagent]"],
    columns: [
      "comment[cross-linking reagent]",
      "characteristics[enrichment process]",
      "comment[modification parameters]",
    ],
  },
  {
    id: "immunopeptidomics",
    title: "immunopeptidomics",
    version: "v1.0.0",
    layer: "experiment",
    icon: Activity,
    category: "Experiment",
    description: "Immunopeptidomics metadata for HLA alleles, enrichment and peptide isolation.",
    examples: ["HLA", "MHC", "peptide IP"],
    requiredColumns: ["characteristics[hla allele]"],
    columns: [
      "characteristics[hla allele]",
      "characteristics[enrichment process]",
      "comment[cleavage agent details]",
    ],
  },
  {
    id: "metaproteomics",
    title: "metaproteomics",
    version: "v1.0.0",
    layer: "sample",
    exclusiveGroup: "sample-context",
    icon: UsersRound,
    category: "Sample",
    description: "Metaproteomics metadata for environmental or microbiome protein studies.",
    examples: ["microbiome", "environmental", "community"],
    requiredColumns: ["characteristics[environmental material]"],
    columns: [
      "characteristics[environmental material]",
      "characteristics[geographic location]",
      "characteristics[sampling site]",
    ],
  },
  {
    id: "cell-lines",
    title: "cell-lines",
    version: "v1.1.0",
    layer: "experiment",
    icon: GitBranch,
    category: "Experiment",
    description: "Cell-line and culture descriptors for in vitro sample metadata.",
    examples: ["HeLa", "HEK293", "culture"],
    requiredColumns: ["characteristics[cell line]"],
    columns: [
      "characteristics[cell line]",
      "characteristics[cell type]",
      "characteristics[culture condition]",
    ],
  },
  {
    id: "human-gut",
    title: "human-gut",
    version: "v1.0.0",
    layer: "sample",
    exclusiveGroup: "sample-context",
    icon: HeartPulse,
    category: "Sample",
    description: "Human gut microbiome metaproteomics metadata.",
    examples: ["stool", "fecal", "gut microbiome"],
    requiredColumns: ["characteristics[organism]", "characteristics[environmental material]"],
    columns: [
      "characteristics[organism]",
      "characteristics[environmental material]",
      "characteristics[sampling site]",
    ],
  },
  {
    id: "soil",
    title: "soil",
    version: "v1.0.0",
    layer: "sample",
    exclusiveGroup: "sample-context",
    icon: Sprout,
    category: "Sample",
    description: "Soil metaproteomics metadata for environmental material, location and sampling depth.",
    examples: ["soil", "rhizosphere", "sediment"],
    requiredColumns: ["characteristics[environmental material]"],
    columns: [
      "characteristics[environmental material]",
      "characteristics[geographic location]",
      "characteristics[sampling depth]",
      "characteristics[soil type]",
    ],
  },
  {
    id: "water",
    title: "water",
    version: "v1.0.0",
    layer: "sample",
    exclusiveGroup: "sample-context",
    icon: Waves,
    category: "Sample",
    description: "Water metaproteomics metadata for aquatic location, depth and environmental material.",
    examples: ["marine", "lake", "river"],
    requiredColumns: ["characteristics[environmental material]"],
    columns: [
      "characteristics[environmental material]",
      "characteristics[geographic location]",
      "characteristics[sampling depth]",
      "characteristics[water body]",
    ],
  },
  {
    id: "lc-ms-metabolomics",
    title: "lc-ms-metabolomics",
    version: "v1.0.0-dev",
    layer: "experiment",
    exclusiveGroup: "metabolomics-method",
    icon: Beaker,
    category: "Experiment",
    description: "Liquid chromatography MS metabolomics method metadata.",
    examples: ["LC-MS", "UHPLC", "HPLC"],
    requiredColumns: ["comment[chromatography type]"],
    columns: ["comment[chromatography type]", "comment[column type]", "comment[mobile phase]"],
  },
  {
    id: "gc-ms-metabolomics",
    title: "gc-ms-metabolomics",
    version: "v1.0.0-dev",
    layer: "experiment",
    exclusiveGroup: "metabolomics-method",
    icon: TestTube,
    category: "Experiment",
    description: "Gas chromatography MS metabolomics method metadata.",
    examples: ["GC-MS", "derivatization", "carrier gas"],
    requiredColumns: ["comment[chromatography type]"],
    columns: ["comment[chromatography type]", "comment[derivatization reagent]", "comment[carrier gas]"],
  },
];

const TEMPLATE_LAYER_GROUPS: { title: string; hint: string; templateIds: SdrfTemplateId[] }[] = [
  { title: "Technology", hint: "choose one", templateIds: ["ms-proteomics", "affinity-proteomics", "ms-metabolomics"] },
  { title: "Sample", hint: "context + overlays", templateIds: ["human", "vertebrates", "invertebrates", "plants", "metaproteomics", "human-gut", "soil", "water", "clinical-metadata", "oncology-metadata"] },
  { title: "Experiment", hint: "optional extensions", templateIds: ["dia-acquisition", "single-cell", "crosslinking", "immunopeptidomics", "cell-lines", "lc-ms-metabolomics", "gc-ms-metabolomics"] },
];

function filterTemplateGroups(search: string, layer: "all" | SdrfTemplateLayer) {
  const query = search.trim().toLowerCase();
  return TEMPLATE_LAYER_GROUPS
    .map((group) => ({
      ...group,
      templateIds: group.templateIds.filter((id) => {
        const template = getTemplateById(id);
        if (!template) return false;
        const layerMatches = layer === "all" || template.layer === layer;
        const textMatches = !query || [template.title, template.category, template.description, ...template.examples, ...getTemplateColumns([id])].join(" ").toLowerCase().includes(query);
        return layerMatches && textMatches;
      }),
    }))
    .filter((group) => group.templateIds.length > 0);
}

function sameTemplateSet(left: SdrfTemplateId[], right: SdrfTemplateId[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

function getTemplateById(id: SdrfTemplateId): SdrfTemplate | undefined {
  return SDRF_TEMPLATES.find((template) => template.id === id);
}

function getTemplateColumns(ids: SdrfTemplateId[]): string[] {
  return resolveTemplateStackColumnEntries(ids).map((entry) => entry.name);
}

function getRequiredTemplateColumns(ids: SdrfTemplateId[]): string[] {
  return resolveTemplateStackColumnEntries(ids)
    .filter((entry) => entry.requirement === "required")
    .map((entry) => entry.name);
}

const MS_PROTEOMICS_EXPERIMENT_TEMPLATES: SdrfTemplateId[] = ["dia-acquisition", "single-cell", "crosslinking", "immunopeptidomics", "cell-lines"];
const METABOLOMICS_METHOD_TEMPLATES: SdrfTemplateId[] = ["lc-ms-metabolomics", "gc-ms-metabolomics"];

function getTemplateCompatibilityIssues(ids: SdrfTemplateId[]): string[] {
  const issues: string[] = [];
  const technologyIds = ids.filter((id) => getTemplateById(id)?.layer === "technology");
  const sampleContexts = ids.filter((id) => getTemplateById(id)?.exclusiveGroup === "sample-context");
  if (!technologyIds.length) {
    issues.push("A technology template is required by the SDRF template architecture.");
  }
  if (technologyIds.length > 1) {
    issues.push("Only one technology template can be active in a template stack.");
  }
  if (sampleContexts.length > 1) {
    issues.push("Only one primary sample context should be active; add clinical or oncology overlays separately.");
  }
  const proteomicsExtensions = MS_PROTEOMICS_EXPERIMENT_TEMPLATES.filter((id) => ids.includes(id));
  if ((ids.includes("affinity-proteomics") || ids.includes("ms-metabolomics")) && proteomicsExtensions.length) {
    issues.push("DIA, single-cell, crosslinking, immunopeptidomics and cell-line experiment templates extend ms-proteomics, not affinity-proteomics or ms-metabolomics.");
  }
  const metabolomicsMethods = METABOLOMICS_METHOD_TEMPLATES.filter((id) => ids.includes(id));
  if (metabolomicsMethods.length && !ids.includes("ms-metabolomics")) {
    issues.push("LC-MS and GC-MS metabolomics templates require ms-metabolomics as the technology template.");
  }
  if (metabolomicsMethods.length && ids.includes("ms-proteomics")) {
    issues.push("LC-MS and GC-MS metabolomics templates should not be combined with ms-proteomics.");
  }
  if (metabolomicsMethods.length > 1) {
    issues.push("Choose either lc-ms-metabolomics or gc-ms-metabolomics, not both.");
  }
  return issues;
}

export function inferTemplateRecommendation(
  evidence: Awaited<ReturnType<typeof api.getAnalysis>>["evidences"] = [],
  files: Awaited<ReturnType<typeof api.listFiles>> = [],
  project?: Pick<Project, "name" | "pride_accession">,
  sessionState?: Pick<SessionUiState, "import" | "displayName">,
): TemplateRecommendation {
  const context = buildTemplateRecommendationContext(evidence, files, project, sessionState?.import, sessionState?.displayName);
  const text = context.text.toLowerCase();
  const signals: string[] = [];
  const notes: string[] = [];
  const ruleNotes: string[] = [];
  const selectedIds: SdrfTemplateId[] = [];
  const addSignal = (id: SdrfTemplateId, label: string) => {
    if (!selectedIds.includes(id)) selectedIds.push(id);
    if (!signals.includes(label)) signals.push(label);
  };
  const addRule = (rule: string) => {
    if (!ruleNotes.includes(rule)) ruleNotes.push(rule);
  };
  const hasAffinityEvidence = /affinity proteomics|olink|somascan|aptamer|proximity extension|antibody|assay kit/.test(text);
  const hasMetabolomicsEvidence = /metabolom|metabolite|lipidom/.test(text);
  const hasLcMetabolomicsEvidence = hasMetabolomicsEvidence && /lc[-\s]?ms|liquid chromatography|uplc|uhplc|hplc/.test(text);
  const hasGcMetabolomicsEvidence = /gc[-\s]?ms|gas chromatography/.test(text) && (hasMetabolomicsEvidence || !/proteom/.test(text));
  const technology: SdrfTemplateId = hasAffinityEvidence
    ? "affinity-proteomics"
    : hasMetabolomicsEvidence || hasGcMetabolomicsEvidence
      ? "ms-metabolomics"
      : "ms-proteomics";

  addSignal(technology, `${technology} technology`);
  addRule("Exactly one technology template is selected.");

  const hasHumanGutEvidence = /human gut|gut microbiome|gut metaproteom|fecal|faecal|stool/.test(text);
  const hasSoilEvidence = /\bsoil\b|rhizosphere|sediment/.test(text);
  const hasWaterEvidence = /\bwater\b|aquatic|ocean|marine|lake|river/.test(text);
  const hasMetaproteomicsEvidence = /metaproteom|microbiome|environmental material|environmental sample/.test(text);

  if (hasHumanGutEvidence) {
    addSignal("human-gut", "human gut metaproteomics sample context");
    addRule("A metaproteomics sample context replaces generic organism sample templates.");
  } else if (hasSoilEvidence && hasMetaproteomicsEvidence) {
    addSignal("soil", "soil metaproteomics sample context");
    addRule("A metaproteomics sample context replaces generic organism sample templates.");
  } else if (hasWaterEvidence && hasMetaproteomicsEvidence) {
    addSignal("water", "water metaproteomics sample context");
    addRule("A metaproteomics sample context replaces generic organism sample templates.");
  } else if (hasMetaproteomicsEvidence) {
    addSignal("metaproteomics", "metaproteomics sample context");
    addRule("A metaproteomics sample context replaces generic organism sample templates.");
  } else if (/\bhomo sapiens\b|ncbitaxon:9606|organism[^\n]{0,80}\bhuman\b|characteristics\[organism\][^\n]{0,80}\bhuman\b|human microbiome|patient samples?/.test(text)) {
    addSignal("human", "human organism");
  } else if (/\bmus musculus\b|\bmouse\b|\brat\b|\bdanio rerio\b|\bzebrafish\b/.test(text)) {
    addSignal("vertebrates", "vertebrate organism");
  } else if (/drosophila|elegans|insect|invertebrate/.test(text)) {
    addSignal("invertebrates", "invertebrate organism");
  } else if (/arabidopsis|oryza|zea mays|\bplant\b|leaf|root tissue/.test(text)) {
    addSignal("plants", "plant sample context");
  }
  if (/clinical|patient|treatment|body mass index|\bage\b|\bsex\b|disease cohort/.test(text)) addSignal("clinical-metadata", "clinical metadata terms");
  if (/oncolog|tumou?r|cancer|carcinoma|melanoma|leukemia|lymphoma/.test(text)) addSignal("oncology-metadata", "oncology metadata terms");

  if (/\btmt\b|itraq|silac|multiplex|plex/.test(text)) notes.push("labeling keywords");
  if (technology === "ms-proteomics") {
    if (/\bdia\b|data-independent acquisition|dia-pasef|dia pasef|swath/.test(text)) addSignal("dia-acquisition", "DIA method");
    if (/cell line|cell-line|hela|hek293|a549|jurkat/.test(text)) addSignal("cell-lines", "cell-line terms");
    if (/single-cell|single cell|scp|carrier proteome/.test(text)) addSignal("single-cell", "single-cell terms");
    if (/crosslink|cross-link|cross linking/.test(text)) addSignal("crosslinking", "crosslinking terms");
    if (/immunopeptid|hla|mhc/.test(text)) addSignal("immunopeptidomics", "immunopeptidomics terms");
  } else if (MS_PROTEOMICS_EXPERIMENT_TEMPLATES.some((id) => text.includes(id.replace("-", " ")))) {
    addRule("MS-proteomics experiment extensions were not added because the technology evidence points elsewhere.");
  }
  if (technology === "ms-metabolomics" && hasLcMetabolomicsEvidence) {
    addSignal("lc-ms-metabolomics", "LC-MS metabolomics terms");
  }
  if (technology === "ms-metabolomics" && hasGcMetabolomicsEvidence) {
    addSignal("gc-ms-metabolomics", "GC-MS metabolomics terms");
  }

  const normalizedSelectedIds = orderTemplateStack(normalizeTemplateStack(selectedIds));
  const confidence = Math.min(
    0.97,
    0.54 + signals.length * 0.07 + Math.min(context.structuredSourceCount, 4) * 0.04 + Math.min(evidence.length, 5) * 0.015 + Math.min(files.length, 4) * 0.01,
  );
  const detectedTerms = signals.length ? signals.map((item) => item.replace(" terms", "").replace(" keywords", "")).join(", ") : "general MS proteomics";
  const sourceLabels = Array.from(new Set([
    ...context.evidenceLabels,
    ...notes,
  ])).slice(0, 5);

  return {
    selectedIds: normalizedSelectedIds,
    confidence,
    detectedSummary: `Detected ${detectedTerms} from ${context.sourceSummary}.`,
    evidenceLabels: sourceLabels.length ? sourceLabels : ["default SDRF-Proteomics rule set"],
    ruleNotes,
    importHighlights: context.importHighlights,
    sourceSummary: context.sourceSummary,
    source: "rules",
  };
}

function createPendingTemplateRecommendation(
  project?: Pick<Project, "name" | "pride_accession">,
  sessionState?: Pick<SessionUiState, "import" | "displayName">,
): TemplateRecommendation {
  const accession = (
    sessionState?.import?.prideAccession ||
    sessionState?.import?.activeImportAccession ||
    sessionState?.import?.accession ||
    project?.pride_accession ||
    ""
  ).toUpperCase();
  return {
    selectedIds: [],
    confidence: 0,
    detectedSummary: accession ? `AI is analyzing ${accession}.` : "AI is analyzing the imported project context.",
    evidenceLabels: [],
    ruleNotes: [],
    importHighlights: accession ? [{ label: "PRIDE", value: accession }] : [],
    sourceSummary: accession ? `PRIDE ${accession}` : "imported context",
    source: "ai",
    promptVersion: TEMPLATE_AI_PROMPT_VERSION,
  };
}

type TemplateRecommendationContext = {
  text: string;
  evidenceLabels: string[];
  importHighlights: { label: string; value: string }[];
  sourceSummary: string;
  structuredSourceCount: number;
};

function buildTemplateRecommendationContext(
  evidence: Awaited<ReturnType<typeof api.getAnalysis>>["evidences"],
  files: Awaited<ReturnType<typeof api.listFiles>>,
  project?: Pick<Project, "name" | "pride_accession">,
  importState?: SessionImportState,
  displayName?: string,
): TemplateRecommendationContext {
  const textParts: string[] = [];
  const evidenceLabels: string[] = [];
  const importHighlights: { label: string; value: string }[] = [];
  const sourceSummaryParts: string[] = [];
  const addText = (value: unknown) => {
    const text = stringifyCompact(value).trim();
    if (text) textParts.push(text);
  };
  const addLabel = (label: string) => {
    if (label && !evidenceLabels.includes(label)) evidenceLabels.push(label);
  };
  const addHighlight = (label: string, value: unknown) => {
    const text = compactRecommendationValue(value);
    if (text && !importHighlights.some((item) => item.label === label)) {
      importHighlights.push({ label, value: text });
    }
  };

  if (project?.pride_accession) {
    addText(project.pride_accession);
    addHighlight("PRIDE", project.pride_accession);
    sourceSummaryParts.push(`PRIDE ${project.pride_accession}`);
  }
  if (project?.name && project.name !== "New SDRF Project") addText(project.name);
  appendSessionImportRecommendationContext(importState, displayName, addText, addHighlight, sourceSummaryParts);

  const uniqueEvidence = dedupeRecommendationEvidence(evidence);
  uniqueEvidence.forEach((item) => {
    addText(`${item.source_type} ${item.source_ref} ${item.field} ${item.value}`);
    addLabel(`${item.source_type}: ${item.field}`);
    const payload = item.payload ?? {};
    if (item.source_type.toLowerCase() === "pride") {
      appendPrideRecommendationContext(payload, addText, addHighlight);
    } else {
      if (item.source_type.toLowerCase() === "design-table") {
        const evidenceOrganisms = extractOrganismsFromParsedPayload(payload);
        if (evidenceOrganisms.length) addHighlight("Design organism", evidenceOrganisms.join(", "));
      }
      addText(payload);
    }
  });

  files.forEach((file) => {
    addText(`${file.filename} ${file.file_type}`);
    addText(summarizeUploadedFileForRecommendation(file));
    addLabel(`file: ${file.file_type}`);
  });
  const designCount = files.filter((file) => file.file_type === "design-table").length;
  const designOrganisms = extractDesignOrganisms(files);
  if (designOrganisms.length) addHighlight("Design organism", designOrganisms.join(", "));
  if (designCount) addHighlight("Design tables", designCount);
  if (files.length) {
    sourceSummaryParts.push(`${files.length} uploaded file${files.length === 1 ? "" : "s"}`);
    addHighlight("Uploads", `${files.length} file${files.length === 1 ? "" : "s"}`);
  }

  const structuredSourceCount = (project?.pride_accession ? 1 : 0) + uniqueEvidence.length + files.length;
  const sourceSummary = sourceSummaryParts.length
    ? sourceSummaryParts.join(" and ")
    : uniqueEvidence.length
      ? "imported evidence"
      : "default SDRF proteomics rules";

  return {
    text: textParts.join("\n"),
    evidenceLabels: evidenceLabels.slice(0, 8),
    importHighlights: sortRecommendationHighlights(importHighlights).slice(0, 6),
    sourceSummary,
    structuredSourceCount,
  };
}

function appendSessionImportRecommendationContext(
  importState: SessionImportState | undefined,
  displayName: string | undefined,
  addText: (value: unknown) => void,
  addHighlight: (label: string, value: unknown) => void,
  sourceSummaryParts: string[],
) {
  if (displayName) addText(displayName);
  if (!importState) return;
  const accession = (importState.prideAccession || importState.activeImportAccession || importState.accession || "").toUpperCase();
  if (accession) {
    addText(accession);
    addHighlight("PRIDE", accession);
    if (!sourceSummaryParts.some((item) => item.includes(accession))) sourceSummaryParts.push(`PRIDE ${accession}`);
  }
  addText([
    importState.prideTitle,
    importState.prideDescription,
    importState.prideOrganisms?.join("\n"),
    importState.prideInstruments?.join("\n"),
    importState.prideKeywords?.join("\n"),
  ].filter(Boolean).join("\n"));
  addHighlight("Organism", importState.prideOrganisms);
  addHighlight("Instrument", importState.prideInstruments);
  if (importState.rawFileCount) addHighlight("Raw files", importState.rawFileCount);
  const uploadedFiles = nonSdrfUploadedFileSummaries(importState.uploadedFiles);
  if (uploadedFiles.length) {
    addText(uploadedFiles.map((file) => `${file.filename} ${file.fileType} ${file.parseStatus}`).join("\n"));
    addHighlight("Uploads", `${uploadedFiles.length} file${uploadedFiles.length === 1 ? "" : "s"}`);
  }
  if (importState.rawDesignTable?.headers?.length) {
    addText([
      importState.rawDesignTable.headers.join("\n"),
      stringifyCompact(importState.rawDesignTable.rows.slice(0, 6)),
    ].join("\n"));
    addHighlight("Design table", `${importState.rawDesignTable.headers.length} columns`);
  }
  if (importState.mappedDesignTable?.headers?.length) {
    addText([
      importState.mappedDesignTable.headers.join("\n"),
      stringifyCompact(importState.mappedDesignTable.rows.slice(0, 6)),
    ].join("\n"));
  }
}

function dedupeRecommendationEvidence(evidence: Awaited<ReturnType<typeof api.getAnalysis>>["evidences"]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.source_type}|${item.source_ref}|${item.field}|${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function appendPrideRecommendationContext(
  payload: Record<string, unknown>,
  addText: (value: unknown) => void,
  addHighlight: (label: string, value: unknown) => void,
) {
  const projectPayload = asRecommendationRecord(payload.project) ?? asRecommendationRecord(payload.project_raw);
  if (payload.accession) addHighlight("PRIDE", payload.accession);
  if (projectPayload) {
    addText([
      pickString(projectPayload, ["title", "projectTitle"]),
      pickString(projectPayload, ["description", "projectDescription"]),
      pickString(projectPayload, ["sample_processing_protocol", "sampleProcessingProtocol"]),
      pickString(projectPayload, ["data_processing_protocol", "dataProcessingProtocol"]),
      compactRecommendationValue(projectPayload.organism ?? projectPayload.organisms ?? projectPayload.organismNames ?? projectPayload.species),
      compactRecommendationValue(projectPayload.instruments ?? projectPayload.instrumentNames),
      compactRecommendationValue(projectPayload.modifications ?? projectPayload.identifiedPTMStrings),
      compactRecommendationValue(projectPayload.keywords ?? projectPayload.projectTags),
      compactRecommendationValue(projectPayload.experimentTypes),
      compactRecommendationValue(projectPayload.quantificationMethods),
    ].filter(Boolean).join("\n"));
    addHighlight("Organism", projectPayload.organism ?? projectPayload.organisms ?? projectPayload.organismNames ?? projectPayload.species);
    addHighlight("Instrument", projectPayload.instruments ?? projectPayload.instrumentNames);
  }

  const filesPayload = asRecommendationRecord(payload.files);
  if (filesPayload) {
    addText([
      getRawFiles(filesPayload).slice(0, 40).join("\n"),
      getSupplementaryFiles(filesPayload).slice(0, 30).join("\n"),
      compactRecommendationValue(stripExistingSdrfPayload(filesPayload.file_records)),
    ].filter(Boolean).join("\n"));
    const rawFileCount = Number(filesPayload.rawfile_count ?? getRawFiles(filesPayload).length);
    if (rawFileCount) addHighlight("Raw files", rawFileCount);
  }
}

function summarizeUploadedFileForRecommendation(file: Awaited<ReturnType<typeof api.listFiles>>[number]): string {
  if (isSdrfLikeFileName(file.filename) || file.file_type === "sdrf") return "";
  const payload = file.parsed_payload ?? {};
  return [
    Array.isArray(payload.headers) ? payload.headers.join("\n") : "",
    Array.isArray(payload.preview) ? stringifyCompact(payload.preview.slice(0, 8)) : "",
    Array.isArray(payload.rows) ? stringifyCompact(payload.rows.slice(0, 8)) : "",
    stringifyCompact(payload).slice(0, 800),
  ].filter(Boolean).join("\n");
}

function isSdrfLikeFileName(value: string): boolean {
  const lower = value.toLowerCase();
  return lower === "sdrf.tsv" || lower.endsWith(".sdrf.tsv") || lower.endsWith(".sdrf") || (lower.includes("sdrf") && lower.endsWith(".tsv"));
}

function nonSdrfUploadedFiles(files: Awaited<ReturnType<typeof api.listFiles>>): Awaited<ReturnType<typeof api.listFiles>> {
  return files.filter((file) => file.file_type !== "sdrf" && !isSdrfLikeFileName(file.filename));
}

function nonSdrfUploadedFileSummaries(files: SessionUploadedFileSummary[] | undefined): SessionUploadedFileSummary[] {
  return (files ?? []).filter((file) => file.fileType !== "sdrf" && !isSdrfLikeFileName(file.filename));
}

function stripExistingSdrfPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(stripExistingSdrfPayload)
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (["existing_sdrf_files", "existing_sdrf_import", "files_raw"].includes(key)) continue;
    const maybeName = typeof item === "string" && ["fileName", "name", "fileNameSubmitted", "filename", "source_ref"].includes(key) ? item : "";
    if (maybeName && isSdrfLikeFileName(maybeName)) return undefined;
    const stripped = stripExistingSdrfPayload(item);
    if (stripped !== undefined) output[key] = stripped;
  }
  return output;
}

function extractDesignOrganisms(files: Awaited<ReturnType<typeof api.listFiles>>): string[] {
  const organisms = new Set<string>();
  nonSdrfUploadedFiles(files)
    .filter((file) => file.file_type === "design-table")
    .forEach((file) => {
      extractOrganismsFromParsedPayload(file.parsed_payload ?? {}).forEach((organism) => organisms.add(organism));
    });
  return Array.from(organisms).slice(0, 4);
}

function extractOrganismsFromParsedPayload(payload: Record<string, unknown>): string[] {
  const organisms = new Set<string>();
  const rows = [
    ...(Array.isArray(payload.preview) ? payload.preview : []),
    ...(Array.isArray(payload.rows) ? payload.rows : []),
  ];
  rows.forEach((row) => {
    if (!row || typeof row !== "object") return;
    Object.entries(row as Record<string, unknown>).forEach(([key, value]) => {
      if (key.toLowerCase().includes("organism")) {
        const text = compactRecommendationValue(value);
        if (text) organisms.add(text);
      }
    });
  });
  return Array.from(organisms).slice(0, 4);
}

function sortRecommendationHighlights(highlights: { label: string; value: string }[]): { label: string; value: string }[] {
  const priority = ["PRIDE", "Design organism", "Organism", "Instrument", "Raw files", "Design table", "Design tables", "Uploads"];
  return [...highlights].sort((left, right) => {
    const leftIndex = priority.indexOf(left.label);
    const rightIndex = priority.indexOf(right.label);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });
}

function buildAssistantFacts(recommendation: TemplateRecommendation, evidenceCount: number, fileCount: number): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  const pride = recommendation.importHighlights.find((item) => item.label === "PRIDE");
  const organism = recommendation.importHighlights.find((item) => item.label === "Organism" || item.label === "Design organism");
  const instrument = recommendation.importHighlights.find((item) => item.label === "Instrument");
  if (pride) facts.push(pride);
  if (organism && !facts.some((item) => item.label === organism.label)) facts.push(organism);
  if (instrument && !facts.some((item) => item.label === instrument.label)) facts.push(instrument);
  if (!facts.length) facts.push({ label: "Evidence", value: `${evidenceCount} signals` });
  if (fileCount > 0 && !facts.some((item) => item.label === "Files")) {
    facts.push({ label: "Files", value: `${fileCount}` });
  }
  return facts.slice(0, 4);
}

type RecommendationEvidenceCard = {
  key: string;
  field: string;
  value: string;
  source: string;
  sourceRef: string;
  location: string;
  confidence: number;
  status: string;
};

type TemplateDecisionItem = {
  template: SdrfTemplate;
  reason: string;
  sources: TemplateRecommendationSourceRef[];
};

function buildRecommendationEvidenceItems(evidence: Awaited<ReturnType<typeof api.getAnalysis>>["evidences"]): RecommendationEvidenceCard[] {
  const seen = new Set<string>();
  return dedupeRecommendationEvidence(evidence)
    .map((item) => {
      const key = `${item.source_type}|${item.field}|${item.value}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        key,
        field: item.field,
        value: cleanEvidenceText(item.value),
        source: cleanOneLineString(item.source_type),
        sourceRef: cleanOneLineString(item.source_ref),
        location: formatEvidenceLocation(item),
        confidence: item.confidence,
        status: cleanOneLineString(item.status),
      };
    })
    .filter((item): item is RecommendationEvidenceCard => Boolean(item))
}

function buildTemplateDecisionItems(
  recommendation: TemplateRecommendation,
  definitions: SdrfTemplate[],
  evidenceItems: RecommendationEvidenceCard[],
): TemplateDecisionItem[] {
  return definitions.map((template) => {
    const templateReason = recommendation.templateReasons?.find((item) => item.templateId === template.id);
    const matchedSources = templateReason?.sources.length
      ? templateReason.sources
      : chooseFallbackDecisionSources(template, recommendation, evidenceItems);
    return {
      template,
      reason: templateReason?.reason || buildFallbackTemplateReason(template, recommendation),
      sources: matchedSources,
    };
  });
}

function buildFallbackTemplateReason(template: SdrfTemplate, recommendation: TemplateRecommendation): string {
  if (template.layer === "technology") {
    return cleanOneLineString(`${template.title} is the technology template in the AI stack; review the source below for the study-type signal.`);
  }
  if (template.exclusiveGroup === "sample-context") {
    return cleanOneLineString(`${template.title} is the primary sample context in the AI stack; verify it against the organism or sample source below.`);
  }
  return cleanOneLineString(`${template.title} is included as an experiment extension; verify it against the method or study-design source below.`);
}

function chooseFallbackDecisionSources(
  template: SdrfTemplate,
  recommendation: TemplateRecommendation,
  evidenceItems: RecommendationEvidenceCard[],
): TemplateRecommendationSourceRef[] {
  const matches = evidenceItems.filter((item) => evidenceMatchesTemplateLayer(item, template));
  const sourceCards = (matches.length ? matches : evidenceItems).map((item) => evidenceCardToSourceRef(item));
  if (sourceCards.length) return sourceCards;
  return recommendation.importHighlights.map((item) => ({
    label: item.label,
    value: item.value,
    location: item.location || "Import page context",
    source: item.source,
    field: item.field,
  }));
}

function evidenceMatchesTemplateLayer(item: RecommendationEvidenceCard, template: SdrfTemplate): boolean {
  const text = `${item.field} ${item.value} ${item.source} ${item.sourceRef}`.toLowerCase();
  if (template.layer === "technology") {
    return /technology|instrument|acquisition|method|assay|proteom|metabolom|mass spectrom|project accession|title|description/.test(text);
  }
  if (template.layer === "sample") {
    return /organism|sample|tissue|disease|environment|clinical|oncolog|human|vertebrate|plant|soil|water|gut/.test(text);
  }
  return /acquisition|method|instrument|label|chromatography|single|cell|hla|mhc|cross|dia|immunopeptid|lc[-\s]?ms|gc[-\s]?ms/.test(text);
}

function evidenceCardToSourceRef(item: RecommendationEvidenceCard): TemplateRecommendationSourceRef {
  return {
    label: item.field,
    value: item.value,
    source: item.source,
    field: item.field,
    location: item.location,
  };
}

function formatEvidenceLocation(item: Awaited<ReturnType<typeof api.getAnalysis>>["evidences"][number]): string {
  const source = cleanOneLineString(item.source_type);
  const sourceRef = cleanOneLineString(item.source_ref);
  const field = cleanOneLineString(item.field);
  if (source.toLowerCase() === "pride") {
    return ["Import", "PRIDE metadata", field || sourceRef].filter(Boolean).join(" > ");
  }
  if (source.toLowerCase() === "design-table") {
    return ["Import", "Design table", field || sourceRef].filter(Boolean).join(" > ");
  }
  if (source.toLowerCase() === "file") {
    return ["Import", "Uploaded file", sourceRef, field].filter(Boolean).join(" > ");
  }
  return ["Import", source, sourceRef, field].filter(Boolean).join(" > ");
}

function compactRecommendationValue(value: unknown): string {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => compactRecommendationValue(item)).filter(Boolean))).slice(0, 6).join(", ");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const namedValue = pickString(record, ["name", "title", "label", "fileName", "accession", "value"]);
    if (namedValue) return namedValue.slice(0, 96);
  }
  return stringifyCompact(value).replace(/\s+/g, " ").trim().slice(0, 96);
}

function asRecommendationRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

type TemplateAiRecommendationInput = {
  task: string;
  project: Record<string, unknown>;
  session: Record<string, unknown>;
  import_page_context: Record<string, unknown>;
  current_evidence: Record<string, unknown>[];
  uploaded_files: Record<string, unknown>[];
  current_sdrf_table: Record<string, unknown>;
  supported_templates: Record<string, unknown>[];
  deterministic_fallback: Record<string, unknown>;
  sdrf_rules: string[];
  output_schema: Record<string, unknown>;
};

function buildTemplateAiRecommendationInput({
  project,
  sessionState,
  evidence,
  files,
  table,
  fallback,
}: {
  project: Project;
  sessionState: SessionUiState;
  evidence: Awaited<ReturnType<typeof api.getAnalysis>>["evidences"];
  files: Awaited<ReturnType<typeof api.listFiles>>;
  table?: Awaited<ReturnType<typeof api.getSdrfTable>>;
  fallback: TemplateRecommendation;
}): TemplateAiRecommendationInput {
  const importState = sessionState.import ?? {};
  const accession = (
    importState.prideAccession ||
    importState.activeImportAccession ||
    importState.accession ||
    project.pride_accession ||
    ""
  ).toUpperCase();
  const uploadedFiles = nonSdrfUploadedFiles(files);
  const currentEvidence = dedupeRecommendationEvidence(evidence).filter((item) => {
    const haystack = `${item.source_type} ${item.source_ref} ${item.field}`.toLowerCase();
    return !haystack.includes("sdrf.tsv") && !haystack.includes(".sdrf") && item.source_type !== "sdrf";
  });
  return {
    task: "Recommend a valid quantms SDRF template stack for the user's current session.",
    project: {
      id: project.id,
      name: project.name,
      pride_accession: accession || project.pride_accession,
      current_step: sessionState.currentStep ?? sessionState.step ?? project.current_step,
    },
    session: {
      project_id: sessionState.projectId ?? project.id,
      display_name: sessionState.displayName ?? buildSessionDisplayName(project, importState),
      selected_templates: sessionState.templates?.selectedTemplates ?? [],
      last_template_ai_status: sessionState.templates?.aiRecommendationStatus ?? "idle",
      updated_at: sessionState.updatedAt,
    },
    import_page_context: {
      start_mode: importState.startMode ?? "pride",
      accession,
      active_import_accession: importState.activeImportAccession ?? accession,
      pride_title: importState.prideTitle,
      pride_description: importState.prideDescription,
      organisms: importState.prideOrganisms ?? [],
      instruments: importState.prideInstruments ?? [],
      keywords: importState.prideKeywords ?? [],
      raw_file_count: importState.rawFileCount ?? 0,
      publication_count: importState.publicationCount ?? 0,
      uploaded_file_summaries: nonSdrfUploadedFileSummaries(importState.uploadedFiles),
      design_csv_choice: importState.designCsvChoice ?? "unknown",
      design_mapping_status: importState.designMappingStatus,
      design_mapping_confirmed: Boolean(importState.designMappingConfirmed),
      design_headers: importState.rawDesignTable?.headers ?? [],
      mapped_design_headers: importState.mappedDesignTable?.headers ?? [],
      design_preview_rows: importState.rawDesignTable?.rows?.slice(0, 8) ?? [],
      mapped_design_preview_rows: importState.mappedDesignTable?.rows?.slice(0, 8) ?? [],
      normalization_status: importState.normalizationStatus,
      normalization_issues: importState.normalizationIssues?.slice(0, 12) ?? [],
    },
    current_evidence: currentEvidence.slice(0, 30).map((item) => ({
      source_type: item.source_type,
      source_ref: item.source_ref,
      field: item.field,
      value: item.value,
      confidence: item.confidence,
      status: item.status,
      payload_summary: stringifyCompact(stripExistingSdrfPayload(item.payload)).slice(0, 1200),
    })),
    uploaded_files: uploadedFiles.slice(0, 30).map((file) => ({
      id: file.id,
      filename: file.filename,
      file_type: file.file_type,
      content_type: file.content_type,
      parse_status: file.parse_status,
      size_bytes: file.size_bytes,
      parsed_summary: summarizeUploadedFileForRecommendation(file).slice(0, 1400),
    })),
    current_sdrf_table: {
      headers: table?.headers ?? [],
      row_count: table?.rows.length ?? 0,
      preview_rows: table?.rows.slice(0, 6) ?? [],
      column_metadata: table?.column_metadata ?? {},
    },
    supported_templates: SDRF_TEMPLATES.map((template) => ({
      id: template.id,
      title: template.title,
      version: template.version,
      layer: template.layer,
      exclusive_group: template.exclusiveGroup ?? null,
      category: template.category,
      description: template.description,
      typical_examples: template.examples,
      required_columns: getRequiredTemplateColumns([template.id]),
      columns: getTemplateColumns([template.id]),
    })),
    deterministic_fallback: {
      selected_template_ids: fallback.selectedIds,
      confidence: fallback.confidence,
      detected_summary: fallback.detectedSummary,
      evidence_labels: fallback.evidenceLabels,
      rule_notes: fallback.ruleNotes,
      import_highlights: fallback.importHighlights,
      source_summary: fallback.sourceSummary,
    },
    sdrf_rules: [
      "Select exactly one technology template.",
      "Select at most one primary sample context template; clinical and oncology metadata are overlays.",
      "Do not force a sample template when the organism is outside human, vertebrate animal, invertebrate animal, plant, or metaproteomics/environmental contexts.",
      "Do not combine affinity-proteomics or ms-metabolomics with ms-proteomics experiment extensions.",
      "LC-MS and GC-MS metabolomics method templates require ms-metabolomics and are mutually exclusive.",
      "Use only template ids from supported_templates.",
    ],
    output_schema: {
      selected_template_ids: ["template id from supported_templates"],
      confidence: "number from 0 to 1",
      detected_summary: "one sentence based on import evidence",
      evidence_labels: ["short evidence label"],
      rule_notes: ["short SDRF rule applied"],
      import_highlights: [{ label: "PRIDE", value: accession || "PXD accession if present" }],
      template_reasons: [
        {
          template_id: "template id from selected_template_ids",
          reason: "why this exact template was selected",
          sources: [
            {
              label: "human-readable evidence field",
              value: "exact observed value",
              source: "import_page_context | current_evidence | uploaded_files | current_sdrf_table",
              field: "specific field or column name",
              location: "where the value appears, e.g. Import > PRIDE metadata > organisms",
            },
          ],
        },
      ],
      rationale: ["brief reason for the selected templates"],
    },
  };
}

async function requestTemplateAiRecommendation(
  input: TemplateAiRecommendationInput,
  fallback: TemplateRecommendation,
  config: ClientAiConfig,
): Promise<TemplateRecommendation> {
  try {
    const payload = await api.chatCompletion({
        model: config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: SDRF_TEMPLATE_RECOMMENDATION_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
      }, {
        timeoutMs: TEMPLATE_AI_REQUEST_TIMEOUT_MS,
        timeoutMessage: `AI template recommendation timed out after ${Math.round(TEMPLATE_AI_REQUEST_TIMEOUT_MS / 1000)} seconds. Please rerun it.`,
    });
    const content = aiChatContent(payload);
    return buildAiTemplateRecommendation(parseAiJsonObject(content), fallback, config.model);
  } catch (error) {
    throw error;
  }
}

function buildAiTemplateRecommendation(
  parsed: Record<string, unknown>,
  fallback: TemplateRecommendation,
  model: string,
): TemplateRecommendation {
  const rawIds = parsed.selected_template_ids ?? parsed.selectedTemplates ?? parsed.selected_ids ?? parsed.templates ?? parsed.template_ids;
  const selectedIds = repairTemplateStackForRecommendation(sanitizeTemplateIds(rawIds), fallback.selectedIds);
  const compatibilityIssues = getTemplateCompatibilityIssues(selectedIds);
  const aiRuleNotes = uniqueStrings([
    ...toStringArray(parsed.rule_notes ?? parsed.ruleNotes),
    ...fallback.ruleNotes,
    ...compatibilityIssues.map((issue) => `Guardrail: ${issue}`),
  ]).slice(0, 5);
  const evidenceLabels = uniqueStrings([
    ...toStringArray(parsed.evidence_labels ?? parsed.evidenceLabels ?? parsed.signals),
    ...fallback.evidenceLabels,
  ]).slice(0, 6);
  const detectedSummary = cleanOneLineString(parsed.detected_summary ?? parsed.detectedSummary)
    || `AI recommended ${selectedIds.join(", ")} from ${fallback.sourceSummary}.`;
  return {
    selectedIds,
    confidence: normalizeRecommendationConfidence(parsed.confidence, Math.max(0.72, fallback.confidence)),
    detectedSummary,
    evidenceLabels,
    ruleNotes: aiRuleNotes,
    importHighlights: sanitizeRecommendationHighlights(parsed.import_highlights ?? parsed.importHighlights, fallback.importHighlights),
    sourceSummary: cleanOneLineString(parsed.source_summary ?? parsed.sourceSummary) || fallback.sourceSummary,
    source: "ai",
    model,
    generatedAt: new Date().toISOString(),
    promptVersion: TEMPLATE_AI_PROMPT_VERSION,
    aiRationale: toStringArray(parsed.rationale ?? parsed.reasoning ?? parsed.ai_rationale ?? parsed.aiRationale).slice(0, 4),
    templateReasons: sanitizeTemplateReasons(parsed.template_reasons ?? parsed.templateReasons ?? parsed.reasons_by_template, selectedIds),
    validationNotes: compatibilityIssues,
  };
}

function sanitizeTemplateRecommendation(value: unknown): TemplateRecommendation | undefined {
  const record = asRecommendationRecord(value);
  if (!record) return undefined;
  const selectedIds = repairTemplateStackForRecommendation(
    sanitizeTemplateIds(record.selectedIds ?? record.selected_template_ids ?? record.selectedTemplates ?? record.templates),
    ["ms-proteomics"],
  );
  if (!selectedIds.length) return undefined;
  return {
    selectedIds,
    confidence: normalizeRecommendationConfidence(record.confidence, 0.72),
    detectedSummary: cleanOneLineString(record.detectedSummary ?? record.detected_summary)
      || "Saved template recommendation restored from this session.",
    evidenceLabels: toStringArray(record.evidenceLabels ?? record.evidence_labels),
    ruleNotes: toStringArray(record.ruleNotes ?? record.rule_notes),
    importHighlights: sanitizeRecommendationHighlights(record.importHighlights ?? record.import_highlights, []),
    sourceSummary: cleanOneLineString(record.sourceSummary ?? record.source_summary) || "saved session recommendation",
    source: record.source === "ai" || record.model ? "ai" : "rules",
    model: cleanOneLineString(record.model),
    generatedAt: cleanOneLineString(record.generatedAt ?? record.generated_at),
    promptVersion: Number(record.promptVersion ?? record.prompt_version) || undefined,
    aiRationale: toStringArray(record.aiRationale ?? record.ai_rationale ?? record.rationale),
    templateReasons: sanitizeTemplateReasons(record.templateReasons ?? record.template_reasons ?? record.reasons_by_template, selectedIds),
    validationNotes: toStringArray(record.validationNotes ?? record.validation_notes),
  };
}

function repairTemplateStackForRecommendation(ids: SdrfTemplateId[], fallbackIds: SdrfTemplateId[] = []): SdrfTemplateId[] {
  let selected = ids.length ? ids : sanitizeTemplateIds(fallbackIds);
  const fallbackTechnology = fallbackIds.find((id) => getTemplateById(id)?.layer === "technology") ?? "ms-proteomics";
  const technologies = selected.filter((id) => getTemplateById(id)?.layer === "technology");
  if (!technologies.length) {
    selected = [fallbackTechnology, ...selected];
  } else if (technologies.length > 1) {
    const preferredTechnology = technologies[0];
    selected = selected.filter((id) => getTemplateById(id)?.layer !== "technology" || id === preferredTechnology);
  }
  let normalized = normalizeTemplateStack(selected);
  const technology = normalized.find((id) => getTemplateById(id)?.layer === "technology") ?? fallbackTechnology;
  normalized = normalized.filter((id) => {
    if (MS_PROTEOMICS_EXPERIMENT_TEMPLATES.includes(id) && technology !== "ms-proteomics") return false;
    if (METABOLOMICS_METHOD_TEMPLATES.includes(id) && technology !== "ms-metabolomics") return false;
    return true;
  });
  const metabolomicsMethods = METABOLOMICS_METHOD_TEMPLATES.filter((id) => normalized.includes(id));
  if (metabolomicsMethods.length > 1) {
    normalized = normalized.filter((id) => !METABOLOMICS_METHOD_TEMPLATES.includes(id) || id === metabolomicsMethods[0]);
  }
  if (!normalized.some((id) => getTemplateById(id)?.layer === "technology")) {
    normalized = [fallbackTechnology, ...normalized];
  }
  return orderTemplateStack(normalizeTemplateStack(normalized));
}

function parseAiJsonObject(content: unknown): Record<string, unknown> {
  if (content && typeof content === "object" && !Array.isArray(content)) return content as Record<string, unknown>;
  if (typeof content !== "string") throw new Error("AI response did not contain JSON.");
  const trimmed = content.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    trimmed.includes("{") ? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1) : "",
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("AI response JSON could not be parsed.");
}

function sanitizeTemplateReasons(value: unknown, selectedIds: SdrfTemplateId[]): TemplateRecommendationReason[] {
  const selected = new Set(selectedIds);
  const rawItems: Record<string, unknown>[] = [];
  if (Array.isArray(value)) {
    value.forEach((item) => {
      const record = asRecommendationRecord(item);
      if (record) rawItems.push(record);
    });
  } else if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, itemValue]) => {
      const record = asRecommendationRecord(itemValue);
      rawItems.push(record ? { template_id: key, ...record } : { template_id: key, reason: itemValue });
    });
  }

  const byTemplate = new Map<SdrfTemplateId, TemplateRecommendationReason>();
  rawItems.forEach((record) => {
    const templateId = sanitizeTemplateIds([
      record.template_id ?? record.templateId ?? record.id ?? record.template,
    ])[0];
    if (!templateId || !selected.has(templateId) || byTemplate.has(templateId)) return;
    const reason = cleanEvidenceText(record.reason ?? record.why ?? record.explanation ?? record.rationale);
    const sources = sanitizeTemplateReasonSources(record.sources ?? record.evidence ?? record.citations ?? record.source);
    if (!reason && !sources.length) return;
    byTemplate.set(templateId, { templateId, reason, sources });
  });

  return selectedIds.map((id) => byTemplate.get(id)).filter((item): item is TemplateRecommendationReason => Boolean(item));
}

function sanitizeTemplateReasonSources(value: unknown): TemplateRecommendationSourceRef[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const sources: TemplateRecommendationSourceRef[] = [];
  raw.forEach((item) => {
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const field = cleanOneLineString(record.field ?? record.column ?? record.key ?? record.name);
      const source = cleanOneLineString(record.source ?? record.source_type ?? record.sourceType ?? record.ref ?? record.source_ref);
      const label = cleanOneLineString(record.label ?? field ?? source ?? "Evidence");
      const valueText = cleanEvidenceText(record.value ?? record.text ?? record.quote ?? record.observed_value ?? record.detected_value ?? record.summary);
      const location = cleanOneLineString(record.location ?? record.path ?? record.where);
      if (label && valueText && !sources.some((sourceItem) => sourceItem.label === label && sourceItem.value === valueText)) {
        sources.push({ label, value: valueText, source, field, location });
      }
    } else {
      const valueText = cleanEvidenceText(item);
      if (valueText) sources.push({ label: "Evidence", value: valueText });
    }
  });
  return sources;
}

function sanitizeRecommendationHighlights(
  value: unknown,
  fallback: { label: string; value: string }[],
): { label: string; value: string }[] {
  const highlights: { label: string; value: string }[] = [];
  const add = (label: unknown, itemValue: unknown) => {
    const cleanLabel = cleanOneLineString(label);
    const cleanValue = compactRecommendationValue(itemValue);
    if (cleanLabel && cleanValue && !highlights.some((item) => item.label === cleanLabel && item.value === cleanValue)) {
      highlights.push({ label: cleanLabel, value: cleanValue });
    }
  };
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        add(record.label ?? record.key ?? record.name, record.value ?? record.text ?? record.summary);
      } else {
        add("Evidence", item);
      }
    });
  } else if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([label, itemValue]) => add(label, itemValue));
  }
  fallback.forEach((item) => add(item.label, item.value));
  return sortRecommendationHighlights(highlights).slice(0, 6);
}

function normalizeRecommendationConfidence(value: unknown, fallback: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? (parsed > 1 ? parsed / 100 : parsed) : fallback;
  return Math.max(0.35, Math.min(0.99, normalized));
}

function toStringArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  return uniqueStrings(raw.map((item) => cleanOneLineString(item)).filter(Boolean)).slice(0, 8);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function cleanOneLineString(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function cleanEvidenceText(value: unknown): string {
  return stringifyFullEvidenceValue(value)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stringifyFullEvidenceValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => stringifyFullEvidenceValue(item)).filter(Boolean).join("\n");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function mergeTemplatesIntoTable(table: Awaited<ReturnType<typeof api.getSdrfTable>>, templateIds: SdrfTemplateId[]): Awaited<ReturnType<typeof api.getSdrfTable>> {
  const templateHeaders = ["comment[sdrf version]", "comment[sdrf template]", ...getTemplateColumns(templateIds)];
  const headers = Array.from(new Set([...table.headers, ...templateHeaders]));
  const templateValue = templateIds
    .map((id) => getTemplateById(id))
    .filter((template): template is SdrfTemplate => Boolean(template))
    .map((template) => `${template.title} ${template.version}`)
    .join("; ");
  return {
    ...table,
    headers,
    rows: table.rows.map((row) => Object.fromEntries(headers.map((header) => {
      if (header === "comment[sdrf version]") return [header, row[header] ?? "v1.1.0"];
      if (header === "comment[sdrf template]") return [header, row[header] ?? templateValue];
      return [header, row[header] ?? ""];
    }))),
    column_metadata: Object.fromEntries(headers.map((header) => [header, classifySdrfColumn(header, templateIds)])),
    dirty: true,
  };
}

function normalizeTemplateStack(ids: SdrfTemplateId[]): SdrfTemplateId[] {
  return ids.reduce<SdrfTemplateId[]>((stack, id) => {
    const template = getTemplateById(id);
    if (!template) return stack;
    const group = template.exclusiveGroup;
    const withoutConflicts = group ? stack.filter((item) => getTemplateById(item)?.exclusiveGroup !== group) : stack;
    return withoutConflicts.includes(id) ? withoutConflicts : [...withoutConflicts, id];
  }, []);
}

function orderTemplateStack(ids: SdrfTemplateId[]): SdrfTemplateId[] {
  const layerOrder: Record<SdrfTemplateLayer, number> = { technology: 0, sample: 1, experiment: 2 };
  return [...ids].sort((left, right) => {
    const leftTemplate = getTemplateById(left);
    const rightTemplate = getTemplateById(right);
    return (leftTemplate ? layerOrder[leftTemplate.layer] : 99) - (rightTemplate ? layerOrder[rightTemplate.layer] : 99);
  });
}

function classifySdrfColumn(header: string, templateIds: SdrfTemplateId[]): { section: string; required?: boolean } {
  const lower = header.toLowerCase();
  const required = getRequiredTemplateColumns(templateIds).includes(header);
  if (lower === "source name" || lower.startsWith("characteristics[")) return { section: "sample", required };
  if (lower === "assay name") return { section: "assay", required };
  if (lower.startsWith("comment[")) return { section: "data_file", required };
  if (lower.startsWith("factor value[")) return { section: "factor", required };
  return { section: "other", required };
}

function getImportedAccession(evidence: Awaited<ReturnType<typeof api.getAnalysis>>["evidences"]): string {
  for (const item of evidence) {
    const accession = String(item.payload?.accession ?? item.payload?.project_accession ?? item.value ?? "");
    const match = accession.match(/PXD\d{6,}/i);
    if (match) return match[0].toUpperCase();
  }
  return "";
}

function syncSessionWithProject(project: Pick<Project, "id" | "name" | "pride_accession">, state: SessionUiState): SessionUiState {
  const importState: SessionImportState = { ...(state.import ?? {}) };
  if (project.pride_accession && !importState.prideAccession) importState.prideAccession = project.pride_accession;
  if (project.pride_accession && !importState.activeImportAccession) importState.activeImportAccession = project.pride_accession;
  if (project.pride_accession && !importState.accession) importState.accession = project.pride_accession;
  return {
    ...state,
    projectId: project.id,
    displayName: buildSessionDisplayName(project, importState),
    import: importState,
  };
}

function buildSessionDisplayName(project: Pick<Project, "name" | "pride_accession">, importState?: SessionImportState): string {
  const accession = (
    importState?.prideAccession ||
    importState?.activeImportAccession ||
    importState?.accession ||
    project.pride_accession ||
    ""
  ).toUpperCase();
  const projectName = cleanOneLineString(project.name);
  const title = cleanOneLineString(importState?.prideTitle);
  const defaultName = !projectName || projectName === "New SDRF Project" || projectName === "New SDRF Session" || projectName.startsWith("SDRF Session ");
  if (accession && title && !title.toLowerCase().includes(accession.toLowerCase())) return `${accession} - ${title}`;
  if (accession) return accession;
  if (title) return title;
  return defaultName ? "Untitled session" : projectName;
}

function summarizeSessionUploadedFile(file: Awaited<ReturnType<typeof api.listFiles>>[number]): SessionUploadedFileSummary {
  return {
    id: file.id,
    filename: file.filename,
    fileType: file.file_type,
    parseStatus: file.parse_status,
    createdAt: file.created_at,
  };
}

function buildPrideSessionImportState(payload: unknown, fallbackAccession: string): Partial<SessionImportState> {
  const data = (payload ?? {}) as {
    accession?: string;
    project?: Record<string, unknown>;
    files?: Record<string, unknown>;
  };
  const projectPayload = data.project ?? {};
  const filesPayload = data.files;
  const accession = String(data.accession || projectPayload.accession || fallbackAccession || "").toUpperCase();
  return {
    accession,
    activeImportAccession: accession,
    prideAccession: accession,
    prideTitle: pickString(projectPayload, ["title", "projectTitle"]),
    prideDescription: pickString(projectPayload, [
      "description",
      "projectDescription",
      "sample_processing_protocol",
      "sampleProcessingProtocol",
      "data_processing_protocol",
      "dataProcessingProtocol",
    ]).slice(0, 800),
    prideOrganisms: normalizeSessionStringList(projectPayload.organism ?? projectPayload.organisms ?? projectPayload.organismNames ?? projectPayload.species),
    prideInstruments: normalizeSessionStringList(projectPayload.instruments ?? projectPayload.instrumentNames),
    prideKeywords: normalizeSessionStringList(projectPayload.keywords ?? projectPayload.projectTags ?? projectPayload.experimentTypes ?? projectPayload.quantificationMethods),
    rawFileCount: getPrideFileCount(filesPayload),
    publicationCount: getProjectPublications(projectPayload).length,
    importedAt: new Date().toISOString(),
  };
}

function normalizeSessionStringList(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value.map((item) => compactRecommendationValue(item)).filter(Boolean)).slice(0, 8);
  const compact = compactRecommendationValue(value);
  return compact ? [compact] : [];
}

const SESSION_STATE_PREFIX = "sdrf-studio-session-state:";

function sessionStateKey(projectId: string): string {
  return `${SESSION_STATE_PREFIX}${projectId}`;
}

function readSessionUiState(projectId: string): SessionUiState {
  try {
    const raw = window.localStorage.getItem(sessionStateKey(projectId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SessionUiState;
    return parsed && typeof parsed === "object" ? normalizeSessionUiState(projectId, parsed, false) : {};
  } catch {
    return {};
  }
}

function writeSessionUiState(projectId: string, state: SessionUiState): boolean {
  try {
    window.localStorage.setItem(sessionStateKey(projectId), JSON.stringify(normalizeSessionUiState(projectId, state, true)));
    return true;
  } catch {
    return false;
  }
}

function removeSessionUiState(projectId: string) {
  window.localStorage.removeItem(sessionStateKey(projectId));
}

function updateSessionUiState(projectId: string, updater: (current: SessionUiState) => SessionUiState): boolean {
  return writeSessionUiState(projectId, updater(readSessionUiState(projectId)));
}

function updateSampleAiSessionState(projectId: string, patch: Partial<SessionSampleState>): boolean {
  const updatedAt = patch.aiUpdatedAt ?? new Date().toISOString();
  return updateSessionUiState(projectId, (current) => ({
    ...current,
    samples: {
      ...(current.samples ?? {}),
      ...patch,
      aiUpdatedAt: updatedAt,
    },
  }));
}

function getStoredSessionStep(project: Pick<Project, "id" | "current_step">): StepKey {
  const state = readSessionUiState(project.id);
  return state.currentStep ?? state.step ?? coerceStepKey(project.current_step);
}

function coerceStepKey(value: string | null | undefined): StepKey {
  return steps.some((item) => item.key === value) ? value as StepKey : "import";
}

function stepLabel(value: StepKey): string {
  return steps.find((item) => item.key === value)?.label ?? "Import";
}

function normalizeSessionUiState(projectId: string, state: SessionUiState, touch: boolean): SessionUiState {
  const storedStep = state.currentStep ?? state.step;
  const step = storedStep ? coerceStepKey(storedStep) : undefined;
  return {
    ...state,
    version: state.version ?? 2,
    projectId,
    currentStep: step,
    step,
    updatedAt: touch ? new Date().toISOString() : state.updatedAt,
  };
}

function sessionTitle(project: Pick<Project, "id" | "name" | "pride_accession">): string {
  const state = readSessionUiState(project.id);
  return state.displayName || buildSessionDisplayName(project, state.import);
}

function newSessionName(): string {
  return `SDRF Session ${new Date().toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
}

function formatSessionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not saved yet";
  return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function sanitizeTemplateIds(ids: unknown): SdrfTemplateId[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is SdrfTemplateId => typeof id === "string" && Boolean(getTemplateById(id as SdrfTemplateId)));
}

function resolveSessionDesignState(
  importState: SessionImportState,
  designFile: Awaited<ReturnType<typeof api.listFiles>>[number] | undefined,
  designHeaders: string[],
): ResolvedSessionDesignState {
  const parsedTable = designHeaders.length ? buildParsedDesignTable(designFile) : null;
  const canRestore = Boolean(designFile?.id && importState.designFileId === designFile.id);
  if (!designHeaders.length) {
    return {
      designFileId: undefined,
      designMapping: {},
      designMappingReasons: {},
      designMappingFileReason: "",
      designMappingStatus: "Upload a design file to review and map its columns.",
      designMappingConfirmed: false,
      rawDesignTable: null,
      mappedDesignTable: null,
      normalizationStatus: "Map at least one column, then validate SDRF values.",
      normalizationIssues: [],
    };
  }

  return {
    designFileId: designFile?.id,
    designMapping: canRestore ? sanitizeColumnMapping(importState.designMapping, designHeaders) : emptyColumnMapping(designHeaders),
    designMappingReasons: canRestore ? sanitizeColumnMappingReasons(importState.designMappingReasons, designHeaders) : {},
    designMappingFileReason: canRestore && typeof importState.designMappingFileReason === "string" ? importState.designMappingFileReason : "",
    designMappingStatus: canRestore && typeof importState.designMappingStatus === "string"
      ? importState.designMappingStatus
      : "Design file loaded. Review or edit the table, then map columns manually or ask AI for suggestions.",
    designMappingConfirmed: canRestore ? Boolean(importState.designMappingConfirmed) : false,
    rawDesignTable: canRestore ? sanitizeMappedDesignTable(importState.rawDesignTable, designHeaders) ?? parsedTable : parsedTable,
    mappedDesignTable: canRestore ? sanitizeMappedDesignTable(importState.mappedDesignTable) : null,
    normalizationStatus: canRestore && typeof importState.normalizationStatus === "string"
      ? importState.normalizationStatus
      : "Map at least one column, then validate SDRF values.",
    normalizationIssues: canRestore ? sanitizeNormalizationIssues(importState.normalizationIssues) : [],
  };
}

function sanitizeColumnMapping(value: unknown, headers: string[]): ColumnMapping {
  const mapping = emptyColumnMapping(headers);
  if (!value || typeof value !== "object") return mapping;
  const record = value as Record<string, unknown>;
  for (const header of headers) {
    const target = record[header];
    mapping[header] = typeof target === "string" ? normalizeAiTarget(target) : "";
  }
  return mapping;
}

function sanitizeColumnMappingReasons(value: unknown, headers: string[]): ColumnMappingReasons {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    headers
      .map((header) => [header, record[header]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0),
  );
}

function sanitizeMappedDesignTable(value: unknown, allowedHeaders?: string[]): MappedDesignTable | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const headers = Array.isArray(record.headers) ? record.headers.map(String).filter(Boolean) : [];
  const usableHeaders = allowedHeaders?.length ? headers.filter((header) => allowedHeaders.includes(header)) : headers;
  if (!usableHeaders.length) return null;
  const rawRows = Array.isArray(record.rows) ? record.rows : [];
  const rows = rawRows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => Object.fromEntries(usableHeaders.map((header) => [header, row[header] == null ? "" : String(row[header])])));
  return { headers: usableHeaders, rows };
}

function sanitizeNormalizationIssues(value: unknown): SdrfNormalizationIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((issue): issue is Record<string, unknown> => Boolean(issue) && typeof issue === "object")
    .map((issue) => ({
      rowIndex: Number(issue.rowIndex ?? 0),
      field: String(issue.field ?? ""),
      originalValue: String(issue.originalValue ?? ""),
      normalizedValue: String(issue.normalizedValue ?? ""),
      reason: String(issue.reason ?? ""),
      severity: sanitizeNormalizationSeverity(issue.severity),
    }))
    .filter((issue) => issue.field);
}

function sanitizeNormalizationSeverity(value: unknown): SdrfNormalizationIssue["severity"] {
  return value === "error" || value === "warning" || value === "info" ? value : "info";
}

function PrideImportProgress({ accession, elapsedSeconds }: { accession: string; elapsedSeconds: number }) {
  const steps = [
    "Fetching project metadata",
    "Resolving publication references",
    "Fetching project file list",
    "Preparing non-SDRF file evidence",
    "Checking downloadable publication PDFs",
    "Preparing import summary",
  ];
  const activeIndex = Math.min(steps.length - 1, Math.floor(elapsedSeconds / 10));
  const progress = Math.min(96, Math.max(8, Math.round((elapsedSeconds / 90) * 100)));
  return (
    <div className="pride-loading-card" role="status" aria-live="polite">
      <div className="loading-card-head">
        <div className="loading-spinner" />
        <div>
          <strong>Fetching information for {accession || "this PRIDE project"}</strong>
          <p>{elapsedSeconds >= 45 ? "Large PRIDE projects can take longer while file lists and publication links are checked." : "We are contacting PRIDE and related public metadata services."}</p>
        </div>
        <span>{elapsedSeconds}s</span>
      </div>
      <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
      <ol className="loading-step-list">
        {steps.map((step, index) => (
          <li key={step} className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""}>
            <span>{index < activeIndex ? "✓" : index === activeIndex ? "…" : ""}</span>
            {step}
          </li>
        ))}
      </ol>
      {elapsedSeconds >= 75 && (
        <p className="timeout-hint">Still waiting. This request will time out automatically at 90 seconds so you can retry or continue with manual uploads.</p>
      )}
    </div>
  );
}

function DesignMappingStep({
  designFile,
  rawTable,
  headers,
  mapping,
  mappingReasons,
  fileReason,
  mappingStatus,
  confirmed,
  aiMappingPending,
  mappedTable,
  normalizationStatus,
  normalizationIssues,
  normalizationPending,
  uploadPending,
  removePending,
  onUpload,
  onRemove,
  onMappingChange,
  onRawCellChange,
  onAiMap,
  onValidate,
  onCellChange,
}: {
  designFile?: Awaited<ReturnType<typeof api.listFiles>>[number];
  rawTable: MappedDesignTable | null;
  headers: string[];
  mapping: ColumnMapping;
  mappingReasons: ColumnMappingReasons;
  fileReason: string;
  mappingStatus: string;
  confirmed: boolean;
  aiMappingPending: boolean;
  mappedTable: MappedDesignTable | null;
  normalizationStatus: string;
  normalizationIssues: SdrfNormalizationIssue[];
  normalizationPending: boolean;
  uploadPending: boolean;
  removePending: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  onMappingChange: (source: string, target: string) => void;
  onRawCellChange: (rowIndex: number, header: string, value: string) => void;
  onAiMap: () => void | Promise<void>;
  onValidate: () => void | Promise<void>;
  onCellChange: (rowIndex: number, header: string, value: string) => void;
}) {
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const canValidate = mappedCount > 0 && !normalizationPending;
  const normalizedFields = normalizationIssues.map((issue) => issue.field);
  const hasFile = Boolean(designFile && headers.length > 0);
  const hasMapping = mappedCount > 0;

  return (
    <div className="design-mapping-step">
      {/* Card 1: Upload File */}
      <div className="mapping-card">
        <div className="mapping-card-header">
          <h4><span className="step-num">1</span> Upload File</h4>
        </div>
        <div className="mapping-card-body">
          {!hasFile ? (
            <div className="upload-zone compact">
              <label className="btn primary file-action-large">
                <span className="upload-btn-text">{uploadPending ? "Uploading..." : "Choose File"}</span>
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.xlx"
                  disabled={uploadPending}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) onUpload(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <p className="upload-hint">CSV, TSV, TXT, XLS, XLSX</p>
            </div>
          ) : (
            <>
              <div className="file-info-row">
                <div className="file-info-left">
                  <FileText size={18} />
                  <div>
                    <strong>{designFile?.filename}</strong>
                    <span>{rawTable?.rows.length ?? 0} rows × {headers.length} columns</span>
                  </div>
                </div>
                <div className="file-info-actions">
                  <label className="btn ghost btn-sm file-action-inline">
                    Replace
                    <input
                      type="file"
                      accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.xlx"
                      disabled={uploadPending || removePending}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) onUpload(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button className="btn danger btn-sm" type="button" disabled={removePending} onClick={onRemove}>
                    {removePending ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>

              <div className="raw-preview-mini">
                <strong className="mapping-subtitle">Uploaded design file preview</strong>
                <table className="preview-table">
                  <thead>
                    <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(rawTable?.rows ?? []).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {headers.map((header) => (
                          <td key={header}>
                            <input value={row[header] ?? ""} onChange={(event) => onRawCellChange(rowIndex, header, event.target.value)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Card 2: Map Columns */}
      <div className="mapping-card">
        <div className="mapping-card-header">
          <h4><span className="step-num">2</span> Map Columns</h4>
        </div>
        <div className="mapping-card-body">
          {!hasFile ? (
            <p className="card-placeholder">Upload a file first to map columns.</p>
          ) : (
            <>
              <strong className="mapping-subtitle">Column mapping</strong>
              <p className="mapping-helper-text">{mappingStatus}</p>
              {aiMappingPending ? (
                <div className="loading-card">
                  <div className="loading-card-head">
                    <div className="loading-spinner" />
                    <div>
                      <strong>Analyzing file structure...</strong>
                      <p>AI is examining your data to suggest column mappings.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <button className="btn ai-btn" type="button" onClick={onAiMap}>Ask AI to map columns</button>
              )}

              <div className="mapping-status-bar">
                <span className="mapping-progress">
                  <span className="mapping-progress-fill" style={{ width: `${(mappedCount / headers.length) * 100}%` }} />
                </span>
                <span className="mapping-count">{mappedCount} / {headers.length} mapped</span>
              </div>

              <div className="mapping-table-wrap">
                <table className="mapping-table">
                  <thead>
                    <tr><th>File Column</th><th>SDRF Field</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {headers.map((source) => (
                      <tr key={source} className={mapping[source] ? "mapped" : ""}>
                        <td className="source-col">{source}</td>
                        <td>
                          <select value={mapping[source] ?? ""} onChange={(event) => onMappingChange(source, event.target.value)}>
                            <option value="">Select field...</option>
                            {SDRF_MAPPING_TARGETS.map((target) => <option key={target} value={target}>{target}</option>)}
                          </select>
                          {mappingReasons[source] && <p className="mapping-reason">{mappingReasons[source]}</p>}
                        </td>
                        <td className="status-col">
                          {mapping[source] ? (
                            <span className="status-badge mapped">✓</span>
                          ) : (
                            <span className="status-badge unmapped">○</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {fileReason && (
                <div className="ai-assessment-box">
                  <strong>AI Analysis</strong>
                  <p>{fileReason}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Card 3: Validate Values */}
      <div className="mapping-card">
        <div className="mapping-card-header">
          <h4><span className="step-num">3</span> Validate Values</h4>
        </div>
        <div className="mapping-card-body">
          {!hasMapping ? (
            <p className="card-placeholder">Map columns first to validate values.</p>
          ) : (
            <>
              {normalizationPending ? (
                <div className="loading-card">
                  <div className="loading-card-head">
                    <div className="loading-spinner" />
                    <div>
                      <strong>Validating and fixing SDRF values</strong>
                      <p>AI is analyzing mapped values and applying corrections...</p>
                    </div>
                  </div>
                </div>
              ) : !confirmed ? (
                <button className="btn primary" type="button" disabled={!canValidate} onClick={onValidate}>
                  Validate SDRF values
                </button>
              ) : null}

              {!normalizationPending && confirmed && mappedTable && (
                <div className="validation-result">
                  <div className="validation-summary">
                    <CheckCircle size={20} />
                    <div>
                      <strong>Mapping validated.</strong>
                      <p>{normalizationStatus}</p>
                    </div>
                  </div>

                  <div className="mapped-preview-table-wrap">
                    <strong className="mapping-subtitle">Mapped SDRF preview</strong>
                    <table className="mapped-preview-table">
                      <thead>
                        <tr>{mappedTable.headers.map((header) => (
                          <th key={header} className={normalizedFields.includes(header) ? "col-normalized" : ""}>
                            {header}
                            {normalizedFields.includes(header) && <span className="normalized-badge">Fixed</span>}
                          </th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {mappedTable.rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {mappedTable.headers.map((header) => (
                              <td key={header} className={normalizedFields.includes(header) ? "col-normalized" : ""}>
                                <input value={row[header] ?? ""} onChange={(event) => onCellChange(rowIndex, header, event.target.value)} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="normalization-changes-summary">
                    <strong>Note</strong>
                    <p>Columns with "Fixed" badge have been corrected by AI.</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

    </div>
  );
}

function CheckCircle({ size = 24, ...props }: { size?: number; [key: string]: unknown }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function SourceCard({ title, value, ok }: { title: string; value: string; ok: boolean }) {
  return <div className="source-card"><Folder size={20} /><strong>{title}</strong><span>{value}</span>{ok ? <Check className="ok" /> : <AlertTriangle className="warn" />}</div>;
}

function SourceInfo({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="source-info">
      <span className="source-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <em>{text}</em>
      </span>
      <i>✓</i>
    </div>
  );
}

const SDRF_MAPPING_TARGETS = [
  "source name",
  "characteristics[organism]",
  "characteristics[organism part]",
  "characteristics[disease]",
  "characteristics[biological replicate]",
  "characteristics[age]",
  "characteristics[sex]",
  "assay name",
  "comment[data file]",
  "comment[fraction identifier]",
  "comment[technical replicate]",
  "comment[label]",
  "comment[instrument]",
  "factor value[disease]",
];

function getLatestDesignFile(files: Awaited<ReturnType<typeof api.listFiles>>) {
  return files
    .filter((file) => file.file_type === "design-table")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

function getDesignHeaders(file: Awaited<ReturnType<typeof api.listFiles>>[number] | undefined): string[] {
  const headers = file?.parsed_payload?.headers;
  return Array.isArray(headers) ? headers.map(String).filter(Boolean) : [];
}

function getDesignRows(file: Awaited<ReturnType<typeof api.listFiles>>[number] | undefined): Record<string, string>[] {
  const rows = file?.parsed_payload?.rows;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value == null ? "" : String(value)])));
}

function buildParsedDesignTable(file: Awaited<ReturnType<typeof api.listFiles>>[number] | undefined): MappedDesignTable {
  return { headers: getDesignHeaders(file), rows: getDesignRows(file) };
}

function buildMappedDesignTable(sourceTable: MappedDesignTable | null, mapping: ColumnMapping): MappedDesignTable {
  const mappedPairs = Object.entries(mapping).filter(([, target]) => Boolean(target));
  const headers = Array.from(new Set(mappedPairs.map(([, target]) => target)));
  const rows = (sourceTable?.rows ?? []).map((sourceRow) => {
    const targetRow: Record<string, string> = {};
    for (const [source, target] of mappedPairs) {
      const value = sourceRow[source] ?? "";
      if (!targetRow[target]) {
        targetRow[target] = value;
      } else if (value) {
        targetRow[target] = `${targetRow[target]}; ${value}`;
      }
    }
    for (const header of headers) {
      targetRow[header] ??= "";
    }
    return targetRow;
  });
  return { headers, rows };
}

function normalizeMappingText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function emptyColumnMapping(headers: string[]): ColumnMapping {
  return Object.fromEntries(headers.map((header) => [header, ""]));
}

function normalizeAiTarget(value: string): string {
  return SDRF_MAPPING_TARGETS.includes(value) ? value : "";
}

interface ClientAiConfig {
  model: string;
}

function readClientAiConfig(): ClientAiConfig {
  const fallback = {
    model: "",
  };
  try {
    const saved = window.localStorage.getItem("sdrf-studio-ai-config");
    return saved ? { ...fallback, ...JSON.parse(saved) } : fallback;
  } catch {
    return fallback;
  }
}

async function requestDesignMapping(headers: string[], rows: Record<string, string>[], config: ClientAiConfig): Promise<AiMappingResult> {
  const payload = await api.chatCompletion({
      model: config.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You map uploaded experimental design table columns to SDRF-Proteomics columns. Use only the allowed SDRF fields. Return strict JSON only. If the file cannot be mapped, leave mappings empty and explain why.",
        },
        {
          role: "user",
          content: JSON.stringify({
            uploaded_columns: headers,
            sample_rows: rows.slice(0, 5),
            allowed_sdrf_fields: SDRF_MAPPING_TARGETS,
            output_schema: {
              mappings: [
                {
                  uploaded_column: "exact uploaded column name",
                  sdrf_field: "one allowed SDRF field or empty string",
                  reason: "brief reason for this mapping or for leaving it unmapped",
                },
              ],
              file_mapping_status: "mappable | partially_mappable | not_mappable",
              file_mapping_reason: "overall explanation, especially if not mappable",
            },
          }),
        },
      ],
  });
  const content = aiChatContent(payload);
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  const mapping = emptyColumnMapping(headers);
  const reasons: ColumnMappingReasons = {};
  const rawMappings = parsed?.mappings ?? parsed;
  const entries = Array.isArray(rawMappings)
    ? rawMappings.map((item) => ({
        source: String(item?.uploaded_column ?? item?.source_column ?? item?.column ?? ""),
        target: String(item?.sdrf_field ?? item?.target_field ?? item?.target ?? ""),
        reason: String(item?.reason ?? item?.rationale ?? ""),
      }))
    : Object.entries((rawMappings ?? {}) as Record<string, unknown>).map(([source, value]) => {
        if (value && typeof value === "object") {
          const record = value as Record<string, unknown>;
          return {
            source,
            target: String(record.sdrf_field ?? record.target_field ?? record.target ?? ""),
            reason: String(record.reason ?? record.rationale ?? ""),
          };
        }
        return { source, target: String(value ?? ""), reason: "" };
      });
  const normalizedEntries = entries.map((entry) => ({ ...entry, normalizedSource: normalizeMappingText(entry.source) }));
  for (const header of headers) {
    const entry = normalizedEntries.find((item) => item.source === header || item.normalizedSource === normalizeMappingText(header));
    mapping[header] = normalizeAiTarget(String(entry?.target ?? ""));
    if (entry?.reason) reasons[header] = entry.reason;
  }
  const fileReason = String(parsed?.file_mapping_reason ?? parsed?.reason ?? parsed?.unmappable_reason ?? "");
  return { mapping, reasons, fileReason };
}

export const SDRF_VALUE_NORMALIZATION_SYSTEM_PROMPT = [
  "You validate and normalize mapped SDRF-Proteomics table values for an experimental design file.",
  "Follow SDRF-Proteomics v1.1.0 conventions: keep the table rectangular, preserve the meaning of every mapped SDRF column, and do not invent biological facts.",
  "Normalize values only when the evidence is clear. If a value is ambiguous, keep it and report a warning.",
  "Use these field-specific rules when applicable:",
  "- source name: keep stable sample identifiers as strings; trim whitespace; do not create new sample identities.",
  "- characteristics[organism]: use a scientific species name when provided, for example Homo sapiens.",
  "- characteristics[organism part]: use a clear tissue or body-part label; normalize obvious casing only.",
  "- characteristics[age]: convert numeric ages to SDRF age values with unit Y for years, for example 24 -> 24Y. Preserve existing explicit units when they are valid.",
  "- characteristics[sex]: expand abbreviations to full lower-case values: F/female -> female, M/male -> male. Use not available only when the source is blank or explicitly unavailable.",
  "- characteristics[disease] and factor value[disease]: keep clear disease or phenotype names; normalize obvious casing only; do not invent ontology accessions.",
  "- characteristics[biological replicate], comment[technical replicate], comment[fraction identifier], comment[label]: keep concise replicate, fraction, and label identifiers; trim whitespace.",
  "- comment[data file]: keep exact file names and extensions; trim whitespace but do not rename files.",
  "Return strict JSON only. The output must include the same headers and row count as the input.",
].join("\n");

async function requestSdrfValueNormalization(table: MappedDesignTable, config: ClientAiConfig): Promise<SdrfNormalizationResult> {
  const payload = await api.chatCompletion({
      model: config.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: SDRF_VALUE_NORMALIZATION_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: JSON.stringify({
            sdrf_headers: table.headers,
            mapped_rows: table.rows,
            output_schema: {
              normalized_rows: [
                {
                  "source name": "same keys as sdrf_headers, normalized values as strings",
                },
              ],
              changes: [
                {
                  row_index: 0,
                  field: "exact SDRF field name",
                  original_value: "value before normalization",
                  normalized_value: "value after normalization",
                  severity: "info | warning | error",
                  reason: "why the value was normalized or why it remains problematic",
                },
              ],
              validation_summary: "brief summary of SDRF value conformance and remaining issues",
            },
          }),
        },
      ],
  });
  const content = aiChatContent(payload);
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  const normalizedRows = Array.isArray(parsed?.normalized_rows) ? parsed.normalized_rows : table.rows;
  const rows = normalizedRows.map((row: unknown, index: number) => {
    const record = row && typeof row === "object" ? row as Record<string, unknown> : {};
    return Object.fromEntries(table.headers.map((header) => [header, record[header] == null ? table.rows[index]?.[header] ?? "" : String(record[header])]));
  });
  const rawChanges: unknown[] = Array.isArray(parsed?.changes) ? parsed.changes : [];
  const issues = rawChanges
    .map((item: unknown): SdrfNormalizationIssue | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const field = String(record.field ?? "");
      if (!table.headers.includes(field)) return null;
      const severity = String(record.severity ?? "info");
      return {
        rowIndex: Number(record.row_index ?? record.rowIndex ?? 0),
        field,
        originalValue: String(record.original_value ?? record.originalValue ?? ""),
        normalizedValue: String(record.normalized_value ?? record.normalizedValue ?? ""),
        reason: String(record.reason ?? ""),
        severity: severity === "warning" || severity === "error" ? severity : "info",
      };
    })
    .filter((item): item is SdrfNormalizationIssue => Boolean(item));
  return {
    table: { headers: table.headers, rows },
    issues,
    summary: String(parsed?.validation_summary ?? parsed?.summary ?? ""),
  };
}

function serializeImportResults(items: ImportResultItem[]): StoredImportResultItem[] {
  return items.map(({ title, status, message, details }) => ({ title, status, message, details }));
}

function restoreStoredImportResults(items: StoredImportResultItem[] | undefined): ImportResultItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      title: cleanOneLineString(item?.title),
      status: isImportResultStatus(item?.status) ? item.status : "unknown",
      message: cleanOneLineString(item?.message),
      details: Array.isArray(item?.details) ? item.details : [],
    }))
    .filter((item) => item.title);
}

function refreshStoredImportResultUploads(
  items: ImportResultItem[],
  importState: SessionImportState,
  uploadedFiles: Awaited<ReturnType<typeof api.listFiles>> = [],
): ImportResultItem[] {
  if (!items.length) return items;
  const accession = (importState.prideAccession || importState.activeImportAccession || importState.accession || "").toUpperCase();
  const currentPdf = getCurrentPublicationPdf(getUploadedPublicationPdfs(uploadedFiles, accession));
  return items.map((item) => {
    if (item.title !== "Publication PDF or full text") return item;
    return {
      ...item,
      status: currentPdf ? "ok" : item.status,
      message: currentPdf ? "A publication PDF was uploaded successfully and is available for analysis." : item.message,
      details: refreshPublicationPdfUploadSections(item.details, currentPdf),
    };
  });
}

function refreshPublicationPdfUploadSections(
  details: DetailSection[],
  currentPdf: Awaited<ReturnType<typeof api.listFiles>>[number] | undefined,
): DetailSection[] {
  const uploadFallback = details.find((section): section is Extract<DetailSection, { kind: "upload" }> => section.kind === "upload" && section.mode === "pdf");
  const refreshedUpload: DetailSection = {
    kind: "upload",
    title: uploadFallback?.title ?? "Publication PDF",
    label: currentPdf ? "Replace PDF" : uploadFallback?.label ?? "Upload PDF",
    accept: uploadFallback?.accept ?? "application/pdf,.pdf",
    mode: "pdf",
    actions: currentPdf ? getUploadedPdfActions([currentPdf]) : uploadFallback?.actions,
    note: currentPdf ? "Uploading another PDF will replace the current PDF used for this accession." : uploadFallback?.note,
  };
  const refreshedDetails = details
    .filter((section) => !(section.kind === "table" && section.title === "Current uploaded publication PDF"))
    .map((section) => section.kind === "upload" && section.mode === "pdf" ? refreshedUpload : section);
  if (!currentPdf) return refreshedDetails;
  const currentPdfSection = currentPublicationPdfDetailSection(currentPdf);
  const existingIndex = refreshedDetails.findIndex((section) => section.kind === "table" && section.title === "Resolved publications");
  if (existingIndex < 0) return [currentPdfSection, ...refreshedDetails];
  return [
    ...refreshedDetails.slice(0, existingIndex + 1),
    currentPdfSection,
    ...refreshedDetails.slice(existingIndex + 1),
  ];
}

function isImportResultStatus(value: unknown): value is ImportResultItem["status"] {
  return value === "ok" || value === "missing" || value === "unknown";
}

function buildSessionPrideImportResults(
  importState: SessionImportState,
  uploadedFiles: Awaited<ReturnType<typeof api.listFiles>> = [],
): ImportResultItem[] {
  const accession = (importState.prideAccession || importState.activeImportAccession || importState.accession || "").toUpperCase();
  const hasSavedPrideImport = Boolean(accession || importState.prideTitle || importState.importedAt);
  if (!hasSavedPrideImport) return [];
  const fileCount = importState.rawFileCount ?? 0;
  const publicationCount = importState.publicationCount ?? 0;
  const uploadedPublicationPdf = getUploadedPublicationPdfs(uploadedFiles, accession).length > 0;
  return [
    {
      title: "Project metadata",
      status: importState.prideTitle || importState.prideOrganisms?.length || importState.prideInstruments?.length ? "ok" : "unknown",
      message: importState.prideTitle ? "Saved PRIDE project metadata is available." : "Saved PRIDE project metadata is limited.",
      details: [{
        kind: "kv" as const,
        title: "Saved project fields",
        rows: [
          { label: "Accession", value: accession },
          { label: "Title", value: importState.prideTitle },
          { label: "Description", value: importState.prideDescription },
          { label: "Organisms", value: (importState.prideOrganisms ?? []).join("\n") },
          { label: "Instruments", value: (importState.prideInstruments ?? []).join("\n") },
          { label: "Keywords", value: (importState.prideKeywords ?? []).join("\n") },
          { label: "Imported at", value: importState.importedAt },
        ],
      }],
    },
    {
      title: "File list",
      status: fileCount > 0 ? "ok" : "unknown",
      message: fileCount > 0 ? `${fileCount} PRIDE file record(s) were saved in this session.` : "No saved PRIDE file count is available.",
      details: [{
        kind: "kv" as const,
        title: "Saved file summary",
        rows: [
          { label: "File count", value: fileCount || undefined },
        ],
      }],
    },
    {
      title: "Publication PDF or full text",
      status: publicationCount > 0 || uploadedPublicationPdf ? "ok" : "missing",
      message: uploadedPublicationPdf
        ? "A publication PDF has been uploaded for this import."
        : publicationCount > 0
          ? `${publicationCount} publication reference(s) were saved from PRIDE metadata.`
          : "No publication reference was saved from PRIDE metadata.",
      details: [{
        kind: "kv" as const,
        title: "Saved publication summary",
        rows: [
          { label: "Publication references", value: publicationCount || undefined },
          { label: "Uploaded publication PDF", value: uploadedPublicationPdf ? "Yes" : "No" },
        ],
      }, {
        kind: "upload" as const,
        title: "Upload publication PDF or full text",
        label: "Upload publication PDF",
        accept: ".pdf",
        mode: "pdf",
      }],
    },
    {
      title: "Experimental design details",
      status: "missing",
      message: "Sample grouping, factors, fractions or replicate details may need a design sheet.",
      details: [{
        kind: "kv" as const,
        rows: [
          { label: "Needed from user", value: "Sample groups, conditions, biological replicates, fractions, channels, assay runs and data-file mapping." },
          { label: "Accepted formats", value: "CSV, TSV, TXT, XLSX or XLS." },
        ],
      }, { kind: "upload" as const, title: "Upload experimental design file", label: "Upload design file", accept: ".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.xlx", mode: "design" }],
    },
  ];
}

function buildPrideImportResults(
  payload: unknown,
  failed: boolean,
  uploadedFiles: Awaited<ReturnType<typeof api.listFiles>> = [],
  currentAccession = "",
): ImportResultItem[] {
  const data = (payload ?? {}) as {
    accession?: string;
    project?: Record<string, unknown>;
    files?: Record<string, unknown>;
    project_error?: string;
    files_error?: string;
    project_source?: string;
    files_source?: string;
    files_attempts?: unknown;
  };
  const projectOk = Boolean(data.project) && !data.project_error;
  const filesOk = Boolean(data.files) && !data.files_error;
  const fileCount = getPrideFileCount(data.files);
  const publications = getProjectPublications(data.project);
  const publicationActions = getPublicationActions(publications);
  const accession = (currentAccession || String(data.accession ?? data.project?.accession ?? "")).toUpperCase();
  const uploadedPublicationPdfs = getUploadedPublicationPdfs(uploadedFiles, accession);
  const uploadedPublicationPdf = uploadedPublicationPdfs.length > 0;
  const publicationReady = hasDownloadedPublicationPdf(publications) || uploadedPublicationPdf;
  const publicationMessage = getPublicationMessage(data.project, publications, uploadedPublicationPdf);
  const supplementaryFiles = getSupplementaryFiles(data.files);
  return [
    {
      title: "Project metadata",
      status: projectOk ? "ok" : "missing",
      message: projectOk ? "Project title, description and public metadata were retrieved." : data.project_error || (failed ? "Unable to retrieve project metadata." : "Not retrieved yet."),
      details: projectOk ? projectDetailRows(data.project, data.project_source) : errorDetailRows(data.project_error, data.project_source),
    },
    {
      title: "File list",
      status: filesOk ? "ok" : "missing",
      message: filesOk ? `${fileCount} project files were found or the file endpoint returned metadata.` : data.files_error || (failed ? "Unable to retrieve file list." : "Not retrieved yet."),
      details: filesOk ? fileDetailRows(data.files, data.files_source) : errorDetailRows(data.files_error, data.files_source, data.files_attempts),
    },
    {
      title: "Publication PDF or full text",
      status: publicationReady ? "ok" : "missing",
      message: publicationMessage,
      details: publicationDetailRows(data.project, uploadedFiles, accession),
    },
    {
      title: "Supplementary files",
      status: supplementaryFiles.length ? "ok" : "missing",
      message: supplementaryFiles.length ? `${supplementaryFiles.length} non-raw file(s) may contain metadata, SDRF, search results or supplementary tables.` : "No supplementary files were found in the PRIDE file list.",
      details: supplementaryFiles.length
        ? [
            {
              kind: "table" as const,
              title: "Supplementary/other files",
              columns: [
                { key: "fileName", label: "File name" },
                { key: "category", label: "Category" },
                { key: "size", label: "Size" },
              ],
              rows: getFileRecords(data.files).filter((record) => !String(record.category ?? "").includes("RAW")).slice(0, 60),
            },
            {
              kind: "kv" as const,
              rows: [{ label: "What we use them for", value: "Search for result tables, sample metadata, FASTA/search outputs and supporting experiment design information." }],
            },
            { kind: "upload" as const, title: "Upload additional supplementary files", label: "Upload supplementary files", accept: ".csv,.tsv,.xlsx,.xlsm,.txt,.pdf", mode: "supplementary" },
          ]
        : [
            { kind: "kv" as const, rows: [{ label: "What to provide", value: "Upload tables, metadata files, protocols or supplementary materials if they are not present in PRIDE." }] },
            { kind: "upload" as const, title: "Upload supplementary files", label: "Upload supplementary files", accept: ".csv,.tsv,.xlsx,.xlsm,.txt,.pdf", mode: "supplementary" },
          ],
    },
    {
      title: "Experimental design details",
      status: "missing",
      message: "Sample grouping, factors, fractions or replicate details may need a design sheet.",
      details: [{
        kind: "kv" as const,
        rows: [
          { label: "Needed from user", value: "Sample groups, conditions, biological replicates, fractions, channels, assay runs and data-file mapping." },
          { label: "Accepted formats", value: "CSV, TSV, TXT, XLSX or XLS." },
        ],
      }, { kind: "upload" as const, title: "Upload experimental design file", label: "Upload design file", accept: ".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.xlx", mode: "design" }],
    },
  ];
}

function DetailSections({
  sections,
  uploadPending = false,
  onUpload,
}: {
  sections: DetailSection[];
  uploadPending?: boolean;
  onUpload?: (mode: "pdf" | "design" | "supplementary", file: File) => void;
}) {
  return (
    <div className="detail-sections">
      {sections.map((section, index) => (
        <section key={`${section.kind}-${section.title ?? index}`} className="detail-section">
          {section.title && <h4>{section.title}</h4>}
          {section.kind === "kv" && <KeyValueTable rows={section.rows} />}
          {section.kind === "table" && <StructuredTable columns={section.columns} rows={section.rows} />}
          {section.kind === "actions" && (
            <div className="detail-actions">
              {section.actions.map((action) => (
                <a key={action.href} className="btn ghost" href={action.href} target="_blank" rel="noreferrer">
                  {action.label} <ExternalLink size={14} />
                </a>
              ))}
            </div>
          )}
          {section.kind === "upload" && (
            <div className="detail-upload-row">
              <label className="btn ghost file-action detail-upload-btn">
                {uploadPending ? "Uploading..." : section.label}
                <input
                  type="file"
                  accept={section.accept}
                  disabled={uploadPending}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file && onUpload) onUpload(section.mode, file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {(section.actions ?? []).map((action) => (
                <a key={action.href} className="btn ghost" href={action.href} target="_blank" rel="noreferrer">
                  {action.label} <ExternalLink size={14} />
                </a>
              ))}
              {section.note && <span className="detail-upload-note">{section.note}</span>}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function KeyValueTable({ rows }: { rows: { label: string; value: DetailValue }[] }) {
  const visible = rows.filter((row) => String(row.value ?? "").trim());
  if (!visible.length) return <p className="muted">No details available.</p>;
  return (
    <table className="detail-kv-table">
      <tbody>
        {visible.map((row) => (
          <tr key={row.label}>
            <th>{row.label}</th>
            <td>{formatDetailValue(row.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StructuredTable({ columns, rows }: { columns: { key: string; label: string }[]; rows: DetailRow[] }) {
  if (!rows.length) return <p className="muted">No records available.</p>;
  return (
    <div className="detail-table-wrap">
      <table className="detail-data-table">
        <thead>
          <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id ?? row.fileName ?? index)}>
              {columns.map((column) => <td key={column.key}>{formatDetailValue(row[column.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function projectDetailRows(project: Record<string, unknown> | undefined, source?: string): DetailSection[] {
  if (!project) return [{ kind: "kv", rows: [{ label: "Status", value: "No project metadata retrieved." }] }];
  const rows = [
    { label: "Source", value: source || "PRIDE project endpoint" },
    { label: "Accession", value: pickString(project, ["accession", "projectAccession"]) },
    { label: "Title", value: pickString(project, ["title", "projectTitle"]) },
    { label: "Description", value: pickString(project, ["description", "projectDescription"]) },
    { label: "Sample processing protocol", value: pickString(project, ["sample_processing_protocol", "sampleProcessingProtocol"]) },
    { label: "Data processing protocol", value: pickString(project, ["data_processing_protocol", "dataProcessingProtocol"]) },
    { label: "Organisms", value: stringifyCompact(project.organism ?? project.organisms ?? project.organismNames ?? project.species) },
    { label: "Instruments", value: stringifyCompact(project.instruments ?? project.instrumentNames) },
    { label: "Modifications", value: stringifyCompact(project.modifications) },
    { label: "Publications", value: stringifyCompact(project.publications ?? project.doi ?? project.pubmedId ?? project.publication) },
    { label: "Keywords", value: stringifyCompact(project.keywords) },
  ];
  return [{ kind: "kv", title: "Project fields", rows }];
}

function fileDetailRows(files: Record<string, unknown> | undefined, source?: string): DetailSection[] {
  const records = getFileRecords(files);
  return [
    {
      kind: "kv",
      title: "File list summary",
      rows: [
        { label: "Source", value: source || "PRIDE file endpoint" },
        { label: "File count", value: getPrideFileCount(files) },
        { label: "Raw-like file count", value: Number(files?.rawfile_count ?? 0) },
        { label: "FTP root", value: String(files?.ftp_root_url ?? "") },
      ],
    },
    {
      kind: "table",
      title: "Files detected",
      columns: [
        { key: "fileName", label: "File name" },
        { key: "category", label: "Category" },
        { key: "size", label: "Size" },
      ],
      rows: records.slice(0, 60),
    },
  ];
}

function publicationDetailRows(
  project: Record<string, unknown> | undefined,
  uploadedFiles: Awaited<ReturnType<typeof api.listFiles>> = [],
  currentAccession = "",
): DetailSection[] {
  const publications = getProjectPublications(project);
  const uploadedPdfs = getUploadedPublicationPdfs(uploadedFiles, currentAccession || pickString(project ?? {}, ["accession"]));
  const currentPdf = getCurrentPublicationPdf(uploadedPdfs);
  if (!publications.length) {
    return [{
      kind: "kv",
      rows: [
        { label: "Status", value: "No publication reference was found in PRIDE metadata." },
        { label: "What to provide", value: "Please upload the publication PDF, full-text file or supplementary methods manually." },
      ],
    }];
  }
  const actions = getPublicationActions(publications);
  return [
    {
      kind: "table",
      title: "Resolved publications",
      columns: [
        { key: "title", label: "Title" },
        { key: "doi", label: "DOI" },
        { key: "pmid", label: "PMID" },
        { key: "pmcid", label: "PMCID" },
        { key: "is_open_access", label: "Open access" },
        { key: "access_status", label: "Access status" },
        { key: "access_message", label: "Message" },
      ],
      rows: publications.map((item, index) => normalizePublication(item, index)),
    },
    ...(currentPdf
      ? [currentPublicationPdfDetailSection(currentPdf)]
      : []),
    ...(actions.length ? [{ kind: "actions" as const, title: "Available actions", actions }] : []),
    { kind: "kv", rows: [{ label: "What to provide", value: "If no PDF can be downloaded automatically, use the journal page above to download the article PDF, then upload it here." }] },
    {
      kind: "upload",
      title: "Publication PDF",
      label: currentPdf ? "Replace PDF" : "Upload PDF",
      accept: "application/pdf,.pdf",
      mode: "pdf",
      actions: currentPdf ? getUploadedPdfActions([currentPdf]) : [],
      note: currentPdf ? "Uploading another PDF will replace the current PDF used for this accession." : undefined,
    },
  ];
}

function currentPublicationPdfDetailSection(currentPdf: Awaited<ReturnType<typeof api.listFiles>>[number]): DetailSection {
  return {
    kind: "table",
    title: "Current uploaded publication PDF",
    columns: [
      { key: "filename", label: "File name" },
      { key: "size", label: "Size" },
      { key: "status", label: "Status" },
    ],
    rows: [{ filename: currentPdf.filename, size: formatBytes(currentPdf.size_bytes), status: currentPdf.parse_status }],
  };
}

function errorDetailRows(error?: string, source?: string, attempts?: unknown): DetailSection[] {
  return [{
    kind: "kv",
    rows: [
      { label: "Status", value: "Not retrieved" },
      { label: "Source", value: source || "PRIDE endpoint" },
      { label: "Reason", value: error || "No details available." },
      { label: "Attempts", value: stringifyCompact(attempts) },
    ],
  }];
}

function getPrideFileCount(files: Record<string, unknown> | undefined): number {
  if (typeof files?.total_file_count === "number") return files.total_file_count;
  const fileNames = getPrideFiles(files);
  if (fileNames.length) return fileNames.length;
  const embedded = files?._embedded as { files?: unknown[] } | undefined;
  if (Array.isArray(embedded?.files)) return embedded.files.length;
  if (Array.isArray(files?.files)) return files.files.length;
  if (Array.isArray(files?.list)) return files.list.length;
  const page = files?.page as { totalElements?: number } | undefined;
  return Number(page?.totalElements ?? 0);
}

function getPrideFiles(files: Record<string, unknown> | undefined): string[] {
  if (!files) return [];
  const normalized = [...getRawFiles(files), ...getSupplementaryFiles(files)];
  if (normalized.length) return normalized.filter((name) => !isSdrfLikeFileName(name));
  const embedded = files._embedded as { files?: { fileName?: string; name?: string; fileNameSubmitted?: string }[] } | undefined;
  const candidates = embedded?.files ?? (Array.isArray(files.files) ? files.files : []) ?? (Array.isArray(files.list) ? files.list : []);
  if (!Array.isArray(candidates)) return [];
  return candidates
    .map((file) => {
      if (typeof file === "string") return file;
      if (!file || typeof file !== "object") return "";
      const item = file as { fileName?: string; name?: string; fileNameSubmitted?: string };
      return item.fileName || item.name || item.fileNameSubmitted || "";
    })
    .filter((name) => Boolean(name) && !isSdrfLikeFileName(name));
}

function getFileRecords(files: Record<string, unknown> | undefined): DetailRow[] {
  const records = files?.file_records;
  if (Array.isArray(records) && records.length) {
    return records
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .filter((item) => !isSdrfLikeFileName(String(item.fileName ?? item.name ?? "")))
      .map(normalizeFileRecord);
  }
  return getPrideFiles(files).map((name) => ({ fileName: name, category: inferFileCategory(name), size: "" }));
}

function normalizeFileRecord(record: Record<string, unknown>): DetailRow {
  return {
    fileName: String(record.fileName ?? record.name ?? ""),
    category: String(record.category ?? ""),
    size: formatBytes(record.sizeBytes),
    downloadUrl: String(record.downloadUrl ?? ""),
  };
}

function normalizePublication(item: unknown, index: number): DetailRow {
  if (!item || typeof item !== "object") return { id: index, title: stringifyCompact(item) };
  const record = item as Record<string, unknown>;
  return {
    id: index,
    title: String(record.title ?? record.reference ?? ""),
    doi: String(record.doi ?? ""),
    pmid: String(record.pmid ?? ""),
    pmcid: String(record.pmcid ?? ""),
    is_open_access: record.is_open_access === true ? "Yes" : record.is_open_access === false ? "No" : "",
    access_status: publicationStatusLabel(String(record.access_status ?? "")),
    access_message: String(record.access_message ?? ""),
  };
}

function getPublicationActions(publications: unknown[]): { label: string; href: string }[] {
  return publications.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const title = shortActionTitle(String(record.title ?? record.reference ?? `Publication ${index + 1}`));
    if (typeof record.pdf_view_url === "string" && record.pdf_view_url) {
      return [{ label: `Download PDF: ${title}`, href: `${api.baseUrl}${record.pdf_view_url}` }];
    }
    const articleUrl = String(record.article_url ?? record.doi_url ?? record.pubmed_url ?? "");
    if (articleUrl) {
      return [{ label: `Open journal page: ${title}`, href: articleUrl }];
    }
    return [];
  });
}

function getUploadedPublicationPdfs(files: Awaited<ReturnType<typeof api.listFiles>>, accession = "") {
  const normalizedAccession = accession.toUpperCase();
  return files.filter((file) => {
    if (file.file_type !== "publication-pdf") return false;
    if (!normalizedAccession) return true;
    return file.filename.toUpperCase().includes(normalizedAccession);
  }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function getCurrentPublicationPdf(files: Awaited<ReturnType<typeof api.listFiles>>) {
  return files[0];
}

function getUploadedPdfActions(files: Awaited<ReturnType<typeof api.listFiles>>): { label: string; href: string }[] {
  return files.map((file) => ({
    label: `View uploaded PDF: ${shortActionTitle(file.filename)}`,
    href: `${api.baseUrl}/api/projects/${file.project_id}/files/${file.id}/preview`,
  }));
}

function hasDownloadedPublicationPdf(publications: unknown[]): boolean {
  return publications.some((item) => Boolean(item && typeof item === "object" && (item as Record<string, unknown>).pdf_view_url));
}

function getPublicationMessage(project: Record<string, unknown> | undefined, publications: unknown[], uploadedPublicationPdf: boolean): string {
  if (uploadedPublicationPdf) {
    return "A publication PDF was uploaded successfully and is available for analysis.";
  }
  if (!publications.length) {
    return "No publication reference or article address was found in PRIDE metadata. Please upload the PDF manually.";
  }
  const summary = project?.publication_access_summary as Record<string, unknown> | undefined;
  const downloaded = Number(summary?.downloaded_pdfs ?? 0);
  const publisherLinks = Number(summary?.publisher_links ?? 0);
  const unresolved = Number(summary?.unresolved ?? 0);
  if (downloaded > 0) return `${publications.length} publication reference(s) were resolved. ${downloaded} open-access PDF(s) were downloaded automatically.`;
  if (publisherLinks > 0) return `${publications.length} publication reference(s) were resolved, but PDF access is not open. Use the journal link to download it, then upload the PDF here.`;
  if (unresolved > 0) return `${publications.length} publication reference(s) were found, but no downloadable PDF or journal URL was resolved. Please upload the PDF manually.`;
  return `${publications.length} publication reference(s) were resolved from PRIDE metadata.`;
}

function publicationStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    open_access_pdf_downloaded: "Open access PDF downloaded",
    open_access_pdf_error: "Open access PDF failed",
    open_access_pdf_unavailable: "Open access, no direct PDF",
    open_access: "Open access",
    publisher_access: "Publisher/journal access",
    not_resolved: "Not resolved",
  };
  return labels[status] ?? status;
}

function shortActionTitle(value: string): string {
  return value.length > 56 ? `${value.slice(0, 53)}...` : value;
}

function renamePublicationPdf(file: File, accession: string): File {
  const normalizedAccession = accession.toUpperCase();
  if (!normalizedAccession || file.name.toUpperCase().includes(normalizedAccession)) return file;
  return new File([file], `${normalizedAccession}_${file.name}`, { type: file.type || "application/pdf", lastModified: file.lastModified });
}

function inferFileCategory(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("sdrf")) return "SDRF";
  if (/\.(raw|wiff2?|mzml|mzxml|lcd|baf|tdf|tsf)(\.|$)/i.test(lower)) return "RAW-like";
  return "Other";
}

function getRawFiles(files: Record<string, unknown> | undefined): string[] {
  return Array.isArray(files?.raw_file_names) ? files.raw_file_names.map(String).filter((name) => !isSdrfLikeFileName(name)) : [];
}

function getSupplementaryFiles(files: Record<string, unknown> | undefined): string[] {
  return Array.isArray(files?.other_files_names) ? files.other_files_names.map(String).filter((name) => !isSdrfLikeFileName(name)) : [];
}

function getProjectPublications(project: Record<string, unknown> | undefined): unknown[] {
  return Array.isArray(project?.publications) ? project.publications : [];
}

function pickString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}

function stringifyCompact(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => stringifyCompact(item)).filter(Boolean).slice(0, 20).join("\n");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2).slice(0, 1600);
  }
  return String(value);
}

function formatDetailValue(value: DetailValue): string {
  if (value == null || value === "") return "";
  return String(value);
}

function formatBytes(value: unknown): string {
  const bytes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function ImportRightRail() {
  return (
    <div className="right-rail-shell">
      <div className="right-rail-scroll">
        <Panel title="What will be imported?">
          <ol className="import-flow-list">
            <li><span>1</span><div><strong>Fetch from PRIDE Archive</strong><p>Retrieve project metadata and file list</p></div></li>
            <li><span>2</span><div><strong>Analyze automatically</strong><p>System detects experiment type, files and patterns</p></div></li>
            <li><span>3</span><div><strong>Fill core entities</strong><p>Review Samples, Blueprint, Files and Assays</p></div></li>
            <li><span>4</span><div><strong>Review & refine</strong><p>You confirm or correct uncertain items</p></div></li>
            <li><span>5</span><div><strong>Validate & export</strong><p>Ensure SDRF compliance and export</p></div></li>
          </ol>
        </Panel>
        <Panel title="Tips for better accuracy">
          <ul className="tips-list">
            <li><Check size={16} /> Check the import summary carefully.</li>
            <li><Check size={16} /> Confirm detected experiment type in the next step.</li>
            <li><Check size={16} /> Review uncertain mappings and ontology terms.</li>
            <li><Check size={16} /> Resolve all validation issues before export.</li>
          </ul>
        </Panel>
        <Panel title="Need help?">
          <p className="muted">Learn more about PRIDE, SDRF and best practices.</p>
          <button className="btn ghost" type="button">Open documentation <ExternalLink size={14} /></button>
        </Panel>
      </div>
    </div>
  );
}

function MiniIcon({ label }: { label: string }) {
  return <span className="mini-icon">{label}</span>;
}

function FileList({ files }: { files: Awaited<ReturnType<typeof api.listFiles>> }) {
  const visibleFiles = nonSdrfUploadedFiles(files);
  return (
    <div className="file-list">
      {visibleFiles.map((file) => <div key={file.id}><FileText size={16} /><span>{file.filename}</span><em>{file.file_type}</em></div>)}
    </div>
  );
}

function IssueList({ issues }: { issues: { severity: string; message: string; column?: string | null; row?: number | null; suggested_fix?: string }[] }) {
  if (!issues.length) return <p className="muted">No validation issues reported yet.</p>;
  return (
    <div className="issue-list">
      {issues.map((issue, index) => (
        <article key={`${issue.message}-${index}`} className={`issue ${issue.severity}`}>
          <strong>{issue.severity}</strong>
          <span>{issue.message}</span>
          <small>{issue.column ? `Column: ${issue.column}` : ""}{issue.row != null ? ` Row: ${issue.row + 1}` : ""}</small>
          {issue.suggested_fix && <em>{issue.suggested_fix}</em>}
        </article>
      ))}
    </div>
  );
}
