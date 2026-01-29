-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Contacts table
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  photo_url TEXT,
  starred BOOLEAN DEFAULT false,
  manual_importance INTEGER,
  engagement_score DECIMAL,
  sentiment_trend TEXT CHECK (sentiment_trend IN ('positive', 'negative', 'neutral')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Contact identifiers (for multi-email/phone)
CREATE TABLE contact_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('email', 'phone', 'social_handle')),
  value TEXT NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(type, value)
);

CREATE INDEX idx_contact_identifiers_contact_id ON contact_identifiers(contact_id);
CREATE INDEX idx_contact_identifiers_value ON contact_identifiers(value);

-- Communications
CREATE TABLE communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  subject TEXT,
  content TEXT,
  content_embedding VECTOR(768),
  timestamp TIMESTAMPTZ,
  metadata JSONB,
  sentiment TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, source_id)
);

CREATE INDEX idx_communications_contact_id ON communications(contact_id);
CREATE INDEX idx_communications_timestamp ON communications(timestamp);
CREATE INDEX idx_communications_source ON communications(source);

-- Conversations (for grouping messages)
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  source_thread_id TEXT,
  participants UUID[],
  sentiment_aggregate TEXT CHECK (sentiment_aggregate IN ('positive', 'negative', 'neutral')),
  first_message_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0
);

CREATE INDEX idx_conversations_source ON conversations(source);
CREATE INDEX idx_conversations_last_message_at ON conversations(last_message_at);

-- Facts
CREATE TABLE facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  category TEXT CHECK (category IN ('basic_info', 'relationship', 'preference', 'custom')),
  fact_type TEXT,
  value TEXT NOT NULL,
  structured_value JSONB,
  source TEXT CHECK (source IN ('extracted', 'manual')),
  source_communication_id UUID REFERENCES communications(id) ON DELETE SET NULL,
  confidence DECIMAL,
  has_conflict BOOLEAN DEFAULT false,
  reminder_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_facts_contact_id ON facts(contact_id);
CREATE INDEX idx_facts_fact_type ON facts(fact_type);

-- Fact history (for versioning)
CREATE TABLE fact_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  value TEXT,
  structured_value JSONB,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  change_source TEXT
);

CREATE INDEX idx_fact_history_fact_id ON fact_history(fact_id);

-- Notes
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_notes_contact_id ON notes(contact_id);

-- Note attachments
CREATE TABLE note_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  filename TEXT,
  mime_type TEXT,
  storage_path TEXT,
  size_bytes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_note_attachments_note_id ON note_attachments(note_id);

-- Communication attachments
CREATE TABLE communication_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  communication_id UUID NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  filename TEXT,
  mime_type TEXT,
  storage_path TEXT,
  size_bytes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_communication_attachments_communication_id ON communication_attachments(communication_id);

-- Follow-ups
CREATE TABLE followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('manual', 'time_based', 'content_detected')),
  reason TEXT,
  due_date DATE,
  source_communication_id UUID REFERENCES communications(id) ON DELETE SET NULL,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_followups_contact_id ON followups(contact_id);
CREATE INDEX idx_followups_due_date ON followups(due_date);
CREATE INDEX idx_followups_completed ON followups(completed);

-- Tags
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  color TEXT,
  followup_days INTEGER
);

-- Contact tags (many-to-many)
CREATE TABLE contact_tags (
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);

CREATE INDEX idx_contact_tags_tag_id ON contact_tags(tag_id);

-- Groups (hierarchical)
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  followup_days INTEGER
);

CREATE INDEX idx_groups_parent_id ON groups(parent_id);

-- Contact groups (many-to-many)
CREATE TABLE contact_groups (
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, group_id)
);

CREATE INDEX idx_contact_groups_group_id ON contact_groups(group_id);

-- Smart lists
CREATE TABLE smart_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  rules JSONB NOT NULL
);

-- Contact relationships
CREATE TABLE contact_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_a_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  contact_b_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  relationship_type TEXT CHECK (relationship_type IN ('colleague', 'family', 'friend', 'inferred')),
  source TEXT,
  strength DECIMAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contact_relationships_contact_a ON contact_relationships(contact_a_id);
CREATE INDEX idx_contact_relationships_contact_b ON contact_relationships(contact_b_id);

-- Calendar events
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT,
  source_id TEXT,
  title TEXT,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  attendee_contact_ids UUID[],
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, source_id)
);

CREATE INDEX idx_calendar_events_start_time ON calendar_events(start_time);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT,
  entity_id UUID,
  action TEXT CHECK (action IN ('create', 'update', 'delete')),
  old_value JSONB,
  new_value JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);

-- Sync state (for daemon)
CREATE TABLE sync_state (
  source TEXT PRIMARY KEY,
  last_sync_at TIMESTAMPTZ,
  last_id TEXT,
  metadata JSONB
);
