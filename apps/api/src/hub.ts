import type { WebSocket } from 'ws';
import type { Domain } from '@nonlinear/core';
import type { ClientSyncMessage, ServerSyncMessage, SyncDelta } from '@nonlinear/shared';

interface Vis {
  seesAll: boolean;
  teamIds: Set<string>;
}

interface Connection {
  socket: WebSocket;
  userId: string;
  /** Team scope the presenting token carries (null = all the user's teams). */
  scopeTeamIds: string[] | null;
  /** Team-scoped read visibility, resolved before the connection joins the
   *  broadcast set. */
  vis: Vis;
  /** Live deltas are buffered until the hello replay finishes so the client
   *  never sees an older delta after a newer one. */
  replaying: boolean;
  buffer: SyncDelta[];
}

/**
 * The live sync fan-out. Read isolation mirrors the bootstrap snapshot: a
 * non-admin only receives deltas for teams they belong to (and the entities
 * hanging off them). Team membership for a delta's entity is resolved through
 * small indexes maintained from the delta stream, so filtering stays
 * synchronous and preserves delta ordering.
 */
export class SyncHub {
  private connections = new Set<Connection>();
  // model → team resolution indexes, seeded from storage then kept current.
  private issueTeam = new Map<string, string>();
  private commentIssue = new Map<string, string>();
  private projectTeams = new Map<string, string[]>();
  private docProject = new Map<string, string | null>();
  private membershipInfo = new Map<string, { userId: string; teamId: string }>();
  private ready: Promise<void>;

  constructor(private domain: Domain) {
    this.ready = this.seedIndexes();
    domain.bus.subscribe((deltas) => {
      void this.onDeltas(deltas);
    });
  }

  private async seedIndexes(): Promise<void> {
    const s = this.domain.ctx.storage;
    const [issues, comments, projects, documents, memberships] = await Promise.all([
      s.issues.all(),
      s.comments.all(),
      s.projects.all(),
      s.documents.all(),
      s.teamMemberships.all(),
    ]);
    for (const i of issues) this.issueTeam.set(i.id, i.teamId);
    for (const c of comments) this.commentIssue.set(c.id, c.issueId);
    for (const p of projects) this.projectTeams.set(p.id, p.teamIds);
    for (const d of documents) this.docProject.set(d.id, d.projectId);
    for (const m of memberships) this.membershipInfo.set(m.id, { userId: m.userId, teamId: m.teamId });
  }

  private async computeVis(userId: string, scopeTeamIds: string[] | null): Promise<Vis> {
    const s = this.domain.ctx.storage;
    const user = await s.users.get(userId);
    let vis: Vis;
    if (user?.role === 'admin') {
      vis = { seesAll: true, teamIds: new Set() };
    } else {
      const teamIds = new Set<string>();
      for (const m of await s.teamMemberships.all()) if (m.userId === userId) teamIds.add(m.teamId);
      vis = { seesAll: false, teamIds };
    }
    if (!scopeTeamIds) return vis;
    // A scoped token can only narrow: an admin collapses to exactly its scope.
    const scope = new Set(scopeTeamIds);
    if (vis.seesAll) return { seesAll: false, teamIds: scope };
    return { seesAll: false, teamIds: new Set([...vis.teamIds].filter((t) => scope.has(t))) };
  }

  /** Keep the resolution indexes current with a create/update delta. */
  private indexDelta(delta: SyncDelta): void {
    if (delta.action === 'delete') return;
    const d = delta.data as Record<string, unknown>;
    switch (delta.model) {
      case 'issue':
        this.issueTeam.set(d.id as string, d.teamId as string);
        break;
      case 'comment':
        this.commentIssue.set(d.id as string, d.issueId as string);
        break;
      case 'project':
        this.projectTeams.set(d.id as string, d.teamIds as string[]);
        break;
      case 'document':
        this.docProject.set(d.id as string, (d.projectId as string | null) ?? null);
        break;
      case 'teamMembership':
        this.membershipInfo.set(d.id as string, {
          userId: d.userId as string,
          teamId: d.teamId as string,
        });
        break;
    }
  }

  private sees(vis: Vis, teamId: string | null | undefined): boolean {
    return vis.seesAll || (teamId != null && vis.teamIds.has(teamId));
  }

  private someTeam(vis: Vis, teamIds: string[] | undefined): boolean {
    if (vis.seesAll) return true;
    return !!teamIds && teamIds.some((t) => vis.teamIds.has(t));
  }

  private visibleTo(delta: SyncDelta, conn: Connection): boolean {
    // Delete carries no content and the client ignores unknown ids.
    if (delta.action === 'delete') return true;
    const vis = conn.vis;
    const d = delta.data as Record<string, unknown>;
    switch (delta.model) {
      // Personal models — owner only.
      case 'notification':
      case 'favorite':
      case 'issueReminder':
        return d.userId === conn.userId;
      case 'customView':
      case 'dashboard':
        return d.shared === true || d.creatorId === conn.userId;
      // Admin-only surface (carries a secret).
      case 'webhook':
        return vis.seesAll;
      // Not team-scoped — visible to everyone.
      case 'workspace':
      case 'user':
      case 'initiative':
      case 'customer':
      case 'customerRequest':
      case 'issueActivity':
        return true;
      // Directly team-scoped.
      case 'team':
        return this.sees(vis, d.id as string);
      case 'teamMembership':
        return this.sees(vis, d.teamId as string) || d.userId === conn.userId;
      case 'workflowState':
      case 'issue':
      case 'cycle':
      case 'triageRule':
      case 'issueTemplate':
        return this.sees(vis, d.teamId as string);
      case 'label':
        return d.teamId == null || this.sees(vis, d.teamId as string);
      case 'project':
        return this.someTeam(vis, d.teamIds as string[]);
      case 'projectMilestone':
      case 'projectUpdate':
        return this.someTeam(vis, this.projectTeams.get(d.projectId as string));
      case 'comment':
        return this.sees(vis, this.issueTeam.get(d.issueId as string));
      case 'reaction': {
        const issueId = this.commentIssue.get(d.commentId as string);
        return issueId != null && this.sees(vis, this.issueTeam.get(issueId));
      }
      case 'attachment':
      case 'issueRelation':
        return this.sees(vis, this.issueTeam.get(d.issueId as string));
      case 'document': {
        const pid = d.projectId as string | null;
        return pid == null || this.someTeam(vis, this.projectTeams.get(pid));
      }
      case 'documentComment': {
        const pid = this.docProject.get(d.documentId as string);
        return pid == null || this.someTeam(vis, this.projectTeams.get(pid));
      }
      default:
        return true;
    }
  }

  private send(socket: WebSocket, message: ServerSyncMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  private async onDeltas(deltas: SyncDelta[]): Promise<void> {
    await this.ready;
    // Update indexes first so children created in the same batch resolve.
    for (const d of deltas) this.indexDelta(d);

    // Membership changes expand/shrink a connected user's visibility; the clean
    // way to gain or drop a whole team's data is a rebootstrap.
    const reboot = new Set<Connection>();
    for (const d of deltas) {
      if (d.model !== 'teamMembership') continue;
      let userId: string | undefined;
      let teamId: string | undefined;
      let added = false;
      if (d.action === 'delete') {
        const info = this.membershipInfo.get((d.data as { id: string }).id);
        if (!info) continue;
        ({ userId, teamId } = info);
        this.membershipInfo.delete((d.data as { id: string }).id);
      } else {
        const data = d.data as { userId: string; teamId: string };
        userId = data.userId;
        teamId = data.teamId;
        added = true;
      }
      for (const conn of this.connections) {
        if (conn.userId !== userId || conn.vis.seesAll) continue;
        if (added) {
          // A scoped connection ignores teams outside its scope.
          if (conn.scopeTeamIds && !conn.scopeTeamIds.includes(teamId)) continue;
          conn.vis.teamIds.add(teamId);
        } else {
          if (!conn.vis.teamIds.has(teamId)) continue;
          conn.vis.teamIds.delete(teamId);
        }
        reboot.add(conn);
      }
    }

    for (const conn of this.connections) {
      if (reboot.has(conn)) {
        conn.buffer = [];
        this.send(conn.socket, { type: 'rebootstrap' });
        continue;
      }
      const visible = deltas.filter((d) => this.visibleTo(d, conn));
      if (visible.length === 0) continue;
      if (conn.replaying) conn.buffer.push(...visible);
      else this.send(conn.socket, { type: 'deltas', deltas: visible });
    }
  }

  add(socket: WebSocket, userId: string, scopeTeamIds: string[] | null = null): void {
    // Resolve visibility before joining the broadcast set. Deltas in the tiny
    // pre-registration window are recovered by the hello replay below.
    void this.computeVis(userId, scopeTeamIds).then((vis) => {
      const conn: Connection = { socket, userId, scopeTeamIds, vis, replaying: true, buffer: [] };
      this.connections.add(conn);

      socket.on('message', (raw: Buffer) => {
        let message: ClientSyncMessage;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (message.type === 'ping') {
          this.send(socket, { type: 'pong' });
          return;
        }
        if (message.type === 'hello') {
          void this.replay(conn, message.lastSyncId);
        }
      });

      socket.on('close', () => this.connections.delete(conn));
      socket.on('error', () => this.connections.delete(conn));
    });
  }

  private async replay(conn: Connection, lastSyncId: number): Promise<void> {
    try {
      const missed = await this.domain.ctx.storage.syncLog.since(lastSyncId);
      if (missed === null) {
        this.send(conn.socket, { type: 'rebootstrap' });
        conn.replaying = false;
        conn.buffer = [];
        return;
      }
      const visible = missed.filter((d) => this.visibleTo(d, conn));
      if (visible.length > 0) {
        this.send(conn.socket, { type: 'deltas', deltas: visible });
      }
      const replayMax = missed.reduce((max, d) => Math.max(max, d.syncId), lastSyncId);
      const buffered = conn.buffer.filter((d) => d.syncId > replayMax);
      if (buffered.length > 0) {
        this.send(conn.socket, { type: 'deltas', deltas: buffered });
      }
      conn.replaying = false;
      conn.buffer = [];
      this.send(conn.socket, { type: 'caught_up', syncId: Math.max(replayMax, lastSyncId) });
    } catch {
      conn.socket.close();
      this.connections.delete(conn);
    }
  }
}
