# Feature: Facts System

## Overview

Store and manage facts about contacts - both manually entered and LLM-extracted. Includes versioning, conflict detection, and support for predefined fact types (birthday, job, relationships) and freeform facts.

## Dependencies

- **Requires**: 01-project-foundation, 02-authentication, 03-contacts-core, 04-communications
- **Blocks**: 10-ai-integration (provides extraction target)

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fact types | Predefined + freeform | Balance structure with flexibility |
| Versioning | Separate history table | Clean audit trail |
| Conflict detection | Same fact_type, different value, high confidence | Surface for user review |
| Structured values | JSONB column | Type-specific data (dates, relationships) |

## Predefined Fact Types

From SPEC.md:

**Basic Info:**
- `birthday` - structured: `{ date: "YYYY-MM-DD" }`
- `location` - structured: `{ city?: string, state?: string, country?: string }`
- `job_title` - string value
- `company` - string value
- `email` - string value (also creates identifier)
- `phone` - string value (also creates identifier)

**Relationships:**
- `spouse` - structured: `{ name: string, contact_id?: UUID }`
- `child` - structured: `{ name: string, age?: number, contact_id?: UUID }`
- `parent` - structured: `{ name: string, contact_id?: UUID }`
- `sibling` - structured: `{ name: string, contact_id?: UUID }`
- `friend` - structured: `{ name: string, contact_id?: UUID }`
- `colleague` - structured: `{ name: string, contact_id?: UUID }`
- `how_we_met` - string value (description)
- `mutual_connection` - structured: `{ name: string, contact_id?: UUID }`

**Custom:**
- `custom` - freeform fact with tags

## Database Tables

Tables from 01-project-foundation:
- `facts` - Fact storage with confidence scores
- `fact_history` - Version history

## API Endpoints

### List Facts
```
GET /api/facts
Query params:
  - contact_id: UUID (required or returns all)
  - category: 'basic_info' | 'relationship' | 'custom'
  - fact_type: string
  - source: 'extracted' | 'manual'
  - has_conflict: boolean
  - cursor: string
  - limit: number

Response:
{
  facts: Fact[],
  nextCursor: string | null
}
```

### Get Fact with History
```
GET /api/facts/:id
Response:
{
  fact: Fact,
  history: FactHistory[],
  sourceCommunication?: Communication
}
```

### Create Manual Fact
```
POST /api/facts
Body:
{
  contact_id: UUID,
  category: string,
  fact_type: string,
  value: string,
  structured_value?: object,
  reminder_enabled?: boolean
}
Response: { fact: Fact }
```

### Update Fact
```
PUT /api/facts/:id
Body:
{
  value?: string,
  structured_value?: object,
  reminder_enabled?: boolean
}
Response: { fact: Fact }
```

### Delete Fact (soft)
```
DELETE /api/facts/:id
Response: { success: true }
```

### Get Fact History
```
GET /api/facts/:id/history
Response:
{
  history: {
    id: UUID,
    value: string,
    structured_value: object,
    changed_at: Date,
    change_source: string
  }[]
}
```

### Get Conflicts
```
GET /api/facts/conflicts
Response:
{
  conflicts: {
    fact: Fact,
    conflicting_facts: Fact[],
    contact: Contact
  }[]
}
```

### Resolve Conflict
```
POST /api/facts/:id/resolve
Body:
{
  action: 'keep' | 'replace' | 'merge',
  replace_with_fact_id?: UUID  // if action is 'replace'
}
Response: { fact: Fact }
```

## Implementation

### Facts Service

```typescript
// src/services/facts.ts

const FACT_CATEGORIES = {
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
  custom: 'custom'
};

export async function createFact(input: CreateFactInput) {
  const category = FACT_CATEGORIES[input.fact_type] || 'custom';

  // Validate structured_value based on fact_type
  validateStructuredValue(input.fact_type, input.structured_value);

  // Check for conflicts with existing facts
  const existing = await db.query(`
    SELECT * FROM facts
    WHERE contact_id = $1 AND fact_type = $2 AND deleted_at IS NULL
    ORDER BY confidence DESC NULLS LAST
    LIMIT 1
  `, [input.contact_id, input.fact_type]);

  let hasConflict = false;
  if (existing.rows[0] && existing.rows[0].value !== input.value) {
    hasConflict = true;
    // Mark existing as conflicted too
    await db.query(
      'UPDATE facts SET has_conflict = true WHERE id = $1',
      [existing.rows[0].id]
    );
  }

  const result = await db.query(`
    INSERT INTO facts (
      contact_id, category, fact_type, value, structured_value,
      source, confidence, has_conflict, reminder_enabled, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
    RETURNING *
  `, [
    input.contact_id,
    category,
    input.fact_type,
    input.value,
    input.structured_value,
    input.source || 'manual',
    input.confidence || (input.source === 'manual' ? 1.0 : null),
    hasConflict,
    input.reminder_enabled || false
  ]);

  // If email/phone fact, also create identifier
  if (input.fact_type === 'email' || input.fact_type === 'phone') {
    await createIdentifierFromFact(input.contact_id, input.fact_type, input.value);
  }

  return result.rows[0];
}

export async function updateFact(factId: string, input: UpdateFactInput) {
  // Get current value for history
  const current = await db.query('SELECT * FROM facts WHERE id = $1', [factId]);
  if (!current.rows[0]) throw new NotFoundError('Fact not found');

  // Store history
  await db.query(`
    INSERT INTO fact_history (fact_id, value, structured_value, changed_at, change_source)
    VALUES ($1, $2, $3, NOW(), 'manual_update')
  `, [factId, current.rows[0].value, current.rows[0].structured_value]);

  // Update fact
  const result = await db.query(`
    UPDATE facts SET
      value = COALESCE($2, value),
      structured_value = COALESCE($3, structured_value),
      reminder_enabled = COALESCE($4, reminder_enabled),
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [factId, input.value, input.structured_value, input.reminder_enabled]);

  // Re-check conflicts after update
  await recheckConflicts(result.rows[0].contact_id, result.rows[0].fact_type);

  return result.rows[0];
}

export async function findConflicts() {
  // Find facts where multiple facts of same type exist for same contact
  // with different values and at least one has high confidence
  return db.query(`
    SELECT f1.*, c.display_name as contact_name
    FROM facts f1
    JOIN contacts c ON c.id = f1.contact_id
    WHERE f1.has_conflict = true
      AND f1.deleted_at IS NULL
    ORDER BY f1.updated_at DESC
  `);
}

export async function resolveConflict(factId: string, action: string, replaceWithId?: string) {
  const fact = await db.query('SELECT * FROM facts WHERE id = $1', [factId]);
  if (!fact.rows[0]) throw new NotFoundError('Fact not found');

  if (action === 'keep') {
    // Mark this fact as authoritative, delete others
    await db.query(`
      UPDATE facts SET deleted_at = NOW()
      WHERE contact_id = $1 AND fact_type = $2 AND id != $3 AND deleted_at IS NULL
    `, [fact.rows[0].contact_id, fact.rows[0].fact_type, factId]);

    await db.query('UPDATE facts SET has_conflict = false WHERE id = $1', [factId]);

  } else if (action === 'replace' && replaceWithId) {
    // Keep the replacement, delete this one
    await db.query('UPDATE facts SET deleted_at = NOW() WHERE id = $1', [factId]);
    await db.query('UPDATE facts SET has_conflict = false WHERE id = $1', [replaceWithId]);

  } else if (action === 'merge') {
    // Keep both but mark as non-conflicting (user says both are valid)
    await db.query(`
      UPDATE facts SET has_conflict = false
      WHERE contact_id = $1 AND fact_type = $2 AND deleted_at IS NULL
    `, [fact.rows[0].contact_id, fact.rows[0].fact_type]);
  }

  return db.query('SELECT * FROM facts WHERE id = $1', [factId]);
}
```

### Structured Value Validation

```typescript
// src/services/facts.ts (continued)

const STRUCTURED_SCHEMAS: Record<string, z.ZodSchema> = {
  birthday: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  location: z.object({
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional()
  }),
  spouse: z.object({ name: z.string(), contact_id: z.string().uuid().optional() }),
  child: z.object({ name: z.string(), age: z.number().optional(), contact_id: z.string().uuid().optional() }),
  parent: z.object({ name: z.string(), contact_id: z.string().uuid().optional() }),
  sibling: z.object({ name: z.string(), contact_id: z.string().uuid().optional() }),
  friend: z.object({ name: z.string(), contact_id: z.string().uuid().optional() }),
  colleague: z.object({ name: z.string(), contact_id: z.string().uuid().optional() }),
  mutual_connection: z.object({ name: z.string(), contact_id: z.string().uuid().optional() }),
};

function validateStructuredValue(factType: string, structuredValue: any) {
  const schema = STRUCTURED_SCHEMAS[factType];
  if (schema && structuredValue) {
    schema.parse(structuredValue);
  }
}
```

### Fact Extraction (stub for AI Integration)

```typescript
// src/services/facts.ts (continued)

// Called by AI Integration feature after LLM extraction
export async function createExtractedFact(input: ExtractedFactInput) {
  return createFact({
    ...input,
    source: 'extracted',
    confidence: input.confidence
  });
}

// Batch create from LLM extraction results
export async function batchCreateExtractedFacts(
  communicationId: string,
  facts: ExtractedFactInput[]
) {
  const results = [];
  for (const fact of facts) {
    try {
      const created = await createFact({
        ...fact,
        source: 'extracted',
        source_communication_id: communicationId
      });
      results.push({ success: true, fact: created });
    } catch (error) {
      results.push({ success: false, error: error.message });
    }
  }
  return results;
}
```

## Implementation Steps

1. Create `src/services/facts.ts` with all fact operations
2. Create `src/routes/facts.ts` with API endpoints
3. Add validation schemas for structured values
4. Implement conflict detection on create/update
5. Implement conflict resolution actions
6. Implement history tracking on updates
7. Add identifier creation for email/phone facts
8. Create batch extraction endpoint for AI integration
9. Add reminder flag handling (used by follow-ups later)
10. Add tests for CRUD, conflicts, and history

## Acceptance Criteria

- [ ] `GET /api/facts` returns facts with filters
- [ ] `GET /api/facts/:id` returns fact with history
- [ ] `POST /api/facts` creates fact with proper category assignment
- [ ] `POST /api/facts` validates structured_value for known types
- [ ] `POST /api/facts` detects and flags conflicts
- [ ] `PUT /api/facts/:id` updates fact and creates history entry
- [ ] `DELETE /api/facts/:id` soft deletes fact
- [ ] `GET /api/facts/conflicts` returns conflicting facts
- [ ] `POST /api/facts/:id/resolve` handles keep/replace/merge actions
- [ ] Email/phone facts create contact identifiers
- [ ] Birthday facts can have reminder_enabled flag

## Files to Create

| Path | Purpose |
|------|---------|
| `packages/backend/src/services/facts.ts` | Fact business logic |
| `packages/backend/src/routes/facts.ts` | API endpoints |
| `packages/backend/src/schemas/facts.ts` | Validation schemas |
| `packages/shared/src/types/fact.ts` | TypeScript types |
| `packages/shared/src/constants/fact-types.ts` | Fact type definitions |

## Notes for Implementation

- Confidence is 1.0 for manual facts, variable for extracted
- Conflicts only flagged when values differ (same value = confirmation)
- History only tracks value changes, not metadata changes
- Relationship facts can optionally link to other contacts via contact_id
- The `custom` fact type allows any category and freeform value
- Reminder functionality is implemented in Follow-ups feature
