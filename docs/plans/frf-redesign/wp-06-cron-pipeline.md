# WP-06: Cron Pipeline Orchestrator

**Phase:** 3
**Depends on:** WP-02 (Batch Construction), WP-03 (Extraction Prompt), WP-04 (Semantic Dedup & Supersede), WP-05 (Followup Cutoff)
**Complexity:** High

## Goal

Create the cron job that runs every 30 minutes, queries unprocessed communications, orchestrates batch extraction through all the modules built in prior WPs, persists results, and marks communications as processed. This is the central integration point that wires together batching, extraction, dedup/supersede, and followup logic into a complete pipeline.

## Background

The current pipeline in `packages/backend/src/services/ai/pipeline.ts` is a fire-and-forget per-message processor called from `batch_upsert()` in the communications service. It processes each communication individually without batching, grouping, or processing state tracking.

The new pipeline is a cron job that:
1. Acquires a mutex lock (prevents overlapping runs)
2. Queries unprocessed communications grouped by contact (using batching module)
3. For each contact's batches, runs extraction, dedup, supersede, and followup creation
4. Marks communications as processed
5. Delays between API calls to avoid rate limits
6. Handles errors per-batch (failure isolation)

The birthday reminder job pattern (`packages/backend/src/jobs/birthday-reminders.ts`) runs as a standalone script. The spec says the FRF cron should run "alongside" the birthday cron — meaning it should be scheduled within the server process using `node-cron` or similar, not as a separate script (since it needs to run every 30 minutes, external cron is less practical).

The server entry point `packages/backend/src/index.ts` starts Express and handles shutdown. The cron job should be initialized after the server starts.

**Existing patterns to follow:**
- `packages/backend/src/jobs/birthday-reminders.ts` — job script pattern
- `packages/backend/src/services/ai/pipeline.ts` — current pipeline (to be replaced)
- `packages/backend/src/index.ts` — server startup (where cron will be registered)
- `packages/backend/src/services/ai/extraction.ts` — extraction functions
- `packages/backend/src/services/ai/batching.ts` — batch construction (from WP-02)
- `packages/backend/src/services/ai/dedup.ts` — dedup functions (from WP-04)
- `packages/backend/src/services/facts.ts` — `create_extracted_fact_v2()` (from WP-04)

## Scope

**In scope:**
- Create `packages/backend/src/jobs/frf-cron.ts`:
  - `start_frf_cron()`: Registers the cron job, called from `index.ts` after server start
  - `stop_frf_cron()`: Stops the cron job, called during shutdown
  - `run_frf_pipeline()`: The main pipeline function (also exported for manual triggering)
  - Mutex lock implementation (simple in-memory boolean flag — single-process)
- Rewrite `packages/backend/src/services/ai/pipeline.ts`:
  - Replace `process_communications()` with the new batch pipeline logic
  - Or redirect to the new cron module
  - Keep `process_single_communication()` for manual/testing use
- Modify `packages/backend/src/index.ts`:
  - Import and call `start_frf_cron()` after server start
  - Call `stop_frf_cron()` during shutdown
- Add npm dependency: `node-cron` (or use `setInterval` with the cron expression parsed, or use the `cron` npm package)
- Create `packages/backend/src/jobs/frf-cron.test.ts` with unit tests

**Out of scope (handled by other WPs):**
- Batch construction logic — WP-02
- Extraction prompt — WP-03
- Dedup/supersede logic — WP-04
- Followup cutoff — WP-05
- Removing old fire-and-forget call from `batch_upsert()` — WP-07
- Frontend status display — WP-08

## Key Files

**Create:**
- `packages/backend/src/jobs/frf-cron.ts` — cron job orchestrator
- `packages/backend/src/jobs/frf-cron.test.ts` — unit tests

**Modify:**
- `packages/backend/src/services/ai/pipeline.ts` — deprecate/redirect old functions
- `packages/backend/src/index.ts` — register cron job on startup, stop on shutdown

**Reference (read, don't modify):**
- `packages/backend/src/services/ai/batching.ts` — batch construction (WP-02)
- `packages/backend/src/services/ai/extraction.ts` — `extract_from_batch()` (WP-03)
- `packages/backend/src/services/ai/dedup.ts` — `check_semantic_duplicate()` (WP-04)
- `packages/backend/src/services/facts.ts` — `create_extracted_fact_v2()` (WP-04)
- `packages/backend/src/services/followups.ts` — `create_content_detected_followup()` (WP-05)
- `packages/backend/src/services/relationships.ts` — `create_extracted_relationship()`
- `packages/backend/src/config.ts` — FRF config values
- `packages/backend/src/jobs/birthday-reminders.ts` — job pattern reference

## Technical Details

### Pipeline Flow

```
start_frf_cron() — registers cron schedule

run_frf_pipeline():
  1. Check mutex lock — if locked, skip run, log info
  2. Acquire mutex lock
  3. try:
     a. Get unprocessed contacts (batching.get_unprocessed_contacts())
     b. For each contact:
        i.   Get batches (batching.get_contact_batches())
        ii.  For each batch:
             - Format prompt (batching.format_batch_prompt())
             - Call extraction (extraction.extract_from_batch())
             - Filter results by confidence >= config.frf_confidence_threshold
             - Process facts: for each fact, call create_extracted_fact_v2()
             - Process relationships: for each, call create_extracted_relationship()
               (normalize label to lowercase, skip if unique constraint violated)
             - Process followups: for each, call create_content_detected_followup()
               (pass communication timestamp for cutoff check)
             - Mark batch communications as processed:
               UPDATE communications SET frf_processed_at = NOW()
               WHERE id = ANY($1)
             - Delay config.frf_batch_delay_ms between batches
     c. Log summary (total facts, relationships, followups created)
  4. catch: log error
  5. finally: release mutex lock
```

### Error Handling

| Error | Behavior |
|-------|----------|
| Rate limit (429) | Stop current run entirely, release mutex, defer to next cron |
| Other API error | Retry batch once; if fails again, skip batch, continue |
| Malformed response | Skip batch (shouldn't happen with structured output), log error |
| Embedding failure | Handled by dedup module (insert without dedup) |
| Database error | Log error, skip batch, continue with next |
| Mutex contention | Skip run entirely, log info |

### Mutex Implementation

Simple in-memory flag (single-process deployment):

```typescript
let is_running = false;

async function run_frf_pipeline(): Promise<PipelineResult> {
  if (is_running) {
    logger.info('FRF pipeline already running, skipping');
    return { skipped: true };
  }
  is_running = true;
  try {
    // ... pipeline logic ...
  } finally {
    is_running = false;
  }
}
```

### Marking Communications as Processed

After each batch completes successfully:

```sql
UPDATE communications
SET frf_processed_at = NOW()
WHERE id = ANY($1::uuid[])
```

Where `$1` is the array of `communication_ids` from the batch (NOT including overlap messages from previous batches).

### Cron Registration

In `index.ts`, after `app.listen()`:

```typescript
import { start_frf_cron, stop_frf_cron } from './jobs/frf-cron.js';

// After server starts:
if (is_ai_available()) {
  start_frf_cron();
}

// In shutdown:
stop_frf_cron();
```

### Rate Limit Detection

Check Gemini API error responses for 429 status. The `@google/generative-ai` SDK throws errors with status info. Check for:
```typescript
if (error instanceof GoogleGenerativeAIError && error.message.includes('429')) {
  // Rate limited — stop entire run
}
```

Or check the error's HTTP status if available.

### Pipeline Result Type

```typescript
interface PipelineResult {
  skipped?: boolean;
  contacts_processed: number;
  batches_processed: number;
  facts_created: number;
  facts_deduplicated: number;
  facts_superseded: number;
  relationships_created: number;
  followups_created: number;
  followups_skipped_cutoff: number;
  errors: number;
  duration_ms: number;
}
```

### Relationship Creation in Pipeline

For each extracted relationship:
1. Normalize label to lowercase
2. Call `create_extracted_relationship(communication_id, input)` from `packages/backend/src/services/relationships.ts`
3. This function already handles the unique constraint — if a relationship with same (contact_id, label, person_name) exists, the unique index will cause an error which should be caught and skipped

The current `create_extracted_relationship()` in `relationships.ts`:
```typescript
export async function create_extracted_relationship(
  communication_id: string,
  input: ExtractedRelationshipInput
): Promise<Relationship | null>
```

This likely needs a try/catch around the insert for unique constraint violations. Check the existing implementation.

## Acceptance Criteria

- [ ] `start_frf_cron()` registers a cron job running every 30 minutes (configurable)
- [ ] `stop_frf_cron()` cleanly stops the cron job
- [ ] Mutex prevents overlapping pipeline runs
- [ ] Pipeline queries unprocessed communications correctly
- [ ] Batches are processed sequentially per contact with configurable delay
- [ ] Confidence filtering applied (>= 0.75 default)
- [ ] Facts created via `create_extracted_fact_v2()` (with dedup and supersede)
- [ ] Relationships created with lowercase labels, unique constraint violations handled
- [ ] Followups created with timestamp cutoff check
- [ ] Communications marked as processed after successful batch extraction
- [ ] 429 rate limit errors stop the entire run
- [ ] Other API errors retry once, then skip batch
- [ ] Database errors skip batch, continue with next
- [ ] Pipeline logs summary with counts
- [ ] Cron started after server boot in `index.ts`
- [ ] Cron stopped during server shutdown
- [ ] All new code has test coverage
- [ ] No regressions in existing tests

## Verification Commands

```bash
# Run unit tests
cd packages/backend && npx vitest run src/jobs/frf-cron.test.ts

# Run all tests
cd packages/backend && npx vitest run

# Type check
cd packages/backend && npx tsc --noEmit

# Build
cd packages/backend && npx tsc
```
