import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import type { Project, ProjectStatus, User } from '@nonlinear/shared';
import { PROJECT_STATUSES } from '@nonlinear/shared';
import { api } from '../api.js';
import { formatDate, relativeTime, useStore } from '../store.js';
import { anchorFromEvent, Avatar, Modal, Picker, Popover, toastError, type Anchor } from '../ui.js';
import { SortableList, keyBetweenNeighbors, type SortableDrop } from '../sortable.js';
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

const HEALTH_META: Record<string, { label: string; color: string }> = {
  on_track: { label: 'On track', color: 'var(--success)' },
  at_risk: { label: 'At risk', color: 'var(--warning)' },
  off_track: { label: 'Off track', color: 'var(--danger)' },
};

/** Latest health from a project's update feed, or null. */
export function latestHealth(projectId: string): 'on_track' | 'at_risk' | 'off_track' | null {
  const updates = Object.values(useStore.getState().projectUpdates)
    .filter((u) => u.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return updates[0]?.health ?? null;
}

function HealthChip({ projectId }: { projectId: string }) {
  const projectUpdates = useStore((s) => s.projectUpdates);
  const latest = Object.values(projectUpdates)
    .filter((u) => u.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest) return null;
  const meta = HEALTH_META[latest.health]!;
  return (
    <span className="status-chip" title={`Health: ${meta.label}`} style={{ color: meta.color }}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          background: meta.color,
          display: 'inline-block',
        }}
      />
      {meta.label}
    </span>
  );
}

/** Post project health updates and show the update feed. */
function ProjectUpdatesSection({
  projectId,
  inline = false,
}: {
  projectId: string;
  inline?: boolean;
}) {
  const projectUpdates = useStore((s) => s.projectUpdates);
  const users = useStore((s) => s.users);
  const userId = useStore((s) => s.userId);
  const [health, setHealth] = useState<'on_track' | 'at_risk' | 'off_track'>('on_track');
  const [body, setBody] = useState('');
  const [expanded, setExpanded] = useState(false);

  const updates = Object.values(projectUpdates)
    .filter((u) => u.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const post = () => {
    void api
      .createProjectUpdate({ projectId, health, body })
      .then((u) => {
        useStore.getState().putEntity('projectUpdate', u);
        setBody('');
        setExpanded(false);
      })
      .catch(toastError);
  };

  return (
    <div
      style={
        inline
          ? { marginTop: 22 }
          : { padding: '10px 20px', borderBottom: '1px solid var(--border)' }
      }
    >
      {inline && <div className="side-heading">Updates</div>}
      {!expanded ? (
        <button className="btn ghost" style={{ marginLeft: -8 }} onClick={() => setExpanded(true)}>
          <PlusIcon size={13} /> Post project update
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 640 }}>
          <div className="row" style={{ gap: 6 }}>
            {(['on_track', 'at_risk', 'off_track'] as const).map((h) => (
              <button
                key={h}
                className="chip"
                style={
                  health === h
                    ? { color: HEALTH_META[h]!.color, borderColor: HEALTH_META[h]!.color }
                    : undefined
                }
                onClick={() => setHealth(h)}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    background: HEALTH_META[h]!.color,
                    display: 'inline-block',
                  }}
                />
                {HEALTH_META[h]!.label}
              </button>
            ))}
          </div>
          <textarea
            className="input"
            rows={3}
            placeholder="What changed since the last update?"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            <button className="btn ghost" onClick={() => setExpanded(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={post}>
              Post update
            </button>
          </div>
        </div>
      )}
      {updates.length > 0 && (
        <div
          style={{
            marginTop: expanded ? 12 : 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {updates.slice(0, 5).map((u) => {
            const author = users[u.authorId];
            const meta = HEALTH_META[u.health]!;
            return (
              <div key={u.id} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                <Avatar user={author} size={20} />
                <div className="grow">
                  <div className="row" style={{ gap: 6, fontSize: 12.5 }}>
                    <span style={{ fontWeight: 600 }}>{author?.name ?? 'Someone'}</span>
                    <span style={{ color: meta.color }}>{meta.label}</span>
                    <span className="dim">{relativeTime(u.createdAt)} ago</span>
                    {userId === u.authorId && (
                      <button
                        className="icon-btn"
                        style={{ width: 18, height: 18 }}
                        title="Delete update"
                        onClick={() => {
                          void api
                            .deleteProjectUpdate(u.id)
                            .then(() => {
                              const next = { ...useStore.getState().projectUpdates };
                              delete next[u.id];
                              useStore.setState({ projectUpdates: next });
                            })
                            .catch(toastError);
                        }}
                      >
                        <TrashIcon size={11} />
                      </button>
                    )}
                  </div>
                  {u.body && <Markdown source={u.body} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The context around a project: outcome/description, teams, lead, members, dates. */
function ProjectOverview({
  project,
  onMemberPicker,
}: {
  project: Project;
  onMemberPicker: (e: React.MouseEvent) => void;
}) {
  const teams = useStore((s) => s.teams);
  const users = useStore((s) => s.users);
  const issues = useStore((s) => s.issues);
  const workflowStates = useStore((s) => s.workflowStates);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.description);

  const lead = project.leadId ? users[project.leadId] : null;
  const members = project.memberIds.map((id) => users[id]).filter(Boolean) as User[];
  const projectTeams = project.teamIds.map((id) => teams[id]).filter(Boolean);
  const projectIssues = Object.values(issues).filter(
    (i) => i.projectId === project.id && !i.archivedAt,
  );
  const done = projectIssues.filter((i) => {
    const c = workflowStates[i.stateId]?.category;
    return c === 'completed' || c === 'canceled';
  }).length;
  const pct = projectIssues.length ? Math.round((done / projectIssues.length) * 100) : 0;

  const saveDescription = () => {
    setEditing(false);
    if (draft !== project.description) {
      void api
        .updateProject(project.id, { description: draft })
        .then((p) => useStore.getState().putEntity('project', p))
        .catch(toastError);
    }
  };

  return (
    <div>
      {/* description / outcome */}
      {editing ? (
        <div>
          <textarea
            className="input"
            autoFocus
            rows={Math.max(4, draft.split('\n').length + 1)}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What's the outcome? Describe the goal, scope, and context…"
          />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <button
              className="btn ghost"
              onClick={() => {
                setDraft(project.description);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button className="btn primary" onClick={saveDescription}>
              Save
            </button>
          </div>
        </div>
      ) : project.description.trim() ? (
        <div onDoubleClick={() => setEditing(true)} style={{ cursor: 'text' }}>
          <Markdown source={project.description} />
          <button className="btn ghost" style={{ marginTop: 6 }} onClick={() => setEditing(true)}>
            Edit overview
          </button>
        </div>
      ) : (
        <button
          className="btn ghost"
          style={{ color: 'var(--text-4)', marginLeft: -8 }}
          onClick={() => setEditing(true)}
        >
          Describe the outcome and context…
        </button>
      )}

      {/* progress */}
      {projectIssues.length > 0 && (
        <div className="row" style={{ gap: 10, marginTop: 16 }}>
          <div className="progress-bar" style={{ maxWidth: 240 }}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="dim">
            {done}/{projectIssues.length} issues done
          </span>
        </div>
      )}

      {/* properties: teams, lead, dates, members */}
      <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        <div>
          <div className="side-heading">Teams</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {projectTeams.map((t) => (
              <span key={t!.id} className="chip">
                <span className="team-icon" style={{ background: t!.color }}>
                  {t!.key.slice(0, 2)}
                </span>
                {t!.name}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="side-heading">Lead</div>
          {lead ? (
            <span className="chip">
              <Avatar user={lead} size={16} /> {lead.name}
            </span>
          ) : (
            <span className="muted">Unassigned</span>
          )}
        </div>
        {(project.startDate || project.targetDate) && (
          <div>
            <div className="side-heading">Dates</div>
            <span className="dim row" style={{ gap: 4 }}>
              <CalendarIcon size={12} />
              {project.startDate ? formatDate(project.startDate) : '—'} →{' '}
              {project.targetDate ? formatDate(project.targetDate) : '—'}
            </span>
          </div>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="side-heading">Members</div>
        <div className="row" style={{ gap: 4 }}>
          {members.map((m) => (
            <Avatar key={m.id} user={m} size={24} />
          ))}
          <button
            className="icon-btn"
            style={{ width: 24, height: 24 }}
            title="Add member"
            onClick={onMemberPicker}
          >
            <PlusIcon size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Documents owned by this project, creatable in-context. */
function ProjectDocuments({ projectId }: { projectId: string }) {
  const documents = useStore((s) => s.documents);
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const docs = Object.values(documents)
    .filter((d) => d.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const create = () => {
    if (!title.trim()) return;
    void api
      .createDocument({ title, projectId })
      .then((doc) => {
        useStore.getState().putEntity('document', doc);
        setTitle('');
        navigate(`/document/${doc.id}`);
      })
      .catch(toastError);
  };

  return (
    <div style={{ marginTop: 22 }}>
      <div className="side-heading">Documents</div>
      {docs.map((doc) => (
        <div
          key={doc.id}
          className="row"
          style={{ padding: '4px 0', gap: 8, cursor: 'pointer' }}
          onClick={() => navigate(`/document/${doc.id}`)}
        >
          <ProjectIcon size={13} />
          <span style={{ fontWeight: 500 }}>{doc.title}</span>
          <span className="dim">edited {relativeTime(doc.updatedAt)} ago</span>
        </div>
      ))}
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <input
          className="input"
          style={{ width: 240, height: 26 }}
          placeholder="New document in this project…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create();
          }}
        />
        <button className="btn" disabled={!title.trim()} onClick={create}>
          <PlusIcon size={13} /> Add
        </button>
      </div>
    </div>
  );
}

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
  const { teamKey } = useParams<{ teamKey?: string }>();
  const projects = useStore((s) => s.projects);
  const teams = useStore((s) => s.teams);
  const issues = useStore((s) => s.issues);
  const workflowStates = useStore((s) => s.workflowStates);
  const users = useStore((s) => s.users);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const team = teamKey ? Object.values(teams).find((t) => t.key === teamKey) : null;

  const rows = useMemo(
    () =>
      Object.values(projects)
        .filter((p) => !team || p.teamIds.includes(team.id))
        .sort(
          (a, b) =>
            PROJECT_STATUSES.indexOf(a.status) - PROJECT_STATUSES.indexOf(b.status) ||
            (a.sortOrder < b.sortOrder ? -1 : 1),
        ),
    [projects, team],
  );

  return (
    <>
      <div className="topbar">
        <div className="title">
          <ProjectIcon size={16} />
          {team ? `${team.name} · Projects` : 'Projects'}
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
            <p>
              Projects are larger units of work with a clear outcome, like a feature you want to
              ship. They span multiple teams and are made of issues and their own documents.
            </p>
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
              <HealthChip projectId={project.id} />
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
      {creating && (
        <NewProjectDialog onClose={() => setCreating(false)} defaultTeamId={team?.id} />
      )}
    </>
  );
}

function NewProjectDialog({
  onClose,
  defaultTeamId,
}: {
  onClose: () => void;
  defaultTeamId?: string;
}) {
  const teams = useStore((s) => s.teams);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [teamIds, setTeamIds] = useState<string[]>(
    defaultTeamId ? [defaultTeamId] : Object.keys(teams).slice(0, 1),
  );
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
  const [tab, setTab] = useState<'overview' | 'issues'>('overview');
  const [filters, setFilters] = useState<IssueFilters>(EMPTY_FILTERS);
  const [statusAnchor, setStatusAnchor] = useState<Anchor | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<Anchor | null>(null);
  const [milestoneName, setMilestoneName] = useState('');
  const leadPicker = usePicker();
  const memberPicker = usePicker();

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

  const milestonesById = Object.fromEntries(projectMilestones.map((m) => [m.id, m]));
  const handleMilestoneDrop = (drop: SortableDrop) => {
    const milestone = milestonesById[drop.id];
    const sortOrder = keyBetweenNeighbors(milestonesById, drop);
    if (!milestone || !sortOrder) return;
    useStore.getState().putEntity('projectMilestone', { ...milestone, sortOrder });
    void api
      .updateMilestone(drop.id, { sortOrder })
      .then((m) => useStore.getState().putEntity('projectMilestone', m))
      .catch(toastError);
  };

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
        <div className="row" style={{ gap: 2, marginLeft: 12 }}>
          {(['overview', 'issues'] as const).map((t) => (
            <button
              key={t}
              className="btn ghost"
              style={
                tab === t ? { background: 'var(--bg-active)', color: 'var(--text-1)' } : undefined
              }
              onClick={() => setTab(t)}
            >
              {t === 'overview' ? 'Overview' : 'Issues'}
            </button>
          ))}
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
        <HealthChip projectId={project.id} />
        <button className="icon-btn" onClick={(e) => setMenuAnchor(anchorFromEvent(e))}>
          <DotsIcon size={15} />
        </button>
      </div>

      {tab === 'overview' && (
        <div className="content">
          <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 24px 60px' }}>
            <ProjectOverview
              project={project}
              onMemberPicker={(e) => memberPicker.open(anchorFromEvent(e))}
            />
            <ProjectUpdatesSection projectId={project.id} inline />
            <ProjectDocuments projectId={project.id} />
            <div className="milestones-block" style={{ marginTop: 22 }}>
              <div className="side-heading">Milestones</div>
              {projectMilestones.length === 0 && (
                <div className="muted" style={{ fontSize: 12.5 }}>
                  No milestones yet.
                </div>
              )}
              {projectMilestones.length > 0 && (
                <SortableList
                  sortGroup="milestones"
                  onDrop={handleMilestoneDrop}
                  style={{ marginTop: project.description ? 12 : 0 }}
                >
                  {projectMilestones.map((m) => {
                    const milestoneIssues = projectIssues.filter((i) => i.milestoneId === m.id);
                    const done = milestoneIssues.filter((i) => i.completedAt).length;
                    return (
                      <div
                        key={m.id}
                        data-sort-id={m.id}
                        className="row"
                        style={{ padding: '3px 0', gap: 8, cursor: 'grab' }}
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
                </SortableList>
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
          </div>
        </div>
      )}

      {tab === 'issues' && (
        <>
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
        </>
      )}

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
      {memberPicker.anchor && (
        <Picker
          anchor={memberPicker.anchor}
          onClose={memberPicker.close}
          placeholder="Add member…"
          items={Object.values(users)
            .filter((u) => u.active && !u.isAgent)
            .map((u) => ({ id: u.id, label: u.name }))}
          selectedIds={new Set(project.memberIds)}
          onPick={(id) => {
            const memberIds = project.memberIds.includes(id)
              ? project.memberIds.filter((m) => m !== id)
              : [...project.memberIds, id];
            void api
              .updateProject(project.id, { memberIds })
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
