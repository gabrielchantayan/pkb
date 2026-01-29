import express from 'express';
import cookie_parser from 'cookie-parser';
import { logging_middleware } from './middleware/logging.js';
import { error_middleware } from './middleware/error.js';
import health_router from './routes/health.js';
import auth_router from './routes/auth.js';
import apikeys_router from './routes/apikeys.js';
import contacts_router from './routes/contacts.js';
import communications_router from './routes/communications.js';
import facts_router from './routes/facts.js';
import notes_router from './routes/notes.js';
import followups_router from './routes/followups.js';
import tags_router from './routes/tags.js';
import groups_router from './routes/groups.js';
import smartlists_router from './routes/smartlists.js';
import sync_router from './routes/sync.js';

export function create_app(): express.Application {
  const app = express();

  app.use(express.json());
  app.use(cookie_parser());
  app.use(logging_middleware);

  // Public routes
  app.use('/api', health_router);

  // Auth routes
  app.use('/api', auth_router);
  app.use('/api', apikeys_router);

  // Contact routes
  app.use('/api', contacts_router);

  // Communication routes
  app.use('/api', communications_router);

  // Fact routes
  app.use('/api', facts_router);

  // Notes routes
  app.use('/api', notes_router);

  // Followups routes
  app.use('/api', followups_router);

  // Tags routes
  app.use('/api', tags_router);

  // Groups routes
  app.use('/api', groups_router);

  // Smart lists routes
  app.use('/api', smartlists_router);

  // Daemon sync routes
  app.use('/api', sync_router);

  app.use(error_middleware);

  return app;
}
