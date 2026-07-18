import type { User, UserPreferences } from '@nonlinear/shared';
import { DEFAULT_PREFERENCES } from '@nonlinear/shared';
import { useStore } from './store.js';

/**
 * Applies user preferences to the document. Preferences live on the User and
 * sync across devices; we also mirror theme/font to localStorage so the very
 * first paint (before bootstrap) matches, avoiding a flash.
 */

let mediaListenerBound = false;

export function currentPreferences(): UserPreferences {
  const { userId, users } = useStore.getState();
  return (userId && users[userId]?.preferences) || DEFAULT_PREFERENCES;
}

function resolveTheme(pref: UserPreferences['theme']): 'dark' | 'light' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return pref;
}

export function applyPreferences(prefs: UserPreferences): void {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(prefs.theme);
  root.dataset.fontSize = prefs.fontSize;
  try {
    localStorage.setItem('nl-theme-pref', prefs.theme);
    localStorage.setItem('nl-font-size', prefs.fontSize);
  } catch {
    /* private mode */
  }

  // Re-resolve on OS theme change while in system mode.
  if (prefs.theme === 'system' && !mediaListenerBound) {
    mediaListenerBound = true;
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (currentPreferences().theme === 'system') {
        document.documentElement.dataset.theme = resolveTheme('system');
      }
    });
  }
}

/** Apply whatever the last-known preferences were, before bootstrap completes. */
export function applyStoredPreferences(): void {
  const root = document.documentElement;
  try {
    const theme = localStorage.getItem('nl-theme-pref') as UserPreferences['theme'] | null;
    const font = localStorage.getItem('nl-font-size');
    if (theme) root.dataset.theme = resolveTheme(theme);
    if (font) root.dataset.fontSize = font;
  } catch {
    /* ignore */
  }
}

/** How to render a person's name, honoring the display-names preference. */
export function personName(user: User | null | undefined): string {
  if (!user) return 'Unassigned';
  return currentPreferences().displayNames === 'display' ? user.displayName : user.name;
}

export function firstDayOfWeek(): number {
  return currentPreferences().firstDayOfWeek === 'sunday' ? 0 : 1;
}
