# Feature: Search

## Overview

Global search across contacts, communications, facts, and notes. Combines full-text search (PostgreSQL tsvector), filters, and semantic search (vector embeddings from Gemini).

## Dependencies

- **Requires**: 01-project-foundation, 02-authentication, 03-contacts-core, 04-communications, 05-facts-system, 06-notes
- **Soft dependency**: 10-ai-integration (for semantic search embeddings)

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Full-text | PostgreSQL tsvector + GIN | Built-in, fast, good enough |
| Semantic | pgvector + Gemini embeddings | Specified in SPEC |
| Combined results | Weighted union | Balance keyword and semantic |
| Highlights | ts_headline() | Built-in PostgreSQL |

## Search Modes

1. **Keyword search**: Traditional full-text search with tsvector
2. **Semantic search**: Vector similarity with embeddings
3. **Combined search**: Merge results from both, weighted by relevance

## API Endpoints

### Global Search
```
POST /api/search
Body:
{
  query: string,
  mode?: 'keyword' | 'semantic' | 'combined',  // default: combined
  types?: ('contacts' | 'communications' | 'facts' | 'notes')[],  // default: all
  filters?: {
    contact_id?: UUID,
    source?: string,
    start_date?: ISO date,
    end_date?: ISO date,
    tags?: UUID[],
    groups?: UUID[]
  },
  limit?: number  // default: 20
}

Response:
{
  results: {
    type: 'contact' | 'communication' | 'fact' | 'note',
    id: UUID,
    score: number,
    highlights: string[],
    data: Contact | Communication | Fact | Note,
    contact?: {  // included for non-contact results
      id: UUID,
      displayName: string
    }
  }[],
  totalEstimate: number
}
```

### Communication Search (specialized)
```
GET /api/communications/search
Query params:
  - q: string
  - contact_id: UUID
  - source: string
  - start_date: ISO date
  - end_date: ISO date
  - limit: number

Response:
{
  results: {
    communication: Communication,
    highlights: string[],
    score: number
  }[]
}
```

## Database Setup

### Full-Text Search Indexes

```sql
-- Migration: Add tsvector columns and indexes

-- Communications (may already exist from 04-communications)
ALTER TABLE communications ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(content, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_communications_tsv ON communications USING GIN (content_tsv);

-- Contacts
ALTER TABLE contacts ADD COLUMN display_name_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', display_name)) STORED;
CREATE INDEX idx_contacts_tsv ON contacts USING GIN (display_name_tsv);

-- Facts
ALTER TABLE facts ADD COLUMN value_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', value)) STORED;
CREATE INDEX idx_facts_tsv ON facts USING GIN (value_tsv);

-- Notes
ALTER TABLE notes ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX idx_notes_tsv ON notes USING GIN (content_tsv);
```

### Vector Index for Semantic Search

```sql
-- Migration: Add vector index (requires embeddings to be populated)

-- Index for approximate nearest neighbor search
CREATE INDEX idx_communications_embedding ON communications
  USING ivfflat (content_embedding vector_cosine_ops)
  WITH (lists = 100);

-- Note: lists parameter should be ~sqrt(row_count) for optimal performance
-- May need adjustment as data grows
```

## Implementation

### Search Service

```typescript
// src/services/search.ts

import { generateEmbedding } from './ai'; // from AI Integration feature

export async function search(params: SearchParams): Promise<SearchResults> {
  const { query, mode = 'combined', types, filters, limit = 20 } = params;

  if (mode === 'keyword') {
    return keywordSearch(query, types, filters, limit);
  } else if (mode === 'semantic') {
    return semanticSearch(query, types, filters, limit);
  } else {
    return combinedSearch(query, types, filters, limit);
  }
}

async function keywordSearch(
  query: string,
  types: string[] | undefined,
  filters: SearchFilters | undefined,
  limit: number
): Promise<SearchResults> {
  const searchQuery = query.split(' ').join(' & '); // AND by default
  const results: SearchResult[] = [];

  // Search contacts
  if (!types || types.includes('contacts')) {
    const contacts = await db.query(`
      SELECT c.*,
             ts_rank(c.display_name_tsv, plainto_tsquery('english', $1)) as score,
             ts_headline('english', c.display_name, plainto_tsquery('english', $1)) as headline
      FROM contacts c
      WHERE c.deleted_at IS NULL
        AND c.display_name_tsv @@ plainto_tsquery('english', $1)
        ${buildContactFilters(filters)}
      ORDER BY score DESC
      LIMIT $2
    `, [query, limit]);

    results.push(...contacts.rows.map(r => ({
      type: 'contact' as const,
      id: r.id,
      score: r.score,
      highlights: [r.headline],
      data: r
    })));
  }

  // Search communications
  if (!types || types.includes('communications')) {
    const comms = await db.query(`
      SELECT cm.*,
             c.display_name as contact_name,
             ts_rank(cm.content_tsv, plainto_tsquery('english', $1)) as score,
             ts_headline('english', cm.content, plainto_tsquery('english', $1),
               'MaxFragments=3, MaxWords=30, MinWords=10') as headline
      FROM communications cm
      JOIN contacts c ON c.id = cm.contact_id
      WHERE c.deleted_at IS NULL
        AND cm.content_tsv @@ plainto_tsquery('english', $1)
        ${buildCommunicationFilters(filters)}
      ORDER BY score DESC
      LIMIT $2
    `, [query, limit]);

    results.push(...comms.rows.map(r => ({
      type: 'communication' as const,
      id: r.id,
      score: r.score,
      highlights: [r.headline],
      data: r,
      contact: { id: r.contact_id, displayName: r.contact_name }
    })));
  }

  // Search facts
  if (!types || types.includes('facts')) {
    const facts = await db.query(`
      SELECT f.*,
             c.display_name as contact_name,
             ts_rank(f.value_tsv, plainto_tsquery('english', $1)) as score,
             ts_headline('english', f.value, plainto_tsquery('english', $1)) as headline
      FROM facts f
      JOIN contacts c ON c.id = f.contact_id
      WHERE f.deleted_at IS NULL AND c.deleted_at IS NULL
        AND f.value_tsv @@ plainto_tsquery('english', $1)
        ${buildFactFilters(filters)}
      ORDER BY score DESC
      LIMIT $2
    `, [query, limit]);

    results.push(...facts.rows.map(r => ({
      type: 'fact' as const,
      id: r.id,
      score: r.score,
      highlights: [r.headline],
      data: r,
      contact: { id: r.contact_id, displayName: r.contact_name }
    })));
  }

  // Search notes
  if (!types || types.includes('notes')) {
    const notes = await db.query(`
      SELECT n.*,
             c.display_name as contact_name,
             ts_rank(n.content_tsv, plainto_tsquery('english', $1)) as score,
             ts_headline('english', n.content, plainto_tsquery('english', $1),
               'MaxFragments=3, MaxWords=30, MinWords=10') as headline
      FROM notes n
      JOIN contacts c ON c.id = n.contact_id
      WHERE n.deleted_at IS NULL AND c.deleted_at IS NULL
        AND n.content_tsv @@ plainto_tsquery('english', $1)
        ${buildNoteFilters(filters)}
      ORDER BY score DESC
      LIMIT $2
    `, [query, limit]);

    results.push(...notes.rows.map(r => ({
      type: 'note' as const,
      id: r.id,
      score: r.score,
      highlights: [r.headline],
      data: r,
      contact: { id: r.contact_id, displayName: r.contact_name }
    })));
  }

  // Sort combined results by score
  results.sort((a, b) => b.score - a.score);

  return {
    results: results.slice(0, limit),
    totalEstimate: results.length
  };
}
```

### Semantic Search

```typescript
// src/services/search.ts (continued)

async function semanticSearch(
  query: string,
  types: string[] | undefined,
  filters: SearchFilters | undefined,
  limit: number
): Promise<SearchResults> {
  // Generate embedding for query
  const queryEmbedding = await generateEmbedding(query);

  if (!queryEmbedding) {
    // Fallback to keyword search if embedding fails
    return keywordSearch(query, types, filters, limit);
  }

  const results: SearchResult[] = [];

  // Currently only communications have embeddings
  if (!types || types.includes('communications')) {
    const comms = await db.query(`
      SELECT cm.*,
             c.display_name as contact_name,
             1 - (cm.content_embedding <=> $1) as score
      FROM communications cm
      JOIN contacts c ON c.id = cm.contact_id
      WHERE c.deleted_at IS NULL
        AND cm.content_embedding IS NOT NULL
        ${buildCommunicationFilters(filters)}
      ORDER BY cm.content_embedding <=> $1
      LIMIT $2
    `, [JSON.stringify(queryEmbedding), limit]);

    results.push(...comms.rows.map(r => ({
      type: 'communication' as const,
      id: r.id,
      score: r.score,
      highlights: [truncate(r.content, 200)],
      data: r,
      contact: { id: r.contact_id, displayName: r.contact_name }
    })));
  }

  return {
    results: results.slice(0, limit),
    totalEstimate: results.length
  };
}
```

### Combined Search

```typescript
// src/services/search.ts (continued)

async function combinedSearch(
  query: string,
  types: string[] | undefined,
  filters: SearchFilters | undefined,
  limit: number
): Promise<SearchResults> {
  // Run both searches in parallel
  const [keywordResults, semanticResults] = await Promise.all([
    keywordSearch(query, types, filters, limit * 2),
    semanticSearch(query, types, filters, limit * 2)
  ]);

  // Merge and deduplicate results
  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  // Combine with weighted scoring
  const KEYWORD_WEIGHT = 0.6;
  const SEMANTIC_WEIGHT = 0.4;

  // Index semantic results by id for lookup
  const semanticMap = new Map(
    semanticResults.results.map(r => [`${r.type}:${r.id}`, r.score])
  );

  for (const result of keywordResults.results) {
    const key = `${result.type}:${result.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const semanticScore = semanticMap.get(key) || 0;
    const combinedScore = (result.score * KEYWORD_WEIGHT) + (semanticScore * SEMANTIC_WEIGHT);

    merged.push({ ...result, score: combinedScore });
  }

  // Add semantic-only results
  for (const result of semanticResults.results) {
    const key = `${result.type}:${result.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    merged.push({ ...result, score: result.score * SEMANTIC_WEIGHT });
  }

  // Sort by combined score
  merged.sort((a, b) => b.score - a.score);

  return {
    results: merged.slice(0, limit),
    totalEstimate: merged.length
  };
}
```

### Filter Builders

```typescript
// src/services/search.ts (continued)

function buildContactFilters(filters?: SearchFilters): string {
  if (!filters) return '';

  const conditions: string[] = [];

  if (filters.tags?.length) {
    conditions.push(`EXISTS (
      SELECT 1 FROM contact_tags ct
      WHERE ct.contact_id = c.id AND ct.tag_id = ANY($tags)
    )`);
  }

  if (filters.groups?.length) {
    conditions.push(`EXISTS (
      SELECT 1 FROM contact_groups cg
      WHERE cg.contact_id = c.id AND cg.group_id = ANY($groups)
    )`);
  }

  return conditions.length ? 'AND ' + conditions.join(' AND ') : '';
}

function buildCommunicationFilters(filters?: SearchFilters): string {
  if (!filters) return '';

  const conditions: string[] = [];

  if (filters.contact_id) {
    conditions.push(`cm.contact_id = '${filters.contact_id}'`);
  }

  if (filters.source) {
    conditions.push(`cm.source = '${filters.source}'`);
  }

  if (filters.start_date) {
    conditions.push(`cm.timestamp >= '${filters.start_date}'`);
  }

  if (filters.end_date) {
    conditions.push(`cm.timestamp <= '${filters.end_date}'`);
  }

  return conditions.length ? 'AND ' + conditions.join(' AND ') : '';
}

// Similar for buildFactFilters, buildNoteFilters...
```

## Implementation Steps

1. Add migration for tsvector columns and GIN indexes
2. Add migration for vector index (after embeddings exist)
3. Create `src/services/search.ts` with all search modes
4. Create `src/routes/search.ts` with search endpoint
5. Implement filter builders for each entity type
6. Implement result merging for combined search
7. Add query parsing (support quotes, exclusions later)
8. Add validation schemas
9. Test keyword search across all entity types
10. Test semantic search (after AI Integration)
11. Test combined search result merging

## Acceptance Criteria

- [ ] `POST /api/search` returns results from all entity types
- [ ] Results include relevant highlights/snippets
- [ ] Keyword search uses PostgreSQL full-text search
- [ ] Semantic search uses vector similarity (when embeddings exist)
- [ ] Combined search merges results with weighted scores
- [ ] Filters work: contact_id, source, date range, tags, groups
- [ ] Results sorted by relevance score
- [ ] Search respects soft deletes (doesn't return deleted items)
- [ ] `GET /api/communications/search` provides communication-specific search

## Files to Create

| Path | Purpose |
|------|---------|
| `packages/backend/src/services/search.ts` | Search logic |
| `packages/backend/src/routes/search.ts` | Search endpoint |
| `packages/backend/src/schemas/search.ts` | Validation schemas |
| `packages/backend/src/db/migrations/004_search_indexes.sql` | FTS indexes |
| `packages/shared/src/types/search.ts` | TypeScript types |

## Notes for Implementation

- IMPORTANT: Filter builders must use parameterized queries to prevent SQL injection (examples above are simplified)
- Vector index requires data to exist first - may need to defer creation
- `ivfflat` index needs `lists` tuning based on data size
- Consider adding query suggestions/autocomplete later
- ts_headline options control snippet length and format
- Semantic search only works on communications initially (embeddings added there)
- Could expand semantic search to notes/facts in the future
