import { Router } from 'express';
import { get_pool } from '../db/index.js';

const router = Router();

router.get('/health', async (_req, res) => {
  try {
    const pool = get_pool();
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

export default router;
