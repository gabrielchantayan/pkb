# WP-05: Followup Cutoff & Relationship Label Cleanup

**Phase:** 2
**Depends on:** WP-01 (DB Migration & Shared Types)
**Complexity:** Low

## Goal

Implement the 3-month followup cutoff that prevents creation of followups from old messages, and ensure relationship label validation allows free-form strings (removing any enum constraints in Zod schemas). These are two small, related changes grouped into one WP.

## Background

### Followup Cutoff

The current system creates `content_detected` followups from AI extraction with no age check on the source communication. The spec requires: if a communication's `timestamp` is more than 90 days (configurable via `FRF_FOLLOWUP_CUTOFF_DAYS`) before NOW(), do NOT create the followup. This applies to both batch import and ongoing processing.

The followup creation function is `create_content_detected_followup()` in `packages/backend/src/services/followups.ts`. It takes `contact_id`, `communication_id`, `reason`, and `suggested_date`. It does NOT currently receive the communication's timestamp, so the function needs to either accept the timestamp as a parameter or look it up.

### Relationship Labels

The current relationship schema in `packages/backend/src/schemas/relationships.ts` already uses `z.string().min(1)` for the label field — there is no enum constraint to remove. The relationship type in `packages/shared/src/types/relationship.ts` already uses `label: string`. The database table (migration 007) also uses `TEXT` with no CHECK constraint.

The frontend relationship component in `packages/frontend/components/contact-detail/relationships-section.tsx` has `COMMON_LABELS` array for the dropdown but already supports custom labels via a "Custom..." option.

So the relationship label changes are minimal — mainly updating the `COMMON_LABELS` list in the frontend (handled in WP-08) and the extraction prompt's suggested labels (handled in WP-03). The main thing to verify here is that no hidden enum constraints exist.

**Existing patterns to follow:**
- `packages/backend/src/services/followups.ts` — `create_content_detected_followup()` function
- `packages/backend/src/services/ai/extraction.ts` — where `create_content_detected_followup()` is called

## Scope

**In scope:**
- Modify `create_content_detected_followup()` in `packages/backend/src/services/followups.ts`:
  - Add `communication_timestamp` parameter (Date or string)
  - Check if `communication_timestamp` is more than `FRF_FOLLOWUP_CUTOFF_DAYS` days before NOW()
  - If too old, return null without creating the followup
  - Log a debug message when skipping due to cutoff
- Update all callers of `create_content_detected_followup()` to pass the communication timestamp
- Create a helper function `is_within_followup_cutoff(timestamp: Date, cutoff_days: number): boolean`
- Verify no hidden relationship label enum constraints exist anywhere (Zod, DB, types)
- Add unit tests for the cutoff logic

**Out of scope (handled by other WPs):**
- FRF config vars (including `FRF_FOLLOWUP_CUTOFF_DAYS`) — WP-01
- Updated extraction prompt with new relationship label suggestions — WP-03
- Frontend relationship label display updates — WP-08
- Cron pipeline integration — WP-06

## Key Files

**Modify:**
- `packages/backend/src/services/followups.ts` — add cutoff check to `create_content_detected_followup()`
- `packages/backend/src/services/ai/extraction.ts` — update call to `create_content_detected_followup()` to pass timestamp

**Create:**
- `packages/backend/src/services/followups.test.ts` — unit tests for cutoff logic (or add to existing test file if one exists)

**Reference (read, don't modify):**
- `packages/backend/src/config.ts` — `frf_followup_cutoff_days` config (after WP-01)
- `packages/backend/src/schemas/relationships.ts` — verify no enum constraint
- `packages/shared/src/types/relationship.ts` — verify label is free-form string
- `packages/backend/src/db/migrations/007_relationships.sql` — verify no CHECK constraint on label

## Technical Details

### Updated Function Signature

```typescript
export async function create_content_detected_followup(
  contact_id: string,
  communication_id: string,
  reason: string,
  suggested_date: string,
  communication_timestamp: Date  // NEW parameter
): Promise<Followup | null>
```

### Cutoff Check

```typescript
function is_within_followup_cutoff(timestamp: Date, cutoff_days: number): boolean {
  const cutoff_date = new Date();
  cutoff_date.setDate(cutoff_date.getDate() - cutoff_days);
  return timestamp >= cutoff_date;
}
```

At the top of `create_content_detected_followup()`:
```typescript
if (!is_within_followup_cutoff(communication_timestamp, config.frf_followup_cutoff_days)) {
  logger.debug('Skipping followup creation: communication too old', {
    communication_id,
    communication_timestamp,
    cutoff_days: config.frf_followup_cutoff_days,
  });
  return null;
}
```

### Callers to Update

1. `packages/backend/src/services/ai/extraction.ts` line 204: `create_content_detected_followup()` is called in the loop over `extraction.followups`. The communication's timestamp needs to be passed in. The `extract_from_communication()` function receives `communication_id` but not the timestamp — either:
   - Add timestamp as a parameter to `extract_from_communication()`
   - Look up the timestamp from the database inside `create_content_detected_followup()` using `communication_id`

   The cleaner approach is to add it as a parameter since the cron pipeline (WP-06) will have the timestamp available from the batch data.

### Verification: No Hidden Label Constraints

Confirm:
- `packages/backend/src/schemas/relationships.ts` — `label: z.string().min(1)` (no enum) ✓
- `packages/shared/src/types/relationship.ts` — `label: string` ✓
- `packages/backend/src/db/migrations/007_relationships.sql` — `label TEXT NOT NULL` (no CHECK) ✓
- `packages/backend/src/services/relationships.ts` — `label.toLowerCase()` normalization ✓

No changes needed for relationship labels.

## Acceptance Criteria

- [ ] `create_content_detected_followup()` accepts `communication_timestamp` parameter
- [ ] Followups from communications older than 90 days are NOT created (default cutoff)
- [ ] Followups from communications within 90 days ARE created normally
- [ ] Cutoff uses `FRF_FOLLOWUP_CUTOFF_DAYS` config value
- [ ] Debug log message when skipping due to cutoff
- [ ] All callers updated to pass communication timestamp
- [ ] `is_within_followup_cutoff()` helper is exported and tested
- [ ] Verified: no hidden relationship label enum constraints exist
- [ ] All new code has test coverage
- [ ] No regressions in existing tests

## Verification Commands

```bash
# Run unit tests
cd packages/backend && npx vitest run

# Type check
cd packages/backend && npx tsc --noEmit

# Lint
cd packages/backend && npx eslint src/services/followups.ts src/services/ai/extraction.ts
```
