import { useEffect, useState } from 'react';
import type { ApiToken } from '@nonlinear/shared';
import { api } from '../api.js';
import { relativeTime, useStore } from '../store.js';
import { toast, toastError } from '../ui.js';
import { CopyIcon, PlusIcon, TrashIcon } from '../icons.js';

/* ----------------------------- MCP client setup ---------------------------- */

/** MCP config generators, one per client — Claude Code first (the default). */
const MCP_CLIENTS: Array<{
  id: string;
  label: string;
  hint: string;
  build: (url: string, secret: string, agentLine: boolean) => string;
}> = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    hint: 'Add to .mcp.json in your project root. Keep it out of version control — it holds the token. ${AGENT} is read from the environment at launch.',
    build: (url, secret, agent) =>
      `{
  "mcpServers": {
    "nonlinear": {
      "type": "http",
      "url": "${url}",
      "headers": {
        "Authorization": "Bearer ${secret}"${agent ? ',\n        "X-Agent-ID": "${AGENT}"' : ''}
      }
    }
  }
}`,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    hint: 'Add to .cursor/mcp.json (project) or ~/.cursor/mcp.json (global).',
    build: (url, secret, agent) =>
      `{
  "mcpServers": {
    "nonlinear": {
      "url": "${url}",
      "headers": {
        "Authorization": "Bearer ${secret}"${agent ? ',\n        "X-Agent-ID": "${AGENT}"' : ''}
      }
    }
  }
}`,
  },
  {
    id: 'vscode',
    label: 'VS Code',
    hint: 'Add to .vscode/mcp.json (note the top-level "servers" key).',
    build: (url, secret, agent) =>
      `{
  "servers": {
    "nonlinear": {
      "type": "http",
      "url": "${url}",
      "headers": {
        "Authorization": "Bearer ${secret}"${agent ? ',\n        "X-Agent-ID": "${AGENT}"' : ''}
      }
    }
  }
}`,
  },
  {
    id: 'raw',
    label: 'Raw',
    hint: 'Streamable-HTTP endpoint — point any MCP client at it with these headers.',
    build: (url, secret, agent) =>
      `${url}
Authorization: Bearer ${secret}${agent ? '\nX-Agent-ID: ${AGENT}' : ''}`,
  },
];

/**
 * A copy-pasteable MCP configuration for the token just minted, tabbed by
 * client. The endpoint URL comes from the app's own origin; agent tokens also
 * get an `X-Agent-ID: ${AGENT}` header so several sessions sharing the token
 * stay individually attributed as personas.
 */
function McpSetup({ secret, isAgent }: { secret: string; isAgent: boolean }) {
  const [client, setClient] = useState(MCP_CLIENTS[0]!.id);
  const url = `${window.location.origin}/mcp`;
  const active = MCP_CLIENTS.find((c) => c.id === client) ?? MCP_CLIENTS[0]!;
  const snippet = active.build(url, secret, isAgent);

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid rgba(76,183,130,0.35)', paddingTop: 10 }}>
      <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-1)', fontSize: 12.5, marginRight: 2 }}>
          Connect an MCP client:
        </span>
        {MCP_CLIENTS.map((c) => (
          <button
            key={c.id}
            className={`chip${c.id === client ? ' active' : ''}`}
            style={{
              height: 22,
              ...(c.id === client
                ? { background: 'var(--bg-active)', color: 'var(--text-1)' }
                : {}),
            }}
            onClick={() => setClient(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <pre
          style={{
            margin: 0,
            padding: '10px 12px',
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflowX: 'auto',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--text-1)',
          }}
        >
          <code>{snippet}</code>
        </pre>
        <button
          className="btn"
          style={{ position: 'absolute', top: 6, right: 6 }}
          onClick={() => {
            void navigator.clipboard.writeText(snippet);
            toast(`${active.label} config copied`);
          }}
        >
          <CopyIcon size={13} /> Copy
        </button>
      </div>
      <div className="dim" style={{ fontSize: 11.5, marginTop: 6, color: 'var(--text-3)' }}>
        {active.hint}
      </div>
    </div>
  );
}

/**
 * API-token management. Without `agent`, it manages the signed-in user's own
 * personal tokens (Profile → API tokens). With `agent`, it manages that agent
 * user's tokens (admin only) — the credentials that authenticate *as* the agent.
 * Tokens aren't part of the sync store (they're bearer secrets), so this fetches
 * them directly.
 */
export function ApiTokens({ agent }: { agent?: { id: string; name: string } } = {}) {
  const teams = useStore((s) => s.teams);
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ secret: string } | null>(null);

  const refresh = () => {
    const p = agent ? api.listAgentTokens(agent.id) : api.listTokens();
    void p.then(setTokens).catch(() => setTokens([]));
  };
  useEffect(refresh, [agent?.id]);

  const create = () => {
    if (!name.trim()) return;
    const p = agent ? api.createAgentToken(agent.id, name.trim()) : api.createToken(name.trim());
    void p
      .then((res) => {
        setCreated({ secret: res.secret });
        setName('');
        refresh();
      })
      .catch(toastError);
  };

  const revoke = (id: string) => {
    const p = agent ? api.revokeAgentToken(agent.id, id) : api.deleteToken(id);
    void p.then(refresh).catch(toastError);
  };

  const scopeBadges = (t: ApiToken) => (
    <>
      {t.readOnly && (
        <span className="chip" style={{ height: 18 }}>
          read-only
        </span>
      )}
      <span className="chip" style={{ height: 18 }}>
        {t.teamIds === null
          ? 'all teams'
          : t.teamIds.map((id) => teams[id]?.key ?? '?').join(', ') || 'no teams'}
      </span>
    </>
  );

  return (
    <>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        {agent ? (
          <>
            These tokens authenticate <b>as {agent.name}</b> — each one <b>is</b> the agent's
            identity. Use as <code>Authorization: Bearer &lt;token&gt;</code> against the REST API
            or the MCP server at <code>/mcp</code>. Shown once — store it somewhere safe.
          </>
        ) : (
          <>
            Use a token as <code>Authorization: Bearer &lt;token&gt;</code> against the REST API or
            the MCP server at <code>/mcp</code>. Shown once — store it somewhere safe.
          </>
        )}
      </p>

      {created && (
        <div
          className="auth-error"
          style={{
            background: 'rgba(76,183,130,0.1)',
            borderColor: 'rgba(76,183,130,0.35)',
            color: 'var(--success)',
            marginBottom: 10,
          }}
        >
          <div style={{ marginBottom: 6 }}>New token — copy it now, it won't be shown again:</div>
          <div className="row" style={{ gap: 8 }}>
            <code style={{ flex: 1, wordBreak: 'break-all', color: 'var(--text-1)' }}>
              {created.secret}
            </code>
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(created.secret);
                toast('Token copied');
              }}
            >
              <CopyIcon size={13} /> Copy
            </button>
            <button className="btn ghost" onClick={() => setCreated(null)}>
              Done
            </button>
          </div>
          <McpSetup secret={created.secret} isAgent={!!agent} />
        </div>
      )}

      {tokens?.map((t) => (
        <div key={t.id} className="member-row">
          <div className="info">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {t.name} <code className="dim">{t.prefix}…</code>
              {scopeBadges(t)}
            </div>
            <div className="email">
              created {relativeTime(t.createdAt)} ago ·{' '}
              {t.lastUsedAt ? `last used ${relativeTime(t.lastUsedAt)} ago` : 'never used'}
              {t.expiresAt ? ` · expires ${relativeTime(t.expiresAt)}` : ''}
            </div>
          </div>
          <button className="icon-btn" title="Revoke token" onClick={() => revoke(t.id)}>
            <TrashIcon size={13} />
          </button>
        </div>
      ))}
      {tokens && tokens.length === 0 && (
        <div className="muted" style={{ fontSize: 12.5, padding: '6px 0' }}>
          No tokens yet.
        </div>
      )}

      <div className="row" style={{ gap: 8, marginTop: 10, maxWidth: 420 }}>
        <input
          className="input"
          placeholder={agent ? 'Token name (e.g. mcp)' : 'Token name (e.g. Claude Code)'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create();
          }}
        />
        <button className="btn primary" disabled={!name.trim()} onClick={create}>
          <PlusIcon size={13} /> Create token
        </button>
      </div>
    </>
  );
}
