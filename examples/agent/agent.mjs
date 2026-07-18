#!/usr/bin/env node
/**
 * Reference nonlinear agent — the assign/mention → act loop, end to end.
 *
 * It runs a tiny HTTP server that receives an agent-scoped webhook (only
 * events where THIS agent is the assignee or is @mentioned), then acts back
 * through the REST API with its personal token. Swap the `handle()` body for a
 * real model call; everything else is the plumbing that makes the agent a
 * first-class teammate.
 *
 * Usage:
 *   NONLINEAR_URL=http://localhost:8080 \
 *   NONLINEAR_TOKEN=nl_xxx \
 *   AGENT_HANDLE=fixer.bot \
 *   PORT=7000 \
 *   node agent.mjs
 *
 * Then register a webhook pointing at http://<this-host>:7000/webhook, scoped
 * to the agent user (Settings → Members → the agent, or POST /api/webhooks with
 * agentUserId). Assign an issue to the agent, or @mention it in a comment.
 */
import { createServer } from 'node:http';

const BASE = process.env.NONLINEAR_URL ?? 'http://localhost:8080';
const TOKEN = process.env.NONLINEAR_TOKEN;
const HANDLE = (process.env.AGENT_HANDLE ?? '').toLowerCase();
const PORT = Number(process.env.PORT ?? 7000);
const SECRET = process.env.WEBHOOK_SECRET ?? null;

if (!TOKEN) {
  console.error('Set NONLINEAR_TOKEN to a personal API token for the agent user.');
  process.exit(1);
}

const api = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
};

// Resolve the agent's own identity once, for identifier formatting + dedupe.
const me = await api('GET', '/api/auth/me').catch(async () => {
  // /api/auth/me needs the user; with a token it still resolves. Fall back to bootstrap.
  const boot = await api('GET', '/api/bootstrap');
  return { user: boot.users.find((u) => u.displayName.toLowerCase() === HANDLE) };
});
const agentId = me.user?.id;
console.log(`agent up as @${me.user?.displayName ?? HANDLE}, listening on :${PORT}`);

const handled = new Set();

/** Replace this with a real model call. Here: acknowledge + a canned reply. */
async function handle(issue) {
  const identifier = issue.identifier;
  if (handled.has(identifier)) return;
  handled.add(identifier);
  console.log(`working on ${identifier}: ${issue.title}`);
  await api('POST', '/api/comments', {
    issueId: issue.id,
    body: `On it — I picked this up automatically. (reference agent)`,
  });
  // A real agent might also move the issue forward, e.g.:
  // await api('PATCH', `/api/issues/${issue.id}`, { stateId: <started state id> });
}

async function onDeltas(deltas) {
  const bootstrap = await api('GET', '/api/bootstrap');
  const teamById = new Map(bootstrap.teams.map((t) => [t.id, t]));
  for (const d of deltas) {
    if (d.action === 'delete') continue;
    let issue = null;
    if (d.model === 'issue' && d.data.assigneeId === agentId) {
      issue = d.data;
    } else if (d.model === 'comment') {
      // A comment mentioning us — look up its issue.
      const body = (d.data.body ?? '').toLowerCase();
      if (HANDLE && body.includes(`@${HANDLE}`)) {
        issue = bootstrap.issues.find((i) => i.id === d.data.issueId);
      }
    }
    if (!issue) continue;
    const team = teamById.get(issue.teamId);
    await handle({ ...issue, identifier: team ? `${team.key}-${issue.number}` : issue.id });
  }
}

createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith('/webhook')) {
    res.writeHead(404).end();
    return;
  }
  if (SECRET && req.headers['x-nonlinear-secret'] !== SECRET) {
    res.writeHead(401).end();
    return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    // Ack within the webhook timeout, then process asynchronously.
    res.writeHead(200).end('ok');
    try {
      const payload = JSON.parse(raw);
      if (payload.type === 'sync.deltas') void onDeltas(payload.deltas).catch(console.error);
    } catch (err) {
      console.error('bad webhook payload', err);
    }
  });
}).listen(PORT);
