import { z } from 'zod';

export const communication_source_schema = z.enum([
  'imessage',
  'gmail',
  'twitter',
  'instagram',
  'phone',
  'calendar',
]);

export const communication_direction_schema = z.enum(['inbound', 'outbound']);

// List communications query params
export const list_communications_query_schema = z.object({
  contact_id: z.string().uuid().optional(),
  source: communication_source_schema.optional(),
  direction: communication_direction_schema.optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  conversation_id: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const num = val ? parseInt(val, 10) : 50;
      return Math.min(Math.max(num, 1), 100);
    }),
});

// Search communications query params
export const search_communications_query_schema = z.object({
  q: z.string().min(1),
  contact_id: z.string().uuid().optional(),
  source: communication_source_schema.optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const num = val ? parseInt(val, 10) : 20;
      return Math.min(Math.max(num, 1), 100);
    }),
});

// Attachment input for batch upsert
export const attachment_input_schema = z.object({
  filename: z.string().min(1),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().positive(),
  data: z.string().min(1), // base64 encoded
});

// Contact identifier for batch upsert
export const contact_identifier_schema = z.object({
  type: z.enum(['email', 'phone', 'social_handle']),
  value: z.string().min(1),
});

// Single communication input for batch upsert
export const communication_input_schema = z.object({
  source: communication_source_schema,
  source_id: z.string().min(1),
  contact_identifier: contact_identifier_schema,
  direction: communication_direction_schema,
  subject: z.string().optional(),
  content: z.string(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  thread_id: z.string().optional(),
  attachments: z.array(attachment_input_schema).optional(),
});

// Batch upsert request body
export const batch_upsert_schema = z.object({
  communications: z.array(communication_input_schema).min(1).max(100),
});

// Upload attachment params
export const upload_attachment_params_schema = z.object({
  communication_source: communication_source_schema,
  communication_source_id: z.string().min(1),
  filename: z.string().min(1),
});

// UUID param schema
export const uuid_param_schema = z.object({
  id: z.string().uuid(),
});

// Export types
export type ListCommunicationsQuery = z.infer<typeof list_communications_query_schema>;
export type SearchCommunicationsQuery = z.infer<typeof search_communications_query_schema>;
export type AttachmentInput = z.infer<typeof attachment_input_schema>;
export type ContactIdentifier = z.infer<typeof contact_identifier_schema>;
export type CommunicationInput = z.infer<typeof communication_input_schema>;
export type BatchUpsertInput = z.infer<typeof batch_upsert_schema>;
export type UploadAttachmentParams = z.infer<typeof upload_attachment_params_schema>;
