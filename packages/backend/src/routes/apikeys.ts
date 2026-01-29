import { Router } from 'express';
import { get_pool } from '../db/index.js';
import { generate_api_key, hash_api_key } from '../lib/auth.js';
import { require_session } from '../middleware/auth.js';

const router = Router();

router.post('/auth/api-keys', require_session, async (req, res) => {
  const { name } = req.body;

  if (!name) {
    res.status(400).json({ error: 'Name required' });
    return;
  }

  try {
    const pool = get_pool();
    const raw_key = generate_api_key();
    const key_hash = hash_api_key(raw_key);

    await pool.query(
      'INSERT INTO api_keys (name, key_hash) VALUES ($1, $2)',
      [name, key_hash]
    );

    // Raw key is only returned once at creation time
    res.json({ api_key: raw_key, name });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/auth/api-keys', require_session, async (req, res) => {
  try {
    const pool = get_pool();
    const result = await pool.query(
      'SELECT id, name, last_used_at, created_at FROM api_keys ORDER BY created_at DESC'
    );

    res.json({ api_keys: result.rows });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/auth/api-keys/:id', require_session, async (req, res) => {
  const { id } = req.params;

  try {
    const pool = get_pool();
    const result = await pool.query(
      'DELETE FROM api_keys WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
