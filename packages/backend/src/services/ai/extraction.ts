import { generate_with_flash } from './gemini.js';
import { create_extracted_fact, type ExtractedFactInput } from '../facts.js';
import { create_content_detected_followup } from '../followups.js';
import { logger } from '../../lib/logger.js';

const EXTRACTION_PROMPT = `
You are extracting facts about a person from a message. The message is from/to the contact.

Extract any facts mentioned about the contact. Return JSON only.

Fact types to look for:
- birthday (extract date if mentioned, format: YYYY-MM-DD)
- location (city, state, country)
- job_title
- company
- spouse (name)
- child (name, age if mentioned)
- parent (name)
- sibling (name)
- friend (name)
- colleague (name)
- how_we_met (if they describe how you met)
- custom (any other notable fact)

Also detect action items/follow-ups:
- Promises made ("I'll send you...", "Let me check on that")
- Meeting requests ("Let's catch up next week")
- Deadlines ("by Friday", "before the end of the month")

Message:
"""
{content}
"""

Contact name: {contact_name}
Message direction: {direction}

Respond with JSON only:
{
  "facts": [
    {
      "fact_type": "string",
      "value": "human readable value",
      "structured_value": { ... } or null,
      "confidence": 0.0-1.0
    }
  ],
  "followups": [
    {
      "reason": "what needs to be done",
      "suggested_date": "YYYY-MM-DD"
    }
  ]
}

Only include facts with confidence > 0.6. If no facts found, return empty arrays.
`;

export interface ExtractedFact {
  fact_type: string;
  value: string;
  structured_value?: Record<string, unknown> | null;
  confidence: number;
}

export interface ExtractedFollowup {
  reason: string;
  suggested_date: string;
}

export interface ExtractionResult {
  facts: ExtractedFact[];
  followups: ExtractedFollowup[];
}

export interface CreatedExtractionResult {
  facts: Awaited<ReturnType<typeof create_extracted_fact>>[];
  followups: Awaited<ReturnType<typeof create_content_detected_followup>>[];
}

function parse_extraction_response(response: string): ExtractionResult {
  // Try to extract JSON from the response
  const json_match = response.match(/\{[\s\S]*\}/);
  if (!json_match) {
    return { facts: [], followups: [] };
  }

  try {
    const parsed = JSON.parse(json_match[0]);
    return {
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      followups: Array.isArray(parsed.followups) ? parsed.followups : [],
    };
  } catch {
    return { facts: [], followups: [] };
  }
}

export async function extract_from_text(
  content: string,
  contact_name: string,
  direction: string
): Promise<ExtractionResult> {
  const prompt = EXTRACTION_PROMPT
    .replace('{content}', content)
    .replace('{contact_name}', contact_name)
    .replace('{direction}', direction);

  try {
    const response = await generate_with_flash(prompt);
    return parse_extraction_response(response);
  } catch (error) {
    logger.error('Extraction failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { facts: [], followups: [] };
  }
}

export async function extract_from_communication(
  communication_id: string,
  content: string,
  contact_id: string,
  contact_name: string,
  direction: string
): Promise<CreatedExtractionResult> {
  const extraction = await extract_from_text(content, contact_name, direction);

  const created_facts: Awaited<ReturnType<typeof create_extracted_fact>>[] = [];
  const created_followups: Awaited<ReturnType<typeof create_content_detected_followup>>[] = [];

  // Create facts
  for (const fact of extraction.facts) {
    if (fact.confidence < 0.6) continue;

    try {
      const fact_input: ExtractedFactInput = {
        contact_id,
        fact_type: fact.fact_type,
        value: fact.value,
        structured_value: fact.structured_value ?? undefined,
        confidence: fact.confidence,
      };

      const created = await create_extracted_fact(communication_id, fact_input);
      created_facts.push(created);
    } catch (error) {
      logger.error('Failed to create extracted fact', {
        error: error instanceof Error ? error.message : 'Unknown error',
        fact_type: fact.fact_type,
      });
    }
  }

  // Create follow-ups
  for (const followup of extraction.followups) {
    try {
      const created = await create_content_detected_followup(
        contact_id,
        communication_id,
        followup.reason,
        followup.suggested_date
      );
      if (created) {
        created_followups.push(created);
      }
    } catch (error) {
      logger.error('Failed to create followup', {
        error: error instanceof Error ? error.message : 'Unknown error',
        reason: followup.reason,
      });
    }
  }

  return { facts: created_facts, followups: created_followups };
}
