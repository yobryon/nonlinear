-- Personal API tokens (bearer auth for REST + MCP), agent users, and
-- agent-scoped webhooks.

CREATE TABLE api_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz,
  expires_at timestamptz
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);

UPDATE users SET data = data || jsonb_build_object('isAgent', false)
WHERE NOT data ? 'isAgent';

UPDATE webhooks SET data = data || jsonb_build_object('agentUserId', null)
WHERE NOT data ? 'agentUserId';
