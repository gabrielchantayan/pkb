-- Add FRF processing tracking to communications
ALTER TABLE communications ADD COLUMN frf_processed_at TIMESTAMPTZ;

-- Partial index for efficiently finding unprocessed communications
CREATE INDEX idx_communications_frf_unprocessed
  ON communications (contact_id, timestamp)
  WHERE frf_processed_at IS NULL;

-- Add embedding column for semantic deduplication of facts
ALTER TABLE facts ADD COLUMN value_embedding vector(768);
