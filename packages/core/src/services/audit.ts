import type { AuditAction, AuditEvent } from '@nonlinear/shared';
import type { AuditPage } from '../storage.js';
import type { Ctx } from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';

export interface AuditInput {
  action: AuditAction;
  actorId: string | null;
  actorLabel: string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Workspace-level security/admin audit log. Deliberately fire-and-log: a
 * failure to write an audit row must never break the action being audited,
 * so `record` swallows storage errors (and surfaces them on stderr).
 *
 * Audit events are not synced to clients — they can grow without bound and are
 * admin-only. Read them through {@link list} (paged, most-recent-first).
 */
export class AuditService {
  constructor(private ctx: Ctx) {}

  async record(input: AuditInput): Promise<void> {
    const event: AuditEvent = {
      id: newId(),
      action: input.action,
      actorId: input.actorId,
      actorLabel: input.actorLabel,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      metadata: input.metadata ?? {},
      ip: input.ip ?? null,
      createdAt: nowIso(),
    };
    try {
      await this.ctx.storage.auditLog.append(event);
    } catch (err) {
      console.error('[audit] failed to record event', input.action, err);
    }
  }

  async list(opts: { limit?: number; cursor?: string | null } = {}): Promise<AuditPage> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return this.ctx.storage.auditLog.list({ limit, cursor: opts.cursor ?? null });
  }
}
