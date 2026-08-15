ALTER TABLE micro_learning_items
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'b1-core';

CREATE TABLE IF NOT EXISTS learner_vocabulary_history (
  id bigserial PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  item_id bigint NOT NULL REFERENCES micro_learning_items(id) ON DELETE CASCADE,
  outbox_id uuid UNIQUE REFERENCES notification_outbox(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (learner_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_history_weekly
  ON learner_vocabulary_history (learner_id, delivered_at DESC)
  WHERE delivered_at IS NOT NULL;

INSERT INTO learner_vocabulary_history (learner_id, item_id, outbox_id, assigned_at, delivered_at)
SELECT DISTINCT ON (o.learner_id, i.id)
       o.learner_id,
       i.id,
       o.id,
       o.created_at,
       COALESCE(o.sent_at, o.created_at)
  FROM notification_outbox o
  JOIN micro_learning_items i
    ON i.english_text = o.payload->'speechSegments'->>0
 WHERE o.notification_type LIKE 'micro\_%' ESCAPE '\'
   AND o.status = 'sent'
 ORDER BY o.learner_id, i.id, o.sent_at NULLS LAST, o.created_at
ON CONFLICT DO NOTHING;
