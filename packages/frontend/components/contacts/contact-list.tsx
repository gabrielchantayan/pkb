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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-2 p-4 rounded-lg border bg-card animate-pulse"
          >
            <div className="w-10 h-10 rounded-full bg-muted" />
            <div className="h-3 w-20 bg-muted rounded" />
            <div className="h-2.5 w-16 bg-muted rounded" />
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
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {contacts.map((contact) => (
        <Link
          key={contact.id}
          href={`/contacts/${contact.id}`}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border bg-card hover:bg-accent transition-colors text-center relative"
        >
          {contact.starred && (
            <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 absolute top-2 right-2" />
          )}

          <Avatar name={contact.display_name} url={contact.photo_url} size="sm" />

          <span className="font-medium text-sm truncate w-full">{contact.display_name}</span>

          {contact.emails?.[0] && (
            <span className="text-xs text-muted-foreground truncate w-full">
              {contact.emails[0]}
            </span>
          )}

          {contact.tags && contact.tags.length > 0 && (
            <div className="flex gap-1 flex-wrap justify-center">
              {contact.tags.slice(0, 2).map((tag) => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0"
                  style={{ backgroundColor: tag.color + '20', color: tag.color }}
                >
                  {tag.name}
                </Badge>
              ))}
            </div>
          )}
        </Link>
      ))}
    </div>
  );
}
