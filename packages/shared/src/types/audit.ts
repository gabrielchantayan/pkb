export type AuditAction = 'create' | 'update' | 'delete';

export interface AuditLog {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  action: AuditAction | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  timestamp: Date;
}
