import type { Notification, NotificationType } from '@nonlinear/shared';
import { created, type Ctx, type DeltaInput } from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';

export async function pushNotification(
  ctx: Ctx,
  params: {
    userId: string;
    actorId: string | null;
    type: NotificationType;
    issueId: string;
    commentId?: string | null;
  },
): Promise<DeltaInput | null> {
  if (params.actorId === params.userId) return null;
  const notification: Notification = {
    id: newId(),
    userId: params.userId,
    actorId: params.actorId,
    type: params.type,
    issueId: params.issueId,
    commentId: params.commentId ?? null,
    createdAt: nowIso(),
    readAt: null,
  };
  await ctx.storage.notifications.insert(notification);
  return created('notification', notification);
}

/** Resolve @displayName mentions in markdown to user ids. */
export async function mentionedUserIds(ctx: Ctx, body: string): Promise<string[]> {
  const handles = new Set<string>();
  for (const match of body.matchAll(/(?:^|[^\w])@([a-z0-9][a-z0-9._-]*)/gi)) {
    handles.add(match[1]!.toLowerCase());
  }
  if (handles.size === 0) return [];
  const users = await ctx.storage.users.all();
  return users.filter((u) => handles.has(u.displayName.toLowerCase())).map((u) => u.id);
}
