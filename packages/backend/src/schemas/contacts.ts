import { z } from 'zod';

export const identifier_type_schema = z.enum(['email', 'phone', 'social_handle']);

export const identifier_input_schema = z.object({
  type: identifier_type_schema,
  value: z.string().min(1),
});

export const create_contact_schema = z.object({
  displayName: z.string().min(1).max(255),
  photoUrl: z.string().url().optional(),
  starred: z.boolean().optional().default(false),
  identifiers: z.array(identifier_input_schema).optional(),
});

export const update_contact_schema = z.object({
  displayName: z.string().min(1).max(255).optional(),
  photoUrl: z.string().url().nullable().optional(),
  starred: z.boolean().optional(),
  manualImportance: z.number().int().min(1).max(10).nullable().optional(),
});

export const star_contact_schema = z.object({
  starred: z.boolean(),
});

export const merge_contact_schema = z.object({
  mergeContactId: z.string().uuid(),
});

export const list_contacts_query_schema = z.object({
  search: z.string().optional(),
  starred: z
    .string()
    .optional()
    .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
  tag: z.string().uuid().optional(),
  group: z.string().uuid().optional(),
  sort: z.enum(['name', 'last_contact', 'engagement', 'created']).optional().default('name'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
  cursor: z.string().uuid().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const num = val ? parseInt(val, 10) : 50;
      return Math.min(Math.max(num, 1), 100);
    }),
});

export const add_identifier_schema = z.object({
  type: identifier_type_schema,
  value: z.string().min(1),
});

export const uuid_param_schema = z.object({
  id: z.string().uuid(),
});

export type CreateContactInput = z.infer<typeof create_contact_schema>;
export type UpdateContactInput = z.infer<typeof update_contact_schema>;
export type ListContactsQuery = z.infer<typeof list_contacts_query_schema>;
export type IdentifierInput = z.infer<typeof identifier_input_schema>;
