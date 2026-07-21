-- Admin-issued registration invites. The raw token is stored only as a sha256
-- hash; the rest of the invite is a jsonb document. Not synced.
CREATE TABLE invites (
  id text PRIMARY KEY,
  hash text NOT NULL UNIQUE,
  data jsonb NOT NULL
);
