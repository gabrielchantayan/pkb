'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Users, Search, Bot, Settings, Network } from 'lucide-react';

const nav_items = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/contacts', icon: Users, label: 'Contacts' },
  { href: '/search', icon: Search, label: 'Search' },
  { href: '/ai', icon: Bot, label: 'AI' },
  { href: '/graph', icon: Network, label: 'Graph' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-56 border-r bg-muted/30 flex-col">
      <nav className="flex-1 p-4 space-y-1">
        {nav_items.map((item) => {
          const is_active = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                is_active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
