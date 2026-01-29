# Feature: AI Integration

## Overview

Integrate Google Gemini API for fact extraction from communications, embedding generation for semantic search, and AI-powered querying. All LLM processing happens on the backend.

## Dependencies

- **Requires**: 01-project-foundation, 02-authentication, 03-contacts-core, 04-communications, 05-facts-system
- **Enables**: 09-search (semantic search), 07-followups (content-detected suggestions)

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LLM Provider | Google Gemini | Specified in SPEC |
| Extraction model | Gemini Flash | Fast, cheap for extraction |
| Query model | Gemini Pro | Better for complex reasoning |
| Embeddings | Gemini text-embedding | 768 dimensions |
| Processing | Async queue | Don't block sync |

## API Endpoints

### Extract Facts (internal/daemon)
```
POST /api/ai/extract
Headers: X-API-Key: <daemon-key>
Body:
{
  communication_id: UUID,
  content: string,
  contact_id: UUID
}

Response:
{
  facts: {
    fact_type: string,
    value: string,
    structured_value?: object,
    confidence: number
  }[],
  followups: {
    reason: string,
    suggested_date: string
  }[]
}
```

### AI Query
```
POST /api/ai/query
Body:
{
  query: string,
  contact_id?: UUID  // scope to specific contact
}

Response:
{
  answer: string,
  sources: {
    type: 'communication' | 'fact' | 'note',
    id: UUID,
    snippet: string
  }[],
  confidence: number
}
```

### Generate Embeddings (internal)
```
POST /api/ai/embed
Headers: X-API-Key: <daemon-key>
Body:
{
  texts: string[],
  ids: UUID[]  // communication IDs
}

Response:
{
  processed: number,
  errors: { id: UUID, error: string }[]
}
```

## Configuration

```bash
# .env
GEMINI_API_KEY=your-gemini-api-key
GEMINI_FLASH_MODEL=gemini-1.5-flash
GEMINI_PRO_MODEL=gemini-1.5-pro
GEMINI_EMBEDDING_MODEL=text-embedding-004
```

## Implementation

### Gemini Client

```typescript
// src/services/ai/gemini.ts

import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const flashModel = genAI.getGenerativeModel({ model: process.env.GEMINI_FLASH_MODEL || 'gemini-1.5-flash' });
const proModel = genAI.getGenerativeModel({ model: process.env.GEMINI_PRO_MODEL || 'gemini-1.5-pro' });

export async function generateWithFlash(prompt: string): Promise<string> {
  const result = await flashModel.generateContent(prompt);
  return result.response.text();
}

export async function generateWithPro(prompt: string): Promise<string> {
  const result = await proModel.generateContent(prompt);
  return result.response.text();
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const embeddingModel = genAI.getGenerativeModel({ model: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004' });
    const result = await embeddingModel.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error('Embedding generation failed:', error);
    return null;
  }
}

export async function generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  // Batch embedding - process in chunks to avoid rate limits
  const BATCH_SIZE = 10;
  const results: (number[] | null)[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(t => generateEmbedding(t)));
    results.push(...batchResults);

    // Rate limiting delay
    if (i + BATCH_SIZE < texts.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return results;
}
```

### Fact Extraction

```typescript
// src/services/ai/extraction.ts

import { generateWithFlash } from './gemini';
import { createExtractedFact } from '../facts';
import { createContentDetectedFollowup } from '../followups';

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

Respond with JSON:
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

export async function extractFromCommunication(
  communicationId: string,
  content: string,
  contactId: string,
  contactName: string,
  direction: string
): Promise<ExtractionResult> {
  const prompt = EXTRACTION_PROMPT
    .replace('{content}', content)
    .replace('{contact_name}', contactName)
    .replace('{direction}', direction);

  try {
    const response = await generateWithFlash(prompt);

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { facts: [], followups: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Create facts
    const createdFacts = [];
    for (const fact of parsed.facts || []) {
      if (fact.confidence < 0.6) continue;

      try {
        const created = await createExtractedFact({
          contact_id: contactId,
          fact_type: fact.fact_type,
          value: fact.value,
          structured_value: fact.structured_value,
          confidence: fact.confidence,
          source_communication_id: communicationId
        });
        createdFacts.push(created);
      } catch (error) {
        console.error('Failed to create fact:', error);
      }
    }

    // Create follow-ups
    const createdFollowups = [];
    for (const followup of parsed.followups || []) {
      try {
        const created = await createContentDetectedFollowup(
          contactId,
          communicationId,
          followup.reason,
          followup.suggested_date
        );
        if (created) createdFollowups.push(created);
      } catch (error) {
        console.error('Failed to create followup:', error);
      }
    }

    return { facts: createdFacts, followups: createdFollowups };
  } catch (error) {
    console.error('Extraction failed:', error);
    return { facts: [], followups: [] };
  }
}
```

### AI Query

```typescript
// src/services/ai/query.ts

import { generateWithPro, generateEmbedding } from './gemini';
import { search } from '../search';

const QUERY_PROMPT = `
You are a helpful assistant answering questions about the user's contacts and relationships.
Use ONLY the provided context to answer. If the answer isn't in the context, say "I don't have enough information to answer that."

Context:
{context}

Question: {query}

Provide a concise answer and cite which sources you used (by their IDs).

Response format:
{
  "answer": "Your answer here",
  "source_ids": ["uuid1", "uuid2"],
  "confidence": 0.0-1.0
}
`;

export async function answerQuery(
  query: string,
  contactId?: string
): Promise<QueryResult> {
  // First, search for relevant context
  const searchResults = await search({
    query,
    mode: 'combined',
    filters: contactId ? { contact_id: contactId } : undefined,
    limit: 10
  });

  if (searchResults.results.length === 0) {
    return {
      answer: "I don't have any relevant information to answer that question.",
      sources: [],
      confidence: 0
    };
  }

  // Build context from search results
  const context = searchResults.results.map((r, i) => {
    let text = '';
    if (r.type === 'communication') {
      text = `[${r.id}] Communication with ${r.contact?.displayName}: ${truncate(r.data.content, 500)}`;
    } else if (r.type === 'fact') {
      text = `[${r.id}] Fact about ${r.contact?.displayName}: ${r.data.fact_type} = ${r.data.value}`;
    } else if (r.type === 'note') {
      text = `[${r.id}] Note about ${r.contact?.displayName}: ${truncate(r.data.content, 500)}`;
    } else if (r.type === 'contact') {
      text = `[${r.id}] Contact: ${r.data.display_name}`;
    }
    return text;
  }).join('\n\n');

  const prompt = QUERY_PROMPT
    .replace('{context}', context)
    .replace('{query}', query);

  try {
    const response = await generateWithPro(prompt);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        answer: response,
        sources: [],
        confidence: 0.5
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Map source IDs to full source objects
    const sources = parsed.source_ids
      .map((id: string) => {
        const result = searchResults.results.find(r => r.id === id);
        if (!result) return null;
        return {
          type: result.type,
          id: result.id,
          snippet: result.highlights?.[0] || truncate(result.data.content || result.data.value || '', 100)
        };
      })
      .filter(Boolean);

    return {
      answer: parsed.answer,
      sources,
      confidence: parsed.confidence
    };
  } catch (error) {
    console.error('Query failed:', error);
    return {
      answer: "I encountered an error processing your question.",
      sources: [],
      confidence: 0
    };
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
```

### Embedding Queue

```typescript
// src/services/ai/embeddings.ts

import { generateEmbedding } from './gemini';

// Queue for async embedding generation
const embeddingQueue: string[] = [];
let processing = false;

export function queueForEmbedding(communicationId: string) {
  embeddingQueue.push(communicationId);
  processQueue();
}

async function processQueue() {
  if (processing || embeddingQueue.length === 0) return;

  processing = true;

  while (embeddingQueue.length > 0) {
    const id = embeddingQueue.shift()!;

    try {
      // Get communication content
      const comm = await db.query(
        'SELECT content FROM communications WHERE id = $1',
        [id]
      );

      if (!comm.rows[0]) continue;

      // Generate embedding
      const embedding = await generateEmbedding(comm.rows[0].content);

      if (embedding) {
        // Store embedding
        await db.query(
          'UPDATE communications SET content_embedding = $1 WHERE id = $2',
          [JSON.stringify(embedding), id]
        );
      }
    } catch (error) {
      console.error(`Failed to generate embedding for ${id}:`, error);
      // Could re-queue with backoff
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 50));
  }

  processing = false;
}

// Batch embedding for existing communications
export async function backfillEmbeddings(batchSize: number = 100) {
  const missing = await db.query(`
    SELECT id, content FROM communications
    WHERE content_embedding IS NULL
    LIMIT $1
  `, [batchSize]);

  for (const row of missing.rows) {
    queueForEmbedding(row.id);
  }

  return missing.rows.length;
}
```

### Processing Pipeline

```typescript
// src/services/ai/pipeline.ts

// Called after batch upsert completes
export async function processCommunications(communicationIds: string[]) {
  for (const id of communicationIds) {
    // Get communication with contact info
    const comm = await db.query(`
      SELECT cm.*, c.display_name as contact_name
      FROM communications cm
      JOIN contacts c ON c.id = cm.contact_id
      WHERE cm.id = $1
    `, [id]);

    if (!comm.rows[0]) continue;

    const { content, contact_id, contact_name, direction } = comm.rows[0];

    // Skip very short messages
    if (content.length < 20) continue;

    // Extract facts and followups
    await extractFromCommunication(id, content, contact_id, contact_name, direction);

    // Queue for embedding
    queueForEmbedding(id);
  }
}
```

## Implementation Steps

1. Install `@google/generative-ai` package
2. Create `src/services/ai/gemini.ts` with API client
3. Create `src/services/ai/extraction.ts` for fact extraction
4. Create `src/services/ai/query.ts` for AI queries
5. Create `src/services/ai/embeddings.ts` for embedding generation
6. Create `src/services/ai/pipeline.ts` to orchestrate processing
7. Create `src/routes/ai.ts` with endpoints
8. Hook pipeline into batch upsert (04-communications)
9. Add backfill command for existing communications
10. Add rate limiting and retry logic
11. Test extraction with sample messages
12. Test query with sample questions

## Acceptance Criteria

- [ ] `POST /api/ai/extract` extracts facts from communication text
- [ ] Extracted facts are created with source_communication_id
- [ ] Follow-ups detected from promises/action items
- [ ] Confidence scores filter low-quality extractions
- [ ] `POST /api/ai/query` answers questions using context
- [ ] Query responses include source citations
- [ ] Embeddings generated asynchronously for communications
- [ ] Batch upsert triggers extraction and embedding pipeline
- [ ] Rate limiting prevents API quota exhaustion
- [ ] Errors don't block the main sync process

## Files to Create

| Path | Purpose |
|------|---------|
| `packages/backend/src/services/ai/gemini.ts` | Gemini API client |
| `packages/backend/src/services/ai/extraction.ts` | Fact extraction |
| `packages/backend/src/services/ai/query.ts` | AI query |
| `packages/backend/src/services/ai/embeddings.ts` | Embedding generation |
| `packages/backend/src/services/ai/pipeline.ts` | Processing orchestration |
| `packages/backend/src/services/ai/index.ts` | Export all AI services |
| `packages/backend/src/routes/ai.ts` | AI endpoints |
| `packages/backend/src/schemas/ai.ts` | Validation schemas |

## Notes for Implementation

- Gemini API has rate limits - implement backoff
- Extraction prompt may need tuning based on results
- Consider caching embeddings to avoid regeneration
- Monitor API costs - extraction runs on every new message
- Flash model is cheaper, use Pro only for complex queries
- Embedding dimension (768) must match database column
- Consider adding a processing status to communications table
- May want to skip extraction for very old messages during initial sync
