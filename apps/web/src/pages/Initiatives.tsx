import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Initiative, InitiativeStatus } from '@nonlinear/shared';
import { INITIATIVE_STATUSES } from '@nonlinear/shared';
import { api } from '../api.js';
import { formatDate, useStore } from '../store.js';
import { anchorFromEvent, Avatar, Picker, Popover, toastError, type Anchor } from '../ui.js';
import {
  CalendarIcon,
  DotsIcon,
  PlusIcon,
  ProjectIcon,
  ProjectStatusIcon,
  TrashIcon,
  UserIcon,
} from '../icons.js';
import { AssigneePicker, usePicker } from '../pickers.js';
import { Markdown } from '../markdown.js';

const STATUS_LABELS: Record<InitiativeStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
};

function InitiativeGlyph({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <rect
        x="1"
        y="1"
        width="12"
        height="12"
        rx="3.5"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
      />
      <circle cx="7" cy="7" r="2.2" fill={color} />
    </svg>
  );
}

export function InitiativesPage() {
  const initiatives = useStore((s) => s.initiatives);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const navigate = useNavigate();
  const [name, setName] = useState('');

  const rows = useMemo(
    () =>
      Object.values(initiatives).sort(
        (a, b) =>
          INITIATIVE_STATUSES.indexOf(a.status) - INITIATIVE_STATUSES.indexOf(b.status) ||
          (a.sortOrder < b.sortOrder ? -1 : 1),
      ),
    [initiatives],
  );

  const create = () => {
    if (!name.trim()) return;
    void api
      .createInitiative({ name })
      .then((initiative) => {
        useStore.getState().putEntity('initiative', initiative);
        setName('');
        navigate(`/initiative/${initiative.id}`);
      })
      .catch(toastError);
  };

  return (
    <>
      <div className="topbar">
        <div className="title">
          <InitiativeGlyph color="var(--text-2)" size={16} />
          Initiatives
        </div>
        <span className="spacer" />
        <input
          className="input"
          style={{ width: 200, height: 26 }}
          placeholder="New initiative…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create();
          }}
        />
        <button className="btn primary" disabled={!name.trim()} onClick={create}>
          <PlusIcon size={13} /> Create
        </button>
      </div>
      <div className="content">
        {rows.length === 0 && (
          <div className="empty-state">
            <InitiativeGlyph color="var(--text-4)" size={26} />
            <h3>No initiatives</h3>
            <p>Initiatives group projects into a roadmap.</p>
          </div>
        )}
        {rows.map((initiative) => {
          const linked = Object.values(projects).filter((p) => p.initiativeId === initiative.id);
          const done = linked.filter((p) => p.status === 'completed').length;
          const pct = linked.length ? Math.round((done / linked.length) * 100) : 0;
          const owner = initiative.ownerId ? users[initiative.ownerId] : null;
          return (
            <div
              key={initiative.id}
              className="project-row"
              onClick={() => navigate(`/initiative/${initiative.id}`)}
            >
              <InitiativeGlyph color={initiative.color} />
              <span className="name">{initiative.name}</span>
              <span className="status-chip muted">{STATUS_LABELS[initiative.status]}</span>
              <span className="grow" />
              <span className="dim">
                {linked.length} project{linked.length === 1 ? '' : 's'}
              </span>
              <div className="progress-bar">
                <div style={{ width: `${pct}%` }} />
              </div>
              {initiative.targetDate && (
                <span className="dim row" style={{ gap: 4 }}>
                  <CalendarIcon size={12} />
                  {formatDate(initiative.targetDate)}
                </span>
              )}
              <Avatar user={owner} size={18} />
            </div>
          );
        })}
      </div>
    </>
  );
}

export function InitiativeDetailPage() {
  const { initiativeId } = useParams<{ initiativeId: string }>();
  const initiatives = useStore((s) => s.initiatives);
  const initiative = initiativeId ? initiatives[initiativeId] : null;
  if (!initiative) {
    return (
      <div className="empty-state">
        <h3>Initiative not found</h3>
      </div>
    );
  }
  return <InitiativeDetail initiative={initiative} />;
}

function InitiativeDetail({ initiative }: { initiative: Initiative }) {
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const issues = useStore((s) => s.issues);
  const workflowStates = useStore((s) => s.workflowStates);
  const navigate = useNavigate();
  const [statusAnchor, setStatusAnchor] = useState<Anchor | null>(null);
  const [addAnchor, setAddAnchor] = useState<Anchor | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<Anchor | null>(null);
  const ownerPicker = usePicker();

  const linked = Object.values(projects)
    .filter((p) => p.initiativeId === initiative.id)
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1));
  const unlinked = Object.values(projects).filter((p) => p.initiativeId !== initiative.id);
  const owner = initiative.ownerId ? users[initiative.ownerId] : null;

  const patch = (input: Record<string, unknown>) => {
    void api
      .updateInitiative(initiative.id, input)
      .then((i) => useStore.getState().putEntity('initiative', i))
      .catch(toastError);
  };

  return (
    <>
      <div className="topbar">
        <div className="title">
          <Link to="/initiatives" className="crumb">
            Initiatives
          </Link>
          <span className="crumb">›</span>
          <InitiativeGlyph color={initiative.color} />
          {initiative.name}
        </div>
        <span className="spacer" />
        <button className="chip" onClick={(e) => setStatusAnchor(anchorFromEvent(e))}>
          {STATUS_LABELS[initiative.status]}
        </button>
        <button className="chip" onClick={(e) => ownerPicker.open(anchorFromEvent(e))}>
          <UserIcon size={12} />
          {owner ? owner.name : 'Owner'}
        </button>
        <button className="icon-btn" onClick={(e) => setMenuAnchor(anchorFromEvent(e))}>
          <DotsIcon size={15} />
        </button>
      </div>

      {initiative.description && (
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <Markdown source={initiative.description} />
        </div>
      )}

      <div className="content">
        <div className="group-header">
          <ProjectIcon size={14} />
          <span>Projects</span>
          <span className="count">{linked.length}</span>
          <button className="icon-btn add" onClick={(e) => setAddAnchor(anchorFromEvent(e))}>
            <PlusIcon size={14} />
          </button>
        </div>
        {linked.length === 0 && (
          <div className="empty-state" style={{ padding: 40 }}>
            <p>No projects yet — add existing projects to this initiative.</p>
          </div>
        )}
        {linked.map((project) => {
          const projectIssues = Object.values(issues).filter(
            (i) => i.projectId === project.id && !i.archivedAt,
          );
          const done = projectIssues.filter((i) => {
            const c = workflowStates[i.stateId]?.category;
            return c === 'completed' || c === 'canceled';
          }).length;
          const pct = projectIssues.length ? Math.round((done / projectIssues.length) * 100) : 0;
          return (
            <div
              key={project.id}
              className="project-row"
              onClick={() => navigate(`/project/${project.id}`)}
            >
              <ProjectStatusIcon status={project.status} />
              <span className="name">{project.name}</span>
              <span className="grow" />
              <div className="progress-bar">
                <div style={{ width: `${pct}%` }} />
              </div>
              <span className="dim" style={{ width: 70 }}>
                {done}/{projectIssues.length} done
              </span>
              <button
                className="icon-btn"
                title="Remove from initiative"
                onClick={(e) => {
                  e.stopPropagation();
                  void api
                    .updateProject(project.id, { initiativeId: null })
                    .then((p) => useStore.getState().putEntity('project', p))
                    .catch(toastError);
                }}
              >
                <TrashIcon size={13} />
              </button>
            </div>
          );
        })}
      </div>

      {statusAnchor && (
        <Picker
          anchor={statusAnchor}
          onClose={() => setStatusAnchor(null)}
          searchable={false}
          selectedIds={new Set([initiative.status])}
          items={INITIATIVE_STATUSES.map((s) => ({ id: s, label: STATUS_LABELS[s] }))}
          onPick={(id) => {
            patch({ status: id });
            setStatusAnchor(null);
          }}
        />
      )}
      {ownerPicker.anchor && (
        <AssigneePicker
          anchor={ownerPicker.anchor}
          onClose={ownerPicker.close}
          currentId={initiative.ownerId}
          onPick={(id) => patch({ ownerId: id })}
        />
      )}
      {addAnchor && (
        <Picker
          anchor={addAnchor}
          onClose={() => setAddAnchor(null)}
          placeholder="Add project…"
          items={unlinked.map((p) => ({
            id: p.id,
            label: p.name,
            icon: <ProjectStatusIcon status={p.status} size={13} />,
          }))}
          onPick={(projectId) => {
            void api
              .updateProject(projectId, { initiativeId: initiative.id })
              .then((p) => useStore.getState().putEntity('project', p))
              .catch(toastError);
            setAddAnchor(null);
          }}
        />
      )}
      {menuAnchor && (
        <Popover anchor={menuAnchor} onClose={() => setMenuAnchor(null)} width={200}>
          <button
            className="menu-item destructive"
            onClick={() => {
              setMenuAnchor(null);
              void api
                .deleteInitiative(initiative.id)
                .then(() => {
                  const next = { ...useStore.getState().initiatives };
                  delete next[initiative.id];
                  useStore.setState({ initiatives: next });
                  navigate('/initiatives');
                })
                .catch(toastError);
            }}
          >
            <TrashIcon size={14} />
            <span className="grow">Delete initiative</span>
          </button>
        </Popover>
      )}
    </>
  );
}
