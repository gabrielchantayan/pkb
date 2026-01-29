export interface CalendarEvent {
  id: string;
  source: string | null;
  source_id: string | null;
  title: string | null;
  description: string | null;
  start_time: Date;
  end_time: Date | null;
  attendee_contact_ids: string[];
  location: string | null;
  created_at: Date;
}
