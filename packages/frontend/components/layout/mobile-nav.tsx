'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from '@/components/ui/sheet';
import { LayoutDashboard, Users, Search, Bot, Settings, Network, Menu } from 'lucide-react';

const nav_items = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/contacts', icon: Users, label: 'Contacts' },
  { href: '/search', icon: Search, label: 'Search' },
  { href: '/ai', icon: Bot, label: 'AI' },
  { href: '/graph', icon: Network, label: 'Graph' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export function MobileNav() {
  const [is_open, set_is_open] = useState(false);
  const pathname = usePathname();

  const handle_link_click = () => {
    set_is_open(false);
  };

  return (
    <Sheet open={is_open} onOpenChange={set_is_open}>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => set_is_open(true)}
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <SheetContent side="left" className="w-64">
        <SheetHeader>
          <SheetTitle>
            <Link href="/" onClick={handle_link_click} className="font-semibold text-lg">
              PKB
            </Link>
          </SheetTitle>
        </SheetHeader>

        <nav className="flex-1 px-4 space-y-1">
          {nav_items.map((item) => {
            const is_active = pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href));

            return (
              <SheetClose
                key={item.href}
                render={
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      is_active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  />
                }
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </SheetClose>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
