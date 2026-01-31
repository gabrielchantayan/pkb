'use client';

import { Contact, Identifier } from '@/lib/api';
import { useStarContact } from '@/lib/hooks/use-contacts';
import { Avatar } from '@/components/shared/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Star, Mail, Phone, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface ContactHeaderProps {
  contact: Contact;
  identifiers: Identifier[];
  tags: Array<{ id: string; name: string; color: string }>;
  groups: Array<{ id: string; name: string }>;
}

export function ContactHeader({ contact, identifiers, tags, groups }: ContactHeaderProps) {
  const { mutate: star_contact, isPending } = useStarContact();

  const emails = identifiers.filter((i) => i.type === 'email');
  const phones = identifiers.filter((i) => i.type === 'phone');

  return (
    <div className="space-y-4">
      <Link
        href="/contacts"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to contacts
      </Link>

      <div className="flex items-start gap-6">
        <Avatar name={contact.display_name} url={contact.photo_url} size="lg" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold truncate">{contact.display_name}</h1>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => star_contact({ id: contact.id, starred: !contact.starred })}
              disabled={isPending}
            >
              <Star
                className={`w-5 h-5 ${
                  contact.starred ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground'
                }`}
              />
            </Button>
          </div>

          <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
            {emails.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Mail className="w-4 h-4" />
                <span>{emails[0].value}</span>
              </div>
            )}
            {phones.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Phone className="w-4 h-4" />
                <span>{phones[0].value}</span>
              </div>
            )}
          </div>

          {(tags.length > 0 || groups.length > 0) && (
            <div className="flex flex-wrap gap-2 mt-3">
              {tags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  style={{ backgroundColor: tag.color + '20', color: tag.color }}
                >
                  {tag.name}
                </Badge>
              ))}
              {groups.map((group) => (
                <Badge key={group.id} variant="outline">
                  {group.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
