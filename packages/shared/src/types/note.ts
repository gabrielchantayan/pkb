export interface Note {
  id: string;
  contact_id: string;
  content: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface NoteAttachment {
  id: string;
  note_id: string;
  filename: string | null;
  mime_type: string | null;
  storage_path: string | null;
  size_bytes: number | null;
  created_at: Date;
}
