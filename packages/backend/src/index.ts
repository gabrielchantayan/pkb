import { create_app } from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { close_pool } from './db/index.js';
import { run_migrations } from './db/migrate.js';
import { is_ai_available } from './services/ai/gemini.js';
import { start_frf_cron, stop_frf_cron } from './jobs/frf-cron.js';

async function main(): Promise<void> {
  // Run migrations before starting the server
  await run_migrations();

  const app = create_app();

  const server = app.listen(config.port, () => {
    logger.info('server started', {
      port: config.port,
      node_env: config.node_env,
    });

    if (is_ai_available()) {
      start_frf_cron();
    }
  });

  function shutdown(): void {
    logger.info('shutting down');
    stop_frf_cron();
    server.close(async () => {
      await close_pool();
      process.exit(0);
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error('startup failed', { error: err.message, stack: err.stack });
  process.exit(1);
});

