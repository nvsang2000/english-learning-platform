ALTER TABLE micro_learning_items
  ADD COLUMN IF NOT EXISTS phonetic_text text NOT NULL DEFAULT '';
