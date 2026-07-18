# Agents on nonlinear

nonlinear supports agents the way Linear does — three complementary surfaces,
all authenticated with a **personal API token** (`Authorization: Bearer nl_…`):

1. **MCP server** (`/mcp`, Streamable HTTP) — the tool layer. Point any MCP
   client at it and the agent can search/create/update issues, comment, and more.
2. **REST API** (`/api/*`) — the same operations for custom/programmatic agents.
3. **Agent-as-teammate** — an agent _user_ you can assign issues to and @mention,
   with a scoped webhook that fires only on events about that agent. This is the
   trigger layer that closes the loop.

## 1. Connect an MCP client

Mint a token (Settings → Profile → API tokens, or `POST /api/tokens`), then:

```bash
# Claude Code
claude mcp add --transport http nonlinear http://localhost:8080/mcp \
  --header "Authorization: Bearer nl_your_token"
```

```jsonc
// Cursor / VS Code (mcp.json)
{
  "mcpServers": {
    "nonlinear": {
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer nl_your_token" },
    },
  },
}
```

Tools: `whoami`, `list_teams`, `list_users`, `list_projects`,
`list_workflow_states`, `list_labels`, `search_issues`, `get_issue`,
`list_my_issues`, `create_issue`, `update_issue`, `add_comment`,
`create_project`. Names (team keys, states, assignees, labels) are resolved for
you, so tool calls read like `create_issue(teamKey="ENG", title="…",
assignee="@ada", state="Todo")`.

## 2. Drive the REST API directly

```bash
curl -H "Authorization: Bearer nl_your_token" \
  -H "content-type: application/json" \
  -d '{"teamId":"…","title":"Filed by a script"}' \
  http://localhost:8080/api/issues
```

## 3. Run an agent as a teammate

1. **Create the agent user** (admin): Settings → Members → _Add agent_, or
   `POST /api/agents {"name":"Fixer Bot"}`. Agents can't log in; they act only
   through their token.
2. **Mint a token for the agent** and give it to your agent process.
3. **Register a scoped webhook** pointing at your agent, bound to the agent user
   (Settings → Webhooks → choose the agent, or `POST /api/webhooks
{"url":"…","agentUserId":"…"}`). It will receive **only** events where the
   agent is the assignee or is @mentioned.
4. **Assign an issue to the agent** or `@mention` it in a comment. The webhook
   fires; the agent works; it posts back via MCP or REST.

`agent.mjs` in this folder is a runnable reference implementation of step 4:

```bash
NONLINEAR_URL=http://localhost:8080 \
NONLINEAR_TOKEN=nl_agent_token \
AGENT_HANDLE=fixer.bot \
PORT=7000 \
node agent.mjs
```

It ack's the webhook within the timeout, then comments back on any issue
assigned to it or comment that mentions it. Swap the `handle()` body for a real
model call — the rest is just the teammate plumbing.
