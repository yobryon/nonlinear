import { beforeEach, describe, expect, it } from 'vitest';
import type { Issue, User } from '@nonlinear/shared';
import { createMemoryStorage } from '../memory.js';
import { SyncBus, type Ctx } from '../domain.js';
import { AuthService } from './auth.js';
import { IssueService } from './issues.js';
import { ReminderService } from './reminders.js';

const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

let ctx: Ctx;
let service: ReminderService;
let user: User;
let other: User;
let issue: Issue;

beforeEach(async () => {
  const storage = createMemoryStorage();
  const bus = new SyncBus(storage.syncLog);
  ctx = { storage, bus };
  service = new ReminderService(ctx);
  const auth = new AuthService(ctx);
  const registered = await auth.register({
    email: 'ada@example.com',
    password: 'hunter2hunter2',
    name: 'Ada Lovelace',
    workspaceName: 'Acme',
  });
  user = registered.user;
  other = (
    await auth.register({
      email: 'grace@example.com',
      password: 'hunter2hunter2',
      name: 'Grace Hopper',
    })
  ).user;
  const team = (await storage.teams.all())[0]!;
  issue = await new IssueService(ctx).create(user.id, { teamId: team.id, title: 'Remind me' });
});

describe('ReminderService.set', () => {
  it('inserts a reminder, then updates it on repeat (one per user+issue)', async () => {
    const first = await service.set(user.id, { issueId: issue.id, remindAt: FUTURE });
    expect(first.userId).toBe(user.id);
    expect(first.remindAt).toBe(FUTURE);

    const later = '2099-06-01T00:00:00.000Z';
    const second = await service.set(user.id, { issueId: issue.id, remindAt: later });
    expect(second.id).toBe(first.id);
    expect(second.remindAt).toBe(later);
    expect(await ctx.storage.issueReminders.all()).toHaveLength(1);

    // A different user gets their own reminder.
    await service.set(other.id, { issueId: issue.id, remindAt: FUTURE });
    expect(await ctx.storage.issueReminders.all()).toHaveLength(2);
  });

  it('rejects missing issues and unparseable dates', async () => {
    await expect(service.set(user.id, { issueId: 'nope', remindAt: FUTURE })).rejects.toThrow(
      /not found/i,
    );
    await expect(
      service.set(user.id, { issueId: issue.id, remindAt: 'not-a-date' }),
    ).rejects.toThrow(/valid ISO date/i);
  });
});

describe('ReminderService.scan', () => {
  it('fires due reminders once: notification created, reminder deleted', async () => {
    const reminder = await service.set(user.id, { issueId: issue.id, remindAt: PAST });

    expect(await service.scan()).toBe(1);
    const notifications = await ctx.storage.notifications.all();
    const fired = notifications.filter((n) => n.type === 'issue_reminder');
    expect(fired).toHaveLength(1);
    expect(fired[0]!.userId).toBe(user.id);
    expect(fired[0]!.issueId).toBe(issue.id);
    expect(fired[0]!.actorId).toBeNull();
    expect(await ctx.storage.issueReminders.get(reminder.id)).toBeNull();

    // Second scan finds nothing.
    expect(await service.scan()).toBe(0);
    expect(
      (await ctx.storage.notifications.all()).filter((n) => n.type === 'issue_reminder'),
    ).toHaveLength(1);
  });

  it('leaves future reminders alone', async () => {
    const reminder = await service.set(user.id, { issueId: issue.id, remindAt: FUTURE });
    expect(await service.scan()).toBe(0);
    expect(await ctx.storage.issueReminders.get(reminder.id)).not.toBeNull();
    expect(
      (await ctx.storage.notifications.all()).filter((n) => n.type === 'issue_reminder'),
    ).toHaveLength(0);
  });

  it('deletes reminders whose issue vanished without notifying', async () => {
    const reminder = await service.set(user.id, { issueId: issue.id, remindAt: PAST });
    await ctx.storage.issues.delete(issue.id);
    expect(await service.scan()).toBe(0);
    expect(await ctx.storage.issueReminders.get(reminder.id)).toBeNull();
    expect(
      (await ctx.storage.notifications.all()).filter((n) => n.type === 'issue_reminder'),
    ).toHaveLength(0);
  });
});

describe('ReminderService.clear', () => {
  it('deletes own reminders, silently ignores missing, 403s on others', async () => {
    const reminder = await service.set(user.id, { issueId: issue.id, remindAt: FUTURE });

    await expect(service.clear(other.id, reminder.id)).rejects.toMatchObject({ status: 403 });
    expect(await ctx.storage.issueReminders.get(reminder.id)).not.toBeNull();

    await service.clear(user.id, reminder.id);
    expect(await ctx.storage.issueReminders.get(reminder.id)).toBeNull();

    // Clearing again (missing) is a no-op.
    await expect(service.clear(user.id, reminder.id)).resolves.toBeUndefined();
  });
});

describe('ReminderService.removeForIssue', () => {
  it('deletes all reminders for the issue and returns unpublished deltas', async () => {
    const a = await service.set(user.id, { issueId: issue.id, remindAt: FUTURE });
    const b = await service.set(other.id, { issueId: issue.id, remindAt: FUTURE });
    const before = await ctx.storage.syncLog.currentSyncId();

    const deltas = await service.removeForIssue(issue.id);
    expect(deltas).toHaveLength(2);
    expect(new Set(deltas.map((d) => (d.data as { id: string }).id))).toEqual(
      new Set([a.id, b.id]),
    );
    for (const d of deltas) {
      expect(d).toMatchObject({ model: 'issueReminder', action: 'delete' });
    }
    expect(await ctx.storage.issueReminders.all()).toHaveLength(0);
    // Nothing published — caller batches these into its own publish.
    expect(await ctx.storage.syncLog.currentSyncId()).toBe(before);
  });
});
