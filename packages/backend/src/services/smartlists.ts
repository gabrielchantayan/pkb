import { query, get_pool } from '../db/index.js';
import type { SmartList, SmartListWithCount, SmartListRules, SmartListCondition, Contact } from '@pkb/shared';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface CreateSmartListInput {
  name: string;
  rules: SmartListRules;
}

export interface UpdateSmartListInput {
  name?: string;
  rules?: SmartListRules;
}

export interface PaginationParams {
  cursor?: string;
  limit: number;
}

interface BuiltCondition {
  sql: string;
  values: unknown[];
}

function build_condition(condition: SmartListCondition, param_offset: number): BuiltCondition {
  const idx = param_offset + 1;

  switch (condition.field) {
    case 'tag':
      return {
        sql: `EXISTS (SELECT 1 FROM contact_tags ct_cond WHERE ct_cond.contact_id = c.id AND ct_cond.tag_id = $${idx})`,
        values: [condition.value],
      };

    case 'group':
      return {
        sql: `EXISTS (SELECT 1 FROM contact_groups cg_cond WHERE cg_cond.contact_id = c.id AND cg_cond.group_id = $${idx})`,
        values: [condition.value],
      };

    case 'starred':
      return {
        sql: `c.starred = $${idx}`,
        values: [condition.value],
      };

    case 'last_contact_days':
      if (condition.operator === 'greater_than') {
        return {
          sql: `(
            NOT EXISTS (SELECT 1 FROM communications comm WHERE comm.contact_id = c.id)
            OR (SELECT MAX(timestamp) FROM communications comm WHERE comm.contact_id = c.id) < NOW() - ($${idx} || ' days')::interval
          )`,
          values: [condition.value],
        };
      } else {
        return {
          sql: `EXISTS (
            SELECT 1 FROM communications comm
            WHERE comm.contact_id = c.id
            AND comm.timestamp >= NOW() - ($${idx} || ' days')::interval
          )`,
          values: [condition.value],
        };
      }

    case 'engagement_score':
      if (condition.operator === 'greater_than') {
        return {
          sql: `c.engagement_score > $${idx}`,
          values: [condition.value],
        };
      } else {
        return {
          sql: `c.engagement_score < $${idx}`,
          values: [condition.value],
        };
      }

    case 'communication_source':
      return {
        sql: `EXISTS (SELECT 1 FROM communications comm WHERE comm.contact_id = c.id AND comm.source = $${idx})`,
        values: [condition.value],
      };

    default:
      // Handle fact-based conditions (fact.birthday, fact.location, fact.company, etc.)
      if (condition.field.startsWith('fact.')) {
        const fact_type = condition.field.replace('fact.', '');

        if (condition.operator === 'is_empty') {
          return {
            sql: `NOT EXISTS (SELECT 1 FROM facts f_cond WHERE f_cond.contact_id = c.id AND f_cond.fact_type = $${idx} AND f_cond.deleted_at IS NULL)`,
            values: [fact_type],
          };
        } else if (condition.operator === 'is_not_empty') {
          return {
            sql: `EXISTS (SELECT 1 FROM facts f_cond WHERE f_cond.contact_id = c.id AND f_cond.fact_type = $${idx} AND f_cond.deleted_at IS NULL)`,
            values: [fact_type],
          };
        } else if (condition.operator === 'contains') {
          return {
            sql: `EXISTS (SELECT 1 FROM facts f_cond WHERE f_cond.contact_id = c.id AND f_cond.fact_type = $${idx} AND f_cond.value ILIKE $${idx + 1} AND f_cond.deleted_at IS NULL)`,
            values: [fact_type, `%${condition.value}%`],
          };
        } else if (condition.operator === 'equals') {
          return {
            sql: `EXISTS (SELECT 1 FROM facts f_cond WHERE f_cond.contact_id = c.id AND f_cond.fact_type = $${idx} AND f_cond.value = $${idx + 1} AND f_cond.deleted_at IS NULL)`,
            values: [fact_type, condition.value],
          };
        } else if (condition.operator === 'not_equals') {
          return {
            sql: `NOT EXISTS (SELECT 1 FROM facts f_cond WHERE f_cond.contact_id = c.id AND f_cond.fact_type = $${idx} AND f_cond.value = $${idx + 1} AND f_cond.deleted_at IS NULL)`,
            values: [fact_type, condition.value],
          };
        }
      }

      throw new Error(`Unknown condition field: ${condition.field}`);
  }
}

function build_smart_list_query(rules: SmartListRules): { sql: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];

  for (const condition of rules.conditions) {
    const built = build_condition(condition, values.length);
    conditions.push(built.sql);
    values.push(...built.values);
  }

  const joiner = rules.operator === 'OR' ? ' OR ' : ' AND ';
  const where_clause = conditions.length > 0 ? `AND (${conditions.join(joiner)})` : '';

  return {
    sql: `
      SELECT DISTINCT c.*
      FROM contacts c
      WHERE c.deleted_at IS NULL
      ${where_clause}
      ORDER BY c.display_name ASC
    `,
    values,
  };
}

async function get_smart_list_contact_count(rules: SmartListRules): Promise<number> {
  const { sql, values } = build_smart_list_query(rules);
  const count_sql = `SELECT COUNT(*) as count FROM (${sql}) subq`;
  const result = await query<{ count: string }>(count_sql, values);
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

export async function list_smart_lists(): Promise<SmartListWithCount[]> {
  const lists = await query<SmartList>('SELECT * FROM smart_lists ORDER BY name ASC');

  const with_counts = await Promise.all(
    lists.rows.map(async (list) => ({
      ...list,
      contact_count: await get_smart_list_contact_count(list.rules),
    }))
  );

  return with_counts;
}

export async function get_smart_list(id: string): Promise<SmartList | null> {
  const result = await query<SmartList>('SELECT * FROM smart_lists WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function get_smart_list_contacts(
  id: string,
  pagination: PaginationParams
): Promise<{ contacts: Contact[]; nextCursor: string | null }> {
  const list = await query<SmartList>('SELECT * FROM smart_lists WHERE id = $1', [id]);
  if (!list.rows[0]) {
    throw new NotFoundError('Smart list not found');
  }

  const { sql, values } = build_smart_list_query(list.rows[0].rules);

  // Add cursor pagination
  let paginated_sql = sql;
  if (pagination.cursor) {
    values.push(pagination.cursor);
    // Modify SQL to add cursor condition
    paginated_sql = sql.replace(
      'ORDER BY c.display_name ASC',
      `AND (c.display_name, c.id) > (
        SELECT display_name, id FROM contacts WHERE id = $${values.length}
      )
      ORDER BY c.display_name ASC`
    );
  }

  // Add limit
  values.push(pagination.limit + 1);
  paginated_sql = paginated_sql.replace(
    'ORDER BY c.display_name ASC',
    `ORDER BY c.display_name ASC LIMIT $${values.length}`
  );

  const result = await query<Contact>(paginated_sql, values);

  const has_more = result.rows.length > pagination.limit;
  const contacts = has_more ? result.rows.slice(0, -1) : result.rows;
  const last_contact = contacts[contacts.length - 1];
  const next_cursor = has_more && last_contact ? last_contact.id : null;

  return { contacts, nextCursor: next_cursor };
}

export async function create_smart_list(input: CreateSmartListInput): Promise<SmartList> {
  const result = await query<SmartList>(
    `INSERT INTO smart_lists (name, rules)
     VALUES ($1, $2)
     RETURNING *`,
    [input.name, JSON.stringify(input.rules)]
  );
  return result.rows[0];
}

export async function update_smart_list(id: string, input: UpdateSmartListInput): Promise<SmartList | null> {
  const existing = await query<SmartList>('SELECT * FROM smart_lists WHERE id = $1', [id]);
  if (!existing.rows[0]) {
    return null;
  }

  const updates: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [];
  let param_index = 1;

  if (input.name !== undefined) {
    values.push(input.name);
    updates.push(`name = $${param_index++}`);
  }

  if (input.rules !== undefined) {
    values.push(JSON.stringify(input.rules));
    updates.push(`rules = $${param_index++}`);
  }

  values.push(id);
  const result = await query<SmartList>(
    `UPDATE smart_lists SET ${updates.join(', ')} WHERE id = $${param_index} RETURNING *`,
    values
  );

  return result.rows[0];
}

export async function delete_smart_list(id: string): Promise<boolean> {
  const result = await query('DELETE FROM smart_lists WHERE id = $1 RETURNING id', [id]);
  return result.rowCount !== null && result.rowCount > 0;
}
