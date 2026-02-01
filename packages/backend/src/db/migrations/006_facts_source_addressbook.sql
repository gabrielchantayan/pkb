-- Add 'addressbook' as an allowed source for facts
-- This is needed for contact import from Apple Contacts

ALTER TABLE facts DROP CONSTRAINT IF EXISTS facts_source_check;
ALTER TABLE facts ADD CONSTRAINT facts_source_check CHECK (source IN ('extracted', 'manual', 'addressbook'));
