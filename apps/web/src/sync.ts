import type { ServerSyncMessage } from '@nonlinear/shared';
import { api } from './api.js';
import { useStore } from './store.js';

/**
 * Keeps the store live: bootstrap over REST, then a WebSocket delta stream.
 * Reconnects with backoff; re-bootstraps when the server says our syncId is
 * too old to replay.
 */
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let stopped = false;
let pingTimer: ReturnType<typeof setInterval> | null = null;

export async function startSync(): Promise<void> {
  stopped = false;
  const payload = await api.bootstrap();
  useStore.getState().applyBootstrap(payload);
  connect();
}

export function stopSync(): void {
  stopped = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (pingTimer) clearInterval(pingTimer);
  socket?.close();
  socket = null;
}

function connect(): void {
  if (stopped) return;
  const store = useStore.getState();
  store.setConnection('connecting');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/api/ws`);

  socket.onopen = () => {
    attempts = 0;
    useStore.getState().setConnection('online');
    socket?.send(JSON.stringify({ type: 'hello', lastSyncId: useStore.getState().syncId }));
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);
  };

  socket.onmessage = (event) => {
    let message: ServerSyncMessage;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'deltas') {
      useStore.getState().applyDeltas(message.deltas);
    } else if (message.type === 'rebootstrap') {
      void api.bootstrap().then((payload) => useStore.getState().applyBootstrap(payload));
    }
  };

  socket.onclose = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (stopped) return;
    useStore.getState().setConnection('offline');
    attempts += 1;
    const delay = Math.min(15000, 500 * 2 ** Math.min(attempts, 5));
    reconnectTimer = setTimeout(connect, delay);
  };

  socket.onerror = () => {
    socket?.close();
  };
}
