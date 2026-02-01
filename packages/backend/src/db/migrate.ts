import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { get_pool, close_pool } from './index.js';
import { logger } from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function ensure_migrations_table(): Promise<void> {
  const pool = get_pool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function get_applied_migrations(): Promise<Set<string>> {
  const pool = get_pool();
  const result = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY id'
  );
  return new Set(result.rows.map((row) => row.filename));
}

async function get_pending_migrations(applied: Set<string>): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith('.sql') && !applied.has(f))
    .sort();
}

async function run_migration(filename: string): Promise<void> {
  const pool = get_pool();
  const filepath = join(MIGRATIONS_DIR, filename);
  const sql = await readFile(filepath, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [filename]
    );
    await client.query('COMMIT');
    logger.info('migration applied', { filename });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function run_migrations(): Promise<void> {
  logger.info('starting migrations');

  await ensure_migrations_table();
  const applied = await get_applied_migrations();
  const pending = await get_pending_migrations(applied);

  if (pending.length === 0) {
    logger.info('no pending migrations');
    return;
  }

  logger.info('pending migrations', { count: pending.length, files: pending });

  for (const filename of pending) {
    await run_migration(filename);
  }

  logger.info('migrations complete', { applied: pending.length });
}

// Run directly if this is the main module
const is_main = process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js');
if (is_main) {
  run_migrations()
    .then(() => close_pool())
    .catch((err) => {
      logger.error('migration failed', { error: err.message, stack: err.stack });
      process.exit(1);
    });
}
