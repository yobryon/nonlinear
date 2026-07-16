import type { CreateLabelInput, Label, UpdateLabelInput } from '@nonlinear/shared';
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

export class LabelService {
  constructor(private ctx: Ctx) {}

  async create(input: CreateLabelInput): Promise<Label> {
    const { storage, bus } = this.ctx;
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'Label name is required');
    if (input.teamId && !(await storage.teams.get(input.teamId))) throw notFound('Team');
    for (const existing of await storage.labels.all()) {
      if (
        existing.name.toLowerCase() === name.toLowerCase() &&
        (existing.teamId ?? null) === (input.teamId ?? null)
      ) {
        throw new DomainError('label_exists', 'A label with this name already exists', 409);
      }
    }
    const now = nowIso();
    const label: Label = {
      id: newId(),
      teamId: input.teamId ?? null,
      name,
      color: input.color,
      createdAt: now,
      updatedAt: now,
    };
    await storage.labels.insert(label);
    await bus.publish([created('label', label)]);
    return label;
  }

  async update(labelId: string, input: UpdateLabelInput): Promise<Label> {
    const { storage, bus } = this.ctx;
    const label = await storage.labels.get(labelId);
    if (!label) throw notFound('Label');
    if (input.name !== undefined) label.name = input.name.trim() || label.name;
    if (input.color !== undefined) label.color = input.color;
    label.updatedAt = nowIso();
    await storage.labels.update(label);
    await bus.publish([updated('label', label)]);
    return label;
  }

  async remove(labelId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const label = await storage.labels.get(labelId);
    if (!label) throw notFound('Label');
    const deltas: DeltaInput[] = [];
    const now = nowIso();
    for (const issue of await storage.issues.all()) {
      if (issue.labelIds.includes(labelId)) {
        issue.labelIds = issue.labelIds.filter((id) => id !== labelId);
        issue.updatedAt = now;
        await storage.issues.update(issue);
        deltas.push(updated('issue', issue));
      }
    }
    for (const favorite of await storage.favorites.all()) {
      if (favorite.type === 'label' && favorite.targetId === labelId) {
        await storage.favorites.delete(favorite.id);
        deltas.push(deleted('favorite', favorite.id));
      }
    }
    await storage.labels.delete(labelId);
    deltas.push(deleted('label', labelId));
    await bus.publish(deltas);
  }
}
