import { z } from 'zod';

// Extract facts from communication
export const extract_schema = z.object({
  communication_id: z.string().uuid(),
  content: z.string().min(1),
  contact_id: z.string().uuid(),
});

export type ExtractInput = z.infer<typeof extract_schema>;

// AI query
export const query_schema = z.object({
  query: z.string().min(1),
  contact_id: z.string().uuid().optional(),
});

export type QueryInput = z.infer<typeof query_schema>;

// Generate embeddings
export const embed_schema = z.object({
  texts: z.array(z.string()).min(1).max(100),
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export type EmbedInput = z.infer<typeof embed_schema>;

// Backfill embeddings
export const backfill_schema = z.object({
  batch_size: z.coerce.number().int().min(1).max(1000).default(100),
});

export type BackfillInput = z.infer<typeof backfill_schema>;
