import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import type { Project, ProjectStatus } from '@nonlinear/shared';
import { PROJECT_STATUSES } from '@nonlinear/shared';
import { api } from '../api.js';
import { formatDate, useStore } from '../store.js';
import {
  anchorFromEvent,
  Avatar,
  Modal,
  Picker,
  Popover,
  sortKeyForInsert,
  toastError,
  useDragReorder,
  type Anchor,
} from '../ui.js';
import {
  CalendarIcon,
  DotsIcon,
  PlusIcon,
  ProjectIcon,
  ProjectStatusIcon,
  StarIcon,
  TrashIcon,
  UserIcon,
} from '../icons.js';
import {
  applyFilters,
  EMPTY_FILTERS,
  GroupedIssueList,
  useGroupedIssues,
  ViewControls,
  type IssueFilters,
} from '../issueViews.js';
import { openNewIssue } from '../NewIssueDialog.js';
import { toggleFavorite } from '../actions.js';
import { Markdown } from '../markdown.js';
import { usePicker, AssigneePicker } from '../pickers.js';

const STATUS_LABELS: Record<ProjectStatus, string> = {
  backlog: 'Backlog',
  planned: 'Planned',
  started: 'In Progress',
  paused: 'Paused',
  completed: 'Completed',
  canceled: 'Canceled',
};

export function projectProgress(projectId: string): { done: number; total: number } {
  const { issues, workflowStates } = useStore.getState();
  const rows = Object.values(issues).filter((i) => i.projectId === projectId && !i.archivedAt);
  const done = rows.filter((i) => {
    const category = workflowStates[i.stateId]?.category;
    return category === 'completed' || category === 'canceled';
  }).length;
  return { done, total: rows.length };
}

export function ProjectsPage() {
  const projects = useStore((s) => s.projects);
  const issues = useStore((s) => s.issues);
  const workflowStates = useStore((s) => s.workflowStates);
  const users = useStore((s) => s.users);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () =>
      Object.values(projects).sort(
        (a, b) =>
          PROJECT_STATUSES.indexOf(a.status) - PROJECT_STATUSES.indexOf(b.status) ||
          (a.sortOrder < b.sortOrder ? -1 : 1),
      ),
    [projects],
  );

  return (
    <>
      <div className="topbar">
        <div className="title">
          <ProjectIcon size={16} />
          Projects
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setCreating(true)}>
          <PlusIcon size={13} /> New project
        </button>
      </div>
      <div className="content">
        {rows.length === 0 && (
          <div className="empty-state">
            <ProjectIcon size={28} style={{ color: 'var(--text-4)' }} />
            <h3>No projects yet</h3>
            <p>Projects group issues across teams toward a goal.</p>
            <button className="btn primary" onClick={() => setCreating(true)}>
              Create your first project
            </button>
          </div>
        )}
        {rows.map((project) => {
          const projectIssues = Object.values(issues).filter(
            (i) => i.projectId === project.id && !i.archivedAt,
          );
          const done = projectIssues.filter((i) => {
            const c = workflowStates[i.stateId]?.category;
            return c === 'completed' || c === 'canceled';
          }).length;
          const lead = project.leadId ? users[project.leadId] : null;
          const pct = projectIssues.length ? Math.round((done / projectIssues.length) * 100) : 0;
          return (
            <div
              key={project.id}
              className="project-row"
              onClick={() => navigate(`/project/${project.id}`)}
            >
              <ProjectStatusIcon status={project.status} />
              <span className="name">{project.name}</span>
              <span className="status-chip muted">{STATUS_LABELS[project.status]}</span>
              <span className="grow" />
              <div className="progress-bar">
                <div style={{ width: `${pct}%` }} />
              </div>
              <span className="dim" style={{ width: 70 }}>
                {done}/{projectIssues.length} done
              </span>
              {project.targetDate && (
                <span className="dim row" style={{ gap: 4 }}>
                  <CalendarIcon size={12} />
                  {formatDate(project.targetDate)}
                </span>
              )}
              <Avatar user={lead} size={18} />
            </div>
          );
        })}
      </div>
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const teams = useStore((s) => s.teams);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [teamIds, setTeamIds] = useState<string[]>(Object.keys(teams).slice(0, 1));
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [teamAnchor, setTeamAnchor] = useState<Anchor | null>(null);

  const submit = async () => {
    if (!name.trim() || teamIds.length === 0 || saving) return;
    setSaving(true);
    try {
      const project = await api.createProject({
        name,
        description,
        teamIds,
        targetDate: targetDate ? new Date(`${targetDate}T12:00:00Z`).toISOString() : null,
      });
      useStore.getState().putEntity('project', project);
      onClose();
      navigate(`/project/${project.id}`);
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} width={560}>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ fontSize: 16 }}>New project</h2>
        <div>
          <label className="field-label">Name</label>
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
          />
        </div>
        <div>
          <label className="field-label">Description</label>
          <textarea
            className="input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project about?"
          />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">Teams</label>
            <button
              className="btn"
              style={{ width: '100%', justifyContent: 'flex-start' }}
              onClick={(e) => setTeamAnchor(anchorFromEvent(e))}
            >
              {teamIds.length > 0
                ? teamIds.map((id) => teams[id]?.name ?? '?').join(', ')
                : 'Select teams'}
            </button>
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">Target date</label>
            <input
              type="date"
              className="input"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!name.trim() || teamIds.length === 0 || saving}
            onClick={() => void submit()}
          >
            Create project
          </button>
        </div>
      </div>
      {teamAnchor && (
        <Picker
          anchor={teamAnchor}
          onClose={() => setTeamAnchor(null)}
          selectedIds={new Set(teamIds)}
          items={Object.values(teams).map((t) => ({ id: t.id, label: t.name, hint: t.key }))}
          onPick={(id) =>
            setTeamIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
          }
        />
      )}
    </Modal>
  );
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const projects = useStore((s) => s.projects);
  const project = projectId ? projects[projectId] : null;
  if (!project) {
    return (
      <div className="empty-state">
        <h3>Project not found</h3>
      </div>
    );
  }
  return <ProjectDetail project={project} />;
}

function ProjectDetail({ project }: { project: Project }) {
  const issues = useStore((s) => s.issues);
  const users = useStore((s) => s.users);
  const milestones = useStore((s) => s.projectMilestones);
  const favorites = useStore((s) => s.favorites);
  const userId = useStore((s) => s.userId);
  const teams = useStore((s) => s.teams);
  const navigate = useNavigate();
  const [filters, setFilters] = useState<IssueFilters>(EMPTY_FILTERS);
  const [statusAnchor, setStatusAnchor] = useState<Anchor | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<Anchor | null>(null);
  const [milestoneName, setMilestoneName] = useState('');
  const leadPicker = usePicker();

  const projectIssues = useMemo(
    () =>
      applyFilters(
        Object.values(issues).filter((i) => i.projectId === project.id && !i.archivedAt),
        filters,
      ),
    [issues, project.id, filters],
  );
  const grouped = useGroupedIssues(projectIssues, 'state');
  const lead = project.leadId ? users[project.leadId] : null;
  const projectMilestones = Object.values(milestones)
    .filter((m) => m.projectId === project.id)
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1));
  const isFavorite = Object.values(favorites).some(
    (f) => f.userId === userId && f.type === 'project' && f.targetId === project.id,
  );

  const milestoneReorder = useDragReorder(projectMilestones, (dragged, insertAt) => {
    const sortOrder = sortKeyForInsert(projectMilestones, dragged, insertAt);
    if (!sortOrder) return;
    useStore.getState().putEntity('projectMilestone', { ...dragged, sortOrder });
    void api
      .updateMilestone(dragged.id, { sortOrder })
      .then((m) => useStore.getState().putEntity('projectMilestone', m))
      .catch(toastError);
  });

  return (
    <>
      <div className="topbar">
        <div className="title">
          <Link to="/projects" className="crumb">
            Projects
          </Link>
          <span className="crumb">›</span>
          <ProjectStatusIcon status={project.status} />
          {project.name}
        </div>
        <span className="spacer" />
        <button className="chip" onClick={(e) => setStatusAnchor(anchorFromEvent(e))}>
          <ProjectStatusIcon status={project.status} size={12} />
          {STATUS_LABELS[project.status]}
        </button>
        <button className="chip" onClick={(e) => leadPicker.open(anchorFromEvent(e))}>
          <UserIcon size={12} />
          {lead ? lead.name : 'Lead'}
        </button>
        <button
          className={`icon-btn${isFavorite ? ' active' : ''}`}
          onClick={() => void toggleFavorite('project', project.id)}
        >
          <StarIcon size={15} filled={isFavorite} />
        </button>
        <button className="icon-btn" onClick={(e) => setMenuAnchor(anchorFromEvent(e))}>
          <DotsIcon size={15} />
        </button>
      </div>

      {(project.description || projectMilestones.length > 0) && (
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          {project.description && <Markdown source={project.description} />}
          {projectMilestones.length > 0 && (
            <div style={{ marginTop: project.description ? 12 : 0 }}>
              {projectMilestones.map((m, index) => {
                const milestoneIssues = projectIssues.filter((i) => i.milestoneId === m.id);
                const done = milestoneIssues.filter((i) => i.completedAt).length;
                return (
                  <div
                    key={m.id}
                    className={`row ${milestoneReorder.insertBefore === index ? 'reorder-before' : ''} ${
                      milestoneReorder.dragId === m.id ? 'reorder-dragging' : ''
                    }`.trim()}
                    style={{ padding: '3px 0', gap: 8, cursor: 'grab' }}
                    {...milestoneReorder.rowProps(m, index)}
                  >
                    <ProjectIcon size={13} />
                    <span style={{ fontWeight: 500 }}>{m.name}</span>
                    {m.targetDate && <span className="dim">{formatDate(m.targetDate)}</span>}
                    <span className="dim">
                      {done}/{milestoneIssues.length}
                    </span>
                    <button
                      className="icon-btn"
                      style={{ width: 20, height: 20 }}
                      title="Delete milestone"
                      onClick={() => {
                        void api
                          .deleteMilestone(m.id)
                          .then(() => {
                            const next = { ...useStore.getState().projectMilestones };
                            delete next[m.id];
                            useStore.setState({ projectMilestones: next });
                          })
                          .catch(toastError);
                      }}
                    >
                      <TrashIcon size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="row" style={{ marginTop: 8, gap: 6 }}>
            <input
              className="input"
              style={{ width: 220, height: 26 }}
              placeholder="Add milestone…"
              value={milestoneName}
              onChange={(e) => setMilestoneName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && milestoneName.trim()) {
                  void api
                    .createMilestone({ projectId: project.id, name: milestoneName })
                    .then((m) => {
                      useStore.getState().putEntity('projectMilestone', m);
                      setMilestoneName('');
                    })
                    .catch(toastError);
                }
              }}
            />
          </div>
        </div>
      )}

      <ViewControls
        filters={filters}
        onFilters={setFilters}
        extra={
          <button
            className="btn ghost"
            onClick={() =>
              openNewIssue({
                teamId: project.teamIds[0],
                projectId: project.id,
              })
            }
          >
            <PlusIcon size={13} /> Add issue
          </button>
        }
      />
      <div className="content">
        <GroupedIssueList groups={grouped} grouping="state" />
      </div>

      {statusAnchor && (
        <Picker
          anchor={statusAnchor}
          onClose={() => setStatusAnchor(null)}
          searchable={false}
          selectedIds={new Set([project.status])}
          items={PROJECT_STATUSES.map((s) => ({
            id: s,
            label: STATUS_LABELS[s],
            icon: <ProjectStatusIcon status={s} size={13} />,
          }))}
          onPick={(id) => {
            void api
              .updateProject(project.id, { status: id })
              .then((p) => useStore.getState().putEntity('project', p))
              .catch(toastError);
            setStatusAnchor(null);
          }}
        />
      )}
      {leadPicker.anchor && (
        <AssigneePicker
          anchor={leadPicker.anchor}
          onClose={leadPicker.close}
          currentId={project.leadId}
          onPick={(id) => {
            void api
              .updateProject(project.id, { leadId: id })
              .then((p) => useStore.getState().putEntity('project', p))
              .catch(toastError);
          }}
        />
      )}
      {menuAnchor && (
        <Popover anchor={menuAnchor} onClose={() => setMenuAnchor(null)} width={190}>
          <button
            className="menu-item destructive"
            onClick={() => {
              setMenuAnchor(null);
              void api
                .deleteProject(project.id)
                .then(() => {
                  const next = { ...useStore.getState().projects };
                  delete next[project.id];
                  useStore.setState({ projects: next });
                  navigate('/projects');
                })
                .catch(toastError);
            }}
          >
            <TrashIcon size={14} />
            <span className="grow">Delete project</span>
          </button>
        </Popover>
      )}
    </>
  );
}
