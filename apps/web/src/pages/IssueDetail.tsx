import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { IssueActivity, IssueRelationType } from '@nonlinear/shared';
import { PRIORITY_LABELS } from '@nonlinear/shared';
import { api } from '../api.js';
import { formatDate, issueKey, relativeTime, useStore } from '../store.js';
import { anchorFromEvent, Avatar, Popover, toast, toastError, type Anchor } from '../ui.js';
import {
  CalendarIcon,
  CopyIcon,
  CycleIcon,
  DotsIcon,
  EstimateIcon,
  LabelIcon,
  LinkIcon,
  ParentIcon,
  PlusIcon,
  PriorityIcon,
  ProjectIcon,
  SendIcon,
  StarIcon,
  StateIcon,
  TrashIcon,
  UserIcon,
  BellIcon,
  ClockIcon,
} from '../icons.js';
import { Markdown } from '../markdown.js';
import {
  AssigneePicker,
  CyclePicker,
  DueDatePicker,
  EstimatePicker,
  IssuePicker,
  LabelPicker,
  PriorityPicker,
  ProjectPicker,
  StatePicker,
  TeamPicker,
  usePicker,
} from '../pickers.js';
import { deleteIssue, patchIssue, toggleFavorite, toggleLabel } from '../actions.js';
import { openNewIssue } from '../NewIssueDialog.js';
import { IssueRow } from '../issueViews.js';

export function IssueDetailPage() {
  const { key } = useParams<{ key: string }>();
  const teams = useStore((s) => s.teams);
  const issues = useStore((s) => s.issues);

  const issue = useMemo(() => {
    if (!key) return null;
    const dash = key.lastIndexOf('-');
    if (dash < 1) return null;
    const teamKey = key.slice(0, dash).toUpperCase();
    const number = Number(key.slice(dash + 1));
    const team = Object.values(teams).find((t) => t.key === teamKey);
    if (!team) return null;
    return Object.values(issues).find((i) => i.teamId === team.id && i.number === number) ?? null;
  }, [key, teams, issues]);

  if (!issue) {
    return (
      <div className="empty-state">
        <h3>Issue not found</h3>
        <p>It may have been deleted.</p>
      </div>
    );
  }
  return <IssueDetail issueId={issue.id} />;
}

function IssueDetail({ issueId }: { issueId: string }) {
  const maybeIssue = useStore((s) => s.issues[issueId]);
  const teams = useStore((s) => s.teams);
  const states = useStore((s) => s.workflowStates);
  const users = useStore((s) => s.users);
  const labels = useStore((s) => s.labels);
  const projects = useStore((s) => s.projects);
  const milestones = useStore((s) => s.projectMilestones);
  const cycles = useStore((s) => s.cycles);
  const comments = useStore((s) => s.comments);
  const reactions = useStore((s) => s.reactions);
  const relations = useStore((s) => s.issueRelations);
  const allIssues = useStore((s) => s.issues);
  const favorites = useStore((s) => s.favorites);
  const reminders = useStore((s) => s.issueReminders);
  const userId = useStore((s) => s.userId);
  const navigate = useNavigate();

  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(maybeIssue?.description ?? '');
  const [titleDraft, setTitleDraft] = useState(maybeIssue?.title ?? '');
  const [activities, setActivities] = useState<IssueActivity[]>([]);
  const [menuAnchor, setMenuAnchor] = useState<Anchor | null>(null);
  const [reminderAnchor, setReminderAnchor] = useState<Anchor | null>(null);
  const [relAnchor, setRelAnchor] = useState<Anchor | null>(null);
  const [relType, setRelType] = useState<IssueRelationType>('blocks');

  const statePicker = usePicker();
  const priorityPicker = usePicker();
  const assigneePicker = usePicker();
  const labelPicker = usePicker();
  const projectPicker = usePicker();
  const cyclePicker = usePicker();
  const estimatePicker = usePicker();
  const duePicker = usePicker();
  const parentPicker = usePicker();
  const teamPicker = usePicker();
  const relationTargetPicker = usePicker();

  const liveTitle = maybeIssue?.title;
  const liveDescription = maybeIssue?.description;
  const liveUpdatedAt = maybeIssue?.updatedAt;

  useEffect(() => {
    if (liveTitle !== undefined) setTitleDraft(liveTitle);
  }, [liveTitle]);
  useEffect(() => {
    if (!editingDesc && liveDescription !== undefined) setDescDraft(liveDescription);
  }, [liveDescription, editingDesc]);
  useEffect(() => {
    let alive = true;
    void api
      .issueActivities(issueId)
      .then((rows) => {
        if (alive) setActivities(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [issueId, liveUpdatedAt]);

  // Parent (IssueDetailPage) swaps to "not found" when the issue disappears;
  // this guard covers the same-render race. All hooks are above it.
  if (!maybeIssue) return null;
  const issue = maybeIssue;

  const team = teams[issue.teamId];
  const state = states[issue.stateId];
  const assignee = issue.assigneeId ? users[issue.assigneeId] : null;
  const creator = users[issue.creatorId];
  const project = issue.projectId ? projects[issue.projectId] : null;
  const milestone = issue.milestoneId ? milestones[issue.milestoneId] : null;
  const cycle = issue.cycleId ? cycles[issue.cycleId] : null;
  const parent = issue.parentId ? allIssues[issue.parentId] : null;
  const kid = issueKey(issue, teams);

  const issueComments = Object.values(comments)
    .filter((c) => c.issueId === issueId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const children = Object.values(allIssues)
    .filter((i) => i.parentId === issueId)
    .sort((a, b) => a.number - b.number);

  const issueRelations = Object.values(relations).filter(
    (r) => r.issueId === issueId || r.relatedIssueId === issueId,
  );

  const myReminder = Object.values(reminders).find(
    (r) => r.issueId === issueId && r.userId === userId,
  );
  const isFavorite = Object.values(favorites).some(
    (f) => f.userId === userId && f.type === 'issue' && f.targetId === issueId,
  );
  const subscribed = userId !== null && issue.subscriberIds.includes(userId);

  const saveTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== issue.title) void patchIssue(issueId, { title: trimmed });
    else setTitleDraft(issue.title);
  };

  const saveDescription = () => {
    setEditingDesc(false);
    if (descDraft !== issue.description) void patchIssue(issueId, { description: descDraft });
  };

  const relationLabel = (type: IssueRelationType, outgoing: boolean): string => {
    if (type === 'blocks') return outgoing ? 'Blocks' : 'Blocked by';
    if (type === 'duplicate') return outgoing ? 'Duplicate of' : 'Duplicated by';
    return 'Related to';
  };

  return (
    <>
      <div className="topbar">
        <div className="title">
          {team && (
            <Link to={`/team/${team.key}/issues`} className="crumb">
              {team.name}
            </Link>
          )}
          <span className="crumb">›</span>
          <span>{kid}</span>
        </div>
        <span className="spacer" />
        <button
          className={`icon-btn${subscribed ? ' active' : ''}`}
          title={subscribed ? 'Unsubscribe' : 'Subscribe'}
          onClick={() => {
            const next = subscribed
              ? issue.subscriberIds.filter((id) => id !== userId)
              : [...issue.subscriberIds, userId!];
            void patchIssue(issueId, { subscriberIds: next });
          }}
        >
          <BellIcon size={15} />
        </button>
        <button
          className={`icon-btn${myReminder ? ' active' : ''}`}
          title={myReminder ? 'Reminder set' : 'Remind me'}
          onClick={(e) => setReminderAnchor(anchorFromEvent(e))}
        >
          <ClockIcon size={15} />
        </button>
        <button
          className={`icon-btn${isFavorite ? ' active' : ''}`}
          title="Favorite"
          onClick={() => void toggleFavorite('issue', issueId)}
        >
          <StarIcon size={15} filled={isFavorite} />
        </button>
        <button className="icon-btn" onClick={(e) => setMenuAnchor(anchorFromEvent(e))}>
          <DotsIcon size={15} />
        </button>
      </div>

      <div className="detail">
        <div className="detail-main">
          <div className="container">
            <textarea
              className="detail-title"
              value={titleDraft}
              rows={1}
              onChange={(e) => {
                setTitleDraft(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
            />

            <div style={{ marginTop: 14 }}>
              {editingDesc ? (
                <div>
                  <textarea
                    className="input"
                    autoFocus
                    value={descDraft}
                    rows={Math.max(6, descDraft.split('\n').length + 1)}
                    onChange={(e) => setDescDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveDescription();
                      if (e.key === 'Escape') {
                        setDescDraft(issue.description);
                        setEditingDesc(false);
                      }
                    }}
                  />
                  <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8, gap: 6 }}>
                    <button
                      className="btn ghost"
                      onClick={() => {
                        setDescDraft(issue.description);
                        setEditingDesc(false);
                      }}
                    >
                      Cancel
                    </button>
                    <button className="btn primary" onClick={saveDescription}>
                      Save
                    </button>
                  </div>
                </div>
              ) : issue.description.trim() ? (
                <div onDoubleClick={() => setEditingDesc(true)} style={{ cursor: 'text' }}>
                  <Markdown source={issue.description} />
                  <button
                    className="btn ghost"
                    style={{ marginTop: 6 }}
                    onClick={() => setEditingDesc(true)}
                  >
                    Edit description
                  </button>
                </div>
              ) : (
                <button
                  className="btn ghost"
                  style={{ color: 'var(--text-4)' }}
                  onClick={() => setEditingDesc(true)}
                >
                  Add description…
                </button>
              )}
            </div>

            {/* sub-issues */}
            <div style={{ marginTop: 28 }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  Sub-issues{' '}
                  {children.length > 0 && (
                    <span className="muted">
                      {children.filter((c) => c.completedAt).length}/{children.length}
                    </span>
                  )}
                </span>
                <span className="grow" />
                <button
                  className="icon-btn"
                  title="Add sub-issue"
                  onClick={() => openNewIssue({ teamId: issue.teamId })}
                >
                  <PlusIcon size={14} />
                </button>
              </div>
              {children.length > 0 && (
                <div
                  style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}
                >
                  {children.map((child) => (
                    <IssueRow key={child.id} issue={child} />
                  ))}
                </div>
              )}
            </div>

            <AttachmentsSection issueId={issueId} />

            {/* relations */}
            {issueRelations.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Relations</span>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {issueRelations.map((rel) => {
                    const outgoing = rel.issueId === issueId;
                    const otherId = outgoing ? rel.relatedIssueId : rel.issueId;
                    const other = allIssues[otherId];
                    if (!other) return null;
                    return (
                      <div key={rel.id} className="row" style={{ fontSize: 12.5 }}>
                        <span className="muted" style={{ width: 90, flexShrink: 0 }}>
                          {relationLabel(rel.type, outgoing)}
                        </span>
                        <Link
                          to={`/issue/${issueKey(other, teams)}`}
                          className="row grow truncate"
                          style={{ gap: 6 }}
                        >
                          <span className="dim">{issueKey(other, teams)}</span>
                          <span className="truncate">{other.title}</span>
                        </Link>
                        <button
                          className="icon-btn"
                          style={{ width: 20, height: 20 }}
                          title="Remove relation"
                          onClick={() => {
                            void api.deleteRelation(rel.id).catch(toastError);
                          }}
                        >
                          <TrashIcon size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* activity + comments */}
            <div style={{ marginTop: 32, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Activity</span>
              <div style={{ marginTop: 8 }}>
                <ActivityFeed activities={activities} />
                {issueComments.map((comment) => {
                  const author = users[comment.userId];
                  const commentReactions = Object.values(reactions).filter(
                    (r) => r.commentId === comment.id,
                  );
                  const grouped = new Map<
                    string,
                    { count: number; mine: boolean; ids: string[] }
                  >();
                  for (const r of commentReactions) {
                    const entry = grouped.get(r.emoji) ?? { count: 0, mine: false, ids: [] };
                    entry.count++;
                    entry.ids.push(r.id);
                    if (r.userId === userId) entry.mine = true;
                    grouped.set(r.emoji, entry);
                  }
                  return (
                    <div key={comment.id} className="comment">
                      <div className="comment-head">
                        <Avatar user={author} size={20} />
                        <span className="who">{author?.name ?? 'Unknown'}</span>
                        <span className="when">
                          {relativeTime(comment.createdAt)}
                          {comment.editedAt && ' · edited'}
                        </span>
                        <span className="grow" />
                        <CommentMenu
                          commentId={comment.id}
                          authorId={comment.userId}
                          body={comment.body}
                        />
                      </div>
                      <div className="comment-body">
                        <Markdown source={comment.body} />
                      </div>
                      <div className="comment-foot">
                        {[...grouped.entries()].map(([emoji, info]) => (
                          <button
                            key={emoji}
                            className={`reaction${info.mine ? ' mine' : ''}`}
                            onClick={() => {
                              if (info.mine) {
                                const mine = commentReactions.find(
                                  (r) => r.emoji === emoji && r.userId === userId,
                                );
                                if (mine) void api.removeReaction(mine.id).catch(toastError);
                              } else {
                                void api
                                  .addReaction({ commentId: comment.id, emoji })
                                  .catch(toastError);
                              }
                            }}
                          >
                            {emoji} {info.count}
                          </button>
                        ))}
                        <ReactionAdder commentId={comment.id} />
                      </div>
                    </div>
                  );
                })}
                <CommentComposer issueId={issueId} />
              </div>
            </div>
          </div>
        </div>

        {/* properties panel */}
        <div className="detail-side">
          <div className="side-heading">Properties</div>
          <div className="prop-row">
            <span className="prop-label">Status</span>
            <button className="prop-value" onClick={(e) => statePicker.open(anchorFromEvent(e))}>
              {state && <StateIcon category={state.category} color={state.color} />}
              {state?.name ?? '—'}
            </button>
          </div>
          <div className="prop-row">
            <span className="prop-label">Priority</span>
            <button className="prop-value" onClick={(e) => priorityPicker.open(anchorFromEvent(e))}>
              <PriorityIcon priority={issue.priority} />
              {PRIORITY_LABELS[issue.priority]}
            </button>
          </div>
          <div className="prop-row">
            <span className="prop-label">Assignee</span>
            <button className="prop-value" onClick={(e) => assigneePicker.open(anchorFromEvent(e))}>
              <Avatar user={assignee} size={16} />
              {assignee?.name ?? <span className="muted">Unassigned</span>}
            </button>
          </div>
          <div className="prop-row">
            <span className="prop-label">Estimate</span>
            <button className="prop-value" onClick={(e) => estimatePicker.open(anchorFromEvent(e))}>
              <EstimateIcon size={14} />
              {issue.estimate == null ? (
                <span className="muted">None</span>
              ) : (
                `${issue.estimate} pts`
              )}
            </button>
          </div>
          <div className="prop-row">
            <span className="prop-label">Due date</span>
            <button className="prop-value" onClick={(e) => duePicker.open(anchorFromEvent(e))}>
              <CalendarIcon size={14} />
              {issue.dueDate ? formatDate(issue.dueDate) : <span className="muted">None</span>}
            </button>
          </div>

          <div className="side-heading">Labels</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {issue.labelIds.map((id) => {
              const label = labels[id];
              if (!label) return null;
              return (
                <span key={id} className="chip">
                  <span className="dot" style={{ background: label.color }} />
                  {label.name}
                </span>
              );
            })}
            <button
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              onClick={(e) => labelPicker.open(anchorFromEvent(e))}
            >
              <LabelIcon size={13} />
            </button>
          </div>
          <AiLabelSuggest issueId={issueId} />

          <div className="side-heading">Organize</div>
          <div className="prop-row">
            <span className="prop-label">Project</span>
            <button className="prop-value" onClick={(e) => projectPicker.open(anchorFromEvent(e))}>
              <ProjectIcon size={14} />
              {project?.name ?? <span className="muted">None</span>}
            </button>
          </div>
          {project && (
            <div className="prop-row">
              <span className="prop-label">Milestone</span>
              <MilestonePickerButton
                issueId={issueId}
                projectId={project.id}
                current={milestone?.id ?? null}
                label={milestone?.name}
              />
            </div>
          )}
          {team?.cyclesEnabled && (
            <div className="prop-row">
              <span className="prop-label">Cycle</span>
              <button className="prop-value" onClick={(e) => cyclePicker.open(anchorFromEvent(e))}>
                <CycleIcon size={14} />
                {cycle ? (
                  cycle.name || `Cycle ${cycle.number}`
                ) : (
                  <span className="muted">None</span>
                )}
              </button>
            </div>
          )}
          <div className="prop-row">
            <span className="prop-label">Parent</span>
            <button className="prop-value" onClick={(e) => parentPicker.open(anchorFromEvent(e))}>
              <ParentIcon size={14} />
              {parent ? (
                <span className="truncate">{issueKey(parent, teams)}</span>
              ) : (
                <span className="muted">None</span>
              )}
            </button>
          </div>
          <div className="prop-row">
            <span className="prop-label">Team</span>
            <button className="prop-value" onClick={(e) => teamPicker.open(anchorFromEvent(e))}>
              {team && (
                <span className="team-icon" style={{ background: team.color }}>
                  {team.key.slice(0, 2)}
                </span>
              )}
              {team?.name}
            </button>
          </div>

          <div className="side-heading">Relations</div>
          <button
            className="btn ghost"
            style={{ marginLeft: -8 }}
            onClick={(e) => setRelAnchor(anchorFromEvent(e))}
          >
            <PlusIcon size={13} /> Add relation
          </button>

          <div className="side-heading">About</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.8 }}>
            Created by {creator?.name ?? 'unknown'} {relativeTime(issue.createdAt)} ago
            <br />
            Updated {relativeTime(issue.updatedAt)} ago
            {issue.completedAt && (
              <>
                <br />
                Completed {relativeTime(issue.completedAt)} ago
              </>
            )}
          </div>
        </div>
      </div>

      {/* pickers */}
      {statePicker.anchor && (
        <StatePicker
          anchor={statePicker.anchor}
          onClose={statePicker.close}
          teamId={issue.teamId}
          currentId={issue.stateId}
          onPick={(id) => void patchIssue(issueId, { stateId: id })}
        />
      )}
      {priorityPicker.anchor && (
        <PriorityPicker
          anchor={priorityPicker.anchor}
          onClose={priorityPicker.close}
          currentId={issue.priority}
          onPick={(p) => void patchIssue(issueId, { priority: p })}
        />
      )}
      {assigneePicker.anchor && (
        <AssigneePicker
          anchor={assigneePicker.anchor}
          onClose={assigneePicker.close}
          currentId={issue.assigneeId}
          onPick={(id) => void patchIssue(issueId, { assigneeId: id })}
        />
      )}
      {labelPicker.anchor && (
        <LabelPicker
          anchor={labelPicker.anchor}
          onClose={labelPicker.close}
          teamId={issue.teamId}
          selected={issue.labelIds}
          onToggle={(id) => toggleLabel(issue, id)}
        />
      )}
      {projectPicker.anchor && (
        <ProjectPicker
          anchor={projectPicker.anchor}
          onClose={projectPicker.close}
          teamId={issue.teamId}
          currentId={issue.projectId}
          onPick={(id) => void patchIssue(issueId, { projectId: id })}
        />
      )}
      {cyclePicker.anchor && (
        <CyclePicker
          anchor={cyclePicker.anchor}
          onClose={cyclePicker.close}
          teamId={issue.teamId}
          currentId={issue.cycleId}
          onPick={(id) => void patchIssue(issueId, { cycleId: id })}
        />
      )}
      {estimatePicker.anchor && (
        <EstimatePicker
          anchor={estimatePicker.anchor}
          onClose={estimatePicker.close}
          current={issue.estimate}
          onPick={(v) => void patchIssue(issueId, { estimate: v })}
        />
      )}
      {duePicker.anchor && (
        <DueDatePicker
          anchor={duePicker.anchor}
          onClose={duePicker.close}
          current={issue.dueDate}
          onPick={(d) => void patchIssue(issueId, { dueDate: d })}
        />
      )}
      {parentPicker.anchor && (
        <IssuePicker
          anchor={parentPicker.anchor}
          onClose={parentPicker.close}
          excludeId={issueId}
          placeholder="Set parent…"
          onPick={(id) => void patchIssue(issueId, { parentId: id })}
        />
      )}
      {teamPicker.anchor && (
        <TeamPicker
          anchor={teamPicker.anchor}
          onClose={teamPicker.close}
          currentId={issue.teamId}
          onPick={(id) => {
            void patchIssue(issueId, { teamId: id }).then(() => {
              const moved = useStore.getState().issues[issueId];
              if (moved) navigate(`/issue/${issueKey(moved, useStore.getState().teams)}`);
            });
          }}
        />
      )}

      {relAnchor && (
        <Popover anchor={relAnchor} onClose={() => setRelAnchor(null)} width={200}>
          {(['blocks', 'related', 'duplicate'] as IssueRelationType[]).map((t) => (
            <button
              key={t}
              className="menu-item"
              onClick={() => {
                setRelType(t);
                setRelAnchor(null);
                relationTargetPicker.open({ x: relAnchor.x, y: relAnchor.y });
              }}
            >
              <LinkIcon size={13} />
              <span className="grow">
                {t === 'blocks' ? 'Blocks…' : t === 'related' ? 'Related to…' : 'Duplicate of…'}
              </span>
            </button>
          ))}
        </Popover>
      )}
      {relationTargetPicker.anchor && (
        <IssuePicker
          anchor={relationTargetPicker.anchor}
          onClose={relationTargetPicker.close}
          excludeId={issueId}
          placeholder="Select issue…"
          onPick={(otherId) => {
            if (otherId) {
              void api
                .createRelation({ type: relType, issueId, relatedIssueId: otherId })
                .then((rel) => useStore.getState().putEntity('issueRelation', rel))
                .catch(toastError);
            }
          }}
        />
      )}

      {reminderAnchor && (
        <Popover anchor={reminderAnchor} onClose={() => setReminderAnchor(null)} width={180}>
          {myReminder && (
            <>
              <div className="menu-heading">Reminder set for {formatDate(myReminder.remindAt)}</div>
              <button
                className="menu-item destructive"
                onClick={() => {
                  void api
                    .clearReminder(myReminder.id)
                    .then(() => {
                      const next = { ...useStore.getState().issueReminders };
                      delete next[myReminder.id];
                      useStore.setState({ issueReminders: next });
                    })
                    .catch(toastError);
                  setReminderAnchor(null);
                }}
              >
                <TrashIcon size={13} />
                <span className="grow">Clear reminder</span>
              </button>
              <div className="menu-separator" />
            </>
          )}
          {(
            [
              ['In 4 hours', 4],
              ['Tomorrow', 24],
              ['In 3 days', 72],
              ['Next week', 168],
            ] as Array<[string, number]>
          ).map(([label, hours]) => (
            <button
              key={label}
              className="menu-item"
              onClick={() => {
                const remindAt = new Date(Date.now() + hours * 3600_000).toISOString();
                void api
                  .setReminder(issueId, remindAt)
                  .then((r) => useStore.getState().putEntity('issueReminder', r))
                  .catch(toastError);
                setReminderAnchor(null);
              }}
            >
              <ClockIcon size={13} />
              <span className="grow">{label}</span>
            </button>
          ))}
        </Popover>
      )}
      {menuAnchor && (
        <Popover anchor={menuAnchor} onClose={() => setMenuAnchor(null)} width={200}>
          <button
            className="menu-item"
            onClick={() => {
              void navigator.clipboard.writeText(kid);
              toast(`Copied ${kid}`);
              setMenuAnchor(null);
            }}
          >
            <CopyIcon size={14} />
            <span className="grow">Copy ID</span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              void navigator.clipboard.writeText(location.href);
              toast('Link copied');
              setMenuAnchor(null);
            }}
          >
            <LinkIcon size={14} />
            <span className="grow">Copy link</span>
          </button>
          <div className="menu-separator" />
          <button
            className="menu-item destructive"
            onClick={() => {
              setMenuAnchor(null);
              void deleteIssue(issueId).then(() => {
                if (team) navigate(`/team/${team.key}/issues`);
                else navigate('/');
              });
            }}
          >
            <TrashIcon size={14} />
            <span className="grow">Delete issue</span>
          </button>
        </Popover>
      )}
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentsSection({ issueId }: { issueId: string }) {
  const attachments = useStore((s) => s.attachments);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = Object.values(attachments)
    .filter((a) => a.issueId === issueId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const attachment = await api.uploadAttachment(issueId, file);
      useStore.getState().putEntity('attachment', attachment);
    } catch (err) {
      toastError(err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          Attachments {rows.length > 0 && <span className="muted">{rows.length}</span>}
        </span>
        <span className="grow" />
        <button
          className="icon-btn"
          title="Upload attachment"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <PlusIcon size={14} />
        </button>
        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
      {uploading && <div className="dim">Uploading…</div>}
      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((attachment) => (
            <div key={attachment.id} className="row" style={{ fontSize: 12.5, gap: 8 }}>
              <a
                href={`/api/attachments/${attachment.id}/file`}
                className="row grow truncate"
                style={{ gap: 6, color: 'var(--accent-text)' }}
                download={attachment.filename}
              >
                <LinkIcon size={12} />
                <span className="truncate">{attachment.filename}</span>
              </a>
              <span className="dim">{formatBytes(attachment.size)}</span>
              <button
                className="icon-btn"
                style={{ width: 20, height: 20 }}
                title="Delete attachment"
                onClick={() => {
                  void api
                    .deleteAttachment(attachment.id)
                    .then(() => {
                      const next = { ...useStore.getState().attachments };
                      delete next[attachment.id];
                      useStore.setState({ attachments: next });
                    })
                    .catch(toastError);
                }}
              >
                <TrashIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityFeed({ activities }: { activities: IssueActivity[] }) {
  const users = useStore((s) => s.users);
  const states = useStore((s) => s.workflowStates);
  const labels = useStore((s) => s.labels);

  const describe = (a: IssueActivity): string | null => {
    const d = a.data as Record<string, unknown>;
    switch (a.type) {
      case 'created':
        return 'created the issue';
      case 'state_changed':
        return `changed status ${d.from ? `from ${d.from} ` : ''}to ${d.to ?? states[String(d.toId)]?.name ?? '?'}`;
      case 'priority_changed':
        return `set priority to ${PRIORITY_LABELS[(d.to as 0 | 1 | 2 | 3 | 4) ?? 0]}`;
      case 'assignee_changed': {
        const to = d.toId ? users[String(d.toId)]?.name : null;
        return to ? `assigned to ${to}` : 'removed the assignee';
      }
      case 'label_added':
        return `added label ${labels[String(d.labelId)]?.name ?? ''}`;
      case 'label_removed':
        return `removed label ${labels[String(d.labelId)]?.name ?? ''}`;
      case 'title_changed':
        return 'changed the title';
      case 'description_changed':
        return 'updated the description';
      case 'project_changed':
        return d.toId ? 'added to a project' : 'removed from project';
      case 'cycle_changed':
        return d.toId ? 'moved into a cycle' : 'removed from cycle';
      case 'estimate_changed':
        return d.to == null ? 'removed the estimate' : `set estimate to ${d.to}`;
      case 'due_date_changed':
        return d.to ? `set due date to ${formatDate(String(d.to))}` : 'removed the due date';
      case 'parent_changed':
        return d.toId ? 'set the parent issue' : 'removed the parent issue';
      default:
        return null;
    }
  };

  return (
    <div>
      {activities.map((a) => {
        const text = describe(a);
        if (!text) return null;
        const actor = users[a.actorId];
        return (
          <div key={a.id} className="activity-item">
            <Avatar user={actor} size={16} />
            <span>
              <span className="who">{actor?.name ?? 'Someone'}</span> {text}
              <span className="dim"> · {relativeTime(a.createdAt)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CommentComposer({ issueId }: { issueId: string }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const comment = await api.createComment({ issueId, body });
      useStore.getState().putEntity('comment', comment);
      setBody('');
    } catch (err) {
      toastError(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="comment" style={{ marginTop: 16 }}>
      <textarea
        ref={ref}
        className="input"
        style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}
        placeholder="Leave a comment… (@mention teammates, markdown supported)"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
        }}
      />
      <div className="row" style={{ justifyContent: 'flex-end', padding: '0 10px 10px' }}>
        <button
          className="btn primary"
          disabled={!body.trim() || sending}
          onClick={() => void send()}
        >
          <SendIcon size={13} /> Comment
        </button>
      </div>
    </div>
  );
}

const EMOJI = ['👍', '👎', '🎉', '❤️', '😄', '🚀', '👀', '😕'];

function ReactionAdder({ commentId }: { commentId: string }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  return (
    <>
      <button
        className="reaction"
        title="Add reaction"
        onClick={(e) => setAnchor(anchorFromEvent(e))}
      >
        <PlusIcon size={11} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={210}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: 4 }}>
            {EMOJI.map((emoji) => (
              <button
                key={emoji}
                className="icon-btn"
                style={{ fontSize: 15, width: 30, height: 30 }}
                onClick={() => {
                  void api
                    .addReaction({ commentId, emoji })
                    .then((r) => useStore.getState().putEntity('reaction', r))
                    .catch(toastError);
                  setAnchor(null);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function CommentMenu({
  commentId,
  authorId,
  body,
}: {
  commentId: string;
  authorId: string;
  body: string;
}) {
  const userId = useStore((s) => s.userId);
  const me = useStore((s) => (s.userId ? s.users[s.userId] : null));
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const canEdit = userId === authorId;
  const canDelete = canEdit || me?.role === 'admin';
  if (!canEdit && !canDelete) return null;

  return (
    <>
      <button
        className="icon-btn"
        style={{ width: 22, height: 22 }}
        onClick={(e) => setAnchor(anchorFromEvent(e))}
      >
        <DotsIcon size={13} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={160}>
          {canEdit && (
            <button
              className="menu-item"
              onClick={() => {
                setDraft(body);
                setEditing(true);
                setAnchor(null);
              }}
            >
              <PencilIconSmall />
              <span className="grow">Edit</span>
            </button>
          )}
          {canDelete && (
            <button
              className="menu-item destructive"
              onClick={() => {
                void api
                  .deleteComment(commentId)
                  .then(() => {
                    const next = { ...useStore.getState().comments };
                    delete next[commentId];
                    useStore.setState({ comments: next });
                  })
                  .catch(toastError);
                setAnchor(null);
              }}
            >
              <TrashIcon size={13} />
              <span className="grow">Delete</span>
            </button>
          )}
        </Popover>
      )}
      {editing && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setEditing(false)}
        >
          <div className="modal" style={{ width: 520, padding: 16 }}>
            <textarea
              className="input"
              rows={5}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10, gap: 6 }}>
              <button className="btn ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  void api
                    .updateComment(commentId, draft)
                    .then((c) => useStore.getState().putEntity('comment', c))
                    .catch(toastError);
                  setEditing(false);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PencilIconSmall() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function MilestonePickerButton({
  issueId,
  projectId,
  current,
  label,
}: {
  issueId: string;
  projectId: string;
  current: string | null;
  label?: string;
}) {
  const milestones = useStore((s) => s.projectMilestones);
  const picker = usePicker();
  const items = Object.values(milestones)
    .filter((m) => m.projectId === projectId)
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1));
  return (
    <>
      <button className="prop-value" onClick={(e) => picker.open(anchorFromEvent(e))}>
        <ProjectIcon size={14} />
        {label ?? <span className="muted">None</span>}
      </button>
      {picker.anchor && (
        <Popover anchor={picker.anchor} onClose={picker.close} width={220}>
          <button
            className="menu-item"
            onClick={() => {
              void patchIssue(issueId, { milestoneId: null });
              picker.close();
            }}
          >
            <span className="grow">No milestone</span>
            {current === null && <span className="check">✓</span>}
          </button>
          {items.map((m) => (
            <button
              key={m.id}
              className="menu-item"
              onClick={() => {
                void patchIssue(issueId, { milestoneId: m.id });
                picker.close();
              }}
            >
              <span className="grow">{m.name}</span>
              {current === m.id && <span className="check">✓</span>}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

/** AI label suggestions — shown only when the workspace has AI enabled. */
function AiLabelSuggest({ issueId }: { issueId: string }) {
  const issue = useStore((s) => s.issues[issueId]);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<{ labelId: string; name: string }[] | null>(null);

  useEffect(() => {
    void api
      .aiSettings()
      .then((s) => setEnabled(s.enabled && s.hasKey))
      .catch(() => setEnabled(false));
  }, []);

  if (!enabled) return null;

  const suggest = () => {
    setBusy(true);
    void api
      .suggestLabels(issueId)
      .then((r) => setSuggestions(r.suggestions))
      .catch(toastError)
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ marginTop: 6 }}>
      {suggestions === null ? (
        <button className="btn ghost sm" onClick={suggest} disabled={busy}>
          {busy ? 'Thinking…' : '✨ Suggest labels'}
        </button>
      ) : suggestions.length === 0 ? (
        <span className="muted" style={{ fontSize: 12 }}>
          No label suggestions.
        </span>
      ) : (
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          {suggestions.map((s) => (
            <button
              key={s.labelId}
              className="chip"
              title="Add this label"
              onClick={() => {
                if (issue) toggleLabel(issue, s.labelId);
                setSuggestions((prev) => prev?.filter((x) => x.labelId !== s.labelId) ?? null);
              }}
            >
              + {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
