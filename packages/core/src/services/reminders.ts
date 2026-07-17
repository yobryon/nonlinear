import type { IssueReminder, SetReminderInput } from '@nonlinear/shared';
import {
  DomainError,
  created,
  deleted,
  notFound,
  updated,
  type Ctx,
  type DeltaInput,
} from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { pushNotification } from './notify.js';

/**
 * Personal "remind me about this issue" reminders. One per user+issue;
 * fired (and deleted) by a periodic scan that emits issue_reminder
 * notifications.
 */
export class ReminderService {
  constructor(private ctx: Ctx) {}

  /** Create or move the caller's reminder for an issue. */
  async set(userId: string, input: SetReminderInput): Promise<IssueReminder> {
    const { storage, bus } = this.ctx;
    if (!(await storage.issues.get(input.issueId))) throw notFound('Issue');
    if (Number.isNaN(Date.parse(input.remindAt))) {
      throw new DomainError('invalid_remind_at', 'remindAt must be a valid ISO date string');
    }
    const existing = (await storage.issueReminders.all()).find(
      (r) => r.userId === userId && r.issueId === input.issueId,
    );
    if (existing) {
      existing.remindAt = input.remindAt;
      await storage.issueReminders.update(existing);
      await bus.publish([updated('issueReminder', existing)]);
      return existing;
    }
    const reminder: IssueReminder = {
      id: newId(),
      issueId: input.issueId,
      userId,
      remindAt: input.remindAt,
      createdAt: nowIso(),
    };
    await storage.issueReminders.insert(reminder);
    await bus.publish([created('issueReminder', reminder)]);
    return reminder;
  }

  /** Delete the caller's own reminder. Missing reminders are a no-op. */
  async clear(userId: string, reminderId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const reminder = await storage.issueReminders.get(reminderId);
    if (!reminder) return;
    if (reminder.userId !== userId) {
      throw new DomainError('forbidden', 'Cannot clear another user’s reminder', 403);
    }
    await storage.issueReminders.delete(reminderId);
    await bus.publish([deleted('issueReminder', reminderId)]);
  }

  /**
   * Fire every reminder whose remindAt has passed: emit an issue_reminder
   * notification and delete the reminder. Reminders whose issue no longer
   * exists are deleted without notifying. Returns the number fired.
   */
  async scan(): Promise<number> {
    const { storage, bus } = this.ctx;
    const now = Date.now();
    const deltas: DeltaInput[] = [];
    let fired = 0;
    for (const reminder of await storage.issueReminders.all()) {
      if (Date.parse(reminder.remindAt) > now) continue;
      const issue = await storage.issues.get(reminder.issueId);
      if (issue) {
        const note = await pushNotification(this.ctx, {
          userId: reminder.userId,
          actorId: null,
          type: 'issue_reminder',
          issueId: reminder.issueId,
        });
        if (note) deltas.push(note);
        fired += 1;
      }
      await storage.issueReminders.delete(reminder.id);
      deltas.push(deleted('issueReminder', reminder.id));
    }
    await bus.publish(deltas);
    return fired;
  }

  /**
   * Delete all reminders for an issue and return the deltas WITHOUT
   * publishing — for the issue-delete cascade, which batches them into
   * its own publish.
   */
  async removeForIssue(issueId: string): Promise<DeltaInput[]> {
    const { storage } = this.ctx;
    const deltas: DeltaInput[] = [];
    for (const reminder of await storage.issueReminders.all()) {
      if (reminder.issueId !== issueId) continue;
      await storage.issueReminders.delete(reminder.id);
      deltas.push(deleted('issueReminder', reminder.id));
    }
    return deltas;
  }
}
