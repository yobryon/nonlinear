import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { issueKey, useStore } from './store.js';
import {
  anchorFromEvent,
  Popover,
  sortKeyForInsert,
  toastError,
  useDragReorder,
  type Anchor,
} from './ui.js';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CycleIcon,
  FilterIcon,
  InboxIcon,
  LogoutIcon,
  MoonIcon,
  PencilIcon,
  ProjectIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  SunIcon,
  TeamIcon,
  ListIcon,
  UserIcon,
  PlusIcon,
} from './icons.js';
import { openNewIssue } from './NewIssueDialog.js';
import { openPalette } from './CommandPalette.js';
import { api } from './api.js';
import { stopSync } from './sync.js';
import { getTheme, toggleTheme } from './theme.js';

function InitiativeGlyphSidebar() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
      <rect
        x="1"
        y="1"
        width="12"
        height="12"
        rx="3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="7" cy="7" r="2" fill="currentColor" />
    </svg>
  );
}

function DocGlyphSidebar() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function TimelineGlyphSidebar() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 6h10M3 12h16M3 18h7" />
      <circle cx="17" cy="6" r="2" />
      <circle cx="14" cy="18" r="2" />
    </svg>
  );
}

function ArchiveGlyphSidebar() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
    </svg>
  );
}

function InsightsGlyphSidebar() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 3v18h18" />
      <path d="M7 15v-4M12 15V7M17 15v-7" />
    </svg>
  );
}

export function Sidebar() {
  const workspace = useStore((s) => s.workspace);
  const users = useStore((s) => s.users);
  const userId = useStore((s) => s.userId);
  const teams = useStore((s) => s.teams);
  const notifications = useStore((s) => s.notifications);
  const favorites = useStore((s) => s.favorites);
  const issues = useStore((s) => s.issues);
  const projects = useStore((s) => s.projects);
  const cycles = useStore((s) => s.cycles);
  const reset = useStore((s) => s.reset);
  const navigate = useNavigate();

  const [wsMenu, setWsMenu] = useState<Anchor | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [theme, setThemeState] = useState(getTheme());

  const workflowStates = useStore((s) => s.workflowStates);
  const me = userId ? users[userId] : null;
  const unread = Object.values(notifications).filter((n) => !n.readAt).length;
  const teamList = Object.values(teams).sort((a, b) => a.name.localeCompare(b.name));
  const triageCounts: Record<string, number> = {};
  for (const issue of Object.values(issues)) {
    if (issue.archivedAt) continue;
    if (workflowStates[issue.stateId]?.category === 'triage') {
      triageCounts[issue.teamId] = (triageCounts[issue.teamId] ?? 0) + 1;
    }
  }
  const myFavorites = Object.values(favorites)
    .filter((f) => f.userId === userId)
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1));

  const customViews = useStore((s) => s.customViews);
  const myViews = Object.values(customViews)
    .filter((v) => v.shared || v.creatorId === userId)
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1));

  const favReorder = useDragReorder(myFavorites, (dragged, insertAt) => {
    const sortOrder = sortKeyForInsert(myFavorites, dragged, insertAt);
    if (!sortOrder) return;
    useStore.getState().putEntity('favorite', { ...dragged, sortOrder });
    void api.reorderFavorite(dragged.id, sortOrder).catch(toastError);
  });

  const logout = async () => {
    try {
      await api.logout();
      stopSync();
      reset();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <nav className="sidebar">
      <div className="sidebar-top">
        <button className="ws-button" onClick={(e) => setWsMenu(anchorFromEvent(e))}>
          <span className="ws-logo">{(workspace?.name ?? 'N')[0]?.toUpperCase()}</span>
          <span className="name">{workspace?.name ?? 'nonlinear'}</span>
          <ChevronDownIcon size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        </button>
        <span className="grow" />
        <button className="icon-btn" title="Search (⌘K)" onClick={openPalette}>
          <SearchIcon size={15} />
        </button>
        <button className="icon-btn" title="New issue (C)" onClick={() => openNewIssue()}>
          <PencilIcon size={15} />
        </button>
      </div>

      <div className="sidebar-scroll">
        <NavLink to="/inbox" className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}>
          <InboxIcon size={15} />
          <span className="grow">Inbox</span>
          {unread > 0 && <span className="count badge">{unread > 99 ? '99+' : unread}</span>}
        </NavLink>
        <NavLink
          to="/my-issues"
          className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
        >
          <UserIcon size={15} />
          <span className="grow">My Issues</span>
        </NavLink>

        {myFavorites.length > 0 && (
          <div className="side-section">
            <div className="side-section-header">Favorites</div>
            {myFavorites.map((fav, index) => {
              let node = null;
              let label = '';
              if (fav.type === 'issue') {
                const issue = issues[fav.targetId];
                if (issue) {
                  const key = issueKey(issue, teams);
                  label = `${key} ${issue.title}`;
                  node = (
                    <NavLink
                      to={`/issue/${key}`}
                      draggable={false}
                      className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
                    >
                      <StarIcon size={13} filled style={{ color: 'var(--warning)' }} />
                      <span className="grow">
                        {key} {issue.title}
                      </span>
                    </NavLink>
                  );
                }
              } else if (fav.type === 'project') {
                const project = projects[fav.targetId];
                if (project) {
                  label = project.name;
                  node = (
                    <NavLink
                      to={`/project/${project.id}`}
                      draggable={false}
                      className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
                    >
                      <ProjectIcon size={13} />
                      <span className="grow">{project.name}</span>
                    </NavLink>
                  );
                }
              } else if (fav.type === 'cycle') {
                const cycle = cycles[fav.targetId];
                if (cycle) {
                  label = cycle.name || `Cycle ${cycle.number}`;
                  node = (
                    <NavLink
                      to={`/cycle/${cycle.id}`}
                      draggable={false}
                      className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
                    >
                      <CycleIcon size={13} />
                      <span className="grow">{cycle.name || `Cycle ${cycle.number}`}</span>
                    </NavLink>
                  );
                }
              }
              if (!node) return null;
              return (
                <div
                  key={fav.id}
                  className={`${favReorder.insertBefore === index ? 'reorder-before' : ''} ${
                    favReorder.dragId === fav.id ? 'reorder-dragging' : ''
                  }`.trim()}
                  {...favReorder.itemProps(index)}
                  {...favReorder.dragProps(fav, label)}
                >
                  {node}
                </div>
              );
            })}
          </div>
        )}

        <div className="side-section">
          <div className="side-section-header">Workspace</div>
          <NavLink
            to="/projects"
            className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
          >
            <ProjectIcon size={15} />
            <span className="grow">Projects</span>
          </NavLink>
          <NavLink
            to="/initiatives"
            className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
          >
            <InitiativeGlyphSidebar />
            <span className="grow">Initiatives</span>
          </NavLink>
          <NavLink
            to="/documents"
            className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
          >
            <DocGlyphSidebar />
            <span className="grow">Documents</span>
          </NavLink>
          <NavLink
            to="/timeline"
            className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
          >
            <TimelineGlyphSidebar />
            <span className="grow">Timeline</span>
          </NavLink>
          <NavLink
            to="/customers"
            className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
          >
            <TeamIcon size={14} />
            <span className="grow">Customers</span>
          </NavLink>
        </div>

        {myViews.length > 0 && (
          <div className="side-section">
            <div className="side-section-header">Views</div>
            {myViews.map((view) => (
              <NavLink
                key={view.id}
                to={`/view/${view.id}`}
                className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
              >
                <FilterIcon size={13} />
                <span className="grow">{view.name}</span>
                {!view.shared && (
                  <span className="dim" style={{ fontSize: 10 }}>
                    private
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        )}

        <div className="side-section">
          <div className="side-section-header">
            <span className="grow" style={{ textAlign: 'left' }}>
              Teams
            </span>
            <button
              className="icon-btn"
              style={{ width: 20, height: 20 }}
              title="New team"
              onClick={() => navigate('/settings/teams')}
            >
              <PlusIcon size={12} />
            </button>
          </div>
          {teamList.map((team) => {
            const isCollapsed = collapsed[team.id] ?? false;
            return (
              <div key={team.id}>
                <button
                  className="side-item"
                  onClick={() => setCollapsed((c) => ({ ...c, [team.id]: !isCollapsed }))}
                >
                  <span className="team-icon" style={{ background: team.color }}>
                    {team.key.slice(0, 2)}
                  </span>
                  <span className="grow">{team.name}</span>
                  {isCollapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
                </button>
                {!isCollapsed && (
                  <div className="side-nest">
                    <NavLink
                      to={`/team/${team.key}/issues`}
                      className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
                    >
                      <ListIcon size={14} />
                      <span className="grow">Issues</span>
                    </NavLink>
                    {team.triageEnabled && (
                      <NavLink
                        to={`/team/${team.key}/triage`}
                        className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
                      >
                        <InboxIcon size={14} />
                        <span className="grow">Triage</span>
                        {triageCounts[team.id] ? (
                          <span className="count">{triageCounts[team.id]}</span>
                        ) : null}
                      </NavLink>
                    )}
                    {team.cyclesEnabled && (
                      <NavLink
                        to={`/team/${team.key}/cycles`}
                        className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
                      >
                        <CycleIcon size={14} />
                        <span className="grow">Cycles</span>
                      </NavLink>
                    )}
                    <NavLink
                      to={`/team/${team.key}/insights`}
                      className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
                    >
                      <InsightsGlyphSidebar />
                      <span className="grow">Insights</span>
                    </NavLink>
                    <NavLink
                      to={`/team/${team.key}/archive`}
                      className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
                    >
                      <ArchiveGlyphSidebar />
                      <span className="grow">Archive</span>
                    </NavLink>
                    <NavLink
                      to={`/settings/team/${team.key}`}
                      className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
                    >
                      <SettingsIcon size={14} />
                      <span className="grow">Settings</span>
                    </NavLink>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {wsMenu && (
        <Popover anchor={wsMenu} onClose={() => setWsMenu(null)} width={236}>
          <div className="menu-heading" style={{ textTransform: 'none', letterSpacing: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>{workspace?.name}</div>
            <div className="dim" style={{ fontSize: 11 }}>
              {me?.name} · {me?.email}
            </div>
          </div>
          <button
            className="menu-item"
            onClick={() => {
              navigate('/settings/preferences');
              setWsMenu(null);
            }}
          >
            <SettingsIcon size={14} />
            <span className="grow">Settings</span>
            <span className="hint" style={{ display: 'flex', gap: 3 }}>
              <span className="kbd">G</span>
              <span className="kbd">S</span>
            </span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              navigate('/settings/members');
              setWsMenu(null);
            }}
          >
            <TeamIcon size={14} />
            <span className="grow">Invite &amp; manage members</span>
          </button>
          <div className="menu-separator" />
          <button
            className="menu-item"
            onClick={() => {
              toggleTheme();
              setThemeState(getTheme());
            }}
          >
            {theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
            <span className="grow">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
          </button>
          <div className="menu-separator" />
          <button className="menu-item" onClick={() => void logout()}>
            <LogoutIcon size={14} />
            <span className="grow">Log out</span>
          </button>
        </Popover>
      )}
    </nav>
  );
}
