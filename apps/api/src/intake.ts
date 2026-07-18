import type { FastifyInstance } from 'fastify';
import type { Domain } from '@nonlinear/core';

/**
 * Public intake: a per-team form endpoint (and Slack slash-command target)
 * that files issues into the team without authentication.
 *
 * - GET  /api/public/intake/:teamKey/meta -> { teamName, enabled }
 * - POST /api/public/intake/:teamKey      -> creates an issue
 *   Accepts JSON {title, description?, email?} (the public form) or
 *   form-encoded Slack slash-command payloads (text=...). Requests carrying
 *   the team's intake token (query ?token=, X-Intake-Token header) skip rate
 *   limiting; anonymous form posts are rate limited per IP.
 */
export function registerIntake(app: FastifyInstance, domain: Domain): void {
  // Tiny fixed-window rate limit for anonymous submissions.
  const windowCounts = new Map<string, { count: number; resetAt: number }>();
  const allowAnonymous = (ip: string): boolean => {
    const now = Date.now();
    const entry = windowCounts.get(ip);
    if (!entry || entry.resetAt < now) {
      windowCounts.set(ip, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    entry.count += 1;
    return entry.count <= 10;
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

  app.post('/api/public/intake/:teamKey', async (req, reply) => {
    const team = await teamByKey((req.params as { teamKey: string }).teamKey);
    if (!team || !team.intakeEnabled) {
      return reply.status(404).send({
        error: { code: 'intake_disabled', message: 'This form is not accepting requests' },
      });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const providedToken =
      (req.query as { token?: string }).token ??
      (req.headers['x-intake-token'] as string | undefined) ??
      (typeof body.token === 'string' ? body.token : undefined);
    const trusted = providedToken !== undefined && providedToken === team.intakeToken;
    if (!trusted && !allowAnonymous(req.ip)) {
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

    const actorId = await systemActor();
    if (!actorId) {
      return reply
        .status(503)
        .send({ error: { code: 'no_admin', message: 'Workspace has no active admin' } });
    }

    const via = isSlack
      ? `Slack (${typeof body.user_name === 'string' ? body.user_name : 'unknown'})`
      : email
        ? `intake form (${email})`
        : 'intake form';
    const issue = await domain.issues.create(actorId, {
      teamId: team.id,
      title,
      description: `${description}${description ? '\n\n' : ''}> Submitted via ${via}`,
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
    if (isSlack) {
      return { response_type: 'ephemeral', text: `Created ${identifier}: ${title}` };
    }
    return { ok: true, identifier };
  });
}
