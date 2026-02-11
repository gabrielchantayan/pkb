import { get_pool, query } from '../db/index.js';
import type { Followup, Contact } from '@pkb/shared';
import type {
  ListFollowupsQuery,
  CreateFollowupInput,
  UpdateFollowupInput,
  AcceptSuggestionInput,
} from '../schemas/followups.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface FollowupWithContact extends Followup {
  contact_name: string | null;
  contact_photo: string | null;
}

export interface ListFollowupsResponse {
  followups: FollowupWithContact[];
  nextCursor: string | null;
}

export interface PendingFollowupsResponse {
  overdue: FollowupWithContact[];
  today: FollowupWithContact[];
  upcoming: FollowupWithContact[];
}

export interface FollowupSuggestion {
  contact: {
    id: string;
    displayName: string | null;
    photoUrl: string | null;
  };
  reason: string;
  suggested_date: string;
  source: 'no_contact_threshold' | 'content_detected';
  source_communication_id?: string;
}

function add_days(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function format_date(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function is_within_followup_cutoff(timestamp: Date, cutoff_days: number): boolean {
  const cutoff_date = new Date();
  cutoff_date.setDate(cutoff_date.getDate() - cutoff_days);
  return timestamp >= cutoff_date;
}

export async function list_followups(params: ListFollowupsQuery): Promise<ListFollowupsResponse> {
  const values: unknown[] = [];
  let param_index = 1;

  const conditions: string[] = ['c.deleted_at IS NULL'];

  if (params.contact_id) {
    values.push(params.contact_id);
    conditions.push(`f.contact_id = $${param_index++}`);
  }

  if (params.completed !== undefined) {
    values.push(params.completed);
    conditions.push(`f.completed = $${param_index++}`);
  }

  if (params.type) {
    values.push(params.type);
    conditions.push(`f.type = $${param_index++}`);
  }

  if (params.due_before) {
    values.push(params.due_before);
    conditions.push(`f.due_date <= $${param_index++}`);
  }

  if (params.due_after) {
    values.push(params.due_after);
    conditions.push(`f.due_date >= $${param_index++}`);
  }

  if (params.cursor) {
    values.push(params.cursor);
    conditions.push(`(f.due_date, f.created_at, f.id) > (
      SELECT due_date, created_at, id FROM followups WHERE id = $${param_index++}
    )`);
  }

  values.push(params.limit + 1);

  const sql = `
    SELECT f.*, c.display_name as contact_name, c.photo_url as contact_photo
    FROM followups f
    JOIN contacts c ON c.id = f.contact_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY f.due_date ASC, f.created_at ASC, f.id ASC
    LIMIT $${param_index}
  `;

  const result = await query<FollowupWithContact>(sql, values);
  const limit = params.limit;
  const has_more = result.rows.length > limit;
  const followups = has_more ? result.rows.slice(0, -1) : result.rows;
  const last = followups[followups.length - 1];
  const next_cursor = has_more && last ? last.id : null;

  return { followups, nextCursor: next_cursor };
}

export async function get_pending_followups(limit: number = 10): Promise<PendingFollowupsResponse> {
  const today = new Date().toISOString().split('T')[0];
  const upcoming_end = add_days(today, 7);

  const [overdue_result, today_result, upcoming_result] = await Promise.all([
    query<FollowupWithContact>(
      `SELECT f.*, c.display_name as contact_name, c.photo_url as contact_photo
       FROM followups f
       JOIN contacts c ON c.id = f.contact_id
       WHERE f.completed = false AND f.due_date < $1 AND c.deleted_at IS NULL
       ORDER BY f.due_date ASC
       LIMIT $2`,
      [today, limit]
    ),

    query<FollowupWithContact>(
      `SELECT f.*, c.display_name as contact_name, c.photo_url as contact_photo
       FROM followups f
       JOIN contacts c ON c.id = f.contact_id
       WHERE f.completed = false AND f.due_date = $1 AND c.deleted_at IS NULL
       ORDER BY f.created_at ASC
       LIMIT $2`,
      [today, limit]
    ),

    query<FollowupWithContact>(
      `SELECT f.*, c.display_name as contact_name, c.photo_url as contact_photo
       FROM followups f
       JOIN contacts c ON c.id = f.contact_id
       WHERE f.completed = false AND f.due_date > $1 AND f.due_date <= $2 AND c.deleted_at IS NULL
       ORDER BY f.due_date ASC
       LIMIT $3`,
      [today, upcoming_end, limit]
    ),
  ]);

  return {
    overdue: overdue_result.rows,
    today: today_result.rows,
    upcoming: upcoming_result.rows,
  };
}

export async function get_followup(id: string): Promise<FollowupWithContact | null> {
  const result = await query<FollowupWithContact>(
    `SELECT f.*, c.display_name as contact_name, c.photo_url as contact_photo
     FROM followups f
     JOIN contacts c ON c.id = f.contact_id
     WHERE f.id = $1 AND c.deleted_at IS NULL`,
    [id]
  );

  return result.rows[0] || null;
}

export async function create_followup(input: CreateFollowupInput): Promise<Followup> {
  const result = await query<Followup>(
    `INSERT INTO followups (contact_id, type, reason, due_date, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [input.contact_id, input.type, input.reason, input.due_date]
  );

  return result.rows[0];
}

export async function update_followup(id: string, input: UpdateFollowupInput): Promise<Followup> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let param_index = 1;

  if (input.reason !== undefined) {
    values.push(input.reason);
    updates.push(`reason = $${param_index++}`);
  }

  if (input.due_date !== undefined) {
    values.push(input.due_date);
    updates.push(`due_date = $${param_index++}`);
  }

  if (updates.length === 0) {
    const existing = await get_followup(id);
    if (!existing) {
      throw new NotFoundError('Followup not found');
    }
    return existing;
  }

  values.push(id);
  const result = await query<Followup>(
    `UPDATE followups SET ${updates.join(', ')} WHERE id = $${param_index} RETURNING *`,
    values
  );

  if (!result.rows[0]) {
    throw new NotFoundError('Followup not found');
  }

  return result.rows[0];
}

export async function complete_followup(id: string): Promise<Followup> {
  const result = await query<Followup>(
    `UPDATE followups
     SET completed = true, completed_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );

  if (!result.rows[0]) {
    throw new NotFoundError('Followup not found');
  }

  return result.rows[0];
}

export async function delete_followup(id: string): Promise<boolean> {
  const result = await query<Followup>('DELETE FROM followups WHERE id = $1 RETURNING id', [id]);

  return result.rows.length > 0;
}

export async function generate_time_suggestions(): Promise<FollowupSuggestion[]> {
  // Find contacts with no recent communication who have follow-up thresholds
  // from tags or groups
  const result = await query<{
    id: string;
    display_name: string | null;
    photo_url: string | null;
    threshold: number;
    last_communication: Date | null;
    suggested_date: string;
  }>(`
    WITH contact_thresholds AS (
      -- Get minimum threshold from tags
      SELECT ct.contact_id, MIN(t.followup_days) as threshold
      FROM contact_tags ct
      JOIN tags t ON t.id = ct.tag_id
      WHERE t.followup_days IS NOT NULL
      GROUP BY ct.contact_id

      UNION ALL

      -- Get minimum threshold from groups
      SELECT cg.contact_id, MIN(g.followup_days) as threshold
      FROM contact_groups cg
      JOIN groups g ON g.id = cg.group_id
      WHERE g.followup_days IS NOT NULL
      GROUP BY cg.contact_id
    ),
    min_thresholds AS (
      -- Get overall minimum threshold per contact
      SELECT contact_id, MIN(threshold) as threshold
      FROM contact_thresholds
      GROUP BY contact_id
    ),
    last_contact AS (
      SELECT contact_id, MAX(timestamp) as last_communication
      FROM communications
      GROUP BY contact_id
    )
    SELECT
      c.id,
      c.display_name,
      c.photo_url,
      mt.threshold,
      lc.last_communication,
      CURRENT_DATE::text as suggested_date
    FROM contacts c
    JOIN min_thresholds mt ON mt.contact_id = c.id
    LEFT JOIN last_contact lc ON lc.contact_id = c.id
    WHERE c.deleted_at IS NULL
      AND (
        lc.last_communication IS NULL
        OR lc.last_communication < CURRENT_DATE - (mt.threshold || ' days')::interval
      )
      -- Exclude if there's already a pending followup
      AND NOT EXISTS (
        SELECT 1 FROM followups f
        WHERE f.contact_id = c.id AND f.completed = false
      )
    ORDER BY mt.threshold ASC, lc.last_communication ASC NULLS FIRST
    LIMIT 20
  `);

  return result.rows.map((row) => ({
    contact: {
      id: row.id,
      displayName: row.display_name,
      photoUrl: row.photo_url,
    },
    reason: row.last_communication
      ? `No contact in ${row.threshold} days (last: ${format_date(row.last_communication)})`
      : `No recorded communication yet`,
    suggested_date: row.suggested_date,
    source: 'no_contact_threshold' as const,
  }));
}

export async function accept_suggestion(input: AcceptSuggestionInput): Promise<Followup> {
  const result = await query<Followup>(
    `INSERT INTO followups (contact_id, type, reason, due_date, source_communication_id, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [input.contact_id, input.type, input.reason, input.due_date, input.source_communication_id || null]
  );

  return result.rows[0];
}

// Called by AI Integration after LLM detects action items
export async function create_content_detected_followup(
  contact_id: string,
  communication_id: string,
  reason: string,
  suggested_date: string,
  communication_timestamp?: Date
): Promise<Followup | null> {
  // Check followup cutoff if timestamp is provided
  if (communication_timestamp) {
    if (!is_within_followup_cutoff(communication_timestamp, config.frf_followup_cutoff_days)) {
      logger.debug('Skipping followup creation: communication too old', {
        communication_id,
        communication_timestamp: communication_timestamp.toISOString(),
        cutoff_days: config.frf_followup_cutoff_days,
      });
      return null;
    }
  }

  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check for existing pending followup with same reason
    const existing = await client.query(
      `SELECT id FROM followups
       WHERE contact_id = $1 AND reason = $2 AND completed = false`,
      [contact_id, reason]
    );

    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      return null; // Don't create duplicate
    }

    const result = await client.query<Followup>(
      `INSERT INTO followups (contact_id, type, reason, due_date, source_communication_id, created_at)
       VALUES ($1, 'content_detected', $2, $3, $4, NOW())
       RETURNING *`,
      [contact_id, reason, suggested_date, communication_id]
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// For birthday reminders - run daily via cron/scheduler
export async function generate_birthday_reminders(): Promise<number> {
  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Find birthday facts with reminder_enabled, upcoming in next 7 days
    const upcoming = await client.query<{
      contact_id: string;
      display_name: string | null;
      birthday_date: string;
    }>(`
      SELECT
        f.contact_id,
        c.display_name,
        f.structured_value->>'date' as birthday_date
      FROM facts f
      JOIN contacts c ON c.id = f.contact_id
      WHERE f.fact_type = 'birthday'
        AND f.reminder_enabled = true
        AND f.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND f.structured_value->>'date' IS NOT NULL
        -- No existing birthday followup this year
        AND NOT EXISTS (
          SELECT 1 FROM followups fu
          WHERE fu.contact_id = c.id
            AND fu.reason LIKE '%birthday%'
            AND fu.due_date >= DATE_TRUNC('year', CURRENT_DATE)::date
        )
    `);

    let created_count = 0;

    for (const row of upcoming.rows) {
      if (!row.birthday_date) continue;

      // Parse birthday and create this year's date
      const [, month, day] = row.birthday_date.split('-').map(Number);
      const this_year = new Date().getFullYear();
      const birthday_this_year = new Date(this_year, month - 1, day);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // If birthday already passed this year, skip
      if (birthday_this_year < today) continue;

      // If birthday is more than 7 days away, skip
      const days_until = Math.ceil((birthday_this_year.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (days_until > 7) continue;

      // Create birthday followup
      const due_date = birthday_this_year.toISOString().split('T')[0];
      const reason = row.display_name
        ? `${row.display_name}'s birthday`
        : 'Birthday reminder';

      await client.query(
        `INSERT INTO followups (contact_id, type, reason, due_date, created_at)
         VALUES ($1, 'time_based', $2, $3, NOW())`,
        [row.contact_id, reason, due_date]
      );

      created_count++;
    }

    await client.query('COMMIT');
    return created_count;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
