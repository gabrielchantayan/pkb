import { Router } from 'express';
import { require_auth } from '../middleware/auth.js';
import {
  list_facts,
  get_fact,
  create_fact,
  update_fact,
  delete_fact,
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
  uuid_param_schema,
} from '../schemas/facts.js';

const router = Router();

// List facts with filtering and pagination
router.get('/facts', require_auth, async (req, res) => {
  try {
    const query_result = list_facts_query_schema.safeParse(req.query);
    if (!query_result.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: query_result.error.issues });
      return;
    }

    const result = await list_facts(query_result.data);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get conflicts
router.get('/facts/conflicts', require_auth, async (_req, res) => {
  try {
    const conflicts = await find_conflicts();
    res.json({ conflicts });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get fact detail with history
router.get('/facts/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid fact ID' });
      return;
    }

    const fact_detail = await get_fact(param_result.data.id);
    if (!fact_detail) {
      res.status(404).json({ error: 'Fact not found' });
      return;
    }

    res.json(fact_detail);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create fact
router.post('/facts', require_auth, async (req, res) => {
  try {
    const body_result = create_fact_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const fact = await create_fact(body_result.data);
    res.status(201).json({ fact });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update fact
router.put('/facts/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid fact ID' });
      return;
    }

    const body_result = update_fact_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const fact = await update_fact(param_result.data.id, body_result.data);
    res.json({ fact });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete fact (soft)
router.delete('/facts/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid fact ID' });
      return;
    }

    const deleted = await delete_fact(param_result.data.id);
    if (!deleted) {
      res.status(404).json({ error: 'Fact not found' });
      return;
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get fact history
router.get('/facts/:id/history', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid fact ID' });
      return;
    }

    const history = await get_fact_history(param_result.data.id);
    res.json({ history });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Resolve conflict
router.post('/facts/:id/resolve', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid fact ID' });
      return;
    }

    const body_result = resolve_conflict_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const fact = await resolve_conflict(param_result.data.id, body_result.data);
    res.json({ fact });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Batch create extracted facts (for AI integration)
router.post('/facts/batch', require_auth, async (req, res) => {
  try {
    const body_result = batch_create_facts_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const results = await batch_create_extracted_facts(
      body_result.data.communication_id,
      body_result.data.facts
    );

    res.status(201).json({ results });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
