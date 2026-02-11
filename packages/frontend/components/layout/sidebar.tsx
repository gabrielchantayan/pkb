'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Users, Search, Bot, Settings, Network } from 'lucide-react';
import { Doodles } from '../decorative/doodles';

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
    <aside className="hidden md:flex w-52 border-r border-border/70 bg-sidebar/50 flex-col relative overflow-hidden">
      <Doodles count={5} className="opacity-10 pointer-events-none" />
      <nav className="flex-1 p-3 space-y-1 relative z-10">
        {nav_items.map((item) => {
          const is_active = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200',
                is_active
                  ? 'bg-primary/10 text-primary font-bold shadow-sm ring-1 ring-primary/20'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
              )}
            >
              <item.icon className={cn("w-4 h-4", is_active && "stroke-[2.5px]")} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
