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

const INVERSE_LABELS: Record<string, string> = {
  parent: 'child',
  child: 'parent',
  teacher: 'student',
  student: 'teacher',
  boss: 'direct_report',
  direct_report: 'boss',
  mentor: 'mentee',
  mentee: 'mentor',
  doctor: 'patient',
  patient: 'doctor',
  therapist: 'client',
  client: 'provider',
  provider: 'client',
};

function get_inverse_label(label: string): string | null {
  if (label === 'how_we_met') return null;
  return INVERSE_LABELS[label] ?? label;
}

async function get_contact_display_name(contact_id: string): Promise<string | null> {
  const result = await query<{ display_name: string }>(
    `SELECT display_name FROM contacts WHERE id = $1 AND deleted_at IS NULL`,
    [contact_id]
  );
  return result.rows[0]?.display_name ?? null;
}

async function create_reciprocal_relationship(
  contact_id: string,
  label: string,
  person_name: string,
  linked_contact_id: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO relationships (contact_id, label, person_name, linked_contact_id, source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'manual', NOW(), NOW())
       ON CONFLICT (contact_id, lower(label), lower(person_name)) WHERE deleted_at IS NULL
       DO UPDATE SET linked_contact_id = EXCLUDED.linked_contact_id, updated_at = NOW()`,
      [contact_id, label, person_name, linked_contact_id]
    );
  } catch (error) {
    logger.error('Failed to create reciprocal relationship', {
      error: error instanceof Error ? error.message : 'Unknown error',
      contact_id,
      label,
      person_name,
    });
  }
}

async function soft_delete_inverse(linked_contact_id: string, original_contact_id: string): Promise<void> {
  try {
    await query(
      `UPDATE relationships SET deleted_at = NOW(), updated_at = NOW()
       WHERE contact_id = $1 AND linked_contact_id = $2 AND deleted_at IS NULL`,
      [linked_contact_id, original_contact_id]
    );
  } catch (error) {
    logger.error('Failed to soft-delete inverse relationship', {
      error: error instanceof Error ? error.message : 'Unknown error',
      linked_contact_id,
      original_contact_id,
    });
  }
}

export async function list_relationships(contact_id: string): Promise<Relationship[]> {
  const result = await query<Relationship>(
    `SELECT r.*,
            c.display_name AS linked_contact_name,
            c.photo_url AS linked_contact_photo,
            sc.id AS suggested_contact_id,
            sc.display_name AS suggested_contact_name
     FROM relationships r
     LEFT JOIN contacts c ON c.id = r.linked_contact_id AND c.deleted_at IS NULL
     LEFT JOIN LATERAL (
       SELECT id, display_name
       FROM contacts
       WHERE deleted_at IS NULL
         AND id != r.contact_id
         AND r.linked_contact_id IS NULL
         AND r.source = 'extracted'
         AND (
           lower(display_name) = lower(r.person_name)
           OR display_name ILIKE r.person_name || ' %'
           OR display_name ILIKE '% ' || r.person_name
         )
       ORDER BY CASE WHEN lower(display_name) = lower(r.person_name) THEN 0 ELSE 1 END
       LIMIT 1
     ) sc ON true
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

  const relationship = result.rows[0];

  if (input.linked_contact_id) {
    const inverse_label = get_inverse_label(label);
    if (inverse_label) {
      const display_name = await get_contact_display_name(input.contact_id);
      if (display_name) {
        await create_reciprocal_relationship(
          input.linked_contact_id,
          inverse_label,
          display_name,
          input.contact_id
        );
      }
    }
  }

  return relationship;
}

export async function update_relationship(id: string, input: UpdateRelationshipInput): Promise<Relationship> {
  // Fetch existing relationship before updating to handle inverse changes
  const existing_result = await query<Relationship>(
    `SELECT * FROM relationships WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (existing_result.rows.length === 0) {
    throw new NotFoundError('Relationship not found');
  }
  const existing = existing_result.rows[0];

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

  if (input.source !== undefined) {
    values.push(input.source);
    updates.push(`source = $${param_index++}`);
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

  const updated = result.rows[0];
  const new_linked = input.linked_contact_id !== undefined ? input.linked_contact_id : existing.linked_contact_id;
  const old_linked = existing.linked_contact_id;

  // Handle inverse relationship changes
  if (old_linked && old_linked !== new_linked) {
    await soft_delete_inverse(old_linked, existing.contact_id);
  }

  if (new_linked && new_linked !== old_linked) {
    const effective_label = (input.label ?? existing.label).toLowerCase();
    const inverse_label = get_inverse_label(effective_label);
    if (inverse_label) {
      const display_name = await get_contact_display_name(existing.contact_id);
      if (display_name) {
        await create_reciprocal_relationship(
          new_linked,
          inverse_label,
          display_name,
          existing.contact_id
        );
      }
    }
  }

  return updated;
}

export async function delete_relationship(id: string): Promise<boolean> {
  const existing_result = await query<Relationship>(
    `SELECT * FROM relationships WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );

  const result = await query(
    `UPDATE relationships SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id]
  );

  if (result.rows.length > 0 && existing_result.rows[0]?.linked_contact_id) {
    await soft_delete_inverse(
      existing_result.rows[0].linked_contact_id,
      existing_result.rows[0].contact_id
    );
  }

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
