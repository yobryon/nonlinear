import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Decision, DecisionStatus } from '@nonlinear/shared';
import { api } from '../api.js';
import { relativeTime, useStore } from '../store.js';
import { anchorFromEvent, Avatar, Modal, Popover, toastError, type Anchor } from '../ui.js';
import { Markdown } from '../markdown.js';
import { DotsIcon, PlusIcon, TrashIcon } from '../icons.js';
import { AssigneePicker, usePicker } from '../pickers.js';
import { OriginCrumb, OriginProvider, originState } from '../nav.js';

const STATUS_META: Record<DecisionStatus, { label: string; color: string }> = {
  proposed: { label: 'Proposed', color: 'var(--warning)' },
  ruled: { label: 'Ruled', color: 'var(--success)' },
  superseded: { label: 'Superseded', color: 'var(--text-4)' },
  carried: { label: 'Carried', color: 'var(--accent-text)' },
};

const STATUS_ORDER: DecisionStatus[] = ['proposed', 'ruled', 'carried', 'superseded'];

function StatusChip({ status }: { status: DecisionStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="status-chip" style={{ color: meta.color }}>
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

function decisionKey(d: Decision, teamKey: string): string {
  return `${teamKey}-D${d.number}`;
}

export function DecisionsPage() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const teams = useStore((s) => s.teams);
  const decisions = useStore((s) => s.decisions);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const team = teamKey ? Object.values(teams).find((t) => t.key === teamKey) : null;
  const rows = useMemo(
    () =>
      Object.values(decisions)
        .filter((d) => team && d.teamId === team.id)
        .sort(
          (a, b) =>
            STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.number - a.number,
        ),
    [decisions, team],
  );

  if (!team)
    return (
      <div className="empty-state">
        <h3>Team not found</h3>
      </div>
    );

  return (
    <>
      <div className="topbar">
        <div className="title">Decisions · {team.name}</div>
        <span className="spacer" />
        <a
          className="btn ghost"
          href={`/api/teams/${team.id}/decisions.md`}
          target="_blank"
          rel="noreferrer"
        >
          Export .md
        </a>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <PlusIcon size={13} /> New decision
        </button>
      </div>
      <div className="content">
        {rows.length === 0 && (
          <div className="empty-state">
            <h3>No decisions yet</h3>
            <p>
              A decision is a judgment — an argument and a ruling, not a work item. Record the
              tradeoffs and rulings that govern this team’s work so the reasoning lives where the
              work does.
            </p>
            <button className="btn primary" onClick={() => setCreating(true)}>
              Record the first decision
            </button>
          </div>
        )}
        <OriginProvider
          value={{ label: `${team.name} · Decisions`, to: `/team/${team.key}/decisions` }}
        >
          {rows.map((d) => (
            <div
              key={d.id}
              className="issue-row"
              onClick={() =>
                navigate(`/decision/${d.id}`, {
                  state: originState({
                    label: `${team.name} · Decisions`,
                    to: `/team/${team.key}/decisions`,
                  }),
                })
              }
            >
              <span className="identifier dim">{decisionKey(d, team.key)}</span>
              <span className="title" style={{ fontWeight: 500 }}>
                {d.title}
              </span>
              <StatusChip status={d.status} />
              <span className="dim">edited {relativeTime(d.updatedAt)} ago</span>
            </div>
          ))}
        </OriginProvider>
      </div>
      {creating && <NewDecisionDialog teamId={team.id} onClose={() => setCreating(false)} />}
    </>
  );
}

function NewDecisionDialog({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const decision = await api.createDecision({ teamId, title, body });
      useStore.getState().putEntity('decision', decision);
      onClose();
      navigate(`/decision/${decision.id}`);
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} width={560}>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ fontSize: 16 }}>New decision</h2>
        <div>
          <label className="field-label">Title</label>
          <input
            className="input"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="The question being decided"
          />
        </div>
        <div>
          <label className="field-label">The argument</label>
          <textarea
            className="input"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="State the options, the tradeoffs, and the reasoning. Markdown supported."
          />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!title.trim() || saving}
            onClick={() => void submit()}
          >
            Propose decision
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function DecisionDetailPage() {
  const { decisionId } = useParams<{ decisionId: string }>();
  const decision = useStore((s) => (decisionId ? s.decisions[decisionId] : undefined));
  if (!decision)
    return (
      <div className="empty-state">
        <h3>Decision not found</h3>
      </div>
    );
  return <DecisionDetail decision={decision} />;
}

function DecisionDetail({ decision }: { decision: Decision }) {
  const teams = useStore((s) => s.teams);
  const users = useStore((s) => s.users);
  const issues = useStore((s) => s.issues);
  const decisions = useStore((s) => s.decisions);
  const comments = useStore((s) => s.decisionComments);
  const userId = useStore((s) => s.userId);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [bodyDraft, setBodyDraft] = useState(decision.body);
  const [ruleNote, setRuleNote] = useState('');
  const [menuAnchor, setMenuAnchor] = useState<Anchor | null>(null);
  const [supAnchor, setSupAnchor] = useState<Anchor | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [confirm, setConfirm] = useState<'rule' | 'carry' | null>(null);
  const waitingPicker = usePicker();

  // Read-through: opening the decision clears its unread notifications.
  useEffect(() => {
    const notes = useStore.getState().notifications;
    if (Object.values(notes).some((n) => !n.readAt && n.decisionId === decision.id)) {
      void api.readThrough({ decisionId: decision.id }).catch(() => {});
    }
  }, [decision.id]);

  const team = teams[decision.teamId];
  const waitingOn = decision.waitingOnId ? users[decision.waitingOnId] : null;
  const kid = team ? `${team.key}-D${decision.number}` : decision.id;
  const author = users[decision.authorId];
  const ruledBy = decision.ruledById ? users[decision.ruledById] : null;
  const supersedes = decision.supersedesId ? decisions[decision.supersedesId] : null;
  const supersededBy = Object.values(decisions).find((d) => d.supersedesId === decision.id);
  const governed = decision.governedIssueIds.map((id) => issues[id]).filter(Boolean);
  const thread = Object.values(comments)
    .filter((c) => c.decisionId === decision.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const teamDecisions = Object.values(decisions)
    .filter((d) => d.teamId === decision.teamId && d.id !== decision.id)
    .sort((a, b) => b.number - a.number);

  const patch = async (fn: () => Promise<Decision>) => {
    try {
      useStore.getState().putEntity('decision', await fn());
    } catch (err) {
      toastError(err);
    }
  };

  const saveBody = () => {
    setEditing(false);
    if (bodyDraft !== decision.body)
      void patch(() => api.updateDecision(decision.id, { body: bodyDraft }));
  };

  const postComment = async () => {
    if (!commentBody.trim()) return;
    try {
      const c = await api.createDecisionComment({ decisionId: decision.id, body: commentBody });
      useStore.getState().putEntity('decisionComment', c);
      setCommentBody('');
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="title">
          <OriginCrumb
            fallback={
              team && (
                <Link to={`/team/${team.key}/decisions`} className="crumb">
                  {team.name} decisions
                </Link>
              )
            }
          />
          <span className="crumb">›</span>
          <span>{kid}</span>
        </div>
        <span className="spacer" />
        <StatusChip status={decision.status} />
        {decision.status === 'proposed' && (
          <button className="btn primary" onClick={() => setConfirm('rule')}>
            Rule…
          </button>
        )}
        {decision.status === 'ruled' && (
          <button className="btn ghost" onClick={() => setConfirm('carry')}>
            Carry…
          </button>
        )}
        <button className="btn ghost" onClick={(e) => setSupAnchor(anchorFromEvent(e))}>
          Supersedes…
        </button>
        <button className="icon-btn" onClick={(e) => setMenuAnchor(anchorFromEvent(e))}>
          <DotsIcon size={15} />
        </button>
      </div>

      <div className="detail">
        <div className="detail-main">
          <div className="container">
            <h1 className="detail-title" style={{ fontSize: 21, fontWeight: 650 }}>
              {decision.title}
            </h1>

            <div style={{ marginTop: 14 }}>
              {editing ? (
                <div>
                  <textarea
                    className="input"
                    autoFocus
                    rows={Math.max(8, bodyDraft.split('\n').length + 1)}
                    value={bodyDraft}
                    onChange={(e) => setBodyDraft(e.target.value)}
                  />
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                    <button
                      className="btn ghost"
                      onClick={() => {
                        setBodyDraft(decision.body);
                        setEditing(false);
                      }}
                    >
                      Cancel
                    </button>
                    <button className="btn primary" onClick={saveBody}>
                      Save
                    </button>
                  </div>
                </div>
              ) : decision.body.trim() ? (
                <div onDoubleClick={() => setEditing(true)} style={{ cursor: 'text' }}>
                  <Markdown source={decision.body} />
                  <button
                    className="btn ghost"
                    style={{ marginTop: 6 }}
                    onClick={() => setEditing(true)}
                  >
                    Edit argument
                  </button>
                </div>
              ) : (
                <button
                  className="btn ghost"
                  style={{ color: 'var(--text-4)' }}
                  onClick={() => setEditing(true)}
                >
                  State the argument…
                </button>
              )}
            </div>

            {/* comments — where the decider answers */}
            <div style={{ marginTop: 28, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Discussion</span>
              <div style={{ marginTop: 8 }}>
                {thread.map((c) => {
                  const who = users[c.userId];
                  return (
                    <div key={c.id} className="comment">
                      <div className="comment-head">
                        <Avatar user={who} size={20} />
                        <span className="who">{who?.name ?? 'Unknown'}</span>
                        <span className="when">{relativeTime(c.createdAt)}</span>
                        {c.userId === userId && (
                          <>
                            <span className="grow" />
                            <button
                              className="icon-btn"
                              style={{ width: 22, height: 22 }}
                              title="Delete"
                              onClick={() => {
                                void api
                                  .deleteDecisionComment(c.id)
                                  .then(() => {
                                    const next = { ...useStore.getState().decisionComments };
                                    delete next[c.id];
                                    useStore.setState({ decisionComments: next });
                                  })
                                  .catch(toastError);
                              }}
                            >
                              <TrashIcon size={12} />
                            </button>
                          </>
                        )}
                      </div>
                      <div className="comment-body">
                        <Markdown source={c.body} />
                      </div>
                    </div>
                  );
                })}
                <div className="comment" style={{ marginTop: 16 }}>
                  <textarea
                    className="input"
                    style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}
                    placeholder="Answer, or add context… (⌘↵ to send)"
                    rows={3}
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void postComment();
                    }}
                  />
                  <div
                    className="row"
                    style={{ justifyContent: 'flex-end', padding: '0 10px 10px' }}
                  >
                    <button
                      className="btn primary"
                      disabled={!commentBody.trim()}
                      onClick={() => void postComment()}
                    >
                      Comment
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="detail-side">
          <div className="side-heading">Properties</div>
          <div className="prop-row">
            <span className="prop-label">Status</span>
            <StatusChip status={decision.status} />
          </div>
          <div className="prop-row">
            <span className="prop-label">Author</span>
            <span className="row" style={{ gap: 6 }}>
              <Avatar user={author} size={16} />
              {author?.name ?? '—'}
            </span>
          </div>
          <div className="prop-row">
            <span className="prop-label">Ruled by</span>
            {ruledBy ? (
              <span className="row" style={{ gap: 6 }}>
                <Avatar user={ruledBy} size={16} />
                {ruledBy.name}
              </span>
            ) : (
              <span className="muted">Not yet ruled</span>
            )}
          </div>
          {decision.status === 'proposed' && (
            <div className="prop-row">
              <span className="prop-label">Waiting on</span>
              <button
                className="prop-value"
                onClick={(e) => waitingPicker.open(anchorFromEvent(e))}
              >
                {waitingOn ? (
                  <>
                    <Avatar user={waitingOn} size={16} />
                    {waitingOn.name}
                  </>
                ) : (
                  <span className="muted">Anyone</span>
                )}
              </button>
            </div>
          )}

          <div className="side-heading">Supersession</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.8 }}>
            {supersedes && team && (
              <div>
                Supersedes{' '}
                <Link to={`/decision/${supersedes.id}`}>
                  {team.key}-D{supersedes.number}
                </Link>
              </div>
            )}
            {supersededBy && team && (
              <div>
                Superseded by{' '}
                <Link to={`/decision/${supersededBy.id}`}>
                  {team.key}-D{supersededBy.number}
                </Link>
              </div>
            )}
            {!supersedes && !supersededBy && <span className="muted">Original, in force</span>}
          </div>

          <div className="side-heading">Governs</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {governed.length === 0 && (
              <span className="muted" style={{ fontSize: 12.5 }}>
                No linked issues
              </span>
            )}
            {governed.map((i) => (
              <Link
                key={i!.id}
                to={`/issue/${team?.key}-${i!.number}`}
                className="row"
                style={{ gap: 6, fontSize: 12.5 }}
              >
                <span className="dim">
                  {team?.key}-{i!.number}
                </span>
                <span className="truncate">{i!.title}</span>
              </Link>
            ))}
          </div>

          <div className="side-heading">About</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.8 }}>
            Proposed {relativeTime(decision.createdAt)} ago
            {decision.ruledAt && (
              <>
                <br />
                Ruled {relativeTime(decision.ruledAt)} ago
              </>
            )}
          </div>
        </div>
      </div>

      {confirm && (
        <Modal onClose={() => setConfirm(null)} width={480}>
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {confirm === 'rule' ? (
              <>
                <h2 style={{ fontSize: 16 }}>Rule on {kid}?</h2>
                <p className="dim" style={{ margin: 0 }}>
                  Marks this decision <strong>ruled</strong>, credited to you. Add an optional note
                  — it lands as a comment on the record.
                </p>
                <textarea
                  className="input"
                  rows={3}
                  autoFocus
                  placeholder="Optional note to record with your ruling…"
                  value={ruleNote}
                  onChange={(e) => setRuleNote(e.target.value)}
                />
              </>
            ) : (
              <>
                <h2 style={{ fontSize: 16 }}>Carry {kid}?</h2>
                <p className="dim" style={{ margin: 0 }}>
                  Reaffirms this ruled decision as still in force after review.
                </p>
              </>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn ghost" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const action = confirm;
                  setConfirm(null);
                  void patch(() =>
                    action === 'rule'
                      ? api.ruleDecision(decision.id, ruleNote || undefined)
                      : api.carryDecision(decision.id),
                  );
                }}
              >
                {confirm === 'rule' ? 'Rule' : 'Carry'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {waitingPicker.anchor && (
        <AssigneePicker
          anchor={waitingPicker.anchor}
          onClose={waitingPicker.close}
          currentId={decision.waitingOnId}
          onPick={(id) => void patch(() => api.updateDecision(decision.id, { waitingOnId: id }))}
        />
      )}
      {supAnchor && (
        <Popover anchor={supAnchor} onClose={() => setSupAnchor(null)} width={260}>
          <div className="menu-heading">This decision supersedes…</div>
          {teamDecisions.length === 0 && <div className="menu-item muted">No other decisions</div>}
          {teamDecisions.map((d) => (
            <button
              key={d.id}
              className="menu-item"
              onClick={() => {
                void patch(() => api.supersedeDecision(decision.id, d.id));
                setSupAnchor(null);
              }}
            >
              <span className="dim" style={{ width: 64 }}>
                {team?.key}-D{d.number}
              </span>
              <span className="grow truncate">{d.title}</span>
            </button>
          ))}
        </Popover>
      )}
      {menuAnchor && (
        <Popover anchor={menuAnchor} onClose={() => setMenuAnchor(null)} width={180}>
          <button
            className="menu-item destructive"
            onClick={() => {
              setMenuAnchor(null);
              void api
                .deleteDecision(decision.id)
                .then(() => {
                  const next = { ...useStore.getState().decisions };
                  delete next[decision.id];
                  useStore.setState({ decisions: next });
                  if (team) navigate(`/team/${team.key}/decisions`);
                })
                .catch(toastError);
            }}
          >
            <TrashIcon size={14} />
            <span className="grow">Delete decision</span>
          </button>
        </Popover>
      )}
    </>
  );
}
