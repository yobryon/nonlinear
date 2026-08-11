import type {
  CreateDecisionInput,
  CreateDecisionCommentInput,
  Decision,
  DecisionComment,
  UpdateDecisionInput,
} from '@nonlinear/shared';
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

/**
 * First-class decision records. A decision is a judgment, not a work item: its
 * body is the argument, its lifecycle is fixed (`proposed → ruled →
 * superseded | carried`, never "done"), and supersession is a real edge. Read
 * authorization (member-only) is enforced at the transport layer, like issues.
 */
export class DecisionService {
  constructor(private ctx: Ctx) {}

  async create(actorId: string, input: CreateDecisionInput): Promise<Decision> {
    const { storage, bus } = this.ctx;
    const team = await storage.teams.get(input.teamId);
    if (!team) throw notFound('Team');
    const title = input.title.trim();
    if (!title) throw new DomainError('invalid_title', 'A decision needs a title');

    const now = nowIso();
    const number = await storage.decisions.nextNumber(team.id);
    const decision: Decision = {
      id: newId(),
      teamId: team.id,
      number,
      title,
      body: input.body ?? '',
      status: 'proposed',
      authorId: actorId,
      ruledById: null,
      ruledAt: null,
      supersedesId: null,
      governedIssueIds: [...new Set(input.governedIssueIds ?? [])],
      createdAt: now,
      updatedAt: now,
    };
    // Set the supersession edge (and flip the target) BEFORE inserting, so the
    // new decision persists with its `supersedesId` in one write.
    const deltas: DeltaInput[] = [];
    if (input.supersedesId) {
      await this.applySupersession(decision, input.supersedesId, deltas);
    }
    await storage.decisions.insert(decision);
    deltas.unshift(created('decision', decision));
    await bus.publish(deltas);
    return decision;
  }

  async update(actorId: string, id: string, input: UpdateDecisionInput): Promise<Decision> {
    const { storage, bus } = this.ctx;
    const decision = await storage.decisions.get(id);
    if (!decision) throw notFound('Decision');
    if (input.title !== undefined) decision.title = input.title.trim() || decision.title;
    if (input.body !== undefined) decision.body = input.body;
    if (input.governedIssueIds !== undefined) {
      decision.governedIssueIds = [...new Set(input.governedIssueIds)];
    }
    decision.updatedAt = nowIso();
    await storage.decisions.update(decision);
    await bus.publish([updated('decision', decision)]);
    return decision;
  }

  /** Rule on a proposal: the decision is decided, credited to the ruler. */
  async rule(actorId: string, id: string, note?: string): Promise<Decision> {
    const { storage, bus } = this.ctx;
    const decision = await storage.decisions.get(id);
    if (!decision) throw notFound('Decision');
    const now = nowIso();
    decision.status = 'ruled';
    decision.ruledById = actorId;
    decision.ruledAt = now;
    decision.updatedAt = now;
    await storage.decisions.update(decision);
    const deltas: DeltaInput[] = [updated('decision', decision)];
    if (note && note.trim()) {
      deltas.push(...(await this.buildComment(actorId, decision.id, note)));
    }
    await bus.publish(deltas);
    return decision;
  }

  /** Reaffirm a ruled decision after review — still in force, not superseded. */
  async carry(actorId: string, id: string): Promise<Decision> {
    const { storage, bus } = this.ctx;
    const decision = await storage.decisions.get(id);
    if (!decision) throw notFound('Decision');
    decision.status = 'carried';
    decision.updatedAt = nowIso();
    await storage.decisions.update(decision);
    await bus.publish([updated('decision', decision)]);
    return decision;
  }

  /** Record that `id` supersedes `supersededId` (the edge lives on `id`). */
  async setSupersedes(actorId: string, id: string, supersededId: string): Promise<Decision> {
    const { storage, bus } = this.ctx;
    const decision = await storage.decisions.get(id);
    if (!decision) throw notFound('Decision');
    const deltas: DeltaInput[] = [];
    await this.applySupersession(decision, supersededId, deltas);
    decision.updatedAt = nowIso();
    await storage.decisions.update(decision);
    deltas.unshift(updated('decision', decision));
    await bus.publish(deltas);
    return decision;
  }

  private async applySupersession(
    decision: Decision,
    supersededId: string,
    deltas: DeltaInput[],
  ): Promise<void> {
    if (supersededId === decision.id) {
      throw new DomainError('self_supersede', 'A decision cannot supersede itself');
    }
    const target = await this.ctx.storage.decisions.get(supersededId);
    if (!target) throw notFound('Superseded decision');
    if (target.teamId !== decision.teamId) {
      throw new DomainError('cross_team_supersede', 'Decisions supersede within one team');
    }
    decision.supersedesId = target.id;
    target.status = 'superseded';
    target.updatedAt = nowIso();
    await this.ctx.storage.decisions.update(target);
    deltas.push(updated('decision', target));
  }

  async remove(id: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const decision = await storage.decisions.get(id);
    if (!decision) return;
    const deltas: DeltaInput[] = [];
    // Any decision that superseded this one loses its dangling edge.
    for (const other of await storage.decisions.all()) {
      if (other.supersedesId === id) {
        other.supersedesId = null;
        other.updatedAt = nowIso();
        await storage.decisions.update(other);
        deltas.push(updated('decision', other));
      }
    }
    for (const c of await storage.decisionComments.all()) {
      if (c.decisionId === id) {
        await storage.decisionComments.delete(c.id);
        deltas.push(deleted('decisionComment', c.id));
      }
    }
    await storage.decisions.delete(id);
    deltas.push(deleted('decision', id));
    await bus.publish(deltas);
  }

  // ---- comments (where the PO answers a proposal) ----

  async comment(actorId: string, input: CreateDecisionCommentInput): Promise<DecisionComment> {
    const { storage, bus } = this.ctx;
    const deltas = await this.buildComment(actorId, input.decisionId, input.body);
    await bus.publish(deltas);
    return (deltas[0] as { data: DecisionComment }).data;
  }

  private async buildComment(
    actorId: string,
    decisionId: string,
    body: string,
  ): Promise<DeltaInput[]> {
    const { storage } = this.ctx;
    const decision = await storage.decisions.get(decisionId);
    if (!decision) throw notFound('Decision');
    const trimmed = body.trim();
    if (!trimmed) throw new DomainError('empty_comment', 'Comment cannot be empty');
    const now = nowIso();
    const comment: DecisionComment = {
      id: newId(),
      decisionId,
      userId: actorId,
      body: trimmed,
      createdAt: now,
      editedAt: null,
    };
    await storage.decisionComments.insert(comment);
    return [created('decisionComment', comment)];
  }

  async updateComment(actorId: string, commentId: string, body: string): Promise<DecisionComment> {
    const { storage, bus } = this.ctx;
    const comment = await storage.decisionComments.get(commentId);
    if (!comment) throw notFound('Comment');
    if (comment.userId !== actorId) throw new DomainError('forbidden', 'Not your comment', 403);
    comment.body = body.trim() || comment.body;
    comment.editedAt = nowIso();
    await storage.decisionComments.update(comment);
    await bus.publish([updated('decisionComment', comment)]);
    return comment;
  }

  async removeComment(actorId: string, commentId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const comment = await storage.decisionComments.get(commentId);
    if (!comment) return;
    const actor = await storage.users.get(actorId);
    if (comment.userId !== actorId && actor?.role !== 'admin') {
      throw new DomainError('forbidden', 'Not your comment', 403);
    }
    await storage.decisionComments.delete(commentId);
    await bus.publish([deleted('decisionComment', commentId)]);
  }
}
