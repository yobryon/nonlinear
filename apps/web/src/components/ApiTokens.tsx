import { useEffect, useState } from 'react';
import type { ApiToken } from '@nonlinear/shared';
import { api } from '../api.js';
import { relativeTime } from '../store.js';
import { toast, toastError } from '../ui.js';
import { CopyIcon, PlusIcon, TrashIcon } from '../icons.js';

/**
 * Personal API tokens for programmatic access (REST + MCP). Tokens aren't part
 * of the sync store — they're bearer secrets — so this fetches them directly.
 */
export function ApiTokens() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ secret: string } | null>(null);

  const refresh = () => {
    void api
      .listTokens()
      .then(setTokens)
      .catch(() => setTokens([]));
  };
  useEffect(refresh, []);

  const create = () => {
    if (!name.trim()) return;
    void api
      .createToken(name.trim())
      .then((res) => {
        setCreated({ secret: res.secret });
        setName('');
        refresh();
      })
      .catch(toastError);
  };

  return (
    <>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Use a token as <code>Authorization: Bearer &lt;token&gt;</code> against the REST API or the
        MCP server at <code>/mcp</code>. Shown once — store it somewhere safe.
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
            <div>
              {t.name} <code className="dim">{t.prefix}…</code>
            </div>
            <div className="email">
              created {relativeTime(t.createdAt)} ago ·{' '}
              {t.lastUsedAt ? `last used ${relativeTime(t.lastUsedAt)} ago` : 'never used'}
              {t.expiresAt ? ` · expires ${relativeTime(t.expiresAt)}` : ''}
            </div>
          </div>
          <button
            className="icon-btn"
            title="Revoke token"
            onClick={() => {
              void api.deleteToken(t.id).then(refresh).catch(toastError);
            }}
          >
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
          placeholder="Token name (e.g. Claude Code)"
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
