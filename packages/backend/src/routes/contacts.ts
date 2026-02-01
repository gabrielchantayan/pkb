import { Router } from 'express';
import { require_auth } from '../middleware/auth.js';
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
      res.status(400).json({ error: 'Invalid query parameters', details: query_result.error.issues });
      return;
    }

    const result = await list_contacts(query_result.data);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get duplicate suggestions
router.get('/contacts/duplicates', require_auth, async (_req, res) => {
  try {
    const duplicates = await find_duplicates();
    res.json({ duplicates });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get contact detail
router.get('/contacts/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const contact_detail = await get_contact(param_result.data.id);
    if (!contact_detail) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json(contact_detail);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create contact
router.post('/contacts', require_auth, async (req, res) => {
  try {
    const body_result = create_contact_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const contact = await create_contact(body_result.data);
    res.status(201).json({ contact });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update contact
router.put('/contacts/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const body_result = update_contact_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const contact = await update_contact(param_result.data.id, body_result.data);
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json({ contact });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete contact (soft delete)
router.delete('/contacts/:id', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const deleted = await delete_contact(param_result.data.id);
    if (!deleted) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Star/unstar contact
router.post('/contacts/:id/star', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const body_result = star_contact_schema.safeParse(req.body);
    if (!body_result.success) {
      res.status(400).json({ error: 'Invalid request body', details: body_result.error.issues });
      return;
    }

    const contact = await star_contact(param_result.data.id, body_result.data.starred);
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json({ contact });
  } catch {
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
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Merge contacts
router.post('/contacts/:id/merge', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const body_result = merge_contact_schema.safeParse(req.body);
    if (!body_result.success) {
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

    res.json({ contact });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get contact identifiers
router.get('/contacts/:id/identifiers', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const identifiers = await get_identifiers(param_result.data.id);
    res.json({ identifiers });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add identifier to contact
router.post('/contacts/:id/identifiers', require_auth, async (req, res) => {
  try {
    const param_result = uuid_param_schema.safeParse(req.params);
    if (!param_result.success) {
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }

    const body_result = add_identifier_schema.safeParse(req.body);
    if (!body_result.success) {
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

    res.status(201).json({ identifier });
  } catch (error) {
    if (error instanceof IdentifierConflictError) {
      res.status(409).json({
        error: error.message,
        existingContactId: error.existing_contact_id,
      });
      return;
    }
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
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }

    const removed = await remove_identifier(id_result.data.id, identifier_id_result.data.id);
    if (!removed) {
      res.status(404).json({ error: 'Identifier not found' });
      return;
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
