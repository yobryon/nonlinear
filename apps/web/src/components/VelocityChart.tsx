import { useMemo, useState } from 'react';
import { useStore } from '../store.js';

/** Series color validated (light+dark) with the dataviz palette checker. */
const SERIES_COLOR = '#5e6ad2';

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
  points: number;
}

/** Estimate points completed per week for the last 8 weeks. Single series. */
export function VelocityChart({ teamId }: { teamId: string }) {
  const issues = useStore((s) => s.issues);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [showTable, setShowTable] = useState(false);

  const buckets = useMemo<WeekBucket[]>(() => {
    const thisWeek = startOfWeek(Date.now());
    const done = Object.values(issues).filter(
      (i) => i.teamId === teamId && !i.archivedAt && i.completedAt,
    );
    const out: WeekBucket[] = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const start = thisWeek - w * WEEK_MS;
      const end = start + WEEK_MS;
      let points = 0;
      for (const issue of done) {
        const t = new Date(issue.completedAt as string).getTime();
        if (t >= start && t < end) points += issue.estimate ?? 1;
      }
      out.push({
        label: new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        points,
      });
    }
    return out;
  }, [issues, teamId]);

  const total = buckets.reduce((sum, b) => sum + b.points, 0);
  const avg = Math.round((total / WEEKS) * 10) / 10;

  const width = 640;
  const height = 200;
  const pad = { top: 10, right: 8, bottom: 24, left: 28 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...buckets.map((b) => b.points));
  const ticks = max <= 4 ? max : 4;
  const groupW = plotW / buckets.length;
  const barW = Math.min(26, groupW - 16);

  return (
    <div>
      <div className="row" style={{ marginBottom: 8, gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Velocity</span>
        <span className="muted">{avg} points/week avg</span>
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
              <th style={{ padding: '4px 8px' }}>Points completed</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.label} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 8px' }}>{b.label}</td>
                <td style={{ padding: '4px 8px' }}>{b.points}</td>
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
            aria-label="Estimate points completed per week"
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
              const h = (b.points / max) * plotH;
              const y = pad.top + plotH - h;
              return (
                <g key={b.label}>
                  <rect
                    x={gx - barW / 2}
                    y={y}
                    width={barW}
                    height={Math.max(h, b.points > 0 ? 2 : 0)}
                    rx={h > 4 ? 3 : 0}
                    fill={SERIES_COLOR}
                    onMouseEnter={(e) => {
                      const rect = (e.target as SVGRectElement).getBoundingClientRect();
                      setTip({
                        x: rect.left + rect.width / 2,
                        y: rect.top - 8,
                        text: `Week of ${b.label}: ${b.points} point${b.points === 1 ? '' : 's'}`,
                      });
                    }}
                    onMouseLeave={() => setTip(null)}
                  />
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
