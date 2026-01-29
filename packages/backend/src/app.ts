import express from 'express';
import { logging_middleware } from './middleware/logging.js';
import { error_middleware } from './middleware/error.js';
import health_router from './routes/health.js';

export function create_app(): express.Application {
  const app = express();

  app.use(express.json());
  app.use(logging_middleware);

  app.use('/api', health_router);

  app.use(error_middleware);

  return app;
}
