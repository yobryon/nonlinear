import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { issueKey, relativeTime, sortedStates, useStore } from '../store.js';
import { Avatar } from '../ui.js';
import { CheckIcon, CloseIcon, PriorityIcon } from '../icons.js';
import { patchIssue } from '../actions.js';

/**
 * Triage inbox: issues sitting in the team's triage state, with one-click
 * accept (move to the default backlog state) or decline (canceled).
 */
export function TriagePage() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const teams = useStore((s) => s.teams);
  const issues = useStore((s) => s.issues);
  const states = useStore((s) => s.workflowStates);
  const users = useStore((s) => s.users);
  const navigate = useNavigate();

  const team = Object.values(teams).find((t) => t.key === teamKey);
  const teamStates = team ? sortedStates(Object.values(states), team.id) : [];
  const triageState = teamStates.find((s) => s.category === 'triage');
  const acceptState =
    teamStates.find((s) => s.category === 'backlog') ??
    teamStates.find((s) => s.category === 'unstarted');
  const declineState = teamStates.find((s) => s.category === 'canceled');

  const rows = useMemo(() => {
    if (!team || !triageState) return [];
    return Object.values(issues)
      .filter((i) => i.teamId === team.id && i.stateId === triageState.id && !i.archivedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [issues, team, triageState]);

  if (!team) {
    return (
      <div className="empty-state">
        <h3>Team not found</h3>
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="title">
          <span className="team-icon" style={{ background: team.color }}>
            {team.key.slice(0, 2)}
          </span>
          {team.name}
          <span className="crumb">›</span>
          <span className="crumb">Triage</span>
          {rows.length > 0 && <span className="muted">{rows.length} to review</span>}
        </div>
        <span className="spacer" />
      </div>
      <div className="content">
        {rows.length === 0 && (
          <div className="empty-state">
            <CheckIcon size={26} style={{ color: 'var(--success)' }} />
            <h3>Triage clear</h3>
            <p>New issues land here for review while triage is enabled.</p>
          </div>
        )}
        {rows.map((issue) => {
          const creator = users[issue.creatorId];
          return (
            <div
              key={issue.id}
              className="inbox-row unread"
              onClick={() => navigate(`/issue/${issueKey(issue, teams)}`)}
            >
              <PriorityIcon priority={issue.priority} />
              <div className="msg">
                <div>
                  <span className="dim">{issueKey(issue, teams)}</span>{' '}
                  <strong>{issue.title}</strong>
                </div>
                <div className="dim" style={{ fontSize: 11.5 }}>
                  <Avatar user={creator} size={12} /> {creator?.name ?? 'Unknown'} ·{' '}
                  {relativeTime(issue.createdAt)} ago
                </div>
              </div>
              {acceptState && (
                <button
                  className="btn"
                  title={`Accept → ${acceptState.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void patchIssue(issue.id, { stateId: acceptState.id });
                  }}
                >
                  <CheckIcon size={13} /> Accept
                </button>
              )}
              {declineState && (
                <button
                  className="btn ghost"
                  title={`Decline → ${declineState.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void patchIssue(issue.id, { stateId: declineState.id });
                  }}
                >
                  <CloseIcon size={13} /> Decline
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
