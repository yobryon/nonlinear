-- nonlinear initial schema.
--
-- Entity tables store one jsonb document per row: the storage contract is
-- full-document CRUD (see @nonlinear/core Storage), so a document layout
-- keeps this adapter small and keeps the engine swappable. Hot paths that
-- need relational semantics — sessions, per-team issue counters, and the
-- ordered sync log — get real tables. Expression indexes cover the queried
-- document fields.

CREATE TABLE workspaces        (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE users             (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE teams             (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE team_memberships  (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE workflow_states   (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE issues            (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE labels            (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE comments          (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE reactions         (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE projects          (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE project_milestones(id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE cycles            (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE issue_relations   (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE notifications     (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE favorites         (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE issue_activities  (id text PRIMARY KEY, data jsonb NOT NULL);

CREATE UNIQUE INDEX users_email_idx ON users ((data->>'email'));
CREATE INDEX issues_team_idx ON issues ((data->>'teamId'));
CREATE INDEX comments_issue_idx ON comments ((data->>'issueId'));
CREATE INDEX activities_issue_idx ON issue_activities ((data->>'issueId'));
CREATE INDEX notifications_user_idx ON notifications ((data->>'userId'));
CREATE INDEX favorites_user_idx ON favorites ((data->>'userId'));

CREATE TABLE auth_credentials (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL
);

CREATE TABLE sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE team_counters (
  team_id text PRIMARY KEY,
  counter bigint NOT NULL DEFAULT 0
);

CREATE TABLE sync_log (
  sync_id bigserial PRIMARY KEY,
  model text NOT NULL,
  action text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
