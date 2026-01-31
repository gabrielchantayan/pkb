'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar, X } from 'lucide-react';

interface SearchFiltersValue {
  start_date?: string;
  end_date?: string;
}

interface SearchFiltersProps {
  value: SearchFiltersValue;
  onChange: (value: SearchFiltersValue) => void;
}

export function SearchFilters({ value, onChange }: SearchFiltersProps) {
  const has_filters = value.start_date || value.end_date;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-muted-foreground" />
        <Input
          type="date"
          value={value.start_date || ''}
          onChange={(e) => onChange({ ...value, start_date: e.target.value || undefined })}
          className="w-36"
          placeholder="From"
        />
        <span className="text-muted-foreground">to</span>
        <Input
          type="date"
          value={value.end_date || ''}
          onChange={(e) => onChange({ ...value, end_date: e.target.value || undefined })}
          className="w-36"
          placeholder="To"
        />
      </div>

      {has_filters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({})}
        >
          <X className="w-4 h-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
