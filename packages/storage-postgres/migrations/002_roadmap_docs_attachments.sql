-- Attachments, initiatives (roadmap), documents, outbound webhooks,
-- plus new document fields on existing teams/projects.

CREATE TABLE attachments (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE initiatives (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE documents   (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE webhooks    (id text PRIMARY KEY, data jsonb NOT NULL);

CREATE INDEX attachments_issue_idx ON attachments ((data->>'issueId'));
CREATE INDEX documents_project_idx ON documents ((data->>'projectId'));

-- Backfill defaults for fields added to existing documents.
UPDATE teams SET data = data
  || jsonb_build_object('triageEnabled', false)
  || jsonb_build_object('slaUrgentHours', null)
  || jsonb_build_object('slaHighHours', null)
WHERE NOT data ? 'triageEnabled';

UPDATE projects SET data = data || jsonb_build_object('initiativeId', null)
WHERE NOT data ? 'initiativeId';
