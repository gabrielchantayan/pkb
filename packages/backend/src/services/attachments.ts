import type pg from 'pg';
import { query } from '../db/index.js';
import type { CommunicationAttachment } from '@pkb/shared';
import { save_file, get_file_path, get_storage_path } from './storage.js';

export interface AttachmentInput {
  filename: string;
  mime_type: string;
  size_bytes: number;
  data: string; // base64 encoded
}

export async function save_attachment_from_base64(
  client: pg.PoolClient,
  communication_id: string,
  attachment: AttachmentInput
): Promise<CommunicationAttachment> {
  // Decode base64
  const buffer = Buffer.from(attachment.data, 'base64');

  // Save file to storage
  const relative_path = await save_file(buffer, attachment.filename);

  // Store reference in DB
  const result = await client.query<CommunicationAttachment>(
    `INSERT INTO communication_attachments
     (communication_id, filename, mime_type, storage_path, size_bytes, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [communication_id, attachment.filename, attachment.mime_type, relative_path, attachment.size_bytes]
  );

  return result.rows[0];
}

export async function save_attachment_from_buffer(
  communication_id: string,
  filename: string,
  mime_type: string,
  buffer: Buffer
): Promise<CommunicationAttachment> {
  // Save file to storage
  const relative_path = await save_file(buffer, filename);

  // Store reference in DB
  const result = await query<CommunicationAttachment>(
    `INSERT INTO communication_attachments
     (communication_id, filename, mime_type, storage_path, size_bytes, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [communication_id, filename, mime_type, relative_path, buffer.length]
  );

  return result.rows[0];
}

export async function get_attachment(attachment_id: string): Promise<CommunicationAttachment | null> {
  const result = await query<CommunicationAttachment>(
    'SELECT * FROM communication_attachments WHERE id = $1',
    [attachment_id]
  );
  return result.rows[0] ?? null;
}

export function get_attachment_full_path(storage_path: string): string {
  return get_file_path(storage_path);
}

export { get_storage_path };
