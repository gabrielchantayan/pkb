import type { FactCategory, FactType } from '../types/fact.js';

export const FACT_CATEGORIES: Record<FactType, FactCategory> = {
  birthday: 'basic_info',
  location: 'basic_info',
  job_title: 'basic_info',
  company: 'basic_info',
  email: 'basic_info',
  phone: 'basic_info',
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

export const FACT_TYPE_LABELS: Record<FactType, string> = {
  birthday: 'Birthday',
  location: 'Location',
  job_title: 'Job Title',
  company: 'Company',
  email: 'Email',
  phone: 'Phone',
  custom: 'Custom',
};

// Fact types that have structured values
export const STRUCTURED_FACT_TYPES: FactType[] = [
  'birthday',
  'location',
];

// Fact types that can create contact identifiers
export const IDENTIFIER_FACT_TYPES: FactType[] = ['email', 'phone'];
