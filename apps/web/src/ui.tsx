import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import type { User } from '@nonlinear/shared';
import { keyBetween } from '@nonlinear/shared';
import { beginPointerDrag } from './dragdrop.js';
import { userInitials } from './store.js';
import { CheckIcon, SearchIcon } from './icons.js';

/* ---------- Avatar ---------- */

export function Avatar({ user, size = 18 }: { user: User | null | undefined; size?: number }) {
  if (!user) {
    return (
      <span
        className="avatar"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.42,
          background: 'transparent',
          border: '1px dashed var(--text-4)',
          color: 'var(--text-4)',
        }}
      >
        ?
      </span>
    );
  }
  return (
    <span
      className="avatar"
      title={user.name}
      style={{ width: size, height: size, fontSize: size * 0.42, background: user.avatarColor }}
    >
      {userInitials(user)}
    </span>
  );
}

/* ---------- Popover / Menu ---------- */

export interface Anchor {
  x: number;
  y: number;
}

export function anchorFromEvent(e: { currentTarget: EventTarget & Element }): Anchor {
  const rect = e.currentTarget.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 4 };
}

export function anchorFromMouse(e: { clientX: number; clientY: number }): Anchor {
  return { x: e.clientX, y: e.clientY };
}

export function Popover({
  anchor,
  onClose,
  children,
  width,
}: {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({
    left: anchor.x,
    top: anchor.y,
    visibility: 'hidden',
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = anchor.x;
    let top = anchor.y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, anchor.y - rect.height - 8);
    }
    setPos({ left, top, visibility: 'visible' });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <>
      <div
        className="popover-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div ref={ref} className="menu" style={{ ...pos, width }}>
        {children}
      </div>
    </>,
    document.body,
  );
}

/* ---------- Searchable picker ---------- */

export interface PickerItem {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  destructive?: boolean;
}

export function Picker({
  anchor,
  onClose,
  items,
  onPick,
  placeholder = 'Search…',
  selectedIds,
  searchable = true,
  width = 240,
  footer,
}: {
  anchor: Anchor;
  onClose: () => void;
  items: PickerItem[];
  onPick: (id: string) => void;
  placeholder?: string;
  selectedIds?: Set<string>;
  searchable?: boolean;
  width?: number;
  footer?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = query
    ? items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
    : items;
  const clampedHl = Math.min(hl, Math.max(0, filtered.length - 1));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHl((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHl((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[clampedHl];
      if (item) onPick(item.id);
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={width}>
      {searchable && (
        <div className="menu-search">
          <SearchIcon size={13} style={{ color: 'var(--text-4)' }} />
          <input
            ref={inputRef}
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setHl(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
      )}
      {filtered.length === 0 && <div className="menu-item muted">No results</div>}
      {filtered.map((item, i) => (
        <button
          key={item.id}
          className={`menu-item${i === clampedHl ? ' hl' : ''}${item.destructive ? ' destructive' : ''}`}
          onMouseEnter={() => setHl(i)}
          onClick={() => onPick(item.id)}
        >
          {item.icon}
          <span className="grow">{item.label}</span>
          {item.hint && <span className="dim">{item.hint}</span>}
          {selectedIds?.has(item.id) && <CheckIcon size={14} className="check" />}
        </button>
      ))}
      {footer}
    </Popover>
  );
}

/* ---------- Modal ---------- */

export function Modal({
  onClose,
  children,
  width,
}: {
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ width }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Switch ---------- */

export function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      className={`switch${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    />
  );
}

/* ---------- Drag reorder ----------

Pointer-based vertical list reordering (no HTML5 DnD — see dragdrop.ts).
Spread itemProps(index) on each row wrapper (marks it as a hit-target) and
dragProps(item, label) on the drag source (whole row or a grip handle). An
insertion line is drawn via the `insertBefore` index (style rows with a top
border when insertBefore === index). onMove fires with the dragged item and
the index it should be inserted at (in the pre-drag array). */

export function useDragReorder<T extends { id: string }>(
  items: T[],
  onMove: (dragged: T, insertAt: number) => void,
) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [insertBefore, setInsertBefore] = useState<number | null>(null);

  const itemProps = (index: number) => ({ 'data-reorder-index': index });

  const insertionAt = (target: Element | null, ev: PointerEvent): number | null => {
    const row = target?.closest('[data-reorder-index]') as HTMLElement | null;
    if (!row) return null;
    const index = Number(row.dataset.reorderIndex);
    const rect = row.getBoundingClientRect();
    return ev.clientY < rect.top + rect.height / 2 ? index : index + 1;
  };

  const dragProps = (item: T, label: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      let current: number | null = null;
      beginPointerDrag({
        event: e,
        ghostText: label,
        onActivate: () => setDragId(item.id),
        onHover: (target, ev) => {
          current = insertionAt(target, ev);
          setInsertBefore(current);
        },
        onDrop: (target, ev) => {
          // Recompute at release; fall back to the last hover position when
          // the pointer lands between rows.
          const at = insertionAt(target, ev) ?? current;
          if (at !== null) onMove(item, at);
        },
        onEnd: () => {
          setDragId(null);
          setInsertBefore(null);
        },
      });
    },
  });

  return { dragId, insertBefore, itemProps, dragProps };
}

/** New fractional sort key for dropping `dragged` at `insertAt` (pre-drag index space). */
export function sortKeyForInsert<T extends { id: string; sortOrder: string }>(
  items: T[],
  dragged: T,
  insertAt: number,
): string | null {
  const from = items.findIndex((i) => i.id === dragged.id);
  const filtered = items.filter((i) => i.id !== dragged.id);
  const pos = from !== -1 && from < insertAt ? insertAt - 1 : insertAt;
  const before = filtered[pos - 1]?.sortOrder ?? null;
  const after = filtered[pos]?.sortOrder ?? null;
  try {
    return keyBetween(before, after);
  } catch {
    return null;
  }
}

/* ---------- Toasts ---------- */

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error' | 'success';
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (message, kind = 'info') => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toast(message: string, kind: Toast['kind'] = 'info'): void {
  useToasts.getState().push(message, kind);
}

export function toastError(err: unknown): void {
  const message = err instanceof Error ? err.message : 'Something went wrong';
  toast(message, 'error');
}

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.message}
        </div>
      ))}
    </div>,
    document.body,
  );
}
