import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { DomainError, type Domain } from '@nonlinear/core';
import type { User } from '@nonlinear/shared';
import type { Config } from './config.js';
import { SyncHub } from './hub.js';
import { registerGithubWebhook } from './github.js';

const SESSION_COOKIE = 'nl_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
  }
}

export async function buildServer(domain: Domain, config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  await registerGithubWebhook(app, domain, config.githubWebhookSecret);

  const hub = new SyncHub(domain);

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof DomainError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
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

  async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.cookies[SESSION_COOKIE];
    const user = token ? await domain.auth.authenticate(token) : null;
    if (!user) {
      reply.status(401).send({ error: { code: 'unauthorized', message: 'Sign in required' } });
      return;
    }
    req.user = user;
  }

  const authed = { preHandler: requireUser };
  type Body<T> = FastifyRequest & { body: T };

  // ---- health & meta ----
  app.get('/healthz', async () => ({ ok: true }));

  app.get('/api/meta', async () => {
    const userCount = await domain.ctx.storage.users.count();
    const workspace = (await domain.ctx.storage.workspaces.all())[0] ?? null;
    return { setupRequired: userCount === 0, workspaceName: workspace?.name ?? null };
  });

  // ---- auth ----
  app.post('/api/auth/register', async (req, reply) => {
    const body = req.body as {
      email: string;
      password: string;
      name: string;
      workspaceName?: string;
    };
    const { user, workspace } = await domain.auth.register(body);
    const session = await domain.auth.createSession(user.id);
    setSessionCookie(reply, session.token);
    return { user, workspaceId: workspace.id };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = req.body as { email: string; password: string };
    const { user, session } = await domain.auth.login(body);
    setSessionCookie(reply, session.token);
    const workspace = (await domain.ctx.storage.workspaces.all())[0];
    return { user, workspaceId: workspace?.id ?? '' };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await domain.auth.logout(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
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
    return domain.bootstrap.payload(req.user.id);
  });

  app.get('/api/ws', { websocket: true, preHandler: requireUser }, (socket, req) => {
    hub.add(socket, req.user.id);
  });

  // ---- issues ----
  app.post('/api/issues', authed, async (req) =>
    domain.issues.create(req.user.id, (req as Body<never>).body),
  );
  app.patch('/api/issues/:id', authed, async (req) =>
    domain.issues.update(req.user.id, (req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/issues/:id', authed, async (req) => {
    await domain.issues.remove((req.params as { id: string }).id);
    return { ok: true };
  });
  app.get('/api/issues/:id/activities', authed, async (req) =>
    domain.ctx.storage.activities.byIssue((req.params as { id: string }).id),
  );

  // ---- comments & reactions ----
  app.post('/api/comments', authed, async (req) =>
    domain.comments.create(req.user.id, req.body as never),
  );
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
  app.post('/api/teams', authed, async (req) =>
    domain.teams.create(req.user.id, req.body as never),
  );
  app.patch('/api/teams/:id', authed, async (req) =>
    domain.teams.update((req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/teams/:id', authed, async (req) => {
    await domain.teams.remove((req.params as { id: string }).id);
    return { ok: true };
  });
  app.post('/api/teams/:id/members', authed, async (req) =>
    domain.teams.addMember(
      (req.params as { id: string }).id,
      (req.body as { userId: string }).userId,
    ),
  );
  app.delete('/api/teams/:id/members/:userId', authed, async (req) => {
    const params = req.params as { id: string; userId: string };
    await domain.teams.removeMember(params.id, params.userId);
    return { ok: true };
  });
  app.post('/api/states', authed, async (req) => domain.teams.createState(req.body as never));
  app.patch('/api/states/:id', authed, async (req) =>
    domain.teams.updateState((req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/states/:id', authed, async (req) => {
    await domain.teams.removeState((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- labels ----
  app.post('/api/labels', authed, async (req) => domain.labels.create(req.body as never));
  app.patch('/api/labels/:id', authed, async (req) =>
    domain.labels.update((req.params as { id: string }).id, req.body as never),
  );
  app.delete('/api/labels/:id', authed, async (req) => {
    await domain.labels.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- projects & milestones ----
  app.post('/api/projects', authed, async (req) => domain.projects.create(req.body as never));
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
    return domain.webhooks.create(req.user.id, (req.body as { url: string }).url);
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
    await domain.webhooks.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- profile, users, workspace ----
  app.patch('/api/profile', authed, async (req) =>
    domain.users.updateProfile(req.user.id, req.body as never),
  );
  app.patch('/api/users/:id', authed, async (req) =>
    domain.users.adminUpdate(req.user.id, (req.params as { id: string }).id, req.body as never),
  );
  app.patch('/api/workspace', authed, async (req) =>
    domain.users.updateWorkspace((req.body as { name: string }).name),
  );

  return app;
}
