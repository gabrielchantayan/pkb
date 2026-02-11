-- Clear all AI-extracted FRFs to allow reprocessing through new cron pipeline
-- Manual and addressbook FRFs are preserved

-- Soft-delete all extracted facts
UPDATE facts SET deleted_at = NOW()
WHERE source = 'extracted' AND deleted_at IS NULL;

-- Soft-delete all extracted relationships
UPDATE relationships SET deleted_at = NOW()
WHERE source = 'extracted' AND deleted_at IS NULL;

-- Hard-delete content-detected followups (followups table has no deleted_at column)
DELETE FROM followups WHERE type = 'content_detected';

-- Reset processing timestamps so all communications are reprocessed by the new pipeline
UPDATE communications SET frf_processed_at = NULL;
