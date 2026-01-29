import { query, get_pool } from '../db/index.js';
import type { Tag, TagWithCount } from '@pkb/shared';

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface CreateTagInput {
  name: string;
  color?: string;
  followup_days?: number;
}

export interface UpdateTagInput {
  name?: string;
  color?: string;
  followup_days?: number | null;
}

export async function list_tags(): Promise<TagWithCount[]> {
  const result = await query<TagWithCount>(
    `SELECT t.*,
            COUNT(ct.contact_id)::int as contact_count
     FROM tags t
     LEFT JOIN contact_tags ct ON ct.tag_id = t.id
     LEFT JOIN contacts c ON c.id = ct.contact_id AND c.deleted_at IS NULL
     GROUP BY t.id
     ORDER BY t.name ASC`
  );
  return result.rows;
}

export async function get_tag(id: string): Promise<Tag | null> {
  const result = await query<Tag>('SELECT * FROM tags WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function create_tag(input: CreateTagInput): Promise<Tag> {
  const existing = await query<{ id: string }>(
    'SELECT id FROM tags WHERE name = $1',
    [input.name]
  );
  if (existing.rows[0]) {
    throw new ConflictError('Tag name already exists');
  }

  const result = await query<Tag>(
    `INSERT INTO tags (name, color, followup_days)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.name, input.color ?? '#808080', input.followup_days ?? null]
  );
  return result.rows[0];
}

export async function update_tag(id: string, input: UpdateTagInput): Promise<Tag | null> {
  const existing = await query<Tag>('SELECT * FROM tags WHERE id = $1', [id]);
  if (!existing.rows[0]) {
    return null;
  }

  if (input.name !== undefined) {
    const name_check = await query<{ id: string }>(
      'SELECT id FROM tags WHERE name = $1 AND id != $2',
      [input.name, id]
    );
    if (name_check.rows[0]) {
      throw new ConflictError('Tag name already exists');
    }
  }

  const updates: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [];
  let param_index = 1;

  if (input.name !== undefined) {
    values.push(input.name);
    updates.push(`name = $${param_index++}`);
  }

  if (input.color !== undefined) {
    values.push(input.color);
    updates.push(`color = $${param_index++}`);
  }

  if (input.followup_days !== undefined) {
    values.push(input.followup_days);
    updates.push(`followup_days = $${param_index++}`);
  }

  values.push(id);
  const result = await query<Tag>(
    `UPDATE tags SET ${updates.join(', ')} WHERE id = $${param_index} RETURNING *`,
    values
  );

  return result.rows[0];
}

export async function delete_tag(id: string): Promise<boolean> {
  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Remove tag associations
    await client.query('DELETE FROM contact_tags WHERE tag_id = $1', [id]);

    // Delete tag
    const result = await client.query('DELETE FROM tags WHERE id = $1 RETURNING id', [id]);

    await client.query('COMMIT');
    return result.rowCount !== null && result.rowCount > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function add_tag_to_contact(contact_id: string, tag_id: string): Promise<void> {
  // Verify contact exists
  const contact = await query<{ id: string }>(
    'SELECT id FROM contacts WHERE id = $1 AND deleted_at IS NULL',
    [contact_id]
  );
  if (!contact.rows[0]) {
    throw new NotFoundError('Contact not found');
  }

  // Verify tag exists
  const tag = await query<{ id: string }>('SELECT id FROM tags WHERE id = $1', [tag_id]);
  if (!tag.rows[0]) {
    throw new NotFoundError('Tag not found');
  }

  await query(
    `INSERT INTO contact_tags (contact_id, tag_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [contact_id, tag_id]
  );
}

export async function remove_tag_from_contact(contact_id: string, tag_id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id = $2',
    [contact_id, tag_id]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function get_contact_tags(contact_id: string): Promise<Tag[]> {
  const result = await query<Tag>(
    `SELECT t.* FROM tags t
     JOIN contact_tags ct ON ct.tag_id = t.id
     WHERE ct.contact_id = $1
     ORDER BY t.name`,
    [contact_id]
  );
  return result.rows;
}
