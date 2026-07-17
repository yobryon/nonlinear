import { useMemo, useState } from 'react';
import type { Priority, Team, TriageRule } from '@nonlinear/shared';
import { PRIORITY_LABELS } from '@nonlinear/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { anchorFromEvent, Avatar, Switch, toastError } from '../ui.js';
import {
  CloseIcon,
  LabelIcon,
  PencilIcon,
  PlusIcon,
  PriorityIcon,
  ProjectIcon,
  TrashIcon,
  UserIcon,
} from '../icons.js';
import {
  AssigneePicker,
  LabelPicker,
  PriorityPicker,
  ProjectPicker,
  usePicker,
} from '../pickers.js';

function RuleForm({ team, rule, onDone }: { team: Team; rule?: TriageRule; onDone: () => void }) {
  const users = useStore((s) => s.users);
  const labels = useStore((s) => s.labels);
  const projects = useStore((s) => s.projects);
  const [name, setName] = useState(rule?.name ?? '');
  const [keywordsText, setKeywordsText] = useState(rule?.keywords.join(', ') ?? '');
  const [setPriority, setSetPriority] = useState<Priority | null>(rule?.setPriority ?? null);
  const [assigneeId, setAssigneeId] = useState<string | null>(rule?.setAssigneeId ?? null);
  const [labelIds, setLabelIds] = useState<string[]>(rule?.setLabelIds ?? []);
  const [projectId, setProjectId] = useState<string | null>(rule?.setProjectId ?? null);
  const [saving, setSaving] = useState(false);
  const priorityPk = usePicker();
  const assigneePk = usePicker();
  const labelPk = usePicker();
  const projectPk = usePicker();

  const keywords = keywordsText
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const assignee = assigneeId ? users[assigneeId] : null;
  const labelNames = labelIds
    .map((id) => labels[id]?.name)
    .filter((n): n is string => Boolean(n))
    .join(', ');

  const save = async () => {
    setSaving(true);
    try {
      const fields = {
        name: name.trim(),
        keywords,
        setPriority,
        setAssigneeId: assigneeId,
        setLabelIds: labelIds,
        setProjectId: projectId,
      };
      const result = rule
        ? await api.updateTriageRule(rule.id, fields)
        : await api.createTriageRule({ teamId: team.id, ...fields });
      useStore.getState().putEntity('triageRule', result);
      onDone();
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 12,
        margin: '8px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: 560,
      }}
    >
      <div>
        <label className="field-label">Name</label>
        <input
          className="input"
          placeholder="Route crash reports"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="field-label">Keywords</label>
        <input
          className="input"
          placeholder="crash, exception, segfault"
          value={keywordsText}
          onChange={(e) => setKeywordsText(e.target.value)}
        />
        <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
          Comma-separated; the rule matches when any keyword appears in the title or description.
        </div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <button type="button" className="chip" onClick={(e) => priorityPk.open(anchorFromEvent(e))}>
          {setPriority != null && <PriorityIcon priority={setPriority} size={12} />}
          {setPriority == null ? 'Set priority' : PRIORITY_LABELS[setPriority]}
          {setPriority != null && (
            <span
              style={{ display: 'inline-flex', cursor: 'pointer' }}
              title="Clear priority"
              onClick={(e) => {
                e.stopPropagation();
                setSetPriority(null);
              }}
            >
              <CloseIcon size={11} />
            </span>
          )}
        </button>
        <button type="button" className="chip" onClick={(e) => assigneePk.open(anchorFromEvent(e))}>
          {assignee ? <Avatar user={assignee} size={14} /> : <UserIcon size={12} />}
          {assignee ? assignee.name : 'Set assignee'}
        </button>
        <button type="button" className="chip" onClick={(e) => labelPk.open(anchorFromEvent(e))}>
          <LabelIcon size={12} />
          {labelIds.length === 0 ? 'Add labels' : labelNames}
        </button>
        <button type="button" className="chip" onClick={(e) => projectPk.open(anchorFromEvent(e))}>
          <ProjectIcon size={12} />
          {projectId ? (projects[projectId]?.name ?? 'Project') : 'Set project'}
        </button>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
        <button className="btn ghost" onClick={onDone}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!name.trim() || keywords.length === 0 || saving}
          onClick={() => void save()}
        >
          {rule ? 'Save rule' : 'Create rule'}
        </button>
      </div>
      {priorityPk.anchor && (
        <PriorityPicker
          anchor={priorityPk.anchor}
          onClose={priorityPk.close}
          currentId={setPriority ?? undefined}
          onPick={setSetPriority}
        />
      )}
      {assigneePk.anchor && (
        <AssigneePicker
          anchor={assigneePk.anchor}
          onClose={assigneePk.close}
          currentId={assigneeId}
          onPick={setAssigneeId}
        />
      )}
      {labelPk.anchor && (
        <LabelPicker
          anchor={labelPk.anchor}
          onClose={labelPk.close}
          teamId={team.id}
          selected={labelIds}
          onToggle={(id) =>
            setLabelIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
          }
        />
      )}
      {projectPk.anchor && (
        <ProjectPicker
          anchor={projectPk.anchor}
          onClose={projectPk.close}
          teamId={team.id}
          currentId={projectId}
          onPick={setProjectId}
        />
      )}
    </div>
  );
}

export function TriageRulesSettings({ team }: { team: Team }) {
  const rules = useStore((s) => s.triageRules);
  const users = useStore((s) => s.users);
  const projects = useStore((s) => s.projects);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () =>
      Object.values(rules)
        .filter((r) => r.teamId === team.id)
        .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)),
    [rules, team.id],
  );

  const setEnabled = (rule: TriageRule, enabled: boolean) => {
    void api
      .updateTriageRule(rule.id, { enabled })
      .then((r) => useStore.getState().putEntity('triageRule', r))
      .catch(toastError);
  };

  const remove = (id: string) => {
    void api
      .deleteTriageRule(id)
      .then(() => {
        const next = { ...useStore.getState().triageRules };
        delete next[id];
        useStore.setState({ triageRules: next });
      })
      .catch(toastError);
  };

  const actionSummary = (rule: TriageRule): string => {
    const parts: string[] = [];
    if (rule.setPriority != null) parts.push(`priority ${PRIORITY_LABELS[rule.setPriority]}`);
    if (rule.setAssigneeId) parts.push(`assign ${users[rule.setAssigneeId]?.name ?? 'someone'}`);
    if (rule.setLabelIds.length > 0) {
      parts.push(`+${rule.setLabelIds.length} label${rule.setLabelIds.length === 1 ? '' : 's'}`);
    }
    if (rule.setProjectId) parts.push(`project ${projects[rule.setProjectId]?.name ?? '?'}`);
    return parts.length > 0 ? parts.join(' · ') : 'No actions';
  };

  return (
    <>
      <p className="muted" style={{ marginBottom: 8 }}>
        Rules run top-down on new issues; the first match applies.
      </p>
      {rows.length === 0 && !creating && (
        <p className="muted" style={{ padding: '8px 0' }}>
          No rules yet. Create a rule to set priority, assignee, labels or project on matching new
          issues.
        </p>
      )}
      {rows.map((rule) =>
        editingId === rule.id ? (
          <RuleForm key={rule.id} team={team} rule={rule} onDone={() => setEditingId(null)} />
        ) : (
          <div key={rule.id} className="member-row">
            <Switch on={rule.enabled} onChange={(on) => setEnabled(rule, on)} />
            <div className="info">
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontWeight: 500 }}>{rule.name}</span>
                {rule.keywords.map((k) => (
                  <span key={k} className="chip">
                    {k}
                  </span>
                ))}
              </div>
              <div className="dim">{actionSummary(rule)}</div>
            </div>
            <button className="icon-btn" title="Edit rule" onClick={() => setEditingId(rule.id)}>
              <PencilIcon size={13} />
            </button>
            <button className="icon-btn" title="Delete rule" onClick={() => remove(rule.id)}>
              <TrashIcon size={13} />
            </button>
          </div>
        ),
      )}
      {creating ? (
        <RuleForm team={team} onDone={() => setCreating(false)} />
      ) : (
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setCreating(true)}>
          <PlusIcon size={13} /> New rule
        </button>
      )}
    </>
  );
}
