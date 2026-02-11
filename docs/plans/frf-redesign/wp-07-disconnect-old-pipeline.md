# WP-07: Disconnect Old Pipeline & Data Reset

**Phase:** 4
**Depends on:** WP-06 (Cron Pipeline Orchestrator)
**Complexity:** Low

## Goal

Remove the fire-and-forget per-message FRF extraction call from `batch_upsert()` in the communications service, and create a migration that clears all previously extracted FRFs so the new pipeline can reprocess everything from scratch.

## Background

The current `batch_upsert()` function in `packages/backend/src/services/communications.ts` (line 196-203) calls `process_communications(inserted_ids)` after inserting new communications. This triggers per-message fire-and-forget extraction via `packages/backend/src/services/ai/pipeline.ts`. With the new cron-based pipeline (WP-06), this call is no longer needed — new communications will be picked up by the next cron run via `frf_processed_at IS NULL`.

The data reset migration soft-deletes all `source = 'extracted'` facts and relationships, and hard-deletes all `type = 'content_detected'` followups. Manual FRFs are preserved.

**Existing patterns to follow:**
- `packages/backend/src/services/communications.ts` — `batch_upsert()` function (lines 196-203 to remove)
- `packages/backend/src/db/migrations/007_relationships.sql` — migration format

## Scope

**In scope:**
- Modify `packages/backend/src/services/communications.ts`:
  - Remove the `process_communications(inserted_ids)` call from `batch_upsert()` (lines 194-203)
  - Remove the import of `process_communications` from `'./ai/pipeline.js'`
- Create migration `009_clear_extracted_frfs.sql`:
  - Soft-delete all extracted facts: `UPDATE facts SET deleted_at = NOW() WHERE source = 'extracted' AND deleted_at IS NULL`
  - Soft-delete all extracted relationships: `UPDATE relationships SET deleted_at = NOW() WHERE source = 'extracted' AND deleted_at IS NULL`
  - Delete all content-detected followups: `DELETE FROM followups WHERE type = 'content_detected'`
- Optionally: remove or deprecate the `process_communications()` function in `pipeline.ts` (or keep for backward compat)

**Out of scope (handled by other WPs):**
- The new cron pipeline — WP-06
- All other pipeline modules — WP-02 through WP-05

## Key Files

**Create:**
- `packages/backend/src/db/migrations/009_clear_extracted_frfs.sql` — data reset migration

**Modify:**
- `packages/backend/src/services/communications.ts` — remove fire-and-forget pipeline call from `batch_upsert()`

**Reference (read, don't modify):**
- `packages/backend/src/services/ai/pipeline.ts` — old pipeline (no longer called from batch_upsert)

## Technical Details

### Code to Remove from communications.ts

Remove lines 194-203:

```typescript
// REMOVE THIS BLOCK:
// Process newly inserted communications through AI pipeline (async, non-blocking)
// AI failures should not affect the batch upsert result
if (inserted_ids.length > 0) {
  process_communications(inserted_ids).catch((error) => {
    logger.error('AI pipeline error during batch upsert', {
      error: error instanceof Error ? error.message : 'Unknown error',
      communication_count: inserted_ids.length,
    });
  });
}
```

Also remove the import at line 8:
```typescript
import { process_communications } from './ai/pipeline.js';
```

The `inserted_ids` array tracking can stay (it's used for the return value) or be cleaned up if no longer needed.

### Migration SQL

```sql
-- Clear all AI-extracted FRFs to allow reprocessing through new pipeline
-- Manual and addressbook FRFs are preserved

-- Soft-delete all extracted facts
UPDATE facts SET deleted_at = NOW()
WHERE source = 'extracted' AND deleted_at IS NULL;

-- Soft-delete all extracted relationships
UPDATE relationships SET deleted_at = NOW()
WHERE source = 'extracted' AND deleted_at IS NULL;

-- Hard-delete content-detected followups (no soft-delete column on followups)
DELETE FROM followups WHERE type = 'content_detected';
```

Note: The `followups` table uses hard deletes (it has `completed` flag but no `deleted_at` column) while facts and relationships use soft deletes.

### Sentiment & Embedding Processing

The `batch_upsert()` also triggers sentiment analysis and embedding generation indirectly via `process_communications()`. Those calls happen inside `process_communications()` (pipeline.ts lines 57-73). After removing the pipeline call:

- **Sentiment analysis**: Still happens if the sentiment pipeline is preserved elsewhere. The old pipeline.ts function handles this. If we remove the call from batch_upsert, sentiment analysis for new communications will also stop. However, the spec does NOT mention sentiment — it's orthogonal to FRF. Consider keeping a separate call for sentiment and embeddings, or moving them to the cron job.

- **Communication embeddings**: `queue_for_embedding(id)` in pipeline.ts queues communication content embeddings (separate from fact value embeddings). The backfill endpoint exists for these.

**Decision**: Keep the sentiment analysis and communication embedding calls. Only remove the FRF extraction call. This means instead of removing the entire `process_communications` call, we should modify it:

Option A: Replace `process_communications(inserted_ids)` with direct calls to sentiment and embedding only
Option B: Modify `process_communications()` in pipeline.ts to skip extraction and only do sentiment + embedding

Option A is cleaner. Replace the removed block with:

```typescript
if (inserted_ids.length > 0) {
  // Queue sentiment analysis and embeddings (FRF extraction handled by cron)
  for (const id of inserted_ids) {
    analyze_communication_sentiment(id, /* need content */)
      .catch(err => logger.error('Sentiment error', { communication_id: id, error: err.message }));
    queue_for_embedding(id);
  }
}
```

However, this requires the content for sentiment analysis which we'd need to track. The simpler approach is Option B: modify `process_communications()` to remove the extraction call but keep sentiment and embedding.

The implementing agent should choose the cleanest approach.

## Acceptance Criteria

- [ ] `batch_upsert()` no longer triggers FRF extraction for new communications
- [ ] Sentiment analysis and communication embedding still work for new communications
- [ ] Migration `009_clear_extracted_frfs.sql` exists and runs without error
- [ ] All extracted facts are soft-deleted (`deleted_at = NOW()`)
- [ ] All extracted relationships are soft-deleted
- [ ] All `content_detected` followups are deleted
- [ ] Manual and addressbook facts/relationships are NOT affected
- [ ] Manual and time_based followups are NOT affected
- [ ] TypeScript compiles with no errors
- [ ] No regressions in existing tests

## Verification Commands

```bash
# Run all tests
cd packages/backend && npx vitest run

# Type check
cd packages/backend && npx tsc --noEmit

# Lint
cd packages/backend && npx eslint src/services/communications.ts
```
