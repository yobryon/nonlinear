import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Notification } from '@nonlinear/shared';
import { api } from '../api.js';
import { issueKey, relativeTime, useStore } from '../store.js';
import { Avatar, toastError } from '../ui.js';
import { CheckIcon, InboxIcon, TrashIcon } from '../icons.js';

function describe(n: Notification, actorName: string): string {
  switch (n.type) {
    case 'issue_assigned':
      return `${actorName} assigned you`;
    case 'issue_unassigned':
      return `${actorName} unassigned you from`;
    case 'issue_status_changed':
      return `${actorName} changed the status of`;
    case 'issue_commented':
      return `${actorName} commented on`;
    case 'issue_mentioned':
      return `${actorName} mentioned you in`;
    case 'issue_due_soon':
      return 'Due soon:';
    default:
      return 'Update on';
  }
}

export function InboxPage() {
  const notifications = useStore((s) => s.notifications);
  const issues = useStore((s) => s.issues);
  const teams = useStore((s) => s.teams);
  const users = useStore((s) => s.users);
  const putEntity = useStore((s) => s.putEntity);
  const navigate = useNavigate();

  const rows = useMemo(
    () => Object.values(notifications).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notifications],
  );
  const unread = rows.filter((n) => !n.readAt).length;

  const markRead = (n: Notification, read: boolean) => {
    void api
      .markNotification(n.id, read)
      .then(() =>
        putEntity('notification', { ...n, readAt: read ? new Date().toISOString() : null }),
      )
      .catch(toastError);
  };

  return (
    <>
      <div className="topbar">
        <div className="title">
          <InboxIcon size={16} />
          Inbox
          {unread > 0 && <span className="muted">{unread} unread</span>}
        </div>
        <span className="spacer" />
        {unread > 0 && (
          <button
            className="btn ghost"
            onClick={() => {
              void api
                .markAllNotificationsRead()
                .then(() => {
                  const now = new Date().toISOString();
                  const next = { ...useStore.getState().notifications };
                  for (const id of Object.keys(next)) {
                    if (!next[id]!.readAt) next[id] = { ...next[id]!, readAt: now };
                  }
                  useStore.setState({ notifications: next });
                })
                .catch(toastError);
            }}
          >
            <CheckIcon size={14} /> Mark all read
          </button>
        )}
      </div>
      <div className="content">
        {rows.length === 0 && (
          <div className="empty-state">
            <InboxIcon size={28} style={{ color: 'var(--text-4)' }} />
            <h3>Inbox zero</h3>
            <p>Notifications about your issues will appear here.</p>
          </div>
        )}
        {rows.map((n) => {
          const issue = issues[n.issueId];
          const actor = n.actorId ? users[n.actorId] : null;
          return (
            <div
              key={n.id}
              className={`inbox-row ${n.readAt ? 'read' : 'unread'}`}
              onClick={() => {
                if (!n.readAt) markRead(n, true);
                if (issue) navigate(`/issue/${issueKey(issue, teams)}`);
              }}
            >
              <span className="unread-dot" />
              <Avatar user={actor} size={22} />
              <div className="msg">
                <div>
                  {describe(n, actor?.name ?? 'Someone')}{' '}
                  <strong>
                    {issue ? `${issueKey(issue, teams)} ${issue.title}` : 'a deleted issue'}
                  </strong>
                </div>
                <div className="dim" style={{ fontSize: 11.5 }}>
                  {relativeTime(n.createdAt)} ago
                </div>
              </div>
              <button
                className="icon-btn"
                title={n.readAt ? 'Mark unread' : 'Mark read'}
                onClick={(e) => {
                  e.stopPropagation();
                  markRead(n, !n.readAt);
                }}
              >
                <CheckIcon size={14} />
              </button>
              <button
                className="icon-btn"
                title="Delete notification"
                onClick={(e) => {
                  e.stopPropagation();
                  void api
                    .deleteNotification(n.id)
                    .then(() => {
                      const next = { ...useStore.getState().notifications };
                      delete next[n.id];
                      useStore.setState({ notifications: next });
                    })
                    .catch(toastError);
                }}
              >
                <TrashIcon size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
