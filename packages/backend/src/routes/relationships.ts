import { Router } from 'express';
import { require_auth } from '../middleware/auth.js';
import {
  list_relationships,
  create_relationship,
  update_relationship,
  delete_relationship,
  NotFoundError,
} from '../services/relationships.js';
import {
  list_relationships_query_schema,
  create_relationship_schema,
  update_relationship_schema,
  uuid_param_schema,
} from '../schemas/relationships.js';

const router = Router();

// List relationships for a contact
router.get('/relationships', require_auth, async (req, res) => {
  try {
    const query_result = list_relationships_query_schema.safeParse(req.query);
    if (!query_result.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: query_result.error.issues });
      return;
    }

    const relationships = await list_relationships(query_result.data.contact_id);
    res.json({ relationships });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create relationship
router.post('/relationships', require_auth, async (req, res) => {
  try {
    const body_result = create_relationship_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const relationship = await create_relationship(body_result.data);
    res.status(201).json({ relationship });
  } catch (error) {
    if (error instanceof Error && error.message.includes('unique constraint')) {
      res.status(409).json({ error: 'A relationship with this label and person name already exists' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update relationship
router.put('/relationships/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid relationship ID' });
      return;
    }

    const body_result = update_relationship_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const relationship = await update_relationship(param_result.data.id, body_result.data);
    res.json({ relationship });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof Error && error.message.includes('unique constraint')) {
      res.status(409).json({ error: 'A relationship with this label and person name already exists' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete relationship (soft)
router.delete('/relationships/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid relationship ID' });
      return;
    }

    const deleted = await delete_relationship(param_result.data.id);
    if (!deleted) {
      res.status(404).json({ error: 'Relationship not found' });
      return;
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
