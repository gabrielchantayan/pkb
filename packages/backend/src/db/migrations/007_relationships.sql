-- Create relationships table
CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  person_name TEXT NOT NULL,
  linked_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('extracted', 'manual')),
  source_communication_id UUID REFERENCES communications(id) ON DELETE SET NULL,
  confidence DECIMAL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_relationships_unique ON relationships(contact_id, lower(label), lower(person_name)) WHERE deleted_at IS NULL;
CREATE INDEX idx_relationships_contact_id ON relationships(contact_id);
CREATE INDEX idx_relationships_linked_contact_id ON relationships(linked_contact_id);

-- Migrate existing relationship facts into the new table
INSERT INTO relationships (contact_id, label, person_name, source, source_communication_id, confidence, created_at, updated_at)
SELECT
  f.contact_id,
  f.fact_type,
  COALESCE(
    f.structured_value->>'name',
    f.value
  ),
  f.source,
  f.source_communication_id,
  f.confidence,
  f.created_at,
  f.updated_at
FROM facts f
WHERE f.fact_type IN ('spouse', 'child', 'parent', 'sibling', 'friend', 'colleague', 'mutual_connection', 'how_we_met')
  AND f.deleted_at IS NULL
ON CONFLICT (contact_id, lower(label), lower(person_name)) WHERE deleted_at IS NULL DO NOTHING;

-- Soft-delete migrated relationship facts
UPDATE facts
SET deleted_at = NOW()
WHERE fact_type IN ('spouse', 'child', 'parent', 'sibling', 'friend', 'colleague', 'mutual_connection', 'how_we_met')
  AND deleted_at IS NULL;
