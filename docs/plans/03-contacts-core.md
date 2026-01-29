# Feature: Contacts Core

## Overview

Implement contact management: CRUD operations, multiple identifiers (emails, phones), starring, duplicate detection, and contact merging.

## Dependencies

- **Requires**: 01-project-foundation, 02-authentication
- **Blocks**: 04-communications, 05-facts-system, 06-notes, 07-followups

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Duplicate detection | Email/phone exact match + fuzzy name | High confidence signals |
| Merge strategy | Keep older contact ID, merge all data | Preserves references |
| Soft delete | `deleted_at` timestamp | Required by SPEC |
| Pagination | Cursor-based | Better for large datasets |

## Database Tables

Tables created in 01-project-foundation:
- `contacts` - Core contact data
- `contact_identifiers` - Email, phone, social handles

## API Endpoints

### List Contacts
```
GET /api/contacts
Query params:
  - search: string (searches display_name, identifiers)
  - starred: boolean
  - tag: UUID
  - group: UUID
  - sort: 'name' | 'last_contact' | 'engagement' | 'created'
  - order: 'asc' | 'desc'
  - cursor: string (last contact ID)
  - limit: number (default 50, max 100)

Response:
{
  contacts: Contact[],
  nextCursor: string | null
}
```

### Get Contact Detail
```
GET /api/contacts/:id
Response:
{
  contact: Contact,
  identifiers: ContactIdentifier[],
  recentCommunications: Communication[] (last 10),
  facts: Fact[],
  tags: Tag[],
  groups: Group[]
}
```

### Create Contact
```
POST /api/contacts
Body:
{
  displayName: string,
  photoUrl?: string,
  starred?: boolean,
  identifiers?: { type: string, value: string }[]
}
Response: { contact: Contact }
```

### Update Contact
```
PUT /api/contacts/:id
Body: Partial<Contact>
Response: { contact: Contact }
```

### Delete Contact (soft)
```
DELETE /api/contacts/:id
Response: { success: true }
```

### Star/Unstar Contact
```
POST /api/contacts/:id/star
Body: { starred: boolean }
Response: { contact: Contact }
```

### Get Duplicate Suggestions
```
GET /api/contacts/duplicates
Response:
{
  duplicates: {
    contacts: [Contact, Contact],
    confidence: number,
    reason: string // 'same_email', 'same_phone', 'similar_name'
  }[]
}
```

### Merge Contacts
```
POST /api/contacts/:id/merge
Body: { mergeContactId: UUID }
Response: { contact: Contact }

Merge logic:
1. Keep the target contact (/:id)
2. Move all identifiers from mergeContactId to target
3. Move all communications, facts, notes, followups
4. Update audit log
5. Soft delete the merged contact
```

## Implementation

### Contact Service

```typescript
// src/services/contacts.ts

export async function listContacts(params: ListContactsParams) {
  let query = `
    SELECT c.*,
           array_agg(DISTINCT ci.value) FILTER (WHERE ci.type = 'email') as emails,
           array_agg(DISTINCT ci.value) FILTER (WHERE ci.type = 'phone') as phones
    FROM contacts c
    LEFT JOIN contact_identifiers ci ON ci.contact_id = c.id
    WHERE c.deleted_at IS NULL
  `;

  const conditions: string[] = [];
  const values: any[] = [];

  if (params.search) {
    values.push(`%${params.search}%`);
    conditions.push(`(
      c.display_name ILIKE $${values.length}
      OR EXISTS (SELECT 1 FROM contact_identifiers ci2
                 WHERE ci2.contact_id = c.id AND ci2.value ILIKE $${values.length})
    )`);
  }

  if (params.starred !== undefined) {
    values.push(params.starred);
    conditions.push(`c.starred = $${values.length}`);
  }

  // ... more filters

  if (conditions.length) {
    query += ' AND ' + conditions.join(' AND ');
  }

  query += ' GROUP BY c.id';
  query += ` ORDER BY c.${params.sort || 'display_name'} ${params.order || 'ASC'}`;
  query += ` LIMIT $${values.length + 1}`;
  values.push(params.limit || 50);

  return db.query(query, values);
}

export async function findDuplicates() {
  // Find contacts sharing email
  const emailDupes = await db.query(`
    SELECT ci1.contact_id as contact1, ci2.contact_id as contact2, ci1.value as match_value
    FROM contact_identifiers ci1
    JOIN contact_identifiers ci2 ON ci1.value = ci2.value AND ci1.contact_id < ci2.contact_id
    JOIN contacts c1 ON c1.id = ci1.contact_id AND c1.deleted_at IS NULL
    JOIN contacts c2 ON c2.id = ci2.contact_id AND c2.deleted_at IS NULL
    WHERE ci1.type = 'email' AND ci2.type = 'email'
  `);

  // Find contacts sharing phone
  const phoneDupes = await db.query(`
    SELECT ci1.contact_id as contact1, ci2.contact_id as contact2, ci1.value as match_value
    FROM contact_identifiers ci1
    JOIN contact_identifiers ci2 ON ci1.value = ci2.value AND ci1.contact_id < ci2.contact_id
    JOIN contacts c1 ON c1.id = ci1.contact_id AND c1.deleted_at IS NULL
    JOIN contacts c2 ON c2.id = ci2.contact_id AND c2.deleted_at IS NULL
    WHERE ci1.type = 'phone' AND ci2.type = 'phone'
  `);

  return [...emailDupes.rows, ...phoneDupes.rows];
}

export async function mergeContacts(targetId: string, sourceId: string) {
  return db.transaction(async (client) => {
    // Move identifiers
    await client.query(
      'UPDATE contact_identifiers SET contact_id = $1 WHERE contact_id = $2',
      [targetId, sourceId]
    );

    // Move communications
    await client.query(
      'UPDATE communications SET contact_id = $1 WHERE contact_id = $2',
      [targetId, sourceId]
    );

    // Move facts
    await client.query(
      'UPDATE facts SET contact_id = $1 WHERE contact_id = $2',
      [targetId, sourceId]
    );

    // Move notes
    await client.query(
      'UPDATE notes SET contact_id = $1 WHERE contact_id = $2',
      [targetId, sourceId]
    );

    // Move followups
    await client.query(
      'UPDATE followups SET contact_id = $1 WHERE contact_id = $2',
      [targetId, sourceId]
    );

    // Soft delete source
    await client.query(
      'UPDATE contacts SET deleted_at = NOW() WHERE id = $1',
      [sourceId]
    );

    // Log merge in audit
    await client.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, timestamp)
       VALUES ('contact', $1, 'merge', $2, $3, NOW())`,
      [targetId, JSON.stringify({ merged_from: sourceId }), null]
    );

    return client.query('SELECT * FROM contacts WHERE id = $1', [targetId]);
  });
}
```

### Identifier Management

```typescript
// src/services/identifiers.ts

export async function addIdentifier(contactId: string, type: string, value: string) {
  // Normalize value
  const normalized = type === 'email' ? value.toLowerCase().trim()
                   : type === 'phone' ? normalizePhone(value)
                   : value.trim();

  // Check for conflicts
  const existing = await db.query(
    'SELECT contact_id FROM contact_identifiers WHERE type = $1 AND value = $2',
    [type, normalized]
  );

  if (existing.rows[0] && existing.rows[0].contact_id !== contactId) {
    throw new ConflictError(`${type} already belongs to another contact`);
  }

  return db.query(
    `INSERT INTO contact_identifiers (contact_id, type, value, source, created_at)
     VALUES ($1, $2, $3, 'manual', NOW())
     ON CONFLICT (type, value) DO NOTHING
     RETURNING *`,
    [contactId, type, normalized]
  );
}

function normalizePhone(phone: string): string {
  // Remove all non-digits except leading +
  return phone.replace(/[^\d+]/g, '');
}
```

## Implementation Steps

1. Create `src/services/contacts.ts` with all contact operations
2. Create `src/services/identifiers.ts` for identifier management
3. Create `src/routes/contacts.ts` with all endpoints
4. Add input validation with zod schemas
5. Add audit logging for create/update/delete/merge
6. Implement cursor-based pagination
7. Implement duplicate detection query
8. Implement merge transaction
9. Add tests for CRUD operations
10. Add tests for merge logic

## Acceptance Criteria

- [ ] `GET /api/contacts` returns paginated list with cursor
- [ ] `GET /api/contacts?search=john` filters by name and identifiers
- [ ] `GET /api/contacts/:id` returns contact with all related data
- [ ] `POST /api/contacts` creates contact with identifiers
- [ ] `PUT /api/contacts/:id` updates contact fields
- [ ] `DELETE /api/contacts/:id` soft deletes (sets deleted_at)
- [ ] `POST /api/contacts/:id/star` toggles starred status
- [ ] `GET /api/contacts/duplicates` returns contacts sharing email/phone
- [ ] `POST /api/contacts/:id/merge` moves all data and soft deletes source
- [ ] All mutations create audit log entries
- [ ] Phone numbers are normalized before storage
- [ ] Emails are lowercased before storage

## Files to Create

| Path | Purpose |
|------|---------|
| `packages/backend/src/services/contacts.ts` | Contact business logic |
| `packages/backend/src/services/identifiers.ts` | Identifier management |
| `packages/backend/src/routes/contacts.ts` | Contact API endpoints |
| `packages/backend/src/schemas/contacts.ts` | Zod validation schemas |
| `packages/shared/src/types/contact.ts` | Contact TypeScript types |

## Notes for Implementation

- Always filter by `deleted_at IS NULL` unless explicitly including deleted
- Merge is a transaction - all or nothing
- Duplicate detection should be efficient (indexed queries)
- Consider adding full-text search index on display_name later
- The daemon will use batch upsert (different endpoint), not individual creates
