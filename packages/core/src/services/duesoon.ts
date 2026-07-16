import { type Ctx, type DeltaInput } from '../domain.js';
import { pushNotification } from './notify.js';

const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Emits issue_due_soon notifications for issues due within 24h (or overdue)
 * that are not completed/canceled. Deduplicates per user+issue. Called
 * periodically by the API's scheduler.
 */
export class DueSoonService {
  constructor(private ctx: Ctx) {}

  async scan(): Promise<number> {
    const { storage, bus } = this.ctx;
    const now = Date.now();
    const cutoff = new Date(now + DUE_SOON_WINDOW_MS).toISOString();
    const existing = await storage.notifications.all();
    const alreadyNotified = new Set(
      existing.filter((n) => n.type === 'issue_due_soon').map((n) => `${n.userId}:${n.issueId}`),
    );
    const deltas: DeltaInput[] = [];
    for (const issue of await storage.issues.all()) {
      if (!issue.dueDate || issue.dueDate > cutoff) continue;
      if (issue.completedAt || issue.canceledAt || issue.archivedAt) continue;
      const recipients = new Set<string>(issue.subscriberIds);
      if (issue.assigneeId) recipients.add(issue.assigneeId);
      for (const userId of recipients) {
        if (alreadyNotified.has(`${userId}:${issue.id}`)) continue;
        const note = await pushNotification(this.ctx, {
          userId,
          actorId: null,
          type: 'issue_due_soon',
          issueId: issue.id,
        });
        if (note) {
          deltas.push(note);
          alreadyNotified.add(`${userId}:${issue.id}`);
        }
      }
    }
    await bus.publish(deltas);
    return deltas.length;
  }
}
