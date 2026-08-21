ALTER TABLE micro_learning_items
  ADD COLUMN IF NOT EXISTS example_phonetic_text text NOT NULL DEFAULT '';
