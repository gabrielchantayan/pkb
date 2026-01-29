import type { FactCategory, FactType } from '../types/fact.js';

export const FACT_CATEGORIES: Record<FactType, FactCategory> = {
  birthday: 'basic_info',
  location: 'basic_info',
  job_title: 'basic_info',
  company: 'basic_info',
  email: 'basic_info',
  phone: 'basic_info',
  spouse: 'relationship',
  child: 'relationship',
  parent: 'relationship',
  sibling: 'relationship',
  friend: 'relationship',
  colleague: 'relationship',
  how_we_met: 'relationship',
  mutual_connection: 'relationship',
  custom: 'custom',
};

export const BASIC_INFO_FACT_TYPES: FactType[] = [
  'birthday',
  'location',
  'job_title',
  'company',
  'email',
  'phone',
];

export const RELATIONSHIP_FACT_TYPES: FactType[] = [
  'spouse',
  'child',
  'parent',
  'sibling',
  'friend',
  'colleague',
  'how_we_met',
  'mutual_connection',
];

export const FACT_TYPE_LABELS: Record<FactType, string> = {
  birthday: 'Birthday',
  location: 'Location',
  job_title: 'Job Title',
  company: 'Company',
  email: 'Email',
  phone: 'Phone',
  spouse: 'Spouse',
  child: 'Child',
  parent: 'Parent',
  sibling: 'Sibling',
  friend: 'Friend',
  colleague: 'Colleague',
  how_we_met: 'How We Met',
  mutual_connection: 'Mutual Connection',
  custom: 'Custom',
};

// Fact types that have structured values
export const STRUCTURED_FACT_TYPES: FactType[] = [
  'birthday',
  'location',
  'spouse',
  'child',
  'parent',
  'sibling',
  'friend',
  'colleague',
  'mutual_connection',
];

// Fact types that can create contact identifiers
export const IDENTIFIER_FACT_TYPES: FactType[] = ['email', 'phone'];
