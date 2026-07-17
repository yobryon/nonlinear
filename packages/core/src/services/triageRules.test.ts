import { beforeEach, describe, expect, it } from 'vitest';
import type { Label, Project, Team, User } from '@nonlinear/shared';
import { createMemoryStorage } from '../memory.js';
import { SyncBus, type Ctx } from '../domain.js';
import { AuthService } from './auth.js';
import { TriageRuleService, applyTriageRules } from './triageRules.js';

let ctx: Ctx;
let service: TriageRuleService;
let admin: User;
let team: Team;
let label: Label;
let project: Project;

beforeEach(async () => {
  const storage = createMemoryStorage();
  const bus = new SyncBus(storage.syncLog);
  ctx = { storage, bus };
  service = new TriageRuleService(ctx);
  const result = await new AuthService(ctx).register({
    email: 'ada@example.com',
    password: 'hunter2hunter2',
    name: 'Ada Lovelace',
    workspaceName: 'Acme',
  });
  admin = result.user;
  team = (await storage.teams.all())[0]!;
  const now = new Date().toISOString();
  label = {
    id: 'label-1',
    teamId: team.id,
    name: 'Bug',
    color: '#ff0000',
    createdAt: now,
    updatedAt: now,
  };
  await storage.labels.insert(label);
  project = {
    id: 'project-1',
    name: 'Apollo',
    description: '',
    icon: null,
    color: '#00ff00',
    status: 'started',
    leadId: null,
    initiativeId: null,
    memberIds: [],
    teamIds: [team.id],
    startDate: null,
    targetDate: null,
    sortOrder: 'a0',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    canceledAt: null,
  };
  await storage.projects.insert(project);
});

describe('TriageRuleService', () => {
  it('creates rules with normalized keywords, defaults, and incrementing positions', async () => {
    const first = await service.create({
      teamId: team.id,
      name: 'Crashes',
      keywords: ['  CRASH  ', '', 'Segfault'],
    });
    expect(first.enabled).toBe(true);
    expect(first.keywords).toEqual(['crash', 'segfault']);
    expect(first.position).toBe(0);
    expect(first.setPriority).toBeNull();
    expect(first.setLabelIds).toEqual([]);

    const second = await service.create({
      teamId: team.id,
      name: 'Billing',
      keywords: ['invoice'],
    });
    expect(second.position).toBe(1);
  });

  it('rejects invalid inputs and missing targets', async () => {
    await expect(service.create({ teamId: 'nope', name: 'X', keywords: ['a'] })).rejects.toThrow(
      /team not found/i,
    );
    await expect(service.create({ teamId: team.id, name: '   ', keywords: ['a'] })).rejects.toThrow(
      /name/i,
    );
    await expect(
      service.create({ teamId: team.id, name: 'X', keywords: ['  ', ''] }),
    ).rejects.toThrow(/keyword/i);
    await expect(
      service.create({ teamId: team.id, name: 'X', keywords: ['a'], setAssigneeId: 'ghost' }),
    ).rejects.toThrow(/user not found/i);
    await expect(
      service.create({ teamId: team.id, name: 'X', keywords: ['a'], setLabelIds: ['ghost'] }),
    ).rejects.toThrow(/label not found/i);
    await expect(
      service.create({ teamId: team.id, name: 'X', keywords: ['a'], setProjectId: 'ghost' }),
    ).rejects.toThrow(/project not found/i);
  });

  it('updates and removes rules', async () => {
    const rule = await service.create({ teamId: team.id, name: 'Crashes', keywords: ['crash'] });
    const updatedRule = await service.update(rule.id, {
      name: 'Crashes v2',
      enabled: false,
      keywords: ['  PANIC '],
      setPriority: 1,
      setAssigneeId: admin.id,
      position: 5,
    });
    expect(updatedRule.name).toBe('Crashes v2');
    expect(updatedRule.enabled).toBe(false);
    expect(updatedRule.keywords).toEqual(['panic']);
    expect(updatedRule.setPriority).toBe(1);
    expect(updatedRule.setAssigneeId).toBe(admin.id);
    expect(updatedRule.position).toBe(5);

    await expect(service.update(rule.id, { keywords: [' '] })).rejects.toThrow(/keyword/i);
    await expect(service.update(rule.id, { setLabelIds: ['ghost'] })).rejects.toThrow(
      /label not found/i,
    );

    await service.remove(rule.id);
    expect(await ctx.storage.triageRules.get(rule.id)).toBeNull();
    await expect(service.remove(rule.id)).rejects.toThrow(/not found/i);
  });
});

describe('applyTriageRules', () => {
  it('matches keywords case-insensitively in title and description', async () => {
    await service.create({ teamId: team.id, name: 'Crashes', keywords: ['CRASH'], setPriority: 1 });

    const byTitle = await applyTriageRules(ctx, team.id, {
      teamId: team.id,
      title: 'App Crashes on login',
    });
    expect(byTitle.priority).toBe(1);

    const byDescription = await applyTriageRules(ctx, team.id, {
      teamId: team.id,
      title: 'Weird behavior',
      description: 'Sometimes it just CRASHES hard',
    });
    expect(byDescription.priority).toBe(1);

    const noMatch = await applyTriageRules(ctx, team.id, {
      teamId: team.id,
      title: 'All good here',
    });
    expect(noMatch.priority).toBeUndefined();
  });

  it('applies only the first matching rule by position', async () => {
    const first = await service.create({
      teamId: team.id,
      name: 'First',
      keywords: ['crash'],
      setPriority: 1,
    });
    await service.create({ teamId: team.id, name: 'Second', keywords: ['crash'], setPriority: 4 });

    const result = await applyTriageRules(ctx, team.id, { teamId: team.id, title: 'crash' });
    expect(result.priority).toBe(1);

    // Reorder: move the first rule after the second; the other rule now wins.
    await service.update(first.id, { position: 99 });
    const reordered = await applyTriageRules(ctx, team.id, { teamId: team.id, title: 'crash' });
    expect(reordered.priority).toBe(4);
  });

  it('skips disabled rules', async () => {
    const rule = await service.create({
      teamId: team.id,
      name: 'Crashes',
      keywords: ['crash'],
      setPriority: 1,
    });
    await service.update(rule.id, { enabled: false });
    const result = await applyTriageRules(ctx, team.id, { teamId: team.id, title: 'crash' });
    expect(result.priority).toBeUndefined();
  });

  it('fills only unset fields and unions labels without mutating the input', async () => {
    await service.create({
      teamId: team.id,
      name: 'Crashes',
      keywords: ['crash'],
      setPriority: 1,
      setAssigneeId: admin.id,
      setLabelIds: [label.id],
      setProjectId: project.id,
    });

    const explicit = {
      teamId: team.id,
      title: 'crash',
      priority: 3 as const,
      assigneeId: 'someone-else',
      projectId: 'other-project',
      labelIds: ['existing-label', label.id],
    };
    const kept = await applyTriageRules(ctx, team.id, explicit);
    expect(kept.priority).toBe(3);
    expect(kept.assigneeId).toBe('someone-else');
    expect(kept.projectId).toBe('other-project');
    expect(kept.labelIds).toEqual(['existing-label', label.id]);

    const blank = { teamId: team.id, title: 'crash', priority: 0 as const };
    const filled = await applyTriageRules(ctx, team.id, blank);
    expect(filled.priority).toBe(1);
    expect(filled.assigneeId).toBe(admin.id);
    expect(filled.labelIds).toEqual([label.id]);
    expect(filled.projectId).toBe(project.id);
    // Shallow clone: the original input is untouched.
    expect(blank.priority).toBe(0);
    expect('assigneeId' in blank).toBe(false);
  });
});
