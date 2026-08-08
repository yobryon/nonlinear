import type { WebSocket } from 'ws';
import {
  applyScope,
  effectiveInternalIntake,
  visibilityFor,
  type Domain,
  type Visibility,
} from '@nonlinear/core';
import type { ClientSyncMessage, ServerSyncMessage, SyncDelta } from '@nonlinear/shared';

interface Connection {
  socket: WebSocket;
  userId: string;
  /** Team scope the presenting token carries (null = all the user's teams). */
  scopeTeamIds: string[] | null;
  /** Team-scoped read visibility, resolved before the connection joins the
   *  broadcast set. */
  vis: Visibility;
  /** Live deltas are buffered until the hello replay finishes so the client
   *  never sees an older delta after a newer one. */
  replaying: boolean;
  buffer: SyncDelta[];
}

/**
 * The live sync fan-out. Read isolation mirrors the bootstrap snapshot: a
 * non-admin receives deltas for teams they belong to (all of them), plus the
 * shell of any internal-intake team they can file to (its metadata/states/labels
 * and only the issues they filed there). Entity→team/creator resolution runs
 * through small indexes maintained from the delta stream, so filtering stays
 * synchronous and preserves delta ordering.
 */
export class SyncHub {
  private connections = new Set<Connection>();
  private issueTeam = new Map<string, string>();
  private issueCreator = new Map<string, string>();
  private commentIssue = new Map<string, string>();
  private projectTeams = new Map<string, string[]>();
  private docProject = new Map<string, string | null>();
  private membershipInfo = new Map<string, { userId: string; teamId: string }>();
  private teamIntake = new Map<string, boolean>();
  private ready: Promise<void>;

  constructor(private domain: Domain) {
    this.ready = this.seedIndexes();
    domain.bus.subscribe((deltas) => {
      void this.onDeltas(deltas);
    });
  }

  private async seedIndexes(): Promise<void> {
    const s = this.domain.ctx.storage;
    const [issues, comments, projects, documents, memberships, teams] = await Promise.all([
      s.issues.all(),
      s.comments.all(),
      s.projects.all(),
      s.documents.all(),
      s.teamMemberships.all(),
      s.teams.all(),
    ]);
    for (const i of issues) {
      this.issueTeam.set(i.id, i.teamId);
      this.issueCreator.set(i.id, i.creatorId);
    }
    for (const c of comments) this.commentIssue.set(c.id, c.issueId);
    for (const p of projects) this.projectTeams.set(p.id, p.teamIds);
    for (const d of documents) this.docProject.set(d.id, d.projectId);
    for (const m of memberships)
      this.membershipInfo.set(m.id, { userId: m.userId, teamId: m.teamId });
    for (const t of teams) this.teamIntake.set(t.id, effectiveInternalIntake(t));
  }

  private computeVis(userId: string, scopeTeamIds: string[] | null): Promise<Visibility> {
    return visibilityFor(this.domain.ctx, userId).then((v) => applyScope(v, scopeTeamIds));
  }

  /** Keep the resolution indexes current with a create/update delta. */
  private indexDelta(delta: SyncDelta): void {
    if (delta.action === 'delete') return;
    const d = delta.data as Record<string, unknown>;
    switch (delta.model) {
      case 'issue':
        this.issueTeam.set(d.id as string, d.teamId as string);
        this.issueCreator.set(d.id as string, d.creatorId as string);
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

  private member(vis: Visibility, teamId: string | null | undefined): boolean {
    return vis.seesAll || (teamId != null && vis.teamIds.has(teamId));
  }

  private someMemberTeam(vis: Visibility, teamIds: string[] | undefined): boolean {
    if (vis.seesAll) return true;
    return !!teamIds && teamIds.some((t) => vis.teamIds.has(t));
  }

  /** Issue-level read: any issue of a member team, or one you filed in an intake team. */
  private canReadIssue(
    vis: Visibility,
    teamId: string | undefined,
    creatorId: string | undefined,
  ): boolean {
    if (vis.seesAll) return true;
    if (teamId == null) return false;
    if (vis.teamIds.has(teamId)) return true;
    return vis.intakeTeamIds.has(teamId) && creatorId === vis.userId;
  }

  private visibleTo(delta: SyncDelta, conn: Connection): boolean {
    if (delta.action === 'delete') return true; // no content; client ignores unknown ids
    const vis = conn.vis;
    const d = delta.data as Record<string, unknown>;
    const shell = (teamId: string | null | undefined) =>
      vis.seesAll || (teamId != null && (vis.teamIds.has(teamId) || vis.intakeTeamIds.has(teamId)));
    switch (delta.model) {
      case 'notification':
      case 'favorite':
      case 'issueReminder':
        return d.userId === conn.userId;
      case 'customView':
      case 'dashboard':
        return d.shared === true || d.creatorId === conn.userId;
      case 'webhook':
        return vis.seesAll;
      case 'workspace':
      case 'user':
      case 'initiative':
      case 'customer':
      case 'customerRequest':
      case 'issueActivity':
        return true;
      // Team shells — visible to members AND intake users.
      case 'team':
        return shell(d.id as string);
      case 'teamMembership':
        return shell(d.teamId as string) || d.userId === conn.userId;
      case 'workflowState':
        return shell(d.teamId as string);
      case 'label':
        return d.teamId == null || shell(d.teamId as string);
      // Member-only surfaces.
      case 'cycle':
      case 'triageRule':
      case 'issueTemplate':
        return this.member(vis, d.teamId as string);
      case 'project':
        return this.someMemberTeam(vis, d.teamIds as string[]);
      case 'projectMilestone':
      case 'projectUpdate':
        return this.someMemberTeam(vis, this.projectTeams.get(d.projectId as string));
      case 'document': {
        const pid = d.projectId as string | null;
        return pid == null || this.someMemberTeam(vis, this.projectTeams.get(pid));
      }
      case 'documentComment': {
        const pid = this.docProject.get(d.documentId as string);
        return pid == null || this.someMemberTeam(vis, this.projectTeams.get(pid));
      }
      // Issues + their children — member team, or your own in an intake team.
      case 'issue':
        return this.canReadIssue(vis, d.teamId as string, d.creatorId as string);
      case 'comment': {
        const issueId = this.commentIssue.get(d.issueId as string) ?? (d.issueId as string);
        return this.canReadIssue(vis, this.issueTeam.get(issueId), this.issueCreator.get(issueId));
      }
      case 'reaction': {
        const issueId = this.commentIssue.get(d.commentId as string);
        return (
          issueId != null &&
          this.canReadIssue(vis, this.issueTeam.get(issueId), this.issueCreator.get(issueId))
        );
      }
      case 'attachment':
      case 'issueRelation': {
        const issueId = d.issueId as string;
        return this.canReadIssue(vis, this.issueTeam.get(issueId), this.issueCreator.get(issueId));
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
    for (const d of deltas) this.indexDelta(d);

    // Membership or intake-topology changes alter which teams a user can see or
    // file to; recompute the affected connections' visibility and rebootstrap.
    const membershipUsers = new Set<string>();
    let intakeTopologyChanged = false;
    for (const d of deltas) {
      if (d.model === 'teamMembership') {
        if (d.action === 'delete') {
          const info = this.membershipInfo.get((d.data as { id: string }).id);
          if (info) membershipUsers.add(info.userId);
          this.membershipInfo.delete((d.data as { id: string }).id);
        } else membershipUsers.add((d.data as { userId: string }).userId);
      } else if (d.model === 'team') {
        const id = (d.data as { id: string }).id;
        if (d.action === 'delete') {
          if (this.teamIntake.get(id)) intakeTopologyChanged = true;
          this.teamIntake.delete(id);
        } else {
          const now = effectiveInternalIntake(d.data as never);
          if (this.teamIntake.get(id) !== now) intakeTopologyChanged = true;
          this.teamIntake.set(id, now);
        }
      }
    }

    const reboot = new Set<Connection>();
    for (const conn of this.connections) {
      if (conn.vis.seesAll) continue; // admins are unaffected by membership/intake changes
      if (intakeTopologyChanged || membershipUsers.has(conn.userId)) {
        conn.vis = await this.computeVis(conn.userId, conn.scopeTeamIds);
        conn.buffer = [];
        reboot.add(conn);
      }
    }

    for (const conn of this.connections) {
      if (reboot.has(conn)) {
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
