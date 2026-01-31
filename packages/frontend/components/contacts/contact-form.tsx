'use client';

import { useState } from 'react';
import { useCreateContact } from '@/lib/hooks/use-contacts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';

export function AddContactDialog() {
  const [open, set_open] = useState(false);
  const [display_name, set_display_name] = useState('');
  const [email, set_email] = useState('');
  const [phone, set_phone] = useState('');
  const { mutate: create_contact, isPending } = useCreateContact();

  function handle_submit(e: React.FormEvent) {
    e.preventDefault();
    create_contact(
      {
        display_name,
        emails: email ? [email] : undefined,
        phone_numbers: phone ? [phone] : undefined,
      },
      {
        onSuccess: () => {
          set_open(false);
          set_display_name('');
          set_email('');
          set_phone('');
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={set_open}>
      <DialogTrigger render={<Button />}>
        <Plus className="w-4 h-4 mr-2" />
        Add Contact
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
        </DialogHeader>
        <form onSubmit={handle_submit} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={display_name}
              onChange={(e) => set_display_name(e.target.value)}
              placeholder="John Doe"
              required
            />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => set_email(e.target.value)}
              placeholder="john@example.com"
            />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => set_phone(e.target.value)}
              placeholder="+1 234 567 8900"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => set_open(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !display_name}>
              {isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
