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
