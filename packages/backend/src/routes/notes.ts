import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { logger } from '../lib/logger.js';
import { require_auth } from '../middleware/auth.js';
import {
  list_notes,
  get_note,
  create_note,
  update_note,
  delete_note,
  upload_attachment,
  delete_attachment,
  get_attachment,
  NotFoundError,
} from '../services/notes.js';
import {
  list_notes_query_schema,
  create_note_schema,
  update_note_schema,
  uuid_param_schema,
  attachment_param_schema,
} from '../schemas/notes.js';

const router = Router();

// Configure multer for memory storage with 50MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

// List notes with filtering and pagination
router.get('/notes', require_auth, async (req, res) => {
  try {
    const query_result = list_notes_query_schema.safeParse(req.query);
    if (!query_result.success) {
      logger.warn('notes/list validation failed', { request_id: req.request_id, issues: query_result.error.issues });
      res.status(400).json({ error: 'Invalid query parameters', details: query_result.error.issues });
      return;
    }

    const result = await list_notes(query_result.data);
    res.json(result);
  } catch (err) {
    logger.error('notes/list unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get note detail with attachments
router.get('/notes/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('notes/get validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid note ID' });
      return;
    }

    const note_detail = await get_note(param_result.data.id);
    if (!note_detail) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    res.json(note_detail);
  } catch (err) {
    logger.error('notes/get unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create note
router.post('/notes', require_auth, async (req, res) => {
  try {
    const body_result = create_note_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('notes/create validation failed', { request_id: req.request_id, issues: body_result.error.issues });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const note = await create_note(body_result.data);
    logger.info('note created', { request_id: req.request_id, note_id: note.id });
    res.status(201).json({ note });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    logger.error('notes/create unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update note
router.put('/notes/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('notes/update validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid note ID' });
      return;
    }

    const body_result = update_note_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('notes/update body validation failed', { request_id: req.request_id, issues: body_result.error.issues });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const note = await update_note(param_result.data.id, body_result.data);
    logger.info('note updated', { request_id: req.request_id, note_id: param_result.data.id });
    res.json({ note });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    logger.error('notes/update unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete note (soft delete)
router.delete('/notes/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('notes/delete validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid note ID' });
      return;
    }

    const deleted = await delete_note(param_result.data.id);
    if (!deleted) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    logger.info('note deleted', { request_id: req.request_id, note_id: param_result.data.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('notes/delete unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload attachment
router.post('/notes/:id/attachments', require_auth, upload.single('file'), async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('notes/upload_attachment validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid note ID' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const attachment = await upload_attachment(param_result.data.id, {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      buffer: req.file.buffer,
    });

    logger.info('note attachment uploaded', { request_id: req.request_id, note_id: param_result.data.id });
    res.status(201).json({ attachment });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    logger.error('notes/upload_attachment unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download attachment
router.get('/notes/:id/attachments/:attachmentId', require_auth, async (req, res) => {
  try {
    const param_result = attachment_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('notes/get_attachment validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }

    const file_info = await get_attachment(param_result.data.id, param_result.data.attachmentId);
    if (!file_info) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    res.setHeader('Content-Type', file_info.mime_type);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file_info.filename)}"`
    );
    res.sendFile(path.resolve(file_info.path));
  } catch (err) {
    logger.error('notes/get_attachment unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete attachment
router.delete('/notes/:id/attachments/:attachmentId', require_auth, async (req, res) => {
  try {
    const param_result = attachment_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('notes/delete_attachment validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }

    const deleted = await delete_attachment(param_result.data.id, param_result.data.attachmentId);
    if (!deleted) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    logger.info('note attachment deleted', { request_id: req.request_id, note_id: param_result.data.id, attachment_id: param_result.data.attachmentId });
    res.json({ success: true });
  } catch (err) {
    logger.error('notes/delete_attachment unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
