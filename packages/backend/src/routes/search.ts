import { Router } from 'express';
import { require_auth } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import { search, search_communications_endpoint } from '../services/search.js';
import { global_search_schema, communication_search_query_schema } from '../schemas/search.js';

const router = Router();

// Global search across all entity types
router.post('/search', require_auth, async (req, res) => {
  try {
    const body_result = global_search_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('search/global validation failed', { request_id: req.request_id, issues: body_result.error.issues });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const results = await search(body_result.data);
    res.json(results);
  } catch (err) {
    logger.error('search/global unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Communication-specific search
router.get('/communications/search', require_auth, async (req, res) => {
  try {
    const query_result = communication_search_query_schema.safeParse(req.query);
    if (!query_result.success) {
      logger.warn('search/communications validation failed', { request_id: req.request_id, issues: query_result.error.issues });
      res.status(400).json({ error: 'Invalid query parameters', details: query_result.error.issues });
      return;
    }

    const results = await search_communications_endpoint(query_result.data);
    res.json(results);
  } catch (err) {
    logger.error('search/communications unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
