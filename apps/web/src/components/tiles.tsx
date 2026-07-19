import { useMemo, useState } from 'react';
import type { DashboardTile, Issue, StatMetric, WorkflowState } from '@nonlinear/shared';
import { PRIORITY_LABELS, type Priority } from '@nonlinear/shared';
import { sortedStates, useStore } from '../store.js';
import { firstDayOfWeek, personName } from '../preferences.js';
import { PriorityIcon, ProjectStatusIcon, StateIcon } from '../icons.js';
import { VelocityChart } from './VelocityChart.js';
import { BurnupChart } from './BurnupChart.js';

/**
 * Reusable insight tiles, shared by the team Insights page and custom
 * dashboards. Each chart is a pure, data-driven component; `DashboardTileView`
 * computes a tile's data from the normalized store per its config and picks the
 * right chart, so a dashboard is just an arrangement of these.
 */

const SERIES = {
  created: { label: 'Created', color: '#5e6ad2' },
  completed: { label: 'Completed', color: '#2f9e68' },
} as const;

const WEEKS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startOfWeek(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() - firstDayOfWeek() + 7) % 7;
  return d.getTime() - day * 24 * 60 * 60 * 1000;
}

export interface WeekBucket {
  label: string;
  created: number;
  completed: number;
}

export function weeklyBuckets(issues: Issue[]): WeekBucket[] {
  const thisWeek = startOfWeek(Date.now());
  const buckets: WeekBucket[] = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = thisWeek - i * WEEK_MS;
    const end = start + WEEK_MS;
    const label = new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    buckets.push({
      label,
      created: issues.filter((x) => {
        const t = new Date(x.createdAt).getTime();
        return t >= start && t < end;
      }).length,
      completed: issues.filter((x) => {
        if (!x.completedAt) return false;
        const t = new Date(x.completedAt).getTime();
        return t >= start && t < end;
      }).length,
    });
  }
  return buckets;
}

export function StatTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 140,
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        background: 'var(--bg-surface)',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text-4)' }}>{hint}</div>}
    </div>
  );
}

/** Grouped weekly bars: created vs completed, hover tooltip, legend, table view. */
export function ThroughputChart({ buckets }: { buckets: WeekBucket[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [showTable, setShowTable] = useState(false);
  const width = 640;
  const height = 200;
  const pad = { top: 10, right: 8, bottom: 24, left: 28 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...buckets.flatMap((b) => [b.created, b.completed]));
  const ticks = max <= 4 ? max : 4;
  const groupW = plotW / buckets.length;
  const barW = Math.min(18, (groupW - 14) / 2);

  return (
    <div>
      <div className="row" style={{ marginBottom: 8, gap: 14 }}>
        {Object.values(SERIES).map((s) => (
          <span
            key={s.label}
            className="row"
            style={{ gap: 6, fontSize: 12, color: 'var(--text-2)' }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 3,
                background: s.color,
                display: 'inline-block',
              }}
            />
            {s.label}
          </span>
        ))}
        <span className="grow" />
        <button className="btn ghost" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Chart' : 'Table'}
        </button>
      </div>
      {showTable ? (
        <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-3)', textAlign: 'left' }}>
              <th style={{ padding: '4px 8px' }}>Week of</th>
              <th style={{ padding: '4px 8px' }}>Created</th>
              <th style={{ padding: '4px 8px' }}>Completed</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.label} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 8px' }}>{b.label}</td>
                <td style={{ padding: '4px 8px' }}>{b.created}</td>
                <td style={{ padding: '4px 8px' }}>{b.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: '100%', maxWidth: width, display: 'block' }}
            role="img"
            aria-label="Issues created and completed per week"
          >
            {Array.from({ length: ticks + 1 }, (_, i) => {
              const value = Math.round((max / ticks) * i);
              const y = pad.top + plotH - (value / max) * plotH;
              return (
                <g key={i}>
                  <line
                    x1={pad.left}
                    x2={width - pad.right}
                    y1={y}
                    y2={y}
                    stroke="var(--border)"
                    strokeWidth="1"
                  />
                  <text
                    x={pad.left - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="10"
                    fill="var(--text-4)"
                  >
                    {value}
                  </text>
                </g>
              );
            })}
            {buckets.map((b, i) => {
              const gx = pad.left + i * groupW + groupW / 2;
              const bars = [
                { key: 'created' as const, value: b.created, offset: -barW - 1 },
                { key: 'completed' as const, value: b.completed, offset: 1 },
              ];
              return (
                <g key={b.label}>
                  {bars.map((bar) => {
                    const h = (bar.value / max) * plotH;
                    const y = pad.top + plotH - h;
                    return (
                      <rect
                        key={bar.key}
                        x={gx + bar.offset}
                        y={y}
                        width={barW}
                        height={Math.max(h, bar.value > 0 ? 2 : 0)}
                        rx={h > 4 ? 3 : 0}
                        fill={SERIES[bar.key].color}
                        onMouseEnter={(e) => {
                          const rect = (e.target as SVGRectElement).getBoundingClientRect();
                          setTip({
                            x: rect.left + rect.width / 2,
                            y: rect.top - 8,
                            text: `${SERIES[bar.key].label} · week of ${b.label}: ${bar.value}`,
                          });
                        }}
                        onMouseLeave={() => setTip(null)}
                      />
                    );
                  })}
                  <text
                    x={gx}
                    y={height - 8}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--text-3)"
                  >
                    {b.label}
                  </text>
                </g>
              );
            })}
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={pad.top + plotH}
              y2={pad.top + plotH}
              stroke="var(--border-strong)"
              strokeWidth="1"
            />
          </svg>
          {tip && (
            <div
              className="tooltip"
              style={{ left: tip.x, top: tip.y, transform: 'translate(-50%, -100%)' }}
            >
              {tip.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Horizontal distribution bars; identity carried by icon + text, not color alone. */
export function DistributionBars({
  rows,
}: {
  rows: Array<{ key: string; label: string; icon: React.ReactNode; count: number; color: string }>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return <div className="muted">No data yet.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row) => (
        <div key={row.key} className="row" style={{ gap: 8 }}>
          <span
            className="row"
            style={{ width: 130, gap: 6, fontSize: 12.5, color: 'var(--text-2)' }}
          >
            {row.icon}
            <span className="truncate">{row.label}</span>
          </span>
          <div style={{ flex: 1, height: 14, position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                inset: '2px 0',
                width: `${(row.count / max) * 100}%`,
                minWidth: row.count > 0 ? 3 : 0,
                borderRadius: 3,
                background: row.color,
              }}
            />
          </div>
          <span
            style={{
              width: 32,
              textAlign: 'right',
              fontSize: 12,
              color: 'var(--text-2)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {row.count}
          </span>
        </div>
      ))}
    </div>
  );
}

const STAT_LABELS: Record<StatMetric, string> = {
  open: 'Open issues',
  started: 'In progress',
  completed14: 'Completed',
  overdue: 'Overdue',
  created14: 'Created',
};

/** A default heading for a tile, given its type and scope. */
export function defaultTileTitle(tile: DashboardTile, teamName?: string): string {
  const scope = teamName ? ` · ${teamName}` : '';
  switch (tile.type) {
    case 'stat':
      return STAT_LABELS[tile.config.metric ?? 'open'] + scope;
    case 'throughput':
      return 'Throughput' + scope;
    case 'velocity':
      return 'Velocity' + scope;
    case 'burnup':
      return 'Current cycle burn-up' + scope;
    case 'by-state':
      return 'Issues by status' + scope;
    case 'by-priority':
      return 'Issues by priority' + scope;
    case 'by-assignee':
      return 'Issues by assignee' + scope;
    case 'project-health':
      return 'Project health';
  }
}

/** Renders one dashboard tile, computing its data from the store per config. */
export function DashboardTileView({ tile }: { tile: DashboardTile }) {
  const issuesMap = useStore((s) => s.issues);
  const statesMap = useStore((s) => s.workflowStates);
  const usersMap = useStore((s) => s.users);
  const teamsMap = useStore((s) => s.teams);
  const projectsMap = useStore((s) => s.projects);
  const cyclesMap = useStore((s) => s.cycles);

  const teamId = tile.config.teamId ?? null;
  const team = teamId ? teamsMap[teamId] : undefined;

  const scoped = useMemo(
    () => Object.values(issuesMap).filter((i) => !i.archivedAt && (!teamId || i.teamId === teamId)),
    [issuesMap, teamId],
  );

  const body = (() => {
    switch (tile.type) {
      case 'stat': {
        const value = statValue(tile.config.metric ?? 'open', scoped, statesMap);
        return (
          <div style={{ fontSize: 30, fontWeight: 660, fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </div>
        );
      }
      case 'throughput':
        return <ThroughputChart buckets={weeklyBuckets(scoped)} />;
      case 'velocity':
        return teamId ? (
          <VelocityChart teamId={teamId} />
        ) : (
          <div className="muted">Pick a team for this tile.</div>
        );
      case 'burnup': {
        const cycle = latestCycle(Object.values(cyclesMap), teamId);
        return cycle ? (
          <BurnupChart cycleId={cycle.id} />
        ) : (
          <div className="muted">No cycle to burn down.</div>
        );
      }
      case 'by-state': {
        const states: WorkflowState[] = team ? sortedStates(Object.values(statesMap), team.id) : [];
        return (
          <DistributionBars
            rows={states.map((s) => ({
              key: s.id,
              label: s.name,
              icon: <StateIcon category={s.category} color={s.color} size={13} />,
              count: scoped.filter((i) => i.stateId === s.id).length,
              color: s.color,
            }))}
          />
        );
      }
      case 'by-priority':
        return (
          <DistributionBars
            rows={([1, 2, 3, 4, 0] as Priority[]).map((p) => ({
              key: String(p),
              label: PRIORITY_LABELS[p],
              icon: <PriorityIcon priority={p} size={13} />,
              count: scoped.filter((i) => i.priority === p).length,
              color: '#5e6ad2',
            }))}
          />
        );
      case 'by-assignee': {
        const counts = new Map<string, number>();
        for (const i of scoped)
          counts.set(i.assigneeId ?? '__none', (counts.get(i.assigneeId ?? '__none') ?? 0) + 1);
        const rows = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([id, count]) => ({
            key: id,
            label:
              id === '__none' ? 'Unassigned' : usersMap[id] ? personName(usersMap[id]!) : 'Unknown',
            icon: <span style={{ width: 13 }} />,
            count,
            color: '#26b5ce',
          }));
        return <DistributionBars rows={rows} />;
      }
      case 'project-health': {
        const projects = Object.values(projectsMap)
          .filter((p) => !p.completedAt && !p.canceledAt && (!teamId || p.teamIds.includes(teamId)))
          .slice(0, 12);
        if (projects.length === 0) return <div className="muted">No active projects.</div>;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {projects.map((p) => (
              <div key={p.id} className="row" style={{ gap: 8, fontSize: 12.5 }}>
                <ProjectStatusIcon status={p.status} size={13} />
                <span className="truncate grow">{p.name}</span>
              </div>
            ))}
          </div>
        );
      }
    }
  })();

  return <>{body}</>;
}

function statValue(
  metric: StatMetric,
  issues: Issue[],
  states: Record<string, WorkflowState>,
): number {
  const cat = (c: WorkflowState['category']) =>
    issues.filter((i) => states[i.stateId]?.category === c).length;
  const now = new Date().toISOString();
  switch (metric) {
    case 'open':
      return issues.length - cat('completed') - cat('canceled');
    case 'started':
      return cat('started');
    case 'completed14':
      return issues.filter(
        (i) => i.completedAt && new Date(i.completedAt).getTime() > Date.now() - 14 * 86400000,
      ).length;
    case 'created14':
      return issues.filter((i) => new Date(i.createdAt).getTime() > Date.now() - 14 * 86400000)
        .length;
    case 'overdue':
      return issues.filter((i) => i.dueDate && i.dueDate < now && !i.completedAt && !i.canceledAt)
        .length;
  }
}

function latestCycle<T extends { teamId: string; startsAt: string }>(
  cycles: T[],
  teamId: string | null,
): T | null {
  const pool = cycles.filter((c) => !teamId || c.teamId === teamId);
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => (a.startsAt > b.startsAt ? a : b));
}
