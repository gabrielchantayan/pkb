-- Add tsvector columns for full-text search on contacts, facts, and notes
-- Note: communications already has content_tsv from migration 003

-- Contacts: search by display_name
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS display_name_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', display_name)) STORED;
CREATE INDEX IF NOT EXISTS idx_contacts_display_name_tsv ON contacts USING GIN (display_name_tsv);

-- Facts: search by value
ALTER TABLE facts ADD COLUMN IF NOT EXISTS value_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', value)) STORED;
CREATE INDEX IF NOT EXISTS idx_facts_value_tsv ON facts USING GIN (value_tsv);

-- Notes: search by content
ALTER TABLE notes ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_notes_content_tsv ON notes USING GIN (content_tsv);

-- Note: Vector index for semantic search (ivfflat) requires data to exist first
-- and should be created after embeddings are populated via AI Integration (step 10)
-- Example for future migration:
-- CREATE INDEX idx_communications_embedding ON communications
--   USING ivfflat (content_embedding vector_cosine_ops)
--   WITH (lists = 100);
