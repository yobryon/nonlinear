import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Priority } from '@nonlinear/shared';
import { PRIORITY_LABELS } from '@nonlinear/shared';
import { create } from 'zustand';
import { issueKey, sortedStates, useStore } from './store.js';
import { Modal, Picker, toast, anchorFromEvent } from './ui.js';
import { PriorityIcon, StateIcon, CloseIcon } from './icons.js';
import {
  AssigneePicker,
  CyclePicker,
  EstimatePicker,
  LabelPicker,
  PriorityPicker,
  ProjectPicker,
  StatePicker,
  TeamPicker,
  usePicker,
} from './pickers.js';
import { createIssue } from './actions.js';

/** Global dialog state so any surface (palette, sidebar, shortcut) can open it. */
interface NewIssueState {
  open: boolean;
  defaults: {
    teamId?: string;
    stateId?: string;
    projectId?: string;
    cycleId?: string;
    title?: string;
    description?: string;
  };
  show: (defaults?: NewIssueState['defaults']) => void;
  hide: () => void;
}

export const useNewIssue = create<NewIssueState>((set) => ({
  open: false,
  defaults: {},
  show: (defaults = {}) => set({ open: true, defaults }),
  hide: () => set({ open: false, defaults: {} }),
}));

export function openNewIssue(defaults?: NewIssueState['defaults']): void {
  useNewIssue.getState().show(defaults);
}

export function NewIssueDialog() {
  const { open, defaults, hide } = useNewIssue();
  if (!open) return null;
  return <NewIssueDialogInner key={JSON.stringify(defaults)} defaults={defaults} onClose={hide} />;
}

function NewIssueDialogInner({
  defaults,
  onClose,
}: {
  defaults: NewIssueState['defaults'];
  onClose: () => void;
}) {
  const teams = useStore((s) => s.teams);
  const states = useStore((s) => s.workflowStates);
  const users = useStore((s) => s.users);
  const labels = useStore((s) => s.labels);
  const projects = useStore((s) => s.projects);
  const cycles = useStore((s) => s.cycles);
  const navigate = useNavigate();

  const teamList = Object.values(teams).sort((a, b) => a.name.localeCompare(b.name));
  const [teamId, setTeamId] = useState(defaults.teamId ?? teamList[0]?.id ?? '');
  const [title, setTitle] = useState(defaults.title ?? '');
  const [description, setDescription] = useState(defaults.description ?? '');
  const [stateId, setStateId] = useState<string | undefined>(defaults.stateId);
  const [priority, setPriorityValue] = useState<Priority>(0);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<string | null>(defaults.projectId ?? null);
  const [cycleId, setCycleId] = useState<string | null>(defaults.cycleId ?? null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [createMore, setCreateMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const teamPicker = usePicker();
  const statePicker = usePicker();
  const priorityPicker = usePicker();
  const assigneePicker = usePicker();
  const labelPicker = usePicker();
  const projectPicker = usePicker();
  const cyclePicker = usePicker();
  const estimatePicker = usePicker();
  const templatePicker = usePicker();

  const allIssues = useStore((s) => s.issues);
  const templates = useStore((s) => s.issueTemplates);
  const teamTemplates = Object.values(templates)
    .filter((t) => t.teamId === teamId)
    .sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Heuristic duplicate detection: existing open issues in the team whose
  // title shares most significant words with what's being typed.
  const duplicates = useMemo(() => {
    const q = title.trim().toLowerCase();
    if (q.length < 4 || !teamId) return [];
    const words = new Set(q.split(/\s+/).filter((w) => w.length > 2));
    if (words.size === 0) return [];
    return Object.values(allIssues)
      .filter((i) => i.teamId === teamId && !i.archivedAt)
      .map((i) => {
        const titleWords = new Set(i.title.toLowerCase().split(/\s+/));
        let overlap = 0;
        for (const w of words) if (titleWords.has(w)) overlap += 1;
        return { issue: i, score: overlap / words.size };
      })
      .filter((x) => x.score >= 0.6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.issue);
  }, [title, teamId, allIssues]);

  const applyTemplate = (templateId: string) => {
    const tpl = templates[templateId];
    if (!tpl) return;
    if (tpl.titlePrefix && !title) setTitle(tpl.titlePrefix);
    if (tpl.description) setDescription(tpl.description);
    setPriorityValue(tpl.priority);
    setLabelIds([...tpl.labelIds]);
    setEstimate(tpl.estimate);
  };

  const team = teams[teamId];
  const teamStates = teamId ? sortedStates(Object.values(states), teamId) : [];
  const state = stateId
    ? states[stateId]
    : (teamStates.find((s) => s.category === 'backlog') ?? teamStates[0]);
  const assignee = assigneeId ? users[assigneeId] : null;
  const project = projectId ? projects[projectId] : null;
  const cycle = cycleId ? cycles[cycleId] : null;

  const submit = async () => {
    if (!title.trim() || !teamId || saving) return;
    setSaving(true);
    const issue = await createIssue({
      teamId,
      title,
      description,
      stateId: state?.id,
      priority,
      assigneeId,
      labelIds,
      projectId,
      cycleId,
      estimate,
    });
    setSaving(false);
    if (!issue) return;
    const key = issueKey(issue, useStore.getState().teams);
    toast(`Created ${key}`, 'success');
    if (createMore) {
      setTitle('');
      setDescription('');
      titleRef.current?.focus();
    } else {
      onClose();
      navigate(`/issue/${key}`);
    }
  };

  return (
    <Modal onClose={onClose} width={680}>
      <div style={{ padding: '14px 18px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="chip" onClick={(e) => teamPicker.open(anchorFromEvent(e))}>
          <span className="team-icon" style={{ background: team?.color ?? '#666' }}>
            {team?.key.slice(0, 2) ?? '?'}
          </span>
          {team?.name ?? 'Team'}
        </button>
        <span className="dim">› New issue</span>
        <span className="grow" />
        {teamTemplates.length > 0 && (
          <button
            className="chip"
            title="Start from a template"
            onClick={(e) => templatePicker.open(anchorFromEvent(e))}
          >
            Template
          </button>
        )}
        <button className="icon-btn" onClick={onClose}>
          <CloseIcon size={15} />
        </button>
      </div>
      <div style={{ padding: '6px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
          }}
          placeholder="Issue title"
          style={{
            fontSize: 17,
            fontWeight: 600,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: 'var(--text-1)',
            width: '100%',
          }}
        />
        {duplicates.length > 0 && (
          <div
            style={{
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              padding: '6px 10px',
              background: 'var(--bg-raised)',
            }}
          >
            <div className="dim" style={{ fontSize: 11.5, marginBottom: 4 }}>
              Possible duplicate{duplicates.length > 1 ? 's' : ''}:
            </div>
            {duplicates.map((dup) => (
              <button
                key={dup.id}
                className="row"
                style={{ gap: 6, fontSize: 12.5, width: '100%', padding: '2px 0' }}
                onClick={() => {
                  onClose();
                  navigate(`/issue/${issueKey(dup, teams)}`);
                }}
              >
                <span className="dim">{issueKey(dup, teams)}</span>
                <span className="truncate">{dup.title}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
          }}
          placeholder="Add description… (markdown supported)"
          rows={5}
          style={{
            background: 'none',
            border: 'none',
            outline: 'none',
            color: 'var(--text-1)',
            width: '100%',
            resize: 'vertical',
            fontFamily: 'inherit',
            fontSize: 13.5,
            lineHeight: 1.55,
          }}
        />
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button className="chip" onClick={(e) => statePicker.open(anchorFromEvent(e))}>
            {state && <StateIcon category={state.category} color={state.color} size={12} />}
            {state?.name ?? 'Status'}
          </button>
          <button className="chip" onClick={(e) => priorityPicker.open(anchorFromEvent(e))}>
            <PriorityIcon priority={priority} size={12} />
            {PRIORITY_LABELS[priority]}
          </button>
          <button className="chip" onClick={(e) => assigneePicker.open(anchorFromEvent(e))}>
            {assignee ? assignee.name : 'Assignee'}
          </button>
          <button className="chip" onClick={(e) => labelPicker.open(anchorFromEvent(e))}>
            {labelIds.length > 0
              ? labelIds.map((id) => labels[id]?.name ?? '').join(', ')
              : 'Labels'}
          </button>
          <button className="chip" onClick={(e) => projectPicker.open(anchorFromEvent(e))}>
            {project?.name ?? 'Project'}
          </button>
          {team?.cyclesEnabled && (
            <button className="chip" onClick={(e) => cyclePicker.open(anchorFromEvent(e))}>
              {cycle ? cycle.name || `Cycle ${cycle.number}` : 'Cycle'}
            </button>
          )}
          <button className="chip" onClick={(e) => estimatePicker.open(anchorFromEvent(e))}>
            {estimate == null ? 'Estimate' : `${estimate} pts`}
          </button>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 18px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <label
          className="row"
          style={{ gap: 6, color: 'var(--text-3)', fontSize: 12, cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={createMore}
            onChange={(e) => setCreateMore(e.target.checked)}
          />
          Create more
        </label>
        <span className="grow" />
        <span className="dim" style={{ fontSize: 11.5 }}>
          <span className="kbd">⌘</span> <span className="kbd">↵</span> to create
        </span>
        <button
          className="btn primary"
          disabled={!title.trim() || saving}
          onClick={() => void submit()}
        >
          Create issue
        </button>
      </div>

      {teamPicker.anchor && (
        <TeamPicker
          anchor={teamPicker.anchor}
          onClose={teamPicker.close}
          currentId={teamId}
          onPick={(id) => {
            setTeamId(id);
            setStateId(undefined);
            setCycleId(null);
          }}
        />
      )}
      {statePicker.anchor && teamId && (
        <StatePicker
          anchor={statePicker.anchor}
          onClose={statePicker.close}
          teamId={teamId}
          currentId={state?.id}
          onPick={setStateId}
        />
      )}
      {priorityPicker.anchor && (
        <PriorityPicker
          anchor={priorityPicker.anchor}
          onClose={priorityPicker.close}
          currentId={priority}
          onPick={setPriorityValue}
        />
      )}
      {assigneePicker.anchor && (
        <AssigneePicker
          anchor={assigneePicker.anchor}
          onClose={assigneePicker.close}
          currentId={assigneeId}
          onPick={setAssigneeId}
        />
      )}
      {labelPicker.anchor && teamId && (
        <LabelPicker
          anchor={labelPicker.anchor}
          onClose={labelPicker.close}
          teamId={teamId}
          selected={labelIds}
          onToggle={(id) =>
            setLabelIds((prev) =>
              prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id],
            )
          }
        />
      )}
      {projectPicker.anchor && teamId && (
        <ProjectPicker
          anchor={projectPicker.anchor}
          onClose={projectPicker.close}
          teamId={teamId}
          currentId={projectId}
          onPick={setProjectId}
        />
      )}
      {cyclePicker.anchor && teamId && (
        <CyclePicker
          anchor={cyclePicker.anchor}
          onClose={cyclePicker.close}
          teamId={teamId}
          currentId={cycleId}
          onPick={setCycleId}
        />
      )}
      {estimatePicker.anchor && (
        <EstimatePicker
          anchor={estimatePicker.anchor}
          onClose={estimatePicker.close}
          current={estimate}
          onPick={setEstimate}
          teamId={teamId}
        />
      )}
      {templatePicker.anchor && (
        <Picker
          anchor={templatePicker.anchor}
          onClose={templatePicker.close}
          placeholder="Apply template…"
          items={teamTemplates.map((t) => ({ id: t.id, label: t.name }))}
          onPick={(id) => {
            applyTemplate(id);
            templatePicker.close();
          }}
        />
      )}
    </Modal>
  );
}
