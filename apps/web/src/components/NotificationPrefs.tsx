import { NOTIFICATION_TYPES, type NotificationType } from '@nonlinear/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { Switch, toastError } from '../ui.js';

const TYPE_LABELS: Record<NotificationType, string> = {
  issue_assigned: 'Issue assigned to you',
  issue_unassigned: 'Unassigned',
  issue_status_changed: 'Status changes',
  issue_commented: 'New comments',
  issue_mentioned: 'Mentions',
  issue_due_soon: 'Due soon',
  issue_reminder: 'Reminders',
  issue_waiting_on: 'Waiting on you',
  decision_ruled: 'Decision ruled',
};

export function NotificationPrefs() {
  const me = useStore((s) => (s.userId ? s.users[s.userId] : null));
  if (!me) return null;

  const muted = me.mutedNotificationTypes;

  const setMuted = (type: NotificationType, mute: boolean) => {
    const next = mute
      ? [...muted.filter((t) => t !== type), type]
      : muted.filter((t) => t !== type);
    void api
      .updateProfile({ mutedNotificationTypes: next })
      .then((u) => useStore.getState().putEntity('user', u))
      .catch(toastError);
  };

  return (
    <>
      <div className="settings-section">
        <h2>Notifications</h2>
        {NOTIFICATION_TYPES.map((type) => (
          <div key={type} className="setting-row">
            <div className="info">
              <div className="label">{TYPE_LABELS[type]}</div>
            </div>
            <Switch on={!muted.includes(type)} onChange={(on) => setMuted(type, !on)} />
          </div>
        ))}
      </div>

      <div className="settings-section">
        <h2>Email</h2>
        <div className="setting-row">
          <div className="info">
            <div className="label">Email digest</div>
            <div className="desc">
              Daily email with unread notifications — requires SMTP on the server.
            </div>
          </div>
          <Switch
            on={me.emailDigest}
            onChange={(on) => {
              void api
                .updateProfile({ emailDigest: on })
                .then((u) => useStore.getState().putEntity('user', u))
                .catch(toastError);
            }}
          />
        </div>
      </div>
    </>
  );
}
