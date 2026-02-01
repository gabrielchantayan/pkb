'use client';

import { useState } from 'react';
import { useContacts } from '@/lib/hooks/use-contacts';
import { Contact } from '@/lib/api';
import { Avatar } from '@/components/shared/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Search, Loader2 } from 'lucide-react';

interface ContactPickerDialogProps {
  open: boolean;
  on_close: () => void;
  on_select: (contact: Contact) => void;
  exclude_id?: string;
  title?: string;
  description?: string;
}

export function ContactPickerDialog({
  open,
  on_close,
  on_select,
  exclude_id,
  title = 'Select Contact',
  description = 'Search for a contact to select.',
}: ContactPickerDialogProps) {
  const [search, set_search] = useState('');
  const { data, isLoading } = useContacts({ search, limit: 20 });

  const contacts = data?.pages.flatMap((p) => p.contacts).filter((c) => c.id !== exclude_id) ?? [];

  function handle_select(contact: Contact) {
    on_select(contact);
    on_close();
    set_search('');
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          on_close();
          set_search('');
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => set_search(e.target.value)}
              className="pl-8"
              autoFocus
            />
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : contacts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {search ? 'No contacts found' : 'Start typing to search'}
              </div>
            ) : (
              contacts.map((contact) => (
                <button
                  key={contact.id}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors text-left"
                  onClick={() => handle_select(contact)}
                >
                  <Avatar name={contact.display_name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{contact.display_name}</div>
                    {contact.emails?.[0] && (
                      <div className="text-xs text-muted-foreground truncate">
                        {contact.emails[0]}
                      </div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={on_close}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
