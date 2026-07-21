import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import type {
  AiSettingsPublic,
  AuditEvent,
  Invite,
  StateCategory,
  Team,
  UpdateAiSettingsInput,
  WorkflowState,
} from '@nonlinear/shared';
import { ESTIMATE_SCALES, STATE_CATEGORIES } from '@nonlinear/shared';
import { TemplatesSettings } from '../components/TemplatesSettings.js';
import { TriageRulesSettings } from '../components/TriageRulesSettings.js';
import { NotificationPrefs } from '../components/NotificationPrefs.js';
import { IntakeSettings } from '../components/IntakeSettings.js';
import { ImportExport } from '../components/ImportExport.js';
import { ApiTokens } from '../components/ApiTokens.js';
import { applyPreferences } from '../preferences.js';
import { api } from '../api.js';
import { relativeTime, useStore } from '../store.js';
import { anchorFromEvent, Avatar, Picker, Switch, toast, toastError, type Anchor } from '../ui.js';
import { SortableList, type SortableDrop } from '../sortable.js';
import { ArrowLeftIcon, MenuIcon, PlusIcon, StateIcon, TrashIcon } from '../icons.js';

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
  const [navOpen, setNavOpen] = useState(false);
  const isAdmin = useStore((s) => (s.userId ? s.users[s.userId]?.role === 'admin' : false));
  const link = (to: string, label: string) => (
    <NavLink
      to={to}
      onClick={() => setNavOpen(false)}
      className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
    >
      <span className="grow">{label}</span>
    </NavLink>
  );
  return (
    <div className="settings-layout">
      <div className={`settings-nav${navOpen ? ' open' : ''}`}>
        <NavLink
          to="/"
          className="side-item"
          style={{ marginBottom: 14 }}
          onClick={() => setNavOpen(false)}
        >
          <ArrowLeftIcon size={14} />
          <span className="grow">Back to app</span>
        </NavLink>
        <div className="side-section-header">Personal</div>
        {link('/settings/preferences', 'Preferences')}
        {link('/settings/profile', 'Profile')}
        {link('/settings/notifications', 'Notifications')}
        {link('/settings/tokens', 'API tokens')}
        <div className="side-section-header" style={{ marginTop: 14 }}>
          Workspace
        </div>
        {link('/settings/workspace', 'General')}
        {link('/settings/members', 'Members')}
        {link('/settings/teams', 'Teams')}
        {link('/settings/labels', 'Labels')}
        {isAdmin && link('/settings/ai', 'AI')}
        {isAdmin && link('/settings/audit', 'Audit log')}
      </div>
      <div className="settings-content">
        <button className="btn ghost settings-nav-toggle" onClick={() => setNavOpen((v) => !v)}>
          <MenuIcon size={16} /> Settings menu
        </button>
        <div className="container">
          <Routes>
            <Route path="preferences" element={<PreferencesSettings />} />
            <Route path="profile" element={<ProfileSettings />} />
            <Route path="notifications" element={<NotificationsSettings />} />
            <Route path="tokens" element={<TokensSettings />} />
            <Route path="workspace" element={<WorkspaceSettings />} />
            <Route path="members" element={<MembersSettings />} />
            <Route path="teams" element={<TeamsSettings />} />
            <Route path="team/:teamKey" element={<TeamSettings />} />
            <Route path="labels" element={<LabelsSettings />} />
            <Route path="ai" element={<AiSettings />} />
            <Route path="audit" element={<AuditSettings />} />
            <Route path="*" element={<Navigate to="/settings/preferences" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function PreferencesSettings() {
  const me = useStore((s) => (s.userId ? s.users[s.userId] : null));
  if (!me) return null;
  const prefs = me.preferences;
  const set = (patch: Partial<typeof prefs>) => {
    // Merge over the latest stored prefs (not the render closure) so rapid,
    // successive changes can't clobber each other.
    const live = useStore.getState().users[me.id]?.preferences ?? prefs;
    const next = { ...live, ...patch };
    useStore.getState().putEntity('user', { ...me, preferences: next });
    applyPreferences(next);
    void api.updateProfile({ preferences: patch }).catch(toastError);
  };
  const row = (label: string, desc: string, control: React.ReactNode) => (
    <div className="setting-row">
      <div className="info">
        <div className="label">{label}</div>
        <div className="desc">{desc}</div>
      </div>
      {control}
    </div>
  );
  const select = <T extends string>(
    value: T,
    options: Array<{ value: T; label: string }>,
    onChange: (v: T) => void,
  ) => (
    <select
      className="input"
      style={{ width: 170 }}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  return (
    <>
      <h1>Preferences</h1>
      <p className="subtitle">Personal settings that follow you across devices.</p>
      <div className="settings-section">
        <h2>General</h2>
        {row(
          'Default home view',
          'Which screen opens when you launch nonlinear.',
          select(
            prefs.home,
            [
              { value: 'my-issues', label: 'My Issues' },
              { value: 'inbox', label: 'Inbox' },
              { value: 'active-team', label: 'Team issues' },
            ],
            (home) => set({ home }),
          ),
        )}
        {row(
          'Display names',
          'How teammates are named across the interface.',
          select(
            prefs.displayNames,
            [
              { value: 'full', label: 'Full name' },
              { value: 'display', label: '@handle' },
            ],
            (displayNames) => set({ displayNames }),
          ),
        )}
        {row(
          'First day of the week',
          'Used for week grouping in insights and date pickers.',
          select(
            prefs.firstDayOfWeek,
            [
              { value: 'monday', label: 'Monday' },
              { value: 'sunday', label: 'Sunday' },
            ],
            (firstDayOfWeek) => set({ firstDayOfWeek }),
          ),
        )}
      </div>
      <div className="settings-section">
        <h2>Interface</h2>
        {row(
          'Theme',
          'Follow your system, or pick light or dark.',
          select(
            prefs.theme,
            [
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ],
            (theme) => set({ theme }),
          ),
        )}
        {row(
          'Font size',
          'Scale text across the whole app.',
          select(
            prefs.fontSize,
            [
              { value: 'small', label: 'Small' },
              { value: 'default', label: 'Default' },
              { value: 'large', label: 'Large' },
            ],
            (fontSize) => set({ fontSize }),
          ),
        )}
      </div>
    </>
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
  const users = useStore((s) => s.users);
  const me = useStore((s) => (s.userId ? s.users[s.userId] : null));
  const [url, setUrl] = useState('');
  const [agentUserId, setAgentUserId] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  if (me?.role !== 'admin') return null;
  const rows = Object.values(webhooks).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const agents = Object.values(users).filter((u) => u.isAgent && u.active);

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
            <div className="truncate">
              {webhook.url}
              {webhook.agentUserId && (
                <span className="chip" style={{ marginLeft: 6, height: 18 }}>
                  agent: {users[webhook.agentUserId]?.displayName ?? '?'}
                </span>
              )}
            </div>
            <div className="email">
              {webhook.format === 'slack' ? 'Slack format' : 'JSON'} ·{' '}
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
      <div className="row" style={{ gap: 8, marginTop: 10, maxWidth: 560, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ minWidth: 220, flex: 1 }}
          placeholder="https://example.com/webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {agents.length > 0 && (
          <select
            className="input"
            style={{ width: 170 }}
            value={agentUserId}
            onChange={(e) => setAgentUserId(e.target.value)}
            title="Scope to an agent's assignments and mentions"
          >
            <option value="">All events</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                For {a.displayName}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn"
          disabled={!url.trim()}
          onClick={() => {
            void api
              .createWebhook(url.trim(), 'json', agentUserId || null)
              .then((w) => {
                useStore.getState().putEntity('webhook', w);
                setUrl('');
                setAgentUserId('');
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

  const [agentName, setAgentName] = useState('');

  return (
    <>
      <h1>Members</h1>
      <p className="subtitle">
        {rows.filter((u) => u.active).length} active member
        {rows.filter((u) => u.active).length === 1 ? '' : 's'}
      </p>
      {isAdmin && <InvitePeople />}
      <div className="settings-section">
        {rows.map((user) => (
          <div key={user.id} className="member-row">
            <Avatar user={user} size={26} />
            <div className="info">
              <div>
                {user.name}
                {user.isAgent && (
                  <span
                    className="chip"
                    style={{ marginLeft: 6, height: 18, color: 'var(--accent-text)' }}
                  >
                    agent
                  </span>
                )}
                {!user.active && <span className="dim"> (deactivated)</span>}
              </div>
              <div className="email">
                {user.isAgent ? 'API-driven teammate' : user.email} · @{user.displayName}
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
      {isAdmin && (
        <div className="settings-section">
          <h2>Agents</h2>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Agents are non-human teammates you can assign issues to and @mention. They can't log in;
            they act through a Bearer token over REST or the MCP server. Mint and manage each
            agent's tokens below — <em>not</em> your personal token in Profile → API tokens, which
            would make the agent act as you. Tokens can be scoped to specific teams or made
            read-only via <code>POST /api/agents/:id/tokens</code>. See <code>examples/agent</code>{' '}
            for a runnable reference.
          </p>
          <div className="row" style={{ gap: 8, maxWidth: 420 }}>
            <input
              className="input"
              placeholder="Agent name (e.g. Fixer Bot)"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
            />
            <button
              className="btn primary"
              disabled={!agentName.trim()}
              onClick={() => {
                void api
                  .createAgent(agentName.trim())
                  .then((u) => {
                    useStore.getState().putEntity('user', u);
                    toast(`Agent ${u.name} created`, 'success');
                    setAgentName('');
                  })
                  .catch(toastError);
              }}
            >
              <PlusIcon size={13} /> Add agent
            </button>
          </div>
          {rows
            .filter((u) => u.isAgent && u.active)
            .map((agentUser) => (
              <div
                key={agentUser.id}
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border)',
                }}
              >
                <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <Avatar user={agentUser} size={22} />
                  <b>{agentUser.name}</b>
                  <span className="dim">@{agentUser.displayName}</span>
                </div>
                <ApiTokens agent={{ id: agentUser.id, name: agentUser.name }} />
              </div>
            ))}
        </div>
      )}
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

  // Reorder workflow states by dragging the handle. Category is fixed per state;
  // positions are reassigned within each category to match the new order.
  const handleStateDrop = (drop: SortableDrop) => {
    const stateById = Object.fromEntries(teamStates.map((s) => [s.id, s]));
    const order = teamStates.map((s) => s.id).filter((id) => id !== drop.id);
    let idx = drop.beforeId
      ? order.indexOf(drop.beforeId) + 1
      : drop.afterId
        ? order.indexOf(drop.afterId)
        : order.length;
    if (idx < 0) idx = order.length;
    order.splice(idx, 0, drop.id);

    const perCat: Record<string, number> = {};
    for (const id of order) {
      const state = stateById[id];
      if (!state) continue;
      const position = perCat[state.category] ?? 0;
      perCat[state.category] = position + 1;
      if (state.position === position) continue;
      useStore.getState().putEntity('workflowState', { ...state, position });
      void api
        .updateState(id, { position })
        .then((s) => useStore.getState().putEntity('workflowState', s))
        .catch(toastError);
    }
  };

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
        <h2>Visibility &amp; access</h2>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          This team is a <b>read boundary</b>. Its members (below) see its issues, projects, and
          comments; non-members don't see the team at all. Admins always see every team. To grant
          someone access, add them under <b>Members</b>; to give a scoped agent access, mint a
          team-scoped token (Settings → Members → Agents).
        </p>
        <div className="setting-row">
          <div className="info">
            <div className="label">Private team</div>
            <div className="desc">
              When on, new people are <b>not</b> auto-added on sign-up — you grant access
              explicitly under Members. When off, every new member joins automatically.
            </div>
          </div>
          <Switch on={team.private} onChange={(on) => patchTeam({ private: on })} />
        </div>
      </div>

      <div className="settings-section">
        <h2>Estimates</h2>
        <div className="setting-row">
          <div className="info">
            <div className="label">Estimate scale</div>
            <div className="desc">The point values shown when estimating issues.</div>
          </div>
          <select
            className="input"
            style={{ width: 150 }}
            value={team.estimateScale}
            onChange={(e) => patchTeam({ estimateScale: e.target.value })}
          >
            {ESTIMATE_SCALES.map((scale) => (
              <option key={scale} value={scale}>
                {scale === 'tshirt' ? 'T-shirt (XS–XL)' : scale[0]!.toUpperCase() + scale.slice(1)}
              </option>
            ))}
          </select>
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
        <SortableList sortGroup="states" handle=".drag-handle" onDrop={handleStateDrop}>
          {teamStates.map((state) => (
            <div key={state.id} data-sort-id={state.id}>
              <WorkflowStateRow
                state={state}
                dragHandle={
                  <span className="drag-handle" title="Drag to reorder">
                    ⋮⋮
                  </span>
                }
              />
            </div>
          ))}
        </SortableList>
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
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Everyone listed here can see this team's issues, projects, and comments. Removing someone
          revokes their access to the team. (Admins see every team regardless.)
        </p>
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
        <h2>Templates</h2>
        <TemplatesSettings team={team} />
      </div>

      <div className="settings-section">
        <h2>Triage rules</h2>
        <TriageRulesSettings team={team} />
      </div>

      <div className="settings-section">
        <h2>Intake</h2>
        <IntakeSettings team={team} />
      </div>

      <div className="settings-section">
        <h2>Import & export</h2>
        <ImportExport team={team} />
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

function NotificationsSettings() {
  return (
    <>
      <h1>Notifications</h1>
      <p className="subtitle">Choose what reaches your inbox and email.</p>
      <div className="settings-section">
        <NotificationPrefs />
      </div>
    </>
  );
}

function TokensSettings() {
  return (
    <>
      <h1>API tokens</h1>
      <p className="subtitle">Programmatic access for scripts, agents, and MCP clients.</p>
      <div className="settings-section">
        <ApiTokens />
      </div>
    </>
  );
}

const AUDIT_LABELS: Record<string, string> = {
  'user.login': 'signed in',
  'user.login_failed': 'failed sign-in',
  'user.logout': 'signed out',
  'user.register': 'registered',
  'user.provisioned': 'provisioned',
  'user.deactivated': 'deactivated',
  'user.reactivated': 'reactivated',
  'user.role_changed': 'changed role',
  'user.sso_linked': 'linked SSO',
  'member.added': 'added member',
  'member.removed': 'removed member',
  'token.created': 'created API token',
  'token.revoked': 'revoked API token',
  'agent.created': 'created agent',
  'webhook.created': 'created webhook',
  'webhook.deleted': 'deleted webhook',
  'team.created': 'created team',
  'team.deleted': 'deleted team',
};

function auditDetail(e: AuditEvent): string {
  const parts: string[] = [];
  if (e.targetLabel) parts.push(e.targetLabel);
  const m = e.metadata ?? {};
  if (e.action === 'user.role_changed' && m.from && m.to) parts.push(`${m.from} → ${m.to}`);
  if (typeof m.method === 'string') parts.push(m.method);
  if (typeof m.via === 'string') parts.push(m.via);
  if (typeof m.format === 'string') parts.push(m.format);
  return parts.join(' · ');
}

function AuditSettings() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (next?: string | null) => {
    setLoading(true);
    void api
      .audit(next)
      .then((res) => {
        setEvents((prev) => (next ? [...prev, ...res.events] : res.events));
        setCursor(res.nextCursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load audit log'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <h1>Audit log</h1>
      <p className="subtitle">
        Security and administrative events across the workspace. Newest first.
      </p>
      <div className="settings-section">
        {error && <div className="auth-error">{error}</div>}
        {!error && events.length === 0 && !loading && (
          <div className="empty-state">
            <h3>No events yet</h3>
            <p>Sign-ins, role changes, and provisioning will appear here.</p>
          </div>
        )}
        {events.length > 0 && (
          <table className="audit-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="audit-when" title={e.createdAt}>
                    {relativeTime(e.createdAt)}
                  </td>
                  <td>{e.actorLabel}</td>
                  <td>
                    <span
                      className={`audit-action${e.action === 'user.login_failed' ? ' fail' : ''}`}
                    >
                      {AUDIT_LABELS[e.action] ?? e.action}
                    </span>
                  </td>
                  <td className="audit-detail">{auditDetail(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cursor && events.length > 0 && (
          <button
            className="btn ghost"
            style={{ marginTop: 12 }}
            disabled={loading}
            onClick={() => load(cursor)}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </>
  );
}

function AiSettings() {
  const [settings, setSettings] = useState<AiSettingsPublic | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.aiSettings().then(setSettings).catch(toastError);
  }, []);

  if (!settings) return null;

  const save = (patch: UpdateAiSettingsInput) => {
    setSaving(true);
    void api
      .updateAiSettings(patch)
      .then((s) => {
        setSettings(s);
        if (patch.apiKey !== undefined) setApiKey('');
        toast('AI settings saved', 'success');
      })
      .catch(toastError)
      .finally(() => setSaving(false));
  };

  return (
    <>
      <h1>AI</h1>
      <p className="subtitle">
        Bring your own LLM key to enable AI features — Pulse summaries and suggested labels. The key
        is stored on the server and never sent to browsers.
      </p>
      <div className="settings-section">
        <div className="setting-row">
          <div className="info">
            <div className="label">Enable AI features</div>
            <div className="desc">Turn the optional AI features on across the workspace.</div>
          </div>
          <Switch on={settings.enabled} onChange={(enabled) => save({ enabled })} />
        </div>
        <div className="setting-row">
          <div className="info">
            <div className="label">Provider</div>
            <div className="desc">Anthropic (Claude) or OpenAI-compatible.</div>
          </div>
          <select
            className="input"
            style={{ width: 170 }}
            value={settings.provider}
            onChange={(e) => save({ provider: e.target.value as AiSettingsPublic['provider'] })}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div className="setting-row">
          <div className="info">
            <div className="label">Model</div>
            <div className="desc">The model id to call.</div>
          </div>
          <input
            className="input"
            style={{ width: 220 }}
            defaultValue={settings.model}
            key={settings.model}
            onBlur={(e) =>
              e.target.value.trim() !== settings.model && save({ model: e.target.value })
            }
          />
        </div>
        <div className="setting-row">
          <div className="info">
            <div className="label">API key</div>
            <div className="desc">
              {settings.hasKey
                ? 'A key is stored. Enter a new one to replace it.'
                : 'No key stored yet.'}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              type="password"
              style={{ width: 220 }}
              placeholder={settings.hasKey ? '••••••••' : 'sk-…'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button
              className="btn primary"
              disabled={saving || !apiKey.trim()}
              onClick={() => save({ apiKey: apiKey.trim() })}
            >
              Save key
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function InvitePeople() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [role, setRole] = useState<'member' | 'guest'>('member');
  const [busy, setBusy] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  useEffect(() => {
    void api.invites().then(setInvites).catch(toastError);
  }, []);

  const create = () => {
    setBusy(true);
    void api
      .createInvite({ role })
      .then((res) => {
        setInvites((prev) => [res.invite, ...prev]);
        setLastUrl(res.url);
        void navigator.clipboard?.writeText(res.url).then(
          () => toast('Invite link copied to clipboard', 'success'),
          () => {},
        );
      })
      .catch(toastError)
      .finally(() => setBusy(false));
  };

  const revoke = (id: string) => {
    setInvites((prev) => prev.filter((i) => i.id !== id));
    void api.revokeInvite(id).catch(toastError);
  };

  return (
    <div className="settings-section">
      <h2>Invite people</h2>
      <p className="dim" style={{ fontSize: 12.5, marginTop: -4, marginBottom: 12 }}>
        Registration is closed unless open signups are enabled. Generate a link and share it — it
        works once and expires in 14 days.
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <select
          className="input"
          style={{ width: 140 }}
          value={role}
          onChange={(e) => setRole(e.target.value as 'member' | 'guest')}
        >
          <option value="member">Member</option>
          <option value="guest">Guest</option>
        </select>
        <button className="btn primary" onClick={create} disabled={busy}>
          Create invite link
        </button>
      </div>
      {lastUrl && (
        <div className="invite-link">
          <code className="truncate">{lastUrl}</code>
          <button
            className="btn ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(lastUrl);
              toast('Copied', 'success');
            }}
          >
            Copy
          </button>
        </div>
      )}
      {invites.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {invites.map((inv) => (
            <div key={inv.id} className="member-row">
              <div className="info">
                <div>Pending invite · {inv.role}</div>
                <div className="email">
                  {inv.email ? inv.email + ' · ' : ''}expires{' '}
                  {new Date(inv.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <button className="btn ghost danger" onClick={() => revoke(inv.id)}>
                <TrashIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
