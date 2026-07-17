import type {
  CreateIssueInput,
  CreateTriageRuleInput,
  TriageRule,
  UpdateTriageRuleInput,
} from '@nonlinear/shared';
import { DomainError, created, deleted, notFound, updated, type Ctx } from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';

/** Trim, lowercase, and drop empty keywords; require at least one to survive. */
function normalizeKeywords(keywords: string[]): string[] {
  const cleaned = keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean);
  if (cleaned.length === 0) {
    throw new DomainError('invalid_keywords', 'At least one non-empty keyword is required');
  }
  return cleaned;
}

export class TriageRuleService {
  constructor(private ctx: Ctx) {}

  async create(input: CreateTriageRuleInput): Promise<TriageRule> {
    const { storage, bus } = this.ctx;
    if (!(await storage.teams.get(input.teamId))) throw notFound('Team');
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'Rule name is required');
    const keywords = normalizeKeywords(input.keywords);
    await this.validateTargets(input);
    const siblings = (await storage.triageRules.all()).filter((r) => r.teamId === input.teamId);
    const position = siblings.length === 0 ? 0 : Math.max(...siblings.map((r) => r.position)) + 1;
    const now = nowIso();
    const rule: TriageRule = {
      id: newId(),
      teamId: input.teamId,
      name,
      enabled: true,
      keywords,
      setPriority: input.setPriority ?? null,
      setAssigneeId: input.setAssigneeId ?? null,
      setLabelIds: input.setLabelIds ?? [],
      setProjectId: input.setProjectId ?? null,
      position,
      createdAt: now,
      updatedAt: now,
    };
    await storage.triageRules.insert(rule);
    await bus.publish([created('triageRule', rule)]);
    return rule;
  }

  async update(ruleId: string, input: UpdateTriageRuleInput): Promise<TriageRule> {
    const { storage, bus } = this.ctx;
    const rule = await storage.triageRules.get(ruleId);
    if (!rule) throw notFound('Triage rule');
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new DomainError('invalid_name', 'Rule name is required');
      rule.name = name;
    }
    if (input.keywords !== undefined) rule.keywords = normalizeKeywords(input.keywords);
    await this.validateTargets(input);
    if (input.enabled !== undefined) rule.enabled = input.enabled;
    if (input.setPriority !== undefined) rule.setPriority = input.setPriority;
    if (input.setAssigneeId !== undefined) rule.setAssigneeId = input.setAssigneeId;
    if (input.setLabelIds !== undefined) rule.setLabelIds = input.setLabelIds;
    if (input.setProjectId !== undefined) rule.setProjectId = input.setProjectId;
    if (input.position !== undefined) rule.position = input.position;
    rule.updatedAt = nowIso();
    await storage.triageRules.update(rule);
    await bus.publish([updated('triageRule', rule)]);
    return rule;
  }

  async remove(ruleId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const rule = await storage.triageRules.get(ruleId);
    if (!rule) throw notFound('Triage rule');
    await storage.triageRules.delete(ruleId);
    await bus.publish([deleted('triageRule', ruleId)]);
  }

  private async validateTargets(input: {
    setAssigneeId?: string | null;
    setLabelIds?: string[];
    setProjectId?: string | null;
  }): Promise<void> {
    const { storage } = this.ctx;
    if (input.setAssigneeId != null && !(await storage.users.get(input.setAssigneeId))) {
      throw notFound('User');
    }
    if (input.setLabelIds) {
      for (const labelId of input.setLabelIds) {
        if (!(await storage.labels.get(labelId))) throw notFound('Label');
      }
    }
    if (input.setProjectId != null && !(await storage.projects.get(input.setProjectId))) {
      throw notFound('Project');
    }
  }
}

/**
 * Apply the first enabled matching triage rule (by ascending position) to a
 * draft issue. Only fills fields the caller left unset; returns a shallow
 * clone, never mutating the original input.
 */
export async function applyTriageRules(
  ctx: Ctx,
  teamId: string,
  input: CreateIssueInput,
): Promise<CreateIssueInput> {
  const result: CreateIssueInput = { ...input };
  const rules = (await ctx.storage.triageRules.all())
    .filter((rule) => rule.teamId === teamId && rule.enabled)
    .sort((a, b) => a.position - b.position);
  const haystack = `${input.title}\n${input.description ?? ''}`.toLowerCase();
  const match = rules.find((rule) => rule.keywords.some((keyword) => haystack.includes(keyword)));
  if (!match) return result;
  if (match.setPriority !== null && (result.priority === undefined || result.priority === 0)) {
    result.priority = match.setPriority;
  }
  if (match.setAssigneeId !== null && result.assigneeId == null) {
    result.assigneeId = match.setAssigneeId;
  }
  if (match.setLabelIds.length > 0) {
    result.labelIds = [...new Set([...(result.labelIds ?? []), ...match.setLabelIds])];
  }
  if (match.setProjectId !== null && result.projectId == null) {
    result.projectId = match.setProjectId;
  }
  return result;
}
