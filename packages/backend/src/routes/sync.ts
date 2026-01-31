import { Router } from 'express';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { require_api_key } from '../middleware/auth.js';
import { batch_upsert } from '../services/communications.js';
import { batch_import_contacts } from '../services/contacts.js';
import {
  get_attachment,
  get_attachment_full_path,
  save_attachment_from_buffer,
} from '../services/attachments.js';
import { query } from '../db/index.js';
import { batch_upsert_schema, uuid_param_schema } from '../schemas/communications.js';
import {
  contacts_import_batch_schema,
  calendar_events_batch_schema,
  apple_notes_batch_schema,
} from '../schemas/sync.js';

const router = Router();

// Batch upsert communications (daemon endpoint)
router.post('/communications/batch', require_api_key, async (req, res) => {
  try {
    const body_result = batch_upsert_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const result = await batch_upsert(body_result.data);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Batch import contacts (daemon endpoint for Apple Contacts sync)
router.post('/sync/contacts', require_api_key, async (req, res) => {
  try {
    const body_result = contacts_import_batch_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const result = await batch_import_contacts(body_result.data.contacts);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload attachment for existing communication (daemon endpoint)
// Expects multipart/form-data with fields: file, communication_source, communication_source_id, filename
router.post('/sync/attachments', require_api_key, async (req, res) => {
  try {
    // For multipart uploads, we need to handle the raw body
    // This is a simplified implementation - in production use multer or busboy
    const content_type = req.headers['content-type'] || '';

    if (!content_type.includes('application/json')) {
      res.status(400).json({ error: 'Expected application/json with base64-encoded file data' });
      return;
    }

    const { communication_source, communication_source_id, filename, mime_type, data } = req.body;

    if (!communication_source || !communication_source_id || !filename || !data) {
      res.status(400).json({
        error: 'Missing required fields: communication_source, communication_source_id, filename, data',
      });
      return;
    }

    // Find the communication by source and source_id
    const comm_result = await query<{ id: string }>(
      'SELECT id FROM communications WHERE source = $1 AND source_id = $2',
      [communication_source, communication_source_id]
    );

    if (comm_result.rows.length === 0) {
      res.status(404).json({ error: 'Communication not found' });
      return;
    }

    const communication_id = comm_result.rows[0].id;

    // Decode base64 and save
    const buffer = Buffer.from(data, 'base64');
    const attachment = await save_attachment_from_buffer(
      communication_id,
      filename,
      mime_type || 'application/octet-stream',
      buffer
    );

    res.status(201).json({ attachment });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Batch upsert calendar events (daemon endpoint)
router.post('/sync/calendar', require_api_key, async (req, res) => {
  try {
    const body_result = calendar_events_batch_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const events = body_result.data.events;
    let inserted = 0;
    let updated = 0;
    const errors: { index: number; error: string }[] = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      try {
        // Resolve attendee emails to contact IDs
        const attendee_contact_ids: string[] = [];
        if (event.attendees && event.attendees.length > 0) {
          for (const email of event.attendees) {
            const contact_result = await query<{ contact_id: string }>(
              `SELECT contact_id FROM contact_identifiers
               WHERE type = 'email' AND LOWER(value) = LOWER($1)`,
              [email]
            );
            if (contact_result.rows.length > 0) {
              attendee_contact_ids.push(contact_result.rows[0].contact_id);
            }
          }
        }

        // Upsert the calendar event
        const result = await query<{ id: string; is_insert: boolean }>(
          `INSERT INTO calendar_events (source, source_id, title, description, start_time, end_time, location, attendee_contact_ids)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (source, source_id) DO UPDATE SET
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             location = EXCLUDED.location,
             attendee_contact_ids = EXCLUDED.attendee_contact_ids
           RETURNING id, (xmax = 0) as is_insert`,
          [
            event.provider,
            event.source_id,
            event.title || '',
            event.description || null,
            event.start_time,
            event.end_time || null,
            event.location || null,
            attendee_contact_ids.length > 0 ? attendee_contact_ids : null,
          ]
        );

        if (result.rows[0] && result.rows[0].is_insert) {
          inserted++;
        } else {
          updated++;
        }
      } catch (err) {
        errors.push({ index: i, error: String(err) });
      }
    }

    res.json({ inserted, updated, errors });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Batch upsert Apple Notes (daemon endpoint)
router.post('/sync/notes', require_api_key, async (req, res) => {
  try {
    const body_result = apple_notes_batch_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const notes = body_result.data.notes;
    let inserted = 0;
    let updated = 0;
    const errors: { index: number; error: string }[] = [];

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      try {
        const result = await query<{ id: string; is_insert: boolean }>(
          `INSERT INTO apple_notes (source_id, title, content, folder, created_at, updated_at)
           VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), COALESCE($6::timestamptz, NOW()))
           ON CONFLICT (source_id) DO UPDATE SET
             title = EXCLUDED.title,
             content = EXCLUDED.content,
             folder = EXCLUDED.folder,
             updated_at = COALESCE(EXCLUDED.updated_at, NOW())
           RETURNING id, (xmax = 0) as is_insert`,
          [
            note.source_id,
            note.title || null,
            note.content || null,
            note.folder || null,
            note.created_at || null,
            note.updated_at || null,
          ]
        );

        if (result.rows[0] && result.rows[0].is_insert) {
          inserted++;
        } else {
          updated++;
        }
      } catch (err) {
        errors.push({ index: i, error: String(err) });
      }
    }

    res.json({ inserted, updated, errors });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download attachment
router.get('/attachments/:id', require_api_key, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid attachment ID' });
      return;
    }

    const attachment = await get_attachment(param_result.data.id);
    if (!attachment || !attachment.storage_path) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    const file_path = get_attachment_full_path(attachment.storage_path);

    try {
      const file_stat = await stat(file_path);
      if (!file_stat.isFile()) {
        res.status(404).json({ error: 'Attachment file not found' });
        return;
      }
    } catch {
      res.status(404).json({ error: 'Attachment file not found' });
      return;
    }

    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${attachment.filename || 'download'}"`
    );

    const stream = createReadStream(file_path);
    stream.pipe(res);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
