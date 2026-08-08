import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  ApiToken,
  CreateApiTokenInput,
  CreatedApiToken,
  TokenScope,
  User,
} from '@nonlinear/shared';
import { DomainError, notFound, type Ctx } from '../domain.js';
import { newId, newToken } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import type { StoredApiToken } from '../storage.js';

const TOKEN_PREFIX = 'nl_';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function toPublic(t: StoredApiToken): ApiToken {
  return {
    id: t.id,
    userId: t.userId,
    name: t.name,
    prefix: t.prefix,
    teamIds: t.teamIds,
    readOnly: t.readOnly,
    createdAt: t.createdAt,
    lastUsedAt: t.lastUsedAt,
    expiresAt: t.expiresAt,
  };
}

/** Full authority — a session cookie or an unrestricted token. */
export const FULL_SCOPE: TokenScope = { teamIds: null, readOnly: false };

/**
 * Personal API tokens for programmatic access (REST + MCP). Tokens are
 * high-entropy random strings; only their sha256 hash is stored, so lookup is
 * a single hash comparison and the raw value is unrecoverable after creation.
 */
export class TokenService {
  constructor(private ctx: Ctx) {}

  async create(userId: string, input: CreateApiTokenInput): Promise<CreatedApiToken> {
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'Token name is required');
    if (!(await this.ctx.storage.users.get(userId))) throw notFound('User');

    const secret = `${TOKEN_PREFIX}${newToken()}`;
    const teamIds = input.teamIds && input.teamIds.length > 0 ? [...new Set(input.teamIds)] : null;
    const stored: StoredApiToken = {
      id: newId(),
      userId,
      name,
      prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
      hash: hashToken(secret),
      teamIds,
      readOnly: input.readOnly === true,
      createdAt: nowIso(),
      lastUsedAt: null,
      expiresAt:
        input.expiresInDays && input.expiresInDays > 0
          ? new Date(Date.now() + input.expiresInDays * 86400_000).toISOString()
          : null,
    };
    await this.ctx.storage.apiTokens.create(stored);
    return { token: toPublic(stored), secret };
  }

  async list(userId: string): Promise<ApiToken[]> {
    const rows = await this.ctx.storage.apiTokens.listByUser(userId);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(toPublic);
  }

  async revoke(userId: string, tokenId: string): Promise<void> {
    await this.ctx.storage.apiTokens.delete(tokenId, userId);
  }

  /**
   * Resolve a raw bearer token to its active user and the scope the token
   * carries, updating last-used. Returns null for unknown, expired, or
   * inactive-user tokens.
   */
  async authenticate(raw: string): Promise<{ user: User; scope: TokenScope } | null> {
    if (!raw.startsWith(TOKEN_PREFIX)) return null;
    const candidateHash = hashToken(raw);
    const stored = await this.ctx.storage.apiTokens.getByHash(candidateHash);
    if (!stored) return null;
    // Constant-time confirm (getByHash already matched, but be explicit).
    const a = Buffer.from(candidateHash);
    const b = Buffer.from(stored.hash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    if (stored.expiresAt && stored.expiresAt < nowIso()) return null;
    const user = await this.ctx.storage.users.get(stored.userId);
    if (!user || !user.active) return null;
    await this.ctx.storage.apiTokens.touchLastUsed(stored.id, nowIso());
    return { user, scope: { teamIds: stored.teamIds, readOnly: stored.readOnly } };
  }
}
