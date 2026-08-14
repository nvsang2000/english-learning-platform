ALTER TABLE learners
  ALTER COLUMN timezone SET DEFAULT 'Asia/Ho_Chi_Minh',
  ALTER COLUMN notification_time SET DEFAULT '07:00';

ALTER TABLE learners
  ADD COLUMN IF NOT EXISTS micro_learning_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS micro_learning_interval_minutes integer NOT NULL DEFAULT 30
    CHECK (micro_learning_interval_minutes = 30),
  ADD COLUMN IF NOT EXISTS micro_learning_start time NOT NULL DEFAULT '07:30',
  ADD COLUMN IF NOT EXISTS micro_learning_end time NOT NULL DEFAULT '22:00';

UPDATE learners
   SET timezone = 'Asia/Ho_Chi_Minh',
       notification_time = '07:00',
       updated_at = now();

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
