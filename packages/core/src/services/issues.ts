import type {
  ActivityType,
  CreateIssueInput,
  Issue,
  IssueActivity,
  UpdateIssueInput,
  WorkflowState,
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
import { keyAfterAll } from '../util/fractional.js';
import { pushNotification } from './notify.js';
import type { AttachmentService } from './attachments.js';

const CATEGORY_DEFAULT_ORDER = ['backlog', 'unstarted', 'triage', 'started'] as const;

export class IssueService {
  constructor(
    private ctx: Ctx,
    private attachments?: AttachmentService,
  ) {}

  private async defaultState(teamId: string): Promise<WorkflowState> {
    const team = await this.ctx.storage.teams.get(teamId);
    const states = (await this.ctx.storage.workflowStates.all())
      .filter((s) => s.teamId === teamId)
      .sort((a, b) => a.position - b.position);
    if (team?.triageEnabled) {
      const triage = states.find((s) => s.category === 'triage');
      if (triage) return triage;
    }
    for (const category of CATEGORY_DEFAULT_ORDER) {
      const match = states.find((s) => s.category === category);
      if (match) return match;
    }
    const first = states[0];
    if (!first) throw new DomainError('no_states', 'Team has no workflow states', 409);
    return first;
  }

  /** SLA: derive a due date from priority when the team has SLAs configured. */
  private slaDueDate(
    team: { slaUrgentHours: number | null; slaHighHours: number | null },
    priority: number,
  ): string | null {
    const hours = priority === 1 ? team.slaUrgentHours : priority === 2 ? team.slaHighHours : null;
    return hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
  }

  private async recordActivity(
    issueId: string,
    actorId: string,
    type: ActivityType,
    data: Record<string, unknown> = {},
  ): Promise<DeltaInput> {
    const activity: IssueActivity = {
      id: newId(),
      issueId,
      actorId,
      type,
      data,
      createdAt: nowIso(),
    };
    await this.ctx.storage.activities.insert(activity);
    return created('issueActivity', activity);
  }

  async create(actorId: string, input: CreateIssueInput): Promise<Issue> {
    const { storage, bus } = this.ctx;
    const team = await storage.teams.get(input.teamId);
    if (!team) throw notFound('Team');
    const title = input.title.trim();
    if (!title) throw new DomainError('invalid_title', 'Title is required');

    const state = input.stateId
      ? await storage.workflowStates.get(input.stateId)
      : await this.defaultState(team.id);
    if (!state || state.teamId !== team.id) throw notFound('Workflow state');

    if (input.parentId) {
      const parent = await storage.issues.get(input.parentId);
      if (!parent) throw notFound('Parent issue');
    }

    const now = nowIso();
    const number = await storage.teams.nextIssueNumber(team.id);
    const siblings = await storage.issues.byTeam(team.id);
    const subscriberIds = new Set<string>([actorId]);
    if (input.assigneeId) subscriberIds.add(input.assigneeId);

    const issue: Issue = {
      id: newId(),
      teamId: team.id,
      number,
      title,
      description: input.description ?? '',
      stateId: state.id,
      priority: input.priority ?? 0,
      assigneeId: input.assigneeId ?? null,
      creatorId: actorId,
      projectId: input.projectId ?? null,
      milestoneId: input.milestoneId ?? null,
      cycleId: input.cycleId ?? null,
      parentId: input.parentId ?? null,
      estimate: input.estimate ?? null,
      dueDate: input.dueDate ?? this.slaDueDate(team, input.priority ?? 0),
      labelIds: [...new Set(input.labelIds ?? [])],
      subscriberIds: [...subscriberIds],
      sortOrder: input.sortOrder ?? keyAfterAll(siblings.map((i) => i.sortOrder)),
      createdAt: now,
      updatedAt: now,
      startedAt: state.category === 'started' ? now : null,
      completedAt: state.category === 'completed' ? now : null,
      canceledAt: state.category === 'canceled' ? now : null,
      archivedAt: null,
    };
    await storage.issues.insert(issue);

    const teamUpdate = { ...team, issueCounter: number, updatedAt: now };
    await storage.teams.update(teamUpdate);

    const deltas: DeltaInput[] = [created('issue', issue), updated('team', teamUpdate)];
    deltas.push(await this.recordActivity(issue.id, actorId, 'created'));
    if (issue.assigneeId) {
      const note = await pushNotification(this.ctx, {
        userId: issue.assigneeId,
        actorId,
        type: 'issue_assigned',
        issueId: issue.id,
      });
      if (note) deltas.push(note);
    }
    await bus.publish(deltas);
    return issue;
  }

  async update(actorId: string, issueId: string, input: UpdateIssueInput): Promise<Issue> {
    const { storage, bus } = this.ctx;
    const issue = await storage.issues.get(issueId);
    if (!issue) throw notFound('Issue');
    const before = { ...issue, labelIds: [...issue.labelIds] };
    const deltas: DeltaInput[] = [];
    const now = nowIso();

    if (input.title !== undefined && input.title.trim() && input.title.trim() !== issue.title) {
      deltas.push(
        await this.recordActivity(issueId, actorId, 'title_changed', {
          from: issue.title,
          to: input.title.trim(),
        }),
      );
      issue.title = input.title.trim();
    }
    if (input.description !== undefined && input.description !== issue.description) {
      issue.description = input.description;
      deltas.push(await this.recordActivity(issueId, actorId, 'description_changed'));
    }

    if (input.teamId !== undefined && input.teamId !== issue.teamId) {
      const team = await storage.teams.get(input.teamId);
      if (!team) throw notFound('Team');
      issue.teamId = team.id;
      issue.number = await storage.teams.nextIssueNumber(team.id);
      issue.cycleId = null;
      const newState = await this.defaultState(team.id);
      issue.stateId = newState.id;
      const teamUpdate = { ...team, issueCounter: issue.number, updatedAt: now };
      await storage.teams.update(teamUpdate);
      deltas.push(updated('team', teamUpdate));
    }

    if (input.stateId !== undefined && input.stateId !== issue.stateId) {
      const state = await storage.workflowStates.get(input.stateId);
      if (!state || state.teamId !== issue.teamId) throw notFound('Workflow state');
      const prev = await storage.workflowStates.get(issue.stateId);
      issue.stateId = state.id;
      issue.startedAt = state.category === 'started' ? (issue.startedAt ?? now) : issue.startedAt;
      issue.completedAt = state.category === 'completed' ? now : null;
      issue.canceledAt = state.category === 'canceled' ? now : null;
      deltas.push(
        await this.recordActivity(issueId, actorId, 'state_changed', {
          fromId: prev?.id ?? null,
          from: prev?.name ?? null,
          toId: state.id,
          to: state.name,
        }),
      );
      for (const userId of issue.subscriberIds) {
        const note = await pushNotification(this.ctx, {
          userId,
          actorId,
          type: 'issue_status_changed',
          issueId,
        });
        if (note) deltas.push(note);
      }
    }

    if (input.priority !== undefined && input.priority !== issue.priority) {
      deltas.push(
        await this.recordActivity(issueId, actorId, 'priority_changed', {
          from: issue.priority,
          to: input.priority,
        }),
      );
      issue.priority = input.priority;
      if (!issue.dueDate && input.dueDate === undefined) {
        const team = await storage.teams.get(issue.teamId);
        if (team) issue.dueDate = this.slaDueDate(team, input.priority);
      }
    }

    if (input.assigneeId !== undefined && input.assigneeId !== issue.assigneeId) {
      deltas.push(
        await this.recordActivity(issueId, actorId, 'assignee_changed', {
          fromId: issue.assigneeId,
          toId: input.assigneeId,
        }),
      );
      issue.assigneeId = input.assigneeId;
      if (input.assigneeId) {
        if (!issue.subscriberIds.includes(input.assigneeId)) {
          issue.subscriberIds = [...issue.subscriberIds, input.assigneeId];
        }
        const note = await pushNotification(this.ctx, {
          userId: input.assigneeId,
          actorId,
          type: 'issue_assigned',
          issueId,
        });
        if (note) deltas.push(note);
      }
    }

    if (input.projectId !== undefined && input.projectId !== issue.projectId) {
      if (input.projectId && !(await storage.projects.get(input.projectId))) {
        throw notFound('Project');
      }
      deltas.push(
        await this.recordActivity(issueId, actorId, 'project_changed', {
          fromId: issue.projectId,
          toId: input.projectId,
        }),
      );
      issue.projectId = input.projectId;
      if (!input.projectId) issue.milestoneId = null;
    }
    if (input.milestoneId !== undefined) issue.milestoneId = input.milestoneId;

    if (input.cycleId !== undefined && input.cycleId !== issue.cycleId) {
      if (input.cycleId) {
        const cycle = await storage.cycles.get(input.cycleId);
        if (!cycle || cycle.teamId !== issue.teamId) throw notFound('Cycle');
      }
      deltas.push(
        await this.recordActivity(issueId, actorId, 'cycle_changed', {
          fromId: issue.cycleId,
          toId: input.cycleId,
        }),
      );
      issue.cycleId = input.cycleId;
    }

    if (input.parentId !== undefined && input.parentId !== issue.parentId) {
      if (input.parentId) {
        if (input.parentId === issueId) {
          throw new DomainError('cyclic_parent', 'An issue cannot be its own parent');
        }
        let ancestor = await storage.issues.get(input.parentId);
        if (!ancestor) throw notFound('Parent issue');
        while (ancestor) {
          if (ancestor.id === issueId) {
            throw new DomainError('cyclic_parent', 'Sub-issue cycles are not allowed');
          }
          ancestor = ancestor.parentId ? await storage.issues.get(ancestor.parentId) : null;
        }
      }
      deltas.push(
        await this.recordActivity(issueId, actorId, 'parent_changed', {
          fromId: issue.parentId,
          toId: input.parentId,
        }),
      );
      issue.parentId = input.parentId;
    }

    if (input.estimate !== undefined && input.estimate !== issue.estimate) {
      deltas.push(
        await this.recordActivity(issueId, actorId, 'estimate_changed', {
          from: issue.estimate,
          to: input.estimate,
        }),
      );
      issue.estimate = input.estimate;
    }

    if (input.dueDate !== undefined && input.dueDate !== issue.dueDate) {
      deltas.push(
        await this.recordActivity(issueId, actorId, 'due_date_changed', {
          from: issue.dueDate,
          to: input.dueDate,
        }),
      );
      issue.dueDate = input.dueDate;
    }

    if (input.labelIds !== undefined) {
      const next = [...new Set(input.labelIds)];
      const beforeSet = new Set(before.labelIds);
      const nextSet = new Set(next);
      for (const id of next) {
        if (!beforeSet.has(id)) {
          const label = await storage.labels.get(id);
          if (!label) throw notFound('Label');
          deltas.push(await this.recordActivity(issueId, actorId, 'label_added', { labelId: id }));
        }
      }
      for (const id of before.labelIds) {
        if (!nextSet.has(id)) {
          deltas.push(
            await this.recordActivity(issueId, actorId, 'label_removed', { labelId: id }),
          );
        }
      }
      issue.labelIds = next;
    }

    if (input.subscriberIds !== undefined) issue.subscriberIds = [...new Set(input.subscriberIds)];
    if (input.sortOrder !== undefined) issue.sortOrder = input.sortOrder;
    if (input.archived !== undefined) issue.archivedAt = input.archived ? now : null;

    issue.updatedAt = now;
    await storage.issues.update(issue);
    deltas.unshift(updated('issue', issue));
    await bus.publish(deltas);
    return issue;
  }

  async remove(issueId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const issue = await storage.issues.get(issueId);
    if (!issue) throw notFound('Issue');
    const deltas: DeltaInput[] = [];

    for (const comment of await storage.comments.all()) {
      if (comment.issueId !== issueId) continue;
      for (const reaction of await storage.reactions.all()) {
        if (reaction.commentId === comment.id) {
          await storage.reactions.delete(reaction.id);
          deltas.push(deleted('reaction', reaction.id));
        }
      }
      await storage.comments.delete(comment.id);
      deltas.push(deleted('comment', comment.id));
    }
    for (const relation of await storage.issueRelations.all()) {
      if (relation.issueId === issueId || relation.relatedIssueId === issueId) {
        await storage.issueRelations.delete(relation.id);
        deltas.push(deleted('issueRelation', relation.id));
      }
    }
    for (const notification of await storage.notifications.all()) {
      if (notification.issueId === issueId) {
        await storage.notifications.delete(notification.id);
        deltas.push(deleted('notification', notification.id));
      }
    }
    for (const favorite of await storage.favorites.all()) {
      if (favorite.type === 'issue' && favorite.targetId === issueId) {
        await storage.favorites.delete(favorite.id);
        deltas.push(deleted('favorite', favorite.id));
      }
    }
    for (const activity of await storage.activities.byIssue(issueId)) {
      await storage.activities.delete(activity.id);
      deltas.push(deleted('issueActivity', activity.id));
    }
    if (this.attachments) {
      deltas.push(...(await this.attachments.removeForIssue(issueId)));
    }
    for (const child of await storage.issues.all()) {
      if (child.parentId === issueId) {
        child.parentId = null;
        child.updatedAt = nowIso();
        await storage.issues.update(child);
        deltas.push(updated('issue', child));
      }
    }
    await storage.issues.delete(issueId);
    deltas.push(deleted('issue', issueId));
    await bus.publish(deltas);
  }
}
