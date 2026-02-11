# WP-02: Batch Construction Service

**Phase:** 1
**Depends on:** None
**Complexity:** Medium

## Goal

Build a standalone batch construction module that handles the core batching logic: querying unprocessed communications grouped by contact, fetching context messages, splitting into sized batches with overlap, and formatting messages for prompt consumption. This is a pure-logic module with no AI calls — it prepares data for extraction.

## Background

The spec defines a specific batching strategy:
- Group unprocessed communications by `contact_id`
- For each contact, fetch last N already-processed messages as read-only context
- Split unprocessed messages into batches of configurable size (default 15)
- Add 1-2 message overlap between consecutive batches
- Format messages chronologically with metadata: `[2024-01-15 10:30 | SMS | RECEIVED] content...`
- Skip messages shorter than 20 characters
- No cap per contact — process all unprocessed messages in sequential batches

The current pipeline in `packages/backend/src/services/ai/pipeline.ts` processes communications one at a time by ID, with no batching or grouping logic. The new batching module will be consumed by the cron pipeline orchestrator (WP-06).

**Existing patterns to follow:**
- `packages/backend/src/services/ai/pipeline.ts` — current pipeline structure, shows how communications are queried with contact info
- `packages/backend/src/services/communications.ts` — query patterns for the communications table
- `packages/backend/src/services/ai/embeddings.ts` — example of a standalone AI service module

## Scope

**In scope:**
- Create `packages/backend/src/services/ai/batching.ts` with functions:
  - `get_unprocessed_contacts()`: Query contacts with unprocessed communications
  - `get_contact_batches(contact_id, batch_size, overlap, context_count)`: For a contact, return an array of batches, each containing formatted messages
  - `format_batch_prompt(context_messages, batch_messages, contact_name)`: Format messages into the prompt string format
- Create `packages/backend/src/services/ai/batching.test.ts` with unit tests
- Handle edge cases: single message, messages shorter than 20 chars, no context messages available, empty results

**Out of scope (handled by other WPs):**
- Database migration for `frf_processed_at` column — WP-01
- Extraction prompt — WP-03
- Cron scheduling and orchestration — WP-06
- Marking communications as processed — WP-06

## Key Files

**Create:**
- `packages/backend/src/services/ai/batching.ts` — batch construction logic
- `packages/backend/src/services/ai/batching.test.ts` — unit tests

**Reference (read, don't modify):**
- `packages/backend/src/services/ai/pipeline.ts` — current pipeline, shows communication query pattern
- `packages/backend/src/services/communications.ts` — communications query patterns
- `packages/backend/src/db/index.ts` — database query helper (`query()` function)

## Technical Details

### Data Types

```typescript
interface BatchCommunication {
  id: string;
  content: string;
  source: string;       // 'imessage', 'email', etc.
  direction: string;    // 'inbound' | 'outbound'
  subject: string | null;
  timestamp: Date;
  contact_id: string;
  contact_name: string;
}

interface ContactBatch {
  contact_id: string;
  contact_name: string;
  context_messages: BatchCommunication[];  // read-only context (already processed)
  batch_messages: BatchCommunication[];    // new messages to extract from
  communication_ids: string[];            // IDs to mark as processed after extraction
}

interface UnprocessedContact {
  contact_id: string;
  contact_name: string;
  unprocessed_count: number;
}
```

### Query: Unprocessed Contacts

```sql
SELECT cm.contact_id, c.display_name AS contact_name, COUNT(*) AS unprocessed_count
FROM communications cm
JOIN contacts c ON c.id = cm.contact_id
WHERE cm.frf_processed_at IS NULL
  AND c.deleted_at IS NULL
  AND cm.contact_id IS NOT NULL
  AND LENGTH(cm.content) >= 20
GROUP BY cm.contact_id, c.display_name
ORDER BY unprocessed_count DESC
```

### Query: Context Messages (Already Processed)

```sql
SELECT cm.id, cm.content, cm.source, cm.direction, cm.subject, cm.timestamp,
       cm.contact_id, c.display_name AS contact_name
FROM communications cm
JOIN contacts c ON c.id = cm.contact_id
WHERE cm.contact_id = $1
  AND cm.frf_processed_at IS NOT NULL
  AND LENGTH(cm.content) >= 20
ORDER BY cm.timestamp DESC
LIMIT $2
```

(Then reverse the result to get chronological order.)

### Query: Unprocessed Messages for Contact

```sql
SELECT cm.id, cm.content, cm.source, cm.direction, cm.subject, cm.timestamp,
       cm.contact_id, c.display_name AS contact_name
FROM communications cm
JOIN contacts c ON c.id = cm.contact_id
WHERE cm.contact_id = $1
  AND cm.frf_processed_at IS NULL
  AND LENGTH(cm.content) >= 20
ORDER BY cm.timestamp ASC
```

### Batching Algorithm

1. Get all unprocessed messages for a contact (chronological)
2. Split into batches of `batch_size` (default 15)
3. For overlap: when creating batch N+1, include the last `overlap` messages from batch N at the start
4. The overlapped messages should NOT be in `communication_ids` for batch N+1 (they were already counted in batch N)
5. Context messages are the same for all batches of a contact

### Message Formatting

Each message formatted as:
```
[2024-01-15 10:30 | SMS | RECEIVED] Hey, I just switched from Replit to Claude Code...
```

Source mapping: `imessage` → `SMS`, `email` → `EMAIL`, etc. (use source string directly, uppercased)
Direction mapping: `inbound` → `RECEIVED`, `outbound` → `SENT`

For emails with subjects, include subject:
```
[2024-01-16 09:00 | EMAIL | RECEIVED] Subject: Project update
content here...
```

Context messages are prepended with a clear separator:
```
=== CONTEXT ONLY - Do not extract facts from these messages ===

[messages...]

=== NEW MESSAGES - Extract facts from these messages ===

[messages...]
```

## Acceptance Criteria

- [ ] `get_unprocessed_contacts()` returns contacts with unprocessed communication counts
- [ ] `get_contact_batches()` correctly splits messages into batches of configurable size
- [ ] Overlap works correctly: last N messages of batch K appear at start of batch K+1
- [ ] Overlapped messages are NOT included in `communication_ids` of the receiving batch
- [ ] Context messages (already processed) are fetched and included
- [ ] Messages shorter than 20 chars are excluded
- [ ] Messages are formatted with correct timestamp, source, direction
- [ ] Email subjects are included in formatting
- [ ] Edge case: single message → single batch
- [ ] Edge case: no context messages available → works without context
- [ ] Edge case: contact with 0 qualifying messages (all < 20 chars) → returns empty array
- [ ] All new code has test coverage
- [ ] No regressions in existing tests

## Verification Commands

```bash
# Run unit tests
cd packages/backend && npx vitest run src/services/ai/batching.test.ts

# Run all tests
cd packages/backend && npx vitest run

# Type check
cd packages/backend && npx tsc --noEmit
```
