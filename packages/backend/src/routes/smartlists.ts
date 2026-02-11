import { Router } from 'express';
import { require_auth } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import {
  list_smart_lists,
  get_smart_list,
  get_smart_list_contacts,
  create_smart_list,
  update_smart_list,
  delete_smart_list,
  NotFoundError,
} from '../services/smartlists.js';
import {
  create_smart_list_schema,
  update_smart_list_schema,
  uuid_param_schema,
  smart_list_contacts_query_schema,
} from '../schemas/organization.js';

const router = Router();

// List all smart lists
router.get('/smartlists', require_auth, async (req, res) => {
  try {
    const smartLists = await list_smart_lists();
    res.json({ smartLists });
  } catch (err) {
    logger.error('smartlists/list unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single smart list
router.get('/smartlists/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('smartlists/get validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid smart list ID' });
      return;
    }

    const smartList = await get_smart_list(param_result.data.id);
    if (!smartList) {
      res.status(404).json({ error: 'Smart list not found' });
      return;
    }

    res.json({ smartList });
  } catch (err) {
    logger.error('smartlists/get unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get contacts matching smart list
router.get('/smartlists/:id/contacts', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('smartlists/contacts validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid smart list ID' });
      return;
    }

    const query_result = smart_list_contacts_query_schema.safeParse(req.query);
    if (!query_result.success) {
      logger.warn('smartlists/contacts query validation failed', { request_id: req.request_id, issues: query_result.error.issues });
      res.status(400).json({ error: 'Invalid query parameters', details: query_result.error.issues });
      return;
    }

    const result = await get_smart_list_contacts(param_result.data.id, query_result.data);
    res.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    logger.error('smartlists/contacts unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create smart list
router.post('/smartlists', require_auth, async (req, res) => {
  try {
    const body_result = create_smart_list_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('smartlists/create validation failed', { request_id: req.request_id, issues: body_result.error.issues });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const smartList = await create_smart_list(body_result.data);
    logger.info('smart list created', { request_id: req.request_id, smart_list_id: smartList.id });
    res.status(201).json({ smartList });
  } catch (err) {
    logger.error('smartlists/create unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update smart list
router.put('/smartlists/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('smartlists/update validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid smart list ID' });
      return;
    }

    const body_result = update_smart_list_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('smartlists/update body validation failed', { request_id: req.request_id, issues: body_result.error.issues });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const smartList = await update_smart_list(param_result.data.id, body_result.data);
    if (!smartList) {
      res.status(404).json({ error: 'Smart list not found' });
      return;
    }

    logger.info('smart list updated', { request_id: req.request_id, smart_list_id: param_result.data.id });
    res.json({ smartList });
  } catch (err) {
    logger.error('smartlists/update unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete smart list
router.delete('/smartlists/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('smartlists/delete validation failed', { request_id: req.request_id, issues: param_result.error.issues });
      res.status(400).json({ error: 'Invalid smart list ID' });
      return;
    }

    const deleted = await delete_smart_list(param_result.data.id);
    if (!deleted) {
      res.status(404).json({ error: 'Smart list not found' });
      return;
    }

    logger.info('smart list deleted', { request_id: req.request_id, smart_list_id: param_result.data.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('smartlists/delete unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
