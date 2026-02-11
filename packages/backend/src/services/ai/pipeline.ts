import { query } from '../../db/index.js';
import { queue_for_embedding } from './embeddings.js';
import { analyze_communication_sentiment, update_contact_sentiment_trend } from './sentiment.js';
import { is_ai_available } from './gemini.js';
import { logger } from '../../lib/logger.js';

const MIN_CONTENT_LENGTH = 20;

interface CommunicationWithContact {
  id: string;
  content: string;
  contact_id: string;
  contact_name: string;
  direction: string;
}

/**
 * Process new communications for sentiment analysis and embedding generation.
 * FRF extraction is handled separately by the cron pipeline (frf-cron.ts).
 */
export async function process_communications(communication_ids: string[]): Promise<void> {
  if (!is_ai_available()) {
    logger.debug('AI not available, skipping communication processing');
    return;
  }

  for (const id of communication_ids) {
    try {
      const comm_result = await query<CommunicationWithContact>(
        `SELECT cm.id, cm.content, cm.contact_id, cm.direction, c.display_name as contact_name
         FROM communications cm
         JOIN contacts c ON c.id = cm.contact_id
         WHERE cm.id = $1`,
        [id]
      );

      if (!comm_result.rows[0]) continue;

      const { content, contact_id } = comm_result.rows[0];

      if (content.length < MIN_CONTENT_LENGTH) continue;

      // Sentiment analysis (async, don't await)
      analyze_communication_sentiment(id, content)
        .then(() => {
          if (contact_id) {
            return update_contact_sentiment_trend(contact_id);
          }
        })
        .catch((error) => {
          logger.error('Sentiment analysis error for communication', {
            communication_id: id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });

      // Queue for embedding generation
      queue_for_embedding(id);
    } catch (error) {
      logger.error('Failed to process communication', {
        communication_id: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

