export type CommunicationSource = 'imessage' | 'gmail' | 'twitter' | 'instagram' | 'phone' | 'calendar';
export type CommunicationDirection = 'inbound' | 'outbound';
export type Sentiment = 'positive' | 'negative' | 'neutral';

export interface Communication {
  id: string;
  source: CommunicationSource;
  source_id: string;
  contact_id: string;
  direction: CommunicationDirection | null;
  subject: string | null;
  content: string | null;
  content_embedding: number[] | null;
  timestamp: Date;
  metadata: Record<string, unknown> | null;
  sentiment: Sentiment | null;
  created_at: Date;
}

export interface Conversation {
  id: string;
  source: CommunicationSource;
  source_thread_id: string | null;
  participants: string[];
  sentiment_aggregate: Sentiment | null;
  first_message_at: Date;
  last_message_at: Date;
  message_count: number;
}

export interface CommunicationAttachment {
  id: string;
  communication_id: string;
  filename: string | null;
  mime_type: string | null;
  storage_path: string | null;
  size_bytes: number | null;
  created_at: Date;
}
