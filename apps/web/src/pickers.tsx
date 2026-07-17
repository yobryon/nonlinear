import { useState } from 'react';
import type { Priority } from '@nonlinear/shared';
import { ESTIMATE_SCALE_VALUES, PRIORITY_LABELS } from '@nonlinear/shared';
import { useStore, sortedStates, issueKey } from './store.js';
import { Picker, Popover, type Anchor } from './ui.js';
import { PriorityIcon, StateIcon, ProjectStatusIcon, CycleIcon } from './icons.js';

export function usePicker() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  return {
    anchor,
    open: (a: Anchor) => setAnchor(a),
    close: () => setAnchor(null),
    isOpen: anchor !== null,
  };
}

const PRIORITIES: Priority[] = [0, 1, 2, 3, 4];

export function PriorityPicker({
  anchor,
  onClose,
  currentId,
  onPick,
}: {
  anchor: Anchor;
  onClose: () => void;
  currentId?: Priority;
  onPick: (p: Priority) => void;
}) {
  return (
    <Picker
      anchor={anchor}
      onClose={onClose}
      placeholder="Set priority…"
      selectedIds={currentId !== undefined ? new Set([String(currentId)]) : undefined}
      items={PRIORITIES.map((p) => ({
        id: String(p),
        label: PRIORITY_LABELS[p],
        icon: <PriorityIcon priority={p} />,
      }))}
      onPick={(id) => {
        onPick(Number(id) as Priority);
        onClose();
      }}
    />
  );
}

export function StatePicker({
  anchor,
  onClose,
  teamId,
  currentId,
  onPick,
}: {
  anchor: Anchor;
  onClose: () => void;
  teamId: string;
  currentId?: string;
  onPick: (stateId: string) => void;
}) {
  const states = useStore((s) => s.workflowStates);
  const items = sortedStates(Object.values(states), teamId).map((s) => ({
    id: s.id,
    label: s.name,
    icon: <StateIcon category={s.category} color={s.color} />,
  }));
  return (
    <Picker
      anchor={anchor}
      onClose={onClose}
      placeholder="Move to…"
      items={items}
      selectedIds={currentId ? new Set([currentId]) : undefined}
      onPick={(id) => {
        onPick(id);
        onClose();
      }}
    />
  );
}

export function AssigneePicker({
  anchor,
  onClose,
  currentId,
  onPick,
}: {
  anchor: Anchor;
  onClose: () => void;
  currentId?: string | null;
  onPick: (userId: string | null) => void;
}) {
  const users = useStore((s) => s.users);
  const active = Object.values(users).filter((u) => u.active);
  return (
    <Picker
      anchor={anchor}
      onClose={onClose}
      placeholder="Assign to…"
      selectedIds={currentId ? new Set([currentId]) : new Set(['__none'])}
      items={[
        { id: '__none', label: 'No assignee' },
        ...active.map((u) => ({
          id: u.id,
          label: u.name,
          icon: (
            <span
              className="avatar"
              style={{ width: 16, height: 16, fontSize: 7, background: u.avatarColor }}
            >
              {u.name
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p[0])
                .join('')
                .toUpperCase()}
            </span>
          ),
          hint: u.displayName,
        })),
      ]}
      onPick={(id) => {
        onPick(id === '__none' ? null : id);
        onClose();
      }}
    />
  );
}

export function LabelPicker({
  anchor,
  onClose,
  teamId,
  selected,
  onToggle,
}: {
  anchor: Anchor;
  onClose: () => void;
  teamId: string;
  selected: string[];
  onToggle: (labelId: string) => void;
}) {
  const labels = useStore((s) => s.labels);
  const applicable = Object.values(labels)
    .filter((l) => l.teamId === null || l.teamId === teamId)
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Picker
      anchor={anchor}
      onClose={onClose}
      placeholder="Add labels…"
      selectedIds={new Set(selected)}
      items={applicable.map((l) => ({
        id: l.id,
        label: l.name,
        icon: (
          <span
            className="dot"
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
      onPick={onToggle}
    />
  );
}

export function ProjectPicker({
  anchor,
  onClose,
  teamId,
  currentId,
  onPick,
}: {
  anchor: Anchor;
  onClose: () => void;
  teamId: string;
  currentId?: string | null;
  onPick: (projectId: string | null) => void;
}) {
  const projects = useStore((s) => s.projects);
  const applicable = Object.values(projects)
    .filter((p) => p.teamIds.includes(teamId))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Picker
      anchor={anchor}
      onClose={onClose}
      placeholder="Add to project…"
      selectedIds={currentId ? new Set([currentId]) : new Set(['__none'])}
      items={[
        { id: '__none', label: 'No project' },
        ...applicable.map((p) => ({
          id: p.id,
          label: p.name,
          icon: <ProjectStatusIcon status={p.status} />,
        })),
      ]}
      onPick={(id) => {
        onPick(id === '__none' ? null : id);
        onClose();
      }}
    />
  );
}

export function CyclePicker({
  anchor,
  onClose,
  teamId,
  currentId,
  onPick,
}: {
  anchor: Anchor;
  onClose: () => void;
  teamId: string;
  currentId?: string | null;
  onPick: (cycleId: string | null) => void;
}) {
  const cycles = useStore((s) => s.cycles);
  const now = new Date().toISOString();
  const applicable = Object.values(cycles)
    .filter((c) => c.teamId === teamId && c.endsAt > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return (
    <Picker
      anchor={anchor}
      onClose={onClose}
      placeholder="Set cycle…"
      selectedIds={currentId ? new Set([currentId]) : new Set(['__none'])}
      items={[
        { id: '__none', label: 'No cycle' },
        ...applicable.map((c) => ({
          id: c.id,
          label: c.name || `Cycle ${c.number}`,
          icon: <CycleIcon size={14} />,
          hint: c.startsAt <= now ? 'Active' : 'Upcoming',
        })),
      ]}
      onPick={(id) => {
        onPick(id === '__none' ? null : id);
        onClose();
      }}
    />
  );
}

export function EstimatePicker({
  anchor,
  onClose,
  current,
  onPick,
  teamId,
}: {
  anchor: Anchor;
  onClose: () => void;
  current?: number | null;
  onPick: (estimate: number | null) => void;
  /** Options come from the team's estimate scale when provided. */
  teamId?: string;
}) {
  const teams = useStore((s) => s.teams);
  const scale = (teamId && teams[teamId]?.estimateScale) || 'exponential';
  const options = ESTIMATE_SCALE_VALUES[scale];
  return (
    <Picker
      anchor={anchor}
      onClose={onClose}
      searchable={false}
      selectedIds={new Set([current == null ? '__none' : String(current)])}
      items={[
        { id: '__none', label: 'No estimate' },
        ...options.map((o) => ({
          id: String(o.value),
          label: scale === 'tshirt' ? o.label : `${o.label} point${o.value === 1 ? '' : 's'}`,
        })),
      ]}
      onPick={(id) => {
        onPick(id === '__none' ? null : Number(id));
        onClose();
      }}
    />
  );
}

/** Display label for an estimate under a team's scale (tshirt sizes etc.). */
export function estimateLabel(
  teams: Record<string, { estimateScale?: string }>,
  teamId: string,
  estimate: number,
): string {
  const scale = (teams[teamId]?.estimateScale ??
    'exponential') as keyof typeof ESTIMATE_SCALE_VALUES;
  const match = ESTIMATE_SCALE_VALUES[scale]?.find((o) => o.value === estimate);
  return scale === 'tshirt' && match ? match.label : `${estimate} pts`;
}

export function TeamPicker({
  anchor,
  onClose,
  currentId,
  onPick,
}: {
  anchor: Anchor;
  onClose: () => void;
  currentId?: string;
  onPick: (teamId: string) => void;
}) {
  const teams = useStore((s) => s.teams);
  return (
    <Picker
      anchor={anchor}
      onClose={onClose}
      placeholder="Move to team…"
      selectedIds={currentId ? new Set([currentId]) : undefined}
      items={Object.values(teams).map((t) => ({
        id: t.id,
        label: t.name,
        hint: t.key,
        icon: (
          <span className="team-icon" style={{ background: t.color }}>
            {t.key.slice(0, 2)}
          </span>
        ),
      }))}
      onPick={(id) => {
        onPick(id);
        onClose();
      }}
    />
  );
}

export function IssuePicker({
  anchor,
  onClose,
  excludeId,
  onPick,
  placeholder = 'Search issues…',
}: {
  anchor: Anchor;
  onClose: () => void;
  excludeId?: string;
  onPick: (issueId: string | null) => void;
  placeholder?: string;
}) {
  const issues = useStore((s) => s.issues);
  const teams = useStore((s) => s.teams);
  const items = Object.values(issues)
    .filter((i) => i.id !== excludeId && !i.archivedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 200)
    .map((i) => ({
      id: i.id,
      label: `${issueKey(i, teams)} ${i.title}`,
    }));
  return (
    <Picker
      anchor={anchor}
      onClose={onClose}
      placeholder={placeholder}
      width={320}
      items={[{ id: '__none', label: 'None' }, ...items]}
      onPick={(id) => {
        onPick(id === '__none' ? null : id);
        onClose();
      }}
    />
  );
}

export function DueDatePicker({
  anchor,
  onClose,
  current,
  onPick,
}: {
  anchor: Anchor;
  onClose: () => void;
  current?: string | null;
  onPick: (date: string | null) => void;
}) {
  const [value, setValue] = useState(current?.slice(0, 10) ?? '');
  return (
    <Popover anchor={anchor} onClose={onClose} width={230}>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          type="date"
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          <button
            className="btn ghost"
            onClick={() => {
              onPick(null);
              onClose();
            }}
          >
            Clear
          </button>
          <button
            className="btn primary"
            disabled={!value}
            onClick={() => {
              onPick(value ? new Date(`${value}T12:00:00Z`).toISOString() : null);
              onClose();
            }}
          >
            Set due date
          </button>
        </div>
      </div>
    </Popover>
  );
}
