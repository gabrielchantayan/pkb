export interface Tag {
  id: string;
  name: string;
  color: string | null;
  followup_days: number | null;
}

export interface ContactTag {
  contact_id: string;
  tag_id: string;
}

export interface Group {
  id: string;
  name: string;
  parent_id: string | null;
  followup_days: number | null;
}

export interface ContactGroup {
  contact_id: string;
  group_id: string;
}

export interface SmartListRule {
  field: string;
  operator: 'equals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'not_in';
  value: unknown;
}

export interface SmartList {
  id: string;
  name: string;
  rules: SmartListRule[];
}
