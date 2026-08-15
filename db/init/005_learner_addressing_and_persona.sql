ALTER TABLE learners
  ADD COLUMN IF NOT EXISTS gender_identity text NOT NULL DEFAULT 'neutral'
    CHECK (gender_identity IN ('male', 'female', 'neutral')),
  ADD COLUMN IF NOT EXISTS gender_selected_at timestamptz;

COMMENT ON COLUMN learners.gender_identity IS
  'Self-selected form of address: male=anh, female=chị, neutral=bạn. Never inferred from name or voice.';
