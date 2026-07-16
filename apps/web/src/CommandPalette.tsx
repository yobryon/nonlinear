import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { issueKey, useStore } from './store.js';
import {
  InboxIcon,
  MoonIcon,
  PlusIcon,
  ProjectIcon,
  SearchIcon,
  SettingsIcon,
  StateIcon,
  SunIcon,
  TeamIcon,
  UserIcon,
} from './icons.js';
import { openNewIssue } from './NewIssueDialog.js';
import { getTheme, toggleTheme } from './theme.js';

interface PaletteState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const usePalette = create<PaletteState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

interface Command {
  id: string;
  label: string;
  icon: ReactNode;
  hint?: string;
  keywords?: string;
  run: () => void;
}

export function CommandPalette() {
  const { open, hide } = usePalette();
  if (!open) return null;
  return <PaletteInner onClose={hide} />;
}

function PaletteInner({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const teams = useStore((s) => s.teams);
  const issues = useStore((s) => s.issues);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const states = useStore((s) => s.workflowStates);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: 'new-issue',
        label: 'Create new issue',
        icon: <PlusIcon size={15} />,
        hint: 'C',
        run: () => {
          onClose();
          openNewIssue();
        },
      },
      {
        id: 'inbox',
        label: 'Go to Inbox',
        icon: <InboxIcon size={15} />,
        hint: 'G I',
        run: () => go('/inbox'),
      },
      {
        id: 'my-issues',
        label: 'Go to My Issues',
        icon: <UserIcon size={15} />,
        hint: 'G M',
        run: () => go('/my-issues'),
      },
      {
        id: 'projects',
        label: 'Go to Projects',
        icon: <ProjectIcon size={15} />,
        run: () => go('/projects'),
      },
      {
        id: 'initiatives',
        label: 'Go to Initiatives',
        icon: <ProjectIcon size={15} />,
        run: () => go('/initiatives'),
      },
      {
        id: 'documents',
        label: 'Go to Documents',
        icon: <ProjectIcon size={15} />,
        run: () => go('/documents'),
      },
      {
        id: 'settings',
        label: 'Go to Settings',
        icon: <SettingsIcon size={15} />,
        run: () => go('/settings/workspace'),
      },
      {
        id: 'theme',
        label: `Switch to ${getTheme() === 'dark' ? 'light' : 'dark'} theme`,
        icon: getTheme() === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />,
        run: () => {
          toggleTheme();
          onClose();
        },
      },
    ];
    for (const team of Object.values(teams)) {
      list.push({
        id: `team-${team.id}`,
        label: `Go to ${team.name} issues`,
        keywords: team.key,
        icon: (
          <span className="team-icon" style={{ background: team.color }}>
            {team.key.slice(0, 2)}
          </span>
        ),
        run: () => go(`/team/${team.key}/issues`),
      });
    }
    for (const project of Object.values(projects)) {
      list.push({
        id: `project-${project.id}`,
        label: `Go to project ${project.name}`,
        icon: <ProjectIcon size={15} />,
        run: () => go(`/project/${project.id}`),
      });
    }
    return list;
  }, [teams, projects]);

  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    const matchedCommands = q
      ? commands.filter(
          (c) => c.label.toLowerCase().includes(q) || c.keywords?.toLowerCase().includes(q),
        )
      : commands;

    const matchedIssues = q
      ? Object.values(issues)
          .filter((i) => {
            const key = issueKey(i, teams).toLowerCase();
            return i.title.toLowerCase().includes(q) || key.includes(q);
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 12)
      : [];

    return { matchedCommands: matchedCommands.slice(0, 8), matchedIssues };
  }, [q, commands, issues, teams]);

  const flat: Array<{ kind: 'command' | 'issue'; id: string; run: () => void }> = [
    ...results.matchedCommands.map((c) => ({ kind: 'command' as const, id: c.id, run: c.run })),
    ...results.matchedIssues.map((i) => ({
      kind: 'issue' as const,
      id: i.id,
      run: () => go(`/issue/${issueKey(i, teams)}`),
    })),
  ];
  const clampedHl = Math.min(hl, Math.max(0, flat.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelectorAll('.palette-item')
      [clampedHl]?.scrollIntoView({ block: 'nearest' });
  }, [clampedHl]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHl((h) => Math.min(h + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHl((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flat[clampedHl]?.run();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  let index = -1;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette">
        <div className="palette-input">
          <SearchIcon size={16} style={{ color: 'var(--text-4)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHl(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command or search issues…"
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {results.matchedCommands.length > 0 && (
            <>
              <div className="menu-heading">Commands</div>
              {results.matchedCommands.map((c) => {
                index += 1;
                const i = index;
                return (
                  <button
                    key={c.id}
                    className={`palette-item${i === clampedHl ? ' hl' : ''}`}
                    onMouseEnter={() => setHl(i)}
                    onClick={c.run}
                  >
                    {c.icon}
                    <span className="grow truncate">{c.label}</span>
                    {c.hint && (
                      <span className="hint">
                        {c.hint.split(' ').map((k) => (
                          <span key={k} className="kbd">
                            {k}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </>
          )}
          {results.matchedIssues.length > 0 && (
            <>
              <div className="menu-heading">Issues</div>
              {results.matchedIssues.map((issue) => {
                index += 1;
                const i = index;
                const state = states[issue.stateId];
                const assignee = issue.assigneeId ? users[issue.assigneeId] : null;
                return (
                  <button
                    key={issue.id}
                    className={`palette-item${i === clampedHl ? ' hl' : ''}`}
                    onMouseEnter={() => setHl(i)}
                    onClick={() => go(`/issue/${issueKey(issue, teams)}`)}
                  >
                    {state && <StateIcon category={state.category} color={state.color} />}
                    <span className="dim" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {issueKey(issue, teams)}
                    </span>
                    <span className="grow truncate">{issue.title}</span>
                    {assignee && <span className="dim">{assignee.displayName}</span>}
                  </button>
                );
              })}
            </>
          )}
          {flat.length === 0 && (
            <div className="empty-state" style={{ padding: 30 }}>
              No results for “{query}”
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function openPalette(): void {
  usePalette.getState().show();
}
