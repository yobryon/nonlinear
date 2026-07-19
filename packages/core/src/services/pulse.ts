import type { PulseFeed, PulseItem } from '@nonlinear/shared';
import type { Ctx } from '../domain.js';

/**
 * Pulse: a cross-workspace digest of what moved recently — project health
 * updates, projects completed/created, cycles finished, and issue throughput
 * per team. Computed on demand from already-stored entities (no new storage);
 * the API serves it and can hand it to the AI summarizer.
 */
export class PulseService {
  constructor(private ctx: Ctx) {}

  async feed(sinceDays = 7): Promise<PulseFeed> {
    const { storage } = this.ctx;
    const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const [projects, updates, cycles, issues, teams] = await Promise.all([
      storage.projects.all(),
      storage.projectUpdates.all(),
      storage.cycles.all(),
      storage.issues.all(),
      storage.teams.all(),
    ]);
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const items: PulseItem[] = [];

    for (const u of updates) {
      if (u.createdAt < cutoff) continue;
      items.push({
        id: `update-${u.id}`,
        type: 'project_update',
        at: u.createdAt,
        title: `${projectName.get(u.projectId) ?? 'Project'} — health update`,
        detail: excerpt(u.body),
        actorId: u.authorId,
        targetType: 'project',
        targetId: u.projectId,
        health: u.health,
      });
    }

    for (const p of projects) {
      if (p.completedAt && p.completedAt >= cutoff) {
        items.push({
          id: `proj-done-${p.id}`,
          type: 'project_completed',
          at: p.completedAt,
          title: `Project completed: ${p.name}`,
          detail: '',
          actorId: p.leadId,
          targetType: 'project',
          targetId: p.id,
          health: null,
        });
      }
      if (p.createdAt >= cutoff && !p.completedAt) {
        items.push({
          id: `proj-new-${p.id}`,
          type: 'project_created',
          at: p.createdAt,
          title: `New project: ${p.name}`,
          detail: p.description ? excerpt(p.description) : '',
          actorId: p.leadId,
          targetType: 'project',
          targetId: p.id,
          health: null,
        });
      }
    }

    for (const c of cycles) {
      // A cycle that ended within the window.
      if (c.endsAt >= cutoff && c.endsAt <= now) {
        const completed = issues.filter(
          (i) => i.cycleId === c.id && i.completedAt && i.completedAt <= c.endsAt,
        ).length;
        const total = issues.filter((i) => i.cycleId === c.id).length;
        items.push({
          id: `cycle-${c.id}`,
          type: 'cycle_completed',
          at: c.endsAt,
          title: `${teamName.get(c.teamId) ?? 'Team'} — ${c.name ?? `Cycle ${c.number}`} ended`,
          detail: total > 0 ? `${completed}/${total} issues completed` : 'no issues',
          actorId: null,
          targetType: 'cycle',
          targetId: c.id,
          health: null,
        });
      }
    }

    // Issue throughput: one item per team summarizing completions in the window.
    const byTeam = new Map<string, { count: number; latest: string }>();
    for (const i of issues) {
      if (!i.completedAt || i.completedAt < cutoff) continue;
      const agg = byTeam.get(i.teamId) ?? { count: 0, latest: i.completedAt };
      agg.count += 1;
      if (i.completedAt > agg.latest) agg.latest = i.completedAt;
      byTeam.set(i.teamId, agg);
    }
    for (const [teamId, agg] of byTeam) {
      items.push({
        id: `throughput-${teamId}`,
        type: 'issues_completed',
        at: agg.latest,
        title: `${teamName.get(teamId) ?? 'Team'} — ${agg.count} issue${agg.count === 1 ? '' : 's'} completed`,
        detail: `in the last ${sinceDays} days`,
        actorId: null,
        targetType: 'team',
        targetId: teamId,
        health: null,
      });
    }

    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return { items, sinceDays };
  }
}

function excerpt(body: string, max = 180): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
