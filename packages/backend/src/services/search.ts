import { query } from '../db/index.js';
import { generate_embedding, is_ai_available } from './ai/index.js';
import type {
  SearchParams,
  SearchResults,
  SearchResult,
  SearchFilters,
  SearchEntityType,
  CommunicationSearchParams,
  CommunicationSearchResults,
  Contact,
  Communication,
  Fact,
  Note,
} from '@pkb/shared';

interface ContactSearchRow extends Contact {
  score: number;
  headline: string;
}

interface CommunicationSearchRow extends Communication {
  contact_name: string;
  score: number;
  headline: string;
}

interface FactSearchRow extends Fact {
  contact_name: string;
  score: number;
  headline: string;
}

interface NoteSearchRow extends Note {
  contact_name: string;
  score: number;
  headline: string;
}

interface SemanticCommunicationRow extends Communication {
  contact_name: string;
  score: number;
}

export async function search(params: SearchParams): Promise<SearchResults> {
  const { query: search_query, mode = 'combined', types, filters, limit = 20 } = params;

  if (mode === 'keyword') {
    return keyword_search(search_query, types, filters, limit);
  } else if (mode === 'semantic') {
    return semantic_search(search_query, types, filters, limit);
  } else {
    return combined_search(search_query, types, filters, limit);
  }
}

async function keyword_search(
  search_query: string,
  types: SearchEntityType[] | undefined,
  filters: SearchFilters | undefined,
  limit: number
): Promise<SearchResults> {
  const results: SearchResult[] = [];

  const search_types = types ?? ['contact', 'communication', 'fact', 'note'];

  const promises: Promise<void>[] = [];

  if (search_types.includes('contact')) {
    promises.push(
      search_contacts(search_query, filters, limit).then((r) => {
        results.push(...r);
      })
    );
  }

  if (search_types.includes('communication')) {
    promises.push(
      search_communications(search_query, filters, limit).then((r) => {
        results.push(...r);
      })
    );
  }

  if (search_types.includes('fact')) {
    promises.push(
      search_facts(search_query, filters, limit).then((r) => {
        results.push(...r);
      })
    );
  }

  if (search_types.includes('note')) {
    promises.push(
      search_notes(search_query, filters, limit).then((r) => {
        results.push(...r);
      })
    );
  }

  await Promise.all(promises);

  results.sort((a, b) => b.score - a.score);

  return {
    results: results.slice(0, limit),
    totalEstimate: results.length,
  };
}

async function search_contacts(
  search_query: string,
  filters: SearchFilters | undefined,
  limit: number
): Promise<SearchResult[]> {
  const values: unknown[] = [search_query, limit];
  let param_index = 3;

  const filter_conditions = build_contact_filters(filters, values, param_index);

  const sql = `
    SELECT c.*,
           ts_rank(c.display_name_tsv, plainto_tsquery('english', $1)) as score,
           ts_headline('english', c.display_name, plainto_tsquery('english', $1)) as headline
    FROM contacts c
    WHERE c.deleted_at IS NULL
      AND c.display_name_tsv @@ plainto_tsquery('english', $1)
      ${filter_conditions.clause}
    ORDER BY score DESC
    LIMIT $2
  `;

  const result = await query<ContactSearchRow>(sql, values);

  return result.rows.map((row) => ({
    type: 'contact' as const,
    id: row.id,
    score: row.score,
    highlights: [row.headline],
    data: row,
  }));
}

async function search_communications(
  search_query: string,
  filters: SearchFilters | undefined,
  limit: number
): Promise<SearchResult[]> {
  const values: unknown[] = [search_query, limit];
  let param_index = 3;

  const filter_conditions = build_communication_filters(filters, values, param_index);

  const sql = `
    SELECT cm.*,
           c.display_name as contact_name,
           ts_rank(cm.content_tsv, plainto_tsquery('english', $1)) as score,
           ts_headline('english', cm.content, plainto_tsquery('english', $1),
             'MaxFragments=3, MaxWords=30, MinWords=10') as headline
    FROM communications cm
    JOIN contacts c ON c.id = cm.contact_id
    WHERE c.deleted_at IS NULL
      AND cm.content_tsv @@ plainto_tsquery('english', $1)
      ${filter_conditions.clause}
    ORDER BY score DESC
    LIMIT $2
  `;

  const result = await query<CommunicationSearchRow>(sql, values);

  return result.rows.map((row) => ({
    type: 'communication' as const,
    id: row.id,
    score: row.score,
    highlights: [row.headline],
    data: row,
    contact: {
      id: row.contact_id!,
      displayName: row.contact_name,
    },
  }));
}

async function search_facts(
  search_query: string,
  filters: SearchFilters | undefined,
  limit: number
): Promise<SearchResult[]> {
  const values: unknown[] = [search_query, limit];
  let param_index = 3;

  const filter_conditions = build_fact_filters(filters, values, param_index);

  const sql = `
    SELECT f.*,
           c.display_name as contact_name,
           ts_rank(f.value_tsv, plainto_tsquery('english', $1)) as score,
           ts_headline('english', f.value, plainto_tsquery('english', $1)) as headline
    FROM facts f
    JOIN contacts c ON c.id = f.contact_id
    WHERE f.deleted_at IS NULL AND c.deleted_at IS NULL
      AND f.value_tsv @@ plainto_tsquery('english', $1)
      ${filter_conditions.clause}
    ORDER BY score DESC
    LIMIT $2
  `;

  const result = await query<FactSearchRow>(sql, values);

  return result.rows.map((row) => ({
    type: 'fact' as const,
    id: row.id,
    score: row.score,
    highlights: [row.headline],
    data: row,
    contact: {
      id: row.contact_id,
      displayName: row.contact_name,
    },
  }));
}

async function search_notes(
  search_query: string,
  filters: SearchFilters | undefined,
  limit: number
): Promise<SearchResult[]> {
  const values: unknown[] = [search_query, limit];
  let param_index = 3;

  const filter_conditions = build_note_filters(filters, values, param_index);

  const sql = `
    SELECT n.*,
           c.display_name as contact_name,
           ts_rank(n.content_tsv, plainto_tsquery('english', $1)) as score,
           ts_headline('english', n.content, plainto_tsquery('english', $1),
             'MaxFragments=3, MaxWords=30, MinWords=10') as headline
    FROM notes n
    JOIN contacts c ON c.id = n.contact_id
    WHERE n.deleted_at IS NULL AND c.deleted_at IS NULL
      AND n.content_tsv @@ plainto_tsquery('english', $1)
      ${filter_conditions.clause}
    ORDER BY score DESC
    LIMIT $2
  `;

  const result = await query<NoteSearchRow>(sql, values);

  return result.rows.map((row) => ({
    type: 'note' as const,
    id: row.id,
    score: row.score,
    highlights: [row.headline],
    data: row,
    contact: {
      id: row.contact_id,
      displayName: row.contact_name,
    },
  }));
}

async function semantic_search(
  search_query: string,
  types: SearchEntityType[] | undefined,
  filters: SearchFilters | undefined,
  limit: number
): Promise<SearchResults> {
  // Check if AI is available for embedding generation
  if (!is_ai_available()) {
    // Fall back to keyword search if no AI
    return keyword_search(search_query, types, filters, limit);
  }

  // Generate embedding for the query
  const query_embedding = await generate_embedding(search_query);

  if (!query_embedding) {
    // Fallback to keyword search if embedding fails
    return keyword_search(search_query, types, filters, limit);
  }

  const results: SearchResult[] = [];
  const search_types = types ?? ['contact', 'communication', 'fact', 'note'];

  // Currently only communications have embeddings
  if (search_types.includes('communication')) {
    const values: unknown[] = [JSON.stringify(query_embedding), limit];
    let param_index = 3;

    const filter_conditions = build_communication_filters(filters, values, param_index);

    const sql = `
      SELECT cm.*,
             c.display_name as contact_name,
             1 - (cm.content_embedding <=> $1::vector) as score
      FROM communications cm
      JOIN contacts c ON c.id = cm.contact_id
      WHERE c.deleted_at IS NULL
        AND cm.content_embedding IS NOT NULL
        ${filter_conditions.clause}
      ORDER BY cm.content_embedding <=> $1::vector
      LIMIT $2
    `;

    try {
      const result = await query<SemanticCommunicationRow>(sql, values);

      results.push(
        ...result.rows.map((row) => ({
          type: 'communication' as const,
          id: row.id,
          score: row.score,
          highlights: [truncate(row.content || '', 200)],
          data: row,
          contact: {
            id: row.contact_id!,
            displayName: row.contact_name,
          },
        }))
      );
    } catch {
      // If vector search fails (e.g., no pgvector extension), fall back to keyword
      return keyword_search(search_query, types, filters, limit);
    }
  }

  return {
    results: results.slice(0, limit),
    totalEstimate: results.length,
  };
}

function truncate(text: string, max_length: number): string {
  if (text.length <= max_length) return text;
  return text.slice(0, max_length - 3) + '...';
}

async function combined_search(
  search_query: string,
  types: SearchEntityType[] | undefined,
  filters: SearchFilters | undefined,
  limit: number
): Promise<SearchResults> {
  // Run both searches in parallel
  const [keyword_results, semantic_results] = await Promise.all([
    keyword_search(search_query, types, filters, limit * 2),
    semantic_search(search_query, types, filters, limit * 2),
  ]);

  // Since semantic search currently falls back to keyword search,
  // results would be identical. When embeddings are available,
  // this will properly merge keyword and semantic results.

  // Merge and deduplicate results
  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  const KEYWORD_WEIGHT = 0.6;
  const SEMANTIC_WEIGHT = 0.4;

  // Index semantic results by id for lookup
  const semantic_map = new Map(
    semantic_results.results.map((r) => [`${r.type}:${r.id}`, r.score])
  );

  for (const result of keyword_results.results) {
    const key = `${result.type}:${result.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const semantic_score = semantic_map.get(key) || 0;
    const combined_score = result.score * KEYWORD_WEIGHT + semantic_score * SEMANTIC_WEIGHT;

    merged.push({ ...result, score: combined_score });
  }

  // Add semantic-only results
  for (const result of semantic_results.results) {
    const key = `${result.type}:${result.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    merged.push({ ...result, score: result.score * SEMANTIC_WEIGHT });
  }

  merged.sort((a, b) => b.score - a.score);

  return {
    results: merged.slice(0, limit),
    totalEstimate: merged.length,
  };
}

// Communication-specific search for GET /api/communications/search
export async function search_communications_endpoint(
  params: CommunicationSearchParams
): Promise<CommunicationSearchResults> {
  const { q, contact_id, source, start_date, end_date, limit = 20 } = params;

  const values: unknown[] = [q];
  let param_index = 2;
  const conditions: string[] = [];

  if (contact_id) {
    values.push(contact_id);
    conditions.push(`cm.contact_id = $${param_index++}`);
  }

  if (source) {
    values.push(source);
    conditions.push(`cm.source = $${param_index++}`);
  }

  if (start_date) {
    values.push(start_date);
    conditions.push(`cm.timestamp >= $${param_index++}`);
  }

  if (end_date) {
    values.push(end_date);
    conditions.push(`cm.timestamp <= $${param_index++}`);
  }

  values.push(limit);
  const limit_param = param_index++;

  const filter_clause = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';

  const sql = `
    SELECT cm.*,
           ts_rank(cm.content_tsv, plainto_tsquery('english', $1)) as score,
           ts_headline('english', cm.content, plainto_tsquery('english', $1),
             'MaxFragments=3, MaxWords=30, MinWords=10') as headline
    FROM communications cm
    LEFT JOIN contacts c ON c.id = cm.contact_id
    WHERE cm.content_tsv @@ plainto_tsquery('english', $1)
      AND (c.deleted_at IS NULL OR cm.contact_id IS NULL)
      ${filter_clause}
    ORDER BY score DESC
    LIMIT $${limit_param}
  `;

  const result = await query<CommunicationSearchRow>(sql, values);

  return {
    results: result.rows.map((row) => ({
      communication: row,
      highlights: [row.headline],
      score: row.score,
    })),
  };
}

interface FilterResult {
  clause: string;
  param_index: number;
}

function build_contact_filters(
  filters: SearchFilters | undefined,
  values: unknown[],
  param_index: number
): FilterResult {
  if (!filters) return { clause: '', param_index };

  const conditions: string[] = [];

  if (filters.tags?.length) {
    values.push(filters.tags);
    conditions.push(`EXISTS (
      SELECT 1 FROM contact_tags ct
      WHERE ct.contact_id = c.id AND ct.tag_id = ANY($${param_index++})
    )`);
  }

  if (filters.groups?.length) {
    values.push(filters.groups);
    conditions.push(`EXISTS (
      SELECT 1 FROM contact_groups cg
      WHERE cg.contact_id = c.id AND cg.group_id = ANY($${param_index++})
    )`);
  }

  return {
    clause: conditions.length ? 'AND ' + conditions.join(' AND ') : '',
    param_index,
  };
}

function build_communication_filters(
  filters: SearchFilters | undefined,
  values: unknown[],
  param_index: number
): FilterResult {
  if (!filters) return { clause: '', param_index };

  const conditions: string[] = [];

  if (filters.contact_id) {
    values.push(filters.contact_id);
    conditions.push(`cm.contact_id = $${param_index++}`);
  }

  if (filters.source) {
    values.push(filters.source);
    conditions.push(`cm.source = $${param_index++}`);
  }

  if (filters.start_date) {
    values.push(filters.start_date);
    conditions.push(`cm.timestamp >= $${param_index++}`);
  }

  if (filters.end_date) {
    values.push(filters.end_date);
    conditions.push(`cm.timestamp <= $${param_index++}`);
  }

  return {
    clause: conditions.length ? 'AND ' + conditions.join(' AND ') : '',
    param_index,
  };
}

function build_fact_filters(
  filters: SearchFilters | undefined,
  values: unknown[],
  param_index: number
): FilterResult {
  if (!filters) return { clause: '', param_index };

  const conditions: string[] = [];

  if (filters.contact_id) {
    values.push(filters.contact_id);
    conditions.push(`f.contact_id = $${param_index++}`);
  }

  if (filters.tags?.length) {
    values.push(filters.tags);
    conditions.push(`EXISTS (
      SELECT 1 FROM contact_tags ct
      WHERE ct.contact_id = f.contact_id AND ct.tag_id = ANY($${param_index++})
    )`);
  }

  if (filters.groups?.length) {
    values.push(filters.groups);
    conditions.push(`EXISTS (
      SELECT 1 FROM contact_groups cg
      WHERE cg.contact_id = f.contact_id AND cg.group_id = ANY($${param_index++})
    )`);
  }

  return {
    clause: conditions.length ? 'AND ' + conditions.join(' AND ') : '',
    param_index,
  };
}

function build_note_filters(
  filters: SearchFilters | undefined,
  values: unknown[],
  param_index: number
): FilterResult {
  if (!filters) return { clause: '', param_index };

  const conditions: string[] = [];

  if (filters.contact_id) {
    values.push(filters.contact_id);
    conditions.push(`n.contact_id = $${param_index++}`);
  }

  if (filters.start_date) {
    values.push(filters.start_date);
    conditions.push(`n.created_at >= $${param_index++}`);
  }

  if (filters.end_date) {
    values.push(filters.end_date);
    conditions.push(`n.created_at <= $${param_index++}`);
  }

  if (filters.tags?.length) {
    values.push(filters.tags);
    conditions.push(`EXISTS (
      SELECT 1 FROM contact_tags ct
      WHERE ct.contact_id = n.contact_id AND ct.tag_id = ANY($${param_index++})
    )`);
  }

  if (filters.groups?.length) {
    values.push(filters.groups);
    conditions.push(`EXISTS (
      SELECT 1 FROM contact_groups cg
      WHERE cg.contact_id = n.contact_id AND cg.group_id = ANY($${param_index++})
    )`);
  }

  return {
    clause: conditions.length ? 'AND ' + conditions.join(' AND ') : '',
    param_index,
  };
}
