import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Grouping } from '@nonlinear/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { anchorFromEvent, Popover, toast, toastError, type Anchor } from '../ui.js';
import {
  applyFilters,
  Board,
  filtersActive,
  GroupedIssueList,
  useGroupedIssues,
  ViewControls,
  type IssueFilters,
} from '../issueViews.js';
import { patchScopeView, toggleScopeCollapsed, useScopeView } from '../viewState.js';
import { BoardIcon, ListIcon, PlusIcon } from '../icons.js';
import { openNewIssue } from '../NewIssueDialog.js';
import { OriginProvider, useUrlTab } from '../nav.js';

type Tab = 'all' | 'active' | 'backlog';

/** Persist the current filter/group/display config as a named custom view. */
function SaveViewButton({
  teamId,
  filters,
  grouping,
  display,
}: {
  teamId: string;
  filters: IssueFilters;
  grouping: Grouping;
  display: 'list' | 'board';
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(true);
  const navigate = useNavigate();

  const save = () => {
    if (!name.trim()) return;
    void api
      .createView({ name, shared, teamId, filters, grouping, display })
      .then((view) => {
        useStore.getState().putEntity('customView', view);
        toast(`View “${view.name}” saved`, 'success');
        setAnchor(null);
        navigate(`/view/${view.id}`);
      })
      .catch(toastError);
  };

  return (
    <>
      <button className="filter-pill" onClick={(e) => setAnchor(anchorFromEvent(e))}>
        <PlusIcon size={12} /> Save view
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={250}>
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              className="input"
              autoFocus
              placeholder="View name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
              }}
            />
            <label
              className="row"
              style={{ gap: 6, fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              Share with the workspace
            </label>
            <button className="btn primary" disabled={!name.trim()} onClick={save}>
              Save view
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

export function TeamIssuesPage() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const teams = useStore((s) => s.teams);
  const issues = useStore((s) => s.issues);
  const states = useStore((s) => s.workflowStates);

  const [tab, setTab] = useUrlTab(['all', 'active', 'backlog'] as const, 'all');

  const team = Object.values(teams).find((t) => t.key === teamKey);
  // Sticky per-team view: filter/group/sort/display/collapsed survive a hop
  // into an issue and back, and a reload. The tab stays in the URL.
  const scope = team ? `team:${team.id}` : '__none';
  const view = useScopeView(scope);
  const { filters, grouping, sort, display } = view;
  const setFilters = (f: IssueFilters) => patchScopeView(scope, { filters: f });
  const setGrouping = (g: Grouping) => patchScopeView(scope, { grouping: g });

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
    sort,
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
                tab === t ? { background: 'var(--bg-active)', color: 'var(--text-1)' } : undefined
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
            onClick={() => patchScopeView(scope, { display: 'list' })}
          >
            <ListIcon size={15} />
          </button>
          <button
            className={`icon-btn${display === 'board' ? ' active' : ''}`}
            title="Board view"
            onClick={() => patchScopeView(scope, { display: 'board' })}
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
        sort={display === 'list' ? sort : undefined}
        onSort={display === 'list' ? (s) => patchScopeView(scope, { sort: s }) : undefined}
        teamId={team.id}
        extra={
          filtersActive(filters) ? (
            <SaveViewButton
              teamId={team.id}
              filters={filters}
              grouping={grouping}
              display={display}
            />
          ) : undefined
        }
      />
      <OriginProvider
        value={{
          label: team.name,
          to: `/team/${team.key}/issues${tab !== 'all' ? `?tab=${tab}` : ''}`,
        }}
      >
        <div className="content">
          {display === 'list' ? (
            <GroupedIssueList
              groups={grouped}
              grouping={grouping}
              showState={grouping !== 'state'}
              onQuickAdd={quickAdd}
              draggable={sort === 'manual'}
              collapsed={new Set(view.collapsed)}
              onToggleCollapse={(key) => toggleScopeCollapsed(scope, key)}
            />
          ) : (
            <Board groups={grouped} onQuickAdd={quickAdd} />
          )}
        </div>
      </OriginProvider>
    </>
  );
}
