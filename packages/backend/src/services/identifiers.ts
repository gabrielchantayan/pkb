import { get_pool, query } from '../db/index.js';
import type { ContactIdentifier, ContactIdentifierType } from '@pkb/shared';

export class IdentifierConflictError extends Error {
  constructor(
    message: string,
    public existing_contact_id: string
  ) {
    super(message);
    this.name = 'IdentifierConflictError';
  }
}

export async function add_identifier(
  contact_id: string,
  type: ContactIdentifierType,
  value: string
): Promise<ContactIdentifier | null> {
  const normalized = normalize_value(type, value);

  // Check for conflicts
  const existing = await query<{ contact_id: string }>(
    'SELECT contact_id FROM contact_identifiers WHERE type = $1 AND value = $2',
    [type, normalized]
  );

  if (existing.rows[0] && existing.rows[0].contact_id !== contact_id) {
    throw new IdentifierConflictError(
      `${type} already belongs to another contact`,
      existing.rows[0].contact_id
    );
  }

  const result = await query<ContactIdentifier>(
    `INSERT INTO contact_identifiers (contact_id, type, value, source)
     VALUES ($1, $2, $3, 'manual')
     ON CONFLICT (type, value) DO NOTHING
     RETURNING *`,
    [contact_id, type, normalized]
  );

  return result.rows[0] ?? null;
}

export async function remove_identifier(
  contact_id: string,
  identifier_id: string
): Promise<boolean> {
  const result = await query(
    'DELETE FROM contact_identifiers WHERE id = $1 AND contact_id = $2 RETURNING id',
    [identifier_id, contact_id]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function get_identifiers(contact_id: string): Promise<ContactIdentifier[]> {
  const result = await query<ContactIdentifier>(
    'SELECT * FROM contact_identifiers WHERE contact_id = $1 ORDER BY created_at',
    [contact_id]
  );

  return result.rows;
}

export async function find_contact_by_identifier(
  type: ContactIdentifierType,
  value: string
): Promise<string | null> {
  const normalized = normalize_value(type, value);

  const result = await query<{ contact_id: string }>(
    `SELECT ci.contact_id
     FROM contact_identifiers ci
     JOIN contacts c ON c.id = ci.contact_id
     WHERE ci.type = $1 AND ci.value = $2 AND c.deleted_at IS NULL`,
    [type, normalized]
  );

  return result.rows[0]?.contact_id ?? null;
}

export async function bulk_upsert_identifiers(
  identifiers: Array<{
    contact_id: string;
    type: ContactIdentifierType;
    value: string;
    source?: string;
  }>
): Promise<void> {
  if (identifiers.length === 0) return;

  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const identifier of identifiers) {
      const normalized = normalize_value(identifier.type, identifier.value);
      await client.query(
        `INSERT INTO contact_identifiers (contact_id, type, value, source)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (type, value) DO UPDATE SET contact_id = $1`,
        [identifier.contact_id, identifier.type, normalized, identifier.source ?? 'sync']
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function normalize_value(type: string, value: string): string {
  if (type === 'email') {
    return value.toLowerCase().trim();
  }
  if (type === 'phone') {
    // Remove all non-digits except leading +
    return value.replace(/[^\d+]/g, '');
  }
  return value.trim();
}
