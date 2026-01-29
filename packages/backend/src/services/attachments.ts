import { createHash } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import type pg from 'pg';
import { query } from '../db/index.js';
import type { CommunicationAttachment } from '@pkb/shared';

const STORAGE_PATH = process.env.STORAGE_PATH || './data/attachments';

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

  // Generate storage path: /YYYY/MM/DD/<hash>.<ext>
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const date = new Date();
  const ext = path.extname(attachment.filename) || '';
  const relative_path = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${hash}${ext}`;
  const full_path = path.join(STORAGE_PATH, relative_path);

  // Ensure directory exists
  await mkdir(path.dirname(full_path), { recursive: true });

  // Write file
  await writeFile(full_path, buffer);

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
  // Generate storage path: /YYYY/MM/DD/<hash>.<ext>
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const date = new Date();
  const ext = path.extname(filename) || '';
  const relative_path = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${hash}${ext}`;
  const full_path = path.join(STORAGE_PATH, relative_path);

  // Ensure directory exists
  await mkdir(path.dirname(full_path), { recursive: true });

  // Write file
  await writeFile(full_path, buffer);

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
  return path.join(STORAGE_PATH, storage_path);
}

export function get_storage_path(): string {
  return STORAGE_PATH;
}
