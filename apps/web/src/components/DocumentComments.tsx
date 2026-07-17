import { useMemo, useState } from 'react';
import type { DocumentComment } from '@nonlinear/shared';
import { api } from '../api.js';
import { relativeTime, useStore } from '../store.js';
import { Avatar, toastError } from '../ui.js';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, TrashIcon } from '../icons.js';
import { Markdown } from '../markdown.js';

/** Trimmed text of the current selection if it lies inside `el`, else null. */
export function getSelectionInElement(el: HTMLElement): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const { anchorNode, focusNode } = sel;
  if (!anchorNode || !focusNode) return null;
  if (!el.contains(anchorNode) || !el.contains(focusNode)) return null;
  const text = sel.toString().trim();
  return text || null;
}

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function AnchorQuote({ text }: { text: string }) {
  return (
    <div
      className="dim"
      style={{
        margin: '8px 14px 0',
        padding: '2px 10px',
        borderLeft: '2px solid var(--border-strong)',
        fontSize: 12,
        fontStyle: 'italic',
        lineHeight: 1.5,
      }}
    >
      “{truncate(text)}”
    </div>
  );
}

function CommentCard({ comment }: { comment: DocumentComment }) {
  const users = useStore((s) => s.users);
  const userId = useStore((s) => s.userId);
  const [busy, setBusy] = useState(false);
  const author = users[comment.authorId];
  const resolved = comment.resolvedAt !== null;

  const toggleResolved = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await api.updateDocumentComment(comment.id, { resolved: !resolved });
      useStore.getState().putEntity('documentComment', updated);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !window.confirm('Delete this comment?')) return;
    setBusy(true);
    try {
      await api.deleteDocumentComment(comment.id);
      useStore.setState((s) => {
        const next = { ...s.documentComments };
        delete next[comment.id];
        return { documentComments: next };
      });
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  return (
    <div className="comment" style={resolved ? { opacity: 0.55 } : undefined}>
      <div className="comment-head">
        <Avatar user={author} size={18} />
        <span className="who">{author?.name ?? 'Unknown'}</span>
        <span className="when">{relativeTime(comment.createdAt)}</span>
        <span className="grow" />
        <button
          className={`icon-btn${resolved ? ' active' : ''}`}
          title={resolved ? 'Unresolve' : 'Resolve'}
          disabled={busy}
          onClick={() => void toggleResolved()}
        >
          <CheckIcon size={14} />
        </button>
        {comment.authorId === userId && (
          <button
            className="icon-btn"
            title="Delete comment"
            disabled={busy}
            onClick={() => void remove()}
          >
            <TrashIcon size={13} />
          </button>
        )}
      </div>
      {comment.anchorText && <AnchorQuote text={comment.anchorText} />}
      <div className="comment-body">
        <Markdown source={comment.body} />
      </div>
    </div>
  );
}

export function DocumentCommentsPanel({
  documentId,
  pendingAnchor,
  onAnchorConsumed,
}: {
  documentId: string;
  pendingAnchor?: string | null;
  onAnchorConsumed?: () => void;
}) {
  const documentComments = useStore((s) => s.documentComments);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const { open, resolved } = useMemo(() => {
    const all = Object.values(documentComments)
      .filter((c) => c.documentId === documentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      open: all.filter((c) => c.resolvedAt === null),
      resolved: all.filter((c) => c.resolvedAt !== null),
    };
  }, [documentComments, documentId]);

  const total = open.length + resolved.length;

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const created = await api.createDocumentComment({
        documentId,
        body: text,
        anchorText: pendingAnchor ?? null,
      });
      useStore.getState().putEntity('documentComment', created);
      setBody('');
      if (pendingAnchor) onAnchorConsumed?.();
    } catch (err) {
      toastError(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Comments</span>
        {total > 0 && <span className="dim">{total}</span>}
      </div>

      {pendingAnchor && (
        <div
          className="row dim"
          style={{
            marginBottom: 6,
            padding: '4px 8px',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
            fontStyle: 'italic',
          }}
        >
          <span className="grow" style={{ minWidth: 0 }}>
            “{truncate(pendingAnchor)}”
          </span>
          <button className="icon-btn" title="Discard quote" onClick={() => onAnchorConsumed?.()}>
            <CloseIcon size={13} />
          </button>
        </div>
      )}

      <textarea
        className="input"
        rows={2}
        style={{ minHeight: 0 }}
        placeholder={pendingAnchor ? 'Comment on the selection…' : 'Leave a comment…'}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
        }}
      />
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
        <button
          className="btn primary"
          disabled={!body.trim() || sending}
          onClick={() => void send()}
        >
          Comment
        </button>
      </div>

      {total === 0 && (
        <p className="dim" style={{ marginTop: 14, fontSize: 12.5, lineHeight: 1.5 }}>
          No comments yet. Select text in the document to comment on it.
        </p>
      )}

      {open.map((comment) => (
        <CommentCard key={comment.id} comment={comment} />
      ))}

      {resolved.length > 0 && (
        <>
          <button
            className="row dim"
            style={{ gap: 4, marginTop: 12, fontSize: 12 }}
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
            Resolved ({resolved.length})
          </button>
          {showResolved &&
            resolved.map((comment) => <CommentCard key={comment.id} comment={comment} />)}
        </>
      )}
    </div>
  );
}
