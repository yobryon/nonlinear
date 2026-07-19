import pg from 'pg';
import type { AuditEvent, Issue, IssueActivity, SyncDelta, Team, User } from '@nonlinear/shared';
import type {
  ActivityStore,
  ApiTokenStore,
  AuditPage,
  AuditStore,
  EntityStore,
  IssueStore,
  Session,
  SessionStore,
  Storage,
  StoredApiToken,
  SyncLogStore,
  TeamStore,
  UserStore,
} from '@nonlinear/core';
import { migrate } from './migrate.js';

export { migrate };

class PgEntityStore<T extends { id: string }> implements EntityStore<T> {
  constructor(
    protected pool: pg.Pool,
    protected table: string,
  ) {}

  async get(id: string): Promise<T | null> {
    const { rows } = await this.pool.query(`SELECT data FROM ${this.table} WHERE id = $1`, [id]);
    return rows[0]?.data ?? null;
  }

  async all(): Promise<T[]> {
    const { rows } = await this.pool.query(`SELECT data FROM ${this.table}`);
    return rows.map((r) => r.data);
  }

  async insert(entity: T): Promise<void> {
    await this.pool.query(`INSERT INTO ${this.table} (id, data) VALUES ($1, $2)`, [
      entity.id,
      JSON.stringify(entity),
    ]);
  }

  async update(entity: T): Promise<void> {
    await this.pool.query(`UPDATE ${this.table} SET data = $2 WHERE id = $1`, [
      entity.id,
      JSON.stringify(entity),
    ]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE id = $1`, [id]);
  }
}

class PgUserStore extends PgEntityStore<User> implements UserStore {
  async getByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query(`SELECT data FROM users WHERE data->>'email' = $1`, [
      email,
    ]);
    return rows[0]?.data ?? null;
  }

  async insertWithPassword(user: User, passwordHash: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO users (id, data) VALUES ($1, $2)', [
        user.id,
        JSON.stringify(user),
      ]);
      await client.query('INSERT INTO auth_credentials (user_id, password_hash) VALUES ($1, $2)', [
        user.id,
        passwordHash,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      'SELECT password_hash FROM auth_credentials WHERE user_id = $1',
      [userId],
    );
    return rows[0]?.password_hash ?? null;
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_credentials (user_id, password_hash) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [userId, passwordHash],
    );
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM users');
    return rows[0].n;
  }

  async getBySsoSubject(subject: string): Promise<User | null> {
    const { rows } = await this.pool.query(
      `SELECT u.data FROM users u
       JOIN sso_identities s ON s.user_id = u.id
       WHERE s.subject = $1`,
      [subject],
    );
    return rows[0]?.data ?? null;
  }

  async linkSsoSubject(userId: string, subject: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sso_identities (subject, user_id) VALUES ($1, $2)
       ON CONFLICT (subject) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [subject, userId],
    );
  }
}

class PgTeamStore extends PgEntityStore<Team> implements TeamStore {
  override async insert(team: Team): Promise<void> {
    await super.insert(team);
    await this.pool.query(
      'INSERT INTO team_counters (team_id, counter) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [team.id, team.issueCounter],
    );
  }

  async nextIssueNumber(teamId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `INSERT INTO team_counters (team_id, counter) VALUES ($1, 1)
       ON CONFLICT (team_id) DO UPDATE SET counter = team_counters.counter + 1
       RETURNING counter::int AS counter`,
      [teamId],
    );
    return rows[0].counter;
  }
}

class PgIssueStore extends PgEntityStore<Issue> implements IssueStore {
  async byTeam(teamId: string): Promise<Issue[]> {
    const { rows } = await this.pool.query(`SELECT data FROM issues WHERE data->>'teamId' = $1`, [
      teamId,
    ]);
    return rows.map((r) => r.data);
  }
}

class PgActivityStore extends PgEntityStore<IssueActivity> implements ActivityStore {
  async byIssue(issueId: string): Promise<IssueActivity[]> {
    const { rows } = await this.pool.query(
      `SELECT data FROM issue_activities
       WHERE data->>'issueId' = $1
       ORDER BY data->>'createdAt'`,
      [issueId],
    );
    return rows.map((r) => r.data);
  }
}

class PgSessionStore implements SessionStore {
  constructor(private pool: pg.Pool) {}

  async create(session: Session): Promise<void> {
    await this.pool.query(
      'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
      [session.token, session.userId, session.createdAt, session.expiresAt],
    );
  }

  async get(token: string): Promise<Session | null> {
    const { rows } = await this.pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
    const row = rows[0];
    if (!row) return null;
    return {
      token: row.token,
      userId: row.user_id,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    };
  }

  async delete(token: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}

class PgApiTokenStore implements ApiTokenStore {
  constructor(private pool: pg.Pool) {}

  private map(row: {
    id: string;
    user_id: string;
    name: string;
    prefix: string;
    hash: string;
    created_at: Date;
    last_used_at: Date | null;
    expires_at: Date | null;
  }): StoredApiToken {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      prefix: row.prefix,
      hash: row.hash,
      createdAt: row.created_at.toISOString(),
      lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    };
  }

  async create(token: StoredApiToken): Promise<void> {
    await this.pool.query(
      `INSERT INTO api_tokens (id, user_id, name, prefix, hash, created_at, last_used_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        token.id,
        token.userId,
        token.name,
        token.prefix,
        token.hash,
        token.createdAt,
        token.lastUsedAt,
        token.expiresAt,
      ],
    );
  }

  async getByHash(hash: string): Promise<StoredApiToken | null> {
    const { rows } = await this.pool.query('SELECT * FROM api_tokens WHERE hash = $1', [hash]);
    return rows[0] ? this.map(rows[0]) : null;
  }

  async listByUser(userId: string): Promise<StoredApiToken[]> {
    const { rows } = await this.pool.query('SELECT * FROM api_tokens WHERE user_id = $1', [userId]);
    return rows.map((r) => this.map(r));
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.pool.query('DELETE FROM api_tokens WHERE id = $1 AND user_id = $2', [id, userId]);
  }

  async touchLastUsed(id: string, at: string): Promise<void> {
    await this.pool.query('UPDATE api_tokens SET last_used_at = $2 WHERE id = $1', [id, at]);
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM api_tokens WHERE user_id = $1', [userId]);
  }
}

class PgSyncLog implements SyncLogStore {
  constructor(private pool: pg.Pool) {}

  async append(deltas: Omit<SyncDelta, 'syncId'>[]): Promise<SyncDelta[]> {
    if (deltas.length === 0) return [];
    const values: string[] = [];
    const params: unknown[] = [];
    deltas.forEach((d, i) => {
      values.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`);
      params.push(d.model, d.action, JSON.stringify(d.data));
    });
    const { rows } = await this.pool.query(
      `INSERT INTO sync_log (model, action, data) VALUES ${values.join(', ')}
       RETURNING sync_id::int AS sync_id, model, action, data`,
      params,
    );
    return rows.map((r) => ({
      syncId: r.sync_id,
      model: r.model,
      action: r.action,
      data: r.data,
    }));
  }

  async since(syncId: number): Promise<SyncDelta[] | null> {
    const { rows: bounds } = await this.pool.query('SELECT min(sync_id)::int AS min FROM sync_log');
    const min = bounds[0]?.min;
    if (min !== null && min !== undefined && syncId < min - 1) return null;
    const { rows } = await this.pool.query(
      `SELECT sync_id::int AS sync_id, model, action, data
       FROM sync_log WHERE sync_id > $1 ORDER BY sync_id`,
      [syncId],
    );
    return rows.map((r) => ({
      syncId: r.sync_id,
      model: r.model,
      action: r.action,
      data: r.data,
    }));
  }

  async currentSyncId(): Promise<number> {
    const { rows } = await this.pool.query(
      'SELECT coalesce(max(sync_id), 0)::int AS current FROM sync_log',
    );
    return rows[0].current;
  }
}

class PgAuditStore implements AuditStore {
  constructor(private pool: pg.Pool) {}

  async append(event: AuditEvent): Promise<void> {
    await this.pool.query('INSERT INTO audit_log (id, created_at, data) VALUES ($1, $2, $3)', [
      event.id,
      event.createdAt,
      JSON.stringify(event),
    ]);
  }

  async list(opts: { limit: number; cursor?: string | null }): Promise<AuditPage> {
    // Order by (created_at, id) descending; the cursor is "<createdAt> <id>".
    const [curCreated, curId] = opts.cursor ? splitAuditCursor(opts.cursor) : [null, null];
    const { rows } =
      curCreated !== null
        ? await this.pool.query(
            `SELECT id, created_at, data FROM audit_log
             WHERE (created_at, id) < ($1::timestamptz, $2)
             ORDER BY created_at DESC, id DESC LIMIT $3`,
            [curCreated, curId, opts.limit],
          )
        : await this.pool.query(
            `SELECT id, created_at, data FROM audit_log
             ORDER BY created_at DESC, id DESC LIMIT $1`,
            [opts.limit],
          );
    const events = rows.map((r) => r.data as AuditEvent);
    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === opts.limit && last
        ? `${(last.data as AuditEvent).createdAt} ${last.id}`
        : null;
    return { events, nextCursor };
  }
}

function splitAuditCursor(cursor: string): [string, string] {
  const i = cursor.indexOf(' ');
  return i === -1 ? [cursor, ''] : [cursor.slice(0, i), cursor.slice(i + 1)];
}

export interface PostgresStorageOptions {
  connectionString: string;
  /** Pool size; keep small — this app is a single low-resource container. */
  max?: number;
}

export async function createPostgresStorage(options: PostgresStorageOptions): Promise<Storage> {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 5,
  });
  await migrate(pool);
  return {
    workspaces: new PgEntityStore(pool, 'workspaces'),
    users: new PgUserStore(pool, 'users'),
    teams: new PgTeamStore(pool, 'teams'),
    teamMemberships: new PgEntityStore(pool, 'team_memberships'),
    workflowStates: new PgEntityStore(pool, 'workflow_states'),
    issues: new PgIssueStore(pool, 'issues'),
    labels: new PgEntityStore(pool, 'labels'),
    comments: new PgEntityStore(pool, 'comments'),
    reactions: new PgEntityStore(pool, 'reactions'),
    projects: new PgEntityStore(pool, 'projects'),
    projectMilestones: new PgEntityStore(pool, 'project_milestones'),
    cycles: new PgEntityStore(pool, 'cycles'),
    issueRelations: new PgEntityStore(pool, 'issue_relations'),
    notifications: new PgEntityStore(pool, 'notifications'),
    favorites: new PgEntityStore(pool, 'favorites'),
    attachments: new PgEntityStore(pool, 'attachments'),
    initiatives: new PgEntityStore(pool, 'initiatives'),
    documents: new PgEntityStore(pool, 'documents'),
    webhooks: new PgEntityStore(pool, 'webhooks'),
    customViews: new PgEntityStore(pool, 'custom_views'),
    issueTemplates: new PgEntityStore(pool, 'issue_templates'),
    projectUpdates: new PgEntityStore(pool, 'project_updates'),
    issueReminders: new PgEntityStore(pool, 'issue_reminders'),
    customers: new PgEntityStore(pool, 'customers'),
    customerRequests: new PgEntityStore(pool, 'customer_requests'),
    documentComments: new PgEntityStore(pool, 'document_comments'),
    triageRules: new PgEntityStore(pool, 'triage_rules'),
    activities: new PgActivityStore(pool, 'issue_activities'),
    sessions: new PgSessionStore(pool),
    apiTokens: new PgApiTokenStore(pool),
    auditLog: new PgAuditStore(pool),
    syncLog: new PgSyncLog(pool),
    close: () => pool.end(),
  };
}
