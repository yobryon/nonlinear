import nodemailer from 'nodemailer';
import type { Domain } from '@nonlinear/core';
import { updated } from '@nonlinear/core';
import type { Notification } from '@nonlinear/shared';
import { issueIdentifier } from '@nonlinear/shared';

const DIGEST_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function describe(n: Notification, actorName: string): string {
  switch (n.type) {
    case 'issue_assigned':
      return `${actorName} assigned you`;
    case 'issue_status_changed':
      return `${actorName} changed the status of`;
    case 'issue_commented':
      return `${actorName} commented on`;
    case 'issue_mentioned':
      return `${actorName} mentioned you in`;
    case 'issue_due_soon':
      return 'Due soon:';
    case 'issue_reminder':
      return 'Reminder:';
    default:
      return 'Update on';
  }
}

/**
 * Daily email digest of unread notifications for opted-in users. No-op unless
 * SMTP_URL is configured. Runs from the API's shared scheduler; users are
 * eligible once per 24h and only emailed when they have unread items.
 */
export function createDigestSender(domain: Domain, smtpUrl: string, from: string, appUrl: string) {
  const transport = nodemailer.createTransport(smtpUrl);

  return async function sendDigests(): Promise<number> {
    const { storage, bus } = domain.ctx;
    const users = await storage.users.all();
    const now = Date.now();
    let sent = 0;

    for (const user of users) {
      if (!user.active || !user.emailDigest) continue;
      const last = user.digestLastSentAt ? Date.parse(user.digestLastSentAt) : 0;
      if (now - last < DIGEST_MIN_INTERVAL_MS) continue;

      const unread = (await storage.notifications.all())
        .filter((n) => n.userId === user.id && !n.readAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50);
      if (unread.length === 0) continue;

      const teams = await storage.teams.all();
      const teamById = new Map(teams.map((t) => [t.id, t]));
      const lines: string[] = [];
      for (const n of unread) {
        const issue = await storage.issues.get(n.issueId);
        if (!issue) continue;
        const team = teamById.get(issue.teamId);
        const key = team ? issueIdentifier(team.key, issue.number) : issue.id.slice(0, 8);
        const actor = n.actorId ? await storage.users.get(n.actorId) : null;
        lines.push(`- ${describe(n, actor?.name ?? 'Someone')} ${key} ${issue.title}`);
        lines.push(`  ${appUrl}/issue/${key}`);
      }
      if (lines.length === 0) continue;

      await transport.sendMail({
        from,
        to: user.email,
        subject: `nonlinear digest: ${unread.length} unread notification${unread.length === 1 ? '' : 's'}`,
        text: `Hi ${user.name},\n\nWhile you were away:\n\n${lines.join('\n')}\n\n— nonlinear\nManage digests in Settings → Profile.`,
      });
      sent += 1;

      user.digestLastSentAt = new Date().toISOString();
      await storage.users.update(user);
      await bus.publish([updated('user', user)]);
    }
    return sent;
  };
}
