import { api } from './api.js';
import { useStore } from './store.js';
import { applyPreferences, currentPreferences } from './preferences.js';
import { toastError } from './ui.js';

export type Theme = 'dark' | 'light';

/** The theme currently painted (resolves 'system'). */
export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Persist a theme preference (dark/light/system) to the user + apply it. */
export function setThemePreference(theme: 'dark' | 'light' | 'system'): void {
  const prefs = { ...currentPreferences(), theme };
  applyPreferences(prefs);
  const userId = useStore.getState().userId;
  if (userId) {
    // Optimistic local update, then persist.
    const user = useStore.getState().users[userId];
    if (user) useStore.getState().putEntity('user', { ...user, preferences: prefs });
    void api.updateProfile({ preferences: { theme } }).catch(toastError);
  }
}

/** Toggle between the two concrete themes (from whatever is painted now). */
export function toggleTheme(): void {
  setThemePreference(getTheme() === 'dark' ? 'light' : 'dark');
}
