import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import {
  applyScope,
  canIntakeTeam,
  canReadIssue,
  DomainError,
  seesTeam,
  visibilityFor,
  type Domain,
} from '@nonlinear/core';
import type { TokenScope, User } from '@nonlinear/shared';
import type { Config } from './config.js';
import { SyncHub } from './hub.js';
import { registerGithubWebhook } from './github.js';
import { registerIntake } from './intake.js';
import { registerMcp } from './mcp.js';
import { registerSso, ssoEnabled } from './sso.js';
import { registerScim } from './scim.js';
import { suggestLabels, summarizePulse } from './ai.js';
import { LlmError } from './llm.js';
import { graphql } from 'graphql';
import { graphqlContext, graphqlSchema } from './graphql.js';

const SESSION_COOKIE = 'nl_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
    /** Authority the presented credential carries (full for cookie sessions). */
    tokenScope: TokenScope;
  }
}

const FULL_SCOPE: TokenScope = { teamIds: null, readOnly: false };
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildServer(domain: Domain, config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  await registerGithubWebhook(app, domain, config.githubWebhookSecret);
  registerIntake(app, domain, config);
  registerMcp(app, domain, (bearer) => domain.tokens.authenticate(bearer));

  const hub = new SyncHub(domain);

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof DomainError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof LlmError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    const httpErr = err as { statusCode?: number; message?: string };
    if (typeof httpErr.statusCode === 'number' && httpErr.statusCode < 500) {
      return reply
        .status(httpErr.statusCode)
        .send({ error: { code: 'bad_request', message: httpErr.message ?? 'Bad request' } });
    }
    app.log.error(err);
    return reply
      .status(500)
      .send({ error: { code: 'internal', message: 'Internal server error' } });
  });

  function setSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: 30 * 24 * 60 * 60,
    });
  }

  // Enterprise auth adapters (both no-op unless configured).
  await registerSso(app, domain, config, setSessionCookie);
  await registerScim(app, domain, config);

  // Two ways to authenticate: the browser session cookie, or a personal API
  // token as `Authorization: Bearer <token>` (used by scripts, agents, and MCP).
  async function resolveAuth(
    req: FastifyRequest,
  ): Promise<{ user: User; scope: TokenScope } | null> {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      return domain.tokens.authenticate(auth.slice(7).trim());
    }
    const cookie = req.cookies[SESSION_COOKIE];
    const user = cookie ? await domain.auth.authenticate(cookie) : null;
    return user ? { user, scope: FULL_SCOPE } : null;
  }

  async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const resolved = await resolveAuth(req);
    if (!resolved) {
      reply.status(401).send({ error: { code: 'unauthorized', message: 'Sign in required' } });
      return;
    }
    if (resolved.scope.readOnly && !SAFE_METHODS.has(req.method)) {
      reply
        .status(403)
        .send({ error: { code: 'read_only', message: 'This token is read-only' } });
      return;
    }
    req.user = resolved.user;
    req.tokenScope = resolved.scope;
  }

  const authed = { preHandler: requireUser };
  type Body<T> = FastifyRequest & { body: T };

  // The caller's effective read/write visibility (membership + intake ∩ scope).
  const visFor = (req: FastifyRequest) =>
    visibilityFor(domain.ctx, req.user.id).then((v) => applyScope(v, req.tokenScope.teamIds));

  // Full member access to a team (edit/delete issues, projects, team settings).
  async function requireTeamAccess(req: FastifyRequest, teamId: string): Promise<void> {
    if (!seesTeam(await visFor(req), teamId)) {
      throw new DomainError('forbidden', 'You do not have access to that team', 403);
    }
  }
  // May file into a team: a member, or via internal intake (non-member of an
  // intake-enabled team). The created issue is attributed to the real user.
  async function requireTeamIntake(req: FastifyRequest, teamId: string): Promise<void> {
    if (!canIntakeTeam(await visFor(req), teamId)) {
      throw new DomainError('forbidden', 'You cannot file into that team', 403);
    }
  }

  // ---- health & meta ----
  app.get('/healthz', async () => ({ ok: true }));

  app.get('/api/meta', async (req) => {
    const userCount = await domain.ctx.storage.users.count();
    const workspace = (await domain.ctx.storage.workspaces.all())[0] ?? null;
    // A valid ?invite=<token> lets the login page offer registration even when
    // open signups are off.
    const inviteToken = (req.query as { invite?: string }).invite;
    const inviteValid = inviteToken ? Boolean(await domain.invites.validate(inviteToken)) : false;
    return {
      setupRequired: userCount === 0,
      workspaceName: workspace?.name ?? null,
      allowSignups: config.allowSignups,
      inviteValid,
      sso: ssoEnabled(config) ? { enabled: true, label: config.sso.label } : null,
    };
  });

  // ---- auth ----
  app.post('/api/auth/register', async (req, reply) => {
    const body = req.body as {
      email: string;
      password: string;
      name: string;
      workspaceName?: string;
      inviteToken?: string;
    };

    // Registration gate. The first account always proceeds (it becomes the
    // workspace owner). After that, a new account requires either open signups
    // or a valid invite — otherwise reaching the server is NOT enough to get in.
    const isFirst = (await domain.ctx.storage.users.count()) === 0;
    let role: 'member' | 'guest' = 'member';
    if (!isFirst) {
      const invite = body.inviteToken ? await domain.invites.validate(body.inviteToken) : null;
      if (invite) {
        role = invite.role === 'guest' ? 'guest' : 'member';
      } else if (!config.allowSignups) {
        throw new DomainError(
          'registration_closed',
          body.inviteToken
            ? 'This invite is invalid or expired'
            : 'Registration is closed. Ask an admin for an invite.',
          403,
        );
      }
    }

    const { user, workspace } = await domain.auth.register(body, { role });
    if (!isFirst && body.inviteToken) await domain.invites.consume(body.inviteToken, user.id);
    const session = await domain.auth.createSession(user.id);
    setSessionCookie(reply, session.token);
    await domain.audit.record({
      action: 'user.register',
      actorId: user.id,
      actorLabel: user.name,
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      metadata: { role: user.role, via: body.inviteToken ? 'invite' : 'signup' },
      ip: req.ip,
    });
    return { user, workspaceId: workspace.id };
  });

  // ---- invites (admin) ----
  app.get('/api/auth/invite/:token', async (req) => {
    const invite = await domain.invites.validate((req.params as { token: string }).token);
    return { valid: Boolean(invite), email: invite?.email ?? null };
  });
  app.get('/api/invites', authed, async (req) => {
    requireAdmin(req);
    return domain.invites.list();
  });
  app.post('/api/invites', authed, async (req) => {
    requireAdmin(req);
    const { invite, token } = await domain.invites.create(req.user.id, req.body as never);
    await domain.audit.record({
      action: 'member.added',
      actorId: req.user.id,
      actorLabel: req.user.name,
      targetType: 'invite',
      targetId: invite.id,
      targetLabel: invite.email,
      metadata: { role: invite.role, pending: true },
      ip: req.ip,
    });
    return { invite, url: `${config.appUrl}/?invite=${token}` };
  });
  app.delete('/api/invites/:id', authed, async (req) => {
    requireAdmin(req);
    await domain.invites.revoke((req.params as { id: string }).id);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = req.body as { email: string; password: string };
    try {
      const { user, session } = await domain.auth.login(body);
      setSessionCookie(reply, session.token);
      await domain.audit.record({
        action: 'user.login',
        actorId: user.id,
        actorLabel: user.name,
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        metadata: { method: 'password' },
        ip: req.ip,
      });
      const workspace = (await domain.ctx.storage.workspaces.all())[0];
      return { user, workspaceId: workspace?.id ?? '' };
    } catch (err) {
      await domain.audit.record({
        action: 'user.login_failed',
        actorId: null,
        actorLabel: (body.email ?? '').trim().toLowerCase() || 'unknown',
        metadata: { method: 'password' },
        ip: req.ip,
      });
      throw err;
    }
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    const user = token ? await domain.auth.authenticate(token) : null;
    if (token) await domain.auth.logout(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    if (user) {
      await domain.audit.record({
        action: 'user.logout',
        actorId: user.id,
        actorLabel: user.name,
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        ip: req.ip,
      });
    }
    return { ok: true };
  });

  app.get('/api/auth/me', authed, async (req) => {
    const workspace = (await domain.ctx.storage.workspaces.all())[0];
    return { user: req.user, workspaceId: workspace?.id ?? '' };
  });

  // ---- bootstrap & sync ----
  app.get('/api/bootstrap', authed, async (req) => {
    for (const team of await domain.ctx.storage.teams.all()) {
      if (team.cyclesEnabled) await domain.cycles.ensureCurrentCycles(team.id);
    }
    return domain.bootstrap.payload(req.user.id, req.tokenScope.teamIds);
  });

  app.get('/api/ws', { websocket: true, preHandler: requireUser }, (socket, req) => {
    hub.add(socket, req.user.id, req.tokenScope.teamIds);
  });

  // ---- issues ----
  app.post('/api/issues', authed, async (req) => {
    // Members and internal-intake filers may create; the issue is attributed to
    // the real user, so they can then track it as one they filed.
    await requireTeamIntake(req, (req.body as { teamId: string }).teamId);
    return domain.issues.create(req.user.id, (req as Body<never>).body);
  });
  app.patch('/api/issues/:id', authed, async (req) => {
    // Editing an issue (state/assignee/fields) is a member operation, not an
    // intake filer's — so require full team access on the issue's team.
    const issue = await domain.ctx.storage.issues.get((req.params as { id: string }).id);
    if (issue) await requireTeamAccess(req, issue.teamId);
    return domain.issues.update(req.user.id, (req.params as { id: string }).id, req.body as never);
  });
  app.delete('/api/issues/:id', authed, async (req) => {
    const issue = await domain.ctx.storage.issues.get((req.params as { id: string }).id);
    if (issue) await requireTeamAccess(req, issue.teamId);
    await domain.issues.remove((req.params as { id: string }).id);
    return { ok: true };
  });
  app.get('/api/issues/:id/activities', authed, async (req) =>
    domain.ctx.storage.activities.byIssue((req.params as { id: string }).id),
  );

  // ---- comments & reactions ----
  app.post('/api/comments', authed, async (req) => {
    // You may comment on any issue you can read — a member team's issue, or one
    // you filed into an intake team (to answer questions / read responses).
    const issue = await domain.ctx.storage.issues.get((req.body as { issueId: string }).issueId);
    if (issue && !canReadIssue(await visFor(req), issue)) {
      throw new DomainError('forbidden', 'You cannot comment on that issue', 403);
    }
    return domain.comments.create(req.user.id, req.body as never);
  });
  app.patch('/api/comments/:id', authed, async (req) =>
    domain.comments.update(
      req.user.id,
      (req.params as { id: string }).id,
      (req.body as { body: string }).body,
    ),
  );
  app.delete('/api/comments/:id', authed, async (req) => {
    await domain.comments.remove(req.user.id, (req.params as { id: string }).id);
    return { ok: true };
  });
  app.post('/api/reactions', authed, async (req) =>
    domain.comments.addReaction(req.user.id, req.body as never),
  );
  app.delete('/api/reactions/:id', authed, async (req) => {
    await domain.comments.removeReaction(req.user.id, (req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- teams & workflow states ----
  app.post('/api/teams', authed, async (req) => {
    const team = await domain.teams.create(req.user.id, req.body as never);
    await domain.audit.record({
      action: 'team.created',
      actorId: req.user.id,
      actorLabel: req.user.name,
      targetType: 'team',
      targetId: team.id,
      targetLabel: team.key,
      ip: req.ip,
    });
    return team;
  });
  app.patch('/api/teams/:id', authed, async (req) =>
    domain.teams.update((req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/teams/:id', authed, async (req) => {
    const id = (req.params as { id: string }).id;
    const team = await domain.ctx.storage.teams.get(id);
    await domain.teams.remove(id);
    await domain.audit.record({
      action: 'team.deleted',
      actorId: req.user.id,
      actorLabel: req.user.name,
      targetType: 'team',
      targetId: id,
      targetLabel: team?.key ?? null,
      ip: req.ip,
    });
    return { ok: true };
  });
  app.post('/api/teams/:id/members', authed, async (req) => {
    const teamId = (req.params as { id: string }).id;
    const userId = (req.body as { userId: string }).userId;
    const result = await domain.teams.addMember(teamId, userId);
    const member = await domain.ctx.storage.users.get(userId);
    await domain.audit.record({
      action: 'member.added',
      actorId: req.user.id,
      actorLabel: req.user.name,
      targetType: 'user',
      targetId: userId,
      targetLabel: member?.email ?? null,
      metadata: { teamId },
      ip: req.ip,
    });
    return result;
  });
  app.delete('/api/teams/:id/members/:userId', authed, async (req) => {
    const params = req.params as { id: string; userId: string };
    await domain.teams.removeMember(params.id, params.userId);
    const member = await domain.ctx.storage.users.get(params.userId);
    await domain.audit.record({
      action: 'member.removed',
      actorId: req.user.id,
      actorLabel: req.user.name,
      targetType: 'user',
      targetId: params.userId,
      targetLabel: member?.email ?? null,
      metadata: { teamId: params.id },
      ip: req.ip,
    });
    return { ok: true };
  });
  // Workflow states, labels, and templates are a team's own workflow config —
  // a member of the team (or an admin) may manage them, not just workspace admins.
  app.post('/api/states', authed, async (req) => {
    await requireTeamAccess(req, (req.body as { teamId: string }).teamId);
    return domain.teams.createState(req.body as never);
  });
  app.patch('/api/states/:id', authed, async (req) => {
    const state = await domain.ctx.storage.workflowStates.get((req.params as { id: string }).id);
    if (state) await requireTeamAccess(req, state.teamId);
    return domain.teams.updateState((req.params as { id: string }).id, req.body as never);
  });
  app.delete('/api/states/:id', authed, async (req) => {
    const state = await domain.ctx.storage.workflowStates.get((req.params as { id: string }).id);
    if (state) await requireTeamAccess(req, state.teamId);
    await domain.teams.removeState((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- labels ----
  // Team labels: a member of the team may manage. Workspace labels (teamId
  // null): admin only.
  const requireLabelAccess = async (req: FastifyRequest, teamId: string | null | undefined) => {
    if (teamId) await requireTeamAccess(req, teamId);
    else requireAdmin(req);
  };
  app.post('/api/labels', authed, async (req) => {
    await requireLabelAccess(req, (req.body as { teamId?: string | null }).teamId);
    return domain.labels.create(req.body as never);
  });
  app.patch('/api/labels/:id', authed, async (req) => {
    const label = await domain.ctx.storage.labels.get((req.params as { id: string }).id);
    if (label) await requireLabelAccess(req, label.teamId);
    return domain.labels.update((req.params as { id: string }).id, req.body as never);
  });
  app.delete('/api/labels/:id', authed, async (req) => {
    const label = await domain.ctx.storage.labels.get((req.params as { id: string }).id);
    if (label) await requireLabelAccess(req, label.teamId);
    await domain.labels.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- projects & milestones ----
  app.post('/api/projects', authed, async (req) => {
    for (const teamId of (req.body as { teamIds?: string[] }).teamIds ?? []) {
      await requireTeamAccess(req, teamId);
    }
    return domain.projects.create(req.body as never);
  });
  app.patch('/api/projects/:id', authed, async (req) =>
    domain.projects.update((req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/projects/:id', authed, async (req) => {
    await domain.projects.remove((req.params as { id: string }).id);
    return { ok: true };
  });
  app.post('/api/milestones', authed, async (req) =>
    domain.projects.createMilestone(req.body as never),
  );
  app.patch('/api/milestones/:id', authed, async (req) =>
    domain.projects.updateMilestone((req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/milestones/:id', authed, async (req) => {
    await domain.projects.removeMilestone((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- cycles ----
  app.post('/api/cycles', authed, async (req) => domain.cycles.create(req.body as never));
  app.patch('/api/cycles/:id', authed, async (req) =>
    domain.cycles.update((req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/cycles/:id', authed, async (req) => {
    await domain.cycles.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- relations ----
  app.post('/api/relations', authed, async (req) => domain.relations.create(req.body as never));
  app.delete('/api/relations/:id', authed, async (req) => {
    await domain.relations.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- favorites ----
  app.post('/api/favorites', authed, async (req) =>
    domain.favorites.add(req.user.id, req.body as never),
  );
  app.delete('/api/favorites/:id', authed, async (req) => {
    await domain.favorites.remove(req.user.id, (req.params as { id: string }).id);
    return { ok: true };
  });
  app.patch('/api/favorites/:id', authed, async (req) =>
    domain.favorites.reorder(
      req.user.id,
      (req.params as { id: string }).id,
      (req.body as { sortOrder: string }).sortOrder,
    ),
  );

  // ---- notifications ----
  app.post('/api/notifications/read-all', authed, async (req) => {
    await domain.notifications.markAllRead(req.user.id);
    return { ok: true };
  });
  app.patch('/api/notifications/:id', authed, async (req) => {
    await domain.notifications.markRead(
      req.user.id,
      (req.params as { id: string }).id,
      (req.body as { read: boolean }).read,
    );
    return { ok: true };
  });
  app.delete('/api/notifications/:id', authed, async (req) => {
    await domain.notifications.remove(req.user.id, (req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- attachments ----
  app.post('/api/issues/:id/attachments', authed, async (req, reply) => {
    const file = await req.file();
    if (!file) {
      return reply
        .status(400)
        .send({ error: { code: 'no_file', message: 'Attach a file as multipart form data' } });
    }
    const data = await file.toBuffer();
    return domain.attachments.create(req.user.id, (req.params as { id: string }).id, {
      filename: file.filename,
      contentType: file.mimetype,
      data,
    });
  });
  app.get('/api/attachments/:id/file', authed, async (req, reply) => {
    const { attachment, data } = await domain.attachments.content(
      (req.params as { id: string }).id,
    );
    const safeName = attachment.filename.replace(/[^\w.\- ]/g, '_');
    reply.header('Content-Type', attachment.contentType);
    reply.header('Content-Disposition', `attachment; filename="${safeName}"`);
    return reply.send(data);
  });
  app.delete('/api/attachments/:id', authed, async (req) => {
    await domain.attachments.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- initiatives ----
  app.post('/api/initiatives', authed, async (req) => domain.initiatives.create(req.body as never));
  app.patch('/api/initiatives/:id', authed, async (req) =>
    domain.initiatives.update((req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/initiatives/:id', authed, async (req) => {
    await domain.initiatives.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- documents ----
  app.post('/api/documents', authed, async (req) =>
    domain.documents.create(req.user.id, req.body as never),
  );
  app.patch('/api/documents/:id', authed, async (req) =>
    domain.documents.update((req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/documents/:id', authed, async (req) => {
    await domain.documents.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- outbound webhooks (admin only) ----
  const requireAdmin = (req: FastifyRequest): void => {
    if (req.user.role !== 'admin') {
      throw new DomainError('forbidden', 'Only admins can manage webhooks', 403);
    }
  };
  app.post('/api/webhooks', authed, async (req) => {
    requireAdmin(req);
    const body = req.body as {
      url: string;
      format?: 'json' | 'slack';
      agentUserId?: string | null;
    };
    const webhook = await domain.webhooks.create(
      req.user.id,
      body.url,
      body.format ?? 'json',
      body.agentUserId ?? null,
    );
    await domain.audit.record({
      action: 'webhook.created',
      actorId: req.user.id,
      actorLabel: req.user.name,
      targetType: 'webhook',
      targetId: webhook.id,
      targetLabel: body.url,
      metadata: { format: body.format ?? 'json', agentUserId: body.agentUserId ?? null },
      ip: req.ip,
    });
    return webhook;
  });
  app.patch('/api/webhooks/:id', authed, async (req) => {
    requireAdmin(req);
    return domain.webhooks.setEnabled(
      (req.params as { id: string }).id,
      (req.body as { enabled: boolean }).enabled,
    );
  });
  app.delete('/api/webhooks/:id', authed, async (req) => {
    requireAdmin(req);
    const id = (req.params as { id: string }).id;
    await domain.webhooks.remove(id);
    await domain.audit.record({
      action: 'webhook.deleted',
      actorId: req.user.id,
      actorLabel: req.user.name,
      targetType: 'webhook',
      targetId: id,
      targetLabel: null,
      ip: req.ip,
    });
    return { ok: true };
  });

  // ---- custom views ----
  app.post('/api/views', authed, async (req) =>
    domain.views.create(req.user.id, req.body as never),
  );
  app.patch('/api/views/:id', authed, async (req) =>
    domain.views.update(req.user.id, (req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/views/:id', authed, async (req) => {
    await domain.views.remove(req.user.id, (req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- issue templates ----
  app.post('/api/templates', authed, async (req) => {
    await requireTeamAccess(req, (req.body as { teamId: string }).teamId);
    return domain.templates.create(req.body as never);
  });
  app.patch('/api/templates/:id', authed, async (req) => {
    const tpl = await domain.ctx.storage.issueTemplates.get((req.params as { id: string }).id);
    if (tpl) await requireTeamAccess(req, tpl.teamId);
    return domain.templates.update((req.params as { id: string }).id, req.body as never);
  });
  app.delete('/api/templates/:id', authed, async (req) => {
    const tpl = await domain.ctx.storage.issueTemplates.get((req.params as { id: string }).id);
    if (tpl) await requireTeamAccess(req, tpl.teamId);
    await domain.templates.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- project updates (health) ----
  app.post('/api/project-updates', authed, async (req) =>
    domain.projectUpdates.create(req.user.id, req.body as never),
  );
  app.patch('/api/project-updates/:id', authed, async (req) =>
    domain.projectUpdates.update(req.user.id, (req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/project-updates/:id', authed, async (req) => {
    await domain.projectUpdates.remove(req.user.id, (req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- reminders & snooze ----
  app.post('/api/reminders', authed, async (req) =>
    domain.reminders.set(req.user.id, req.body as never),
  );
  app.delete('/api/reminders/:id', authed, async (req) => {
    await domain.reminders.clear(req.user.id, (req.params as { id: string }).id);
    return { ok: true };
  });
  app.patch('/api/notifications/:id/snooze', authed, async (req) => {
    await domain.notifications.snooze(
      req.user.id,
      (req.params as { id: string }).id,
      (req.body as { snoozedUntil: string | null }).snoozedUntil,
    );
    return { ok: true };
  });

  // ---- customers & requests ----
  app.post('/api/customers', authed, async (req) => domain.customers.create(req.body as never));
  app.patch('/api/customers/:id', authed, async (req) =>
    domain.customers.update((req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/customers/:id', authed, async (req) => {
    await domain.customers.remove((req.params as { id: string }).id);
    return { ok: true };
  });
  app.post('/api/customer-requests', authed, async (req) =>
    domain.customerRequests.create(req.body as never),
  );
  app.patch('/api/customer-requests/:id', authed, async (req) =>
    domain.customerRequests.update((req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/customer-requests/:id', authed, async (req) => {
    await domain.customerRequests.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- document comments ----
  app.post('/api/document-comments', authed, async (req) =>
    domain.docComments.create(req.user.id, req.body as never),
  );
  app.patch('/api/document-comments/:id', authed, async (req) =>
    domain.docComments.update(req.user.id, (req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/document-comments/:id', authed, async (req) => {
    await domain.docComments.remove(req.user.id, (req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- triage rules ----
  app.post('/api/triage-rules', authed, async (req) =>
    domain.triageRules.create(req.body as never),
  );
  app.patch('/api/triage-rules/:id', authed, async (req) =>
    domain.triageRules.update((req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/triage-rules/:id', authed, async (req) => {
    await domain.triageRules.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- CSV import/export ----
  app.post('/api/teams/:id/import', authed, async (req, reply) => {
    const file = await req.file();
    if (!file) {
      return reply
        .status(400)
        .send({ error: { code: 'no_file', message: 'Attach a CSV file as multipart form data' } });
    }
    const text = (await file.toBuffer()).toString('utf8');
    return domain.csv.importIssues(req.user.id, (req.params as { id: string }).id, text);
  });
  app.get('/api/teams/:id/export.csv', authed, async (req, reply) => {
    const csv = await domain.csv.exportIssues((req.params as { id: string }).id);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="issues.csv"');
    return reply.send(csv);
  });

  // ---- API tokens (bearer credentials for REST + MCP) ----
  app.get('/api/tokens', authed, async (req) => domain.tokens.list(req.user.id));
  app.post('/api/tokens', authed, async (req) => {
    const result = await domain.tokens.create(req.user.id, req.body as never);
    await domain.audit.record({
      action: 'token.created',
      actorId: req.user.id,
      actorLabel: req.user.name,
      targetType: 'token',
      targetId: result.token.id,
      targetLabel: result.token.name,
      ip: req.ip,
    });
    return result;
  });
  app.delete('/api/tokens/:id', authed, async (req) => {
    const id = (req.params as { id: string }).id;
    await domain.tokens.revoke(req.user.id, id);
    await domain.audit.record({
      action: 'token.revoked',
      actorId: req.user.id,
      actorLabel: req.user.name,
      targetType: 'token',
      targetId: id,
      targetLabel: null,
      ip: req.ip,
    });
    return { ok: true };
  });

  // ---- agents (admin) ----
  app.post('/api/agents', authed, async (req) => {
    if (req.user.role !== 'admin') {
      throw new DomainError('forbidden', 'Only admins can create agents', 403);
    }
    const agent = await domain.auth.createAgent(req.body as never);
    await domain.audit.record({
      action: 'agent.created',
      actorId: req.user.id,
      actorLabel: req.user.name,
      targetType: 'user',
      targetId: agent.id,
      targetLabel: agent.name,
      ip: req.ip,
    });
    return agent;
  });
  // Agents can't log in, so an admin mints their bootstrap token for them.
  app.post('/api/agents/:id/tokens', authed, async (req) => {
    if (req.user.role !== 'admin') {
      throw new DomainError('forbidden', 'Only admins can manage agent tokens', 403);
    }
    const agentId = (req.params as { id: string }).id;
    const agent = await domain.ctx.storage.users.get(agentId);
    if (!agent || !agent.isAgent) {
      throw new DomainError('not_found', 'Agent not found', 404);
    }
    return domain.tokens.create(agentId, req.body as never);
  });
  app.get('/api/agents/:id/tokens', authed, async (req) => {
    if (req.user.role !== 'admin') {
      throw new DomainError('forbidden', 'Only admins can manage agent tokens', 403);
    }
    return domain.tokens.list((req.params as { id: string }).id);
  });
  app.delete('/api/agents/:id/tokens/:tokenId', authed, async (req) => {
    if (req.user.role !== 'admin') {
      throw new DomainError('forbidden', 'Only admins can manage agent tokens', 403);
    }
    const { id, tokenId } = req.params as { id: string; tokenId: string };
    await domain.tokens.revoke(id, tokenId);
    await domain.audit.record({
      action: 'token.revoked',
      actorId: req.user.id,
      actorLabel: req.user.name,
      targetType: 'token',
      targetId: tokenId,
      targetLabel: null,
      ip: req.ip,
    });
    return { ok: true };
  });

  // ---- profile, users, workspace ----
  app.patch('/api/profile', authed, async (req) =>
    domain.users.updateProfile(req.user.id, req.body as never),
  );
  app.patch('/api/users/:id', authed, async (req) => {
    const targetId = (req.params as { id: string }).id;
    const body = req.body as { role?: 'admin' | 'member' | 'guest'; active?: boolean };
    const before = await domain.ctx.storage.users.get(targetId);
    const updated = await domain.users.adminUpdate(req.user.id, targetId, body);
    if (before && body.role !== undefined && before.role !== updated.role) {
      await domain.audit.record({
        action: 'user.role_changed',
        actorId: req.user.id,
        actorLabel: req.user.name,
        targetType: 'user',
        targetId,
        targetLabel: updated.email,
        metadata: { from: before.role, to: updated.role },
        ip: req.ip,
      });
    }
    if (before && body.active !== undefined && before.active !== updated.active) {
      await domain.audit.record({
        action: updated.active ? 'user.reactivated' : 'user.deactivated',
        actorId: req.user.id,
        actorLabel: req.user.name,
        targetType: 'user',
        targetId,
        targetLabel: updated.email,
        ip: req.ip,
      });
    }
    return updated;
  });
  app.patch('/api/workspace', authed, async (req) =>
    domain.users.updateWorkspace((req.body as { name: string }).name),
  );

  // ---- custom dashboards ----
  app.post('/api/dashboards', authed, async (req) =>
    domain.dashboards.create(req.user.id, req.body as never),
  );
  app.patch('/api/dashboards/:id', authed, async (req) =>
    domain.dashboards.update(req.user.id, (req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/dashboards/:id', authed, async (req) => {
    await domain.dashboards.remove(req.user.id, (req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- Pulse (cross-workspace activity digest) ----
  app.get('/api/pulse', authed, async (req) => {
    const days = Number((req.query as { days?: string }).days ?? 7);
    return domain.pulse.feed(Number.isFinite(days) ? Math.min(Math.max(days, 1), 90) : 7);
  });
  app.post('/api/pulse/summary', authed, async (req) => {
    const settings = await requireAiSettings();
    const days = Number((req.body as { days?: number })?.days ?? 7);
    const feed = await domain.pulse.feed(
      Number.isFinite(days) ? Math.min(Math.max(days, 1), 90) : 7,
    );
    return { summary: await summarizePulse(settings, feed) };
  });

  // ---- AI (BYO-key) ----
  app.get('/api/ai/settings', authed, async () => domain.ai.getPublic());
  app.put('/api/ai/settings', authed, async (req) => {
    requireAdmin(req);
    return domain.ai.update(req.body as never);
  });
  app.post('/api/issues/:id/ai/suggest-labels', authed, async (req) => {
    const settings = await requireAiSettings();
    return {
      suggestions: await suggestLabels(domain, settings, (req.params as { id: string }).id),
    };
  });

  async function requireAiSettings() {
    const settings = await domain.ai.getSettings();
    if (!settings?.enabled || !settings.apiKey) {
      throw new LlmError('AI features are not configured', 400);
    }
    return settings;
  }

  // ---- GraphQL API (same auth + Domain as REST) ----
  const runGraphql = async (
    req: FastifyRequest,
    params: { query?: string; variables?: Record<string, unknown>; operationName?: string },
  ) => {
    if (!params.query) {
      return { errors: [{ message: 'A `query` is required' }] };
    }
    return graphql({
      schema: graphqlSchema,
      source: params.query,
      variableValues: params.variables,
      operationName: params.operationName,
      contextValue: await graphqlContext(domain, req.user, req.tokenScope),
    });
  };
  app.post('/api/graphql', authed, async (req) =>
    runGraphql(req, req.body as { query?: string; variables?: Record<string, unknown> }),
  );
  app.get('/api/graphql', authed, async (req) => {
    const q = req.query as { query?: string; variables?: string; operationName?: string };
    return runGraphql(req, {
      query: q.query,
      operationName: q.operationName,
      variables: q.variables ? JSON.parse(q.variables) : undefined,
    });
  });

  // ---- audit log (admin) ----
  app.get('/api/audit', authed, async (req) => {
    requireAdmin(req);
    const { cursor, limit } = req.query as { cursor?: string; limit?: string };
    return domain.audit.list({
      cursor: cursor ?? null,
      limit: limit ? Number(limit) : 100,
    });
  });

  return app;
}
