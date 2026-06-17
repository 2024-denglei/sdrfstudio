CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  pride_accession VARCHAR(50),
  current_step VARCHAR(50) NOT NULL DEFAULT 'import',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename VARCHAR(512) NOT NULL,
  content_type VARCHAR(255) NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  path TEXT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  parse_status VARCHAR(50) NOT NULL DEFAULT 'uploaded',
  extracted_text TEXT NOT NULL DEFAULT '',
  parsed_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_evidence (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_type VARCHAR(80) NOT NULL,
  source_ref VARCHAR(512) NOT NULL DEFAULT '',
  field VARCHAR(255) NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  payload JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(50) NOT NULL DEFAULT 'suggested',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sdrf_tables (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  headers JSONB NOT NULL DEFAULT '[]',
  rows JSONB NOT NULL DEFAULT '[]',
  column_metadata JSONB NOT NULL DEFAULT '{}',
  dirty BOOLEAN NOT NULL DEFAULT FALSE,
  validation_state JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS blueprint_nodes (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  layer VARCHAR(80) NOT NULL,
  label VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  status VARCHAR(50) NOT NULL DEFAULT 'suggested'
);

CREATE TABLE IF NOT EXISTS mapping_edges (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id VARCHAR(36) NOT NULL,
  target_id VARCHAR(36) NOT NULL,
  relation VARCHAR(80) NOT NULL DEFAULT 'maps_to',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  status VARCHAR(50) NOT NULL DEFAULT 'suggested'
);

CREATE TABLE IF NOT EXISTS assistant_questions (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step VARCHAR(80) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  severity VARCHAR(50) NOT NULL DEFAULT 'medium',
  suggested_actions JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS validation_results (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  issues JSONB NOT NULL DEFAULT '[]',
  summary JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS export_records (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  export_type VARCHAR(50) NOT NULL DEFAULT 'sdrf-tsv',
  path TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS job_records (
  id VARCHAR(80) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind VARCHAR(80) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  result JSONB NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_project_id ON uploaded_files(project_id);
CREATE INDEX IF NOT EXISTS idx_analysis_evidence_project_id ON analysis_evidence(project_id);
CREATE INDEX IF NOT EXISTS idx_blueprint_nodes_project_id ON blueprint_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_mapping_edges_project_id ON mapping_edges(project_id);
CREATE INDEX IF NOT EXISTS idx_assistant_questions_project_id ON assistant_questions(project_id);
CREATE INDEX IF NOT EXISTS idx_validation_results_project_id ON validation_results(project_id);
CREATE INDEX IF NOT EXISTS idx_export_records_project_id ON export_records(project_id);
