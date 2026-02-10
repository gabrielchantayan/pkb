import { FollowupList } from '@/components/dashboard/followup-list';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { StatsCards } from '@/components/dashboard/stats-cards';

export default function DashboardPage() {
  return (
    <div className="space-y-8 animate-in fade-in-0 slide-in-from-bottom-3">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Overview
        </p>
        <h1 className="text-4xl font-semibold">Your relationship atlas</h1>
        <p className="text-muted-foreground max-w-2xl">
          A calm, focused view of the people you care about and the moments that
          matter.
        </p>
      </div>

      <StatsCards />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FollowupList />
        <RecentActivity />
      </div>
    </div>
  );
}
