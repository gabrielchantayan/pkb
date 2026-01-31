import { generate_with_flash } from './gemini.js';
import { query } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import type { Tag, Fact, Communication } from '@pkb/shared';

const TAG_SUGGESTION_PROMPT = `
You are analyzing information about a contact to suggest relevant tags. Tags help organize contacts by profession, interests, relationship type, and other categories.

Contact Information:
Name: {contact_name}
{identifiers_section}
{facts_section}
{notes_section}
{communications_section}
{existing_tags_section}

Available Tags in System:
{available_tags_section}

Instructions:
1. Analyze the contact's profile, communications, and existing facts
2. Suggest tags that would help categorize and find this contact
3. Consider: profession, industry, interests, hobbies, relationship type (friend, colleague, family), location, expertise areas
4. Prefer suggesting from "Available Tags in System" when appropriate (set is_existing: true)
5. You may also suggest new tags that don't exist yet (set is_existing: false)
6. Don't suggest tags that are already applied to this contact (listed in "Contact's Current Tags")
7. Provide a confidence score (0.0-1.0) based on how certain you are the tag applies
8. Provide a brief reason for each suggestion

Respond with JSON only:
{
  "suggestions": [
    {
      "name": "tag name (lowercase, use hyphens for multi-word)",
      "is_existing": true/false,
      "existing_tag_id": "uuid if is_existing is true, null otherwise",
      "confidence": 0.0-1.0,
      "reason": "brief explanation for why this tag fits"
    }
  ]
}

Guidelines:
- Return 3-7 suggestions, sorted by confidence (highest first)
- Only include suggestions with confidence >= 0.5
- Tag names should be lowercase with hyphens (e.g., "software-engineer", "san-francisco")
- Common tag categories: profession, industry, location, relationship-type, interests, expertise
- If there's insufficient information, return fewer suggestions or empty array
`;

export interface TagSuggestion {
  name: string;
  is_existing: boolean;
  existing_tag_id: string | null;
  confidence: number;
  reason: string;
}

export interface TagSuggestionResult {
  suggestions: TagSuggestion[];
  contact_id: string;
  generated_at: string;
}

interface ContactContext {
  contact_id: string;
  contact_name: string;
  identifiers: Array<{ type: string; value: string }>;
  facts: Fact[];
  notes: Array<{ content: string; created_at: string }>;
  recent_communications: Communication[];
  current_tags: Tag[];
}

interface AvailableTag {
  id: string;
  name: string;
  contact_count: number;
}

function parse_tag_suggestions_response(
  response: string,
  available_tags_map: Map<string, AvailableTag>
): TagSuggestion[] {
  // Try to extract JSON from the response
  const json_match = response.match(/\{[\s\S]*\}/);
  if (!json_match) {
    return [];
  }

  try {
    const parsed = JSON.parse(json_match[0]);

    if (!Array.isArray(parsed.suggestions)) {
      return [];
    }

    const suggestions: TagSuggestion[] = [];

    for (const suggestion of parsed.suggestions) {
      // Validate required fields
      if (
        typeof suggestion.name !== 'string' ||
        typeof suggestion.confidence !== 'number' ||
        typeof suggestion.reason !== 'string'
      ) {
        continue;
      }

      // Normalize tag name
      const normalized_name = suggestion.name.toLowerCase().trim().replace(/\s+/g, '-');

      // Validate confidence
      const confidence = Math.min(1, Math.max(0, suggestion.confidence));
      if (confidence < 0.5) {
        continue;
      }

      // Check if this tag exists in available tags
      const existing_tag = available_tags_map.get(normalized_name);

      suggestions.push({
        name: normalized_name,
        is_existing: !!existing_tag,
        existing_tag_id: existing_tag?.id ?? null,
        confidence,
        reason: suggestion.reason,
      });
    }

    // Sort by confidence descending and limit to 7
    return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 7);
  } catch {
    return [];
  }
}

async function gather_contact_context(contact_id: string): Promise<ContactContext | null> {
  // Get contact basic info
  const contact_result = await query<{ id: string; display_name: string }>(
    'SELECT id, display_name FROM contacts WHERE id = $1 AND deleted_at IS NULL',
    [contact_id]
  );

  if (contact_result.rows.length === 0) {
    return null;
  }

  const contact = contact_result.rows[0];

  // Gather all context in parallel
  const [identifiers_result, facts_result, notes_result, communications_result, tags_result] =
    await Promise.all([
      // Get identifiers (emails, phones, etc.)
      query<{ type: string; value: string }>(
        'SELECT type, value FROM contact_identifiers WHERE contact_id = $1',
        [contact_id]
      ),

      // Get facts
      query<Fact>(
        'SELECT * FROM facts WHERE contact_id = $1 AND deleted_at IS NULL ORDER BY confidence DESC',
        [contact_id]
      ),

      // Get notes (last 5)
      query<{ content: string; created_at: string }>(
        `SELECT content, created_at FROM notes
         WHERE contact_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 5`,
        [contact_id]
      ),

      // Get recent communications (last 20)
      query<Communication>(
        `SELECT * FROM communications
         WHERE contact_id = $1
         ORDER BY timestamp DESC LIMIT 20`,
        [contact_id]
      ),

      // Get current tags
      query<Tag>(
        `SELECT t.* FROM tags t
         JOIN contact_tags ct ON ct.tag_id = t.id
         WHERE ct.contact_id = $1
         ORDER BY t.name`,
        [contact_id]
      ),
    ]);

  return {
    contact_id,
    contact_name: contact.display_name,
    identifiers: identifiers_result.rows,
    facts: facts_result.rows,
    notes: notes_result.rows,
    recent_communications: communications_result.rows,
    current_tags: tags_result.rows,
  };
}

async function get_available_tags(): Promise<AvailableTag[]> {
  const result = await query<AvailableTag>(
    `SELECT t.id, t.name, COUNT(ct.contact_id)::int as contact_count
     FROM tags t
     LEFT JOIN contact_tags ct ON ct.tag_id = t.id
     LEFT JOIN contacts c ON c.id = ct.contact_id AND c.deleted_at IS NULL
     GROUP BY t.id
     ORDER BY contact_count DESC, t.name ASC`
  );
  return result.rows;
}

function format_identifiers_section(identifiers: Array<{ type: string; value: string }>): string {
  if (identifiers.length === 0) {
    return '';
  }

  const lines = identifiers.map((id) => `- ${id.type}: ${id.value}`);
  return `\nIdentifiers:\n${lines.join('\n')}`;
}

function format_facts_section(facts: Fact[]): string {
  if (facts.length === 0) {
    return '';
  }

  const lines = facts.map((fact) => {
    const confidence_indicator = fact.confidence && fact.confidence >= 0.8 ? '' : ' (uncertain)';
    return `- ${fact.fact_type}: ${fact.value}${confidence_indicator}`;
  });

  return `\nKnown Facts:\n${lines.join('\n')}`;
}

function format_notes_section(notes: Array<{ content: string; created_at: string }>): string {
  if (notes.length === 0) {
    return '';
  }

  const lines = notes.map((note) => {
    // Truncate long notes
    const truncated =
      note.content.length > 200 ? note.content.substring(0, 200) + '...' : note.content;
    return `- ${truncated}`;
  });

  return `\nRecent Notes:\n${lines.join('\n')}`;
}

function format_communications_section(communications: Communication[]): string {
  if (communications.length === 0) {
    return '';
  }

  // Summarize communication patterns and content
  const incoming = communications.filter((c) => c.direction === 'inbound').length;
  const outgoing = communications.filter((c) => c.direction === 'outbound').length;

  const lines: string[] = [];
  lines.push(`Communication pattern: ${incoming} incoming, ${outgoing} outgoing messages`);

  // Get sentiment distribution
  const sentiments = communications
    .filter((c) => c.sentiment)
    .reduce(
      (acc, c) => {
        acc[c.sentiment!] = (acc[c.sentiment!] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

  if (Object.keys(sentiments).length > 0) {
    lines.push(
      `Sentiment: ${Object.entries(sentiments)
        .map(([s, c]) => `${s}: ${c}`)
        .join(', ')}`
    );
  }

  // Include snippets from recent messages (truncated)
  const recent_content = communications
    .slice(0, 5)
    .filter((c) => c.content)
    .map((c) => {
      const truncated =
        c.content!.length > 150 ? c.content!.substring(0, 150) + '...' : c.content!;
      return `- [${c.direction}] ${truncated}`;
    });

  if (recent_content.length > 0) {
    lines.push('\nRecent message excerpts:');
    lines.push(...recent_content);
  }

  return `\nCommunication Summary:\n${lines.join('\n')}`;
}

function format_existing_tags_section(tags: Tag[]): string {
  if (tags.length === 0) {
    return "\nContact's Current Tags: (none)";
  }

  const tag_names = tags.map((t) => t.name).join(', ');
  return `\nContact's Current Tags: ${tag_names}`;
}

function format_available_tags_section(tags: AvailableTag[], current_tag_ids: Set<string>): string {
  // Filter out tags already applied to contact
  const available = tags.filter((t) => !current_tag_ids.has(t.id));

  if (available.length === 0) {
    return '(no other tags in system)';
  }

  // Show top tags by usage
  const top_tags = available.slice(0, 30);
  return top_tags.map((t) => `${t.name} (used by ${t.contact_count} contacts)`).join(', ');
}

/**
 * Generate AI-powered tag suggestions for a contact
 */
export async function suggest_tags_for_contact(
  contact_id: string
): Promise<TagSuggestionResult | null> {
  // Gather contact context
  const context = await gather_contact_context(contact_id);
  if (!context) {
    return null;
  }

  // Get available tags in system
  const available_tags = await get_available_tags();
  const available_tags_map = new Map(available_tags.map((t) => [t.name.toLowerCase(), t]));
  const current_tag_ids = new Set(context.current_tags.map((t) => t.id));

  // Build prompt sections
  const identifiers_section = format_identifiers_section(context.identifiers);
  const facts_section = format_facts_section(context.facts);
  const notes_section = format_notes_section(context.notes);
  const communications_section = format_communications_section(context.recent_communications);
  const existing_tags_section = format_existing_tags_section(context.current_tags);
  const available_tags_section = format_available_tags_section(available_tags, current_tag_ids);

  // Build the full prompt
  const prompt = TAG_SUGGESTION_PROMPT.replace('{contact_name}', context.contact_name)
    .replace('{identifiers_section}', identifiers_section)
    .replace('{facts_section}', facts_section)
    .replace('{notes_section}', notes_section)
    .replace('{communications_section}', communications_section)
    .replace('{existing_tags_section}', existing_tags_section)
    .replace('{available_tags_section}', available_tags_section);

  try {
    const response = await generate_with_flash(prompt);
    const suggestions = parse_tag_suggestions_response(response, available_tags_map);

    return {
      suggestions,
      contact_id,
      generated_at: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Tag suggestion generation failed', {
      contact_id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      suggestions: [],
      contact_id,
      generated_at: new Date().toISOString(),
    };
  }
}

/**
 * Apply a suggested tag to a contact
 * If the tag doesn't exist, creates it first
 */
export async function apply_suggested_tag(
  contact_id: string,
  suggestion: TagSuggestion
): Promise<{ success: boolean; tag_id: string | null; error?: string }> {
  try {
    let tag_id: string;

    if (suggestion.is_existing && suggestion.existing_tag_id) {
      tag_id = suggestion.existing_tag_id;
    } else {
      // Create new tag
      const create_result = await query<{ id: string }>(
        `INSERT INTO tags (name, color) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [suggestion.name, '#808080']
      );
      tag_id = create_result.rows[0].id;
    }

    // Add tag to contact
    await query(
      `INSERT INTO contact_tags (contact_id, tag_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [contact_id, tag_id]
    );

    return { success: true, tag_id };
  } catch (error) {
    logger.error('Failed to apply suggested tag', {
      contact_id,
      suggestion,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      success: false,
      tag_id: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
