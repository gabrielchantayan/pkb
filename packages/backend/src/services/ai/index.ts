// Gemini client
export {
  generate_with_flash,
  generate_with_pro,
  generate_embedding,
  generate_embeddings,
  is_ai_available,
} from './gemini.js';

// Fact extraction
export {
  extract_from_text,
  extract_from_communication,
  type ExtractedFact,
  type ExtractedFollowup,
  type ExtractionResult,
  type CreatedExtractionResult,
} from './extraction.js';

// AI query
export { answer_query, type QuerySource, type QueryResult } from './query.js';

// Embeddings
export {
  queue_for_embedding,
  backfill_embeddings,
  embed_batch,
  get_queue_length,
  type BackfillResult,
  type EmbedBatchInput,
  type EmbedBatchResult,
} from './embeddings.js';

// Pipeline
export { process_communications, process_single_communication } from './pipeline.js';
