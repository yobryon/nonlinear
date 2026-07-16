import type { CreateCycleInput, Cycle, UpdateCycleInput } from '@nonlinear/shared';
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

export class CycleService {
  constructor(private ctx: Ctx) {}

  async create(input: CreateCycleInput): Promise<Cycle> {
    const { storage, bus } = this.ctx;
    const team = await storage.teams.get(input.teamId);
    if (!team) throw notFound('Team');
    if (input.endsAt <= input.startsAt) {
      throw new DomainError('invalid_dates', 'Cycle must end after it starts');
    }
    const siblings = (await storage.cycles.all()).filter((c) => c.teamId === team.id);
    const now = nowIso();
    const cycle: Cycle = {
      id: newId(),
      teamId: team.id,
      number: Math.max(0, ...siblings.map((c) => c.number)) + 1,
      name: input.name ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdAt: now,
      updatedAt: now,
    };
    await storage.cycles.insert(cycle);
    await bus.publish([created('cycle', cycle)]);
    return cycle;
  }

  /**
   * Ensure the team has a cycle covering "now" (and one upcoming), creating
   * them on the team's cadence. Called lazily by the API on bootstrap.
   */
  async ensureCurrentCycles(teamId: string): Promise<Cycle[]> {
    const { storage } = this.ctx;
    const team = await storage.teams.get(teamId);
    if (!team || !team.cyclesEnabled) return [];
    const createdCycles: Cycle[] = [];
    const all = () => storage.cycles.all().then((cs) => cs.filter((c) => c.teamId === teamId));

    const durationMs = team.cycleDurationWeeks * 7 * 24 * 60 * 60 * 1000;
    let cycles = await all();
    const now = Date.now();

    const latestEnd = cycles.reduce((max, c) => (c.endsAt > max ? c.endsAt : max), '');
    let cursor = latestEnd ? new Date(latestEnd).getTime() : startOfWeek(now);
    // Create cycles until one covers now and one more sits in the future.
    while (cursor < now + durationMs) {
      const cycle = await this.create({
        teamId,
        startsAt: new Date(cursor).toISOString(),
        endsAt: new Date(cursor + durationMs).toISOString(),
      });
      createdCycles.push(cycle);
      cursor += durationMs;
      cycles = await all();
    }
    return createdCycles;
  }

  async update(cycleId: string, input: UpdateCycleInput): Promise<Cycle> {
    const { storage, bus } = this.ctx;
    const cycle = await storage.cycles.get(cycleId);
    if (!cycle) throw notFound('Cycle');
    if (input.name !== undefined) cycle.name = input.name;
    if (input.startsAt !== undefined) cycle.startsAt = input.startsAt;
    if (input.endsAt !== undefined) cycle.endsAt = input.endsAt;
    if (cycle.endsAt <= cycle.startsAt) {
      throw new DomainError('invalid_dates', 'Cycle must end after it starts');
    }
    cycle.updatedAt = nowIso();
    await storage.cycles.update(cycle);
    await bus.publish([updated('cycle', cycle)]);
    return cycle;
  }

  async remove(cycleId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const cycle = await storage.cycles.get(cycleId);
    if (!cycle) throw notFound('Cycle');
    const deltas: DeltaInput[] = [];
    const now = nowIso();
    for (const issue of await storage.issues.all()) {
      if (issue.cycleId === cycleId) {
        issue.cycleId = null;
        issue.updatedAt = now;
        await storage.issues.update(issue);
        deltas.push(updated('issue', issue));
      }
    }
    await storage.cycles.delete(cycleId);
    deltas.push(deleted('cycle', cycleId));
    await bus.publish(deltas);
  }
}

function startOfWeek(epochMs: number): number {
  const d = new Date(epochMs);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // days since Monday
  return d.getTime() - diff * 24 * 60 * 60 * 1000;
}
