import { z } from 'zod';

export const list_relationships_query_schema = z.object({
  contact_id: z.string().uuid(),
});

export const create_relationship_schema = z.object({
  contact_id: z.string().uuid(),
  label: z.string().min(1),
  person_name: z.string().min(1),
  linked_contact_id: z.string().uuid().optional(),
});

export const update_relationship_schema = z.object({
  label: z.string().min(1).optional(),
  person_name: z.string().min(1).optional(),
  linked_contact_id: z.string().uuid().nullable().optional(),
});

export const uuid_param_schema = z.object({
  id: z.string().uuid(),
});

export type ListRelationshipsQuery = z.infer<typeof list_relationships_query_schema>;
export type CreateRelationshipInput = z.infer<typeof create_relationship_schema>;
export type UpdateRelationshipInput = z.infer<typeof update_relationship_schema>;
