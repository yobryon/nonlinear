import pg from 'pg';
import type { Issue, IssueActivity, SyncDelta, Team, User } from '@nonlinear/shared';
import type {
  ActivityStore,
  EntityStore,
  IssueStore,
  Session,
  SessionStore,
  Storage,
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
    syncLog: new PgSyncLog(pool),
    close: () => pool.end(),
  };
}
