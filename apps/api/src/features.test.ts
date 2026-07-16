import { createHmac } from 'node:crypto';
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

const SECRET = 'test-webhook-secret';

beforeAll(async () => {
  domain = createDomain(createMemoryStorage());
  app = await buildServer(
    domain,
    loadConfig({ STORAGE: 'memory', GITHUB_WEBHOOK_SECRET: SECRET } as NodeJS.ProcessEnv),
  );
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: 'ada@example.com',
      password: 'hunter2hunter2',
      name: 'Ada',
      workspaceName: 'Acme',
    },
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

describe('attachments over HTTP', () => {
  it('uploads and downloads a file', async () => {
    const team = boot.teams[0]!;
    const issue = (
      await app.inject({
        method: 'POST',
        url: '/api/issues',
        headers: { cookie },
        payload: { teamId: team.id, title: 'With attachment' },
      })
    ).json() as Issue;

    const boundary = '----vitestboundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hello.txt"\r\nContent-Type: text/plain\r\n\r\n`,
      ),
      Buffer.from('attachment payload'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: 'POST',
      url: `/api/issues/${issue.id}/attachments`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(upload.statusCode).toBe(200);
    const attachment = upload.json();
    expect(attachment.filename).toBe('hello.txt');
    expect(attachment.size).toBe(18);

    const download = await app.inject({
      method: 'GET',
      url: `/api/attachments/${attachment.id}/file`,
      headers: { cookie },
    });
    expect(download.statusCode).toBe(200);
    expect(download.body).toBe('attachment payload');
    expect(download.headers['content-type']).toContain('text/plain');
  });
});

describe('github webhook', () => {
  function sign(payload: string): string {
    return `sha256=${createHmac('sha256', SECRET).update(payload).digest('hex')}`;
  }

  it('rejects bad signatures', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=deadbeef',
      },
      payload: '{}',
    });
    expect(res.statusCode).toBe(401);
  });

  it('closes referenced issues when a PR merges', async () => {
    const team = boot.teams[0]!;
    const issue = (
      await app.inject({
        method: 'POST',
        url: '/api/issues',
        headers: { cookie },
        payload: { teamId: team.id, title: 'Fix crash on login' },
      })
    ).json() as Issue;
    const key = `${team.key}-${issue.number}`;

    const payload = JSON.stringify({
      action: 'closed',
      pull_request: {
        title: `Fix crash (${key})`,
        body: `Fixes ${key}`,
        html_url: 'https://github.com/acme/repo/pull/7',
        merged: true,
        head: { ref: `ada/${key.toLowerCase()}-fix-crash` },
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': sign(payload),
      },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().matched).toBe(1);

    const updated = await domain.ctx.storage.issues.get(issue.id);
    const state = await domain.ctx.storage.workflowStates.get(updated!.stateId);
    expect(state?.category).toBe('completed');
    const comments = await domain.ctx.storage.comments.all();
    expect(comments.some((c) => c.issueId === issue.id && c.body.includes('merged'))).toBe(true);
  });
});

describe('initiatives, documents, webhooks over HTTP', () => {
  it('does full CRUD round trips', async () => {
    const initiative = (
      await app.inject({
        method: 'POST',
        url: '/api/initiatives',
        headers: { cookie },
        payload: { name: 'H2 Roadmap' },
      })
    ).json();
    expect(initiative.status).toBe('planned');

    const doc = (
      await app.inject({
        method: 'POST',
        url: '/api/documents',
        headers: { cookie },
        payload: { title: 'Runbook', content: '# Ops' },
      })
    ).json();
    expect(doc.title).toBe('Runbook');

    const webhook = (
      await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        headers: { cookie },
        payload: { url: 'https://example.com/sink' },
      })
    ).json();
    expect(webhook.enabled).toBe(true);

    const bootstrap = (
      await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } })
    ).json() as BootstrapPayload;
    expect(bootstrap.initiatives).toHaveLength(1);
    expect(bootstrap.documents).toHaveLength(1);
    expect(bootstrap.webhooks).toHaveLength(1);
  });
});
