import { Router } from 'express';
import { require_auth } from '../middleware/auth.js';
import {
  list_followups,
  get_pending_followups,
  get_followup,
  create_followup,
  update_followup,
  complete_followup,
  delete_followup,
  generate_time_suggestions,
  accept_suggestion,
  NotFoundError,
} from '../services/followups.js';
import {
  list_followups_query_schema,
  pending_followups_query_schema,
  create_followup_schema,
  update_followup_schema,
  complete_followup_schema,
  accept_suggestion_schema,
  uuid_param_schema,
} from '../schemas/followups.js';

const router = Router();

// List followups with filtering and pagination
router.get('/followups', require_auth, async (req, res) => {
  try {
    const query_result = list_followups_query_schema.safeParse(req.query);
    if (!query_result.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: query_result.error.issues });
      return;
    }

    const result = await list_followups(query_result.data);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get pending followups (dashboard)
router.get('/followups/pending', require_auth, async (req, res) => {
  try {
    const query_result = pending_followups_query_schema.safeParse(req.query);
    if (!query_result.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: query_result.error.issues });
      return;
    }

    const result = await get_pending_followups(query_result.data.limit);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get AI suggestions
router.get('/followups/suggestions', require_auth, async (_req, res) => {
  try {
    const suggestions = await generate_time_suggestions();
    res.json({ suggestions });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Accept suggestion
router.post('/followups/suggestions/accept', require_auth, async (req, res) => {
  try {
    const body_result = accept_suggestion_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const followup = await accept_suggestion(body_result.data);
    res.status(201).json({ followup });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single followup
router.get('/followups/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid followup ID' });
      return;
    }

    const followup = await get_followup(param_result.data.id);
    if (!followup) {
      res.status(404).json({ error: 'Followup not found' });
      return;
    }

    res.json({ followup });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create followup
router.post('/followups', require_auth, async (req, res) => {
  try {
    const body_result = create_followup_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const followup = await create_followup(body_result.data);
    res.status(201).json({ followup });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update followup
router.put('/followups/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid followup ID' });
      return;
    }

    const body_result = update_followup_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const followup = await update_followup(param_result.data.id, body_result.data);
    res.json({ followup });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Complete followup
router.post('/followups/:id/complete', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid followup ID' });
      return;
    }

    // Parse but don't use the note yet (for future extension)
    complete_followup_schema.safeParse(req.body);

    const followup = await complete_followup(param_result.data.id);
    res.json({ followup });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete followup
router.delete('/followups/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid followup ID' });
      return;
    }

    const deleted = await delete_followup(param_result.data.id);
    if (!deleted) {
      res.status(404).json({ error: 'Followup not found' });
      return;
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
