export interface Tag {
  id: string;
  name: string;
  color: string | null;
  followup_days: number | null;
  created_at: string;
  updated_at: string;
}

export interface TagWithCount extends Tag {
  contact_count: number;
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
  created_at: string;
  updated_at: string;
}

export interface GroupWithCount extends Group {
  contact_count: number;
}

export interface GroupTreeNode extends GroupWithCount {
  children: GroupTreeNode[];
}

export interface ContactGroup {
  contact_id: string;
  group_id: string;
}

export type SmartListConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'greater_than'
  | 'less_than'
  | 'is_empty'
  | 'is_not_empty';

export interface SmartListCondition {
  field: string;
  operator: SmartListConditionOperator;
  value?: unknown;
}

export interface SmartListRules {
  operator: 'AND' | 'OR';
  conditions: SmartListCondition[];
}

export interface SmartList {
  id: string;
  name: string;
  rules: SmartListRules;
  created_at: string;
  updated_at: string;
}

export interface SmartListWithCount extends SmartList {
  contact_count: number;
}
