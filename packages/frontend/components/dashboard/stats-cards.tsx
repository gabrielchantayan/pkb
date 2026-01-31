'use client';

import { useDashboard } from '@/lib/hooks/use-dashboard';
import { Card, CardContent } from '@/components/ui/card';
import { Users, Bell, MessageSquare } from 'lucide-react';

export function StatsCards() {
  const { data, isLoading } = useDashboard();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="h-12 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const stats = [
    {
      label: 'Total Contacts',
      value: data?.stats.total_contacts ?? 0,
      icon: Users,
      color: 'text-blue-500',
    },
    {
      label: 'Pending Follow-ups',
      value: data?.stats.pending_followups ?? 0,
      icon: Bell,
      color: 'text-amber-500',
    },
    {
      label: 'Recent Communications',
      value: data?.stats.recent_communications ?? 0,
      icon: MessageSquare,
      color: 'text-green-500',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className={`p-2 rounded-lg bg-muted ${stat.color}`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
