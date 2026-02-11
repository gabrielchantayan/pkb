# WP-04: Semantic Deduplication & Auto-Supersede

**Phase:** 2
**Depends on:** WP-01 (DB Migration & Shared Types)
**Complexity:** High

## Goal

Implement embedding-based semantic deduplication for facts and auto-supersede logic for singular fact types. When a new fact is extracted, generate its embedding, compare against existing facts of the same type for the same contact, and skip insertion if cosine similarity >= 0.80. For singular types (birthday, location, job_title, company), auto-replace the existing value instead of creating conflicts.

## Background

The current fact creation in `packages/backend/src/services/facts.ts` uses `create_extracted_fact()` which checks for conflicts by exact value match. If a different value exists for the same contact + fact_type, it marks both as conflicting (`has_conflict = true`). There is no semantic comparison — "works at Google" and "employed at Google" would both be inserted as conflicts.

The spec introduces two new mechanisms:
1. **Semantic dedup**: For all fact types, generate embeddings and skip if cosine similarity >= 0.80 with an existing fact
2. **Auto-supersede**: For singular types (`birthday`, `location`, `job_title`, `company`), soft-delete the old fact and record history instead of creating a conflict

The embedding infrastructure already exists: `packages/backend/src/services/ai/gemini.ts` has `generate_embedding()` which returns 768-dim vectors using `text-embedding-004`. The `facts` table gets a `value_embedding vector(768)` column in WP-01's migration.

The `fact_history` table already exists with columns: `id`, `fact_id`, `value`, `structured_value`, `changed_at`, `change_source`.

**Existing patterns to follow:**
- `packages/backend/src/services/facts.ts` — `create_extracted_fact()` function (current conflict detection logic to be replaced)
- `packages/backend/src/services/ai/gemini.ts` — `generate_embedding()` function
- `packages/backend/src/services/ai/embeddings.ts` — embedding queue and batch processing patterns

## Scope

**In scope:**
- Create `packages/backend/src/services/ai/dedup.ts` with:
  - `check_semantic_duplicate(contact_id, fact_type, value, similarity_threshold)`: generates embedding, queries existing facts, returns whether duplicate found
  - `store_fact_embedding(fact_id, embedding)`: stores embedding on fact record
- Modify `packages/backend/src/services/facts.ts`:
  - Add new function `create_extracted_fact_v2()` that replaces conflict detection with:
    1. Semantic dedup check (skip if duplicate)
    2. Auto-supersede for singular types (soft-delete old, record history, insert new)
    3. Direct insert for plural types (after dedup passes)
  - Define `SINGULAR_FACT_TYPES` constant: `['birthday', 'location', 'job_title', 'company']`
  - Define `PLURAL_FACT_TYPES` constant: `['preference', 'tool', 'hobby', 'opinion', 'life_event', 'goal', 'email', 'phone', 'custom']`
- Create `packages/backend/src/services/ai/dedup.test.ts` with unit tests

**Out of scope (handled by other WPs):**
- Database migration adding `value_embedding` column — WP-01
- Embedding generation function itself — already exists in `gemini.ts`
- Integration into cron pipeline — WP-06
- Frontend display of superseded facts — WP-08

## Key Files

**Create:**
- `packages/backend/src/services/ai/dedup.ts` — semantic deduplication logic
- `packages/backend/src/services/ai/dedup.test.ts` — unit tests

**Modify:**
- `packages/backend/src/services/facts.ts` — add `create_extracted_fact_v2()` with dedup and supersede

**Reference (read, don't modify):**
- `packages/backend/src/services/ai/gemini.ts` — `generate_embedding()` function
- `packages/backend/src/db/index.ts` — `query()` and `get_pool()` functions
- `packages/backend/src/services/ai/embeddings.ts` — embedding patterns

## Technical Details

### Semantic Dedup Process

1. Generate embedding for the new fact's `value` using `generate_embedding(value)`
2. If embedding generation fails, log warning and skip dedup (insert fact without embedding)
3. Query existing facts for same `contact_id` + `fact_type` that have embeddings:

```sql
SELECT id, value, value_embedding
FROM facts
WHERE contact_id = $1
  AND fact_type = $2
  AND deleted_at IS NULL
  AND value_embedding IS NOT NULL
```

4. Compute cosine similarity between new embedding and each existing embedding
5. Cosine similarity formula: `1 - cosine_distance`. With pgvector: `1 - (new_embedding <=> existing_embedding)`
6. Alternatively, query using pgvector's cosine distance operator directly:

```sql
SELECT id, value, 1 - (value_embedding <=> $3::vector) AS similarity
FROM facts
WHERE contact_id = $1
  AND fact_type = $2
  AND deleted_at IS NULL
  AND value_embedding IS NOT NULL
ORDER BY value_embedding <=> $3::vector
LIMIT 1
```

7. If `similarity >= threshold` (default 0.80): return `{ is_duplicate: true, matching_fact_id: ... }`
8. Otherwise: return `{ is_duplicate: false }`

### Auto-Supersede Process (Singular Types)

When inserting a fact of a singular type (`birthday`, `location`, `job_title`, `company`):

1. Find existing active (non-deleted) fact of same `fact_type` for that `contact_id`
2. If exists and value differs (not a semantic duplicate — dedup check already passed):
   - Soft-delete old fact: `UPDATE facts SET deleted_at = NOW() WHERE id = $1`
   - Record in `fact_history`: `INSERT INTO fact_history (fact_id, value, structured_value, changed_at, change_source) VALUES ($1, $2, $3, NOW(), 'superseded')`
3. Insert new fact (with embedding stored)
4. No `has_conflict` flag — supersede replaces conflict detection for singular types

### Auto-Supersede Process (Plural Types)

For plural types: just insert the new fact (dedup already passed). No conflict detection, no supersede. Multiple values coexist.

### create_extracted_fact_v2 Function

```typescript
async function create_extracted_fact_v2(
  communication_id: string,
  input: ExtractedFactInput,
  config: { dedup_similarity: number }
): Promise<{ action: 'inserted' | 'skipped_duplicate' | 'superseded'; fact?: Fact }>
```

Flow:
1. Generate embedding for `input.value`
2. Check semantic duplicate (skip if duplicate found)
3. If singular type: check for existing fact, supersede if different value
4. Insert new fact with embedding
5. Return action taken

### Embedding Storage

Store embedding as the `value_embedding` column value. The pgvector extension expects the vector as a string like `'[0.1, 0.2, ...]'` or can use parameterized query with `$1::vector`.

```sql
INSERT INTO facts (..., value_embedding) VALUES (..., $N::vector)
```

Where `$N` is `JSON.stringify(embedding)` (the array serialized as a JSON array string, which pgvector accepts).

## Acceptance Criteria

- [ ] `check_semantic_duplicate()` correctly identifies duplicates at >= 0.80 similarity
- [ ] `check_semantic_duplicate()` correctly allows non-duplicates at < 0.80 similarity
- [ ] Embedding generation failure does not block fact insertion (logs warning, skips dedup)
- [ ] `create_extracted_fact_v2()` supersedes old singular-type facts (soft-delete + history)
- [ ] `change_source` is set to `'superseded'` in `fact_history` for auto-superseded facts
- [ ] Plural-type facts accumulate (no supersede, no conflict)
- [ ] Embedding is stored on the newly created fact
- [ ] `SINGULAR_FACT_TYPES` and `PLURAL_FACT_TYPES` constants are exported and correct
- [ ] Tests cover: duplicate detection, non-duplicate insertion, supersede, plural accumulation, embedding failure fallback
- [ ] All new code has test coverage
- [ ] No regressions in existing tests

## Verification Commands

```bash
# Run unit tests
cd packages/backend && npx vitest run src/services/ai/dedup.test.ts

# Run all tests
cd packages/backend && npx vitest run

# Type check
cd packages/backend && npx tsc --noEmit
```
