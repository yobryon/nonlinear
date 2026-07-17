import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Issue } from '@nonlinear/shared';
import { api } from '../api.js';
import { issueKey, relativeTime, useStore } from '../store.js';
import { toastError } from '../ui.js';
import { TrashIcon } from '../icons.js';

export function ArchivePage() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const teams = useStore((s) => s.teams);
  const issues = useStore((s) => s.issues);
  const navigate = useNavigate();

  const team = Object.values(teams).find((t) => t.key === teamKey);

  const rows = useMemo(() => {
    if (!team) return [];
    return Object.values(issues)
      .filter((i) => i.teamId === team.id && i.archivedAt)
      .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
  }, [issues, team]);

  if (!team) {
    return (
      <div className="empty-state">
        <h3>Team not found</h3>
      </div>
    );
  }

  const restore = async (issue: Issue) => {
    try {
      const updated = await api.updateIssue(issue.id, { archived: false });
      useStore.getState().putEntity('issue', updated);
    } catch (err) {
      toastError(err);
    }
  };

  const remove = async (issue: Issue) => {
    if (!window.confirm(`Delete ${issueKey(issue, teams)} permanently? This cannot be undone.`)) {
      return;
    }
    try {
      await api.deleteIssue(issue.id);
      useStore.setState((s) => {
        const next = { ...s.issues };
        delete next[issue.id];
        return { issues: next };
      });
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="title">
          <span className="team-icon" style={{ background: team.color }}>
            {team.key.slice(0, 2)}
          </span>
          {team.name}
          <span className="crumb">›</span>
          <span className="crumb">Archive</span>
        </div>
        <span className="spacer" />
      </div>
      <div className="content">
        {rows.length === 0 && (
          <div className="empty-state">
            <TrashIcon size={26} style={{ color: 'var(--text-4)' }} />
            <h3>No archived issues</h3>
            <p>Archive from an issue's ⋯ menu.</p>
          </div>
        )}
        {rows.map((issue) => (
          <div
            key={issue.id}
            className="issue-row"
            onClick={() => navigate(`/issue/${issueKey(issue, teams)}`)}
          >
            <span className="identifier dim">{issueKey(issue, teams)}</span>
            <span className="title">{issue.title}</span>
            {issue.archivedAt && (
              <span className="dim">Archived {relativeTime(issue.archivedAt)}</span>
            )}
            <button
              className="btn ghost"
              onClick={(e) => {
                e.stopPropagation();
                void restore(issue);
              }}
            >
              Restore
            </button>
            <button
              className="icon-btn"
              title="Delete permanently"
              onClick={(e) => {
                e.stopPropagation();
                void remove(issue);
              }}
            >
              <TrashIcon size={15} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
