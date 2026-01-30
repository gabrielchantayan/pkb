import { generate_embedding } from './gemini.js';
import { query } from '../../db/index.js';
import { logger } from '../../lib/logger.js';

// Queue for async embedding generation
const embedding_queue: string[] = [];
let processing = false;

export function queue_for_embedding(communication_id: string): void {
  embedding_queue.push(communication_id);
  process_queue().catch((error) => {
    logger.error('Embedding queue processing error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });
}

async function process_queue(): Promise<void> {
  if (processing || embedding_queue.length === 0) return;

  processing = true;

  while (embedding_queue.length > 0) {
    const id = embedding_queue.shift()!;

    try {
      // Get communication content
      const comm = await query<{ content: string }>(
        'SELECT content FROM communications WHERE id = $1',
        [id]
      );

      if (!comm.rows[0]) continue;

      // Skip very short content
      if (comm.rows[0].content.length < 20) continue;

      // Generate embedding
      const embedding = await generate_embedding(comm.rows[0].content);

      if (embedding) {
        // Store embedding as a vector
        await query(
          'UPDATE communications SET content_embedding = $1 WHERE id = $2',
          [JSON.stringify(embedding), id]
        );

        logger.debug('Generated embedding for communication', { communication_id: id });
      }
    } catch (error) {
      logger.error(`Failed to generate embedding for ${id}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Could re-queue with backoff, but for now just log and continue
    }

    // Rate limiting - 50ms between requests
    await new Promise((r) => setTimeout(r, 50));
  }

  processing = false;
}

export interface BackfillResult {
  processed: number;
  errors: { id: string; error: string }[];
}

// Batch embedding for existing communications without embeddings
export async function backfill_embeddings(batch_size: number = 100): Promise<BackfillResult> {
  const missing = await query<{ id: string; content: string }>(
    `SELECT id, content FROM communications
     WHERE content_embedding IS NULL
     AND LENGTH(content) >= 20
     LIMIT $1`,
    [batch_size]
  );

  const errors: { id: string; error: string }[] = [];
  let processed = 0;

  for (const row of missing.rows) {
    try {
      const embedding = await generate_embedding(row.content);

      if (embedding) {
        await query(
          'UPDATE communications SET content_embedding = $1 WHERE id = $2',
          [JSON.stringify(embedding), row.id]
        );
        processed++;
      }
    } catch (error) {
      errors.push({
        id: row.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, 50));
  }

  return { processed, errors };
}

export interface EmbedBatchInput {
  texts: string[];
  ids: string[];
}

export interface EmbedBatchResult {
  processed: number;
  errors: { id: string; error: string }[];
}

// Batch embedding for specified texts and IDs
export async function embed_batch(input: EmbedBatchInput): Promise<EmbedBatchResult> {
  if (input.texts.length !== input.ids.length) {
    throw new Error('texts and ids arrays must have the same length');
  }

  const errors: { id: string; error: string }[] = [];
  let processed = 0;

  for (let i = 0; i < input.texts.length; i++) {
    const text = input.texts[i];
    const id = input.ids[i];

    try {
      if (text.length < 20) {
        continue; // Skip very short texts
      }

      const embedding = await generate_embedding(text);

      if (embedding) {
        await query(
          'UPDATE communications SET content_embedding = $1 WHERE id = $2',
          [JSON.stringify(embedding), id]
        );
        processed++;
      }
    } catch (error) {
      errors.push({
        id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Rate limiting
    if (i < input.texts.length - 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  return { processed, errors };
}

export function get_queue_length(): number {
  return embedding_queue.length;
}
