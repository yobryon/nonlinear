import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Initiative, Project, ProjectHealth, ProjectStatus } from '@nonlinear/shared';
import { formatDate, useStore } from '../store.js';
import { ProjectIcon } from '../icons.js';

/* ---------- layout constants ---------- */

const LEFT_W = 220;
const HEADER_H = 28;
const INITIATIVE_ROW_H = 32;
const PROJECT_ROW_H = 28;
const BAR_H = 18;
const PX_PER_DAY = 3;
const DAY_MS = 86_400_000;
const FALLBACK_SPAN_MS = 14 * DAY_MS;

const STATUS_LABELS: Record<ProjectStatus, string> = {
  backlog: 'Backlog',
  planned: 'Planned',
  started: 'In progress',
  paused: 'Paused',
  completed: 'Completed',
  canceled: 'Canceled',
};

const HEALTH_COLORS: Record<ProjectHealth, string> = {
  on_track: 'var(--success)',
  at_risk: 'var(--warning)',
  off_track: 'var(--danger)',
};

const HEALTH_LABELS: Record<ProjectHealth, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/* ---------- date helpers ---------- */

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function projectStartMs(p: Project): number {
  return new Date(p.startDate ?? p.createdAt).getTime();
}

function projectEndMs(p: Project): number {
  return p.targetDate ? new Date(p.targetDate).getTime() : projectStartMs(p) + FALLBACK_SPAN_MS;
}

/** Legible label color for text sitting on a hex-colored bar. */
function barTextColor(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return '#fff';
  const v = parseInt(m[1], 16);
  const yiq = (((v >> 16) & 0xff) * 299 + ((v >> 8) & 0xff) * 587 + (v & 0xff) * 114) / 1000;
  return yiq >= 150 ? '#1c1d21' : '#fff';
}

function InitiativeGlyph({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden style={{ flexShrink: 0 }}>
      <rect
        x="1"
        y="1"
        width="12"
        height="12"
        rx="3.5"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
      />
      <circle cx="7" cy="7" r="2.2" fill={color} />
    </svg>
  );
}

/* ---------- page ---------- */

interface TimelineGroup {
  initiative: Initiative | null;
  projects: Project[];
}

interface TooltipState {
  x: number;
  y: number;
  node: ReactNode;
}

export function TimelinePage() {
  const projects = useStore((s) => s.projects);
  const initiatives = useStore((s) => s.initiatives);
  const projectUpdates = useStore((s) => s.projectUpdates);
  const navigate = useNavigate();
  const [tip, setTip] = useState<TooltipState | null>(null);

  const groups = useMemo<TimelineGroup[]>(() => {
    const all = Object.values(projects);
    const byStart = (a: Project, b: Project) => projectStartMs(a) - projectStartMs(b);
    const sortedInitiatives = Object.values(initiatives).sort((a, b) =>
      a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0,
    );
    const out: TimelineGroup[] = [];
    for (const initiative of sortedInitiatives) {
      const rows = all.filter((p) => p.initiativeId === initiative.id).sort(byStart);
      if (rows.length > 0) out.push({ initiative, projects: rows });
    }
    const orphans = all
      .filter((p) => !p.initiativeId || !initiatives[p.initiativeId])
      .sort(byStart);
    if (orphans.length > 0) out.push({ initiative: null, projects: orphans });
    return out;
  }, [projects, initiatives]);

  /** projectId -> health of its latest update. */
  const latestHealth = useMemo(() => {
    const health: Record<string, ProjectHealth> = {};
    const seenAt: Record<string, string> = {};
    for (const u of Object.values(projectUpdates)) {
      const prev = seenAt[u.projectId];
      if (!prev || u.createdAt > prev) {
        seenAt[u.projectId] = u.createdAt;
        health[u.projectId] = u.health;
      }
    }
    return health;
  }, [projectUpdates]);

  const allProjects = useMemo(() => groups.flatMap((g) => g.projects), [groups]);

  /* time domain: 1 month before earliest start -> 1 month after latest target */
  const { domainStart, months, width } = useMemo(() => {
    const now = Date.now();
    let earliest = now;
    let latest = 0;
    for (const p of allProjects) {
      earliest = Math.min(earliest, projectStartMs(p));
      if (p.targetDate) latest = Math.max(latest, new Date(p.targetDate).getTime());
    }
    if (latest === 0) latest = addMonths(new Date(now), 3).getTime();
    latest = Math.max(latest, earliest);
    const start = startOfMonth(addMonths(new Date(earliest), -1));
    // First month boundary strictly after (latest + 1 month) so the whole month fits.
    const end = addMonths(startOfMonth(new Date(addMonths(new Date(latest), 1).getTime())), 1);
    const ticks: Date[] = [];
    for (let m = start; m < end; m = addMonths(m, 1)) ticks.push(m);
    return {
      domainStart: start,
      months: ticks,
      width: Math.ceil(((end.getTime() - start.getTime()) / DAY_MS) * PX_PER_DAY),
    };
  }, [allProjects]);

  const xFor = (ms: number) => ((ms - domainStart.getTime()) / DAY_MS) * PX_PER_DAY;

  /* row layout shared by the left column and the SVG */
  const { rowTops, totalHeight } = useMemo(() => {
    const tops = new Map<string, number>();
    let y = 0;
    for (const g of groups) {
      tops.set(g.initiative ? `i:${g.initiative.id}` : 'i:none', y);
      y += INITIATIVE_ROW_H;
      for (const p of g.projects) {
        tops.set(`p:${p.id}`, y);
        y += PROJECT_ROW_H;
      }
    }
    return { rowTops: tops, totalHeight: y };
  }, [groups]);

  const todayX = xFor(Date.now());

  const showTip = (e: React.MouseEvent, node: ReactNode) =>
    setTip({ x: e.clientX + 12, y: e.clientY + 14, node });

  if (allProjects.length === 0) {
    return (
      <>
        <div className="topbar">
          <div className="title">
            <ProjectIcon size={15} style={{ color: 'var(--text-3)' }} />
            Timeline
          </div>
          <span className="spacer" />
        </div>
        <div className="content">
          <div className="empty-state">
            <ProjectIcon size={26} style={{ color: 'var(--text-4)' }} />
            <h3>No projects to plot</h3>
            <p>Create a project with a start and target date to see it on the timeline.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="title">
          <ProjectIcon size={15} style={{ color: 'var(--text-3)' }} />
          Timeline
          <span className="muted" style={{ fontWeight: 400 }}>
            {allProjects.length} project{allProjects.length === 1 ? '' : 's'}
          </span>
        </div>
        <span className="spacer" />
      </div>
      <div className="content" style={{ overflow: 'auto' }}>
        <div style={{ width: LEFT_W + width, minWidth: '100%' }}>
          {/* month label header (sticky top) */}
          <div
            style={{
              display: 'flex',
              position: 'sticky',
              top: 0,
              zIndex: 4,
              background: 'var(--bg-app)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                width: LEFT_W,
                height: HEADER_H,
                flexShrink: 0,
                position: 'sticky',
                left: 0,
                zIndex: 5,
                background: 'var(--bg-app)',
                borderRight: '1px solid var(--border)',
              }}
            />
            <div style={{ position: 'relative', width, height: HEADER_H, flexShrink: 0 }}>
              {months.map((m, i) => (
                <span
                  key={m.getTime()}
                  className="dim"
                  style={{
                    position: 'absolute',
                    left: xFor(m.getTime()) + 6,
                    top: 5,
                    fontSize: 11,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.toLocaleDateString(undefined, { month: 'short' })}
                  {(i === 0 || m.getMonth() === 0) && (
                    <span style={{ marginLeft: 4 }}>{m.getFullYear()}</span>
                  )}
                </span>
              ))}
            </div>
          </div>

          {/* body */}
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {/* left fixed column */}
            <div
              style={{
                width: LEFT_W,
                flexShrink: 0,
                position: 'sticky',
                left: 0,
                zIndex: 3,
                background: 'var(--bg-app)',
                borderRight: '1px solid var(--border)',
              }}
            >
              {groups.map((g) => (
                <div key={g.initiative?.id ?? 'none'}>
                  <div
                    className="row"
                    style={{
                      height: INITIATIVE_ROW_H,
                      gap: 6,
                      padding: '0 10px 0 12px',
                      fontWeight: 600,
                      fontSize: 12.5,
                      background: 'var(--bg-surface)',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <InitiativeGlyph color={g.initiative ? g.initiative.color : 'var(--text-4)'} />
                    <span className={`truncate${g.initiative ? '' : ' muted'}`}>
                      {g.initiative ? g.initiative.name : 'No initiative'}
                    </span>
                  </div>
                  {g.projects.map((p) => (
                    <button
                      key={p.id}
                      className="side-item"
                      style={{ height: PROJECT_ROW_H, paddingLeft: 24, borderRadius: 0 }}
                      onClick={() => navigate(`/project/${p.id}`)}
                      title={p.name}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: p.color,
                          flexShrink: 0,
                        }}
                      />
                      <span className="grow">{p.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* gantt SVG */}
            <svg
              width={width}
              height={totalHeight}
              style={{ display: 'block', flexShrink: 0 }}
              aria-label="Project timeline"
            >
              {/* initiative header bands */}
              {groups.map((g) => {
                const key = g.initiative ? `i:${g.initiative.id}` : 'i:none';
                const y = rowTops.get(key) ?? 0;
                return (
                  <g key={key}>
                    <rect
                      x={0}
                      y={y}
                      width={width}
                      height={INITIATIVE_ROW_H}
                      fill="var(--bg-surface)"
                    />
                    <line
                      x1={0}
                      x2={width}
                      y1={y + INITIATIVE_ROW_H - 0.5}
                      y2={y + INITIATIVE_ROW_H - 0.5}
                      stroke="var(--border)"
                    />
                  </g>
                );
              })}

              {/* month separators */}
              {months.slice(1).map((m) => {
                const x = Math.round(xFor(m.getTime())) + 0.5;
                return (
                  <line
                    key={m.getTime()}
                    x1={x}
                    x2={x}
                    y1={0}
                    y2={totalHeight}
                    stroke="var(--border)"
                  />
                );
              })}

              {/* today */}
              {todayX >= 0 && todayX <= width && (
                <line
                  x1={todayX}
                  x2={todayX}
                  y1={0}
                  y2={totalHeight}
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                />
              )}

              {/* bars */}
              {allProjects.map((p) => {
                const rowTop = rowTops.get(`p:${p.id}`);
                if (rowTop === undefined) return null;
                const startMs = projectStartMs(p);
                const x = xFor(startMs);
                const w = Math.max(xFor(projectEndMs(p)) - x, 8);
                const y = rowTop + (PROJECT_ROW_H - BAR_H) / 2;
                const dashed = !p.targetDate;
                const health = latestHealth[p.id];
                const labelStart = health ? 16 : 8;
                const maxChars = Math.floor((w - labelStart - 8) / 6.4);
                const label =
                  w >= 64
                    ? p.name.length > maxChars
                      ? `${p.name.slice(0, Math.max(0, maxChars - 1))}…`
                      : p.name
                    : null;
                const tooltip = (
                  <>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div className="muted">
                      {formatDate(p.startDate ?? p.createdAt)} –{' '}
                      {p.targetDate ? formatDate(p.targetDate) : 'no target date'}
                    </div>
                    <div className="muted">
                      {STATUS_LABELS[p.status]}
                      {health ? ` · ${HEALTH_LABELS[health]}` : ''}
                    </div>
                  </>
                );
                return (
                  <g
                    key={p.id}
                    opacity={p.status === 'completed' ? 0.45 : 1}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/project/${p.id}`)}
                    onMouseEnter={(e) => showTip(e, tooltip)}
                    onMouseMove={(e) => showTip(e, tooltip)}
                    onMouseLeave={() => setTip(null)}
                  >
                    {dashed ? (
                      <rect
                        x={x + 0.75}
                        y={y + 0.75}
                        width={w - 1.5}
                        height={BAR_H - 1.5}
                        rx={4}
                        fill="none"
                        stroke={p.color}
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                      />
                    ) : (
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={BAR_H}
                        rx={4}
                        fill={p.color}
                        opacity={0.85}
                      />
                    )}
                    {health && (
                      <circle
                        cx={x + 8}
                        cy={y + BAR_H / 2}
                        r={3}
                        fill={HEALTH_COLORS[health]}
                        stroke={dashed ? 'none' : 'rgba(0,0,0,0.25)'}
                        strokeWidth={0.5}
                      />
                    )}
                    {label && (
                      <text
                        x={x + labelStart}
                        y={y + BAR_H / 2}
                        dominantBaseline="central"
                        fontSize={11}
                        fontWeight={500}
                        fill={dashed ? 'var(--text-2)' : barTextColor(p.color)}
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                      >
                        {label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
      {tip && (
        <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.node}
        </div>
      )}
    </>
  );
}
