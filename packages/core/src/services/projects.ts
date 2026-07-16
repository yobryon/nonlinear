import type {
  CreateMilestoneInput,
  CreateProjectInput,
  Project,
  ProjectMilestone,
  UpdateMilestoneInput,
  UpdateProjectInput,
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
import { colorFor } from '../util/colors.js';

export class ProjectService {
  constructor(private ctx: Ctx) {}

  async create(input: CreateProjectInput): Promise<Project> {
    const { storage, bus } = this.ctx;
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'Project name is required');
    if (input.teamIds.length === 0) {
      throw new DomainError('no_teams', 'A project needs at least one team');
    }
    for (const teamId of input.teamIds) {
      if (!(await storage.teams.get(teamId))) throw notFound('Team');
    }
    const now = nowIso();
    const existing = await storage.projects.all();
    const project: Project = {
      id: newId(),
      name,
      description: input.description ?? '',
      icon: input.icon ?? null,
      color: input.color ?? colorFor(name),
      status: input.status ?? 'backlog',
      leadId: input.leadId ?? null,
      initiativeId: input.initiativeId ?? null,
      memberIds: [...new Set(input.memberIds ?? [])],
      teamIds: [...new Set(input.teamIds)],
      startDate: input.startDate ?? null,
      targetDate: input.targetDate ?? null,
      sortOrder: keyAfterAll(existing.map((p) => p.sortOrder)),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      canceledAt: null,
    };
    await storage.projects.insert(project);
    await bus.publish([created('project', project)]);
    return project;
  }

  async update(projectId: string, input: UpdateProjectInput): Promise<Project> {
    const { storage, bus } = this.ctx;
    const project = await storage.projects.get(projectId);
    if (!project) throw notFound('Project');
    const now = nowIso();

    if (input.name !== undefined) project.name = input.name.trim() || project.name;
    if (input.description !== undefined) project.description = input.description;
    if (input.icon !== undefined) project.icon = input.icon;
    if (input.color !== undefined) project.color = input.color;
    if (input.leadId !== undefined) project.leadId = input.leadId;
    if (input.initiativeId !== undefined) {
      if (input.initiativeId && !(await storage.initiatives.get(input.initiativeId))) {
        throw notFound('Initiative');
      }
      project.initiativeId = input.initiativeId;
    }
    if (input.memberIds !== undefined) project.memberIds = [...new Set(input.memberIds)];
    if (input.teamIds !== undefined) {
      if (input.teamIds.length === 0) {
        throw new DomainError('no_teams', 'A project needs at least one team');
      }
      project.teamIds = [...new Set(input.teamIds)];
    }
    if (input.startDate !== undefined) project.startDate = input.startDate;
    if (input.targetDate !== undefined) project.targetDate = input.targetDate;
    if (input.sortOrder !== undefined) project.sortOrder = input.sortOrder;
    if (input.status !== undefined && input.status !== project.status) {
      project.status = input.status;
      project.completedAt = input.status === 'completed' ? now : null;
      project.canceledAt = input.status === 'canceled' ? now : null;
    }
    project.updatedAt = now;
    await storage.projects.update(project);
    await bus.publish([updated('project', project)]);
    return project;
  }

  async remove(projectId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const project = await storage.projects.get(projectId);
    if (!project) throw notFound('Project');
    const deltas: DeltaInput[] = [];
    const now = nowIso();

    for (const issue of await storage.issues.all()) {
      if (issue.projectId === projectId) {
        issue.projectId = null;
        issue.milestoneId = null;
        issue.updatedAt = now;
        await storage.issues.update(issue);
        deltas.push(updated('issue', issue));
      }
    }
    for (const milestone of await storage.projectMilestones.all()) {
      if (milestone.projectId === projectId) {
        await storage.projectMilestones.delete(milestone.id);
        deltas.push(deleted('projectMilestone', milestone.id));
      }
    }
    for (const favorite of await storage.favorites.all()) {
      if (favorite.type === 'project' && favorite.targetId === projectId) {
        await storage.favorites.delete(favorite.id);
        deltas.push(deleted('favorite', favorite.id));
      }
    }
    for (const document of await storage.documents.all()) {
      if (document.projectId === projectId) {
        document.projectId = null;
        document.updatedAt = now;
        await storage.documents.update(document);
        deltas.push(updated('document', document));
      }
    }
    await storage.projects.delete(projectId);
    deltas.push(deleted('project', projectId));
    await bus.publish(deltas);
  }

  async createMilestone(input: CreateMilestoneInput): Promise<ProjectMilestone> {
    const { storage, bus } = this.ctx;
    if (!(await storage.projects.get(input.projectId))) throw notFound('Project');
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'Milestone name is required');
    const siblings = (await storage.projectMilestones.all()).filter(
      (m) => m.projectId === input.projectId,
    );
    const now = nowIso();
    const milestone: ProjectMilestone = {
      id: newId(),
      projectId: input.projectId,
      name,
      description: input.description ?? '',
      targetDate: input.targetDate ?? null,
      sortOrder: keyAfterAll(siblings.map((m) => m.sortOrder)),
      createdAt: now,
      updatedAt: now,
    };
    await storage.projectMilestones.insert(milestone);
    await bus.publish([created('projectMilestone', milestone)]);
    return milestone;
  }

  async updateMilestone(
    milestoneId: string,
    input: UpdateMilestoneInput,
  ): Promise<ProjectMilestone> {
    const { storage, bus } = this.ctx;
    const milestone = await storage.projectMilestones.get(milestoneId);
    if (!milestone) throw notFound('Milestone');
    if (input.name !== undefined) milestone.name = input.name.trim() || milestone.name;
    if (input.description !== undefined) milestone.description = input.description;
    if (input.targetDate !== undefined) milestone.targetDate = input.targetDate;
    if (input.sortOrder !== undefined) milestone.sortOrder = input.sortOrder;
    milestone.updatedAt = nowIso();
    await storage.projectMilestones.update(milestone);
    await bus.publish([updated('projectMilestone', milestone)]);
    return milestone;
  }

  async removeMilestone(milestoneId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const milestone = await storage.projectMilestones.get(milestoneId);
    if (!milestone) throw notFound('Milestone');
    const deltas: DeltaInput[] = [];
    const now = nowIso();
    for (const issue of await storage.issues.all()) {
      if (issue.milestoneId === milestoneId) {
        issue.milestoneId = null;
        issue.updatedAt = now;
        await storage.issues.update(issue);
        deltas.push(updated('issue', issue));
      }
    }
    await storage.projectMilestones.delete(milestoneId);
    deltas.push(deleted('projectMilestone', milestoneId));
    await bus.publish(deltas);
  }
}
