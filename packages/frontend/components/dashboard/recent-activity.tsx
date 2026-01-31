'use client';

import Link from 'next/link';
import { useDashboard } from '@/lib/hooks/use-dashboard';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingCard } from '@/components/shared/loading';
import { format_relative_date } from '@/lib/utils';
import { Activity, Mail, MessageSquare, Phone, FileText } from 'lucide-react';

const type_icons: Record<string, typeof Mail> = {
  email: Mail,
  message: MessageSquare,
  call: Phone,
  note: FileText,
};

export function RecentActivity() {
  const { data, isLoading } = useDashboard();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <LoadingCard />
      </Card>
    );
  }

  const activities = data?.recent_activity ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activities.length > 0 ? (
          <div className="space-y-3">
            {activities.map((activity) => {
              const Icon = type_icons[activity.type] || Activity;
              return (
                <Link
                  key={activity.id}
                  href={`/contacts/${activity.contact_id}`}
                  className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted transition-colors"
                >
                  <div className="p-1.5 rounded bg-muted">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{activity.contact_name}</span>
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {activity.description}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format_relative_date(activity.timestamp)}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm py-4 text-center">
            No recent activity
          </p>
        )}
      </CardContent>
    </Card>
  );
}
