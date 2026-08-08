import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Domain } from '@nonlinear/core';
import type { Config } from './config.js';

/**
 * Public intake: a per-team form endpoint (and Slack slash-command target)
 * that files issues into the team without authentication.
 *
 * - GET  /api/public/intake/:teamKey/meta      -> { teamName, enabled }
 * - POST /api/public/intake/:teamKey           -> creates an issue, returns a
 *     signed status URL the submitter can poll (write channel with read-back).
 * - GET  /api/public/intake/status/:id/:sig    -> the issue's current status,
 *     for the submitter who holds the signed link (no internal comments).
 *
 * The POST accepts JSON { title, description?, email?, reporter?, type?,
 * labels? } (the public form) or form-encoded Slack slash-command payloads.
 * Requests carrying the team's intake token skip rate limiting; anonymous form
 * posts are per-IP and per-team rate limited.
 */
export function registerIntake(app: FastifyInstance, domain: Domain, config: Config): void {
  // Signs status links. A configured secret makes links durable across restarts;
  // otherwise a per-boot secret is used (links invalidate on restart).
  const statusSecret = config.intakeSecret || randomBytes(32).toString('hex');
  const signId = (issueId: string) =>
    createHmac('sha256', statusSecret).update(issueId).digest('hex').slice(0, 32);
  const validSig = (issueId: string, sig: string) => {
    const expected = signId(issueId);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  // Per-IP fixed window (anonymous submissions).
  const ipWindow = new Map<string, { count: number; resetAt: number }>();
  const allowIp = (ip: string): boolean => {
    const now = Date.now();
    const e = ipWindow.get(ip);
    if (!e || e.resetAt < now) {
      ipWindow.set(ip, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    e.count += 1;
    return e.count <= 10;
  };

  // Per-team daily quota (a coarse ceiling so one team can't be flooded).
  const teamDay = new Map<string, { count: number; resetAt: number }>();
  const TEAM_DAILY_LIMIT = 500;
  const allowTeam = (teamId: string): boolean => {
    const now = Date.now();
    const e = teamDay.get(teamId);
    if (!e || e.resetAt < now) {
      teamDay.set(teamId, { count: 1, resetAt: now + 86_400_000 });
      return true;
    }
    e.count += 1;
    return e.count <= TEAM_DAILY_LIMIT;
  };

  const teamByKey = async (key: string) =>
    (await domain.ctx.storage.teams.all()).find((t) => t.key.toUpperCase() === key.toUpperCase()) ??
    null;

  const systemActor = async (): Promise<string | null> => {
    const users = await domain.ctx.storage.users.all();
    return (
      users
        .filter((u) => u.active && u.role === 'admin')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id ?? null
    );
  };

  app.get('/api/public/intake/:teamKey/meta', async (req, reply) => {
    const team = await teamByKey((req.params as { teamKey: string }).teamKey);
    if (!team) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Unknown team' } });
    }
    return { teamName: team.name, enabled: team.intakeEnabled };
  });

  // Read-back: the submitter polls their issue's status with the signed link.
  app.get('/api/public/intake/status/:id/:sig', async (req, reply) => {
    const { id, sig } = req.params as { id: string; sig: string };
    if (!validSig(id, sig)) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Unknown request' } });
    }
    const issue = await domain.ctx.storage.issues.get(id);
    if (!issue) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Unknown request' } });
    }
    const [team, state] = await Promise.all([
      domain.ctx.storage.teams.get(issue.teamId),
      domain.ctx.storage.workflowStates.get(issue.stateId),
    ]);
    // Deliberately no internal comments — just the submitter-facing status.
    return {
      identifier: team ? `${team.key}-${issue.number}` : issue.id,
      title: issue.title,
      status: state?.name ?? 'Unknown',
      category: state?.category ?? 'triage',
      updatedAt: issue.updatedAt,
    };
  });

  app.post('/api/public/intake/:teamKey', async (req, reply) => {
    const team = await teamByKey((req.params as { teamKey: string }).teamKey);
    if (!team || !team.intakeEnabled) {
      return reply.status(404).send({
        error: { code: 'intake_disabled', message: 'This form is not accepting requests' },
      });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    // Honeypot: a hidden field real submitters never fill. If it's set, accept
    // the request without creating anything (don't tip off the bot).
    const honeypot = typeof body.website === 'string' ? body.website.trim() : '';
    if (honeypot) return { ok: true };

    const providedToken =
      (req.query as { token?: string }).token ??
      (req.headers['x-intake-token'] as string | undefined) ??
      (typeof body.token === 'string' ? body.token : undefined);
    const trusted = providedToken !== undefined && providedToken === team.intakeToken;
    if (!trusted && (!allowIp(req.ip) || !allowTeam(team.id))) {
      return reply.status(429).send({
        error: { code: 'rate_limited', message: 'Too many requests — try again shortly' },
      });
    }

    // Slack slash commands post form-encoded with the message in `text`.
    const slackText = typeof body.text === 'string' ? body.text.trim() : '';
    const isSlack = slackText.length > 0 && typeof body.command === 'string';
    let title = typeof body.title === 'string' ? body.title.trim() : '';
    let description = typeof body.description === 'string' ? body.description : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const reporter = typeof body.reporter === 'string' ? body.reporter.trim() : '';
    if (!title && slackText) {
      const [first, ...rest] = slackText.split('\n');
      title = (first ?? '').slice(0, 200);
      description = rest.join('\n');
    }
    if (!title) {
      return reply
        .status(400)
        .send({ error: { code: 'no_title', message: 'A title is required' } });
    }

    // Richer intake: resolve requested labels + a type label against the team's
    // own labels (unknown names are ignored rather than failing the submission).
    const requested = new Set<string>();
    if (Array.isArray(body.labels)) {
      for (const l of body.labels) if (typeof l === 'string') requested.add(l.trim().toLowerCase());
    }
    if (typeof body.type === 'string' && body.type.trim())
      requested.add(body.type.trim().toLowerCase());
    const labelIds = requested.size
      ? (await domain.ctx.storage.labels.all())
          .filter(
            (l) =>
              (l.teamId === null || l.teamId === team.id) && requested.has(l.name.toLowerCase()),
          )
          .map((l) => l.id)
      : undefined;

    const actorId = await systemActor();
    if (!actorId) {
      return reply
        .status(503)
        .send({ error: { code: 'no_admin', message: 'Workspace has no active admin' } });
    }

    // Attribution: record who reported it, even without a matching Customer.
    const who = isSlack
      ? `Slack (${typeof body.user_name === 'string' ? body.user_name : 'unknown'})`
      : [reporter, email].filter(Boolean).join(' · ') || 'anonymous';
    const attribution = `> Submitted via intake by **${who}**`;
    const issue = await domain.issues.create(actorId, {
      teamId: team.id,
      title,
      description: `${description}${description ? '\n\n' : ''}${attribution}`,
      labelIds,
    });

    // Link to a customer when the email domain matches one.
    if (email && email.includes('@')) {
      const customer = await domain.customers.findByEmailDomain(email);
      if (customer) {
        await domain.customerRequests.create({
          customerId: customer.id,
          issueId: issue.id,
          body: `${title}${description ? `\n\n${description}` : ''}`,
          source: 'intake',
        });
      }
    }

    const identifier = `${team.key}-${issue.number}`;
    const statusUrl = `${config.appUrl}/api/public/intake/status/${issue.id}/${signId(issue.id)}`;
    if (isSlack) {
      return { response_type: 'ephemeral', text: `Created ${identifier}: ${title}` };
    }
    return { ok: true, identifier, statusUrl };
  });
}
