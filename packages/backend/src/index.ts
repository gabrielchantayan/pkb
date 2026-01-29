import { create_app } from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { close_pool } from './db/index.js';

const app = create_app();

const server = app.listen(config.port, () => {
  logger.info('server started', {
    port: config.port,
    node_env: config.node_env,
  });
});

function shutdown(): void {
  logger.info('shutting down');
  server.close(async () => {
    await close_pool();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
