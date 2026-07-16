import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Issue, WorkflowState } from '@nonlinear/shared';
import { PRIORITY_LABELS, type Priority } from '@nonlinear/shared';
import { sortedStates, useStore } from '../store.js';
import { PriorityIcon, StateIcon } from '../icons.js';

/** Series colors validated (light+dark) with the dataviz palette checker. */
const SERIES = {
  created: { label: 'Created', color: '#5e6ad2' },
  completed: { label: 'Completed', color: '#2f9e68' },
} as const;

const WEEKS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startOfWeek(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday start
  return d.getTime() - day * 24 * 60 * 60 * 1000;
}

interface WeekBucket {
  label: string;
  created: number;
  completed: number;
}

function weeklyBuckets(issues: Issue[]): WeekBucket[] {
  const thisWeek = startOfWeek(Date.now());
  const buckets: WeekBucket[] = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = thisWeek - i * WEEK_MS;
    const end = start + WEEK_MS;
    const label = new Date(start).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
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

function StatTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
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
function ThroughputChart({ buckets }: { buckets: WeekBucket[] }) {
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

/** Horizontal distribution bars; identity carried by icon + text label, not color alone. */
function DistributionBars({
  rows,
}: {
  rows: Array<{ key: string; label: string; icon: React.ReactNode; count: number; color: string }>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '16px 18px',
        background: 'var(--bg-surface)',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

export function InsightsPage() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const teams = useStore((s) => s.teams);
  const issues = useStore((s) => s.issues);
  const states = useStore((s) => s.workflowStates);

  const team = Object.values(teams).find((t) => t.key === teamKey);

  const teamIssues = useMemo(
    () => (team ? Object.values(issues).filter((i) => i.teamId === team.id && !i.archivedAt) : []),
    [issues, team],
  );
  const buckets = useMemo(() => weeklyBuckets(teamIssues), [teamIssues]);
  const teamStates: WorkflowState[] = team ? sortedStates(Object.values(states), team.id) : [];

  if (!team) {
    return (
      <div className="empty-state">
        <h3>Team not found</h3>
      </div>
    );
  }

  const byCat = (category: WorkflowState['category']) =>
    teamIssues.filter((i) => states[i.stateId]?.category === category).length;
  const open = teamIssues.length - byCat('completed') - byCat('canceled');
  const nowIso = new Date().toISOString();
  const overdue = teamIssues.filter(
    (i) => i.dueDate && i.dueDate < nowIso && !i.completedAt && !i.canceledAt,
  ).length;
  const completed14 = teamIssues.filter(
    (i) => i.completedAt && new Date(i.completedAt).getTime() > Date.now() - 14 * 86400000,
  ).length;

  const stateRows = teamStates.map((s) => ({
    key: s.id,
    label: s.name,
    icon: <StateIcon category={s.category} color={s.color} size={13} />,
    count: teamIssues.filter((i) => i.stateId === s.id).length,
    color: s.color,
  }));
  const priorityRows = ([1, 2, 3, 4, 0] as Priority[]).map((p) => ({
    key: String(p),
    label: PRIORITY_LABELS[p],
    icon: <PriorityIcon priority={p} size={13} />,
    count: teamIssues.filter((i) => i.priority === p).length,
    color: '#5e6ad2',
  }));

  return (
    <>
      <div className="topbar">
        <div className="title">
          <span className="team-icon" style={{ background: team.color }}>
            {team.key.slice(0, 2)}
          </span>
          {team.name}
          <span className="crumb">›</span>
          <span className="crumb">Insights</span>
        </div>
        <span className="spacer" />
      </div>
      <div className="content" style={{ padding: '18px 20px 60px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <StatTile label="Open issues" value={open} />
          <StatTile label="In progress" value={byCat('started')} />
          <StatTile label="Completed" value={completed14} hint="last 14 days" />
          <StatTile label="Overdue" value={overdue} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
          <Section title={`Throughput — last ${WEEKS} weeks`}>
            <ThroughputChart buckets={buckets} />
          </Section>
          <Section title="Issues by status">
            <DistributionBars rows={stateRows} />
          </Section>
          <Section title="Issues by priority">
            <DistributionBars rows={priorityRows} />
          </Section>
        </div>
      </div>
    </>
  );
}
