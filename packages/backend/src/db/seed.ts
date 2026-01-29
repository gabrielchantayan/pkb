import { get_pool, close_pool } from './index.js';
import { hash_password } from '../lib/auth.js';
import { logger } from '../lib/logger.js';

async function seed_initial_user(): Promise<void> {
  const email = process.env.ADMIN_EMAIL || 'admin@localhost';
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    logger.error('ADMIN_PASSWORD environment variable required for seeding');
    process.exit(1);
  }

  const pool = get_pool();

  // Check if user already exists
  const existing = await pool.query('SELECT id FROM users LIMIT 1');
  if (existing.rows.length > 0) {
    logger.info('User already exists, skipping seed');
    return;
  }

  const password_hash = await hash_password(password);

  await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2)',
    [email, password_hash]
  );

  logger.info('Created initial user', { email });
}

async function main(): Promise<void> {
  try {
    await seed_initial_user();
  } catch (error) {
    logger.error('Seed failed', { error: String(error) });
    process.exit(1);
  } finally {
    await close_pool();
  }
}

main();
