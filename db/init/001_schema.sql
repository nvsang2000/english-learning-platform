CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS courses (
  slug text PRIMARY KEY,
  title_vi text NOT NULL,
  target_level text NOT NULL,
  duration_weeks integer NOT NULL CHECK (duration_weeks BETWEEN 1 AND 52),
  description_vi text NOT NULL,
  curriculum jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel = 'telegram'),
  external_user_id text NOT NULL,
  display_name text,
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  response_language text NOT NULL DEFAULT 'vi' CHECK (response_language = 'vi'),
  notification_enabled boolean NOT NULL DEFAULT true,
  notification_time time NOT NULL DEFAULT '07:00',
  micro_learning_enabled boolean NOT NULL DEFAULT true,
  micro_learning_interval_minutes integer NOT NULL DEFAULT 30 CHECK (micro_learning_interval_minutes = 30),
  micro_learning_start time NOT NULL DEFAULT '07:30',
  micro_learning_end time NOT NULL DEFAULT '22:00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_user_id)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_slug text NOT NULL REFERENCES courses(slug),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  current_level text NOT NULL,
  daily_minutes integer NOT NULL CHECK (daily_minutes BETWEEN 10 AND 180),
  start_date date NOT NULL,
  target_date date,
  target_score text,
  start_week integer NOT NULL DEFAULT 1 CHECK (start_week >= 1),
  skill_scores jsonb NOT NULL DEFAULT '{"vocabulary":0,"grammar":0,"reading":0,"listening":0,"speaking":0,"writing":0}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_enrollment_per_learner
  ON enrollments (learner_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS daily_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  lesson_date date NOT NULL,
  week_number integer NOT NULL,
  day_number integer NOT NULL CHECK (day_number BETWEEN 1 AND 7),
  title_vi text NOT NULL,
  objectives jsonb NOT NULL,
  lesson_plan jsonb NOT NULL,
  exercises jsonb NOT NULL,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed', 'skipped')),
  score numeric(5,2) CHECK (score BETWEEN 0 AND 100),
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses jsonb NOT NULL DEFAULT '[]'::jsonb,
  learner_note text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, lesson_date)
);

CREATE TABLE IF NOT EXISTS progress_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  enrollment_id uuid REFERENCES enrollments(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES daily_lessons(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES daily_lessons(id) ON DELETE CASCADE,
  notification_date date NOT NULL,
  notification_type text NOT NULL DEFAULT 'daily_lesson',
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'sending', 'sent', 'retry', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learner_id, notification_date, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_daily_lessons_learner_date ON daily_lessons (learner_id, lesson_date DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_delivery ON notification_outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_progress_learner_created ON progress_events (learner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS micro_learning_items (
  id bigserial PRIMARY KEY,
  item_key text NOT NULL UNIQUE,
  min_level text NOT NULL DEFAULT 'A1',
  english_text text NOT NULL,
  vietnamese_meaning text NOT NULL,
  example_en text NOT NULL,
  example_vi text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_micro_learning_items_active ON micro_learning_items (active, id);
