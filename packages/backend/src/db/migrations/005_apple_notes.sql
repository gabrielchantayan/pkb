-- Apple Notes table (for notes synced from macOS Notes app)
-- These are distinct from the 'notes' table which stores contact-specific notes
CREATE TABLE apple_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL UNIQUE,  -- e.g., "note:12345" from Apple Notes
  title TEXT,
  content TEXT,
  folder TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_apple_notes_source_id ON apple_notes(source_id);
CREATE INDEX idx_apple_notes_folder ON apple_notes(folder);
CREATE INDEX idx_apple_notes_updated_at ON apple_notes(updated_at);
