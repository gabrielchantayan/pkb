import { get_pool, query } from '../db/index.js';
import type { Note, NoteAttachment, Contact } from '@pkb/shared';
import type { ListNotesQuery, CreateNoteInput, UpdateNoteInput } from '../schemas/notes.js';
import { save_file, delete_file, get_file_path } from './storage.js';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface NoteWithMeta extends Note {
  contact_name: string;
  attachment_count: number;
}

export interface ListNotesResponse {
  notes: NoteWithMeta[];
  nextCursor: string | null;
}

export interface NoteDetailResponse {
  note: Note;
  attachments: NoteAttachment[];
  contact: Contact;
}

export interface AttachmentFileInfo {
  path: string;
  filename: string;
  mime_type: string;
}

export async function list_notes(params: ListNotesQuery): Promise<ListNotesResponse> {
  const values: unknown[] = [];
  let param_index = 1;

  const conditions: string[] = ['n.deleted_at IS NULL'];

  if (params.contact_id) {
    values.push(params.contact_id);
    conditions.push(`n.contact_id = $${param_index++}`);
  }

  if (params.search) {
    values.push(`%${params.search}%`);
    conditions.push(`n.content ILIKE $${param_index++}`);
  }

  if (params.cursor) {
    values.push(params.cursor);
    conditions.push(`(n.updated_at, n.id) < (
      SELECT updated_at, id FROM notes WHERE id = $${param_index++}
    )`);
  }

  values.push(params.limit + 1);

  const sql = `
    SELECT n.*,
           c.display_name as contact_name,
           COUNT(na.id)::int as attachment_count
    FROM notes n
    JOIN contacts c ON c.id = n.contact_id
    LEFT JOIN note_attachments na ON na.note_id = n.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY n.id, c.display_name
    ORDER BY n.updated_at DESC, n.id DESC
    LIMIT $${param_index}
  `;

  const result = await query<NoteWithMeta>(sql, values);
  const limit = params.limit;
  const has_more = result.rows.length > limit;
  const notes = has_more ? result.rows.slice(0, -1) : result.rows;
  const last = notes[notes.length - 1];
  const next_cursor = has_more && last ? last.id : null;

  return { notes, nextCursor: next_cursor };
}

export async function get_note(id: string): Promise<NoteDetailResponse | null> {
  const note_result = await query<Note>(
    'SELECT * FROM notes WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );

  if (note_result.rows.length === 0) {
    return null;
  }

  const note = note_result.rows[0];

  const [attachments_result, contact_result] = await Promise.all([
    query<NoteAttachment>(
      'SELECT * FROM note_attachments WHERE note_id = $1 ORDER BY created_at',
      [id]
    ),
    query<Contact>('SELECT * FROM contacts WHERE id = $1', [note.contact_id]),
  ]);

  return {
    note,
    attachments: attachments_result.rows,
    contact: contact_result.rows[0],
  };
}

export async function create_note(input: CreateNoteInput): Promise<Note> {
  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify contact exists
    const contact = await client.query(
      'SELECT id FROM contacts WHERE id = $1 AND deleted_at IS NULL',
      [input.contact_id]
    );

    if (contact.rows.length === 0) {
      throw new NotFoundError('Contact not found');
    }

    const result = await client.query<Note>(
      `INSERT INTO notes (contact_id, content, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING *`,
      [input.contact_id, input.content]
    );

    const note = result.rows[0];

    // Audit log
    await client.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, new_value, timestamp)
       VALUES ('note', $1, 'create', $2, NOW())`,
      [note.id, JSON.stringify({ content: input.content })]
    );

    await client.query('COMMIT');
    return note;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function update_note(id: string, input: UpdateNoteInput): Promise<Note> {
  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const current = await client.query<Note>(
      'SELECT * FROM notes WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (current.rows.length === 0) {
      throw new NotFoundError('Note not found');
    }

    const result = await client.query<Note>(
      `UPDATE notes SET content = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, input.content]
    );

    const note = result.rows[0];

    // Audit log
    await client.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, timestamp)
       VALUES ('note', $1, 'update', $2, $3, NOW())`,
      [
        id,
        JSON.stringify({ content: current.rows[0].content }),
        JSON.stringify({ content: input.content }),
      ]
    );

    await client.query('COMMIT');
    return note;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function delete_note(id: string): Promise<boolean> {
  const pool = get_pool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query<Note>(
      `UPDATE notes SET deleted_at = NOW(), updated_at = NOW()
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
      `INSERT INTO audit_log (entity_type, entity_id, action, old_value, timestamp)
       VALUES ('note', $1, 'delete', $2, NOW())`,
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

// Attachment operations

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export async function upload_attachment(
  note_id: string,
  file: UploadedFile
): Promise<NoteAttachment> {
  // Verify note exists
  const note = await query(
    'SELECT id FROM notes WHERE id = $1 AND deleted_at IS NULL',
    [note_id]
  );

  if (note.rows.length === 0) {
    throw new NotFoundError('Note not found');
  }

  // Save file to storage
  const storage_path = await save_file(file.buffer, file.originalname);

  // Create DB record
  const result = await query<NoteAttachment>(
    `INSERT INTO note_attachments (note_id, filename, mime_type, storage_path, size_bytes, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [note_id, file.originalname, file.mimetype, storage_path, file.size]
  );

  return result.rows[0];
}

export async function delete_attachment(
  note_id: string,
  attachment_id: string
): Promise<boolean> {
  const attachment = await query<NoteAttachment>(
    `SELECT * FROM note_attachments
     WHERE id = $1 AND note_id = $2`,
    [attachment_id, note_id]
  );

  if (attachment.rows.length === 0) {
    return false;
  }

  // Delete file from storage
  if (attachment.rows[0].storage_path) {
    await delete_file(attachment.rows[0].storage_path);
  }

  // Delete DB record (hard delete for attachments)
  await query('DELETE FROM note_attachments WHERE id = $1', [attachment_id]);

  return true;
}

export async function get_attachment(
  note_id: string,
  attachment_id: string
): Promise<AttachmentFileInfo | null> {
  const attachment = await query<NoteAttachment>(
    `SELECT * FROM note_attachments
     WHERE id = $1 AND note_id = $2`,
    [attachment_id, note_id]
  );

  if (attachment.rows.length === 0) {
    return null;
  }

  const record = attachment.rows[0];

  if (!record.storage_path || !record.filename || !record.mime_type) {
    return null;
  }

  return {
    path: get_file_path(record.storage_path),
    filename: record.filename,
    mime_type: record.mime_type,
  };
}
