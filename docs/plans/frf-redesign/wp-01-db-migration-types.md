# WP-01: Database Migration & Shared Types

**Phase:** 1
**Depends on:** None
**Complexity:** Medium

## Goal

Create the database migration that adds `frf_processed_at` to communications, `value_embedding` to facts, expands fact type validation, and update all shared TypeScript types and backend schemas/config to support the new fact types and FRF configuration. This is the foundational work that all other WPs depend on.

## Background

The current system has 7 fact types (`birthday`, `location`, `job_title`, `company`, `email`, `phone`, `custom`) defined in `packages/shared/src/types/fact.ts` and validated in `packages/backend/src/schemas/facts.ts`. The spec adds 6 new types: `preference`, `tool`, `hobby`, `opinion`, `life_event`, `goal`.

The communications table currently has no processing-state tracking — the spec adds `frf_processed_at TIMESTAMPTZ` to track which communications have been through the FRF pipeline.

The facts table needs a `value_embedding vector(768)` column for semantic deduplication (pgvector is already enabled — see migration 001).

The config currently has `gemini_api_key`, `GEMINI_FLASH_MODEL`, `GEMINI_PRO_MODEL`, `GEMINI_EMBEDDING_MODEL` env vars. The spec adds 9 new FRF-specific config vars.

The `FactSource` type currently only includes `'extracted' | 'manual'` but the database also allows `'addressbook'` (added in migration 006). This should be fixed.

**Existing patterns to follow:**
- `packages/backend/src/db/migrations/007_relationships.sql` — most recent migration, shows SQL migration style
- `packages/backend/src/config.ts` — env var loading pattern with `get_env()` helper
- `packages/shared/src/types/fact.ts` — type definition style
- `packages/backend/src/schemas/facts.ts` — Zod schema style

## Scope

**In scope:**
- Create migration `008_frf_redesign.sql`:
  - Add `frf_processed_at TIMESTAMPTZ` to `communications` table
  - Create partial index `idx_communications_frf_unprocessed` on `communications (contact_id, timestamp) WHERE frf_processed_at IS NULL`
  - Add `value_embedding vector(768)` to `facts` table
  - Create IVFFlat index `idx_facts_embedding` on `facts USING ivfflat (value_embedding vector_cosine_ops)` (note: this index requires at least some rows; use `WITH (lists = 10)` or similar small value since the dataset is small)
- Update `packages/shared/src/types/fact.ts`:
  - Add `'preference' | 'tool' | 'hobby' | 'opinion' | 'life_event' | 'goal'` to `FactType` union
  - Add `'addressbook'` to `FactSource` union (fixing existing mismatch with DB)
  - Add `'preference'` to `FactCategory` union (new types map to `'preference'` category)
- Update `packages/backend/src/schemas/facts.ts`:
  - Add new fact types to the `fact_type_schema` Zod enum
  - Add `'addressbook'` to `fact_source_schema` Zod enum
- Update `packages/backend/src/services/facts.ts`:
  - Add new fact types to `FACT_CATEGORIES` mapping (map `preference`, `tool`, `hobby`, `opinion`, `life_event`, `goal` to `'preference'` category)
- Update `packages/backend/src/config.ts`:
  - Add FRF config vars to `Config` interface and `load_config()`:
    - `frf_cron_interval` (string, default `'*/30 * * * *'`)
    - `frf_batch_size` (number, default `15`)
    - `frf_batch_overlap` (number, default `2`)
    - `frf_context_messages` (number, default `5`)
    - `frf_confidence_threshold` (number, default `0.75`)
    - `frf_dedup_similarity` (number, default `0.80`)
    - `frf_followup_cutoff_days` (number, default `90`)
    - `frf_batch_delay_ms` (number, default `300`)

**Out of scope (handled by other WPs):**
- Extraction prompt changes — WP-03
- Deduplication logic using embeddings — WP-04
- Followup cutoff logic — WP-05
- Cron job implementation — WP-06
- Clearing old extracted FRFs — WP-07
- Frontend display of new types — WP-08

## Key Files

**Create:**
- `packages/backend/src/db/migrations/008_frf_redesign.sql` — migration for schema changes

**Modify:**
- `packages/shared/src/types/fact.ts` — expand FactType, FactSource, FactCategory unions
- `packages/backend/src/schemas/facts.ts` — expand Zod enums for fact types and sources
- `packages/backend/src/services/facts.ts` — expand FACT_CATEGORIES mapping
- `packages/backend/src/config.ts` — add FRF config vars to Config interface and load_config

**Reference (read, don't modify):**
- `packages/backend/src/db/migrations/007_relationships.sql` — migration style reference
- `packages/backend/src/db/migrations/001_initial_schema.sql` — original schema, confirms pgvector extension exists

## Technical Details

### Migration SQL

The migration must:
1. Add `frf_processed_at TIMESTAMPTZ` column to `communications` (nullable, defaults NULL = unprocessed)
2. Create partial index for efficient cron queries: `CREATE INDEX idx_communications_frf_unprocessed ON communications (contact_id, timestamp) WHERE frf_processed_at IS NULL`
3. Add `value_embedding vector(768)` column to `facts` (nullable)
4. Create vector similarity index: `CREATE INDEX idx_facts_embedding ON facts USING ivfflat (value_embedding vector_cosine_ops) WITH (lists = 10)` — note this may fail if the facts table is empty; consider wrapping in a DO block or creating the index as `CONCURRENTLY` after data exists. Alternatively, skip the IVFFlat index for now and use exact nearest-neighbor search (no index needed for small datasets), since the pgvector extension already supports this.

### Updated Type Definitions

```typescript
// FactType — add 6 new types
type FactType = 'birthday' | 'location' | 'job_title' | 'company' | 'email' | 'phone'
  | 'preference' | 'tool' | 'hobby' | 'opinion' | 'life_event' | 'goal' | 'custom';

// FactCategory — add 'preference'
type FactCategory = 'basic_info' | 'preference' | 'custom';

// FactSource — add 'addressbook'
type FactSource = 'extracted' | 'manual' | 'addressbook';
```

### Category Mapping for New Types

```typescript
const FACT_CATEGORIES: Record<string, string> = {
  birthday: 'basic_info',
  location: 'basic_info',
  job_title: 'basic_info',
  company: 'basic_info',
  email: 'basic_info',
  phone: 'basic_info',
  preference: 'preference',
  tool: 'preference',
  hobby: 'preference',
  opinion: 'preference',
  life_event: 'preference',
  goal: 'preference',
  custom: 'custom',
};
```

### Config Interface Extension

```typescript
interface Config {
  // ... existing fields ...
  frf_cron_interval: string;
  frf_batch_size: number;
  frf_batch_overlap: number;
  frf_context_messages: number;
  frf_confidence_threshold: number;
  frf_dedup_similarity: number;
  frf_followup_cutoff_days: number;
  frf_batch_delay_ms: number;
}
```

All new config values use `get_env()` with defaults, parsed with `parseInt`/`parseFloat` as appropriate.

## Acceptance Criteria

- [ ] Migration `008_frf_redesign.sql` runs without error on the existing schema
- [ ] `communications` table has `frf_processed_at` column (nullable TIMESTAMPTZ)
- [ ] Partial index `idx_communications_frf_unprocessed` exists
- [ ] `facts` table has `value_embedding` column (nullable vector(768))
- [ ] `FactType` in shared types includes all 13 types
- [ ] `FactSource` includes `'addressbook'`
- [ ] `FactCategory` includes `'preference'`
- [ ] `fact_type_schema` Zod enum includes all 13 types
- [ ] `FACT_CATEGORIES` mapping covers all 13 types
- [ ] Config loads all 8 FRF env vars with correct defaults
- [ ] All new code has test coverage
- [ ] No regressions in existing tests

## Verification Commands

```bash
# Run unit tests
cd packages/backend && npx vitest run

# Type check
cd packages/backend && npx tsc --noEmit
cd packages/shared && npx tsc --noEmit

# Lint
cd packages/backend && npx eslint src/
```
