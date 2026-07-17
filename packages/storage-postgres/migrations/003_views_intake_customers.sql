-- Custom views, issue templates, project updates (health), issue reminders,
-- customers + requests, document comments, triage rules; new fields on
-- users/teams/webhooks/notifications.

CREATE TABLE custom_views      (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE issue_templates   (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE project_updates   (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE issue_reminders   (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE customers         (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE customer_requests (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE document_comments (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE triage_rules      (id text PRIMARY KEY, data jsonb NOT NULL);

CREATE INDEX project_updates_project_idx ON project_updates ((data->>'projectId'));
CREATE INDEX customer_requests_customer_idx ON customer_requests ((data->>'customerId'));
CREATE INDEX document_comments_document_idx ON document_comments ((data->>'documentId'));
CREATE INDEX issue_reminders_user_idx ON issue_reminders ((data->>'userId'));

UPDATE users SET data = data
  || jsonb_build_object('mutedNotificationTypes', '[]'::jsonb)
  || jsonb_build_object('emailDigest', false)
  || jsonb_build_object('digestLastSentAt', null)
WHERE NOT data ? 'mutedNotificationTypes';

UPDATE teams SET data = data
  || jsonb_build_object('estimateScale', 'exponential')
  || jsonb_build_object('intakeEnabled', false)
  || jsonb_build_object('intakeToken', null)
WHERE NOT data ? 'estimateScale';

UPDATE webhooks SET data = data || jsonb_build_object('format', 'json')
WHERE NOT data ? 'format';

UPDATE notifications SET data = data || jsonb_build_object('snoozedUntil', null)
WHERE NOT data ? 'snoozedUntil';
