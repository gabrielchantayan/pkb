import Link from 'next/link';
import { Contact } from '@/lib/api';
import { Avatar } from '@/components/shared/avatar';
import { Badge } from '@/components/ui/badge';
import { Star } from 'lucide-react';

interface ContactListProps {
  contacts: Contact[];
  is_loading: boolean;
}

export function ContactList({ contacts, is_loading }: ContactListProps) {
  if (is_loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 p-4 rounded-lg border bg-card animate-pulse"
          >
            <div className="w-10 h-10 rounded-full bg-muted" />
            <div className="flex-1">
              <div className="h-4 w-32 bg-muted rounded mb-2" />
              <div className="h-3 w-48 bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No contacts found
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {contacts.map((contact) => (
        <Link
          key={contact.id}
          href={`/contacts/${contact.id}`}
          className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent transition-colors"
        >
          <Avatar name={contact.display_name} url={contact.photo_url} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{contact.display_name}</span>
              {contact.starred && (
                <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
              )}
            </div>
            {contact.emails?.[0] && (
              <span className="text-sm text-muted-foreground truncate block">
                {contact.emails[0]}
              </span>
            )}
          </div>

          <div className="flex gap-1 flex-wrap justify-end max-w-[200px]">
            {contact.tags?.slice(0, 3).map((tag) => (
              <Badge
                key={tag.id}
                variant="secondary"
                className="text-xs"
                style={{ backgroundColor: tag.color + '20', color: tag.color }}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        </Link>
      ))}
    </div>
  );
}
