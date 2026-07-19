-- Enterprise auth: SSO identity links and the workspace audit log.

-- Maps an OIDC provider subject (`sub`) to a local user. Kept out of the
-- synced User entity so the IdP subject never crosses the sync boundary.
CREATE TABLE sso_identities (
  subject text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX sso_identities_user_idx ON sso_identities (user_id);

-- Workspace-level security/admin events. Not synced; read via GET /api/audit.
-- One jsonb document per row, like the entity tables, with created_at pulled
-- out for cursor paging.
CREATE TABLE audit_log (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
