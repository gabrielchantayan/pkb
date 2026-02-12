import { Router } from 'express';
import { logger } from '../lib/logger.js';
import { require_auth } from '../middleware/auth.js';
import {
  list_facts,
  get_fact,
  create_fact,
  update_fact,
  delete_fact,
  bulk_delete_facts,
  get_fact_history,
  find_conflicts,
  resolve_conflict,
  batch_create_extracted_facts,
  NotFoundError,
  ValidationError,
} from '../services/facts.js';
import {
  list_facts_query_schema,
  create_fact_schema,
  update_fact_schema,
  resolve_conflict_schema,
  batch_create_facts_schema,
  bulk_delete_facts_schema,
  uuid_param_schema,
} from '../schemas/facts.js';

const router = Router();

// List facts with filtering and pagination
router.get('/facts', require_auth, async (req, res) => {
  try {
    const query_result = list_facts_query_schema.safeParse(req.query);
    if (!query_result.success) {
      logger.warn('facts/list validation failed', {
        request_id: req.request_id,
        error_count: query_result.error.issues.length,
        issues: query_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid query parameters', details: query_result.error.issues });
      return;
    }

    const result = await list_facts(query_result.data);
    res.json(result);
  } catch (err) {
    logger.error('facts/list unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get conflicts
router.get('/facts/conflicts', require_auth, async (req, res) => {
  try {
    const conflicts = await find_conflicts();
    res.json({ conflicts });
  } catch (err) {
    logger.error('facts/conflicts unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk delete facts (soft)
router.delete('/facts/bulk', require_auth, async (req, res) => {
  try {
    const body_result = bulk_delete_facts_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('facts/bulk-delete validation failed', {
        request_id: req.request_id,
        error_count: body_result.error.issues.length,
        issues: body_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const deleted_count = await bulk_delete_facts(body_result.data.ids);
    logger.info('facts bulk deleted', { request_id: req.request_id, requested: body_result.data.ids.length, deleted_count });
    res.json({ deleted_count });
  } catch (err) {
    logger.error('facts/bulk-delete unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get fact detail with history
router.get('/facts/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('facts/get validation failed', {
        request_id: req.request_id,
        error_count: param_result.error.issues.length,
        issues: param_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid fact ID' });
      return;
    }

    const fact_detail = await get_fact(param_result.data.id);
    if (!fact_detail) {
      res.status(404).json({ error: 'Fact not found' });
      return;
    }

    res.json(fact_detail);
  } catch (err) {
    logger.error('facts/get unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create fact
router.post('/facts', require_auth, async (req, res) => {
  try {
    const body_result = create_fact_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('facts/create validation failed', {
        request_id: req.request_id,
        error_count: body_result.error.issues.length,
        issues: body_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const fact = await create_fact(body_result.data);
    logger.info('fact created', { request_id: req.request_id, fact_id: fact.id });
    res.status(201).json({ fact });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error('facts/create unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update fact
router.put('/facts/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('facts/update validation failed', {
        request_id: req.request_id,
        error_count: param_result.error.issues.length,
        issues: param_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid fact ID' });
      return;
    }

    const body_result = update_fact_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('facts/update validation failed', {
        request_id: req.request_id,
        error_count: body_result.error.issues.length,
        issues: body_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const fact = await update_fact(param_result.data.id, body_result.data);
    logger.info('fact updated', { request_id: req.request_id, fact_id: param_result.data.id });
    res.json({ fact });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error('facts/update unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete fact (soft)
router.delete('/facts/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('facts/delete validation failed', {
        request_id: req.request_id,
        error_count: param_result.error.issues.length,
        issues: param_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid fact ID' });
      return;
    }

    const deleted = await delete_fact(param_result.data.id);
    if (!deleted) {
      res.status(404).json({ error: 'Fact not found' });
      return;
    }

    logger.info('fact deleted', { request_id: req.request_id, fact_id: param_result.data.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('facts/delete unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get fact history
router.get('/facts/:id/history', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('facts/history validation failed', {
        request_id: req.request_id,
        error_count: param_result.error.issues.length,
        issues: param_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid fact ID' });
      return;
    }

    const history = await get_fact_history(param_result.data.id);
    res.json({ history });
  } catch (err) {
    logger.error('facts/history unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Resolve conflict
router.post('/facts/:id/resolve', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('facts/resolve validation failed', {
        request_id: req.request_id,
        error_count: param_result.error.issues.length,
        issues: param_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid fact ID' });
      return;
    }

    const body_result = resolve_conflict_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('facts/resolve validation failed', {
        request_id: req.request_id,
        error_count: body_result.error.issues.length,
        issues: body_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const fact = await resolve_conflict(param_result.data.id, body_result.data);
    logger.info('fact conflict resolved', { request_id: req.request_id, fact_id: param_result.data.id });
    res.json({ fact });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    logger.error('facts/resolve unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Batch create extracted facts (for AI integration)
router.post('/facts/batch', require_auth, async (req, res) => {
  try {
    const body_result = batch_create_facts_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('facts/batch validation failed', {
        request_id: req.request_id,
        error_count: body_result.error.issues.length,
        issues: body_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const results = await batch_create_extracted_facts(
      body_result.data.communication_id,
      body_result.data.facts
    );

    logger.info('facts batch created', { request_id: req.request_id, communication_id: body_result.data.communication_id, count: body_result.data.facts.length });
    res.status(201).json({ results });
  } catch (err) {
    logger.error('facts/batch unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
