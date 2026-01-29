import { Router } from 'express';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { require_api_key } from '../middleware/auth.js';
import { batch_upsert } from '../services/communications.js';
import {
  get_attachment,
  get_attachment_full_path,
  save_attachment_from_buffer,
} from '../services/attachments.js';
import { query } from '../db/index.js';
import { batch_upsert_schema, uuid_param_schema } from '../schemas/communications.js';

const router = Router();

// Batch upsert communications (daemon endpoint)
router.post('/sync/communications', require_api_key, async (req, res) => {
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
