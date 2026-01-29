import { z } from 'zod';

export const search_mode_schema = z.enum(['keyword', 'semantic', 'combined']);

export const search_entity_type_schema = z.enum(['contact', 'communication', 'fact', 'note']);

export const search_filters_schema = z.object({
  contact_id: z.string().uuid().optional(),
  source: z.string().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  tags: z.array(z.string().uuid()).optional(),
  groups: z.array(z.string().uuid()).optional(),
});

export const global_search_schema = z.object({
  query: z.string().min(1).max(500),
  mode: search_mode_schema.optional().default('combined'),
  types: z.array(search_entity_type_schema).optional(),
  filters: search_filters_schema.optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export const communication_search_query_schema = z.object({
  q: z.string().min(1).max(500),
  contact_id: z.string().uuid().optional(),
  source: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const num = val ? parseInt(val, 10) : 20;
      return Math.min(Math.max(num, 1), 100);
    }),
});

export type GlobalSearchInput = z.infer<typeof global_search_schema>;
export type CommunicationSearchQuery = z.infer<typeof communication_search_query_schema>;
