import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function get_pool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.database_url,
    });

    pool.on('error', (err) => {
      logger.error('database pool error', { error: err.message });
    });
  }
  return pool;
}

export async function close_pool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  const result = await get_pool().query<T>(text, params);
  const duration_ms = Date.now() - start;

  logger.debug('query executed', {
    query: text.substring(0, 100),
    rows: result.rowCount,
    duration_ms,
  });

  return result;
}
