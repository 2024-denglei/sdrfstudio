export type StepKey =
  | "import"
  | "ai-analysis"
  | "blueprint"
  | "samples"
  | "files"
  | "ai-review"
  | "validation"
  | "export";

export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  pride_accession: string | null;
  current_step: StepKey;
  created_at: string;
  updated_at: string;
}

export interface UploadedFile {
  id: string;
  project_id: string;
  filename: string;
  content_type: string;
  file_type: string;
  sha256: string;
  size_bytes: number;
  parse_status: string;
  parsed_payload: Record<string, unknown>;
  created_at: string;
}

export interface EvidenceItem {
  id: string;
  source_type: string;
  source_ref: string;
  field: string;
  value: string;
  confidence: number;
  payload: Record<string, unknown>;
  status: string;
}

export interface AssistantQuestion {
  id: string;
  step: StepKey | string;
  title: string;
  message: string;
  severity: "low" | "medium" | "high" | string;
  suggested_actions: string[];
  status: string;
  payload: Record<string, unknown>;
}

export interface BlueprintNode {
  id: string;
  layer: "sample" | "preparation" | "assay" | "file";
  label: string;
  payload: Record<string, unknown>;
  confidence: number;
  status: string;
}

export interface MappingEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  confidence: number;
  status: string;
}

export interface Blueprint {
  nodes: BlueprintNode[];
  edges: MappingEdge[];
}

export interface Analysis {
  evidences: EvidenceItem[];
  questions: AssistantQuestion[];
  blueprint: Blueprint;
  summary: Record<string, number | string>;
}

export interface SdrfTable {
  id: string | null;
  project_id: string;
  headers: string[];
  rows: Record<string, string>[];
  column_metadata: Record<string, { section: string; required?: boolean }>;
  dirty: boolean;
  validation_state: Record<string, unknown>;
}

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  message: string;
  row?: number | null;
  column?: string | null;
  rule: string;
  suggested_fix: string;
}

export interface ValidationResult {
  id: string;
  status: string;
  issues: ValidationIssue[];
  summary: Record<string, number | string>;
}

export interface ExportRecord {
  id: string;
  export_type: string;
  path: string;
  payload: { download?: string };
}
