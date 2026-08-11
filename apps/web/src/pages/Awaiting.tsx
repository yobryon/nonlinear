import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { relativeTime, useStore } from '../store.js';
import { toastError } from '../ui.js';
import { BookIcon, ClockIcon } from '../icons.js';
import { GroupedIssueList, useGroupedIssues } from '../issueViews.js';
import { OriginProvider, originState } from '../nav.js';

/**
 * "Awaiting me" — the decider's single surface. Everything that waits on the
 * viewer and nothing else: proposed decisions to rule (the tracker holds the
 * queue, answered inline) and issues explicitly waiting on them.
 */
export function AwaitingPage() {
  const decisions = useStore((s) => s.decisions);
  const issues = useStore((s) => s.issues);
  const teams = useStore((s) => s.teams);
  const userId = useStore((s) => s.userId);
  const navigate = useNavigate();

  // Decisions are member-only, so the store already holds only my teams' — every
  // proposed one is a ruling awaiting a decider.
  const proposals = useMemo(
    () =>
      Object.values(decisions)
        .filter((d) => d.status === 'proposed')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [decisions],
  );

  const waitingIssues = useMemo(
    () => Object.values(issues).filter((i) => i.waitingOnId === userId && !i.archivedAt),
    [issues, userId],
  );
  const grouped = useGroupedIssues(waitingIssues, 'state');

  const rule = (id: string) => {
    void api
      .ruleDecision(id)
      .then((d) => useStore.getState().putEntity('decision', d))
      .catch(toastError);
  };

  const empty = proposals.length === 0 && waitingIssues.length === 0;

  return (
    <>
      <div className="topbar">
        <div className="title">
          <ClockIcon size={16} />
          Awaiting me
        </div>
      </div>
      <div className="content">
        {empty && (
          <div className="empty-state">
            <ClockIcon size={26} style={{ color: 'var(--text-4)' }} />
            <h3>Nothing is waiting on you</h3>
            <p>Proposed decisions to rule and issues explicitly waiting on you land here.</p>
          </div>
        )}

        {proposals.length > 0 && (
          <div style={{ padding: '10px 0' }}>
            <div className="group-header">
              <BookIcon size={14} />
              <span>Decisions to rule</span>
              <span className="dim">{proposals.length}</span>
            </div>
            {proposals.map((d) => {
              const team = teams[d.teamId];
              return (
                <div
                  key={d.id}
                  className="issue-row"
                  onClick={() =>
                    navigate(`/decision/${d.id}`, {
                      state: originState({ label: 'Awaiting me', to: '/awaiting' }),
                    })
                  }
                >
                  <span className="identifier dim">
                    {team?.key}-D{d.number}
                  </span>
                  <span className="title" style={{ fontWeight: 500 }}>
                    {d.title}
                  </span>
                  <span className="dim">proposed {relativeTime(d.createdAt)} ago</span>
                  <button
                    className="btn primary sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      rule(d.id);
                    }}
                  >
                    Rule
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {waitingIssues.length > 0 && (
          <div style={{ padding: '10px 0' }}>
            <div className="group-header">
              <ClockIcon size={14} />
              <span>Issues waiting on you</span>
              <span className="dim">{waitingIssues.length}</span>
            </div>
            <OriginProvider value={{ label: 'Awaiting me', to: '/awaiting' }}>
              <GroupedIssueList groups={grouped} grouping="state" />
            </OriginProvider>
          </div>
        )}
      </div>
    </>
  );
}
