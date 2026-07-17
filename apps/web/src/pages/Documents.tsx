import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Document } from '@nonlinear/shared';
import { api } from '../api.js';
import { relativeTime, useStore } from '../store.js';
import { Avatar, anchorFromEvent, Popover, toastError, type Anchor } from '../ui.js';
import { DotsIcon, PencilIcon, PlusIcon, ProjectIcon, TrashIcon } from '../icons.js';
import { Markdown } from '../markdown.js';
import { DocumentCommentsPanel, getSelectionInElement } from '../components/DocumentComments.js';

function DocGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

export function DocumentsPage() {
  const documents = useStore((s) => s.documents);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const navigate = useNavigate();
  const [title, setTitle] = useState('');

  const rows = useMemo(
    () => Object.values(documents).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [documents],
  );

  const create = () => {
    if (!title.trim()) return;
    void api
      .createDocument({ title })
      .then((doc) => {
        useStore.getState().putEntity('document', doc);
        setTitle('');
        navigate(`/document/${doc.id}`);
      })
      .catch(toastError);
  };

  return (
    <>
      <div className="topbar">
        <div className="title">
          <DocGlyph size={16} />
          Documents
        </div>
        <span className="spacer" />
        <input
          className="input"
          style={{ width: 200, height: 26 }}
          placeholder="New document…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create();
          }}
        />
        <button className="btn primary" disabled={!title.trim()} onClick={create}>
          <PlusIcon size={13} /> Create
        </button>
      </div>
      <div className="content">
        {rows.length === 0 && (
          <div className="empty-state">
            <DocGlyph size={26} />
            <h3>No documents</h3>
            <p>Write specs, plans, and notes alongside your issues.</p>
          </div>
        )}
        {rows.map((doc) => {
          const project = doc.projectId ? projects[doc.projectId] : null;
          const creator = users[doc.creatorId];
          return (
            <div
              key={doc.id}
              className="project-row"
              onClick={() => navigate(`/document/${doc.id}`)}
            >
              <DocGlyph size={14} />
              <span className="name">{doc.title}</span>
              {project && (
                <span className="chip">
                  <ProjectIcon size={11} />
                  {project.name}
                </span>
              )}
              <span className="grow" />
              <span className="dim">edited {relativeTime(doc.updatedAt)} ago</span>
              <Avatar user={creator} size={18} />
            </div>
          );
        })}
      </div>
    </>
  );
}

export function DocumentDetailPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const documents = useStore((s) => s.documents);
  const doc = documentId ? documents[documentId] : null;
  if (!doc) {
    return (
      <div className="empty-state">
        <h3>Document not found</h3>
      </div>
    );
  }
  return <DocumentEditor key={doc.id} doc={doc} />;
}

function DocumentEditor({ doc }: { doc: Document }) {
  const projects = useStore((s) => s.projects);
  const navigate = useNavigate();
  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.content);
  const [editing, setEditing] = useState(doc.content === '');
  const [menuAnchor, setMenuAnchor] = useState<Anchor | null>(null);
  const [projectAnchor, setProjectAnchor] = useState<Anchor | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const project = doc.projectId ? projects[doc.projectId] : null;

  useEffect(() => {
    if (!editing) setContent(doc.content);
  }, [doc.content, editing]);

  const save = (patch: Record<string, unknown>) => {
    void api
      .updateDocument(doc.id, patch)
      .then((d) => useStore.getState().putEntity('document', d))
      .catch(toastError);
  };

  return (
    <>
      <div className="topbar">
        <div className="title">
          <Link to="/documents" className="crumb">
            Documents
          </Link>
          <span className="crumb">›</span>
          <DocGlyph size={15} />
          <span className="truncate">{doc.title}</span>
        </div>
        <span className="spacer" />
        <button className="chip" onClick={(e) => setProjectAnchor(anchorFromEvent(e))}>
          <ProjectIcon size={12} />
          {project?.name ?? 'No project'}
        </button>
        {!editing && (
          <button className="btn" onClick={() => setEditing(true)}>
            <PencilIcon size={13} /> Edit
          </button>
        )}
        <button className="icon-btn" onClick={(e) => setMenuAnchor(anchorFromEvent(e))}>
          <DotsIcon size={15} />
        </button>
      </div>

      <div className="detail">
        <div
          className="detail-main"
          ref={contentRef}
          onMouseUp={() => {
            if (editing || !contentRef.current) return;
            const sel = getSelectionInElement(contentRef.current);
            if (sel) setPendingAnchor(sel);
          }}
        >
          <div className="container">
            <input
              className="detail-title"
              style={{ marginBottom: 14 }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title.trim() && title !== doc.title) save({ title });
                else setTitle(doc.title);
              }}
            />
            {editing ? (
              <>
                <textarea
                  className="input"
                  autoFocus
                  rows={Math.max(16, content.split('\n').length + 2)}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      save({ content });
                      setEditing(false);
                    }
                  }}
                  placeholder="Write in markdown…"
                />
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10, gap: 6 }}>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setContent(doc.content);
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => {
                      save({ content });
                      setEditing(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              </>
            ) : doc.content.trim() ? (
              <div onDoubleClick={() => setEditing(true)} style={{ cursor: 'text' }}>
                <Markdown source={doc.content} />
              </div>
            ) : (
              <button
                className="btn ghost"
                style={{ color: 'var(--text-4)' }}
                onClick={() => setEditing(true)}
              >
                Start writing…
              </button>
            )}
          </div>
        </div>
        <div className="detail-side">
          <DocumentCommentsPanel
            documentId={doc.id}
            pendingAnchor={pendingAnchor}
            onAnchorConsumed={() => setPendingAnchor(null)}
          />
        </div>
      </div>

      {projectAnchor && (
        <Popover anchor={projectAnchor} onClose={() => setProjectAnchor(null)} width={240}>
          <button
            className="menu-item"
            onClick={() => {
              save({ projectId: null });
              setProjectAnchor(null);
            }}
          >
            <span className="grow">No project</span>
          </button>
          {Object.values(projects).map((p) => (
            <button
              key={p.id}
              className="menu-item"
              onClick={() => {
                save({ projectId: p.id });
                setProjectAnchor(null);
              }}
            >
              <ProjectIcon size={13} />
              <span className="grow">{p.name}</span>
            </button>
          ))}
        </Popover>
      )}
      {menuAnchor && (
        <Popover anchor={menuAnchor} onClose={() => setMenuAnchor(null)} width={190}>
          <button
            className="menu-item destructive"
            onClick={() => {
              setMenuAnchor(null);
              void api
                .deleteDocument(doc.id)
                .then(() => {
                  const next = { ...useStore.getState().documents };
                  delete next[doc.id];
                  useStore.setState({ documents: next });
                  navigate('/documents');
                })
                .catch(toastError);
            }}
          >
            <TrashIcon size={14} />
            <span className="grow">Delete document</span>
          </button>
        </Popover>
      )}
    </>
  );
}
