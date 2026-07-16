import type { SyncDelta, SyncModelMap, SyncModelName } from '@nonlinear/shared';
import type { Storage, SyncLogStore } from './storage.js';

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 401 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function notFound(what: string): DomainError {
  return new DomainError('not_found', `${what} not found`, 404);
}

export type DeltaInput = Omit<SyncDelta, 'syncId'>;
export type SyncListener = (deltas: SyncDelta[]) => void;

/** Append mutations to the durable sync log, then fan out to live listeners. */
export class SyncBus {
  private listeners = new Set<SyncListener>();

  constructor(private syncLog: SyncLogStore) {}

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publish(deltas: DeltaInput[]): Promise<SyncDelta[]> {
    if (deltas.length === 0) return [];
    const stamped = await this.syncLog.append(deltas);
    for (const listener of this.listeners) listener(stamped);
    return stamped;
  }
}

export function created<M extends SyncModelName>(model: M, data: SyncModelMap[M]): DeltaInput {
  return { model, action: 'create', data };
}

export function updated<M extends SyncModelName>(model: M, data: SyncModelMap[M]): DeltaInput {
  return { model, action: 'update', data };
}

export function deleted(model: SyncModelName, id: string): DeltaInput {
  return { model, action: 'delete', data: { id } };
}

export interface Ctx {
  storage: Storage;
  bus: SyncBus;
}
