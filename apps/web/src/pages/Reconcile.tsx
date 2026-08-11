import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { relativeTime, useStore } from '../store.js';
import { StateIcon } from '../icons.js';
import { Avatar } from '../ui.js';
import { originState } from '../nav.js';

const STALE_DAYS = 5;

/**
 * Reconcile — a pull diagnostic (never an alarm). Open issues ranked by
 * staleness against activity (last change, last comment), so truth-checking a
 * board is nearly free. The instrument Plumb tells every project to author,
 * pre-built.
 */
export function ReconcilePage() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const teams = useStore((s) => s.teams);
  const issues = useStore((s) => s.issues);
  const comments = useStore((s) => s.comments);
  const states = useStore((s) => s.workflowStates);
  const users = useStore((s) => s.users);
  const navigate = useNavigate();

  const team = teamKey ? Object.values(teams).find((t) => t.key === teamKey) : null;

  const { ranked, open, untouched, waitingNobody } = useMemo(() => {
    const now = Date.now();
    const lastCommentAt = new Map<string, number>();
    for (const c of Object.values(comments)) {
      const t = Date.parse(c.createdAt);
      lastCommentAt.set(c.issueId, Math.max(lastCommentAt.get(c.issueId) ?? 0, t));
    }
    const openIssues = Object.values(issues).filter((i) => {
      if (!team || i.teamId !== team.id || i.archivedAt) return false;
      const cat = states[i.stateId]?.category;
      return cat !== 'completed' && cat !== 'canceled';
    });
    const activityAt = (id: string, updatedAt: string) =>
      Math.max(Date.parse(updatedAt), lastCommentAt.get(id) ?? 0);
    const ranked = openIssues
      .map((i) => ({ issue: i, at: activityAt(i.id, i.updatedAt) }))
      .sort((a, b) => a.at - b.at);
    const threshold = STALE_DAYS * 86400000;
    return {
      ranked,
      open: openIssues.length,
      untouched: ranked.filter((r) => now - r.at > threshold).length,
      waitingNobody: openIssues.filter(
        (i) => !i.waitingOnId && states[i.stateId]?.category === 'started',
      ).length,
    };
  }, [issues, comments, states, team]);

  if (!team)
    return (
      <div className="empty-state">
        <h3>Team not found</h3>
      </div>
    );

  return (
    <>
      <div className="topbar">
        <div className="title">
          <span className="team-icon" style={{ background: team.color }}>
            {team.key.slice(0, 2)}
          </span>
          {team.name}
          <span className="crumb">›</span>
          <span className="crumb">Reconcile</span>
        </div>
        <span className="spacer" />
        <span className="dim">
          {open} open · {untouched} untouched {STALE_DAYS}+ days · {waitingNobody} waiting on nobody
        </span>
      </div>
      <div className="content">
        {ranked.length === 0 && (
          <div className="empty-state">
            <h3>Nothing open</h3>
            <p>
              Open issues appear here, stalest first — a lens you open, not a nag that pings you.
            </p>
          </div>
        )}
        {ranked.map(({ issue, at }) => {
          const state = states[issue.stateId];
          const waitingOn = issue.waitingOnId ? users[issue.waitingOnId] : null;
          const stale = Date.now() - at > STALE_DAYS * 86400000;
          return (
            <div
              key={issue.id}
              className="issue-row"
              onClick={() =>
                navigate(`/issue/${team.key}-${issue.number}`, {
                  state: originState({
                    label: `${team.name} · Reconcile`,
                    to: `/team/${team.key}/reconcile`,
                  }),
                })
              }
            >
              <span className="identifier dim">
                {team.key}-{issue.number}
              </span>
              {state && <StateIcon category={state.category} color={state.color} />}
              <span className="title" style={{ fontWeight: 500 }}>
                {issue.title}
              </span>
              {waitingOn && (
                <span className="dim row" style={{ gap: 4 }}>
                  <Avatar user={waitingOn} size={14} /> {waitingOn.name}
                </span>
              )}
              <span className="dim" style={{ color: stale ? 'var(--warning)' : undefined }}>
                {relativeTime(new Date(at).toISOString())} ago
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
