import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import {
  applyFilters,
  EMPTY_FILTERS,
  GroupedIssueList,
  useGroupedIssues,
  ViewControls,
  type Grouping,
  type IssueFilters,
} from '../issueViews.js';
import { UserIcon } from '../icons.js';

type Tab = 'assigned' | 'created' | 'subscribed';

export function MyIssuesPage() {
  const issues = useStore((s) => s.issues);
  const userId = useStore((s) => s.userId);
  const [tab, setTab] = useState<Tab>('assigned');
  const [grouping, setGrouping] = useState<Grouping>('state');
  const [filters, setFilters] = useState<IssueFilters>(EMPTY_FILTERS);

  const visible = useMemo(() => {
    const rows = Object.values(issues).filter((i) => {
      if (i.archivedAt) return false;
      if (tab === 'assigned') return i.assigneeId === userId;
      if (tab === 'created') return i.creatorId === userId;
      return userId !== null && i.subscriberIds.includes(userId);
    });
    return applyFilters(rows, filters);
  }, [issues, userId, tab, filters]);

  const grouped = useGroupedIssues(visible, grouping);

  return (
    <>
      <div className="topbar">
        <div className="title">
          <UserIcon size={16} />
          My Issues
        </div>
        <div className="row" style={{ gap: 2, marginLeft: 12 }}>
          {(['assigned', 'created', 'subscribed'] as Tab[]).map((t) => (
            <button
              key={t}
              className="btn ghost"
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
      </div>
      <ViewControls
        filters={filters}
        onFilters={setFilters}
        grouping={grouping}
        onGrouping={setGrouping}
      />
      <div className="content">
        <GroupedIssueList groups={grouped} grouping={grouping} />
      </div>
    </>
  );
}
