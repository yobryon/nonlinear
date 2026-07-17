import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CustomView, UpdateCustomViewInput } from '@nonlinear/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { BoardIcon, DotsIcon, ListIcon, SearchIcon, TrashIcon } from '../icons.js';
import { Popover, toastError, anchorFromEvent, type Anchor } from '../ui.js';
import {
  applyFilters,
  Board,
  GroupedIssueList,
  useGroupedIssues,
  ViewControls,
} from '../issueViews.js';

export function CustomViewPage() {
  const { viewId } = useParams<{ viewId: string }>();
  const view = useStore((s) => (viewId ? s.customViews[viewId] : undefined));

  if (!view) {
    return (
      <div className="empty-state">
        <SearchIcon size={26} style={{ color: 'var(--text-4)' }} />
        <h3>View not found</h3>
        <p>This view may have been deleted or made private by its creator.</p>
      </div>
    );
  }

  return <ViewBody view={view} />;
}

function ViewBody({ view }: { view: CustomView }) {
  const issues = useStore((s) => s.issues);
  const navigate = useNavigate();
  const [name, setName] = useState(view.name);
  const [menuAnchor, setMenuAnchor] = useState<Anchor | null>(null);

  // Keep the name draft in sync with realtime updates from other sessions.
  useEffect(() => setName(view.name), [view.name]);

  /** Optimistically merge a patch into the store, then persist it. */
  const persist = async (patch: UpdateCustomViewInput) => {
    useStore.getState().putEntity('customView', { ...view, ...patch });
    try {
      const updated = await api.updateView(view.id, { ...patch });
      useStore.getState().putEntity('customView', updated);
    } catch (err) {
      toastError(err);
    }
  };

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== view.name) void persist({ name: trimmed });
    else setName(view.name);
  };

  const deleteView = async () => {
    try {
      await api.deleteView(view.id);
      useStore.setState((s) => {
        const next = { ...s.customViews };
        delete next[view.id];
        return { customViews: next };
      });
      navigate('/');
    } catch (err) {
      toastError(err);
    }
  };

  const visible = useMemo(
    () =>
      applyFilters(
        Object.values(issues).filter(
          (i) => !i.archivedAt && (view.teamId === null || i.teamId === view.teamId),
        ),
        view.filters,
      ),
    [issues, view.teamId, view.filters],
  );

  const grouped = useGroupedIssues(
    visible,
    view.grouping,
    view.teamId ?? undefined,
    view.display === 'board',
  );

  return (
    <>
      <div className="topbar">
        <div className="title grow">
          <input
            value={name}
            placeholder="View name"
            aria-label="View name"
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              font: 'inherit',
              color: 'inherit',
              width: '100%',
            }}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setName(view.name);
            }}
          />
        </div>
        <span className="spacer" />
        <button
          className="chip"
          title={
            view.shared
              ? 'Visible to everyone. Click to make private.'
              : 'Only you can see this view. Click to share.'
          }
          onClick={() => void persist({ shared: !view.shared })}
        >
          {view.shared ? 'Shared' : 'Private'}
        </button>
        <div className="row" style={{ gap: 2 }}>
          <button
            className={`icon-btn${view.display === 'list' ? ' active' : ''}`}
            title="List view"
            onClick={() => void persist({ display: 'list' })}
          >
            <ListIcon size={15} />
          </button>
          <button
            className={`icon-btn${view.display === 'board' ? ' active' : ''}`}
            title="Board view"
            onClick={() => void persist({ display: 'board' })}
          >
            <BoardIcon size={15} />
          </button>
        </div>
        <button
          className="icon-btn"
          title="View options"
          onClick={(e) => setMenuAnchor(anchorFromEvent(e))}
        >
          <DotsIcon size={15} />
        </button>
      </div>

      <ViewControls
        filters={view.filters}
        onFilters={(f) => void persist({ filters: f })}
        grouping={view.display === 'list' ? view.grouping : undefined}
        onGrouping={view.display === 'list' ? (g) => void persist({ grouping: g }) : undefined}
        teamId={view.teamId ?? undefined}
      />

      <div className="content">
        {view.display === 'list' ? (
          <GroupedIssueList groups={grouped} grouping={view.grouping} />
        ) : (
          <Board groups={grouped} />
        )}
      </div>

      {menuAnchor && (
        <Popover anchor={menuAnchor} onClose={() => setMenuAnchor(null)} width={180}>
          <button
            className="menu-item destructive"
            onClick={() => {
              setMenuAnchor(null);
              if (confirm(`Delete view "${view.name}"?`)) void deleteView();
            }}
          >
            <TrashIcon size={14} />
            <span className="grow">Delete view</span>
          </button>
        </Popover>
      )}
    </>
  );
}
