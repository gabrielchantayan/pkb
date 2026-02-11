import { Router } from 'express';
import { get_pool } from '../db/index.js';
import { verify_password, generate_session_token } from '../lib/auth.js';
import { require_session } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const router = Router();

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    logger.warn('login failed: missing credentials', { request_id: req.request_id, has_email: !!email, has_password: !!password });
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  try {
    const pool = get_pool();
    const user_result = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email]
    );

    if (user_result.rows.length === 0) {
      logger.warn('login failed: unknown user', { request_id: req.request_id, email });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = user_result.rows[0];
    const valid = await verify_password(password, user.password_hash);

    if (!valid) {
      logger.warn('login failed: bad password', { request_id: req.request_id, email });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = generate_session_token();
    const expires_at = new Date(Date.now() + SESSION_DURATION_MS);

    await pool.query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expires_at]
    );

    res.cookie('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expires_at,
    });

    logger.info('login successful', { request_id: req.request_id, user_id: user.id, email: user.email });
    res.json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    logger.error('login unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/auth/logout', require_session, async (req, res) => {
  const token = req.cookies?.session;

  if (token) {
    try {
      const pool = get_pool();
      await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    } catch (err) {
      logger.error('logout: session cleanup error', {
        request_id: req.request_id,
        error: String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  logger.info('logout', { request_id: req.request_id, user_id: req.user_id });
  res.clearCookie('session');
  res.json({ success: true });
});

router.get('/auth/me', require_session, async (req, res) => {
  try {
    const pool = get_pool();
    const result = await pool.query(
      'SELECT id, email FROM users WHERE id = $1',
      [req.user_id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error('auth/me unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
