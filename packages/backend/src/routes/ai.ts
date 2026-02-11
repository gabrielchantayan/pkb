import { Router } from 'express';
import { require_auth, require_api_key } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import {
  extract_from_communication,
  answer_query,
  embed_batch,
  backfill_embeddings,
  is_ai_available,
} from '../services/ai/index.js';
import { query } from '../db/index.js';
import {
  extract_schema,
  query_schema,
  embed_schema,
  backfill_schema,
} from '../schemas/ai.js';

const router = Router();

// Check AI availability
router.get('/ai/status', require_auth, async (_req, res) => {
  res.json({
    available: is_ai_available(),
    message: is_ai_available()
      ? 'AI services are available'
      : 'GEMINI_API_KEY not configured',
  });
});

// Extract facts from communication (internal/daemon)
router.post('/ai/extract', require_api_key, async (req, res) => {
  try {
    const body_result = extract_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('ai/extract validation failed', { request_id: req.request_id, issues: body_result.error.issues });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    if (!is_ai_available()) {
      res.status(503).json({ error: 'AI services not available' });
      return;
    }

    const { communication_id, content, contact_id } = body_result.data;

    // Get contact name
    const contact_result = await query<{ display_name: string }>(
      'SELECT display_name FROM contacts WHERE id = $1',
      [contact_id]
    );

    const contact_name = contact_result.rows[0]?.display_name || 'Unknown';

    // Get communication direction
    const comm_result = await query<{ direction: string }>(
      'SELECT direction FROM communications WHERE id = $1',
      [communication_id]
    );

    const direction = comm_result.rows[0]?.direction || 'unknown';

    const result = await extract_from_communication(
      communication_id,
      content,
      contact_id,
      contact_name,
      direction
    );

    logger.info('ai extraction completed', { request_id: req.request_id, communication_id: body_result.data.communication_id });
    res.json({
      facts: result.facts.map((f) => ({
        id: f.id,
        fact_type: f.fact_type,
        value: f.value,
        confidence: f.confidence,
      })),
      followups: result.followups
        .filter((f): f is NonNullable<typeof f> => f !== null)
        .map((f) => ({
          id: f.id,
          reason: f.reason,
          due_date: f.due_date,
        })),
    });
  } catch (err) {
    logger.error('ai/extract unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// AI query
router.post('/ai/query', require_auth, async (req, res) => {
  try {
    const body_result = query_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('ai/query validation failed', { request_id: req.request_id, issues: body_result.error.issues });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    if (!is_ai_available()) {
      res.status(503).json({ error: 'AI services not available' });
      return;
    }

    const result = await answer_query(body_result.data.query, body_result.data.contact_id);
    logger.info('ai query completed', { request_id: req.request_id });
    res.json(result);
  } catch (err) {
    logger.error('ai/query unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate embeddings (internal/daemon)
router.post('/ai/embed', require_api_key, async (req, res) => {
  try {
    const body_result = embed_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('ai/embed validation failed', { request_id: req.request_id, issues: body_result.error.issues });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    if (!is_ai_available()) {
      res.status(503).json({ error: 'AI services not available' });
      return;
    }

    const result = await embed_batch(body_result.data);
    logger.info('ai embed completed', { request_id: req.request_id });
    res.json(result);
  } catch (err) {
    logger.error('ai/embed unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Backfill embeddings for existing communications
router.post('/ai/backfill', require_auth, async (req, res) => {
  try {
    const body_result = backfill_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('ai/backfill validation failed', { request_id: req.request_id, issues: body_result.error.issues });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    if (!is_ai_available()) {
      res.status(503).json({ error: 'AI services not available' });
      return;
    }

    const result = await backfill_embeddings(body_result.data.batch_size);
    logger.info('ai backfill completed', { request_id: req.request_id });
    res.json(result);
  } catch (err) {
    logger.error('ai/backfill unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
