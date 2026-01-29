import { z } from 'zod';

// List notes query
export const list_notes_query_schema = z.object({
  contact_id: z.string().uuid().optional(),
  search: z.string().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Create note
export const create_note_schema = z.object({
  contact_id: z.string().uuid(),
  content: z.string().min(1),
});

// Update note
export const update_note_schema = z.object({
  content: z.string().min(1),
});

// UUID param schema
export const uuid_param_schema = z.object({
  id: z.string().uuid(),
});

// Attachment ID param schema
export const attachment_param_schema = z.object({
  id: z.string().uuid(),
  attachmentId: z.string().uuid(),
});

export type ListNotesQuery = z.infer<typeof list_notes_query_schema>;
export type CreateNoteInput = z.infer<typeof create_note_schema>;
export type UpdateNoteInput = z.infer<typeof update_note_schema>;
