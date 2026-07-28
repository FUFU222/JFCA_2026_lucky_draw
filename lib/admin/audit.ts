import 'server-only';

import { createServiceRoleClient } from '../db/server';

export type AuditAction =
  | 'ADMIN_LOGIN'
  | 'EXPORT_CSV'
  | 'PAUSE_REGISTRATION'
  | 'RESUME_REGISTRATION';

export interface AuditEntry {
  action: AuditAction;
  actorId: string;
  actorEmail: string;
  campaignId?: string | null;
  /** Never the exported data itself — only what was asked for. */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Records who did what. The exported rows are deliberately absent: an audit
 * trail that copies the personal data it is auditing doubles the exposure.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  const { error } = await createServiceRoleClient()
    .from('admin_audit_logs')
    .insert({
      admin_user_id: entry.actorId,
      campaign_id: entry.campaignId ?? null,
      action: entry.action,
      metadata: { actor_email: entry.actorEmail, ...(entry.metadata ?? {}) },
    });
  if (error) throw error;
}
