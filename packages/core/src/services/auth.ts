import type { LoginInput, RegisterInput, User, Workspace } from '@nonlinear/shared';
import { DomainError, created, type Ctx } from '../domain.js';
import { newId, newToken } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { hashPassword, verifyPassword } from '../util/passwords.js';
import { colorFor } from '../util/colors.js';
import type { Session } from '../storage.js';
import { TeamService } from './teams.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'user'
  );
}

export class AuthService {
  constructor(private ctx: Ctx) {}

  /**
   * First register creates the workspace, an admin user, and a default team.
   * Later registers join the existing workspace as members.
   */
  async register(input: RegisterInput): Promise<{ user: User; workspace: Workspace }> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new DomainError('invalid_email', 'Invalid email address');
    }
    if (input.password.length < 8) {
      throw new DomainError('weak_password', 'Password must be at least 8 characters');
    }
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'Name is required');
    if (await this.ctx.storage.users.getByEmail(email)) {
      throw new DomainError('email_taken', 'An account with this email already exists', 409);
    }

    const { storage, bus } = this.ctx;
    const isFirst = (await storage.users.count()) === 0;
    const now = nowIso();

    let workspace = (await storage.workspaces.all())[0] ?? null;
    if (!workspace) {
      if (!isFirst) throw new DomainError('no_workspace', 'Workspace missing', 409);
      const wsName = input.workspaceName?.trim() || `${name}'s Workspace`;
      workspace = {
        id: newId(),
        name: wsName,
        urlKey: slugify(wsName),
        createdAt: now,
        updatedAt: now,
      };
      await storage.workspaces.insert(workspace);
      await bus.publish([created('workspace', workspace)]);
    }

    const displayName = await this.uniqueDisplayName(slugify(name).replace(/-/g, '.'));
    const user: User = {
      id: newId(),
      email,
      name,
      displayName,
      avatarColor: colorFor(email),
      role: isFirst ? 'admin' : 'member',
      active: true,
      isAgent: false,
      mutedNotificationTypes: [],
      emailDigest: false,
      digestLastSentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await storage.users.insertWithPassword(user, await hashPassword(input.password));
    await bus.publish([created('user', user)]);

    if (isFirst) {
      const teams = new TeamService(this.ctx);
      await teams.create(user.id, {
        name: workspace.name.replace(/'s Workspace$/, ''),
        key:
          workspace.name
            .slice(0, 3)
            .replace(/[^a-zA-Z]/g, 'X')
            .toUpperCase() || 'GEN',
      });
    } else {
      // Join every non-private team so new members see the workspace immediately.
      const teams = new TeamService(this.ctx);
      for (const team of await this.ctx.storage.teams.all()) {
        if (!team.private) await teams.addMember(team.id, user.id);
      }
    }

    return { user, workspace };
  }

  /**
   * Create an agent user — a non-human teammate that can be assigned issues
   * and @mentioned. Agents have no password (they authenticate with an API
   * token) and join every non-private team. Admin-gated by the caller.
   */
  async createAgent(input: { name: string; displayName?: string }): Promise<User> {
    const { storage, bus } = this.ctx;
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'Agent name is required');
    const workspace = (await storage.workspaces.all())[0];
    if (!workspace) throw new DomainError('no_workspace', 'Workspace missing', 409);

    const now = nowIso();
    const base = (input.displayName?.trim() || slugify(name)).replace(/-/g, '.').toLowerCase();
    const displayName = await this.uniqueDisplayName(base);
    // Agents get a synthetic, non-login email in a reserved domain.
    const email = `${displayName}@agents.nonlinear.local`;
    const user: User = {
      id: newId(),
      email,
      name,
      displayName,
      avatarColor: colorFor(name),
      role: 'member',
      active: true,
      isAgent: true,
      mutedNotificationTypes: [],
      emailDigest: false,
      digestLastSentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    // Insert without a password hash so login is impossible.
    await storage.users.insert(user);
    await bus.publish([created('user', user)]);

    const teams = new TeamService(this.ctx);
    for (const team of await storage.teams.all()) {
      if (!team.private) await teams.addMember(team.id, user.id);
    }
    return user;
  }

  private async uniqueDisplayName(base: string): Promise<string> {
    const users = await this.ctx.storage.users.all();
    const taken = new Set(users.map((u) => u.displayName));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) {
      if (!taken.has(`${base}${i}`)) return `${base}${i}`;
    }
  }

  async login(input: LoginInput): Promise<{ user: User; session: Session }> {
    const user = await this.ctx.storage.users.getByEmail(input.email.trim().toLowerCase());
    const hash = user ? await this.ctx.storage.users.getPasswordHash(user.id) : null;
    const ok = hash !== null && (await verifyPassword(input.password, hash));
    if (!user || !ok || !user.active) {
      throw new DomainError('invalid_credentials', 'Invalid email or password', 401);
    }
    const session = await this.createSession(user.id);
    return { user, session };
  }

  async createSession(userId: string): Promise<Session> {
    const session: Session = {
      token: newToken(),
      userId,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    };
    await this.ctx.storage.sessions.create(session);
    return session;
  }

  async authenticate(token: string): Promise<User | null> {
    const session = await this.ctx.storage.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt < nowIso()) {
      await this.ctx.storage.sessions.delete(token);
      return null;
    }
    const user = await this.ctx.storage.users.get(session.userId);
    return user?.active ? user : null;
  }

  async logout(token: string): Promise<void> {
    await this.ctx.storage.sessions.delete(token);
  }
}
