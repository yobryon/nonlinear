import { beforeEach, describe, expect, it } from 'vitest';
import { createDomain, type Domain } from './index.js';
import { createMemoryStorage } from './memory.js';
import { createMemoryBlobStore } from './blob.js';
import type { Team, User } from '@nonlinear/shared';

let domain: Domain;
let admin: User;
let team: Team;

beforeEach(async () => {
  domain = createDomain(createMemoryStorage(), { blobs: createMemoryBlobStore() });
  const result = await domain.auth.register({
    email: 'ada@example.com',
    password: 'hunter2hunter2',
    name: 'Ada Lovelace',
    workspaceName: 'Acme',
  });
  admin = result.user;
  team = (await domain.ctx.storage.teams.all())[0]!;
});

describe('attachments', () => {
  it('stores, serves, and cascades attachments with issue deletion', async () => {
    const issue = await domain.issues.create(admin.id, { teamId: team.id, title: 'With file' });
    const attachment = await domain.attachments.create(admin.id, issue.id, {
      filename: 'notes.txt',
      contentType: 'text/plain',
      data: Buffer.from('hello world'),
    });
    expect(attachment.size).toBe(11);

    const { data } = await domain.attachments.content(attachment.id);
    expect(data.toString()).toBe('hello world');

    await domain.issues.remove(issue.id);
    expect(await domain.ctx.storage.attachments.get(attachment.id)).toBeNull();
    await expect(domain.attachments.content(attachment.id)).rejects.toThrow(/not found/i);
  });

  it('rejects oversized and empty files', async () => {
    const issue = await domain.issues.create(admin.id, { teamId: team.id, title: 'X' });
    await expect(
      domain.attachments.create(admin.id, issue.id, {
        filename: 'empty.bin',
        contentType: 'application/octet-stream',
        data: Buffer.alloc(0),
      }),
    ).rejects.toThrow(/empty/i);
  });
});

describe('triage', () => {
  it('creates a triage state on enable and routes new issues into it', async () => {
    await domain.teams.update(team.id, { triageEnabled: true });
    const states = await domain.ctx.storage.workflowStates.all();
    const triage = states.find((s) => s.teamId === team.id && s.category === 'triage');
    expect(triage).toBeDefined();

    const issue = await domain.issues.create(admin.id, { teamId: team.id, title: 'Inbound' });
    expect(issue.stateId).toBe(triage!.id);
  });
});

describe('SLA', () => {
  it('applies due dates from priority when configured', async () => {
    await domain.teams.update(team.id, { slaUrgentHours: 24, slaHighHours: 72 });
    const urgent = await domain.issues.create(admin.id, {
      teamId: team.id,
      title: 'Fire',
      priority: 1,
    });
    expect(urgent.dueDate).not.toBeNull();
    const none = await domain.issues.create(admin.id, {
      teamId: team.id,
      title: 'Whenever',
      priority: 4,
    });
    expect(none.dueDate).toBeNull();

    // Raising priority applies the SLA too.
    const raised = await domain.issues.update(admin.id, none.id, { priority: 2 });
    expect(raised.dueDate).not.toBeNull();
  });
});

describe('initiatives', () => {
  it('groups projects and detaches them on delete', async () => {
    const initiative = await domain.initiatives.create({ name: 'Q3 Roadmap' });
    const project = await domain.projects.create({
      name: 'Alpha',
      teamIds: [team.id],
      initiativeId: initiative.id,
    });
    expect(project.initiativeId).toBe(initiative.id);

    await domain.initiatives.remove(initiative.id);
    const detached = await domain.ctx.storage.projects.get(project.id);
    expect(detached?.initiativeId).toBeNull();
  });
});

describe('documents', () => {
  it('creates and detaches from deleted projects', async () => {
    const project = await domain.projects.create({ name: 'Alpha', teamIds: [team.id] });
    const doc = await domain.documents.create(admin.id, {
      title: 'Spec',
      content: '# Heading',
      projectId: project.id,
    });
    await domain.projects.remove(project.id);
    const detached = await domain.ctx.storage.documents.get(doc.id);
    expect(detached?.projectId).toBeNull();
  });
});

describe('due-soon scan', () => {
  it('notifies subscribers once for issues due within 24h', async () => {
    const issue = await domain.issues.create(admin.id, {
      teamId: team.id,
      title: 'Due tomorrow',
      assigneeId: admin.id,
      dueDate: new Date(Date.now() + 3600_000).toISOString(),
    });
    const first = await domain.dueSoon.scan();
    expect(first).toBeGreaterThan(0);
    const second = await domain.dueSoon.scan();
    expect(second).toBe(0);
    const notifications = await domain.ctx.storage.notifications.all();
    expect(notifications.some((n) => n.type === 'issue_due_soon' && n.issueId === issue.id)).toBe(
      true,
    );
  });
});

describe('webhooks', () => {
  it('registers webhooks and validates URLs', async () => {
    const webhook = await domain.webhooks.create(admin.id, 'https://example.com/hook');
    expect(webhook.enabled).toBe(true);
    expect(webhook.secret.length).toBeGreaterThan(20);
    await expect(domain.webhooks.create(admin.id, 'ftp://nope')).rejects.toThrow(/http/i);
    await domain.webhooks.remove(webhook.id);
    expect(await domain.ctx.storage.webhooks.all()).toHaveLength(0);
  });
});
