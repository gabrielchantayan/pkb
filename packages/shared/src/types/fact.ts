export type FactCategory = 'basic_info' | 'preference' | 'custom';
export type FactType =
  | 'birthday'
  | 'location'
  | 'job_title'
  | 'company'
  | 'email'
  | 'phone'
  | 'custom';

export type FactSource = 'extracted' | 'manual';

export interface Fact {
  id: string;
  contact_id: string;
  category: FactCategory | null;
  fact_type: FactType | null;
  value: string;
  structured_value: Record<string, unknown> | null;
  source: FactSource;
  source_communication_id: string | null;
  confidence: number | null;
  has_conflict: boolean;
  reminder_enabled: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface FactHistory {
  id: string;
  fact_id: string;
  value: string | null;
  structured_value: Record<string, unknown> | null;
  changed_at: Date;
  change_source: string | null;
}
