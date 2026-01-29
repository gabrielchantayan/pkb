export type FollowupType = 'manual' | 'time_based' | 'content_detected';

export interface Followup {
  id: string;
  contact_id: string;
  type: FollowupType | null;
  reason: string | null;
  due_date: Date | null;
  source_communication_id: string | null;
  completed: boolean;
  completed_at: Date | null;
  created_at: Date;
}
