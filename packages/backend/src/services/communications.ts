import { get_pool, query } from '../db/index.js';
import type { Communication, CommunicationAttachment, Contact, ContactIdentifier } from '@pkb/shared';
import type {
  ListCommunicationsQuery,
  BatchUpsertInput,
  CommunicationInput,
} from '../schemas/communications.js';
import { process_communications } from './ai/pipeline.js';
import { logger } from '../lib/logger.js';

export interface ListCommunicationsResponse {
  communications: Communication[];
  nextCursor: string | null;
}

export interface CommunicationDetailResponse {
  communication: Communication;
  attachments: CommunicationAttachment[];
  contact: Contact | null;
}

export interface BatchUpsertResult {
  inserted: number;
  updated: number;
  errors: { index: number; error: string }[];
}

export async function list_communications(
  params: ListCommunicationsQuery
): Promise<ListCommunicationsResponse> {
  const values: unknown[] = [];
  let param_index = 1;

  const conditions: string[] = [];

  if (params.contact_id) {
    values.push(params.contact_id);
    conditions.push(`contact_id = $${param_index++}`);
  }

  if (params.source) {
    values.push(params.source);
    conditions.push(`source = $${param_index++}`);
  }

  if (params.direction) {
    values.push(params.direction);
    conditions.push(`direction = $${param_index++}`);
  }

  if (params.start_date) {
    values.push(params.start_date);
    conditions.push(`timestamp >= $${param_index++}`);
  }

  if (params.end_date) {
    values.push(params.end_date);
    conditions.push(`timestamp <= $${param_index++}`);
  }

  if (params.conversation_id) {
    values.push(params.conversation_id);
    conditions.push(`conversation_id = $${param_index++}`);
  }

  if (params.cursor) {
    values.push(params.cursor);
    conditions.push(`(timestamp, id) < (
      SELECT timestamp, id FROM communications WHERE id = $${param_index++}
    )`);
  }

  const where_clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(params.limit + 1);

  const sql = `
    SELECT * FROM communications
    ${where_clause}
    ORDER BY timestamp DESC, id DESC
    LIMIT $${param_index}
  `;

  const result = await query<Communication>(sql, values);
  const limit = params.limit;
  const has_more = result.rows.length > limit;
  const communications = has_more ? result.rows.slice(0, -1) : result.rows;
  const last = communications[communications.length - 1];
  const next_cursor = has_more && last ? last.id : null;

  return { communications, nextCursor: next_cursor };
}

export async function get_communication(id: string): Promise<CommunicationDetailResponse | null> {
  const comm_result = await query<Communication>(
    'SELECT * FROM communications WHERE id = $1',
    [id]
  );

  if (comm_result.rows.length === 0) {
    return null;
  }

  const communication = comm_result.rows[0];

  const [attachments_result, contact_result] = await Promise.all([
    query<CommunicationAttachment>(
      'SELECT * FROM communication_attachments WHERE communication_id = $1 ORDER BY created_at',
      [id]
    ),
    communication.contact_id
      ? query<Contact>('SELECT * FROM contacts WHERE id = $1', [communication.contact_id])
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    communication,
    attachments: attachments_result.rows,
    contact: contact_result.rows[0] ?? null,
  };
}

export async function batch_upsert(input: BatchUpsertInput): Promise<BatchUpsertResult> {
  const results: BatchUpsertResult = { inserted: 0, updated: 0, errors: [] };
  const inserted_ids: string[] = [];

  for (let i = 0; i < input.communications.length; i++) {
    const item = input.communications[i];
    const pool = get_pool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Resolve or create contact from identifier
      const contact_id = await resolve_contact(client, item.contact_identifier);

      // Upsert communication
      const result = await client.query<{ id: string; inserted: boolean }>(
        `INSERT INTO communications (
          source, source_id, contact_id, direction, subject,
          content, timestamp, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (source, source_id) DO UPDATE SET
          content = EXCLUDED.content,
          metadata = EXCLUDED.metadata
        RETURNING id, (xmax = 0) as inserted`,
        [
          item.source,
          item.source_id,
          contact_id,
          item.direction,
          item.subject ?? null,
          item.content,
          item.timestamp,
          item.metadata ?? null,
        ]
      );

      const row = result.rows[0];
      if (row.inserted) {
        results.inserted++;
        inserted_ids.push(row.id);
      } else {
        results.updated++;
      }

      // Handle inline attachments (base64 encoded)
      if (item.attachments?.length) {
        const { save_attachment_from_base64 } = await import('./attachments.js');
        for (const att of item.attachments) {
          await save_attachment_from_base64(client, row.id, att);
        }
      }

      // Update/create conversation grouping
      if (item.thread_id) {
        const { update_conversation } = await import('./conversations.js');
        await update_conversation(client, item.source, item.thread_id, contact_id, row.id);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      results.errors.push({
        index: i,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      client.release();
    }
  }

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

  return results;
}

async function resolve_contact(
  client: import('pg').PoolClient,
  identifier: { type: string; value: string }
): Promise<string> {
  // Normalize the identifier value
  const normalized =
    identifier.type === 'email'
      ? identifier.value.toLowerCase().trim()
      : identifier.type === 'phone'
        ? identifier.value.replace(/[^\d+]/g, '')
        : identifier.value.trim();

  // Find existing contact
  const existing = await client.query<{ contact_id: string }>(
    'SELECT contact_id FROM contact_identifiers WHERE type = $1 AND value = $2',
    [identifier.type, normalized]
  );

  if (existing.rows[0]) {
    return existing.rows[0].contact_id;
  }

  // Create new contact
  const contact = await client.query<{ id: string }>(
    `INSERT INTO contacts (display_name, created_at, updated_at)
     VALUES ($1, NOW(), NOW())
     RETURNING id`,
    [normalized]
  );

  // Add identifier
  await client.query(
    `INSERT INTO contact_identifiers (contact_id, type, value, source, created_at)
     VALUES ($1, $2, $3, 'sync', NOW())`,
    [contact.rows[0].id, identifier.type, normalized]
  );

  return contact.rows[0].id;
}

export interface SearchCommunicationsParams {
  q: string;
  contact_id?: string;
  source?: string;
  start_date?: string;
  end_date?: string;
  limit: number;
}

export interface SearchResult {
  communication: Communication;
  highlights: string[];
}

export async function search_communications(
  params: SearchCommunicationsParams
): Promise<{ results: SearchResult[] }> {
  const values: unknown[] = [params.q];
  let param_index = 2;

  const conditions: string[] = ['content_tsv @@ plainto_tsquery(\'english\', $1)'];

  if (params.contact_id) {
    values.push(params.contact_id);
    conditions.push(`contact_id = $${param_index++}`);
  }

  if (params.source) {
    values.push(params.source);
    conditions.push(`source = $${param_index++}`);
  }

  if (params.start_date) {
    values.push(params.start_date);
    conditions.push(`timestamp >= $${param_index++}`);
  }

  if (params.end_date) {
    values.push(params.end_date);
    conditions.push(`timestamp <= $${param_index++}`);
  }

  values.push(params.limit);

  const sql = `
    SELECT *,
           ts_headline('english', coalesce(subject, '') || ' ' || coalesce(content, ''),
                       plainto_tsquery('english', $1),
                       'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15') as headline
    FROM communications
    WHERE ${conditions.join(' AND ')}
    ORDER BY ts_rank(content_tsv, plainto_tsquery('english', $1)) DESC
    LIMIT $${param_index}
  `;

  const result = await query<Communication & { headline: string }>(sql, values);

  return {
    results: result.rows.map((row) => ({
      communication: row,
      highlights: [row.headline],
    })),
  };
}
