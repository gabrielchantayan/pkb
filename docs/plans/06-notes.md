# Feature: Notes

## Overview

Manual note-taking for contacts with markdown support and file attachments. Notes are user-created content (unlike communications which are synced from sources).

## Dependencies

- **Requires**: 01-project-foundation, 02-authentication, 03-contacts-core
- **Blocks**: None (standalone feature)

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Content format | Markdown | Rich text with simplicity |
| Attachment storage | Same as communications | Reuse infrastructure |
| Rendering | Frontend responsibility | Backend stores raw markdown |

## Database Tables

Tables from 01-project-foundation:
- `notes` - Note content
- `note_attachments` - File references

## API Endpoints

### List Notes
```
GET /api/notes
Query params:
  - contact_id: UUID
  - search: string (full-text)
  - cursor: string
  - limit: number (default 20)

Response:
{
  notes: Note[],
  nextCursor: string | null
}
```

### Get Note
```
GET /api/notes/:id
Response:
{
  note: Note,
  attachments: Attachment[],
  contact: Contact
}
```

### Create Note
```
POST /api/notes
Body:
{
  contact_id: UUID,
  content: string  // markdown
}
Response: { note: Note }
```

### Update Note
```
PUT /api/notes/:id
Body:
{
  content: string
}
Response: { note: Note }
```

### Delete Note (soft)
```
DELETE /api/notes/:id
Response: { success: true }
```

### Upload Attachment
```
POST /api/notes/:id/attachments
Content-Type: multipart/form-data
Body:
  - file: binary

Response: { attachment: Attachment }
```

### Delete Attachment
```
DELETE /api/notes/:id/attachments/:attachmentId
Response: { success: true }
```

### Download Attachment
```
GET /api/notes/:id/attachments/:attachmentId
Response: Binary file with appropriate Content-Type
```

## Implementation

### Notes Service

```typescript
// src/services/notes.ts

export async function listNotes(params: ListNotesParams) {
  let query = `
    SELECT n.*,
           c.display_name as contact_name,
           COUNT(na.id) as attachment_count
    FROM notes n
    JOIN contacts c ON c.id = n.contact_id
    LEFT JOIN note_attachments na ON na.note_id = n.id
    WHERE n.deleted_at IS NULL
  `;

  const conditions: string[] = [];
  const values: any[] = [];

  if (params.contact_id) {
    values.push(params.contact_id);
    conditions.push(`n.contact_id = $${values.length}`);
  }

  if (params.search) {
    values.push(`%${params.search}%`);
    conditions.push(`n.content ILIKE $${values.length}`);
  }

  if (conditions.length) {
    query += ' AND ' + conditions.join(' AND ');
  }

  query += ' GROUP BY n.id, c.display_name';
  query += ' ORDER BY n.updated_at DESC';

  if (params.cursor) {
    values.push(params.cursor);
    query += ` AND n.id < $${values.length}`;
  }

  values.push(params.limit || 20);
  query += ` LIMIT $${values.length}`;

  return db.query(query, values);
}

export async function createNote(contactId: string, content: string) {
  // Verify contact exists
  const contact = await db.query(
    'SELECT id FROM contacts WHERE id = $1 AND deleted_at IS NULL',
    [contactId]
  );
  if (!contact.rows[0]) throw new NotFoundError('Contact not found');

  const result = await db.query(`
    INSERT INTO notes (contact_id, content, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    RETURNING *
  `, [contactId, content]);

  // Audit log
  await db.query(`
    INSERT INTO audit_log (entity_type, entity_id, action, new_value, timestamp)
    VALUES ('note', $1, 'create', $2, NOW())
  `, [result.rows[0].id, JSON.stringify({ content })]);

  return result.rows[0];
}

export async function updateNote(noteId: string, content: string) {
  const current = await db.query(
    'SELECT * FROM notes WHERE id = $1 AND deleted_at IS NULL',
    [noteId]
  );
  if (!current.rows[0]) throw new NotFoundError('Note not found');

  const result = await db.query(`
    UPDATE notes SET content = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [noteId, content]);

  // Audit log
  await db.query(`
    INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, timestamp)
    VALUES ('note', $1, 'update', $2, $3, NOW())
  `, [noteId, JSON.stringify({ content: current.rows[0].content }), JSON.stringify({ content })]);

  return result.rows[0];
}

export async function deleteNote(noteId: string) {
  const result = await db.query(`
    UPDATE notes SET deleted_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING *
  `, [noteId]);

  if (!result.rows[0]) throw new NotFoundError('Note not found');

  // Also soft-delete attachments
  await db.query(`
    UPDATE note_attachments SET deleted_at = NOW()
    WHERE note_id = $1
  `, [noteId]);

  // Audit log
  await db.query(`
    INSERT INTO audit_log (entity_type, entity_id, action, timestamp)
    VALUES ('note', $1, 'delete', NOW())
  `, [noteId]);

  return result.rows[0];
}
```

### Note Attachments

```typescript
// src/services/notes.ts (continued)

import { saveFile, deleteFile, getFilePath } from './storage';

export async function uploadAttachment(noteId: string, file: Express.Multer.File) {
  // Verify note exists
  const note = await db.query(
    'SELECT id FROM notes WHERE id = $1 AND deleted_at IS NULL',
    [noteId]
  );
  if (!note.rows[0]) throw new NotFoundError('Note not found');

  // Save file to storage
  const storagePath = await saveFile(file.buffer, file.originalname);

  // Create DB record
  const result = await db.query(`
    INSERT INTO note_attachments (note_id, filename, mime_type, storage_path, size_bytes, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING *
  `, [noteId, file.originalname, file.mimetype, storagePath, file.size]);

  return result.rows[0];
}

export async function deleteAttachment(noteId: string, attachmentId: string) {
  const attachment = await db.query(`
    SELECT * FROM note_attachments
    WHERE id = $1 AND note_id = $2
  `, [attachmentId, noteId]);

  if (!attachment.rows[0]) throw new NotFoundError('Attachment not found');

  // Delete file from storage
  await deleteFile(attachment.rows[0].storage_path);

  // Delete DB record (hard delete for attachments)
  await db.query('DELETE FROM note_attachments WHERE id = $1', [attachmentId]);
}

export async function getAttachment(noteId: string, attachmentId: string) {
  const attachment = await db.query(`
    SELECT * FROM note_attachments
    WHERE id = $1 AND note_id = $2
  `, [attachmentId, noteId]);

  if (!attachment.rows[0]) throw new NotFoundError('Attachment not found');

  const filePath = getFilePath(attachment.rows[0].storage_path);

  return {
    path: filePath,
    filename: attachment.rows[0].filename,
    mimeType: attachment.rows[0].mime_type
  };
}
```

### Shared Storage Service

```typescript
// src/services/storage.ts

import { createHash } from 'crypto';
import { writeFile, unlink, mkdir } from 'fs/promises';
import path from 'path';

const STORAGE_PATH = process.env.STORAGE_PATH || './data/attachments';

export async function saveFile(buffer: Buffer, originalFilename: string): Promise<string> {
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const date = new Date();
  const ext = path.extname(originalFilename) || '';

  const relativePath = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${hash}${ext}`;
  const fullPath = path.join(STORAGE_PATH, relativePath);

  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);

  return relativePath;
}

export async function deleteFile(relativePath: string): Promise<void> {
  const fullPath = path.join(STORAGE_PATH, relativePath);
  try {
    await unlink(fullPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function getFilePath(relativePath: string): string {
  return path.join(STORAGE_PATH, relativePath);
}
```

### Routes

```typescript
// src/routes/notes.ts

import multer from 'multer';
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

router.get('/api/notes', requireAuth, async (req, res) => {
  const notes = await listNotes({
    contact_id: req.query.contact_id as string,
    search: req.query.search as string,
    cursor: req.query.cursor as string,
    limit: parseInt(req.query.limit as string) || 20
  });

  const nextCursor = notes.rows.length === (parseInt(req.query.limit as string) || 20)
    ? notes.rows[notes.rows.length - 1].id
    : null;

  res.json({ notes: notes.rows, nextCursor });
});

router.post('/api/notes/:id/attachments', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const attachment = await uploadAttachment(req.params.id, req.file);
  res.json({ attachment });
});

router.get('/api/notes/:id/attachments/:attachmentId', requireAuth, async (req, res) => {
  const { path: filePath, filename, mimeType } = await getAttachment(
    req.params.id,
    req.params.attachmentId
  );

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath);
});
```

## Implementation Steps

1. Create `src/services/storage.ts` as shared file storage utility
2. Create `src/services/notes.ts` with note operations
3. Create `src/routes/notes.ts` with API endpoints
4. Install multer for file uploads
5. Add validation schemas
6. Implement full-text search on note content
7. Add audit logging for all mutations
8. Test CRUD operations
9. Test attachment upload/download/delete
10. Test file size limits

## Acceptance Criteria

- [ ] `GET /api/notes` returns paginated notes with contact info
- [ ] `GET /api/notes?contact_id=X` filters to specific contact
- [ ] `GET /api/notes?search=term` searches note content
- [ ] `GET /api/notes/:id` returns note with attachments
- [ ] `POST /api/notes` creates note for contact
- [ ] `PUT /api/notes/:id` updates note content
- [ ] `DELETE /api/notes/:id` soft deletes note and attachments
- [ ] `POST /api/notes/:id/attachments` uploads file
- [ ] `GET /api/notes/:id/attachments/:id` downloads file
- [ ] `DELETE /api/notes/:id/attachments/:id` removes file
- [ ] All mutations create audit log entries
- [ ] File uploads limited to 50MB

## Files to Create

| Path | Purpose |
|------|---------|
| `packages/backend/src/services/storage.ts` | Shared file storage |
| `packages/backend/src/services/notes.ts` | Note business logic |
| `packages/backend/src/routes/notes.ts` | API endpoints |
| `packages/backend/src/schemas/notes.ts` | Validation schemas |
| `packages/shared/src/types/note.ts` | TypeScript types |

## Notes for Implementation

- Markdown rendering happens on frontend, backend stores raw
- Attachments are hard-deleted (not soft) since they're linked to note lifecycle
- Consider adding a note_attachments soft delete if needed for audit
- Storage service is shared with communications attachments
- Consider S3 support in storage service (abstract the provider)
- Full-text search could be enhanced with tsvector like communications
