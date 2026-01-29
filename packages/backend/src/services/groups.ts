import { query, get_pool } from '../db/index.js';
import type { Group, GroupWithCount, GroupTreeNode } from '@pkb/shared';

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

const MAX_GROUP_DEPTH = 5;

export interface CreateGroupInput {
  name: string;
  parent_id?: string;
  followup_days?: number;
}

export interface UpdateGroupInput {
  name?: string;
  parent_id?: string | null;
  followup_days?: number | null;
}

function build_group_tree(groups: GroupWithCount[]): GroupTreeNode[] {
  const map = new Map<string, GroupTreeNode>();
  const roots: GroupTreeNode[] = [];

  // First pass: index by id
  for (const group of groups) {
    map.set(group.id, { ...group, children: [] });
  }

  // Second pass: build hierarchy
  for (const group of groups) {
    const node = map.get(group.id)!;
    if (group.parent_id && map.has(group.parent_id)) {
      map.get(group.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

async function get_group_depth(group_id: string): Promise<number> {
  const result = await query<{ depth: number }>(
    `WITH RECURSIVE group_path AS (
       SELECT id, parent_id, 1 as depth
       FROM groups
       WHERE id = $1
       UNION ALL
       SELECT g.id, g.parent_id, gp.depth + 1
       FROM groups g
       JOIN group_path gp ON g.id = gp.parent_id
     )
     SELECT MAX(depth) as depth FROM group_path`,
    [group_id]
  );
  return result.rows[0]?.depth ?? 0;
}

async function get_descendant_depth(group_id: string): Promise<number> {
  const result = await query<{ depth: number }>(
    `WITH RECURSIVE group_descendants AS (
       SELECT id, 0 as depth
       FROM groups
       WHERE id = $1
       UNION ALL
       SELECT g.id, gd.depth + 1
       FROM groups g
       JOIN group_descendants gd ON g.parent_id = gd.id
     )
     SELECT MAX(depth) as depth FROM group_descendants`,
    [group_id]
  );
  return result.rows[0]?.depth ?? 0;
}

export async function list_groups(): Promise<GroupTreeNode[]> {
  const result = await query<GroupWithCount>(
    `SELECT g.*,
            COUNT(cg.contact_id)::int as contact_count
     FROM groups g
     LEFT JOIN contact_groups cg ON cg.group_id = g.id
     LEFT JOIN contacts c ON c.id = cg.contact_id AND c.deleted_at IS NULL
     GROUP BY g.id
     ORDER BY g.name ASC`
  );

  return build_group_tree(result.rows);
}

export async function list_groups_flat(): Promise<GroupWithCount[]> {
  const result = await query<GroupWithCount>(
    `SELECT g.*,
            COUNT(cg.contact_id)::int as contact_count
     FROM groups g
     LEFT JOIN contact_groups cg ON cg.group_id = g.id
     LEFT JOIN contacts c ON c.id = cg.contact_id AND c.deleted_at IS NULL
     GROUP BY g.id
     ORDER BY g.name ASC`
  );

  return result.rows;
}

export async function get_group(id: string): Promise<Group | null> {
  const result = await query<Group>('SELECT * FROM groups WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function create_group(input: CreateGroupInput): Promise<Group> {
  if (input.parent_id) {
    const parent = await query<{ id: string }>('SELECT id FROM groups WHERE id = $1', [input.parent_id]);
    if (!parent.rows[0]) {
      throw new NotFoundError('Parent group not found');
    }

    // Check depth limit
    const parent_depth = await get_group_depth(input.parent_id);
    if (parent_depth >= MAX_GROUP_DEPTH) {
      throw new ConflictError(`Cannot create group: maximum hierarchy depth of ${MAX_GROUP_DEPTH} exceeded`);
    }
  }

  const result = await query<Group>(
    `INSERT INTO groups (name, parent_id, followup_days)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.name, input.parent_id ?? null, input.followup_days ?? null]
  );
  return result.rows[0];
}

export async function update_group(id: string, input: UpdateGroupInput): Promise<Group | null> {
  const existing = await query<Group>('SELECT * FROM groups WHERE id = $1', [id]);
  if (!existing.rows[0]) {
    return null;
  }

  if (input.parent_id !== undefined && input.parent_id !== null) {
    // Cannot set parent to self
    if (input.parent_id === id) {
      throw new ConflictError('Cannot set group as its own parent');
    }

    // Verify parent exists
    const parent = await query<{ id: string }>('SELECT id FROM groups WHERE id = $1', [input.parent_id]);
    if (!parent.rows[0]) {
      throw new NotFoundError('Parent group not found');
    }

    // Check we're not creating a cycle (parent is not a descendant of this group)
    const is_descendant = await query<{ id: string }>(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM groups WHERE parent_id = $1
         UNION ALL
         SELECT g.id FROM groups g JOIN descendants d ON g.parent_id = d.id
       )
       SELECT id FROM descendants WHERE id = $2`,
      [id, input.parent_id]
    );
    if (is_descendant.rows[0]) {
      throw new ConflictError('Cannot set parent: would create a cycle');
    }

    // Check depth limit
    const parent_depth = await get_group_depth(input.parent_id);
    const descendant_depth = await get_descendant_depth(id);
    if (parent_depth + descendant_depth + 1 > MAX_GROUP_DEPTH) {
      throw new ConflictError(`Cannot move group: maximum hierarchy depth of ${MAX_GROUP_DEPTH} exceeded`);
    }
  }

  const updates: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [];
  let param_index = 1;

  if (input.name !== undefined) {
    values.push(input.name);
    updates.push(`name = $${param_index++}`);
  }

  if (input.parent_id !== undefined) {
    values.push(input.parent_id);
    updates.push(`parent_id = $${param_index++}`);
  }

  if (input.followup_days !== undefined) {
    values.push(input.followup_days);
    updates.push(`followup_days = $${param_index++}`);
  }

  values.push(id);
  const result = await query<Group>(
    `UPDATE groups SET ${updates.join(', ')} WHERE id = $${param_index} RETURNING *`,
    values
  );

  return result.rows[0];
}

export async function delete_group(id: string): Promise<boolean> {
  // Check for children
  const children = await query<{ id: string }>('SELECT id FROM groups WHERE parent_id = $1', [id]);
  if (children.rows.length > 0) {
    throw new ConflictError('Cannot delete group with children. Delete children first.');
  }

  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Remove contact associations
    await client.query('DELETE FROM contact_groups WHERE group_id = $1', [id]);

    // Delete group
    const result = await client.query('DELETE FROM groups WHERE id = $1 RETURNING id', [id]);

    await client.query('COMMIT');
    return result.rowCount !== null && result.rowCount > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function add_contact_to_group(contact_id: string, group_id: string): Promise<void> {
  // Verify contact exists
  const contact = await query<{ id: string }>(
    'SELECT id FROM contacts WHERE id = $1 AND deleted_at IS NULL',
    [contact_id]
  );
  if (!contact.rows[0]) {
    throw new NotFoundError('Contact not found');
  }

  // Verify group exists
  const group = await query<{ id: string }>('SELECT id FROM groups WHERE id = $1', [group_id]);
  if (!group.rows[0]) {
    throw new NotFoundError('Group not found');
  }

  await query(
    `INSERT INTO contact_groups (contact_id, group_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [contact_id, group_id]
  );
}

export async function remove_contact_from_group(contact_id: string, group_id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM contact_groups WHERE contact_id = $1 AND group_id = $2',
    [contact_id, group_id]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function get_contact_groups(contact_id: string): Promise<Group[]> {
  const result = await query<Group>(
    `SELECT g.* FROM groups g
     JOIN contact_groups cg ON cg.group_id = g.id
     WHERE cg.contact_id = $1
     ORDER BY g.name`,
    [contact_id]
  );
  return result.rows;
}
