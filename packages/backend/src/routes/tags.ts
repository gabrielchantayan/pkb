import { Router } from 'express';
import { require_auth } from '../middleware/auth.js';
import {
  list_tags,
  get_tag,
  create_tag,
  update_tag,
  delete_tag,
  add_tag_to_contact,
  remove_tag_from_contact,
  ConflictError,
  NotFoundError,
} from '../services/tags.js';
import {
  suggest_tags_for_contact,
  apply_suggested_tag,
  is_ai_available,
} from '../services/ai/index.js';
import {
  create_tag_schema,
  update_tag_schema,
  uuid_param_schema,
  contact_id_param_schema,
  add_tag_to_contact_schema,
  contact_tag_params_schema,
} from '../schemas/organization.js';
import { apply_suggested_tag_schema } from '../schemas/ai.js';

const router = Router();

// List all tags
router.get('/tags', require_auth, async (_req, res) => {
  try {
    const tags = await list_tags();
    res.json({ tags });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single tag
router.get('/tags/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid tag ID' });
      return;
    }

    const tag = await get_tag(param_result.data.id);
    if (!tag) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }

    res.json({ tag });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create tag
router.post('/tags', require_auth, async (req, res) => {
  try {
    const body_result = create_tag_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const tag = await create_tag(body_result.data);
    res.status(201).json({ tag });
  } catch (error) {
    if (error instanceof ConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update tag
router.put('/tags/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid tag ID' });
      return;
    }

    const body_result = update_tag_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const tag = await update_tag(param_result.data.id, body_result.data);
    if (!tag) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }

    res.json({ tag });
  } catch (error) {
    if (error instanceof ConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete tag
router.delete('/tags/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid tag ID' });
      return;
    }

    const deleted = await delete_tag(param_result.data.id);
    if (!deleted) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get AI-suggested tags for a contact
router.get('/contacts/:contactId/suggested-tags', require_auth, async (req, res) => {
  try {
    const param_result = contact_id_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    if (!is_ai_available()) {
      res.status(503).json({ error: 'AI services not available' });
      return;
    }

    const result = await suggest_tags_for_contact(param_result.data.contactId);
    if (!result) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Apply an AI-suggested tag to a contact
router.post('/contacts/:contactId/suggested-tags/apply', require_auth, async (req, res) => {
  try {
    const param_result = contact_id_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const body_result = apply_suggested_tag_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const suggestion = {
      name: body_result.data.name,
      is_existing: body_result.data.is_existing,
      existing_tag_id: body_result.data.existing_tag_id ?? null,
      confidence: body_result.data.confidence,
      reason: body_result.data.reason ?? 'Applied from suggestion',
    };

    const result = await apply_suggested_tag(param_result.data.contactId, suggestion);

    if (!result.success) {
      res.status(500).json({ error: result.error || 'Failed to apply tag' });
      return;
    }

    res.json({ success: true, tag_id: result.tag_id });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add tag to contact
router.post('/contacts/:contactId/tags', require_auth, async (req, res) => {
  try {
    const param_result = contact_id_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const body_result = add_tag_to_contact_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    await add_tag_to_contact(param_result.data.contactId, body_result.data.tag_id);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove tag from contact
router.delete('/contacts/:contactId/tags/:tagId', require_auth, async (req, res) => {
  try {
    const param_result = contact_tag_params_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }

    const removed = await remove_tag_from_contact(param_result.data.contactId, param_result.data.tagId);
    if (!removed) {
      res.status(404).json({ error: 'Tag not associated with contact' });
      return;
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
