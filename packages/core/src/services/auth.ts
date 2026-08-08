import type {
  LoginInput,
  RegisterInput,
  SsoUserInfo,
  User,
  UserRole,
  Workspace,
} from '@nonlinear/shared';
import { DomainError, created, type Ctx } from '../domain.js';
import { DEFAULT_PREFERENCES } from '@nonlinear/shared';
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

/**
 * Normalize a raw `X-Agent-ID` header into a safe persona key: lowercase, only
 * `[a-z0-9_-]`, no leading/trailing separators, capped length. Notably strips
 * `.` (our parent.persona separator) so a persona key can never forge a
 * composite handle. Returns '' when nothing usable remains.
 */
export function personaKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export class AuthService {
  constructor(private ctx: Ctx) {}

  /** In-process dedupe so one session's burst of parallel calls provisions once. */
  private personaProvisioning = new Map<string, Promise<User>>();

  /**
   * First register creates the workspace, an admin user, and a default team.
   * Later registers join the existing workspace as members.
   */
  async register(
    input: RegisterInput,
    opts: { role?: UserRole } = {},
  ): Promise<{ user: User; workspace: Workspace }> {
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
      role: isFirst ? 'admin' : (opts.role ?? 'member'),
      active: true,
      isAgent: false,
      mutedNotificationTypes: [],
      emailDigest: false,
      digestLastSentAt: null,
      preferences: { ...DEFAULT_PREFERENCES },
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
    } else if (user.role !== 'guest') {
      // Members join every non-private team so they see the workspace
      // immediately. Guests join nothing automatically — an admin grants them
      // access team by team, which (with team-scoped visibility) is what keeps a
      // guest confined to exactly what they're invited to.
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
      preferences: { ...DEFAULT_PREFERENCES },
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

  /**
   * Resolve an agent's named persona (its per-session sub-actor, conveyed by the
   * `X-Agent-ID` header) to a real, assignable agent user under `parentAgent`,
   * creating it the first time the name is seen. Attribution-only: the persona
   * mirrors the parent's teams and never widens what the token can access.
   * Falls back to the parent itself when the key is empty or the caller is not
   * an agent, so a stray header simply attributes to the agent as before.
   */
  async findOrProvisionAgentPersona(parentAgent: User, rawKey: string): Promise<User> {
    const key = personaKey(rawKey);
    if (!key || !parentAgent.isAgent) return parentAgent;
    const existing = await this.ctx.storage.users.getPersona(parentAgent.id, key);
    if (existing) return existing;
    const lockKey = `${parentAgent.id}:${key}`;
    let pending = this.personaProvisioning.get(lockKey);
    if (!pending) {
      pending = this.provisionPersona(parentAgent, key).finally(() =>
        this.personaProvisioning.delete(lockKey),
      );
      this.personaProvisioning.set(lockKey, pending);
    }
    return pending;
  }

  private async provisionPersona(parent: User, key: string): Promise<User> {
    const { storage, bus } = this.ctx;
    const now = nowIso();
    const displayName = await this.uniqueDisplayName(`${parent.displayName}.${key}`);
    const user: User = {
      id: newId(),
      email: `${displayName}@agents.nonlinear.local`,
      name: key,
      displayName,
      // Share the parent's color so a family of personas reads as one agent.
      avatarColor: parent.avatarColor,
      role: 'member',
      active: true,
      isAgent: true,
      parentAgentId: parent.id,
      agentPersonaKey: key,
      mutedNotificationTypes: [],
      emailDigest: false,
      digestLastSentAt: null,
      preferences: { ...DEFAULT_PREFERENCES },
      createdAt: now,
      updatedAt: now,
    };
    await storage.users.insert(user);
    await bus.publish([created('user', user)]);
    // Mirror the parent's memberships so the persona is assignable exactly where
    // the parent can act — never anywhere broader.
    const teams = new TeamService(this.ctx);
    for (const m of await storage.teamMemberships.all()) {
      if (m.userId === parent.id) await teams.addMember(m.teamId, user.id);
    }
    return user;
  }

  /**
   * Provision a passwordless human member (used by SSO JIT and SCIM). Joins
   * every non-private team so the member sees the workspace immediately.
   * Login by password is impossible until they set one.
   */
  async provisionMember(input: { email: string; name?: string }): Promise<User> {
    const { storage, bus } = this.ctx;
    const email = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new DomainError('invalid_email', 'Invalid email address');
    }
    const existing = await storage.users.getByEmail(email);
    if (existing) return existing;
    if (!(await storage.workspaces.all())[0]) {
      throw new DomainError('no_workspace', 'Workspace not set up yet', 409);
    }
    const now = nowIso();
    const name = input.name?.trim() || email.split('@')[0]!;
    const displayName = await this.uniqueDisplayName(slugify(name).replace(/-/g, '.'));
    const user: User = {
      id: newId(),
      email,
      name,
      displayName,
      avatarColor: colorFor(email),
      role: 'member',
      active: true,
      isAgent: false,
      mutedNotificationTypes: [],
      emailDigest: false,
      digestLastSentAt: null,
      preferences: { ...DEFAULT_PREFERENCES },
      createdAt: now,
      updatedAt: now,
    };
    await storage.users.insert(user);
    await bus.publish([created('user', user)]);
    const teams = new TeamService(this.ctx);
    for (const team of await storage.teams.all()) {
      if (!team.private) await teams.addMember(team.id, user.id);
    }
    return user;
  }

  /**
   * Resolve an OIDC identity to a local session. Order: match by stable IdP
   * subject, else link an existing account by email, else JIT-provision (if
   * allowed). Domain allow-listing is enforced by the caller before this runs.
   */
  async findOrProvisionSso(
    info: SsoUserInfo,
    opts: { autoProvision: boolean },
  ): Promise<{ user: User; session: Session; outcome: 'matched' | 'linked' | 'provisioned' }> {
    const { storage } = this.ctx;
    const email = info.email.trim().toLowerCase();

    let user = await storage.users.getBySsoSubject(info.subject);
    let outcome: 'matched' | 'linked' | 'provisioned' = 'matched';

    if (!user) {
      const byEmail = await storage.users.getByEmail(email);
      if (byEmail) {
        if (byEmail.isAgent) {
          throw new DomainError('sso_agent', 'That account cannot sign in via SSO', 403);
        }
        await storage.users.linkSsoSubject(byEmail.id, info.subject);
        user = byEmail;
        outcome = 'linked';
      } else {
        if (!opts.autoProvision) {
          throw new DomainError('sso_no_account', 'No account for this identity', 403);
        }
        user = await this.provisionMember({ email, name: info.name ?? undefined });
        await storage.users.linkSsoSubject(user.id, info.subject);
        outcome = 'provisioned';
      }
    }

    if (!user.active) {
      throw new DomainError('inactive', 'This account is deactivated', 403);
    }
    const session = await this.createSession(user.id);
    return { user, session, outcome };
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
