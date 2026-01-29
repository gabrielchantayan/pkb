import { z } from 'zod';

// Hex color validation (e.g., #808080, #fff, #AABBCC)
const hex_color_schema = z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, {
  message: 'Invalid hex color format',
});

// === Tag Schemas ===

export const create_tag_schema = z.object({
  name: z.string().min(1).max(100),
  color: hex_color_schema.optional(),
  followup_days: z.number().int().min(1).max(365).optional(),
});

export const update_tag_schema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: hex_color_schema.optional(),
  followup_days: z.number().int().min(1).max(365).nullable().optional(),
});

export const add_tag_to_contact_schema = z.object({
  tag_id: z.string().uuid(),
});

// === Group Schemas ===

export const create_group_schema = z.object({
  name: z.string().min(1).max(100),
  parent_id: z.string().uuid().optional(),
  followup_days: z.number().int().min(1).max(365).optional(),
});

export const update_group_schema = z.object({
  name: z.string().min(1).max(100).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  followup_days: z.number().int().min(1).max(365).nullable().optional(),
});

export const add_contact_to_group_schema = z.object({
  group_id: z.string().uuid(),
});

// === Smart List Schemas ===

const smart_list_condition_operator_schema = z.enum([
  'equals',
  'not_equals',
  'contains',
  'greater_than',
  'less_than',
  'is_empty',
  'is_not_empty',
]);

const smart_list_condition_schema = z.object({
  field: z.string().min(1),
  operator: smart_list_condition_operator_schema,
  value: z.unknown().optional(),
});

const smart_list_rules_schema = z.object({
  operator: z.enum(['AND', 'OR']),
  conditions: z.array(smart_list_condition_schema).min(1),
});

export const create_smart_list_schema = z.object({
  name: z.string().min(1).max(100),
  rules: smart_list_rules_schema,
});

export const update_smart_list_schema = z.object({
  name: z.string().min(1).max(100).optional(),
  rules: smart_list_rules_schema.optional(),
});

export const smart_list_contacts_query_schema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const num = val ? parseInt(val, 10) : 50;
      return Math.min(Math.max(num, 1), 100);
    }),
});

// === Common Schemas ===

export const uuid_param_schema = z.object({
  id: z.string().uuid(),
});

export const contact_id_param_schema = z.object({
  contactId: z.string().uuid(),
});

export const contact_tag_params_schema = z.object({
  contactId: z.string().uuid(),
  tagId: z.string().uuid(),
});

export const contact_group_params_schema = z.object({
  contactId: z.string().uuid(),
  groupId: z.string().uuid(),
});

// === Type Exports ===

export type CreateTagInput = z.infer<typeof create_tag_schema>;
export type UpdateTagInput = z.infer<typeof update_tag_schema>;
export type CreateGroupInput = z.infer<typeof create_group_schema>;
export type UpdateGroupInput = z.infer<typeof update_group_schema>;
export type CreateSmartListInput = z.infer<typeof create_smart_list_schema>;
export type UpdateSmartListInput = z.infer<typeof update_smart_list_schema>;
export type SmartListContactsQuery = z.infer<typeof smart_list_contacts_query_schema>;
