import { Router } from 'express';
import { require_auth } from '../middleware/auth.js';
import { query } from '../db/index.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.get('/dashboard', require_auth, async (req, res) => {
  try {
    // Get stats in parallel
    const [contacts_result, followups_result, communications_result, activity_result] =
      await Promise.all([
        query<{ count: string }>('SELECT COUNT(*) as count FROM contacts WHERE deleted_at IS NULL'),
        query<{ count: string }>(
          'SELECT COUNT(*) as count FROM followups WHERE completed = false'
        ),
        query<{ count: string }>(
          "SELECT COUNT(*) as count FROM communications WHERE timestamp > NOW() - INTERVAL '7 days'"
        ),
        query<{
          id: string;
          type: string;
          contact_id: string;
          contact_name: string;
          description: string;
          timestamp: string;
        }>(`
          SELECT
            comm.id,
            'communication' as type,
            comm.contact_id,
            c.display_name as contact_name,
            CASE
              WHEN comm.subject IS NOT NULL THEN comm.subject
              ELSE LEFT(comm.content, 100)
            END as description,
            comm.timestamp::text as timestamp
          FROM communications comm
          JOIN contacts c ON c.id = comm.contact_id
          WHERE c.deleted_at IS NULL
          ORDER BY comm.timestamp DESC
          LIMIT 10
        `),
      ]);

    res.json({
      stats: {
        total_contacts: parseInt(contacts_result.rows[0].count, 10),
        pending_followups: parseInt(followups_result.rows[0].count, 10),
        recent_communications: parseInt(communications_result.rows[0].count, 10),
      },
      recent_activity: activity_result.rows,
    });
  } catch (err) {
    logger.error('dashboard unexpected error', {
      request_id: req.request_id,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
