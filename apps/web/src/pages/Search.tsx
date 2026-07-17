import { useEffect, useMemo, useState } from 'react';
import type { Issue } from '@nonlinear/shared';
import { issueKey, useStore } from '../store.js';
import { SearchIcon } from '../icons.js';
import {
  applyFilters,
  EMPTY_FILTERS,
  IssueRow,
  ViewControls,
  type IssueFilters,
} from '../issueViews.js';

const MAX_RESULTS = 100;

interface SearchMatch {
  issue: Issue;
  score: number;
  /** One-line excerpt from the first comment containing a query token, if any. */
  snippet: string | null;
}

function tokenize(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Single-line excerpt around the first token occurrence in `raw`. */
function makeSnippet(raw: string, lower: string, tokens: string[]): string {
  let at = -1;
  for (const tok of tokens) {
    const i = lower.indexOf(tok);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) at = 0;
  const start = Math.max(0, at - 40);
  const end = Math.min(raw.length, at + 90);
  const text = raw.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${text}${end < raw.length ? '…' : ''}`;
}

export function SearchPage() {
  const issues = useStore((s) => s.issues);
  const comments = useStore((s) => s.comments);
  const teams = useStore((s) => s.teams);

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<IssueFilters>(EMPTY_FILTERS);

  // Debounce the store scan; the input itself stays instant.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 150);
    return () => clearTimeout(t);
  }, [input]);

  const commentsByIssue = useMemo(() => {
    const map: Record<string, Array<{ raw: string; lower: string }>> = {};
    for (const c of Object.values(comments)) {
      (map[c.issueId] ??= []).push({ raw: c.body, lower: c.body.toLowerCase() });
    }
    return map;
  }, [comments]);

  const tokens = useMemo(() => tokenize(query), [query]);

  const matches = useMemo<SearchMatch[]>(() => {
    if (tokens.length === 0) return [];
    const out: SearchMatch[] = [];
    for (const issue of Object.values(issues)) {
      if (issue.archivedAt) continue;
      const key = issueKey(issue, teams).toLowerCase();
      const title = issue.title.toLowerCase();
      const description = issue.description.toLowerCase();
      const bodies = commentsByIssue[issue.id] ?? [];
      let score = 0;
      let commentHit: { raw: string; lower: string } | null = null;
      let allTokensMatch = true;
      for (const tok of tokens) {
        let tokenScore = 0;
        if (tok === key) tokenScore += 3; // identifier like "non-12"
        if (title.includes(tok)) tokenScore += 3;
        if (description.includes(tok)) tokenScore += 1;
        const body = bodies.find((b) => b.lower.includes(tok));
        if (body) {
          tokenScore += 1;
          commentHit ??= body;
        }
        if (tokenScore === 0) {
          allTokensMatch = false;
          break;
        }
        score += tokenScore;
      }
      if (!allTokensMatch) continue;
      out.push({
        issue,
        score,
        snippet: commentHit ? makeSnippet(commentHit.raw, commentHit.lower, tokens) : null,
      });
    }
    out.sort((a, b) => b.score - a.score || b.issue.updatedAt.localeCompare(a.issue.updatedAt));
    return out;
  }, [tokens, issues, teams, commentsByIssue]);

  // Filters apply after the text match; keep ranked order.
  const filtered = useMemo(() => {
    const allowed = new Set(
      applyFilters(
        matches.map((m) => m.issue),
        filters,
      ).map((i) => i.id),
    );
    return matches.filter((m) => allowed.has(m.issue.id));
  }, [matches, filters]);

  const shown = filtered.slice(0, MAX_RESULTS);
  const searching = tokens.length > 0;

  return (
    <>
      <div className="topbar">
        <SearchIcon size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search issues, descriptions, and comments…"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            font: 'inherit',
            fontSize: 15,
            color: 'var(--text-1)',
          }}
        />
        {searching && (
          <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {filtered.length === 1 ? '1 result' : `${filtered.length} results`}
          </span>
        )}
      </div>

      <ViewControls filters={filters} onFilters={setFilters} />

      <div className="content">
        {!searching && (
          <div className="empty-state">
            <SearchIcon size={26} style={{ color: 'var(--text-4)' }} />
            <h3>Search your workspace</h3>
            <p>
              Results appear as you type — issue titles, descriptions, and comments. Jump straight
              to an issue with its ID, like <span className="kbd">NON-12</span>.
            </p>
          </div>
        )}

        {searching && filtered.length === 0 && (
          <div className="empty-state">
            <SearchIcon size={26} style={{ color: 'var(--text-4)' }} />
            <h3>No results for “{query.trim()}”</h3>
            <p>Try different words, or clear filters to widen the search.</p>
          </div>
        )}

        {shown.map((m) => (
          <div key={m.issue.id}>
            <IssueRow issue={m.issue} />
            {m.snippet && (
              <div
                className="dim"
                style={{
                  padding: '5px 16px 7px 50px',
                  fontSize: 12,
                  borderBottom: '1px solid var(--border)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {m.snippet}
              </div>
            )}
          </div>
        ))}

        {filtered.length > MAX_RESULTS && (
          <div className="muted" style={{ padding: '10px 20px', fontSize: 12 }}>
            Showing the first {MAX_RESULTS} of {filtered.length} results — refine your search to see
            the rest.
          </div>
        )}
      </div>
    </>
  );
}
