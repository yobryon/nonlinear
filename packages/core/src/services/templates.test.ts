import { beforeEach, describe, expect, it } from 'vitest';
import type { Label, Team } from '@nonlinear/shared';
import { createMemoryStorage } from '../memory.js';
import { SyncBus, type Ctx } from '../domain.js';
import { AuthService } from './auth.js';
import { LabelService } from './labels.js';
import { IssueTemplateService } from './templates.js';

let ctx: Ctx;
let service: IssueTemplateService;
let team: Team;
let label: Label;

beforeEach(async () => {
  const storage = createMemoryStorage();
  const bus = new SyncBus(storage.syncLog);
  ctx = { storage, bus };
  service = new IssueTemplateService(ctx);
  const auth = new AuthService(ctx);
  await auth.register({
    email: 'ada@example.com',
    password: 'hunter2hunter2',
    name: 'Ada Lovelace',
    workspaceName: 'Acme',
  });
  team = (await storage.teams.all())[0]!;
  label = await new LabelService(ctx).create({ teamId: team.id, name: 'Bug', color: '#ff0000' });
});

describe('IssueTemplateService', () => {
  it('creates a template with defaults', async () => {
    const template = await service.create({ teamId: team.id, name: '  Bug report  ' });
    expect(template.name).toBe('Bug report');
    expect(template.titlePrefix).toBe('');
    expect(template.description).toBe('');
    expect(template.priority).toBe(0);
    expect(template.labelIds).toEqual([]);
    expect(template.estimate).toBeNull();
    expect(await ctx.storage.issueTemplates.get(template.id)).toEqual(template);
  });

  it('round trips create, update, and remove', async () => {
    const template = await service.create({
      teamId: team.id,
      name: 'Bug report',
      titlePrefix: '[bug] ',
      description: 'Steps to reproduce:',
      priority: 2,
      labelIds: [label.id],
      estimate: 3,
    });
    expect(template.labelIds).toEqual([label.id]);
    expect(template.estimate).toBe(3);

    const updatedTemplate = await service.update(template.id, {
      name: 'Defect report',
      priority: 1,
      labelIds: [],
      estimate: null,
    });
    expect(updatedTemplate.name).toBe('Defect report');
    expect(updatedTemplate.priority).toBe(1);
    expect(updatedTemplate.labelIds).toEqual([]);
    expect(updatedTemplate.estimate).toBeNull();
    expect(updatedTemplate.titlePrefix).toBe('[bug] ');
    expect(await ctx.storage.issueTemplates.get(template.id)).toEqual(updatedTemplate);

    await service.remove(template.id);
    expect(await ctx.storage.issueTemplates.get(template.id)).toBeNull();
    await expect(service.remove(template.id)).rejects.toThrow(/not found/i);
  });

  it('rejects an unknown team', async () => {
    await expect(service.create({ teamId: 'nope', name: 'X' })).rejects.toThrow(/Team not found/);
  });

  it('rejects an empty name', async () => {
    await expect(service.create({ teamId: team.id, name: '   ' })).rejects.toThrow(/name/i);
    const template = await service.create({ teamId: team.id, name: 'Ok' });
    await expect(service.update(template.id, { name: ' ' })).rejects.toThrow(/name/i);
  });

  it('rejects unknown labels on create and update', async () => {
    await expect(
      service.create({ teamId: team.id, name: 'X', labelIds: [label.id, 'nope'] }),
    ).rejects.toThrow(/Label not found/);
    const template = await service.create({ teamId: team.id, name: 'X' });
    await expect(service.update(template.id, { labelIds: ['nope'] })).rejects.toThrow(
      /Label not found/,
    );
  });
});
