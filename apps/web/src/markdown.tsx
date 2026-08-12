import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import { useStore } from './store.js';
import { originState, type NavOrigin } from './nav.js';

marked.setOptions({ gfm: true, breaks: true, async: false });

/** `TEAM-42` (issue) or `TEAM-D12` (decision). The `D` marks a decision. */
const ENTITY_RE = /\b([A-Z][A-Z0-9]*)-(D?)(\d+)\b/g;

/**
 * Resolve an entity key to a route, but only when it points at something real
 * and openable: a team on the roster, and an entity that exists in the store.
 * Returns null otherwise, so `UTF-8` or a stale reference stays plain text.
 */
function buildResolver() {
  const s = useStore.getState();
  const teamByKey = new Map(Object.values(s.teams).map((t) => [t.key.toUpperCase(), t]));
  const issueExists = new Set<string>();
  for (const i of Object.values(s.issues)) issueExists.add(`${i.teamId}:${i.number}`);
  const decisionId = new Map<string, string>();
  for (const d of Object.values(s.decisions)) decisionId.set(`${d.teamId}:${d.number}`, d.id);
  return (key: string, isDecision: boolean, number: number): string | null => {
    const team = teamByKey.get(key);
    if (!team) return null;
    const at = `${team.id}:${number}`;
    if (isDecision) {
      const id = decisionId.get(at);
      return id ? `/decision/${id}` : null;
    }
    return issueExists.has(at) ? `/issue/${team.key}-${number}` : null;
  };
}

/** Rewrite entity keys in the rendered HTML's text into internal links. */
function linkifyEntities(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const resolve = buildResolver();
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const candidates: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    const value = text.nodeValue;
    if (!value || !value.includes('-')) continue;
    // Never touch code, links, or headings-that-are-links.
    if (text.parentElement?.closest('a, code, pre')) continue;
    ENTITY_RE.lastIndex = 0;
    if (ENTITY_RE.test(value)) candidates.push(text);
  }
  for (const text of candidates) {
    const value = text.nodeValue ?? '';
    const frag = doc.createDocumentFragment();
    let last = 0;
    let made = false;
    ENTITY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ENTITY_RE.exec(value))) {
      const [raw, key, d, num] = m;
      const to = resolve(key!, d === 'D', Number(num));
      if (!to) continue;
      if (m.index > last) frag.appendChild(doc.createTextNode(value.slice(last, m.index)));
      const a = doc.createElement('a');
      a.className = 'entity-link';
      a.setAttribute('data-to', to);
      a.textContent = raw;
      frag.appendChild(a);
      last = m.index + raw.length;
      made = true;
    }
    if (!made) continue;
    if (last < value.length) frag.appendChild(doc.createTextNode(value.slice(last)));
    text.parentNode?.replaceChild(frag, text);
  }
  return doc.body.innerHTML;
}

/** The page you're on, as an origin for the "way back" crumb — labeled where we
 *  can, and carrying its own incoming origin so the chain survives hops. */
function proseOrigin(location: ReturnType<typeof useLocation>): NavOrigin | undefined {
  const s = useStore.getState();
  const path = location.pathname;
  let label: string | undefined;
  if (path.startsWith('/issue/')) label = decodeURIComponent(path.slice(7));
  else if (path.startsWith('/decision/')) {
    const dec = s.decisions[path.slice(10)];
    const team = dec ? s.teams[dec.teamId] : undefined;
    if (dec && team) label = `${team.key}-D${dec.number}`;
  } else if (path.startsWith('/project/')) label = s.projects[path.slice(9)]?.name;
  else if (path.startsWith('/document/')) label = s.documents[path.slice(10)]?.title;
  if (!label) return undefined;
  const incoming = (location.state as { from?: NavOrigin } | null)?.from;
  return { label, to: path + location.search, from: incoming };
}

/**
 * Render markdown safely: neutralize raw HTML by escaping `&` and `<` before
 * parsing, so a literal tag like `<img onerror>` becomes text and only
 * marked-generated markup reaches the DOM. `>` is deliberately left intact — a
 * lone `>` can't open an HTML tag, and escaping it would break blockquotes.
 *
 * Entity keys (`TEAM-42`, `TEAM-D12`) in the prose become internal links; a
 * click navigates client-side and carries the current page as the way-back
 * origin, so the destination's breadcrumb returns you here.
 */
export function Markdown({ source }: { source: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const html = useMemo(() => {
    const escaped = source.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return linkifyEntities(marked.parse(escaped) as string);
  }, [source]);
  if (!source.trim()) return null;
  return (
    <div
      className="md"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a.entity-link');
        const to = a?.getAttribute('data-to');
        if (!to) return;
        e.preventDefault();
        navigate(to, { state: originState(proseOrigin(location)) });
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
