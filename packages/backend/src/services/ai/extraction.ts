import { generate_with_flash, generate_with_flash_json } from './gemini.js';
import { create_extracted_fact, type ExtractedFactInput } from '../facts.js';
import { create_extracted_relationship, type ExtractedRelationshipInput } from '../relationships.js';
import { create_content_detected_followup } from '../followups.js';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';

const EXTRACTION_PROMPT = `
You are extracting facts about a person from a message.

CRITICAL: Only extract facts about the CONTACT, not the user.
- If direction is "inbound", the message is FROM the contact — first-person statements describe the contact.
- If direction is "outbound", the message is FROM the user TO the contact — first-person statements describe the user, NOT the contact. Only extract facts that reveal something about the contact (e.g., "Happy birthday!" → contact's birthday).

Return JSON only.

Fact types to look for:
- birthday (extract date if mentioned, format: YYYY-MM-DD)
- location (city, state, country)
- job_title
- company
- custom (any other notable fact)

Relationships to detect:
- spouse (person name)
- child (person name)
- parent (person name)
- sibling (person name)
- friend (person name)
- colleague (person name)
- boss (person name)
- mentor (person name)
- how_we_met (value is a narrative description, e.g. "Through our running club")

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
  "relationships": [
    {
      "label": "string",
      "person_name": "string",
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

Only include facts and relationships with confidence > 0.6. If none found, return empty arrays.
`;

const BATCH_EXTRACTION_PROMPT = `You are a meticulous personal knowledge base assistant. Your job is to extract meaningful personal facts, relationships, and follow-up items from a batch of messages about a specific contact.

Contact name: {contact_name}

## Quality Mandate

Only extract MEANINGFUL personal details that would be worth remembering about this person long-term. Think: "Would I want to recall this about someone in a future conversation?"

GOOD extractions (extract these):
- "prefers olive oil over butter" → preference
- "switched from Replit to Claude Code" → tool
- "works at Meta (previously Google)" → company
- "training for a marathon" → hobby
- "wants to learn Rust" → goal
- "has a daughter named Emma" → relationship
- "just moved to Portland" → location
- "birthday is March 15th" → birthday
- "strongly believes in open source" → opinion
- "got promoted to senior engineer" → life_event

BAD extractions (do NOT extract these):
- "went to the store" → mundane activity
- "is running late" → transient state
- "had lunch" → trivial daily activity
- "said they're busy" → temporary status
- "asked about the weather" → small talk
- "sent a link" → not a personal fact

It is completely fine and expected to return empty arrays if no meaningful facts, relationships, or follow-ups are found. Quality over quantity.

## Fact Types

Extract facts matching these types:
- birthday: Date of birth (format value as "YYYY-MM-DD" or "Month Day" if year unknown)
- location: Where they live (city, state, country)
- job_title: Current job title or role
- company: Current employer or organization
- email: Email address mentioned
- phone: Phone number mentioned
- preference: Likes, dislikes, preferences (food, style, approach, etc.)
- tool: Software, tools, technologies they use
- hobby: Hobbies, sports, recreational activities
- opinion: Strongly held views, beliefs, stances
- life_event: Major life events (marriage, move, graduation, promotion, etc.)
- goal: Aspirations, plans, things they want to achieve
- custom: Anything notable that doesn't fit the above

## Relationships

Extract relationships using free-form labels. Common labels include: spouse, partner, child, parent, sibling, friend, colleague, boss, mentor, roommate, ex, client, neighbor, teacher, student, doctor, therapist, how_we_met — but use whatever label best describes the relationship.

## Follow-ups

Extract action items, promises, or things that need follow-through:
- Promises made ("I'll send you...", "Let me check on that")
- Meeting requests ("Let's catch up next week")
- Deadlines ("by Friday", "before the end of the month")
- Format suggested_date as YYYY-MM-DD (estimate if not explicit)

## Attribution — CRITICAL

You are building a knowledge base about the CONTACT, not about the user who owns this system.

- RECEIVED messages are FROM the contact. First-person statements ("I got promoted", "my daughter") describe the CONTACT.
- SENT messages are FROM the user TO the contact. First-person statements in SENT messages ("I just moved", "my wife") describe the USER, NOT the contact — do NOT extract these as facts about the contact.
- Only extract facts from SENT messages when they reveal something about the CONTACT (e.g., "Happy birthday!", "Congrats on the new job" → the contact has a birthday/new job).

## Source Awareness

Messages may come from different sources (email, iMessage, WhatsApp, etc.). Email tends to be more formal with subjects; SMS/chat tends to be more casual. Adjust your confidence accordingly — casual mentions may warrant lower confidence.

## Message Format

Messages are provided in two sections:
1. CONTEXT ONLY — Previously processed messages for background. Do NOT extract from these.
2. NEW MESSAGES — Extract facts only from these messages. Context messages help you understand references.

## Messages

{formatted_prompt}`;

const EXTRACTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    facts: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          fact_type: {
            type: 'string' as const,
            enum: ['birthday', 'location', 'job_title', 'company', 'email', 'phone',
                   'preference', 'tool', 'hobby', 'opinion', 'life_event', 'goal', 'custom'],
          },
          value: { type: 'string' as const },
          confidence: { type: 'number' as const },
        },
        required: ['fact_type', 'value', 'confidence'],
      },
    },
    relationships: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          label: { type: 'string' as const },
          person_name: { type: 'string' as const },
          confidence: { type: 'number' as const },
        },
        required: ['label', 'person_name', 'confidence'],
      },
    },
    followups: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          reason: { type: 'string' as const },
          suggested_date: { type: 'string' as const },
        },
        required: ['reason', 'suggested_date'],
      },
    },
  },
  required: ['facts', 'relationships', 'followups'],
};

export interface ExtractedFact {
  fact_type: string;
  value: string;
  structured_value?: Record<string, unknown> | null;
  confidence: number;
}

export interface ExtractedRelationship {
  label: string;
  person_name: string;
  confidence: number;
}

export interface ExtractedFollowup {
  reason: string;
  suggested_date: string;
}

export interface ExtractionResult {
  facts: ExtractedFact[];
  relationships: ExtractedRelationship[];
  followups: ExtractedFollowup[];
}

export interface CreatedExtractionResult {
  facts: Awaited<ReturnType<typeof create_extracted_fact>>[];
  relationships: Awaited<ReturnType<typeof create_extracted_relationship>>[];
  followups: Awaited<ReturnType<typeof create_content_detected_followup>>[];
}

function parse_extraction_response(response: string): ExtractionResult {
  // Try to extract JSON from the response
  const json_match = response.match(/\{[\s\S]*\}/);
  if (!json_match) {
    return { facts: [], relationships: [], followups: [] };
  }

  try {
    const parsed = JSON.parse(json_match[0]);
    return {
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
      followups: Array.isArray(parsed.followups) ? parsed.followups : [],
    };
  } catch {
    return { facts: [], relationships: [], followups: [] };
  }
}

export async function extract_from_batch(
  formatted_prompt: string,
  contact_name: string,
): Promise<ExtractionResult> {
  const prompt = BATCH_EXTRACTION_PROMPT
    .replace('{contact_name}', contact_name)
    .replace('{formatted_prompt}', formatted_prompt);

  try {
    const result = await generate_with_flash_json<ExtractionResult>(prompt, EXTRACTION_SCHEMA);

    // Filter by confidence threshold
    const threshold = config.frf_confidence_threshold;
    return {
      facts: result.facts.filter((f) => f.confidence >= threshold),
      relationships: result.relationships.filter((r) => r.confidence >= threshold),
      followups: result.followups,
    };
  } catch (error) {
    logger.error('Batch extraction failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      contact_name,
    });
    return { facts: [], relationships: [], followups: [] };
  }
}

/** @deprecated Use extract_from_batch() for the new batch pipeline */
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
    return { facts: [], relationships: [], followups: [] };
  }
}

/** @deprecated Will be removed after cron pipeline (WP-06) is active */
export async function extract_from_communication(
  communication_id: string,
  content: string,
  contact_id: string,
  contact_name: string,
  direction: string
): Promise<CreatedExtractionResult> {
  const extraction = await extract_from_text(content, contact_name, direction);

  const created_facts: Awaited<ReturnType<typeof create_extracted_fact>>[] = [];
  const created_relationships: Awaited<ReturnType<typeof create_extracted_relationship>>[] = [];
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

  // Create relationships
  for (const rel of extraction.relationships) {
    if (rel.confidence < 0.6) continue;

    try {
      const rel_input: ExtractedRelationshipInput = {
        contact_id,
        label: rel.label,
        person_name: rel.person_name,
        confidence: rel.confidence,
      };

      const created = await create_extracted_relationship(communication_id, rel_input);
      if (created) {
        created_relationships.push(created);
      }
    } catch (error) {
      logger.error('Failed to create extracted relationship', {
        error: error instanceof Error ? error.message : 'Unknown error',
        label: rel.label,
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

  return { facts: created_facts, relationships: created_relationships, followups: created_followups };
}
