import { z } from 'zod';

export const fact_category_schema = z.enum(['basic_info', 'custom']);

export const fact_type_schema = z.enum([
  'birthday',
  'location',
  'job_title',
  'company',
  'email',
  'phone',
  'custom',
]);

export const fact_source_schema = z.enum(['extracted', 'manual']);

// Structured value schemas for specific fact types
export const birthday_structured_schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

export const location_structured_schema = z.object({
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
});

// List facts query
export const list_facts_query_schema = z.object({
  contact_id: z.string().uuid().optional(),
  category: fact_category_schema.optional(),
  fact_type: z.string().optional(),
  source: fact_source_schema.optional(),
  has_conflict: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Create fact
export const create_fact_schema = z.object({
  contact_id: z.string().uuid(),
  fact_type: z.string().min(1),
  value: z.string().min(1),
  structured_value: z.record(z.string(), z.unknown()).optional(),
  reminder_enabled: z.boolean().optional(),
});

// Update fact
export const update_fact_schema = z.object({
  value: z.string().min(1).optional(),
  structured_value: z.record(z.string(), z.unknown()).optional(),
  reminder_enabled: z.boolean().optional(),
});

// Resolve conflict
export const resolve_conflict_schema = z.object({
  action: z.enum(['keep', 'replace', 'merge']),
  replace_with_fact_id: z.string().uuid().optional(),
});

// Batch create extracted facts (for AI integration)
export const batch_create_facts_schema = z.object({
  communication_id: z.string().uuid(),
  facts: z.array(
    z.object({
      contact_id: z.string().uuid(),
      fact_type: z.string().min(1),
      value: z.string().min(1),
      structured_value: z.record(z.string(), z.unknown()).optional(),
      confidence: z.number().min(0).max(1),
    })
  ),
});

export const uuid_param_schema = z.object({
  id: z.string().uuid(),
});

export type ListFactsQuery = z.infer<typeof list_facts_query_schema>;
export type CreateFactInput = z.infer<typeof create_fact_schema>;
export type UpdateFactInput = z.infer<typeof update_fact_schema>;
export type ResolveConflictInput = z.infer<typeof resolve_conflict_schema>;
export type BatchCreateFactsInput = z.infer<typeof batch_create_facts_schema>;
