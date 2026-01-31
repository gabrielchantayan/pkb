import { generate_with_flash } from './gemini.js';
import { query } from '../../db/index.js';
import { logger } from '../../lib/logger.js';

const SENTIMENT_PROMPT = `
Analyze the sentiment of the following message. Consider the overall emotional tone, word choice, and context.

Message:
"""
{content}
"""

Respond with JSON only:
{
  "sentiment": "positive" | "negative" | "neutral",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of why this sentiment was detected"
}

Guidelines:
- "positive": Happy, grateful, excited, friendly, encouraging, enthusiastic
- "negative": Angry, frustrated, sad, disappointed, critical, complaining
- "neutral": Informational, factual, routine, neither positive nor negative
- Confidence should reflect how certain you are (0.5 = uncertain, 1.0 = very certain)
- Short messages with ambiguous tone should have lower confidence
`;

export type Sentiment = 'positive' | 'negative' | 'neutral';

export interface SentimentResult {
  sentiment: Sentiment;
  confidence: number;
  reasoning?: string;
}

function parse_sentiment_response(response: string): SentimentResult | null {
  // Try to extract JSON from the response
  const json_match = response.match(/\{[\s\S]*\}/);
  if (!json_match) {
    return null;
  }

  try {
    const parsed = JSON.parse(json_match[0]);

    // Validate sentiment value
    const valid_sentiments: Sentiment[] = ['positive', 'negative', 'neutral'];
    if (!valid_sentiments.includes(parsed.sentiment)) {
      return null;
    }

    // Validate confidence is a number between 0 and 1
    const confidence = Number(parsed.confidence);
    if (isNaN(confidence) || confidence < 0 || confidence > 1) {
      return null;
    }

    return {
      sentiment: parsed.sentiment as Sentiment,
      confidence,
      reasoning: parsed.reasoning,
    };
  } catch {
    return null;
  }
}

/**
 * Analyze the sentiment of a text string
 */
export async function analyze_sentiment(content: string): Promise<SentimentResult | null> {
  const prompt = SENTIMENT_PROMPT.replace('{content}', content);

  try {
    const response = await generate_with_flash(prompt);
    return parse_sentiment_response(response);
  } catch (error) {
    logger.error('Sentiment analysis failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Analyze sentiment and store the result for a communication
 */
export async function analyze_communication_sentiment(
  communication_id: string,
  content: string
): Promise<SentimentResult | null> {
  const result = await analyze_sentiment(content);

  if (result && result.confidence >= 0.6) {
    try {
      await query(
        `UPDATE communications SET sentiment = $1 WHERE id = $2`,
        [result.sentiment, communication_id]
      );

      logger.debug('Sentiment stored for communication', {
        communication_id,
        sentiment: result.sentiment,
        confidence: result.confidence,
      });
    } catch (error) {
      logger.error('Failed to store sentiment for communication', {
        communication_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return result;
}

/**
 * Update the sentiment trend for a contact based on recent communications
 */
export async function update_contact_sentiment_trend(contact_id: string): Promise<void> {
  try {
    // Get the sentiment distribution from recent communications (last 30 days)
    const result = await query<{ sentiment: Sentiment; count: string }>(
      `SELECT sentiment, COUNT(*) as count
       FROM communications
       WHERE contact_id = $1
         AND sentiment IS NOT NULL
         AND timestamp > NOW() - INTERVAL '30 days'
       GROUP BY sentiment
       ORDER BY count DESC`,
      [contact_id]
    );

    if (result.rows.length === 0) {
      return;
    }

    // Calculate weighted sentiment
    const counts: Record<Sentiment, number> = {
      positive: 0,
      negative: 0,
      neutral: 0,
    };

    let total = 0;
    for (const row of result.rows) {
      const count = parseInt(row.count, 10);
      counts[row.sentiment] = count;
      total += count;
    }

    // Determine overall trend
    // If positive is dominant (> 50% more than negative), trend is positive
    // If negative is dominant (> 50% more than positive), trend is negative
    // Otherwise, neutral
    let sentiment_trend: Sentiment = 'neutral';

    if (counts.positive > counts.negative * 1.5) {
      sentiment_trend = 'positive';
    } else if (counts.negative > counts.positive * 1.5) {
      sentiment_trend = 'negative';
    }

    await query(
      `UPDATE contacts SET sentiment_trend = $1, updated_at = NOW() WHERE id = $2`,
      [sentiment_trend, contact_id]
    );

    logger.debug('Updated contact sentiment trend', {
      contact_id,
      sentiment_trend,
      counts,
    });
  } catch (error) {
    logger.error('Failed to update contact sentiment trend', {
      contact_id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Backfill sentiment for communications that don't have it
 */
export async function backfill_sentiment(limit: number = 100): Promise<{
  processed: number;
  updated: number;
}> {
  const result = await query<{ id: string; content: string; contact_id: string }>(
    `SELECT id, content, contact_id
     FROM communications
     WHERE sentiment IS NULL
       AND content IS NOT NULL
       AND LENGTH(content) >= 20
     ORDER BY timestamp DESC
     LIMIT $1`,
    [limit]
  );

  let updated = 0;
  const contact_ids = new Set<string>();

  for (const row of result.rows) {
    const sentiment_result = await analyze_communication_sentiment(row.id, row.content);
    if (sentiment_result) {
      updated++;
      if (row.contact_id) {
        contact_ids.add(row.contact_id);
      }
    }

    // Rate limiting - wait 100ms between API calls
    await new Promise((r) => setTimeout(r, 100));
  }

  // Update sentiment trends for affected contacts
  for (const contact_id of contact_ids) {
    await update_contact_sentiment_trend(contact_id);
  }

  return {
    processed: result.rows.length,
    updated,
  };
}
