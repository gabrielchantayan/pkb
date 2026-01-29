import type { Contact } from './contact.js';
import type { Communication } from './communication.js';
import type { Fact } from './fact.js';
import type { Note } from './note.js';

export type SearchMode = 'keyword' | 'semantic' | 'combined';
export type SearchEntityType = 'contact' | 'communication' | 'fact' | 'note';

export interface SearchFilters {
  contact_id?: string;
  source?: string;
  start_date?: string;
  end_date?: string;
  tags?: string[];
  groups?: string[];
}

export interface SearchParams {
  query: string;
  mode?: SearchMode;
  types?: SearchEntityType[];
  filters?: SearchFilters;
  limit?: number;
}

export interface ContactSearchResult {
  type: 'contact';
  id: string;
  score: number;
  highlights: string[];
  data: Contact;
}

export interface CommunicationSearchResult {
  type: 'communication';
  id: string;
  score: number;
  highlights: string[];
  data: Communication;
  contact?: {
    id: string;
    displayName: string;
  };
}

export interface FactSearchResult {
  type: 'fact';
  id: string;
  score: number;
  highlights: string[];
  data: Fact;
  contact?: {
    id: string;
    displayName: string;
  };
}

export interface NoteSearchResult {
  type: 'note';
  id: string;
  score: number;
  highlights: string[];
  data: Note;
  contact?: {
    id: string;
    displayName: string;
  };
}

export type SearchResult =
  | ContactSearchResult
  | CommunicationSearchResult
  | FactSearchResult
  | NoteSearchResult;

export interface SearchResults {
  results: SearchResult[];
  totalEstimate: number;
}

export interface CommunicationSearchParams {
  q: string;
  contact_id?: string;
  source?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
}

export interface CommunicationSearchResultItem {
  communication: Communication;
  highlights: string[];
  score: number;
}

export interface CommunicationSearchResults {
  results: CommunicationSearchResultItem[];
}
