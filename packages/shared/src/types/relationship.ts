export interface Relationship {
  id: string;
  contact_id: string;
  label: string;
  person_name: string;
  linked_contact_id: string | null;
  linked_contact_name: string | null;
  linked_contact_photo: string | null;
  source: 'extracted' | 'manual';
  source_communication_id: string | null;
  confidence: number | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}
