import { createContext, useContext } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';

/**
 * Navigation origin — the place a user was when they opened a detail view.
 *
 * Two friction patterns motivated this module:
 *  (A) detail breadcrumbs used to point at a *canonical* home (an issue's team,
 *      the workspace Projects list) regardless of where you actually came from;
 *  (B) in-view tab state lived in React state, so browser-back couldn't restore it.
 *
 * `useUrlTab` fixes (B) by parking the tab in the URL. The origin context +
 * `OriginCrumb` fix (A): a view records where it is, links into details carry
 * that origin in `location.state`, and the detail's first breadcrumb becomes a
 * labeled "back" to exactly that spot — falling back to the canonical crumb on
 * deep-links or refresh, so nothing regresses.
 */
export type NavOrigin = { label: string; to: string };

const OriginContext = createContext<NavOrigin | null>(null);

/** Wrap a view (or a list within it) to record where child detail-links lead back to. */
export const OriginProvider = OriginContext.Provider;

/** The origin the current view wants its detail-links to record, if any. */
export function useCurrentOrigin(): NavOrigin | null {
  return useContext(OriginContext);
}

/** `location.state` to attach when opening a detail from `origin` (or nothing). */
export function originState(origin: NavOrigin | null | undefined): { from: NavOrigin } | undefined {
  return origin ? { from: origin } : undefined;
}

/** The origin that led to the current detail view, read back from history state. */
export function useNavOrigin(): NavOrigin | null {
  const loc = useLocation();
  const from = (loc.state as { from?: NavOrigin } | null)?.from;
  return from && typeof from.label === 'string' && typeof from.to === 'string' ? from : null;
}

/**
 * A detail view's first breadcrumb: the labeled origin (a "back" link) when we
 * know it, otherwise the caller's canonical `fallback` crumb.
 */
export function OriginCrumb({ fallback }: { fallback: React.ReactNode }) {
  const origin = useNavOrigin();
  if (!origin) return <>{fallback}</>;
  return (
    <Link to={origin.to} className="crumb crumb-back" title={`Back to ${origin.label}`}>
      <span aria-hidden="true">‹</span> {origin.label}
    </Link>
  );
}

/**
 * Tab state parked in the `?tab=` URL param so history (and shared links)
 * restore it. Switching a tab `replace`s the entry — it reflects the current
 * view rather than stacking a history frame — and the default tab keeps the
 * URL clean by omitting the param entirely.
 */
export function useUrlTab<T extends string>(
  tabs: readonly T[],
  fallback: T,
): [T, (tab: T) => void] {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const raw = params.get('tab');
  const tab = (tabs as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
  const setTab = (next: T) => {
    setParams(
      (prev) => {
        const merged = new URLSearchParams(prev);
        if (next === fallback) merged.delete('tab');
        else merged.set('tab', next);
        return merged;
      },
      // Replace (a tab reflects the current view, not a new history frame) and
      // preserve any origin passed in `location.state` so the back-crumb survives.
      { replace: true, state: location.state },
    );
  };
  return [tab, setTab];
}
