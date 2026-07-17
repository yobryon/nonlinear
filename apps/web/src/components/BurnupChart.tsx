import { useMemo, useState } from 'react';
import { useStore } from '../store.js';

/** Series colors validated (light+dark) with the dataviz palette checker. */
const SERIES = {
  scope: { label: 'Scope', color: '#5e6ad2' },
  completed: { label: 'Completed', color: '#2f9e68' },
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface DayPoint {
  ts: number;
  scope: number;
  completed: number;
}

/** Cumulative scope vs completed issue counts for a cycle, day by day. */
export function BurnupChart({ cycleId }: { cycleId: string }) {
  const cycle = useStore((s) => s.cycles[cycleId]);
  const issues = useStore((s) => s.issues);
  const [hover, setHover] = useState<{
    index: number;
    day: DayPoint;
    x: number;
    y: number;
  } | null>(null);
  const [showTable, setShowTable] = useState(false);

  const days = useMemo<DayPoint[]>(() => {
    if (!cycle) return [];
    const first = startOfDay(new Date(cycle.startsAt).getTime());
    const last = Math.min(startOfDay(new Date(cycle.endsAt).getTime()), startOfDay(Date.now()));
    if (last < first) return [];
    const rows = Object.values(issues).filter((i) => i.cycleId === cycle.id && !i.archivedAt);
    const out: DayPoint[] = [];
    for (let ts = first; ts <= last; ts += DAY_MS) {
      const dayEnd = ts + DAY_MS;
      out.push({
        ts,
        scope: rows.filter((i) => new Date(i.createdAt).getTime() < dayEnd).length,
        completed: rows.filter((i) => i.completedAt && new Date(i.completedAt).getTime() < dayEnd)
          .length,
      });
    }
    return out;
  }, [cycle, issues]);

  if (!cycle) return null;
  if (days.length === 0) {
    return <div className="muted">Burnup appears once the cycle starts.</div>;
  }

  const width = 640;
  const height = 200;
  const pad = { top: 10, right: 8, bottom: 24, left: 28 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...days.map((d) => d.scope));
  const ticks = max <= 4 ? max : 4;
  const xStep = days.length > 1 ? plotW / (days.length - 1) : 0;
  const xFor = (i: number) => pad.left + (days.length > 1 ? i * xStep : plotW / 2);
  const yFor = (v: number) => pad.top + plotH - (v / max) * plotH;
  const tickEvery = Math.max(1, Math.ceil(days.length / 8));

  const lastDay = days[days.length - 1] as DayPoint;
  const linePath = (get: (d: DayPoint) => number) =>
    days.map((d, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(get(d))}`).join(' ');
  const areaPath = (get: (d: DayPoint) => number) =>
    `M${xFor(0)},${pad.top + plotH} ` +
    days.map((d, i) => `L${xFor(i)},${yFor(get(d))}`).join(' ') +
    ` L${xFor(days.length - 1)},${pad.top + plotH} Z`;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = rect.width / width;
    const xIn = (e.clientX - rect.left) / scale;
    const index =
      days.length > 1
        ? Math.round((xIn - pad.left) / xStep)
        : Math.abs(xIn - xFor(0)) < 40
          ? 0
          : -1;
    const day = days[index];
    if (!day) {
      setHover(null);
      return;
    }
    setHover({
      index,
      day,
      x: rect.left + xFor(index) * scale,
      y: rect.top + yFor(day.scope) * scale - 8,
    });
  };

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
              <th style={{ padding: '4px 8px' }}>Day</th>
              <th style={{ padding: '4px 8px' }}>Scope</th>
              <th style={{ padding: '4px 8px' }}>Completed</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.ts} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 8px' }}>{dayLabel(d.ts)}</td>
                <td style={{ padding: '4px 8px' }}>{d.scope}</td>
                <td style={{ padding: '4px 8px' }}>{d.completed}</td>
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
            aria-label="Cycle burnup: scope and completed issues per day"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            {Array.from({ length: ticks + 1 }, (_, i) => {
              const value = Math.round((max / ticks) * i);
              const y = yFor(value);
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
            {days.map((d, i) =>
              i % tickEvery === 0 ? (
                <text
                  key={d.ts}
                  x={xFor(i)}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text-3)"
                >
                  {dayLabel(d.ts)}
                </text>
              ) : null,
            )}
            <path d={areaPath((d) => d.scope)} fill={SERIES.scope.color} fillOpacity="0.08" />
            <path
              d={areaPath((d) => d.completed)}
              fill={SERIES.completed.color}
              fillOpacity="0.08"
            />
            <path
              d={linePath((d) => d.scope)}
              fill="none"
              stroke={SERIES.scope.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={linePath((d) => d.completed)}
              fill="none"
              stroke={SERIES.completed.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={xFor(days.length - 1)}
              cy={yFor(lastDay.scope)}
              r="3"
              fill={SERIES.scope.color}
            />
            <circle
              cx={xFor(days.length - 1)}
              cy={yFor(lastDay.completed)}
              r="3"
              fill={SERIES.completed.color}
            />
            {hover && (
              <g>
                <line
                  x1={xFor(hover.index)}
                  x2={xFor(hover.index)}
                  y1={pad.top}
                  y2={pad.top + plotH}
                  stroke="var(--border-strong)"
                  strokeWidth="1"
                />
                <circle
                  cx={xFor(hover.index)}
                  cy={yFor(hover.day.scope)}
                  r="3.5"
                  fill={SERIES.scope.color}
                  stroke="var(--bg-surface)"
                  strokeWidth="1.5"
                />
                <circle
                  cx={xFor(hover.index)}
                  cy={yFor(hover.day.completed)}
                  r="3.5"
                  fill={SERIES.completed.color}
                  stroke="var(--bg-surface)"
                  strokeWidth="1.5"
                />
              </g>
            )}
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={pad.top + plotH}
              y2={pad.top + plotH}
              stroke="var(--border-strong)"
              strokeWidth="1"
            />
          </svg>
          {hover && (
            <div
              className="tooltip"
              style={{ left: hover.x, top: hover.y, transform: 'translate(-50%, -100%)' }}
            >
              {dayLabel(hover.day.ts)} · Scope {hover.day.scope} · Completed {hover.day.completed}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
