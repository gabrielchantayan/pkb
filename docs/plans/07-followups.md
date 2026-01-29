# Feature: Follow-ups

## Overview

Manage follow-up reminders for contacts - both manual reminders and AI-suggested follow-ups based on communication content and contact rules. Integrates with tags/groups for default follow-up thresholds.

## Dependencies

- **Requires**: 01-project-foundation, 02-authentication, 03-contacts-core, 04-communications
- **Soft dependency**: 08-tags-organization (for tag-based rules), 10-ai-integration (for suggestions)

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Follow-up types | manual, time_based, content_detected | Cover all use cases |
| Due date | DATE (not timestamp) | Day-level precision is enough |
| Suggestions | Async generation | Don't block normal operations |
| Rules | Per-tag and per-group | Flexible configuration |

## Follow-up Types

- **manual**: User-created reminders with custom due date and reason
- **time_based**: Auto-generated when no contact within threshold (based on tag/group rules)
- **content_detected**: LLM-detected action items from communications ("I'll send you that report")

## Database Tables

Table from 01-project-foundation:
- `followups` - Follow-up reminders

Additional: follow-up rules stored on `tags` and `groups` tables (`followup_days` column).

## API Endpoints

### List Follow-ups
```
GET /api/followups
Query params:
  - contact_id: UUID
  - completed: boolean (default false)
  - type: 'manual' | 'time_based' | 'content_detected'
  - due_before: ISO date
  - due_after: ISO date
  - cursor: string
  - limit: number

Response:
{
  followups: Followup[],
  nextCursor: string | null
}
```

### Get Pending Follow-ups (Dashboard)
```
GET /api/followups/pending
Query params:
  - limit: number (default 10)

Response:
{
  overdue: Followup[],      // due_date < today
  today: Followup[],        // due_date = today
  upcoming: Followup[]      // due_date within 7 days
}
```

### Create Follow-up
```
POST /api/followups
Body:
{
  contact_id: UUID,
  type: 'manual',
  reason: string,
  due_date: 'YYYY-MM-DD'
}
Response: { followup: Followup }
```

### Update Follow-up
```
PUT /api/followups/:id
Body:
{
  reason?: string,
  due_date?: 'YYYY-MM-DD'
}
Response: { followup: Followup }
```

### Complete Follow-up
```
POST /api/followups/:id/complete
Body: {}  // or { note?: string } to add completion note
Response: { followup: Followup }
```

### Delete Follow-up
```
DELETE /api/followups/:id
Response: { success: true }
```

### Get AI Suggestions
```
GET /api/followups/suggestions
Response:
{
  suggestions: {
    contact: Contact,
    reason: string,
    suggested_date: 'YYYY-MM-DD',
    source: 'no_contact_threshold' | 'content_detected',
    source_communication_id?: UUID
  }[]
}
```

### Accept Suggestion
```
POST /api/followups/suggestions/accept
Body:
{
  contact_id: UUID,
  reason: string,
  due_date: 'YYYY-MM-DD',
  type: 'time_based' | 'content_detected',
  source_communication_id?: UUID
}
Response: { followup: Followup }
```

## Implementation

### Follow-up Service

```typescript
// src/services/followups.ts

export async function listFollowups(params: ListFollowupsParams) {
  let query = `
    SELECT f.*, c.display_name as contact_name, c.photo_url as contact_photo
    FROM followups f
    JOIN contacts c ON c.id = f.contact_id
    WHERE c.deleted_at IS NULL
  `;

  const conditions: string[] = [];
  const values: any[] = [];

  if (params.contact_id) {
    values.push(params.contact_id);
    conditions.push(`f.contact_id = $${values.length}`);
  }

  if (params.completed !== undefined) {
    values.push(params.completed);
    conditions.push(`f.completed = $${values.length}`);
  }

  if (params.type) {
    values.push(params.type);
    conditions.push(`f.type = $${values.length}`);
  }

  if (params.due_before) {
    values.push(params.due_before);
    conditions.push(`f.due_date <= $${values.length}`);
  }

  if (params.due_after) {
    values.push(params.due_after);
    conditions.push(`f.due_date >= $${values.length}`);
  }

  if (conditions.length) {
    query += ' AND ' + conditions.join(' AND ');
  }

  query += ' ORDER BY f.due_date ASC, f.created_at ASC';

  if (params.limit) {
    values.push(params.limit);
    query += ` LIMIT $${values.length}`;
  }

  return db.query(query, values);
}

export async function getPendingFollowups() {
  const today = new Date().toISOString().split('T')[0];

  const [overdue, todayItems, upcoming] = await Promise.all([
    db.query(`
      SELECT f.*, c.display_name as contact_name, c.photo_url
      FROM followups f
      JOIN contacts c ON c.id = f.contact_id
      WHERE f.completed = false AND f.due_date < $1 AND c.deleted_at IS NULL
      ORDER BY f.due_date ASC
      LIMIT 20
    `, [today]),

    db.query(`
      SELECT f.*, c.display_name as contact_name, c.photo_url
      FROM followups f
      JOIN contacts c ON c.id = f.contact_id
      WHERE f.completed = false AND f.due_date = $1 AND c.deleted_at IS NULL
      ORDER BY f.created_at ASC
    `, [today]),

    db.query(`
      SELECT f.*, c.display_name as contact_name, c.photo_url
      FROM followups f
      JOIN contacts c ON c.id = f.contact_id
      WHERE f.completed = false AND f.due_date > $1 AND f.due_date <= $2 AND c.deleted_at IS NULL
      ORDER BY f.due_date ASC
      LIMIT 20
    `, [today, addDays(today, 7)])
  ]);

  return {
    overdue: overdue.rows,
    today: todayItems.rows,
    upcoming: upcoming.rows
  };
}

export async function createFollowup(input: CreateFollowupInput) {
  const result = await db.query(`
    INSERT INTO followups (contact_id, type, reason, due_date, source_communication_id, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING *
  `, [input.contact_id, input.type, input.reason, input.due_date, input.source_communication_id]);

  return result.rows[0];
}

export async function completeFollowup(followupId: string) {
  const result = await db.query(`
    UPDATE followups
    SET completed = true, completed_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [followupId]);

  if (!result.rows[0]) throw new NotFoundError('Follow-up not found');
  return result.rows[0];
}
```

### Time-Based Suggestions

```typescript
// src/services/followups.ts (continued)

export async function generateTimeSuggestions() {
  // Find contacts with no recent communication who have follow-up thresholds
  const suggestions = await db.query(`
    WITH contact_thresholds AS (
      -- Get minimum threshold from tags
      SELECT ct.contact_id, MIN(t.followup_days) as threshold
      FROM contact_tags ct
      JOIN tags t ON t.id = ct.tag_id
      WHERE t.followup_days IS NOT NULL
      GROUP BY ct.contact_id

      UNION

      -- Get minimum threshold from groups
      SELECT cg.contact_id, MIN(g.followup_days) as threshold
      FROM contact_groups cg
      JOIN groups g ON g.id = cg.group_id
      WHERE g.followup_days IS NOT NULL
      GROUP BY cg.contact_id
    ),
    last_contact AS (
      SELECT contact_id, MAX(timestamp) as last_communication
      FROM communications
      GROUP BY contact_id
    )
    SELECT
      c.*,
      ct.threshold,
      lc.last_communication,
      CURRENT_DATE + ct.threshold as suggested_date
    FROM contacts c
    JOIN contact_thresholds ct ON ct.contact_id = c.id
    LEFT JOIN last_contact lc ON lc.contact_id = c.id
    WHERE c.deleted_at IS NULL
      AND (
        lc.last_communication IS NULL
        OR lc.last_communication < CURRENT_DATE - (ct.threshold || ' days')::interval
      )
      -- Exclude if there's already a pending followup
      AND NOT EXISTS (
        SELECT 1 FROM followups f
        WHERE f.contact_id = c.id AND f.completed = false
      )
    ORDER BY ct.threshold ASC, lc.last_communication ASC NULLS FIRST
    LIMIT 20
  `);

  return suggestions.rows.map(row => ({
    contact: {
      id: row.id,
      displayName: row.display_name,
      photoUrl: row.photo_url
    },
    reason: row.last_communication
      ? `No contact in ${row.threshold} days (last: ${formatDate(row.last_communication)})`
      : `No recorded communication yet`,
    suggested_date: row.suggested_date,
    source: 'no_contact_threshold' as const
  }));
}
```

### Content-Detected Suggestions (stub for AI Integration)

```typescript
// src/services/followups.ts (continued)

// Called by AI Integration after LLM detects action items
export async function createContentDetectedFollowup(
  contactId: string,
  communicationId: string,
  reason: string,
  suggestedDate: string
) {
  // Check for existing pending followup with same reason
  const existing = await db.query(`
    SELECT id FROM followups
    WHERE contact_id = $1 AND reason = $2 AND completed = false
  `, [contactId, reason]);

  if (existing.rows[0]) {
    return null; // Don't create duplicate
  }

  return createFollowup({
    contact_id: contactId,
    type: 'content_detected',
    reason,
    due_date: suggestedDate,
    source_communication_id: communicationId
  });
}
```

### Birthday Reminders

```typescript
// src/services/followups.ts (continued)

// Run daily via cron/scheduler
export async function generateBirthdayReminders() {
  // Find birthday facts with reminder_enabled, upcoming in next 7 days
  const upcoming = await db.query(`
    SELECT f.*, c.id as contact_id, c.display_name
    FROM facts f
    JOIN contacts c ON c.id = f.contact_id
    WHERE f.fact_type = 'birthday'
      AND f.reminder_enabled = true
      AND f.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (
        -- Check if birthday is in next 7 days (handles year rollover)
        TO_CHAR(
          MAKE_DATE(
            EXTRACT(YEAR FROM CURRENT_DATE)::int,
            (f.structured_value->>'date')::date.month,
            (f.structured_value->>'date')::date.day
          ),
          'YYYY-MM-DD'
        )::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
      )
      -- No existing birthday followup this year
      AND NOT EXISTS (
        SELECT 1 FROM followups fu
        WHERE fu.contact_id = c.id
          AND fu.reason LIKE '%birthday%'
          AND fu.due_date >= DATE_TRUNC('year', CURRENT_DATE)
      )
  `);

  for (const row of upcoming.rows) {
    await createFollowup({
      contact_id: row.contact_id,
      type: 'time_based',
      reason: `${row.display_name}'s birthday`,
      due_date: extractBirthdayThisYear(row.structured_value.date)
    });
  }
}
```

## Implementation Steps

1. Create `src/services/followups.ts` with all operations
2. Create `src/routes/followups.ts` with API endpoints
3. Implement pending followups query with overdue/today/upcoming
4. Implement time-based suggestion generation
5. Add stub for content-detected suggestions (completed in AI Integration)
6. Implement birthday reminder generation
7. Add scheduler for daily birthday check
8. Add validation schemas
9. Test CRUD operations
10. Test suggestion generation with mock tag thresholds

## Acceptance Criteria

- [ ] `GET /api/followups` returns filtered followups
- [ ] `GET /api/followups/pending` returns overdue, today, upcoming buckets
- [ ] `POST /api/followups` creates manual followup
- [ ] `PUT /api/followups/:id` updates followup
- [ ] `POST /api/followups/:id/complete` marks as completed
- [ ] `DELETE /api/followups/:id` removes followup
- [ ] `GET /api/followups/suggestions` returns time-based suggestions
- [ ] Suggestions respect tag/group followup_days thresholds
- [ ] Suggestions exclude contacts with pending followups
- [ ] Birthday reminders generated for enabled birthday facts
- [ ] Completing a followup records completed_at timestamp

## Files to Create

| Path | Purpose |
|------|---------|
| `packages/backend/src/services/followups.ts` | Follow-up business logic |
| `packages/backend/src/routes/followups.ts` | API endpoints |
| `packages/backend/src/schemas/followups.ts` | Validation schemas |
| `packages/backend/src/jobs/birthday-reminders.ts` | Daily birthday check |
| `packages/shared/src/types/followup.ts` | TypeScript types |

## Notes for Implementation

- Suggestions are generated on-demand, not stored until accepted
- Birthday SQL is complex due to year handling - may need refinement
- Consider using node-cron or similar for birthday reminder job
- Content-detected followups will come from AI Integration feature
- The dashboard endpoint (`/pending`) is optimized for quick loading
- Threshold is the minimum from all tags/groups (most aggressive)
