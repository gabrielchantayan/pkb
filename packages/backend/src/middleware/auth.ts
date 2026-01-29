import { Request, Response, NextFunction } from 'express';
import { get_pool } from '../db/index.js';
import { hash_api_key } from '../lib/auth.js';

declare global {
  namespace Express {
    interface Request {
      user_id?: string;
    }
  }
}

export async function require_session(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.session || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = get_pool();
    const result = await pool.query(
      'SELECT user_id FROM sessions WHERE token = $1 AND expires_at > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    req.user_id = result.rows[0].user_id;
    next();
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function require_api_key(req: Request, res: Response, next: NextFunction): Promise<void> {
  const api_key = req.headers['x-api-key'] as string | undefined;

  if (!api_key) {
    res.status(401).json({ error: 'API key required' });
    return;
  }

  try {
    const pool = get_pool();
    const key_hash = hash_api_key(api_key);
    const result = await pool.query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1 RETURNING id',
      [key_hash]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    next();
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function require_auth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.headers['x-api-key']) {
    return require_api_key(req, res, next);
  }
  return require_session(req, res, next);
}
