import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Issue, Label, Priority, User, WorkflowState } from '@nonlinear/shared';
import { PRIORITY_LABELS, keyBetween } from '@nonlinear/shared';
import { issueKey, formatDate, relativeTime, sortedStates, useStore, type ById } from './store.js';
import { Avatar, Picker, Popover, toast, type Anchor, anchorFromMouse } from './ui.js';
import {
  PriorityIcon,
  StateIcon,
  PlusIcon,
  CloseIcon,
  FilterIcon,
  CopyIcon,
  LinkIcon,
  TrashIcon,
  StarIcon,
  UserIcon,
  LabelIcon,
} from './icons.js';
import { AssigneePicker, LabelPicker, PriorityPicker, StatePicker, usePicker } from './pickers.js';
import {
  deleteIssue,
  patchIssue,
  setAssignee,
  setPriority,
  setState,
  toggleFavorite,
  toggleLabel,
} from './actions.js';

/* ================= filters ================= */

export interface IssueFilters {
  priorities: Priority[];
  assigneeIds: Array<string | null>;
  labelIds: string[];
  stateIds: string[];
  projectIds: string[];
}

export const EMPTY_FILTERS: IssueFilters = {
  priorities: [],
  assigneeIds: [],
  labelIds: [],
  stateIds: [],
  projectIds: [],
};

export function filtersActive(f: IssueFilters): boolean {
  return (
    f.priorities.length > 0 ||
    f.assigneeIds.length > 0 ||
    f.labelIds.length > 0 ||
    f.stateIds.length > 0 ||
    f.projectIds.length > 0
  );
}

export function applyFilters(issues: Issue[], f: IssueFilters): Issue[] {
  return issues.filter((i) => {
    if (f.priorities.length && !f.priorities.includes(i.priority)) return false;
    if (f.assigneeIds.length && !f.assigneeIds.includes(i.assigneeId)) return false;
    if (f.labelIds.length && !f.labelIds.some((l) => i.labelIds.includes(l))) return false;
    if (f.stateIds.length && !f.stateIds.includes(i.stateId)) return false;
    if (f.projectIds.length && !(i.projectId && f.projectIds.includes(i.projectId))) return false;
    return true;
  });
}

/* ================= grouping & sorting ================= */

export type Grouping = 'state' | 'priority' | 'assignee';

export interface IssueGroup {
  key: string;
  label: string;
  icon: ReactNode;
  issues: Issue[];
  /** For board drops & quick-add defaults. */
  stateId?: string;
}

const PRIORITY_ORDER: Priority[] = [1, 2, 3, 4, 0];

function prioritySortKey(p: Priority): number {
  return p === 0 ? 5 : p;
}

export function sortForList(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      prioritySortKey(a.priority) - prioritySortKey(b.priority) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function sortForBoard(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1));
}

export function groupIssues(
  issues: Issue[],
  grouping: Grouping,
  ctx: {
    states: ById<WorkflowState>;
    users: ById<User>;
    teamId?: string;
  },
  opts: { board?: boolean; hideEmpty?: boolean } = {},
): IssueGroup[] {
  const sort = opts.board ? sortForBoard : sortForList;
  if (grouping === 'state') {
    if (ctx.teamId) {
      const states = sortedStates(Object.values(ctx.states), ctx.teamId);
      const groups: IssueGroup[] = states.map((s) => ({
        key: s.id,
        label: s.name,
        stateId: s.id,
        icon: <StateIcon category={s.category} color={s.color} />,
        issues: sort(issues.filter((i) => i.stateId === s.id)),
      }));
      return opts.hideEmpty ? groups.filter((g) => g.issues.length > 0) : groups;
    }
    // Cross-team views group by state category.
    const categories: Array<{ key: WorkflowState['category']; label: string; color: string }> = [
      { key: 'triage', label: 'Triage', color: '#f2994a' },
      { key: 'backlog', label: 'Backlog', color: '#bec2c8' },
      { key: 'unstarted', label: 'Todo', color: '#8a8f98' },
      { key: 'started', label: 'In Progress', color: '#f2c94c' },
      { key: 'completed', label: 'Completed', color: '#5e6ad2' },
      { key: 'canceled', label: 'Canceled', color: '#95a2b3' },
    ];
    return categories
      .map((c) => ({
        key: c.key,
        label: c.label,
        icon: <StateIcon category={c.key} color={c.color} />,
        issues: sort(issues.filter((i) => ctx.states[i.stateId]?.category === c.key)),
      }))
      .filter((g) => g.issues.length > 0);
  }
  if (grouping === 'priority') {
    const groups = PRIORITY_ORDER.map((p) => ({
      key: String(p),
      label: PRIORITY_LABELS[p],
      icon: <PriorityIcon priority={p} />,
      issues: sort(issues.filter((i) => i.priority === p)),
    }));
    return groups.filter((g) => g.issues.length > 0);
  }
  // assignee
  const users = Object.values(ctx.users).sort((a, b) => a.name.localeCompare(b.name));
  const groups: IssueGroup[] = users.map((u) => ({
    key: u.id,
    label: u.name,
    icon: <Avatar user={u} size={16} />,
    issues: sort(issues.filter((i) => i.assigneeId === u.id)),
  }));
  groups.push({
    key: '__unassigned',
    label: 'Unassigned',
    icon: <Avatar user={null} size={16} />,
    issues: sort(issues.filter((i) => i.assigneeId === null)),
  });
  return groups.filter((g) => g.issues.length > 0);
}

/* ================= issue row ================= */

function LabelDots({ labelIds, labels }: { labelIds: string[]; labels: ById<Label> }) {
  const visible = labelIds.map((id) => labels[id]).filter(Boolean) as Label[];
  if (visible.length === 0) return null;
  return (
    <>
      {visible.slice(0, 3).map((l) => (
        <span key={l.id} className="chip" title={l.name}>
          <span className="dot" style={{ background: l.color }} />
          {l.name}
        </span>
      ))}
      {visible.length > 3 && <span className="dim">+{visible.length - 3}</span>}
    </>
  );
}

export function IssueRow({ issue, showState = true }: { issue: Issue; showState?: boolean }) {
  const teams = useStore((s) => s.teams);
  const states = useStore((s) => s.workflowStates);
  const users = useStore((s) => s.users);
  const labels = useStore((s) => s.labels);
  const navigate = useNavigate();
  const [ctxAnchor, setCtxAnchor] = useState<Anchor | null>(null);

  const statePicker = usePicker();
  const priorityPicker = usePicker();
  const assigneePicker = usePicker();

  const state = states[issue.stateId];
  const assignee = issue.assigneeId ? users[issue.assigneeId] : null;
  const key = issueKey(issue, teams);

  return (
    <>
      <div
        className="issue-row"
        onClick={() => navigate(`/issue/${key}`)}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxAnchor(anchorFromMouse(e));
        }}
      >
        <button
          className="icon-btn"
          style={{ width: 22, height: 22 }}
          title={PRIORITY_LABELS[issue.priority]}
          onClick={(e) => {
            e.stopPropagation();
            priorityPicker.open(anchorFromMouse(e));
          }}
        >
          <PriorityIcon priority={issue.priority} />
        </button>
        <span className="identifier">{key}</span>
        {showState && state && (
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            title={state.name}
            onClick={(e) => {
              e.stopPropagation();
              statePicker.open(anchorFromMouse(e));
            }}
          >
            <StateIcon category={state.category} color={state.color} />
          </button>
        )}
        <span className="title">{issue.title}</span>
        <span className="meta">
          <LabelDots labelIds={issue.labelIds} labels={labels} />
          {issue.dueDate && (
            <span
              className="dim"
              title="Due date"
              style={{
                color:
                  issue.dueDate < new Date().toISOString() && !issue.completedAt
                    ? 'var(--danger)'
                    : undefined,
              }}
            >
              {formatDate(issue.dueDate)}
            </span>
          )}
        </span>
        <span className="date" title={new Date(issue.updatedAt).toLocaleString()}>
          {relativeTime(issue.updatedAt)}
        </span>
        <button
          className="icon-btn"
          style={{ width: 22, height: 22 }}
          onClick={(e) => {
            e.stopPropagation();
            assigneePicker.open(anchorFromMouse(e));
          }}
        >
          <Avatar user={assignee} size={18} />
        </button>
      </div>

      {statePicker.anchor && (
        <StatePicker
          anchor={statePicker.anchor}
          onClose={statePicker.close}
          teamId={issue.teamId}
          currentId={issue.stateId}
          onPick={(id) => setState(issue.id, id)}
        />
      )}
      {priorityPicker.anchor && (
        <PriorityPicker
          anchor={priorityPicker.anchor}
          onClose={priorityPicker.close}
          currentId={issue.priority}
          onPick={(p) => setPriority(issue.id, p)}
        />
      )}
      {assigneePicker.anchor && (
        <AssigneePicker
          anchor={assigneePicker.anchor}
          onClose={assigneePicker.close}
          currentId={issue.assigneeId}
          onPick={(id) => setAssignee(issue.id, id)}
        />
      )}
      {ctxAnchor && (
        <IssueContextMenu issue={issue} anchor={ctxAnchor} onClose={() => setCtxAnchor(null)} />
      )}
    </>
  );
}

/* ================= context menu ================= */

export function IssueContextMenu({
  issue,
  anchor,
  onClose,
}: {
  issue: Issue;
  anchor: Anchor;
  onClose: () => void;
}) {
  const teams = useStore((s) => s.teams);
  const favorites = useStore((s) => s.favorites);
  const userId = useStore((s) => s.userId);
  const [mode, setMode] = useState<'menu' | 'state' | 'assignee' | 'priority' | 'labels'>('menu');
  const key = issueKey(issue, teams);
  const isFavorite = Object.values(favorites).some(
    (f) => f.userId === userId && f.type === 'issue' && f.targetId === issue.id,
  );

  if (mode === 'state') {
    return (
      <StatePicker
        anchor={anchor}
        onClose={onClose}
        teamId={issue.teamId}
        currentId={issue.stateId}
        onPick={(id) => setState(issue.id, id)}
      />
    );
  }
  if (mode === 'assignee') {
    return (
      <AssigneePicker
        anchor={anchor}
        onClose={onClose}
        currentId={issue.assigneeId}
        onPick={(id) => setAssignee(issue.id, id)}
      />
    );
  }
  if (mode === 'priority') {
    return (
      <PriorityPicker
        anchor={anchor}
        onClose={onClose}
        currentId={issue.priority}
        onPick={(p) => setPriority(issue.id, p)}
      />
    );
  }
  if (mode === 'labels') {
    return (
      <LabelPicker
        anchor={anchor}
        onClose={onClose}
        teamId={issue.teamId}
        selected={issue.labelIds}
        onToggle={(id) => toggleLabel(issue, id)}
      />
    );
  }

  return (
    <Popover anchor={anchor} onClose={onClose} width={220}>
      <button className="menu-item" onClick={() => setMode('state')}>
        <StateIcon category="started" color="var(--text-3)" />
        <span className="grow">Status…</span>
      </button>
      <button className="menu-item" onClick={() => setMode('assignee')}>
        <UserIcon size={14} />
        <span className="grow">Assignee…</span>
      </button>
      <button className="menu-item" onClick={() => setMode('priority')}>
        <PriorityIcon priority={2} />
        <span className="grow">Priority…</span>
      </button>
      <button className="menu-item" onClick={() => setMode('labels')}>
        <LabelIcon size={14} />
        <span className="grow">Labels…</span>
      </button>
      <div className="menu-separator" />
      <button
        className="menu-item"
        onClick={() => {
          void toggleFavorite('issue', issue.id);
          onClose();
        }}
      >
        <StarIcon size={14} filled={isFavorite} />
        <span className="grow">{isFavorite ? 'Remove from favorites' : 'Add to favorites'}</span>
      </button>
      <button
        className="menu-item"
        onClick={() => {
          void navigator.clipboard.writeText(key);
          toast(`Copied ${key}`);
          onClose();
        }}
      >
        <CopyIcon size={14} />
        <span className="grow">Copy ID</span>
      </button>
      <button
        className="menu-item"
        onClick={() => {
          void navigator.clipboard.writeText(`${location.origin}/issue/${key}`);
          toast('Link copied');
          onClose();
        }}
      >
        <LinkIcon size={14} />
        <span className="grow">Copy link</span>
      </button>
      <div className="menu-separator" />
      <button
        className="menu-item destructive"
        onClick={() => {
          void deleteIssue(issue.id);
          onClose();
        }}
      >
        <TrashIcon size={14} />
        <span className="grow">Delete</span>
      </button>
    </Popover>
  );
}

/* ================= grouped list ================= */

export function GroupedIssueList({
  groups,
  showState = true,
  onQuickAdd,
}: {
  groups: IssueGroup[];
  showState?: boolean;
  onQuickAdd?: (group: IssueGroup) => void;
}) {
  const total = groups.reduce((n, g) => n + g.issues.length, 0);
  if (total === 0) {
    return (
      <div className="empty-state">
        <h3>No issues</h3>
        <p>
          Press <span className="kbd">C</span> to create the first issue.
        </p>
      </div>
    );
  }
  return (
    <div>
      {groups.map((group) => (
        <Fragment key={group.key}>
          {group.issues.length > 0 && (
            <>
              <div className="group-header">
                {group.icon}
                <span>{group.label}</span>
                <span className="count">{group.issues.length}</span>
                {onQuickAdd && (
                  <button className="icon-btn add" onClick={() => onQuickAdd(group)}>
                    <PlusIcon size={14} />
                  </button>
                )}
              </div>
              {group.issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} showState={showState} />
              ))}
            </>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/* ================= board ================= */

export function Board({
  groups,
  onQuickAdd,
}: {
  groups: IssueGroup[];
  onQuickAdd?: (group: IssueGroup) => void;
}) {
  const teams = useStore((s) => s.teams);
  const users = useStore((s) => s.users);
  const labels = useStore((s) => s.labels);
  const navigate = useNavigate();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ group: string; index: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ issue: Issue; anchor: Anchor } | null>(null);

  const drop = (group: IssueGroup, index: number) => {
    if (!dragId) return;
    const issue = useStore.getState().issues[dragId];
    if (!issue || !group.stateId) return;
    const cards = group.issues.filter((i) => i.id !== dragId);
    const before = cards[index - 1]?.sortOrder ?? null;
    const after = cards[index]?.sortOrder ?? null;
    let sortOrder: string;
    try {
      sortOrder = keyBetween(before, after);
    } catch {
      sortOrder = issue.sortOrder;
    }
    const patch: Record<string, unknown> = { sortOrder };
    if (issue.stateId !== group.stateId) patch.stateId = group.stateId;
    void patchIssue(dragId, patch);
    setDragId(null);
    setOver(null);
  };

  return (
    <div className="board">
      {groups.map((group) => (
        <div
          key={group.key}
          className={`board-col${over?.group === group.key ? ' drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (over?.group !== group.key)
              setOver({ group: group.key, index: group.issues.length });
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setOver(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop(group, over?.group === group.key ? over.index : group.issues.length);
          }}
        >
          <div className="board-col-header">
            {group.icon}
            <span>{group.label}</span>
            <span className="count">{group.issues.length}</span>
            {onQuickAdd && (
              <button className="icon-btn add" onClick={() => onQuickAdd(group)}>
                <PlusIcon size={14} />
              </button>
            )}
          </div>
          <div className="board-cards">
            {group.issues.map((issue, index) => {
              const assignee = issue.assigneeId ? users[issue.assigneeId] : null;
              return (
                <Fragment key={issue.id}>
                  <div
                    className={`drop-slot${
                      over?.group === group.key && over.index === index ? ' over' : ''
                    }`}
                  />
                  <div
                    className={`board-card${dragId === issue.id ? ' dragging' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      setDragId(issue.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOver(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const before = e.clientY < rect.top + rect.height / 2;
                      setOver({ group: group.key, index: before ? index : index + 1 });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      drop(group, over?.group === group.key ? over.index : index);
                    }}
                    onClick={() => navigate(`/issue/${issueKey(issue, teams)}`)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtxMenu({ issue, anchor: anchorFromMouse(e) });
                    }}
                  >
                    <div className="head">
                      <span>{issueKey(issue, teams)}</span>
                      <Avatar user={assignee} size={16} />
                    </div>
                    <div className="title">{issue.title}</div>
                    <div className="foot">
                      <PriorityIcon priority={issue.priority} />
                      <LabelDots labelIds={issue.labelIds} labels={labels} />
                    </div>
                  </div>
                </Fragment>
              );
            })}
            <div
              className={`drop-slot${
                over?.group === group.key && over.index === group.issues.length ? ' over' : ''
              }`}
            />
          </div>
        </div>
      ))}
      {ctxMenu && (
        <IssueContextMenu
          issue={ctxMenu.issue}
          anchor={ctxMenu.anchor}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

/* ================= view controls ================= */

export function ViewControls({
  filters,
  onFilters,
  grouping,
  onGrouping,
  teamId,
  extra,
}: {
  filters: IssueFilters;
  onFilters: (f: IssueFilters) => void;
  grouping?: Grouping;
  onGrouping?: (g: Grouping) => void;
  teamId?: string;
  extra?: ReactNode;
}) {
  const users = useStore((s) => s.users);
  const labels = useStore((s) => s.labels);
  const states = useStore((s) => s.workflowStates);
  const [filterAnchor, setFilterAnchor] = useState<Anchor | null>(null);
  const [dim, setDim] = useState<'root' | 'priority' | 'assignee' | 'label' | 'state'>('root');
  const [groupAnchor, setGroupAnchor] = useState<Anchor | null>(null);

  const closeFilter = () => {
    setFilterAnchor(null);
    setDim('root');
  };

  const stateItems = teamId ? sortedStates(Object.values(states), teamId) : Object.values(states);

  return (
    <div className="view-controls">
      <button
        className="filter-pill"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setFilterAnchor({ x: rect.left, y: rect.bottom + 4 });
        }}
      >
        <FilterIcon size={12} />
        Filter
      </button>

      {filters.priorities.length > 0 && (
        <span className="filter-pill set">
          Priority: {filters.priorities.map((p) => PRIORITY_LABELS[p]).join(', ')}
          <button className="x" onClick={() => onFilters({ ...filters, priorities: [] })}>
            <CloseIcon size={11} />
          </button>
        </span>
      )}
      {filters.assigneeIds.length > 0 && (
        <span className="filter-pill set">
          Assignee:{' '}
          {filters.assigneeIds
            .map((id) => (id === null ? 'Unassigned' : (users[id]?.name ?? '?')))
            .join(', ')}
          <button className="x" onClick={() => onFilters({ ...filters, assigneeIds: [] })}>
            <CloseIcon size={11} />
          </button>
        </span>
      )}
      {filters.labelIds.length > 0 && (
        <span className="filter-pill set">
          Label: {filters.labelIds.map((id) => labels[id]?.name ?? '?').join(', ')}
          <button className="x" onClick={() => onFilters({ ...filters, labelIds: [] })}>
            <CloseIcon size={11} />
          </button>
        </span>
      )}
      {filters.stateIds.length > 0 && (
        <span className="filter-pill set">
          Status: {filters.stateIds.map((id) => states[id]?.name ?? '?').join(', ')}
          <button className="x" onClick={() => onFilters({ ...filters, stateIds: [] })}>
            <CloseIcon size={11} />
          </button>
        </span>
      )}

      <span className="grow" />
      {extra}
      {grouping && onGrouping && (
        <button
          className="filter-pill set"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setGroupAnchor({ x: rect.left, y: rect.bottom + 4 });
          }}
        >
          Group:{' '}
          {grouping === 'state' ? 'Status' : grouping === 'priority' ? 'Priority' : 'Assignee'}
        </button>
      )}

      {groupAnchor && onGrouping && (
        <Picker
          anchor={groupAnchor}
          onClose={() => setGroupAnchor(null)}
          searchable={false}
          selectedIds={new Set([grouping ?? 'state'])}
          items={[
            { id: 'state', label: 'Status' },
            { id: 'priority', label: 'Priority' },
            { id: 'assignee', label: 'Assignee' },
          ]}
          onPick={(id) => {
            onGrouping(id as Grouping);
            setGroupAnchor(null);
          }}
        />
      )}

      {filterAnchor && dim === 'root' && (
        <Picker
          anchor={filterAnchor}
          onClose={closeFilter}
          searchable={false}
          items={[
            { id: 'priority', label: 'Priority', icon: <PriorityIcon priority={2} /> },
            { id: 'assignee', label: 'Assignee', icon: <UserIcon size={14} /> },
            { id: 'label', label: 'Label', icon: <LabelIcon size={14} /> },
            {
              id: 'state',
              label: 'Status',
              icon: <StateIcon category="started" color="var(--text-3)" />,
            },
          ]}
          onPick={(id) => setDim(id as typeof dim)}
        />
      )}
      {filterAnchor && dim === 'priority' && (
        <Picker
          anchor={filterAnchor}
          onClose={closeFilter}
          searchable={false}
          selectedIds={new Set(filters.priorities.map(String))}
          items={([1, 2, 3, 4, 0] as Priority[]).map((p) => ({
            id: String(p),
            label: PRIORITY_LABELS[p],
            icon: <PriorityIcon priority={p} />,
          }))}
          onPick={(id) => {
            const p = Number(id) as Priority;
            const next = filters.priorities.includes(p)
              ? filters.priorities.filter((x) => x !== p)
              : [...filters.priorities, p];
            onFilters({ ...filters, priorities: next });
          }}
        />
      )}
      {filterAnchor && dim === 'assignee' && (
        <Picker
          anchor={filterAnchor}
          onClose={closeFilter}
          selectedIds={new Set(filters.assigneeIds.map((id) => (id === null ? '__none' : id)))}
          items={[
            { id: '__none', label: 'Unassigned' },
            ...Object.values(users).map((u) => ({ id: u.id, label: u.name })),
          ]}
          onPick={(id) => {
            const value = id === '__none' ? null : id;
            const next = filters.assigneeIds.includes(value)
              ? filters.assigneeIds.filter((x) => x !== value)
              : [...filters.assigneeIds, value];
            onFilters({ ...filters, assigneeIds: next });
          }}
        />
      )}
      {filterAnchor && dim === 'label' && (
        <Picker
          anchor={filterAnchor}
          onClose={closeFilter}
          selectedIds={new Set(filters.labelIds)}
          items={Object.values(labels).map((l) => ({
            id: l.id,
            label: l.name,
            icon: (
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 5,
                  background: l.color,
                  display: 'inline-block',
                }}
              />
            ),
          }))}
          onPick={(id) => {
            const next = filters.labelIds.includes(id)
              ? filters.labelIds.filter((x) => x !== id)
              : [...filters.labelIds, id];
            onFilters({ ...filters, labelIds: next });
          }}
        />
      )}
      {filterAnchor && dim === 'state' && (
        <Picker
          anchor={filterAnchor}
          onClose={closeFilter}
          selectedIds={new Set(filters.stateIds)}
          items={stateItems.map((s) => ({
            id: s.id,
            label: s.name,
            icon: <StateIcon category={s.category} color={s.color} />,
          }))}
          onPick={(id) => {
            const next = filters.stateIds.includes(id)
              ? filters.stateIds.filter((x) => x !== id)
              : [...filters.stateIds, id];
            onFilters({ ...filters, stateIds: next });
          }}
        />
      )}
    </div>
  );
}

/* Hook: memoized grouped issues for a view. */
export function useGroupedIssues(
  issues: Issue[],
  grouping: Grouping,
  teamId?: string,
  board?: boolean,
): IssueGroup[] {
  const states = useStore((s) => s.workflowStates);
  const users = useStore((s) => s.users);
  return useMemo(
    () =>
      groupIssues(
        issues,
        grouping,
        { states, users, teamId },
        { board, hideEmpty: !board && grouping === 'state' },
      ),
    [issues, grouping, states, users, teamId, board],
  );
}
