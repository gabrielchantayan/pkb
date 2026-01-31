'use client';

import Link from 'next/link';
import { SearchResult } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, MessageSquare, FileText, StickyNote, Loader2 } from 'lucide-react';

const TYPE_ICONS = {
  contact: User,
  communication: MessageSquare,
  fact: FileText,
  note: StickyNote,
};

interface SearchResultsProps {
  results: SearchResult[];
  is_loading: boolean;
}

export function SearchResults({ results, is_loading }: SearchResultsProps) {
  if (is_loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No results found
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {results.map((result) => {
        const Icon = TYPE_ICONS[result.type];
        const href =
          result.type === 'contact'
            ? `/contacts/${result.id}`
            : `/contacts/${result.contact?.id}`;

        return (
          <Link key={`${result.type}-${result.id}`} href={href}>
            <Card className="hover:bg-accent transition-colors">
              <CardContent className="flex items-start gap-4 py-4">
                <div className="p-2 bg-muted rounded">
                  <Icon className="w-5 h-5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline">{result.type}</Badge>
                    {result.contact && result.type !== 'contact' && (
                      <span className="text-sm text-muted-foreground">
                        {result.contact.displayName}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      Score: {(result.score * 100).toFixed(0)}%
                    </span>
                  </div>

                  {result.type === 'contact' && (
                    <p className="font-medium">
                      {(result.data as { display_name?: string }).display_name}
                    </p>
                  )}

                  {result.highlights?.map((highlight, i) => (
                    <p
                      key={i}
                      className="text-sm text-muted-foreground"
                      dangerouslySetInnerHTML={{ __html: highlight }}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
