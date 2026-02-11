# WP-08: Frontend UI Updates

**Phase:** 2
**Depends on:** WP-01 (DB Migration & Shared Types)
**Complexity:** Medium

## Goal

Update the frontend to display the new fact types, show superseded fact history, add processing status indicators on the contact detail page, expand the relationship label display with more common labels, and add a global processing status widget to the dashboard.

## Background

The frontend uses Next.js with shadcn/ui components and React Query for data fetching. The contact detail page displays facts grouped by category in `FactsSection` and relationships grouped by label in `RelationshipsSection`.

The current `FactsSection` groups facts by category (`basic_info`, `custom`). With the new `preference` category (containing `preference`, `tool`, `hobby`, `opinion`, `life_event`, `goal` types), this section needs to handle the expanded set.

The current `RelationshipsSection` has `COMMON_LABELS` with 9 labels. The spec suggests expanding to include: `partner`, `roommate`, `ex`, `client`, `neighbor`, `teacher`, `student`, `doctor`, `therapist`.

The spec also calls for:
- **Contact detail**: Processing status indicator ("Last processed: 5 min ago", "Processing pending (12 new messages)")
- **Contact detail**: Superseded fact history (expandable "previously: worked at Google" under current job)
- **Dashboard**: Global processing status (last cron run time, pending communications count, recent extraction summary)

The frontend follows these conventions (from CLAUDE.md):
- kebab-case for file names
- snake_case for variable and function names
- PascalCase for components

**Existing patterns to follow:**
- `packages/frontend/components/contact-detail/facts-section.tsx` — fact display and CRUD
- `packages/frontend/components/contact-detail/relationships-section.tsx` — relationship display
- `packages/frontend/app/contacts/[id]/page.tsx` — contact detail page layout
- `packages/frontend/app/page.tsx` — dashboard page layout
- `packages/frontend/components/dashboard/stats-cards.tsx` — dashboard widget pattern
- `packages/frontend/lib/hooks/use-facts.ts` — React Query hook pattern

## Scope

**In scope:**
- Modify `packages/frontend/components/contact-detail/facts-section.tsx`:
  - Display new fact types with appropriate labels
  - Group by the 3 categories: `basic_info`, `preference`, `custom`
  - Show human-readable category names: "Basic Info", "Preferences & Interests", "Custom"
  - Show human-readable fact type labels (e.g., `life_event` → "Life Event", `job_title` → "Job Title")
- Add superseded fact history display:
  - For facts that have history entries, show expandable "previously: ..." text
  - This requires the fact history data to be available — either fetch via existing `GET /api/facts/:id/history` on demand, or include history in the facts list response
- Modify `packages/frontend/components/contact-detail/relationships-section.tsx`:
  - Expand `COMMON_LABELS` array with new suggested labels
  - Update `LABEL_DISPLAY` mapping for new labels
- Add processing status indicator to contact detail page:
  - Show "Last processed: X ago" or "Processing pending (N new messages)"
  - This requires a new API query or additional data in the contact response
  - Could use a simple query: count communications where `contact_id = X AND frf_processed_at IS NULL`
- Add processing status widget to dashboard:
  - Last cron run time
  - Total pending (unprocessed) communications count
  - This requires a new API endpoint or dashboard stats update

**Out of scope (handled by other WPs):**
- Backend API changes for processing status data — implement inline as needed, or add to existing endpoints
- Fact type/category type definitions — WP-01
- Backend extraction logic — WP-03

## Key Files

**Modify:**
- `packages/frontend/components/contact-detail/facts-section.tsx` — new fact types, category display, superseded history
- `packages/frontend/components/contact-detail/relationships-section.tsx` — expanded common labels
- `packages/frontend/app/contacts/[id]/page.tsx` — processing status indicator
- `packages/frontend/app/page.tsx` or `packages/frontend/components/dashboard/stats-cards.tsx` — processing status widget

**Create:**
- `packages/frontend/components/contact-detail/processing-status.tsx` — processing status indicator component (optional — could be inline)

**Reference (read, don't modify):**
- `packages/frontend/lib/hooks/use-facts.ts` — React Query hook patterns
- `packages/frontend/lib/api.ts` — API client patterns (if exists)
- `packages/frontend/components/ui/` — shadcn/ui component library

## Technical Details

### Fact Type Display Labels

```typescript
const FACT_TYPE_LABELS: Record<string, string> = {
  birthday: 'Birthday',
  location: 'Location',
  job_title: 'Job Title',
  company: 'Company',
  email: 'Email',
  phone: 'Phone',
  preference: 'Preference',
  tool: 'Tool',
  hobby: 'Hobby',
  opinion: 'Opinion',
  life_event: 'Life Event',
  goal: 'Goal',
  custom: 'Custom',
};
```

### Category Display Labels

```typescript
const CATEGORY_LABELS: Record<string, string> = {
  basic_info: 'Basic Info',
  preference: 'Preferences & Interests',
  custom: 'Custom',
};
```

### Expanded Relationship Labels

```typescript
const COMMON_LABELS = [
  'spouse', 'partner', 'child', 'parent', 'sibling',
  'friend', 'colleague', 'boss', 'mentor', 'roommate',
  'ex', 'client', 'neighbor', 'teacher', 'student',
  'doctor', 'therapist', 'how_we_met',
];

const LABEL_DISPLAY: Record<string, string> = {
  spouse: 'Spouse',
  partner: 'Partner',
  child: 'Children',
  parent: 'Parents',
  sibling: 'Siblings',
  friend: 'Friends',
  colleague: 'Colleagues',
  boss: 'Boss',
  mentor: 'Mentors',
  roommate: 'Roommates',
  ex: 'Ex',
  client: 'Clients',
  neighbor: 'Neighbors',
  teacher: 'Teachers',
  student: 'Students',
  doctor: 'Doctors',
  therapist: 'Therapists',
  how_we_met: 'How We Met',
};
```

### Superseded Fact History UI

For facts of singular types (birthday, location, job_title, company), if history exists, show a collapsible section:

```tsx
{fact.history && fact.history.length > 0 && (
  <div className="text-xs text-muted-foreground ml-4">
    previously: {fact.history[0].value}
  </div>
)}
```

This is a simple inline display. The history data needs to come from somewhere — options:
1. Eager: Include history in the facts list API response (modify backend `GET /api/facts` to join fact_history)
2. Lazy: Fetch on expand via `GET /api/facts/:id/history` (existing endpoint)

Option 2 (lazy) is simpler and avoids backend changes. Use a small expand/collapse toggle.

### Processing Status Indicator

On the contact detail page, show a small muted text below the contact header:

```tsx
<p className="text-xs text-muted-foreground">
  {pending_count > 0
    ? `Processing pending (${pending_count} new messages)`
    : `Last processed: ${format_relative(last_processed)}`
  }
</p>
```

Data source: Add a query to fetch processing status for a contact:
```sql
SELECT
  COUNT(*) FILTER (WHERE frf_processed_at IS NULL) AS pending_count,
  MAX(frf_processed_at) AS last_processed
FROM communications
WHERE contact_id = $1
```

This could be a new lightweight API endpoint (`GET /api/contacts/:id/processing-status`) or added to the existing contact detail response. Adding a backend route is in scope for this WP since it's a simple query.

### Dashboard Processing Widget

Add to the dashboard stats or as a separate small card:
- "Pending messages: N"
- "Last extraction: X ago"

Data source:
```sql
SELECT
  COUNT(*) FILTER (WHERE frf_processed_at IS NULL) AS pending_count,
  MAX(frf_processed_at) AS last_processed
FROM communications
WHERE contact_id IS NOT NULL
```

## Acceptance Criteria

- [ ] All 13 fact types display with human-readable labels
- [ ] Facts grouped by 3 categories with readable headers
- [ ] Superseded fact history visible (expandable) for singular-type facts
- [ ] Relationship common labels expanded with new suggestions
- [ ] New label display mappings work for all labels
- [ ] Processing status shown on contact detail page (pending count or last processed time)
- [ ] Dashboard shows global processing status (pending count, last run)
- [ ] UI follows existing design patterns (shadcn/ui, Tailwind classes)
- [ ] No regressions in existing frontend functionality

## Verification Commands

```bash
# Type check
cd packages/frontend && npx tsc --noEmit

# Build
cd packages/frontend && npx next build

# Lint
cd packages/frontend && npx eslint components/ app/
```
