import { Router } from 'express';
import { require_auth } from '../middleware/auth.js';
import { query } from '../db/index.js';
import { logger } from '../lib/logger.js';
import {
  list_contacts,
  get_contact,
  create_contact,
  update_contact,
  delete_contact,
  star_contact,
  find_duplicates,
  merge_contacts,
  get_merge_preview,
} from '../services/contacts.js';
import {
  add_identifier,
  remove_identifier,
  get_identifiers,
  IdentifierConflictError,
} from '../services/identifiers.js';
import {
  create_contact_schema,
  update_contact_schema,
  star_contact_schema,
  merge_contact_schema,
  list_contacts_query_schema,
  add_identifier_schema,
  uuid_param_schema,
} from '../schemas/contacts.js';

const router = Router();

// List contacts with filtering and pagination
router.get('/contacts', require_auth, async (req, res) => {
  try {
    const query_result = list_contacts_query_schema.safeParse(req.query);
    if (!query_result.success) {
      logger.warn('contacts/list validation failed', {
        request_id: req.request_id,
        error_count: query_result.error.issues.length,
        issues: query_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid query parameters', details: query_result.error.issues });
      return;
    }

    const result = await list_contacts(query_result.data);
    res.json(result);
  } catch (err) {
    logger.error('contacts/list unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get duplicate suggestions
router.get('/contacts/duplicates', require_auth, async (req, res) => {
  try {
    const duplicates = await find_duplicates();
    res.json({ duplicates });
  } catch (err) {
    logger.error('contacts/duplicates unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get processing status for a contact
router.get('/contacts/:id/processing-status', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const result = await query<{ pending_count: string; last_processed: string | null }>(
      `SELECT
        COUNT(*) FILTER (WHERE frf_processed_at IS NULL) AS pending_count,
        MAX(frf_processed_at)::text AS last_processed
       FROM communications
       WHERE contact_id = $1`,
      [param_result.data.id]
    );

    const row = result.rows[0];
    res.json({
      pending_count: parseInt(row.pending_count, 10),
      last_processed: row.last_processed,
    });
  } catch (err) {
    logger.error('contacts/processing-status unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get contact detail
router.get('/contacts/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('contacts/get validation failed', {
        request_id: req.request_id,
        error_count: param_result.error.issues.length,
        issues: param_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const contact_detail = await get_contact(param_result.data.id);
    if (!contact_detail) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json(contact_detail);
  } catch (err) {
    logger.error('contacts/get unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create contact
router.post('/contacts', require_auth, async (req, res) => {
  try {
    const body_result = create_contact_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('contacts/create validation failed', {
        request_id: req.request_id,
        error_count: body_result.error.issues.length,
        issues: body_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const contact = await create_contact(body_result.data);
    logger.info('contact created', { request_id: req.request_id, contact_id: contact.id });
    res.status(201).json({ contact });
  } catch (err) {
    logger.error('contacts/create unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update contact
router.put('/contacts/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('contacts/update validation failed', {
        request_id: req.request_id,
        error_count: param_result.error.issues.length,
        issues: param_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const body_result = update_contact_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('contacts/update validation failed', {
        request_id: req.request_id,
        error_count: body_result.error.issues.length,
        issues: body_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const contact = await update_contact(param_result.data.id, body_result.data);
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    logger.info('contact updated', { request_id: req.request_id, contact_id: param_result.data.id });
    res.json({ contact });
  } catch (err) {
    logger.error('contacts/update unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete contact (soft delete)
router.delete('/contacts/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('contacts/delete validation failed', {
        request_id: req.request_id,
        error_count: param_result.error.issues.length,
        issues: param_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const deleted = await delete_contact(param_result.data.id);
    if (!deleted) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    logger.info('contact deleted', { request_id: req.request_id, contact_id: param_result.data.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('contacts/delete unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Star/unstar contact
router.post('/contacts/:id/star', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('contacts/star validation failed', {
        request_id: req.request_id,
        error_count: param_result.error.issues.length,
        issues: param_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const body_result = star_contact_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('contacts/star validation failed', {
        request_id: req.request_id,
        error_count: body_result.error.issues.length,
        issues: body_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const contact = await star_contact(param_result.data.id, body_result.data.starred);
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    logger.info('contact starred', { request_id: req.request_id, contact_id: param_result.data.id, starred: body_result.data.starred });
    res.json({ contact });
  } catch (err) {
    logger.error('contacts/star unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get merge preview
router.get('/contacts/:id/merge-preview/:sourceId', require_auth, async (req, res) => {
  try {
    const { id, sourceId } = req.params;

    const id_result = uuid_param_schema.safeParse({ id });
    const source_id_result = uuid_param_schema.safeParse({ id: sourceId });

    if (!id_result.success || !source_id_result.success) {
      const issues = [
        ...(id_result.success ? [] : id_result.error.issues),
        ...(source_id_result.success ? [] : source_id_result.error.issues),
      ];
      logger.warn('contacts/merge-preview validation failed', {
        request_id: req.request_id,
        error_count: issues.length,
        issues: issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    if (id === sourceId) {
      res.status(400).json({ error: 'Cannot preview merge of contact with itself' });
      return;
    }

    const preview = await get_merge_preview(id_result.data.id, source_id_result.data.id);
    if (!preview) {
      res.status(404).json({ error: 'One or both contacts not found' });
      return;
    }

    res.json(preview);
  } catch (err) {
    logger.error('contacts/merge-preview unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Merge contacts
router.post('/contacts/:id/merge', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('contacts/merge validation failed', {
        request_id: req.request_id,
        error_count: param_result.error.issues.length,
        issues: param_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const body_result = merge_contact_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('contacts/merge validation failed', {
        request_id: req.request_id,
        error_count: body_result.error.issues.length,
        issues: body_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    if (param_result.data.id === body_result.data.mergeContactId) {
      res.status(400).json({ error: 'Cannot merge contact with itself' });
      return;
    }

    const contact = await merge_contacts(param_result.data.id, body_result.data.mergeContactId);
    if (!contact) {
      res.status(404).json({ error: 'One or both contacts not found' });
      return;
    }

    logger.info('contacts merged', { request_id: req.request_id, target_id: param_result.data.id, source_id: body_result.data.mergeContactId });
    res.json({ contact });
  } catch (err) {
    logger.error('contacts/merge unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get contact identifiers
router.get('/contacts/:id/identifiers', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('contacts/identifiers/list validation failed', {
        request_id: req.request_id,
        error_count: param_result.error.issues.length,
        issues: param_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const identifiers = await get_identifiers(param_result.data.id);
    res.json({ identifiers });
  } catch (err) {
    logger.error('contacts/identifiers/list unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add identifier to contact
router.post('/contacts/:id/identifiers', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      logger.warn('contacts/identifiers/add validation failed', {
        request_id: req.request_id,
        error_count: param_result.error.issues.length,
        issues: param_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const body_result = add_identifier_schema.safeParse(req.body);
    if (!body_result.success) {
      logger.warn('contacts/identifiers/add validation failed', {
        request_id: req.request_id,
        error_count: body_result.error.issues.length,
        issues: body_result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const identifier = await add_identifier(
      param_result.data.id,
      body_result.data.type,
      body_result.data.value
    );

    if (!identifier) {
      res.status(409).json({ error: 'Identifier already exists for this contact' });
      return;
    }

    logger.info('identifier added', { request_id: req.request_id, contact_id: param_result.data.id });
    res.status(201).json({ identifier });
  } catch (err) {
    if (err instanceof IdentifierConflictError) {
      res.status(409).json({
        error: err.message,
        existingContactId: err.existing_contact_id,
      });
      return;
    }
    logger.error('contacts/identifiers/add unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove identifier from contact
router.delete('/contacts/:id/identifiers/:identifierId', require_auth, async (req, res) => {
  try {
    const { id, identifierId } = req.params;

    const id_result = uuid_param_schema.safeParse({ id });
    const identifier_id_result = uuid_param_schema.safeParse({ id: identifierId });

    if (!id_result.success || !identifier_id_result.success) {
      const issues = [
        ...(id_result.success ? [] : id_result.error.issues),
        ...(identifier_id_result.success ? [] : identifier_id_result.error.issues),
      ];
      logger.warn('contacts/identifiers/remove validation failed', {
        request_id: req.request_id,
        error_count: issues.length,
        issues: issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      });
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }

    const removed = await remove_identifier(id_result.data.id, identifier_id_result.data.id);
    if (!removed) {
      res.status(404).json({ error: 'Identifier not found' });
      return;
    }

    logger.info('identifier removed', { request_id: req.request_id, contact_id: id_result.data.id, identifier_id: identifier_id_result.data.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('contacts/identifiers/remove unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
