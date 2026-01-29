export type SentimentTrend = 'positive' | 'negative' | 'neutral';

export interface Contact {
  id: string;
  display_name: string;
  photo_url: string | null;
  starred: boolean;
  manual_importance: number | null;
  engagement_score: number | null;
  sentiment_trend: SentimentTrend | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export type ContactIdentifierType = 'email' | 'phone' | 'social_handle';

export interface ContactIdentifier {
  id: string;
  contact_id: string;
  type: ContactIdentifierType;
  value: string;
  source: string | null;
  created_at: Date;
}

export type RelationshipType = 'colleague' | 'family' | 'friend' | 'inferred';
export type RelationshipSource = 'cc_email' | 'group_chat' | 'llm_extracted' | 'manual';

export interface ContactRelationship {
  id: string;
  contact_a_id: string;
  contact_b_id: string;
  relationship_type: RelationshipType;
  source: RelationshipSource;
  strength: number | null;
  created_at: Date;
}
