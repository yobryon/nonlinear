import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDomain, createMemoryStorage, type Domain } from '@nonlinear/core';
import type { BootstrapPayload, Issue } from '@nonlinear/shared';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';

let app: FastifyInstance;
let domain: Domain;
let cookie: string;
let boot: BootstrapPayload;

beforeAll(async () => {
  domain = createDomain(createMemoryStorage());
  app = await buildServer(domain, loadConfig({ STORAGE: 'memory' } as NodeJS.ProcessEnv));
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'ada@x.com', password: 'hunter2hunter2', name: 'Ada', workspaceName: 'Acme' },
  });
  const raw = res.headers['set-cookie'];
  cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;
  boot = (
    await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } })
  ).json() as BootstrapPayload;
});

afterAll(async () => {
  await app.close();
});

const post = (url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: { cookie }, payload: payload as never });

describe('P1/P2 over HTTP', () => {
  it('custom views round-trip and appear in bootstrap', async () => {
    const res = await post('/api/views', {
      name: 'Urgent bugs',
      shared: true,
      filters: { priorities: [1], assigneeIds: [], labelIds: [], stateIds: [], projectIds: [] },
      grouping: 'state',
      display: 'list',
    });
    expect(res.statusCode).toBe(200);
    const b = (
      await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } })
    ).json() as BootstrapPayload;
    expect(b.customViews.some((v) => v.name === 'Urgent bugs')).toBe(true);
  });

  it('templates, project updates, reminders, snooze', async () => {
    const team = boot.teams[0]!;
    const tpl = await post('/api/templates', { teamId: team.id, name: 'Bug report', priority: 2 });
    expect(tpl.statusCode).toBe(200);

    const project = (
      await post('/api/projects', { name: 'Health proj', teamIds: [team.id] })
    ).json();
    const update = await post('/api/project-updates', {
      projectId: project.id,
      health: 'at_risk',
      body: 'Scope grew.',
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().health).toBe('at_risk');

    const issue = (await post('/api/issues', { teamId: team.id, title: 'Remind me' })).json();
    const reminder = await post('/api/reminders', {
      issueId: issue.id,
      remindAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(reminder.statusCode).toBe(200);
    const fired = await domain.reminders.scan();
    expect(fired).toBe(1); // self-reminders notify their creator (actorless)
    const notifications = await domain.ctx.storage.notifications.all();
    const mine = notifications.find((n) => n.type === 'issue_reminder');
    expect(mine).toBeDefined();

    const snooze = await app.inject({
      method: 'PATCH',
      url: `/api/notifications/${mine!.id}/snooze`,
      headers: { cookie },
      payload: { snoozedUntil: new Date(Date.now() + 3600_000).toISOString() },
    });
    expect(snooze.statusCode).toBe(200);
  });

  it('customers with requests and issue linking', async () => {
    const customer = (
      await post('/api/customers', { name: 'Globex', tier: 'Enterprise', domain: 'globex.com' })
    ).json();
    const team = boot.teams[0]!;
    const issue = (await post('/api/issues', { teamId: team.id, title: 'Globex ask' })).json();
    const request = await post('/api/customer-requests', {
      customerId: customer.id,
      issueId: issue.id,
      body: 'Needs SSO',
    });
    expect(request.statusCode).toBe(200);
  });

  it('triage rules apply to issues created over HTTP', async () => {
    const team = boot.teams[0]!;
    const rule = await post('/api/triage-rules', {
      teamId: team.id,
      name: 'Crashes are urgent',
      keywords: ['crash'],
      setPriority: 1,
    });
    expect(rule.statusCode).toBe(200);
    const issue = (
      await post('/api/issues', { teamId: team.id, title: 'App crash on login' })
    ).json() as Issue;
    expect(issue.priority).toBe(1);
  });

  it('imports and exports CSV', async () => {
    const team = boot.teams[0]!;
    const csv = 'Title,Priority,Labels\nImported one,High,ops\nImported two,Low,"ops;infra"\n';
    const boundary = '----csvboundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="issues.csv"\r\nContent-Type: text/csv\r\n\r\n`,
      ),
      Buffer.from(csv),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/import`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(2);

    const exportRes = await app.inject({
      method: 'GET',
      url: `/api/teams/${team.id}/export.csv`,
      headers: { cookie },
    });
    expect(exportRes.statusCode).toBe(200);
    expect(exportRes.body).toContain('Imported one');
  });

  it('public intake: meta, form post, slack post, disabled state', async () => {
    const team = boot.teams[0]!;
    const disabled = await app.inject({
      method: 'GET',
      url: `/api/public/intake/${team.key}/meta`,
    });
    expect(disabled.json().enabled).toBe(false);

    await app.inject({
      method: 'PATCH',
      url: `/api/teams/${team.id}`,
      headers: { cookie },
      payload: { intakeEnabled: true },
    });
    const updatedTeam = await domain.ctx.storage.teams.get(team.id);
    expect(updatedTeam?.intakeToken).toBeTruthy();

    const formPost = await app.inject({
      method: 'POST',
      url: `/api/public/intake/${team.key}`,
      payload: { title: 'From the public form', description: 'please help', email: 'a@b.com' },
    });
    expect(formPost.statusCode).toBe(200);
    expect(formPost.json().identifier).toMatch(/^ACM-\d+$/);

    const slackPost = await app.inject({
      method: 'POST',
      url: `/api/public/intake/${team.key}?token=${updatedTeam!.intakeToken}`,
      payload: { command: '/nonlinear', text: 'Slack-created issue', user_name: 'ada' },
    });
    expect(slackPost.statusCode).toBe(200);
    expect(slackPost.json().response_type).toBe('ephemeral');
  });

  it('public intake: status read-back, attribution, and honeypot', async () => {
    const team = boot.teams[0]!;
    await app.inject({
      method: 'PATCH',
      url: `/api/teams/${team.id}`,
      headers: { cookie },
      payload: { intakeEnabled: true },
    });

    // A submission returns a signed status URL the submitter can poll.
    const post = await app.inject({
      method: 'POST',
      url: `/api/public/intake/${team.key}`,
      payload: { title: 'Track me', reporter: 'orderflow-web', email: 'dev@acme.test' },
    });
    expect(post.statusCode).toBe(200);
    const { identifier, statusUrl } = post.json() as { identifier: string; statusUrl: string };
    expect(statusUrl).toContain('/api/public/intake/status/');

    const status = await app.inject({ method: 'GET', url: new URL(statusUrl).pathname });
    expect(status.statusCode).toBe(200);
    expect(status.json().identifier).toBe(identifier);
    expect(typeof status.json().status).toBe('string');
    expect(status.json().category.length).toBeGreaterThan(0);

    // A tampered signature is rejected.
    const bad = await app.inject({
      method: 'GET',
      url: new URL(statusUrl).pathname.replace(/.$/, 'x'),
    });
    expect(bad.statusCode).toBe(404);

    // Attribution is recorded on the issue.
    const number = Number(identifier.split('-')[1]);
    const issue = (await domain.ctx.storage.issues.byTeam(team.id)).find((i) => i.number === number);
    expect(issue?.description).toContain('orderflow-web');

    // The honeypot field silently drops bot submissions (no issue created).
    const before = (await domain.ctx.storage.issues.byTeam(team.id)).length;
    const trap = await app.inject({
      method: 'POST',
      url: `/api/public/intake/${team.key}`,
      payload: { title: 'spam', website: 'http://spammer.example' },
    });
    expect(trap.statusCode).toBe(200);
    expect(trap.json().identifier).toBeUndefined();
    expect((await domain.ctx.storage.issues.byTeam(team.id)).length).toBe(before);
  });
});
