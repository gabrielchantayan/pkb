import { query } from '../../db/index.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BatchCommunication {
  id: string;
  content: string;
  source: string;
  direction: string;
  subject: string | null;
  timestamp: Date;
  contact_id: string;
  contact_name: string;
}

export interface ContactBatch {
  contact_id: string;
  contact_name: string;
  context_messages: BatchCommunication[];
  batch_messages: BatchCommunication[];
  communication_ids: string[];
}

export interface UnprocessedContact {
  contact_id: string;
  contact_name: string;
  unprocessed_count: number;
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function get_unprocessed_contacts(): Promise<UnprocessedContact[]> {
  const result = await query<{
    contact_id: string;
    contact_name: string;
    unprocessed_count: string;
  }>(
    `SELECT cm.contact_id, c.display_name AS contact_name, COUNT(*) AS unprocessed_count
     FROM communications cm
     JOIN contacts c ON c.id = cm.contact_id
     WHERE cm.frf_processed_at IS NULL
       AND c.deleted_at IS NULL
       AND cm.contact_id IS NOT NULL
       AND LENGTH(cm.content) >= 20
     GROUP BY cm.contact_id, c.display_name
     ORDER BY unprocessed_count DESC`
  );

  return result.rows.map((row) => ({
    contact_id: row.contact_id,
    contact_name: row.contact_name,
    unprocessed_count: Number(row.unprocessed_count),
  }));
}

async function fetch_context_messages(
  contact_id: string,
  context_count: number
): Promise<BatchCommunication[]> {
  const result = await query<BatchCommunication>(
    `SELECT cm.id, cm.content, cm.source, cm.direction, cm.subject, cm.timestamp,
            cm.contact_id, c.display_name AS contact_name
     FROM communications cm
     JOIN contacts c ON c.id = cm.contact_id
     WHERE cm.contact_id = $1
       AND cm.frf_processed_at IS NOT NULL
       AND LENGTH(cm.content) >= 20
     ORDER BY cm.timestamp DESC
     LIMIT $2`,
    [contact_id, context_count]
  );

  return result.rows.reverse();
}

async function fetch_unprocessed_messages(
  contact_id: string
): Promise<BatchCommunication[]> {
  const result = await query<BatchCommunication>(
    `SELECT cm.id, cm.content, cm.source, cm.direction, cm.subject, cm.timestamp,
            cm.contact_id, c.display_name AS contact_name
     FROM communications cm
     JOIN contacts c ON c.id = cm.contact_id
     WHERE cm.contact_id = $1
       AND cm.frf_processed_at IS NULL
       AND LENGTH(cm.content) >= 20
     ORDER BY cm.timestamp ASC`,
    [contact_id]
  );

  return result.rows;
}

// ── Batching ───────────────────────────────────────────────────────────────

export function split_into_batches(
  messages: BatchCommunication[],
  batch_size: number,
  overlap: number
): ContactBatch[] {
  if (messages.length === 0) return [];

  const contact_id = messages[0].contact_id;
  const contact_name = messages[0].contact_name;
  const batches: ContactBatch[] = [];

  let start = 0;
  while (start < messages.length) {
    const overlap_count = batches.length === 0 ? 0 : overlap;
    const overlap_start = Math.max(0, start - overlap_count);
    const end = Math.min(start + batch_size, messages.length);

    const batch_messages = messages.slice(overlap_start, end);
    // Only IDs for the non-overlapped portion belong to this batch
    const communication_ids = messages.slice(start, end).map((m) => m.id);

    batches.push({
      contact_id,
      contact_name,
      context_messages: [],
      batch_messages,
      communication_ids,
    });

    start = end;
  }

  return batches;
}

export async function get_contact_batches(
  contact_id: string,
  batch_size = 15,
  overlap = 3,
  context_count = 10
): Promise<ContactBatch[]> {
  const [context_messages, unprocessed] = await Promise.all([
    fetch_context_messages(contact_id, context_count),
    fetch_unprocessed_messages(contact_id),
  ]);

  const batches = split_into_batches(unprocessed, batch_size, overlap);

  for (const batch of batches) {
    batch.context_messages = context_messages;
  }

  return batches;
}

// ── Prompt formatting ──────────────────────────────────────────────────────

function format_timestamp(timestamp: Date): string {
  const d = new Date(timestamp);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function format_direction(direction: string): string {
  return direction === 'inbound' ? 'RECEIVED' : 'SENT';
}

export function format_message(msg: BatchCommunication): string {
  const ts = format_timestamp(msg.timestamp);
  const source = msg.source.toUpperCase();
  const dir = format_direction(msg.direction);
  const prefix = `[${ts} | ${source} | ${dir}]`;

  if (msg.subject) {
    return `${prefix} Subject: ${msg.subject}\n${msg.content}`;
  }

  return `${prefix} ${msg.content}`;
}

export function format_batch_prompt(
  context_messages: BatchCommunication[],
  batch_messages: BatchCommunication[],
  _contact_name: string
): string {
  const sections: string[] = [];

  if (context_messages.length > 0) {
    sections.push('=== CONTEXT ONLY - Do not extract facts from these messages ===');
    sections.push('');
    for (const msg of context_messages) {
      sections.push(format_message(msg));
    }
    sections.push('');
  }

  sections.push('=== NEW MESSAGES - Extract facts from these messages ===');
  sections.push('');
  for (const msg of batch_messages) {
    sections.push(format_message(msg));
  }

  return sections.join('\n');
}
