import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '../markdown.js';
import { SpinnerIcon } from '../icons.js';

/**
 * In-app reader for the product-design corpus in `docs/design/`. The markdown
 * files are served as static assets (copied into the build under
 * `/design/*.md`) and fetched on demand, so they never bloat the JS bundle.
 * This is nonlinear reflecting its own design thinking back to the reader.
 */

interface DocEntry {
  slug: string;
  title: string;
  blurb: string;
}

// Mirrors docs/design/README.md's table of contents.
const DOCS: DocEntry[] = [
  { slug: 'README', title: 'Overview', blurb: 'What this corpus is, and how to read it' },
  {
    slug: '01-product-vision',
    title: '01 · Product vision',
    blurb: 'Why a self-hostable Linear clone, and the owner’s hard constraints',
  },
  {
    slug: '02-domain-model',
    title: '02 · Domain model',
    blurb: 'The entity graph and its Linear-fidelity choices',
  },
  {
    slug: '03-real-time-sync',
    title: '03 · Real-time sync',
    blurb: 'Full-entity deltas on a monotonic log; bootstrap then stream',
  },
  {
    slug: '04-storage-and-modularity',
    title: '04 · Storage & modularity',
    blurb: 'The storage seam, jsonb-per-row, and keeping drivers out of the core',
  },
  {
    slug: '05-interaction-design',
    title: '05 · Interaction design',
    blurb: 'Pointer drag, keyboard-first flows, and the mobile layout',
  },
  {
    slug: '06-agent-platform',
    title: '06 · Agent platform',
    blurb: 'The three ways an agent uses nonlinear; why MCP is in-process',
  },
  {
    slug: '07-work-hierarchy',
    title: '07 · Work hierarchy',
    blurb: 'How initiatives, projects, milestones, issues and cycles nest',
  },
  {
    slug: '08-users-and-settings',
    title: '08 · Users & settings',
    blurb: 'Identity, dual auth, first-run bootstrap, and preferences',
  },
  {
    slug: '09-decision-log',
    title: '09 · Decision log',
    blurb: 'Consequential choices, alternatives, and accepted trade-offs',
  },
];

function useDoc(slug: string) {
  const [state, setState] = useState<{ loading: boolean; text: string; error: boolean }>({
    loading: true,
    text: '',
    error: false,
  });
  useEffect(() => {
    let live = true;
    setState({ loading: true, text: '', error: false });
    fetch(`/design/${slug}.md`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => {
        // The SPA fallback serves index.html for a missing asset; guard against
        // rendering an HTML document as if it were markdown.
        if (!live) return;
        if (text.trimStart().startsWith('<!doctype') || text.trimStart().startsWith('<!DOCTYPE')) {
          setState({ loading: false, text: '', error: true });
        } else {
          setState({ loading: false, text, error: false });
        }
      })
      .catch(() => live && setState({ loading: false, text: '', error: true }));
    return () => {
      live = false;
    };
  }, [slug]);
  return state;
}

const OVERVIEW: DocEntry = DOCS[0]!;

export function DesignDocsPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const current = DOCS.find((d) => d.slug === slug) ?? OVERVIEW;
  const { loading, text, error } = useDoc(current.slug);

  // In-prose cross-references are relative `.md` links (e.g. ./03-real-time-sync.md).
  // Keep them inside the reader instead of navigating to the raw asset.
  const onDocClick = (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href) return;
    const match = href.match(/(?:^|\/)([\w-]+)\.md(?:#|$)/);
    if (match && DOCS.some((d) => d.slug === match[1])) {
      e.preventDefault();
      navigate(`/design/${match[1]}`);
    }
  };

  return (
    <div className="detail design-docs">
      <aside className="detail-side design-docs-nav">
        <div className="design-docs-nav-head">
          <h2>Design docs</h2>
          <p>The product-design thinking behind nonlinear, reflected from the app.</p>
        </div>
        <nav>
          {DOCS.map((d) => (
            <Link
              key={d.slug}
              to={`/design/${d.slug}`}
              className={`design-docs-link${d.slug === current.slug ? ' active' : ''}`}
            >
              <span className="design-docs-link-title">{d.title}</span>
              <span className="design-docs-link-blurb">{d.blurb}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <main className="detail-main">
        <div className="container" style={{ maxWidth: 760 }} onClick={onDocClick}>
          {loading && (
            <div className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <SpinnerIcon size={16} /> Loading…
            </div>
          )}
          {error && (
            <div className="empty-state">
              <h3>Couldn’t load this document</h3>
              <p>
                The design corpus is served as static files from{' '}
                <code>/design/{current.slug}.md</code>. In a container build it is copied in
                automatically; under a bare dev server it may not be present.
              </p>
            </div>
          )}
          {!loading && !error && <Markdown source={text} />}
        </div>
      </main>
    </div>
  );
}
