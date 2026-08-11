import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '../markdown.js';
import { SpinnerIcon } from '../icons.js';

/**
 * In-app documentation reader. One hub for three corpora, all served as static
 * assets (copied into the build so they never bloat the JS bundle) and fetched
 * on demand:
 *   - Guides   → /guides/*.md          (setup & use, for humans and agents)
 *   - Design   → /design/*.md          (the product-design reasoning)
 *   - Reference→ /configuration.md      (operator env-var reference)
 * This is nonlinear reflecting its own documentation back to the reader.
 */

interface DocEntry {
  slug: string;
  title: string;
  blurb: string;
  /** Override the default `/${group}/${slug}.md` asset path. */
  file?: string;
}

interface DocGroup {
  key: string;
  label: string;
  docs: DocEntry[];
}

const GROUPS: DocGroup[] = [
  {
    key: 'guides',
    label: 'Guides',
    docs: [
      {
        slug: 'README',
        title: 'Overview',
        blurb: 'The three audiences and the trust-domain model',
      },
      {
        slug: '01-guide-for-humans',
        title: 'For humans',
        blurb: 'Stand up nonlinear, invite people, choose a deployment pattern',
      },
      {
        slug: '02-guide-for-provider-agents',
        title: 'For provider agents',
        blurb: 'Run a tool’s project and service the issues filed against it',
      },
      {
        slug: '03-guide-for-consumer-agents',
        title: 'For consumer agents',
        blurb: 'Report and track bugs against a tool you depend on',
      },
    ],
  },
  {
    key: 'design',
    label: 'Design',
    docs: [
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
        blurb: 'Drag & drop, keyboard-first flows, and the mobile layout',
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
    ],
  },
  {
    key: 'reference',
    label: 'Reference',
    docs: [
      {
        slug: 'configuration',
        title: 'Configuration',
        blurb: 'Operator env vars: storage, SSO, SCIM, SMTP, AI, blob backend',
        file: '/configuration.md',
      },
    ],
  },
];

/** All (group, doc) pairs flattened, for lookup by slug in cross-links. */
const ALL: { group: DocGroup; doc: DocEntry }[] = GROUPS.flatMap((group) =>
  group.docs.map((doc) => ({ group, doc })),
);

const DEFAULT = { group: GROUPS[0]!, doc: GROUPS[0]!.docs[0]! };

function assetPath(group: DocGroup, doc: DocEntry): string {
  return doc.file ?? `/${group.key}/${doc.slug}.md`;
}

function useDoc(path: string) {
  const [state, setState] = useState<{ loading: boolean; text: string; error: boolean }>({
    loading: true,
    text: '',
    error: false,
  });
  useEffect(() => {
    let live = true;
    setState({ loading: true, text: '', error: false });
    fetch(path)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => {
        if (!live) return;
        // The SPA fallback serves index.html for a missing asset; guard against
        // rendering an HTML document as if it were markdown.
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
  }, [path]);
  return state;
}

export function DocsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const groupKey = params.group ?? DEFAULT.group.key;
  const slug = params.slug ?? DEFAULT.doc.slug;
  const group = GROUPS.find((g) => g.key === groupKey) ?? DEFAULT.group;
  const doc = group.docs.find((d) => d.slug === slug) ?? group.docs[0] ?? DEFAULT.doc;
  const { loading, text, error } = useDoc(assetPath(group, doc));

  // In-prose cross-references are relative `.md` links (e.g. ./03-real-time-sync.md,
  // ../configuration.md, ../design/README.md). Resolve any that point at a doc we
  // host and keep navigation inside the reader; let anything else behave normally.
  const onDocClick = (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href) return;
    const match = href.match(/(?:^|\/)([\w.-]+?)(?:\.md)?(?:#|$)/);
    const base = match?.[1];
    if (!base) return;
    const hit = ALL.find((x) => x.doc.slug === base);
    if (hit) {
      e.preventDefault();
      navigate(`/docs/${hit.group.key}/${hit.doc.slug}`);
    }
  };

  return (
    <div className="detail design-docs">
      <aside className="detail-side design-docs-nav">
        <div className="design-docs-nav-head">
          <h2>Help &amp; docs</h2>
          <p>Guides, the design corpus, and the operator reference — reflected from the app.</p>
        </div>
        <nav>
          {GROUPS.map((g) => (
            <div key={g.key} className="docs-nav-group">
              <div className="docs-nav-group-label">{g.label}</div>
              {g.docs.map((d) => (
                <Link
                  key={`${g.key}/${d.slug}`}
                  to={`/docs/${g.key}/${d.slug}`}
                  className={`design-docs-link${
                    g.key === group.key && d.slug === doc.slug ? ' active' : ''
                  }`}
                >
                  <span className="design-docs-link-title">{d.title}</span>
                  <span className="design-docs-link-blurb">{d.blurb}</span>
                </Link>
              ))}
            </div>
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
                Docs are served as static files from <code>{assetPath(group, doc)}</code>. In a
                container build they are copied in automatically; under a bare dev server they may
                not be present.
              </p>
            </div>
          )}
          {!loading && !error && <Markdown source={text} />}
        </div>
      </main>
    </div>
  );
}
