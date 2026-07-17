import { useMemo, useState } from 'react';
import type { IssueTemplate, Priority, Team } from '@nonlinear/shared';
import { PRIORITY_LABELS } from '@nonlinear/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { anchorFromEvent, toastError } from '../ui.js';
import {
  EstimateIcon,
  LabelIcon,
  PencilIcon,
  PlusIcon,
  PriorityIcon,
  TrashIcon,
} from '../icons.js';
import { EstimatePicker, LabelPicker, PriorityPicker, usePicker } from '../pickers.js';

function TemplateForm({
  team,
  template,
  onDone,
}: {
  team: Team;
  template?: IssueTemplate;
  onDone: () => void;
}) {
  const labels = useStore((s) => s.labels);
  const [name, setName] = useState(template?.name ?? '');
  const [titlePrefix, setTitlePrefix] = useState(template?.titlePrefix ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [priority, setPriority] = useState<Priority>(template?.priority ?? 0);
  const [labelIds, setLabelIds] = useState<string[]>(template?.labelIds ?? []);
  const [estimate, setEstimate] = useState<number | null>(template?.estimate ?? null);
  const [saving, setSaving] = useState(false);
  const priorityPk = usePicker();
  const labelPk = usePicker();
  const estimatePk = usePicker();

  const labelNames = labelIds
    .map((id) => labels[id]?.name)
    .filter((n): n is string => Boolean(n))
    .join(', ');

  const save = async () => {
    setSaving(true);
    try {
      const fields = {
        name: name.trim(),
        titlePrefix: titlePrefix.trim(),
        description,
        priority,
        labelIds,
        estimate,
      };
      const result = template
        ? await api.updateTemplate(template.id, fields)
        : await api.createTemplate({ teamId: team.id, ...fields });
      useStore.getState().putEntity('issueTemplate', result);
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
          placeholder="Bug report"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="field-label">Title prefix</label>
        <input
          className="input"
          placeholder="Bug:"
          value={titlePrefix}
          onChange={(e) => setTitlePrefix(e.target.value)}
        />
      </div>
      <div>
        <label className="field-label">Description</label>
        <textarea
          className="input"
          placeholder="Steps to reproduce…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <button type="button" className="chip" onClick={(e) => priorityPk.open(anchorFromEvent(e))}>
          <PriorityIcon priority={priority} size={12} />
          {PRIORITY_LABELS[priority]}
        </button>
        <button type="button" className="chip" onClick={(e) => labelPk.open(anchorFromEvent(e))}>
          <LabelIcon size={12} />
          {labelIds.length === 0 ? 'Labels' : labelNames}
        </button>
        <button type="button" className="chip" onClick={(e) => estimatePk.open(anchorFromEvent(e))}>
          <EstimateIcon size={12} />
          {estimate == null ? 'Estimate' : `${estimate} pts`}
        </button>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
        <button className="btn ghost" onClick={onDone}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!name.trim() || saving}
          onClick={() => void save()}
        >
          {template ? 'Save template' : 'Create template'}
        </button>
      </div>
      {priorityPk.anchor && (
        <PriorityPicker
          anchor={priorityPk.anchor}
          onClose={priorityPk.close}
          currentId={priority}
          onPick={setPriority}
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
      {estimatePk.anchor && (
        <EstimatePicker
          anchor={estimatePk.anchor}
          onClose={estimatePk.close}
          current={estimate}
          onPick={setEstimate}
        />
      )}
    </div>
  );
}

export function TemplatesSettings({ team }: { team: Team }) {
  const templates = useStore((s) => s.issueTemplates);
  const labels = useStore((s) => s.labels);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () =>
      Object.values(templates)
        .filter((t) => t.teamId === team.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [templates, team.id],
  );

  const remove = (id: string) => {
    void api
      .deleteTemplate(id)
      .then(() => {
        const next = { ...useStore.getState().issueTemplates };
        delete next[id];
        useStore.setState({ issueTemplates: next });
      })
      .catch(toastError);
  };

  const summary = (t: IssueTemplate): string => {
    const parts: string[] = [];
    if (t.titlePrefix) parts.push(`prefix "${t.titlePrefix}"`);
    if (t.priority !== 0) parts.push(PRIORITY_LABELS[t.priority]);
    if (t.labelIds.length > 0) {
      const names = t.labelIds.map((id) => labels[id]?.name).filter(Boolean);
      parts.push(names.length <= 3 ? names.join(', ') : `${names.length} labels`);
    }
    if (t.estimate != null) parts.push(`${t.estimate} pts`);
    return parts.length > 0 ? parts.join(' · ') : 'No presets';
  };

  return (
    <>
      {rows.length === 0 && !creating && (
        <p className="muted" style={{ padding: '8px 0' }}>
          No templates yet. Create one to prefill title, priority, labels and estimate on new
          issues.
        </p>
      )}
      {rows.map((t) =>
        editingId === t.id ? (
          <TemplateForm key={t.id} team={team} template={t} onDone={() => setEditingId(null)} />
        ) : (
          <div key={t.id} className="member-row">
            <div className="info">
              <div style={{ fontWeight: 500 }}>{t.name}</div>
              <div className="dim">{summary(t)}</div>
            </div>
            <button className="icon-btn" title="Edit template" onClick={() => setEditingId(t.id)}>
              <PencilIcon size={13} />
            </button>
            <button className="icon-btn" title="Delete template" onClick={() => remove(t.id)}>
              <TrashIcon size={13} />
            </button>
          </div>
        ),
      )}
      {creating ? (
        <TemplateForm team={team} onDone={() => setCreating(false)} />
      ) : (
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setCreating(true)}>
          <PlusIcon size={13} /> New template
        </button>
      )}
    </>
  );
}
