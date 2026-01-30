import { generate_with_pro } from './gemini.js';
import { search } from '../search.js';
import { logger } from '../../lib/logger.js';

const QUERY_PROMPT = `
You are a helpful assistant answering questions about the user's contacts and relationships.
Use ONLY the provided context to answer. If the answer isn't in the context, say "I don't have enough information to answer that."

Context:
{context}

Question: {query}

Provide a concise answer and cite which sources you used (by their IDs).

Response format (JSON only):
{
  "answer": "Your answer here",
  "source_ids": ["uuid1", "uuid2"],
  "confidence": 0.0-1.0
}
`;

export interface QuerySource {
  type: 'communication' | 'fact' | 'note' | 'contact';
  id: string;
  snippet: string;
}

export interface QueryResult {
  answer: string;
  sources: QuerySource[];
  confidence: number;
}

function truncate(text: string, max_length: number): string {
  if (text.length <= max_length) return text;
  return text.slice(0, max_length - 3) + '...';
}

export async function answer_query(query: string, contact_id?: string): Promise<QueryResult> {
  // First, search for relevant context
  const search_results = await search({
    query,
    mode: 'combined',
    filters: contact_id ? { contact_id } : undefined,
    limit: 10,
  });

  if (search_results.results.length === 0) {
    return {
      answer: "I don't have any relevant information to answer that question.",
      sources: [],
      confidence: 0,
    };
  }

  // Build context from search results
  const context = search_results.results
    .map((r) => {
      let text = '';
      if (r.type === 'communication') {
        const content = (r.data as { content?: string }).content || '';
        text = `[${r.id}] Communication with ${r.contact?.displayName || 'Unknown'}: ${truncate(content, 500)}`;
      } else if (r.type === 'fact') {
        const data = r.data as { fact_type?: string; value?: string };
        text = `[${r.id}] Fact about ${r.contact?.displayName || 'Unknown'}: ${data.fact_type || ''} = ${data.value || ''}`;
      } else if (r.type === 'note') {
        const content = (r.data as { content?: string }).content || '';
        text = `[${r.id}] Note about ${r.contact?.displayName || 'Unknown'}: ${truncate(content, 500)}`;
      } else if (r.type === 'contact') {
        const display_name = (r.data as { display_name?: string }).display_name || 'Unknown';
        text = `[${r.id}] Contact: ${display_name}`;
      }
      return text;
    })
    .join('\n\n');

  const prompt = QUERY_PROMPT.replace('{context}', context).replace('{query}', query);

  try {
    const response = await generate_with_pro(prompt);

    const json_match = response.match(/\{[\s\S]*\}/);
    if (!json_match) {
      return {
        answer: response,
        sources: [],
        confidence: 0.5,
      };
    }

    const parsed = JSON.parse(json_match[0]);

    // Map source IDs to full source objects
    const sources: QuerySource[] = (parsed.source_ids || [])
      .map((id: string) => {
        const result = search_results.results.find((r) => r.id === id);
        if (!result) return null;

        const content_or_value =
          (result.data as { content?: string }).content ||
          (result.data as { value?: string }).value ||
          '';

        return {
          type: result.type,
          id: result.id,
          snippet: result.highlights?.[0] || truncate(content_or_value, 100),
        };
      })
      .filter((s: QuerySource | null): s is QuerySource => s !== null);

    return {
      answer: parsed.answer,
      sources,
      confidence: parsed.confidence || 0.5,
    };
  } catch (error) {
    logger.error('Query failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      answer: 'I encountered an error processing your question.',
      sources: [],
      confidence: 0,
    };
  }
}
