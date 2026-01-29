-- Add conversation_id foreign key to communications
ALTER TABLE communications ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_communications_conversation_id ON communications(conversation_id);

-- Add unique constraint on conversations for upsert
ALTER TABLE conversations ADD CONSTRAINT conversations_source_thread_unique UNIQUE (source, source_thread_id);

-- Add tsvector column for full-text search (generated column)
ALTER TABLE communications ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(content, ''))) STORED;

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_communications_content_tsv ON communications USING GIN (content_tsv);

-- Helper function for unique array concatenation (used in conversation participant updates)
CREATE OR REPLACE FUNCTION array_cat_unique(arr1 anyarray, arr2 anyarray)
RETURNS anyarray AS $$
  SELECT ARRAY(SELECT DISTINCT unnest(arr1 || arr2))
$$ LANGUAGE sql IMMUTABLE;
