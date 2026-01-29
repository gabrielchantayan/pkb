import { Router } from 'express';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { require_auth } from '../middleware/auth.js';
import {
  list_communications,
  get_communication,
  search_communications,
} from '../services/communications.js';
import { get_attachment, get_attachment_full_path } from '../services/attachments.js';
import {
  list_communications_query_schema,
  search_communications_query_schema,
  uuid_param_schema,
} from '../schemas/communications.js';

const router = Router();

// List communications with filtering and pagination
router.get('/communications', require_auth, async (req, res) => {
  try {
    const query_result = list_communications_query_schema.safeParse(req.query);
    if (!query_result.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: query_result.error.issues });
      return;
    }

    const result = await list_communications(query_result.data);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search communications (full-text search)
router.get('/communications/search', require_auth, async (req, res) => {
  try {
    const query_result = search_communications_query_schema.safeParse(req.query);
    if (!query_result.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: query_result.error.issues });
      return;
    }

    const result = await search_communications(query_result.data);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single communication with attachments and contact
router.get('/communications/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid communication ID' });
      return;
    }

    const result = await get_communication(param_result.data.id);
    if (!result) {
      res.status(404).json({ error: 'Communication not found' });
      return;
    }

    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download attachment (user-facing endpoint)
router.get('/attachments/:id/download', require_auth, async (req, res) => {
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
