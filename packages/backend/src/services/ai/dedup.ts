import { generate_embedding } from './gemini.js';
import { query } from '../../db/index.js';
import { logger } from '../../lib/logger.js';

export interface DedupResult {
  is_duplicate: boolean;
  matching_fact_id?: string;
  similarity?: number;
}

export async function check_semantic_duplicate(
  contact_id: string,
  fact_type: string,
  value: string,
  embedding: number[],
  similarity_threshold: number,
): Promise<DedupResult> {
  const result = await query<{ id: string; value: string; similarity: number }>(
    `SELECT id, value, 1 - (value_embedding <=> $3::vector) AS similarity
     FROM facts
     WHERE contact_id = $1
       AND fact_type = $2
       AND deleted_at IS NULL
       AND value_embedding IS NOT NULL
     ORDER BY value_embedding <=> $3::vector
     LIMIT 1`,
    [contact_id, fact_type, JSON.stringify(embedding)]
  );

  if (result.rows.length > 0 && result.rows[0].similarity >= similarity_threshold) {
    return {
      is_duplicate: true,
      matching_fact_id: result.rows[0].id,
      similarity: result.rows[0].similarity,
    };
  }

  return { is_duplicate: false };
}

export async function generate_fact_embedding(value: string): Promise<number[] | null> {
  try {
    return await generate_embedding(value);
  } catch (error) {
    logger.warn('Failed to generate fact embedding, skipping dedup', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}
