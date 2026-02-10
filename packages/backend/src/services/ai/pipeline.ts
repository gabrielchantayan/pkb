import { query } from '../../db/index.js';
import { extract_from_communication } from './extraction.js';
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

// Called after batch upsert completes to process new communications
export async function process_communications(communication_ids: string[]): Promise<void> {
  if (!is_ai_available()) {
    logger.debug('AI not available, skipping communication processing');
    return;
  }

  for (const id of communication_ids) {
    try {
      // Get communication with contact info
      const comm_result = await query<CommunicationWithContact>(
        `SELECT cm.id, cm.content, cm.contact_id, cm.direction, c.display_name as contact_name
         FROM communications cm
         JOIN contacts c ON c.id = cm.contact_id
         WHERE cm.id = $1`,
        [id]
      );

      if (!comm_result.rows[0]) continue;

      const { content, contact_id, contact_name, direction } = comm_result.rows[0];

      // Skip very short messages
      if (content.length < MIN_CONTENT_LENGTH) continue;

      // Extract facts and followups (async, don't await)
      extract_from_communication(
        id,
        content,
        contact_id,
        contact_name || 'Unknown',
        direction || 'unknown'
      ).catch((error) => {
        logger.error('Extraction error for communication', {
          communication_id: id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });

      // Analyze sentiment (async, don't await)
      analyze_communication_sentiment(id, content)
        .then(() => {
          // Update contact sentiment trend after analyzing this communication
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

// Process a single communication synchronously (for testing/manual use)
export async function process_single_communication(communication_id: string): Promise<{
  facts_created: number;
  relationships_created: number;
  followups_created: number;
  embedding_queued: boolean;
  sentiment_analyzed: boolean;
}> {
  const comm_result = await query<CommunicationWithContact>(
    `SELECT cm.id, cm.content, cm.contact_id, cm.direction, c.display_name as contact_name
     FROM communications cm
     JOIN contacts c ON c.id = cm.contact_id
     WHERE cm.id = $1`,
    [communication_id]
  );

  if (!comm_result.rows[0]) {
    throw new Error('Communication not found');
  }

  const { content, contact_id, contact_name, direction } = comm_result.rows[0];

  if (content.length < MIN_CONTENT_LENGTH) {
    return { facts_created: 0, relationships_created: 0, followups_created: 0, embedding_queued: false, sentiment_analyzed: false };
  }

  const result = await extract_from_communication(
    communication_id,
    content,
    contact_id,
    contact_name || 'Unknown',
    direction || 'unknown'
  );

  // Analyze sentiment
  const sentiment_result = await analyze_communication_sentiment(communication_id, content);

  // Update contact sentiment trend
  if (contact_id && sentiment_result) {
    await update_contact_sentiment_trend(contact_id);
  }

  queue_for_embedding(communication_id);

  return {
    facts_created: result.facts.length,
    relationships_created: result.relationships.length,
    followups_created: result.followups.length,
    embedding_queued: true,
    sentiment_analyzed: sentiment_result !== null,
  };
}
