# Feature: Communications

## Overview

Store and manage communications from all sources (iMessage, Gmail, etc.). Includes batch upsert for daemon sync, attachment storage, and conversation grouping.

## Dependencies

- **Requires**: 01-project-foundation, 02-authentication, 03-contacts-core
- **Blocks**: 05-facts-system (extracts facts from communications), 09-search

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Deduplication | source + source_id unique | Idempotent daemon syncs |
| Attachment storage | Local filesystem (configurable to S3) | Simple start, scalable later |
| Content storage | Full text in DB | Required for search |
| Embeddings | Generated async after insert | Don't block sync |

## Database Tables

Tables from 01-project-foundation:
- `communications` - Message content and metadata
- `conversations` - Thread grouping
- `communication_attachments` - File references

## API Endpoints

### List Communications
```
GET /api/communications
Query params:
  - contact_id: UUID
  - source: string (imessage, gmail, twitter, etc.)
  - direction: 'inbound' | 'outbound'
  - start_date: ISO date
  - end_date: ISO date
  - conversation_id: UUID
  - cursor: string
  - limit: number (default 50)

Response:
{
  communications: Communication[],
  nextCursor: string | null
}
```

### Get Single Communication
```
GET /api/communications/:id
Response:
{
  communication: Communication,
  attachments: Attachment[],
  contact: Contact
}
```

### Batch Upsert (Daemon)
```
POST /api/communications/batch
Headers: X-API-Key: <daemon-key>
Body:
{
  communications: {
    source: string,
    source_id: string,
    contact_identifier: { type: string, value: string },
    direction: 'inbound' | 'outbound',
    subject?: string,
    content: string,
    timestamp: ISO date,
    metadata?: object,
    thread_id?: string,  // source-specific thread identifier
    attachments?: {
      filename: string,
      mime_type: string,
      size_bytes: number,
      data: string  // base64 encoded
    }[]
  }[]
}

Response:
{
  inserted: number,
  updated: number,
  errors: { index: number, error: string }[]
}
```

### Search Communications
```
GET /api/communications/search
Query params:
  - q: string (full-text search)
  - contact_id: UUID
  - source: string
  - start_date: ISO date
  - end_date: ISO date
  - limit: number

Response:
{
  results: {
    communication: Communication,
    highlights: string[]  // matched snippets
  }[]
}
```

### Upload Attachment (Daemon)
```
POST /api/sync/attachments
Headers: X-API-Key: <daemon-key>
Content-Type: multipart/form-data
Body:
  - file: binary
  - communication_source: string
  - communication_source_id: string
  - filename: string

Response:
{
  attachment: Attachment
}
```

## Implementation

### Batch Upsert Service

```typescript
// src/services/communications.ts

export async function batchUpsert(items: CommunicationInput[]) {
  const results = { inserted: 0, updated: 0, errors: [] as any[] };

  for (let i = 0; i < items.length; i++) {
    try {
      const item = items[i];

      // Resolve or create contact from identifier
      const contactId = await resolveContact(item.contact_identifier);

      // Upsert communication
      const result = await db.query(`
        INSERT INTO communications (
          source, source_id, contact_id, direction, subject,
          content, timestamp, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (source, source_id) DO UPDATE SET
          content = EXCLUDED.content,
          metadata = EXCLUDED.metadata
        RETURNING id, (xmax = 0) as inserted
      `, [
        item.source, item.source_id, contactId, item.direction,
        item.subject, item.content, item.timestamp, item.metadata
      ]);

      if (result.rows[0].inserted) {
        results.inserted++;
      } else {
        results.updated++;
      }

      // Handle attachments
      if (item.attachments?.length) {
        for (const att of item.attachments) {
          await saveAttachment(result.rows[0].id, att);
        }
      }

      // Update/create conversation grouping
      if (item.thread_id) {
        await updateConversation(item.source, item.thread_id, contactId, result.rows[0].id);
      }

      // Queue for embedding generation (async)
      await queueForEmbedding(result.rows[0].id);

    } catch (error) {
      results.errors.push({ index: i, error: error.message });
    }
  }

  return results;
}

async function resolveContact(identifier: { type: string, value: string }) {
  // Normalize the identifier value
  const normalized = identifier.type === 'email'
    ? identifier.value.toLowerCase().trim()
    : identifier.type === 'phone'
    ? identifier.value.replace(/[^\d+]/g, '')
    : identifier.value.trim();

  // Find existing contact
  const existing = await db.query(
    'SELECT contact_id FROM contact_identifiers WHERE type = $1 AND value = $2',
    [identifier.type, normalized]
  );

  if (existing.rows[0]) {
    return existing.rows[0].contact_id;
  }

  // Create new contact
  const contact = await db.query(`
    INSERT INTO contacts (display_name, created_at, updated_at)
    VALUES ($1, NOW(), NOW())
    RETURNING id
  `, [normalized]); // Use identifier as placeholder name

  // Add identifier
  await db.query(`
    INSERT INTO contact_identifiers (contact_id, type, value, source, created_at)
    VALUES ($1, $2, $3, 'sync', NOW())
  `, [contact.rows[0].id, identifier.type, normalized]);

  return contact.rows[0].id;
}
```

### Conversation Grouping

```typescript
// src/services/conversations.ts

export async function updateConversation(
  source: string,
  threadId: string,
  contactId: string,
  communicationId: string
) {
  // Upsert conversation
  const result = await db.query(`
    INSERT INTO conversations (source, source_thread_id, participants, first_message_at, last_message_at, message_count)
    SELECT $1, $2, ARRAY[$3]::uuid[], c.timestamp, c.timestamp, 1
    FROM communications c WHERE c.id = $4
    ON CONFLICT (source, source_thread_id) DO UPDATE SET
      participants = array_cat_unique(conversations.participants, ARRAY[$3]::uuid[]),
      last_message_at = GREATEST(conversations.last_message_at, EXCLUDED.last_message_at),
      first_message_at = LEAST(conversations.first_message_at, EXCLUDED.first_message_at),
      message_count = conversations.message_count + 1
    RETURNING id
  `, [source, threadId, contactId, communicationId]);

  // Link communication to conversation
  await db.query(
    'UPDATE communications SET conversation_id = $1 WHERE id = $2',
    [result.rows[0].id, communicationId]
  );
}

// Helper function for Postgres (add via migration)
// CREATE OR REPLACE FUNCTION array_cat_unique(arr1 anyarray, arr2 anyarray)
// RETURNS anyarray AS $$
//   SELECT ARRAY(SELECT DISTINCT unnest(arr1 || arr2))
// $$ LANGUAGE sql;
```

### Attachment Storage

```typescript
// src/services/attachments.ts

import { createHash } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const STORAGE_PATH = process.env.STORAGE_PATH || './data/attachments';

export async function saveAttachment(communicationId: string, attachment: AttachmentInput) {
  // Decode base64
  const buffer = Buffer.from(attachment.data, 'base64');

  // Generate storage path: /YYYY/MM/DD/<hash>.<ext>
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const date = new Date();
  const ext = path.extname(attachment.filename) || '';
  const relativePath = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${hash}${ext}`;
  const fullPath = path.join(STORAGE_PATH, relativePath);

  // Ensure directory exists
  await mkdir(path.dirname(fullPath), { recursive: true });

  // Write file
  await writeFile(fullPath, buffer);

  // Store reference in DB
  return db.query(`
    INSERT INTO communication_attachments
    (communication_id, filename, mime_type, storage_path, size_bytes, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING *
  `, [communicationId, attachment.filename, attachment.mime_type, relativePath, attachment.size_bytes]);
}

export async function getAttachmentPath(attachmentId: string) {
  const result = await db.query(
    'SELECT storage_path FROM communication_attachments WHERE id = $1',
    [attachmentId]
  );
  if (!result.rows[0]) return null;
  return path.join(STORAGE_PATH, result.rows[0].storage_path);
}
```

### Full-Text Search Setup

```sql
-- Add to migrations

-- Add tsvector column for full-text search
ALTER TABLE communications ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(content, ''))) STORED;

-- Create GIN index for fast search
CREATE INDEX idx_communications_content_tsv ON communications USING GIN (content_tsv);

-- Search function
-- Usage: SELECT * FROM communications WHERE content_tsv @@ plainto_tsquery('english', 'search terms')
```

## Implementation Steps

1. Create `src/services/communications.ts` with list/get/batch operations
2. Create `src/services/conversations.ts` for thread grouping
3. Create `src/services/attachments.ts` for file storage
4. Create `src/routes/communications.ts` with all endpoints
5. Add migration for `content_tsv` column and GIN index
6. Add migration for `array_cat_unique` function
7. Implement contact auto-creation from unknown identifiers
8. Add validation schemas for batch upsert
9. Create attachment download endpoint
10. Add embedding queue stub (implemented in AI Integration feature)
11. Test batch upsert with various scenarios
12. Test idempotency (re-syncing same messages)

## Acceptance Criteria

- [ ] `GET /api/communications` returns paginated list with filters
- [ ] `GET /api/communications/:id` returns full communication with attachments
- [ ] `POST /api/communications/batch` inserts new communications
- [ ] `POST /api/communications/batch` updates existing (same source+source_id)
- [ ] Batch upsert creates contacts for unknown identifiers
- [ ] Attachments are stored to filesystem with organized path
- [ ] Attachments can be downloaded
- [ ] Conversations are created/updated for threaded messages
- [ ] Full-text search works via `content_tsv` column
- [ ] All operations require authentication (session or API key)

## Files to Create

| Path | Purpose |
|------|---------|
| `packages/backend/src/services/communications.ts` | Communication operations |
| `packages/backend/src/services/conversations.ts` | Thread grouping logic |
| `packages/backend/src/services/attachments.ts` | File storage |
| `packages/backend/src/routes/communications.ts` | API endpoints |
| `packages/backend/src/routes/sync.ts` | Daemon sync endpoints |
| `packages/backend/src/schemas/communications.ts` | Validation schemas |
| `packages/backend/src/db/migrations/003_fulltext_search.sql` | FTS setup |
| `packages/shared/src/types/communication.ts` | TypeScript types |

## Notes for Implementation

- Batch upsert should be atomic per-item, not all-or-nothing (report individual errors)
- Contact auto-creation uses identifier as placeholder display_name
- Embedding generation is async - don't block sync on it
- File storage path is configurable via `STORAGE_PATH` env
- Consider adding S3 support later (abstraction layer ready)
- The `(xmax = 0)` trick detects if row was inserted vs updated
- Conversation participants array may contain duplicates without `array_cat_unique`
