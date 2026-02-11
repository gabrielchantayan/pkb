# SPEC: FRF (Fact/Relation/Followup) System Redesign

## Overview

Complete redesign of the fact, relationship, and followup extraction pipeline. The current system processes each communication individually through Gemini 2.5 Flash in a fire-and-forget manner. The new system batches communications per-contact, runs on a 30-minute cron schedule, uses `gemini-flash-latest` (configurable via env var), enforces quality standards through prompt engineering, and adds semantic deduplication via embeddings.

## Goals

1. **Higher quality extractions** - Only meaningful personal details that reveal something about who a person IS (preferences, tools, opinions, life events, goals), not trivial observations ("went to the store")
2. **Batch processing** - Group 10-20 messages per contact with 1-2 message overlap for context continuity
3. **Cron-based pipeline** - Replace fire-and-forget per-message processing with scheduled batch runs every 30 minutes
4. **Expanded fact types** - Add `preference`, `tool`, `hobby`, `opinion`, `life_event`, `goal`
5. **Free-form relationship labels** - Remove rigid label enum, allow any string
6. **3-month followup cutoff** - Drop followups extracted from messages older than 3 months (by message timestamp)
7. **Semantic deduplication** - Use embeddings to prevent near-duplicate facts (0.80 cosine similarity threshold)
8. **Auto-supersede for singular facts** - Job, company, location, birthday facts auto-replace previous values; preferences/hobbies/etc. accumulate

---

## Detailed Requirements

### 1. Cron Job Scheduler

- **Location**: Backend server process, alongside existing birthday reminder cron job
- **Frequency**: Every 30 minutes (configurable via `FRF_CRON_INTERVAL`)
- **Scope**: All contacts with unprocessed communications
- **Concurrency**: Mutex lock to prevent overlapping cron runs
- **Process**:
  1. Query all communications where `frf_processed_at IS NULL`
  2. Group by `contact_id`
  3. For each contact, fetch last 5-10 already-processed communications as read-only context
  4. Split unprocessed messages into batches of 10-20 (chronological order)
  5. Add 1-2 message overlap between consecutive batches
  6. Process each batch through the extraction prompt
  7. Mark all communications in batch as processed (`frf_processed_at = NOW()`)
  8. 200-500ms delay between batch API calls to avoid rate limits

### 2. Batch Construction

- **Grouping**: By contact - all messages from one contact processed together
- **Batch size**: 10-20 messages per batch (default 15, configurable)
- **Overlap**: 1-2 messages from end of previous batch included at start of next batch
- **Context messages**: Last 5-10 already-processed messages prepended as read-only context, clearly labeled in prompt as "CONTEXT ONLY - do not extract from these"
- **Multi-source handling**: Batches mix message sources (email, SMS, etc.) - each message labeled with its source type
- **Message format in prompt**: Chronological with metadata
  ```
  [2024-01-15 10:30 | SMS | RECEIVED] Hey, I just switched from Replit to Claude Code...
  [2024-01-15 10:45 | SMS | SENT] Oh nice, how do you like it?
  [2024-01-16 09:00 | EMAIL | RECEIVED] Subject: Project update...
  ```
- **Volume handling**: No cap per contact per run - if a contact has 200 unprocessed messages, process all in sequential batches of 15
- **No-result handling**: If a batch returns no FRFs, mark communications as processed and move on - this is expected and fine
- **Minimum message length**: Skip messages shorter than 20 characters (keep existing behavior)

### 3. Extraction Prompt (Complete Rewrite)

- **Model**: `gemini-flash-latest` (configurable via `GEMINI_FLASH_MODEL` env var, using existing Google Generative AI SDK)
- **Output format**: JSON with Gemini structured output / JSON mode for guaranteed valid responses
- **Confidence threshold**: 0.75 (raised from current 0.6)
- **Quality mandate**: The prompt must explicitly instruct the model to:
  - Only extract meaningful personal details that reveal something about who the person IS
  - **Good examples**: "prefers olive oil over butter", "switched from Replit to Claude Code", "works at Meta (previously Google)", "training for a marathon", "wants to learn Rust", "has a daughter named Emma"
  - **Bad examples**: "went to the store", "is running late", "had lunch", "said they're busy", "asked about the weather"
  - Explicitly state that returning empty arrays is correct when nothing noteworthy is found
  - Clearly differentiate between context-only messages and messages to extract from
  - Be source-type aware (email vs text style differences in how people express things)

### 4. Fact Types

#### Existing types (keep):
- `birthday`, `location`, `job_title`, `company`, `email`, `phone`, `custom`

#### New types:
| Type | Description | Examples |
|------|-------------|---------|
| `preference` | Likes, dislikes, preferences | "prefers dark mode", "likes olives", "hates meetings" |
| `tool` | Software, tools, platforms | "uses Claude Code", "switched to Linear", "prefers VS Code" |
| `hobby` | Activities, interests, pastimes | "plays guitar", "into rock climbing", "reads sci-fi" |
| `opinion` | Views, stances, perspectives | "thinks remote work is better", "prefers startups" |
| `life_event` | Major life changes | "got married in 2024", "moved to Austin", "had a baby" |
| `goal` | Aspirations, plans, ambitions | "wants to learn Rust", "training for a marathon", "planning to start a company" |

#### Supersede behavior:

**Singular types** (auto-supersede - only one active value at a time):
- `birthday`, `location`, `job_title`, `company`

**Plural types** (accumulate - multiple values coexist):
- `preference`, `tool`, `hobby`, `opinion`, `life_event`, `goal`, `email`, `phone`, `custom`

#### Auto-supersede mechanics:
1. When a new fact of a singular type is extracted for a contact:
2. Find existing active (non-deleted) fact of same `fact_type` for that `contact_id`
3. If exists and value differs:
   - Soft-delete old fact (`deleted_at = NOW()`)
   - Record old fact in `fact_history` table with `change_source = 'superseded'`
4. Insert new fact
5. Plural types: just insert (after dedup check)

### 5. Relationship Labels (Free-Form)

- Remove rigid enum/CHECK constraint on `label` field
- Allow any string as a relationship label
- Normalize to lowercase on storage
- Unique constraint remains: `(contact_id, LOWER(label), LOWER(person_name)) WHERE deleted_at IS NULL`
- **Suggested labels** (for UI autocomplete): spouse, partner, child, parent, sibling, friend, colleague, boss, mentor, roommate, ex, client, neighbor, teacher, student, doctor, therapist, how_we_met
- Extraction prompt should use free-form labels rather than picking from a fixed list

### 6. Followup 3-Month Cutoff

- When processing extracted followups, check the source communication's `timestamp`
- If `communication.timestamp` is more than 90 days before `NOW()`: do NOT create the followup
- Applies universally - both bulk import and ongoing processing
- Existing followups from old messages are NOT affected (only applies to new extractions going forward)
- Configurable via `FRF_FOLLOWUP_CUTOFF_DAYS` env var (default 90)

### 7. Semantic Deduplication

- **Scope**: Facts only (relationships and followups use existing dedup logic)
- **When**: After extraction, before database insert
- **Process**:
  1. Generate embedding for each extracted fact's `value` using `text-embedding-004`
  2. Query existing fact embeddings for the same `contact_id` + same `fact_type`
  3. Compute cosine similarity against each existing fact embedding
  4. If any similarity >= 0.80: skip insertion (treat as duplicate)
- **Embedding storage**: New `value_embedding vector(768)` column on `facts` table
- **Embedding generation**: Done at extraction time, embedded as part of batch processing
- **Fallback**: If embedding generation fails, insert fact without dedup (log warning)

### 8. Processing State Tracking

- **New column**: `frf_processed_at TIMESTAMPTZ` on `communications` table
- Simple timestamp - just know if/when a communication was processed
- NULL = unprocessed, non-NULL = processed
- Index for efficient cron queries: `WHERE frf_processed_at IS NULL`

---

## Database Changes

### Migration: Communications table
```sql
ALTER TABLE communications ADD COLUMN frf_processed_at TIMESTAMPTZ;

CREATE INDEX idx_communications_frf_unprocessed
  ON communications (contact_id, timestamp)
  WHERE frf_processed_at IS NULL;
```

### Migration: Facts table
```sql
-- Add embedding column for semantic dedup
ALTER TABLE facts ADD COLUMN value_embedding vector(768);

-- Index for similarity search (per-contact, per-type)
CREATE INDEX idx_facts_embedding ON facts
  USING ivfflat (value_embedding vector_cosine_ops);

-- Update fact_type CHECK constraint (or validation) to include new types
-- New valid values: birthday, location, job_title, company, email, phone, custom,
--                   preference, tool, hobby, opinion, life_event, goal
```

### Migration: Relationships table
```sql
-- Remove CHECK constraint on label if one exists
-- Label becomes free-form TEXT (already TEXT, remove Zod enum validation)
```

### Migration: Clear extracted FRFs
```sql
-- Delete all AI-extracted facts (keep manual)
UPDATE facts SET deleted_at = NOW() WHERE source = 'extracted' AND deleted_at IS NULL;

-- Delete all AI-extracted relationships (keep manual)
UPDATE relationships SET deleted_at = NOW() WHERE source = 'extracted' AND deleted_at IS NULL;

-- Delete all content-detected followups (keep manual and time-based)
DELETE FROM followups WHERE type = 'content_detected';

-- Clean up fact_history for deleted extracted facts (optional)
-- DELETE FROM fact_history WHERE fact_id IN (SELECT id FROM facts WHERE source = 'extracted');
```

---

## Extraction Response Schema

```typescript
interface ExtractionResponse {
  facts: Array<{
    fact_type: 'birthday' | 'location' | 'job_title' | 'company' | 'email' | 'phone'
      | 'preference' | 'tool' | 'hobby' | 'opinion' | 'life_event' | 'goal' | 'custom';
    value: string;           // human-readable description
    structured_value?: Record<string, any>;  // optional structured data (dates, locations)
    confidence: number;      // 0.0 - 1.0
  }>;
  relationships: Array<{
    label: string;           // free-form relationship label
    person_name: string;
    confidence: number;
  }>;
  followups: Array<{
    reason: string;          // what needs following up
    suggested_date: string;  // YYYY-MM-DD
  }>;
}
```

---

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `GEMINI_FLASH_MODEL` | `gemini-2.0-flash` | Model for FRF extraction |
| `FRF_CRON_INTERVAL` | `*/30 * * * *` | Cron schedule expression |
| `FRF_BATCH_SIZE` | `15` | Messages per batch |
| `FRF_BATCH_OVERLAP` | `2` | Message overlap between consecutive batches |
| `FRF_CONTEXT_MESSAGES` | `5` | Already-processed messages to include as read-only context |
| `FRF_CONFIDENCE_THRESHOLD` | `0.75` | Minimum confidence for persisting extractions |
| `FRF_DEDUP_SIMILARITY` | `0.80` | Cosine similarity threshold for semantic dedup |
| `FRF_FOLLOWUP_CUTOFF_DAYS` | `90` | Max message age (days) for followup creation |
| `FRF_BATCH_DELAY_MS` | `300` | Delay (ms) between batch API calls |

---

## Pipeline Flow

```
Cron triggers (every 30 min)
    │
    ├─ Acquire mutex lock (skip if already running)
    │
    v
Query unprocessed communications grouped by contact_id
    │
    v
For each contact:
    │
    ├─ Fetch last 5 processed messages as context
    ├─ Split unprocessed into batches of 15 with 2-msg overlap
    │
    v
  For each batch:
    │
    ├─ Format messages chronologically with metadata + source type
    ├─ Prepend context messages (labeled "CONTEXT ONLY")
    ├─ Send to gemini-flash-latest (structured JSON output mode)
    ├─ Parse response
    ├─ Filter by confidence >= 0.75
    │
    ├─ For each followup:
    │   └─ Check source message timestamp > 3 months? → skip
    │   └─ Check for existing pending followup with same reason → skip
    │   └─ Insert into followups table
    │
    ├─ For each relationship:
    │   └─ Normalize label to lowercase
    │   └─ Check unique constraint (contact_id, label, person_name) → skip if exists
    │   └─ Insert into relationships table
    │
    ├─ For each fact:
    │   └─ Generate embedding for fact value
    │   └─ Query existing facts (same contact + type) for cosine similarity
    │   └─ If similarity >= 0.80 with any existing → skip (duplicate)
    │   └─ If singular type + existing fact with different value → supersede (soft-delete old, add to history)
    │   └─ Insert new fact with embedding
    │
    ├─ Mark batch communications as processed (frf_processed_at = NOW())
    ├─ Delay 300ms
    │
    v
  Next batch...
    │
    v
Log summary (extracted counts)
Release mutex lock
```

---

## Error Handling

| Error Type | Behavior |
|-----------|----------|
| **Rate limit (429)** | Immediately stop current cron run, defer all remaining work to next run |
| **Other API error** | Retry batch once; if fails again, skip batch and defer to next run |
| **Malformed JSON** | Skip batch (shouldn't happen with structured output), log error |
| **Embedding generation failure** | Skip dedup for that fact, insert anyway, log warning |
| **Database error** | Log error, skip batch, continue with next batch |
| **Mutex contention** | Skip run entirely (previous run still going) |

Per-batch isolation: failure of one batch does not affect processing of other batches in the same cron run.

---

## UI Changes

### Contact Detail Page
- **Processing status indicator** (small, non-prominent):
  - "Last processed: 5 min ago"
  - "Processing pending (12 new messages)"
- **New fact type display**: Show preference, tool, hobby, opinion, life_event, goal with appropriate labels
- **Superseded fact history**: Expandable "previously: worked at Google" under current job fact

### Dashboard / Settings Page
- **Global processing status**:
  - Last cron run time
  - Total pending (unprocessed) communications
  - Recent extraction summary: "12 facts, 3 relationships, 2 followups extracted in last run"

---

## Migration Strategy

1. Run database migration to add `frf_processed_at` column, `value_embedding` column, update constraints
2. Clear all extracted FRFs (soft-delete facts/relationships with `source = 'extracted'`, delete `content_detected` followups)
3. Keep all manual FRFs untouched
4. Deploy new extraction code with cron job
5. First cron run picks up all communications as unprocessed (since `frf_processed_at` defaults to NULL)
6. System gradually re-processes all historical communications through new pipeline

---

## Files to Modify

### Backend
- `packages/backend/src/services/ai/extraction.ts` - Complete rewrite of extraction logic + prompt
- `packages/backend/src/services/ai/pipeline.ts` - Replace per-message pipeline with batch cron pipeline
- `packages/backend/src/services/ai/gemini.ts` - Update model config, add structured output support
- `packages/backend/src/jobs/` - New `frf-cron.ts` for batch processing cron job
- `packages/backend/src/schemas/facts.ts` - Add new fact_type values to validation
- `packages/backend/src/schemas/relationships.ts` - Remove label enum constraint
- `packages/backend/src/routes/facts.ts` - Support new fact types, embedding storage
- `packages/backend/src/routes/ai.ts` - Update/remove per-message extraction endpoint
- Database migration files

### Shared
- `packages/shared/src/types/fact.ts` - Add new fact_type values to type union
- `packages/shared/src/types/relationship.ts` - Change label to free-form string type

### Frontend
- `packages/frontend/components/contact-detail/facts-section.tsx` - Display new fact types, superseded history
- `packages/frontend/components/contact-detail/relationships-section.tsx` - Free-form label display
- Contact detail page - Processing status indicator
- Dashboard page - Global processing status widget

---

## Edge Cases

1. **Contact with no unprocessed messages**: Skip silently
2. **Contact with exactly 1 unprocessed message**: Process as single-item batch with context
3. **Overlapping cron runs**: Mutex lock prevents concurrent execution
4. **Empty message content / < 20 chars**: Skip (existing behavior)
5. **Batch with all context-only messages**: Skip (no new messages to extract from)
6. **Embedding service down**: Insert fact without dedup, log warning, can embed later
7. **Very long messages**: Truncate individual messages to fit within model context window
8. **Deleted contacts**: Skip communications for soft-deleted contacts
9. **Contact with messages across long time gaps**: Batches are chronological; large time gaps naturally end up in different batches

---

## Testing Considerations

- Unit tests for batch construction logic (grouping, overlap, context selection)
- Unit tests for supersede logic (singular vs plural fact types)
- Unit tests for followup cutoff date filtering
- Unit tests for semantic dedup threshold logic
- Integration tests for the full cron pipeline (mock Gemini API)
- Test semantic dedup with known similar/different fact pairs at boundary (0.79 vs 0.81)
- Test error handling for each failure mode (rate limit, API error, malformed response)
- Test migration: verify manual FRFs preserved, extracted FRFs cleared
- Test mutex: verify concurrent cron runs don't conflict
- Test empty batch results are handled gracefully
