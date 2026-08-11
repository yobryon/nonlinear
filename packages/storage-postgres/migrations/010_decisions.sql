-- First-class decision records (a synced entity) + their comments, and an
-- atomic per-team decision-number counter (parallel to team_counters).

CREATE TABLE decisions (
  id text PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE INDEX decisions_team_idx ON decisions ((data->>'teamId'));
CREATE INDEX decisions_supersedes_idx ON decisions ((data->>'supersedesId'));

CREATE TABLE decision_comments (
  id text PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE INDEX decision_comments_decision_idx ON decision_comments ((data->>'decisionId'));

CREATE TABLE decision_counters (
  team_id text PRIMARY KEY,
  counter integer NOT NULL DEFAULT 0
);
