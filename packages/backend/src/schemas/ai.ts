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

// Apply suggested tag
export const apply_suggested_tag_schema = z.object({
  name: z.string().min(1).max(100),
  is_existing: z.boolean().optional().default(false),
  existing_tag_id: z.string().uuid().nullable().optional(),
  confidence: z.number().min(0).max(1).optional().default(1.0),
  reason: z.string().optional(),
});

export type ApplySuggestedTagInput = z.infer<typeof apply_suggested_tag_schema>;
