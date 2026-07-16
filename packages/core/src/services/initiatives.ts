import type { CreateInitiativeInput, Initiative, UpdateInitiativeInput } from '@nonlinear/shared';
import {
  DomainError,
  created,
  deleted,
  notFound,
  updated,
  type Ctx,
  type DeltaInput,
} from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { keyAfterAll } from '../util/fractional.js';
import { colorFor } from '../util/colors.js';

export class InitiativeService {
  constructor(private ctx: Ctx) {}

  async create(input: CreateInitiativeInput): Promise<Initiative> {
    const { storage, bus } = this.ctx;
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'Initiative name is required');
    const now = nowIso();
    const existing = await storage.initiatives.all();
    const initiative: Initiative = {
      id: newId(),
      name,
      description: input.description ?? '',
      color: input.color ?? colorFor(name),
      status: input.status ?? 'planned',
      ownerId: input.ownerId ?? null,
      targetDate: input.targetDate ?? null,
      sortOrder: keyAfterAll(existing.map((i) => i.sortOrder)),
      createdAt: now,
      updatedAt: now,
    };
    await storage.initiatives.insert(initiative);
    await bus.publish([created('initiative', initiative)]);
    return initiative;
  }

  async update(initiativeId: string, input: UpdateInitiativeInput): Promise<Initiative> {
    const { storage, bus } = this.ctx;
    const initiative = await storage.initiatives.get(initiativeId);
    if (!initiative) throw notFound('Initiative');
    if (input.name !== undefined) initiative.name = input.name.trim() || initiative.name;
    if (input.description !== undefined) initiative.description = input.description;
    if (input.color !== undefined) initiative.color = input.color;
    if (input.status !== undefined) initiative.status = input.status;
    if (input.ownerId !== undefined) initiative.ownerId = input.ownerId;
    if (input.targetDate !== undefined) initiative.targetDate = input.targetDate;
    if (input.sortOrder !== undefined) initiative.sortOrder = input.sortOrder;
    initiative.updatedAt = nowIso();
    await storage.initiatives.update(initiative);
    await bus.publish([updated('initiative', initiative)]);
    return initiative;
  }

  async remove(initiativeId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const initiative = await storage.initiatives.get(initiativeId);
    if (!initiative) throw notFound('Initiative');
    const deltas: DeltaInput[] = [];
    const now = nowIso();
    for (const project of await storage.projects.all()) {
      if (project.initiativeId === initiativeId) {
        project.initiativeId = null;
        project.updatedAt = now;
        await storage.projects.update(project);
        deltas.push(updated('project', project));
      }
    }
    await storage.initiatives.delete(initiativeId);
    deltas.push(deleted('initiative', initiativeId));
    await bus.publish(deltas);
  }
}
