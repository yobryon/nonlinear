-- Custom dashboards (a synced entity) and the BYO-key AI settings singleton.

CREATE TABLE dashboards (
  id text PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE INDEX dashboards_creator_idx ON dashboards ((data->>'creatorId'));

-- Single-row workspace AI config; holds the API key, so it is never synced.
CREATE TABLE ai_settings (
  id text PRIMARY KEY,
  data jsonb NOT NULL
);
