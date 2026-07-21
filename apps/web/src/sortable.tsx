import { useEffect, useRef } from 'react';
import Sortable from 'sortablejs';
import { keyBetween } from '@nonlinear/shared';

/**
 * Thin React wrapper over SortableJS. It replaces the hand-rolled pointer drag
 * engine: SortableJS brings native-feeling touch support (long-press to start a
 * drag so a plain touch still scrolls the list — `delay` + `delayOnTouchOnly`)
 * and built-in autoscroll while dragging (which the old engine lacked, so drags
 * fought the page scroll on mobile).
 *
 * The React contract: React stays the single source of truth for order. On drop
 * we read the intended neighbors from the post-drop DOM, then *revert*
 * SortableJS's mutation so the DOM matches React's last render, and hand the
 * logical move to `onDrop`. The caller updates state (fractional `sortOrder`),
 * and React re-renders the authoritative order.
 *
 * Draggable children must carry `data-sort-id`. Lists that share a `group` name
 * can exchange items (board columns, grouped-list buckets); omit it for a
 * self-contained reorder list.
 */

export interface SortableDrop {
  /** `data-sort-id` of the moved item. */
  id: string;
  /** `data-sort-group` of the destination container. */
  toGroup: string;
  /** Neighbor ids around the drop position in the destination (excluding the moved item). */
  beforeId: string | null;
  afterId: string | null;
}

const draggables = (el: Element): HTMLElement[] =>
  Array.from(el.querySelectorAll(':scope > [data-sort-id]'));

/** Fractional key placing a dropped item between its new neighbors, or null. */
export function keyBetweenNeighbors(
  byId: Record<string, { sortOrder: string } | undefined>,
  drop: SortableDrop,
): string | null {
  const before = drop.beforeId ? (byId[drop.beforeId]?.sortOrder ?? null) : null;
  const after = drop.afterId ? (byId[drop.afterId]?.sortOrder ?? null) : null;
  try {
    return keyBetween(before, after);
  } catch {
    return null;
  }
}

export function SortableList({
  sortGroup,
  group,
  onDrop,
  disabled,
  handle,
  className,
  style,
  children,
}: {
  sortGroup: string;
  /** Shared group name enabling cross-list drag; omit for a lone reorderable list. */
  group?: string;
  onDrop: (drop: SortableDrop) => void;
  disabled?: boolean;
  /** CSS selector for a drag handle inside each item (e.g. '.drag-handle'). */
  handle?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    const sortable = Sortable.create(el, {
      group: group ? { name: group } : undefined,
      draggable: '[data-sort-id]',
      handle,
      // Ignore interactive controls so buttons/links inside a row still work.
      filter: 'button, a, input, select, textarea, .no-drag',
      preventOnFilter: false,
      animation: 150,
      // Mobile: require a short press before a drag starts, so a normal touch
      // scrolls the list. Desktop (mouse) drags start immediately.
      delay: 180,
      delayOnTouchOnly: true,
      touchStartThreshold: 8,
      // Autoscroll the nearest scrollable ancestor while dragging near an edge.
      scroll: true,
      bubbleScroll: true,
      scrollSensitivity: 80,
      scrollSpeed: 14,
      forceFallback: true, // consistent custom drag image across browsers/touch
      fallbackTolerance: 4,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: (evt) => {
        const item = evt.item as HTMLElement;
        const to = evt.to as HTMLElement;
        const from = evt.from as HTMLElement;
        // Neighbors from the actual dropped DOM order (robust vs. index math).
        const toSibs = draggables(to);
        const pos = toSibs.indexOf(item);
        const beforeId = pos > 0 ? (toSibs[pos - 1]?.dataset.sortId ?? null) : null;
        const afterId =
          pos >= 0 && pos < toSibs.length - 1 ? (toSibs[pos + 1]?.dataset.sortId ?? null) : null;

        // Revert SortableJS's DOM change so React remains authoritative.
        item.remove();
        const fromSibs = draggables(from);
        const refNode = fromSibs[evt.oldDraggableIndex ?? fromSibs.length] ?? null;
        from.insertBefore(item, refNode);

        onDropRef.current({
          id: item.dataset.sortId ?? '',
          toGroup: to.dataset.sortGroup ?? sortGroup,
          beforeId,
          afterId,
        });
      },
    });
    return () => sortable.destroy();
  }, [group, sortGroup, disabled, handle]);

  return (
    <div ref={ref} data-sort-group={sortGroup} className={className} style={style}>
      {children}
    </div>
  );
}
