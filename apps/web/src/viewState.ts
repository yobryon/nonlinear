import { create } from 'zustand';
import type { Grouping, IssueSort } from '@nonlinear/shared';
import { EMPTY_FILTERS, type IssueFilters } from './issueViews.js';

/**
 * Per-scope issue-list view settings (filter / group / sort / display /
 * collapsed groups), kept sticky so navigating into an issue and back — or
 * reloading — restores exactly what you were looking at. Scopes are keyed
 * `team:<id>` or `project:<id>`; the tab lives in the URL and is not stored
 * here. Persisted to localStorage; this is a device-local preference, not
 * synced state.
 */

export interface ScopeView {
  filters: IssueFilters;
  grouping: Grouping;
  sort: IssueSort;
  display: 'list' | 'board';
  /** Group keys the user has collapsed. */
  collapsed: string[];
}

export const DEFAULT_SCOPE_VIEW: ScopeView = {
  filters: EMPTY_FILTERS,
  grouping: 'state',
  sort: 'priority',
  display: 'list',
  collapsed: [],
};

const STORAGE_KEY = 'nl.viewState';

/** Merge a persisted (possibly older-shaped) view onto the current defaults. */
function normalize(raw: Partial<ScopeView> | undefined): ScopeView {
  return {
    ...DEFAULT_SCOPE_VIEW,
    ...raw,
    filters: { ...EMPTY_FILTERS, ...(raw?.filters ?? {}) },
    collapsed: raw?.collapsed ?? [],
  };
}

function load(): Record<string, ScopeView> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<
      string,
      Partial<ScopeView>
    >;
    const out: Record<string, ScopeView> = {};
    for (const [scope, view] of Object.entries(parsed)) out[scope] = normalize(view);
    return out;
  } catch {
    return {};
  }
}

interface ViewStateStore {
  scopes: Record<string, ScopeView>;
  patch: (scope: string, patch: Partial<ScopeView>) => void;
}

const useViewStateStore = create<ViewStateStore>((set, get) => ({
  scopes: load(),
  patch: (scope, patch) => {
    const current = get().scopes[scope] ?? DEFAULT_SCOPE_VIEW;
    const next = { ...get().scopes, [scope]: { ...current, ...patch } };
    set({ scopes: next });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — settings simply won't persist across reloads */
    }
  },
}));

/** Subscribe to a scope's sticky view. Returns a stable default until touched. */
export function useScopeView(scope: string): ScopeView {
  return useViewStateStore((s) => s.scopes[scope] ?? DEFAULT_SCOPE_VIEW);
}

export function patchScopeView(scope: string, patch: Partial<ScopeView>): void {
  useViewStateStore.getState().patch(scope, patch);
}

/** Toggle whether a group is collapsed within a scope. */
export function toggleScopeCollapsed(scope: string, groupKey: string): void {
  const current = useViewStateStore.getState().scopes[scope] ?? DEFAULT_SCOPE_VIEW;
  const collapsed = current.collapsed.includes(groupKey)
    ? current.collapsed.filter((k) => k !== groupKey)
    : [...current.collapsed, groupKey];
  patchScopeView(scope, { collapsed });
}
