import type {
  Comment,
  CreateCommentInput,
  CreateReactionInput,
  Reaction,
} from '@nonlinear/shared';
import { DomainError, created, deleted, notFound, updated, type Ctx, type DeltaInput } from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { mentionedUserIds, pushNotification } from './notify.js';

export class CommentService {
  constructor(private ctx: Ctx) {}

  async create(actorId: string, input: CreateCommentInput): Promise<Comment> {
    const { storage, bus } = this.ctx;
    const issue = await storage.issues.get(input.issueId);
    if (!issue) throw notFound('Issue');
    const body = input.body.trim();
    if (!body) throw new DomainError('empty_comment', 'Comment cannot be empty');

    const now = nowIso();
    const comment: Comment = {
      id: newId(),
      issueId: issue.id,
      userId: actorId,
      body,
      createdAt: now,
      updatedAt: now,
      editedAt: null,
    };
    await storage.comments.insert(comment);
    const deltas: DeltaInput[] = [created('comment', comment)];

    // Commenting subscribes you to the issue.
    if (!issue.subscriberIds.includes(actorId)) {
      issue.subscriberIds = [...issue.subscriberIds, actorId];
      issue.updatedAt = now;
      await storage.issues.update(issue);
      deltas.push(updated('issue', issue));
    }

    const mentioned = new Set(await mentionedUserIds(this.ctx, body));
    for (const userId of mentioned) {
      const note = await pushNotification(this.ctx, {
        userId,
        actorId,
        type: 'issue_mentioned',
        issueId: issue.id,
        commentId: comment.id,
      });
      if (note) deltas.push(note);
    }
    for (const userId of issue.subscriberIds) {
      if (mentioned.has(userId)) continue;
      const note = await pushNotification(this.ctx, {
        userId,
        actorId,
        type: 'issue_commented',
        issueId: issue.id,
        commentId: comment.id,
      });
      if (note) deltas.push(note);
    }
    await bus.publish(deltas);
    return comment;
  }

  async update(actorId: string, commentId: string, body: string): Promise<Comment> {
    const { storage, bus } = this.ctx;
    const comment = await storage.comments.get(commentId);
    if (!comment) throw notFound('Comment');
    if (comment.userId !== actorId) {
      throw new DomainError('forbidden', 'You can only edit your own comments', 403);
    }
    const trimmed = body.trim();
    if (!trimmed) throw new DomainError('empty_comment', 'Comment cannot be empty');
    comment.body = trimmed;
    comment.editedAt = nowIso();
    comment.updatedAt = comment.editedAt;
    await storage.comments.update(comment);
    await bus.publish([updated('comment', comment)]);
    return comment;
  }

  async remove(actorId: string, commentId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const comment = await storage.comments.get(commentId);
    if (!comment) throw notFound('Comment');
    const actor = await storage.users.get(actorId);
    if (comment.userId !== actorId && actor?.role !== 'admin') {
      throw new DomainError('forbidden', 'You can only delete your own comments', 403);
    }
    const deltas: DeltaInput[] = [];
    for (const reaction of await storage.reactions.all()) {
      if (reaction.commentId === commentId) {
        await storage.reactions.delete(reaction.id);
        deltas.push(deleted('reaction', reaction.id));
      }
    }
    await storage.comments.delete(commentId);
    deltas.push(deleted('comment', commentId));
    await bus.publish(deltas);
  }

  async addReaction(actorId: string, input: CreateReactionInput): Promise<Reaction> {
    const { storage, bus } = this.ctx;
    if (!(await storage.comments.get(input.commentId))) throw notFound('Comment');
    for (const existing of await storage.reactions.all()) {
      if (
        existing.commentId === input.commentId &&
        existing.userId === actorId &&
        existing.emoji === input.emoji
      ) {
        return existing;
      }
    }
    const reaction: Reaction = {
      id: newId(),
      commentId: input.commentId,
      userId: actorId,
      emoji: input.emoji,
      createdAt: nowIso(),
    };
    await storage.reactions.insert(reaction);
    await bus.publish([created('reaction', reaction)]);
    return reaction;
  }

  async removeReaction(actorId: string, reactionId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const reaction = await storage.reactions.get(reactionId);
    if (!reaction) return;
    if (reaction.userId !== actorId) {
      throw new DomainError('forbidden', 'You can only remove your own reactions', 403);
    }
    await storage.reactions.delete(reactionId);
    await bus.publish([deleted('reaction', reactionId)]);
  }
}
