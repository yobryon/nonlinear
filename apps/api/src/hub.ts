import type { WebSocket } from 'ws';
import type { Domain } from '@nonlinear/core';
import type { ClientSyncMessage, ServerSyncMessage, SyncDelta } from '@nonlinear/shared';

interface Connection {
  socket: WebSocket;
  userId: string;
  /** Live deltas are buffered until the hello replay finishes so the client
   *  never sees an older delta after a newer one. */
  replaying: boolean;
  buffer: SyncDelta[];
}

/** Per-user visibility: notifications and favorites only go to their owner. */
function visibleTo(delta: SyncDelta, userId: string): boolean {
  if (delta.model !== 'notification' && delta.model !== 'favorite') return true;
  if (delta.action === 'delete') return true; // clients ignore unknown ids
  return (delta.data as { userId?: string }).userId === userId;
}

export class SyncHub {
  private connections = new Set<Connection>();

  constructor(private domain: Domain) {
    domain.bus.subscribe((deltas) => this.broadcast(deltas));
  }

  private send(socket: WebSocket, message: ServerSyncMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  private broadcast(deltas: SyncDelta[]): void {
    for (const conn of this.connections) {
      const visible = deltas.filter((d) => visibleTo(d, conn.userId));
      if (visible.length === 0) continue;
      if (conn.replaying) conn.buffer.push(...visible);
      else this.send(conn.socket, { type: 'deltas', deltas: visible });
    }
  }

  add(socket: WebSocket, userId: string): void {
    const conn: Connection = { socket, userId, replaying: true, buffer: [] };
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
      const visible = missed.filter((d) => visibleTo(d, conn.userId));
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
