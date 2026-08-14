import { create } from 'zustand';
import { Modal } from './ui.js';
import { CloseIcon } from './icons.js';

/** Global open/close for the keyboard-shortcut cheat sheet. */
interface HelpState {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

export const useHelp = create<HelpState>((set, get) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
}));

export function openHelp(): void {
  useHelp.getState().show();
}

/** One key or key-combo, rendered as styled caps. */
function Keys({ combo }: { combo: string[] }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      {combo.map((k, i) => (
        <span key={i} className="kbd">
          {k}
        </span>
      ))}
    </span>
  );
}

interface Shortcut {
  keys: string[];
  label: string;
}

const SECTIONS: Array<{ title: string; items: Shortcut[] }> = [
  {
    title: 'General',
    items: [
      { keys: ['⌘', 'K'], label: 'Open command palette' },
      { keys: ['C'], label: 'Create a new issue' },
      { keys: ['/'], label: 'Search' },
      { keys: ['?'], label: 'Show this shortcut list' },
      { keys: ['Esc'], label: 'Close a dialog or clear a selection' },
    ],
  },
  {
    title: 'Go to',
    items: [
      { keys: ['G', 'I'], label: 'Inbox' },
      { keys: ['G', 'M'], label: 'My Issues' },
      { keys: ['G', 'P'], label: 'Projects' },
      { keys: ['G', 'S'], label: 'Settings' },
    ],
  },
  {
    title: 'Issue list',
    items: [
      { keys: ['⌘', 'Click'], label: 'Add an issue to the selection' },
      { keys: ['Shift', 'Click'], label: 'Select a range of issues' },
      { keys: ['Right-click'], label: 'Open an issue’s quick menu' },
    ],
  },
];

export function ShortcutsDialog() {
  const { open, hide } = useHelp();
  if (!open) return null;
  return (
    <Modal onClose={hide} width={520}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '14px 18px 6px',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 15 }}>Keyboard shortcuts</span>
        <span className="grow" />
        <button className="icon-btn" onClick={hide} aria-label="Close">
          <CloseIcon size={15} />
        </button>
      </div>
      <div
        style={{
          padding: '4px 18px 18px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '10px 24px',
        }}
      >
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div
              className="dim"
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                margin: '8px 0 4px',
              }}
            >
              {section.title}
            </div>
            {section.items.map((s) => (
              <div
                key={s.label}
                className="row"
                style={{ gap: 10, padding: '5px 0', fontSize: 13 }}
              >
                <span className="grow" style={{ color: 'var(--text-2)' }}>
                  {s.label}
                </span>
                <Keys combo={s.keys} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
