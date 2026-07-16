import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../store.js';
import {
  applyFilters,
  Board,
  EMPTY_FILTERS,
  GroupedIssueList,
  useGroupedIssues,
  ViewControls,
  type Grouping,
  type IssueFilters,
} from '../issueViews.js';
import { BoardIcon, ListIcon } from '../icons.js';
import { openNewIssue } from '../NewIssueDialog.js';

type Tab = 'all' | 'active' | 'backlog';

export function TeamIssuesPage() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const teams = useStore((s) => s.teams);
  const issues = useStore((s) => s.issues);
  const states = useStore((s) => s.workflowStates);

  const [tab, setTab] = useState<Tab>('all');
  const [display, setDisplay] = useState<'list' | 'board'>('list');
  const [grouping, setGrouping] = useState<Grouping>('state');
  const [filters, setFilters] = useState<IssueFilters>(EMPTY_FILTERS);

  const team = Object.values(teams).find((t) => t.key === teamKey);

  const visible = useMemo(() => {
    if (!team) return [];
    let rows = Object.values(issues).filter((i) => i.teamId === team.id && !i.archivedAt);
    if (tab !== 'all') {
      rows = rows.filter((i) => {
        const category = states[i.stateId]?.category;
        if (!category) return false;
        if (tab === 'active') return category === 'unstarted' || category === 'started';
        return category === 'backlog' || category === 'triage';
      });
    } else {
      // "All" hides completed/canceled issues older than two weeks.
      const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
      rows = rows.filter((i) => {
        const category = states[i.stateId]?.category;
        if (category === 'completed' || category === 'canceled') {
          const closedAt = i.completedAt ?? i.canceledAt;
          return closedAt !== null && closedAt > cutoff;
        }
        return true;
      });
    }
    return applyFilters(rows, filters);
  }, [issues, team, tab, states, filters]);

  const grouped = useGroupedIssues(
    visible,
    display === 'board' ? 'state' : grouping,
    team?.id,
    display === 'board',
  );

  if (!team) {
    return (
      <div className="empty-state">
        <h3>Team not found</h3>
      </div>
    );
  }

  const quickAdd = (group: { stateId?: string }) =>
    openNewIssue({ teamId: team.id, stateId: group.stateId });

  return (
    <>
      <div className="topbar">
        <div className="title">
          <span className="team-icon" style={{ background: team.color }}>
            {team.key.slice(0, 2)}
          </span>
          {team.name}
          <span className="crumb">›</span>
          <span className="crumb">Issues</span>
        </div>
        <div className="row" style={{ gap: 2, marginLeft: 12 }}>
          {(['all', 'active', 'backlog'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`btn ghost${tab === t ? ' active' : ''}`}
              style={
                tab === t
                  ? { background: 'var(--bg-active)', color: 'var(--text-1)' }
                  : undefined
              }
              onClick={() => setTab(t)}
            >
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <div className="row" style={{ gap: 2 }}>
          <button
            className={`icon-btn${display === 'list' ? ' active' : ''}`}
            title="List view"
            onClick={() => setDisplay('list')}
          >
            <ListIcon size={15} />
          </button>
          <button
            className={`icon-btn${display === 'board' ? ' active' : ''}`}
            title="Board view"
            onClick={() => setDisplay('board')}
          >
            <BoardIcon size={15} />
          </button>
        </div>
      </div>
      <ViewControls
        filters={filters}
        onFilters={setFilters}
        grouping={display === 'list' ? grouping : undefined}
        onGrouping={display === 'list' ? setGrouping : undefined}
        teamId={team.id}
      />
      <div className="content">
        {display === 'list' ? (
          <GroupedIssueList groups={grouped} showState={grouping !== 'state'} onQuickAdd={quickAdd} />
        ) : (
          <Board groups={grouped} onQuickAdd={quickAdd} />
        )}
      </div>
    </>
  );
}
