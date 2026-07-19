import { useEffect, useState } from 'react';
import type { PulseFeed, PulseItem, ProjectHealth } from '@nonlinear/shared';
import { api } from '../api.js';
import { relativeTime, useStore } from '../store.js';
import { personName } from '../preferences.js';
import { SpinnerIcon } from '../icons.js';
import { toastError } from '../ui.js';

const HEALTH_COLOR: Record<ProjectHealth, string> = {
  on_track: '#2f9e68',
  at_risk: '#f2c94c',
  off_track: '#eb5757',
};

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
];

export function PulsePage() {
  const users = useStore((s) => s.users);
  const [days, setDays] = useState(7);
  const [feed, setFeed] = useState<PulseFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiReady, setAiReady] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    setLoading(true);
    setSummary(null);
    void api
      .pulse(days)
      .then(setFeed)
      .catch(toastError)
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => {
    void api
      .aiSettings()
      .then((s) => setAiReady(s.enabled && s.hasKey))
      .catch(() => setAiReady(false));
  }, []);

  const summarize = () => {
    setSummarizing(true);
    void api
      .pulseSummary(days)
      .then((r) => setSummary(r.summary))
      .catch(toastError)
      .finally(() => setSummarizing(false));
  };

  const groups = feed ? groupByDay(feed.items) : [];

  return (
    <>
      <div className="topbar">
        <div className="title">Pulse</div>
        <span className="spacer" />
        <div className="row" style={{ gap: 6 }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              className={`btn ghost${days === r.days ? ' active' : ''}`}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="content" style={{ padding: '18px 20px 60px', maxWidth: 760 }}>
        {aiReady && (
          <div className="pulse-summary">
            {summary ? (
              <p>{summary}</p>
            ) : (
              <button className="btn" onClick={summarize} disabled={summarizing || loading}>
                {summarizing ? (
                  <>
                    <SpinnerIcon size={14} /> Summarizing…
                  </>
                ) : (
                  '✨ Summarize with AI'
                )}
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="muted row" style={{ gap: 8 }}>
            <SpinnerIcon size={16} /> Loading…
          </div>
        ) : groups.length === 0 ? (
          <div className="empty-state">
            <h3>Quiet lately</h3>
            <p>No project updates, completions, or cycle activity in this window.</p>
          </div>
        ) : (
          groups.map(([day, items]) => (
            <div key={day} style={{ marginBottom: 22 }}>
              <div className="pulse-day">{day}</div>
              {items.map((item) => (
                <div key={item.id} className="pulse-item">
                  {item.health ? (
                    <span className="pulse-dot" style={{ background: HEALTH_COLOR[item.health] }} />
                  ) : (
                    <span className="pulse-dot" style={{ background: 'var(--border-strong)' }} />
                  )}
                  <div className="grow">
                    <div className="pulse-title">{item.title}</div>
                    {item.detail && <div className="pulse-detail">{item.detail}</div>}
                  </div>
                  <div className="pulse-meta">
                    {item.actorId && users[item.actorId]
                      ? `${personName(users[item.actorId]!)} · `
                      : ''}
                    {relativeTime(item.at)}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );
}

function groupByDay(items: PulseItem[]): [string, PulseItem[]][] {
  const groups = new Map<string, PulseItem[]>();
  for (const item of items) {
    const day = new Date(item.at).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    (groups.get(day) ?? groups.set(day, []).get(day)!).push(item);
  }
  return [...groups.entries()];
}
