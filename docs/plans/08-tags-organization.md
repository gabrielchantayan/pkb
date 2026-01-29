# Feature: Tags & Organization

## Overview

Contact organization system with flat tags, hierarchical groups, and smart lists (dynamic saved searches). Tags and groups can have follow-up thresholds for automatic reminder generation.

## Dependencies

- **Requires**: 01-project-foundation, 02-authentication, 03-contacts-core
- **Used by**: 07-followups (for threshold rules), 09-search (for filtering)

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tags | Flat with colors | Simple, visual |
| Groups | Hierarchical (parent_id) | Folder-like organization |
| Smart lists | JSON rules | Flexible filter definitions |
| Many-to-many | Junction tables | Standard pattern |

## Database Tables

Tables from 01-project-foundation:
- `tags` - Tag definitions with colors and followup_days
- `contact_tags` - Contact-tag associations
- `groups` - Hierarchical group definitions
- `contact_groups` - Contact-group associations
- `smart_lists` - Saved filter definitions

## API Endpoints

### Tags

#### List Tags
```
GET /api/tags
Response:
{
  tags: {
    id: UUID,
    name: string,
    color: string,
    followup_days: number | null,
    contact_count: number
  }[]
}
```

#### Create Tag
```
POST /api/tags
Body:
{
  name: string,
  color?: string,  // hex color
  followup_days?: number
}
Response: { tag: Tag }
```

#### Update Tag
```
PUT /api/tags/:id
Body:
{
  name?: string,
  color?: string,
  followup_days?: number
}
Response: { tag: Tag }
```

#### Delete Tag
```
DELETE /api/tags/:id
Response: { success: true }
```

#### Add Tag to Contact
```
POST /api/contacts/:contactId/tags
Body: { tag_id: UUID }
Response: { success: true }
```

#### Remove Tag from Contact
```
DELETE /api/contacts/:contactId/tags/:tagId
Response: { success: true }
```

### Groups

#### List Groups
```
GET /api/groups
Response:
{
  groups: {
    id: UUID,
    name: string,
    parent_id: UUID | null,
    followup_days: number | null,
    contact_count: number,
    children: Group[]  // nested
  }[]
}
```

#### Create Group
```
POST /api/groups
Body:
{
  name: string,
  parent_id?: UUID,
  followup_days?: number
}
Response: { group: Group }
```

#### Update Group
```
PUT /api/groups/:id
Body:
{
  name?: string,
  parent_id?: UUID,
  followup_days?: number
}
Response: { group: Group }
```

#### Delete Group
```
DELETE /api/groups/:id
Response: { success: true }
```

#### Add Contact to Group
```
POST /api/contacts/:contactId/groups
Body: { group_id: UUID }
Response: { success: true }
```

#### Remove Contact from Group
```
DELETE /api/contacts/:contactId/groups/:groupId
Response: { success: true }
```

### Smart Lists

#### List Smart Lists
```
GET /api/smartlists
Response:
{
  smartLists: {
    id: UUID,
    name: string,
    rules: SmartListRules,
    contact_count: number
  }[]
}
```

#### Get Smart List Contacts
```
GET /api/smartlists/:id/contacts
Query params: standard pagination
Response:
{
  contacts: Contact[],
  nextCursor: string | null
}
```

#### Create Smart List
```
POST /api/smartlists
Body:
{
  name: string,
  rules: SmartListRules
}
Response: { smartList: SmartList }
```

#### Update Smart List
```
PUT /api/smartlists/:id
Body:
{
  name?: string,
  rules?: SmartListRules
}
Response: { smartList: SmartList }
```

#### Delete Smart List
```
DELETE /api/smartlists/:id
Response: { success: true }
```

## Smart List Rules Schema

```typescript
interface SmartListRules {
  operator: 'AND' | 'OR';
  conditions: Condition[];
}

interface Condition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty';
  value?: any;
}

// Supported fields:
// - 'tag' (value: tag_id)
// - 'group' (value: group_id)
// - 'starred' (value: boolean)
// - 'last_contact_days' (value: number, operator: greater_than/less_than)
// - 'engagement_score' (value: number)
// - 'fact.birthday' (operator: is_empty/is_not_empty)
// - 'fact.location' (value: string, operator: contains)
// - 'fact.company' (value: string)
// - 'communication_source' (value: 'imessage'/'gmail'/etc)
```

## Implementation

### Tags Service

```typescript
// src/services/tags.ts

export async function listTags() {
  return db.query(`
    SELECT t.*,
           COUNT(ct.contact_id) as contact_count
    FROM tags t
    LEFT JOIN contact_tags ct ON ct.tag_id = t.id
    LEFT JOIN contacts c ON c.id = ct.contact_id AND c.deleted_at IS NULL
    GROUP BY t.id
    ORDER BY t.name ASC
  `);
}

export async function createTag(input: CreateTagInput) {
  // Check for duplicate name
  const existing = await db.query('SELECT id FROM tags WHERE name = $1', [input.name]);
  if (existing.rows[0]) throw new ConflictError('Tag name already exists');

  return db.query(`
    INSERT INTO tags (name, color, followup_days)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [input.name, input.color || '#808080', input.followup_days]);
}

export async function addTagToContact(contactId: string, tagId: string) {
  await db.query(`
    INSERT INTO contact_tags (contact_id, tag_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
  `, [contactId, tagId]);
}

export async function removeTagFromContact(contactId: string, tagId: string) {
  await db.query(
    'DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id = $2',
    [contactId, tagId]
  );
}
```

### Groups Service

```typescript
// src/services/groups.ts

export async function listGroups() {
  const result = await db.query(`
    SELECT g.*,
           COUNT(cg.contact_id) as contact_count
    FROM groups g
    LEFT JOIN contact_groups cg ON cg.group_id = g.id
    LEFT JOIN contacts c ON c.id = cg.contact_id AND c.deleted_at IS NULL
    GROUP BY g.id
    ORDER BY g.name ASC
  `);

  // Build tree structure
  return buildGroupTree(result.rows);
}

function buildGroupTree(groups: any[]): any[] {
  const map = new Map();
  const roots: any[] = [];

  // First pass: index by id
  for (const group of groups) {
    map.set(group.id, { ...group, children: [] });
  }

  // Second pass: build hierarchy
  for (const group of groups) {
    const node = map.get(group.id);
    if (group.parent_id && map.has(group.parent_id)) {
      map.get(group.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function createGroup(input: CreateGroupInput) {
  // Validate parent exists if provided
  if (input.parent_id) {
    const parent = await db.query('SELECT id FROM groups WHERE id = $1', [input.parent_id]);
    if (!parent.rows[0]) throw new NotFoundError('Parent group not found');
  }

  return db.query(`
    INSERT INTO groups (name, parent_id, followup_days)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [input.name, input.parent_id, input.followup_days]);
}

export async function deleteGroup(groupId: string) {
  // Check for children
  const children = await db.query('SELECT id FROM groups WHERE parent_id = $1', [groupId]);
  if (children.rows.length > 0) {
    throw new ConflictError('Cannot delete group with children. Delete children first.');
  }

  // Remove contact associations
  await db.query('DELETE FROM contact_groups WHERE group_id = $1', [groupId]);

  // Delete group
  await db.query('DELETE FROM groups WHERE id = $1', [groupId]);
}
```

### Smart Lists Service

```typescript
// src/services/smartlists.ts

export async function listSmartLists() {
  const lists = await db.query('SELECT * FROM smart_lists ORDER BY name ASC');

  // Get contact counts for each
  const withCounts = await Promise.all(
    lists.rows.map(async (list) => ({
      ...list,
      contact_count: await getSmartListContactCount(list.id)
    }))
  );

  return withCounts;
}

export async function getSmartListContacts(smartListId: string, pagination: PaginationParams) {
  const list = await db.query('SELECT * FROM smart_lists WHERE id = $1', [smartListId]);
  if (!list.rows[0]) throw new NotFoundError('Smart list not found');

  const query = buildSmartListQuery(list.rows[0].rules);
  return db.query(query.sql + ' LIMIT $' + (query.values.length + 1), [...query.values, pagination.limit]);
}

function buildSmartListQuery(rules: SmartListRules): { sql: string; values: any[] } {
  const conditions: string[] = [];
  const values: any[] = [];

  for (const condition of rules.conditions) {
    const { sql, newValues } = buildCondition(condition, values.length);
    conditions.push(sql);
    values.push(...newValues);
  }

  const operator = rules.operator === 'OR' ? ' OR ' : ' AND ';

  return {
    sql: `
      SELECT DISTINCT c.*
      FROM contacts c
      LEFT JOIN contact_tags ct ON ct.contact_id = c.id
      LEFT JOIN contact_groups cg ON cg.contact_id = c.id
      LEFT JOIN facts f ON f.contact_id = c.id AND f.deleted_at IS NULL
      LEFT JOIN (
        SELECT contact_id, MAX(timestamp) as last_comm
        FROM communications
        GROUP BY contact_id
      ) lc ON lc.contact_id = c.id
      WHERE c.deleted_at IS NULL
        AND (${conditions.join(operator)})
      ORDER BY c.display_name ASC
    `,
    values
  };
}

function buildCondition(condition: Condition, paramOffset: number): { sql: string; newValues: any[] } {
  const idx = paramOffset + 1;

  switch (condition.field) {
    case 'tag':
      return {
        sql: `ct.tag_id = $${idx}`,
        newValues: [condition.value]
      };

    case 'group':
      return {
        sql: `cg.group_id = $${idx}`,
        newValues: [condition.value]
      };

    case 'starred':
      return {
        sql: `c.starred = $${idx}`,
        newValues: [condition.value]
      };

    case 'last_contact_days':
      if (condition.operator === 'greater_than') {
        return {
          sql: `(lc.last_comm IS NULL OR lc.last_comm < NOW() - ($${idx} || ' days')::interval)`,
          newValues: [condition.value]
        };
      } else {
        return {
          sql: `lc.last_comm >= NOW() - ($${idx} || ' days')::interval`,
          newValues: [condition.value]
        };
      }

    case 'engagement_score':
      return {
        sql: `c.engagement_score ${condition.operator === 'greater_than' ? '>' : '<'} $${idx}`,
        newValues: [condition.value]
      };

    default:
      if (condition.field.startsWith('fact.')) {
        const factType = condition.field.replace('fact.', '');
        if (condition.operator === 'is_empty') {
          return {
            sql: `NOT EXISTS (SELECT 1 FROM facts f2 WHERE f2.contact_id = c.id AND f2.fact_type = $${idx} AND f2.deleted_at IS NULL)`,
            newValues: [factType]
          };
        } else if (condition.operator === 'is_not_empty') {
          return {
            sql: `EXISTS (SELECT 1 FROM facts f2 WHERE f2.contact_id = c.id AND f2.fact_type = $${idx} AND f2.deleted_at IS NULL)`,
            newValues: [factType]
          };
        } else {
          return {
            sql: `EXISTS (SELECT 1 FROM facts f2 WHERE f2.contact_id = c.id AND f2.fact_type = $${idx} AND f2.value ILIKE $${idx + 1} AND f2.deleted_at IS NULL)`,
            newValues: [factType, `%${condition.value}%`]
          };
        }
      }

      throw new Error(`Unknown condition field: ${condition.field}`);
  }
}
```

## Implementation Steps

1. Create `src/services/tags.ts` with tag operations
2. Create `src/services/groups.ts` with group operations
3. Create `src/services/smartlists.ts` with smart list operations
4. Create `src/routes/tags.ts`, `groups.ts`, `smartlists.ts`
5. Add group tree building logic
6. Implement smart list query builder
7. Add endpoints to contacts routes for tag/group management
8. Add validation schemas
9. Test CRUD for all three entity types
10. Test smart list query generation with various rules

## Acceptance Criteria

- [ ] `GET /api/tags` returns tags with contact counts
- [ ] `POST /api/tags` creates tag with color and followup_days
- [ ] Tags can be added/removed from contacts
- [ ] `GET /api/groups` returns hierarchical group tree
- [ ] `POST /api/groups` creates group with optional parent
- [ ] Groups can be added/removed from contacts
- [ ] Cannot delete group with children
- [ ] `GET /api/smartlists` returns smart lists with contact counts
- [ ] `GET /api/smartlists/:id/contacts` returns filtered contacts
- [ ] Smart list rules support AND/OR operators
- [ ] Smart list rules support tag, group, starred, last_contact_days filters
- [ ] Smart list rules support fact-based filters

## Files to Create

| Path | Purpose |
|------|---------|
| `packages/backend/src/services/tags.ts` | Tag operations |
| `packages/backend/src/services/groups.ts` | Group operations |
| `packages/backend/src/services/smartlists.ts` | Smart list operations |
| `packages/backend/src/routes/tags.ts` | Tag endpoints |
| `packages/backend/src/routes/groups.ts` | Group endpoints |
| `packages/backend/src/routes/smartlists.ts` | Smart list endpoints |
| `packages/backend/src/schemas/organization.ts` | Validation schemas |
| `packages/shared/src/types/organization.ts` | TypeScript types |

## Notes for Implementation

- Smart list contact counts are expensive - consider caching
- Group hierarchy depth should be limited (e.g., max 5 levels)
- Tag colors should be validated as valid hex
- followup_days on tags/groups is used by 07-followups feature
- Smart list query builder must prevent SQL injection (parameterized)
- Consider adding "exclude" conditions to smart lists later
