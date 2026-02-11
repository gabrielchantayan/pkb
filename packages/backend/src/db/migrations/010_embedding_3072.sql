-- Upgrade embedding columns from 768 to 3072 dimensions for gemini-embedding-001
-- Existing embeddings must be cleared before altering since pgvector can't recast dimensions

-- Communications
UPDATE communications SET content_embedding = NULL
  WHERE content_embedding IS NOT NULL;
ALTER TABLE communications
  ALTER COLUMN content_embedding TYPE vector(3072);

-- Facts
UPDATE facts SET value_embedding = NULL
  WHERE value_embedding IS NOT NULL;
ALTER TABLE facts
  ALTER COLUMN value_embedding TYPE vector(3072);
