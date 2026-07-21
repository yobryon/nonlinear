import { useEffect, useState } from 'react';
import type { ApiToken } from '@nonlinear/shared';
import { api } from '../api.js';
import { relativeTime, useStore } from '../store.js';
import { toast, toastError } from '../ui.js';
import { CopyIcon, PlusIcon, TrashIcon } from '../icons.js';

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
