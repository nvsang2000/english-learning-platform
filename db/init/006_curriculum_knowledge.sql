CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS curriculum_ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_root text NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed')),
  files_seen integer NOT NULL DEFAULT 0,
  files_imported integer NOT NULL DEFAULT 0,
  files_skipped integer NOT NULL DEFAULT 0,
  chunks_created integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS curriculum_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_path text NOT NULL UNIQUE,
  source_type text NOT NULL CHECK (source_type IN ('docx', 'xlsx', 'png')),
  checksum_sha256 text NOT NULL,
  title text NOT NULL,
  level text,
  skill text NOT NULL CHECK (skill IN (
    'grammar', 'vocabulary', 'reading', 'listening', 'speaking',
    'writing', 'pronunciation', 'mixed'
  )),
  exam text,
  access_scope text NOT NULL DEFAULT 'learner'
    CHECK (access_scope IN ('learner', 'answer_key')),
  review_status text NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed', 'approved', 'rejected')),
  extraction_status text NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'ready', 'failed')),
  extraction_error text,
  extracted_text text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  imported_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_curriculum_sources_filters
  ON curriculum_sources (active, access_scope, level, skill, exam);
CREATE INDEX IF NOT EXISTS idx_curriculum_sources_checksum
  ON curriculum_sources (checksum_sha256);

CREATE TABLE IF NOT EXISTS curriculum_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES curriculum_sources(id) ON DELETE CASCADE,
  unit_key text NOT NULL,
  unit_index integer NOT NULL CHECK (unit_index >= 0),
  unit_type text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, unit_key)
);

CREATE INDEX IF NOT EXISTS idx_curriculum_units_source_order
  ON curriculum_units (source_id, unit_index);

CREATE TABLE IF NOT EXISTS curriculum_chunks (
  id bigserial PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES curriculum_units(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL,
  token_estimate integer NOT NULL CHECK (token_estimate > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector,
  embedding_model text,
  embedding_dimensions integer,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(content, ''))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_curriculum_chunks_search
  ON curriculum_chunks USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_curriculum_chunks_trigram
  ON curriculum_chunks USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_curriculum_chunks_embedding_model
  ON curriculum_chunks (embedding_model, embedding_dimensions)
  WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS curriculum_question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES curriculum_units(id) ON DELETE CASCADE,
  question_number text,
  prompt text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_answer text,
  explanation_vi text,
  difficulty text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_curriculum_question_bank_unit
  ON curriculum_question_bank (unit_id);

COMMENT ON TABLE curriculum_sources IS
  'Canonical inventory of imported DOCX, XLSX and PNG curriculum files.';
COMMENT ON COLUMN curriculum_sources.access_scope IS
  'answer_key sources are excluded from ordinary learner retrieval.';
COMMENT ON COLUMN curriculum_sources.review_status IS
  'Imported content remains unreviewed until a qualified teacher approves it.';
