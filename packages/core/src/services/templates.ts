import type {
  CreateIssueTemplateInput,
  IssueTemplate,
  UpdateIssueTemplateInput,
} from '@nonlinear/shared';
import { DomainError, created, deleted, notFound, updated, type Ctx } from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';

export class IssueTemplateService {
  constructor(private ctx: Ctx) {}

  private async validateLabels(labelIds: string[]): Promise<void> {
    for (const labelId of labelIds) {
      if (!(await this.ctx.storage.labels.get(labelId))) throw notFound('Label');
    }
  }

  async create(input: CreateIssueTemplateInput): Promise<IssueTemplate> {
    const { storage, bus } = this.ctx;
    if (!(await storage.teams.get(input.teamId))) throw notFound('Team');
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'Template name is required');
    const labelIds = input.labelIds ?? [];
    await this.validateLabels(labelIds);
    const now = nowIso();
    const template: IssueTemplate = {
      id: newId(),
      teamId: input.teamId,
      name,
      titlePrefix: input.titlePrefix ?? '',
      description: input.description ?? '',
      priority: input.priority ?? 0,
      labelIds,
      estimate: input.estimate ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await storage.issueTemplates.insert(template);
    await bus.publish([created('issueTemplate', template)]);
    return template;
  }

  async update(templateId: string, input: UpdateIssueTemplateInput): Promise<IssueTemplate> {
    const { storage, bus } = this.ctx;
    const template = await storage.issueTemplates.get(templateId);
    if (!template) throw notFound('Template');
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new DomainError('invalid_name', 'Template name is required');
      template.name = name;
    }
    if (input.titlePrefix !== undefined) template.titlePrefix = input.titlePrefix;
    if (input.description !== undefined) template.description = input.description;
    if (input.priority !== undefined) template.priority = input.priority;
    if (input.labelIds !== undefined) {
      await this.validateLabels(input.labelIds);
      template.labelIds = input.labelIds;
    }
    if (input.estimate !== undefined) template.estimate = input.estimate;
    template.updatedAt = nowIso();
    await storage.issueTemplates.update(template);
    await bus.publish([updated('issueTemplate', template)]);
    return template;
  }

  async remove(templateId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const template = await storage.issueTemplates.get(templateId);
    if (!template) throw notFound('Template');
    await storage.issueTemplates.delete(templateId);
    await bus.publish([deleted('issueTemplate', templateId)]);
  }
}
