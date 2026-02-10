import { query } from '../db/index.js';
import type { Relationship } from '@pkb/shared';
import type {
  CreateRelationshipInput,
  UpdateRelationshipInput,
} from '../schemas/relationships.js';
import { logger } from '../lib/logger.js';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export async function list_relationships(contact_id: string): Promise<Relationship[]> {
  const result = await query<Relationship>(
    `SELECT r.*,
            c.display_name AS linked_contact_name,
            c.photo_url AS linked_contact_photo
     FROM relationships r
     LEFT JOIN contacts c ON c.id = r.linked_contact_id AND c.deleted_at IS NULL
     WHERE r.contact_id = $1 AND r.deleted_at IS NULL
     ORDER BY r.label, r.person_name`,
    [contact_id]
  );
  return result.rows;
}

export async function create_relationship(input: CreateRelationshipInput): Promise<Relationship> {
  const label = input.label.toLowerCase();

  const result = await query<Relationship>(
    `INSERT INTO relationships (contact_id, label, person_name, linked_contact_id, source, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'manual', NOW(), NOW())
     RETURNING *`,
    [input.contact_id, label, input.person_name, input.linked_contact_id ?? null]
  );

  return result.rows[0];
}

export async function update_relationship(id: string, input: UpdateRelationshipInput): Promise<Relationship> {
  const updates: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [];
  let param_index = 1;

  if (input.label !== undefined) {
    values.push(input.label.toLowerCase());
    updates.push(`label = $${param_index++}`);
  }

  if (input.person_name !== undefined) {
    values.push(input.person_name);
    updates.push(`person_name = $${param_index++}`);
  }

  if (input.linked_contact_id !== undefined) {
    values.push(input.linked_contact_id);
    updates.push(`linked_contact_id = $${param_index++}`);
  }

  values.push(id);
  const result = await query<Relationship>(
    `UPDATE relationships SET ${updates.join(', ')}
     WHERE id = $${param_index} AND deleted_at IS NULL
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Relationship not found');
  }

  return result.rows[0];
}

export async function delete_relationship(id: string): Promise<boolean> {
  const result = await query(
    `UPDATE relationships SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id]
  );
  return result.rows.length > 0;
}

export interface ExtractedRelationshipInput {
  contact_id: string;
  label: string;
  person_name: string;
  confidence: number;
}

export async function create_extracted_relationship(
  communication_id: string,
  input: ExtractedRelationshipInput
): Promise<Relationship | null> {
  const label = input.label.toLowerCase();

  try {
    const result = await query<Relationship>(
      `INSERT INTO relationships (contact_id, label, person_name, source, source_communication_id, confidence, created_at, updated_at)
       VALUES ($1, $2, $3, 'extracted', $4, $5, NOW(), NOW())
       ON CONFLICT (contact_id, lower(label), lower(person_name)) WHERE deleted_at IS NULL DO NOTHING
       RETURNING *`,
      [input.contact_id, label, input.person_name, communication_id, input.confidence]
    );

    return result.rows[0] ?? null;
  } catch (error) {
    logger.error('Failed to create extracted relationship', {
      error: error instanceof Error ? error.message : 'Unknown error',
      label,
      person_name: input.person_name,
    });
    return null;
  }
}
