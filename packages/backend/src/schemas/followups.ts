import { z } from 'zod';

export const followup_type_schema = z.enum(['manual', 'time_based', 'content_detected']);

// List followups query
export const list_followups_query_schema = z.object({
  contact_id: z.string().uuid().optional(),
  completed: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
  type: followup_type_schema.optional(),
  due_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  due_after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Pending followups query
export const pending_followups_query_schema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

// Create followup
export const create_followup_schema = z.object({
  contact_id: z.string().uuid(),
  type: z.literal('manual'),
  reason: z.string().min(1),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

// Update followup
export const update_followup_schema = z.object({
  reason: z.string().min(1).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
});

// Complete followup
export const complete_followup_schema = z.object({
  note: z.string().optional(),
});

// Accept suggestion
export const accept_suggestion_schema = z.object({
  contact_id: z.string().uuid(),
  reason: z.string().min(1),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  type: z.enum(['time_based', 'content_detected']),
  source_communication_id: z.string().uuid().optional(),
});

export const uuid_param_schema = z.object({
  id: z.string().uuid(),
});

export type ListFollowupsQuery = z.infer<typeof list_followups_query_schema>;
export type PendingFollowupsQuery = z.infer<typeof pending_followups_query_schema>;
export type CreateFollowupInput = z.infer<typeof create_followup_schema>;
export type UpdateFollowupInput = z.infer<typeof update_followup_schema>;
export type CompleteFollowupInput = z.infer<typeof complete_followup_schema>;
export type AcceptSuggestionInput = z.infer<typeof accept_suggestion_schema>;
