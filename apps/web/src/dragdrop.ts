/**
 * Pointer-based drag and drop.
 *
 * HTML5 drag-and-drop proved unreliable (Chrome aborts native drags when the
 * DOM changes near dragstart, ghosts are uncustomizable, events are flaky), so
 * every drag surface uses this instead: plain pointer events, a threshold
 * before the drag activates so clicks stay clicks, a floating ghost pill,
 * hit-testing via elementFromPoint, and Escape to cancel.
 */

interface PointerDragOptions {
  /** The pointerdown that may become a drag. */
  event: React.PointerEvent;
  /** Content of the floating ghost pill. */
  ghostText: string;
  /** Pixels of travel before the drag activates (default 5). */
  threshold?: number;
  onActivate?: () => void;
  /** Fired on every move while active with the element under the cursor. */
  onHover?: (target: Element | null, e: PointerEvent) => void;
  /** Fired on release while active with the element under the cursor. */
  onDrop?: (target: Element | null, e: PointerEvent) => void;
  /** Always fired when the drag ends (drop, cancel, or never activated). */
  onEnd?: () => void;
}

export function beginPointerDrag({
  event,
  ghostText,
  threshold = 5,
  onActivate,
  onHover,
  onDrop,
  onEnd,
}: PointerDragOptions): void {
  if (event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  let active = false;
  let ghost: HTMLDivElement | null = null;

  const underCursor = (e: PointerEvent): Element | null =>
    document.elementFromPoint(e.clientX, e.clientY);

  /** Scroll the container under the cursor when dragging near its edges. */
  const autoScroll = (target: Element | null, e: PointerEvent) => {
    const EDGE = 48;
    const SPEED = 14;
    let el: Element | null = target;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      const scrollsY = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
      const scrollsX = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
      if (scrollsY || scrollsX) {
        const rect = el.getBoundingClientRect();
        if (scrollsY) {
          if (e.clientY < rect.top + EDGE) el.scrollTop -= SPEED;
          else if (e.clientY > rect.bottom - EDGE) el.scrollTop += SPEED;
        }
        if (scrollsX) {
          if (e.clientX < rect.left + EDGE) el.scrollLeft -= SPEED;
          else if (e.clientX > rect.right - EDGE) el.scrollLeft += SPEED;
        }
        return;
      }
      el = el.parentElement;
    }
  };

  const positionGhost = (e: PointerEvent) => {
    if (!ghost) return;
    ghost.style.left = `${e.clientX + 12}px`;
    ghost.style.top = `${e.clientY + 8}px`;
  };

  const activate = (e: PointerEvent) => {
    active = true;
    document.body.classList.add('drag-active');
    ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = ghostText;
    document.body.appendChild(ghost);
    positionGhost(e);
    onActivate?.();
  };

  const cleanup = (didDrag: boolean) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('drag-active');
    ghost?.remove();
    ghost = null;
    if (didDrag) {
      // Swallow the click the browser fires after pointerup so the drop
      // doesn't also navigate.
      window.addEventListener(
        'click',
        (e) => {
          e.stopPropagation();
          e.preventDefault();
        },
        { capture: true, once: true },
      );
      // In case no click follows (released off-element), drop the swallower.
      setTimeout(() => {
        window.dispatchEvent(new MouseEvent('click'));
      }, 0);
    }
    onEnd?.();
  };

  const onMove = (e: PointerEvent) => {
    if (!active) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < threshold) return;
      activate(e);
    }
    e.preventDefault();
    positionGhost(e);
    const target = underCursor(e);
    autoScroll(target, e);
    onHover?.(target, e);
  };

  const onUp = (e: PointerEvent) => {
    const wasActive = active;
    if (wasActive) onDrop?.(underCursor(e), e);
    cleanup(wasActive);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cleanup(active);
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey, true);
}
