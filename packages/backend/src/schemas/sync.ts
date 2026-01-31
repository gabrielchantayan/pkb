import { z } from 'zod';

export const contact_import_fact_schema = z.object({
  type: z.string(),
  value: z.string(),
});

export const contact_import_schema = z.object({
  source_id: z.string(),
  display_name: z.string().min(1),
  emails: z.array(z.string().email()).optional().default([]),
  phones: z.array(z.string()).optional().default([]),
  facts: z.array(contact_import_fact_schema).optional().default([]),
  note: z.string().optional(),
  photo_data: z.string().optional(), // base64
});

export const contacts_import_batch_schema = z.object({
  contacts: z.array(contact_import_schema).max(500),
});

export type ContactImportInput = z.infer<typeof contact_import_schema>;
export type ContactsImportBatchInput = z.infer<typeof contacts_import_batch_schema>;

// Calendar event import schema
export const calendar_event_import_schema = z.object({
  source_id: z.string().min(1),
  provider: z.string().min(1), // e.g., "apple", "google"
  title: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  start_time: z.string().datetime(), // ISO 8601
  end_time: z.string().datetime().optional(),
  all_day: z.boolean().optional().default(false),
  attendees: z.array(z.string()).optional().default([]), // email addresses
  calendar_id: z.string().optional(),
});

export const calendar_events_batch_schema = z.object({
  events: z.array(calendar_event_import_schema).max(500),
});

export type CalendarEventImportInput = z.infer<typeof calendar_event_import_schema>;
export type CalendarEventsBatchInput = z.infer<typeof calendar_events_batch_schema>;

// Apple Notes import schema
export const apple_note_import_schema = z.object({
  source_id: z.string().min(1),
  title: z.string().optional(),
  content: z.string().optional(),
  folder: z.string().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export const apple_notes_batch_schema = z.object({
  notes: z.array(apple_note_import_schema).max(500),
});

export type AppleNoteImportInput = z.infer<typeof apple_note_import_schema>;
export type AppleNotesBatchInput = z.infer<typeof apple_notes_batch_schema>;
