'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Filter, Star, Clock, UserX } from 'lucide-react';

interface ContactFiltersProps {
  value: {
    starred?: boolean;
    has_followup?: boolean;
    saved_only?: boolean;
  };
  on_change: (filters: ContactFiltersProps['value']) => void;
}

export function ContactFilters({ value, on_change }: ContactFiltersProps) {
  const active_count = Object.values(value).filter(Boolean).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="default" />}>
        <Filter className="w-4 h-4 mr-2" />
        Filters
        {active_count > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
            {active_count}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          onClick={() => on_change({ ...value, saved_only: !value.saved_only })}
        >
          <UserX className="w-4 h-4 mr-2" />
          Hide unsaved #s
          {value.saved_only && <span className="ml-auto">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => on_change({ ...value, starred: !value.starred })}
        >
          <Star
            className={`w-4 h-4 mr-2 ${value.starred ? 'text-yellow-500 fill-yellow-500' : ''}`}
          />
          Starred
          {value.starred && <span className="ml-auto">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => on_change({ ...value, has_followup: !value.has_followup })}
        >
          <Clock className="w-4 h-4 mr-2" />
          Has Follow-up
          {value.has_followup && <span className="ml-auto">✓</span>}
        </DropdownMenuItem>
        {active_count > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => on_change({})}>
              Clear filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
