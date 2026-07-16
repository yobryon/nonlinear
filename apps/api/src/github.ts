import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Domain } from '@nonlinear/core';
import type { Issue } from '@nonlinear/shared';

/**
 * Inbound GitHub webhook (pull_request events). Configure a repo webhook
 * pointing at /api/integrations/github with content type application/json
 * and the GITHUB_WEBHOOK_SECRET. Behavior mirrors Linear's git automation:
 * - PR opened: comments the PR link on every referenced issue.
 * - PR merged: comments and moves referenced issues to the team's first
 *   "completed" state ("magic words" / branch-name references, e.g. a
 *   branch `ada/eng-42-fix-crash` or a body containing "Fixes ENG-42").
 */
export async function registerGithubWebhook(
  app: FastifyInstance,
  domain: Domain,
  secret: string,
): Promise<void> {
  await app.register(async (github) => {
    // Raw-body parsing scoped to this plugin so HMAC verification is exact.
    github.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
      done(null, body),
    );

    github.post('/api/integrations/github', async (req, reply) => {
      if (!secret) {
        return reply
          .status(503)
          .send({ error: { code: 'not_configured', message: 'Set GITHUB_WEBHOOK_SECRET' } });
      }
      const raw = req.body as Buffer;
      const signature = req.headers['x-hub-signature-256'];
      const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
      const provided = typeof signature === 'string' ? signature : '';
      const valid =
        provided.length === expected.length &&
        timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
      if (!valid) {
        return reply
          .status(401)
          .send({ error: { code: 'bad_signature', message: 'Signature mismatch' } });
      }

      const event = req.headers['x-github-event'];
      if (event !== 'pull_request') return { ok: true, ignored: String(event) };

      let payload: {
        action?: string;
        pull_request?: {
          title?: string;
          body?: string | null;
          html_url?: string;
          merged?: boolean;
          head?: { ref?: string };
        };
      };
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        return reply.status(400).send({ error: { code: 'bad_json', message: 'Invalid JSON' } });
      }
      const pr = payload.pull_request;
      if (!pr) return { ok: true, ignored: 'no pull_request' };

      const haystack = `${pr.head?.ref ?? ''} ${pr.title ?? ''} ${pr.body ?? ''}`;
      const issues = await findReferencedIssues(domain, haystack);
      if (issues.length === 0) return { ok: true, matched: 0 };

      const actor = await systemActor(domain);
      if (!actor) return { ok: true, matched: 0 };

      const merged = payload.action === 'closed' && pr.merged === true;
      for (const issue of issues) {
        if (payload.action === 'opened' || payload.action === 'reopened') {
          await domain.comments.create(actor, {
            issueId: issue.id,
            body: `Pull request opened: ${pr.html_url ?? '(no url)'}`,
          });
        } else if (merged) {
          await domain.comments.create(actor, {
            issueId: issue.id,
            body: `Pull request merged: ${pr.html_url ?? '(no url)'}`,
          });
          const done = (await domain.ctx.storage.workflowStates.all())
            .filter((s) => s.teamId === issue.teamId && s.category === 'completed')
            .sort((a, b) => a.position - b.position)[0];
          if (done && issue.stateId !== done.id) {
            await domain.issues.update(actor, issue.id, { stateId: done.id });
          }
        }
      }
      return { ok: true, matched: issues.length };
    });
  });
}

async function findReferencedIssues(domain: Domain, text: string): Promise<Issue[]> {
  const teams = await domain.ctx.storage.teams.all();
  const byKey = new Map(teams.map((t) => [t.key.toUpperCase(), t]));
  const found = new Map<string, Issue>();
  for (const match of text.matchAll(/([a-zA-Z][a-zA-Z0-9]{0,6})-(\d{1,7})/g)) {
    const team = byKey.get(match[1]!.toUpperCase());
    if (!team) continue;
    const number = Number(match[2]);
    const issue = (await domain.ctx.storage.issues.byTeam(team.id)).find(
      (i) => i.number === number,
    );
    if (issue) found.set(issue.id, issue);
  }
  return [...found.values()];
}

/** Git automation acts as the first active admin. */
async function systemActor(domain: Domain): Promise<string | null> {
  const users = await domain.ctx.storage.users.all();
  const admin = users
    .filter((u) => u.active && u.role === 'admin')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return admin?.id ?? null;
}
