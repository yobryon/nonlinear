import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import type { StateCategory, Team, WorkflowState } from '@nonlinear/shared';
import { STATE_CATEGORIES } from '@nonlinear/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import {
  anchorFromEvent,
  Avatar,
  Picker,
  Switch,
  toast,
  toastError,
  useDragReorder,
  type Anchor,
} from '../ui.js';
import { ArrowLeftIcon, PlusIcon, StateIcon, TrashIcon } from '../icons.js';

const SWATCHES = [
  '#5e6ad2',
  '#26b5ce',
  '#0f7488',
  '#4cb782',
  '#f2c94c',
  '#f2994a',
  '#f7855b',
  '#eb5757',
  '#c052d5',
  '#95a2b3',
];

export function SettingsPage() {
  return (
    <div className="settings-layout">
      <div className="settings-nav">
        <NavLink to="/" className="side-item" style={{ marginBottom: 14 }}>
          <ArrowLeftIcon size={14} />
          <span className="grow">Back to app</span>
        </NavLink>
        <div className="side-section-header">Workspace</div>
        <NavLink
          to="/settings/workspace"
          className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
        >
          <span className="grow">General</span>
        </NavLink>
        <NavLink
          to="/settings/members"
          className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
        >
          <span className="grow">Members</span>
        </NavLink>
        <NavLink
          to="/settings/teams"
          className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
        >
          <span className="grow">Teams</span>
        </NavLink>
        <NavLink
          to="/settings/labels"
          className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
        >
          <span className="grow">Labels</span>
        </NavLink>
        <div className="side-section-header" style={{ marginTop: 14 }}>
          Account
        </div>
        <NavLink
          to="/settings/profile"
          className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
        >
          <span className="grow">Profile</span>
        </NavLink>
      </div>
      <div className="settings-content">
        <div className="container">
          <Routes>
            <Route path="workspace" element={<WorkspaceSettings />} />
            <Route path="members" element={<MembersSettings />} />
            <Route path="teams" element={<TeamsSettings />} />
            <Route path="team/:teamKey" element={<TeamSettings />} />
            <Route path="labels" element={<LabelsSettings />} />
            <Route path="profile" element={<ProfileSettings />} />
            <Route path="*" element={<Navigate to="/settings/workspace" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function WorkspaceSettings() {
  const workspace = useStore((s) => s.workspace);
  const [name, setName] = useState(workspace?.name ?? '');
  return (
    <>
      <h1>Workspace</h1>
      <p className="subtitle">Manage your workspace settings.</p>
      <div className="settings-section">
        <h2>General</h2>
        <label className="field-label">Workspace name</label>
        <div className="row" style={{ gap: 8, maxWidth: 420 }}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            className="btn primary"
            disabled={!name.trim() || name === workspace?.name}
            onClick={() => {
              void api
                .updateWorkspace(name)
                .then((ws) => {
                  useStore.setState({ workspace: ws });
                  toast('Workspace updated', 'success');
                })
                .catch(toastError);
            }}
          >
            Save
          </button>
        </div>
      </div>
      <div className="settings-section">
        <h2>Invites</h2>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Anyone who can reach this server can create an account from the login screen and will
          automatically join every non-private team. Share the app URL to invite teammates.
        </p>
      </div>
      <WebhooksSection />
      <div className="settings-section">
        <h2>GitHub integration</h2>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
          Point a GitHub repository webhook (pull request events, JSON) at{' '}
          <code>/api/integrations/github</code> and set the same secret in the server’s{' '}
          <code>GITHUB_WEBHOOK_SECRET</code> environment variable. PRs referencing an issue key — in
          the branch name (<code>ada/eng-42-fix</code>) or with magic words (
          <code>Fixes ENG-42</code>) — get linked as comments, and merging moves the issue to Done.
        </p>
      </div>
    </>
  );
}

function WebhooksSection() {
  const webhooks = useStore((s) => s.webhooks);
  const me = useStore((s) => (s.userId ? s.users[s.userId] : null));
  const [url, setUrl] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  if (me?.role !== 'admin') return null;
  const rows = Object.values(webhooks).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="settings-section">
      <h2>Webhooks</h2>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Issue, comment, and project events are POSTed as JSON with an{' '}
        <code>X-Nonlinear-Secret</code> header.
      </p>
      {rows.map((webhook) => (
        <div key={webhook.id} className="member-row">
          <div className="info">
            <div className="truncate">{webhook.url}</div>
            <div className="email">
              {webhook.enabled ? 'enabled' : 'disabled'} · secret:{' '}
              {revealed === webhook.id ? (
                <code>{webhook.secret}</code>
              ) : (
                <button
                  style={{ color: 'var(--accent-text)' }}
                  onClick={() => setRevealed(webhook.id)}
                >
                  reveal
                </button>
              )}
            </div>
          </div>
          <Switch
            on={webhook.enabled}
            onChange={(on) => {
              void api
                .setWebhookEnabled(webhook.id, on)
                .then((w) => useStore.getState().putEntity('webhook', w))
                .catch(toastError);
            }}
          />
          <button
            className="icon-btn"
            title="Delete webhook"
            onClick={() => {
              void api
                .deleteWebhook(webhook.id)
                .then(() => {
                  const next = { ...useStore.getState().webhooks };
                  delete next[webhook.id];
                  useStore.setState({ webhooks: next });
                })
                .catch(toastError);
            }}
          >
            <TrashIcon size={13} />
          </button>
        </div>
      ))}
      <div className="row" style={{ gap: 8, marginTop: 10, maxWidth: 480 }}>
        <input
          className="input"
          placeholder="https://example.com/webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="btn"
          disabled={!url.trim()}
          onClick={() => {
            void api
              .createWebhook(url.trim())
              .then((w) => {
                useStore.getState().putEntity('webhook', w);
                setUrl('');
              })
              .catch(toastError);
          }}
        >
          <PlusIcon size={13} /> Add
        </button>
      </div>
    </div>
  );
}

function MembersSettings() {
  const users = useStore((s) => s.users);
  const me = useStore((s) => (s.userId ? s.users[s.userId] : null));
  const [roleAnchor, setRoleAnchor] = useState<{ anchor: Anchor; userId: string } | null>(null);
  const isAdmin = me?.role === 'admin';
  const rows = Object.values(users).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <h1>Members</h1>
      <p className="subtitle">
        {rows.filter((u) => u.active).length} active member
        {rows.filter((u) => u.active).length === 1 ? '' : 's'}
      </p>
      <div className="settings-section">
        {rows.map((user) => (
          <div key={user.id} className="member-row">
            <Avatar user={user} size={26} />
            <div className="info">
              <div>
                {user.name}
                {!user.active && <span className="dim"> (deactivated)</span>}
              </div>
              <div className="email">
                {user.email} · @{user.displayName}
              </div>
            </div>
            {isAdmin && user.id !== me?.id ? (
              <>
                <button
                  className="chip"
                  onClick={(e) => setRoleAnchor({ anchor: anchorFromEvent(e), userId: user.id })}
                >
                  {user.role}
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    void api
                      .adminUpdateUser(user.id, { active: !user.active })
                      .then((u) => useStore.getState().putEntity('user', u))
                      .catch(toastError);
                  }}
                >
                  {user.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </>
            ) : (
              <span className="chip">{user.role}</span>
            )}
          </div>
        ))}
      </div>
      {roleAnchor && (
        <Picker
          anchor={roleAnchor.anchor}
          onClose={() => setRoleAnchor(null)}
          searchable={false}
          items={[
            { id: 'admin', label: 'Admin' },
            { id: 'member', label: 'Member' },
            { id: 'guest', label: 'Guest' },
          ]}
          onPick={(role) => {
            void api
              .adminUpdateUser(roleAnchor.userId, { role })
              .then((u) => useStore.getState().putEntity('user', u))
              .catch(toastError);
            setRoleAnchor(null);
          }}
        />
      )}
    </>
  );
}

function TeamsSettings() {
  const teams = useStore((s) => s.teams);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');

  const create = async () => {
    if (!name.trim() || !key.trim()) return;
    try {
      const team = await api.createTeam({ name, key });
      useStore.getState().putEntity('team', team);
      toast(`Team ${team.name} created`, 'success');
      setName('');
      setKey('');
      navigate(`/settings/team/${team.key}`);
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <h1>Teams</h1>
      <p className="subtitle">Teams own issues, workflows, and cycles.</p>
      <div className="settings-section">
        {Object.values(teams)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((team) => (
            <div
              key={team.id}
              className="member-row"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/settings/team/${team.key}`)}
            >
              <span
                className="team-icon"
                style={{ background: team.color, width: 22, height: 22, fontSize: 10 }}
              >
                {team.key.slice(0, 2)}
              </span>
              <div className="info">
                <div>{team.name}</div>
                <div className="email">
                  {team.key} ·{' '}
                  {team.cyclesEnabled ? `${team.cycleDurationWeeks}w cycles` : 'cycles off'}
                </div>
              </div>
            </div>
          ))}
      </div>
      <div className="settings-section">
        <h2>Create team</h2>
        <div className="row" style={{ gap: 8, maxWidth: 480 }}>
          <input
            className="input"
            placeholder="Team name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!key || key === autoKey(name)) setKey(autoKey(e.target.value));
            }}
          />
          <input
            className="input"
            style={{ width: 90 }}
            placeholder="KEY"
            value={key}
            maxLength={7}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
          />
          <button
            className="btn primary"
            disabled={!name.trim() || !key.trim()}
            onClick={() => void create()}
          >
            Create
          </button>
        </div>
      </div>
    </>
  );
}

function autoKey(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
      .slice(0, 3) || name.slice(0, 3).toUpperCase()
  );
}

function TeamSettings() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const teams = useStore((s) => s.teams);
  const team = Object.values(teams).find((t) => t.key === teamKey);
  if (!team) {
    return (
      <div className="empty-state">
        <h3>Team not found</h3>
      </div>
    );
  }
  return <TeamSettingsInner key={team.id} team={team} />;
}

function TeamSettingsInner({ team }: { team: Team }) {
  const states = useStore((s) => s.workflowStates);
  const users = useStore((s) => s.users);
  const memberships = useStore((s) => s.teamMemberships);
  const navigate = useNavigate();
  const [name, setName] = useState(team.name);
  const [key, setKey] = useState(team.key);
  const [newState, setNewState] = useState('');
  const [newStateCategory, setNewStateCategory] = useState<StateCategory>('unstarted');
  const [memberAnchor, setMemberAnchor] = useState<Anchor | null>(null);

  const teamStates = Object.values(states)
    .filter((s) => s.teamId === team.id)
    .sort(
      (a, b) =>
        STATE_CATEGORIES.indexOf(a.category) - STATE_CATEGORIES.indexOf(b.category) ||
        a.position - b.position,
    );
  const teamMembers = Object.values(memberships).filter((m) => m.teamId === team.id);
  const memberIds = new Set(teamMembers.map((m) => m.userId));

  // Reorder workflow states by dragging; moves stay within the state's category.
  const stateReorder = useDragReorder(teamStates, (dragged, insertAt) => {
    const siblings = teamStates.filter((s) => s.category === dragged.category);
    const fromSib = siblings.findIndex((s) => s.id === dragged.id);
    let toSib = teamStates.slice(0, insertAt).filter((s) => s.category === dragged.category).length;
    const without = siblings.filter((s) => s.id !== dragged.id);
    if (fromSib < toSib) toSib -= 1;
    toSib = Math.max(0, Math.min(without.length, toSib));
    without.splice(toSib, 0, dragged);
    without.forEach((state, position) => {
      if (state.position === position) return;
      useStore.getState().putEntity('workflowState', { ...state, position });
      void api
        .updateState(state.id, { position })
        .then((s) => useStore.getState().putEntity('workflowState', s))
        .catch(toastError);
    });
  });

  const patchTeam = (patch: Record<string, unknown>) => {
    void api
      .updateTeam(team.id, patch)
      .then((t) => useStore.getState().putEntity('team', t))
      .catch(toastError);
  };

  return (
    <>
      <h1>{team.name}</h1>
      <p className="subtitle">Team settings, workflow, and members.</p>

      <div className="settings-section">
        <h2>General</h2>
        <div className="row" style={{ gap: 8, maxWidth: 480, marginBottom: 12 }}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="input"
            style={{ width: 90 }}
            value={key}
            maxLength={7}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
          />
          <button
            className="btn primary"
            disabled={(name === team.name && key === team.key) || !name.trim() || !key.trim()}
            onClick={() => {
              patchTeam({ name, key });
              if (key !== team.key) navigate(`/settings/team/${key}`, { replace: true });
            }}
          >
            Save
          </button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {SWATCHES.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => patchTeam({ color: c })}
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                background: c,
                border: team.color === c ? '2px solid var(--text-1)' : '2px solid transparent',
              }}
            />
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h2>Cycles</h2>
        <div className="setting-row">
          <div className="info">
            <div className="label">Enable cycles</div>
            <div className="desc">Time-boxed iterations, created automatically on a cadence.</div>
          </div>
          <Switch on={team.cyclesEnabled} onChange={(on) => patchTeam({ cyclesEnabled: on })} />
        </div>
        {team.cyclesEnabled && (
          <div className="setting-row">
            <div className="info">
              <div className="label">Cycle length</div>
            </div>
            <div className="row" style={{ gap: 4 }}>
              {[1, 2, 3, 4].map((w) => (
                <button
                  key={w}
                  className="btn ghost"
                  style={
                    team.cycleDurationWeeks === w
                      ? { background: 'var(--bg-active)', color: 'var(--text-1)' }
                      : undefined
                  }
                  onClick={() => patchTeam({ cycleDurationWeeks: w })}
                >
                  {w}w
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <h2>Triage</h2>
        <div className="setting-row">
          <div className="info">
            <div className="label">Enable triage</div>
            <div className="desc">
              New issues land in a Triage state for review before planning.
            </div>
          </div>
          <Switch on={team.triageEnabled} onChange={(on) => patchTeam({ triageEnabled: on })} />
        </div>
      </div>

      <div className="settings-section">
        <h2>SLAs</h2>
        <div className="setting-row">
          <div className="info">
            <div className="label">Urgent issues</div>
            <div className="desc">Auto-set a due date this many hours after creation.</div>
          </div>
          <SlaHoursInput
            value={team.slaUrgentHours}
            onChange={(hours) => patchTeam({ slaUrgentHours: hours })}
          />
        </div>
        <div className="setting-row">
          <div className="info">
            <div className="label">High-priority issues</div>
          </div>
          <SlaHoursInput
            value={team.slaHighHours}
            onChange={(hours) => patchTeam({ slaHighHours: hours })}
          />
        </div>
      </div>

      <div className="settings-section">
        <h2>Workflow states</h2>
        {teamStates.map((state, index) => (
          <div
            key={state.id}
            className={`${stateReorder.insertBefore === index ? 'reorder-before' : ''} ${
              stateReorder.dragId === state.id ? 'reorder-dragging' : ''
            }`.trim()}
            {...stateReorder.itemProps(index)}
          >
            <WorkflowStateRow
              state={state}
              dragHandle={
                <span
                  className="drag-handle"
                  title="Drag to reorder"
                  {...stateReorder.dragProps(state, state.name)}
                >
                  ⋮⋮
                </span>
              }
            />
          </div>
        ))}
        <div className="row" style={{ gap: 8, marginTop: 10, maxWidth: 480 }}>
          <input
            className="input"
            placeholder="New state name"
            value={newState}
            onChange={(e) => setNewState(e.target.value)}
          />
          <select
            className="input"
            style={{ width: 130 }}
            value={newStateCategory}
            onChange={(e) => setNewStateCategory(e.target.value as StateCategory)}
          >
            {STATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            className="btn"
            disabled={!newState.trim()}
            onClick={() => {
              void api
                .createState({
                  teamId: team.id,
                  name: newState,
                  color: SWATCHES[Math.floor(Math.random() * SWATCHES.length)]!,
                  category: newStateCategory,
                })
                .then((s) => {
                  useStore.getState().putEntity('workflowState', s);
                  setNewState('');
                })
                .catch(toastError);
            }}
          >
            <PlusIcon size={13} /> Add
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h2>Members</h2>
        {teamMembers.map((m) => {
          const user = users[m.userId];
          if (!user) return null;
          return (
            <div key={m.id} className="member-row">
              <Avatar user={user} size={24} />
              <div className="info">
                <div>{user.name}</div>
              </div>
              <button
                className="btn ghost"
                onClick={() => {
                  void api.removeTeamMember(team.id, user.id).catch(toastError);
                }}
              >
                Remove
              </button>
            </div>
          );
        })}
        <button
          className="btn"
          style={{ marginTop: 10 }}
          onClick={(e) => setMemberAnchor(anchorFromEvent(e))}
        >
          <PlusIcon size={13} /> Add member
        </button>
      </div>

      <div className="settings-section">
        <h2>Danger zone</h2>
        <button
          className="btn danger"
          onClick={() => {
            if (!confirm(`Delete team ${team.name}? Its issues must be moved or deleted first.`))
              return;
            void api
              .deleteTeam(team.id)
              .then(() => {
                const next = { ...useStore.getState().teams };
                delete next[team.id];
                useStore.setState({ teams: next });
                navigate('/settings/teams');
              })
              .catch(toastError);
          }}
        >
          <TrashIcon size={13} /> Delete team
        </button>
      </div>

      {memberAnchor && (
        <Picker
          anchor={memberAnchor}
          onClose={() => setMemberAnchor(null)}
          placeholder="Add member…"
          items={Object.values(users)
            .filter((u) => u.active && !memberIds.has(u.id))
            .map((u) => ({ id: u.id, label: u.name }))}
          onPick={(userId) => {
            void api
              .addTeamMember(team.id, userId)
              .then((m) => useStore.getState().putEntity('teamMembership', m))
              .catch(toastError);
            setMemberAnchor(null);
          }}
        />
      )}
    </>
  );
}

function SlaHoursInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (hours: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  return (
    <div className="row" style={{ gap: 6 }}>
      <input
        className="input"
        style={{ width: 80, height: 26 }}
        type="number"
        min={1}
        max={720}
        placeholder="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const parsed = draft.trim() === '' ? null : Math.max(1, Number(draft));
          onChange(Number.isNaN(parsed as number) ? null : parsed);
        }}
      />
      <span className="dim">hours</span>
    </div>
  );
}

function WorkflowStateRow({
  state,
  dragHandle,
}: {
  state: WorkflowState;
  dragHandle?: React.ReactNode;
}) {
  const [name, setName] = useState(state.name);
  return (
    <div className="member-row">
      {dragHandle}
      <StateIcon category={state.category} color={state.color} />
      <input
        className="input"
        style={{ maxWidth: 220, height: 26 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name !== state.name) {
            void api
              .updateState(state.id, { name })
              .then((s) => useStore.getState().putEntity('workflowState', s))
              .catch(toastError);
          }
        }}
      />
      <span className="dim">{state.category}</span>
      <span className="grow" />
      <button
        className="icon-btn"
        title="Delete state"
        onClick={() => {
          void api
            .deleteState(state.id)
            .then(() => {
              const next = { ...useStore.getState().workflowStates };
              delete next[state.id];
              useStore.setState({ workflowStates: next });
            })
            .catch(toastError);
        }}
      >
        <TrashIcon size={13} />
      </button>
    </div>
  );
}

function LabelsSettings() {
  const labels = useStore((s) => s.labels);
  const teams = useStore((s) => s.teams);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0]!);
  const [teamId, setTeamId] = useState<string>('');

  const rows = Object.values(labels).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <h1>Labels</h1>
      <p className="subtitle">Workspace and team labels for categorizing issues.</p>
      <div className="settings-section">
        {rows.map((label) => (
          <div key={label.id} className="member-row">
            <span style={{ width: 12, height: 12, borderRadius: 6, background: label.color }} />
            <div className="info">
              <div>{label.name}</div>
              <div className="email">
                {label.teamId ? (teams[label.teamId]?.name ?? 'team') : 'Workspace'}
              </div>
            </div>
            <button
              className="icon-btn"
              onClick={() => {
                void api
                  .deleteLabel(label.id)
                  .then(() => {
                    const next = { ...useStore.getState().labels };
                    delete next[label.id];
                    useStore.setState({ labels: next });
                  })
                  .catch(toastError);
              }}
            >
              <TrashIcon size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="settings-section">
        <h2>Create label</h2>
        <div className="row" style={{ gap: 8, maxWidth: 560, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ width: 180 }}
            placeholder="Label name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="input"
            style={{ width: 160 }}
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
          >
            <option value="">Workspace</option>
            {Object.values(teams).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <div className="row" style={{ gap: 4 }}>
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  background: c,
                  border: color === c ? '2px solid var(--text-1)' : '2px solid transparent',
                }}
              />
            ))}
          </div>
          <button
            className="btn primary"
            disabled={!name.trim()}
            onClick={() => {
              void api
                .createLabel({ name, color, teamId: teamId || null })
                .then((l) => {
                  useStore.getState().putEntity('label', l);
                  setName('');
                })
                .catch(toastError);
            }}
          >
            Create
          </button>
        </div>
      </div>
    </>
  );
}

function ProfileSettings() {
  const me = useStore((s) => (s.userId ? s.users[s.userId] : null));
  const [name, setName] = useState(me?.name ?? '');
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  if (!me) return null;
  return (
    <>
      <h1>Profile</h1>
      <p className="subtitle">{me.email}</p>
      <div className="settings-section">
        <div className="row" style={{ gap: 16, marginBottom: 16 }}>
          <Avatar user={me} size={48} />
          <div className="row" style={{ gap: 4 }}>
            {SWATCHES.map((c) => (
              <button
                key={c}
                title="Avatar color"
                onClick={() => {
                  void api
                    .updateProfile({ avatarColor: c })
                    .then((u) => useStore.getState().putEntity('user', u))
                    .catch(toastError);
                }}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  background: c,
                  border:
                    me.avatarColor === c ? '2px solid var(--text-1)' : '2px solid transparent',
                }}
              />
            ))}
          </div>
        </div>
        <label className="field-label">Full name</label>
        <input
          className="input"
          style={{ maxWidth: 320, marginBottom: 12 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="field-label">Display name (for @mentions)</label>
        <input
          className="input"
          style={{ maxWidth: 320, marginBottom: 14 }}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value.toLowerCase())}
        />
        <div>
          <button
            className="btn primary"
            disabled={name === me.name && displayName === me.displayName}
            onClick={() => {
              void api
                .updateProfile({ name, displayName })
                .then((u) => {
                  useStore.getState().putEntity('user', u);
                  toast('Profile updated', 'success');
                })
                .catch(toastError);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}
