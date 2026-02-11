import { Router } from 'express';
import { require_auth } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import {
  list_groups,
  get_group,
  create_group,
  update_group,
  delete_group,
  add_contact_to_group,
  remove_contact_from_group,
  ConflictError,
  NotFoundError,
} from '../services/groups.js';
import {
  create_group_schema,
  update_group_schema,
  uuid_param_schema,
  contact_id_param_schema,
  add_contact_to_group_schema,
  contact_group_params_schema,
} from '../schemas/organization.js';

const router = Router();

// List all groups (returns hierarchical tree)
router.get('/groups', require_auth, async (req, res) => {
  try {
    const groups = await list_groups();
    res.json({ groups });
  } catch (err) {
    logger.error('GROUP/LIST unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single group
router.get('/groups/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('GROUP/GET validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid group ID' });
      return;
    }

    const group = await get_group(param_result.data.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    res.json({ group });
  } catch (err) {
    logger.error('GROUP/GET unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create group
router.post('/groups', require_auth, async (req, res) => {
  try {
    const body_result = create_group_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('GROUP/CREATE validation failed', { request_id: req.request_id, issues: body_result.error.issues });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const group = await create_group(body_result.data);
    logger.info('group created', { request_id: req.request_id, group_id: group.id });
    res.status(201).json({ group });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error('GROUP/CREATE unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update group
router.put('/groups/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('GROUP/UPDATE param validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid group ID' });
      return;
    }

    const body_result = update_group_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('GROUP/UPDATE body validation failed', { request_id: req.request_id, issues: body_result.error.issues });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const group = await update_group(param_result.data.id, body_result.data);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    logger.info('group updated', { request_id: req.request_id, group_id: param_result.data.id });
    res.json({ group });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error('GROUP/UPDATE unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete group
router.delete('/groups/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('GROUP/DELETE validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid group ID' });
      return;
    }

    const deleted = await delete_group(param_result.data.id);
    if (!deleted) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    logger.info('group deleted', { request_id: req.request_id, group_id: param_result.data.id });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error('GROUP/DELETE unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add contact to group
router.post('/contacts/:contactId/groups', require_auth, async (req, res) => {
  try {
    const param_result = contact_id_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('GROUP/ADD_CONTACT param validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const body_result = add_contact_to_group_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('GROUP/ADD_CONTACT body validation failed', { request_id: req.request_id, issues: body_result.error.issues });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    await add_contact_to_group(param_result.data.contactId, body_result.data.group_id);
    logger.info('contact added to group', { request_id: req.request_id, contact_id: param_result.data.contactId, group_id: body_result.data.group_id });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    logger.error('GROUP/ADD_CONTACT unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove contact from group
router.delete('/contacts/:contactId/groups/:groupId', require_auth, async (req, res) => {
  try {
    const param_result = contact_group_params_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('GROUP/REMOVE_CONTACT validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }

    const removed = await remove_contact_from_group(param_result.data.contactId, param_result.data.groupId);
    if (!removed) {
      res.status(404).json({ error: 'Contact not in group' });
      return;
    }

    logger.info('contact removed from group', { request_id: req.request_id, contact_id: param_result.data.contactId, group_id: param_result.data.groupId });
    res.json({ success: true });
  } catch (err) {
    logger.error('GROUP/REMOVE_CONTACT unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
