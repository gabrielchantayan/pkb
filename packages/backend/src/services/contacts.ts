import { get_pool, query } from '../db/index.js';
import type { Contact, ContactIdentifier, Tag, Group, Fact, Communication } from '@pkb/shared';
import type { CreateContactInput, UpdateContactInput, ListContactsQuery, IdentifierInput } from '../schemas/contacts.js';

export interface ContactWithIdentifiers extends Contact {
  emails: string[];
  phones: string[];
}

export interface ContactDetailResponse {
  contact: Contact;
  identifiers: ContactIdentifier[];
  recentCommunications: Communication[];
  facts: Fact[];
  tags: Tag[];
  groups: Group[];
}

export interface ListContactsResponse {
  contacts: ContactWithIdentifiers[];
  nextCursor: string | null;
}

export interface DuplicateSuggestion {
  contacts: [Contact, Contact];
  confidence: number;
  reason: 'same_email' | 'same_phone' | 'similar_name';
}

export interface MergePreview {
  target: Contact;
  source: Contact;
  target_identifiers: ContactIdentifier[];
  source_identifiers: ContactIdentifier[];
  counts: {
    identifiers: number;
    communications: number;
    facts: number;
    notes: number;
    followups: number;
    tags: number;
    groups: number;
  };
}

const SORT_COLUMNS: Record<string, string> = {
  name: 'c.display_name',
  last_contact: 'c.updated_at',
  engagement: 'c.engagement_score',
  created: 'c.created_at',
};

export async function list_contacts(params: ListContactsQuery): Promise<ListContactsResponse> {
  const values: unknown[] = [];
  let param_index = 1;

  let where_clause = 'c.deleted_at IS NULL';
  const conditions: string[] = [];

  if (params.search) {
    values.push(`%${params.search}%`);
    conditions.push(`(
      c.display_name ILIKE $${param_index}
      OR EXISTS (SELECT 1 FROM contact_identifiers ci2
                 WHERE ci2.contact_id = c.id AND ci2.value ILIKE $${param_index})
    )`);
    param_index++;
  }

  if (params.starred !== undefined) {
    values.push(params.starred);
    conditions.push(`c.starred = $${param_index}`);
    param_index++;
  }

  if (params.tag) {
    values.push(params.tag);
    conditions.push(`EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = $${param_index})`);
    param_index++;
  }

  if (params.group) {
    values.push(params.group);
    conditions.push(`EXISTS (SELECT 1 FROM contact_groups cg WHERE cg.contact_id = c.id AND cg.group_id = $${param_index})`);
    param_index++;
  }

  if (params.cursor) {
    values.push(params.cursor);
    const sort_column = SORT_COLUMNS[params.sort] || 'c.display_name';
    const order = params.order === 'desc' ? '<' : '>';
    conditions.push(`(${sort_column}, c.id) ${order} (
      SELECT ${sort_column.replace('c.', 'cursor_c.')}, cursor_c.id
      FROM contacts cursor_c
      WHERE cursor_c.id = $${param_index}
    )`);
    param_index++;
  }

  if (conditions.length > 0) {
    where_clause += ' AND ' + conditions.join(' AND ');
  }

  const sort_column = SORT_COLUMNS[params.sort] || 'c.display_name';
  const order = params.order === 'desc' ? 'DESC' : 'ASC';

  values.push(params.limit + 1); // Fetch one extra to determine if there's a next page

  const sql = `
    SELECT c.*,
           COALESCE(array_agg(DISTINCT ci.value) FILTER (WHERE ci.type = 'email'), '{}') as emails,
           COALESCE(array_agg(DISTINCT ci.value) FILTER (WHERE ci.type = 'phone'), '{}') as phones
    FROM contacts c
    LEFT JOIN contact_identifiers ci ON ci.contact_id = c.id
    WHERE ${where_clause}
    GROUP BY c.id
    ORDER BY ${sort_column} ${order}, c.id ${order}
    LIMIT $${param_index}
  `;

  const result = await query<ContactWithIdentifiers>(sql, values);
  const limit = params.limit;
  const has_more = result.rows.length > limit;
  const contacts = has_more ? result.rows.slice(0, -1) : result.rows;
  const last_contact = contacts[contacts.length - 1];
  const next_cursor = has_more && last_contact ? last_contact.id : null;

  return { contacts, nextCursor: next_cursor };
}

export async function get_contact(id: string): Promise<ContactDetailResponse | null> {
  const contact_result = await query<Contact>(
    'SELECT * FROM contacts WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );

  if (contact_result.rows.length === 0) {
    return null;
  }

  const contact = contact_result.rows[0];

  const [identifiers_result, communications_result, facts_result, tags_result, groups_result] = await Promise.all([
    query<ContactIdentifier>(
      'SELECT * FROM contact_identifiers WHERE contact_id = $1 ORDER BY created_at',
      [id]
    ),
    query<Communication>(
      'SELECT * FROM communications WHERE contact_id = $1 ORDER BY timestamp DESC LIMIT 10',
      [id]
    ),
    query<Fact>(
      'SELECT * FROM facts WHERE contact_id = $1 AND deleted_at IS NULL ORDER BY created_at',
      [id]
    ),
    query<Tag>(
      `SELECT t.* FROM tags t
       JOIN contact_tags ct ON ct.tag_id = t.id
       WHERE ct.contact_id = $1
       ORDER BY t.name`,
      [id]
    ),
    query<Group>(
      `SELECT g.* FROM groups g
       JOIN contact_groups cg ON cg.group_id = g.id
       WHERE cg.contact_id = $1
       ORDER BY g.name`,
      [id]
    ),
  ]);

  return {
    contact,
    identifiers: identifiers_result.rows,
    recentCommunications: communications_result.rows,
    facts: facts_result.rows,
    tags: tags_result.rows,
    groups: groups_result.rows,
  };
}

export async function create_contact(
  input: CreateContactInput,
  identifiers_to_add?: IdentifierInput[]
): Promise<Contact> {
  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const contact_result = await client.query<Contact>(
      `INSERT INTO contacts (display_name, photo_url, starred)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.displayName, input.photoUrl ?? null, input.starred ?? false]
    );

    const contact = contact_result.rows[0];

    // Add identifiers
    const all_identifiers = [...(input.identifiers ?? []), ...(identifiers_to_add ?? [])];
    for (const identifier of all_identifiers) {
      const normalized_value = normalize_identifier(identifier.type, identifier.value);
      await client.query(
        `INSERT INTO contact_identifiers (contact_id, type, value, source)
         VALUES ($1, $2, $3, 'manual')
         ON CONFLICT (type, value) DO NOTHING`,
        [contact.id, identifier.type, normalized_value]
      );
    }

    // Audit log
    await client.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, new_value)
       VALUES ('contact', $1, 'create', $2)`,
      [contact.id, JSON.stringify({ display_name: contact.display_name })]
    );

    await client.query('COMMIT');
    return contact;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function update_contact(id: string, input: UpdateContactInput): Promise<Contact | null> {
  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current contact for audit log
    const current_result = await client.query<Contact>(
      'SELECT * FROM contacts WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (current_result.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const current = current_result.rows[0];
    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let param_index = 1;

    if (input.displayName !== undefined) {
      values.push(input.displayName);
      updates.push(`display_name = $${param_index++}`);
    }

    if (input.photoUrl !== undefined) {
      values.push(input.photoUrl);
      updates.push(`photo_url = $${param_index++}`);
    }

    if (input.starred !== undefined) {
      values.push(input.starred);
      updates.push(`starred = $${param_index++}`);
    }

    if (input.manualImportance !== undefined) {
      values.push(input.manualImportance);
      updates.push(`manual_importance = $${param_index++}`);
    }

    values.push(id);
    const update_result = await client.query<Contact>(
      `UPDATE contacts SET ${updates.join(', ')} WHERE id = $${param_index} RETURNING *`,
      values
    );

    const updated = update_result.rows[0];

    // Audit log
    await client.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value)
       VALUES ('contact', $1, 'update', $2, $3)`,
      [id, JSON.stringify(current), JSON.stringify(updated)]
    );

    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function delete_contact(id: string): Promise<boolean> {
  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query<Contact>(
      `UPDATE contacts SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    // Audit log
    await client.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, old_value)
       VALUES ('contact', $1, 'delete', $2)`,
      [id, JSON.stringify(result.rows[0])]
    );

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function star_contact(id: string, starred: boolean): Promise<Contact | null> {
  const result = await query<Contact>(
    `UPDATE contacts SET starred = $1, updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [starred, id]
  );

  return result.rows[0] ?? null;
}

export async function find_duplicates(): Promise<DuplicateSuggestion[]> {
  // Find contacts sharing email
  const email_dupes_result = await query<{
    contact1_id: string;
    contact2_id: string;
    match_value: string;
  }>(`
    SELECT ci1.contact_id as contact1_id, ci2.contact_id as contact2_id, ci1.value as match_value
    FROM contact_identifiers ci1
    JOIN contact_identifiers ci2 ON ci1.value = ci2.value AND ci1.contact_id < ci2.contact_id
    JOIN contacts c1 ON c1.id = ci1.contact_id AND c1.deleted_at IS NULL
    JOIN contacts c2 ON c2.id = ci2.contact_id AND c2.deleted_at IS NULL
    WHERE ci1.type = 'email' AND ci2.type = 'email'
  `);

  // Find contacts sharing phone
  const phone_dupes_result = await query<{
    contact1_id: string;
    contact2_id: string;
    match_value: string;
  }>(`
    SELECT ci1.contact_id as contact1_id, ci2.contact_id as contact2_id, ci1.value as match_value
    FROM contact_identifiers ci1
    JOIN contact_identifiers ci2 ON ci1.value = ci2.value AND ci1.contact_id < ci2.contact_id
    JOIN contacts c1 ON c1.id = ci1.contact_id AND c1.deleted_at IS NULL
    JOIN contacts c2 ON c2.id = ci2.contact_id AND c2.deleted_at IS NULL
    WHERE ci1.type = 'phone' AND ci2.type = 'phone'
  `);

  const contact_ids = new Set<string>();
  for (const row of [...email_dupes_result.rows, ...phone_dupes_result.rows]) {
    contact_ids.add(row.contact1_id);
    contact_ids.add(row.contact2_id);
  }

  if (contact_ids.size === 0) {
    return [];
  }

  const contacts_result = await query<Contact>(
    'SELECT * FROM contacts WHERE id = ANY($1)',
    [Array.from(contact_ids)]
  );

  const contacts_map = new Map<string, Contact>();
  for (const contact of contacts_result.rows) {
    contacts_map.set(contact.id, contact);
  }

  const duplicates: DuplicateSuggestion[] = [];

  for (const row of email_dupes_result.rows) {
    const c1 = contacts_map.get(row.contact1_id);
    const c2 = contacts_map.get(row.contact2_id);
    if (c1 && c2) {
      duplicates.push({
        contacts: [c1, c2],
        confidence: 0.95,
        reason: 'same_email',
      });
    }
  }

  for (const row of phone_dupes_result.rows) {
    const c1 = contacts_map.get(row.contact1_id);
    const c2 = contacts_map.get(row.contact2_id);
    if (c1 && c2) {
      // Check if already added via email
      const already_added = duplicates.some(
        (d) =>
          (d.contacts[0].id === row.contact1_id && d.contacts[1].id === row.contact2_id) ||
          (d.contacts[0].id === row.contact2_id && d.contacts[1].id === row.contact1_id)
      );
      if (!already_added) {
        duplicates.push({
          contacts: [c1, c2],
          confidence: 0.9,
          reason: 'same_phone',
        });
      }
    }
  }

  return duplicates;
}

export async function get_merge_preview(target_id: string, source_id: string): Promise<MergePreview | null> {
  // Get both contacts
  const contacts_result = await query<Contact>(
    'SELECT * FROM contacts WHERE id IN ($1, $2) AND deleted_at IS NULL',
    [target_id, source_id]
  );

  if (contacts_result.rows.length !== 2) {
    return null;
  }

  const target = contacts_result.rows.find((c) => c.id === target_id)!;
  const source = contacts_result.rows.find((c) => c.id === source_id)!;

  // Get identifiers for both
  const [target_identifiers_result, source_identifiers_result] = await Promise.all([
    query<ContactIdentifier>('SELECT * FROM contact_identifiers WHERE contact_id = $1', [target_id]),
    query<ContactIdentifier>('SELECT * FROM contact_identifiers WHERE contact_id = $1', [source_id]),
  ]);

  // Count what will be merged from source
  const [communications_count, facts_count, notes_count, followups_count, tags_count, groups_count] = await Promise.all([
    query<{ count: string }>('SELECT COUNT(*) as count FROM communications WHERE contact_id = $1', [source_id]),
    query<{ count: string }>('SELECT COUNT(*) as count FROM facts WHERE contact_id = $1 AND deleted_at IS NULL', [source_id]),
    query<{ count: string }>('SELECT COUNT(*) as count FROM notes WHERE contact_id = $1', [source_id]),
    query<{ count: string }>('SELECT COUNT(*) as count FROM followups WHERE contact_id = $1', [source_id]),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM contact_tags
       WHERE contact_id = $1
       AND tag_id NOT IN (SELECT tag_id FROM contact_tags WHERE contact_id = $2)`,
      [source_id, target_id]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM contact_groups
       WHERE contact_id = $1
       AND group_id NOT IN (SELECT group_id FROM contact_groups WHERE contact_id = $2)`,
      [source_id, target_id]
    ),
  ]);

  return {
    target,
    source,
    target_identifiers: target_identifiers_result.rows,
    source_identifiers: source_identifiers_result.rows,
    counts: {
      identifiers: source_identifiers_result.rows.length,
      communications: parseInt(communications_count.rows[0].count, 10),
      facts: parseInt(facts_count.rows[0].count, 10),
      notes: parseInt(notes_count.rows[0].count, 10),
      followups: parseInt(followups_count.rows[0].count, 10),
      tags: parseInt(tags_count.rows[0].count, 10),
      groups: parseInt(groups_count.rows[0].count, 10),
    },
  };
}

export async function merge_contacts(target_id: string, source_id: string): Promise<Contact | null> {
  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify both contacts exist
    const check_result = await client.query<Contact>(
      'SELECT * FROM contacts WHERE id IN ($1, $2) AND deleted_at IS NULL',
      [target_id, source_id]
    );

    if (check_result.rows.length !== 2) {
      await client.query('ROLLBACK');
      return null;
    }

    // Move identifiers (handle conflicts by keeping existing)
    await client.query(
      `UPDATE contact_identifiers
       SET contact_id = $1
       WHERE contact_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM contact_identifiers ci2
         WHERE ci2.contact_id = $1 AND ci2.type = contact_identifiers.type AND ci2.value = contact_identifiers.value
       )`,
      [target_id, source_id]
    );

    // Delete duplicate identifiers that couldn't be moved
    await client.query(
      'DELETE FROM contact_identifiers WHERE contact_id = $1',
      [source_id]
    );

    // Move communications
    await client.query(
      'UPDATE communications SET contact_id = $1 WHERE contact_id = $2',
      [target_id, source_id]
    );

    // Move facts
    await client.query(
      'UPDATE facts SET contact_id = $1 WHERE contact_id = $2',
      [target_id, source_id]
    );

    // Move notes
    await client.query(
      'UPDATE notes SET contact_id = $1 WHERE contact_id = $2',
      [target_id, source_id]
    );

    // Move followups
    await client.query(
      'UPDATE followups SET contact_id = $1 WHERE contact_id = $2',
      [target_id, source_id]
    );

    // Move tags (avoid duplicates)
    await client.query(
      `INSERT INTO contact_tags (contact_id, tag_id)
       SELECT $1, tag_id FROM contact_tags WHERE contact_id = $2
       ON CONFLICT (contact_id, tag_id) DO NOTHING`,
      [target_id, source_id]
    );
    await client.query('DELETE FROM contact_tags WHERE contact_id = $1', [source_id]);

    // Move groups (avoid duplicates)
    await client.query(
      `INSERT INTO contact_groups (contact_id, group_id)
       SELECT $1, group_id FROM contact_groups WHERE contact_id = $2
       ON CONFLICT (contact_id, group_id) DO NOTHING`,
      [target_id, source_id]
    );
    await client.query('DELETE FROM contact_groups WHERE contact_id = $1', [source_id]);

    // Soft delete source contact
    await client.query(
      'UPDATE contacts SET deleted_at = NOW() WHERE id = $1',
      [source_id]
    );

    // Update target contact timestamp
    const updated_result = await client.query<Contact>(
      'UPDATE contacts SET updated_at = NOW() WHERE id = $1 RETURNING *',
      [target_id]
    );

    // Audit log for merge
    await client.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value)
       VALUES ('contact', $1, 'update', $2, $3)`,
      [target_id, JSON.stringify({ merged_from: source_id }), JSON.stringify({ merge_completed: true })]
    );

    await client.query('COMMIT');
    return updated_result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function normalize_identifier(type: string, value: string): string {
  if (type === 'email') {
    return value.toLowerCase().trim();
  }
  if (type === 'phone') {
    // Remove all non-digits except leading +
    return value.replace(/[^\d+]/g, '');
  }
  return value.trim();
}

// Batch import contacts from daemon (Apple Contacts sync)
export interface ContactImportInput {
  source_id: string;
  display_name: string;
  emails?: string[];
  phones?: string[];
  facts?: Array<{ type: string; value: string }>;
  note?: string;
  photo_data?: string; // base64
}

export interface ContactsImportResult {
  created: number;
  updated: number;
  merged: number;
  errors: Array<{ index: number; error: string }>;
}

export async function batch_import_contacts(
  contacts: ContactImportInput[]
): Promise<ContactsImportResult> {
  const pool = get_pool();
  const client = await pool.connect();

  const result: ContactsImportResult = {
    created: 0,
    updated: 0,
    merged: 0,
    errors: [],
  };

  try {
    await client.query('BEGIN');

    for (let i = 0; i < contacts.length; i++) {
      try {
        const contact = contacts[i];
        const all_identifiers: Array<{ type: string; value: string }> = [];

        // Collect all identifiers
        for (const email of contact.emails ?? []) {
          all_identifiers.push({ type: 'email', value: email });
        }
        for (const phone of contact.phones ?? []) {
          all_identifiers.push({ type: 'phone', value: phone });
        }

        // Try to find existing contact by any identifier
        let existing_contact_id: string | null = null;
        for (const id of all_identifiers) {
          const normalized = normalize_identifier(id.type, id.value);
          const found = await client.query<{ contact_id: string }>(
            `SELECT ci.contact_id
             FROM contact_identifiers ci
             JOIN contacts c ON c.id = ci.contact_id
             WHERE ci.type = $1 AND ci.value = $2 AND c.deleted_at IS NULL`,
            [id.type, normalized]
          );
          if (found.rows[0]) {
            existing_contact_id = found.rows[0].contact_id;
            break;
          }
        }

        if (existing_contact_id) {
          // Update existing contact - also update display_name if we have a better one
          // (i.e., the current name is empty or just looks like a phone/email)
          const current = await client.query<{ display_name: string }>(
            `SELECT display_name FROM contacts WHERE id = $1`,
            [existing_contact_id]
          );
          const current_name = current.rows[0]?.display_name || '';
          const should_update_name =
            !current_name ||
            current_name.startsWith('+') ||
            current_name.match(/^\d+$/) ||
            current_name.includes('@');

          if (should_update_name && contact.display_name) {
            await client.query(
              `UPDATE contacts SET display_name = $1, updated_at = NOW() WHERE id = $2`,
              [contact.display_name, existing_contact_id]
            );
          } else {
            await client.query(
              `UPDATE contacts SET updated_at = NOW() WHERE id = $1`,
              [existing_contact_id]
            );
          }

          // Add any new identifiers
          for (const id of all_identifiers) {
            const normalized = normalize_identifier(id.type, id.value);
            await client.query(
              `INSERT INTO contact_identifiers (contact_id, type, value, source)
               VALUES ($1, $2, $3, 'addressbook')
               ON CONFLICT (type, value) DO NOTHING`,
              [existing_contact_id, id.type, normalized]
            );
          }

          // Add any new facts
          for (const fact of contact.facts ?? []) {
            // Check if fact already exists
            const existing_fact = await client.query(
              `SELECT id FROM facts
               WHERE contact_id = $1 AND fact_type = $2 AND deleted_at IS NULL`,
              [existing_contact_id, fact.type]
            );

            if (existing_fact.rows.length === 0) {
              await client.query(
                `INSERT INTO facts (contact_id, category, fact_type, value, source, confidence)
                 VALUES ($1, 'basic_info', $2, $3, 'addressbook', 0.9)`,
                [existing_contact_id, fact.type, fact.value]
              );
            }
          }

          result.updated++;
        } else {
          // Create new contact
          const new_contact = await client.query<{ id: string }>(
            `INSERT INTO contacts (display_name)
             VALUES ($1)
             RETURNING id`,
            [contact.display_name]
          );

          const contact_id = new_contact.rows[0].id;

          // Add identifiers
          for (const id of all_identifiers) {
            const normalized = normalize_identifier(id.type, id.value);
            await client.query(
              `INSERT INTO contact_identifiers (contact_id, type, value, source)
               VALUES ($1, $2, $3, 'addressbook')
               ON CONFLICT (type, value) DO NOTHING`,
              [contact_id, id.type, normalized]
            );
          }

          // Add facts
          for (const fact of contact.facts ?? []) {
            await client.query(
              `INSERT INTO facts (contact_id, category, fact_type, value, source, confidence)
               VALUES ($1, 'basic_info', $2, $3, 'addressbook', 0.9)`,
              [contact_id, fact.type, fact.value]
            );
          }

          // Add note if provided
          if (contact.note) {
            await client.query(
              `INSERT INTO notes (contact_id, content, source)
               VALUES ($1, $2, 'addressbook')`,
              [contact_id, contact.note]
            );
          }

          result.created++;
        }
      } catch (err) {
        result.errors.push({
          index: i,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return result;
}
