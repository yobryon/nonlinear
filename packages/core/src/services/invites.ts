import { createHash } from 'node:crypto';
import type { CreateInviteInput, Invite, UserRole } from '@nonlinear/shared';
import { DomainError, notFound, type Ctx } from '../domain.js';
import { newId, newToken } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import type { StoredInvite } from '../storage.js';

const INVITE_TTL_DAYS = 14;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function toPublic(i: StoredInvite): Invite {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    createdById: i.createdById,
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
    usedAt: i.usedAt,
  };
}

/**
 * Admin-issued registration invites. When open signups are off (the default
 * after first-run), a new account can only be created by presenting a valid,
 * unused, unexpired invite token — the non-SSO path to add teammates. Like API
 * tokens, only the sha256 hash of the token is stored.
 */
export class InviteService {
  constructor(private ctx: Ctx) {}

  /** Create an invite. Returns the public record plus the one-time raw token. */
  async create(
    createdById: string,
    input: CreateInviteInput,
  ): Promise<{ invite: Invite; token: string }> {
    if (!(await this.ctx.storage.users.get(createdById))) throw notFound('User');
    const role: UserRole = input.role ?? 'member';
    if (role === 'admin') {
      // Guests/members by invite; promoting to admin is a deliberate later step.
      throw new DomainError('invalid_role', 'Invite people as member or guest, then promote');
    }
    const token = newToken();
    const stored: StoredInvite = {
      id: newId(),
      email: input.email?.trim().toLowerCase() || null,
      role,
      createdById,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString(),
      usedAt: null,
      hash: hashToken(token),
    };
    await this.ctx.storage.invites.create(stored);
    return { invite: toPublic(stored), token };
  }

  /** Resolve a raw token to a usable invite, or null if invalid/used/expired. */
  async validate(token: string): Promise<Invite | null> {
    const stored = await this.ctx.storage.invites.getByHash(hashToken(token));
    if (!stored || stored.usedAt || stored.expiresAt < nowIso()) return null;
    return toPublic(stored);
  }

  async consume(token: string, byUserId: string): Promise<void> {
    const stored = await this.ctx.storage.invites.getByHash(hashToken(token));
    if (stored && !stored.usedAt) {
      await this.ctx.storage.invites.markUsed(stored.id, nowIso());
      void byUserId; // reserved for future "accepted by" bookkeeping
    }
  }

  async list(): Promise<Invite[]> {
    const rows = await this.ctx.storage.invites.all();
    return rows
      .filter((i) => !i.usedAt && i.expiresAt >= nowIso())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toPublic);
  }

  async revoke(id: string): Promise<void> {
    await this.ctx.storage.invites.delete(id);
  }
}
