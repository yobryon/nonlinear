-- Scoped API tokens: restrict a token to specific teams and/or make it
-- read-only. NULL team_ids = all the owner's teams (the prior behavior).
ALTER TABLE api_tokens ADD COLUMN team_ids jsonb;
ALTER TABLE api_tokens ADD COLUMN read_only boolean NOT NULL DEFAULT false;
