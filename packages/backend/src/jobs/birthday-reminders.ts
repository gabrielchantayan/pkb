import { generate_birthday_reminders } from '../services/followups.js';
import { close_pool } from '../db/index.js';
import { logger } from '../lib/logger.js';

async function run(): Promise<void> {
  logger.info('Starting birthday reminders job');

  try {
    const count = await generate_birthday_reminders();
    logger.info('Birthday reminders job completed', { created: count });
  } catch (error) {
    logger.error('Birthday reminders job failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  } finally {
    await close_pool();
  }
}

run();
