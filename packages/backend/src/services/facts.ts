import { z } from 'zod';
import { get_pool, query } from '../db/index.js';
import type { Fact, FactHistory, Contact } from '@pkb/shared';
import type {
  ListFactsQuery,
  CreateFactInput,
  UpdateFactInput,
  ResolveConflictInput,
} from '../schemas/facts.js';
import {
  birthday_structured_schema,
  location_structured_schema,
  relationship_structured_schema,
  child_structured_schema,
} from '../schemas/facts.js';

// Map fact types to categories
const FACT_CATEGORIES: Record<string, string> = {
  birthday: 'basic_info',
  location: 'basic_info',
  job_title: 'basic_info',
  company: 'basic_info',
  email: 'basic_info',
  phone: 'basic_info',
  spouse: 'relationship',
  child: 'relationship',
  parent: 'relationship',
  sibling: 'relationship',
  friend: 'relationship',
  colleague: 'relationship',
  how_we_met: 'relationship',
  mutual_connection: 'relationship',
  custom: 'custom',
};

// Structured value schemas for validation
const STRUCTURED_SCHEMAS: Record<string, z.ZodSchema> = {
  birthday: birthday_structured_schema,
  location: location_structured_schema,
  spouse: relationship_structured_schema,
  child: child_structured_schema,
  parent: relationship_structured_schema,
  sibling: relationship_structured_schema,
  friend: relationship_structured_schema,
  colleague: relationship_structured_schema,
  mutual_connection: relationship_structured_schema,
};

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface ListFactsResponse {
  facts: Fact[];
  nextCursor: string | null;
}

export interface FactDetailResponse {
  fact: Fact;
  history: FactHistory[];
}

export interface ConflictGroup {
  fact: Fact;
  conflicting_facts: Fact[];
  contact: Contact;
}

function validate_structured_value(fact_type: string, structured_value: unknown): void {
  const schema = STRUCTURED_SCHEMAS[fact_type];
  if (schema && structured_value) {
    try {
      schema.parse(structured_value);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(
          `Invalid structured_value for ${fact_type}: ${error.issues.map((e: z.ZodIssue) => e.message).join(', ')}`
        );
      }
      throw error;
    }
  }
}

export async function list_facts(params: ListFactsQuery): Promise<ListFactsResponse> {
  const values: unknown[] = [];
  let param_index = 1;

  const conditions: string[] = ['deleted_at IS NULL'];

  if (params.contact_id) {
    values.push(params.contact_id);
    conditions.push(`contact_id = $${param_index++}`);
  }

  if (params.category) {
    values.push(params.category);
    conditions.push(`category = $${param_index++}`);
  }

  if (params.fact_type) {
    values.push(params.fact_type);
    conditions.push(`fact_type = $${param_index++}`);
  }

  if (params.source) {
    values.push(params.source);
    conditions.push(`source = $${param_index++}`);
  }

  if (params.has_conflict !== undefined) {
    values.push(params.has_conflict);
    conditions.push(`has_conflict = $${param_index++}`);
  }

  if (params.cursor) {
    values.push(params.cursor);
    conditions.push(`(created_at, id) < (
      SELECT created_at, id FROM facts WHERE id = $${param_index++}
    )`);
  }

  values.push(params.limit + 1);

  const sql = `
    SELECT * FROM facts
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT $${param_index}
  `;

  const result = await query<Fact>(sql, values);
  const limit = params.limit;
  const has_more = result.rows.length > limit;
  const facts = has_more ? result.rows.slice(0, -1) : result.rows;
  const last = facts[facts.length - 1];
  const next_cursor = has_more && last ? last.id : null;

  return { facts, nextCursor: next_cursor };
}

export async function get_fact(id: string): Promise<FactDetailResponse | null> {
  const fact_result = await query<Fact>(
    'SELECT * FROM facts WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );

  if (fact_result.rows.length === 0) {
    return null;
  }

  const history_result = await query<FactHistory>(
    'SELECT * FROM fact_history WHERE fact_id = $1 ORDER BY changed_at DESC',
    [id]
  );

  return {
    fact: fact_result.rows[0],
    history: history_result.rows,
  };
}

export async function create_fact(input: CreateFactInput): Promise<Fact> {
  const category = FACT_CATEGORIES[input.fact_type] || 'custom';

  // Validate structured_value based on fact_type
  if (input.structured_value) {
    validate_structured_value(input.fact_type, input.structured_value);
  }

  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check for conflicts with existing facts
    const existing = await client.query<Fact>(
      `SELECT * FROM facts
       WHERE contact_id = $1 AND fact_type = $2 AND deleted_at IS NULL
       ORDER BY confidence DESC NULLS LAST
       LIMIT 1`,
      [input.contact_id, input.fact_type]
    );

    let has_conflict = false;
    if (existing.rows[0] && existing.rows[0].value !== input.value) {
      has_conflict = true;
      // Mark existing as conflicted too
      await client.query('UPDATE facts SET has_conflict = true WHERE id = $1', [
        existing.rows[0].id,
      ]);
    }

    const result = await client.query<Fact>(
      `INSERT INTO facts (
        contact_id, category, fact_type, value, structured_value,
        source, confidence, has_conflict, reminder_enabled, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING *`,
      [
        input.contact_id,
        category,
        input.fact_type,
        input.value,
        input.structured_value ? JSON.stringify(input.structured_value) : null,
        'manual',
        1.0, // Manual facts have full confidence
        has_conflict,
        input.reminder_enabled ?? false,
      ]
    );

    const fact = result.rows[0];

    // If email/phone fact, also create identifier
    if (input.fact_type === 'email' || input.fact_type === 'phone') {
      await create_identifier_from_fact(client, input.contact_id, input.fact_type, input.value);
    }

    await client.query('COMMIT');
    return fact;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function update_fact(id: string, input: UpdateFactInput): Promise<Fact> {
  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current value for history
    const current = await client.query<Fact>(
      'SELECT * FROM facts WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (!current.rows[0]) {
      throw new NotFoundError('Fact not found');
    }

    const current_fact = current.rows[0];

    // Validate structured_value if provided
    if (input.structured_value && current_fact.fact_type) {
      validate_structured_value(current_fact.fact_type, input.structured_value);
    }

    // Store history (only if value or structured_value is changing)
    if (input.value !== undefined || input.structured_value !== undefined) {
      await client.query(
        `INSERT INTO fact_history (fact_id, value, structured_value, changed_at, change_source)
         VALUES ($1, $2, $3, NOW(), 'manual_update')`,
        [id, current_fact.value, current_fact.structured_value]
      );
    }

    // Update fact
    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let param_index = 1;

    if (input.value !== undefined) {
      values.push(input.value);
      updates.push(`value = $${param_index++}`);
    }

    if (input.structured_value !== undefined) {
      values.push(JSON.stringify(input.structured_value));
      updates.push(`structured_value = $${param_index++}`);
    }

    if (input.reminder_enabled !== undefined) {
      values.push(input.reminder_enabled);
      updates.push(`reminder_enabled = $${param_index++}`);
    }

    values.push(id);
    const result = await client.query<Fact>(
      `UPDATE facts SET ${updates.join(', ')} WHERE id = $${param_index} RETURNING *`,
      values
    );

    const updated_fact = result.rows[0];

    // Re-check conflicts after update
    await recheck_conflicts(client, updated_fact.contact_id, updated_fact.fact_type);

    await client.query('COMMIT');
    return updated_fact;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function delete_fact(id: string): Promise<boolean> {
  const result = await query<Fact>(
    `UPDATE facts SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id]
  );

  return result.rows.length > 0;
}

export async function get_fact_history(id: string): Promise<FactHistory[]> {
  const result = await query<FactHistory>(
    'SELECT * FROM fact_history WHERE fact_id = $1 ORDER BY changed_at DESC',
    [id]
  );

  return result.rows;
}

export async function find_conflicts(): Promise<ConflictGroup[]> {
  // Find facts where multiple facts of same type exist for same contact
  // with different values
  const result = await query<Fact & { contact_name: string }>(
    `SELECT f.*, c.display_name as contact_name
     FROM facts f
     JOIN contacts c ON c.id = f.contact_id
     WHERE f.has_conflict = true
       AND f.deleted_at IS NULL
     ORDER BY f.updated_at DESC`
  );

  // Group by contact_id and fact_type
  const groups = new Map<string, (Fact & { contact_name: string })[]>();
  for (const fact of result.rows) {
    const key = `${fact.contact_id}:${fact.fact_type}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(fact);
  }

  // Build conflict groups
  const conflicts: ConflictGroup[] = [];
  for (const facts of groups.values()) {
    if (facts.length >= 2) {
      const [first, ...rest] = facts;
      conflicts.push({
        fact: first,
        conflicting_facts: rest,
        contact: {
          id: first.contact_id,
          display_name: first.contact_name,
        } as Contact,
      });
    }
  }

  return conflicts;
}

export async function resolve_conflict(id: string, input: ResolveConflictInput): Promise<Fact> {
  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const fact_result = await client.query<Fact>(
      'SELECT * FROM facts WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (!fact_result.rows[0]) {
      throw new NotFoundError('Fact not found');
    }

    const fact = fact_result.rows[0];

    if (input.action === 'keep') {
      // Mark this fact as authoritative, delete others
      await client.query(
        `UPDATE facts SET deleted_at = NOW()
         WHERE contact_id = $1 AND fact_type = $2 AND id != $3 AND deleted_at IS NULL`,
        [fact.contact_id, fact.fact_type, id]
      );

      await client.query('UPDATE facts SET has_conflict = false WHERE id = $1', [id]);
    } else if (input.action === 'replace' && input.replace_with_fact_id) {
      // Keep the replacement, delete this one
      await client.query('UPDATE facts SET deleted_at = NOW() WHERE id = $1', [id]);
      await client.query('UPDATE facts SET has_conflict = false WHERE id = $1', [
        input.replace_with_fact_id,
      ]);
    } else if (input.action === 'merge') {
      // Keep both but mark as non-conflicting (user says both are valid)
      await client.query(
        `UPDATE facts SET has_conflict = false
         WHERE contact_id = $1 AND fact_type = $2 AND deleted_at IS NULL`,
        [fact.contact_id, fact.fact_type]
      );
    }

    await client.query('COMMIT');

    const updated_result = await query<Fact>('SELECT * FROM facts WHERE id = $1', [id]);
    return updated_result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// For AI Integration feature - creates extracted facts
export interface ExtractedFactInput {
  contact_id: string;
  fact_type: string;
  value: string;
  structured_value?: Record<string, unknown>;
  confidence: number;
}

export async function create_extracted_fact(
  communication_id: string,
  input: ExtractedFactInput
): Promise<Fact> {
  const category = FACT_CATEGORIES[input.fact_type] || 'custom';

  // Validate structured_value based on fact_type
  if (input.structured_value) {
    validate_structured_value(input.fact_type, input.structured_value);
  }

  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check for conflicts with existing facts
    const existing = await client.query<Fact>(
      `SELECT * FROM facts
       WHERE contact_id = $1 AND fact_type = $2 AND deleted_at IS NULL
       ORDER BY confidence DESC NULLS LAST
       LIMIT 1`,
      [input.contact_id, input.fact_type]
    );

    let has_conflict = false;
    if (existing.rows[0] && existing.rows[0].value !== input.value) {
      has_conflict = true;
      await client.query('UPDATE facts SET has_conflict = true WHERE id = $1', [
        existing.rows[0].id,
      ]);
    }

    const result = await client.query<Fact>(
      `INSERT INTO facts (
        contact_id, category, fact_type, value, structured_value,
        source, source_communication_id, confidence, has_conflict,
        reminder_enabled, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, NOW(), NOW())
      RETURNING *`,
      [
        input.contact_id,
        category,
        input.fact_type,
        input.value,
        input.structured_value ? JSON.stringify(input.structured_value) : null,
        'extracted',
        communication_id,
        input.confidence,
        has_conflict,
      ]
    );

    const fact = result.rows[0];

    // If email/phone fact, also create identifier
    if (input.fact_type === 'email' || input.fact_type === 'phone') {
      await create_identifier_from_fact(client, input.contact_id, input.fact_type, input.value);
    }

    await client.query('COMMIT');
    return fact;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface BatchCreateResult {
  success: boolean;
  fact?: Fact;
  error?: string;
}

export async function batch_create_extracted_facts(
  communication_id: string,
  facts: ExtractedFactInput[]
): Promise<BatchCreateResult[]> {
  const results: BatchCreateResult[] = [];

  for (const fact_input of facts) {
    try {
      const fact = await create_extracted_fact(communication_id, fact_input);
      results.push({ success: true, fact });
    } catch (error) {
      results.push({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}

// Helper to create identifier from email/phone fact
async function create_identifier_from_fact(
  client: import('pg').PoolClient,
  contact_id: string,
  type: string,
  value: string
): Promise<void> {
  const normalized =
    type === 'email'
      ? value.toLowerCase().trim()
      : type === 'phone'
        ? value.replace(/[^\d+]/g, '')
        : value.trim();

  await client.query(
    `INSERT INTO contact_identifiers (contact_id, type, value, source, created_at)
     VALUES ($1, $2, $3, 'fact', NOW())
     ON CONFLICT (type, value) DO NOTHING`,
    [contact_id, type, normalized]
  );
}

// Helper to re-check conflicts after an update
async function recheck_conflicts(
  client: import('pg').PoolClient,
  contact_id: string,
  fact_type: string | null
): Promise<void> {
  if (!fact_type) return;

  // Get all non-deleted facts of this type for this contact
  const facts = await client.query<Fact>(
    `SELECT * FROM facts
     WHERE contact_id = $1 AND fact_type = $2 AND deleted_at IS NULL`,
    [contact_id, fact_type]
  );

  // Get unique values
  const unique_values = new Set(facts.rows.map((f) => f.value));

  if (unique_values.size <= 1) {
    // All same value or only one fact - no conflict
    await client.query(
      `UPDATE facts SET has_conflict = false
       WHERE contact_id = $1 AND fact_type = $2 AND deleted_at IS NULL`,
      [contact_id, fact_type]
    );
  } else {
    // Different values exist - mark all as conflicted
    await client.query(
      `UPDATE facts SET has_conflict = true
       WHERE contact_id = $1 AND fact_type = $2 AND deleted_at IS NULL`,
      [contact_id, fact_type]
    );
  }
}
