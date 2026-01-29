export interface SyncState {
  source: string;
  last_sync_at: Date | null;
  last_id: string | null;
  metadata: Record<string, unknown> | null;
}
